# Bug 3 修复：State Snapshot 统一 STM 时间/场景

## 1. 问题总结

STM 面板中同一条 LTM arc 下的不同 STM 条目显示混乱的时间/场景：
- `2024-05-21 19:00-21:30`（绝对日期）、`夜晚`（叙事标签）、`第一天夜晚`（叙事+序号）、`深夜`（叙事标签）
- 时间格式不一致

**根因**：当前 STM 的 `period`/`scene` 完全依赖 LLM 在 extraction prompt 中自由推断，无任何代码层约束。`postFillSTM` 曾尝试从 vault state 回填，但后来刻意移除了（注释写明"vault state 的值在批处理历史时会错——全贴同一个当前时间"）。

## 2. 当前架构

```
每条 assistant 消息到达:
  └─ triggerPerRoundExtraction(assistantMsg)
      └─ extractStateChangesOnly()
          ├─ postFillSTM → 更新 vault.content.story_time / story_scene
          ├─ mergeStateChanges → 更新 vault.content.state
          └─ saveVaultWithSnapshot   ← 持久化

pending batch 达到阈值:
  └─ flushPendingMessages()
      └─ executeIncrementalUpdate(pendingMessages)
          ├─ segmentTurns → LLM 切分 segment
          ├─ buildStmSummaryPrompt → LLM 提取 events（每条含 period/scene）
          └─ 直接入库，period/scene 来自 LLM 输出
```

关键矛盾：State 管线**每条消息**都更新 `story_time`/`story_scene`，但 STM 管线**批量处理多条消息**。每条 STM 都应该反映它对应对话时刻的 state，而非批处理中最后一刻的 state。

## 3. 方案：State 快照队列

### 3.1 核心思路

```
State 管线每次更新 vault state 后，记录快照：
  { msgIdx: N, time: "夜晚", scene: "客厅", date: "2024-05-21" }

STM 管线处理 segment 时，按 segment 的 msgStart 查找匹配快照：
  segment [msg 5-8] → 查找 msgIdx ≤ 5 的最近快照 → 填入 period/scene
```

### 3.2 快照数据格式

```javascript
// 存储在 vault.content._state_snapshots 数组中
{
    msgIdx: 5,              // ST 消息的原始 chat index（即 message.id）
    time: "夜晚",           // vault.content.story_time 快照值
    scene: "客厅",          // vault.content.story_scene 快照值
    date: "2024-05-21"      // vault.content.story_date 快照值
}
```

### 3.3 存储位置

`vault.content._state_snapshots` —— 与 STM/LTM 数据在同一个 IndexedDB 事务中持久化，确保一致性。

## 4. 实施步骤

### Step 1：快照捕获 — `extractStateChangesOnly()` 中记录快照

**文件**: `src/core/engine/update.js`，`extractStateChangesOnly` 函数 (~L1306)

**位置**：在 `saveVaultWithSnapshot` 调用之前，所有 state 更新之后

```javascript
// 在所有 state 更新完成后（L1306 之后，L1312 之前）
// 记录 state 快照，供后续 STM 批处理时查找对应时间/场景
var msgIdx = latestAssistantMsg ? latestAssistantMsg.id : null;
if (msgIdx != null && (vault.content.story_time || vault.content.story_scene)) {
    vault.content._state_snapshots = vault.content._state_snapshots || [];
    var snapshots = vault.content._state_snapshots;
    var lastSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    // 仅在 state 实际变化时记录，避免冗余
    if (!lastSnap || lastSnap.time !== vault.content.story_time || lastSnap.scene !== vault.content.story_scene) {
        snapshots.push({
            msgIdx: Number(msgIdx),
            time: vault.content.story_time || '',
            scene: vault.content.story_scene || '',
            date: vault.content.story_date || ''
        });
    }
}
```

**为什么在 extractStateChangesOnly 内部捕获**：
- State pipeline 和 STM pipeline 通过 pipeline guard 互斥（state 独占 → STM 独占）
- 快照在 state pipeline 内记录，随 `saveVaultWithSnapshot` 原子落盘
- 无需额外的 IndexedDB 写入

### Step 2：快照查询 — `resolvePeriodFromSnapshots()`

**文件**: `src/core/engine/update.js`，新增私有函数

```javascript
function resolvePeriodFromSnapshots(msgStart, snapshots) {
    if (!snapshots || snapshots.length === 0) return null;
    // 查找 msgIdx <= msgStart 的最近快照
    for (var i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].msgIdx <= msgStart) {
            return snapshots[i];
        }
    }
    return null;
}
```

### Step 3：STM 提取时使用快照 — `executeIncrementalUpdate()`

**文件**: `src/core/engine/update.js`，`executeIncrementalUpdate` 函数 (~L1208-L1218)

**当前代码**：
```javascript
for (var ei = 0; ei < Math.min(events.length, segments.length); ei++) {
    var seg = segments[ei];
    // ...
    events[ei].msg_ids = msgIds;
    events[ei].absMsgStart = turns[seg[0]].msgStart;
    events[ei].absMsgEnd = turns[seg[1]].msgEnd;
    events[ei].msgRange = [turns[seg[0]].msgStart, turns[seg[1]].msgEnd];
    events[ei].status = 'closed';
}
```

**新增**：对于每个 event，如果 LLM 返回的 `period` 是 `"-"` 或空值，用快照覆盖：

```javascript
var snapshots = vault.content._state_snapshots;
for (var ei = 0; ei < Math.min(events.length, segments.length); ei++) {
    var seg = segments[ei];
    // ... 现有赋值 ...
    
    // 用 state 快照补充 period/scene（优先于 LLM 输出）
    var segmentMsgStart = turns[seg[0]].msgStart;
    var periodSnap = resolvePeriodFromSnapshots(segmentMsgStart, snapshots);
    if (periodSnap) {
        if (!events[ei].period || events[ei].period === '-' || events[ei].period === '') {
            events[ei].period = periodSnap.time;
        }
        if (!events[ei].scene || events[ei].scene === '-' || events[ei].scene === '') {
            events[ei].scene = periodSnap.scene;
        }
        // story_date 不存在于 STM entry 结构，但 period 可组合
        if (periodSnap.date && (!events[ei].period || events[ei].period.indexOf(periodSnap.date) === -1)) {
            // 如果 period 是纯叙事标签（无日期），追加日期
            var datePrefix = periodSnap.date ? periodSnap.date + ' ' : '';
        }
    }
}
```

**策略选择——片段级应用**：
- 一个 segment 内的所有消息在叙事上是连续的，属于同一场景/时间
- 取 segment 第一条消息的 msgStart 查找快照
- 如果 LLM 已经输出了合理的 period（非 `"-"`/空），保留 LLM 的值（LLM 可能比 state 更精确地推断叙事切换）

### Step 4：快照清理

**文件**: `src/core/engine/update.js`，`executeIncrementalUpdate` 函数结尾

**时机**：STM 处理完成后，移除已被消费的快照

```javascript
// 在 events.length > 0 的处理块末尾（L1246 之前）
// 清理已处理的快照
if (snapshots && events.length > 0) {
    var maxProcessedMsgIdx = -1;
    for (var ei2 = 0; ei2 < events.length; ei2++) {
        if (events[ei2].absMsgEnd > maxProcessedMsgIdx) {
            maxProcessedMsgIdx = events[ei2].absMsgEnd;
        }
    }
    vault.content._state_snapshots = snapshots.filter(function(s) {
        return s.msgIdx > maxProcessedMsgIdx;
    });
}
```

**清理策略**：
- 取所有处理过的 segment 中最大的 `absMsgEnd`
- 删除 msgIdx ≤ 该值的所有快照
- 无论 STM 提取成功与否都执行清理，避免过期快照堆积

### Step 5：历史回填路径（不变）

**文件**: `src/core/engine/stm-extractor.js`

批处理/回填路径 **不做任何修改**。历史对话没有 state pipeline 运行过，无快照 → `resolvePeriodFromSnapshots` 返回 null → fallback 到 LLM 输出的 period/scene。

### Step 6：LLM prompt 微调

**文件**: `src/core/engine/update.js`，`buildStmSummaryPrompt` (~L873)

在 prompt 中加入 `story_time`/`story_scene` 上下文，让 LLM 在推断 period 时参考：

```javascript
// 在 user 段中追加当前 state 信息
var stateContext = '';
if (vault.content.story_time) stateContext += '\n当前时间: ' + vault.content.story_time;
if (vault.content.story_scene) stateContext += '\n当前场景: ' + vault.content.story_scene;
segmentsText += '\n## 当前故事状态\n' + stateContext + '\n';
```

## 5. 不变项（确保向后兼容）

| 项目 | 行为 |
|------|------|
| `isStateSchemaEnabled() === false` | 从不捕获快照 → 完全不变 |
| 历史回填（`runStmExtractorCore`） | 无快照 → LLM period/scene fallback |
| LTM rebatch | 不涉及 period/scene 赋值 |
| `_checkpoints` 机制 | 不冲突：`postFillSTM` 更新 `story_time`/`story_scene`（vault 级），快照提供 per-segment 映射 |
| `state` 对象结构 | 不修改，快照仅读取 `story_time`/`story_scene`/`story_date` |
| 面板渲染 | 不修改，`renderStmRow` 天然支持各种 period 格式 |

## 6. 数据流图（修改后）

```
Message₀ 到达 → state 管线 → snapshot: {msgIdx:0, time:"夜晚", scene:"客厅"}
Message₁ 到达 → state 管线 → snapshot: {msgIdx:1, time:"夜晚", scene:"客厅"}  (无变化，不写入)
Message₂ 到达 → state 管线 → snapshot: {msgIdx:2, time:"深夜", scene:"侧卧"}
Message₃ 到达 → state 管线 → snapshot: {msgIdx:3, time:"深夜", scene:"侧卧"}  (无变化，不写入)
  ...
  └─ STM batch 触发（处理 msg 0-3）
      segment [0,1] → 快照 msgIdx≤0 → time:"夜晚", scene:"客厅"  → STM entry
      segment [2,3] → 快照 msgIdx≤2 → time:"深夜", scene:"侧卧"  → STM entry
      清理: 删除 msgIdx≤3 的快照
```

## 7. 文件改动清单

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/core/engine/update.js` | 新增 `resolvePeriodFromSnapshots()` 函数 | +15 |
| `src/core/engine/update.js` | `extractStateChangesOnly()` 中记录快照 | +12 |
| `src/core/engine/update.js` | `executeIncrementalUpdate()` 中使用快照 + 清理 | +18 |
| `src/core/engine/update.js` | `buildStmSummaryPrompt()` 加入 state 上下文 | +5 |
| **总计** | | **~50 行** |

## 8. 验证步骤

1. `npm run build` — 构建通过
2. `node test/consolidate.test.js` 等现有测试 — 全部通过
3. 冒烟：开启 state schema，在 ST 中对话 5+ 轮 → 查看 Vault panel，同一 LTM arc 下不同 STM 的 period/scene 应反映对话实际进展（而非全一样或混乱）
4. 关闭 state schema 时，退化为 LLM period/scene（当前行为不变）
