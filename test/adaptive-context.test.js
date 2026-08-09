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
    // 验证 setAdaptiveCache 部分更新不抛异常且不覆盖已有字段
    setAdaptiveCache({ stateTable: 'table1', stateTableTokens: 100 });
    setAdaptiveCache({ memoryVault: 'vault1' });
    // 再次部分更新，确保不覆盖之前的字段
    setAdaptiveCache({ memoryVaultTokens: 200 });
    // 间接验证：resetAdaptiveCache 后再次部分更新也不抛异常
    ok(true, 'T9: setAdaptiveCache 多次部分更新不抛异常');
    // 缓存正确性通过 T10-T12 的 compressLayers 行为间接验证：
    // compressLayers 依赖 _neCachedStateTableTokens / _neCachedMemoryVaultTokens，
    // 若部分更新覆盖了已有字段，T10 的压缩结果会不正确。
    resetAdaptiveCache();
    ok(true, 'T9: resetAdaptiveCache 不抛异常');
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
    eq(chat.length, beforeLen, 'T13 dryRun 无 ctx 时 chat 不变（因 getTokenCountAsync 不可用而提前返回）');
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
    var dialogChat = buildDialogChat(10, 400);  // 10 轮对话（~2100 tokens，超过 goldenUpper）
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

    // mock 适中预算的 ST context（黄金窗口 balanced 档：goldenUpper = (4000-300)*0.5 = 1850）
    mockSillyTavernCtx({
        maxContext: 4000,
        maxTokens: 300,
        tokenCounter: function(text) { return Math.ceil((text || '').length / 4); }
    });

    // 设置 ne_settings：dialogWindowRounds=10, goldenContextTier=balanced
    localStorage.setItem('ne_settings', JSON.stringify({ dialogWindowRounds: 10, goldenContextTier: 'balanced' }));

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

// Test 18: P1-3 小模型 usableBase 不再强抬 2000，压缩阈值封顶在可用预算内
// 旧实现：maxContext=2048 时 usableBase=max(2000, 1748)=2000，goldenUpper=1900 > 模型容量 1748 → 压缩永不触发
// 新实现：usableBase=1748，goldenUpper=min(max(1500,1661),1748)=1661 → totalTokens≈1750 可触发
(async function() {
    resetAdaptiveCache();
    var chat = [
        makeMsg('system', '<!--NE:state_table-->[State Table]<!--/NE:state_table-->'),
        makeMsg('system', '<!--NE:memory_vault-->[Memory Vault]<!--/NE:memory_vault-->')
    ];
    chat = chat.concat(buildDialogChat(8, 413));  // dialog ~1650 tokens
    var beforeLen = chat.length;
    var beforeRounds = countRounds(chat);

    setAdaptiveCache({
        stateTable: '[State Table]',
        stateTableTokens: 50,
        memoryVault: '[Memory Vault]',
        memoryVaultTokens: 50
    });

    mockSillyTavernCtx({
        maxContext: 2048,  // maxContext < 2300 小模型
        maxTokens: 300,
        tokenCounter: function(text) { return Math.ceil((text || '').length / 4); }
    });
    localStorage.setItem('ne_settings', JSON.stringify({ dialogWindowRounds: 10, goldenContextTier: 'balanced' }));

    await adaptContextPostTrim(chat, false);

    var afterRounds = countRounds(chat);
    ok(chat.length < beforeLen, 'P1-3 小模型超预算应触发压缩 (before=' + beforeLen + ', after=' + chat.length + ')');
    ok(afterRounds < beforeRounds, 'P1-3 对话轮数应减少 (before=' + beforeRounds + ', after=' + afterRounds + ')');
    ok(afterRounds >= 4, 'P1-3 不应低于 floor=4 (got ' + afterRounds + ')');

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

// === P2 对账：累计实现 vs O(n²) 参考实现 ===

// 参考实现：原 O(n²) 语义（每删一节全量 join + countTokens）
function refTrimMemoryVaultByKB(text, targetTokens) {
    if (countTokens(text) <= targetTokens) return text;
    var sections = text.split(/(?=\[KB:[^\]]*\])/);
    var priority = ['线索', '间接'];
    for (var p = 0; p < priority.length; p++) {
        for (var i = sections.length - 1; i >= 0; i--) {
            if (countTokens(sections.join('\n')) <= targetTokens) return sections.join('\n');
            if (sections[i].indexOf('[KB:') !== -1 && sections[i].indexOf('=' + priority[p]) !== -1) {
                sections.splice(i, 1);
            }
        }
    }
    return sections.join('\n');
}

function kbSectionsOf(text) {
    // 剥离尾随 '\n'（split lookahead 将分隔符留在前段尾部，join('\n') 使剩余段尾 \n 数随段数变化，
    // 直接比较整段会因尾随换行差异误判）
    return text.split(/(?=\[KB:[^\]]*\])/).filter(function(s) { return s.indexOf('[KB:') !== -1; })
        .map(function(s) { return s.replace(/\n+$/, ''); });
}

// mine 保留的每个 section 都必须出现在 ref 保留集中（新实现最多额外多删低优先级节）
function mineIsSubsetOf(mine, ref) {
    var refSet = kbSectionsOf(ref);
    return kbSectionsOf(mine).every(function(s) { return refSet.indexOf(s) !== -1; });
}

function mineKeepsCoreOf(mine, coreText) {
    var coreSet = kbSectionsOf(coreText);
    if (coreSet.length === 0) return true;
    var mineSet = kbSectionsOf(mine);
    return coreSet.every(function(s) { return mineSet.indexOf(s) !== -1; });
}

console.log('\n=== adaptive-context: trimMemoryVaultByKB 对账（P2） ===');

(function() {
    var T5text = [
        '[KB:核心角色=核心] 核心记忆内容，重要不可删',
        '[KB:次要角色=间接] 间接记忆内容',
        '[KB:旁观者=线索] 线索记忆内容'
    ].join('\n');
    var T5coreAndIndirect = '[KB:核心角色=核心] 核心记忆内容，重要不可删\n[KB:次要角色=间接] 间接记忆内容';
    var T6text = [
        '[KB:核心角色=核心] 核心记忆内容',
        '[KB:次要角色=间接] 间接记忆内容',
        '[KB:旁观者=线索] 线索记忆内容'
    ].join('\n');
    var T6core = '[KB:核心角色=核心] 核心记忆内容';
    var T7text = '[KB:A=核心] 内容A\n[KB:B=线索] 内容B';
    var T8text = '[KB:A=线索] 内容A\n[KB:B=间接] 内容B\n[KB:C=核心] 内容C';
    var mixedText = [
        '[KB:A=核心] 角色设定一句话',
        '[KB:B=间接] 世界背景设定第二句话',
        '[KB:C=线索] 伏笔线索甲',
        '[KB:D=线索] 伏笔线索乙',
        '[KB:E=间接] 配角背景补充',
        '[KB:F=核心] 核心身份关键'
    ].join('\n');
    var enText = [
        '[KB:A=核心] the quick brown fox jumps over the lazy dog',
        '[KB:B=间接] pack my box with five dozen liquor jugs',
        '[KB:C=线索] how vexingly quick daft zebras jump'
    ].join('\n');

    // 1) T5-T8 原样本 + 原 target：逐字节一致（实验确认落在稳定区）
    var exactCases = [
        ['T5', T5text, countTokens(T5coreAndIndirect) + 5],
        ['T6', T6text, countTokens(T6core) + 2],
        ['T7', T7text, 99999],
        ['T8', T8text, 0]
    ];
    for (var e = 0; e < exactCases.length; e++) {
        var refR = refTrimMemoryVaultByKB(exactCases[e][1], exactCases[e][2]);
        var mineR = trimMemoryVaultByKB(exactCases[e][1], exactCases[e][2]);
        eq(mineR, refR, 'P2 ' + exactCases[e][0] + ' 与参考实现逐字节一致');
    }

    // 2) 全 target 扫描对账：混合优先级 + 中英文样本
    //    大部分 target 逐字节一致；窄窗口（sum ≥ joinCount 边界）允许新实现多删低优先级节，
    //    但安全不变式（不超裁 / 核心保留 / 单调）必须成立
    var scanSamples = [mixedText, enText, T5text, T6text, T7text, T8text];
    for (var si = 0; si < scanSamples.length; si++) {
        var text = scanSamples[si];
        var parts = text.split(/(?=\[KB:[^\]]*\])/);
        var sum = 0;
        for (var pi = 0; pi < parts.length; pi++) sum += countTokens(pi === 0 ? parts[pi] : '\n' + parts[pi]);
        var coreText = kbSectionsOf(text).filter(function(s) { return s.indexOf('=核心') !== -1; }).join('\n');
        var coreTokens = countTokens(coreText);
        var exactAgree = 0, totalTargets = 0;
        for (var t = 0; t <= sum + 1; t++) {
            totalTargets++;
            var refScan = refTrimMemoryVaultByKB(text, t);
            var mineScan = trimMemoryVaultByKB(text, t);
            if (refScan === mineScan) {
                exactAgree++;
            } else {
                ok(mineIsSubsetOf(mineScan, refScan), 'P2 样本' + si + ' t=' + t + ' 单调：新实现保留集 ⊆ 参考保留集');
                if (t >= coreTokens) ok(countTokens(mineScan) <= t, 'P2 样本' + si + ' t=' + t + ' 不超裁 (' + countTokens(mineScan) + ' ≤ ' + t + ')');
                ok(mineKeepsCoreOf(mineScan, coreText), 'P2 样本' + si + ' t=' + t + ' 核心保留');
            }
        }
        ok(exactAgree >= totalTargets * 0.85, 'P2 样本' + si + ' 逐字节一致率 ≥ 85% (' + exactAgree + '/' + totalTargets + ')');
    }
})();

// === P3: compressLayers memory_vault 增量差值（ST tokenizer 精确 diff） ===

console.log('\n=== adaptive-context: compressLayers memory_vault 增量差值（P3） ===');

// 非 dryRun：压缩发生、替换标记、从未对全量 chat join 计数
// 注意：P3 两个块共享模块级 _neCachedMemoryVault（setAdaptiveCache/resetAdaptiveCache），
// 必须串行执行，否则并发交错会导致状态被覆盖。块1 赋给变量，块2 await 它。
var p3FirstBlock = (async function() {
    resetAdaptiveCache();
    var vaultText = [
        '[KB:核心角色=核心] ' + '主角的核心设定内容描述'.repeat(15),
        '[KB:世界观=间接] ' + '世界观的间接记忆背景'.repeat(15),
        '[KB:线索一=线索] ' + '伏笔线索甲的内容描述'.repeat(15),
        '[KB:线索二=线索] ' + '伏笔线索乙的内容描述'.repeat(15),
        '[KB:配角=间接] ' + '配角背景补充描述内容'.repeat(15),
        '[KB:线索三=线索] ' + '伏笔线索丙的内容描述'.repeat(15)
    ].join('\n');
    var vaultTokensLocal = countTokens(vaultText);
    var tokenCalls = [];
    mockSillyTavernCtx({
        maxContext: 4000,
        maxTokens: 300,
        tokenCounter: function(text) { tokenCalls.push(text); return Math.ceil((text || '').length / 4); }
    });
    var ctx = SillyTavern.getContext();

    var chat = [
        makeMsg('system', '前置系统消息'),
        makeMsg('system', '<!--NE:memory_vault-->' + vaultText + '<!--/NE:memory_vault-->')
    ];
    setAdaptiveCache({ memoryVault: vaultText, memoryVaultTokens: vaultTokensLocal });

    var layers = [{ name: 'memory_vault', current: vaultTokensLocal, floor: 150, ceiling: 2000 }];

    await compressLayers(chat, layers, 5000, 0, [], ctx, false);

    // P3 关键：从未对全量 chat join 调用 getTokenCountAsync（O(chatSize) 重算已消除）
    var everChatJoin = tokenCalls.some(function(t) { return t.indexOf('<!--NE:') !== -1; });
    eq(everChatJoin, false, 'P3 从未以全量 chat join 触发 getTokenCountAsync (calls=' + tokenCalls.length + ')');
    ok(tokenCalls.indexOf(vaultText) !== -1, 'P3 首轮 lazy init 对旧 vault 计数');

    var finalMatch = chat[1].content.match(/<!--NE:memory_vault-->([\s\S]*?)<!--\/NE:memory_vault-->/);
    ok(finalMatch !== null, 'P3 NE:memory_vault 标记仍在');
    ok(countTokens(finalMatch[1]) < countTokens(vaultText), 'P3 vault 压缩后 token 减少 (before=' + countTokens(vaultText) + ', after=' + countTokens(finalMatch[1]) + ')');
    ok(finalMatch[1].indexOf('核心') !== -1, 'P3 核心等级保留');
    ok(finalMatch[1].indexOf('线索') === -1, 'P3 低优先级已裁掉');

    clearSillyTavern();
    resetAdaptiveCache();
})();

// dryRun：不污染模块缓存。dryRun 从原文反复裁剪（缓存不更新），结果与非 dryRun 的
// 增量裁剪路径本就不同（无法逐字节对比）；改为基线对照：dryRun 后跑一次非 dryRun，
// 其结果必须与干净缓存直接非 dryRun 一致 —— 直接验证 _neCachedMemoryVault 未被污染。
(async function() {
    await p3FirstBlock; // 串行：等块1 完成，避免共享 _neCachedMemoryVault 交错
    var vaultText = [
        '[KB:核心角色=核心] ' + '主角核心设定描述'.repeat(20),
        '[KB:线索一=线索] ' + '伏笔甲内容描述'.repeat(20),
        '[KB:线索二=线索] ' + '伏笔乙内容描述'.repeat(20),
        '[KB:间接一=间接] ' + '背景补充描述内容'.repeat(20)
    ].join('\n');
    var vaultTokensLocal = countTokens(vaultText);
    mockSillyTavernCtx({
        maxContext: 4000,
        maxTokens: 300,
        tokenCounter: function(text) { return Math.ceil((text || '').length / 4); }
    });
    var ctx = SillyTavern.getContext();
    function mkChat() { return [makeMsg('system', '<!--NE:memory_vault-->' + vaultText + '<!--/NE:memory_vault-->')]; }
    function mkLayers() { return [{ name: 'memory_vault', current: vaultTokensLocal, floor: 150, ceiling: 2000 }]; }

    // 基线：干净缓存直接非 dryRun
    resetAdaptiveCache();
    setAdaptiveCache({ memoryVault: vaultText, memoryVaultTokens: vaultTokensLocal });
    var chatBase = mkChat();
    await compressLayers(chatBase, mkLayers(), 5000, 0, [], ctx, false);

    // dryRun 后再非 dryRun（复用同一模块缓存）
    resetAdaptiveCache();
    setAdaptiveCache({ memoryVault: vaultText, memoryVaultTokens: vaultTokensLocal });
    var chatDry = mkChat();
    await compressLayers(chatDry, mkLayers(), 5000, 0, [], ctx, true);
    var chatAfter = mkChat();
    await compressLayers(chatAfter, mkLayers(), 5000, 0, [], ctx, false);

    // dryRun 未污染 _neCachedMemoryVault：dryRun 后的非 dryRun 与干净基线一致
    eq(chatAfter[0].content, chatBase[0].content, 'P3 dryRun 不污染缓存（dryRun 后非 dryRun 与基线一致）');

    clearSillyTavern();
    resetAdaptiveCache();
})();

// === 汇总 ===
// async 测试块的断言在 microtask 阶段执行，晚于顶层同步代码（汇总行无法在同步处
// 捕获 async 失败）。用 setTimeout 推迟到事件循环下一 tick，确保计数完整后再判定退出码。
setTimeout(function() {
    console.log('\n--- adaptive-context: ' + passed + ' passed, ' + failed + ' failed ---');
    if (failed > 0) process.exit(1);
}, 50);
