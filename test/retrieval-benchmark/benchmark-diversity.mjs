// NE-Memory: Diversity Filter — Full Pipeline Benchmark
// Pipeline: BM25(topK=40) + Vector(bge-m3, topK=144) → linearFuse(α=0.20)
//           → Entity Chains → mergePipelines → groupCandidatesByEntity
//           → Flatten → Diversity Algorithm → Metrics (NDCG, Entity Cov, Tokens, Unique Entities)

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { allSTM, allLTM } from './fixture.js';
import { loadSplitQueries } from './query-split-utils.js';
var queries = loadSplitQueries();
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_diversity__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;
var TOP_K_OUT = 10;

// ─── API env vars ───
process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;

// ─── Text utils ───
function _tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().split(/[\s,，。！？、：；""''（）()\[\]{}【】\n\r\t]+/).filter(function(t) { return t.length > 0; });
}

function vocabularyOverlap(textA, textB) {
    var tokensA = _tokenize(textA);
    var tokensB = _tokenize(textB);
    var setA = {}, setB = {};
    for (var ti = 0; ti < tokensA.length; ti++) setA[tokensA[ti]] = true;
    for (var ti = 0; ti < tokensB.length; ti++) setB[tokensB[ti]] = true;
    var union = 0, intersection = 0;
    var allKeys = {};
    for (var k in setA) { allKeys[k] = true; }
    for (var k in setB) { allKeys[k] = true; }
    for (var k in allKeys) {
        union++;
        if (setA[k] && setB[k]) intersection++;
    }
    return union === 0 ? 0 : intersection / union;
}

// ─── Entity chain (same as benchmark-key-highlights) ───
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
        if (chainEntries.length > 0) {
            chainEntries.sort(function(a, b) {
                var ta = a.msg_ids && a.msg_ids.length > 0 ? a.msg_ids[0] : 0;
                var tb = b.msg_ids && b.msg_ids.length > 0 ? b.msg_ids[0] : 0;
                return ta - tb;
            });
            chains[name] = chainEntries;
        }
    });
    return chains;
}

// ─── Flatten merged pipeline map → ranked list ───
function flattenMergedPipeline(mergedMap) {
    var entries = [];
    mergedMap.forEach(function(v) { entries.push(v); });
    entries.sort(function(a, b) { return (b.relevance || 0) - (a.relevance || 0); });
    return entries;
}

// ─── Diversity algorithms (operate on merged pipeline entries) ───
function getEntryText(entry) {
    var e = entry.entry;
    return e ? (e.event || e.summary || '') : '';
}
function getEntryId(entry) {
    var e = entry.entry;
    return e ? (e.__id || e.id || '') : (entry.__id || '');
}
function getEntryEntities(entry) {
    var e = entry.entry;
    return (e && e.entities) ? e.entities : [];
}
function getEntryRel(entry) {
    return entry.relevance || 0;
}

function jaccardDedup(candidates, topK, threshold) {
    threshold = threshold || 0.7;
    var selected = [];
    for (var i = 0; i < candidates.length && selected.length < topK; i++) {
        var isDup = selected.some(function(s) {
            return vocabularyOverlap(getEntryText(candidates[i]), getEntryText(s)) > threshold;
        });
        if (!isDup) selected.push(candidates[i]);
    }
    return selected;
}

function greedyEntityCoverage(candidates, topK) {
    var selected = [];
    var coveredEntities = {};
    for (var i = 0; i < candidates.length && selected.length < topK; i++) {
        var c = candidates[i];
        var entities = getEntryEntities(c);
        var hasNew = entities.some(function(en) {
            var name = typeof en === 'string' ? en : (en.name || en);
            return !coveredEntities[name];
        });
        if (hasNew && getEntryRel(c) > 0) {
            selected.push(c);
            entities.forEach(function(en) {
                var name = typeof en === 'string' ? en : (en.name || en);
                coveredEntities[name] = true;
            });
        }
    }
    return selected;
}

function hybridDiversity(candidates, topK) {
    var coverageK = Math.ceil(topK * 0.6);
    var selected = greedyEntityCoverage(candidates, coverageK);
    var selectedIds = {};
    selected.forEach(function(s) { selectedIds[getEntryId(s)] = true; });
    var remaining = candidates.filter(function(c) { return !selectedIds[getEntryId(c)]; });
    if (selected.length < topK && remaining.length > 0) {
        var dedupRest = jaccardDedup(remaining, topK - selected.length, 0.7);
        selected = selected.concat(dedupRest);
    }
    return selected.slice(0, topK);
}

function mmrSelect(candidates, topK, lambda, simThreshold) {
    lambda = lambda || 0.7;
    simThreshold = simThreshold || 0.0;
    var selected = [];
    var remaining = candidates.slice();
    while (selected.length < topK && remaining.length > 0) {
        var bestIdx = 0, bestScore = -Infinity;
        for (var i = 0; i < remaining.length; i++) {
            var relevance = getEntryRel(remaining[i]);
            var maxSim = 0;
            for (var j = 0; j < selected.length; j++) {
                var sim = vocabularyOverlap(getEntryText(remaining[i]), getEntryText(selected[j]));
                if (sim > maxSim) maxSim = sim;
            }
            if (maxSim < simThreshold) maxSim = 0;
            var score = lambda * relevance - (1 - lambda) * maxSim;
            if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
        selected.push(remaining[bestIdx]);
        remaining.splice(bestIdx, 1);
    }
    return selected;
}

// ─── Metrics ───
function entityCoverage(candidates, groundTruthEntities) {
    if (!groundTruthEntities || groundTruthEntities.length === 0) return 0;
    var covered = {};
    candidates.forEach(function(c) {
        getEntryEntities(c).forEach(function(en) {
            var name = typeof en === 'string' ? en : (en.name || en);
            covered[name] = true;
        });
    });
    var matched = 0;
    groundTruthEntities.forEach(function(e) { if (covered[e]) matched++; });
    return matched / groundTruthEntities.length;
}

function uniqueEntityCount(candidates) {
    var set = {};
    candidates.forEach(function(c) {
        getEntryEntities(c).forEach(function(en) {
            var name = typeof en === 'string' ? en : (en.name || en);
            set[name] = true;
        });
    });
    return Object.keys(set).length;
}

function tokenCount(candidates) {
    var total = 0;
    candidates.forEach(function(c) { total += _tokenize(getEntryText(c)).length; });
    return total;
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

// ─── Entities in selected set (for entity-NDCG on pipeline level) ───
function buildEntityNDCG(retrieved, groundTruth, k) {
    k = Math.min(k, retrieved.length);
    var entitySet = {};
    for (var i = 0; i < k; i++) {
        (retrieved[i].entry.entities || []).forEach(function(en) {
            var name = typeof en === 'string' ? en : (en.name || en);
            if (!entitySet[name]) entitySet[name] = [];
            entitySet[name].push({ idx: i, rel: (groundTruth[getEntryId(retrieved[i])] || 0) });
        });
    }
    return entitySet;
}

// ─── Main ───
var algorithms = {
    baseline:  { name: 'Baseline',            fn: function(c, k) { return c.slice(0, k); } },
    greedy:    { name: 'Greedy Entity',        fn: greedyEntityCoverage },
    jaccard03: { name: 'Jaccard \u03b8=0.3',       fn: function(c, k) { return jaccardDedup(c, k, 0.3); } },
    jaccard05: { name: 'Jaccard \u03b8=0.5',       fn: function(c, k) { return jaccardDedup(c, k, 0.5); } },
    jaccard07: { name: 'Jaccard \u03b8=0.7',       fn: jaccardDedup },
    hybrid:    { name: 'Hybrid',               fn: hybridDiversity },
    mmr03:     { name: 'MMR \u03bb=0.7,\u03b8=0.3',    fn: function(c, k) { return mmrSelect(c, k, 0.7, 0.3); } },
    mmr07:     { name: 'MMR \u03bb=0.7,\u03b8=0.7',    fn: function(c, k) { return mmrSelect(c, k, 0.7, 0.7); } }
};
var algoKeys = Object.keys(algorithms);

async function main() {
    console.log('=== Diversity Filter — Full Pipeline Benchmark ===\n');
    console.log('BM25 topK=' + TOP_K_BM25 + ' | Vector topK=' + TOP_K_VEC + ' | Fusion \u03b1=0.20 | Output topK=' + TOP_K_OUT);
    console.log('Embedding: ' + config.model + '\n');

    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    var allEntityNames = collectAllEntityNames(allSTM);
    var results = {};
    algoKeys.forEach(function(key) {
        results[key] = { ndcg: [], entityCov: [], tokens: [], uniqEnt: [], pipelineSize: [] };
    });

    var totalQueries = queries.length;
    for (var qi = 0; qi < totalQueries; qi++) {
        var q = queries[qi];
        var queryText = q.query || q.question || '';
        console.log('  [' + (qi + 1) + '/' + totalQueries + '] ' + q.id + ': ' + queryText.substring(0, 60));

        // ── Step 1: BM25 retrieval (pure, no vector) ──
        delete process.env.NE_BENCHMARK_VECTOR;
        var bm25Results = await filterCandidates(queryText, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
        var rawBm25Ids = bm25Results.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });

        // ── Step 2: Vector search ──
        setBgeM3();
        var queryEmb = await computeEmbedding(queryText);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K_VEC);
        var rawVecIds = vecResults.map(function(v) { return v.entry.id; });

        // ── Step 3: RRF fusion (asymmetric α=0.20) ──
        var fusedIds = linearFuse(rawBm25Ids, rawVecIds, 0.20, 40, 60);

        // Build stmById lookup
        var stmById = {};
        allSTM.forEach(function(e) { if (e.id) stmById[e.id] = e; });

        // Filter BM25 results to only fused IDs + add vector-only entries
        var fusedSet = {};
        fusedIds.forEach(function(id) { fusedSet[id] = true; });
        var pipelineBm25 = bm25Results.filter(function(r) {
            return fusedSet[r.__id || r.id];
        });

        // ── Step 4: Entity chains ──
        var entityNames = extractEntityNames(queryText, allEntityNames);
        var entityChains = buildEntityChains(allSTM, entityNames);

        // ── Step 5: mergePipelines ──
        var merged = await mergePipelines(pipelineBm25, entityChains, allLTM, { characters: {}, factions: {} }, allSTM);

        // ── Step 6: groupCandidatesByEntity ──
        var grouped = groupCandidatesByEntity(merged.map, merged.threadIndex);

        // ── Step 7: Flatten all entries → ranked list ──
        var allPipelineEntries = flattenMergedPipeline(merged.map);
        var pipelineSize = allPipelineEntries.length;

        // ── Step 8: Apply diversity algorithms ──
        algoKeys.forEach(function(key) {
            var selected = algorithms[key].fn(allPipelineEntries, TOP_K_OUT);
            results[key].pipelineSize.push(pipelineSize);
            results[key].ndcg.push(ndcgAtK(selected, q.groundTruth || {}, TOP_K_OUT));
            results[key].entityCov.push(entityCoverage(selected, q.groundTruthEntities || []));
            results[key].tokens.push(tokenCount(selected));
            results[key].uniqEnt.push(uniqueEntityCount(selected));
        });
    }

    // ── Report ──
    console.log('\n');
    console.log('=== Full Pipeline Diversity Benchmark ===');
    console.log('topK=' + TOP_K_OUT + ', queries=' + totalQueries +
        ', avg pipeline size=' + (avg(results.baseline.pipelineSize)).toFixed(1) + '\n');

    var header = 'Algorithm         | Entity Cov | NDCG@' + TOP_K_OUT + '  | Tokens/Q | Uniq Ent | Pipe Sz';
    console.log(header);
    console.log('-'.repeat(header.length + 2));

    function avg(arr) { return arr.length ? arr.reduce(function(a, b) { return a + b; }, 0) / arr.length : 0; }

    var rankSum = {};
    function rankBy(metric, higherIsBetter) {
        var list = algoKeys.map(function(k) { return { key: k, val: avg(results[k][metric]) }; });
        list.sort(function(a, b) { return higherIsBetter ? b.val - a.val : a.val - b.val; });
        list.forEach(function(item, i) {
            if (rankSum[item.key] === undefined) rankSum[item.key] = 0;
            rankSum[item.key] += i;
        });
    }

    rankBy('ndcg', true);
    rankBy('entityCov', true);
    rankBy('tokens', false);
    rankBy('uniqEnt', true);

    algoKeys.forEach(function(key) {
        var c = avg(results[key].entityCov);
        var n = avg(results[key].ndcg);
        var t = avg(results[key].tokens);
        var e = avg(results[key].uniqEnt);
        var p = avg(results[key].pipelineSize);
        console.log(
            pad(algorithms[key].name, 18) + '| ' +
            pad(c.toFixed(3), 11) + '| ' +
            pad(n.toFixed(4), 9) + '| ' +
            pad(Math.round(t).toString(), 9) + '| ' +
            pad(e.toFixed(1), 9) + '| ' +
            pad(p.toFixed(1), 7) +
            (rankSum[key] <= 6 ? ' \u2605' : '')
        );
    });

    console.log('\n\u2605 = Top-4 rank sum \u2264 6 (lower = better)');

    var bestKey = algoKeys[0], bestSum = Infinity;
    algoKeys.forEach(function(k) { if (rankSum[k] < bestSum) { bestSum = rankSum[k]; bestKey = k; } });
    console.log('\n=> Best: ' + algorithms[bestKey].name + ' (rank sum = ' + bestSum + ')');

    // Per-query delta detail
    console.log('\n=== Per-Query NDCG Delta vs Baseline ===\n');
    algoKeys.filter(function(k) { return k !== 'baseline'; }).forEach(function(key) {
        var gains = 0, losses = 0, ties = 0, sum = 0;
        for (var qi = 0; qi < totalQueries; qi++) {
            var d = results[key].ndcg[qi] - results.baseline.ndcg[qi];
            sum += d;
            if (d > 0.001) gains++;
            else if (d < -0.001) losses++;
            else ties++;
        }
        console.log('  ' + pad(algorithms[key].name, 18) +
            ' wins=' + gains + ' losses=' + losses + ' ties=' + ties +
            ' mean\u0394=' + (sum / totalQueries).toFixed(4));
    });
}

function pad(s, len) {
    var str = String(s);
    while (str.length < len) str += ' ';
    return str;
}

function setBgeM3() {
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
}

main().catch(function(e) { console.error(e); process.exit(1); });
