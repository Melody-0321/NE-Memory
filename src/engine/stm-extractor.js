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
    var globalIndexMap = params.globalIndexMap || null;

    if (!turns || turns.length === 0) {
        return { vault: vault, cursorState: null, totalAdded: 0, tailDeferred: [] };
    }

    var cursorState = getCursorState(vault, 'stm');
    var pendingPartials = cursorState.pending_partials || [];

    var segMinTurns = params.segMinTurns !== undefined ? params.segMinTurns : 2;
    var segMaxTurns = params.segMaxTurns !== undefined ? params.segMaxTurns : 6;
    if (segMinTurns > segMaxTurns) segMinTurns = segMaxTurns;
    var fixedChunk = segMinTurns === segMaxTurns;

    // Phase B: Build segmentation prompt (only for semantic mode)
    var segPrompt = fixedChunk ? null : buildSegmentationPrompt(turns, pendingPartials, vault, segMinTurns, segMaxTurns);

    // Phase B1: Determine if tool calling is available
    var secCfg = loadSecondaryApiConfig();
    var hasTools = !fixedChunk && secCfg && secCfg.url && secCfg.model;

    var stmEntries = [];
    var allMsgIds = [];
    var deferredTurns = [];
    var turnIndexToEventIdx = {};
    var totalAdded = 0;
    var newPendingPartials = pendingPartials.slice();

    if (fixedChunk) {
        // === Fixed-size chunking (min==max, skip semantic segmentation) ===
        var chunkSize = segMaxTurns;
        for (var ci = 0; ci < turns.length; ci += chunkSize) {
            var chunkEnd = Math.min(ci + chunkSize, turns.length);
            var chunkIndices = [];
            for (var tci = ci; tci < chunkEnd; tci++) chunkIndices.push(tci);

            var chunkHint = chunkIndices.length + ' turns';
            var subPrompt = buildSubAgentPrompt(turns, chunkIndices, chunkHint, vault);
            var subResponseText = '';
            try {
                subResponseText = await callMemoryPipeline([
                    { role: 'system', content: subPrompt.system },
                    { role: 'user', content: subPrompt.user }
                ]);
            } catch (e) {}

            var parsed = {};
            try {
                var rawText = String(subResponseText || '').replace(/<thought>[\s\S]*?<\/thought>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
                var cleaned = rawText.replace(/```json\s*/g, '').replace(/```/g, '').trim();
                var idx = cleaned.indexOf('{');
                if (idx !== -1) cleaned = cleaned.substring(idx);
                var endIdx = cleaned.lastIndexOf('}');
                if (endIdx !== -1) cleaned = cleaned.substring(0, endIdx + 1);
                parsed = JSON.parse(cleaned);
            } catch (e) {
                parsed = { event: chunkHint, status: 'closed' };
            }

            var msgIds = collectMsgIdsFromTurns(turns, chunkIndices);
            stmEntries.push({
                event: parsed.event || chunkHint,
                status: parsed.status || 'closed',
                entity: parsed.entity || '',
                turns: [ci, chunkEnd - 1],
                msg_ids: msgIds,
                timestamp: new Date().toISOString()
            });
        }
    } else if (hasTools) {
        // Accumulators for sub-agent tool results (populated from within executor closure,
    // NOT from segMessages which callMemoryLLMWithTools never mutates back).
    var toolResultEntries = [];
    var toolResultDeferred = [];

    if (hasTools) {
        // === Hub-Spoke path (multi-event with parallel sub-agents) ===
        var subAgentExecutor = async function(args) {
            // 从 args.turns 提取 turn 范围；如果 args 不完整则回退到当前 batch 的全部 turns
            var turnIndices = [];
            var start = 0;
            var end = turns.length - 1;
            if (args && args.turns && Array.isArray(args.turns) && args.turns.length >= 2
                && typeof args.turns[0] === 'number' && typeof args.turns[1] === 'number') {
                start = Math.max(0, args.turns[0]);
                end = Math.min(turns.length - 1, args.turns[1]);
                if (end < start) end = start;
            }
            for (var ti = start; ti <= end; ti++) turnIndices.push(ti);

            var summary = (args && args.event_summary) || '';
            var subPrompt = buildSubAgentPrompt(turns, turnIndices, summary, vault);

            var subResponse = await callMemoryPipeline([
                { role: 'system', content: subPrompt.system },
                { role: 'user', content: subPrompt.user }
            ]);

            var parsed = {};
            try {
                var rawText2 = String(subResponse || '').replace(/<thought>[\s\S]*?<\/thought>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
                var cleaned = rawText2.replace(/```json\s*/g, '').replace(/```/g, '').trim();
                var idx = cleaned.indexOf('{');
                if (idx !== -1) cleaned = cleaned.substring(idx);
                var endIdx = cleaned.lastIndexOf('}');
                if (endIdx !== -1) cleaned = cleaned.substring(0, endIdx + 1);
                parsed = JSON.parse(cleaned);
            } catch (e) {
                parsed = { event: (summary || String(subResponse).substring(0, 80)), status: 'closed' };
            }

            var msgIds = collectMsgIdsFromTurns(turns, turnIndices);
            var isDeferred = parsed.status === 'deferred' || (args && args.status === 'deferred');

            var resultEntry = {
                event: parsed.event || summary,
                status: isDeferred ? 'deferred' : (parsed.status || (args && args.status) || 'closed'),
                entity: parsed.entity || '',
                turns: [start, end],
                msgRange: [start, end],
                msg_ids: msgIds,
                deferred: isDeferred
            };

            if (resultEntry.deferred) {
                toolResultDeferred.push(resultEntry);
            } else {
                toolResultEntries.push(resultEntry);
            }

            return JSON.stringify(resultEntry);
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

        // Derive deferred turn indices from sub-agent results
        for (var di2 = 0; di2 < toolResultDeferred.length; di2++) {
            var dr = toolResultDeferred[di2];
            if (dr.turns && dr.turns.length >= 2) {
                for (var ti0 = dr.turns[0]; ti0 <= dr.turns[1]; ti0++) {
                    if (deferredTurns.indexOf(ti0) === -1) deferredTurns.push(ti0);
                }
            }
        }

        // Parse main LLM final response
        var finalText = String(mainLLMResponse || '').trim();

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
    }

    // Phase C: Code-fill metadata and collect all msg_ids
    var processedEntries = [];
    var content = vault.content || {};
    var period = content.story_time || '';
    var scene = content.story_scene || '';

    for (var ei = 0; ei < stmEntries.length; ei++) {
        var entry = stmEntries[ei];

        var turnRange;
        if (entry.turns && Array.isArray(entry.turns) && entry.turns.length >= 2
            && typeof entry.turns[0] === 'number' && typeof entry.turns[1] === 'number') {
            turnRange = entry.turns;
        } else if (entry.msgRange && Array.isArray(entry.msgRange) && entry.msgRange.length >= 2
            && typeof entry.msgRange[0] === 'number' && typeof entry.msgRange[1] === 'number') {
            // parseSTMResponse 产生的 entry 只有 msgRange（message 索引范围），
            // 这里将其映射到 batch 内的 turn 索引
            var rawStart = Math.max(0, Math.min(turns.length - 1, entry.msgRange[0]));
            var rawEnd = Math.max(0, Math.min(turns.length - 1, entry.msgRange[1]));
            turnRange = [rawStart, rawEnd];
        } else {
            turnRange = [0, turns.length - 1];
        }

        // 钳制到有效范围
        var rStart = Math.max(0, Math.min(turns.length - 1, turnRange[0]));
        var rEnd = Math.max(rStart, Math.min(turns.length - 1, turnRange[1]));
        turnRange = [rStart, rEnd];

        var turnIndices = [];
        for (var ti = turnRange[0]; ti <= turnRange[1]; ti++) turnIndices.push(ti);
        var msgIds = collectMsgIdsFromTurns(turns, turnIndices);

        for (var ti2 = 0; ti2 < turnIndices.length; ti2++) {
            turnIndexToEventIdx[turnIndices[ti2]] = ei;
        }

        entry.turns = turnRange;
        entry.msg_ids = msgIds;
        // 将 turns 映射为全局消息索引范围
        var localStart = turnRange[0];
        var localEnd = turnRange[1];
        var mappedStart = (globalIndexMap && globalIndexMap[localStart] !== undefined) ? globalIndexMap[localStart] : localStart;
        var mappedEnd = (globalIndexMap && globalIndexMap[localEnd] !== undefined) ? globalIndexMap[localEnd] : localEnd;
        entry.msgRange = [mappedStart, mappedEnd];
        if (!entry.id) entry.id = null;
        entry.timestamp = new Date().toISOString();
        entry.period = period;
        entry.scene = scene;

        msgIds.forEach(function(id) {
            if (allMsgIds.indexOf(id) === -1) allMsgIds.push(id);
        });

        processedEntries.push(entry);
    }

    // Phase D: Handle deferred turns (only at the end) — skipped for fixed chunk
    if (!fixedChunk) {
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
            var forceLocalRange = [uncoveredMiddleTurns[0], uncoveredMiddleTurns[uncoveredMiddleTurns.length - 1]];
            var forceMappedStart = (globalIndexMap && globalIndexMap[forceLocalRange[0]] !== undefined) ? globalIndexMap[forceLocalRange[0]] : forceLocalRange[0];
            var forceMappedEnd = (globalIndexMap && globalIndexMap[forceLocalRange[1]] !== undefined) ? globalIndexMap[forceLocalRange[1]] : forceLocalRange[1];
            var forceEntry = {
                event: forceParsed.event || 'Force-extracted dialog',
                status: forceParsed.status || 'closed',
                entity: forceParsed.entity || '',
                turns: forceLocalRange,
                msg_ids: forceMsgIds,
                msgRange: [forceMappedStart, forceMappedEnd],
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
    newPendingPartials = pendingPartials.slice();
    if (deferredTurns.length > 0) {
        // Convert batch-relative deferred turn indices to global
        var globalDeferredTurns = [];
        if (globalIndexMap) {
            for (var dti = 0; dti < deferredTurns.length; dti++) {
                var gIdx = globalIndexMap[deferredTurns[dti]];
                if (gIdx !== undefined) globalDeferredTurns.push(gIdx);
            }
        } else {
            globalDeferredTurns = deferredTurns.slice();
        }

        // Track deferred as pending partials for carry-forward
        var deferredPartial = {
            event: 'Deferred turns ' + deferredTurns[0] + '-' + deferredTurns[deferredTurns.length - 1],
            turns: globalDeferredTurns,
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
    } // end if (!fixedChunk) — Phase D/E

    // Phase F: Validate entries — 仅在有 event 时才拒绝（不强制 msgRange 字段）
    var validEntries = [];
    for (var ei2 = 0; ei2 < processedEntries.length; ei2++) {
        var e = processedEntries[ei2];
        try {
            postFill({ stmEntries: [e], _checkpoints: null }, vault);
            // 宽松验证：仅检查 event 必填；不因为缺少 msgRange/_checkpoints 而拒绝 entry
            var errors = [];
            if (!e.event || !String(e.event).trim()) {
                errors.push('stm_entries[' + ei2 + '].event is REQUIRED');
            }
            if (!errors.length) {
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

    // Convert tailDeferred to global indices for batch carry-forward
    var globalTailDeferred = [];
    if (globalIndexMap) {
        for (var tdi = 0; tdi < deferredTurns.length; tdi++) {
            var gi = globalIndexMap[deferredTurns[tdi]];
            if (gi !== undefined && globalTailDeferred.indexOf(gi) === -1) {
                globalTailDeferred.push(gi);
            }
        }
    } else {
        globalTailDeferred = deferredTurns.slice();
    }

    return {
        vault: vault,
        cursorState: finalState,
        totalAdded: totalAdded,
        tailDeferred: globalTailDeferred
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
        var globalIndexMap = [];

        // Step 1: 先加入 carry-forward turns（已是全局索引）
        if (carryForwardTurns.length > 0) {
            for (var ci = 0; ci < carryForwardTurns.length; ci++) {
                var t = allTurns[carryForwardTurns[ci]];
                if (t) {
                    batchTurns.push(t);
                    globalIndexMap.push(carryForwardTurns[ci]);
                }
            }
        }

        // Step 2: 从 allTurns 补充新 turns 到满 maxTurns
        var newTurnGlobalStart = turnIdx;
        while (batchTurns.length < maxTurns && turnIdx < allTurns.length) {
            batchTurns.push(allTurns[turnIdx]);
            globalIndexMap.push(turnIdx);
            turnIdx++;
        }

        if (batchTurns.length === 0) break;

        var carryCount = carryForwardTurns.length;

        var batchResult = await runStmExtractorCore(batchTurns, Object.assign({}, buildParams, {
            vault: vault,
            carryForwardCount: carryCount,
            maxTurns: maxTurns,
            globalIndexMap: globalIndexMap
        }));

        totalAdded += batchResult.totalAdded;
        vault = batchResult.vault;

        // 下一批的 carry-forward = 本批的 tailDeferred（已转为全局索引）
        carryForwardTurns = batchResult.tailDeferred || [];

        console.log('[NE] Batch processed — entries=' + batchResult.totalAdded + ', tailDeferred=' + carryForwardTurns.length);

        if (batchTurns.length < maxTurns && carryForwardTurns.length === 0) break;
    }

    return { vault: vault, totalAdded: totalAdded };
}
