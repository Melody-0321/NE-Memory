import { runtime } from '../core/runtime.js';
import { read, write } from '../core/vault/store.js';
import { loadVault, persistVaultToChatFile } from '../core/auto-restore.js';
import { t, setFieldLocale } from '../core/i18n.js';
import { renderVaultPanel } from './panel.js';
import { DEFAULT_GLOBAL_SCHEMA, DEFAULT_CHARACTER_SCHEMA, setStateSchemaEnabled, setDynamicStateMode } from '../core/vault/schema.js';
import { setRetrievalEnabled } from '../core/settings.js';
import { testSecondaryApiConnection } from '../core/api/llm.js';
import { restorePending } from './events.js';

function loadSettings() {
    try {
        var raw = localStorage.getItem('ne_settings');
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function autoConnectSecondaryApi() {
    try {
        var raw = localStorage.getItem('ne_secondary_api');
        if (!raw) return;
        var cfg = JSON.parse(raw);
        if (!cfg.url || !cfg.model) return;
        testSecondaryApiConnection(cfg).then(function (r) {
            if (r.success) console.log('[NE] Auto-connected to secondary API:', cfg.model);
        });
    } catch (e) { console.warn('[NE] Auto-connect skipped:', e.message); }
}

export async function migrateVaultIfNeeded(chatId, currentVault) {
    if (chatId === 'default' || !chatId.startsWith('ne_')) return currentVault;
    if (currentVault && currentVault.version !== 0) return currentVault;
    try {
        var defaultVault = await read('default');
        if (!defaultVault || defaultVault.version === 0) return currentVault;
        var content = defaultVault.content || {};
        var hasData = (content.stm_entries && content.stm_entries.length > 0) ||
            (content.ltm_entries && content.ltm_entries.length > 0) ||
            (content.unconsolidated_stm && content.unconsolidated_stm.length > 0);
        if (!hasData) return currentVault;
        console.log('[NE] Migrating vault from "default" to fingerprint: ' + chatId);
        defaultVault.chat_id = chatId;
        await write(chatId, defaultVault);
        persistVaultToChatFile(defaultVault);
        await write('default', { chat_id: 'default', version: -1, content: {} });
        console.log('[NE] Vault migration complete');
        return defaultVault;
    } catch (e) {
        console.warn('[NE] Vault migration failed:', e.message);
        return currentVault;
    }
}

export async function bootstrapVault(chatId, locale, settings) {
    t(locale);
    setFieldLocale(locale);

    setStateSchemaEnabled(settings && settings.enableStateSchema || false);
    setDynamicStateMode(settings && settings.useDynamicState || false);
    setRetrievalEnabled(settings && settings.retrievalEnabled || false);

    console.log('[NE] Engine initializing — chatId=' + chatId);
    var vault = await loadVault(chatId);
    vault = await migrateVaultIfNeeded(chatId, vault);
    if (vault.version === 0 && !vault.content.language) {
        vault.content.language = locale.includes('zh') ? 'zh' : 'en';
        vault.content.state_schema = (settings && settings.stateSchema) || DEFAULT_GLOBAL_SCHEMA;
        vault.content.character_schema = (settings && settings.characterSchema) || DEFAULT_CHARACTER_SCHEMA;
        await write(chatId, vault);
        persistVaultToChatFile(vault);
    }

    restorePending();
    await renderVaultPanel(function() { return runtime.getChatId() || chatId; });

    // ── L2: Global keyboard navigation for card toggle headers ──
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var target = null;
        var path = e.composedPath && e.composedPath();
        if (path) {
            for (var i = 0; i < path.length; i++) {
                if (path[i] && path[i].closest) {
                    target = path[i].closest('.ne-char-card-header, .ne-faction-card-header, .ne-quest-header, .ne-accordion-header');
                    if (target) break;
                }
            }
        } else {
            target = e.target.closest('.ne-char-card-header, .ne-faction-card-header, .ne-quest-header, .ne-accordion-header');
        }
        if (!target) return;
        if (target.closest('input, textarea, select, button')) return;
        e.preventDefault();
        target.click();
    });

    autoConnectSecondaryApi();

    console.log('[NE] Engine initialized — chatId=' + chatId + ', version=' + vault.version);
    return vault;
}
