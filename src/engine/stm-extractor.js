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

import { callMemoryPipeline } from '../api/llm.js';
import { groupMessagesIntoTurns, formatTurnsText, collectMsgIdsFromTurns } from './turn-segmenter.js';

var DEFAULT_MAX_TURNS = 10;

// ── 纯文本 event 提取（不再依赖 JSON.parse）──

function extractEventText(raw) {
    if (!raw) return '';
    var text = String(raw).trim();
    text = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    text = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    try {
        var parsed = JSON.parse(text);
        if (parsed && parsed.event) return String(parsed.event).substring(0, 200);
    } catch (_) {}
    var lines = text.split('\n');
    var eventLines = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        if (/^(Output|输入|以下是|请|Note|Rule|Output format|IMPORTANT)/i.test(line)) continue;
        eventLines.push(line);
    }
    return eventLines.join(' ').substring(0, 200).trim();
}

// ── 从 LLM 纯文本切分中提取 turn 范围 ──

function parseSegmentation(text, maxTurn) {
    var segments = [];
    var deferred = [];
    var seenTurns = {};
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var dm = line.match(/deferred[\s:：]*(\d+)\s*[-–至到]\s*(\d+)/i);
        if (dm) {
            var ds = Math.max(0, Math.min(maxTurn, parseInt(dm[1], 10)));
            var de = Math.max(ds, Math.min(maxTurn, parseInt(dm[2], 10)));
            for (var ti = ds; ti <= de; ti++) {
                if (deferred.indexOf(ti) === -1) deferred.push(ti);
            }
            continue;
        }
        var m = line.match(/^(\d+)\s*[-–~至到]\s*(\d+)/);
        if (m) {
            var s = Math.max(0, Math.min(maxTurn, parseInt(m[1], 10)));
            var e = Math.max(s, Math.min(maxTurn, parseInt(m[2], 10)));
            var conflict = false;
            for (var ti = s; ti <= e; ti++) {
                if (seenTurns[ti]) { conflict = true; break; }
            }
            if (conflict) continue;
            for (var ti = s; ti <= e; ti++) seenTurns[ti] = true;
            segments.push({
                start: s, end: e,
                summary: line.replace(/^\d+\s*[-–~至到]\s*\d+/, '').trim()
            });
        }
    }
    var uncovered = [];
    for (var ti = 0; ti <= maxTurn; ti++) {
        if (!seenTurns[ti] && deferred.indexOf(ti) === -1) uncovered.push(ti);
    }
    for (var i = 0; i < uncovered.length; ) {
        var j = i;
        while (j + 1 < uncovered.length && uncovered[j + 1] === uncovered[j] + 1) j++;
        segments.push({ start: uncovered[i], end: uncovered[j], summary: '' });
        i = j + 1;
    }
    segments.sort(function (a, b) { return a.start - b.start; });
    return { segments: segments, deferred: deferred };
}

// ── 外层入口（向后兼容）──

export async function runStmExtractor(params) {
    var messages = params.messages;
    var turns = groupMessagesIntoTurns(messages);
    return runStmExtractorCore(turns, params);
}

// ── 内层（直接接收 turns）──

export async function runStmExtractorCore(turns, params) {
    var vault = params.vault;
    console.log('[NE-DIAG] runStmExtractorCore ENTER — turns=' + turns.length + ', carryForward=' + (params.carryForwardCount || 0));
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

            var eventText = extractEventText(subResponseText);
            if (!eventText || eventText.length < 3) eventText = chunkHint;

            var msgIds = collectMsgIdsFromTurns(turns, chunkIndices);
            stmEntries.push({
                event: eventText,
                status: 'closed',
                entity: '',
                turns: [ci, chunkEnd - 1],
                msg_ids: msgIds,
                timestamp: new Date().toISOString()
            });
        }
    } else {
        // === Semantic segmentation via LLM text output (no tool calling) ===
        var segMessages = [
            { role: 'system', content: segPrompt.system },
            { role: 'user', content: segPrompt.user }
        ];
        var segResponseText = '';
        try {
            segResponseText = await callMemoryPipeline(segMessages);
        } catch (e) {
            console.warn('[NE] Segmentation LLM failed:', e.message);
        }

        var segResult = parseSegmentation(segResponseText, turns.length - 1);
        deferredTurns = segResult.deferred.slice();

        for (var si = 0; si < segResult.segments.length; si++) {
            var seg = segResult.segments[si];
            var turnIndices = [];
            for (var ti = seg.start; ti <= seg.end; ti++) turnIndices.push(ti);

            var subPrompt = buildSubAgentPrompt(turns, turnIndices, seg.summary, vault);
            var subResponse = '';
            try {
                subResponse = await callMemoryPipeline([
                    { role: 'system', content: subPrompt.system },
                    { role: 'user', content: subPrompt.user }
                ]);
            } catch (e) {}

            var eventText = extractEventText(subResponse);
            if (!eventText || eventText.length < 3) {
                eventText = seg.summary || ('Turns ' + seg.start + '-' + seg.end);
            }

            var msgIds = collectMsgIdsFromTurns(turns, turnIndices);
            stmEntries.push({
                event: eventText,
                status: 'closed',
                entity: '',
                turns: [seg.start, seg.end],
                msg_ids: msgIds,
                timestamp: new Date().toISOString()
            });
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
            var forceEventText = extractEventText(forceResponse);
            if (!forceEventText || forceEventText.length < 3) forceEventText = 'Force-extracted dialog';

            var forceMsgIds = collectMsgIdsFromTurns(turns, uncoveredMiddleTurns);
            var forceLocalRange = [uncoveredMiddleTurns[0], uncoveredMiddleTurns[uncoveredMiddleTurns.length - 1]];
            var forceMappedStart = (globalIndexMap && globalIndexMap[forceLocalRange[0]] !== undefined) ? globalIndexMap[forceLocalRange[0]] : forceLocalRange[0];
            var forceMappedEnd = (globalIndexMap && globalIndexMap[forceLocalRange[1]] !== undefined) ? globalIndexMap[forceLocalRange[1]] : forceLocalRange[1];
            var forceEntry = {
                event: forceEventText,
                status: 'closed',
                entity: '',
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

export async function processTurnsInBatches(vault, messages, buildParams, onProgress) {
    var allTurns = groupMessagesIntoTurns(messages);
    if (allTurns.length === 0) return { vault: vault, totalAdded: 0 };

    var maxTurns = buildParams.maxTurns || DEFAULT_MAX_TURNS;
    var totalTurns = allTurns.length;
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
        var result = await runStmExtractorCore(allTurns, buildParams);
        if (onProgress) onProgress({ processedTurns: allTurns.length, totalTurns: allTurns.length });
        return result;
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

        if (onProgress) {
            var processedSoFar = Math.min(turnIdx, totalTurns);
            onProgress({ processedTurns: processedSoFar, totalTurns: totalTurns });
        }

        if (batchTurns.length < maxTurns && carryForwardTurns.length === 0) break;
    }

    return { vault: vault, totalAdded: totalAdded };
}
