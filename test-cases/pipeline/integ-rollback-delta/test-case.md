---
name: integ-rollback-delta
folder: pipeline/integ-rollback-delta
title: 消息删除 → Delta 版本回退（端到端）
objective: 验证消息删除时 rollbackByMessageDates 能正确匹配 Pipeline Log 中的 message_dates，回退到对应版本的 State/Memory，且回退后版本链完整
preconditions:
  - NE-Memory 已初始化，SmartPush 启用，State Schema 已开启
  - 副 API 可用
  - 已通过多轮对话产生至少 3 次 State delta 和 2 次 Memory version
  - ⚠ 需要 test runner preActions hook：在指定轮次前通过 SillyTavern UI 删除一条消息，触发 onMessageDeleted → rollbackByMessageDates
structural:
  - { op: exists, target: state_delta_count }
  - { op: min_length, target: state_delta_count, value: 1 }
  - { op: exists, target: memory_version_count }
  - { op: not_contains, target: pipeline_changes, value: "error" }
  - { op: exists, target: rollback_triggered }
semantic:
  - "State 版本历史面板中，被删除消息对应的 delta 是否标记为已回退或消失？版本链的 state_head_seq 是否回退到了目标 seq？"
  - "memory_versions 中，被删除消息对应的 version（通过 message_dates 匹配）是否被回退移除？"
  - "回退操作后，后续轮次的 AI State 更新是否仍能正常产生新 delta（seq 连续性不中断）？"
  - "回退操作不会误删其他消息对应的 delta/version（只回退与被删消息 message_dates 有交集的记录）？"
  - "orphaned_branches 中有被回退的版本记录，且可通过版本历史面板的 → 按钮恢复？"
minRounds: 8
maxRounds: 16
expectedRounds: "10-12"
timeoutPerRound: 120000
---

# integ-rollback-delta: 消息删除后 Delta 版本回退端到端测试

## 目标

验证 P2 精确回退系统的完整链路：

```
消息删除 (SillyTavern UI)
  → onMessageDeleted 事件
  → _handleMessageRollback (events.js)
    → vault msg_ids vs Pipeline Log message_dates 对比
    → 找到被删消息对应的 delta/version（by send_date 匹配）
    → rollbackState(targetSeq) + rollbackMemory(targetSeq)
    → 版本历史面板展示回退结果
  → 后续轮次：AI State 更新正常，seq 连续
```

## 涉及的模块

| 模块 | 文件 | 关键函数 |
|------|------|----------|
| 消息 ID | [msg-id.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/msg-id.js) | `buildMsgId(m, idx)` — 生成 `idx_send_date_role` 格式 |
| 事件适配 | [events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js) | `rollbackByMessageDates()` — Pipeline Log 查询 + 回退 |
| Delta 引擎 | [state-versions.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/state-versions.js) | `recordStateDelta`, `recordMemoryVersion`, `rollbackState`, `rollbackMemory`, `restoreBranch` |
| Schema 变更 | [schema.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/schema.js) | `mergeStateChanges` 返回 `{state, changes}` 含 `message_dates` |
| 版本面板 | [panel-version-history.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/panel-version-history.js) | UI 时间线展示 + ←→ 导航 |

## 前置条件

- NE-Memory 已初始化，SmartPush 启用，State Schema 已开启
- 副 API 可用
- 已通过多轮对话积累至少 3 次 State delta 和 2 次 Memory version

## 对话设计（给 LLM Driver 的指导）

**测试策略（不编造故事背景，自然跟随 AI）：**

1. **第 1-7 轮（积累期）**：Driver 跟随 AI 故事自然互动，持续引入新情节发展、新角色、状态变化，积累多条 State Delta 和 Memory Version。

2. **第 7 轮后（删除触发点）**：通过 `preActions` hook 或手动操作，在 SillyTavern UI 中删除第 5 或第 6 轮的用户消息。这会触发 `onMessageDeleted` → `_handleMessageRollback` → `rollbackByMessageDates`。

3. **第 8-12 轮（验证期）**：继续正常对话，验证：
   - 回退后 State 是否恢复到删除消息前的状态
   - 后续 AI State 更新是否正常（新 delta 产生）
   - 版本历史面板中是否有回退记录

4. **第 12-14 轮（恢复期）**：在版本历史面板中点击 → 按钮恢复被回退的分支，验证恢复后状态正确。

## 断言

### 结构性断言

| # | 断言 | 含义 |
|---|------|------|
| 1 | `exists: state_delta_count` | State delta 记录有产生 |
| 2 | `min_length: state_delta_count >= 1` | 至少 1 条 delta（回退后仍保留未删版本） |
| 3 | `exists: memory_version_count` | Memory version 记录有产生 |
| 4 | `not_contains: pipeline_changes [error]` | 无 pipeline 报错 |
| 5 | `exists: rollback_triggered` | rollbackByMessageDates 至少触发一次 |

### 语义性断言

1. **版本回退正确性**：被删消息对应的 State delta 是否从 active_chain 中移除？state_head_seq 是否回退到了目标 seq？

2. **Memory 回退正确性**：memory_versions 中，被删消息对应的 version 是否被回退移除？

3. **回退后新 delta 连续性**：回退操作后，后续轮次产生的 State delta 的 seq 是否连续（不出现序号跳跃）？

4. **选择性回退**：回退操作不会误删其他消息对应的 delta/version，只回退与被删消息 message_dates 有交集的记录。

5. **孤立分支可恢复**：orphaned_branches 中有被回退的版本记录，且可通过版本历史面板的 → 按钮成功恢复。

## 关键验证点（手动浏览器控制台）

```javascript
// 1. 检查 active_chain 中的回退状态
var chain = await (await indexedDB.open('ne_memory_vault')).transaction('active_chains').objectStore('active_chains').get(await __ne_debug.getCurrentChatId());
console.log('Active Chain:', JSON.stringify({ state_head_seq: chain.state_head_seq, mem_head_seq: chain.mem_head_seq }));

// 2. 检查 state_deltas 的 message_dates 字段
var deltas = await __ne_debug.dumpVaultKeys(); // 需要扩展
// 或直接用 IndexedDB 查询

// 3. 检查 orphaned_branches 中的回退版本
var orphans = []; var req = indexedDB.open('ne_memory_vault');
req.onsuccess = function() {
    var tx = req.result.transaction('orphaned_branches', 'readonly');
    var store = tx.objectStore('orphaned_branches');
    store.getAll().onsuccess = function(e) { console.log('Orphans:', e.target.result); };
};

// 4. 检查版本历史面板（UI）
// NE-Memory 面板 → State 标签页 → 版本历史按钮 → 时间线展示
```

## 运行参数

- **minRounds**: 8 — 前 7 轮积累 + 第 7 轮后删除
- **maxRounds**: 16 — 如有必要可延长验证
- **expectedRounds**: 10-12 — 大多数场景在此范围内完成
- **timeoutPerRound**: 120000

## 调用方式

```javascript
await __ne_debug.runTestByName('integ-rollback-delta')
```
