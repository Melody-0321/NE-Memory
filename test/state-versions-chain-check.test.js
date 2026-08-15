// Node.js localStorage polyfill (not available in Node) — state-versions.js 间接依赖 store.js
if (typeof localStorage === 'undefined') {
    var _store = {};
    globalThis.localStorage = {
        getItem: function(k) { return _store.hasOwnProperty(k) ? _store[k] : null; },
        setItem: function(k, v) { _store[k] = String(v); },
        removeItem: function(k) { delete _store[k]; },
        clear: function() { _store = {}; },
        get length() { return Object.keys(_store).length; },
        key: function(i) { return Object.keys(_store)[i] || null; }
    };
}

import { diagnoseChainRefs, computeConservativeRepair } from '../src/core/vault/state-versions.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

// ====== diagnoseChainRefs ======
console.log('\n=== state-versions: diagnoseChainRefs ===');

// ok 态：seq 0 哨兵豁免（0 永无记录，不计悬空）
var r1 = diagnoseChainRefs([0, 1, 2], 2, [1, 2]);
eq(r1.status, 'ok', 'ok: status');
eq(r1.dangling, [], 'ok: no dangling (seq 0 exempt)');
eq(r1.headMissing, false, 'ok: head present');
eq(r1.orphans, [], 'ok: no orphans');

// 尾部悬空：head 记录缺失
var r2 = diagnoseChainRefs([0, 1, 2, 3], 3, [1, 2]);
eq(r2.status, 'dangling_active', 'tail-dangling: status');
eq(r2.dangling, [3], 'tail-dangling: dangling seqs');
eq(r2.headMissing, true, 'tail-dangling: head missing');

// 中段悬空：head 记录存在但链中断
var r3 = diagnoseChainRefs([0, 1, 2, 3], 3, [1, 3]);
eq(r3.status, 'dangling_active', 'mid-dangling: status');
eq(r3.dangling, [2], 'mid-dangling: dangling seqs');
eq(r3.headMissing, false, 'mid-dangling: head record exists');

// 孤儿：存在记录但不在 active — 不算 broken
var r4 = diagnoseChainRefs([0, 1, 2], 2, [1, 2, 5, 9]);
eq(r4.status, 'ok', 'orphans: status stays ok');
eq(r4.orphans, [5, 9], 'orphans: detected');

// head 不在 active（记录存在但脱离链）
var r5 = diagnoseChainRefs([0, 1], 5, [1, 2, 5]);
eq(r5.status, 'dangling_active', 'head-not-in-active: status');
eq(r5.dangling, [], 'head-not-in-active: no dangling');
eq(r5.headMissing, true, 'head-not-in-active: headMissing');

// 新链初始态：active [0]、head 0、无任何记录
var r6 = diagnoseChainRefs([0], 0, []);
eq(r6.status, 'ok', 'fresh-chain: ok (seq 0 sentinel)');
eq(r6.headMissing, false, 'fresh-chain: head 0 exempt');

// 防御：undefined 输入
var r7 = diagnoseChainRefs(undefined, 0, undefined);
eq(r7.status, 'ok', 'undefined inputs: no throw, ok');
eq(r7.dangling, [], 'undefined inputs: dangling []');
eq(r7.orphans, [], 'undefined inputs: orphans []');

// ====== computeConservativeRepair ======
console.log('\n=== state-versions: computeConservativeRepair ===');

// 尾部悬空 → 截尾
var p1 = computeConservativeRepair([0, 1, 2, 3], 3, 0, [1, 2]);
eq(p1.newActive, [0, 1, 2], 'repair-tail: newActive');
eq(p1.newHead, 2, 'repair-tail: newHead');
eq(p1.newBase, 0, 'repair-tail: newBase');
eq(p1.dropped, [3], 'repair-tail: dropped');

// 中段悬空 → 截到第一个悬空前（前缀语义，不能过滤保留 seq 3）
var p2 = computeConservativeRepair([0, 1, 2, 3], 3, 0, [1, 3]);
eq(p2.newActive, [0, 1], 'repair-mid: prefix only');
eq(p2.newHead, 1, 'repair-mid: newHead');
eq(p2.dropped, [2, 3], 'repair-mid: dropped includes tail');

// 无悬空 → no-op
var p3 = computeConservativeRepair([0, 1, 2], 2, 0, [1, 2]);
eq(p3.newActive, [0, 1, 2], 'repair-noop: unchanged');
eq(p3.dropped, [], 'repair-noop: dropped []');

// head 不在 active 但无悬空 → head 归位为 active 末位
var p4 = computeConservativeRepair([0, 1], 5, 0, [1, 2, 5]);
eq(p4.newActive, [0, 1], 'repair-head-realign: active unchanged');
eq(p4.newHead, 1, 'repair-head-realign: head realigned to last active');

// compact 后单锚点链：active [7]、head 7、base 7
var p5 = computeConservativeRepair([7], 7, 7, [7]);
eq(p5.newActive, [7], 'repair-compacted: unchanged');
eq(p5.dropped, [], 'repair-compacted: no drop');

// 防御：undefined 输入
var p6 = computeConservativeRepair(undefined, undefined, undefined, undefined);
eq(p6.newActive, [], 'repair-undefined: newActive []');
eq(p6.newHead, 0, 'repair-undefined: newHead 0');
eq(p6.newBase, 0, 'repair-undefined: newBase 0');
eq(p6.dropped, [], 'repair-undefined: dropped []');

console.log('\n=== state-versions-chain-check: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
