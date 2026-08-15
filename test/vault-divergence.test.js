// vault-divergence.test.js — 双存储等版本·异内容裁决（_reconcileDivergence）集成测试：
//   A. 等版本·同内容（hash 一致）→ 直接返回，不裁决（version 不变、无告警）
//   B. 等版本·异内容·IDB 持久化 updated_at 较新 → IDB 胜，version+1，双侧同步
//   C. 等版本·异内容·chat 较新 → chat 胜（验证择新用持久化 updated_at 而非 readVault 的 now），
//      且绝不合并内容（输家独有键不残留）
//   D. 时间戳相等 → IDB 胜（idbT >= chatT tie-break）
//   E. 裁决收敛后再次 loadVault → 无二次裁决、version 稳定
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
    // 事务完成事件排在同批 request microtask 之后
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

import { loadVault, computeVaultContentHash } from '../src/core/auto-restore.js';
import { readState, readMemory, writeState, writeMemory, readVault, STATE_CONTENT_FIELDS } from '../src/core/vault/store.js';
import { runtime } from '../src/core/runtime.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

// ====== runtime mock ======
var metadata = { ne_vault: null };
var notifyCalls = [];
var saveChatCalls = 0;
runtime.getChatMetadata = function () { return metadata; };
runtime.saveChat = function () { saveChatCalls++; return Promise.resolve(); };
runtime.notify = function (msg) { notifyCalls.push(String(msg)); };

function resetEnv() {
    metadata.ne_vault = null;
    notifyCalls = [];
    saveChatCalls = 0;
    var db = _fakeDbs['ne_memory_vault'];
    if (db) {
        // 清记录不删 store（_dbPromise 连接缓存复用同一 db 实例）
        Object.keys(db._stores).forEach(function (n) { db._stores[n].records.clear(); });
    }
}

// ====== 测试基建：拆分写 IDB / 构造 chat 侧 vault ======
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

async function seedIdb(cid, version, updatedAt, content) {
    var split = splitContent(content);
    var stateVault = {
        chat_id: cid, version: version, tokens: 0, updated_at: updatedAt,
        _meta: { created_at: updatedAt, last_state_task: null, last_state_time: null },
        content: split.stateContent
    };
    var memVault = {
        chat_id: cid, version: version, tokens: 0, updated_at: updatedAt,
        _meta: { created_at: updatedAt, last_pipeline_task: null, last_pipeline_time: null },
        content: split.memContent, stm_index: {}, link_index: {}, memory_system_prompt: ''
    };
    await writeState(cid, stateVault);
    await writeMemory(cid, memVault);
}

function chatVaultOf(cid, version, updatedAt, content) {
    return {
        chat_id: cid, version: version, tokens: 0, updated_at: updatedAt,
        _meta: { created_at: updatedAt, content_hash: computeVaultContentHash(content) },
        content: JSON.parse(JSON.stringify(content)),
        stm_index: {}, link_index: {}, memory_system_prompt: ''
    };
}

// 基准内容：state 侧 markerA + onlyInA；memory 侧 stm_entries
function baseContent(marker, withOnly) {
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
    if (withOnly) c.state.onlyInA = 'x';
    return c;
}

// readVault 合并重建 content（含补默认键），保证键序与 hash 比对同路
async function rebuiltContent(cid) {
    var v = await readVault(cid);
    return v.content;
}

var CID = 'divergence_test_chat';
var T1 = '2026-08-16T10:00:00.000Z';
var T2 = '2026-08-16T11:00:00.000Z';

// ====== 场景 A：等版本·同内容 → 不裁决 ======
console.log('\n=== vault-divergence A: same version, same content — no reconcile ===');
resetEnv();
{
    await seedIdb(CID, 5, T1, baseContent('A', true));
    var X = await rebuiltContent(CID);
    metadata.ne_vault = JSON.stringify(chatVaultOf(CID, 5, T1, X));
    var outA = await loadVault(CID);
    eq(outA.version, 5, 'A: version untouched');
    eq(notifyCalls.length, 0, 'A: no divergence notify');
    eq(saveChatCalls, 0, 'A: no saveChat (in sync)');
}

// ====== 场景 B：等版本·异内容·IDB 较新 → IDB 胜 ======
console.log('\n=== vault-divergence B: divergence, IDB newer — IDB wins ===');
resetEnv();
{
    await seedIdb(CID, 5, T2, baseContent('A', true));           // IDB: updated_at T2 (newer)
    var XB = await rebuiltContent(CID);
    var chatContentB = JSON.parse(JSON.stringify(XB));
    chatContentB.state.marker = 'B';                              // 制造内容分歧
    metadata.ne_vault = JSON.stringify(chatVaultOf(CID, 5, T1, chatContentB)); // chat: T1 (older)
    var before = saveChatCalls;
    var outB = await loadVault(CID);
    eq(outB.version, 6, 'B: version bumped to 6');
    eq(outB.content.state.marker, 'A', 'B: IDB content wins');
    ok(notifyCalls.length === 1 && notifyCalls[0].indexOf('v6') >= 0, 'B: divergence notify with v6');
    ok(saveChatCalls === before + 1, 'B: winner persisted to chat file');
    // IDB 侧同步验证
    var stB = await readState(CID);
    eq(stB.version, 6, 'B: IDB state vault at v6');
    eq(stB.content.state.marker, 'A', 'B: IDB keeps its own content');
    // chat 侧同步验证
    var chatB = JSON.parse(metadata.ne_vault);
    eq(chatB.version, 6, 'B: chat metadata at v6');
    eq(chatB.content.state.marker, 'A', 'B: chat metadata synced to IDB content');
    eq(chatB._meta.content_hash, computeVaultContentHash(outB.content), 'B: chat hash matches winner content');
}

// ====== 场景 C：chat 较新 → chat 胜（择新必须用持久化 updated_at，而非 readVault 的 now）======
console.log('\n=== vault-divergence C: divergence, chat newer — chat wins (no merge) ===');
resetEnv();
{
    await seedIdb(CID, 5, T1, baseContent('A', true));            // IDB: T1 (older, persisted)
    var XC = await rebuiltContent(CID);
    var chatContentC = JSON.parse(JSON.stringify(XC));
    chatContentC.state.marker = 'B';                              // B 内容：改 marker + 删 onlyInA + 加 ltm
    delete chatContentC.state.onlyInA;
    chatContentC.ltm_entries = [{ id: 9, text: 'ltm_B' }];
    metadata.ne_vault = JSON.stringify(chatVaultOf(CID, 5, T2, chatContentC)); // chat: T2 (newer)
    // 注意：readVault 会把 dbVault.updated_at 覆盖为 now —— 若实现误用 dbVault.updated_at，
    // IDB 将永远"较新"而误胜。正确实现用 stateVault/memVault 的持久化 T1。
    var outC = await loadVault(CID);
    eq(outC.version, 6, 'C: version bumped to 6');
    eq(outC.content.state.marker, 'B', 'C: chat content wins');
    eq(outC.content.ltm_entries.length, 1, 'C: chat ltm_entries carried');
    ok(notifyCalls.length === 1, 'C: exactly one divergence notify');
    // 绝不合并：输家（IDB）独有键不得残留
    eq(outC.content.state.onlyInA, undefined, 'C: loser-only key not merged in');
    // IDB 侧被 winner 覆盖
    var stC = await readState(CID);
    var mmC = await readMemory(CID);
    eq(stC.version, 6, 'C: IDB state vault at v6');
    eq(stC.content.state.marker, 'B', 'C: IDB state overwritten by chat winner');
    eq(stC.content.state.onlyInA, undefined, 'C: IDB loser-only key gone');
    eq(mmC.content.ltm_entries.length, 1, 'C: IDB memory overwritten (ltm from chat)');
    eq(mmC.content.stm_entries[0].text, 'stm_A', 'C: IDB memory keeps shared stm (same in both sides)');
}

// ====== 场景 D：时间戳相等 → IDB 胜（tie-break: idbT >= chatT）======
console.log('\n=== vault-divergence D: equal timestamps — IDB wins by tie-break ===');
resetEnv();
{
    await seedIdb(CID, 5, T1, baseContent('A', true));
    var XD = await rebuiltContent(CID);
    var chatContentD = JSON.parse(JSON.stringify(XD));
    chatContentD.state.marker = 'B';
    metadata.ne_vault = JSON.stringify(chatVaultOf(CID, 5, T1, chatContentD)); // 同 T1
    var outD = await loadVault(CID);
    eq(outD.version, 6, 'D: version bumped to 6');
    eq(outD.content.state.marker, 'A', 'D: IDB wins on equal updated_at');
}

// ====== 场景 E：裁决收敛后再次 loadVault → 稳定，无二次裁决 ======
console.log('\n=== vault-divergence E: converged — second load is stable ===');
{
    notifyCalls = []; // 清场景 D 的历史告警，E 只统计自己的
    var outE = await loadVault(CID);
    eq(outE.version, 6, 'E: version stays 6 (no re-reconcile)');
    eq(notifyCalls.length, 0, 'E: no new divergence notify');
    var outE2 = await loadVault(CID);
    eq(outE2.version, 6, 'E: third load still v6');
}

console.log('\n=== vault-divergence: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
