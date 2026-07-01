import { groupCandidatesByEntity } from '../src/core/engine/retrieval.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function gt(a, b, msg) { assert(a > b, msg + ' (got ' + a + ')'); }

console.log('\n=== entity-grouping: groupCandidatesByEntity ===');

console.log('--- groupCandidatesByEntity ---');

var emptyResult = groupCandidatesByEntity(new Map(), {});
eq(Object.keys(emptyResult.groups).length, 0, 'empty map => no groups');
eq(emptyResult.unassigned.length, 0, 'empty map => no unassigned');

var m1 = new Map();
m1.set('stm_001', {
    entry: { id: 'stm_001', event: '张三进入教室', scene: '教室', period: 'Day 1 上午', entities: ['张三'] },
    bm25Score: 0.8
});
var r1 = groupCandidatesByEntity(m1, {});
eq(Object.keys(r1.groups).length, 1, 'single entity => 1 group');
eq(r1.groups['张三'].entries.length, 1, '1 entry in 张三 group');
eq(r1.groups['张三'].entries[0].entry.id, 'stm_001', 'entry id preserved');
eq(r1.unassigned.length, 0, 'no unassigned');

var m2 = new Map();
m2.set('stm_001', {
    entry: { id: 'stm_001', event: '张三进入教室', scene: '教室', period: 'Day 1', entities: ['张三'] },
    bm25Score: 0.8
});
m2.set('stm_002', {
    entry: { id: 'stm_002', event: '李四打球', scene: '操场', period: 'Day 2', entities: ['李四'] },
    bm25Score: 0.6
});
var r2 = groupCandidatesByEntity(m2, {});
eq(Object.keys(r2.groups).length, 2, '2 entities => 2 groups');

var m3 = new Map();
m3.set('stm_003', {
    entry: { id: 'stm_003', event: '没有实体的条目', scene: '未知', period: 'Day 3', entities: [] },
    bm25Score: 0.5
});
var r3 = groupCandidatesByEntity(m3, {});
eq(Object.keys(r3.groups).length, 0, 'no entities => no groups');
eq(r3.unassigned.length, 1, 'entry without entities => unassigned');

var m4 = new Map();
m4.set('stm_004', {
    entry: { id: 'stm_004', event: 'no entity field', period: 'Day 4' },
    bm25Score: 0.5
});
var r4 = groupCandidatesByEntity(m4, {});
eq(r4.unassigned.length, 1, 'missing entities field => unassigned');

var m5 = new Map();
m5.set('stm_001', {
    entry: { id: 'stm_001', event: '张三和李四一起行动', scene: '城市', period: 'Day 1', entities: ['张三', '李四'] },
    bm25Score: 0.9
});
var r5 = groupCandidatesByEntity(m5, {});
eq(r5.groups['张三'].entries.length, 1, 'primary entity 张三 has entry');
eq(r5.groups['李四'].entries.length, 0, 'secondary entity 李四 has no entries');
eq(r5.groups['李四'].refs.length, 1, 'secondary entity 李四 has 1 ref');
eq(r5.groups['李四'].refs[0].primaryName, '张三', 'ref points to primary entity');

var m6 = new Map();
m6.set('stm_001', {
    entry: { id: 'stm_001', event: 'Event A', period: 'Day 3', entities: ['张三'] },
    bm25Score: 0.8
});
m6.set('stm_002', {
    entry: { id: 'stm_002', event: 'Event B', period: 'Day 1', entities: ['张三'] },
    bm25Score: 0.6
});
var r6 = groupCandidatesByEntity(m6, {});
eq(r6.groups['张三'].entries.length, 2, '2 entries grouped under same entity');
eq(r6.groups['张三'].entries[0].entry.period, 'Day 1', 'entries sorted by period');
eq(r6.groups['张三'].entries[1].entry.period, 'Day 3', 'entries sorted by period');

var m7 = new Map();
m7.set('stm_low', {
    entry: { id: 'stm_low', event: 'low score', period: 'Day 1', entities: [] },
    bm25Score: 0.05
});
var r7 = groupCandidatesByEntity(m7, {});
eq(r7.unassigned.length, 0, 'unassigned below 0.1 bm25Score filtered out');

var m8 = new Map();
m8.set('stm_001', {
    entry: { id: 'stm_001', event: 'Event via chain', period: 'Day 1', entities: ['张三'] },
    bm25Score: 0.5
});
var threadIdx = { 'chain:王五': { stmIds: ['stm_001'], type: 'entity_chain' } };
var r8 = groupCandidatesByEntity(m8, threadIdx);
assert(r8.groups['张三'] !== undefined, 'entity from entities[] still present');
assert(r8.groups['王五'] !== undefined, 'entity from threadIndex also detected');

console.log('\n--- entity-grouping: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
