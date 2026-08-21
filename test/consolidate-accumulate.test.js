import { applyLtmDecision, applyBatchLtmDecision, findOpenLtm } from '../src/core/engine/consolidate.js';
import { runBatchLtmDecision } from '../src/core/engine/ltm-pipeline.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== consolidate-accumulate: 累积式弧摘要 ===');

function mkStm(id, start) {
    return { id: id, event: id + '事件', period: 'Day ' + (Math.floor(start / 10) + 1), msgRange: [start, start + 1] };
}

function mkVault(openArc, stmEntries, unconsolidated) {
    return {
        content: {
            ltm_entries: openArc ? [openArc] : [],
            stm_entries: stmEntries || [],
            unconsolidated_stm: unconsolidated || []
        },
        stm_index: {}
    };
}

// --- 1. append 增量追加不洗旧文 ---
var v1 = mkVault(
    { id: 'ltm_1', status: 'open', title: '赌约弧', event: '旧句A', stm_refs: ['stm_1'], present_characters: [] },
    [mkStm('stm_1', 0)],
    [mkStm('stm_2', 5)]
);
applyLtmDecision(v1, { action: 'append', updated_event: '新句B' }, ['stm_2']);
eq(v1.content.ltm_entries[0].event, '旧句A 新句B', 'append 增量追加：旧文保留 + 新句拼接');

// --- 2. 新弧首句直接作为摘要（无双写）---
var v2 = mkVault(null, [], [mkStm('stm_1', 0), mkStm('stm_2', 2)]);
applyLtmDecision(v2, { action: 'append', updated_event: '首句' }, ['stm_1', 'stm_2']);
eq(v2.content.ltm_entries[0].event, '首句', '新弧首句作为摘要开头，无双写');
eq(v2.content.ltm_entries[0].status, 'open', '新弧为 open');

// --- 3. 空 updated_event 时 event 不变 ---
var v3 = mkVault(
    { id: 'ltm_1', status: 'open', title: 'T', event: '只有旧句', stm_refs: ['stm_1'], present_characters: [] },
    [mkStm('stm_1', 0)],
    [mkStm('stm_2', 5)]
);
applyLtmDecision(v3, { action: 'append' }, ['stm_2']);
eq(v3.content.ltm_entries[0].event, '只有旧句', '空 updated_event 时 event 不变');

// --- 4. forceClose 定稿替换 + 自动闭合 ---
var stmEntries4 = [];
for (var i = 1; i <= 14; i++) stmEntries4.push(mkStm('stm_' + i, i * 2));
var refs4 = stmEntries4.map(function(s) { return s.id; });
var v4 = mkVault(
    { id: 'ltm_1', status: 'open', title: '', event: '累积句1 累积句2', stm_refs: refs4, present_characters: [] },
    stmEntries4,
    [mkStm('stm_15', 100), mkStm('stm_16', 102)]
);
applyLtmDecision(v4, { action: 'append', updated_title: '定稿标题', updated_event: '整弧定稿摘要' }, ['stm_15', 'stm_16']);
eq(v4.content.ltm_entries[0].event, '整弧定稿摘要', '触上限 append：定稿整体替换而非追加');
eq(v4.content.ltm_entries[0].status, 'closed', '触上限后自动闭合');
eq(v4.content.ltm_entries[0].title, '定稿标题', '定稿标题写入');

// --- 5. close_and_new 旧弧定稿新弧空起步 ---
var v5 = mkVault(
    { id: 'ltm_1', status: 'open', title: 'T', event: '累积内容', stm_refs: ['stm_1'], present_characters: [] },
    [mkStm('stm_1', 0)],
    [mkStm('stm_2', 10)]
);
applyLtmDecision(v5, { action: 'close_and_new', updated_title: '旧弧定稿', updated_event: '旧弧摘要定稿' }, ['stm_2']);
eq(v5.content.ltm_entries.length, 2, 'close_and_new 产生两条弧');
eq(v5.content.ltm_entries[0].status, 'closed', '旧弧闭合');
eq(v5.content.ltm_entries[0].event, '旧弧摘要定稿', '旧弧定稿替换');
eq(v5.content.ltm_entries[1].status, 'open', '新弧 open');
eq(v5.content.ltm_entries[1].event, '', '新弧空起步');

// --- 6. time_range 推进不回归 ---
var v6 = mkVault(
    { id: 'ltm_1', status: 'open', title: 'T', event: '', stm_refs: ['stm_1'], present_characters: [] },
    [mkStm('stm_1', 0)],
    [mkStm('stm_2', 40)]
);
applyLtmDecision(v6, { action: 'append', updated_event: '推进' }, ['stm_2']);
assert(!!v6.content.ltm_entries[0].time_range, 'time_range 仍被推导');

// --- 7. runBatchLtmDecision forceClose 接线：临近上限激活定稿路径 ---
var stmEntries7 = [];
for (var j = 1; j <= 13; j++) stmEntries7.push(mkStm('stm_' + j, j * 2));
var refs7 = stmEntries7.map(function(s) { return s.id; });
var v7 = mkVault(
    { id: 'ltm_1', status: 'open', title: '', event: '累积到13拍的弧', stm_refs: refs7, present_characters: [] },
    stmEntries7,
    [mkStm('stm_14', 100), mkStm('stm_15', 102), mkStm('stm_16', 104)]
);
var captured7 = [];
var mock7 = async function (messages) {
    captured7.push(messages[0].content);
    return JSON.stringify({ ltm_decision: { action: 'append', updated_title: '定稿标题', updated_event: '整弧定稿' } });
};
var groups7 = await runBatchLtmDecision(v7, ['stm_14', 'stm_15', 'stm_16'], mock7);
eq(groups7.length, 1, '临近上限：1 组决策');
assert(captured7[0].indexOf('强制闭合') !== -1, '临近上限 prompt 含强制闭合定稿指令');
applyBatchLtmDecision(v7, groups7);
eq(v7.content.ltm_entries[0].status, 'closed', 'apply 后弧闭合');
eq(v7.content.ltm_entries[0].event, '整弧定稿', '定稿写入（修复自动闭合弧零摘要断线）');

// --- 8. runBatchLtmDecision 控制组：远离上限走增量句指令 ---
var v8 = mkVault(
    { id: 'ltm_1', status: 'open', title: '', event: '开头几句', stm_refs: ['stm_1'], present_characters: [] },
    [mkStm('stm_1', 0)],
    [mkStm('stm_2', 10), mkStm('stm_3', 12), mkStm('stm_4', 14)]
);
var captured8 = [];
var mock8 = async function (messages) {
    captured8.push(messages[0].content);
    return JSON.stringify({ ltm_decision: { action: 'append', updated_event: '本轮增量句' } });
};
var groups8 = await runBatchLtmDecision(v8, ['stm_2', 'stm_3', 'stm_4'], mock8);
assert(captured8[0].indexOf('强制闭合') === -1, '远离上限不含强制闭合指令');
assert(captured8[0].indexOf('增量叙事') !== -1, '普通 append prompt 含增量句指令');
applyBatchLtmDecision(v8, groups8);
eq(v8.content.ltm_entries[0].event, '开头几句 本轮增量句', '全链路：增量句追加');

// --- 9. 开放弧 event 展示尾部（累积式下 LLM 需看见已写到哪）---
var longEvent = '';
for (var k = 0; k < 60; k++) longEvent += '拍' + k + '的句子内容。';
var v9 = mkVault(
    { id: 'ltm_1', status: 'open', title: '', event: longEvent, stm_refs: ['stm_1'], present_characters: [] },
    [mkStm('stm_1', 0)],
    [mkStm('stm_2', 10), mkStm('stm_3', 12), mkStm('stm_4', 14)]
);
var captured9 = [];
var mock9 = async function (messages) {
    captured9.push(messages[0].content);
    return JSON.stringify({ ltm_decision: { action: 'append', updated_event: 'x' } });
};
await runBatchLtmDecision(v9, ['stm_2', 'stm_3', 'stm_4'], mock9);
var tail9 = longEvent.slice(-500);
assert(captured9[0].indexOf(tail9) !== -1, '超长 event 展示尾部 500 字');
assert(captured9[0].indexOf('…' + tail9) !== -1, '尾部展示带省略号前缀');
assert(captured9[0].indexOf(longEvent.slice(0, 200)) === -1, '不再展示头部 200 字');

// --- 10. 多组决策的 refs 模拟推进：首组触上限定稿后，次组开新弧不再强制闭合 ---
var stmEntries10 = [];
for (var m = 1; m <= 13; m++) stmEntries10.push(mkStm('stm_' + m, m * 2));
var refs10 = stmEntries10.map(function(s) { return s.id; });
var v10 = mkVault(
    { id: 'ltm_1', status: 'open', title: '', event: '累积13拍', stm_refs: refs10, present_characters: [] },
    stmEntries10,
    [mkStm('stm_14', 100), mkStm('stm_15', 102), mkStm('stm_16', 104), mkStm('stm_17', 200), mkStm('stm_18', 202), mkStm('stm_19', 204)]
);
var captured10 = [];
var mock10 = async function (messages) {
    captured10.push(messages[0].content);
    // 首组定稿闭合，次组为新弧首句
    var isForce = messages[0].content.indexOf('强制闭合') !== -1;
    return JSON.stringify({ ltm_decision: isForce
        ? { action: 'append', updated_title: '旧弧定稿', updated_event: '旧弧整弧定稿' }
        : { action: 'append', updated_event: '新弧首句' } });
};
// msgRange 100-104 与 200-204 间隔 > 3 → 拆成两组
var groups10 = await runBatchLtmDecision(v10, ['stm_14', 'stm_15', 'stm_16', 'stm_17', 'stm_18', 'stm_19'], mock10);
eq(groups10.length, 2, '两组决策');
assert(captured10[0].indexOf('强制闭合') !== -1, '首组（13+3 触上限）强制闭合');
assert(captured10[1].indexOf('强制闭合') === -1, '次组（模拟推进后新弧）不强制闭合');
applyBatchLtmDecision(v10, groups10);
eq(v10.content.ltm_entries[0].status, 'closed', '旧弧闭合');
eq(v10.content.ltm_entries[0].event, '旧弧整弧定稿', '旧弧定稿');
eq(v10.content.ltm_entries[1].status, 'open', '新弧 open');
eq(v10.content.ltm_entries[1].event, '新弧首句', '新弧首句写入');
eq(findOpenLtm(v10).id, v10.content.ltm_entries[1].id, '开放弧指向新弧');

console.log('\n--- consolidate-accumulate: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
