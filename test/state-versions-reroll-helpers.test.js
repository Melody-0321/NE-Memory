// 测试重roll辅助函数: isAiVersion / findLatestAiSeq / countManualEditsInRange
import { isAiVersion, isManualEdit, findLatestAiSeq, countManualEditsInRange } from '../src/core/vault/state-versions.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + b + ', got ' + a + ')'); }

console.log('\n=== state-versions: isAiVersion (AI version identification) ===');

// State scope tests
eq(isAiVersion({ source: 'ai_update' }, 'state'), true, 'state ai_update -> true');
eq(isAiVersion({ source: 'manual_edit' }, 'state'), false, 'state manual_edit -> false');
eq(isAiVersion({ source: 'ne_char_update' }, 'state'), false, 'state ne_char_update -> false');
eq(isAiVersion({ source: 'rollback_restore' }, 'state'), false, 'state rollback_restore -> false');
eq(isAiVersion({ source: 'init' }, 'state'), false, 'state init -> false');

// Memory scope tests
eq(isAiVersion({ type: 'stm_batch' }, 'memory'), true, 'memory stm_batch -> true');
eq(isAiVersion({ type: 'ltm_consolidation' }, 'memory'), true, 'memory ltm_consolidation -> true');
eq(isAiVersion({ type: 'stm_reroll' }, 'memory'), true, 'memory stm_reroll -> true');
eq(isAiVersion({ type: 'ltm_reroll' }, 'memory'), true, 'memory ltm_reroll -> true');
eq(isAiVersion({ type: 'manual_edit' }, 'memory'), false, 'memory manual_edit -> false');
eq(isAiVersion({ type: 'init' }, 'memory'), false, 'memory init -> false');

// Edge cases
eq(isAiVersion(null, 'state'), false, 'null input -> false');
eq(isAiVersion(undefined, 'state'), false, 'undefined input -> false');
eq(isAiVersion({}, 'state'), false, 'empty object -> false');

console.log('\n=== state-versions: isManualEdit (manual edit identification) ===');

eq(isManualEdit({ source: 'manual_edit' }, 'state'), true, 'state manual_edit -> true');
eq(isManualEdit({ source: 'ai_update' }, 'state'), false, 'state ai_update -> false');
eq(isManualEdit({ type: 'manual_edit' }, 'memory'), true, 'memory manual_edit -> true');
eq(isManualEdit({ type: 'stm_batch' }, 'memory'), false, 'memory stm_batch -> false');

console.log('\n=== state-versions: findLatestAiSeq (find latest AI version) ===');

// Test data: state deltas with mixed AI/manual
var stateChain = { state_head_seq: 5 };
var stateDeltas = [
    { seq: 1, source: 'init' },
    { seq: 2, source: 'ai_update' },
    { seq: 3, source: 'manual_edit' },
    { seq: 4, source: 'ne_char_update' },
    { seq: 5, source: 'ai_update' },
];
eq(findLatestAiSeq(stateChain, stateDeltas, 'state'), 5, 'mixed chain: latest AI at seq 5 -> returns 5');

// Last is manual, latest AI is earlier
var stateDeltas2 = [
    { seq: 1, source: 'init' },
    { seq: 2, source: 'ai_update' },
    { seq: 3, source: 'manual_edit' },
    { seq: 4, source: 'ne_char_update' },
];
var stateChain2 = { state_head_seq: 4 };
eq(findLatestAiSeq(stateChain2, stateDeltas2, 'state'), 2, 'last is manual: returns last AI seq 2');

// No AI at all
var stateDeltas3 = [
    { seq: 1, source: 'init' },
    { seq: 2, source: 'manual_edit' },
    { seq: 3, source: 'ne_char_update' },
];
var stateChain3 = { state_head_seq: 3 };
eq(findLatestAiSeq(stateChain3, stateDeltas3, 'state'), null, 'no AI: returns null');

// Some seqs above headSeq are ignored
var stateDeltas4 = [
    { seq: 1, source: 'init' },
    { seq: 2, source: 'ai_update' },
    { seq: 6, source: 'ai_update' }, // above headSeq 5
    { seq: 3, source: 'ai_update' },
];
var stateChain4 = { state_head_seq: 5 };
eq(findLatestAiSeq(stateChain4, stateDeltas4, 'state'), 3, 'seq above head ignored: latest valid is 3');

// Memory scope test
var memChain = { mem_head_seq: 4 };
var memVersions = [
    { seq: 0, type: 'init' },
    { seq: 1, type: 'stm_batch' },
    { seq: 2, type: 'manual_edit' },
    { seq: 3, type: 'ltm_consolidation' },
    { seq: 4, type: 'manual_edit' },
];
eq(findLatestAiSeq(memChain, memVersions, 'memory'), 3, 'memory mixed: latest AI at 3');

// Empty deltas
eq(findLatestAiSeq(stateChain, [], 'state'), null, 'empty deltas -> null');
eq(findLatestAiSeq(null, stateDeltas, 'state'), null, 'null chain -> null');

console.log('\n=== state-versions: countManualEditsInRange (count manual edits in range) ===');

// (loSeq, hiSeq] = (2, 5] → seqs 3, 4, 5
var deltas1 = [
    { seq: 1, source: 'init' },
    { seq: 2, source: 'ai_update' }, // not in range (exclusive lower bound)
    { seq: 3, source: 'manual_edit' }, // count
    { seq: 4, source: 'ne_char_update' }, // not manual, no count
    { seq: 5, source: 'manual_edit' }, // count
];
eq(countManualEditsInRange(deltas1, 2, 5, 'state'), 2, 'range (2,5]: 2 manual edits');

// No manual in range
eq(countManualEditsInRange(deltas1, 0, 2, 'state'), 0, 'range (0,2]: 0 manual');

// All manual in range
var deltas2 = [
    { seq: 1, source: 'manual_edit' },
    { seq: 2, source: 'manual_edit' },
    { seq: 3, source: 'manual_edit' },
];
eq(countManualEditsInRange(deltas2, 0, 3, 'state'), 3, '(0,3]: all 3 manual counted');

// Memory scope counting
var memDeltas = [
    { seq: 1, type: 'stm_batch' },
    { seq: 2, type: 'manual_edit' },
    { seq: 3, type: 'manual_edit' },
    { seq: 4, type: 'ltm_consolidation' },
];
eq(countManualEditsInRange(memDeltas, 1, 4, 'memory'), 2, 'memory scope: 2 manual in (1,4]');

// Empty range / edge cases
eq(countManualEditsInRange([], 0, 10, 'state'), 0, 'empty deltas -> 0');
eq(countManualEditsInRange(deltas1, 5, 5, 'state'), 0, 'lo=hi=5: (5,5] empty -> 0');

console.log('\n=== state-versions-reroll-helpers: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
