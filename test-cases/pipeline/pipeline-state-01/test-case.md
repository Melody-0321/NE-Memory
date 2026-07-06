---
name: pipeline-state-01
folder: pipeline/pipeline-state-01
title: State 管线架构验证 — Main LLM NE-CHAR 增量 + State LLM 静态字段
objective: 验证新架构下三类职责分工：Main LLM 每轮输出 affection_delta/current_mood/inner_thoughts（NE-CHAR 增量）；State LLM 管理 gender_age/occupation/personality/clothing_build/status 等静态字段；State LLM 不输出 affection/current_mood/inner_thoughts
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启
  - 角色卡包含至少 2 个角色
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: stm_events }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "State LLM 是否从 Character Cards 和 World Book 上下文中提取了静态字段（gender_age/occupation/personality），而不是仅依赖对话文本推断？理想行为是首轮就填入多个字段，而非等到对话中显式提及。"
  - "State LLM 的 state_changes 输出是否不包含 affection_delta/current_mood/inner_thoughts？这些字段由 Main LLM 的 NE-CHAR 增量机制管理，State LLM 不应触碰。检查 pipeline_responses 中是否出现了这些字段名。"
  - "NE-CHAR 监测日志 [NE-CHAR-MONITOR] 是否正确剥离了所有 NE-CHAR 块（包含 affection_delta 等字段）？剥离数量应与原始标签数一致。"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# pipeline-state-01: State 管线架构验证

## 目标

验证 Plan A+B 重构后的新架构：

1. **Main LLM NE-CHAR 增量**：每轮输出活跃角色（有台词或互动）的 affection_delta/current_mood/inner_thoughts
2. **State LLM 静态字段**：管理 gender_age/occupation/personality/clothing_build/status/injuries/status_effects/relationship/past_experience
3. **职责边界**：State LLM **绝不输出** affection/current_mood/inner_thoughts — 这些由 Main LLM 的 NE-CHAR 独占
4. **信息源**：State LLM 从 Character Cards + World Book（有未填字段时注入）提取初始值

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- State Schema 已开启
- 角色卡包含至少 2 个角色

## 对话设计

Driver 跟随 AI 已有故事自然互动，不编造特定故事背景。

轮次参考：预期 5-7 轮。引导自然引入 2-3 个角色互动即可。当 pipeline 有 changes 且 NE-CHAR 监测日志出现时结束。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `min_length: pipeline_changes >= 1` | 有变化写入 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |
| 4 | `exists: stm_events` | 同轮 STM 正常（对照） |
| 5 | `not_contains: pipeline_responses [undefined]` | pipeline response 完整 |

### 语义性
1. State LLM 是否从 Character Cards 和 World Book 上下文中提取了静态字段？
2. state_changes 是否不包含 affection/current_mood/inner_thoughts（由 Main LLM 管理）？
3. NE-CHAR 监测日志是否记录了正确的块剥离数和标签数？

## 运行参数

- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-01')
```
