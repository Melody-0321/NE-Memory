import { validateLtmDecision } from '../src/core/engine/validate.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function neq(a, b, msg) { assert(a !== b, msg + ' (expected !== ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== ltm-validate: validateLtmDecision ===');

// --- valid append ---
var r1 = validateLtmDecision({ action: 'append', updated_title: '古城探索', updated_event: '主角探索古城遗迹' });
neq(r1, null, 'action=append → passes');
eq(r1.updated_title, '古城探索', 'title unchanged for short title');

// --- valid close_and_new ---
var r2 = validateLtmDecision({ action: 'close_and_new', updated_title: '决战', updated_event: '与boss决战' });
neq(r2, null, 'action=close_and_new → passes');

// --- invalid action → null ---
var r3 = validateLtmDecision({ action: 'delete', updated_title: 'test' });
eq(r3, null, 'action=delete → null');

// --- invalid action (random) → null ---
var r4 = validateLtmDecision({ action: 'xyz', updated_title: 'test' });
eq(r4, null, 'action=xyz → null');

// --- missing action → null ---
var r5 = validateLtmDecision({ updated_title: 'test' });
eq(r5, null, 'missing action → null');

// --- title > 60 chars → truncated ---
var longTitle = 'A'.repeat(80);
var r6 = validateLtmDecision({ action: 'append', updated_title: longTitle });
neq(r6, null, 'long title → still passes');
eq(r6.updated_title.length, 60, 'title truncated to 60 chars');
eq(r6.updated_title, 'A'.repeat(60), 'title truncated correctly');

// --- no title at all → passes (title optional) ---
var r7 = validateLtmDecision({ action: 'append', updated_event: 'something' });
neq(r7, null, 'no title → still passes');

// --- no updated_event → passes (event not validated) ---
var r8 = validateLtmDecision({ action: 'append', updated_title: 'test' });
neq(r8, null, 'no event → still passes');

console.log('\n--- ltm-validate: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
