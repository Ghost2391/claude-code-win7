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
将 `node-v18.20.8-win-x64` 解压到 `D:\claude-code\node\`，确保 `D:\claude-code\node\node.exe` 存在。

**3. 配置 API**
复制 `.env.example` 为 `.env`，填入实际值：
```ini
CLAUDE_CODE_USE_OPENAI=1
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=http://your-api-host:port/v1
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
| `src/entrypoints/cli.tsx` | 内建 `.env` 加载（支持 UTF-8 BOM + 中文注释）；提前调用 `enableConfigs()` |
| `src/utils/platform.ts` | Bun → Node 平台适配 |
| `src/utils/semver.ts` | 移除 Bun 依赖 |
| `src/utils/node12compat.ts` | Node 12/18 polyfills |
| `packages/@ant/ink/src/core/termio/dec.ts` | 可选 DEC 模式按终端能力开关，避免 IDEA/CMD 乱码 |
| `packages/@ant/ink/src/components/App.tsx` | 扩展键盘序列按终端能力开关 |
| `packages/@ant/ink/src/core/ink.tsx` | 清理序列按终端能力开关 |
| `scripts/patch-node16.cjs` | 构建后 RegExp v flag → u flag 兼容补丁 |
