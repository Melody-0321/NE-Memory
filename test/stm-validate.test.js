import { validateSTMOutput, postFillSTM, validateMsgRanges } from '../src/core/engine/validate.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (got ' + a + ')'); }

console.log('\n=== stm-validate: STM output validation ===');

// --- validateSTMOutput: valid entry ---
var validEntry = { event: '主角在古城发现了秘境入口' };
var validParsed = { stmEntries: [validEntry] };
var errors = validateSTMOutput(validParsed, { content: {} });
eq(errors.length, 0, 'valid STM entry produces no errors');

// --- validateSTMOutput: missing event ---
var missingEvent = { event: '' };
var errors2 = validateSTMOutput({ stmEntries: [missingEvent] }, { content: {} }, 10);
gt(errors2.length, 0, 'empty event produces errors');

// --- validateSTMOutput: null event ---
var nullEvent = { event: null };
var errors3 = validateSTMOutput({ stmEntries: [nullEvent] }, { content: {} }, 10);
gt(errors3.length, 0, 'null event produces errors');

// --- validateSTMOutput: empty entries ---
var errors4 = validateSTMOutput({ stmEntries: [] }, { content: {} }, 10);
eq(errors4.length, 0, 'empty stmEntries produces no errors');

// --- validateMsgRanges: valid ranges ---
var validRanges = [
    { id: 'stm_1', event: 'e1', msgRange: [0, 3] },
    { id: 'stm_2', event: 'e2', msgRange: [4, 6] }
];
var rangeErrors = validateMsgRanges(validRanges, 7);
eq(rangeErrors.length, 0, 'valid non-overlapping ranges produce no errors');

// --- validateMsgRanges: out of bounds ---
var oobRanges = [
    { id: 'stm_1', event: 'e1', msgRange: [0, 20] }
];
var oobErrors = validateMsgRanges(oobRanges, 10);
gt(oobErrors.length, 0, 'out-of-bounds range produces errors');

// --- validateMsgRanges: overlapping ---
var overlapRanges = [
    { id: 'stm_1', event: 'e1', msgRange: [0, 3] },
    { id: 'stm_2', event: 'e2', msgRange: [2, 5] }
];
var overlapErrors = validateMsgRanges(overlapRanges, 6);
gt(overlapErrors.length, 0, 'overlapping ranges produce errors');

// --- validateMsgRanges: uncovered messages ---
var uncoveredRanges = [
    { id: 'stm_1', event: 'e1', msgRange: [0, 1] }
];
var uncoveredErrors = validateMsgRanges(uncoveredRanges, 5);
gt(uncoveredErrors.length, 0, 'uncovered messages produce errors');

// --- validateMsgRanges: start > end ---
var invertedRange = [
    { id: 'stm_1', event: 'e1', msgRange: [5, 2] }
];
var invertedErrors = validateMsgRanges(invertedRange, 10);
gt(invertedErrors.length, 0, 'start > end produces errors');

// --- validateMsgRanges: negative start ---
var negRange = [
    { id: 'stm_1', event: 'e1', msgRange: [-1, 3] }
];
var negErrors = validateMsgRanges(negRange, 10);
gt(negErrors.length, 0, 'negative start produces errors');

// --- postFillSTM: fills missing story_time ---
var emptyVault = { content: {} };
var result = postFillSTM({ stmEntries: [] }, emptyVault);
eq(emptyVault.content.story_time, 'Day 1', 'postFillSTM fills default story_time');

// --- postFillSTM: preserves existing story_time ---
var filledVault = { content: { story_time: 'Day 5', story_date: '2025-01-01', story_scene: '古城' } };
var result2 = postFillSTM({ stmEntries: [] }, filledVault);
eq(filledVault.content.story_time, 'Day 5', 'postFillSTM preserves existing story_time');

// --- postFillSTM: extracts date from ISO period ---
var isoVault = { content: {} };
var result3 = postFillSTM({ stmEntries: [{ period: '2025-06-01·下午', event: 'test' }] }, isoVault);
eq(isoVault.content.story_date, '2025-06-01', 'postFillSTM extracts ISO date from period');

console.log('\n--- stm-validate: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
