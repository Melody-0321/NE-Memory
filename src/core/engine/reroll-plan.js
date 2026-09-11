/**
 * NE-Memory 主动重抽（Re-roll）—— 纯函数决策层
 *
 * 不触碰任何 IO。输入是版本链的只读快照（listStateDeltas / listMemoryVersions 的
 * newest-first 结果）与 vault，输出重抽 scope、受影响 path / 条目、消息 id 批次与冲突清单。
 *
 * 设计见 .trae/documents/reroll-state-memory-plan.md：
 * - 重抽以「版本」为起点，覆盖该起点及其后所有同类 AI 版本（v1 实际恒为单版本）。
 * - ne_char_update 的 path 被排除出回溯范围（保护角色卡正则协议产物）。
 * - memory 侧复用 rollbackByMsgIds 做干跑，级联逻辑单一真源。
 */

import { rollbackByMsgIds } from '../vault/store.js';
import { getByPath } from '../vault/state-versions.js';

var STATE_AI_SOURCE = 'ai_update';
var STATE_MANUAL_SOURCE = 'manual_edit';
var STATE_PROTECTED_SOURCES = ['ne_char_update'];

var MEM_AI_TYPE = 'stm_batch';
var MEM_MANUAL_TYPE = 'manual_edit';

function _dedupe(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var v = list[i];
        if (v === undefined || v === null || v === '') continue;
        if (seen[v]) continue;
        seen[v] = true;
        out.push(v);
    }
    return out;
}

function _bySeqAsc(list) {
    return list.slice().sort(function (a, b) { return a.seq - b.seq; });
}

function _flattenMsgIds(records) {
    var ids = [];
    for (var i = 0; i < records.length; i++) {
        var dates = records[i].message_dates || [];
        for (var j = 0; j < dates.length; j++) ids.push(dates[j]);
    }
    return _dedupe(ids);
}

function _hasIntersection(list, idSet) {
    for (var i = 0; i < (list || []).length; i++) {
        if (idSet[list[i]]) return true;
    }
    return false;
}

function _collectStmIds(vault) {
    var c = (vault && vault.content) || {};
    var ids = [];
    var push = function (e) { if (e && e.id && ids.indexOf(e.id) === -1) ids.push(e.id); };
    (c.unconsolidated_stm || []).forEach(push);
    (c.stm_entries || []).forEach(push);
    return ids;
}

function _collectLtmRefs(vault) {
    var c = (vault && vault.content) || {};
    var map = {};
    (c.ltm_entries || []).forEach(function (e) {
        if (e && e.id) map[e.id] = (e.stm_refs || []).slice();
    });
    return map;
}

// ltm_modified 的 changes[field] 既可能是 {old,new}（events.js 巩固路径），
// 也可能是裸数组（保留字段 stm_refs_added）。统一抽出"新增引用"集合。
function _extractAddedRefs(changes) {
    if (!changes) return [];
    var explicit = changes.stm_refs_added;
    if (Array.isArray(explicit)) return explicit;
    if (explicit && Array.isArray(explicit.new)) return explicit.new;
    var whole = changes.stm_refs;
    if (whole && Array.isArray(whole.new)) {
        var oldRefs = Array.isArray(whole.old) ? whole.old : [];
        return whole.new.filter(function (r) { return oldRefs.indexOf(r) === -1; });
    }
    return [];
}

/**
 * State 重抽计划。
 *
 * @param {{deltas: object[], targetSeq?: number}} params
 *   deltas: listStateDeltas 结果（newest-first，元素为 {seq, source, changes, message_dates}）
 *   targetSeq 缺省时取最新一条 ai_update
 * @returns {{ok: boolean, reason: string|null, startSeq?: number, scopeSeqs?: number[],
 *   affectedPaths?: string[], messageIds?: string[],
 *   conflicts?: {seq: number, source: string, kind: 'precise'|'coarse', paths: string[]}[]}}
 */
export function buildStateRerollPlan(params) {
    var deltas = (params && params.deltas) || [];
    var targetSeq = params ? params.targetSeq : null;
    var sorted = _bySeqAsc(deltas);

    var target = null;
    var i;
    if (targetSeq != null) {
        for (i = 0; i < sorted.length; i++) {
            if (sorted[i].seq === targetSeq) { target = sorted[i]; break; }
        }
        if (!target) return { ok: false, reason: 'target_not_found', conflicts: [] };
    } else {
        for (i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].source === STATE_AI_SOURCE) { target = sorted[i]; break; }
        }
        if (!target) return { ok: false, reason: 'target_not_found', conflicts: [] };
    }
    if (target.source !== STATE_AI_SOURCE) return { ok: false, reason: 'target_not_ai', conflicts: [] };

    var startSeq = target.seq;
    var scope = sorted.filter(function (d) {
        return d.seq >= startSeq && d.source === STATE_AI_SOURCE;
    });
    if (scope.length === 0) return { ok: false, reason: 'empty_scope', conflicts: [] };

    // scope 之后由 ne_char_update 写入的 path：不回溯，避免覆盖角色卡正则协议产物
    var protectedPaths = {};
    sorted.forEach(function (d) {
        if (d.seq <= startSeq) return;
        if (STATE_PROTECTED_SOURCES.indexOf(d.source) === -1) return;
        (d.changes || []).forEach(function (c) {
            if (c && c.path) protectedPaths[c.path] = true;
        });
    });

    var pathList = [];
    scope.forEach(function (d) {
        (d.changes || []).forEach(function (c) {
            if (c && c.path) pathList.push(c.path);
        });
    });
    var affectedPaths = _dedupe(pathList).filter(function (p) { return !protectedPaths[p]; });

    var conflicts = [];
    sorted.forEach(function (d) {
        if (d.seq <= startSeq || d.source !== STATE_MANUAL_SOURCE) return;
        var changes = d.changes || [];
        if (changes.length === 0) {
            // 旧记录无 path 信息，只能粗粒度提示
            conflicts.push({ seq: d.seq, source: d.source, kind: 'coarse', paths: [] });
            return;
        }
        var hits = _dedupe(changes.map(function (c) { return c && c.path; })).filter(function (p) {
            return affectedPaths.indexOf(p) !== -1;
        });
        if (hits.length > 0) {
            conflicts.push({ seq: d.seq, source: d.source, kind: 'precise', paths: hits });
        }
    });

    return {
        ok: true,
        reason: null,
        startSeq: startSeq,
        scopeSeqs: _bySeqAsc(scope).map(function (d) { return d.seq; }),
        affectedPaths: affectedPaths,
        messageIds: _flattenMsgIds(scope),
        conflicts: conflicts
    };
}

/**
 * Memory 重抽计划。含干跑（在 vault 副本上调用 rollbackByMsgIds），
 * 因此执行期删除量与 id 列表与计划完全一致。
 *
 * @param {{versions: object[], vault: object, targetSeq?: number}} params
 *   versions: listMemoryVersions 结果（newest-first）
 *   targetSeq 缺省时取最新一条 stm_batch
 * @returns {{ok: boolean, reason: string|null, startSeq?: number, scopeSeqs?: number[],
 *   entryIds?: string[], messageIds?: string[], willRemoveSTM?: number, willRemoveLTM?: number,
 *   removedSTMIds?: string[], removedLTMIds?: string[],
 *   ltmRefsModified?: {ltm_id: string, removedRefs: string[]}[],
 *   conflicts?: {seq: number, type: string, kind: 'precise'|'coarse', entryIds: string[]}[]}}
 */
export function buildMemoryRerollPlan(params) {
    var versions = (params && params.versions) || [];
    var vault = (params && params.vault) || {};
    var targetSeq = params ? params.targetSeq : null;
    var sorted = _bySeqAsc(versions);

    var target = null;
    var i;
    if (targetSeq != null) {
        for (i = 0; i < sorted.length; i++) {
            if (sorted[i].seq === targetSeq) { target = sorted[i]; break; }
        }
        if (!target) return { ok: false, reason: 'target_not_found', conflicts: [] };
    } else {
        for (i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].type === MEM_AI_TYPE) { target = sorted[i]; break; }
        }
        if (!target) return { ok: false, reason: 'target_not_found', conflicts: [] };
    }
    if (target.type !== MEM_AI_TYPE) return { ok: false, reason: 'target_not_ai', conflicts: [] };

    var startSeq = target.seq;
    var scope = sorted.filter(function (v) {
        return v.seq >= startSeq && v.type === MEM_AI_TYPE;
    });
    if (scope.length === 0) return { ok: false, reason: 'empty_scope', conflicts: [] };

    var messageIds = _flattenMsgIds(scope);

    var entryIdList = [];
    scope.forEach(function (v) {
        ((v.delta && v.delta.stm_added) || []).forEach(function (e) {
            if (e && e.id) entryIdList.push(e.id);
        });
    });
    var entryIds = _dedupe(entryIdList);
    var entryIdSet = {};
    entryIds.forEach(function (id) { entryIdSet[id] = true; });

    // 干跑：与执行期共用同一原语，结果完全一致
    var preview = JSON.parse(JSON.stringify(vault));
    var beforeSTMIds = _collectStmIds(preview);
    var beforeLtmRefs = _collectLtmRefs(preview);
    var counts = rollbackByMsgIds(preview, messageIds);
    var afterSTMIds = _collectStmIds(preview);
    var afterLtmRefs = _collectLtmRefs(preview);

    var afterSTMIdSet = {};
    afterSTMIds.forEach(function (id) { afterSTMIdSet[id] = true; });
    var removedSTMIds = beforeSTMIds.filter(function (id) { return !afterSTMIdSet[id]; });

    var removedLTMIds = [];
    var ltmRefsModified = [];
    Object.keys(beforeLtmRefs).forEach(function (id) {
        if (!afterLtmRefs[id]) {
            removedLTMIds.push(id);
            return;
        }
        var before = beforeLtmRefs[id];
        var after = afterLtmRefs[id];
        var removedRefs = before.filter(function (r) { return after.indexOf(r) === -1; });
        if (removedRefs.length > 0) ltmRefsModified.push({ ltm_id: id, removedRefs: removedRefs });
    });

    var conflicts = [];
    sorted.forEach(function (v) {
        if (v.seq <= startSeq || v.type === MEM_AI_TYPE) return;
        var d = v.delta || {};
        var hitIds = [];
        // 这些 id 已被本次重抽波及（条目被移除 / 移动 / 编辑，或已巩固进叙事弧）
        ['stm_removed', 'stm_moved', 'stm_modified'].forEach(function (key) {
            (d[key] || []).forEach(function (id) {
                if (entryIdSet[id]) hitIds.push(id);
            });
        });
        (d.ltm_modified || []).forEach(function (mod) {
            _extractAddedRefs(mod && mod.changes).forEach(function (ref) {
                if (entryIdSet[ref]) hitIds.push(ref);
            });
        });
        hitIds = _dedupe(hitIds);
        if (hitIds.length > 0) {
            conflicts.push({ seq: v.seq, type: v.type, kind: 'precise', entryIds: hitIds });
        } else if (v.type === MEM_MANUAL_TYPE) {
            conflicts.push({ seq: v.seq, type: v.type, kind: 'coarse', entryIds: [] });
        }
    });

    return {
        ok: true,
        reason: null,
        startSeq: startSeq,
        scopeSeqs: _bySeqAsc(scope).map(function (v) { return v.seq; }),
        entryIds: entryIds,
        messageIds: messageIds,
        willRemoveSTM: counts.removedSTM,
        willRemoveLTM: counts.removedLTM,
        removedSTMIds: removedSTMIds,
        removedLTMIds: removedLTMIds,
        ltmRefsModified: ltmRefsModified,
        conflicts: conflicts
    };
}

/**
 * 计算 state 补偿 changes：把一组 path 撤销到「起点之前」的状态。
 * headState 缺该 path 而 beforeState 有 → { path, old: cur, remove: true }。
 *
 * @param {{headState: object, beforeState: object, paths: string[]}} params
 * @returns {({path: string, old: *, new: *}|{path: string, old: *, remove: true})[]}
 */
export function computeStateRevertChanges(params) {
    var headState = (params && params.headState) || {};
    var beforeState = (params && params.beforeState) || {};
    var paths = (params && params.paths) || [];
    var changes = [];
    for (var i = 0; i < paths.length; i++) {
        var path = paths[i];
        var cur = getByPath(headState, path);
        var prev = getByPath(beforeState, path);
        if (cur === undefined && prev === undefined) continue;
        if (prev === undefined) changes.push({ path: path, old: cur, remove: true });
        else changes.push({ path: path, old: cur, new: prev });
    }
    return changes;
}
