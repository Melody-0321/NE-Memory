// template-assistant.test.js — 模板 AI 助手核心逻辑：
//   fingerprint / 消息组装 / 值分布 / 草稿解析 / 协议校验 / 应用计划 / 落盘 / 上下文预算
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

import {
    buildTemplateFingerprint, buildAssistantMessages, collectFieldValueSummary,
    parseAssistantDraft, validateAssistantDraft, buildApplyPlan, applyAssistantPlan,
    runTemplateAssistant, PER_ROUND_CANDIDATES
} from '../src/core/engine/template-assistant.js';
import { getPresetFieldsForRole, ALL_PREDEFINED_FIELDS } from '../src/core/vault/schema.js';
import { loadFieldLibrary, loadTemplateLibrary, getTemplate } from '../src/core/vault/store.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }
function neq(a, b, msg) { assert(a !== b, msg + ' (should not be ' + JSON.stringify(b) + ')'); }

function resetLibraries() {
    localStorage.removeItem('ne_template_library');
    localStorage.removeItem('ne_field_library');
}

function makeValidDraft(overrides) {
    var d = {
        protocolVersion: 1,
        baseFingerprint: 'fp1_test',
        understanding: '这是一个修仙世界宗门长老模板，包含境界与灵石字段。',
        template: {
            name: '宗门长老',
            role: 'npc',
            description: '修仙宗门长老',
            tags: ['修仙'],
            presetFields: ['gender_age'],
            perRoundFields: ['current_mood'],
            customFields: [
                { name: '修为境界', type: 'enum', values: ['炼气', '筑基', '金丹'] },
                { name: '灵石数量', type: 'number', min: 0, max: 999999 }
            ]
        }
    };
    if (overrides) {
        Object.keys(overrides).forEach(function (k) {
            if (k === 'template') {
                Object.keys(overrides.template).forEach(function (tk) { d.template[tk] = overrides.template[tk]; });
            } else {
                d[k] = overrides[k];
            }
        });
    }
    return d;
}

// ====== A. buildTemplateFingerprint ======
console.log('\n=== template-assistant: fingerprint ===');
resetLibraries();

var tplA = { name: 'X', role: 'npc', description: 'd', presetFields: ['a', 'b'], customFieldRefs: ['乙', '甲'], perRoundFields: [], tags: ['t1'] };
var tplB = { name: 'X', role: 'npc', description: 'd', presetFields: ['b', 'a'], customFieldRefs: ['甲', '乙'], perRoundFields: [], tags: ['t1'] };
eq(buildTemplateFingerprint(tplA), buildTemplateFingerprint(tplB), 'order-insensitive fingerprint');
neq(buildTemplateFingerprint(tplA), buildTemplateFingerprint(Object.assign({}, tplA, { name: 'Y' })), 'content change alters fingerprint');
eq(buildTemplateFingerprint('scratch'), 'scratch', 'string baseline passthrough');
eq(buildTemplateFingerprint('default:pc'), 'default:pc', 'default baseline passthrough');
eq(buildTemplateFingerprint(null), 'scratch', 'null baseline => scratch');
ok(buildTemplateFingerprint(tplA).indexOf('fp1_') === 0, 'fingerprint carries fp1_ prefix');

// ====== B. buildAssistantMessages ======
console.log('\n=== template-assistant: buildAssistantMessages ===');

var msgs = buildAssistantMessages({
    mode: 'create', fingerprint: 'scratch', baselineTemplate: null, baselineLabel: 'scratch',
    userRequest: '做一个修仙模板', worldBookText: '世界书内容ABC', valueSummaryText: '',
    fieldLibrarySummary: ['好感度(number)']
});
eq(msgs.length, 3, 'three messages (system x2 + user)');
eq(msgs[0].role, 'system', 'first message role system');
eq(msgs[2].role, 'user', 'last message role user');
ok(msgs[2].content.indexOf('scratch') !== -1, 'user contains fingerprint');
ok(msgs[2].content.indexOf('做一个修仙模板') !== -1, 'user contains request');
ok(msgs[2].content.indexOf('世界书内容ABC') !== -1, 'user contains world book text');
ok(msgs[2].content.indexOf('好感度(number)') !== -1, 'user contains field library summary');

var msgsNoWb = buildAssistantMessages({ mode: 'create', fingerprint: 'scratch', userRequest: 'r' });
eq(msgsNoWb[2].content.indexOf('世界书设定'), -1, 'no worldbook section when absent');

var msgsRepair = buildAssistantMessages({ mode: 'create', fingerprint: 'scratch', userRequest: 'r', repairErrors: ['enum 缺少 values'] });
ok(msgsRepair[2].content.indexOf('enum 缺少 values') !== -1, 'repair errors injected into user message');

// ====== C. collectFieldValueSummary ======
console.log('\n=== template-assistant: collectFieldValueSummary ===');

resetLibraries();
localStorage.setItem('ne_field_library', JSON.stringify({ fields: {
    自由文本: { type: 'string', max_length: 100, usedByTemplates: [] },
    心境: { type: 'enum', values: ['平静', '激动'], usedByTemplates: [] }
}, updatedAt: '2026-01-01T00:00:00Z' }));
var chars = {};
for (var ci = 0; ci < 12; ci++) {
    chars['角色' + ci] = { 心境: (ci % 2 === 0) ? '平静' : '激动', 自由文本: '值' + ci };
}
var vault = { chatId: 'c1', state: { characters: chars } };
var tplForValues = { presetFields: [], customFieldRefs: ['心境', '自由文本'] };
var vs = collectFieldValueSummary(vault, tplForValues);
ok(vs.text.indexOf('心境（12个角色有值）: 平静×6、激动×6') !== -1, 'enum full distinct with counts');
ok(vs.text.indexOf('等12种') !== -1, 'string top10 truncation note');
eq(vs.map['心境'].distinct.length, 2, 'value map distinct for enum');
eq(collectFieldValueSummary(null, tplForValues).text, '', 'null vault => empty text');
eq(collectFieldValueSummary({ state: { characters: {} } }, tplForValues).text, '', 'no characters => empty text');
resetLibraries();

// ====== D. parseAssistantDraft ======
console.log('\n=== template-assistant: parseAssistantDraft ===');

var validJson = JSON.stringify(makeValidDraft());
ok(parseAssistantDraft(validJson).ok, 'valid JSON parses');
ok(parseAssistantDraft('```json\n' + validJson + '\n```').ok, 'markdown-fenced JSON parses');
eq(parseAssistantDraft('这不是JSON').ok, false, 'garbage fails');
eq(parseAssistantDraft('这不是JSON').failureKind, 'parse', 'garbage failureKind parse');
eq(parseAssistantDraft('').ok, false, 'empty fails');

// ====== E. validateAssistantDraft ======
console.log('\n=== template-assistant: validateAssistantDraft ===');

var ctx = { fingerprint: 'fp1_test' };
var vd = makeValidDraft();
var vres = validateAssistantDraft(vd, ctx);
if (!vres.ok) console.error('  unexpected errors:', JSON.stringify(vres.errors));
eq(vres.ok, true, 'valid draft passes');

eq(validateAssistantDraft(makeValidDraft({ protocolVersion: 2 }), ctx).ok, false, 'wrong protocolVersion rejected');
var fpRes = validateAssistantDraft(makeValidDraft({ baseFingerprint: 'fp1_other' }), ctx);
eq(fpRes.ok, false, 'fingerprint mismatch rejected');
eq(fpRes.failureKind, 'fingerprint', 'fingerprint mismatch failureKind');

eq(validateAssistantDraft(makeValidDraft({ understanding: '' }), ctx).ok, false, 'empty understanding rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { name: '', role: 'npc' } }), ctx).ok, false, 'empty name rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { name: 'X', role: 'event' } }), ctx).ok, false, 'invalid role rejected');

// presetFields 边界
var factionKey = Object.keys(getPresetFieldsForRole('faction'))[0];
ok(!!factionKey, 'faction preset key exists');
eq(validateAssistantDraft(makeValidDraft({ template: { presetFields: [factionKey], role: 'npc' } }), ctx).ok, false, 'preset outside role scope rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { presetFields: ['gender_age', 'gender_age'], role: 'npc' } }), ctx).ok, false, 'duplicate presetFields rejected');

// perRound 边界
eq(validateAssistantDraft(makeValidDraft({ template: { role: 'faction', presetFields: [factionKey], perRoundFields: ['current_mood'] } }), ctx).ok, false, 'perRound on faction rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { perRoundFields: ['no_such_field'] } }), ctx).ok, false, 'perRound outside candidates rejected');

// customFields 边界
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: '_bad', type: 'string', max_length: 50 }] } }), ctx).ok, false, 'underscore prefix rejected');
var predefinedKey = Object.keys(ALL_PREDEFINED_FIELDS)[0];
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: predefinedKey, type: 'string', max_length: 50 }] } }), ctx).ok, false, 'predefined name collision rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { presetFields: ['gender_age'], customFields: [{ name: 'gender_age', type: 'string', max_length: 50 }] } }), ctx).ok, false, 'custom colliding presetFields rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [
    { name: '同字段', type: 'string', max_length: 50 }, { name: '同字段', type: 'number' }
] } }), ctx).ok, false, 'duplicate custom names rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: '甲', type: 'string' }] } }), ctx).ok, false, 'string without max_length rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: '甲', type: 'enum', values: ['唯一'] }] } }), ctx).ok, false, 'enum with 1 value rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: '甲', type: 'enum', values: ['A', 'A'] }] } }), ctx).ok, false, 'enum duplicate values rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: '甲', type: 'number', min: 10, max: 5 }] } }), ctx).ok, false, 'number min>=max rejected');
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: '甲', type: 'number' }] } }), ctx).ok, true, 'number without bounds allowed');
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: '甲', type: 'boolean' }] } }), ctx).ok, true, 'boolean without extras allowed');
eq(validateAssistantDraft(makeValidDraft({ template: { customFields: [{ name: '甲', type: 'text' }] } }), ctx).ok, false, 'unknown type rejected');

// ====== F. buildApplyPlan ======
console.log('\n=== template-assistant: buildApplyPlan ===');
resetLibraries();

// F1: create 模式
var draft1 = makeValidDraft();
draft1.baseFingerprint = 'scratch';
var plan1 = buildApplyPlan(draft1, null, { fields: {} }, { mode: 'create' });
ok(plan1.template.id.indexOf('tpl_') === 0, 'create generates new tpl_ id');
eq(plan1.template.source, 'ai_generated', 'create source ai_generated');
eq(plan1.fieldOps.length, 2, 'two add ops');
eq(plan1.fieldOps[0].op, 'add', 'first op add');
eq(plan1.refAdds.length, 2, 'refAdds for both custom fields');
eq(plan1.refRemoves.length, 0, 'no refRemoves in create');
eq(plan1.diff.customAdded.length, 2, 'diff shows added fields');
eq(plan1.highRiskItems.length, 0, 'no high risk in create');

// F2: modify 模式（字段库已有其中一字段，元数据一致 → reuse；另一字段更新 → update + lib_update）
var createdAt = '2025-01-01T00:00:00Z';
localStorage.setItem('ne_field_library', JSON.stringify({ fields: {
    修为境界: { type: 'enum', values: ['炼气', '筑基', '金丹'], usedByTemplates: ['tpl_other'] },
    旧字段: { type: 'string', max_length: 50, usedByTemplates: [] }
}, updatedAt: '2026-01-01T00:00:00Z' }));
var baseline = {
    id: 'tpl_keep', name: '旧名', role: 'npc', description: '', system: false, source: 'user_created',
    presetFields: [], customFieldRefs: ['修为境界', '旧字段'], perRoundFields: [],
    createdAt: createdAt, _locked: true
};
var draft2 = makeValidDraft();
draft2.baseFingerprint = buildTemplateFingerprint(baseline);
var plan2 = buildApplyPlan(draft2, baseline, loadFieldLibrary(), {
    mode: 'modify',
    valueMap: { 旧字段: { distinct: ['旧值A', '旧值B'], total: 3 } }
});
eq(plan2.template.id, 'tpl_keep', 'modify keeps template id');
eq(plan2.template.createdAt, createdAt, 'modify keeps createdAt');
eq(plan2.template._locked, true, 'modify keeps lock');
var opMap = {};
plan2.fieldOps.forEach(function (o) { opMap[o.name] = o; });
eq(opMap['修为境界'].op, 'reuse', 'identical metadata reuses library entry');
eq(opMap['灵石数量'].op, 'add', 'new field gets add op');
assert(plan2.refRemoves.indexOf('旧字段') !== -1, 'removed field in refRemoves');
assert(plan2.diff.customRemoved.indexOf('旧字段') !== -1, 'diff shows removed field');
var riskKinds = plan2.highRiskItems.map(function (r) { return r.kind; });
assert(riskKinds.indexOf('field_removed') !== -1, 'field_removed high risk');
var removedRisk = plan2.highRiskItems.filter(function (r) { return r.kind === 'field_removed' && r.label === '旧字段'; })[0];
ok(removedRisk && removedRisk.detail.indexOf('3 个角色') !== -1, 'field_removed detail counts affected chars');

// F3: 类型变更 + enum 收窄 + 库更新风险
localStorage.setItem('ne_field_library', JSON.stringify({ fields: {
    修为境界: { type: 'enum', values: ['炼气', '筑基', '金丹'], usedByTemplates: ['tpl_other', 'tpl_x'] }
}, updatedAt: '2026-01-01T00:00:00Z' }));
var draft3 = makeValidDraft();
draft3.template.customFields = [
    { name: '修为境界', type: 'enum', values: ['炼气'] } // 收窄且类型仍 enum → enum_narrowed；删掉 筑基/金丹
];
draft3.template.customFields.push({ name: '灵石数量', type: 'number' });
var plan3 = buildApplyPlan(draft3, baseline, loadFieldLibrary(), {
    mode: 'modify',
    valueMap: { 修为境界: { distinct: ['筑基'], total: 4 } }
});
var kinds3 = plan3.highRiskItems.map(function (r) { return r.kind; });
assert(kinds3.indexOf('enum_narrowed') !== -1, 'enum narrowing flagged');
var narrow = plan3.highRiskItems.filter(function (r) { return r.kind === 'enum_narrowed'; })[0];
ok(narrow && narrow.detail.indexOf('筑基') !== -1 && narrow.detail.indexOf('存量数据在用') !== -1, 'narrowing lists in-use values');
var libUpdate = plan3.highRiskItems.filter(function (r) { return r.kind === 'lib_update'; })[0];
ok(libUpdate && libUpdate.detail.indexOf('2 个模板') !== -1, 'lib_update shows affected template count');
eq(plan3.fieldOps.filter(function (o) { return o.op === 'update'; }).length, 1, 'metadata change yields update op');

// F4: 类型变更
localStorage.setItem('ne_field_library', JSON.stringify({ fields: {
    修为境界: { type: 'string', max_length: 40, usedByTemplates: [] }
}, updatedAt: '2026-01-01T00:00:00Z' }));
var draft4 = makeValidDraft();
var plan4 = buildApplyPlan(draft4, baseline, loadFieldLibrary(), { mode: 'modify' });
assert(plan4.highRiskItems.some(function (r) { return r.kind === 'type_changed' && r.label === '修为境界'; }), 'type change flagged');

// F5: 系统模板基线 → create-copy（新 id）
var sysBaseline = { id: '_default_npc', name: '默认', role: 'npc', system: true, presetFields: [], customFieldRefs: [], createdAt: createdAt };
var draft5 = makeValidDraft();
var plan5 = buildApplyPlan(draft5, sysBaseline, { fields: {} }, { mode: 'modify' });
neq(plan5.template.id, '_default_npc', 'system baseline yields new id');
ok(plan5.template.id.indexOf('tpl_') === 0, 'system baseline copy gets tpl_ id');

// ====== G. applyAssistantPlan ======
console.log('\n=== template-assistant: applyAssistantPlan ===');
resetLibraries();

localStorage.setItem('ne_field_library', JSON.stringify({ fields: {
    已有字段: { type: 'string', max_length: 30, usedByTemplates: ['tpl_old'] }
}, updatedAt: '2026-01-01T00:00:00Z' }));
localStorage.setItem('ne_template_library', JSON.stringify({
    templates: { tpl_target: { id: 'tpl_target', name: 'T', role: 'npc', presetFields: [], customFieldRefs: ['已有字段'], createdAt: '2025-06-01T00:00:00Z' } },
    order: ['tpl_target']
}));
var draftG = makeValidDraft();
var baselineG = {
    id: 'tpl_target', name: 'T', role: 'npc', system: false, presetFields: [],
    customFieldRefs: ['已有字段'], perRoundFields: [], createdAt: '2025-06-01T00:00:00Z'
};
var planG = buildApplyPlan(draftG, baselineG, loadFieldLibrary(), { mode: 'modify' });
applyAssistantPlan(planG);

var libG = loadFieldLibrary();
ok(libG.fields['修为境界'], 'new custom field registered in library');
eq(libG.fields['修为境界'].type, 'enum', 'library entry carries type');
eq(JSON.stringify(libG.fields['修为境界'].values), JSON.stringify(['炼气', '筑基', '金丹']), 'library entry carries enum values');
ok(libG.fields['已有字段'].usedByTemplates.indexOf('tpl_target') === -1, 'refRemoves drops stale ref');
var savedG = getTemplate('tpl_target');
ok(savedG, 'template saved to library');
eq(savedG.name, '宗门长老', 'saved template name from draft');
eq(savedG.createdAt, '2025-06-01T00:00:00Z', 'saved template keeps createdAt');
assert(savedG.customFieldRefs.indexOf('修为境界') !== -1, 'saved template references new fields');
resetLibraries();

// ====== H. runTemplateAssistant: 上下文预算门禁 ======
console.log('\n=== template-assistant: runTemplateAssistant (context budget) ===');

var bigText = new Array(60000).join('字'); // ~60K chars > 48K 预算
var budgetResult = await runTemplateAssistant({
    mode: 'create', baselineTemplate: null, baselineLabel: 'scratch', fingerprint: 'scratch',
    userRequest: '需求', worldBookText: bigText
});
eq(budgetResult.ok, false, 'oversized context fails');
eq(budgetResult.failureKind, 'context_budget', 'failureKind context_budget (no LLM call)');

console.log('\n=== template-assistant: done — ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
