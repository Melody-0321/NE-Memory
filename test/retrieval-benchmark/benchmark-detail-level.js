// NE-Memory: Detail-Level Classifier benchmark
// Path A (Baseline): top-3 prefetch + buildEntityBlock
// Path B (Classified): full prefetch + classifyDetailLevels + buildEntityBlockLeveled
// Judge model != Classifier model (avoids circular validation)

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { buildEntityBlock, buildEntityBlockLeveled, classifyDetailLevels } from '../../src/core/engine/injection.js';
import { allSTM, allLTM, allChatMessages } from './fixture.js';
import { loadSplitQueries, outputDirFor } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader } from './report-provenance.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_detail_level__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;

// LLM Judge — use DeepSeek-V3 (different model from classifier)
var JUDGE_URL = config.url.replace('/embeddings', '/chat/completions');
var JUDGE_MODEL = 'Pro/deepseek-ai/DeepSeek-V3';
var JUDGE_KEY = config.key;

// Classifier — deepseek-v4-flash (fast). Per-entry single-number output tolerates reasoning text.
var CLASSIFIER_URL = config.judge_v4 ? config.judge_v4.url : JUDGE_URL;
var CLASSIFIER_MODEL = config.judge_v4 ? config.judge_v4.model : JUDGE_MODEL;
var CLASSIFIER_KEY = config.judge_v4 ? config.judge_v4.key : JUDGE_KEY;

process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;
delete process.env.NE_BENCHMARK_VECTOR;

function setBgeM3() {
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
}

// ─── Prefetch (matches production — no MAX_TOTAL) ───

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
        msgIds.forEach(function(mid) {
            var msg = allChatMessages.find(function(m) { return String(m.id) === String(mid); });
            if (msg) {
                var text = typeof msg.mes === 'string' ? msg.mes : (msg.content || '');
                if (text) {
                    var line = '[msg_' + mid + '] ' + text.substring(0, 200);
                    originalLines.push(line);
                }
            }
        });
        if (originalLines.length > 0) {
            entry._originalText = originalLines.join('\n');
        }
    });
}

// ─── LLM Judge (DeepSeek-V3, different from classifier) ───

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

    var response = await fetch(JUDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + JUDGE_KEY },
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
        throw new Error(label + ' API error: ' + response.status);
    }

    var data = await response.json();
    var content = data.choices[0].message.content.trim();

    var result = null;
    try {
        result = JSON.parse(content);
    } catch (e1) {
        var cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        try {
            result = JSON.parse(cleaned);
        } catch (e2) {
            var scoreMatch = content.match(/"score"\s*:\s*(\d+)/);
            result = {
                score: scoreMatch ? parseInt(scoreMatch[1]) : -1,
                reason: content.substring(0, 80),
                key_entries: [],
            };
        }
    }

    if (result.score == null || result.score < 1 || result.score > 5) {
        result.score = -1;
    }

    return result;
}

// ─── Classifier LLM (for classifyDetailLevels) ───

async function classifierLLM(messages, options) {
    var response = await fetch(CLASSIFIER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CLASSIFIER_KEY },
        body: JSON.stringify({
            model: CLASSIFIER_MODEL,
            messages: messages,
            temperature: 0,
            max_tokens: 1000,
            thinking: { type: 'disabled' },
        }),
    });
    if (!response.ok) throw new Error('Classifier API error: ' + response.status);
    var data = await response.json();
    var msg = data.choices[0].message;
    return msg.content || '';
}

// ─── Helpers ───

function avg(arr) { return arr.length > 0 ? arr.reduce(function(a,b){return a+b;},0) / arr.length : 0; }

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
    var matched = allEntityNames.filter(function(n) {
        return n.length > 1 && queryLower.indexOf(n.toLowerCase()) !== -1;
    });
    matched.sort(function(a, b) { return b.length - a.length; });
    return matched.slice(0, 5);
}

function buildEntityChains(stmArr, entityNames) {
    var chains = {};
    entityNames.forEach(function(name) {
        var chain = [];
        stmArr.forEach(function(e) {
            if (e.entities && e.entities.some(function(en) {
                return (typeof en === 'string' ? en : en.name) === name;
            })) {
                chain.push(e);
            }
        });
        if (chain.length > 0) chains[name] = chain;
    });
    return chains;
}

// ─── Main ───

async function main() {
    console.log('=== Detail-Level Classifier Benchmark ===\n');
    console.log('Classifier: ' + CLASSIFIER_MODEL + ' via ' + CLASSIFIER_URL);
    console.log('Judge: ' + JUDGE_MODEL + ' (different model from classifier)');
    console.log('Chat messages: ' + (allChatMessages ? allChatMessages.length + ' entries' : 'NONE'));
    console.log('Queries: ' + queries.length + '\n');

    setBgeM3();
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    var allEntityNames = collectAllEntityNames(allSTM);
    var results = [];

    for (var qi = 0; qi < queries.length; qi++) {
        var q = queries[qi];
        var queryText = q.query || q.question;
        var qId = q.id || ('q' + (qi + 1));
        var activeChars = q.activeEntities || [];

        process.stdout.write('[' + (qi + 1) + '/' + queries.length + '] ' + qId + ' ... ');

        // ── Retrieval (shared) ──
        delete process.env.NE_BENCHMARK_VECTOR;
        var bm25Results = await filterCandidates(queryText, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
        var rawBm25Ids = bm25Results.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });

        setBgeM3();
        var queryEmb = await computeEmbedding(queryText);
        var vecResults = vectorSearch(queryEmb, vecIdx, TOP_K_VEC);
        var rawVecIds = vecResults.map(function(v) { return v.entry.id; });

        linearFuse(rawBm25Ids, rawVecIds, 0.20, 40, 60);

        // ── Packaging (shared) ──
        var entityNames = extractEntityNames(queryText, allEntityNames);
        var entityChains = buildEntityChains(allSTM, entityNames);

        var merged = await mergePipelines(bm25Results, entityChains, allLTM, { characters: {}, factions: {} }, allSTM);
        var grouped = groupCandidatesByEntity(merged.map, merged.threadIndex);

        // ── Deep copy map for independent paths ──
        var mapA = new Map();
        merged.map.forEach(function(v, k) { mapA.set(k, JSON.parse(JSON.stringify(v))); });
        var mapB = new Map();
        merged.map.forEach(function(v, k) { mapB.set(k, JSON.parse(JSON.stringify(v))); });

        // ── Path A: Baseline (top-3 prefetch + buildEntityBlock) ──
        var baselineStart = Date.now();
        applyPrefetch(mapA, allChatMessages, 3);
        var ctxBaseline = buildEntityBlock({ groups: grouped.groups, unassigned: grouped.unassigned }, {}, activeChars, entityChains);
        var baselineMs = Date.now() - baselineStart;

        // ── Path B: Classified (full prefetch + classify + buildEntityBlockLeveled) ──
        var classifierStart = Date.now();
        applyPrefetch(mapB, allChatMessages, 40);
        var detailLevels = {};
        try {
            detailLevels = await classifyDetailLevels(queryText, mapB, entityChains, { story_time: '', story_scene: '', characters: {} }, CHAT_ID, classifierLLM);
        } catch (e) {
            process.stdout.write('[CLS_FAIL] ');
        }
        var classifierMs = Date.now() - classifierStart;

        mapB.forEach(function(v, id) {
            if (detailLevels[id]) {
                v._detailLevel = detailLevels[id].level;
            } else {
                v._detailLevel = 2;
            }
        });

        // Sync _detailLevel from mapB to grouped entries (grouped references original map, not deep copy)
        Object.keys(grouped.groups).forEach(function(name) {
            grouped.groups[name].entries.forEach(function(ge) {
                var id = ge.entry && ge.entry.id;
                if (id && mapB.has(id)) {
                    ge._detailLevel = mapB.get(id)._detailLevel;
                } else {
                    ge._detailLevel = 2;
                }
            });
        });

        var ctxClassified = buildEntityBlockLeveled({ groups: grouped.groups, unassigned: grouped.unassigned }, {}, activeChars, entityChains);

        // ── Metrics ──
        var baselineTokens = ctxBaseline.length;
        var classifiedTokens = ctxClassified.length;

        var levelCounts = { L1: 0, L2: 0, L3: 0 };
        Object.keys(detailLevels).forEach(function(id) {
            var lvl = detailLevels[id].level;
            if (lvl === 1) levelCounts.L1++;
            else if (lvl === 3) levelCounts.L3++;
            else levelCounts.L2++;
        });

        // ── Judge ──
        var judgeBaseline, judgeClassified;
        try {
            judgeBaseline = await judgeQuery(queryText, ctxBaseline, 'Baseline');
        } catch (e) {
            judgeBaseline = { score: -1, reason: 'ERR:' + e.message };
        }
        try {
            judgeClassified = await judgeQuery(queryText, ctxClassified, 'Classified');
        } catch (e) {
            judgeClassified = { score: -1, reason: 'ERR:' + e.message };
        }

        var judgeDelta = (judgeClassified.score >= 1 && judgeBaseline.score >= 1)
            ? judgeClassified.score - judgeBaseline.score : 0;

        process.stdout.write(
            'BL=' + baselineTokens + ' CL=' + classifiedTokens +
            ' L1=' + levelCounts.L1 + ' L2=' + levelCounts.L2 + ' L3=' + levelCounts.L3 +
            ' J(BL)=' + judgeBaseline.score + ' J(CL)=' + judgeClassified.score +
            ' Δ=' + (judgeDelta >= 0 ? '+' : '') + judgeDelta + '\n'
        );

        results.push({
            queryId: qId,
            type: q.type,
            query: queryText.substring(0, 50),
            baselineTokens: baselineTokens,
            classifiedTokens: classifiedTokens,
            tokenDelta: classifiedTokens - baselineTokens,
            levelCounts: levelCounts,
            classifierMs: classifierMs,
            judgeBaseline: judgeBaseline.score,
            judgeClassified: judgeClassified.score,
            judgeDelta: judgeDelta,
            judgeBlReason: judgeBaseline.reason || '',
            judgeClReason: judgeClassified.reason || '',
        });
    }

    // ── Aggregate ──
    var validResults = results.filter(function(r) {
        return r.judgeBaseline >= 1 && r.judgeClassified >= 1;
    });
    var n = validResults.length;

    function fieldAvg(arr, field) {
        return arr.length > 0 ? avg(arr.map(function(r) { return r[field]; })) : -1;
    }

    var avgBaselineTk = fieldAvg(validResults, 'baselineTokens');
    var avgClassifiedTk = fieldAvg(validResults, 'classifiedTokens');
    var avgJudgeBL = fieldAvg(validResults, 'judgeBaseline');
    var avgJudgeCL = fieldAvg(validResults, 'judgeClassified');
    var avgJudgeDelta = fieldAvg(validResults, 'judgeDelta');
    var avgClassifierMs = fieldAvg(validResults, 'classifierMs');

    var clsWins = validResults.filter(function(r) { return r.judgeDelta > 0; }).length;
    var blWins = validResults.filter(function(r) { return r.judgeDelta < 0; }).length;
    var ties = validResults.filter(function(r) { return r.judgeDelta === 0; }).length;

    var totalL1 = 0, totalL2 = 0, totalL3 = 0;
    validResults.forEach(function(r) {
        totalL1 += r.levelCounts.L1;
        totalL2 += r.levelCounts.L2;
        totalL3 += r.levelCounts.L3;
    });
    var totalLevels = totalL1 + totalL2 + totalL3;
    var l3Ratio = totalLevels > 0 ? (totalL3 / totalLevels * 100).toFixed(1) : '0.0';

    var narrResults = validResults.filter(function(r) { return r.type === 'narrative'; });
    var targResults = validResults.filter(function(r) { return r.type === 'targeted'; });

    // ── Console ──
    console.log('\n' + '='.repeat(70));
    console.log('=== DETAIL-LEVEL CLASSIFIER BENCHMARK (' + n + ' valid queries) ===\n');

    console.log('Token counts:');
    console.log('  Baseline:   ' + Math.round(avgBaselineTk) + ' chars avg');
    console.log('  Classified: ' + Math.round(avgClassifiedTk) + ' chars avg');
    console.log('  Δ:          ' + (avgClassifiedTk - avgBaselineTk >= 0 ? '+' : '') + (avgClassifiedTk - avgBaselineTk).toFixed(0) + ' chars (' +
        ((avgClassifiedTk / avgBaselineTk - 1) * 100).toFixed(1) + '%)\n');

    console.log('Level distribution:');
    console.log('  L1: ' + totalL1 + ' (' + (totalLevels > 0 ? (totalL1 / totalLevels * 100).toFixed(1) : '0') + '%)');
    console.log('  L2: ' + totalL2 + ' (' + (totalLevels > 0 ? (totalL2 / totalLevels * 100).toFixed(1) : '0') + '%)');
    console.log('  L3: ' + totalL3 + ' (' + l3Ratio + '%)' + (parseFloat(l3Ratio) < 10 ? '  ⚠ L3 < 10%' : ''));
    console.log('');

    console.log('Judge scores:');
    console.log('  Baseline:   ' + avgJudgeBL.toFixed(2));
    console.log('  Classified: ' + avgJudgeCL.toFixed(2) + '   Δ=' + (avgJudgeDelta >= 0 ? '+' : '') + avgJudgeDelta.toFixed(2));
    console.log('  Wins: CL=' + clsWins + '  BL=' + blWins + '  Ties=' + ties + '\n');

    console.log('Classifier cost:');
    console.log('  Avg latency: ' + Math.round(avgClassifierMs) + ' ms/query\n');

    if (narrResults.length > 0) {
        console.log('Narrative (' + narrResults.length + '):  BL=' + fieldAvg(narrResults, 'judgeBaseline').toFixed(2) +
                    '  CL=' + fieldAvg(narrResults, 'judgeClassified').toFixed(2) +
                    '  Δ=' + (fieldAvg(narrResults, 'judgeDelta') >= 0 ? '+' : '') + fieldAvg(narrResults, 'judgeDelta').toFixed(2));
    }
    if (targResults.length > 0) {
        console.log('Targeted (' + targResults.length + '): BL=' + fieldAvg(targResults, 'judgeBaseline').toFixed(2) +
                    '  CL=' + fieldAvg(targResults, 'judgeClassified').toFixed(2) +
                    '  Δ=' + (fieldAvg(targResults, 'judgeDelta') >= 0 ? '+' : '') + fieldAvg(targResults, 'judgeDelta').toFixed(2));
    }

    // ── Report ──
    var lines = [];
    lines.push('# Detail-Level Classifier Benchmark');
    lines.push('**Generated**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
    lines.push('**Classifier**: ' + CLASSIFIER_MODEL);
    lines.push('**LLM Judge**: ' + JUDGE_MODEL + ' (different model — mitigates circular validation)');
    lines.push('**Queries**: ' + queries.length + ' (' + n + ' valid)');
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Baseline | Classified | Δ |');
    lines.push('|--------|----------|------------|----|');
    lines.push('| Avg token count | ' + Math.round(avgBaselineTk) + ' | ' + Math.round(avgClassifiedTk) + ' | ' + (avgClassifiedTk - avgBaselineTk >= 0 ? '+' : '') + Math.round(avgClassifiedTk - avgBaselineTk) + ' (' + ((avgClassifiedTk / avgBaselineTk - 1) * 100).toFixed(1) + '%) |');
    lines.push('| Avg Judge score | ' + avgJudgeBL.toFixed(2) + ' | ' + avgJudgeCL.toFixed(2) + ' | ' + (avgJudgeDelta >= 0 ? '+' : '') + avgJudgeDelta.toFixed(2) + ' |');
    lines.push('| L1 count | — | ' + totalL1 + ' (' + (totalLevels > 0 ? (totalL1 / totalLevels * 100).toFixed(1) : '0') + '%) | — |');
    lines.push('| L2 count | — | ' + totalL2 + ' (' + (totalLevels > 0 ? (totalL2 / totalLevels * 100).toFixed(1) : '0') + '%) | — |');
    lines.push('| L3 count | — | ' + totalL3 + ' (' + l3Ratio + '%)' + (parseFloat(l3Ratio) < 10 ? ' ⚠ low' : '') + ' | — |');
    lines.push('| Classifier latency | — | ' + Math.round(avgClassifierMs) + ' ms/query | — |');
    lines.push('');
    lines.push('| Comparison | Count |');
    lines.push('|-----------|-------|');
    lines.push('| Classified wins | ' + clsWins + '/' + n + ' |');
    lines.push('| Baseline wins | ' + blWins + '/' + n + ' |');
    lines.push('| Ties | ' + ties + '/' + n + ' |');
    lines.push('');

    if (narrResults.length > 0) {
        lines.push('Narrative (' + narrResults.length + '): BL=' + fieldAvg(narrResults, 'judgeBaseline').toFixed(2) + ' → CL=' + fieldAvg(narrResults, 'judgeClassified').toFixed(2) + ' (Δ=' + (fieldAvg(narrResults, 'judgeDelta') >= 0 ? '+' : '') + fieldAvg(narrResults, 'judgeDelta').toFixed(2) + ')');
    }
    if (targResults.length > 0) {
        lines.push('Targeted (' + targResults.length + '): BL=' + fieldAvg(targResults, 'judgeBaseline').toFixed(2) + ' → CL=' + fieldAvg(targResults, 'judgeClassified').toFixed(2) + ' (Δ=' + (fieldAvg(targResults, 'judgeDelta') >= 0 ? '+' : '') + fieldAvg(targResults, 'judgeDelta').toFixed(2) + ')');
    }
    lines.push('');

    lines.push('## Per-Query Results');
    lines.push('');
    lines.push('| ID | Type | BL tok | CL tok | L1/L2/L3 | J(BL) | J(CL) | ΔJ | CL ms |');
    lines.push('|---|------|--------|--------|----------|-------|-------|----|-------|');
    validResults.forEach(function(r) {
        var lvlStr = r.levelCounts.L1 + '/' + r.levelCounts.L2 + '/' + r.levelCounts.L3;
        lines.push(
            '| ' + r.queryId + ' | ' + r.type + ' | ' + r.baselineTokens + ' | ' + r.classifiedTokens +
            ' | ' + lvlStr + ' | ' + r.judgeBaseline + ' | ' + r.judgeClassified +
            ' | ' + (r.judgeDelta >= 0 ? '+' : '') + r.judgeDelta +
            ' | ' + r.classifierMs + ' |'
        );
    });
    lines.push('');

    var clWinList = validResults.filter(function(r) { return r.judgeDelta > 0; }).sort(function(a,b){return b.judgeDelta - a.judgeDelta;});
    if (clWinList.length > 0) {
        lines.push('## Classified Wins');
        lines.push('');
        lines.push('| ID | Query | J(BL) | J(CL) | ΔJ | BL Reason | CL Reason |');
        lines.push('|---|-------|-------|-------|----|----------|----------|');
        clWinList.forEach(function(r) {
            lines.push('| ' + r.queryId + ' | ' + r.query + ' | ' + r.judgeBaseline + ' | ' + r.judgeClassified + ' | +' + r.judgeDelta + ' | ' + (r.judgeBlReason || '') + ' | ' + (r.judgeClReason || '') + ' |');
        });
        lines.push('');
    }

    var blWinList = validResults.filter(function(r) { return r.judgeDelta < 0; }).sort(function(a,b){return a.judgeDelta - b.judgeDelta;});
    if (blWinList.length > 0) {
        lines.push('## Baseline Wins');
        lines.push('');
        lines.push('| ID | Query | J(BL) | J(CL) | ΔJ | BL Reason | CL Reason |');
        lines.push('|---|-------|-------|-------|----|----------|----------|');
        blWinList.forEach(function(r) {
            lines.push('| ' + r.queryId + ' | ' + r.query + ' | ' + r.judgeBaseline + ' | ' + r.judgeClassified + ' | ' + r.judgeDelta + ' | ' + (r.judgeBlReason || '') + ' | ' + (r.judgeClReason || '') + ' |');
        });
        lines.push('');
    }

    lines.push('## Analysis');
    lines.push('');
    var tokenChange = avgClassifiedTk - avgBaselineTk;
    lines.push('### Token Efficiency');
    if (tokenChange <= 0) {
        lines.push('The classifier **reduced** context size by ' + Math.abs(Math.round(tokenChange)) + ' chars (' +
            ((avgClassifiedTk / avgBaselineTk - 1) * 100).toFixed(1) + '%) on average.');
    } else {
        lines.push('The classifier **increased** context size by ' + Math.round(tokenChange) + ' chars (' +
            ((avgClassifiedTk / avgBaselineTk - 1) * 100).toFixed(1) + '%) on average.');
    }
    lines.push('');

    lines.push('### Judge Score');
    if (avgJudgeDelta > 0.1) {
        lines.push('The classifier **improved** judge scores by +' + avgJudgeDelta.toFixed(2) + ' points on average.');
    } else if (avgJudgeDelta < -0.1) {
        lines.push('The classifier **degraded** judge scores by ' + avgJudgeDelta.toFixed(2) + ' points on average.');
    } else {
        lines.push('No significant difference in judge scores (Δ=' + avgJudgeDelta.toFixed(2) + ').');
    }
    lines.push('');

    if (parseFloat(l3Ratio) <= 10) {
        lines.push('⚠ **Low L3 activation rate (' + l3Ratio + '%)**: The classifier rarely judges entries as needing original text.');
        lines.push('The classified path is effectively equivalent to baseline with heavier prefetch overhead.');
    } else {
        lines.push('L3 activation rate: ' + l3Ratio + '% — classifier is actively triggering detail expansion.');
    }
    lines.push('');
    lines.push('### Limitations');
    lines.push('- LLM Judge and Classifier are different models (mitigates circular validation)');
    lines.push('- Single-run per query; statistical noise may affect marginal cases');
    lines.push('- Classifier latency: ~' + Math.round(avgClassifierMs) + 'ms per query in benchmark mode');
    lines.push('- In production, classifier latency would add to total SmartPush time');
    lines.push('');

    var report = lines.join('\n');
    var outDir = outputDirFor(__dirname);
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'detail-level-report.md');
    writeFileSync(outPath, withProvenanceHeader('detail-level', report, SYSTEM_PROMPT.join('\n')), 'utf-8');

    console.log('\nFull report: ' + outPath);
}

main().catch(function(e) {
    console.error('Benchmark crashed:', e);
    process.exit(2);
});
