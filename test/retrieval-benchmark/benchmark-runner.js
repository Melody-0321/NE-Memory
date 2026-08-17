import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { buildSearchableText } from '../../src/core/engine/retrieval-text.js';
import { allSTM, allLTM, entityToStmIds } from './fixture.js';
import { loadSplitQueries } from './query-split-utils.js';
var queries = loadSplitQueries();
import { precisionAtK, recallAtK, ndcgAtK, mrr, hitAtK, precisionAtK_active, hitAtK_active, weightedScore, median, avg } from './metrics.js';
import { linearFuse, cascadeBM25ToVec, cascadeVecToBM25, complementFuse, rrfFuse, rerankFuse } from './benchmark-fusions.js';

var CHAT_ID = '__benchmark__';
var TOP_K = 40;
var MIN_RESULTS = 3;

function getMode() {
    if (typeof process !== 'undefined' && process.env) {
        return process.env.NE_BENCHMARK_MODE || 'all';
    }
    return 'all';
}

async function runBM25Round() {
    if (typeof process !== 'undefined' && process.env) {
        process.env.NE_BENCHMARK_VECTOR = '0';
    }

    var perQuery = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var results = await filterCandidates(q.query, allSTM, allLTM, TOP_K, MIN_RESULTS, {}, CHAT_ID);

        var ids = results.map(function(r) { return r.__id || r.id; });
        var gt = q.groundTruth;

        var rankMap = (typeof globalThis !== 'undefined' && globalThis.__ne_debug_rank_map) ? globalThis.__ne_debug_rank_map : {};
        var gtRankEntries = [];
        Object.keys(gt).forEach(function(id) {
            var rm = rankMap[id];
            gtRankEntries.push({
                id: id, gtScore: gt[id],
                bm25Rank: rm ? rm.bm25Rank : null,
                fusedRank: null,
                vectorOnly: false,
            });
        });

        var s = {
            p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
            r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
            ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
            hit3: hitAtK(ids, gt, 3),
            p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
            hit5a: q.activeEntities ? hitAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
        };
        s.ws = weightedScore(s);

        perQuery.push({
            description: q.description, type: q.type, query: q.query,
            ids: ids, count: ids.length, vectorUsed: false,
            gtRanks: gtRankEntries,
            scores: s
        });
    }

    return { label: 'BM25', perQuery: perQuery, anyVectorUsed: false };
}

async function runVectorOnlyRound() {
    if (typeof process !== 'undefined' && process.env) {
        delete process.env.NE_BENCHMARK_VECTOR;
    }

    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);

    var perQuery = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var queryEmb = await computeEmbedding(q.query);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K);

        // Build STM lookup by id for backfill
        var stmById = {};
        allSTM.forEach(function(s) { stmById[s.id] = s; });

        var ids = [];
        var gt = q.groundTruth;

        var rankMap = {};
        var gtRankEntries = [];

        for (var vi = 0; vi < vecResults.length; vi++) {
            var vid = vecResults[vi].entry.id;
            ids.push(vid);
            rankMap[vid] = { bm25Rank: null, fusedRank: vi + 1, vectorOnly: false };
        }

        Object.keys(gt).forEach(function(id) {
            var rm = rankMap[id];
            gtRankEntries.push({
                id: id, gtScore: gt[id],
                bm25Rank: null,
                fusedRank: rm ? rm.fusedRank : null,
                vectorOnly: false,
            });
        });

        var s = {
            p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
            r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
            ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
            hit3: hitAtK(ids, gt, 3),
            p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
            hit5a: q.activeEntities ? hitAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
        };
        s.ws = weightedScore(s);

        perQuery.push({
            description: q.description, type: q.type, query: q.query,
            ids: ids, count: ids.length, vectorUsed: true,
            gtRanks: gtRankEntries,
            scores: s
        });
    }

    return { label: 'Vector (pure)', perQuery: perQuery, anyVectorUsed: true };
}

async function runRRFRound() {
    if (typeof process !== 'undefined' && process.env) {
        delete process.env.NE_BENCHMARK_VECTOR;
    }

    var perQuery = [];
    var anyVectorUsed = false;

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var results = await filterCandidates(q.query, allSTM, allLTM, TOP_K, MIN_RESULTS, {}, CHAT_ID);

        var ids = results.map(function(r) { return r.__id || r.id; });
        var used = results._vectorUsed === true;
        if (used) anyVectorUsed = true;

        var gt = q.groundTruth;

        var rankMap = (typeof globalThis !== 'undefined' && globalThis.__ne_debug_rank_map) ? globalThis.__ne_debug_rank_map : {};
        var gtRankEntries = [];
        Object.keys(gt).forEach(function(id) {
            var rm = rankMap[id];
            gtRankEntries.push({
                id: id, gtScore: gt[id],
                bm25Rank: rm ? rm.bm25Rank : null,
                fusedRank: rm ? rm.fusedRank : null,
                vectorOnly: rm ? !!rm.vectorOnly : false,
            });
        });

        var s = {
            p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
            r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
            ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
            hit3: hitAtK(ids, gt, 3),
            p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
            hit5a: q.activeEntities ? hitAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
        };
        s.ws = weightedScore(s);

        perQuery.push({
            description: q.description, type: q.type, query: q.query,
            ids: ids, count: ids.length, vectorUsed: used,
            gtRanks: gtRankEntries,
            scores: s
        });
    }

    return { label: 'BM25+Vector (RRF)', perQuery: perQuery, anyVectorUsed: anyVectorUsed };
}

var K_SCAN_VALUES = [20, 30, 40, 50, 60, 80, 100, 110, 120, 130, 150, 200];

async function runKScanRound(k) {
    process.env.NE_BENCHMARK_RRF_K = String(k);
    var result = await runRRFRound();
    delete process.env.NE_BENCHMARK_RRF_K;
    result.label = 'RRF (k=' + k + ')';
    return result;
}

async function runKScan() {
    var results = [];
    for (var i = 0; i < K_SCAN_VALUES.length; i++) {
        resetVectorIndex(CHAT_ID);
        var round = await runKScanRound(K_SCAN_VALUES[i]);
        results.push(round);
        console.log('  k=' + K_SCAN_VALUES[i] + ' done, ' + round.perQuery.length + ' queries.');
    }
    return results;
}

async function runFusionCompare() {
    delete process.env.NE_BENCHMARK_VECTOR;

    resetVectorIndex(CHAT_ID);
    var bm25Round = await runBM25Round();
    console.log('Fusion: BM25 baseline done.');

    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var queriesVec = [];
    var stmById = {};
    allSTM.forEach(function(s) { stmById[s.id] = s; });

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        if (!q.query) q.query = q.question;
        var queryEmb = await computeEmbedding(q.query);
        var vecResults = vectorSearch(queryEmb, getVectorIndex(CHAT_ID), TOP_K);
        var ids = vecResults.map(function(v) { return v.entry.id; });
        queriesVec.push(ids);
    }
    console.log('Fusion: Vector baseline done.');

    var methods = [
        { label: 'RRF k=60', fn: function(b, v) { return rrfFuse(b, v, TOP_K, 60); } },
        { label: 'RRF k=110', fn: function(b, v) { return rrfFuse(b, v, TOP_K, 110); } },
        { label: 'Lin α=0.20, k=60', fn: function(b, v) { return linearFuse(b, v, 0.20, TOP_K, 60); } },
        { label: 'Lin+Rerank (α=0.20, pool=60)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 60, 0.20, 60); } },
        { label: 'Lin+Rerank (α=0.20, pool=80)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 80, 0.20, 60); } },
        { label: 'RRF+Rerank (pool=60)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 60, 0.50, 60); } },
        { label: 'BM25+Rerank (pool=60)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 60, 1.0, 60); } },
        { label: 'BM25+Rerank (pool=80)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 80, 1.0, 60); } },
        { label: 'Vector+Rerank (pool=60)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 60, 0.0, 60); } },
        { label: 'Vector+Rerank (pool=80)', fn: async function(b, v, qText, sMap) { return await rerankFuse(b, v, qText, sMap, TOP_K, 80, 0.0, 60); } },
    ];

    var fusionRounds = [];

    for (var mi = 0; mi < methods.length; mi++) {
        var method = methods[mi];
        var perQuery = [];

        for (var qi = 0; qi < queries.length; qi++) {
            var q = queries[qi];
            var fusedIds = await method.fn(bm25Round.perQuery[qi].ids, queriesVec[qi], q.query, stmById);
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

            perQuery.push({
                description: q.description, type: q.type, query: q.query,
                ids: fusedIds, count: fusedIds.length, vectorUsed: true,
                gtRanks: [],
                scores: s
            });
        }

        fusionRounds.push({ label: method.label, perQuery: perQuery, anyVectorUsed: true });
        console.log('Fusion: ' + method.label + ' done.');
    }

    fusionRounds.unshift({ label: 'BM25', perQuery: bm25Round.perQuery, anyVectorUsed: false });
    fusionRounds.unshift({ label: 'Vector (pure)', perQuery: queriesVec.map(function(ids, qi) {
        var q = queries[qi];
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
        return { description: q.description, type: q.type, query: q.query, ids: ids, count: ids.length, vectorUsed: true, gtRanks: [], scores: s };
    }), anyVectorUsed: true });

    return fusionRounds;
}

export async function runBenchmark() {
    var mode = getMode();
    var rounds = [];
    var wantBM25 = mode === 'all' || mode === 'bm25';
    var wantVector = mode === 'all' || mode === 'vector' || mode === 'vec';
    var wantRRF = mode === 'all' || mode === 'rrf';
    var wantKSweep = mode === 'ksweep' || mode === 'kscan';
    var wantFusion = mode === 'fusion';

    console.log('Mode:', mode);

    if (wantKSweep) {
        var kRounds = await runKScan();
        rounds = rounds.concat(kRounds);
    }

    if (wantFusion) {
        var fRounds = await runFusionCompare();
        rounds = rounds.concat(fRounds);
    }

    if (wantBM25) {
        resetVectorIndex(CHAT_ID);
        var r1 = await runBM25Round();
        console.log('Round BM25 done, ' + r1.perQuery.length + ' queries.');
        rounds.push(r1);
    }

    if (wantVector || wantRRF) {
        resetVectorIndex(CHAT_ID);
    }

    if (wantVector) {
        var rV = await runVectorOnlyRound();
        console.log('Round Vector (pure) done, ' + rV.perQuery.length + ' queries.');
        rounds.push(rV);
    }

    if (wantRRF) {
        resetVectorIndex(CHAT_ID);
        var r2 = await runRRFRound();
        console.log('Round BM25+Vector (RRF) done, ' + r2.perQuery.length + ' queries.');
        if (!r2.anyVectorUsed) {
            console.error('WARNING: Vector search was NOT triggered in RRF round. Check EMBEDDING_URL/EMBEDDING_API_KEY.');
            console.error('BM25+Vector results may be identical to BM25.');
        }
        rounds.push(r2);
    }

    if (typeof globalThis !== 'undefined') delete globalThis.__ne_debug_rank_map;

    return rounds;
}

export function aggregateMetrics(round) {
    var types = { narrative: [], targeted: [] };
    var all = {
        p5: [], p10: [], p20: [],
        r5: [], r10: [], r20: [],
        ndcg10: [], mrr: [], hit5: [],
        hit3: [], p5a: [], hit5a: [], ws: []
    };

    round.perQuery.forEach(function(q) {
        var s = q.scores;
        all.p5.push(s.p5); all.p10.push(s.p10); all.p20.push(s.p20);
        all.r5.push(s.r5); all.r10.push(s.r10); all.r20.push(s.r20);
        all.ndcg10.push(s.ndcg10); all.mrr.push(s.mrr); all.hit5.push(s.hit5);
        all.hit3.push(s.hit3); all.p5a.push(s.p5a); all.hit5a.push(s.hit5a); all.ws.push(s.ws);

        if (types[q.type]) {
            types[q.type].push(s);
        }
    });

    function summarize(arr) {
        return { mean: avg(arr), median: median(arr) };
    }

    function summarizeScores(scoresArr) {
        return {
            p5: summarize(scoresArr.map(function(s) { return s.p5; })),
            p10: summarize(scoresArr.map(function(s) { return s.p10; })),
            p20: summarize(scoresArr.map(function(s) { return s.p20; })),
            r5: summarize(scoresArr.map(function(s) { return s.r5; })),
            r10: summarize(scoresArr.map(function(s) { return s.r10; })),
            r20: summarize(scoresArr.map(function(s) { return s.r20; })),
            ndcg10: summarize(scoresArr.map(function(s) { return s.ndcg10; })),
            mrr: summarize(scoresArr.map(function(s) { return s.mrr; })),
            hit5: summarize(scoresArr.map(function(s) { return s.hit5; })),
            hit3: summarize(scoresArr.map(function(s) { return s.hit3; })),
            p5a: summarize(scoresArr.map(function(s) { return s.p5a; })),
            hit5a: summarize(scoresArr.map(function(s) { return s.hit5a; })),
            ws: summarize(scoresArr.map(function(s) { return s.ws; })),
        };
    }

    return {
        label: round.label,
        all: summarizeScores(round.perQuery.map(function(q) { return q.scores; })),
        narrative: types.narrative.length > 0 ? summarizeScores(types.narrative) : null,
        targeted: types.targeted.length > 0 ? summarizeScores(types.targeted) : null,
        anyVectorUsed: round.anyVectorUsed,
        perQuery: round.perQuery.map(function(q) {
            return { description: q.description, type: q.type, scores: q.scores, gtRanks: q.gtRanks };
        }),
    };
}
