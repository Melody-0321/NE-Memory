import { computeWindowStartMsgId } from '../src/core/engine/context-window.js';

var test = { passed: 0, failed: 0 };

function assert(condition, msg) {
    if (condition) {
        test.passed++;
    } else {
        test.failed++;
        console.error('  FAIL: ' + msg);
    }
}

function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (expected >' + b + ', got ' + a + ')'); }
function contains(a, b, msg) { assert(a.indexOf(b) !== -1, msg + ' (expected "' + b + '" not found)'); }
function notContains(a, b, msg) { assert(a.indexOf(b) === -1, msg + ' (unexpectedly contains "' + b + '")'); }

function makeMsg(mes_id, role, is_user) {
    return { mes_id: mes_id, role: role, is_user: is_user || false, is_system: false };
}

// ====== computeWindowStartMsgId ======
//
// 算法：从 chat 末尾向前扫，统计 (user→assistant) 配对轮回数。
// 第一个使 rounds >= contextWindowRounds 的 assistant 消息的 mes_id
// 即为窗口起点。该消息及其之后的消息在窗口内。

console.log('\n=== context-window: computeWindowStartMsgId ===');

// 1. 空 chat → 0
eq(computeWindowStartMsgId(null, 10), 0, 'null chat → 0');
eq(computeWindowStartMsgId([], 10), 0, 'empty chat → 0');

// 2. 消息数少于一整轮（user+assistant 对）→ 0
var short = [
    makeMsg(1, 'user', true),
];
eq(computeWindowStartMsgId(short, 10), 0, '仅 user 消息 → 0');

short = [
    makeMsg(1, 'user', true),
    makeMsg(2, 'assistant'),
];
eq(computeWindowStartMsgId(short, 10), 0, '1 轮对话 < 10 窗口 → 0');

// 3. 恰好 N 轮时，窗口能容纳全部 → 返回 0（全在窗口内）
var exact3 = [
    makeMsg(1, 'user', true),   // round 1 user
    makeMsg(2, 'assistant'),     // round 1 assistant
    makeMsg(3, 'user', true),   // round 2 user
    makeMsg(4, 'assistant'),     // round 2 assistant
    makeMsg(5, 'user', true),   // round 3 user
    makeMsg(6, 'assistant'),     // round 3 assistant
];
eq(computeWindowStartMsgId(exact3, 3), 0, '3 轮窗口=3 → 全在窗口内，返回 0');

// 4. 窗口 < 总轮数 → 返回窗口起点的 mes_id
var manyRounds = [];
for (var r = 1; r <= 12; r++) {
    manyRounds.push(makeMsg(r * 2 - 1, 'user', true));
    manyRounds.push(makeMsg(r * 2, 'assistant'));
}
// 12 轮，窗口=10：前 2 轮在窗口外，窗口从 msg 4 (a2) 开始
var result = computeWindowStartMsgId(manyRounds, 10);
eq(result, 4, '12 轮中窗口=10 → 窗口起点=msg 4 (a2)');

// 5. 窗口=2（3 轮对话）→ 窗口从 msg 2 开始
eq(computeWindowStartMsgId(exact3, 2), 2, '3 轮中窗口=2 → 窗口起点=msg 2 (a1)');

// 6. system 消息被跳过（需要 is_system=true 标记）
var withSystem = [
    { mes_id: 1, role: 'system', is_system: true },
    { mes_id: 2, role: 'user', is_user: true },
    makeMsg(3, 'assistant'),
    { mes_id: 4, role: 'system', is_system: true },
    { mes_id: 5, role: 'user', is_user: true },
    makeMsg(6, 'assistant'),
];
// system 不影响轮数统计，共 2 轮对话，窗口=2 → 全在窗口内
eq(computeWindowStartMsgId(withSystem, 2), 0, '含 system 消息的 2 轮窗口=2 → 全在窗口内');

// 7. 连续 user 消息 — user→user 不算配对
var doubleUser = [
    makeMsg(1, 'user', true),
    makeMsg(2, 'user', true),      // 连续 user（如编辑重发）
    makeMsg(3, 'assistant'),
    makeMsg(4, 'user', true),
    makeMsg(5, 'assistant'),
];
// 只有 u1→u2→a1 和 u3→a2，倒序只数到 1 个配对（a1），窗口=2 → 0
eq(computeWindowStartMsgId(doubleUser, 2), 0, '连续 user → 实际只有 1 轮配对，窗口=2 → 全在窗口内');

// ====== 结果 ======
console.log('\n--- context-window: ' + test.passed + ' passed, ' + test.failed + ' failed ---');
if (test.failed > 0) process.exit(1);
