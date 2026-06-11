/**
 * engine/update.js — 增量更新引擎
 *
 * 核心循环：收集已处理 msg_id → 过滤新消息 → 构建 prompt → 调用 LLM → 解析 STM → 追加
 */
import { read, appendSTMEntries, markMessagesProcessed, collectProcessedMsgIds, getCursorState, updateCursorState } from '../vault/store.js';
import { callMemoryPipeline, callMemoryLLMWithTools, initPowerSlots, recordTelemetry, loadSecondaryApiConfig } from '../api/llm.js';
import { executeAccess } from '../tools.js';
import { validateStateChanges, mergeStateChanges, rebuildPresentCharacters, isStateSchemaEnabled, isDynamicStateMode, CORE_STATE_FIELDS } from '../vault/schema.js';
import { formatStateSummary } from '../vault/schema.js';
import { validateSTMOutput, postFillSTM, whitelistStateChanges } from './validate.js';
import { preGroupItems, formatPreGroupHint } from './bm25-grouper.js';
import { discoverDynamicFields, buildDynamicStatePrompt, formatDynamicStateSummary } from './state-discovery.js';
import { runStmCursorLoop } from './cursor.js';
import { pruneSnapshotsForChat } from '../vault/versions.js';

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
        // Prune snapshots beyond limit 30 (oldest first)
        try { await pruneSnapshotsForChat(chatId); } catch (e) { console.warn('[NE] pruneSnapshots error:', e); }
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
    // Core 字段始终初始化（不受 Schema 开关影响）
    if (!vault.content.state) vault.content.state = {};
    var state = vault.content.state;
    for (var ci = 0; ci < CORE_STATE_FIELDS.length; ci++) {
        var ck = CORE_STATE_FIELDS[ci];
        if (state[ck] === undefined) state[ck] = '';
    }
    vault.content.state_css = vault.content.state_css || '';

    // 扩展字段仅在 Schema ON 时初始化
    if (!isStateSchemaEnabled()) return;

    if (isDynamicStateMode()) {
        var ds = vault.content.dynamic_state;
        if (!ds || !(Object.keys(ds.global || {}).length > 0 || Object.keys(ds.characters || {}).length > 0)) {
            // dynamic_state 也没有扩展字段 → Core 已初始化
        } else {
            if (ds.global) {
                Object.keys(ds.global).forEach(function (k) {
                    if (state[k] === undefined) state[k] = '';
                });
            }
            if (ds.characters) {
                if (!state.characters) state.characters = {};
                Object.keys(ds.characters).forEach(function (name) {
                    if (!state.characters[name]) state.characters[name] = {};
                    var fields = ds.characters[name];
                    Object.keys(fields).forEach(function (k) {
                        if (state.characters[name][k] === undefined) state.characters[name][k] = '';
                    });
                });
            }
        }
    } else {
        // 预设模式：从 state_schema 中提取字段结构
        if (!state._initialized) {
            var schema = vault.content.state_schema;
            if (schema) {
                var extState = initStateFromSchema(schema);
                Object.keys(extState).forEach(function (ek) {
                    if (state[ek] === undefined) state[ek] = extState[ek];
                });
            }
            state._initialized = true;
        }
    }
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
        if (id === undefined) return false;
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
        var s = formatStateSummary(content.state, content.state_schema || null);
        if (s) currentStateSnapshot += 'Current state (for reference — only change what changes):\n' + s + '\n';
    }
    // ── 动态字段发现（从角色卡/世界书自动提取的状态栏字段，仅动态模式）──
    var dynamicState = isDynamicStateMode() ? content.dynamic_state : null;
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

Status transition rules:
- Characters who SPEAK or are PHYSICALLY PRESENT in the latest messages → status="活跃"
- Characters who were previously active but have LEFT the scene or aren't in the latest messages → status="非活跃"
- Characters who have died, retired, or permanently departed → status="已死亡" / "已归隐" / "已离去"
- Do NOT mark characters as 活跃 just because they were mentioned in passing — only if they are actually present in the scene
- The system will auto-decay stale characters after multiple rounds of absence, but you should proactively mark departures.

Status examples (right vs wrong):
✓ RIGHT: "张三走进酒馆坐下" → 张三.status="活跃" (actual scene presence)
✓ RIGHT: 连续多轮张三未出场 → will be auto-decayed to "非活跃" by system
✗ WRONG: "听说张三去了京城" → do NOT mark 张三 as 活跃 (mere mention, not present)
✗ WRONG: setting status="活跃" for a character who only appeared in past-tense narrative or flashback

Examples:
<state_changes>{"characters.Alice.status":"已死亡","characters.Bob.status":"活跃"}</state_changes>
<state_changes>{"characters.Charlie.status":"非活跃"}</state_changes>

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

出场状态转换规则：
- 在最新消息中说话或实际在场的角色 → status="活跃"
- 之前活跃但已离开场景或未在最新消息中出现的角色 → status="非活跃"
- 已死亡、隐退或永久离去的角色 → status="已死亡" / "已归隐" / "已离去"
- 不要仅因角色被提及就将其标为活跃 — 只有实际在场时才标为活跃
- 系统会在角色连续多轮缺席后自动衰减其状态，但你应该主动标记离场。

状态判例（正确 vs 错误）：
✓ 正确: "张三走进酒馆坐下" → 张三.status="活跃"（实际出场）
✓ 正确: 连续多轮张三未出场 → 系统将自动衰减为"非活跃"
✗ 错误: "听说张三去了京城" → 不应将张三标为活跃（仅提及，未出场）
✗ 错误: 将仅出现在过去时叙事或回忆场景中的角色设为"活跃"

要改变在场角色，更新其 status 字段。示例：
<state_changes>{"characters.爱丽丝.status":"已死亡","characters.鲍勃.status":"活跃"}</state_changes>
<state_changes>{"characters.小明.status":"非活跃"}</state_changes>

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
                '- "entities": optional — involved entity names with types. Each entry: {"name":"Alice","type":"character"}. Types: character(角色), item(物品), faction(势力), concept(概念), location(地点), event(事件). Plain string arrays ["Alice"] are still accepted and default to character. E.g. [{"name":"Alice","type":"character"}, {"name":"龙牙剑","type":"item"}, {"name":"魔教","type":"faction"}].\n' +
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
            '- "entities": （可选）事件涉及的实体名称和类型。每条：{"name":"Alice","type":"character"}。类型：character(角色), item(物品), faction(势力), concept(概念), location(地点), event(事件)。旧式字符串数组 ["Alice"] 仍被接受，默认视为角色。示例：[{"name":"Alice","type":"character"}, {"name":"龙牙剑","type":"item"}, {"name":"魔教","type":"faction"}]。\n' +
            '\n注意："period" 和 "scene" 会自动从全局数据填充，条目中无需包含。\n' +
            msgRangeInstructionZh +
            '\n如果没有叙事意义的事件，输出 {"_checkpoints": {"time": "...", "scene": "..."}, "stm_entries": []}。' + (schemaEnabled ? stateChangesZh : ''),
        user: userMsgZh
    };
}

export function parseSTMResponse(llmResponse) {
    var text = String(llmResponse || '').trim();
    // 剥离 <thought> 推理缓冲区
    text = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();

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
        var trimmed = text.trim();
        // Array-first: cursor responses start with [...] — parse them before greedy {.*} match
        if (trimmed.startsWith('[')) {
            try {
                var arrayMatch = text.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    stmEntries = JSON.parse(arrayMatch[0]);
                    if (!Array.isArray(stmEntries)) stmEntries = [];
                }
            } catch (e2) {}
        } else {
            var jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                var parsed = JSON.parse(jsonMatch[0]);
                if (parsed.stm_entries || parsed._checkpoints) {
                    checkpoints = parsed._checkpoints || null;
                    stmEntries = parsed.stm_entries || [];
                } else if (Array.isArray(parsed)) {
                    stmEntries = parsed;
                }
            }
        }
        // Fallback: if still empty and text starts with {, try again
        if (stmEntries.length === 0 && checkpoints === null && trimmed.startsWith('{')) {
            try {
                var arrayMatch2 = text.match(/\[[\s\S]*\]/);
                if (arrayMatch2) {
                    stmEntries = JSON.parse(arrayMatch2[0]);
                    if (!Array.isArray(stmEntries)) stmEntries = [];
                }
            } catch (e3) {}
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
            // LLM 输出格式为 [{path, value}] 数组，转换为内部使用的 {path: value} 扁平对象
            if (Array.isArray(parsedState)) {
                var flat = {};
                parsedState.forEach(function (item) {
                    if (item && item.path !== undefined) {
                        flat[item.path] = item.value;
                    }
                });
                parsedState = flat;
            }
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
    var currentTime = state.time || '';
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
         'IMPORTANT: Always use character proper names in event descriptions. Refer to the known characters and retrospective context above. Never use pronouns (I/he/she) or vague labels ("someone", "unknown girl").\n\n' +
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
         '重要：event 中涉及人物时必须使用角色全名。参考上方已知角色列表和往期上下文。禁止使用代词（我/他/她）或模糊指代（某人、无名少女等）。若仍无法确认身份，使用 access(msg_id) 追溯原文。\n\n' +
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

// ── State prompt builders（每种模式专用 prompt）──

function buildStatePrompt_Preset(messages, vault) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

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
    if (content.state && Object.keys(content.state).length > 0) {
        var s = formatStateSummary(content.state, content.state_schema || null);
        if (s) currentStateSnapshot += 'Current state (for reference):\n' + s + '\n';
    }

    var stateChangesEn = 'Global fields: time, scene, story_date, main_event — always track!\n' +
        '\nCharacter cards: state.characters.<name>.* — summary level: name, gender_age, occupation, personality, status, clothing_mode, inventory_mode, power_slots, affection(NPC), relationship(NPC), current_mood(NPC); detail level(vault): clothing_build, inventory, injuries, status_effects, power_slot_defs, inner_thoughts(NPC), past_experience(NPC)\n' +
        '- status: 活跃/非活跃/已死亡/已归隐/已离去\n- inventory_mode: 开启/静态/关闭\n- inventory: {gold: number, items: [{name, qty, equipped: true/false, desc}]} — detail level, updated in vault panel\n- power_slots: flat {key:"value"} JSON, no slot definitions in updates\n' +
        'present_characters is auto-computed — do NOT include it in <state_changes>\n' +
        '\nStatus transition rules:\n- 活跃 → 非活跃: when a character leaves the scene or stops appearing in messages\n- 活跃 → 已死亡/已归隐/已离去: permanent departure only\n- 非活跃 → 活跃: when a character re-enters the scene and actively participates\n- Do NOT mark as 活跃 just because a character was mentioned — only if they are actually present\n' +
        '\nnpc_names: array of character names that are NPCs — list ALL named characters EXCEPT the protagonist. If the story has NO clear single protagonist, list ALL characters here and label NO ONE as protagonist.\n' +
        '\nFactions: state.factions.<name>.* — name, description, leader, attitude_toward_player(友好/中立/冷淡/敌对), relations, notes(max 200)\n' +
        'Quests: state.quests.* — tasks/goals/events with name+status in prompt, detail via quest_lookup\n';

    var stateChangesZh = '\n角色卡: state.characters.<角色名>.* — summary级: name, gender_age, occupation, personality, status, clothing_mode, inventory_mode, power_slots, affection(NPC), relationship(NPC), current_mood(NPC); detail级(vault): clothing_build, inventory, injuries, status_effects, power_slot_defs, inner_thoughts(NPC), past_experience(NPC)\n' +
        '- status: 活跃/非活跃/已死亡/已归隐/已离去\n- inventory_mode: 开启/静态/关闭\n- inventory: {gold: 数值, items: [{name, qty, equipped: true/false, desc}]} — detail级，vault面板更新\n- power_slots: 扁平{key:"value"}JSON，更新勿含槽位定义\n' +
        'present_characters 自动计算 — 请勿在 <state_changes> 中包含\n' +
        '\n出场状态转换规则：\n- 活跃 → 非活跃: 角色离开场景或不再出现在消息中\n- 活跃 → 已死亡/已归隐/已离去: 仅限永久退场\n- 非活跃 → 活跃: 角色重新进入场景并活跃参与\n- 不要仅因角色被提及就标为活跃 — 只有实际在场时才标活跃\n' +
        '\nnpc_names: NPC角色名数组 — 列出除主控角色外的所有具名角色。如果故事中没有明确的单一主控角色，此处列出所有角色名，不要将任何人标记为主控。\n' +
        '\n势力: state.factions.<名称>.* — name, description, leader, attitude_toward_player(友好/中立/冷淡/敌对), relations, notes(最长200)\n' +
        '任务: state.quests.* — tasks/goals/events，name+status注入prompt，详情通过quest_lookup获取\n';

    var hardGateEn = '\n============================================================\n【HARD GATE — FORBIDDEN】\n============================================================\n- Skip Part 2 (no <state_changes>)\n- Empty <state_changes></state_changes>\n- Miss characters in conversation\n- Include present_characters in any path\n- Omit npc_names or label all characters as protagonist\n============================================================\n';
    var hardGateZh = '\n============================================================\n【HARD GATE — 绝对禁止】\n============================================================\n- 跳过第二部分（不输出 <state_changes>）\n- 输出空的 <state_changes></state_changes>\n- 遗漏对话中明显出现的角色\n- 在任何路径中包含 present_characters\n- 遗漏 npc_names 或将所有角色都标为主控\n============================================================\n';

    if (lang === 'en') {
        return {
            system: currentStateSnapshot + 'You are a story state tracker. Track character state changes, quest progress, faction relations.\n\n' +
                'IMPORTANT: You MUST output ALL three parts below in ONE continuous response. Do NOT stop after <thought>.\n\n' +
                '<thought>\nAnalyze step by step:\n1. Time & scene changes\n2. Identify NPCs (all characters EXCEPT the single protagonist; if no clear protagonist, ALL are NPCs)\n3. Each character\'s state changes\n4. Quest/event/goal progress\n5. Faction relation changes\n6. List each change for state_changes (including npc_names)\n</thought>\n' +
                '{"_checkpoints":{"time":"Evening","scene":"Mansion Living Room","story_date":"Day 1"}}\n' +
                '<state_changes>\n[{"path":"time","value":"Evening"},{"path":"scene","value":"Mansion Living Room"},{"path":"story_date","value":"Day 1"},{"path":"main_event","value":"Arriving at the mansion"},{"path":"npc_names","value":["Bob"]},{"path":"characters.Alice.status","value":"活跃"},{"path":"characters.Alice.personality","value":"..."}]\n' +
                '</state_changes>\n\n' +
                stateChangesEn + hardGateEn,
            user: 'Recent messages:\n\n' + msgTexts + '\n\nExtract story time, scene, and ALL character state changes. Output <thought> → _checkpoints → <state_changes> in ONE response. DO NOT stop after <thought>.'
        };
    }
    return {
        system: currentStateSnapshot + '你是故事状态追踪器。追踪角色状态变化、任务进展、势力关系变化。\n\n' +
            '重要：你必须一次性输出以下全部内容，不可在 <thought> 之后就停止！\n\n' +
            '<thought>\n逐步分析：\n1. 时间和场景变化\n2. 识别NPC（除单一主控角色外的所有角色；无明确主控则全部为NPC）\n3. 每个角色的状态变化\n4. 任务/事件/目标进展\n5. 势力关系变化\n6. 逐条列出需写入state_changes的变更（包括npc_names）\n</thought>\n' +
            '{"_checkpoints":{"time":"傍晚","scene":"洋馆客厅","story_date":"Day 1"}}\n' +
            '<state_changes>\n[{"path":"time","value":"傍晚"},{"path":"scene","value":"洋馆客厅"},{"path":"story_date","value":"Day 1"},{"path":"main_event","value":"抵达洋馆"},{"path":"npc_names","value":["紫瞳女孩"]},{"path":"characters.江岚.status","value":"活跃"},{"path":"characters.江岚.personality","value":"..."}]\n' +
            '</state_changes>\n\n' +
            stateChangesZh + hardGateZh,
        user: '最近的对话消息：\n\n' + msgTexts + '\n\n提取故事时间、场景和所有角色状态变化。一次性输出 <thought> → _checkpoints → <state_changes>，不可在 thought 后停止！'
    };
}

function buildStatePrompt_Dynamic(messages, vault) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var ds = content.dynamic_state;

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

    var dynamicFieldSummary = '';
    if (ds && (Object.keys(ds.global || {}).length > 0 || Object.keys(ds.characters || {}).length > 0)) {
        var dsText = formatDynamicStateSummary(ds);
        if (dsText) {
            currentStateSnapshot += dsText;
            dynamicFieldSummary = dsText;
        }
    }

    var stateChangesEn = '\nCharacter cards: state.characters.<name>.* — use ONLY discovered fields, NOT preset (name/gender_age/occupation etc).\n' +
        'Discovered fields:\n' + (dynamicFieldSummary || 'use fields from character cards/world books') + '\n' +
        'Active grouping: status="活跃" → auto-add to present_characters. No status field → all active.\n' +
        'present_characters is auto-computed — do NOT include.\n' +
        '\nStatus transition rules:\n' +
        '- Characters who SPEAK or are PHYSICALLY PRESENT in the latest messages → status="活跃"\n' +
        '- Characters who were previously active but have LEFT the scene or aren\'t in the latest messages → status="非活跃"\n' +
        '- Characters who have died, retired, or permanently departed → status="已死亡"/"已归隐"/"已离去"\n' +
        '- Do NOT mark characters as 活跃 just because they were mentioned in passing\n' +
        '\nnpc_names: array of NPC character names — ALL named characters EXCEPT the protagonist. If NO clear single protagonist → list ALL here, no one is protagonist.\n' +
        '\nFactions (preset schema): state.factions.<name>.* — name, description, leader, attitude_toward_player, relations, notes\n' +
        'Quests (preset schema): state.quests.* — tasks/goals/events, name+status in prompt, detail via quest_lookup\n';

    var stateChangesZh = '\n角色卡: state.characters.<角色名>.* — 仅使用动态发现字段，不用预设(name/gender_age/occupation等)。\n' +
        '发现字段:\n' + (dynamicFieldSummary || '使用角色卡/世界书发现的字段') + '\n' +
        '活跃分组: status="活跃"→自动加入present_characters。无status字段→全部活跃。\n' +
        'present_characters 自动计算 — 请勿包含。\n' +
        '\n出场状态转换规则：\n' +
        '- 在最新消息中说话或实际在场的角色 → status="活跃"\n' +
        '- 之前活跃但已离开场景或未在最新消息中出现的角色 → status="非活跃"\n' +
        '- 已死亡、隐退或永久离去的角色 → status="已死亡"/"已归隐"/"已离去"\n' +
        '- 不要仅因角色被提及就将其标为活跃 — 只有实际在场时才标活跃\n' +
        '\nnpc_names: NPC角色名数组 — 除主控角色外的所有具名角色。如果没有明确的单一主控角色，列出所有角色，不将任何人标为主控。\n' +
        '\n势力(预设schema): state.factions.<名称>.* — name, description, leader, attitude_toward_player, relations, notes\n' +
        '任务(预设schema): state.quests.* — tasks/goals/events，name+status注入prompt，详情quest_lookup\n';

    var hardGateEn = '\n============================================================\n【HARD GATE — FORBIDDEN】\n============================================================\n- Skip Part 2 (no <state_changes>)\n- Empty <state_changes>\n- Use preset fields instead of discovered fields\n- Include present_characters in any path\n============================================================\n';
    var hardGateZh = '\n============================================================\n【HARD GATE — 绝对禁止】\n============================================================\n- 跳过第二部分\n- 输出空的 <state_changes>\n- 使用预设字段而非动态发现字段\n- 在任何路径中包含 present_characters\n============================================================\n';

    if (lang === 'en') {
        return {
            system: currentStateSnapshot + 'You are a story state tracker (Dynamic Mode). Track character state changes using discovered fields from character cards/world books.\n\n' +
                'IMPORTANT: You MUST output ALL three parts below in ONE continuous response. Do NOT stop after <thought>.\n\n' +
                '<thought>\nAnalyze step by step:\n1. Time & scene changes\n2. Identify NPCs (all characters EXCEPT the single protagonist; if no clear protagonist, ALL are NPCs)\n3. Identify characters present\n4. Check each character for changes in discovered fields: ' + (dynamicFieldSummary || 'discovered fields') + '\n5. List each change for state_changes (including npc_names)\n</thought>\n' +
                '{"_checkpoints":{"time":"Evening","scene":"Mansion Living Room","story_date":"Day 1"}}\n' +
                '<state_changes>\n[{"path":"time","value":"Evening"},{"path":"scene","value":"Mansion Living Room"},{"path":"story_date","value":"Day 1"},{"path":"main_event","value":"Arriving at the mansion"},{"path":"npc_names","value":["Bob"]},{"path":"characters.Alice.{field}","value":"..."}]\n' +
                '</state_changes>\n\n' +
                stateChangesEn + hardGateEn,
            user: 'Recent messages:\n\n' + msgTexts + '\n\nExtract story time, scene, and character state changes using ONLY discovered fields. Output <thought> → _checkpoints → <state_changes> in ONE response. DO NOT stop after <thought>.'
        };
    }
    return {
        system: currentStateSnapshot + '你是故事状态追踪器（动态模式）。使用从角色卡/世界书动态发现的字段追踪角色状态变化。\n\n' +
            '重要：你必须一次性输出以下全部内容，不可在 <thought> 之后就停止！\n\n' +
            '<thought>\n逐步分析：\n1. 时间和场景变化\n2. 识别NPC（除单一主控角色外的所有角色；无明确主控则全部为NPC）\n3. 找出所有角色\n4. 检查每个角色的动态发现字段变化: ' + (dynamicFieldSummary || '发现的字段') + '\n5. 逐条列出需写入state_changes的变更（包括npc_names）\n</thought>\n' +
            '{"_checkpoints":{"time":"傍晚","scene":"洋馆客厅","story_date":"Day 1"}}\n' +
            '<state_changes>\n[{"path":"time","value":"傍晚"},{"path":"scene","value":"洋馆客厅"},{"path":"story_date","value":"Day 1"},{"path":"main_event","value":"抵达洋馆"},{"path":"npc_names","value":["紫瞳女孩"]},{"path":"characters.江岚.{字段}","value":"..."}]\n' +
            '</state_changes>\n\n' +
            stateChangesZh + hardGateZh,
        user: '最近的对话消息：\n\n' + msgTexts + '\n\n提取故事时间、场景和角色状态变化——仅使用上述动态发现字段。一次性输出 <thought> → _checkpoints → <state_changes>，不可在 thought 后停止！'
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
    Object.keys(state.characters).forEach(function (name) {
        var card = state.characters[name];
        if (card && card.status === '活跃') {
            if (msgText.indexOf(name) === -1) {
                card.status = '非活跃';
                changed = true;
                console.log('[NE] Auto-decayed inactive character:', name);
            }
        }
    });
    if (changed) {
        state = rebuildPresentCharacters(state);
    }
    return state;
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

    var stateParsed = null;
    if (isStateSchemaEnabled()) {
        // ═══════════════════════════════════════════
        // Pipeline 1: State（独立 — 自管 LLM 调用 + 结果处理 + 持久化）
        // ═══════════════════════════════════════════
        var stateChanges = {};
        var statePrompt = isDynamicStateMode()
            ? buildStatePrompt_Dynamic(filteredMessages, vault)
            : buildStatePrompt_Preset(filteredMessages, vault);
        try {
            console.log('[NE] State LLM prompt sizes — system=' + statePrompt.system.length + ', user=' + statePrompt.user.length);
            var stateResponse = await callMemoryPipeline([
                { role: 'system', content: statePrompt.system },
                { role: 'user', content: statePrompt.user }
            ]);
            stateParsed = parseSTMResponse(stateResponse);
            stateChanges = stateParsed.stateChanges || {};
            console.log('[NE] State pipeline — response len=' + (stateResponse ? stateResponse.length : 0) + ', _checkpoints=' + !!stateParsed._checkpoints + ', stateChanges keys=' + Object.keys(stateChanges).length);
            // 始终打印 raw response 前 600 字符用于诊断
            if (stateResponse && stateResponse.length > 0) {
                console.log('[NE-DEBUG] State LLM raw response (first 600):', stateResponse.substring(0, 600));
            }
            if (isStateSchemaEnabled() && Object.keys(stateChanges).length === 0 && stateResponse && stateResponse.length > 0) {
                console.log('[NE] State LLM — NO state_changes extracted. Tag found in raw:', /<state_changes>/i.test(stateResponse));
            }
            if (!stateResponse || stateResponse.length < 10) {
                console.warn('[NE] State phase returned empty/minimal response (' + (stateResponse ? stateResponse.length : 0) + ' chars) — state not updated');
            }

            // 1a. 写入 story_time/story_scene，让 cursor 能引用最新状态
            if (stateParsed._checkpoints) {
                postFillSTM({ stmEntries: [], _checkpoints: stateParsed._checkpoints, stateChanges: {} }, vault);
                try { await saveVaultWithSnapshot(chatId, vault); } catch (e) { console.warn('[NE] State checkpoint save failed:', e); }
            }

            // 1b. 处理 state_changes（merge、power slots、quests）—— 独立完成
            console.log('[NE] State pipeline — schemaEnabled=' + isStateSchemaEnabled() + ', hasStateChanges=' + (Object.keys(stateChanges).length > 0) + ', willProcess=' + (isStateSchemaEnabled() && Object.keys(stateChanges).length > 0));
            if (Object.keys(stateChanges).length > 0) {
                var schema = vault.content.state_schema || null;
                var result = validateStateChanges(schema, stateChanges);
                if (result.warnings.length > 0) console.warn('[NE] State change warnings:', result.warnings);
                var oldState = vault.content.state || {};
                var oldCharNames = Object.keys(oldState.characters || {});
                vault.content.state = mergeStateChanges(vault.content.state || {}, result.validated);
                handleQuestCompletion(vault.content.state, result.validated);
                vault.content.state = autoDecayStaleCharacters(vault.content.state, filteredMessages);

                // Power slot init（fire-and-forget，不阻塞 pipeline）
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

                if (stateChanges.story_date) {
                    vault.content.story_date = String(stateChanges.story_date);
                }

                vault._meta = vault._meta || {};
                vault._meta.last_pipeline_task = 'state_extract';
                vault._meta.last_pipeline_time = new Date().toISOString();
                try { await saveVaultWithSnapshot(chatId, vault); } catch (e) { console.warn('[NE] State changes save failed:', e); }

                console.log('[NE] State pipeline — state_changes saved, state keys=' + Object.keys(vault.content.state || {}).length);

                recordTelemetry({
                    pipeline_task: 'state_extract',
                    new_state_change_count: Object.keys(stateChanges).length,
                    parse_error: null
                }, chatId);
            }
        } catch (e) {
            console.warn('[NE] State pipeline failed:', e);
        }
    }

    // ═══════════════════════════════════════════
    // Pipeline 2: Cursor（独立 — 自管 LLM 调用 + 结果处理 + 持久化）
    // ═══════════════════════════════════════════
    console.log('[NE] Cursor pipeline starting — messages=' + filteredMessages.length);
    var cursorResult = { vault: vault, cursorState: null, totalAdded: 0 };
    var newEntries = [];
    try {
        cursorResult = await runStmCursorLoop({
            vault: vault,
            messages: filteredMessages,
            callLLM: (function() {
                var secCfg = loadSecondaryApiConfig();
                if (secCfg && secCfg.url && secCfg.model) {
                    var accessSchema = {
                        type: 'function',
                        function: {
                            name: 'access',
                            description: 'Read original message text by msg ID. Use when you need to disambiguate speaker identity (e.g. access("15") to check who "he" refers to). Also supports memory/state references.',
                            parameters: { type: 'object', properties: { ref: { type: 'string', description: 'Reference string: msg ID (e.g. "15"), "stm_xxx", "ltm_xxx", "characters.Name"' } }, required: ['ref'] }
                        }
                    };
                    return function(promptMsgs) {
                        return callMemoryLLMWithTools(promptMsgs, [accessSchema], {
                            access: function(args) {
                                var ref = args.ref || '';
                                var fm = filteredMessages;
                                for (var k = 0; k < fm.length; k++) {
                                    if (String(fm[k].id || fm[k].mes_id) === String(ref)) {
                                        return (fm[k].content || fm[k].mes || '') + ' [msg ' + ref + ']';
                                    }
                                }
                                try {
                                    return executeAccess(ref, null, getChatId, getChatMessages);
                                } catch (e2) {
                                    return 'Not found: ' + ref;
                                }
                            }
                        });
                    };
                }
                return callMemoryPipeline;
            })(),
            parseResponse: parseSTMResponse,
            validateOutput: validateSTMOutput,
            postFill: function(parsed, v) { postFillSTM(parsed, v); },
            appendEntries: function(v, entries) { appendSTMEntries(v, entries, null, false); },
            getCursorState: getCursorState,
            updateCursorState: updateCursorState,
            markProcessed: function(v, ids) { markMessagesProcessed(v, ids); },
            buildPrompt: buildCursorPrompt
        });

        newEntries = (vault.content.stm_entries || []).slice(-Math.max(1, cursorResult.totalAdded));
        if (cursorResult.totalAdded === 0) newEntries = [];

        // Post-fill STM entries with _checkpoints
        if (newEntries.length > 0) {
            if (stateParsed && stateParsed._checkpoints) {
                postFillSTM({ stmEntries: newEntries, _checkpoints: stateParsed._checkpoints, stateChanges: {} }, vault);
            } else {
                var chk = vault.content.cursor_state && vault.content.cursor_state.stm ? vault.content.cursor_state.stm._checkpoints : null;
                if (chk) postFillSTM({ stmEntries: newEntries, _checkpoints: chk, stateChanges: {} }, vault);
            }
        }

        // Cursor 自主持久化
        if (cursorResult.totalAdded > 0) {
            vault._meta = vault._meta || {};
            vault._meta.last_pipeline_task = 'stm_extract';
            vault._meta.last_pipeline_time = new Date().toISOString();
            try { await saveVaultWithSnapshot(chatId, vault); } catch (e) { console.warn('[NE] Cursor save failed:', e); }

            recordTelemetry({
                pipeline_task: 'stm_extract',
                new_stm_count: newEntries.length,
                parse_error: null
            }, chatId);
        }
    } catch (e) {
        console.warn('[NE] Cursor pipeline failed:', e);
    }

    return { vault: vault, added: newEntries.length };
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

    var statePrompt = isDynamicStateMode()
        ? buildStatePrompt_Dynamic(messages, vault)
        : buildStatePrompt_Preset(messages, vault);

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
        vault.content.state = autoDecayStaleCharacters(vault.content.state, messages);
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
    }, chatId);

    return { vault, changed: true };
}
