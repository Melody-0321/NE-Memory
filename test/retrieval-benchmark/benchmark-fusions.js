export function linearFuse(bm25Ids, vecIds, alpha, topK, rrfK) {
    var scores = {};
    var k = rrfK != null ? rrfK : 60;

    for (var i = 0; i < bm25Ids.length; i++) {
        var id = bm25Ids[i];
        scores[id] = (scores[id] || 0) + alpha * (1 / (k + i + 1));
        scores['_has_' + id] = true;
    }

    for (var j = 0; j < vecIds.length; j++) {
        var vid = vecIds[j];
        scores[vid] = (scores[vid] || 0) + (1 - alpha) * (1 / (k + j + 1));
        scores['_has_' + vid] = true;
    }

    var ids = Object.keys(scores).filter(function(k) { return k.indexOf('_has_') !== 0; });
    ids.sort(function(a, b) { return (scores[b] || 0) - (scores[a] || 0); });

    return ids.slice(0, Math.min(topK, ids.length));
}

export function cascadeBM25ToVec(bm25Ids, vecIds, topK) {
    var poolSize = Math.min(topK * 2, bm25Ids.length);
    var pool = {};
    for (var i = 0; i < poolSize; i++) {
        pool[bm25Ids[i]] = true;
    }

    var result = [];
    for (var j = 0; j < vecIds.length && result.length < topK; j++) {
        if (pool[vecIds[j]] && result.indexOf(vecIds[j]) === -1) {
            result.push(vecIds[j]);
        }
    }

    for (var i2 = 0; i2 < bm25Ids.length && result.length < topK; i2++) {
        if (result.indexOf(bm25Ids[i2]) === -1) result.push(bm25Ids[i2]);
    }

    return result;
}

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

var __fusions_dirname = dirname(fileURLToPath(import.meta.url));
var _fusionsConfig = null;

function loadRerankConfig() {
    if (_fusionsConfig) return _fusionsConfig;
    var cfgPath = join(__fusions_dirname, 'config.json');
    if (existsSync(cfgPath)) {
        try {
            var c = JSON.parse(readFileSync(cfgPath, 'utf-8'));
            _fusionsConfig = { key: c.key };
            return _fusionsConfig;
        } catch (e) { /* ignore */ }
    }
    return null;
}

export async function rerankFuse(bm25Ids, vecIds, queryText, stmById, topK, candidatePool, alpha, rrfK) {
    alpha = alpha != null ? alpha : 0.20;
    rrfK = rrfK != null ? rrfK : 60;
    candidatePool = candidatePool || 60;
    topK = topK || 40;

    var fused;
    if (alpha >= 1.0) {
        fused = bm25Ids.slice();
    } else if (alpha <= 0.0) {
        fused = vecIds.slice();
    } else {
        fused = linearFuse(bm25Ids, vecIds, alpha, Math.max(candidatePool, topK), rrfK);
    }

    var pool = fused.slice(0, Math.min(candidatePool, fused.length));
    var docs = [];
    var docIdMap = [];

    for (var i = 0; i < pool.length; i++) {
        var sid = pool[i];
        var entry = stmById && stmById[sid];
        if (entry && entry.event) {
            docs.push(entry.event);
            docIdMap.push(sid);
        }
    }

    if (docs.length === 0) return fused.slice(0, topK);

    var cfg = loadRerankConfig();
    if (!cfg || !cfg.key) {
        console.log('[Rerank] No API key configured — fallback to Lin fusion');
        return fused.slice(0, topK);
    }

    try {
        var resp = await fetch('https://api.siliconflow.cn/v1/rerank', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + cfg.key
            },
            body: JSON.stringify({
                model: 'BAAI/bge-reranker-v2-m3',
                query: queryText,
                documents: docs,
                top_n: topK
            })
        });

        if (!resp.ok) throw new Error('Rerank API returned ' + resp.status);

        var data = await resp.json();
        var results = data.results;
        if (!results || !Array.isArray(results) || results.length === 0) {
            throw new Error('No results in rerank response');
        }

        var rerankedIds = [];
        for (var j = 0; j < results.length; j++) {
            var idx = results[j].index;
            if (idx >= 0 && idx < docIdMap.length) {
                rerankedIds.push(docIdMap[idx]);
            }
        }

        return rerankedIds.slice(0, topK);
    } catch (e) {
        console.warn('[Rerank] API failed:', e && e.message, '— fallback to Lin fusion');
        return fused.slice(0, topK);
    }
}

export function cascadeVecToBM25(bm25Ids, vecIds, topK) {
    var poolSize = Math.min(topK * 2, vecIds.length);
    var pool = {};
    for (var j = 0; j < poolSize; j++) {
        pool[vecIds[j]] = true;
    }

    var result = [];
    for (var i = 0; i < bm25Ids.length && result.length < topK; i++) {
        if (pool[bm25Ids[i]] && result.indexOf(bm25Ids[i]) === -1) {
            result.push(bm25Ids[i]);
        }
    }

    for (var j2 = 0; j2 < vecIds.length && result.length < topK; j2++) {
        if (result.indexOf(vecIds[j2]) === -1) result.push(vecIds[j2]);
    }

    return result;
}

export function rrfFuse(bm25Ids, vecIds, topK, rrfK) {
    var scores = {};
    var k = rrfK != null ? rrfK : 110;

    for (var i = 0; i < bm25Ids.length; i++) {
        var id = bm25Ids[i];
        scores[id] = (scores[id] || 0) + (1 / (k + i + 1));
    }

    for (var j = 0; j < vecIds.length; j++) {
        var vid = vecIds[j];
        scores[vid] = (scores[vid] || 0) + (1 / (k + j + 1));
    }

    var ids = Object.keys(scores);
    ids.sort(function(a, b) { return (scores[b] || 0) - (scores[a] || 0); });

    return ids.slice(0, Math.min(topK, ids.length));
}

export function complementFuse(bm25Ids, vecIds, topK) {
    var result = [];
    var seen = {};

    var half = Math.ceil(topK / 2);
    for (var i = 0; i < Math.min(half, bm25Ids.length); i++) {
        result.push(bm25Ids[i]);
        seen[bm25Ids[i]] = true;
    }

    var remaining = topK - result.length;
    var addedFromVec = 0;
    for (var j = 0; j < vecIds.length && addedFromVec < remaining; j++) {
        if (!seen[vecIds[j]]) {
            result.push(vecIds[j]);
            seen[vecIds[j]] = true;
            addedFromVec++;
        }
    }

    if (result.length < topK) {
        for (var k = half; k < bm25Ids.length && result.length < topK; k++) {
            if (!seen[bm25Ids[k]]) {
                result.push(bm25Ids[k]);
                seen[bm25Ids[k]] = true;
            }
        }
    }

    return result;
}
