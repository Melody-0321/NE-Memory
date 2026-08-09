import { readState, writeState, readMemory, writeMemory, readVault, STATE_CONTENT_FIELDS, MEMORY_CONTENT_FIELDS } from './vault/store.js';
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

async function _writeSplitVault(chatId, mergedVault) {
    var split = _splitMergedVault(chatId, mergedVault);
    await Promise.all([writeState(chatId, split.stateVault), writeMemory(chatId, split.memoryVault)]);
}

export async function loadVault(chatId) {
    var neVaultJson = _getChatMetadataNeVault();
    var chatVault = null;
    if (neVaultJson) {
        try { chatVault = JSON.parse(neVaultJson); } catch (e) { console.warn('[NE] chat_metadata.ne_vault JSON parse failed:', e.message); }
    }

    var stateVault = null, memVault = null;
    try {
        var result = await Promise.all([readState(chatId), readMemory(chatId)]);
        stateVault = result[0]; memVault = result[1];
    } catch (e) { console.warn('[NE] IndexedDB vault read failed:', e.message); }

    var stateDBVer = (stateVault && stateVault.version) || 0;
    var memDBVer = (memVault && memVault.version) || 0;
    var chatVersion = (chatVault && chatVault.version) || 0;

    console.log('[NE-VAULT] loadVault chatId=' + chatId + ' chatVer=' + chatVersion + ' stateDBVer=' + stateDBVer + ' memDBVer=' + memDBVer);

    if (chatVersion > stateDBVer || chatVersion > memDBVer) {
        console.log('[NE-VAULT] Chat metadata is newer — restoring to IndexedDB...');
        try {
            var split = _splitMergedVault(chatId, chatVault);
            var writes = [];
            if (chatVersion > stateDBVer) writes.push(writeState(chatId, split.stateVault));
            if (chatVersion > memDBVer) writes.push(writeMemory(chatId, split.memoryVault));
            await Promise.all(writes);
            console.log('[NE-VAULT] Restore complete — ' +
                'STM=' + ((chatVault.content && chatVault.content.unconsolidated_stm || []).length + (chatVault.content && chatVault.content.stm_entries || []).length) +
                ' LTM=' + ((chatVault.content && chatVault.content.ltm_entries || []).length) +
                ' state_keys=' + Object.keys((chatVault.content && chatVault.content.state) || {}).length);
        } catch (e) { console.warn('[NE] IndexedDB vault write (from chat) failed:', e.message); }
        var dbVault = await readVault(chatId);
        // P6: 仅 DB 严格新于聊天文件时才回填，版本一致（恢复成功）跳过冗余全量 saveChat
        if (dbVault && dbVault.version > chatVersion) {
            persistVaultToChatFile(dbVault);
        }
        return dbVault;
    }

    var dbVault = await readVault(chatId);
    // P6: 仅 DB 严格新于聊天文件时才回填（含兼容回填：chat 无 metadata 而 DB 有数据）
    if (dbVault && dbVault.version > chatVersion) {
        persistVaultToChatFile(dbVault);
    } else if (dbVault && dbVault.version > 0) {
        console.log('[NE-VAULT] DB and chat metadata in sync (v' + dbVault.version + ') — skip backfill');
    } else {
        console.log('[NE-VAULT] Both DB and chat metadata are empty — fresh start');
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
