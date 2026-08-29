// history-processor.js — 处理历史批量补摘：后台编排、按聊天断点、可取消、批间让出 STM 队列
//
// 设计要点（vNext）：批内走 enqueueStmWrite 保证 vault 写入串行；批间让出事件循环，
// 正常管线任务可插入批间执行，处理历史长跑不再阻塞新消息的记忆更新（旧实现独占队列导致卡顿）。
import { executeIncrementalUpdate } from './stm-pipeline.js';
import { enqueueStmWrite } from './pipeline-guard.js';
import { readVault, collectAllMsgIds } from '../vault/store.js';

var _activeChatId = null;   // 同时只允许一个聊天在处理
var _jobs = {};             // chatId -> { status, total, processed, cancelRequested }
var BP_PREFIX = 'ne_ph_';   // 断点 key，与旧版兼容（旧版也写 ne_ph_<chatId>）

/**
 * 查询某聊天的处理历史状态（UI 渲染按钮态用）。
 * @param {string} chatId
 * @returns {{status:'idle'|'running'|'breakpoint', processed:number, total:number}}
 */
export function getHistoryStatus(chatId) {
    var job = _jobs[chatId];
    if (job && job.status === 'running') {
        return { status: 'running', processed: job.processed, total: job.total };
    }
    var bp = readBreakpoint(chatId);
    if (bp && bp.i > 0 && bp.i < bp.total) {
        return { status: 'breakpoint', processed: bp.i, total: bp.total };
    }
    return { status: 'idle', processed: 0, total: 0 };
}

/**
 * 取消指定聊天的处理历史任务。仅在批间生效，进行中的 LLM 调用不中断（无半截写），断点保留。
 * @param {string} chatId
 */
export function cancelHistoryProcessing(chatId) {
    var job = _jobs[chatId];
    if (job && job.status === 'running') job.cancelRequested = true;
}

/**
 * 启动处理历史（单任务：同时只允许一个聊天在处理）。
 * @param {string} chatId
 * @param {object} opts
 * @param {function():Array} opts.getMessages 返回 [{id,is_user,mes,name}]（未处理的原始消息）
 * @param {number} [opts.batchSize] 每批消息数，默认 20
 * @param {function} [opts.onProgress] 回调 {processed, total}
 * @param {function} [opts.onDone] 回调 {status:'done'|'cancelled'|'error'|'skipped', processed, total}
 * @returns {Promise<{status:'ok'|'busy'|'error'}>}
 */
export async function startHistoryProcessing(chatId, opts) {
    opts = opts || {};
    if (_activeChatId) return { status: 'busy' };
    var getMessages = opts.getMessages || function () { return []; };
    var batchSize = Math.max(1, Math.floor(Number(opts.batchSize) || 20));
    var onProgress = opts.onProgress || function () {};
    var onDone = opts.onDone || function () {};

    // 同步注册任务，杜绝并发 start / cancel 竞态
    var job = { status: 'running', total: 0, processed: 0, cancelRequested: false };
    _jobs[chatId] = job;
    _activeChatId = chatId;

    function release() {
        if (_activeChatId === chatId) _activeChatId = null;
        delete _jobs[chatId];
    }

    // 扫描并过滤已处理消息
    var toProcess = [];
    try {
        var messages = getMessages();
        if (messages.length > 0) {
            var vault = await readVault(chatId);
            var stmMsgIdSet = collectAllMsgIds(vault);
            for (var mi = 0; mi < messages.length; mi++) {
                var m = messages[mi];
                var content = m.mes || '';
                if (content.trim().length === 0) continue;
                if (stmMsgIdSet.has(String(m.id))) continue;
                toProcess.push({ id: m.id, is_user: !!m.is_user, mes: content, name: m.name || '' });
            }
        }
    } catch (e) {
        console.error('[NE] History processor: scan failed:', e);
        release();
        onDone({ status: 'error', processed: 0, total: 0 });
        return { status: 'error' };
    }

    var total = toProcess.length;
    if (total === 0) {
        clearBreakpoint(chatId);
        release();
        onDone({ status: 'done', processed: 0, total: 0, skipped: true });
        return { status: 'ok' };
    }
    job.total = total;

    // 断点续跑：startIdx = clamp(bp.i, 0, total)
    var bp = readBreakpoint(chatId);
    var startIdx = 0;
    if (bp && bp.i > 0 && bp.i < total) startIdx = bp.i;
    job.processed = startIdx;
    onProgress({ processed: startIdx, total: total });

    var i = startIdx;
    var finalStatus = 'done';
    try {
        while (i < total) {
            if (job.cancelRequested) { finalStatus = 'cancelled'; break; }
            var batch = toProcess.slice(i, i + batchSize);
            // 批内走 STM 队列串行写 vault；批间让出，正常管线可插入
            await enqueueStmWrite(function () {
                return executeIncrementalUpdate(chatId, batch, true, null);
            });
            i = Math.min(i + batchSize, total);
            job.processed = i;
            saveBreakpoint(chatId, i, total);
            onProgress({ processed: i, total: total });
            // 让出事件循环，UI 可绘制
            await new Promise(function (r) { setTimeout(r, 0); });
        }
    } catch (e) {
        console.error('[NE] History processor failed:', e);
        finalStatus = 'error';
    } finally {
        if (finalStatus === 'done') clearBreakpoint(chatId);
        job.status = finalStatus;
        release();
    }

    onDone({ status: finalStatus, processed: job.processed, total: total });
    return { status: 'ok' };
}

function readBreakpoint(chatId) {
    try {
        var raw = localStorage.getItem(BP_PREFIX + chatId);
        if (!raw) return null;
        var d = JSON.parse(raw);
        return d && typeof d.i === 'number' ? d : null;
    } catch (e) { return null; }
}

function saveBreakpoint(chatId, i, total) {
    try { localStorage.setItem(BP_PREFIX + chatId, JSON.stringify({ t: Date.now(), i: i, total: total })); } catch (e) {}
}

function clearBreakpoint(chatId) {
    try { localStorage.removeItem(BP_PREFIX + chatId); } catch (e) {}
}
