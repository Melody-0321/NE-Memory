/**
 * ui/config-dialog.js — 设置面板（ST 扩展设置 inline-drawer, 3 Tab）
 *
 * UI 挂载到 ST 主页面 DOM 的 #extensions_settings 抽屉中。
 */
import { t_config, t_narrative } from '../i18n.js';
import { saveSecondaryApiConfig, telemetryBuffer, recordTelemetry, isTelemetryEnabled, testSecondaryApiConnection, sendSecondaryTestMessage } from '../api/llm.js';
import { DEFAULT_GLOBAL_SCHEMA, DEFAULT_CHARACTER_SCHEMA, POWER_SLOTS_TEMPLATES, setDynamicStateMode } from '../vault/schema.js';
import { escapeHtml } from './utils.js';
import { setRetrievalEnabled } from '../settings.js';

function $pd(selector) { return $(selector); }

var defaultMemoryConfig = {
    extraction_temperature: 0.2, retrieval_temperature: 0.3,
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
        '<div class="ne-tab" data-tab="schema" style="flex:1;text-align:center;cursor:pointer;padding:4px 0;border-radius:4px;font-size:0.85em;color:var(--grey50);">' + t_config('状态 Schema') + '</div>' +
        '</div>' +
        '<div class="ne-tab-content" id="ne_tab_basic">' +
        '<div class="narrative-toggle" id="ne_schema_section"><label class="checkbox_label"><input type="checkbox" id="ne_enable_state_schema"> <span>' + t_config('Enable State Schema') + '</span></label>' +
        '<div class="narrative-toggle" id="ne_dynamic_section" style="margin-left:3em;display:none;"><label class="checkbox_label"><input type="checkbox" id="ne_enable_dynamic_state" disabled> <span>' + t_config('Use Dynamic Field Discovery') + '</span></label>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin-left:1em;">' + t_config('Automatically discover state fields from character cards and world books. Disable to use preset schema fields.') + '</div></div></div>' +
        '<div class="narrative-toggle" id="ne_retrieval_section"><label class="checkbox_label"><input type="checkbox" id="ne_enable_retrieval"> <span>' + t_config('Enable Smart Retrieval') + '</span></label>' +
        '<div style="margin-left:1em;margin-top:4px;"><span>' + t_config('Memory Budget') + ': <span id="ne_memory_budget_val">800</span> tok</span>' +
        '<input type="range" id="ne_memory_budget" min="500" max="2000" step="100" value="800" style="width:100%;margin-top:2px;"></div></div>' +
        '<div style="margin:6px 0 2px;"><span>' + t_config('STM Extraction Batch') + ': <span id="ne_stm_batch_val">10</span></span>' +
        '<input type="range" id="ne_stm_batch" min="1" max="30" step="1" value="10" style="width:100%;margin-top:2px;"></div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin-bottom:6px;">' + t_config('Memory extraction uses LLM to detect natural scene boundaries, not fixed message counts. This is only a hard cap — unprocessed messages beyond this force extraction. A low value makes it behave like a fixed threshold.') + '</div>' +
        '<div style="margin:6px 0 2px;"><span>' + t_config('Max Unconsolidated STM') + ': <span id="ne_stm_max_unconsolidated_val">5</span></span>' +
        '<input type="range" id="ne_stm_max_unconsolidated" min="2" max="30" step="1" value="5" style="width:100%;margin-top:2px;"></div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin-bottom:6px;">' + t_config('Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.') + '</div>' +
        '<div style="margin:8px 0 4px;"><span>' + t_config('Segmentation Turns Range') + '</span></div>' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">' +
        '<label style="font-size:0.85em;">' + t_config('Min:') + '</label>' +
        '<input id="ne_seg_min_turns" class="text_pole" type="number" min="1" max="100" value="2" style="width:60px;">' +
        '<label style="font-size:0.85em;margin-left:6px;">' + t_config('Max:') + '</label>' +
        '<input id="ne_seg_max_turns" class="text_pole" type="number" min="1" max="100" value="6" style="width:60px;">' +
        '</div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin-bottom:6px;">' + t_config('Per-event turn range for STM extraction. When min equals max, semantic segmentation is skipped and turns are split by fixed count.') + '</div>' +
        '<div id="ne_engine_status" style="margin-top:4px;font-size:0.85em;">' + t_narrative('Checking...') + '</div>' +
        '<hr style="border-color:var(--black30a);margin:8px 0;">' +
        '<div class="narrative-toggle"><label class="checkbox_label"><input type="checkbox" id="ne_enable_telemetry"> <span>' + t_config('narrative_label_enable_telemetry') + '</span></label></div>' +
        '</div>' +
        '<div class="ne-tab-content" id="ne_tab_api" style="display:none;">' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('API URL') + '</label><br><input id="ne_secondary_url" class="text_pole" style="width:100%;" placeholder="https://api.deepseek.com/v1/chat/completions"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('API Key (leave empty for local proxy)') + '</label><br><input id="ne_secondary_key" class="text_pole" style="width:100%;" type="password" placeholder="sk-..."></div>' +
        '<div style="margin:4px 0 8px;"><label style="font-size:0.85em;">' + t_config('Model') + '</label><br><input id="ne_secondary_model" class="text_pole" style="width:100%;" placeholder="deepseek-v4-flash"></div>' +
        '<div style="margin:4px 0;"><button class="ne-api-btn" id="ne_api_connect" style="margin-right:6px;">' + t_config('Connect') + '</button><button class="ne-api-btn" id="ne_api_test">' + t_config('Test Message') + '</button></div>' +
        '<div class="ne-api-status" style="display:flex;align-items:center;gap:6px;margin:4px 0;font-size:0.85em;"><span class="ne-api-dot" id="ne_api_dot" style="width:10px;height:10px;border-radius:50%;display:inline-block;background:#cc3333;"></span><span id="ne_api_status_text">' + t_config('Not connected') + '</span></div>' +
        '<div style="color:var(--grey50);font-size:0.8em;">' + t_config('URL must point to /v1/chat/completions endpoint. ST local proxy users: http://127.0.0.1:8000/llm/chat. Key can be empty for local proxy.') + '</div>' +
        '</div>' +
        '<div class="ne-tab-content" id="ne_tab_memory" style="display:none;">' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('Extraction Temperature') + ' <span style="color:var(--grey50);font-size:0.85em;">(推荐0.2)</span></label><br>' +
        '<input id="ne_extraction_temperature" type="range" min="0" max="1" step="0.1" style="width:100%;"><span id="ne_extraction_temperature_val" style="margin-left:6px;">0.2</span></div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin-bottom:6px;">' + t_config('STM/State/LTM memory extraction. Lower = more consistent summaries.') + '</div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('Retrieval Temperature') + ' <span style="color:var(--grey50);font-size:0.85em;">(推荐0.3)</span></label><br>' +
        '<input id="ne_retrieval_temperature" type="range" min="0" max="1" step="0.1" style="width:100%;"><span id="ne_retrieval_temperature_val" style="margin-left:6px;">0.3</span></div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin-bottom:6px;">' + t_config('Smart retrieval and tool queries. Higher = more creative answers.') + '</div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('STM 单次输出上限') + '</label><br><input id="ne_stm_max_tokens" class="text_pole" type="number" style="width:100%;" min="100" max="4096"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('STM 单条事件上限') + '</label><br><input id="ne_stm_max_chars" class="text_pole" type="number" style="width:100%;" min="20" max="500"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('LTM 单次输出上限') + '</label><br><input id="ne_ltm_max_tokens" class="text_pole" type="number" style="width:100%;" min="100" max="4096"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('LTM 单条事件上限') + '</label><br><input id="ne_ltm_max_chars" class="text_pole" type="number" style="width:100%;" min="20" max="500"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('开场摘要输出上限') + '</label><br><input id="ne_opening_max_tokens" class="text_pole" type="number" style="width:100%;" min="100" max="4096"></div>' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('开场摘要截断上限') + '</label><br><input id="ne_opening_max_chars" class="text_pole" type="number" style="width:100%;" min="20" max="500"></div>' +
        '<div style="margin:4px 0 8px;"><label style="font-size:0.85em;">' + t_config('状态初始化输出上限') + '</label><br><input id="ne_init_max_tokens" class="text_pole" type="number" style="width:100%;" min="100" max="4096"></div>' +
        '<div style="color:var(--grey50);font-size:0.8em;">' + t_config('以上参数将应用于记忆区 LLM 调用，数值越大消耗越多 token。') + '</div>' +
        '</div>' +
        '<div class="ne-tab-content" id="ne_tab_schema" style="display:none;">' +
        '<div id="ne_schema_sub_sections">' +
        '<div style="margin:4px 0;"><label style="font-size:0.85em;">' + t_config('状态 Schema') + ' (Global)</label><br>' +
        '<textarea id="ne_state_schema" style="width:100%;box-sizing:border-box;font-size:0.8em;resize:vertical;min-height:180px;font-family:monospace;"></textarea></div>' +
        '<div style="color:var(--grey50);font-size:0.8em;">' + t_config('Valid JSON defining state field types and constraints. Leave empty to disable schema validation.') + '</div>' +
        '<div style="margin:10px 0 4px;"><label style="font-size:0.85em;">' + t_config('Character Schema') + ' (Character Cards)</label><br>' +
        '<textarea id="ne_character_schema" style="width:100%;box-sizing:border-box;font-size:0.8em;resize:vertical;min-height:180px;font-family:monospace;"></textarea></div>' +
        '<div style="color:var(--grey50);font-size:0.8em;">' + t_config('Valid JSON defining character card field definitions. Has protagonist and npc blocks. Leave empty to use default.') + '</div>' +
        '<hr style="border-color:var(--black30a);margin:8px 0;">' +
        '<div style="font-weight:bold;font-size:0.9em;margin:6px 0 3px;cursor:pointer;color:var(--grey70);" id="ne_power_slots_toggle">\u25B6 ' + t_config('Power Slots Templates') + '</div>' +
        '<div id="ne_power_slots_section" style="display:none;">' +
        '<div style="color:var(--grey50);font-size:0.8em;margin-bottom:6px;">' + t_config('Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.') + '</div>' +
        '<div id="ne_power_slots_entries"></div>' +
        '<button id="ne_power_slots_add" class="menu_button" style="font-size:0.8em;padding:2px 8px;margin-top:6px;">' + t_config('Add Slot') + '</button>' +
        '<button id="ne_power_slots_reset" class="menu_button" style="font-size:0.8em;padding:2px 8px;margin-top:6px;color:#f44336;">' + t_config('Reset to Defaults') + '</button>' +
        '</div>' +
        '</div>' +
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
    $pd('#ne_extraction_temperature').on('input', function () {
        $pd('#ne_extraction_temperature_val').text(Number($pd('#ne_extraction_temperature').val()).toFixed(1));
    });
    $pd('#ne_retrieval_temperature').on('input', function () {
        $pd('#ne_retrieval_temperature_val').text(Number($pd('#ne_retrieval_temperature').val()).toFixed(1));
    });
    $pd('#ne_memory_budget').on('input', function () {
        $pd('#ne_memory_budget_val').text($pd('#ne_memory_budget').val());
    });
    $pd('#ne_stm_batch').on('input', function () {
        $pd('#ne_stm_batch_val').text($pd('#ne_stm_batch').val());
    });
    $pd('#ne_stm_max_unconsolidated').on('input', function () {
        $pd('#ne_stm_max_unconsolidated_val').text($pd('#ne_stm_max_unconsolidated').val());
    });
    $pd('#ne_seg_min_turns').on('change', function () {
        var minVal = Number($pd('#ne_seg_min_turns').val()) || 1;
        var maxVal = Number($pd('#ne_seg_max_turns').val()) || 1;
        if (minVal > maxVal) { $pd('#ne_seg_min_turns').val(maxVal); }
    });
    $pd('#ne_seg_max_turns').on('change', function () {
        var minVal = Number($pd('#ne_seg_min_turns').val()) || 1;
        var maxVal = Number($pd('#ne_seg_max_turns').val()) || 1;
        if (maxVal < minVal) { $pd('#ne_seg_max_turns').val(minVal); }
    });
    // Tab switching
    $pd('.ne-tab').on('click', function () {
        var tab = $pd(this).data('tab');
        $pd('.ne-tab').removeClass('active').css({ background: 'transparent', color: 'var(--grey50)' });
        $pd(this).addClass('active').css({ background: 'color-mix(in srgb,var(--SmartThemeQuoteColor) 80%,transparent)', color: 'var(--SmartThemeBodyColor)' });
        $pd('.ne-tab-content').hide();
        $pd('#ne_tab_' + tab).show();
    });
    $pd('#ne_power_slots_toggle').on('click', function () {
        var section = $pd('#ne_power_slots_section');
        var vis = section.is(':visible');
        section.toggle(!vis);
        $pd('#ne_power_slots_toggle').html((vis ? '\u25B6 ' : '\u25BC ') + t_config('Power Slots Templates'));
        if (!vis) renderPowerSlotsEditor();
    });
    $pd('#ne_power_slots_add').on('click', addPowerSlot);
    $pd('#ne_power_slots_reset').on('click', resetPowerSlotsTemplates);
    $pd('#ne_enable_state_schema').on('change', function () {
        var on = $pd('#ne_enable_state_schema').prop('checked');
        $pd('#ne_schema_sub_sections').toggle(on);
        $pd('#ne_dynamic_section').toggle(on);
    });
    $pd('#ne_api_connect').on('click', function () {
        var cfg = { url: $pd('#ne_secondary_url').val().trim(), key: $pd('#ne_secondary_key').val().trim(), model: $pd('#ne_secondary_model').val().trim() };
        saveSecondaryApiConfig(cfg);
        $pd('#ne_api_dot').css('background', '#cc3333');
        $pd('#ne_api_status_text').text('Connecting...');
        $pd('#ne_api_connect').prop('disabled', true);
        testSecondaryApiConnection(cfg).then(function (r) {
            $pd('#ne_api_dot').css('background', r.success ? '#4caf50' : '#cc3333');
            $pd('#ne_api_status_text').text(r.success ? ('Connected: ' + cfg.model) : ('Not connected — ' + (r.error || '')));
            $pd('#ne_api_connect').prop('disabled', false);
        });
    });
    $pd('#ne_api_test').on('click', function () {
        var cfg = { url: $pd('#ne_secondary_url').val().trim(), key: $pd('#ne_secondary_key').val().trim(), model: $pd('#ne_secondary_model').val().trim() };
        if (!cfg.url) { alert('Please enter an API URL first.'); return; }
        $pd('#ne_api_test').prop('disabled', true);
        sendSecondaryTestMessage(cfg).then(function () {
            typeof toastr !== 'undefined' && toastr.success(t_config('API connection successful!'));
            $pd('#ne_api_test').prop('disabled', false);
        }).catch(function (e) {
            typeof toastr !== 'undefined' && toastr.error(t_config('API connection failed. Check browser console (F12) for details.'));
            $pd('#ne_api_test').prop('disabled', false);
        });
    });
}

function loadPowerSlotsTemplates() {
    try {
        var raw = localStorage.getItem('ne_power_slots_templates');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return JSON.parse(JSON.stringify(POWER_SLOTS_TEMPLATES));
}

function savePowerSlotsTemplates(templates) {
    localStorage.setItem('ne_power_slots_templates', JSON.stringify(templates));
}

function renderPowerSlotsEditor() {
    var templates = loadPowerSlotsTemplates();
    var container = $pd('#ne_power_slots_entries');
    if (!container.length) return;
    var html = '';
    var tkeys = Object.keys(templates);
    tkeys.forEach(function (tkey, ti) {
        var t = templates[tkey];
        html += '<div class="ne_ps_template" style="margin:6px 0;padding:6px;background:var(--black30a);border-radius:4px;">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
            '<input class="ne_ps_tname" data-tkey="' + tkey + '" value="' + escapeHtml(tkey) + '" style="width:100px;font-size:0.85em;" placeholder="Template key">' +
            '<span style="font-size:0.8em;color:var(--grey50);">' + escapeHtml(t.label_zh || '') + ' / ' + escapeHtml(t.label_en || '') + '</span>' +
            '<span class="ne_ps_del_tpl" data-tkey="' + tkey + '" style="cursor:pointer;color:#f44336;font-size:0.85em;margin-left:auto;" title="' + t_config('Delete') + '">&#10005;</span>' +
            '</div>';
        var slotKeys = Object.keys(t.slots || {});
        slotKeys.forEach(function (skey) {
            var s = t.slots[skey];
            html += '<div class="ne_ps_slot" data-tkey="' + tkey + '" data-skey="' + skey + '" style="display:flex;align-items:center;gap:4px;margin:3px 0 3px 12px;">' +
                '<input class="ne_ps_skey" value="' + escapeHtml(s.key) + '" style="width:80px;font-size:0.8em;" placeholder="key">' +
                '<input class="ne_ps_slabel" value="' + escapeHtml(s.label) + '" style="width:80px;font-size:0.8em;" placeholder="label">' +
                '<input class="ne_ps_sdesc" value="' + escapeHtml(s.description || '') + '" style="flex:1;font-size:0.8em;" placeholder="description">' +
                '<span class="ne_ps_del_slot" data-tkey="' + tkey + '" data-skey="' + skey + '" style="cursor:pointer;color:#f44336;font-size:0.8em;">&#10005;</span>' +
                '</div>';
        });
        html += '<button class="ne_ps_add_slot menu_button" data-tkey="' + tkey + '" style="font-size:0.75em;padding:1px 6px;margin-left:12px;">+ slot</button>';
        html += '</div>';
    });
    container.html(html);

    $pd('.ne_ps_del_slot').off('click').on('click', function () {
        var templates = loadPowerSlotsTemplates();
        var tkey = $pd(this).data('tkey');
        var skey = $pd(this).data('skey');
        if (templates[tkey] && templates[tkey].slots && templates[tkey].slots[skey]) {
            delete templates[tkey].slots[skey];
            savePowerSlotsTemplates(templates);
            renderPowerSlotsEditor();
        }
    });

    $pd('.ne_ps_add_slot').off('click').on('click', function () {
        var templates = loadPowerSlotsTemplates();
        var tkey = $pd(this).data('tkey');
        if (!templates[tkey]) return;
        if (!templates[tkey].slots) templates[tkey].slots = {};
        var newKey = 'slot_' + Object.keys(templates[tkey].slots).length;
        templates[tkey].slots[newKey] = { key: newKey, label: '', description: '' };
        savePowerSlotsTemplates(templates);
        renderPowerSlotsEditor();
    });

    $pd('.ne_ps_del_tpl').off('click').on('click', function () {
        var templates = loadPowerSlotsTemplates();
        var tkey = $pd(this).data('tkey');
        if (templates[tkey]) {
            delete templates[tkey];
            savePowerSlotsTemplates(templates);
            renderPowerSlotsEditor();
        }
    });
}

function addPowerSlot() {
    var templates = loadPowerSlotsTemplates();
    var newKey = 'custom_' + Object.keys(templates).length;
    templates[newKey] = {
        name: newKey,
        label_en: 'Custom',
        label_zh: '自定义',
        slots: {
            vitality: { key: 'vitality', label: '', description: '' },
            energy: { key: 'energy', label: '', description: '' },
            realm: { key: 'realm', label: '', description: '' }
        }
    };
    savePowerSlotsTemplates(templates);
    renderPowerSlotsEditor();
}

function resetPowerSlotsTemplates() {
    var defaults = JSON.parse(JSON.stringify(POWER_SLOTS_TEMPLATES));
    savePowerSlotsTemplates(defaults);
    renderPowerSlotsEditor();
}

function savePowerSlotsFromEditor() {
    var templates = loadPowerSlotsTemplates();
    var entries = $pd('#ne_power_slots_entries');
    if (!entries.length) return;

    var newTemplates = {};
    entries.find('.ne_ps_template').each(function () {
        var tkey = $pd(this).find('.ne_ps_tname').val().trim() || $pd(this).find('.ne_ps_tname').data('tkey');
        var tpl = templates[$pd(this).find('.ne_ps_tname').data('tkey')] || {};
        var slots = {};
        $pd(this).find('.ne_ps_slot').each(function () {
            var skey = $pd(this).find('.ne_ps_skey').val().trim();
            var slabel = $pd(this).find('.ne_ps_slabel').val().trim();
            var sdesc = $pd(this).find('.ne_ps_sdesc').val().trim();
            if (skey) {
                slots[skey] = { key: skey, label: slabel, description: sdesc };
            }
        });
        newTemplates[tkey] = {
            name: tkey,
            label_en: tpl.label_en || tkey,
            label_zh: tpl.label_zh || tkey,
            slots: slots
        };
    });
    savePowerSlotsTemplates(newTemplates);
}

function loadConfigUI() {
    try {
        var raw = localStorage.getItem('ne_settings');
        var s = raw ? JSON.parse(raw) : {};
        $pd('#ne_enable_telemetry').prop('checked', s.enableTelemetry || false);
        var ssEnabled = s.enableStateSchema || false;
        $pd('#ne_enable_state_schema').prop('checked', ssEnabled);
        $pd('#ne_schema_sub_sections').toggle(ssEnabled);
        $pd('#ne_enable_dynamic_state').prop('checked', false);
        $pd('#ne_dynamic_section').toggle(ssEnabled);
        var retrievalEnabled = s.retrievalEnabled || false;
        $pd('#ne_enable_retrieval').prop('checked', retrievalEnabled);
        setRetrievalEnabled(retrievalEnabled);
        $pd('#ne_memory_budget').val(s.memoryBudget || 800);
        $pd('#ne_memory_budget_val').text(s.memoryBudget || 800);
        $pd('#ne_stm_batch').val(s.stmBatch || 10);
        $pd('#ne_stm_batch_val').text(s.stmBatch || 10);
        $pd('#ne_stm_max_unconsolidated').val(s.stmMaxUnconsolidated || 5);
        $pd('#ne_stm_max_unconsolidated_val').text(s.stmMaxUnconsolidated || 5);
        $pd('#ne_seg_min_turns').val(s.segMinTurns || 2);
        $pd('#ne_seg_max_turns').val(s.segMaxTurns || 6);
        var mc = s.memoryConfig || defaultMemoryConfig;
        $pd('#ne_extraction_temperature').val(mc.extraction_temperature || mc.temperature || defaultMemoryConfig.extraction_temperature);
        $pd('#ne_extraction_temperature_val').text(Number(mc.extraction_temperature || mc.temperature || defaultMemoryConfig.extraction_temperature).toFixed(1));
        $pd('#ne_retrieval_temperature').val(mc.retrieval_temperature || mc.temperature || defaultMemoryConfig.retrieval_temperature);
        $pd('#ne_retrieval_temperature_val').text(Number(mc.retrieval_temperature || mc.temperature || defaultMemoryConfig.retrieval_temperature).toFixed(1));
        $pd('#ne_stm_max_tokens').val(mc.stm_max_tokens || defaultMemoryConfig.stm_max_tokens);
        $pd('#ne_stm_max_chars').val(mc.stm_max_chars || defaultMemoryConfig.stm_max_chars);
        $pd('#ne_ltm_max_tokens').val(mc.ltm_max_tokens || defaultMemoryConfig.ltm_max_tokens);
        $pd('#ne_ltm_max_chars').val(mc.ltm_max_chars || defaultMemoryConfig.ltm_max_chars);
        $pd('#ne_opening_max_tokens').val(mc.opening_max_tokens || defaultMemoryConfig.opening_max_tokens);
        $pd('#ne_opening_max_chars').val(mc.opening_max_chars || defaultMemoryConfig.opening_max_chars);
        $pd('#ne_init_max_tokens').val(mc.init_max_tokens || defaultMemoryConfig.init_max_tokens);
        if (s.stateSchema) {
            $pd('#ne_state_schema').val(JSON.stringify(s.stateSchema, null, 2));
        } else {
            $pd('#ne_state_schema').val(JSON.stringify(DEFAULT_GLOBAL_SCHEMA, null, 2));
        }
        if (s.characterSchema) {
            $pd('#ne_character_schema').val(JSON.stringify(s.characterSchema, null, 2));
        } else {
            $pd('#ne_character_schema').val(JSON.stringify(DEFAULT_CHARACTER_SCHEMA, null, 2));
        }
    } catch (e) { console.warn('[NE] loadConfigUI settings failed:', e); }
    try {
        var raw = localStorage.getItem('ne_secondary_api');
        if (raw) {
            var api = JSON.parse(raw);
            $pd('#ne_secondary_url').val(api.url || '');
            $pd('#ne_secondary_key').val(api.key || '');
            $pd('#ne_secondary_model').val(api.model || '');
        }
    } catch (e) { console.warn('[NE] loadConfigUI secondary API failed:', e); }
}

function saveConfigUI() {
    var settings = {
        enableTelemetry: $pd('#ne_enable_telemetry').prop('checked'),
        enableStateSchema: $pd('#ne_enable_state_schema').prop('checked'),
        useDynamicState: false,
        retrievalEnabled: $pd('#ne_enable_retrieval').prop('checked'),
        memoryBudget: Number($pd('#ne_memory_budget').val()),
        stmBatch: Number($pd('#ne_stm_batch').val()),
        stmMaxUnconsolidated: Number($pd('#ne_stm_max_unconsolidated').val()),
        segMinTurns: Number($pd('#ne_seg_min_turns').val()) || 2,
        segMaxTurns: Number($pd('#ne_seg_max_turns').val()) || 6,
        memoryConfig: {
            extraction_temperature: Number($pd('#ne_extraction_temperature').val()),
            retrieval_temperature: Number($pd('#ne_retrieval_temperature').val()),
            temperature: Number($pd('#ne_extraction_temperature').val()),
            stm_max_tokens: Number($pd('#ne_stm_max_tokens').val()),
            stm_max_chars: Number($pd('#ne_stm_max_chars').val()),
            ltm_max_tokens: Number($pd('#ne_ltm_max_tokens').val()),
            ltm_max_chars: Number($pd('#ne_ltm_max_chars').val()),
            opening_max_tokens: Number($pd('#ne_opening_max_tokens').val()),
            opening_max_chars: Number($pd('#ne_opening_max_chars').val()),
            init_max_tokens: Number($pd('#ne_init_max_tokens').val())
        }
    };
    var schemaText = $pd('#ne_state_schema').val().trim();
    if (schemaText) {
        try {
            var parsed = JSON.parse(schemaText);
            if (typeof parsed === 'object' && parsed !== null) {
                settings.stateSchema = parsed;
            }
        } catch (e) {
            console.warn('[NE] Schema JSON invalid, not saving:', e.message);
        }
    }
    var charSchemaText = $pd('#ne_character_schema').val().trim();
    if (charSchemaText) {
        try {
            var charParsed = JSON.parse(charSchemaText);
            if (typeof charParsed === 'object' && charParsed !== null) {
                settings.characterSchema = charParsed;
            }
        } catch (e) {
            console.warn('[NE] Character Schema JSON invalid, not saving:', e.message);
        }
    }
    localStorage.setItem('ne_settings', JSON.stringify(settings));
    setDynamicStateMode(settings.useDynamicState || false);
    savePowerSlotsFromEditor();
    saveSecondaryApiConfig({
        url: $pd('#ne_secondary_url').val().trim(),
        key: $pd('#ne_secondary_key').val().trim(),
        model: $pd('#ne_secondary_model').val().trim()
    });
    try { if (typeof toastr !== 'undefined') toastr.success(t_narrative('Settings saved.')); } catch (e) {}
    console.log('[NE] Settings saved');
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
        version: '1.0.0',
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
