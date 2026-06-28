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

---

## 坑 11: Win7 旧控制台终端渲染异常（重复堆叠 / 串字 / 退出变色）

### 现象

Win7 上 Claude Code 发生三类终端渲染问题：

1. **`/plugin` 切标签时欢迎横幅重复堆叠** —— 同一段内容连续出现 3~10 份，每次都多叠一层。
2. **流式输出时画面串字交错** —— 正常聊天/打字时内容行和旧行的单元格交叠。
3. **退出后终端字色变了** —— shell 提示符后续都是 dim/变色状态，需要手动 `cls` 才能恢复。

在 ConEmu / PowerShell / cmd / Git Bash (via winpty) 中表现一致，**换终端无效**。

### 原因

Windows 7 的旧 **conhost 没有原生 VT/ANSI 支持**。Node.js 不依赖外部终端模拟器，而是通过 **libuv** (`uv_tty.c`) 将 ANSI 转义序列就地翻译成 Win32 Console API 调用。但 libuv 只实现了 ANSI 的一个**子集**：

| 支持（可用） | **不支持（被丢弃）** |
|---|---|
| SGR 颜色 `ESC[…m` | **备用屏幕缓冲区** `ESC[?1049h`（alt-screen 切换） |
| 光标移动 / 定位 `CSI n A/B/C/D/H` | **清滚动历史** `ESC[3J` |
| 可视区清屏 `ESC[2J` | 鼠标跟踪 / 焦点事件 / bracketed-paste / 同步更新等 DEC 私有模式 |
| 显示/隐藏光标 `ESC[?25h/l` | Kitty 键盘协议 `ESC[>1u` |

这意味着：无论外层封装了哪个终端（ConEmu、PowerShell、cmd），**输出都要先经过 libuv 这一层**，alt-screen 序列在这步就被丢弃了，永远到不了实际渲染器。所以换终端无效。

### 根因分析

三个现象的根因各自不同但同源（libuv ANSI 支持不完整）：

**重复堆叠**：非 fullscreen 模式下，整个 REPL 是"比窗口高的大帧"（欢迎横幅 + 历史消息 + 插件面板）。切标签触发 `fullResetSequence_CAUSES_FLICKER`（整帧重画），它调用 `getClearTerminalSequence()`。在 Win7 的"legacy Windows"分支中，该序列只发 `ESC[2J`（清可视区），**无法发 `ESC[3J`（清 scrollback 区）**。每次 full-reset 重画整帧时，旧横幅副本被推进 scrollback 又清不掉，随即新副本画进可视区 → 累计 3→10 份。`CLAUDE_CODE_NO_FLICKER=1`（强开 fullscreen）后**堆叠消失**（帧被约束在一屏高，无 scrollback 区）。

**串字**：fullscreen 启用后，`ESC[?1049h`（切备用屏）被 libuv 丢弃，实际仍在**主屏**。而 alt-screen 渲染器用"增量 diff + **相对光标上移**"更新当前帧。相对光标上移在 conhost 触发 `hasCursorUpViewportYankBug`（代码里 win32 时直接返回 `true`，引用 microsoft/terminal#14774）→ 虚拟光标模型与物理屏错位 → 旧单元格没被覆盖 → 串字。

**退出变色**：`gracefulShutdown.ts` 退出清理时发一批 DEC 私有模式重置序列 + `SHOW_CURSOR` + `chalk.dim(...)` 打印 resume 提示，但**没有保证发一个硬 SGR 复位 `ESC[0m`**。Win7 上 libuv 不可靠处理 chalk 的 `22m`(dim-off)，最后一次渲染留下的 dim/颜色属性泄漏给 shell。

### 解决（commit `d871903e`）

**文件**: `packages/@ant/ink/src/core/clearTerminal.ts` / `index.ts`、`src/utils/fullscreen.ts`、`packages/@ant/ink/src/core/log-update.ts`、`src/utils/gracefulShutdown.ts`

分四步：

#### 1. 新增 Win7 检测常量

```ts
// packages/@ant/ink/src/core/clearTerminal.ts
export const IS_WINDOWS7 =
  process.platform === 'win32' && osRelease().startsWith('6.1')
```

`os.release()` 返回 NT 版本号，Win7 = `6.1.x`。模块级（process lifetime 不变，只算一次，渲染热路径安全）。

#### 2. Win7 默认开 fullscreen

在 `src/utils/fullscreen.ts` 的 `isFullscreenEnvEnabled()` 末尾（`return process.env.USER_TYPE === 'ant'` 之前）插入：

```ts
if (IS_WINDOWS7) {
  return true
}
```

`CLAUDE_CODE_NO_FLICKER=0` 的处理在函数开头（opt-out 优先），不受影响。

效果：Win7 上整个 REPL 被 `<AlternateScreen>` 包裹，树约束在 `<Box height={rows}>` 一屏高。帧永远不会超过窗口 → 没有 scrollback 区 → 旧帧不可能累积。**代价**：失去鼠标滚轮和终端原生滚动（键盘 PgUp/PgDn/Ctrl+Home/End 仍可滚），启动时清一次屏。

#### 3. Win7 fullscreen 下改用逐行绝对定位重画

在 `packages/@ant/ink/src/core/log-update.ts` 的 `render()` 开头（`isTTY` 判定之后）插入快速路径：

```ts
if (altScreen && IS_WINDOWS7) {
  return this.renderWin7FullFrame(prev, next)
}
```

新增方法 `renderWin7FullFrame(prev, next)` 的核心策略：

- **绝对定位，非相对移动**：用 `CSI 行;1 H`（`cursorPosition`）逐行跳转到目标行、画完该行内容、用 `ESC[K`（`eraseToEndOfLine`）清行尾。从不用相对光标上移，从不发 LF（不会推进 scrollback）。
- **仅重画变化的行**：复用引擎的 `diffEach(prev.screen, next.screen)` 找出变化的行号；未变化行跳过 → 空闲时发射零字节 → **零闪烁**；打字只重画输入行；流式只重画变化的消息行。
- **尺寸变化时全屏重画**：`ESC[2J` + 逐行绝对重画（`resize` 场景）。
- **与外部清理自然协作**：引擎的 `forceRedraw` / `enterAlternateScreen` / SIGCONT 会把 `prev` 帧重置为空白 → `diffEach` 发现所有行变化 → 自动全量重画，不会白屏。

#### 4. 退出时硬复位

在 `src/utils/gracefulShutdown.ts` 的 `cleanupTerminalModes()` 开头（`if isTTY` 之后、`try` 内）加：

```ts
writeSync(1, '\x1b[0m')  // 硬 SGR 复位，各平台均支持且无害
```

### 关键复用点

- `fullResetSequence_CAUSES_FLICKER`（resize/offscreen 路径 + 流式整帧重画）—— `log-update.ts:504`，本次仅在 `renderWin7FullFrame` 尺寸变化时回退到它
- `getClearTerminalSequence()` + 现有 Win 检测——`clearTerminal.ts`
- `FlickerReason='clear'`——`frame.ts:36`
- fullscreen gate + `<AlternateScreen>` 包裹——`fullscreen.ts` + `REPL.tsx:6676`

### 取舍与后续

- **闪烁可控**：逐行只重画变化行消除空闲闪烁；流式时只在变化行有轻微闪烁，实测可接受。若后续觉得重，可优化为逐行直接写入（省 `ESC[2J`）。
- **鼠标滚轮失效**：Win7 fullscreen 禁用 SGR 鼠标跟踪（libuv 不支持），键盘 PgUp/PgDn/Ctrl+Home/End 仍可用。允许 `CLAUDE_CODE_NO_FLICKER=0` 退回 legacy 换取原生滚动。
- **其他 Win 不受影响**：`IS_WINDOWS7` 限制 NT 6.1，Win8.1+/Win10/Win11 走原有路径。
