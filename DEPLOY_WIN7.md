# Win7 + Node.js 18 便携版部署指南

## 环境要求

- Windows 7 SP1 x64
- Node.js 18.20.8 便携版（放在 `node/` 目录下）

## 编译（在开发机上）

```bash
# 1. 安装依赖
npm install

# 2. 编译（Vite build）
npx vite build

# 3. 打 Node 18 兼容补丁（RegExp v flag → u flag）
node scripts/patch-node16.cjs
```

## 部署（复制到 Win7 目标机器）

```
D:\claude-code\
├── claude.bat          # 启动脚本
├── cli.js              # 入口文件
├── package.json        # ESM type 声明
├── .env.example        # 环境变量模板
├── .claude\            # 配置存储目录
├── node\               # Node.js 18 便携版
│   └── node.exe
└── chunks\             # 代码块（~500 个 .js 文件）
```

**1. 复制文件**
将编译后的 `dist/` 目录复制到 Win7 机器（如 `D:\claude-code\`）。

**2. 放置 Node.js 18**
将 `node-v18.20.8-win-x64` 解压到与 `dist/` 同级的位置（`D:\claude-code\node-v18.20.8-win-x64\`），确保 `node.exe` 路径匹配。
> `claude.bat` 通过 `%~dp0..\node-v18.20.8-win-x64\node.exe` 寻找 Node。

**3. 配置 API**
在 `~/.claude/settings.json`（或便携目录 `.claude/settings.json`）的 `env` 字段中配置：
```json
{
  "env": {
    "CLAUDE_CODE_USE_OPENAI": "1",
    "OPENAI_API_KEY": "your-api-key",
    "OPENAI_BASE_URL": "http://your-api-host:port/v1"
  }
}
```
OPENAI_MODEL=your-model-name
```

**4. 全局命令（可选）**
找一个 PATH 中已有的可写目录，放入跳板脚本：
```cmd
for %d in ("%PATH:;=" "%") do @(echo %~d 2>nul > "%~d\_test" && del "%~d\_test" && echo [可写] %~d) 2>nul
```
在可写目录创建 `claude.cmd`：
```cmd
@echo off
call D:\claude-code\claude.bat %*
```

**5. 运行**
```cmd
D:\claude-code\claude.bat
```
或在第 4 步配置完成后直接：
```cmd
claude
```

## 移植改动说明

相比上游 `claude-code-best/claude-code`，此版本的改动：

| 文件 | 改动 |
|------|------|
| `vite.config.ts` | `manualChunks` 将关键状态模块打入 `shared-state`，防止 React Context 重复 |
| `src/utils/config.ts` | `getConfig()` 守卫从 throw 改为 console.error，避免死锁 |
| `src/state/AppState.tsx` | `useAppStore()` 等 hook 增加 fallback store，外部调用不抛异常 |
| `src/services/mcp/MCPConnectionManager.tsx` | MCP hook 改为 noop fallback，不抛异常 |
| `src/entrypoints/cli.tsx` | 移除内建 `.env` 加载，改用 settings.json `env` 字段；提前调用 `enableConfigs()` |
| `src/utils/platform.ts` | Bun → Node 平台适配 |
| `src/utils/semver.ts` | 移除 Bun 依赖 |
| `src/utils/node12compat.ts` | Node 12/18 polyfills |
| `packages/@ant/ink/src/core/termio/dec.ts` | 可选 DEC 模式按终端能力开关，避免 IDEA/CMD 乱码 |
| `packages/@ant/ink/src/components/App.tsx` | 扩展键盘序列按终端能力开关 |
| `packages/@ant/ink/src/core/ink.tsx` | 清理序列按终端能力开关 |
| `scripts/patch-node16.cjs` | 构建后 RegExp v flag → u flag 兼容补丁 |
| `scripts/patch-node16.cjs` | 同时修复 `nodeImports` 缺少 `stream.on` / `finished` 引用 |

## 已知的坑（pitfalls）

### 1. RegExp `v` flag（Node 18 不支持）
- Node 18 不支持 RegExp `v` flag（Node 20+ 才加），Vite/Rolldown 输出的 `RegExp("...","v")` 和 `/.../v` 字面量会报 `SyntaxError: Invalid flags supplied to RegExp constructor 'v'`
- **修复**：`patch-node16.cjs` 将 `"v"` 替换为 `"u"`，`RGI_Emoji` → `Extended_Pictographic`

### 2. `globalThis.nodeImports` 未定义
- Rolldown 构建产物中 `Object.assign(nodeImports,{...})` 引用了未声明的 `nodeImports`
- **修复**：`post-build.ts` Step 1.5 将其替换为 `(globalThis.nodeImports??={}),Object.assign(globalThis.nodeImports,{...})`

### 3. `stream.on` 在 Node 18 上不导出
- `node:stream` 导出 `on` 是 **Node 20.12+** 才加的，Node 18 上 `import{on}from"node:stream"` 报 `does not provide an export named 'on'`
- `node:events.on` 与 `node:stream.on` 是同一个函数（stream 只是 re-export）
- 已有导入 `import{on as ln}from"node:events"`，所以用 `ln` 填充 `nodeImports.on`
- **修复**：`Object.assign(globalThis.nodeImports,{on:ln,finished:zzzFn})`，其中 `zzzFn` 是单独从 `node:stream` 导入的 `finished`

### 4. `on` 变量名冲突（Rolldown minifier）
- 构建产物中 `import{createConnection as nee,isIP as on}from"net"` 已经声明了 `on`
- `post-build.ts` / `patch-node16.cjs` 不能往模块中再添加 `import{on as on}from"..."`，否则冲突
- **修复**：使用已有变量（`ln` → `node:events.on`）或唯一别名（`zzzFn`）

### 5. PowerShell `Set-Content` 会损坏 UTF-8 编码
- 8MB+ 的 chunk 文件包含多语言 locale 字符串（格鲁吉亚语、泰米尔语等非 ASCII 字符）
- PowerShell `Set-Content` 默认用系统编码（如 Windows-1252）写入，损坏这些字符 → `SyntaxError: Unexpected identifier`
- **修复**：始终使用 Node.js `readFileSync(fp, 'utf-8')` + `writeFileSync(fp, content, 'utf-8')` 来读写 chunk 文件

### 6. `claude.bat` 找不到 Node
- `claude.bat` 使用 `%~dp0..\node-v18.20.8-win-x64\node.exe`，要求 Node.js 便携版放在 `dist/` 的 **上一级目录**
- 目录结构应为：
  ```
  D:\claude-code\
  ├── node-v18.20.8-win-x64\   # Node.js 18 便携版
  │   └── node.exe
  └── dist\                     # 构建产物 (claude.bat 所在目录)
      ├── claude.bat
      ├── cli.js
      └── chunks\
  ```
- 需要设置 `NODE_SKIP_PLATFORM_CHECK=1` 跳过 Node 18 在 Win7 上的平台检查
