/**
 * ui/config-dialog.js — 设置面板（ST 扩展设置 inline-drawer, 3 Tab）
 *
 * 通过 window.parent.document 操作主 ST 页面 DOM，#extensions_settings 挂载。
 */
import { t_config, t_narrative } from '../i18n.js';
import { saveSecondaryApiConfig, telemetryBuffer, recordTelemetry, isTelemetryEnabled } from '../api/llm.js';

function $pd(selector) { return $(selector, window.parent.document); }
var PD = window.parent.document;

var defaultMemoryConfig = {
    temperature: 0.2, stm_max_tokens: 800, stm_max_chars: 120,
    ltm_max_tokens: 500, ltm_max_chars: 100, opening_max_tokens: 300, opening_max_chars: 300,
    init_max_tokens: 600
};

export function renderConfigDialog(getChatId) {
    if ($pd('#ne_config_settings').length) return;

    var html = '<div id="ne_config_settings" class="inline-drawer">' +
        '<div class="inline-drawer-toggle inline-drawer-header">' +
        '<b>' + t_narrative('Narrative Engine') + '</b>' +
        '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>' +
        '</div>' +
        '<div class="inline-drawer-content" style="padding:10px;">' +
        '<div class="narrative-tab-bar" style="display:flex;width:100%;border-radius:6px;border:1px solid var(--grey5050a);padding:3px;margin-bottom:8px;">' +
        '<div class="ne-tab active" data-tab="basic" style="flex:1;text-align:center;cursor:pointer;padding:4px 0;border-radius:4px;font-size:0.85em;background:color-mix(in srgb,var(--SmartThemeQuoteColor) 80%,transparent);color:var(--SmartThemeBodyColor);">' + t_config('基本设置') + '</div>' +
        '<div class="ne-tab" data-tab="api" style="flex:1;text-align:center;cursor:pointer;padding:4px 0;border-radius:4px;font-size:0.85em;color:var(--grey50);">' + t_config('副 API') + '</div>' +
        '<div class="ne-tab" data-tab="memory" style="flex:1;text-align:center;cursor:pointer;padding:4px 0;border-radius:4px;font-size:0.85em;color:var(--grey50);">' + t_config('记忆处理') + '</div>' +
        '</div>' +
        '<div class="ne-tab-content" id="ne_tab_basic">' +
        '<div class="narrative-toggle"><label class="checkbox_label"><input type="checkbox" id="ne_enable_engine"> <span>' + t_config('Enable Narrative Engine') + '</span></label></div>' +
        '<div class="narrative-toggle ne-sub-toggle" id="ne_gm_section"><label class="checkbox_label"><input type="checkbox" id="ne_enable_gm"> <span>' + t_config('Enable GM Agent') + '</span></label></div>' +
        '<div class="narrative-toggle ne-sub-toggle" id="ne_memory_section"><label class="checkbox_label"><input type="checkbox" id="ne_enable_memory"> <span>' + t_config('Enable Memory System') + '</span></label></div>' +
        '<div id="ne_engine_status" style="margin-top:4px;font-size:0.85em;">' + t_narrative('Checking...') + '</div>' +
        '<hr style="border-color:var(--black30a);margin:8px 0;">' +
        '<div class="narrative-toggle"><label class="checkbox_label"><input type="checkbox" id="ne_enable_telemetry"> <span>' + t_config('narrative_label_enable_telemetry') + '</span></label></div>' +
        '</div>' +
        '<div class="ne-tab-content" id="ne_tab_api" style="display:none;">' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('API URL') + '</label><br><input id="ne_secondary_url" class="text_pole" style="width:100%;" placeholder="https://api.openai.com/v1/chat/completions"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('API Key') + '</label><br><input id="ne_secondary_key" class="text_pole" style="width:100%;" type="password" placeholder="sk-..."></div>' +
        '<div style="margin:4px 0 8px;"><label style="font-size:0.85em;">' + t_config('Model') + '</label><br><input id="ne_secondary_model" class="text_pole" style="width:100%;" placeholder="gpt-4o-mini"></div>' +
        '<div style="color:var(--grey50);font-size:0.8em;">' + t_config('Leave empty to use the same API as the main chat. Recommended: use a cheaper/faster model for memory extraction.') + '</div>' +
        '</div>' +
        '<div class="ne-tab-content" id="ne_tab_memory" style="display:none;">' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('Temperature') + '</label><br>' +
        '<input id="ne_memory_temperature" type="range" min="0" max="1" step="0.1" style="width:100%;"><span id="ne_memory_temperature_val" style="margin-left:6px;">0.2</span></div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin-bottom:6px;">' + t_config('低温度确保记忆摘要的一致性和准确性。0.1=极度保守，0.3=略有变化。') + '</div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('STM 单次输出上限') + '</label><br><input id="ne_stm_max_tokens" class="text_pole" type="number" style="width:100%;" min="100" max="4096"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('STM 单条事件上限') + '</label><br><input id="ne_stm_max_chars" class="text_pole" type="number" style="width:100%;" min="20" max="500"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('LTM 单次输出上限') + '</label><br><input id="ne_ltm_max_tokens" class="text_pole" type="number" style="width:100%;" min="100" max="4096"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('LTM 单条事件上限') + '</label><br><input id="ne_ltm_max_chars" class="text_pole" type="number" style="width:100%;" min="20" max="500"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('开场摘要输出上限') + '</label><br><input id="ne_opening_max_tokens" class="text_pole" type="number" style="width:100%;" min="100" max="4096"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('开场摘要截断上限') + '</label><br><input id="ne_opening_max_chars" class="text_pole" type="number" style="width:100%;" min="20" max="500"></div>' +
        '<div style="margin:4px 0 8px;"><label style="font-size:0.85em;">' + t_config('状态初始化输出上限') + '</label><br><input id="ne_init_max_tokens" class="text_pole" type="number" style="width:100%;" min="100" max="4096"></div>' +
        '<div style="color:var(--grey50);font-size:0.8em;">' + t_config('以上参数将应用于记忆区 LLM 调用，数值越大消耗越多 token。') + '</div>' +
        '</div>' +
        '<hr style="border-color:var(--black30a);margin:8px 0;">' +
        '<div style="display:flex;gap:6px;white-space:nowrap;justify-content:space-between;">' +
        '<button id="ne_config_save" class="menu_button" style="font-size:0.85em;padding:2px 8px;">' + t_narrative('Save') + '</button>' +
        '<button id="ne_export_telemetry" class="menu_button" style="font-size:0.85em;padding:2px 8px;">' + t_narrative('Export Logs') + '</button>' +
        '</div>' +
        '</div>' +
        '</div>';

    $pd('#extensions_settings').append(html);
    loadConfigUI();
    bindConfigEvents(getChatId);
}

function bindConfigEvents(getChatId) {
    $pd('#ne_config_save').on('click', saveConfigUI);
    $pd('#ne_export_telemetry').on('click', function () {
        var data = collectTelemetryData(getChatId ? getChatId() : 'default');
        uploadTelemetryToIssue(data);
    });
    $pd('#ne_memory_temperature').on('input', function () {
        $pd('#ne_memory_temperature_val').text(Number($pd('#ne_memory_temperature').val()).toFixed(1));
    });
    $pd('#ne_enable_engine').on('change', function () {
        var on = $pd('#ne_enable_engine').prop('checked');
        $pd('#ne_gm_section').toggleClass('enabled', on);
        $pd('#ne_memory_section').toggleClass('enabled', on);
    });
    // Tab switching
    $pd('.ne-tab').on('click', function () {
        var tab = $pd(this).data('tab');
        $pd('.ne-tab').removeClass('active').css({ background: 'transparent', color: 'var(--grey50)' });
        $pd(this).addClass('active').css({ background: 'color-mix(in srgb,var(--SmartThemeQuoteColor) 80%,transparent)', color: 'var(--SmartThemeBodyColor)' });
        $pd('.ne-tab-content').hide();
        $pd('#ne_tab_' + tab).show();
    });
}

function loadConfigUI() {
    try {
        var raw = localStorage.getItem('ne_settings');
        var s = raw ? JSON.parse(raw) : {};
        $pd('#ne_enable_engine').prop('checked', s.enabled || false);
        $pd('#ne_enable_gm').prop('checked', s.gmEnabled || false);
        $pd('#ne_enable_memory').prop('checked', s.memoryEnabled || false);
        $pd('#ne_enable_telemetry').prop('checked', s.enableTelemetry || false);
        var mc = s.memoryConfig || defaultMemoryConfig;
        $pd('#ne_memory_temperature').val(mc.temperature || defaultMemoryConfig.temperature);
        $pd('#ne_memory_temperature_val').text(Number(mc.temperature || defaultMemoryConfig.temperature).toFixed(1));
        $pd('#ne_stm_max_tokens').val(mc.stm_max_tokens || defaultMemoryConfig.stm_max_tokens);
        $pd('#ne_stm_max_chars').val(mc.stm_max_chars || defaultMemoryConfig.stm_max_chars);
        $pd('#ne_ltm_max_tokens').val(mc.ltm_max_tokens || defaultMemoryConfig.ltm_max_tokens);
        $pd('#ne_ltm_max_chars').val(mc.ltm_max_chars || defaultMemoryConfig.ltm_max_chars);
        $pd('#ne_opening_max_tokens').val(mc.opening_max_tokens || defaultMemoryConfig.opening_max_tokens);
        $pd('#ne_opening_max_chars').val(mc.opening_max_chars || defaultMemoryConfig.opening_max_chars);
        $pd('#ne_init_max_tokens').val(mc.init_max_tokens || defaultMemoryConfig.init_max_tokens);
        $pd('#ne_gm_section').toggleClass('enabled', s.enabled);
        $pd('#ne_memory_section').toggleClass('enabled', s.enabled);
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
    var settings = {
        enabled: $pd('#ne_enable_engine').prop('checked'),
        gmEnabled: $pd('#ne_enable_gm').prop('checked'),
        memoryEnabled: $pd('#ne_enable_memory').prop('checked'),
        enableTelemetry: $pd('#ne_enable_telemetry').prop('checked'),
        memoryConfig: {
            temperature: Number($pd('#ne_memory_temperature').val()),
            stm_max_tokens: Number($pd('#ne_stm_max_tokens').val()),
            stm_max_chars: Number($pd('#ne_stm_max_chars').val()),
            ltm_max_tokens: Number($pd('#ne_ltm_max_tokens').val()),
            ltm_max_chars: Number($pd('#ne_ltm_max_chars').val()),
            opening_max_tokens: Number($pd('#ne_opening_max_tokens').val()),
            opening_max_chars: Number($pd('#ne_opening_max_chars').val()),
            init_max_tokens: Number($pd('#ne_init_max_tokens').val())
        }
    };
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
