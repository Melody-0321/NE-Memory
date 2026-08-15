/**
 * state-versions.js — 统一版本链引擎
 *
 * State 和 Memory（STM/LTM）使用相同的底层 Delta 版本管理机制。
 * 每个管线产出不再全量拷贝 50-200KB vault，而是记录 160B~1.5KB 的 delta。
 *
 * IndexedDB ObjectStores:
 *   state_deltas      keyPath: "id"
 *   memory_versions   keyPath: "id"
 *   active_chains     keyPath: "chat_id"
 */

import { openDB, readState, writeState, readMemory, writeMemory, STATE_STORE, MEMORY_STORE } from './store.js';

var COMPACT_THRESHOLD = 100;
var MAX_ACTIVE_VERSIONS = 500;

function _getVersionLimit(key) {
    try {
        var cfg = JSON.parse(localStorage.getItem('ne_version_config') || '{}');
        return cfg[key] || COMPACT_THRESHOLD;
    } catch (e) { return COMPACT_THRESHOLD; }
}

function _tx(db, stores, mode, fn) {
    return new Promise(function (resolve, reject) {
        var tx = db.transaction(stores, mode);
        var request;
        try { request = fn(tx); } catch (e) { reject(e); return; }
        tx.oncomplete = function () {
            if (request && typeof request === 'object' && 'result' in request) {
                resolve(request.result);
            } else {
                resolve(request);
            }
        };
        tx.onerror = function () { reject(tx.error); };
    });
}

function _generateId(prefix, chatId, seq) {
    return prefix + '_' + chatId + '_' + seq;
}

/**
 * D6: 单次 readonly 事务取回某 chat 的全部 delta/version（走 chat_id index）
 */
function _getAllByChatIndex(db, store, chatId) {
    return _tx(db, [store], 'readonly', function (tx) {
        return tx.objectStore(store).index('chat_id').getAll(chatId);
    });
}

/**
 * D2: 计算 compact 折叠后应删除的旧 seq（active 中 < headSeq 的非 head 项）
 *
 * @param {number[]} activeSeqs — 折叠前 state_active / mem_active 快照
 * @param {number} headSeq — 折叠目标 seq（保留，含 folded_* 字段）
 * @returns {number[]}
 */
export function computeCompactDeleteSeqs(activeSeqs, headSeq) {
    return (activeSeqs || []).filter(function (s) {
        return s !== headSeq && s < headSeq;
    });
}

/**
 * 评估回滚目标在版本链中的可行性（折叠归档守卫，D2 配套）
 *
 * - 'invalid_target'：目标 >= head 或 < 0（不存在或越界）
 * - 'archived'：目标不在 active 链中（已压缩归档）。此时回滚会把 head 也当成
 *   孤儿项删除并清空链（base_seq=0），破坏版本链 — 必须拒绝
 * - 'ok'：目标在 active 链中，可正常回滚
 *
 * @param {number[]} activeSeqs — state_active / mem_active
 * @param {number} headSeq — state_head_seq / mem_head_seq
 * @param {number} targetSeq
 * @returns {'invalid_target'|'archived'|'ok'}
 */
export function evaluateRollbackTarget(activeSeqs, headSeq, targetSeq) {
    if (targetSeq >= headSeq || targetSeq < 0) return 'invalid_target';
    if (activeSeqs.indexOf(targetSeq) === -1) return 'archived';
    return 'ok';
}

/**
 * 链一致性体检（纯函数）：active 引用 vs 实际存在的记录
 *
 * seq 0 为链根哨兵，永无记录，不计悬空。
 * orphans 只报告计数，不影响 status（孤儿不破坏 fold/回滚）。
 *
 * @param {number[]} activeSeqs — chain.state_active / mem_active
 * @param {number} headSeq — chain.state_head_seq / mem_head_seq
 * @param {number[]} existingSeqs — store 中该 chat 实际存在的 seq 列表
 * @returns {{status:'ok'|'dangling_active', dangling:number[], headMissing:boolean, orphans:number[]}}
 */
export function diagnoseChainRefs(activeSeqs, headSeq, existingSeqs) {
    var active = activeSeqs || [];
    var existing = existingSeqs || [];
    var existingSet = new Set(existing);
    var dangling = [];
    for (var i = 0; i < active.length; i++) {
        var s = active[i];
        if (s !== 0 && !existingSet.has(s)) dangling.push(s);
    }
    var headMissing = headSeq !== 0 && (!existingSet.has(headSeq) || active.indexOf(headSeq) === -1);
    var activeSet = new Set(active);
    var orphans = [];
    for (var j = 0; j < existing.length; j++) {
        if (!activeSet.has(existing[j])) orphans.push(existing[j]);
    }
    return {
        status: (dangling.length > 0 || headMissing) ? 'dangling_active' : 'ok',
        dangling: dangling,
        headMissing: headMissing,
        orphans: orphans
    };
}

/**
 * 保守修复（纯函数）：截断到第一个悬空 seq，保留连续前缀。
 *
 * fold 按 active 数组顺序迭代且静默跳过缺失项，中段悬空会让回滚结果
 * 无声丢数据 — 因此必须截断到第一个悬空前，不能「过滤保留仍存在的」
 * （后者会留下中段洞）。绝不推测内容、绝不重排。
 *
 * @param {number[]} activeSeqs
 * @param {number} headSeq
 * @param {number} baseSeq
 * @param {number[]} existingSeqs
 * @returns {{newActive:number[], newHead:number, newBase:number, dropped:number[]}}
 *   无悬空时 dropped=[]（no-op，但 head 仍归位为 active 末位）。
 */
export function computeConservativeRepair(activeSeqs, headSeq, baseSeq, existingSeqs) {
    var active = activeSeqs || [];
    var existingSet = new Set(existingSeqs || []);
    var cutIdx = -1;
    for (var i = 0; i < active.length; i++) {
        var s = active[i];
        if (s !== 0 && !existingSet.has(s)) { cutIdx = i; break; }
    }
    var newActive = cutIdx < 0 ? active.slice() : active.slice(0, cutIdx);
    var dropped = cutIdx < 0 ? [] : active.slice(cutIdx);
    var newHead = newActive.length > 0 ? newActive[newActive.length - 1] : 0;
    var newBase = newActive.length > 0 ? newActive[0] : 0;
    return { newActive: newActive, newHead: newHead, newBase: newBase, dropped: dropped };
}

function _nowISO() {
    return new Date().toISOString();
}

/**
 * @param {string[]} changes — [{ path, old, new }]
 * @returns {string}
 */
function buildStateDeltaSummary(changes) {
    if (!changes || !changes.length) return '';
    var parts = [];
    for (var i = 0; i < Math.min(changes.length, 5); i++) {
        var c = changes[i];
        var fieldName = c.path.split('.').pop();
        var oldBrief = String(c.old || '').substring(0, 15);
        var newBrief = String(c.new || '').substring(0, 15);
        parts.push(fieldName + '：' + oldBrief + '→' + newBrief);
    }
    if (changes.length > 5) parts.push('...等' + changes.length + '项');
    return parts.join('，');
}

function buildMemoryVersionSummary(version) {
    var parts = [];
    if (version.delta.stm_added && version.delta.stm_added.length) {
        parts.push(version.delta.stm_added.length + '条新STM');
    }
    if (version.delta.stm_moved && version.delta.stm_moved.length) {
        parts.push(version.delta.stm_moved.length + '条STM已巩固');
    }
    if (version.delta.ltm_added && version.delta.ltm_added.length) {
        parts.push(version.delta.ltm_added.length + '个新LTM arc');
    }
    if (version.delta.ltm_removed && version.delta.ltm_removed.length) {
        parts.push('移除' + version.delta.ltm_removed.length + '个LTM');
    }
    return parts.join('，') || '无变更';
}

function _emptyStateDelta(chatId) {
    return {
        id: '',
        chat_id: chatId,
        seq: 0,
        prev_seq: 0,
        timestamp: _nowISO(),
        source: 'init',
        summary: '初始状态',
        changes: [],
        message_dates: [],
        derived_from_stm_version: null
    };
}

function _emptyMemoryVersion(chatId) {
    return {
        id: '',
        chat_id: chatId,
        seq: 0,
        prev_seq: 0,
        timestamp: _nowISO(),
        type: 'init',
        summary: '初始记忆',
        delta: { stm_added: [], stm_removed: [], stm_moved: [], ltm_added: [], ltm_removed: [], ltm_modified: [] },
        message_dates: [],
        derived_from_stm_version: null
    };
}

function _emptyChain(chatId) {
    return { chat_id: chatId, state_head_seq: 0, state_base_seq: 0, state_active: [0], mem_head_seq: 0, mem_base_seq: 0, mem_active: [0], _global_state_seq: 0, _global_mem_seq: 0 };
}

// P1-6: 原型链保留键，防止 __proto__/constructor/prototype path 触发原型污染
function _isReservedKey(key) {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function _setByPath(obj, path, value) {
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length - 1; i++) {
        var key = parts[i];
        if (_isReservedKey(key)) return;
        if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    var lastKey = parts[parts.length - 1];
    if (_isReservedKey(lastKey)) return;
    current[lastKey] = value;
}

function _getByPath(obj, path) {
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
        if (current === undefined || current === null) return undefined;
        if (_isReservedKey(parts[i])) return undefined;
        current = current[parts[i]];
    }
    return current;
}

/**
 * @param {string} chatId
 * @returns {Promise<{state: object, mem: {stm_entries, unconsolidated_stm, ltm_entries}}|null>}
 */
async function _getBaseSnapshot(chatId) {
    try {
        var db = await openDB();
        var result = await _tx(db, ['active_chains'], 'readonly', function (tx) {
            return tx.objectStore('active_chains').get(chatId);
        });
        if (!result) return null;
        var chain = result.chain || result;
        var base = {};
        if (chain.state_base_seq > 0) {
            var stateDelta = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
                return tx.objectStore('state_deltas').get(_generateId('delta', chatId, chain.state_base_seq));
            });
            if (stateDelta) {
                base.state = (stateDelta.folded_state) ? JSON.parse(JSON.stringify(stateDelta.folded_state)) : {};
            }
        }
        if (chain.mem_base_seq >= 0) {
            var memVer = await _tx(db, ['memory_versions'], 'readonly', function (tx) {
                return tx.objectStore('memory_versions').get(_generateId('memver', chatId, chain.mem_base_seq));
            });
            if (memVer) {
                base.mem = {
                    stm_entries: (memVer.folded_stm_entries) ? JSON.parse(JSON.stringify(memVer.folded_stm_entries)) : [],
                    unconsolidated_stm: (memVer.folded_unconsolidated_stm) ? JSON.parse(JSON.stringify(memVer.folded_unconsolidated_stm)) : [],
                    ltm_entries: (memVer.folded_ltm_entries) ? JSON.parse(JSON.stringify(memVer.folded_ltm_entries)) : []
                };
            }
        }
        return base;
    } catch (e) {
        console.warn('[NE] _getBaseSnapshot failed:', e);
        return null;
    }
}

/**
 * @param {string} chatId
 * @returns {Promise<object>}
 */
async function _getOrCreateChain(chatId) {
    var db = await openDB();
    try {
        var existing = await _tx(db, ['active_chains'], 'readonly', function (tx) {
            return tx.objectStore('active_chains').get(chatId);
        });
        if (existing) return existing.chain || existing;
    } catch (e) {}
    var chain = _emptyChain(chatId);
    await _tx(db, ['active_chains'], 'readwrite', function (tx) {
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
    });
    return chain;
}

/**
 * 记录 State Delta
 *
 * @param {string} chatId
 * @param {object} deltaData
 * @param {string} deltaData.source - "ai_update" | "manual_edit" | "rollback_restore"
 * @param {object[]} deltaData.changes - [{ path, old, new }]
 * @param {string[]} deltaData.message_dates
 * @returns {Promise<number>} 新 seq
 */
export async function recordStateDelta(chatId, deltaData) {
    var db = await openDB();
    var chain = await _getOrCreateChain(chatId);
    var newSeq = chain._global_state_seq + 1;

    var changes = deltaData.changes || [];
    var summary = deltaData.summary || buildStateDeltaSummary(changes);

    /** @type {object} */
    var delta = {
        id: _generateId('delta', chatId, newSeq),
        chat_id: chatId,
        seq: newSeq,
        prev_seq: chain.state_head_seq,
        timestamp: _nowISO(),
        source: deltaData.source || 'ai_update',
        summary: summary,
        changes: changes,
        message_dates: deltaData.message_dates || [],
        derived_from_stm_version: null
    };

    await _tx(db, ['state_deltas', 'active_chains'], 'readwrite', function (tx) {
        tx.objectStore('state_deltas').put(delta);
        chain.state_head_seq = newSeq;
        chain._global_state_seq = newSeq;
        chain.state_active.push(newSeq);
        if (chain.state_active.length > MAX_ACTIVE_VERSIONS) {
            chain.state_active = chain.state_active.slice(-MAX_ACTIVE_VERSIONS);
            chain.state_base_seq = chain.state_active[0];
        }
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
    });

    var stateLimit = _getVersionLimit('ne_state_version_limit');
    if (chain.state_active.length > stateLimit) {
        compact(chatId).catch(function(e) { console.warn('[NE] auto-compact state failed:', e); });
    }

    return newSeq;
}
/**
 * 记录 Memory Version
 *
 * @param {string} chatId
 * @param {object} versionData
 * @param {string} versionData.type - "stm_batch" | "ltm_consolidation" | "stm_reroll" | "ltm_reroll" | "manual_edit"
 * @param {object} versionData.delta - { stm_added?, stm_removed?, stm_moved?, ltm_added?, ltm_removed?, ltm_modified? }
 * @param {string[]} versionData.message_dates
 * @param {number|null} versionData.derived_from_stm_version
 * @returns {Promise<number>}
 */
export async function recordMemoryVersion(chatId, versionData) {
    var db = await openDB();
    var chain = await _getOrCreateChain(chatId);
    var newSeq = chain._global_mem_seq + 1;

    var delta = versionData.delta || {};
    var summary = versionData.summary || buildMemoryVersionSummary({ delta: delta, type: versionData.type });

    /** @type {object} */
    var version = {
        id: _generateId('memver', chatId, newSeq),
        chat_id: chatId,
        seq: newSeq,
        prev_seq: chain.mem_head_seq,
        timestamp: _nowISO(),
        type: versionData.type || 'stm_batch',
        summary: summary,
        delta: {
            stm_added: delta.stm_added || [],
            stm_removed: delta.stm_removed || [],
            stm_moved: delta.stm_moved || [],
            ltm_added: delta.ltm_added || [],
            ltm_removed: delta.ltm_removed || [],
            ltm_modified: delta.ltm_modified || []
        },
        message_dates: versionData.message_dates || [],
        derived_from_stm_version: versionData.derived_from_stm_version != null ? versionData.derived_from_stm_version : null
    };

    await _tx(db, ['memory_versions', 'active_chains'], 'readwrite', function (tx) {
        tx.objectStore('memory_versions').put(version);
        chain.mem_head_seq = newSeq;
        chain._global_mem_seq = newSeq;
        chain.mem_active.push(newSeq);
        if (chain.mem_active.length > MAX_ACTIVE_VERSIONS) {
            chain.mem_active = chain.mem_active.slice(-MAX_ACTIVE_VERSIONS);
            chain.mem_base_seq = chain.mem_active[0];
        }
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
    });

    var memLimit = _getVersionLimit('ne_mem_version_limit');
    if (chain.mem_active.length > memLimit) {
        compact(chatId).catch(function(e) { console.warn('[NE] auto-compact memory failed:', e); });
    }

    return newSeq;
}

/**
 * 原子写入：State Vault + Delta + Chain 在同一 IndexedDB 事务中
 *
 * 消除 vault 内容与版本链不同步的风险，并将 chain 的 read-modify-write
 * 收进同一 readwrite 事务（事务独占锁保证并发写入不丢失）。
 *
 * 如果 deltaData 为 null，仅写入 vault（不记录版本）。
 *
 * @param {string} chatId
 * @param {object} stateVault
 * @param {object|null} deltaData — { source, summary, changes, message_dates }
 * @returns {Promise<number|null>} 新 seq（有 delta 时），或 null
 */
export async function writeStateWithDelta(chatId, stateVault, deltaData) {
    var db = await openDB();

    if (!deltaData) {
        return _tx(db, [STATE_STORE], 'readwrite', function (tx) {
            tx.objectStore(STATE_STORE).put({ chat_id: chatId, vault: stateVault, updated_at: Date.now() });
        }).then(function () { return null; });
    }

    return new Promise(function (resolve, reject) {
        var tx;
        try {
            tx = db.transaction([STATE_STORE, 'state_deltas', 'active_chains'], 'readwrite');
        } catch (e) { reject(e); return; }
        var stateStore = tx.objectStore(STATE_STORE);
        var deltaStore = tx.objectStore('state_deltas');
        var chainStore = tx.objectStore('active_chains');
        var resultSeq = null;
        var pendingCompact = false;

        stateStore.put({ chat_id: chatId, vault: stateVault, updated_at: Date.now() });

        // chain 读取在同一事务内（exclusive lock），杜绝跨事务 read-modify-write 竞态
        var getReq = chainStore.get(chatId);
        getReq.onsuccess = function () {
            var existing = getReq.result;
            var chain = (existing && existing.chain) || existing || _emptyChain(chatId);
            var newSeq = chain._global_state_seq + 1;
            var changes = deltaData.changes || [];
            var summary = deltaData.summary || buildStateDeltaSummary(changes);
            deltaStore.put({
                id: _generateId('delta', chatId, newSeq),
                chat_id: chatId,
                seq: newSeq,
                prev_seq: chain.state_head_seq,
                timestamp: _nowISO(),
                source: deltaData.source || 'ai_update',
                summary: summary,
                changes: changes,
                message_dates: deltaData.message_dates || [],
                derived_from_stm_version: null
            });
            chain.state_head_seq = newSeq;
            chain._global_state_seq = newSeq;
            chain.state_active.push(newSeq);
            if (chain.state_active.length > MAX_ACTIVE_VERSIONS) {
                chain.state_active = chain.state_active.slice(-MAX_ACTIVE_VERSIONS);
                chain.state_base_seq = chain.state_active[0];
            }
            chainStore.put({ chat_id: chatId, chain: chain });
            resultSeq = newSeq;
            if (chain.state_active.length > _getVersionLimit('ne_state_version_limit')) {
                pendingCompact = true;
            }
        };
        getReq.onerror = function () { reject(getReq.error); };

        tx.oncomplete = function () {
            if (pendingCompact) {
                compact(chatId).catch(function(e) { console.warn('[NE] auto-compact state failed:', e); });
            }
            resolve(resultSeq);
        };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
    });
}

/**
 * 原子写入：Memory Vault + Version + Chain 在同一 IndexedDB 事务中
 *
 * 消除 vault 内容与版本链不同步的风险，并将 chain 的 read-modify-write
 * 收进同一 readwrite 事务（事务独占锁保证并发写入不丢失）。
 *
 * 如果 versionData 为 null，仅写入 vault（不记录版本）。
 *
 * @param {string} chatId
 * @param {object} memoryVault
 * @param {object|null} versionData — { type, summary, delta, message_dates, derived_from_stm_version }
 * @returns {Promise<number|null>} 新 seq（有 version 时），或 null
 */
export async function writeMemoryWithVersion(chatId, memoryVault, versionData) {
    var db = await openDB();

    if (!versionData) {
        return _tx(db, [MEMORY_STORE], 'readwrite', function (tx) {
            tx.objectStore(MEMORY_STORE).put({ chat_id: chatId, vault: memoryVault, updated_at: Date.now() });
        }).then(function () { return null; });
    }

    return new Promise(function (resolve, reject) {
        var tx;
        try {
            tx = db.transaction([MEMORY_STORE, 'memory_versions', 'active_chains'], 'readwrite');
        } catch (e) { reject(e); return; }
        var memStore = tx.objectStore(MEMORY_STORE);
        var verStore = tx.objectStore('memory_versions');
        var chainStore = tx.objectStore('active_chains');
        var resultSeq = null;
        var pendingCompact = false;

        memStore.put({ chat_id: chatId, vault: memoryVault, updated_at: Date.now() });

        // chain 读取在同一事务内（exclusive lock），杜绝跨事务 read-modify-write 竞态
        var getReq = chainStore.get(chatId);
        getReq.onsuccess = function () {
            var existing = getReq.result;
            var chain = (existing && existing.chain) || existing || _emptyChain(chatId);
            var newSeq = chain._global_mem_seq + 1;
            var delta = versionData.delta || {};
            var summary = versionData.summary || buildMemoryVersionSummary({ delta: delta, type: versionData.type });
            verStore.put({
                id: _generateId('memver', chatId, newSeq),
                chat_id: chatId,
                seq: newSeq,
                prev_seq: chain.mem_head_seq,
                timestamp: _nowISO(),
                type: versionData.type || 'stm_batch',
                summary: summary,
                delta: {
                    stm_added: delta.stm_added || [],
                    stm_removed: delta.stm_removed || [],
                    stm_moved: delta.stm_moved || [],
                    ltm_added: delta.ltm_added || [],
                    ltm_removed: delta.ltm_removed || [],
                    ltm_modified: delta.ltm_modified || []
                },
                message_dates: versionData.message_dates || [],
                derived_from_stm_version: versionData.derived_from_stm_version != null ? versionData.derived_from_stm_version : null
            });
            chain.mem_head_seq = newSeq;
            chain._global_mem_seq = newSeq;
            chain.mem_active.push(newSeq);
            if (chain.mem_active.length > MAX_ACTIVE_VERSIONS) {
                chain.mem_active = chain.mem_active.slice(-MAX_ACTIVE_VERSIONS);
                chain.mem_base_seq = chain.mem_active[0];
            }
            chainStore.put({ chat_id: chatId, chain: chain });
            resultSeq = newSeq;
            if (chain.mem_active.length > _getVersionLimit('ne_mem_version_limit')) {
                pendingCompact = true;
            }
        };
        getReq.onerror = function () { reject(getReq.error); };

        tx.oncomplete = function () {
            if (pendingCompact) {
                compact(chatId).catch(function(e) { console.warn('[NE] auto-compact memory failed:', e); });
            }
            resolve(resultSeq);
        };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
    });
}

/**
 * fold State：从 base_seq 快照开始逐版本应用 delta
 *
 * @param {number} [targetSeq] — 目标 seq，不传则 fold 到 head
 * @returns {Promise<object>} fold 后的 state 对象
 */
export async function foldState(chatId, targetSeq, headState) {
    var db = await openDB();
    var chainData = await _tx(db, ['active_chains'], 'readonly', function (tx) {
        return tx.objectStore('active_chains').get(chatId);
    });
    if (!chainData) return {};
    var chain = chainData.chain || chainData;
    if (targetSeq == null) targetSeq = chain.state_head_seq;
    if (targetSeq <= 0) return {};

    // D6: 一次取回该 chat 全部 delta，收集 {seq: delta} map，替代逐 seq 独立只读事务（链长 N → 事务数 1）
    var allDeltas = await _getAllByChatIndex(db, 'state_deltas', chatId);
    var deltasBySeq = {};
    for (var di = 0; di < allDeltas.length; di++) {
        deltasBySeq[allDeltas[di].seq] = allDeltas[di];
    }

    var base = {};
    var usedFallback = false;
    if (chain.state_base_seq >= 0) {
        var baseDelta = deltasBySeq[chain.state_base_seq];
        if (baseDelta && baseDelta.folded_state) {
            base = JSON.parse(JSON.stringify(baseDelta.folded_state));
        }
    }

    if (Object.keys(base).length === 0) {
        try {
            var fallbackVault = headState ? { content: { state: headState } } : null;
            if (!fallbackVault) {
                fallbackVault = await readState(chatId);
            }
            var fallbackState = (fallbackVault && fallbackVault.content && fallbackVault.content.state)
                ? JSON.parse(JSON.stringify(fallbackVault.content.state)) : {};
            if (Object.keys(fallbackState).length > 0) {
                base = fallbackState;
                for (var ri = chain.state_active.length - 1; ri >= 0; ri--) {
                    var rseq = chain.state_active[ri];
                    if (rseq <= targetSeq) break;
                    var rdelta = deltasBySeq[rseq];
                    if (!rdelta || !rdelta.changes) continue;
                    for (var rci = 0; rci < rdelta.changes.length; rci++) {
                        var rc = rdelta.changes[rci];
                        if (rc.old !== undefined) _setByPath(base, rc.path, rc.old);
                    }
                }
                usedFallback = true;
            }
        } catch (e) {
            console.warn('[NE] foldState fallback failed:', e);
        }
    }

    if (!usedFallback) {
        var startIdx = chain.state_active.indexOf(chain.state_base_seq);
        if (startIdx < 0) startIdx = 0;
        for (var i = startIdx; i < chain.state_active.length; i++) {
            var seq = chain.state_active[i];
            if (seq > targetSeq) break;
            if (seq === chain.state_base_seq) continue;
            var delta = deltasBySeq[seq];
            if (!delta || !delta.changes) continue;
            for (var ci = 0; ci < delta.changes.length; ci++) {
                var c = delta.changes[ci];
                _setByPath(base, c.path, c.new);
            }
        }
    }

    var chars = base.characters;
    if (chars) {
        var protoName = base.protagonist_name || '';
        Object.keys(chars).forEach(function (charName) {
            var card = chars[charName];
            if (!card || typeof card !== 'object') return;
            if (!card.name) card.name = charName;
            if (!card.status) card.status = '\u6D3B\u8DC3';
            if (protoName && charName === protoName && !card._role) card._role = 'protagonist';

            var rootObj = base[charName];
            if (rootObj && typeof rootObj === 'object') {
                Object.keys(rootObj).forEach(function (fk) {
                    if (card[fk] === undefined || card[fk] === null || card[fk] === '') {
                        card[fk] = rootObj[fk];
                    }
                });
                delete base[charName];
            }
        });
    }

    return base;
}

/**
 * fold Memory：从 base_seq 快照开始逐版本应用 delta
 *
 * @param {string} chatId
 * @param {number} [targetSeq]
 * @returns {Promise<{stm_entries: object[], unconsolidated_stm: object[], ltm_entries: object[]}>}
 */
export async function foldMemory(chatId, targetSeq) {
    var db = await openDB();
    var chainData = await _tx(db, ['active_chains'], 'readonly', function (tx) {
        return tx.objectStore('active_chains').get(chatId);
    });
    if (!chainData) return { stm_entries: [], unconsolidated_stm: [], ltm_entries: [] };
    var chain = chainData.chain || chainData;
    if (targetSeq == null) targetSeq = chain.mem_head_seq;
    if (targetSeq <= 0) return { stm_entries: [], unconsolidated_stm: [], ltm_entries: [] };

    var memory = { stm_entries: [], unconsolidated_stm: [], ltm_entries: [] };

    // D6: 一次取回该 chat 全部 memory_versions，收集 {seq: version} map，替代逐 seq 独立只读事务
    var allVersions = await _getAllByChatIndex(db, 'memory_versions', chatId);
    var versionsBySeq = {};
    for (var vi = 0; vi < allVersions.length; vi++) {
        versionsBySeq[allVersions[vi].seq] = allVersions[vi];
    }

    if (chain.mem_base_seq >= 0) {
        var baseVer = versionsBySeq[chain.mem_base_seq];
        if (baseVer) {
            memory.stm_entries = (baseVer.folded_stm_entries) ? JSON.parse(JSON.stringify(baseVer.folded_stm_entries)) : [];
            memory.unconsolidated_stm = (baseVer.folded_unconsolidated_stm) ? JSON.parse(JSON.stringify(baseVer.folded_unconsolidated_stm)) : [];
            memory.ltm_entries = (baseVer.folded_ltm_entries) ? JSON.parse(JSON.stringify(baseVer.folded_ltm_entries)) : [];
        }
    }

    var startIdx = chain.mem_active.indexOf(chain.mem_base_seq);
    if (startIdx < 0) startIdx = 0;
    for (var i = startIdx; i < chain.mem_active.length; i++) {
        var seq = chain.mem_active[i];
        if (seq > targetSeq) break;
        if (seq === chain.mem_base_seq) continue;

        /** @type {object|null} */
        var version = versionsBySeq[seq];
        if (!version || !version.delta) continue;

        var d = version.delta;

        if (d.stm_added && d.stm_added.length) {
            var addedIds = new Set(d.stm_added.map(function (e) { return e.id; }));
            memory.unconsolidated_stm = memory.unconsolidated_stm.filter(function (e) { return !addedIds.has(e.id); });
            memory.stm_entries = memory.stm_entries.filter(function (e) { return !addedIds.has(e.id); });
            memory.unconsolidated_stm = memory.unconsolidated_stm.concat(d.stm_added);
        }

        if (d.stm_removed && d.stm_removed.length) {
            var removedSet = new Set(d.stm_removed);
            memory.unconsolidated_stm = memory.unconsolidated_stm.filter(function (e) { return !removedSet.has(e.id); });
            memory.stm_entries = memory.stm_entries.filter(function (e) { return !removedSet.has(e.id); });
        }

        if (d.stm_moved && d.stm_moved.length) {
            var movedSet = new Set(d.stm_moved);
            var movedEntries = [];
            memory.unconsolidated_stm = memory.unconsolidated_stm.filter(function (e) {
                if (movedSet.has(e.id)) { movedEntries.push(e); return false; }
                return true;
            });
            memory.stm_entries = memory.stm_entries.concat(movedEntries);
        }

        if (d.ltm_added && d.ltm_added.length) {
            var ltmAddedIds = new Set(d.ltm_added.map(function (e) { return e.id; }));
            memory.ltm_entries = memory.ltm_entries.filter(function (e) { return !ltmAddedIds.has(e.id); });
            memory.ltm_entries = memory.ltm_entries.concat(d.ltm_added);
        }

        if (d.ltm_removed && d.ltm_removed.length) {
            var ltmRemovedSet = new Set(d.ltm_removed);
            memory.ltm_entries = memory.ltm_entries.filter(function (e) { return !ltmRemovedSet.has(e.id); });
        }

        if (d.ltm_modified && d.ltm_modified.length) {
            for (var mi = 0; mi < d.ltm_modified.length; mi++) {
                var mod = d.ltm_modified[mi];
                var entry = memory.ltm_entries.find(function (e) { return e.id === mod.ltm_id; });
                if (entry && mod.changes) {
                    for (var field in mod.changes) {
                        if (field === 'stm_refs_added') {
                            entry.stm_refs = (entry.stm_refs || []).concat(mod.changes[field]);
                        } else if (field === 'stm_refs_removed') {
                            var rmSet = new Set(mod.changes[field]);
                            entry.stm_refs = (entry.stm_refs || []).filter(function (r) { return !rmSet.has(r); });
                        } else {
                            entry[field] = mod.changes[field].new;
                        }
                    }
                }
            }
        }
    }

    return memory;
}

/**
 * 回退 State 到 targetSeq
 *
 * @param {string} chatId
 * @param {number} targetSeq
 * @returns {Promise<void>}
 */
export async function rollbackState(chatId, targetSeq) {
    var db = await openDB();
    var chainData = await _tx(db, ['active_chains'], 'readonly', function (tx) {
        return tx.objectStore('active_chains').get(chatId);
    });
    if (!chainData) return { ok: false, reason: 'no_chain' };
    var chain = chainData.chain || chainData;
    // 折叠守卫：compact 后旧版本已从 active 链剔除，回滚到已折叠版本会破坏链（误删 head delta）
    var verdict = evaluateRollbackTarget(chain.state_active, chain.state_head_seq, targetSeq);
    if (verdict !== 'ok') return { ok: false, reason: verdict };

    var orphanedSeqs = [];
    var newActive = [];
    for (var i = 0; i < chain.state_active.length; i++) {
        var seq = chain.state_active[i];
        if (seq > targetSeq) {
            orphanedSeqs.push(seq);
        } else {
            newActive.push(seq);
        }
    }

    await _tx(db, ['active_chains', 'state_deltas'], 'readwrite', function (tx) {
        chain.state_head_seq = targetSeq;
        chain.state_active = newActive;
        if (newActive.length > 0) chain.state_base_seq = newActive[0];
        else chain.state_base_seq = 0;
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
        for (var oi = 0; oi < orphanedSeqs.length; oi++) {
            tx.objectStore('state_deltas').delete(_generateId('delta', chatId, orphanedSeqs[oi]));
        }
    });
    await rebuildStateVault(chatId, targetSeq);
    return { ok: true };
}

/**
 * 回退 Memory 到 targetSeq
 *
 * @param {string} chatId
 * @param {number} targetSeq
 * @returns {Promise<void>}
 */
export async function rollbackMemory(chatId, targetSeq) {
    var db = await openDB();
    var chainData = await _tx(db, ['active_chains'], 'readonly', function (tx) {
        return tx.objectStore('active_chains').get(chatId);
    });
    if (!chainData) return { ok: false, reason: 'no_chain' };
    var chain = chainData.chain || chainData;
    // 折叠守卫：compact 后旧版本已从 active 链剔除，回滚到已折叠版本会破坏链（误删 head delta）
    var verdict = evaluateRollbackTarget(chain.mem_active, chain.mem_head_seq, targetSeq);
    if (verdict !== 'ok') return { ok: false, reason: verdict };

    var orphanedSeqs = [];
    var newActive = [];
    for (var i = 0; i < chain.mem_active.length; i++) {
        var seq = chain.mem_active[i];
        if (seq > targetSeq) {
            orphanedSeqs.push(seq);
        } else {
            newActive.push(seq);
        }
    }

    await _tx(db, ['active_chains', 'memory_versions'], 'readwrite', function (tx) {
        chain.mem_head_seq = targetSeq;
        chain.mem_active = newActive;
        if (newActive.length > 0) chain.mem_base_seq = newActive[0];
        else chain.mem_base_seq = 0;
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
        for (var oi = 0; oi < orphanedSeqs.length; oi++) {
            tx.objectStore('memory_versions').delete(_generateId('memver', chatId, orphanedSeqs[oi]));
        }
    });
    await rebuildMemoryVault(chatId, targetSeq);
    return { ok: true };
}

export async function rebuildStateVault(chatId, targetSeq) {
    var stateVault = await readState(chatId);
    if (!stateVault) return;
    var state = await foldState(chatId, targetSeq, null);
    stateVault.content = stateVault.content || {};
    stateVault.content.state = state;
    await writeState(chatId, stateVault);
}

export async function rebuildMemoryVault(chatId, targetSeq) {
    var memVault = await readMemory(chatId);
    if (!memVault) return;
    var folded = await foldMemory(chatId, targetSeq, null);
    memVault.content = memVault.content || {};
    memVault.content.stm_entries = folded.stm_entries;
    memVault.content.unconsolidated_stm = folded.unconsolidated_stm;
    memVault.content.ltm_entries = folded.ltm_entries;
    await writeMemory(chatId, memVault);
}

/**
 * 压缩：fold 所有 active deltas → 存入 base 版本的 folded 字段
 *
 * @param {string} chatId
 * @param {string} [reason='auto_threshold'] — 折叠原因（如 'auto_threshold' / 'manual'），记录到 checkpoint_reason
 * @returns {Promise<void>}
 */
export async function compact(chatId, reason) {
    var db = await openDB();
    var chain = await _getOrCreateChain(chatId);
    reason = reason || 'auto_threshold';

    if (chain.state_active.length > 1) {
        var stOldSeqs = chain.state_active.slice(); // D2: 折叠前快照，用于删除旧 delta
        var foldedState = await foldState(chatId, chain.state_head_seq);
        var headSeq = chain.state_head_seq;
        var baseId = _generateId('delta', chatId, headSeq);
        var existing = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
            return tx.objectStore('state_deltas').get(baseId);
        });
        if (existing) {
            existing.folded_state = foldedState;
            existing.checkpoint_reason = reason;
            existing.checkpoint_source = existing.source || 'unknown';
            var stDelSeqs = computeCompactDeleteSeqs(stOldSeqs, headSeq);
            await _tx(db, ['state_deltas', 'active_chains'], 'readwrite', function (tx) {
                tx.objectStore('state_deltas').put(existing);
                for (var sdi = 0; sdi < stDelSeqs.length; sdi++) {
                    tx.objectStore('state_deltas').delete(_generateId('delta', chatId, stDelSeqs[sdi]));
                }
                chain.state_base_seq = headSeq;
                chain.state_active = [headSeq];
                tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
            });
        }
    }

    if (chain.mem_active.length > 1) {
        var memOldSeqs = chain.mem_active.slice(); // D2: 折叠前快照
        var foldedMem = await foldMemory(chatId, chain.mem_head_seq);
        var headSeq = chain.mem_head_seq;
        var baseId = _generateId('memver', chatId, headSeq);
        var existing = await _tx(db, ['memory_versions'], 'readonly', function (tx) {
            return tx.objectStore('memory_versions').get(baseId);
        });
        if (existing) {
            existing.folded_stm_entries = foldedMem.stm_entries;
            existing.folded_unconsolidated_stm = foldedMem.unconsolidated_stm;
            existing.folded_ltm_entries = foldedMem.ltm_entries;
            existing.checkpoint_reason = reason;
            existing.checkpoint_source = existing.type || 'unknown';
            var memDelSeqs = computeCompactDeleteSeqs(memOldSeqs, headSeq);
            await _tx(db, ['memory_versions', 'active_chains'], 'readwrite', function (tx) {
                tx.objectStore('memory_versions').put(existing);
                for (var mdi = 0; mdi < memDelSeqs.length; mdi++) {
                    tx.objectStore('memory_versions').delete(_generateId('memver', chatId, memDelSeqs[mdi]));
                }
                chain.mem_base_seq = headSeq;
                chain.mem_active = [headSeq];
                tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
            });
        }
    }
}

/**
 * 双链一致性体检（只读）：校验 active_chains 引用的每个 seq 都有对应记录
 *
 * 检测三类问题（详见 diagnoseChainRefs）：
 *   - dangling：active 引用但 store 无记录（原子化改造前两段式写入的残留）
 *   - headMissing：head 悬空或不在 active 中
 *   - orphans：存在记录但未挂载在 active 上（历史残留 / gc bug），只计数
 *
 * @param {string} chatId
 * @returns {Promise<{status:'no_chain'|'ok'|'broken', state:object|null, mem:object|null, orphanDeltas:number, orphanVersions:number}>}
 *   chain 记录不存在 → status:'no_chain'（新对话正常态，非错误）
 */
export async function diagnoseChainConsistency(chatId) {
    var db = await openDB();
    var chainData = await _tx(db, ['active_chains'], 'readonly', function (tx) {
        return tx.objectStore('active_chains').get(chatId);
    });
    if (!chainData) {
        return { status: 'no_chain', state: null, mem: null, orphanDeltas: 0, orphanVersions: 0 };
    }
    var chain = chainData.chain || chainData;
    var deltas = await _getAllByChatIndex(db, 'state_deltas', chatId);
    var versions = await _getAllByChatIndex(db, 'memory_versions', chatId);
    var deltaSeqs = deltas.map(function (d) { return d.seq; });
    var versionSeqs = versions.map(function (v) { return v.seq; });
    var state = diagnoseChainRefs(chain.state_active, chain.state_head_seq, deltaSeqs);
    var mem = diagnoseChainRefs(chain.mem_active, chain.mem_head_seq, versionSeqs);
    var broken = state.status !== 'ok' || mem.status !== 'ok';
    return {
        status: broken ? 'broken' : 'ok',
        state: state,
        mem: mem,
        orphanDeltas: state.orphans.length,
        orphanVersions: mem.orphans.length
    };
}

/**
 * 保守修复：对有悬空/head 悬空的链执行截断（连续前缀语义见 computeConservativeRepair）
 *
 * 修复前把原 chain 完整快照写入 chain._pre_repair_backup 作为持久化证据
 * （shujuku「修复留证据」原则），同时 console.warn 原链。
 * 单 readwrite 事务只写 active_chains — vault / delta / version 内容一概不动。
 * _global_*_seq 不回退，防止新记录 id 复用。
 *
 * @param {string} chatId
 * @returns {Promise<{repaired:string[], dropped:{state:number[],mem:number[]}, noop:boolean}>}
 */
export async function repairChainConservative(chatId) {
    var db = await openDB();
    var chainData = await _tx(db, ['active_chains'], 'readonly', function (tx) {
        return tx.objectStore('active_chains').get(chatId);
    });
    if (!chainData) return { repaired: [], dropped: { state: [], mem: [] }, noop: true };
    var chain = chainData.chain || chainData;
    var deltas = await _getAllByChatIndex(db, 'state_deltas', chatId);
    var versions = await _getAllByChatIndex(db, 'memory_versions', chatId);
    var deltaSeqs = deltas.map(function (d) { return d.seq; });
    var versionSeqs = versions.map(function (v) { return v.seq; });

    var stDiag = diagnoseChainRefs(chain.state_active, chain.state_head_seq, deltaSeqs);
    var memDiag = diagnoseChainRefs(chain.mem_active, chain.mem_head_seq, versionSeqs);
    var stNeeds = stDiag.status !== 'ok';
    var memNeeds = memDiag.status !== 'ok';
    if (!stNeeds && !memNeeds) return { repaired: [], dropped: { state: [], mem: [] }, noop: true };

    console.warn('[NE] chain repair: original chain =', JSON.stringify(chain));
    chain._pre_repair_backup = { at: _nowISO(), chain: JSON.parse(JSON.stringify(chain)) };

    var stRepair = computeConservativeRepair(chain.state_active, chain.state_head_seq, chain.state_base_seq, deltaSeqs);
    var memRepair = computeConservativeRepair(chain.mem_active, chain.mem_head_seq, chain.mem_base_seq, versionSeqs);
    var repaired = [];
    if (stNeeds) {
        chain.state_active = stRepair.newActive;
        chain.state_head_seq = stRepair.newHead;
        chain.state_base_seq = stRepair.newBase;
        repaired.push('state');
    }
    if (memNeeds) {
        chain.mem_active = memRepair.newActive;
        chain.mem_head_seq = memRepair.newHead;
        chain.mem_base_seq = memRepair.newBase;
        repaired.push('mem');
    }

    await _tx(db, ['active_chains'], 'readwrite', function (tx) {
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
    });
    return {
        repaired: repaired,
        dropped: {
            state: stNeeds ? stRepair.dropped : [],
            mem: memNeeds ? memRepair.dropped : []
        },
        noop: false
    };
}

/**
 * 删除孤儿记录：seq 不在 active（state_active / mem_active）中的 delta/version
 *
 * 必须由 UI confirm 后调用（删除类操作强制确认）。
 * 无 chain 记录时拒绝删除（保守：无从判定引用关系）。
 * 单 readwrite 事务覆盖 state_deltas + memory_versions。
 *
 * @param {string} chatId
 * @returns {Promise<{deltas:number, versions:number}>}
 */
export async function removeOrphanVersionRecords(chatId) {
    var db = await openDB();
    var chainData = await _tx(db, ['active_chains'], 'readonly', function (tx) {
        return tx.objectStore('active_chains').get(chatId);
    });
    if (!chainData) return { deltas: 0, versions: 0 };
    var chain = chainData.chain || chainData;
    var stActive = new Set(chain.state_active || []);
    var memActive = new Set(chain.mem_active || []);

    var deltas = await _getAllByChatIndex(db, 'state_deltas', chatId);
    var versions = await _getAllByChatIndex(db, 'memory_versions', chatId);
    var orphanDeltaIds = [];
    for (var i = 0; i < deltas.length; i++) {
        if (!stActive.has(deltas[i].seq)) orphanDeltaIds.push(deltas[i].id);
    }
    var orphanVersionIds = [];
    for (var j = 0; j < versions.length; j++) {
        if (!memActive.has(versions[j].seq)) orphanVersionIds.push(versions[j].id);
    }
    if (orphanDeltaIds.length === 0 && orphanVersionIds.length === 0) return { deltas: 0, versions: 0 };

    await _tx(db, ['state_deltas', 'memory_versions'], 'readwrite', function (tx) {
        var ds = tx.objectStore('state_deltas');
        for (var k = 0; k < orphanDeltaIds.length; k++) ds.delete(orphanDeltaIds[k]);
        var vs = tx.objectStore('memory_versions');
        for (var m = 0; m < orphanVersionIds.length; m++) vs.delete(orphanVersionIds[m]);
    });
    return { deltas: orphanDeltaIds.length, versions: orphanVersionIds.length };
}

/**
 * 获取活跃链路信息
 *
 * @param {string} chatId
 * @returns {Promise<object|null>}
 */
export async function getActiveChain(chatId) {
    try {
        var db = await openDB();
        var result = await _tx(db, ['active_chains'], 'readonly', function (tx) {
            return tx.objectStore('active_chains').get(chatId);
        });
        if (!result) return null;
        return result.chain || result;
    } catch (e) {
        return null;
    }
}

/**
 * 获取 State Delta 列表（用于 UI 版本时间线）
 *
 * @param {string} chatId
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
export async function listStateDeltas(chatId, limit) {
    var max = limit || 50;
    try {
        var db = await openDB();
        var chain = await getActiveChain(chatId);
        if (!chain) return [];
        var seqs = chain.state_active.slice(-max);
        var deltas = [];
        for (var i = seqs.length - 1; i >= 0; i--) {
            var d = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
                return tx.objectStore('state_deltas').get(_generateId('delta', chatId, seqs[i]));
            });
            if (d) deltas.push(d);
        }
        return deltas;
    } catch (e) {
        return [];
    }
}

/**
 * 获取 Memory Version 列表（用于 UI）
 *
 * @param {string} chatId
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
export async function listMemoryVersions(chatId, limit) {
    var max = limit || 50;
    try {
        var db = await openDB();
        var chain = await getActiveChain(chatId);
        if (!chain) return [];
        var seqs = chain.mem_active.slice(-max);
        var versions = [];
        for (var i = seqs.length - 1; i >= 0; i--) {
            var v = await _tx(db, ['memory_versions'], 'readonly', function (tx) {
                return tx.objectStore('memory_versions').get(_generateId('memver', chatId, seqs[i]));
            });
            if (v) versions.push(v);
        }
        return versions;
    } catch (e) {
        return [];
    }
}

/**
 * 初始化 State 版本链 — 从现有 state vault 内容创建 seq=0 快照
 *
 * @param {string} chatId
 * @param {object} stateVaultContent — 含 state 字段（如 stateVault.content）
 * @returns {Promise<void>}
 */
export async function initializeStateChain(chatId, stateVaultContent) {
    var db = await openDB();
    var existingDelta = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
        return tx.objectStore('state_deltas').get(_generateId('delta', chatId, 0));
    });
    var content = stateVaultContent || {};
    var foldedState = content.state ? JSON.parse(JSON.stringify(content.state)) : {};

    if (existingDelta) {
        if (existingDelta.folded_state) return;
        existingDelta.folded_state = foldedState;
        await _tx(db, ['state_deltas'], 'readwrite', function (tx) {
            tx.objectStore('state_deltas').put(existingDelta);
        });
        return;
    }

    var stateDelta = _emptyStateDelta(chatId);
    stateDelta.id = _generateId('delta', chatId, 0);
    stateDelta.folded_state = foldedState;
    stateDelta.summary = '初始迁移';

    var chain = await _getOrCreateChain(chatId);

    await _tx(db, ['state_deltas', 'active_chains'], 'readwrite', function (tx) {
        tx.objectStore('state_deltas').put(stateDelta);
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
    });
}

/**
 * 初始化 Memory 版本链 — 从现有 memory vault 内容创建 seq=0 快照
 *
 * @param {string} chatId
 * @param {object} memoryVaultContent — 含 stm_entries, unconsolidated_stm, ltm_entries 字段
 * @returns {Promise<void>}
 */
export async function initializeMemoryChain(chatId, memoryVaultContent) {
    var db = await openDB();
    var existingVersion = await _tx(db, ['memory_versions'], 'readonly', function (tx) {
        return tx.objectStore('memory_versions').get(_generateId('memver', chatId, 0));
    });
    if (existingVersion) return;

    var content = memoryVaultContent || {};
    var foldedStm = (content.stm_entries || []).map(function (e) { return JSON.parse(JSON.stringify(e)); });
    var foldedUnconsolidated = (content.unconsolidated_stm || []).map(function (e) { return JSON.parse(JSON.stringify(e)); });
    var foldedLtm = (content.ltm_entries || []).map(function (e) { return JSON.parse(JSON.stringify(e)); });

    var memVersion = _emptyMemoryVersion(chatId);
    memVersion.id = _generateId('memver', chatId, 0);
    memVersion.folded_stm_entries = foldedStm;
    memVersion.folded_unconsolidated_stm = foldedUnconsolidated;
    memVersion.folded_ltm_entries = foldedLtm;
    memVersion.summary = '初始迁移';

    var chain = await _getOrCreateChain(chatId);

    await _tx(db, ['memory_versions', 'active_chains'], 'readwrite', function (tx) {
        tx.objectStore('memory_versions').put(memVersion);
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
    });
}

/**
 * @deprecated 使用 initializeStateChain 和 initializeMemoryChain 分别初始化
 */
export async function initializeChain(chatId, vaultContent) {
    await initializeStateChain(chatId, vaultContent);
    await initializeMemoryChain(chatId, vaultContent);
}

export { buildStateDeltaSummary };
