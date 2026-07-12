import { readState, loadCardConfigSync, getLockedTemplateCharacters } from '../vault/store.js';
import { validateStateChanges, mergeStateChanges, isStateSchemaEnabled, ensureCharacterTemplate, rebuildPresentCharacters, buildStateInjectionTable, DEFAULT_NPC_SCHEME, ALL_PREDEFINED_FIELDS } from '../vault/schema.js';
import { saveStateVault, ensureStateStructure, parseSTMResponse, handleQuestCompletion, _checkChatIntegrity, _resetCheckChatTag } from './pipeline-shared.js';
import { callMemoryPipeline, callMemoryPipelineWithTools, recordTelemetry } from '../api/llm.js';
import { safeJsonParse } from './json-fallback.js';
import { runtime } from '../runtime.js';
import { recordStateDelta, buildStateDeltaSummary, initializeStateChain, pruneOrphanedBranches } from '../vault/state-versions.js';
import { buildTools, processToolCalls, isFunctionCallingSupported } from './template-llm.js';

function buildCharacterCardSection(vault) {
    var chars = runtime.getCharacters();
    if (!chars || chars.length === 0) return '';
    var state = vault && vault.content && vault.content.state;
    var trackedNames = {};
    if (state && state.characters) {
        Object.keys(state.characters).forEach(function(n) { trackedNames[n] = true; });
    }
    if (state && state.protagonist_name) trackedNames[state.protagonist_name] = true;
    var hasTracked = Object.keys(trackedNames).length > 0;
    var lines = [];
    chars.forEach(function(ch) {
        if (!ch.name) return;
        if (hasTracked && !trackedNames[ch.name]) return;
        var hasContent = ch.description || ch.personality || ch.scenario;
        if (!hasContent) return;
        lines.push('[' + ch.name + ']');
        if (ch.description) lines.push('Description: ' + ch.description);
        if (ch.personality) lines.push('Personality: ' + ch.personality);
        if (ch.scenario) lines.push('Scenario: ' + ch.scenario);
    });
    if (lines.length === 0) return '';
    return '## Character Cards\n' + lines.join('\n') + '\n';
}

/**
 * Collect all managed field names from state, derived dynamically from field definitions.
 * Replaces the old hardcoded list. Returns field names in consistent order.
 * @param {import('../types.js').State|null} state
 * @returns {string[]}
 */
function collectAllManagedFields(state) {
    return Object.keys(ALL_PREDEFINED_FIELDS).filter(function(fk) { return fk !== 'name'; }).sort();
}

/**
 * Get identity field names that should be extracted from sources for new characters.
 * These are the core identity fields that character cards / world books typically define.
 * @returns {string[]}
 */
function getIdentityFieldNames() {
    return ['gender_age', 'physique', 'occupation', 'personality', 'past_experience'];
}

/**
 * Build a new-character example JSON string for the prompt,
 * dynamically generated from identity field definitions.
 * @param {string} name - character name for the example
 * @param {boolean} isEn - language flag
 * @returns {string}
 */
function buildNewCharacterExample(name, isEn) {
    var identityNames = getIdentityFieldNames();
    var sampleName = name || (isEn ? 'Alice' : '安然');
    var sampleFields = {};
    identityNames.forEach(function(fk) {
        if (isEn) {
            if (fk === 'gender_age') sampleFields[fk] = 'Female,26';
            else if (fk === 'physique') sampleFields[fk] = '170cm tall, athletic build, short black hair';
            else if (fk === 'occupation') sampleFields[fk] = 'novelist';
            else if (fk === 'personality') sampleFields[fk] = 'confident,sharp';
            else if (fk === 'clothing_build') sampleFields[fk] = 'grey tank top, black shorts';
            else sampleFields[fk] = '';
        } else {
            if (fk === 'gender_age') sampleFields[fk] = '女,26岁';
            else if (fk === 'physique') sampleFields[fk] = '约170cm,假小子风格,黑色短发';
            else if (fk === 'occupation') sampleFields[fk] = '网络小说作者';
            else if (fk === 'personality') sampleFields[fk] = '自信、毒舌';
            else if (fk === 'clothing_build') sampleFields[fk] = '运动背心、短款运动裤';
            else sampleFields[fk] = '';
        }
    });
    return JSON.stringify({ state_changes: { characters: {} } }).replace('"characters":{}', '"characters":{"' + sampleName + '":' + JSON.stringify(sampleFields) + '}');
}

function findNewCharacterNames(vault) {
    var state = (vault && vault.content && vault.content.state) || {};
    var chars = state.characters || {};
    var identityFields = getIdentityFieldNames();
    var newNames = [];
    Object.keys(chars).forEach(function(name) {
        var card = chars[name];
        if (!card || typeof card !== 'object') return;
        var allEmpty = identityFields.every(function(fk) {
            return !card[fk] || card[fk] === '' || card[fk] === '(未填)';
        });
        if (allEmpty) newNames.push(name);
    });
    if (state.protagonist_name && newNames.indexOf(state.protagonist_name) === -1) {
        var pc = chars[state.protagonist_name];
        if (!pc || typeof pc !== 'object') {
            newNames.push(state.protagonist_name);
        } else {
            var pcEmpty = identityFields.every(function(fk) {
                return !pc[fk] || pc[fk] === '' || pc[fk] === '(未填)';
            });
            if (pcEmpty) newNames.push(state.protagonist_name);
        }
    }
    return newNames;
}

function _matchEntryKeyToName(entry, name, protagonistName) {
    var keys = entry.key || [];
    if (keys.length === 0) return false;
    var nameLower = name.toLowerCase();
    var isProtagonist = (name === protagonistName);
    for (var i = 0; i < keys.length; i++) {
        var keyLower = (keys[i] || '').toLowerCase();
        if (keyLower === nameLower) return true;
        if (keyLower.indexOf(nameLower) !== -1) return true;
        if (nameLower.indexOf(keyLower) !== -1) return true;
        if (isProtagonist && (keyLower === '{{user}}' || keyLower.indexOf('{{user}}') !== -1)) return true;
    }
    return false;
}

function _fetchWorldBookText(newNames) {
    if (!newNames || newNames.length === 0) return Promise.resolve('');
    try {
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        if (!ctx || !ctx.getWorldInfoPrompt) return Promise.resolve('');
        var chatForWi = newNames.slice();
        var maxCtx = (ctx.maxContext && ctx.maxContext > 0) ? ctx.maxContext : 8192;
        var scanData = {
            personaDescription: '',
            characterDescription: '',
            characterPersonality: '',
            characterDepthPrompt: '',
            scenario: '',
            creatorNotes: '',
            trigger: 'normal'
        };
        var resultPromise = ctx.getWorldInfoPrompt(chatForWi, maxCtx, true, scanData);
        if (resultPromise && typeof resultPromise.then === 'function') {
            return resultPromise.then(function(result) {
                var text = (result && result.worldInfoString) ? result.worldInfoString : '';
                console.log('[NE-DEBUG] _fetchWorldBookText: newNames=' + JSON.stringify(newNames) +
                    ' | worldBookText_len=' + text.length);
                return text;
            }).catch(function(e) {
                console.warn('[NE-DEBUG] _fetchWorldBookText failed:', e && e.message);
                return '';
            });
        }
    } catch (e) {
        console.warn('[NE-DEBUG] _fetchWorldBookText error:', e && e.message);
    }
    return Promise.resolve('');
}

function buildWorldBookSection(vault, names, worldBookText) {
    try {
        if (!names || names.length === 0) return '';
        if (!worldBookText || !worldBookText.trim()) return '';
        return '\n## World Book — new character profiles\n' +
            '(以上是世界书原文。请重点关注：角色外貌描述→用于 gender_age、角色身份→用于 occupation、性格描述→用于 personality、穿着设定→用于 clothing_build)\n\n' +
            '[WB] ' + worldBookText.trim() + '\n';
    } catch (e) {
        console.warn('[NE] buildWorldBookSection failed:', e && e.message);
    }
    return '';
}

function buildFactionKeywords(factions) {
    var map = {};
    Object.keys(factions).forEach(function(name) {
        var f = factions[name];
        var keywords = [name];
        if (f.aliases && Array.isArray(f.aliases)) {
            Array.prototype.push.apply(keywords, f.aliases);
        }
        map[name] = keywords;
    });
    return map;
}

function scanMessageForFactions(text, factionKeywords, state) {
    if (!text || !factionKeywords) return;
    Object.keys(factionKeywords).forEach(function(name) {
        var faction = state.factions && state.factions[name];
        if (faction && !faction._hidden) return;
        var keywords = factionKeywords[name];
        for (var i = 0; i < keywords.length; i++) {
            if (text.indexOf(keywords[i]) !== -1) {
                if (faction) {
                    faction._hidden = false;
                } else {
                    state.factions = state.factions || {};
                    state.factions[name] = { _hidden: false };
                }
                console.log('[NE] Faction activated:', name, 'matched:', keywords[i]);
                break;
            }
        }
    });
}

function buildTemplateLibrarySection() {
    var raw = null;
    try { raw = localStorage.getItem('ne_template_library'); } catch(e) {}
    if (!raw) return '';
    try {
        var lib = JSON.parse(raw);
        var templates = lib.templates || {};
        var npcKeys = Object.keys(templates).filter(function(k) {
            return templates[k] && templates[k].role === 'npc' && !templates[k].system;
        });
        if (npcKeys.length === 0) return '';
        var lines = ['\n## NPC Templates Available'];
        lines.push('When a new NPC appears: match to the best template below. Assign via state_changes.characters.<name>._scheme = "<template_key>".');
        lines.push('');
        lines.push('## Tool Calling Rules');
        lines.push('- NEW characters (any role) — MUST call get_character_scheme to build tracking scheme');
        lines.push('  Receive field list, then output state_changes filling those fields');
        lines.push('- Existing characters WITH _scheme — do NOT change _scheme, do NOT call get_character_scheme');
        lines.push('- Existing characters WITHOUT _scheme — may call get_character_scheme if default is insufficient');
        lines.push('- Need a new tracking field — call propose_field');
        lines.push('');
        npcKeys.forEach(function(k) {
            var t = templates[k];
            var fields = (t.presetFields || []).concat(t.customFieldRefs || []);
            lines.push('- ' + k + ' (' + (t.name || k) + '): ' + fields.join(', '));
        });
        lines.push('- _default: baseline tracking, works for any NPC (status, gender_age, physique, occupation, personality, inner_thoughts, current_mood, affection)');
        return lines.join('\n');
    } catch(e) { return ''; }
}

function buildStatePrompt_Preset(messages, vault, worldBookText, newNames, neCharFallback) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var msgTexts = messages.map(function(m, i) {
        var role = m.role === 'user' ? 'User' : 'Character';
        var name = m.name ? m.name + ': ' : '';
        return '[' + i + '] [' + role + '] ' + name + (m.content || '');
    }).join('\n\n');

    var state = (content.state) || {};
    var stateTable = buildStateInjectionTable(state, messages, undefined, content);
    var charCard = buildCharacterCardSection(vault);

    var managedFields = collectAllManagedFields(state);
    var managedList = managedFields.join(', ');
    var identityNames = getIdentityFieldNames();

    var rulesStaticEn = '\n## Field Rules\n' +
        '- You manage: ' + managedList + '.\n' +
        '- Field already has a specific value → only output if this round CHANGES it.\n' +
        '- Use the field key shown in parentheses in the table above (e.g. ' + (managedFields[0] || 'gender_age') + ') as the JSON path.\n' +
        '- status: 活跃/非活跃/已死亡/已归隐/已离去. Mention ≠ presence.\n' +
        '- Do NOT output present_characters (auto-generated).\n' +
        '- NPCs with _scheme: do NOT change it. New NPCs without _scheme: assign from "NPC Schemes Available". Default to "default".\n' +
        (newNames.length > 0 ? '' : '\nZero-change example: {"state_changes":{}}\n') +
        '- You also manage factions: name, description, leader, attitude_toward_player[友好/中立/冷淡/敌对], notes.\n' +
        '- When a faction is first mentioned or interacts with the player, update its attitude and notes.\n' +
        '\n';

    var rulesStaticZh = '\n## 字段规则\n' +
        '- \u4f60\u7ba1\u7406: ' + managedList + '\u3002\n' +
        '- 字段已有具体值 → 仅在本轮对话导致该值变化时输出。\n' +
        '- JSON 路径使用上方表格括号内的字段名（如 ' + (managedFields[0] || 'gender_age') + '）。\n' +
        '- status: 活跃/非活跃/已死亡/已归隐/已离去。提及≠在场。\n' +
        '- 不要输出 present_characters（自动生成）。\n' +
        '- 已有 _scheme 的 NPC — 不要修改。新 NPC 无 _scheme：从上方「NPC Schemes Available」中分配，不确定用 "default"。\n' +
        (newNames.length > 0 ? '' : '\n零变化示例: {"state_changes":{}}\n') +
        '- 你也管理 factions（势力）：name, description, leader, attitude_toward_player[友好/中立/冷淡/敌对], notes。\n' +
        '- 势力首次被提及或与 PC 互动时，更新其 attitude 和 notes。\n' +
        '\n';

    var fallbackNote = '';
    if (neCharFallback) {
        fallbackNote = lang === 'en'
            ? '\n## Emotion Fallback\nMain LLM did NOT output character emotion blocks this round. You MUST fill: current_mood, inner_thoughts — infer from dialogue context.\n'
            : '\n## 情感回退\n主 LLM 本轮未输出角色情感数据。你必须填充活跃 NPC 的: current_mood、inner_thoughts — 从对话上下文推断。\n';
    }

    var worldBook = newNames.length > 0 ? buildWorldBookSection(vault, newNames, worldBookText) : '';
    console.log('[NE-DEBUG] buildStatePrompt_Preset: newNames=' + JSON.stringify(newNames) +
        ' | worldBook_len=' + (worldBook ? worldBook.length : 0) +
        ' | worldBook_preview=' + JSON.stringify(worldBook ? worldBook.substring(0, 300) : '(empty)') +
        ' | neCharFallback=' + neCharFallback);

    if (lang === 'en') {
        var newCharHintEn = '';
        if (newNames.length > 0) {
            var sourceLabel = worldBook ? 'World Book' : 'Character Cards';
            var identityFieldsDesc = identityNames.map(function(fn) {
                var def = ALL_PREDEFINED_FIELDS[fn];
                var desc = '- ' + fn;
                if (def && def.max_length) desc += ': max ' + def.max_length + ' chars';
                return desc;
            }).join('\n');
            var example = buildNewCharacterExample(newNames[0], true);
            newCharHintEn = '\n## New Characters (MUST fill)\n' +
                'The following characters appear for the first time. Fields are empty: ' + newNames.join(', ') + '.\n' +
                'You MUST output state_changes.characters.<name> containing:\n' +
                identityFieldsDesc + '\n' +
                (worldBook ? 'Extract values from ' + sourceLabel + ' character descriptions above.\n' : 'Extract values from ' + sourceLabel + ' above.\n') +
                '\nCorrect example:\n' + example + '\n';
        }
        var templateSection = buildTemplateLibrarySection();
        return {
            system: [
                (charCard || '') + rulesStaticEn + templateSection,
                stateTable + worldBook + fallbackNote + newCharHintEn
            ],
            user: 'Recent messages:\n\n' + msgTexts + '\n\nOutput JSON with state_changes. Fill identity fields from sources above; infer other fields from dialogue + scene context.'
        };
    }
    var newCharHintZh = '';
    if (newNames.length > 0) {
        var sourceLabelZh = worldBook ? 'World Book' : '角色卡';
        var identityFieldsDescZh = identityNames.map(function(fn) {
            var def = ALL_PREDEFINED_FIELDS[fn];
            var desc = '- ' + fn;
            if (def && def.max_length) desc += '：最长 ' + def.max_length + ' 字符';
            return desc;
        }).join('\n');
        var exampleZh = buildNewCharacterExample(newNames[0], false);
        newCharHintZh = '\n## 新角色（必须填充）\n' +
            '以下角色首次出场，字段为空：' + newNames.join('、') + '。\n' +
            '你必须输出 state_changes.characters.<name> 包含：\n' +
            identityFieldsDescZh + '\n' +
            (worldBook ? '从上方 ' + sourceLabelZh + ' 中提取。\n' : '从上方 ' + sourceLabelZh + ' 中提取。\n') +
            '\n正确示例：\n' + exampleZh + '\n';
    }
    var templateSection = buildTemplateLibrarySection();
    return {
        system: [
            (charCard || '') + rulesStaticZh + templateSection,
            stateTable + worldBook + fallbackNote + newCharHintZh
        ],
        user: '最近的对话消息：\n\n' + msgTexts + '\n\n输出包含 state_changes 的 JSON。身份字段从上方来源填充；其它字段从对话 + 场景上下文推断。'
    };
}

function autoDecayStaleCharacters(state, messages) {
    if (!state || !state.characters || !messages || !messages.length) return state;
    var msgText = messages.map(function (m) { return (m.content || '') + ' ' + (m.name || ''); }).join(' ');
    var changed = false;
    var pending = state._decay_pending || {};
    Object.keys(state.characters).forEach(function (name) {
        var card = state.characters[name];
        if (card && card.status === '活跃') {
            if (msgText.indexOf(name) === -1) {
                if (pending[name]) {
                    card.status = '非活跃';
                    changed = true;
                    console.log('[NE] Auto-decayed (2-round buffer expired):', name);
                    delete pending[name];
                } else {
                    pending[name] = true;
                    console.log('[NE] Decay pending (round 1):', name);
                }
            } else {
                if (pending[name]) {
                    delete pending[name];
                    console.log('[NE] Decay pending cleared (reappeared):', name);
                }
            }
        }
    });
    state._decay_pending = Object.keys(pending).length > 0 ? pending : undefined;
    if (changed) {
        state = rebuildPresentCharacters(state);
    }
    return state;
}

function collectWorldBookContent() {
    var entries = [];
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.getWorldInfoPrompt) {
                // Use ST's world info scanner with dryRun=true to get activated entries
                var chatForWi = [];
                var chatRaw = ctx.chat || [];
                for (var ci = chatRaw.length - 1; ci >= 0; ci--) {
                    var cm = chatRaw[ci];
                    if (cm && cm.mes) {
                        chatForWi.push(cm.name ? cm.name + ': ' + cm.mes : cm.mes);
                    }
                }
                if (chatForWi.length === 0) {
                    chatForWi.push('placeholder');
                }
                var scanData = {
                    personaDescription: (ctx.powerUserSettings && ctx.powerUserSettings.persona_description) || '',
                    characterDescription: '',
                    characterPersonality: '',
                    characterDepthPrompt: '',
                    scenario: '',
                    creatorNotes: '',
                    trigger: 'normal'
                };
                try {
                    var chid = ctx.characterId;
                    var currentChar = chid !== undefined && ctx.characters ? ctx.characters[chid] : null;
                    if (currentChar) {
                        scanData.characterDescription = currentChar.description || '';
                        scanData.characterPersonality = currentChar.personality || '';
                        scanData.scenario = currentChar.scenario || '';
                        if (currentChar.data && currentChar.data.extensions && currentChar.data.extensions.depth_prompt) {
                            scanData.characterDepthPrompt = currentChar.data.extensions.depth_prompt.prompt || '';
                        }
                        if (currentChar.data && currentChar.data.creator_notes) {
                            scanData.creatorNotes = currentChar.data.creator_notes || '';
                        }
                    }
                } catch (e2) {
                    console.warn('[NE] Failed to build scanData from character:', e2 && e2.message);
                }
                var maxCtx = ctx.maxContext || runtime.maxContext || 8192;
                var resultPromise = ctx.getWorldInfoPrompt(chatForWi, maxCtx, true, scanData);
                if (resultPromise && typeof resultPromise.then === 'function') {
                    return resultPromise.then(function(result) {
                        var text = (result && result.worldInfoString) ? result.worldInfoString : '';
                        if (!text.trim()) return [];
                        var lines = text.split('\n').filter(function(l) { return l.trim(); });
                        return lines.map(function(l) { return { key: '', content: l }; });
                    }).catch(function(e) {
                        console.warn('[NE] getWorldInfoPrompt failed, falling back to raw entries:', e && e.message);
                        return collectWorldBookContent_raw();
                    });
                }
            }
        }
    } catch (e) {
        console.warn('[NE] Failed to collect world book content:', e && e.message);
    }
    return Promise.resolve(collectWorldBookContent_raw());
}

function collectWorldBookContent_raw() {
    var entries = [];
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            var worldInfo = ctx && ctx.worldInfo;
            if (worldInfo && worldInfo.entries) {
                Object.keys(worldInfo.entries).forEach(function(uid) {
                    var entry = worldInfo.entries[uid];
                    if (entry && !entry.disable && entry.content) {
                        entries.push({ key: entry.key || '', content: entry.content });
                    }
                });
            }
        }
    } catch (e) {
        console.warn('[NE] Failed to collect world book content:', e);
    }
    return entries;
}

function buildWorldBookSystemBlock(worldBookEntries) {
    var text = '## World Setting\n';
    worldBookEntries.forEach(function(entry, i) {
        text += '[' + (i + 1) + '] ' + (entry.content || entry.key || '') + '\n';
    });
    return { role: 'system', content: text };
}



function buildFactionExtractionPrompt() {
    return '## Task\n' +
        'Extract TWO things from the World Setting above:\n' +
        '1. Organizations / factions / guilds / clans / families / groups\n' +
        '2. World context — genre, tropes, summary\n' +
        '\nOutput ONLY valid JSON:\n' +
        '{\n' +
        '  "factions": {\n' +
        '    "<Name>": {\n' +
        '      "name": "<Full name>",\n' +
        '      "description": "<One-sentence description>",\n' +
        '      "leader": "<Leader name, or empty if unknown>",\n' +
        '      "attitude_toward_player": "\u53cb\u597d/\u4e2d\u7acb/\u51b7\u6de1/\u654c\u5bf9/\u672a\u77e5",\n' +
        '      "aliases": ["<alias>"]\n' +
        '    }\n' +
        '  },\n' +
        '  "world_context": {\n' +
        '    "genre": "\u4e16\u754c\u89c2\u7c7b\u578b\uff08\u7b80\u4f53\u4e2d\u6587\uff0c\u5982 \u90fd\u5e02\u5947\u5e7b\u3001\u8d5b\u535a\u670b\u514b\u3001\u53e4\u4ee3\u4ed9\u4fa0\u2026\uff09",\n' +
        '    "tropes": ["\u5957\u8def1", "\u5957\u8def2"],\n' +
        '    "summary": "\u7528 2-3 \u53e5\u4e2d\u6587\u7b80\u8ff0\u8fd9\u4e2a\u4e16\u754c\u7684\u57fa\u7840\u8bbe\u5b9a\u3002\u6ca1\u6709\u660e\u786e\u4e16\u754c\u89c2\u65f6\uff0c\u4e5f\u6839\u636e\u89d2\u8272\u5361\u63cf\u8ff0\u63a8\u65ad\u3002"\n' +
        '  }\n' +
        '}\n' +
        '\nIf no factions exist, factions is {}.\n' +
        'world_context is always required.';
}

/**
 * Persist card-level template configuration after first-time scheme discovery.
 * @param {string} charName
 * @param {Object} state
 */
function _persistCardConfig(charName, state) {
    if (!charName) return;
    try {
        var existing = localStorage.getItem('ne_card_templates_' + charName);
        if (existing) return; // 已有配置，不覆盖
        var now = new Date().toISOString();
        var config = {
            _dialogueTemplates: {},
            _templateConfig: { pc: '_default_pc', npc: ['_default_npc'], _npcTemplateMode: 'exact' },
            _version: 1,
            _createdAt: now,
            _updatedAt: now
        };
        localStorage.setItem('ne_card_templates_' + charName, JSON.stringify(config));
        console.log('[NE] Card config initialized for ' + charName);
    } catch (e) {
        console.warn('[NE] Failed to persist card config for ' + charName, e.message);
    }
}
export async function extractStateChangesOnly(chatId, latestUserMsg, latestAssistantMsg) {
    _resetCheckChatTag();
    _checkChatIntegrity('extractStateChangesOnly:entry');
    var stateVault = await readState(chatId);
    if (!stateVault || !stateVault.content) return { stateVault, changed: false };

    initializeStateChain(chatId, stateVault.content || {}).catch(function(err) {
        console.error('[NE] initializeStateChain failed for ' + chatId, err);
    });

    // 首次对话：初始化 c.state 结构（字段名+空值）—— 仅执行一次
    ensureStateStructure(stateVault);

    var messages = [];
    if (latestUserMsg) messages.push(latestUserMsg);
    if (latestAssistantMsg) messages.push(latestAssistantMsg);

    // Inferred protagonist_name: 优先 state 已存值，否则从最新用户消息推断
    var state = stateVault.content.state || {};
    if (!state.protagonist_name && latestUserMsg && latestUserMsg.name) {
        state.protagonist_name = latestUserMsg.name;
        stateVault.content.state = state;
    }

    // 首次初始化：faction_discovery + 默认兜底
    if (!(stateVault.content.state || {}).npc_schemes) {
        var wbContent = await collectWorldBookContent();
        if (wbContent && wbContent.length > 0) {
            try {
                var wbSysBlock = buildWorldBookSystemBlock(wbContent);
                var factionResp = await callMemoryPipeline([
                    wbSysBlock,
                    { role: 'system', content: 'You extract organizations, factions, and world context from world settings. Return only what is explicitly described. If nothing matches, return {"factions":{}}. world_context is always required.' },
                    { role: 'user', content: buildFactionExtractionPrompt() }
                ], { operation: 'faction_discovery' }, chatId);

                var fp = safeJsonParse(String(factionResp || '').trim());
                if (fp && fp.factions && typeof fp.factions === 'object') {
                    var foundFactions = fp.factions;
                    var factionNames = Object.keys(foundFactions);
                    if (factionNames.length > 0) {
                        state.factions = state.factions || {};
                        factionNames.forEach(function(name) {
                            var f = foundFactions[name];
                            if (!f || typeof f !== 'object') return;
                            state.factions[name] = {
                                name: f.name || name,
                                description: f.description || '',
                                leader: f.leader || '',
                                attitude_toward_player: f.attitude_toward_player || '\u672A\u77E5',
                                notes: '',
                                aliases: f.aliases || [],
                                _hidden: true
                            };
                        });
                        stateVault.content.faction_keywords = buildFactionKeywords(state.factions);
                    }
                }

                if (fp && fp.world_context && typeof fp.world_context === 'object' && fp.world_context.genre) {
                    state._world_context_cache = {
                        genre: fp.world_context.genre || '',
                        tropes: fp.world_context.tropes || [],
                        summary: fp.world_context.summary || '',
                        source: 'faction_discovery',
                        _extractedAt: new Date().toISOString()
                    };
                    console.log('[NE] world_context extracted via faction_discovery: ' + fp.world_context.genre);
                }
            } catch (e) {
                console.warn('[NE] faction_discovery failed:', e && e.message);
            }
        }

        state.npc_schemes = JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
        state._character_schemes = state._character_schemes || {};
        if (state.protagonist_name) {
            state._character_schemes[state.protagonist_name] = { _role: 'protagonist', _scheme: null };
            ensureCharacterTemplate(state, state.protagonist_name);
        }
        _persistCardConfig(state.protagonist_name || '', state);
        stateVault.content.state = state;
    }

    if (stateVault.content.faction_keywords) {
        var scanText = '';
        if (latestUserMsg && latestUserMsg.content) scanText += latestUserMsg.content + ' ';
        if (latestAssistantMsg && latestAssistantMsg.content) scanText += latestAssistantMsg.content;
        scanMessageForFactions(scanText, stateVault.content.faction_keywords, stateVault.content.state);
    }

    if (messages.length === 0) return { stateVault, changed: false };

    var newNames = findNewCharacterNames(stateVault);
    var worldBookText = newNames.length > 0 ? await _fetchWorldBookText(newNames) : '';
    var neCharFallback = !!globalThis.__ne_char_fallback_needed;
    globalThis.__ne_char_fallback_needed = false;
    var statePrompt = buildStatePrompt_Preset(messages, stateVault, worldBookText, newNames, neCharFallback);

    var stateResponseText;
    try {
        var sysMsgs = statePrompt.system.map(function(s) {
            return { role: 'system', content: s };
        });
        _checkChatIntegrity('extractStateChangesOnly:beforeLLM');

        var tools = isFunctionCallingSupported() ? buildTools() : null;
        console.log('[NE-FC] extractStateChangesOnly: FC supported =', isFunctionCallingSupported(),
            '| tools =', tools ? tools.length : 0, '| chatId =', chatId);
        var llmMessages = sysMsgs.concat([{ role: 'user', content: statePrompt.user }]);
        var stateResp;

        if (tools) {
            stateResp = await callMemoryPipelineWithTools(llmMessages, { operation: 'state_extract', tools: tools }, chatId);
        } else {
            stateResp = { text: await callMemoryPipeline(llmMessages, { operation: 'state_extract' }, chatId), tool_calls: null };
        }

        var MAX_TOOL_ROUNDS = 3;
        var toolRound = 0;
        while (stateResp.tool_calls && stateResp.tool_calls.length > 0 && toolRound < MAX_TOOL_ROUNDS) {
            toolRound++;
            var _stateForTools = stateVault.content.state || {};
            var toolResults = await processToolCalls(stateResp.tool_calls, _stateForTools, _stateForTools.protagonist_name || '');
            llmMessages.push({ role: 'assistant', content: stateResp.text || null, tool_calls: stateResp.tool_calls });
            for (var ti = 0; ti < toolResults.length; ti++) {
                var tr = toolResults[ti];
                llmMessages.push({ role: 'tool', tool_call_id: tr.id, content: JSON.stringify(tr.result) });
            }
            stateResp = await callMemoryPipelineWithTools(llmMessages, { operation: 'state_extract', tools: tools }, chatId);
        }

        stateResponseText = stateResp.text || '';
    } catch (e) {
        console.warn('[NE] Per-round state extraction failed:', e);
        return { stateVault, changed: false };
    }

    _checkChatIntegrity('extractStateChangesOnly:afterLLM');

    var stateChanges = parseSTMResponse(stateResponseText).stateChanges;

    _checkChatIntegrity('extractStateChangesOnly:afterParse');

    // 优先：Main LLM 状态块 — 解析后直接写入 vault 全局数据 + 更新 status
    var pendingBlock = globalThis.__ne_pending_state_block;
    if (pendingBlock) {
        if (pendingBlock.time) stateVault.content.story_time = pendingBlock.time;
        if (pendingBlock.scene) stateVault.content.story_scene = pendingBlock.scene;
        if (pendingBlock.day) stateVault.content.story_date = '第' + pendingBlock.day + '天';
        if (pendingBlock.present && pendingBlock.present.length > 0) {
            stateVault.content._active_characters = pendingBlock.present.map(function(n) { return n.trim(); });
        }
        globalThis.__ne_pending_state_block = null;
    }

    // 回退：State LLM 的 state_changes.time / state_changes.scene
    if (stateChanges.time) {
        stateVault.content.story_time = String(stateChanges.time);
    }
    if (stateChanges.scene) {
        stateVault.content.story_scene = String(stateChanges.scene);
    }

    if (isStateSchemaEnabled() && Object.keys(stateChanges).length > 0) {
        var schema = stateVault.content.state_schema || null;
        var result = validateStateChanges(schema, stateChanges);
        if (result.warnings.length > 0) console.warn('[NE] State change warnings:', result.warnings);

        // 后处理兜底：过滤掉被锁模板角色的变更
        var lockedCharNames = [];
        var cardName = stateVault.content.state && stateVault.content.state.protagonist_name;
        if (cardName) {
            try {
                var cardCfg = loadCardConfigSync(cardName);
                lockedCharNames = getLockedTemplateCharacters(cardCfg, stateVault.content.state);
            } catch (e) { /* silent */ }
        }
        if (lockedCharNames.length > 0) {
            var filteredValidated = {};
            var skippedKeys = [];
            Object.keys(result.validated).forEach(function(k) {
                var isLockedChange = false;
                for (var l = 0; l < lockedCharNames.length; l++) {
                    if (k.indexOf('characters.' + lockedCharNames[l] + '.') === 0) { isLockedChange = true; break; }
                }
                if (!isLockedChange) {
                    filteredValidated[k] = result.validated[k];
                } else {
                    skippedKeys.push(k);
                }
            });
            if (skippedKeys.length > 0) {
                console.warn('[NE] post-process guard: skipped state_changes for locked-template chars ' +
                    lockedCharNames.join(',') + ' | keys: ' + skippedKeys.join(', '));
            }
            result.validated = filteredValidated;
        }

        var mergeResult = mergeStateChanges(stateVault.content.state || {}, result.validated);
        if (JSON.stringify(mergeResult.state) === JSON.stringify(stateVault.content.state || {})) {
            console.log('[NE] State unchanged, skipping write');
        } else {
            stateVault.content.state = mergeResult.state;
            handleQuestCompletion(stateVault.content.state, result.validated, stateVault.content.story_time);

            if (mergeResult.changes.length > 0) {
                var aiMsgSendDate = latestAssistantMsg && latestAssistantMsg.id ? latestAssistantMsg.id : null;
                recordStateDelta(chatId, {
                    source: 'ai_update',
                    summary: buildStateDeltaSummary(mergeResult.changes),
                    changes: mergeResult.changes,
                    message_dates: aiMsgSendDate ? [aiMsgSendDate] : []
                }).catch(function(err) {
                    console.error('[NE] recordStateDelta failed for ' + chatId, err,
                        '\n  changes:', JSON.stringify(mergeResult.changes).substring(0, 200));
                });
                pruneOrphanedBranches(chatId).catch(function(e) {});
            }
        }
        if (Object.keys(stateChanges).length > 0 && Object.keys(result.validated).length === 0) {
            console.warn('[NE-HARNESS] All ' + Object.keys(stateChanges).length + ' stateChanges rejected by validateStateChanges — Schema may be missing');
        }
    }

    if (isStateSchemaEnabled()) {
        stateVault.content.state = autoDecayStaleCharacters(stateVault.content.state, messages);
    }

    stateVault._meta = stateVault._meta || {};
    stateVault._meta.last_state_task = 'per_round';
    stateVault._meta.last_state_time = new Date().toISOString();

    _checkChatIntegrity('extractStateChangesOnly:beforeSaveVault');
    await saveStateVault(chatId, stateVault);
    _checkChatIntegrity('extractStateChangesOnly:afterSaveVault');

    recordTelemetry({
        pipeline_task: 'state_per_round',
        new_state_change_count: Object.keys(stateChanges).length,
        parse_error: null
    }, chatId);

    globalThis.__ne_debug_last_pipeline = {
        changes: stateChanges || {},
        mergedState: stateVault.content.state || null,
        time: new Date().toISOString()
    };

    return { stateVault, changed: true };
}
