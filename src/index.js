/**
 * index.js — NE Memory Engine 入口（TH 脚本模式）
 *
 * 安装：粘贴此文件 URL 到 TH 脚本管理器。
 * 发行：jsdelivr CDN → https://cdn.jsdelivr.net/gh/Melody-0321/NE-Memory@96d75a0/dist/index.js
 */
import { read, write } from './vault/store.js';
import { registerAllTools } from './tools.js';
import { onMessageSent, onMessageReceived, onBeforeGenerate, onMessageDeleted, onMessageSwiped, onMessageUpdated, setContextFns, neSyncChatId, restorePending } from './events.js';
import { t } from './i18n.js';
import { renderVaultPanel } from './ui/vault-panel.js';
import { DEFAULT_GLOBAL_SCHEMA, DEFAULT_CHARACTER_SCHEMA, setStateSchemaEnabled, setDynamicStateMode } from './vault/schema.js';
import { checkAndRestoreEmbeddedVault } from './auto-restore.js';
import { setRetrievalEnabled } from './settings.js';

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
        if (!eventSource.__ne_bound) {
            eventSource.__ne_bound = true;
            try { eventSource.on('message_sent', onMessageSent); } catch (e) { console.warn('[NE] message_sent registration failed:', e); }
            try { eventSource.on('message_received', onMessageReceived); } catch (e) { console.warn('[NE] message_received registration failed:', e); }
            try { eventSource.on('GENERATION_AFTER_COMMANDS', onBeforeGenerate); } catch (e) { console.warn('[NE] GENERATION_AFTER_COMMANDS registration failed:', e); }
            console.log('[NE] All string event listeners registered, onBeforeGenerate=' + typeof onBeforeGenerate);
            try { eventSource.on('chat_id_changed', async () => {
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
            }); } catch (e) {}
            try { eventSource.on('message_deleted', onMessageDeleted); } catch (e) {}
            try { eventSource.on('message_swiped', onMessageSwiped); } catch (e) {}
            try { eventSource.on('message_updated', onMessageUpdated); } catch (e) {}
            console.log('[NE] Event listeners registered via eventSource');
        }
        return;
    }

    if (typeof TavernHelper !== 'undefined' && TavernHelper._eventOn && TavernHelper.tavern_events) {
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
    setTimeout(function () { setupEventListeners(retryCount + 1); }, delay);
}

function bootNE(retries) {
    if (retries > 10) return console.error('[NE] Boot failed after 10 retries');
    if (typeof $ === 'undefined') return setTimeout(function () { bootNE((retries || 0) + 1); }, 300);
    if (typeof window.__NE_MEMORY_LOADED__ !== 'undefined') return;
    window.__NE_MEMORY_LOADED__ = true;
    console.log('[NE] Engine starting...');
    $(async function () {
        try { await init(); } catch (e) { console.error('[NE] Init failed:', e); }
    });
}

document.addEventListener('DOMContentLoaded', function () { bootNE(); });
if (document.readyState === 'complete' || document.readyState === 'interactive') { bootNE(); }
