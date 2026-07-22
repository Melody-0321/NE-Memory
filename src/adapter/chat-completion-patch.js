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
        // 用变量存储 URL 阻止 Rollup 将绝对路径转为相对路径
        // NE-Memory 从 CDN 加载时，相对路径会解析到 CDN 而非 ST 本地服务器
        var openaiUrl = '/scripts/openai.js';
        console.log('[NE-DEBUG] applyChatCompletionPatch: attempting import(' + openaiUrl + ')');
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
