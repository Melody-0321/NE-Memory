// run-modality-arms.js — 跑臂脚本（A0/B/C/D × dev/holdout modality 语料）
// 逐步解耦自 audit-modality-survival.js，但：多臂、多 run、字段/parse 指标落盘。
// 用法：node run-modality-arms.js [--corpus dev|holdout] [--arms base,B,C,D] [--dry]
//  - 反悔类(reversal)跑 RUN_REVERSAL=3 次；打趣/假设类跑 1 次。
//  - D 臂 = resolve-rewrite 二段式：抽取后跑 resolver pass，命中反转则重写 event。
//  - 输出：output/modality-eval/{corpus}/{arm}/{caseId}-{run}.json + aggregate.json
// 不改生产代码；arm C 的"final_status 必填"用本地规则判定记为 constraintViolation。

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { groupMessagesIntoTurns } from '../../src/core/engine/turn-segmenter.js';
import { chunkSegmentsForLLM, buildStmSummaryPrompt } from '../../src/core/engine/stm-pipeline.js';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';
import { applyModalityArm } from './modality-arm-prompt.js';
import { resolveEvent } from './modality-resolve-rewrite.js';
import { modalityEvalDev } from './modality-eval-dev.js';
import { modalityEvalHoldout } from './modality-eval-holdout.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

var RUN_REVERSAL = 3;
var DRY = process.argv.includes('--dry');
var corpus = process.argv.indexOf('--corpus') !== -1 ? process.argv[process.argv.indexOf('--corpus') + 1] : 'dev';
var armsArg = process.argv.indexOf('--arms') !== -1 ? process.argv[process.argv.indexOf('--arms') + 1] : 'base,B,C,D';
var ARMS = armsArg.split(',').map(function (a) { return a.trim(); });

var cases = corpus === 'holdout' ? modalityEvalHoldout : modalityEvalDev;
var OUT_BASE = join(__dirname, 'output', 'modality-eval', corpus);

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

function runsFor(c) {
    return (c.category === 'reversal') ? RUN_REVERSAL : 1;
}

// 臂 C 的 final_status 硬约束本地判定：reversal 事件指出 modality 但漏 final_status → 记违反
function checkConstraint(arm, c, parsed, event0) {
    if (arm !== 'C' || c.category !== 'reversal') return false;
    var mod = event0 && event0.modality;
    if (mod === 'reversal' && (event0.final_status === undefined || event0.final_status === null || !String(event0.final_status).trim())) {
        return true;
    }
    return false;
}

async function extractOne(arm, c, run) {
    var msgs = c.messages.map(function (m, i) { return { role: m.role, name: m.name, mes: m.mes, _absIdx: i }; });
    var turns = groupMessagesIntoTurns(msgs);
    var segments = [[0, 0]];
    var chunks = chunkSegmentsForLLM(segments, turns, 500);
    var seg0 = (chunks[0] && chunks[0][0]) || segments[0];
    var basePrompt = buildStmSummaryPrompt([seg0], turns, { content: {} }, null, 0.05);
    var system = applyModalityArm(basePrompt.system, arm);

    if (DRY) {
        return { arm: arm, run: run, caseId: c.id, category: c.category, explicit: c.explicit,
                 parseOk: false, eventText: null, modality: null, final_status: null, parseError: 'DRY', dry: true };
    }

    var content;
    try {
        content = await callChatRetry([{ role: 'system', content: system }, { role: 'user', content: basePrompt.user }], 0.2, 900);
    } catch (err) {
        return { arm: arm, run: run, caseId: c.id, category: c.category, explicit: c.explicit,
                 parseOk: false, eventText: null, modality: null, final_status: null, parseError: '抽取失败: ' + (err && err.message) };
    }
    var parsed = safeJsonParse(content);
    var event0 = parsed && parsed.events && parsed.events[0];
    var eventText = event0 && event0.event;
    if (!eventText) {
        return { arm: arm, run: run, caseId: c.id, category: c.category, explicit: c.explicit,
                 parseOk: false, eventText: null, modality: null, final_status: null, parseError: content ? content.slice(0, 120) : '(empty)' };
    }

    var out = {
        arm: arm, run: run, caseId: c.id, category: c.category, explicit: c.explicit,
        parseOk: true, eventText: eventText,
        modality: event0.modality || null,
        final_status: event0.final_status || null,
        constraintViolation: checkConstraint(arm, c, parsed, event0),
        original: content.slice(0, 400),
    };

    // ── D 臂：resolve-rewrite 二段式 ──
    if (arm === 'D') {
        process.stdout.write(' [resolve]');
        var rs;
        try { rs = await resolveEvent(c, eventText, { temperature: 0.2 }); }
        catch (e) { rs = { ok: false, error: 'resolver 异常: ' + (e && e.message), reversed: null, rewritten: null }; }
        out.resolve = rs;
        if (rs && rs.ok && rs.reversed && rs.rewritten) {
            out.eventText = rs.rewritten; // 重写后的文本即 judge 消费对象
        }
    }

    return out;
}

var ARMS_CATS = ['reversal', 'teasing', 'hypothetical'];

// 事件粒度（instance-level）：每次抽取算一个实例，parseOk 实例作为 judge 的候选项。
function aggregate(results) {
    var real = results.filter(function (r) { return !r.dry; });
    var agg = { corpus: corpus, arms: ARMS, byArmCat: {}, byArmExplicit: {}, constraintViolations: {} };
    ARMS.forEach(function (arm) {
        var armReal = real.filter(function (r) { return r.arm === arm; });
        var byCat = {};
        var byExp = { explicit: { instances: 0, parseOk: 0, parseFail: 0 }, implicit: { instances: 0, parseOk: 0, parseFail: 0 } };
        var vio = 0;
        ARMS_CATS.forEach(function (cat) {
            var catAll = armReal.filter(function (r) { return r.category === cat; });
            var catOk = catAll.filter(function (r) { return r.parseOk; });
            byCat[cat] = {
                instances: catAll.length,
                parseOk: catOk.length,
                parseFail: catAll.length - catOk.length,
                // 反悔类单条多 run：记录每条 case 至少一次 parseOk 的稳定条数（供事件粒度存活判定的分母）
                distinctCases: new Set(catOk.map(function (r) { return r.caseId; })).size,
            };
            if (cat === 'reversal') {
                var expAll = armReal.filter(function (r) { return r.category === 'reversal'; });
                expAll.forEach(function (r) {
                    var k = r.explicit ? 'explicit' : 'implicit';
                    byExp[k].instances++;
                    r.parseOk ? byExp[k].parseOk++ : byExp[k].parseFail++;
                    if (r.constraintViolation) vio++;
                });
            }
        });
        agg.byArmCat[arm] = byCat;
        agg.byArmExplicit[arm] = byExp;
        agg.constraintViolations[arm] = vio;
    });
    return agg;
}

async function main() {
    if (!LLM.url || !LLM.model) { console.error('config.json 缺少 judge_v4'); process.exit(1); }
    console.log('=== run-modality-arms === corpus=' + corpus + ' arms=' + ARMS.join(',') +
        ' cases=' + cases.length + (DRY ? ' (DRY)' : ''));

    var results = [];
    for (var ai = 0; ai < ARMS.length; ai++) {
        var arm = ARMS[ai];
        for (var ci = 0; ci < cases.length; ci++) {
            var c = cases[ci];
            var n = runsFor(c);
            for (var ri = 0; ri < n; ri++) {
                if (!DRY) { process.stdout.write('  [' + arm + '][' + c.id + '] r' + ri + ' ... '); }
                var r = await extractOne(arm, c, ri);
                if (!DRY) console.log(r.parseOk ? 'ok' : 'PARSE_FAIL ' + (r.parseError || ''));
                results.push(r);
            }
        }
    }

    if (DRY) {
        console.log('DRY run counts per arm:');
        ARMS.forEach(function (arm) {
            var rows = results.filter(function (r) { return r.arm === arm; });
            console.log('  ' + arm + ': total expositions=' + rows.length);
        });
        return;
    }

    mkdirSync(OUT_BASE, { recursive: true });
    // 逐条落盘
    results.forEach(function (r) {
        if (r.dry) return;
        var dir = join(OUT_BASE, r.arm);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, r.caseId + '-r' + r.run + '.json'), JSON.stringify(r, null, 2), 'utf-8');
        delete r.original; // 汇总文件去重，保持轻量
    });
    // aggregate
    var agg = aggregate(results);
    writeFileSync(join(OUT_BASE, 'aggregate.json'), JSON.stringify(agg, null, 2), 'utf-8');
    console.log('\n=== aggregate written: ' + join(OUT_BASE, 'aggregate.json'));
}

main().catch(function (err) { console.error('\nFATAL:', err && err.stack || err); process.exit(1); });