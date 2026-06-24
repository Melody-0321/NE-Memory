---
name: vault-dedup-msg
folder: pipeline/vault-dedup-msg
title: 消息去重 — filterNewMessages 拒绝已处理的 msg_id
objective: 验证 collectAllMsgIds + filterNewMessages 的去重机制：同一 msg_id 不会被 pipeline 重复处理、不会产生双倍 STM
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - ⚠ 需要 test runner 支持 preActions hook（rollback + resend）以模拟消息重复场景
structural:
  - { op: exists, target: stm_events }
  - { op: exists, target: pipeline_changes }
  - { op: not_contains, target: pipeline_changes, value: "error" }
semantic:
  - "连续多轮对话中，同一轮对话产生的消息是否只被 pipeline 处理了一次——检查 trace 中每条 STM 的 msg_ids，是否有任何 msg_id 出现在两条不同的 STM 条目中？不应该有重复。"
  - "如果测试支持 preActions（回滚+重发），被回滚后重新处理的同一 msg_id 是否在 filterNewMessages 阶段被正确拒绝——检查该轮是否没有产生任何新的 STM/LTM 条目。"
minRounds: 4
maxRounds: 10
expectedRounds: "5-7"
timeoutPerRound: 120000
---

# vault-dedup-msg: 消息去重

## 目标

验证消息去重机制的正确性：

1. **正常流程**：同一轮消息仅产生一份 STM，不会重复
2. **回滚+重处理**（需框架支持）：同一 msg_id 被回滚后重新提交时被 `filterNewMessages` 拒绝

## 相关函数

- `collectAllMsgIds` ([store.js L212-L226](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/store.js#L212-L226)) — 从所有 STM 的 msg_ids 收集已处理 ID
- `filterNewMessages` ([update.js L147-L153](file:///d:/SillyTavern\xm/ne-memory/src/core/engine/update.js#L147-L153)) — 过滤已在 processedIds 中的消息

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- 测试 runner 建议支持 `preActions` hook（在特定轮次前执行 vault 操作），以模拟回滚+重发场景

## 对话设计

Driver 与 AI 正常互动 5-7 轮即可。核心验证在 trace 分析阶段：

- 检查每条 STM 的 msg_ids，不应有跨 STM 的重复 msg_id
- 如果有 preActions 支持，在中间轮次触发回滚+重发，验证 filterNewMessages 正确拒绝

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: stm_events` | STM 提取执行过 |
| 2 | `exists: pipeline_changes` | State 管线执行过 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |

### 语义性
1. 每条 STM 的 msg_ids 是否有跨 STM 的重复？
2. 如果支持回滚重发，filterNewMessages 是否正确拒绝了已处理 ID？

## 运行参数

- minRounds: 4
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('vault-dedup-msg')
```
