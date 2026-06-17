/**
 * engine/consolidate.js — STM→LTM 流式整合引擎
 *
 * STM 提取与 LTM 归类在同一次 LLM 调用中完成。
 * LTM 分 open/closed 状态，单次最多一个 open LTM，
 * 渐进式追加 STM 直到弧自然终结或达到硬上限。
 */

const MAX_OPEN_STM_REFS = 15;

import { sortStmByMsgOrder } from '../vault/store.js';

function findNextId(vault) {
    const content = vault.content || {};
    let max = 0;
    (content.ltm_entries || []).forEach(e => {
        const num = parseInt(String(e.id || '').replace('ltm_', ''), 10);
        if (num > max) max = num;
    });
    return 'ltm_' + (max + 1);
}

function getMaxUnconsolidated() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            return Number(s.stmMaxUnconsolidated) || 5;
        }
    } catch (e) {}
    return 5;
}

export function isLtmEnabled(vault) {
    const content = vault.content || {};
    const unconsolidated = (content.unconsolidated_stm || []).filter(function(s) { return !s.parent_ltm; });
    return unconsolidated.length >= getMaxUnconsolidated();
}

export function computeClosureSignals(openLtm, newStmEvents) {
    if (!openLtm) return null;

    var openEntities = (openLtm.entities || []).map(function(e) { return e.name; });
    var newEntityNames = [];
    (newStmEvents || []).forEach(function(ev) {
        (ev.entities || []).forEach(function(e) {
            if (newEntityNames.indexOf(e.name) === -1) newEntityNames.push(e.name);
        });
    });

    var overlap = 0;
    var shared = [];
    openEntities.forEach(function(name) {
        if (newEntityNames.indexOf(name) !== -1) { overlap++; shared.push(name); }
    });
    var totalUnique = openEntities.length + newEntityNames.length - overlap;

    var openPeriod = openLtm.period || '';
    var lastStmPeriod = '';
    if (newStmEvents && newStmEvents.length > 0) {
        lastStmPeriod = newStmEvents[newStmEvents.length - 1].period || '';
    }

    var timeGap = '同日';
    if (openPeriod && lastStmPeriod) {
        var openDay = openPeriod.split('-').slice(0, 3).join('-');
        var newDay = lastStmPeriod.split('-').slice(0, 3).join('-');
        if (openDay !== newDay) timeGap = '跨日';
        else timeGap = '同日';
    }

    var openScene = openLtm.scene || (openLtm.entities && openLtm.entities.length > 0 ? openLtm.entities[0].scene : '') || '';
    var newScene = (newStmEvents && newStmEvents.length > 0) ? (newStmEvents[0].scene || '') : '';
    var sceneChange = openScene && newScene && openScene !== newScene;

    var entityOverlap = totalUnique > 0 ? overlap / totalUnique : 0;

    var entityDetail = '';
    if (shared.length > 0) {
        entityDetail = shared.slice(0, 3).join('、') + ' 仍在场';
    }
    if (overlap === 0) {
        entityDetail = '所有核心角色已离场';
        if (newEntityNames.length > 0) {
            entityDetail += '；新角色 ' + newEntityNames.slice(0, 3).join('、') + ' 登场';
        }
    }

    var signalSummary = '';
    if (timeGap === '跨日' && sceneChange && overlap === 0) {
        signalSummary = '时间跨日、场景切换且核心角色全面离场——这是一个明确的新叙事弧的开始。';
    } else if (timeGap === '跨日') {
        signalSummary = '时间跨日——可能是同一弧的新阶段，也可能是新弧开始。请根据事件内容的连续性判断。';
    } else if (sceneChange && overlap === 0) {
        signalSummary = '场景切换且角色全部不同——倾向于新弧。';
    } else if (overlap > 0) {
        signalSummary = '核心角色仍在场——事件具有叙事连续性，倾向于延续当前弧。';
    }
    if (!signalSummary) signalSummary = '基于以上信号判断叙事弧归属。';

    return { timeGap, sceneChange, entityOverlap, entityDetail, signalSummary, openScene, newScene };
}

export function formatLtmCatalog(ltmEntries) {
    var closedLtms = (ltmEntries || []).filter(function(e) { return e.status !== 'open'; });
    var recent = closedLtms.slice(-5);
    if (recent.length === 0) return '(无)';
    return recent.map(function(e) {
        return '- [' + (e.title || e.event || '').substring(0, 50) + '] ' + (e.period || '');
    }).join('\n');
}

export function getLtmSummary(vault) {
    var content = vault.content || {};
    var ltms = content.ltm_entries || [];
    var openLtms = ltms.filter(function(e) { return e.status === 'open'; });
    var closedLtms = ltms.filter(function(e) { return e.status !== 'open'; });
    return {
        total: ltms.length,
        open: openLtms.length,
        closed: closedLtms.length,
        openStmRefs: openLtms.length > 0 ? (openLtms[0].stm_refs || []).length : 0,
        openTitle: openLtms.length > 0 ? (openLtms[0].title || '') : ''
    };
}

export function findOpenLtm(vault) {
    var content = vault.content || {};
    var openLtms = (content.ltm_entries || []).filter(function(e) { return e.status === 'open'; });
    if (openLtms.length > 1) {
        console.warn('[NE] Multiple open LTMs detected, closing all');
        openLtms.forEach(function(e) { e.status = 'closed'; });
        return null;
    }
    return openLtms.length === 1 ? openLtms[0] : null;
}

export function applyLtmDecision(vault, ltmDecision, consumedStmIds) {
    if (!ltmDecision) return;

    var content = vault.content || {};
    var action = ltmDecision.action;
    var updatedTitle = ltmDecision.updated_title || '';
    var updatedEvent = ltmDecision.updated_event || '';

    var openLtm = findOpenLtm(vault);

    if (action === 'close_and_new') {
        if (openLtm) openLtm.status = 'closed';
        openLtm = null;
        updatedTitle = '';
        updatedEvent = '';
        action = 'append';
    }

    if (action === 'skip') return;

    if (action === 'append') {
        if (!openLtm) {
            openLtm = {
                id: findNextId(vault),
                status: 'open',
                stm_refs: [],
                title: updatedTitle || 'New Arc',
                event: updatedEvent || '',
                period: '',
                entities: [],
                timestamp: Date.now()
            };
            content.ltm_entries = content.ltm_entries || [];
            content.ltm_entries.push(openLtm);
        }

        openLtm.stm_refs = (openLtm.stm_refs || []).concat(consumedStmIds);
        var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
        var stmSortMap = {};
        allSTM.forEach(function(s) { stmSortMap[s.id] = s; });
        openLtm.stm_refs = sortStmByMsgOrder(
            openLtm.stm_refs.map(function(id) { return stmSortMap[id]; }).filter(Boolean)
        ).map(function(s) { return s.id; });
        if (updatedTitle) openLtm.title = updatedTitle;
        if (updatedEvent) openLtm.event = updatedEvent;
        var sourceSTM = allSTM.filter(function(s) {
            return consumedStmIds.indexOf(s.id) !== -1;
        });
        openLtm.time_range = deriveTimeRange(
            allSTM.filter(function(s) { return (openLtm.stm_refs || []).indexOf(s.id) !== -1; })
        );

        var maxTs = 0;
        sourceSTM.forEach(function(s) { if (s.timestamp && s.timestamp > maxTs) maxTs = s.timestamp; });
        openLtm.timestamp = maxTs || Date.now();

        var ltmEntities = sourceSTM.reduce(function(acc, s) {
            (s.entities || []).forEach(function(e) {
                if (!acc.find(function(a) { return a.name === e.name; })) {
                    acc.push({ name: e.name, type: e.type || 'character' });
                }
            });
            return acc;
        }, (openLtm.entities || []));
        openLtm.entities = ltmEntities;

        consumedStmIds.forEach(function(stmId) {
            if (vault.stm_index && vault.stm_index[stmId]) {
                vault.stm_index[stmId].ltm_id = openLtm.id;
            }
            var found = allSTM.find(function(s) { return s.id === stmId; });
            if (found) found.parent_ltm = openLtm.id;
        });

        if ((openLtm.stm_refs || []).length >= MAX_OPEN_STM_REFS) {
            openLtm.status = 'closed';
        }
    }

    var unconsolidated = content.unconsolidated_stm || [];
    var moved = unconsolidated.filter(function(s) { return consumedStmIds.indexOf(s.id) !== -1 && s.parent_ltm; });
    if (moved.length > 0) {
        content.stm_entries = (content.stm_entries || []).concat(moved);
        content.unconsolidated_stm = unconsolidated.filter(function(s) {
            return consumedStmIds.indexOf(s.id) === -1 || !s.parent_ltm;
        });
    }

    globalThis.__ne_debug_last_ltm_state = getLtmSummary(vault);
}

export async function runLtmRebatch(vault, callMemoryPipeline) {
    var content = vault.content || {};
    var orphans = (content.unconsolidated_stm || []).filter(function(s) { return !s.parent_ltm; });
    if (orphans.length === 0) return { consumed: 0 };

    var stmIds = orphans.map(function(s) { return s.id; });

    var prompt;
    try { prompt = buildConsolidatePrompt(vault, stmIds); } catch (e) {
        console.warn('[NE] LTM rebatch: build prompt failed', e); return { consumed: 0 };
    }

    var response;
    try {
        response = await callMemoryPipeline([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ], { operation: 'ltm_rebatch' });
    } catch (e) {
        console.warn('[NE] LTM rebatch: LLM call failed', e); return { consumed: 0 };
    }

    var parsed = parseConsolidateResponse(response);
    if (!parsed || !parsed.ltm_entries || parsed.ltm_entries.length === 0) {
        console.log('[NE] LTM rebatch: no LTM entries from LLM, ' + orphans.length + ' STMs left orphaned');
        return { consumed: 0 };
    }

    var ltmEntries = normalizeConsolidation(parsed.ltm_entries, stmIds);
    return applyConsolidation(vault, ltmEntries, stmIds);
}

function buildConsolidatePrompt(vault, stmIds) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';
    var stmMap = {};
    var allUnc = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    allUnc.forEach(function(e) { stmMap[e.id] = e; });

    var stmSet = stmIds.slice();
    stmSet.sort(function(a, b) {
        var sa = stmMap[a], sb = stmMap[b];
        return ((sa && sa.absMsgStart) || Infinity) - ((sb && sb.absMsgStart) || Infinity);
    });

    var stmLines = stmSet.map(function(sid, i) {
        var e = stmMap[sid];
        if (!e) return '';
        var label = e.period ? e.period + (e.time_label ? '\u00b7' + e.time_label : '') : '';
        return (i + 1) + '. [' + sid + '] ' + (e.event || '').substring(0, 200) + '\n   period=' + (e.period || '-') + '  scene=' + (e.scene || '-');
    }).filter(Boolean);

    var existingLtms = (content.ltm_entries || []).map(function(ltm) {
        return '- [' + (ltm.title || ltm.event || '').substring(0, 50) + '] stm_refs=[' + (ltm.stm_refs || []).join(',') + ']';
    });

    var system = lang === 'en' ?
        'You are a memory consolidator. Group STM entries into LTM arcs based on narrative continuity.\n\n' +
        'Existing LTM arcs (do NOT assign STMs to these — they are already consumed):\n' + (existingLtms.length > 0 ? existingLtms.join('\n') : '(none)') + '\n\n' +
        'Output ONLY a JSON object:\n{\n  "ltm_entries": [\n    {\n      "stm_refs": ["stm_3", "stm_5", "stm_7"],\n      "title": "arc label (15-40 chars)",\n      "event": "complete arc summary (80-140 chars)"\n    }\n  ]\n}\n\n' +
        'Rules:\n- Use ONLY the provided STMs. Do not use IDs already in existing LTM stm_refs.\n- Group STMs that belong to the same narrative arc. No 1-ref LTMs.\n- Use character full names only. No pronouns (he/she/they/him/her).\n- If no grouping possible, return {"ltm_entries":[]}' :
        '你是记忆整合器。将 STM 条目分组为 LTM 叙事弧。\n\n' +
        '现有 LTM 弧（不要向这些分配 STM — 它们已消费）：\n' + (existingLtms.length > 0 ? existingLtms.join('\n') : '(无)') + '\n\n' +
        '仅输出 JSON 对象：\n{\n  "ltm_entries": [\n    {\n      "stm_refs": ["stm_3", "stm_5", "stm_7"],\n      "title": "弧标签（15-40字）",\n      "event": "完整弧摘要（80-140字）"\n    }\n  ]\n}\n\n' +
        '规则：\n- 仅使用提供的 STM。不要使用已存在于现有 LTM stm_refs 中的 ID。\n- 将属于同一叙事弧的 STM 分组。禁止 1-ref LTM。\n- 使用角色全名，禁止代词。\n- 若无法分组，返回 {"ltm_entries":[]}';

    var user = '待整合的 STM 条目：\n\n' + stmLines.join('\n\n');
    return { system: system, user: user };
}

function parseConsolidateResponse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) {}
    var jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1].trim()); } catch (e2) {}
    }
    var bracketMatch = text.match(/\{[\s\S]*\}/);
    if (bracketMatch) {
        try { return JSON.parse(bracketMatch[0]); } catch (e3) {}
    }

    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    var entries = [];
    var current;
    lines.forEach(function(line) {
        var stmRefsMatch = line.match(/stm_refs\s*[:=]\s*\[([^\]]+)\]/);
        if (stmRefsMatch) {
            if (current && current.stm_refs && current.stm_refs.length) entries.push(current);
            current = { stm_refs: [], title: '', event: '' };
            var refs = stmRefsMatch[1].split(',').map(function(r) {
                var t = r.trim().replace(/["'\[\]]/g, '');
                return t.indexOf('stm_') === 0 ? t : 'stm_' + t;
            });
            current.stm_refs = refs;
            return;
        }
        if (!current) return;
        var titleMatch = line.match(/(?:title|标题)\s*[:=]\s*["']?([^"'\n]+)/);
        if (titleMatch) { current.title = titleMatch[1].trim(); return; }
        var eventMatch = line.match(/(?:event|事件|summary|摘要)\s*[:=]\s*["']?([^"'\n]+)/);
        if (eventMatch) { current.event = eventMatch[1].trim(); return; }
    });
    if (current && current.stm_refs && current.stm_refs.length) entries.push(current);
    if (entries.length > 0) return { ltm_entries: entries };

    return null;
}

function normalizeConsolidation(ltmEntries, allStmIds) {
    if (!ltmEntries || !ltmEntries.length) return [];

    var assigned = new Set();
    ltmEntries.forEach(function(e) { (e.stm_refs || []).forEach(function(id) { assigned.add(id); }); });

    ltmEntries = ltmEntries.filter(function(e) { return (e.stm_refs || []).length > 0; });

    ltmEntries.sort(function(a, b) {
        var aPos = allStmIds.indexOf((a.stm_refs || [])[0]);
        var bPos = allStmIds.indexOf((b.stm_refs || [])[0]);
        return (aPos === -1 ? Infinity : aPos) - (bPos === -1 ? Infinity : bPos);
    });

    var unassigned = allStmIds.filter(function(id) { return !assigned.has(id); });
    if (unassigned.length > 0 && ltmEntries.length > 0) {
        unassigned.forEach(function(sid) {
            var pos = allStmIds.indexOf(sid);
            if (pos === -1) return;
            var best = null, bestDist = Infinity;
            ltmEntries.forEach(function(e) {
                (e.stm_refs || []).forEach(function(rid) {
                    var rpos = allStmIds.indexOf(rid);
                    if (rpos !== -1 && Math.abs(pos - rpos) < bestDist) {
                        bestDist = Math.abs(pos - rpos);
                        best = e;
                    }
                });
            });
            if (best && bestDist < 5) {
                best.stm_refs = best.stm_refs || [];
                best.stm_refs.push(sid);
                assigned.add(sid);
            }
        });
    }

    return ltmEntries;
}

function applyConsolidation(vault, ltmEntries, stmIds) {
    var content = vault.content || {};
    var consumed = 0;

    var seenSTM = {};
    ltmEntries.forEach(function(e) {
        e.stm_refs = (e.stm_refs || []).filter(function(sid) {
            if (seenSTM[sid]) return false;
            seenSTM[sid] = true;
            return stmIds.indexOf(sid) !== -1;
        });
    });
    ltmEntries = ltmEntries.filter(function(e) { return (e.stm_refs || []).length > 0; });

    if (ltmEntries.length === 0) return { consumed: 0 };

    var maxConsume = Math.ceil(stmIds.length * 0.85);
    var counted = 0;
    var guarded = [];
    for (var i = 0; i < ltmEntries.length; i++) {
        var refs = ltmEntries[i].stm_refs || [];
        if (counted + refs.length > maxConsume && i > 0) {
            for (var k = i; k < ltmEntries.length; k++) guarded.push(ltmEntries[k]);
            ltmEntries = ltmEntries.slice(0, i);
            break;
        }
        counted += refs.length;
    }

    ltmEntries.forEach(function(entry) {
        var refs = entry.stm_refs.map(function(sid) {
            return sid.indexOf('stm_') === 0 ? sid : 'stm_' + sid;
        });

        var ltm = {
            id: findNextId(vault),
            status: 'closed',
            stm_refs: refs,
            title: (entry.title || '').substring(0, 60),
            event: (entry.event || '').substring(0, 200),
            period: '',
            entities: [],
            timestamp: Date.now()
        };

        refs.forEach(function(stmId) {
            vault.stm_index = vault.stm_index || {};
            if (vault.stm_index[stmId]) vault.stm_index[stmId].ltm_id = ltm.id;
            var uncIdx = (content.unconsolidated_stm || []).findIndex(function(s) { return s.id === stmId; });
            if (uncIdx !== -1) {
                var stm = content.unconsolidated_stm[uncIdx];
                stm.parent_ltm = ltm.id;
                content.stm_entries = content.stm_entries || [];
                content.stm_entries.push(stm);
                content.unconsolidated_stm.splice(uncIdx, 1);
                consumed++;
            }
        });

        var sourceStm = content.stm_entries.filter(function(s) { return refs.indexOf(s.id) !== -1; });
        ltm.time_range = deriveTimeRange(sourceStm);
        var entities = [];
        sourceStm.forEach(function(s) {
            (s.entities || []).forEach(function(e) {
                if (!entities.find(function(a) { return a.name === e.name; })) entities.push({ name: e.name, type: e.type || 'character' });
            });
        });
        ltm.entities = entities;

        content.ltm_entries = content.ltm_entries || [];
        content.ltm_entries.push(ltm);
        console.log('[NE] LTM rebatch: created LTM "' + ltm.title + '" with ' + refs.length + ' STMs');
    });

    return { consumed: consumed };
}

function deriveTimeRange(sourceSTMEntries) {
    var timed = sourceSTMEntries.filter(function(s) {
        return (s.period || s.time_label);
    });

    if (timed.length === 0) return null;

    var first = timed[0];
    var last = timed[timed.length - 1];

    var fmt = function(s) {
        var parts = [];
        if (s.period) parts.push(s.period);
        if (s.time_label) parts.push(s.time_label);
        return parts.join('·');
    };

    if (timed.length === 1) return fmt(first);

    if (first.period === last.period) {
        if (first.time_label || last.time_label) {
            return first.period + ': ' + (first.time_label || '?') + ' → ' + (last.time_label || '?');
        }
        return first.period;
    }
    return fmt(first) + ' → ' + fmt(last);
}
