# Closed-Form Scaling — 实现计划（更新版）

## 状态

- ✅ **已完成**：`src/params.js` 新建、events.js telemetry 记录
- 🔲 **待实现**：6 个文件的剩余修改

---

## 摘要

基于两个观测信号（turnsPerEvent、对话规模），通过固定公式计算 8 个检索参数的动态最优值。每个参数提供自动/手动切换开关，默认自动。

---

## 一、参数总览

| # | 参数 | 输入 | 公式 | 位置 | 当前默认 | 状态 |
|---|------|------|------|------|---------|------|
| 1 | stmBatch | turnsPerEvent | `clamp(4x, 5, 25)` | events.js | 10 | 🔲 auto |
| 2 | stm_max_tokens | stmBatch | `clamp(40x, 400, 2500)` | llm.js | 800 | 🔲 auto |
| 3 | topK | totalSTM | 对数饱和 `[15,80]` | retrieval-filter.js | 40 | 🔲 auto |
| 4 | chainDepth | chainLength | 对数饱和 `[10,40]` | retrieval.js | 无上限 | 🔲 切片 |
| 5 | chainRecentWindow | chainLength | 对数饱和 `[10,40]` | retrieval.js | 不存在 | 🔲 切片 |
| 6 | chainHeadCount | — | 固定 `5` | retrieval.js | 不存在 | 🔲 切片 |
| 7 | ltmDirCount | totalLTM | 对数饱和 `[5,35]` | retrieval-filter.js | 20 | 🔲 auto |
| 8 | minResults | totalSTM | `clamp(floor(x/50)+3, 3, 10)` | retrieval-filter.js | 3 | 🔲 auto |

---

## 二、已完成：`src/params.js`

已创建，包含：
- 8 个 compute 函数 + `computeAll(stats)` 统一入口
- `isAuto(name)` / `setAuto(name, auto)` localStorage 存取
- `recordTelemetry(entry)` / `getTelemetryStats()` 遥测存储
- `logScale()` 对数饱和 helper

API：
```javascript
var stats = {
    turnsPerEvent: 3.5,   // 最近 5 次提取均值
    totalSTM: 85,          // vault 中 STM 总数
    totalLTM: 12,          // vault 中 LTM 总数
    chainLength: 120       // 实体链长度（每个链分别计算）
};
var params = computeAll(stats);
```

---

## 三、待实现改动（按实施顺序）

### 改动 1：events.js — getStmBatchSize() 自动

**文件**：`src/events.js` 第 49-58 行

当前是同步函数，从 localStorage 读 `ne_settings.stmBatch`。改为 async + 自动模式判断：

```javascript
async function getStmBatchSize() {
    var { isAuto, computeStmBatch, getTelemetryStats } = await import('./params.js');
    if (isAuto('stmBatch')) {
        return computeStmBatch(getTelemetryStats().turnsPerEvent);
    }
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) return Number(JSON.parse(raw).stmBatch) || 10;
    } catch (e) {}
    return 10;
}
```

**连锁影响**：`getStmBatchSize()` 变为 async，调用处需加 `await`：
- L150: `pendingMessages.length >= getStmBatchSize()`
- L171: `pendingMessages.length < getStmBatchSize()`
- L173: 日志字符串拼接 `getStmBatchSize()`

这些都在 events.js 内部，改动集中。约 **10 行**。

---

### 改动 2：llm.js — stm_max_tokens 自动

**文件**：`src/api/llm.js`

两处使用 `mc.stm_max_tokens`：

**2A — callMemoryPipeline**（第 128-131 行）：
当前：`max_tokens: mc.stm_max_tokens`
改为：
```javascript
var maxTokens = mc.stm_max_tokens;
var { isAuto, computeStmMaxTokens } = await import('./params.js');
if (isAuto('stmMaxTokens')) {
    var { getStmBatchSize } = await import('../events.js');
    maxTokens = computeStmMaxTokens(await getStmBatchSize());
}
```

**2B — callMemoryLLMWithTools**（第 235 行）：
当前：`max_tokens: mc.stm_max_tokens || 2048`
改为：相同逻辑

约 **10 行**。

---

### 改动 3：retrieval-filter.js — topK/minResults/ltmDirCount 自动

**文件**：`src/vault/retrieval-filter.js`

`filterCandidates` 改为 async，函数开头自动计算：

```javascript
export async function filterCandidates(query, allSTM, allLTM, topK, minResults, aliasesMap) {
    var totalSTM = (allSTM || []).length;
    var totalLTM = (allLTM || []).length;
    var { isAuto, computeTopK, computeMinResults, computeLtmDirCount } = await import('./params.js');
    topK = isAuto('topK') ? computeTopK(totalSTM) : (topK || 40);
    minResults = isAuto('minResults') ? computeMinResults(totalSTM) : (minResults || 3);
    // ... 原有逻辑不变 ...
```

以及 LTM directory 处（约第 380 行）：
```javascript
var ltmDirCount = isAuto('ltmDirCount')
    ? computeLtmDirCount(allLTM.length)
    : Math.min(ltmSorted.length, 20);
```

**连锁影响**：`filterCandidates` 变为 async，调用处需加 `await`（vault-panel.js 中 2 处）。

约 **8 行**。

---

### 改动 4：retrieval.js — lookupEntityChains 链切片

**文件**：`src/engine/retrieval.js`

`lookupEntityChains` 改为 async，排序后、存入 chains 前加入 head + mid + recent 切片逻辑：

```javascript
if (chainEntries.length > 0) {
    chainEntries.sort(function(a, b) {
        return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
    });
    // 切片：head（锚点）+ mid（稀疏采样）+ recent（密集窗口）
    var { isAuto, computeChainDepth, computeChainRecentWindow, computeChainHeadCount } = await import('./params.js');
    var chainLen = chainEntries.length;
    if (isAuto('chainDepth') && chainLen > (computeChainHeadCount() + 2)) {
        var depth = computeChainDepth(chainLen);
        var recentWindow = isAuto('chainRecentWindow') ? computeChainRecentWindow(chainLen) : depth;
        var headCount = computeChainHeadCount();
        var sliced = [];
        // head
        var head = chainEntries.slice(0, Math.min(headCount, depth));
        sliced = sliced.concat(head);
        var remaining = depth - head.length;
        if (remaining > 0) {
            // recent
            var recentStart = Math.max(head.length, chainLen - Math.min(remaining, recentWindow));
            var recent = chainEntries.slice(recentStart);
            sliced = sliced.concat(recent);
            remaining -= recent.length;
            if (remaining > 0 && chainLen > head.length + recent.length) {
                // mid: 稀疏采样
                var midStart = head.length;
                var midEnd = chainLen - recent.length;
                if (midEnd > midStart) {
                    var midCount = Math.min(remaining, midEnd - midStart);
                    var step = Math.max(1, Math.floor((midEnd - midStart) / midCount));
                    for (var mi = midStart, mc = 0; mi < midEnd && mc < midCount; mi += step, mc++) {
                        sliced.push(chainEntries[mi]);
                    }
                }
            }
        }
        // 按时序重排
        sliced.sort(function(a, b) {
            return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
        });
        chainEntries = sliced;
    }
    chains[name] = chainEntries;
```

注意：chainEntries 已排序为升序（旧→新），head 取最早 headCount 条（锚点/背景），recent 取最近 recentWindow 条（密集上下文），mid 在中间均匀采样。

**连锁影响**：`lookupEntityChains` 变为 async，调用处需加 `await`（retrieval.js legacy builder 1 处 + vault-panel.js 1 处）。

约 **30 行**。

---

### 改动 5：vault-panel.js — await 适配

**文件**：`src/ui/vault-panel.js`

两处调用加 await：

**5A — formatVaultForPrompt**（约第 1215 行）：
```javascript
var topK = await filterCandidates(query, allStm, ltm, 25);
```

**5B — 主检索管线**（约第 1330-1370 行）：
```javascript
var entityChains = {};
if (entityNames && entityNames.length > 0) {
    entityChains = await lookupEntityChains(content, entityNames);
}
// ... 后续 filterCandidates 调用加 await
```

约 **5 行**。

---

### 改动 6：vault-panel.js — UI 自动/手动开关

**文件**：`src/ui/vault-panel.js` — `renderSettingsTab`

原则：仅对有独立 slider 的参数添加 UI toggle。其余参数（topK, ltmDirCount, minResults, chainDepth 等）完全内部自动，用户不直接感知。

**6A — stmBatch auto toggle**（第 2484-2485 行，common settings 的 STM Extraction Batch）：

当前 slider 行：
```html
'<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('STM Extraction Batch') + '</span><span class="range-val" id="nes_stm_batch_val">' + (settings.stmBatch || 10) + '</span></div>' +
'<input type="range" id="nes_stm_batch" min="1" max="30" step="1" value="' + (settings.stmBatch || 10) + '" style="width:100%;">' +
```

改为（在 `renderSettingsTab` 函数中动态计算）：
```javascript
var stmBatchAuto = isAuto('stmBatch');
var computedBatch = computeStmBatch(getTelemetryStats().turnsPerEvent);
var displayBatch = stmBatchAuto ? computedBatch : (settings.stmBatch || 10);
'<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;">' +
    '<span>' + t('STM Extraction Batch') + '</span>' +
    '<div style="display:flex;align-items:center;gap:6px;">' +
        '<label style="font-size:0.8em;display:flex;align-items:center;gap:3px;cursor:pointer;">' +
            '<input type="checkbox" id="nes_stm_batch_auto" ' + (stmBatchAuto ? 'checked' : '') + '> Auto' +
        '</label>' +
        '<span class="range-val" id="nes_stm_batch_val">' + displayBatch + '</span>' +
    '</div>' +
'</div>' +
'<input type="range" id="nes_stm_batch" min="1" max="30" step="1" value="' + displayBatch + '" style="width:100%;"' + (stmBatchAuto ? ' disabled' : '') + '>' +
```

auto checkbox 事件绑定（在 event bindings 区域）：
```javascript
var autoSb = byId('nes_stm_batch_auto');
if (autoSb) {
    autoSb.onchange = function() {
        import('./params.js').then(function(m) {
            m.setAuto('stmBatch', autoSb.checked);
            renderSettingsTab();
        });
    };
}
```

**6B — saveSettingsTab 兼容**（第 2750 行）：
当前：`stmBatch: Number(byId('nes_stm_batch').value),`
改为：auto 模式下保存 'auto' 标记
```javascript
stmBatch: (byId('nes_stm_batch_auto') && byId('nes_stm_batch_auto').checked) ? 'auto' : Number(byId('nes_stm_batch').value),
```

**6C — stm_max_tokens auto toggle**（第 2584 行，advanced settings）：
类似方式，在 STM Max Tokens 数字输入旁添加 auto checkbox。

注意：需要预先在 `renderSettingsTab` 顶部 import params.js：
```javascript
var { isAuto, computeStmBatch, computeStmMaxTokens, getTelemetryStats } = await import('./params.js');
```

→ 但这会使 `renderSettingsTab` 变为 async。由于它由事件处理函数调用（非 async），改为顶部使用同步 import（因为 params.js 没有副作用）：
```javascript
import { isAuto, computeStmBatch, computeStmMaxTokens, getTelemetryStats } from '../params.js';
```
注意：需要确认 params.js 的 import 没有循环依赖问题。params.js 不引用任何其他 ne-memory 模块，无循环依赖风险。

约 **45 行**。

---

### 改动 7：retrieval.js legacy builder — await 适配

**文件**：`src/engine/retrieval.js` 第 529-531 行

当前：`var chains = lookupEntityChains(content, entityNames);`
改为：`var chains = await lookupEntityChains(content, entityNames);`

约 **1 行**。

---

## 四、连锁影响汇总（async 冒泡）

| 函数 | 变为 async | 调用方 | 调用方需加 await |
|------|-----------|--------|-----------------|
| `getStmBatchSize()` | 是 | events.js 内部 ×3 | 3 处 |
| `filterCandidates()` | 是 | vault-panel.js ×2 | 2 处 |
| `lookupEntityChains()` | 是 | retrieval.js ×1, vault-panel.js ×1 | 2 处 |
| `renderSettingsTab()` | 否（同步 import） | 事件处理 | 0 处 |

所有 async 函数使用 `await import()` 动态导入，避免循环依赖。

---

## 五、改动汇总

| 文件 | 改动 | 约行数 | 状态 |
|------|------|--------|------|
| `src/params.js` | 新建 | 112 | ✅ 完成 |
| `events.js` | telemetry 记录 | 4 | ✅ 完成 |
| `events.js` | getStmBatchSize async + auto | 10 | 🔲 |
| `llm.js` | stm_max_tokens auto | 10 | 🔲 |
| `retrieval-filter.js` | filterCandidates async + auto | 8 | 🔲 |
| `retrieval.js` | lookupEntityChains async + 链切片 | 30 | 🔲 |
| `retrieval.js` | legacy builder await | 1 | 🔲 |
| `vault-panel.js` | 调用处 await | 5 | 🔲 |
| `vault-panel.js` | UI auto/manual 开关 | 45 | 🔲 |
| **合计** | | **~225** | |

---

## 六、验证

1. `npm run build` 通过
2. 新对话开始，日志确认 stmBatch 按计算值生效
3. Settings 页切换 auto switch，确认 slider 禁用/启用状态和数值联动
4. 上传长对话（大量 STM），确认 topK / chainDepth 自动放大
5. 实体链检索，确认链被切片（不再全量传入 prompt）
