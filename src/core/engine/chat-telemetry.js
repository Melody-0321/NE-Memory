/**
 * chat-telemetry.js — Per-chat 逐轮遥测计数器
 *
 * 存储结构（localStorage key: ne_chat_stats）：
 * {
 *   "chat_abc123": {
 *     "turns": [
 *       { "t": 1, "stm": 3, "ltm": 0, "llm": 2, "tool": 0, "tok": 500, "tok_stm": 300, "tok_consolidate": 120, "tok_state": 100, "tok_tool": 30, "tok_chat": 0, "err": 0, "dur": 1200 },
 *       ...
 *     ],
 *     "aggregates": {
 *       "total_turns": 2,
 *       "total_stm_count": 5,
 *       "total_ltm_count": 2,
 *       "total_llm_calls": 4,
 *       "total_tool_calls": 1,
 *       "total_tokens": 1300,
 *       "total_tok_stm": 800,
 *       "total_tok_consolidate": 300,
 *       "total_tok_state": 200,
 *       "total_tok_tool": 80,
 *       "total_tok_chat": 0,
 *       "total_errors": 0,
 *       "total_pipeline_duration_ms": 2700
 *     }
 *   }
 * }
 */

import { neSync } from '../settings-adapter.js';

const MAX_TURNS = 200;
const STORAGE_KEY = 'ne_chat_stats';
const FLUSH_DELAY_MS = 100;

// === P1: 内存缓存 + 节流落盘（每轮 ~6 次全量 JSON 读写 → 1 次节流写）===
// 崩溃最多丢 FLUSH_DELAY_MS 窗口内增量；跨 tab 以最后写入为准（已接受代价）
var _statsData = null;
var _statsDirty = false;
var _statsTimer = null;

function load() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) { return {}; }
}

function save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    try { neSync(STORAGE_KEY); } catch (e) {}
}

function _ensureStats() {
    if (_statsData === null) _statsData = load();
    return _statsData;
}

function _flushNow() {
    if (_statsTimer !== null) { clearTimeout(_statsTimer); _statsTimer = null; }
    if (_statsData !== null && _statsDirty) {
        _statsDirty = false;
        save(_statsData);
    }
}

function _scheduleFlush() {
    _statsDirty = true;
    if (_statsTimer !== null) return;
    _statsTimer = setTimeout(function() {
        _statsTimer = null;
        _flushNow();
    }, FLUSH_DELAY_MS);
}

// 页面卸载兜底：尽量把未落盘增量写出去
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', function() { _flushNow(); });
}

/** 立即落盘（供测试与退出边界使用） */
export function flushChatStats() {
    _flushNow();
}

/**
 * 对话轮次推进：轮数 +1，创建新一轮快照（轮次推进是自然边界，强制落盘）
 */
export function incrementChatTurn(chatId) {
    if (!chatId) return;
    var data = _ensureStats();
    var chat = data[chatId] || { turns: [], aggregates: null };
    var turns = chat.turns;
    var nextTurn = turns.length + 1;

    // 超出上限裁剪
    while (turns.length >= MAX_TURNS) turns.shift();

    turns.push({ t: nextTurn, stm: 0, ltm: 0, llm: 0, tool: 0, tok: 0, tok_stm: 0, tok_consolidate: 0, tok_state: 0, tok_tool: 0, tok_chat: 0, err: 0, dur: 0 });

    // 重建聚合
    chat.aggregates = rebuildAggregates(turns);
    data[chatId] = chat;
    _statsDirty = true;
    _flushNow();
}

/**
 * 更新当前轮快照的字段（累加模式）并刷新聚合（内存操作 + 节流落盘）
 * @param {string} chatId
 * @param {'stm'|'ltm'|'llm'|'tool'|'tok'|'err'|'dur'} key
 * @param {number} value - 对于 stm/ltm 是绝对值，其余是累加值
 */
export function recordChatStat(chatId, key, value) {
    if (!chatId || value === undefined || value === null) return;
    var data = _ensureStats();
    var chat = data[chatId];
    if (!chat || !chat.turns || chat.turns.length === 0) return;

    var current = chat.turns[chat.turns.length - 1];

    if (key === 'stm' || key === 'ltm') {
        // 绝对值覆盖（vault 大小快照）
        current[key] = value;
    } else {
        // 累加
        current[key] = (current[key] || 0) + value;
    }

    chat.aggregates = rebuildAggregates(chat.turns);
    data[chatId] = chat;
    _scheduleFlush();
}

/**
 * 获取当前轮号
 */
export function getChatTurnNumber(chatId) {
    if (!chatId) return 0;
    var data = _ensureStats();
    var chat = data[chatId];
    if (!chat || !chat.turns) return 0;
    return chat.turns.length;
}

/**
 * 按 operation 记录分类 token 消耗。
 * P1: 合并双写 — 'tok' 与 tokenOp 在同一次内存更新中生效，一次重建聚合 + 一次节流落盘
 * @param {string} chatId
 * @param {string} tokenOp - 'tok_stm' | 'tok_consolidate' | 'tok_sp' | 'tok_tool' | 'tok_chat'
 * @param {number} value
 */
export function recordChatToken(chatId, tokenOp, value) {
    if (!chatId || !value) return;
    var data = _ensureStats();
    var chat = data[chatId];
    if (!chat || !chat.turns || chat.turns.length === 0) return;

    var current = chat.turns[chat.turns.length - 1];
    current.tok = (current.tok || 0) + value;
    if (tokenOp) current[tokenOp] = (current[tokenOp] || 0) + value;

    chat.aggregates = rebuildAggregates(chat.turns);
    data[chatId] = chat;
    _scheduleFlush();
}

/**
 * 获取某 chat 的完整统计（读内存缓存；调用方只读）
 */
export function getChatStats(chatId) {
    if (!chatId) return null;
    var data = _ensureStats();
    return data[chatId] || null;
}

/**
 * 获取所有 chat 的统计摘要（读内存缓存；调用方只读）
 */
export function getAllChatStats() {
    return _ensureStats();
}

/**
 * 清除某 chat 统计（内存操作 + 立即落盘）
 */
export function clearChatStats(chatId) {
    if (!chatId) return;
    var data = _ensureStats();
    delete data[chatId];
    _statsDirty = true;
    _flushNow();
}

function rebuildAggregates(turns) {
    var agg = {
        total_turns: turns.length,
        total_stm_count: 0,
        total_ltm_count: 0,
        total_llm_calls: 0,
        total_tool_calls: 0,
        total_tokens: 0,
        total_tok_stm: 0,
        total_tok_consolidate: 0,
        total_tok_sp: 0,
        total_tok_state: 0,
        total_tok_tool: 0,
        total_tok_chat: 0,
        total_errors: 0,
        total_pipeline_duration_ms: 0
    };

    var lastTurn = turns[turns.length - 1];
    if (lastTurn) {
        // stm/ltm 取最后轮快照值（累积态）
        agg.total_stm_count = lastTurn.stm || 0;
        agg.total_ltm_count = lastTurn.ltm || 0;
    }

    for (var i = 0; i < turns.length; i++) {
        var t = turns[i];
        agg.total_llm_calls += t.llm || 0;
        agg.total_tool_calls += t.tool || 0;
        agg.total_tokens += t.tok || 0;
        agg.total_tok_stm += t.tok_stm || 0;
        agg.total_tok_consolidate += t.tok_consolidate || 0;
        agg.total_tok_sp += t.tok_sp || 0;
        agg.total_tok_state += t.tok_state || 0;
        agg.total_tok_tool += t.tok_tool || 0;
        agg.total_tok_chat += t.tok_chat || 0;
        agg.total_errors += t.err || 0;
        agg.total_pipeline_duration_ms += t.dur || 0;
    }

    return agg;
}
