# 致谢

本项目基于 [claude-code-best/claude-code](https://github.com/claude-code-best/claude-code) 的出色工作。

## 感谢上游

感谢 **claude-code-best** 团队对 Anthropic Claude Code 的逆向工程和完整复原。

## 本分支适配工作

此 Win7 分支在以下方面做了移植和适配：

| 领域 | 工作内容 |
|------|---------|
| **运行时** | Bun → Node.js 18 便携版移植（`platform.ts`, `semver.ts`, `node12compat.ts`） |
| **构建** | Vite `manualChunks` 修复 React Context 跨 chunk 重复导致的 `useMcpToggleEnabled`/`useAppState` 等 hook 崩溃 |
| **终端兼容** | Ink 库 DEC/CSI 序列按终端能力开关，解决 IDEA/Cmder/CMD 下乱码和内容堆叠问题 |
| **配置** | 内建 `.env` 加载，支持 UTF-8 BOM 和中文注释，适配 cloud desktop 持久化需求 |
| **API 兼容** | OpenAI 兼容 API 对接，支持 DeepSeek/vLLM/Ollama 等本地部署模型 |
| **防御性编程** | `useAppStore()` 等 hook 增加 fallback store，`getConfig()` 守卫改为非阻断警告，避免启动期死锁 |

## 许可证

本项目继承上游 [license](./LICENSE)。
