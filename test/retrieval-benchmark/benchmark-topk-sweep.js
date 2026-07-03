// NE-Memory Vector TOP_K Sweep
// Tests TOP_K_vec ∈ {40, 60, 80, 100, 144} with fixed TOP_K_bm25=40, Lin α=0.20

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
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_topk_sweep__';
var TOP_K_BM25 = 40;
var TOP_K_VEC_SWEEP = [40, 60, 80, 100, 144];

function f(v, d) { d = d || 3; return v.toFixed(d); }

function setBgeM3() {
    process.env.EMBEDDING_URL = config.url;
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
    process.env.EMBEDDING_API_KEY = config.key;
    delete process.env.NE_BENCHMARK_VECTOR;
}

function calcScores(ids, gt, q) {
    var s = {
        p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
        r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
        ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
        hit3: hitAtK(ids, gt, 3),
        p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
        hit5a: q.activeEntities ? hitAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
    };
    s.ws = weightedScore(s);
    return s;
}

function aggregate(perQuery, label) {
    var sQ = perQuery.map(function(q) { return q.scores; });
    return {
        label: label,
        p5: avg(sQ.map(function(s) { return s.p5; })), p10: avg(sQ.map(function(s) { return s.p10; })),
        ndcg10: avg(sQ.map(function(s) { return s.ndcg10; })), mrr: avg(sQ.map(function(s) { return s.mrr; })),
        hit3: avg(sQ.map(function(s) { return s.hit3; })), hit5: avg(sQ.map(function(s) { return s.hit5; })),
        r10: avg(sQ.map(function(s) { return s.r10; })), r20: avg(sQ.map(function(s) { return s.r20; })),
        p5a: avg(sQ.map(function(s) { return s.p5a; })), ws: avg(sQ.map(function(s) { return s.ws; })),
    };
}

async function main() {
    console.log('=== Vector TOP_K Sweep ===\n');
    console.log('TOP_K_bm25=' + TOP_K_BM25 + ', TOP_K_vec ∈ ' + JSON.stringify(TOP_K_VEC_SWEEP));
    console.log('Fusion: Lin α=0.20, k=60\n');

    setBgeM3();
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    // BM25: same for all TOP_K_vec values
    process.stdout.write('Running BM25 (TOP_K=' + TOP_K_BM25 + ') ... ');
    delete process.env.NE_BENCHMARK_VECTOR;
    var bm25PerQuery = [];
    var bm25Ids = [];
    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var results = await filterCandidates(q.query, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
        var ids = results.map(function(r) { return r.__id || r.id; });
        bm25Ids.push(ids);
        bm25PerQuery.push({ ids: ids, scores: calcScores(ids, q.groundTruth, q) });
    }
    var bm25Agg = aggregate(bm25PerQuery, 'BM25');
    console.log('WS=' + f(bm25Agg.ws));

    // Sweep TOP_K_vec
    var results = [];
    for (var ki = 0; ki < TOP_K_VEC_SWEEP.length; ki++) {
        var tk = TOP_K_VEC_SWEEP[ki];
        process.stdout.write('\nTOP_K_vec=' + tk + ' ... ');

        // Vector
        process.stdout.write('vector ');
        setBgeM3();
        var vecPerQuery = [];
        var vecIds = [];
        for (var qi2 = 0; qi2 < queries.length; qi2++) {
            var q2 = queries[qi2];
            if (!q2.query) q2.query = q2.question;
            var queryEmb = await computeEmbedding(q2.query);
            var vecResults = vectorSearch(queryEmb, vecIdx, tk);
            var vIds = vecResults.map(function(v) { return v.entry.id; });
            vecIds.push(vIds);
            vecPerQuery.push({ ids: vIds, scores: calcScores(vIds, q2.groundTruth, q2) });
        }
        var vecAgg = aggregate(vecPerQuery, 'Vec' + tk);
        console.log('WS=' + f(vecAgg.ws));

        // Lin fusion
        process.stdout.write('  Lin ');
        var linPerQuery = [];
        for (var qi3 = 0; qi3 < queries.length; qi3++) {
            var fused = linearFuse(bm25Ids[qi3], vecIds[qi3], 0.20, tk > 40 ? tk : 40, 60);
            var gt = queries[qi3].groundTruth;
            linPerQuery.push({ ids: fused, scores: calcScores(fused, gt, queries[qi3]) });
        }
        var linAgg = aggregate(linPerQuery, 'Lin' + tk);
        console.log('WS=' + f(linAgg.ws));

        // Overlap stats
        var totalOverlap = 0;
        for (var qi4 = 0; qi4 < queries.length; qi4++) {
            var bSet = {};
            bm25Ids[qi4].forEach(function(id) { bSet[id] = true; });
            var overlap = 0;
            vecIds[qi4].forEach(function(id) { if (bSet[id]) overlap++; });
            totalOverlap += overlap;
        }
        var avgOverlap = totalOverlap / queries.length;

        results.push({
            topK: tk,
            vecAgg: vecAgg,
            linAgg: linAgg,
            avgOverlap: avgOverlap
        });
    }

    // Report
    var lines = [];
    lines.push('# Vector TOP_K Sweep — Lin α=0.20, k=60');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**TOP_K_bm25**: ' + TOP_K_BM25);
    lines.push('');

    lines.push('## Results');
    lines.push('');
    var headers = ['TOP_K_vec', 'Vec WS', 'Lin WS', 'Lin NDCG@10', 'Lin Hit@3', 'Lin P@5', 'Lin R@10', 'Avg Overlap BM25∩Vec'];
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('|' + headers.map(function() { return '---'; }).join('|') + '|');

    lines.push('| BM25 only | — | ' + f(bm25Agg.ws) + ' | ' + f(bm25Agg.ndcg10) + ' | ' + f(bm25Agg.hit3) + ' | ' + f(bm25Agg.p5) + ' | ' + f(bm25Agg.r10) + ' | — |');

    var baseLin = results[0].linAgg.ws;
    results.forEach(function(r) {
        var delta = ((r.linAgg.ws - baseLin) / baseLin * 100).toFixed(2);
        var best = r.linAgg.ws >= (baseLin + 0.002) ? ' 🥇' : '';
        lines.push('| ' + r.topK + best + ' | ' + f(r.vecAgg.ws) + ' | ' + f(r.linAgg.ws) + ' | ' + f(r.linAgg.ndcg10) + ' | ' + f(r.linAgg.hit3) + ' | ' + f(r.linAgg.p5) + ' | ' + f(r.linAgg.r10) + ' | ' + f(r.avgOverlap, 1) + ' |');
    });
    lines.push('');

    var report = lines.join('\n');
    var outDir = join(__dirname, 'output');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'topk-sweep.md'), report, 'utf-8');

    // Console summary
    console.log('\n=== Summary ===');
    console.log('');
    console.log('TOP_K_vec   Vec WS    Lin WS   Δ vs 40   Overlap');
    console.log('─────────   ──────    ──────   ───────   ───────');
    results.forEach(function(r) {
        var delta = ((r.linAgg.ws - baseLin) / baseLin * 100).toFixed(3);
        console.log(pad(r.topK, 11) + '  ' + f(r.vecAgg.ws) + '     ' + f(r.linAgg.ws) + '   ' + pad(delta + '%', 9) + ' ' + f(r.avgOverlap, 1));
    });
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

main().catch(function(e) {
    console.error('Sweep crashed:', e);
    process.exit(2);
});
