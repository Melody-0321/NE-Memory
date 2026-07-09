import {
    validateField, resolveSchemaPath, validateStateChanges, mergeStateChanges,
    rebuildPresentCharacters, ensureCharacterTemplate, getEffectiveSchema,
    getNpcInjectionFields, getCharacterInjectionFields, buildStateInjectionTable,
    DEFAULT_CHARACTER_SCHEMA, DEFAULT_NPC_SCHEME, DEFAULT_GLOBAL_SCHEMA
} from '../src/core/vault/schema.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function neq(a, b, msg) { assert(a !== b, msg + ' (should not be ' + JSON.stringify(b) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

console.log('\n=== schema: validateField ===');

eq(validateField('hello', null).ok, true, 'null schema => ok');
eq(validateField(undefined, null).ok, true, 'null schema + undefined => ok');

eq(validateField('hello', { type: 'string' }).ok, true, 'string field passes');
eq(validateField('hello', { type: 'string' }).value, 'hello', 'string field returns value');
eq(validateField(123, { type: 'string' }).value, '123', 'number coerced to string');
eq(validateField(null, { type: 'string' }).value, '', 'null coerced to empty string');
eq(validateField(undefined, { type: 'string' }).value, '', 'undefined coerced to empty string');
eq(validateField('abcdefghij', { type: 'string', max_length: 3 }).value, 'abc', 'string truncated to max_length');

eq(validateField(42, { type: 'number' }).ok, true, 'number field passes');
eq(validateField(42, { type: 'number' }).value, 42, 'number field returns value');
eq(validateField('+5', { type: 'number' }).value.delta, 5, '+5 => delta 5');
eq(validateField('-3', { type: 'number' }).value.delta, -3, '-3 => delta -3');
eq(validateField('not-a-number', { type: 'number' }).ok, false, 'NaN string => fail');

eq(validateField(5, { type: 'number', min: 0, max: 10 }).ok, true, 'number in range');
eq(validateField(-1, { type: 'number', min: 0 }).ok, false, 'number below min');
eq(validateField(101, { type: 'number', max: 100 }).ok, false, 'number above max');

eq(validateField(true, { type: 'boolean' }).ok, true, 'boolean passes');
eq(validateField('true', { type: 'boolean' }).ok, false, 'string for boolean fails');

eq(validateField('活跃', { type: 'enum', values: ['活跃', '非活跃', '已死亡'] }).ok, true, 'valid enum passes');
eq(validateField('不在列表中', { type: 'enum', values: ['活跃', '非活跃'] }).ok, false, 'invalid enum fails');
eq(validateField('活跃', { type: 'enum', values: null }).ok, false, 'enum without values array fails');

console.log('\n=== schema: resolveSchemaPath ===');

eq(resolveSchemaPath(null, 'anything'), null, 'null schema => null');
var resolved = resolveSchemaPath({ type: 'object', fields: { name: { type: 'string' } } }, 'name');
assert(resolved && resolved.type === 'string', 'simple path resolves');
eq(resolveSchemaPath({ type: 'object', fields: { name: { type: 'string' } } }, 'unknown'), null, 'unknown path => null');

var nestedSchema = {
    type: 'object',
    fields: {
        characters: {
            type: 'object',
            schema: {
                type: 'object',
                fields: {
                    '*': { type: 'object', fields: { name: { type: 'string' }, status: { type: 'string' } } }
                }
            }
        }
    }
};
eq(resolveSchemaPath(nestedSchema, 'characters.ZhangSan.name').type, 'string', 'wildcard path resolves');
eq(resolveSchemaPath(nestedSchema, 'characters.ZhangSan.status').type, 'string', 'second wildcard field resolves');
eq(resolveSchemaPath(nestedSchema, 'characters.ZhangSan.missing'), null, 'missing field under wildcard => null');

var schemaWithSchema = {
    type: 'object',
    fields: {
        quests: {
            type: 'object',
            schema: {
                type: 'object',
                fields: { '*': { type: 'object', fields: { name: { type: 'string' } } } }
            }
        }
    }
};
eq(resolveSchemaPath(schemaWithSchema, 'quests.MainQuest.name').type, 'string', 'schema-level fields resolution');

var schemaWithDirectFields = {
    fields: { name: { type: 'string' } }
};
eq(resolveSchemaPath(schemaWithDirectFields, 'name').type, 'string', 'fields without type=object resolves');

console.log('\n=== schema: validateStateChanges ===');

var vsResult = validateStateChanges(DEFAULT_GLOBAL_SCHEMA, { 'main_event': 'new event' });
eq(vsResult.validated['main_event'], 'new event', 'known field validated');
eq(vsResult.warnings.length, 0, 'no warnings for known field');

var vsResult2 = validateStateChanges(DEFAULT_GLOBAL_SCHEMA, { 'unknown_field': 'value' });
eq(vsResult2.validated['unknown_field'], 'value', 'unknown field passed through');
assert(vsResult2.warnings.length > 0, 'warning for unknown field');

var vsResult3 = validateStateChanges(DEFAULT_GLOBAL_SCHEMA, { 'main_event': 'a'.repeat(200) });
eq(vsResult3.validated['main_event'].length, 120, 'string truncated to max_length');

var vsResult4 = validateStateChanges(DEFAULT_GLOBAL_SCHEMA, {
    'characters.ZhangSan.status': '不在列表中'
});
assert(vsResult4.warnings.length > 0, 'warning for invalid enum value');

var vsResult5 = validateStateChanges(DEFAULT_GLOBAL_SCHEMA, {
    'characters.ZhangSan.newField': 'some value'
});
eq(vsResult5.validated['characters.ZhangSan.newField'], 'some value', 'unknown sub-field under known parent passes through');

console.log('\n=== schema: rebuildPresentCharacters ===');

eq(rebuildPresentCharacters(null), null, 'null state => null');
eq(rebuildPresentCharacters({}).present_characters, undefined, 'empty state => undefined present_characters');

var stateWithChars = {
    characters: {
        'ZhangSan': { name: 'ZhangSan', status: '活跃' },
        'LiSi': { name: 'LiSi', status: '非活跃' },
        'WangWu': { name: 'WangWu', status: '已死亡' }
    }
};
var rebuilt = rebuildPresentCharacters(stateWithChars);
eq(rebuilt.present_characters, 'ZhangSan', 'only active characters in present_characters');

var stateAllActive = {
    characters: {
        'A': { name: 'A', status: '活跃' },
        'B': { name: 'B', status: '活跃' }
    }
};
var rebuilt2 = rebuildPresentCharacters(stateAllActive);
assert(rebuilt2.present_characters.indexOf('A, B') !== -1 || rebuilt2.present_characters === 'A, B', 'multiple active characters joined');

console.log('\n=== schema: getEffectiveSchema ===');

eq(getEffectiveSchema({ content: {} }), DEFAULT_GLOBAL_SCHEMA, 'no schema => default');
eq(getEffectiveSchema({ content: { state_schema: null } }), DEFAULT_GLOBAL_SCHEMA, 'null schema => default');

var customSchema = { type: 'object', fields: { custom: { type: 'string' } } };
eq(getEffectiveSchema({ content: { state_schema: customSchema } }), customSchema, 'custom schema returned');

console.log('\n=== schema: ensureCharacterTemplate ===');

var state1 = {};
ensureCharacterTemplate(state1, 'NewNPC');
ok(state1.characters, 'characters obj created');
ok(state1.characters['NewNPC'], 'character entry created');
eq(state1.characters['NewNPC'].name, 'NewNPC', 'name set');
eq(typeof state1.characters['NewNPC'].status, 'string', 'status is string (enum default)');
eq(state1.characters['NewNPC'].affection, null, 'affection (number type) default null');

var existingState = { characters: { 'Existing': { name: 'Existing', status: '活跃', affection: 50 } } };
ensureCharacterTemplate(existingState, 'Existing');
eq(existingState.characters['Existing'].affection, 50, 'existing character preserved');

var pcState = { protagonist_name: 'Hero' };
ensureCharacterTemplate(pcState, 'Hero');
eq(pcState.characters['Hero'].status, '', 'PC template uses string defaults from protagonist schema');

console.log('\n=== schema: mergeStateChanges (return {state, changes}) ===');

var baseState = { main_event: '', characters: {} };
var merged = mergeStateChanges(baseState, { 'main_event': 'big event' });
eq(merged.state.main_event, 'big event', 'simple merge - state');
assert(merged.state !== baseState, 'merge returns new state object');
ok(Array.isArray(merged.changes), 'changes is an array');
eq(merged.changes.length, 1, 'one change captured');
eq(merged.changes[0].path, 'main_event', 'change path');
eq(merged.changes[0].old, '', 'change old value');
eq(merged.changes[0].new, 'big event', 'change new value');

var merged2 = mergeStateChanges(baseState, {
    'characters.ZhangSan': { status: '活跃', name: 'ZhangSan' }
});
ok(merged2.state.characters && merged2.state.characters['ZhangSan'], 'character created via merge');
eq(merged2.state.characters['ZhangSan'].status, '活跃', 'character status set');
eq(merged2.state.characters['ZhangSan'].name, 'ZhangSan', 'character name set');
eq(merged2.state.present_characters, 'ZhangSan', 'present_characters auto-rebuilt');
ok(merged2.changes.length >= 1, 'at least 1 change (status, name same as template default skipped)');

var merged3 = mergeStateChanges(baseState, {
    'characters.ZhangSan._scheme': 'custom_scheme'
});
ok(merged3.state.characters && merged3.state.characters['ZhangSan'], 'character entry created for _scheme');

var merged4 = mergeStateChanges(baseState, {
    'characters.ZhangSan.affection': { __inc: true, delta: 10 }
});
eq(merged4.state.characters['ZhangSan'].affection, 10, 'affection increment from 0');
eq(merged4.changes[0].old, 0, 'affection captured old=0');
eq(merged4.changes[0].new, 10, 'affection captured new=10');

var stateWithAffection = { characters: { 'LiSi': { name: 'LiSi', affection: 80 } } };
var merged5 = mergeStateChanges(stateWithAffection, {
    'characters.LiSi.affection': { __inc: true, delta: 25 }
});
eq(merged5.state.characters['LiSi'].affection, 100, 'affection clamped at 100');
eq(merged5.changes[0].old, 80, 'affection increment old=80');
eq(merged5.changes[0].new, 100, 'affection increment new=100');

var merged6 = mergeStateChanges(stateWithAffection, {
    'characters.LiSi.affection': { __inc: true, delta: -10 }
});
eq(merged6.state.characters['LiSi'].affection, 70, 'affection decrement');

var merged7 = mergeStateChanges({ characters: { 'Hero': { _role: 'protagonist' } }, protagonist_name: 'Hero' }, {
    'characters.Hero._role': 'npc'
});
eq(merged7.state.characters['Hero']._role, 'protagonist', 'protagonist _role protected');
eq(merged7.changes.length, 0, 'protected _role → no change captured');

var merged8 = mergeStateChanges({}, {
    'quests.MainQuest.name': 'MainQuest', 'quests.MainQuest.status': '正在进行'
});
ok(merged8.state.quests && merged8.state.quests.tasks && merged8.state.quests.tasks['MainQuest'], 'legacy quest path remapped to tasks');
eq(merged8.state.quests.tasks['MainQuest'].name, 'MainQuest', 'quest name set in tasks');
eq(merged8.state.quests.tasks['MainQuest'].status, '正在进行', 'quest status set in tasks');

console.log('\n=== schema: mergeStateChanges 旁路捕获 ===');

var s1 = { characters: { 'Hero': { name: 'Hero', current_mood: '平静' } } };
var r1 = mergeStateChanges(s1, { 'characters.Hero.current_mood': '愤怒' });
eq(r1.changes.length, 1, 'single field change → 1 capture');
eq(r1.changes[0].path, 'characters.Hero.current_mood', 'capture path uses dot notation');
eq(r1.changes[0].old, '平静', 'capture old value');
eq(r1.changes[0].new, '愤怒', 'capture new value');

var rUnchanged = mergeStateChanges(s1, { 'characters.Hero.current_mood': '平静' });
eq(rUnchanged.changes.length, 0, 'no actual change → empty changes array');

var rEmpty = mergeStateChanges({}, {});
eq(rEmpty.changes.length, 0, 'empty input → empty changes');
eq(typeof rEmpty.state, 'object', 'empty input still returns state object');

console.log('\n=== schema: getNpcInjectionFields ===');

var npcState = {
    npc_schemes: {
        minimal: { description: 'minimal', required: ['name', 'status'], optional: [] },
        default: { description: 'default', required: ['name', 'status', 'affection', 'relationship'], optional: ['personality'] }
    },
    characters: {
        'Ally': { _scheme: 'minimal' },
        'NoScheme': {}
    }
};
var fields1 = getNpcInjectionFields(npcState, 'Ally');
assert(fields1.indexOf('name') !== -1, 'minimal includes name');
assert(fields1.indexOf('status') !== -1, 'minimal includes status');
assert(fields1.indexOf('affection') === -1, 'minimal excludes affection');

var fields2 = getNpcInjectionFields(npcState, 'NoScheme');
assert(fields2.indexOf('affection') !== -1, 'no scheme => default includes affection');
assert(fields2.indexOf('relationship') !== -1, 'default includes relationship');

var fieldsDefault = getNpcInjectionFields({}, 'Anyone');
assert(fieldsDefault.length > 0, 'empty state still returns default fields');

console.log('\n=== schema: buildStateInjectionTable ===');

var simpleState = {
    main_event: 'The hero arrives at the city gate',
    protagonist_name: 'Hero',
    characters: {
        'Hero': { name: 'Hero', gender_age: '25岁男', physique: '健壮', occupation: '冒险者', personality: '勇敢', clothing_build: '皮甲', status: '活跃', injuries: '', status_effects: '' },
        'Merchant': { name: 'Merchant', status: '活跃', affection: 30, relationship: '商人' }
    }
};
var table = buildStateInjectionTable(simpleState, [], {}, {});
ok(table.indexOf('=== Current State ===') !== -1, 'table has header');
ok(table.indexOf('Hero') !== -1, 'table includes PC name');
ok(table.indexOf('冒险者') !== -1, 'table includes PC occupation');
ok(table.indexOf('Merchant') !== -1, 'table includes NPC name');

var nullState = null;
var nullTable = buildStateInjectionTable(nullState, [], {}, {});
eq(nullTable, '', 'null state => empty string');

var stateWithFactions = {
    main_event: '',
    protagonist_name: 'Hero',
    characters: { 'Hero': { name: 'Hero', status: '活跃', occupation: '' } },
    factions: { 'Brotherhood': { name: 'Brotherhood', leader: 'BigBro', attitude_toward_player: '友好', notes: 'underground', _hidden: false } }
};
var factionTable = buildStateInjectionTable(stateWithFactions, [], {}, {});
ok(factionTable.indexOf('Brotherhood') !== -1, 'table includes faction name');
ok(factionTable.indexOf('BigBro') !== -1, 'table includes faction leader');

var stateWithHiddenFaction = {
    main_event: '',
    protagonist_name: 'Hero',
    characters: { 'Hero': { name: 'Hero', status: '活跃', occupation: '' } },
    factions: { 'Secret': { name: 'Secret', _hidden: true } }
};
var hiddenTable = buildStateInjectionTable(stateWithHiddenFaction, [], {}, {});
assert(hiddenTable.indexOf('Secret') === -1 || hiddenTable.indexOf('(empty') !== -1, 'hidden faction not displayed');

var stateWithQuests = {
    main_event: '',
    protagonist_name: 'Hero',
    characters: { 'Hero': { name: 'Hero', status: '活跃', occupation: '' } },
    quests: {
        tasks: { 'MT': { name: 'MainQuest', status: '正在进行', progress: '找到线索' } },
        goals: {},
        events: {}
    }
};
var questTable = buildStateInjectionTable(stateWithQuests, [], {}, {});
ok(questTable.indexOf('MainQuest') !== -1, 'table includes quest name');
ok(questTable.indexOf('正在进行') !== -1, 'table includes quest status');

var stateWithEmptyQuests = {
    main_event: '',
    protagonist_name: 'Hero',
    characters: { 'Hero': { name: 'Hero', status: '活跃', occupation: '' } },
    quests: { tasks: {}, goals: {}, events: {} }
};
var emptyQuestTable = buildStateInjectionTable(stateWithEmptyQuests, [], {}, {});
ok(emptyQuestTable.indexOf('(empty') !== -1, 'empty quests shows (empty) hint');

console.log('\n=== schema: getCharacterInjectionFields ===');

var testState = {
    protagonist_name: 'Hero',
    characters: { 'Hero': { _role: 'protagonist', status: '活跃', personality: 'brave' } }
};
var pcFields = getCharacterInjectionFields(testState, 'Hero');
assert(Array.isArray(pcFields), 'getCharacterInjectionFields for PC returns array');
assert(pcFields.indexOf('status') !== -1, 'PC fields includes status');
assert(pcFields.indexOf('personality') !== -1, 'PC fields includes personality');

var npcFields = getCharacterInjectionFields(testState, 'Vendor');
assert(Array.isArray(npcFields), 'getCharacterInjectionFields for NPC returns array');
assert(npcFields.indexOf('affection') !== -1 || npcFields.indexOf('name') !== -1, 'NPC fields includes NPC-specific fields');

console.log('\n=== schema: DEFAULT schemas ===');

ok(DEFAULT_GLOBAL_SCHEMA.type === 'object', 'DEFAULT_GLOBAL_SCHEMA has type');
ok(DEFAULT_GLOBAL_SCHEMA.fields, 'DEFAULT_GLOBAL_SCHEMA has fields');
ok(DEFAULT_CHARACTER_SCHEMA.protagonist, 'DEFAULT_CHARACTER_SCHEMA has protagonist');
ok(DEFAULT_CHARACTER_SCHEMA.npc, 'DEFAULT_CHARACTER_SCHEMA has npc');
eq(typeof DEFAULT_NPC_SCHEME, 'object', 'DEFAULT_NPC_SCHEME is object');
ok(DEFAULT_NPC_SCHEME._default, 'DEFAULT_NPC_SCHEME has _default scheme');

console.log('\n--- schema: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
