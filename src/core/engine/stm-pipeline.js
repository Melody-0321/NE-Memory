import { read, appendSTMEntries, collectAllMsgIds } from '../vault/store.js';
import { isStateSchemaEnabled } from '../vault/schema.js';
import { safeJsonParse } from './json-fallback.js';
import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';
import { groupMessagesIntoTurns, formatTurnsText, collectMsgIdsFromTurns } from './turn-segmenter.js';
import { isLtmEnabled, findOpenLtm, formatLtmCatalog, computeClosureSignals } from './consolidate.js';
import { saveVaultWithSnapshot, filterNewMessages } from './pipeline-shared.js';
import { preGroupItems, formatPreGroupHint } from './bm25-grouper.js';
import { validateSTMOutput, postFillSTM } from './validate.js';

import { vocabularyOverlap } from './text-utils.js';

export function buildSTMUpdatePrompt(newMessages, vault, partials) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var msgTexts = newMessages.map(function(m, i) {
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
    if (isStateSchemaEnabled() && content.state && Object.keys(content.state).length > 0) {
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
                
                '\nNote: "period" and "scene" are NOT needed — do NOT include them in entries.\n' +
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
            
            '\n注意："period" 和 "scene" 条目中无需包含。\n' +
        msgRangeInstructionZh +
            '\n如果没有叙事意义的事件，输出 {"stm_entries": []}。',
        user: userMsgZh
    };
}

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
        'IMPORTANT: Always use character proper names in event descriptions. Refer to the known characters and retrospective context above. Never use pronouns (I/he/she) or vague labels ("someone", "unknown girl").\n\nMessages:\n' + itemsText + '\n\nOutput ONLY a JSON array:\n[\n  { "event": "...", "msgRange": [0, 2], "status": "closed"|"partial", "translation": "...", "parent_partial": null },\n  ...\n]\n' + userEnding :
'重要：event 中涉及人物时必须使用角色全名。参考上方已知角色列表和往期上下文。禁止使用代词（我/他/她）或模糊指代（某人、无名少女等）。若仍无法确认身份，使用 access(msg_id) 追溯原文。\n\n消息：\n' + itemsText + '\n\n仅输出一个 JSON 数组：\n[\n  { "event": "...", "msgRange": [0, 2], "status": "closed"|"partial", "translation": "...", "parent_partial": null },\n  ...\n]\n' + userEnding;

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
        (retrospectiveCtx + '\nYou are a story memory extractor. Create one event entry for every continuous plot segment in the dialog below. All turns must be covered — no omissions.\n\nOutput JSON with this schema:\n{\n  "analysis": "Your step-by-step reasoning about the events (free text, will be ignored for extraction)",\n  "events": [\n    {\n      "event": "one-sentence description (20-160 chars, use proper names, no pronouns)",\n      "period": "inferred time. If multiple time formats appear (e.g. both Day 1 and 2024-05-22 07:20), pick the MOST PRECISE one — datetime > date > ordinal day > vague period. Use same format as prior events. If unsure: \\"-\\"",\n      "scene": "inferred scene. If unsure: \\"-\\"",\n      "turns": "turn range like 0-3, 4-5. Max turn is ' + maxTurnLabel + '",\n    }\n  ]\n}\n\nRules:\n- Cover ALL turns from 0 to ' + maxTurnLabel + '. No gaps.\n- Events partition the turns with NO overlap. If event A covers 0-2, event B must start at 3.\n- Do NOT create events for turns beyond ' + maxTurnLabel + '.\n- If a turn is continuous with the preceding content and does not form an independent scene, merge it into the adjacent event.\n- Within this batch, later events must not duplicate earlier ones.\n- Use character proper names only. No pronouns.\n- If no valid events can be extracted, set events to empty array [].' + ltmAppend) :
        (retrospectiveCtx + '\n你是故事记忆提取器。为下列对话中每一段连续剧情生成一个事件条目。必须覆盖全部 turn，不得遗漏。\n\n输出 JSON，schema 如下：\n{\n  "analysis": "你的逐步推理（自由文本，不会用于提取）",\n  "events": [\n    {\n      "event": "一句话事件描述（20-160字，使用角色全名，禁止代词）",\n      "period": "推断的时间。如果消息中同时出现多种时间格式（如第1天和2024-05-22 07:20），请选择最精确的表达——具体日期+时刻 > 具体日期 > 第N天 > 泛化时段。必须使用与往期事件相同的格式。若无法判断：\\"-\\"",\n      "scene": "推断的场景。若无法判断：\\"-\\"",\n      "turns": "turn 范围如 0-3, 4-5。最大 turn 为 ' + maxTurnLabel + '",\n    }\n  ]\n}\n\n规则：\n- 必须覆盖 0~' + maxTurnLabel + ' 的所有 turns，不能留空。\n- 事件之间互不重叠。若事件 A 覆盖 0-2，事件 B 必须从 3 开始。\n- 禁止为超出 ' + maxTurnLabel + ' 的 turn 创建事件。\n- 如果某 turn 内容与前文连续且不构成独立剧情，必须并入相邻事件。\n- 同一批次内，后文事件不能与前文事件重复。往期事件只作为时间格式参考。\n- 使用角色全名，禁止代词。\n- 如果无法提取有效事件，将 events 设为空数组 []。' + ltmAppend);

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
        (retrospectiveCtx + '\nYou are a story memory extractor. Create one event entry for every continuous plot segment in the dialog below. All turns must be covered — no omissions.\n\nOutput JSON with this schema:\n{\n  "analysis": "Your step-by-step reasoning about the events (free text, will be ignored for extraction)",\n  "events": [\n    {\n      "event": "one-sentence description (10-160 chars, use proper names, no pronouns)",\n      "period": "inferred time. If multiple time formats appear, pick the MOST PRECISE one — datetime > date > ordinal day > vague period. Use same format as prior events as a template. Unsure: \\"-\\"",\n      "scene": "inferred scene. Unsure: \\"-\\"",\n      "turns": "turn range like 0-3, 4-5. Max turn is ' + maxTurnLabel + '",\n    }\n  ]\n}\n\nWhen to start a NEW event (any ONE condition met):\n1. Time clearly shifts (implied or stated in dialog)\n2. Scene/location changes\n3. A character enters or leaves\n4. Plot goal or action arc changes direction\nIf NONE of these change, adjacent turns MUST be merged into one event.\n\nRules:\n- Cover ALL turns from 0 to ' + maxTurnLabel + '. No gaps.\n- Events partition the turns with NO overlap. If event A covers 0-2, event B must start at 3.\n- Do NOT create events for turns beyond ' + maxTurnLabel + '.\n- Within this batch, later events must not duplicate earlier ones.\n- Use character proper names only. No pronouns.\n- Trivial turns (greetings, acknowledgments, filler) merge into the nearest meaningful event. Do NOT fabricate events for them.\n- If the entire batch has no plot content, set events to empty array [].') :
        (retrospectiveCtx + '\n你是故事记忆提取器。为下列对话中每一段连续剧情生成一个事件条目。必须覆盖全部 turn，不得遗漏。\n\n输出 JSON，schema 如下：\n{\n  "analysis": "你的逐步推理（自由文本，不会用于提取）",\n  "events": [\n    {\n      "event": "一句话事件描述（10-160字，使用角色全名，禁止代词）",\n      "period": "推断的时间。如果消息中同时出现多种时间格式，请选择最精确的表达——具体日期+时刻 > 具体日期 > 第N天 > 泛化时段。往期事件的 period 仅为格式模板——请复用其命名规范。若无法判断：\\"-\\"",\n      "scene": "推断的场景。若无法判断：\\"-\\"",\n      "turns": "turn 范围如 0-3, 4-5。最大 turn 为 ' + maxTurnLabel + '",\n    }\n  ]\n}\n\n新事件的判断标准（满足任意一项即构成新事件）：\n1. 时间有明显推移（对话中暗示或明示）\n2. 场景位置改变\n3. 有新角色入场或旧角色离场\n4. 剧情目标或行动发生转折\n如果以上条件全部未变，相邻 turn 必须合并为一个事件。\n\n规则：\n- 必须覆盖 0~' + maxTurnLabel + ' 的所有 turns，不能留空。\n- 事件之间互不重叠。若事件 A 覆盖 0-2，事件 B 必须从 3 开始。\n- 禁止为超出 ' + maxTurnLabel + ' 的 turn 创建事件。\n- 同一批次内，后文事件不能与前文事件重复。往期事件只作为时间格式参考。\n- 使用角色全名，禁止代词。\n- 琐碎内容（问候、应答、语气词）直接并入最近的有意义事件，不要为其硬编事件。\n- 如果整个 batch 都没有可提取的有效事件，将 events 设为空数组 []。');

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

function classifyBoundary(signal) {
    if (signal.absGap > 20) return L1_CUT;
    if (!signal.sameChar) return L1_CUT;
    if (signal.isFiller) return L2_KEEP;
    if (signal.overlay >= 0.5) return L2_KEEP;
    if (signal.overlay <= 0.1) return L2_CUT;
    return L2_KEEP;
}

async function segmentTurns(turns, vault, callLLM) {
    if (!turns || turns.length === 0) return [];

    var signals = computeTurnBoundarySignals(turns);

    var cuts = [];
    for (var i = 0; i < turns.length - 1; i++) {
        cuts[i] = classifyBoundary(signals[i]) === L1_CUT || classifyBoundary(signals[i]) === L2_CUT;
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

function chunkSegmentsForLLM(segments, turns, maxChars) {
    var chunks = [];
    var currentChunk = [];
    var currentChars = 0;

    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        var segTurns = [];
        for (var ti = seg[0]; ti <= seg[1]; ti++) segTurns.push(ti);
        var segText = formatTurnsText(turns, segTurns);
        var segChars = segText.length;

        if (segChars > maxChars && currentChunk.length === 0) {
            chunks.push([seg]);
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

function mapEventData(event, seg, turns, allSegments) {
    var turnIndices = [];
    for (var ti = seg[0]; ti <= seg[1]; ti++) turnIndices.push(ti);
    event.msg_ids = collectMsgIdsFromTurns(turns, turnIndices);
    event.absMsgStart = turns[seg[0]].msgStart;
    event.absMsgEnd = turns[seg[1]].msgEnd;
    event.msgRange = [turns[seg[0]].msgStart, turns[seg[1]].msgEnd];
    event.status = 'closed';
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
        ? 'You are a story memory extractor.\n\nOutput JSON:\n{\n  "events": [\n    {\n      "event": "one-sentence description (10-160 chars, use proper names, no pronouns)",\n      "period": "time. Use the time from ## 当前故事状态 (Current Story State) as the baseline. Only advance if the dialogue explicitly moves time forward — retain existing naming conventions. If no time is provided: \\"-\\"",\n      "scene": "scene from ## 当前故事状态. Only change if the dialogue explicitly moves to a different location. If no scene is provided: \\"-\\"",\n    }\n  ]\n}\n\nRules:\n- The events array must have exactly as many entries as there are segments. Segment 0 = events[0], segment 1 = events[1], etc. Do not split a segment into multiple events. Do not add extra events.\n- Use character proper names only. No pronouns.\n- Content-heavy segments: still summarize into one event.'
        : '你是故事记忆提取器。\n\n输出 JSON：\n{\n  "events": [\n    {\n      "event": "一句话事件描述（10-160字，使用角色全名，禁止代词）",\n      "period": "时间。以 ## 当前故事状态 中提供的时间为基准。仅当对话明确表明时间前进时才更新——保留现有命名规范。若 ## 当前故事状态 未提供时间：\\"-\\"",\n      "scene": "场景。以 ## 当前故事状态 中提供的场景为基准。仅当对话明确表明场景切换时才更新。若 ## 当前故事状态 未提供场景：\\"-\\"",\n    }\n  ]\n}\n\n规则：\n- events 数组长度必须等于区间数。区间 0 = events[0]、区间 1 = events[1]……严禁拆分区间或增加额外事件。\n- 使用角色全名，禁止代词。\n- 内容较多的区间：仍只输出一条事件来概括。';

    return { system: system, user: segmentsText };
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

    console.log('[NE] STM pipeline starting — messages=' + filteredMessages.length);
    if (onProgress) onProgress({ processedTurns: 0, totalTurns: filteredMessages.length });
    var cursorResult = { vault: vault, totalAdded: 0 };
    var newEntries = [];
    try {
        var turns = groupMessagesIntoTurns(filteredMessages);
        var segments = await segmentTurns(turns, vault, callMemoryPipeline);

        var events = [];

        if (segments.length > 0) {
            var maxChars = 8000;
            try {
                var rawSettings = localStorage.getItem('ne_settings');
                if (rawSettings) {
                    var parsed = JSON.parse(rawSettings);
                    if (parsed.stmChunkMaxChars) maxChars = Number(parsed.stmChunkMaxChars);
                }
            } catch (e) {}

            var chunks = chunkSegmentsForLLM(segments, turns, maxChars);
            console.log('[NE] STM chunking: ' + segments.length + ' segments → ' + chunks.length + ' chunks (maxChars=' + maxChars + ')');

            for (var ci = 0; ci < chunks.length; ci++) {
                var chunk = chunks[ci];
                var summaryPrompt = buildStmSummaryPrompt(chunk, turns, vault);
                var responseText = '';
                try {
                    responseText = await callMemoryPipeline([
                        { role: 'system', content: summaryPrompt.system },
                        { role: 'user', content: summaryPrompt.user }
                    ], { operation: 'stm_extract' }, chatId);
                } catch (e) {
                    console.warn('[NE] Chunk ' + (ci+1) + '/' + chunks.length + ' LLM failed:', e);
                }

                if (!responseText && chunk.length > 1) {
                    console.warn('[NE] Chunk ' + (ci+1) + ' failed, falling back to per-segment');
                    for (var si = 0; si < chunk.length; si++) {
                        var singleSeg = [chunk[si]];
                        var singlePrompt = buildStmSummaryPrompt(singleSeg, turns, vault);
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
                                for (var ei = 0; ei < Math.min(chunkParsed.events.length, 1); ei++) {
                                    mapEventData(chunkParsed.events[ei], chunk[si], turns, segments);
                                    events.push(chunkParsed.events[ei]);
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
                        for (var ei = 0; ei < Math.min(chunkEvents.length, chunk.length); ei++) {
                            mapEventData(chunkEvents[ei], chunk[ei], turns, segments);
                            events.push(chunkEvents[ei]);
                        }
                    }
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
            var stmValidationErrors = validateSTMOutput({ stmEntries: events }, vault, filteredMessages.length);
            if (stmValidationErrors.length > 0) {
                console.warn('[NE] STM validation warnings:', stmValidationErrors.join('; '));
                recordTelemetry({ pipeline_task: 'stm_extract', validation_warnings: stmValidationErrors }, chatId);
            }
            postFillSTM({ stmEntries: events, stateChanges: {} }, vault);
            appendSTMEntries(vault, events);
        }

        cursorResult.totalAdded = events.length;
        newEntries = events;

        globalThis.__ne_inner_thoughts_cache = {};

        // Persist — always save vault even with zero events to prevent infinite re-processing loop
        vault._meta = vault._meta || {};
        vault._meta.last_pipeline_task = 'stm_extract';
        vault._meta.last_pipeline_time = new Date().toISOString();
        try { await saveVaultWithSnapshot(chatId, vault); } catch (e) { console.warn('[NE] STM save failed:', e); }

        if (events.length > 0) {

            recordTelemetry({
                pipeline_task: 'stm_extract',
                new_stm_count: events.length,
                stm_with_entities: events.filter(function(e) { return e.entities && e.entities.length > 0; }).length,
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
    return { vault: vault, added: newEntries.length };
}
