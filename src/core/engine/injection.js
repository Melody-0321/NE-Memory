import { sortStmByMsgOrder, readState } from '../vault/store.js';
import { filterCandidates } from '../vault/retrieval-filter.js';
import { extractEntityNames, lookupEntityChains, mergePipelines, groupCandidatesByEntity } from './retrieval.js';
import { resolveAmbiguousReferences } from './ambiguity.js';
import { recordTelemetry } from '../api/llm.js';
import { countTokens } from './text-utils.js';
import { findMessageInChat, buildMsgId } from './msg-id.js';
import { calRelativeTime } from './time-utils.js';
import { readNeSettingsCached } from '../settings.js';

// R2: 可见窗口每条消息 token 计数缓存（key = chatId + 消息身份 + 内容长度指纹，捕捉 swipe/reroll/编辑）
var _msgTokenCache = {};
var _msgTokenCacheSize = 0;
var MSG_TOKEN_CACHE_MAX = 2000; // R2 修复：缓存上限，超限整体重置防止无界增长
// R2: sortStmByMsgOrder 结果缓存（key = chatId + STM id+位置序列指纹，消息集不变则排序结果不变）
var _sortCache = { chatId: null, fp: null, result: null };

function _msgCacheKey(chatId, m, text) {
    var identity;
    if (m.id != null) identity = String(m.id);
    else if (m.send_date) identity = String(m.send_date);
    else if (m.created_date) identity = String(m.created_date);
    else identity = 'no-id';
    return (chatId || '') + '\x00' + identity + '\x00' + text.length;
}

function sortStmCached(chatId, entries) {
    if (!entries || entries.length < 2) return entries;
    var fpParts = [];
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var pos = e.absMsgStart !== undefined ? e.absMsgStart
            : (e.msgRange && e.msgRange[0] !== undefined ? e.msgRange[0] : 'inf');
        fpParts.push(e.id + ':' + pos);
    }
    var fpStr = fpParts.join('|');
    // R2 修复：指纹必须绑定 chatId，否则两个 chat 的 STM id/位置序列相同时
    // 会误命中返回另一 chat 的排序数组（对象引用），把错误记忆注入当前上下文
    if (_sortCache.chatId === (chatId || '') && _sortCache.fp === fpStr) return _sortCache.result.slice();
    var sorted = sortStmByMsgOrder(entries);
    _sortCache.chatId = chatId || '';
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

function computeVisibleWindow(chatMessages, maxContext, chatId) {
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
        // R2: 每条消息 token 计数缓存（chatId+消息身份+长度指纹，编辑/swap 自动失效）
        var cacheKey = _msgCacheKey(chatId, m, text);
        var tokens;
        if (_msgTokenCache[cacheKey] !== undefined) {
            tokens = _msgTokenCache[cacheKey];
        } else {
            tokens = countTokens(text) + 10;
            _msgTokenCache[cacheKey] = tokens;
            _msgTokenCacheSize++;
            // R2 修复：缓存有界，超限整体重置（token 计数成本低，重置可接受）
            if (_msgTokenCacheSize > MSG_TOKEN_CACHE_MAX) {
                _msgTokenCache = {};
                _msgTokenCacheSize = 0;
            }
        }
        if (accumulated + tokens > available) break;
        accumulated += tokens;
        m._msg_id = buildMsgId(m, i);
        visible.unshift(m);
    }

    return visible;
}

// ── P0 query 加权融合（bench-cross W78f 消融定型：user .78 / 末条 assistant .22，ctx ≤400字）──
// 替代旧字符串拼接形态（E1=B 消融证明拼接稀释用户意图是注入层损失的全部来源）
var QUERY_W_USER = 0.78;

// 两路信号提取：主信号=当前用户输入（不截断），辅助=末条 assistant（≤ctxMaxChars）
export function buildWeightedQueryLegs(chatMessages, neSettings) {
    var ctxMaxChars = (neSettings && neSettings.queryAiWeight === 'low') ? 200 : 400;
    var userLeg = '';
    var ctxLeg = '';
    if (chatMessages && chatMessages.length > 0) {
        for (var i = chatMessages.length - 1; i >= 0; i--) {
            var mi = chatMessages[i];
            if (!mi) continue;
            var txt = typeof mi.mes === 'string' ? mi.mes : (mi.content || '');
            if (!txt || txt.trim().length <= 5) continue;
            if (mi.role === 'user' || mi.is_user) {
                if (!userLeg) userLeg = txt.trim();
            } else if (!ctxLeg) {
                ctxLeg = txt.trim().substring(0, ctxMaxChars);
            }
            if (userLeg && ctxLeg) break;
        }
    }
    return { userLeg: userLeg, ctxLeg: ctxLeg };
}

// 两路检索分数加权合并（__relevance 已是归一分数；缺腿记 0）
export function fuseWeightedRuns(userRun, ctxRun, wUser) {
    var wCtx = 1 - wUser;
    var byId = new Map();
    (userRun || []).forEach(function (c) {
        var id = c.__id || c.id;
        if (id) byId.set(id, { c: c, u: Number(c.__relevance) || 0, x: 0 });
    });
    (ctxRun || []).forEach(function (c) {
        var id = c.__id || c.id;
        if (!id) return;
        if (byId.has(id)) { byId.get(id).x = Number(c.__relevance) || 0; }
        else { byId.set(id, { c: c, u: 0, x: Number(c.__relevance) || 0 }); }
    });
    var fused = [];
    byId.forEach(function (v) {
        var f = Object.assign({}, v.c);
        f.__relevance = wUser * v.u + wCtx * v.x;
        fused.push(f);
    });
    fused.sort(function (a, b) { return b.__relevance - a.__relevance; });
    return fused;
}

export async function formatSmartContext(vault, chatMessages, budget, chatId) {
    if (!budget) {
        budget = estimateComplexityBudget(chatMessages);
    }
    var content = vault.content || {};
    var state = content.state || {};

    var allSTM = sortStmCached(chatId, (content.unconsolidated_stm || []).concat(content.stm_entries || []));
    var allLTM = content.ltm_entries || [];

    if (allSTM.length === 0 && allLTM.length === 0) {
        return buildStateOnlyInjection(vault);
    }

    var visibleWindow = computeVisibleWindow(chatMessages, null, chatId);

    // P7: 走缓存解析，避免每轮注入全量 JSON.parse
    var neSettings = readNeSettingsCached();

    // P0 query 加权融合：主信号=当前用户输入，辅助=末条 assistant（两路检索分数加权，见下）
    var legs = buildWeightedQueryLegs(chatMessages, neSettings);
    var ctxLeg = legs.ctxLeg;
    var query = legs.userLeg;
    if (query) {
        var prefix = buildRetrievalPrefix(content, state);
        if (prefix) query = prefix + '\n' + query;
    }
    if (!query) {
        // 无用户输入兜底（narrator-only 等）：沿用故事状态构造主信号
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
            // P0 加权融合：user 腿与 ctx 腿各跑一路检索，分数加权合并取 top40
            var userRun = await filterCandidates(query, allSTM, allLTM, 40, 3, aliasesMap, chatId);
            var ctxRun = [];
            if (ctxLeg) {
                ctxRun = await filterCandidates(ctxLeg, allSTM, allLTM, 40, 3, aliasesMap, chatId);
            }
            topCandidates = fuseWeightedRuns(userRun, ctxRun, QUERY_W_USER).slice(0, 40);
            topCandidates._vectorUsed = !!((userRun && userRun._vectorUsed) || (ctxRun && ctxRun._vectorUsed));
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

    if (vault.content && vault.content.meta_ltm_entries && vault.content.meta_ltm_entries.length > 0) {
        var metaOverview = buildMetaLtmOverview(vault.content.meta_ltm_entries);
        if (metaOverview) {
            if (parts.length > 0) parts.push('<hr>');
            parts.push(metaOverview);
        }
    }

    if (vault.content && vault.content.suspense_entries && vault.content.suspense_entries.length > 0) {
        var suspenseOverview = buildSuspenseOverview(vault.content.suspense_entries);
        if (suspenseOverview) {
            if (parts.length > 0) parts.push('<hr>');
            parts.push(suspenseOverview);
        }
    }

    // P0 状态原子块（压场层，默认 off）：stateVault 是 state 数据正主（memory vault 侧被剥离）
    if (neSettings.stateBlockEnabled) {
        try {
            var stateVault = await readState(chatId);
            var stateAtomBlock = buildStateAtomBlock(stateVault && stateVault.content && stateVault.content.state, {
                valueMaxChars: neSettings.stateBlockValueMaxChars || 120
            });
            if (stateAtomBlock) {
                if (parts.length > 0) parts.push('<hr>');
                parts.push(stateAtomBlock);
            }
        } catch (e) {
            console.warn('[NE] 状态原子块读取失败:', e && e.message);
        }
    }

    // P1 弧激活：三明治渲染（压场层，默认 off）——打分命中弧 + arc_pull 拉入弧；
    // 目录搭车 LTM（relevance=0）不进弧块，维持原实体组折叠路径
    if (neSettings.arcInjectionEnabled && pipelineMerged && pipelineMerged.map) {
        var arcBlock = buildArcBlock(pipelineMerged.map);
        if (arcBlock) {
            if (parts.length > 0) parts.push('<hr>');
            parts.push(arcBlock);
        }
    }

    if (entityGrouped && (Object.keys(entityGrouped.groups).length > 0 || entityGrouped.unassigned.length > 0)) {
        var activeChars = getActiveCharacters(state);
        var storyTime = (content && content.story_time) ? content.story_time : null;

        // [2026-08-19] key-highlights 生产调用已移除：三层仪器评测零收益 + 方向性负（canonical §8/§8.2），函数保留供评测脚本使用

        var entityBlock = buildEntityBlock(entityGrouped, {}, activeChars, storyTime, {
            budgetChars: neSettings.injectionBudgetChars || 0,
            entryMaxChars: neSettings.injectionEntryMaxChars || 0,
            quoteMaxChars: neSettings.injectionQuoteMaxChars || 0,
        });
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
        var budgetText = compileRetrievalBudget(content, query, entityNames, entityChains, neSettings.retrievalBudgetTokens || 300, chatId);
        if (budgetText) {
            if (parts.length > 0) parts.push('<hr>');
            parts.push(budgetText);
        }
    }

    return parts.join('\n\n');
}

/**
 * 格式化单条 STM entry 为可读文本（供注入和楼内面板复用）。
 *
 * NE 与柏宝书的关键差异：NE 的 STM 数据存在外部 vault（IndexedDB），
 * 不嵌入 chat 消息对象。楼内面板通过 msg_ids 反查定位所属 STM，
 * 然后调用本函数渲染。
 *
 * @param {STMEvent} entry — STM 条目（注意：是 entry 本身，不是 UnifiedEntry 包装）
 * @param {number} storyTime — 故事时间戳（用于相对时间计算）
 * @returns {string} 多行文本
 */
export function formatStmEntry(entry, storyTime) {
    var timePart = entry.period || '';
    var relative = calRelativeTime(entry.timestamp, storyTime);
    var scene = entry.scene || '';
    var event = entry.event || entry.summary || '';
    var line = (relative ? relative + ' ' : '') + '[' + timePart + '] ' + (scene ? scene + ': ' : '') + event;

    // 在场角色（兼容旧 entities）
    var present = entry.present_characters || entry.entities || [];
    if (present && present.length > 0) {
        var presentNames = present.map(function(p) { return typeof p === 'string' ? p : p.name; });
        line += ' | 在场: ' + presentNames.join('、');
    }

    // 角色心理（兼容旧 _inner_thoughts）
    var psyche = entry.character_psyche;
    var oldThoughts = entry._inner_thoughts;
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

    return line;
}

export function buildEntityBlock(entityGrouped, entityAnnotations, activeChars, storyTime, opts) {
    // Stage 3 注入预算（全 0=off，输出与无 opts 调用逐字节一致）：
    //   entryMaxChars 单条 event 文本上限；quoteMaxChars 原文引语上限；
    //   budgetChars 实体块总量上限，超限按 relevance 升序（同分旧的先折）把命中条目
    //   降级为 fold 标记（LWB 形态），保底全局 top-1 展开，防全折叠
    var entryMaxChars = (opts && Number(opts.entryMaxChars)) || 0;
    var quoteMaxChars = (opts && Number(opts.quoteMaxChars)) || 0;
    var budgetChars = (opts && Number(opts.budgetChars)) || 0;
    var budgetFoldIds = null;

    function capText(s, n) {
        if (!n || !s) return s || '';
        s = String(s);
        return s.length > n ? s.slice(0, n) + '…' : s;
    }

    function isRenderedHit(e) {
        return e.relevance > 0 && !(budgetFoldIds && budgetFoldIds.has(e.entry.id));
    }

    function render() {
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
            var entry = e.entry;
            if (entryMaxChars) {
                var ev = entry.event || entry.summary || '';
                if (ev && String(ev).length > entryMaxChars) {
                    entry = Object.assign({}, entry);
                    if (entry.event) entry.event = capText(entry.event, entryMaxChars);
                    else entry.summary = capText(entry.summary, entryMaxChars);
                }
            }
            var line = formatStmEntry(entry, storyTime);
            if (e._originalText) {
                line += '\n   > ' + capText(e._originalText, quoteMaxChars).replace(/\n/g, '\n   > ');
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
                if (isRenderedHit(e)) {
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
            var unassignedFolded = 0;
            entityGrouped.unassigned.forEach(function(e, idx) {
                if (budgetFoldIds && budgetFoldIds.has(e.entry.id)) { unassignedFolded++; return; }
                var score = e.relevance > 0 ? ' [score:' + e.relevance.toFixed(3) + ']' : '';
                var relative = calRelativeTime(e.entry.timestamp, storyTime);
                var timePart = e.entry.period || '';
                var scene = e.entry.scene || '';
                var event = e.entry.event || e.entry.summary || '';
                lines.push((idx + 1) + '. ' + (relative ? relative + ' ' : '') + '[' + timePart + '] ' + (scene ? scene + ': ' : '') + event + score);
            });
            if (unassignedFolded > 0) {
                lines.push('（' + unassignedFolded + ' 条预算内未展开）');
            }
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

    function collectExpandableHits() {
        var out = [];
        var groups = entityGrouped.groups || {};
        Object.keys(groups).forEach(function(name) {
            var entries = (groups[name] && groups[name].entries) || [];
            entries.forEach(function(e) {
                if (e && e.relevance > 0 && e.entry && e.entry.id) out.push(e);
            });
        });
        (entityGrouped.unassigned || []).forEach(function(e) {
            if (e && e.relevance > 0 && e.entry && e.entry.id) out.push(e);
        });
        return out;
    }

    var text = render();
    if (budgetChars > 0 && text.length > budgetChars) {
        var expandable = collectExpandableHits();
        expandable.sort(function(a, b) {
            var ra = a.relevance || 0;
            var rb = b.relevance || 0;
            if (ra !== rb) return ra - rb;
            var ta = a.entry.timestamp ? new Date(a.entry.timestamp).getTime() : 0;
            var tb = b.entry.timestamp ? new Date(b.entry.timestamp).getTime() : 0;
            return ta - tb;
        });
        budgetFoldIds = new Set();
        for (var i = 0; i < expandable.length - 1; i++) {
            budgetFoldIds.add(expandable[i].entry.id);
            text = render();
            if (text.length <= budgetChars) break;
        }
    }
    return text;
}



function compileRetrievalBudget(content, query, entityNames, entityChains, budgetTokens, chatId) {
    if (!entityChains || Object.keys(entityChains).length === 0) return ''
    var allSTM = sortStmCached(chatId, (content.unconsolidated_stm || []).concat(content.stm_entries || []))
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

function buildMetaLtmOverview(metaLtmEntries) {
    if (!metaLtmEntries || metaLtmEntries.length === 0) return '';
    var sorted = metaLtmEntries.slice().sort(function(a, b) {
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
    // 只展示有标题的条目（开放占位符 Meta-LTM 无标题，跳过避免注入空白块）
    var maxShow = 5;
    var titled = sorted.filter(function(m) { return m.title; }).slice(0, maxShow);
    if (titled.length === 0) return '';
    var lines = ['## 故事弧概览'];
    titled.forEach(function(m) {
        var title = m.title || '';
        var event = m.event || '';
        var arcCount = m.arc_count || (m.ltm_refs || []).length;
        lines.push('### ' + title + ' (' + arcCount + ' 弧)');
        if (event) lines.push(event);
    });
    return lines.join('\n');
}

/**
 * P0 状态原子块：把 stateVault 的模板字段状态渲染为 LWB `[定了的事]` 形态的属性表。
 *
 * 压场层通道（E1 已验证形态收益：narrative 15%→28%）——持续性事实（住哪/职业/关系态度）
 * 与事件流互补：事件只含"发生过什么"，属性表承载"现在是什么"。跨 query 恒定注入。
 *
 * 数据源：readState(chatId).content.state（生产上 memory vault 的 state 字段被
 * _stripStateFieldsForMemory 剥离，stateVault 是唯一正主）。
 * 渲染规则：跳过空值/'(未填)'/`_` 前缀系统字段；对象字段（如 affection: {安然: '好感…'}）
 * 展开为 `k: v; k: v` 列表（避免 [object Object]）；旁白/系统等伪角色槽整卡跳过
 * （叙述视角非故事人物，纯噪声）；单字段值超长截断（默认 120 字符）。
 *
 * @param {object} stateData stateVault.content.state（{ characters, factions, ... }）
 * @param {object} [opts] { valueMaxChars }（0=不截断）
 * @returns {string} 空串表示无内容（调用方跳过）
 */
var NARRATOR_NAME_RE = /^(旁白|叙述者|系统|narrator|system)$/i;

export function buildStateAtomBlock(stateData, opts) {
    var valueMaxChars = (opts && Number(opts.valueMaxChars)) || 0;
    var state = stateData || {};
    var lines = ['[当前状态] 已确立的事实'];

    function capValue(v) {
        var s = String(v == null ? '' : v);
        if (valueMaxChars && s.length > valueMaxChars) return s.slice(0, valueMaxChars) + '…';
        return s;
    }

    function isRenderableValue(v) {
        if (v === null || v === undefined) return false;
        var s = String(v);
        return s !== '' && s !== '(未填)';
    }

    var chars = state.characters || {};
    var charNames = Object.keys(chars);
    var peopleLines = [];
    charNames.forEach(function(name) {
        if (NARRATOR_NAME_RE.test(name)) return; // 旁白/系统等伪角色槽：叙述视角非故事人物
        var card = chars[name];
        if (!card || typeof card !== 'object') return;
        var fieldLines = [];
        Object.keys(card).forEach(function(fk) {
            if (fk.charAt(0) === '_') return;
            var v = card[fk];
            if (Array.isArray(v)) {
                if (v.length === 0) return;
                v = v.join('、');
            } else if (v !== null && typeof v === 'object') {
                // 对象字段（如 affection: {安然: '好感…'}）展开为 k: v 列表，避免 [object Object]
                var pairs = [];
                Object.keys(v).forEach(function(ok) {
                    if (ok.charAt(0) === '_') return;
                    var ov = v[ok];
                    if (Array.isArray(ov)) {
                        if (ov.length > 0) pairs.push(ok + ': ' + ov.join('、'));
                    } else if (ov !== null && typeof ov !== 'object' && isRenderableValue(ov)) {
                        pairs.push(ok + ': ' + ov);
                    }
                });
                if (pairs.length === 0) return;
                v = pairs.join('; ');
            }
            if (!isRenderableValue(v)) return;
            fieldLines.push('    - ' + fk + ': ' + capValue(v));
        });
        if (fieldLines.length > 0) peopleLines.push('  ' + name + ':\n' + fieldLines.join('\n'));
    });
    if (peopleLines.length > 0) lines.push('people:\n' + peopleLines.join('\n'));

    var factions = state.factions || {};
    var worldLines = [];
    Object.keys(factions).forEach(function(key) {
        var f = factions[key];
        if (!f || typeof f !== 'object' || f._hidden) return;
        var fName = f.name || key;
        var fieldLines = [];
        if (isRenderableValue(f.description)) fieldLines.push('    - 描述: ' + capValue(f.description));
        if (isRenderableValue(f.leader)) fieldLines.push('    - 领导: ' + capValue(f.leader));
        if (isRenderableValue(f.attitude_toward_player)) fieldLines.push('    - 对主角态度: ' + capValue(f.attitude_toward_player));
        if (isRenderableValue(f.notes)) fieldLines.push('    - 备注: ' + capValue(f.notes));
        if (fieldLines.length > 0) worldLines.push('  ' + fName + ':\n' + fieldLines.join('\n'));
    });
    if (worldLines.length > 0) lines.push('world:\n' + worldLines.join('\n'));

    if (lines.length === 1) return '';
    return lines.join('\n');
}

/**
 * P1 弧激活：三明治渲染（对标 LWB ⭐星号段形态）。
 *
 * 形态：弧标题（time_range + title，答案级摘要）→ 弧摘要（event 全文，因果俯瞰）
 *       → 嵌套拍（period + event，故事时序，缩进 2 格）。
 *
 * 数据源：mergePipelines map 中 type='ltm' 且 relevance>0 的条目——
 *   - 打分命中弧（bm25/vector）：arc_expand 已拉全 stm_refs → 嵌该弧全部在场拍
 *   - arc_pull 拉入弧：只嵌该弧下已命中拍（relevance>0，控 token）
 * 目录搭车（ltm_dir，relevance=0）与小池全量 LTM 不进弧块（走原有实体组折叠路径）。
 *
 * @param {Map} mergedMap mergePipelines 输出的 map（entry 包装：{entry,type,relevance,sources}）
 * @returns {string} 空串表示无弧（调用方跳过）
 */
export function buildArcBlock(mergedMap) {
    if (!mergedMap || typeof mergedMap.forEach !== 'function') return '';
    var arcs = [];
    mergedMap.forEach(function(e) {
        if (!e || e.type !== 'ltm') return;
        if (!e.relevance || e.relevance <= 0) return;
        if (e.sources && e.sources.indexOf('ltm_dir') !== -1) return;
        arcs.push(e);
    });
    if (arcs.length === 0) return '';

    // 嵌套拍收集：按 parent_ltm 分组
    var beatsByArc = {};
    mergedMap.forEach(function(e) {
        if (!e || e.type !== 'stm') return;
        var parentId = e.entry && e.entry.parent_ltm;
        if (!parentId) return;
        if (!beatsByArc[parentId]) beatsByArc[parentId] = [];
        beatsByArc[parentId].push(e);
    });

    // 弧排序：time_range 升序（Day 数字语义——字符串比较会把 Day 10 排到 Day 2 前）
    function arcDayKey(timeRange) {
        var m = String(timeRange || '').match(/Day\s*(\d+)/i);
        return m ? Number(m[1]) : Infinity; // 无 Day 标签排最后
    }
    arcs.sort(function(a, b) {
        var ka = arcDayKey(a.entry && a.entry.time_range);
        var kb = arcDayKey(b.entry && b.entry.time_range);
        if (ka !== kb) return ka - kb;
        return String((a.entry && a.entry.time_range) || '').localeCompare(String((b.entry && b.entry.time_range) || ''));
    });

    var lines = ['## 剧情弧'];
    arcs.forEach(function(arc) {
        var entry = arc.entry || {};
        var tr = entry.time_range || '';
        lines.push('⭐ ' + (tr ? '[' + tr + '] ' : '') + (entry.title || ''));
        if (entry.event) lines.push(String(entry.event));

        var beats = (beatsByArc[entry.id] || []).slice();
        // arc_pull 拉入弧：只嵌已命中拍（relevance>0）；正向命中弧嵌全部在场拍
        if (arc.sources && arc.sources.indexOf('arc_pull') !== -1) {
            beats = beats.filter(function(b) { return b.relevance > 0; });
        }
        // 故事时序排序（复用 sortStmByMsgOrder 的 absMsgStart/msgRange 语义）
        var wrapperByEntry = new Map();
        beats.forEach(function(b) { wrapperByEntry.set(b.entry, b); });
        beats = sortStmByMsgOrder(beats.map(function(b) { return b.entry; }))
            .map(function(ent) { return wrapperByEntry.get(ent); })
            .filter(Boolean);

        beats.forEach(function(b) {
            var p = (b.entry && b.entry.period) || '';
            var ev = (b.entry && (b.entry.event || b.entry.summary)) || '';
            lines.push('  › ' + (p ? '[' + p + '] ' : '') + ev);
        });
        lines.push('');
    });

    return lines.join('\n').replace(/\n+$/, '');
}

function buildSuspenseOverview(suspenseEntries) {
    if (!suspenseEntries || suspenseEntries.length === 0) return '';
    var open = suspenseEntries.filter(function(e) { return e.status === 'open'; });
    if (open.length === 0) return '';

    open.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });

    var lines = ['## 悬念簿'];
    open.forEach(function(h) {
        var cat = h.category || 'suspense';
        lines.push('### [' + cat + '] ' + (h.title || ''));
        if (h.event) lines.push(h.event);
        var meta = [];
        if (h.present_characters && h.present_characters.length) meta.push('角色: ' + h.present_characters.join(', '));
        if (h.raised_at_period) meta.push('来源: ' + h.raised_at_period);
        if (meta.length) lines.push(meta.join(' | '));
    });

    // 已了结钩子简要列表（最多 5 条），带核销语义
    var resolved = suspenseEntries.filter(function(e) { return e.status === 'resolved'; })
        .sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); })
        .slice(0, 5);
    if (resolved.length > 0) {
        var outcomeLabel = { done: '已兑现', cancelled: '已作废', failed: '已失败' };
        lines.push('---');
        lines.push('已了结: ' + resolved.map(function(e) {
            var oc = outcomeLabel[e.outcome] || '已兑现';
            return '[' + (e.title || '') + '] (' + oc + ', ' + (e.resolved_at_period || e.raised_at_period || '') + ')';
        }).join(' · '));
    }

    return lines.join('\n');
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


