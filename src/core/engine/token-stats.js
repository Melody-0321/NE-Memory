var DAILY_KEY = 'ne_token_daily';
var MAX_DAILY_DAYS = 90;

var _sessionSnapshot = null;

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
    if (!data[today]) data[today] = { tok_stm: 0, tok_ltm: 0, tok_state: 0, tok_tool: 0, tok_chat: 0 };
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
    var today = now.toISOString().substring(0, 10);

    var allChat = 0, allNE = 0, allTurns = 0;
    var todayChat = 0, todayNE = 0;
    var todayStm = 0, todayLtm = 0, todayState = 0, todayTool = 0;
    var monthChat = 0, monthNE = 0, monthDays = 0;

    Object.keys(stats).forEach(function(cid) {
        var agg = (stats[cid] && stats[cid].aggregates) || {};
        allChat += agg.total_tok_chat || 0;
        var ne = (agg.total_tok_stm || 0) + (agg.total_tok_ltm || 0) + (agg.total_tok_state || 0) + (agg.total_tok_tool || 0);
        allNE += ne;
        allTurns += agg.total_turns || 0;
    });

    Object.keys(daily).forEach(function(date) {
        var d = daily[date];
        if (date === today) {
            todayChat = d.tok_chat || 0;
            todayStm = d.tok_stm || 0;
            todayLtm = d.tok_ltm || 0;
            todayState = d.tok_state || 0;
            todayTool = d.tok_tool || 0;
            todayNE = todayStm + todayLtm + todayState + todayTool;
        }
        if (date.substring(0, 7) === thisMonth) {
            monthChat += (d.tok_chat || 0);
            monthNE += (d.tok_stm || 0) + (d.tok_ltm || 0) + (d.tok_state || 0) + (d.tok_tool || 0);
            monthDays++;
        }
    });

    if (!_sessionSnapshot) {
        _sessionSnapshot = { chat: allChat, ne: allNE, turns: allTurns };
    }

    var sessionChat = allChat - _sessionSnapshot.chat;
    var sessionNE = allNE - _sessionSnapshot.ne;
    var sessionTurns = allTurns - _sessionSnapshot.turns;

    return {
        sessionChat: sessionChat,
        sessionNE: sessionNE,
        sessionTotal: sessionChat + sessionNE,
        sessionAvgPerTurn: sessionTurns > 0 ? Math.round((sessionChat + sessionNE) / sessionTurns) : 0,
        todayChat: todayChat,
        todayNE: todayNE,
        todayTotal: todayChat + todayNE,
        monthChat: monthChat,
        monthNE: monthNE,
        monthTotal: monthChat + monthNE,
        monthAvgPerDay: monthDays > 0 ? Math.round((monthChat + monthNE) / monthDays) : 0,
        sessionTurns: sessionTurns,
        monthDays: monthDays,
        breakdown: {
            stm: todayStm,
            ltm: todayLtm,
            state: todayState,
            tool: todayTool,
            chat: todayChat
        }
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
            state: d.tok_state || 0,
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
        var tokNE = (agg.total_tok_stm || 0) + (agg.total_tok_ltm || 0) + (agg.total_tok_state || 0) + (agg.total_tok_tool || 0);
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

export function getMonthlyBreakdown(month) {
    var data = loadDaily();
    var stm = 0, ltm = 0, state = 0, tool = 0, chat = 0;
    Object.keys(data).forEach(function(date) {
        if (date.substring(0, 7) === month) {
            var d = data[date];
            stm += (d.tok_stm || 0);
            ltm += (d.tok_ltm || 0);
            state += (d.tok_state || 0);
            tool += (d.tok_tool || 0);
            chat += (d.tok_chat || 0);
        }
    });
    return { stm: stm, ltm: ltm, state: state, tool: tool, chat: chat };
}

export function getChatBreakdown(getChatStatsFn, chatId) {
    var stats = getChatStatsFn() || {};
    var chat = stats[chatId];
    if (!chat || !chat.aggregates) return { stm: 0, ltm: 0, state: 0, tool: 0, chat: 0 };
    var agg = chat.aggregates;
    return {
        stm: agg.total_tok_stm || 0,
        ltm: agg.total_tok_ltm || 0,
        state: agg.total_tok_state || 0,
        tool: agg.total_tok_tool || 0,
        chat: agg.total_tok_chat || 0
    };
}

export function getAvailableMonths() {
    var data = loadDaily();
    var months = {};
    Object.keys(data).forEach(function(date) {
        months[date.substring(0, 7)] = true;
    });
    var list = Object.keys(months).sort().reverse();
    if (list.length === 0) list.push(new Date().toISOString().substring(0, 7));
    return list;
}

export function getMonthlyStats(month) {
    var data = loadDaily();
    var keys = Object.keys(data).sort();
    var result = [];
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].substring(0, 7) === month) {
            var d = data[keys[i]];
            result.push({
                date: keys[i],
                stm: d.tok_stm || 0,
                ltm: d.tok_ltm || 0,
                state: d.tok_state || 0,
                tool: d.tok_tool || 0,
                chat: d.tok_chat || 0
            });
        }
    }
    return result;
}
