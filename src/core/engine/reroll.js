/**
 * NE-Memory 主动重抽（Re-roll）—— 执行器
 *
 * 只由用户主动触发：对「上一次 AI 抽取」的产出做撤销 + 重新提取，不改变对话内容。
 * 采用 **append-only 补偿版本**（git revert 模型），不截断版本链：
 *   state  → 追加 `state_reroll`（撤销 changes）+ 重新提取产生新的 `ai_update`
 *   memory → 追加 `stm_reroll`（移除旧条目）+ 重新抽取产生新的 `stm_batch`
 * 版本链原有逻辑（rollback / fold / compact）不受影响。
 *
 * 消息由 adapter 注入（core 不依赖 ST），见 .trae/documents/reroll-state-memory-plan.md。
 */

import { enqueueStateWrite, enqueueStmWrite } from './pipeline-guard.js';
import { readState, readMemory, rollbackByMsgIds } from '../vault/store.js';
import { foldState, deleteByPath, setByPath, listStateDeltas, listMemoryVersions } from '../vault/state-versions.js';
import { saveStateVault, saveMemoryVault } from './pipeline-shared.js';
import { extractStateChangesOnly } from './state-pipeline.js';
import { executeIncrementalUpdate } from './stm-pipeline.js';
import { buildMsgId, findMessageInChat } from './msg-id.js';
import { buildStateRerollPlan, buildMemoryRerollPlan, computeStateRevertChanges } from './reroll-plan.js';

var VERSION_SCAN_LIMIT = 500;

function _emit(opts, phase, done, total) {
    if (opts && typeof opts.onProgress === 'function') {
        try { opts.onProgress({ phase: phase, done: done, total: total }); } catch (e) {}
    }
}

function _isUser(m) {
    return !!(m && (m.is_user || m.role === 'user'));
}

// 在 chat 中定位消息下标（findMessageInChat 返回对象，需反查下标）
function _resolveIndex(chat, msgId) {
    var m = findMessageInChat(chat, msgId);
    if (!m) return -1;
    return chat.indexOf(m);
}

function _toStateMsg(m, idx) {
    if (!m) return null;
    return {
        role: _isUser(m) ? 'user' : 'assistant',
        name: m.name || '',
        content: m.mes || m.content || '',
        id: m._ne_id || buildMsgId(m, idx)
    };
}

function _toMemMsg(m, idx) {
    return {
        id: m._ne_id || buildMsgId(m, idx),
        is_user: _isUser(m),
        mes: m.mes || m.content || '',
        name: m.name || ''
    };
}

// 恢复抽取窗口：assistant 消息带上前一条 user 消息，与原始 per-round 批次同形态
function _collectBatchIndices(chat, msgIds) {
    var idxSet = {};
    var failed = 0;
    for (var i = 0; i < msgIds.length; i++) {
        var idx = _resolveIndex(chat, msgIds[i]);
        if (idx < 0) { failed++; continue; }
        idxSet[idx] = true;
        var prev = idx - 1;
        if (!_isUser(chat[idx]) && prev >= 0 && _isUser(chat[prev])) idxSet[prev] = true;
    }
    var indices = Object.keys(idxSet).map(function (k) { return parseInt(k, 10); })
        .sort(function (a, b) { return a - b; });
    return { indices: indices, failed: failed };
}

async function _rerollStateInner(chatId, opts) {
    var deltas = await listStateDeltas(chatId, VERSION_SCAN_LIMIT);
    var plan = buildStateRerollPlan({ deltas: deltas, targetSeq: opts.targetSeq });
    if (!plan.ok) return { ok: false, reason: plan.reason, conflicts: [] };

    if (plan.conflicts.length > 0) {
        var decision = typeof opts.resolveConflict === 'function' ? await opts.resolveConflict(plan) : 'cancel';
        if (decision !== 'overwrite') return { ok: false, reason: 'cancelled', conflicts: plan.conflicts };
    }

    var stateVault = await readState(chatId);
    if (!stateVault || !stateVault.content) return { ok: false, reason: 'no_vault', conflicts: plan.conflicts };

    var headState = stateVault.content.state || {};
    var beforeState = await foldState(chatId, plan.startSeq - 1);
    var changes = computeStateRevertChanges({ headState: headState, beforeState: beforeState, paths: plan.affectedPaths });

    for (var i = 0; i < changes.length; i++) {
        var c = changes[i];
        if (c.remove) deleteByPath(headState, c.path);
        else setByPath(headState, c.path, c.new);
    }

    try {
        await saveStateVault(chatId, stateVault, {
            source: 'state_reroll',
            summary: '重抽：撤销 ' + changes.length + ' 项，准备重新提取',
            changes: changes,
            message_dates: plan.messageIds
        });
    } catch (e) {
        console.warn('[NE] rerollState: compensation persist failed', e);
        return { ok: false, reason: 'persist_failed', conflicts: plan.conflicts };
    }
    _emit(opts, 'revert', 1, 1);

    var chat = opts.getChat ? opts.getChat() : [];
    var reextracted = 0;
    var failed = 0;
    for (var k = 0; k < plan.messageIds.length; k++) {
        var idx = _resolveIndex(chat, plan.messageIds[k]);
        if (idx < 0) {
            failed++;
        } else {
            var prevIdx = idx - 1;
            var userMsg = (prevIdx >= 0 && _isUser(chat[prevIdx])) ? _toStateMsg(chat[prevIdx], prevIdx) : null;
            try {
                await extractStateChangesOnly(chatId, userMsg, _toStateMsg(chat[idx], idx));
                reextracted++;
            } catch (e) {
                console.warn('[NE] rerollState: re-extract failed for ' + plan.messageIds[k], e);
                failed++;
            }
        }
        _emit(opts, 'extract', k + 1, plan.messageIds.length);
    }

    return { ok: true, reason: null, reverted: changes.length, reextracted: reextracted, failed: failed, conflicts: plan.conflicts };
}

async function _rerollMemoryInner(chatId, opts) {
    var versions = await listMemoryVersions(chatId, VERSION_SCAN_LIMIT);
    var memoryVault = await readMemory(chatId);
    if (!memoryVault || !memoryVault.content) return { ok: false, reason: 'no_vault', conflicts: [] };

    var plan = buildMemoryRerollPlan({ versions: versions, vault: memoryVault, targetSeq: opts.targetSeq });
    if (!plan.ok) return { ok: false, reason: plan.reason, conflicts: [] };

    if (plan.conflicts.length > 0) {
        var decision = typeof opts.resolveConflict === 'function' ? await opts.resolveConflict(plan) : 'cancel';
        if (decision !== 'overwrite') return { ok: false, reason: 'cancelled', conflicts: plan.conflicts };
    }

    // 必须先落盘移除旧条目：executeIncrementalUpdate 的 force=true 不绕过去重（filterNewMessages），
    // 只有旧条目已不在 vault 中，msg_id 才会被释放，重抽批次才不会被吞掉。
    var removed = rollbackByMsgIds(memoryVault, plan.messageIds);
    var ltmModified = (plan.ltmRefsModified || []).map(function (d) {
        return { ltm_id: d.ltm_id, changes: { stm_refs_removed: d.removedRefs } };
    });

    try {
        await saveMemoryVault(chatId, memoryVault, {
            type: 'stm_reroll',
            summary: '重抽：移除 ' + removed.removedSTM + ' 条旧记忆，准备重新抽取',
            delta: {
                stm_removed: plan.removedSTMIds,
                ltm_removed: plan.removedLTMIds,
                ltm_modified: ltmModified
            },
            message_dates: plan.messageIds
        });
    } catch (e) {
        console.warn('[NE] rerollMemory: compensation persist failed', e);
        return { ok: false, reason: 'persist_failed', conflicts: plan.conflicts };
    }
    _emit(opts, 'remove', 1, 1);

    var chat = opts.getChat ? opts.getChat() : [];
    var collected = _collectBatchIndices(chat, plan.messageIds);
    var batch = collected.indices.map(function (idx) { return _toMemMsg(chat[idx], idx); });
    var failed = collected.failed;
    var reextracted = 0;

    if (batch.length > 0) {
        var forward = function (p) {
            _emit(opts, 'extract', (p && (p.processedMsgs || p.processedTurns)) || 0, batch.length);
        };
        try {
            var result = await executeIncrementalUpdate(chatId, batch, true, forward, { skipResolver: false });
            reextracted = (result && result.added) || 0;
        } catch (e) {
            console.warn('[NE] rerollMemory: re-extract failed', e);
            failed += batch.length;
        }
    }

    return { ok: true, reason: null, reverted: removed.removedSTM, reextracted: reextracted, failed: failed, conflicts: plan.conflicts };
}

/**
 * 重抽 state（最新一条 ai_update）。
 *
 * @param {string} chatId
 * @param {{targetSeq?: number, getChat: function(): object[],
 *          resolveConflict?: function(object): Promise<'overwrite'|'cancel'>,
 *          onProgress?: function(object): void}} opts
 *   getChat() 必须返回【原始 chat 数组】（不是 readChatMessages 的映射形态）
 * @returns {Promise<{ok: boolean, reason: string|null, reverted?: number,
 *   reextracted?: number, failed?: number, conflicts: object[]}>}
 */
export async function rerollState(chatId, opts) {
    var options = opts || {};
    var outcome = null;
    await enqueueStateWrite(async function () {
        try {
            outcome = await _rerollStateInner(chatId, options);
        } catch (e) {
            console.error('[NE] rerollState failed:', e);
            outcome = { ok: false, reason: 'error', conflicts: [] };
        }
    });
    return outcome || { ok: false, reason: 'error', conflicts: [] };
}

/**
 * 重抽 memory（最新一个 stm_batch）。
 *
 * @param {string} chatId
 * @param {{targetSeq?: number, getChat: function(): object[],
 *          resolveConflict?: function(object): Promise<'overwrite'|'cancel'>,
 *          onProgress?: function(object): void}} opts
 * @returns {Promise<{ok: boolean, reason: string|null, reverted?: number,
 *   reextracted?: number, failed?: number, conflicts: object[]}>}
 */
export async function rerollMemory(chatId, opts) {
    var options = opts || {};
    var outcome = null;
    await enqueueStmWrite(async function () {
        try {
            outcome = await _rerollMemoryInner(chatId, options);
        } catch (e) {
            console.error('[NE] rerollMemory failed:', e);
            outcome = { ok: false, reason: 'error', conflicts: [] };
        }
    });
    return outcome || { ok: false, reason: 'error', conflicts: [] };
}
