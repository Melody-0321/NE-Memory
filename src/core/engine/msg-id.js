export function ensureNeMsgId(message) {
    if (!message || typeof message !== 'object') return null;
    if (message.__ne_msg_id) return message.__ne_msg_id;
    try {
        var uuid = crypto.randomUUID();
        Object.defineProperty(message, '__ne_msg_id', {
            value: uuid,
            enumerable: false,
            writable: false,
            configurable: false
        });
        return uuid;
    } catch (e) {
        console.warn('[NE] ensureNeMsgId failed:', e.message);
        return null;
    }
}

export function getNeMsgId(message) {
    if (!message || typeof message !== 'object') return null;
    return message.__ne_msg_id || null;
}

export function findMessageInChat(chatMessages, identifier) {
    if (!chatMessages || !Array.isArray(chatMessages)) return null;
    var idx = Number(identifier);
    if (idx >= 0 && idx < chatMessages.length && chatMessages[idx]) {
        return chatMessages[idx];
    }
    for (var i = 0; i < chatMessages.length; i++) {
        var m = chatMessages[i];
        if (m && m.__ne_msg_id === identifier) return m;
    }
    return null;
}
