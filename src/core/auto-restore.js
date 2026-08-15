import { readState, writeState, readMemory, writeMemory, readVault, STATE_CONTENT_FIELDS, MEMORY_CONTENT_FIELDS } from './vault/store.js';
import { runtime } from './runtime.js';

var _loadedChatIds = {};

/**
 * 计算 vault content 的内容哈希（FNV-1a 32bit，十六进制字符串）。
 * 用于双存储（IndexedDB ↔ 聊天文件）等版本·异内容的比对。
 * 纯同步、跨设备稳定（依赖 JSON.stringify 的固定 key 顺序，NE 的 content
 * 由固定 schema 构造，顺序确定）。
 *
 * @param {object} content
 * @returns {string|null} 'h' + 8位hex；失败返回 null
 */
export function computeVaultContentHash(content) {
    try {
        var str = JSON.stringify(content || {});
        var h = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h * 0x01000193) >>> 0;
        }
        return 'h' + h.toString(16);
    } catch (e) { return null; }
}

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
    if (vault && vault.content) {
        vault._meta = vault._meta || {};
        vault._meta.content_hash = computeVaultContentHash(vault.content);
    }
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
        // 等版本：version 无法区分内容分歧，用 content_hash 比对（chat 侧持久化 vs IDB 实时）
        var chatHash = chatVault && chatVault._meta && chatVault._meta.content_hash;
        if (chatVersion > 0 && chatHash) {
            var idbHash = computeVaultContentHash(dbVault.content);
            if (idbHash !== chatHash) {
                // 等版本·异内容：跨设备/备份干预产生的分歧
                console.warn('[NE-VAULT] DIVERGENCE v' + dbVault.version + ' content hash differs — chat=' + chatHash + ' idb=' + idbHash);
                return await _reconcileDivergence(chatId, chatVault, stateVault, memVault, dbVault);
            }
            console.log('[NE-VAULT] DB and chat metadata in sync (v' + dbVault.version + ') — skip backfill');
        } else {
            console.log('[NE-VAULT] DB and chat metadata in sync (v' + dbVault.version + ') — no hash to compare');
        }
    } else {
        console.log('[NE-VAULT] Both DB and chat metadata are empty — fresh start');
    }
    return dbVault;
}

/**
 * 等版本·异内容裁决：按持久化 updated_at 择新，version+1 打破等版本僵局，
 * 同步两侧（chat 挂新 hash，IDB 拆分写）。绝不合并内容（NE 无合并场景，
 * 差异只来自外部干预，LWW 择新即自愈）。
 *
 * @param {string} chatId
 * @param {object} chatVault — 聊天文件侧合并 vault
 * @param {object|null} stateVault — IDB 侧持久化 state vault
 * @param {object|null} memVault — IDB 侧持久化 memory vault
 * @param {object} dbVault — IDB 侧合并 vault（readVault 结果）
 * @returns {Promise<object>} 赢家 vault
 */
async function _reconcileDivergence(chatId, chatVault, stateVault, memVault, dbVault) {
    var chatT = Date.parse(chatVault.updated_at || 0) || 0;
    var idbT = Math.max(
        Date.parse((stateVault && stateVault.updated_at) || 0) || 0,
        Date.parse((memVault && memVault.updated_at) || 0) || 0
    );
    var idbWins = idbT >= chatT;
    var winner = idbWins ? dbVault : chatVault;
    winner.version = (winner.version || 0) + 1;
    winner.updated_at = new Date().toISOString();
    console.warn('[NE-VAULT] DIVERGENCE reconciled — winner=' + (idbWins ? 'IndexedDB' : 'chat metadata') + ' -> v' + winner.version + ' (synced both sides)');
    await _writeSplitVault(chatId, winner);
    persistVaultToChatFile(winner); // 挂新 hash
    try { runtime.notify('[NE] 检测到记忆双存储内容不一致，已按较新时间戳自动同步为 v' + winner.version, 'NE', { type: 'warning' }); } catch (e) {}
    return winner;
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
