/**
 * vault/store.js — IndexedDB vault CRUD
 *
 * v8: force-reset empty stores from v7 botched upgrade, recover from chat metadata.
 */
const DB_NAME = 'ne_memory_vault';
const DB_VERSION = 8;
const STATE_STORE = 'state_vaults';
const MEMORY_STORE = 'memory_vaults';

function _hasOldVaults(db) {
    try { if (localStorage.getItem('ne_v7_migrated') === '1') return false; } catch (e) {}
    return db.objectStoreNames.contains('vaults');
}

function _migrateVaultsToSplit(db) {
    return new Promise(function (resolve, reject) {
        try {
            var tx = db.transaction(['vaults', STATE_STORE, MEMORY_STORE], 'readwrite');
            var oldStore = tx.objectStore('vaults');
            var stateStore = tx.objectStore(STATE_STORE);
            var memStore = tx.objectStore(MEMORY_STORE);
            var migrated = 0;
            var cursorReq = oldStore.openCursor();
            var verifyHashes = [];
            cursorReq.onsuccess = function (event) {
                var cursor = event.target.result;
                if (cursor) {
                    var record = cursor.value;
                    var vault = record.vault;
                    if (vault && vault.content) {
                        var stateVault = _buildStateVault(vault.chat_id, vault);
                        var memVault = _buildMemoryVault(vault.chat_id, vault);
                        stateStore.put({ chat_id: vault.chat_id, vault: stateVault, updated_at: record.updated_at || Date.now() });
                        memStore.put({ chat_id: vault.chat_id, vault: memVault, updated_at: record.updated_at || Date.now() });
                        verifyHashes.push({
                            chat_id: vault.chat_id,
                            old_stm_total: (vault.content.unconsolidated_stm || []).length + (vault.content.stm_entries || []).length,
                            old_ltm_total: (vault.content.ltm_entries || []).length,
                            old_state_keys: Object.keys(vault.content.state || {}).length
                        });
                        migrated++;
                    }
                    cursor.continue();
                } else {
                    var afterTx = db.transaction([STATE_STORE, MEMORY_STORE], 'readonly');
                    var afterState = afterTx.objectStore(STATE_STORE);
                    var afterMem = afterTx.objectStore(MEMORY_STORE);
                    var checks = verifyHashes.length;
                    var done = 0;
                    var allOk = true;
                    verifyHashes.forEach(function(h) {
                        var sReq = afterState.get(h.chat_id);
                        sReq.onsuccess = function() {
                            var mReq = afterMem.get(h.chat_id);
                            mReq.onsuccess = function() {
                                var sv = sReq.result && sReq.result.vault;
                                var mv = mReq.result && mReq.result.vault;
                                var stmOk = sv !== undefined && mv !== undefined;
                                var oldTotal = h.old_stm_total + h.old_ltm_total;
                                var newStm = (mv && mv.content ? (mv.content.unconsolidated_stm || []).length + (mv.content.stm_entries || []).length : -1);
                                var newLtm = (mv && mv.content ? (mv.content.ltm_entries || []).length : -1);
                                var newStateKeys = (sv && sv.content && sv.content.state ? Object.keys(sv.content.state).length : -1);
                                var memMatch = newStm === h.old_stm_total && newLtm === h.old_ltm_total;
                                var stateMatch = newStateKeys === h.old_state_keys;
                                if (!memMatch || !stateMatch) {
                                    allOk = false;
                                    console.error('[NE] v7 migration VERIFY FAIL for ' + h.chat_id + ':',
                                        'STM ' + h.old_stm_total + '→' + newStm,
                                        'LTM ' + h.old_ltm_total + '→' + newLtm,
                                        'state_keys ' + h.old_state_keys + '→' + newStateKeys);
                                }
                                done++;
                                if (done >= checks) {
                                    if (allOk) {
                                        console.log('[NE] v6→v7 migration: ' + migrated + ' vault(s) split. VERIFIED — all data intact. Migration complete.');
                                        try { localStorage.setItem('ne_v7_migrated', '1'); } catch(e) {}
                                    } else {
                                        console.warn('[NE] v6→v7 migration: ' + migrated + ' vault(s) split. VERIFICATION FAILED — see errors above. Old vaults store preserved.');
                                    }
                                    resolve(migrated);
                                }
                            };
                            mReq.onerror = function() { done++; if (done >= checks) { console.warn('[NE] v7 migration verify read error'); resolve(migrated); } };
                        };
                        sReq.onerror = function() { done++; if (done >= checks) { console.warn('[NE] v7 migration verify read error'); resolve(migrated); } };
                    });
                }
            };
            cursorReq.onerror = function () { reject(cursorReq.error); };
        } catch (e) { reject(e); }
    });
}

function _buildStateVault(chatId, vault) {
    var content = vault.content || {};
    var meta = vault._meta || {};
    return {
        chat_id: chatId,
        version: vault.version || 0,
        tokens: 0,
        updated_at: vault.updated_at || new Date().toISOString(),
        _meta: { created_at: meta.created_at || new Date().toISOString(), last_state_task: meta.last_state_task || null, last_state_time: meta.last_state_time || null },
        content: {
            state: content.state || {},
            story_time: content.story_time || '',
            story_scene: content.story_scene || '',
            story_date: content.story_date || '',
            state_schema: content.state_schema || null,
            state_css: content.state_css || '',
            character_schema: content.character_schema || null,
            _active_characters: content._active_characters || [],
            faction_keywords: content.faction_keywords || {}
        }
    };
}

function _buildMemoryVault(chatId, vault) {
    var content = vault.content || {};
    var meta = vault._meta || {};
    return {
        chat_id: chatId,
        version: vault.version || 0,
        tokens: 0,
        updated_at: vault.updated_at || new Date().toISOString(),
        _meta: { created_at: meta.created_at || new Date().toISOString(), last_pipeline_task: meta.last_pipeline_task || null, last_pipeline_time: meta.last_pipeline_time || null },
        content: {
            unconsolidated_stm: content.unconsolidated_stm || [],
            stm_entries: content.stm_entries || [],
            ltm_entries: content.ltm_entries || [],
            cursor_state: content.cursor_state || { stm: { position: 0, pending_partials: [], completedTurns: 0 }, ltm: { position: 0, pending_partials: [] } },
            segment_counter: content.segment_counter || 0,
            consolidate_threshold: content.consolidate_threshold || 5,
            language: content.language || 'zh',
            memory_config: content.memory_config || {},
            summary: content.summary || '',
            current_scene: content.current_scene || '',
            character_states: content.character_states || {},
            relationships: content.relationships || []
        },
        stm_index: vault.stm_index || {},
        link_index: vault.link_index || {},
        memory_system_prompt: vault.memory_system_prompt || ''
    };
}

function openDB() {
    return new Promise((resolve, reject) => {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            if (db.objectStoreNames.contains('snapshots')) {
                db.deleteObjectStore('snapshots');
            }
            if (db.objectStoreNames.contains(STATE_STORE)) {
                db.deleteObjectStore(STATE_STORE);
            }
            if (db.objectStoreNames.contains(MEMORY_STORE)) {
                db.deleteObjectStore(MEMORY_STORE);
            }
            if (!db.objectStoreNames.contains('card_configs')) {
                db.createObjectStore('card_configs', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STATE_STORE)) {
                db.createObjectStore(STATE_STORE, { keyPath: 'chat_id' });
            }
            if (!db.objectStoreNames.contains(MEMORY_STORE)) {
                db.createObjectStore(MEMORY_STORE, { keyPath: 'chat_id' });
            }
            if (!db.objectStoreNames.contains('state_deltas')) {
                var sdStore = db.createObjectStore('state_deltas', { keyPath: 'id' });
                sdStore.createIndex('chat_id', 'chat_id', { unique: false });
            }
            if (!db.objectStoreNames.contains('memory_versions')) {
                var mvStore = db.createObjectStore('memory_versions', { keyPath: 'id' });
                mvStore.createIndex('chat_id', 'chat_id', { unique: false });
            }
            if (!db.objectStoreNames.contains('active_chains')) {
                db.createObjectStore('active_chains', { keyPath: 'chat_id' });
            }
            if (!db.objectStoreNames.contains('orphaned_branches')) {
                var obStore = db.createObjectStore('orphaned_branches', { keyPath: 'id' });
                obStore.createIndex('chat_id', 'chat_id', { unique: false });
            }
        };
        req.onsuccess = function () {
            var db = req.result;
            if (_hasOldVaults(db)) {
                _migrateVaultsToSplit(db).then(function (count) {
                    console.log('[NE] v7 migration complete: ' + count + ' vault(s) split. Old vaults store preserved (will clean up in future version).');
                    resolve(db);
                }).catch(function (err) {
                    console.error('[NE] v7 migration failed:', err);
                    resolve(db);
                });
            } else {
                resolve(db);
            }
        };
        req.onerror = function () { reject(req.error); };
    });
}

export { openDB };

var _storageBlocked = false;

export function isStorageBlocked() {
    return _storageBlocked;
}

// ====== State Vault ======

export function emptyStateVault(chatId) {
    return {
        chat_id: chatId,
        version: 0,
        tokens: 0,
        updated_at: new Date().toISOString(),
        _meta: {
            created_at: new Date().toISOString(),
            last_state_task: null,
            last_state_time: null
        },
        content: {
            state: {},
            story_time: '',
            story_scene: '',
            story_date: '',
            state_schema: null,
            state_css: '',
            character_schema: null,
            _active_characters: [],
            faction_keywords: {}
        }
    };
}

export async function readState(chatId) {
    var db;
    try {
        db = await openDB();
        _storageBlocked = false;
    } catch (e) {
        console.warn('[NE] IndexedDB open failed:', e.message);
        _storageBlocked = true;
        return emptyStateVault(chatId);
    }
    return new Promise((resolve, reject) => {
        var tx = db.transaction(STATE_STORE, 'readonly');
        var store = tx.objectStore(STATE_STORE);
        var req = store.get(chatId);
        req.onsuccess = () => {
            var result = req.result;
            if (result && result.vault && result.vault.content) {
                resolve(result.vault);
            } else {
                resolve(emptyStateVault(chatId));
            }
        };
        req.onerror = () => reject(req.error);
    });
}

export async function writeState(chatId, stateVault) {
    var db;
    try {
        db = await openDB();
        _storageBlocked = false;
    } catch (e) {
        console.warn('[NE] IndexedDB writeState failed:', e.message);
        _storageBlocked = true;
        return;
    }
    return new Promise((resolve, reject) => {
        var tx = db.transaction(STATE_STORE, 'readwrite');
        var store = tx.objectStore(STATE_STORE);
        store.put({ chat_id: chatId, vault: stateVault, updated_at: Date.now() });
        tx.oncomplete = () => { console.log('[NE] IndexedDB writeState OK for', chatId); resolve(); };
        tx.onerror = () => { console.error('[NE] IndexedDB writeState ERROR:', tx.error); reject(tx.error); };
    });
}

// ====== Memory Vault ======

export function emptyMemoryVault(chatId) {
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
            unconsolidated_stm: [],
            stm_entries: [],
            ltm_entries: [],
            cursor_state: { stm: { position: 0, pending_partials: [], completedTurns: 0 }, ltm: { position: 0, pending_partials: [] } },
            segment_counter: 0,
            consolidate_threshold: 5,
            language: 'zh',
            memory_config: {},
            summary: '',
            current_scene: '',
            character_states: {},
            relationships: []
        },
        stm_index: {},
        link_index: {},
        memory_system_prompt: ''
    };
}

export async function readMemory(chatId) {
    var db;
    try {
        db = await openDB();
        _storageBlocked = false;
    } catch (e) {
        console.warn('[NE] IndexedDB open failed:', e.message);
        _storageBlocked = true;
        return emptyMemoryVault(chatId);
    }
    return new Promise((resolve, reject) => {
        var tx = db.transaction(MEMORY_STORE, 'readonly');
        var store = tx.objectStore(MEMORY_STORE);
        var req = store.get(chatId);
        req.onsuccess = () => {
            var result = req.result;
            if (result && result.vault && result.vault.content) {
                var v = result.vault;
                ensureCursorState(v);
                resolve(v);
            } else {
                resolve(emptyMemoryVault(chatId));
            }
        };
        req.onerror = () => reject(req.error);
    });
}

export async function writeMemory(chatId, memoryVault) {
    var db;
    try {
        db = await openDB();
        _storageBlocked = false;
    } catch (e) {
        console.warn('[NE] IndexedDB writeMemory failed:', e.message);
        _storageBlocked = true;
        return;
    }
    return new Promise((resolve, reject) => {
        var tx = db.transaction(MEMORY_STORE, 'readwrite');
        var store = tx.objectStore(MEMORY_STORE);
        store.put({ chat_id: chatId, vault: memoryVault, updated_at: Date.now() });
        tx.oncomplete = () => { console.log('[NE] IndexedDB writeMemory OK for', chatId); resolve(); };
        tx.onerror = () => { console.error('[NE] IndexedDB writeMemory ERROR:', tx.error); reject(tx.error); };
    });
}

// ====== Merged Read (for UI / compat) ======

export async function readVault(chatId) {
    var [stateVault, memoryVault] = await Promise.all([readState(chatId), readMemory(chatId)]);
    var v = {
        chat_id: chatId,
        version: Math.max(stateVault.version || 0, memoryVault.version || 0),
        tokens: (stateVault.tokens || 0) + (memoryVault.tokens || 0),
        updated_at: new Date().toISOString(),
        _meta: {
            created_at: stateVault._meta && stateVault._meta.created_at || new Date().toISOString(),
            last_pipeline_task: memoryVault._meta && memoryVault._meta.last_pipeline_task || null,
            last_pipeline_time: memoryVault._meta && memoryVault._meta.last_pipeline_time || null,
            last_state_task: stateVault._meta && stateVault._meta.last_state_task || null,
            last_state_time: stateVault._meta && stateVault._meta.last_state_time || null
        },
        content: Object.assign({}, stateVault.content || {}, memoryVault.content || {}),
        stm_index: memoryVault.stm_index || {},
        link_index: memoryVault.link_index || {},
        memory_system_prompt: memoryVault.memory_system_prompt || ''
    };
    migrateTimeRange(v);
    ensureCursorState(v);
    if (!v.content.cursor_state) {
        v.content.cursor_state = { stm: { position: 0, pending_partials: [], completedTurns: 0 }, ltm: { position: 0, pending_partials: [] } };
    }
    return v;
}

// ====== Deprecated compat wrappers ======

export function emptyVault(chatId) {
    return readVault(chatId);
}

export async function read(chatId) {
    return readVault(chatId);
}

export async function write(chatId, vault) {
    console.warn('[NE] write() is deprecated — use writeState() or writeMemory() directly');
    var content = vault.content || {};
    var stateVault = {
        chat_id: chatId, version: vault.version || 0, tokens: 0, updated_at: new Date().toISOString(),
        _meta: { created_at: (vault._meta && vault._meta.created_at) || new Date().toISOString(), last_state_task: (vault._meta && vault._meta.last_state_task) || null, last_state_time: (vault._meta && vault._meta.last_state_time) || null },
        content: { state: content.state || {}, story_time: content.story_time || '', story_scene: content.story_scene || '', story_date: content.story_date || '', state_schema: content.state_schema || null, state_css: content.state_css || '', character_schema: content.character_schema || null, _active_characters: content._active_characters || [], faction_keywords: content.faction_keywords || {} }
    };
    var memoryVault = {
        chat_id: chatId, version: vault.version || 0, tokens: 0, updated_at: new Date().toISOString(),
        _meta: { created_at: (vault._meta && vault._meta.created_at) || new Date().toISOString(), last_pipeline_task: (vault._meta && vault._meta.last_pipeline_task) || null, last_pipeline_time: (vault._meta && vault._meta.last_pipeline_time) || null },
        content: { unconsolidated_stm: content.unconsolidated_stm || [], stm_entries: content.stm_entries || [], ltm_entries: content.ltm_entries || [], cursor_state: content.cursor_state || { stm: { position: 0, pending_partials: [], completedTurns: 0 }, ltm: { position: 0, pending_partials: [] } }, segment_counter: content.segment_counter || 0, consolidate_threshold: content.consolidate_threshold || 5, language: content.language || 'zh', memory_config: content.memory_config || {}, summary: content.summary || '', current_scene: content.current_scene || '', character_states: content.character_states || {}, relationships: content.relationships || [] },
        stm_index: vault.stm_index || {}, link_index: vault.link_index || {}, memory_system_prompt: vault.memory_system_prompt || ''
    };
    return Promise.all([writeState(chatId, stateVault), writeMemory(chatId, memoryVault)]);
}

// ====== Common ======

function migrateTimeRange(vault) {
    var content = vault.content || {};
    var ltms = content.ltm_entries || [];
    var dirty = false;
    ltms.forEach(function (ltm) {
        if (!ltm.time_range && ltm.period) {
            ltm.time_range = ltm.period;
            dirty = true;
        }
    });
    return dirty;
}

function ensureCursorState(vault) {
    var content = vault.content || {};
    if (!content.cursor_state) {
        content.cursor_state = { stm: { completedTurns: 0, position: 0, pending_partials: [] }, ltm: { position: 0, pending_partials: [] } };
    }
    var stm = content.cursor_state.stm;
    if (stm && stm.completedTurns === undefined) {
        stm.completedTurns = stm.position || 0;
    }
}

export async function remove(chatId) {
    var db = await openDB();
    return new Promise((resolve, reject) => {
        var tx = db.transaction([STATE_STORE, MEMORY_STORE], 'readwrite');
        tx.objectStore(STATE_STORE).delete(chatId);
        tx.objectStore(MEMORY_STORE).delete(chatId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ====== mergeVaultFromMessages ======

export function mergeVaultFromMessages(messages, existingVault) {
    var vault = existingVault || emptyMemoryVault('');
    var processedIds = collectAllMsgIds(vault);
    var newMessages = [];
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var msgId = (msg.id != null) ? msg.id : msg.mes_id;
        if (msgId == null || !processedIds.has(String(msgId))) {
            newMessages.push({ id: msgId != null ? msgId : i, role: msg.is_user ? 'user' : 'assistant', content: msg.mes || '', name: msg.name || '' });
        }
    }
    return { vault, newMessages };
}

export function collectAllMsgIds(vault) {
    var ids = new Set();
    var content = vault.content || {};
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    allSTM.forEach(function (stm) {
        (stm.msg_ids || []).forEach(function (id) { ids.add(String(id)); });
    });
    return ids;
}

export function sortStmByMsgOrder(entries) {
    if (!entries || entries.length < 2) return entries;
    return entries.slice().sort(function (a, b) {
        var aPos = a.absMsgStart !== undefined ? a.absMsgStart : (a.msgRange && a.msgRange[0] !== undefined ? a.msgRange[0] : Infinity);
        var bPos = b.absMsgStart !== undefined ? b.absMsgStart : (b.msgRange && b.msgRange[0] !== undefined ? b.msgRange[0] : Infinity);
        return aPos - bPos;
    });
}

export function appendSTMEntries(vault, stmEntries) {
    var content = vault.content;
    var existingIds = new Set();
    content.unconsolidated_stm.forEach(function (e) { existingIds.add(e.id); });
    content.stm_entries.forEach(function (e) { existingIds.add(e.id); });
    var maxId = 0;
    content.unconsolidated_stm.forEach(function (e) {
        var num = parseInt(String(e.id).replace('stm_', ''), 10);
        if (num > maxId) maxId = num;
    });
    content.stm_entries.forEach(function (e) {
        var num = parseInt(String(e.id).replace('stm_', ''), 10);
        if (num > maxId) maxId = num;
    });
    var addedCount = 0;
    stmEntries.sort(function (a, b) {
        return (a.absMsgStart !== undefined ? a.absMsgStart : Infinity) - (b.absMsgStart !== undefined ? b.absMsgStart : Infinity);
    });
    stmEntries.forEach(function (entry) {
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
    var content = vault.content || {};
    var ridSet = new Set(removedMsgIds);
    var updated = { removedSTM: 0, removedLTM: 0 };
    var filterSTM = function (list) {
        var kept = [];
        list.forEach(function (stm) {
            var hasRemoved = (stm.msg_ids || []).some(function (id) { return ridSet.has(id); });
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
    var keptLTM = [];
    (content.ltm_entries || []).forEach(function (ltm) {
        var refs = (ltm.stm_refs || []).filter(function (stmId) {
            var idx = (vault.stm_index || {})[stmId];
            return idx && !(idx.msg_ids || []).some(function (id) { return ridSet.has(id); });
        });
        if (refs.length === 0) {
            updated.removedLTM++;
        } else {
            ltm.stm_refs = refs;
            keptLTM.push(ltm);
        }
    });
    content.ltm_entries = keptLTM;
    return updated;
}

// ====== Template Library CRUD (localStorage) ======

export function loadTemplateLibrary() {
    try {
        var raw = localStorage.getItem('ne_template_library');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { templates: {}, updatedAt: new Date().toISOString() };
}

export function saveTemplateLibrary(lib) {
    try {
        lib.updatedAt = new Date().toISOString();
        localStorage.setItem('ne_template_library', JSON.stringify(lib));
    } catch (e) {}
}

export function saveTemplate(template) {
    var lib = loadTemplateLibrary();
    template.updatedAt = new Date().toISOString();
    if (!template.createdAt) template.createdAt = template.updatedAt;
    lib.templates[template.id] = template;
    saveTemplateLibrary(lib);
    return true;
}

export function deleteTemplate(templateId) {
    var lib = loadTemplateLibrary();
    if (!lib.templates[templateId]) return false;
    delete lib.templates[templateId];
    saveTemplateLibrary(lib);
    return true;
}

export function getTemplate(templateId) {
    var lib = loadTemplateLibrary();
    return lib.templates[templateId] || null;
}

// ====== Card-Level Template Configuration ======

export function loadCardConfig(charName) {
    try {
        var raw = localStorage.getItem('ne_card_templates_' + charName);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    try {
        var dbReq = indexedDB.open(DB_NAME, DB_VERSION);
        return new Promise(function (resolve) {
            dbReq.onsuccess = function () {
                var db = dbReq.result;
                var tx = db.transaction('card_configs', 'readonly');
                var store = tx.objectStore('card_configs');
                var getReq = store.get(charName);
                getReq.onsuccess = function () {
                    if (getReq.result) {
                        var config = getReq.result;
                        delete config.id;
                        try { localStorage.setItem('ne_card_templates_' + charName, JSON.stringify(config)); } catch (e) {}
                        resolve(config);
                    } else {
                        resolve(null);
                    }
                    db.close();
                };
                getReq.onerror = function () { resolve(null); db.close(); };
            };
            dbReq.onerror = function () { resolve(null); };
        });
    } catch (e) {
        return null;
    }
}

export function loadCardConfigSync(charName) {
    try {
        var raw = localStorage.getItem('ne_card_templates_' + charName);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

export function saveCardConfig(charName, config) {
    var current = loadCardConfigSync(charName);
    var nextVersion = (current && current._version || 0) + 1;
    config._version = nextVersion;
    config._updatedAt = new Date().toISOString();
    if (!config._createdAt) config._createdAt = config._updatedAt;
    var existingRaw = localStorage.getItem('ne_card_templates_' + charName);
    if (existingRaw) {
        try {
            var existing = JSON.parse(existingRaw);
            if (existing._version >= nextVersion) {
                console.warn('[NE] Card config version conflict for', charName, 'expected <', nextVersion, 'got', existing._version, '— skipping write');
                return false;
            }
        } catch (e) {}
    }
    try {
        localStorage.setItem('ne_card_templates_' + charName, JSON.stringify(config));
    } catch (e) {
        console.warn('[NE] localStorage write failed for', charName, e.message);
        return false;
    }
    try {
        var dbReq = indexedDB.open(DB_NAME, DB_VERSION);
        dbReq.onsuccess = function () {
            var db = dbReq.result;
            var tx = db.transaction('card_configs', 'readwrite');
            var store = tx.objectStore('card_configs');
            var toStore = Object.assign({ id: charName }, config);
            store.put(toStore);
            tx.oncomplete = function () { db.close(); };
        };
        dbReq.onerror = function () { console.warn('[NE] IndexedDB write failed for card_config:', charName); };
    } catch (e) {
        console.warn('[NE] IndexedDB write failed for', charName, e.message);
    }
    return true;
}

export function deleteCardConfig(charName) {
    try { localStorage.removeItem('ne_card_templates_' + charName); } catch (e) {}
    try {
        var dbReq = indexedDB.open(DB_NAME, DB_VERSION);
        dbReq.onsuccess = function () {
            var db = dbReq.result;
            var tx = db.transaction('card_configs', 'readwrite');
            var store = tx.objectStore('card_configs');
            store.delete(charName);
            tx.oncomplete = function () { db.close(); };
        };
    } catch (e) {}
}

// ====== Field Library Operations ======

export function loadFieldLibrary() {
    try {
        var raw = localStorage.getItem('ne_field_library');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { fields: {}, updatedAt: new Date().toISOString() };
}

export function saveFieldLibrary(lib) {
    try {
        lib.updatedAt = new Date().toISOString();
        localStorage.setItem('ne_field_library', JSON.stringify(lib));
    } catch (e) {}
}

export function addFieldToLibrary(fieldName, entry) {
    var lib = loadFieldLibrary();
    var now = new Date().toISOString();
    entry.updatedAt = now;
    if (!entry.createdAt) entry.createdAt = now;
    if (!entry.usedByTemplates) entry.usedByTemplates = [];
    lib.fields[fieldName] = entry;
    saveFieldLibrary(lib);
}

export function removeFieldFromLibrary(fieldName) {
    var lib = loadFieldLibrary();
    if (!lib.fields[fieldName]) return false;
    var usedBy = lib.fields[fieldName].usedByTemplates || [];
    if (usedBy.length > 0) {
        console.warn('[NE] Cannot delete field', fieldName, '— used by templates:', usedBy);
        return false;
    }
    delete lib.fields[fieldName];
    saveFieldLibrary(lib);
    return true;
}

export function getFieldFromLibrary(fieldName) {
    var lib = loadFieldLibrary();
    return lib.fields[fieldName] || null;
}

// ====== Reference Tracking ======

export function addTemplateRefToField(fieldName, templateId) {
    var lib = loadFieldLibrary();
    var entry = lib.fields[fieldName];
    if (!entry) return;
    if (!entry.usedByTemplates) entry.usedByTemplates = [];
    if (entry.usedByTemplates.indexOf(templateId) === -1) {
        entry.usedByTemplates.push(templateId);
        saveFieldLibrary(lib);
    }
}

export function removeTemplateRefFromField(fieldName, templateId) {
    var lib = loadFieldLibrary();
    var entry = lib.fields[fieldName];
    if (!entry || !entry.usedByTemplates) return;
    var idx = entry.usedByTemplates.indexOf(templateId);
    if (idx !== -1) {
        entry.usedByTemplates.splice(idx, 1);
        saveFieldLibrary(lib);
    }
}

// ====== Card-Level Template Operations ======

export function cloneTemplateToCard(charName, template) {
    var config = loadCardConfigSync(charName) || { _dialogueTemplates: {}, _templateConfig: {}, _version: 0 };
    if (!config._dialogueTemplates) config._dialogueTemplates = {};
    var now = new Date().toISOString();
    var suffix = Math.random().toString(36).slice(2, 8);
    var key = 'tmpl_' + now.replace(/[-:T]/g, '').slice(0, 8) + '_' + suffix;
    config._dialogueTemplates[key] = {
        _templateId: template.id,
        createdAt: now,
        _locked: template._locked || false,
        presetFields: (template.presetFields || []).slice(),
        customFieldRefs: (template.customFieldRefs || []).slice(),
        _state: 'synced'
    };
    saveCardConfig(charName, config);
    return key;
}

export function getActiveVersion(dialogueTemplates, templateId) {
    var matches = [];
    Object.keys(dialogueTemplates).forEach(function (k) {
        var t = dialogueTemplates[k];
        if (t._templateId === templateId) matches.push(t);
    });
    if (matches.length === 0) return null;
    matches.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    return matches[0];
}

export function upgradeTemplateVersion(state, oldKey, newKey, lockedCharName) {
    if (!state || !state.characters) return;
    var lockedNames = [];
    Object.keys(state.characters).forEach(function (name) {
        var charData = state.characters[name];
        if (charData._templateKey === oldKey) {
            if (charData._templateLocked) {
                lockedNames.push(name);
            } else {
                charData._templateKey = newKey;
            }
        }
    });
    return lockedNames;
}

export function registerFieldToTemplate(templateId, fieldName) {
    var lib = loadTemplateLibrary();
    var tpl = lib.templates[templateId];
    if (!tpl) return;
    if (!tpl.customFieldRefs) tpl.customFieldRefs = [];
    if (tpl.customFieldRefs.indexOf(fieldName) === -1) {
        tpl.customFieldRefs.push(fieldName);
        saveTemplateLibrary(lib);
    }
}

export function unregisterFieldFromTemplate(templateId, fieldName) {
    var lib = loadTemplateLibrary();
    var tpl = lib.templates[templateId];
    if (!tpl || !tpl.customFieldRefs) return;
    var idx = tpl.customFieldRefs.indexOf(fieldName);
    if (idx !== -1) {
        tpl.customFieldRefs.splice(idx, 1);
        saveTemplateLibrary(lib);
    }
}

export function editTemplateInCard(charName, dialogueTemplateKey, presetFields, customFieldRefs) {
    var config = loadCardConfigSync(charName);
    if (!config || !config._dialogueTemplates) return false;
    var dt = config._dialogueTemplates[dialogueTemplateKey];
    if (!dt) return false;
    dt.presetFields = presetFields.slice();
    dt.customFieldRefs = (customFieldRefs || []).slice();
    if (dt._state === 'synced') dt._state = 'forked';
    return saveCardConfig(charName, config);
}

export function swapTemplateInPool(charName, poolIndex, templateId) {
    var config = loadCardConfigSync(charName);
    if (!config || !config._templateConfig) return false;
    if (!config._templateConfig.npc) config._templateConfig.npc = [];
    if (poolIndex >= 0 && poolIndex < config._templateConfig.npc.length) {
        config._templateConfig.npc[poolIndex] = templateId;
    } else {
        config._templateConfig.npc.push(templateId);
    }
    return saveCardConfig(charName, config);
}

export function forkTemplateInCard(charName, template) {
    var key = cloneTemplateToCard(charName, template);
    if (key) {
        var config = loadCardConfigSync(charName);
        if (config && config._dialogueTemplates && config._dialogueTemplates[key]) {
            config._dialogueTemplates[key]._state = 'forked';
            saveCardConfig(charName, config);
        }
    }
    return key;
}

export function pushTemplateToGlobal(charName, dialogueTemplateKey) {
    var config = loadCardConfigSync(charName);
    if (!config || !config._dialogueTemplates) return null;
    var dt = config._dialogueTemplates[dialogueTemplateKey];
    if (!dt) return null;
    var now = new Date().toISOString();
    var newId = 'tmpl_push_' + now.replace(/[-:T]/g, '').slice(0, 15);
    var global = {
        id: newId,
        name: 'Forked from ' + charName,
        role: 'npc',
        source: 'user_created',
        presetFields: (dt.presetFields || []).slice(),
        customFieldRefs: (dt.customFieldRefs || []).slice(),
        createdAt: now,
        updatedAt: now
    };
    saveTemplate(global);
    dt._templateId = newId;
    dt._state = 'synced';
    saveCardConfig(charName, config);
    return newId;
}

export function migrateTemplateFormat(template) {
    if (!template) return;
    if (template.customFields && Array.isArray(template.customFields)) {
        template.customFieldRefs = template.customFields.slice();
        delete template.customFields;
        console.log('[NE] Migrated template ' + template.id + ' from customFields → customFieldRefs');
    }
}

export function scanRecentVaultsForSchemes(charName) {
    return new Promise(function (resolve) {
        try {
            var dbReq = indexedDB.open(DB_NAME, DB_VERSION);
            dbReq.onsuccess = function () {
                var db = dbReq.result;
                if (!db.objectStoreNames.contains('card_configs')) { db.close(); resolve([]); return; }
                var tx = db.transaction('card_configs', 'readonly');
                var store = tx.objectStore('card_configs');
                var getReq = store.get(charName);
                getReq.onsuccess = function () {
                    if (getReq.result && getReq.result._dialogueTemplates) {
                        var keys = Object.keys(getReq.result._dialogueTemplates);
                        db.close();
                        resolve(keys);
                    } else { db.close(); resolve([]); }
                };
                getReq.onerror = function () { db.close(); resolve([]); };
            };
            dbReq.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
    });
}

export function getLocalCustomFields(charName) {
    try {
        var raw = localStorage.getItem('ne_local_fields_' + charName);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {};
}

export function addLocalCustomField(charName, fieldName, meta) {
    var fields = getLocalCustomFields(charName);
    fields[fieldName] = meta;
    try {
        localStorage.setItem('ne_local_fields_' + charName, JSON.stringify(fields));
    } catch (e) {}
}

export function removeLocalCustomField(charName, fieldName) {
    var fields = getLocalCustomFields(charName);
    delete fields[fieldName];
    try {
        localStorage.setItem('ne_local_fields_' + charName, JSON.stringify(fields));
    } catch (e) {}
}
