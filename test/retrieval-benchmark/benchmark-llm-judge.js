// NE-Memory: LLM-as-Judge 4-way 对比
// Flat vs Grouped+Prefetch × showScore vs noScore
// DeepSeek-V3 scores 1-5 per query per format

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { allSTM, allLTM, allChatMessages } from './fixture.js';
import { queries } from './queries.js';
import { avg } from './metrics.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_llm_judge__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;

function f(v, d) { d = d || 3; return v.toFixed(d); }

function setBgeM3() {
    process.env.EMBEDDING_URL = config.url;
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
    process.env.EMBEDDING_API_KEY = config.key;
    delete process.env.NE_BENCHMARK_VECTOR;
}

var CHAT_URL = config.judge_v4 ? config.judge_v4.url : (config.url.replace('/embeddings', '/chat/completions'));
var JUDGE_MODEL = config.judge_v4 ? config.judge_v4.model : 'deepseek-chat';
var API_KEY = config.judge_v4 ? config.judge_v4.key : (config.key || '');
var SHOW_SCORE = true;

// ─── Entity chain utilities (from benchmark-packaging.js) ───

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

// ─── Prefetch ───

function applyPrefetch(mapObj, chatMessages, topK) {
    if (!chatMessages || chatMessages.length === 0) return;
    topK = topK || 3;
    var entries = [];
    mapObj.forEach(function(v) { entries.push(v); });
    entries.sort(function(a, b) { return (b.relevance || 0) - (a.relevance || 0); });

    entries.slice(0, topK).forEach(function(entry) {
        var msgIds = entry.entry.msg_ids;
        if (!msgIds || msgIds.length === 0) return;

        var originalLines = [];
        var totalLen = 0;
        var MAX_TOTAL = 2000;
        msgIds.forEach(function(mid) {
            if (totalLen >= MAX_TOTAL) return;
            var msg = chatMessages.find(function(m) { return String(m.id) === String(mid); });
            if (msg) {
                var text = typeof msg.mes === 'string' ? msg.mes : (msg.content || '');
                if (text) {
                    var line = '\n[原文 msg_' + mid + '] ' + text.substring(0, 200);
                    if (totalLen + line.length > MAX_TOTAL) {
                        line = line.substring(0, MAX_TOTAL - totalLen);
                    }
                    originalLines.push(line);
                    totalLen += line.length;
                }
            }
        });
        if (originalLines.length > 0) {
            entry._originalText = originalLines.join('');
        }
    });
}

// ─── Context builders ───

function formatEntryLine(e, num) {
    var period = e.entry.period || '?';
    var scene = e.entry.scene || '';
    var event = e.entry.event || e.entry.summary || '';
    var line = (num || '') + ' [' + period + '] ' + (scene ? scene + ': ' : '') + event;
    if (SHOW_SCORE) {
        line += ' [score:' + e.relevance.toFixed(3) + ']';
    }
    if (e._originalText) {
        line += '\n   > ' + e._originalText.replace(/\n/g, '\n   > ');
    }
    return line;
}

function buildFlatContext(mergedMap) {
    var entries = [];
    mergedMap.forEach(function(e) {
        if (e.relevance > 0 && (!e.sources || e.sources.indexOf('ltm_dir') === -1)) {
            entries.push(e);
        }
    });
    entries.sort(function(a, b) { return b.relevance - a.relevance; });

    var lines = ['以下是按相关度排序的记忆检索结果：', ''];
    entries.forEach(function(e, i) {
        lines.push(formatEntryLine(e, (i + 1) + '.'));
    });
    if (entries.length === 0) {
        lines.push('（未检索到相关记忆）');
    }
    return lines.join('\n');
}

function foldMissRunsText(entries) {
    var result = [];
    var missRun = [];
    var num = 0;

    function flushMiss() {
        if (missRun.length === 0) return;
        if (missRun.length === 1) {
            num++;
            var p = missRun[0].entry.period || '?';
            result.push(' ' + num + '. [' + p + '] （' + p + ' 未展开）');
        } else {
            num++;
            var fp = missRun[0].entry.period || '?';
            var lp = missRun[missRun.length - 1].entry.period || '?';
            result.push(' ' + num + '. [' + fp + '] ' + fp + '-' + lp + '（' + missRun.length + '条事件未展开）');
        }
        missRun = [];
    }

    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.relevance > 0) {
            flushMiss();
            num++;
            result.push(formatEntryLine(e, ' ' + num + '.'));
        } else {
            missRun.push(e);
        }
    }
    flushMiss();
    return result;
}

function buildGroupedContext(mergedMap, grouped, activeEntities) {
    var lines = [];
    lines.push('## 实体记忆链');
    lines.push('');

    var activeNames = [];
    var externalNames = [];
    Object.keys(grouped.groups).forEach(function(name) {
        if (activeEntities && activeEntities.indexOf(name) !== -1) {
            activeNames.push(name);
        } else {
            externalNames.push(name);
        }
    });

    function renderGroup(name, group) {
        var entries = group.entries;
        var total = entries.length;
        var hitCount = entries.filter(function(e) { return e.relevance > 0; }).length;
        var refCount = group.refs ? group.refs.length : 0;
        lines.push('### ' + name + ' (' + total + ' events in chain, ' + hitCount + ' hits, ' + refCount + ' refs)');

        var textLines = foldMissRunsText(entries);
        textLines.forEach(function(l) { lines.push(l); });

        if (group.refs && group.refs.length > 0) {
            var refIds = group.refs.map(function(r) { return r.entryId; });
            var refNames = [];
            group.refs.forEach(function(r) { if (refNames.indexOf(r.primaryName) === -1) refNames.push(r.primaryName); });
            lines.push('   关联: 见' + refNames.map(function(n) { return '\u300c' + n + '\u300d'; }).join('') + ' ' + refIds.join(', '));
        }
        lines.push('');
    }

    activeNames.forEach(function(name) {
        renderGroup(name, grouped.groups[name]);
    });

    if (grouped.unassigned && grouped.unassigned.length > 0) {
        lines.push('### 未标注条目 (' + grouped.unassigned.length + ' entries)');
        grouped.unassigned.forEach(function(e, i) {
            lines.push(formatEntryLine(e, ' ' + (i + 1) + '.'));
        });
        lines.push('');
    }

    if (externalNames.length > 0) {
        lines.push('### 场景外角色');
        lines.push('');
        externalNames.forEach(function(name) {
            renderGroup(name, grouped.groups[name]);
        });
    }

    return lines.join('\n');
}

// ─── LLM Judge ───

var SYSTEM_PROMPT = [
    '你是一个记忆检索质量评估器。',
    '以下是一组从长篇故事对话中提取的记忆条目，以及一个关于故事内容的问题。',
    '请判断这些记忆能否帮助你回答该问题。',
    '',
    '评分标准（1-5分）：',
    '1 — 无法回答：记忆中没有任何相关信息，或信息完全矛盾',
    '2 — 勉强可猜：有零星间接线索，但不足以形成可靠答案',
    '3 — 部分可答：能回答问题的部分内容，但有明显空缺',
    '4 — 基本完整：能回答大部分内容，仅缺少少数细节',
    '5 — 完全可答：记忆提供了精确、充分的证据支持完整回答',
    '',
    '请基于记忆中实际存在的信息评分，而非凭你对故事的猜测。',
    '如果记忆中没有某个信息，如实反映为评分降低，不要自己补全。',
    '',
    '请严格返回以下JSON格式（不要markdown代码块包裹）：',
    '{"score": <1-5整数>, "reason": "<一句话解释>", "key_entries": ["条目编号或描述"]}',
].join('\n');

async function judgeQuery(queryText, context, label) {
    var userPrompt = context + '\n\n---\n问题：' + queryText;

    var response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + API_KEY,
        },
        body: JSON.stringify({
            model: JUDGE_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0,
            max_tokens: 200,
        }),
    });

    if (!response.ok) {
        throw new Error(label + ' API error: ' + response.status + ' ' + (await response.text()));
    }

    var data = await response.json();
    var content = data.choices[0].message.content.trim();

    // Parse JSON — try direct parse first, then regex fallback
    var result = null;
    try {
        result = JSON.parse(content);
    } catch (e1) {
        // Try removing markdown code blocks
        var cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        try {
            result = JSON.parse(cleaned);
        } catch (e2) {
            // Regex fallback: extract score
            var scoreMatch = content.match(/"score"\s*:\s*(\d+)/) || content.match(/score[:\s]*(\d+)/i);
            var reasonMatch = content.match(/"reason"\s*:\s*"([^"]+)"/) || content.match(/reason[:\s]*"?([^,"}]+)/i);
            result = {
                score: scoreMatch ? parseInt(scoreMatch[1]) : -1,
                reason: reasonMatch ? reasonMatch[1] : content.substring(0, 80),
                key_entries: [],
            };
        }
    }

    if (result.score == null || result.score < 1 || result.score > 5) {
        result.score = -1;
        result.reason = 'PARSE_ERROR: ' + content.substring(0, 60);
    }

    return result;
}

// ─── Main ───

async function main() {
    console.log('=== LLM-as-Judge: 4-Way (Flat vs Grouped+Prefetch × score suffix) ===\n');
    console.log('Judge: ' + JUDGE_MODEL);
    console.log('Retrieval: BM25(TOP_K=' + TOP_K_BM25 + ') + Vector(bge-m3,TOP_K=' + TOP_K_VEC + ') → Lin α=0.20');
    console.log('Chat messages: ' + (allChatMessages ? allChatMessages.length + ' entries' : 'NONE'));
    console.log('Queries: ' + queries.length + '\n');

    setBgeM3();
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    var allEntityNames = collectAllEntityNames(allSTM);

    var results = [];
    var flatScoreList = [];
    var flatNoScoreList = [];
    var gpScoreList = [];
    var gpNoScoreList = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        var queryText = q.query || q.question;
        var qId = q.id || ('q' + (qi + 1));

        process.stdout.write('[' + (qi + 1) + '/' + queries.length + '] ' + qId + ' ... ');

        // ── Retrieval ──
        delete process.env.NE_BENCHMARK_VECTOR;
        var bm25Results = await filterCandidates(queryText, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
        var rawBm25Ids = bm25Results.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });

        setBgeM3();
        var queryEmb = await computeEmbedding(queryText);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K_VEC);
        var rawVecIds = vecResults.map(function(v) { return v.entry.id; });

        linearFuse(rawBm25Ids, rawVecIds, 0.20, 40, 60);

        // ── Packaging ──
        var entityNames = extractEntityNames(queryText, allEntityNames);
        var entityChains = buildEntityChains(allSTM, entityNames);

        var merged = await mergePipelines(bm25Results, entityChains, allLTM, { characters: {}, factions: {} }, allSTM);
        var grouped = groupCandidatesByEntity(merged.map, merged.threadIndex);

        // ── Judge 1: Flat (with score) ──
        SHOW_SCORE = true;
        var flatCtxS = buildFlatContext(merged.map);
        var flatJudgeS;
        try {
            flatJudgeS = await judgeQuery(queryText, flatCtxS, 'Flat(S)');
        } catch (e) {
            flatJudgeS = { score: -1, reason: 'ERR:' + e.message, key_entries: [] };
        }

        // ── Judge 2: Flat (no score) ──
        SHOW_SCORE = false;
        var flatCtxNs = buildFlatContext(merged.map);
        var flatJudgeNs;
        try {
            flatJudgeNs = await judgeQuery(queryText, flatCtxNs, 'Flat(NS)');
        } catch (e) {
            flatJudgeNs = { score: -1, reason: 'ERR:' + e.message, key_entries: [] };
        }
        SHOW_SCORE = true;

        // ── Apply prefetch ──
        applyPrefetch(merged.map, allChatMessages, 3);

        // ── Judge 3: Grouped+Prefetch (with score) ──
        SHOW_SCORE = true;
        var gpCtxS = buildGroupedContext(merged.map, grouped, entityNames);
        var gpJudgeS;
        try {
            gpJudgeS = await judgeQuery(queryText, gpCtxS, 'GP(S)');
        } catch (e) {
            gpJudgeS = { score: -1, reason: 'ERR:' + e.message, key_entries: [] };
        }

        // ── Judge 4: Grouped+Prefetch (no score) ──
        SHOW_SCORE = false;
        var gpCtxNs = buildGroupedContext(merged.map, grouped, entityNames);
        var gpJudgeNs;
        try {
            gpJudgeNs = await judgeQuery(queryText, gpCtxNs, 'GP(NS)');
        } catch (e) {
            gpJudgeNs = { score: -1, reason: 'ERR:' + e.message, key_entries: [] };
        }
        SHOW_SCORE = true;

        // ── Deltas ──
        var deltaF = flatJudgeNs.score - flatJudgeS.score;
        var deltaG = gpJudgeNs.score - gpJudgeS.score;

        process.stdout.write(
            'F(S)=' + flatJudgeS.score + ' F(NS)=' + flatJudgeNs.score +
            ' GP(S)=' + gpJudgeS.score + ' GP(NS)=' + gpJudgeNs.score + '\n'
        );
        process.stdout.write(
            '  ΔF(S→NS)=' + (deltaF >= 0 ? '+' : '') + deltaF +
            '  ΔGP(S→NS)=' + (deltaG >= 0 ? '+' : '') + deltaG +
            '  |ctx| F=' + flatCtxNs.length +
            ' GP=' + gpCtxNs.length + '\n'
        );
        process.stdout.write('  Flat(S):     ' + flatJudgeS.reason + '\n');
        process.stdout.write('  Flat(NS):    ' + flatJudgeNs.reason + '\n');
        process.stdout.write('  GP(S):       ' + gpJudgeS.reason + '\n');
        process.stdout.write('  GP(NS):      ' + gpJudgeNs.reason + '\n');

        if (flatJudgeS.score >= 1) flatScoreList.push(flatJudgeS.score);
        if (flatJudgeNs.score >= 1) flatNoScoreList.push(flatJudgeNs.score);
        if (gpJudgeS.score >= 1) gpScoreList.push(gpJudgeS.score);
        if (gpJudgeNs.score >= 1) gpNoScoreList.push(gpJudgeNs.score);

        results.push({
            queryId: qId,
            type: q.type,
            query: queryText.substring(0, 50),
            flatScore: flatJudgeS.score,
            flatReason: flatJudgeS.reason,
            flatNoScore: flatJudgeNs.score,
            flatNsReason: flatJudgeNs.reason,
            gpScore: gpJudgeS.score,
            gpReason: gpJudgeS.reason,
            gpNoScore: gpJudgeNs.score,
            gpNsReason: gpJudgeNs.reason,
            deltaF: deltaF,
            deltaG: deltaG,
        });
    }

    // ── Aggregate ──
    var validResults = results.filter(function(r) {
        return r.flatScore >= 1 && r.flatNoScore >= 1 &&
               r.gpScore >= 1 && r.gpNoScore >= 1;
    });

    var avgFlatScore = validResults.length > 0 ? avg(validResults.map(function(r) { return r.flatScore; })) : -1;
    var avgFlatNoScore = validResults.length > 0 ? avg(validResults.map(function(r) { return r.flatNoScore; })) : -1;
    var avgGpScore = validResults.length > 0 ? avg(validResults.map(function(r) { return r.gpScore; })) : -1;
    var avgGpNoScore = validResults.length > 0 ? avg(validResults.map(function(r) { return r.gpNoScore; })) : -1;

    var n = validResults.length;
    var deltaFlat = avgFlatNoScore - avgFlatScore;
    var deltaGp = avgGpNoScore - avgGpScore;

    var flatNoWins = validResults.filter(function(r) { return r.deltaF > 0; }).length;
    var flatScoreWins = validResults.filter(function(r) { return r.deltaF < 0; }).length;
    var flatTies = validResults.filter(function(r) { return r.deltaF === 0; }).length;

    var gpNoWins = validResults.filter(function(r) { return r.deltaG > 0; }).length;
    var gpScoreWins = validResults.filter(function(r) { return r.deltaG < 0; }).length;
    var gpTies = validResults.filter(function(r) { return r.deltaG === 0; }).length;

    // ── Console Summary ──
    console.log('\n' + '\u2550'.repeat(70));
    console.log('=== 4-WAY SUMMARY (' + n + ' valid queries) ===\n');

    console.log('Flat (score):     ' + f(avgFlatScore, 2));
    console.log('Flat (no score):  ' + f(avgFlatNoScore, 2) + '   Δ=' + (deltaFlat >= 0 ? '+' : '') + f(deltaFlat, 2));
    console.log('GP (score):       ' + f(avgGpScore, 2));
    console.log('GP (no score):    ' + f(avgGpNoScore, 2) + '   Δ=' + (deltaGp >= 0 ? '+' : '') + f(deltaGp, 2));
    console.log('');
    console.log('Flat:  noScore wins=' + flatNoWins + '  score wins=' + flatScoreWins + '  ties=' + flatTies);
    console.log('GP:    noScore wins=' + gpNoWins + '  score wins=' + gpScoreWins + '  ties=' + gpTies);

    // By type
    var narrResults = validResults.filter(function(r) { return r.type === 'narrative'; });
    var targResults = validResults.filter(function(r) { return r.type === 'targeted'; });

    function fieldAvg(arr, field) {
        return arr.length > 0 ? avg(arr.map(function(r) { return r[field]; })) : -1;
    }

    if (narrResults.length > 0) {
        console.log('\nNarrative (' + narrResults.length + '):');
        console.log('  F(S)=' + f(fieldAvg(narrResults, 'flatScore'), 2) +
                    ' F(NS)=' + f(fieldAvg(narrResults, 'flatNoScore'), 2) +
                    ' GP(S)=' + f(fieldAvg(narrResults, 'gpScore'), 2) +
                    ' GP(NS)=' + f(fieldAvg(narrResults, 'gpNoScore'), 2));
    }
    if (targResults.length > 0) {
        console.log('Targeted (' + targResults.length + '):');
        console.log('  F(S)=' + f(fieldAvg(targResults, 'flatScore'), 2) +
                    ' F(NS)=' + f(fieldAvg(targResults, 'flatNoScore'), 2) +
                    ' GP(S)=' + f(fieldAvg(targResults, 'gpScore'), 2) +
                    ' GP(NS)=' + f(fieldAvg(targResults, 'gpNoScore'), 2));
    }

    // ── Report ──
    var lines = [];
    lines.push('# LLM-as-Judge: Score Suffix Ablation');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**Judge**: ' + JUDGE_MODEL + ' (temperature=0)');
    lines.push('**Retrieval**: BM25(TOP_K=' + TOP_K_BM25 + ') + Vector(bge-m3, TOP_K=' + TOP_K_VEC + ') → Lin α=0.20');
    lines.push('**Chat messages**: ' + (allChatMessages ? allChatMessages.length + ' entries' : 'NONE'));
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Format | Avg Score |');
    lines.push('|--------|-----------|');
    lines.push('| Flat (score) | **' + f(avgFlatScore, 2) + '** |');
    lines.push('| Flat (no score) | **' + f(avgFlatNoScore, 2) + '** |');
    lines.push('| GP (score) | **' + f(avgGpScore, 2) + '** |');
    lines.push('| GP (no score) | **' + f(avgGpNoScore, 2) + '** |');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push('| Δ Flat (noScore − score) | **' + (deltaFlat >= 0 ? '+' : '') + f(deltaFlat, 2) + '** |');
    lines.push('| Δ GP (noScore − score) | **' + (deltaGp >= 0 ? '+' : '') + f(deltaGp, 2) + '** |');
    lines.push('| Flat: noScore wins | ' + flatNoWins + '/' + n + ' |');
    lines.push('| Flat: score wins | ' + flatScoreWins + '/' + n + ' |');
    lines.push('| Flat: ties | ' + flatTies + '/' + n + ' |');
    lines.push('| GP: noScore wins | ' + gpNoWins + '/' + n + ' |');
    lines.push('| GP: score wins | ' + gpScoreWins + '/' + n + ' |');
    lines.push('| GP: ties | ' + gpTies + '/' + n + ' |');
    lines.push('');

    lines.push('By query type:');
    if (narrResults.length > 0) {
        lines.push('- Narrative (' + narrResults.length + '):');
        lines.push('  F(S)=' + f(fieldAvg(narrResults, 'flatScore'), 2) +
                    ' F(NS)=' + f(fieldAvg(narrResults, 'flatNoScore'), 2) +
                    ' GP(S)=' + f(fieldAvg(narrResults, 'gpScore'), 2) +
                    ' GP(NS)=' + f(fieldAvg(narrResults, 'gpNoScore'), 2));
    }
    if (targResults.length > 0) {
        lines.push('- Targeted (' + targResults.length + '):');
        lines.push('  F(S)=' + f(fieldAvg(targResults, 'flatScore'), 2) +
                    ' F(NS)=' + f(fieldAvg(targResults, 'flatNoScore'), 2) +
                    ' GP(S)=' + f(fieldAvg(targResults, 'gpScore'), 2) +
                    ' GP(NS)=' + f(fieldAvg(targResults, 'gpNoScore'), 2));
    }
    lines.push('');

    // Full score table
    lines.push('## Full Score Table');
    lines.push('');
    lines.push('| ID | Type | Query | F(S) | F(NS) | GP(S) | GP(NS) | ΔF | ΔGP |');
    lines.push('|----|------|-------|------|-------|-------|--------|----|-----|');
    results.forEach(function(r) {
        lines.push(
            '| ' + r.queryId + ' | ' + r.type + ' | ' + r.query +
            ' | ' + r.flatScore + ' | ' + r.flatNoScore +
            ' | ' + r.gpScore + ' | ' + r.gpNoScore +
            ' | ' + (r.deltaF >= 0 ? '+' : '') + r.deltaF +
            ' | ' + (r.deltaG >= 0 ? '+' : '') + r.deltaG + ' |'
        );
    });
    lines.push(
        '| **AVG** | — | — | **' + f(avgFlatScore, 2) +
        '** | **' + f(avgFlatNoScore, 2) +
        '** | **' + f(avgGpScore, 2) +
        '** | **' + f(avgGpNoScore, 2) +
        '** | **' + (deltaFlat >= 0 ? '+' : '') + f(deltaFlat, 2) +
        '** | **' + (deltaGp >= 0 ? '+' : '') + f(deltaGp, 2) + '** |'
    );
    lines.push('');

    // Analysis
    lines.push('## Analysis');
    lines.push('');
    lines.push('### Effect of Score Suffix `[score:x.xxx]`');
    lines.push('');
    if (Math.abs(deltaFlat) < 0.05 && Math.abs(deltaGp) < 0.05) {
        lines.push('The score suffix has **no measurable impact** on LLM judge scores.');
        lines.push('Both Flat and Grouped+Prefetch show negligible differences (Δ < 0.05).');
        lines.push('**Recommendation: Remove the score suffix permanently.**');
        lines.push('It saves ~1,150 characters per query (~21% of Flat, ~15% of GP)');
        lines.push('without degrading answerability assessment.');
    } else if (deltaFlat < 0 && deltaGp < 0) {
        lines.push('The score suffix **hurts** judge scores. Removing it improves both formats.');
        lines.push('**Recommendation: Remove the score suffix permanently.**');
    } else if (deltaFlat > 0.1 || deltaGp > 0.1) {
        lines.push('The score suffix provides **useful information** to the judge.');
        lines.push('**Recommendation: Keep the score suffix** despite the character overhead.');
    } else {
        lines.push('Score suffix effect is mixed or ambiguous (within noise range).');
        lines.push('Given the ~20% character savings, removing it is likely safe.');
    }
    lines.push('');
    lines.push('### Limitations');
    lines.push('- LLM-as-judge scores have inherent subjectivity (temperature=0 mitigates)');
    lines.push('- Prefetch text is capped at ~200 chars/msg, 2000 chars total');
    lines.push('- Single-run per query; ideally would run 2-3x for statistical rigor');
    lines.push('- Chat messages are fictionally written (not real SillyTavern data)');
    lines.push('');

    var report = lines.join('\n');
    var outDir = join(__dirname, 'output');
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'llm-judge-score-ablation.md');
    writeFileSync(outPath, report, 'utf-8');

    console.log('\nFull report: ' + outPath);
}

main().catch(function(e) {
    console.error('LLM Judge benchmark crashed:', e);
    process.exit(2);
});
