import { read } from '../vault/store.js';
import { validateStateChanges, mergeStateChanges, isStateSchemaEnabled, ensureCharacterTemplate, rebuildPresentCharacters, buildStateInjectionTable, DEFAULT_NPC_SCHEME, DEFAULT_CHARACTER_SCHEMA, ALL_PREDEFINED_FIELDS } from '../vault/schema.js';
import { saveVaultWithSnapshot, ensureStateStructure, parseSTMResponse, handleQuestCompletion } from './pipeline-shared.js';
import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';
import { safeJsonParse } from './json-fallback.js';
import { runtime } from '../runtime.js';

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
    var fieldSet = {};
    // Collect from character definitions
    Object.keys(DEFAULT_CHARACTER_SCHEMA.npc.fields).forEach(function(fk) {
        if (fk !== 'name') fieldSet[fk] = true;
    });
    // Also collect from PC schema (shared fields)
    Object.keys(DEFAULT_CHARACTER_SCHEMA.protagonist.fields).forEach(function(fk) {
        if (fk !== 'name') fieldSet[fk] = true;
    });
    return Object.keys(fieldSet).sort();
}

/**
 * Get layer==='static' field names from scheme definitions.
 * Used by findNewCharacterNames and newCharHint generation.
 * @returns {string[]}
 */
function getStaticFieldNames() {
    var names = [];
    Object.keys(ALL_PREDEFINED_FIELDS).forEach(function(fk) {
        var def = ALL_PREDEFINED_FIELDS[fk];
        if (def.layer === 'static' && !def._system) names.push(fk);
    });
    return names;
}

/**
 * Build a new-character example JSON string for the prompt,
 * dynamically generated from layer==='static' field definitions.
 * @param {string} name - character name for the example
 * @param {boolean} isEn - language flag
 * @returns {string}
 */
function buildNewCharacterExample(name, isEn) {
    var staticNames = getStaticFieldNames();
    var sampleName = name || (isEn ? 'Alice' : '安然');
    var sampleFields = {};
    staticNames.forEach(function(fk) {
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
    var staticFields = getStaticFieldNames();
    var newNames = [];
    Object.keys(chars).forEach(function(name) {
        var card = chars[name];
        if (!card || typeof card !== 'object') return;
        var allEmpty = staticFields.every(function(fk) {
            return !card[fk] || card[fk] === '' || card[fk] === '(未填)';
        });
        if (allEmpty) newNames.push(name);
    });
    if (state.protagonist_name && newNames.indexOf(state.protagonist_name) === -1) {
        var pc = chars[state.protagonist_name];
        if (!pc || typeof pc !== 'object') {
            newNames.push(state.protagonist_name);
        } else {
            var pcEmpty = staticFields.every(function(fk) {
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
    var staticNames = getStaticFieldNames();

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
            var staticFieldsDesc = staticNames.map(function(fn) {
                var def = ALL_PREDEFINED_FIELDS[fn];
                var desc = '- ' + fn;
                if (def && def.max_length) desc += ': max ' + def.max_length + ' chars';
                return desc;
            }).join('\n');
            var example = buildNewCharacterExample(newNames[0], true);
            newCharHintEn = '\n## New Characters (MUST fill)\n' +
                'The following characters appear for the first time. Fields are empty: ' + newNames.join(', ') + '.\n' +
                'You MUST output state_changes.characters.<name> containing:\n' +
                staticFieldsDesc + '\n' +
                (worldBook ? 'Extract values from ' + sourceLabel + ' character descriptions above.\n' : 'Extract values from ' + sourceLabel + ' above.\n') +
                '\nCorrect example:\n' + example + '\n';
        }
        return {
            system: [
                (charCard || '') + rulesStaticEn,
                stateTable + worldBook + fallbackNote + newCharHintEn
            ],
            user: 'Recent messages:\n\n' + msgTexts + '\n\nOutput JSON with state_changes. Fill static fields from sources above; infer current-snapshot fields from dialogue + scene context.'
        };
    }
    var newCharHintZh = '';
    if (newNames.length > 0) {
        var sourceLabelZh = worldBook ? 'World Book' : '角色卡';
        var staticFieldsDescZh = staticNames.map(function(fn) {
            var def = ALL_PREDEFINED_FIELDS[fn];
            var desc = '- ' + fn;
            if (def && def.max_length) desc += '：最长 ' + def.max_length + ' 字符';
            return desc;
        }).join('\n');
        var exampleZh = buildNewCharacterExample(newNames[0], false);
        newCharHintZh = '\n## 新角色（必须填充）\n' +
            '以下角色首次出场，字段为空：' + newNames.join('、') + '。\n' +
            '你必须输出 state_changes.characters.<name> 包含：\n' +
            staticFieldsDescZh + '\n' +
            (worldBook ? '从上方 ' + sourceLabelZh + ' 中提取。\n' : '从上方 ' + sourceLabelZh + ' 中提取。\n') +
            '\n正确示例：\n' + exampleZh + '\n';
    }
    return {
        system: [
            (charCard || '') + rulesStaticZh,
            stateTable + worldBook + fallbackNote + newCharHintZh
        ],
        user: '最近的对话消息：\n\n' + msgTexts + '\n\n输出包含 state_changes 的 JSON。静态字段从上方来源填充；当前快照字段从对话 + 场景上下文推断。'
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

function buildSchemeCharPrompt(messages, isEn) {
    var msgText = '';
    if (messages && messages.length > 0) {
        msgText = '\n## Current Dialogue\n';
        messages.forEach(function(m) {
            msgText += (m.name || m.role || '') + ': ' + (m.content || '') + '\n';
        });
    }

    var fieldKeys = Object.keys(DEFAULT_CHARACTER_SCHEMA.npc.fields).filter(function(k) { return k !== 'name'; });
    var fieldDescs = fieldKeys.map(function(k) { return '  ' + k + ' (' + ((DEFAULT_CHARACTER_SCHEMA.npc.fields[k].type) || 'string') + ')'; }).join('\n');

    return '' +
        msgText +
        '\n## Task\n' +
        'Based on the world setting (see system message) and dialogue above, determine:\n' +
        '1. What NPC character tracking schemes are needed (1-3 schemes)\n' +
        '2. Identify all characters mentioned (protagonist + NPCs)\n' +
        '\nAvailable fields (name reserved, not output):\n' +
        fieldDescs + '\n' +
        '\nRules:\n' +
        '- Every scheme MUST include "status"\n' +
        '- "default" scheme is mandatory (catch-all)\n' +
        '- Field names MUST be from the available list above\n' +
        '- required: fields always tracked; optional: tracked when relevant\n' +
        '\nOutput ONLY valid JSON:\n' +
        '{\n' +
        '  "schemes": {\n' +
        '    "default": { "description": "...", "required": [...], "optional": [...] },\n' +
        '    "scheme_name": { ... }\n' +
        '  },\n' +
        '  "initial_characters": [\n' +
        '    { "name": "\u89d2\u8272\u540d", "_role": "protagonist|npc", "_scheme": "scheme_name|null" },\n' +
        '    { "name": "\u89d2\u8272\u540d", "_role": "protagonist|npc", "_scheme": "scheme_name|null" }\n' +
        '  ]\n' +
        '}';
}

function buildFactionExtractionPrompt() {
    return '## Task\n' +
        'Extract only organizations, factions, guilds, clans, families, or groups\n' +
        'that are EXPLICITLY described in the World Setting (system message above).\n' +
        'If none are described, return an empty object: {}\n' +
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
        '  }\n' +
        '}\n' +
        '\nIf no factions exist:\n' +
        '{"factions":{}}';
}

export async function resolveNpcSchemes(vault, chatId, messages) {
    if (!vault || !vault.content) return;

    var state = vault.content.state || {};

    // 闸门 A：已存在角色卡级配置 → 跳过
    var charName = vault._charName || state.protagonist_name || '';
    var cardConfig = null;
    if (charName) {
        var rawCfg = null;
        try { rawCfg = localStorage.getItem('ne_card_templates_' + charName); } catch(e) {}
        if (rawCfg) {
            try { cardConfig = JSON.parse(rawCfg); } catch(e) {}
        }
        if (cardConfig && cardConfig._dialogueTemplates && Object.keys(cardConfig._dialogueTemplates).length > 0) {
            console.log('[NE] Card-level templates already exist for ' + charName + ', skipping resolveNpcSchemes');
            // 确保 state.characters 从现有配置恢复
            restoreStateFromCardConfig(state, cardConfig);
            vault.content.state = state;
            return;
        }
    }

    // 闸门 B：检查 state.characters 中是否已有角色通过模板初始化
    var hasFilledChars = false;
    if (state.characters) {
        var charKeys = Object.keys(state.characters);
        for (var ci = 0; ci < charKeys.length; ci++) {
            var ch = state.characters[charKeys[ci]];
            if (ch && typeof ch === 'object' && ch._templateKey) { hasFilledChars = true; break; }
        }
    }
    if (hasFilledChars) {
        console.log('[NE] characters already initialized with _templateKey, skipping resolveNpcSchemes');
        return;
    }

    if (state.npc_schemes) return; // 旧格式仍存在，跳过

    var worldBookContent = await collectWorldBookContent();
    state.characters = state.characters || {};

    if (!worldBookContent || worldBookContent.length === 0) {
        // 无世界书 → 使用默认模板初始化所有已知角色
        initCharactersFromDefaults(state);
        vault.content.state = state;
        return;
    }

    var worldBookMsg = buildWorldBookSystemBlock(worldBookContent);

    try {
        var [resp1, resp2] = await Promise.all([
            callMemoryPipeline([
                worldBookMsg,
                { role: 'system', content: 'You are a world-building analyst. Determine NPC tracking schemes and list all characters.' },
                { role: 'user', content: buildSchemeCharPrompt(messages) }
            ], { operation: 'scheme_discovery' }, chatId),

            callMemoryPipeline([
                worldBookMsg,
                { role: 'system', content: 'You extract organizations and factions from world settings. Return only what is explicitly described. If nothing matches, return {"factions":{}}.' },
                { role: 'user', content: buildFactionExtractionPrompt() }
            ], { operation: 'faction_discovery' }, chatId)
        ]);

        var parsed1 = safeJsonParse(String(resp1 || '').trim());

        // 保留旧 npc_schemes 格式用于向后兼容
        if (parsed1 && parsed1.schemes) {
            state.npc_schemes = parsed1.schemes;
        } else {
            state.npc_schemes = JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
        }

        if (parsed1 && parsed1.initial_characters && Array.isArray(parsed1.initial_characters)) {
            var discoveredProtagonist = parsed1.initial_characters.find(function(ch) { return ch._role === 'protagonist'; });
            if (discoveredProtagonist && discoveredProtagonist.name && discoveredProtagonist.name !== state.protagonist_name) {
                state.protagonist_name = discoveredProtagonist.name;
                console.log('[NE] protagonist_name updated from scheme_discovery: ' + discoveredProtagonist.name);
            }

            var schemeMap = {};
            parsed1.initial_characters.forEach(function(ch) {
                if (ch.name) {
                    var isProtagonist = (ch.name === state.protagonist_name);
                    var chRole = isProtagonist ? 'protagonist' : 'npc';
                    schemeMap[ch.name] = { _role: chRole, _scheme: isProtagonist ? null : (ch._scheme || null) };
                }
            });
            state._character_schemes = schemeMap;

            var msgText = '';
            if (messages && messages.length > 0) {
                msgText = messages.map(function(m) { return (m.name || '') + ' ' + (m.content || ''); }).join(' ');
            }
            parsed1.initial_characters.forEach(function(ch) {
                if (!ch.name) return;
                var isProtagonist = (ch.name === state.protagonist_name);
                var isMentioned = msgText.indexOf(ch.name) !== -1;
                if (!isProtagonist && !isMentioned) return;
                var schemeKey = isProtagonist ? null : (ch._scheme || 'default');
                ensureCharacterTemplate(state, ch.name, schemeKey);
                if (state.characters && state.characters[ch.name]) {
                    state.characters[ch.name]._role = isProtagonist ? 'protagonist' : 'npc';
                    if (!isProtagonist && ch._scheme) state.characters[ch.name]._scheme = ch._scheme;
                }
            });

            if (parsed1.initial_characters) {
                var wbCache = {};
                var protagonistName = state.protagonist_name || '';

                try {
                    var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
                    var allEntries = (ctx && ctx.worldInfo && ctx.worldInfo.entries) ? ctx.worldInfo.entries : {};
                    var entryList = [];

                    Object.keys(allEntries).forEach(function(uid) {
                        var entry = allEntries[uid];
                        if (!entry || entry.disable || !entry.content) return;
                        entryList.push(entry);
                    });

                    if (entryList.length > 0) {
                        parsed1.initial_characters.forEach(function(ch) {
                            if (!ch.name) return;

                            var matched = entryList.filter(function(entry) {
                                return _matchEntryKeyToName(entry, ch.name, protagonistName);
                            }).map(function(entry) {
                                var label = (entry.key && entry.key.length > 0) ? entry.key[0] : '';
                                return label ? ('[' + label + '] ' + entry.content) : entry.content;
                            });

                            wbCache[ch.name] = matched;
                        });
                    }
                } catch (e) {
                    console.warn('[NE] WB cache build from entries failed:', e && e.message);
                }

                if (Object.keys(wbCache).length > 0) {
                    state._world_book_cache = wbCache;
                }
            }
        }

        var parsed2 = safeJsonParse(String(resp2 || '').trim());

        if (parsed2 && parsed2.factions && typeof parsed2.factions === 'object') {
            var foundFactions = parsed2.factions;
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
                        attitude_toward_player: f.attitude_toward_player || '未知',
                        notes: '',
                        aliases: f.aliases || [],
                        _hidden: true
                    };
                });
                vault.content.faction_keywords = buildFactionKeywords(state.factions);
            }
        }
    } catch (e) {
        console.warn('[NE] Scheme discovery failed:', e);
        initCharactersFromDefaults(state);
    }

    // 保存卡片级模板配置到 localStorage + IndexedDB
    _persistCardConfig(charName, state);

    vault.content.state = state;
}

/**
 * Initialize character state from default templates (no World Book available).
 * @param {Object} state
 */
function initCharactersFromDefaults(state) {
    state.npc_schemes = state.npc_schemes || JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
    state._character_schemes = state._character_schemes || {};
    state.characters = state.characters || {};

    if (state.protagonist_name) {
        state._character_schemes[state.protagonist_name] = { _role: 'protagonist', _scheme: null };
        ensureCharacterTemplate(state, state.protagonist_name);
        if (state.characters[state.protagonist_name]) {
            state.characters[state.protagonist_name]._role = 'protagonist';
        }
    }
}

/**
 * Restore state.characters from card-level config after skip (Gate A).
 * @param {Object} state
 * @param {Object} cardConfig
 */
function restoreStateFromCardConfig(state, cardConfig) {
    state.characters = state.characters || {};
    var dialogueTemplates = cardConfig._dialogueTemplates || {};
    // 仅确保现有 character 不被错误清空；实际填充由 per-round pipeline 处理
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
    var vault = await read(chatId);
    if (!vault || !vault.content) return { vault, changed: false };

    // 首次对话：初始化 c.state 结构（字段名+空值）—— 仅执行一次
    ensureStateStructure(vault);

    var messages = [];
    if (latestUserMsg) messages.push(latestUserMsg);
    if (latestAssistantMsg) messages.push(latestAssistantMsg);

    // Inferred protagonist_name: 优先 state 已存值，否则从最新用户消息推断
    var state = vault.content.state || {};
    if (!state.protagonist_name && latestUserMsg && latestUserMsg.name) {
        state.protagonist_name = latestUserMsg.name;
        vault.content.state = state;
    }

    // 首次初始化：运行 NPC 方案发现（仅一次）
    if (!(vault.content.state || {}).npc_schemes) {
        await resolveNpcSchemes(vault, chatId, messages);
    }

    if (vault.content.faction_keywords) {
        var scanText = '';
        if (latestUserMsg && latestUserMsg.content) scanText += latestUserMsg.content + ' ';
        if (latestAssistantMsg && latestAssistantMsg.content) scanText += latestAssistantMsg.content;
        scanMessageForFactions(scanText, vault.content.faction_keywords, vault.content.state);
    }

    if (messages.length === 0) return { vault, changed: false };

    var newNames = findNewCharacterNames(vault);
    var worldBookText = newNames.length > 0 ? await _fetchWorldBookText(newNames) : '';
    var neCharFallback = !!globalThis.__ne_char_fallback_needed;
    globalThis.__ne_char_fallback_needed = false;
    var statePrompt = buildStatePrompt_Preset(messages, vault, worldBookText, newNames, neCharFallback);

    var stateResponse;
    try {
        var sysMsgs = statePrompt.system.map(function(s) {
            return { role: 'system', content: s };
        });
        stateResponse = await callMemoryPipeline(
            sysMsgs.concat([{ role: 'user', content: statePrompt.user }]),
            { operation: 'state_extract' }, chatId
        );
    } catch (e) {
        console.warn('[NE] Per-round state extraction failed:', e);
        return { vault, changed: false };
    }

    var parsed = parseSTMResponse(stateResponse);
    var stateChanges = parsed.stateChanges || {};
    // 提取 world_context（含在下层 JSON block 的 state_changes 外）
    var rawParsed = safeJsonParse(String(stateResponse || '').trim());
    if (rawParsed && rawParsed.world_context && typeof rawParsed.world_context === 'object' && rawParsed.world_context.genre) {
        var stateRef = vault.content.state || {};
        stateRef._world_context_cache = {
            genre: rawParsed.world_context.genre || '',
            tropes: rawParsed.world_context.tropes || [],
            summary: rawParsed.world_context.summary || '',
            source: 'ai',
            _extractedAt: new Date().toISOString()
        };
        vault.content.state = stateRef;
        console.log('[NE] world_context extracted:', JSON.stringify(rawParsed.world_context));
    }

    // 优先：Main LLM 状态块 — 解析后直接写入 vault 全局数据 + 更新 status
    var pendingBlock = globalThis.__ne_pending_state_block;
    if (pendingBlock) {
        if (pendingBlock.time) vault.content.story_time = pendingBlock.time;
        if (pendingBlock.scene) vault.content.story_scene = pendingBlock.scene;
        if (pendingBlock.day) vault.content.story_date = '第' + pendingBlock.day + '天';
        if (pendingBlock.event) {
            var stateGlobal = vault.content.state || {};
            stateGlobal.main_event = pendingBlock.event;
            vault.content.state = stateGlobal;
        }
        if (pendingBlock.present && pendingBlock.present.length > 0) {
            var state = vault.content.state || {};
            var chars = state.characters || {};
            var presentSet = {};
            pendingBlock.present.forEach(function(n) { presentSet[n.trim()] = true; });
            Object.keys(presentSet).forEach(function(name) {
                if (chars[name] && typeof chars[name] === 'object') {
                    chars[name].status = '活跃';
                } else {
                    if (!chars[name]) chars[name] = {};
                    var schemeLookup = state._character_schemes && state._character_schemes[name];
                    var schemeKey = schemeLookup ? schemeLookup._scheme : null;
                    ensureCharacterTemplate(state, name, schemeKey);
                    chars = state.characters;
                    chars[name]._role = (name === state.protagonist_name || (schemeLookup && schemeLookup._role === 'protagonist')) ? 'protagonist' : ((schemeLookup && schemeLookup._role) || 'npc');
                    if (schemeLookup && schemeLookup._scheme) chars[name]._scheme = schemeLookup._scheme;
                    chars[name].status = '活跃';
                }
            });
            state.characters = chars;
            vault.content.state = state;
            vault.content._active_characters = pendingBlock.present.map(function(n) { return n.trim(); });
        }
        globalThis.__ne_pending_state_block = null;
    }

    // 回退：State LLM 的 state_changes.time / state_changes.scene
    if (stateChanges.time) {
        vault.content.story_time = String(stateChanges.time);
    }
    if (stateChanges.scene) {
        vault.content.story_scene = String(stateChanges.scene);
    }

    if (isStateSchemaEnabled() && Object.keys(stateChanges).length > 0) {
        var schema = vault.content.state_schema || null;
        var result = validateStateChanges(schema, stateChanges);
        if (result.warnings.length > 0) console.warn('[NE] State change warnings:', result.warnings);
        var newState = mergeStateChanges(vault.content.state || {}, result.validated);
        if (JSON.stringify(newState) === JSON.stringify(vault.content.state || {})) {
            console.log('[NE] State unchanged, skipping write');
        } else {
            vault.content.state = newState;
            handleQuestCompletion(vault.content.state, result.validated, vault.content.story_time);
        }
        if (Object.keys(stateChanges).length > 0 && Object.keys(result.validated).length === 0) {
            console.warn('[NE-HARNESS] All ' + Object.keys(stateChanges).length + ' stateChanges rejected by validateStateChanges — Schema may be missing');
        }
    }

    if (isStateSchemaEnabled()) {
        vault.content.state = autoDecayStaleCharacters(vault.content.state, messages);
    }

    vault._meta = vault._meta || {};
    vault._meta.last_state_task = 'per_round';
    vault._meta.last_state_time = new Date().toISOString();

    await saveVaultWithSnapshot(chatId, vault);

    recordTelemetry({
        pipeline_task: 'state_per_round',
        new_state_change_count: Object.keys(stateChanges).length,
        parse_error: null
    }, chatId);

    globalThis.__ne_debug_last_pipeline = {
        changes: stateChanges || {},
        mergedState: vault.content.state || null,
        time: new Date().toISOString()
    };

    return { vault, changed: true };
}
