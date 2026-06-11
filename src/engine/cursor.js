/**
 * engine/cursor.js — ST-adapted Cursor Engine
 *
 * Sliding-window STM extraction with partial tracking.
 * All windows collected → single batched LLM call → cursor logic on results.
 */

import { preGroupItems, formatPreGroupHint } from './bm25-grouper.js';

// ─── Window constants ───

var STM_INITIAL_WINDOW = 4;
var STM_EXPAND_STEP = 4;
var STM_MAX_WINDOW = 20;

// ─── Get content from message items (for BM25 grouper) ───

function getMessageContent(item) {
    return item.content || item.mes || '';
}

/**
 * Run the STM cursor extraction loop.
 * All windows → single batched LLM call → per-window cursor logic.
 *
 * @param {Object} params
 * @param {Object} params.vault - The vault (will be mutated)
 * @param {Array} params.messages - Raw message objects to extract from
 * @param {Function} params.callLLM - async (prompt) → responseText
 * @param {Function} params.parseResponse - (text) → { stmEntries, stateChanges }
 * @param {Function} params.validateOutput - (parsed, vault, messageCount) → errors[]
 * @param {Function} params.postFill - (parsed, vault) → void (fills period/scene)
 * @param {Function} params.appendEntries - (vault, entries) → void
 * @param {Function} params.getCursorState - (vault, mode) → { position, pending_partials }
 * @param {Function} params.updateCursorState - (vault, mode, state) → void
 * @param {Function} params.markProcessed - (vault, msgIds) → void
 * @param {Function} params.buildPrompt - (windowItems, position, partials, vault, force) → {system, user}
 * @returns {Object} { vault, totalAdded, cursorState }
 */
export async function runStmCursorLoop(params) {
    var vault = params.vault;
    var messages = params.messages || [];

    var cursorState = params.getCursorState(vault, 'stm');
    var position = cursorState.position || 0;
    // position tracks global msg index, but we only receive unprocessed batch
    // if position is past this batch, reset to 0 (stale from prev incomplete run)
    if (position >= messages.length) position = 0;
    var pendingPartials = (cursorState.pending_partials || []).slice();
    var totalAdded = 0;
    console.log('[NE Cursor] Starting — messages.length=' + messages.length + ', position=' + position + ', partials=' + pendingPartials.length);

    for (var i = 0; i < pendingPartials.length; i++) {
        pendingPartials[i]._partial_generation = pendingPartials[i]._partial_generation || 1;
    }

    // ── Phase A: 滑动窗口收集所有窗口规格 ──
    var windowSpecs = [];
    var curPos = position;
    var curWinSize = STM_INITIAL_WINDOW;

    while (curPos < messages.length) {
        var end = Math.min(curPos + curWinSize, messages.length);
        if (end <= curPos) break;

        var items = messages.slice(curPos, end);
        windowSpecs.push({
            items: items,
            position: curPos,
            partials: curPos === position ? pendingPartials.slice() : [],
            windowSize: curWinSize
        });

        curPos = end;
        curWinSize = Math.min(curWinSize + STM_EXPAND_STEP, STM_MAX_WINDOW);
    }

    if (windowSpecs.length === 0) {
        console.log('[NE Cursor] No windowSpecs — returning early (position=' + position + ' >= messages.length=' + messages.length + ')');
        params.updateCursorState(vault, 'stm', { position: position, pending_partials: pendingPartials });
        return { vault: vault, cursorState: { position: position, pending_partials: pendingPartials }, totalAdded: 0 };
    }

    console.log('[NE Cursor] windowSpecs=' + windowSpecs.length + ', building prompt...');

    // ── Phase B: 构建合并 prompt ──
    var firstSpec = windowSpecs[0];
    var basePrompt = params.buildPrompt(firstSpec.items, firstSpec.position, firstSpec.partials, vault, false);
    var combinedSystem = basePrompt.system;
    var combinedUserParts = [];

    for (var wi = 0; wi < windowSpecs.length; wi++) {
        var ws = windowSpecs[wi];
        var p = params.buildPrompt(ws.items, ws.position, wi === 0 ? ws.partials : [], vault, false);
        combinedUserParts.push(
            (wi === 0 ? '' : '\n\n=== WINDOW ' + (wi + 1) + ' (msg [' + ws.position + '–' + (ws.position + ws.items.length - 1) + ']) ===\n')
            + p.user
        );
    }
    var combinedUser = combinedUserParts.join('');

    // ── Phase C: 单次 LLM 调用 ──
    var responseText;
    try {
        console.log('[NE Cursor] Calling LLM...');
        responseText = await params.callLLM([
            { role: 'system', content: combinedSystem },
            { role: 'user', content: combinedUser }
        ]);
    } catch (e) {
        console.warn('[NE Cursor] Batched LLM call failed:', e.message);
        params.updateCursorState(vault, 'stm', { position: position, pending_partials: pendingPartials });
        return { vault: vault, cursorState: { position: position, pending_partials: pendingPartials }, totalAdded: 0 };
    }

    // ── Phase D: 解析 + 按窗口分割结果 ──
    var windowResults;
    try {
        windowResults = splitWindowResponse(responseText, windowSpecs.length);
    } catch (se) {
        // Fallback: treat entire response as single window
        windowResults = [responseText];
    }

    var allEntries = [];

    for (var wi2 = 0; wi2 < windowSpecs.length; wi2++) {
        var ws2 = windowSpecs[wi2];
        var respText = windowResults[wi2] || '';

        var parsed;
        try {
            parsed = params.parseResponse(respText);
        } catch (pe) {
            console.warn('[NE Cursor] Failed to parse window', wi2 + 1, ':', pe.message);
            continue;
        }

        var errors = params.validateOutput(parsed, vault, messages.length);
        if (errors.length > 0) {
            console.warn('[NE Cursor] Validation window', wi2 + 1, ':', errors.join('; '));
        }

        if (parsed.stmEntries.length === 0) continue;

        params.postFill(parsed, vault);
        var stmEntries = parsed.stmEntries;

        // Map msg_ids
        stmEntries.forEach(function(entry) {
            var rawRange = entry.msgRange || [ws2.position, ws2.position + ws2.items.length - 1];
            // Convert global offsets to window-local indices
            var r0 = rawRange[0] - ws2.position;
            var r1 = rawRange[1] - ws2.position;
            r0 = Math.max(0, Math.min(r0, ws2.items.length - 1));
            r1 = Math.max(r0, Math.min(r1, ws2.items.length - 1));
            entry.msg_ids = [];
            for (var j = r0; j <= r1; j++) {
                var msg = ws2.items[j];
                if (msg) entry.msg_ids.push(msg.id || msg.mes_id || (ws2.position + j));
            }
            entry.timestamp = new Date().toISOString();
            entry.parent_ltm = null;
        });

        // ── Partial lifecycle ──
        for (var pi = 0; pi < stmEntries.length; pi++) {
            var entry = stmEntries[pi];
            if (entry.parent_partial && pendingPartials.length > 0) {
                var matchIdx = pendingPartials.findIndex(function(p) {
                    return p.event === entry.parent_partial;
                });
                if (matchIdx >= 0) {
                    entry._generation = (pendingPartials[matchIdx]._partial_generation || 1) + 1;
                    pendingPartials.splice(matchIdx, 1);
                }
            }
            if (!entry._generation) entry._generation = 1;
        }

        // Separate closed vs partial
        var newPartials = [];
        for (var ei = 0; ei < stmEntries.length; ei++) {
            var e2 = stmEntries[ei];
            if (e2.status === 'partial') {
                newPartials.push({
                    event: e2.event,
                    entities: e2.entities || [],
                    msgRange: e2.msgRange,
                    _partial_generation: e2._generation || 1
                });
            }
        }

        // Advance position logic (per-window)
        var maxClosedEnd = ws2.position;
        var firstPartialStart = Infinity;
        for (var ai = 0; ai < stmEntries.length; ai++) {
            var ae = stmEntries[ai];
            var aeRange = ae.msgRange || [];
            if (ae.status === 'closed' && aeRange[1] !== undefined) {
                maxClosedEnd = Math.max(maxClosedEnd, aeRange[1] + 1);
            }
            if (ae.status === 'partial' && aeRange[0] !== undefined) {
                firstPartialStart = Math.min(firstPartialStart, aeRange[0]);
            }
        }
        if (firstPartialStart < Infinity) {
            maxClosedEnd = Math.min(maxClosedEnd, firstPartialStart);
        }
        var windowEnd = ws2.position + ws2.items.length;
        if (newPartials.length > 0 && firstPartialStart < ws2.position + ws2.items.length) {
            // Don't advance past partial start
        }

        // Merge: keep unmatched old partials + add new ones (preserves cross-batch partials)
        pendingPartials = pendingPartials.concat(newPartials);

        allEntries = allEntries.concat(stmEntries);
    }

    // ── Phase E: 追加所有条目 ──
    if (allEntries.length > 0) {
        params.appendEntries(vault, allEntries);
        totalAdded += allEntries.length;

        var allMsgIds = [];
        allEntries.forEach(function(e) {
            (e.msg_ids || []).forEach(function(id) { allMsgIds.push(id); });
        });
        if (allMsgIds.length > 0) params.markProcessed(vault, allMsgIds);
    }

    // ── Save final cursor state ──
    var finalState = {
        position: messages.length,
        pending_partials: pendingPartials.map(function(p) {
            return {
                event: p.event,
                entities: p.entities || [],
                msgRange: p.msgRange,
                _partial_generation: p._partial_generation
            };
        })
    };
    params.updateCursorState(vault, 'stm', finalState);

    return { vault: vault, cursorState: finalState, totalAdded: totalAdded };
}

// ─── 分割合并 LLM 响应为 per-window 块 ───

function splitWindowResponse(text, windowCount) {
    if (windowCount <= 1) return [text];

    // Try explicit delimiters
    var parts = text.split(/=== WINDOW \d+ \([^)]+\) ===/);
    if (parts.length >= windowCount) {
        var trimmed = parts.map(function(p) { return p.trim(); }).filter(function(p) { return p.length > 0; });
        if (trimmed.length >= windowCount) return trimmed.slice(0, windowCount);
    }

    return [text];
}
