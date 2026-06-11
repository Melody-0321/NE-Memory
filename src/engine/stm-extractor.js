/**
 * engine/stm-extractor.js — Hub-Spoke STM extraction engine
 *
 * Replaces cursor.js. Main LLM segments turns into semantic events,
 * spawns parallel sub-agents for each event range, then code-fills metadata.
 * Single-event path skips tool calling entirely.
 *
 * Batch support: processTurnsInBatches() splits large turn sets into
 * maxTurns-sized batches with deferred carry-forward between batches.
 */

import { callMemoryLLMWithTools, callMemoryPipeline, loadSecondaryApiConfig } from '../api/llm.js';
import { EXTRACT_STM_TOOL_SCHEMA } from '../tools.js';
import { groupMessagesIntoTurns, formatTurnsText, collectMsgIdsFromTurns } from './turn-segmenter.js';

var DEFAULT_MAX_TURNS = 10;

// ── 外层入口（向后兼容）──

export async function runStmExtractor(params) {
    var messages = params.messages;
    var turns = groupMessagesIntoTurns(messages);
    return runStmExtractorCore(turns, params);
}

// ── 内层（直接接收 turns）──

export async function runStmExtractorCore(turns, params) {
    var vault = params.vault;
    var callLLM = params.callLLM;
    var parseResponse = params.parseResponse;
    var validateOutput = params.validateOutput;
    var postFill = params.postFill;
    var appendEntries = params.appendEntries;
    var getCursorState = params.getCursorState;
    var updateCursorState = params.updateCursorState;
    var markProcessed = params.markProcessed;
    var buildSegmentationPrompt = params.buildSegmentationPrompt;
    var buildSubAgentPrompt = params.buildSubAgentPrompt;
    var carryForwardCount = params.carryForwardCount || 0;
    var maxTurns = params.maxTurns || DEFAULT_MAX_TURNS;

    if (!turns || turns.length === 0) {
        return { vault: vault, cursorState: null, totalAdded: 0, tailDeferred: [] };
    }

    var cursorState = getCursorState(vault, 'stm');
    var pendingPartials = cursorState.pending_partials || [];

    // Phase B: Build segmentation prompt
    var segPrompt = buildSegmentationPrompt(turns, pendingPartials, vault);

    // Phase B1: Determine if tool calling is available
    var secCfg = loadSecondaryApiConfig();
    var hasTools = secCfg && secCfg.url && secCfg.model;

    var stmEntries = [];
    var allMsgIds = [];
    var deferredTurns = [];
    var turnIndexToEventIdx = {};
    var totalAdded = 0;

    if (hasTools) {
        // === Hub-Spoke path (multi-event with parallel sub-agents) ===
        var subAgentExecutor = async function(args) {
            var turnIndices = [];
            var start = args.turns[0];
            var end = args.turns[1];
            for (var ti = start; ti <= end; ti++) turnIndices.push(ti);

            var summary = args.event_summary || '';
            var subPrompt = buildSubAgentPrompt(turns, turnIndices, summary, vault);

            var subResponse = await callMemoryPipeline([
                { role: 'system', content: subPrompt.system },
                { role: 'user', content: subPrompt.user }
            ]);

            var parsed = {};
            try {
                var cleaned = String(subResponse || '').replace(/```json\s*/g, '').replace(/```/g, '').trim();
                var idx = cleaned.indexOf('{');
                if (idx !== -1) cleaned = cleaned.substring(idx);
                var endIdx = cleaned.lastIndexOf('}');
                if (endIdx !== -1) cleaned = cleaned.substring(0, endIdx + 1);
                parsed = JSON.parse(cleaned);
            } catch (e) {
                parsed = { event: (summary || String(subResponse).substring(0, 80)), status: 'closed' };
            }

            var msgIds = collectMsgIdsFromTurns(turns, turnIndices);
            var isDeferred = parsed.status === 'deferred' || args.status === 'deferred';

            return JSON.stringify({
                event: parsed.event || summary,
                status: isDeferred ? 'deferred' : (parsed.status || args.status || 'closed'),
                entity: parsed.entity || '',
                turns: [start, end],
                msg_ids: msgIds,
                deferred: isDeferred
            });
        };

        var toolExecs = {
            extract_stm: subAgentExecutor
        };

        var segMessages = [
            { role: 'system', content: segPrompt.system },
            { role: 'user', content: segPrompt.user }
        ];

        var mainLLMResponse = '';
        try {
            mainLLMResponse = await callMemoryLLMWithTools(segMessages, [EXTRACT_STM_TOOL_SCHEMA], toolExecs);
        } catch (e) {
            console.warn('[NE] Hub-Spoke main LLM failed:', e.message);
        }

        // Parse main LLM final response
        var finalText = String(mainLLMResponse || '').trim();

        // Extract deferred entries from tool results
        var toolResultEntries = [];
        for (var ri = 0; ri < segMessages.length; ri++) {
            if (segMessages[ri].role === 'tool') {
                try {
                    var tr = JSON.parse(segMessages[ri].content);
                    if (tr && tr.deferred) {
                        deferredTurns.push(tr.turns[0]);
                        if (tr.turns[1] > tr.turns[0]) {
                            for (var di = tr.turns[0] + 1; di <= tr.turns[1]; di++) deferredTurns.push(di);
                        }
                    } else if (tr && tr.event && tr.turns) {
                        toolResultEntries.push(tr);
                    }
                } catch (e) {}
            }
        }

        if (finalText) {
            try {
                // Check for deferred list in text output (fallback for single-event path)
                var deferredMatch = finalText.match(/\{"deferred"\s*:\s*\[([^\]]+)\]\}/);
                if (deferredMatch) {
                    try {
                        var txtDeferred = JSON.parse('[' + deferredMatch[1] + ']');
                        txtDeferred.forEach(function(dt) { if (deferredTurns.indexOf(dt) === -1) deferredTurns.push(dt); });
                    } catch (e2) {}
                    finalText = finalText.replace(/\{"deferred"\s*:\s*\[([^\]]*)\]\}/g, '').trim();
                }

                var parsed = parseResponse(finalText);
                if (parsed && parsed.stmEntries) {
                    stmEntries = parsed.stmEntries;
                }
            } catch (e) {
                console.warn('[NE] Failed to parse main LLM response:', e.message);
            }
        }

        // If stmEntries is empty, use tool result entries
        if (stmEntries.length === 0 && toolResultEntries.length > 0) {
            stmEntries = toolResultEntries;
        }

    } else {
        // === Fallback path (single-turn, no tools) ===
        var allTurnsText = formatTurnsText(turns);
        var allIndices = [];
        for (var i = 0; i < turns.length; i++) allIndices.push(i);

        var subPrompt = buildSubAgentPrompt(turns, allIndices, '', vault);
        var responseText = await callMemoryPipeline([
            { role: 'system', content: subPrompt.system },
            { role: 'user', content: allTurnsText + '\n\nOutput ONLY a JSON array:\n[\n  { "event": "...", "status": "closed"|"partial"|"deferred", "entity": "..." },\n  ...\n]\nIf nothing significant, return [].' }
        ]);

        var parsed = parseResponse(responseText);
        if (parsed && parsed.stmEntries) {
            // Separate deferred entries
            var nonDeferred = [];
            for (var ei3 = 0; ei3 < parsed.stmEntries.length; ei3++) {
                var pe = parsed.stmEntries[ei3];
                if (pe.status === 'deferred') {
                    deferredTurns.push(0); // Fallback path doesn't have turn-level granularity for deferred
                } else {
                    nonDeferred.push(pe);
                }
            }
            stmEntries = nonDeferred;
            if (stmEntries.length === 1) {
                stmEntries[0].turns = [0, turns.length - 1];
            }
        }
    }

    // Phase C: Code-fill metadata and collect all msg_ids
    var processedEntries = [];
    var content = vault.content || {};
    var period = content.story_time || '';
    var scene = content.story_scene || '';

    for (var ei = 0; ei < stmEntries.length; ei++) {
        var entry = stmEntries[ei];

        var turnRange;
        if (entry.turns && Array.isArray(entry.turns)) {
            turnRange = entry.turns;
        } else {
            turnRange = [0, turns.length - 1];
        }

        var turnIndices = [];
        for (var ti = turnRange[0]; ti <= turnRange[1]; ti++) turnIndices.push(ti);
        var msgIds = collectMsgIdsFromTurns(turns, turnIndices);

        for (var ti2 = 0; ti2 < turnIndices.length; ti2++) {
            turnIndexToEventIdx[turnIndices[ti2]] = ei;
        }

        entry.msg_ids = msgIds;
        if (!entry.id) entry.id = null;
        entry.timestamp = new Date().toISOString();
        entry.period = period;
        entry.scene = scene;

        msgIds.forEach(function(id) {
            if (allMsgIds.indexOf(id) === -1) allMsgIds.push(id);
        });

        processedEntries.push(entry);
    }

    // Phase D: Handle deferred turns (only at the end)
    var coveredTurns = {};
    for (var key in turnIndexToEventIdx) coveredTurns[Number(key)] = true;

    // ── Code-level tail deferred detection ──
    // Find the last covered turn; everything after it is tail-uncovered.
    var maxCoveredTurn = -1;
    for (var ti4 = 0; ti4 < turns.length; ti4++) {
        if (coveredTurns[ti4]) maxCoveredTurn = ti4;
    }

    var tailDeferred = [];
    for (var ti5 = maxCoveredTurn + 1; ti5 < turns.length; ti5++) {
        if (deferredTurns.indexOf(ti5) === -1) {
            tailDeferred.push(ti5);
        }
    }

    // Merge LLM-marked deferred with code-detected tail deferred
    deferredTurns = deferredTurns.concat(tailDeferred.filter(function(t) {
        return deferredTurns.indexOf(t) === -1;
    }));

    // Middle turns not covered (between two covered turns) → force extraction
    var uncoveredMiddleTurns = [];
    var lastCoveredTurn = -1;
    for (var ti3 = 0; ti3 < turns.length; ti3++) {
        if (coveredTurns[ti3]) {
            lastCoveredTurn = ti3;
        } else if (lastCoveredTurn >= 0 && deferredTurns.indexOf(ti3) === -1) {
            uncoveredMiddleTurns.push(ti3);
        }
    }

    if (uncoveredMiddleTurns.length > 0) {
        var forceSummary = '中间未录入对话轮次';
        var subPrompt2 = buildSubAgentPrompt(turns, uncoveredMiddleTurns, forceSummary, vault);
        var forceResponse = '';
        try {
            forceResponse = await callMemoryPipeline([
                { role: 'system', content: subPrompt2.system },
                { role: 'user', content: subPrompt2.user }
            ]);
        } catch (e) {}

        if (forceResponse) {
            var forceParsed = {};
            try {
                var fc = String(forceResponse || '').replace(/```json\s*/g, '').replace(/```/g, '').trim();
                var fi = fc.indexOf('{');
                if (fi !== -1) fc = fc.substring(fi);
                var fe = fc.lastIndexOf('}');
                if (fe !== -1) fc = fc.substring(0, fe + 1);
                forceParsed = JSON.parse(fc);
            } catch (e2) {
                forceParsed = { event: 'force-extracted dialog', status: 'closed' };
            }

            var forceMsgIds = collectMsgIdsFromTurns(turns, uncoveredMiddleTurns);
            var forceEntry = {
                event: forceParsed.event || 'Force-extracted dialog',
                status: forceParsed.status || 'closed',
                entity: forceParsed.entity || '',
                turns: [uncoveredMiddleTurns[0], uncoveredMiddleTurns[uncoveredMiddleTurns.length - 1]],
                msg_ids: forceMsgIds,
                timestamp: new Date().toISOString(),
                period: period,
                scene: scene
            };
            forceMsgIds.forEach(function(id) {
                if (allMsgIds.indexOf(id) === -1) allMsgIds.push(id);
            });
            processedEntries.push(forceEntry);
        }
    }

    // Phase E: Deferred handling
    var newPendingPartials = pendingPartials.slice();
    if (deferredTurns.length > 0) {
        // Track deferred as pending partials for carry-forward
        var deferredPartial = {
            event: 'Deferred turns ' + deferredTurns[0] + '-' + deferredTurns[deferredTurns.length - 1],
            turns: deferredTurns.slice(),
            _partial_generation: 1
        };
        newPendingPartials.push(deferredPartial);

        // Don't mark deferred turns as processed
        deferredTurns.forEach(function(dt) {
            var dtMsgIds = collectMsgIdsFromTurns(turns, [dt]);
            dtMsgIds.forEach(function(id) {
                var idx2 = allMsgIds.indexOf(id);
                if (idx2 !== -1) allMsgIds.splice(idx2, 1);
            });
        });
    }

    // Phase F: Validate entries
    var validEntries = [];
    for (var ei2 = 0; ei2 < processedEntries.length; ei2++) {
        var e = processedEntries[ei2];
        try {
            postFill({ stmEntries: [e], _checkpoints: null }, vault);
            var errors = validateOutput({ stmEntries: [e], _checkpoints: null }, vault, 999);
            if (!errors || errors.length === 0) {
                validEntries.push(e);
            } else {
                console.warn('[NE] Validation failed for entry:', errors);
                var danglingIds = e.msg_ids || [];
                danglingIds.forEach(function(id) {
                    var idx3 = allMsgIds.indexOf(id);
                    if (idx3 !== -1) allMsgIds.splice(idx3, 1);
                });
            }
        } catch (eErr) {
            console.warn('[NE] Validate threw:', eErr.message);
        }
    }

    // Phase G: Append entries
    if (validEntries.length > 0) {
        appendEntries(vault, validEntries);
        totalAdded = validEntries.length;
    }

    // Phase H: Mark processed & save cursor state
    if (allMsgIds.length > 0) {
        markProcessed(vault, allMsgIds);
    }

    var finalState = {
        completedTurns: turns.length,
        pending_partials: newPendingPartials
    };
    updateCursorState(vault, 'stm', finalState);

    console.log('[NE] Extractor done — entries=' + totalAdded + ', msg_ids=' + allMsgIds.length + ', deferred=' + deferredTurns.length);

    return {
        vault: vault,
        cursorState: finalState,
        totalAdded: totalAdded,
        tailDeferred: deferredTurns.slice()
    };
}

// ── 批量分治入口 ──

export async function processTurnsInBatches(vault, messages, buildParams) {
    var allTurns = groupMessagesIntoTurns(messages);
    if (allTurns.length === 0) return { vault: vault, totalAdded: 0 };

    var maxTurns = buildParams.maxTurns || DEFAULT_MAX_TURNS;
    var cursorState = buildParams.getCursorState(vault, 'stm');
    var pendingPartials = cursorState.pending_partials || [];

    // 从 pending_partials 提取 deferred turns（carry-forward）
    var carryForwardTurns = [];
    if (pendingPartials.length > 0) {
        pendingPartials.forEach(function(p) {
            if (p.turns && Array.isArray(p.turns)) {
                p.turns.forEach(function(ti) { carryForwardTurns.push(ti); });
            }
        });
        carryForwardTurns.sort(function(a, b) { return a - b; });
    }

    // 短路径：如果所有 turns 在 maxTurns 内且无 carry-forward，直接单次调用
    if (allTurns.length <= maxTurns && carryForwardTurns.length === 0) {
        return runStmExtractorCore(allTurns, buildParams);
    }

    var totalAdded = 0;
    var turnIdx = 0;

    while (turnIdx < allTurns.length || carryForwardTurns.length > 0) {
        var batchTurns = [];

        // Step 1: 先加入 carry-forward turns
        if (carryForwardTurns.length > 0) {
            for (var ci = 0; ci < carryForwardTurns.length; ci++) {
                var t = allTurns[carryForwardTurns[ci]];
                if (t) batchTurns.push(t);
            }
        }

        // Step 2: 从 allTurns 补充新 turns 到满 maxTurns
        while (batchTurns.length < maxTurns && turnIdx < allTurns.length) {
            batchTurns.push(allTurns[turnIdx]);
            turnIdx++;
        }

        if (batchTurns.length === 0) break;

        var carryCount = carryForwardTurns.length;

        var batchResult = await runStmExtractorCore(batchTurns, Object.assign({}, buildParams, {
            vault: vault,
            carryForwardCount: carryCount,
            maxTurns: maxTurns
        }));

        totalAdded += batchResult.totalAdded;
        vault = batchResult.vault;

        // 下一批的 carry-forward = 本批的 tailDeferred
        carryForwardTurns = batchResult.tailDeferred || [];

        console.log('[NE] Batch processed — entries=' + batchResult.totalAdded + ', tailDeferred=' + carryForwardTurns.length);

        if (batchTurns.length < maxTurns && carryForwardTurns.length === 0) break;
    }

    return { vault: vault, totalAdded: totalAdded };
}
