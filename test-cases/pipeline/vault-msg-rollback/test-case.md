---
name: vault-msg-rollback
folder: pipeline/vault-msg-rollback
title: 消息回滚 — rollbackByMsgIds 移除 STM + 级联清理 LTM
objective: 验证 rollbackByMsgIds 的三级清理：STM 移除 → LTM stm_refs 清理 → 空 LTM 删除 → stm_index 关联清除
preconditions:
  - NE-Memory 已初始化，SmartPush 启用
  - 副 API 可用
  - ⚠ 需要 test runner 支持 preActions hook（在某轮前直接调用 rollbackByMsgIds + write）以模拟部分回滚场景
structural:
  - { op: exists, target: stm_events }
  - { op: exists, target: ltm_state }
  - { op: not_contains, target: pipeline_changes, value: "error" }
semantic:
  - "在部分 STM 条目被回滚后，剩余的 STM 计数是否正确（回滚 2 条中的 1 条 → 剩余 1 条）？检查 vault 快照中 unconsolidated_stm 和 stm_entries 的总计数。"
  - "如果回滚的 STM 有 parent_ltm，stm_index 中的 ltm_id 关联是否被正确清除（不应有指向不存在 LTM 的悬空引用）？"
  - "如果回滚的 STM 是某个 LTM 的最后一个 ref，该 LTM 是否被自动删除（不留下 stm_refs 为空的 LTM）？"
minRounds: 6
maxRounds: 14
expectedRounds: "8-10"
timeoutPerRound: 120000
---

# vault-msg-rollback: 消息回滚

## 目标

验证 `rollbackByMsgIds` 的三级清理逻辑：

1. **STM 移除**：包含指定 msg_id 的 STM 条目被正确移除
2. **LTM stm_refs 清理**：被移除 STM 的 ref 从对应 LTM 中清除
3. **空 LTM 删除**：stm_refs 全部清空的 LTM 被自动删除
4. **stm_index 关联清除**：被移除 STM 的 ltm_id 关联从 stm_index 中清除

## 相关函数

- `rollbackByMsgIds` ([store.js L276-L313](file:///d:/SillyTavern\xm/ne-memory/src/core/vault/store.js#L276-L313)) — 三级清理核心函数
- 调用链：`onMessageDeleted` / `onMessageSwiped` / `onMessageUpdated` → `rollbackByMsgIds` → `write`

## 前置条件

- NE-Memory 已初始化，SmartPush 启用
- 副 API 可用
- 测试 runner 建议支持 `preActions` hook（在指定轮次前直接调用 `rollbackByMsgIds` + `write`）

## 对话设计

1. 第 1-5 轮：Driver 与 AI 正常互动，积累多条 STM，触发 LTM 合并（生成 LTM 条目）
2. 第 5 轮后：通过 preActions 调用 `rollbackByMsgIds` 回滚部分 STM（如删除 2 条消息）
3. 第 6-8 轮：继续正常互动，验证后续 pipeline 正常运行

当 STM 积累 ≥ 3 条且 LTM 生成后，触发回滚操作并验证结果。

## 断言

### 结构性
| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: stm_events` | STM 提取执行过 |
| 2 | `exists: ltm_state` | LTM 状态可读 |
| 3 | `not_contains: pipeline_changes [error]` | 无报错 |

### 语义性
1. 回滚后 STM 计数是否正确（减少了被移除的条目）？
2. stm_index 中是否有悬空的 ltm_id 关联？
3. 空 stm_refs 的 LTM 是否被自动删除？

## 运行参数

- minRounds: 6
- maxRounds: 14
- expectedRounds: 8-10
- timeoutPerRound: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('vault-msg-rollback')
```
