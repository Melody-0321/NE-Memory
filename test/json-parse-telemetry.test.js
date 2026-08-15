// Node.js localStorage polyfill — settings.js 读 ne_settings，json-parse-telemetry 读 ne_json_parse_stats
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

import { safeJsonParse } from '../src/core/engine/json-fallback.js';
import { getJsonParseStats, resetJsonParseStats, flushJsonParseStats } from '../src/core/engine/json-parse-telemetry.js';
import { invalidateNeSettingsCache } from '../src/core/settings.js';

// 开启 telemetry 开关（recordJsonParseResult 受 enableTelemetry 控制）
localStorage.setItem('ne_settings', JSON.stringify({ enableTelemetry: true }));
invalidateNeSettingsCache();

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + b + ', got ' + a + ')'); }

// 开关控制：telemetry 关闭时不计数
resetJsonParseStats();
localStorage.setItem('ne_settings', JSON.stringify({ enableTelemetry: false }));
invalidateNeSettingsCache();
safeJsonParse('{"a":1}');
eq(getJsonParseStats().total, 0, 'telemetry disabled -> no records');
localStorage.setItem('ne_settings', JSON.stringify({ enableTelemetry: true }));
invalidateNeSettingsCache();

console.log('\n=== json-parse-telemetry: safeJsonParse 分级计数 ===');

// 空输入不打点
resetJsonParseStats();
assert(safeJsonParse('') === null, 'empty string -> null');
assert(safeJsonParse(null) === null, 'null -> null');
var s0 = getJsonParseStats();
eq(s0.total, 0, 'empty/null inputs produce no records');

// direct 成功
resetJsonParseStats();
safeJsonParse('{"a":1}');
eq(getJsonParseStats().direct, 1, 'direct parse success -> direct+1');
eq(getJsonParseStats().total, 1, 'direct parse counts total');

// code_block 成功
resetJsonParseStats();
safeJsonParse('```json\n{"a":1}\n```');
eq(getJsonParseStats().code_block, 1, 'markdown code block -> code_block+1');

// trailing_comma 成功
resetJsonParseStats();
safeJsonParse('{"a":1,}');
eq(getJsonParseStats().trailing_comma, 1, 'trailing comma fix -> trailing_comma+1');

// balanced 成功（说明文字包裹 JSON）
resetJsonParseStats();
safeJsonParse('说明文字 {"a":1} 结尾');
eq(getJsonParseStats().balanced, 1, 'balanced bracket scan -> balanced+1');

// 未闭合截断输入：balanced 扫描返回 null -> 计入 failed（truncated 分支无自然触发路径）
resetJsonParseStats();
assert(safeJsonParse('{"a":1') === null, 'unclosed json -> null');
eq(getJsonParseStats().failed, 1, 'unclosed input -> failed+1');

// 完全无 JSON
resetJsonParseStats();
assert(safeJsonParse('完全没有json') === null, 'no json -> null');
eq(getJsonParseStats().failed, 1, 'no json -> failed+1');

// 返回值不受打点影响
var parsed = safeJsonParse('{"x":[1,2]}');
assert(parsed && parsed.x && parsed.x.length === 2, 'parse result unchanged by telemetry');

// 深拷贝：外部 mutate 不影响内部计数
resetJsonParseStats();
safeJsonParse('{"a":1}');
var stats = getJsonParseStats();
stats.direct = 999;
eq(getJsonParseStats().direct, 1, 'getJsonParseStats returns deep copy');

flushJsonParseStats();
console.log('\n=== json-parse-telemetry: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);