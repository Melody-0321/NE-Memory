/**
 * vault/store.js — IndexedDB vault CRUD
 *
 * 替代 Python vault_store.py 的 JSON 文件读写。
 * 每个 chat_id 对应 IndexedDB 中的一条记录。
 */
const DB_NAME = 'ne_memory_vault';
const DB_VERSION = 4;
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
            if (!db.objectStoreNames.contains('card_configs')) {
                db.createObjectStore('card_configs', { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export { openDB };

var _storageBlocked = false;

/**
 * @returns {boolean}
 */
export function isStorageBlocked() {
    return _storageBlocked;
}

/**
 * @param {string} chatId
 * @returns {Promise<import('../../types.js').Vault|null>}
 */
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
                if (!vault || typeof vault !== 'object' || !vault.chat_id) {
                    console.warn('[NE] IndexedDB vault record corrupted for', chatId, '→ reinitializing');
                    resolve(emptyVault(chatId));
                    return;
                }
                migrateTimeRange(vault);
                ensureCursorState(vault);
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

/**
 * @param {string} chatId
 * @param {import('../../types.js').Vault} vault
 * @returns {Promise<void>}
 */
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

/**
 * @param {string} chatId
 * @param {import('../../types.js').Vault} vault
 * @param {Object} snapshotEntry
 * @returns {Promise<void>}
 */
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

function ensureCursorState(vault) {
    var content = vault.content || {};
    if (!content.cursor_state) {
        content.cursor_state = { stm: { completedTurns: 0, position: 0, pending_partials: [] }, ltm: { position: 0, pending_partials: [] } };
    }
    // Migrate old position-based stm state to completedTurns
    var stm = content.cursor_state.stm;
    if (stm && stm.completedTurns === undefined) {
        stm.completedTurns = stm.position || 0;
    }
}

/**
 * @param {string} chatId
 * @returns {Promise<void>}
 */
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

/**
 * @param {string} chatId
 * @returns {import('../../types.js').Vault}
 */
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
            cursor_state: { stm: { position: 0, pending_partials: [] }, ltm: { position: 0, pending_partials: [] } }
        },
        link_index: {},
        stm_index: {},
        memory_system_prompt: ''
    };
}

/**
 * @param {Array<import('../../types.js').Message>} messages
 * @param {import('../../types.js').Vault} [existingVault]
 * @returns {{vault: import('../../types.js').Vault, newMessages: Array<import('../../types.js').Message>}}
 */
export function mergeVaultFromMessages(messages, existingVault) {
    const vault = existingVault || emptyVault('');
    const processedIds = collectAllMsgIds(vault);
    const newMessages = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const msgId = (msg.id != null) ? msg.id : msg.mes_id;
        if (msgId == null || !processedIds.has(String(msgId))) {
            newMessages.push({ id: msgId != null ? msgId : i, role: msg.is_user ? 'user' : 'assistant', content: msg.mes || '', name: msg.name || '' });
        }
    }
    return { vault, newMessages };
}

/**
 * @param {import('../../types.js').Vault} vault
 * @returns {Set<string>}
 */
export function collectAllMsgIds(vault) {
    const ids = new Set();
    const content = vault.content || {};
    const allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    allSTM.forEach(stm => {
        (stm.msg_ids || []).forEach(id => {
            var sid = String(id);
            ids.add(sid);
            if (sid.startsWith('msg_user_') || sid.startsWith('msg_asst_')) {
                ids.add(sid.replace(/^msg_(?:user|asst)_/, ''));
            }
        });
    });
    return ids;
}

/**
 * @param {Array<import('../../types.js').STMEvent>} entries
 * @returns {Array<import('../../types.js').STMEvent>}
 */
export function sortStmByMsgOrder(entries) {
    if (!entries || entries.length < 2) return entries;
    return entries.slice().sort(function (a, b) {
        var aPos = a.absMsgStart !== undefined ? a.absMsgStart : (a.msgRange && a.msgRange[0] !== undefined ? a.msgRange[0] : Infinity);
        var bPos = b.absMsgStart !== undefined ? b.absMsgStart : (b.msgRange && b.msgRange[0] !== undefined ? b.msgRange[0] : Infinity);
        return aPos - bPos;
    });
}

/**
 * @param {import('../../types.js').Vault} vault
 * @param {Array<import('../../types.js').STMEvent>} stmEntries
 * @returns {number}
 */
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
    stmEntries.sort(function(a, b) {
        return (a.absMsgStart !== undefined ? a.absMsgStart : Infinity) - (b.absMsgStart !== undefined ? b.absMsgStart : Infinity);
    });
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
    console.log('[NE-DIAG] appendSTMEntries — added=' + addedCount + ', total unconsolidated_stm=' + content.unconsolidated_stm.length);
    return addedCount;
}

/**
 * @param {import('../../types.js').Vault} vault
 * @param {(number|string)[]} removedMsgIds
 * @returns {{removedSTM: number, removedLTM: number}}
 */
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

    return updated;
}

// ====== Template Library CRUD (localStorage) ======

/** @returns {import('../../types.js').TemplateLibrary} */
export function loadTemplateLibrary() {
    try {
        var raw = localStorage.getItem('ne_template_library');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { templates: {}, updatedAt: new Date().toISOString() };
}

/** @param {import('../../types.js').TemplateLibrary} lib */
export function saveTemplateLibrary(lib) {
    try {
        lib.updatedAt = new Date().toISOString();
        localStorage.setItem('ne_template_library', JSON.stringify(lib));
    } catch (e) {}
}

/**
 * @param {import('../../types.js').Template} template
 * @returns {boolean}
 */
export function saveTemplate(template) {
    var lib = loadTemplateLibrary();
    template.updatedAt = new Date().toISOString();
    if (!template.createdAt) template.createdAt = template.updatedAt;
    lib.templates[template.id] = template;
    saveTemplateLibrary(lib);
    return true;
}

/**
 * @param {string} templateId
 * @returns {boolean}
 */
export function deleteTemplate(templateId) {
    var lib = loadTemplateLibrary();
    if (!lib.templates[templateId]) return false;
    delete lib.templates[templateId];
    saveTemplateLibrary(lib);
    return true;
}

/**
 * @param {string} templateId
 * @returns {import('../../types.js').Template|null}
 */
export function getTemplate(templateId) {
    var lib = loadTemplateLibrary();
    return lib.templates[templateId] || null;
}

// ====== Card-Level Template Configuration (localStorage + IndexedDB dual) ======

/**
 * @param {string} charName
 * @returns {import('../../types.js').CardConfig|null}
 */
export function loadCardConfig(charName) {
    try {
        var raw = localStorage.getItem('ne_card_templates_' + charName);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    try {
        var dbReq = indexedDB.open(DB_NAME, DB_VERSION);
        return new Promise(function(resolve) {
            dbReq.onsuccess = function() {
                var db = dbReq.result;
                var tx = db.transaction('card_configs', 'readonly');
                var store = tx.objectStore('card_configs');
                var getReq = store.get(charName);
                getReq.onsuccess = function() {
                    if (getReq.result) {
                        var config = getReq.result;
                        delete config.id;
                        try {
                            localStorage.setItem('ne_card_templates_' + charName, JSON.stringify(config));
                        } catch (e) {}
                        resolve(config);
                    } else {
                        resolve(null);
                    }
                    db.close();
                };
                getReq.onerror = function() { resolve(null); db.close(); };
            };
            dbReq.onerror = function() { resolve(null); };
        });
    } catch (e) {
        return null;
    }
}

/**
 * Load card config synchronously (from localStorage only, for hot paths).
 * @param {string} charName
 * @returns {import('../../types.js').CardConfig|null}
 */
export function loadCardConfigSync(charName) {
    try {
        var raw = localStorage.getItem('ne_card_templates_' + charName);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

/**
 * @param {string} charName
 * @param {import('../../types.js').CardConfig} config
 * @returns {boolean}
 */
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
                console.warn('[NE] Card config version conflict for', charName,
                    'expected <', nextVersion, 'got', existing._version, '— skipping write');
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
        dbReq.onsuccess = function() {
            var db = dbReq.result;
            var tx = db.transaction('card_configs', 'readwrite');
            var store = tx.objectStore('card_configs');
            var toStore = Object.assign({ id: charName }, config);
            store.put(toStore);
            tx.oncomplete = function() { db.close(); };
        };
        dbReq.onerror = function() {
            console.warn('[NE] IndexedDB write failed for card_config:', charName);
        };
    } catch (e) {
        console.warn('[NE] IndexedDB write failed for', charName, e.message);
    }

    return true;
}

/**
 * @param {string} charName
 */
export function deleteCardConfig(charName) {
    try { localStorage.removeItem('ne_card_templates_' + charName); } catch (e) {}
    try {
        var dbReq = indexedDB.open(DB_NAME, DB_VERSION);
        dbReq.onsuccess = function() {
            var db = dbReq.result;
            var tx = db.transaction('card_configs', 'readwrite');
            var store = tx.objectStore('card_configs');
            store.delete(charName);
            tx.oncomplete = function() { db.close(); };
        };
    } catch (e) {}
}

// ====== Field Library Operations ======

/** @returns {import('../../types.js').FieldLibrary} */
export function loadFieldLibrary() {
    try {
        var raw = localStorage.getItem('ne_field_library');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { fields: {}, updatedAt: new Date().toISOString() };
}

/** @param {import('../../types.js').FieldLibrary} lib */
export function saveFieldLibrary(lib) {
    try {
        lib.updatedAt = new Date().toISOString();
        localStorage.setItem('ne_field_library', JSON.stringify(lib));
    } catch (e) {}
}

/**
 * @param {string} fieldName
 * @param {import('../../types.js').FieldLibraryEntry} entry
 */
export function addFieldToLibrary(fieldName, entry) {
    var lib = loadFieldLibrary();
    var now = new Date().toISOString();
    entry.updatedAt = now;
    if (!entry.createdAt) entry.createdAt = now;
    if (!entry.usedByTemplates) entry.usedByTemplates = [];
    lib.fields[fieldName] = entry;
    saveFieldLibrary(lib);
}

/**
 * @param {string} fieldName
 * @returns {boolean}
 */
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

/**
 * @param {string} fieldName
 * @returns {import('../../types.js').FieldLibraryEntry|null}
 */
export function getFieldFromLibrary(fieldName) {
    var lib = loadFieldLibrary();
    return lib.fields[fieldName] || null;
}

// ====== Reference Tracking ======

/**
 * @param {string} fieldName
 * @param {string} templateId
 */
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

/**
 * @param {string} fieldName
 * @param {string} templateId
 */
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

/**
 * Clone a global template into a character card's dialogue templates.
 * @param {string} charName
 * @param {import('../../types.js').Template} template
 * @returns {string} The dialogue template key
 */
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

/**
 * Get active version (latest by createdAt) of a template within a card's dialogue templates.
 * @param {Object<string, import('../../types.js').DialogueTemplate>} dialogueTemplates
 * @param {string} templateId
 * @returns {import('../../types.js').DialogueTemplate|null}
 */
export function getActiveVersion(dialogueTemplates, templateId) {
    var matches = [];
    Object.keys(dialogueTemplates).forEach(function(k) {
        var t = dialogueTemplates[k];
        if (t._templateId === templateId) matches.push(t);
    });
    if (matches.length === 0) return null;
    matches.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    return matches[0];
}

/**
 * Upgrade all non-locked characters pointing to the old latest version to the new version.
 * Called after AI or user creates a new template version.
 * @param {import('../../types.js').State} state
 * @param {string} oldKey - The previous active version key
 * @param {string} newKey - The new version key (just created)
 * @param {string} [lockedCharName] - Optional: char locked, skip notification for them
 */
export function upgradeTemplateVersion(state, oldKey, newKey, lockedCharName) {
    if (!state || !state.characters) return;
    var lockedNames = [];
    Object.keys(state.characters).forEach(function(name) {
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

// ====== #10: 模板→字段引用操作 ======

/**
 * Register a field reference into a template's customFieldRefs.
 * @param {string} templateId
 * @param {string} fieldName
 */
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

/**
 * Remove a field reference from a template's customFieldRefs.
 * @param {string} templateId
 * @param {string} fieldName
 */
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

// ====== #10a: 角色卡级模板操作 ======

/**
 * Edit a dialog template's field composition within a card.
 * Synchronizes: if _state === 'synced', marks as 'forked'.
 * @param {string} charName
 * @param {string} dialogueTemplateKey
 * @param {string[]} presetFields
 * @param {string[]} customFieldRefs
 */
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

/**
 * Swap a template in the NPC template pool at a given index.
 * Updates _templateConfig.npc[index].
 * @param {string} charName
 * @param {number} poolIndex
 * @param {string} templateId — global template id
 */
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

/**
 * Fork a global template into a card's dialogue templates, marking as 'forked'.
 * Same as cloneTemplateToCard but sets _state = 'forked'.
 * @param {string} charName
 * @param {import('../../types.js').Template} template
 * @returns {string} The dialogue template key
 */
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

/**
 * Push a card-local dialog template back to the global template library.
 * Creates a new global template from the dialog template's configuration.
 * @param {string} charName
 * @param {string} dialogueTemplateKey
 * @returns {string|null} New global template ID, or null on failure
 */
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

// ====== #8: 旧模板迁移 ======

/**
 * Migrate old template format (customFields array) to new (customFieldRefs).
 * Called by saveTemplate automatically on first load of an old-format template.
 * @param {import('../../types.js').Template} template
 */
export function migrateTemplateFormat(template) {
    if (!template) return;
    if (template.customFields && Array.isArray(template.customFields)) {
        template.customFieldRefs = template.customFields.slice();
        delete template.customFields;
        console.log('[NE] Migrated template ' + template.id + ' from customFields → customFieldRefs');
    }
}

// ====== #14: 跨vault扫描 ======

/**
 * Scan IndexedDB vaults for schemes used with a given character name.
 * Returns deduplicated scheme keys found across vaults.
 * @param {string} charName
 * @returns {Promise<string[]>}
 */
export function scanRecentVaultsForSchemes(charName) {
    return new Promise(function(resolve) {
        try {
            var dbReq = indexedDB.open(DB_NAME, DB_VERSION);
            dbReq.onsuccess = function() {
                var db = dbReq.result;
                if (!db.objectStoreNames.contains('card_configs')) { db.close(); resolve([]); return; }
                var tx = db.transaction('card_configs', 'readonly');
                var store = tx.objectStore('card_configs');
                var getReq = store.get(charName);
                getReq.onsuccess = function() {
                    if (getReq.result && getReq.result._dialogueTemplates) {
                        var keys = Object.keys(getReq.result._dialogueTemplates);
                        db.close();
                        resolve(keys);
                    } else { db.close(); resolve([]); }
                };
                getReq.onerror = function() { db.close(); resolve([]); };
            };
            dbReq.onerror = function() { resolve([]); };
        } catch (e) { resolve([]); }
    });
}

// ====== #36: per-character local custom fields ======

/**
 * Get per-character local custom fields (pending AI proposals).
 * @param {string} charName
 * @returns {Object<string, {type: string, description: string, source: string}>}
 */
export function getLocalCustomFields(charName) {
    try {
        var raw = localStorage.getItem('ne_local_fields_' + charName);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {};
}

/**
 * Add a local custom field proposal for a character (pending user confirmation).
 * @param {string} charName
 * @param {string} fieldName
 * @param {{type: string, description: string, source: string}} meta
 */
export function addLocalCustomField(charName, fieldName, meta) {
    var fields = getLocalCustomFields(charName);
    fields[fieldName] = meta;
    try {
        localStorage.setItem('ne_local_fields_' + charName, JSON.stringify(fields));
    } catch (e) {}
}

/**
 * Remove a local custom field after user confirms or rejects.
 * @param {string} charName
 * @param {string} fieldName
 */
export function removeLocalCustomField(charName, fieldName) {
    var fields = getLocalCustomFields(charName);
    delete fields[fieldName];
    try {
        localStorage.setItem('ne_local_fields_' + charName, JSON.stringify(fields));
    } catch (e) {}
}

