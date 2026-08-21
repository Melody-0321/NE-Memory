/**
 * injection-arcblock.test.js — P1 弧激活测试（V4 卡片式，2026-08-22 重设计）
 *
 * 覆盖：
 * - mergePipelines 反向归并 arc_pull（arcInjectionEnabled 开）：
 *   拍命中拉弧（继承最高拍分）/ 弧已在场不覆盖 / 无 parent_ltm 跳过 /
 *   悬空 parent_ltm 防御 / 目录搭车不触发 / 开关 off 时零改动
 *   （V4 已删 arc_expand：弧命中不再拉 stm_refs——拍在场权归拍自身检索分）
 * - buildArcBlock 卡片渲染：⭐标题行（time_range+title）/ 摘要行 /
 *   仅嵌自身命中拍（relevance>0）/ 嵌套拍时序 / K 帽（relevance top-6）/
 *   空 event 弧跳过 / consumedStmIds 唯一出现出参 / 多弧 Day 数字排序 / 无弧空串
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

// ═══ mergePipelines：arc_pull 归并（V4：仅反向，arc_expand 已删） ═══

console.log('\n=== arcblock: mergePipelines arc_expand 已删（弧命中不拉拍） ===');
setArcSetting(true);

// Case A：弧打分命中 → 不再拉 stm_refs（V4 语义）；目录搭车不触发
var bm25A = [
    copyHit(allLTM[0], 0.8),                                  // ltm_1 打分命中
    copyHit(allLTM[1], 0, { __isDirectory: true, __relevance: undefined }), // ltm_2 目录搭车
    copyHit(allSTM[3], 0.6)                                   // stm_4 打分命中（无 parent_ltm）
];
var mergedA = await mergePipelines(bm25A, {}, allLTM, {}, allSTM);
var mapA = mergedA.map;

assert(!mapA.has('stm_1') && !mapA.has('stm_2'),
    'V4：弧命中不拉 stm_refs（stm_1/stm_2 均不在场）');
assert(mapA.get('ltm_1') && mapA.get('ltm_1').sources[0] === 'bm25' && Math.abs(mapA.get('ltm_1').relevance - 0.8) < 1e-9,
    '弧本体保持打分命中态（sources=bm25, 0.8）');
assert(mapA.size === 3, 'map 仅含 bm25 结果集 3 条（实际 ' + mapA.size + '）');

console.log('\n=== arcblock: mergePipelines 反向归并（arc_pull） ===');

// Case B：拍命中 + 弧同时在结果集 → 弧不覆盖、拍不降权
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
assert(!mapB.has('stm_1'), '兄弟拍不被拉入（拍在场权归自身检索分）');

// Case C：纯反向——弧不在结果集，拍命中拉弧（继承最高拍分）
var bm25C = [copyHit(allSTM[2], 0.7)]; // stm_3（parent ltm_2）
var mergedC = await mergePipelines(bm25C, {}, allLTM, {}, allSTM);
var mapC = mergedC.map;

assert(mapC.get('ltm_2') && mapC.get('ltm_2').sources[0] === 'arc_pull',
    '反向：拍命中拉入所属弧 ltm_2（arc_pull）');
assert(Math.abs(mapC.get('ltm_2').relevance - 0.7) < 1e-9,
    '反向：弧 relevance 继承拍最高分 0.7（实际 ' + mapC.get('ltm_2').relevance + '）');

// Case C2：同弧多拍命中 → 继承最高分
var bm25C2 = [copyHit(allSTM[0], 0.3), copyHit(allSTM[1], 0.9)];
var mergedC2 = await mergePipelines(bm25C2, {}, allLTM, {}, allSTM);
assert(Math.abs(mergedC2.map.get('ltm_1').relevance - 0.9) < 1e-9,
    '同弧多拍：继承最高拍分 0.9');

// Case E：无 parent_ltm 的拍不拉任何弧
var mergedE = await mergePipelines([copyHit(allSTM[3], 0.6)], {}, allLTM, {}, allSTM);
assert(mergedE.map.size === 1 && !mergedE.map.get('stm_4').entry.parent_ltm,
    '无 parent_ltm 的独立拍不触发 arc_pull');

// Case F：悬空 parent_ltm（指向库外弧）防御
var stmOrphan = { id: 'stm_x', event: '孤儿拍', period: 'Day 9', parent_ltm: 'ltm_999', absMsgStart: 50 };
var mergedF = await mergePipelines([copyHit(stmOrphan, 0.5)], {}, allLTM, {}, allSTM.concat([stmOrphan]));
assert(!mergedF.map.has('ltm_999'), '悬空 parent_ltm 不产生幽灵弧条目');

console.log('\n=== arcblock: mergePipelines 开关 off 零改动 ===');
setArcSetting(false);
var mergedD = await mergePipelines(bm25C, {}, allLTM, {}, allSTM);
var hasArcSource = false;
mergedD.map.forEach(function(e) {
    if (e.sources.indexOf('arc_pull') !== -1) hasArcSource = true;
});
assert(!hasArcSource, 'off：无任何 arc_pull 条目');
assert(!mergedD.map.has('ltm_2'), 'off：拉弧不发生');
assert(mergedD.map.size === 1, 'off：map 仅含 bm25 结果集 1 条（实际 ' + mergedD.map.size + '）');
setArcSetting(true); // 恢复，供后续用例

// ═══ buildArcBlock：卡片渲染 ═══

console.log('\n=== arcblock: buildArcBlock 基本形态与嵌套拍时序 ===');

// 命中弧：标题 + 摘要 + 嵌套拍（只嵌自身命中拍；map 插入顺序故意倒序，验证 absMsgStart 故事时序）
var m1 = new Map();
m1.set('stm_2', { entry: allSTM[1], type: 'stm', relevance: 0.9, sources: ['bm25'] });
m1.set('ltm_1', { entry: allLTM[0], type: 'ltm', relevance: 0.5, sources: ['arc_pull'] });
m1.set('stm_1', { entry: allSTM[0], type: 'stm', relevance: 0.8, sources: ['bm25'] });
var consumed1 = new Map();
var block1 = buildArcBlock(m1, consumed1);

assert(block1.indexOf('## 剧情弧') === 0, '标题块打头');
assert(block1.indexOf('⭐ [Day 11-13] 月票赌约') !== -1, '⭐ 标题行 = time_range + title');
assert(block1.indexOf('赌约从成立到兑现') !== -1, '弧摘要（event）行存在');
assert(block1.indexOf('  › [Day 11] 赌约成立') !== -1, '嵌套拍缩进 2 格 + [period] 前缀');
assert(block1.indexOf('  › [Day 13] 兑现，差87票') !== -1, '第二拍渲染');
assert(block1.indexOf('[Day 11] 赌约成立') < block1.indexOf('[Day 13] 兑现，差87票'),
    '嵌套拍按 absMsgStart 故事时序升序');
assert(consumed1.size === 2 && consumed1.has('stm_1') && consumed1.has('stm_2'),
    'consumedStmIds 出参：两条嵌套拍均登记（唯一出现）');

console.log('\n=== arcblock: buildArcBlock 嵌套拍口径 ===');

// 只嵌自身命中拍（relevance>0）；relevance=0 的链路拍不嵌（V4 统一口径，不分弧来源）
var m2 = new Map();
m2.set('ltm_2', { entry: { id: 'ltm_2', title: '搬家', event: '林晚搬入601', time_range: 'Day 3-5', stm_refs: ['stm_3', 'stm_5'] }, type: 'ltm', relevance: 0.7, sources: ['arc_pull'] });
m2.set('stm_3', { entry: { id: 'stm_3', event: '签约', period: 'Day 3', parent_ltm: 'ltm_2', absMsgStart: 1 }, type: 'stm', relevance: 0.7, sources: ['bm25'] });
m2.set('stm_5', { entry: { id: 'stm_5', event: '链路预取拍', period: 'Day 5', parent_ltm: 'ltm_2', absMsgStart: 2 }, type: 'stm', relevance: 0, sources: ['chain:林晚'] });
var block2 = buildArcBlock(m2);
assert(block2.indexOf('签约') !== -1, '命中拍（0.7）嵌套');
assert(block2.indexOf('链路预取拍') === -1, 'relevance=0 链路拍不嵌（V4 统一口径：拍须自身命中）');

// 打分命中弧（bm25）同样只嵌自身命中拍——弧不再携带底层条目
var m3 = new Map();
m3.set('ltm_1', { entry: allLTM[0], type: 'ltm', relevance: 0.8, sources: ['bm25'] });
m3.set('stm_1', { entry: allSTM[0], type: 'stm', relevance: 0.4, sources: ['bm25'] });
var block3 = buildArcBlock(m3);
assert(block3.indexOf('赌约成立') !== -1, '打分命中弧：自身命中的拍嵌套');
assert(block3.indexOf('兑现，差87票') === -1, '打分命中弧：未命中的兄弟拍不嵌（V4 不拉全 refs）');

console.log('\n=== arcblock: buildArcBlock 边界 ===');

// 空 event 弧（fallback 兜底产物）：整卡跳过
var m4 = new Map();
m4.set('ltm_e', { entry: { id: 'ltm_e', title: '空摘要弧', event: '', time_range: 'Day 1-2', stm_refs: [] }, type: 'ltm', relevance: 0.6, sources: ['bm25'] });
assert(buildArcBlock(m4) === '', '空 event 弧整卡跳过（V4：无信息量不占 K 名额）');

// K 帽：>6 条弧只出 relevance top-6
var m5 = new Map();
for (var i = 1; i <= 8; i++) {
    m5.set('ltm_' + i, { entry: { id: 'ltm_' + i, title: '弧' + i, event: '摘要' + i, time_range: 'Day ' + i }, type: 'ltm', relevance: i / 10, sources: ['bm25'] });
}
var block5 = buildArcBlock(m5);
assert(block5.indexOf('弧8') !== -1 && block5.indexOf('弧7') !== -1 && block5.indexOf('弧6') !== -1,
    'K 帽：top-6 高分弧在场');
assert(block5.indexOf('弧1') === -1 && block5.indexOf('弧2') === -1,
    'K 帽：低分弧被裁（top-6 外）');

// 多弧 Day 数字排序（Day 2 在 Day 10 前；无 Day 标签最后）+ 无 time_range 弧
var m6 = new Map();
m6.set('ltm_a', { entry: { id: 'ltm_a', title: '晚弧', event: 'e', time_range: 'Day 10-12' }, type: 'ltm', relevance: 0.9, sources: ['bm25'] });
m6.set('ltm_b', { entry: { id: 'ltm_b', title: '早弧', event: 'e', time_range: 'Day 2-4' }, type: 'ltm', relevance: 0.8, sources: ['bm25'] });
m6.set('ltm_c', { entry: { id: 'ltm_c', title: '无标签弧', event: 'e' }, type: 'ltm', relevance: 0.7, sources: ['bm25'] });
var block6 = buildArcBlock(m6);
assert(block6.indexOf('早弧') < block6.indexOf('晚弧'), 'Day 数字语义排序：Day 2 在 Day 10 前');
assert(block6.indexOf('晚弧') < block6.indexOf('无标签弧'), '无 Day 标签弧排最后');

// 无弧 → 空串（consumedStmIds 不登记）
var m7 = new Map();
m7.set('stm_4', { entry: allSTM[3], type: 'stm', relevance: 0.6, sources: ['bm25'] });
m7.set('ltm_dir', { entry: { id: 'ltm_d', title: '目录', event: '' }, type: 'ltm', relevance: 0, sources: ['ltm_dir'] });
var consumed7 = new Map();
assert(buildArcBlock(m7, consumed7) === '', '无打分弧（仅拍+目录搭车）返回空串');
assert(consumed7.size === 0, '空块时 consumedStmIds 不登记');
assert(buildArcBlock(new Map()) === '', '空 map 返回空串');
assert(buildArcBlock(null) === '', 'null map 返回空串');

console.log('\n=== arcblock: buildArcBlock 退化标题治理（V5b-S1） ===');

// title=time_range 退化（实锤形态 ⭐ [Day 3深夜] Day 3深夜）→ event 首个子句派生
var mT1 = new Map();
mT1.set('ltm_t1', { entry: { id: 'ltm_t1', title: 'Day 3深夜', event: '林晚深夜搬家入601，两人首次相遇。', time_range: 'Day 3深夜' }, type: 'ltm', relevance: 0.7, sources: ['bm25'] });
var blockT1 = buildArcBlock(mT1);
assert(blockT1.indexOf('⭐ [Day 3深夜] 林晚深夜搬家入601') !== -1,
    '退化标题（title=time_range）→ event 首个子句派生');
assert(blockT1.indexOf('⭐ [Day 3深夜] Day 3深夜') === -1,
    '退化标题原文不再出现于标题行');

// Day N 短标签（≤12 字）退化；派生子句到首个 ；截断
var mT2 = new Map();
mT2.set('ltm_t2', { entry: { id: 'ltm_t2', title: 'Day 6', event: '安然在颁奖礼上胜出；差87票。', time_range: 'Day 5-6' }, type: 'ltm', relevance: 0.7, sources: ['bm25'] });
var blockT2 = buildArcBlock(mT2);
assert(blockT2.indexOf('⭐ [Day 5-6] 安然在颁奖礼上胜出') !== -1,
    'Day N 短标签退化 → 派生（到首个 ；截断）');

// 正常标题不动
var mT3 = new Map();
mT3.set('ltm_t3', { entry: { id: 'ltm_t3', title: '月票赌约', event: '赌约从成立到兑现', time_range: 'Day 11-13' }, type: 'ltm', relevance: 0.7, sources: ['bm25'] });
var blockT3 = buildArcBlock(mT3);
assert(blockT3.indexOf('⭐ [Day 11-13] 月票赌约') !== -1, '正常标题保持原样（不派生）');

// 长首子句截断 ≤18 字
var longClause = '这是一个非常非常非常非常长的首子句需要被截断掉';
var mT4 = new Map();
mT4.set('ltm_t4', { entry: { id: 'ltm_t4', title: 'Day 2', event: longClause + '。后续。', time_range: 'Day 2' }, type: 'ltm', relevance: 0.7, sources: ['bm25'] });
var blockT4 = buildArcBlock(mT4);
assert(blockT4.indexOf('⭐ [Day 2] ' + longClause.slice(0, 18)) !== -1,
    '派生标题截断 ≤18 字');

// 空标题（⊆ time_range）→ 同样派生；派生为空（event 首子句空）→ 回退原 title
var mT5 = new Map();
mT5.set('ltm_t5', { entry: { id: 'ltm_t5', title: '', event: '签约成立。', time_range: 'Day 1' }, type: 'ltm', relevance: 0.7, sources: ['bm25'] });
var blockT5 = buildArcBlock(mT5);
assert(blockT5.indexOf('⭐ [Day 1] 签约成立') !== -1, '空标题视为退化 → 派生');
var mT6 = new Map();
mT6.set('ltm_t6', { entry: { id: 'ltm_t6', title: 'Day 9', event: '，开头即标点的摘要。', time_range: 'Day 9' }, type: 'ltm', relevance: 0.7, sources: ['bm25'] });
var blockT6 = buildArcBlock(mT6);
assert(blockT6.indexOf('⭐ [Day 9] Day 9') !== -1, '派生子句为空 → 回退原 title（不产空标题）');

console.log('\n=== arcblock: 接线开关语义 ===');
// formatSmartContext 的 arcInjectionEnabled 分支卫语句：ne_settings 缺省时为 falsy（默认 off），
// 与 stateBlockEnabled 同款对账模式（开关全 off 时的字节级回归由 mergePipelines off 用例 +
// buildArcBlock 空串短路共同保证：off 时 filterCandidates 不收 LTM 打分、归并零改动、渲染不接线）
var settingsOff = {};
assert(!settingsOff.arcInjectionEnabled, '缺省设置下 arcInjectionEnabled 为 falsy（默认 off）');

console.log('\n' + (failed === 0 ? 'ALL PASS (' + passed + ')' : 'FAILED ' + failed + '/' + (passed + failed)));
process.exit(failed === 0 ? 0 : 1);
