// dialog-window.test.js — Unit tests for adjustDialogWindow logic
//
// adjustDialogWindow is in src/adapter/events.js which depends on runtime.getChat().
// We test its core logic by replicating the algorithm here with mock inputs.

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
function ne(a, b, msg) { assert(a !== b, msg + ' (expected !== ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

function makeMsg(mes_id, role, is_user) {
    return { mes_id: mes_id, role: role, is_user: is_user || false, is_system: false };
}

// Simulated adjustDialogWindow — same algorithm as in events.js
function simulateAdjustWindow(chat, cwRounds, overrideEnabled) {
    if (!chat || chat.length === 0) return chat;

    var minRounds = 6;
    if (cwRounds < minRounds) cwRounds = minRounds;

    var windowStartId = computeWindowStartMsgId(chat, cwRounds);
    if (windowStartId <= 0) return chat;

    var result = chat.slice(); // operate on copy for testing
    for (var i = 0; i < result.length; i++) {
        var m = result[i];
        if ((m.mes_id || 0) > windowStartId) {
            if (i > 0) result = result.slice(i);
            return result;
        }
    }
    return result;
}

function buildChat(rounds) {
    var chat = [];
    for (var r = 1; r <= rounds; r++) {
        chat.push(makeMsg(r * 2 - 1, 'user', true));
        chat.push(makeMsg(r * 2, 'assistant'));
    }
    return chat;
}

// ====== adjustDialogWindow core logic ======

console.log('\n=== dialog-window: adjustDialogWindow core logic ===');

// 1. 20 轮 chat，截断到 10 轮 → 保留最后 10 轮
var chat20 = buildChat(20);
var result = simulateAdjustWindow(chat20, 10, false);
eq(result.length, 20, '20 轮 chat 截断到 10 轮 → 保留 20 条消息（10 对 user+assistant）');
eq(result[0].mes_id, 21, '20 轮 chat 截断到 10 轮 → 第一条消息 mes_id=21');
eq(result[result.length - 1].mes_id, 40, '20 轮 chat 截断到 10 轮 → 最后一条消息 mes_id=40');

// 2. 15 轮 chat，截断到 6 轮（地板）→ 保留最后 6 轮
var chat15 = buildChat(15);
result = simulateAdjustWindow(chat15, 3, false); // 3 < 6 → 地板 6
eq(result.length, 12, '15 轮 chat 截断地板=6 → 保留 12 条消息');
eq(result[0].mes_id, 19, '15 轮 chat 截断地板=6 → 第一条消息 mes_id=19');

// 3. 4 轮 chat，截断到 10 轮 → 无修改（实际 < 目标）
var chat4 = buildChat(4);
result = simulateAdjustWindow(chat4, 10, false);
eq(result.length, 8, '4 轮 chat 截断到 10 轮 → 无修改，仍为 8 条消息');

// 4. 12 轮 chat，截断到 6 轮（恰好地板值）→ 保留最后 6 轮
var chat12 = buildChat(12);
result = simulateAdjustWindow(chat12, 6, false);
eq(result.length, 12, '12 轮 chat 截断到 6 轮 → 保留 12 条消息');

// 5. 截断到 2 轮，但 2 < 地板 6 → 保留 6 轮
result = simulateAdjustWindow(buildChat(20), 2, false);
eq(result.length, 12, '20 轮 chat 截断=2（< 地板 6）→ 保留 6 轮（12 条消息）');

// 6. system 消息不影响轮数计算（skip is_system）
var chatWithSystem = [];
for (var r = 1; r <= 12; r++) {
    chatWithSystem.push(makeMsg(r * 3 - 2, 'user', true));
    chatWithSystem.push(makeMsg(r * 3 - 1, 'assistant'));
    chatWithSystem.push({ mes_id: r * 3, role: 'system', is_system: true });
}
result = simulateAdjustWindow(chatWithSystem, 6, false);
eq(result.length, 19, '含 system 消息 12 轮截断到 6 轮 → 保留 19 条（含 sys 边界 + 6 完整轮）');

// 7. 空 chat → 无修改
result = simulateAdjustWindow([], 10, false);
eq(result.length, 0, '空 chat → 无修改');

// 8. 截断到 20 轮，实际只有 15 轮 → 无修改
result = simulateAdjustWindow(buildChat(15), 20, false);
eq(result.length, 30, '15 轮 chat 截断=20 → 实际 < 目标，无修改');

// 9. 截断到恰好地板值（6），chat 恰好 6 轮 → 无修改
result = simulateAdjustWindow(buildChat(6), 6, false);
eq(result.length, 12, '6 轮 chat 截断=6 → 恰好满足，无修改');

// 10. overrideEnabled 不影响截断逻辑（只影响 runtime.maxContext，这里不测 runtime）
result = simulateAdjustWindow(buildChat(20), 10, true);
eq(result.length, 20, '模式 2 下 → 截断逻辑一致，仍保留 10 轮');

// ====== 结果 ======
console.log('\n--- dialog-window: ' + test.passed + ' passed, ' + test.failed + ' failed ---');
if (test.failed > 0) process.exit(1);
