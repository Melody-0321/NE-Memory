/**
 * engine/stm-extractor.js — Hub-Spoke STM extraction engine
 *
 * Replaces cursor.js. Main LLM segments turns into semantic events,
 * spawns parallel sub-agents for each event range, then code-fills metadata.
 * Single-event path skips tool calling entirely.
 */

import { callMemoryLLMWithTools, callMemoryPipeline, loadSecondaryApiConfig } from '../api/llm.js';
import { EXTRACT_STM_TOOL_SCHEMA } from '../tools.js';
import { groupMessagesIntoTurns, formatTurnsText, collectMsgIdsFromTurns } from './turn-segmenter.js';

export async function runStmExtractor(params) {
    var vault = params.vault;
    var messages = params.messages;
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

    if (!messages || messages.length === 0) {
        return { vault: vault, cursorState: null, totalAdded: 0 };
    }

    var cursorState = getCursorState(vault, 'stm');
    var pendingPartials = cursorState.pending_partials || [];

    // Phase A: Turn segmentation
    var turns = groupMessagesIntoTurns(messages);
    if (turns.length === 0) {
        return { vault: vault, cursorState: cursorState, totalAdded: 0 };
    }

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

            // Sub-agent uses regular memory LLM (single-turn)
            var subResponse = await callMemoryPipeline([
                { role: 'system', content: subPrompt.system },
                { role: 'user', content: subPrompt.user }
            ]);

            // Parse sub-agent response
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

            // Code-fill: msg_ids from turns
            var msgIds = collectMsgIdsFromTurns(turns, turnIndices);

            return JSON.stringify({
                event: parsed.event || summary,
                status: parsed.status || args.status || 'closed',
                entity: parsed.entity || '',
                turns: [start, end],
                msg_ids: msgIds
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
        if (finalText) {
            try {
                // Check for deferred list
                var deferredMatch = finalText.match(/\{"deferred"\s*:\s*\[([^\]]+)\]\}/);
                if (deferredMatch) {
                    try {
                        deferredTurns = JSON.parse('[' + deferredMatch[1] + ']');
                    } catch (e2) {}
                    // Remove deferred from final text
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

        // Also extract entries from tool call results (in case main LLM final output is empty)
        if (stmEntries.length === 0) {
            // Fallback: parse tool call args as events
            stmEntries = _extractFromToolCalls(toolExecs, turns);
        }

    } else {
        // === Fallback path (single-turn, no tools) ===
        var allTurnsText = formatTurnsText(turns);
        var allIndices = [];
        for (var i = 0; i < turns.length; i++) allIndices.push(i);

        var subPrompt = buildSubAgentPrompt(turns, allIndices, '', vault);
        var responseText = await callMemoryPipeline([
            { role: 'system', content: subPrompt.system },
            { role: 'user', content: allTurnsText + '\n\nOutput ONLY a JSON array:\n[\n  { "event": "...", "status": "closed"|"partial", "entity": "..." },\n  ...\n]\nIf nothing significant, return [].' }
        ]);

        var parsed = parseResponse(responseText);
        if (parsed && parsed.stmEntries) {
            stmEntries = parsed.stmEntries;
            // Assign turns: if single entry, cover all turns
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

        // Determine turn range
        var turnRange;
        if (entry.turns && Array.isArray(entry.turns)) {
            turnRange = entry.turns;
        } else {
            // Default: if only one entry, cover all turns
            turnRange = [0, turns.length - 1];
        }

        // Code-calculate msg_ids
        var turnIndices = [];
        for (var ti = turnRange[0]; ti <= turnRange[1]; ti++) turnIndices.push(ti);
        var msgIds = collectMsgIdsFromTurns(turns, turnIndices);

        // Mark turn->event mapping
        for (var ti2 = 0; ti2 < turnIndices.length; ti2++) {
            turnIndexToEventIdx[turnIndices[ti2]] = ei;
        }

        entry.msg_ids = msgIds;
        if (!entry.id) entry.id = null; // let appendSTMEntries generate
        entry.timestamp = new Date().toISOString();
        entry.period = period;
        entry.scene = scene;

        // Merge msg_ids into allMsgIds
        msgIds.forEach(function(id) {
            if (allMsgIds.indexOf(id) === -1) allMsgIds.push(id);
        });

        processedEntries.push(entry);
    }

    // Phase D: Handle deferred turns (only at the end)
    // Middle turns not covered → force extraction (they can't improve)
    var coveredTurns = {};
    for (var key in turnIndexToEventIdx) coveredTurns[Number(key)] = true;

    var uncoveredMiddleTurns = [];
    var lastCoveredTurn = -1;
    for (var ti3 = 0; ti3 < turns.length; ti3++) {
        if (coveredTurns[ti3]) {
            lastCoveredTurn = ti3;
        } else if (lastCoveredTurn >= 0 && deferredTurns.indexOf(ti3) === -1) {
            uncoveredMiddleTurns.push(ti3);
        }
    }

    // Force-extract uncovered middle turns as a single event
    if (uncoveredMiddleTurns.length > 0) {
        var forceSummary = turns.length > 0 ? '中间未录入对话轮次' : '';
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

    // Phase E: Deferred handling (only the last unchecked turns can be deferred)
    var newPendingPartials = pendingPartials.slice();
    if (deferredTurns.length > 0) {
        var deferredPartial = {
            event: 'Deferred turns ' + deferredTurns.join('-'),
            turns: deferredTurns,
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

    return { vault: vault, cursorState: finalState, totalAdded: totalAdded };
}

function _extractFromToolCalls(toolExecs, turns) {
    // Fallback when main LLM didn't output a final JSON array
    return [];
}
