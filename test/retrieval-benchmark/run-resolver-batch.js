// run-resolver-batch.js — K 粒度扫描 runner
// 对 K ∈ {1,2,4,8}：每 K 8 段 → resolver（每段 1 次调用）→ 记录 prompt_tokens + 各事件 reversed/rewritten
// 然后盲评 judge 判定重写文本是否保留反悔情态（与 D 臂同口径）。
// 输出：output/resolver-batch/{K}/S{seg}.json（每段 resolver 结果）+ aggregate.json + decision.md
// 用法：
//   node run-resolver-batch.js --resolver-only   # 只跑 resolver（不 judge）
//   node run-resolver-batch.js --judge-only      # 只跑 judge（resolver 已完成）
//   node run-resolver-batch.js                    # 全流程

import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildBatchCorpus } from './resolver-batch-corpus.js';
import { resolveBatch } from './resolver-batch.js';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';
import { withProvenanceHeader } from './report-provenance.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

var OUT_BASE = join(__dirname, 'output', 'resolver-batch');
var KS = [1, 2, 4, 8];

var argv = process.argv;
var RESOLVER_ONLY = argv.includes('--resolver-only');
var JUDGE_ONLY = argv.includes('--judge-only');
var DRY = argv.includes('--dry');
// 2026-08-19：K=2 在 M=900 下 2/8 段撞 max_tokens 截断（§8.4 建议 M≥1800），加参数支持安全区重跑
var MAX_TOKENS = 1800;
(function () {
    var i = argv.indexOf('--max-tokens');
    if (i !== -1 && argv[i + 1]) MAX_TOKENS = Number(argv[i + 1]) || 1800;
})();

function callChat(messages, temperature, maxTokens) {
    return fetch(LLM.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (LLM.key || '') },
        body: JSON.stringify({ model: LLM.model, messages: messages, temperature: temperature, max_tokens: maxTokens, response_format: { type: 'json_object' } })
    }).then(function (resp) {
        if (!resp.ok) throw new Error('LLM HTTP ' + resp.status);
        return resp.json();
    }).then(function (data) {
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('LLM empty content');
        return content;
    });
}

function callChatRetry(messages, temperature, maxTokens) {
    var attempt = 0;
    function run() {
        return callChat(messages, temperature, maxTokens).catch(function (err) {
            if (attempt < 2) { attempt++; return run(); }
            throw err;
        });
    }
    return run();
}

// 盲评 judge：只看重写文本 + 该事件 expectedNote（隐藏 K/批次），判定反悔情态是否存活
async function judgeEvent(eventText, expectedNote) {
    var user = [
        '下面是一个对话片段中抽取出的"事件"摘要，以及它应保留的情态语义说明。',
        '--- 事件摘要 ---',
        '"' + eventText + '"',
        '--- 应保留的情态语义 ---',
        expectedNote,
        '---',
        '判断：该摘要是否保留了上述情态语义（尤其否定/反悔/状态往返的"真值"）。',
        '若摘要把反悔写成无修饰事实、或只保留最初主张未体现最终状态 → survived=false。',
        '若清楚保留反悔/最终状态 → survived=true。若不确定 → survived=null。',
        '输出严格 JSON：{"survived":"yes|no|uncertain","reason":"一句话原因"}',
    ].join('\n');
    var raw = await callChatRetry([
        { role: 'system', content: '你是情态存活率审计员。只返回 JSON。' },
        { role: 'user', content: user },
    ], 0, 300);
    var p = safeJsonParse(raw);
    if (!p || !p.survived) return { verdict: 'untested', reason: raw ? raw.slice(0, 100) : '(empty)' };
    return { verdict: p.survived, reason: (p.reason || '') };
}

async function runResolver(corpus) {
    console.log('=== resolver 阶段 ===');
    var results = {};
    for (var ki = 0; ki < KS.length; ki++) {
        var K = KS[ki];
        var segs = corpus[K];
        results[K] = [];
        for (var si = 0; si < segs.length; si++) {
            var seg = segs[si];
            var dialogue = seg.messages.map(function (m) {
                return ((m.role === 'user') ? '用户' : (m.name || '角色')) + '：' + m.mes;
            }).join('\n');
            var outPath = join(OUT_BASE, String(K), seg.id + '.json');
            if (existsSync(outPath) && !DRY) { results[K].push(JSON.parse(readFileSync(outPath, 'utf-8'))); continue; }
            if (DRY) { console.log('  [dry][K=' + K + '][' + seg.id + '] ' + seg.events.length + ' events'); continue; }
            process.stdout.write('  [K=' + K + '][' + seg.id + '] ' + seg.events.length + ' events ... ');
            var r = await resolveBatch(dialogue, seg.events.map(function (e) { return { idx: e.idx, eventText: e.eventText }; }), { temperature: 0.2, maxTokens: MAX_TOKENS });
            var out = { segId: seg.id, K: K, promptTokens: r.promptTokens, completionTokens: r.completionTokens, ok: r.ok, raw: r.raw, events: [] };
            seg.events.forEach(function (e, ei) {
                var rr = r.results[ei] || {};
                out.events.push({
                    caseId: e.caseId, idx: e.idx, category: e.category,
                    finalState: e.finalState || null, expectedNote: e.expectedNote || '',
                    ok: rr.ok, parseFail: rr.parseFail || false,
                    reversed: rr.reversed, rewritten: rr.rewritten, evidence: rr.evidence, reason: rr.reason,
                });
            });
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
            results[K].push(out);
            console.log('tok=' + (r.promptTokens ?? 'n/a') + ' ok=' + r.ok);
        }
    }
    return results;
}

async function runJudge(results) {
    console.log('\n=== judge 阶段 ===');
    for (var ki = 0; ki < KS.length; ki++) {
        var K = KS[ki];
        for (var si = 0; si < results[K].length; si++) {
            var seg = results[K][si];
            for (var ei = 0; ei < seg.events.length; ei++) {
                var ev = seg.events[ei];
                var caseId = ev.caseId;
                var textToJudge = ev.rewritten; // 重写后的文本（judge 只看这个）
                var outPath = join(OUT_BASE, String(K), 'judge_' + seg.segId + '_' + ei + '.json');
                if (existsSync(outPath)) continue;
                process.stdout.write('  [K=' + K + '][' + seg.segId + '#' + ei + '] ' + caseId + ' ... ');
                var v;
                try { v = await judgeEvent(textToJudge, ev.expectedNote || ''); }
                catch (e) { v = { verdict: 'untested', reason: 'judge 失败: ' + (e && e.message) }; }
                writeFileSync(outPath, JSON.stringify({
                    K: K, segId: seg.segId, eventIdx: ei, caseId: caseId,
                    text: textToJudge, verdict: v.verdict, reason: v.reason,
                }, null, 2), 'utf-8');
                console.log(v.verdict + (v.reason ? ' — ' + v.reason : ''));
            }
        }
    }
}

function computeAggregate(results) {
    var agg = { K: {} };
    KS.forEach(function (K) {
        var segs = results[K];
        if (!segs || segs.length === 0) { agg.K[K] = null; return; }
        var totalEvents = 0, totalTokens = 0, totalCompletion = 0, calls = segs.length, parseFail = 0;
        var survYes = 0, survNo = 0, survUnc = 0, survUnt = 0;
        var byCat = {}; // { reversal: {yes,no,judgeable}, teasing: {...}, hypothetical: {...} }
        function initCat(c) { if (!byCat[c]) byCat[c] = { yes: 0, no: 0, uncertain: 0, judgeable: 0 }; }
        segs.forEach(function (seg) {
            if (seg.promptTokens != null) totalTokens += seg.promptTokens;
            if (seg.completionTokens != null) totalCompletion += seg.completionTokens;
            seg.events.forEach(function (ev) {
                totalEvents++;
                initCat(ev.category || 'other');
                // parseFail 事件不是"存活失败"而是"测量失败"：从存活率分母剔除（独立出局判据）
                if (ev.parseFail) { parseFail++; return; }
                var jf = join(OUT_BASE, String(K), 'judge_' + seg.segId + '_' + ev.idx + '.json');
                if (existsSync(jf)) {
                    var jd = JSON.parse(readFileSync(jf, 'utf-8'));
                    if (jd.verdict === 'yes') { survYes++; byCat[ev.category || 'other'].yes++; byCat[ev.category || 'other'].judgeable++; }
                    else if (jd.verdict === 'no') { survNo++; byCat[ev.category || 'other'].no++; byCat[ev.category || 'other'].judgeable++; }
                    else if (jd.verdict === 'uncertain') { survUnc++; byCat[ev.category || 'other'].uncertain++; byCat[ev.category || 'other'].judgeable++; }
                    else survUnt++;
                } else survUnt++;
            });
        });
        var judgeable = survYes + survNo + survUnc;
        var catRates = {};
        Object.keys(byCat).forEach(function (c) {
            var b = byCat[c];
            catRates[c] = b.judgeable ? (b.yes / b.judgeable * 100).toFixed(1) + '% (' + b.yes + '/' + b.judgeable + ')' : '—';
        });
        agg.K[K] = {
            segments: calls, events: totalEvents,
            callsPerEvent: (calls / Math.max(totalEvents, 1)).toFixed(3),
            avgTokensPerEvent: totalEvents ? (totalTokens / totalEvents).toFixed(1) : null,
            avgCompletionPerEvent: totalEvents ? (totalCompletion / totalEvents).toFixed(1) : null,
            avgTotalPerEvent: totalEvents ? ((totalTokens + totalCompletion) / totalEvents).toFixed(1) : null,
            avgTokensPerCall: calls ? (totalTokens / calls).toFixed(1) : null,
            avgCompletionPerCall: calls ? (totalCompletion / calls).toFixed(1) : null,
            parseFail: parseFail,
            parseFailRate: totalEvents ? (parseFail / totalEvents * 100).toFixed(1) + '%' : '—',
            surviveRate: judgeable ? (survYes / judgeable * 100).toFixed(1) + '% (' + survYes + '/' + judgeable + ')' : '—',
            byCategory: catRates,
            yes: survYes, no: survNo, uncertain: survUnc, untested: survUnt,
        };
    });
    return agg;
}

async function main() {
    // buildBatchCorpus() 无参 → 返回按 K 分组的对象 { K: [segs...] }
    var corpus = buildBatchCorpus({ K: KS });
    mkdirSync(OUT_BASE, { recursive: true });

    var results = {};
    if (!JUDGE_ONLY) results = await runResolver(corpus);
    else {
        KS.forEach(function (K) {
            results[K] = [];
            var dir = join(OUT_BASE, String(K));
            if (existsSync(dir)) {
                readdirSync(dir).filter(function (f) { return f.endsWith('.json') && f.indexOf('judge_') === -1; }).forEach(function (f) {
                    results[K].push(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
                });
            }
        });
    }
    if (DRY) { console.log('\nDRY 完成'); return; }

    if (!RESOLVER_ONLY) {
        await runJudge(results);
    }

    var agg = computeAggregate(results);
    writeFileSync(join(OUT_BASE, 'aggregate.json'), JSON.stringify(agg, null, 2), 'utf-8');

    // decision.md
    var L = [];
    L.push('# D 臂 resolver 批量粒度成本-效果（K=1/2/4/8）');
    L.push('- 合成异主题段（resolver-batch-corpus.js，种子 20260819），每 K 8 段');
    L.push('- 成本：deepseek usage.prompt_tokens + completion_tokens 实测；效果：盲评 judge（deepseek-v4-flash@0），与 D 臂同口径');
    L.push('- 存活率按 category 分桶：反悔（主）/ 打趣 / 假设（不误伤守门）');
    L.push('');
    L.push('| K | 总存活率 | 反悔 | 打趣 | 假设 | 每事件in/out/总token | 每事件调用数 | parse失败 |');
    L.push('|---|---|---|---|---|---|---|---|');
    KS.forEach(function (K) {
        var a = agg.K[K];
        if (!a) { L.push('| ' + K + ' | — | — | — | — | — | — | — |'); return; }
        var comp = (a.avgCompletionPerEvent === null || a.avgCompletionPerEvent === '0.0') ? '—' : a.avgCompletionPerEvent;
        var total = (a.avgTotalPerEvent === null || a.avgTotalPerEvent === '0.0') ? '—' : a.avgTotalPerEvent;
        L.push('| ' + K + ' | ' + a.surviveRate + ' | ' + (a.byCategory.reversal || '—') + ' | ' + (a.byCategory.teasing || '—') + ' | ' + (a.byCategory.hypothetical || '—') + ' | ' + a.avgTokensPerEvent + '/' + comp + '/' + total + ' | ' + a.callsPerEvent + ' | ' + a.parseFail + ' |');
    });
    L.push('');
    L.push('## 决策（预注册规则 §2.3）');
    L.push('- 见 aggregate.json 与 canonical §8.3 登记（决策由执行者在数据落地后按规则给出）。');
    var outPath = join(OUT_BASE, 'decision.md');
    writeFileSync(outPath, withProvenanceHeader('resolver-batch', L.join('\n'), null, {
        fixturePath: join(__dirname, 'resolver-batch-corpus.js'),
        armPromptText: JSON.stringify({ K: KS, seed: 20260819, plan: 'resolver-batch-granularity-plan' }),
        split: 'dev',
    }), 'utf-8');
    console.log('\n=== aggregate 完成 ===');
    console.log(JSON.stringify(agg, null, 1));
    console.log('decision: ' + outPath);
}

main().catch(function (err) { console.error('\nFATAL:', err && err.stack || err); process.exit(1); });