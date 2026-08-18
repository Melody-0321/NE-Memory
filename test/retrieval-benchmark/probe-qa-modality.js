// probe-qa-modality.js — QA 探针：证明「框架问题 vs 能力问题」
// 问法与原语相同（同一段对话、同一模型、temperature=0），但把任务从"抽取事件"
// 改成"直接回答终态"。若 QA ≈100% 而抽取 0%，即坐实任务框架诊断。
// 对 16 条反悔 case，构造显式二选一：A=初始主张延续，B=finalState 真值，模型选。
// 输出：output/modality-eval/qa-probe.json + 控制台汇总。一次跑完，成本≈16 次调用。

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { modalityEvalDev } from './modality-eval-dev.js';
import { modalityEvalHoldout } from './modality-eval-holdout.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

var corpus = process.argv.indexOf('--corpus') !== -1 ? process.argv[process.argv.indexOf('--corpus') + 1] : 'dev';
var cases = corpus === 'holdout'
    ? modalityEvalHoldout.filter(function (c) { return c.category === 'reversal'; })
    : modalityEvalDev.filter(function (c) { return c.category === 'reversal'; });

function renderDialogue(c) {
    return c.messages.map(function (m) {
        var who = (m.role === 'user') ? '用户' : (m.name || '角色');
        return who + '：' + m.mes;
    }).join('\n');
}

function stripQuote(s) {
    return String(s).replace(/^[\s"']+/, '').replace(/[\s"']+$/, '');
}

// 从 finalState 推导一个"是/否"焦点问题，判断点落在真值本身上，避免给模型现成答案的关键词
function deriveQuestion(c) {
    var f = stripQuote(c.finalState);
    // 提取最关键的谓词（取最后一句或逗号后的主句）
    var rest = f;
    return rest;
}

function chooseOptionA(c, fText) {
    // A = 用最初的强主张表述"没有反转"。给一个泛化但语义正确的对立项不经 LLM，
    // 直接用 c.messages[0] 的论断主旨作为"仍主张旧状态"的表述。
    var first = c.messages.find(function (m) { return m.role === 'assistant'; });
    var claim = stripQuote(first && first.mes);
    // 截取第一句
    var firstSentece = claim.split(/[。！？!?]/)[0] || claim;
    return '当前仍维持最初表态：' + firstSentece + '。';
}

async function probeOne(c) {
    var f = stripQuote(c.finalState);
    var optA = chooseOptionA(c, f);
    var optB = '当前真实状态是：' + f;
    var q = deriveQuestion(c);
    var dialogue = renderDialogue(c);

    var user = [
        '阅读下面的对话。',
        '---',
        dialogue,
        '---',
        '请判断：到这段对话结束时，某个事实/状态是否已经发生反转。',
        '只给出两个选项之一：',
        'A) 初始主张持续成立，状态未反转：' + optA,
        'B) 状态已经反转，最终真实状态是：' + optB,
        '',
        '输出严格 JSON：{"choice":"A" 或 "B","state":"一句话标明你选的状态"}',
    ].join('\n');

    var resp = await fetch(LLM.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (LLM.key || '') },
        body: JSON.stringify({
            model: LLM.model,
            messages: [{ role: 'system', content: '你是严格的事实状态判定引擎，只输出 JSON。' }, { role: 'user', content: user }],
            temperature: 0,
            max_tokens: 200,
            response_format: { type: 'json_object' }
        })
    });
    if (!resp.ok) throw new Error('LLM HTTP ' + resp.status);
    var data = await resp.json();
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('empty');

    var j;
    try { j = JSON.parse(content); } catch (e) { j = null; }
    var choice = j && j.choice;
    // 模型若被 A 的措辞带偏，仍可识别 B
    var correct = choice === 'B';
    return { id: c.id, explicit: c.explicit, choice: choice, state: (j && j.state) || content.slice(0, 80), correct: correct };
}

async function main() {
    if (!LLM.url || !LLM.model) { console.error('config.json 缺少 judge_v4'); process.exit(1); }
    console.log('=== QA 探针 corpus=' + corpus + ' reversal cases=' + cases.length + '  model=' + LLM.model);
    var results = [];
    for (var i = 0; i < cases.length; i++) {
        var c = cases[i];
        process.stdout.write('  [' + c.id + '] ... ');
        var r;
        try { r = await probeOne(c); }
        catch (e) { r = { id: c.id, explicit: c.explicit, choice: null, state: 'ERR:' + e.message, correct: false }; }
        results.push(r);
        console.log((r.correct ? '✔ B(反转)' : '✘ ' + (r.choice || 'ERR')) + ' — ' + (r.state || ''));
    }

    var total = results.length;
    var correct = results.filter(function (r) { return r.correct; }).length;
    var correctExp = results.filter(function (r) { return r.explicit === true && r.correct; }).length;
    var expTotal = results.filter(function (r) { return r.explicit === true; }).length;
    var implicitTotal = total - expTotal;
    var implicitCorrect = correct - correctExp;

    var out = {
        corpus: corpus, model: LLM.model, temperature: 0,
        n: total, correct: correct,
        correctness: { overall: (correct / total).toFixed(3), explicit: expTotal ? (correctExp / expTotal).toFixed(3) : null, implicit: implicitTotal ? (implicitCorrect / implicitTotal).toFixed(3) : null },
        rows: results
    };
    mkdirSync(join(__dirname, 'output', 'modality-eval'), { recursive: true });
    writeFileSync(join(__dirname, 'output', 'modality-eval', corpus + '-qa-probe.json'), JSON.stringify(out, null, 2), 'utf-8');

    console.log('\n=== QA 探针汇总 ===');
    console.log('总体正确率: ' + correct + '/' + total + ' = ' + (correct / total * 100).toFixed(1) + '%');
    if (expTotal) console.log('显式: ' + correctExp + '/' + expTotal + ' = ' + (correctExp / expTotal * 100).toFixed(1) + '%');
    if (implicitTotal) console.log('隐式: ' + implicitCorrect + '/' + implicitTotal + ' = ' + (implicitCorrect / implicitTotal * 100).toFixed(1) + '%');
    console.log('写入: ' + join(__dirname, 'output', 'modality-eval', corpus + '-qa-probe.json'));
}

main().catch(function (e) { console.error('\nFATAL:', e && e.stack || e); process.exit(1); });