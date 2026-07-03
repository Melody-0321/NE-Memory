# RRF k 值调优 & 基准备忘计划

**创建日期**: 2026-06-30
**状态**: 已审核通过

---

## 一、交付物

### A. 检索基准备忘 MD
**路径**: `.trae/documents/retrieval-benchmark-memo.md`

记录三轮 (BM25 / Vector / RRF) 对照结果和关键发现，供后续决策参考。不涉及代码改动，纯纪录性文档。

### B. RRF k 值调优（含粗扫 → 细化的迭代流程）

---

## 二、当前状态分析

### 2.1 k 值在哪

| 位置 | 代码 | 可配置？ |
|------|------|---------|
| `retrieval-fusion.js:91` | `var k = _k \|\| 60;` | ✅ 函数参数，调用方传入即可 |
| `retrieval-filter.js:370` | `rrfFuse(results, vecResults, 60, topK)` | ❌ 硬编码，**需要改动** |

### 2.2 基准基础设施

- `benchmark-runner.js`: `runRRFRound()` 通过 `filterCandidates` 走完整生产路径
- `filterCandidates` → 向量搜索 → `rrfFuse(k=60)` → 结果
- 当前无机制向 `filterCandidates` 传递 k 值

### 2.3 key background

三轮测试已经揭示了 RRF 在 P@10 上的"中等深度塌陷"（RRF P@10=0.275 低于 BM25 的 0.283 和纯向量的 0.292），GT Rank 追踪证实了这是噪声条目稀释和两路排名不一致导致的排序退化。

---

## 三、RRF k 值调优：实现方案

### 3.1 总体思路

**环境变量注入** —— 在 `retrieval-filter.js` 中读取 `NE_BENCHMARK_RRF_K`，benchmark 每次设置不同值后调用 `filterCandidates`，走完整生产路径。通过 multi-round comparison report 获得每个 k 值的指标。

### 3.2 需修改的文件

#### 文件 1: `src/core/vault/retrieval-filter.js`

**位置**: L370, `rrfFuse(results, vecResults, 60, topK)` 调用处

**改动**:
```js
// 原: var fused = rrfFuse(results, vecResults, 60, topK);
var _rrfK = 60;
if (typeof process !== 'undefined' && process.env && process.env.NE_BENCHMARK_RRF_K) {
    _rrfK = parseInt(process.env.NE_BENCHMARK_RRF_K, 10) || 60;
}
var fused = rrfFuse(results, vecResults, _rrfK, topK);
```

**影响面**: 极小。仅在 Node.js 环境中生效（浏览器环境无 `process.env`）。默认行为不变（k=60）。遵循现有 `NE_BENCHMARK_VECTOR` / `EMBEDDING_URL` 的注入模式。

#### 文件 2: `test/retrieval-benchmark/benchmark-runner.js`

**新增内容**:

1. **k 扫描值列表**（常量，可手动调整）:
   ```js
   var K_SCAN_VALUES = [20, 30, 40, 50, 60, 80, 100, 120];
   ```

2. **`runKScanRound(k)` 函数** — 包装现有 `runRRFRound`:
   ```js
   async function runKScanRound(k) {
       process.env.NE_BENCHMARK_RRF_K = String(k);
       var result = await runRRFRound();
       delete process.env.NE_BENCHMARK_RRF_K;
       result.label = 'RRF (k=' + k + ')';
       return result;
   }
   ```

3. **`runKScan()` 函数** — k 值扫描协调器:
   ```js
   async function runKScan() {
       var results = [];
       for (var i = 0; i < K_SCAN_VALUES.length; i++) {
           resetVectorIndex(CHAT_ID);
           var round = await runKScanRound(K_SCAN_VALUES[i]);
           results.push(round);
           console.log('  k=' + K_SCAN_VALUES[i] + ' done, ' + round.perQuery.length + ' queries.');
       }
       return results;
   }
   ```

4. **`runBenchmark()` 扩展** — 添加 `ksweep` 和 `kscan` 模式:
   ```js
   if (mode === 'ksweep' || mode === 'kscan') {
       var kRounds = await runKScan();
       rounds = rounds.concat(kRounds);
   }
   ```

5. **`getMode()` 扩展** — 识别新模式:
   已支持 `all|bm25|vector|vec|rrf`，新增 `ksweep|kscan`。

**向量索引复用策略**: 每个 k 值轮次会重新调用 `filterCandidates`，但 `ensureVectorIndex` 是增量更新的，第二轮及之后因为索引已包含所有条目所以无需重新计算 embedding。第一轮是完整构建，后续轮次仅做 fusion 计算——无额外 embedding 开销。

#### 文件 3: `test/retrieval-benchmark/benchmark.test.js`

**新增内容**:

1. **k-sweep 对比表**（在 Overall Results 之后插入）:
   ```
   ## k-Value Sweep

   | k | P@5 | P@10 | P@20 | R@5 | R@10 | R@20 | NDCG@10 | MRR | Hit@5 |
   |---|-----|------|------|-----|------|------|---------|-----|-------|
   | 20 | ... | ...  | ...  | ... | ...  | ...  | ...     | ... | ...   |
   | 30 | ... | ...  | ...  | ... | ...  | ...  | ...     | ... | ...   |
   | ... | ... | ...  | ...  | ... | ...  | ...  | ...     | ... | ...   |
   ```

2. **最优 k 标识**: 在 NDCG@10 列标注 🥇 最高值，（次优可注 🥈）

3. **Delta vs baseline (k=60) 列**: 展示每个 k 值相对于当前默认值的变化百分比

4. **分类型子表**: 
   ```
   | k | P@10 (Narrative) | P@10 (Targeted) | NDCG@10 (Narrative) | NDCG@10 (Targeted) |
   ```
   观察 k 值对叙事型和目标型的差异化影响

5. **k-sweep 断言**: 新增一条断言——调优后的最优 k 值 NDCG@10 不低于 k=60 基准

**report结构顺序** (k-sweep模式):
```
## Configuration
## k-Value Sweep (← 新增，替代或补充 Overall Results)
## Per-Query Breakdown (使用最优k)
## Diagnostic Notes
```

---

## 四、执行流程

```
Step 1: 粗扫 8 个点
  k ∈ {20, 30, 40, 50, 60, 80, 100, 120}
  ↓ 观察 NDCG@10 趋势，确定峰值区间
  
Step 2: 分析结果
  - 如果峰值在 40-80 之间 → 在该区间细化（如 45, 50, 55, 60, 65, 70, 75）
  - 如果峰值在边缘（<30 或 >100）→ 扩展扫描范围（如 10, 15 或 140, 160, 200）
  - 如果 k=60 已经是峰值附近 → 确认即可，无需细化
  
Step 3 (可选): 细化扫描
  在峰值区间以 5-10 为步长加测，找到精确最优值
  
Step 4: 记录结论
  更新备忘 MD，标注最优 k 值及其相对于 k=60 的收益
```

---

## 五、假设与决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 仅调 k，不调非对称权重 | 先隔离单变量，避免交互效应混淆 |
| 2 | NDCG@10 为主优化目标 | 综合考虑排序位置和相关性等级，最贴近注入质量 |
| 3 | 环境变量注入方式 | 走完整生产路径（filterCandidates），结果可直接信任 |
| 4 | 粗扫 8 点 → 细化 | 快速定位峰值区间，再精确收敛 |
| 5 | 最优 k 不自动写回生产 | 需人工确认后再单独提交；避免"自动优化"的过度自信 |
| 6 | embedding 复用（增量索引） | 第一轮后 ensureVectorIndex 无需重新计算，后续仅做 fusion |
| 7 | k-sweep 作为独立 mode | 不影响 all/bm25/vector/rrf 现有模式 |

---

## 六、验证步骤

1. `npm run build` — 确保 `retrieval-filter.js` 改动编译通过
2. `npm test` — 确保单元测试不受影响
3. `$env:NE_BENCHMARK_MODE='ksweep'; node test/retrieval-benchmark/benchmark.test.js` — 执行 k 扫描
4. 手动检查报告 `test/retrieval-benchmark/output/report.md`:
   - k-sweep 对比表格式正确
   - 所有 k 值都有数据
   - NDCG@10 列标注了最高值
   - 分类型子表数据合理
5. 最优值确认后，手动运行一次纯最优 k 的全三轮对比: `$env:NE_BENCHMARK_MODE='all'; $env:NE_BENCHMARK_RRF_K='<最优值>'; node ...` 验证改进
