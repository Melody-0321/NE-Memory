var SYNCED_KEYS = [
    'ne_settings',
    'ne_secondary_api', 'ne_embedding_api', 'ne_stm_api', 'ne_ltm_api', 'ne_state_api',
    'ne_template_library', 'ne_field_library',
    'ne_power_slots_templates',
    'ne_use_legacy_schema',
    'ne_params_auto', 'ne_version_config',
    'ne_chat_stats', 'ne_token_daily', 'ne_stm_telemetry', 'ne_anomalies'
];

var SYNCED_PREFIXES = ['ne_card_templates_', 'ne_local_fields_', 'ne_collapse_'];

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

export function neSync(key) {
    if (!key) return;
    try {
        var extNe = _getExt();
        if (!extNe) return;
        var raw = localStorage.getItem(key);
        if (raw != null) extNe[key] = raw;
    } catch (e) {}
}

export function neSyncAll() {
    try {
        var extNe = _getExt();
        if (!extNe) return;
        var i;
        for (i = 0; i < SYNCED_KEYS.length; i++) {
            var k = SYNCED_KEYS[i];
            try {
                var raw = localStorage.getItem(k);
                if (raw != null) extNe[k] = raw;
            } catch (e) {}
        }
        try {
            var allKeys = Object.keys(localStorage);
            for (i = 0; i < allKeys.length; i++) {
                var lk = allKeys[i];
                for (var j = 0; j < SYNCED_PREFIXES.length; j++) {
                    if (lk.indexOf(SYNCED_PREFIXES[j]) === 0) {
                        try { extNe[lk] = localStorage.getItem(lk); } catch (e) {}
                        break;
                    }
                }
            }
        } catch (e) {}
        var saveFn = _getSaveFn();
        if (saveFn) saveFn();
    } catch (e) {}
}

export function neRestoreAll() {
    try {
        var extNe = _getExt();
        if (!extNe) return;
        var keys = Object.keys(extNe);
        var i;
        for (i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (!k || typeof k !== 'string' || k.indexOf('ne_') !== 0) continue;
            try {
                var existing = localStorage.getItem(k);
                if (!existing || existing === 'null' || existing === 'undefined') {
                    localStorage.setItem(k, extNe[k]);
                }
            } catch (e) {}
        }
    } catch (e) {}
}
