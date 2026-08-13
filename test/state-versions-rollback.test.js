// 回滚守卫：evaluateRollbackTarget — 折叠归档（compact）后旧版本已移出 active 链，
// 回滚到已归档版本会破坏版本链，必须拒绝。
import { evaluateRollbackTarget } from '../src/core/vault/state-versions.js';

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

console.log('\n=== state-versions-rollback: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
