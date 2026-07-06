import { parseTimeConstraint, applyTimeFilter, isTimeOnlyQuery } from '../src/core/vault/retrieval-filter.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== time-filter: Time constraint parsing and filtering ===');

// --- parseTimeConstraint: relative time ---
var tcYesterday = parseTimeConstraint('what happened yesterday?');
eq(tcYesterday && tcYesterday.type, 'relative', 'parseTimeConstraint: "yesterday" => relative');
eq(tcYesterday && tcYesterday.period, 'yesterday', 'parseTimeConstraint: period=yesterday');

var tcLastWeek = parseTimeConstraint('last week we went to the market');
eq(tcLastWeek && tcLastWeek.type, 'relative', 'parseTimeConstraint: "last week" => relative');
eq(tcLastWeek && tcLastWeek.period, 'last week', 'parseTimeConstraint: period=last week');

// --- parseTimeConstraint: ISO dates ---
var tcIso = parseTimeConstraint('event in 2025-04');
eq(tcIso && tcIso.type, 'absolute', 'parseTimeConstraint: ISO date => absolute');
eq(tcIso && tcIso.month, 4, 'parseTimeConstraint: month=4');
eq(tcIso && tcIso.year, 2025, 'parseTimeConstraint: year=2025');

// --- parseTimeConstraint: month names ---
var tcJan = parseTimeConstraint('january 2025');
eq(tcJan && tcJan.type, 'absolute', 'parseTimeConstraint: "january 2025" => absolute');
eq(tcJan && tcJan.month, 1, 'parseTimeConstraint: january => month=1');

// --- applyTimeFilter: absolute ---
var entries = [
    { period: 'January 2025', event: 'jan_event' },
    { period: 'Day 3', event: 'day3' },
    { period: '2025-04', event: 'apr' }
];

var absFiltered = applyTimeFilter(entries, { type: 'absolute', period: '2025-04', month: 4, year: 2025 });
eq(absFiltered.length, 1, 'applyTimeFilter: absolute filter returns 1 match');
eq(absFiltered[0].event, 'apr', 'applyTimeFilter: absolute matches correct entry');

// --- applyTimeFilter: relative ---
var relFiltered = applyTimeFilter(entries, { type: 'relative', period: 'yesterday' });
eq(relFiltered.length, 0, 'applyTimeFilter: relative "yesterday" with no matching period returns 0');

// --- isTimeOnlyQuery ---
eq(isTimeOnlyQuery('Day 3', null), false, 'isTimeOnlyQuery: null constraint => false');
eq(isTimeOnlyQuery('Day 3 发生了', null), false, 'isTimeOnlyQuery: no constraint => false');
eq(isTimeOnlyQuery('', { type: 'narrative' }), false, 'isTimeOnlyQuery: empty query => false');

// --- parseTimeConstraint: Chinese relative time ---
var tcChinese = parseTimeConstraint('前两天发生了什么');
eq(tcChinese, null, 'parseTimeConstraint: "前两天" not parsed (Chinese relative not supported yet)');

// --- parseTimeConstraint: Day range with dash ---
var tcDash = parseTimeConstraint('Day 3-Day 5 events');
eq(tcDash && tcDash.type, 'narrative_range', 'parseTimeConstraint: "Day 3-Day 5" => narrative_range');
eq(tcDash && tcDash.from, 'Day 3', 'parseTimeConstraint: dash range from=Day 3');
eq(tcDash && tcDash.to, 'Day 5', 'parseTimeConstraint: dash range to=Day 5');

console.log('\n--- time-filter: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
