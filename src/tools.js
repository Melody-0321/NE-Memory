/**
 * tools.js — Tool-calling 注册（通过 TH API）
 */
import { read } from './vault/store.js';
import { isRetrievalEnabled } from './settings.js';
import { filterCandidates, parseTimeConstraint, applyTimeFilter, isTimeOnlyQuery } from './vault/retrieval-filter.js';
import { buildRetrievalMessages } from './engine/retrieval.js';
import { callMemoryRetrieval, recordTelemetry, callMemoryLLM } from './api/llm.js';
import { addToolCall } from './engine/telemetry.js';
import { recordChatStat } from './engine/chat-telemetry.js';

export function registerAllTools(getChatId, getChatMessages) {
    if (typeof ToolManager === 'undefined') return;
    registerAccess(getChatId, getChatMessages);
    if (isRetrievalEnabled()) {
        registerRecallMemory(getChatId);
    }
}

function registerAccess(getChatId, getChatMessages) {
    ToolManager.registerFunctionTool({
        name: 'access',
        displayName: 'Access Memory & State',
        description: 'A unified tool to read any memory or state data by reference. Use when you know exactly what to look up (e.g., a specific message, character, item, or entity chain). Prefer recall_memory when you need to discover which entries are relevant.\n\nSupported ref formats:\n  Memory: "stm_12" or "ltm_3" — returns full entry text + children for further drill-down.\n  Message: "95" or "msg#95" — returns original message text. Optionally filter to passages mentioning specific entities: access("95", ["Frost"]).\n  Entity chain: "chain.龙牙剑" — returns complete timeline of all events related to an entity, sorted by time. The system may pre-mark available chains with [ℹ] tags — if you see such a tag, you know the chain exists and can be accessed.\n  State: "characters.爱丽丝", "factions.House Frost", "quests.Main" — returns full entity detail.\n\nNOT for open-ended searches — use recall_memory for those.',
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                ref: { type: 'string', description: 'Reference string: "stm_12", "ltm_3", "95", "characters.爱丽丝", "factions.House Frost", "quests.Main".' },
                entities: { type: 'array', items: { type: 'string' }, description: 'Optional. When expanding a msg, only return passages mentioning these entity names.' }
            },
            required: ['ref']
        }),
        action: async function (args) {
            var ref = args.ref || '';
            var refType = 'unknown';
            var result = '';
            var t0 = Date.now();
            try {
                var chatId = getChatId ? getChatId() : 'default';
                var vault = await read(chatId);
                var content = vault.content || {};
                var state = content.state || {};

                // msg#95 or bare digit 95 → original message
                if (ref.indexOf('msg#') === 0 || /^\d+$/.test(ref)) {
                    refType = 'msg';
                    var msgId = parseInt(ref.replace('msg#', ''));
                    var chat = getChatMessages();
                    var msg = chat.find(function(m) { return (m.id || m.mes_id) === msgId; });
                    if (!msg) result = 'Message #' + msgId + ' not found.';
                    else {
                        var text = (msg.name ? msg.name + ': ' : '') + (typeof msg.mes === 'string' ? msg.mes : (msg.content || ''));
                        if (args.entities && args.entities.length > 0) {
                            var entitySet = {};
                            args.entities.forEach(function(e) { entitySet[e.toLowerCase()] = true; });
                            var sentences = text.split(/(?<=[。！？.!?\n])/);
                            text = sentences.filter(function(s) {
                                return args.entities.some(function(e) { return s.toLowerCase().indexOf(e.toLowerCase()) !== -1; });
                            }).join('').trim() || text.substring(0, 300) + '... [filtered]';
                        }
                        result = '[→' + msgId + ']\n' + text;
                    }
                }

                // stm_12 or ltm_3 → memory entry
                else if (ref.indexOf('stm_') === 0 || ref.indexOf('ltm_') === 0) {
                    refType = ref.indexOf('ltm_') === 0 ? 'ltm' : 'stm';
                    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
                    var allLTM = content.ltm_entries || [];
                    var allEntries = (refType === 'ltm' ? allLTM : allSTM);
                    var entry = allEntries.find(function(e) { return e.id === ref; });
                    if (!entry) result = 'Entry ' + ref + ' not found.';
                    else {
                        var lines = [];
                        lines.push('=== ' + ref + ' ===');
                        if (entry.time_range || entry.period) lines.push('Period: ' + (entry.time_range || entry.period));
                        if (entry.scene) lines.push('Scene: ' + entry.scene);
                        if (entry.event) lines.push('Event: ' + entry.event);
                        if (entry.entities && entry.entities.length > 0) {
                            var prefixMap = {character:'@', item:'$', faction:'&', concept:'#', location:'~', event:'!'};
                            lines.push('Entities: ' + entry.entities.map(function(e) { return (prefixMap[e.type] || '?') + e.name; }).join(', '));
                        }
                        if (refType === 'ltm' && entry.stm_refs && entry.stm_refs.length > 0) {
                            lines.push('Children: ' + entry.stm_refs.map(function(id) { return '→stm_' + id; }).join(', '));
                        }
                        if (entry.msg_ids && entry.msg_ids.length > 0) {
                            lines.push('Children: ' + entry.msg_ids.map(function(id) { return '→' + id; }).join(', '));
                        }
                        result = lines.join('\n');
                    }
                }

                // chain.X → narrative chain
                else if (ref.indexOf('chain.') === 0) {
                    refType = 'chain';
                    var entityName = ref.replace('chain.', '');
                    var allSTM2 = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
                    var chainEntries = allSTM2.filter(function(e) {
                        return e.entities && e.entities.some(function(en) { return en.name === entityName; });
                    });
                    if (chainEntries.length === 0) result = 'No narrative chain found for: ' + entityName;
                    else {
                        chainEntries.sort(function(a, b) { return new Date(a.timestamp || 0) - new Date(b.timestamp || 0); });
                        var chainLines = ['=== Chain: ' + entityName + ' (' + chainEntries.length + ' events) ==='];
                        chainEntries.forEach(function(e, i) {
                            var label = (e.period || '') + (e.time_label ? '·' + e.time_label : '');
                            var refs = (e.msg_ids || []).map(function(id) { return '→' + id; }).join(', ');
                            chainLines.push((i + 1) + '. ' + (label ? '[' + label + '] ' : '') + (e.event || '') + (refs ? ' [' + refs + ']' : ''));
                        });
                        result = chainLines.join('\n');
                    }
                }

                // characters.X / factions.X / quests.X → State detail
                else {
                    var dotIdx = ref.indexOf('.');
                    if (dotIdx > 0) {
                        var domain = ref.substring(0, dotIdx);
                        var name = ref.substring(dotIdx + 1);
                        if (domain === 'characters') { refType = 'character'; result = lookupCharacter(state, name); }
                        else if (domain === 'factions') { refType = 'faction'; result = lookupFaction(state, name); }
                        else if (domain === 'quests') { refType = 'quest'; result = lookupQuest(state, name); }
                    }
                    if (!result) result = 'Unknown ref format: ' + ref + '. Use stm_XX, ltm_XX, XX, characters.Name, factions.Name, quests.Name, or chain.Name.';
                }

                recordTelemetry({
                    access_ref: ref,
                    access_ref_type: refType,
                    access_result_length: result.length,
                    access_success: result.indexOf('not found') === -1 && result.indexOf('Unknown ref') === -1,
                    access_latency_ms: Date.now() - t0
                }, chatId);
                addToolCall('access', { ref: ref }, result.indexOf('not found') === -1 && result.indexOf('Unknown ref') === -1, Date.now() - t0, result, undefined, chatId);
                recordChatStat(chatId, 'tool', 1);
                return result;
            } catch (e) {
                recordTelemetry({
                    access_ref: ref,
                    access_ref_type: refType,
                    access_result_length: 0,
                    access_success: false,
                    access_latency_ms: Date.now() - t0,
                    access_error: e.message
                }, chatId);
                addToolCall('access', { ref: ref }, false, Date.now() - t0, '', e.message, chatId);
                recordChatStat(chatId, 'tool', 1);
                return 'Error: ' + e.message;
            }
        }
    });
}

var lastRecallMsgIds = null;
var lastRecallHeaders = null;
var lastRecallChatId = null;
var lastRecallVaultVersion = null;

function formatBM25Fallback(candidates, content) {
    var lang = (content && content.language === 'en') ? 'en' : 'zh';
    var header = (lang === 'en')
        ? '## BM25 Results (LLM unavailable)\n'
        : '## BM25 结果（LLM 不可用）\n';
    var lines = candidates.slice(0, 10).map(function(e, i) {
        var time = e.period || e.time_range || '';
        var label = time;
        if (e.time_label) label = label + '·' + e.time_label;
        return (i + 1) + '. [' + label + '] ' + (e.scene || '') + ': ' + (e.event || e.summary || '');
    });
    return header + lines.join('\n');
}

// ── Cross-language helpers ──

function hasCJK(text) {
    return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

function vaultHasMixedLanguage(content) {
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    var allLTM = content.ltm_entries || [];
    var all = allSTM.concat(allLTM);
    var hasCN = false, hasEN = false;
    for (var i = 0; i < all.length; i++) {
        var text = (all[i].event || '') + ' ' + (all[i].scene || '') + ' ' + (all[i].translation || '');
        if (hasCJK(text)) hasCN = true;
        if (/[a-zA-Z]{3,}/.test(text)) hasEN = true;
        if (hasCN && hasEN) return true;
    }
    return false;
}

function registerRecallMemory(getChatId) {
    ToolManager.registerFunctionTool({
        name: 'recall_memory',
        displayName: 'Recall Memory',
        description: 'Use for open-ended memory discovery when you do not know exactly what to look up. NOT for retrieving known references — use access for those (e.g., a specific stm_id, msg#id, or chain.X that you already know about). Avoid calling recall_memory multiple times per response unless following up on new discoveries.\n\nSearch all stored memories (LTM + STM) for information relevant to a query. Returns synthesized narrative answer with source references. For best results, structure your query to include: (1) what specific entity/event/person you want to know about, (2) what aspect — location, history, owner, properties, timeline, (3) any time constraints. You can query multiple independent topics in one call by separating them with ";;". Example: "Dragonfang sword: current location, origin;; House Frost: current attitude toward me;; Ember: last known location and status". Each topic will be answered in a separate section. Use ;; only when asking about genuinely unrelated entities — if questions share the same entity, combine them into one.',
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Structured natural language query. Include entity name + aspects of interest + time constraints if any.' },
                timeOnly: { type: 'boolean', description: 'Optional. If true, skip BM25 search and return complete timeline filtered by time constraint.' }
            },
            required: ['query']
        }),
        action: async function (args) {
            var startTime = Date.now();
            var chatId = getChatId ? getChatId() : 'default';
            var topCandidates;
            var allSTM, allLTM;
            var timeConstraint;
            var isSummaryMode = false;
            try {
                if (!args || !args.query) return 'Error: Missing query';

                var vault = await read(chatId);
                var content = vault.content || {};
                allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
                allLTM = content.ltm_entries || [];

                if (allSTM.length === 0 && allLTM.length === 0) {
                    return 'No memories stored yet.';
                }

                // ── Time-aware retrieval ──
                var allEntries = allSTM.concat(allLTM);
                timeConstraint = parseTimeConstraint(args.query);
                isSummaryMode = false;

                if (timeConstraint) {
                    var preFiltered = applyTimeFilter(allEntries, timeConstraint);
                    if (args.timeOnly || isTimeOnlyQuery(args.query, timeConstraint) || preFiltered.length <= 15) {
                        // Time-only mode: skip BM25, return complete timeline
                        isSummaryMode = true;
                        topCandidates = preFiltered.sort(function(a, b) {
                            return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
                        }).slice(0, 30);
                    } else {
                        // Time-filtered BM25 on narrowed pool
                        var stmPreFiltered = preFiltered.filter(function(e) { return e.id && e.id.indexOf('stm_') === 0; });
                        var ltmPreFiltered = preFiltered.filter(function(e) { return e.id && e.id.indexOf('ltm_') === 0; });
                        topCandidates = filterCandidates(args.query, stmPreFiltered, ltmPreFiltered, 40);
                    }
                } else {
                    topCandidates = filterCandidates(args.query, allSTM, allLTM, 40);
                }

                if (!isSummaryMode && (!topCandidates || topCandidates.length === 0)) {
                    return 'No relevant memories found for: ' + args.query;
                }

                // ── 跨语言翻译增强 ──
                if (!isSummaryMode && topCandidates && topCandidates.length < 5 && vaultHasMixedLanguage(content)) {
                    try {
                        var targetLang = hasCJK(args.query) ? 'English' : 'Chinese';
                        var translateMsg = targetLang === 'Chinese'
                            ? [{ role: 'system', content: 'Translate the following query to Chinese. Output only the translation, no explanation. Preserve proper nouns.' },
                               { role: 'user', content: args.query }]
                            : [{ role: 'system', content: '将以下查询翻译为英文。仅输出译文，不要解释。专有名词保留原名。' },
                               { role: 'user', content: args.query }];
                        var translated = await callMemoryLLM(translateMsg, { timeout: 5, temperature: 0.0 });
                        if (translated) {
                            var translatedTopCandidates = filterCandidates(translated, allSTM, allLTM, 40);
                            if (translatedTopCandidates && translatedTopCandidates.length > 0) {
                                // Interleave: alternate between original and translated results, dedup
                                var seenIds = {};
                                topCandidates.forEach(function(c) { seenIds[c.__id] = true; });
                                var merged = topCandidates.slice();
                                translatedTopCandidates.forEach(function(c) {
                                    if (!seenIds[c.__id] && merged.length < 40) {
                                        merged.push(c);
                                        seenIds[c.__id] = true;
                                    }
                                });
                                topCandidates = merged;
                            }
                        }
                    } catch (tlErr) {
                        // Translation failed — continue with original results
                    }
                }

                // Clear dedup cache on new chat or new vault version
                var vaultChanged = (lastRecallVaultVersion !== vault.version);
                if (chatId !== lastRecallChatId || vaultChanged) {
                    lastRecallMsgIds = null;
                    lastRecallHeaders = null;
                    lastRecallChatId = chatId;
                    lastRecallVaultVersion = vault.version;
                }

                // msg_id fingerprint dedup: annotate candidates already covered
                if (lastRecallMsgIds && lastRecallMsgIds.length > 0) {
                    var usedSet = {};
                    lastRecallMsgIds.forEach(function(id) { usedSet[id] = true; });
                    topCandidates.forEach(function(c) {
                        var entryMsgIds = c.msg_ids || [];
                        var alreadyUsed = entryMsgIds.filter(function(id) { return usedSet[id]; });
                        if (alreadyUsed.length > 0) {
                            c._already_covered = alreadyUsed;
                        }
                    });
                }

                var messages = buildRetrievalMessages(args.query, topCandidates, vault, 800, isSummaryMode);

                if (lastRecallMsgIds && lastRecallMsgIds.length > 0) {
                    var dedupNote = '\n\n[DEDUP: Some candidates draw from source messages already used in a previous recall this turn.]\n';
                    var hasDedup = false;
                    topCandidates.forEach(function(c, i) {
                        if (c._already_covered) {
                            dedupNote += '  Candidate #' + (i+1) + ' uses →' + c._already_covered.join(',→') + ' (already covered). Only include if the query asks for deeper detail.\n';
                            hasDedup = true;
                        }
                    });
                    if (!hasDedup && lastRecallHeaders && lastRecallHeaders.length > 0) {
                        // Fallback: header-level dedup
                        dedupNote += '  (No per-candidate msg_id overlaps detected. However, previous recall covered: ' + lastRecallHeaders.join(', ') + '. Do not repeat these topics unless the query explicitly asks for more.)\n';
                    }
                    messages[0].content += dedupNote;
                }

                var result = await callMemoryRetrieval(messages, { timeout: 3, temperature: 0.3 });
                var answer = result || 'No answer synthesized.';

                // Cache msg_ids from answer for next dedup
                var msgIdMatch = answer.match(/→(\d+)/g);
                if (msgIdMatch) {
                    lastRecallMsgIds = msgIdMatch.map(function(m) { return m.replace('→', ''); });
                }
                // Cache section headers for fallback dedup
                var headerMatch = answer.match(/##\s+(.+?)(?:\n|$)/g);
                if (headerMatch) {
                    lastRecallHeaders = headerMatch.map(function(h) { return h.replace(/^##\s+/, '').trim(); });
                }

                recordTelemetry({
                    recall_query: args.query,
                    recall_result_length: answer.length,
                    recall_method: result ? 'llm' : 'error',
                    recall_candidate_count: isSummaryMode ? topCandidates.length : (topCandidates ? topCandidates.length : 0),
                    recall_time_filter: !!timeConstraint,
                    recall_cross_lang: (topCandidates && allSTM && allLTM) ? (topCandidates.length < 5 && vaultHasMixedLanguage(content)) : false,
                    recall_total_entries: (allSTM ? allSTM.length : 0) + (allLTM ? allLTM.length : 0)
                }, chatId);

                addToolCall('recall_memory', { query: args.query, timeOnly: args.timeOnly || false }, !!result, Date.now() - startTime, (answer || '').substring(0, 200), undefined, chatId);
                recordChatStat(chatId, 'tool', 1);

                return answer;
            } catch (e) {
                recordTelemetry({
                    recall_query: args.query,
                    recall_result_length: 0,
                    recall_method: 'error',
                    recall_candidate_count: topCandidates ? topCandidates.length : 0,
                    recall_time_filter: !!timeConstraint,
                    recall_total_entries: (allSTM ? allSTM.length : 0) + (allLTM ? allLTM.length : 0)
                }, chatId);
                addToolCall('recall_memory', { query: args.query, timeOnly: args.timeOnly || false }, false, Date.now() - startTime, '', e.message, chatId);
                recordChatStat(chatId, 'tool', 1);
                // Fallback to BM25 raw list
                return formatBM25Fallback(topCandidates || [], vault.content);
            }
        }
    });
}

function lookupCharacter(state, name) {
    const characters = state.characters || {};
    const card = characters[name];
    if (!card || typeof card !== 'object') {
        return 'Character "' + name + '" not found. Available: ' + Object.keys(characters).join(', ');
    }

    var lines = [];
    lines.push('=== ' + name + ' ===');
    lines.push('');

    var npcNames = state.npc_names;
    var isNPC = npcNames && Array.isArray(npcNames) && npcNames.indexOf(name) !== -1;

    var coreFields = ['name', 'gender_age', 'occupation', 'clothing_build', 'personality', 'status'];
    coreFields.forEach(function (key) {
        if (card[key] !== undefined && card[key] !== null && card[key] !== '') {
            lines.push(key + ': ' + String(card[key]));
        }
    });

    if (isNPC) {
        if (card.inner_thoughts) lines.push('inner_thoughts: ' + String(card.inner_thoughts));
        if (card.affection !== undefined && card.affection !== null) lines.push('affection: ' + card.affection + '/100');
        if (card.relationship) lines.push('relationship: ' + String(card.relationship));
        if (card.current_mood) lines.push('current_mood: ' + String(card.current_mood));
        if (card.past_experience) lines.push('past_experience: ' + String(card.past_experience));
    }

    if (card.injuries) lines.push('injuries: ' + String(card.injuries));
    if (card.status_effects) lines.push('status_effects: ' + String(card.status_effects));
    if (card.clothing_mode !== undefined) lines.push('clothing_mode: ' + (card.clothing_mode ? 'detailed' : 'simple'));

    var inv = card.inventory;
    var invMode = card.inventory_mode || '关闭';
    if (invMode !== '关闭' && inv && typeof inv === 'object') {
        var invLines = [];
        if (inv.gold !== undefined && inv.gold !== null) invLines.push('Gold: ' + inv.gold + 'G');
        var items = inv.items || [];
        if (items.length > 0) {
            var itemDescs = items.map(function (item) {
                var desc = (item.name || '?') + (item.qty && item.qty > 1 ? ' x' + item.qty : '');
                if (item.equipped) desc += ' [Equipped]';
                if (item.desc) desc += ' - ' + item.desc;
                return desc;
            });
            invLines.push('Items: ' + itemDescs.join('; '));
        }
        if (invLines.length > 0) {
            lines.push('inventory_mode: ' + invMode);
            lines.push('inventory: ' + invLines.join(' | '));
        }
    }

    return lines.join('\n');
}

function lookupFaction(state, name) {
    const factions = state.factions || {};
    const faction = factions[name];
    if (!faction || typeof faction !== 'object') {
        return 'Faction "' + name + '" not found. Available: ' + Object.keys(factions).join(', ');
    }

    var lines = [];
    lines.push('=== ' + name + ' ===');
    lines.push('');

    if (faction.name) lines.push('name: ' + String(faction.name));
    if (faction.description) lines.push('description: ' + String(faction.description));
    if (faction.leader) lines.push('leader: ' + String(faction.leader));
    if (faction.attitude_toward_player) lines.push('attitude_toward_player: ' + String(faction.attitude_toward_player));
    if (faction.notes) lines.push('notes: ' + String(faction.notes));

    var relations = faction.relations;
    if (relations && typeof relations === 'object') {
        var relKeys = Object.keys(relations);
        if (relKeys.length > 0) {
            lines.push('');
            lines.push('--- Relations ---');
            relKeys.forEach(function (target) {
                lines.push(target + ': ' + String(relations[target]));
            });
        }
    }

    return lines.join('\n');
}

function lookupQuest(state, name) {
    const quests = state.quests;
    if (!quests || typeof quests !== 'object') {
        return 'No quests found in state.';
    }

    var found = null;
    var foundType = null;

    if (quests.tasks && typeof quests.tasks === 'object') {
        Object.keys(quests.tasks).forEach(function (key) {
            var t = quests.tasks[key];
            if (t && (t.name === name || key === name)) { found = t; foundType = 'task'; }
        });
    }
    if (!found && quests.goals && typeof quests.goals === 'object') {
        Object.keys(quests.goals).forEach(function (key) {
            var g = quests.goals[key];
            if (g && (g.name === name || key === name)) { found = g; foundType = 'goal'; }
        });
    }
    if (!found && quests.events && typeof quests.events === 'object') {
        Object.keys(quests.events).forEach(function (key) {
            var e = quests.events[key];
            if (e && (e.name === name || key === name)) { found = e; foundType = 'event'; }
        });
    }

    if (!found) {
        var allNames = [];
        ['tasks', 'goals', 'events'].forEach(function (section) {
            if (quests[section] && typeof quests[section] === 'object') {
                Object.keys(quests[section]).forEach(function (k) {
                    var item = quests[section][k];
                    allNames.push(item && item.name ? item.name : k);
                });
            }
        });
        return 'Quest "' + name + '" not found. Available: ' + (allNames.length > 0 ? allNames.join(', ') : '(none)');
    }

    var lines = [];
    var typeLabels = { task: '=== Task ===', goal: '=== Goal ===', event: '=== World Event ===' };
    lines.push(typeLabels[foundType] || '=== Quest ===');
    lines.push('');

    if (foundType === 'task') {
        if (found.name) lines.push('name: ' + String(found.name));
        if (found.deadline) lines.push('deadline: ' + String(found.deadline));
        if (found.status) lines.push('status: ' + String(found.status));
        if (found.type) lines.push('type: ' + String(found.type));
        if (found.issuer) lines.push('issuer: ' + String(found.issuer));
        if (found.desc) lines.push('desc: ' + String(found.desc));
        if (found.progress) lines.push('progress: ' + String(found.progress));
        if (found.posted_time) lines.push('posted_time: ' + String(found.posted_time));
        if (found.reward) lines.push('reward: ' + String(found.reward));
        if (found.penalty) lines.push('penalty: ' + String(found.penalty));
    } else if (foundType === 'goal') {
        if (found.name) lines.push('name: ' + String(found.name));
        if (found.status) lines.push('status: ' + String(found.status));
        if (found.desc) lines.push('desc: ' + String(found.desc));
        if (found.progress) lines.push('progress: ' + String(found.progress));
        if (found.posted_time) lines.push('posted_time: ' + String(found.posted_time));
        if (found.completed_time) lines.push('completed_time: ' + String(found.completed_time));
    } else if (foundType === 'event') {
        if (found.name) lines.push('name: ' + String(found.name));
        if (found.status) lines.push('status: ' + String(found.status));
        if (found.desc) lines.push('desc: ' + String(found.desc));
        if (found.started_time) lines.push('started_time: ' + String(found.started_time));
        if (found.ended_time) lines.push('ended_time: ' + String(found.ended_time));
    }

    return lines.join('\n');
}
