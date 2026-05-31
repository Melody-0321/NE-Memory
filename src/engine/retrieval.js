/**
 * engine/retrieval.js — Retrieval Service prompt builder
 */
export function buildRetrievalPrompt(query, candidates, vault, budget) {
    budget = budget || 800;
    var content = vault.content || {};
    var lang = (content.language === 'en') ? 'en' : 'zh';
    var state = content.state || {};
    var currentTime = state.time || '';
    var openingSummary = content.opening_summary || {};
    var openingText = openingSummary.text ? openingSummary.text.substring(0, 100) : '';

    var candidatesText = candidates.map(function(e, i) {
        var timePart = (e.time_range || e.period || '');
        if (e.time_label) timePart = timePart + '·' + e.time_label;
        var refs;
        if (e.msg_ids && e.msg_ids.length > 0) {
            refs = ' [→msg#' + e.msg_ids.join(',msg#') + ']';
        } else if (e.stm_refs && e.stm_refs.length > 0) {
            refs = ' [→' + e.stm_refs.join(',') + ']';
        } else {
            refs = '';
        }
        return (i + 1) + '. [' + timePart + '] ' + (e.scene || '') + ': ' + (e.event || e.summary || '') + refs;
    }).join('\n');

    var stmCount = content.stm_entries ? content.stm_entries.length : 0;
    var ltmCount = content.ltm_entries ? content.ltm_entries.length : 0;

    if (lang === 'en') {
        var system = 'You are the Memory Vault for an ongoing roleplay. The story began with: "' + openingText + '". Current story time: ' + currentTime + '. You have tracked ' + stmCount + ' STM entries and ' + ltmCount + ' LTM entries.\n\n' +
            'Your task: given a query and a shortlist of memory candidates, determine which entries are relevant, group them by narrative thread, and return a concise synthesized answer.\n\n' +
            'Rules:\n' +
            '1. RELEVANCE: remove entries unrelated to the query. If relevance is uncertain, keep.\n' +
            '2. GROUPING: group remaining entries into narrative threads. Each thread = one related storyline.\n' +
            '3. SYNTHESIS: write each thread as a single coherent paragraph, using narrative prose (not bullet points). Include key details from entries.\n' +
            '4. TIME FORMAT: prefix each reference with its time coordinate. Use the format "{period}·{time_label}·{scene}". The period comes from state.time format — do NOT invent your own time labels or "X rounds ago".\n' +
            '5. SOURCE MARKERS: end each factual claim with [→msg#X] or [→stm:id] or [→state:path]. If multiple entries support the same claim, list all.\n' +
            '6. CURRENT TIME ANCHOR: after each narrative thread, add a line:\n' +
            '   → Current time: ' + currentTime + ' [→state:time]\n\n' +
            'Output format:\n' +
            '## <narrative thread 1>\n<coherent paragraph with source markers>\n→ Current time: ' + currentTime + ' [→state:time]\n\n' +
            '## <narrative thread 2>\n...\n\n' +
            '## Other relevant\n<any remaining relevant entries, brief>\n\n' +
            'Keep the total response under ' + budget + ' tokens.\n\n' +
            'SELF-VERIFICATION: before returning, check for internal contradictions. If two entries describe the same entity/event with conflicting info, note which is more recent and explain the resolution.\n\n' +
            'Query: ' + query + '\n\nCandidates:\n' + candidatesText;

        return {
            system: system,
            user: 'Synthesize the relevant memories. Return only the formatted answer, no preamble.'
        };
    }

    var systemZh = '你是这个角色扮演的记忆中枢。故事开始于："' + openingText + '"。当前故事时间：' + currentTime + '。你已追踪 ' + stmCount + ' 条 STM 条目和 ' + ltmCount + ' 条 LTM 条目。\n\n' +
        '任务：根据查询和候选记忆清单，判断相关性，按叙事线分组，返回简洁的叙事合成答案。\n\n' +
        '规则：\n' +
        '1. 相关性：剔除与查询无关的条目。不确定时保留。\n' +
        '2. 分组：将剩余条目按叙事线分组。每条线 = 一个相关联的故事线。\n' +
        '3. 合成：每条叙事线写成一个连贯段落，使用叙事性语言（非列表格式）。包含条目的关键细节。\n' +
        '4. 时间格式：每个引用前标注时间坐标，格式为"{period}·{time_label}·{scene}"。禁止编造 "Chapter X" 或 "X轮前" 等标签。\n' +
        '5. 来源标记：每个事实性陈述后标注 [→msg#X] 或 [→stm:id] 或 [→state:path]。\n' +
        '6. 当前时间锚点：每个叙事段末尾追加：\n' +
        '   → 当前时间: ' + currentTime + ' [→state:time]\n\n' +
        '输出格式：\n' +
        '## <叙事线1>\n<连贯段落 + 来源标记>\n→ 当前时间: ' + currentTime + ' [→state:time]\n\n' +
        '## <叙事线2>\n...\n\n' +
        '## 其他相关\n<剩余相关条目，简要>\n\n' +
        '回复总长度控制在 ' + budget + ' tokens 以内。\n\n' +
        '自我一致性检查：返回前检查内部矛盾。若两个条目描述同一实体/事件的冲突信息，标注较近时间的条目并解释结论。\n\n' +
        '查询：' + query + '\n\n候选记忆：\n' + candidatesText;

    return {
        system: systemZh,
        user: '合成相关记忆。仅返回格式化答案，无前缀。'
    };
}

export function buildRetrievalMessages(query, candidates, vault, budget) {
    var prompt = buildRetrievalPrompt(query, candidates, vault, budget);
    return [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
    ];
}
