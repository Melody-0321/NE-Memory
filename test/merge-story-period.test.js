import { mergeStoryPeriod } from '../src/core/engine/validate.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== merge-story-period: Story period formatting ===');

eq(mergeStoryPeriod('Day 3', ''), 'Day 3', 'storyTime only => just time');
eq(mergeStoryPeriod('', '2025-04'), '2025-04', 'storyDate only => just date');
eq(mergeStoryPeriod('Day 3', '2025-04'), 'Day 3 ─ 2025-04', 'both => joined with em-dash');
eq(mergeStoryPeriod('Day 3', null), 'Day 3', 'null date => just time');
eq(mergeStoryPeriod(null, '2025-04'), '2025-04', 'null time => just date');
eq(mergeStoryPeriod(undefined, undefined), '', 'both undefined => empty');
eq(mergeStoryPeriod('Day 1', ''), 'Day 1', 'empty date => just time');

console.log('\n--- merge-story-period: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
