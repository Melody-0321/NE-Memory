// NE-Memory: Entity Chain Ablation — A/B comparison
// Compares full pipeline (BM25+Vector+RRF+EntityChains) vs
// no-chain (BM25+Vector+RRF only) on NDCG@10 and injection tokens.
//
// Primary question: does lookupEntityChains → mergePipelines step 2
// add any actual retrieval value now that groupCandidatesByEntity
// already groups by entry.entities[]?

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
var CHAT_ID = '__bench_no_chain__';

process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;

function _tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().split(/[\s,，。！？、:：;；""''（）()\[\]{}【】\n\r\t]+/).filter(function(t) { return t.length > 0; });
}

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
        var chainEntries = stmArr.filter(function(e) {
            return e.entities && e.entities.some(function(en) {
                return (typeof en === 'string' ? en : en.name) === name;
            });
        });
        if (chainEntries.length > 0) chains[name] = chainEntries;
    });
    return chains;
}

function estimateInjectionTokens(mergedMap, grouped) {
    var groups = grouped.groups || {};
    var total = 0;
    var hlCount = 0;
    mergedMap.forEach(function(v) {
        if (!v._isDirectory && v.relevance > 0) hlCount++;
    });
    total += 12 + Math.min(hlCount, 5) * 25;
    Object.keys(groups).forEach(function(name) {
        var g = groups[name];
        var hitCount = 0;
        g.entries.forEach(function(e) { if (e.relevance > 0) hitCount++; });
        total += 14;
        g.entries.forEach(function(e) {
            if (e.relevance > 0) total += 25;
            else total += 3;
        });
    });
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

function setBgeM3() { process.env.EMBEDDING_MODEL = 'BAAI/bge-m3'; }

async function main() {
    console.log('=== Entity Chain Ablation — A/B Comparison ===\n');
    console.log('BM25=5 | Vec=36 | RRF α=0.20 | Output topK=10\n');

    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    var allEntityNames = collectAllEntityNames(allSTM);
    var totalQueries = queries.length;

    console.log('Pre-computing query embeddings...');
    var queryData = [];
    for (var qi = 0; qi < totalQueries; qi++) {
        setBgeM3();
        var qText = queries[qi].query || queries[qi].question || '';
        var emb = await computeEmbedding(qText);
        var entityNames = extractEntityNames(qText, allEntityNames);
        var entityChains = buildEntityChains(allSTM, entityNames);
        queryData.push({
            query: qText,
            embedding: emb,
            entityNames: entityNames,
            entityChains: entityChains,
            groundTruth: queries[qi].groundTruth || {}
        });
    }

    console.log('\nRunning A/B comparison...\n');

    var withChain = { ndcg: [], pipeSz: [], tokens: [], fusedSz: [] };
    var withoutChain = { ndcg: [], pipeSz: [], tokens: [], fusedSz: [] };

    for (var qi = 0; qi < totalQueries; qi++) {
        var qd = queryData[qi];
        process.stdout.write('  [' + (qi + 1) + '/' + totalQueries + '] ' + qd.query.substring(0, 50) + '...');

        // ── Common: BM25 + Vector + RRF ──
        delete process.env.NE_BENCHMARK_VECTOR;
        var bm25Results = await filterCandidates(qd.query, allSTM, allLTM, 5, 3, {}, CHAT_ID);
        var rawBm25Ids = bm25Results.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });
        var vecResults = vectorSearch(qd.embedding, vecIdx, 36);
        var rawVecIds = vecResults.map(function(v) { return v.entry.id; });
        var fusedIds = linearFuse(rawBm25Ids, rawVecIds, 0.20, 40, 60);
        var fusedSet = {};
        fusedIds.forEach(function(id) { fusedSet[id] = true; });
        var pipelineBm25 = bm25Results.filter(function(r) { return fusedSet[r.__id || r.id]; });

        // ── A: With entity chains ──
        var mA = await mergePipelines(pipelineBm25, qd.entityChains, allLTM, { characters: {}, factions: {} }, allSTM);
        var gA = groupCandidatesByEntity(mA.map, mA.threadIndex);
        var aeA = flattenMergedPipeline(mA.map);
        withChain.ndcg.push(ndcgAtK(aeA.slice(0, 10), qd.groundTruth, 10));
        withChain.pipeSz.push(aeA.length);
        withChain.tokens.push(estimateInjectionTokens(mA.map, gA));
        withChain.fusedSz.push(fusedIds.length);

        // ── B: Without entity chains ──
        var mB = await mergePipelines(pipelineBm25, {}, allLTM, { characters: {}, factions: {} }, allSTM);
        var gB = groupCandidatesByEntity(mB.map, mB.threadIndex);
        var aeB = flattenMergedPipeline(mB.map);
        withoutChain.ndcg.push(ndcgAtK(aeB.slice(0, 10), qd.groundTruth, 10));
        withoutChain.pipeSz.push(aeB.length);
        withoutChain.tokens.push(estimateInjectionTokens(mB.map, gB));
        withoutChain.fusedSz.push(fusedIds.length);

        process.stdout.write(' done\n');
    }

    // ── Report ──
    function avg(arr) { return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length; }

    var wN = avg(withChain.ndcg);
    var wT = avg(withChain.tokens);
    var wP = avg(withChain.pipeSz);
    var woN = avg(withoutChain.ndcg);
    var woT = avg(withoutChain.tokens);
    var woP = avg(withoutChain.pipeSz);

    console.log('\n┌─────────────────┬──────────┬──────────┬──────────┐');
    console.log('│       Variant   │ NDCG@10  │ Pipe Sz  │ Inj Tok  │');
    console.log('├─────────────────┼──────────┼──────────┼──────────┤');
    console.log('│ With chains     │ ' + pad(wN.toFixed(4), 8) + ' │ ' + pad(wP.toFixed(1), 8) + ' │ ' + pad(Math.round(wT).toString(), 8) + ' │');
    console.log('│ Without chains  │ ' + pad(woN.toFixed(4), 8) + ' │ ' + pad(woP.toFixed(1), 8) + ' │ ' + pad(Math.round(woT).toString(), 8) + ' │');
    console.log('├─────────────────┼──────────┼──────────┼──────────┤');
    var ndcgD = woN - wN;
    var tokD = Math.round(woT - wT);
    var pipeD = (woP - wP).toFixed(1);
    console.log('│ Δ (no — with)   │ ' + pad((ndcgD >= 0 ? '+' : '') + ndcgD.toFixed(4), 8) + ' │ ' + pad((pipeD >= 0 ? '+' : '') + pipeD, 8) + ' │ ' + pad((tokD >= 0 ? '+' : '') + tokD.toString(), 8) + ' │');
    console.log('└─────────────────┴──────────┴──────────┴──────────┘');

    var wins = 0, losses = 0, ties = 0;
    for (var qi = 0; qi < totalQueries; qi++) {
        var d = withoutChain.ndcg[qi] - withChain.ndcg[qi];
        if (d > 0.001) wins++;
        else if (d < -0.001) losses++;
        else ties++;
    }
    console.log('\nPer-query NDCG: no-chain wins=' + wins + ' losses=' + losses + ' ties=' + ties);

    var vs = [
        { k: 'tokens', better: 'less' },
        { k: 'pipeSz', better: 'less' }
    ];
    vs.forEach(function(v) {
        var improved = 0, same = 0, regressed = 0;
        for (var qi = 0; qi < totalQueries; qi++) {
            var d = withoutChain[v.k][qi] - withChain[v.k][qi];
            if (d < -1) improved++;
            else if (d > 1) regressed++;
            else same++;
        }
        console.log('Per-query ' + v.k + ': no-chain improved=' + improved + ' same=' + same + ' regressed=' + regressed);
    });
}

function pad(s, len) {
    var str = String(s);
    while (str.length < len) str += ' ';
    return str;
}

main().catch(function(e) { console.error(e); process.exit(1); });
