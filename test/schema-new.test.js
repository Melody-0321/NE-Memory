import {
    normalizeScheme, expandTemplateFields, resolveFieldDef,
    registerFieldToScheme,
    ALL_PREDEFINED_FIELDS, SYSTEM_REQUIRED_FIELDS, PRESET_FIELDS,
    DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE,
    DEFAULT_FACTION_SCHEMA, DEFAULT_QUESTS_SCHEMA,
    buildCharacterSchemaFromTemplates
} from '../src/core/vault/schema.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function neq(a, b, msg) { assert(a !== b, msg + ' (should not be ' + JSON.stringify(b) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

// ====== normalizeScheme ======
console.log('\n=== schema-new: normalizeScheme ===');

var oldScheme = { description: 'test', required: ['personality', 'gender_age'], optional: ['injuries'] };
var norm = normalizeScheme(oldScheme);
ok(norm, 'normalizeScheme returns fields map for old format');
eq(typeof norm, 'object', 'result is object (fields map)');
ok(norm['personality'].type, 'personality has type');
eq(Object.keys(norm).length, 3, '3 fields converted');

var alreadyNew = { fields: { a: { type: 'string' } } };
var reNorm = normalizeScheme(alreadyNew);
eq(reNorm, alreadyNew.fields, 'already-normalized returns .fields directly');

var nullScheme = normalizeScheme(null);
eq(nullScheme, null, 'null returns null');

var empty = normalizeScheme({});
eq(empty, null, 'empty required/optional -> null');

var onlyRequired = normalizeScheme({ required: ['status'] });
eq(Object.keys(onlyRequired).length, 1, 'only required -> 1 field');

var unknownField = normalizeScheme({ required: ['nonexistent_xyz'] });
eq(unknownField, null, 'unknown field only -> null');

// ====== expandTemplateFields ======
console.log('\n=== schema-new: expandTemplateFields ===');

var tpl = { presetFields: ['personality', 'gender_age'], customFieldRefs: ['custom_mood'] };
var expanded = expandTemplateFields(tpl);
ok(expanded, 'expandTemplateFields returns object');
assert(Object.keys(expanded).length >= 3, 'at least 3 fields: name + status + personality + gender_age');
ok(expanded['personality'].type, 'preset field has type');
ok(expanded['gender_age'].type, 'gender_age has type');
ok(expanded['name'], 'name field always present (system required)');

var emptyTpl = expandTemplateFields({});
assert(Object.keys(emptyTpl).length >= 2, 'empty template -> name + status always added');
ok(emptyTpl['name'], 'name always present');
ok(emptyTpl['status'], 'status always present');

var onlyPreset = expandTemplateFields({ presetFields: ['physique'] });
assert(Object.keys(onlyPreset).length >= 3, 'at least 3 fields (name + status + physique)');
ok(onlyPreset['physique'].type, 'physique has type');

var unknownPreset = expandTemplateFields({ presetFields: ['nonexistent_xyz'] });
assert(Object.keys(unknownPreset).length >= 2, 'unknown preset -> still gets name + status');

var mixed = expandTemplateFields({ presetFields: ['personality', 'nonexistent_xyz'] });
assert(Object.keys(mixed).length >= 3, 'valid presets + name + status always added');
ok(mixed['personality'].type, 'personality resolved');

// Custom field from field library (tested after field added in store.test.js)
// The field library is tested separately in store.test.js

// ====== resolveFieldDef ======
console.log('\n=== schema-new: resolveFieldDef ===');

var resolved = resolveFieldDef('personality');
ok(resolved.def, 'personality resolved');
ok(resolved.def.type, 'personality has type');
eq(resolved.source, 'preset', 'source is preset');

var unresolved = resolveFieldDef('nonexistent_xyz_999');
eq(unresolved.def, null, 'unknown field -> null');

var emptyStr = resolveFieldDef('');
eq(emptyStr.def, null, 'empty string -> null');

var nullRes = resolveFieldDef(null);
eq(nullRes.def, null, 'null -> null');

// Test that ALL predefined keys resolve
Object.keys(ALL_PREDEFINED_FIELDS).forEach(function(fk) {
    var r = resolveFieldDef(fk);
    ok(r.def, fk + ' resolves');
    ok(r.def.type, fk + ' has type');
});

// ====== registerFieldToScheme ======
console.log('\n=== schema-new: registerFieldToScheme ===');

var scheme = { fields: {} };
registerFieldToScheme(scheme, 'test_field', { type: 'boolean' }, 'ai_generated');
eq(scheme.fields['test_field'].type, 'boolean', 'field registered');
eq(scheme.fields['test_field']._source, 'ai_generated', 'source ai_generated');

registerFieldToScheme(scheme, 'test_field_2', { type: 'enum', values: ['a', 'b'] }, 'user_created');
eq(scheme.fields['test_field_2'].type, 'enum', 'field type preserved');
eq(scheme.fields['test_field_2']._source, 'user_created', 'source user_created');

// Overwrite test
registerFieldToScheme(scheme, 'test_field', { type: 'number', layer: 'static' }, 'normalized');
eq(scheme.fields['test_field'].type, 'number', 'overwritten type');
eq(scheme.fields['test_field'].layer, 'static', 'overwritten layer');

// ====== Constants integrity ======
console.log('\n=== schema-new: Constants integrity ===');

ok(ALL_PREDEFINED_FIELDS, 'ALL_PREDEFINED_FIELDS exists');
ok(SYSTEM_REQUIRED_FIELDS, 'SYSTEM_REQUIRED_FIELDS exists');
ok(PRESET_FIELDS, 'PRESET_FIELDS exists');
ok(DEFAULT_PC_TEMPLATE, 'DEFAULT_PC_TEMPLATE exists');
ok(DEFAULT_NPC_TEMPLATE, 'DEFAULT_NPC_TEMPLATE exists');

// DEFAULT_PC_TEMPLATE structure
eq(DEFAULT_PC_TEMPLATE.role, 'pc', 'PC template role');
ok(DEFAULT_PC_TEMPLATE.presetFields, 'PC template has presetFields');
assert(DEFAULT_PC_TEMPLATE.presetFields.indexOf('gender_age') !== -1, 'PC presetFields includes gender_age');
assert(DEFAULT_PC_TEMPLATE.presetFields.indexOf('personality') !== -1, 'PC presetFields includes personality');
ok(DEFAULT_PC_TEMPLATE.system === true, 'PC template is system template');

// DEFAULT_NPC_TEMPLATE structure
eq(DEFAULT_NPC_TEMPLATE.role, 'npc', 'NPC template role');
ok(DEFAULT_NPC_TEMPLATE.presetFields, 'NPC template has presetFields');
ok(DEFAULT_NPC_TEMPLATE.system === true, 'NPC template is system template');

// ALL_PREDEFINED_FIELDS: all fields have type and layer
Object.keys(ALL_PREDEFINED_FIELDS).forEach(function(fk) {
    var def = ALL_PREDEFINED_FIELDS[fk];
    ok(def.type, fk + ' has type');
    ok(typeof def.type === 'string', fk + ' type is string');
    ok(def.layer === 'static' || def.layer === 'dynamic' || def.layer === undefined, fk + ' layer is valid');
});

// FIELD_COUNT exists and is >= 20
var fieldCount = Object.keys(ALL_PREDEFINED_FIELDS).length;
assert(fieldCount >= 15, 'ALL_PREDEFINED_FIELDS count >= 15 (got ' + fieldCount + ')');

// ALL_PREDEFINED_FIELDS subset: name MUST exist (system reserved)
ok(ALL_PREDEFINED_FIELDS['name'], 'name field exists in ALL_PREDEFINED_FIELDS');
eq(ALL_PREDEFINED_FIELDS['name']._system, true, 'name is _system=true');

// DEFAULT_NPC_TEMPLATE format
ok(DEFAULT_NPC_TEMPLATE.presetFields, 'DEFAULT_NPC_TEMPLATE has presetFields');
ok(DEFAULT_NPC_TEMPLATE.presetFields.length >= 5, 'presetFields has multiple entries');

// buildCharacterSchemaFromTemplates structure
var builtSchema = buildCharacterSchemaFromTemplates(DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE);
ok(builtSchema.protagonist, 'has protagonist schema');
ok(builtSchema.npc, 'has npc schema');
ok(builtSchema.protagonist.fields, 'protagonist has fields');
ok(builtSchema.npc.fields, 'npc has fields');
assert(Object.keys(builtSchema.protagonist.fields).length >= 5, 'protagonist has at least 5 fields');
// NPC template no longer includes affection
assert(!builtSchema.npc.fields['affection'], 'npc schema should not have affection');

// No circular template reference
assert(DEFAULT_PC_TEMPLATE.presetFields.indexOf('name') === -1, 'PC template does not include name');
assert(DEFAULT_NPC_TEMPLATE.presetFields.indexOf('name') === -1, 'NPC template does not include name');

// ====== DEFAULT_FACTION_SCHEMA ======
ok(DEFAULT_FACTION_SCHEMA.type === 'object', 'faction schema has type');
ok(DEFAULT_FACTION_SCHEMA.schema, 'faction schema has schema');
ok(DEFAULT_FACTION_SCHEMA.schema.fields, 'faction schema has fields');

// ====== DEFAULT_QUESTS_SCHEMA ======
ok(DEFAULT_QUESTS_SCHEMA.tasks, 'quests schema has tasks');
ok(DEFAULT_QUESTS_SCHEMA.tasks.type === 'object', 'quests tasks is object type');

console.log('\n=== schema-new: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
