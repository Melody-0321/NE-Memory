import { preGroupItems, formatPreGroupHint } from '../src/core/engine/bm25-grouper.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

console.log('\n=== bm25-grouper: preGroupItems ===');

var empty = preGroupItems([]);
eq(empty.length, 0, 'empty input => empty output');

var single = preGroupItems([{ content: 'hello' }]);
eq(single.length, 1, 'single item => 1 group');
eq(single[0].startIdx, 0, 'single group startIdx=0');
eq(single[0].endIdx, 0, 'single group endIdx=0');
eq(single[0].avgSimilarity, 1.0, 'single group avgSimilarity=1.0');

var nullInput = preGroupItems(null);
eq(nullInput.length, 0, 'null input => empty output');

console.log('\n=== bm25-grouper: Similar items stay grouped ===');

var similarItems = [
    { content: '张三和李四在古城中探索秘境入口' },
    { content: '张三根据古神留下的线索找到了通往试炼之地的密道' },
    { content: '李四在秘境深处发现了一件上古法器，散发着强大的灵力波动' }
];
var similarGroups = preGroupItems(similarItems, { similarityThreshold: 0.2 });
assert(similarGroups.length >= 1, 'similar content group count >= 1');
if (similarGroups.length === 1) {
    eq(similarGroups[0].endIdx, 2, 'all 3 items in same group');
    assert(similarGroups[0].avgSimilarity > 0, 'similarity > 0');
}

console.log('\n=== bm25-grouper: Different items split ===');

var differentItems = [
    { content: '这是一段关于修仙体系修炼境界和战斗能力的详细描述' },
    { content: '现代都市中的商业谈判与资本运作分析报告' },
    { content: '根据修仙界的古老传说，修炼者需要突破九重天劫才能飞升' }
];
var diffGroups = preGroupItems(differentItems, { similarityThreshold: 0.3 });
assert(diffGroups.length >= 2, 'different content splits into multiple groups');

console.log('\n=== bm25-grouper: MinGroupSize filter ===');

var fewItems = [
    { content: '修仙体系介绍' },
    { content: '现代商业分析' },
    { content: '古代神话传说' }
];
var minSizeGroups = preGroupItems(fewItems, { similarityThreshold: 0.8, minGroupSize: 2 });
var totalItems = 0;
for (var i = 0; i < minSizeGroups.length; i++) { totalItems += minSizeGroups[i].items.length; }
assert(totalItems <= 3, 'minGroupSize filtering works');

console.log('\n=== bm25-grouper: Custom getText ===');

var customItems = [
    { event: '事件A：主角进入古城' },
    { event: '事件B：主角探索古城密室' },
    { event: '完全不同的内容：现代科技发展' }
];
var customGroups = preGroupItems(customItems, {
    similarityThreshold: 0.2,
    getText: function(item) { return item.event; }
});
assert(customGroups.length >= 1, 'custom getText produces groups');

console.log('\n=== bm25-grouper: Custom tokenizer ===');

var simpleTokenizer = function(text) {
    return (text || '').toLowerCase().split(/\s+/).filter(function(t) { return t.length > 0; });
};
var engItems = [
    { content: 'the hero enters the ancient city' },
    { content: 'the hero explores the city ruins' },
    { content: 'modern quantum computing breakthrough' }
];
var engGroups = preGroupItems(engItems, {
    tokenizer: simpleTokenizer,
    similarityThreshold: 0.2
});
assert(engGroups.length >= 1, 'custom tokenizer works');

console.log('\n=== bm25-grouper: Edge Cases ===');

var emptyContentItems = [
    { content: '' },
    { content: 'something' },
    { content: '' }
];
var emptyGroups = preGroupItems(emptyContentItems, { similarityThreshold: 0.5 });
assert(emptyGroups.length >= 1, 'empty content items produce groups');

var noContentField = [{}, { content: 'test' }, {}];
var noFieldGroups = preGroupItems(noContentField, { similarityThreshold: 0.5 });
assert(noFieldGroups.length >= 1, 'missing content field handled');

console.log('\n=== bm25-grouper: formatPreGroupHint ===');

eq(formatPreGroupHint(null), '', 'null groups => empty string');
eq(formatPreGroupHint([]), '', 'empty groups => empty string');
eq(formatPreGroupHint([{ startIdx: 0, endIdx: 0, items: [{ content: 'test' }], avgSimilarity: 1.0 }]), '', 'single group => empty string');

var twoGroups = [
    { startIdx: 0, endIdx: 2, items: [{}, {}, {}], avgSimilarity: 0.75 },
    { startIdx: 3, endIdx: 5, items: [{}, {}, {}], avgSimilarity: 0.82 }
];
var hint = formatPreGroupHint(twoGroups);
ok(hint.indexOf('2 组') !== -1, 'hint mentions group count');
ok(hint.indexOf('组A') !== -1, 'hint includes label A');
ok(hint.indexOf('组B') !== -1, 'hint includes label B');
ok(hint.indexOf('0.75') !== -1, 'hint includes similarity value');
ok(hint.indexOf('0.82') !== -1, 'hint includes second similarity');

var singleItemGroup = [
    { startIdx: 0, endIdx: 0, items: [{}], avgSimilarity: 1.0 },
    { startIdx: 1, endIdx: 1, items: [{}], avgSimilarity: 1.0 }
];
var singleHint = formatPreGroupHint(singleItemGroup);
ok(singleHint.indexOf('独立输入') !== -1, 'single-item group shows 独立输入 label');

console.log('\n--- bm25-grouper: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
