import { computeWindowStartMsgId } from '../src/core/engine/context-window.js';

var EMPTY = [];

function eq(a, b, label) {
    if (a !== b) throw new Error(label + ': expected ' + b + ', got ' + a);
}

function makeMsg(role, is_user, is_system) {
    return { role: role, is_user: !!is_user, is_system: !!is_system };
}

function buildChat(rounds) {
    var chat = [];
    for (var r = 1; r <= rounds; r++) {
        chat.push(makeMsg('user', true));
        chat.push(makeMsg('assistant'));
    }
    return chat;
}

function buildChatWithSystem(rounds) {
    var chat = [];
    chat.push(makeMsg(null, false, true));
    for (var r = 1; r <= rounds; r++) {
        chat.push(makeMsg('user', true));
        chat.push(makeMsg('assistant'));
    }
    return chat;
}

function simulateAdjustWindow(chat, cwRounds) {
    if (!chat || chat.length === 0) return chat;
    var minRounds = 6;
    if (cwRounds < minRounds) cwRounds = minRounds;
    var windowStartIdx = computeWindowStartMsgId(chat, cwRounds);
    if (windowStartIdx <= 0) return chat;
    return chat.slice(windowStartIdx + 1);
}

function lastRole(chat) { return chat && chat.length > 0 ? chat[chat.length - 1].role : null; }
function firstRole(chat) { return chat && chat.length > 0 ? chat[0].role : null; }

eq(computeWindowStartMsgId(null, 10), -1, 'null chat -> -1');
eq(computeWindowStartMsgId(EMPTY, 10), -1, 'empty chat -> -1');

var chat4 = buildChat(4);
var idx4 = computeWindowStartMsgId(chat4, 10);
eq(idx4, -1, '4 轮 chat with target 10 -> -1 (full window)');

var chat20 = buildChat(20);
var idx20_10 = computeWindowStartMsgId(chat20, 10);
var result20_10 = simulateAdjustWindow(chat20, 10);
eq(result20_10.length, 20, '20 轮 chat 截断 target=10, window started by floor 6 -> 保留 12 条 (6 轮 * 2)');
eq(firstRole(result20_10), 'user', '第一轮是 user（截断边界对齐轮次）');

var result20_6 = simulateAdjustWindow(chat20, 6);
eq(result20_6.length, 12, '20 轮 chat 截断 target=6 -> 保留 12 条 (6 轮)');

var result20_2 = simulateAdjustWindow(chat20, 2);
eq(result20_2.length, 12, '20 轮 chat 截断 target=2 (< 地板 6) -> 保留 12 条 (6 轮)');

var chat15 = buildChat(15);
var result15_10 = simulateAdjustWindow(chat15, 10);
eq(result15_10.length, 20, '15 轮 chat 截断 target=10 (window < full) -> 保留 20 条 (10 轮)');

// 全量覆盖场景
var fullResult = simulateAdjustWindow(buildChat(3), 10);
eq(fullResult.length, 6, '3 轮 chat target=10 -> 全量保留 6 条');

// system 消息不影响计数
var chatSys = buildChatWithSystem(10);
var idxSys = computeWindowStartMsgId(chatSys, 6);
eq(idxSys > 0, true, 'system 消息不应影响轮数计数，10 轮截断到 6 轮应有截断点');
var resultSys = simulateAdjustWindow(chatSys, 6);
eq(firstRole(resultSys), 'user', '截断后第一条应为 user 消息');

// 空 chat 不崩溃
var resultEmpty = simulateAdjustWindow(EMPTY, 10);
eq(resultEmpty.length, 0, '空 chat 应保持空');

console.log('=== ALL PASS ===');
