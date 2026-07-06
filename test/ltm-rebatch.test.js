import { splitStmsIntoContiguousGroups } from '../src/core/engine/consolidate.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== ltm-rebatch: Split and group STMs ===');

// --- splitStmsIntoContiguousGroups: empty ---
eq(splitStmsIntoContiguousGroups([], 3).length, 0, 'empty stms => 0 groups');
eq(splitStmsIntoContiguousGroups(null, 3).length, 0, 'null stms => 0 groups');

// --- splitStmsIntoContiguousGroups: single ---
var single = [{ id: 'stm_1', absMsgStart: 0, msgRange: [0, 3] }];
eq(splitStmsIntoContiguousGroups(single, 3).length, 1, 'single STM => 1 group');

// --- splitStmsIntoContiguousGroups: contiguous (within tolerance) ---
var contiguous = [
    { id: 'stm_1', absMsgStart: 0, msgRange: [0, 3] },
    { id: 'stm_2', absMsgStart: 4, msgRange: [4, 6] },
    { id: 'stm_3', absMsgStart: 7, msgRange: [7, 9] }
];
var groups1 = splitStmsIntoContiguousGroups(contiguous, 3);
eq(groups1.length, 1, 'gap <= 3 => 1 group');
eq(groups1[0].length, 3, 'all 3 STMs in one group');

// --- splitStmsIntoContiguousGroups: split (over tolerance) ---
var splitStms = [
    { id: 'stm_1', absMsgStart: 1, msgRange: [1, 3] },
    { id: 'stm_2', absMsgStart: 10, msgRange: [10, 12] },
    { id: 'stm_3', absMsgStart: 11, msgRange: [11, 13] }
];
var groups2 = splitStmsIntoContiguousGroups(splitStms, 3);
eq(groups2.length, 2, 'gap > 3 => 2 groups');
eq(groups2[0].length, 1, 'first group has 1 STM');
eq(groups2[1].length, 2, 'second group has 2 STMs');

// --- splitStmsIntoContiguousGroups: tolerance bridging ---
var tolerant = [
    { id: 'stm_1', absMsgStart: 0, msgRange: [0, 2] },
    { id: 'stm_2', absMsgStart: 7, msgRange: [7, 9] },
    { id: 'stm_3', absMsgStart: 10, msgRange: [10, 12] }
];
var groups3 = splitStmsIntoContiguousGroups(tolerant, 5);
eq(groups3.length, 1, 'gap of 5 with tolerance 5 => gap(5) <= tolerance(5) => 1 group');
eq(groups3[0].length, 3, 'all 3 STMs in one group');

// --- splitStmsIntoContiguousGroups: missing absMsgStart fallback ---
var missingAbs = [
    { id: 'stm_1', msgRange: [0, 3] },
    { id: 'stm_2', msgRange: [4, 6] }
];
var groups4 = splitStmsIntoContiguousGroups(missingAbs, 3);
assert(groups4.length >= 1, 'missing absMsgStart does not crash');

// --- deriveTimeRange logic test ---
function deriveTimeRange(sourceSTMEntries) {
    var timed = sourceSTMEntries.filter(function(s) {
        return (s.period || s.time_label);
    });
    if (timed.length === 0) return null;
    var first = timed[0];
    var last = timed[timed.length - 1];
    var fmt = function(s) {
        var parts = [];
        if (s.period) parts.push(s.period);
        if (s.time_label) parts.push(s.time_label);
        return parts.join('\u00b7');
    };
    if (timed.length === 1) return fmt(first);
    if (first.period === last.period) {
        if (first.time_label || last.time_label) {
            return first.period + ': ' + (first.time_label || '?') + ' \u2192 ' + (last.time_label || '?');
        }
        return first.period;
    }
    return fmt(first) + ' \u2192 ' + fmt(last);
}

var tr1 = deriveTimeRange([{ period: 'Day 1', time_label: '清晨' }, { period: 'Day 1', time_label: '傍晚' }]);
assert(tr1.indexOf('清晨') !== -1 && tr1.indexOf('傍晚') !== -1, 'deriveTimeRange: same day shows labels');

var tr2 = deriveTimeRange([{ period: 'Day 1' }, { period: 'Day 3' }]);
assert(tr2.indexOf('Day 1') !== -1 && tr2.indexOf('Day 3') !== -1, 'deriveTimeRange: different days shows range');

var tr3 = deriveTimeRange([{ period: 'Day 1' }]);
eq(tr3, 'Day 1', 'deriveTimeRange: single entry shows period');

var tr4 = deriveTimeRange([]);
eq(tr4, null, 'deriveTimeRange: empty => null');

console.log('\n--- ltm-rebatch: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
