---
name: pipeline-state-03
folder: pipeline/pipeline-state-03
title: State LLM 信息源验证 — Character Cards + World Book 优先提取
objective: 验证 State LLM 从 Character Cards（角色卡 description/personality/scenario）和 World Book（有未填字段时注入激活条目）直接提取 role_card 和 world_book 字段，而非等待对话提及；同时验证 State LLM 不输出属 Main LLM NE-CHAR 管理的字段（affection/current_mood/inner_thoughts）
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启
  - 角色卡可用
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: state_block_instruction }
  - { op: contains, target: state_block_instruction, value: "<!--NE-BANNER-->" }
semantic:
  - "State LLM 是否在首轮就主动从 Character Cards 中提取了静态字段？理想行为是尽早填满 gender_age/occupation/personality/clothing_build，而不等到对话中显式提及角色属性。"
  - "新角色字段是否正确使用了系统预定义的路径？检查 state_changes 中是否不存在 LLM 自创的字段名或路径——应与 Current State 表中定义的完全一致。"
  - "State LLM 是否正确遵守了职责边界——不输出 affection/current_mood/inner_thoughts？这些字段由 Main LLM NE-CHAR 增量机制管理。检查 pipeline_responses 中是否出现了这些字段名。"
minRounds: 4
maxRounds: 10
expectedRounds: "5-8"
timeoutPerRound: 120000
---

# pipeline-state-03: State LLM 信息源验证

## 目标

验证 Plan A 重构后的 State LLM 信息源机制：

1. **Character Cards 优先**：State LLM 直接从上方 `## Character Cards` 段提取 gender_age/occupation/personality/clothing_build
2. **World Book 参考**：有未填字段时补充注入激活世界书条目
3. **对话兜底**：以上两者覆盖不到的字段，再从对话推断
4. **职责边界**：State LLM 不输出 affection/current_mood/inner_thoughts（由 Main LLM NE-CHAR 管理）

## 旧测试的失效前提

旧 `pipeline-state-03` 验证的是"per-field (未填) 标记 + required/optional 分层 + no fabrication"——即 State LLM 仅从对话推断，无法推断就留空。

新架构下 State LLM 有 Character Cards + World Book 两个额外信息源，"禁止编造"被替换为"从角色卡主动提取"。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `min_length: pipeline_changes >= 1` | 有变化 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |
| 4 | `exists: state_block_instruction` | 指令已注入 |
| 5 | `contains: state_block_instruction [<!--NE-BANNER-->]` | BANNER 指令已注入 |

### 语义性
1. State LLM 是否在首轮就主动从 Character Cards 中提取了静态字段？
2. state_changes 中的字段路径是否与 Current State 表一致（无 LLM 自创路径）？
3. State LLM 是否未输出 affection/current_mood/inner_thoughts？

## 运行参数

- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-8
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-03')
```
