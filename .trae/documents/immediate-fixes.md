# ne-memory 高优先级可立即修复项

> 从[已知局限分析](cross-project-analysis.md)中筛出的 ⚠️高 严重度 + 可今日动手修复 的条目。
>
> 筛选标准：(1) 影响面大或有数据丢失风险 (2) 改动量小，不涉及架构重构 (3) 修改即生效，不依赖新依赖或大范围回归测试。
>
> 日期：2026-06-28

---

## 修复清单

| # | 问题 | 严重 | 改动量 | 风险 |
|---|------|:---:|:---:|:---:|
| 1 | validate 验证函数是死代码 | ⚠️高 | 极小 | 低 |
| 2 | 关键路径静默吞异常 | ⚠️高 | 小 | 低 |
| 3 | 工具调用失败后不重试 | ⚠️中 | 极小 | 低 |
| 4 | IndexedDB 孤儿数据无清理 | ⚠️中 | 小 | 低 |
| 5 | pipeline 互斥锁超时缺乏安全性标记 | ⚠️中 | 小 | 低 |
| 6 | ne_token_usage 永不裁剪 | ⚠️低 | 极小 | 低 |

---

## 1. validate 验证函数死代码复活

**问题**：[validate.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/validate.js) 中的 `validateSTMOutput` 和 `validateLTMOutput` 被 import 但从未被调用。

**影响**：STM entry 缺少 event 字段、msgRange 重复/越界/缺失、LTM entry 缺少 stm_refs ——全部不会被检测。虽然有 `postFillSTM`/`postFillLTM` 做写后修补，但 **msgRange 的完整性和一致性无法事后修复**。

**修复**：在 `update.js` 的 STM/LTM 提取完成后、写入 vault 前，插入验证调用。若验证失败，记录异常并跳过该条目（不写入脏数据）。

**涉及文件**：[update.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js)

**改动量**：约 5-10 行

---

## 2. 关键路径静默吞异常

**问题**：以下 4 处关键路径的 catch 块完全为空，失败无任何感知：

| 位置 | 操作 | 失败后果 |
|------|------|---------|
| [events.js:L48](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L48) | `localStorage.setItem('ne_pending')` | 待处理消息队列丢失 |
| [events.js:L416](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L416) | `localStorage.setItem('ne_inflight')` | 崩溃恢复锚点缺失 |
| [events.js:L130](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js#L130) | `notifyVaultChanged()` (CustomEvent) | UI 面板不刷新 |
| [auto-restore.js:L7-L11](file:///d:/SillyTavern/xm/ne-memory/src/core/auto-restore.js#L7-L11) | 双层 vault 加载 (共6处 catch) | 加载失败无日志 |

**修复**：每个空 catch 至少输出 `console.warn` 带上下文信息（操作名 + error.message）。对于 `ne_pending`/`ne_inflight` 这类崩溃恢复关键数据，write 失败时额外记录遥测异常日志。

**涉及文件**：[events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js)、[auto-restore.js](file:///d:/SillyTavern/xm/ne-memory/src/core/auto-restore.js)

**改动量**：约 10-15 行

---

## 3. 工具调用失败后不重试

**问题**：[llm.js:L254-L330](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js#L254-L330)

```javascript
for (var round = 0; round < 5; round++) {
    try { ... break; }
    catch (e) {
        console.warn('Tool call round ' + (round+1) + ' failed:', e.message);
        break;   // ← 一次失败即退出
    }
}
```

`for round < 5` 循环的设计意图是"最多 5 轮工具对话"，但 catch 里的 `break` 意味着工具调用**一次失败即退出**，与设计意图矛盾。

**修复**：将 `break` 改为 `continue`，使失败后尝试下一轮。

**涉及文件**：[llm.js](file:///d:/SillyTavern/xm/ne-memory/src/core/api/llm.js)

**改动量**：1 行（`break` → `continue`）

---

## 4. IndexedDB 孤儿数据无清理（已修正）

> **2026-06-28 勘误**：前一版认为 snapshots 无裁剪是错误判断。实际 `versions.js` 已通过 `pruneOldSnapshots` 实现了 **每 chat_id 保留最新 30 条快照** 的裁剪逻辑（[versions.js:L32-L40](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/versions.js#L32-L40)），在 `update.js` 的 `saveVaultWithSnapshot` 中调用（[update.js:L36](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/update.js#L36)）。

**真正的问题**：当 SillyTavern 中聊天被删除时，IndexedDB 中对应的 **vault 记录 + snapshots 全部成为孤儿数据**——因为代码中没有任何地方监听聊天删除事件并清理 IndexedDB。

目前 ST 事件映射中仅包含 `CHAT_CHANGED`，无 `CHAT_DELETED`（[index.js:L164](file:///d:/SillyTavern/xm/ne-memory/src/adapter/index.js#L164)）。

**影响**：长期使用后，已删除聊天的 vault + 所有快照残留在 IndexedDB 中，占用存储空间且无法被用户感知。

**涉及文件**：[store.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/store.js)、[versions.js](file:///d:/SillyTavern/xm/ne-memory/src/core/vault/versions.js)、[index.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/index.js)

**改动量**：约 30-40 行（新增 GC 函数 + 启动时调用）

---

## 5. pipeline 互斥锁超时缺乏安全性标记

**问题**：[pipeline-guard.js:L57-L78](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/pipeline-guard.js#L57-L78)

```javascript
timeoutMs = timeoutMs || 15000;
// 超时后强制 resolve，不保证管线已空闲
```

当 LLM 响应缓慢时（STM 提取耗时 > 15s），新到来的消息会超时绕过硬编码互斥锁，与旧管道并发执行。

**修复**：
1. 在 `pipeline-guard.js` 中增加 `_pipelineForcedRelease = false` 标志
2. 超时路径设置 `_pipelineForcedRelease = true` 后 resolve
3. `releasePipeline()` 中检查该标志，若为 true 则输出 `console.warn('[NE-GUARD] pipeline was force-released due to timeout')` + 记录遥测异常
4. 同时在 `events.js` 调用 `waitForPipelineTrackIdle` 处将超时从默认 15000 提升为 `getSettings().pipelineTimeout || 30000`（允许用户配置，且更长的默认值更安全）

**涉及文件**：[pipeline-guard.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/pipeline-guard.js)、[events.js](file:///d:/SillyTavern/xm/ne-memory/src/adapter/events.js)

**改动量**：约 15-20 行

---

## 6. ne_token_usage 永不裁剪

**问题**：[telemetry.js:L36-L39](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/telemetry.js#L36-L39)

每次 LLM 调用均 `getItem → 累加 → setItem`，无总量上限。对比其他同类 key 均有明确裁剪策略（`MAX_DAILY_DAYS=90`、`MAX_ANOMALIES=50`、`MAX_TURNS=200`），这是遗漏项。

**影响**：极低（纯计数器，增长极慢），但作为规范缺陷应修复。

**修复**：在 `telemetry.js` 中增加 `MAX_TOKEN_USAGE_ENTRIES = 10000`，写入前若超过则裁剪最早的条目。或者在项目层面做一次全局 localStorage key 容量审计后统一制定裁剪策略。

**涉及文件**：[telemetry.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/telemetry.js)

**改动量**：约 5 行

---

## 建议修复顺序

```
第1步: #1 validate 死代码复活 (风险最高，改动最小)
第2步: #3 工具调用重试     (一行改动，立竿见影)
第3步: #2 关键路径日志     (可观测性基础建设)
第4步: #4 孤儿数据清理   (GC逻辑)
第5步: #5 互斥锁安全标记    (防御性编程)
第6步: #6 token_usage 裁剪  (顺手修)
```

前 3 项合计约 15-25 行代码改动，可在一次提交中完成。
