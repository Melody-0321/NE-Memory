import { t_config, t_narrative } from '../i18n.js';
import { saveSecondaryApiConfig, telemetryBuffer, recordTelemetry, isTelemetryEnabled } from '../api/llm.js';

export function renderConfigDialog(getChatId) {
    const html = `<div id="ne_config" style="display:none;position:fixed;top:5%;left:50%;transform:translateX(-50%);z-index:10000;background:var(--SmartThemeBlurTintColor);border:1px solid var(--grey5050a);border-radius:8px;padding:16px;max-width:500px;max-height:85vh;overflow-y:auto;box-shadow:0 4px 24px rgba(0,0,0,0.5);">
        <h3 style="margin-top:0;">Narrative Engine Settings</h3>
        <div class="narrative-toggle"><label class="checkbox_label"><input type="checkbox" id="ne_enable_telemetry"> <span>${t_config('narrative_label_enable_telemetry')}</span></label></div>
        <hr style="border-color:var(--black30a);margin:8px 0;">
        <h4>${t_config('副 API')}</h4>
        <div style="margin:4px 0;"><label style="font-size:0.85em;">${t_config('API URL')}</label><br><input id="ne_secondary_url" class="text_pole" style="width:100%;" placeholder="https://api.openai.com/v1/chat/completions"></div>
        <div style="margin:4px 0;"><label style="font-size:0.85em;">${t_config('API Key')}</label><br><input id="ne_secondary_key" class="text_pole" style="width:100%;" type="password" placeholder="sk-..."></div>
        <div style="margin:4px 0 8px;"><label style="font-size:0.85em;">${t_config('Model')}</label><br><input id="ne_secondary_model" class="text_pole" style="width:100%;" placeholder="gpt-4o-mini"></div>
        <hr style="border-color:var(--black30a);margin:8px 0;">
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button id="ne_config_save" class="menu_button">${t_narrative('Save')}</button>
            <button id="ne_config_close" class="menu_button" style="color:#888;">${t_narrative('Cancel')}</button>
            <button id="ne_export_telemetry" class="menu_button" style="margin-left:auto;">${t_narrative('Export Logs')} / Report</button>
        </div>
    </div>`;
    const existing = $('#ne_config');
    if (existing.length) existing.remove();
    $('body').append(html);
    loadConfigUI();
    $('#ne_config_save').on('click', saveConfigUI);
    $('#ne_config_close').on('click', () => $('#ne_config').hide());
    $('#ne_export_telemetry').on('click', () => {
        const data = collectTelemetryData(getChatId ? getChatId() : 'default');
        uploadTelemetryToIssue(data);
    });
    $('#ne_config').show();
}

function loadConfigUI() {
    try {
        const raw = localStorage.getItem('ne_settings');
        if (raw) {
            const s = JSON.parse(raw);
            $('#ne_enable_telemetry').prop('checked', s.enableTelemetry || false);
        }
    } catch (e) {}
    try {
        const raw = localStorage.getItem('ne_secondary_api');
        if (raw) {
            const api = JSON.parse(raw);
            $('#ne_secondary_url').val(api.url || '');
            $('#ne_secondary_key').val(api.key || '');
            $('#ne_secondary_model').val(api.model || '');
        }
    } catch (e) {}
}

function saveConfigUI() {
    const settings = { enableTelemetry: $('#ne_enable_telemetry').prop('checked') };
    localStorage.setItem('ne_settings', JSON.stringify(settings));
    saveSecondaryApiConfig({
        url: $('#ne_secondary_url').val().trim(),
        key: $('#ne_secondary_key').val().trim(),
        model: $('#ne_secondary_model').val().trim()
    });
    $('#ne_config').hide();
}

function collectTelemetryData(chatId) {
    const totalCalls = telemetryBuffer.length;
    let totalDurationMs = 0;
    const byOperation = {};
    const bySource = {};
    let totalTokens = 0;
    let totalErrors = 0;
    let p95LatencyMs = 0;

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
