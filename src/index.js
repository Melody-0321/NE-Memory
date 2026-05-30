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
    injectNEcss();
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

function injectNEcss() {
    if (document.getElementById('ne_style_injected')) return;
    var style = document.createElement('style');
    style.id = 'ne_style_injected';
    style.textContent = [
        '.ne_vault_toggle{position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:99999;width:32px;height:48px;background:var(--SmartThemeBlurTintColor,#2a2a3a);border:1px solid var(--grey5050a,#444);border-right:none;border-radius:8px 0 0 8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--grey-50,#aaa);transition:right .3s ease,color .15s,background .15s;box-shadow:-2px 0 8px rgba(0,0,0,.3)}',
        '.ne_vault_toggle:hover{color:var(--text,#ddd);background:var(--SmartThemeBlurTintColor,#3a3a4a);width:36px}',
        '.ne_vault_toggle.panel-open{right:420px;border-radius:0 0 0 8px;border-right:1px solid var(--grey5050a,#444);box-shadow:none}',
        '.ne_vault_drawer{position:fixed;top:0;right:0;width:420px;height:100vh;z-index:99998;background:var(--SmartThemeBlurTintColor,#1e1e2e);border-left:1px solid var(--grey5050a,#333);box-shadow:-4px 0 24px rgba(0,0,0,.5);transform:translateX(100%);transition:transform .3s ease;display:flex;flex-direction:column;overflow:hidden}',
        '.ne_vault_header{display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid var(--black50a);flex-shrink:0}',
        '.ne_vault_title{font-weight:700;font-size:1.05em;white-space:nowrap}',
        '.ne_vault_version{font-size:.8em;color:var(--grey-50,#888);margin-left:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.ne_vault_close{margin-left:auto;cursor:pointer;font-size:1.3em;color:var(--grey-50,#888);padding:0 4px;line-height:1}',
        '.ne_vault_close:hover{color:var(--text,#ddd)}',
        '.ne_vault_tabs{display:flex;border-bottom:1px solid var(--black50a);flex-shrink:0;overflow-x:auto}',
        '.ne_vault_tab{padding:8px 10px;font-size:.85em;cursor:pointer;color:var(--grey-50,#888);border-bottom:2px solid transparent;white-space:nowrap;transition:color .15s,border-color .15s;user-select:none}',
        '.ne_vault_tab:hover{color:var(--text,#ccc)}',
        '.ne_vault_tab.active{color:var(--text,#ddd);border-bottom-color:var(--primary,#64b5f6)}',
        '.ne_vault_body{flex:1;overflow-y:auto;padding:8px 10px}',
        '.ne_vault_tab_content{display:none}',
        '.ne_vault_tab_content.active{display:block}',
        '.ne_vault_footer{display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--black50a);flex-shrink:0}',
        '.ne_vault_btn{font-size:.85em;padding:4px 10px;cursor:pointer;border:1px solid var(--grey5050a);border-radius:4px;background:var(--black30a);color:var(--text);white-space:nowrap}',
        '.ne_vault_btn:hover{background:var(--black50a)}',
        '.ne_section{margin-bottom:6px}',
        '.ne_section_title{font-weight:700;font-size:.9em;margin:6px 0 3px;border-bottom:1px solid var(--black50a);padding-bottom:2px}',
        '.ne_empty{color:#888;padding:12px 0;text-align:center}',
        '.ne_state_render{background:var(--black50a,rgba(0,0,0,.15));padding:8px;border-radius:4px;font-size:.9em}',
        '.ne_state_toolbar{margin-top:4px;display:flex;align-items:center;gap:4px;flex-wrap:wrap}',
        '.ne_inline_label{font-size:.85em;white-space:nowrap}',
        '.ne_select{font-size:.85em;width:auto;max-width:120px}',
        '.ne_vault_btn_small{font-size:.8em;padding:2px 6px;cursor:pointer;border:1px solid var(--grey5050a);border-radius:3px;background:var(--black30a);color:var(--text)}',
        '.ne_vault_btn_small:hover{background:var(--black50a)}',
        '.ne_vault_btn_tiny{font-size:.78em;padding:1px 5px;cursor:pointer;border:1px solid var(--grey5050a);border-radius:3px;background:var(--black30a);color:var(--text)}',
        '.ne_vault_btn_tiny:hover{background:var(--black50a)}',
        '.ne_textarea{width:100%;background:#1a1a1a;color:var(--text);border:1px solid var(--grey5050a);border-radius:3px;padding:6px;font-family:var(--monoFontFamily);font-size:.85em;resize:vertical;box-sizing:border-box;margin-top:4px}',
        '.ne_opening_text{background:var(--black50a);padding:8px;border-radius:4px;font-size:.9em;white-space:pre-wrap}',
        '.ne_log_entry{margin:4px 0;padding:4px;background:var(--black30a);border-radius:3px}',
        '.ne_log_header{cursor:pointer;font-weight:700;color:var(--grey-70);font-size:.85em}',
        '.ne_log_body{margin-top:4px}',
        '.ne_log_pre{margin:2px 0 6px;white-space:pre-wrap;max-height:200px;overflow-y:auto;background:var(--black50a);padding:4px;border-radius:2px;font-size:.83em;font-family:var(--monoFontFamily)}',
        '.ne_log_label{color:#aaa;font-size:.83em;margin-top:4px}',
        '.ne_tool_entry{margin:3px 0;padding:3px 4px;background:var(--black30a);border-radius:3px;font-size:.85em}',
        '.narrative_memory_table{width:100%;border-collapse:collapse;font-size:.85em;line-height:1.5;margin-top:4px}',
        '.narrative_memory_table th{background:var(--black50a);padding:6px 8px;text-align:left;font-weight:700;border-bottom:2px solid var(--black70a);white-space:nowrap}',
        '.narrative_memory_table td{padding:6px 8px;border-bottom:1px solid var(--black30a);vertical-align:top}',
        '.narrative_memory_table tr:hover{background:var(--black20a)}',
        '.narrative_ltm_toggle{cursor:pointer;font-size:.9em;margin-right:4px;user-select:none;color:var(--grey-30,#aaa);transition:color .15s,transform .15s;display:inline-block}',
        '.narrative_ltm_toggle:hover{color:var(--text,#ddd);transform:scale(1.2)}',
        '.narrative_link{color:#64b5f6;cursor:pointer;font-size:.85em;margin-right:4px}',
        '.narrative_link:hover{text-decoration:underline}',
        '.stm-link{color:#81c784;cursor:pointer}',
        '.stm-link:hover{text-decoration:underline}',
        '.msg-link{color:#64b5f6;cursor:pointer}',
        '.msg-link:hover{text-decoration:underline}',
        '.narrative_ltm_detail td{padding:0!important;border-bottom:none!important}',
        '.narrative_ltm_detail_container{background:var(--black30a,rgba(0,0,0,.1));padding:6px 8px 6px 24px;border-left:3px solid var(--grey-50,#666);margin:0}',
        '.narrative_ltm_stm_entry{padding:4px 0;border-bottom:1px solid var(--black20a,rgba(0,0,0,.05));font-size:.9em;line-height:1.5}',
        '.narrative_ltm_stm_entry:last-child{border-bottom:none}',
        '.narrative_ltm_stm_label{color:var(--grey-40,#999);font-size:.85em;margin-right:6px;white-space:nowrap}',
        '.narrative_ltm_stm_scene{color:var(--grey-50,#888);font-size:.85em;margin-right:6px}',
        '.narrative_ltm_stm_event{color:var(--text,#ddd)}',
        '.narrative_ltm_stm_missing{color:#888;font-style:italic}',
        '#ne_config{position:fixed;top:5%;left:50%;transform:translateX(-50%);z-index:100000;background:var(--SmartThemeBlurTintColor);border:1px solid var(--grey5050a);border-radius:8px;padding:16px;max-width:500px;max-height:85vh;overflow-y:auto;box-shadow:0 4px 24px rgba(0,0,0,.5)}'
    ].join(' ');
    document.head.appendChild(style);
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

$(async function () {
    if (typeof window.__NE_MEMORY_LOADED__ !== 'undefined') return;
    window.__NE_MEMORY_LOADED__ = true;
    try { await init(); } catch (e) { console.error('[NE] Init failed:', e); }
});
