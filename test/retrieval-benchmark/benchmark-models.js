// NE-Memory Embedding Model Benchmark — Multi-Model Comparison
// Run: node test/retrieval-benchmark/benchmark-models.js
// Compares BAAI/bge-m3, Pro/BAAI/bge-m3, bge-large-zh-v1.5, Qwen3-Embedding-4B/8B, Qwen3-VL-Embedding-8B

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM, entityToStmIds } from './fixture.js';
import { queries } from './queries.js';
import { precisionAtK, recallAtK, ndcgAtK, mrr, hitAtK, precisionAtK_active, hitAtK_active, weightedScore, avg } from './metrics.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var CONFIG_PATH = join(__dirname, 'config.json');
var config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

var CHAT_ID = '__bench_models__';
var TOP_K = 40;

var MODELS = [
    { name: 'BAAI/bge-m3',              label: 'bge-m3',           dim: 1024, note: 'current baseline' },
    { name: 'Pro/BAAI/bge-m3',          label: 'Pro/bge-m3',       dim: 1024, note: 'enhanced m3 variant' },
    { name: 'BAAI/bge-large-zh-v1.5',   label: 'bge-large-zh',     dim: 1024, note: 'Chinese-optimized' },
    { name: 'Qwen/Qwen3-Embedding-4B',  label: 'Qwen3-E-4B',       dim: 2560, note: '4B params' },
    { name: 'Qwen/Qwen3-Embedding-8B',  label: 'Qwen3-E-8B',       dim: 4096, note: '8B params' },
    { name: 'Qwen/Qwen3-VL-Embedding-8B', label: 'Qwen3-VL-E-8B', dim: 4096, note: '8B vision-language' },
];

function setModel(modelName) {
    process.env.EMBEDDING_URL = config.url;
    process.env.EMBEDDING_MODEL = modelName;
    process.env.EMBEDDING_API_KEY = config.key;
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
    // Lin α=0.20, k=60 (production setting)
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

async function runBM25Round() {
    process.env.NE_BENCHMARK_VECTOR = '0';
    var perQuery = [];

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

        perQuery.push({ ids: ids, scores: s });
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

var FMT = { p5: 'P@5', p10: 'P@10', ndcg10: 'NDCG@10', mrr: 'MRR', hit3: 'Hit@3', hit5: 'Hit@5', r10: 'R@10', r20: 'R@20', p5a: 'P@5(act)', ws: 'WS' };

function f(v, d) { d = d || 3; return v.toFixed(d); }

async function main() {
    console.log('=== NE-Memory Embedding Model Benchmark ===\n');
    console.log('Models: ' + MODELS.map(function(m) { return m.label; }).join(', '));
    console.log('Metric: Lin α=0.20, k=60 (RRF weighted linear fusion)\n');

    // BM25 baseline (model-independent)
    process.stdout.write('Running BM25 baseline ... ');
    var bm25PerQuery = await runBM25Round();
    var bm25Ids = bm25PerQuery.map(function(q) { return q.ids; });
    var bm25Agg = aggregate(bm25PerQuery, 'BM25');
    console.log('done. NDCG@10=' + f(bm25Agg.ndcg10) + ' WS=' + f(bm25Agg.ws));

    var modelResults = [];

    for (var mi = 0; mi < MODELS.length; mi++) {
        var model = MODELS[mi];
        process.stdout.write('\nRunning ' + model.label + ' (' + model.name + ') ... ');

        var startTs = Date.now();

        // Build vector index with this model
        var vecIdx = await buildVectorIndex(model.name);
        console.log('index built (' + model.dim + 'd)');

        // Vector-only
        process.stdout.write('  vector-only ... ');
        var vecPerQuery = await runVectorRound(model.name, vecIdx);
        var vecIds = vecPerQuery.map(function(q) { return q.ids; });
        var vecAgg = aggregate(vecPerQuery, 'Vector');
        console.log('NDCG@10=' + f(vecAgg.ndcg10));

        // RRF Lin fusion
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
    lines.push('# Embedding Model Comparison — RRF-Lin (α=0.20, k=60)');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**API**: ' + config.url);
    lines.push('**Queries**: ' + queries.length + ' (' + queries.filter(function(q) { return q.type === 'narrative'; }).length + ' narr + ' + queries.filter(function(q) { return q.type === 'targeted'; }).length + ' tgt)');
    lines.push('**STM**: ' + allSTM.length + ' events');
    lines.push('');

    // Table 1: Lin α=0.20 fusion
    lines.push('## Lin α=0.20, k=60 — Fusion Results');
    lines.push('');
    var headers = ['Model', 'Dim', 'NDCG@10', 'WeightedScore', 'Hit@3', 'P@5', 'R@10', 'R@20', 'MRR', 'P@5(act)'];
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('|' + headers.map(function() { return '------'; }).join('|') + '|');

    // Baseline row
    lines.push('| **BM25 (no vector)** | — | ' + f(bm25Agg.ndcg10) + ' | ' + f(bm25Agg.ws) + ' | ' + f(bm25Agg.hit3) + ' | ' + f(bm25Agg.p5) + ' | ' + f(bm25Agg.r10) + ' | ' + f(bm25Agg.r20) + ' | ' + f(bm25Agg.mrr) + ' | ' + f(bm25Agg.p5a) + ' |');

    var bestWs = -Infinity;
    var bestLabel = '';
    modelResults.forEach(function(r) {
        if (r.linAgg.ws > bestWs) { bestWs = r.linAgg.ws; bestLabel = r.model.label; }
    });

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

    // Narrative vs Targeted breakdown
    lines.push('## By Query Type (Lin α=0.20)');
    lines.push('');
    var typeHeaders = ['Model', 'WS', 'Narr WS', 'Tgt WS', 'Narr NDCG@10', 'Tgt NDCG@10', 'Narr P@10', 'Tgt P@10'];
    lines.push('| ' + typeHeaders.join(' | ') + ' |');
    lines.push('|' + typeHeaders.map(function() { return '------'; }).join('|') + '|');

    modelResults.forEach(function(r) {
        var narrScores = [], tgtScores = [];
        r.linAgg._perQuery = r._linPQ;
    });

    // Re-aggregate by type
    var typeAggs = [];
    modelResults.forEach(function(r) {
        var narrS = [], tgtS = [];
        for (var qi = 0; qi < queries.length; qi++) {
            var s = r.linPerQuery[qi].scores;
            if (queries[qi].type === 'narrative') narrS.push(s);
            else tgtS.push(s);
        }
        typeAggs.push({
            label: r.model.label,
            narrWs: narrS.length > 0 ? avg(narrS.map(function(s) { return s.ws; })) : 0,
            tgtWs: tgtS.length > 0 ? avg(tgtS.map(function(s) { return s.ws; })) : 0,
            narrNdcg: narrS.length > 0 ? avg(narrS.map(function(s) { return s.ndcg10; })) : 0,
            tgtNdcg: tgtS.length > 0 ? avg(tgtS.map(function(s) { return s.ndcg10; })) : 0,
            narrP10: narrS.length > 0 ? avg(narrS.map(function(s) { return s.p10; })) : 0,
            tgtP10: tgtS.length > 0 ? avg(tgtS.map(function(s) { return s.p10; })) : 0,
        });
    });

    typeAggs.forEach(function(ta) {
        var label = ta.label;
        var m = modelResults.find(function(r) { return r.model.label === label; });
        lines.push('| ' + label + ' | ' + f(m.linAgg.ws) + ' | ' + f(ta.narrWs) + ' | ' + f(ta.tgtWs) + ' | ' + f(ta.narrNdcg) + ' | ' + f(ta.tgtNdcg) + ' | ' + f(ta.narrP10) + ' | ' + f(ta.tgtP10) + ' |');
    });
    lines.push('');

    var report = lines.join('\n');
    var outDir = join(__dirname, 'output');
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'model-benchmark.md');
    writeFileSync(outPath, report, 'utf-8');

    // Console summary
    console.log('\n=== Summary (Lin α=0.20) ===');
    console.log('');
    console.log('Model             Dim   NDCG@10   WS      Hit@3   P@5     R@10    MRR');
    console.log('─────             ───   ───────   ──      ─────   ───     ────    ───');
    console.log('BM25 (no vec)      —    ' + f(bm25Agg.ndcg10) + '    ' + f(bm25Agg.ws) + '   ' + f(bm25Agg.hit3) + '   ' + f(bm25Agg.p5) + '    ' + f(bm25Agg.r10) + '   ' + f(bm25Agg.mrr));
    modelResults.forEach(function(r) {
        var a = r.linAgg;
        var dimPad = r.model.dim + 'd';
        while (dimPad.length < 5) dimPad = ' ' + dimPad;
        var labelPad = r.model.label;
        while (labelPad.length < 16) labelPad += ' ';
        var best = r.model.label === bestLabel ? ' 🥇' : '  ';
        console.log(labelPad + ' ' + dimPad + '  ' + f(a.ndcg10) + '    ' + f(a.ws) + '   ' + f(a.hit3) + '   ' + f(a.p5) + '    ' + f(a.r10) + '   ' + f(a.mrr) + best);
    });

    console.log('\nFull report: ' + outPath);
}

main().catch(function(e) {
    console.error('Benchmark crashed:', e);
    process.exit(2);
});
