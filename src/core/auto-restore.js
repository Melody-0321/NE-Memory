import { readVault, writeState, writeMemory, STATE_CONTENT_FIELDS, MEMORY_CONTENT_FIELDS } from './vault/store.js';
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
 * loadVault — 聊天文件恒定权威
 *
 * 权威定则：当前会话的 chat_metadata.ne_vault（即 ST 服务器聊天文件）是唯一权威。
 * IndexedDB 仅作同聊天 ID 的读写穿透缓存，绝不参与权威裁决。
 *   1. 聊天文件有 ne_vault → 恒胜：写回 IndexedDB 缓存，直接返回该值。
 *   2. 聊天文件无 ne_vault   → 回退读取 IndexedDB 存量，并一次性回填到聊天文件，
 *                              使其从此成为权威（存量数据跨浏览器/设备随聊天文件迁移）。
 */
function _splitMergedVault(chatId, mergedVault) {
    var content = mergedVault.content || {};

    var stateContent = {};
    STATE_CONTENT_FIELDS.forEach(function (f) { if (content[f] !== undefined) stateContent[f] = content[f]; });

    var memoryContent = {};
    MEMORY_CONTENT_FIELDS.forEach(function (f) { if (content[f] !== undefined) memoryContent[f] = content[f]; });

    var stateVault = {
        chat_id: chatId,
        version: mergedVault.version || 0,
        tokens: 0,
        updated_at: mergedVault.updated_at || new Date().toISOString(),
        _meta: {
            created_at: (mergedVault._meta && mergedVault._meta.created_at) || new Date().toISOString(),
            last_state_task: (mergedVault._meta && mergedVault._meta.last_state_task) || null,
            last_state_time: (mergedVault._meta && mergedVault._meta.last_state_time) || null
        },
        content: stateContent
    };

    var memoryVault = {
        chat_id: chatId,
        version: mergedVault.version || 0,
        tokens: 0,
        updated_at: mergedVault.updated_at || new Date().toISOString(),
        _meta: {
            created_at: (mergedVault._meta && mergedVault._meta.created_at) || new Date().toISOString(),
            last_pipeline_task: (mergedVault._meta && mergedVault._meta.last_pipeline_task) || null,
            last_pipeline_time: (mergedVault._meta && mergedVault._meta.last_pipeline_time) || null
        },
        content: memoryContent,
        stm_index: mergedVault.stm_index || {},
        link_index: mergedVault.link_index || {},
        memory_system_prompt: mergedVault.memory_system_prompt || ''
    };

    return { stateVault: stateVault, memoryVault: memoryVault };
}

export async function loadVault(chatId) {
    var neVaultJson = _getChatMetadataNeVault();
    var chatVault = null;
    if (neVaultJson) {
        try { chatVault = JSON.parse(neVaultJson); } catch (e) { console.warn('[NE] chat_metadata.ne_vault JSON parse failed:', e.message); }
    }

    // 聊天文件为恒定权威：存在即恒胜。
    if (chatVault && chatVault.content) {
        try {
            var split = _splitMergedVault(chatId, chatVault);
            await Promise.all([writeState(chatId, split.stateVault), writeMemory(chatId, split.memoryVault)]);
        } catch (e) { console.warn('[NE] IndexedDB cache restore (from chat) failed:', e.message); }
        console.log('[NE-VAULT] loadVault chatId=' + chatId + ' — chat file authoritative (v' + (chatVault.version || 0) + ')');
        return chatVault;
    }

    // 聊天文件无 ne_vault：回退存量 IndexedDB，并一次性回填聊天文件使其成为权威。
    console.log('[NE-VAULT] loadVault chatId=' + chatId + ' — no chat metadata, fallback to IndexedDB');
    try {
        var dbVault = await readVault(chatId);
        if (dbVault) {
            // 真实数据必从 v1 起写（saveStateVault/saveMemoryVault 恒 +1）；v0 仅含结构默认，不算存量。
            if (dbVault.version > 0) {
                persistVaultToChatFile(dbVault);
                console.log('[NE-VAULT] Backfilled IndexedDB data into chat file (v' + (dbVault.version || 0) + ')');
            } else {
                console.log('[NE-VAULT] Both DB and chat metadata are empty — fresh start');
            }
            return dbVault;
        }
    } catch (e) { console.warn('[NE] IndexedDB vault read failed:', e.message); }

    return readVault(chatId);
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
