/**
 * injection-arcblock.test.js — P1 弧激活测试
 *
 * 覆盖：
 * - mergePipelines 双向归并（arcInjectionEnabled 开）：
 *   正向 arc_expand（弧命中拉拍 ×0.5 降权）/ 反向 arc_pull（拍命中拉弧，继承最高拍分）/
 *   弧已在场不覆盖 / 拍已在场不降权 / stm_refs 悬空跳过 / 无 parent_ltm 跳过 /
 *   目录搭车（ltm_dir）不触发 / 开关 off 时零改动（无 arc_expand/arc_pull 条目）
 * - buildArcBlock 三明治渲染：⭐标题行（time_range+title）/ 摘要行 / 嵌套拍缩进与故事时序 /
 *   arc_pull 弧只嵌命中拍 / 正向命中弧嵌全部在场拍 / 空 event 弧 / 多弧 Day 数字排序 / 无弧空串
 */
import { mergePipelines } from '../src/core/engine/retrieval.js';
import { buildArcBlock } from '../src/core/engine/injection.js';
import { invalidateNeSettingsCache } from '../src/core/settings.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }

// Node localStorage polyfill（settings.js 读 ne_settings）
globalThis.localStorage = {
    _store: {},
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
    setItem: function(k, v) { this._store[k] = String(v); },
    removeItem: function(k) { delete this._store[k]; }
};

function setArcSetting(on) {
    localStorage.setItem('ne_settings', JSON.stringify({ arcInjectionEnabled: on }));
    invalidateNeSettingsCache();
}

// ── 夹具 ──
var allLTM = [
    { id: 'ltm_1', title: '月票赌约', event: '赌约从成立到兑现', time_range: 'Day 11-13', stm_refs: ['stm_1', 'stm_2', 'stm_404'], present_characters: ['江岚'], timestamp: 200 },
    { id: 'ltm_2', title: '搬家', event: '林晚搬入601', time_range: 'Day 3-5', stm_refs: ['stm_3'], present_characters: ['林晚'], timestamp: 100 },
    { id: 'ltm_3', title: '未命中弧', event: '不在结果集', time_range: 'Day 7-8', stm_refs: ['stm_9'], present_characters: ['路人'], timestamp: 150 }
];
var allSTM = [
    { id: 'stm_1', event: '赌约成立', period: 'Day 11', parent_ltm: 'ltm_1', absMsgStart: 10, present_characters: ['江岚'] },
    { id: 'stm_2', event: '兑现，差87票', period: 'Day 13', parent_ltm: 'ltm_1', absMsgStart: 20, present_characters: ['江岚'] },
    { id: 'stm_3', event: '林晚搬入601', period: 'Day 3', parent_ltm: 'ltm_2', absMsgStart: 30, present_characters: ['林晚'] },
    { id: 'stm_4', event: '独立事件', period: 'Day 4', absMsgStart: 40, present_characters: ['路人'] }
];

function copyHit(entry, relevance, extra) {
    var c = Object.assign({}, entry);
    c.__type = entry.stm_refs ? 'ltm' : 'stm';
    c.__id = entry.id;
    c.__relevance = relevance;
    if (extra) Object.keys(extra).forEach(function(k) { c[k] = extra[k]; });
    return c;
}

// ═══ mergePipelines：双向归并 ═══

console.log('\n=== arcblock: mergePipelines 正向归并（arc_expand） ===');
setArcSetting(true);

// Case A：弧打分命中 → 拉全部 stm_refs（悬空 stm_404 跳过）；目录搭车 ltm_2 不触发
var bm25A = [
    copyHit(allLTM[0], 0.8),                                  // ltm_1 打分命中
    copyHit(allLTM[1], 0, { __isDirectory: true, __relevance: undefined }), // ltm_2 目录搭车
    copyHit(allSTM[3], 0.6)                                   // stm_4 打分命中（无 parent_ltm）
];
var mergedA = await mergePipelines(bm25A, {}, allLTM, {}, allSTM);
var mapA = mergedA.map;

assert(mapA.get('stm_1') && mapA.get('stm_1').sources[0] === 'arc_expand',
    '正向：stm_1 被 arc_expand 拉入');
assert(Math.abs(mapA.get('stm_1').relevance - 0.4) < 1e-9,
    '正向：拉入拍 relevance = 弧分 0.8 × 0.5 = 0.4（实际 ' + mapA.get('stm_1').relevance + '）');
assert(mapA.get('stm_2') && mapA.get('stm_2').sources[0] === 'arc_expand', '正向：stm_2 被拉入');
assert(!mapA.has('stm_404'), '正向：stm_refs 悬空（stm_404 库外）跳过');
assert(!mapA.has('stm_3') && !mapA.has('stm_9'),
    '目录搭车不触发：ltm_2 的 stm_3 / ltm_3 的 stm_9 均未被拉入');
assert(mapA.get('ltm_1').sources[0] === 'bm25' && Math.abs(mapA.get('ltm_1').relevance - 0.8) < 1e-9,
    '正向：弧本体保持打分命中态（sources=bm25, 0.8）');

console.log('\n=== arcblock: mergePipelines 反向归并（arc_pull） ===');

// Case B：拍命中 + 弧同时在结果集 → 弧不覆盖、拍不降权、未在场兄弟拍被正向拉入
var bm25B = [
    copyHit(allSTM[1], 0.9),   // stm_2 打分命中（parent ltm_1）
    copyHit(allLTM[0], 0.5)    // ltm_1 打分命中（弱于拍继承分）
];
var mergedB = await mergePipelines(bm25B, {}, allLTM, {}, allSTM);
var mapB = mergedB.map;

assert(Math.abs(mapB.get('stm_2').relevance - 0.9) < 1e-9 && mapB.get('stm_2').sources[0] === 'bm25',
    '拍已在场不降权：stm_2 保持 0.9 / bm25');
assert(Math.abs(mapB.get('ltm_1').relevance - 0.5) < 1e-9 && mapB.get('ltm_1').sources[0] === 'bm25',
    '弧已在场不覆盖：ltm_1 保持 0.5 / bm25（不被 arc_pull 0.9 覆盖）');
assert(mapB.get('stm_1') && Math.abs(mapB.get('stm_1').relevance - 0.25) < 1e-9,
    '未在场兄弟拍正向拉入：stm_1 = 0.5 × 0.5 = 0.25');

// Case C：纯反向——弧不在结果集，拍命中拉弧（继承最高拍分）；arc_pull 弧不回扩兄弟拍
var bm25C = [copyHit(allSTM[2], 0.7)]; // stm_3（parent ltm_2）
var mergedC = await mergePipelines(bm25C, {}, allLTM, {}, allSTM);
var mapC = mergedC.map;

assert(mapC.get('ltm_2') && mapC.get('ltm_2').sources[0] === 'arc_pull',
    '反向：拍命中拉入所属弧 ltm_2（arc_pull）');
assert(Math.abs(mapC.get('ltm_2').relevance - 0.7) < 1e-9,
    '反向：弧 relevance 继承拍最高分 0.7（实际 ' + mapC.get('ltm_2').relevance + '）');

// Case E：无 parent_ltm 的拍不拉任何弧
var mergedE = await mergePipelines([copyHit(allSTM[3], 0.6)], {}, allLTM, {}, allSTM);
assert(mergedE.map.size === 1 && !mergedE.map.get('stm_4').entry.parent_ltm,
    '无 parent_ltm 的独立拍不触发 arc_pull');

console.log('\n=== arcblock: mergePipelines 开关 off 零改动 ===');
setArcSetting(false);
var mergedD = await mergePipelines(bm25A, {}, allLTM, {}, allSTM);
var mapD = mergedD.map;
var hasArcSource = false;
mapD.forEach(function(e) {
    if (e.sources.indexOf('arc_expand') !== -1 || e.sources.indexOf('arc_pull') !== -1) hasArcSource = true;
});
assert(!hasArcSource, 'off：无任何 arc_expand / arc_pull 条目');
assert(!mapD.has('stm_1') && !mapD.has('stm_2'), 'off：正向拉拍不发生');
assert(mapD.size === 3, 'off：map 仅含 bm25 结果集 3 条（实际 ' + mapD.size + '）');
setArcSetting(true); // 恢复，供后续用例

// ═══ buildArcBlock：三明治渲染 ═══

console.log('\n=== arcblock: buildArcBlock 基本形态与嵌套拍时序 ===');

// 正向命中弧：标题 + 摘要 + 嵌套拍（map 插入顺序故意倒序，验证 absMsgStart 故事时序）
var m1 = new Map();
m1.set('stm_2', { entry: allSTM[1], type: 'stm', relevance: 0.4, sources: ['arc_expand'] });
m1.set('ltm_1', { entry: allLTM[0], type: 'ltm', relevance: 0.8, sources: ['bm25'] });
m1.set('stm_1', { entry: allSTM[0], type: 'stm', relevance: 0.4, sources: ['arc_expand'] });
var block1 = buildArcBlock(m1);

assert(block1.indexOf('## 剧情弧') === 0, '标题块打头');
assert(block1.indexOf('⭐ [Day 11-13] 月票赌约') !== -1, '⭐ 标题行 = time_range + title');
assert(block1.indexOf('赌约从成立到兑现') !== -1, '弧摘要（event）行存在');
assert(block1.indexOf('  › [Day 11] 赌约成立') !== -1, '嵌套拍缩进 2 格 + [period] 前缀');
assert(block1.indexOf('  › [Day 13] 兑现，差87票') !== -1, '第二拍渲染');
assert(block1.indexOf('[Day 11] 赌约成立') < block1.indexOf('[Day 13] 兑现，差87票'),
    '嵌套拍按 absMsgStart 故事时序升序');

console.log('\n=== arcblock: buildArcBlock 嵌套拍口径 ===');

// arc_pull 弧：只嵌已命中拍（relevance>0），relevance=0 的链路拍不嵌
var m2 = new Map();
m2.set('ltm_2', { entry: { id: 'ltm_2', title: '搬家', event: '林晚搬入601', time_range: 'Day 3-5', stm_refs: ['stm_3', 'stm_5'] }, type: 'ltm', relevance: 0.7, sources: ['arc_pull'] });
m2.set('stm_3', { entry: { id: 'stm_3', event: '签约', period: 'Day 3', parent_ltm: 'ltm_2', absMsgStart: 1 }, type: 'stm', relevance: 0.7, sources: ['bm25'] });
m2.set('stm_5', { entry: { id: 'stm_5', event: '链路预取拍', period: 'Day 5', parent_ltm: 'ltm_2', absMsgStart: 2 }, type: 'stm', relevance: 0, sources: ['chain:林晚'] });
var block2 = buildArcBlock(m2);
assert(block2.indexOf('签约') !== -1, 'arc_pull 弧：命中拍（0.7）嵌套');
assert(block2.indexOf('链路预取拍') === -1, 'arc_pull 弧：relevance=0 链路拍不嵌（控 token）');

// 正向命中弧：嵌全部在场拍（含 relevance=0 的链路拍）
var m3 = new Map();
m3.set('ltm_1', { entry: allLTM[0], type: 'ltm', relevance: 0.8, sources: ['bm25'] });
m3.set('stm_1', { entry: allSTM[0], type: 'stm', relevance: 0.4, sources: ['arc_expand'] });
m3.set('stm_0', { entry: { id: 'stm_0', event: '链路预取拍B', period: 'Day 10', parent_ltm: 'ltm_1', absMsgStart: 5 }, type: 'stm', relevance: 0, sources: ['chain:江岚'] });
var block3 = buildArcBlock(m3);
assert(block3.indexOf('赌约成立') !== -1, '正向弧：arc_expand 拍嵌套');
assert(block3.indexOf('链路预取拍B') !== -1, '正向弧：relevance=0 在场拍也嵌（全部在场拍口径）');

console.log('\n=== arcblock: buildArcBlock 边界 ===');

// 空 event 弧：标题即止，无空摘要行、无嵌套拍
var m4 = new Map();
m4.set('ltm_e', { entry: { id: 'ltm_e', title: '空摘要弧', event: '', time_range: 'Day 1-2', stm_refs: [] }, type: 'ltm', relevance: 0.6, sources: ['bm25'] });
var block4 = buildArcBlock(m4);
assert(block4.indexOf('⭐ [Day 1-2] 空摘要弧') !== -1, '空 event 弧标题行正常');
assert(block4.indexOf('›') === -1, '空 event 弧无嵌套拍');
assert(block4 === '## 剧情弧\n⭐ [Day 1-2] 空摘要弧', '空 event 弧：标题即止，无空摘要行');

// 多弧 Day 数字排序（Day 2 在 Day 10 前；无 Day 标签最后）+ 无 time_range 弧
var m5 = new Map();
m5.set('ltm_a', { entry: { id: 'ltm_a', title: '晚弧', event: '', time_range: 'Day 10-12' }, type: 'ltm', relevance: 0.9, sources: ['bm25'] });
m5.set('ltm_b', { entry: { id: 'ltm_b', title: '早弧', event: '', time_range: 'Day 2-4' }, type: 'ltm', relevance: 0.8, sources: ['bm25'] });
m5.set('ltm_c', { entry: { id: 'ltm_c', title: '无标签弧', event: '' }, type: 'ltm', relevance: 0.7, sources: ['bm25'] });
var block5 = buildArcBlock(m5);
assert(block5.indexOf('早弧') < block5.indexOf('晚弧'), 'Day 数字语义排序：Day 2 在 Day 10 前');
assert(block5.indexOf('晚弧') < block5.indexOf('无标签弧'), '无 Day 标签弧排最后');

// 无弧 → 空串
var m6 = new Map();
m6.set('stm_4', { entry: allSTM[3], type: 'stm', relevance: 0.6, sources: ['bm25'] });
m6.set('ltm_dir', { entry: { id: 'ltm_d', title: '目录', event: '' }, type: 'ltm', relevance: 0, sources: ['ltm_dir'] });
assert(buildArcBlock(m6) === '', '无打分弧（仅拍+目录搭车）返回空串');
assert(buildArcBlock(new Map()) === '', '空 map 返回空串');
assert(buildArcBlock(null) === '', 'null map 返回空串');

console.log('\n=== arcblock: 接线开关语义 ===');
// formatSmartContext 的 arcInjectionEnabled 分支卫语句：ne_settings 缺省时为 falsy（默认 off），
// 与 stateBlockEnabled 同款对账模式（开关全 off 时的字节级回归由 mergePipelines off 用例 +
// buildArcBlock 空串短路共同保证：off 时 filterCandidates 不收 LTM 打分、归并零改动、渲染不接线）
var settingsOff = {};
assert(!settingsOff.arcInjectionEnabled, '缺省设置下 arcInjectionEnabled 为 falsy（默认 off）');

console.log('\n' + (failed === 0 ? 'ALL PASS (' + passed + ')' : 'FAILED ' + failed + '/' + (passed + failed)));
process.exit(failed === 0 ? 0 : 1);
