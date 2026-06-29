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
