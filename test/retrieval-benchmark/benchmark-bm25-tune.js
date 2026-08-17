// NE-Memory BM25 k1/b Parameter Sweep
// Tests 3×3 grid on: pure BM25 and Lin fusion (STM summaries, bge-m3)
// Run: node test/retrieval-benchmark/benchmark-bm25-tune.js

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
var CONFIG_PATH = join(__dirname, 'config.json');
var config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
var CHAT_ID = '__bench_bm25_tune__';
var TOP_K = 40;

function f(v, d) { d = d || 3; return v.toFixed(d); }

function setBM25Params(k1, b) {
    process.env.BM25_K1 = String(k1);
    process.env.BM25_B = String(b);
}

function setBgeM3() {
    process.env.EMBEDDING_URL = config.url;
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
    process.env.EMBEDDING_API_KEY = config.key;
    delete process.env.NE_BENCHMARK_VECTOR;
}

function buildSTById(stmArr) {
    var map = {};
    stmArr.forEach(function(s) {
        map[s.id] = s;
        map[s.__id || s.id] = s;
    });
    return map;
}

async function buildVecIndex(stmArr) {
    setBgeM3();
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(stmArr, {}, CHAT_ID);
    return getVectorIndex(CHAT_ID);
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
        p5: avg(sQ.map(function(s) { return s.p5; })),
        p10: avg(sQ.map(function(s) { return s.p10; })),
        ndcg10: avg(sQ.map(function(s) { return s.ndcg10; })),
        mrr: avg(sQ.map(function(s) { return s.mrr; })),
        hit3: avg(sQ.map(function(s) { return s.hit3; })),
        hit5: avg(sQ.map(function(s) { return s.hit5; })),
        r10: avg(sQ.map(function(s) { return s.r10; })),
        r20: avg(sQ.map(function(s) { return s.r20; })),
        p5a: avg(sQ.map(function(s) { return s.p5a; })),
        ws: avg(sQ.map(function(s) { return s.ws; })),
    };
}

async function runBM25(k1, b) {
    setBM25Params(k1, b);
    var perQuery = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var results = await filterCandidates(q.query, allSTM, allLTM, TOP_K, 3, {}, CHAT_ID);
        var ids = results.map(function(r) { return r.__id || r.id; });
        perQuery.push({ ids: ids, scores: calcScores(ids, q.groundTruth, q) });
    }
    return perQuery;
}

async function runLin(k1, b, vecIdx) {
    setBM25Params(k1, b);
    var bm25Ids = [];
    var vecIds = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;

        var results = await filterCandidates(q.query, allSTM, allLTM, TOP_K, 3, {}, CHAT_ID);
        var bIds = results.map(function(r) { return r.__id || r.id; });
        bm25Ids.push(bIds);

        setBgeM3();
        var queryEmb = await computeEmbedding(q.query);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K);
        vecIds.push(vecResults.map(function(v) { return v.entry.id; }));
    }

    var perQuery = [];
    for (var qi2 = 0; qi2 < queries.length; qi2++) {
        var fused = linearFuse(bm25Ids[qi2], vecIds[qi2], 0.20, TOP_K, 60);
        perQuery.push({ ids: fused, scores: calcScores(fused, queries[qi2].groundTruth, queries[qi2]) });
    }
    return perQuery;
}

var GRID_K1 = [0.5, 1.2, 1.5, 2.0, 3.0];
var GRID_B = [0.0, 0.25, 0.5, 0.75, 1.0];

async function main() {
    console.log('=== BM25 k1/b Parameter Sweep ===\n');
    console.log('Grid: k1 ∈ ' + JSON.stringify(GRID_K1) + '  b ∈ ' + JSON.stringify(GRID_B));
    console.log('Tests: ' + (GRID_K1.length * GRID_B.length) + ' combos × 2 (BM25 + Lin)\n');

    setBgeM3();
    var vecIdx = await buildVecIndex(allSTM);

    var bm25Results = {};
    var linResults = {};

    for (var ki = 0; ki < GRID_K1.length; ki++) {
        for (var bi = 0; bi < GRID_B.length; bi++) {
            var k1 = GRID_K1[ki];
            var b = GRID_B[bi];
            var key = 'k1=' + k1 + ' b=' + f(b, 2);

            process.stdout.write('BM25(' + key + ') ... ');
            var bm25PQ = await runBM25(k1, b);
            bm25Results[key] = aggregate(bm25PQ, key);
            console.log('WS=' + f(bm25Results[key].ws));

            process.stdout.write('  Lin(' + key + ') ... ');
            var linPQ = await runLin(k1, b, vecIdx);
            linResults[key] = aggregate(linPQ, key);
            console.log('WS=' + f(linResults[key].ws));
        }
    }

    // ── Report ──
    var lines = [];
    lines.push('# BM25 k1/b Parameter Sweep');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**Vector Model**: BAAI/bge-m3 (1024d)');
    lines.push('**Fusion**: Lin α=0.20, k=60');
    lines.push('**Queries**: ' + queries.length + ' (' + queries.filter(function(q) { return q.type === 'narrative'; }).length + ' narr + ' + queries.filter(function(q) { return q.type === 'targeted'; }).length + ' tgt)');
    lines.push('');

    // Heatmap: BM25
    lines.push('## Pure BM25 — WeightedScore Heatmap');
    lines.push('');
    lines.push('| b → | ' + GRID_B.map(function(v) { return 'b=' + f(v, 2); }).join(' | ') + ' |');
    lines.push('|' + GRID_B.map(function() { return '---'; }).join('|') + '|' + '---|');

    var bm25Best = { ws: -1, key: '' };
    for (var ki2 = 0; ki2 < GRID_K1.length; ki2++) {
        var row = [];
        for (var bi2 = 0; bi2 < GRID_B.length; bi2++) {
            var kk = 'k1=' + GRID_K1[ki2] + ' b=' + f(GRID_B[bi2], 2);
            var ws = bm25Results[kk].ws;
            if (ws > bm25Best.ws) { bm25Best.ws = ws; bm25Best.key = kk; }
            row.push(ws >= bm25Best.ws ? '**' + f(ws) + ' 🥇**' : f(ws));
        }
        lines.push('| k1=' + GRID_K1[ki2] + ' | ' + row.join(' | ') + ' |');
    }
    lines.push('\n**BM25 best**: ' + bm25Best.key + ' (WS=' + f(bm25Best.ws) + ')');

    // Heatmap: Lin
    lines.push('\n## Lin α=0.20 — WeightedScore Heatmap');
    lines.push('');
    lines.push('| b → | ' + GRID_B.map(function(v) { return 'b=' + f(v, 2); }).join(' | ') + ' |');
    lines.push('|' + GRID_B.map(function() { return '---'; }).join('|') + '|' + '---|');

    var linBest = { ws: -1, key: '' };
    for (var ki3 = 0; ki3 < GRID_K1.length; ki3++) {
        var row2 = [];
        for (var bi3 = 0; bi3 < GRID_B.length; bi3++) {
            var kk2 = 'k1=' + GRID_K1[ki3] + ' b=' + f(GRID_B[bi3], 2);
            var ws2 = linResults[kk2].ws;
            if (ws2 > linBest.ws) { linBest.ws = ws2; linBest.key = kk2; }
            row2.push(ws2 >= linBest.ws ? '**' + f(ws2) + ' 🥇**' : f(ws2));
        }
        lines.push('| k1=' + GRID_K1[ki3] + ' | ' + row2.join(' | ') + ' |');
    }
    lines.push('\n**Lin best**: ' + linBest.key + ' (WS=' + f(linBest.ws) + ')');

    // Summary comparison table
    lines.push('\n## Summary');
    lines.push('');
    lines.push('| k1 | b | BM25 WS | BM25 NDCG@10 | BM25 Hit@3 | Lin WS | Lin NDCG@10 | Lin Hit@3 |');
    lines.push('|----|---|---------|-------------|------------|--------|------------|----------|');

    var sorted = [];
    Object.keys(bm25Results).forEach(function(k) { sorted.push({ k: k, bm25: bm25Results[k], lin: linResults[k] }); });
    sorted.sort(function(a, b) { return b.lin.ws - a.lin.ws; });

    sorted.forEach(function(r) {
        lines.push('| ' + r.k.replace(' ', ' | ') + ' | ' + f(r.bm25.ws) + ' | ' + f(r.bm25.ndcg10) + ' | ' + f(r.bm25.hit3) + ' | ' + f(r.lin.ws) + ' | ' + f(r.lin.ndcg10) + ' | ' + f(r.lin.hit3) + ' |');
    });

    // Delta vs default (k1=1.5, b=0.75)
    var defKey = 'k1=1.5 b=0.75';
    var defBm25 = bm25Results[defKey];
    var defLin = linResults[defKey];

    lines.push('\n## Delta vs Current Default (k1=1.5, b=0.75)');
    lines.push('');
    lines.push('| k1 | b | Δ BM25 WS | Δ Lin WS |');
    lines.push('|----|---|----------|---------|');
    sorted.forEach(function(r) {
        function delta(a, b) { if (a===0 && b===0) return '—'; var d = ((b-a)/a)*100; return (d>=0?'+':'')+d.toFixed(1)+'%'; }
        lines.push('| ' + r.k.replace(' ', ' | ') + ' | ' + delta(defBm25.ws, r.bm25.ws) + ' | ' + delta(defLin.ws, r.lin.ws) + ' |');
    });

    var report = lines.join('\n');
    var outDir = outputDirFor(__dirname);
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'bm25-tune.md');
    writeFileSync(outPath, withProvenanceHeader('bm25-tune', report), 'utf-8');

    // Console heatmap
    function printf(v, high) { var s = f(v); if (v === high) return ' \x1b[1;32m' + s + '\x1b[0m'; while (s.length < 5) s += ' '; return ' ' + s; }

    console.log('\n\n=== BM25 WS Heatmap ===');
    console.log('b↓ \\ k1→    ' + GRID_K1.map(function(v) { return '  ' + v; }).join('   '));
    for (var bj = 0; bj < GRID_B.length; bj++) {
        var line = 'b=' + f(GRID_B[bj], 2) + '       ';
        for (var kj = 0; kj < GRID_K1.length; kj++) {
            var k = 'k1=' + GRID_K1[kj] + ' b=' + f(GRID_B[bj], 2);
            var val = bm25Results[k].ws;
            line += printf(val, bm25Best.ws);
        }
        console.log(line);
    }

    console.log('\n=== Lin WS Heatmap ===');
    console.log('b↓ \\ k1→    ' + GRID_K1.map(function(v) { return '  ' + v; }).join('   '));
    for (var bj2 = 0; bj2 < GRID_B.length; bj2++) {
        var line2 = 'b=' + f(GRID_B[bj2], 2) + '       ';
        for (var kj2 = 0; kj2 < GRID_K1.length; kj2++) {
            var k2 = 'k1=' + GRID_K1[kj2] + ' b=' + f(GRID_B[bj2], 2);
            var val2 = linResults[k2].ws;
            line2 += printf(val2, linBest.ws);
        }
        console.log(line2);
    }

    console.log('\nBM25 best: ' + bm25Best.key + ' WS=' + f(bm25Best.ws));
    console.log('Lin best:  ' + linBest.key + ' WS=' + f(linBest.ws));
    console.log('Default:   k1=1.5 b=0.75 → BM25 WS=' + f(defBm25.ws) + '  Lin WS=' + f(defLin.ws));
    console.log('\nFull report: ' + outPath);
}

main().catch(function(e) {
    console.error('Sweep crashed:', e);
    process.exit(2);
});
