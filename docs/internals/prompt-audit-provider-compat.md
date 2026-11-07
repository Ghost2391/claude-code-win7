# 提示词审计报告：Provider 兼容性与 Token 成本

> 审计日期：2026-11-07
> 范围：系统提示（`src/constants/prompts.ts`）+ 内置工具描述（`packages/builtin-tools`）
> 目标：在 DeepSeek / OpenAI 兼容 provider 下剔除无效或误导性指令，并评估 token 成本。
>
> **状态：批次 A + B 已实施（见第七节）。** 报告正文保留审计时的原始判断，便于对照。

## 一、基线数据

### 1.1 系统提示

采集方式：`FEATURE_DUMP_SYSTEM_PROMPT=1 bun run dev -- --dump-system-prompt`
（工具列表为空，因此不含工具描述）

| 段落 | 字符数 | 占比 |
|------|-------:|-----:|
| 前言（身份 + 安全 + URL 规则） | 835 | 3.3% |
| `# System` | 3,241 | 13.0% |
| `# Doing tasks` | 7,184 | 28.8% |
| `# Executing actions with care` | 2,833 | 11.4% |
| `# Using your tools` | 630 | 2.5% |
| `# Communication style` | 2,210 | 8.9% |
| `# auto memory` | 6,424 | 25.8% |
| `# Environment` | 1,573 | 6.3% |
| **合计** | **24,930** | 100% |

按英文 ~3.5 字符/token 估算：**约 6.5k–7.5k tokens**，每轮对话都会完整发送。

### 1.2 工具描述（渲染后字符串，不含 JSON Schema）

| 工具 | 字符数 | 估算 tokens |
|------|-------:|------------:|
| Bash | 9,745 | ~2,800 |
| TodoWrite | 9,114 | ~2,600 |
| Agent | ~8,000+（含 agent 列表，随配置变化） | ~2,300+ |
| SearchExtraTools | 2,272 | ~650 |
| ExecuteExtraTool | 1,589 | ~450 |
| FileRead | 1,467 | ~420 |
| FileEdit | 1,270 | ~360 |
| Skill | 1,272 | ~360 |
| AskUserQuestion | 1,074 | ~310 |
| WebFetch | 545 | ~160 |
| 其余工具（Glob/Grep/Write/WebSearch/Notebook/Task*/Cron* 等） | 合计约 8,000 | ~2,300 |

工具描述合计约 **30k 字符 ≈ 8.5k tokens**，再加各工具 JSON Schema（约 3k–5k tokens）。
**结论：每轮请求的固定开销约 15k–20k tokens**，长会话下这是主要的成本与注意力负担来源。

## 二、有效性筛查：问题清单

严重度定义：
- **高**：指令与运行时能力不一致，会直接导致模型调用不存在的工具或误解机制。
- **中**：浪费 token / 与当前 provider 无关 / 与其它指令冲突。
- **低**：措辞与品牌问题，不影响正确性。

### 问题 1【高】SearchExtraTools 机制说明未与运行时门控同步

`src/constants/prompts.ts:185 getSimpleSystemSection()` 无条件注入：

> "Your tool list has two categories: core tools (...) Additional tools (deferred tools, MCP tools, skills) are NOT in your tool list and must be discovered via SearchExtraTools first..."

但实际是否启用由 `isSearchExtraToolsEnabled()`（`src/utils/searchExtraTools.ts`）按 MCP 工具数量、provider、环境变量动态决定，且 `SearchExtraTools`/`ExecuteExtraTool` 均可被移除。门控关闭时，这段文字会让模型去调用不存在的工具。

影响：约 **900 tokens**；在门控关闭的会话中属于纯误导。

### 问题 2【中】"Using your tools" 的核心工具清单是硬编码的

`getUsingYourToolsSection()`（`prompts.ts:258`）固定列出 22 个工具名，其中：

- `Config` 仅在 `USER_TYPE === 'ant'` 时注册（`src/tools.ts:242`）
- `LSP` 仅在 `ENABLE_LSP_TOOL=1` 时注册（`src/tools.ts:253`）
- `Cron*`、`NotebookEdit`、`MCPTool` 等也在不同条件下才可用

函数虽然接收 `enabledTools`，却只用它挑选任务工具名。模型可能据此认为不存在的工具可用。

影响：约 **110 tokens**，但错误率影响高于 token 成本。

### 问题 3【中】环境段落包含无关的产品/模型/快速模式说明

`computeSimpleEnvInfo()`（`prompts.ts:645-655`）无条件追加三行：

1. 最新 Claude 模型家族与 Model ID（引导构建 AI 应用时使用 Claude）
2. Claude Code 的可用形态（CLI / 桌面 / Web / IDE / Chrome / Excel / Cowork）
3. "Fast mode for Claude Code uses the same Claude Opus 4.7 model..."

在 DeepSeek provider 下，第 1、2 行基本无关，第 3 行是**错误的能力暗示**（DeepSeek 无 fast mode，`/fast` 无效）。

影响：约 **430 字符 ≈ 120 tokens**，每轮发送。

### 问题 4【中】双任务系统并存 + TodoWrite 描述过长

- `TodoWriteTool` 始终注册（`src/tools.ts:234`），`TaskCreate/Get/Update/List` 在 `isTodoV2Enabled()` 时额外注册。
- TodoWrite 的描述 9,114 字符，其中 **超过一半是 `<example>` 与 `<reasoning>`**（即"为什么要用 todo"的示范对话）。
- 系统提示同时鼓励两套用法，模型会在两套工具间摇摆。

影响：约 **2,600 tokens/轮**；建议按 TODO v2 开关只保留一套提示。

### 问题 5【中】Bash 工具描述体积（9.7k 字符）

`getSimplePrompt()` 中包含大段 git commit / PR 流程。对本项目（用户多为 DeepSeek，上下文更宝贵）可考虑：

- 保留命令规范与安全约束
- 将 git commit/PR 流程改为按需（`/commit` 技能）或压缩为要点

影响：约 **2,800 tokens/轮**，是单项最大。

### 问题 6【低】品牌与措辞

- 多处工具描述以 "Allows Claude to..." 开头（WebSearch 等），对非 Anthropic 模型无意义但无害。
- `WebFetchTool` 描述建议"若有 MCP 抓取工具优先使用 MCP"——在无 MCP 的配置下无用，可条件化。

### 问题 7【低】已修复项

`WebSearchTool/prompt.ts` 原写"搜索仅在 US 可用"、"结果在单次 API 调用内返回"，与客户端适配器（Tavily/Bing/DuckDuckGo/Exa/Brave）不符，已在上一轮修正。

## 三、不建议改动的部分

以下内容与 provider 无关、且对行为质量有正向作用，建议保留原文案：

- 前言中的安全/拒绝/URL 规则（`CYBER_RISK_INSTRUCTION`）
- `# Doing tasks` 的代码质量约束（注释、范围控制、验证要求）
- `# Executing actions with care` 的风险分级与确认规则
- `# auto memory` 的存储规范（6.4k 字符，占比高但属于核心能力）
- 工具结果注入防护（prompt injection 提示）

## 四、后续实施建议（分三批，独立提交）

### 批次 A：修正无效指令（低风险）

1. `getSimpleSystemSection`：按 `isSearchExtraToolsEnabled()` 的结果选择文案；关闭时删除两分类叙述。
2. `getUsingYourToolsSection`：改为用 `enabledTools` 过滤后生成工具清单。
3. `computeSimpleEnvInfo`：
   - "最新 Claude 模型家族"一行仅在 provider 为 firstParty / bedrock / vertex / foundry 时输出；
   - "Fast mode"一行仅在 `isFastModeSupportedByModel(model)` 时输出；
   - "Claude Code 可用形态"一行可保留（产品事实）或降级为一行。

预期收益：-1.5k chars（约 -430 tokens），消除 3 处指令与能力不一致。

### 批次 B：按 provider / 模式裁剪（中风险，需回归验证）

4. TODO：`isTodoV2Enabled()` 为真时不注入 TodoWrite 的示例段落；为假时不注入 Task* 工具。
5. Bash 描述：提供 `CLAUDE_CODE_SIMPLE=1` 风格的精简版（去 git 长文，保留安全约束）。
6. WebFetch 的"MCP 优先"提示仅在存在 MCP fetch 工具时输出。

预期收益：-6k~-10k chars（约 -1.7k~-2.8k tokens）/轮。

### 批次 C：长段落压缩（中高风险）

7. `# Doing tasks`（7.2k chars）与 `# auto memory`（6.4k chars）压缩：仅在 A/B 验证显示行为无退化后进行。

## 五、验收与回滚

- **基线对比**：`FEATURE_DUMP_SYSTEM_PROMPT=1 bun run dev -- --dump-system-prompt`，记录字符数差异
- **回归集**：准备 5~10 个典型任务（文件修改、搜索、重构、解释、多文件修复），对比 A/B 行为
- **自动化**：`bun run precheck`；`src/constants/promptEngineeringAudit.runner.ts` 的断言需同步更新
- **回滚**：每批独立 commit，行为异常可单独 revert；环境变量层面可临时以 `CLAUDE_CODE_SIMPLE` 等开关恢复

## 六、批次 A + B 实施记录（2026-11-07）

| 项 | 实施 | 位置 |
|----|------|------|
| A1 | SearchExtraTools 两分类叙述改为按 `isSearchExtraToolsEnabledOptimistic()` 选择；关闭时改为"工具列表即全部能力" | `prompts.ts getSimpleSystemSection` |
| A2 | "Using your tools" 的工具清单改为 `CORE_TOOL_NAME_CANDIDATES ∩ enabledTools`，不再列出未注册工具 | `prompts.ts getUsingYourToolsSection` |
| A3 | 环境段落：Claude 模型 ID 行仅在 Anthropic 系 provider 输出；Fast mode 行仅在 opus-4-6/4-7 且未禁用时输出 | `prompts.ts computeSimpleEnvInfo` |
| B4 | Todo-V2 启用时 TodoWrite 使用无示例的精简描述 | `TodoWriteTool/prompt.ts COMPACT_PROMPT` |
| B5 | `CLAUDE_CODE_COMPACT_BASH_PROMPT=1` 时为 Bash 提供精简 git 指引（保留安全协议与提交信息格式） | `BashTool/prompt.ts` |
| B6 | 未实施：WebFetch "优先用 MCP 抓取" 只有一行且带条件语，收益小于改动风险 | — |

### 实测收益

| 项 | 改前 | 改后 | 节省 |
|----|-----:|-----:|-----:|
| 系统提示（本机 firstParty） | 24,930 字符 | 24,577 字符 | -353 |
| 其中非 Anthropic provider 再省 | — | — | 约 -280 |
| TodoWrite 描述（交互式会话默认命中） | 9,114 字符 | 3,288 字符 | -5,826（≈-1.7k tokens） |
| Bash 描述（需开启 `CLAUDE_CODE_COMPACT_BASH_PROMPT=1`） | 9,745 字符 | 4,639 字符 | -5,106（≈-1.4k tokens） |

默认配置下（不改环境变量）每轮约节省 **1.7k tokens**；开启 Bash 精简后再省约 **1.4k tokens**。

### 缓存命中率影响（结论：不影响）

- 所有条件分支只依赖**会话级稳定配置**：provider 类型、模型 ID、环境变量、工具注册表。同一会话内每轮生成的提示文本逐字节一致。
- 已实测：连续两次 `--dump-system-prompt` 输出完全相同。
- 没有引入任何依赖"MCP 连接状态/消息数量/时间"的提示分支。唯一与工具集合相关的 A2 使用的是 `CORE_TOOL_NAME_CANDIDATES`（无条件注册的核心工具），MCP 工具增删不会改变这段文本。
- 反例防范：`WebFetchTool.prompt()` 中已有注释说明——按 SearchExtraTools 可用性切换描述会导致缓存反复失效（每次切换两次 miss），本次改动遵循了同一约束。

### 验证

- `tsc --noEmit`：零错误
- `bun test ./src/constants/promptEngineeringAudit.runner.ts`：62 pass
- `bun test src/constants/__tests__/`：11 pass
- 已知既有问题（与本次改动无关）：`tools.test.ts` + `systemPrompt.test.ts` 同进程运行时的 growthbook 局部 mock 污染（改动前后均复现）

## 七、附：复现方式

```bash
# 1. 导出系统提示（需先把 DUMP_SYSTEM_PROMPT 特性打开）
FEATURE_DUMP_SYSTEM_PROMPT=1 bun run dev -- --dump-system-prompt > sysprompt.txt

# 2. 统计各段落
#    见本报告第一节表格的统计脚本（按 ^# 标题切分）

# 3. 导出工具描述
bun /tmp/dump_tools.ts   # 逐个 import 工具的 prompt 模块并采样函数返回值
```
