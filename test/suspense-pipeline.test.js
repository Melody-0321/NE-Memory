import { validateSuspenseDecisions } from '../src/core/engine/validate.js';
import { findNextSuspenseId, findOpenSuspense, getNewStmEntries, updateSuspenseCursor, checkSuspenseUpdate } from '../src/core/engine/suspense-pipeline.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== suspense-pipeline: validateSuspenseDecisions ===');

// Valid actions
var d1 = validateSuspenseDecisions([
    { action: 'raise', title: 'Mystery Pendant', event: 'A glowing pendant found in the well', category: 'suspense', stm_ref: 'stm_1', present_characters: ['Hero'] },
    { action: 'develop', hook_id: 'suspense_1', stm_ref: 'stm_3' },
    { action: 'resolve', hook_id: 'suspense_2', outcome: 'done', resolution_note: 'Prophecy fulfilled' },
    { action: 'resolve', hook_id: 'suspense_3', outcome: 'cancelled', resolution_note: 'No longer needed' }
]);
assert(d1 !== null, 'valid decisions returned non-null');
eq(d1.length, 4, 'all 4 valid decisions kept');

// Non-array returns null
eq(validateSuspenseDecisions('not array'), null, 'string returns null');
eq(validateSuspenseDecisions(null), null, 'null returns null');
eq(validateSuspenseDecisions(undefined), null, 'undefined returns null');

// Empty array returns empty
var d2 = validateSuspenseDecisions([]);
assert(d2 !== null, 'empty array returns non-null');
eq(d2.length, 0, 'empty array stays empty');

// Invalid action filtered out
var d3 = validateSuspenseDecisions([
    { action: 'raise', title: 'Valid Hook', event: 'desc' },
    { action: 'invalid_action', hook_id: 'suspense_1' }
]);
eq(d3.length, 1, 'invalid action filtered');
eq(d3[0].action, 'raise', 'valid raise kept');

// raise without title filtered
var d4 = validateSuspenseDecisions([
    { action: 'raise', event: 'no title' },
    { action: 'raise', title: '  ', event: 'whitespace title' }
]);
eq(d4.length, 0, 'raise without title filtered');

// develop without hook_id filtered
var d5 = validateSuspenseDecisions([
    { action: 'develop', stm_ref: 'stm_1' }
]);
eq(d5.length, 0, 'develop without hook_id filtered');

// Title truncation
var longTitle = 'A'.repeat(50);
var d6 = validateSuspenseDecisions([
    { action: 'raise', title: longTitle, event: 'desc' }
]);
eq(d6[0].title.length, 40, 'title truncated to 40 chars');

// Event truncation
var longEvent = 'B'.repeat(250);
var d7 = validateSuspenseDecisions([
    { action: 'raise', title: 'Hook', event: longEvent }
]);
eq(d7[0].event.length, 200, 'event truncated to 200 chars');

// Invalid category defaults to suspense
var d8 = validateSuspenseDecisions([
    { action: 'raise', title: 'Hook', event: 'desc', category: 'invalid_cat' }
]);
eq(d8[0].category, 'suspense', 'invalid category defaults to suspense');

// resolve without outcome defaults to done
var d10 = validateSuspenseDecisions([
    { action: 'resolve', hook_id: 'suspense_1', resolution_note: 'resolved it' }
]);
eq(d10[0].outcome, 'done', 'resolve missing outcome defaults to done');

// invalid outcome defaults to done
var d11 = validateSuspenseDecisions([
    { action: 'resolve', hook_id: 'suspense_1', outcome: 'bogus', resolution_note: 'x' }
]);
eq(d11[0].outcome, 'done', 'invalid outcome defaults to done');

// abandon action is no longer valid → filtered out
var d12 = validateSuspenseDecisions([
    { action: 'abandon', hook_id: 'suspense_1' }
]);
eq(d12.length, 0, 'abandon action filtered out');

// Null/undefined entries in array filtered
var d9 = validateSuspenseDecisions([null, undefined, { action: 'raise', title: 'OK', event: 'desc' }]);
eq(d9.length, 1, 'null/undefined entries filtered');

console.log('\n=== suspense-pipeline: findNextSuspenseId ===');

eq(findNextSuspenseId({ content: { suspense_entries: [] } }), 'suspense_1', 'empty entries → suspense_1');
eq(findNextSuspenseId({ content: { suspense_entries: [{ id: 'suspense_1' }, { id: 'suspense_3' }] } }), 'suspense_4', 'gaps in ids → max+1');
eq(findNextSuspenseId({ content: {} }), 'suspense_1', 'no entries field → suspense_1');
eq(findNextSuspenseId({}), 'suspense_1', 'no content → suspense_1');

console.log('\n=== suspense-pipeline: findOpenSuspense ===');

var vault1 = { content: { suspense_entries: [
    { id: 'suspense_1', status: 'open' },
    { id: 'suspense_2', status: 'resolved' },
    { id: 'suspense_3', status: 'open' }
]}};
var open1 = findOpenSuspense(vault1);
eq(open1.length, 2, 'found 2 open hooks');
eq(open1[0].id, 'suspense_1', 'first open is suspense_1');

var vault2 = { content: { suspense_entries: [
    { id: 'suspense_1', status: 'resolved' }
]}};
eq(findOpenSuspense(vault2).length, 0, 'no open hooks');

eq(findOpenSuspense({ content: {} }).length, 0, 'no entries field');

console.log('\n=== suspense-pipeline: getNewStmEntries ===');

// Cursor null → all STM entries
var vault3 = { content: {
    suspense_cursor: null,
    stm_entries: [
        { id: 'stm_1', event: 'A' },
        { id: 'stm_2', event: 'B' },
        { id: 'stm_3', event: 'C' }
    ]
}};
var new1 = getNewStmEntries(vault3);
eq(new1.length, 3, 'null cursor → all 3 entries');

// Cursor at stm_1 → entries after 1
var vault4 = { content: {
    suspense_cursor: 'stm_1',
    stm_entries: [
        { id: 'stm_1', event: 'A' },
        { id: 'stm_2', event: 'B' },
        { id: 'stm_3', event: 'C' }
    ]
}};
var new2 = getNewStmEntries(vault4);
eq(new2.length, 2, 'cursor at stm_1 → 2 new entries');
eq(new2[0].id, 'stm_2', 'first new is stm_2');

// Cursor at stm_3 → no new entries
var vault5 = { content: {
    suspense_cursor: 'stm_3',
    stm_entries: [
        { id: 'stm_1', event: 'A' },
        { id: 'stm_2', event: 'B' },
        { id: 'stm_3', event: 'C' }
    ]
}};
eq(getNewStmEntries(vault5).length, 0, 'cursor at last → 0 new entries');

// Cursor beyond STM range (rollback scenario)
var vault6 = { content: {
    suspense_cursor: 'stm_10',
    stm_entries: [
        { id: 'stm_1', event: 'A' },
        { id: 'stm_2', event: 'B' }
    ]
}};
eq(getNewStmEntries(vault6).length, 0, 'cursor beyond range → 0 (rollback safe)');

// No STM entries
eq(getNewStmEntries({ content: { stm_entries: [] } }).length, 0, 'empty STM → 0');

// ── 双区扫描：unconsolidated_stm 中的新 STM 也应被检测 ──
var dualVault1 = { content: {
    suspense_cursor: null,
    unconsolidated_stm: [
        { id: 'stm_1', event: 'A' },
        { id: 'stm_2', event: 'B' }
    ],
    stm_entries: [
        { id: 'stm_3', event: 'C' }
    ]
}};
var new3 = getNewStmEntries(dualVault1);
eq(new3.length, 3, '双区扫描: unconsolidated + stm_entries 全部计入');
eq(new3[0].id, 'stm_1', '双区扫描: 按 id 升序');
eq(new3[2].id, 'stm_3', '双区扫描: stm_entries 条目也在列');

// 跨区去重：同 id 同时出现在两个区时不重复
var dualVault2 = { content: {
    suspense_cursor: null,
    unconsolidated_stm: [{ id: 'stm_1', event: 'A' }],
    stm_entries: [{ id: 'stm_1', event: 'A' }]
}};
eq(getNewStmEntries(dualVault2).length, 1, '跨区同 id 去重 → 1');

// 游标在 stm_entries 区，unconsolidated 区的新条目仍被检测
var dualVault3 = { content: {
    suspense_cursor: 'stm_3',
    unconsolidated_stm: [{ id: 'stm_4', event: 'D' }],
    stm_entries: [{ id: 'stm_1', event: 'A' }, { id: 'stm_3', event: 'C' }]
}};
var new4 = getNewStmEntries(dualVault3);
eq(new4.length, 1, '双区扫描: cursor 跨区正确跳过旧条目');
eq(new4[0].id, 'stm_4', '双区扫描: 新条目在 unconsolidated_stm 也被发现');

console.log('\n=== suspense-pipeline: updateSuspenseCursor ===');

var curVault = { content: {} };
updateSuspenseCursor(curVault, 'stm_5');
eq(curVault.content.suspense_cursor, 'stm_5', 'cursor updated');

updateSuspenseCursor({ content: {} }, 'stm_99');
// Should not throw

console.log('\n=== suspense-pipeline: checkSuspenseUpdate (no LLM) ===');

// No new STM → false, no LLM call
async function testNoNewStm() {
    var vault8 = { id: 'test', content: { suspense_entries: [], suspense_cursor: 'stm_5', stm_entries: [{ id: 'stm_1' }] } };
    var result = await checkSuspenseUpdate('test', vault8, async function() { throw new Error('Should not call LLM'); });
    eq(result, false, 'no new STM → false');
}
await testNoNewStm();

// LLM failure → cursor advances, returns false
async function testLlmFailure() {
    var vault9 = { id: 'test', content: { suspense_entries: [], suspense_cursor: null, stm_entries: [{ id: 'stm_1', event: 'A', period: 'Ch1' }] } };
    var result = await checkSuspenseUpdate('test', vault9, async function() { throw new Error('LLM down'); });
    eq(result, false, 'LLM failure → false');
    eq(vault9.content.suspense_cursor, 'stm_1', 'cursor advanced despite failure');
}
await testLlmFailure();

// Empty decisions → cursor advances, returns false
async function testEmptyDecisions() {
    var vault10 = { id: 'test', content: { suspense_entries: [], suspense_cursor: null, stm_entries: [{ id: 'stm_1', event: 'A', period: 'Ch1' }] } };
    var result = await checkSuspenseUpdate('test', vault10, async function() {
        return JSON.stringify({ suspense_decisions: [] });
    });
    eq(result, false, 'empty decisions → false');
    eq(vault10.content.suspense_cursor, 'stm_1', 'cursor advanced on empty decisions');
}
await testEmptyDecisions();

// Raise decision → new hook created
async function testRaise() {
    var vault11 = { id: 'test', content: { suspense_entries: [], suspense_cursor: null,
        stm_entries: [{ id: 'stm_1', event: 'Found a mysterious pendant', period: 'Ch1', present_characters: ['Hero'] }]
    }};
    var result = await checkSuspenseUpdate('test', vault11, async function() {
        return JSON.stringify({ suspense_decisions: [
            { action: 'raise', title: 'Mystery Pendant', event: 'A glowing pendant found in the well', category: 'suspense', stm_ref: 'stm_1', present_characters: ['Hero', 'Old Man'] }
        ]});
    });
    eq(result, true, 'raise → true');
    eq(vault11.content.suspense_entries.length, 1, '1 hook created');
    eq(vault11.content.suspense_entries[0].id, 'suspense_1', 'id is suspense_1');
    eq(vault11.content.suspense_entries[0].status, 'open', 'status is open');
    eq(vault11.content.suspense_entries[0].category, 'suspense', 'category saved as suspense');
    eq(vault11.content.suspense_entries[0].raised_at_period, 'Ch1', 'period derived from STM');
    eq(vault11.content.suspense_cursor, 'stm_1', 'cursor advanced');
}
await testRaise();

// Resolve decision → hook closed with outcome
async function testResolve() {
    var vault12 = { id: 'test', content: {
        suspense_entries: [{ id: 'suspense_1', status: 'open', title: 'Old Hook', event: 'desc', stm_refs: ['stm_1'], raised_at_period: 'Ch1', present_characters: [] }],
        suspense_cursor: 'stm_1',
        stm_entries: [{ id: 'stm_1', event: 'A', period: 'Ch1' }, { id: 'stm_2', event: 'Prophecy fulfilled', period: 'Ch2' }]
    }};
    var result = await checkSuspenseUpdate('test', vault12, async function() {
        return JSON.stringify({ suspense_decisions: [
            { action: 'resolve', hook_id: 'suspense_1', outcome: 'done', resolution_note: 'Prophecy came true', stm_ref: 'stm_2' }
        ]});
    });
    eq(result, true, 'resolve → true');
    eq(vault12.content.suspense_entries[0].status, 'resolved', 'status changed to resolved');
    eq(vault12.content.suspense_entries[0].outcome, 'done', 'outcome saved as done');
    eq(vault12.content.suspense_entries[0].resolution_note, 'Prophecy came true', 'resolution_note saved');
    eq(vault12.content.suspense_entries[0].resolved_at_period, 'Ch2', 'resolved period derived from STM');
    eq(vault12.content.suspense_cursor, 'stm_2', 'cursor advanced');
}
await testResolve();

// Develop decision → stm_ref added
async function testDevelop() {
    var vault13 = { id: 'test', content: {
        suspense_entries: [{ id: 'suspense_1', status: 'open', title: 'Hook', event: 'desc', stm_refs: ['stm_1'], raised_at_period: 'Ch1', present_characters: ['Hero'] }],
        suspense_cursor: 'stm_1',
        stm_entries: [{ id: 'stm_1', event: 'A', period: 'Ch1' }, { id: 'stm_2', event: 'Pendant glows', period: 'Ch2', present_characters: ['Hero', 'Sage'] }]
    }};
    var result = await checkSuspenseUpdate('test', vault13, async function() {
        return JSON.stringify({ suspense_decisions: [
            { action: 'develop', hook_id: 'suspense_1', stm_ref: 'stm_2' }
        ]});
    });
    eq(result, true, 'develop → true');
    eq(vault13.content.suspense_entries[0].stm_refs.length, 2, 'stm_ref added');
    eq(vault13.content.suspense_entries[0].stm_refs[1], 'stm_2', 'correct stm_ref');
    var chars = vault13.content.suspense_entries[0].present_characters;
    eq(chars.length, 2, 'characters merged: Hero + Sage');
    eq(chars.indexOf('Sage') !== -1, true, 'Sage added to characters');
}
await testDevelop();

// Cancel decision → hook closed with outcome cancelled
async function testCancelled() {
    var vault14 = { id: 'test', content: {
        suspense_entries: [{ id: 'suspense_1', status: 'open', title: 'Hook', event: 'desc', stm_refs: ['stm_1'], raised_at_period: 'Ch1', present_characters: [] }],
        suspense_cursor: 'stm_1',
        stm_entries: [{ id: 'stm_1', event: 'A', period: 'Ch1' }, { id: 'stm_2', event: 'Matter dropped', period: 'Ch2' }]
    }};
    var result = await checkSuspenseUpdate('test', vault14, async function() {
        return JSON.stringify({ suspense_decisions: [
            { action: 'resolve', hook_id: 'suspense_1', outcome: 'cancelled', resolution_note: 'Deal fell through' }
        ]});
    });
    eq(result, true, 'cancel → true');
    eq(vault14.content.suspense_entries[0].status, 'resolved', 'status changed to resolved');
    eq(vault14.content.suspense_entries[0].outcome, 'cancelled', 'outcome saved as cancelled');
}
await testCancelled();

console.log('\n--- suspense-pipeline: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
