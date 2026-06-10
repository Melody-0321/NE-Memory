/**
 * engine/retrieval.js — Retrieval Service prompt builder
 *
 * v2: Entity chain lookup + injection.
 * Automatically builds entity timelines from STM/LTM entries and injects
 * them as "Known Entity Timelines" into the retrieval synthesis prompt.
 */

// ─── Entity chain lookup ───

export function lookupEntityChains(content, entityNames) {
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    var allLTM = content.ltm_entries || [];
    var chains = {};

    entityNames.forEach(function(name) {
        var chainEntries = [];
        allSTM.forEach(function(e) {
            if (e.entities && e.entities.some(function(en) { return en.name === name; })) {
                chainEntries.push(e);
            }
        });
        allLTM.forEach(function(e) {
            if (e.entities && e.entities.some(function(en) { return en.name === name; })) {
                chainEntries.push(e);
            }
        });
        if (chainEntries.length > 0) {
            chainEntries.sort(function(a, b) {
                return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
            });
            chains[name] = chainEntries;
        }
    });

    return chains;
}

// ─── Entity name extraction from query ───

export function extractEntityNames(query, content) {
    var state = content.state || {};
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    var knownNames = [];

    // Collect from RP-specific state: characters and factions
    var characters = state.characters || {};
    Object.keys(characters).forEach(function(name) { knownNames.push(name); });

    var factions = state.factions || {};
    Object.keys(factions).forEach(function(name) { knownNames.push(name); });

    // Also collect from STM entity annotations
    allSTM.forEach(function(e) {
        if (e.entities) {
            e.entities.forEach(function(en) {
                if (en.name && knownNames.indexOf(en.name) === -1) knownNames.push(en.name);
            });
        }
    });

    // Filter: which known names appear in the query?
    var queryLower = query.toLowerCase();
    var matched = knownNames.filter(function(name) {
        return name.length > 1 && queryLower.indexOf(name.toLowerCase()) !== -1;
    });

    // Limit to 5 most relevant (longest names first — more specific)
    matched.sort(function(a, b) { return b.length - a.length; });
    return matched.slice(0, 5);
}

// ─── Main prompt builder ───

export function buildRetrievalPrompt(query, candidates, vault, budget, isSummaryMode) {
    budget = budget || 800;
    isSummaryMode = isSummaryMode || false;
    var content = vault.content || {};
    var lang = (content.language === 'en') ? 'en' : 'zh';
    var state = content.state || {};
    var timeParts = [];
    if (state.time || content.story_time) timeParts.push(state.time || content.story_time);
    if (content.story_date) timeParts.push(content.story_date);
    var currentTime = timeParts.join(' ─ ');

    var candidatesText = candidates.map(function(e, i) {
        var timePart = (e.time_range || e.period || '');
        if (e.time_label) timePart = timePart + '·' + e.time_label;
        var refs;
        if (e.msg_ids && e.msg_ids.length > 0) {
            refs = ' [→' + e.msg_ids.join(',') + ']';
        } else if (e.stm_refs && e.stm_refs.length > 0) {
            refs = ' [→' + e.stm_refs.join(',') + ']';
        } else {
            refs = '';
        }
        return (i + 1) + '. [' + timePart + '] ' + (e.scene || '') + ': ' + (e.event || e.summary || '') + refs;
    }).join('\n');

    var stmCount = content.stm_entries ? content.stm_entries.length : 0;
    var ltmCount = content.ltm_entries ? content.ltm_entries.length : 0;

    // ── 实体链查找 ──
    var entityNames = extractEntityNames(query, content);
    var chains = lookupEntityChains(content, entityNames);
    var chainKeys = Object.keys(chains);

    var chainsBlock = '';
    if (chainKeys.length > 0) {
        chainsBlock = '\n## Known Entity Timelines\n';
        chainKeys.forEach(function(name) {
            var chainData = chains[name];
            if (chainData && chainData.length > 0) {
                chainsBlock += '### ' + name + ' (' + chainData.length + ' events)\n';
                chainData.forEach(function(e, idx) {
                    var label = (e.period || '');
                    if (e.time_label) label = label + '·' + e.time_label;
                    chainsBlock += (idx + 1) + '. [' + label + '] ' + (e.scene || '') + ': ' + (e.event || '') + '\n';
                });
                chainsBlock += '\n';
            }
        });
    }

    // ── Summary mode: skip synthesis, return raw timeline ──
    if (isSummaryMode) {
        var summaryBlock = '\n\nRelevant memories (time-ordered):\n' + candidatesText;
        if (lang === 'en') {
            return {
                system: 'You are a memory archivist. Return all memory entries as a chronological timeline. Do NOT synthesize, group, or omit any entry. Format each entry as:\n[time] location: event description\n\nCurrent story time: ' + currentTime,
                user: 'List all entries below in chronological order. Include every entry.' + summaryBlock
            };
        }
        return {
            system: '你是记忆档案员。按时间顺序列出所有记忆条目。不要合成、分组或省略。格式：[时间] 地点: 事件描述\n\n当前故事时间：' + currentTime,
            user: '按时间顺序列出所有条目，不要省略。' + summaryBlock
        };
    }

    if (lang === 'en') {
        var system = 'You are the Memory Vault for an ongoing roleplay. Current story time: ' + currentTime + '. You have tracked ' + stmCount + ' STM entries and ' + ltmCount + ' LTM entries.\n\n' +
            'Your task: given a query and a shortlist of memory candidates, determine which entries are relevant, group them by narrative thread, and return a concise synthesized answer.\n\n' +
            'Rules:\n' +
            '1. RELEVANCE: remove entries unrelated to the query. If relevance is uncertain, keep.\n' +
            '2. GROUPING: group remaining entries into narrative threads. Each thread = one related storyline. Use entity timelines (above) to confirm which entries belong together.\n' +
            '3. SYNTHESIS: write each thread as a single coherent paragraph, using narrative prose (not bullet points). Build causal and temporal links between events: show what led to what, not just what happened. Include key details from entries.\n' +
            '4. TIME FORMAT: prefix each reference with its time coordinate. Use the format "{period}·{time_label}·{scene}". The period comes from state.time format — do NOT invent your own time labels or "X rounds ago".\n' +
            '5. SOURCE MARKERS: end each factual claim with [→X] or [→stm:id] or [→state:path]. If multiple entries support the same claim, list all.\n' +
            '6. CURRENT TIME ANCHOR: after each narrative thread, add a line:\n' +
            '   → Current time: ' + currentTime + ' [→state:time]\n' +
            '7. GAP AWARENESS: if a narrative thread is clearly incomplete or a topic has sparse coverage, note it briefly (e.g. "[ℹ details sparse]"). This helps the main LLM decide whether to request deeper retrieval.\n\n' +
            'Output format:\n' +
            '## <narrative thread 1>\n<coherent paragraph with source markers>\n→ Current time: ' + currentTime + ' [→state:time]\n\n' +
            '## <narrative thread 2>\n...\n\n' +
            '## Other relevant\n<any remaining relevant entries, brief>\n\n' +
            'Keep the total response under ' + budget + ' tokens.\n\n' +
            'SELF-VERIFICATION: before returning, check for internal contradictions. If two entries describe the same entity/event with conflicting info, note which is more recent and explain the resolution.\n\n' +
            'MULTI-TOPIC: If the query contains ";;" separators, process each segment independently. Group by topic segment, NOT by narrative thread. Output one "## <topic>" section per segment. If topics are related to the same entity, combine them. For each segment, use the entity timelines above to check if additional relevant chains exist.\n\n' +
            chainsBlock +
            'Query: ' + query + '\n\nCandidates:\n' + candidatesText;

        return {
            system: system,
            user: 'Synthesize the relevant memories. Return only the formatted answer, no preamble.'
        };
    }

    var systemZh = '你是这个角色扮演的记忆中枢。当前故事时间：' + currentTime + '。你已追踪 ' + stmCount + ' 条 STM 条目和 ' + ltmCount + ' 条 LTM 条目。\n\n' +
        '任务：根据查询和候选记忆清单，判断相关性，按叙事线分组，返回简洁的叙事合成答案。\n\n' +
        '规则：\n' +
        '1. 相关性：剔除与查询无关的条目。不确定时保留。\n' +
        '2. 分组：将剩余条目按叙事线分组。每条线 = 一个相关联的故事线。利用上方的实体时间线确认哪些条目属于同一组。\n' +
        '3. 合成：每条叙事线写成一个连贯段落，使用叙事性语言（非列表格式）。建立事件之间的因果和时序关系：展示什么导致了什么，而不只是列出发生了什么。包含条目的关键细节。\n' +
        '4. 时间格式：每个引用前标注时间坐标，格式为"{period}·{time_label}·{scene}"。禁止编造 "Chapter X" 或 "X轮前" 等标签。\n' +
        '5. 来源标记：每个事实性陈述后标注 [→X] 或 [→stm:id] 或 [→state:path]。\n' +
        '6. 当前时间锚点：每个叙事段末尾追加：\n' +
        '   → 当前时间: ' + currentTime + ' [→state:time]\n' +
        '7. 缺口感知：如果某条叙事线明显不完整或某话题覆盖稀疏，简要标注（如"[ℹ 信息稀疏]"）。这有助于主 LLM 决定是否需要更深层检索。\n\n' +
        '输出格式：\n' +
        '## <叙事线1>\n<连贯段落 + 来源标记>\n→ 当前时间: ' + currentTime + ' [→state:time]\n\n' +
        '## <叙事线2>\n...\n\n' +
        '## 其他相关\n<剩余相关条目，简要>\n\n' +
        '回复总长度控制在 ' + budget + ' tokens 以内。\n\n' +
        '自我一致性检查：返回前检查内部矛盾。若两个条目描述同一实体/事件的冲突信息，标注较近时间的条目并解释结论。\n\n' +
        '多话题处理：如果查询中包含 ";;" 分隔符，独立处理每个片段。按话题分段输出，而非按叙事线。每个片段输出一个 "## <话题>" 节。如果话题涉及同一实体，合并它们。对每个话题段，利用上方的实体时间线检查是否有额外的相关链可用。\n\n' +
        chainsBlock +
        '查询：' + query + '\n\n候选记忆：\n' + candidatesText;

    return {
        system: systemZh,
        user: '合成相关记忆。仅返回格式化答案，无前缀。'
    };
}

export function buildRetrievalMessages(query, candidates, vault, budget, isSummaryMode) {
    var prompt = buildRetrievalPrompt(query, candidates, vault, budget, isSummaryMode);
    return [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
    ];
}
