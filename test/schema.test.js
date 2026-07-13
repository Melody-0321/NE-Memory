import {
    validateField, resolveSchemaPath, validateStateChanges, mergeStateChanges,
    rebuildPresentCharacters, ensureCharacterTemplate,
    getNpcInjectionFields, getCharacterInjectionFields, buildStateInjectionTable,
    DEFAULT_GLOBAL_SCHEMA,
    buildCharacterSchemaFromTemplates, DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE,
    ROLE_CATEGORY_MAP, getPresetFieldsForRole
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

var vsResult = validateStateChanges(DEFAULT_GLOBAL_SCHEMA, { 'present_characters': '张三' });
eq(vsResult.validated['present_characters'], '张三', 'known field validated');
eq(vsResult.warnings.length, 0, 'no warnings for known field');

var vsResult2 = validateStateChanges(DEFAULT_GLOBAL_SCHEMA, { 'unknown_field': 'value' });
eq(vsResult2.validated['unknown_field'], 'value', 'unknown field passed through');
assert(vsResult2.warnings.length > 0, 'warning for unknown field');

var vsResult3 = validateStateChanges(DEFAULT_GLOBAL_SCHEMA, { 'present_characters': 'a'.repeat(200) });
eq(vsResult3.validated['present_characters'].length, 80, 'string truncated to max_length');

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

console.log('\n=== schema: ensureCharacterTemplate ===');

var state1 = {};
ensureCharacterTemplate(state1, 'NewNPC');
ok(state1.characters, 'characters obj created');
ok(state1.characters['NewNPC'], 'character entry created');
eq(state1.characters['NewNPC'].name, 'NewNPC', 'name set');
eq(typeof state1.characters['NewNPC'].status, 'string', 'status is string (enum default)');
eq(state1.characters['NewNPC'].affection, undefined, 'affection removed from default NPC template');

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

// N5: getNpcInjectionFields now requires stCharName and reads from cardConfig._dialogueTemplates.
// Test with empty state — should fallback to DEFAULT_NPC_TEMPLATE fields.
// create a mock cardConfig in localStorage for the tests
var _testCharName = '__test_char__';
try {
    var testCardConfig = {
        _dialogueTemplates: {},
        _templateConfig: { npc: [] },
        _version: 0
    };
    localStorage.setItem('ne_card_templates_' + _testCharName, JSON.stringify(testCardConfig));
} catch(e) {}

var npcState2 = { characters: { 'Ally': {}, 'NoScheme': {} }, protagonist_name: _testCharName };
var fields1 = getNpcInjectionFields(npcState2, 'Ally', _testCharName);
assert(fields1.length > 0, 'empty cardConfig falls back to DEFAULT_NPC_TEMPLATE');
assert(fields1.indexOf('gender_age') !== -1, 'DEFAULT fallback includes gender_age');

var fieldsDefault = getNpcInjectionFields({ protagonist_name: _testCharName }, 'Anyone', _testCharName);
assert(fieldsDefault.length > 0, 'empty state still returns default fields');

// cleanup
try { localStorage.removeItem('ne_card_templates_' + _testCharName); } catch(e) {}

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
assert(npcFields.indexOf('relationship') !== -1 || npcFields.indexOf('inner_thoughts') !== -1 || npcFields.indexOf('current_mood') !== -1, 'NPC fields includes NPC-specific fields');

console.log('\n=== schema: DEFAULT schemas ===');

ok(DEFAULT_GLOBAL_SCHEMA.type === 'object', 'DEFAULT_GLOBAL_SCHEMA has type');
ok(DEFAULT_GLOBAL_SCHEMA.fields, 'DEFAULT_GLOBAL_SCHEMA has fields');
var builtSchema = buildCharacterSchemaFromTemplates(DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE);
ok(builtSchema.protagonist, 'buildCharacterSchemaFromTemplates has protagonist');
ok(builtSchema.npc, 'buildCharacterSchemaFromTemplates has npc');
eq(typeof DEFAULT_NPC_TEMPLATE, 'object', 'DEFAULT_NPC_TEMPLATE is object');
ok(DEFAULT_NPC_TEMPLATE.presetFields, 'DEFAULT_NPC_TEMPLATE has presetFields');

// ====== N5b: ROLE_CATEGORY_MAP ======
console.log('\n=== schema: ROLE_CATEGORY_MAP ===');

eq(typeof ROLE_CATEGORY_MAP, 'object', 'ROLE_CATEGORY_MAP is object');
ok(ROLE_CATEGORY_MAP.pc, 'pc role exists');
ok(ROLE_CATEGORY_MAP.npc, 'npc role exists');
ok(ROLE_CATEGORY_MAP.faction, 'faction role exists');
ok(ROLE_CATEGORY_MAP.quest, 'quest role exists');
ok(ROLE_CATEGORY_MAP.event, 'event role exists');
assert(ROLE_CATEGORY_MAP.pc.indexOf('identity') !== -1, 'pc includes identity category');
assert(ROLE_CATEGORY_MAP.pc.indexOf('psychology') !== -1, 'pc includes psychology category');
assert(ROLE_CATEGORY_MAP.faction.indexOf('faction') !== -1, 'faction includes faction category');
assert(ROLE_CATEGORY_MAP.faction.indexOf('identity') === -1, 'faction does NOT include identity category');
assert(ROLE_CATEGORY_MAP.quest.indexOf('quest') !== -1, 'quest includes quest category');
assert(ROLE_CATEGORY_MAP.quest.indexOf('social') === -1, 'quest does NOT include social category');

// ====== N5b: getPresetFieldsForRole ======
console.log('\n=== schema: getPresetFieldsForRole ===');

var pcFields2 = getPresetFieldsForRole('pc');
ok(typeof pcFields2 === 'object', 'pc returns object');
assert(Object.keys(pcFields2).length > 5, 'pc has multiple fields');
ok(pcFields2['personality'], 'pc includes personality');
ok(pcFields2['affection'], 'pc includes affection');

var factionFields = getPresetFieldsForRole('faction');
ok(typeof factionFields === 'object', 'faction returns object');
ok(factionFields['leader'], 'faction includes leader');

var questFields = getPresetFieldsForRole('quest');
ok(typeof questFields === 'object', 'quest returns object');
ok(questFields['deadline'], 'quest includes deadline');

// Unknown role → fallback to npc
var unknownFields = getPresetFieldsForRole('unknown_role_xyz');
ok(typeof unknownFields === 'object', 'unknown role falls back to npc');
ok(unknownFields['personality'], 'unknown fallback includes personality');

// No overlap between faction and npc
var factionKeys = Object.keys(factionFields);
var npcKeys = Object.keys(getPresetFieldsForRole('npc'));
var factionOnly = factionKeys.filter(function(k) { return npcKeys.indexOf(k) === -1; });
assert(factionOnly.length > 0, 'faction has fields not in npc');

// ====== N5: getNpcInjectionFields with active dialogue template ======
console.log('\n=== schema: getNpcInjectionFields with cardConfig active templates ===');

var _stChar = '__test_proto__';
try {
    var _cardCfg = {
        _dialogueTemplates: {
            'custom_npc_dt': {
                _active: true,
                _templateId: null,
                presetFields: ['status', 'personality', 'role_in_story'],
                customFieldRefs: []
            }
        },
        _templateConfig: {},
        _version: 0
    };
    localStorage.setItem('ne_card_templates_' + _stChar, JSON.stringify(_cardCfg));
} catch(e) {}

var _activeState = {
    protagonist_name: _stChar,
    characters: { 'NPC_1': { _scheme: 'custom_npc_dt', status: '活跃' } }
};
var activeFields = getNpcInjectionFields(_activeState, 'NPC_1', _stChar);
assert(activeFields.indexOf('personality') !== -1, 'active template includes personality');
assert(activeFields.indexOf('status') !== -1, 'active template includes status');
assert(activeFields.indexOf('name') === -1, 'name filtered out from injection fields');

// No scheme → falls back to DEFAULT
var noSchemeState = {
    protagonist_name: _stChar,
    characters: { 'NPC_2': {} }
};
var noSchemeFields = getNpcInjectionFields(noSchemeState, 'NPC_2', _stChar);
assert(noSchemeFields.length > 0, 'no scheme falls back to default');
assert(noSchemeFields.indexOf('gender_age') !== -1, 'default includes gender_age');

try { localStorage.removeItem('ne_card_templates_' + _stChar); } catch(e) {}

// ====== N5: getCharacterInjectionFields with stCharName ======
console.log('\n=== schema: getCharacterInjectionFields with stCharName ===');

var _stChar2 = '__test_proto2__';
try {
    var _cardCfg2 = {
        _dialogueTemplates: {
            'pc_active_dt': {
                _active: true,
                _templateId: null,
                presetFields: ['status', 'personality', 'injuries', 'gender_age'],
                customFieldRefs: []
            }
        },
        _templateConfig: {},
        _version: 0
    };
    localStorage.setItem('ne_card_templates_' + _stChar2, JSON.stringify(_cardCfg2));
} catch(e) {}

var pcState2 = {
    protagonist_name: _stChar2,
    characters: { 'Hero_pc': { _scheme: 'pc_active_dt', _role: 'protagonist', status: '活跃' } }
};
var pcInjection = getCharacterInjectionFields(pcState2, 'Hero_pc', _stChar2);
assert(pcInjection.indexOf('injuries') !== -1, 'PC gets injuries from active template');
assert(pcInjection.indexOf('gender_age') !== -1, 'PC gets gender_age from active template');
assert(pcInjection.indexOf('name') === -1, 'name filtered out');

// PC without stCharName → falls back to protagonist schema defaults
var pcNoStChar = getCharacterInjectionFields(pcState2, 'Hero_pc');
assert(Array.isArray(pcNoStChar), 'PC without stCharName still returns array');
assert(pcNoStChar.indexOf('personality') !== -1, 'PC fallback includes personality');

try { localStorage.removeItem('ne_card_templates_' + _stChar2); } catch(e) {}

// ====== N5: mergeStateChanges _scheme protection for non-protagonist ======
console.log('\n=== schema: mergeStateChanges _scheme protection ===');

// Legacy NPC without _scheme -> backfilled to _default_npc
var sch0 = mergeStateChanges(
    { characters: { 'OldNPC': { name: 'OldNPC', mood: 'happy' } } },
    { 'characters.OldNPC.mood': 'sad' }
);
eq(sch0.state.characters['OldNPC']._scheme, '_default_npc', 'legacy NPC backfilled to _default_npc');

// Non-protagonist can set _scheme if not already set (but backfill runs first, so LLM can override _default_npc)
var sch1 = mergeStateChanges({ characters: {} }, { 'characters.NPC_3._scheme': 'my_scheme_key' });
ok(sch1.state.characters && sch1.state.characters['NPC_3'], 'NPC entry created');
eq(sch1.state.characters['NPC_3']._scheme, 'my_scheme_key', '_scheme set for non-protagonist without existing');

// Non-protagonist with existing _scheme → should not be overwritten
var sch2 = mergeStateChanges(
    { characters: { 'NPC_4': { _scheme: 'existing_dt_key' } } },
    { 'characters.NPC_4._scheme': 'new_key' }
);
eq(sch2.state.characters['NPC_4']._scheme, 'existing_dt_key', 'existing _scheme NOT overwritten');

// Protagonist -> _scheme always rejected (LLM cannot change it), but backfill sets _default_pc
var sch3 = mergeStateChanges(
    { protagonist_name: 'Hero', characters: { 'Hero': { _role: 'protagonist' } } },
    { 'characters.Hero._scheme': 'should_not_set' }
);
eq(sch3.state.characters['Hero']._scheme, '_default_pc', 'protagonist _scheme backfilled to _default_pc, LLM change rejected');

// Protagonist with no existing _scheme -> backfilled to _default_pc, LLM change rejected
var sch4 = mergeStateChanges(
    { protagonist_name: 'Hero', characters: {} },
    { 'characters.Hero._scheme': 'still_blocked' }
);
var heroScheme = (sch4.state.characters && sch4.state.characters['Hero']) ? sch4.state.characters['Hero']._scheme : null;
eq(heroScheme, '_default_pc', 'protagonist _scheme backfilled (no prior _scheme), LLM change rejected');

console.log('\n--- schema: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
