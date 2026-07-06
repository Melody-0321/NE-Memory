import { bm25Score, buildSearchableText, parseTimeConstraint, applyTimeFilter, isTimeOnlyQuery } from '../src/core/vault/retrieval-filter.js';
import { tokenize } from '../src/core/engine/text-utils.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (got ' + a + ')'); }

console.log('\n=== bm25-scoring: BM25 scoring correctness ===');

// --- buildSearchableText ---
var entry = { period: 'Day 1', scene: '古城', event: '找到了秘境入口', entities: ['主角', '古神'] };
var text = buildSearchableText(entry);
assert(text.indexOf('Day 1') !== -1, 'buildSearchableText includes period');
assert(text.indexOf('古城') !== -1, 'buildSearchableText includes scene');
assert(text.indexOf('秘境入口') !== -1, 'buildSearchableText includes event');
assert(text.indexOf('主角') !== -1, 'buildSearchableText includes entity name');
assert(text.indexOf('古神') !== -1, 'buildSearchableText includes npc name');

var entryNoEntities = { event: '事件', period: 'Day 2' };
var text2 = buildSearchableText(entryNoEntities);
assert(text2.indexOf('Day 2') !== -1, 'buildSearchableText works without entities');

var aliasesMap = { '古神': ['远古之神', 'old god'] };
var text3 = buildSearchableText(entry, aliasesMap);
assert(text3.indexOf('远古之神') !== -1, 'buildSearchableText includes aliases');
assert(text3.indexOf('old god') !== -1, 'buildSearchableText includes english aliases');

// --- bm25Score: basic ---
var queryTokens = tokenize('古城');
var docTokens = tokenize('主角在古城找到了秘境入口');
var allDocs = [
    tokenize('主角在古城找到了秘境入口'),
    tokenize('小队在森林中遇到了怪物'),
    tokenize('在酒馆休息了一晚')
];
var avgLen = (allDocs[0].length + allDocs[1].length + allDocs[2].length) / 3;
var totalDocs = allDocs.length;
var docFreq = {};
allDocs.forEach(function(d) {
    var seen = {};
    d.forEach(function(t) {
        if (!seen[t]) { seen[t] = true; docFreq[t] = (docFreq[t] || 0) + 1; }
    });
});
var score = bm25Score(queryTokens, docTokens, avgLen, totalDocs, docFreq);
gt(score, 0, 'BM25 score for matching document > 0');

// --- bm25Score: no match ---
var noMatchQuery = tokenize('大海');
var scoreNoMatch = bm25Score(noMatchQuery, docTokens, avgLen, totalDocs, docFreq);
eq(scoreNoMatch, 0, 'BM25 score is 0 when no tokens match');

// --- bm25Score: empty query ---
var scoreEmpty = bm25Score([], docTokens, avgLen, totalDocs, docFreq);
eq(scoreEmpty, 0, 'BM25 score is 0 for empty query');

// --- bm25Score: empty doc ---
var scoreEmptyDoc = bm25Score(queryTokens, [], avgLen, totalDocs, docFreq);
eq(scoreEmptyDoc, 0, 'BM25 score is 0 for empty doc');

// --- bm25Score: longer doc should score differently ---
var longDoc = tokenize('主角在古城找到了秘境入口这座古城已有千年历史传说中隐藏着远古的宝藏');
var scoreLong = bm25Score(queryTokens, longDoc, avgLen, totalDocs, docFreq);
gt(score, 0, 'Long doc with same keywords also scores > 0');

// --- bm25Score: repeated terms ---
var repeatedDoc = tokenize('古城古城古城古城');
var scoreRepeated = bm25Score(queryTokens, repeatedDoc, avgLen, totalDocs, docFreq);
gt(scoreRepeated, 0, 'Repeated term still scores');

// --- parseTimeConstraint ---
console.log('\n=== bm25-scoring: Time constraint parsing ===');

var tc = parseTimeConstraint('Day 3');
eq(tc && tc.type, 'narrative', 'parseTimeConstraint: "Day 3" => narrative');
eq(tc && tc.period, 'Day 3', 'parseTimeConstraint: period is "Day 3"');

var tcRange = parseTimeConstraint('Day 3-5');
eq(tcRange && tcRange.type, 'narrative', 'parseTimeConstraint: "Day 3-5" => narrative (dash not parsed as range)');
eq(tcRange && tcRange.period, 'Day 3', 'parseTimeConstraint: period is "Day 3" (only first day captured)');

var tcNull = parseTimeConstraint('');
eq(tcNull, null, 'parseTimeConstraint: empty string => null');
eq(parseTimeConstraint(null), null, 'parseTimeConstraint: null => null');
eq(parseTimeConstraint(), null, 'parseTimeConstraint: undefined => null');

// --- applyTimeFilter ---
var entries = [
    { period: 'Day 1', event: 'e1' },
    { period: 'Day 3', event: 'e3' },
    { period: 'Day 5', event: 'e5' },
    { period: '', event: 'empty' },
    { event: 'no period' }
];

var filtered = applyTimeFilter(entries, { type: 'narrative', period: 'Day 3' });
eq(filtered.length, 1, 'applyTimeFilter: single narrative filter returns 1 match');
eq(filtered[0].event, 'e3', 'applyTimeFilter: matches correct entry');

var rangeFiltered = applyTimeFilter(entries, { type: 'narrative_range', from: 'Day 1', to: 'Day 3', period: 'Day 1-3' });
eq(rangeFiltered.length, 2, 'applyTimeFilter: range Day 1-3 returns 2 matches');

var noConstraint = applyTimeFilter(entries, null);
eq(noConstraint.length, 5, 'applyTimeFilter: null constraint returns all entries');

var noEntries = applyTimeFilter(null, { type: 'narrative', period: 'Day 1' });
eq(noEntries.length, 0, 'applyTimeFilter: null entries returns empty array');

// --- isTimeOnlyQuery ---
eq(isTimeOnlyQuery('Day 3', tc), true, 'isTimeOnlyQuery: "Day 3" with time constraint => true ("Day" is time word, only "3" non-time)');
eq(isTimeOnlyQuery('Day 3 发生了什么', tc), true, 'isTimeOnlyQuery: "Day 3 发生了什么" => true');

console.log('\n--- bm25-scoring: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
