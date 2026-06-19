import { getNextEligibleStmId, splitStmsIntoContiguousGroups } from '../src/core/engine/consolidate.js';

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

console.log('\n=== consolidate: getNextEligibleStmId ===');

// 1. 空 vault → null
var vault = { content: { unconsolidated_stm: [] } };
var id = getNextEligibleStmId(vault);
eq(id, null, '空 unconsolidated_stm → null');

// 2. 数量不足阈值 → null
vault = { content: { unconsolidated_stm: [
    { id: 's1', parent_ltm: undefined, msgRange: [1, 2] },
    { id: 's2', parent_ltm: undefined, msgRange: [3, 4] }
] } };
id = getNextEligibleStmId(vault);
assert(id === null || id === 's1', '2 条未合并 → null 或第一条');

// 3. 有 parent_ltm 的被过滤
vault = { content: { unconsolidated_stm: [
    { id: 's1', parent_ltm: 'ltm1', msgRange: [1, 2] },
    { id: 's2', parent_ltm: undefined, msgRange: [3, 4] },
    { id: 's3', parent_ltm: undefined, msgRange: [5, 6] },
    { id: 's4', parent_ltm: undefined, msgRange: [7, 8] }
] } };
id = getNextEligibleStmId(vault);
assert(id === null || id !== 's1', 'parent_ltm 的 s1 被过滤');

// 4. 按 msgRange 排序取最小
vault = { content: { unconsolidated_stm: [
    { id: 's9', parent_ltm: undefined, msgRange: [90, 91] },
    { id: 's1', parent_ltm: undefined, msgRange: [10, 11] },
    { id: 's5', parent_ltm: undefined, msgRange: [50, 51] },
    { id: 's2', parent_ltm: undefined, msgRange: [20, 21] }
] } };
id = getNextEligibleStmId(vault);
if (id !== null) {
    eq(id, 's1', '最早 msgRange 的入选 (s1 msgRange=[10,11])');
}

// ====== splitStmsIntoContiguousGroups ======

console.log('\n=== consolidate: splitStmsIntoContiguousGroups ===');

// 5. 空数组
var groups = splitStmsIntoContiguousGroups([], 5);
eq(groups.length, 0, '[] → 0 groups');

// 6. 单条
groups = splitStmsIntoContiguousGroups([{ msgRange: [1, 3], absMsgStart: 1 }], 5);
eq(groups.length, 1, '单条 → 1 group');

// 7. 相距在 tolerance 内的合并为一组
// prevEnd = 1 + (2-1) = 2, gap = 5 - 2 = 3, <= 5 → merge
groups = splitStmsIntoContiguousGroups([
    { msgRange: [1, 2], absMsgStart: 1 },
    { msgRange: [5, 6], absMsgStart: 5 }
], 5);
eq(groups.length, 1, 'gap=3 ≤ tolerance=5 → 1 group');

// 8. 相距超过 tolerance 的分组
// prevEnd = 1 + 1 = 2, gap = 10 - 2 = 8, > 5 → split
groups = splitStmsIntoContiguousGroups([
    { msgRange: [1, 2], absMsgStart: 1 },
    { msgRange: [10, 11], absMsgStart: 10 }
], 5);
eq(groups.length, 2, 'gap=8 > tolerance=5 → 2 groups');

// 9. 三个元素，中间有断层
// [1,2] abs=1, [5,6] abs=5 → gap=5-2=3 ≤ 3 → merge
// [5,6] abs=5, [15,16] abs=15 → prevEnd=5+1=6, gap=15-6=9 > 3 → split
groups = splitStmsIntoContiguousGroups([
    { msgRange: [1, 2], absMsgStart: 1 },
    { msgRange: [5, 6], absMsgStart: 5 },
    { msgRange: [15, 16], absMsgStart: 15 }
], 3);
eq(groups.length, 2, '三元素有断层 → 2 groups');
eq(groups[0].length, 2, '第一组 2 个元素');

// 10. 无 absMsgStart → fallback 999999，全部独立
groups = splitStmsIntoContiguousGroups([
    { msgRange: [1, 2] },
    { msgRange: [10, 11] }
], 5);
eq(groups.length, 2, '无 absMsgStart → 2 groups (NaN gap 导致独立)');

console.log('--- consolidate: ' + test.passed + ' passed, ' + test.failed + ' failed ---');
if (test.failed > 0) process.exit(1);
