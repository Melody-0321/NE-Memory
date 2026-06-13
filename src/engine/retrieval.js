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

// ─── Query classification ───

export function classifyQuery(query, state, content) {
    if (!query || typeof query !== 'string') return { type: 'open' };

    var q = query.toLowerCase().trim();
    var entities = [];
    var stateChars = (state && state.characters) ? state.characters : {};
    var stateFactions = (state && state.factions) ? state.factions : {};

    // Collect entity names from state
    var allNames = Object.keys(stateChars).concat(Object.keys(stateFactions));
    // Add entities from STM annotations
    var allSTM = (content && content.unconsolidated_stm || []).concat(content && content.stm_entries || []);
    for (var i = 0; i < allSTM.length; i++) {
        var ents = allSTM[i].entities;
        if (ents && Array.isArray(ents)) {
            for (var j = 0; j < ents.length; j++) {
                if (ents[j].name) allNames.push(ents[j].name);
            }
        }
    }

    // Deduplicate and find matching entities
    var seen = {};
    var matched = [];
    for (var i = 0; i < allNames.length; i++) {
        var name = allNames[i];
        var key = name.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        if (q.indexOf(key) !== -1 && key.length >= 1) {
            matched.push(name);
        }
    }
    matched.sort(function(a, b) { return b.length - a.length; });

    // Entity query: query contains specific entity name + follow-up pattern
    if (matched.length >= 1) {
        var isFollowUp = /在哪|怎么样|后来|之后|现在|呢|吗|怎么|认识|还有|记得/.test(query);
        var isShortEntity = matched.length === 1 && q.length < 20;
        if (isFollowUp || isShortEntity) {
            return { type: 'entity', entities: matched.slice(0, 3) };
        }
    }

    // Scene query: query contains current scene name
    if (state && state.scene) {
        var sceneKey = state.scene.toLowerCase().substring(0, 4);
        if (q.indexOf(sceneKey) !== -1) {
            return { type: 'scene', scene: state.scene };
        }
    }

    // Temporal query: query contains time words
    if (/昨天|今天|刚才|刚刚|之前|上次|那天|那时候|几点|什么时候|何时|几时|hour|day|week|month|yesterday|today|last time|before|earlier/.test(q)) {
        return { type: 'temporal' };
    }

    return { type: 'open' };
}

// ─── Main prompt builder ───

export function buildRetrievalPrompt(query, candidates, vault, budget, isSummaryMode) {
    budget = budget || 1200;
    isSummaryMode = isSummaryMode || false;
    var content = vault.content || {};
    var lang = (content.language === 'en') ? 'en' : 'zh';
    var state = content.state || {};
    var timeParts = [];
    if (state.time || content.story_time) timeParts.push(state.time || content.story_time);
    if (content.story_date) timeParts.push(content.story_date);
    var currentTime = timeParts.join(' ─ ');

    var bm25Candidates = candidates.filter(function(e) { return !e.__isDirectory; });
    var dirCandidates = candidates.filter(function(e) { return e.__isDirectory; });
    
    var candidatesText = bm25Candidates.map(function(e, i) {
        var timePart = (e.time_range || e.period || '');
        if (e.time_label) timePart = timePart + '·' + e.time_label;
        var idRef = e.id || '';
        return (i + 1) + '. [' + timePart + '] ' + (e.scene || '') + ': ' + (e.event || e.summary || '') + (idRef ? ' [id:' + idRef + ']' : '');
    }).join('\n');
    
    var dirBlock = '';
    if (dirCandidates.length > 0) {
        dirBlock = '\n## Archived Memory Catalog (LTM — view-only, not ranked by relevance)\n';
        dirCandidates.forEach(function(e, idx) {
            var timePart = (e.time_range || e.period || '');
            if (e.time_label) timePart = timePart + '·' + e.time_label;
            dirBlock += (idx + 1) + '. [' + timePart + '] ' + (e.event || e.summary || '') + (e.id ? ' [id:' + e.id + ']' : '') + '\n';
        });
    }

    var stmCount = content.stm_entries ? content.stm_entries.length : 0;
    var ltmCount = content.ltm_entries ? content.ltm_entries.length : 0;

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

    if (isSummaryMode) {
        var summaryBlock = '\n\nRelevant memories (time-ordered):\n' + candidatesText;
        if (lang === 'en') {
            return {
                system: 'You are a memory archivist. Return all memory entries as a chronological timeline. Do NOT synthesize, group, or omit any entry.\n\nCurrent story time: ' + currentTime,
                user: 'List all entries below in chronological order. Include every entry.' + summaryBlock
            };
        }
        return {
            system: '你是记忆档案员。按时间顺序列出所有记忆条目。不要合成、分组或省略。\n\n当前故事时间：' + currentTime,
            user: '按时间顺序列出所有条目，不要省略。' + summaryBlock
        };
    }

    var toolGuidanceEn = '## Search Tool\n' +
        'You have access to: access(ref). Supported refs:\n' +
        '- access(stm_id): get full original text of an STM entry\n' +
        '- access(ltm_id): get full content of an LTM entry\n' +
        '- access(msg_id): view the original chat message\n' +
        '- access(chain.X): get full timeline of entity X\n\n' +
        'The BM25 candidate list is only the first round. If you find entity names or event references with incomplete info, use access to dig deeper. Search until you have sufficient context before synthesizing. At most 3 search rounds.\n\n';

    var toolGuidanceZh = '## 搜索工具\n' +
        '你可以使用：access(ref)。支持的 ref 格式：\n' +
        '- access(stm_id): 获取 STM 条目完整原文\n' +
        '- access(ltm_id): 获取 LTM 归档完整内容\n' +
        '- access(msg_id): 查看原始对话消息\n' +
        '- access(chain.X): 获取实体 X 的完整事件时间线\n\n' +
        'BM25 候选列表仅是第一轮线索。若发现候选中有实体名或事件引用但信息不完整，使用 access 获取更多上下文。搜索直到信息充足后再合成。最多搜索 3 轮。\n\n';

    if (lang === 'en') {
        var system = 'You are the Memory Vault for an ongoing roleplay. Current story time: ' + currentTime + '. You have tracked ' + stmCount + ' STM entries and ' + ltmCount + ' LTM entries.\n\n' +
            'Your task: given a query and a shortlist of memory candidates, determine which entries are relevant, group them by narrative thread, and return a detailed synthesized answer.\n\n' +
            'Rules:\n' +
            '1. RELEVANCE: remove entries unrelated to the query. If relevance is uncertain, keep.\n' +
            '2. GROUPING: group remaining entries into narrative threads. Each thread = one related storyline.\n' +
            '3. EXPAND: write each thread as a coherent narrative paragraph. Expand key details for each event — who was present, what was said, what was done. If the original event contains dialogue, retell it in the narrative. Only expand details relevant to the query.\n' +
            '4. TIME COORDINATES: use the entry\'s period·scene as temporal context. Do NOT add current-time anchors or source markers.\n' +
            '5. COMPLETENESS: at the end of each narrative thread, if there are related events not fully expanded, state how many and their time span. Format: "另有 X 条相关事件未展开，跨度 <time range>".\n' +
            '6. SELF-CONTAINED: the output is the sole memory source for the main LLM. Make every paragraph self-sufficient without external references.\n' +
            '7. UNCERTAINTY: for any fact where the source entry is ambiguous or incomplete, explicitly mark it. Format: "cause unknown" / "具体原因不明".\n\n' +
            'CRITICAL FACT CONSTRAINT: Only include facts directly stated in the candidate entries. Do NOT infer motives, emotions, or causes unless explicitly stated in the source text. If a cause is not stated, say "cause unknown" / "原因不明". If two entries describe the same event with conflicting details, report both and note the time difference.\n\n' +
            'Output format:\n' +
            '## <narrative thread title>\n<detailed narrative paragraphs, each event unfolded>\n\n' +
            'Keep the total response under ' + budget + ' tokens.\n\n' +
            'SELF-VERIFICATION: before returning, check for internal contradictions. If two entries describe the same entity/event with conflicting info, note which is more recent and explain the resolution.\n\n' +
            'MULTI-TOPIC: If the query contains ";;" separators, process each segment independently. Output one "## <topic>" section per segment.\n\n' +
            toolGuidanceEn +
            chainsBlock +
            'Query: ' + query + '\n\nCandidates:\n' + candidatesText + dirBlock;

        return {
            system: system,
            user: 'Synthesize the relevant memories. Return only the formatted answer, no preamble.'
        };
    }

    var systemZh = '你是这个角色扮演的记忆中枢。当前故事时间：' + currentTime + '。你已追踪 ' + stmCount + ' 条 STM 条目和 ' + ltmCount + ' 条 LTM 条目。\n\n' +
        '任务：根据查询和候选记忆清单，判断相关性，按叙事线分组，返回详细展开的叙事合成答案。\n\n' +
        '规则：\n' +
        '1. 相关性：剔除与查询无关的条目。不确定时保留。\n' +
        '2. 分组：将剩余条目按叙事线分组。每条线 = 一个相关联的故事线。\n' +
        '3. 展开：每条线写成连贯叙事段落，每个事件独立展开——谁在场、说了什么、做了什么。如果事件原文包含对话关键句，在叙事中复述。仅展开与查询相关的信息，不展开无关细节。\n' +
        '4. 时间坐标：仅使用条目的 period·scene 作为时间语境。不要添加当前时间锚点或来源标记。\n' +
        '5. 信息完整性：每条叙事线末尾，如有未展开的相关事件，标注条数和时间跨度。格式："另有 X 条相关事件未展开，跨度 <时间范围>"。\n' +
        '6. 自包含：输出是主 LLM 的唯一记忆来源。每个段落自足，不依赖外部引用。\n' +
        '7. 不确定性：当来源条目中的事实模糊或不完整时，显式标注。格式："具体原因不明" / "死因未见记录"。\n\n' +
        '事实约束（必须遵守）：仅包含候选条目中直接陈述的事实。禁止推断动机、情感或因果——除非原文明确陈述。若事件原因未说明，写"原因不明"。若两条条目对同一事件有冲突描述，同时报告并标注时间差。\n\n' +
        '输出格式：\n' +
        '## <叙事线标题>\n<详细叙事段落，每个事件展开>\n\n' +
        '回复总长度控制在 ' + budget + ' tokens 以内。\n\n' +
        '自我一致性检查：返回前检查内部矛盾。若两个条目描述同一实体/事件的冲突信息，标注较近时间的条目并解释结论。\n\n' +
        '多话题处理：如果查询中包含 ";;" 分隔符，独立处理每个片段。每个片段输出一个 "## <话题>" 节。\n\n' +
        toolGuidanceZh +
        chainsBlock +
        '查询：' + query + '\n\n候选记忆：\n' + candidatesText + dirBlock;

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
