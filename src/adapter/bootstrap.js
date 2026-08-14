import { runtime } from '../core/runtime.js';
import { readState, writeState, readMemory, writeMemory, readVault, emptyStateVault, emptyMemoryVault } from '../core/vault/store.js';
import { loadVault, persistVaultToChatFile } from '../core/auto-restore.js';
import { t, setFieldLocale } from '../core/i18n.js';
import { renderVaultPanel } from './panel.js';
import { setDynamicStateMode } from '../core/vault/schema.js';
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
        var defaultVault = await readVault('default');
        if (!defaultVault || defaultVault.version === 0) return currentVault;
        var content = defaultVault.content || {};
        var hasData = (content.stm_entries && content.stm_entries.length > 0) ||
            (content.ltm_entries && content.ltm_entries.length > 0) ||
            (content.unconsolidated_stm && content.unconsolidated_stm.length > 0);
        if (!hasData) return currentVault;
        console.log('[NE] Migrating vault from "default" to fingerprint: ' + chatId);
        defaultVault.chat_id = chatId;
        await writeState(chatId, defaultVault);
        persistVaultToChatFile(defaultVault);
        await writeState('default', { chat_id: 'default', version: -1, content: {} });
        console.log('[NE] Vault migration complete');
        return defaultVault;
    } catch (e) {
        console.warn('[NE] Vault migration failed:', e.message);
        return currentVault;
    }
}

// ── L2: Global keyboard navigation for card toggle headers ──
// UIS-4: 去重守卫，init 双跑（脚本重复执行）时只绑一次，避免按键重复触发
var _keyNavBound = false;

function _bindCardToggleKeyNav() {
    if (_keyNavBound) return;
    _keyNavBound = true;
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var target = null;
        var path = e.composedPath && e.composedPath();
        if (path) {
            for (var i = 0; i < path.length; i++) {
                if (path[i] && path[i].closest) {
                    target = path[i].closest('.ne-char-card-header, .ne-faction-card-header, .ne-quest-header, .ne-suspense-header, .ne-accordion-header');
                    if (target) break;
                }
            }
        } else {
            target = e.target.closest('.ne-char-card-header, .ne-faction-card-header, .ne-quest-header, .ne-suspense-header, .ne-accordion-header');
        }
        if (!target) return;
        if (target.closest('input, textarea, select, button')) return;
        e.preventDefault();
        target.click();
    });
}

export async function bootstrapVault(chatId, locale, settings) {
    t(locale);
    setFieldLocale(locale);

    setDynamicStateMode(settings && settings.useDynamicState || false);
    setRetrievalEnabled(settings && settings.retrievalEnabled || false);

    console.log('[NE] Engine initializing — chatId=' + chatId);
    var vault = await loadVault(chatId);
    vault = await migrateVaultIfNeeded(chatId, vault);
    if (vault.version === 0 && !vault.content.language) {
        // UI-10: 事件已提前绑定（init 先 setupEventListeners），初始化写前重读最新 vault，
        // 若竞态窗口内已有消息数据写入则跳过全量初始化写，避免覆盖
        var latestState = await readState(chatId);
        var latestMemory = await readMemory(chatId);
        var stateHasData = latestState && latestState.content && Object.keys(latestState.content).length > 0;
        var memoryHasData = latestMemory && latestMemory.content &&
            ((latestMemory.content.stm_entries && latestMemory.content.stm_entries.length > 0) ||
             (latestMemory.content.unconsolidated_stm && latestMemory.content.unconsolidated_stm.length > 0));
        if (!stateHasData && !memoryHasData) {
            vault.content.language = locale.includes('zh') ? 'zh' : 'en';

            var initStateVault = emptyStateVault(chatId);
            var initMemoryVault = emptyMemoryVault(chatId);
            initMemoryVault.content.language = vault.content.language;
            await writeState(chatId, initStateVault);
            await writeMemory(chatId, initMemoryVault);

            persistVaultToChatFile(vault);
        }
    }

    restorePending();
    await renderVaultPanel(function() { return runtime.getChatId() || chatId; });

    // ── L2: Global keyboard navigation for card toggle headers ──
    _bindCardToggleKeyNav();

    autoConnectSecondaryApi();

    console.log('[NE] Engine initialized — chatId=' + chatId + ', version=' + vault.version);
    return vault;
}
