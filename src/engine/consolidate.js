/**
 * engine/consolidate.js — STM→LTM 流式整合引擎
 *
 * STM 提取与 LTM 归类在同一次 LLM 调用中完成。
 * LTM 分 open/closed 状态，单次最多一个 open LTM，
 * 渐进式追加 STM 直到弧自然终结或达到硬上限。
 */

const MAX_OPEN_STM_REFS = 15;

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
        if (updatedTitle) openLtm.title = updatedTitle;
        if (updatedEvent) openLtm.event = updatedEvent;

        var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
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
