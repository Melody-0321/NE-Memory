/**
 * vault/garbage-collector.js — IndexedDB 孤儿数据 GC
 *
 * 遍历 IndexedDB 中所有 chat_id，与 ST ctx.characters / ctx.groups
 * 做差集对比，找出并清理已删除聊天遗留的 vault 数据。
 */
import { readVault, remove, openDB } from './store.js';
import { neSync } from '../settings-adapter.js';

var _gcImportsReady = true;

/**
 * 从 ST context 中收集所有现存的聊天 ID
 * 依赖 window.parent.SillyTavern.getContext()
 */
export function collectSTChatIds() {
    var ids = new Set();
    try {
        var win = window.parent || window;
        if (typeof win.SillyTavern === 'undefined' || !win.SillyTavern.getContext) return ids;
        var ctx = win.SillyTavern.getContext();

        if (ctx.characters && typeof ctx.characters === 'object') {
            var chids = Object.keys(ctx.characters);
            for (var i = 0; i < chids.length; i++) {
                try {
                    var c = ctx.characters[chids[i]];
                    if (c && typeof c.chat === 'string' && c.chat) ids.add(c.chat);
                } catch (e) {}
            }
        }

        if (ctx.groups && Array.isArray(ctx.groups)) {
            for (var j = 0; j < ctx.groups.length; j++) {
                try {
                    var g = ctx.groups[j];
                    if (g && typeof g.chat_id === 'string' && g.chat_id) ids.add(g.chat_id);
                } catch (e) {}
            }
        }

        if (ctx.chatId && typeof ctx.chatId === 'string' && ctx.chatId !== 'default') ids.add(ctx.chatId);
    } catch (e) { console.warn('[NE-GC] collectSTChatIds failed:', e.message); }
    return ids;
}

function fingerprintMatchesAnyCharacter(key, characters) {
    var match = key.match(/^ne_([^_]+)_/);
    if (!match) return false;
    var chid = match[1];
    if (!characters) return false;
    return Object.prototype.hasOwnProperty.call(characters, chid);
}

/**
 * D8: 限并发 map——Promise.all 并发执行，结果按 index 保序
 */
function mapLimit(items, limit, fn) {
    return new Promise(function (resolve, reject) {
        var results = new Array(items.length);
        var nextIdx = 0;
        var running = 0;
        var done = 0;
        var rejected = false;
        function pump() {
            if (rejected) return;
            while (running < limit && nextIdx < items.length) {
                var idx = nextIdx++;
                running++;
                fn(items[idx], idx).then(function (res) {
                    results[idx] = res;
                    running--;
                    done++;
                    pump();
                }).catch(function (err) {
                    if (!rejected) { rejected = true; reject(err); }
                });
            }
            if (done === items.length) resolve(results);
        }
        pump();
    });
}

/**
 * 扫描 IndexedDB，返回各条目状态
 */
export async function scanOrphans() {
    var stIds = collectSTChatIds();
    var characters = null;
    try {
        var win = window.parent || window;
        if (typeof win.SillyTavern !== 'undefined' && win.SillyTavern.getContext) {
            characters = win.SillyTavern.getContext().characters || null;
        }
    } catch (e) {}

    var allKeys = await listAllChatIds();

    // D8: 限并发 8 扫描，单键失败在回调内转 error 结果，不阻塞其余键
    var results = await mapLimit(allKeys, 8, async function (key) {
        var status = 'orphan';
        var reason = 'not in ST character/groups lists';

        if (stIds.has(key)) {
            status = 'active';
            reason = 'exists in ST chat list';
        } else if (characters && fingerprintMatchesAnyCharacter(key, characters)) {
            status = 'alive';
            reason = 'fingerprint matches known ST character';
        }

        try {
            var vault = await readVault(key);
            var stmCount = 0;
            var ltmCount = 0;
            if (vault && vault.content) {
                if (Array.isArray(vault.content.unconsolidated_stm)) stmCount = vault.content.unconsolidated_stm.length;
                if (Array.isArray(vault.content.stm_entries)) stmCount += vault.content.stm_entries.length;
                if (Array.isArray(vault.content.ltm_entries)) ltmCount = vault.content.ltm_entries.length;
            }
            return {
                chat_id: key,
                version: vault ? vault.version : 0,
                stm: stmCount,
                ltm: ltmCount,
                status: status,
                reason: reason
            };
        } catch (e) {
            return {
                chat_id: key,
                version: -1,
                stm: 0,
                ltm: 0,
                status: 'error',
                reason: 'read failed: ' + (e.message || '')
            };
        }
    });

    return results;
}

/**
 * 清理指定 chat_id 的全部 IndexedDB + localStorage 数据
 */
export async function purgeOrphanChatData(chatId) {
    var purgeLog = [];

    try {
        await remove(chatId);
        purgeLog.push('vaults:' + chatId);
    } catch (e) { console.warn('[NE-GC] vault remove failed for', chatId, ':', e.message); }

    try {
        var statsKey = 'ne_chat_stats';
        var raw = localStorage.getItem(statsKey);
        if (raw) {
            var stats = JSON.parse(raw);
            if (stats && stats[chatId]) {
                delete stats[chatId];
                localStorage.setItem(statsKey, JSON.stringify(stats));
                try { neSync(statsKey); } catch (e) {}
                purgeLog.push('ne_chat_stats');
            }
        }
    } catch (e) {}

    try {
        var phKey = 'ne_ph_' + chatId;
        if (localStorage.getItem(phKey) !== null) {
            localStorage.removeItem(phKey);
            purgeLog.push(phKey);
        }
    } catch (e) {}

    try {
        var collapseKey = 'ne_collapse_' + chatId;
        if (localStorage.getItem(collapseKey) !== null) {
            localStorage.removeItem(collapseKey);
            purgeLog.push(collapseKey);
        }
    } catch (e) {}

    console.log('[NE-GC] purged orphan chat:', chatId, '=>', purgeLog.join(', '));
    return purgeLog;
}

export async function listAllChatIds() {
    var db = await openDB();
    return new Promise(function(resolve, reject) {
        try {
            var stores = ['vaults', 'state_vaults', 'memory_vaults', 'active_chains'];
            var remaining = stores.length;
            var idSet = {};
            for (var si = 0; si < stores.length; si++) {
                (function(storeName) {
                    try {
                        var tx = db.transaction(storeName, 'readonly');
                        var req = tx.objectStore(storeName).getAllKeys();
                        req.onsuccess = function() {
                            var keys = req.result || [];
                            for (var ki = 0; ki < keys.length; ki++) { idSet[keys[ki]] = true; }
                            remaining--;
                            if (remaining === 0) {
                                try { db.close(); } catch (e) {}
                                resolve(Object.keys(idSet));
                            }
                        };
                        req.onerror = function() {
                            remaining--;
                            if (remaining === 0) {
                                try { db.close(); } catch (e) {}
                                resolve(Object.keys(idSet));
                            }
                        };
                    } catch (e) {
                        remaining--;
                        if (remaining === 0) {
                            try { db.close(); } catch (e2) {}
                            resolve(Object.keys(idSet));
                        }
                    }
                })(stores[si]);
            }
        } catch (e) {
            try { db.close(); } catch (e2) {}
            reject(e);
        }
    });
}
