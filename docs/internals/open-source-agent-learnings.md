# 开源编码智能体调研：可借鉴的能力清单

> 调研日期：2026-11-07
> 目的：对照本仓库现状，找出值得借鉴、且能落到具体文件的设计。
> 结论来自公开资料与该 codebase 的代码核对；标记「推断」的条目未在本仓库验证。

## 一、横向对比（2026 年公开资料摘要）

| 智能体 | 语言/许可 | 架构特征 | 安全边界 |
|--------|-----------|----------|----------|
| OpenCode | TypeScript / MIT | SQLite 追加式消息-片段树（12 种 part 类型）；client-server 拆分；`stats` 成本报表；Build + 只读 Plan 双 agent | 每工具策略批准（一次/总是/拒绝），无 OS 沙箱 |
| Aider | Python / Apache-2.0 | Git 原生逐次自动提交；repo map；Architect/Editor 双模型分工；两列表（cur/done）破坏式摘要 | 人审即边界 |
| Cline | TypeScript / Apache-2.0 | shadow-git CheckpointTracker（每步快照、diff 回滚）；Plan/Act 模式；双消息列表（API 用 / UI 用） | 最细粒度：按工具+按命令模式批准，拦截危险 shell 操作符 |
| Goose | Rust / Apache-2.0 | 70+ MCP 扩展；YAML recipe | 手动批准可选 |
| OpenHands | MIT | 容器内 FastAPI action server + 宿主控制器（HTTP 边界）；事件溯源 EventStream，压缩用 condensation marker | Docker 沙箱为主边界 |

行业观察（十一套生产 harness 的源码研究）：
- **没有一个 runtime 引入通用 agent 框架**，也没有用向量检索做代码检索——都是手写 async loop + 确定性检索。
- Skills 的采用率（9/11）高于 MCP（8/11）；ACP 已在 6 个系统落地。
- 行为策略正从「提示词散文」迁移到「配置」。

参考：[Inside the Scaffold (arXiv)](https://arxiv.org/html/2604.03515#4)、
[Harness Engineering (arXiv)](https://arxiv.org/abs/2609.00006v1#1)、
[FutureAGI 对比](https://futureagi.com/blog/best-agent-harness/)、
[AI Solutions Wiki](https://ai-solutions.wiki/comparisons/open-source-coding-agents/)。

## 二、本仓库现状核对

| 能力 | 本仓库状态 | 位置 |
|------|-----------|------|
| Agent 主循环 | 自研 async loop（与行业一致） | `src/query.ts`、`src/QueryEngine.ts` |
| 文件检查点 | 有，但为**整文件备份**，上限 20 个，注释标明内存问题 | `src/utils/fileHistory.ts:54` |
| 回滚 | `/rewind` 命令 | `src/commands/rewind/` |
| 沙箱 | 有，封装 `@anthropic-ai/sandbox-runtime` | `src/utils/sandbox/sandbox-adapter.ts` |
| 权限 | 规则解析 + 只读命令校验 + 分类器 | `src/utils/permissions/` |
| 计划模式 | EnterPlanMode / ExitPlanMode + Explore agent | `packages/builtin-tools/.../EnterPlanModeTool` |
| 工具延迟加载 | SearchExtraTools + TF-IDF 索引 | `src/services/searchExtraTools/` |
| 会话持久化 | JSONL transcript | `docs/internals/session-transcript-persistence.md` |
| 成本可见性 | `/cost`、`/usage`、`/stats` | `src/commands/cost|usage|stats` |
| Repo map | **无** | — |
| 双模型分工 | 部分（advisorModel、verification agent、small fast model） | `src/services/api/claude.ts` |

## 三、值得借鉴的清单（按投入产出排序）

### 1. 增量文件快照（借鉴 Cline shadow-git）—— 高价值

**现状**：`fileHistory.ts` 每次快照对整个文件做备份，`MAX_SNAPSHOTS = 20`，注释写着「内存无界增长，改为增量 diff 后再启用」。

**做法**：内容寻址存储——按文件内容 sha256 去重，快照只存 `path → blobHash` 映射；删除某次快照时释放无引用的 blob。或直接用一个 shadow git 仓库（不进主仓库历史）做 `git stash create` 式快照。

**收益**：把内存从 O(快照数 × 文件大小) 降到 O(唯一内容大小)，可以恢复更多回滚点；`/rewind` 的粒度也能从「每轮」细化到「每次工具调用」。

### 2. 只读 Plan agent 的工具裁剪（借鉴 OpenCode）—— 中等价值

**现状**：已有 Explore agent 与计划模式，但工具 schema 仍按全量注入。

**做法**：计划/探索阶段按"只读工具集"生成 tools 数组，写工具（Edit/Write/Bash 写路径）不进 schema。

**收益**：降低探索阶段的 token 开销，天然降低误写风险；和现有 `CORE_TOOLS` 延迟加载机制可以复用同一套过滤逻辑。

### 3. 危险 shell 组合拦截（借鉴 Cline）—— 中等价值

**现状**：`permissions/readOnlyCommandValidation.ts` + 规则解析已存在。

**做法**：补一层「组合操作符审计」：`|`、`&&`、`;`、`$(...)`、反引号、重定向到敏感路径、`xargs` 链。只读命令判定不能只看首个 token。

**收益**：减少「看着只读、实际有副作用」的命令被自动放行。

### 4. 压缩保留审计链（借鉴 OpenHands condensation marker）—— 中等价值

**现状**：`services/compact/` 有自动压缩与微压缩，压缩后旧消息被替换。

**做法**：压缩时保留摘要 + 被压缩区间指针（marker），而非直接丢弃；`/rewind` 或审计时可回溯原文。

**收益**：排障与合规可追溯；对长会话的「我明明说过」类体验有帮助。

### 5. 轻量 Repo Map（借鉴 Aider）—— 中高价值但需评估

**现状**：没有 repo map；检索靠 Grep/Glob 与外部 CodeGraph。

**做法**：会话启动时生成「文件树 + 顶层符号摘要 + 最近改动 + 依赖边」的紧凑地图（几百 token），按需注入。

**收益**：减少探索轮次的往返；对上下文敏感的小模型收益更明显（本仓库主要面向 DeepSeek 等自定义 provider）。

**风险**：地图本身占 token，需要按项目规模阈值启用；与 CodeGraph 索引有重叠，建议复用其符号数据而不是另建。

### 6. 模型分工策略化（借鉴 Aider Architect/Editor）—— 中等价值

**现状**：已有 advisorModel / verification agent / small fast model，但选择逻辑散落。

**做法**：抽一层 `ModelPolicy`：规划、编辑、验证、摘要各自由哪种模型执行，可配置（本地小模型做摘要/分类，大模型做编辑）。

**收益**：成本与质量可调；与现有 providerProfiles 天然契合。

### 7. MCP schema 成本的持续治理 —— 已走在前面，可继续

行业调研里 MCP 全量加载是主要成本来源之一。本仓库的 SearchExtraTools（延迟加载 + TF-IDF 检索）已经是正确方向。可继续做：按 server 粒度延迟、schema 去重、连接时只加载名字。

### 8. 行业共识验证（不必改）

- 不引入通用 agent 框架 —— 本仓库一致。
- 不用向量检索做代码检索 —— 本仓库一致（TF-IDF + grep）。
- Skills 优先于 MCP —— 本仓库 skills 体系完善，可把常用 MCP 流程封装成 skill。

## 四、建议的下一步

| 优先级 | 事项 | 状态 |
|--------|------|------|
| P0 | 内容寻址快照替代「按文件+版本」全量备份 | **已完成**（2026-11-07，见下） |
| P1 | 探索阶段只读工具裁剪 | 小（复用 CORE_TOOLS 过滤） |
| P1 | shell 组合操作符审计 | 小（`readOnlyCommandValidation.ts`） |
| P2 | 压缩审计链 | 中（compact 模块） |
| P2 | ModelPolicy 配置化 | 中 |
| P3 | Repo Map（先与 CodeGraph 对齐再评估） | 大 |

### P0 实施记录（2026-11-07）

- 新增 `src/utils/fileHistoryBlobs.ts`：sha256 流式哈希、`b<64-hex>` 内容寻址命名、临时文件 + rename 的原子落盘、跨文件/跨版本去重。
- `fileHistory.ts`：备份名改为内容哈希；`FileHistoryBackup` 增加可选 `mode`（共享 blob 无法承载每个文件的权限）；变更检测对 blob 走「大小 + 哈希」分支（不再使用对共享 blob 无效的 mtime 捷径）；恢复时优先用记录中的 mode。
- 向后兼容：旧会话的 `{pathHash16}@v{n}` 备份名仍走原有比较逻辑，可正常恢复。
- 测试：`src/utils/__tests__/fileHistoryBlobs.test.ts`（13 项）；另用临时脚本验证了「快照 → 编辑 → 回滚」端到端，以及「重复内容不新增 blob」。
- 边界：连续不同版本仍是各自一份内容（未做 delta 压缩）；若后续要 Cline 级别的压缩率，需要 shadow-git/打包存储。
