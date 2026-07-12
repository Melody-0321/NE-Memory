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
 *   orphaned_branches keyPath: "id"
 */

import { openDB, readState, writeState } from './store.js';

var BRANCH_TTL_MS = 24 * 60 * 60 * 1000;

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
    return { chat_id: chatId, state_head_seq: 0, state_base_seq: 0, state_active: [0], mem_head_seq: 0, mem_base_seq: 0, mem_active: [0] };
}

function _setByPath(obj, path, value) {
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length - 1; i++) {
        var key = parts[i];
        if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[parts[parts.length - 1]] = value;
}

function _getByPath(obj, path) {
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
        if (current === undefined || current === null) return undefined;
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
    var newSeq = chain.state_head_seq + 1;

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
    var newSeq = chain.mem_head_seq + 1;

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

    var base = {};
    var usedFallback = false;
    if (chain.state_base_seq >= 0) {
        var baseDelta = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
            return tx.objectStore('state_deltas').get(_generateId('delta', chatId, chain.state_base_seq));
        });
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
                    var rdelta = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
                        return tx.objectStore('state_deltas').get(_generateId('delta', chatId, rseq));
                    });
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
            var delta = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
                return tx.objectStore('state_deltas').get(_generateId('delta', chatId, seq));
            });
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

    if (chain.mem_base_seq >= 0) {
        var baseVer = await _tx(db, ['memory_versions'], 'readonly', function (tx) {
            return tx.objectStore('memory_versions').get(_generateId('memver', chatId, chain.mem_base_seq));
        });
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
        var version = await _tx(db, ['memory_versions'], 'readonly', function (tx) {
            return tx.objectStore('memory_versions').get(_generateId('memver', chatId, seq));
        });
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
    if (!chainData) return;
    var chain = chainData.chain || chainData;
    if (targetSeq >= chain.state_head_seq) return;

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

    /** @type {object} */
    var branch = {
        id: 'orphan_state_' + chatId + '_' + targetSeq,
        chat_id: chatId,
        fork_point_seq: targetSeq,
        type: 'state',
        versions: orphanedSeqs,
        detached_at: _nowISO(),
        auto_clean_at: new Date(Date.now() + BRANCH_TTL_MS).toISOString()
    };

    await _tx(db, ['active_chains', 'orphaned_branches'], 'readwrite', function (tx) {
        chain.state_head_seq = targetSeq;
        chain.state_active = newActive;
        if (newActive.length > 0) chain.state_base_seq = newActive[0];
        else chain.state_base_seq = 0;
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
        tx.objectStore('orphaned_branches').put(branch);
    });
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
    if (!chainData) return;
    var chain = chainData.chain || chainData;
    if (targetSeq >= chain.mem_head_seq) return;

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

    /** @type {object} */
    var branch = {
        id: 'orphan_mem_' + chatId + '_' + targetSeq,
        chat_id: chatId,
        fork_point_seq: targetSeq,
        type: 'memory',
        versions: orphanedSeqs,
        detached_at: _nowISO(),
        auto_clean_at: new Date(Date.now() + BRANCH_TTL_MS).toISOString()
    };

    await _tx(db, ['active_chains', 'orphaned_branches'], 'readwrite', function (tx) {
        chain.mem_head_seq = targetSeq;
        chain.mem_active = newActive;
        if (newActive.length > 0) chain.mem_base_seq = newActive[0];
        else chain.mem_base_seq = 0;
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
        tx.objectStore('orphaned_branches').put(branch);
    });
}

export async function rebuildStateVault(chatId, targetSeq) {
    var db = await openDB();
    var chainData = await _tx(db, ['active_chains'], 'readonly', function (tx) {
        return tx.objectStore('active_chains').get(chatId);
    });
    if (!chainData) return;
    var chain = chainData.chain || chainData;
    if (targetSeq > chain.state_head_seq) targetSeq = chain.state_head_seq;
    if (targetSeq < 0) return;

    var base = {};
    if (chain.state_base_seq >= 0) {
        var baseDelta = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
            return tx.objectStore('state_deltas').get(_generateId('delta', chatId, chain.state_base_seq));
        });
        if (baseDelta && baseDelta.folded_state) {
            base = JSON.parse(JSON.stringify(baseDelta.folded_state));
        }
    }

    if (Object.keys(base).length === 0) {
        try {
            var vault = await readState(chatId);
            if (vault && vault.content && vault.content.state) {
                base = JSON.parse(JSON.stringify(vault.content.state));
            }
        } catch (e) {}
    }

    var startIdx = chain.state_active.indexOf(chain.state_base_seq);
    if (startIdx < 0) startIdx = 0;
    for (var i = startIdx; i < chain.state_active.length; i++) {
        var seq = chain.state_active[i];
        if (seq > targetSeq) break;
        if (seq === chain.state_base_seq) continue;
        var delta = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
            return tx.objectStore('state_deltas').get(_generateId('delta', chatId, seq));
        });
        if (!delta || !delta.changes) continue;
        for (var ci = 0; ci < delta.changes.length; ci++) {
            var ch = delta.changes[ci];
            if (ch.new !== undefined) _setByPath(base, ch.path, ch.new);
        }
    }

    var stateVault = await readState(chatId);
    if (stateVault) {
        stateVault.content = stateVault.content || {};
        stateVault.content.state = base;
        await writeState(chatId, stateVault);
    }
}

/**
 * 恢复孤立分支
 *
 * @param {string} chatId
 * @param {string} branchId
 * @returns {Promise<void>}
 */
export async function restoreBranch(chatId, branchId) {
    var db = await openDB();
    var branch = await _tx(db, ['orphaned_branches'], 'readonly', function (tx) {
        return tx.objectStore('orphaned_branches').get(branchId);
    });
    if (!branch) return;

    var chain = await _getOrCreateChain(chatId);

    if (branch.type === 'state') {
        chain.state_active = chain.state_active.concat(branch.versions);
        chain.state_head_seq = branch.versions[branch.versions.length - 1] || chain.state_head_seq;
    } else {
        chain.mem_active = chain.mem_active.concat(branch.versions);
        chain.mem_head_seq = branch.versions[branch.versions.length - 1] || chain.mem_head_seq;
    }

    await _tx(db, ['active_chains', 'orphaned_branches'], 'readwrite', function (tx) {
        tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
        tx.objectStore('orphaned_branches').delete(branchId);
    });
}

/**
 * 压缩：fold 所有 active deltas → 存入 base 版本的 folded 字段
 *
 * @param {string} chatId
 * @returns {Promise<void>}
 */
export async function compact(chatId) {
    var db = await openDB();
    var chain = await _getOrCreateChain(chatId);

    if (chain.state_active.length > 1) {
        var foldedState = await foldState(chatId, chain.state_head_seq);
        var headSeq = chain.state_head_seq;
        var baseId = _generateId('delta', chatId, headSeq);
        var existing = await _tx(db, ['state_deltas'], 'readonly', function (tx) {
            return tx.objectStore('state_deltas').get(baseId);
        });
        if (existing) {
            existing.folded_state = foldedState;
            await _tx(db, ['state_deltas', 'active_chains'], 'readwrite', function (tx) {
                tx.objectStore('state_deltas').put(existing);
                chain.state_base_seq = headSeq;
                chain.state_active = [headSeq];
                tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
            });
        }
    }

    if (chain.mem_active.length > 1) {
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
            await _tx(db, ['memory_versions', 'active_chains'], 'readwrite', function (tx) {
                tx.objectStore('memory_versions').put(existing);
                chain.mem_base_seq = headSeq;
                chain.mem_active = [headSeq];
                tx.objectStore('active_chains').put({ chat_id: chatId, chain: chain });
            });
        }
    }
}

/**
 * 清理过期孤立分支
 *
 * @returns {Promise<number>} 清理的分支数
 */
export async function cleanupBranches() {
    try {
        var db = await openDB();
        var now = new Date().toISOString();
        var allBranches = await _tx(db, ['orphaned_branches'], 'readonly', function (tx) {
            return tx.objectStore('orphaned_branches').getAll();
        });
        if (!allBranches || !allBranches.length) return 0;
        var removed = 0;
        for (var i = 0; i < allBranches.length; i++) {
            if (allBranches[i].auto_clean_at && allBranches[i].auto_clean_at < now) {
                await _tx(db, ['orphaned_branches'], 'readwrite', function (tx) {
                    tx.objectStore('orphaned_branches').delete(allBranches[i].id);
                });
                removed++;
            }
        }
        return removed;
    } catch (e) {
        console.warn('[NE] cleanupBranches failed:', e);
        return 0;
    }
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
