# Retrieval Benchmark 优化计划 — 基于首轮测试结果

## Summary

基于首轮 BM25 vs BM25+Vector 基准测试暴露的五个问题，对测试数据集、诊断能力和报告格式做全面优化。改动涉及 4 个文件：`fixture.js`、`retrieval-filter.js`、`benchmark-runner.js`、`benchmark.test.js`。

## Problems Found & Fixes

### P1 — 噪声率计算错误
- **症状**：报告显示 ~31% 噪声，实际 ~16%。启发式 `event.length <= 20 || entities.length <= 1` 误杀合法事件
- **推理确定性**：**高** — 将启发式替换为 fixture 显式标签后，噪声率由数据定义，不存在计算偏差
- **修复**：fixture.js 每条事件加 `noise: true/false`，导出 `noiseCount`，report 直接读数

### P2 — 死代码
- **症状**：`benchmark.test.js` L105-106 声明两个变量从未使用
- **推理确定性**：**高** — 纯代码清洁，不涉及任何行为变化
- **修复**：删除两行

### P3 — Notes 列 NaN bug
- **症状**：`parseFloat(deltaStr(...))` 在 `'+∞'` 时 parse 出 `NaN`，所有行 Notes 变成 "Marginal"
- **推理确定性**：**中** — 修复逻辑明确（直接用原始分数算 delta），但阈值（`deltaPct <= -10` 标记 regression）需要实测确认无误标
- **需回归验证**：跑一次 BM25+Vector 测试，逐行检查 Notes 列——退化案例应标记 "Vector regression"，正常案例不误标
- **修复**：用原始分数计算 delta 百分比，阈值 `>=25` 标 gain，`<=-10` 标 regression，`abs <5` 标 marginal

### P4 — 退化案例无法诊断 (RRF Rank Tracing)
- **症状**：#5/#8/#12 三个 query 向量导致退化（P@10 ↓25-100%），不知根因
- **推理确定性**：**低** — hook 位置需要在 `retrieval-filter.js` 内精确定位（BM25 results 排序后、RRF fusion 完成后）；即使 hook 正确，数据能否解释退化根因是未知的（排名变化可能来自未捕获的管线步骤）
- **需回归验证**：(a) hook 正确性——GT Rank 列是否非空；(b) 诊断价值——退化案例的 GT Rank 变化是否揭示了根因。如果排名变化小说明根因在别处，需更深 instrumentation
- **修复**：在 `retrieval-filter.js` RRF fusion 后写 `globalThis.__ne_debug_rank_map` 记录每个事件的 BM25 rank 和 fused rank；benchmark runner 读取写入 per-query 明细

### P5 — Ground Truth Rank 列
- **症状**：当前报告只有 P@10/MRR 数值，不知道 ground truth 中具体事件排在什么位置
- **推理确定性**：**高**（格式部分）— Markdown 表格列映射是纯格式
- **需回归验证**：GT Rank 列数据来自 P4 hook，其正确性依赖 P4 验证
- **修复**：Per-Query Breakdown 追加 GT Ranks 列，格式 `stm_XX: BM25排名→Vec排名`，vector-only 标 `—→N (vec_only)`，未检索到标 `—→—`

## Decision Tree

```
实现全部 P1-P5 →
  跑一次 BM25+Vector 测试 →
    ├── P1: 噪声率是否 ~16%？          → 是 ✅
    ├── P3: #5/#8/#12 Notes 列 = "Vector regression"？ → 
    │       其他行不误标？              → 是 ✅ / 否 → 调阈值重跑
    ├── P4a: GT Rank 列非空？           → 是 ✅ / 否 → 修正 hook 位置重跑
    ├── P4b: 退化案例排名变化大？        → 是：根因确认 ✅
    │                                     → 否：根因在别处，需更深 instrumentation（后续迭代）
    └── P5: GT Rank 列格式正确、无截断？ → 是 ✅
```

## Implementation

### File 1: `test/retrieval-benchmark/fixture.js`

每条事件追加 `noise: true/false`，导出 `noiseCount`：

```javascript
{ id: 'stm_04', ..., noise: true },
{ id: 'stm_01', ..., noise: false },

export var noiseCount = allSTM.filter(function(e) { return e.noise; }).length;
```

### File 2: `src/core/vault/retrieval-filter.js`

在 RRF fusion 完成后追加 debug global。具体位置：L427 向量搜索块末尾、返回 results 之前。

```javascript
if (typeof globalThis !== 'undefined') {
    var rankMap = {};
    for (var bi = 0; bi < results.length; bi++) {
        var bid = results[bi].__id || results[bi].id;
        if (bid) rankMap[bid] = { bm25Rank: bi + 1 };
    }
    for (var fi = 0; fi < fused.length; fi++) {
        var fid = fused[fi].__id || fused[fi].id;
        if (fid && rankMap[fid]) {
            rankMap[fid].fusedRank = fi + 1;
        } else if (fid) {
            rankMap[fid] = { bm25Rank: null, fusedRank: fi + 1, vectorOnly: true };
        }
    }
    globalThis.__ne_debug_rank_map = rankMap;
}
```

### File 3: `test/retrieval-benchmark/benchmark-runner.js`

`runRound()` 中读取 `__ne_debug_rank_map` 并写入每 query 的 `gtRanks`：

```javascript
var rankMap = (typeof globalThis !== 'undefined' && globalThis.__ne_debug_rank_map) ? globalThis.__ne_debug_rank_map : {};
var gtRankEntries = [];
Object.keys(gt).forEach(function(id) {
    var rm = rankMap[id];
    gtRankEntries.push({
        id: id, gtScore: gt[id],
        bm25Rank: rm ? rm.bm25Rank : null,
        fusedRank: rm ? rm.fusedRank : null,
        vectorOnly: rm ? !!rm.vectorOnly : false,
    });
});
perQuery.push({ ..., gtRanks: gtRankEntries });
```

每轮结束后删除 global 避免泄漏。

### File 4: `test/retrieval-benchmark/benchmark.test.js`

- **4a** 删除 L105-106 死代码
- **4b** Notes 列用原始分数算 delta：
```javascript
var deltaPct = q1.scores.p10 > 0 ? ((q2.scores.p10 - q1.scores.p10) / q1.scores.p10) * 100 : (q2.scores.p10 > 0 ? Infinity : 0);
if (deltaPct >= 25) notes = 'Vector large gain';
else if (deltaPct <= -10) notes = 'Vector regression';
else if (Math.abs(deltaPct) < 5) notes = 'Marginal';
```
- **4c** Configuration 段改用显式噪声计数：`allSTM.length + ' (' + noiseCount + ' noise, ' + ... + '%)'`
- **4d** Per-Query Breakdown 追加 `| GT Ranks (BM25→Vec) |` 列
- **4e** 每轮结束清理 `__ne_debug_rank_map`

## Verification

```bash
npm run build && npm test
set EMBEDDING_URL=https://api.siliconflow.cn/v1/embeddings
set EMBEDDING_MODEL=BAAI/bge-m3
set EMBEDDING_API_KEY=sk-...
node test/retrieval-benchmark/benchmark.test.js
cat test/retrieval-benchmark/output/report.md
```

检查清单：

- [ ] `npm run build` 无错误
- [ ] `npm test` 全部通过
- [ ] 纯 BM25 模式：噪声率 ~16%（不是 31%）
- [ ] BM25+Vector 模式：所有断言通过
- [ ] Notes 列：#5/#8/#12 标记 "Vector regression"，#9 标记 "Vector large gain"，其余正常
- [ ] GT Rank 列非空，格式正确
- [ ] 退化案例 `bm25Rank → fusedRank` 变化可见，可辅助诊断根因
- [ ] `__ne_debug_rank_map` 每轮后清理
