import { read, write } from './vault/store.js';
import { runtime } from './runtime.js';

var _loadedChatIds = {};

function _getChatMetadataNeVault() {
    try {
        var metadata = runtime.getChatMetadata();
        if (metadata && typeof metadata.ne_vault === 'string' && metadata.ne_vault.length > 0) {
            return metadata.ne_vault;
        }
    } catch (e) { console.warn('[NE] _getChatMetadataNeVault failed:', e.message); }
    return null;
}

function _setChatMetadataNeVault(vault) {
    try {
        var metadata = runtime.getChatMetadata();
        if (metadata) {
            metadata.ne_vault = JSON.stringify(vault);
        }
    } catch (e) { console.warn('[NE] _setChatMetadataNeVault failed:', e.message); }
}

function _saveChatFile() {
    try {
        runtime.saveChat().catch(function() {});
    } catch (e) { console.warn('[NE] _saveChatFile failed:', e.message); }
}

function _checkChatIntegrity(tag) {
    try {
        var chat = runtime.getChat && runtime.getChat();
        if (!chat || !Array.isArray(chat)) return;
        for (var i = 0; i < chat.length; i++) {
            if (chat[i] === undefined || chat[i] === null) {
                console.error('[NE-CHECK] chat[] corrupted at index ' + i + ' @ ' + tag + ' (total length=' + chat.length + ')');
                return;
            }
        }
    } catch (e) {}
}

export function persistVaultToChatFile(vault) {
    _checkChatIntegrity('persistVaultToChatFile:before');
    _setChatMetadataNeVault(vault);
    _checkChatIntegrity('persistVaultToChatFile:after_setMetadata');
    _saveChatFile();
    _checkChatIntegrity('persistVaultToChatFile:after_saveChat');
}

/**
 * loadVault — 分层加载：聊天文件优先，IndexedDB 兜底 + 自动回填
 *
 * 优先级：
 *   1. chat_metadata.ne_vault（聊天文件）
 *   2. IndexedDB vaults store（浏览器缓存）
 *
 * 兼容旧版本：
 *   - 仅有 IndexedDB 无 chat_metadata → 自动回填到聊天文件
 *   - 仅有 chat_metadata 无 IndexedDB → 自动恢复到 IndexedDB
 *   - 两者都有 → 取 version 更高的
 */
export async function loadVault(chatId) {
    var neVaultJson = _getChatMetadataNeVault();
    var chatVault = null;
    if (neVaultJson) {
        try { chatVault = JSON.parse(neVaultJson); } catch (e) { console.warn('[NE] chat_metadata.ne_vault JSON parse failed:', e.message); }
    }

    var dbVault = null;
    try { dbVault = await read(chatId); } catch (e) { console.warn('[NE] IndexedDB vault read failed:', e.message); }

    var effectiveVersion = (dbVault && dbVault.version) || 0;
    var chatVersion = (chatVault && chatVault.version) || 0;

    if (chatVersion > effectiveVersion) {
        try { await write(chatId, chatVault); } catch (e) { console.warn('[NE] IndexedDB vault write (from chat) failed:', e.message); }
        return chatVault;
    }

    // effectiveVersion >= chatVersion → IndexedDB is the source of truth
    // (inline edits/deletes write only to IndexedDB, not chat_metadata)
    if (effectiveVersion > 0) {
        persistVaultToChatFile(dbVault);
    }
    return dbVault;
}

/**
 * 兼容旧调用方的别名（不再弹窗，静默加载）
 */
export async function checkAndRestoreEmbeddedVault(chatId) {
    if (_loadedChatIds[chatId]) return;
    var keys = Object.keys(_loadedChatIds);
    if (keys.length >= 50) {
        keys.slice(0, 10).forEach(function (k) { delete _loadedChatIds[k]; });
    }
    _loadedChatIds[chatId] = true;
    await loadVault(chatId);
}
