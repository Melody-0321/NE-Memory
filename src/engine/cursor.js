/**
 * engine/cursor.js — ST-adapted Cursor Engine
 *
 * Solves the "机械均分" problem by sliding a window through pending messages,
 * expanding on empty results, and advancing position based on extraction coverage.
 *
 * Core loop (replaces executeIncrementalUpdate):
 *   window → call LLM → parse → empty? expand/force : advance position
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

// ─── Format window items for prompt injection ───

function formatWindowItems(windowItems, startIdx) {
    var lines = [];
    for (var i = 0; i < windowItems.length; i++) {
        var item = windowItems[i];
        var idx = startIdx + i;
        var role = item.role || (item.is_user ? 'user' : 'assistant');
        lines.push('[' + idx + '] ' + role + ': ' + (item.content || item.mes || ''));
    }
    return lines.join('\n');
}

// ─── Format partial context for prompt ───

function formatPartialContext(partials) {
    if (!partials || partials.length === 0) return '';
    var lines = ['\n## 上次未完成的事件（需要在本次窗口中继续追踪）：'];
    for (var i = 0; i < partials.length; i++) {
        var p = partials[i];
        var desc = p.event || '';
        var range = p.msgRange || [];
        var rangeStr = range.length === 2 ? '[' + range[0] + '-' + range[1] + ']' : '[ongoing]';
        var gen = p._partial_generation || 1;
        lines.push('  ' + (i + 1) + '. ' + rangeStr + ' (' + desc + ') — 第' + gen + '代 partial');
    }
    return lines.join('\n') + '\n';
}

// ─── Build BM25 pre-grouping hint ───

function buildPreGroupHint(windowItems) {
    if (windowItems.length < 2) return '';
    var groups = preGroupItems(windowItems, {
        getText: getMessageContent,
        similarityThreshold: 0.3
    });
    if (!groups || groups.length <= 1) return '';
    return formatPreGroupHint(groups);
}

/**
 * Run the STM cursor extraction loop.
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
 * @returns {Object} { vault, totalAdded, cursorState }
 */
export async function runStmCursorLoop(params) {
    var vault = params.vault;
    var messages = params.messages || [];

    var cursorState = params.getCursorState(vault, 'stm');
    var position = cursorState.position || 0;
    var pendingPartials = (cursorState.pending_partials || []).slice();
    var windowSize = STM_INITIAL_WINDOW;
    var totalAdded = 0;

    // Track partial generations
    for (var i = 0; i < pendingPartials.length; i++) {
        pendingPartials[i]._partial_generation = pendingPartials[i]._partial_generation || 1;
    }

    while (position < messages.length) {
        var end = Math.min(position + windowSize, messages.length);
        var windowItems = messages.slice(position, end);

        if (windowItems.length === 0) break;

        // Force flag: when at hard max or end of all inputs with nothing yet
        var isAtHardMax = windowSize >= STM_MAX_WINDOW;
        var isAtEnd = end >= messages.length;
        var force = false;

        // Delegate prompt building to caller (update.js) for full STM field support
        var prompt = params.buildPrompt(windowItems, position, pendingPartials, vault, force);

        // ── LLM call ──
        var responseText;
        try {
            responseText = await params.callLLM([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
        } catch (e) {
            console.warn('[NE Cursor] LLM call failed:', e.message);
            position = end;
            windowSize = STM_INITIAL_WINDOW;
            continue;
        }

        var parsed = params.parseResponse(responseText);
        var errors = params.validateOutput(parsed, vault, windowItems.length);
        if (errors.length > 0) {
            console.warn('[NE Cursor] Validation:', errors.join('; '));
        }

        // ── Empty result → expand or force ──
        if (parsed.stmEntries.length === 0) {
            if (isAtHardMax || isAtEnd) {
                // Dead end: skip silently if no partials to close
                if (pendingPartials.length === 0 && isAtEnd) {
                    position = end;
                    windowSize = STM_INITIAL_WINDOW;
                    continue;
                }
                // Force retry with aggressive prompt
                var forcePrompt = params.buildPrompt(windowItems, position, pendingPartials, vault, true);
                try {
                    var forceResponse = await params.callLLM([{ role: 'system', content: forcePrompt.system }, { role: 'user', content: forcePrompt.user }]);
                    parsed = params.parseResponse(forceResponse);
                } catch (fe) {
                    console.warn('[NE Cursor] Force LLM call failed:', fe.message);
                }
                if (parsed.stmEntries.length === 0) {
                    position = end;
                    pendingPartials = [];
                    windowSize = STM_INITIAL_WINDOW;
                    continue;
                }
            } else {
                windowSize = Math.min(windowSize + STM_EXPAND_STEP, STM_MAX_WINDOW);
                continue;
            }
        }

        // ── Process results ──
        params.postFill(parsed, vault);
        var stmEntries = parsed.stmEntries;
        var stateChanges = parsed.stateChanges || {};

        if (stmEntries.length > 0) {
            // Map msg_ids
            stmEntries.forEach(function(entry) {
                var range = entry.msgRange || [0, windowItems.length - 1];
                var r0 = Math.max(0, Math.min(range[0], windowItems.length - 1));
                var r1 = Math.max(r0, Math.min(range[1], windowItems.length - 1));
                entry.msg_ids = [];
                for (var j = r0; j <= r1; j++) {
                    var msg = windowItems[j];
                    if (msg) entry.msg_ids.push(msg.id || msg.mes_id || j);
                }
                entry.timestamp = new Date().toISOString();
                entry.parent_ltm = null;
            });

            // ── Partial lifecycle ──

            // 1. Match parent_partial to close pending partials
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

            // 2. Separate closed vs partial (no force-close — caller handles it)
            var newPartials = [];
            for (var ni = 0; ni < stmEntries.length; ni++) {
                var ne = stmEntries[ni];
                if (ne.status === 'partial') {
                    newPartials.push({
                        event: ne.event,
                        entities: ne.entities || [],
                        msgRange: ne.msgRange,
                        _partial_generation: ne._generation || 1
                    });
                }
            }

            // 3. Append to vault
            params.appendEntries(vault, stmEntries);
            totalAdded += stmEntries.length;

            // 4. Advance position: furthest closed entry's end + 1
            var maxClosedEnd = position;
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
            // Don't advance past a pending partial's start
            if (firstPartialStart < Infinity) {
                maxClosedEnd = Math.min(maxClosedEnd, firstPartialStart);
            }
            position = Math.max(position, maxClosedEnd);

            // 5. Update partials & window
            if (newPartials.length > 0) {
                pendingPartials = newPartials;
                if (windowSize < STM_MAX_WINDOW) {
                    windowSize = Math.min(windowSize + STM_EXPAND_STEP, STM_MAX_WINDOW);
                }
            } else {
                pendingPartials = [];
                windowSize = STM_INITIAL_WINDOW;
            }

            // Safety: prevent infinite loop
            if (position <= cursorState.position && newPartials.length === 0) {
                position = Math.min(end, messages.length);
                windowSize = STM_INITIAL_WINDOW;
            }

            // Mark processed
            var allMsgIds = [];
            stmEntries.forEach(function(e) { (e.msg_ids || []).forEach(function(id) { allMsgIds.push(id); }); });
            if (allMsgIds.length > 0) params.markProcessed(vault, allMsgIds);
        }
    }

    // ── Save final cursor state ──
    cursorState.position = position;
    cursorState.pending_partials = pendingPartials.map(function(p) {
        return {
            event: p.event,
            entities: p.entities || [],
            msgRange: p.msgRange,
            _partial_generation: p._partial_generation
        };
    });
    params.updateCursorState(vault, 'stm', cursorState);

    return { vault: vault, cursorState: cursorState, totalAdded: totalAdded };
}
