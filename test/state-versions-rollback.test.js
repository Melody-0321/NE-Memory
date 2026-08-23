// 回滚守卫：evaluateRollbackTarget — 折叠归档（compact）后旧版本已移出 active 链，
// 回滚到已归档版本会破坏版本链，必须拒绝。
import { evaluateRollbackTarget, _findFallbackTarget } from '../src/core/vault/state-versions.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + b + ', got ' + a + ')'); }

// ====== evaluateRollbackTarget 回滚守卫 ======
console.log('\n=== state-versions: evaluateRollbackTarget (rollback guard) ===');

// 正常回滚：目标在 active 链内
eq(evaluateRollbackTarget([0, 1, 2, 3], 3, 2), 'ok', 'target in active chain -> ok');
eq(evaluateRollbackTarget([0, 1, 2, 3], 3, 0), 'ok', 'target is active base -> ok');

// 折叠归档：compact 后 active=[head]，向更早回滚 → archived
eq(evaluateRollbackTarget([100], 100, 99), 'archived', 'post-compact rollback below head -> archived');
eq(evaluateRollbackTarget([5, 6, 7, 8], 8, 4), 'archived', 'target below active base -> archived');
eq(evaluateRollbackTarget([50, 51], 51, 49), 'archived', 'gap before active base -> archived');

// 越界 / 非法目标
eq(evaluateRollbackTarget([0, 1, 2], 2, 3), 'invalid_target', 'target above head -> invalid_target');
eq(evaluateRollbackTarget([0, 1, 2], 2, 2), 'invalid_target', 'target == head -> invalid_target');
eq(evaluateRollbackTarget([0, 1, 2], 2, -1), 'invalid_target', 'negative target -> invalid_target');

// 空 active（新链）向 head 回滚 → invalid_target
eq(evaluateRollbackTarget([0], 0, 0), 'invalid_target', 'empty-ish chain target==head -> invalid_target');

// ====== _findFallbackTarget 宽松回退（空洞目标落到最近下界版本） ======
console.log('\n=== state-versions: _findFallbackTarget (lenient rollback) ===');
// 用户场景：state active=[0,1,3,4,...,16] 缺 2，target=2 → 落到 1
eq(_findFallbackTarget([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 2), 1, 'gap target=2 -> lower bound 1');
// mem active=[0,1,2,3,4,6,...,12] 缺 5，target=5 → 落到 4
eq(_findFallbackTarget([0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12], 5), 4, 'gap target=5 -> lower bound 4');
// 连续 active（target 存在）→ 宽松仅在使用方仅在 archived 时才触发，此处仅确认 <target 最大值的语义
eq(_findFallbackTarget([0, 1, 2, 3], 3), 2, 'continuous active lower bound < target -> 2');
// active 中 < target 只有 0（空根）→ 拒绝宽松到 0，返回 null（防清空链过删）
eq(_findFallbackTarget([0, 2, 3], 1), null, 'only 0 below target -> null (not empty chain)');
// 空 active / 无更低版本 → null
eq(_findFallbackTarget([0, 1], 1), null, 'target is min real version -> null');
eq(_findFallbackTarget([], 5), null, 'empty active -> null');

console.log('\n=== state-versions-rollback: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
