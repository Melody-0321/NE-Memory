/**
 * engine/update.js — 增量更新引擎
 *
 * 核心循环：收集已处理 msg_id → 过滤新消息 → 构建 prompt → 调用 LLM → 解析 STM → 追加
 */
import { runtime } from '../runtime.js';
import { read, appendSTMEntries, collectAllMsgIds, sortStmByMsgOrder } from '../vault/store.js';
import { callMemoryPipeline, initPowerSlots, recordTelemetry } from '../api/llm.js';
import { validateStateChanges, mergeStateChanges, rebuildPresentCharacters, isStateSchemaEnabled, buildStateInjectionTable, DEFAULT_GLOBAL_SCHEMA, DEFAULT_NPC_SCHEME, ensureCharacterTemplate, getNpcInjectionFields } from '../vault/schema.js';
import { safeJsonParse } from './json-fallback.js';
import { validateSTMOutput, postFillSTM } from './validate.js';
import { preGroupItems, formatPreGroupHint } from './bm25-grouper.js';
import { processTurnsInBatches } from './stm-extractor.js';
import { isLtmEnabled, computeClosureSignals, formatLtmCatalog, findOpenLtm } from './consolidate.js';
import { transitionTo, releasePipeline } from './pipeline-guard.js';
import { pruneSnapshotsForChat } from '../vault/versions.js';

import { persistVaultToChatFile } from '../auto-restore.js';
import { writeWithSnapshot } from '../vault/store.js';
import { vocabularyOverlap } from './text-utils.js';
import { groupMessagesIntoTurns, formatTurnsText, collectMsgIdsFromTurns } from './turn-segmenter.js';

export async function saveVaultWithSnapshot(chatId, vault) {
    vault.version = (vault.version || 0) + 1;
    vault.updated_at = new Date().toISOString();
    try {
        var snapshotEntry = {
            id: chatId + '_v' + vault.version,
            chat_id: chatId,
            version: vault.version,
            updated_at: vault.updated_at,
            data: JSON.parse(JSON.stringify(vault))
        };
        await writeWithSnapshot(chatId, vault, snapshotEntry);
        // Prune snapshots beyond limit 30 (oldest first)
        try { await pruneSnapshotsForChat(chatId); } catch (e) { console.warn('[NE] pruneSnapshots error:', e); }
        persistVaultToChatFile(vault);
    } catch (e) {
        console.error('[NE] saveVaultWithSnapshot failed:', e);
    }
}

function resolvePeriodFromSnapshots(msgStart, snapshots) {
    if (!snapshots || snapshots.length === 0) return null;
    for (var i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].msgIdx <= msgStart) {
            return snapshots[i];
        }
    }
    return null;
}

var EVENT_CLOSING_PUNCT = /[.。！？!?\"\”\)\}\]\>\」』）]$/;

function _validateLtmEventText(label, text) {
    if (!text) return;
    var len = String(text).length;
    var trimmed = String(text).trim();
    if (len > 0 && !EVENT_CLOSING_PUNCT.test(trimmed)) {
        console.warn('[NE-HARNESS] ' + label + ' updated_event may be truncated — ends with: "' + trimmed.slice(-20) + '" (len=' + len + ')');
    }
    if (len < 50) {
        console.warn('[NE-HARNESS] ' + label + ' updated_event too short — len=' + len + ' text="' + trimmed + '"');
    }
}

/**
 * 初始化 c.state 结构（首次对话时，c.state 为空）
 * 只执行一次：c.state 非空后变为 no-op
 *
 * @param {Object} vault - 完整 vault 对象，直接修改 vault.content.state
 */
export function ensureStateStructure(vault) {
    if (!vault.content.state) vault.content.state = {};
    vault.content.state_css = vault.content.state_css || '';
    if (!isStateSchemaEnabled()) return;
    var state = vault.content.state;
    var schema = vault.content.state_schema || DEFAULT_GLOBAL_SCHEMA;
    if (!schema) return;
    if (!vault.content.state_schema) {
        vault.content.state_schema = schema;
    }
    if (state.characters && schema.fields && schema.fields.characters) {
        var charSchema = schema.fields.characters.schema;
        if (charSchema && charSchema.fields && charSchema.fields['*']) {
            var template = charSchema.fields['*'].fields;
            Object.keys(state.characters).forEach(function (name) {
                var ch = state.characters[name];
                if (!ch || typeof ch !== 'object') {
                    state.characters[name] = {};
                    ch = state.characters[name];
                }
                Object.keys(template).forEach(function (fk) {
                    if (fk === '*') return;
                    if (ch[fk] === undefined) {
                        var ff = template[fk];
                        if (ff.type === 'boolean') ch[fk] = false;
                        else if (ff.type === 'number') ch[fk] = null;
                        else ch[fk] = '';
                    }
                });
            });
        }
    }
}

/**
 * 从 schema 定义中递归提取字段路径，生成 { field: '' } 结构
 */
function initStateFromSchema(schema, knownKeys) {
    if (!schema || !schema.fields) return {};
    var state = {};
    Object.keys(schema.fields).forEach(function (key) {
        var field = schema.fields[key];
        if (!field) return;
        if (field.enabled === false) return;
        if (key === '*') {
            if (knownKeys && knownKeys.length > 0 && field.fields) {
                knownKeys.forEach(function (name) {
                    state[name] = {};
                    Object.keys(field.fields).forEach(function (fk) {
                        var ff = field.fields[fk];
                        if (fk === '*') return;
                        if (ff.type === 'boolean') {
                            state[name][fk] = false;
                        } else if (ff.type === 'number') {
                            state[name][fk] = 0;
                        } else {
                            state[name][fk] = '';
                        }
                    });
                });
            }
            return;
        }
        if (field.type === 'object') {
            if (field.schema) {
                state[key] = initStateFromSchema(field.schema, knownKeys);
            }
            return;
        }
        state[key] = '';
    });
    return state;
}

export function filterNewMessages(messages, processedIds) {
    return messages.filter(m => {
        const id = (m.id != null) ? m.id : m.mes_id;
        if (id == null) return true;
        return !processedIds.has(String(id));
    });
}

export function buildSTMUpdatePrompt(newMessages, vault, partials) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var msgTexts = newMessages.map(function(m, i) {
        var role = m.role === 'user' ? 'User' : 'Character';
        var name = m.name ? m.name + ': ' : '';
        return '[' + i + '] [' + role + '] ' + name + (m.content || '');
    }).join('\n\n');

    const schemaEnabled = isStateSchemaEnabled();

    var currentStateSnapshot = '';
    if (content.story_time || content.story_scene || content.story_date) {
        currentStateSnapshot = 'story_day: ' + (content.story_time || '') + '\nstory_date: ' + (content.story_date || '') + '\nstory_scene: ' + (content.story_scene || '') + '\n';
    }
    if (!content.story_time && !content.story_date && !content.story_scene) {
        currentStateSnapshot = 'story_day: Day 1\nstory_date: \nstory_scene: 未知\n';
    }
    if (schemaEnabled && content.state && Object.keys(content.state).length > 0) {
        var activeChars = [];
        if (content.state.characters) {
            Object.keys(content.state.characters).forEach(function (n) {
                var c = content.state.characters[n];
                if (c && (c.status === '活跃' || c.status === 'active')) activeChars.push(n);
            });
        }
        if (activeChars.length > 0) {
            currentStateSnapshot += 'Active characters: ' + activeChars.join(', ') + '\n';
        }
    }

    // ── BM25 预分组 ──
    var preGroupHint = '';
    try {
        var groups = preGroupItems(newMessages, {
            tokenizer: null,
            getText: function(m) { return m.content || ''; },
            similarityThreshold: 0.3
        });
        preGroupHint = formatPreGroupHint(groups);
    } catch(e) {}

    // ── Partial 上下文 ──
    var partialCtx = '';
    if (partials && partials.length > 0) {
        partialCtx = '\n## 上次未完成的事件（可能在本轮继续发展）：\n';
        partials.forEach(function(p, i) {
            var rangeStr = (p.msgRange ? p.msgRange.join('-') : '?');
            partialCtx += '  ' + (i + 1) + '. stm:' + (p.id || '?') + ' [' + rangeStr + '] ' + (p.event || '') + '\n';
        });
        partialCtx += '如果本轮的对话能闭合上述事件，请创建新条目并在 "parent_partial" 中引用对应事件的 event 文本（精确匹配）。\n';
    }

    // ── msgRange + status 指令 ──
    var msgRangeInstructionEn = '\n\nEach stm_entries item now also requires:\n' +
        '- "msgRange": [start_idx, end_idx] — REQUIRED. The range of message indices (from the [idx] markers above) that this event covers.\n' +
        '- "status": "closed" | "partial" — REQUIRED. "closed" = event complete. "partial" = event still developing, will continue in next batch.\n' +
        '- "parent_partial": (optional) If this batch closes a pending partial event, include the exact "event" text of that partial.\n\n' +
        'msgRange rules:\n' +
        '- Ranges must be contiguous and cover ALL ' + newMessages.length + ' messages. No gaps, no overlaps.\n' +
        '- Adjacent entries\' ranges should be end-to-end.\n' +
        '- Casual chat with no narrative change may span multiple messages in one entry.\n' +
        (preGroupHint ? '\n' + preGroupHint + '\n' : '');

    var msgRangeInstructionZh = '\n\n每个 stm_entries 条目现在还需包含：\n' +
        '- "msgRange": [start_idx, end_idx] — 必填。该事件覆盖的消息索引范围（对应上方消息 [idx] 标记）。\n' +
        '- "status": "closed" | "partial" — 必填。closed=事件已完整，partial=事件未完成，后续对话会继续发展。\n' +
        '- "parent_partial": （可选）如果本轮闭合了上次未完成的事件，填写对应事件的 event 文本（精确匹配）。\n\n' +
        'msgRange 规则：\n' +
        '- 范围必须连续覆盖所有 ' + newMessages.length + ' 条消息，不跳过、不重叠。\n' +
        '- 相邻条目首尾相接。\n' +
        '- 若为闲聊无实质叙事变化，可合并多条消息到一条。\n' +
        (preGroupHint ? '\n' + preGroupHint + '\n' : '');

    const userMsgEn = `New conversation messages:\n\n${msgTexts}\n\nExtract key events as JSON array.`;
    const userMsgZh = `新对话消息：\n\n${msgTexts}\n\n提取关键事件为 JSON 数组。`;

    if (lang === 'en') {
        return {
            system: currentStateSnapshot + partialCtx + 'You are a story memory extractor. Your task is to extract key events from the conversation into short-term memory entries.\n' +
                '\nOutput a JSON object with an "stm_entries" array:\n' +
                '{\n' +
                '  "stm_entries": [...]\n' +
                '}\n' +
                '\nEach stm_entries item must have:\n' +
                '- "event": what happened — REQUIRED. Be specific enough a reader understands what occurred (20-160 chars).\n' +
                '- "time_label": optional — only set if the event\'s time differs from the implied time. Otherwise omit.\n' +
                '- "translation": Chinese translation of the event (max 200 chars) for cross-lingual search. Provides key terms in Chinese for BM25 token matching.\n' +
                '- "entities": optional — involved entity names with types. Each entry: {"name":"Alice","type":"character"}. Types: character(角色), item(物品), faction(势力), concept(概念), location(地点), event(事件). Plain string arrays ["Alice"] are still accepted and default to character. E.g. [{"name":"Alice","type":"character"}, {"name":"龙牙剑","type":"item"}, {"name":"魔教","type":"faction"}].\n' +
                '\nNote: "period" and "scene" are auto-filled from global state snapshots. Do NOT include them in entries.\n' +
                msgRangeInstructionEn +
                '\nIf nothing of narrative significance happened, output {"stm_entries": []}.',
            user: userMsgEn
        };
    }
    return {
        system: currentStateSnapshot + partialCtx + '你是故事记忆提取器。从对话中提取关键事件到短期记忆中。\n' +
            '\n输出一个包含 "stm_entries" 数组的 JSON 对象：\n' +
            '{\n' +
            '  "stm_entries": [...]\n' +
            '}\n' +
            '\n每个 stm_entries 条目包含：\n' +
            '- "event": 事件描述——必填。具体到让读者理解发生了什么（20-160字）。\n' +
            '- "time_label": （可选）仅当事件时间与当前时间不同时填写，否则省略。\n' +
            '- "translation": 事件的英文翻译（最长200字符），用于跨语言检索。提供英文关键词以供 BM25 词项匹配。\n' +
            '- "entities": （可选）事件涉及的实体名称和类型。每条：{"name":"Alice","type":"character"}。类型：character(角色), item(物品), faction(势力), concept(概念), location(地点), event(事件)。旧式字符串数组 ["Alice"] 仍被接受，默认视为角色。示例：[{"name":"Alice","type":"character"}, {"name":"龙牙剑","type":"item"}, {"name":"魔教","type":"faction"}]。\n' +
            '\n注意："period" 和 "scene" 会自动从全局状态快照填充，条目中无需包含。\n' +
            msgRangeInstructionZh +
            '\n如果没有叙事意义的事件，输出 {"stm_entries": []}。',
        user: userMsgZh
    };
}

function flattenNestedChanges(changes, prefix) {
    prefix = prefix || '';
    var flat = {};
    Object.keys(changes).forEach(function(key) {
        var fullPath = prefix ? prefix + '.' + key : key;
        var val = changes[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            var childKeys = Object.keys(val);
            var hasNestedObjects = childKeys.some(function(ck) {
                return val[ck] !== null && typeof val[ck] === 'object' && !Array.isArray(val[ck]);
            });
            if (hasNestedObjects) {
                var sub = flattenNestedChanges(val, fullPath);
                Object.keys(sub).forEach(function(sk) { flat[sk] = sub[sk]; });
            } else {
                childKeys.forEach(function(ck) { flat[fullPath + '.' + ck] = val[ck]; });
            }
        } else {
            flat[fullPath] = val;
        }
    });
    return flat;
}

export function parseSTMResponse(llmResponse) {
    var text = String(llmResponse || '').trim();
    if (!text) {
        return { stmEntries: [], stateChanges: {} };
    }

    var stmEntries = [];
    var stateChanges = {};

    var parsed = safeJsonParse(text);
    if (parsed) {
        stmEntries = parsed.stm_entries || [];
        if (parsed.state_changes) {
            if (Array.isArray(parsed.state_changes)) {
                var flat = {};
                parsed.state_changes.forEach(function(item) {
                    if (item && item.path !== undefined) flat[item.path] = item.value;
                });
                stateChanges = isStateSchemaEnabled() ? flat : {};
            } else if (typeof parsed.state_changes === 'object') {
                var nested = isStateSchemaEnabled() ? parsed.state_changes : {};
                stateChanges = flattenNestedChanges(nested);
            }
        }
    } else {
        console.warn('[NE] State LLM response is not valid JSON');
        return { stmEntries: [], stateChanges: {} };
    }

    // 确保每条 entry 有 msgRange、status 和 entities 默认值
    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        if (!e.status) e.status = 'closed';
        if (!e.msgRange || e.msgRange.length !== 2) {
            e.msgRange = [i, i];
        }
        if (e.entities && Array.isArray(e.entities)) {
            e.entities = e.entities.map(function(en) {
                if (typeof en === 'string') return { name: en, type: 'character' };
                return { name: en.name || String(en), type: en.type || 'character' };
            }).filter(function(en) { return en.name; });
        } else if (e.entity && typeof e.entity === 'string') {
            var raw = String(e.entity).trim();
            var names = raw.split(/[,，、\s]+/).filter(Boolean);
            e.entities = names.map(function(n) { return { name: n, type: 'character' }; });
            delete e.entity;
        } else if (!e.entities) {
            e.entities = [];
        }
    }

    return { stmEntries: stmEntries, stateChanges: stateChanges };
}

export function handleQuestCompletion(state, validatedChanges, currentTime) {
    if (!state || !validatedChanges) return;
    currentTime = currentTime || '';
    if (!currentTime) return;

    Object.keys(validatedChanges).forEach(function (path) {
        var parts = path.split('.');
        if (parts.length === 4 && parts[0] === 'quests' && parts[1] === 'tasks' && parts[3] === 'status') {
            var taskName = parts[2];
            if (validatedChanges[path] === '已完成') {
                if (!state.quests) state.quests = {};
                if (!state.quests.tasks) state.quests.tasks = {};
                if (!state.quests.tasks[taskName]) state.quests.tasks[taskName] = {};
                state.quests.tasks[taskName].deadline = currentTime;
            }
        }
    });
}

// ── Cursor prompt builder (delegated to cursor loop) ──

function buildCursorPrompt(windowItems, position, pendingPartials, vault, force) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    // 格式化窗口消息
    var itemsText = windowItems.map(function(item, i) {
        var idx = i;
        var role = item.role || (item.is_user ? 'user' : 'assistant');
        var name = item.name ? item.name + ': ' : '';
        return '[' + idx + '] ' + role + ': ' + name + (item.content || item.mes || '');
    }).join('\n');

    // 当前状态摘要
    var currentStateSnapshot = '';
    if (content.story_time || content.story_scene || content.story_date) {
        currentStateSnapshot = 'story_day: ' + (content.story_time || '') + '\nstory_date: ' + (content.story_date || '') + '\nstory_scene: ' + (content.story_scene || '') + '\n';
    }
    var state = content.state || {};
    var allChars = state.characters ? Object.keys(state.characters) : [];
    if (allChars.length > 0) {
        currentStateSnapshot += '已知角色: ' + allChars.join(', ') + '\n';
    }

    // Partial 上下文
    var partialCtx = '';
    if (pendingPartials && pendingPartials.length > 0) {
        partialCtx = '\n## 上次未完成的事件（需要在本次窗口中继续追踪）：\n';
        pendingPartials.forEach(function(p, i) {
            var rangeStr = (p.msgRange ? p.msgRange.join('-') : '?');
            partialCtx += '  ' + (i + 1) + '. [' + rangeStr + '] (' + (p.event || '') + ') — 第' + (p._partial_generation || 1) + '代 partial\n';
        });
        partialCtx += '如果当前窗口中的消息能闭合上述 partial 事件，请在对应条目中设置 "parent_partial": <事件描述>。\n';
    }

    // 往期上下文 — 为 LLM 提供角色身份参考
    var retrospectiveCtx = '';
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    var sortedSTM = allSTM.filter(function(s) { return s.msgRange && s.msgRange.length === 2; })
        .sort(function(a, b) { return b.msgRange[0] - a.msgRange[0]; });
    var properNameCount = 0;
    windowItems.forEach(function(item) {
        var text = item.content || item.mes || '';
        if (/[\u4e00-\u9fff]{2}/.test(text)) properNameCount++;
    });
    if (sortedSTM.length > 0 && properNameCount < windowItems.length * 0.3) {
        retrospectiveCtx = '\n\n## 往期上下文（供角色身份参考）\n';
        var latestSTM = sortedSTM[0];
        retrospectiveCtx += '上一事件 [msg ' + latestSTM.msgRange.join('-') + ']: ' + (latestSTM.event || '');
        for (var li = 1; li < Math.min(sortedSTM.length, 3); li++) {
            retrospectiveCtx += '\n更早事件 [msg ' + sortedSTM[li].msgRange.join('-') + ']: ' + (sortedSTM[li].event || '');
        }
        retrospectiveCtx += '\n\n上述事件中应包含当前对话涉及的角色名字。请优先使用角色全名。';
        retrospectiveCtx += '若仍无法确认身份，使用 access(msg_id) 追溯原文。\n';
    }

    // BM25 预分组提示
    var preGroupHint = '';
    try {
        var groups = preGroupItems(windowItems, {
            tokenizer: null,
            getText: function(m) { return m.content || ''; },
            similarityThreshold: 0.3
        });
        preGroupHint = formatPreGroupHint(groups);
    } catch(e) {}

    // 语言感知指令
    var instruction = lang === 'en' ?
        (retrospectiveCtx + currentStateSnapshot + 'You are a story memory extractor. Extract key events from these ' + windowItems.length + ' messages.\n\n' +
         'Each entry must have:\n' +
         '- "event" (REQUIRED, 20-80 chars)\n' +
         '- "msgRange": [startIdx, endIdx] (REQUIRED)\n' +
         '- "status": "closed" | "partial" (REQUIRED)\n' +
         '- "entity": optional string — characters/factions involved\n' +
         '- "translation": optional Chinese translation for cross-language search\n' +
         '- "time_label": optional — only if time differs from current\n' +
         '\nNote: "period" and "scene" are auto-filled. Do NOT include them.\n' +
         'Messages must be covered contiguously, no skipping.\n' +
         'If window content is insufficient for a complete event → return status:"partial".') :
        (retrospectiveCtx + currentStateSnapshot + '你是故事记忆提取器。从以下 ' + windowItems.length + ' 条消息中提取关键事件。\n\n' +
         '每个条目包含：\n' +
         '- "event"（必填，20-80字）\n' +
         '- "msgRange": [startIdx, endIdx]（必填）\n' +
         '- "status": "closed" | "partial"（必填）\n' +
         '- "entity": 可选字符串 — 涉及的角色/势力\n' +
         '- "translation": 可选英文翻译，用于跨语言检索\n' +
         '- "time_label": 可选 — 仅当事件时间与当前不同时填写\n' +
         '\n注意："period" 和 "scene" 会自动填充，条目中无需包含。\n' +
         '消息必须连续覆盖，不能跳过。\n' +
         '如果窗口内消息不足以形成完整事件 → 返回 status:"partial"。');

    if (partialCtx) instruction += '\n' + partialCtx;
    if (preGroupHint) instruction += '\n' + preGroupHint;
    if (force) instruction += '\n\n⚠️ 已到达窗口上限，请务必覆盖全部消息，不得跳过任何一条。不允许返回空数组。';

    var userEnding = force
        ? (lang === 'en' ? 'All messages must be covered. Do not skip any.' : '所有消息均须覆盖，禁止跳过。')
        : (lang === 'en' ? 'If nothing significant, return [].' : '如果没有重要事件，返回 []。');
    var userPrompt = lang === 'en' ?
        'IMPORTANT: Always use character proper names in event descriptions. Refer to the known characters and retrospective context above. Never use pronouns (I/he/she) or vague labels ("someone", "unknown girl").\n\nMessages:\n' + itemsText + '\n\nOutput ONLY a JSON array:\n[\n  { "event": "...", "msgRange": [0, 2], "status": "closed"|"partial", "entity": "...", "translation": "...", "parent_partial": null },\n  ...\n]\n' + userEnding :
        '重要：event 中涉及人物时必须使用角色全名。参考上方已知角色列表和往期上下文。禁止使用代词（我/他/她）或模糊指代（某人、无名少女等）。若仍无法确认身份，使用 access(msg_id) 追溯原文。\n\n消息：\n' + itemsText + '\n\n仅输出一个 JSON 数组：\n[\n  { "event": "...", "msgRange": [0, 2], "status": "closed"|"partial", "entity": "...", "translation": "...", "parent_partial": null },\n  ...\n]\n' + userEnding;

    return { system: instruction, user: userPrompt };
}

// ── Hub-Spoke prompt builders ──

function buildRetrospectiveContext(content) {
    var retrospectiveCtx = '';
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    var sortedSTM = allSTM.filter(function(s) { return s.event && s.msgRange && s.msgRange.length === 2; })
        .sort(function(a, b) { return b.msgRange[0] - a.msgRange[0]; });
    if (sortedSTM.length > 0) {
        retrospectiveCtx = '\n\n## 往期事件（供时间、场景、角色参考）\n';
        for (var li = 0; li < Math.min(sortedSTM.length, 3); li++) {
            var stm = sortedSTM[li];
            var label = '\u2500 [msg ' + stm.msgRange.join('-') + ']';
            if (stm.period) label += ' \u00b7 ' + stm.period;
            if (stm.scene) label += ' \u00b7 ' + stm.scene;
            retrospectiveCtx += label + ': ' + (stm.event || '') + '\n';
        }
        retrospectiveCtx += '\n请使用角色全名。往期事件的 period 仅为格式模板（请复用其命名规范），时间可以从对话中线性推进。';
    } else {
        retrospectiveCtx = '\n\n## 时间锚点\n这是故事起始部分，无往期事件可参考。从对话内容和角色卡/世界书中推断时间格式和起始值。';
    }
    return retrospectiveCtx;
}

function buildStateSnapshot(content) {
    var snapshot = '';
    if (content.story_time || content.story_scene || content.story_date) {
        snapshot += 'story_day: ' + (content.story_time || '') + '\nstory_date: ' + (content.story_date || '') + '\nstory_scene: ' + (content.story_scene || '') + '\n';
    }
    var state = content.state || {};
    var allChars = state.characters ? Object.keys(state.characters) : [];
    if (allChars.length > 0) {
        snapshot += '已知角色: ' + allChars.join(', ') + '\n';
    }
    return snapshot;
}

export function buildBatchPrompt(turns, vault) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var retrospectiveCtx = buildRetrospectiveContext(content);

    var turnsText = [];
    for (var ti = 0; ti < turns.length; ti++) {
        var t = turns[ti];
        if (!t) continue;
        turnsText.push('[Turn ' + ti + ']');
        if (t.user) {
            var uname = t.user.name ? t.user.name + ': ' : '';
            turnsText.push('  user: ' + uname + (t.user.content || t.user.mes || ''));
        }
        if (t.assistant) {
            var aname = t.assistant.name ? t.assistant.name + ': ' : '';
            turnsText.push('  assistant: ' + aname + (t.assistant.content || t.assistant.mes || ''));
        }
        turnsText.push('');
    }

    var userText = turnsText.join('\n');
    var maxTurnLabel = turns.length - 1;

    var injectLtmContext = isLtmEnabled(vault);
    var ltmAppend = '';

    if (injectLtmContext) {
        var ltmEntries = content.ltm_entries || [];
        var openLtm = findOpenLtm(vault);
        var closedCatalog = formatLtmCatalog(ltmEntries);

        ltmAppend += '\n\n## 当前进行中的叙事弧（开放 LTM）\n';
        if (openLtm) {
            ltmAppend += 'title: ' + (openLtm.title || '') + '\n';
            ltmAppend += 'event: ' + (openLtm.event || '').substring(0, 200) + '\n';
            ltmAppend += 'period: ' + (openLtm.period || '') + '\n';
            ltmAppend += 'entities: ' + ((openLtm.entities || []).map(function(e) { return e.name; }).join(', ') || '') + '\n';
            ltmAppend += 'stm_refs 数量: ' + ((openLtm.stm_refs || []).length) + '\n';
        } else {
            ltmAppend += '(无)\n';
        }

        ltmAppend += '\n## 最近已闭合的叙事弧\n' + closedCatalog + '\n';

        var newStmEvents = [];
        ltmAppend += '\n## 闭合信号（由系统根据时间、场景、实体计算）\n';
        if (openLtm) {
            var signals = computeClosureSignals(openLtm, newStmEvents);
            if (signals) {
                ltmAppend += '- 时间：' + signals.timeGap + '\n';
                ltmAppend += '- 场景：' + (signals.openScene || '?') + ' → ' + (signals.newScene || '?') + (signals.sceneChange ? '（切换）' : '（仍在同一场景）') + '\n';
                ltmAppend += '- 实体重叠：' + signals.entityDetail + '\n';
                ltmAppend += '综合信号：' + signals.signalSummary + '\n';
            }
        } else {
            ltmAppend += '无开放 LTM，若本轮有新事件出现，即为新叙事弧的开始。\n';
        }

        ltmAppend += '\n## 判断标准\n';
        ltmAppend += 'append（追加到当前弧）：当新事件与当前弧在叙事上连续 —— 时间在同一日或紧邻的时区、场景在附近区域或同一活动范围内、至少一个核心角色仍在场。该事件是同一故事线的新发展，而非新故事的开始。\n';
        ltmAppend += 'close_and_new（闭合+开启新弧）：叙事弧已自然终结。下列任一条件成立时选用：时间跨日或出现大段空白 / 场景发生根本性变化 / 所有核心角色离场且新角色登场 / 事件本身是明确的终结点（道别、离开、任务完成、夜晚就寝）。满足时闭合当前 LTM，用本轮事件开启新弧。\n';
        ltmAppend += 'skip（跳过）：本轮事件是短暂的过渡性内容。该事件留在"待处理"区，不追加到任何 LTM。如果没有 open LTM，不使用 skip。\n';

        if (lang === 'en') {
            ltmAppend += '\nIn addition to events, output an ltm_decision field:\n{\n  "ltm_decision": {\n    "action": "append" | "close_and_new" | "skip",\n    "updated_title": "updated arc label (15-40 chars, only for append/close_and_new)",\n    "updated_event": "updated arc summary (80-140 chars, only for append/close_and_new)"\n  }\n}\n';
        } else {
            ltmAppend += '\n在输出 events 的同时，输出 ltm_decision 字段：\n{\n  "ltm_decision": {\n    "action": "append" | "close_and_new" | "skip",\n    "updated_title": "更新后的弧标签（15-40字，仅 append/close_and_new 时输出）",\n    "updated_event": "更新后的弧摘要（80-140字，仅 append/close_and_new 时输出）"\n  }\n}\n';
        }
    }

    var system = lang === 'en' ?
        (retrospectiveCtx + '\nYou are a story memory extractor. Create one event entry for every continuous plot segment in the dialog below. All turns must be covered — no omissions.\n\nOutput JSON with this schema:\n{\n  "analysis": "Your step-by-step reasoning about the events (free text, will be ignored for extraction)",\n  "events": [\n    {\n      "event": "one-sentence description (20-160 chars, use proper names, no pronouns)",\n      "period": "inferred time. If multiple time formats appear (e.g. both Day 1 and 2024-05-22 07:20), pick the MOST PRECISE one — datetime > date > ordinal day > vague period. Use same format as prior events. If unsure: \\"-\\"",\n      "scene": "inferred scene. If unsure: \\"-\\"",\n      "turns": "turn range like 0-3, 4-5. Max turn is ' + maxTurnLabel + '"\n    }\n  ]\n}\n\nRules:\n- Cover ALL turns from 0 to ' + maxTurnLabel + '. No gaps.\n- Events partition the turns with NO overlap. If event A covers 0-2, event B must start at 3.\n- Do NOT create events for turns beyond ' + maxTurnLabel + '.\n- If a turn is continuous with the preceding content and does not form an independent scene, merge it into the adjacent event.\n- Within this batch, later events must not duplicate earlier ones.\n- Use character proper names only. No pronouns.\n- If no valid events can be extracted, set events to empty array [].' + ltmAppend) :
        (retrospectiveCtx + '\n你是故事记忆提取器。为下列对话中每一段连续剧情生成一个事件条目。必须覆盖全部 turn，不得遗漏。\n\n输出 JSON，schema 如下：\n{\n  "analysis": "你的逐步推理（自由文本，不会用于提取）",\n  "events": [\n    {\n      "event": "一句话事件描述（20-160字，使用角色全名，禁止代词）",\n      "period": "推断的时间。如果消息中同时出现多种时间格式（如第1天和2024-05-22 07:20），请选择最精确的表达——具体日期+时刻 > 具体日期 > 第N天 > 泛化时段。必须使用与往期事件相同的格式。若无法判断：\\"-\\"",\n      "scene": "推断的场景。若无法判断：\\"-\\"",\n      "turns": "turn 范围如 0-3, 4-5。最大 turn 为 ' + maxTurnLabel + '"\n    }\n  ]\n}\n\n规则：\n- 必须覆盖 0~' + maxTurnLabel + ' 的所有 turns，不能留空。\n- 事件之间互不重叠。若事件 A 覆盖 0-2，事件 B 必须从 3 开始。\n- 禁止为超出 ' + maxTurnLabel + ' 的 turn 创建事件。\n- 如果某 turn 内容与前文连续且不构成独立剧情，必须并入相邻事件。\n- 同一批次内，后文事件不能与前文事件重复。往期事件只作为时间格式参考。\n- 使用角色全名，禁止代词。\n- 如果无法提取有效事件，将 events 设为空数组 []。' + ltmAppend);

    return { system: system, user: userText };
}

export function buildStmOnlyPrompt(turns, vault) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var retrospectiveCtx = buildRetrospectiveContext(content);

    var turnsText = [];
    for (var ti = 0; ti < turns.length; ti++) {
        var t = turns[ti];
        if (!t) continue;
        turnsText.push('[Turn ' + ti + ']');
        if (t.user) {
            var uname = t.user.name ? t.user.name + ': ' : '';
            turnsText.push('  user: ' + uname + (t.user.content || t.user.mes || ''));
        }
        if (t.assistant) {
            var aname = t.assistant.name ? t.assistant.name + ': ' : '';
            turnsText.push('  assistant: ' + aname + (t.assistant.content || t.assistant.mes || ''));
        }
        turnsText.push('');
    }

    var userText = turnsText.join('\n');
    var maxTurnLabel = turns.length - 1;

    var system = lang === 'en' ?
        (retrospectiveCtx + '\nYou are a story memory extractor. Create one event entry for every continuous plot segment in the dialog below. All turns must be covered — no omissions.\n\nOutput JSON with this schema:\n{\n  "analysis": "Your step-by-step reasoning about the events (free text, will be ignored for extraction)",\n  "events": [\n    {\n      "event": "one-sentence description (10-160 chars, use proper names, no pronouns)",\n      "period": "inferred time. If multiple time formats appear, pick the MOST PRECISE one — datetime > date > ordinal day > vague period. Use same format as prior events as a template. Unsure: \\"-\\"",\n      "scene": "inferred scene. Unsure: \\"-\\"",\n      "turns": "turn range like 0-3, 4-5. Max turn is ' + maxTurnLabel + '"\n    }\n  ]\n}\n\nWhen to start a NEW event (any ONE condition met):\n1. Time clearly shifts (implied or stated in dialog)\n2. Scene/location changes\n3. A character enters or leaves\n4. Plot goal or action arc changes direction\nIf NONE of these change, adjacent turns MUST be merged into one event.\n\nRules:\n- Cover ALL turns from 0 to ' + maxTurnLabel + '. No gaps.\n- Events partition the turns with NO overlap. If event A covers 0-2, event B must start at 3.\n- Do NOT create events for turns beyond ' + maxTurnLabel + '.\n- Within this batch, later events must not duplicate earlier ones.\n- Use character proper names only. No pronouns.\n- Trivial turns (greetings, acknowledgments, filler) merge into the nearest meaningful event. Do NOT fabricate events for them.\n- If the entire batch has no plot content, set events to empty array [].') :
        (retrospectiveCtx + '\n你是故事记忆提取器。为下列对话中每一段连续剧情生成一个事件条目。必须覆盖全部 turn，不得遗漏。\n\n输出 JSON，schema 如下：\n{\n  "analysis": "你的逐步推理（自由文本，不会用于提取）",\n  "events": [\n    {\n      "event": "一句话事件描述（10-160字，使用角色全名，禁止代词）",\n      "period": "推断的时间。如果消息中同时出现多种时间格式，请选择最精确的表达——具体日期+时刻 > 具体日期 > 第N天 > 泛化时段。往期事件的 period 仅为格式模板——请复用其命名规范。若无法判断：\\"-\\"",\n      "scene": "推断的场景。若无法判断：\\"-\\"",\n      "turns": "turn 范围如 0-3, 4-5。最大 turn 为 ' + maxTurnLabel + '"\n    }\n  ]\n}\n\n新事件的判断标准（满足任意一项即构成新事件）：\n1. 时间有明显推移（对话中暗示或明示）\n2. 场景位置改变\n3. 有新角色入场或旧角色离场\n4. 剧情目标或行动发生转折\n如果以上条件全部未变，相邻 turn 必须合并为一个事件。\n\n规则：\n- 必须覆盖 0~' + maxTurnLabel + ' 的所有 turns，不能留空。\n- 事件之间互不重叠。若事件 A 覆盖 0-2，事件 B 必须从 3 开始。\n- 禁止为超出 ' + maxTurnLabel + ' 的 turn 创建事件。\n- 同一批次内，后文事件不能与前文事件重复。往期事件只作为时间格式参考。\n- 使用角色全名，禁止代词。\n- 琐碎内容（问候、应答、语气词）直接并入最近的有意义事件，不要为其硬编事件。\n- 如果整个 batch 都没有可提取的有效事件，将 events 设为空数组 []。');

    return { system: system, user: userText };
}

function computeTurnBoundarySignals(turns) {
    if (!turns || turns.length < 2) return [];

    var signals = [];
    for (var i = 0; i < turns.length - 1; i++) {
        var tA = turns[i];
        var tB = turns[i + 1];
        var textA = (tA.user ? (tA.user.content || tA.user.mes || '') : '') + ' '
            + (tA.assistant ? (tA.assistant.content || tA.assistant.mes || '') : '');
        var textB = (tB.user ? (tB.user.content || tB.user.mes || '') : '') + ' '
            + (tB.assistant ? (tB.assistant.content || tB.assistant.mes || '') : '');

        var overlap = vocabularyOverlap(textA, textB);

        var msgGap = tB.msgStart - tA.msgEnd;
        var absGap = (tB.msgStart !== undefined && tA.msgEnd !== undefined)
            ? tB.msgStart - tA.msgEnd : 0;

        var charA_user = (tA.user && tA.user.name) || '';
        var charA_asst = (tA.assistant && tA.assistant.name) || '';
        var charB_user = (tB.user && tB.user.name) || '';
        var charB_asst = (tB.assistant && tB.assistant.name) || '';
        var sameChar = (charA_user === charB_user && charA_asst === charB_asst);

        var totalLen = textA.length + textB.length;
        var isFiller = totalLen < 30;

        signals.push({
            overlay: overlap,
            msgGap: msgGap,
            absGap: absGap,
            sameChar: sameChar,
            isFiller: isFiller
        });
    }
    return signals;
}

var L1_CUT = 'L1_CUT';
var L2_CUT = 'L2_CUT';
var L2_KEEP = 'L2_KEEP';
var L3_ASK = 'L3_ASK';

function classifyBoundary(signal) {
    if (signal.absGap > 20) return L1_CUT;
    if (!signal.sameChar) return L1_CUT;
    if (signal.isFiller) return L2_KEEP;
    if (signal.overlay >= 0.5) return L2_KEEP;
    if (signal.overlay <= 0.1) return L2_CUT;
    return L3_ASK;
}

async function askBoundaryJudge(turnA, turnB, signal, vault) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var textA = formatTurnsText([turnA], [0]);
    var textB = formatTurnsText([turnB], [0]);

    var ctx = '';
    ctx += '## 系统预判\n';
    ctx += '词汇重叠率：' + (signal.overlay * 100).toFixed(0) + '%\n';
    ctx += '消息间隔：' + signal.msgGap + ' 条\n';

    ctx += '\n## Turn A\n' + textA;
    ctx += '\n## Turn B\n' + textB;

    ctx += '\n只回答 yes 或 no：Turn A 和 Turn B 之间存在事件边界吗？';

    var system = lang === 'en'
        ? 'You are a story event boundary judge. Given two adjacent turns and pre-computed signals, determine if there is an event boundary between them.\n\nAnswer ONLY "yes" or "no".'
        : '你是故事事件边界裁判。根据相邻两轮对话和预计算信号，判断它们之间是否存在事件边界。\n\n只回答 yes 或 no。';

    try {
        var response = await callMemoryPipeline([
            { role: 'system', content: system },
            { role: 'user', content: ctx }
        ], { operation: 'stm_boundary' }, vault.id);

        var trimmed = (response || '').trim().toLowerCase();
        if (trimmed === 'yes' || trimmed === '是') return true;
        if (trimmed === 'no' || trimmed === '否') return false;
        if (trimmed.indexOf('yes') !== -1 || trimmed.indexOf('是') !== -1) return true;
        return false;
    } catch (e) {
        console.warn('[NE] Boundary judge LLM failed:', e);
        return false;
    }
}

async function segmentTurns(turns, vault, callLLM) {
    if (!turns || turns.length === 0) return [];

    var signals = computeTurnBoundarySignals(turns);

    var cuts = [];
    for (var i = 0; i < turns.length - 1; i++) {
        var cls = classifyBoundary(signals[i]);
        if (cls === L1_CUT || cls === L2_CUT) {
            cuts[i] = true;
        } else if (cls === L2_KEEP) {
            cuts[i] = false;
        } else {
            var result = await askBoundaryJudge(turns[i], turns[i + 1], signals[i], vault);
            cuts[i] = result === true;
        }
    }

    var segments = [];
    var segStart = 0;
    for (var i = 0; i < turns.length; i++) {
        if (i === turns.length - 1 || cuts[i]) {
            segments.push([segStart, i]);
            segStart = i + 1;
        }
    }
    return segments;
}

function buildStmSummaryPrompt(segments, turns, vault) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var segmentsText = '共有 ' + segments.length + ' 个区间——你必须输出恰好 ' + segments.length + ' 条事件。\n';
    for (var si = 0; si < segments.length; si++) {
        var seg = segments[si];
        var segTurns = [];
        for (var ti = seg[0]; ti <= seg[1]; ti++) segTurns.push(ti);
        segmentsText += '\n--- 区间 ' + si + ' (Turn ' + seg[0] + '-' + seg[1] + ') ---\n';
        segmentsText += formatTurnsText(turns, segTurns);
        segmentsText += '\n';
    }

    if (vault.content.story_date || vault.content.story_time || vault.content.story_scene) {
        segmentsText += '\n## 当前故事状态\n';
        if (vault.content.story_date) segmentsText += '天数: ' + vault.content.story_date + '\n';
        if (vault.content.story_time) segmentsText += '时间: ' + vault.content.story_time + '\n';
        if (vault.content.story_scene) segmentsText += '场景: ' + vault.content.story_scene + '\n';
        segmentsText += '\n';
    }

    var system = lang === 'en'
        ? 'You are a story memory extractor.\n\nOutput JSON:\n{\n  "events": [\n    {\n      "event": "one-sentence description (10-160 chars, use proper names, no pronouns)",\n      "period": "inferred time. If multiple time formats appear, pick the MOST PRECISE one — datetime > date > ordinal day > vague period. Use same format as prior events. Unsure: \\"-\\"",\n      "scene": "inferred scene. Unsure: \\"-\\""\n    }\n  ]\n}\n\nRules:\n- The events array must have exactly as many entries as there are segments. Segment 0 = events[0], segment 1 = events[1], etc. Do not split a segment into multiple events. Do not add extra events.\n- Use character proper names only. No pronouns.\n- Content-heavy segments: still summarize into one event.'
        : '你是故事记忆提取器。\n\n输出 JSON：\n{\n  "events": [\n    {\n      "event": "一句话事件描述（10-160字，使用角色全名，禁止代词）",\n      "period": "推断的时间。如果消息中同时出现多种时间格式，请选择最精确的表达——具体日期+时刻 > 具体日期 > 第N天 > 泛化时段。参考往期事件的命名规范。若无法判断：\\"-\\"",\n      "scene": "推断的场景。若无法判断：\\"-\\""\n    }\n  ]\n}\n\n规则：\n- events 数组长度必须等于区间数。区间 0 = events[0]、区间 1 = events[1]……严禁拆分区间或增加额外事件。\n- 使用角色全名，禁止代词。\n- 内容较多的区间：仍只输出一条事件来概括。';

    return { system: system, user: segmentsText };
}

function buildLtmDecisionPrompt(vault, newStmEntries) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var ltmEntries = content.ltm_entries || [];
    var openLtm = findOpenLtm(vault);
    var closedCatalog = formatLtmCatalog(ltmEntries);

    var ltmCtx = '';

    ltmCtx += '\n\n## 当前进行中的叙事弧（开放 LTM）\n';
    if (openLtm) {
        ltmCtx += 'title: ' + (openLtm.title || '') + '\n';
        ltmCtx += 'event: ' + (openLtm.event || '').substring(0, 200) + '\n';
        ltmCtx += 'period: ' + (openLtm.period || '') + '\n';
        ltmCtx += 'entities: ' + ((openLtm.entities || []).map(function(e) { return e.name; }).join(', ') || '') + '\n';
        ltmCtx += 'stm_refs 数量: ' + ((openLtm.stm_refs || []).length) + '\n';
    } else {
        ltmCtx += '(无)\n';
    }

    ltmCtx += '\n## 最近已闭合的叙事弧\n' + closedCatalog + '\n';

    ltmCtx += '\n## 闭合信号（系统预计算，供参考）\n';
    if (openLtm) {
        var signals = computeClosureSignals(openLtm, []);
        if (signals) {
            ltmCtx += '- 时间：' + signals.timeGap + '\n';
            ltmCtx += '- 场景：' + (signals.openScene || '?') + ' → ' + (signals.newScene || '?') + (signals.sceneChange ? '（切换）' : '（仍在同一场景）') + '\n';
            ltmCtx += '- 实体重叠：' + signals.entityDetail + '\n';
            ltmCtx += '系统建议：' + signals.signalSummary + '\n';
            ltmCtx += '\n你的角色：核实系统信号是否与事件内容一致。仅在以下情况偏离：\n';
            ltmCtx += '- 新事件内容与信号明显矛盾（如系统建议 close，但新事件是同一场景的延续）\n';
            ltmCtx += '- 弧的叙事目标在新事件中明确终结\n';
        }
    } else {
        ltmCtx += '无开放 LTM，若本轮有新事件出现，即为新叙事弧的开始。\n';
    }

    ltmCtx += '\n## 新入库的 STM 事件\n';
    for (var si = 0; si < newStmEntries.length; si++) {
        var s = newStmEntries[si];
        ltmCtx += '- ' + (s.id || '?') + ': ' + (s.event || '') + '\n';
        if (s.period) ltmCtx += '  时间: ' + s.period + '\n';
        if (s.scene) ltmCtx += '  场景: ' + s.scene + '\n';
    }

    ltmCtx += '\n## 判断标准\n';
    ltmCtx += 'append（追加到当前弧）：当新事件与当前弧在叙事上连续 —— 时间在同一日或紧邻的时区、场景在附近区域或同一活动范围内、至少一个核心角色仍在场。';
    ltmCtx += 'updated_event 应保留旧摘要的核心信息，仅追加新事件带来的增量变化——不要重写。\n';
    ltmCtx += 'close_and_new（闭合+开启新弧）：叙事弧已自然终结。时间跨日 / 场景根本性变化 / 核心角色离场 / 事件本身是明确终结点。若新事件与当前弧无明显关联，也应闭合并开启新弧。\n';

    if (lang === 'en') {
        ltmCtx += '\nOutput JSON with ltm_decision field:\n{\n  "ltm_decision": {\n    "action": "append" | "close_and_new",\n    "updated_title": "required (15-40 chars)",\n    "updated_event": "required (80-140 chars)"\n  }\n}\n' +
            'updated_event should preserve prior summary core info — only add incremental changes.\n';
        return {
            system: 'You are a narrative arc manager. Given the current arc state and newly extracted story events, decide how to update the arcs.\n\n' +
                'Only output valid JSON with the ltm_decision field — no surrounding text.\n\n' + ltmCtx,
            user: 'Based on the arc state and new STM events above, output the ltm_decision.'
        };
    }
    ltmCtx += '\n输出 JSON，包含 ltm_decision 字段：\n{\n  "ltm_decision": {\n    "action": "append" | "close_and_new",\n    "updated_title": "必填（15-40字）",\n    "updated_event": "必填（80-140字）"\n  }\n}\n' +
        'updated_event 保留旧摘要核心信息，仅追加增量——不要重写。';
    return {
        system: '你是叙事弧管理者。根据当前弧状态和新提取的故事事件，决定如何更新叙事弧。\n\n' +
            '只输出包含 ltm_decision 字段的有效 JSON，不要输出任何其他文字。\n\n' + ltmCtx,
        user: '根据上述弧状态和新 STM 事件，输出 ltm_decision。'
    };
}

export async function runLtmDecision(vault, newStmIds, callMemoryPipeline) {
    var allSTM = (vault.content.unconsolidated_stm || []).concat(vault.content.stm_entries || []);
    var newStmEntries = newStmIds.map(function(id) { return allSTM.find(function(s) { return s.id === id; }); }).filter(Boolean);
    if (newStmEntries.length === 0) return null;

    var prompt = buildLtmDecisionPrompt(vault, newStmEntries);
    var responseText = '';
    try {
        responseText = await callMemoryPipeline([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ], { operation: 'ltm_decision' }, vault.id);
    } catch (e) {
        console.warn('[NE] LTM decision LLM failed:', e.message);
        return null;
    }

    if (!responseText || !responseText.trim()) {
        console.warn('[NE] LTM decision LLM returned empty response');
        return null;
    }

    var parsed = safeJsonParse(responseText);
    if (parsed) {
        var result = parsed.ltm_decision || null;
        if (result && result.updated_event) {
            _validateLtmEventText('ltm_decision', result.updated_event);
        }
        return result;
    }
    console.warn('[NE] LTM decision LLM returned non-JSON response');
    return null;
}

// ── State prompt builders（每种模式专用 prompt）──

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

function findNewCharacterNames(vault) {
    var state = (vault && vault.content && vault.content.state) || {};
    var chars = state.characters || {};
    var staticFields = ['gender_age', 'occupation', 'personality', 'clothing_build'];
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

function buildWorldBookSection(vault, names) {
    try {
        if (!names || names.length === 0) return '';
        var worldInfo = runtime.getWorldInfo();
        if (!worldInfo || !worldInfo.entries || Object.keys(worldInfo.entries).length === 0) return '';

        var nameSet = {};
        names.forEach(function(n) { nameSet[n] = true; });

        var lines = [];
        var entryKeys = Object.keys(worldInfo.entries);
        for (var j = 0; j < entryKeys.length; j++) {
            var entry = worldInfo.entries[entryKeys[j]];
            if (!entry || !entry.content) continue;
            if (entry.disable) continue;
            var contentLower = (entry.content || '').toLowerCase();
            var matchesName = Object.keys(nameSet).some(function(n) { return contentLower.indexOf(n.toLowerCase()) !== -1; });
            if (!matchesName) continue;
            var entryKeysArr = entry.key || [];
            var label = entryKeysArr.length > 0 ? entryKeysArr[0] : entryKeys[j];
            lines.push('[' + label + '] ' + entry.content);
        }
        if (lines.length === 0) return '';
        return '\n## World Book — new character profiles\n' + lines.join('\n') + '\n';
    } catch (e) {
        console.warn('[NE] buildWorldBookSection failed:', e && e.message);
    }
    return '';
}

function buildStatePrompt_Preset(messages, vault) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var msgTexts = messages.map(function(m, i) {
        var role = m.role === 'user' ? 'User' : 'Character';
        var name = m.name ? m.name + ': ' : '';
        return '[' + i + '] [' + role + '] ' + name + (m.content || '');
    }).join('\n\n');

    var stateTable = buildStateInjectionTable(content.state || {}, messages, undefined, content);

    var rulesEn = '\n## Your responsibility\n' +
        '- You manage: gender_age, occupation, personality, clothing_build, status, injuries, status_effects, relationship, past_experience.\n' +
        '- Do NOT manage: affection, current_mood, inner_thoughts. These are handled by the main LLM and should never appear in your state_changes output.\n' +
        '\n## Filling unfilled fields\n' +
        '- Character Cards (above) are your primary source. Directly extract: gender_age, occupation, personality, clothing_build from the card text.\n' +
        '- If the Character Cards describe it explicitly, fill it — do NOT wait for dialogue to mention it.\n' +
        '- For fields not covered by Character Cards, infer from dialogue.\n' +
        '- past_experience: incremental — append new content, do NOT overwrite existing.\n' +
        '\n## Updating existing fields\n' +
        '- Field already has a value → Only output if this round\'s dialogue changes that value.\n' +
        '- Allowed paths are shown in the Current State table above. Do NOT invent new paths.\n' +
        '- Do NOT output present_characters (auto-generated).\n' +
        '- status: 活跃/非活跃/已死亡/已归隐/已离去. Mention≠presence.\n' +
        '\n## NPC Scheme Assignment\n' +
        '- NPCs already have a _scheme field — do NOT change it.\n' +
        '- New NPCs without _scheme: infer from traits (see "NPC Schemes Available" above).\n' +
        '- To assign: include `characters.<name>._scheme` in state_changes.\n' +
        '- Use "default" scheme if unsure.\n' +
        '\nZero-change example: {"state_changes":{}}\n\n';

    var rulesZh = '\n## 你的职责\n' +
        '- 你管理: gender_age, occupation, personality, clothing_build, status, injuries, status_effects, relationship, past_experience。\n' +
        '- 不要管理: affection, current_mood, inner_thoughts。这些由主 LLM 负责，绝不应该出现在你的 state_changes 输出中。\n' +
        '\n## 填充未填字段\n' +
        '- Character Cards（上方）是你的首要信息来源。直接从角色卡文本中提取 gender_age、occupation、personality、clothing_build。\n' +
        '- 角色卡明确描述的内容直接填入，不需要等对话提及。\n' +
        '- 角色卡没有覆盖的字段，再从本轮对话中推断。\n' +
        '- past_experience: 增量追加 → 仅追加新内容，不要覆盖已有内容。\n' +
        '\n## 更新已有字段\n' +
        '- 字段已有具体值 → 仅在本轮对话导致该值变化时输出。\n' +
        '- 可用路径见上方 Current State 表格。请勿创造新路径。\n' +
        '- 不要输出 present_characters（自动生成）。\n' +
        '- status: 活跃/非活跃/已死亡/已归隐/已离去。提及≠在场。\n' +
        '\n## NPC 方案分配\n' +
        '- 已有 _scheme 的 NPC — 不要修改其 _scheme 值。\n' +
        '- 新 NPC 没有 _scheme 时：从上方的「NPC Schemes Available」中选择合适的方案。\n' +
        '- 分配方案时在 state_changes 中包含 `characters.<name>._scheme`。\n' +
        '- 如果无法确定，使用 "default" 方案。\n' +
        '\n零变化示例: {"state_changes":{}}\n\n';

    var newNames = findNewCharacterNames(vault);
    var worldBook = newNames.length > 0 ? buildWorldBookSection(vault, newNames) : '';

    if (lang === 'en') {
        var newCharHintEn = '';
        if (newNames.length > 0) {
            if (worldBook) {
                newCharHintEn = '\n## New Characters\n' +
                    '- Appearing for the first time: ' + newNames.join(', ') + '.\n' +
                    '- Their fields are empty. Use the World Book entry above to fill gender_age, occupation, personality, clothing_build.\n';
            } else {
                newCharHintEn = '\n## New Characters\n' +
                    '- Appearing for the first time: ' + newNames.join(', ') + '.\n' +
                    '- Their fields are empty. Use Character Cards above to fill gender_age, occupation, personality, clothing_build.\n';
            }
        }
        return {
            system: stateTable + buildCharacterCardSection(vault) + worldBook + newCharHintEn + rulesEn,
            user: 'Recent messages:\n\n' + msgTexts + '\n\nOutput JSON with state_changes. Fill unfilled fields from Character Cards and World Book context above, then dialogue.'
        };
    }
    var newCharHintZh = '';
    if (newNames.length > 0) {
        if (worldBook) {
            newCharHintZh = '\n## 新角色\n' +
                '- 以下角色首次出场：' + newNames.join(', ') + '。\n' +
                '- 其字段为空。请使用上方的 World Book 条目填充 gender_age、occupation、personality、clothing_build。\n';
        } else {
            newCharHintZh = '\n## 新角色\n' +
                '- 以下角色首次出场：' + newNames.join(', ') + '。\n' +
                '- 其字段为空。请使用上方的角色卡填充 gender_age、occupation、personality、clothing_build。\n';
        }
    }
    return {
        system: stateTable + buildCharacterCardSection(vault) + worldBook + newCharHintZh + rulesZh,
        user: '最近的对话消息：\n\n' + msgTexts + '\n\n输出包含 state_changes 的 JSON。参考上方的角色卡和世界书上下文填充未填字段，无法覆盖的再从对话推断。'
    };
}

/**
 * autoDecayStaleCharacters — 安全网：LLM 未标记非活跃时，代码层兜底
 * 对每个 status='活跃' 的角色检查是否出现在最新消息中，不在场的削为 非活跃
 */
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

export async function executeIncrementalUpdate(chatId, newMessages, force, onProgress) {
    console.log('[NE-DIAG] executeIncrementalUpdate ENTER — msgCount=' + (newMessages ? newMessages.length : 0) + ', force=' + !!force);
    const vault = await read(chatId);

    // 给消息打绝对位置标记——使用消息在原始 chat 中的位置 (m.id) 而非 batch 循环下标
    // m.id 在 processHistory 中设为原始 chat idx，在 onMessageSent/Received 中设为 ST 的 messageIndex
    // 两者均为消息在完整 chat 数组中的位置，跨 run 一致
    for (var mi = 0; mi < newMessages.length; mi++) { newMessages[mi]._absIdx = (newMessages[mi].id !== undefined) ? Number(newMessages[mi].id) : mi; }

    var processedIds = collectAllMsgIds(vault);
    console.log('[NE-DIAG] executeIncrementalUpdate INNER — received ' + newMessages.length + ' messages, ids: [' + newMessages.map(function(m){return m.id;}).join(',') + '], processedIds.size=' + processedIds.size);
    var filteredMessages = filterNewMessages(newMessages, processedIds);
    console.log('[NE-DIAG] executeIncrementalUpdate — after filter: ' + filteredMessages.length + ' messages');
    if (filteredMessages.length !== newMessages.length) {
        var filteredIds = newMessages.filter(function(m){ return filteredMessages.indexOf(m) === -1; }).map(function(m){return m.id;});
        console.log('[NE-DIAG] executeIncrementalUpdate — filtered OUT msg ids:', filteredIds.join(','));
    }
    if (filteredMessages.length === 0 && !force) {
        console.log('[NE-DIAG] executeIncrementalUpdate EXIT EARLY — no messages to process');
        return { vault: vault, added: 0 };
    }

    transitionTo('stm');

    console.log('[NE] STM pipeline starting — messages=' + filteredMessages.length);
    var cursorResult = { vault: vault, totalAdded: 0 };
    var newEntries = [];
    try {
        var turns = groupMessagesIntoTurns(filteredMessages);
        var segments = await segmentTurns(turns, vault, callMemoryPipeline);

        var events = [];

        if (segments.length > 0) {
            var summaryPrompt = buildStmSummaryPrompt(segments, turns, vault);
            var responseText = '';
            try {
                responseText = await callMemoryPipeline([
                    { role: 'system', content: summaryPrompt.system },
                    { role: 'user', content: summaryPrompt.user }
                ], { operation: 'stm_extract' }, chatId);
            } catch (e) {
                console.warn('[NE] Summary LLM failed:', e);
            }

            if (responseText) {
                var summaryParsed = safeJsonParse(responseText);
                if (summaryParsed) events = summaryParsed.events || [];
            }

            var snapshots = vault.content._state_snapshots;
            for (var ei = 0; ei < Math.min(events.length, segments.length); ei++) {
                var seg = segments[ei];
                var turnIndices = [];
                for (var ti = seg[0]; ti <= seg[1]; ti++) turnIndices.push(ti);
                var msgIds = collectMsgIdsFromTurns(turns, turnIndices);
                events[ei].msg_ids = msgIds;
                events[ei].absMsgStart = turns[seg[0]].msgStart;
                events[ei].absMsgEnd = turns[seg[1]].msgEnd;
                events[ei].msgRange = [turns[seg[0]].msgStart, turns[seg[1]].msgEnd];
                events[ei].status = 'closed';

                var segmentMsgStart = turns[seg[0]].msgStart;
                var periodSnap = resolvePeriodFromSnapshots(segmentMsgStart, snapshots);
                if (periodSnap) {
                    if (!events[ei].period || events[ei].period === '-' || events[ei].period === '') {
                        events[ei].period = periodSnap.time;
                    }
                    if (!events[ei].scene || events[ei].scene === '-' || events[ei].scene === '') {
                        events[ei].scene = periodSnap.scene;
                    }
                }
            }

            var beforeFilter = events.length;
            events = events.filter(function(e) { return e.msg_ids && e.msg_ids.length > 0; });
            if (beforeFilter !== events.length) {
                console.log('[NE-HARNESS] STM events filtered — before=' + beforeFilter + ' after=' + events.length + ' (dropped ' + (beforeFilter - events.length) + ' without msg_ids)');
            }

            var beforeTextFilter = events.length;
            events = events.filter(function(e) { return e.event && String(e.event).length >= 3; });
            if (beforeTextFilter !== events.length) {
                console.log('[NE-HARNESS] STM events text-filtered — before=' + beforeTextFilter + ' after=' + events.length + ' (dropped ' + (beforeTextFilter - events.length) + ' with short/empty event)');
            }

            if (events.length >= 2) {
                events.sort(function(a, b) {
                    return (a.msgRange ? a.msgRange[0] : 999999) - (b.msgRange ? b.msgRange[0] : 999999);
                });
                for (var di = 0; di < events.length - 1; di++) {
                    var curEnd = events[di].msgRange ? events[di].msgRange[1] : -1;
                    var nxtStart = events[di + 1].msgRange ? events[di + 1].msgRange[0] : -1;
                    if (nxtStart <= curEnd && curEnd >= 0) {
                        console.log('[NE-HARNESS] STM msgRange overlap/gap — events[' + di + '] end=' + curEnd + ' events[' + (di + 1) + '] start=' + nxtStart);
                    }
                }
            }

            if (events.length > 0) {
                postFillSTM({ stmEntries: events, stateChanges: {} }, vault);
                appendSTMEntries(vault, events);

                if (snapshots && snapshots.length > 0) {
                    var minProcessedMsgIdx = events.reduce(function(acc, e) {
                        return e.absMsgStart != null ? Math.min(acc, e.absMsgStart) : acc;
                    }, Infinity);
                    vault.content._state_snapshots = snapshots.filter(function(s) {
                        return s.msgIdx >= minProcessedMsgIdx;
                    });
                }
            }
        }

        cursorResult.totalAdded = events.length;
        newEntries = events;

        // Persist
        if (events.length > 0) {
            vault._meta = vault._meta || {};
            vault._meta.last_pipeline_task = 'stm_extract';
            vault._meta.last_pipeline_time = new Date().toISOString();
            try { await saveVaultWithSnapshot(chatId, vault); } catch (e) { console.warn('[NE] STM save failed:', e); }

            recordTelemetry({
                pipeline_task: 'stm_extract',
                new_stm_count: events.length,
                parse_error: null
            }, chatId);
        }

        globalThis.__ne_debug_last_stm_events = {
            events: events.map(function(e) { return { id: e.id, content: (e.event || '').substring(0, 200) }; }),
            count: events.length,
            time: new Date().toISOString()
        };
    } catch (e) {
        console.warn('[NE] STM pipeline failed:', e);
    }

    return { vault: vault, added: newEntries.length };
}

// ── NPC 方案发现 ──

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
                    personaDescription: '',
                    characterDescription: '',
                    characterPersonality: '',
                    characterDepthPrompt: '',
                    scenario: '',
                    creatorNotes: '',
                    trigger: 'normal'
                };
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

function buildSchemeDiscoveryPrompt(worldBookEntries, messages) {
    var wbText = '';
    if (worldBookEntries && worldBookEntries.length > 0) {
        wbText = '## World Setting\n';
        worldBookEntries.forEach(function(entry, i) {
            wbText += '[' + (i + 1) + '] ' + (entry.content || entry.key || '') + '\n';
        });
    }

    var msgText = '';
    if (messages && messages.length > 0) {
        msgText = '\n## Current Dialogue\n';
        messages.forEach(function(m) {
            msgText += (m.name || m.role || '') + ': ' + (m.content || '') + '\n';
        });
    }

    return '' +
        wbText +
        msgText +
        '\n## Task\n' +
        'Based on the world setting and dialogue above, determine:\n' +
        '1. What NPC character tracking schemes are needed (1-3 schemes)\n' +
        '2. Identify all characters mentioned (protagonist + NPCs)\n' +
        '\nAvailable field names for schemes:\n' +
        '  status, gender_age, occupation, personality, clothing_build,\n' +
        '  injuries, status_effects, past_experience, inner_thoughts,\n' +
        '  affection, relationship, current_mood\n' +
        '\nRules:\n' +
        '- Every scheme MUST include "status"\n' +
        '- "default" scheme is mandatory (catch-all)\n' +
        '- Field names MUST be from the available list\n' +
        '- required: fields always tracked; optional: tracked when relevant\n' +
        '\nOutput ONLY valid JSON:\n' +
        '{\n' +
        '  "schemes": {\n' +
        '    "default": { "description": "...", "required": [...], "optional": [...] },\n' +
        '    "scheme_name": { ... }\n' +
        '  },\n' +
        '  "initial_characters": [\n' +
        '    { "name": "\u89d2\u8272\u540d", "_role": "protagonist|npc", "_scheme": "scheme_name|null" }\n' +
        '  ]\n' +
        '}';
}

export async function resolveNpcSchemes(vault, chatId, messages) {
    if (!vault || !vault.content) return;

    var state = vault.content.state || {};

    if (state.npc_schemes) return;

    var worldBookContent = await collectWorldBookContent();

    if (!worldBookContent || worldBookContent.length === 0) {
        state.npc_schemes = JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
        state._character_schemes = state._character_schemes || {};

        if (state.protagonist_name) {
            state._character_schemes[state.protagonist_name] = { _role: 'protagonist', _scheme: null };
            ensureCharacterTemplate(state, state.protagonist_name);
            if (state.characters && state.characters[state.protagonist_name]) {
                state.characters[state.protagonist_name]._role = 'protagonist';
            }
        }
        vault.content.state = state;
        return;
    }

    var prompt = buildSchemeDiscoveryPrompt(worldBookContent, messages);

    try {
        var response = await callMemoryPipeline([
            { role: 'system', content: 'You are a world-building analyst. Analyze the world setting and determine NPC tracking schemes.' },
            { role: 'user', content: prompt }
        ], { operation: 'scheme_discovery' }, chatId);

        var parsed = safeJsonParse(String(response || '').trim());

        if (parsed && parsed.schemes) {
            state.npc_schemes = parsed.schemes;
        } else {
            state.npc_schemes = JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
        }

        if (parsed && parsed.initial_characters && Array.isArray(parsed.initial_characters)) {
            var discoveredProtagonist = parsed.initial_characters.find(function(ch) { return ch._role === 'protagonist'; });
            if (discoveredProtagonist && discoveredProtagonist.name && discoveredProtagonist.name !== state.protagonist_name) {
                state.protagonist_name = discoveredProtagonist.name;
                console.log('[NE] protagonist_name updated from scheme_discovery: ' + discoveredProtagonist.name);
            }

            var schemeMap = {};
            parsed.initial_characters.forEach(function(ch) {
                if (ch.name) {
                    var isProtagonist = (ch._role === 'protagonist') || (ch.name === state.protagonist_name);
                    var chRole = isProtagonist ? 'protagonist' : 'npc';
                    schemeMap[ch.name] = { _role: chRole, _scheme: isProtagonist ? null : (ch._scheme || null) };
                }
            });
            state._character_schemes = schemeMap;

            var msgText = '';
            if (messages && messages.length > 0) {
                msgText = messages.map(function(m) { return (m.name || '') + ' ' + (m.content || ''); }).join(' ');
            }
            parsed.initial_characters.forEach(function(ch) {
                if (!ch.name) return;
                var isProtagonist = (ch._role === 'protagonist') || (ch.name === state.protagonist_name);
                var isMentioned = msgText.indexOf(ch.name) !== -1;
                if (!isProtagonist && !isMentioned) return;
                var schemeKey = isProtagonist ? null : (ch._scheme || 'default');
                ensureCharacterTemplate(state, ch.name, schemeKey);
                if (state.characters && state.characters[ch.name]) {
                    state.characters[ch.name]._role = isProtagonist ? 'protagonist' : 'npc';
                    if (!isProtagonist && ch._scheme) state.characters[ch.name]._scheme = ch._scheme;
                }
            });
        }
        vault.content.state = state;
    } catch (e) {
        console.warn('[NE] Scheme discovery failed, using default:', e);
        state.npc_schemes = JSON.parse(JSON.stringify(DEFAULT_NPC_SCHEME));
    }

    // 主角不依赖 World Book：LLM 可能未返回，兜底创建
    if (state.protagonist_name) {
        if (!state._character_schemes) state._character_schemes = {};
        if (!state._character_schemes[state.protagonist_name]) {
            state._character_schemes[state.protagonist_name] = { _role: 'protagonist', _scheme: null };
        }
        if (!state.characters || !state.characters[state.protagonist_name]) {
            ensureCharacterTemplate(state, state.protagonist_name);
        }
        if (state.characters && state.characters[state.protagonist_name]) {
            state.characters[state.protagonist_name]._role = 'protagonist';
        }
    }
    vault.content.state = state;
}

// ── 逐轮轻量状态检测（非阈值轮，仅 1-2 条消息）──

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

    if (messages.length === 0) return { vault, changed: false };

    var statePrompt = buildStatePrompt_Preset(messages, vault);

    var stateResponse;
    try {
        stateResponse = await callMemoryPipeline([
            { role: 'system', content: statePrompt.system },
            { role: 'user', content: statePrompt.user }
        ], { operation: 'state_extract' }, chatId);
    } catch (e) {
        console.warn('[NE] Per-round state extraction failed:', e);
        return { vault, changed: false };
    }

    var parsed = parseSTMResponse(stateResponse);
    var stateChanges = parsed.stateChanges || {};

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

    var latestAssistantId = latestAssistantMsg ? latestAssistantMsg.id : null;
    if (latestAssistantId != null && (vault.content.story_time || vault.content.story_scene)) {
        vault.content._state_snapshots = vault.content._state_snapshots || [];
        var snapshots = vault.content._state_snapshots;
        var lastSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
        if (!lastSnap || lastSnap.time !== vault.content.story_time || lastSnap.scene !== vault.content.story_scene) {
            snapshots.push({
                msgIdx: Number(latestAssistantId),
                time: vault.content.story_time || '',
                scene: vault.content.story_scene || '',
                date: vault.content.story_date || ''
            });
        }
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
