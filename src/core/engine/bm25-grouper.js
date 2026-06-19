// engine/bm25-grouper.js — BM25 预分组器 (ported from ne-memory-core)
//
// 对输入计算相邻相似度矩阵，生成预分组提示。
// 内联分词器，不依赖外部模块。
//
// 算法：
//   1. 对每对相邻 item 计算 BM25 相似度（一作 query，另一作 doc）
//   2. 相似度 > threshold → 同组
//   3. 相似度 < threshold → 新组边界
//   4. 返回分组结构 [{startIdx, endIdx, items, avgSimilarity}]

// ─── 内联分词器 ───

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

var _defaultTokenizer = function(text) {
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
};

// ─── 相邻 BM25 相似度计算 ───

function pairSimilarity(tokensA, tokensB, avgDocLen, totalDocs, docFreq) {
    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    var k1 = 1.5;
    var b = 0.75;
    var docLen = tokensB.length;
    var normFactor = 1 - b + b * (docLen / Math.max(avgDocLen, 1));

    var tfB = {};
    for (var i = 0; i < tokensB.length; i++) {
        var t = tokensB[i];
        tfB[t] = (tfB[t] || 0) + 1;
    }

    var score = 0;
    var maxPossible = 0;
    var seen = {};

    for (var i = 0; i < tokensA.length; i++) {
        var term = tokensA[i];
        if (seen[term]) continue;
        seen[term] = true;

        var tf = tfB[term] || 0;
        var df = docFreq[term] || 0;
        var idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1.0);
        var numerator = tf * (k1 + 1);
        var denominator = tf + k1 * normFactor;
        score += idf * (numerator / denominator);

        maxPossible += idf * ((tfB[term] || 1) * (k1 + 1)) / ((tfB[term] || 1) + k1 * normFactor);
    }

    return maxPossible > 0 ? Math.min(1, score / maxPossible) : 0;
}

// ─── 全局 IDF 构建 ───

function buildGlobalDocFreq(allTokens) {
    var df = {};
    for (var i = 0; i < allTokens.length; i++) {
        var tokens = allTokens[i];
        var seen = {};
        for (var j = 0; j < tokens.length; j++) {
            var term = tokens[j];
            if (!seen[term]) {
                seen[term] = true;
                df[term] = (df[term] || 0) + 1;
            }
        }
    }
    return df;
}

// ─── 主分组函数 ───

export function preGroupItems(items, options) {
    options = options || {};
    var tokenizer = options.tokenizer || _defaultTokenizer;
    var threshold = options.similarityThreshold || 0.3;
    var getText = options.getText || function(item) {
        return item.content || item.event || item.summary || '';
    };
    var minGroupSize = options.minGroupSize || 1;

    if (!items || items.length === 0) return [];
    if (items.length === 1) {
        return [{
            startIdx: 0,
            endIdx: 0,
            items: [items[0]],
            avgSimilarity: 1.0
        }];
    }

    var allTokens = [];
    var texts = [];
    for (var i = 0; i < items.length; i++) {
        var text = String(getText(items[i]) || '').trim();
        texts.push(text);
        allTokens.push(tokenizer(text));
    }

    var totalDocs = items.length;
    var totalTokens = 0;
    for (var i = 0; i < allTokens.length; i++) {
        totalTokens += allTokens[i].length;
    }
    var avgDocLen = totalDocs > 0 ? totalTokens / totalDocs : 1;
    var docFreq = buildGlobalDocFreq(allTokens);

    var adjSimilarities = [];
    for (var i = 0; i < items.length - 1; i++) {
        var sim = pairSimilarity(allTokens[i], allTokens[i + 1], avgDocLen, totalDocs, docFreq);
        adjSimilarities.push(sim);
    }

    var groups = [];
    var groupStart = 0;

    for (var i = 0; i < items.length - 1; i++) {
        if (adjSimilarities[i] < threshold) {
            var groupItems = items.slice(groupStart, i + 1);
            if (groupItems.length >= minGroupSize) {
                groups.push({
                    startIdx: groupStart,
                    endIdx: i,
                    items: groupItems,
                    avgSimilarity: computeAvgSim(groupStart, i, adjSimilarities)
                });
            }
            groupStart = i + 1;
        }
    }

    var lastItems = items.slice(groupStart);
    if (lastItems.length >= minGroupSize) {
        groups.push({
            startIdx: groupStart,
            endIdx: items.length - 1,
            items: lastItems,
            avgSimilarity: computeAvgSim(groupStart, items.length - 2, adjSimilarities)
        });
    }

    return groups;
}

function computeAvgSim(start, end, adjSims) {
    if (start >= end) return 1.0;
    var sum = 0;
    var count = 0;
    for (var i = start; i <= end && i < adjSims.length; i++) {
        sum += adjSims[i];
        count++;
    }
    return count > 0 ? sum / count : 0;
}

// ─── 格式化预分组提示 ───

export function formatPreGroupHint(groups) {
    if (!groups || groups.length <= 1) return '';

    var lines = ['以下 ' + groups.reduce(function(s, g) { return s + (g.endIdx - g.startIdx + 1); }, 0) + ' 条输入，根据内容相似度预分成了 ' + groups.length + ' 组：'];
    var labels = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    for (var i = 0; i < groups.length && i < labels.length; i++) {
        var g = groups[i];
        var label = labels.charAt(i);
        var rangeStr = g.startIdx === g.endIdx
            ? '[' + g.startIdx + ']'
            : '[' + g.startIdx + '-' + g.endIdx + ']';
        var desc = g.startIdx === g.endIdx ? '（独立输入）' : '（内部相似度 ' + g.avgSimilarity.toFixed(2) + '）';
        lines.push('  组' + label + ' ' + rangeStr + ': ' + desc);
    }

    lines.push('  请按上述分组提取事件。注意：预分组仅供参考，以实际内容为准。');
    return lines.join('\n');
}
