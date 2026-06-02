/**
 * engine/update.js — 增量更新引擎
 *
 * 核心循环：收集已处理 msg_id → 过滤新消息 → 构建 prompt → 调用 LLM → 解析 STM → 追加
 */
import { read, appendSTMEntries } from '../vault/store.js';
import { saveSnapshot } from '../vault/versions.js';
import { callMemoryLLM, initPowerSlots, recordTelemetry } from '../api/llm.js';
import { validateStateChanges, mergeStateChanges, isStateSchemaEnabled } from '../vault/schema.js';
import { formatStateSummary } from '../vault/schema.js';
import { validateSTMOutput, postFillSTM, whitelistStateChanges } from './validate.js';

export async function saveVaultWithSnapshot(chatId, vault) {
    const { write } = await import('../vault/store.js');
    vault.version = (vault.version || 0) + 1;
    vault.updated_at = new Date().toISOString();
    try {
        await write(chatId, vault);
        await saveSnapshot(chatId, vault);
        autoEmbedVaultToChat(vault);
    } catch (e) {
        console.error('[NE] saveVaultWithSnapshot failed:', e);
        throw e;
    }
}

function autoEmbedVaultToChat(vault) {
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

export function collectProcessedMsgIds(vault) {
    const ids = new Set();
    const content = vault.content || {};
    const allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    allSTM.forEach(stm => (stm.msg_ids || []).forEach(id => ids.add(id)));
    return ids;
}

export function filterNewMessages(messages, processedIds) {
    return messages.filter(m => {
        const id = m.id || m.mes_id;
        return id !== undefined && !processedIds.has(id);
    });
}

export function buildSTMUpdatePrompt(newMessages, vault) {
    const content = vault.content || {};
    const lang = content.language === 'en' ? 'en' : 'zh';
    const msgTexts = newMessages.map(m => {
        const role = m.role === 'user' ? 'User' : 'Character';
        const name = m.name ? m.name + ': ' : '';
        return `[${role}] ${name}${m.content || ''}`;
    }).join('\n\n');

    const schemaEnabled = isStateSchemaEnabled();

    var currentStateSnapshot = '';
    if (schemaEnabled && content.state && Object.keys(content.state).length > 0) {
        var s = formatStateSummary(content.state, content.state_schema || null);
        if (s) currentStateSnapshot = 'Current state (for reference — only change what changes):\n' + s + '\n';
    }

    const stateChangesEn = `
Optionally, output a <state_changes> block with a JSON object of state field updates (dot-path keys to new values), e.g.:
<state_changes>{"scene":"Forest","time":"Dusk","tone":"Tense"}</state_changes>

Character cards are stored under state.characters.<name>.*. Each character has fields:
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

    const stateChangesZh = `
可选：输出 <state_changes> 块，包含 JSON 格式的状态字段更新（dot-path 键→新值），如：
<state_changes>{"scene":"森林","time":"黄昏","tone":"紧张"}</state_changes>

角色卡存储在 state.characters.<角色名>.* 下。每个角色有以下字段：
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
            system: `${currentStateSnapshot}You are a story memory extractor. Your task is to extract key events from the conversation into short-term memory entries.

YOUR OUTPUT MUST START with a _checkpoints block:
{
  "_checkpoints": { "time": "current story time (REQUIRED, even if unchanged)", "scene": "current scene/location (REQUIRED, even if unchanged)", "tone": "current atmosphere/tone" },
  "stm_entries": [...]
}

Each stm_entries item must have:
- "period": copy the current state.time value (max 15 chars). Do NOT invent your own period label.
- "scene": location/scene name (max 20 chars)
- "event": what happened — REQUIRED. Be specific enough a reader understands what occurred (20-80 chars).
- "time_label": time within the period (max 8 chars). Only set if the event's time differs from the period's implied time. Otherwise leave empty.

If nothing of narrative significance happened, output {"_checkpoints": {"time": "...", "scene": "..."}, "stm_entries": []}.${schemaEnabled ? stateChangesEn : ''}`,
            user: userMsgEn
        };
    }
    return {
        system: `${currentStateSnapshot}你是故事记忆提取器。从对话中提取关键事件到短期记忆中。

输出必须以 _checkpoints 块开头：
{
  "_checkpoints": { "time": "当前故事时间（必填，即使未变化）", "scene": "当前场景/地点（必填，即使未变化）", "tone": "当前氛围" },
  "stm_entries": [...]
}

每个 stm_entries 条目包含：
- "period": 复制当前 state.time 值（最长15字）。禁止自行编造阶段标签。
- "scene": 场景名称（最长20字）
- "event": 事件描述——必填。具体到让读者理解发生了什么（20-80字）。
- "time_label": 阶段内的时间标签（最长8字）。仅当事件时间与 period 隐含时间不同时才填，否则留空。

如果没有叙事意义的事件，输出 {"_checkpoints": {"time": "...", "scene": "..."}, "stm_entries": []}。${schemaEnabled ? stateChangesZh : ''}`,
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
    var currentTime = state.global && state.global.time;
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

export async function executeIncrementalUpdate(chatId, newMessages, force) {
    const vault = await read(chatId);
    var processedIds = new Set();
    if (!force) {
        processedIds = collectProcessedMsgIds(vault);
    }
    var filteredMessages = force ? newMessages : filterNewMessages(newMessages, processedIds);
    if (filteredMessages.length === 0) return { vault: vault, added: 0 };

    var prompt = buildSTMUpdatePrompt(filteredMessages, vault);
    var response = await callMemoryLLM([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
    var parsed = parseSTMResponse(response);

    var validateErrors = validateSTMOutput(parsed, vault);
    if (validateErrors.length > 0) {
        console.warn('[NE] STM output validation failed, retrying:', validateErrors.join('; '));
        var retryMsg = 'YOUR PREVIOUS OUTPUT WAS REJECTED. Missing required fields:\n' +
            validateErrors.map(function(e) { return '- ' + e; }).join('\n') +
            '\n\nYou MUST include the _checkpoints block with "time" and "scene", and every stm_entries item MUST have "event".';
        var retryResponse = await callMemoryLLM([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
            { role: 'assistant', content: response },
            { role: 'user', content: retryMsg }
        ]);
        parsed = parseSTMResponse(retryResponse);
        var retryErrors = validateSTMOutput(parsed, vault);
        if (retryErrors.length > 0) {
            console.warn('[NE] STM retry also failed, using post-fill:', retryErrors.join('; '));
        }
    }

    postFillSTM(parsed, vault);
    var stmEntries = parsed.stmEntries;
    var stateChanges = parsed.stateChanges;

    if (stmEntries.length === 0 && Object.keys(stateChanges).length === 0) return { vault: vault, added: 0 };

    recordTelemetry({
        pipeline_task: 'stm_extract',
        new_stm_count: stmEntries.length,
        new_state_change_count: Object.keys(stateChanges).length,
        parse_error: parsed.error || null
    });

    if (stmEntries.length > 0) {
        var perEntry = Math.max(1, Math.floor(filteredMessages.length / stmEntries.length));
        stmEntries.forEach(function (entry, i) {
            var startIdx = i * perEntry;
            var endIdx = (i === stmEntries.length - 1) ? filteredMessages.length : (i + 1) * perEntry;
            entry.msg_ids = filteredMessages.slice(startIdx, endIdx).map(function (m) { return m.id || m.mes_id; }).filter(Boolean);
            entry.timestamp = new Date().toISOString();
            entry.parent_ltm = null;
        });
        appendSTMEntries(vault, stmEntries);
    }

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
                try {
                    var slots = await initPowerSlots(charName, existingSlotsForWorld);
                    if (slots && slots.length > 0) {
                        if (!newState.characters[charName]) newState.characters[charName] = {};
                        newState.characters[charName].power_slot_defs = slots;
                        var values = {};
                        slots.forEach(function (s) { values[s.key] = ''; });
                        newState.characters[charName].power_slots = values;
                        existingSlotsForWorld = existingSlotsForWorld.concat(slots.filter(function (s) {
                            return !existingSlotsForWorld.find(function (e) { return e.key === s.key; });
                        }));
                    }
                } catch (e) {
                    console.warn('[NE] initPowerSlots failed for', charName, ':', e);
                }
            }
        }
    }

    vault._meta = vault._meta || {};
    vault._meta.last_pipeline_task = 'stm_extract';
    vault._meta.last_pipeline_time = new Date().toISOString();

    await saveVaultWithSnapshot(chatId, vault);
    return { vault: vault, added: stmEntries.length };
}
