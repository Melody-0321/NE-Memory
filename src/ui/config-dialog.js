import { t_config, t_narrative } from '../i18n.js';
import { saveSecondaryApiConfig } from '../api/llm.js';

export function renderConfigDialog() {
    const html = `<div id="ne_config" style="display:none;position:fixed;top:5%;left:50%;transform:translateX(-50%);z-index:10000;background:var(--SmartThemeBlurTintColor);border:1px solid var(--grey5050a);border-radius:8px;padding:16px;max-width:500px;max-height:85vh;overflow-y:auto;box-shadow:0 4px 24px rgba(0,0,0,0.5);">
        <h3 style="margin-top:0;">Narrative Engine Settings</h3>
        <div class="narrative-toggle"><label class="checkbox_label"><input type="checkbox" id="ne_enable_telemetry"> <span>${t_config('narrative_label_enable_telemetry')}</span></label></div>
        <hr style="border-color:var(--black30a);margin:8px 0;">
        <h4>${t_config('副 API')}</h4>
        <div style="margin:4px 0;"><label style="font-size:0.85em;">${t_config('API URL')}</label><br><input id="ne_secondary_url" class="text_pole" style="width:100%;" placeholder="https://api.openai.com/v1/chat/completions"></div>
        <div style="margin:4px 0;"><label style="font-size:0.85em;">${t_config('API Key')}</label><br><input id="ne_secondary_key" class="text_pole" style="width:100%;" type="password" placeholder="sk-..."></div>
        <div style="margin:4px 0 8px;"><label style="font-size:0.85em;">${t_config('Model')}</label><br><input id="ne_secondary_model" class="text_pole" style="width:100%;" placeholder="gpt-4o-mini"></div>
        <div style="display:flex;gap:4px;"><button id="ne_config_save" class="menu_button">${t_narrative('Save')}</button><button id="ne_config_close" class="menu_button" style="color:#888;">${t_narrative('Cancel')}</button></div>
    </div>`;
    const existing = $('#ne_config');
    if (existing.length) existing.remove();
    $('body').append(html);
    loadConfigUI();
    $('#ne_config_save').on('click', saveConfigUI);
    $('#ne_config_close').on('click', () => $('#ne_config').hide());
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

export function isTelemetryEnabled() {
    try {
        const raw = localStorage.getItem('ne_settings');
        if (raw) return JSON.parse(raw).enableTelemetry || false;
    } catch (e) {}
    return false;
}
