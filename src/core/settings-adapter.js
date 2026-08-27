// settings-adapter.js — 全局配置「extensionSettings 权威」桥
//
// 定则：全局配置的唯一权威 = ST 原生 extensionSettings.ne_memory（即服务端 settings.json），
// cross-browser / cross-device 随 ST 用户设置文件走；localStorage 仅作缓存。
//
//  - neSync(key)：本地 → 服务器。只转发 config-key，提交式落地（saveSettingsDebounced）。
//  - neLoadAll()：启动时 服务器 → 本地。优先覆盖（localStorage 成为服务端值的缓存）。
//  - secret-key：保持 localStorage 私有，绝不写服务器（API 密钥等敏感凭据）。

// config-keys：进 extensionSettings（跨设备权威）
var CONFIG_KEYS = [
    'ne_settings',
    'ne_template_library', 'ne_field_library',
    'ne_power_slots_templates',
    'ne_params_auto', 'ne_version_config',
    'ne_chat_stats', 'ne_token_daily', 'ne_stm_telemetry', 'ne_anomalies'
];

var CONFIG_PREFIXES = ['ne_card_templates_', 'ne_local_fields_', 'ne_collapse_'];

// secret-keys：保持 localStorage 私有，绝不写服务器（API key / token 等）。
// 历史版本曾把它们纳入 SYNCED_KEYS 导致密钥一并镜像进 extensionSettings，这里剔除防隐私回归。
var SECRET_KEYS = [
    'ne_secondary_api', 'ne_embedding_api', 'ne_stm_api', 'ne_ltm_api', 'ne_state_api'
];

function _isConfigKey(key) {
    if (CONFIG_KEYS.indexOf(key) !== -1) return true;
    for (var i = 0; i < CONFIG_PREFIXES.length; i++) {
        if (key.indexOf(CONFIG_PREFIXES[i]) === 0) return true;
    }
    return false;
}

function _isSecretKey(key) {
    return SECRET_KEYS.indexOf(key) !== -1;
}

function _getExt() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.extensionSettings) {
                if (!ctx.extensionSettings.ne_memory) ctx.extensionSettings.ne_memory = {};
                return ctx.extensionSettings.ne_memory;
            }
        }
    } catch (e) {}
    return null;
}

function _getSaveFn() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && typeof ctx.saveSettingsDebounced === 'function') return ctx.saveSettingsDebounced;
        }
    } catch (e) {}
    return null;
}

/**
 * 本地 → 服务器（提交式）。
 * 仅转发 config-key；secret-key 与未知 key 一律忽略（不写 extNe、不落服务端）。
 * config-key 写入 extNe 后立即提交，使该值成为服务端权威。
 */
export function neSync(key) {
    if (!key || !_isConfigKey(key) || _isSecretKey(key)) return;
    try {
        var extNe = _getExt();
        if (!extNe) return;
        var raw = localStorage.getItem(key);
        if (raw == null) return;
        extNe[key] = raw;
        var saveFn = _getSaveFn();
        if (saveFn) saveFn();
    } catch (e) {}
}

/**
 * 服务器 → 本地（启动回灌）。
 * 从 extensionSettings.ne_memory 权威回灌 localStorage，优先覆盖（使 localStorage 成为服务端缓存）。
 * 仅回灌 config-key；不涉及 secret-key（它们本就不进 extNe）。
 */
export function neLoadAll() {
    try {
        var extNe = _getExt();
        if (!extNe) return;
        var keys = Object.keys(extNe);
        var i;
        for (i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (!k || typeof k !== 'string' || k.indexOf('ne_') !== 0) continue;
            if (!_isConfigKey(k) || _isSecretKey(k)) continue;
            try {
                if (extNe[k] != null) localStorage.setItem(k, extNe[k]);
            } catch (e) {}
        }
    } catch (e) {}
}