// Node.js localStorage polyfill (not available in Node)
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
    loadTemplateLibrary, saveTemplateLibrary, saveTemplate, deleteTemplate, getTemplate, getEffectiveTemplates,
    loadFieldLibrary, saveFieldLibrary, addFieldToLibrary, removeFieldFromLibrary, getFieldFromLibrary,
    addTemplateRefToField, removeTemplateRefFromField,
    registerFieldToTemplate, unregisterFieldFromTemplate,
    migrateTemplateFormat,
    getLocalCustomFields, addLocalCustomField, removeLocalCustomField,
    getLockedTemplateCharacters
} from '../src/core/vault/store.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function neq(a, b, msg) { assert(a !== b, msg + ' (should not be ' + JSON.stringify(b) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

// Cleanup before tests
localStorage.removeItem('ne_template_library');
localStorage.removeItem('ne_field_library');
localStorage.removeItem('ne_local_fields_testchar');

// ====== Template Library CRUD ======
console.log('\n=== store: template library CRUD ===');

// Initial load returns default empty
var lib1 = loadTemplateLibrary();
ok(lib1.templates, 'loadTemplateLibrary returns templates map');
eq(typeof lib1.templates, 'object', 'templates is object');
ok(lib1.updatedAt, 'has updatedAt');

// Save a template
var t1 = {
    id: 'tmpl_test_001',
    name: 'Test Scheme',
    role: 'npc',
    source: 'user_created',
    presetFields: ['status', 'personality'],
    customFieldRefs: []
};
eq(saveTemplate(t1), true, 'saveTemplate returns true');
ok(t1.createdAt, 'createdAt auto-set');
ok(t1.updatedAt, 'updatedAt auto-set');

// Get it back
var got = getTemplate('tmpl_test_001');
eq(got.name, 'Test Scheme', 'getTemplate returns correct name');
eq(got.role, 'npc', 'role preserved');
eq(got.presetFields.length, 2, 'presetFields count preserved');

// Re-load confirms persistence
var lib2 = loadTemplateLibrary();
eq(Object.keys(lib2.templates).length, 1, '1 template in library');
ok(lib2.templates['tmpl_test_001'], 'template persists across loads');

// Delete template
eq(deleteTemplate('tmpl_test_001'), true, 'deleteTemplate returns true');
var deleted = getTemplate('tmpl_test_001');
eq(deleted, null, 'deleted template returns null');

eq(deleteTemplate('nonexistent'), false, 'delete nonexistent returns false');

// Add and get multiple
saveTemplate({ id: 'a', name: 'A', role: 'npc' });
saveTemplate({ id: 'b', name: 'B', role: 'npc' });
eq(Object.keys(loadTemplateLibrary().templates).length, 2, '2 templates');
deleteTemplate('a');
deleteTemplate('b');

// Verify default templates are accessible via getEffectiveTemplates
var eff = getEffectiveTemplates();
ok(eff.templates['_default_pc'], 'default PC accessible via getEffectiveTemplates');
ok(eff.templates['_default_npc'], 'default NPC accessible via getEffectiveTemplates');
eq(eff.templates['_default_npc'].system, true, 'system flag on default NPC');

// ====== Field Library CRUD ======
console.log('\n=== store: field library CRUD ===');

var fl1 = loadFieldLibrary();
ok(fl1.fields, 'loadFieldLibrary returns fields map');
ok(fl1.updatedAt, 'has updatedAt');

// Add a field
addFieldToLibrary('custom_test', { type: 'boolean', description: 'Test field', layer: 'dynamic' });
var fld = getFieldFromLibrary('custom_test');
eq(fld.type, 'boolean', 'field type preserved');
eq(fld.description, 'Test field', 'description preserved');
eq(fld.layer, 'dynamic', 'layer preserved');
ok(Array.isArray(fld.usedByTemplates), 'usedByTemplates is array');
eq(fld.usedByTemplates.length, 0, 'starts empty');

// Remove field
eq(removeFieldFromLibrary('nonexistent'), false, 'remove nonexistent returns false');
eq(removeFieldFromLibrary('custom_test'), true, 'remove existing returns true');
eq(getFieldFromLibrary('custom_test'), null, 'removed field returns null');

// Remove with usedByTemplates protection
addFieldToLibrary('protected_field', { type: 'string', usedByTemplates: ['tmpl_1'] });
eq(removeFieldFromLibrary('protected_field'), false, 'cannot remove field used by templates');
eq(removeFieldFromLibrary('protected_field'), false, 'still cannot remove');

// ====== Template-Field reference operations ======
console.log('\n=== store: template-field references ===');

addFieldToLibrary('ref_field', { type: 'number', usedByTemplates: [] });

// Add ref
addTemplateRefToField('ref_field', 'tmpl_ref_1');
var refCheck1 = getFieldFromLibrary('ref_field');
eq(refCheck1.usedByTemplates.length, 1, 'template ref added');
eq(refCheck1.usedByTemplates[0], 'tmpl_ref_1', 'ref id correct');

// Add duplicate (should be idempotent)
addTemplateRefToField('ref_field', 'tmpl_ref_1');
var refCheck1b = getFieldFromLibrary('ref_field');
eq(refCheck1b.usedByTemplates.length, 1, 'duplicate ref not added');

// Add second ref
addTemplateRefToField('ref_field', 'tmpl_ref_2');
var refCheck2 = getFieldFromLibrary('ref_field');
eq(refCheck2.usedByTemplates.length, 2, 'two refs');

// Remove ref
removeTemplateRefFromField('ref_field', 'tmpl_ref_1');
var refCheck3 = getFieldFromLibrary('ref_field');
eq(refCheck3.usedByTemplates.length, 1, 'ref removed');
eq(refCheck3.usedByTemplates[0], 'tmpl_ref_2', 'correct ref remains');

removeFieldFromLibrary('ref_field');

// ====== Template → Field registration (#10) ======
console.log('\n=== store: registerFieldToTemplate ===');

saveTemplate({ id: 'tmpl_reg_test', name: 'Reg Test', role: 'npc', presetFields: [], customFieldRefs: [] });
registerFieldToTemplate('tmpl_reg_test', 'status');
var regTpl = getTemplate('tmpl_reg_test');
eq(regTpl.customFieldRefs.length, 1, 'field registered to template');
eq(regTpl.customFieldRefs[0], 'status', 'correct field name');

// Duplicate
registerFieldToTemplate('tmpl_reg_test', 'status');
eq(regTpl.customFieldRefs.length, 1, 'duplicate not added');

// Unregister
unregisterFieldFromTemplate('tmpl_reg_test', 'status');
regTpl = getTemplate('tmpl_reg_test');
eq(regTpl.customFieldRefs.length, 0, 'field unregistered');

deleteTemplate('tmpl_reg_test');

// ====== migrateTemplateFormat ======
console.log('\n=== store: migrateTemplateFormat ===');

var oldFormat = { id: 'old_tmpl', name: 'Old', customFields: ['status', 'affection'] };
migrateTemplateFormat(oldFormat);
eq(Object.keys(oldFormat).indexOf('customFields'), -1, 'customFields removed');
ok(oldFormat.customFieldRefs, 'customFieldRefs added');
eq(oldFormat.customFieldRefs.length, 2, '2 fields migrated');
eq(oldFormat.customFieldRefs[0], 'status', 'first field correct');

// Already migrated (idempotent)
migrateTemplateFormat(oldFormat);
eq(oldFormat.customFieldRefs.length, 2, 're-migration is idempotent');

// Null input
migrateTemplateFormat(null);
ok(true, 'null does not crash');

// Missing customFields
var newFormat = { id: 'new_tmpl', customFieldRefs: ['a'] };
migrateTemplateFormat(newFormat);
eq(Object.keys(newFormat).indexOf('customFields'), -1, 'no customFields on new format');

// ====== Local Custom Fields ======
console.log('\n=== store: local custom fields ===');

// Initially empty
var lc1 = getLocalCustomFields('testchar');
eq(typeof lc1, 'object', 'getLocalCustomFields returns object');
eq(Object.keys(lc1).length, 0, 'starts empty');

// Add
addLocalCustomField('testchar', 'mood', { type: 'string', description: 'current mood', source: 'ai_generated' });
var lc2 = getLocalCustomFields('testchar');
eq(Object.keys(lc2).length, 1, '1 local field');
eq(lc2['mood'].type, 'string', 'type preserved');
eq(lc2['mood'].source, 'ai_generated', 'source preserved');

// Add second
addLocalCustomField('testchar', 'hunger', { type: 'number', description: 'hunger level', source: 'ai_generated' });
var lc3 = getLocalCustomFields('testchar');
eq(Object.keys(lc3).length, 2, '2 local fields');

// Remove
removeLocalCustomField('testchar', 'mood');
var lc4 = getLocalCustomFields('testchar');
eq(Object.keys(lc4).length, 1, '1 field after remove');
eq(lc4['hunger'].type, 'number', 'remaining field correct');

// Cleanup
localStorage.removeItem('ne_local_fields_testchar');

// ====== Dual consistency (localStorage survival) ======
console.log('\n=== store: dual consistency ===');

localStorage.removeItem('ne_template_library');
localStorage.removeItem('ne_field_library');

saveTemplate({ id: 'dual_tmpl', name: 'Dual Test' });

// Read back raw from localStorage
var rawSl = localStorage.getItem('ne_template_library');
ok(rawSl, 'template library written to localStorage');
var parsed = JSON.parse(rawSl);
ok(parsed.templates['dual_tmpl'], 'template found in raw localStorage');
eq(parsed.templates['dual_tmpl'].name, 'Dual Test', 'name correct in raw ls');

addFieldToLibrary('dual_field', { type: 'boolean' });
var rawFl = localStorage.getItem('ne_field_library');
ok(rawFl, 'field library written to localStorage');
var parsedFl = JSON.parse(rawFl);
ok(parsedFl.fields['dual_field'], 'field found in raw localStorage');
eq(parsedFl.fields['dual_field'].type, 'boolean', 'type correct in raw ls');

deleteTemplate('dual_tmpl');
removeFieldFromLibrary('dual_field');

// ====== N5: getLockedTemplateCharacters with dialogue template keys ======
console.log('\n=== store: getLockedTemplateCharacters ===');

var testCardCfg = {
    _dialogueTemplates: {
        'dt_locked_1': { _active: true, _templateId: 'tpl_locked', _locked: true, presetFields: [], customFieldRefs: [] },
        'dt_unlocked': { _active: true, _templateId: 'tpl_free', _locked: false, presetFields: [], customFieldRefs: [] },
        'dt_locked_2': { _active: true, _templateId: 'tpl_locked', _locked: true, presetFields: [], customFieldRefs: [] }
    },
    _templateConfig: {},
    _version: 0
};

// Two characters using locked template, one using unlocked, one using no template
var testState = {
    characters: {
        'Ally': { _scheme: 'dt_locked_1', status: '活跃' },
        'Vendor': { _scheme: 'dt_unlocked', status: '活跃' },
        'Enemy': { _scheme: 'dt_locked_2', status: '活跃' },
        'Stranger': { status: '活跃' }  // no _scheme at all
    }
};

var locked = getLockedTemplateCharacters(testCardCfg, testState);
eq(locked.length, 2, 'two characters use locked templates');
assert(locked.indexOf('Ally') !== -1, 'Ally uses locked template');
assert(locked.indexOf('Enemy') !== -1, 'Enemy uses locked template');
assert(locked.indexOf('Vendor') === -1, 'Vendor not locked');
assert(locked.indexOf('Stranger') === -1, 'Stranger not locked (no _scheme)');

// No state → empty
var lockedNullState = getLockedTemplateCharacters(testCardCfg, null);
eq(lockedNullState.length, 0, 'null state returns empty array');

// No cardConfig → empty
var lockedNullCfg = getLockedTemplateCharacters(null, testState);
eq(lockedNullCfg.length, 0, 'null cardConfig returns empty array');

// No locked templates → empty
var testCardCfg2 = {
    _dialogueTemplates: {
        'dt_free_1': { _active: true, _templateId: 'tpl_a', _locked: false, presetFields: [], customFieldRefs: [] }
    },
    _templateConfig: {},
    _version: 0
};
var noLocked = getLockedTemplateCharacters(testCardCfg2, testState);
eq(noLocked.length, 0, 'no locked templates returns empty');

// Cleanup
localStorage.removeItem('ne_template_library');
localStorage.removeItem('ne_field_library');

console.log('\n=== store: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
