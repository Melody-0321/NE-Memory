// benchmark-cost-latency.js — P1-bud 成本/时延列（benchmark-improvement-plan §9）
// 目标：在权威配置 + dev split 上，为每个检索方法记录每查询 wall-clock 与 token 消耗。
// 方法：BM25 / Vector / Lin / RRF / LinRerank（LATENCY 全程直测）
//   - BM25: filterCandidates 本地扫描 ms（无 token）
//   - Vector: 查询 embedding API ms + 本地 vectorSearch ms；token=embedding prompt_tokens
//   - Lin / RRF: BM25 + embedding + 本地 fusion（≈ vector 路径）
//   - LinRerank: 上述 + rerank 额外一跳 ms；token= embedding + rerank usage.total_tokens
// WS 列复用 output/per-query-scores.json（dev, 冻结 Lin α=0.20 权威运行）。
// 跑 >=3 轮，时延取每查询中位数。
// 用法：node benchmark-cost-latency.js
// 产出：output/cost-latency.md
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM } from './fixture.js';
import { loadSplitQueries } from './query-split-utils.js';
import { linearFuse, rrfFuse, rerankFuse } from './benchmark-fusions.js';
import { withProvenanceHeader } from './report-provenance.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var TOP_K_BM25 = 40, TOP_K_VEC = 144, TOP_K_FUSED = 40, ALPHA = 0.20, K_RERANK_POOL = 60;
var ROUNDS = 3;
var queries = loadSplitQueries();

function setEmb() {
  process.env.EMBEDDING_URL = config.url;
  process.env.EMBEDDING_MODEL = config.model;
  process.env.EMBEDDING_API_KEY = config.key;
  delete process.env.NE_BENCHMARK_VECTOR;
}

function median(arr) {
  var a = arr.slice().sort(function (x, y) { return x - y; });
  var n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

// 直连 provider 读 usage
async function probeEmbeddingTokens(text) {
  var r = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (config.key || '') },
    body: JSON.stringify({ model: config.model, input: text }),
  });
  var d = await r.json();
  return ((d.usage && d.usage.prompt_tokens) != null) ? d.usage.prompt_tokens : null;
}
async function probeRerankTokens(query, docs) {
  var r = await fetch('https://api.siliconflow.cn/v1/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (config.key || '') },
    body: JSON.stringify({ model: 'BAAI/bge-reranker-v2-m3', query: query, documents: docs, top_n: 10 }),
  });
  var d = await r.json();
  return ((d.meta && d.meta.tokens && d.meta.tokens.input_tokens) != null) ? d.meta.tokens.input_tokens : null;
}

function main() {
  console.log('=== P1-bud 成本/时延列 ===');
  console.log('dev 查询: ' + queries.length + ' | 轮数: ' + ROUNDS + ' | 方法: BM25/Vector/Lin/RRF/LinRerank');

  return (async function () {
    setEmb();
    resetVectorIndex('budidx');
    await ensureVectorIndex(allSTM, {}, 'budidx');
    var idx = getVectorIndex('budidx');
    var byId = {};
    allSTM.forEach(function (s) { byId[s.id] = s; });

    var bm25Times = [], embTimes = [], vecTimes = [], rerankTimes = [], linTimes = [], rrfTimes = [];
    var embTokens = [], rerankTokens = [];

    for (var round = 0; round < ROUNDS; round++) {
      for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        var qid = q.id;

        // BM25（本地）— 每轮换 chatId 代表冷索引
        var t0 = performance.now();
        var bm25Res = await filterCandidates(q.query, allSTM, allLTM, TOP_K_BM25, 3, {}, 'bud_' + round + '_' + qid);
        var bm25Ids = bm25Res.map(function (r) { return r.__id || r.id; });
        bm25Times.push(performance.now() - t0);

        // Vector（embedding API + 本地检索）
        var t1 = performance.now();
        var qe = await computeEmbedding(q.query);
        var embMs = performance.now() - t1;
        embTimes.push(embMs);

        var t2 = performance.now();
        var vecRes = vectorSearch(qe, idx, TOP_K_VEC);
        var vecIds = vecRes.map(function (v) { return v.entry.id; });
        vecTimes.push(performance.now() - t2);

        // 本地 fusion（Lin/RRF）
        var t3 = performance.now();
        var linIds = linearFuse(bm25Ids, vecIds, ALPHA, TOP_K_FUSED, 60);
        var rrfIds = rrfFuse(bm25Ids, vecIds, TOP_K_FUSED, 60);
        linTimes.push(performance.now() - t3);
        rrfTimes.push(performance.now() - t3);

        // Rerank（额外一跳）
        var t4 = performance.now();
        await rerankFuse(bm25Ids, vecIds, q.query, byId, TOP_K_FUSED, K_RERANK_POOL, ALPHA, 60);
        rerankTimes.push(performance.now() - t4);

        // token 探针（仅第 0 轮，取每查询一次）
        if (round === 0) {
          var t = await probeEmbeddingTokens(q.query);
          if (t != null) embTokens.push(t);
          var pool = linearFuse(bm25Ids, vecIds, ALPHA, K_RERANK_POOL, 60).slice(0, K_RERANK_POOL);
          var docs = pool.map(function (id) { var e = byId[id]; return e ? e.event : ''; }).filter(Boolean);
          if (docs.length) {
            var rt = await probeRerankTokens(q.query, docs);
            if (rt != null) rerankTokens.push(rt);
          }
        }
      }
      process.stdout.write('round ' + (round + 1) + '/' + ROUNDS + ' done\n');
    }

    // ── 读取 WS（复用 dev 权威 per-query-scores.json）──
    var ws = {};
    try {
      var pq = JSON.parse(readFileSync(join(__dirname, 'output', 'per-query-scores.json'), 'utf-8'));
      ['BM25', 'Vector', 'Lin', 'RRF', 'LinRerank'].forEach(function (m) {
        ws[m] = pq.queries.reduce(function (s, x) { return s + (x[m] || 0); }, 0) / pq.queries.length;
      });
    } catch (e) { ws = null; }

    function mnd(v) { return v.length ? median(v) : 0; }
    var rows = [
      { m: 'BM25', ws: ws ? ws.BM25 : null, lat: mnd(bm25Times), tok: 0, api: '无（本地）' },
      { m: 'Vector', ws: ws ? ws.Vector : null, lat: mnd(embTimes) + mnd(vecTimes), tok: median(embTokens) || 0, api: '需 embedding API（SiliconFlow bge-m3）' },
      { m: 'Lin', ws: ws ? ws.Lin : null, lat: mnd(bm25Times) + mnd(embTimes) + mnd(vecTimes) + mnd(linTimes), tok: median(embTokens) || 0, api: '同 Vector' },
      { m: 'RRF', ws: ws ? ws.RRF : null, lat: mnd(bm25Times) + mnd(embTimes) + mnd(vecTimes) + mnd(rrfTimes), tok: median(embTokens) || 0, api: '同 Vector' },
      { m: 'LinRerank', ws: ws ? ws.LinRerank : null, lat: mnd(bm25Times) + mnd(embTimes) + mnd(vecTimes) + mnd(rerankTimes), tok: (median(embTokens) || 0) + (median(rerankTokens) || 0), api: 'embedding + rerank（bge-reranker-v2-m3）' },
    ];

    // ── 报告 ──
    var L = [];
    L.push('# 成本 / 时延列（P1-bud）');
    L.push('');
    L.push('- 权威配置：bge-m3（embedding）+ BM25/summary + Lin α=0.20 fusion top40；dev split ' + queries.length + ' 条 × ' + ROUNDS + ' 轮');
    L.push('- 时延：中位数（每查询 wall-clock）；WS：复用于 dev 权威 per-query-scores.json（Lin 冻结配置）；token：provider usage 实测（embedding prompt_tokens / rerank total_tokens）');
    L.push('');
    L.push('## 1. 方法 ×（WS, 时延, token）');
    L.push('');
    L.push('| 方法 | WS | 每查询时延中位(ms) | 每查询 token | API 依赖 / 是否免费 |');
    L.push('|---|---|---|---|---|');
    rows.forEach(function (r) {
      L.push('| ' + r.m + ' | ' + (r.ws == null ? '—' : r.ws.toFixed(3)) + ' | ' + r.lat.toFixed(1) + ' | ' + r.tok + ' | ' + r.api + ' |');
    });
    L.push('');
    L.push('## 2. 原始时延分量（每查询中位数 ms）');
    L.push('');
    L.push('| 分量 | ms | 说明 |');
    L.push('|---|---|---|');
    L.push('| BM25 本地扫描 | ' + mnd(bm25Times).toFixed(1) + ' | filterCandidates（144 条语料，冷索引代表） |');
    L.push('| embedding API | ' + mnd(embTimes).toFixed(1) + ' | 查询输入 bge-m3（网络往返） |');
    L.push('| vectorSearch 本地 | ' + mnd(vecTimes).toFixed(1) + ' | 144 维点积全扫 |');
    L.push('| Lin/RRF 本地 fusion | ' + mnd(linTimes).toFixed(1) + ' | 内存内，可忽略 |');
    L.push('| rerank 额外一跳 | ' + mnd(rerankTimes).toFixed(1) + ' | rerankFuse 网络往返（bge-reranker-v2-m3） |');
    L.push('');
    L.push('## 3. Token 实测（provider usage，中位/条）');
    L.push('');
    L.push('- embedding 输入 token/查询：中位 **' + (median(embTokens) || 0) + '**（' + embTokens.length + ' 条）');
    L.push('- rerank 输入 token/查询（query + ' + K_RERANK_POOL + ' 候选文档）：中位 **' + (median(rerankTokens) || 0) + '**（' + rerankTokens.length + ' 条）');
    L.push('- 索引构建一性成本（非每查询）：144 条语料 embedding 一次，约 = corpus token 数，运行时 amortized 为零。');
    L.push('');
    var eff = rows.map(function (r) { return '**' + r.m + '** ' + r.lat.toFixed(0) + 'ms @ WS=' + (r.ws == null ? '—' : r.ws.toFixed(2)); });
    L.push('## 4. 判读');
    L.push('');
    L.push('- 时延排序：' + eff.join(' ／ ') + '。');
    L.push('- 若 rerank 额外一跳显著拖慢（相对 Vector/Lin 增量占比），博客"避免的成本"一节即可量化：WS 增益 vs 时延/token 代价。');
    L.push('- 免费性：BM25 纯本地零成本；Vector/Lin/RRF 需 embedding API（SiliconFlow 有免费额度但非零；8B 级 bge-m3 部署定性：单 GPU 可行的开源权重，规避按调用计费）；LinRerank 额外每查询 rerank 计一次（query+60 候选 token）。');

    var outDir = join(__dirname, 'output');
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'cost-latency.md');
    writeFileSync(outPath, withProvenanceHeader('cost-latency', L.join('\n')), 'utf-8');

    console.log('\n\n=== 时延中位(ms) ===');
    rows.forEach(function (r) { console.log(r.m + ': ' + r.lat.toFixed(1) + 'ms  ws=' + (r.ws == null ? '—' : r.ws.toFixed(3)) + '  tok=' + r.tok); });
    console.log('报告: ' + outPath);
  })();
}

main().catch(function (e) {
  console.error('P1-bud crashed:', e);
  process.exit(2);
});