import { runtime } from '../src/core/runtime.js';
import { extractStateFields, mergeDynamicState, formatDynamicStateSummary } from '../src/core/engine/state-discovery.js';

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
function ok(v, msg) { assert(v, msg + ' (got ' + JSON.stringify(v) + ')'); }

console.log('\n=== state-discovery: extractStateFields ===');

// 1. 空/无效输入
var r = extractStateFields(null);
eq(Object.keys(r.global).length, 0, 'null → global 空');
eq(Object.keys(r.byCharacter).length, 0, 'null → byCharacter 空');

r = extractStateFields('');
eq(Object.keys(r.global).length, 0, '"" → global 空');

// 2. 单行独立字段
r = extractStateFields('HP: 100');
ok(r.global['HP'], 'HP present');
eq(r.global['HP'], '100', 'HP=100');

// 3. 中文冒号
r = extractStateFields('体力：满');
ok(r.global['体力'], '体力 present');
eq(r.global['体力'], '满', '体力=满');

// 4. 状态栏关键词附近多字段（状态栏关键字独占一行 + 后续行单字段格式）
r = extractStateFields('状态\nHP:100\nMP:200');
ok(r.global['HP'], 'HP=100 (多字段分行)');
ok(r.global['MP'], 'MP=200 (多字段分行)');

// 5. 括号字段 【key:value】— 需要 characterNames 才能归属角色
r = extractStateFields('张三【气血:重伤】走在路上', ['张三']);
ok(r.byCharacter['张三'], '张三 byCharacter present');
eq(r.byCharacter['张三']['气血'], '重伤', '张三.气血=重伤');

// 5b. 无 characterNames → 括号字段归 global
r = extractStateFields('【天气:晴】');
ok(r.global['天气'], '无characterNames → global');

// 6. 叙述词过滤
r = extractStateFields('他说：你好');
assert(!r.global['他说'], '"他说" 被叙述词过滤');
assert(!r.global['he said'], '"he said" 被叙述词过滤');

// 7. 过长 key 过滤 (>25)
r = extractStateFields('这是一个非常非常非常非常非常长的key: value');
var longKeyFound = false;
var gk2 = Object.keys(r.global);
for (var i = 0; i < gk2.length; i++) { if (gk2[i].length > 25) longKeyFound = true; }
assert(!longKeyFound, '>25 字符 key 被过滤');

// 8. 带角色名的括号字段归属
r = extractStateFields('张三【HP:80】', ['张三']);
ok(r.byCharacter['张三'], '角色归属正确');
ok(r.byCharacter['张三']['HP'], '张三.HP');

// 9. 无角色名括号字段归 global（已在 5b 测试）

// 10. 纯数字/标点 key 过滤
r = extractStateFields('123: abc');
assert(!r.global['123'], '纯数字 key 被过滤');

// 11. ST 变量语法（当前正则要求 key 后有 :: 或 : 分隔符）
r = extractStateFields('{{getvar::money::}} {{setvar::exp::100}}');
ok(r.global['money'], 'money getvar detected');
eq(r.global['money'], '(variable)', 'getvar 无值 → (variable)');
ok(r.global['exp'], 'exp setvar detected');
eq(r.global['exp'], '100', 'setvar value=100');

// ====== mergeDynamicState ======

console.log('\n=== state-discovery: mergeDynamicState ===');

// 12. 浅合并
var ds = { global: { HP: '100' }, characters: { '张三': { HP: '80' } } };
var merged = mergeDynamicState(ds, { 'global.HP': '90' });
eq(merged.global.HP, '90', '浅合并 HP 100→90');
eq(merged.characters['张三'].HP, '80', '未改字段不变');

// 13. dot-path 深合并
merged = mergeDynamicState(ds, { 'characters.张三.status': '受伤' });
eq(merged.characters['张三'].status, '受伤', 'dot-path characters.张三.status=受伤');

// 14. 空 changes → 原样返回
merged = mergeDynamicState(ds, null);
ok(merged.global.HP === '100', '空 changes → 原样');

// 15. 空 state → 空对象
merged = mergeDynamicState(null, { 'x': '1' });
assert(typeof merged === 'object' && !Array.isArray(merged), 'null state → {}');

// ====== formatDynamicStateSummary ======

console.log('\n=== state-discovery: formatDynamicStateSummary ===');

// 16. 非空 dynamic_state 产生摘要文本
var summary = formatDynamicStateSummary(ds);
ok(summary.length > 0, '非空 state → 非空摘要');
assert(summary.indexOf('HP') !== -1, '摘要包含 HP');
assert(summary.indexOf('张三') !== -1, '摘要包含角色名');

// 17. 空 → 空
summary = formatDynamicStateSummary(null);
eq(summary, '', 'null → ""');
summary = formatDynamicStateSummary({});
eq(summary, '', '{} → ""');

console.log('--- state-discovery: ' + test.passed + ' passed, ' + test.failed + ' failed ---');
if (test.failed > 0) process.exit(1);
