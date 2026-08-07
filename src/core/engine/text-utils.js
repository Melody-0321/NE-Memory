import { countTokens as gptCountTokens } from 'gpt-tokenizer';

export function countTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return gptCountTokens(text);
}

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

export function tokenize(text) {
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
            for (var j = 0; j < cjkText.length; j++) {
                tokens.push(cjkText.charAt(j));
            }
            for (var j = 0; j < cjkText.length - 1; j++) {
                tokens.push('^' + cjkText.substring(j, j + 2));
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

export function vocabularyOverlap(textA, textB) {
    var tokensA = tokenize(textA);
    var tokensB = tokenize(textB);
    // P1-10: 普通对象字面量会命中 Object.prototype（constructor/toString/valueOf），
    // 用无原型对象避免误判 token 相似度虚高。
    var setA = Object.create(null), setB = Object.create(null);
    for (var ti = 0; ti < tokensA.length; ti++) setA[tokensA[ti]] = true;
    for (var ti = 0; ti < tokensB.length; ti++) setB[tokensB[ti]] = true;
    var overlap = 0, total = 0;
    for (var tk in setA) { total++; if (setB[tk]) overlap++; }
    for (var tk in setB) { if (!setA[tk]) total++; }
    return total > 0 ? overlap / total : 1;
}
