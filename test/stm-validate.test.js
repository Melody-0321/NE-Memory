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

// --- validateSTMOutput: present_characters 非数组 ---
var badPresent = { event: 'test', present_characters: '不是数组' };
var presentErrors = validateSTMOutput({ stmEntries: [badPresent] }, { content: {} });
gt(presentErrors.length, 0, 'non-array present_characters produces errors');

// --- validateSTMOutput: character_psyche 非对象 ---
var badPsyche = { event: 'test', character_psyche: '不是对象' };
var psycheErrors = validateSTMOutput({ stmEntries: [badPsyche] }, { content: {} });
gt(psycheErrors.length, 0, 'non-object character_psyche produces errors');

// --- validateSTMOutput: 合法新字段不报错 ---
var goodNew = {
    event: 'test',
    present_characters: ['角色A', '角色B'],
    character_psyche: { '角色A': { current_mood: '开心', inner_thoughts: '今天真好' } }
};
var goodNewErrors = validateSTMOutput({ stmEntries: [goodNew] }, { content: {} });
eq(goodNewErrors.length, 0, 'valid present_characters/character_psyche produces no errors');

// --- postFillSTM: 默认初始化新字段 ---
var initVault = { content: {} };
var initResult = postFillSTM({ stmEntries: [{ event: 'test' }] }, initVault);
var initEntry = initResult.stmEntries[0];
eq(Array.isArray(initEntry.present_characters), true, 'postFillSTM initializes present_characters to array');
eq(initEntry.present_characters.length, 0, 'postFillSTM initializes present_characters to empty array');
eq(typeof initEntry.character_psyche, 'object', 'postFillSTM initializes character_psyche to object');
eq(Object.keys(initEntry.character_psyche).length, 0, 'postFillSTM initializes character_psyche to empty object');

// --- P0-4: 全局窗口场景——增量更新不误报 ---
var winFull = [
    { id: 's1', event: 'e1', msgRange: [42, 43] },
    { id: 's2', event: 'e2', msgRange: [44, 45] }
];
var winFullErrors = validateMsgRanges(winFull, 4, 42, 45);
eq(winFullErrors.length, 0, 'window [42,45] fully covered produces no errors (P0-4 no false positive)');

// --- P0-4: 窗口越界 ---
var winOob = [
    { id: 's1', event: 'e1', msgRange: [40, 45] }
];
var winOobErrors = validateMsgRanges(winOob, 4, 42, 45);
gt(winOobErrors.length, 0, 'range below window start reports out-of-bounds');

// --- P0-4: 窗口终点未覆盖 ---
var winGap = [
    { id: 's1', event: 'e1', msgRange: [42, 44] }
];
var winGapErrors = validateMsgRanges(winGap, 4, 42, 45);
gt(winGapErrors.length, 0, 'window end uncovered reports missing messages');

// --- P0-4: 窗口内重叠 ---
var winOverlap = [
    { id: 's1', event: 'e1', msgRange: [42, 43] },
    { id: 's2', event: 'e2', msgRange: [43, 45] }
];
var winOverlapErrors = validateMsgRanges(winOverlap, 4, 42, 45);
gt(winOverlapErrors.length, 0, 'overlapping ranges inside window report overlap');

// --- P0-4: validateSTMOutput 透传窗口 ---
var stmWinParsed = { stmEntries: [
    { event: 'e1', msgRange: [42, 43] },
    { event: 'e2', msgRange: [44, 45] }
] };
var stmWinErrors = validateSTMOutput(stmWinParsed, { content: {} }, 4, 42, 45);
eq(stmWinErrors.length, 0, 'validateSTMOutput passes window through (no false positive)');

console.log('\n--- stm-validate: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
