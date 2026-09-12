/**
 * state-toggle.js — State 抽取开关（总开关 + 会话级开关）
 *
 * 背景：State 管线是 NE 唯一「每轮必花」的固定 LLM 调用
 * （events.js 触发门：pendingMessages.length >= 2，稳态 ≈0.83 次/轮），
 * 且当前版本没有任何关闭入口。本模块提供两层开关：
 *   - 全局：ne_settings.stateExtractionEnabled（默认 true）
 *   - 会话级：chatMetadata.ne_state_extract（true / false / 缺省=继承全局）
 * 解析优先级：会话级显式值 > 全局 > 默认 true。
 *
 * 注意：本开关**不是** isStateSchemaEnabled()。后者是 Schema 系统内核总闸，
 * 同时门控抽取/注入/落库/衰减共 7 处调用点；本开关只门控「是否发起 LLM 抽取」
 * 与「state 通道注入」，与 Schema 系统解耦，因此关掉它不会影响数据一致性。
 */
import { readNeSettingsCached } from '../core/settings.js';

// 重开刷新标记（内存级，chatId 键控防跨会话误伤；不持久化）
var _refreshPendingChatId = null;

function _getCtx() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            return SillyTavern.getContext();
        }
    } catch (e) {}
    try {
        if (typeof window !== 'undefined' && window.parent && window.parent.SillyTavern && window.parent.SillyTavern.getContext) {
            return window.parent.SillyTavern.getContext();
        }
    } catch (e) {}
    return null;
}

/**
 * 读会话级覆盖值。
 * @returns {boolean|undefined} 显式 true/false；未设置返回 undefined
 */
export function getChatStateExtractOverride() {
    var ctx = _getCtx();
    if (!ctx || !ctx.chatMetadata) return undefined;
    var v = ctx.chatMetadata.ne_state_extract;
    if (v === true || v === false) return v;
    return undefined;
}

/**
 * 写会话级覆盖值。
 * @param {boolean|undefined} val true/false 写入；undefined 清除（回归继承全局）
 * @returns {boolean} 是否写入成功（无聊天上下文时返回 false）
 */
export function setChatStateExtractOverride(val) {
    var ctx = _getCtx();
    if (!ctx || !ctx.chatMetadata) return false;
    if (val === true || val === false) ctx.chatMetadata.ne_state_extract = val;
    else delete ctx.chatMetadata.ne_state_extract;
    try {
        if (typeof ctx.saveChatDebounced === 'function') ctx.saveChatDebounced();
        else if (typeof ctx.saveChat === 'function') ctx.saveChat();
    } catch (e) {}
    return true;
}

/**
 * 解析当前会话是否启用 State 抽取与注入。
 * @returns {boolean}
 */
export function isStateExtractionEnabled() {
    var override = getChatStateExtractOverride();
    if (override !== undefined) return override;
    return readNeSettingsCached().stateExtractionEnabled !== false;
}

/**
 * 标记「该会话刚被重新打开，注入的 state 仍是关闭前的旧值」。
 * 抽取完成后由 events.js 清除。
 */
export function markStateRefreshPending(chatId) {
    _refreshPendingChatId = chatId || null;
}

/** @param {string} chatId @returns {boolean} */
export function isStateRefreshPending(chatId) {
    return !!chatId && _refreshPendingChatId === chatId;
}

/** @param {string} chatId */
export function clearStateRefreshPending(chatId) {
    if (_refreshPendingChatId === chatId) _refreshPendingChatId = null;
}
