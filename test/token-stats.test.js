// Node.js localStorage polyfill (not available in Node)
if (typeof localStorage === 'undefined') {
    var _store = {};
    globalThis.localStorage = {
        getItem: function(k) { return _store.hasOwnProperty(k) ? _store[k] : null; },
        setItem: function(k, v) { _store[k] = String(v); },
        removeItem: function(k) { delete _store[k]; },
        clear: function() { _store = {}; },
        get length() { return Object.keys(_store).length; },
        key: function(i) { return Object.keys(_store)[i] || null; }
    };
}

import { recordDailyToken, getUsageOverview, getDailyStats, flushDailyStats } from '../src/core/engine/token-stats.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + b + ', got ' + a + ')'); }

console.log('\n=== token-stats: cache + throttled flush (P4) ===');
localStorage.clear();

var TODAY = new Date().toISOString().substring(0, 10);
var THIS_MONTH = TODAY.substring(0, 7);

// 场景 1: 90 天滚动清理 — 先预置 95 天历史（不含今天），再触发 recordDailyToken
// 注意：本场景必须先于任何 recordDailyToken 执行，确保模块缓存加载的是预置数据
(function() {
    var seed = {};
    var todayTs = new Date(TODAY + 'T00:00:00Z').getTime();
    for (var i = 1; i <= 95; i++) {
        var d = new Date(todayTs - i * 86400000).toISOString().substring(0, 10);
        seed[d] = { tok_stm: 10, tok_ltm: 0, tok_state: 0, tok_tool: 0, tok_chat: 0 };
    }
    localStorage.setItem('ne_token_daily', JSON.stringify(seed));
    recordDailyToken('tok_stm', 1); // 触发缓存加载（95 键）+ 今日新键 = 96 → 裁剪
    flushDailyStats();
    var persisted = JSON.parse(localStorage.getItem('ne_token_daily') || '{}');
    eq(Object.keys(persisted).length, 90, '场景1: 裁剪后保留 90 天');
    eq(persisted[TODAY].tok_stm, 1, '场景1: 今日记录生效');
})();

// 场景 2: recordDailyToken 后读 API 即时可见（未 flush 走缓存），节流生效不落盘
(function() {
    recordDailyToken('tok_stm', 100);  // 今日 tok_stm: 1 + 100 = 101
    recordDailyToken('tok_ltm', 200);
    recordDailyToken('tok_chat', 300);
    var overview = getUsageOverview(function() { return {}; });
    eq(overview.breakdown.stm, 101, '场景2: breakdown.stm 即时可见（含场景1的1）');
    eq(overview.breakdown.ltm, 200, '场景2: breakdown.ltm 即时可见');
    eq(overview.breakdown.chat, 300, '场景2: breakdown.chat 即时可见');
    eq(overview.todayNE, 301, '场景2: todayNE = stm+ltm');
    eq(overview.todayTotal, 601, '场景2: todayTotal = NE+chat');
    // 未 flush 前 localStorage 不更新（节流生效）
    var persisted = JSON.parse(localStorage.getItem('ne_token_daily') || '{}');
    eq(persisted[TODAY].tok_stm, 1, '场景2: 节流生效，未 flush 前保持场景1落盘值');
})();

// 场景 3: flushDailyStats 落盘 + getDailyStats 读回
(function() {
    flushDailyStats();
    var persisted = JSON.parse(localStorage.getItem('ne_token_daily') || '{}');
    eq(persisted[TODAY].tok_stm, 101, '场景3: flush 后 tok_stm 落盘');
    eq(persisted[TODAY].tok_ltm, 200, '场景3: flush 后 tok_ltm 落盘');
    eq(persisted[TODAY].tok_chat, 300, '场景3: flush 后 tok_chat 落盘');
    var daily = getDailyStats(7);
    eq(daily.length, 7, '场景3: getDailyStats 返回最近 7 天');
    var todayEntry = daily.filter(function(d) { return d.date === TODAY; })[0];
    eq(todayEntry.stm, 101, '场景3: 今日 stm=101');
    eq(todayEntry.chat, 300, '场景3: 今日 chat=300');
})();

// 场景 4: getUsageOverview 月统计
(function() {
    var overview = getUsageOverview(function() { return {}; });
    eq(overview.monthNE >= 301, true, '场景4: 本月 NE 累计 >= 301');
    eq(overview.monthTotal >= 601, true, '场景4: 本月 total >= 601');
    eq(overview.monthDays >= 1, true, '场景4: 本月活跃天数 >= 1');
})();

console.log('\n=== token-stats: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
