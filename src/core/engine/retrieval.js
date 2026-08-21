/**
 * engine/retrieval.js — Retrieval Service prompt builder
 *
 * v2: Entity chain lookup + injection.
 * Automatically builds entity timelines from STM/LTM entries and injects
 * them as "Known Entity Timelines" into the retrieval synthesis prompt.
 */

import { isAuto, computeChainDepth, computeChainRecentWindow, computeChainHeadCount } from '../params.js';
import { sortStmByMsgOrder } from '../vault/store.js';
import { readNeSettingsCached } from '../settings.js';

// ─── Entity chain lookup ───

export async function lookupEntityChains(content, entityNames) {
    var allSTM = sortStmByMsgOrder((content.unconsolidated_stm || []).concat(content.stm_entries || []));
    var allLTM = content.ltm_entries || [];
    var chains = {};

    for (var ni = 0; ni < entityNames.length; ni++) {
        var name = entityNames[ni];
        var chainEntries = [];
        allSTM.forEach(function(e) {
            var present = e.present_characters || e.entities;
            if (present && present.some(function(en) { return (typeof en === 'string' ? en : en.name) === name; })) {
                chainEntries.push(e);
            }
        });
        allLTM.forEach(function(e) {
            var present = e.present_characters || e.entities;
            if (present && present.some(function(en) { return (typeof en === 'string' ? en : en.name) === name; })) {
                chainEntries.push(e);
            }
        });
        if (chainEntries.length > 0) {
            chainEntries.sort(function(a, b) {
                return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
            });
            var chainLen = chainEntries.length;
            if (isAuto('chainDepth') && chainLen > (computeChainHeadCount() + 2)) {
                var depth = computeChainDepth(chainLen);
                var recentWindow = isAuto('chainRecentWindow') ? computeChainRecentWindow(chainLen) : depth;
                var headCount = computeChainHeadCount();
                var sliced = [];
                var head = chainEntries.slice(0, Math.min(headCount, depth));
                sliced = sliced.concat(head);
                var remaining = depth - head.length;
                if (remaining > 0) {
                    var recentStart = Math.max(head.length, chainLen - Math.min(remaining, recentWindow));
                    var recent = chainEntries.slice(recentStart);
                    sliced = sliced.concat(recent);
                    remaining -= recent.length;
                    if (remaining > 0 && chainLen > head.length + recent.length) {
                        var midStart = head.length;
                        var midEnd = chainLen - recent.length;
                        if (midEnd > midStart) {
                            var midCount = Math.min(remaining, midEnd - midStart);
                            var step = Math.max(1, Math.floor((midEnd - midStart) / midCount));
                            for (var mi = midStart, mc = 0; mi < midEnd && mc < midCount; mi += step, mc++) {
                                sliced.push(chainEntries[mi]);
                            }
                        }
                    }
                }
                sliced.sort(function(a, b) {
                    return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
                });
                chainEntries = sliced;
            }
            chains[name] = chainEntries;
        }
    }

    return chains;
}

// ─── Entity name extraction from query ───

export function extractEntityNames(query, content) {
    var state = content.state || {};
    var allSTM = sortStmByMsgOrder((content.unconsolidated_stm || []).concat(content.stm_entries || []));
    var knownNames = [];

    // Collect from RP-specific state: characters and factions
    var characters = state.characters || {};
    Object.keys(characters).forEach(function(name) { knownNames.push(name); });

    var factions = state.factions || {};
    Object.keys(factions).forEach(function(name) { knownNames.push(name); });

    // Also collect from STM entity annotations
    allSTM.forEach(function(e) {
        var present = e.present_characters || e.entities;
        if (present) {
            present.forEach(function(en) {
                var n = typeof en === 'string' ? en : en.name;
                if (n && knownNames.indexOf(n) === -1) knownNames.push(n);
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

// ─── Helper: derive thread time range ───

function deriveThreadTimeRange(entries) {
    if (!entries || entries.length === 0) return '';
    var first = entries[0];
    var last = entries[entries.length - 1];
    var firstTime = first.period || first.time_label || '';
    var lastTime = last.period || last.time_label || '';
    if (firstTime && lastTime && firstTime !== lastTime) {
        return firstTime + ' → ' + lastTime;
    } else if (firstTime) {
        return firstTime;
    }
    return '';
}

// ─── Implicit entity discovery ───

// ─── Pipeline merge (v2) ───

// ─── Entity-grouped candidate formatting ───

export function groupCandidatesByEntity(map, threadIndex) {
    var groups = {};
    var unassignedEntries = [];
    var allEntries = [];
    map.forEach(function(e) { allEntries.push(e); });

    allEntries.forEach(function(e) {
        var entityNames = [];
        var present = e.entry.present_characters || e.entry.entities;
        if (present && Array.isArray(present)) {
            present.forEach(function(en) {
                var n = typeof en === 'string' ? en : en.name;
                if (n) entityNames.push(n);
            });
        }
        Object.keys(threadIndex).forEach(function(tid) {
            if (tid.indexOf('chain:') === 0) {
                var name = tid.substring(6);
                var stmIds = threadIndex[tid].stmIds || [];
                if (stmIds.indexOf(e.entry.id) !== -1 && entityNames.indexOf(name) === -1) {
                    entityNames.push(name);
                }
            }
        });

        if (entityNames.length === 0) {
            unassignedEntries.push(e);
            return;
        }

        var primaryName = entityNames[0];
        if (!groups[primaryName]) groups[primaryName] = { entries: [], refs: [], name: primaryName };

        groups[primaryName].entries.push(e);

        for (var ci = 1; ci < entityNames.length; ci++) {
            var refName = entityNames[ci];
            if (!groups[refName]) groups[refName] = { entries: [], refs: [], name: refName };
            groups[refName].refs.push({ entryId: e.entry.id, primaryName: primaryName });
        }
    });

    Object.keys(groups).forEach(function(name) {
        groups[name].entries.sort(function(a, b) {
            var pa = a.entry.period || '';
            var pb = b.entry.period || '';
            return pa.localeCompare(pb);
        });
    });

    unassignedEntries = unassignedEntries.filter(function(e) {
        return e.relevance > 0;
    });

    return { groups: groups, unassigned: unassignedEntries };
}

export async function mergePipelines(bm25Results, entityChains, allLTM, state, allSTM) {
    var map = new Map();
    var threadIndex = {};
    var content = null; // for Step 5 short chain inline

    // ── Step 1: BM25 results into Map ──
    bm25Results.forEach(function(c) {
        var id = c.__id || c.id;
        if (!id) return;
        if (c.__isDirectory) {
            map.set(id, {
                entry: c,
                type: 'ltm',
                relevance: 0,
                threads: [],
                sources: ['ltm_dir'],
                _expanded: false,
                _lastDescribedVersion: 0
            });
            return;
        }
        map.set(id, {
            entry: c,
            type: c.__type || 'stm',
            relevance: c.__relevance || 0,
            threads: [],
            sources: c.__rrfOnly ? ['vector'] : ['bm25'],
            _expanded: false,
            _lastDescribedVersion: 0
        });
    });

    // ── Step 2: Entity chains into Map (code pre-fetch — explicit entity names) ──
    var prefetchedNames = [];
    Object.keys(entityChains).forEach(function(entityName) {
        prefetchedNames.push(entityName);
        var entries = entityChains[entityName];
        if (!entries || entries.length === 0) return;

        var threadId = 'chain:' + entityName;
        var stmIds = [];

        entries.forEach(function(e, idx) {
            var id = e.id;
            if (!id) return;
            stmIds.push(id);

            var existing = map.get(id);
            if (existing) {
                var hasThread = false;
                for (var i = 0; i < existing.threads.length; i++) {
                    if (existing.threads[i].threadId === threadId) {
                        hasThread = true;
                        break;
                    }
                }
                if (!hasThread) {
                    existing.threads.push({ threadId: threadId, position: idx + 1, total: entries.length });
                }
                if (existing.sources.indexOf('chain:' + entityName) === -1) {
                    existing.sources.push('chain:' + entityName);
                }
            } else {
                var chainScore = 0;
                for (var ci = 0; ci < bm25Results.length; ci++) {
                    if ((bm25Results[ci].__id || bm25Results[ci].id) === id) {
                        chainScore = bm25Results[ci].__relevance || 0;
                        break;
                    }
                }
                map.set(id, {
                    entry: e,
                    type: 'stm',
                    relevance: chainScore,
                    threads: [{ threadId: threadId, position: idx + 1, total: entries.length }],
                    sources: ['chain:' + entityName],
                    _expanded: false,
                    _lastDescribedVersion: 0
                });
            }
        });

        threadIndex[threadId] = {
            type: 'entity_chain',
            label: entityName,
            stmIds: stmIds,
            timeRange: deriveThreadTimeRange(entries),
            dagLayer: 1,
            parentThreadId: null
        };
    });

    // ── Step 3/4: P1 弧激活双向归并（arcInjectionEnabled 开关，与打分池共用）──
    // 打分池关时 bm25Results 无 LTM 打分命中（Step 3 自然空转），但反向拉弧只依赖
    // STM 的 parent_ltm 指针，需显式门控保证 off 时行为逐字节不变。
    var arcEnabled = false;
    try { arcEnabled = readNeSettingsCached().arcInjectionEnabled === true; } catch (e) {}
    if (arcEnabled) {
        var stmById = {};
        (allSTM || []).forEach(function(s) { if (s && s.id) stmById[s.id] = s; });
        var ltmById = {};
        (allLTM || []).forEach(function(l) { if (l && l.id) ltmById[l.id] = l; });

        // Step 3: 正向归并 arc_expand——弧打分命中（bm25/vector，relevance>0）→ 拉其
        // stm_refs 全部单拍进 map（降权 0.5：弧命中属二阶信号，拍本身未直接命中 query）。
        // 目录搭车（sources=['ltm_dir']，relevance=0）与小池全量 LTM（无 __relevance）不触发。
        var ARC_EXPAND_WEIGHT = 0.5; // 初值写死，不暴露设置项（避免过度配置）
        var arcHits = [];
        map.forEach(function(e) {
            if (e.type === 'ltm' && e.relevance > 0 &&
                e.sources.indexOf('ltm_dir') === -1) arcHits.push(e);
        });
        arcHits.forEach(function(arc) {
            var refs = (arc.entry && arc.entry.stm_refs) || [];
            refs.forEach(function(stmId) {
                if (map.has(stmId)) return; // 已在场（打分/链路命中）不覆盖不降权
                var stmEntry = stmById[stmId];
                if (!stmEntry) return; // stm_refs 悬空（拍被裁/库外）跳过
                map.set(stmId, {
                    entry: stmEntry,
                    type: 'stm',
                    relevance: arc.relevance * ARC_EXPAND_WEIGHT,
                    threads: [],
                    sources: ['arc_expand'],
                    _expanded: false,
                    _lastDescribedVersion: 0
                });
            });
        });

        // Step 4: 反向归并 arc_pull——拍打分命中（relevance>0）→ 拉所属弧本体进 map
        // （relevance 继承该弧下拍最高分，不打折）。同弧兄弟拍不自动全拉（嵌套渲染
        // 口径控制）；弧已在场（打分命中）不覆盖。
        var pulledArcScore = {}; // ltmId -> 该弧下已命中拍的最高分
        map.forEach(function(e) {
            if (e.type !== 'stm' || e.relevance <= 0) return;
            var parentId = e.entry && e.entry.parent_ltm;
            if (!parentId) return; // 无 parent_ltm（未归弧/独立拍）跳过
            if (!pulledArcScore[parentId] || pulledArcScore[parentId] < e.relevance) {
                pulledArcScore[parentId] = e.relevance;
            }
        });
        Object.keys(pulledArcScore).forEach(function(ltmId) {
            if (map.has(ltmId)) return; // 弧已在场不覆盖
            var ltmEntry = ltmById[ltmId];
            if (!ltmEntry) return; // 悬空 parent_ltm 防御
            map.set(ltmId, {
                entry: ltmEntry,
                type: 'ltm',
                relevance: pulledArcScore[ltmId],
                threads: [],
                sources: ['arc_pull'],
                _expanded: false,
                _lastDescribedVersion: 0
            });
        });
    }

    return { map: map, threadIndex: threadIndex, availableChains: [] };
}

// ─── Main prompt builder (v1 — legacy) ───

async function buildRetrievalPromptLegacy(query, candidates, vault, budget, isSummaryMode) {
    budget = budget || 1200;
    isSummaryMode = isSummaryMode || false;
    var content = vault.content || {};
    var lang = (content.language === 'en') ? 'en' : 'zh';
    var state = content.state || {};
    var timeParts = [];
    if (content.story_time) timeParts.push(content.story_time);
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

    var stmCount = ((content.unconsolidated_stm || []).concat(content.stm_entries || [])).length;
    var ltmCount = content.ltm_entries ? content.ltm_entries.length : 0;

    var entityNames = extractEntityNames(query, content);
    var chains = await lookupEntityChains(content, entityNames);
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
        'At most 3 search rounds. Prioritize entries with highest BM25 scores.\n\n';

    var toolGuidanceZh = '## 搜索工具\n' +
        '你可以使用：access(ref)。支持的 ref 格式：\n' +
        '- access(stm_id): 获取 STM 条目完整原文\n' +
        '- access(ltm_id): 获取 LTM 归档完整内容\n' +
        '- access(msg_id): 查看原始对话消息\n' +
        '- access(chain.X): 获取实体 X 的完整事件时间线\n\n' +
        '最多 3 轮搜索。优先 BM25 最高的条目。\n\n';

    if (lang === 'en') {
        var system = 'You are the Memory Vault for an ongoing roleplay. Current story time: ' + currentTime + '. You have tracked ' + stmCount + ' STM entries and ' + ltmCount + ' LTM entries.\n\n' +
            'Your task: given a query and a shortlist of memory candidates, determine which entries are relevant, group them by narrative thread, and return a detailed synthesized answer.\n\n' +
            'Rules:\n' +
            '1. RELEVANCE: remove entries unrelated to the query. If relevance is uncertain, keep.\n' +
            '2. GROUPING: group remaining entries into narrative threads. Each thread = one related storyline.\n' +
            '3. EXPAND: write each thread as a coherent narrative paragraph. Expand key details for each event — who was present, what was said, what was done. If the original event contains dialogue, retell it in the narrative. Only expand details relevant to the query.\n' +
            '4. TIME COORDINATES: use the entry\'s period·scene as temporal context. Do NOT add current-time anchors or source markers.\n' +
            '5. COMPLETENESS: at the end of each narrative thread, if there are related events not fully expanded, state how many and their time span. Format: "另有 X 条相关事件未展开，跨度 <time range>".\n' +
            '6. SELF-CONTAINED: your output must be semantically self-sufficient — every paragraph can stand alone. This is about your output format: do not use cross-references ("see above"), dangling pronouns (name the subject explicitly), or internal IDs (stm_xx). The main LLM receives your synthesis as its sole memory source — include structured facts (who did what, relationships, key outcomes) even when the original dialogue was prefetched.\n' +
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
        '6. 自包含：你的输出必须语义自足——每个段落可独立阅读。这是对输出格式的要求：不要使用"参见上文"等交叉引用，不要出现无主语的"他/她说"（显式写出主语），不出现内部 ID（stm_xx）。你的合成结果是主 LLM 的唯一记忆来源——即使预取已提供了原文，结构化事实（谁做了什么、人物关系、关键结论）仍需写入。\n' +
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

export async function buildRetrievalMessagesLegacy(query, candidates, vault, budget, isSummaryMode) {
    var prompt = await buildRetrievalPromptLegacy(query, candidates, vault, budget, isSummaryMode);
    return [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
    ];
}
