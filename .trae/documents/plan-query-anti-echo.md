# Plan: Query 反回声 + 多样性追踪

## Summary

当前 `formatSmartContext` 在构建检索 query 时，AI 回复和用户消息平等对待（各 2 轮 × 400 字），导致回声效应：AI 写的话题 → query 中包含 AI 输出 → retrieval 命中相同条目 → AI 继续写相同话题 → 循环。且 State 前缀中的 `main_event` 无时效性检测，过期主题持续污染 query。

本计划通过 `ne_settings.queryAiWeight` 开关实现低 AI 权重 query 策略（AI 1 轮 × 200 字 vs 用户 2 轮 × 400 字），并在 monitor 中追加注入多样性追踪，以实机测试对比新旧策略的注入更新率和回声强度。

## Current State Analysis

### 现状 query 构建路径

[`formatSmartContext`](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js#L119-L160) 的三层 query 信号：

```
Layer 1 — State 前缀 (buildRetrievalPrefix):
  场景:xxx | 时间:xxx | 当前事件:xxx | 活跃角色:xxx

Layer 2 — 最近 2 轮对话:
  aiTexts[2] × 400 字 + userTexts[2] × 400 字
  → 拼成 conversationContext，截断到 1200 字

Layer 3 — 兜底:
  当 chatMessages 为空时，用 Vault 字段拼接
```

**回声传播链**：

```
AI输出 (Round N) → query 包含 AI 输出 (Round N+1)
  → retrieval 命中与原话题相同的条目 → injection 以 HL 前置展示
  → AI 继续写原话题 → AI输出 (Round N+1) → query 再次包含
```

**State 前缀的时效性黑洞**：`main_event` 是 State pipeline 的在位值。一旦它被设为 `"月票榜争夺"`，**每次**检索都会在 query 前缀中标明 `当前事件: 月票榜争夺`，无论实际对话是否已经转向新话题。

### 现有监控能力

[`monitor.js — collectRoundData`](file:///d:/SillyTavern/xm/ne-memory/src/core/test-runner/monitor.js#L70-L108) 已采集：
- `merge`: `__ne_debug_last_merge`（含 `map` 中每条条目的 `relevance`、`entry.id`）
- `injection`: 注入文本

**缺失**：每轮注入的条目 ID 集合没有任何跨轮追踪。无法计算注入更新率或回声强度。

### 现有开关机制

[`injection.js:L317-L321`](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js#L317-L321) 已从 `localStorage.ne_settings` 读取配置，目前仅使用 `retrievalBudgetEnabled` 字段。可直接复用。

### 基准测试的局限

benchmark 的 query 直接传 `queries.js` 中的硬编码问题字符串（[benchmark-runner.js:L31](file:///d:/SillyTavern/xm/ne-memory/test/retrieval-benchmark/benchmark-runner.js#L30-L31)），**完全绕过** `formatSmartContext` 的 query 构建逻辑。benchmark 仅用于检索排序回归检测，无法评估 query 策略变化。

## Proposed Changes

### 文件 1: `src/core/engine/injection.js` — query 策略开关

**位置**：[`formatSmartContext`](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js#L119-L160) 中的 query 构建段

**改动内容**：

1. **AI 回复截断开关**（第 122-140 行）：

```javascript
// 旧 (当前):
var MAX_ROUNDS = 2;
// ...
if (aiTexts.length < MAX_ROUNDS) {
    aiTexts.push(txt.trim().substring(0, 400));
}
```

改为：

```javascript
var neSettings = {};
try {
    var raw = localStorage.getItem('ne_settings');
    if (raw) neSettings = JSON.parse(raw);
} catch (e) {}

var aiMaxRounds = (neSettings.queryAiWeight === 'low') ? 1 : 2;
var aiMaxChars  = (neSettings.queryAiWeight === 'low') ? 200 : 400;
// userTexts 始终 MAX_ROUNDS=2, 400 字不变

// ...
if (aiTexts.length < aiMaxRounds) {
    aiTexts.push(txt.trim().substring(0, aiMaxChars));
}
```

**注意**：`neSettings` 的读取需要移到 `conversationContext` 构建之前（当前在 L317-L321，query 构建之后）。

**实际做法**：将 `localStorage.getItem('ne_settings')` 的读取提前到 L121 附近，或者直接用 module-level 读取（简单变量），避免两次解析。建议在 `conversationContext` 构建前加一行：

```javascript
var queryAiWeight;
try { var ns = JSON.parse(localStorage.getItem('ne_settings') || '{}'); queryAiWeight = ns.queryAiWeight; } catch (e) {}
```

2. **main_event 时效性检查**（第 148-150 行附近，在 `buildRetrievalPrefix` 调用后）：

```javascript
// 在 prefix 构建后、拼入 query 前检查 main_event 新鲜度
if (prefix && !queryAiWeight) {  // 旧策略也加，因为它对任何策略都有帮助
    var hasStaleMainEvent = false;
    if (state && state.main_event && conversationContext) {
        var ek = state.main_event.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
        if (ek.length >= 2) {
            hasStaleMainEvent = ek.split('').every(function(ch) {
                return conversationContext.substring(0, 600).indexOf(ch) === -1;
            });
        }
    }
    if (hasStaleMainEvent) {
        // 重新构建不含 main_event 的 prefix
        prefix = buildRetrievalPrefixSansMainEvent(content, state);
    }
}
```

如果 `main_event` 的关键词在最近对话的前 600 字中完全不存在 → 假设过期 → 重新构建不含 `main_event` 的 prefix。

`buildRetrievalPrefixSansMainEvent` 是 `buildRetrievalPrefix` 的变体（不拼 `main_event`），可以复用其结构，也可以用条件跳过。

**最简实现**：不新建函数，而是在 `buildRetrievalPrefix` 内部根据一个 flag 跳过 `main_event`：

```javascript
function buildRetrievalPrefix(content, state, skipMainEvent) {
    // ... parts.push 逻辑 ...
    if (state && state.main_event && !skipMainEvent) parts.push('当前事件: ' + state.main_event);
    // ...
}
```

**What**: 两处并行改动 — (a) AI 回复权重降低 (b) main_event 过期自动移除
**Why**: 分别切断回声链的第 2 和第 1 个放大环节
**How**: `ne_settings.queryAiWeight='low'` 控制 (a)，条件前置读取控制 (b)

### 文件 2: `src/core/test-runner/monitor.js` — 注入多样性追踪

**位置**：`collectRoundData` 返回值 + 新增模块级变量

**新增模块级变量**（文件顶部，`_pipelineCallsPerRound` 之后）：

```javascript
var _allInjectedEntries = {};   // entryId → round (首次出现轮次)
var _prevRoundHitIds = [];      // 上轮命中的 entryId 列表
var _diversityLog = [];         // [{ round, novelCount, jaccard, ... }]
```

**`collectRoundData` 中追加**（第 107 行 `return` 之前）：

```javascript
// 注入多样性追踪
var merge = globalThis.__ne_debug_last_merge;
var diversity = { novelCount: 0, totalHits: 0, jaccard: null, cumulativeNovel: 0 };
if (merge && merge.map) {
    var hitIds = [];
    merge.map.forEach(function(v) {
        if (v.relevance > 0 && !v._isDirectory && v.sources && v.sources.indexOf('ltm_dir') < 0) {
            hitIds.push(v.entry.id);
            if (!_allInjectedEntries[v.entry.id]) {
                _allInjectedEntries[v.entry.id] = currentRound || (_diversityLog.length + 1);
                diversity.novelCount++;
            }
        }
    });
    diversity.totalHits = hitIds.length;
    // Jaccard vs 上轮
    if (_prevRoundHitIds.length > 0) {
        var intersection = hitIds.filter(function(id) { return _prevRoundHitIds.indexOf(id) >= 0; }).length;
        var union = new Set(hitIds.concat(_prevRoundHitIds)).size;
        diversity.jaccard = union > 0 ? Math.round(intersection / union * 100) / 100 : 0;
    }
    diversity.cumulativeNovel = Object.keys(_allInjectedEntries).length;
    _prevRoundHitIds = hitIds;
}

return {
    // ... 现有字段 ...
    diversity: diversity
};
```

**注意**：`collectRoundData` 当前不接受 `round` 参数，diversity 计算需要知道当前轮次。可以：
- 从 `roundTag` 推断
- 或加一个参数 `round`（需要同步修改 test-driver.js 的调用 [L104](file:///d:/SillyTavern/xm/ne-memory/src/adapter/test-driver.js#L104)）

**最简方案**：不需要知道 round 号，让 `_diversityLog` 的长度作为隐式轮次。test-driver.js 调用时传 `round`：

```javascript
// test-driver.js L104:
var roundData = collectRoundData(round, round);
// monitor.js:
export function collectRoundData(roundTag, round) {
    // ... diversity 计算中使用 round ...
}
```

第二个参数是可选的后向兼容。

**What**: 在 `collectRoundData` 中追加注入条目 ID 的跨轮追踪
**Why**: 看新条目率 / Jaccard 相似度 → 量化回声强度
**How**: 模块级 `_allInjectedEntries` Map + `_prevRoundHitIds` 数组

### 文件 3: `src/core/test-runner/files.js` — 报告新增多样性段

**位置 A**：`appendTraceRound`（第 258 行附近），在管线数据段末尾追加：

```javascript
if (roundData.diversity) {
    var d = roundData.diversity;
    lines.push('- 注入多样性: ' + d.novelCount + ' new / ' + d.totalHits + ' hits (累计唯一: ' + d.cumulativeNovel + ')');
    if (d.jaccard !== null) {
        lines.push('  Jaccard vs 上轮: ' + d.jaccard);
    }
}
```

**位置 B**：`createReport`（第 373 行附近），在逐轮 Token 用量表之后新增 `## 注入多样性` 段：

```javascript
// 从 roundDataList 提取 diversity 数据
var diversityRounds = roundDataList
    .filter(function(rd) { return rd && rd.diversity && rd.diversity.totalHits > 0; })
    .map(function(rd) { return rd.diversity; });

if (diversityRounds.length > 1) {
    lines.push('## 注入多样性');
    lines.push('| 轮次 | 新条目 | 总命中 | Jaccard | 累计唯一 |');
    lines.push('|---:|---:|---:|---:|---:|');
    for (var di = 0; di < diversityRounds.length; di++) {
        var d = diversityRounds[di];
        lines.push('| ' + (di + 1) + ' | ' + d.novelCount + ' | ' + d.totalHits + ' | ' + (d.jaccard !== null ? d.jaccard : '—') + ' | ' + d.cumulativeNovel + ' |');
    }
    lines.push('');
}
```

**What**: trace 和 report 中可视化注入多样性
**Why**: 实机测试结束后，一眼看出 echo 强度
**How**: trace 追加一行摘要，report 追加表格

### 文件 4: `src/adapter/test-driver.js` — 传轮次给 monitor

**位置**：[L104](file:///d:/SillyTavern/xm/ne-memory/src/adapter/test-driver.js#L104)

```javascript
// 旧:
var roundData = collectRoundData(round);

// 新:
var roundData = collectRoundData(round, round);
```

**What**: 将 `round` 传给 `collectRoundData` 的第二个参数
**Why**: diversity 计算需要当前轮次标号
**How**: 增加参数传递，monitor.js 中 parameters 变为 `collectRoundData(roundTag, round)`

## Files Changed

| 文件 | 改动 | 行数 |
|------|------|:----:|
| `src/core/engine/injection.js` | query 策略开关 + main_event 时效 | ~25 |
| `src/core/test-runner/monitor.js` | 注入多样性追踪 | ~30 |
| `src/core/test-runner/files.js` | 报告多样性段 | ~20 |
| `src/adapter/test-driver.js` | 传 round 参数 | ~1 |
| **合计** | | **~76** |

## Assumptions & Decisions

1. **开关命名**: `ne_settings.queryAiWeight = 'low'` — 简洁、自文档，不设置则默认旧策略
2. **AI 截断参数**: 1 轮 × 200 字 — 参考 ST-BME 的 0.2 权重比例（用户:AI ≈ 4:1）
3. **main_event 时效**: 检查位于前 600 字对话 → 对应最近 1 轮用户 + 1 轮 AI 的范围，足够覆盖活跃话题
4. **多样性计算时机**: 每次 `collectRoundData` 调用时计算 — 不影响测试主循环性能
5. **`round` 参数**: 第二个参数可选，不传则用隐式计数（`_diversityLog.length + 1`），保证后向兼容
6. **benchmark 不受影响**: 此次改动不及 benchmark 路径

## Verification

### 回归检测

```bash
# 确认 benchmark 未退化
node test/retrieval-benchmark/benchmark.test.js
```

预期：NDCG/MRR 不变（query 策略不影响 benchmark 路径）。

### 新旧策略对比

```javascript
// 1. 构建
npm run build

// 2. 旧策略（默认）
await __ne_debug.runTestByName('smartpush-14')
// 记录报告路径 A

// 3. 新策略
localStorage.setItem('ne_settings', JSON.stringify({ queryAiWeight: 'low' }));
await __ne_debug.runTestByName('smartpush-14')
// 记录报告路径 B

// 4. 对比两份报告的 「注入多样性」表
// 预期: B 的 Jaccard 相似度更低、累计唯一条目更多
```

### 格式检查

```javascript
// 确认 build 成功
// 确认 trace 末尾出现 "注入多样性: N new / M hits" 行
// 确认 report 底部出现 「## 注入多样性」 表
```
