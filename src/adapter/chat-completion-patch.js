/**
 * chat-completion-patch.js — Monkey-patch ChatCompletion.prototype
 * 让对话轮数滑块在 dryRun（token 显示）路径也生效
 */

var _nePatched = false;

export async function applyChatCompletionPatch() {
    if (_nePatched) return true;
    try {
        var mod = await import('/scripts/openai.js');
        var ChatCompletion = mod.ChatCompletion;
        if (!ChatCompletion || !ChatCompletion.prototype) return false;

        var origCanAfford = ChatCompletion.prototype.canAfford;
        var origInsertAtStart = ChatCompletion.prototype.insertAtStart;

        ChatCompletion.prototype.canAfford = function(message) {
            // 仅对 chatHistory 消息检查轮数限制标志
            if (this._neRoundLimitReached && message.identifier &&
                typeof message.identifier === 'string' &&
                message.identifier.indexOf('chatHistory-') === 0) {
                return false;  // 触发 populateChatHistory 的 break
            }
            return origCanAfford.call(this, message);
        };

        ChatCompletion.prototype.insertAtStart = function(message, identifier) {
            if (identifier === 'chatHistory') {
                // 已达上限，静默跳过
                if (this._neRoundLimitReached) return;

                // 读取滑块值
                var maxRounds = 10;
                try {
                    var raw = localStorage.getItem('ne_settings');
                    if (raw) {
                        var s = JSON.parse(raw);
                        maxRounds = Number(s.dialogWindowRounds) || 10;
                    }
                } catch (e) {}

                // 计数 user→assistant 配对（一轮）
                var role = message.role || 'assistant';
                if (this._nePrevRole === 'user' && role === 'assistant') {
                    this._neRoundCount = (this._neRoundCount || 0) + 1;
                }
                this._nePrevRole = role;

                // 达到上限：设标志，不插入此消息
                if (this._neRoundCount >= maxRounds) {
                    this._neRoundLimitReached = true;
                    return;
                }
            }
            return origInsertAtStart.call(this, message, identifier);
        };

        _nePatched = true;
        console.log('[NE] ChatCompletion prototype patched for dialog window rounds');
        return true;
    } catch (e) {
        console.warn('[NE] Failed to patch ChatCompletion:', e.message);
        return false;
    }
}
