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

import { computeCompactDeleteSeqs } from '../src/core/vault/state-versions.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

// ====== computeCompactDeleteSeqs (D2) ======
console.log('\n=== state-versions: computeCompactDeleteSeqs (D2) ===');

// 多 seq 折叠到 head
eq(computeCompactDeleteSeqs([0, 1, 2, 3, 4], 4), [0, 1, 2, 3], 'multi-seq: deletes all but head');

// 单 seq（无折叠）
eq(computeCompactDeleteSeqs([4], 4), [], 'single-seq: nothing to delete');

// head 唯一 + 中间项（rollback 后 active 截断）
eq(computeCompactDeleteSeqs([0, 4], 4), [0], 'head 4 active, deletes 0');

// 乱序输入保持原序、过滤 head
eq(computeCompactDeleteSeqs([3, 1, 4, 2], 4), [3, 1, 2], 'unordered input: filters head, preserves order');

// head 不在 active 中（异常态）→ 全删
eq(computeCompactDeleteSeqs([1, 2, 3], 5), [1, 2, 3], 'head not in active: deletes all');

// 空数组
eq(computeCompactDeleteSeqs([], 0), [], 'empty active');

// undefined 输入
eq(computeCompactDeleteSeqs(undefined, 4), [], 'undefined active returns []');

console.log('\n=== state-versions-compact: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
