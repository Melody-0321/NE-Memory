var DAILY_KEY = 'ne_token_daily';
var MAX_DAILY_DAYS = 90;

function loadDaily() {
    try { return JSON.parse(localStorage.getItem(DAILY_KEY) || '{}'); } catch (e) { return {}; }
}

function saveDaily(data) {
    try { localStorage.setItem(DAILY_KEY, JSON.stringify(data)); } catch (e) {}
}

export function recordDailyToken(operation, value) {
    if (!value) return;
    var data = loadDaily();
    var today = new Date().toISOString().substring(0, 10);
    if (!data[today]) data[today] = { tok_stm: 0, tok_ltm: 0, tok_sp: 0, tok_tool: 0, tok_chat: 0 };
    data[today][operation] = (data[today][operation] || 0) + value;

    var keys = Object.keys(data).sort();
    while (keys.length > MAX_DAILY_DAYS) {
        delete data[keys[0]];
        keys.shift();
    }
    saveDaily(data);
}

export function getUsageOverview(getChatStatsFn) {
    var stats = getChatStatsFn() || {};
    var daily = loadDaily();
    var now = new Date();
    var thisMonth = now.toISOString().substring(0, 7);

    var sessionChat = 0, sessionNE = 0, sessionTurns = 0;
    var allChat = 0, allNE = 0, allTurns = 0;
    var monthChat = 0, monthNE = 0, monthDays = 0;

    Object.keys(stats).forEach(function(cid) {
        var chat = stats[cid];
        var agg = chat.aggregates || {};
        var tokChat = agg.total_tok_chat || 0;
        var tokNE = (agg.total_tok_stm || 0) + (agg.total_tok_ltm || 0) + (agg.total_tok_sp || 0) + (agg.total_tok_tool || 0);
        allChat += tokChat;
        allNE += tokNE;
        allTurns += agg.total_turns || 0;
    });

    Object.keys(daily).forEach(function(date) {
        if (date.substring(0, 7) === thisMonth) {
            var d = daily[date];
            monthChat += (d.tok_chat || 0);
            monthNE += (d.tok_stm || 0) + (d.tok_ltm || 0) + (d.tok_sp || 0) + (d.tok_tool || 0);
            monthDays++;
        }
    });

    sessionChat = allChat;
    sessionNE = allNE;
    sessionTurns = allTurns;

    return {
        sessionChat: sessionChat,
        sessionNE: sessionNE,
        sessionTotal: sessionChat + sessionNE,
        sessionAvgPerTurn: allTurns > 0 ? Math.round((sessionChat + sessionNE) / allTurns) : 0,
        monthChat: monthChat,
        monthNE: monthNE,
        monthTotal: monthChat + monthNE,
        monthAvgPerDay: monthDays > 0 ? Math.round((monthChat + monthNE) / monthDays) : 0,
        allChat: allChat,
        allNE: allNE,
        allTotal: allChat + allNE,
        allAvgPerDay: monthDays > 0 ? Math.round((allChat + allNE) / Math.max(1, monthDays)) : 0
    };
}

export function getDailyStats(days) {
    var data = loadDaily();
    var keys = Object.keys(data).sort();
    var result = [];
    var maxDays = days || 30;
    var startIdx = Math.max(0, keys.length - maxDays);
    for (var i = startIdx; i < keys.length; i++) {
        var d = data[keys[i]];
        result.push({
            date: keys[i],
            stm: d.tok_stm || 0,
            ltm: d.tok_ltm || 0,
            sp: d.tok_sp || 0,
            tool: d.tok_tool || 0,
            chat: d.tok_chat || 0
        });
    }
    return result;
}

export function getAllChatUsage(getAllChatStatsFn) {
    var stats = getAllChatStatsFn() || {};
    var result = [];
    Object.keys(stats).forEach(function(cid) {
        var chat = stats[cid];
        var agg = chat.aggregates || {};
        var tokNE = (agg.total_tok_stm || 0) + (agg.total_tok_ltm || 0) + (agg.total_tok_sp || 0) + (agg.total_tok_tool || 0);
        var tokChat = agg.total_tok_chat || 0;
        var totalTokens = tokNE + tokChat;
        var turns = agg.total_turns || 0;
        result.push({
            chatId: cid,
            turns: turns,
            totalTokens: totalTokens,
            avgPerTurn: turns > 0 ? Math.round(totalTokens / turns) : 0,
            tokChat: tokChat,
            tokNE: tokNE
        });
    });
    result.sort(function(a, b) { return b.totalTokens - a.totalTokens; });
    return result;
}
