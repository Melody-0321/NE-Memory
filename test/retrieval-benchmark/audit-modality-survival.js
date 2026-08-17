// audit-modality-survival.js — T1 抽取 modality 存活率审计
//
// 目标：测 live 抽取管道把带情态（打趣/假设/否定反悔）的对话压成 event 摘要时，
// 情态语义类别的存活比例。存活率低 → 坐实"摘要洗掉差异信息"假设。
//
// 设计（见 .trae/documents/retrieval-quality-test-plan.md T1）：
//  1. 用 live 抽取 prompt 的离线镜像（重建自 stm-pipeline.js L402-465）抽 event。
//  2. 用 LLM-as-Judge（config.judge_v4, temperature=0）判定情态是否存活。
//  3. 保守口径：judge 的 uncertain 计入未存活；解析失败重试 1 次后记 untested。
//
// Run: node test/retrieval-benchmark/audit-modality-survival.js
//
// 注意：本脚本不修改任何生产代码。抽取 prompt 直接 import 生产函数
//      buildStmSummaryPrompt（stm-pipeline.js，已导出），因此测的是实时的
//      产品行为——prompt 修复后重跑本脚本即得修复前后对照。

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { groupMessagesIntoTurns, formatTurnsText } from '../../src/core/engine/turn-segmenter.js';
import { chunkSegmentsForLLM, buildStmSummaryPrompt } from '../../src/core/engine/stm-pipeline.js';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';
import { modalityCases } from './modality-fixture.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };
var OUT_DIR = join(__dirname, 'output');
var OUT_FILE = join(OUT_DIR, 'modality-survival.md');

// ─── 助手：离线 OpenAI-compatible chat 调用（照 benchmark-llm-judge.js 模式）───
function callChat(messages, temperature, maxTokens) {
    return fetch(LLM.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (LLM.key || '') },
        body: JSON.stringify({
            model: LLM.model,
            messages: messages,
            temperature: temperature,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' }
        })
    }).then(function (resp) {
        if (!resp.ok) throw new Error('LLM HTTP ' + resp.status);
        return resp.json();
    }).then(function (data) {
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('LLM empty content');
        return content;
    });
}

function callChatRetry(messages, temperature, maxTokens, maxAttempts) {
    var attempt = 0;
    var limit = maxAttempts || 2;
    function run() {
        return callChat(messages, temperature, maxTokens).catch(function (err) {
            if (attempt < limit) { attempt++; console.warn('  LLM retry:', err && err.message); return run(); }
            throw err;
        });
    }
    return run();
}

// ─── Judge：判定情态语义是否在摘要中存活 ───
function buildJudgeMessage(c) {
    var rawText = formatTurnsText(c._turns);
    var user = [
        '原始对话：',
        rawText,
        '',
        '该对话应保留的情态类别：' + c.categoryLabel,
        '应保留的语义说明：' + c.expectedNote,
        '',
        '抽取出的事件摘要：',
        '"' + c.eventText + '"',
        '',
        '判定该摘要是否保留了上述情态语义（包括否定、反悔、玩笑、假设、未完成等表态的"真值"）。注意：',
        '- 若摘要把这层写成无修饰的事实（如"安然要搬去海边"而原文是"开玩笑要搬"），判定 no。',
        '- 若摘要清楚保留（如"安然开玩笑说要搬走并非真要搬"），判定 yes。',
        '- 若不确定，判定 uncertain。',
        '',
        '返回 JSON：{"survived":"yes|no|uncertain","reason":"一句话原因"}'
    ].join('\n');
    return { system: '你是检索质量审计员。只返回 JSON。', user: user };
}

// ─── 主流程 ───
async function runCase(c) {
    var msgs = c.messages.map(function (m, i) {
        return { role: m.role, name: m.name, mes: m.mes, _absIdx: i };
    });
    var turns = groupMessagesIntoTurns(msgs);
    c._turns = turns;
    var segments = [[0, 0]];
    var chunks = chunkSegmentsForLLM(segments, turns, 500);
    var seg0 = (chunks[0] && chunks[0][0]) || segments[0];
    var prompt = buildStmSummaryPrompt([seg0], turns, { content: {} }, null, 0.05);

    // 抽取
    var content;
    try {
        content = await callChatRetry([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ], 0.2, 800);
    } catch (err) {
        return { c: c, eventText: null, parseError: '抽取失败: ' + (err && err.message), verdict: 'untested' };
    }
    var parsed = safeJsonParse(content);
    var eventText = parsed && parsed.events && parsed.events[0] && parsed.events[0].event;
    if (!eventText) {
        return { c: c, eventText: null, parseError: content ? content.slice(0, 120) : '(empty)', verdict: 'untested' };
    }
    c.eventText = eventText;

    // Judge
    var jm = buildJudgeMessage(c);
    var judgeRaw;
    try {
        judgeRaw = await callChatRetry([
            { role: 'system', content: jm.system },
            { role: 'user', content: jm.user }
        ], 0, 400);
    } catch (err) {
        return { c: c, eventText: eventText, parseError: '判定失败: ' + (err && err.message), verdict: 'untested' };
    }
    var jp = safeJsonParse(judgeRaw);
    if (!jp || !jp.survived) {
        return { c: c, eventText: eventText, judgeRaw: judgeRaw ? judgeRaw.slice(0, 200) : '(empty)', verdict: 'untested' };
    }
    return { c: c, eventText: eventText, verdict: jp.survived, reason: jp.reason || '' };
}

function esc(t) {
    return String(t == null ? '' : t).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '\n\n');
}

// ─── 汇总报告 ───
function buildReport(results) {
    var yes = results.filter(function (r) { return r.verdict === 'yes'; }).length;
    var no = results.filter(function (r) { return r.verdict === 'no'; }).length;
    var survived = yes;
    var judgedTotal = results.length;
    var survivalRate = judgedTotal ? (survived / judgedTotal * 100) : 0;

    var cats = {};
    results.forEach(function (r) {
        var cat = r.c.category;
        if (!cats[cat]) cats[cat] = { total: 0, yes: 0, items: [] };
        cats[cat].total++;
        if (r.verdict === 'yes') cats[cat].yes++;
        cats[cat].items.push(r);
    });

    var md = [];
    md.push('# T1 — 抽取 Modality 存活率审计');
    md.push('**Generated**: ' + new Date().toISOString().slice(0, 19));
    md.push('**Judge 模型**: ' + LLM.model + ' (抽取 temperature=0.2, judge temperature=0)');
    md.push('**判据**: 总体存活率 <70% → 触发抽取修复；prompt 修复后仍 <80% → schema 级');
    md.push('**保守口径**: uncertain / untested 计入未存活。\n');

    md.push('## 1. 总览');
    md.push('| 指标 | 值 |');
    md.push('|---|---|');
    md.push('| 样本数 | ' + results.length + ' |');
    md.push('| 情态存活 (yes) | ' + yes + ' |');
    md.push('| 情态丢失 (no) | ' + no + ' |');
    md.push('| uncertain / untested | ' + (results.length - yes - no) + ' |');
    md.push('| **保守口径存活率** | **' + survivalRate.toFixed(1) + '%** |\n');

    md.push('## 2. 分类别');
    md.push('| 类别 | 存活 | 总数 | 存活率 |');
    md.push('|---|---|---|---|');
    Object.keys(cats).forEach(function (cat) {
        var label = cats[cat].items[0].c.categoryLabel;
        md.push('| ' + label + ' | ' + cats[cat].yes + ' | ' + cats[cat].total + ' | ' +
            (cats[cat].total ? (cats[cat].yes / cats[cat].total * 100).toFixed(0) : '—') + '% |');
    });
    md.push('');

    md.push('## 3. 逐条明细');
    results.forEach(function (r) {
        md.push('### ' + r.c.id + ' (' + r.c.categoryLabel + ')');
        md.push('**Ground-truth**: ' + r.c.expectedNote);
        md.push('');
        md.push('**原始对话**:\n\n' + esc(formatTurnsText(r.c._turns)));
        md.push('');
        if (r.eventText) {
            md.push('**抽取摘要**: ' + esc(r.eventText) + '\n');
        } else {
            md.push('**抽取摘要**: *(解析失败)* ' + esc(r.parseError || '') + '\n');
        }
        md.push('**判定**: **' + r.verdict + '**' + (r.reason ? ' — ' + r.reason : '') + '\n');
        md.push('---');
    });

    md.push('');
    md.push('## 4. 结论');
    md.push('总体存活率 **' + survivalRate.toFixed(1) + '%**，' +
        (survivalRate < 70
            ? '**低于判据 70% → 触发抽取修复**（先 prompt 级，再验证；若仍 <80% 升 schema 级）。'
            : '高于等于判据 70%，当前不触发。') + '\n');
    return md.join('\n');
}

async function main() {
    if (!LLM.url || !LLM.model) {
        console.error('config.json 缺少 judge_v4 (抽取/判定 LLM) 配置');
        process.exit(1);
    }
    console.log('=== T1 Modality Survival Audit ===');
    console.log('LLM: ' + LLM.model + ' | cases=' + modalityCases.length + '\n');

    var results = [];
    for (var i = 0; i < modalityCases.length; i++) {
        var c = modalityCases[i];
        process.stdout.write('  [' + (i + 1) + '/' + modalityCases.length + '] ' + c.id + ' (' + c.categoryLabel + ') ... ');
        var r = await runCase(c);
        results.push(r);
        console.log(r.verdict + (r.reason ? ' — ' + r.reason : ''));
    }

    mkdirSync(OUT_DIR, { recursive: true });
    var report = buildReport(results);
    writeFileSync(OUT_FILE, report, 'utf-8');

    var yes = results.filter(function (r) { return r.verdict === 'yes'; }).length;
    console.log('\n=== Done: ' + yes + '/' + results.length + ' survived (conservative) ===');
    console.log('Report: ' + OUT_FILE);
}

main().catch(function (err) {
    console.error('\nFATAL:', err && err.stack || err);
    process.exit(1);
});