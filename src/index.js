/**
 * index.js — NE Memory Engine 入口（TH 脚本模式）
 *
 * 安装：粘贴此文件 URL 到 TH 脚本管理器。
 * 发行：gcore CDN（大陆可用）→ https://gcore.jsdelivr.net/gh/Melody-0321/NE-Memory@v1.1.0/dist/index.js
 */
import { read, write } from './vault/store.js';
import { registerAllTools } from './tools.js';
import { onMessageSent, onMessageReceived, onBeforeGenerate, onMessageDeleted, onMessageSwiped, onMessageUpdated, setContextFns, neSyncChatId, restorePending } from './events.js';
import { t, setFieldLocale } from './i18n.js';
import { renderVaultPanel } from './ui/vault-panel.js';
import { DEFAULT_GLOBAL_SCHEMA, DEFAULT_CHARACTER_SCHEMA, setStateSchemaEnabled, setDynamicStateMode } from './vault/schema.js';
import { checkAndRestoreEmbeddedVault } from './auto-restore.js';
import { setRetrievalEnabled } from './settings.js';
import { testSecondaryApiConnection } from './api/llm.js';
import { ensureStateWorldBook } from './engine/worldbook-sync.js';

var _retryTimer = null;

function getChatId() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            return ctx.chatId || 'default';
        }
    } catch (e) {}
    return 'default';
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
            const ctx = SillyTavern.getContext();
            if (ctx.getCurrentLocale) {
                var l = String(ctx.getCurrentLocale()).toLowerCase();
                if (l) return l;
            }
        }
    } catch (e) {}
    try { return localStorage.getItem('language') || 'en'; } catch (e) { return 'en'; }
}

async function init() {
    const locale = getLocale();
    t(locale);
    setFieldLocale(locale);
    var settings = loadSettings();
    setStateSchemaEnabled(settings && settings.enableStateSchema || false);
    setDynamicStateMode(settings && settings.useDynamicState || false);
    setRetrievalEnabled(settings && settings.retrievalEnabled || false);
    const chatId = getChatId();
    const vault = await read(chatId);
    if (vault.version === 0 && !vault.content.language) {
        vault.content.language = locale.includes('zh') ? 'zh' : 'en';
        vault.content.state_schema = (settings && settings.stateSchema) || DEFAULT_GLOBAL_SCHEMA;
        vault.content.character_schema = (settings && settings.characterSchema) || DEFAULT_CHARACTER_SCHEMA;
        await write(chatId, vault);
    }
    setContextFns(getChatId, getChatMessages);
    restorePending();
    await renderVaultPanel(getChatId);
    autoConnectSecondaryApi();
    ensureStateWorldBook().catch(function(e) { console.warn('[NE] World book init failed:', e.message); });
    setupEventListeners();
    registerToolsWithRetry(getChatId, getChatMessages, 0);

    console.log('[NE] Engine initialized — chatId=' + chatId + ', version=' + vault.version);
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

function loadSettings() {
    try {
        var raw = localStorage.getItem('ne_settings');
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function autoConnectSecondaryApi() {
    try {
        var raw = localStorage.getItem('ne_secondary_api');
        if (!raw) return;
        var cfg = JSON.parse(raw);
        if (!cfg.url || !cfg.model) return;
        testSecondaryApiConnection(cfg).then(function (r) {
            if (r.success) console.log('[NE] Auto-connected to secondary API:', cfg.model);
        });
    } catch (e) { console.warn('[NE] Auto-connect skipped:', e.message); }
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
                    const chatId = getChatId();
                    neSyncChatId(chatId);
                    var settings = loadSettings();
                    setStateSchemaEnabled(settings && settings.enableStateSchema || false);
                    setDynamicStateMode(settings && settings.useDynamicState || false);
                    setRetrievalEnabled(settings && settings.retrievalEnabled || false);
                    const vault = await read(chatId);
                    if (vault.version === 0) {
                        vault.content.language = getLocale().includes('zh') ? 'zh' : 'en';
                        await write(chatId, vault);
                    }
                    checkAndRestoreEmbeddedVault(chatId);
                } catch (e) { console.warn('[NE] chat_id_changed handler error:', e); }
            }); } catch (e) {}
            try { eventSource.on('message_deleted', onMessageDeleted); } catch (e) {}
            try { eventSource.on('message_swiped', onMessageSwiped); } catch (e) {}
            try { eventSource.on('message_updated', onMessageUpdated); } catch (e) {}
            console.log('[NE] Event listeners registered via eventSource');
        }
        return;
    }

    if (typeof TavernHelper !== 'undefined' && TavernHelper._eventOn && TavernHelper.tavern_events) {
        if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
        const { tavern_events } = TavernHelper;
        try {
            if (tavern_events.MESSAGE_SENT) TavernHelper._eventOn(tavern_events.MESSAGE_SENT, onMessageSent);
            if (tavern_events.MESSAGE_RECEIVED) TavernHelper._eventOn(tavern_events.MESSAGE_RECEIVED, onMessageReceived);
            if (tavern_events.GENERATION_AFTER_COMMANDS) TavernHelper._eventOn(tavern_events.GENERATION_AFTER_COMMANDS, onBeforeGenerate);
            if (tavern_events.CHAT_CHANGED) {
                TavernHelper._eventOn(tavern_events.CHAT_CHANGED, async () => {
                    const chatId = getChatId();
                    neSyncChatId(chatId);
                    var settings = loadSettings();
                    setStateSchemaEnabled(settings && settings.enableStateSchema || false);
                    setDynamicStateMode(settings && settings.useDynamicState || false);
                    setRetrievalEnabled(settings && settings.retrievalEnabled || false);
                    const vault = await read(chatId);
                    if (vault.version === 0) {
                        vault.content.language = getLocale().includes('zh') ? 'zh' : 'en';
                        await write(chatId, vault);
                    }
                    checkAndRestoreEmbeddedVault(chatId);
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
    // TH scripts may run inside an iframe. Expose debug API on the parent window
    // so the user's F12 console (attached to the main window) can access it.
    try {
        if (window.parent && window.parent !== window && window.parent.document) {
            return window.parent;
        }
    } catch (e) {}
    return window;
}

function bootNE(retries) {
    if (retries > 10) return console.error('[NE] Boot failed after 10 retries: jQuery never loaded');
    if (typeof $ === 'undefined') return setTimeout(function () { bootNE((retries || 0) + 1); }, 300);
    var host = getHostWindow();
    if (typeof host.__NE_MEMORY_LOADED__ !== 'undefined') {
        console.log('[NE] Already booted, skipping (__NE_MEMORY_LOADED__ exists)');
        return;
    }
    host.__NE_MEMORY_LOADED__ = true;
    console.log('[NE] Engine starting... build=' + 'NE v1.0.0');

    try {
        host.__ne_debug = _buildDebugApi(host);
        // Also alias on iframe's own window — internal code uses this
        window.__ne_debug = host.__ne_debug;
        console.log('[NE] __ne_debug installed. Methods:', Object.keys(host.__ne_debug).filter(function(k) { return k[0] !== '_' }).join(', '));
    } catch (e) {
        console.error('[NE] __ne_debug install failed:', e);
        host.__ne_debug = {};
        window.__ne_debug = host.__ne_debug;
    }

    $(async function () {
        try { await init(); } catch (e) { console.error('[NE] Init failed:', e); }
    });
}

// ── Debug API factory (moved out of bootNE for cleanliness) ──

function _buildDebugApi(host) {
    var hostDoc = host ? host.document : document;
    return {
        getLastInjection: function() { return globalThis.__ne_debug_last_injection || null; },
        getVaultState: async function() {
            try {
                var v = await read(getChatId());
                return v && v.content ? v.content.state : null;
            } catch (e) { return null; }
        },
        getVaultSummary: async function() {
            try {
                var v = await read(getChatId());
                if (!v || !v.content) return null;
                return {
                    stmCount: (v.content.unconsolidated_stm || []).length + (v.content.stm_entries || []).length,
                    ltmCount: (v.content.ltm_entries || []).length,
                    unconsolidatedCount: (v.content.unconsolidated_stm || []).length
                };
            } catch (e) { return null; }
        },
        getLastPipelineOutput: function() { return globalThis.__ne_debug_last_pipeline || null; },
        getLastMerge: function() { return globalThis.__ne_debug_last_merge || null; },
        getLastNotebook: function() { return globalThis.__ne_debug_last_notebook || null; },
        _testSeeds: [
            '你好，我叫阿明，是一名矿工。',
            '北山矿洞最近有些异常，频繁有小规模塌方。',
            '我的朋友老张是铁匠，他今天也来矿洞了。',
            '老张脸色很差，他说昨天在矿洞深处看到了奇怪的光。',
            '我觉得应该向工头报告这个情况。不过工头这几天不在。',
            '老张说他认识一个地质师，也许可以请她来看看。',
            '对了，那个地质师叫什么来着？许瑶，对，许瑶。',
            '许瑶以前在这片矿区工作过，后来调走了。不过她应该还住在本镇。',
            '老张说他会去找许瑶。希望她能帮忙。',
            '矿洞入口处的水位也在上升。这很不正常。'
        ],
        _lastTestReport: null,
        seedAndWait: async function(count) {
            count = Math.min(count || 5, 10);
            console.log('[NEM-HARNESS] Seeding ' + count + ' messages...');
            for (var i = 0; i < count; i++) {
                var text = globalThis.__ne_debug._testSeeds[i];
                console.log('[' + (i + 1) + '/' + count + '] ' + text);
                var ta = hostDoc.getElementById('send_textarea');
                if (!ta) { console.error('[NEM-HARNESS] No textarea'); return; }
                ta.value = text;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                setTimeout(function() {
                    var btn = hostDoc.getElementById('send_but');
                    if (btn) btn.click();
                }, 100);
                await new Promise(function(resolve) {
                    var start = Date.now(), wasDisabled = false;
                    function poll() {
                        var btn = hostDoc.getElementById('send_but');
                        var disabled = btn ? btn.disabled : false;
                        if (disabled) wasDisabled = true;
                        if (wasDisabled && !disabled) { resolve(); return; }
                        if (Date.now() - start > 180000) { resolve(); return; }
                        setTimeout(poll, 300);
                    }
                    setTimeout(poll, 2000);
                });
                await new Promise(function(r) { setTimeout(r, 10000); });
                var summary = await globalThis.__ne_debug.getVaultSummary();
                console.log('  -> VAULT: ' + (summary ? 'STM=' + summary.stmCount + ' LTM=' + summary.ltmCount + ' Unc=' + summary.unconsolidatedCount : 'n/a'));
            }
            console.log('[NEM-HARNESS] Seed done.');
        },
        runQuery: async function(query) {
            console.log('[NEM-HARNESS] === RUN: ' + query + ' ===');
            var ta = hostDoc.getElementById('send_textarea');
            if (!ta) { console.error('[NEM-HARNESS] No textarea'); return null; }
            ta.value = query;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(function() { var btn = hostDoc.getElementById('send_but'); if (btn) btn.click(); }, 100);
            await new Promise(function(resolve) {
                var start = Date.now(), wasDisabled = false;
                function poll() {
                    var btn = hostDoc.getElementById('send_but');
                    var disabled = btn ? btn.disabled : false;
                    if (disabled) wasDisabled = true;
                    if (wasDisabled && !disabled) { resolve(); return; }
                    if (Date.now() - start > 180000) { resolve(); return; }
                    setTimeout(poll, 300);
                }
                setTimeout(poll, 2000);
            });
            await new Promise(function(r) { setTimeout(r, 8000); });
            var data = {
                injection: globalThis.__ne_debug_last_injection || null,
                merge: globalThis.__ne_debug_last_merge || null,
                notebook: globalThis.__ne_debug_last_notebook || null,
                target: query, time: new Date().toISOString()
            };
            try { data.vault = await globalThis.__ne_debug.getVaultSummary(); } catch(e) {}
            globalThis.__ne_debug._lastTestReport = data;
            var L = ['=== REPORT ===', 'Target: ' + query];
            if (data.vault) L.push('VAULT: STM=' + data.vault.stmCount + ' LTM=' + data.vault.ltmCount + ' Unc=' + data.vault.unconsolidatedCount);
            if (data.merge) {
                L.push('MERGE: map=' + data.merge.mapSize + ' threads=' + data.merge.threadCount);
                if (data.merge.threadKeys && data.merge.threadKeys.length > 0) L.push('  threadKeys: ' + data.merge.threadKeys.join(', '));
                if (data.merge.availableChains && data.merge.availableChains.length > 0) L.push('  availableChains: ' + JSON.stringify(data.merge.availableChains));
            }
            if (data.notebook) L.push('NOTEBOOK: v=' + data.notebook.version + ' map=' + data.notebook.mapSize + ' threads=' + data.notebook.threadCount);
            if (data.injection) {
                L.push('INJECTION (' + data.injection.length + ' chars):');
                L.push(data.injection.substring(0, 600));
                if (data.injection.length > 600) L.push('...');
                L.push('  CHECK: has thread annotations {L:...}  ' + (data.injection.indexOf('{L:') !== -1 ? 'YES' : 'NO'));
            } else L.push('NO INJECTION');
            console.log(L.join('\n'));
            return data;
        },
        getLastReport: function() { return globalThis.__ne_debug._lastTestReport; }
    };
    $(async function () {
        try { await init(); } catch (e) { console.error('[NE] Init failed:', e); }
    });
}

document.addEventListener('DOMContentLoaded', function () { bootNE(); });
if (document.readyState === 'complete' || document.readyState === 'interactive') { bootNE(); }
