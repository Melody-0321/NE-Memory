/**
 * engine/retrieval.js — Retrieval Service prompt builder
 *
 * v2: Entity chain lookup + injection.
 * Automatically builds entity timelines from STM/LTM entries and injects
 * them as "Known Entity Timelines" into the retrieval synthesis prompt.
 */

import { isAuto, computeChainDepth, computeChainRecentWindow, computeChainHeadCount } from '../params.js';
import { sortStmByMsgOrder } from '../vault/store.js';

// ─── Entity chain lookup ───

export async function lookupEntityChains(content, entityNames) {
    var allSTM = sortStmByMsgOrder((content.unconsolidated_stm || []).concat(content.stm_entries || []));
    var allLTM = content.ltm_entries || [];
    var chains = {};

    for (var ni = 0; ni < entityNames.length; ni++) {
        var name = entityNames[ni];
        var chainEntries = [];
        allSTM.forEach(function(e) {
            if (e.entities && e.entities.some(function(en) { return (typeof en === 'string' ? en : en.name) === name; })) {
                chainEntries.push(e);
            }
        });
        allLTM.forEach(function(e) {
            if (e.entities && e.entities.some(function(en) { return (typeof en === 'string' ? en : en.name) === name; })) {
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
        if (e.entities) {
            e.entities.forEach(function(en) {
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

function discoverAvailableChains(map, state, prefetchedNames, allSTM, allLTM) {
    var availableNames = [];
    var seen = {};
    if (!prefetchedNames) prefetchedNames = [];
    allSTM = allSTM || [];
    allLTM = allLTM || [];

    // Mark prefetched names as already covered
    prefetchedNames.forEach(function(n) { seen[n.toLowerCase()] = true; });

    // Scan all Map entries for entity names not yet prefetched
    map.forEach(function(entry) {
        var entities = entry.entry && entry.entry.entities;
        if (!entities || !Array.isArray(entities)) return;
        entities.forEach(function(en) {
            if (!en.name) return;
            var key = en.name.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            availableNames.push(en.name);
        });
    });

    // Sort by occurrence frequency in map
    var freq = {};
    availableNames.forEach(function(n) { freq[n] = 0; });
    map.forEach(function(entry) {
        var entities = entry.entry && entry.entry.entities;
        if (!entities || !Array.isArray(entities)) return;
        entities.forEach(function(en) {
            if (en.name && freq[en.name] !== undefined) freq[en.name]++;
        });
    });
    availableNames.sort(function(a, b) { return (freq[b] || 0) - (freq[a] || 0); });

    // Count total vault entries for each available entity
    var allEntries = allSTM.concat(allLTM);
    var result = [];
    availableNames.slice(0, 5).forEach(function(name) {
        var total = 0;
        for (var i = 0; i < allEntries.length; i++) {
            var entities = allEntries[i].entities;
            if (entities && Array.isArray(entities)) {
                if (entities.some(function(en) { return (typeof en === 'string' ? en : en.name) === name; })) total++;
            }
        }
        result.push({ name: name, count: total });
    });

    return result;
}

// ─── Pipeline merge (v2) ───

// ─── Entity-grouped candidate formatting ───

export function groupCandidatesByEntity(map, threadIndex) {
    var groups = {};
    var unassignedEntries = [];
    var allEntries = [];
    map.forEach(function(e) { allEntries.push(e); });

    allEntries.forEach(function(e) {
        var entityNames = [];
        if (e.entry.entities && Array.isArray(e.entry.entities)) {
            e.entry.entities.forEach(function(en) {
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
        return e.bm25Score > 0.1;
    });

    return { groups: groups, unassigned: unassignedEntries };
}

export function formatEntityGroupedText(groupedResult) {
    var lines = [];

    Object.keys(groupedResult.groups).forEach(function(name) {
        var group = groupedResult.groups[name];
        var refCount = group.refs ? group.refs.length : 0;
        var refPart = refCount > 0 ? ', ' + refCount + ' refs' : '';
        lines.push('## ' + name + ' (' + group.entries.length + ' events in chain' + refPart + ')');

        group.entries.forEach(function(e, idx) {
            var timePart = e.entry.period || '';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            var score = e.bm25Score > 0 ? ' [RRF:' + e.bm25Score.toFixed(3) + ']' : '';
            var msgIds = e.entry.msg_ids;
            var msgs = (msgIds && msgIds.length > 0) ? ' [msgs:' + msgIds.join(',') + ']' : '';
            var idRef = e.entry.id ? ' [' + e.entry.id + ']' : '';
            lines.push((idx + 1) + '. [' + timePart + '] ' + (scene ? scene + ': ' : '') + event + score + msgs + idRef);

            if (e._originalText) {
                lines.push('   ↓ ' + e._originalText.replace(/\n/g, '\n   '));
            }
        });

        if (group.refs && group.refs.length > 0) {
            lines.push('');
            lines.push('### 关联条目');
            var refMap = {};
            group.refs.forEach(function(r) {
                if (!refMap[r.primaryName]) refMap[r.primaryName] = [];
                refMap[r.primaryName].push(r.entryId);
            });
            Object.keys(refMap).forEach(function(primary) {
                lines.push('- See 「' + primary + '」: ' + refMap[primary].join(', '));
            });
        }

        lines.push('');
    });

    if (groupedResult.unassigned.length > 0) {
        lines.push('## 未标注条目 (' + groupedResult.unassigned.length + ' entries)');
        groupedResult.unassigned.forEach(function(e, idx) {
            var timePart = e.entry.period || '';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            var score = e.bm25Score > 0 ? ' [RRF:' + e.bm25Score.toFixed(3) + ']' : '';
            lines.push((idx + 1) + '. [' + timePart + '] ' + (scene ? scene + ': ' : '') + event + score);
        });
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Merge BM25 results, entity chains, and LTM groups into a unified Map + ThreadIndex.
 */
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
                bm25Score: 0,
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
            bm25Score: c.__score || 0,
            threads: [],
            sources: ['bm25'],
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
                        chainScore = bm25Results[ci].__score || 0;
                        break;
                    }
                }
                map.set(id, {
                    entry: e,
                    type: 'stm',
                    bm25Score: chainScore,
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

    // ── Step 3: LTM groups into Map ──
    allLTM.forEach(function(ltm) {
        var refs = ltm.stm_refs || [];
        if (refs.length === 0) return;

        var threadId = 'ltm:' + ltm.id;
        var stmIds = [];

        refs.forEach(function(stmId, idx) {
            stmIds.push(stmId);
            var existing = map.get(stmId);
            if (existing) {
                existing.threads.push({ threadId: threadId, position: idx + 1, total: refs.length });
                if (existing.sources.indexOf('ltm:' + ltm.id) === -1) {
                    existing.sources.push('ltm:' + ltm.id);
                }
            }
        });

        threadIndex[threadId] = {
            type: 'ltm_group',
            label: ltm.title || ltm.event || ltm.summary || '',
            stmIds: stmIds,
            ltmId: ltm.id,
            timeRange: ltm.time_range || '',
            dagLayer: 1,
            parentThreadId: null
        };
    });

    // ── Step 4: Implicit entity discovery → mark available chains ──
    var availableChains = discoverAvailableChains(map, state, prefetchedNames, allSTM, allLTM);

    // ── Step 5: Short chain inline (count ≤ 5, directly inject into map) ──
    if (availableChains && availableChains.length > 0) {
        var shortChains = availableChains.filter(function(c) { return c.count <= 5; });
        if (shortChains.length > 0) {
            var chainNames = shortChains.map(function(c) { return c.name; });
            var lookupContent = {
                unconsolidated_stm: [],
                stm_entries: allSTM || [],
                ltm_entries: allLTM || []
            };
            try {
                var shortEntityChains = await lookupEntityChains(lookupContent, chainNames);
                Object.keys(shortEntityChains).forEach(function(entityName) {
                    prefetchedNames.push(entityName);
                    var entries = shortEntityChains[entityName];
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
                            var shortChainScore = 0;
                            for (var sci = 0; sci < bm25Results.length; sci++) {
                                if ((bm25Results[sci].__id || bm25Results[sci].id) === id) {
                                    shortChainScore = bm25Results[sci].__score || 0;
                                    break;
                                }
                            }
                            map.set(id, {
                                entry: e,
                                type: 'stm',
                                bm25Score: shortChainScore,
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
                // Remove inlined chains from availableChains
                availableChains = availableChains.filter(function(c) { return c.count > 5; });
            } catch (e) {
                console.warn('[NE] Short chain inline failed:', e);
            }
        }
    }

    return { map: map, threadIndex: threadIndex, availableChains: availableChains };
}

// ─── Prompt builder (v2 — accepts notebook) ───

export function buildRetrievalPrompt(notebook, query, vault, budget, isSummaryMode, extraOptions) {
    budget = budget || 1200;
    isSummaryMode = isSummaryMode || false;
    var conversationContext = extraOptions && extraOptions.conversationContext;
    var visibleWindow = extraOptions && extraOptions.visibleWindow;
    var useVectorScore = extraOptions && extraOptions.useVectorScore;
    var entityGrouped = extraOptions && extraOptions.entityGrouped;
    var bannerMetadata = extraOptions && extraOptions.bannerMetadata || '';
    var content = vault.content || {};
    var lang = (content.language === 'en') ? 'en' : 'zh';
    var state = content.state || {};
    var timeParts = [];
    if (content.story_time) timeParts.push(content.story_time);
    if (content.story_date) timeParts.push(content.story_date);
    var currentTime = timeParts.join(' ─ ');

    var entries = notebook.toPromptEntries(useVectorScore);
    var dirEntries = entries.filter(function(e) { return e.type === 'ltm' && e.sources && e.sources.indexOf('ltm_dir') !== -1; });

    var candidatesBlock;
    if (entityGrouped) {
        candidatesBlock = formatEntityGroupedText(entityGrouped);
    } else {
        candidatesBlock = entries.filter(function(e) { return !(e.type === 'ltm' && e.sources && e.sources.indexOf('ltm_dir') !== -1); }).map(function(e, i) {
            var event = e.entry.event || e.entry.summary || '';
            var timePart = (e.entry.time_range || e.entry.period || '');
            if (e.entry.time_label) timePart = timePart + '·' + e.entry.time_label;
            var idRef = e.entry.id || '';
            var threadTags = [];
            e.threads.forEach(function(t) {
                var prefix = '';
                if (t.threadId.indexOf('chain:') === 0) prefix = 'L:' + t.threadId.substring(6);
                else if (t.threadId.indexOf('ltm:') === 0) prefix = 'G:' + t.threadId.substring(4);
                threadTags.push(prefix + '#' + t.position + '/' + t.total);
            });
            var threadAnno = threadTags.length > 0 ? ' {' + threadTags.join(', ') + '}' : '';
            var scoreAnno = e.bm25Score > 0 ? ' [RRF:' + e.bm25Score.toFixed(3) + ']' : '';
            var msgIds = e.entry.msg_ids;
            var msgsTag = (msgIds && msgIds.length > 0) ? ' [msgs:' + msgIds.join(',') + ']' : '';
            var line = (i + 1) + '. [' + timePart + '] ' + (e.entry.scene || '') + ': ' + event + scoreAnno + msgsTag + threadAnno + (idRef ? ' [id:' + idRef + ']' : '');
            if (e._originalText) {
                line += '\n   ↓ ' + e._originalText.replace(/\n/g, '\n   ');
            }
            return line;
        }).join('\n');
    }

    var dirBlock = '';
    if (dirEntries.length > 0) {
        dirBlock = '\n## Archived Memory Catalog (LTM — view-only, not ranked by relevance)\n';
        dirEntries.forEach(function(e, idx) {
            var timePart = (e.entry.time_range || e.entry.period || '');
            if (e.entry.time_label) timePart = timePart + '·' + e.entry.time_label;
            dirBlock += (idx + 1) + '. [' + timePart + '] ' + (e.entry.title || e.entry.event || e.entry.summary || '').substring(0, 60) + (e.entry.id ? ' [id:' + e.entry.id + ']' : '') + '\n';
        });
    }

    // Notebook overview
    var overview = notebook.describe(useVectorScore);

    // Available chains hint
    var availableChains = notebook._availableChains || [];
    var availChainHint = '';
    if (availableChains.length > 0) {
        var chainItems = availableChains.map(function(c) {
            return c.name + ' [' + c.count + ' entries]';
        }).join(', ');
        availChainHint = '\n## Available Chains (not yet expanded)\n' + chainItems + '\n' +
            'Long chains (high count) = this entity appears globally throughout the story. Their timeline overlaps with story chronology.\n' +
            'Short chains (low count) = this entity appears sporadically. High information density per entry.\n' +
            'Use access(chain.X) to fetch a chain.\n';
    }

    // ── Visible window section ──
    var visibleWindowBlock = '';
    if (visibleWindow && visibleWindow.length > 0) {
        var ids = visibleWindow.map(function(vm) { return '[msg_' + vm._msg_id + ']'; }).join(' ');
        if (lang === 'en') {
            visibleWindowBlock = '\n## Visible Window msg_id List\n' + ids + '\n\n' +
                'Cross-reference: if a candidate entry\'s [msgs: X,Y] intersects with the list above → the main LLM already knows the original dialogue for that entry, skip access().\n' +
                'If ALL msg_ids of a candidate are outside the list → the main LLM has NOT seen that conversation.\n' +
                'Even when original dialogue is visible, structured facts must still be included in synthesis.\n';
        } else {
            visibleWindowBlock = '\n## 可见窗口 msg_id 列表\n' + ids + '\n\n' +
                '对照：候选条目中 [msgs: X,Y] 若与上方列表有交集 → 主 LLM 已知该条目的原始对话，无需 access()。\n' +
                '候选条目全部 msg_ids 都不在列表中 → 主 LLM 未见过该轮对话。\n' +
                '即使原文可见，结构化事实（事件描述、人物关系、结论）仍需写入合成。\n';
        }
    } else {
        if (lang === 'en') {
            visibleWindowBlock = '\n## Current Visible Window\n(No visible window data — conversation may not have started or exceeds budget.)\n';
        } else {
            visibleWindowBlock = '\n## 当前对话可见窗口\n（当前无可见窗口数据——可能是对话尚未开始或超出上下文预算。）\n';
        }
    }

    var stmCount = ((content.unconsolidated_stm || []).concat(content.stm_entries || [])).length;
    var ltmCount = content.ltm_entries ? content.ltm_entries.length : 0;

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

    var toolGuidanceEn = '## Context Overview\n' + overview + '\n\n' +
        '## Thread Notation\n' +
        'Each candidate is annotated with thread tags: {L:entityName#pos/total} = entity chain position. {G:ltm_id#pos/total} = LTM group position.\n' +
        (useVectorScore
            ? '[RRF:X.XXX] = fused BM25+vector relevance score. Higher = more relevant.\n\n'
            : '[BM25:X.XX] = relevance score. Higher = more relevant to the query.\n\n') +
        '## Reference Tools (fallback use)\n' +
        'The following tools are available for verification when needed:\n' +
        '- access(msg_id): view original chat message (only when prefetched ↓ text is missing or incomplete)\n' +
        '- access(chain.X): get full timeline of entity X\n\n' +
        (useVectorScore
            ? 'You may call access() at most 2 times — prioritize entries with highest relevance scores whose ↓ prefetched text is missing.\n\n'
            : 'You may call access() at most 2 times — prioritize entries with highest BM25 scores whose ↓ prefetched text is missing.\n\n');

    var toolGuidanceZh = '## 上下文总览\n' + overview + '\n\n' +
        '## 线程标注\n' +
        '每条候选带有线程标签：{L:实体名#位置/总数} = 实体链位置, {G:ltm_id#位置/总数} = LTM 分组位置。\n' +
        (useVectorScore
            ? '[RRF:X.XXX] = BM25+向量融合评分。越高越相关。\n\n'
            : '[BM25:X.XX] = 相关性评分。越高越相关。\n\n') +
        '## 参考工具（保底使用）\n' +
        '以下工具在你需要精确验证时可用：\n' +
        '- access(msg_id): 查看原始对话消息（仅当候选条目未附带 ↓ 预取原文时使用）\n' +
        '- access(chain.X): 获取实体 X 的完整事件时间线\n\n' +
        (useVectorScore
            ? '最多 4 次 access() 调用——优先预取原文缺失且评分最高的条目。\n\n'
            : '最多 2 次 access() 调用——优先预取原文缺失且 BM25 最高的条目。\n\n');

    if (lang === 'en') {
        var systemEn =
            '## Role\n' +
            'You are the Memory Analyst for an ongoing roleplay. Current story time: ' + currentTime + '. Tracked ' + stmCount + ' STM + ' + ltmCount + ' LTM.\n\n' +
            '## Input\n' +
            'Below are memory candidates grouped by entity. Each block: chain entries (time-ordered, RRF score annotated), cross-entity references.\n\n' +
            candidatesBlock + '\n' + dirBlock + '\n' +
            '## To Do\n' +
            '1. KB Cognitive Boundary Annotation (core)\n' +
            '   For each entity block, annotate awareness levels for active characters:\n' +
            '   - 直接知晓 (DIRECT): character is present — see entities[] or entity block name match\n' +
            '   - 间接知晓 (INDIRECT): not present, but could learn via relayed info, shared scenes, observable consequences\n' +
            '   - 线索 (CLUES): only fragments, cannot reconstruct full picture\n' +
            '   - 未知 (UNKNOWN): no traceable connection\n' +
            '   Basis: entity block name, entities[], original text excerpts, time/scene relations.\n' +
            '   When uncertain, default to 线索 with brief reason.\n\n' +
            '   Output format:\n' +
            '   [实体: entity_name]\n' +
            '   [KB: character_name=level]\n' +
            '   [KB: character_name=level(reason)]\n\n' +
            '2. Gap Detection\n' +
            '   Use tools to fill gaps during analysis. At most 4 access() calls.\n' +
            '   Triggers:\n' +
            '   - Entity chain truncated: total > displayed → access(chain.X) to expand\n' +
            '   - Missing original text: no prefetch → access(ref) to fetch\n'
            '   Do NOT expand fully populated chains or entries that already have ↓ text.\n\n' +
            '3. Residual Gaps (output after recursion exhausted)\n' +
            '   Format:\n' +
            '   ## 缺口\n' +
            '   - description\n\n' +
            (bannerMetadata ? bannerMetadata + '\n\n' : '') +
            (conversationContext ? '## Current Context\nMain LLM is about to respond to this dialogue:\n' + conversationContext + '\n\n' : '') +
            visibleWindowBlock +
            toolGuidanceEn +
            availChainHint +
            '\n## Empty Output\n' +
            'If no annotatable content across all entity blocks:\n' +
            '[KB: 无]\n\n' +
            'If no gaps:\n' +
            '## 缺口\n' +
            '无\n\n' +
            '## Strictly Forbidden\n' +
            'Do NOT output:\n' +
            '- Any narrative paragraphs, prose, or event descriptions\n' +
            '- "she felt" "he thought" "this means" "inner" "emotion" psychological language\n' +
            '- "## " narrative headers (only "[实体: ...]" annotation format is valid)\n' +
            '- "由此可见" "这表明" "标志着" "这段展示了" evaluative phrases\n' +
            '- Any deletion, omission, or filtering of candidates\n' +
            '- Any inference of causality, motives, or emotions';

        return {
            system: systemEn,
            user: 'Analyze the candidates above. Only return KB annotations and gaps, in the specified format. No preamble.'
        };
    }

    var systemZh =
        '## Role\n' +
        '你是角色扮演的记忆分析员。当前故事时间：' + currentTime + '。已追踪 ' + stmCount + ' STM + ' + ltmCount + ' LTM。\n\n' +
        '## 输入\n' +
        '下方是按实体分组的候选记忆。每个块包含：链条目（时间排序、RRF 评分标注）、关联实体引用。\n\n' +
         candidatesBlock + '\n' + dirBlock + '\n' +
         '## 需要做\n' +
        '1. KB 认知标注（核心）\n' +
        '   为每个实体块，标注活跃角色的知晓等级：\n' +
        '   - 直接知晓：角色在事件中在场——entities[] 或实体块归属名匹配\n' +
        '   - 间接知晓：不在场但可通过转述、共享场景、可观察后果获悉\n' +
        '   - 线索：只有碎片，不足以还原全貌\n' +
        '   - 未知：无任何可追溯连接\n' +
        '   判断依据：实体块归属名、entities[] 标注、原文片段、时间/场景关联。\n' +
        '   不确定时标注为"线索"并说明原因。\n\n' +
        '   输出格式：\n' +
        '   [实体: 实体名]\n' +
        '   [KB: 角色名=等级]\n' +
        '   [KB: 角色名=等级(理由)]\n\n' +
        '2. 缺口检测\n' +
        '   探索中如发现缺口，使用工具补全。最多 4 次 access() 调用。\n' +
        '   触发条件：\n' +
        '   - 实体链被截断：链总数 > 展示数 → access(chain.X) 展开\n' +
        '   - 关键条目原文缺失：无预取文本 → access(ref) 获取\n' +
        '   不要补全已满的链或已有原文的条目。\n\n' +
        '3. 残余缺口（递归耗尽时输出）\n' +
        '   格式：\n' +
        '   ## 缺口\n' +
        '   - 描述\n\n' +
        (bannerMetadata ? bannerMetadata + '\n\n' : '') +
        (conversationContext ? '## 当前语境\n主 LLM 即将回复这轮对话：\n' + conversationContext + '\n\n' : '') +
        visibleWindowBlock +
        toolGuidanceZh +
        availChainHint +
        '\n## 空输出\n' +
        '若所有实体块均无可标注内容：\n' +
        '[KB: 无]\n\n' +
        '若无缺口：\n' +
        '## 缺口\n' +
        '无\n\n' +
        '## 严格禁止\n' +
        '不要输出：\n' +
        '- 任何叙事段落、散文或事件过程描述\n' +
        '- "她感到""他心想""这意味着""内心""情感"等心理描写\n' +
        '- "## " 开头的叙事标题（仅 "[实体: ...]" 标注格式有效）\n' +
        '- "由此可见""这表明""标志着""这段展示了"等评价性短语\n' +
        '- 任何对候选条目的删除、省略或过滤\n' +
        '- 任何因果/动机/情感的推断';

    return {
        system: systemZh,
        user: '分析以上候选记忆。仅按格式返回 KB 标注和缺口，禁止叙事。'
    };
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

export async function buildRetrievalMessages(notebook, query, vault, budget, isSummaryMode, extraOptions) {
    try {
        var prompt = buildRetrievalPrompt(notebook, query, vault, budget, isSummaryMode, extraOptions);
        return [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ];
    } catch (e) {
        console.warn('[NE] buildRetrievalPrompt failed, trying legacy:', e);
        return await buildRetrievalMessagesLegacy(query, notebook.toPromptEntries ? notebook.toPromptEntries() : [], vault, budget, isSummaryMode);
    }
}

export async function buildRetrievalMessagesLegacy(query, candidates, vault, budget, isSummaryMode) {
    var prompt = await buildRetrievalPromptLegacy(query, candidates, vault, budget, isSummaryMode);
    return [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
    ];
}
