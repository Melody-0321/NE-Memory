# BM25 → BM25+向量混合检索方案

## 目标

在现有纯 BM25 检索的基础上引入向量语义检索，通过 RRF 融合两种检索结果，提升对语义相似但词面不匹配的记忆的召回率。零退化路径：embedding API 不可用时降级为纯 BM25。

## 当前状态

| 特性 | 现状 |
|------|------|
| 检索方式 | 纯 BM25（CJK 2-gram 分词，k1=1.5，b=0.75） |
| 被索引条目 | 仅 STM（LTM 以归档目录追加，不参与评分） |
| 候选池控制 | topK 自适应 15-80，minResults 3-10，断崖截断 |
| Embedding 基础设施 | 无 |
| Query 来源 | 最近 2 轮对话文本（经模糊引用解析增强） |

## 收益分析

### 当前 BM25 的盲区

| 场景 | BM25 行为 | 向量检索 |
|------|----------|---------|
| "铁匠铺的老张" vs "铁匠 Zhang" | `老张` 的 CJK 大五元与 `Zhang` 零重叠 → 0 分 | ✅ 语义接近 → 高相似度 |
| "气愤地摔门而去" vs "愤怒地离开了房间" | `摔门`/`离开` 无公共 token → 极低分 | ✅ 语义等价 → 高相似度 |
| "sword" vs "剑" | 中英文 token 零重叠 → 0 分 | ✅ 跨语言语义 → 高相似度 |
| 别名未覆盖 | 依赖 aliasesMap 精确匹配 → 漏召回 | ✅ 不依赖词面 → 天然覆盖 |
| "想起了上次在酒馆的事" | "上次" 是模糊引用，BM25 依赖 ambiguity.js 解析 | ✅ 全量语义 → 概率覆盖 |

### 量化估计（基于典型聊天 12 轮，STM=80-120 条）

| 指标 | 纯 BM25 | BM25+向量 | 改善 |
|------|---------|-----------|------|
| 首轮 Cold Start 延迟 | 0 | ~1-3s（全量 embedding 计算） | — |
| 后续每轮额外延迟 | 0 | ~200ms（query embedding + 1 增量 STM embedding） | — |
| 语义匹配召回率 | ~60-70% | ~85-95% | **+15-30%** |
| 别名遗漏容错 | 0 | ✅ | **质变** |
| API 调用增量 | 0 | +1 次/轮（query）+ 1 次/新 STM | — |
| 客户端内存增量 | 0 | ~1.2MB（200 STM × 1536d × 4B） | 可忽略 |

## 方案概述

### 新增模块

```
src/core/engine/
├── embedding.js          ← Embedding API 客户端 + 向量运算
└── retrieval-fusion.js   ← RRF 融合 + 向量索引维护
```

### 数据流（改动后）

```
formatSmartContext()
  │
  ├── query = 构造查询文本（不变）
  │
  ├── BM25 检索（不变）
  │     └── filterCandidates(query, allSTM, allLTM, topK * 2, ...)
  │           → bm25Results[0..topK*2]
  │
  ├── 向量检索（新增）                              ← 仅当 embedding API 可用
  │     ├── queryEmbedding = computeEmbedding(query)
  │     ├── vectorIndex.ensureFresh(allSTM)         ← 增量更新
  │     └── vectorResults = cosineSearch(queryEmbedding, vectorIndex, topK * 2)
  │
  ├── RRF 融合（新增）
  │     └── fusedResults = rrfFuse(bm25Results, vectorResults, k=60, topK)
  │           → 替换原 bm25Results 作为 mergePipelines 输入
  │
  └── mergePipelines(fusedResults, ...) → 其余管线不变
```

### RRF 公式

```
RRF(entry) = 1/(k + bm25_rank) + 1/(k + vector_rank)

其中 k = 60（平滑常数），rank 从 1 开始。
entry 不在某路结果中 → 该路贡献 = 0。
按 RRF 降序排列，取前 topK 条。
```

### Embedding API 配置（可选功能）

向量检索是**可选功能**，由开关控制。仅在开关打开时才显示配置界面。

**开关**：`ne_settings.enableVectorSearch`（默认 `false`）。

**API 存储**：`localStorage` key `ne_embedding_api`，结构 `{ url, key, model }` — 与现有 `ne_secondary_api` / `ne_retrieval_api` 完全一致的 3 要素模式。

```json
// ne_embedding_api
{
  "url": "https://api.openai.com/v1/embeddings",
  "key": "sk-...",
  "model": "text-embedding-3-small"
}
```

**API 要求**：OpenAI 兼容格式（`POST /v1/embeddings`），`input` 支持 string 或 string[]。

### 配置 UI 设计（与现有 API 配置一致）

**位置**：Settings Tab 中，现有 Secondary API 配置块下方，作为新的 accordion section。

**HTML 结构**（仅当 `enableVectorSearch = true` 时显示配置表单）：

```html
<div class="ne-accordion open" id="ne-set-embedding">
  <div class="ne-accordion-header"><span class="ne-accordion-chevron">▶</span> Vector Search (Embedding API)</div>
  <div class="ne-accordion-body">
    <div class="ne-settings-toggle-grid" style="margin-bottom:8px;">
      <label><input type="checkbox" id="nes_enable_vector_search"> <span>Enable Vector Search</span></label>
    </div>
    <div style="color:var(--grey50);font-size:0.75em;margin:0 0 12px;">Requires an OpenAI-compatible Embedding API. When disabled or unconfigured, falls back to BM25-only retrieval.</div>
    <!-- 仅当开关打开时渲染以下 -->
    <div class="ne-settings-grid">
      <div><label>API URL</label><input type="text" id="nes_embedding_url" placeholder="https://api.openai.com/v1/embeddings"></div>
      <div><label>API Key</label><input type="password" id="nes_embedding_key" placeholder="sk-..."></div>
      <div><label>Model</label><input type="text" id="nes_embedding_model" placeholder="text-embedding-3-small"></div>
    </div>
    <div><button class="ne-api-btn" id="nes_embedding_connect">Connect</button></div>
    <div class="ne-api-status"><span class="ne-api-dot" id="nes_embedding_dot"></span><span id="nes_embedding_status_text">Not connected</span></div>
  </div>
</div>
```

**事件绑定**（与现有 `saveSecApiOnly` / `saveRetApiOnly` 模式一致）：

```js
var vecEnableEl = byId('nes_enable_vector_search');
if (vecEnableEl) vecEnableEl.onchange = function() { saveSettingsTab(); renderSettingsTab(); };

var vUrlEl = byId('nes_embedding_url');
if (vUrlEl) vUrlEl.onchange = function() { saveEmbeddingApiOnly(); };
// ... 同模式 ...
var vConnBtn = byId('nes_embedding_connect');
if (vConnBtn) vConnBtn.onclick = function() {
    var cfg = { url: byId('nes_embedding_url').value.trim(), key: byId('nes_embedding_key').value.trim(), model: byId('nes_embedding_model').value.trim() };
    saveEmbeddingApiConfig(cfg);
    // test connection...
};
```

**开关关闭行为**：不渲染 URL/Key/Model 三个 input 行（仅显示 toggle 和说明文字）。

### 向量索引

```js
var vectorIndex = {
    entries: [],       // [{ id: stm_id, text: searchableText }]
    vectors: [],       // [Float32Array(1536), ...]  与 entries 同序
    idToIdx: {},       // stm_id → index in entries/vectors
    _dirty: false      // 是否有新 STM 尚未计算 embedding
};
```

**增量更新**：
1. 遍历 `allSTM`，对比 `idToIdx` 找到新条目
2. 为新条目批量计算 embedding（1 次 API 调用，input 为数组）
3. 追加到 `vectors` / `entries` / `idToIdx`
4. 遍历 `idToIdx`，删除已不存在的 STM 条目（消息回滚时清出）

**Cold Start**：索引为空时，首次调用计算全量 embedding。

### Embedding 文本构造

复用现有 `buildSearchableText(entry, aliasesMap)` 生成索引文本（与 BM25 索引文本相同），保证两路检索基于同一文档表示。

### 降级策略（零退化）

```js
if (!embeddingConfig || !embeddingConfig.url) {
    // 纯 BM25（行为与改动前完全一致）
    return filterCandidates(query, allSTM, allLTM, topK, minResults, aliasesMap);
}
// 混合检索
```

embedding API 调用失败 → 单路 BM25，不阻塞检索。

## 详细改动

### 文件 1：新增 `embedding.js`

```js
// src/core/engine/embedding.js

var EMBEDDING_DIM = 1536; // text-embedding-3-small

export function loadEmbeddingApiConfig() {
    try {
        var raw = localStorage.getItem('ne_embedding_api');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

export function saveEmbeddingApiConfig(config) {
    if (config && config.url) config.url = config.url.replace(/\/+$/, '');
    localStorage.setItem('ne_embedding_api', JSON.stringify(config));
}

export function isVectorSearchEnabled() {
    try {
        var raw = localStorage.getItem('ne_settings');
        return raw ? !!JSON.parse(raw).enableVectorSearch : false;
    } catch (e) { return false; }
}

export async function computeEmbedding(text) {
    var cfg = loadEmbeddingApiConfig();
    if (!cfg || !cfg.url) return null;
    // POST cfg.url with { model: cfg.model, input: text }
    // → 返回 Float32Array(1536)
}

export async function computeEmbeddings(texts) {
    var cfg = loadEmbeddingApiConfig();
    if (!cfg || !cfg.url) return null;
    // POST cfg.url with { model: cfg.model, input: texts[] }
    // → 返回 Float32Array[](N × 1536)
}

export function cosineSimilarity(a, b) {
    var dot = 0, normA = 0, normB = 0;
    for (var i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### 文件 2：新增 `retrieval-fusion.js`

```js
// src/core/engine/retrieval-fusion.js

var _vectorIndex = null; // 单例缓存（per chat）

export function resetVectorIndex() {
    _vectorIndex = null;
}

export async function ensureVectorIndex(allSTM, aliasesMap) {
    // 增量更新 _vectorIndex:
    //   1. 找到新 STM → computeEmbeddings(batch) → 追加
    //   2. 移除已消失的 STM → splice
    // 若 _vectorIndex === null → 全量构建
}

export function vectorSearch(queryEmbedding, vectorIndex, k) {
    // 遍历 vectors，cosineSimilarity → 取 topK
}

export function rrfFuse(bm25Candidates, vectorCandidates, k, topK) {
    // bm25Candidates: [{ entry, _score }, ...] 已按 _score 降序
    // vectorCandidates: [{ entry, similarity }, ...] 已按 similarity 降序
    // k: 平滑常数 (60)
    // → 合并 RRF 分数，返回 topK
}

export function getVectorIndex() { return _vectorIndex; }
```

### 文件 3：修改 `retrieval-filter.js`

在 `filterCandidates` 末尾追加混合路径：

```js
export async function filterCandidates(query, allSTM, allLTM, topK, minResults, aliasesMap) {
    // ... 现有 BM25 逻辑不变 ...

    if (!isVectorSearchEnabled()) {
        return bm25OnlyResults; // 开关关闭 → 纯 BM25
    }

    var embConfig = loadEmbeddingApiConfig();
    if (!embConfig || !embConfig.url) {
        // API 未配置 → 纯 BM25
        return bm25OnlyResults;
    }

    try {
        // 向量检索
        var queryEmb = await computeEmbedding(query);
        if (!queryEmb) throw new Error('embedding failed');
        await ensureVectorIndex(allSTM, aliasesMap);
        var vecResults = vectorSearch(queryEmb, getVectorIndex(), topK * 2);

        // RRF 融合
        var fusedResults = rrfFuse(bm25Results, vecResults, 60, topK);

        // 追加 LTM 目录（不变）
        // ...
        return finalResults;
    } catch (e) {
        console.warn('[NE] Vector search failed, falling back to BM25:', e);
        return bm25OnlyResults; // 降级
    }
}
```

### 文件 4：修改 `params.js`

新增自适应参数：

```js
export function computeFusionTopK(totalSTM) {
    return logScale(totalSTM, 15, 200, 15, 80);
    // 同 computeTopK，混合检索时扩大候选池
}
```

### 文件 5：修改 `adapter/index.js`

- 暴露 `resetVectorIndex` 到 `__ne_debug`
- 注册 `getVectorIndex` 用于调试面板

### 文件 6：新增 `adapter/panel.js`

- Embedding API 配置 UI（URL、Model、API Key）
- 向量索引状态显示（条目数、维度、上次更新）

## 不改动的部分

- `tokenize()` / `bm25Score()` — 不变
- `buildSearchableText()` — 不变（向量检索复用同一文本）
- `mergePipelines()` — 不变（接收融合后的候选列表）
- `buildRetrievalPrompt()` — 不变
- `callMemoryLLMWithTools()` — 不变
- `ambiguity.js` — 不变
- `injection.js` 的 `formatSmartContext` — 仅改 1 行（调用路径）

## 性能预估

| 场景 | 纯 BM25 | BM25+向量 | 备注 |
|------|---------|-----------|------|
| Cold Start（80 STM） | 0ms | ~1-3s | 批量 embedding 1 次 API 调用 |
| 每轮增量（+1 STM） | 0ms | ~200ms | query embedding + 增量 STM embedding |
| 每轮增量（+5 STM） | 0ms | ~300ms | 批量化 |
| 无新 STM | 0ms | ~100ms | 仅 query embedding |
| API 不可用 | BM25 正常 | BM25 正常（降级） | 零退化 |
| 客户端内存 | ~100KB | ~1.3MB | 200 STM × 1536d × 4B |

## 风险与边界

| 风险 | 缓解 |
|------|------|
| Embedding API 不可用 | 降级纯 BM25，不影响检索 |
| Cold Start 超时 | `filterCandidates` 调用处已有 async，不阻塞 SmartPush |
| 向量索引与 vault 不同步（消息回滚） | `resetVectorIndex()` 在 vault 清空时调用 |
| 查询 embedding 延迟导致 SmartPush 滞后 | query embedding 与 BM25 并行计算（`Promise.all`），不串行 |
| 多 Chat 切换 | `_vectorIndex` 需 per-chat 管理，key 为 chatId |

## 验证

1. `npm run build` 无错误
2. 无 embedding 配置 → SmartPush 行为与改动前一致（断言 pass）
3. 有 embedding 配置 → `[NE] Vector search: 80 STM indexed, fused topK=40`
4. `smartpush-14` 冒烟测试：无退化，注入质量持平或改善
5. 手动测试：创建含语义等价但词面不同记忆的对话，验证向量路召回
