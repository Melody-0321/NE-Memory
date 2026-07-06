---
name: pipeline-stm-01
folder: pipeline/pipeline-stm-01
title: STM 提取质量测试
objective: 验证 STM 提取的 LLM 原始响应符合格式规范（无代词、无标识符残留、无 JSON 破碎、无编造）
preconditions:
  - NE-Memory 已初始化，副 API 可用
  - stmBatch <= 4（确保早期触发 STM 提取）
structural:
  - { op: exists, target: stm_events }
  - { op: min_length, target: stm_events, value: 1 }
  - { op: not_contains, target: pipeline_responses, value: "user:" }
  - { op: not_contains, target: pipeline_responses, value: "他" }
  - { op: not_contains, target: pipeline_responses, value: "She " }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
  - { op: contains, target: pipeline_responses, value: "\"events\"" }
semantic:
  - "STM 提取的 event 字段中是否使用了角色全名（而非代词或泛称）？"
  - "提取的事件是否覆盖了对话中明显的剧情转折点（入场、离场、关键对话、信息揭示）？"
  - "event 描述是否出现了对话中没有发生的内容（编造/幻觉）？"
  - "同一批次内的事件之间是否存在重复（两个 event 描述同一件事）？"
minRounds: 3
maxRounds: 8
expectedRounds: "4-6"
timeoutPerRound: 120000
---

# pipeline-stm-01: STM 提取质量测试

## 目标
验证 STM 提取的 LLM 原始响应质量。直接用 pipeline LLM 的 response 做字符串判定，不通过 SmartPush 间接验证。

## 前置条件
- NE-Memory 已初始化，副 API 可用
- stmBatch <= 4（确保早期触发 STM 提取）

## 对话设计（给 LLM Driver 的指导）
Driver 跟随 AI 已有故事自然互动，**不编造特定故事背景**。
Driver 可以看到 AI 的可见回复，如果 AI 的回复包含展开的思维链（`[思考过程]`），也会看到。

轮次参考：预期 4-6 轮内自然完成。低于 3 轮时 [DONE] 无效。达到 maxRounds 时强制结束。

引导策略：前 2-3 轮自然互动积累明显的剧情变化（入场、对话、事件发生）。当 STM 提取触发并产生新事件后即可结束。不需要复杂场景——简单的角色互动和对话就足够。

## 断言

### 结构性断言（代码自动检查 — 纯字符串/JSON 判定）
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: stm_events` | STM 提取成功 |
| 2 | `min_length: stm_events >= 1` | 至少 1 条新事件 |
| 3 | `not_contains: pipeline_responses [user:]` | event 无角色标识符残留 |
| 4 | `not_contains: pipeline_responses [他]` | 中文禁止代词 |
| 5 | `not_contains: pipeline_responses [She ]` | 英文禁止代词 |
| 6 | `not_contains: pipeline_responses [undefined]` | JSON 解析无破碎 |
| 7 | `contains: pipeline_responses ["events"]` | response 含正确的 JSON key |

### 语义性断言（LLM 评估 trace）
1. STM 提取的 event 字段中是否使用了角色全名（而非代词或泛称）？
2. 提取的事件是否覆盖了对话中明显的剧情转折点（入场、离场、关键对话、信息揭示）？
3. event 描述是否出现了对话中没有发生的内容（编造/幻觉）？
4. 同一批次内的事件之间是否存在重复（两个 event 描述同一件事）？

## 运行参数
- minRounds: 3
- maxRounds: 8
- expectedRounds: 4-6
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('pipeline-stm-01')
```
