/**
 * engine/stm-extractor.js — Batch-level STM extraction engine
 *
 * Each batch makes ONE LLM call. LLM outputs all events for the batch
 * as plain-text blocks (separated by blank lines), code parses them.
 *
 * processTurnsInBatches() splits large turn sets into maxTurns-sized batches
 * with simple cursor advancement — no carry-forward / deferred.
 */

import { groupMessagesIntoTurns, collectMsgIdsFromTurns } from './turn-segmenter.js';

var DEFAULT_MAX_TURNS = 10;

// ── 纯文本 event 提取（不再依赖 JSON.parse）──

function extractEntryFields(raw) {
    var result = { event: '', period: '', scene: '' };
    if (!raw) return result;
    var text = String(raw).trim();
    text = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    text = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    try {
        var parsed = JSON.parse(text);
        if (parsed && parsed.event) {
            result.event = String(parsed.event).substring(0, 200);
            result.period = String(parsed.period || '').substring(0, 30);
            result.scene = String(parsed.scene || '').substring(0, 30);
            return result;
        }
    } catch (_) {}
    var lines = text.split('\n');
    var eventLines = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        if (/^(Output|输入|以下是|请|Note|Rule|Output format|IMPORTANT)/i.test(line)) continue;
        var m = line.match(/^period\s*[:：]\s*(.+)/i);
        if (m) { var pv = m[1].trim(); if (pv !== '-' && pv !== '—' && pv !== '无' && pv !== 'N/A') result.period = pv.substring(0, 30); continue; }
        m = line.match(/^scene\s*[:：]\s*(.+)/i);
        if (m) { var sv = m[1].trim(); if (sv !== '-' && sv !== '—' && sv !== '无') result.scene = sv.substring(0, 30); continue; }
        m = line.match(/^event\s*[:：]\s*(.+)/i);
        if (m) { result.event = m[1].trim().substring(0, 200); continue; }
        eventLines.push(line);
    }
    if (!result.event) result.event = eventLines.join(' ').substring(0, 200).trim();
    return result;
}

// ── 从整批 LLM 响应中解析多个 event 块 ──

function parseBatchResponse(raw, maxTurn) {
    var events = [];
    if (!raw) return events;
    var text = String(raw).trim();
    text = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    text = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    // 按连续空行分割为 event 块
    var blocks = text.split(/\n\s*\n/);
    for (var bi = 0; bi < blocks.length; bi++) {
        var block = blocks[bi].trim();
        if (!block) continue;
        // 只接受包含 event: 字段的块，丢弃推理/分析文本
        if (!/^event\s*[:：]/im.test(block)) continue;
        // 优先从 event/turns 行提取，找不到再兜底
        var hasTurnLine = /^turns?\s*[:：]/im.test(block);
        var turnStart = -1, turnEnd = -1;
        var blockLines = block.split('\n');
        for (var li = 0; li < blockLines.length; li++) {
            var line = blockLines[li].trim();
            var tm = line.match(/^turns?\s*[:：]\s*(\d+)\s*[-–~至到]\s*(\d+)/i);
            if (tm) {
                turnStart = Math.max(0, Math.min(maxTurn, parseInt(tm[1], 10)));
                turnEnd = Math.max(turnStart, Math.min(maxTurn, parseInt(tm[2], 10)));
                break;
            }
        }
        // 没有 turns 行的块跳过（无法定位到具体 turn）
        if (!hasTurnLine) continue;
        if (turnStart < 0) continue;
        var turnIndices = [];
        for (var ti = turnStart; ti <= turnEnd; ti++) turnIndices.push(ti);
        var fields = extractEntryFields(block);
        if (!fields.event || fields.event.length < 3) continue;
        events.push({
            event: fields.event,
            period: fields.period,
            scene: fields.scene,
            start: turnStart,
            end: turnEnd,
            turnIndices: turnIndices
        });
    }
    // 如果 LLM 一个 event 都没输出，退化为全批一个 entry
    if (events.length === 0) {
        var fullIndices = [];
        for (var ti = 0; ti < maxTurn; ti++) fullIndices.push(ti);
        events.push({
            event: 'Batch turns 0-' + (maxTurn - 1),
            period: '',
            scene: '',
            start: 0,
            end: maxTurn - 1,
            turnIndices: fullIndices
        });
    }
    // 去重：按 turn range 合并重复的 event 块
    var seenTurns = {};
    var deduped = [];
    for (var ei = 0; ei < events.length; ei++) {
        var ev = events[ei];
        var key = ev.start + '-' + ev.end;
        if (seenTurns[key]) continue;
        seenTurns[key] = true;
        deduped.push(ev);
    }
    return deduped;
}

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

    // ── 单次 LLM 调用：整批一次性提取所有 event ──
    var batchPrompt = buildBatchPrompt(turns, vault);
    var responseText = '';
    try {
        responseText = await callLLM([
            { role: 'system', content: batchPrompt.system },
            { role: 'user', content: batchPrompt.user }
        ]);
    } catch (e) {
        console.warn('[NE] Batch LLM failed:', e.message);
    }

    // ── 按 event 块解析响应 ──
    var rawEvents = parseBatchResponse(responseText, maxTurn);
    var stmEntries = [];

    for (var i = 0; i < rawEvents.length; i++) {
        var r = rawEvents[i];
        var msgIds = collectMsgIdsFromTurns(turns, r.turnIndices);
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

    console.log('[NE] Batch extraction done — events=' + rawEvents.length);

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

    // 短路径：如果所有 turns 在 maxTurns 内，直接单次调用
    if (allTurns.length <= maxTurns) {
        var shortParams = Object.assign({}, buildParams, { vault: vault });
        var result = await runStmExtractorCore(allTurns, shortParams);
        if (onProgress) onProgress({ processedTurns: allTurns.length, totalTurns: allTurns.length });
        return result;
    }

    var totalAdded = 0;
    var turnIdx = 0;

    while (turnIdx < allTurns.length) {
        var batchTurns = [];
        var globalIndexMap = [];

        while (batchTurns.length < maxTurns && turnIdx < allTurns.length) {
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
