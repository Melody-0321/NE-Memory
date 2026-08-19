// judge-claim-retention.js — 初始主张保留度回判（resolver-capacity-quality-plan DoD 补盲）
// 背景：B 阶段 judge 只验证了"最终态是否存活"（canonical §8.4），未验证
//   resolver 重写是否仍保留"初始主张"（如"发誓戒烟"）。本脚本复用 B 阶段 dump：
//   对每条 rewritten，问 judge"初始主张是否仍可从文本中回推"。
// 零 resolver 调用：只读 dump + LLM judge（约 79 次调用，deepseek-v4-flash@0）。
// 用法：
//   node judge-claim-retention.js [--out <name>]
// 输出：output/capacity-quality/claim-retention.md + 屏幕汇总
// 登记：canonical §8.4 补"初始主张保留度"小节（执行者按数据落地）。

import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';
import { modalityEvalDev } from './modality-eval-dev.js';
import { withProvenanceHeader } from './report-provenance.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

var OUT_BASE = join(__dirname, 'output', 'capacity-quality');
var B_DIR = join(OUT_BASE, 'B');

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

// 从语料取该 case 的"初始主张"：第一条 assistant 消息（修正 T02/H03/H05/H07 messages[0] 是 user 的坑）
function getInitialClaim(caseId) {
    var c = modalityEvalDev.find(function (x) { return x.id === caseId; });
    if (!c) return null;
    var msg = (c.messages || []).find(function (m) { return m.role === 'assistant'; }) || c.messages[0] || null;
    return msg ? msg.mes : null;
}

// 盲评 judge：给定 rewritten + 初始主张 + expectedNote，判定初始主张是否仍保留
async function judgeRetention(rewritten, initialClaim, expectedNote, category) {
    var user = [
        '下面是抽取后重写的事件摘要，以及它的"初始主张"（对话早期对该主题的起始表述）。',
        '--- 事件摘要（resolver 重写后）---',
        '"' + rewritten + '"',
        '--- 初始主张（对话早期该主题的起始表述）---',
        '"' + initialClaim + '"',
        '--- 类别 ---',
        category,
        '--- 应保留的情态语义说明 ---',
        expectedNote,
        '---',
        '判断：从事件摘要中，读者能否回推出"初始主张"？（不要求原文逐字，允许同义改写）',
        '例：初始主张"发誓戒烟"，摘要"先发誓戒烟，最终又抽了" → retained=yes（初始主张在）。',
        '    若摘要只写"戒烟失败"未提及曾发誓 → retained=no（初始主张丢失）。',
        '    若类别为打趣/假设（无反悔），摘要保持原意（未改写成事实）即视为初始主张保留。',
        '若不确定 → retained=uncertain。',
        '输出严格 JSON：{"retained":"yes|no|uncertain","reason":"一句话原因"}',
    ].join('\n');
    var raw = await callChatRetry([
        { role: 'system', content: '你是情态保留度审计员。只返回 JSON。' },
        { role: 'user', content: user },
    ], 0, 300);
    var p = safeJsonParse(raw);
    // 宽容解析：LLM 偶发在 reason 里塞嵌套引号导致 safeJsonParse 截断，此时按 raw 子串判定
    if (!p || !p.retained) {
        var yesHit = /"retained"\s*:\s*"yes"/.test(raw || '');
        var noHit = /"retained"\s*:\s*"no"/.test(raw || '');
        if (yesHit) return { verdict: 'yes', reason: '(宽容解析) ' + (raw ? raw.slice(0, 100) : '') };
        if (noHit) return { verdict: 'no', reason: '(宽容解析) ' + (raw ? raw.slice(0, 100) : '') };
        return { verdict: 'untested', reason: raw ? raw.slice(0, 100) : '(empty)' };
    }
    return { verdict: p.retained, reason: (p.reason || '') };
}

async function collectEvents() {
    var events = [];
    if (!existsSync(B_DIR)) { console.error('B 阶段目录不存在: ' + B_DIR); process.exit(1); }
    var combos = readdirSync(B_DIR).filter(function (f) {
        var full = join(B_DIR, f);
        try {
            if (!existsSync(full) || !readdirSync(full).some(function (x) { return x.endsWith('.json') && x.indexOf('aggregate') === -1; })) return false;
        } catch (e) { return false; }
        return true;
    });
    combos.forEach(function (combo) {
        var dir = join(B_DIR, combo);
        readdirSync(dir).filter(function (f) { return f.endsWith('.json') && f.indexOf('aggregate') === -1; }).forEach(function (f) {
            var seg = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
            (seg.events || []).forEach(function (ev) {
                if (!ev.parseFail && ev.rewritten) {
                    events.push({ L: seg.L, K: seg.K, caseId: ev.caseId, category: ev.category, rewritten: ev.rewritten, expectedNote: ev.expectedNote || '', initialClaim: getInitialClaim(ev.caseId) });
                }
            });
        });
    });
    return events;
}

async function main() {
    var outName = 'claim-retention';
    var evs = await collectEvents();
    console.log('待回判事件: ' + evs.length);

    var outDir = join(OUT_BASE, 'retention');
    mkdirSync(outDir, { recursive: true });

    var results = { byCategory: {}, byL: {}, byK: {}, all: { yes: 0, no: 0, uncertain: 0, untested: 0 } };
    function initBucket(b, key) { if (!b[key]) b[key] = { yes: 0, no: 0, uncertain: 0, untested: 0 }; return b[key]; }

    for (var i = 0; i < evs.length; i++) {
        var ev = evs[i];
        var dp = join(outDir, ev.caseId + '.json');
        var rec;
        if (existsSync(dp)) {
            rec = JSON.parse(readFileSync(dp, 'utf-8'));
        } else {
            process.stdout.write('  [' + ev.caseId + '|' + ev.category + '] ... ');
            var v;
            try { v = await judgeRetention(ev.rewritten, ev.initialClaim, ev.expectedNote, ev.category); }
            catch (e) { v = { verdict: 'untested', reason: 'judge 失败: ' + (e && e.message) }; }
            rec = { caseId: ev.caseId, L: ev.L, K: ev.K, category: ev.category, rewritten: ev.rewritten, initialClaim: ev.initialClaim, verdict: v.verdict, reason: v.reason };
            writeFileSync(dp, JSON.stringify(rec, null, 2), 'utf-8');
            console.log(v.verdict + (v.reason ? ' — ' + v.reason : ''));
        }
        ['all', 'byCategory:' + ev.category, 'byL:' + ev.L, 'byK:' + ev.K].forEach(function (path) {
            var b = path.indexOf(':') !== -1
                ? initBucket(results[path.split(':')[0]], path.split(':')[1])
                : results.all;
            if (rec.verdict === 'yes') b.yes++; else if (rec.verdict === 'no') b.no++;
            else if (rec.verdict === 'uncertain') b.uncertain++; else b.untested++;
        });
    }

    // 报告
    var L = [];
    L.push('# Resolver 初始主张保留度回判');
    L.push('');
    L.push('- 来源：复用 `output/capacity-quality/B/` 阶段 B dump（rewritten），' + evs.length + ' 条非 parseFail 事件');
    L.push('- judge：deepseek-v4-flash@0，只看 rewritten + 初始主张（首条 assistant 消息）+ expectedNote');
    L.push('- 判定：从摘要能否回推初始主张（允许同义改写）；打趣/假设无反悔，保持原意即保留');
    L.push('');
    L.push('## 总保留度');
    L.push(fmtRow(results.all, 'ALL'));
    L.push('');
    L.push('## 按类别');
    Object.keys(results.byCategory).forEach(function (c) { L.push(fmtRow(results.byCategory[c], c)); });
    L.push('');
    L.push('## 按 L（事件长度档）');
    Object.keys(results.byL).sort().forEach(function (k) { L.push(fmtRow(results.byL[k], 'L=' + k)); });
    L.push('');
    L.push('## 按 K（条数）');
    Object.keys(results.byK).sort().forEach(function (k) { L.push(fmtRow(results.byK[k], 'K=' + k)); });
    L.push('');
    L.push('## 结论与登记');
    L.push('- 数据落地后按规则给出结论，登记 canonical §8.4。');

    var outPath = join(OUT_BASE, outName + '.md');
    writeFileSync(outPath, withProvenanceHeader('capacity-quality-retention', L.join('\n'), null, {
        fixturePath: join(__dirname, 'modality-eval-dev.js'),
        armPromptText: JSON.stringify({ plan: 'claim-retention', source: 'capacity-quality/B', judge: 'deepseek-v4-flash@0' }),
        split: 'dev',
    }), 'utf-8');
    console.log('\n=== 初始主张保留度 ===');
    console.log(fmtRow(results.all, 'ALL'));
    Object.keys(results.byCategory).forEach(function (c) { console.log(fmtRow(results.byCategory[c], c)); });
    console.log('report: ' + outPath);
}

function fmtRow(b, label) {
    var judgeable = b.yes + b.no + b.uncertain;
    var rate = judgeable ? (b.yes / judgeable * 100).toFixed(1) + '% (' + b.yes + '/' + judgeable + ')' : '—';
    return '| ' + label + ' | ' + rate + ' | no=' + b.no + ' unc=' + b.uncertain + ' untested=' + b.untested + ' |';
}

main().catch(function (err) { console.error('\nFATAL:', err && err.stack || err); process.exit(1); });
