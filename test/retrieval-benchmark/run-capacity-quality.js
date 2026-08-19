// run-capacity-quality.js — resolver 容量/质量两阶段 runner（resolver-capacity-quality-plan）
// 阶段 A（容量探测）：L×K×M 扫描，收集 finishReason(truncated) + parseFail + 成功条数 → 截断曲线
// 阶段 B（质量测量）：在安全区内（M 给足、载荷低于截断阈值）扫 L×K → judge 存活率
// 用法：
//   node run-capacity-quality.js --phase A [--Ls 20,60,120] [--Ks 1,2,4] [--Ms 900,1800,3600] [--segs 4]
//   node run-capacity-quality.js --phase B [--Ls 20,60,120] [--Ks 1,2,4] [--segs 4] [--M 3600]
//   node run-capacity-quality.js --analyze
// 输出：output/capacity-quality/{A|B}/... + aggregate.json + decision.md

import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildCapacityCorpus } from './resolver-batch-corpus.js';
import { resolveBatch } from './resolver-batch.js';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';
import { withProvenanceHeader } from './report-provenance.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

var OUT_BASE = join(__dirname, 'output', 'capacity-quality');

function argList(name, dflt) {
    var i = process.argv.indexOf('--' + name);
    if (i !== -1 && process.argv[i + 1]) {
        return process.argv[i + 1].split(',').map(function (s) { return s.trim(); });
    }
    return dflt;
}
function argVal(name, dflt) {
    var i = process.argv.indexOf('--' + name);
    return (i !== -1 && process.argv[i + 1] !== undefined) ? process.argv[i + 1] : dflt;
}
var PHASE = argVal('phase', null);
var LS = argList('Ls', ['20', '60', '120']).map(Number);
var KS = argList('Ks', ['1', '2', '4']).map(Number);
var MS = argList('Ms', ['900', '1800', '3600']).map(Number);
var SEGS = Number(argVal('segs', '4'));
var M_FOR_B = Number(argVal('M', '3600'));

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

// ── 阶段 A：容量探测 ──
async function phaseA() {
    console.log('=== 阶段 A 容量探测 L=' + LS.join(',') + ' K=' + KS.join(',') + ' M=' + MS.join(',') + ' segs=' + SEGS + ' ===');
    var out = { cells: {} };
    for (var li = 0; li < LS.length; li++) {
        var L = LS[li];
        for (var ki = 0; ki < KS.length; ki++) {
            var K = KS[ki];
            var segs = buildCapacityCorpus({ L: L, K: K, segments: SEGS });
            for (var mi = 0; mi < MS.length; mi++) {
                var M = MS[mi];
                var key = L + '_' + K + '_' + M;
                var dir = join(OUT_BASE, 'A', key);
                mkdirSync(dir, { recursive: true });
                var cell = { L: L, K: K, M: M, calls: 0, truncated: 0, parseFail: 0, ok: 0, promptTokens: [], completionTokens: [], finishReasons: [] };
                for (var si = 0; si < segs.length; si++) {
                    var seg = segs[si];
                    var dp = join(dir, seg.id + '.json');
                    if (existsSync(dp)) {
                        var prev = JSON.parse(readFileSync(dp, 'utf-8'));
                        cell.calls++; if (prev.truncated) cell.truncated++; if (prev.parseFail) cell.parseFail++; if (prev.ok) cell.ok++;
                        if (prev.promptTokens != null) cell.promptTokens.push(prev.promptTokens);
                        if (prev.completionTokens != null) cell.completionTokens.push(prev.completionTokens);
                        cell.finishReasons.push(prev.finishReason || 'n/a');
                        continue;
                    }
                    process.stdout.write('  [A][' + key + '][' + seg.id + '] ... ');
                    var dialogue = seg.messages.map(function (m) { return ((m.role === 'user') ? '用户' : (m.name || '角色')) + '：' + m.mes; }).join('\n');
                    var r = await resolveBatch(dialogue, seg.events.map(function (e) { return { idx: e.idx, eventText: e.eventText }; }), { temperature: 0.2, maxTokens: M });
                    var segOut = {
                        segId: seg.id, L: L, K: K, M: M,
                        ok: r.ok, truncated: r.truncated, parseFail: r.ok === false && (r.results || []).some(function (e) { return e.parseFail; }),
                        finishReason: r.finishReason || null, promptTokens: r.promptTokens, completionTokens: r.completionTokens,
                        eventCount: seg.events.length,
                        events: seg.events.map(function (e, ei) {
                            var rr = r.results[ei] || {};
                            return { caseId: e.caseId, idx: e.idx, category: e.category, ok: rr.ok, parseFail: rr.parseFail || false, reversed: rr.reversed, rewritten: rr.rewritten };
                        }),
                    };
                    writeFileSync(dp, JSON.stringify(segOut, null, 2), 'utf-8');
                    cell.calls++; if (r.truncated) cell.truncated++; if (segOut.parseFail) cell.parseFail++; if (r.ok) cell.ok++;
                    if (r.promptTokens != null) cell.promptTokens.push(r.promptTokens);
                    if (r.completionTokens != null) cell.completionTokens.push(r.completionTokens);
                    cell.finishReasons.push(r.finishReason || 'n/a');
                    console.log('trunc=' + r.truncated + ' ok=' + r.ok + ' tok=' + (r.promptTokens ?? 'n/a') + '+' + (r.completionTokens ?? 'n/a'));
                }
                cell.truncRate = cell.calls ? (cell.truncated / cell.calls * 100).toFixed(1) + '%' : '—';
                cell.parseFailRate = cell.calls ? (cell.parseFail / cell.calls * 100).toFixed(1) + '%' : '—';
                cell.avgPromptTokens = cell.promptTokens.length ? (cell.promptTokens.reduce(function (a, b) { return a + b; }, 0) / cell.promptTokens.length).toFixed(1) : null;
                cell.avgCompletionTokens = cell.completionTokens.length ? (cell.completionTokens.reduce(function (a, b) { return a + b; }, 0) / cell.completionTokens.length).toFixed(1) : null;
                out.cells[key] = cell;
            }
        }
    }
    writeFileSync(join(OUT_BASE, 'A', 'aggregate.json'), JSON.stringify(out, null, 2), 'utf-8');
    console.log('\n=== 阶段 A 结果 ===');
    console.log('L_K_M | 截断率 | parseFail率 | 平均输入token');
    Object.keys(out.cells).forEach(function (k) {
        var c = out.cells[k];
        console.log('  ' + k + ' | ' + c.truncRate + ' | ' + c.parseFailRate + ' | ' + c.avgPromptTokens);
    });
}

// ── 阶段 B：质量测量（安全区内）──
async function phaseB() {
    console.log('=== 阶段 B 质量测量 L=' + LS.join(',') + ' K=' + KS.join(',') + ' M=' + M_FOR_B + ' segs=' + SEGS + ' ===');
    var out = { M: M_FOR_B, cells: {} };
    for (var li = 0; li < LS.length; li++) {
        var L = LS[li];
        for (var ki = 0; ki < KS.length; ki++) {
            var K = KS[ki];
            var segs = buildCapacityCorpus({ L: L, K: K, segments: SEGS });
            var key = L + '_' + K;
            var dir = join(OUT_BASE, 'B', key);
            mkdirSync(dir, { recursive: true });
            var cell = { L: L, K: K, M: M_FOR_B, events: 0, parseFail: 0, yes: 0, no: 0, uncertain: 0, untested: 0, promptTokens: [], completionTokens: [] };
            for (var si = 0; si < segs.length; si++) {
                var seg = segs[si];
                var dp = join(dir, seg.id + '.json');
                if (existsSync(dp)) {
                    var prev = JSON.parse(readFileSync(dp, 'utf-8'));
                    mergeCell(cell, prev);
                    if (prev.promptTokens != null) cell.promptTokens.push(prev.promptTokens);
                    if (prev.completionTokens != null) cell.completionTokens.push(prev.completionTokens);
                    continue;
                }
                process.stdout.write('  [B][' + key + '][' + seg.id + '] ... ');
                var dialogue = seg.messages.map(function (m) { return ((m.role === 'user') ? '用户' : (m.name || '角色')) + '：' + m.mes; }).join('\n');
                var r = await resolveBatch(dialogue, seg.events.map(function (e) { return { idx: e.idx, eventText: e.eventText }; }), { temperature: 0.2, maxTokens: M_FOR_B });
                var segOut = { segId: seg.id, L: L, K: K, M: M_FOR_B, truncated: r.truncated, ok: r.ok, promptTokens: r.promptTokens, completionTokens: r.completionTokens, events: [] };
                if (r.promptTokens != null) cell.promptTokens.push(r.promptTokens);
                if (r.completionTokens != null) cell.completionTokens.push(r.completionTokens);
                var cellEv = 0, cellPF = 0;
                for (var ei = 0; ei < seg.events.length; ei++) {
                    var e = seg.events[ei];
                    var rr = r.results[ei] || {};
                    var evRec = { caseId: e.caseId, idx: e.idx, category: e.category, expectedNote: e.expectedNote || '', ok: rr.ok, parseFail: rr.parseFail || false, rewritten: rr.rewritten };
                    // judge 判定（盲评：只看重写文本 + expectedNote）
                    if (!evRec.parseFail && evRec.rewritten) {
                        var v;
                        try { v = await judgeEvent(evRec.rewritten, evRec.expectedNote); }
                        catch (e) { v = { verdict: 'untested', reason: 'judge 失败: ' + (e && e.message) }; }
                        evRec.verdict = v.verdict; evRec.judgeReason = v.reason;
                    } else {
                        evRec.verdict = 'untested';
                    }
                    segOut.events.push(evRec);
                }
                writeFileSync(dp, JSON.stringify(segOut, null, 2), 'utf-8');
                mergeCell(cell, segOut);
                console.log('ok=' + r.ok + ' truncated=' + r.truncated + ' → ' + summarizeVerdict(segOut));
            }
            cell.surviveRate = (cell.yes + cell.no + cell.uncertain) ? (cell.yes / (cell.yes + cell.no + cell.uncertain) * 100).toFixed(1) + '% (' + cell.yes + '/' + (cell.yes + cell.no + cell.uncertain) + ')' : '—';
            cell.avgPromptTokens = cell.promptTokens.length ? (cell.promptTokens.reduce(function (a, b) { return a + b; }, 0) / cell.promptTokens.length).toFixed(1) : null;
            cell.avgCompletionTokens = cell.completionTokens.length ? (cell.completionTokens.reduce(function (a, b) { return a + b; }, 0) / cell.completionTokens.length).toFixed(1) : null;
            out.cells[key] = cell;
        }
    }
    writeFileSync(join(OUT_BASE, 'B', 'aggregate.json'), JSON.stringify(out, null, 2), 'utf-8');
    console.log('\n=== 阶段 B 结果 ===');
    console.log('L_K | 存活率 | parseFail | yes/no/unc | avgIn/Out');
    Object.keys(out.cells).forEach(function (k) {
        var c = out.cells[k];
        console.log('  ' + k + ' | ' + c.surviveRate + ' | ' + c.parseFail + ' | ' + c.yes + '/' + c.no + '/' + c.uncertain + ' | ' + c.avgPromptTokens + '/' + c.avgCompletionTokens);
    });
}

function mergeCell(cell, segOut) {
    cell.events += segOut.events.length;
    segOut.events.forEach(function (ev) {
        if (ev.parseFail) cell.parseFail++;
        else if (ev.verdict === 'yes') cell.yes++;
        else if (ev.verdict === 'no') cell.no++;
        else if (ev.verdict === 'uncertain') cell.uncertain++;
        else cell.untested++;
    });
}
function summarizeVerdict(segOut) {
    var y = 0, n = 0, u = 0;
    segOut.events.forEach(function (ev) { if (ev.verdict === 'yes') y++; else if (ev.verdict === 'no') n++; else if (ev.verdict === 'uncertain') u++; });
    return 'yes=' + y + ' no=' + n + ' unc=' + u;
}

// 盲评 judge（同 run-resolver-batch 的 judgeEvent）
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

// ── 综合分析 ──
async function analyze() {
    var A = JSON.parse(readFileSync(join(OUT_BASE, 'A', 'aggregate.json'), 'utf-8'));
    var B = JSON.parse(readFileSync(join(OUT_BASE, 'B', 'aggregate.json'), 'utf-8'));
    var L = [];
    L.push('# Resolver 容量/质量两阶段综合分析');
    L.push('');
    L.push('## 阶段 A：容量探测（截断率，finish_reason=length）');
    L.push('| L_K_M | 截断率 | parseFail率 | 平均输入token | 平均输出token |');
    L.push('|---|---|---|---|---|');
    Object.keys(A.cells).forEach(function (k) {
        var c = A.cells[k];
        L.push('| ' + k + ' | ' + c.truncRate + ' | ' + c.parseFailRate + ' | ' + c.avgPromptTokens + ' | ' + c.avgCompletionTokens + ' |');
    });
    L.push('');
    L.push('## 阶段 B：质量测量（安全区内存活率）');
    L.push('| L_K | 存活率 | parseFail | yes/no/unc | avgIn/Out |');
    L.push('|---|---|---|---|---|');
    Object.keys(B.cells).forEach(function (k) {
        var c = B.cells[k];
        L.push('| ' + k + ' | ' + c.surviveRate + ' | ' + c.parseFail + ' | ' + c.yes + '/' + c.no + '/' + c.uncertain + ' | ' + c.avgPromptTokens + '/' + c.avgCompletionTokens + ' |');
    });
    L.push('');
    L.push('## 决策（预注册 §2.2/§3.2）');
    L.push('- 见 canonical §8.4 登记（执行者在数据落地后按规则给出）。');
    var outPath = join(OUT_BASE, 'decision.md');
    writeFileSync(outPath, withProvenanceHeader('capacity-quality', L.join('\n'), null, {
        fixturePath: join(__dirname, 'resolver-batch-corpus.js'),
        armPromptText: JSON.stringify({ plan: 'resolver-capacity-quality-plan', LS: LS, KS: KS, MS: MS, segs: SEGS }),
        split: 'dev',
    }), 'utf-8');
    console.log('decision: ' + outPath);
}

async function main() {
    mkdirSync(OUT_BASE, { recursive: true });
    if (PHASE === 'A') await phaseA();
    else if (PHASE === 'B') await phaseB();
    else if (PHASE === 'analyze') await analyze();
    else { console.error('用法: --phase A|B|analyze'); process.exit(1); }
}
main().catch(function (err) { console.error('\nFATAL:', err && err.stack || err); process.exit(1); });