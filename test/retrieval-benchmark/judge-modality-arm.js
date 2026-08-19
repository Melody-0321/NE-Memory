// judge-modality-arm.js — 盲评 eventText（检索只消费文本，判定字段与臂名对 judge 隐藏）
// 输入：output/modality-eval/{corpus}/{arm}/*.json（parseOk 实例）
// judge 只看「原始对话 + GT 情态类别 + expectedNote + eventText」，返回 yes/no/uncertain。
// 输出：output/modality-eval/{corpus}/verdicts.json + verdicts-summary.json
// 用法：node judge-modality-arm.js [--corpus dev|holdout]

import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { groupMessagesIntoTurns, formatTurnsText } from '../../src/core/engine/turn-segmenter.js';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';
import { modalityEvalDev } from './modality-eval-dev.js';
import { modalityEvalHoldout } from './modality-eval-holdout.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

var corpus = process.argv.indexOf('--corpus') !== -1 ? process.argv[process.argv.indexOf('--corpus') + 1] : 'dev';
var cases = corpus === 'holdout' ? modalityEvalHoldout : modalityEvalDev;
var caseById = {};
cases.forEach(function (c) { caseById[c.id] = c; });

var OUT_BASE = join(__dirname, 'output', 'modality-eval', corpus);
var ARMS = ['base', 'B', 'C', 'D', 'D-prod'];
var armsArg = process.argv.indexOf('--arms') !== -1 ? process.argv[process.argv.indexOf('--arms') + 1] : null;
if (armsArg) ARMS = armsArg.split(',').map(function (s) { return s.trim(); });

function callChat(messages, temperature, maxTokens) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 60000);
    return fetch(LLM.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (LLM.key || '') },
        body: JSON.stringify({ model: LLM.model, messages: messages, temperature: temperature, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
        signal: controller.signal
    }).then(function (resp) { clearTimeout(timer); if (!resp.ok) throw new Error('LLM HTTP ' + resp.status); return resp.json(); })
      .then(function (data) {
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('LLM empty content');
        return content;
    }, function (err) { clearTimeout(timer); throw err; });
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

// 盲评 judge 消息：只给 eventText，隐藏 arm 与 modality/final_status 字段
function buildJudgeMessage(c, eventText) {
    var rawText = formatTurnsText(c._turns);
    return {
        system: '你是情态存活率审计员。只返回 JSON。',
        user: [
            '原始对话：', rawText, '',
            '该对话应保留的情态类别：' + c.categoryLabel,
            '应保留的语义说明：' + c.expectedNote, '',
            '抽取出的事件摘要：', '"' + eventText + '"', '',
            '判定该摘要是否保留了上述情态语义（包括否定/反悔/玩笑/假设/未完成等表态的"真值"）。注意：',
            '- 若摘要把这层写成无修饰的事实，判定 no。',
            '- 若摘要清楚保留，判定 yes。',
            '- 若不确定，判定 uncertain。', '',
            '返回 JSON：{"survived":"yes|no|uncertain","reason":"一句话原因"}',
        ].join('\n'),
    };
}

async function judgeEvent(c, eventText) {
    var jm = buildJudgeMessage(c, eventText);
    var raw = await callChatRetry([{ role: 'system', content: jm.system }, { role: 'user', content: jm.user }], 0, 500);
    var jp = safeJsonParse(raw);
    if (!jp || !jp.survived) return { verdict: 'untested', reason: null, raw: raw ? raw.slice(0, 200) : '(empty)' };
    return { verdict: jp.survived, reason: jp.reason || '' };
}

function loadInstances() {
    var instances = [];
    ARMS.forEach(function (arm) {
        var dir = join(OUT_BASE, arm);
        if (!existsSync(dir)) return;
        var files = readdirSync(dir).filter(function (f) { return f.endsWith('.json') && f.indexOf('-r') !== -1; });
        files.forEach(function (f) {
            var d = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
            if (!d.parseOk || !d.eventText) return;
            instances.push(d);
        });
    });
    return instances;
}

function catLabel(c) { return c && c.categoryLabel || '未知'; }

function summarize(verdicts) {
    // 每个 (arm, case) 的多数票：parseOk 实例 ≥1 且多数 yes → 存活；多数 no → 丢失；平/全 uncertain → 不确定
    var byCase = {};
    verdicts.forEach(function (v) {
        var key = v.arm + '|' + v.caseId;
        if (!byCase[key]) byCase[key] = { arm: v.arm, caseId: v.caseId, counts: { yes: 0, no: 0, uncertain: 0, untested: 0 } };
        byCase[key].counts[v.verdict]++;
    });
    return Object.keys(byCase).map(function (k) {
        var row = byCase[k];
        var yes = row.counts.yes, no = row.counts.no, unc = row.counts.uncertain;
        var survived;
        if (yes === 0 && no === 0) survived = unc > 0 ? 'uncertain' : 'untested';
        else if (yes > no) survived = 'yes';
        else if (no > yes) survived = 'no';
        else survived = unc > 0 ? 'uncertain' : (yes === 0 ? 'untested' : 'tie');
        return { arm: row.arm, caseId: row.caseId, category: (caseById[row.caseId] || {}).category,
                 explicit: (caseById[row.caseId] || {}).explicit, survived: survived, counts: row.counts };
    });
}

function buildReport(summary) {
    var L = [];
    L.push('# Modality 臂 · 盲评存活率（corpus=' + corpus + '）');
    L.push('- Judge 模型：' + LLM.model + '（temperature=0，盲评文本，隐藏臂名/字段）');
    L.push('- 口径：uncertain/untested 计入未存活（保守）\n');
    L.push('## 1. 每臂存活率');
    L.push('| 臂 | 存活 | 判定可达 | 存活率 | 反悔 | 打趣 | 假设 |');
    L.push('|---|---|---|---|---|---|---|');
    ARMS.forEach(function (arm) {
        var rows = summary.filter(function (r) { return r.arm === arm; });
        var alive = rows.filter(function (r) { return r.survived === 'yes'; }).length;
        var judgeable = rows.filter(function (r) { return r.survived !== 'untested'; }).length;
        var cells = [arm, alive, judgeable, (judgeable ? (alive / judgeable * 100).toFixed(1) + '%' : '—')];
        ['reversal', 'teasing', 'hypothetical'].forEach(function (cat) {
            var cr = rows.filter(function (r) { return r.category === cat; });
            var ca = cr.filter(function (r) { return r.survived === 'yes'; }).length;
            cells.push(cr.length ? (ca / cr.length * 100).toFixed(0) + '%' : '—');
        });
        L.push('| ' + cells.join(' | ') + ' |');
    });
    L.push('');
    L.push('## 2. 逐条矩阵');
    L.push('| case | 类别 | 显式 | ' + ARMS.join(' | ') + ' |');
    L.push('|---|---|---|---' + ARMS.map(function () { return '---|'; }).join('') + '');
    var order = cases.map(function (c) { return c.id; });
    order.forEach(function (id) {
        var cats = (caseById[id] || {}).category, exp = (caseById[id] || {}).explicit;
        var row = [id, catLabel(caseById[id]), exp === true ? '显式' : (exp === false ? '隐式' : '—')];
        var cells = {};
        summary.forEach(function (r) { if (r.caseId === id) cells[r.arm] = r.survived; });
        ARMS.forEach(function (arm) { row.push(cells[arm] || '—'); });
        L.push('| ' + row.join(' | ') + ' |');
    });
    L.push('');
    return L.join('\n');
}

async function main() {
    var instances = loadInstances();
    if (instances.length === 0) { console.error('无 parseOk 实例，先运行 run-modality-arms.js'); process.exit(1); }
    console.log('=== judge-modality-arm corpus=' + corpus + ' instances=' + instances.length);
    var verdicts = [];
    for (var i = 0; i < instances.length; i++) {
        var d = instances[i];
        var c = caseById[d.caseId];
        if (!c) continue;
        var jc = c; jc._turns = jc._turns || null;
        var turns = groupMessagesIntoTurns(c.messages.map(function (m, mi) { return { role: m.role, name: m.name, mes: m.mes, _absIdx: mi }; }));
        c._turns = turns;
        process.stdout.write('  [' + d.arm + '][' + d.caseId + ']r' + d.run + ' ... ');
        var res;
        try { res = await judgeEvent(c, d.eventText); }
        catch (err) { res = { verdict: 'untested', reason: 'judge失败: ' + (err && err.message) }; }
        verdicts.push({ arm: d.arm, caseId: d.caseId, run: d.run, category: d.category, explicit: d.explicit, verdict: res.verdict, reason: res.reason });
        console.log(res.verdict + (res.reason ? ' — ' + res.reason : ''));
    }

    mkdirSync(OUT_BASE, { recursive: true });
    writeFileSync(join(OUT_BASE, 'verdicts.json'), JSON.stringify(verdicts, null, 2), 'utf-8');
    var summary = summarize(verdicts);
    writeFileSync(join(OUT_BASE, 'verdicts-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    writeFileSync(join(OUT_BASE, 'verdicts-report.md'), buildReport(summary), 'utf-8');
    console.log('\n=== verdicts written: ' + join(OUT_BASE, 'verdicts.json'));
}

main().catch(function (err) { console.error('\nFATAL:', err && err.stack || err); process.exit(1); });