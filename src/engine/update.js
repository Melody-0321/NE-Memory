/**
 * engine/update.js — 增量更新引擎
 *
 * 核心循环：收集已处理 msg_id → 过滤新消息 → 构建 prompt → 调用 LLM → 解析 STM → 追加
 */
import { read, appendSTMEntries, markMessagesProcessed, collectProcessedMsgIds, getCursorState, updateCursorState } from '../vault/store.js';
import { callMemoryPipeline, initPowerSlots, recordTelemetry } from '../api/llm.js';
import { validateStateChanges, mergeStateChanges, isStateSchemaEnabled, isDynamicStateMode } from '../vault/schema.js';
import { formatStateSummary } from '../vault/schema.js';
import { validateSTMOutput, postFillSTM, whitelistStateChanges } from './validate.js';
import { preGroupItems, formatPreGroupHint } from './bm25-grouper.js';
import { discoverDynamicFields, buildDynamicStatePrompt, formatDynamicStateSummary } from './state-discovery.js';
import { runStmCursorLoop } from './cursor.js';

export async function saveVaultWithSnapshot(chatId, vault) {
    const { writeWithSnapshot } = await import('../vault/store.js');
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
        autoEmbedVaultToChat(vault);
    } catch (e) {
        console.error('[NE] saveVaultWithSnapshot failed:', e);
    }
}

var _embedCounter = 0;
function autoEmbedVaultToChat(vault) {
    _embedCounter++;
    if (_embedCounter % 5 !== 0) return;
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var metadata = SillyTavern.getContext().chatMetadata;
            var saveChat = SillyTavern.getContext().saveChat;
            if (metadata && typeof saveChat === 'function') {
                metadata.ne_vault = JSON.stringify(vault);
                saveChat().catch(() => {});
            }
        }
    } catch (e) {}
}

/**
 * 初始化 c.state 结构（首次对话时，c.state 为空）
 * 只执行一次：c.state 非空后变为 no-op
 *
 * @param {Object} vault - 完整 vault 对象，直接修改 vault.content.state
 */
export function ensureStateStructure(vault) {
    var state = vault.content.state;
    if (state && Object.keys(state).length > 0) return; // 已初始化
    if (!isStateSchemaEnabled()) return; // Schema 未启用

    if (isDynamicStateMode()) {
        // 动态模式：从 dynamic_state 中发现字段结构为 c.state 初始值
        var ds = vault.content.dynamic_state;
        if (!ds || !(Object.keys(ds.global || {}).length > 0 || Object.keys(ds.characters || {}).length > 0)) {
            // dynamic_state 也没有字段 → 标记为空，让 LLM 自由输出
            vault.content.state = {};
        } else {
            var newState = {};
            if (ds.global) {
                Object.keys(ds.global).forEach(function (k) {
                    newState[k] = '';
                });
            }
            if (ds.characters) {
                newState.characters = {};
                Object.keys(ds.characters).forEach(function (name) {
                    newState.characters[name] = {};
                    var fields = ds.characters[name];
                    Object.keys(fields).forEach(function (k) {
                        newState.characters[name][k] = '';
                    });
                });
            }
            vault.content.state = newState;
        }
    } else {
        // 预设模式：从 state_schema 中提取字段结构
        var schema = vault.content.state_schema;
        if (!schema) {
            vault.content.state = {};
            return;
        }
        vault.content.state = initStateFromSchema(schema);
    }
    vault.content.state_css = vault.content.state_css || '';
}

/**
 * 从 schema 定义中递归提取字段路径，生成 { field: '' } 结构
 */
function initStateFromSchema(schema) {
    if (!schema || !schema.fields) return {};
    var state = {};
    Object.keys(schema.fields).forEach(function (key) {
        var field = schema.fields[key];
        if (key === '*' || !field) return;
        if (field.enabled === false) return;
        if (field.type === 'object') {
            if (field.schema) {
                state[key] = initStateFromSchema(field.schema);
            }
            return;
        }
        state[key] = '';
    });
    return state;
}

export function filterNewMessages(messages, processedIds) {
    return messages.filter(m => {
        const id = m.id || m.mes_id;
        return id !== undefined && !processedIds.has(id);
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
        var s = formatStateSummary(content.state, content.state_schema || null);
        if (s) currentStateSnapshot += 'Current state (for reference — only change what changes):\n' + s + '\n';
    }
    // ── 动态字段发现（从角色卡/世界书自动提取的状态栏字段） ──
    var dynamicState = content.dynamic_state;
    if (dynamicState && (Object.keys(dynamicState.global || {}).length > 0 || Object.keys(dynamicState.characters || {}).length > 0)) {
        var ds = formatDynamicStateSummary(dynamicState);
        if (ds) currentStateSnapshot += ds;
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

    const stateChangesEn = `${dynamicState ? buildDynamicStatePrompt(dynamicState, 'en') : ''}
Optionally, output a <state_changes> block with a JSON object of state field updates (dot-path keys to new values), e.g.:
<state_changes>{"scene":"Forest","time":"Dusk"}</state_changes>

${dynamicState ? 'In addition to the dynamic fields above, ' : ''}Character cards are stored under state.characters.<name>.*. Each character has fields:
- name, gender_age, occupation, clothing_build, personality (always)
- status: one of 活跃/非活跃/已死亡/已归隐/已离去
- NPCs additionally have: inner_thoughts, affection(0-100), relationship, current_mood, past_experience
- inventory_mode: 开启/静态/关闭
- injuries, status_effects (optional)
- power_slots (optional): JSON object of {key: "value"} — character power/energy tracker. Each character may have system-defined slots (e.g., vitality/energy/realm) with custom labels (e.g., "气血", "灵力", "境界" for cultivation; "Health", "Stamina", "Status" for modern). If a character has power_slots defined, update values to reflect current state.

Example power_slots update:
<state_changes>{"characters.张三.power_slots":{"vitality":"轻伤","energy":"充盈","realm":"筑基初期"}}</state_changes>

IMPORTANT: power_slots field stores a flat JSON object of key→value pairs. Do NOT include slot definitions (key/label/description) in updates — those are managed by the system. Only update the current values.

When creating power_slots for a new character, check if other characters in the same world already have power_slots. If they use the same cultivation/power system, reuse their slot labels to maintain naming consistency.

To change which characters are present, update their status field:
<state_changes>{"characters.Alice.status":"已死亡","characters.Bob.status":"活跃"}</state_changes>

IMPORTANT: present_characters is a VIRTUAL field auto-rebuilt by code from active character names. Do NOT include present_characters in your <state_changes> block. Only update characters.*.status to change who is present.

Factions are stored under state.factions.<name>.*. Each faction has fields:
- name, description, leader
- attitude_toward_player: one of 友好/中立/冷淡/敌对
- relations: object keyed by target faction name (only record relations that have actually occurred in the story)
- notes (max 200 chars)

Only track factions that have appeared in the story. Examples:
<state_changes>{"factions.魔教.attitude_toward_player":"敌对","factions.魔教.relations.正道联盟":"全面战争","factions.正道联盟.leader":"张真人","factions.魔教.notes":"近期在南方活动频繁"}</state_changes>

Quests are stored under state.quests.* with three sub-sections:

=== Tasks (quests.tasks.<name>.*) ===
- name(always), deadline(always), status: one of 正在进行/已完成/已失败/已过期
- type: 主线/支线/事件 (detail only, via quest_lookup Tool)
- issuer, desc(max 200 chars), progress, posted_time, reward, penalty (detail only)

=== Goals (quests.goals.<name>.*) ===
- name(always), status: one of 进行中/已达成/已放弃
- desc(max 200 chars), progress, posted_time, completed_time (detail only)

=== World Events (quests.events.<name>.*) ===
- name(always), status: one of 持续中/已平息/已结束
- desc(max 300 chars), started_time, ended_time (detail only)

Bi-level exposure: name+deadline/status are always injected into the prompt summary. All detail fields (type, issuer, desc, progress, reward, penalty, posted_time, etc.) are available only via the quest_lookup Tool. The LLM should use quest_lookup when it needs full details about a specific quest.

World event decay: if an event has been 持续中 for many rounds without any update, consider changing its status to 已平息. Events should not linger in 持续中 indefinitely unless actively progressing.

Example quest updates:
<state_changes>{"quests.tasks.护送商队.status":"已完成","quests.goals.成为剑圣.progress":"已掌握三式剑法，尚需四式","quests.events.兽潮入侵.status":"持续中","quests.events.兽潮入侵.desc":"北方森林的野兽大规模南下，已波及三座村庄"}</state_changes>`;

    const stateChangesZh = `${dynamicState ? buildDynamicStatePrompt(dynamicState, 'zh') : ''}
可选：输出 <state_changes> 块，包含 JSON 格式的状态字段更新（dot-path 键→新值），如：
<state_changes>{"scene":"森林","time":"黄昏"}</state_changes>

${dynamicState ? '除上述动态字段外，' : ''}角色卡存储在 state.characters.<角色名>.* 下。每个角色有以下字段：
- name, gender_age, occupation, clothing_build, personality（始终存在）
- status: 活跃/非活跃/已死亡/已归隐/已离去 之一
- NPC 额外拥有: inner_thoughts, affection(0-100), relationship, current_mood, past_experience
- inventory_mode: 开启/静态/关闭
- injuries, status_effects（可选）
- power_slots（可选）：JSON 对象 {key: "value"}——角色战力/能量追踪器。每个角色可能有系统定义的槽位（如 vitality/energy/realm），使用自定义标签（如修仙者的"气血""灵力""境界"；现代背景的"身体状况""精力""社会地位"）。若角色定义了 power_slots，请更新其值以反映当前状态。

示例 power_slots 更新：
<state_changes>{"characters.张三.power_slots":{"vitality":"轻伤","energy":"充盈","realm":"筑基初期"}}</state_changes>

重要：power_slots 字段存储的是扁平的 key→value JSON 对象。更新时请勿包含槽位定义（key/label/description），这些由系统管理。只更新当前值。

为新角色创建 power_slots 时，请检查同世界其他角色是否已有 power_slots。若他们使用相同的修炼/力量体系，复用其槽位标签以保持命名一致性。

要改变在场角色，更新其 status 字段：
<state_changes>{"characters.爱丽丝.status":"已死亡","characters.鲍勃.status":"活跃"}</state_changes>

重要：present_characters 是由代码自动从活跃角色名重建的虚拟字段。请勿在 <state_changes> 块中包含 present_characters。只更新 characters.*.status 来改变在场角色。

势力存储在 state.factions.<名称>.* 下。每个势力有以下字段：
- name, description, leader
- attitude_toward_player: 友好/中立/冷淡/敌对 之一
- relations: 以目标势力名为键的对象（只记录故事中实际发生过的关系）
- notes（最长200字）

只追踪故事中已出现的势力。示例：
<state_changes>{"factions.魔教.attitude_toward_player":"敌对","factions.魔教.relations.正道联盟":"全面战争","factions.正道联盟.leader":"张真人","factions.魔教.notes":"近期在南方活动频繁"}</state_changes>

任务/目标/世界事件存储在 state.quests.* 下，分三个子区域：

=== 任务 (quests.tasks.<名称>.*) ===
- name(始终), deadline(始终), status: 正在进行/已完成/已失败/已过期 之一
- type: 主线/支线/事件（仅详情，通过 quest_lookup 工具获取）
- issuer, desc(最长200字), progress, posted_time, reward, penalty（仅详情）

=== 目标 (quests.goals.<名称>.*) ===
- name(始终), status: 进行中/已达成/已放弃 之一
- desc(最长200字), progress, posted_time, completed_time（仅详情）

=== 世界事件 (quests.events.<名称>.*) ===
- name(始终), status: 持续中/已平息/已结束 之一
- desc(最长300字), started_time, ended_time（仅详情）

双层暴露策略：name+deadline/status 始终注入到 prompt 摘要中。所有详情字段（type、issuer、desc、progress、reward、penalty、posted_time 等）仅通过 quest_lookup 工具获取。LLM 在需要任务完整详情时应使用 quest_lookup。

世界事件衰减：如果某个事件持续多轮均为「持续中」而无任何更新，应考虑将其状态改为「已平息」。事件不应无限期停留在「持续中」状态，除非确实在积极进展。

示例：
<state_changes>{"quests.tasks.护送商队.status":"已完成","quests.goals.成为剑圣.progress":"已掌握三式剑法，尚需四式","quests.events.兽潮入侵.status":"持续中","quests.events.兽潮入侵.desc":"北方森林的野兽大规模南下，已波及三座村庄"}</state_changes>`;

    const userMsgEn = `New conversation messages:\n\n${msgTexts}\n\nExtract key events as JSON array.${schemaEnabled ? ' If state changes are needed, append <state_changes> block.' : ''}`;
    const userMsgZh = `新对话消息：\n\n${msgTexts}\n\n提取关键事件为 JSON 数组。${schemaEnabled ? '如有状态变化，附加 <state_changes> 块。' : ''}`;

    if (lang === 'en') {
        return {
            system: currentStateSnapshot + partialCtx + 'You are a story memory extractor. Your task is to extract key events from the conversation into short-term memory entries.\n' +
                '\nYOUR OUTPUT MUST START with a _checkpoints block:\n' +
                '{\n' +
                '  "_checkpoints": { "time": "current story time (REQUIRED, even if unchanged)", "scene": "current scene/location (REQUIRED, even if unchanged)" },\n' +
                '  "stm_entries": [...]\n' +
                '}\n' +
                '\nEach stm_entries item must have:\n' +
                '- "event": what happened — REQUIRED. Be specific enough a reader understands what occurred (20-80 chars).\n' +
                '- "time_label": optional — only set if the event\'s time differs from the implied time. Otherwise omit.\n' +
                '- "translation": Chinese translation of the event (max 200 chars) for cross-lingual search. Provides key terms in Chinese for BM25 token matching.\n' +
                '- "entities": optional string array — character/faction names involved in this event. E.g. ["Alice", "Bob", "魔教"].\n' +
                '\nNote: "period" and "scene" are auto-filled from global state. Do NOT include them in entries.\n' +
                msgRangeInstructionEn +
                '\nIf nothing of narrative significance happened, output {"_checkpoints": {"time": "...", "scene": "..."}, "stm_entries": []}.' + (schemaEnabled ? stateChangesEn : ''),
            user: userMsgEn
        };
    }
    return {
        system: currentStateSnapshot + partialCtx + '你是故事记忆提取器。从对话中提取关键事件到短期记忆中。\n' +
            '\n输出必须以 _checkpoints 块开头：\n' +
            '{\n' +
            '  "_checkpoints": { "time": "当前故事时间（必填，即使未变化）", "scene": "当前场景/地点（必填，即使未变化）" },\n' +
            '  "stm_entries": [...]\n' +
            '}\n' +
            '\n每个 stm_entries 条目包含：\n' +
            '- "event": 事件描述——必填。具体到让读者理解发生了什么（20-80字）。\n' +
            '- "time_label": （可选）仅当事件时间与当前时间不同时填写，否则省略。\n' +
            '- "translation": 事件的英文翻译（最长200字符），用于跨语言检索。提供英文关键词以供 BM25 词项匹配。\n' +
            '- "entities": （可选）事件涉及的角色/势力名称，字符串数组。如 ["Alice", "Bob", "魔教"]。\n' +
            '\n注意："period" 和 "scene" 会自动从全局数据填充，条目中无需包含。\n' +
            msgRangeInstructionZh +
            '\n如果没有叙事意义的事件，输出 {"_checkpoints": {"time": "...", "scene": "..."}, "stm_entries": []}。' + (schemaEnabled ? stateChangesZh : ''),
        user: userMsgZh
    };
}

export function parseSTMResponse(llmResponse) {
    var text = String(llmResponse || '').trim();

    var stateChangesText = null;
    var stateMatch = text.match(/<state_changes>([\s\S]*?)<\/state_changes>/);
    if (stateMatch) {
        stateChangesText = stateMatch[1].trim();
        text = text.replace(/<state_changes>[\s\S]*?<\/state_changes>/, '').trim();
    }

    var codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeMatch) text = codeMatch[1].trim();

    var stmEntries = [];
    var checkpoints = null;
    try {
        var jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            var parsed = JSON.parse(jsonMatch[0]);
            if (parsed.stm_entries || parsed._checkpoints) {
                checkpoints = parsed._checkpoints || null;
                stmEntries = parsed.stm_entries || [];
            } else if (Array.isArray(parsed)) {
                stmEntries = parsed;
            }
        } else {
            try {
                var arrayMatch = text.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    stmEntries = JSON.parse(arrayMatch[0]);
                    if (!Array.isArray(stmEntries)) stmEntries = [];
                }
            } catch (e2) {}
        }
        if (stmEntries.length === 0 && text.length > 5) {
            stmEntries = [{ event: text.substring(0, 120), scene: '', period: '', time_label: '' }];
        }
    } catch (e) {}

    // 确保每条 entry 有 msgRange、status 和 entities 默认值
    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        if (!e.status) e.status = 'closed';
        if (!e.msgRange || e.msgRange.length !== 2) {
            e.msgRange = [i, i];
        }
        // 规范化 entities：字符串数组 → [{name, type}]
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

    var stateChanges = {};
    if (stateChangesText) {
        try {
            var parsedState = JSON.parse(stateChangesText);
            if (typeof parsedState === 'object' && parsedState !== null && !Array.isArray(parsedState)) {
                if (!isStateSchemaEnabled()) {
                    stateChanges = whitelistStateChanges(parsedState);
                } else {
                    stateChanges = parsedState;
                }
            }
        } catch (e) {}
    }

    return { stmEntries: stmEntries, stateChanges: stateChanges, _checkpoints: checkpoints };
}

export function handleQuestCompletion(state, validatedChanges) {
    if (!state || !validatedChanges) return;
    var currentTime = (state.global && state.global.time) || state.time || '';
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
        var idx = position + i;
        var role = item.role || (item.is_user ? 'user' : 'assistant');
        return '[' + idx + '] ' + role + ': ' + (item.content || item.mes || '');
    }).join('\n');

    // 当前状态摘要
    var currentStateSnapshot = '';
    if (content.story_time || content.story_scene || content.story_date) {
        currentStateSnapshot = 'story_day: ' + (content.story_time || '') + '\nstory_date: ' + (content.story_date || '') + '\nstory_scene: ' + (content.story_scene || '') + '\n';
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
        (currentStateSnapshot + 'You are a story memory extractor. Extract key events from these ' + windowItems.length + ' messages.\n\n' +
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
        (currentStateSnapshot + '你是故事记忆提取器。从以下 ' + windowItems.length + ' 条消息中提取关键事件。\n\n' +
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
    if (force) instruction += '\n\n⚠️ 已到达窗口上限，请务必返回至少一条事件。不允许返回空数组。';

    var userPrompt = lang === 'en' ?
        'Messages:\n' + itemsText + '\n\nOutput ONLY a JSON array:\n[\n  { "event": "...", "msgRange": [0, 2], "status": "closed"|"partial", "entity": "...", "translation": "...", "parent_partial": null },\n  ...\n]\nIf nothing significant, return [].' :
        '消息：\n' + itemsText + '\n\n仅输出一个 JSON 数组：\n[\n  { "event": "...", "msgRange": [0, 2], "status": "closed"|"partial", "entity": "...", "translation": "...", "parent_partial": null },\n  ...\n]\n如果没有重要事件，返回 []。';

    return { system: instruction, user: userPrompt };
}

// ── State changes prompt builder (post-cursor, single LLM call) ──

function buildStateChangesPrompt(messages, vault) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var schemaEnabled = isStateSchemaEnabled();

    var msgTexts = messages.map(function(m, i) {
        var role = m.role === 'user' ? 'User' : 'Character';
        var name = m.name ? m.name + ': ' : '';
        return '[' + i + '] [' + role + '] ' + name + (m.content || '');
    }).join('\n\n');

    var currentStateSnapshot = '';
    if (content.story_time || content.story_scene || content.story_date) {
        currentStateSnapshot = 'story_day: ' + (content.story_time || '') + '\nstory_date: ' + (content.story_date || '') + '\nstory_scene: ' + (content.story_scene || '') + '\n';
    }
    if (!content.story_time && !content.story_date && !content.story_scene) {
        currentStateSnapshot = 'story_day: Day 1\nstory_date: \nstory_scene: 未知\n';
    }
    if (schemaEnabled && content.state && Object.keys(content.state).length > 0) {
        var s = formatStateSummary(content.state, content.state_schema || null);
        if (s) currentStateSnapshot += 'Current state (for reference — only change what changes):\n' + s + '\n';
    }
    // ── 动态字段（仅动态模式）──
    var dynamicState2 = isDynamicStateMode() ? content.dynamic_state : null;
    if (dynamicState2 && (Object.keys(dynamicState2.global || {}).length > 0 || Object.keys(dynamicState2.characters || {}).length > 0)) {
        var ds2 = formatDynamicStateSummary(dynamicState2);
        if (ds2) currentStateSnapshot += ds2;
    }

    // 复用 buildSTMUpdatePrompt 中的 stateChanges 指令
    var stateChangesEn = (dynamicState2 ? buildDynamicStatePrompt(dynamicState2, 'en') + '\n' : '') + '\nOptionally, output a <state_changes> block with a JSON object of state field updates (dot-path keys to new values), e.g.:\n<state_changes>{"scene":"Forest","time":"Dusk"}</state_changes>\n\n' + (dynamicState2 ? 'In addition to the dynamic fields above, ' : '') + 'Character cards are stored under state.characters.<name>.*. Each character has fields:\n- name, gender_age, occupation, clothing_build, personality (always)\n- status: one of 活跃/非活跃/已死亡/已归隐/已离去\n- NPCs additionally have: inner_thoughts, affection(0-100), relationship, current_mood, past_experience\n- inventory_mode: 开启/静态/关闭\n- injuries, status_effects (optional)\n- power_slots (optional): JSON object of {key: "value"} — character power/energy tracker. Each character may have system-defined slots (e.g., vitality/energy/realm) with custom labels (e.g., "气血", "灵力", "境界" for cultivation; "Health", "Stamina", "Status" for modern). If a character has power_slots defined, update values to reflect current state.\n\nExample power_slots update:\n<state_changes>{"characters.张三.power_slots":{"vitality":"轻伤","energy":"充盈","realm":"筑基初期"}}</state_changes>\n\nIMPORTANT: power_slots field stores a flat JSON object of key→value pairs. Do NOT include slot definitions (key/label/description) in updates — those are managed by the system. Only update the current values.\n\nWhen creating power_slots for a new character, check if other characters in the same world already have power_slots. If they use the same cultivation/power system, reuse their slot labels to maintain naming consistency.\n\nTo change which characters are present, update their status field:\n<state_changes>{"characters.Alice.status":"已死亡","characters.Bob.status":"活跃"}</state_changes>\n\nIMPORTANT: present_characters is a VIRTUAL field auto-rebuilt by code from active character names. Do NOT include present_characters in your <state_changes> block. Only update characters.*.status to change who is present.\n\nFactions are stored under state.factions.<name>.*. Each faction has fields:\n- name, description, leader\n- attitude_toward_player: one of 友好/中立/冷淡/敌对\n- relations: object keyed by target faction name (only record relations that have actually occurred in the story)\n- notes (max 200 chars)\n\nOnly track factions that have appeared in the story. Examples:\n<state_changes>{"factions.魔教.attitude_toward_player":"敌对","factions.魔教.relations.正道联盟":"全面战争","factions.正道联盟.leader":"张真人","factions.魔教.notes":"近期在南方活动频繁"}</state_changes>\n\nQuests are stored under state.quests.* with three sub-sections:\n\n=== Tasks (quests.tasks.<name>.*) ===\n- name(always), deadline(always), status: one of 正在进行/已完成/已失败/已过期\n- type: 主线/支线/事件 (detail only, via quest_lookup Tool)\n- issuer, desc(max 200 chars), progress, posted_time, reward, penalty (detail only)\n\n=== Goals (quests.goals.<name>.*) ===\n- name(always), status: one of 进行中/已达成/已放弃\n- desc(max 200 chars), progress, posted_time, completed_time (detail only)\n\n=== World Events (quests.events.<name>.*) ===\n- name(always), status: one of 持续中/已平息/已结束\n- desc(max 300 chars), started_time, ended_time (detail only)\n\nBi-level exposure: name+deadline/status are always injected into the prompt summary. All detail fields (type, issuer, desc, progress, reward, penalty, posted_time, etc.) are available only via the quest_lookup Tool. The LLM should use quest_lookup when it needs full details about a specific quest.\n\nWorld event decay: if an event has been 持续中 for many rounds without any update, consider changing its status to 已平息. Events should not linger in 持续中 indefinitely unless actively progressing.\n\nExample quest updates:\n<state_changes>{"quests.tasks.护送商队.status":"已完成","quests.goals.成为剑圣.progress":"已掌握三式剑法，尚需四式","quests.events.兽潮入侵.status":"持续中","quests.events.兽潮入侵.desc":"北方森林的野兽大规模南下，已波及三座村庄"}</state_changes>';

    var stateChangesZh = (dynamicState2 ? buildDynamicStatePrompt(dynamicState2, 'zh') + '\n' : '') + '\n可选：输出 <state_changes> 块，包含 JSON 格式的状态字段更新（dot-path 键→新值），如：\n<state_changes>{"scene":"森林","time":"黄昏"}</state_changes>\n\n' + (dynamicState2 ? '除上述动态字段外，' : '') + '角色卡存储在 state.characters.<角色名>.* 下。每个角色有以下字段：\n- name, gender_age, occupation, clothing_build, personality（始终存在）\n- status: 活跃/非活跃/已死亡/已归隐/已离去 之一\n- NPC 额外拥有: inner_thoughts, affection(0-100), relationship, current_mood, past_experience\n- inventory_mode: 开启/静态/关闭\n- injuries, status_effects（可选）\n- power_slots（可选）：JSON 对象 {key: "value"}——角色战力/能量追踪器。每个角色可能有系统定义的槽位（如 vitality/energy/realm），使用自定义标签（如修仙者的"气血""灵力""境界"；现代背景的"身体状况""精力""社会地位"）。若角色定义了 power_slots，请更新其值以反映当前状态。\n\n示例 power_slots 更新：\n<state_changes>{"characters.张三.power_slots":{"vitality":"轻伤","energy":"充盈","realm":"筑基初期"}}</state_changes>\n\n重要：power_slots 字段存储的是扁平的 key→value JSON 对象。更新时请勿包含槽位定义（key/label/description），这些由系统管理。只更新当前值。\n\n为新角色创建 power_slots 时，请检查同世界其他角色是否已有 power_slots。若他们使用相同的修炼/力量体系，复用其槽位标签以保持命名一致性。\n\n要改变在场角色，更新其 status 字段：\n<state_changes>{"characters.爱丽丝.status":"已死亡","characters.鲍勃.status":"活跃"}</state_changes>\n\n重要：present_characters 是由代码自动从活跃角色名重建的虚拟字段。请勿在 <state_changes> 块中包含 present_characters。只更新 characters.*.status 来改变在场角色。\n\n势力存储在 state.factions.<名称>.* 下。每个势力有以下字段：\n- name, description, leader\n- attitude_toward_player: 友好/中立/冷淡/敌对 之一\n- relations: 以目标势力名为键的对象（只记录故事中实际发生过的关系）\n- notes（最长200字）\n\n只追踪故事中已出现的势力。示例：\n<state_changes>{"factions.魔教.attitude_toward_player":"敌对","factions.魔教.relations.正道联盟":"全面战争","factions.正道联盟.leader":"张真人","factions.魔教.notes":"近期在南方活动频繁"}</state_changes>\n\n任务/目标/世界事件存储在 state.quests.* 下，分三个子区域：\n\n=== 任务 (quests.tasks.<名称>.*) ===\n- name(始终), deadline(始终), status: 正在进行/已完成/已失败/已过期 之一\n- type: 主线/支线/事件（仅详情，通过 quest_lookup 工具获取）\n- issuer, desc(最长200字), progress, posted_time, reward, penalty（仅详情）\n\n=== 目标 (quests.goals.<名称>.*) ===\n- name(始终), status: 进行中/已达成/已放弃 之一\n- desc(最长200字), progress, posted_time, completed_time（仅详情）\n\n=== 世界事件 (quests.events.<名称>.*) ===\n- name(始终), status: 持续中/已平息/已结束 之一\n- desc(最长300字), started_time, ended_time（仅详情）\n\n双层暴露策略：name+deadline/status 始终注入到 prompt 摘要中。所有详情字段（type、issuer、desc、progress、reward、penalty、posted_time 等）仅通过 quest_lookup 工具获取。LLM 在需要任务完整详情时应使用 quest_lookup。\n\n世界事件衰减：如果某个事件持续多轮均为「持续中」而无任何更新，应考虑将其状态改为「已平息」。事件不应无限期停留在「持续中」状态，除非确实在积极进展。\n\n示例：\n<state_changes>{"quests.tasks.护送商队.status":"已完成","quests.goals.成为剑圣.progress":"已掌握三式剑法，尚需四式","quests.events.兽潮入侵.status":"持续中","quests.events.兽潮入侵.desc":"北方森林的野兽大规模南下，已波及三座村庄"}</state_changes>';

    if (lang === 'en') {
        return {
            system: currentStateSnapshot + 'You are a story state tracker. Review the entire conversation batch and update state fields as needed.\n\n' +
                'YOUR OUTPUT MUST START with a _checkpoints block:\n' +
                '{\n' +
                '  "_checkpoints": { "time": "current story time (REQUIRED, even if unchanged)", "scene": "current scene/location (REQUIRED, even if unchanged)" }\n' +
                '}\n' +
                (schemaEnabled ? stateChangesEn : ''),
            user: 'Recent conversation messages:\n\n' + msgTexts + '\n\nExtract the current story time, scene, and any state changes. Output the JSON object with _checkpoints (required) and optionally <state_changes> block.'
        };
    }
    return {
        system: currentStateSnapshot + '你是故事状态追踪器。回顾整个对话批次，更新状态字段。\n\n' +
            '输出必须以 _checkpoints 块开头：\n' +
            '{\n' +
            '  "_checkpoints": { "time": "当前故事时间（必填，即使未变化）", "scene": "当前场景/地点（必填，即使未变化）" }\n' +
            '}\n' +
            (schemaEnabled ? stateChangesZh : ''),
        user: '最近的对话消息：\n\n' + msgTexts + '\n\n提取当前故事时间、场景以及任何状态变化。输出包含 _checkpoints（必填）和可选的 <state_changes> 块的 JSON 对象。'
    };
}

export async function executeIncrementalUpdate(chatId, newMessages, force) {
    const vault = await read(chatId);
    var processedIds = new Set();
    if (!force) {
        processedIds = collectProcessedMsgIds(vault);
    }
    var filteredMessages = force ? newMessages : filterNewMessages(newMessages, processedIds);
    if (filteredMessages.length === 0) return { vault: vault, added: 0 };

    // ── 动态字段发现（首次运行时从角色卡/世界书提取状态栏字段）──
    if (isDynamicStateMode() && !vault.content.dynamic_state) {
        var discoveryResult = discoverDynamicFields(vault);
        if (discoveryResult.discovered) {
            try { await saveVaultWithSnapshot(chatId, vault); } catch (e) {}
        }
    }

    // 首次对话：初始化 c.state 结构（字段名+空值）—— 仅执行一次
    ensureStateStructure(vault);

    // ── Phase 1: Cursor Engine STM 提取（批量 LLM 调用）──
    var cursorResult = await runStmCursorLoop({
        vault: vault,
        messages: filteredMessages,
        callLLM: callMemoryPipeline,
        parseResponse: parseSTMResponse,
        validateOutput: validateSTMOutput,
        postFill: function(parsed, v) { postFillSTM(parsed, v); },
        appendEntries: function(v, entries) { appendSTMEntries(v, entries, null, false); },
        getCursorState: getCursorState,
        updateCursorState: updateCursorState,
        markProcessed: function(v, ids) { markMessagesProcessed(v, ids); },
        buildPrompt: buildCursorPrompt
    });
    var newEntries = (vault.content.stm_entries || []).slice(-Math.max(1, cursorResult.totalAdded));
    if (cursorResult.totalAdded === 0) newEntries = [];

    // 处理 _checkpoints
    if (cursorResult.cursorState) {
        var chk = vault.content.cursor_state && vault.content.cursor_state.stm ? vault.content.cursor_state.stm._checkpoints : null;
        if (chk) postFillSTM({ stmEntries: newEntries, _checkpoints: chk, stateChanges: {} }, vault);
    }

    // ── Phase 2: 提取 state_changes（一次 LLM 调用）──
    var stateChanges = {};
    var statePrompt = buildStateChangesPrompt(filteredMessages, vault);
    try {
        var stateResponse = await callMemoryPipeline([
            { role: 'system', content: statePrompt.system },
            { role: 'user', content: statePrompt.user }
        ]);
        var stateParsed = parseSTMResponse(stateResponse);
        stateChanges = stateParsed.stateChanges || {};
        // 处理 _checkpoints
        if (stateParsed._checkpoints) {
            postFillSTM({ stmEntries: newEntries, _checkpoints: stateParsed._checkpoints, stateChanges: {} }, vault);
        }
    } catch (e) {
        console.warn('[NE] State changes extraction failed:', e);
    }

    if (newEntries.length === 0 && Object.keys(stateChanges).length === 0) return { vault: vault, added: 0 };

    recordTelemetry({
        pipeline_task: 'stm_extract',
        new_stm_count: newEntries.length,
        new_state_change_count: Object.keys(stateChanges).length,
        parse_error: null
    });

    // ── Phase 3: 处理 state_changes ──
    var stmCount = newEntries.length;

    if (isStateSchemaEnabled() && Object.keys(stateChanges).length > 0) {
        var schema = vault.content.state_schema || null;
        var result = validateStateChanges(schema, stateChanges);
        if (result.warnings.length > 0) console.warn('[NE] State change warnings:', result.warnings);
        var oldState = vault.content.state || {};
        var oldCharNames = Object.keys(oldState.characters || {});
        vault.content.state = mergeStateChanges(vault.content.state || {}, result.validated);
        handleQuestCompletion(vault.content.state, result.validated);

        var newState = vault.content.state || {};
        var newCharNames = Object.keys(newState.characters || {});
        var addedCharNames = newCharNames.filter(function (n) { return oldCharNames.indexOf(n) === -1; });

        if (addedCharNames.length > 0) {
            var existingSlotsForWorld = [];
            oldCharNames.forEach(function (name) {
                var card = oldState.characters[name];
                if (card && card.power_slot_defs && Array.isArray(card.power_slot_defs)) {
                    card.power_slot_defs.forEach(function (s) {
                        var found = existingSlotsForWorld.find(function (e) { return e.key === s.key; });
                        if (!found) existingSlotsForWorld.push(s);
                    });
                }
            });

            for (var ni = 0; ni < addedCharNames.length; ni++) {
                var charName = addedCharNames[ni];
                initPowerSlots(charName, existingSlotsForWorld).then(function (slots) {
                    if (slots && slots.length > 0) {
                        read(chatId).then(function (freshVault) {
                            var st = freshVault.content.state || {};
                            if (!st.characters) st.characters = {};
                            if (!st.characters[charName]) st.characters[charName] = {};
                            st.characters[charName].power_slot_defs = slots;
                            var values = {};
                            slots.forEach(function (s) { values[s.key] = ''; });
                            st.characters[charName].power_slots = values;
                            freshVault._meta.last_pipeline_task = 'power_slot_init';
                            freshVault._meta.last_pipeline_time = new Date().toISOString();
                            saveVaultWithSnapshot(chatId, freshVault).catch(function (e2) {
                                console.warn('[NE] Fire-and-forget power slot save failed for', charName, ':', e2);
                            });
                        }).catch(function (e2) {
                            console.warn('[NE] Fire-and-forget vault read failed for', charName, ':', e2);
                        });
                    }
                }).catch(function (e) {
                    console.warn('[NE] initPowerSlots failed for', charName, ':', e);
                });
            }
        }
    }

    if (stateChanges.story_date) {
        vault.content.story_date = String(stateChanges.story_date);
    }

    vault._meta = vault._meta || {};
    vault._meta.last_pipeline_task = 'stm_extract';
    vault._meta.last_pipeline_time = new Date().toISOString();

    await saveVaultWithSnapshot(chatId, vault);
    return { vault: vault, added: stmCount };
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
    if (messages.length === 0) return { vault, changed: false };

    var statePrompt = buildStateChangesPrompt(messages, vault);

    var stateResponse;
    try {
        stateResponse = await callMemoryPipeline([
            { role: 'system', content: statePrompt.system },
            { role: 'user', content: statePrompt.user }
        ]);
    } catch (e) {
        console.warn('[NE] Per-round state extraction failed:', e);
        return { vault, changed: false };
    }

    var parsed = parseSTMResponse(stateResponse);
    var stateChanges = parsed.stateChanges || {};

    if (parsed._checkpoints) {
        postFillSTM({ stmEntries: vault.content.stm_entries || [], _checkpoints: parsed._checkpoints, stateChanges: {} }, vault);
    }

    if (Object.keys(stateChanges).length === 0 && !parsed._checkpoints) {
        return { vault, changed: false };
    }

    if (isStateSchemaEnabled() && Object.keys(stateChanges).length > 0) {
        var schema = vault.content.state_schema || null;
        var result = validateStateChanges(schema, stateChanges);
        if (result.warnings.length > 0) console.warn('[NE] State change warnings:', result.warnings);
        vault.content.state = mergeStateChanges(vault.content.state || {}, result.validated);
        handleQuestCompletion(vault.content.state, result.validated);
    }

    if (stateChanges.story_date) {
        vault.content.story_date = String(stateChanges.story_date);
    }

    vault._meta = vault._meta || {};
    vault._meta.last_state_task = 'per_round';
    vault._meta.last_state_time = new Date().toISOString();

    await saveVaultWithSnapshot(chatId, vault);

    recordTelemetry({
        pipeline_task: 'state_per_round',
        new_state_change_count: Object.keys(stateChanges).length,
        parse_error: null
    });

    return { vault, changed: true };
}
