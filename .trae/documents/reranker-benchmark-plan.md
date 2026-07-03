# Reranker 基准测试集成计划

## 摘要

将 BAAI/bge-reranker-v2-m3 (Cross-Encoder) 集成到检索基准测试中，作为"后融合精排"步骤，与当前最优方案 Lin α=0.20, k=60 做控制变量对比。测试 5 种重排组合，评估 reranker 是否带来正面效果，及是否需要重新调整融合参数。

## 当前状态

- 生产默认：`rrfFuse()` 为 Lin α=0.20, k=60 加权线性融合（BM25 20% + 向量 80%）
- 嵌入模型：BAAI/bge-m3 (Bi-Encoder)，SiliconFlow API
- 基准测试已有 `fusion` 模式，支持 6 种融合方法对比
- 大测试集：144 STM 事件、28 查询、17% 噪声
- Reranker 在项目中无任何现有代码

## Reranker 定位

```
当前管线:     BM25 ─┐
                    ├─ Lin α=0.20, k=60 ─→ top-K 输出
             向量  ─┘

新管线:      BM25 ─┐
                    ├─ Lin α=0.20, k=60 ─→ top-60 ─→ Reranker ─→ top-40 输出
             向量  ─┘
```

Reranker 是后融合精排步骤，不替换现有融合逻辑：
1. 现有融合照常运行，产出 top-60 候选
2. 将 60 个候选的文本 + 原始 query 发送给 SiliconFlow Rerank API
3. Reranker 返回 relevance_score 降序排列
4. 取 top-40 作为最终输出

## 5 种测试组合

| # | 方法 | 说明 |
|---|------|------|
| 1 | **Lin+Rerank (60)** | Lin α=0.20 + 重排 top-60，主对比目标 |
| 2 | **Lin+Rerank (80)** | Lin α=0.20 + 重排 top-80，测更宽候选池 |
| 3 | **RRF+Rerank (60)** | 传统 RRF k=60 + 重排，测重排能否弥补等权融合的劣势 |
| 4 | **BM25+Rerank (60)** | 纯 BM25 + 重排，测重排能否替代向量语义检索 |
| 5 | **Vector+Rerank (60)** | 纯向量 + 重排，测重排能否改善向量的前 5 精度短板 |

基线保留：BM25、Vector(pure)、Lin α=0.20 作为无重排对照。

## 实现步骤

### 步骤 1：`benchmark-fusions.js` — 新增 `rerankFuse`

**文件**：`test/retrieval-benchmark/benchmark-fusions.js`

新增异步函数：

```javascript
export async function rerankFuse(bm25Ids, vecIds, queryText, stmById, topK, candidatePool, alpha, rrfK) {
    // 1. 先跑 Lin 融合（或纯 BM25/纯向量，取决于参数）
    // 2. 取前 candidatePool 个候选
    // 3. 构建 query + documents 文本数组
    // 4. 调 SiliconFlow POST /v1/rerank
    // 5. 按 relevance_score 降序取 topK
    // 失败时降级：返回 Lin 融合结果（不改排序）
}
```

**参数说明**：
- `bm25Ids` / `vecIds`：两种检索方式的 ID 列表
- `queryText`：原始查询文本（传给 reranker 的 query 字段）
- `stmById`：ID → STM 对象映射，用于获取文档文本
- `topK`：最终输出条数（40）
- `candidatePool`：重排候选池大小（60 或 80）
- `alpha`：Lin 融合的 α 参数（默认 0.20）
- `rrfK`：Lin 融合的 k 参数（默认 60）

**文档文本构造**：使用 `stmById[id].event` 字段作为文档文本。

**Rerank API 请求格式**：
```
POST https://api.siliconflow.cn/v1/rerank
Authorization: Bearer <api_key>
Content-Type: application/json

{
    "model": "BAAI/bge-reranker-v2-m3",
    "query": "<queryText>",
    "documents": ["<event 1>", "<event 2>", ...],
    "top_n": 40
}
```

**API 密钥来源**：复用 `config.json` 的 `key` 字段（与 embedding 共用）。

**错误处理**：API 失败时返回 Lin 融合结果（无重排的降级）。不抛异常，让基准测试继续运行。

### 步骤 2：`benchmark-runner.js` — 扩展 `runFusionCompare`

**文件**：`test/retrieval-benchmark/benchmark-runner.js`

**2a. 导入**：
```javascript
import { rerankFuse } from './benchmark-fusions.js';
```

**2b. 构建 stmById 映射**（已存在于第 212 行，确认可用）。

**2c. 修改 methods 数组**（替换第 228-235 行）：

```javascript
var methods = [
    { label: 'RRF k=60', fn: function(b, v) { return rrfFuse(b, v, TOP_K, 60); } },
    { label: 'RRF k=110', fn: function(b, v) { return rrfFuse(b, v, TOP_K, 110); } },
    { label: 'Lin α=0.20, k=60', fn: function(b, v) { return linearFuse(b, v, 0.20, TOP_K, 60); } },
    // ── Reranker 组合 ──
    { label: 'Lin+Rerank (α=0.20, pool=60)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 60, 0.20, 60); } },
    { label: 'Lin+Rerank (α=0.20, pool=80)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 80, 0.20, 60); } },
    { label: 'RRF+Rerank (pool=60)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 60, 0.50, 60); } },
    { label: 'BM25+Rerank (pool=60)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 60, 1.0, 60); } },
    { label: 'Vector+Rerank (pool=60)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 60, 0.0, 60); } },
];
```

**2d. 修改融合循环调用点**（第 242 行附近），支持 async 方法：

```javascript
for (var qi = 0; qi < queries.length; qi++) {
    var q = queries[qi];
    var fusedIds = await method.fn(
        bm25Round.perQuery[qi].ids,
        queriesVec[qi],
        q.query,
        stmById
    );
    // ... 后续不变
}
```

关键改动：`method.fn(...)` → `await method.fn(...)`。非 async 函数返回数组，`await arr` 等于 `arr`，不影响同步方法。

### 步骤 3：`benchmark.test.js` — 更新 `isFusionMode` 检测

**文件**：`test/retrieval-benchmark/benchmark.test.js`

第 82 行：

```javascript
var isFusionMode = aggs.some(function(a) {
    return a.label.indexOf('Lin α=') === 0 || a.label.indexOf('Rerank') !== -1;
});
```

无需其他改动——融合模式的跳过断言、跳过 Per-Query 详情的逻辑已存在，会自动生效。

### 步骤 4：处理 alpha=1.0 和 alpha=0.0 的特殊情况

当 alpha=1.0 (纯 BM25) 或 alpha=0.0 (纯向量) 时，`rerankFuse` 不应跑 Lin 融合（那只是浪费），应直接取对应侧的 IDs 去重排。

```javascript
var fused;
if (alpha >= 1.0) {
    fused = bm25Ids.slice();  // 纯 BM25
} else if (alpha <= 0.0) {
    fused = vecIds.slice();  // 纯向量
} else {
    fused = linearFuse(bm25Ids, vecIds, alpha, Math.max(candidatePool, topK), rrfK);
}
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `test/retrieval-benchmark/benchmark-fusions.js` | 新增 `rerankFuse` 导出的 async 函数 | ~60 行 |
| `test/retrieval-benchmark/benchmark-runner.js` | 导入 + methods 扩展 + async 调用点修改 | ~10 行改动 |
| `test/retrieval-benchmark/benchmark.test.js` | `isFusionMode` 检测加 `Rerank` 匹配 | 1 行 |

不修改任何生产源代码。所有改动局限在 `test/retrieval-benchmark/` 目录内。

## 假设与决策

1. **Reranker 模型**：使用 `BAAI/bge-reranker-v2-m3`，与嵌入模型同家族，中文强项
2. **API 端点**：SiliconFlow 的 `/v1/rerank`，与 embedding 共用认证密钥
3. **API 密钥**：复用 `config.json` 的 `key` 字段，不需要额外配置
4. **文档文本**：用 `stmById[id].event` 字段（原始事件描述），不使用 `buildSearchableText`（API 有长度限制，且 event 文本更准确）
5. **α=0.20, k=60 不动**：先看固定参数下的重排效果，如果显著再考虑是否重新扫描
6. **候选池 60 为主要测试**，80 为辅助（测更宽池的边际收益）
7. **错误降级**：API 失败不崩溃，回退到无重排的 Lin 融合结果

## 验证

```powershell
# 语法检查
node --check test/retrieval-benchmark/benchmark-fusions.js
node --check test/retrieval-benchmark/benchmark-runner.js
node --check test/retrieval-benchmark/benchmark.test.js

# 运行融合对比（含 reranker 方法）
$env:NE_BENCHMARK_MODE="fusion"
node test/retrieval-benchmark/benchmark.test.js
```

预期：
- 8 种方法全部跑完：BM25、Vector、RRF k=60、RRF k=110、Lin α=0.20、Lin+Rerank(60)、Lin+Rerank(80)、RRF+Rerank、BM25+Rerank、Vector+Rerank
- 报告中的 Fusion Comparison 表包含所有方法
- Reranker API 调用的成功/失败日志可见
