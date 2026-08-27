// vault-authority.test.js — 聊天文件恒定权威回归测试：
//   A. 聊天文件有 ne_vault（即使 version 更旧）→ 恒胜，IndexedDB 仅作缓存被覆盖
//   B. 聊天文件无 ne_vault、IndexedDB 有存量 → 回退读存量并一次性回填聊天文件
//   C. 两侧皆空 → fresh start，空 vault，不回填
//   D. 聊天文件有 ne_vault、IndexedDB 空 → 直接返回聊天文件权威
//
// 环境依赖：Node 无 indexedDB，本文件内置轻量 memory IndexedDB mock
// （open/onupgradeneeded/transaction/get/put，异步 microtask settle，
//  覆盖 store.js openRawDB 建库 + readState/readMemory/writeState/writeMemory 契约）。

if (typeof localStorage === 'undefined') {
    var _store = {};
    globalThis.localStorage = {
        getItem: function(k) { return _store.hasOwnProperty(k) ? _store[k] : null; },
        setItem: function(k, v) { _store[k] = String(v); },
        removeItem: function(k) { delete _store[k]; },
        clear: function() { _store = {}; },
        get length() { return Object.keys(_store).length; },
        key: function(i) { return Object.keys(_store)[i] || null; }
    };
}

// ====== 轻量 memory IndexedDB mock ======
function _mkReq(operate) {
    var r = { onsuccess: null, onerror: null, result: undefined, error: null };
    queueMicrotask(function () {
        try {
            if (operate) r.result = operate();
            if (r.onsuccess) r.onsuccess({ target: r });
        } catch (e) {
            r.error = e;
            if (r.onerror) r.onerror({ target: r });
        }
    });
    return r;
}

function FakeObjectStore(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.records = new Map();
    this._indexDefs = {};
}
FakeObjectStore.prototype.createIndex = function (idxName, keyPath) {
    this._indexDefs[idxName] = keyPath;
    return { name: idxName };
};
FakeObjectStore.prototype.index = function () {
    throw new Error('FakeObjectStore.index(cursor) not supported in mock');
};
FakeObjectStore.prototype.get = function (key) {
    var s = this;
    return _mkReq(function () { return s.records.get(key); });
};
FakeObjectStore.prototype.put = function (value) {
    var s = this;
    return _mkReq(function () {
        var k = value[s.keyPath];
        s.records.set(k, value);
        return k;
    });
};
FakeObjectStore.prototype.delete = function (key) {
    var s = this;
    return _mkReq(function () { s.records.delete(key); });
};

function FakeDB(name, version, prev) {
    this.name = name;
    this.version = version;
    this._stores = prev ? prev._stores : {};
    var self = this;
    this.objectStoreNames = { contains: function (n) { return Object.prototype.hasOwnProperty.call(self._stores, n); } };
    this.onversionchange = null;
    this.onclose = null;
}
FakeDB.prototype.createObjectStore = function (name, opts) {
    this._stores[name] = new FakeObjectStore(name, opts && opts.keyPath);
    return this._stores[name];
};
FakeDB.prototype.deleteObjectStore = function (name) { delete this._stores[name]; };
FakeDB.prototype.transaction = function (storeNames, mode) {
    var db = this;
    var t = { mode: mode, error: null, oncomplete: null, onerror: null, onabort: null };
    t.objectStore = function (name) { return db._stores[name]; };
    Promise.resolve().then(function () {
        if (t.oncomplete) t.oncomplete({ target: t });
    });
    return t;
};
FakeDB.prototype.close = function () {};
FakeDB.prototype.__clearStores = function () { this._stores = {}; };

var _fakeDbs = {};
var fakeIndexedDB = {
    open: function (name, version) {
        var req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null, error: null };
        queueMicrotask(function () {
            var db = _fakeDbs[name];
            if (!db || db.version < version) {
                db = new FakeDB(name, version, db);
                _fakeDbs[name] = db;
                if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: db, oldVersion: 0 } });
            }
            req.result = db;
            if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
    }
};
globalThis.indexedDB = fakeIndexedDB;

import { loadVault } from '../src/core/auto-restore.js';
import { readState, readMemory, writeState, writeMemory, readVault, STATE_CONTENT_FIELDS } from '../src/core/vault/store.js';
import { runtime } from '../src/core/runtime.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

// ====== runtime mock ======
var metadata = { ne_vault: null };
var saveChatCalls = 0;
runtime.getChatMetadata = function () { return metadata; };
runtime.saveChat = function () { saveChatCalls++; return Promise.resolve(); };

function resetEnv() {
    metadata.ne_vault = null;
    saveChatCalls = 0;
    var db = _fakeDbs['ne_memory_vault'];
    if (db) {
        Object.keys(db._stores).forEach(function (n) { db._stores[n].records.clear(); });
    }
}

function splitContent(content) {
    var stateContent = {};
    var stateSet = new Set(STATE_CONTENT_FIELDS);
    var memContent = {};
    Object.keys(content).forEach(function (k) {
        if (stateSet.has(k)) stateContent[k] = content[k];
        else memContent[k] = content[k];
    });
    return { stateContent: stateContent, memContent: memContent };
}

async function seedIdb(cid, version, content) {
    var split = splitContent(content);
    var stateVault = {
        chat_id: cid, version: version, tokens: 0, updated_at: '2026-08-16T10:00:00.000Z',
        _meta: { created_at: '2026-08-16T10:00:00.000Z', last_state_task: null, last_state_time: null },
        content: split.stateContent
    };
    var memVault = {
        chat_id: cid, version: version, tokens: 0, updated_at: '2026-08-16T10:00:00.000Z',
        _meta: { created_at: '2026-08-16T10:00:00.000Z', last_pipeline_task: null, last_pipeline_time: null },
        content: split.memContent, stm_index: {}, link_index: {}, memory_system_prompt: ''
    };
    await writeState(cid, stateVault);
    await writeMemory(cid, memVault);
}

function baseContent(marker) {
    var c = {
        unconsolidated_stm: [],
        stm_entries: [{ id: 1, text: 'stm_' + marker }],
        ltm_entries: [],
        cursor_state: { stm: { position: 0, pending_partials: [], completedTurns: 0 }, ltm: { position: 0, pending_partials: [] } },
        segment_counter: 0,
        meta_ltm_entries: [],
        suspense_entries: [],
        suspense_cursor: null,
        state: { marker: marker },
        story_time: '', story_scene: '', story_date: '',
        state_schema: null, state_css: '', character_schema: null,
        _active_characters: [], faction_keywords: {}
    };
    return c;
}

function chatVaultOf(cid, version, content) {
    return {
        chat_id: cid, version: version, tokens: 0, updated_at: '2026-08-16T11:00:00.000Z',
        _meta: { created_at: '2026-08-16T11:00:00.000Z' },
        content: JSON.parse(JSON.stringify(content)),
        stm_index: {}, link_index: {}, memory_system_prompt: ''
    };
}

var CID = 'authority_test_chat';

// ====== 场景 A：聊天文件恒胜——即使其 version 更旧，也覆盖更新的 IndexedDB ======
console.log('\n=== vault-authority A: chat authoritative wins over newer IDB ===');
resetEnv();
{
    await seedIdb(CID, 5, baseContent('IDB'));                      // IDB version 5 (newer)
    metadata.ne_vault = JSON.stringify(chatVaultOf(CID, 3, baseContent('CHAT'))); // chat version 3 (older)
    var outA = await loadVault(CID);
    eq(outA.version, 3, 'A: returns chat vault version (3), not IDB higher version');
    eq(outA.content.state.marker, 'CHAT', 'A: chat content wins over IDB content');
    eq(saveChatCalls, 0, 'A: no backfill saveChat when chat authoritative');
    // IDB 缓存被聊天文件权威覆盖
    var stA = await readState(CID);
    var mmA = await readMemory(CID);
    eq(stA.content.state.marker, 'CHAT', 'A: IDB state cache overwritten by chat');
    eq(mmA.content.stm_entries[0].text, 'stm_CHAT', 'A: IDB memory cache overwritten by chat');
}

// ====== 场景 B：聊天文件空、IndexedDB 有存量 → 回退存量并一次性回填聊天文件 ======
console.log('\n=== vault-authority B: empty chat, IDB present → backfill to chat file ===');
resetEnv();
{
    await seedIdb(CID, 7, baseContent('IDB'));
    var before = saveChatCalls;
    var outB = await loadVault(CID);
    eq(outB.version, 7, 'B: returns IDB v7 when chat empty');
    eq(outB.content.state.marker, 'IDB', 'B: returns IDB content');
    ok(saveChatCalls === before + 1, 'B: one-time backfill saveChat called');
    var chatB = JSON.parse(metadata.ne_vault);
    eq(chatB.content.state.marker, 'IDB', 'B: chat file now holds IDB data (becomes authority)');
}

// ====== 场景 C：两侧皆空 → fresh start，空 vault，不回填 ======
console.log('\n=== vault-authority C: both empty → fresh start, no backfill ===');
resetEnv();
{
    var beforeC = saveChatCalls;
    var outC = await loadVault(CID);
    eq(outC.version, 0, 'C: empty vault version 0');
    ok(metadata.ne_vault === null, 'C: chat metadata not created');
    eq(saveChatCalls, beforeC, 'C: no saveChat on fresh start');
}

// ====== 场景 D：聊天文件有 ne_vault、IndexedDB 空 → 直接返回聊天文件权威 ======
console.log('\n=== vault-authority D: chat present, IDB empty → chat returns directly ===');
resetEnv();
{
    metadata.ne_vault = JSON.stringify(chatVaultOf(CID, 2, baseContent('CHAT')));
    var outD = await loadVault(CID);
    eq(outD.version, 2, 'D: returns chat v2');
    eq(outD.content.state.marker, 'CHAT', 'D: chat content');
    var mmD = await readMemory(CID);
    eq(mmD.content.stm_entries[0].text, 'stm_CHAT', 'D: IDB memory cache written from chat');
}

console.log('\n=== vault-authority: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);