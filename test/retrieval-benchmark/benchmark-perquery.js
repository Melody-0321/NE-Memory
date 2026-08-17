// NE-Memory Per-Query Failure Analysis
// 28 queries × 5 methods: BM25, Vector, Lin, RRF, Lin+Rerank
// Outputs heatmap, hard-bone detection, BM25 vs Vector divergence

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM, entityToStmIds } from './fixture.js';
import { loadSplitQueries, outputDirFor, getSplitName } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader, computeTuple } from './report-provenance.js';
import { precisionAtK, recallAtK, ndcgAtK, mrr, hitAtK, precisionAtK_active, hitAtK_active, weightedScore, avg } from './metrics.js';
import { linearFuse, rrfFuse, rerankFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_per_query__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;

function f(v, d) { d = d || 3; return v.toFixed(d); }

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

async function main() {
    console.log('=== Per-Query Failure Analysis ===\n');
    console.log('Methods: BM25, Vector (bge-m3), Lin α=0.20, RRF k=60, Lin+Rerank');
    console.log('Queries: ' + queries.length + '\n');

    setBgeM3();
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    var stmById = buildSTById(allSTM);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    // Collect per-query per-method data
    var perQuery = [];
    var methods = ['BM25', 'Vector', 'Lin', 'RRF', 'LinRerank'];
    var methodLabels = { 'BM25': 'BM25', 'Vector': 'Vector (bge-m3)', 'Lin': 'Lin α=0.20', 'RRF': 'RRF k=60', 'LinRerank': 'Lin+Rerank' };

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;

        process.stdout.write('[' + (qi + 1) + '/' + queries.length + '] ' + (q.id || ('q'+(qi+1))) + ' ... ');

        // BM25
        delete process.env.NE_BENCHMARK_VECTOR;
        var bm25Results = await filterCandidates(q.query, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
        var bm25Ids = bm25Results.map(function(r) { return r.__id || r.id; });
        var bm25Scores = calcScores(bm25Ids, q.groundTruth, q);

        // Vector
        setBgeM3();
        var queryEmb = await computeEmbedding(q.query);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K_VEC);
        var vecIds = vecResults.map(function(v) { return v.entry.id; });
        var vecScores = calcScores(vecIds, q.groundTruth, q);

        // Lin fusion
        var linIds = linearFuse(bm25Ids, vecIds, 0.20, 40, 60);
        var linScores = calcScores(linIds, q.groundTruth, q);

        // RRF fusion
        var rrfIds = rrfFuse(bm25Ids, vecIds, 40, 60);
        var rrfScores = calcScores(rrfIds, q.groundTruth, q);

        // Lin+Rerank
        var rerankIds = await rerankFuse(bm25Ids, vecIds, q.query, stmById, 40, 60, 0.20, 60);
        var rerankScores = calcScores(rerankIds, q.groundTruth, q);

        var entry = {
            queryId: q.id || ('q'+(qi+1)),
            type: q.type,
            query: q.query,
            BM25: { ids: bm25Ids, scores: bm25Scores },
            Vector: { ids: vecIds, scores: vecScores },
            Lin: { ids: linIds, scores: linScores },
            RRF: { ids: rrfIds, scores: rrfScores },
            LinRerank: { ids: rerankIds, scores: rerankScores },
        };

        process.stdout.write(
            'BM25=' + f(bm25Scores.ws, 2) + ' ' +
            'Vec=' + f(vecScores.ws, 2) + ' ' +
            'Lin=' + f(linScores.ws, 2) + ' ' +
            'RRF=' + f(rrfScores.ws, 2) + ' ' +
            'RRrk=' + f(rerankScores.ws, 2) + '\n'
        );

        perQuery.push(entry);
    }

    // ── Aggregate ──
    function aggr(label, key) {
        var sQ = perQuery.map(function(q) { return q[key].scores; });
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

    var agg = {
        BM25: aggr('BM25', 'BM25'),
        Vector: aggr('Vector', 'Vector'),
        Lin: aggr('Lin', 'Lin'),
        RRF: aggr('RRF', 'RRF'),
        LinRerank: aggr('LinRerank', 'LinRerank'),
    };

    // ── Analysis ──
    var hardBoneThreshold = 0.30;
    var hardBones = [];
    var easyOnes = [];
    var easyThreshold = 0.70;

    var bm25Better = [];
    var vecBetter = [];
    var divergenceThreshold = 0.10;

    var methodWins = { BM25: 0, Vector: 0, Lin: 0, RRF: 0, LinRerank: 0 };
    var wsMatrix = [];

    perQuery.forEach(function(entry) {
        var wsVals = {
            BM25: entry.BM25.scores.ws,
            Vector: entry.Vector.scores.ws,
            Lin: entry.Lin.scores.ws,
            RRF: entry.RRF.scores.ws,
            LinRerank: entry.LinRerank.scores.ws,
        };
        wsMatrix.push(wsVals);

        var allWS = methods.map(function(m) { return wsVals[m]; });
        var maxWS = Math.max.apply(null, allWS);
        var minWS = Math.min.apply(null, allWS);

        // Hard bones: all methods below threshold
        if (maxWS < hardBoneThreshold) {
            hardBones.push(entry);
        }

        // Easy ones: all methods above threshold
        if (minWS >= easyThreshold) {
            easyOnes.push(entry);
        }

        // BM25 vs Vector divergence
        if (Math.abs(wsVals.BM25 - wsVals.Vector) >= divergenceThreshold) {
            if (wsVals.BM25 > wsVals.Vector) {
                bm25Better.push(entry);
            } else {
                vecBetter.push(entry);
            }
        }

        // Method wins (count ties as wins for all tied methods)
        methods.forEach(function(m) {
            if (Math.abs(wsVals[m] - maxWS) < 0.001) {
                methodWins[m]++;
            }
        });
    });

    // ── Console Heatmap ──
    function colorWS(ws, best) {
        var s = f(ws, 2);
        while (s.length < 5) s += ' ';
        if (ws >= 0.70) return ' \x1b[1;32m' + s + '\x1b[0m';
        if (ws >= 0.50) return ' \x1b[0;32m' + s + '\x1b[0m';
        if (ws >= 0.30) return ' \x1b[0;33m' + s + '\x1b[0m';
        if (ws >= 0.15) return ' \x1b[0;31m' + s + '\x1b[0m';
        return ' \x1b[1;31m' + s + '\x1b[0m';
    }

    function bestWS(row) {
        return Math.max(row.BM25, row.Vector, row.Lin, row.RRF, row.LinRerank);
    }

    console.log('\n\n=== Per-Query WS Heatmap ===\n');
    console.log('Query         Type        BM25   Vec    Lin    RRF    RRrk   Best    |');
    console.log('─────         ────        ────   ───    ───    ───    ────   ────    |');
    perQuery.forEach(function(eq) {
        var row = wsMatrix[perQuery.indexOf(eq)];
        var best = bestWS(row);
        var typeStr = (eq.type || '?').substring(0, 4);
        var idStr = (eq.queryId + '            ').substring(0, 13);
        var tStr = (typeStr + '     ').substring(0, 8);
        console.log(
            idStr + ' ' + tStr +
            colorWS(row.BM25, best) +
            colorWS(row.Vector, best) +
            colorWS(row.Lin, best) +
            colorWS(row.RRF, best) +
            colorWS(row.LinRerank, best) +
            ' ' + (best >= 0.70 ? '\x1b[1;32m' : best >= 0.50 ? '\x1b[0;32m' : '\x1b[0;31m') + f(best, 2) + '\x1b[0m'
        );
    });

    // ── Aggregate row ──
    console.log('\n' + '─'.repeat(70));
    var aggRow = { BM25: agg.BM25.ws, Vector: agg.Vector.ws, Lin: agg.Lin.ws, RRF: agg.RRF.ws, LinRerank: agg.LinRerank.ws };
    var aggBest = bestWS(aggRow);
    console.log(
        'AVERAGE       —           ' +
        colorWS(aggRow.BM25, aggBest) +
        colorWS(aggRow.Vector, aggBest) +
        colorWS(aggRow.Lin, aggBest) +
        colorWS(aggRow.RRF, aggBest) +
        colorWS(aggRow.LinRerank, aggBest) +
        ' \x1b[1;37m' + f(aggBest, 2) + '\x1b[0m'
    );

    // ── Hard bones ──
    console.log('\n\n=== Hard Bones (all methods WS < ' + hardBoneThreshold + ') ===');
    if (hardBones.length === 0) {
        console.log('  (none)');
    } else {
        hardBones.forEach(function(eq) {
            var row = wsMatrix[perQuery.indexOf(eq)];
            console.log('  ' + eq.queryId + ': ' + eq.query.substring(0, 50) + '...');
            console.log('    BM25=' + f(row.BM25, 3) + ' Vec=' + f(row.Vector, 3) + ' Lin=' + f(row.Lin, 3) + ' RRF=' + f(row.RRF, 3) + ' RRrk=' + f(row.LinRerank, 3));
        });
    }

    // ── Easy ones ──
    console.log('\n\n=== Easy Queries (all methods WS ≥ ' + easyThreshold + ') ===');
    if (easyOnes.length === 0) {
        console.log('  (none)');
    } else {
        easyOnes.forEach(function(eq) {
            var row = wsMatrix[perQuery.indexOf(eq)];
            console.log('  ' + eq.queryId + ': ' + eq.query.substring(0, 50) + '...');
            console.log('    BM25=' + f(row.BM25, 3) + ' Vec=' + f(row.Vector, 3) + ' Lin=' + f(row.Lin, 3) + ' RRF=' + f(row.RRF, 3) + ' RRrk=' + f(row.LinRerank, 3));
        });
    }

    // ── BM25 > Vector ──
    console.log('\n\n=== BM25 Superior (BM25 - Vector ≥ ' + divergenceThreshold + ') ===');
    bm25Better.forEach(function(eq) {
        var row = wsMatrix[perQuery.indexOf(eq)];
        console.log('  ' + eq.queryId + ': Δ=' + f(row.BM25 - row.Vector, 3) + '  BM25=' + f(row.BM25, 3) + ' Vec=' + f(row.Vector, 3) + '  ' + eq.query.substring(0,45) + '...');
    });

    // ── Vector > BM25 ──
    console.log('\n\n=== Vector Superior (Vector - BM25 ≥ ' + divergenceThreshold + ') ===');
    vecBetter.forEach(function(eq) {
        var row = wsMatrix[perQuery.indexOf(eq)];
        console.log('  ' + eq.queryId + ': Δ=' + f(row.Vector - row.BM25, 3) + '  BM25=' + f(row.BM25, 3) + ' Vec=' + f(row.Vector, 3) + '  ' + eq.query.substring(0,45) + '...');
    });

    // ── Method win counts ──
    console.log('\n\n=== Method Win Counts (incl. ties) ===');
    methods.forEach(function(m) {
        console.log('  ' + m + ': ' + methodWins[m] + '/' + queries.length);
    });

    // ── Report ──
    var lines = [];
    lines.push('# Per-Query Failure Analysis');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**Methods**: BM25 (k1=1.5,b=0.75,TOP_K=' + TOP_K_BM25 + '), Vector (bge-m3,TOP_K=' + TOP_K_VEC + '), Lin (α=0.20), RRF (k=60), Lin+Rerank (bge-reranker-v2-m3)');
    lines.push('**Queries**: ' + queries.length + ' (' + queries.filter(function(q) { return q.type === 'narrative'; }).length + ' narr + ' + queries.filter(function(q) { return q.type === 'targeted'; }).length + ' tgt)');
    lines.push('');

    // Aggregate table
    lines.push('## Aggregate Results');
    lines.push('');
    var aggHeaders = ['Method', 'WS', 'P@5', 'P@10', 'NDCG@10', 'MRR', 'Hit@3', 'Hit@5', 'R@10', 'R@20', 'P@5(act)'];
    lines.push('| ' + aggHeaders.join(' | ') + ' |');
    lines.push('|' + aggHeaders.map(function() { return '---'; }).join('|') + '|');
    methods.forEach(function(m) {
        var a = agg[m];
        lines.push('| ' + methodLabels[m] + ' | ' + f(a.ws) + ' | ' + f(a.p5) + ' | ' + f(a.p10) + ' | ' + f(a.ndcg10) + ' | ' + f(a.mrr) + ' | ' + f(a.hit3) + ' | ' + f(a.hit5) + ' | ' + f(a.r10) + ' | ' + f(a.r20) + ' | ' + f(a.p5a) + ' |');
    });
    lines.push('');

    // Per-query heatmap
    lines.push('## Per-Query WS Heatmap');
    lines.push('');
    lines.push('WS color scale: 🟢 ≥0.70  🟢 0.50-0.69  🟡 0.30-0.49  🔴 0.15-0.29  🔴 <0.15');
    lines.push('');
    var pqHeaders = ['ID', 'Type', 'Query (truncated)'].
        concat(methods.map(function(m) { return m + ' WS'; })).
        concat(['Best WS']);
    lines.push('| ' + pqHeaders.join(' | ') + ' |');
    lines.push('|' + pqHeaders.map(function() { return '---'; }).join('|') + '|');

    perQuery.forEach(function(eq) {
        var row = wsMatrix[perQuery.indexOf(eq)];
        var best = f(bestWS(row), 3);
        var icon = bestWS(row) >= 0.70 ? '🟢' : bestWS(row) >= 0.50 ? '🟢' : bestWS(row) >= 0.30 ? '🟡' : '🔴';
        var cells = [eq.queryId, eq.type, eq.query.substring(0, 45) + (eq.query.length > 45 ? '...' : '')].
            concat(methods.map(function(m) { return f(row[m] || 0, 3); })).
            concat([icon + ' ' + f(bestWS(row), 3)]);
        lines.push('| ' + cells.join(' | ') + ' |');
    });

    // Aggregate row
    lines.push('| **AVERAGE** | — | — | ' + methods.map(function(m) { return '**' + f(agg[m].ws, 3) + '**'; }).join(' | ') + ' | — |');

    lines.push('');

    // Hard bones
    lines.push('## Hard Bones (all methods WS < ' + hardBoneThreshold + ')');
    lines.push('');
    if (hardBones.length === 0) {
        lines.push('(none)');
    } else {
        hardBones.forEach(function(eq) {
            var row = wsMatrix[perQuery.indexOf(eq)];
            lines.push('- **' + eq.queryId + '** [' + eq.type + ']: "' + eq.query + '"');
            lines.push('  - BM25=' + f(row.BM25, 3) + ' Vector=' + f(row.Vector, 3) + ' Lin=' + f(row.Lin, 3) + ' RRF=' + f(row.RRF, 3) + ' LinRerank=' + f(row.LinRerank, 3));
        });
    }
    lines.push('');

    // Easy queries
    lines.push('## Easy Queries (all methods WS ≥ ' + easyThreshold + ')');
    lines.push('');
    if (easyOnes.length === 0) {
        lines.push('(none)');
    } else {
        easyOnes.forEach(function(eq) {
            var row = wsMatrix[perQuery.indexOf(eq)];
            lines.push('- **' + eq.queryId + '** [' + eq.type + ']: "' + eq.query + '"');
            lines.push('  - BM25=' + f(row.BM25, 3) + ' Vector=' + f(row.Vector, 3) + ' Lin=' + f(row.Lin, 3) + ' RRF=' + f(row.RRF, 3) + ' LinRerank=' + f(row.LinRerank, 3));
        });
    }
    lines.push('');

    // BM25 vs Vector divergence
    lines.push('## BM25 vs Vector Divergence (|Δ| ≥ ' + divergenceThreshold + ')');
    lines.push('');

    lines.push('### BM25 Superior');
    lines.push('');
    if (bm25Better.length === 0) {
        lines.push('(none)');
    } else {
        lines.push('| ID | Query | BM25 WS | Vector WS | Δ |');
        lines.push('|---|-------|---------|-----------|---|');
        bm25Better.forEach(function(eq) {
            var row = wsMatrix[perQuery.indexOf(eq)];
            lines.push('| ' + eq.queryId + ' | ' + eq.query.substring(0, 50) + ' | ' + f(row.BM25, 3) + ' | ' + f(row.Vector, 3) + ' | +' + f(row.BM25 - row.Vector, 3) + ' |');
        });
    }
    lines.push('');

    lines.push('### Vector Superior');
    lines.push('');
    if (vecBetter.length === 0) {
        lines.push('(none)');
    } else {
        lines.push('| ID | Query | BM25 WS | Vector WS | Δ |');
        lines.push('|---|-------|---------|-----------|---|');
        vecBetter.forEach(function(eq) {
            var row = wsMatrix[perQuery.indexOf(eq)];
            lines.push('| ' + eq.queryId + ' | ' + eq.query.substring(0, 50) + ' | ' + f(row.BM25, 3) + ' | ' + f(row.Vector, 3) + ' | +' + f(row.Vector - row.BM25, 3) + ' |');
        });
    }
    lines.push('');

    // Method win counts
    lines.push('## Method Win Counts (incl. ties)');
    lines.push('');
    lines.push('| Method | Wins | Win Rate |');
    lines.push('|--------|------|----------|');
    methods.forEach(function(m) {
        lines.push('| ' + methodLabels[m] + ' | ' + methodWins[m] + ' | ' + f(methodWins[m] / queries.length * 100, 1) + '% |');
    });
    lines.push('');

    // Summary insights
    lines.push('## Summary Insights');
    lines.push('');
    lines.push('- **Hard bones**: ' + hardBones.length + ' queries where no method reaches WS=' + hardBoneThreshold);
    lines.push('- **Easy queries**: ' + easyOnes.length + ' queries where all methods reach WS≥' + easyThreshold);
    lines.push('- **BM25-superior**: ' + bm25Better.length + ' queries (BM25 - Vector ≥ ' + divergenceThreshold + ')');
    lines.push('- **Vector-superior**: ' + vecBetter.length + ' queries (Vector - BM25 ≥ ' + divergenceThreshold + ')');
    lines.push('- **Best aggregate**: ' + (function() {
        var bestM = methods[0];
        methods.forEach(function(m) { if (agg[m].ws > agg[bestM].ws) bestM = m; });
        return methodLabels[bestM] + ' (WS=' + f(agg[bestM].ws, 3) + ')';
    })());
    lines.push('');

    var report = lines.join('\n');
    var outDir = outputDirFor(__dirname);
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'per-query-analysis.md');
    writeFileSync(outPath, withProvenanceHeader('per-query', report), 'utf-8');

    // per-query JSON dump（P0-1 bootstrap 输入：config 块 + 每查询每方法 WS + split）
    var dump = {
        _meta: {
            report: 'per-query',
            split: getSplitName(),
            version: computeTuple(),
            config: {
                bm25: { k1: 1.5, b: 0.75, topK: TOP_K_BM25 },
                vector: { model: 'BAAI/bge-m3', topK: TOP_K_VEC },
                lin: { alpha: 0.20, k: 60 },
                rrf: { k: 60 },
                rerank: 'bge-reranker-v2-m3',
            },
        },
        queries: perQuery.map(function (e) {
            return {
                id: e.queryId,
                type: e.type,
                BM25: e.BM25.scores.ws,
                Vector: e.Vector.scores.ws,
                Lin: e.Lin.scores.ws,
                RRF: e.RRF.scores.ws,
                LinRerank: e.LinRerank.scores.ws,
            };
        }),
    };
    var dumpPath = join(outDir, 'per-query-scores.json');
    writeFileSync(dumpPath, JSON.stringify(dump, null, 2) + '\n', 'utf-8');
    console.log('Per-query dump: ' + dumpPath);

    console.log('\n\nFull report: ' + outPath);
}

main().catch(function(e) {
    console.error('Per-query analysis crashed:', e);
    process.exit(2);
});
