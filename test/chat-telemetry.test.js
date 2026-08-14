// Node.js localStorage polyfill (not available in Node)
if (typeof localStorage === 'undefined') {
    var _store = {};
    globalThis.localStorage = {
        getItem: function(k) { return _store.hasOwnProperty(k) ? _store[k] : null; },
        setItem: function(k, v) { _store[k] = String(v); },
        removeItem: function(k) { delete _store[k]; },
        clear: function() { _store = {}; },
        get length() { return Object.keys(_store).length; },
        key: function(i) { return Object.keys(_store)[i] || null; }
    };
}

import {
    incrementChatTurn,
    recordChatStat,
    recordChatToken,
    getChatTurnNumber,
    getChatStats,
    getAllChatStats,
    clearChatStats,
    flushChatStats
} from '../src/core/engine/chat-telemetry.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + b + ', got ' + a + ')'); }

console.log('\n=== chat-telemetry: cache + throttled flush (P1) ===');
localStorage.clear();

// 场景 1: 轮次推进 + 立即落盘
(function() {
    incrementChatTurn('chat_a');
    incrementChatTurn('chat_a');
    eq(getChatTurnNumber('chat_a'), 2, '场景1: 轮号推进到 2');
    var persisted = JSON.parse(localStorage.getItem('ne_chat_stats') || '{}');
    eq(persisted['chat_a'] && persisted['chat_a'].turns.length, 2, '场景1: incrementChatTurn 强制落盘');
})();

// 场景 2: recordChatStat 内存累加 + 聚合；未 flush 前 localStorage 不更新（节流生效）
(function() {
    recordChatStat('chat_a', 'llm', 2);
    recordChatStat('chat_a', 'llm', 3);
    recordChatStat('chat_a', 'stm', 5); // stm 为绝对值覆盖
    recordChatStat('chat_a', 'stm', 7);
    var stats = getChatStats('chat_a');
    var last = stats.turns[stats.turns.length - 1];
    eq(last.llm, 5, '场景2: llm 累加 2+3');
    eq(last.stm, 7, '场景2: stm 绝对值覆盖为 7');
    eq(stats.aggregates.total_llm_calls, 5, '场景2: 聚合 total_llm_calls');
    eq(stats.aggregates.total_stm_count, 7, '场景2: 聚合 total_stm_count 取最后轮');
    // 节流：未调用 flush 前 localStorage 应仍是场景1的快照
    var persisted = JSON.parse(localStorage.getItem('ne_chat_stats') || '{}');
    eq(persisted['chat_a'].turns[1].llm || 0, 0, '场景2: 节流生效，未 flush 前不落盘');
    flushChatStats();
    persisted = JSON.parse(localStorage.getItem('ne_chat_stats') || '{}');
    eq(persisted['chat_a'].turns[1].llm, 5, '场景2: flushChatStats 后落盘');
})();

// 场景 3: recordChatToken 合并双写 — 一次调用同时更新 tok 与分类 tokenOp
(function() {
    recordChatToken('chat_a', 'tok_stm', 300);
    recordChatToken('chat_a', 'tok_consolidate', 120);
    recordChatToken('chat_a', 'tok_chat', 500);
    flushChatStats();
    var stats = getChatStats('chat_a');
    var last = stats.turns[stats.turns.length - 1];
    eq(last.tok, 920, '场景3: tok 累计 300+120+500');
    eq(last.tok_stm, 300, '场景3: tok_stm 生效');
    eq(last.tok_consolidate, 120, '场景3: tok_consolidate 生效');
    eq(last.tok_chat, 500, '场景3: tok_chat 生效');
    eq(stats.aggregates.total_tokens, 920, '场景3: 聚合 total_tokens');
    eq(stats.aggregates.total_tok_stm, 300, '场景3: 聚合 total_tok_stm');
})();

// 场景 4: MAX_TURNS 上限裁剪（>200 轮只保留最近 200）
(function() {
    for (var i = 0; i < 205; i++) incrementChatTurn('chat_b');
    var stats = getChatStats('chat_b');
    eq(stats.turns.length, 200, '场景4: 超过 200 轮被裁剪为 200');
    eq(getChatTurnNumber('chat_b'), 200, '场景4: 轮号显示 200');
})();

// 场景 5: clearChatStats 删除 + 落盘
(function() {
    clearChatStats('chat_b');
    eq(getChatStats('chat_b'), null, '场景5: 内存中已删除');
    var persisted = JSON.parse(localStorage.getItem('ne_chat_stats') || '{}');
    eq(persisted['chat_b'] === undefined, true, '场景5: 落盘后不存在');
})();

// 场景 6: getAllChatStats 读内存缓存（含未落盘增量）
(function() {
    recordChatStat('chat_a', 'tool', 4); // 未 flush
    var all = getAllChatStats();
    eq(all['chat_a'].turns[1].tool, 4, '场景6: getAllChatStats 读到未落盘增量');
})();

console.log('\n=== chat-telemetry: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
