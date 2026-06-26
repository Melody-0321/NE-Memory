import { sortStmByMsgOrder } from '../vault/store.js';

export function computeWindowStartMsgId(chatMessages, contextWindowRounds) {
    if (!chatMessages || chatMessages.length === 0) return 0;

    var rounds = 0;
    var prevRole = null;
    var firstMsgId = 0;

    for (var i = chatMessages.length - 1; i >= 0; i--) {
        var m = chatMessages[i];
        if (!m || m.is_system) continue;
        var role = (m.role === 'user' || m.is_user) ? 'user' : 'assistant';

        if (prevRole === 'user' && role === 'assistant') {
            rounds++;
            if (rounds >= contextWindowRounds) {
                firstMsgId = m.mes_id || 0;
                break;
            }
        }
        prevRole = role;
    }

    return firstMsgId;
}

function filterPreWindowEntries(vault, chatMessages, contextWindowRounds) {
    var content = vault && vault.content ? vault.content : {};
    var ltm = content.ltm_entries || [];
    var allStm = [].concat(content.unconsolidated_stm || []).concat(content.stm_entries || []);
    allStm = sortStmByMsgOrder(allStm);

    var windowStartMsgId = computeWindowStartMsgId(chatMessages, contextWindowRounds);

    if (windowStartMsgId <= 0) {
        return { stm: [], ltm: ltm };
    }

    var preWindowStm = allStm.filter(function(entry) {
        var refMsgIds = entry.msg_ids || [];
        var latestRef = 0;
        for (var j = 0; j < refMsgIds.length; j++) {
            var mid = Number(refMsgIds[j]);
            if (mid > latestRef) latestRef = mid;
        }
        if (latestRef > 0) return latestRef < windowStartMsgId;
        var absStart = entry.absMsgStart || 0;
        return absStart > 0 && absStart < windowStartMsgId;
    });

    return { stm: preWindowStm, ltm: ltm };
}

export function formatContextMemory(vault, chatMessages, contextWindowRounds) {
    if (!chatMessages || chatMessages.length === 0) return '';
    if (!vault || !vault.content) return '';

    var filtered = filterPreWindowEntries(vault, chatMessages, contextWindowRounds);
    if (filtered.ltm.length === 0 && filtered.stm.length === 0) return '';

    var lines = [];
    lines.push('## 历史记忆摘要');
    lines.push('');

    if (filtered.ltm.length > 0) {
        lines.push('以下为更早对话中已整合的关键记忆：');
        lines.push('');
        filtered.ltm.forEach(function(e) {
            var timePart = (e.time_range || e.period || '');
            lines.push('- [' + timePart + '] ' + (e.scene || '') + ': ' + (e.title || e.event || e.summary || ''));
        });
        lines.push('');
    }

    if (filtered.stm.length > 0) {
        lines.push('以下为更早对话中的事件片段：');
        lines.push('');
        var MAX = 20;
        var shown = 0;
        filtered.stm.forEach(function(e) {
            if (shown >= MAX) return;
            var timePart = (e.time_range || e.period || '');
            var text = (e.event || e.summary || '');
            if (text) {
                lines.push('- [' + timePart + '] ' + (e.scene || '') + ': ' + text);
                shown++;
            }
        });
        lines.push('');
    }

    return lines.join('\n');
}
