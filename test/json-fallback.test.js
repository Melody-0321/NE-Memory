import { safeJsonParse } from '../src/core/engine/json-fallback.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function deepeq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

console.log('\n=== json-fallback: Stage 1 Direct Parse ===');

deepeq(safeJsonParse('{"a":1}'), { a: 1 }, 'simple object');
deepeq(safeJsonParse('[1,2,3]'), [1, 2, 3], 'simple array');
deepeq(safeJsonParse('{"nested":{"deep":true}}'), { nested: { deep: true } }, 'nested object');
deepeq(safeJsonParse('{"str":"hello","num":42,"bool":true,"arr":[1,2]}'),
    { str: 'hello', num: 42, bool: true, arr: [1, 2] }, 'mixed types');
eq(safeJsonParse(null), null, 'null input => null');
eq(safeJsonParse(undefined), null, 'undefined input => null');
eq(safeJsonParse(123), null, 'non-string input => null');
eq(safeJsonParse(''), null, 'empty string => null');

console.log('\n=== json-fallback: Stage 1 + thinking removal ===');

deepeq(safeJsonParse('<thinking>ignore</thinking>{"a":1}'), { a: 1 }, 'thinking stripped, json remains valid');
deepeq(safeJsonParse('<thinking>ignore</thinking>{"a":1}extra'), { a: 1 }, 'thinking removed, json parsed');

console.log('\n=== json-fallback: Stage 2 Markdown Code Block ===');

deepeq(safeJsonParse('```json\n{"a":1}\n```'), { a: 1 }, 'code block with json tag');
deepeq(safeJsonParse('```\n{"a":1}\n```'), { a: 1 }, 'code block without json tag');
deepeq(safeJsonParse('Some text\n```json\n{"b":2}\n```\nmore text'), { b: 2 }, 'code block mid-text');

console.log('\n=== json-fallback: Stage 3 Balanced Bracket Scan ===');

deepeq(safeJsonParse('prefix text {"a":1} suffix text'), { a: 1 }, 'json surrounded by text');
deepeq(safeJsonParse('The result is: [1, 2, 3] is the answer'), [1, 2, 3], 'array surrounded by text');
deepeq(safeJsonParse('Action: {"name":"test","nested":{"deep":true}} end'), { name: 'test', nested: { deep: true } }, 'nested json in text');

console.log('\n=== json-fallback: Stage 4 Trailing Comma Fix ===');

var trailingComma = '{"a":1,"b":2,}';
deepeq(safeJsonParse('Result: ' + trailingComma + ' done'), { a: 1, b: 2 }, 'trailing comma in object');

var nestedTrailing = '{"items":[1,2,],}';
deepeq(safeJsonParse('Output: ' + nestedTrailing), { items: [1, 2] }, 'nested trailing commas');

var arrayTrailing = '[1,2,]';
deepeq(safeJsonParse('Got: ' + arrayTrailing), [1, 2], 'array trailing comma');

console.log('\n=== json-fallback: Stage 5 Truncated JSON Repair ===');

eq(safeJsonParse('{"a":1,"b":'), null, 'unbalanced brackets => cannot repair (Stage 3 returns null, Stage 5 unreachable)');

console.log('\n=== json-fallback: Edge Cases ===');

var withEscapedQuotes = '{"msg":"he said \\"hello\\""}';
deepeq(safeJsonParse(withEscapedQuotes), { msg: 'he said "hello"' }, 'escaped quotes');

var unicodeJson = '{"name":"张\u4e09"}';
deepeq(safeJsonParse(unicodeJson), { name: '张三' }, 'unicode characters');

var veryLongString = '{"a":"' + 'x'.repeat(1000) + '"}';
deepeq(safeJsonParse(veryLongString), { a: 'x'.repeat(1000) }, 'long string value');

var emptyJson = '{}';
deepeq(safeJsonParse(emptyJson), {}, 'empty object');

var emptyArray = '[]';
deepeq(safeJsonParse(emptyArray), [], 'empty array');

console.log('\n--- json-fallback: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
