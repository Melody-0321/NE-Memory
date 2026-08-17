// NE-Memory: Key Highlights ablation
// Baseline (Grouped+Prefetch, no score) vs New (Grouped+Prefetch + Key Highlights, no score)
// Judge: DeepSeek-V3

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { buildEntityBlock, buildKeyHighlights } from '../../src/core/engine/injection.js';
import { allSTM, allLTM, allChatMessages } from './fixture.js';
import { loadSplitQueries, outputDirFor } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader } from './report-provenance.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_key_highlights__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;

var JUDGE_URL = config.judge_v4 ? config.judge_v4.url : (config.url.replace('/embeddings', '/chat/completions'));
var JUDGE_MODEL = config.judge_v4 ? config.judge_v4.model : 'deepseek-chat';
var JUDGE_KEY = config.judge_v4 ? config.judge_v4.key : (config.key || '');
var JUDGE_IS_V4 = !!config.judge_v4;

process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;
delete process.env.NE_BENCHMARK_VECTOR;

function setBgeM3() {
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
}

// ─── Entity chain utilities ───

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
        msgIds.forEach(function(mid) {
            var msg = chatMessages.find(function(m) { return String(m.id) === String(mid); });
            if (msg) {
                var text = typeof msg.mes === 'string' ? msg.mes : (msg.content || '');
                if (text) {
                    originalLines.push('[msg_' + mid + '] ' + text.substring(0, 200));
                }
            }
        });
        if (originalLines.length > 0) {
            entry._originalText = originalLines.join('\n');
        }
    });
}

// ─── Context builder (Grouped+Prefetch, no score) ───

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
            var period = e.entry.period || '?';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            var line = ' ' + num + '. [' + period + '] ' + (scene ? scene + ': ' : '') + event;
            if (e._originalText) {
                line += '\n   > ' + e._originalText.replace(/\n/g, '\n   > ');
            }
            result.push(line);
        } else {
            missRun.push(e);
        }
    }
    flushMiss();
    return result;
}

function buildContext(mergedMap, grouped, activeEntities, withHighlights) {
    var lines = [];

    if (withHighlights) {
        var hl = buildKeyHighlights(mergedMap, grouped, 5);
        if (hl) {
            lines.push(hl);
            lines.push('---');
        }
    }

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
            var period = e.entry.period || '?';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            lines.push(' ' + (i + 1) + '. [' + period + '] ' + (scene ? scene + ': ' : '') + event);
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

    var reqBody = {
        model: JUDGE_MODEL,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 200,
    };
    if (JUDGE_IS_V4) reqBody.thinking = { type: 'disabled' };

    var response = await fetch(JUDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + JUDGE_KEY },
        body: JSON.stringify(reqBody),
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

function avg(arr) { return arr.length > 0 ? arr.reduce(function(a,b){return a+b;},0) / arr.length : 0; }

// ─── Main ───

async function main() {
    console.log('=== Key Highlights Ablation ===\n');
    console.log('Judge: ' + JUDGE_MODEL);
    console.log('Retrieval: BM25(TOP_K=' + TOP_K_BM25 + ') + Vector(bge-m3,TOP_K=' + TOP_K_VEC + ') \u2192 Lin \u03b1=0.20');
    console.log('Chat messages: ' + (allChatMessages ? allChatMessages.length + ' entries' : 'NONE'));
    console.log('Queries: ' + queries.length + '\n');

    setBgeM3();
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    var allEntityNames = collectAllEntityNames(allSTM);

    var results = [];
    var baselineScores = [];
    var highlightScores = [];

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

        // ── Apply prefetch ──
        applyPrefetch(merged.map, allChatMessages, 3);

        // ── Baseline: Grouped+Prefetch (no score) ──
        var ctxBaseline = buildContext(merged.map, grouped, entityNames, false);
        var judgeBaseline;
        try {
            judgeBaseline = await judgeQuery(queryText, ctxBaseline, 'Baseline');
        } catch (e) {
            judgeBaseline = { score: -1, reason: 'ERR:' + e.message, key_entries: [] };
        }

        // ── Highlights: Grouped+Prefetch + Key Highlights ──
        var ctxHighlight = buildContext(merged.map, grouped, entityNames, true);
        var judgeHighlight;
        try {
            judgeHighlight = await judgeQuery(queryText, ctxHighlight, 'HL');
        } catch (e) {
            judgeHighlight = { score: -1, reason: 'ERR:' + e.message, key_entries: [] };
        }

        var delta = judgeHighlight.score - judgeBaseline.score;

        process.stdout.write(
            'BL=' + judgeBaseline.score + ' HL=' + judgeHighlight.score +
            ' \u0394=' + (delta >= 0 ? '+' : '') + delta +
            ' |ctx| BL=' + ctxBaseline.length + ' HL=' + ctxHighlight.length + '\n'
        );

        if (judgeBaseline.score >= 1) baselineScores.push(judgeBaseline.score);
        if (judgeHighlight.score >= 1) highlightScores.push(judgeHighlight.score);

        results.push({
            queryId: qId,
            type: q.type,
            query: queryText,
            baselineScore: judgeBaseline.score,
            baselineReason: judgeBaseline.reason,
            baselineTokens: ctxBaseline.length,
            highlightScore: judgeHighlight.score,
            highlightReason: judgeHighlight.reason,
            highlightTokens: ctxHighlight.length,
            delta: delta,
        });
    }

    // ── Report ──
    var baselineAvg = avg(baselineScores);
    var highlightAvg = avg(highlightScores);
    var deltaAvg = highlightAvg - baselineAvg;

    var wins = results.filter(function(r) { return r.delta > 0; }).length;
    var losses = results.filter(function(r) { return r.delta < 0; }).length;
    var ties = results.filter(function(r) { return r.delta === 0; }).length;

    var narrResults = results.filter(function(r) { return r.type === 'narrative'; });
    var tgtResults = results.filter(function(r) { return r.type === 'targeted'; });
    var narrBL = avg(narrResults.map(function(r) { return r.baselineScore; }));
    var narrHL = avg(narrResults.map(function(r) { return r.highlightScore; }));
    var tgtBL = avg(tgtResults.map(function(r) { return r.baselineScore; }));
    var tgtHL = avg(tgtResults.map(function(r) { return r.highlightScore; }));

    var outDir = outputDirFor(__dirname);
    try { mkdirSync(outDir, { recursive: true }); } catch (e) {}

    var report = [
        '# Key Highlights Ablation',
        '**Generated**: ' + new Date().toISOString().replace('T',' ').substring(0,19),
        '**Judge**: ' + JUDGE_MODEL,
        '**Retrieval**: BM25(TOP_K=' + TOP_K_BM25 + ') + Vector(bge-m3,TOP_K=' + TOP_K_VEC + ') → Lin α=0.20',
        '**Chat messages**: ' + (allChatMessages ? allChatMessages.length + ' entries' : 'NONE'),
        '**Queries**: ' + results.length,
        '',
        '## Summary',
        '',
        '| Metric | Baseline | +Highlights | Δ |',
        '|--------|----------|-------------|---|',
        '| Avg Judge score | ' + baselineAvg.toFixed(2) + ' | ' + highlightAvg.toFixed(2) + ' | ' + (deltaAvg >= 0 ? '+' : '') + deltaAvg.toFixed(2) + ' |',
        '| Avg token count | ' + avg(results.map(function(r){return r.baselineTokens;})).toFixed(0) + ' | ' + avg(results.map(function(r){return r.highlightTokens;})).toFixed(0) + ' | — |',
        '',
        '| Comparison | Count |',
        '|-----------|-------|',
        '| Highlights wins | ' + wins + '/' + results.length + ' |',
        '| Baseline wins | ' + losses + '/' + results.length + ' |',
        '| Ties | ' + ties + '/' + results.length + ' |',
        '',
        'Narrative (' + narrResults.length + '): BL=' + narrBL.toFixed(2) + ' → HL=' + narrHL.toFixed(2) + ' (Δ=' + (narrHL - narrBL >= 0 ? '+' : '') + (narrHL - narrBL).toFixed(2) + ')',
        'Targeted (' + tgtResults.length + '): BL=' + tgtBL.toFixed(2) + ' → HL=' + tgtHL.toFixed(2) + ' (Δ=' + (tgtHL - tgtBL >= 0 ? '+' : '') + (tgtHL - tgtBL).toFixed(2) + ')',
        '',
        '## Per-Query Results',
        '',
        '| ID | Type | Query (truncated) | BL | HL | Δ |',
        '|---|------|-------------------|---|----|----|',
    ].join('\n');

    results.forEach(function(r) {
        report += '\n' + '| ' + r.queryId + ' | ' + r.type + ' | ' + r.query.substring(0, 50) + ' | ' + r.baselineScore + ' | ' + r.highlightScore + ' | ' + (r.delta >= 0 ? '+' : '') + r.delta + ' |';
    });

    report += '\n\n## Highlights Wins\n\n';
    results.filter(function(r) { return r.delta > 0; }).forEach(function(r) {
        report += '- **' + r.queryId + '**: BL=' + r.baselineScore + ' → HL=' + r.highlightScore + ' (+' + r.delta + ')\n';
        report += '  - BL: ' + r.baselineReason + '\n';
        report += '  - HL: ' + r.highlightReason + '\n';
    });

    report += '\n## Baseline Wins\n\n';
    results.filter(function(r) { return r.delta < 0; }).forEach(function(r) {
        report += '- **' + r.queryId + '**: BL=' + r.baselineScore + ' → HL=' + r.highlightScore + ' (' + r.delta + ')\n';
        report += '  - BL: ' + r.baselineReason + '\n';
        report += '  - HL: ' + r.highlightReason + '\n';
    });

    var reportFile = join(outDir, 'key-highlights-ablation.md');
    writeFileSync(reportFile, withProvenanceHeader('key-highlights', report, SYSTEM_PROMPT.join('\n')), 'utf-8');

    console.log('\n======================================================================');
    console.log('=== KEY HIGHLIGHTS ABLATION ===\n');
    console.log('Avg scores:     BL=' + baselineAvg.toFixed(2) + '  HL=' + highlightAvg.toFixed(2) + '  Δ=' + (deltaAvg >= 0 ? '+' : '') + deltaAvg.toFixed(2));
    console.log('Wins/Losses:    HL=' + wins + '  BL=' + losses + '  ties=' + ties);
    console.log('Narrative (' + narrResults.length + '): BL=' + narrBL.toFixed(2) + ' HL=' + narrHL.toFixed(2));
    console.log('Targeted (' + tgtResults.length + '): BL=' + tgtBL.toFixed(2) + ' HL=' + tgtHL.toFixed(2));
    console.log('\nFull report: ' + reportFile);
}

main().catch(function(e) {
    console.error('FATAL:', e);
    process.exit(1);
});
