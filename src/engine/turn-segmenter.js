/**
 * engine/turn-segmenter.js — 对话轮次分割器
 *
 * 以 assistant 消息为中心，user 消息可选配对。
 * 输出 turns[] 供语义切分和 STM 提取使用。
 */

export function groupMessagesIntoTurns(messages) {
    var turns = [];
    var pendingUser = null;

    for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        var isUser = m.role === 'user' || m.is_user;

        if (isUser) {
            if (pendingUser !== null) {
                turns.push({ user: pendingUser, assistant: null, msgStart: pendingUser._idx, msgEnd: i - 1 });
            }
            pendingUser = m;
            pendingUser._idx = i;
        } else {
            turns.push({
                user: pendingUser,
                assistant: m,
                msgStart: pendingUser ? pendingUser._idx : i,
                msgEnd: i
            });
            pendingUser = null;
        }
    }

    if (pendingUser !== null) {
        turns.push({ user: pendingUser, assistant: null, msgStart: pendingUser._idx, msgEnd: messages.length - 1 });
    }

    return turns;
}

/**
 * 将 turns 格式化为 LLM prompt 可读文本
 */
export function formatTurnsText(turns, turnIndices) {
    var indices = turnIndices;
    if (!indices) {
        indices = [];
        for (var i = 0; i < turns.length; i++) indices.push(i);
    }

    var lines = [];
    for (var ti = 0; ti < indices.length; ti++) {
        var t = turns[indices[ti]];
        if (!t) continue;
        lines.push('[Turn ' + indices[ti] + ']');
        if (t.user) {
            var userName = t.user.name ? t.user.name + ': ' : '';
            lines.push('  user: ' + userName + (t.user.content || t.user.mes || ''));
        }
        if (t.assistant) {
            var asstName = t.assistant.name ? t.assistant.name + ': ' : '';
            lines.push('  assistant: ' + asstName + (t.assistant.content || t.assistant.mes || ''));
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * 从 turn 范围提取 msg_ids
 */
export function collectMsgIdsFromTurns(turns, turnIndices) {
    var ids = [];
    var seen = {};
    var indices = turnIndices;
    if (!indices) {
        indices = [];
        for (var i = 0; i < turns.length; i++) indices.push(i);
    }

    for (var ti = 0; ti < indices.length; ti++) {
        var t = turns[indices[ti]];
        if (!t) continue;
        if (t.user) {
            var uid = String(t.user.id || t.user.mes_id || ('msg_user_' + indices[ti]));
            if (uid && !seen[uid]) { seen[uid] = true; ids.push(uid); }
        }
        if (t.assistant) {
            var aid = String(t.assistant.id || t.assistant.mes_id || ('msg_asst_' + indices[ti]));
            if (aid && !seen[aid]) { seen[aid] = true; ids.push(aid); }
        }
    }

    return ids;
}

/**
 * 获取原始 messages 中从 msgStart 到 msgEnd 的最小/最大全局索引
 */
export function getTurnMsgRange(turn) {
    return [turn.msgStart, turn.msgEnd];
}
