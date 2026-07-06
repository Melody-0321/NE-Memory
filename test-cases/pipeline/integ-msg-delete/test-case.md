---
name: integ-msg-delete
folder: pipeline/integ-msg-delete
title: 消息删除端到端 — onMessageDeleted → rollbackByMsgIds → vault 写回
objective: 验证消息删除的完整事件链：ST 的 message_deleted 事件 → onMessageDeleted handler → rollbackByMsgIds → 删除关联 STM / 级联清理 LTM → write 写回 vault
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - ⚠ 需要 test runner 支持 postActions hook（调用 ST 内部 API 删除消息）以触发 onMessageDeleted
structural:
  - { op: exists, target: stm_events }
  - { op: exists, target: ltm_decision }
  - { op: exists, target: ltm_state }
  - { op: not_contains, target: pipeline_changes, value: "error" }
semantic:
  - "删除消息后，该消息关联的 STM 条目是否被正确移除？检查 trace —— 删除操作后的 vault 快照中 STM 计数是否减少了相应的数量。"
  - "如果被删除的消息是某个 LTM 的最后一个 stm_ref，该 LTM 是否被级联删除？检查 ltm_state —— 不应有悬空的 LTM（stm_refs 为空的 LTM 条目）。"
  - "删除操作后 vault 是否被正确写回？后续轮次的 pipeline 是否正常继续运行（无报错、无引用已删除条目的错误）？"
minRounds: 6
maxRounds: 14
expectedRounds: "8-10"
timeoutPerRound: 120000
---

# integ-msg-delete: 消息删除端到端

## 目标

验证 ST 消息删除 → NE-Memory vault 回滚的完整事件链：

1. `message_deleted` 事件正确触发 `onMessageDeleted`
2. `rollbackByMsgIds` 正确移除关联 STM
3. 级联清理 LTM（stm_refs 全部清空时删除 LTM）
4. 写回 vault 后后续 pipeline 正常运行

## 相关函数

- `onMessageDeleted` ([events.js L782-L792](file:///d:/SillyTavern\xm/ne-memory/src/adapter/events.js#L782-L792)) — ST 事件 handler
- `rollbackByMsgIds` ([store.js L276-L313](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/store.js#L276-L313)) — 移除 STM + 级联清理 LTM + 清除 stm_index 关联

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- 测试 runner 建议支持 `postActions` hook，在指定轮次后调用 ST 内部 API 删除一条消息

## 对话设计

1. 第 1-5 轮：Driver 与 AI 正常互动，积累几条 STM
2. 第 5 轮后：通过 postActions 触发消息删除（删除 1-2 条较早的用户/AI 消息）
3. 第 6-8 轮：继续正常互动，观察 vault 是否正确恢复

当 `stm_events` 和 `ltm_state` 非空、删除操作已触发后结束。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: stm_events` | STM 提取执行过 |
| 2 | `exists: ltm_decision` | LTM 决策产生 |
| 3 | `exists: ltm_state` | LTM 状态可读 |
| 4 | `not_contains: pipeline_changes [error]` | 无报错 |

### 语义性
1. 删除消息后关联 STM 是否被正确移除？
2. LTM 是否被级联删除（stm_refs 全空时）？
3. 删除后 pipeline 是否继续正常运行？

## 运行参数

- minRounds: 6
- maxRounds: 14
- expectedRounds: 8-10
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('integ-msg-delete')
```
