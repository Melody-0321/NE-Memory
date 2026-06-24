---
name: pipeline-state-01
folder: pipeline/pipeline-state-01
title: State 管线集成测试（12 字段模板 + protagonist_name）
objective: 验证 State 管线独立健康 — 角色状态变化提取、pipeline 无报错、12 字段模板展开正确、protagonist_name 自动推断
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - State Schema 已开启（预设或动态模式均可）
  - 角色卡包含至少 2 个角色
structural:
  - { op: exists, target: pipeline_changes }
  - { op: min_length, target: pipeline_changes, value: 1 }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: stm_events }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "State 管线是否提取了对话中出现的角色的状态变化（入场/离场/状态改变）？"
  - "提取的 state_changes 是否使用了系统预定义的字段路径（status, gender_age, occupation, personality, affection 等），而非 LLM 自创的字段名？"
  - "state_changes 的 value 是否与对话中实际发生的情况一致（无编造）？对无法推断的字段是否留空而不是编造？"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# pipeline-state-01: State 管线集成测试

## 目标
验证 State 管线独立健康。自 commit `53b87af` 起，State LLM 看到完整 12 字段模板（▲/△/○/◆ 标记）、protagonist_name 从 `ctx.name2` 自动推断、`getCharacterCardType` 基于 protagonist_name 判定主角/NPC。

## 前置条件
- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- **State Schema 已开启**（预设或动态模式均可）
- 角色卡包含至少 2 个角色（确保有角色可追踪）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 5-7 轮内自然完成。低于 4 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：跟随 AI 故事，自然引入 2-3 个角色互动。让角色出现、离开、情绪变化等，给 State 管线有内容可提取。当 State pipeline 产生 changes 且 SmartPush 触发后即可结束。不需要多角色复杂剧情——几个角色出现在对话中即可。

## 断言

### 结构性断言（代码自动检查）
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: pipeline_changes` | State 管线执行过 |
| 2 | `min_length: pipeline_changes >= 1` | 有变化写入 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |
| 4 | `exists: stm_events` | 同轮 STM 提取正常（对照） |
| 5 | `not_contains: pipeline_responses [undefined]` | pipeline response 无破碎 |

### 语义性断言（LLM 评估 trace）
1. State 管线是否提取了对话中出现的角色的状态变化（入场/离场/状态改变）？
2. 提取的 state_changes 是否使用了系统预定义的字段路径（status, gender_age, occupation, personality, affection 等），而非 LLM 自创的字段名？
3. state_changes 的 value 是否与对话中实际发生的情况一致（无编造）？对无法推断的字段是否留空而不是编造？

## 运行参数
- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 说明

本测试需要 State Schema 开启（预设或动态模式均可）。如果未开启 State Schema，`pipeline_changes` 不会产生数据，结构性断言 1-2 会失败。

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-state-01')
```
