// NE-Memory: Diversity Filter Comparison
// Compares 4 diversity algorithms against baseline on retrieval quality metrics:
// entity coverage, entity-NDCG, unique entity count, token count.

import { allSTM, allLTM } from './fixture.js';
import { queries } from './queries.js';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';

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

function getText(c) {
    return c.event || c.summary || '';
}
function getId(c) {
    return c.__id || c.id || '';
}
function getEntities(c) {
    return c.entities || [];
}
function getRel(c) {
    return c.__relevance || 0;
}

function jaccardDedup(candidates, topK, threshold) {
    threshold = threshold || 0.7;
    var selected = [];
    for (var i = 0; i < candidates.length && selected.length < topK; i++) {
        var isDup = selected.some(function(s) {
            return vocabularyOverlap(getText(candidates[i]), getText(s)) > threshold;
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
        var entities = getEntities(c);
        var hasNew = entities.some(function(en) {
            var name = typeof en === 'string' ? en : (en.name || en);
            return !coveredEntities[name];
        });
        if (hasNew && getRel(c) > 0) {
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
    selected.forEach(function(s) { selectedIds[getId(s)] = true; });
    var remaining = candidates.filter(function(c) { return !selectedIds[getId(c)]; });
    if (selected.length < topK && remaining.length > 0) {
        var dedupRest = jaccardDedup(remaining, topK - selected.length, 0.7);
        selected = selected.concat(dedupRest);
    }
    return selected.slice(0, topK);
}

function mmrSelect(candidates, topK, lambda) {
    lambda = lambda || 0.7;
    var selected = [];
    var remaining = candidates.slice();
    while (selected.length < topK && remaining.length > 0) {
        var bestIdx = 0, bestScore = -Infinity;
        for (var i = 0; i < remaining.length; i++) {
            var relevance = getRel(remaining[i]);
            var maxSim = 0;
            for (var j = 0; j < selected.length; j++) {
                var sim = vocabularyOverlap(getText(remaining[i]), getText(selected[j]));
                if (sim > maxSim) maxSim = sim;
            }
            var score = lambda * relevance - (1 - lambda) * maxSim;
            if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
        selected.push(remaining[bestIdx]);
        remaining.splice(bestIdx, 1);
    }
    return selected;
}

function entityCoverage(candidates, groundTruthEntities) {
    if (!groundTruthEntities || groundTruthEntities.length === 0) return 0;
    var covered = {};
    candidates.forEach(function(c) {
        getEntities(c).forEach(function(en) {
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
        getEntities(c).forEach(function(en) {
            var name = typeof en === 'string' ? en : (en.name || en);
            set[name] = true;
        });
    });
    return Object.keys(set).length;
}

function tokenCount(candidates) {
    var total = 0;
    candidates.forEach(function(c) { total += _tokenize(getText(c)).length; });
    return total;
}

function ndcgAtK(retrieved, groundTruth, k) {
    k = Math.min(k, retrieved.length);
    var dcg = 0;
    for (var i = 0; i < k; i++) {
        var g = (groundTruth[getId(retrieved[i])] || 0);
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

var algorithms = {
    baseline: { name: 'Baseline',      fn: function(c, k) { return c.slice(0, k); } },
    greedy:   { name: 'Greedy Entity',  fn: greedyEntityCoverage },
    jaccard:  { name: 'Jaccard Dedup',  fn: jaccardDedup },
    hybrid:   { name: 'Hybrid',         fn: hybridDiversity },
    mmr:      { name: 'MMR',            fn: mmrSelect }
};

async function runBenchmark(allSTM, allLTM, queries, algoKeys, topK) {
    topK = topK || 10;
    var results = {};
    algoKeys.forEach(function(key) {
        results[key] = { coverage: [], ndcg: [], tokens: [], entityCount: [] };
    });

    var totalQueries = queries.length;
    for (var qi = 0; qi < totalQueries; qi++) {
        var q = queries[qi];
        var queryText = q.query || q.question || '';
        console.log('  Query ' + (qi + 1) + '/' + totalQueries + ': ' + queryText.substring(0, 60));

        var bm25Results = await filterCandidates(queryText, allSTM, allLTM, topK * 3, topK);

        algoKeys.forEach(function(key) {
            var selected = algorithms[key].fn(bm25Results, topK);
            results[key].coverage.push(entityCoverage(selected, q.groundTruthEntities || []));
            results[key].ndcg.push(ndcgAtK(selected, q.groundTruth || {}, topK));
            results[key].tokens.push(tokenCount(selected));
            results[key].entityCount.push(uniqueEntityCount(selected));
        });
    }

    console.log('\n=== Diversity Filter Benchmark (topK=' + topK + ', ' + totalQueries + ' queries) ===\n');

    var header = 'Algorithm         | Entity Cov | NDCG@' + topK + '  | Tokens/Q | Uniq Ent';
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
        return list;
    }

    rankBy('coverage', true);
    rankBy('ndcg', true);
    rankBy('tokens', false);
    rankBy('entityCount', true);

    algoKeys.forEach(function(key) {
        var c = avg(results[key].coverage);
        var n = avg(results[key].ndcg);
        var t = avg(results[key].tokens);
        var e = avg(results[key].entityCount);
        console.log(
            pad(algorithms[key].name, 18) + '| ' +
            pad(c.toFixed(3), 11) + '| ' +
            pad(n.toFixed(4), 9) + '| ' +
            pad(Math.round(t).toString(), 9) + '| ' +
            pad(e.toFixed(1), 8) +
            (rankSum[key] <= 5 ? ' ★' : '')
        );
    });

    console.log('\n★ = Top-4 (rank sum ≤ 5, lower = better)');

    var bestKey = algoKeys[0], bestSum = Infinity;
    algoKeys.forEach(function(k) { if (rankSum[k] < bestSum) { bestSum = rankSum[k]; bestKey = k; } });
    console.log('=> Best: ' + algorithms[bestKey].name + ' (rank sum = ' + bestSum + ')');
}

function pad(s, len) {
    var str = String(s);
    while (str.length < len) str += ' ';
    return str;
}

var algoKeys = ['baseline', 'greedy', 'jaccard', 'hybrid', 'mmr'];
runBenchmark(allSTM, allLTM, queries, algoKeys, 10);
