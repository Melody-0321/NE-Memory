import {
    buildTools, validateTemplateOutput, formatFCNotification,
    buildNewSchemePrompt, buildProposeFieldPrompt,
    checkFunctionCallingSupport, isFunctionCallingSupported,
    resolveNpcScheme
} from '../src/core/engine/template-llm.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

// ====== validateTemplateOutput — scheme scenario ======
console.log('\n=== template-llm: validateTemplateOutput ===');

var validScheme = {
    presetFields: ['status', 'personality'],
    customFieldRefs: [],
    confidence: 0.8,
    rationale: 'Core tracking fields'
};
var v1 = validateTemplateOutput(validScheme, 'scheme');
eq(v1.valid, true, 'valid scheme passes');
eq(v1.errors.length, 0, 'no errors');
eq(v1.warnings.length, 0, 'no warnings');

// Unknown preset field
var unknownPreset = { presetFields: ['status', 'ninja_skill_xyz'], confidence: 0.5 };
var v2 = validateTemplateOutput(unknownPreset, 'scheme');
eq(v2.valid, false, 'unknown preset field rejected');
assert(v2.errors.length > 0, 'has errors');

// confidence out of range
var badConf = { presetFields: ['status'], confidence: 1.5 };
var v3 = validateTemplateOutput(badConf, 'scheme');
assert(v3.warnings.length > 0, 'confidence out of range warns');
// but should still pass (confidence is warn, not error)
eq(v3.valid, true, 'out of range confidence is warning, not error');

var negConf = { presetFields: ['status'], confidence: -0.5 };
var v4 = validateTemplateOutput(negConf, 'scheme');
assert(v4.warnings.length > 0, 'negative confidence warns');

// Duplicate field
var dup = { presetFields: ['status', 'personality'], customFieldRefs: ['status'], confidence: 0.5 };
var v5 = validateTemplateOutput(dup, 'scheme');
assert(v5.errors.length > 0, 'duplicate field detected');

// Null input
var v6 = validateTemplateOutput(null, 'scheme');
eq(v6.valid, false, 'null input rejected');

// Empty object
var v7 = validateTemplateOutput({}, 'scheme');
eq(v7.valid, true, 'empty object passes (no fields to check)');

// ====== validateTemplateOutput — proposal scenario ======
console.log('\n=== template-llm: validateTemplateOutput proposal ===');

var validProposal = { accepted: true, confidence: 0.9, reason: 'Useful field' };
var p1 = validateTemplateOutput(validProposal, 'proposal');
eq(p1.valid, true, 'valid proposal passes');
eq(p1.errors.length, 0, 'no errors');

var missingAccepted = { confidence: 0.5 };
var p2 = validateTemplateOutput(missingAccepted, 'proposal');
eq(p2.valid, false, 'missing accepted rejected');
assert(p2.errors.length > 0, 'has error about missing accepted');

var rejectionProposal = { accepted: false, reason: 'not needed' };
var p3 = validateTemplateOutput(rejectionProposal, 'proposal');
eq(p3.valid, true, 'rejection with reason passes');

var nullProposal = validateTemplateOutput(null, 'proposal');
eq(nullProposal.valid, false, 'null proposal rejected');

// ====== buildTools ======
console.log('\n=== template-llm: buildTools ===');

var tools = buildTools();
ok(Array.isArray(tools), 'buildTools returns array');
assert(tools.length >= 1, 'at least 1 tool');
assert(tools.length <= 2, 'at most 2 tools');

var hasGetScheme = tools.some(function(t) { return t.function && t.function.name === 'get_character_scheme'; });
assert(hasGetScheme, 'includes get_character_scheme');

// get_character_scheme structure
var gcs = tools.find(function(t) { return t.function && t.function.name === 'get_character_scheme'; });
eq(gcs.type, 'function', 'tool type is function');
ok(gcs.function.parameters, 'has parameters');
eq(gcs.function.parameters.type, 'object', 'parameters type is object');
ok(gcs.function.parameters.properties.character_name, 'has character_name param');
eq(gcs.function.parameters.properties.character_name.type, 'string', 'character_name is string');
eq(gcs.function.parameters.required.length, 1, '1 required param');
eq(gcs.function.parameters.required[0], 'character_name', 'required param is character_name');

// propose_field existence (may not be present if FC disabled)
var hasPropose = tools.some(function(t) { return t.function && t.function.name === 'propose_field'; });

if (hasPropose) {
    var pf = tools.find(function(t) { return t.function && t.function.name === 'propose_field'; });
    ok(pf.function.parameters.properties.field_name, 'has field_name param');
    ok(pf.function.parameters.properties.field_type, 'has field_type param');
    ok(pf.function.parameters.properties.field_type.enum, 'field_type has enum');
    eq(pf.function.parameters.required.length, 4, '4 required params');
}

// ====== formatFCNotification ======
console.log('\n=== template-llm: formatFCNotification ===');

var n1 = formatFCNotification('info', 'test');
ok(n1.indexOf('test') !== -1, 'info notification contains text');

var n2 = formatFCNotification('warn', 'warning');
ok(n2.indexOf('[NE]') !== -1, 'warn has [NE] prefix');

var n3 = formatFCNotification('error', 'fail');
ok(n3.indexOf('[NE ERROR]') !== -1, 'error has [NE ERROR] prefix');

// ====== buildProposeFieldPrompt ======
console.log('\n=== template-llm: buildProposeFieldPrompt ===');

var pp = buildProposeFieldPrompt('status, affection', 'custom_mood (string)', 'happy');
ok(Array.isArray(pp), 'returns array');
eq(pp.length, 2, '2 messages');
eq(pp[0].role, 'system', 'first is system');
eq(pp[1].role, 'user', 'second is user');
ok(pp[1].content.indexOf('status, affection') !== -1, 'user msg contains scheme fields');
ok(pp[1].content.indexOf('custom_mood') !== -1, 'user msg contains proposed field');

// ====== buildNewSchemePrompt ======
console.log('\n=== template-llm: buildNewSchemePrompt ===');

var np = buildNewSchemePrompt('You are a designer', 'Test character: Alice', 'Fantasy world', 'Use defaults');
ok(Array.isArray(np), 'returns array');
eq(np.length, 2, '2 messages');
eq(np[0].role, 'system', 'first is system');
ok(np[0].content.indexOf('presetFields') !== -1, 'system msg mentions presetFields');
ok(np[0].content.indexOf('customFieldRefs') !== -1, 'system msg mentions customFieldRefs');
eq(np[1].role, 'user', 'second is user');
ok(np[1].content.indexOf('Character Profile') !== -1, 'user msg has character profile');
ok(np[1].content.indexOf('World Context') !== -1, 'user msg has world context');
ok(np[1].content.indexOf('Available Predefined Fields') !== -1, 'user msg has predefined fields list');

// ====== checkFunctionCallingSupport / isFunctionCallingSupported ======
console.log('\n=== template-llm: FC detection ===');

function resetFCCache() {
    // Access the module-level cache and reset it
    // We can't directly access _functionCallingSupported, but we can clear
    // localStorage ne_settings to force re-detect.
    localStorage.removeItem('ne_settings');
}

var fcSupported = isFunctionCallingSupported();
eq(typeof fcSupported, 'boolean', 'isFunctionCallingSupported returns boolean');

// Without settings key, should be false
if (!fcSupported) {
    console.log('  (FC not available in test env — expected)');
    // buildTools should only have 1 tool
    var otherTools = buildTools();
    var otherHasPropose = otherTools.some(function(t) { return t.function && t.function.name === 'propose_field'; });
    // Should not have propose_field when FC is disabled
} else {
    console.log('  (FC available — check ne_settings in localStorage)');
}

// ====== N4: resolveNpcScheme 4-way role detection ======
console.log('\n=== template-llm: resolveNpcScheme locked character ===');

// Mock cardConfig with a locked template
var _scChar = '__sc_test_char__';
try {
    var _scCfg = {
        _dialogueTemplates: {
            'locked_dt': { _active: true, _templateId: null, _locked: true, presetFields: ['status', 'personality'], customFieldRefs: [] }
        },
        _templateConfig: { _npcTemplateMode: 'fast' },
        _version: 0
    };
    localStorage.setItem('ne_card_templates_' + _scChar, JSON.stringify(_scCfg));
} catch(e) {}

// Test: locked character returns existing locked template
var scState1 = { characters: { 'NpcX': { _templateLocked: true } } };
resolveNpcScheme({ character_name: 'NpcX' }, scState1, _scChar).then(function(r) {
    ok(r, 'locked char returns result');
    ok(r.fields, 'locked char has fields');
    assert(r.fields && r.fields.status, 'locked char fields include status');
    assert(r.fields && r.fields.personality, 'locked char fields include personality');

    // Cleanup
    try { localStorage.removeItem('ne_card_templates_' + _scChar); } catch(e) {}

    console.log('\n=== template-llm: ' + passed + ' passed, ' + failed + ' failed ===');
    if (failed > 0) process.exit(1);
}).catch(function(e) {
    console.error('  FAIL: resolveNpcScheme async test error: ' + (e && e.message ? e.message : String(e)));
    failed++;
    try { localStorage.removeItem('ne_card_templates_' + _scChar); } catch(e) {}
    console.log('\n=== template-llm: ' + passed + ' passed, ' + failed + ' failed ===');
    if (failed > 0) process.exit(1);
});
