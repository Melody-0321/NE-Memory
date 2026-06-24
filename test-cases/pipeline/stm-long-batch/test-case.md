---
name: stm-long-batch
folder: pipeline/stm-long-batch
title: STM 长时间线批量提取 — Phase 2 batch pipeline 稳定性
objective: 验证长时间线（10-15 轮）下 Phase 2 批量摘要管道不超时、不溢出、分批正确 —— 多个 segment 被正确批量处理，每个 segment 产生恰好 1 条 STM
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - stmBatch 默认值（10）或自动模式，确保管道批量触发
structural:
  - { op: exists, target: stm_events }
  - { op: min_length, target: stm_events, value: 2 }
  - { op: exists, target: pipeline_changes }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: not_contains, target: pipeline_responses, value: "undefined" }
semantic:
  - "Phase 2 批量摘要是否成功处理了所有 segment？检查 pipeline_responses——每个 segment 是否产生了恰好 1 条 STM event（而非丢失或重复）？"
  - "pipeline 调用是否在任意一轮超时或失败？检查 trace 中是否有 pipeline error 或空响应——长时间线不应导致 Phase 2 token 溢出。"
  - "STM events 的 event 文本是否聚焦于该 segment 内的内容，不跨 segment 引用？检查各条 STM 的 content 是否包含了来自其他 segment 的信息。"
minRounds: 10
maxRounds: 20
expectedRounds: "12-16"
timeoutPerRound: 120000
---

# stm-long-batch: STM 长时间线批量提取

## 目标

验证长时间线对话下 Phase 2 批量摘要管道的稳定性：

1. **不超时**：pipeline 调用在批量处理多 segment 时不超时
2. **不溢出**：Phase 2 LLM prompt token 不超出 max_tokens 限制
3. **分批正确**：多个 segment 被正确处理，每个 segment 产出 1 条 STM

## 相关函数

- `processTurnsInBatches` ([stm-extractor.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/stm-extractor.js)) — Phase 2 批量摘要主循环
- `computeStmBatch` ([params.js L69-L71](file:///d:/SillyTavern/xm/ne-memory/src/core/params.js#L69-L71)) — 自动 batch size 计算：`round(4 × turnsPerEvent)`，钳制 [3,6]
- `getStmBatchSize` ([events.js L84-L96](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L84-L96)) — 从 settings 读取或自动计算

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- stmBatch 默认值或自动模式

## 对话设计

Driver 与 AI 进行较长时间线的自然互动（12-16 轮），不需要刻意构造场景切换或复杂剧情。正常聊天、自然推进即可。

关键：轮次数量要超过 batch size，确保管道被批量触发（非每轮单独触发）。

当 `stm_events` 至少有 2 条且至少触发了一次批量管道调用后结束。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: stm_events` | STM 提取执行过 |
| 2 | `min_length: stm_events >= 2` | 至少 2 个 segment |
| 3 | `exists: pipeline_changes` | State 管线正常 |
| 4 | `not_contains: pipeline_changes [error]` | 无报错 |
| 5 | `not_contains: pipeline_responses [undefined]` | 无 JSON 破碎 |

### 语义性
1. Phase 2 是否成功处理了所有 segment（每个 segment 1 条 STM）？
2. 有无 pipeline 超时/失败（空响应或 error）？
3. STM event 文本是否聚焦各自 segment，不跨 segment 引用？

## 运行参数

- minRounds: 10
- maxRounds: 20
- expectedRounds: 12-16
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('stm-long-batch')
```
