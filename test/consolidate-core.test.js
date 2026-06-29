import { findOpenLtm, computeClosureSignals, isLtmEnabled, getLtmSummary, formatLtmCatalog, getNextEligibleStmId } from '../src/core/engine/consolidate.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

globalThis.localStorage = {
    _data: {},
    getItem: function(k) { return this._data[k] || null; },
    setItem: function(k, v) { this._data[k] = v; }
};
localStorage.setItem('ne_settings', JSON.stringify({ stmMaxUnconsolidated: 3 }));

console.log('\n=== consolidate-core: LTM consolidation logic ===');

// --- findOpenLtm: empty vault ---
var emptyVault = { content: {} };
eq(findOpenLtm(emptyVault), null, 'empty vault => null');

// --- findOpenLtm: single open LTM ---
var vaultWithOpen = {
    content: {
        ltm_entries: [
            { id: 'ltm_1', status: 'closed', title: 'Old' },
            { id: 'ltm_2', status: 'open', title: 'Current', stm_refs: ['stm_a', 'stm_b'] }
        ]
    }
};
var open = findOpenLtm(vaultWithOpen);
assert(open !== null, 'vault with open LTM returns non-null');
eq(open.title, 'Current', 'findOpenLtm returns correct open LTM');

// --- findOpenLtm: multiple open LTMs (should close all) ---
var vaultMultiOpen = {
    content: {
        ltm_entries: [
            { id: 'ltm_1', status: 'open', title: 'A' },
            { id: 'ltm_2', status: 'open', title: 'B' }
        ]
    }
};
var multiResult = findOpenLtm(vaultMultiOpen);
eq(multiResult, null, 'multiple open LTMs => null (all closed)');
eq(vaultMultiOpen.content.ltm_entries[0].status, 'closed', 'first LTM closed');
eq(vaultMultiOpen.content.ltm_entries[1].status, 'closed', 'second LTM closed');

// --- computeClosureSignals: null openLtm ---
eq(computeClosureSignals(null, []), null, 'null openLtm => null');

// --- computeClosureSignals: same entities ---
var openLtm1 = {
    entities: ['主角', '古神'],
    period: 'Day 1',
    scene: '古城'
};
var newEvents1 = [
    { entities: ['主角', '古神'], period: 'Day 1', scene: '古城' }
];
var signals1 = computeClosureSignals(openLtm1, newEvents1);
eq(signals1.timeGap, '同日', 'same day => 同日');
eq(signals1.sceneChange, false, 'same scene => no sceneChange');
assert(signals1.entityOverlap > 0.5, 'same entities => high overlap');

// --- computeClosureSignals: different day, scene, entities ---
var openLtm2 = {
    entities: ['主角'],
    period: 'Day 1',
    scene: '古城'
};
var newEvents2 = [
    { entities: ['newChar'], period: 'Day 5', scene: '森林' }
];
var signals2 = computeClosureSignals(openLtm2, newEvents2);
eq(signals2.timeGap, '跨日', 'different day => 跨日');
eq(signals2.sceneChange, true, 'different scene => sceneChange');
eq(signals2.entityOverlap, 0, 'different entities => 0 overlap');

// --- getLtmSummary ---
var summary = getLtmSummary(vaultWithOpen);
eq(summary.total, 2, 'getLtmSummary total=2');
eq(summary.open, 1, 'getLtmSummary open=1');
eq(summary.closed, 1, 'getLtmSummary closed=1');

// --- formatLtmCatalog ---
var catalog = formatLtmCatalog(vaultWithOpen.content.ltm_entries);
assert(catalog.indexOf('Old') !== -1, 'formatLtmCatalog includes closed LTM name');
assert(catalog.indexOf('Current') === -1, 'formatLtmCatalog excludes open LTM');

// --- isLtmEnabled ---
var vaultFewUnconsolidated = {
    content: { unconsolidated_stm: [{ id: 's1', parent_ltm: undefined }, { id: 's2', parent_ltm: undefined }] }
};
eq(isLtmEnabled(vaultFewUnconsolidated), false, 'isLtmEnabled: below threshold => false');

var vaultEnough = {
    content: { unconsolidated_stm: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }] }
};
eq(isLtmEnabled(vaultEnough), true, 'isLtmEnabled: at threshold => true');

// --- getNextEligibleStmId ---
var vaultEligible = {
    content: { unconsolidated_stm: [
        { id: 'stm_late', msgRange: [10, 12] },
        { id: 'stm_early', msgRange: [0, 2] },
        { id: 'stm_mid', msgRange: [5, 7] }
    ]}
};
var eligibleId = getNextEligibleStmId(vaultEligible);
eq(eligibleId, 'stm_early', 'getNextEligibleStmId returns earliest by msgRange');

console.log('\n--- consolidate-core: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
