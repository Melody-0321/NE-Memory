// Node.js localStorage polyfill (not available in Node) — reroll-plan 间接依赖 store.js / state-versions.js
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

import { buildStateRerollPlan, buildMemoryRerollPlan, computeStateRevertChanges } from '../src/core/engine/reroll-plan.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function deepEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + JSON.stringify(val) + ')'); }

// ====== state: scope / affectedPaths ======
console.log('\n=== reroll-plan: state scope & affectedPaths ===');

// listStateDeltas 返回 newest-first
var stateDeltas = [
    { seq: 5, source: 'manual_edit', changes: [{ path: 'characters.A.status', old: 'x', new: 'y' }], message_dates: [] },
    { seq: 4, source: 'ne_char_update', changes: [{ path: 'characters.A.hp', old: 1, new: 10 }], message_dates: ['m4'] },
    { seq: 3, source: 'ai_update', changes: [{ path: 'characters.A.status', old: 'a', new: 'b' }, { path: 'characters.A.status', old: 'a', new: 'b' }, { path: 'characters.B.mood', old: '', new: 'x' }], message_dates: ['m3'] },
    { seq: 2, source: 'manual_edit', changes: [], message_dates: [] },
    { seq: 1, source: 'ai_update', changes: [{ path: 'story_time', old: 'd1', new: 'd2' }], message_dates: ['m1'] },
    { seq: 0, source: 'init', changes: [], message_dates: [] }
];

var sp = buildStateRerollPlan({ deltas: stateDeltas });
eq(sp.ok, true, 'state plan ok');
eq(sp.startSeq, 3, 'default target = newest ai_update (seq 3)');
deepEq(sp.scopeSeqs, [3], 'scope = only the target ai_update');
deepEq(sp.affectedPaths, ['characters.A.status', 'characters.B.mood'], 'affectedPaths deduped');
deepEq(sp.messageIds, ['m3'], 'messageIds from scope message_dates');
eq(sp.conflicts.length, 1, 'one conflict detected');
eq(sp.conflicts[0].kind, 'precise', 'manual_edit with matching path → precise');
eq(sp.conflicts[0].seq, 5, 'conflict seq');
deepEq(sp.conflicts[0].paths, ['characters.A.status'], 'conflict paths');

// 空 delta 的 manual_edit → coarse
var stateDeltasCoarse = stateDeltas.map(function (d) {
    return d.seq === 5 ? { seq: 5, source: 'manual_edit', changes: [], message_dates: [] } : d;
});
var spCoarse = buildStateRerollPlan({ deltas: stateDeltasCoarse });
eq(spCoarse.conflicts.length, 1, 'coarse: one conflict');
eq(spCoarse.conflicts[0].kind, 'coarse', 'empty-delta manual_edit → coarse');

// 无冲突：manual_edit 编辑的是无关字段
var stateDeltasNoConflict = [
    { seq: 2, source: 'manual_edit', changes: [{ path: 'characters.Z.name', old: '', new: 'z' }], message_dates: [] },
    { seq: 1, source: 'ai_update', changes: [{ path: 'story_time', old: 'a', new: 'b' }], message_dates: ['m1'] }
];
eq(buildStateRerollPlan({ deltas: stateDeltasNoConflict }).conflicts.length, 0, 'unrelated manual_edit → no conflict');

// ====== state: ne_char_update 路径保护 ======
console.log('\n=== reroll-plan: ne_char_update protection ===');

var stateDeltasProtected = [
    { seq: 2, source: 'ne_char_update', changes: [{ path: 'characters.A.hp', old: 2, new: 9 }], message_dates: ['m2'] },
    { seq: 1, source: 'ai_update', changes: [{ path: 'characters.A.hp', old: 1, new: 2 }, { path: 'story_time', old: 'a', new: 'b' }], message_dates: ['m1'] }
];
var spProtected = buildStateRerollPlan({ deltas: stateDeltasProtected });
deepEq(spProtected.affectedPaths, ['story_time'], 'path written by later ne_char_update is excluded');
eq(spProtected.conflicts.length, 0, 'ne_char_update never counted as conflict');

// ====== state: state_reroll 不会被当作目标 ======
console.log('\n=== reroll-plan: state_reroll is not a reroll target ===');

var stateDeltasRerolled = [
    { seq: 7, source: 'state_reroll', changes: [{ path: 'story_time', old: 'b', new: 'a' }], message_dates: ['m5'] },
    { seq: 6, source: 'ai_update', changes: [{ path: 'story_time', old: 'a', new: 'b' }], message_dates: ['m5'] }
];
var spRerolled = buildStateRerollPlan({ deltas: stateDeltasRerolled });
eq(spRerolled.startSeq, 6, 'default target skips state_reroll');

// ====== state: 边界 ======
console.log('\n=== reroll-plan: state boundaries ===');

eq(buildStateRerollPlan({ deltas: stateDeltas, targetSeq: 999 }).reason, 'target_not_found', 'missing seq → target_not_found');
eq(buildStateRerollPlan({ deltas: stateDeltas, targetSeq: 5 }).reason, 'target_not_ai', 'manual_edit target → target_not_ai');
eq(buildStateRerollPlan({ deltas: [] }).reason, 'target_not_found', 'empty chain → target_not_found');
eq(buildStateRerollPlan({ deltas: [] }).ok, false, 'failure returns ok:false');

// ====== state: computeStateRevertChanges ======
console.log('\n=== reroll-plan: computeStateRevertChanges ===');

var headState = { story_time: 'b', characters: { A: { hp: 9, status: 'b' } } };
var beforeState = { story_time: 'a', characters: { A: { hp: 9 } } };

var changes = computeStateRevertChanges({
    headState: headState,
    beforeState: beforeState,
    paths: ['story_time', 'characters.A.status', 'nonexistent.path']
});
deepEq(changes, [
    { path: 'story_time', old: 'b', new: 'a' },
    { path: 'characters.A.status', old: 'b', remove: true }
], 'revert changes: normal / remove / both-undefined-skipped');

deepEq(computeStateRevertChanges({ headState: {}, beforeState: {}, paths: ['a.b'] }), [], 'nothing to revert → empty');

// head 缺该 path 而 before 有时 → 写入（非 remove）
deepEq(computeStateRevertChanges({ headState: {}, beforeState: { a: 1 }, paths: ['a'] }), [
    { path: 'a', old: undefined, new: 1 }
], 're-create path deleted after the target version');

// ====== memory: entryIds / messageIds / 干跑 ======
console.log('\n=== reroll-plan: memory plan & dry-run ===');

function buildVault() {
    return {
        content: {
            unconsolidated_stm: [
                { id: 's1', msg_ids: ['m1'], event: 'e1' },
                { id: 's3', msg_ids: ['m3'], event: 'e3' }
            ],
            stm_entries: [
                { id: 's2', msg_ids: ['m2'], event: 'e2', parent_ltm: 'l1' },
                { id: 's5', msg_ids: ['m9'], event: 'e5', parent_ltm: 'l1' }
            ],
            ltm_entries: [
                { id: 'l1', stm_refs: ['s2', 's5'], title: 'arc1' },
                { id: 'l2', stm_refs: ['s3'], title: 'arc2' }
            ]
        },
        stm_index: {
            s1: { ltm_id: null, msg_ids: ['m1'] },
            s2: { ltm_id: 'l1', msg_ids: ['m2'] },
            s3: { ltm_id: 'l2', msg_ids: ['m3'] },
            s5: { ltm_id: 'l1', msg_ids: ['m9'] }
        }
    };
}

var memVersions = [
    { seq: 3, type: 'manual_edit', delta: { stm_modified: ['s2'] }, message_dates: [] },
    { seq: 2, type: 'stm_batch', delta: { stm_added: [{ id: 's1' }, { id: 's2' }] }, message_dates: ['m1', 'm2'] },
    { seq: 1, type: 'stm_batch', delta: { stm_added: [{ id: 's3' }] }, message_dates: ['m3'] }
];

var vault = buildVault();
var vaultSnapshot = JSON.stringify(vault);
var mp = buildMemoryRerollPlan({ versions: memVersions, vault: vault });

eq(mp.ok, true, 'memory plan ok');
eq(mp.startSeq, 2, 'default target = newest stm_batch');
deepEq(mp.scopeSeqs, [2], 'memory scope = only the target stm_batch');
deepEq(mp.entryIds, ['s1', 's2'], 'entryIds from scope stm_added');
deepEq(mp.messageIds, ['m1', 'm2'], 'messageIds from scope message_dates');
eq(mp.willRemoveSTM, 2, 'dry-run removes 2 STM');
eq(mp.willRemoveLTM, 0, 'dry-run removes 0 LTM');
deepEq(mp.removedSTMIds, ['s1', 's2'], 'dry-run STM id diff');
deepEq(mp.removedLTMIds, [], 'dry-run LTM id diff (l1 survives with l2 refs pruned)');
deepEq(mp.ltmRefsModified, [{ ltm_id: 'l1', removedRefs: ['s2'] }], 'surviving LTM refs pruned recorded');
eq(mp.conflicts.length, 1, 'memory conflict detected');
eq(mp.conflicts[0].kind, 'precise', 'stm_modified hit → precise');
deepEq(mp.conflicts[0].entryIds, ['s2'], 'conflict entryIds');
eq(JSON.stringify(vault), vaultSnapshot, 'dry-run does not mutate the input vault');

// LTM 被完全删除
console.log('\n=== reroll-plan: memory LTM cascade removal ===');
var vault2 = buildVault();
vault2.content.ltm_entries[0].stm_refs = ['s2'];
var mp2 = buildMemoryRerollPlan({ versions: memVersions, vault: vault2 });
eq(mp2.willRemoveLTM, 1, 'LTM with all refs removed counted');
deepEq(mp2.removedLTMIds, ['l1'], 'cascade-removed LTM id');
deepEq(mp2.ltmRefsModified, [], 'no surviving-LTM ref pruning');

// ltm_modified 引用命中 → precise
console.log('\n=== reroll-plan: memory consolidation conflict ===');
var memVersionsConsol = memVersions.map(function (v) {
    return v.seq === 3
        ? { seq: 3, type: 'ltm_consolidation', delta: { ltm_modified: [{ ltm_id: 'l1', changes: { stm_refs: { old: [], new: ['s2'] } } }] }, message_dates: [] }
        : v;
});
var mp3 = buildMemoryRerollPlan({ versions: memVersionsConsol, vault: buildVault() });
eq(mp3.conflicts.length, 1, 'ltm_modified conflict detected');
eq(mp3.conflicts[0].kind, 'precise', 'stm_refs added referencing a removed STM → precise');
deepEq(mp3.conflicts[0].entryIds, ['s2'], 'consolidation conflict entryIds');

// 空 delta 的 manual_edit → coarse
console.log('\n=== reroll-plan: memory coarse conflict ===');
var memVersionsCoarse = memVersions.map(function (v) {
    return v.seq === 3 ? { seq: 3, type: 'manual_edit', delta: {}, message_dates: [] } : v;
});
var mp4 = buildMemoryRerollPlan({ versions: memVersionsCoarse, vault: buildVault() });
eq(mp4.conflicts.length, 1, 'coarse memory conflict detected');
eq(mp4.conflicts[0].kind, 'coarse', 'empty-delta manual_edit → coarse');

// ====== memory: 边界 ======
console.log('\n=== reroll-plan: memory boundaries ===');

eq(buildMemoryRerollPlan({ versions: memVersions, vault: buildVault(), targetSeq: 999 }).reason, 'target_not_found', 'missing seq → target_not_found');
eq(buildMemoryRerollPlan({ versions: memVersions, vault: buildVault(), targetSeq: 3 }).reason, 'target_not_ai', 'manual_edit target → target_not_ai');
eq(buildMemoryRerollPlan({ versions: [], vault: buildVault() }).reason, 'target_not_found', 'empty chain → target_not_found');

// stm_reroll 不会被当作目标
var memVersionsRerolled = [
    { seq: 4, type: 'stm_reroll', delta: { stm_removed: ['s1'] }, message_dates: ['m1'] },
    { seq: 3, type: 'stm_batch', delta: { stm_added: [{ id: 's1' }] }, message_dates: ['m1'] }
];
eq(buildMemoryRerollPlan({ versions: memVersionsRerolled, vault: buildVault() }).startSeq, 3, 'default target skips stm_reroll');

console.log('\n=== reroll-plan: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
