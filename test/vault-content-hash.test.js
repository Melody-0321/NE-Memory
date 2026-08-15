import { computeVaultContentHash } from '../src/core/auto-restore.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + b + ', got ' + a + ')'); }

console.log('\n=== vault-content-hash: computeVaultContentHash ===');

// 确定性
var h1 = computeVaultContentHash({ a: 1, b: 2 });
var h2 = computeVaultContentHash({ a: 1, b: 2 });
eq(h1, h2, 'deterministic: same input same hash');

// 值敏感
var h3 = computeVaultContentHash({ a: 1 });
var h4 = computeVaultContentHash({ a: 2 });
assert(h3 !== h4, 'value-sensitive: {a:1} !== {a:2}');

// 结构敏感
var h5 = computeVaultContentHash({ a: 1, b: 2 });
var h6 = computeVaultContentHash({ a: 1, c: 2 });
assert(h5 !== h6, 'structure-sensitive: {a:1,b:2} !== {a:1,c:2}');

// 空对象
var h7 = computeVaultContentHash({});
assert(h7 !== null && h7.length === 9, 'empty object: returns 9-char string (h+8hex)');

// undefined 输入（等于 {}）
var h8 = computeVaultContentHash(undefined);
assert(h8 !== null, 'undefined input: returns string');
eq(h7, h8, 'undefined input equals empty object hash');

// 中文内容
var h9 = computeVaultContentHash({ story_scene: '森林', language: 'zh' });
assert(h9 !== null && h9.length === 9, 'chinese content: returns 9-char string');

// 数组/嵌套对象
var h10 = computeVaultContentHash({ stm_entries: [{ id: 'stm_1', event: 'said hello' }] });
assert(h10 !== null, 'nested array: returns string');

// null 输入
var h11 = computeVaultContentHash(null);
assert(h11 !== null, 'null input: returns string');

// 大对象（模拟真实 vault 内容量级）
var large = { state: { hp: 100, mp: 50 }, stm_entries: [], ltm_entries: [], unconsolidated_stm: [] };
var h12 = computeVaultContentHash(large);
assert(h12 !== null, 'large object: returns string');

console.log('\n=== vault-content-hash: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);