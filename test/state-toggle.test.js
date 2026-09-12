/**
 * state-toggle 测试 — State 抽取开关（总开关 + 会话级）
 *
 * 覆盖：解析优先级（会话级 > 全局 > 默认 true）、会话级读写、
 *       重开刷新标记的 chatId 隔离。
 */
import {
    getChatStateExtractOverride,
    setChatStateExtractOverride,
    isStateExtractionEnabled,
    markStateRefreshPending,
    isStateRefreshPending,
    clearStateRefreshPending
} from '../src/adapter/state-toggle.js';
import { invalidateNeSettingsCache } from '../src/core/settings.js';

// ── 浏览器桩：localStorage + SillyTavern.getContext() ──
var _ls = {};
globalThis.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
    setItem: function (k, v) { _ls[k] = String(v); },
    removeItem: function (k) { delete _ls[k]; }
};

var _chatMeta = {};
var _saveCalls = 0;
globalThis.SillyTavern = {
    getContext: function () {
        return {
            chatMetadata: _chatMeta,
            saveChat: function () { _saveCalls++; return Promise.resolve(); }
        };
    }
};

var passed = 0, failed = 0;
function eq(actual, expected, msg) {
    if (actual === expected) { passed++; console.log('  ok - ' + msg); }
    else {
        failed++;
        console.error('  FAIL - ' + msg + '\n    expected: ' + JSON.stringify(expected) + '\n    actual:   ' + JSON.stringify(actual));
    }
}

function setGlobalSettings(obj) {
    if (obj === null) delete _ls['ne_settings'];
    else _ls['ne_settings'] = JSON.stringify(obj);
    invalidateNeSettingsCache();
}

function resetChatOverride() {
    delete _chatMeta.ne_state_extract;
}

console.log('=== state-toggle: 解析优先级 ===');

// 1. 无任何设置 → 默认 true
setGlobalSettings(null);
resetChatOverride();
eq(getChatStateExtractOverride(), undefined, 'no override -> undefined');
eq(isStateExtractionEnabled(), true, 'no override + no global -> default true');

// 2. 全局关（无会话级）→ false
setGlobalSettings({ stateExtractionEnabled: false });
eq(isStateExtractionEnabled(), false, 'global false -> false');

// 3. 全局显式开 + 无会话级 → true
setGlobalSettings({ stateExtractionEnabled: true });
eq(isStateExtractionEnabled(), true, 'global true -> true');

// 4. 全局键存在但非 false（容错：undefined/null 视为开）
setGlobalSettings({ stateExtractionEnabled: undefined });
eq(isStateExtractionEnabled(), true, 'global undefined -> true (default)');

// 5. 会话级 true 覆盖全局 false
setGlobalSettings({ stateExtractionEnabled: false });
_chatMeta.ne_state_extract = true;
eq(getChatStateExtractOverride(), true, 'override true readable');
eq(isStateExtractionEnabled(), true, 'override true beats global false');

// 6. 会话级 false 覆盖全局 true
setGlobalSettings({ stateExtractionEnabled: true });
_chatMeta.ne_state_extract = false;
eq(isStateExtractionEnabled(), false, 'override false beats global true');

// 7. 会话级为垃圾值 → 视为未设置，回落全局
setGlobalSettings({ stateExtractionEnabled: false });
_chatMeta.ne_state_extract = 'yes';
eq(getChatStateExtractOverride(), undefined, 'non-boolean override ignored');
eq(isStateExtractionEnabled(), false, 'garbage override falls back to global');

console.log('=== state-toggle: 会话级读写 ===');

// 8. 写 true
resetChatOverride();
var okWrite = setChatStateExtractOverride(true);
eq(okWrite, true, 'setChatStateExtractOverride returns true');
eq(_chatMeta.ne_state_extract, true, 'override persisted to chatMetadata');
eq(_saveCalls > 0, true, 'saveChat called on write');

// 9. 写 false
setChatStateExtractOverride(false);
eq(_chatMeta.ne_state_extract, false, 'override false persisted');

// 10. 写 undefined → 清除键，回归继承全局
setGlobalSettings({ stateExtractionEnabled: false });
setChatStateExtractOverride(undefined);
eq('ne_state_extract' in _chatMeta, false, 'undefined clears overrides key');
eq(isStateExtractionEnabled(), false, 'after clear -> inherit global false');

console.log('=== state-toggle: 重开刷新标记 ===');

// 11. 标记与清除
markStateRefreshPending('chat-a');
eq(isStateRefreshPending('chat-a'), true, 'pending for marked chat');
eq(isStateRefreshPending('chat-b'), false, 'not pending for other chat');
eq(isStateRefreshPending(''), false, 'empty chatId never pending');
eq(isStateRefreshPending(null), false, 'null chatId never pending');

// 12. 清除其它会话不影响当前标记
clearStateRefreshPending('chat-b');
eq(isStateRefreshPending('chat-a'), true, 'clearing other chat keeps mark');

// 13. 清除本会话
clearStateRefreshPending('chat-a');
eq(isStateRefreshPending('chat-a'), false, 'mark cleared');

// 14. 重新标记覆盖旧值（同一时刻只服务当前会话）
markStateRefreshPending('chat-a');
markStateRefreshPending('chat-c');
eq(isStateRefreshPending('chat-a'), false, 're-mark replaces previous chat');
eq(isStateRefreshPending('chat-c'), true, 'latest mark active');

console.log('\n=== state-toggle: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
