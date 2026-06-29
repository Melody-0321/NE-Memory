import { validateLTMOutput, postFillLTM } from '../src/core/engine/validate.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (got ' + a + ')'); }

console.log('\n=== ltm-validate: LTM output validation ===');

// Setup localStorage for stmMinLtmMerge
globalThis.localStorage = {
    _data: {},
    getItem: function(k) { return this._data[k] || null; },
    setItem: function(k, v) { this._data[k] = v; }
};
localStorage.setItem('ne_settings', JSON.stringify({ stmMinLtmMerge: 3 }));

// --- validateLTMOutput: valid entry ---
var validEntry = {
    event: '主角探索了古城遗迹',
    title: '古城探索',
    stm_refs: ['stm_1', 'stm_2', 'stm_3']
};
var errors = validateLTMOutput({ ltm_entries: [validEntry] });
eq(errors.length, 0, 'valid LTM entry produces no errors');

// --- validateLTMOutput: missing event ---
var missingEvent = {
    event: '',
    stm_refs: ['stm_1', 'stm_2', 'stm_3']
};
var errors2 = validateLTMOutput({ ltm_entries: [missingEvent] });
gt(errors2.length, 0, 'empty event produces errors');

// --- validateLTMOutput: missing stm_refs ---
var missingRefs = {
    event: 'something happened',
    stm_refs: []
};
var errors3 = validateLTMOutput({ ltm_entries: [missingRefs] });
gt(errors3.length, 0, 'empty stm_refs produces errors');

// --- validateLTMOutput: empty title ---
var emptyTitle = {
    event: 'something happened',
    title: '',
    stm_refs: ['stm_1', 'stm_2', 'stm_3']
};
var errors4 = validateLTMOutput({ ltm_entries: [emptyTitle] });
gt(errors4.length, 0, 'empty title produces errors');

// --- validateLTMOutput: empty entries ---
var errors5 = validateLTMOutput({ ltm_entries: [] });
eq(errors5.length, 0, 'empty entries produces no errors');

// --- postFillLTM: fills missing id ---
var sourceSTM = [
    { id: 'stm_1', event: '探索古城', period: 'Day 1' },
    { id: 'stm_2', event: '发现秘境', period: 'Day 1' },
    { id: 'stm_3', event: '进入秘境', period: 'Day 2' }
];
var ltmResult = { ltm_entries: [{ event: '探索古城秘境', stm_refs: ['stm_1', 'stm_2', 'stm_3'] }] };
var filled = postFillLTM(ltmResult, sourceSTM);
eq(filled.ltm_entries[0].id.indexOf('ltm_'), 0, 'postFillLTM generates ltm_ id');
eq(filled.ltm_entries[0].status, 'closed', 'postFillLTM defaults status to closed');
assert(filled.ltm_entries[0].title, 'postFillLTM fills title from event');

// --- postFillLTM: preserves existing id and title ---
var ltmResult2 = { ltm_entries: [{ id: 'ltm_99', title: 'Custom Title', event: 'something', stm_refs: ['stm_1'] }] };
var filled2 = postFillLTM(ltmResult2, sourceSTM);
eq(filled2.ltm_entries[0].id, 'ltm_99', 'postFillLTM preserves existing id');
eq(filled2.ltm_entries[0].title, 'Custom Title', 'postFillLTM preserves existing title');

console.log('\n--- ltm-validate: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
