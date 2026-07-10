# P1 新模块状态 & 问题记录

**日期**: 2026-07-10 | **基线**: `7db9b9a` (HEAD)

---

## 一、P1 引入的新模块

### 1.1 版本链引擎 — `src/core/vault/state-versions.js`

替代旧的 `versions.js` 快照系统，以增量 delta 方式记录 State 和 Memory 的每次变更。

引入 4 个 IndexedDB ObjectStore：

| Store | KeyPath | 说明 |
|-------|---------|------|
| `state_deltas` | `id` | State 增量记录（索引: chat_id） |
| `memory_versions` | `id` | Memory 增量记录（索引: chat_id） |
| `active_chains` | `chat_id` | 活跃版本链元信息 |
| `orphaned_branches` | `id` | 回退后的孤立分支（索引: chat_id） |

核心函数：`initializeChain`, `recordStateDelta`, `recordMemoryVersion`, `foldState`, `rollbackState`, `restoreBranch`, `compact`

### 1.2 版本历史面板 — `src/adapter/panel-version-history.js`

三个标签页：State 版本 / Memory 版本 / 设置。在 `panel-init.js` 中挂载为 "版本历史" 按钮。

---

## 二、已修复的问题（仓库代码层面 — 已推送）

| 修复 | Commit | 说明 |
|------|--------|------|
| `console.warn` → `console.error`（5 处） | `3591f25` | 不再静默吞掉版本链写入错误 |
| `DB_VERSION` 5→6 | `5792f46` | 强制创建 4 个新 ObjectStore |
| 删除旧 `snapshots` store | `b461d27` | `onupgradeneeded` 清理残留 |
| 去掉 `> 2` 门控 | `7db9b9a` | State 管线每轮触发 |
| `initializeChain` fire-and-forget → await | `7db9b9a` | State 管线自给自足 |
| `recordStateDelta` 加诊断日志 | `7db9b9a` | 写入时输出 seq/changes/summary |

---

## 三、已定位但未完成验证的问题

### 3.1 版本历史面板为空（State / Memory 均无记录）

**根因链条**:

1. **State 管线**: `pendingMessages.length > 2` 门控（`8fd9077`）导致 State 管线在绝大多数轮次不触发。已修复（`7db9b9a`）。

2. **Memory 管线**: 同样依赖 `flushPendingMessages`（batch 满才跑）。`recordMemoryVersion` 在 STM 管线末尾调用——如果 STM 管线不触发，Memory 版本也不记录。

3. **4 个 ObjectStore 可能不存在**: 如果用户的 DB 已在旧版本升级到 v5 后没有新的 `onupgradeneeded`，新 store 不会被创建。已通过 `DB_VERSION` 5→6 修复。

**注意**: `7db9b9a` 的修复已在仓库中，但用户本地回退了 `> 2` 门控。需确认部署的是最新代码。

### 3.2 记忆列表为空（STM 0 / LTM 0）

**证据**: `smartpush-14-2026-07-09T12-57-35-trace.md` — 6 轮全链路测试，每轮 `STM events added: 0`。

**根因定位**: Round 5 的 `stm_extract` LLM 调用 **completion 被截断**（4096 tokens 限制达到），返回的 JSON 不完整：

```json
// 第 1077-1088 行 — 第三个事件被截断
{
  "events": [
    {"event": "...事件1...", ...},       // 完整
    {"event": "...事件2...", ...},       // 完整
    {"event": "江岚建议女配说出具体事实，安然采纳并确认  // ← 截断！
```

JSON 解析失败 → `added: 0`。6 轮累计只产生了 0 条 STM 记录。

**影响**: 与版本链无关——这是在当前`saveVault → write → vaults store` 的正常路径上发生的。STM 解析失败导致 vault 里没有 `unconsolidated_stm`，所以面板显示空。

**需要确认**: 这是 P1 新增的问题，还是已存在的最大 completion tokens 限制问题？`stm_extract` 的 prompt 是否在本次重构中被加长（新增了更多上下文），导致 completion 更容易达到 4096 上限？

### 3.3 `pendingMessages.length > 2` 门控的引入历史

**首个引入**: `8fd9077` (Jun 24 14:50) — "prevent state/stm pipeline from firing on opening greeting"

目的合理（防止开场白触发管线），但实现错误——用 `pendingMessages` 计数做判断，而不是用对话实际轮数。

历史变更：
- `8fd9077`: 引入 `pendingMessages.length > 2`
- `9d54874`: 改成 `userMsgCount >= 2`（又改回）
- `33defc6`: 改回 `pendingMessages.length > 2`
- `594264a`: 删了 `wordsThreshold`，门控保留
- `7db9b9a`: 去掉门控 ✅

---

## 四、已验证正常的模块

| 模块 | 状态 | 证据 |
|------|------|------|
| IndexedDB vaults store 读写 | ✅ 正常 | `IndexedDB write OK` |
| NE-BANNER 提取 | ✅ 正常 | `stateBlock EXTRACTED` + 时间/场景/角色字段 |
| NE-CHAR 提取与合并 | ✅ 正常 | `consumeNeCharBlocks` 输出完整角色状态 |
| onMessageReceived 事件链 | ✅ 正常 | 消息 ID、strip、pending 入队 |
| `buildMsgId` / `findMessageInChat` | ✅ 正常 | 单测 33 条通过 |
| `mergeStateChanges` | ✅ 正常 | 单测 110 条通过 |
| State 管线 LLM 调用 | ✅ 正常 | trace 中 5/6 轮 state_extract 成功返回 |
| STM 管线调度 | ✅ 正常 | Round 5 batch 满后正确触发 `flushPendingMessages` |

---

## 五、下一步

### 必须做的事

1. **确认 STM completion truncation 的根因** — `stm_extract` 的 max_tokens 是多少？prompt 是否在本次重构中被加长？
2. **部署最新代码**（包含 `7db9b9a` 的 3 处修复）— 刷新浏览器发一轮对话，拿带 `console.error` 的日志
3. **验证 State 版本历史** — 确认 `initializeChain` → `recordStateDelta` 链路完整

### 可以延后的事

- smoke 脚本（Tier 2）在实际可用之后重新运行
- Tier 4 集成测试（`integ-rollback-delta`）待版本链正常运转后运行
