/**
 * index.js — NE Memory Engine 入口（ST 适配器壳层）
 *
 * 植入：注入 SillyTavern 实现到 Core runtime，然后启动 Core bootstrap。
 */
import { runtime } from '../core/runtime.js';
import { read, write } from '../core/vault/store.js';
import { registerAllTools } from '../core/tools.js';
import { onMessageSent, onMessageReceived, onBeforeGenerate, onMessageDeleted, onMessageSwiped, onMessageUpdated, registerGlobalBannerRegex, setContextFns, setGetContextBudgetFn, neSyncChatId, restorePending, waitForPipelineIdle } from './events.js';
import { t, setFieldLocale } from '../core/i18n.js';
import { renderVaultPanel } from './panel.js';
import { DEFAULT_GLOBAL_SCHEMA, DEFAULT_CHARACTER_SCHEMA, setStateSchemaEnabled, setDynamicStateMode } from '../core/vault/schema.js';
import { loadVault } from '../core/auto-restore.js';
import { setRetrievalEnabled } from '../core/settings.js';
import { testSecondaryApiConnection, onPipelineLLMCall, offPipelineLLMCall } from '../core/api/llm.js';
import { ensureStateWorldBook } from '../core/engine/worldbook-sync.js';
import { runTest, runTestByName, listTests, setReportsDir } from './test-runner.js';
import { getTestCaseMetadata } from '../core/test-runner/files.js';
import { getUsageOverview, getDailyStats, getAllChatUsage } from '../core/engine/token-stats.js';
import { getAllChatStats } from '../core/engine/chat-telemetry.js';
import { bootstrapVault as _bootstrapVault, migrateVaultIfNeeded } from './bootstrap.js';
window.__NE_DEV_MODE = window.__NE_DEV_MODE !== undefined ? window.__NE_DEV_MODE : true;

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
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx.getCurrentLocale) {
                var l = String(ctx.getCurrentLocale()).toLowerCase();
                if (l) return l;
            }
        }
    } catch (e) {}
    try { return localStorage.getItem('language') || 'en'; } catch (e) { return 'en'; }
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
                if (qctx.generateQuietPrompt) return qctx.generateQuietPrompt(prompt, systemPrompt);
            }
        } catch (e) {}
        return Promise.resolve('');
    },
    generateRaw: function(opts) {
        try {
            if (typeof TavernHelper !== 'undefined' && TavernHelper.generateRaw) {
                return TavernHelper.generateRaw(opts);
            }
        } catch (e) {}
        return Promise.resolve('');
    },
    on: function(name, fn) {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                var es = SillyTavern.getContext().eventSource;
                if (es && typeof es.on === 'function') { es.on(name, fn); return; }
            }
        } catch (e) {}
        try {
            if (typeof TavernHelper !== 'undefined' && TavernHelper._eventOn) {
                var th = TavernHelper;
                var eventMap = { message_sent: 'MESSAGE_SENT', message_received: 'MESSAGE_RECEIVED', GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS', chat_id_changed: 'CHAT_CHANGED', message_deleted: 'MESSAGE_DELETED', message_swiped: 'MESSAGE_SWIPED', message_updated: 'MESSAGE_UPDATED' };
                var mapped = eventMap[name];
                if (mapped && th.tavern_events && th.tavern_events[mapped]) {
                    th._eventOn(th.tavern_events[mapped], fn);
                }
            }
        } catch (e2) {}
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
            if (typeof TavernHelper !== 'undefined' && TavernHelper.injectPrompts) {
                TavernHelper.injectPrompts([{
                    id: key,
                    position: position || 'in_chat',
                    depth: depth !== undefined ? depth : 2,
                    role: role || 'system',
                    content: value,
                    should_scan: false
                }], { once: false });
            }
        } catch (e) {}
    },
    getLorebookEntries: function(bookName) {
        try {
            if (typeof TavernHelper !== 'undefined' && TavernHelper.getLorebookEntries) {
                return TavernHelper.getLorebookEntries(bookName);
            }
        } catch (e) {}
        return Promise.resolve([]);
    },
    setLorebookEntries: function(bookName, entries) {
        try {
            if (typeof TavernHelper !== 'undefined' && TavernHelper.setLorebookEntries) {
                return TavernHelper.setLorebookEntries(bookName, entries);
            }
        } catch (e) {}
        return Promise.resolve();
    },
    createLorebookEntries: function(bookName, entries) {
        try {
            if (typeof TavernHelper !== 'undefined' && TavernHelper.createLorebookEntries) {
                return TavernHelper.createLorebookEntries(bookName, entries);
            }
        } catch (e) {}
        return Promise.resolve();
    },
    deleteLorebookEntries: function(bookName, uids) {
        try {
            if (typeof TavernHelper !== 'undefined' && TavernHelper.deleteLorebookEntries) {
                return TavernHelper.deleteLorebookEntries(bookName, uids);
            }
        } catch (e) {}
        return Promise.resolve();
    },
    getLorebooks: function() {
        try {
            if (typeof TavernHelper !== 'undefined' && TavernHelper.getLorebooks) {
                return TavernHelper.getLorebooks();
            }
        } catch (e) {}
        return Promise.resolve([]);
    },
    getParentDoc: function() {
        try {
            if (window.parent && window.parent !== window && window.parent.document) return window.parent.document;
        } catch (e) {}
        return document;
    },
    notify: function(msg, title, opts) {
        try {
            if (typeof toastr !== 'undefined') {
                if (toastr.info) toastr.info(msg, title || '', opts || { timeOut: 3000 });
                else toastr.success(msg, title || '', opts || { timeOut: 3000 });
            }
        } catch (e) {}
    },
    confirm: function(msg) {
        try { return confirm(msg); } catch (e) { return true; }
    }
});

/* ──────── init — 使用 Core bootstrap ──────── */

function loadSettings() {
    try {
        var raw = localStorage.getItem('ne_settings');
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

async function init() {
    var locale = getLocale();
    var settings = loadSettings();
    var chatId = getChatId();

    setContextFns(getChatId, getChatMessages);
    setGetContextBudgetFn(getContextBudget);

    await _bootstrapVault(chatId, locale, settings);

    setupEventListeners();
    registerToolsWithRetry(getChatId, getChatMessages, 0);
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
            try { eventSource.on('GENERATION_AFTER_COMMANDS', onBeforeGenerate); } catch (e) { console.warn('[NE] GENERATION_AFTER_COMMANDS registration failed:', e); }
            console.log('[NE] All string event listeners registered, onBeforeGenerate=' + typeof onBeforeGenerate);
            try { eventSource.on('chat_id_changed', async () => {
                try {
                    var chatId2 = getChatId();
                    console.log('[NE] chat_id_changed → chatId=' + chatId2);
                    neSyncChatId(chatId2);
                    var settings = loadSettings();
                    setStateSchemaEnabled(settings && settings.enableStateSchema || false);
                    setDynamicStateMode(settings && settings.useDynamicState || false);
                    setRetrievalEnabled(settings && settings.retrievalEnabled || false);
                    var vault = await loadVault(chatId2);
                    await migrateVaultIfNeeded(chatId2, vault);
                } catch (e) { console.warn('[NE] chat_id_changed handler error:', e); }
            }); } catch (e) {}
            try { eventSource.on('message_deleted', onMessageDeleted); } catch (e) {}
            try { eventSource.on('message_swiped', onMessageSwiped); } catch (e) {}
            try { eventSource.on('message_updated', onMessageUpdated); } catch (e) {}
            registerGlobalBannerRegex();
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
            if (tavern_events.GENERATION_AFTER_COMMANDS) TavernHelper._eventOn(tavern_events.GENERATION_AFTER_COMMANDS, onBeforeGenerate);
            if (tavern_events.CHAT_CHANGED) {
                TavernHelper._eventOn(tavern_events.CHAT_CHANGED, async () => {
                    var chatId2b = getChatId();
                    console.log('[NE] CHAT_CHANGED (legacy) → chatId=' + chatId2b);
                    neSyncChatId(chatId2b);
                    var settings = loadSettings();
                    setStateSchemaEnabled(settings && settings.enableStateSchema || false);
                    setDynamicStateMode(settings && settings.useDynamicState || false);
                    setRetrievalEnabled(settings && settings.retrievalEnabled || false);
                    var vault = await loadVault(chatId2b);
                    await migrateVaultIfNeeded(chatId2b, vault);
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

function getHostWindow() {
    try {
        if (window.parent && window.parent !== window && window.parent.document) return window.parent;
    } catch (e) {}
    return window;
}

function bootNE(retries) {
    if (retries > 10) return console.error('[NE] Boot failed after 10 retries: jQuery never loaded');
    if (typeof $ === 'undefined') return setTimeout(function () { bootNE((retries || 0) + 1); }, 300);
    var host = getHostWindow();
    console.log('[NE] Engine starting... build=' + 'NE v1.0.0');

    try {
        host.__ne_debug = _buildDebugApi(host);
        window.__ne_debug = host.__ne_debug;
        console.log('[NE] __ne_debug installed. Methods:', Object.keys(host.__ne_debug).filter(function(k) { return k[0] !== '_' }).join(', '));
    } catch (e) {
        console.error('[NE] __ne_debug install failed:', e);
        host.__ne_debug = {};
        window.__ne_debug = host.__ne_debug;
    }

    globalThis.__ne_debug_all_pipeline_responses = globalThis.__ne_debug_all_pipeline_responses || '';
    globalThis.__ne_debug_last_smartpush_prompt = globalThis.__ne_debug_last_smartpush_prompt || '';
    globalThis.__ne_llm_hook = {
        onPipelineLLMCall: onPipelineLLMCall,
        offPipelineLLMCall: offPipelineLLMCall
    };
    host.__ne_llm_hook = globalThis.__ne_llm_hook;

    $(async function () {
        try { await init(); } catch (e) { console.error('[NE] Init failed:', e); }
    });
}

function _buildDebugApi(host) {
    var hostDoc = host ? host.document : document;
    return {
        getLastInjection: function() { return globalThis.__ne_debug_last_injection || null; },
        getVaultState: async function() {
            try { var v = await read(getChatId()); return v && v.content ? v.content.state : null; } catch (e) { return null; }
        },
        getVaultSummary: async function() {
            try {
                var v = await read(getChatId());
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
            try { var v = await read(getChatId()); if (!v || !v.content) return null; return JSON.parse(JSON.stringify(v.content)); } catch (e) { return null; }
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
        runTest: async function(config) { try { return await runTest(config, hostDoc); } catch (e) { return { error: e.message }; } },
        runTestByName: async function(name) { try { return await runTestByName(name, hostDoc); } catch (e) { return { error: e.message }; } },
        listTests: function() { return listTests(); },
        getTestCaseMetadata: function(name) { return getTestCaseMetadata(name); },
        getUsageOverview: function() { return getUsageOverview(getAllChatStats); },
        getDailyStats: function(days) { return getDailyStats(days || 30); },
        getAllChatUsage: function() { return getAllChatUsage(getAllChatStats); },
        setReportsDir: async function() { try { return await setReportsDir(); } catch (e) { return 'Error: ' + e.message; } },
        waitForPipelineIdle: async function(timeout) { return waitForPipelineIdle(timeout); },
        dumpVaultKeys: async function() {
            try { return await _dumpVaultKeys(); } catch (e) { return 'Error: ' + e.message; }
        },
        findMyVault: async function() {
            try {
                var data = await _dumpVaultKeys();
                var keys = data.vaults || data; // fallback for old format
                var snaps = data.snapshots || [];
                var currentId = getChatId();
                console.log('[NE-DEBUG] Current chatId:', currentId);
                console.log('[NE-DEBUG] Vaults:');
                console.table(keys);
                if (snaps.length > 0) {
                    console.log('[NE-DEBUG] Snapshots (' + snaps.length + ' total):');
                    console.table(snaps);
                } else {
                    console.log('[NE-DEBUG] No snapshots found in IndexedDB.');
                }
                return { currentChatId: currentId, allKeys: keys, snapshots: snaps };
            } catch (e) { return 'Error: ' + e.message; }
        }
    };
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
            var snapDone = false;
            var snapKeys = [];

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
                    if (snapDone) finish();
                }
            };
            vaultTx.onerror = function() { db.close(); reject(vaultTx.error); };

            var snapTx = db.transaction('snapshots', 'readonly');
            var snapStore = snapTx.objectStore('snapshots');
            snapStore.openCursor().onsuccess = function(e) {
                var cursor = e.target.result;
                if (cursor) {
                    var s = cursor.value;
                    snapKeys.push({
                        chat_id: s.chat_id || '(unknown)',
                        version: s.version,
                        id: cursor.key
                    });
                    cursor.continue();
                } else {
                    snapDone = true;
                    if (vaultDone) finish();
                }
            };
            snapTx.onerror = function() { snapDone = true; if (vaultDone) finish(); };

            function finish() {
                db.close();
                resolve({ vaults: keys, snapshots: snapKeys });
            }
        };
        req.onerror = function() { reject(req.error); };
    });
}

document.addEventListener('DOMContentLoaded', function () { bootNE(); });
if (document.readyState === 'complete' || document.readyState === 'interactive') { bootNE(); }
