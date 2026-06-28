# Win7 适配踩坑记录

## 环境

- **目标系统**: Windows 7 SP1 x64
- **便携 Node.js**: `node-v18.20.8-win-x64`（Node.js 最后一个支持 Win7 的版本）
- **项目**: Claude Code (reverse-engineered) CLI

---

## 坑 1: `SUPPORTED_PLATFORMS` 排除 Windows

### 现象
代码库中 60+ 文件已经通过 `getPlatform() === 'windows'` 做了 Windows 适配，但 `SUPPORTED_PLATFORMS` 数组只包含 `['macos', 'wsl']`，导致 Windows 被当成"不支持平台"。

### 解决
**文件**: `src/utils/platform.ts`
```diff
- export const SUPPORTED_PLATFORMS: Platform[] = ['macos', 'wsl']
+ export const SUPPORTED_PLATFORMS: Platform[] = ['macos', 'windows', 'wsl']
```

Platform 类型本身就包含 `'windows'`，只需加入白名单即可激活所有已有的 Windows 代码路径。

### 影响范围
Claude Desktop 配置读取（`src/utils/claudeDesktop.ts`）也依赖此白名单，需同步添加原生 Windows 路径（`%APPDATA%\Claude\claude_desktop_config.json`）。

---

## 坑 2: Bun 构建产物不兼容 Node.js 18

### 现象
Bun build (`build.ts`) 目标为 `target: 'bun'`，产物包含 ES2024 的 `using` 声明语法（Explicit Resource Management）。Node.js 18 不支持，报错：
```
SyntaxError: Unexpected identifier
```

### 解决
**文件**: `build.ts`

在构建后处理中添加 `using` → `const` 转译：

```js
const AWAIT_USING_DECL = /\bawait\s+using\s+(\w+)\s*=/g
const USING_DECL = /(?<!\bawait\s)\busing\s+(\w+)\s*=/g
```

关键点：
1. `await using` 必须**先于** `using` 处理，否则 `using` 先匹配会导致 `await const`（语法错误）
2. `using` 正则需要**负向后顾**（negative lookbehind）排除 `await using` 已处理的场景
3. 此替换是安全的，因为 `SLOW_OPERATION_LOGGING` 在生产构建中未启用，`slowLogging` 返回空操作的 disposable

---

## 坑 3: Vite 构建交互模式报 React Context 错误

### 现象
Vite build (`build:vite`) 的 pipe 模式正常，但交互 REPL 模式报错：
```
React Rendering Error
useAppState/useSetAppState cannot be called outside of an <AppStateProvider />
```

### 原因
Vite/Rollup 的代码分割（code splitting）导致 React Context 模块在运行时出现引用不一致的问题。Provider 和 Consumer 使用了不同的 Context 实例。

### 解决
**放弃 Vite 构建**，改用 Bun 原生构建 (`bun run build.ts`)。Bun build 产物在交互模式和 pipe 模式均正常工作。

### 经验
代码分割对使用 React Context 的项目有风险。如果必须分块（如内存优化），需要确保 Context Provider 和 Consumer 在**同一个 chunk** 中，或使用 `dedupe` 配置。

---

## 坑 4: `string-width@8` 使用 RegExp `v` flag

### 现象
Node.js 18 报错：
```
SyntaxError: Invalid flags supplied to RegExp constructor 'v'
```

### 原因
`string-width@8.x` 使用 ES2024 的 RegExp `v` flag（Unicode Sets 模式），Node.js 18 不支持。`v` flag 由 `wrap-ansi@10` 和 `cli-truncate@5` 间接依赖引入。

### 解决
**文件**: `package.json` → `overrides`
```json
"string-width": "7.2.0"
```

`string-width@7.x` 使用 `u` flag，Node.js 18 完全支持，API 兼容。

### 排查方法
```bash
# 1. 先用 portable node 跑，看报错信息
./node-v18.20.8-win-x64/node.exe dist/cli-node.js --help 2>&1

# 2. 搜索哪个包引入了 v flag
grep -r "Default_Ignorable_Code_Point" node_modules/.bun/ --include='*.js'

# 3. 追踪依赖链
grep -rn 'string-width' node_modules/.bun/ --include='package.json' | grep -v 'node_modules/string-width'
```

---

## 坑 5: `execa@9` 的 Rollup 打包问题

### 现象
Vite build 产物运行时报错：
```
ReferenceError: nodeImports is not defined
```

### 原因
`execa@9` 使用特定的 Node.js 内置模块引用方式（`node:*` imports），Rollup 打包时生成了对 `nodeImports` 的引用但该变量未被正确定义。

### 解决
**文件**: `vite.config.ts`

将 `execa` 外部化，避免打包：
```ts
external: ['doubaoime-asr', 'opus-encdec', 'execa'],
```

这样 `execa` 在运行时从 `node_modules` 加载，而非被打包进 bundle。

---

## 坑 6: 云桌面 C 盘重启清空

### 现象
Win7 运行在云桌面环境，重启后 `C:\Users\<user>\.claude\` 被清空，所有配置丢失（settings.json、插件、MCP 配置等）。

### 解决
**文件**: `scripts/claude.cmd`

在启动脚本中设置 `CLAUDE_CONFIG_DIR` 指向 Claude 安装目录：
```batch
rem 获取 claude 安装目录的绝对路径
pushd "%PROJECT_ROOT%"
set "CLAUDE_CONFIG_DIR=%CD%\.claude"
popd

rem 自动创建 .claude 目录
if not exist "%CLAUDE_CONFIG_DIR%" mkdir "%CLAUDE_CONFIG_DIR%"
```

`CLAUDE_CONFIG_DIR` 环境变量被 `getClaudeConfigHomeDir()` 识别，影响所有配置路径：
- `settings.json`（用户设置）
- `plugins/`（插件目录）
- `skills/`（自定义 skills）
- `agents/`（自定义 agents）
- `keybindings.json`（快捷键配置）
- `templates/`（模板）
- `sessions/`（会话记录）
- MCP 配置文件

最终目录结构：
```
D:\claude-code\
  .claude\              ← 所有配置存这里，不受 C 盘清空影响
    settings.json
    plugins\
    skills\
    agents\
    ...
  dist\
    claude.cmd
    cli-node.js
  node-v18.20.8-win-x64\
    node.exe
```

---

## 构建方式变更总结

| 项目 | 原方案 | Win7 方案 |
|------|--------|----------|
| 构建工具 | Bun build + Vite build 双轨 | **仅 Bun build** (`bun run build.ts`) |
| JS 目标 | `target: 'bun'` | 同左 + 后处理转译 `using`→`const` |
| 运行时 | Bun | **便携 Node.js v18.20.8** |
| 配置目录 | `%USERPROFILE%\.claude` | **安装目录 `\.claude`** |
| 启动方式 | `bun dist/cli-bun.js` | **`dist\claude.cmd`** |

---

## 坑 7: 构建产物目录混乱

### 现象
Bun build 使用 `splitting: true` 后，630 个 chunk 文件和 631 个 `.map` 文件全部平铺在 `dist/` 根目录，极其混乱：
```
dist/
  chunk-00cx7kxv.js
  chunk-00cx7kxv.js.map
  chunk-04b7mfvn.js
  chunk-04b7mfvn.js.map
  ...  (1200+ files flat in root)
  cli.js
```

### 解决
1. **关闭 sourcemap**: `sourcemap: 'none'`（生产构建不需要，且 .map 文件多达 631 个）
2. **chunk 归入子目录**: 在 `build.ts` 后处理中将 `chunk-*.js` 统一移入 `dist/chunks/`
3. **修正 import 路径**: 将 `cli.js` 中的 `./chunk-xxx.js` 替换为 `./chunks/chunk-xxx.js`

关键代码（`build.ts` Step 4）：
```ts
const chunksDir = join(outdir, 'chunks')
await mkdir(chunksDir, { recursive: true })

// 移动 chunk 文件
for (const file of await readdir(outdir)) {
  if (!/^chunk-[a-z0-9]+\.js$/.test(file)) continue
  await rename(join(outdir, file), join(chunksDir, file))
}

// 修正 cli.js 中的 import 路径
let cliContent = await readFile(join(outdir, 'cli.js'), 'utf-8')
cliContent = cliContent.replace(
  /(['"])\.\/(chunk-[a-z0-9]+\.js)\1/g,
  '$1./chunks/$2$1'
)
await writeFile(join(outdir, 'cli.js'), cliContent)
```

### dist 目录规约

构建产物 `dist/` 必须保持如下结构：

```
dist/
  package.json          ← {"type": "module"}（自包含部署必需）
  cli.js                ← 主入口，由 Bun build 生成
  cli-bun.js            ← Bun 启动入口 (shebang: bun)
  cli-node.js           ← Node.js 启动入口 (shebang: node)
  claude.cmd            ← Win7 启动脚本
  node_modules/         ← 外部 npm 依赖（ws、undici）
  vendor/               ← 原生二进制文件
    audio-capture/
    ripgrep/
  chunks/               ← 代码分割产物（仅 chunk-*.js）
    chunk-xxx.js
    ...
```

**规则**：
- `dist/` 根目录允许：`package.json`、`cli.js`、`cli-bun.js`、`cli-node.js`、`claude.cmd`、`node_modules/`、`vendor/`、`chunks/`
- 所有 `chunk-*.js` 必须在 `dist/chunks/` 子目录中
- **禁止** `.map` 文件（`sourcemap: 'none'`）
- `build.ts` 负责在每次构建时强制执行此结构

---

## 坑 8: Node.js 18 拒绝在 Win7 上运行

### 现象
Win7 上运行 `claude.cmd` 直接报错退出：
```
Node.js is only supported on Windows 8.1, Windows Server 2012 R2, or higher.
Setting the NODE_SKIP_PLATFORM_CHECK environment variable to 1 skips this
check, but Node.js might not execute correctly.
```

### 原因
Node.js 18 启动时会调用 `IsWindows8Point1OrGreater()` 检查系统版本，Windows 7 (NT 6.1) 不通过此检查。

### 解决
**文件**: `scripts/claude.cmd`

在启动脚本中设置环境变量：
```batch
rem Node.js 18 blocks Win7 by default; skip the platform check
set "NODE_SKIP_PLATFORM_CHECK=1"
```

此变量让 Node.js 跳过 `RtlGetVersion` 版本检查。Node.js 18 的实际运行不依赖 Win8.1+ 特有的 API，在 Win7 上可以正常工作。

---

## 坑 9: dist 目录缺少 package.json → ESM 报错

### 现象
Win7 上运行 `claude.cmd` 报错：
```
E:\dist\cli-node.js:2
import "./cli.js"
^^^^^^

SyntaxError: Cannot use import statement outside a module
```

### 原因
`cli-node.js` 包含 `import` 语句，Node.js 必须将其当作 ES Module 执行。项目根目录的 `package.json` 有 `"type": "module"`，但 `dist/` 目录被复制到 `E:\dist` 独立部署时，Node.js 向上查找不到 `package.json`，于是按 CommonJS 解析 → 报错。

### 解决
**文件**: `build.ts`

构建时自动在 `dist/` 生成一个最小 `package.json`：
```ts
await writeFile(
  join(outdir, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
)
```

这样 `dist/` 成为自包含部署单元，复制到任意路径都能正常运行。

---

## 坑 10: dist 部署缺少外部 npm 依赖

### 现象
Win7 上运行报错：
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ws' imported from E:\dist\chunks\chunk-1x0g69rj.js
```

### 原因
Bun build 默认 externalize 一些 npm 包（`ws`、`undici`），在 bundle 中保留 `import 'ws'` 语句。开发时从项目根目录的 `node_modules/` 解析，但 `dist/` 独立部署到 Win7 时没有 `node_modules/`。

### 解决
**文件**: `build.ts`

构建时自动复制所需的外部依赖到 `dist/node_modules/`：
```ts
const vendoredModules = ['ws', 'undici']
for (const mod of vendoredModules) {
  await cp(join('node_modules', mod), join(outdir, 'node_modules', mod), {
    recursive: true,
  })
}
```

这样 `dist/` 成为完全自包含的部署单元，无需依赖项目根目录的 `node_modules/`。
