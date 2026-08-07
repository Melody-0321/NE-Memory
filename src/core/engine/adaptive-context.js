/**
 * adaptive-context.js — 自适应上下文控制（Plan C）
 *
 * 在 CHAT_COMPLETION_PROMPT_READY 事件中触发，测量组装后 chat 数组的总 token 数，
 * 按饱和度轮转摊薄策略压缩/扩充 NE 可变注入层（dialog / memoryVault）。
 *
 * 设计要点：
 * - dialog 层为 PRIMARY 压缩层，floor=4 轮，ceiling=用户设置的 dialogWindowRounds
 * - memoryVault 为次级层，通过 NE 内容标记定位并在原位替换
 * - 无跨生成状态，每次生成独立处理
 */
import { countTokens } from './text-utils.js';
import { readNeSetting } from '../settings.js';

// 黄金窗口分档比例（基于 Lost in the Middle / RULER / Many-Shot ICL 学术依据）
var GOLDEN_TIERS = {
    quality:  { upper: 0.60, lower: 0.42 },
    balanced: { upper: 0.50, lower: 0.30 },
    cost:     { upper: 0.40, lower: 0.24 }
};

// === 模块级缓存（由 events.js 在 NE 注入时通过 setAdaptiveCache 同步）===
var _neCachedVault = null;
var _neCachedState = null;
var _neCachedChatMessages = null;
var _neCachedContent = null;
var _neCachedProtagonistName = null;
var _neCachedStateTable = null;
var _neCachedMemoryVault = null;
var _neCachedStateTableTokens = 0;
var _neCachedMemoryVaultTokens = 0;
var _neLastDialogRoundsAfter = 0;

/**
 * 部分更新缓存。仅更新传入字段，其他字段保持不变。
 * @param {Object} cache - { state, chatMessages, content, protagonistName,
 *                           stateTable, memoryVault, stateTableTokens, memoryVaultTokens }
 */
export function setAdaptiveCache(cache) {
    if (!cache) return;
    if ('state' in cache) _neCachedState = cache.state;
    if ('chatMessages' in cache) _neCachedChatMessages = cache.chatMessages;
    if ('content' in cache) _neCachedContent = cache.content;
    if ('protagonistName' in cache) _neCachedProtagonistName = cache.protagonistName;
    if ('stateTable' in cache) _neCachedStateTable = cache.stateTable;
    if ('memoryVault' in cache) _neCachedMemoryVault = cache.memoryVault;
    if ('stateTableTokens' in cache) _neCachedStateTableTokens = cache.stateTableTokens || 0;
    if ('memoryVaultTokens' in cache) _neCachedMemoryVaultTokens = cache.memoryVaultTokens || 0;
}

export function resetAdaptiveCache() {
    _neCachedState = null;
    _neCachedChatMessages = null;
    _neCachedContent = null;
    _neCachedProtagonistName = null;
    _neCachedStateTable = null;
    _neCachedMemoryVault = null;
    _neCachedStateTableTokens = 0;
    _neCachedMemoryVaultTokens = 0;
}

/* ══════════════════ 纯函数（可独立测试）══════════════════ */

/**
 * 按 KB 等级裁剪 memoryVault 文本。
 * 优先级：先裁"线索"，再裁"间接"。核心等级保留到最后。
 * @param {string} text - 含 [KB:xxx=等级] 分块的 vault 文本
 * @param {number} targetTokens - 目标 token 上限
 * @returns {string}
 */
export function trimMemoryVaultByKB(text, targetTokens) {
    // 早返回：若原文已满足 targetTokens，原样返回避免 split+join 改变空白
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

/**
 * 在 chat 数组中查找 <!--NE:key-->...<!--/NE:key--> 标记并用 newContent 替换标记之间的内容。
 * 标记本身保留，便于后续再次定位。
 * @returns {boolean} 是否找到并替换
 */
export function replaceNeMarkerInChat(chat, key, newContent) {
    var openMarker = '<!--NE:' + key + '-->';
    var closeMarker = '<!--/NE:' + key + '-->';
    for (var i = 0; i < chat.length; i++) {
        var content = chat[i].content || '';
        var startIdx = content.indexOf(openMarker);
        if (startIdx === -1) continue;
        var endIdx = content.indexOf(closeMarker, startIdx);
        if (endIdx === -1) continue;
        chat[i].content = content.substring(0, startIdx + openMarker.length) +
                         newContent +
                         content.substring(endIdx);
        return true;
    }
    return false;
}

/**
 * 按饱和度轮转摊薄压缩，直到总 token ≤ 预算或所有层触底。
 * 饱和度 = current / ceiling；每轮选最高饱和度的层压缩一步。
 *
 * @param {Array} chat - ST 组装后的 chat 数组（会被原地修改）
 * @param {Array} layers - [{ name, current, floor, ceiling }]
 * @param {number} totalTokens - 当前总 tokens
 * @param {number} totalBudget - 预算上限
 * @param {Array} dialogMsgIndices - 对话消息在 chat 中的索引列表
 * @param {Object} ctx - ST context（需有 getTokenCountAsync）
 */
export async function compressLayers(chat, layers, totalTokens, totalBudget, dialogMsgIndices, ctx, dryRun) {
    var spliceOffset = 0;
    var maxIterations = 200;
    var iter = 0;
    while (totalTokens > totalBudget && iter < maxIterations) {
        iter++;
        var maxSat = -Infinity, pick = null;
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            if (l.current <= l.floor) continue;
            var sat = l.current / Math.max(1, l.ceiling);
            if (sat > maxSat) { maxSat = sat; pick = l; }
        }
        if (!pick) break;

        if (pick.name === 'dialog') {
            var didCompress = false;
            for (var j = 0; j < dialogMsgIndices.length - 1; j++) {
                var idx = dialogMsgIndices[j] - spliceOffset;
                if (idx < 0) continue;
                if (chat[idx] && chat[idx].role === 'user' &&
                    chat[idx + 1] && chat[idx + 1].role === 'assistant') {
                    var removedText = (chat[idx].content || '') + '\n' + (chat[idx + 1].content || '');
                    var removedTokens = await ctx.getTokenCountAsync(removedText);
                    chat.splice(idx, 2);
                    spliceOffset += 2;
                    totalTokens -= removedTokens;
                    pick.current--;
                    didCompress = true;
                    break;
                }
            }
            if (!didCompress) {
                pick.current = pick.floor;
            }
        } else if (pick.name === 'memory_vault' && _neCachedMemoryVault) {
            var newTarget = Math.max(pick.floor, Math.round(pick.current * 0.75));
            var newContent = trimMemoryVaultByKB(_neCachedMemoryVault, newTarget);
            var vaultTokens = countTokens(newContent);
            if (vaultTokens >= pick.current) {
                pick.current = pick.floor;
                continue;
            }
            if (!dryRun) _neCachedMemoryVault = newContent;
            replaceNeMarkerInChat(chat, pick.name, newContent);
            totalTokens = await ctx.getTokenCountAsync(
                chat.map(function(m) { return m.content || ''; }).join('\n')
            );
            pick.current = countTokens(newContent);
        }
    }
}

/**
 * 按饱和度轮转摊薄扩充（对话历史跳过，只扩充 memoryVault）。
 * 当 totalTokens < lowerThreshold（黄金窗口下限）时触发。
 */
export async function expandLayers(chat, layers, totalTokens, lowerThreshold, ctx, dryRun) {
    var maxIterations = 100;
    var iter = 0;
    while (totalTokens < lowerThreshold && iter < maxIterations) {
        iter++;
        var minSat = Infinity, pick = null;
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            if (l.name === 'dialog') continue;
            if (l.current >= l.ceiling) continue;
            var sat = l.current / Math.max(1, l.ceiling);
            if (sat < minSat) { minSat = sat; pick = l; }
        }
        if (!pick) break;

        if (pick.name === 'memory_vault' && _neCachedMemoryVault) {
            pick.current = pick.ceiling;
            continue;
        }
    }
}

/* ══════════════════ 主入口 ═══════════════════ */

/**
 * 事后裁剪主函数。在 CHAT_COMPLETION_PROMPT_READY 中调用。
 * 测量组装后总 token，按需压缩/扩充 NE 可变层。
 *
 * @param {Array} chat - ST 组装后的 chat 数组（会被原地修改）
 * @param {boolean} dryRun - dryRun 模式（token 显示预览）跳过
 */
export async function adaptContextPostTrim(chat, dryRun) {
    if (!_neCachedStateTable && !_neCachedMemoryVault) return;

    var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
    if (!ctx || !ctx.getTokenCountAsync) return;

    // 重置调试暴露点（每轮开始时清空，便于测试用例判断是否触发）
    if (!dryRun) globalThis.__ne_debug_last_adaptive = null;

    var maxContext = ctx.maxContext || 32000;
    var genReserve = (ctx.chatCompletionSettings && ctx.chatCompletionSettings.openai_max_tokens) || 300;
    // P1-3: usableBase 原 max(2000, ...) 强抬 2000 下限，maxContext < 2300 的小模型
    // goldenUpper 超过模型实际容量 → 压缩永不触发。改 1000 下限 + goldenUpper 封顶。
    var usableBase = Math.max(1000, maxContext - genReserve);

    // 黄金窗口：绕过 maxContext 100% 阈值，按分档比例在质量退化前压缩
    var goldenTier = readNeSetting('goldenContextTier', 'balanced');
    if (!GOLDEN_TIERS[goldenTier]) goldenTier = 'balanced';

    var ratios = GOLDEN_TIERS[goldenTier];
    var goldenUpper = Math.max(1500, Math.round(usableBase * ratios.upper));
    // P1-3: 压缩触发阈值封顶在可用预算内，确保小模型 goldenUpper 不超过模型实际容量
    goldenUpper = Math.min(goldenUpper, usableBase);
    var goldenLower = Math.max(800, Math.round(usableBase * ratios.lower));

    var dialogCeiling = Number(readNeSetting('dialogWindowRounds', 10)) || 10;

    // 统计对话历史轮数和消息索引
    var dialogRounds = 0;
    var dialogMsgIndices = [];
    var prevRole = null;
    for (var i = 0; i < chat.length; i++) {
        var role = chat[i].role;
        var content = chat[i].content || '';
        var hasNeMarker = content.indexOf('<!--NE:') !== -1;
        if ((role === 'user' || role === 'assistant') && !hasNeMarker) {
            dialogMsgIndices.push(i);
            if (prevRole === 'user' && role === 'assistant') {
                dialogRounds++;
            }
        }
        prevRole = role;
    }

    var allText = chat.map(function(m) { return m.content || ''; }).join('\n');
    var totalTokens = await ctx.getTokenCountAsync(allText);

    // 记录压缩前快照（供调试暴露）
    var totalTokensBefore = totalTokens;
    var dialogRoundsBefore = dialogRounds;
    var chatLengthBefore = chat.length;

    var layers = [
        { name: 'dialog', current: dialogRounds, floor: 4, ceiling: dialogCeiling },
        { name: 'memory_vault', current: _neCachedMemoryVaultTokens, floor: 150, ceiling: 2000 },
    ];

    var action = 'none';
    if (totalTokens > goldenUpper) {
        action = 'compress';
        await compressLayers(chat, layers, totalTokens, goldenUpper, dialogMsgIndices, ctx, dryRun);
    } else if (totalTokens < goldenLower) {
        action = 'expand';
        await expandLayers(chat, layers, totalTokens, goldenLower, ctx, dryRun);
    }

    // 压缩/扩充后重新测量（供测试断言 + 排查）
    var allTextAfter = chat.map(function(m) { return m.content || ''; }).join('\n');
    var totalTokensAfter = await ctx.getTokenCountAsync(allTextAfter);

    // 重新统计压缩后对话轮数
    var dialogRoundsAfter = 0;
    var prevRoleAfter = null;
    for (var j = 0; j < chat.length; j++) {
        var roleA = chat[j].role;
        var contentA = chat[j].content || '';
        var hasNeMarkerA = contentA.indexOf('<!--NE:') !== -1;
        if ((roleA === 'user' || roleA === 'assistant') && !hasNeMarkerA) {
            if (prevRoleAfter === 'user' && roleA === 'assistant') {
                dialogRoundsAfter++;
            }
        }
        prevRoleAfter = roleA;
    }

    // 暴露调试数据（供 monitor.js collectRoundData 收集 → assertions.js 断言）
    if (!dryRun) {
        globalThis.__ne_debug_last_adaptive = {
            triggered: true,
            action: action,
            totalTokensBefore: totalTokensBefore,
            totalTokensAfter: totalTokensAfter,
            totalBudget: goldenUpper,
            goldenTier: goldenTier,
            goldenUpper: goldenUpper,
            goldenLower: goldenLower,
            dialogRoundsBefore: dialogRoundsBefore,
            dialogRoundsAfter: dialogRoundsAfter,
            chatLengthBefore: chatLengthBefore,
            chatLengthAfter: chat.length,
            layers: layers.map(function(l) { return { name: l.name, current: l.current, floor: l.floor, ceiling: l.ceiling }; }),
            timestamp: Date.now()
        };
        _neLastDialogRoundsAfter = dialogRoundsAfter;
    }
}

export function getLastDialogRoundsAfter() {
    return _neLastDialogRoundsAfter;
}
