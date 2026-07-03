# BM25 vs BM25+Vector (RRF) 检索召回质量基准测试 — 实现计划

## 1. Summary

在 Trae Work 的 Node.js 环境中构建一个**白盒基准测试**，对比**纯 BM25** 和 **BM25+Vector RRF** 在相同数据集上的检索召回质量。评测范围为 `filterCandidates()` 输出的原始候选列表，不含 `mergePipelines` / `groupCandidatesByEntity` / `buildEntityBlock`（纯召回维度）。

## 2. Decisions (during grill-me)

| # | 决策 | 结论 |
|---|------|------|
| 1 | Ground truth 标注 | **分级 0/1/2**（不相关/间接相关/直接相关），P/R 在 1 和 2 分都算命中，NDCG 用原始分数 |
| 2 | `denoiseResults` Rule 1（相似度去重） | **已切除**，`eventTextSimilarity` 一并删除 |
| 3 | Fixture 噪声注入 | **10-15%**（边缘事件、不完整 entity、轻度近重复） |
| 4 | 向量索引隔离 | **单一 chatId `'__benchmark__'`**，跨 query 共享，仅在 benchmark 启动时 reset |
| 5 | 评测范围 | **纯召回**：只测 `filterCandidates()` 输出候选列表 |
| 6 | 指标与 k 值 | **P@5/10/20, R@5/10/20, NDCG@10, MRR, Hit@5** |
| 7 | 统计置信度 | 不做假设检验。报告含均值+中位数+逐query明细+按类型分组+诊断注释 |
| 8 | `mergePipelines` Step 3-4-5 | **已切除**：LTM分组入map、`discoverAvailableChains`、短链inline |
| 9 | 运行模式 | **两轮独立**：先对所有 query 跑纯 BM25，再对所有 query 跑 BM25+Vector（共享索引） |
| 10 | 向量搜索开关 | `process.env.NE_BENCHMARK_VECTOR='0'` 硬控。Round 1 设为 '0'，Round 2 不设（由 `EMBEDDING_URL` 自动启用） |
| 11 | Round 2 前置检查 | **Smoke check**：先跑一条 query 检查 `_vectorUsed===true`，否则 abort 并标注原因 |
| 12 | 检索参数 | Benchmark 显式传入 `topK=40, minResults=3`，不依赖 `isAuto`/`computeTopK` |
| 13 | 跨语言 | 不做。Fixture 不含 translation 字段，queries 全部中文 |
| 14 | 测试框架 | **独立脚本**，不接入 `test/run.mjs`。直接 `node test/retrieval-benchmark/benchmark.test.js` |
| 15 | 报告输出 | `test/retrieval-benchmark/output/report.md`，`.gitignore` 加该目录 |

## 3. Current State

### 3.1 检索管线（修改后）

```
query → BM25评分(topK=40) → 断崖截断 → 过渡事件排序(denoise Rule 2) → [可选: 向量搜索 + RRF融合(k=60)] → LTM目录追加 → 返回
```

`filterCandidates` 签名：
```javascript
async filterCandidates(query, allSTM, allLTM, topK, minResults, aliasesMap, chatId) → Array<STMEntry|LTMEntry>
```

返回元素是原始条目的深拷贝，带 `__type` / `__id` / `__score` 扩展，数组上附带 `_vectorUsed` 元数据。

### 3.2 唯一需要源码修改的地方

`src/core/engine/embedding.js`：`loadEmbeddingApiConfig()` 和 `isVectorSearchEnabled()` 在 Node.js 环境下回退到环境变量。

**已完成的修改（无需再动）**：
- `retrieval-filter.js`：去重切除 + `eventTextSimilarity` 删除
- `retrieval.js`：`mergePipelines` 中 Step 3-4-5 切除 + `discoverAvailableChains` 删除

### 3.3 分词器

使用同一套手写 1+2gram CJK 分词器（`tokenize`），测试和生产一致。无需 `Intl.Segmenter`。

## 4. Implementation

### 4.1 新增文件

```
test/retrieval-benchmark/
├── fixture.js                # 虚拟 STM 数据集（40-60 条，含 10-15% 噪声）
├── queries.js                # 10-15 个查询 + 分级 ground truth
├── metrics.js                # 指标计算（P@k, R@k, NDCG, MRR, Hit@k）
├── benchmark-runner.js       # 核心运行器
├── benchmark.test.js         # 独立脚本入口（断言 + 报告生成）
└── output/
    └── report.md             # 自动生成的 Markdown 对比报告
```

### 4.2 源码修改

`src/core/engine/embedding.js`：

```javascript
export function loadEmbeddingApiConfig() {
    try {
        var raw = localStorage.getItem('ne_embedding_api');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    // Node.js fallback
    if (typeof process !== 'undefined' && process.env && process.env.EMBEDDING_URL) {
        return {
            url: process.env.EMBEDDING_URL,
            model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
            key: process.env.EMBEDDING_API_KEY || ''
        };
    }
    return null;
}

export function isVectorSearchEnabled() {
    // Explicit off switch
    if (typeof process !== 'undefined' && process.env && process.env.NE_BENCHMARK_VECTOR === '0') return false;
    try {
        var raw = localStorage.getItem('ne_settings');
        return raw ? !!JSON.parse(raw).enableVectorSearch : false;
    } catch (e) {}
    // Node.js: enabled if EMBEDDING_URL is set
    if (typeof process !== 'undefined' && process.env && process.env.EMBEDDING_URL) return true;
    return false;
}
```

### 4.3 虚拟数据集（`fixture.js`）

- **规模**：~50 条 STM 事件，6-8 个 character 实体
- **核心故事线**：江岚（主角，~70%）、安然（对手/暧昧，~60%）、配角 2-4 人（15-25%）
- **噪声 ~8 条（~15%）**：边缘事件、不完整 entity 标注、轻度近重复

事件结构：
```javascript
{
  id: 'stm_01',
  event: '江岚与安然在702公寓发现彼此存在，经过核对合同和身份证确认是性转版本的自己',
  period: 'Day 1 傍晚',
  scene: '702公寓 · 阳台',
  entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }],
  status: 'closed',
  msg_ids: [0, 1],
}
```

检索难度梯度：显式关键词→简单、近义表达→中等、跨时间推理→困难。

### 4.4 查询（`queries.js`）

10-15 个，分两类：

**场景叙事型**（5-7 个）— 模拟管线 `buildRetrievalPrefix()` 产出：
```javascript
{
  query: '【702公寓 · 阳台 | Day 1 傍晚 | 江岚和安然对峙 | 活跃角色: 江岚, 安然】',
  groundTruth: { stm_01: 2, stm_03: 2, stm_07: 2, stm_14: 1 },
  type: 'narrative',
  description: '阳台对峙',
}
```

**目标查询型**（5-8 个）— 语义泛化：
```javascript
{
  query: '江岚和安然之间的月票榜赌约是怎么回事？',
  groundTruth: { stm_15: 2, stm_16: 2, stm_17: 2 },
  type: 'targeted',
  description: '月票榜赌约',
}
```

### 4.5 指标（`metrics.js`）

| 指标 | 计算方式 | 说明 |
|------|----------|------|
| Precision@5/10/20 | `|relevant@k| / k` | 分数≥1 算 relevant |
| Recall@5/10/20 | `|relevant@k| / |total relevant|` | total = 分数≥1 的条目总数 |
| NDCG@10 | `DCG/IDCG` | 用分级分数 (0/1/2) 算 gain |
| MRR | `1/rank_of_first_2pt` | 仅统计 2 分条目 |
| Hit@5 | `0/1` | top-5 是否有任何 relevant |

### 4.6 运行器（`benchmark-runner.js`）

```
runBenchmark()
  ├── Setup: 读环境变量，resetVectorIndex('__benchmark__')，加载 fixture + queries
  ├── Round 1 — 纯 BM25:
  │     ├── process.env.NE_BENCHMARK_VECTOR = '0'
  │     └── 对所有 query 依次 filterCandidates(topK=40, minResults=3) → 记录结果
  ├── Round 2 — BM25+Vector:
  │     ├── delete process.env.NE_BENCHMARK_VECTOR
  │     ├── Smoke check: 跑一条 query，assert _vectorUsed===true
  │     └── 对所有 query 依次 filterCandidates(topK=40, minResults=3) → 记录结果
  ├── 计算所有指标
  ├── 生成 output/report.md
  └── 返回结构化结果（供断言消费）
```

### 4.7 断言（`benchmark.test.js`）

**回归断言**（失败则 exit 1）：

| 断言 | 条件 |
|------|------|
| NDCG@10 不降级 | `avg_ndcg_vector >= avg_ndcg_bm25 * 0.90` |
| MRR 不降级 | `avg_mrr_vector >= avg_mrr_bm25 * 0.90` |
| 向量搜索确实触发 | Round 2 每条 query 的 `_vectorUsed===true` |
| 目标查询型 Recall@10 不降级 | `avg_r10_targeted_vector >= avg_r10_targeted_bm25 * 0.85` |

**诊断断言**（仅输出警告，不阻塞）：
- 场景叙事型 query 在 BM25 下已经表现好，向量边际提升有限 → 标志

### 4.8 报告（`output/report.md`）

```markdown
# NE-Memory Retrieval Benchmark Report
**Generated**: YYYY-MM-DDTHH:mm
**Embedding**: BAAI/bge-m3

## Configuration
- STM events: 52 (7 noise)
- Characters: 7
- Queries: 12 (6 narrative + 6 targeted)

## Overall Results
| Metric | BM25 Mean | BM25 Median | BM25+Vec Mean | BM25+Vec Median | Delta |
|--------|-----------|-------------|---------------|-----------------|-------|
| P@5    | ... | ... | ... | ... | ±x% |
| P@10   | ... | ... | ... | ... | ±x% |
| P@20   | ... | ... | ... | ... | ±x% |
| R@5    | ... | ... | ... | ... | ±x% |
| R@10   | ... | ... | ... | ... | ±x% |
| R@20   | ... | ... | ... | ... | ±x% |
| NDCG@10| ... | ... | ... | ... | ±x% |
| MRR    | ... | ... | ... | ... | ±x% |
| Hit@5  | ... | ... | ... | ... | ±x% |

## By Query Type
### Narrative (n=6)
### Targeted (n=6)

## Per-Query Breakdown
| # | Type | Description | P@10 BM25 | P@10 Vec | Delta | Notes |
|---|------|-------------|-----------|----------|-------|-------|

## Diagnostic Notes
```

## 5. Verification

```bash
# 完整对比
set EMBEDDING_URL=https://api.siliconflow.cn/v1/embeddings
set EMBEDDING_MODEL=BAAI/bge-m3
set EMBEDDING_API_KEY=your-key
node test/retrieval-benchmark/benchmark.test.js
cat test/retrieval-benchmark/output/report.md

# 纯 BM25（不需要 embedding API）
set NE_BENCHMARK_VECTOR=0
node test/retrieval-benchmark/benchmark.test.js
```

### 检查清单

- [ ] `npm run build` 无错误
- [ ] `npm test` 全部通过
- [ ] benchmark 纯 BM25 模式正常
- [ ] benchmark BM25+Vector 模式正常并产出 report.md
- [ ] 无 `localStorage` 报错
- [ ] 向量 smoke check 通过
- [ ] Round 2 断言不失败
