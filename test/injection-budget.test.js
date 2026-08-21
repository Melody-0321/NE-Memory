/**
 * injection-budget.test.js — Stage 3 注入预算（条目帽/引语帽/总量预算 fold 降级）测试
 *
 * 覆盖：
 * - opts 缺省或全 0：输出与无 opts 调用逐字节一致（生产行为回归保障）
 * - entryMaxChars：超长 event 截断（…收尾），period/scene/在场保留，短条目不动
 * - quoteMaxChars：_originalText 引语截断
 * - budgetChars：低 relevance 先折叠、fold 标记带条数、块长 ≤ 预算、高分条目保留、组头计数如实
 * - 同分 tie-break：timestamp 旧的先折
 * - 极小预算：保底全局 top-1 展开，不出空块
 * - 预算宽裕：与 off 输出一致
 * - unassigned 命中条目同样纳入预算收缩（计数标记）
 */
import { buildEntityBlock } from '../src/core/engine/injection.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

function mkEntry(id, period, scene, event, extra) {
    return Object.assign({ id: id, period: period, scene: scene, event: event, timestamp: null, present_characters: ['安然', '江岚'] }, extra || {});
}
function mkW(entry, relevance, quote) {
    var w = { entry: entry, relevance: relevance };
    if (quote) w._originalText = quote;
    return w;
}
function groupedOf(entries) {
    return { groups: { '安然': { entries: entries, refs: [] } }, unassigned: [] };
}

// ── 基线语料 ──
var longEvent = '甲'.repeat(200);
var shortEvent = '短事件内容';
var eLong = mkEntry('e1', 'Day 1 morning', '客厅', longEvent);
var eShort = mkEntry('e2', 'Day 2 night', '阳台', shortEvent);
var baseGrouped = groupedOf([mkW(eLong, 0.9), mkW(eShort, 0.8)]);

console.log('\n=== injection-budget: off 回归 ===');
var base = buildEntityBlock(baseGrouped, {}, ['安然'], null);
var offEmpty = buildEntityBlock(baseGrouped, {}, ['安然'], null, {});
var offZero = buildEntityBlock(baseGrouped, {}, ['安然'], null, { budgetChars: 0, entryMaxChars: 0, quoteMaxChars: 0 });
eq(offEmpty, base, 'opts={} 与无 opts 逐字节一致');
eq(offZero, base, 'opts 全 0 与无 opts 逐字节一致');

console.log('\n=== injection-budget: entryMaxChars ===');
var capped = buildEntityBlock(baseGrouped, {}, ['安然'], null, { entryMaxChars: 110 });
assert(capped.indexOf('甲'.repeat(110) + '…') !== -1, '超长 event 截断为 110 字 + …');
assert(capped.indexOf('甲'.repeat(111)) === -1, '截断后无 111 字残留');
assert(capped.indexOf('[Day 1 morning]') !== -1 && capped.indexOf('客厅') !== -1, 'period/scene 保留');
assert(capped.indexOf('在场: 安然、江岚') !== -1, '在场列表保留');
assert(capped.indexOf(shortEvent + ' | 在场') !== -1, '短条目不受影响（原文完整在场）');

console.log('\n=== injection-budget: quoteMaxChars ===');
var qGrouped = groupedOf([mkW(mkEntry('q1', 'Day 1 morning', '客厅', '事件A'), 0.9, '乙'.repeat(300))]);
var qText = buildEntityBlock(qGrouped, {}, ['安然'], null, { quoteMaxChars: 160 });
assert(qText.indexOf('乙'.repeat(160) + '…') !== -1, '引语截断为 160 字 + …');
assert(qText.indexOf('乙'.repeat(161)) === -1, '引语无 161 字残留');
var qOff = buildEntityBlock(qGrouped, {}, ['安然'], null, {});
assert(qOff.indexOf('乙'.repeat(300)) !== -1, 'off 时引语全量保留');

console.log('\n=== injection-budget: budgetChars fold ===');
// 10 条命中，event 各 ~101 字，relevance 递增 0.1→1.0
var entries = [];
for (var i = 0; i < 10; i++) {
    entries.push(mkW(mkEntry('b' + i, 'Day ' + (i + 1), '客厅', 'EV' + i + '内容' + '丙'.repeat(96)), (i + 1) / 10));
}
var bGrouped = groupedOf(entries);
var bBase = buildEntityBlock(bGrouped, {}, ['安然'], null, {});
assert(bBase.length > 700, '全展开基线确实超预算（实际 ' + bBase.length + '）');
var bText = buildEntityBlock(bGrouped, {}, ['安然'], null, { budgetChars: 700 });
assert(bText.length <= 700, '预算收缩后块长 ≤ 700（实际 ' + bText.length + '）');
assert(bText.indexOf('条事件未展开') !== -1, '出现 fold 标记');
assert(bText.indexOf('EV9') !== -1, '最高分条目仍展开');
assert(bText.indexOf('EV0') === -1, '最低分条目被折叠');
assert(bText.indexOf('10 events in chain, 10 hits') !== -1, '组头 hit 计数如实');

console.log('\n=== injection-budget: 同分 tie-break（旧的先折）===');
var tOld = mkW(mkEntry('t1', 'Day 1 morning', '客厅', 'OLD事件' + '丁'.repeat(90), { timestamp: '2026-01-01T00:00:00Z' }), 0.5);
var tNew = mkW(mkEntry('t2', 'Day 2 morning', '客厅', 'NEW事件' + '丁'.repeat(90), { timestamp: '2026-01-02T00:00:00Z' }), 0.5);
var tText = buildEntityBlock(groupedOf([tOld, tNew]), {}, ['安然'], null, { budgetChars: 150 });
assert(tText.indexOf('OLD事件') === -1, '同分时旧条目先折叠');
assert(tText.indexOf('NEW事件') !== -1, '同分时新条目保留');

console.log('\n=== injection-budget: 极小预算保底 top-1 ===');
var tiny = buildEntityBlock(bGrouped, {}, ['安然'], null, { budgetChars: 10 });
assert(tiny.indexOf('EV9') !== -1, '极小预算仍保底全局 top-1 展开');
assert(tiny.indexOf('<h3><b>安然</b>') !== -1, '块非空且保留组头');
assert(tiny.length > 10, '保底后允许超预算（headers 不可折叠）');

console.log('\n=== injection-budget: 预算宽裕 ===');
var roomy = buildEntityBlock(bGrouped, {}, ['安然'], null, { budgetChars: 100000 });
eq(roomy, bBase, '预算宽裕与 off 输出一致');

console.log('\n=== injection-budget: unassigned 纳入收缩 ===');
var uGrouped = {
    groups: { '安然': { entries: [mkW(mkEntry('u0', 'Day 1', '客厅', 'EVU0' + '戊'.repeat(200)), 0.9)], refs: [] } },
    unassigned: [mkW(mkEntry('u1', 'Day 2', '厨房', 'EVU1' + '戊'.repeat(200)), 0.1), mkW(mkEntry('u2', 'Day 3', '书房', 'EVU2' + '戊'.repeat(200)), 0.2)]
};
var uText = buildEntityBlock(uGrouped, {}, ['安然'], null, { budgetChars: 400 });
assert(uText.length <= 400, 'unassigned 收缩后块长 ≤ 400（实际 ' + uText.length + '）');
assert(uText.indexOf('EVU0') !== -1, '组内高分条目保留');
assert(uText.indexOf('EVU1') === -1, 'unassigned 最低分条目被折叠');
assert(uText.indexOf('条预算内未展开') !== -1, 'unassigned 折叠计数标记存在');

console.log('\n=== injection-budget: 结果 ===');
console.log('passed: ' + passed + '  failed: ' + failed);
if (failed > 0) process.exit(1);
