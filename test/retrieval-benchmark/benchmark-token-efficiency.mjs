// NE-Memory: Token Efficiency Sweep
// Sweeps BM25 topK from 5 to 60, measures NDCG@10, pipeline size,
// and estimated injection token cost at each level.
//
// Pipeline: BM25(topK) + Vector(bge-m3, topK=144) → linearFuse(α=0.20)
//           → Entity Chains → mergePipelines → groupCandidatesByEntity

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { allSTM, allLTM } from './fixture.js';
import { queries } from './queries.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_token_efficiency__';

process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;

// ─── Text utils ───
function _tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().split(/[\s,，。！？、:：；""''（）()\[\]{}【】\n\r\t]+/).filter(function(t) { return t.length > 0; });
}

// ─── Entity chain helpers ───
function collectAllEntityNames(stmArr) {
    var names = [];
    stmArr.forEach(function(e) {
        if (e.entities) {
            e.entities.forEach(function(en) {
                var n = typeof en === 'string' ? en : en.name;
                if (n && names.indexOf(n) === -1) names.push(n);
            });
        }
    });
    return names;
}

function extractEntityNames(query, allEntityNames) {
    var queryLower = query.toLowerCase();
    var matched = allEntityNames.filter(function(name) {
        return name.length > 1 && queryLower.indexOf(name.toLowerCase()) !== -1;
    });
    matched.sort(function(a, b) { return b.length - a.length; });
    return matched.slice(0, 5);
}

function buildEntityChains(stmArr, entityNames) {
    var chains = {};
    entityNames.forEach(function(name) {
        var chainEntries = [];
        stmArr.forEach(function(e) {
            if (e.entities && e.entities.some(function(en) {
                return (typeof en === 'string' ? en : en.name) === name;
            })) {
                chainEntries.push(e);
            }
        });
        if (chainEntries.length > 0) chains[name] = chainEntries;
    });
    return chains;
}

// ─── Injection token estimator (mirrors buildEntityBlock + highlights) ───
function estimateInjectionTokens(mergedMap, grouped) {
    var groups = grouped.groups || {};
    var total = 0;

    // Key highlights: ~12 tokens header + ~25 tokens per entry
    var hlCount = 0;
    mergedMap.forEach(function(v) {
        if (!v._isDirectory && v.relevance > 0) hlCount++;
    });
    total += 12 + Math.min(hlCount, 5) * 25;

    // Entity groups: ~10 tokens header + ~25 tokens per entry + ~3 tokens per fold line
    Object.keys(groups).forEach(function(name) {
        var g = groups[name];
        var hitCount = 0;
        g.entries.forEach(function(e) { if (e.relevance > 0) hitCount++; });
        total += 14; // <h3><b>Name</b> <small>(N events, M hits)</small></h3>
        g.entries.forEach(function(e) {
            if (e.relevance > 0) total += 25; // full entry
            else total += 3; // folded
        });
    });

    // Unassigned
    if (grouped.unassigned && grouped.unassigned.length > 0) {
        total += 12 + grouped.unassigned.length * 20;
    }

    return total;
}

function getEntryId(entry) {
    var e = entry.entry;
    return e ? (e.__id || e.id || '') : (entry.__id || '');
}

function ndcgAtK(retrieved, groundTruth, k) {
    k = Math.min(k, retrieved.length);
    var dcg = 0;
    for (var i = 0; i < k; i++) {
        var g = (groundTruth[getEntryId(retrieved[i])] || 0);
        dcg += g / Math.log2(i + 2);
    }
    var idealGains = [];
    Object.keys(groundTruth).forEach(function(id) { idealGains.push(groundTruth[id]); });
    idealGains.sort(function(a, b) { return b - a; });
    var idcg = 1e-9;
    for (var i = 0; i < Math.min(k, idealGains.length); i++) {
        idcg += idealGains[i] / Math.log2(i + 2);
    }
    return dcg / Math.max(idcg, 1e-9);
}

function flattenMergedPipeline(mergedMap) {
    var entries = [];
    mergedMap.forEach(function(v) { entries.push(v); });
    entries.sort(function(a, b) { return (b.relevance || 0) - (a.relevance || 0); });
    return entries;
}

function setBgeM3() {
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
}

// ─── Main sweep ───
var BM25_SWEEP = [5, 10, 15, 20, 30, 40, 50, 60];
var VEC_TOP_K = 144;
var OUTPUT_TOPK = 10;
var alphas = [0.20, 0.30, 0.40, 0.50];

async function main() {
    console.log('=== Token Efficiency Sweep ===\n');
    console.log('Vector topK=' + VEC_TOP_K + ' | Output topK=' + OUTPUT_TOPK);
    console.log('Sweeping BM25 topK: ' + BM25_SWEEP.join(', '));
    console.log('Embedding: ' + config.model + '\n');

    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    var allEntityNames = collectAllEntityNames(allSTM);

    // Pre-compute vector embeddings for all queries
    console.log('Pre-computing query embeddings...');
    var queryData = [];
    for (var qi = 0; qi < queries.length; qi++) {
        setBgeM3();
        var qText = queries[qi].query || queries[qi].question || '';
        var emb = await computeEmbedding(qText);
        var vecResults = vectorSearch(emb, vecIdx, VEC_TOP_K);
        var rawVecIds = vecResults.map(function(v) { return v.entry.id; });
        var entityNames = extractEntityNames(qText, allEntityNames);
        var entityChains = buildEntityChains(allSTM, entityNames);
        queryData.push({
            query: qText,
            embedding: emb,
            rawVecIds: rawVecIds,
            entityNames: entityNames,
            entityChains: entityChains,
            groundTruth: queries[qi].groundTruth || {}
        });
    }
    var totalQueries = queries.length;

    // ── Sweep BM25 topK ──
    console.log('\nRunning sweeps...\n');
    var sweepResults = {};
    BM25_SWEEP.forEach(function(bm25K) {
        sweepResults[bm25K] = {
            ndcgSum: 0,
            pipeSizeSum: 0,
            tokenSum: 0,
            vecFusedSizes: 0
        };
    });

    for (var qi = 0; qi < totalQueries; qi++) {
        var qd = queryData[qi];
        var qText = qd.query;
        process.stdout.write('  [' + (qi + 1) + '/' + totalQueries + '] ' + qText.substring(0, 50) + '...');

        for (var si = 0; si < BM25_SWEEP.length; si++) {
            var bm25K = BM25_SWEEP[si];

            // BM25 retrieval
            delete process.env.NE_BENCHMARK_VECTOR;
            var bm25Results = await filterCandidates(qText, allSTM, allLTM, bm25K, 3, {}, CHAT_ID);
            var rawBm25Ids = bm25Results.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });

            // RRF fusion
            var fusedIds = linearFuse(rawBm25Ids, qd.rawVecIds, 0.20, 40, 60);
            var fusedSet = {};
            fusedIds.forEach(function(id) { fusedSet[id] = true; });
            var pipelineBm25 = bm25Results.filter(function(r) {
                return fusedSet[r.__id || r.id];
            });

            // mergePipelines + groupCandidatesByEntity
            var merged = await mergePipelines(pipelineBm25, qd.entityChains, allLTM, { characters: {}, factions: {} }, allSTM);
            var grouped = groupCandidatesByEntity(merged.map, merged.threadIndex);
            var allEntries = flattenMergedPipeline(merged.map);

            // Metrics
            var top10 = allEntries.slice(0, OUTPUT_TOPK);
            var ndcg = ndcgAtK(top10, qd.groundTruth, OUTPUT_TOPK);
            var tokens = estimateInjectionTokens(merged.map, grouped);
            var pipeSize = allEntries.length;

            sweepResults[bm25K].ndcgSum += ndcg;
            sweepResults[bm25K].pipeSizeSum += pipeSize;
            sweepResults[bm25K].tokenSum += tokens;
            sweepResults[bm25K].vecFusedSizes += fusedIds.length;
        }
        process.stdout.write(' done\n');
    }

    // ── Report ──
    console.log('\n=== Token Efficiency Results (α=0.20) ===\n');
    console.log('BM25 K | NDCG@10 | Pipe Sz | Inj Tok | Tok/NDCG | Vec Fused');
    console.log('-'.repeat(67));

    var bestNDCG = 0, bestTokenEff = Infinity;
    sweepResults[BM25_SWEEP[BM25_SWEEP.length - 1]].ndcgSum /= totalQueries;
    bestNDCG = sweepResults[BM25_SWEEP[BM25_SWEEP.length - 1]].ndcgSum;

    BM25_SWEEP.forEach(function(bm25K) {
        var r = sweepResults[bm25K];
        var nAvg = r.ndcgSum / totalQueries;
        var pAvg = r.pipeSizeSum / totalQueries;
        var tAvg = Math.round(r.tokenSum / totalQueries);
        var tEff = nAvg > 0.001 ? tAvg / nAvg : Infinity;
        var vAvg = Math.round(r.vecFusedSizes / totalQueries);
        if (tEff < bestTokenEff) bestTokenEff = tEff;
        var nRel = nAvg / Math.max(bestNDCG, 0.001);
        var marker = nRel >= 0.95 ? ' ★' : (nRel >= 0.85 ? ' ●' : '');

        console.log(
            pad(bm25K, 7) + ' | ' +
            pad(nAvg.toFixed(4), 8) + ' | ' +
            pad(pAvg.toFixed(1), 7) + ' | ' +
            pad(tAvg.toString(), 7) + ' | ' +
            pad(Math.round(tEff).toString(), 8) + ' | ' +
            pad(vAvg.toString(), 8) + marker
        );
    });

    // ── Alpha sweep ──
    console.log('\n=== RRF Alpha Sweep (BM25=40, Vec=144) ===\n');
    console.log('α      | NDCG@10 | Pipe Sz | Inj Tok | Vec Fused');
    console.log('-'.repeat(57));

    for (var ai = 0; ai < alphas.length; ai++) {
        var alpha = alphas[ai];
        var ndcgSum2 = 0, pipeSum2 = 0, tokSum2 = 0, fusedSum2 = 0;

        for (var qi = 0; qi < totalQueries; qi++) {
            var qd2 = queryData[qi];
            delete process.env.NE_BENCHMARK_VECTOR;
            var bm25R2 = await filterCandidates(qd2.query, allSTM, allLTM, 40, 3, {}, CHAT_ID);
            var rawIds2 = bm25R2.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });
            var fusedIds2 = linearFuse(rawIds2, qd2.rawVecIds, alpha, 40, 60);
            var fusedSet2 = {};
            fusedIds2.forEach(function(id) { fusedSet2[id] = true; });
            var pb2 = bm25R2.filter(function(r) { return fusedSet2[r.__id || r.id]; });
            var m2 = await mergePipelines(pb2, qd2.entityChains, allLTM, { characters: {}, factions: {} }, allSTM);
            var g2 = groupCandidatesByEntity(m2.map, m2.threadIndex);
            var ae2 = flattenMergedPipeline(m2.map);
            ndcgSum2 += ndcgAtK(ae2.slice(0, OUTPUT_TOPK), qd2.groundTruth, OUTPUT_TOPK);
            pipeSum2 += ae2.length;
            tokSum2 += estimateInjectionTokens(m2.map, g2);
            fusedSum2 += fusedIds2.length;
        }

        console.log(
            pad(alpha.toFixed(2), 6) + ' | ' +
            pad((ndcgSum2 / totalQueries).toFixed(4), 8) + ' | ' +
            pad((pipeSum2 / totalQueries).toFixed(1), 7) + ' | ' +
            pad(Math.round(tokSum2 / totalQueries).toString(), 7) + ' | ' +
            pad(Math.round(fusedSum2 / totalQueries).toString(), 8)
        );
    }

    // ── Efficiency curve summary ──
    // ── Vector topK sweep ──
    console.log('\n=== Vector TopK Sweep (BM25=5, α=0.20) ===\n');
    var VEC_SWEEP = [36, 72, 144];
    console.log('Vec K  | NDCG@10 | Pipe Sz | Inj Tok | Vec Fused');
    console.log('-'.repeat(57));

    for (var vi = 0; vi < VEC_SWEEP.length; vi++) {
        var vecK = VEC_SWEEP[vi];
        var ndcgSum3 = 0, pipeSum3 = 0, tokSum3 = 0, fusedSum3 = 0;

        for (var qi = 0; qi < totalQueries; qi++) {
            var qd3 = queryData[qi];
            var vecResultsSmall = vectorSearch(qd3.embedding, vecIdx, vecK);
            var rawVecIdsSmall = vecResultsSmall.map(function(v) { return v.entry.id; });

            // Use pre-computed BM25 from main sweep (BM25=5)
            delete process.env.NE_BENCHMARK_VECTOR;
            var bm25R3 = await filterCandidates(qd3.query, allSTM, allLTM, 5, 3, {}, CHAT_ID);
            var rawIds3 = bm25R3.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });
            var fusedIds3 = linearFuse(rawIds3, rawVecIdsSmall, 0.20, 40, 60);
            var fusedSet3 = {};
            fusedIds3.forEach(function(id) { fusedSet3[id] = true; });
            var pb3 = bm25R3.filter(function(r) { return fusedSet3[r.__id || r.id]; });
            var m3 = await mergePipelines(pb3, qd3.entityChains, allLTM, { characters: {}, factions: {} }, allSTM);
            var g3 = groupCandidatesByEntity(m3.map, m3.threadIndex);
            var ae3 = flattenMergedPipeline(m3.map);
            ndcgSum3 += ndcgAtK(ae3.slice(0, OUTPUT_TOPK), qd3.groundTruth, OUTPUT_TOPK);
            pipeSum3 += ae3.length;
            tokSum3 += estimateInjectionTokens(m3.map, g3);
            fusedSum3 += fusedIds3.length;
        }

        console.log(
            pad(vecK, 6) + ' | ' +
            pad((ndcgSum3 / totalQueries).toFixed(4), 8) + ' | ' +
            pad((pipeSum3 / totalQueries).toFixed(1), 7) + ' | ' +
            pad(Math.round(tokSum3 / totalQueries).toString(), 7) + ' | ' +
            pad(Math.round(fusedSum3 / totalQueries).toString(), 8)
        );
    }

    console.log('\n=== Efficiency Summary ===');
    console.log('NDCG ceiling (BM25=60): ' + bestNDCG.toFixed(4));
    console.log('Best token/NDCG: ' + Math.round(bestTokenEff));

    console.log('\nBM25 K → NDCG% of ceiling:');
    BM25_SWEEP.forEach(function(bm25K) {
        var nAvg = sweepResults[bm25K].ndcgSum / totalQueries;
        var pct = Math.round(nAvg / bestNDCG * 100);
        var bar = '█'.repeat(Math.round(pct / 4));
        console.log('  ' + pad(bm25K.toString(), 3) + ' ' + pad(nAvg.toFixed(4), 6) + ' ' + bar + ' ' + pct + '%');
    });
}

function pad(s, len) {
    var str = String(s);
    while (str.length < len) str += ' ';
    return str;
}

main().catch(function(e) { console.error(e); process.exit(1); });
