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

// 检测 LLM 是否在回显 prompt（如 flash 模型常见的 echo 行为）
function isResponseEcho(responseText, promptText) {
    if (!responseText || !promptText) return false;
    var cleaned = responseText.replace(/<thought>[\s\S]*?<\/thought>/gi, '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    var promptPrefix = promptText.substring(0, 100).trim();
    if (!promptPrefix) return false;
    // 取 prompt 前 100 字中不含换行和标点的纯文字段做指纹
    var fingerprint = promptPrefix.replace(/[\n\r\s]+/g, ' ').substring(0, 40).trim();
    if (fingerprint.length < 10) return false;
    return cleaned.indexOf(fingerprint) === 0;
}

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
        // 接受 event: 字段 或 Turn N-M: 开头的块
        var hasEventLine = /^event\s*[:：]/im.test(block);
        var turnPrefixMatch = block.match(/^Turn\s+(\d+)\s*[-–~至到]\s*(\d+)\s*[:：]/im);
        if (!hasEventLine && !turnPrefixMatch) continue;
        var hasTurnLine = /^turns?\s*[:：]/im.test(block) || !!turnPrefixMatch;
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
            // Fallback: Turn N-M: ... 格式
            var tpm = line.match(/^Turn\s+(\d+)\s*[-–~至到]\s*(\d+)\s*[:：]/i);
            if (tpm) {
                turnStart = Math.max(0, Math.min(maxTurn, parseInt(tpm[1], 10)));
                turnEnd = Math.max(turnStart, Math.min(maxTurn, parseInt(tpm[2], 10)));
                break;
            }
        }
        if (turnStart < 0 && !hasTurnLine) continue;
        if (turnStart < 0) {
            turnStart = 0;
            turnEnd = maxTurn - 1;
        }
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

    // ── LLM 调用 + 解析 + 重试 ──
    var rawEvents = [];
    var maxRetries = 2;

    for (var attempt = 0; attempt <= maxRetries; attempt++) {
        var batchPrompt = buildBatchPrompt(turns, vault, attempt);
        var responseText = '';
        try {
            responseText = await callLLM([
                { role: 'system', content: batchPrompt.system },
                { role: 'user', content: batchPrompt.user }
            ]);
        } catch (e) {
            console.warn('[NE] Batch LLM failed (attempt ' + (attempt + 1) + '):', e.message);
            if (attempt < maxRetries) continue;
            break;
        }

        if (isResponseEcho(responseText, batchPrompt.system)) {
            console.warn('[NE] Batch LLM response is prompt echo (attempt ' + (attempt + 1) + '), retrying...');
            continue;
        }

        rawEvents = parseBatchResponse(responseText, maxTurn);
        if (rawEvents.length === 0) {
            console.warn('[NE] Batch LLM returned 0 valid events (attempt ' + (attempt + 1) + '), retrying...');
            continue;
        }

        // 检查缺失的 turn 范围
        if (attempt < maxRetries) {
            var coveredSet = {};
            for (var ei = 0; ei < rawEvents.length; ei++) {
                for (var ti = rawEvents[ei].start; ti <= rawEvents[ei].end; ti++) {
                    coveredSet[ti] = true;
                }
            }
            var missing = [];
            for (var ti = 0; ti <= maxTurn; ti++) {
                if (!coveredSet[ti]) missing.push(ti);
            }
            if (missing.length > 0) {
                var missingRanges = [];
                var ms = missing[0], me = missing[0];
                for (var mi = 1; mi < missing.length; mi++) {
                    if (missing[mi] === me + 1) { me = missing[mi]; }
                    else { missingRanges.push(ms === me ? '' + ms : ms + '-' + me); ms = missing[mi]; me = missing[mi]; }
                }
                missingRanges.push(ms === me ? '' + ms : ms + '-' + me);
                console.warn('[NE] Batch LLM missed turns ' + missingRanges.join(',') + ' (attempt ' + (attempt + 1) + '), retrying with feedback...');

                var feedbackPrompt = buildBatchPrompt(turns, vault, -1, missingRanges);
                try {
                    responseText = await callLLM([
                        { role: 'system', content: feedbackPrompt.system },
                        { role: 'user', content: feedbackPrompt.user }
                    ]);
                } catch (e) {
                    console.warn('[NE] Batch LLM feedback retry failed:', e.message);
                    continue;
                }
                if (isResponseEcho(responseText, feedbackPrompt.system)) {
                    console.warn('[NE] Feedback retry response is prompt echo, giving up');
                    continue;
                }
                var supplementEvents = parseBatchResponse(responseText, maxTurn);
                if (supplementEvents.length > 0) {
                    rawEvents = rawEvents.concat(supplementEvents);
                }
                break;
            }
        }

        // 回显检测 2：event 文本中含 prompt 原句
        var suspiciousCount = 0;
        for (var ei = 0; ei < rawEvents.length; ei++) {
            if (rawEvents[ei].event.indexOf('被问到') >= 0 || rawEvents[ei].event.indexOf('asked to') >= 0 ||
                rawEvents[ei].event.indexOf('输出格式') >= 0 || rawEvents[ei].event.indexOf('Output format') >= 0) {
                suspiciousCount++;
            }
        }
        if (suspiciousCount >= rawEvents.length) {
            console.warn('[NE] All events appear to be prompt echo (attempt ' + (attempt + 1) + '), retrying...');
            rawEvents = [];
            continue;
        }

        break;
    }

    if (rawEvents.length === 0) {
        console.warn('[NE] All LLM attempts failed, falling back to single-entry batch');
        var fallbackIndices = [];
        for (var fi = 0; fi <= maxTurn; fi++) fallbackIndices.push(fi);
        rawEvents = [{ event: 'Batch turns 0-' + maxTurn, period: '', scene: '', start: 0, end: maxTurn, turnIndices: fallbackIndices }];
    }
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
