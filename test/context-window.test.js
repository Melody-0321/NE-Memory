import { computeWindowStartMsgId } from '../src/core/engine/context-window.js';

var test = { passed: 0, failed: 0 };

function assert(condition, msg) {
    if (condition) {
        test.passed++;
    } else {
        test.failed++;
        console.error('  FAIL: ' + msg);
    }
}

function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (expected >' + b + ', got ' + a + ')'); }
function contains(a, b, msg) { assert(a.indexOf(b) !== -1, msg + ' (expected "' + b + '" not found)'); }
function notContains(a, b, msg) { assert(a.indexOf(b) === -1, msg + ' (unexpectedly contains "' + b + '")'); }

function makeMsg(role, is_user, is_system) {
    return { role: role, is_user: !!is_user, is_system: !!is_system };
}

console.log('\n=== context-window: computeWindowStartMsgId ===');

eq(computeWindowStartMsgId(null, 10), -1, 'null chat -> -1');
eq(computeWindowStartMsgId([], 10), -1, 'empty chat -> -1');

var short = [ makeMsg('user', true) ];
eq(computeWindowStartMsgId(short, 10), -1, 'only user msg -> -1');

short = [ makeMsg('user', true), makeMsg('assistant') ];
eq(computeWindowStartMsgId(short, 10), -1, '1 round < 10 window -> -1');

var exact3 = [
    makeMsg('user', true),
    makeMsg('assistant'),
    makeMsg('user', true),
    makeMsg('assistant'),
    makeMsg('user', true),
    makeMsg('assistant'),
];
eq(computeWindowStartMsgId(exact3, 3), -1, '3 rounds window=3 -> -1 (full window)');

var manyRounds = [];
for (var r = 1; r <= 12; r++) {
    manyRounds.push(makeMsg('user', true));
    manyRounds.push(makeMsg('assistant'));
}
var result = computeWindowStartMsgId(manyRounds, 10);
eq(result, 3, '12 rounds window=10 -> index 3 (a2)');

eq(computeWindowStartMsgId(exact3, 2), 1, '3 rounds window=2 -> index 1 (a1)');

var withSystem = [
    { role: 'system', is_system: true },
    makeMsg('user', true),
    makeMsg('assistant'),
    { role: 'system', is_system: true },
    makeMsg('user', true),
    makeMsg('assistant'),
];
eq(computeWindowStartMsgId(withSystem, 2), -1, 'system msgs 2 rounds window=2 -> -1');

var doubleUser = [
    makeMsg('user', true),
    makeMsg('user', true),
    makeMsg('assistant'),
    makeMsg('user', true),
    makeMsg('assistant'),
];
eq(computeWindowStartMsgId(doubleUser, 2), -1, 'double user -> only 1 pair, window=2 -> -1');

console.log('\n--- context-window: ' + test.passed + ' passed, ' + test.failed + ' failed ---');
if (test.failed > 0) process.exit(1);
