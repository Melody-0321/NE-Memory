/**
 * chat-telemetry.js — Per-chat 逐轮遥测计数器
 *
 * 存储结构（localStorage key: ne_chat_stats）：
 * {
 *   "chat_abc123": {
 *     "turns": [
 *       { "t": 1, "stm": 3, "ltm": 0, "llm": 2, "tool": 0, "tok": 500, "err": 0, "dur": 1200 },
 *       ...
 *     ],
 *     "aggregates": {
 *       "total_turns": 2,
 *       "total_stm_count": 5,
 *       "total_ltm_count": 2,
 *       "total_llm_calls": 4,
 *       "total_tool_calls": 1,
 *       "total_tokens": 1300,
 *       "total_errors": 0,
 *       "total_smartpush_injections": 2,
 *       "total_pipeline_duration_ms": 2700
 *     }
 *   }
 * }
 */

const MAX_TURNS = 200;
const STORAGE_KEY = 'ne_chat_stats';

function load() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) { return {}; }
}

function save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}

/**
 * 对话轮次推进：轮数 +1，创建新一轮快照
 */
export function incrementChatTurn(chatId) {
    if (!chatId) return;
    var data = load();
    var chat = data[chatId] || { turns: [], aggregates: null };
    var turns = chat.turns;
    var nextTurn = turns.length + 1;

    // 超出上限裁剪
    while (turns.length >= MAX_TURNS) turns.shift();

    turns.push({ t: nextTurn, stm: 0, ltm: 0, llm: 0, tool: 0, tok: 0, err: 0, dur: 0 });

    // 重建聚合
    chat.aggregates = rebuildAggregates(turns);
    data[chatId] = chat;
    save(data);
}

/**
 * 更新当前轮快照的字段（累加模式）并刷新聚合
 * @param {string} chatId
 * @param {'stm'|'ltm'|'llm'|'tool'|'tok'|'err'|'dur'} key
 * @param {number} value - 对于 stm/ltm 是绝对值，其余是累加值
 */
export function recordChatStat(chatId, key, value) {
    if (!chatId || value === undefined || value === null) return;
    var data = load();
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
    save(data);
}

/**
 * 获取当前轮号
 */
export function getChatTurnNumber(chatId) {
    if (!chatId) return 0;
    var data = load();
    var chat = data[chatId];
    if (!chat || !chat.turns) return 0;
    return chat.turns.length;
}

/**
 * 获取某 chat 的完整统计
 */
export function getChatStats(chatId) {
    if (!chatId) return null;
    var data = load();
    return data[chatId] || null;
}

/**
 * 获取所有 chat 的统计摘要
 */
export function getAllChatStats() {
    return load();
}

/**
 * 清除某 chat 统计
 */
export function clearChatStats(chatId) {
    if (!chatId) return;
    var data = load();
    delete data[chatId];
    save(data);
}

function rebuildAggregates(turns) {
    var agg = {
        total_turns: turns.length,
        total_stm_count: 0,
        total_ltm_count: 0,
        total_llm_calls: 0,
        total_tool_calls: 0,
        total_tokens: 0,
        total_errors: 0,
        total_smartpush_injections: 0,
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
        agg.total_errors += t.err || 0;
        agg.total_pipeline_duration_ms += t.dur || 0;
    }

    // SmartPush 注入次数 ≈ LLM 调用中 smartpush 类型（保守估计）
    agg.total_smartpush_injections = agg.total_turns;

    return agg;
}
