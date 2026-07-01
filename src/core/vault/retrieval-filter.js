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

import { isAuto, computeTopK, computeMinResults, computeLtmDirCount } from '../params.js';
import { tokenize } from '../engine/text-utils.js';
import { isVectorSearchEnabled, computeEmbedding, loadEmbeddingApiConfig } from '../engine/embedding.js';
import { ensureVectorIndex, vectorSearch, rrfFuse, getVectorIndex } from '../engine/retrieval-fusion.js';

import { buildSearchableText } from '../engine/retrieval-text.js';
export { buildSearchableText };

/**
 * @param {string[]} queryTokens
 * @param {string[]} docTokens
 * @param {number} avgDocLen
 * @param {number} totalDocs
 * @param {Object<string, number>} docFreq
 * @returns {number}
 */
export function bm25Score(queryTokens, docTokens, avgDocLen, totalDocs, docFreq) {
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

// ─── Time constraint parsing ───

/**
 * @param {string} query
 * @returns {Object|null}
 */
export function parseTimeConstraint(query) {
    if (!query || typeof query !== 'string') return null;

    var q = query.trim();

    // 1. Day X-Y range (narrative time)
    var dayRange = q.match(/Day\s*(\d+)\s*(?:[-–—]|to)\s*Day?\s*(\d+)/i);
    if (dayRange) {
        return { type: 'narrative_range', from: 'Day ' + dayRange[1], to: 'Day ' + dayRange[2], period: 'Day ' + dayRange[1] + '-' + dayRange[2] };
    }

    // 2. Day X (narrative time)
    var daySingle = q.match(/Day\s*(\d+)/i);
    if (daySingle) {
        return { type: 'narrative', period: 'Day ' + daySingle[1] };
    }

    // 3. Month YYYY (English month names)
    var months = ['january','february','march','april','may','june','july','august','september','october','november','december',
                  'jan','feb','mar','apr','jun','jul','aug','sep','oct','nov','dec'];
    for (var mi = 0; mi < months.length; mi++) {
        var month = months[mi];
        var re = new RegExp('\\b' + month + '\\b', 'i');
        if (re.test(q)) {
            var yearMatch = q.match(/\b(20\d{2})\b/);
            var period = month.charAt(0).toUpperCase() + month.slice(1);
            if (yearMatch) period += ' ' + yearMatch[1];
            var monthNum = (mi % 12) + 1;
            return { type: 'absolute', period: period, month: monthNum, year: yearMatch ? parseInt(yearMatch[1]) : null };
        }
    }

    // 4. ISO date YYYY-MM
    var isoMatch = q.match(/\b(20\d{2})-(\d{2})\b/);
    if (isoMatch) {
        return { type: 'absolute', period: isoMatch[1] + '-' + isoMatch[2], month: parseInt(isoMatch[2]), year: parseInt(isoMatch[1]) };
    }

    // 5. Relative time
    if (/\byesterday\b/i.test(q)) return { type: 'relative', period: 'yesterday' };
    if (/\blast\s+week\b/i.test(q)) return { type: 'relative', period: 'last week' };

    return null;
}

/**
 * @param {Array<Object>} entries
 * @param {Object} constraint
 * @returns {Array<Object>}
 */
export function applyTimeFilter(entries, constraint) {
    if (!constraint) return entries.slice();

    entries = entries || [];

    return entries.filter(function(e) {
        var entryTime = e.period || e.time_range || '';
        if (!entryTime) return false;

        var entryLower = entryTime.toLowerCase();

        if (constraint.type === 'narrative' || constraint.type === 'narrative_range') {
            if (constraint.type === 'narrative') {
                var targetDay = constraint.period.toLowerCase();
                return entryLower.indexOf(targetDay) === 0;
            } else {
                var dayMatch = entryLower.match(/day\s*(\d+)/);
                if (!dayMatch) return false;
                var dayNum = parseInt(dayMatch[1]);
                var fromDay = parseInt(constraint.from.toLowerCase().replace('day ', ''));
                var toDay = parseInt(constraint.to.toLowerCase().replace('day ', ''));
                return dayNum >= fromDay && dayNum <= toDay;
            }
        }

        if (constraint.type === 'absolute') {
            return entryLower.indexOf(constraint.period.toLowerCase()) !== -1;
        }

        if (constraint.type === 'relative') {
            return entryLower.indexOf(constraint.period.toLowerCase()) !== -1;
        }

        return true;
    });
}

// ─── TimeOnly auto-detection ───

var TIME_WORDS = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    'day', 'week', 'month', 'year', 'hour', 'minute',
    'morning', 'afternoon', 'evening', 'night', 'dawn', 'dusk', 'midnight',
    'yesterday', 'today', 'tomorrow', 'tonight',
    // Chinese
    '昨天', '今天', '明天', '上午', '下午', '晚上', '早晨', '凌晨',
    '周一', '周二', '周三', '周四', '周五', '周六', '周日',
    '一月', '二月', '三月', '四月', '五月', '六月',
    '七月', '八月', '九月', '十月', '十一月', '十二月',
    '天', '周', '月', '年', '小时', '分钟',
    '星期', '礼拜'
];

function isTimeWord(word) {
    if (!word || word.length < 2) return false;
    var lower = word.toLowerCase();
    for (var i = 0; i < TIME_WORDS.length; i++) {
        if (lower === TIME_WORDS[i] || lower.indexOf(TIME_WORDS[i]) !== -1) return true;
    }
    return false;
}

/**
 * @param {string} query
 * @param {Object|null} timeConstraint
 * @returns {boolean}
 */
export function isTimeOnlyQuery(query, timeConstraint) {
    if (!timeConstraint || !query) return false;

    var lower = query.toLowerCase().trim();
    if (/^(summarize|总结|概括|列出|list|show.+everything|what happened)/i.test(lower)) return true;

    var words = query.split(/[\s,，。！？!?\n]+/).filter(Boolean);
    var nonTimeWords = words.filter(function(w) { return !isTimeWord(w); });
    return nonTimeWords.length <= 2;
}

// ─── Noise filtering ───

function denoiseResults(results, minResults) {
    if (results.length <= minResults) return results;

    // Rule: push transition-only events (single entity, no narrative content) to tail
    var heavy = [];
    var light = [];
    for (var i = 0; i < results.length; i++) {
        var e = results[i];
        var entities = e.entities || [];
        var isTransition = entities.length <= 1;
        if (e.event) {
            var ev = e.event;
            if (isTransition && ev.length <= 20) {
                light.push(e);
                continue;
            }
        }
        heavy.push(e);
    }
    while (heavy.length < minResults && light.length > 0) {
        heavy.push(light.shift());
    }
    var merged = heavy.concat(light);

    return merged.slice(0, 40);
}

/**
 * @param {string} query
 * @param {Array<import('../../types.js').STMEvent>} allSTM
 * @param {Array<import('../../types.js').LTMEntry>} allLTM
 * @param {number} topK
 * @param {number} minResults
 * @param {Object} aliasesMap
 * @param {string} chatId
 * @returns {Promise<Array<Object>>}
 */
export async function filterCandidates(query, allSTM, allLTM, topK, minResults, aliasesMap, chatId) {
    var totalSTM = (allSTM || []).length;
    var totalLTM = (allLTM || []).length;
    topK = isAuto('topK') ? computeTopK(totalSTM) : (topK || 40);
    minResults = isAuto('minResults') ? computeMinResults(totalSTM) : (minResults || 3);
    allSTM = allSTM || [];
    allLTM = allLTM || [];

    var entries = [];

    for (var i = 0; i < allSTM.length; i++) {
        var stm = allSTM[i];
        if (!stm || !stm.id) continue;
        var text = buildSearchableText(stm, aliasesMap);
        entries.push({
            _tokens: tokenize(text),
            _entry: stm,
            _type: 'stm',
            _id: stm.id
        });
    }

    var totalDocs = entries.length;

    if (totalDocs === 0 && allLTM.length === 0) return [];

    // 池太小：BM25 无法产生有意义的过滤，直接返回全量 + LTM 目录
    if (totalDocs > 0 && totalDocs <= minResults) {
        var allResults = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var r = e._entry;
            if (r == null) r = { id: e._id || 'unknown', event: '(data missing)' };
            else if (typeof r !== 'object') r = { id: e._id || 'unknown', event: String(r) };
            r.__type = e._type;
            r.__id = e._id;
            allResults.push(r);
        }
        // LTM directory append
        if (allLTM.length > 0) {
            var ltmSorted = allLTM.slice().sort(function(a, b) {
                return (b.timestamp || '').localeCompare(a.timestamp || '');
            });
            var ltmDirCount = Math.min(ltmSorted.length, 20);
            for (var i = 0; i < ltmDirCount; i++) {
                var ltm = ltmSorted[i];
                ltm.__type = 'ltm';
                ltm.__id = ltm.id;
                allResults.push(ltm);
            }
        }
        return allResults;
    }

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

    // ── 分数断崖检测：找到自然截断点 ──
    var CUTOFF_RATIO = 5.0;
    var CUTOFF_FLOOR = 0.25;

    var resultCount = Math.min(topK, entries.length);
    if (resultCount >= minResults && entries.length > minResults && entries[0]._score > 0) {
        for (var idx = 0; idx < resultCount - 1; idx++) {
            var curScore = entries[idx]._score;
            var nextScore = Math.max(entries[idx + 1]._score, 1e-8);
            var ratio = curScore / nextScore;
            var pctOfTop = nextScore / Math.max(entries[0]._score, 1e-8);
            if (ratio > CUTOFF_RATIO && pctOfTop < CUTOFF_FLOOR && (idx + 1) >= minResults) {
                resultCount = idx + 1;
                break;
            }
        }
    }

    var results = [];
    for (var i = 0; i < resultCount; i++) {
        var e = entries[i];
        if (e._score <= 0) {
            if (results.length >= minResults) break;
        }
        var result;
        if (e._entry != null) {
            try { result = JSON.parse(JSON.stringify(e._entry)); } catch (_) { result = e._entry; }
        } else {
            result = { id: e._id || 'unknown', event: '(data missing)' };
        }
        result.__type = e._type;
        result.__id = e._id;
        results.push(result);
    }

    // ── Noise filtering ──
    results = denoiseResults(results, minResults);

    // ── Vector search + RRF fusion (optional) ──
    var _vectorUsed = false;
    if (isVectorSearchEnabled()) {
        var embConfig = loadEmbeddingApiConfig();
        if (embConfig && embConfig.url) {
            try {
                var chatIdResolved = chatId || 'default';
                var queryEmb = await computeEmbedding(query);
                if (queryEmb) {
                    await ensureVectorIndex(allSTM, aliasesMap, chatIdResolved);
                    var vecIdx = getVectorIndex(chatIdResolved);
                    if (vecIdx && vecIdx.vectors.length > 0) {
                        var vecResults = vectorSearch(queryEmb, vecIdx, topK);
                        if (vecResults.length > 0) {
                            var bm25ResultsSnapshot = results.slice();
                            var _rrfK = 60;
                            if (typeof process !== 'undefined' && process.env && process.env.NE_BENCHMARK_RRF_K) {
                                _rrfK = parseInt(process.env.NE_BENCHMARK_RRF_K, 10) || 110;
                            }
                            var fused = rrfFuse(results, vecResults, _rrfK, topK);
                            fused.forEach(function(f) {
                                f.__score = f._rrf_score != null ? f._rrf_score : (f.__score || 0);
                            });
                            results = fused.map(function(f) {
                                if (f.__type) return f;
                                if (f.id) {
                                    var stmEntry = allSTM.find(function(s) { return s.id === f.id; });
                                    if (stmEntry) {
                                        var c = JSON.parse(JSON.stringify(stmEntry));
                                        c.__type = 'stm';
                                        c.__id = stmEntry.id;
                                        c.__score = f.__score;
                                        return c;
                                    }
                                }
                                return f;
                            });
                            _vectorUsed = true;
                            globalThis.__ne_debug_vector_used = true;
                            globalThis.__ne_debug_vector_candidate_count = vecResults.length;
                            globalThis.__ne_debug_bm25_candidate_count = results.length;
                            if (typeof globalThis !== 'undefined') {
                                var rankMap = {};
                                for (var bi = 0; bi < bm25ResultsSnapshot.length; bi++) {
                                    var bid = bm25ResultsSnapshot[bi].__id || bm25ResultsSnapshot[bi].id;
                                    if (bid) rankMap[bid] = { bm25Rank: bi + 1 };
                                }
                                for (var fi = 0; fi < results.length; fi++) {
                                    var fid = results[fi].__id || results[fi].id;
                                    if (fid && rankMap[fid]) {
                                        rankMap[fid].fusedRank = fi + 1;
                                    } else if (fid) {
                                        rankMap[fid] = { bm25Rank: null, fusedRank: fi + 1, vectorOnly: true };
                                    }
                                }
                                globalThis.__ne_debug_rank_map = rankMap;
                            }
                            console.log('[NE] Vector search fused: BM25=' + bm25ResultsSnapshot.length + ' vec=' + vecResults.length + ' fused=' + fused.length + ' vectorUsed=' + _vectorUsed);
                        }
                    }
                }
            } catch (e) {
                console.warn('[NE] Vector search fallback to BM25 only:', e && e.message);
            }
        }
    }
    globalThis.__ne_debug_vector_used = _vectorUsed;
    results._vectorUsed = _vectorUsed;

    // ── LTM directory: append recent LTM entries as view-only catalog (not BM25 scored) ──
    if (allLTM.length > 0) {
        var ltmSorted = allLTM.slice().sort(function(a, b) {
            return (b.timestamp || '').localeCompare(a.timestamp || '');
        });
        var ltmDirCount = isAuto('ltmDirCount')
            ? computeLtmDirCount(totalLTM)
            : Math.min(ltmSorted.length, 20);
        for (var i = 0; i < ltmDirCount; i++) {
            var ltm = JSON.parse(JSON.stringify(ltmSorted[i]));
            ltm.__type = 'ltm';
            ltm.__id = ltm.id;
            ltm.__isDirectory = true;
            // Deduplicate: skip if same id already in results
            var alreadyInResults = false;
            for (var r = 0; r < results.length; r++) {
                if (results[r].__id === ltm.__id) { alreadyInResults = true; break; }
            }
            if (!alreadyInResults) results.push(ltm);
        }
    }

    if (!_vectorUsed && typeof globalThis !== 'undefined') {
        var rankMap = {};
        for (var ri = 0; ri < results.length; ri++) {
            if (results[ri].__isDirectory) continue;
            var rid = results[ri].__id || results[ri].id;
            if (rid) rankMap[rid] = { bm25Rank: ri + 1, fusedRank: null };
        }
        globalThis.__ne_debug_rank_map = rankMap;
    }

    return results;
}
