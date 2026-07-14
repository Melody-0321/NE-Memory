/**
 * template-llm.js — Template LLM Sub-Agent + Function Calling
 *
 * Phase 5: Runtime scheme construction, field proposal, and tool-call loop.
 * Provides buildTools() for function calling, template LLM prompts,
 * and tool handler implementations (resolveNpcScheme / resolveFieldProposal).
 */

import { callMemoryPipeline, callMemoryLLM } from '../api/llm.js';
import { safeJsonParse } from './json-fallback.js';
import {
    ALL_PREDEFINED_FIELDS, expandTemplateFields, resolveFieldDef,
    DEFAULT_NPC_TEMPLATE, DEFAULT_PC_TEMPLATE, DEFAULT_FACTION_TEMPLATE, DEFAULT_TASK_TEMPLATE
} from '../vault/schema.js';
import { getPresetFieldsForRole } from '../vault/schema.js';
import {
    loadCardConfigSync, saveCardConfig, loadFieldLibrary, addFieldToLibrary,
    cloneTemplateToCard, getActiveVersion, upgradeTemplateVersion, saveTemplate
} from '../vault/store.js';

var _functionCallingSupported = null;

/**
 * Global notification hook. Set by adapter layer (events.js) at init time.
 * template-llm.js calls this to notify users of tool handler results
 * without importing adapter-layer code.
 * @type {function(string, string, Object):void}
 */
var _onToolResult = null;

/**
 * Set the global notification callback (called from adapter layer).
 * @param {function(string, string, Object):void} fn — fn(level, text, options)
 */
export function setToolResultNotifier(fn) {
    _onToolResult = fn;
}

function _notify(level, text, options) {
    if (_onToolResult) {
        try { _onToolResult(level, text, options || {}); } catch(e) {}
    } else {
        var prefix = level === 'error' ? '[NE ERROR] ' : (level === 'warn' ? '[NE] ' : '');
        console.log(prefix + text);
    }
}

/**
 * Check if the configured API supports function calling.
 * Called once at startup. Cached after first call.
 * @returns {Promise<boolean>}
 */
export function checkFunctionCallingSupport() {
    if (_functionCallingSupported !== null) return Promise.resolve(_functionCallingSupported);
    try {
        var raw = localStorage.getItem('ne_settings');
        var settings = raw ? JSON.parse(raw) : {};
        var secondaryConfig = settings.memoryConfig || {};
        if (!secondaryConfig.url) {
            try {
                var secRaw = localStorage.getItem('ne_secondary_api');
                if (secRaw) { var secApi = JSON.parse(secRaw); if (secApi.url && secApi.model) secondaryConfig = secApi; }
            } catch (e) {}
        }
        var disabled = settings.disableFunctionCalling;
        if (disabled) {
            _functionCallingSupported = false;
            console.log('[NE-FC] Function calling disabled by user setting');
            return Promise.resolve(false);
        }
        if (secondaryConfig.url && secondaryConfig.model) {
            _functionCallingSupported = true;
            console.log('[NE-FC] assumed supported (secondary API: ' + secondaryConfig.model + ' @ ' + secondaryConfig.url.substring(0, 40) + '...)');
            return Promise.resolve(true);
        }
        _functionCallingSupported = false;
        console.log('[NE-FC] not available — no secondary API configured (url=' + !!secondaryConfig.url + ', model=' + !!secondaryConfig.model + ', disabled=' + disabled + ')');
        return Promise.resolve(false);
    } catch (e) {
        _functionCallingSupported = false;
        return Promise.resolve(false);
    }
}

/** @returns {boolean} */
export function isFunctionCallingSupported() {
    if (_functionCallingSupported === null) {
        checkFunctionCallingSupport();
        console.log('[NE-FC] lazy init: supported =', _functionCallingSupported);
    }
    return _functionCallingSupported === true;
}

/**
 * Build OAI-format tool definitions for function calling.
 * If FC not supported, returns only get_character_scheme (no propose_field exposed).
 * @returns {Array<Object>}
 */
export function buildTools() {
    var tools = [{
        type: 'function',
        function: {
            name: 'get_character_scheme',
            description: 'Get or construct a character tracking scheme. Returns the field definitions for a character based on their role, template, and current Mode.',
            parameters: {
                type: 'object',
                properties: {
                    character_name: { type: 'string', description: 'Name of the character to get scheme for' },
                    reason: { type: 'string', description: 'Why this character needs a scheme (1-5 words)' }
                },
                required: ['character_name']
            }
        }
    }];

    return tools;
}

/**
 * Call the template LLM (short context, independent of fill-table LLM).
 * @param {Array<Object>} messages — system + user messages
 * @param {Object} [options]
 * @returns {Promise<string>}
 */
export function callTemplateLLM(messages, options, chatId) {
    options = options || {};
    // N6: Route through resolvePipelineApi to use dedicated ne_template_api channel
    // instead of falling back to callMemoryPipeline (which may hit ST main pipeline).
    // Fallback chain: ne_template_api > default secondary > ST main pipeline.
    var mergedOptions = Object.assign({}, options, {
        operation: options.operation || 'template_scheme',
        temperature: options.temperature || 0.4,
        _forcePipelineApi: true
    });
    return callMemoryLLM(messages, mergedOptions, chatId);
}

/**
 * Scenario A: Build prompt for full scheme construction.
 * @param {string} roleInstruction — role personality/style
 * @param {string} charProfile — character portrait from card/WB
 * @param {string} worldContext — genre/tropes summary
 * @param {string} baseline — baseline field hints
 * @returns {Array<Object>}
 */
export function buildNewSchemePrompt(roleInstruction, charProfile, worldContext, baseline) {
    var fieldKeys = Object.keys(ALL_PREDEFINED_FIELDS).sort();
    var fieldList = fieldKeys.map(function(fk) {
        var def = ALL_PREDEFINED_FIELDS[fk];
        var label = '- ' + fk + ' (' + ((def && def.type) || 'string') + ')';
        if (def.category) label += ' cat:' + def.category;
        return label;
    }).join('\n');

    var customFields = loadFieldLibrary();
    var customList = '';
    if (customFields && customFields.fields && Object.keys(customFields.fields).length > 0) {
        customList = '\n## Available Custom Fields\n' + Object.keys(customFields.fields).map(function(fn) {
            var cf = customFields.fields[fn];
            return '- ' + fn + ' (' + (cf.type || 'string') + '): ' + (cf.description || '');
        }).join('\n');
    }

    return [
        { role: 'system', content: (roleInstruction || 'You are a character tracking scheme designer.') +
            '\n\nGiven the character\'s role and personality, select the most relevant fields for tracking.\n' +
            '- Output ONLY valid JSON: {"presetFields": [...], "customFieldRefs": [...], "confidence": 0.0-1.0, "rationale": "..."}' +
            '\n- presetFields: from the predefined list below. Choose 3-8 fields relevant to this character.' +
            '\n- customFieldRefs: field names from the custom field library (if available below).' +
            '\n- confidence: 0.0 (skip, no scheme needed) to 1.0 (very confident). <0.3 will be ignored.' +
            '\n- rationale: 1 sentence explaining your selection.'
        },
        { role: 'user', content: '## Character Profile\n' + (charProfile || 'No profile available.') +
            '\n\n## World Context\n' + (worldContext || 'Unknown genre/world.') +
            '\n\n## Baseline Fields\n' + (baseline || 'Use defaults.') +
            '\n\n## Available Predefined Fields\n' + fieldList + customList
        }
    ];
}

/**
 * Scenario B: Build prompt for single field proposal judgment.
 * @param {string} schemeFields — comma-separated existing field names
 * @param {string} proposedField — proposed field name + type
 * @param {string} sampleValue — example value from context
 * @returns {Array<Object>}
 */
export function buildProposeFieldPrompt(schemeFields, proposedField, sampleValue) {
    return [
        { role: 'system', content: 'You evaluate proposed tracking fields for character schemes.' +
            '\nOutput ONLY: {"accepted": true/false, "confidence": 0.0-1.0, "reason": "..."}' +
            '\n- accepted: true if useful and non-redundant, false otherwise' +
            '\n- confidence: how sure you are' +
            '\n- reason: 1 sentence on why.'
        },
        { role: 'user', content: '## Current scheme fields: ' + (schemeFields || '(empty)') +
            '\n\n## Proposed field: ' + proposedField +
            '\n\n## Sample value from context: ' + (sampleValue || '(none)')
        }
    ];
}

/**
 * Validate template LLM output for correctness.
 * @param {Object} result — parsed JSON output
 * @param {'scheme'|'proposal'} scenario
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateTemplateOutput(result, scenario) {
    var errors = [];
    var warnings = [];
    if (!result || typeof result !== 'object') {
        errors.push('Output is not a valid object');
        return { valid: false, errors: errors, warnings: warnings };
    }
    if (scenario === 'scheme') {
        if (result.presetFields) {
            result.presetFields.forEach(function(fn) {
                if (!ALL_PREDEFINED_FIELDS[fn]) {
                    errors.push('Unknown preset field: ' + fn);
                }
            });
        }
        if (result.customFieldRefs) {
            var fieldLib = loadFieldLibrary();
            result.customFieldRefs.forEach(function(fn) {
                if (!fieldLib || !fieldLib.fields || !fieldLib.fields[fn]) {
                    warnings.push('Custom field not in library: ' + fn + ' (will be auto-rejected)');
                }
            });
        }
        if (result.presetFields && result.customFieldRefs) {
            var allNames = result.presetFields.concat(result.customFieldRefs);
            var seen = {};
            allNames.forEach(function(fn) {
                if (seen[fn]) errors.push('Duplicate field: ' + fn);
                seen[fn] = true;
            });
        }
        if (result.confidence !== undefined && (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1)) {
            warnings.push('confidence out of range: ' + result.confidence);
        }
    } else if (scenario === 'proposal') {
        if (typeof result.accepted !== 'boolean') {
            errors.push('Missing accepted (boolean)');
        }
    }
    return { valid: errors.length === 0, errors: errors, warnings: warnings };
}

/**
 * Tool handler: get_character_scheme.
 * Reads card-level config, determines Mode, executes template matching or AI generation.
 * @param {Object} args — { character_name, reason }
 * @param {Object} state — the vault state object
 * @param {string} charName — character card name (for card config lookup)
 * @returns {Promise<Object>} — { fields: {...}, source: 'exact'|'ai_generated', _templateKey: string }
 */
export function resolveNpcScheme(args, state, charName) {
    var characterName = args.character_name || '';
    var cardConfig = loadCardConfigSync(charName);
    var mode = 'exact';
    var templateKey = null;

    function _recordMapping(dialogueTemplateKey) {
        if (state && characterName) {
            state.characters = state.characters || {};
            state.characters[characterName] = state.characters[characterName] || {};
            state.characters[characterName]._scheme = dialogueTemplateKey;
        }
    }

    if (cardConfig && cardConfig._templateConfig) {
        var rawMode = (cardConfig._templateConfig._templateMode || cardConfig._templateConfig._npcTemplateMode) || 'fast';
        mode = (rawMode === 'fast') ? 'exact' : rawMode;
    }

    // 角色锁 → 拒绝/强制exact
    if (state && state.characters && state.characters[characterName] && state.characters[characterName]._templateLocked) {
        console.log('[NE-FC] scheme locked for character ' + characterName + ', using existing template');
        if (cardConfig && cardConfig._dialogueTemplates) {
            var lockedDtKeys = Object.keys(cardConfig._dialogueTemplates);
            for (var li = 0; li < lockedDtKeys.length; li++) {
                var ldt = cardConfig._dialogueTemplates[lockedDtKeys[li]];
                if (ldt && ldt._locked) {
                    _recordMapping(lockedDtKeys[li]);
                    return Promise.resolve({
                        fields: expandTemplateFields(ldt),
                        source: 'exact',
                        _templateKey: lockedDtKeys[li]
                    });
                }
            }
        }
        _recordMapping('_default_npc');
        var dFields = expandTemplateFields(DEFAULT_NPC_TEMPLATE);
        return Promise.resolve({ fields: dFields, source: 'exact', _templateKey: '_default_npc' });
    }

    // 模板锁检查
    if (cardConfig && cardConfig._dialogueTemplates) {
        var dtKeys = Object.keys(cardConfig._dialogueTemplates);
        for (var i = 0; i < dtKeys.length; i++) {
            var dt = cardConfig._dialogueTemplates[dtKeys[i]];
            if (dt && dt._locked) { templateKey = dtKeys[i]; break; }
        }
    }

    // Mode 1: exact → direct copy
    if (mode === 'exact' || templateKey) {
        if (templateKey && cardConfig._dialogueTemplates[templateKey]) {
            var exactTemplate = cardConfig._dialogueTemplates[templateKey];
            var exactFields = expandTemplateFields(exactTemplate);
            _recordMapping(templateKey);
            return Promise.resolve({
                fields: exactFields,
                source: 'exact',
                _templateKey: templateKey
            });
        }
        // N4: determine role for default fallback
        var _isPC = (state && state.protagonist_name && characterName === state.protagonist_name);
        var _fallbackRole = _isPC ? 'npc' : (state && state.factions && state.factions.hasOwnProperty(characterName) ? 'faction' : (state && state.quests && state.quests.tasks && state.quests.tasks.hasOwnProperty(characterName) ? 'quest' : 'npc'));
        var _fallbackTpl = _fallbackRole === 'faction' ? DEFAULT_FACTION_TEMPLATE : (_fallbackRole === 'quest' ? DEFAULT_TASK_TEMPLATE : DEFAULT_NPC_TEMPLATE);
        _recordMapping('_default_' + _fallbackRole);
        var defaultFields = expandTemplateFields(_fallbackTpl);
        return Promise.resolve({
            fields: defaultFields,
            source: 'exact',
            _templateKey: '_default_' + _fallbackRole
        });
    }

    // Mode 2/3: adjust → AI-driven
    var isPC = (state && state.protagonist_name && characterName === state.protagonist_name);
    // N4: Four-way role detection — pc/npc/faction/quest
    var role;
    if (isPC) {
        role = 'pc';
    } else if (state && state.factions && state.factions.hasOwnProperty(characterName)) {
        role = 'faction';
    } else if (state && state.quests && state.quests.tasks && state.quests.tasks.hasOwnProperty(characterName)) {
        role = 'quest';
    } else {
        role = 'npc';
    }
    var roleLabel = role === 'pc' ? 'protagonist' : role;
    var roleBaseline = Object.keys(getPresetFieldsForRole(role)).join(', ').substring(0, 120);
    var defaultFallback = role === 'faction' ? DEFAULT_FACTION_TEMPLATE
                        : role === 'quest' ? DEFAULT_TASK_TEMPLATE
                        : DEFAULT_NPC_TEMPLATE;
    return callTemplateLLM(
        buildNewSchemePrompt(
            'You design ' + roleLabel + ' tracking schemes.',
            'Character: ' + characterName + ', role: ' + role + (role === 'faction' ? ' (organization/faction)' : role === 'quest' ? ' (quest/task)' : ''),
            '',
            roleLabel + ' baseline: ' + roleBaseline
        ),
        { operation: 'template_scheme' }
    ).then(function(response) {
        var parsed = safeJsonParse(String(response || '').trim());
        var validated = validateTemplateOutput(parsed, 'scheme');

        if (validated.valid && parsed.confidence !== undefined && parsed.confidence < 0.3) {
            console.log('[NE-FC] scheme confidence too low (' + parsed.confidence + '), using defaults');
            _recordMapping('_default_' + role);
            var fallbackFields = expandTemplateFields(defaultFallback);
            return { fields: fallbackFields, source: 'exact', _templateKey: '_default_' + role };
        }

        var presetFields = (parsed && parsed.presetFields) || [];
        var customRefs = (parsed && parsed.customFieldRefs) || [];

        if (!validated.valid) {
            console.warn('[NE-FC] scheme validation failed:', validated.errors);
            _recordMapping('_default_' + role);
            var fbFields = expandTemplateFields(defaultFallback);
            return { fields: fbFields, source: 'exact', _templateKey: '_default_' + role };
        }

        var fields = {};
        presetFields.forEach(function(fn) {
            var def = ALL_PREDEFINED_FIELDS[fn];
            if (def) fields[fn] = Object.assign({}, def);
        });
        customRefs.forEach(function(fn) {
            var resolved = resolveFieldDef(fn);
            if (resolved.def) {
                fields[fn] = Object.assign({}, resolved.def);
            }
        });

        // 创建模板新版本
        var newTemplate = {
            id: 'tmpl_' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15),
            name: characterName + ' Auto Scheme',
            role: role,
            description: 'AI-generated scheme for ' + characterName,
            source: 'ai_generated',
            presetFields: presetFields.slice(),
            customFieldRefs: customRefs.slice(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveTemplate(newTemplate);

        if (cardConfig) {
            var clonedKey = cloneTemplateToCard(charName, newTemplate);
            _recordMapping(clonedKey);
            toastr.success(characterName + ' scheme auto-generated (' + (presetFields.length + customRefs.length) + ' fields)');
            return {
                fields: fields,
                source: 'ai_generated',
                _templateKey: clonedKey
            };
        }
        _recordMapping('_default_npc');
        toastr.success(characterName + ' scheme auto-generated (' + (presetFields.length + customRefs.length) + ' fields)');
        return {
            fields: fields,
            source: 'ai_generated',
            _templateKey: '_default_npc'
        };
    }).catch(function(e) {
        console.warn('[NE-FC] scheme construction failed:', e);
        _recordMapping('_default_npc');
        var dFields = expandTemplateFields(DEFAULT_NPC_TEMPLATE);
        return { fields: dFields, source: 'exact', _templateKey: '_default_npc' };
    });
}

/**
 * Tool handler: propose_field.
 * Checks locks, validates against library, calls template LLM for judgment.
 * @param {Object} args — { character_name, field_name, field_type, description, sample_value }
 * @param {Object} state
 * @param {string} charName
 * @returns {Promise<Object>} — { accepted: boolean, fieldDef: {...}|null, reason: string }
 */
export function resolveFieldProposal(args, state, charName) {
    if (!isFunctionCallingSupported()) {
        return Promise.resolve({ accepted: false, reason: 'Function calling not supported — use Mode 1 for safety.' });
    }

    var cardConfig = loadCardConfigSync(charName);
    var rawMode = (cardConfig && cardConfig._templateConfig) ? ((cardConfig._templateConfig._templateMode || cardConfig._templateConfig._npcTemplateMode) || 'smart') : 'smart';
    var mode = (rawMode === 'fast') ? 'exact' : rawMode;

    // 角色锁 → 拒绝
    var characterName = args.character_name || '';
    if (state && state.characters && state.characters[characterName] && state.characters[characterName]._templateLocked) {
        return Promise.resolve({ accepted: false, reason: 'Character ' + characterName + ' is locked — cannot add fields.' });
    }

    // 模板锁 → 拒绝
    if (cardConfig && cardConfig._dialogueTemplates) {
        var dtKeys = Object.keys(cardConfig._dialogueTemplates);
        for (var i = 0; i < dtKeys.length; i++) {
            if (cardConfig._dialogueTemplates[dtKeys[i]]._locked) {
                return Promise.resolve({ accepted: false, reason: 'Template is locked — cannot add fields.' });
            }
        }
    }

    // Mode 1 → 拒绝
    if (mode === 'exact') {
        return Promise.resolve({ accepted: false, reason: 'Mode is exact (no auto-adjust). Switch to adjust mode in template settings.' });
    }

    var fieldName = args.field_name || '';
    var fieldType = args.field_type || 'string';
    var description = args.description || '';
    var sampleValue = args.sample_value || '';

    // 字段名已存在 → 拒绝
    var resolved = resolveFieldDef(fieldName);
    if (resolved.def) {
        return Promise.resolve({ accepted: false, reason: 'Field "' + fieldName + '" already exists.' });
    }

    // 获取当前 scheme 的字段列表
    var schemeFields = [];
    if (state && state.characters && state.characters[characterName]) {
        var charData = state.characters[characterName];
        Object.keys(charData).forEach(function(k) {
            if (k.indexOf('_') !== 0) schemeFields.push(k);
        });
    }

    return callTemplateLLM(
        buildProposeFieldPrompt(
            schemeFields.join(', '),
            fieldName + ' (' + fieldType + '): ' + description,
            sampleValue
        ),
        { operation: 'template_proposal' }
    ).then(function(response) {
        var parsed = safeJsonParse(String(response || '').trim());
        var validated = validateTemplateOutput(parsed, 'proposal');

        if (!validated.valid || !parsed.accepted) {
            return { accepted: false, reason: parsed && parsed.reason ? parsed.reason : 'AI rejected the proposal.' };
        }

        // 添加到字段库
        addFieldToLibrary(fieldName, {
            name: fieldName,
            type: fieldType,
            description: description,
            usedByTemplates: []
        });

        _notify('info', 'New field "' + fieldName + '" (' + fieldType + ') added to library', { _dedupKey: 'field_' + fieldName });

        return {
            accepted: true,
            fieldDef: { type: fieldType, description: description, _source: 'ai_generated' },
            reason: parsed.reason || 'AI accepted the proposal.'
        };
    }).catch(function(e) {
        console.warn('[NE-FC] field proposal failed:', e);
        return { accepted: false, reason: 'Proposal evaluation failed: ' + (e && e.message) };
    });
}

/**
 * Process a function-calling loop for tool calls.
 * @param {Array<Object>} toolCalls — array of {id, function: {name, arguments}}
 * @param {Object} state — vault state
 * @param {string} charName — character card name
 * @returns {Promise<Object>} — { results: Array, degraded: boolean }
 */
export function processToolCalls(toolCalls, state, charName) {
    var results = [];
    var promises = [];
    var degraded = false;

    toolCalls.forEach(function(tc) {
        var args = {};
        try {
            args = JSON.parse(tc.function.arguments || '{}');
        } catch (e) {
            results.push({ tool_call_id: tc.id, content: JSON.stringify({ error: 'Invalid JSON arguments' }) });
            degraded = true;
            return;
        }

        var promise;
        if (tc.function.name === 'get_character_scheme') {
            promise = resolveNpcScheme(args, state, charName).then(function(schemeResult) {
                return { tool_call_id: tc.id, content: JSON.stringify(schemeResult) };
            }).catch(function(e) {
                return { tool_call_id: tc.id, content: JSON.stringify({ error: e && e.message, degraded: true }) };
            });
        } else if (tc.function.name === 'propose_field') {
            if (!isFunctionCallingSupported()) {
                promise = Promise.resolve({
                    tool_call_id: tc.id,
                    content: JSON.stringify({ accepted: false, reason: 'Function calling not supported.' })
                });
            } else {
                promise = resolveFieldProposal(args, state, charName).then(function(propResult) {
                    return { tool_call_id: tc.id, content: JSON.stringify(propResult) };
                }).catch(function(e) {
                    return { tool_call_id: tc.id, content: JSON.stringify({ error: e && e.message, degraded: true }) };
                });
            }
        } else {
            promise = Promise.resolve({
                tool_call_id: tc.id,
                content: JSON.stringify({ error: 'Unknown tool: ' + tc.function.name })
            });
        }
        promises.push(promise);
    });

    return Promise.all(promises).then(function(toolResults) {
        results = results.concat(toolResults);
        return { results: results, degraded: degraded };
    });
}

/**
 * Simple notify caller — sends compact system message after FC operations.
 * Returns a plain string for console/injection use.
 * @param {string} level
 * @param {string} text
 */
export function formatFCNotification(level, text) {
    var prefix = level === 'error' ? '[NE ERROR] ' : (level === 'warn' ? '[NE] ' : '');
    return prefix + text;
}
