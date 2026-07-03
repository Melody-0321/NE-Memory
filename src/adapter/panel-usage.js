import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { isAuto, getTelemetryStats } from '../core/params.js';
import { qs, qsa, byId, pdCreate, t, vaultLLMLog, panelById, panelQS, panelQSA } from './panel-shared.js';

var _chartInstances = {};

export async function renderUsageTab() {
    var container = panelById('ne-usage-container');
    if (!container) return;

    var debug = globalThis.__ne_debug;
    if (!debug || !debug.getUsageOverview) {
        container.innerHTML = '<div class="ne-usage-loading">' + t('Loading...') + '</div>';
        return;
    }

    if (!window.Chart) {
        container.innerHTML = '<div class="ne-usage-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading Chart.js...</div>';
        try {
            await new Promise(function(resolve, reject) {
                var script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
                script.onload = resolve;
                script.onerror = function() { reject(new Error('CDN load failed')); };
                document.head.appendChild(script);
            });
        } catch (e) {
            container.innerHTML = '<div class="ne-usage-loading">⚠ Chart.js load failed. ' + t('No test cases available') + '</div>';
            return;
        }
    }

    var overview = debug.getUsageOverview();
    var chats = debug.getAllChatUsage();

    function fmt(n) { return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

    var html = '';

    /* Section A: Cards */
    html += '<div class="ne-usage-section">' +
        '<div class="ne-usage-section-title"><i class="fa-solid fa-chart-bar"></i> ' + t('This Session') + ' / ' + t('This Month') + ' / ' + t('All Time') + '</div>' +
        '<div class="ne-usage-cards">' +
        '<div class="ne-usage-card"><div class="ne-usage-card-value"><i class="fa-solid fa-arrows-rotate"></i> ' + fmt(overview.sessionTotal) + '</div><div class="ne-usage-card-sub"><i class="fa-solid fa-gears"></i> ' + t('NE Pipeline') + ': ' + fmt(overview.sessionNE) + ' | <i class="fa-solid fa-user"></i> ' + t('User Chat') + ': ' + fmt(overview.sessionChat) + '</div><div class="ne-usage-card-sub">' + (overview.sessionTurns || 0) + ' ' + t('Turns') + ' | ' + t('Avg / Turn') + ': ' + fmt(overview.sessionAvgPerTurn) + '</div></div>' +
        '<div class="ne-usage-card"><div class="ne-usage-card-value"><i class="fa-solid fa-calendar-days"></i> ' + fmt(overview.monthTotal) + '</div><div class="ne-usage-card-sub"><i class="fa-solid fa-gears"></i> ' + t('NE Pipeline') + ': ' + fmt(overview.monthNE) + ' | <i class="fa-solid fa-user"></i> ' + t('User Chat') + ': ' + fmt(overview.monthChat) + '</div><div class="ne-usage-card-sub">' + (overview.monthDays || 0) + ' ' + t('Days') + ' | ' + t('Avg / Day') + ': ' + fmt(overview.monthAvgPerDay) + '</div></div>' +
        '<div class="ne-usage-card"><div class="ne-usage-card-value"><i class="fa-solid fa-table"></i> ' + fmt(overview.allTotal) + '</div><div class="ne-usage-card-sub"><i class="fa-solid fa-gears"></i> ' + t('NE Pipeline') + ': ' + fmt(overview.allNE) + ' | <i class="fa-solid fa-user"></i> ' + t('User Chat') + ': ' + fmt(overview.allChat) + '</div><div class="ne-usage-card-sub">' + (overview.totalDays || 0) + ' ' + t('Days') + ' | ' + t('Avg / Day') + ': ' + fmt(overview.allAvgPerDay) + '</div></div>' +
        '</div></div>';

    /* Section B: Pipeline breakdown — pie chart with scope dropdown */
    html += '<div class="ne-usage-section">' +
        '<div class="ne-usage-section-title"><i class="fa-solid fa-chart-bar"></i> ' + t('Pipeline Breakdown') + '</div>' +
        '<select id="ne-breakdown-scope" onchange="(function(){var s=document.getElementById(\'ne-breakdown-scope\').value;document.getElementById(\'ne-breakdown-month-wrap\').style.display=s===\'month\'?\'\':\'none\';window._renderBreakdownPie&&window._renderBreakdownPie();})()">' +
        '<option value="chat">' + t('Current Chat') + '</option>' +
        '<option value="month">' + t('This Month') + '</option>' +
        '<option value="all">' + t('All Time') + '</option>' +
        '</select>' +
        '<span id="ne-breakdown-month-wrap" style="display:none">' +
        '<select id="ne-breakdown-month" onchange="window._renderBreakdownPie&&window._renderBreakdownPie()"></select>' +
        '</span>' +
        '<div class="ne-usage-chart-wrap"><canvas id="ne-breakdown-pie-canvas"></canvas></div>' +
        '<div id="ne-breakdown-empty" style="display:none;text-align:center;color:var(--grey-50);padding:12px;">' + t('No data') + '</div>' +
        '</div>';

    /* Section C: Daily trend — bar chart with month dropdown */
    html += '<div class="ne-usage-section">' +
        '<div class="ne-usage-section-title"><i class="fa-solid fa-chart-line"></i> ' + t('Daily Trend') + '</div>' +
        '<select id="ne-daily-month" onchange="window._renderDailyBar&&window._renderDailyBar()"></select>' +
        '<div class="ne-usage-chart-wrap-tall"><canvas id="ne-daily-bar-canvas"></canvas></div>' +
        '<div id="ne-daily-bar-empty" style="display:none;text-align:center;color:var(--grey-50);padding:12px;">' + t('No data') + '</div>' +
        '</div>';

    /* Section D: Per-chat table */
    html += '<div class="ne-usage-section">' +
        '<div class="ne-usage-section-title"><i class="fa-solid fa-list-check"></i> ' + t('Per Chat') + '</div>';
    if (chats.length > 0) {
        html += '<table class="ne-usage-chat-table"><tr><th>Chat</th><th>' + t('Per Chat') + '</th><th>' + t('Total Tokens') + '</th><th>' + t('Avg / Turn') + '</th></tr>';
        for (var i = 0; i < chats.length; i++) {
            var c = chats[i];
            html += '<tr><td>' + escapeHtml(c.chatId.substring(0, 30) + (c.chatId.length > 30 ? '...' : '')) + '</td><td>' + c.turns + '</td><td>' + fmt(c.totalTokens) + '</td><td>' + fmt(c.avgPerTurn) + '</td></tr>';
        }
        html += '</table>';
    } else {
        html += '<div class="ne-usage-card-sub">' + t('No test cases available') + '</div>';
    }
    html += '</div>';

    container.innerHTML = html;

    /* Chart.js rendering */
    try {
        var debug2 = globalThis.__ne_debug;

        /* Populate month dropdowns */
        var months = debug2 && debug2.getAvailableMonths ? debug2.getAvailableMonths() : [];
        var breakdownMonthSel = panelById('ne-breakdown-month');
        var dailyMonthSel = panelById('ne-daily-month');
        if (months.length > 0) {
            for (var mi = 0; mi < months.length; mi++) {
                var m = months[mi];
                if (breakdownMonthSel) { var bo = pdCreate('option'); bo.value = m; bo.textContent = m; breakdownMonthSel.appendChild(bo); }
                if (dailyMonthSel) { var do1 = pdCreate('option'); do1.value = m; do1.textContent = m; dailyMonthSel.appendChild(do1); }
            }
        }

        /* —— Breakdown pie chart —— */
        window._renderBreakdownPie = function() {
            var scopeSel = panelById('ne-breakdown-scope');
            var scope = scopeSel ? scopeSel.value : 'all';
            var breakdown;
            if (scope === 'chat' && debug2.getChatBreakdown && debug2.getCurrentChatId) {
                breakdown = debug2.getChatBreakdown(debug2.getCurrentChatId());
            } else if (scope === 'month' && debug2.getMonthlyBreakdown) {
                var monthSel = panelById('ne-breakdown-month');
                var monthVal = monthSel ? monthSel.value : (months.length > 0 ? months[0] : new Date().toISOString().substring(0, 7));
                breakdown = debug2.getMonthlyBreakdown(monthVal);
            } else {
                breakdown = overview.breakdown || { stm: 0, ltm: 0, sp: 0, tool: 0, chat: 0 };
            }

            var bc = breakdown;
            var bData = [(bc && bc.stm) || 0, (bc && bc.ltm) || 0, (bc && bc.sp) || 0, (bc && bc.tool) || 0, (bc && bc.chat) || 0];
            var bSum = bData[0] + bData[1] + bData[2] + bData[3] + bData[4];

            var emptyEl = panelById('ne-breakdown-empty');
            if (bSum === 0) {
                if (emptyEl) emptyEl.style.display = '';
                if (_chartInstances.pie) { _chartInstances.pie.destroy(); _chartInstances.pie = null; }
                return;
            }
            if (emptyEl) emptyEl.style.display = 'none';

            var pieCtx = panelById('ne-breakdown-pie-canvas');
            if (!pieCtx || !window.Chart) return;
            if (_chartInstances.pie) _chartInstances.pie.destroy();
            _chartInstances.pie = new Chart(pieCtx, {
                type: 'pie',
                data: {
                    labels: ['STM', 'LTM', 'SmartPush', 'Tool', t('User Chat')],
                    datasets: [{
                        data: bData,
                        backgroundColor: ['#4CAF50', '#FF9800', '#2196F3', '#9C27B0', '#9E9E9E']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        tooltip: { callbacks: { label: function(ctx) { return ctx.label + ': ' + fmt(ctx.raw); } } },
                        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } }
                    }
                }
            });
        };

        /* —— Daily bar chart —— */
        window._renderDailyBar = function() {
            var monthSel = panelById('ne-daily-month');
            var monthVal = monthSel ? monthSel.value : (months.length > 0 ? months[0] : new Date().toISOString().substring(0, 7));
            var dailyData = debug2 && debug2.getMonthlyStats ? debug2.getMonthlyStats(monthVal) : [];

            var emptyEl = panelById('ne-daily-bar-empty');
            if (dailyData.length === 0) {
                if (emptyEl) emptyEl.style.display = '';
                if (_chartInstances.dailyBar) { _chartInstances.dailyBar.destroy(); _chartInstances.dailyBar = null; }
                return;
            }
            if (emptyEl) emptyEl.style.display = 'none';

            var barCtx = panelById('ne-daily-bar-canvas');
            if (!barCtx || !window.Chart) return;
            if (_chartInstances.dailyBar) _chartInstances.dailyBar.destroy();
            _chartInstances.dailyBar = new Chart(barCtx, {
                type: 'bar',
                data: {
                    labels: dailyData.map(function(d) { return d.date.substring(5); }),
                    datasets: [
                        { label: 'STM', data: dailyData.map(function(d) { return d.stm; }), backgroundColor: '#4CAF50' },
                        { label: 'LTM', data: dailyData.map(function(d) { return d.ltm; }), backgroundColor: '#FF9800' },
                        { label: 'SmartPush', data: dailyData.map(function(d) { return d.sp; }), backgroundColor: '#2196F3' },
                        { label: 'Tool', data: dailyData.map(function(d) { return d.tool; }), backgroundColor: '#9C27B0' },
                        { label: t('User Chat'), data: dailyData.map(function(d) { return d.chat; }), backgroundColor: '#9E9E9E' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } },
                    scales: {
                        x: { stacked: false },
                        y: { stacked: false, ticks: { callback: function(v) { return fmt(v); } } }
                    }
                }
            });
        };

        /* Initial render */
        if (window._renderBreakdownPie) window._renderBreakdownPie();
        if (window._renderDailyBar) window._renderDailyBar();

    } catch (e) {
        console.warn('[NE] Chart render failed:', e);
    }
}
