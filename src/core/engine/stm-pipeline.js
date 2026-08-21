import { readMemory, readState, appendSTMEntries, collectAllMsgIds, sortStmByMsgOrder } from '../vault/store.js';
import { isStateSchemaEnabled } from '../vault/schema.js';
import { safeJsonParse } from './json-fallback.js';
import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';
import { groupMessagesIntoTurns, formatTurnsText, collectMsgIdsFromTurns } from './turn-segmenter.js';
import { initializeMemoryChain } from '../vault/state-versions.js';
import { isLtmEnabled, findOpenLtm, formatLtmCatalog, computeClosureSignals } from './consolidate.js';
import { saveMemoryVault, filterNewMessages } from './pipeline-shared.js';
import { _checkChatIntegrity, _resetCheckChatTag } from './pipeline-shared.js';
import { preGroupItems, formatPreGroupHint } from './bm25-grouper.js';
import { validateSTMOutput, postFillSTM } from './validate.js';
import { readNeSettingsCached } from '../settings.js';
import { cleanMessageText } from './content-clean.js';
import { resolveChunkEvents } from './stm-resolver.js';

function buildCursorPrompt(windowItems, position, pendingPartials, vault, stateVault, force) {
    var content = vault.content || {};
    var stateContent = stateVault && stateVault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    // 格式化窗口消息
    var stripTags = (readNeSettingsCached().customStripTags) || [];
    var itemsText = windowItems.map(function(item, i) {
        var idx = i;
        var role = item.role || (item.is_user ? 'user' : 'assistant');
        var name = item.name ? item.name + ': ' : '';
        return '[' + idx + '] ' + role + ': ' + name + cleanMessageText(item.content || item.mes || '', stripTags);
    }).join('\n');

    // 当前状态摘要
    var currentStateSnapshot = '';
    if (stateContent.story_time || stateContent.story_scene || stateContent.story_date) {
        currentStateSnapshot = 'story_day: ' + (stateContent.story_time || '') + '\nstory_date: ' + (stateContent.story_date || '') + '\nstory_scene: ' + (stateContent.story_scene || '') + '\n';
    }
    var state = stateContent.state || {};
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
         '- "present_characters": REQUIRED — array of full names of characters who actually appear in this event (have dialogue or action). Mentioning ≠ present\n' +
         '- "character_psyche": OPTIONAL — object keyed by character full name, only for characters whose inner thoughts/mood are shown in this event. Value: {"current_mood": "...", "inner_thoughts": "..."}\n' +
         '- "translation": optional Chinese translation for cross-language search\n' +
         '- "time_label": optional — only if time differs from current\n' +
         '\nNote: "period" and "scene" are NOT needed — do NOT include them.\n' +
         'Messages must be covered contiguously, no skipping.\n' +
         'If window content is insufficient for a complete event → return status:"partial".') :
        (retrospectiveCtx + currentStateSnapshot + '你是故事记忆提取器。从以下 ' + windowItems.length + ' 条消息中提取关键事件。\n\n' +
         '每个条目包含：\n' +
         '- "event"（必填，20-80字）\n' +
         '- "msgRange": [startIdx, endIdx]（必填）\n' +
         '- "status": "closed" | "partial"（必填）\n' +
         '- "present_characters"（必填）：本段事件中明确有台词或动作的角色全名数组。提及≠在场\n' +
         '- "character_psyche"（可选）：本段事件中有内心活动展示的角色心理状态。仅为本段中明确出现心理描写的角色填写。格式：{"角色全名": {"current_mood": "情绪", "inner_thoughts": "内心想法"}}\n' +
         '- "translation": 可选英文翻译，用于跨语言检索\n' +
         '- "time_label": 可选 — 仅当事件时间与当前不同时填写\n' +
         '\n注意："period" 和 "scene" 条目中无需包含。\n' +
         '消息必须连续覆盖，不能跳过。\n' +
         '如果窗口内消息不足以形成完整事件 → 返回 status:"partial"。');

    if (partialCtx) instruction += '\n' + partialCtx;
    if (preGroupHint) instruction += '\n' + preGroupHint;
    if (force) instruction += '\n\n⚠️ 已到达窗口上限，请务必覆盖全部消息，不得跳过任何一条。不允许返回空数组。';

    var userEnding = force
        ? (lang === 'en' ? 'All messages must be covered. Do not skip any.' : '所有消息均须覆盖，禁止跳过。')
        : (lang === 'en' ? 'If nothing significant, return [].' : '如果没有重要事件，返回 []。');
    var userPrompt = lang === 'en' ?
        'IMPORTANT: Always use character proper names in event descriptions. Refer to the known characters and retrospective context above. Never use pronouns (I/he/she) or vague labels ("someone", "unknown girl").\n\nMessages:\n' + itemsText + '\n\nOutput ONLY a JSON array:\n[\n  { "event": "...", "msgRange": [0, 2], "status": "closed"|"partial", "present_characters": ["Name1","Name2"], "character_psyche": {"Name1": {"current_mood": "...", "inner_thoughts": "..."}}, "translation": "...", "parent_partial": null },\n  ...\n]\n' + userEnding :
'重要：event 中涉及人物时必须使用角色全名。参考上方已知角色列表和往期上下文。禁止使用代词（我/他/她）或模糊指代（某人、无名少女等）。若仍无法确认身份，使用 access(msg_id) 追溯原文。\n\n消息：\n' + itemsText + '\n\n仅输出一个 JSON 数组：\n[\n  { "event": "...", "msgRange": [0, 2], "status": "closed"|"partial", "present_characters": ["角色1","角色2"], "character_psyche": {"角色1": {"current_mood": "...", "inner_thoughts": "..."}}, "translation": "...", "parent_partial": null },\n  ...\n]\n' + userEnding;

    return { system: instruction, user: userPrompt };
}

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
        (retrospectiveCtx + '\nYou are a story memory extractor. Create one event entry for every continuous plot segment in the dialog below. All turns must be covered — no omissions.\n\nOutput JSON with this schema:\n{\n  "analysis": "Your step-by-step reasoning about the events (free text, will be ignored for extraction)",\n  "events": [\n    {\n      "event": "one-sentence description (20-160 chars, use proper names, no pronouns)",\n      "period": "inferred time. If multiple time formats appear (e.g. both Day 1 and 2024-05-22 07:20), pick the MOST PRECISE one — datetime > date > ordinal day > vague period. Use same format as prior events. If unsure: \\"-\\"",\n      "scene": "inferred scene. If unsure: \\"-\\"",\n      "turns": "turn range like 0-3, 4-5. Max turn is ' + maxTurnLabel + '",\n      "present_characters": ["full name of characters who actually appear in this segment (have dialogue or action). Mentioning ≠ present"],\n      "character_psyche": {"CharacterName": {"current_mood": "mood/emotion shown", "inner_thoughts": "inner monologue shown"}}\n    }\n  ]\n}\n\nRules:\n- Cover ALL turns from 0 to ' + maxTurnLabel + '. No gaps.\n- Events partition the turns with NO overlap. If event A covers 0-2, event B must start at 3.\n- Do NOT create events for turns beyond ' + maxTurnLabel + '.\n- If a turn is continuous with the preceding content and does not form an independent scene, merge it into the adjacent event.\n- Within this batch, later events must not duplicate earlier ones.\n- Use character proper names only. No pronouns.\n- present_characters: only characters with actual dialogue or action in this segment. Optional empty array [] if no characters appear.\n- character_psyche: only for characters whose inner thoughts/mood are explicitly shown. Omit if none.\n- If no valid events can be extracted, set events to empty array [].' + ltmAppend) :
        (retrospectiveCtx + '\n你是故事记忆提取器。为下列对话中每一段连续剧情生成一个事件条目。必须覆盖全部 turn，不得遗漏。\n\n输出 JSON，schema 如下：\n{\n  "analysis": "你的逐步推理（自由文本，不会用于提取）",\n  "events": [\n    {\n      "event": "一句话事件描述（20-160字，使用角色全名，禁止代词）",\n      "period": "推断的时间。如果消息中同时出现多种时间格式（如第1天和2024-05-22 07:20），请选择最精确的表达——具体日期+时刻 > 具体日期 > 第N天 > 泛化时段。必须使用与往期事件相同的格式。若无法判断：\\"-\\"",\n      "scene": "推断的场景。若无法判断：\\"-\\"",\n      "turns": "turn 范围如 0-3, 4-5。最大 turn 为 ' + maxTurnLabel + '",\n      "present_characters": ["本段事件中明确有台词或动作的角色全名。提及≠在场"],\n      "character_psyche": {"角色全名": {"current_mood": "情绪", "inner_thoughts": "内心想法"}}\n    }\n  ]\n}\n\n规则：\n- 必须覆盖 0~' + maxTurnLabel + ' 的所有 turns，不能留空。\n- 事件之间互不重叠。若事件 A 覆盖 0-2，事件 B 必须从 3 开始。\n- 禁止为超出 ' + maxTurnLabel + ' 的 turn 创建事件。\n- 如果某 turn 内容与前文连续且不构成独立剧情，必须并入相邻事件。\n- 同一批次内，后文事件不能与前文事件重复。往期事件只作为时间格式参考。\n- 使用角色全名，禁止代词。\n- present_characters：仅包含本段中真正有台词或动作的角色。无角色出场时为空数组 []。\n- character_psyche：仅为本段中明确出现心理描写的角色填写。无则省略该字段。\n- 如果无法提取有效事件，将 events 设为空数组 []。' + ltmAppend);

    return { system: system, user: userText };
}

export function buildStmOnlyPrompt(turns, vault, ratio) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var retrospectiveCtx = buildRetrospectiveContext(content);
    var _ratio = ratio || 0.05;
    var CHAR_FACTOR = lang === 'en' ? 0.25 : 1.0;
    var MIN_CHARS = lang === 'en' ? 40 : 10;
    var MAX_CHARS = 400;

    var turnsText = [];
    var totalChars = 0;
    for (var ti = 0; ti < turns.length; ti++) {
        var t = turns[ti];
        if (!t) continue;
        var line = '[Turn ' + ti + ']';
        turnsText.push(line);
        totalChars += line.length;
        if (t.user) {
            var uname = t.user.name ? t.user.name + ': ' : '';
            var uline = '  user: ' + uname + (t.user.content || t.user.mes || '');
            turnsText.push(uline);
            totalChars += uline.length;
        }
        if (t.assistant) {
            var aname = t.assistant.name ? t.assistant.name + ': ' : '';
            var aline = '  assistant: ' + aname + (t.assistant.content || t.assistant.mes || '');
            turnsText.push(aline);
            totalChars += aline.length;
        }
        turnsText.push('');
    }

    var recommended = Math.round(totalChars * _ratio * CHAR_FACTOR);
    recommended = Math.max(MIN_CHARS, Math.min(MAX_CHARS, recommended));
    var unit = lang === 'en' ? 'chars' : '\u5B57';
    var guidanceLine = lang === 'en'
        ? 'TOTAL input ~' + totalChars + ' chars. Recommended summary per event: ~' + Math.round(recommended / Math.max(1, turns.length / 3)) + ' chars (based on ' + Math.round(_ratio * 100) + '% compression ratio).\n\n'
        : '\u601D\u539F\u6587\u7EA6 ' + totalChars + ' ' + unit + '\uFF0C\u6BCF\u6761\u4E8B\u4EF6\u63A8\u8350\u6458\u8981\u7EA6 ' + Math.round(recommended / Math.max(1, turns.length / 3)) + ' ' + unit + '\uFF08\u57FA\u4E8E ' + Math.round(_ratio * 100) + '% \u538B\u7F29\u6BD4\uFF09\u3002\n\n';

    var userText = guidanceLine + turnsText.join('\n');
    var maxTurnLabel = turns.length - 1;

    var system = lang === 'en' ?
        (retrospectiveCtx + '\nYou are a story memory extractor. Create one event entry for every continuous plot segment in the dialog below. All turns must be covered — no omissions.\n\nOutput JSON with this schema:\n{\n  "analysis": "Your step-by-step reasoning about the events (free text, will be ignored for extraction)",\n  "events": [\n    {\n      "event": "one-sentence description (use proper names, no pronouns)",\n      "period": "inferred time. If multiple time formats appear, pick the MOST PRECISE one — datetime > date > ordinal day > vague period. Use same format as prior events as a template. Unsure: \\"-\\"",\n      "scene": "inferred scene. Unsure: \\"-\\"",\n      "turns": "turn range like 0-3, 4-5. Max turn is ' + maxTurnLabel + '",\n      "present_characters": ["full names of characters who appear in this segment (dialogue or action)"],\n      "character_psyche": {"CharacterName": {"current_mood": "...", "inner_thoughts": "..."}}\n    }\n  ]\n}\n\nWhen to start a NEW event (any ONE condition met):\n1. Time clearly shifts (implied or stated in dialog)\n2. Scene/location changes\n3. A character enters or leaves\n4. Plot goal or action arc changes direction\nIf NONE of these change, adjacent turns MUST be merged into one event.\n\nRules:\n- Cover ALL turns from 0 to ' + maxTurnLabel + '. No gaps.\n- Events partition the turns with NO overlap. If event A covers 0-2, event B must start at 3.\n- Do NOT create events for turns beyond ' + maxTurnLabel + '.\n- Within this batch, later events must not duplicate earlier ones.\n- Use character proper names only. No pronouns.\n- present_characters: only characters with actual dialogue or action. Empty array [] if none.\n- character_psyche: only for characters whose inner thoughts/mood are shown. Omit if none.\n- Trivial turns (greetings, acknowledgments, filler) merge into the nearest meaningful event. Do NOT fabricate events for them.\n- If the entire batch has no plot content, set events to empty array [].') :
        (retrospectiveCtx + '\n你是故事记忆提取器。为下列对话中每一段连续剧情生成一个事件条目。必须覆盖全部 turn，不得遗漏。\n\n输出 JSON，schema 如下：\n{\n  "analysis": "你的逐步推理（自由文本，不会用于提取）",\n  "events": [\n    {\n      "event": "一句话事件描述（使用角色全名，禁止代词）",\n      "period": "推断的时间。如果消息中同时出现多种时间格式，请选择最精确的表达——具体日期+时刻 > 具体日期 > 第N天 > 泛化时段。往期事件的 period 仅为格式模板——请复用其命名规范。若无法判断：\\"-\\"",\n      "scene": "推断的场景。若无法判断：\\"-\\"",\n      "turns": "turn 范围如 0-3, 4-5。最大 turn 为 ' + maxTurnLabel + '",\n      "present_characters": ["本段中明确有台词或动作的角色全名"],\n      "character_psyche": {"角色全名": {"current_mood": "情绪", "inner_thoughts": "内心想法"}}\n    }\n  ]\n}\n\n新事件的判断标准（满足任意一项即构成新事件）：\n1. 时间有明显推移（对话中暗示或明示）\n2. 场景位置改变\n3. 有新角色入场或旧角色离场\n4. 剧情目标或行动发生转折\n如果以上条件全部未变，相邻 turn 必须合并为一个事件。\n\n规则：\n- 必须覆盖 0~' + maxTurnLabel + ' 的所有 turns，不能留空。\n- 事件之间互不重叠。若事件 A 覆盖 0-2，事件 B 必须从 3 开始。\n- 禁止为超出 ' + maxTurnLabel + ' 的 turn 创建事件。\n- 同一批次内，后文事件不能与前文事件重复。往期事件只作为时间格式参考。\n- 使用角色全名，禁止代词。\n- present_characters：仅包含本段中真正有台词或动作的角色。无角色出场时为空数组 []。\n- character_psyche：仅为本段中明确出现心理描写的角色填写。无则省略该字段。\n- 琐碎内容（问候、应答、语气词）直接并入最近的有意义事件，不要为其硬编事件。\n- 如果整个 batch 都没有可提取的有效事件，将 events 设为空数组 []。');

    return { system: system, user: userText };
}

async function segmentTurns(turns, vault, callLLM) {
    if (!turns || turns.length === 0) return [];
    return [[0, turns.length - 1]];
}

// P5: 区间唯一键（用于格式化结果缓存复用）
function segKey(seg) {
    return seg[0] + ':' + seg[1];
}

function splitIntraSegment(seg, turns, maxChars) {
    var subSegments = [];
    var subStart = seg[0];
    var subChars = 0;

    for (var ti = seg[0]; ti <= seg[1]; ti++) {
        var turnText = formatTurnsText(turns, [ti]);
        var turnChars = turnText.length;

        if (subChars + turnChars > maxChars && ti > subStart) {
            subSegments.push([subStart, ti - 1]);
            subStart = ti;
            subChars = turnChars;
        } else {
            subChars += turnChars;
        }
    }

    subSegments.push([subStart, seg[1]]);
    return subSegments;
}

export function chunkSegmentsForLLM(segments, turns, maxChars, segTexts) {
    var chunks = [];
    var currentChunk = [];
    var currentChars = 0;

    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        var segTurns = [];
        for (var ti = seg[0]; ti <= seg[1]; ti++) segTurns.push(ti);
        // P5: 复用调用方预计算的格式化文本（segKey 命中），未命中时回退现算
        var segText = (segTexts && segTexts[segKey(seg)]) || formatTurnsText(turns, segTurns);
        var segChars = segText.length;

        if (segChars > maxChars) {
            // P1-1: 超长 segment 无论是否为首位置都先拆分（原仅 currentChunk 为空时拆分，
            // 导致累积场景下超长 chunk 整段提交给 LLM）
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = [];
                currentChars = 0;
            }
            var subSegments = splitIntraSegment(seg, turns, maxChars);
            for (var si = 0; si < subSegments.length; si++) {
                chunks.push([subSegments[si]]);
            }
            continue;
        }

        if (currentChars + segChars > maxChars && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [seg];
            currentChars = segChars;
        } else {
            currentChunk.push(seg);
            currentChars += segChars;
        }
    }

    if (currentChunk.length > 0) chunks.push(currentChunk);
    return chunks;
}

export function mapEventData(event, seg, turns, allSegments, windowMessages) {
    // P1-2: 优先使用 LLM 返回的事件自带 msgRange（窗口内消息下标）定位实际消息区间。
    // 事件 msgRange 是窗口内下标，先经 windowMessages（filteredMessages）转换为全局消息下标，
    // 再与 turns 相交得到覆盖轮次——避免 LLM 少输出时按数组下标一一映射造成全量错位。
    var globalRange = null;
    if (event.msgRange && Array.isArray(event.msgRange) && event.msgRange.length === 2) {
        var es = Number(event.msgRange[0]);
        var ee = Number(event.msgRange[1]);
        if (!isNaN(es) && !isNaN(ee) && es >= 0 && ee >= es && windowMessages && windowMessages.length > 0) {
            var wmS = windowMessages[es];
            var wmE = windowMessages[ee];
            var gs = wmS ? (wmS._absIdx !== undefined ? wmS._absIdx : es) : es;
            var ge = wmE ? (wmE._absIdx !== undefined ? wmE._absIdx : ee) : ee;
            if (ge >= gs) globalRange = [gs, ge];
        }
    }

    var turnIndices = [];
    if (globalRange) {
        for (var ti = 0; ti < turns.length; ti++) {
            if (turns[ti].msgEnd >= globalRange[0] && turns[ti].msgStart <= globalRange[1]) {
                turnIndices.push(ti);
            }
        }
    }
    if (turnIndices.length === 0) {
        for (var tj = seg[0]; tj <= seg[1]; tj++) turnIndices.push(tj);
    }

    event.msg_ids = collectMsgIdsFromTurns(turns, turnIndices);
    event.absMsgStart = turns[turnIndices[0]].msgStart;
    event.absMsgEnd = turns[turnIndices[turnIndices.length - 1]].msgEnd;
    event.msgRange = [turns[turnIndices[0]].msgStart, turns[turnIndices[turnIndices.length - 1]].msgEnd];
    // P1-17: 保留 LLM 输出的 partial 语义（窗口内容不足以形成完整事件），仅缺失/非法值归 closed
    event.status = event.status === 'partial' ? 'partial' : 'closed';
}

// period 规范化兜底：LLM 输出的 period 若缺失/"-"/裸时段词，挂到基准 Day 前缀上；
// 基准也缺失时自设 Day 1 锚。禁止 "-"、无 Day 前缀的单独时段词进入 vault。
export function normalizeStmPeriod(period, baselinePeriod) {
    var p = String(period || '').trim();
    var base = String(baselinePeriod || '').trim();
    var baseDayMatch = base.match(/^Day\s*\d+/i);
    if (/^Day\s*\d+/i.test(p)) return p.replace(/^Day\s+(\d+)/i, 'Day $1');
    if (!p || p === '-' || p === '—') return baseDayMatch ? base : 'Day 1';
    if (baseDayMatch) return baseDayMatch[0].replace(/^Day\s+/i, 'Day ') + ' ' + p;
    return 'Day 1 ' + p;
}

// ── prompt 消融 arm（bench-cross/scripts/ablate-prompt.mjs 专用）──
// 生产不设 globalThis.__ne_prompt_arm 时零行为变化。
// arm 名支持 '+' 组合（如 'L1b+L2'），按序叠加：ratio/eventDesc 后者胜，extraRules 拼接。
var PROMPT_ARM_SPECS = {
    // C0 基线：摘掉全部密度引导（推荐字数引用 + 压缩指令），保留管线正确性依赖（schema/覆盖规则/全名规则/period/scene）
    C0: {
        dropGuidance: true,
        eventDesc: { zh: '事件描述。使用角色全名，禁止代词。', en: 'event description. Use proper names, no pronouns.' },
        dropOnePerSeg: true
    },
    // L1 长度档：ratio 覆盖（0.05→0.15 推荐 ~60 字 / 0.25 推荐 ~100 字）
    L1a: { ratio: 0.15 },
    L1b: { ratio: 0.25, dropOnePerSeg: true },
    // L2 保留清单（BaiBai 式，摘自 prompts.ts L326 + 引语评语扩展）
    L2: { extraRules: '保留具体数字、日期时间、人名、地名、物品名、原因与结果、关键引语/评语——压缩措辞，不丢事实。' },
    // L3 空泛黑名单（LWB 式，摘自 atom-extraction.js L68-69）
    L3: { extraRules: '禁止空泛写法（如"两人交谈""关系升温""发生冲突""气氛暧昧""展开互动""产生矛盾"）：必须写清谁在何处对谁做了什么、结果如何。' },
    // L4 结构强制（BaiBai 5W1H 摘要，只取新情报/结果栏）
    L4: { extraRules: '每条 event 须包含：核心互动（谁对谁做了什么）+ 新情报/结果（推进了什么、达成什么）。' }
};

export function resolvePromptArm(name) {
    var raw = (name === undefined || name === null) ? globalThis.__ne_prompt_arm : name;
    if (!raw) return null;
    var specs = [];
    String(raw).split('+').forEach(function (part) {
        var s = PROMPT_ARM_SPECS[String(part).trim()];
        if (s) specs.push(s);
    });
    if (specs.length === 0) return null;
    var merged = { ratio: null, eventDesc: null, extraRules: [], dropOnePerSeg: false, dropGuidance: false };
    specs.forEach(function (s) {
        if (s.ratio !== undefined) merged.ratio = s.ratio;
        if (s.eventDesc) merged.eventDesc = s.eventDesc;
        if (s.extraRules) merged.extraRules.push(s.extraRules);
        if (s.dropOnePerSeg) merged.dropOnePerSeg = true;
        if (s.dropGuidance) merged.dropGuidance = true;
    });
    return merged;
}

// system 后处理：eventDesc 替换 / 压缩指令删除 / extraRules 追加（按 zh/en 原文精确匹配）
var EVENT_DESC_ZH_ORIG = '事件描述。推荐摘要字数标注在各区间标题旁（如 \'推荐摘要约 60 字\'），请尽量接近推荐字数。使用角色全名，禁止代词。';
var EVENT_DESC_EN_ORIG = 'event description. The recommended summary length is shown in each segment header (e.g. ~60 chars) — aim for that length but stay concise. Use proper names, no pronouns.';
var ONE_PER_SEG_ZH = '\n- 内容较多的区间：仍只输出一条事件来概括。';
var ONE_PER_SEG_EN = '\n- Content-heavy segments: still summarize into one event.';

function applyPromptArmToSystem(system, arm) {
    if (arm.eventDesc) {
        system = system.replace(EVENT_DESC_ZH_ORIG, arm.eventDesc.zh)
            .replace(EVENT_DESC_EN_ORIG, arm.eventDesc.en);
    }
    if (arm.dropOnePerSeg) {
        system = system.split(ONE_PER_SEG_ZH).join('').split(ONE_PER_SEG_EN).join('');
    }
    if (arm.extraRules.length > 0) {
        system += '\n\n附加规则：\n' + arm.extraRules.map(function (r) { return '- ' + r; }).join('\n');
    }
    return system;
}

function computePerSegmentGuidance(segments, turns, ratio, lang, segTexts) {
    var CHAR_FACTOR = lang === 'en' ? 0.25 : 1.0;
    var MIN_CHARS = lang === 'en' ? 40 : 10;
    var MAX_CHARS = 400;

    return segments.map(function(seg) {
        var segTurns = [];
        for (var ti = seg[0]; ti <= seg[1]; ti++) segTurns.push(ti);
        // P5: 复用预计算文本，避免与 prompt 拼装重复格式化
        var segText = (segTexts && segTexts[segKey(seg)]) || formatTurnsText(turns, segTurns);
        var inputChars = segText.length;
        var recommended = Math.round(inputChars * ratio * CHAR_FACTOR);
        recommended = Math.max(MIN_CHARS, Math.min(MAX_CHARS, recommended));
        return { inputChars: inputChars, recommended: recommended };
    });
}

export function buildStmSummaryPrompt(segments, turns, vault, stateVault, ratio, segTexts, baselinePeriodOverride) {
    var content = vault.content || {};
    var stateContent = stateVault && stateVault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var bannerMatched = globalThis.__ne_banner_matched;
    var _ratio = ratio || 0.05;
    var _arm = resolvePromptArm();
    if (_arm && _arm.ratio) _ratio = _arm.ratio;

    var guidance = computePerSegmentGuidance(segments, turns, _ratio, lang, segTexts);

    var unit = lang === 'en' ? 'chars' : '\u5B57';
    var segmentsText = lang === 'en'
        ? 'There are ' + segments.length + ' segments — you must output exactly ' + segments.length + ' events.\n'
        : '\u5171\u6709 ' + segments.length + ' \u4E2A\u533A\u95F4\u2014\u2014\u4F60\u5FC5\u987B\u8F93\u51FA\u6070\u597D ' + segments.length + ' \u6761\u4E8B\u4EF6\u3002\n';
    for (var si = 0; si < segments.length; si++) {
        var seg = segments[si];
        var segTurns = [];
        for (var ti = seg[0]; ti <= seg[1]; ti++) segTurns.push(ti);
        var g = guidance[si];
        // P5: 与 guidance 共用同一份格式化文本（segKey 命中时不再重复 formatTurnsText）
        var segText = (segTexts && segTexts[segKey(seg)]) || formatTurnsText(turns, segTurns);
        if (lang === 'en') {
            segmentsText += '\n--- Segment ' + si + ' (Turn ' + seg[0] + '-' + seg[1] + ', ~' + g.inputChars + ' input chars' + ((_arm && _arm.dropGuidance) ? '' : ', recommended summary ~' + g.recommended + ' chars') + ') ---\n';
        } else {
            segmentsText += '\n--- \u533A\u95F4 ' + si + ' (Turn ' + seg[0] + '-' + seg[1] + ', \u539F\u6587\u7EA6 ' + g.inputChars + ' ' + unit + ((_arm && _arm.dropGuidance) ? '' : ', \u63A8\u8350\u6458\u8981\u7EA6 ' + g.recommended + ' ' + unit) + ') ---\n';
        }
        segmentsText += segText;
        segmentsText += '\n';
    }

    // period 基准派生：unconsolidated_stm（新条目实际写入处，appendSTMEntries）+ stm_entries，
    // 按 msg 序取末条——旧实现只读 stm_entries，追赶批次时基准永远为空，period 退化自传播
    var allStmForBaseline = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    var sortedStm = sortStmByMsgOrder(allStmForBaseline);
    var recentStm = sortedStm.slice(-3);
    var baselinePeriod = (baselinePeriodOverride !== undefined && baselinePeriodOverride !== null)
        ? String(baselinePeriodOverride)
        : (recentStm.length > 0 ? (recentStm[recentStm.length - 1].period || '') : '');

    if (stateContent.story_date || stateContent.story_time || stateContent.story_scene) {
        segmentsText += '\n## 当前故事状态\n';
        if (stateContent.story_date) segmentsText += '天数: ' + stateContent.story_date + '\n';
        if (stateContent.story_time) segmentsText += '时间: ' + stateContent.story_time + '\n';
        if (stateContent.story_scene) segmentsText += '场景: ' + stateContent.story_scene + '\n';
        segmentsText += '\n';
    } else {
        segmentsText += '\n## 当前故事状态\n';
        if (baselinePeriod) {
            segmentsText += '基准 period: ' + baselinePeriod + '（period 以此为基准推进，仅当对话明确表明时间前进时才推进）\n';
        } else {
            segmentsText += '（无往期记忆基准：period 需自设初始锚 Day 1 + 时段）\n';
        }
        segmentsText += '（scene 从上文和近期记忆条目中推断）\n\n';
    }

    if (recentStm.length > 0) {
        segmentsText += '\n## 近期记忆条目\n';
        for (var rsi = 0; rsi < recentStm.length; rsi++) {
            var s = recentStm[rsi];
            segmentsText += '- ' + (s.period || '-') + ' | ' + (s.scene || s.scene || '未知') + ' | ' + (s.event || s.summary || '') + '\n';
        }
        segmentsText += '\n';
    }

    var MODALITY_RULES_ZH = [
        '- 情态保留：区分"事实"与"表态"，以下情态必须在 event 摘要中显式保留语义，禁止把表态写成已发生的事实：',
        '  · 打趣/戏言（开玩笑、随口一说、说笑、自嘲）→ 标注为玩笑，不写成真实行为/决定。',
        '  · 假设/将来意愿（如果…、想、打算、等以后）→ 标注为未发生的计划/意愿，不写成已发生。',
        '  · 否定/反悔/状态往返（反悔、改主意、又…、还是…、和好）→ 摘要以最终状态为准。',
        '- 最终状态优先：同一件事角色先主张、后又改口/气话/放弃/反悔时，摘要必须写清结局（当前真实状态），不得只保留最初的单方面主张。若字数紧张，优先保留情态与最终状态。'
    ].join('\n');
    var MODALITY_RULES_EN = [
        '- Preserve modality: distinguish facts from attitudes. Keep the semantics of the following explicitly; never turn an attitude into an already-happened fact:',
        '  · Teasing/banter (joking, casually said, self-deprecation) → mark as a joke, not a real action/decision.',
        '  · Hypothesis/future intent (if…, want to, plan to, later) → mark as an un-happened plan/intent, not as done.',
        '  · Negation/regret/state reversal (backtrack, change of mind, again, still, reconcile) → summarize from the final state.',
        '- Final-state first: when a character first asserts something and then reverses (backtracks, reconciles, gives up, regrets), record the outcome (the actual current state), not only the initial assertion. If short on length, prioritize the modality and the final state.'
    ].join('\n');

    var system;

    if (bannerMatched) {
        system = lang === 'en'
            ? 'You are a story memory extractor.\n\nOutput JSON:\n{\n  "events": [\n    {\n      "event": "event description. The recommended summary length is shown in each segment header (e.g. ~60 chars) — aim for that length but stay concise. Use proper names, no pronouns.",\n      "period": "time. Use the time from ## 当前故事状态 (Current Story State) as the baseline. Only advance if the dialogue explicitly moves time forward — retain existing naming conventions. If no time is provided: \\"-\\"",\n      "scene": "scene from ## 当前故事状态. Only change if the dialogue explicitly moves to a different location. If no scene is provided: \\"-\\"",\n      "present_characters": ["full names of characters who appear in this segment (dialogue or action). Empty array [] if none"],\n      "character_psyche": {"CharacterName": {"current_mood": "mood", "inner_thoughts": "inner monologue"}}\n    }\n  ]\n}\n\nRules:\n- The events array must have exactly as many entries as there are segments. Segment 0 = events[0], segment 1 = events[1], etc. Do not split a segment into multiple events. Do not add extra events.\n- Use character proper names only. No pronouns.\n- present_characters: only characters with actual dialogue or action in this segment. Empty array [] if none.\n- character_psyche: only for characters whose inner thoughts/mood are explicitly shown. Omit the field if none.\n- Content-heavy segments: still summarize into one event.'
            : '你是故事记忆提取器。\n\n输出 JSON：\n{\n  "events": [\n    {\n      "event": "事件描述。推荐摘要字数标注在各区间标题旁（如 \'推荐摘要约 60 字\'），请尽量接近推荐字数。使用角色全名，禁止代词。",\n      "period": "时间。以 ## 当前故事状态 中提供的时间为基准。仅当对话明确表明时间前进时才更新——保留现有命名规范。若 ## 当前故事状态 未提供时间：\\"-\\"",\n      "scene": "场景。以 ## 当前故事状态 中提供的场景为基准。仅当对话明确表明场景切换时才更新。若 ## 当前故事状态 未提供场景：\\"-\\"",\n      "present_characters": ["本段中明确有台词或动作的角色全名。无则空数组 []"],\n      "character_psyche": {"角色全名": {"current_mood": "情绪", "inner_thoughts": "内心想法"}}\n    }\n  ]\n}\n\n规则：\n- events 数组长度必须等于区间数。区间 0 = events[0]、区间 1 = events[1]……严禁拆分区间或增加额外事件。\n- 使用角色全名，禁止代词。\n- present_characters：仅包含本段中真正有台词或动作的角色。无角色出场时为空数组 []。\n- character_psyche：仅为本段中明确出现心理描写的角色填写。无则省略该字段。\n- 内容较多的区间：仍只输出一条事件来概括。';
    } else {
        system = lang === 'en'
            ? 'You are a story memory extractor.\n\nOutput JSON:\n{\n  "events": [\n    {\n      "event": "event description. The recommended summary length is shown in each segment header (e.g. ~60 chars) — aim for that length but stay concise. Use proper names, no pronouns.",\n      "period": "time. Advance from the baseline period in \'## Current Story State\': only advance when the dialogue explicitly moves time forward, keeping the baseline\'s naming convention (Day N + time-of-day). If no baseline exists, set an initial anchor yourself (Day 1 + time-of-day inferred from the dialogue). Never output \\"-\\", a bare time-of-day word, or vague expressions.",\n      "scene": "scene. Infer from the dialogue above and the recent memory entries. Only change if the dialogue explicitly moves to a different location, otherwise keep the previous value. If you cannot determine the scene from context: \\"-\\"",\n      "present_characters": ["full names of characters who appear in this segment (dialogue or action). Empty array [] if none"],\n      "character_psyche": {"CharacterName": {"current_mood": "mood", "inner_thoughts": "inner monologue"}}\n    }\n  ]\n}\n\nRules:\n- The events array must have exactly as many entries as there are segments. Segment 0 = events[0], segment 1 = events[1], etc. Do not split a segment into multiple events. Do not add extra events.\n- Use character proper names only. No pronouns.\n- present_characters: only characters with actual dialogue or action in this segment. Empty array [] if none.\n- character_psyche: only for characters whose inner thoughts/mood are explicitly shown. Omit the field if none.\n- Content-heavy segments: still summarize into one event.'
            : '你是故事记忆提取器。\n\n输出 JSON：\n{\n  "events": [\n    {\n      "event": "事件描述。推荐摘要字数标注在各区间标题旁（如 \'推荐摘要约 60 字\'），请尽量接近推荐字数。使用角色全名，禁止代词。",\n      "period": "时间。以「## 当前故事状态」中的基准 period 为基准推进：仅当对话明确表明时间前进时才推进时段，并保持基准的命名规范（Day N + 时段）。无基准时自设初始锚（Day 1 + 从对话推断的时段）。禁止输出 \\"-\\"、无 Day 前缀的单独时段词或模糊表述。",\n      "scene": "场景。从上文对话和近期记忆条目中推断当前场景（如\\"客厅\\"、\\"街道\\"、\\"森林\\"、\\"宫殿\\"等）。仅当对话明确表明场景切换时才更新。若无法从上下文推断：\\"-\\"",\n      "present_characters": ["本段中明确有台词或动作的角色全名。无则空数组 []"],\n      "character_psyche": {"角色全名": {"current_mood": "情绪", "inner_thoughts": "内心想法"}}\n    }\n  ]\n}\n\n规则：\n- events 数组长度必须等于区间数。区间 0 = events[0]、区间 1 = events[1]……严禁拆分区间或增加额外事件。\n- 使用角色全名，禁止代词。\n- present_characters：仅包含本段中真正有台词或动作的角色。无角色出场时为空数组 []。\n- character_psyche：仅为本段中明确出现心理描写的角色填写。无则省略该字段。\n- 内容较多的区间：仍只输出一条事件来概括。';
    }

    system += lang === 'en' ? ('\n' + MODALITY_RULES_EN) : ('\n' + MODALITY_RULES_ZH);

    // prompt 消融 arm 变换（生产不设 __ne_prompt_arm 时零行为变化）
    if (_arm) system = applyPromptArmToSystem(system, _arm);

    return { system: system, user: segmentsText };
}

export async function executeIncrementalUpdate(chatId, newMessages, force, onProgress) {
    _resetCheckChatTag();
    _checkChatIntegrity('executeIncrementalUpdate:entry');
    const memoryVault = await readMemory(chatId);
    const stateVault = await readState(chatId);

    initializeMemoryChain(chatId, memoryVault.content || {}).catch(function(err) {
        console.warn('[NE] initializeMemoryChain failed:', err);
    });

    // 给消息打绝对位置标记——m.id 现在是 _ne_id = "idx isoDate"，parseInt 提取 idx
    for (var mi = 0; mi < newMessages.length; mi++) { newMessages[mi]._absIdx = (newMessages[mi].id !== undefined) ? parseInt(newMessages[mi].id, 10) : mi; }

    var processedIds = collectAllMsgIds(memoryVault);
    var filteredMessages = filterNewMessages(newMessages, processedIds);
    if (filteredMessages.length === 0 && !force) {
        return { vault: memoryVault, added: 0 };
    }

    console.log('[NE] STM pipeline starting — messages=' + filteredMessages.length);
    if (onProgress) onProgress({ processedTurns: 0, totalTurns: filteredMessages.length });
    var cursorResult = { vault: memoryVault, totalAdded: 0 };
    var newEntries = [];
    try {
        var turns = groupMessagesIntoTurns(filteredMessages);
        var segments = await segmentTurns(turns, memoryVault, callMemoryPipeline);

        var events = [];

        if (segments.length > 0) {
            var maxChars = 500;
            try {
                // P7: 走缓存解析，避免每轮 STM 全量 JSON.parse
                var parsed = readNeSettingsCached();
                if (parsed.stmChunkMaxChars) maxChars = Number(parsed.stmChunkMaxChars);
                if (parsed.stmSummaryRatio !== undefined) var stmRatio = Number(parsed.stmSummaryRatio);
            } catch (e) {}
            var stmRatio = stmRatio || 0.05;

            // P5: 全部 segment 的格式化文本只算一次，供 chunk 边界判定与 prompt 拼装复用
            var segTexts = {};
            for (var sti = 0; sti < segments.length; sti++) {
                var stSeg = segments[sti];
                var stTurns = [];
                for (var stti = stSeg[0]; stti <= stSeg[1]; stti++) stTurns.push(stti);
                segTexts[segKey(stSeg)] = formatTurnsText(turns, stTurns);
            }

            var chunks = chunkSegmentsForLLM(segments, turns, maxChars, segTexts);
            console.log('[NE] STM chunking: ' + segments.length + ' segments → ' + chunks.length + ' chunks (maxChars=' + maxChars + ', ratio=' + Math.round(stmRatio * 100) + '%)');

            // B3 批内基准推进：vault 在运行内不更新，chunk N+1 看不到 chunk N 的 period——
            // 用 runningBaseline 显式跨 chunk 传递（prompt 基准 + 解析后规范化锚）
            var runningBaseline = (function () {
                var s = sortStmByMsgOrder((memoryVault.content.unconsolidated_stm || []).concat(memoryVault.content.stm_entries || []));
                return s.length > 0 ? (s[s.length - 1].period || '') : '';
            })();

            for (var ci = 0; ci < chunks.length; ci++) {
                var chunk = chunks[ci];
                var summaryPrompt = buildStmSummaryPrompt(chunk, turns, memoryVault, stateVault, stmRatio, segTexts, runningBaseline);
                var responseText = '';
                try {
                    _checkChatIntegrity('executeIncrementalUpdate:beforeLLM');
                    responseText = await callMemoryPipeline([
                        { role: 'system', content: summaryPrompt.system },
                        { role: 'user', content: summaryPrompt.user }
                    ], { operation: 'stm_extract' }, chatId);
                } catch (e) {
                    console.warn('[NE] Chunk ' + (ci+1) + '/' + chunks.length + ' LLM failed:', e);
                }

                _checkChatIntegrity('executeIncrementalUpdate:afterLLM');

                if (!responseText && chunk.length > 1) {
                    console.warn('[NE] Chunk ' + (ci+1) + ' failed, falling back to per-segment');
                    for (var si = 0; si < chunk.length; si++) {
                        var singleSeg = [chunk[si]];
                        var singlePrompt = buildStmSummaryPrompt(singleSeg, turns, memoryVault, stateVault, stmRatio, segTexts, runningBaseline);
                        try {
                            responseText = await callMemoryPipeline([
                                { role: 'system', content: singlePrompt.system },
                                { role: 'user', content: singlePrompt.user }
                            ], { operation: 'stm_extract' }, chatId);
                        } catch (e2) {
                            console.warn('[NE] Chunk ' + (ci+1) + ' segment ' + (si+1) + ' fallback failed:', e2);
                            continue;
                        }
                        if (responseText) {
                            var chunkParsed = safeJsonParse(responseText);
                            if (chunkParsed && chunkParsed.events) {
                                var fbEvents = [];
                                for (var ei = 0; ei < Math.min(chunkParsed.events.length, 1); ei++) {
                                    mapEventData(chunkParsed.events[ei], chunk[si], turns, segments, filteredMessages);
                                    chunkParsed.events[ei].period = normalizeStmPeriod(chunkParsed.events[ei].period, runningBaseline);
                                    runningBaseline = chunkParsed.events[ei].period;
                                    fbEvents.push(chunkParsed.events[ei]);
                                }
                                // [stm-resolver] fallback 分支同样接 resolver（单 segment 对话原文 = singlePrompt.user）
                                try {
                                    var fbRes = await resolveChunkEvents(singlePrompt.user, fbEvents, { chatId: chatId });
                                    if (fbRes && fbRes.events) events.push.apply(events, fbRes.events);
                                } catch (e4) {
                                    events.push.apply(events, fbEvents); // resolver 失败则用原 events
                                }
                            }
                        }
                    }
                    continue;
                }

                if (responseText) {
                    var chunkParsed = safeJsonParse(responseText);
                    if (chunkParsed) {
                        var chunkEvents = chunkParsed.events || [];
                        var mappedChunkEvents = [];
                        for (var ei = 0; ei < Math.min(chunkEvents.length, chunk.length); ei++) {
                            mapEventData(chunkEvents[ei], chunk[ei], turns, segments, filteredMessages);
                            chunkEvents[ei].period = normalizeStmPeriod(chunkEvents[ei].period, runningBaseline);
                            runningBaseline = chunkEvents[ei].period;
                            mappedChunkEvents.push(chunkEvents[ei]);
                        }
                        // [stm-resolver] D 方案：抽取后对 chunk 内 events 做状态消解（反悔→重写 event 为最终态）
                        // 输入 = 该 chunk 对话原文（summaryPrompt.user）+ 该 chunk 抽取的 events；失败降级原样返回。
                        if (mappedChunkEvents.length > 0) {
                            try {
                                var resolverResult = await resolveChunkEvents(summaryPrompt.user, mappedChunkEvents, { chatId: chatId });
                                if (resolverResult && resolverResult.events) {
                                    events.push.apply(events, resolverResult.events);
                                    if (resolverResult.rewritten > 0) {
                                        console.log('[NE] resolver: chunk ' + (ci+1) + ' rewritten ' + resolverResult.rewritten + '/' + resolverResult.events.length + ' events (calls=' + resolverResult.calls + ', failures=' + resolverResult.failures + ')');
                                        recordTelemetry({ pipeline_task: 'stm_resolve', chunk: ci + 1, calls: resolverResult.calls, failures: resolverResult.failures, rewritten: resolverResult.rewritten, events: resolverResult.events.length }, chatId);
                                    }
                                }
                            } catch (e3) {
                                console.warn('[NE] resolver pass failed for chunk ' + (ci+1) + ', events kept as-is:', (e3 && e3.message) || e3);
                            }
                        }
                    }
                }
            }

            if (events.length === 0 && filteredMessages.length > 0) {
                console.warn('[NE] STM pipeline: all LLM attempts failed, no events extracted');
                recordTelemetry({ pipeline_task: 'stm_extract', error: 'all_attempts_failed', chunks: chunks.length }, chatId);
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
            // period 规范化兜底：以 vault 现有 STM 末条 period 为滚动基准，逐条规范化本次 events。
            // 已按 msgRange 排序 → 每条规范化后的 period 成为下一条的基准，跨 chunk 保持 Day 链连续。
            var normBase = sortStmByMsgOrder((memoryVault.content.unconsolidated_stm || []).concat(memoryVault.content.stm_entries || []));
            var rollingBaseline = normBase.length > 0 ? (normBase[normBase.length - 1].period || '') : '';
            for (var ni = 0; ni < events.length; ni++) {
                events[ni].period = normalizeStmPeriod(events[ni].period, rollingBaseline);
                rollingBaseline = events[ni].period;
            }

            // P0-4: msgRange 是全局绝对索引，校验基准传本次输入窗口（turns 首末条全局下标）
            var winStart = turns.length > 0 ? turns[0].msgStart : 0;
            var winEnd = turns.length > 0 ? turns[turns.length - 1].msgEnd : 0;
            var stmValidationErrors = validateSTMOutput({ stmEntries: events }, memoryVault, filteredMessages.length, winStart, winEnd);
            if (stmValidationErrors.length > 0) {
                console.warn('[NE] STM validation warnings:', stmValidationErrors.join('; '));
                recordTelemetry({ pipeline_task: 'stm_extract', validation_warnings: stmValidationErrors }, chatId);
            }
            postFillSTM({ stmEntries: events, stateChanges: {} }, memoryVault, stateVault);
            var addedCount = appendSTMEntries(memoryVault, events);

            var addedEntries = events.filter(function(e) { return e && e.id; });
            var pendingStmVersion = null;
            if (addedEntries.length > 0) {
                var messageDates = filteredMessages.map(function(m) { return m.id || ''; }).filter(Boolean);
                pendingStmVersion = {
                    type: 'stm_batch',
                    summary: 'STM batch: ' + addedEntries.length + '条新记忆',
                    delta: { stm_added: addedEntries.map(function(e) { return JSON.parse(JSON.stringify(e)); }) },
                    message_dates: messageDates
                };
            }
        }

        cursorResult.totalAdded = events.length;
        newEntries = events;

        // Persist — always save vault even with zero events to prevent infinite re-processing loop
        memoryVault._meta = memoryVault._meta || {};
        memoryVault._meta.last_pipeline_task = 'stm_extract';
        memoryVault._meta.last_pipeline_time = new Date().toISOString();
        _checkChatIntegrity('executeIncrementalUpdate:beforeSave');
        try { await saveMemoryVault(chatId, memoryVault, pendingStmVersion); } catch (e) { console.warn('[NE] STM save failed:', e); }
        _checkChatIntegrity('executeIncrementalUpdate:afterSave');

        if (events.length > 0) {

            recordTelemetry({
                pipeline_task: 'stm_extract',
                new_stm_count: events.length,
                stm_with_present: events.filter(function(e) { return e.present_characters && e.present_characters.length > 0; }).length,
                stm_with_psyche: events.filter(function(e) { return e.character_psyche && Object.keys(e.character_psyche).length > 0; }).length,
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

    if (onProgress) onProgress({ processedTurns: newEntries.length, totalTurns: newMessages.length });
    return { vault: memoryVault, added: newEntries.length };
}
