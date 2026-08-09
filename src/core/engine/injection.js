import { sortStmByMsgOrder } from '../vault/store.js';
import { filterCandidates } from '../vault/retrieval-filter.js';
import { extractEntityNames, lookupEntityChains, mergePipelines, groupCandidatesByEntity } from './retrieval.js';
import { resolveAmbiguousReferences } from './ambiguity.js';
import { recordTelemetry } from '../api/llm.js';
import { countTokens } from './text-utils.js';
import { findMessageInChat, buildMsgId } from './msg-id.js';
import { calRelativeTime } from './time-utils.js';
import { readNeSettingsCached } from '../settings.js';

// R2: 可见窗口每条消息 token 计数缓存（key = 消息身份 + 内容长度指纹，捕捉 swipe/reroll/编辑）
var _msgTokenCache = {};
// R2: sortStmByMsgOrder 结果缓存（key = STM id+位置序列指纹，消息集不变则排序结果不变）
var _sortCache = { fp: null, result: null };

function _msgCacheKey(m, text) {
    var identity;
    if (m.id != null) identity = String(m.id);
    else if (m.send_date) identity = String(m.send_date);
    else if (m.created_date) identity = String(m.created_date);
    else identity = 'no-id';
    return identity + '\x00' + text.length;
}

function sortStmCached(entries) {
    if (!entries || entries.length < 2) return entries;
    var fpParts = [];
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var pos = e.absMsgStart !== undefined ? e.absMsgStart
            : (e.msgRange && e.msgRange[0] !== undefined ? e.msgRange[0] : 'inf');
        fpParts.push(e.id + ':' + pos);
    }
    var fpStr = fpParts.join('|');
    if (_sortCache.fp === fpStr) return _sortCache.result.slice();
    var sorted = sortStmByMsgOrder(entries);
    _sortCache.fp = fpStr;
    _sortCache.result = sorted;
    return sorted;
}

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
    if (state && state.characters) {
        var activeChars = Object.keys(state.characters).filter(function(n) {
            var c = state.characters[n];
            return c && (c.status === '活跃' || c.status === 'active');
        });
        if (activeChars.length > 0) parts.push('活跃角色: ' + activeChars.join('、'));
    }
    return parts.length > 0 ? '【' + parts.join(' | ') + '】' : '';
}

function getActiveCharacters(state) {
    var chars = state.characters || {};
    return Object.keys(chars).filter(function(n) {
        var c = chars[n];
        return c && (c.status === '活跃' || c.status === 'active');
    });
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
        // R2: 每条消息 token 计数缓存（id+内容长度指纹，编辑/swap 自动失效）
        var cacheKey = _msgCacheKey(m, text);
        var tokens;
        if (_msgTokenCache[cacheKey] !== undefined) {
            tokens = _msgTokenCache[cacheKey];
        } else {
            tokens = countTokens(text) + 10;
            _msgTokenCache[cacheKey] = tokens;
        }
        if (accumulated + tokens > available) break;
        accumulated += tokens;
        m._msg_id = buildMsgId(m, i);
        visible.unshift(m);
    }

    return visible;
}

export async function formatSmartContext(vault, chatMessages, budget, chatId) {
    if (!budget) {
        budget = estimateComplexityBudget(chatMessages);
    }
    var content = vault.content || {};
    var state = content.state || {};

    var allSTM = sortStmCached((content.unconsolidated_stm || []).concat(content.stm_entries || []));
    var allLTM = content.ltm_entries || [];

    if (allSTM.length === 0 && allLTM.length === 0) {
        return buildStateOnlyInjection(vault);
    }

    var visibleWindow = computeVisibleWindow(chatMessages);

    // P7: 走缓存解析，避免每轮注入全量 JSON.parse
    var neSettings = readNeSettingsCached();

    var conversationContext = '';
    var query;
    if (chatMessages && chatMessages.length > 0) {
        var aiTexts = [];
        var userTexts = [];
        var MAX_ROUNDS = 2;
        var aiMaxRounds = (neSettings.queryAiWeight === 'low') ? 1 : 2;
        var aiMaxChars  = (neSettings.queryAiWeight === 'low') ? 200 : 400;
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
                if (aiTexts.length < aiMaxRounds) {
                    aiTexts.push(txt.trim().substring(0, aiMaxChars));
                }
            }
            if (userTexts.length >= MAX_ROUNDS && aiTexts.length >= aiMaxRounds) break;
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
    // P1-18: 实体链从事件指针（present_characters）实时构建——此前初始化为空对象后从未赋值，
    // mergePipelines 预取 / 场景外链块 / compileRetrievalBudget 三个消费点全部空转
    var entityChains = await lookupEntityChains(content, entityNames);

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
            sc.__relevance = 1;
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
                sc.__relevance = 1;
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

    try {
        prefetchOriginalTexts(pipelineMerged.map, chatMessages, visibleWindow, 3);
    } catch (e) {}

    var entityGrouped = (pipelineMerged && pipelineMerged.map && pipelineMerged.threadIndex)
        ? groupCandidatesByEntity(pipelineMerged.map, pipelineMerged.threadIndex)
        : { groups: {}, unassigned: [] };

    globalThis.__ne_debug_last_merge = pipelineMerged ? {
        mapSize: pipelineMerged.map ? pipelineMerged.map.size : 0,
        threadCount: pipelineMerged.threadIndex ? Object.keys(pipelineMerged.threadIndex).length : 0,
        threadKeys: pipelineMerged.threadIndex ? Object.keys(pipelineMerged.threadIndex) : [],
        availableChains: pipelineMerged.availableChains || [],
        time: new Date().toISOString()
    } : null;

    var smartPushTotalMs = Date.now() - smartPushStart;

    recordTelemetry({
        bm25_candidate_count: topCandidates ? topCandidates.length : 0,
        bm25_ms: bm25Ms,
        vector_used: useVector || false,
        smart_push_total_ms: smartPushTotalMs,
        memory_budget: budget
    });

    var parts = [];

    if (vault.memory_system_prompt) {
        parts.push(vault.memory_system_prompt);
    }

    if (entityGrouped && (Object.keys(entityGrouped.groups).length > 0 || entityGrouped.unassigned.length > 0)) {
        var activeChars = getActiveCharacters(state);
        var storyTime = (content && content.story_time) ? content.story_time : null;

        var highlights = buildKeyHighlights(pipelineMerged.map, entityGrouped, 5, storyTime);
        if (highlights) {
            if (parts.length > 0) parts.push('<hr>');
            parts.push(highlights);
        }

        var entityBlock = buildEntityBlock(entityGrouped, {}, activeChars, storyTime);
        if (entityBlock) {
            if (parts.length > 0) parts.push('<hr>');
            parts.push(entityBlock);
        }

        if (entityNames && entityNames.length > 0 && entityChains && Object.keys(entityChains).length > 0) {
            var mergedMap = pipelineMerged ? pipelineMerged.map : null;
            var unreachedChains = [];
            entityNames.forEach(function(name) {
                var chain = entityChains[name];
                if (!chain || chain.length === 0) return;
                if (mergedMap) {
                    var anyHit = chain.some(function(ce) {
                        return mergedMap.has(ce.id) && mergedMap.get(ce.id).relevance > 0;
                    });
                    if (anyHit) return;
                }
                var firstPeriod = chain[0].period || '';
                var lastPeriod = chain[chain.length - 1].period || '';
                var span = firstPeriod && lastPeriod && firstPeriod !== lastPeriod ? ' ' + firstPeriod + '-' + lastPeriod : (firstPeriod ? ' ' + firstPeriod : '');
                unreachedChains.push(name + ' (' + chain.length + '条链事件，均未在本次检索中命中，跨度' + span + ')');
            });
            if (unreachedChains.length > 0) {
                if (parts.length > 0) parts.push('<hr>');
                parts.push('场景外链: ' + unreachedChains.join('; '));
            }
        }
    }

    if (neSettings.retrievalBudgetEnabled) {
        var budgetText = compileRetrievalBudget(content, query, entityNames, entityChains, neSettings.retrievalBudgetTokens || 300);
        if (budgetText) {
            if (parts.length > 0) parts.push('<hr>');
            parts.push(budgetText);
        }
    }

    return parts.join('\n\n');
}

export function buildEntityBlock(entityGrouped, entityAnnotations, activeChars, storyTime) {
    var lines = [];

    var allGroups = entityGrouped.groups || {};
    var activeSet = {};
    if (activeChars && activeChars.length > 0) {
        activeChars.forEach(function(n) { activeSet[n] = true; });
    }

    var activeNames = [];
    var externalNames = [];
    Object.keys(allGroups).forEach(function(name) {
        if (activeSet[name]) { activeNames.push(name); }
        else { externalNames.push(name); }
    });

    function formatEntry(e) {
        var timePart = e.entry.period || '';
        var relative = calRelativeTime(e.entry.timestamp, storyTime);
        var scene = e.entry.scene || '';
        var event = e.entry.event || e.entry.summary || '';
        var line = (relative ? relative + ' ' : '') + '[' + timePart + '] ' + (scene ? scene + ': ' : '') + event;

        // 新增：在场角色（兼容旧 entities）
        var present = e.entry.present_characters || e.entry.entities || [];
        if (present && present.length > 0) {
            var presentNames = present.map(function(p) { return typeof p === 'string' ? p : p.name; });
            line += ' | 在场: ' + presentNames.join('、');
        }

        // 新增：角色心理（兼容旧 _inner_thoughts）
        var psyche = e.entry.character_psyche;
        var oldThoughts = e.entry._inner_thoughts;
        if (psyche && Object.keys(psyche).length > 0) {
            Object.keys(psyche).forEach(function(name) {
                var p = psyche[name] || {};
                var mood = p.current_mood || '';
                var thoughts = p.inner_thoughts || '';
                if (mood || thoughts) {
                    line += '\n   > ' + name + (mood ? ' [' + mood + ']' : '') + (thoughts ? ': ' + thoughts : '');
                }
            });
        } else if (oldThoughts && Object.keys(oldThoughts).length > 0) {
            // 旧数据兼容：_inner_thoughts 是 {角色名: [想法1, 想法2]}
            Object.keys(oldThoughts).forEach(function(name) {
                var thoughtsArr = oldThoughts[name] || [];
                if (thoughtsArr.length > 0) {
                    line += '\n   > ' + name + ' 内心: ' + thoughtsArr.join(' → ');
                }
            });
        }

        if (e._originalText) {
            line += '\n   > ' + e._originalText.replace(/\n/g, '\n   > ');
        }
        return line;
    }

    function foldMissRuns(entries) {
        var folded = [];
        var missRun = [];
        function flushMiss() {
            if (missRun.length === 0) return;
            if (missRun.length === 1) {
                var p = missRun[0].entry.period || '';
                folded.push('[' + p + '] （' + p + ' 未展开）');
            } else {
                var first = missRun[0].entry.period;
                var last = missRun[missRun.length - 1].entry.period;
                folded.push('[' + first + '] ' + first + '-' + last + '（' + missRun.length + '条事件未展开）');
            }
            missRun = [];
        }
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var isHit = e.relevance > 0;
            if (isHit) {
                flushMiss();
                folded.push(e);
            } else {
                missRun.push(e);
            }
        }
        flushMiss();
        return folded;
    }

    function renderGroup(name, group, annotations) {
        var kbLine = '';
        if (annotations.length > 0) {
            kbLine = ' [KB: ' + annotations.map(function(a) {
                return a.name + '=' + a.level + (a.reason ? '(' + a.reason + ')' : '');
            }).join(' | ') + ']';
        }

        var folded = foldMissRuns(group.entries);
        var hitCount = 0;
        var totalCount = group.entries.length;
        group.entries.forEach(function(e) {
            if (e.relevance > 0) hitCount++;
        });
        var refCount = group.refs ? group.refs.length : 0;
        var refPart = refCount > 0 ? ', ' + refCount + ' refs' : '';

        lines.push('<h3><b>' + name + '</b> <small>(' + totalCount + ' events in chain, ' + hitCount + ' hits' + refPart + ')' + kbLine + '</small></h3>');

        var idx = 0;
        folded.forEach(function(item) {
            idx++;
            if (typeof item === 'string') {
                lines.push(idx + '. ' + item);
            } else {
                lines.push(idx + '. ' + formatEntry(item));
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
                lines.push('   关联: 见「<b>' + primary + '</b>」' + refMap[primary].join(', '));
            });
        }

        lines.push('');
    }

    activeNames.forEach(function(name) {
        renderGroup(name, allGroups[name], entityAnnotations[name] || []);
    });

    if (entityGrouped.unassigned && entityGrouped.unassigned.length > 0) {
        lines.push('<h3>未标注条目 <small>(' + entityGrouped.unassigned.length + ' entries)</small></h3>');
        entityGrouped.unassigned.forEach(function(e, idx) {
            var score = e.relevance > 0 ? ' [score:' + e.relevance.toFixed(3) + ']' : '';
            var relative = calRelativeTime(e.entry.timestamp, storyTime);
            var timePart = e.entry.period || '';
            var scene = e.entry.scene || '';
            var event = e.entry.event || e.entry.summary || '';
            lines.push((idx + 1) + '. ' + (relative ? relative + ' ' : '') + '[' + timePart + '] ' + (scene ? scene + ': ' : '') + event + score);
        });
        lines.push('');
    }

    if (externalNames.length > 0) {
        lines.push('<h3>场景外角色</h3>');
        lines.push('');
        externalNames.forEach(function(name) {
            renderGroup(name, allGroups[name], entityAnnotations[name] || []);
        });
    }

    return lines.join('\n');
}



function compileRetrievalBudget(content, query, entityNames, entityChains, budgetTokens) {
    if (!entityChains || Object.keys(entityChains).length === 0) return ''
    var allSTM = sortStmCached((content.unconsolidated_stm || []).concat(content.stm_entries || []))
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

export function buildKeyHighlights(pipelineMap, entityGrouped, topK, storyTime) {
    topK = topK || 5;
    var entries = [];
    pipelineMap.forEach(function(v) {
        if (v._isDirectory || (v.sources && v.sources.indexOf('ltm_dir') >= 0)) return;
        if (!v.relevance || v.relevance <= 0) return;
        entries.push(v);
    });

    if (entries.length === 0) return '';

    entries.sort(function(a, b) { return (b.relevance || 0) - (a.relevance || 0); });
    entries = entries.slice(0, topK);

    var entryToGroup = {};
    var groups = entityGrouped.groups || {};
    Object.keys(groups).forEach(function(name) {
        groups[name].entries.forEach(function(ge) {
            if (ge.entry && ge.entry.id) {
                entryToGroup[ge.entry.id] = name;
            }
        });
    });

    var lines = ['<h2>关键记忆</h2>', ''];
    entries.forEach(function(e, i) {
        var relative = calRelativeTime(e.entry.timestamp, storyTime);
        var period = e.entry.period || '';
        var scene = e.entry.scene || '';
        var summary = e.entry.event || e.entry.summary || '';
        if (summary.length > 80) summary = summary.substring(0, 80) + '...';
        var groupName = entryToGroup[e.entry.id] || '';
        var ref = groupName ? ' \u2192 \u300c<b>' + groupName + '</b>\u300d' : '';
        lines.push((i + 1) + '. ' + (relative ? relative + ' ' : '') + '[' + period + '] ' + (scene ? scene + ': ' : '') + summary + ref);
    });
    lines.push('');

    return lines.join('\n');
}

function prefetchOriginalTexts(mapObj, chatMessages, visibleWindow, topK) {
    if (!chatMessages || chatMessages.length === 0) return;
    topK = topK || 3;
    var entries = [];
    mapObj.forEach(function(v) { entries.push(v); });
    entries.sort(function(a, b) { return (b.relevance || 0) - (a.relevance || 0); });

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
        msgIds.forEach(function(mid) {
            var msg = findMessageInChat(chatMessages, mid);
            if (msg) {
                var name = msg.name || (msg.role === 'user' ? 'User' : 'AI');
                var text = typeof msg.mes === 'string' ? msg.mes : (msg.content || '');
                if (text) {
                    var line = '[msg_' + mid + '] ' + name + ': ' + text.substring(0, 200);
                    originalLines.push(line);
                }
            }
        });
        if (originalLines.length > 0) {
            entry._originalText = originalLines.join('\n');
        }
    });
}


