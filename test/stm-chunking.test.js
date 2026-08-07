/**
 * stm-chunking.test.js — STM 管线分块与事件映射测试
 *
 * 覆盖：
 * - P1-1：chunkSegmentsForLLM 超长 segment 非首位置也拆分（累积场景不整段提交）
 * - P1-2：mapEventData 事件自带 msgRange（窗口内下标）→ 经 windowMessages 转全局
 * - P1-17：mapEventData status partial 语义保留
 */
import { chunkSegmentsForLLM, mapEventData } from '../src/core/engine/stm-pipeline.js';
import { formatTurnsText, groupMessagesIntoTurns } from '../src/core/engine/turn-segmenter.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + JSON.stringify(val) + ')'); }

function makeTurns(n, contentLen) {
    var msgs = [];
    for (var i = 0; i < n; i++) {
        msgs.push({ role: 'user', mes: new Array(contentLen + 1).join('u'), is_user: true, _absIdx: i * 2 });
        msgs.push({ role: 'assistant', mes: new Array(contentLen + 1).join('a'), _absIdx: i * 2 + 1 });
    }
    return groupMessagesIntoTurns(msgs);
}

function chunkTextLen(turns, chunk) {
    var idxs = [];
    for (var ci = 0; ci < chunk.length; ci++) {
        for (var ti = chunk[ci][0]; ti <= chunk[ci][1]; ti++) idxs.push(ti);
    }
    return formatTurnsText(turns, idxs).length;
}

console.log('\n=== stm-chunking: P1-1 超长 segment 拆分 ===');

var turnsP1 = makeTurns(20, 30);  // 每 turn 文本 ~90 chars

// 首位置超长 segment → 拆成多 chunk（旧逻辑也支持，验证保底）
var chunksA = chunkSegmentsForLLM([[0, 19]], turnsP1, 100);
ok(chunksA.length > 1, 'P1-1 首位置超长 segment 拆成多 chunk');
ok(chunksA.every(function(c) { return chunkTextLen(turnsP1, c) <= 100; }),
    'P1-1 首位置拆分后每个 chunk ≤ maxChars');

// 核心回归：累积场景——第一个 segment 已入 chunk，第二个超长 segment 必须拆分而非整段提交
var segmentsB = [[0, 0], [1, 19]];
var chunksB = chunkSegmentsForLLM(segmentsB, turnsP1, 100);
var hasFullOversize = chunksB.some(function(c) {
    return c.length === 1 && c[0][0] === 1 && c[0][1] === 19;
});
ok(!hasFullOversize, 'P1-1 超长 segment 不再整段提交给 LLM');
ok(chunksB[0].length === 1 && chunksB[0][0][0] === 0 && chunksB[0][0][1] === 0,
    'P1-1 已累积的正常 segment 独立成 chunk');
ok(chunksB.every(function(c) { return chunkTextLen(turnsP1, c) <= 100; }),
    'P1-1 累积场景每个 chunk ≤ maxChars');

// 普通累积分 chunk（不涉及拆分）
var chunksC = chunkSegmentsForLLM([[0, 0], [1, 1]], turnsP1, 150);
eq(chunksC.length, 2, 'P1-1 普通累积分 chunk');
eq(chunksC[0][0][0], 0, 'P1-1 第一个 chunk 含 seg0');
eq(chunksC[1][0][0], 1, 'P1-1 第二个 chunk 含 seg1');

// 拆分结果一致性：所有 segment 都被完整覆盖
var covered = [];
chunksB.forEach(function(c) {
    c.forEach(function(seg) { covered.push(seg[0] + ':' + seg[1]); });
});
var covers1to19 = covered.filter(function(k) { return k !== '0:0'; }).length;
eq(covers1to19, 19, 'P1-1 拆分后每个 turn 都被覆盖');

console.log('\n=== stm-chunking: P1-2 msgRange 窗口映射 ===');

var turnsM = [
    { user: { mes: 'u1' }, assistant: { mes: 'a1' }, msgStart: 10, msgEnd: 11 },
    { user: { mes: 'u2' }, assistant: { mes: 'a2' }, msgStart: 12, msgEnd: 13 },
    { user: { mes: 'u3' }, assistant: { mes: 'a3' }, msgStart: 14, msgEnd: 15 }
];
var windowMessages = [];
for (var wi = 0; wi < 6; wi++) windowMessages.push({ _absIdx: 10 + wi, mes: 'w' + wi });

// 事件自带 msgRange（窗口内下标 0..3）→ 全局 10..13 → 覆盖 turn0+turn1
var evt = { event: 'e', msgRange: [0, 3] };
mapEventData(evt, [0, 2], turnsM, [[0, 2]], windowMessages);
eq(evt.absMsgStart, 10, 'P1-2 msgRange → 全局 start');
eq(evt.absMsgEnd, 13, 'P1-2 msgRange → 全局 end');
eq(evt.msgRange[0], 10, 'P1-2 msgRange 归一为全局下标');
eq(evt.msgRange[1], 13, 'P1-2 msgRange 归一为全局 end');
eq(evt.msg_ids.length, 4, 'P1-2 覆盖 2 个 turn 共 4 条消息');
eq(evt.status, 'closed', 'P1-2 无 status → closed');

// 无 msgRange → 回退 seg 全范围
var evt2 = { event: 'e2' };
mapEventData(evt2, [1, 2], turnsM, [[0, 2]], windowMessages);
eq(evt2.absMsgStart, 12, 'P1-2 无 msgRange → seg 起点');
eq(evt2.absMsgEnd, 15, 'P1-2 无 msgRange → seg 终点');
eq(evt2.msg_ids.length, 4, 'P1-2 无 msgRange → 覆盖 seg 全部 turn');

// windowMessages 缺失 → msgRange 不转换，保守回退 seg
var evtN = { event: 'n', msgRange: [0, 3] };
mapEventData(evtN, [1, 1], turnsM, [[0, 2]], null);
eq(evtN.absMsgStart, 12, 'P1-2 无 windowMessages → 回退 seg');
eq(evtN.absMsgEnd, 13, 'P1-2 无 windowMessages → 回退 seg end');

console.log('\n=== stm-chunking: P1-17 partial 语义保留 ===');

var evtP = { event: 'p', msgRange: [0, 1], status: 'partial' };
mapEventData(evtP, [0, 0], turnsM, [[0, 2]], windowMessages);
eq(evtP.status, 'partial', 'P1-17 partial 语义保留');

var evtC = { event: 'c', msgRange: [0, 1], status: 'closed' };
mapEventData(evtC, [0, 0], turnsM, [[0, 2]], windowMessages);
eq(evtC.status, 'closed', 'P1-17 closed 保持');

var evtD = { event: 'd', msgRange: [0, 1] };
mapEventData(evtD, [0, 0], turnsM, [[0, 2]], windowMessages);
eq(evtD.status, 'closed', 'P1-17 无 status → closed');

console.log('\n--- stm-chunking: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
