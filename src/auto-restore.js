import { read, write } from './vault/store.js';

var _restoredChatIds = {};

export async function checkAndRestoreEmbeddedVault(chatId) {
    if (_restoredChatIds[chatId]) return;
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
    if (!neVaultJson) return;

    try {
        var existingVault = await read(chatId);
        if (existingVault && existingVault.version > 0) {
            deleteChatMetadataNeVault();
            return;
        }
    } catch (e) {}

    var confirmed = confirm('This chat contains an embedded NE Memory vault. Restore it?\n\n' +
        '(Clicking Cancel will delete the embedded data from chat metadata.)');
    if (confirmed) {
        try {
            var vault = JSON.parse(neVaultJson);
            await write(chatId, vault);
            deleteChatMetadataNeVault();
            console.log('[NE] Vault restored from chat_metadata for', chatId);
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
