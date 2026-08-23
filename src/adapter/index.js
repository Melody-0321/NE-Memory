/**
 * index.js — NE Memory Engine 入口（ST 适配器壳层）
 *
 * 植入：注入 SillyTavern 实现到 Core runtime，然后启动 Core bootstrap。
 */
import { runtime } from '../core/runtime.js';
import { readVault } from '../core/vault/store.js';
import { scanOrphans, purgeOrphanChatData } from '../core/vault/garbage-collector.js';
import { registerAllTools } from '../core/tools.js';
import { onMessageSent, onMessageReceived, onBeforeGenerate, onMessageDeleted, onMessageSwiped, onMessageUpdated, onChatDeleted, registerGlobalBannerRegex, setContextFns, setGetContextBudgetFn, neSyncChatId, restorePending, waitForPipelineIdle, notifyVaultChanged, adaptContextPostTrim, getLastDialogRoundsAfter } from './events.js';
import { t, setFieldLocale } from '../core/i18n.js';
import { renderVaultPanel } from './panel.js';
import { showToast } from './panel-shared.js';
import { DEFAULT_GLOBAL_SCHEMA, buildCharacterSchemaFromTemplates, DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE, setDynamicStateMode } from '../core/vault/schema.js';
import { setRetrievalEnabled, readNeSetting } from '../core/settings.js';
import { testSecondaryApiConnection, onPipelineLLMCall, offPipelineLLMCall } from '../core/api/llm.js';
import { resetVectorIndex, getVectorIndex } from '../core/engine/retrieval-fusion.js';
import { runTest, runTestByName, listTests, setReportsDir } from './test-runner.js';
import { getTestCaseMetadata } from '../core/test-runner/files.js';
import { getUsageOverview, getDailyStats, getAllChatUsage, getMonthlyBreakdown, getChatBreakdown, getAvailableMonths, getMonthlyStats } from '../core/engine/token-stats.js';
import { getAllChatStats } from '../core/engine/chat-telemetry.js';
import { bootstrapVault as _bootstrapVault, migrateVaultIfNeeded } from './bootstrap.js';
import { neRestoreAll } from '../core/settings-adapter.js';
import { applyChatCompletionPatch } from './chat-completion-patch.js';
import { registerPublicApi } from './public-api.js';
import { initMesButton } from './mes-button.js';
import { on as busOn, off as busOff } from './stateBus.js';

var _retryTimer = null;

function getChatId() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx2 = SillyTavern.getContext();
            if (ctx2.chatId && ctx2.chatId !== 'default') return ctx2.chatId;
            var fp = getChatFingerprint(ctx2);
            if (fp) return fp;
        }
    } catch (e) {}
    return 'default';
}

function getChatFingerprint(ctx) {
    try {
        var chat = ctx.chat || [];
        if (chat.length > 0) {
            var firstId = (chat[0].id != null) ? chat[0].id : (chat[0].mes_id != null ? chat[0].mes_id : '0');
            var fp = 'ne_' + (ctx.characterId || 'x') + '_' + firstId;
            try { localStorage.setItem('ne_chat_fp_' + (ctx.characterId || 'x'), fp); } catch (e) {}
            return fp;
        }
        try {
            var cachedFp = localStorage.getItem('ne_chat_fp_' + (ctx.characterId || 'x'));
            if (cachedFp) return cachedFp;
        } catch (e) {}
        var fallback = 'ne_' + (ctx.characterId || 'x') + '_' + Date.now();
        try { localStorage.setItem('ne_chat_fp_' + (ctx.characterId || 'x'), fallback); } catch (e) {}
        return fallback;
    } catch (e) { return ''; }
}

function getChatMessages() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            return SillyTavern.getContext().chat || [];
        }
    } catch (e) {}
    return [];
}

function getLocale() {
    // ST getCurrentLocale 在部分宿主（酒馆助手 iframe/晚就绪）可能返回 null/空，
    // 若强转 String → 'null'/'undefined' 会让 i18n 整层 fallback 英文。仅接受语言码形态。
    function isLangCode(v) { return typeof v === 'string' && /^[a-z]{2,}(?:-[a-z0-9]{2,})?$/i.test(v); }
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && typeof ctx.getCurrentLocale === 'function') {
                var raw = ctx.getCurrentLocale();
                if (isLangCode(raw)) return String(raw).toLowerCase();
            }
        }
    } catch (e) {}
    try { var stored = localStorage.getItem('language'); if (isLangCode(stored)) return stored; } catch (e) {}
    return 'en';
}

function getContextBudget() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            return SillyTavern.getContext().maxContext || 4096;
        }
    } catch (e) {}
    return 4096;
}

/* ──────── ST Adapter 注入到 Core runtime ──────── */

Object.assign(runtime, {
    getChatId: function() { return getChatId(); },
    getChat: function() { return getChatMessages(); },
    getChatMetadata: function() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                return SillyTavern.getContext().chatMetadata || {};
            }
        } catch (e) {}
        return {};
    },
    saveChat: function() {
        try {
            var ctx = SillyTavern.getContext();
            if (ctx.saveChat) return ctx.saveChat();
        } catch (e) {}
        return Promise.resolve();
    },
    getCharacters: function() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                return SillyTavern.getContext().characters || [];
            }
        } catch (e) {}
        return [];
    },
    getWorldInfo: function() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                return SillyTavern.getContext().worldInfo || { entries: {}, globalSelect: [] };
            }
        } catch (e) {}
        return { entries: {}, globalSelect: [] };
    },
    get maxContext() {
        return getContextBudget();
    },
    getLanguage: function() { return getLocale(); },
    getPowerUserCfg: function() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                return SillyTavern.getContext().powerUserSettings || {};
            }
        } catch (e) {}
        return {};
    },
    generateQuiet: function(prompt, systemPrompt) {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                var qctx = SillyTavern.getContext();
                if (qctx.generateQuietPrompt) {
                    return qctx.generateQuietPrompt({
                        quietPrompt: prompt || '',
                        quietName: systemPrompt || ''
                    });
                }
            }
        } catch (e) {}
        return Promise.resolve('');
    },
    generateRaw: function(opts) {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                var ctx = SillyTavern.getContext();
                if (ctx.generateRaw) {
                    return ctx.generateRaw({
                        prompt: opts && opts.ordered_prompts || (opts && opts.prompt) || ''
                    });
                }
            }
        } catch (e) {}
        return Promise.resolve('');
    },
    on: function(name, fn) {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                var es = SillyTavern.getContext().eventSource;
                if (es && typeof es.on === 'function') { es.on(name, fn); }
            }
        } catch (e) {}
    },
    emit: function(name, data) {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                var es2 = SillyTavern.getContext().eventSource;
                if (es2 && typeof es2.emit === 'function') { es2.emit(name, data); }
            }
        } catch (e) {}
    },
    injectPrompt: function(key, value, position, depth, role) {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                var ctx = SillyTavern.getContext();
                if (ctx && typeof ctx.setExtensionPrompt === 'function') {
                    var posMap = { 'in_chat': 1, 'in_prompt': 0, 'before_prompt': 2 };
                    var roleMap = { 'system': 0, 'user': 1, 'assistant': 2 };
                    ctx.setExtensionPrompt(
                        key, value,
                        posMap[position] || 1,
                        depth !== undefined ? depth : 2,
                        false,
                        roleMap[role] || 0
                    );
                }
            }
        } catch (e) {}
    },
    getParentDoc: function() {
        if (window.__NE_EXTENSION_MODE) return document;
        try {
            if (window.parent && window.parent !== window && window.parent.document) return window.parent.document;
        } catch (e) {}
        return document;
    },
    notify: function(msg, title, opts) {
        try {
            var type = opts && opts.type ? opts.type : 'info';
            showToast(msg, type, (opts && opts.timeOut) || 3000);
        } catch (e) {}
    },
    confirm: function(msg) {
        try { return confirm(msg); } catch (e) { return true; }
    }
});

/* ──────── init — 使用 Core bootstrap ──────── */

export function initNE() {
    return init();
}

function loadSettings() {
    try {
        var raw = localStorage.getItem('ne_settings');
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

async function init() {
    var locale = getLocale();
    var settings = loadSettings();
    neRestoreAll();
    var chatId = getChatId();

    setContextFns(getChatId, getChatMessages);
    setGetContextBudgetFn(getContextBudget);

    // UI-10: 先绑事件再 bootstrap——bootstrap（loadVault + 迁移 + 渲染面板）为耗时操作，
    // 原顺序下初始化期间到达的首轮消息（message_received/sent）无人监听而永久漏记
    setupEventListeners();
    registerToolsWithRetry(getChatId, getChatMessages, 0);
    try { await applyChatCompletionPatch(); } catch (e) { console.warn('[NE] ChatCompletion patch failed:', e.message); }

    await _bootstrapVault(chatId, locale, settings);

    // 注册公开只读 API（window.neMemory + /ne-get slash + {{neState}} 宏）
    try { await registerPublicApi(); } catch (e) { console.warn('[NE] public API registration failed:', e); }

    // 消息栏记忆按钮（AI 消息工具栏 🧠 → 点击打开主面板定位该楼 STM）
    try {
        initMesButton(getChatId);
    } catch (e) { console.warn('[NE] mes button init failed:', e); }
}

function registerToolsWithRetry(getChatId, getChatMessages, retryCount) {
    var tm = typeof ToolManager !== 'undefined' ? ToolManager : null;
    if (tm && typeof tm.registerFunctionTool === 'function') {
        registerAllTools(getChatId, getChatMessages);
        return;
    }
    if (retryCount >= 30) {
        console.error('[NE] Cannot register tools: ToolManager unavailable after 30 retries');
        return;
    }
    var delay = Math.min(500 * Math.pow(2, retryCount), 30000);
    setTimeout(function () { registerToolsWithRetry(getChatId, getChatMessages, retryCount + 1); }, delay);
}

var _bannerRegexRetryTimer = null;

/**
 * 在 CHAT_COMPLETION_PROMPT_READY 事件中裁剪对话轮数。
 * data.chat 是 ST getChat() 输出的扁平数组，每条消息有 role 属性。
 * 从末尾向前计数 user->assistant 配对，删除超出限制的旧消息。
 */
function trimDialogRounds(chat) {
    if (!chat || chat.length === 0) return;
    var maxRounds = Number(readNeSetting('dialogWindowRounds', 10)) || 10;
    if (maxRounds <= 0) return;

    // 自适应模式：用压缩后实际轮数覆盖硬上限
    if (readNeSetting('adaptiveContextControl', false)) {
        var adaptiveRounds = getLastDialogRoundsAfter();
        if (adaptiveRounds > 0 && adaptiveRounds < maxRounds) {
            console.log('[NE] applyDialogWindowIgnore: using adaptive rounds=' + adaptiveRounds + ' (was ceiling=' + maxRounds + ')');
            maxRounds = adaptiveRounds;
        }
    }

    var rounds = 0;
    var prevRole = null;
    var cutoffIndex = -1;

    for (var i = chat.length - 1; i >= 0; i--) {
        var m = chat[i];
        if (!m) continue;
        var role = m.role;
        if (role !== 'user' && role !== 'assistant') continue;

        if (prevRole === 'user' && role === 'assistant') {
            rounds++;
            if (rounds >= maxRounds) {
                cutoffIndex = i;
                break;
            }
        }
        prevRole = role;
    }

    if (cutoffIndex > 0) {
        var removed = cutoffIndex;
        chat.splice(0, cutoffIndex);
        console.log('[NE] trimDialogRounds: removed ' + removed + ' messages (maxRounds=' + maxRounds + ')');
    }
}

/**
 * generate_interceptor: ST 在 Generate() 中调用，在 setOpenAIMessages 之前修改 coreChat。
 * 必须在模块顶层赋值给 globalThis，避免 Rollup ES module tree-shaking。
 * manifest.json 中的 "generate_interceptor": "ne_generation_interceptor" 让 ST 发现此函数。
 */
globalThis.ne_generation_interceptor = function(coreChat, contextSize, abort, type) {
    if (type === 'quiet') return;

    var cwRounds = Number(readNeSetting('dialogWindowRounds', 10)) || 10;
    console.log('[NE] ne_generation_interceptor called: type=' + type + ' coreChat.length=' + (coreChat ? coreChat.length : 'null') + ' maxRounds=' + cwRounds);

    var rounds = 0;
    var prevRole = null;
    var cutoffIndex = -1;

    for (var i = coreChat.length - 1; i >= 0; i--) {
        var m = coreChat[i];
        if (!m || m.is_system) continue;
        var role = (m.role === 'user' || m.is_user) ? 'user' : 'assistant';

        if (prevRole === 'user' && role === 'assistant') {
            rounds++;
            if (rounds >= cwRounds) {
                cutoffIndex = i;
                break;
            }
        }
        prevRole = role;
    }

    if (cutoffIndex > 0) {
        var removed = cutoffIndex + 1;
        coreChat.splice(0, cutoffIndex + 1);
        console.log('[NE] ne_generation_interceptor: removed ' + removed + ' messages, remaining=' + coreChat.length);
    } else {
        console.log('[NE] ne_generation_interceptor: no trim needed (rounds=' + rounds + ' maxRounds=' + cwRounds + ')');
    }
};

var _neIgnoreSymbol = (typeof Symbol !== 'undefined' && Symbol.for) ? Symbol.for('ignore') : null;
var _neIgnoredMsgIndices = [];

function applyDialogWindowIgnore() {
    _neIgnoredMsgIndices = [];
    if (!_neIgnoreSymbol) return;

    var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    var chat = ctx && ctx.chat ? ctx.chat : [];
    if (chat.length === 0) return;

    var maxRounds = Number(readNeSetting('dialogWindowRounds', 10)) || 10;
    if (maxRounds <= 0) return;

    var rounds = 0;
    var prevIsUser = null;
    var cutoffIndex = -1;

    for (var i = chat.length - 1; i >= 0; i--) {
        var m = chat[i];
        if (!m || m.is_system) continue;
        var isUser = m.is_user ? true : false;

        if (prevIsUser === true && isUser === false) {
            rounds++;
            if (rounds >= maxRounds) {
                cutoffIndex = i;
                break;
            }
        }
        prevIsUser = isUser;
    }

    if (cutoffIndex > 0) {
        for (var k = 0; k <= cutoffIndex; k++) {
            var msg = chat[k];
            if (!msg) continue;
            if (!msg.extra) msg.extra = {};
            if (!msg.extra[_neIgnoreSymbol]) {
                msg.extra[_neIgnoreSymbol] = true;
                _neIgnoredMsgIndices.push(k);
            }
        }
        console.log('[NE] applyDialogWindowIgnore: marked ' + _neIgnoredMsgIndices.length + ' messages (maxRounds=' + maxRounds + ')');
    }
}

function clearDialogWindowIgnore() {
    if (_neIgnoredMsgIndices.length === 0) return;
    var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    var chat = ctx && ctx.chat ? ctx.chat : [];
    var cleared = 0;
    for (var i = 0; i < _neIgnoredMsgIndices.length; i++) {
        var idx = _neIgnoredMsgIndices[i];
        var msg = chat[idx];
        if (msg && msg.extra && msg.extra[_neIgnoreSymbol]) {
            delete msg.extra[_neIgnoreSymbol];
            cleared++;
        }
    }
    if (cleared > 0) console.log('[NE] clearDialogWindowIgnore: cleared ' + cleared + ' messages');
    _neIgnoredMsgIndices = [];
}

function _tryRegisterBannerRegex(retryCount) {
    retryCount = retryCount || 0;
    var ok = registerGlobalBannerRegex();
    if (ok) {
        if (_bannerRegexRetryTimer) { clearTimeout(_bannerRegexRetryTimer); _bannerRegexRetryTimer = null; }
        return;
    }
    if (retryCount >= 10) {
        console.error('[NE-BANNER] Banner regex registration failed after 10 retries');
        return;
    }
    var delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
    _bannerRegexRetryTimer = setTimeout(function () { _tryRegisterBannerRegex(retryCount + 1); }, delay);
}

function setupEventListeners(retryCount) {
    retryCount = retryCount || 0;

    var eventSource = null;
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx.eventSource) eventSource = ctx.eventSource;
        }
    } catch (e) {}

    if (eventSource && typeof eventSource.on === 'function') {
        if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
        if (!eventSource.__ne_bound) {
            eventSource.__ne_bound = true;
            try { eventSource.on('message_sent', onMessageSent); } catch (e) { console.warn('[NE] message_sent registration failed:', e); }
            try { eventSource.on('message_received', onMessageReceived); } catch (e) { console.warn('[NE] message_received registration failed:', e); }
            try { eventSource.on('GENERATION_AFTER_COMMANDS', function(type, options, dryRun) { applyDialogWindowIgnore(); }); } catch (e) { console.warn('[NE] GENERATION_AFTER_COMMANDS (ignore) registration failed:', e); }
            try { eventSource.on('GENERATION_AFTER_COMMANDS', onBeforeGenerate); } catch (e) { console.warn('[NE] GENERATION_AFTER_COMMANDS registration failed:', e); }
            try { eventSource.on('generation_ended', function() { clearDialogWindowIgnore(); }); } catch (e) { console.warn('[NE] generation_ended registration failed:', e); }
            try { eventSource.on('chat_completion_prompt_ready', async (data) => {
                try {
                    if (!data || !data.chat) return;
                    trimDialogRounds(data.chat);
                    if (readNeSetting('adaptiveContextControl', false)) {
                        await adaptContextPostTrim(data.chat, data.dryRun);
                    }
                } catch (e) { console.warn('[NE] CHAT_COMPLETION_PROMPT_READY handler failed:', e); }
            }); } catch (e) { console.warn('[NE] CHAT_COMPLETION_PROMPT_READY registration failed:', e); }
            console.log('[NE] All string event listeners registered, onBeforeGenerate=' + typeof onBeforeGenerate);
            try { eventSource.on('chat_id_changed', async () => {
                try {
                    var chatId2 = getChatId();
                    console.log('[NE] chat_id_changed → chatId=' + chatId2);
                    neSyncChatId(chatId2);
                    var settings = loadSettings();
                    setDynamicStateMode(settings && settings.useDynamicState || false);
                    setRetrievalEnabled(settings && settings.retrievalEnabled || false);
                    var vault = await readVault(chatId2);
                    await migrateVaultIfNeeded(chatId2, vault);
                    notifyVaultChanged();
                } catch (e) { console.warn('[NE] chat_id_changed handler error:', e); }
            }); } catch (e) {}
            try { eventSource.on('message_deleted', onMessageDeleted); } catch (e) {}
            try { eventSource.on('message_swiped', onMessageSwiped); } catch (e) {}
            try { eventSource.on('message_updated', onMessageUpdated); } catch (e) {}
            try { eventSource.on('chat_deleted', onChatDeleted); } catch (e) {}
            try { eventSource.on('group_chat_deleted', onChatDeleted); } catch (e) {}
            _tryRegisterBannerRegex(0);
            console.log('[NE] Event listeners registered via eventSource');
        }
        return;
    }

    if (typeof TavernHelper !== 'undefined' && TavernHelper._eventOn && TavernHelper.tavern_events) {
        if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
        var tavern_events = TavernHelper.tavern_events;
        try {
            if (tavern_events.MESSAGE_SENT) TavernHelper._eventOn(tavern_events.MESSAGE_SENT, onMessageSent);
            if (tavern_events.MESSAGE_RECEIVED) TavernHelper._eventOn(tavern_events.MESSAGE_RECEIVED, onMessageReceived);
            if (tavern_events.GENERATION_AFTER_COMMANDS) {
                TavernHelper._eventOn(tavern_events.GENERATION_AFTER_COMMANDS, function(type, options, dryRun) { applyDialogWindowIgnore(); });
                TavernHelper._eventOn(tavern_events.GENERATION_AFTER_COMMANDS, onBeforeGenerate);
            }
            if (tavern_events.GENERATION_ENDED) TavernHelper._eventOn(tavern_events.GENERATION_ENDED, function() { clearDialogWindowIgnore(); });
            if (tavern_events.CHAT_COMPLETION_PROMPT_READY) TavernHelper._eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, async (data) => {
                try {
                    if (!data || !data.chat) return;
                    trimDialogRounds(data.chat);
                    if (readNeSetting('adaptiveContextControl', false)) {
                        await adaptContextPostTrim(data.chat, data.dryRun);
                    }
                } catch (e) { console.warn('[NE] CHAT_COMPLETION_PROMPT_READY handler failed:', e); }
            });
            if (tavern_events.CHAT_CHANGED) {
                TavernHelper._eventOn(tavern_events.CHAT_CHANGED, async () => {
                    var chatId2b = getChatId();
                    console.log('[NE] CHAT_CHANGED (legacy) → chatId=' + chatId2b);
                    neSyncChatId(chatId2b);
                    var settings = loadSettings();
                    setDynamicStateMode(settings && settings.useDynamicState || false);
                    setRetrievalEnabled(settings && settings.retrievalEnabled || false);
                    var vault = await readVault(chatId2b);
                    await migrateVaultIfNeeded(chatId2b, vault);
                    notifyVaultChanged();
                });
            }
            if (tavern_events.MESSAGE_DELETED) TavernHelper._eventOn(tavern_events.MESSAGE_DELETED, onMessageDeleted);
            if (tavern_events.MESSAGE_SWIPED) TavernHelper._eventOn(tavern_events.MESSAGE_SWIPED, onMessageSwiped);
            if (tavern_events.MESSAGE_UPDATED) TavernHelper._eventOn(tavern_events.MESSAGE_UPDATED, onMessageUpdated);
        } catch (e2) {
            console.warn('[NE] TavernHelper event registration failed:', e2);
        }
        console.log('[NE] Event listeners registered via TavernHelper._eventOn');
        return;
    }

    if (retryCount >= 60) {
        console.error('[NE] Cannot register events: no eventSource or TavernHelper._eventOn after 60 retries');
        return;
    }
    if (retryCount === 0) {
        console.log('[NE] No event API available yet, will retry... eventSource=' + (typeof eventSource) + ', TH._eventOn=' + (typeof TavernHelper !== 'undefined' ? typeof TavernHelper._eventOn : 'N/A'));
    }
    var delay = Math.min(500 * Math.pow(2, retryCount), 30000);
    _retryTimer = setTimeout(function () { _retryTimer = null; setupEventListeners(retryCount + 1); }, delay);
}


function bootNE(retries) {
    if (window.__ne_booted) return;
    if (retries > 10) return console.error('[NE] Boot failed after 10 retries: jQuery never loaded');
    if (typeof $ === 'undefined') return setTimeout(function () { bootNE((retries || 0) + 1); }, 300);
    window.__ne_booted = true;
    console.log('[NE] Engine starting... build=' + 'NE v7.2.0');

    try {
        window.__ne_debug = _buildDebugApi();
        console.log('[NE] __ne_debug installed. Methods:', Object.keys(window.__ne_debug).filter(function(k) { return k[0] !== '_' }).join(', '));
    } catch (e) {
        console.error('[NE] __ne_debug install failed:', e);
        window.__ne_debug = {};
    }

    globalThis.__ne_debug_all_pipeline_responses = globalThis.__ne_debug_all_pipeline_responses || '';
    globalThis.__ne_debug_last_smartpush_prompt = globalThis.__ne_debug_last_smartpush_prompt || '';
    globalThis.__ne_llm_hook = {
        onPipelineLLMCall: onPipelineLLMCall,
        offPipelineLLMCall: offPipelineLLMCall
    };
    window.__ne_llm_hook = globalThis.__ne_llm_hook;

    $(async function () {
        try { await init(); } catch (e) { console.error('[NE] Init failed:', e); }
    });
}

function _buildDebugApi() {
    var hostDoc = window.__NE_EXTENSION_MODE ? document : (window.parent && window.parent !== window ? window.parent.document : document);
    var api = {
        getLastInjection: function() { return globalThis.__ne_debug_last_injection || null; },
        getVaultState: async function() {
            try { var v = await readVault(getChatId()); if (!v || !v.content) return null; return JSON.parse(JSON.stringify(v.content.state)); } catch (e) { return null; }
        },
        getVaultSummary: async function() {
            try {
                var v = await readVault(getChatId());
                if (!v || !v.content) return null;
                return { stmCount: (v.content.unconsolidated_stm || []).length + (v.content.stm_entries || []).length, ltmCount: (v.content.ltm_entries || []).length, unconsolidatedCount: (v.content.unconsolidated_stm || []).length };
            } catch (e) { return null; }
        },
        getLastPipelineOutput: function() { return globalThis.__ne_debug_last_pipeline || null; },
        getLastMerge: function() { return globalThis.__ne_debug_last_merge || null; },
        getLastNotebook: function() { return globalThis.__ne_debug_last_notebook || null; },
        getStmEvents: function() { return globalThis.__ne_debug_last_stm_events || null; },
        getConsolidation: function() { return globalThis.__ne_debug_last_consolidation || null; },
        getCursor: function() { return globalThis.__ne_debug_last_cursor || null; },
        getSmartpushPrompt: function() { return globalThis.__ne_debug_last_smartpush_prompt || null; },
        dumpVault: async function() {
            try { var v = await readVault(getChatId()); if (!v || !v.content) return null; return JSON.parse(JSON.stringify(v.content)); } catch (e) { return null; }
        },
        getFactionSummary: function() {
            try {
                var vault = getCurrentVault(getChatId());
                if (!vault || !vault.content || !vault.content.state || !vault.content.state.factions) return null;
                var f = vault.content.state.factions;
                var names = Object.keys(f);
                var hidden = names.filter(function(n) { return f[n]._hidden; });
                var visible = names.filter(function(n) { return !f[n]._hidden; });
                return { total: names.length, hidden: hidden, visible: visible, names: names };
            } catch (e) { return null; }
        },
        _waitUntilReply: function(maxMs) {
            var doc = hostDoc;
            return new Promise(function(resolve) {
                var es = SillyTavern.getContext().eventSource;
                var totalTimer = setTimeout(function() { resolve(); }, maxMs || 120000);
                function pollDone() {
                    if (!doc.body.dataset.generating) { clearTimeout(totalTimer); setTimeout(resolve, 500); return; }
                    setTimeout(pollDone, 150);
                }
                es.once('message_received', function() { pollDone(); });
            });
        },
        _testSeeds: ['你好，我叫阿明，是一名矿工。','北山矿洞最近有些异常，频繁有小规模塌方。','我的朋友老张是铁匠，他今天也来矿洞了。','老张脸色很差，他说昨天在矿洞深处看到了奇怪的光。','我觉得应该向工头报告这个情况。不过工头这几天不在。','老张说他认识一个地质师，也许可以请她来看看。','对了，那个地质师叫什么来着？许瑶，对，许瑶。','许瑶以前在这片矿区工作过，后来调走了。不过她应该还住在本镇。','老张说他会去找许瑶。希望她能帮忙。','矿洞入口处的水位也在上升。这很不正常。'],
        _lastTestReport: null,
        seedAndWait: async function(count) {
            if (this._testSeeds.length === 0) return;
            var doc = hostDoc;
            var msgs = this._testSeeds.slice(0, Math.min(count || 5, this._testSeeds.length));
            for (var i = 0; i < msgs.length; i++) {
                var ta = doc.getElementById('send_textarea');
                if (!ta) return;
                ta.value = msgs[i];
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(function(r) { setTimeout(r, 150); });
                var btn = doc.getElementById('send_but');
                if (btn) btn.click();
                await this._waitUntilReply(60000);
            }
        },
        runQuery: async function(query) {
            if (!query) return;
            var doc = hostDoc;
            var ta = doc.getElementById('send_textarea');
            if (!ta) return;
            ta.value = query;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(function(r) { setTimeout(r, 150); });
            var btn = doc.getElementById('send_but');
            if (btn) btn.click();
            await this._waitUntilReply(120000);
        },
        getLastReport: function() { return globalThis.__ne_debug._lastTestReport; },
        getUsageOverview: function() { return getUsageOverview(getAllChatStats); },
        getDailyStats: function(days) { return getDailyStats(days || 30); },
        getAllChatUsage: function() { return getAllChatUsage(getAllChatStats); },
        getMonthlyBreakdown: function(month) { return getMonthlyBreakdown(month); },
        getChatBreakdown: function(chatId) { return getChatBreakdown(getAllChatStats, chatId); },
        getAvailableMonths: function() { return getAvailableMonths(); },
        getMonthlyStats: function(month) { return getMonthlyStats(month); },
        getCurrentChatId: function() { return getChatId(); },
        waitForPipelineIdle: async function(timeout) { return waitForPipelineIdle(timeout); },
        dumpVaultKeys: async function() {
            try { return await _dumpVaultKeys(); } catch (e) { return 'Error: ' + e.message; }
        },
        findMyVault: async function() {
            try {
                var data = await _dumpVaultKeys();
                var keys = data.vaults || data;
                var currentId = getChatId();
                if (__NE_DEV_MODE) {
                    console.log('[NE-DEBUG] Current chatId:', currentId);
                    console.log('[NE-DEBUG] Vaults:');
                    console.table(keys);
                }
                return { currentChatId: currentId, allKeys: keys };
            } catch (e) { return 'Error: ' + e.message; }
        },
        resetVectorIndex: async function(chatId) { try { return await resetVectorIndex(chatId); } catch (e) { return 'Error: ' + e.message; } },
        getVectorIndex: function(chatId) { try { return getVectorIndex(chatId); } catch (e) { return 'Error: ' + e.message; } },
        gc: async function() { try { return await scanOrphans(); } catch (e) { return 'Error: ' + e.message; } },
        purgeChat: async function(chatId) { try { return await purgeOrphanChatData(chatId); } catch (e) { return 'Error: ' + e.message; } },
    };
    if (__NE_DEV_MODE) {
        api.runTest = async function(config) { try { return await runTest(config, hostDoc); } catch (e) { return { error: e.message }; } };
        api.runTestByName = async function(name, maxRoundsOverride) { try { return await runTestByName(name, hostDoc, maxRoundsOverride); } catch (e) { return { error: e.message }; } };
        api.listTests = function() { return listTests(); };
        api.getTestCaseMetadata = function(name) { return getTestCaseMetadata(name); };
        api.setReportsDir = async function() { try { return await setReportsDir(); } catch (e) { return 'Error: ' + e.message; } };
    }
    return api;
}

function _dumpVaultKeys() {
    return new Promise(function(resolve, reject) {
        var req = indexedDB.open('ne_memory_vault');
        req.onsuccess = function() {
            var db = req.result;
            var vaultTx = db.transaction('vaults', 'readonly');
            var vaultStore = vaultTx.objectStore('vaults');
            var keys = [];
            var vaultDone = false;

            vaultStore.openCursor().onsuccess = function(e) {
                var cursor = e.target.result;
                if (cursor) {
                    var row = cursor.value;
                    var v = row && row.vault;
                    keys.push({
                        key: cursor.key,
                        version: v ? v.version : (row ? '(empty row)' : '(gone)'),
                        stm: v && v.content && Array.isArray(v.content.unconsolidated_stm) ? v.content.unconsolidated_stm.length : 0,
                        ltm: v && v.content && Array.isArray(v.content.ltm_entries) ? v.content.ltm_entries.length : 0
                    });
                    cursor.continue();
                } else {
                    vaultDone = true;
                    finish();
                }
            };
            vaultTx.onerror = function() { db.close(); reject(vaultTx.error); };

            function finish() {
                db.close();
                resolve({ vaults: keys });
            }
        };
        req.onerror = function() { reject(req.error); };
    });
}

if (typeof window !== 'undefined' && typeof __NE_EXTENSION_BUILD__ === 'undefined' && !window.__NE_EXTENSION_MODE) {
    document.addEventListener('DOMContentLoaded', function () { bootNE(); });
    if (document.readyState === 'complete' || document.readyState === 'interactive') { bootNE(); }
}
