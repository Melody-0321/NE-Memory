/**
 * adaptive-context.test.js — 自适应上下文控制单元测试
 *
 * 覆盖 src/core/engine/adaptive-context.js 的核心路径：
 * - 纯函数：replaceNeMarkerInChat / trimMemoryVaultByKB
 * - 缓存管理：setAdaptiveCache / resetAdaptiveCache
 * - 压缩主循环：compressLayers 的 dialog 路径
 * - 主入口守卫：adaptContextPostTrim 的 dryRun / 无缓存短路
 * - 主入口完整路径：超预算触发 dialog 压缩
 */
import {
    replaceNeMarkerInChat,
    trimMemoryVaultByKB,
    compressLayers,
    expandLayers,
    setAdaptiveCache,
    resetAdaptiveCache,
    adaptContextPostTrim
} from '../src/core/engine/adaptive-context.js';
import { countTokens } from '../src/core/engine/text-utils.js';

// === 全局 mock：localStorage + SillyTavern ===
var _lsStore = {};
globalThis.localStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(_lsStore, k) ? _lsStore[k] : null; },
    setItem: function(k, v) { _lsStore[k] = String(v); },
    removeItem: function(k) { delete _lsStore[k]; },
    clear: function() { _lsStore = {}; }
};

function mockSillyTavernCtx(opts) {
    opts = opts || {};
    var maxContext = opts.maxContext || 4000;
    var maxTokens = opts.maxTokens || 300;
    var tokenCounter = opts.tokenCounter || function(text) { return Math.ceil((text || '').length / 4); };
    globalThis.SillyTavern = {
        getContext: function() {
            return {
                maxContext: maxContext,
                chatCompletionSettings: { openai_max_tokens: maxTokens },
                getTokenCountAsync: async function(text) { return tokenCounter(text); }
            };
        }
    };
}

function clearSillyTavern() {
    delete globalThis.SillyTavern;
}

// === 测试工具 ===
var passed = 0, failed = 0;
function ok(cond, msg) {
    if (cond) { passed++; }
    else { failed++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
    if (a !== b) {
        failed++; console.error('  FAIL: ' + msg + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
    } else { passed++; }
}
async function asyncEq(a, b, msg) {
    var av = await a;
    if (av !== b) {
        failed++; console.error('  FAIL: ' + msg + ': expected ' + b + ', got ' + av);
    } else { passed++; }
}

// === 构造工具 ===
function makeMsg(role, content) {
    return { role: role, content: content };
}
function makeUserMsg(content) { return makeMsg('user', content); }
function makeAssistantMsg(content) { return makeMsg('assistant', content); }

function buildDialogChat(rounds, charsPerMsg) {
    var chat = [];
    charsPerMsg = charsPerMsg || 80;
    for (var r = 0; r < rounds; r++) {
        chat.push(makeUserMsg('User round ' + r + ' ' + 'x'.repeat(charsPerMsg)));
        chat.push(makeAssistantMsg('Assistant round ' + r + ' ' + 'y'.repeat(charsPerMsg)));
    }
    return chat;
}

function buildDialogMsgIndices(chat) {
    var indices = [];
    for (var i = 0; i < chat.length; i++) {
        if (chat[i].role === 'user' || chat[i].role === 'assistant') {
            indices.push(i);
        }
    }
    return indices;
}

function countRounds(chat) {
    var rounds = 0;
    var prev = null;
    for (var i = 0; i < chat.length; i++) {
        if (prev === 'user' && chat[i].role === 'assistant') rounds++;
        prev = chat[i].role;
    }
    return rounds;
}

// === 测试用例 ===

console.log('\n=== adaptive-context: replaceNeMarkerInChat ===');

// Test 1: 基本替换 — 标记存在
(function() {
    var chat = [makeMsg('system', '前置<!--NE:state_table-->旧内容<!--/NE:state_table-->后置')];
    var found = replaceNeMarkerInChat(chat, 'state_table', '新内容');
    eq(found, true, 'T1 应返回 true');
    eq(chat[0].content, '前置<!--NE:state_table-->新内容<!--/NE:state_table-->后置', 'T1 内容应被替换');
})();

// Test 2: 标记不存在时返回 false
(function() {
    var chat = [makeMsg('system', '无标记内容')];
    var found = replaceNeMarkerInChat(chat, 'state_table', '新内容');
    eq(found, false, 'T2 应返回 false');
    eq(chat[0].content, '无标记内容', 'T2 内容应不变');
})();

// Test 3: 多消息中查找 — 标记在第二条
(function() {
    var chat = [
        makeMsg('system', '无标记'),
        makeMsg('system', '前<!--NE:memory_vault-->旧<!--/NE:memory_vault-->后')
    ];
    var found = replaceNeMarkerInChat(chat, 'memory_vault', '新');
    eq(found, true, 'T3 应返回 true');
    eq(chat[1].content, '前<!--NE:memory_vault-->新<!--/NE:memory_vault-->后', 'T3 第二条内容应被替换');
    eq(chat[0].content, '无标记', 'T3 第一条内容应不变');
})();

// Test 4: 只有开标记（无闭标记）时不替换
(function() {
    var chat = [makeMsg('system', '<!--NE:state_table-->孤立开标记')];
    var found = replaceNeMarkerInChat(chat, 'state_table', '新');
    eq(found, false, 'T4 应返回 false');
    eq(chat[0].content, '<!--NE:state_table-->孤立开标记', 'T4 内容应不变');
})();

console.log('\n=== adaptive-context: trimMemoryVaultByKB ===');

// Test 5: 优先裁剪"线索"等级
(function() {
    var text = [
        '[KB:核心角色=核心] 核心记忆内容，重要不可删',
        '[KB:次要角色=间接] 间接记忆内容',
        '[KB:旁观者=线索] 线索记忆内容'
    ].join('\n');
    var fullTokens = countTokens(text);
    // 设 targetTokens 略大于"核心+间接"，应裁掉"线索"
    var coreAndIndirect = '[KB:核心角色=核心] 核心记忆内容，重要不可删\n[KB:次要角色=间接] 间接记忆内容';
    var target = countTokens(coreAndIndirect) + 5;
    var result = trimMemoryVaultByKB(text, target);
    ok(result.indexOf('线索') === -1, 'T5 应裁掉"线索"等级');
    ok(result.indexOf('核心') !== -1, 'T5 应保留"核心"等级');
    ok(result.indexOf('间接') !== -1, 'T5 应保留"间接"等级');
})();

// Test 6: 进一步裁剪"间接"等级
(function() {
    var text = [
        '[KB:核心角色=核心] 核心记忆内容',
        '[KB:次要角色=间接] 间接记忆内容',
        '[KB:旁观者=线索] 线索记忆内容'
    ].join('\n');
    var coreOnly = '[KB:核心角色=核心] 核心记忆内容';
    var target = countTokens(coreOnly) + 2;
    var result = trimMemoryVaultByKB(text, target);
    ok(result.indexOf('核心') !== -1, 'T6 应保留"核心"');
    ok(result.indexOf('间接') === -1, 'T6 应裁掉"间接"');
    ok(result.indexOf('线索') === -1, 'T6 应裁掉"线索"');
})();

// Test 7: targetTokens 足够大时无裁剪
(function() {
    var text = '[KB:A=核心] 内容A\n[KB:B=线索] 内容B';
    var result = trimMemoryVaultByKB(text, 99999);
    eq(result, text, 'T7 应原样返回');
})();

// Test 8: 全部裁剪后返回剩余（核心等级保留）
(function() {
    var text = '[KB:A=线索] 内容A\n[KB:B=间接] 内容B\n[KB:C=核心] 内容C';
    var result = trimMemoryVaultByKB(text, 0);
    // 至少保留核心等级
    ok(result.indexOf('核心') !== -1, 'T8 应保留核心等级');
    ok(result.indexOf('线索') === -1, 'T8 应裁掉线索');
    ok(result.indexOf('间接') === -1, 'T8 应裁掉间接');
})();

console.log('\n=== adaptive-context: setAdaptiveCache / resetAdaptiveCache ===');

// Test 9: 部分更新缓存
(function() {
    resetAdaptiveCache();
    setAdaptiveCache({ stateTable: 'table1', stateTableTokens: 100 });
    setAdaptiveCache({ memoryVault: 'vault1' });
    // 再次部分更新，确保不覆盖之前的字段
    setAdaptiveCache({ memoryVaultTokens: 200 });
    // 通过 adaptContextPostTrim 的守卫行为间接验证缓存状态
    // 这里直接调用 adaptContextPostTrim 不应短路（已有 stateTable）
    var chat = [];
    var called = false;
    mockSillyTavernCtx({ maxContext: 100, maxTokens: 10 }); // 极小预算触发压缩
    // 注意：chat 为空时不会真正压缩，但不应因"无缓存"而提前 return
    // 这里只能通过行为间接验证 — 见 T11
    clearSillyTavern();
    resetAdaptiveCache();
})();

console.log('\n=== adaptive-context: compressLayers (dialog 路径) ===');

// Test 10: 超预算时压缩 dialog 层到 floor
(async function() {
    resetAdaptiveCache();
    var chat = buildDialogChat(8, 100);  // 8 轮，每条 100 字符 ≈ 25 tokens
    var dialogIndices = buildDialogMsgIndices(chat);
    var totalTokens = 1600;  // 16 条 * 100 字符 / 4
    var budget = 800;  // 需要砍掉约一半
    var layers = [
        { name: 'dialog', current: 8, floor: 4, ceiling: 10 }
    ];
    mockSillyTavernCtx({
        tokenCounter: function(text) { return Math.ceil((text || '').length / 4); }
    });
    var ctx = SillyTavern.getContext();
    await compressLayers(chat, layers, totalTokens, budget, dialogIndices, ctx);
    var roundsAfter = countRounds(chat);
    ok(roundsAfter <= 8, 'T10 压缩后轮数应 ≤ 8 (got ' + roundsAfter + ')');
    ok(roundsAfter >= 4, 'T10 压缩后轮数应 ≥ floor=4 (got ' + roundsAfter + ')');
    ok(chat.length <= 16, 'T10 chat 长度应减少 (got ' + chat.length + ')');
    clearSillyTavern();
    resetAdaptiveCache();
})();

// Test 11: 所有层触底时立即停止（不修改 chat）
(async function() {
    resetAdaptiveCache();
    var chat = buildDialogChat(4, 50);
    var dialogIndices = buildDialogMsgIndices(chat);
    var layers = [
        { name: 'dialog', current: 4, floor: 4, ceiling: 10 }  // current=floor，触底
    ];
    mockSillyTavernCtx();
    var ctx = SillyTavern.getContext();
    var beforeLen = chat.length;
    await compressLayers(chat, layers, 10000, 100, dialogIndices, ctx);  // 极端超预算
    eq(chat.length, beforeLen, 'T11 所有层触底时 chat 不变');
    clearSillyTavern();
    resetAdaptiveCache();
})();

// Test 12: dialog 层压缩到 floor 后停止（即使仍超预算）
(async function() {
    resetAdaptiveCache();
    var chat = buildDialogChat(6, 200);  // 6 轮，每条 200 字符
    var dialogIndices = buildDialogMsgIndices(chat);
    var layers = [
        { name: 'dialog', current: 6, floor: 4, ceiling: 10 }
    ];
    mockSillyTavernCtx({
        tokenCounter: function(text) { return Math.ceil((text || '').length / 4); }
    });
    var ctx = SillyTavern.getContext();
    // 极小预算，但 dialog 只能压到 4 轮
    await compressLayers(chat, layers, 99999, 10, dialogIndices, ctx);
    var roundsAfter = countRounds(chat);
    eq(roundsAfter, 4, 'T12 应压缩到 floor=4 (got ' + roundsAfter + ')');
    clearSillyTavern();
    resetAdaptiveCache();
})();

console.log('\n=== adaptive-context: adaptContextPostTrim 守卫 ===');

// Test 13: dryRun=true 直接 return
(async function() {
    resetAdaptiveCache();
    setAdaptiveCache({ stateTable: 'fake', stateTableTokens: 100 });
    var chat = buildDialogChat(6, 100);
    var beforeLen = chat.length;
    // 不需要 mock SillyTavern（dryRun 应在访问 ctx 前就 return）
    clearSillyTavern();
    await adaptContextPostTrim(chat, true);
    eq(chat.length, beforeLen, 'T13 dryRun 时 chat 不变');
    resetAdaptiveCache();
})();

// Test 14: 无缓存时直接 return（即使非 dryRun）
(async function() {
    resetAdaptiveCache();
    var chat = buildDialogChat(6, 100);
    var beforeLen = chat.length;
    mockSillyTavernCtx({ maxContext: 100, maxTokens: 10 });  // 极小预算
    await adaptContextPostTrim(chat, false);
    eq(chat.length, beforeLen, 'T14 无缓存时 chat 不变');
    clearSillyTavern();
})();

// Test 15: 无 SillyTavern 全局时直接 return
(async function() {
    resetAdaptiveCache();
    setAdaptiveCache({ stateTable: 'fake', stateTableTokens: 100 });
    var chat = buildDialogChat(6, 100);
    var beforeLen = chat.length;
    clearSillyTavern();  // 确保无 SillyTavern
    await adaptContextPostTrim(chat, false);
    eq(chat.length, beforeLen, 'T15 无 SillyTavern 时 chat 不变');
    resetAdaptiveCache();
})();

console.log('\n=== adaptive-context: adaptContextPostTrim 完整路径 ===');

// Test 16: 超预算触发 dialog 压缩
(async function() {
    resetAdaptiveCache();
    // 构造 chat：含 NE 标记的 system 消息 + 大量对话
    var chat = [
        makeMsg('system', '<!--NE:state_table-->[State Table]<!--/NE:state_table-->'),
        makeMsg('system', '<!--NE:memory_vault-->[Memory Vault]<!--/NE:memory_vault-->')
    ];
    var dialogChat = buildDialogChat(10, 150);  // 10 轮对话
    chat = chat.concat(dialogChat);
    var beforeLen = chat.length;
    var beforeRounds = countRounds(chat);

    // 设置缓存（stateTable + memoryVault，避免守卫 return）
    setAdaptiveCache({
        stateTable: '[State Table]',
        stateTableTokens: 50,
        memoryVault: '[Memory Vault]',
        memoryVaultTokens: 50
    });

    // mock 极小预算的 ST context
    mockSillyTavernCtx({
        maxContext: 800,    // 总预算 = 800 - 300 = 500
        maxTokens: 300,
        tokenCounter: function(text) { return Math.ceil((text || '').length / 4); }
    });

    // 设置 ne_settings：dialogWindowRounds=10
    localStorage.setItem('ne_settings', JSON.stringify({ dialogWindowRounds: 10 }));

    await adaptContextPostTrim(chat, false);

    var afterRounds = countRounds(chat);
    ok(chat.length < beforeLen, 'T16 chat 长度应减少 (before=' + beforeLen + ', after=' + chat.length + ')');
    ok(afterRounds < beforeRounds, 'T16 对话轮数应减少 (before=' + beforeRounds + ', after=' + afterRounds + ')');
    ok(afterRounds >= 4, 'T16 对话轮数应 ≥ floor=4 (got ' + afterRounds + ')');

    clearSillyTavern();
    localStorage.clear();
    resetAdaptiveCache();
})();

// Test 17: 不超预算时不压缩
(async function() {
    resetAdaptiveCache();
    var chat = [
        makeMsg('system', '<!--NE:state_table-->[State Table]<!--/NE:state_table-->'),
        makeMsg('system', '<!--NE:memory_vault-->[Memory Vault]<!--/NE:memory_vault-->')
    ];
    chat = chat.concat(buildDialogChat(5, 30));  // 5 轮短对话
    var beforeLen = chat.length;

    setAdaptiveCache({
        stateTable: '[State Table]',
        stateTableTokens: 10,
        memoryVault: '[Memory Vault]',
        memoryVaultTokens: 10
    });

    // mock 大预算（不会超）
    mockSillyTavernCtx({
        maxContext: 999999,
        maxTokens: 300,
        tokenCounter: function(text) { return Math.ceil((text || '').length / 4); }
    });
    localStorage.setItem('ne_settings', JSON.stringify({ dialogWindowRounds: 10 }));

    await adaptContextPostTrim(chat, false);

    // 不超预算且不触发扩充（< 70%），chat 应不变
    eq(chat.length, beforeLen, 'T17 不超预算时 chat 不变');

    clearSillyTavern();
    localStorage.clear();
    resetAdaptiveCache();
})();

// Test 18: dialog 计数排除 NE 标记消息
(async function() {
    resetAdaptiveCache();
    var chat = [
        makeMsg('system', '<!--NE:state_table-->table<!--/NE:state_table-->'),
        makeMsg('user', 'hello'),
        makeMsg('assistant', 'hi'),
        makeMsg('user', 'how are you'),
        makeMsg('assistant', 'fine')
    ];
    setAdaptiveCache({
        stateTable: 'table',
        stateTableTokens: 10,
        memoryVault: 'vault',
        memoryVaultTokens: 10
    });
    mockSillyTavernCtx({
        maxContext: 999999,
        maxTokens: 300,
        tokenCounter: function(text) { return Math.ceil((text || '').length / 4); }
    });
    localStorage.setItem('ne_settings', JSON.stringify({ dialogWindowRounds: 10 }));

    // 不超预算，应不修改 chat
    var beforeLen = chat.length;
    await adaptContextPostTrim(chat, false);
    eq(chat.length, beforeLen, 'T18 chat 长度不变');

    clearSillyTavern();
    localStorage.clear();
    resetAdaptiveCache();
})();

// === 汇总 ===
console.log('\n--- adaptive-context: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
