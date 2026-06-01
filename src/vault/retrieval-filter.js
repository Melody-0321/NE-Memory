// vault/retrieval-filter.js — BM25 text retrieval for NE Memory Engine
//
// Pure BM25 scoring with Chinese 2-gram tokenizer.
// No external dependencies, runs fully in the browser.
//
// Parameters: k1=1.5, b=0.75 (standard Okapi BM25)
//
// Usage:
//   import { filterCandidates } from './vault/retrieval-filter.js';
//   var results = filterCandidates('query text', allSTM, allLTM, 40);

function isCJK(ch) {
    var code = ch.charCodeAt(0);
    return (code >= 0x4E00 && code <= 0x9FFF)
        || (code >= 0x3400 && code <= 0x4DBF)
        || (code >= 0xF900 && code <= 0xFAFF);
}

function isAlpha(ch) {
    var code = ch.charCodeAt(0);
    return (code >= 0x41 && code <= 0x5A)
        || (code >= 0x61 && code <= 0x7A)
        || (code >= 0x30 && code <= 0x39);
}

function tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    var tokens = [];
    var i = 0;
    var len = text.length;
    while (i < len) {
        var ch = text.charAt(i);
        if (isCJK(ch)) {
            var cjkStart = i;
            while (i < len && isCJK(text.charAt(i))) i++;
            var cjkText = text.substring(cjkStart, i);
            if (cjkText.length === 1) {
                tokens.push(cjkText);
            } else {
                for (var j = 0; j < cjkText.length - 1; j++) {
                    tokens.push(cjkText.substring(j, j + 2));
                }
            }
        } else if (isAlpha(ch)) {
            var wordStart = i;
            while (i < len && isAlpha(text.charAt(i))) i++;
            tokens.push(text.substring(wordStart, i).toLowerCase());
        } else {
            i++;
        }
    }
    return tokens;
}

function buildSearchableText(entry) {
    var parts = [];
    if (entry.period) parts.push(entry.period);
    if (entry.time_range) parts.push(entry.time_range);
    if (entry.time_label) parts.push(entry.time_label);
    if (entry.scene) parts.push(entry.scene);
    if (entry.event) parts.push(entry.event);
    return parts.join(' ');
}

function bm25Score(queryTokens, docTokens, avgDocLen, totalDocs, docFreq) {
    var k1 = 1.5;
    var b = 0.75;
    var docLen = docTokens.length;
    var score = 0;

    var tfMap = {};
    for (var i = 0; i < docTokens.length; i++) {
        var t = docTokens[i];
        tfMap[t] = (tfMap[t] || 0) + 1;
    }

    var normFactor = 1 - b + b * (docLen / Math.max(avgDocLen, 1));
    var seenQuery = {};

    for (var i = 0; i < queryTokens.length; i++) {
        var term = queryTokens[i];
        if (seenQuery[term]) continue;
        seenQuery[term] = true;

        var tf = tfMap[term] || 0;
        if (tf === 0) continue;

        var df = docFreq[term] || 0;
        var idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1.0);
        var numerator = tf * (k1 + 1);
        var denominator = tf + k1 * normFactor;
        score += idf * (numerator / denominator);
    }

    return score;
}

export function filterCandidates(query, allSTM, allLTM, topK) {
    topK = topK || 40;
    allSTM = allSTM || [];
    allLTM = allLTM || [];

    var entries = [];

    for (var i = 0; i < allSTM.length; i++) {
        var stm = allSTM[i];
        var text = buildSearchableText(stm);
        entries.push({
            _tokens: tokenize(text),
            _entry: stm,
            _type: 'stm',
            _id: stm.id
        });
    }

    var STM_COUNT_FOR_LTM = 500;
    if (allSTM.length >= STM_COUNT_FOR_LTM) {
        for (var i = 0; i < allLTM.length; i++) {
            var ltm = allLTM[i];
            var text = buildSearchableText(ltm);
            entries.push({
                _tokens: tokenize(text),
                _entry: ltm,
                _type: 'ltm',
                _id: ltm.id
            });
        }
    }

    var totalDocs = entries.length;
    if (totalDocs === 0) return [];

    var docFreq = {};
    var totalTokens = 0;

    for (var i = 0; i < entries.length; i++) {
        var tokens = entries[i]._tokens;
        totalTokens += tokens.length;
        var seen = {};
        for (var j = 0; j < tokens.length; j++) {
            var term = tokens[j];
            if (!seen[term]) {
                seen[term] = true;
                docFreq[term] = (docFreq[term] || 0) + 1;
            }
        }
    }

    var avgDocLen = totalDocs > 0 ? totalTokens / totalDocs : 1;
    var queryTokens = tokenize(query);

    for (var i = 0; i < entries.length; i++) {
        entries[i]._score = bm25Score(queryTokens, entries[i]._tokens, avgDocLen, totalDocs, docFreq);
    }

    entries.sort(function (a, b) { return b._score - a._score; });

    var resultCount = Math.min(topK, entries.length);
    var results = [];
    for (var i = 0; i < resultCount; i++) {
        var e = entries[i];
        var result = JSON.parse(JSON.stringify(e._entry));
        result.__type = e._type;
        result.__id = e._id;
        results.push(result);
    }

    return results;
}
