import { read, write } from './vault/store.js';
import { discoverDynamicFields } from './engine/state-discovery.js';
import { isDynamicStateMode } from './vault/schema.js';
import { t_narrative } from './i18n.js';

var _restoredChatIds = {};

async function _discoverIfNeeded(chatId, vault) {
    try {
        if (!isDynamicStateMode()) return;
        if (!vault || !vault.content || vault.content.dynamic_state) return;
        var result = discoverDynamicFields(vault);
        if (result.discovered) {
            await write(chatId, vault);
            console.log('[NE] Dynamic state discovered for', chatId);
        }
    } catch (e) {
        console.warn('[NE] Dynamic state discovery failed:', e);
    }
}

var _restoredChatIds = {};

export async function checkAndRestoreEmbeddedVault(chatId) {
    if (_restoredChatIds[chatId]) return;
    // Cap at 50 entries to prevent unbounded growth
    var keys = Object.keys(_restoredChatIds);
    if (keys.length >= 50) {
        keys.slice(0, 10).forEach(function (k) { delete _restoredChatIds[k]; });
    }
    _restoredChatIds[chatId] = true;

    var neVaultJson = null;
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var metadata = SillyTavern.getContext().chatMetadata;
            if (metadata && typeof metadata.ne_vault === 'string') {
                neVaultJson = metadata.ne_vault;
            }
        }
    } catch (e) {
        return;
    }
    if (!neVaultJson) {
        // No embedded vault — check existing vault for dynamic state discovery
        try {
            var existingVault = await read(chatId);
            if (existingVault) await _discoverIfNeeded(chatId, existingVault);
        } catch (e) {}
        return;
    }

    try {
        var existingVault = await read(chatId);
        if (existingVault && existingVault.version > 0) {
            deleteChatMetadataNeVault();
            await _discoverIfNeeded(chatId, existingVault);
            return;
        }
    } catch (e) {}

    // Use ST toastr instead of blocking confirm()
    var body = t_narrative('Restore embedded vault?') + '\n\n' +
        t_narrative('Click Confirm to restore, Cancel to skip.');
    try {
        if (typeof toastr !== 'undefined') {
            toastr.info(body, t_narrative('NE Memory'), { timeOut: 0, extendedTimeOut: 0, closeButton: true, tapToDismiss: false });
        }
    } catch (e) {}
    var confirmed = false;
    try { confirmed = confirm(body); } catch (e) {}

    if (confirmed) {
        try {
            var vault = JSON.parse(neVaultJson);
            await write(chatId, vault);
            deleteChatMetadataNeVault();
            console.log('[NE] Vault restored from chat_metadata for', chatId);
            await _discoverIfNeeded(chatId, vault);
        } catch (e) {
            console.error('[NE] Failed to restore embedded vault:', e);
        }
    } else {
        deleteChatMetadataNeVault();
    }
}

function deleteChatMetadataNeVault() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var metadata = SillyTavern.getContext().chatMetadata;
            if (metadata) {
                delete metadata.ne_vault;
            }
        }
    } catch (e) {}
}
