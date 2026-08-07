/**
 * buildMsgId — 从 SillyTavern 消息对象生成全局稳定 ID
 *
 * 格式: "{idx}_{send_date}_{role}"  (role 固定为 'user' 或 'assistant')
 * 示例: "3_2026-07-09T06:55:00.000Z_user"  /  "4_2026-07-09T06:56:00.000Z_assistant"
 *
 * idx 前缀支持 O(1) 反问 + O(n) 漂移兜底。
 * 不传 idx 时默认为 "?" 作为降级标记。
 *
 * @param {object} m - SillyTavern 消息对象
 * @param {number|string} [idx] - 消息在 chat 数组中的下标
 * @returns {string} 全局稳定 ID
 */
export function buildMsgId(m, idx) {
    var send_date;
    try {
        if (m.send_date) {
            send_date = String(m.send_date);
        } else if (m.created_date) {
            send_date = String(m.created_date);
        } else if (m.id && typeof m.id === 'string' && m.id.indexOf('_') !== -1) {
            var legacyId = String(m.id);
            var prefix = (idx != null) ? String(idx) : '?';
            return prefix + '_' + legacyId;
        }
    } catch (e) {}

    if (!send_date) {
        if (typeof m.id === 'number' || (typeof m.id === 'string' && /^\d+$/.test(m.id))) {
            send_date = '0000-00-00T00:00:00.000Z_' + m.id;
        } else {
            send_date = '0000-00-00T00:00:00.000Z';
        }
    }

    var role;
    try {
        role = (m.is_user || m.role === 'user') ? 'user' : 'assistant';
    } catch (e) {
        role = 'assistant';
    }

    var prefix = (idx != null) ? String(idx) : '?';
    return prefix + '_' + send_date + '_' + role;
}

/**
 * findMessageInChat — 通过稳定 ID 在 chat 中定位消息
 *
 * 策略：
 * 0. 裸数字（"95"/"msg#95" → 95）→ O(1) 数组下标反问 + id 校验（ST mes.id 通常为自增数字）
 * 1. 解析 idx 前缀 → O(1) 反问 chatMessages[idx]
 * 2. 验证 send_date 匹配 → 命中即返回
 * 3. 不匹配则 O(n) 漂移兜底（消息被删除/重排后 idx 漂移）
 * 4. 最终 fallback：按 send_date+role 全量遍历
 *
 * @param {object[]} chatMessages - SillyTavern 聊天消息数组
 * @param {string|number} msgId - buildMsgId() 产出的稳定 ID，或裸数字（消息 id/数组下标）
 * @returns {object|null} 找到的消息对象，或 null
 */
export function findMessageInChat(chatMessages, msgId) {
    if (!chatMessages || !chatMessages.length || msgId == null || msgId === '') return null;
    var idStr = String(msgId);

    // 裸数字 → O(1) 数组下标反问（idx 前缀语义），身份不符则回退全量扫描
    if (/^\d+$/.test(idStr)) {
        var idxNum = parseInt(idStr, 10);
        if (idxNum >= 0 && idxNum < chatMessages.length) {
            var direct = chatMessages[idxNum];
            if (direct && _bareIdxMatches(direct, idxNum)) return direct;
        }
        return _findByFullScan(chatMessages, idStr);
    }

    var parts = idStr.split('_');
    if (parts.length < 3) {
        return _findByFullScan(chatMessages, idStr);
    }

    var idxStr = parts[0];
    var idxNum = parseInt(idxStr, 10);

    if (!isNaN(idxNum) && idxNum >= 0 && idxNum < chatMessages.length) {
        var m = chatMessages[idxNum];
        if (m) {
            var candidate = buildMsgId(m, idxNum);
            if (candidate === idStr) return m;
        }
    }

    return _findByFullScan(chatMessages, idStr);
}

/**
 * 裸数字身份校验：m.id 与数字一致（ST mes.id 通常为自增数字）；
 * 无 id（ST 新建消息尚未分配 id）时按数组位置即身份。
 */
function _bareIdxMatches(m, idxNum) {
    if (m.id != null) return String(m.id) === String(idxNum);
    return true;
}

function _findByFullScan(chatMessages, idStr) {
    var sendDateEnd = idStr.lastIndexOf('_');
    if (sendDateEnd === -1) return _legacyScan(chatMessages, idStr);

    var rolePart = idStr.slice(sendDateEnd + 1);
    var dateRoleEnd = idStr.lastIndexOf('_', sendDateEnd - 1);
    var sendDatePart = dateRoleEnd > 0 ? idStr.slice(dateRoleEnd + 1, sendDateEnd) : idStr;

    for (var i = 0; i < chatMessages.length; i++) {
        var m = chatMessages[i];
        if (!m) continue;
        try {
            var sd = m.send_date ? String(m.send_date) : m.created_date ? String(m.created_date) : null;
            if (!sd) continue;
            var r = (m.is_user || m.role === 'user') ? 'user' : 'assistant';
            if (sd === sendDatePart && r === rolePart) return m;
        } catch (e) {}
    }

    return _legacyScan(chatMessages, idStr);
}

function _legacyScan(chatMessages, idStr) {
    // P1-5: 数字 id 退化格式（"3_0000-00-00T00:00:00.000Z_5_user"）在消息漂移后
    // 无法按 send_date 匹配，原 fallback 直接断链 → msg 引用永久丢失。改为提取
    // 尾段数字 id（退化日期段的 m.id）按消息 id 匹配。
    var degradedMatch = /_0000-00-00T00:00:00\.000Z_(\d+)(?:_|$)/.exec(idStr);
    var numericId = degradedMatch ? degradedMatch[1] : null;
    for (var j = 0; j < chatMessages.length; j++) {
        var m2 = chatMessages[j];
        if (!m2) continue;
        try {
            if (numericId != null && String(m2.id == null ? j : m2.id) === numericId) return m2;
            var legacy = String(m2.id == null ? j : m2.id);
            if (legacy === idStr) return m2;
        } catch (e) {}
    }
    return null;
}

/**
 * lookupMessageByDate — 通过 send_date 精确定位消息
 *
 * @param {object[]} chatMessages
 * @param {string} sendDate
 * @returns {{message: object, index: number}|null}
 */
export function lookupMessageByDate(chatMessages, sendDate) {
    if (!chatMessages || !chatMessages.length || !sendDate) return null;
    for (var i = 0; i < chatMessages.length; i++) {
        var m = chatMessages[i];
        if (!m) continue;
        try {
            if (m.send_date === sendDate) return { message: m, index: i };
        } catch (e) {}
        try {
            if (m.created_date === sendDate) return { message: m, index: i };
        } catch (e) {}
    }
    return null;
}

/**
 * collectAllMsgIds — 从消息列表中收集所有 msg_id
 *
 * 这是管道适配的基础：为当前的消息批次生成统一的 id 列表，用于 STM 提取时
 * 填充 stm_entries.msg_ids。
 *
 * @param {object[]} messages
 * @returns {string[]} 稳定 ID 列表
 */
export function collectAllMsgIds(messages) {
    return (messages || []).map(function(m, i) { return buildMsgId(m, i); });
}

/**
 * ensureNeMsgId — 兼容性包装（旧 API）
 *
 * @deprecated 使用 buildMsgId 替代
 * @param {object} m
 * @returns {string}
 */
export function ensureNeMsgId(m) {
    return buildMsgId(m);
}
