# Plan — 检索细节等级分类器（Detail-Level Classifier）

## 摘要

在 RRF 融合后、实体块渲染前，用 LLM 替代当前硬编码的 Top-3 原文预取。LLM 分析查询需求，对每个 RRF 候选判定细节等级（原文级 / 摘要级 / 略摘要），使注入的记忆在"刚好需要的地方"展开原文、在不必要的地方节省 Token。

这是一个**可选实验路径**——做成独立函数 + 独立基准测试脚本，不做入生产管线。等基准数据对比后再决定是否合并。

---

## 当前状态

### 当前路径（A — Baseline）

```
filterCandidates(query, allSTM, allLTM, 40, 3, ...)
    │  返回: Array<{...entry字段, __type, __id, __relevance, __rrfOnly?}>
    ▼
mergePipelines(topCandidates, entityChains, allLTM, state, allSTM)
    │  返回: { map: Map<string, candidateItem>, threadIndex, availableChains }
    ▼
prefetchOriginalTexts(pipelineMap, chatMessages, visibleWindow, 3)  ← 硬编码 top-3
    │  entry._originalText 仅 top-3 有值
    ▼
groupCandidatesByEntity(pipelineMap, threadIndex) → entityGrouped
    ▼
buildEntityBlock(entityGrouped, {}, activeChars, entityChains)
    │  formatEntry(e): 始终渲染完整摘要
    │  如 `_originalText` 存在 → 追加 "> 原文引用"
    ▼
compileRetrievalBudget(...) → parts.join('\n\n') → 注入
```

**问题**：
- Top-3 是纯排序定的，不区分"信息需要原文展开" vs "摘要已足够" vs "仅背景"
- 排名第 4-40 的条目即使有高信息价值，也得不到原文
- 排名第 1 如果摘要已经写得很清楚，原文引用是浪费 Token

### 实验路径（B — Classified）

```
filterCandidates(query, allSTM, allLTM, 40, 3, ...)
    ▼
mergePipelines(topCandidates, entityChains, allLTM, state, allSTM)
    ▼
prefetchOriginalTexts(pipelineMap, chatMessages, visibleWindow, 40)  ← 全量预取
    ▼
classifyDetailLevels(query, pipelineMap, entityChains, state, chatId, llmFn)
    │  返回: { entryId: { level: 1|2|3, reason } }
    ▼
groupCandidatesByEntity(pipelineMap, threadIndex)
    │  entry._detailLevel 已标注
    ▼
buildEntityBlockLeveled(entityGrouped, {}, activeChars, entityChains)
    │  Level 3 → 摘要 + 原文引用
    │  Level 2 → 完整摘要（无原文）
    │  Level 1 → 时间+场景+首句（截断 60 字符）
    ▼
compileRetrievalBudget(...) → parts.join('\n\n') → 注入
```

**变化**：
- `prefetchOriginalTexts` 的 `topK` 从 3 改为全量传入 40
- 新增 `classifyDetailLevels` 做 LLM 分类
- 新增 `buildEntityBlockLeveled` 做 Level 感知渲染
- 卷成一个独立函数 `formatSmartContextClassified`，并行于 `formatSmartContext`

---

## 基准测试设计

### 对比框架

参照现有 [benchmark-packaging.js](file:///d:/SillyTavern/xm/ne-memory/test/retrieval-benchmark/benchmark-packaging.js) 的双路径对比模式：

```
┌─────────────────────────────────────────────────────────┐
│        benchmark-detail-level.js (新增)                  │
│                                                          │
│  for each query in queries.js:                           │
│    ├─ 跑 Path A (当前): buildFlatContext +                │
│    │     buildGroupedContext (Top-3 prefetch)             │
│    │       → 测 token 数 + LLM Judge 评分                 │
│    │                                                      │
│    └─ 跑 Path B (实验): buildClassifiedContext             │
│          (prefetch ALL → classifyDetailLevels             │
│           → buildEntityBlockLeveled)                      │
│            → 测 token 数 + L1/L2/L3 分布                  │
│              + LLM Judge 评分                              │
│                                                          │
│  最终输出对比报告到 output/detail-level-report.md         │
└─────────────────────────────────────────────────────────┘
```

### 指标

| 指标 | 说明 | 数据来源 |
|------|------|---------|
| **注入 Token 数** | 每条 query 的最终注入文本字节数 | `measure-context-size.js` 已有工具 |
| **L1/L2/L3 分布** | 多少条目被分到各等级 | `classifyDetailLevels` 返回值 |
| **LLM Judge 评分** | 1-5 分，裁判能否根据注入记忆回答问题 | 复用 `benchmark-llm-judge.js` 的 `judgeQuery` |
| **Prefetch 原文量** | Path B 的预取原文总字符数 vs Path A | 日志 |

### LLM 调用

基准测试在 Node.js 环境运行（非 SillyTavern 浏览器环境），不能调用 `callMemoryLLM`（依赖 `runtime.generateRaw`）。因此：

- **`classifyDetailLevels` 接受 `llmFn` 参数**——在浏览器中传入 `callMemoryLLM`，在基准测试中传入 `fetch` 包装函数
- 基准测试从 `config.json` 读取分类 LLM 的 API 配置

```javascript
// 基准测试中的 llmFn：
async function classifierLLM(messages, options) {
    var response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({
            model: CLASSIFIER_MODEL,
            messages: messages,
            temperature: 0,
            max_tokens: 1000,
        }),
    });
    var data = await response.json();
    return data.choices[0].message;
}
```

---

## 具体实现

### 变更 1：新增 `classifyDetailLevels` 函数

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

**签名**：

```javascript
/**
 * @param {string} query — SmartPush 检索查询
 * @param {Map<string, candidateItem>} pipelineMap — mergePipelines 输出的 map
 * @param {Object} entityChains
 * @param {Object} state — vault.content.state
 * @param {string} chatId
 * @param {Function} llmFn — (messages: Array, options: Object) => Promise<{content: string}>
 * @returns {Promise<Object>} { entryId: { level: 1|2|3, reason: string } }
 */
export async function classifyDetailLevels(query, pipelineMap, entityChains, state, chatId, llmFn) {
```

**内部逻辑**：

```javascript
export async function classifyDetailLevels(query, pipelineMap, entityChains, state, chatId, llmFn) {
    var entries = [];
    pipelineMap.forEach(function(v) {
        // 跳过目录条目和 relevance=0 的条目
        if (v._isDirectory || (v.sources && v.sources.indexOf('ltm_dir') >= 0)) return;
        if (!v.relevance || v.relevance <= 0) return;
        entries.push(v);
    });

    if (entries.length === 0) return {};

    // 构建候选块（含摘要 + 原文）
    var entryBlocks = entries.map(function(e, idx) {
        var block = '[' + (idx + 1) + '] id:' + e.entry.id + '\n';
        block += '  time: ' + (e.entry.period || '?') + '\n';
        block += '  scene: ' + (e.entry.scene || '') + '\n';
        block += '  summary: ' + (e.entry.event || e.entry.summary || '') + '\n';
        if (e._originalText) {
            block += '  original: ' + e._originalText.replace(/\n/g, ' ') + '\n';
        } else {
            block += '  original: (in window, already visible)\n';
        }
        return block;
    }).join('\n');

    // System prompt（精简版，基准测试用）
    var system = [
        'Detail-level classifier for memory retrieval.',
        'Story time: ' + (state.story_time || 'unknown'),
        'Scene: ' + (state.story_scene || 'unknown'),
        'Active characters: ' + (getActiveCharacters(state) || []).join(', '),
        '',
        'Task: For each candidate entry, assign a detail level.',
        '  Level 3 (expand): the query needs original text details, summary alone is insufficient',
        '  Level 2 (summary): relevant to query, summary has enough info, original text is redundant',
        '  Level 1 (brief): background/continuity only, short reference line suffice',
        '',
        'Rules:',
        '- If summary already clearly answers the query → Level 2, not 3',
        '- If summary is vague (e.g. "something happened") and query asks for specifics → Level 3',
        '- If entry only provides timeline context → Level 1',
        '- Prioritize Level 3 for entries directly answering the query',
        '',
        'Output STRICT JSON only:',
        '{"levels": {"entry_id": {"level": 3, "reason": "short reason"}, ...}}',
    ].join('\n');

    var user = 'Query: ' + query + '\n\nCandidates:\n' + entryBlocks;

    var messages = [
        { role: 'system', content: system },
        { role: 'user', content: user }
    ];

    try {
        var result = await llmFn(messages, { temperature: 0, max_tokens: 1000 });
        var text = result && result.content ? result.content : String(result || '');
        // JSON 解析容错
        var parsed;
        try {
            parsed = JSON.parse(text.trim());
        } catch (e) {
            // 尝试去掉 markdown 包裹
            var stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            parsed = JSON.parse(stripped);
        }
        return (parsed && parsed.levels) ? parsed.levels : {};
    } catch (e) {
        // 失败时全 Level 2
        console.warn('[NE] classifyDetailLevels failed:', e.message || e);
        var fallback = {};
        entries.forEach(function(e) { fallback[e.entry.id] = { level: 2, reason: 'fallback' }; });
        return fallback;
    }
}
```

### 变更 2：`prefetchOriginalTexts` 的 topK 改为可配置

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js#L519)

当前硬编码 `prefetchOriginalTexts(pipelineMap, chatMessages, visibleWindow, 3)`。改动：

```javascript
// 原函数签名：
function prefetchOriginalTexts(mapObj, chatMessages, visibleWindow, topK) {
    topK = topK || 3;
    // ...
}

// 改为 topK 默认保持 3（不影响现有调用），但接受传入更大值
// formatSmartContext 中现有调用：prefetchOriginalTexts(..., 3)
// formatSmartContextClassified 中调用：prefetchOriginalTexts(..., 40)
```

**不变**：
- `prefetchOriginalTexts` 的签名不改变
- 现有调用点的 `topK=3` 不变
- 每条消息原文截断 200 字符的每消息上限不变

### 变更 3：新增 `buildEntityBlockLeveled`

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

**签名**：

```javascript
export function buildEntityBlockLeveled(entityGrouped, entityAnnotations, activeChars, entityChains) {
```

与 `buildEntityBlock` 的输入完全相同，区别仅在 `formatEntry`（内部条目渲染函数）：

```javascript
function formatEntry(e) {
    var timePart = e.entry.period || '';
    var scene = e.entry.scene || '';
    var event = e.entry.event || e.entry.summary || '';
    var level = e._detailLevel || 2;

    if (level === 1) {
        var brief = event.length > 60 ? event.substring(0, 60) + '...' : event;
        return ' [' + timePart + '] ' + (scene ? scene + ': ' : '') + brief;
    }

    var line = ' [' + timePart + '] ' + (scene ? scene + ': ' : '') + event;

    if (level === 3 && e._originalText) {
        line += '\n   > ' + e._originalText.replace(/\n/g, '\n   > ');
    }

    return line;
}
```

其余逻辑（活跃角色优先、miss-run 折叠、未分配条目、refs 标注）与 `buildEntityBlock` 完全相同。

### 变更 4：新增 `formatSmartContextClassified`

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

这是一个**独立函数**，并行于 `formatSmartContext`，不修改其任何逻辑：

```javascript
export async function formatSmartContextClassified(vault, chatMessages, budget, chatId, llmFn) {
    var allSTM = vault.content.stm_entries || [];
    var allLTM = vault.content.ltm_entries || [];
    var state = vault.content.state || {};

    if (allSTM.length === 0) return buildStateOnlyInjection(vault);

    // 1. Query 构建（同 formatSmartContext）
    var visibleWindow = computeVisibleWindow(chatMessages);
    var query = buildRetrievalQuery(chatMessages, state);

    // 2. BM25 + 可选 RRF（同 formatSmartContext）
    var topCandidates = await filterCandidates(query, allSTM, allLTM, 40, 3, {}, chatId);

    // 3. Entity chains + Merge（同 formatSmartContext）
    var entityNames = extractEntityNames(query, vault.content);
    var entityChains = lookupEntityChains(vault.content, entityNames);
    var pipelineMerged = mergePipelines(topCandidates, entityChains, allLTM, state, allSTM);
    if (!pipelineMerged || !pipelineMerged.map) return buildStateOnlyInjection(vault);

    // 4. 全量预取原文（替代原来的 top-3）
    prefetchOriginalTexts(pipelineMerged.map, chatMessages, visibleWindow, 40);

    // 5. 细节等级分类
    var detailLevels = {};
    try {
        detailLevels = await classifyDetailLevels(query, pipelineMerged.map, entityChains, state, chatId, llmFn);
    } catch (e) {
        console.warn('[NE] classifyDetailLevels failed, all L2:', e.message || e);
    }

    // 6. 标注 level
    pipelineMerged.map.forEach(function(v, id) {
        if (detailLevels[id]) {
            v._detailLevel = detailLevels[id].level;
            v._detailReason = detailLevels[id].reason;
        } else {
            v._detailLevel = 2;
        }
    });

    // 7. Entity grouping + rendering
    var entityGrouped = groupCandidatesByEntity(pipelineMerged.map, pipelineMerged.threadIndex);
    var activeChars = getActiveCharacters(state);
    var entityBlock = buildEntityBlockLeveled(entityGrouped, {}, activeChars, entityChains);

    // 8. 组装输出（同 formatSmartContext）
    var parts = [];
    if (vault.memory_system_prompt) parts.push(vault.memory_system_prompt);
    parts.push(entityBlock);
    if (pipelineMerged.availableChains) {
        // 场景外链逻辑（同现有）
    }
    if (/* retrievalBudgetEnabled */) {
        var budgetText = compileRetrievalBudget(vault.content, query, entityNames, entityChains, 300);
        if (budgetText) parts.push(budgetText);
    }

    return parts.join('\n\n');
}
```

### 变更 5：新增基准测试脚本

**文件**: `test/retrieval-benchmark/benchmark-detail-level.js`（新建）

**结构**（参照 `benchmark-packaging.js` 和 `benchmark-llm-judge.js`）：

```javascript
// 运行方式: node test/retrieval-benchmark/benchmark-detail-level.js

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { buildEntityBlock } from '../../src/core/engine/injection.js';
import { buildEntityBlockLeveled, classifyDetailLevels } from '../../src/core/engine/injection.js';
import { allSTM, allLTM, allChatMessages } from './fixture.js';
import { queries } from './queries.js';
import { avg } from './metrics.js';
import { linearFuse } from './benchmark-fusions.js';

// Config
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_classifier__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;

// LLM 分类器调用（基准测试用 fetch 包装）
async function classifierLLM(messages, options) {
    var response = await fetch(config.judge_v4.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.judge_v4.key },
        body: JSON.stringify({
            model: config.judge_v4.model,
            messages: messages,
            temperature: 0,
            max_tokens: 1000,
        }),
    });
    var data = await response.json();
    return data.choices[0].message;
}

// LLM Judge（复用 benchmark-llm-judge.js 的 judgeQuery 逻辑）
var JUDGE_URL = config.judge_v4.url;
var JUDGE_KEY = config.judge_v4.key;
var JUDGE_MODEL = config.judge_v4.model;

async function judgeQuery(queryText, context, label) {
    // ... (同 benchmark-llm-judge.js 的实现)
}

// 上下文构建 — Path A (Baseline: Top-3 prefetch)
function buildBaselineContext(mergedMap, grouped, activeChars, entityChains) {
    var entityBlock = buildEntityBlock({ groups: grouped.groups, unassigned: grouped.unassigned }, {}, activeChars, entityChains);
    return entityBlock;
}

// 上下文构建 — Path B (Classified: full prefetch + level classifier)
function buildClassifiedContext(mergedMap, grouped, activeChars, entityChains, detailLevels) {
    mergedMap.forEach(function(v, id) {
        if (detailLevels[id]) {
            v._detailLevel = detailLevels[id].level;
        } else {
            v._detailLevel = 2;
        }
    });
    var entityBlock = buildEntityBlockLeveled({ groups: grouped.groups, unassigned: grouped.unassigned }, {}, activeChars, entityChains);
    return entityBlock;
}

// ─── Main ───
async function main() {
    console.log('=== Detail-Level Classifier Benchmark ===\n');

    // 1. Setup
    resetVectorIndex(CHAT_ID);
    var queryEmb = await computeEmbedding('benchmark setup query');
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);

    var results = [];

    // 2. 对每个 query 跑双路径
    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        console.log('[' + (qi + 1) + '/' + queries.length + '] ' + q.query.substring(0, 50) + '...');

        // Step 1: BM25 + Vector 召回（两条路径共享）
        var bm25Results = await filterCandidates(q.query, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
        var qEmb = await computeEmbedding(q.query);
        var vecResults = vectorSearch(qEmb, vecIdx, TOP_K_VEC);
        // ... 线性融合 ...

        // Step 2: mergePipelines（两条路径共享）
        var merged = await mergePipelines(bm25Results, entityChains, allLTM, q.state, allSTM);
        var grouped = groupCandidatesByEntity(merged.map, merged.threadIndex);

        // Step 3: 深拷贝 map，两条路径各自独立 prefetch
        var mapA = new Map();
        merged.map.forEach(function(v, k) { mapA.set(k, JSON.parse(JSON.stringify(v))); });
        var mapB = new Map();
        merged.map.forEach(function(v, k) { mapB.set(k, JSON.parse(JSON.stringify(v))); });

        // ── Path A: Baseline (Top-3 prefetch) ──
        prefetchOriginalTexts(mapA, allChatMessages, 3);
        var ctxBaseline = buildBaselineContext(mapA, grouped, activeChars, entityChains);

        // ── Path B: Classifier (全量 prefetch) ──
        prefetchOriginalTexts(mapB, allChatMessages, 40);
        var detailLevels = await classifyDetailLevels(q.query, mapB, entityChains, state, CHAT_ID, classifierLLM);
        var ctxClassified = buildClassifiedContext(mapB, grouped, activeChars, entityChains, detailLevels);

        // Step 8: Token count
        var baselineTokens = ctxBaseline.length;
        var classifiedTokens = ctxClassified.length;
        var tokenDelta = classifiedTokens - baselineTokens;
        var tokenDeltaPct = baselineTokens > 0 ? (tokenDelta / baselineTokens * 100).toFixed(1) + '%' : 'N/A';

        // Step 9: L1/L2/L3 count
        var levelCounts = { L1: 0, L2: 0, L3: 0 };
        Object.values(detailLevels).forEach(function(d) {
            if (d.level === 1) levelCounts.L1++;
            else if (d.level === 3) levelCounts.L3++;
            else levelCounts.L2++;
        });

        // Step 10: LLM Judge (both)
        var judgeBaseline = await judgeQuery(q.query, ctxBaseline, 'Baseline');
        var judgeClassified = await judgeQuery(q.query, ctxClassified, 'Classified');

        results.push({
            query: q.query.substring(0, 50),
            baselineTokens: baselineTokens,
            classifiedTokens: classifiedTokens,
            tokenDelta: tokenDelta,
            tokenDeltaPct: tokenDeltaPct,
            levelCounts: levelCounts,
            judgeBaseline: judgeBaseline.score,
            judgeClassified: judgeClassified.score,
            judgeDelta: judgeClassified.score - judgeBaseline.score,
        });

        console.log('  Tokens: ' + baselineTokens + ' → ' + classifiedTokens + ' (' + tokenDeltaPct + ')');
        console.log('  Levels: L1=' + levelCounts.L1 + ' L2=' + levelCounts.L2 + ' L3=' + levelCounts.L3);
        console.log('  Judge: ' + judgeBaseline.score + ' → ' + judgeClassified.score + (judgeClassified.score >= judgeBaseline.score ? ' ✓' : ' ✗'));
    }

    // 3. 聚合报告
    generateReport(results);
}

main().catch(console.error);
```

### 变更 6：export 补充

**文件**: [injection.js](file:///d:/SillyTavern/xm/ne-memory/src/core/engine/injection.js)

确认以下函数有 `export`：

- `getActiveCharacters` — 当前是私有函数（L40-70 附近），需确认或改为内部访问
- `buildEntityBlock` — 已 export
- `classifyDetailLevels` — 新增 export
- `buildEntityBlockLeveled` — 新增 export
- `formatSmartContextClassified` — 新增 export

如果 `getActiveCharacters` 是私有函数，可以在 `classifyDetailLevels` 内部直接使用（同文件内），也可以让基准测试传 `activeChars` 参数。

---

## 文件变更清单

| 文件 | 变更 | 影响 |
|------|------|------|
| `injection.js` | 新增 `classifyDetailLevels`（~60 行） | 🔴 核心 |
| `injection.js` | 新增 `buildEntityBlockLeveled`（~30 行，复用 buildEntityBlock 的其余逻辑） | 🔴 核心 |
| `injection.js` | 新增 `formatSmartContextClassified`（~70 行） | 🔴 核心 |
| `injection.js` | `prefetchOriginalTexts` 的 topK 默认值保持不变（3），新路径传入 40 | 🟡 不改变现有调用 |
| `test/retrieval-benchmark/benchmark-detail-level.js` | 新建（~250 行） | 🔴 核心 |
| `injection.js` | `getActiveCharacters` 确认可被 `classifyDetailLevels` 内部访问 | 🟢 确认即可 |

**不修改**：
- `formatSmartContext` — 完全不碰
- `buildEntityBlock` — 完全不碰
- `retrieval.js` / `retrieval-filter.js` / `retrieval-fusion.js` — 不碰
- `llm.js` — 不碰（分类 LLM 调用由传入的 `llmFn` 参数处理）
- `events.js` — 不碰
- 现有基准测试脚本 — 不碰（新建独立脚本）

---

## LLM 分类器的性价比评估

### Token 成本

| 组成部分 | 约 token 数 |
|---------|-----------|
| System prompt（英文） | ~250 |
| Candidates 块（40 条目 × ~200 chars/条） | ~3,000-4,000 |
| 故事时间 + 场景 + active chars | ~50 |
| 输出（JSON） | ~200-400 |
| **合计（每条 query）** | **~3,500-4,700** |

28 条 query × ~4,500 = **~126k-132k input tokens / 轮基准测试**。

### 延迟叠加

| 阶段 | 基准测试 | 生产环境 |
|------|---------|---------|
| 分类 LLM 调用 | ~1-3s（单次 DeepSeek-V3） | ~1-3s（假设同模型或更轻量） |
| 主 LLM（检索合成） | — | ~3-5s |
| **总延迟** | ~1-3s | **~4-8s（约翻倍）** |

### 建议

基准测试报告中增加以下记录项：
- 分类器每 query 的 **input/output token 数**（从 API 响应中提取 `usage` 字段）
- 分类器每 query 的 **耗时**
- 最终报告中按 "token 节省量 / 分类器 token 成本" 计算**性价比比**（token saved per classifier token spent）

> 如果性价比比 < 1（即分类器消耗的 token 比它节省的更多），则实验值得怀疑。

---

## 与现有计划的协同

- **Diversity Gate（DPP/MMR）**：如果实施，在 `classifyDetailLevels` 之前执行，减少分类 LLM 的输入量
- **Plan C（注入预算控制）**：如果实施，在 `buildEntityBlockLeveled` 之后执行。Level 3 较多 → 注入量大 → Plan C 的轮转摊薄策略优先压缩 state_table
- **基准测试集成**：`benchmark-detail-level.js` 独立运行，产出 `output/detail-level-report.md`，和现有 `packaging-comparison.md`、`llm-judge-report.md` 并列

---

## 假设与决策

1. **`llmFn` 参数模式**：`classifyDetailLevels` 接受 `llmFn` 参数而非直接依赖 `callMemoryLLM`——浏览器中传 `callMemoryLLM`，基准测试中传 `fetch` 包装
2. **不修改现有代码流程**：`formatSmartContext` 完全不碰，实验路径走独立函数
3. **prefetchOriginalTexts 签名不变**：topK 默认 3，新路径传 40；MAX_TOTAL 硬上限已删除
4. **基准测试用 `fixture.js` 的 `allChatMessages`**：252 条消息足够提供原文信息
5. **分类 LLM 失败 → 全 Level 2**：回退效果 = 当前管线（所有条目渲染完整摘要，同 Path A）。JSON parse error 时重试 1 次
6. **基准测试产物**：`output/detail-level-report.md`，含逐 query 的 token 对比、Level 分布、LLM Judge 评分
7. **深拷贝隔离**：Path A 和 Path B 各用独立 map 深拷贝，互不污染
8. **LLM Judge ≠ 分类器模型**：避免循环论证。分类器用 `config.judge_v4` 配置，LLM Judge 用另一模型
9. **分类器 token 消耗记录**：基准测试日志记录每 query 的 classifier input/output token 数和耗时，计入性价比比

---

## 评估风险

### 🔴 循环论证风险（LLM 裁判自己裁判自己）

分类器和 LLM Judge 如果使用同一个模型，存在系统性偏好风险——同一模型倾向于给自己认为合理的 Level 分布打高分，而另一个模型可能有不同判断。

**缓解措施**：
- 基准测试的 LLM Judge 和分类器使用**不同模型**：分类器用 `config.judge_v4` 配置的 deepseek-v4-flash，LLM Judge 用另一个模型（如现有 `benchmark-llm-judge.js` 的 Pro/deepseek-ai/DeepSeek-V3，或追加一次 GPT-4o judge 调用作为交叉验证）
- 在报告中标明 "Judge 模型 ≠ 分类器模型，交叉验证风险可控"

### 🟡 Level 1 条目的渲染位置歧义

Level 1 条目的截断渲染（60 字符）在实体组内与其他完整 L2 条目混排时，LLM 可能误判为"记忆系统出错"而非"故意精简"。

```text
### 林墨 (12 events, 3 hits, 2 refs)
 1. 龙泉山庄: 林墨初遇苏云 — 完整摘要渲染  [L2]
 2. 驿站: 赵琳透露地图...                    [L1 — 截断到 60 chars]
 3. 拍卖行: 竞价风波 — 完整摘要渲染          [L2]
```

**缓解措施**：L1 渲染加明确标记前缀：
```javascript
if (level === 1) {
    var brief = event.length > 60 ? event.substring(0, 60) + '...' : event;
    return ' [背景] [' + timePart + '] ' + (scene ? scene + ': ' : '') + brief;
}
```

### 🟡 分类器的过度保守倾向

LLM 在不确定时倾向于把大多数条目判为 Level 2（最安全的"完整摘要"）。如果 L3 激活率过低（如 <20%），则实验效果被稀释——结果接近 Path A（全 L2）与 Path B 的细微差异。

**缓解措施**：基准测试报告中增加 L3 激活率统计，并在 L3 激活率 < 10% 时标注"结果不可信"。

### 🟢 分类器失败模式细化

当前 fallback 策略：API timeout / JSON parse error → 全 Level 2（等价 Path A）。但不同类型失败需要不同处理：

| 失败类型 | 回退策略 | 
|---------|---------|
| API timeout / network error | 全 L2（✅ 合理，快速降级） |
| JSON parse error | 重试 1 次后全 L2 |
| LLM 输出有效 JSON 但全 L3 | 保留 L3 但自动压缩到 top-3 给 _originalText（防止全量原文爆炸） |
| LLM 输出有效 JSON 但全 L1 | 自动恢复为全 L2 |

`classifyDetailLevels` 内部的 `llmFn` 调用应包裹**重试逻辑**（最多 1-2 次）：

```javascript
async function safeClassify(messages, llmFn, maxRetries) {
    for (var attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await llmFn(messages, { temperature: 0 });
        } catch (e) {
            if (attempt === maxRetries - 1) throw e;
        }
    }
}
```

### 🟢 llmFn 参数签名

`classifyDetailLevels` 接受 `llmFn` 参数解耦了浏览器/基准测试依赖，但缺少两项信息：

1. **调用是同步还是异步** → 必须是 `async`（已隐含）
2. **是否支持重试** → 建议外部包装 `safeClassify`（见上）
3. **超时控制** → `options.timeout` 传入 `llmFn` 以便 API 调用侧设置超时

```javascript
// 生产环境使用：
var detailLevels = await classifyDetailLevels(query, map, chains, state, chatId, safeClassify.bind(null, _, callMemoryLLM, 2));

// 基准测试使用：
var detailLevels = await classifyDetailLevels(query, map, chains, state, CHAT_ID, safeClassify.bind(null, _, classifierLLM, 2));
```

---

## 验证方案

### 基准测试运行

```bash
node test/retrieval-benchmark/benchmark-detail-level.js
```

产出 `output/detail-level-report.md`，含：
- 逐 query 的 Path A vs Path B **token 数**和 **LLM Judge 分数**
- L1/L2/L3 **分布统计表**（含 **L3 激活率**）
- **聚合对比指标**（平均 token 节省、Judge 分数变化、胜场统计）
- 分类器每 query 的 **input/output token 数**（从 API 响应提取）和 **耗时**
- **性价比比** = token 节省量 / 分类器 token 消耗量
- **循环论证校验**：注明 Judge 模型 ≠ 分类器模型，L3 激活率 < 10% 时标注"结果不可信"

### 单元测试

新增 `test/detail-level-classifier.test.js`：
- `classifyDetailLevels` 返回结构正确（`{ entryId: { level, reason } }`）
- `llmFn` 失败时回退全 Level 2
- `buildEntityBlockLeveled` 正确渲染 Level 1/2/3
- 空输入返回空对象

### 集成测试

```bash
npm run test:unit
npm run test:ratchet
```

---

## 实施顺序

1. `prefetchOriginalTexts` 确认 topK 可配置（变更 2，不改变现有调用）
2. 新增 `classifyDetailLevels` 函数（变更 1，injection.js）
3. 新增 `buildEntityBlockLeveled` 函数（变更 3，injection.js）
4. 新增 `formatSmartContextClassified` 函数（变更 4，injection.js）
5. 新增基准测试脚本（变更 5，benchmark-detail-level.js）
6. 单元测试 + 集成测试
