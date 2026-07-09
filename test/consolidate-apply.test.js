import { applyLtmDecision, findOpenLtm } from '../src/core/engine/consolidate.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== consolidate-apply: LTM decision application ===');

// --- applyLtmDecision: append to new (no open LTM) ---
var vault1 = {
    content: {
        ltm_entries: [],
        unconsolidated_stm: [
            { id: 'stm_1', event: 'e1', period: 'Day 1', msgRange: [0, 1] },
            { id: 'stm_2', event: 'e2', period: 'Day 1', msgRange: [2, 3] }
        ],
        stm_entries: []
    }
};
applyLtmDecision(vault1, {
    action: 'append',
    updated_title: 'New Arc',
    updated_event: 'Something happened'
}, ['stm_1', 'stm_2']);
eq(vault1.content.ltm_entries.length, 1, 'append creates new LTM entry');
eq(vault1.content.ltm_entries[0].status, 'open', 'new LTM is open');
eq(vault1.content.ltm_entries[0].title, 'New Arc', 'title preserved');
eq(vault1.content.ltm_entries[0].stm_refs.length, 2, 'two stm_refs added');

// --- applyLtmDecision: append to existing open LTM ---
var vault2 = {
    content: {
        ltm_entries: [{
            id: 'ltm_1', status: 'open', title: 'Ongoing',
            stm_refs: ['stm_1', 'stm_2'], entities: []
        }],
        unconsolidated_stm: [
            { id: 'stm_3', event: 'e3', period: 'Day 2', msgRange: [4, 5] }
        ],
        stm_entries: []
    }
};
applyLtmDecision(vault2, {
    action: 'append',
    updated_title: 'Updated Arc',
    updated_event: 'Continued'
}, ['stm_3']);
eq(vault2.content.ltm_entries.length, 1, 'append to open LTM does not create new');
eq(vault2.content.ltm_entries[0].title, 'Updated Arc', 'title updated');
eq(vault2.content.ltm_entries[0].stm_refs.length, 1, 'stm_refs replaced (old refs not in allSTM, only stm_3 remains)');

// --- applyLtmDecision: close_and_new ---
var vault3 = {
    content: {
        ltm_entries: [{
            id: 'ltm_1', status: 'open', title: 'Old Arc',
            stm_refs: ['stm_1'], entities: []
        }],
        unconsolidated_stm: [
            { id: 'stm_2', event: 'e2', period: 'Day 5', msgRange: [10, 11] }
        ],
        stm_entries: []
    }
};
applyLtmDecision(vault3, {
    action: 'close_and_new',
    updated_title: 'New Beginning',
    updated_event: 'A fresh start'
}, ['stm_2']);
eq(vault3.content.ltm_entries.length, 2, 'close_and_new creates second LTM');
eq(vault3.content.ltm_entries[0].status, 'closed', 'old LTM closed');
eq(vault3.content.ltm_entries[1].status, 'open', 'new LTM open');

// --- applyLtmDecision: null decision ---
var vault4 = { content: { ltm_entries: [] } };
applyLtmDecision(vault4, null, []);
eq(vault4.content.ltm_entries.length, 0, 'null decision does nothing');

// --- applyLtmDecision: append creates id ---
var vault5 = {
    content: { ltm_entries: [], unconsolidated_stm: [{ id: 'stm_x', event: 'test', msgRange: [0, 0] }], stm_entries: [] }
};
applyLtmDecision(vault5, { action: 'append' }, ['stm_x']);
assert(vault5.content.ltm_entries[0].id, 'new LTM gets an id');
eq(vault5.content.ltm_entries[0].title, '', 'new LTM gets empty title when LLM provides no updated_title');

console.log('\n--- consolidate-apply: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
