# 已知问题

## 终端兼容性

### ~~Cmder 下内容堆叠~~ 已修复
- **现象**：在 Cmder 终端中，`/plugin`、`/mcp` 等带选择交互的界面会出现内容逐帧叠加不消失
- **原因**：ConEmu 的 ANSI 相对光标定位 (CSI A/B/C/D) 与 Ink 虚拟光标模型漂移
- **修复**：`packages/@ant/ink/src/core/ink.tsx` — ConEmu 下每帧前发送 `ERASE_SCREEN + CURSOR_HOME` 清除旧内容
- **副作用**：可能引入轻微闪烁（因 ConEmu 不支持 DEC 2026 同步更新，无 BSU/ESU 包裹）
- **回退**：设置环境变量 `TERM_PROGRAM=anythingElse` 可绕过 ConEmu 检测

### /agent 下 ESC 无法退出
- **现象**：在 IDEA 终端下选择 /agent 后按 ESC 无反应
- **原因**：IDEA 终端 (JediTerm) 的键盘事件转发与 Ink 的 raw mode 键盘处理存在兼容差异
- **影响**：仅 IDEA 终端，无法正常退出 agent 选择
- **状态**：暂不修复，需深入 ink 键盘处理逻辑

### 部分 ANSI 序列仍可能泄露
- **现象**：Ctrl+C 强制退出时偶尔仍可见少量控制序列
- **原因**：`writeSync(1, ...)` 在进程退出临界区直接写 stdout，部分序列的终端检测函数此时已不可靠
- **影响**：仅极端情况下出现，不影响功能

## 功能限制

### 本分支禁用的功能
以下上游功能在本 Win7 分支中通过 feature flag 默认关闭且未适配：

| 功能 | 说明 |
|------|------|
| Web Search | 需联网搜索 API |
| Multimodal / Vision | 需图片处理支持 |
| Voice Mode | 需音频捕获 |
| SSH Remote | 需 SSH 连接 |
| Bridge / Remote Control | 需远程控制 server |
| Computer Use | 需截图/键鼠控制 |
| Chrome MCP | 需 Chrome 浏览器 |
| Daemon / BG Sessions | 后台会话管理 |
| Claude.ai 登录 | 需 Anthropic OAuth |

### Plugin / MCP 功能
- 基本功能可用（列表、启停 MCP server）
- 部分高级操作可能触发未被本分支测试过的代码路径
- MCP hook 使用 noop fallback，若 Provider 不在组件树中功能静默失效

### 模型支持
- 已完整测试：OpenAI 兼容 API (DeepSeek V4)
- 未测试：Gemini API、Grok API、Anthropic 直连

## 构建系统

### Bun 依赖残留
- 源码中仍引用 `import { feature } from 'bun:bundle'`（由 Vite 插件注入，构建时 DCE）
- 部分旧路径使用 `import.meta.require`（由构建插件替换为 `createRequire`）
- 直接在 Node 裸跑源码无法运行，必须经过 Vite 构建

### Vite manualChunks 维护
- `shared-state` chunk 白名单需要与代码同步维护
- 若新增 `createContext()` 或模块级可变状态导出，需手动加入 `vite.config.ts` 的白名单
- 否则会出现同类 Context 重复导致的 hook 报错

### Node 18 兼容
- 需 `scripts/patch-node16.cjs` 在构建后执行，将 RegExp `v` flag 替换为 `u`
- Node 20+ 无需此步骤
- 其他 Node 18 API (AbortSignal.any, scheduler, getDefaultHighWaterMark) 原生支持

## 安全性

### .env 管理
- `.env` 文件包含明文 API key，切勿提交到 git
- `claude.bat` 仅设置 `TERM` 环境变量，不处理 `.env`（由 `cli.tsx` 内建加载）

### PAT Token
- Git push 时使用的 Personal Access Token 应在使用后刷新
- 本分支历史中不含 token（push 通过命令行传参完成）
