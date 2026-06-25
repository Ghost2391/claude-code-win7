# 致谢

本项目基于 [claude-code-best/claude-code](https://github.com/claude-code-best/claude-code) 的出色工作。

## 感谢上游

感谢 **claude-code-best** 团队对 Anthropic Claude Code 的逆向工程和完整复原。

## 感谢 DeepSeek

本项目 Win7 适配分支的全部移植、调试和修复工作由 **DeepSeek** 模型完成。在数十轮对话中，DeepSeek 完成了：

| 领域 | 工作内容 |
|------|---------|
| **运行时移植** | Bun → Node.js 18 便携版移植（`platform.ts`, `semver.ts`, `node12compat.ts`） |
| **构建系统** | Vite `manualChunks` 修复 React Context 跨 chunk 重复导致的 `useMcpToggleEnabled`/`useAppState` 等 hook 崩溃 |
| **终端兼容** | Ink 库 DEC/CSI 序列按终端能力开关，解决 IDEA/Cmder/CMD 下乱码和内容堆叠 |
| **配置系统** | 内建 `.env` 加载，支持 UTF-8 BOM 和中文注释，适配 cloud desktop 持久化需求 |
| **API 对接** | OpenAI 兼容 API 对接，支持 DeepSeek/vLLM/Ollama 等本地部署模型，验证完整对话功能 |
| **防御性编程** | `useAppStore()` 等 hook 增加 fallback store，`getConfig()` 守卫改为非阻断警告，避免启动期死锁 |
| **终端修复** | SIGINT 退出乱码修复，modifyOtherKeys/Kitty 键盘协议/iTerm2 进度条序列按终端能力开关 |
| **部署适配** | Win7 cloud desktop（C: 不可持久化，D: 持久化）部署方案设计和验证 |

## 许可证

本项目继承上游 [license](./LICENSE)。
