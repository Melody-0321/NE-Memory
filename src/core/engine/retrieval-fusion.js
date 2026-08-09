import { computeEmbeddings, normalizeVec } from './embedding.js';
import { buildSearchableText } from './retrieval-text.js';

var _vectorIndexes = {};

export function resetVectorIndex(chatId) {
    if (chatId) {
        delete _vectorIndexes[chatId];
    } else {
        _vectorIndexes = {};
    }
}

function getIndex(chatId) {
    if (!_vectorIndexes[chatId]) {
        _vectorIndexes[chatId] = {
            entries: [],
            vectors: [],
            idToIdx: {},
            _dirty: false
        };
    }
    return _vectorIndexes[chatId];
}

export async function ensureVectorIndex(allSTM, aliasesMap, chatId) {
    var idx = getIndex(chatId);

    var existingIds = {};
    for (var i = 0; i < idx.entries.length; i++) {
        existingIds[idx.entries[i].id] = true;
    }

    var newEntries = [];
    for (var j = 0; j < allSTM.length; j++) {
        var stm = allSTM[j];
        if (!stm || !stm.id) continue;
        if (existingIds[stm.id]) continue;
        var text = buildSearchableText(stm, aliasesMap);
        newEntries.push({ id: stm.id, text: text });
    }

    if (newEntries.length > 0) {
        var texts = newEntries.map(function(e) { return e.text; });
        var embeddings = await computeEmbeddings(texts);
        if (!embeddings) return;

        for (var k = 0; k < newEntries.length; k++) {
            var entry = newEntries[k];
            var vec = embeddings[k];
            if (!vec) continue;
            var pos = idx.entries.length;
            idx.entries.push(entry);
            // R3: 入库归一化——所有向量归一化后，检索侧点积即余弦
            idx.vectors.push(normalizeVec(vec));
            idx.idToIdx[entry.id] = pos;
        }
    }

    var currentStmIds = {};
    for (var m = 0; m < allSTM.length; m++) {
        if (allSTM[m] && allSTM[m].id) currentStmIds[allSTM[m].id] = true;
    }

    var removed = false;
    for (var n = idx.entries.length - 1; n >= 0; n--) {
        if (!currentStmIds[idx.entries[n].id]) {
            idx.entries.splice(n, 1);
            idx.vectors.splice(n, 1);
            removed = true;
        }
    }
    if (removed) {
        idx.idToIdx = {};
        for (var p = 0; p < idx.entries.length; p++) {
            idx.idToIdx[idx.entries[p].id] = p;
        }
    }
}

export function vectorSearch(queryEmbedding, vectorIndex, k) {
    // R3: query 归一化一次（拷贝，避免改调用方数据），索引向量已入库归一化 → 纯点积即余弦
    var q = normalizeVec(new Float32Array(queryEmbedding));
    var results = [];
    for (var i = 0; i < vectorIndex.entries.length; i++) {
        var v = vectorIndex.vectors[i];
        var dot = 0;
        for (var j = 0; j < q.length; j++) dot += q[j] * v[j];
        results.push({ entry: vectorIndex.entries[i], similarity: dot, _idx: i });
    }
    results.sort(function(a, b) { return b.similarity - a.similarity; });
    return results.slice(0, Math.min(k, results.length));
}

export function rrfFuse(bm25Candidates, vectorCandidates, _k, topK) {
    var k = _k || 60;
    var alpha = 0.20;
    var rrfScores = {};
    var entries = {};

    for (var i = 0; i < bm25Candidates.length; i++) {
        var c = bm25Candidates[i];
        var id = c.__id || c.id;
        if (!id) continue;
        rrfScores[id] = (rrfScores[id] || 0) + alpha / (k + i + 1);
        entries[id] = c;
    }

    for (var j = 0; j < vectorCandidates.length; j++) {
        var v = vectorCandidates[j];
        var vid = v.entry.id;
        if (!vid) continue;
        rrfScores[vid] = (rrfScores[vid] || 0) + (1 - alpha) / (k + j + 1);
        if (!entries[vid]) {
            entries[vid] = v.entry;
            entries[vid]._rrf_only = true;
        }
    }

    var fused = Object.keys(rrfScores).map(function(id) {
        var entry = entries[id];
        entry._rrf_score = rrfScores[id];
        return entry;
    });

    fused.sort(function(a, b) { return (b._rrf_score || 0) - (a._rrf_score || 0); });

    return fused.slice(0, Math.min(topK, fused.length));
}

export function getVectorIndex(chatId) {
    return _vectorIndexes[chatId] || null;
}
