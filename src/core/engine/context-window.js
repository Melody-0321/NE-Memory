export function computeWindowStartMsgId(chatMessages, contextWindowRounds) {
    if (!chatMessages || chatMessages.length === 0) return -1;

    var rounds = 0;
    var prevRole = null;

    for (var i = chatMessages.length - 1; i >= 0; i--) {
        var m = chatMessages[i];
        if (!m || m.is_system) continue;
        var role = (m.role === 'user' || m.is_user) ? 'user' : 'assistant';

        if (prevRole === 'user' && role === 'assistant') {
            rounds++;
            if (rounds >= contextWindowRounds) {
                return i;
            }
        }
        prevRole = role;
    }

    return -1;
}
