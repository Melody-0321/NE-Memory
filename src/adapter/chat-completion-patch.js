/**
 * chat-completion-patch.js - Monkey-patch ChatCompletion.prototype
 * 让对话轮数滑块在 dryRun（token 显示）路径也生效
 *
 * ST 的 populateChatHistory 是独立函数（非原型方法），无法直接 hook。
 * 改为 hook setTokenBudget（原型方法，在 populateChatHistory 之前调用）来重置轮数计数标志。
 */

import { readNeSetting } from '../core/settings.js';

var _nePatched = false;

export async function applyChatCompletionPatch() {
    if (_nePatched) return true;
    try {
        // NE-Memory 从 CDN 加载时，import() 的基 URL 是 CDN（脚本自身 URL）。
        // 必须构造 ST 服务器的绝对 URL。
        // window.location.origin 在某些环境下返回 "null"，需要多重 fallback。
        var openaiUrl = null;

        // 方法1: 从 document.scripts 中查找 ST 自身加载的脚本，提取 origin
        var scripts = document.getElementsByTagName('script');
        for (var si = 0; si < scripts.length; si++) {
            var sSrc = scripts[si].src;
            if (sSrc && sSrc.indexOf('jsdelivr') === -1 && sSrc.indexOf('cdn') === -1 && sSrc.indexOf('chrome-extension') === -1) {
                try {
                    var parsed = new URL(sSrc);
                    if (parsed.origin && parsed.origin !== 'null') {
                        openaiUrl = parsed.origin + '/scripts/openai.js';
                        break;
                    }
                } catch (eS) {}
            }
        }

        // 方法2: window.location.origin（标准本地部署通常有效）
        if (!openaiUrl && window.location.origin && window.location.origin !== 'null') {
            openaiUrl = window.location.origin + '/scripts/openai.js';
        }

        // 方法3: protocol + host fallback
        if (!openaiUrl && window.location.protocol && window.location.host) {
            openaiUrl = window.location.protocol + '//' + window.location.host + '/scripts/openai.js';
        }

        console.log('[NE-DEBUG] applyChatCompletionPatch: openaiUrl=' + openaiUrl +
            ' | location.origin=' + window.location.origin +
            ' | location.protocol=' + window.location.protocol +
            ' | location.host=' + window.location.host);
        if (!openaiUrl) {
            console.warn('[NE] Could not determine ST server URL for openai.js import');
            return false;
        }

        var mod = await import(openaiUrl);
        var ChatCompletion = mod.ChatCompletion;
        console.log('[NE-DEBUG] import resolved. ChatCompletion:', typeof ChatCompletion);
        if (!ChatCompletion || !ChatCompletion.prototype) {
            console.warn('[NE] ChatCompletion not found in openai.js module. Keys:', Object.keys(mod).join(','));
            return false;
        }

        var origCanAfford = ChatCompletion.prototype.canAfford;
        var origInsertAtStart = ChatCompletion.prototype.insertAtStart;
        var origSetTokenBudget = ChatCompletion.prototype.setTokenBudget;
        console.log('[NE-DEBUG] prototype methods:', {
            canAfford: typeof origCanAfford,
            insertAtStart: typeof origInsertAtStart,
            setTokenBudget: typeof origSetTokenBudget
        });

        // hook setTokenBudget：每次生成前重置轮数计数标志
        // setTokenBudget 在 prepareOpenAIMessages 中调用，早于 populateChatHistory
        if (origSetTokenBudget) {
            ChatCompletion.prototype.setTokenBudget = function(context, response) {
                this._neRoundLimitReached = false;
                this._neRoundCount = 0;
                this._nePrevRole = null;
                return origSetTokenBudget.call(this, context, response);
            };
        }

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

                // 只处理真正的对话历史消息（identifier 以 'chatHistory-' 开头）
                // 跳过 newMainChat、groupNudge 等非对话消息
                var msgId = message.identifier;
                if (typeof msgId !== 'string' || msgId.indexOf('chatHistory-') !== 0) {
                    return origInsertAtStart.call(this, message, identifier);
                }

                // 读取滑块值
                var maxRounds = Number(readNeSetting('dialogWindowRounds', 10)) || 10;

                // 只对 user/assistant 角色计数，跳过 system(NARRATOR)/tool
                var role = message.role;
                if (role === 'user' || role === 'assistant') {
                    // populateChatHistory 按倒序遍历（最新优先），
                    // 倒序中 user->assistant 过渡标志着跨轮边界
                    if (this._nePrevRole === 'user' && role === 'assistant') {
                        this._neRoundCount = (this._neRoundCount || 0) + 1;
                    }
                    this._nePrevRole = role;
                }

                // 达到上限：设标志，不插入此消息
                if (this._neRoundCount >= maxRounds) {
                    this._neRoundLimitReached = true;
                    console.log('[NE-DEBUG] Round limit reached: count=' + this._neRoundCount + ' max=' + maxRounds + ', skipping ' + msgId);
                    return;
                }
            }
            return origInsertAtStart.call(this, message, identifier);
        };

        _nePatched = true;
        console.log('[NE] ChatCompletion prototype patched for dialog window rounds');
        return true;
    } catch (e) {
        console.warn('[NE] Failed to patch ChatCompletion:', e.message, e.stack);
        return false;
    }
}
