/**
 * engine/stm-extractor.js — Batch-level STM extraction engine
 *
 * Each batch makes ONE LLM call with response_format: json_object.
 * LLM outputs JSON, code extracts .events array.
 *
 * processTurnsInBatches() splits large turn sets into maxTurns-sized batches
 * with simple cursor advancement — no carry-forward / deferred.
 */

import { groupMessagesIntoTurns, collectMsgIdsFromTurns } from './turn-segmenter.js';

var DEFAULT_MAX_TURNS = 10;

// ── 内层（直接接收 turns）──

export async function runStmExtractorCore(turns, params) {
    var vault = params.vault;
    console.log('[NE-DIAG] runStmExtractorCore ENTER — turns=' + turns.length);
    var callLLM = params.callLLM;
    var buildBatchPrompt = params.buildBatchPrompt;
    var postFill = params.postFill;
    var appendEntries = params.appendEntries;
    var getCursorState = params.getCursorState;
    var updateCursorState = params.updateCursorState;
    var markProcessed = params.markProcessed;
    var globalIndexMap = params.globalIndexMap || null;

    if (!turns || turns.length === 0) {
        return { vault: vault, cursorState: null, totalAdded: 0, tailDeferred: [] };
    }

    var maxTurn = turns.length - 1;

    // ── 单次 LLM 调用 + JSON 解析 ──
    var rawEvents = [];
    var batchPrompt = buildBatchPrompt(turns, vault);
    var responseText = '';
    try {
        responseText = await callLLM([
            { role: 'system', content: batchPrompt.system },
            { role: 'user', content: batchPrompt.user }
        ]);
    } catch (e) {
        console.warn('[NE] Batch LLM failed:', e.message);
        return [];
    }

    if (!responseText || !responseText.trim()) {
        console.warn('[NE] Batch LLM returned empty response, no events');
        return [];
    }

    try {
        var parsed = JSON.parse(responseText);
        rawEvents = parsed.events || [];
        if (!Array.isArray(rawEvents)) {
            console.warn('[NE] Batch LLM returned non-array events field');
            rawEvents = [];
        }
    } catch (e) {
        console.warn('[NE] Batch LLM returned non-JSON response, no events');
        console.warn('[NE] Raw response:', responseText);
        return [];
    }

    // 过滤无效事件
    var validEvents = [];
    for (var ei = 0; ei < rawEvents.length; ei++) {
        var ev = rawEvents[ei];
        if (!ev.event || String(ev.event).trim().length < 3) continue;
        var turnsStr = String(ev.turns || '').trim();
        var tm = turnsStr.match(/(\d+)\s*[-–~至到]\s*(\d+)/);
        if (!tm) continue;
        var start = Math.max(0, Math.min(maxTurn, parseInt(tm[1], 10)));
        var end = Math.max(start, Math.min(maxTurn, parseInt(tm[2], 10)));
        if (start > end) continue;
        var turnIndices = [];
        for (var ti = start; ti <= end; ti++) turnIndices.push(ti);
        validEvents.push({
            event: String(ev.event).substring(0, 200),
            period: String(ev.period || '').substring(0, 30),
            scene: String(ev.scene || '').substring(0, 30),
            start: start,
            end: end,
            turnIndices: turnIndices
        });
    }

    if (validEvents.length === 0) {
        console.warn('[NE] No valid events found in JSON response');
        return [];
    }

    // 构建 STM 条目
    var stmEntries = [];
    for (var i = 0; i < validEvents.length; i++) {
        var r = validEvents[i];
        var msgIds = collectMsgIdsFromTurns(turns, r.turnIndices);
        if (msgIds.length === 0) continue;
        stmEntries.push({
            event: r.event,
            status: 'closed',
            entity: '',
            turns: [r.start, r.end],
            msg_ids: msgIds,
            period: r.period || '',
            scene: r.scene || '',
            timestamp: new Date().toISOString()
        });
    }

    console.log('[NE] Batch extraction done — events=' + validEvents.length);

    if (stmEntries.length === 0) {
        console.warn('[NE] No STM entries could be built from events (all had empty msgIds)');
        return [];
    }

    // Phase C: Global index mapping + metadata
    var processedEntries = [];
    for (var ei = 0; ei < stmEntries.length; ei++) {
        var entry = Object.assign({}, stmEntries[ei]);
        var turnRange = entry.turns || [0, 0];
        var localStart = turnRange[0];
        var localEnd = turnRange[1];
        var mappedStart = (globalIndexMap && globalIndexMap[localStart] !== undefined) ? globalIndexMap[localStart] : localStart;
        var mappedEnd = (globalIndexMap && globalIndexMap[localEnd] !== undefined) ? globalIndexMap[localEnd] : localEnd;
        entry.turns = [mappedStart, mappedEnd];
        entry.msgRange = [mappedStart, mappedEnd];

        if (!entry.id) entry.id = null;
        entry.timestamp = new Date().toISOString();
        if (!entry.period) entry.period = '';
        if (!entry.scene) entry.scene = '';

        processedEntries.push(entry);
    }

    // Phase F: Validate entries
    var validEntries = [];
    for (var ei2 = 0; ei2 < processedEntries.length; ei2++) {
        var e = processedEntries[ei2];
        try {
            postFill({ stmEntries: [e], _checkpoints: null }, vault);
            if (!e.event || e.event.length < 3) {
                console.warn('[NE] Entry rejected — event too short:', e.event);
                continue;
            }
            validEntries.push(e);
        } catch (f) {
            console.warn('[NE] Entry failed validation:', f);
        }
    }

    // Phase G: Append valid entries
    var totalAdded = 0;
    if (validEntries.length > 0) {
        appendEntries(vault, validEntries);
        totalAdded = validEntries.length;
    }

    // Phase H: Mark msg_ids as processed
    var allMsgIds = [];
    validEntries.forEach(function (e) {
        (e.msg_ids || []).forEach(function (id) { allMsgIds.push(id); });
    });
    markProcessed(vault, allMsgIds);

    var cursorState = getCursorState(vault, 'stm');
    var processedCount = (cursorState.processed_count || 0) + totalAdded;
    var finalState = updateCursorState(vault, 'stm', { processed_count: processedCount, pending_partials: [] });

    return {
        vault: vault,
        cursorState: finalState,
        totalAdded: totalAdded,
        tailDeferred: []
    };
}

// ── 批量处理（对外接口）──

export async function processTurnsInBatches(vault, messages, buildParams, onProgress) {
    var allTurns = groupMessagesIntoTurns(messages);
    if (allTurns.length === 0) return { vault: vault, totalAdded: 0 };

    var maxTurns = buildParams.maxTurns || DEFAULT_MAX_TURNS;
    var totalTurns = allTurns.length;

    if (allTurns.length <= maxTurns) {
        var shortParams = Object.assign({}, buildParams, { vault: vault });
        var result = await runStmExtractorCore(allTurns, shortParams);
        if (onProgress) onProgress({ processedTurns: allTurns.length, totalTurns: allTurns.length });
        return result;
    }

    var totalAdded = 0;
    var turnIdx = 0;
    var numBatches = Math.ceil(totalTurns / maxTurns);
    var batchSize = Math.ceil(totalTurns / numBatches);

    while (turnIdx < allTurns.length) {
        var thisBatchSize = Math.min(batchSize, allTurns.length - turnIdx);
        var batchTurns = [];
        var globalIndexMap = [];

        while (batchTurns.length < thisBatchSize && turnIdx < allTurns.length) {
            batchTurns.push(allTurns[turnIdx]);
            globalIndexMap.push(turnIdx);
            turnIdx++;
        }

        var batchParams = Object.assign({}, buildParams, { vault: vault, globalIndexMap: globalIndexMap });
        var batchResult = await runStmExtractorCore(batchTurns, batchParams);
        totalAdded += batchResult.totalAdded;
        vault = batchResult.vault;

        console.log('[NE] Batch processed — entries=' + batchResult.totalAdded);

        if (onProgress) {
            var processedSoFar = Math.min(turnIdx, totalTurns);
            onProgress({ processedTurns: processedSoFar, totalTurns: totalTurns });
        }
    }

    return { vault: vault, totalAdded: totalAdded };
}
