import { sortStmByMsgOrder } from '../vault/store.js';
import { filterCandidates } from '../vault/retrieval-filter.js';
import { extractEntityNames, lookupEntityChains, mergePipelines, buildRetrievalMessages, groupCandidatesByEntity } from './retrieval.js';
import { resolveAmbiguousReferences } from './ambiguity.js';
import { RetrievalNotebook } from '../vault/retrieval-notebook.js';
import { callMemoryRetrievalWithTools, recordTelemetry } from '../api/llm.js';
import { executeAccess } from '../tools.js';
import { countTokens } from './text-utils.js';

var getChatId = null;
var getChatMessages = null;

export function estimateComplexityBudget(chatMessages, defaultBudget) {
    defaultBudget = defaultBudget || 800;
    if (!chatMessages || chatMessages.length === 0) return defaultBudget;

    var lastMsg = chatMessages[chatMessages.length - 1];
    var text = (typeof lastMsg.mes === 'string' ? lastMsg.mes : '') || '';

    var len = text.length;
    var questionCount = (text.match(/[？?！!]/g) || []).length;
    var entityCount = (text.match(/[A-Z][a-z]+/g) || []).length;
    var narrativeKeywords = (text.match(/(?:为什么|什么时候|怎么|之前|后来|原因|动机|why|when|how|before|after|because|motive)/g) || []).length;

    var score = 0;
    if (len < 100) score += 0;
    else if (len < 500) score += 1;
    else score += 2;

    if (questionCount <= 1) score += 0;
    else if (questionCount <= 3) score += 1;
    else score += 2;

    if (entityCount <= 1) score += 0;
    else if (entityCount <= 3) score += 1;
    else score += 2;

    if (narrativeKeywords <= 1) score += 0;
    else score += 1;

    if (score <= 1) return 500;
    if (score <= 4) return 800;
    return 1200;
}

function buildRetrievalPrefix(content, state) {
    var parts = [];
    if (content.story_scene) parts.push('场景: ' + content.story_scene);
    if (content.story_time || content.story_date) {
        var timePart = content.story_time || '';
        if (content.story_date && content.story_date !== timePart) {
            timePart = timePart ? content.story_date + ' ' + timePart : content.story_date;
        }
        if (timePart) parts.push('时间: ' + timePart);
    }
    if (state && state.main_event) parts.push('当前事件: ' + state.main_event);
    if (state && state.characters) {
        var activeChars = Object.keys(state.characters).filter(function(n) {
            var c = state.characters[n];
            return c && (c.status === '活跃' || c.status === 'active');
        });
        if (activeChars.length > 0) parts.push('活跃角色: ' + activeChars.join('、'));
    }
    return parts.length > 0 ? '【' + parts.join(' | ') + '】' : '';
}

function computeVisibleWindow(chatMessages, maxContext) {
    if (!chatMessages || chatMessages.length === 0) return [];
    if (!maxContext) {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                maxContext = SillyTavern.getContext().maxContext || 4096;
            }
        } catch (e) {}
        if (!maxContext) return [];
    }
    var overhead = 1500;
    var available = maxContext - overhead;
    if (available <= 0) return [];

    var visible = [];
    var accumulated = 0;

    for (var i = chatMessages.length - 1; i >= 0; i--) {
        var m = chatMessages[i];
        var text = typeof m.mes === 'string' ? m.mes : (m.content || '');
        var tokens = countTokens(text) + 10;
        if (accumulated + tokens > available) break;
        accumulated += tokens;
        m._msg_id = String(i);
        visible.unshift(m);
    }

    return visible;
}

var NE_BANNER_RE = /<!--NE-BANNER-->([\s\S]*?)<!--\/NE-BANNER-->/;

function extractBannerMetadata(chatMessages) {
    if (!chatMessages || chatMessages.length === 0) return '';

    for (var i = chatMessages.length - 1; i >= 0; i--) {
        var msg = chatMessages[i];
        var text = typeof msg.mes === 'string' ? msg.mes : (msg.content || '');
        var match = text.match(NE_BANNER_RE);
        if (match) {
            var raw = match[1].trim();
            if (!raw) return '';
            var parts = raw.split('|');
            var scene = parts[0] ? parts[0].trim() : '';
            var time = parts[1] ? parts[1].trim() : '';
            var day = parts[2] ? parts[2].trim() : '';
            var event = parts[3] ? parts[3].trim() : '';
            var chars = parts[4] ? parts[4].trim() : '';
            var line = '## 当前场景元数据\n';
            line += '场景：' + (scene || '未知') + ' | 时间：' + (time || day || '未知');
            if (event) line += ' | 事件摘要：' + event;
            if (chars) line += ' | 活跃角色：' + chars;
            return line;
        }
    }

    return '';
}

export async function formatSmartContext(vault, chatMessages, budget, chatId) {
    if (!budget) {
        budget = estimateComplexityBudget(chatMessages);
    }
    var content = vault.content || {};
    var state = content.state || {};

    var allSTM = sortStmByMsgOrder((content.unconsolidated_stm || []).concat(content.stm_entries || []));
    var allLTM = content.ltm_entries || [];

    if (allSTM.length === 0 && allLTM.length === 0) {
        return buildStateOnlyInjection(vault);
    }

    var visibleWindow = computeVisibleWindow(chatMessages);

    var conversationContext = '';
    var query;
    if (chatMessages && chatMessages.length > 0) {
        var aiTexts = [];
        var userTexts = [];
        var MAX_ROUNDS = 2;
        for (var i = chatMessages.length - 1; i >= 0; i--) {
            var mi = chatMessages[i];
            if (!mi) continue;
            var txt = typeof mi.mes === 'string' ? mi.mes : (mi.content || '');
            if (!txt || txt.trim().length <= 5) continue;
            if (mi.role === 'user' || mi.is_user) {
                if (userTexts.length < MAX_ROUNDS) {
                    userTexts.push(txt.trim().substring(0, 400));
                }
            } else {
                if (aiTexts.length < MAX_ROUNDS) {
                    aiTexts.push(txt.trim().substring(0, 400));
                }
            }
            if (userTexts.length >= MAX_ROUNDS && aiTexts.length >= MAX_ROUNDS) break;
        }
        var contextParts = [];
        var rounds = Math.max(aiTexts.length, userTexts.length);
        for (var ri = rounds - 1; ri >= 0; ri--) {
            if (aiTexts[ri]) contextParts.push(aiTexts[ri]);
            if (userTexts[ri]) contextParts.push(userTexts[ri]);
        }
        if (contextParts.length > 0) {
            conversationContext = contextParts.join('\n').substring(0, 1200);
            var prefix = buildRetrievalPrefix(content, state);
            query = prefix ? prefix + '\n' + conversationContext : conversationContext;
        }
    }
    if (!query) {
        var queryParts = [];
        if (content.story_time) queryParts.push(content.story_time);
        if (content.story_date) queryParts.push(content.story_date);
        if (content.story_scene) queryParts.push(content.story_scene);
        if (state.main_event) queryParts.push(state.main_event);
        query = queryParts.length > 0 ? queryParts.join(' · ') : 'recent events';
    }

    var resolvedAmbiguity = null;
    try {
        resolvedAmbiguity = resolveAmbiguousReferences(query, content.state, content);
        if (resolvedAmbiguity && resolvedAmbiguity.enhancedQuery && resolvedAmbiguity.enhancedQuery !== query) {
            query = resolvedAmbiguity.enhancedQuery;
        }
    } catch (e) {}

    var entityNames = extractEntityNames(query, content);
    var entityChains = {};
    if (entityNames && entityNames.length > 0) {
        try {
            entityChains = await lookupEntityChains(content, entityNames);
        } catch (e) {}
    }

    var smartPushStart = Date.now();
    var bm25Start = Date.now();
    var BM25_MIN_STM = 15;

    var topCandidates;
    if (allSTM.length < BM25_MIN_STM) {
        topCandidates = [];
        for (var si = 0; si < allSTM.length; si++) {
            var s = allSTM[si];
            if (!s || !s.id) continue;
            var sc = {};
            Object.keys(s).forEach(function(k) { sc[k] = s[k]; });
            sc.__type = 'stm';
            sc.__id = s.id;
            topCandidates.push(sc);
        }
        for (var lj = 0; lj < allLTM.length; lj++) {
            var lt = allLTM[lj];
            if (!lt || !lt.id) continue;
            var lc = {};
            Object.keys(lt).forEach(function(k) { lc[k] = lt[k]; });
            lc.__type = 'ltm';
            lc.__id = lt.id;
            topCandidates.push(lc);
        }
        bm25Ms = 0;
    } else {
        var aliasesMap = {};
        var characters = state.characters || {};
        Object.keys(characters).forEach(function(name) {
            var aliases = characters[name].aliases;
            if (aliases && Array.isArray(aliases) && aliases.length > 0) {
                aliasesMap[name] = aliases;
            }
        });

        try {
            topCandidates = await filterCandidates(query, allSTM, allLTM, 40, 3, aliasesMap, chatId);
        } catch (e) {
            console.warn('[NE] BM25 filter failed, falling back to all entries:', e);
            topCandidates = [];
            for (var si = 0; si < allSTM.length; si++) {
                var s = allSTM[si];
                if (!s || !s.id) continue;
                var sc = {};
                Object.keys(s).forEach(function(k) { sc[k] = s[k]; });
                sc.__type = 'stm';
                sc.__id = s.id;
                topCandidates.push(sc);
            }
        }
    }
    var bm25Ms = Date.now() - bm25Start;

    var useVector = topCandidates && topCandidates._vectorUsed;

    if (!topCandidates || topCandidates.length === 0) {
        return buildStateOnlyInjection(vault);
    }

    var pipelineMerged;
    try {
        pipelineMerged = await mergePipelines(topCandidates, entityChains, allLTM, state, allSTM);
    } catch (e) {
        console.warn('[NE] mergePipelines failed, using BM25-only:', e);
        pipelineMerged = await mergePipelines(topCandidates, {}, [], state, allSTM);
    }

    var notebook = new RetrievalNotebook();
    if (pipelineMerged && pipelineMerged.map) {
        notebook.map = pipelineMerged.map;
    }
    if (pipelineMerged && pipelineMerged.threadIndex) {
        notebook.threadIndex = pipelineMerged.threadIndex;
    }
    notebook._availableChains = pipelineMerged ? (pipelineMerged.availableChains || []) : [];

    try {
        prefetchOriginalTexts(notebook, chatMessages, visibleWindow, 3);
    } catch (e) {}

    var entityGrouped = (pipelineMerged && pipelineMerged.map && pipelineMerged.threadIndex)
        ? groupCandidatesByEntity(pipelineMerged.map, pipelineMerged.threadIndex)
        : { groups: {}, unassigned: [] };
    var bannerMetadata = extractBannerMetadata(chatMessages);

    globalThis.__ne_debug_last_merge = pipelineMerged ? {
        mapSize: pipelineMerged.map ? pipelineMerged.map.size : 0,
        threadCount: pipelineMerged.threadIndex ? Object.keys(pipelineMerged.threadIndex).length : 0,
        threadKeys: pipelineMerged.threadIndex ? Object.keys(pipelineMerged.threadIndex) : [],
        availableChains: pipelineMerged.availableChains || [],
        time: new Date().toISOString()
    } : null;
    globalThis.__ne_debug_last_notebook = {
        version: notebook.version,
        mapSize: notebook.map.size,
        threadCount: Object.keys(notebook.threadIndex).length,
        threadKeys: Object.keys(notebook.threadIndex)
    };

    var retrievalApiStart = Date.now();
    var synthesized;
    var smPushMethod;
    try {
        var messages = await buildRetrievalMessages(notebook, query, vault, budget, false, { conversationContext: conversationContext, visibleWindow: visibleWindow, useVectorScore: useVector, entityGrouped: entityGrouped, bannerMetadata: bannerMetadata });
        globalThis.__ne_debug_last_smartpush_prompt = (messages[0] && messages[0].content) ? messages[0].content : null;
        var accessTool = {
            type: 'function',
            function: {
                name: 'access',
                description: 'Deep-search memory by reference.',
                parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] }
            }
        };
        var accessExecutor = function(args) {
            var ref = args.ref || '';
            var nbEntry = notebook.getEntry(ref);
            if (nbEntry) {
                notebook.expand(ref);
                return JSON.stringify(nbEntry.entry);
            }
            for (var ci = 0; ci < topCandidates.length; ci++) {
                if (topCandidates[ci].id === ref || topCandidates[ci].__id === ref) {
                    notebook.expand(ref);
                    return JSON.stringify(topCandidates[ci]);
                }
            }
            if (ref.indexOf('chain.') === 0 || ref.indexOf('chain:') === 0) {
                var chainEntity = ref.replace(/^(chain\.|chain:)/, '');
                var chainResult = executeAccess(ref, null, getChatId, getChatMessages);
                try {
                    var chainData = JSON.parse(chainResult);
                    if (chainData && chainData.entries && Array.isArray(chainData.entries)) {
                        notebook.addChain(chainEntity, chainData.entries);
                    }
                    return chainData.text || chainResult;
                } catch (e) {
                    return chainResult;
                }
            }
            return executeAccess(ref, null, getChatId, getChatMessages);
        };
        var result = await callMemoryRetrievalWithTools(messages, [accessTool], { access: accessExecutor }, { timeout: 8, maxTokens: 1024 });
        synthesized = result;
        smPushMethod = 'llm_synthesis';
    } catch (e) {
        console.warn('[NE] Retrieval LLM failed, using top results:', e);
        synthesized = formatBM25Results(query, topCandidates.slice(0, 5));
        smPushMethod = (useVector ? 'vector' : 'bm25') + '_fallback';
    }
    globalThis.__ne_debug_last_notebook = {
        version: notebook.version,
        mapSize: notebook.map.size,
        threadCount: Object.keys(notebook.threadIndex).length,
        threadKeys: Object.keys(notebook.threadIndex)
    };
    var retrievalApiMs = Date.now() - retrievalApiStart;
    var smartPushTotalMs = Date.now() - smartPushStart;

    recordTelemetry({
        sm_push_method: smPushMethod,
        bm25_candidate_count: topCandidates ? topCandidates.length : 0,
        bm25_ms: bm25Ms,
        vector_used: useVector || false,
        retrieval_api_ms: retrievalApiMs,
        smart_push_total_ms: smartPushTotalMs,
        injection_token_count: synthesized ? (typeof synthesized === 'string' ? synthesized.length : 0) : 0,
        memory_budget: budget
    });

    var parts = [];

    if (vault.memory_system_prompt) {
        parts.push(vault.memory_system_prompt);
    }

    if (entityGrouped && (Object.keys(entityGrouped.groups).length > 0 || entityGrouped.unassigned.length > 0)) {
        var parseResult = (synthesized && typeof synthesized === 'string')
            ? parseEntityAnnotations(synthesized.trim())
            : { entityAnnotations: {}, gaps: [], hasKB: false };

        var entityBlock = buildEntityBlock(entityGrouped, parseResult.entityAnnotations);
        if (entityBlock) {
            if (parts.length > 0) parts.push('---');
            parts.push(entityBlock);
        }

        var usageGuide = buildMemoryUsageGuide();
        parts.push(usageGuide);

        if (parseResult.gaps.length > 0) {
            var gapLines = ['## 缺口'];
            parseResult.gaps.forEach(function(g) { gapLines.push('- ' + g); });
            if (parts.length > 0) parts.push('---');
            parts.push(gapLines.join('\n'));
        }

        if (entityNames && entityNames.length > 0 && entityChains && Object.keys(entityChains).length > 0) {
            var gapMarkers = [];
            entityNames.forEach(function(name) {
                var chain = entityChains[name];
                if (chain && chain.length > 0) {
                    var firstPeriod = chain[0].period || '';
                    var lastPeriod = chain[chain.length - 1].period || '';
                    var span = firstPeriod && lastPeriod && firstPeriod !== lastPeriod ? ' ' + firstPeriod + '-' + lastPeriod : (firstPeriod ? ' ' + firstPeriod : '');
                    gapMarkers.push(name + ' 另有 ' + chain.length + ' 条相关事件未展开，跨度' + span);
                }
            });
            if (gapMarkers.length > 0) {
                if (parts.length > 0) parts.push('---');
                parts.push(gapMarkers.join('\n'));
            }
        }
    } else if (synthesized && typeof synthesized === 'string' && synthesized.trim()) {
        var synthText = synthesized.trim();
        var narrativeText = synthText.replace(/\(?(stm_|ltm_)\d+\)?/g, '');
        if (narrativeText) {
            if (parts.length > 0) parts.push('---');
            parts.push(narrativeText);
        }
    }

    var neSettings = {};
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) neSettings = JSON.parse(raw);
    } catch (e) {}
    if (neSettings.retrievalBudgetEnabled) {
        var budgetText = compileRetrievalBudget(content, query, entityNames, entityChains, neSettings.retrievalBudgetTokens || 300);
        if (budgetText) {
            if (parts.length > 0) parts.push('---');
            parts.push(budgetText);
        }
    }

    return parts.join('\n\n');
}

function parseEntityAnnotations(text) {
    var entityAnnotations = {};
    var gaps = [];
    var hasKB = false;

    var lines = text.split('\n');
    var inGaps = false;
    var currentEntity = null;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        var entityMatch = line.match(/^\[实体:\s*(.+?)\]/);
        if (entityMatch) {
            currentEntity = entityMatch[1].trim();
            if (!entityAnnotations[currentEntity]) {
                entityAnnotations[currentEntity] = [];
            }
            inGaps = false;
            continue;
        }

        if (/^##\s*缺口/.test(line)) {
            inGaps = true;
            currentEntity = null;
            continue;
        }

        if (inGaps) {
            var gapMatch = line.match(/^[-*]\s+(.+)/);
            if (gapMatch && gapMatch[1].trim() !== '无') {
                gaps.push(gapMatch[1].trim());
            }
            continue;
        }

        var kbMatch = line.match(/^\[KB:\s*(.+?)\]/);
        if (kbMatch) {
            var kbContent = kbMatch[1].trim();
            if (kbContent === '无') {
                hasKB = false;
                continue;
            }
            if (currentEntity) {
                var parsed = parseKBLine(kbContent);
                if (parsed) {
                    entityAnnotations[currentEntity].push(parsed);
                    hasKB = true;
                }
            }
        }
    }

    return {
        entityAnnotations: entityAnnotations,
        gaps: gaps,
        hasKB: hasKB
    };
}

function parseKBLine(line) {
    var match = line.match(/^(.+?)=(.+?)(?:\((.+)\))?$/);
    if (!match) return null;
    var level = match[2].trim();
    var validLevels = ['直接知晓', '间接知晓', '线索', '未知'];
    if (validLevels.indexOf(level) === -1) {
        var fuzzy = validLevels.find(function(v) { return v.indexOf(level) !== -1 || level.indexOf(v) !== -1; });
        if (fuzzy) level = fuzzy;
    }
    return {
        name: match[1].trim(),
        level: level,
        reason: (match[3] || '').trim()
    };
}


function buildEntityBlock(entityGrouped, entityAnnotations) {
    var lines = [];
    lines.push('## 实体记忆链');
    lines.push('');

    Object.keys(entityGrouped.groups).forEach(function(name) {
        var group = entityGrouped.groups[name];
        var annotations = entityAnnotations[name] || [];

        var kbLine = '';
        if (annotations.length > 0) {
            kbLine = ' [KB: ' + annotations.map(function(a) {
                return a.name + '=' + a.level + (a.reason ? '(' + a.reason + ')' : '');
            }).join(' | ') + ']';
        }

        var refCount = group.refs ? group.refs.length : 0;
        var refPart = refCount > 0 ? ', ' + refCount + ' refs' : '';
        lines.push('### ' + name + ' (' + group.entries.length + ' events' + refPart + ')' + kbLine);

        group.entries.forEach(function(e, idx) {
            var timePart = e.entry.period || '';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            lines.push((idx + 1) + '. [' + timePart + '] ' + (scene ? scene + ': ' : '') + event);

            if (e._originalText) {
                lines.push('   > ' + e._originalText.replace(/\n/g, '\n   > '));
            }
        });

        if (group.refs && group.refs.length > 0) {
            lines.push('');
            var refMap = {};
            group.refs.forEach(function(r) {
                if (!refMap[r.primaryName]) refMap[r.primaryName] = [];
                refMap[r.primaryName].push(r.entryId);
            });
            Object.keys(refMap).forEach(function(primary) {
                lines.push('   关联: 见「' + primary + '」' + refMap[primary].join(', '));
            });
        }

        lines.push('');
    });

    if (entityGrouped.unassigned && entityGrouped.unassigned.length > 0) {
        lines.push('### 未标注条目 (' + entityGrouped.unassigned.length + ' entries)');
        entityGrouped.unassigned.forEach(function(e, idx) {
            var timePart = e.entry.period || '';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            lines.push((idx + 1) + '. [' + timePart + '] ' + (scene ? scene + ': ' : '') + event);
        });
        lines.push('');
    }

    return lines.join('\n');
}

function buildMemoryUsageGuide() {
    var lines = [];
    lines.push('## 记忆使用指南');
    lines.push('以上记忆按实体分链，时间排序。每条链顶部的 KB 标注表示各角色对该链事件集合的知晓程度：');
    lines.push('- **直接知晓** = 该角色亲自在场或经历，完全知情。可自由使用链中所有事件来驱动决策和对话。');
    lines.push('- **间接知晓** = 该角色通过转述、书面记录或可观察后果推断得知。可引用链中事件但需保持细节不确定性。');
    lines.push('- **线索** = 该角色只有碎片信息。仅能基于碎片做有限推理，不应表现出全知。');
    lines.push('- 链中未提到的角色 = 该角色**不知道**此链中的事件。仅供你理解全局故事语境，禁止该角色在对话中表现出知情。');
    return lines.join('\n');
}

function compileRetrievalBudget(content, query, entityNames, entityChains, budgetTokens) {
    if (!entityChains || Object.keys(entityChains).length === 0) return ''
    var allSTM = sortStmByMsgOrder((content.unconsolidated_stm || []).concat(content.stm_entries || []))
    var allLTM = content.ltm_entries || []

    var scoredEntities = []
    Object.keys(entityChains).forEach(function(name) {
        var chain = entityChains[name]
        if (!chain || chain.length === 0) return
        var bm25Score = 0
        var qLower = (query || '').toLowerCase()
        var nLower = name.toLowerCase()
        if (qLower.indexOf(nLower) !== -1) bm25Score = 0.8
        else {
            var parts = name.split(/[\s\-_]+/)
            var matched = 0
            parts.forEach(function(p) { if (qLower.indexOf(p.toLowerCase()) !== -1) matched++ })
            bm25Score = parts.length > 0 ? matched / parts.length * 0.5 : 0.1
        }
        var recencyScore = 0
        if (chain.length > 0) {
            var lastEntry = chain[chain.length - 1]
            var daysAgo = lastEntry.timestamp
                ? (Date.now() - new Date(lastEntry.timestamp).getTime()) / 86400000
                : 30
            recencyScore = Math.max(0, 1 - daysAgo / 90)
        }
        var lengthScore = Math.min(chain.length / 15, 1)
        var score = bm25Score * 0.6 + recencyScore * 0.25 + lengthScore * 0.15
        scoredEntities.push({ name: name, chain: chain, score: score })
    })
    if (scoredEntities.length === 0) return ''

    scoredEntities.sort(function(a, b) { return b.score - a.score })

    var totalScore = 0
    scoredEntities.forEach(function(e) { totalScore += e.score })
    if (totalScore === 0) totalScore = 1

    var result = '## 相关实体事件\n'
    var usedTokens = 40
    var tokenPerEntry = 40

    for (var i = 0; i < scoredEntities.length; i++) {
        var se = scoredEntities[i]
        var allocTokens = Math.floor(budgetTokens * (se.score / totalScore))
        var maxEntries = Math.max(1, Math.floor((allocTokens - 20) / tokenPerEntry))
        var selectedEntries = se.chain.slice(-maxEntries)
        if (usedTokens + 20 > budgetTokens) break

        result += '**' + se.name + '**: '
        var summaries = selectedEntries.map(function(e) {
            return (e.title || e.event || e.summary || '').substring(0, 35)
        })
        result += summaries.join(' | ') + '\n'
        usedTokens += 20 + summaries.length * tokenPerEntry
    }
    return result.trim()
}

export function buildStateOnlyInjection(vault) {
    return '[ℹ No memory entries available and no World Book state. The current context is limited to chat history only.]';
}

function formatBM25Results(query, candidates) {
    if (!candidates || candidates.length === 0) return '';
    var lines = [];
    lines.push('## Relevant memories for: ' + query);
    lines.push('');
    candidates.forEach(function(c) {
        var timePart = (c.time_range || c.period || '');
        if (c.time_label) timePart = timePart + '·' + c.time_label;
        var refs = '';
        if (c.msg_ids && c.msg_ids.length > 0) {
            refs = ' [→' + c.msg_ids.join(',') + ']';
        } else if (c.stm_refs && c.stm_refs.length > 0) {
            refs = ' [→' + c.stm_refs.join(',') + ']';
        }
        lines.push('- [' + timePart + '] ' + (c.scene || '') + ': ' + (c.event || c.summary || '') + refs);
    });
    lines.push('');
    return lines.join('\n');
}

function prefetchOriginalTexts(notebook, chatMessages, visibleWindow, topK) {
    if (!chatMessages || chatMessages.length === 0) return;
    topK = topK || 3;
    var entries = [];
    notebook.map.forEach(function(v) { entries.push(v); });
    entries.sort(function(a, b) { return (b.bm25Score || 0) - (a.bm25Score || 0); });

    entries.slice(0, topK).forEach(function(entry) {
        var raw = entry.entry;
        var msgIds = raw.msg_ids;
        if (!msgIds || msgIds.length === 0) return;

        if (visibleWindow && visibleWindow.length > 0) {
            var allInWindow = msgIds.every(function(mid) {
                return visibleWindow.some(function(vm) {
                return String(vm._msg_id) === String(mid);
                });
            });
            if (allInWindow) return;
        }

        var originalLines = [];
        var totalLen = 0;
        var MAX_TOTAL = 2000;
        msgIds.forEach(function(mid) {
            if (totalLen >= MAX_TOTAL) return;
            var msg = chatMessages.find(function(m) { return String(m.id != null ? m.id : m.mes_id) === String(mid); });
            if (msg) {
                var name = msg.name || (msg.role === 'user' ? 'User' : 'AI');
                var text = typeof msg.mes === 'string' ? msg.mes : (msg.content || '');
                if (text) {
                    var line = '[msg_' + mid + '] ' + name + ': ' + text.substring(0, 200);
                    if (totalLen + line.length > MAX_TOTAL) {
                        line = line.substring(0, MAX_TOTAL - totalLen);
                    }
                    originalLines.push(line);
                    totalLen += line.length;
                }
            }
        });
        if (originalLines.length > 0) {
            entry._originalText = originalLines.join('\n');
        }
    });
}
