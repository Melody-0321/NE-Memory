// NE-Memory Embedding Model Benchmark — Zhipu AI
// Run: node test/retrieval-benchmark/benchmark-zhipu.js
// Compares Zhipu embedding-2 vs embedding-3 with SillyTavern bge-m3 baseline

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM, entityToStmIds } from './fixture.js';
import { loadSplitQueries, outputDirFor } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader } from './report-provenance.js';
import { precisionAtK, recallAtK, ndcgAtK, mrr, hitAtK, precisionAtK_active, hitAtK_active, weightedScore, avg } from './metrics.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);

var ZHIPU_KEY = '778c57a7a5ae40039e0e78bb00d852b4.DyAB4vVY3m9rrADc';
var ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';

var CHAT_ID = '__bench_zhipu__';
var TOP_K = 40;

var MODELS = [
    { name: 'embedding-2', label: 'Zhipu/embed-2', dim: 1024, note: 'v2, 1024d' },
    { name: 'embedding-3', label: 'Zhipu/embed-3', dim: 2048, note: 'v3, 2048d, latest' },
];

function setModel(modelName) {
    process.env.EMBEDDING_URL = ZHIPU_URL;
    process.env.EMBEDDING_MODEL = modelName;
    process.env.EMBEDDING_API_KEY = ZHIPU_KEY;
    delete process.env.NE_BENCHMARK_VECTOR;
}

async function buildVectorIndex(modelName) {
    setModel(modelName);
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    return getVectorIndex(CHAT_ID);
}

async function runVectorRound(modelName, vecIdx) {
    setModel(modelName);
    var perQuery = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var queryEmb = await computeEmbedding(q.query);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K);
        var ids = vecResults.map(function(v) { return v.entry.id; });
        var gt = q.groundTruth;

        var s = {
            p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
            r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
            ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
            hit3: hitAtK(ids, gt, 3),
            p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
            hit5a: q.activeEntities ? hitAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
        };
        s.ws = weightedScore(s);
        perQuery.push({ ids: ids, scores: s });
    }
    return perQuery;
}

async function runRRFLinRound(modelName, bm25Ids, vecIds) {
    var perQuery = [];
    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        var fusedIds = linearFuse(bm25Ids[qi], vecIds[qi], 0.20, TOP_K, 60);
        var gt = q.groundTruth;

        var s = {
            p5: precisionAtK(fusedIds, gt, 5), p10: precisionAtK(fusedIds, gt, 10), p20: precisionAtK(fusedIds, gt, 20),
            r5: recallAtK(fusedIds, gt, 5), r10: recallAtK(fusedIds, gt, 10), r20: recallAtK(fusedIds, gt, 20),
            ndcg10: ndcgAtK(fusedIds, gt, 10), mrr: mrr(fusedIds, gt), hit5: hitAtK(fusedIds, gt, 5),
            hit3: hitAtK(fusedIds, gt, 3),
            p5a: q.activeEntities ? precisionAtK_active(fusedIds, gt, q.activeEntities, entityToStmIds, 5) : 0,
            hit5a: q.activeEntities ? hitAtK_active(fusedIds, gt, q.activeEntities, entityToStmIds, 5) : 0,
        };
        s.ws = weightedScore(s);
        perQuery.push({ ids: fusedIds, scores: s });
    }
    return perQuery;
}

function aggregate(perQuery, label) {
    var sQuery = perQuery.map(function(q) { return q.scores; });
    return {
        label: label,
        p5: avg(sQuery.map(function(s) { return s.p5; })),
        p10: avg(sQuery.map(function(s) { return s.p10; })),
        ndcg10: avg(sQuery.map(function(s) { return s.ndcg10; })),
        mrr: avg(sQuery.map(function(s) { return s.mrr; })),
        hit3: avg(sQuery.map(function(s) { return s.hit3; })),
        hit5: avg(sQuery.map(function(s) { return s.hit5; })),
        r10: avg(sQuery.map(function(s) { return s.r10; })),
        r20: avg(sQuery.map(function(s) { return s.r20; })),
        p5a: avg(sQuery.map(function(s) { return s.p5a; })),
        ws: avg(sQuery.map(function(s) { return s.ws; })),
    };
}

function f(v, d) { d = d || 3; return v.toFixed(d); }

async function main() {
    console.log('=== NE-Memory Embedding Model Benchmark: Zhipu AI ===\n');
    console.log('Models: ' + MODELS.map(function(m) { return m.label; }).join(', '));
    console.log('API: ' + ZHIPU_URL);
    console.log('Metric: Lin α=0.20, k=60 (RRF weighted linear fusion)\n');

    // BM25 baseline
    process.stdout.write('Running BM25 baseline ... ');
    var bm25PerQuery = [], bm25Ids = [];
    delete process.env.NE_BENCHMARK_VECTOR;
    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var results = await filterCandidates(q.query, allSTM, allLTM, TOP_K, 3, {}, CHAT_ID);
        var ids = results.map(function(r) { return r.__id || r.id; });
        var gt = q.groundTruth;
        var s = {
            p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
            r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
            ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
            hit3: hitAtK(ids, gt, 3),
            p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
            hit5a: q.activeEntities ? hitAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
        };
        s.ws = weightedScore(s);
        bm25PerQuery.push({ ids: ids, scores: s });
        bm25Ids.push(ids);
    }
    var bm25Agg = aggregate(bm25PerQuery, 'BM25');
    console.log('done. NDCG@10=' + f(bm25Agg.ndcg10) + ' WS=' + f(bm25Agg.ws));

    var modelResults = [];

    for (var mi = 0; mi < MODELS.length; mi++) {
        var model = MODELS[mi];
        process.stdout.write('\nRunning ' + model.label + ' (' + model.name + ') ... ');

        var startTs = Date.now();
        var vecIdx = await buildVectorIndex(model.name);
        console.log('index built (' + model.dim + 'd)');

        process.stdout.write('  vector-only ... ');
        var vecPerQuery = await runVectorRound(model.name, vecIdx);
        var vecIds = vecPerQuery.map(function(q) { return q.ids; });
        var vecAgg = aggregate(vecPerQuery, 'Vector');
        console.log('NDCG@10=' + f(vecAgg.ndcg10));

        process.stdout.write('  Lin α=0.20 ... ');
        var linPerQuery = await runRRFLinRound(model.name, bm25Ids, vecIds);
        var linAgg = aggregate(linPerQuery, 'Lin');
        var elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
        console.log('NDCG@10=' + f(linAgg.ndcg10) + ' WS=' + f(linAgg.ws) + ' (' + elapsed + 's)');

        modelResults.push({
            model: model,
            vecAgg: vecAgg,
            linAgg: linAgg,
            linPerQuery: linPerQuery,
            elapsed: elapsed
        });
    }

    // === Report ===
    var lines = [];
    lines.push('# Zhipu AI Embedding Model Comparison — RRF-Lin (α=0.20, k=60)');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**API**: ' + ZHIPU_URL);
    lines.push('**Queries**: ' + queries.length + ' (' + queries.filter(function(q) { return q.type === 'narrative'; }).length + ' narr + ' + queries.filter(function(q) { return q.type === 'targeted'; }).length + ' tgt)');
    lines.push('**STM**: ' + allSTM.length + ' events');
    lines.push('');

    // Table 1: Lin α=0.20 fusion
    lines.push('## Lin α=0.20, k=60 — Fusion Results');
    lines.push('');
    var headers = ['Model', 'Dim', 'NDCG@10', 'WeightedScore', 'Hit@3', 'P@5', 'R@10', 'R@20', 'MRR', 'P@5(act)'];
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('|' + headers.map(function() { return '------'; }).join('|') + '|');

    lines.push('| **BM25 (no vector)** | — | ' + f(bm25Agg.ndcg10) + ' | ' + f(bm25Agg.ws) + ' | ' + f(bm25Agg.hit3) + ' | ' + f(bm25Agg.p5) + ' | ' + f(bm25Agg.r10) + ' | ' + f(bm25Agg.r20) + ' | ' + f(bm25Agg.mrr) + ' | ' + f(bm25Agg.p5a) + ' |');

    // Also add bge-m3 baseline for reference
    lines.push('| *bge-m3 (SiliconFlow ref)* | 1024d | 0.425 | 0.551 | 0.750 | 0.414 | 0.391 | 0.608 | 0.453 | 0.407 |');

    var bestWs = -Infinity;
    var bestLabel = '';
    modelResults.forEach(function(r) { if (r.linAgg.ws > bestWs) { bestWs = r.linAgg.ws; bestLabel = r.model.label; } });

    modelResults.forEach(function(r) {
        var a = r.linAgg;
        var tag = r.model.label === bestLabel ? ' 🥇' : '';
        lines.push('| ' + r.model.label + tag + ' | ' + r.model.dim + 'd | ' + f(a.ndcg10) + ' | ' + f(a.ws) + ' | ' + f(a.hit3) + ' | ' + f(a.p5) + ' | ' + f(a.r10) + ' | ' + f(a.r20) + ' | ' + f(a.mrr) + ' | ' + f(a.p5a) + ' |');
    });
    lines.push('');

    // Table 2: Vector-only
    lines.push('## Vector-Only Results');
    lines.push('');
    lines.push('| Model | Dim | NDCG@10 | WeightedScore | Hit@3 | P@5 | R@10 | MRR |');
    lines.push('|-------|-----|---------|--------------|-------|-----|------|-----|');
    lines.push('| *bge-m3 (ref)* | 1024d | 0.442 | 0.543 | 0.714 | 0.414 | 0.426 | 0.484 |');
    modelResults.forEach(function(r) {
        var a = r.vecAgg;
        lines.push('| ' + r.model.label + ' | ' + r.model.dim + 'd | ' + f(a.ndcg10) + ' | ' + f(a.ws) + ' | ' + f(a.hit3) + ' | ' + f(a.p5) + ' | ' + f(a.r10) + ' | ' + f(a.mrr) + ' |');
    });
    lines.push('');

    // Table 3: Delta vs BM25
    lines.push('## Delta vs BM25 (Lin α=0.20)');
    lines.push('');
    lines.push('| Model | Δ NDCG@10 | Δ WeightedScore | Δ Hit@3 | Δ P@5 | Δ R@10 |');
    lines.push('|-------|-----------|----------------|---------|-------|--------|');
    modelResults.forEach(function(r) {
        function delta(a, b) {
            if (a === 0 && b === 0) return '—';
            var d = ((b - a) / a) * 100;
            return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
        }
        var a = r.linAgg;
        lines.push('| ' + r.model.label + ' | ' + delta(bm25Agg.ndcg10, a.ndcg10) + ' | ' + delta(bm25Agg.ws, a.ws) + ' | ' + delta(bm25Agg.hit3, a.hit3) + ' | ' + delta(bm25Agg.p5, a.p5) + ' | ' + delta(bm25Agg.r10, a.r10) + ' |');
    });
    lines.push('');

    var report = lines.join('\n');
    var outDir = outputDirFor(__dirname);
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'model-benchmark-zhipu.md');
    writeFileSync(outPath, withProvenanceHeader('zhipu', report), 'utf-8');

    // Console summary
    console.log('\n=== Summary: Zhipu AI (Lin α=0.20) ===');
    console.log('');
    console.log('Model             Dim   NDCG@10   WS      Hit@3   P@5     R@10    MRR');
    console.log('─────             ───   ───────   ──      ─────   ───     ────    ───');
    console.log('BM25 (no vec)      —    ' + f(bm25Agg.ndcg10) + '    ' + f(bm25Agg.ws) + '   ' + f(bm25Agg.hit3) + '   ' + f(bm25Agg.p5) + '    ' + f(bm25Agg.r10) + '   ' + f(bm25Agg.mrr));
    console.log('bge-m3 (ref)     1024d  0.425    0.551   0.750   0.414    0.391   0.453 🥇');
    modelResults.forEach(function(r) {
        var a = r.linAgg;
        var dimPad = r.model.dim + 'd';
        while (dimPad.length < 5) dimPad = ' ' + dimPad;
        var labelPad = r.model.label;
        while (labelPad.length < 16) labelPad += ' ';
        console.log(labelPad + ' ' + dimPad + '  ' + f(a.ndcg10) + '    ' + f(a.ws) + '   ' + f(a.hit3) + '   ' + f(a.p5) + '    ' + f(a.r10) + '   ' + f(a.mrr));
    });

    console.log('\nFull report: ' + outPath);
}

main().catch(function(e) {
    console.error('Benchmark crashed:', e);
    process.exit(2);
});
