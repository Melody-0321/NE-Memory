/**
 * vault/store.js — IndexedDB vault CRUD
 *
 * 替代 Python vault_store.py 的 JSON 文件读写。
 * 每个 chat_id 对应 IndexedDB 中的一条记录。
 */
const DB_NAME = 'ne_memory_vault';
const DB_VERSION = 3;
const STORE_NAME = 'vaults';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'chat_id' });
            }
            if (!db.objectStoreNames.contains('snapshots')) {
                const snapshotsStore = db.createObjectStore('snapshots', { keyPath: 'id' });
                snapshotsStore.createIndex('chat_id', 'chat_id', { unique: false });
            } else {
                // v3 迁移：旧 DB 可能缺 chat_id 索引
                var tx = e.target.transaction;
                var snapshotsStore = tx.objectStore('snapshots');
                if (!snapshotsStore.indexNames.contains('chat_id')) {
                    snapshotsStore.createIndex('chat_id', 'chat_id', { unique: false });
                }
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export { openDB };

var _storageBlocked = false;

export function isStorageBlocked() {
    return _storageBlocked;
}

export async function read(chatId) {
    var db;
    try {
        db = await openDB();
        _storageBlocked = false;
    } catch (e) {
        console.warn('[NE] IndexedDB open failed (tracking prevention?), using empty vault:', e.message);
        _storageBlocked = true;
        return emptyVault(chatId);
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(chatId);
        req.onsuccess = () => {
            const result = req.result;
            if (result) {
                const vault = result.vault;
                migrateTimeRange(vault);
                migrateProcessedMsgIds(vault);
                if (!vault._meta) {
                    vault._meta = {
                        created_at: vault.created_at || new Date().toISOString(),
                        last_pipeline_task: null,
                        last_pipeline_time: null
                    };
                }
                resolve(vault);
            } else {
                resolve(emptyVault(chatId));
            }
        };
        req.onerror = () => reject(req.error);
    });
}

export async function write(chatId, vault) {
    var db;
    try {
        db = await openDB();
        _storageBlocked = false;
    } catch (e) {
        console.warn('[NE] IndexedDB write failed (tracking prevention?):', e.message);
        _storageBlocked = true;
        return;
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ chat_id: chatId, vault: vault, updated_at: Date.now() });
        tx.oncomplete = () => { console.log('[NE] IndexedDB write OK for', chatId); resolve(); };
        tx.onerror = () => { console.error('[NE] IndexedDB write ERROR:', tx.error); reject(tx.error); };
    });
}

export async function writeWithSnapshot(chatId, vault, snapshotEntry) {
    var db;
    try {
        db = await openDB();
        _storageBlocked = false;
    } catch (e) {
        console.warn('[NE] IndexedDB atomic write failed (tracking prevention?):', e.message);
        _storageBlocked = true;
        return;
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, 'snapshots'], 'readwrite');
        const vaultStore = tx.objectStore(STORE_NAME);
        const snapStore = tx.objectStore('snapshots');
        vaultStore.put({ chat_id: chatId, vault: vault, updated_at: Date.now() });
        if (snapshotEntry) snapStore.put(snapshotEntry);
        tx.oncomplete = () => { console.log('[NE] Atomic vault+snapshot write OK for', chatId); resolve(); };
        tx.onerror = () => { console.error('[NE] Atomic write ERROR:', tx.error); reject(tx.error); };
    });
}

function migrateTimeRange(vault) {
    const content = vault.content || {};
    const ltms = content.ltm_entries || [];
    var dirty = false;
    ltms.forEach(function (ltm) {
        if (!ltm.time_range && ltm.period) {
            ltm.time_range = ltm.period;
            dirty = true;
        }
    });
    return dirty;
}

function migrateProcessedMsgIds(vault) {
    var content = vault.content || {};
    if (!content.processed_msg_ids || Object.keys(content.processed_msg_ids).length === 0) {
        var allIds = [];
        var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
        allSTM.forEach(function(stm) { (stm.msg_ids || []).forEach(function(id) { allIds.push(id); }); });
        if (allIds.length > 0) {
            var set = {};
            allIds.forEach(function(id) { set[id] = true; });
            content.processed_msg_ids = set;
        }
    }
    if (!content.cursor_state) {
        content.cursor_state = { stm: { position: 0, pending_partials: [] }, ltm: { position: 0, pending_partials: [] } };
    }
}

export async function remove(chatId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(chatId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export function emptyVault(chatId) {
    return {
        chat_id: chatId,
        version: 0,
        tokens: 0,
        updated_at: new Date().toISOString(),
        _meta: {
            created_at: new Date().toISOString(),
            last_pipeline_task: null,
            last_pipeline_time: null
        },
        content: {
            story_time: '',
            story_scene: '',
            story_date: '',
            summary: '',
            state: {},
            state_css: '',
            state_schema: null,
            ltm_entries: [],
            stm_entries: [],
            unconsolidated_stm: [],
            segment_counter: 0,
            current_scene: '',
            character_states: {},
            relationships: [],
            consolidate_threshold: 5,
            memory_config: {},
            language: 'zh',
            cursor_state: { stm: { position: 0, pending_partials: [] }, ltm: { position: 0, pending_partials: [] } },
            processed_msg_ids: {}
        },
        link_index: {},
        stm_index: {},
        memory_system_prompt: ''
    };
}

export function mergeVaultFromMessages(messages, existingVault) {
    const vault = existingVault || emptyVault('');
    const processedIds = collectAllMsgIds(vault);
    const newMessages = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const msgId = msg.id || msg.mes_id || i;
        if (!processedIds.has(msgId)) {
            newMessages.push({ id: msgId, role: msg.is_user ? 'user' : 'assistant', content: msg.mes || '', name: msg.name || '' });
        }
    }
    return { vault, newMessages };
}

function collectAllMsgIds(vault) {
    const ids = new Set();
    const content = vault.content || {};
    const allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    allSTM.forEach(stm => {
        (stm.msg_ids || []).forEach(id => ids.add(id));
    });
    return ids;
}

export function appendSTMEntries(vault, stmEntries) {
    const content = vault.content;
    const existingIds = new Set();
    content.unconsolidated_stm.forEach(e => existingIds.add(e.id));
    content.stm_entries.forEach(e => existingIds.add(e.id));
    let maxId = 0;
    content.unconsolidated_stm.forEach(e => {
        const num = parseInt(String(e.id).replace('stm_', ''), 10);
        if (num > maxId) maxId = num;
    });
    content.stm_entries.forEach(e => {
        const num = parseInt(String(e.id).replace('stm_', ''), 10);
        if (num > maxId) maxId = num;
    });

    let addedCount = 0;
    stmEntries.forEach(entry => {
        if (!entry.id) {
            maxId++;
            entry.id = 'stm_' + maxId;
        }
        if (existingIds.has(entry.id)) return;
        existingIds.add(entry.id);
        content.unconsolidated_stm.push(entry);
        vault.stm_index = vault.stm_index || {};
        vault.stm_index[entry.id] = {
            ltm_id: null,
            summary: (entry.event || '').substring(0, 100),
            msg_ids: entry.msg_ids || []
        };
        addedCount++;
    });
    return addedCount;
}

export function rollbackByMsgIds(vault, removedMsgIds) {
    const content = vault.content || {};
    const ridSet = new Set(removedMsgIds);
    const updated = { removedSTM: 0, removedLTM: 0 };
    const filterSTM = (list) => {
        const kept = [];
        list.forEach(stm => {
            const hasRemoved = (stm.msg_ids || []).some(id => ridSet.has(id));
            if (hasRemoved) {
                updated.removedSTM++;
                if (stm.parent_ltm && vault.stm_index && vault.stm_index[stm.id]) {
                    vault.stm_index[stm.id].ltm_id = null;
                }
            } else {
                kept.push(stm);
            }
        });
        return kept;
    };
    content.unconsolidated_stm = filterSTM(content.unconsolidated_stm || []);
    content.stm_entries = filterSTM(content.stm_entries || []);
    const keptLTM = [];
    (content.ltm_entries || []).forEach(ltm => {
        const refs = (ltm.stm_refs || []).filter(stmId => {
            const idx = (vault.stm_index || {})[stmId];
            return idx && !(idx.msg_ids || []).some(id => ridSet.has(id));
        });
        if (refs.length === 0) {
            updated.removedLTM++;
        } else {
            ltm.stm_refs = refs;
            keptLTM.push(ltm);
        }
    });
    content.ltm_entries = keptLTM;

    // 清除 processed_msg_ids，允许这些消息在下一次提取时重新参与
    var processed = content.processed_msg_ids || {};
    removedMsgIds.forEach(function(id) { delete processed[id]; });

    return updated;
}

// ─── Cursor State ───

export function getCursorState(vault, mode) {
    var cs = (vault.content || {}).cursor_state || {};
    return cs[mode] || { position: 0, pending_partials: [] };
}

export function updateCursorState(vault, mode, state) {
    if (!vault.content) vault.content = {};
    if (!vault.content.cursor_state) vault.content.cursor_state = {};
    vault.content.cursor_state[mode] = state;
}

// ─── Processed Message ID Tracking ───

export function markMessagesProcessed(vault, msgIds) {
    if (!vault.content) vault.content = {};
    if (!vault.content.processed_msg_ids) vault.content.processed_msg_ids = {};
    var set = vault.content.processed_msg_ids;
    msgIds.forEach(function(id) { if (id !== undefined && id !== null) set[String(id)] = true; });
}

export function isMessageProcessed(vault, msgId) {
    // normalize to string: object keys are always string-typed
    var key = msgId !== undefined && msgId !== null ? String(msgId) : '';
    var set = (vault.content || {}).processed_msg_ids;
    return key ? !!set[key] : false;
}

export function getProcessedMessageIds(vault) {
    return Object.keys((vault.content || {}).processed_msg_ids || {});
}

export function collectProcessedMsgIds(vault) {
    // 优先使用 processed_msg_ids (O(1) 查询)
    var processed = (vault.content || {}).processed_msg_ids || {};
    var ids = Object.keys(processed);
    // 降级：如果 processed_msg_ids 为空但 STM 有数据，从 STM 重建
    if (ids.length === 0) {
        var content = vault.content || {};
        var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
        allSTM.forEach(function(stm) { (stm.msg_ids || []).forEach(function(id) { ids.push(id); }); });
        // 重建 processed_msg_ids 集合
        if (ids.length > 0) markMessagesProcessed(vault, ids);
    }
    return new Set(ids);
}
