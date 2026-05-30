/**
 * ui/config-dialog.js — 设置面板（ST 扩展设置 inline-drawer）
 *
 * 通过 window.parent.document 操作主 ST 页面 DOM，#extensions_settings 挂载。
 */
import { t_config, t_narrative } from '../i18n.js';
import { saveSecondaryApiConfig, telemetryBuffer, recordTelemetry, isTelemetryEnabled } from '../api/llm.js';

function $pd(selector) {
    return $(selector, window.parent.document);
}

export function renderConfigDialog(getChatId) {
    if ($pd('#ne_config_settings').length) return;

    var html = '<div id="ne_config_settings" class="inline-drawer">' +
        '<div class="inline-drawer-toggle inline-drawer-header">' +
        '<b>' + t_narrative('Narrative Engine') + '</b>' +
        '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>' +
        '</div>' +
        '<div class="inline-drawer-content" style="padding:10px;">' +
        '<div class="narrative-toggle"><label class="checkbox_label"><input type="checkbox" id="ne_enable_telemetry"> <span>' + t_config('narrative_label_enable_telemetry') + '</span></label></div>' +
        '<hr style="border-color:var(--black30a);margin:8px 0;">' +
        '<h4 style="margin:0 0 4px;">' + t_config('副 API') + '</h4>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('API URL') + '</label><br><input id="ne_secondary_url" class="text_pole" style="width:100%;" placeholder="https://api.openai.com/v1/chat/completions"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('API Key') + '</label><br><input id="ne_secondary_key" class="text_pole" style="width:100%;" type="password" placeholder="sk-..."></div>' +
        '<div style="margin:4px 0 8px;"><label style="font-size:0.85em;">' + t_config('Model') + '</label><br><input id="ne_secondary_model" class="text_pole" style="width:100%;" placeholder="gpt-4o-mini"></div>' +
        '<hr style="border-color:var(--black30a);margin:8px 0;">' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
        '<button id="ne_config_save" class="menu_button">' + t_narrative('Save') + '</button>' +
        '<button id="ne_export_telemetry" class="menu_button" style="margin-left:auto;">' + t_narrative('Export Logs') + ' / Report</button>' +
        '</div>' +
        '</div>' +
        '</div>';

    $pd('#extensions_settings').append(html);
    loadConfigUI();
    $pd('#ne_config_save').on('click', saveConfigUI);
    $pd('#ne_export_telemetry').on('click', function () {
        var data = collectTelemetryData(getChatId ? getChatId() : 'default');
        uploadTelemetryToIssue(data);
    });
}

function loadConfigUI() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            $pd('#ne_enable_telemetry').prop('checked', s.enableTelemetry || false);
        }
    } catch (e) {}
    try {
        var raw = localStorage.getItem('ne_secondary_api');
        if (raw) {
            var api = JSON.parse(raw);
            $pd('#ne_secondary_url').val(api.url || '');
            $pd('#ne_secondary_key').val(api.key || '');
            $pd('#ne_secondary_model').val(api.model || '');
        }
    } catch (e) {}
}

function saveConfigUI() {
    var settings = { enableTelemetry: $pd('#ne_enable_telemetry').prop('checked') };
    localStorage.setItem('ne_settings', JSON.stringify(settings));
    saveSecondaryApiConfig({
        url: $pd('#ne_secondary_url').val().trim(),
        key: $pd('#ne_secondary_key').val().trim(),
        model: $pd('#ne_secondary_model').val().trim()
    });
}

function collectTelemetryData(chatId) {
    var totalCalls = telemetryBuffer.length;
    var totalDurationMs = 0;
    var byOperation = {};
    var bySource = {};
    var totalTokens = 0;
    var totalErrors = 0;
    var p95LatencyMs = 0;

    telemetryBuffer.forEach(function (entry) {
        totalDurationMs += entry.duration_ms || 0;
        if (entry.tokens) totalTokens += entry.tokens;
        if (entry.error) totalErrors++;
        var op = entry.operation || 'unknown';
        byOperation[op] = (byOperation[op] || 0) + 1;
        var src = entry.api_source || 'unknown';
        bySource[src] = (bySource[src] || 0) + 1;
    });

    var durations = telemetryBuffer.map(function (e) { return e.duration_ms || 0; }).sort(function (a, b) { return a - b; });
    if (durations.length > 0) {
        var idx = Math.ceil(durations.length * 0.95) - 1;
        p95LatencyMs = durations[Math.max(0, idx)];
    }

    return {
        version: '0.2.0',
        platform: 'SillyTavern',
        environment: typeof TavernHelper !== 'undefined' ? 'TH' : 'standalone',
        chat_id: chatId,
        session_duration_hours: 0,
        total_calls: totalCalls,
        total_duration_ms: totalDurationMs,
        avg_latency_ms: totalCalls > 0 ? Math.round(totalDurationMs / totalCalls) : 0,
        p95_latency_ms: p95LatencyMs,
        total_tokens: totalTokens,
        error_count: totalErrors,
        error_rate: totalCalls > 0 ? (totalErrors / totalCalls * 100).toFixed(1) + '%' : '0%',
        by_api_source: bySource,
        by_operation: byOperation,
        secondary_api_configured: !!(loadSecondaryApiConfig()),
        telemetry_enabled: isTelemetryEnabled(),
        timestamp: new Date().toISOString()
    };
}

function loadSecondaryApiConfig() {
    try {
        var raw = localStorage.getItem('ne_secondary_api');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

function uploadTelemetryToIssue(data) {
    var json = JSON.stringify(data, null, 2);
    var body = [
        '## NE Telemetry Report',
        '',
        'Auto-generated from NE Memory Engine v0.2.0.',
        'Review the data below before submitting.',
        '',
        '```json',
        json.substring(0, 30000),
        '```',
        '',
        '(Full data truncated to 30KB for issue body limit)'
    ].join('\n');

    var url = 'https://github.com/Melody-0321/NE-Memory/issues/new?' +
        'title=' + encodeURIComponent('[Telemetry] Report ' + new Date().toISOString().split('T')[0]) +
        '&body=' + encodeURIComponent(body);

    window.open(url, '_blank');
}
