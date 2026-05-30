/**
 * index.js — NE Memory Engine 入口（TH 脚本模式）
 *
 * 安装：粘贴此文件 URL 到 TH 脚本管理器。
 * 发行：jsdelivr CDN → https://cdn.jsdelivr.net/gh/xxx/ne-memory@v0.2.0/dist/index.js
 *
 * 注意：index.js 只做初始化编排，不导入其他模块中用不到的符号。
 *      所有 16 个死导入已在 2026-05-30 重构中移除。
 */
import { read, write } from './vault/store.js';
import { registerAllTools } from './tools.js';
import { onMessageSent, onMessageReceived, onBeforeGenerate, setContextFns } from './events.js';
import { t } from './i18n.js';
import { renderVaultPanel } from './ui/vault-panel.js';

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
    const chatId = getChatId();
    const vault = await read(chatId);
    if (vault.version === 0 && !vault.content.opening_summary.text) {
        vault.content.language = locale.includes('zh') ? 'zh' : 'en';
        await write(chatId, vault);
    }
    setContextFns(getChatId, getChatMessages);
    await renderVaultPanel(getChatId);
    setupEventListeners();
    registerAllTools(getChatId, getChatMessages);
}

function setupEventListeners() {
    if (typeof TavernHelper === 'undefined' || !TavernHelper._eventOn) {
        setTimeout(setupEventListeners, 500);
        return;
    }
    const { tavern_events } = TavernHelper;
    TavernHelper._eventOn(tavern_events.MESSAGE_SENT, onMessageSent);
    TavernHelper._eventOn(tavern_events.MESSAGE_RECEIVED, onMessageReceived);
    TavernHelper._eventOn(tavern_events.GENERATION_AFTER_COMMANDS, onBeforeGenerate);
    TavernHelper._eventOn(tavern_events.CHAT_CHANGED, async () => {
        const chatId = getChatId();
        const vault = await read(chatId);
        if (vault.version === 0) {
            vault.content.language = getLocale().includes('zh') ? 'zh' : 'en';
            await write(chatId, vault);
        }
    });
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
