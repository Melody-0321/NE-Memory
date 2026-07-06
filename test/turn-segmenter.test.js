import { groupMessagesIntoTurns, collectMsgIdsFromTurns, getTurnMsgRange, formatTurnsText } from '../src/core/engine/turn-segmenter.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function contains(a, b, msg) { assert(a.indexOf(b) !== -1, msg); }

console.log('\n=== turn-segmenter: Grouping and ID extraction ===');

// --- groupMessagesIntoTurns: basic user+assistant pair ---
var msgs1 = [
    { role: 'user', mes_id: 0, mes: 'Hello', is_user: true },
    { role: 'assistant', mes_id: 1, mes: 'Hi' }
];
var turns1 = groupMessagesIntoTurns(msgs1);
eq(turns1.length, 1, 'one turn from user+assistant');
assert(turns1[0].user !== null, 'turn has user');
assert(turns1[0].assistant !== null, 'turn has assistant');
eq(turns1[0].user.mes, 'Hello', 'user message preserved');
eq(turns1[0].assistant.mes, 'Hi', 'assistant message preserved');

// --- groupMessagesIntoTurns: multiple turns ---
var msgs2 = [
    { role: 'user', mes_id: 0, mes: 'Q1', is_user: true },
    { role: 'assistant', mes_id: 1, mes: 'A1' },
    { role: 'user', mes_id: 2, mes: 'Q2', is_user: true },
    { role: 'assistant', mes_id: 3, mes: 'A2' }
];
var turns2 = groupMessagesIntoTurns(msgs2);
eq(turns2.length, 2, 'two turns from user+assistant pairs');
eq(turns2[0].assistant.mes, 'A1', 'first turn assistant correct');
eq(turns2[1].assistant.mes, 'A2', 'second turn assistant correct');

// --- groupMessagesIntoTurns: orphan user at end ---
var msgs3 = [
    { role: 'user', mes_id: 0, mes: 'Q', is_user: true }
];
var turns3 = groupMessagesIntoTurns(msgs3);
eq(turns3.length, 1, 'orphan user produces one turn');
assert(turns3[0].user !== null, 'orphan turn has user');
assert(turns3[0].assistant === null, 'orphan turn has no assistant');

// --- groupMessagesIntoTurns: assistant-first (no user) ---
var msgs4 = [
    { role: 'assistant', mes_id: 0, mes: 'A' }
];
var turns4 = groupMessagesIntoTurns(msgs4);
eq(turns4.length, 1, 'assistant only produces one turn');

// --- groupMessagesIntoTurns: empty ---
eq(groupMessagesIntoTurns([]).length, 0, 'empty messages => 0 turns');
var threw = false;
try { groupMessagesIntoTurns(null); } catch(e) { threw = e instanceof TypeError; }
assert(threw, 'null messages throws TypeError');

// --- collectMsgIdsFromTurns ---
var ids1 = collectMsgIdsFromTurns(turns2);
eq(ids1.length, 4, 'collectMsgIds: 2 turns => 4 ids (2 users + 2 assistants)');

var ids2 = collectMsgIdsFromTurns(turns2, [0]);
eq(ids2.length, 2, 'collectMsgIds: only first turn => 2 ids');

// --- getTurnMsgRange ---
var range = getTurnMsgRange(turns2[0]);
assert(Array.isArray(range), 'getTurnMsgRange returns array');
eq(range.length, 2, 'getTurnMsgRange has 2 elements');

// --- formatTurnsText ---
var formatted = formatTurnsText(turns2, [0, 1]);
contains(formatted, '[Turn 0]', 'formatTurnsText includes turn marker');
contains(formatted, 'Q1', 'formatTurnsText includes user message');
contains(formatted, 'A1', 'formatTurnsText includes assistant message');

// --- groupMessagesIntoTurns: with _absIdx ---
var msgs5 = [
    { role: 'user', mes_id: 5, _absIdx: 10, mes: 'Q', is_user: true },
    { role: 'assistant', mes_id: 6, _absIdx: 11, mes: 'A' }
];
var turns5 = groupMessagesIntoTurns(msgs5);
eq(turns5[0].msgStart, 10, 'msgStart uses _absIdx');
eq(turns5[0].msgEnd, 11, 'msgEnd uses _absIdx');

console.log('\n--- turn-segmenter: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
