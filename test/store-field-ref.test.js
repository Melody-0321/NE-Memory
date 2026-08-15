// store-field-ref.test.js — 字段库引用完整性：
//   1. templateIdExists 存在性校验（系统默认 / 全局库 / 卡片副本）
//   2. deleteTemplate 删除时清理 customFieldRefs 引用（源头防新增悬挂）
//   3. removeFieldFromLibrary 惰性过滤悬挂引用（存量解锁）
//   4. deleteTemplateVersion 删除非主副本时清理引用
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
    templateIdExists, saveTemplate, deleteTemplate, getTemplate, getEffectiveTemplates,
    deleteTemplateVersion,
    loadFieldLibrary, addFieldToLibrary, removeFieldFromLibrary, getFieldFromLibrary,
    addTemplateRefToField
} from '../src/core/vault/store.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

function resetLibraries() {
    localStorage.removeItem('ne_template_library');
    localStorage.removeItem('ne_field_library');
    localStorage.removeItem('ne_card_templates_refchar');
    localStorage.removeItem('ne_card_templates_cardchar');
}
resetLibraries();

// ====== A. templateIdExists ======
console.log('\n=== store-field-ref: templateIdExists ===');

eq(templateIdExists('_default_pc'), true, 'system default id exists');
eq(templateIdExists('no_such_template'), false, 'nonexistent id does not exist');

saveTemplate({ id: 'tpl_x', name: 'X', role: 'npc' });
eq(templateIdExists('tpl_x'), true, 'global library id exists');
deleteTemplate('tpl_x');
eq(templateIdExists('tpl_x'), false, 'deleted global id no longer exists');

localStorage.setItem('ne_card_templates_cardchar', JSON.stringify({
    _dialogueTemplates: {
        'dt_copy': { _active: true, _templateId: 'tpl_gone', presetFields: [], customFieldRefs: [] }
    },
    _templateConfig: {},
    _version: 0
}));
eq(templateIdExists('dt_copy'), true, 'card-level copy key exists');
eq(templateIdExists('tpl_gone'), false, 'orphaned _templateId not tracked as existing');
localStorage.removeItem('ne_card_templates_cardchar');

// ====== B. deleteTemplate 清理引用 ======
console.log('\n=== store-field-ref: deleteTemplate clears refs ===');

saveTemplate({ id: 'tpl_del', name: 'Del', role: 'npc', presetFields: [], customFieldRefs: ['f1', 'f2'] });
addFieldToLibrary('f1', { type: 'string' });
addFieldToLibrary('f2', { type: 'number' });
addTemplateRefToField('f1', 'tpl_del');
addTemplateRefToField('f2', 'tpl_del');
eq(getFieldFromLibrary('f1').usedByTemplates.length, 1, 'f1 ref registered before delete');

eq(deleteTemplate('tpl_del'), true, 'deleteTemplate succeeds');
eq(getFieldFromLibrary('f1').usedByTemplates.length, 0, 'f1 ref cleared by deleteTemplate');
eq(getFieldFromLibrary('f2').usedByTemplates.length, 0, 'f2 ref cleared by deleteTemplate');
eq(removeFieldFromLibrary('f1'), true, 'field deletable after template removal');
eq(removeFieldFromLibrary('f2'), true, 'field deletable after template removal');

// 共享字段：删一个模板只清该模板的 ref，另一模板的引用仍受保护
saveTemplate({ id: 'tpl_a', name: 'A', role: 'npc', customFieldRefs: ['f3'] });
saveTemplate({ id: 'tpl_b', name: 'B', role: 'npc', customFieldRefs: ['f3'] });
addFieldToLibrary('f3', { type: 'string' });
addTemplateRefToField('f3', 'tpl_a');
addTemplateRefToField('f3', 'tpl_b');
deleteTemplate('tpl_a');
var f3after = getFieldFromLibrary('f3');
eq(f3after.usedByTemplates.length, 1, 'shared field keeps other template ref');
eq(f3after.usedByTemplates[0], 'tpl_b', 'remaining ref is tpl_b');
eq(removeFieldFromLibrary('f3'), false, 'shared field still protected while tpl_b exists');
deleteTemplate('tpl_b');
eq(removeFieldFromLibrary('f3'), true, 'shared field deletable after both templates removed');

// 系统默认 override 分支：删 override 同样清 ref，系统默认本身保留
saveTemplate({ id: '_default_npc', name: 'Ov', role: 'npc', presetFields: [], customFieldRefs: ['f_ov'] });
addFieldToLibrary('f_ov', { type: 'string' });
addTemplateRefToField('f_ov', '_default_npc');
eq(deleteTemplate('_default_npc'), true, 'override deletion returns true');
eq(getFieldFromLibrary('f_ov').usedByTemplates.length, 0, 'override ref cleared');
ok(getEffectiveTemplates().templates['_default_npc'], 'system default still effective after override removal');
eq(removeFieldFromLibrary('f_ov'), true, 'override field deletable');

// ====== C. removeFieldFromLibrary 惰性过滤悬挂引用 ======
console.log('\n=== store-field-ref: lazy dangling-ref cleanup ===');

// 存量场景：模板已删但 ref 残留（历史 bug 产生）→ 允许删除
addFieldToLibrary('f_stale', { type: 'string', usedByTemplates: ['ghost_tpl'] });
eq(removeFieldFromLibrary('f_stale'), true, 'all-dangling refs allow field deletion');
eq(getFieldFromLibrary('f_stale'), null, 'stale field actually removed');

// 混合场景：1 悬挂 + 1 有效 → 拒绝删除但悬挂 ref 被清
saveTemplate({ id: 'tpl_live', name: 'Live', role: 'npc' });
addFieldToLibrary('f_mix', { type: 'string', usedByTemplates: ['ghost2', 'tpl_live'] });
eq(removeFieldFromLibrary('f_mix'), false, 'mixed refs still protect field');
var mixAfter = getFieldFromLibrary('f_mix');
ok(mixAfter, 'field survives refused deletion');
eq(mixAfter.usedByTemplates.length, 1, 'dangling ref pruned on refusal');
eq(mixAfter.usedByTemplates[0], 'tpl_live', 'live ref kept');
eq(removeFieldFromLibrary('f_mix'), false, 'still protected with only live ref');
deleteTemplate('tpl_live');
eq(removeFieldFromLibrary('f_mix'), true, 'deletable once live template removed');

// ====== D. deleteTemplateVersion 清理副本引用 ======
console.log('\n=== store-field-ref: deleteTemplateVersion clears refs ===');

localStorage.setItem('ne_card_templates_refchar', JSON.stringify({
    _dialogueTemplates: {
        'dt_main': { _active: true, _templateId: 'tpl_v', presetFields: [], customFieldRefs: ['f_ver'] },
        'dt_hist': { _active: false, _templateId: 'tpl_v', presetFields: [], customFieldRefs: ['f_ver'] }
    },
    _templateConfig: {},
    _version: 0
}));
addFieldToLibrary('f_ver', { type: 'string' });
addTemplateRefToField('f_ver', 'dt_main');
addTemplateRefToField('f_ver', 'dt_hist');
eq(getFieldFromLibrary('f_ver').usedByTemplates.length, 2, 'both version refs registered');

eq(deleteTemplateVersion('refchar', 'dt_hist'), true, 'non-active version deletable');
var verAfter = getFieldFromLibrary('f_ver');
eq(verAfter.usedByTemplates.length, 1, 'deleted version ref cleared');
eq(verAfter.usedByTemplates[0], 'dt_main', 'main version ref kept');
eq(removeFieldFromLibrary('f_ver'), false, 'field protected while main copy exists');

eq(deleteTemplateVersion('refchar', 'dt_main'), false, 'active main copy not deletable');
eq(deleteTemplateVersion('refchar', 'no_such_key'), false, 'nonexistent version key returns false');
localStorage.removeItem('ne_card_templates_refchar');
eq(removeFieldFromLibrary('f_ver'), true, 'field deletable after card copy removed');

// Cleanup
resetLibraries();

console.log('\n=== store-field-ref: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
