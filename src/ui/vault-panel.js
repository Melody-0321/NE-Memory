/**
 * ui/vault-panel.js — Vault 面板（精确复制 v0.1.0 UI）
 *
 * 通过 window.parent.document 操作主 ST 页面 DOM。
 * Drawer HTML 结构与 v0.1.0 完全一致。
 */
import { read, write, isStorageBlocked, collectAllMsgIds } from '../vault/store.js';
import { listSnapshots, restoreSnapshot, deleteSnapshot } from '../vault/versions.js';
import { executeConsolidation } from '../engine/consolidate.js';
import { executeIncrementalUpdate } from '../engine/update.js';
import { t_narrative, t_field, setFieldLocale } from '../i18n.js';
import { escapeHtml, formatLocalTime } from './utils.js';
import { formatStateSummary, DEFAULT_CHARACTER_SCHEMA, formatCharacterSummary, formatActiveCharacterSummary, DEFAULT_FACTION_SCHEMA, formatQuestSummary, isStateSchemaEnabled, isDynamicStateMode, formatCoreStateSummary, getEffectiveSchema, buildDynamicCharacterSchema } from '../vault/schema.js';
import { telemetryBuffer, recordTelemetry, callMemoryRetrieval, callMemoryRetrievalWithTools, testSecondaryApiConnection, sendSecondaryTestMessage, saveSecondaryApiConfig, loadSecondaryApiConfig, loadRetrievalApiConfig, saveRetrievalApiConfig, isApiSplitMode, setApiSplitMode } from '../api/llm.js';
import { filterCandidates } from '../vault/retrieval-filter.js';
import { buildRetrievalMessages } from '../engine/retrieval.js';
import { extractEntityNames, lookupEntityChains, mergePipelines } from '../engine/retrieval.js';
import { resolveAmbiguousReferences, resolveWithLM } from '../engine/ambiguity.js';
import { executeAccess } from '../tools.js';
import { RetrievalNotebook } from '../vault/retrieval-notebook.js';
import { getAllChatStats } from '../engine/chat-telemetry.js';
import { isAuto, computeStmBatch, getTelemetryStats, getSTContextSize, setAuto } from '../params.js';

/* ──────── 工具 ──────── */

function t(key) { return t_narrative(key); }

/* window.parent.document 始终指向 ST 主页面 DOM。
 * 在主页中 window.parent === window，在 iframe 中可跨域访问父页面。 */
var PD;
try { PD = window.parent.document; } catch(e) { PD = document; }
function qs(sel) { return PD.querySelector(sel); }
function qsa(sel) { return PD.querySelectorAll(sel); }
function byId(id) { return PD.getElementById(id); }
function pdCreate(tag) { return PD.createElement(tag); }
function pdHead() { return PD.head; }
function pdAddEventListener(type, fn, opts) { PD.addEventListener(type, fn, opts); }

function freezeIframeHeight() {
    try { if (window.frameElement) { window.frameElement.style.height = '0px'; window.frameElement.style.minHeight = '0px'; } } catch (e) {}
}

function setVaultActivity(active) {
    var el = byId('narrative_vault_activity');
    if (!el) return;
    if (active) {
        el.innerHTML = '&#9696;';
        el.style.color = '#4caf50';
        el.style.animation = 'ne_spin 1s linear infinite';
    } else {
        el.innerHTML = '&#9679;';
        el.style.color = '#888';
        el.style.animation = '';
    }
}

function injectPinCSS() {
    if (byId('ne_pin_style')) return;
    var style = pdCreate('style');
    style.id = 'ne_pin_style';
    style.textContent = '#narrative_vault_pin_div{font-size:24px;display:inline;padding:1px;opacity:0.5;transition:0.2s}' +
        '#narrative_vault_pin_div:hover,#narrative_vault_pin_div:has(:focus-visible){opacity:1}' +
        '#narrative_vault_pin{display:none}' +
        '#narrative_vault_pin:checked+label .checked{display:inline}' +
        '#narrative_vault_pin:checked+label .unchecked{display:none}' +
        '#narrative_vault_pin:not(:checked)+label .checked{display:none}' +
        '#narrative_vault_pin:not(:checked)+label .unchecked{display:inline}' +
        '@keyframes ne_spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}';
    pdHead().appendChild(style);
}

function injectBottomDrawerCSS() {
    var old = byId('ne_vault_bottom_style');
    if (old) old.remove();
    var style = pdCreate('style');
    style.id = 'ne_vault_bottom_style';
    style.textContent = '.ne-vault-bottom-overlay{' +
        'display:none;flex-direction:column;flex-grow:1;min-height:0;overflow:hidden;' +
        'background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border-top:1px solid var(--SmartThemeBorderColor);border-radius:12px 12px 0 0;}' +
        '.ne-vault-bottom-overlay.open{display:flex;flex-grow:1;min-height:0;}' +
        '.ne-vault-collapse-bar{flex-shrink:0;display:flex;justify-content:center;align-items:center;' +
        'padding:10px 0 6px;cursor:pointer;min-height:28px;}' +
        '.ne-vault-collapse-indicator{width:48px;height:5px;background:var(--SmartThemeBorderColor);' +
        'border-radius:3px;opacity:.6;transition:opacity .2s;}' +
        '.ne-vault-collapse-bar:hover .ne-vault-collapse-indicator{opacity:1;}' +
        '.ne-vault-collapse-chevron{margin-left:4px;color:var(--SmartThemeBorderColor);font-size:10px;opacity:.6;}' +
        '.ne-vault-scroll-area{flex:1;overflow-y:auto;overflow-x:hidden;padding:0 12px 12px;}' +
        '.ne-vault-pin-row{display:flex;align-items:center;padding:0 0 8px;min-height:24px;}' +
        '.ne-vault-tab-bar{display:flex;gap:2px;padding:0 12px 6px;border-bottom:1px solid var(--SmartThemeBorderColor);margin-bottom:4px;}' +
        '.ne-vault-tab{flex:1;text-align:center;padding:8px 0;cursor:pointer;font-size:0.9em;color:var(--grey-70);border-bottom:2px solid transparent;transition:color .15s,border-color .15s;user-select:none;}' +
        '.ne-vault-tab:hover{color:var(--text,#ddd);}' +
        '.ne-vault-tab.active{color:var(--text,#fff);border-bottom-color:var(--SmartThemeBorderColor);font-weight:bold;}' +
        '.ne-vault-tab-content{display:none;}' +
        '.ne-vault-tab-content.active{display:block;}' +
        '.ne-quick-index{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:4px;padding:4px 12px;margin-bottom:6px;background:var(--SmartThemeBlurTintColor);border-radius:0 0 6px 6px;}' +
        '.ne-index-item{font-size:0.78em;padding:2px 8px;cursor:pointer;border-radius:4px;background:var(--black30a);color:var(--grey-70);white-space:nowrap;transition:background .15s,color .15s;}' +
        '.ne-index-item:hover{background:var(--black50a);color:var(--text,#ddd);}' +
        '.ne-index-item em{font-style:normal;font-weight:bold;color:var(--grey-50);margin-left:2px;}' +
        '.ne-accordion{margin-bottom:4px;}' +
        '.ne-accordion-header{display:flex;align-items:center;padding:8px 12px;cursor:pointer;user-select:none;background:var(--black30a);border-radius:6px;font-weight:bold;font-size:0.95em;transition:background .15s;}' +
        '.ne-accordion-header:hover{background:var(--black50a);}' +
        '.ne-accordion-chevron{margin-right:8px;font-size:0.7em;transition:transform .2s;color:var(--grey-50);display:inline-block;}' +
        '.ne-accordion.open>.ne-accordion-header .ne-accordion-chevron{transform:rotate(90deg);}' +
        '.ne-accordion-body{display:none;padding:4px 0 4px 12px;}' +
        '.ne-accordion.open>.ne-accordion-body{display:block;}' +
        '.ne-accordion-body .ne-accordion-header{background:transparent;font-weight:normal;font-size:0.9em;padding:6px 8px;border-left:3px solid transparent;border-radius:0;}' +
        '.ne-accordion-body .ne-accordion.open>.ne-accordion-header{border-left-color:var(--SmartThemeBorderColor);}' +
        '.ne-accordion-highlight{box-shadow:0 0 0 2px var(--SmartThemeBorderColor)!important;}' +
        '.ne-tr-container{padding:4px 0;font-size:0.85em;}' +
        '.ne-tr-select{width:100%;background:var(--black30a);color:var(--text);border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:4px 6px;font-size:0.9em;margin-bottom:6px;}' +
        '.ne-tr-actions{display:flex;gap:4px;margin-bottom:6px;}' +
        '.ne-tr-btn{flex:1;padding:4px 8px;font-size:0.85em;border-radius:4px;border:1px solid var(--SmartThemeBorderColor);background:var(--black30a);color:var(--text);cursor:pointer;text-align:center;transition:background .15s;}' +
        '.ne-tr-btn:hover{background:var(--black50a);}' +
        '.ne-tr-btn:disabled{opacity:0.5;cursor:not-allowed;}' +
        '.ne-tr-btn.ok{background:#2e7d32;border-color:#2e7d32;color:#fff;}' +
        '.ne-tr-btn.ok:hover{background:#388e3c;}' +
        '.ne-tr-status{padding:4px 0;min-height:1.2em;font-size:0.9em;color:var(--grey-50);}' +
        '.ne-tr-status.running{color:var(--text);}' +
        '.ne-tr-result{padding:4px 0;}' +
        '.ne-tr-result-header{font-weight:bold;margin:6px 0 2px;display:flex;align-items:center;gap:6px;}' +
        '.ne-tr-result-entry{padding:2px 0 2px 12px;display:flex;align-items:center;gap:4px;font-size:0.9em;}' +
        '.ne-tr-pass{color:#4caf50;font-weight:bold;}' +
        '.ne-tr-fail{color:#f44336;font-weight:bold;}' +
        '.ne-tr-semantic{margin-top:4px;padding:4px 8px;border-left:3px solid var(--SmartThemeBorderColor);font-size:0.85em;}' +
        '.ne-tr-trace{display:none;margin-top:6px;padding:6px;background:var(--black20a);border-radius:4px;font-family:monospace;font-size:0.75em;white-space:pre-wrap;max-height:300px;overflow-y:auto;}' +
        '.ne-tr-trace.open{display:block;}' +
        '.ne-tr-export-bar{display:flex;gap:4px;margin-top:6px;}' +
        '.narrative_ltm_toggle{display:inline-block;transition:transform .2s;font-size:0.7em;color:var(--grey-50);cursor:pointer;}' +
        '.narrative_ltm_toggle.expanded{transform:rotate(90deg);}' +
        '.narrative_ltm_detail{display:none;}' +
        '.narrative_ltm_detail.expanded{display:table-row!important;}' +
        '.narrative_ltm_detail .narrative_ltm_detail_container{border-left:3px solid transparent;padding-left:8px;transition:border-color .2s;}' +
        '.narrative_ltm_detail.expanded .narrative_ltm_detail_container{border-left-color:var(--SmartThemeBorderColor);}' +
        '.narrative_ltm_sub_table{width:100%;border-collapse:collapse;font-size:0.85em;margin:4px 0;}' +
        '.narrative_ltm_sub_table tr:nth-child(even){background:var(--black10a);}' +
        '.narrative_ltm_sub_table td{padding:2px 6px;}' +
        '.ne-inline-edit-btn{font-size:0.75em;cursor:pointer;opacity:0.4;padding:0 3px;transition:opacity .15s;}' +
        '.ne-inline-edit-btn:hover{opacity:1;}' +
        '.ne-inline-row td{padding:2px 4px!important;}' +
        '.ne-inline-row input,.ne-inline-row textarea{width:100%;background:#fff;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:3px 6px;border-radius:3px;font-size:0.85em;font-family:inherit;text-shadow:none !important;}' +
        '.ne-inline-save,.ne-inline-cancel,.ne-inline-delete{font-size:0.75em;padding:1px 6px;cursor:pointer;border-radius:3px;margin:0 2px;}' +
        '.ne-inline-save{background:#4caf50;color:#fff;border:none;}' +
        '.ne-settings-section{margin-bottom:8px;}' +
        '#tab-settings .ne-accordion-body{padding:8px 12px;}' +
        '#tab-settings label{display:block;padding:6px 0;font-size:0.9em;color:var(--text);cursor:pointer;}' +
        '#tab-settings input[type=text],#tab-settings input[type=password],#tab-settings input[type=number]{width:100%;background:#fff;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:6px 10px;border-radius:4px;margin:2px 0 8px;font-size:0.9em;text-shadow:none !important;}' +
        '#tab-settings textarea{width:100%;background:#fff;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:6px 10px;border-radius:4px;margin:2px 0 8px;font-family:monospace;font-size:0.8em;resize:vertical;text-shadow:none !important;}' +
        '#tab-settings input[type=range]{width:100%;margin:4px 0;}' +
        '#tab-settings .range-val{font-size:0.8em;color:var(--grey-50);margin-left:6px;}' +
        '.ne-settings-save-btn{margin-top:12px;padding:8px 24px;background:var(--black50a);color:var(--text);border:1px solid var(--SmartThemeBorderColor);border-radius:4px;cursor:pointer;font-size:0.95em;}' +
        '.ne-settings-save-btn:hover{background:var(--black70a);}' +
        '.ne-settings-cascade{margin-left:16px;padding-left:8px;border-left:2px solid var(--black30a);}' +
        '.ne-inline-state-edit-btn{margin-left:6px;font-size:0.75em;cursor:pointer;opacity:0.5;transition:opacity .15s;}' +
        '.ne-inline-state-edit-btn:hover{opacity:1;}' +
        '.ne-inline-state-edit-area{display:none;margin-top:6px;}' +
        '.ne-inline-state-edit-area.active{display:block;}' +
        '.ne-inline-state-edit-area textarea{width:100%;min-height:120px;background:#fff;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:0.85em;text-shadow:none !important;}' +
        '.ne-inline-state-view.hidden{display:none;}' +
        '.ne-tool-card{background:var(--black20a);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px 12px;margin-bottom:8px;}' +
        '.ne-tool-card-title{font-weight:bold;font-size:0.85em;color:var(--grey-70);margin-bottom:8px;}' +
        '.ne-btn-warning{background:rgba(255,152,0,.12)!important;border-color:rgba(255,152,0,.3)!important;color:#ff9800!important;}' +
        '.ne-btn-danger{background:rgba(244,67,54,.12)!important;border-color:rgba(244,67,54,.3)!important;color:#f44336!important;}' +
        '.ne-injection-preview{font-size:0.82em;color:var(--text);white-space:pre-wrap;max-height:200px;overflow-y:auto;background:var(--black30a);padding:6px 8px;border-radius:4px;font-family:monospace;line-height:1.4;}' +
        '.ne-injection-meta{font-size:0.75em;color:var(--grey-50);margin-bottom:4px;}' +
        '.ne-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;}' +
        '.ne-settings-grid>.ne-settings-full{grid-column:1/-1;}' +
        '.ne-settings-cascade-card{background:var(--black10a);border-left:3px solid var(--SmartThemeBorderColor);border-radius:0 4px 4px 0;padding:4px 8px;margin-left:12px;margin-top:4px;}' +
        '.ne-settings-toggle-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;padding:6px 8px;background:var(--black10a);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;margin:4px 0 6px;}' +
        '.ne-settings-toggle-grid label{padding:3px 0 !important;font-size:0.85em !important;}' +
        '.ne-api-status{display:flex;align-items:center;gap:6px;margin:4px 0;font-size:0.85em;}' +
        '.ne-api-dot{width:10px;height:10px;border-radius:50%;display:inline-block;background:#cc3333;}' +
        '.ne-api-dot.ok{background:#4caf50;}' +
        '.ne-api-btn{padding:4px 10px;margin:4px 4px 0 0;cursor:pointer;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--SmartThemeBodyColor);font-size:0.8em;}' +
        '.ne-api-btn:disabled{opacity:0.4;cursor:not-allowed;}' +
        '.ne-settings-section-card{background:var(--black20a);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px 12px;margin-bottom:8px;}' +
        '.ne-settings-section-card .ne-settings-section-title{font-weight:bold;font-size:0.85em;color:var(--grey-70);margin-bottom:8px;display:flex;align-items:center;gap:4px;}' +
        '.ne-settings-section-card .ne-accordion-body{padding:4px 0 0 0;}' +
        '.ne-status-dot{font-size:0.7em;margin-left:4px;}';
    pdHead().appendChild(style);
}

var vaultLLMLog = [];
var lastVaultStateJson = '{}';

/* ──────── 底部抽屉辅助函数 ──────── */

var _currentCollapseState = {};
var _currentChatIdForCollapse = null;

function saveCollapseState(chatId) {
    var state = {};
    qsa('#tab-memory .ne-accordion').forEach(function(acc) {
        if (acc.id) state[acc.id] = acc.classList.contains('open');
    });
    try { var k = 'ne_collapse_' + (chatId || _currentChatIdForCollapse || 'global');
        if (chatId || _currentChatIdForCollapse) localStorage.setItem(k, JSON.stringify(state)); 
    } catch(e) {}
}

function loadCollapseState(chatId) {
    try {
        var k = 'ne_collapse_' + (chatId || 'global');
        var raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
}

function navigateToAccordion(accId, chatId) {
    var target = byId(accId);
    if (!target) return;
    var parent = target.parentElement;
    while (parent) {
        if (parent.classList.contains('ne-accordion') && !parent.classList.contains('open')) {
            parent.classList.add('open');
        }
        parent = parent.parentElement;
    }
    target.classList.add('open');
    saveCollapseState(chatId);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('ne-accordion-highlight');
    setTimeout(function() { target.classList.remove('ne-accordion-highlight'); }, 1500);
}

var _lazyRendered = {};
function setupAccordionHandlers(chatId) {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay || overlay._neAccDel) return;
    overlay._neAccDel = true;
    overlay.addEventListener('click', function(e) {
        var header = e.target.closest('.ne-vault-tab-content .ne-accordion-header');
        if (!header) return;
        var acc = header.closest('.ne-accordion');
        if (!acc) return;
        acc.classList.toggle('open');
        if (acc.closest('#tab-memory')) saveCollapseState(chatId);
        if (acc.classList.contains('open') && acc.id && !_lazyRendered[acc.id]) {
            _lazyRendered[acc.id] = true;
            if (acc.id === 'ne-tool-llm-log') renderLLMLog();
            else if (acc.id === 'ne-tool-tool-log') renderToolCallLog();
            else if (acc.id === 'ne-tool-history') renderHistory(_currentGetChatId);
        }
    });
}

function renderQuickIndex(stmCount, ltmCount, charCount, questCount, factionCount, hasState, chatId) {
    var idx = byId('ne_quick_index');
    if (!idx) return;
    var html = '';
    var addItem = function(id, label, count, show) {
        if (show === undefined) show = count > 0;
        if (!show) return;
        html += '<span class="ne-index-item" data-target="' + id + '">' + label + (count !== null ? ' <em>' + count + '</em>' : '') + '</span>';
    };
    addItem('ne-acc-stm', 'STM', stmCount, true);
    addItem('ne-acc-ltm', 'LTM', ltmCount, true);
    addItem('ne-acc-global', '全局', null, hasState);
    addItem('ne-acc-characters', '角色', charCount, true);
    addItem('ne-acc-quests', '任务', questCount, true);
    addItem('ne-acc-factions', '势力', factionCount, true);
    idx.innerHTML = html;
    qsa('.ne-index-item').forEach(function(item) {
        item.onclick = function() {
            navigateToAccordion(this.getAttribute('data-target'), chatId);
        };
    });
}

function setupTabSwitching() {
    qsa('.ne-vault-tab').forEach(function(tab) {
        tab.onclick = function() {
            var tabName = this.getAttribute('data-tab');
            qsa('.ne-vault-tab').forEach(function(t) { t.classList.remove('active'); });
            this.classList.add('active');
            qsa('.ne-vault-tab-content').forEach(function(c) { c.classList.remove('active'); });
            var content = byId('tab-' + tabName);
            if (content) content.classList.add('active');
        };
    });
}

var _pendingInlineStorage = null;

function saveSingleEntry(entryType, entryId, updates) {
    var stored = _pendingInlineStorage;
    if (!stored || !stored.vault) return;
    var vault = stored.vault;
    var getChatId = stored.getChatId;
    var c = vault.content || {};
    var list;
    if (entryType === 'stm') list = c.unconsolidated_stm || [];
    else list = c.ltm_entries || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === entryId) {
            Object.keys(updates).forEach(function(k) { list[i][k] = updates[k]; });
            break;
        }
    }
    if (entryType === 'ltm') {
        var stmList = c.stm_entries || [];
        for (var j = 0; j < stmList.length; j++) {
            if (stmList[j].id === entryId) {
                Object.keys(updates).forEach(function(k) { stmList[j][k] = updates[k]; });
                break;
            }
        }
    }
    write(getChatId(), vault).then(function() {});
}

function deleteSingleEntry(entryType, entryId) {
    var stored = _pendingInlineStorage;
    if (!stored || !stored.vault) return;
    var vault = stored.vault;
    var getChatId = stored.getChatId;
    var c = vault.content || {};
    var targetList = (entryType === 'stm')
        ? (c.unconsolidated_stm || [])
        : (c.ltm_entries || []);
    var targetEntry = targetList.find(function(e) { return e.id === entryId; });
    if (targetEntry && targetEntry.msg_ids) {
        var processed = c.processed_msg_ids || {};
        targetEntry.msg_ids.forEach(function(mid) { delete processed[mid]; });
    }
    if (entryType === 'stm') {
        c.unconsolidated_stm = (c.unconsolidated_stm || []).filter(function(e) { return e.id !== entryId; });
    } else {
        c.ltm_entries = (c.ltm_entries || []).filter(function(e) { return e.id !== entryId; });
        c.stm_entries = (c.stm_entries || []).filter(function(e) { return e.id !== entryId; });
    }
    write(getChatId(), vault).then(function() {});
}

function closeVaultOverlay() {
    var overlay = byId('ne_vault_bottom_overlay');
    if (overlay) overlay.classList.remove('open');
    var chat = byId('chat');
    if (chat) chat.style.display = '';
}

function renderMemoryButton(getChatId) {
    if (byId('ne_memory_button')) return;
    var leftSend = byId('leftSendForm');
    if (!leftSend) return;
    var btn = pdCreate('div');
    btn.id = 'ne_memory_button';
    btn.className = 'fa-solid fa-book-bookmark interactable';
    btn.title = t('Memory Vault');
    btn.style.fontSize = 'var(--bottomFormIconSize)';
    btn.onclick = function () { createVaultPopout(getChatId); };
    var extBtn = byId('extensionsMenuButton');
    if (extBtn) {
        extBtn.insertAdjacentElement('afterend', btn);
    } else {
        var optBtn = byId('options_button');
        if (optBtn) optBtn.insertAdjacentElement('afterend', btn);
        else leftSend.appendChild(btn);
    }
}

/* ──────── 面板切换 ──────── */

function createVaultPopout(getChatId) {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay) return;
    var opening = !overlay.classList.contains('open');
    var chat = byId('chat');
    if (opening) {
        if (chat) chat.style.display = 'none';
        overlay.classList.add('open');
        updateVaultViewerPopout(getChatId);
        renderInjectionPreview();
        renderSettingsTab();
    } else {
        overlay.classList.remove('open');
        if (chat) chat.style.display = '';
    }
}

export function toggleVaultPanel(getChatId) { createVaultPopout(getChatId); }
export { closeVaultOverlay };

/* ──────── 角色卡面板渲染 ──────── */

var ACTIVE_STATUSES = ['活跃'];
var DEPARTED_STATUSES = ['已死亡', '已归隐', '已离去'];

function getCharacterCardType(name, state) {
    var npcNames = state && state.npc_names;
    if (npcNames && Array.isArray(npcNames) && npcNames.indexOf(name) !== -1) return 'npc';
    // 默认 NPC：如果不存在明确的主控角色标记，不应滥发 PC 标签
    return 'npc';
}

function renderCharacterCard(name, card, schema, cardType) {
    var cardSchema = schema[cardType] || schema.npc;
    var fields = cardSchema.fields || {};
    var summaryLines = [];
    var detailLines = [];

    Object.keys(fields).forEach(function (key) {
        var fieldDef = fields[key];
        var val = card[key];
        if (val === undefined || val === null || val === '') return;
        if (key === 'status') return;
        if (key === 'name') return; // 名字已在卡片标题显示，不重复

        var displayVal;
        if (key === 'clothing_build' && card.clothing_mode === true) {
            displayVal = String(val).substring(0, 30) + '...';
        } else if (typeof val === 'object') {
            // power_slots 等对象类型 → JSON 序列化
            try { displayVal = JSON.stringify(val); } catch (e) { displayVal = String(val); }
            if (displayVal.length > 50) displayVal = displayVal.substring(0, 50);
        } else {
            displayVal = String(val).substring(0, 50);
        }

        if (fieldDef.expose_level === 'summary') {
            summaryLines.push(t_field(key) + ': ' + displayVal);
        } else if (fieldDef.expose_level === 'detail') {
            detailLines.push(t_field(key) + ': ' + escapeHtml(String(val)));
        }
    });

    // Virtual equipment: filter inventory items where equipped===true
    var equipmentHtml = '';
    var inventory = card.inventory;
    if (inventory && typeof inventory === 'object' && Array.isArray(inventory.items)) {
        var equipped = inventory.items.filter(function (item) { return item && item.equipped === true; });
        if (equipped.length > 0) {
            equipmentHtml = '<div style="margin-top:3px;font-size:0.85em;color:#e2b714;">' + t_field('equipment') + ': ';
            equipped.forEach(function (item) {
                equipmentHtml += escapeHtml(item.name || '?') + (item.qty && item.qty > 1 ? '\u00D7' + item.qty : '') + ' ';
            });
            equipmentHtml += '</div>';
        }
    }

    // Injuries / status_effects
    if (card.injuries) {
        detailLines.push(t_field('injuries') + ': ' + escapeHtml(String(card.injuries)));
    }
    if (card.status_effects) {
        detailLines.push(t_field('status_effects') + ': ' + escapeHtml(String(card.status_effects)));
    }

    // Inventory detail
    var invMode = card.inventory_mode || '关闭';
    if (invMode !== '关闭' && inventory && Array.isArray(inventory.items)) {
        var invLines = [];
        var allItems = inventory.items.filter(function (item) { return item && !item.equipped; });
        allItems.forEach(function (item) {
            invLines.push(escapeHtml(item.name || '?') + (item.qty && item.qty > 1 ? '\u00D7' + item.qty : ''));
        });
        if (invLines.length > 0 || (inventory.gold != null)) {
            var invHtml = '<div style="margin-top:2px;font-size:0.85em;">Inventory' + (invMode === '静态' ? ' (static)' : '') + ': ';
            if (inventory.gold != null) invHtml += escapeHtml(String(inventory.gold)) + 'G ';
            invHtml += invLines.join(', ') + '</div>';
            detailLines.push(invHtml);
        }
    }

    var powerSlotDefs = card.power_slot_defs;
    var powerSlotValues = card.power_slots;
    var powerSlotBar = '';
    if (powerSlotDefs && Array.isArray(powerSlotDefs) && powerSlotDefs.length > 0) {
        var slotParts = [];
        powerSlotDefs.forEach(function (def) {
            var val = (powerSlotValues && typeof powerSlotValues === 'object' && powerSlotValues[def.key]) || '-';
            slotParts.push(escapeHtml(String(def.label)) + ': ' + escapeHtml(String(val)));
        });
        if (slotParts.length > 0) {
            powerSlotBar = '<div style="margin-top:3px;font-size:0.85em;color:#e2b714;padding:3px 6px;background:var(--black20a);border-radius:3px;">' + slotParts.join(' | ') + '</div>';
        }
    }

    var cardId = 'ne_char_' + name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var statusLabel = card.status || '未知';

    var html = '<div class="ne_character_card" style="margin:4px 0;padding:6px 8px;background:var(--black30a);border-radius:4px;cursor:pointer;">' +
        '<div class="ne_char_header" data-card-id="' + cardId + '" style="display:flex;align-items:center;gap:6px;">' +
        '<span class="ne_char_toggle" style="font-size:0.8em;">\u25B6</span>' +
        '<b>' + escapeHtml(name) + '</b>' +
        '<span style="font-size:0.8em;color:var(--grey70);">[' + statusLabel + ']</span>' +
        '<span style="font-size:0.75em;color:var(--grey50);">' + (cardType === 'npc' ? 'NPC' : 'PC') + '</span>' +
        '</div>' +
        '<div class="ne_char_summary" style="font-size:0.85em;margin-top:3px;color:#ccc;">' + summaryLines.join(' | ') + '</div>' +
        powerSlotBar +
        equipmentHtml +
        '<div class="ne_char_detail" id="' + cardId + '_detail" style="display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;">' +
        detailLines.map(function (l) { return '<div style="margin:2px 0;">' + l + '</div>'; }).join('') +
        '</div>' +
        '</div>';

    return html;
}

function renderCharacterGroup(label, names, characters, schema, state) {
    if (names.length === 0) return '';
    var groupId = 'ne_char_group_' + label.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var headerColor = label === '活跃' ? '#4caf50' : (label === '已退场' ? '#f44336' : '#ff9800');

    var html = '<div class="ne_character_group" style="margin:6px 0;">' +
        '<div class="ne_group_header" data-group-id="' + groupId + '" style="font-weight:bold;font-size:0.9em;color:' + headerColor + ';cursor:pointer;padding:3px 0;border-bottom:1px solid var(--black30a);">' +
        '<span class="ne_group_toggle">\u25BC</span> ' + t(label) + ' (' + names.length + ')' +
        '</div>' +
        '<div class="ne_group_cards" id="' + groupId + '_cards">';

    names.forEach(function (name) {
        var card = characters[name];
        var cardType = getCharacterCardType(name, state);
        html += renderCharacterCard(name, card, schema, cardType);
    });

    html += '</div></div>';
    return html;
}

function getCharacterSchemaForPanel(content) {
    if (isDynamicStateMode() && content.dynamic_state) {
        return buildDynamicCharacterSchema(content.dynamic_state) || DEFAULT_CHARACTER_SCHEMA;
    }
    return content.character_schema || DEFAULT_CHARACTER_SCHEMA;
}

function renderCharacterPanelHTML(state, characterSchema) {
    var characters = (state && state.characters) ? state.characters : {};
    var schema = characterSchema || DEFAULT_CHARACTER_SCHEMA;
    var names = Object.keys(characters);
    if (names.length === 0) return '';

    var activeNames = [];
    var inactiveNames = [];
    var departedNames = [];

    names.forEach(function (name) {
        var card = characters[name];
        var status = (card && card.status) ? card.status : '未知';
        if (ACTIVE_STATUSES.indexOf(status) !== -1) {
            activeNames.push(name);
        } else if (DEPARTED_STATUSES.indexOf(status) !== -1) {
            departedNames.push(name);
        } else {
            inactiveNames.push(name);
        }
    });

    var html = '<div class="narrative_character_block" style="margin-bottom:14px;">' +
        '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Characters') + '</div>';

    html += renderCharacterGroup('活跃', activeNames, characters, schema, state);
    html += renderCharacterGroup('非活跃', inactiveNames, characters, schema, state);
    html += renderCharacterGroup('已退场', departedNames, characters, schema, state);

    html += '</div>';
    return html;
}

function renderFactionCard(name, faction) {
    var cardId = 'ne_faction_' + name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var attitude = faction.attitude_toward_player || '未知';
    var attitudeColor = attitude === '友好' ? '#4caf50' : (attitude === '敌对' ? '#f44336' : (attitude === '冷淡' ? '#ff9800' : '#ff9800'));

    var summaryFields = [];
    if (faction.name) summaryFields.push(t_field('name') + ': ' + escapeHtml(String(faction.name).substring(0, 20)));
    var displayAttitude = faction.attitude_toward_player || '未知';
    summaryFields.push(t_field('attitude_toward_player') + ': <span style="color:' + attitudeColor + '">' + escapeHtml(displayAttitude) + '</span>');

    var detailLines = [];
    if (faction.description) detailLines.push('<div style="margin:2px 0;">' + t_field('description') + ': ' + escapeHtml(String(faction.description)) + '</div>');
    if (faction.leader) detailLines.push('<div style="margin:2px 0;">' + t_field('leader') + ': ' + escapeHtml(String(faction.leader)) + '</div>');
    if (faction.notes) detailLines.push('<div style="margin:2px 0;">' + t_field('notes') + ': ' + escapeHtml(String(faction.notes)) + '</div>');

    var relations = faction.relations;
    if (relations && typeof relations === 'object') {
        var relKeys = Object.keys(relations);
        if (relKeys.length > 0) {
            var relHtml = '<div style="margin-top:4px;font-size:0.83em;color:#e2b714;">' + t('Relations') + ':</div>';
            relKeys.forEach(function (target) {
                relHtml += '<div style="margin:1px 0 1px 8px;font-size:0.83em;">' + escapeHtml(target) + ': ' + escapeHtml(String(relations[target])) + '</div>';
            });
            detailLines.push(relHtml);
        }
    }

    var html = '<div class="ne_faction_card" style="margin:4px 0;padding:6px 8px;background:var(--black30a);border-radius:4px;cursor:pointer;">' +
        '<div class="ne_faction_header" data-card-id="' + cardId + '" style="display:flex;align-items:center;gap:6px;">' +
        '<span class="ne_faction_toggle" style="font-size:0.8em;">\u25B6</span>' +
        '<b>' + escapeHtml(name) + '</b>' +
        '<span style="font-size:0.8em;color:' + attitudeColor + ';">[' + escapeHtml(attitude) + ']</span>' +
        '</div>' +
        '<div class="ne_faction_summary" style="font-size:0.85em;margin-top:3px;color:#ccc;">' + summaryFields.join(' | ') + '</div>' +
        '<div class="ne_faction_detail" id="' + cardId + '_detail" style="display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;">' +
        detailLines.join('') +
        '</div>' +
        '</div>';

    return html;
}

function renderFactionPanelHTML(state) {
    if (!state || !state.factions) return '';
    var factions = state.factions;
    var names = Object.keys(factions);
    if (names.length === 0) return '';

    var html = '<div class="narrative_faction_block" style="margin-bottom:14px;">' +
        '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Factions') + '</div>';

    names.forEach(function (name) {
        var faction = factions[name];
        if (!faction || typeof faction !== 'object') return;
        html += renderFactionCard(name, faction);
    });

    html += '</div>';
    return html;
}

function formatActiveFactionSummary(state) {
    if (!state || !state.factions) return '';
    var factions = state.factions;
    var names = Object.keys(factions);
    if (names.length === 0) return '';

    var lines = [];
    names.forEach(function (name) {
        var faction = factions[name];
        if (!faction || typeof faction !== 'object') return;
        if (faction.attitude_toward_player === '中立') return;
        var parts = [];
        parts.push(name);
        if (faction.attitude_toward_player) parts.push(faction.attitude_toward_player);
        if (faction.leader) parts.push('leader=' + String(faction.leader).substring(0, 20));
        if (faction.description) parts.push(String(faction.description).substring(0, 40));
        if (faction.relations && typeof faction.relations === 'object') {
            var relPairs = [];
            Object.keys(faction.relations).forEach(function (target) {
                relPairs.push(target + ':' + String(faction.relations[target]).substring(0, 20));
            });
            if (relPairs.length > 0) parts.push('relations={' + relPairs.join(', ') + '}');
        }
        lines.push(parts.join(' | '));
    });

    return lines.length > 0 ? lines.join('\n') : '';
}

function renderQuestCard(key, entry, sectionType) {
    var cardId = 'ne_quest_' + sectionType + '_' + key.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var statusLabel = entry.status || '未知';

    var statusColors = { '已完成': '#4caf50', '已达成': '#4caf50', '已失败': '#f44336', '已过期': '#ff9800', '正在进行': '#2196f3', '进行中': '#2196f3', '已放弃': '#888', '持续中': '#ff9800', '已平息': '#4caf50', '已结束': '#888' };
    var statusColor = statusColors[statusLabel] || '#888';

    var iconMap = {
        task: { open: '\u25CB', closed: '\u2714' },
        goal: { open: '\u2192', closed: '\u2714' },
        event: { open: '\u25B2', closed: '\u2714' }
    };
    var icons = iconMap[sectionType] || iconMap.task;
    var isCompleted = statusLabel === '已完成' || statusLabel === '已达成' || statusLabel === '已放弃' || statusLabel === '已失败' || statusLabel === '已过期' || statusLabel === '已平息' || statusLabel === '已结束';
    var iconChar = isCompleted ? icons.closed : icons.open;
    var iconColor = isCompleted ? '#4caf50' : '#888';

    var displayName = entry.name || key;
    var deadlineOrStatus = '';
    if (sectionType === 'task' && entry.deadline) {
        deadlineOrStatus = entry.deadline;
    }
    var statusText = sectionType === 'task' ? (entry.deadline || statusLabel) : statusLabel;

    var detailLines = [];
    if (sectionType === 'task') {
        if (entry.type) detailLines.push('<div style="margin:2px 0;">' + t_field('type') + ': ' + escapeHtml(String(entry.type)) + '</div>');
        if (entry.issuer) detailLines.push('<div style="margin:2px 0;">' + t_field('issuer') + ': ' + escapeHtml(String(entry.issuer)) + '</div>');
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">' + t_field('desc') + ': ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.progress) detailLines.push('<div style="margin:2px 0;color:#e2b714;">' + t_field('progress') + ': ' + escapeHtml(String(entry.progress)) + '</div>');
        if (entry.posted_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">' + t_field('posted_time') + ': ' + escapeHtml(String(entry.posted_time)) + '</div>');
        if (entry.reward) detailLines.push('<div style="margin:2px 0;color:#4caf50;">' + t_field('reward') + ': ' + escapeHtml(String(entry.reward)) + '</div>');
        if (entry.penalty) detailLines.push('<div style="margin:2px 0;color:#f44336;">' + t_field('penalty') + ': ' + escapeHtml(String(entry.penalty)) + '</div>');
    } else if (sectionType === 'goal') {
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">' + t_field('desc') + ': ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.progress) detailLines.push('<div style="margin:2px 0;color:#e2b714;">' + t_field('progress') + ': ' + escapeHtml(String(entry.progress)) + '</div>');
        if (entry.posted_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">' + t_field('posted_time') + ': ' + escapeHtml(String(entry.posted_time)) + '</div>');
        if (entry.completed_time) detailLines.push('<div style="margin:2px 0;color:#4caf50;">' + t_field('completed_time') + ': ' + escapeHtml(String(entry.completed_time)) + '</div>');
    } else if (sectionType === 'event') {
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">' + t_field('desc') + ': ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.started_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">' + t_field('started_time') + ': ' + escapeHtml(String(entry.started_time)) + '</div>');
        if (entry.ended_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">' + t_field('ended_time') + ': ' + escapeHtml(String(entry.ended_time)) + '</div>');
    }

    var html = '<div class="ne_quest_card" style="margin:4px 0;padding:6px 8px;background:var(--black30a);border-radius:4px;cursor:pointer;">' +
        '<div class="ne_quest_header" data-card-id="' + cardId + '" style="display:flex;align-items:center;gap:6px;">' +
        '<span class="ne_quest_toggle" style="font-size:0.8em;">\u25B6</span>' +
        '<span style="color:' + iconColor + ';">' + iconChar + '</span>' +
        '<b>' + escapeHtml(displayName) + '</b>' +
        '<span style="font-size:0.8em;color:' + statusColor + ';">[' + escapeHtml(statusText) + ']</span>' +
        '</div>' +
        '<div class="ne_quest_detail" id="' + cardId + '_detail" style="display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;">' +
        detailLines.join('') +
        '</div>' +
        '</div>';

    return html;
}

function renderQuestPanelHTML(state) {
    if (!state || !state.quests) return '';
    var quests = state.quests;

    var sectionsHtml = '';

    // Tasks
    if (quests.tasks && typeof quests.tasks === 'object' && Object.keys(quests.tasks).length > 0) {
        var taskHtml = '<div class="ne_quest_subsection" style="margin:8px 0;">' +
            '<div style="font-weight:bold;font-size:0.9em;color:#2196f3;padding:3px 0;border-bottom:1px solid var(--black30a);">\u25CB ' + t('Tasks') + '</div>';
        Object.keys(quests.tasks).forEach(function (key) {
            taskHtml += renderQuestCard(key, quests.tasks[key], 'task');
        });
        taskHtml += '</div>';
        sectionsHtml += taskHtml;
    }

    // Goals
    if (quests.goals && typeof quests.goals === 'object' && Object.keys(quests.goals).length > 0) {
        var goalHtml = '<div class="ne_quest_subsection" style="margin:8px 0;">' +
            '<div style="font-weight:bold;font-size:0.9em;color:#e2b714;padding:3px 0;border-bottom:1px solid var(--black30a);">\u2192 ' + t('Goals') + '</div>';
        Object.keys(quests.goals).forEach(function (key) {
            goalHtml += renderQuestCard(key, quests.goals[key], 'goal');
        });
        goalHtml += '</div>';
        sectionsHtml += goalHtml;
    }

    // Events
    if (quests.events && typeof quests.events === 'object' && Object.keys(quests.events).length > 0) {
        var eventHtml = '<div class="ne_quest_subsection" style="margin:8px 0;">' +
            '<div style="font-weight:bold;font-size:0.9em;color:#ff9800;padding:3px 0;border-bottom:1px solid var(--black30a);">\u25B2 ' + t('World Events') + '</div>';
        Object.keys(quests.events).forEach(function (key) {
            eventHtml += renderQuestCard(key, quests.events[key], 'event');
        });
        eventHtml += '</div>';
        sectionsHtml += eventHtml;
    }

    if (!sectionsHtml) return '';

    return '<div class="narrative_quest_block" style="margin-bottom:14px;">' +
        '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Quests') + '</div>' +
        sectionsHtml +
        '</div>';
}

/* ──────── 面板内容渲染 ──────── */

var _updatingPopout = false;

async function updateVaultViewerPopout(getChatId) {
    if (_updatingPopout) return;
    if (typeof getChatId !== 'function') {
        console.error('[NE-VAULT] updateVaultViewerPopout called with non-function getChatId (type=' + typeof getChatId + ')', getChatId);
        return;
    }
    console.log('[NE-VAULT] updateVaultViewerPopout start ts=' + Date.now());
    _updatingPopout = true;
    var loading = byId('narrative_vault_loading');
    var errDiv = byId('narrative_vault_panel_error');
    if (loading) loading.style.display = '';
    if (errDiv) errDiv.style.display = 'none';
    var warnDiv = byId('narrative_vault_panel_storage_warn');
    if (warnDiv) {
        if (isStorageBlocked()) {
            warnDiv.textContent = t('Storage blocked: Memories cannot be saved. Disable tracking prevention for this site in your browser settings.');
            warnDiv.style.display = '';
        } else {
            warnDiv.style.display = 'none';
        }
    }

    function _logSection(name, e) {
        console.error('[NE-VAULT] Section [' + name + '] failed:', e);
        console.error('[NE-VAULT] Stack:', e.stack);
    }

    var vault, c;
    try {
        vault = await read(getChatId());
        c = vault.content || {};
        _pendingInlineStorage = { vault: vault, getChatId: getChatId };
        lastVaultStateJson = c.state ? JSON.stringify(c.state, null, 2) : '{}';
    } catch (e) {
        _logSection('read-vault', e);
        if (errDiv) { errDiv.textContent = t('Failed to load vault:') + ' ' + e.message; errDiv.style.display = ''; }
        if (loading) loading.style.display = 'none';
        _updatingPopout = false;
        return;
    }

    // ── Section A: Header (version + API status) ──
    try {
        var verEl = byId('narrative_vault_panel_version');
        if (verEl) {
            var verText = t('Version:') + ' ' + (vault.version || 0);
            var ts = formatLocalTime(vault.updated_at);
            if (ts) verText += ' \u00b7 ' + ts;
            verEl.textContent = verText;
        }
        var apiStatus = byId('narrative_secondary_api_status');
        if (apiStatus) {
            try {
                var raw = localStorage.getItem('ne_secondary_api');
                var secondaryConfig = raw ? JSON.parse(raw) : null;
                if (secondaryConfig && secondaryConfig.url && secondaryConfig.model) {
                    apiStatus.textContent = '\u26A1';
                    apiStatus.title = t('Secondary API:') + ' ' + secondaryConfig.model;
                    apiStatus.style.color = '#4caf50';
                } else {
                    apiStatus.textContent = '';
                    apiStatus.title = t('No secondary API configured');
                }
            } catch (e) { apiStatus.textContent = ''; }
        }
    } catch (e) { _logSection('header', e); }

    var panelBody = verEl ? verEl.parentElement : null;
    if (!panelBody) { if (loading) loading.style.display = 'none'; _updatingPopout = false; return; }

    // 移除旧区块
    qsa('.narrative_state_block').forEach(function (el) { el.remove(); });
    qsa('.narrative_opening_block').forEach(function (el) { el.remove(); });
    qsa('.narrative_faction_block').forEach(function (el) { el.remove(); });
    qsa('.narrative_character_block').forEach(function (el) { el.remove(); });
    qsa('.narrative_quest_block').forEach(function (el) { el.remove(); });

    // ── Section B: State block ──
    try {
        var stateContainer = byId('ne_state_block_container');
        if (stateContainer) {
            var stateHtml = '';
            if (c.state && Object.keys(c.state).length > 0) {
                if (isStateSchemaEnabled()) {
                    stateHtml = formatStateSummary(c.state, c.state_schema || getEffectiveSchema(vault));
                } else {
                    stateHtml = formatCoreStateSummary(c.state);
                }
                stateContainer.innerHTML =
                    '<div class="ne-inline-state-view">' +
                    '<div style="background:var(--black50a);padding:8px;border-radius:4px;font-size:0.9em;white-space:pre-wrap;font-family:monospace;">' + escapeHtml(stateHtml) + '</div>' +
                    '<div style="margin-top:4px;display:flex;gap:4px;align-items:center;">' +
                    '<span class="ne-inline-state-edit-btn fa-solid fa-pen-to-square" title="' + t('Edit State') + '" style="font-size:0.75em;opacity:0.5;cursor:pointer;"></span>' +
                    '<button class="narrative_clear_state_btn menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;color:#f44336;">' + t_narrative('Clear') + '</button>' +
                    '</div></div>' +
                    '<div class="ne-inline-state-edit-area">' +
                    '<textarea id="ne_state_edit_textarea" style="width:100%;min-height:120px;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);color:var(--text);padding:6px 10px;border-radius:4px;font-family:monospace;font-size:0.85em;">' + escapeHtml(JSON.stringify(c.state, null, 2)) + '</textarea>' +
                    '<div style="margin-top:4px;display:flex;gap:4px;">' +
                    '<button class="ne-state-edit-save menu_button" style="font-size:0.85em;padding:2px 8px;background:#4caf50;color:#fff;border:none;">' + t('Save') + '</button>' +
                    '<button class="ne-state-edit-cancel menu_button" style="font-size:0.85em;padding:2px 8px;">' + t('Cancel') + '</button>' +
                    '</div></div>';
            } else {
                stateContainer.innerHTML = '<div style="color:#888;font-size:0.85em;padding:4px 0;">(' + t('No state data') + ')</div>';
            }
        }
    } catch (e) { _logSection('state-block', e); }

    // ── Section C: Character block ──
    try {
        var charContainer = byId('ne_character_block_container');
        if (charContainer && isStateSchemaEnabled()) {
            var charSchema = getCharacterSchemaForPanel(c);
            var charHtml = renderCharacterPanelHTML(c.state || {}, charSchema);
            charContainer.innerHTML = charHtml || '<div style="color:#888;font-size:0.85em;padding:4px 0;">(' + t('No character data') + ')</div>';
        }
    } catch (e) { _logSection('char-block', e); }

    // ── Section D: Faction block ──
    try {
        var factionContainer = byId('ne_faction_block_container');
        if (factionContainer && isStateSchemaEnabled()) {
            var factionHtml = renderFactionPanelHTML(c.state || {});
            factionContainer.innerHTML = factionHtml || '<div style="color:#888;font-size:0.85em;padding:4px 0;">(' + t('No faction data') + ')</div>';
        }
    } catch (e) { _logSection('faction-block', e); }

    // ── Section E: Quest block ──
    try {
        var questContainer = byId('ne_quest_block_container');
        if (questContainer && isStateSchemaEnabled()) {
            var questHtml = renderQuestPanelHTML(c.state || {});
            questContainer.innerHTML = questHtml || '<div style="color:#888;font-size:0.85em;padding:4px 0;">(' + t('No quest data') + ')</div>';
        }
    } catch (e) { _logSection('quest-block', e); }

    // ── Section F: STM index + self-heal ──
    var stmIndexMap = {};
    try {
        var stmEntries = Array.isArray(c.stm_entries) ? c.stm_entries : [];
        var unconsolidatedRaw = Array.isArray(c.unconsolidated_stm) ? c.unconsolidated_stm : [];
        stmEntries.forEach(function (s) { stmIndexMap[s.id] = s; });
        unconsolidatedRaw.forEach(function (s) { stmIndexMap[s.id] = s; });

        var misplacedEntries = unconsolidatedRaw.filter(function (e) { return e.parent_ltm; });
        if (misplacedEntries.length > 0) {
            console.log('[NE] Vault panel: moving ' + misplacedEntries.length + ' consolidated STM entries from unconsolidated_stm to stm_entries');
            c.stm_entries = stmEntries.concat(misplacedEntries);
            c.unconsolidated_stm = unconsolidatedRaw.filter(function (e) { return !e.parent_ltm; });
            await write(getChatId(), vault);
            stmIndexMap = {};
            var stmEntries2 = Array.isArray(c.stm_entries) ? c.stm_entries : [];
            var unconsolidatedRaw2 = Array.isArray(c.unconsolidated_stm) ? c.unconsolidated_stm : [];
            stmEntries2.forEach(function (s) { stmIndexMap[s.id] = s; });
            unconsolidatedRaw2.forEach(function (s) { stmIndexMap[s.id] = s; });
        }
    } catch (e) { _logSection('stm-index+selfheal', e); }

    // ── Section G: Memory table rendering ──
    var unconsolidatedSTM = Array.isArray(c.unconsolidated_stm) ? c.unconsolidated_stm : [];
    var ltmEntries = Array.isArray(c.ltm_entries) ? c.ltm_entries : [];
    var ltmCount = ltmEntries.length;
    var stmCount = unconsolidatedSTM.length;

    try {
        renderMemoryTable('#narrative_vault_panel_ltm_body', ltmEntries, 'ltm', stmIndexMap);
    } catch (e) { _logSection('render-ltm-table', e); }
    try {
        renderMemoryTable('#narrative_vault_panel_stm_body', unconsolidatedSTM, 'stm');
    } catch (e) { _logSection('render-stm-table', e); }

    // ── Section H: Counts + quick index ──
    try {
        var stmCountEl = byId('ne-stm-count');
        if (stmCountEl) stmCountEl.textContent = '\u00B7 ' + stmCount + ' ' + t('entries');
        var ltmCountEl = byId('ne-ltm-count');
        if (ltmCountEl) ltmCountEl.textContent = '\u00B7 ' + ltmCount + ' ' + t('entries');

        var chars = (c.state && c.state.characters) ? c.state.characters : {};
        var charCount = Object.keys(chars).length;
        var factions = (c.state && c.state.factions) ? c.state.factions : {};
        var factionCount = Object.keys(factions).length;
        var quests = (c.state && c.state.quests) ? c.state.quests : {};
        var questCount = (quests.tasks ? Object.keys(quests.tasks).length : 0) + (quests.goals ? Object.keys(quests.goals).length : 0) + (quests.events ? Object.keys(quests.events).length : 0);

        var charCountEl = byId('ne-char-count');
        if (charCountEl) charCountEl.textContent = '\u00B7 ' + charCount;
        var questCountEl = byId('ne-quest-count');
        if (questCountEl) questCountEl.textContent = '\u00B7 ' + questCount;
        var factionCountEl = byId('ne-faction-count');
        if (factionCountEl) factionCountEl.textContent = '\u00B7 ' + factionCount;

        var chatId = getChatId();
        renderQuickIndex(stmCount, ltmCount, charCount, questCount, factionCount, c.state && Object.keys(c.state).length > 0, chatId);
    } catch (e) { _logSection('counts+quickindex', e); }

    // ── Section I: Event handlers ──
    try {
        qsa('.ne-inline-state-edit-btn').forEach(function(btn) {
            btn.onclick = function() {
                qs('.ne-inline-state-view').classList.add('hidden');
                qs('.ne-inline-state-edit-area').classList.add('active');
            };
        });
        qsa('.ne-state-edit-cancel').forEach(function(btn) {
            btn.onclick = function() {
                qs('.ne-inline-state-edit-area').classList.remove('active');
                qs('.ne-inline-state-view').classList.remove('hidden');
            };
        });
        qsa('.ne-state-edit-save').forEach(function(btn) {
            btn.onclick = async function() {
                try {
                    var ta = byId('ne_state_edit_textarea');
                    var json = ta ? JSON.parse(ta.value) : {};
                    c.state = json;
                    await write(getChatId(), vault);
                    await updateVaultViewerPopout(getChatId);
                } catch(e) { alert(t('Invalid JSON') + ': ' + e.message); }
            };
        });

        qsa('.narrative_clear_state_btn').forEach(function (btn) {
            btn.onclick = async function () {
                try {
                    if (confirm(t('Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.'))) {
                        c.state = {};
                        await write(getChatId(), vault);
                        await updateVaultViewerPopout(getChatId);
                    }
                } catch (e) {
                    console.warn('[NE] Clear state failed:', e);
                }
            };
        });
    } catch (e) { _logSection('event-handlers', e); }

    if (loading) loading.style.display = 'none';
    _updatingPopout = false;
}

/* ──────── 表格渲染 ──────── */

function toggleInlineEdit(row, entryId, entryType) {
    if (!row) return;
    var cells = row.querySelectorAll('td');
    if (cells.length < 4) return;
    var origPeriod = (cells[1].textContent || '').trim();
    var origScene = (cells[2].textContent || '').trim();
    // New column layout: [0]No. [1]Period [2]Scene [3]MsgIDs [4]Event [5]Edit
    // Old column layout: [0]No. [1]Period [2]Scene [3]Event [4]Edit
    var hasIdColumn = cells.length > 5;
    var origEvent = (cells[hasIdColumn ? 4 : 3].textContent || '').trim();
    var origIds = hasIdColumn ? (cells[3].textContent || '').trim() : '';
    row.classList.add('ne-inline-row');
    var savedHTML = row.innerHTML;
    row._neOrigHTML = savedHTML;
    row._neOrigPeriod = origPeriod;
    row._neOrigScene = origScene;
    row._neOrigEvent = origEvent;

    function rebindEditBtn(el) {
        var btn = el.querySelector('.ne-inline-edit-btn');
        if (!btn) return;
        btn.onclick = function() {
            var r = this.closest('tr');
            if (!r || r.classList.contains('ne-inline-row')) return;
            var eid = this.getAttribute('data-entry-id');
            var etype = this.getAttribute('data-entry-type');
            toggleInlineEdit(r, eid, etype);
        };
    }

    var idColumnCell = hasIdColumn
        ? '<td style="font-size:0.75em;max-width:180px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(origIds) + '">' + escapeHtml(origIds) + '</td>'
        : '';
    var eventCellTarget = hasIdColumn ? 5 : 4;

    row.innerHTML = '<td style="text-align:center;width:2em;">' + cells[0].innerHTML + '</td>' +
        '<td><input class="ne-inline-period" value="' + escapeHtml(origPeriod) + '"></td>' +
        '<td><input class="ne-inline-scene" value="' + escapeHtml(origScene) + '"></td>' +
        idColumnCell +
        '<td><textarea class="ne-inline-event" rows="2">' + escapeHtml(origEvent) + '</textarea></td>' +
        '<td style="white-space:nowrap;"><button class="ne-inline-save" title="' + t('Save') + '">\u2714</button>' +
        '<button class="ne-inline-cancel" style="background:#f44336;color:#fff;border:none;" title="' + t('Cancel') + '">\u2716</button>' +
        '<button class="ne-inline-delete" style="background:#d32f2f;color:#fff;border:none;margin-left:4px;" title="' + t('Delete') + '">\uD83D\uDDD1</button></td>';
    row.querySelector('.ne-inline-save').onclick = function() {
        var period = row.querySelector('.ne-inline-period').value;
        var scene = row.querySelector('.ne-inline-scene').value;
        var event = row.querySelector('.ne-inline-event').value;
        saveSingleEntry(entryType, entryId, { period: period, scene: scene, event: event });
        row.innerHTML = row._neOrigHTML;
        row.classList.remove('ne-inline-row');
        row.querySelector('td:nth-child(2)').textContent = period;
        row.querySelector('td:nth-child(3)').textContent = scene;
        row.querySelector('td:nth-child(' + eventCellTarget + ')').innerHTML = escapeHtml(event);
        row._neOrigPeriod = period;
        row._neOrigScene = scene;
        row._neOrigEvent = event;
        rebindEditBtn(row);
    };
    row.querySelector('.ne-inline-cancel').onclick = function() {
        row.innerHTML = row._neOrigHTML;
        row.classList.remove('ne-inline-row');
        rebindEditBtn(row);
    };
    row.querySelector('.ne-inline-delete').onclick = function() {
        if (!confirm(t('Delete this entry? This cannot be undone.'))) return;
        deleteSingleEntry(entryType, entryId);
        row.remove();
    };
}

export function renderMemoryTable(tbodyId, entries, type, stmIndexMap) {
    var tbody = qs(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!entries || entries.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">(empty)</td></tr>'; return; }
    entries.forEach(function (entry, i) {
        var periodCell = type === 'ltm' ? (entry.time_range || entry.period || '') : (entry.period || '') + (entry.time_label ? '\u00b7' + entry.time_label : '');
        var idListFull = type === 'ltm'
            ? (entry.stm_refs || []).join(', ')
            : (entry.msg_ids || []).join(', ');
        var idDisplay = '';
        if (type === 'ltm') {
            var refs = entry.stm_refs || [];
            idDisplay = refs.length > 0 ? '#STM ' + refs.join(', ') : '';
        } else {
            var turns = entry.turns || [];
            var msgCount = (entry.msg_ids || []).length;
            if (turns.length >= 2 && msgCount > 0) {
                idDisplay = 'Turn ' + turns[0] + '-' + turns[1] + ' / ' + msgCount + '\u6761';
            } else if (msgCount > 0) {
                idDisplay = msgCount + '\u6761';
            }
        }
        var idListCell = '<td style="font-size:0.85em;max-width:150px;color:#888;" title="' + escapeHtml(idListFull || '') + '">' + escapeHtml(idDisplay || '') + '</td>';
        var entryId = entry.id || (type + '_' + i);
        var toggleBtn = type === 'ltm' ? '<span class="narrative_ltm_toggle" data-ltm-id="' + entryId + '" title="Toggle STM details">\u25B6</span> ' : '';
        tbody.innerHTML += '<tr data-entry-id="' + entryId + '"><td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + periodCell + '</td>' + idListCell + '<td>' + '<div style="font-weight:bold;">' + (entry.title || entry.event || entry.summary || '') + '</div>' + (entry.title && entry.event && entry.event !== entry.title ? '<div style="font-size:0.85em;color:#999;">' + entry.event.substring(0, 120) + '</div>' : '') + '</td><td><span class="ne-inline-edit-btn" data-entry-id="' + entryId + '" data-entry-type="' + type + '" title="Edit">\u270E</span></td></tr>';
        if (type === 'ltm') {
            var detailRows = '';
            var stmRefs = entry.stm_refs || [];
            stmRefs.forEach(function (stmId, si) {
                var stm = stmIndexMap && stmIndexMap[stmId];
                if (stm) {
                    var subPeriod = (stm.period || '') + (stm.time_label ? '\u00b7' + stm.time_label : '');
                    var subTurns = stm.turns || [];
                    var subMsgCount = (stm.msg_ids || []).length;
                    var subMsgDisplay = subTurns.length >= 2 && subMsgCount > 0 ? 'Turn ' + subTurns[0] + '-' + subTurns[1] + ' / ' + subMsgCount : (subMsgCount > 0 ? subMsgCount + '\u6761' : stmId);
                    detailRows += '<tr><td style="text-align:center;color:#888;width:2em;font-size:0.8em;">' + (si + 1) + '</td><td style="white-space:nowrap;font-size:0.8em;max-width:120px;">' + subPeriod + '</td><td style="font-size:0.8em;max-width:100px;">' + (stm.scene || '') + '</td><td style="font-size:0.8em;max-width:150px;color:#888;">' + escapeHtml(subMsgDisplay) + '</td><td style="font-size:0.8em;">' + (stm.event || stm.summary || '') + '</td><td></td></tr>';
                }
            });
            if (detailRows) { tbody.innerHTML += '<tr class="narrative_ltm_detail" data-ltm-parent="' + entryId + '"><td colspan="5"><div class="narrative_ltm_detail_container"><table class="narrative_ltm_sub_table"><tbody>' + detailRows + '</tbody></table></div></td></tr>'; }
        }
    });
    if (type === 'ltm') {
        tbody.querySelectorAll('.narrative_ltm_toggle').forEach(function (el) {
            el.onclick = function () {
                var mainRow = el.closest('tr');
                if (!mainRow) return;
                var detailRow = mainRow.nextElementSibling;
                if (!detailRow || !detailRow.classList.contains('narrative_ltm_detail')) return;
                var expanded = detailRow.classList.contains('expanded');
                if (expanded) {
                    detailRow.classList.remove('expanded');
                    el.classList.remove('expanded');
                } else {
                    detailRow.classList.add('expanded');
                    el.classList.add('expanded');
                }
            };
        });
    }
    // Bind inline edit buttons
    qsa(tbodyId + ' .ne-inline-edit-btn').forEach(function(btn) {
        btn.onclick = function() {
            var row = this.closest('tr');
            if (!row || row.classList.contains('ne-inline-row')) return;
            var entryId = this.getAttribute('data-entry-id');
            var entryType = this.getAttribute('data-entry-type');
            toggleInlineEdit(row, entryId, entryType);
        };
    });
}

/* ──────── 注入格式化 ──────── */

export async function formatVaultForPrompt(vault, chatMessages) {
    var content = vault.content || {};
    var parts = [];
    if (vault.memory_system_prompt) { parts.push(vault.memory_system_prompt); parts.push('---'); }
    if (content.story_time || content.story_scene) {
        var merged = (content.story_time || '') + (content.story_date ? ' ─ ' + content.story_date : '');
        parts.push('## ' + t('Current Scene') + '\n' + (merged ? merged + ' · ' : '') + (content.story_scene || ''));
        parts.push('---');
    }
    if (content.state && Object.keys(content.state).length > 0) {
        if (isStateSchemaEnabled()) {
            var stateSchema = content.state_schema || null;
            var stateSummary = formatStateSummary(content.state, stateSchema);
            if (stateSummary) {
                parts.push('## ' + t('Current State') + '\n' + stateSummary);
                parts.push('---');
            }
            var charSchema = isDynamicStateMode() && content.dynamic_state
                ? buildDynamicCharacterSchema(content.dynamic_state)
                : (content.character_schema || null);
            var charSummary = formatActiveCharacterSummary(content.state, charSchema);
            if (charSummary) {
                parts.push('## ' + t_narrative('Characters') + ' (' + t_narrative('Active') + ')\n' + charSummary);
                parts.push('---');
            }
            var factionSummary = formatActiveFactionSummary(content.state);
            if (factionSummary) {
                parts.push('## ' + t('Factions') + '\n' + factionSummary);
                parts.push('---');
            }
            var questSummary = formatQuestSummary(content.state);
            if (questSummary) {
                parts.push('## ' + t('Quests') + '\n' + questSummary);
                parts.push('---');
            }
        }
    }

    // BM25 pre-filter: LTM + unconsolidated STM only (never stm_entries with parent_ltm)
    var ltm = content.ltm_entries || [];
    var unconsolidated = (content.unconsolidated_stm || []).filter(function (e) { return !e.parent_ltm; });
    var showLtm = ltm;
    var showStm = unconsolidated;

    if ((ltm.length > 0 || unconsolidated.length > 0) && typeof filterCandidates === 'function') {
        try {
            var query;
            if (chatMessages && chatMessages.length > 0) {
                var userMessages = [];
                for (var mi = chatMessages.length - 1; mi >= 0 && userMessages.length < 5; mi--) {
                    var m = chatMessages[mi];
                    if (m && (m.role === 'user' || m.is_user)) {
                        var text = typeof m.mes === 'string' ? m.mes : (m.content || '');
                        if (text && text.trim().length > 5) userMessages.unshift(text.trim().substring(0, 200));
                    }
                }
                query = userMessages.length > 0 ? userMessages.join(' ').substring(0, 500) : null;
            }
            if (!query) {
                var state = content.state || {};
                query = (state.time || '') + ' ' + (state.scene || '') + ' ' + (state.main_event || '');
                if (!query.trim()) query = 'recent events';
            }

            // Build full STM pool (unconsolidated + stm_entries)
            var allStm = [].concat(unconsolidated).concat(content.stm_entries || []);
            var allCandidates = [].concat(ltm).concat(allStm);
            if (allCandidates.length > 25) {
                var topK = await filterCandidates(query, allStm, ltm, 25);
                showLtm = topK.filter(function (e) { return e.__type === 'ltm'; });
                showStm = topK.filter(function (e) { return e.__type === 'stm'; });
            }
        } catch (e) {
            console.warn('[NE] BM25 filter in formatVaultForPrompt failed, using full injection:', e);
        }
    }

    if (showLtm.length > 0) {
        var ltmLines = showLtm.map(function (e, i) { return '| ' + (i + 1) + ' | ' + (e.time_range || e.period || '') + ' | ' + (e.scene || '') + ' | ' + (e.title || e.event || '') + ' [\u2192' + (e.stm_refs || []).join(',') + '] |'; });
        parts.push('## ' + t('Long-term Memory (LTM) \u2014 Direct') + '\n| ' + t('No.') + ' | ' + t('Period') + ' | ' + t('Scene') + ' | ' + t('Event (Summary)') + ' |\n|' + '---|'.repeat(4) + '\n' + ltmLines.join('\n'));
    }
    if (showStm.length > 0) {
        var stmLines = showStm.map(function (e, i) {
            var label = e.period ? e.period + (e.time_label ? '\u00b7' + e.time_label : '') : '';
            return '| ' + (i + 1) + ' | ' + label + ' | ' + (e.scene || '') + ' | ' + (e.event || '') + ' [\u2192' + (e.msg_ids || []).join(',') + '] |';
        });
        parts.push('## ' + t('Short-term Memory (Unconsolidated) \u2014 Direct') + '\n| ' + t('No.') + ' | ' + t('Period') + ' | ' + t('Scene') + ' | ' + t('Event') + ' |\n|' + '---|'.repeat(4) + '\n' + stmLines.join('\n'));
    }
    parts.push('---', t('The following content is not directly injected. If needed, use access or recall tool.'));
    parts.push(t('[Tip] The chat history below is for recent context only. For older events, rely on the Memory section above.'));
    return parts.join('\n\n');
}

export function estimateComplexityBudget(chatMessages, defaultBudget) {
    defaultBudget = defaultBudget || 800;
    if (!chatMessages || chatMessages.length === 0) return defaultBudget;

    var lastMsg = chatMessages[chatMessages.length - 1];
    var text = (typeof lastMsg.mes === 'string' ? lastMsg.mes : '') || '';

    var len = text.length;
    var questionCount = (text.match(/[？?！!]/g) || []).length;
    var entityCount = (text.match(/[A-Z][a-z]+/g) || []).length;
    var narrativeKeywords = (text.match(/(?:为什么|什么时候|怎么|之前|后来|原因|动机|why|when|how|before|after|because|motive)/g) || []).length;

    var score = 0;
    if (len < 100) score += 0;
    else if (len < 500) score += 1;
    else score += 2;

    if (questionCount <= 1) score += 0;
    else if (questionCount <= 3) score += 1;
    else score += 2;

    if (entityCount <= 1) score += 0;
    else if (entityCount <= 3) score += 1;
    else score += 2;

    if (narrativeKeywords <= 1) score += 0;
    else score += 1;

    if (score <= 1) return 500;
    if (score <= 4) return 800;
    return 1200;
}

export async function formatSmartContext(vault, chatMessages, budget) {
    if (!budget) {
        budget = estimateComplexityBudget(chatMessages);
    }
    var content = vault.content || {};
    var state = content.state || {};

    var allSTM = (content.unconsolidated_stm || []).filter(function(e) { return !e.parent_ltm; }).concat(
        (content.stm_entries || []).filter(function(e) { return !e.parent_ltm; })
    );
    var allLTM = content.ltm_entries || [];

    var SMART_PUSH_MIN_STM = 5;

    if (allSTM.length === 0 && allLTM.length === 0) {
        return buildStateOnlyInjection(vault);
    }

    if (allSTM.length < SMART_PUSH_MIN_STM && allLTM.length === 0) {
        return buildFullDumpInjection(vault, allSTM, allLTM);
    }

    var query;
    if (chatMessages && chatMessages.length > 0) {
        // Use recent user messages as query (get up to 5 most recent user messages)
        var userMessages = [];
        for (var i = chatMessages.length - 1; i >= 0 && userMessages.length < 5; i--) {
            var m = chatMessages[i];
            if (m && (m.role === 'user' || m.is_user)) {
                var text = typeof m.mes === 'string' ? m.mes : (m.content || '');
                if (text && text.trim().length > 5) userMessages.unshift(text.trim().substring(0, 200));
            }
        }
        query = userMessages.length > 0 ? userMessages.join(' ').substring(0, 500) : null;
    }
    if (!query) {
        var queryParts = [];
        if (content.story_time) queryParts.push(content.story_time);
        if (content.story_date) queryParts.push(content.story_date);
        if (content.story_scene) queryParts.push(content.story_scene);
        if (state.time) queryParts.push(state.time);
        if (state.scene) queryParts.push(state.scene);
        if (state.main_event) queryParts.push(state.main_event);
        query = queryParts.length > 0 ? queryParts.join(' · ') : 'recent events';
    }

    // ── 模糊引用解析（策略3）──
    var resolvedAmbiguity = null;
    try {
        resolvedAmbiguity = resolveAmbiguousReferences(query, content.state, content);
        if (resolvedAmbiguity && resolvedAmbiguity.enhancedQuery && resolvedAmbiguity.enhancedQuery !== query) {
            query = resolvedAmbiguity.enhancedQuery;
        }
    } catch (e) {}

    // ── 实体链预取（容器A）──
    var entityNames = extractEntityNames(query, content);
    var entityChains = {};
    if (entityNames && entityNames.length > 0) {
        try {
            entityChains = await lookupEntityChains(content, entityNames);
        } catch (e) {}
    }

    var smartPushStart = Date.now();
    var bm25Start = Date.now();

    // ── 提取 entity aliases 用于 BM25 搜索 ──
    var aliasesMap = {};
    var characters = state.characters || {};
    Object.keys(characters).forEach(function(name) {
        var aliases = characters[name].aliases;
        if (aliases && Array.isArray(aliases) && aliases.length > 0) {
            aliasesMap[name] = aliases;
        }
    });

    var topCandidates;
    try {
        topCandidates = await filterCandidates(query, allSTM, allLTM, 40, 3, aliasesMap);
    } catch (e) {
        console.warn('[NE] BM25 filter failed, falling back to full dump injection:', e);
        return buildFullDumpInjection(vault, allSTM, allLTM);
    }
    var bm25Ms = Date.now() - bm25Start;

    if (!topCandidates || topCandidates.length === 0) {
        return buildFullDumpInjection(vault, allSTM, allLTM);
    }

    // ── 合并管线: BM25 + 实体链 + LTM 分组 → unified Map ──
    var pipelineMerged;
    try {
        pipelineMerged = mergePipelines(topCandidates, entityChains, allLTM, state, allSTM);
    } catch (e) {
        console.warn('[NE] mergePipelines failed, using BM25-only:', e);
        pipelineMerged = mergePipelines(topCandidates, {}, [], state, allSTM);
    }

    // ── 构建笔记本 ──
    var notebook = new RetrievalNotebook();
    if (pipelineMerged && pipelineMerged.map) {
        notebook.map = pipelineMerged.map;
    }
    if (pipelineMerged && pipelineMerged.threadIndex) {
        notebook.threadIndex = pipelineMerged.threadIndex;
    }
    notebook._availableChains = pipelineMerged ? (pipelineMerged.availableChains || []) : [];

    // ── Debug: stash for test hooks ──
    globalThis.__ne_debug_last_merge = pipelineMerged ? {
        mapSize: pipelineMerged.map ? pipelineMerged.map.size : 0,
        threadCount: pipelineMerged.threadIndex ? Object.keys(pipelineMerged.threadIndex).length : 0,
        threadKeys: pipelineMerged.threadIndex ? Object.keys(pipelineMerged.threadIndex) : [],
        availableChains: pipelineMerged.availableChains || [],
        time: new Date().toISOString()
    } : null;
    globalThis.__ne_debug_last_notebook = {
        version: notebook.version,
        mapSize: notebook.map.size,
        threadCount: Object.keys(notebook.threadIndex).length,
        threadKeys: Object.keys(notebook.threadIndex)
    };

    var retrievalApiStart = Date.now();
    var synthesized;
    var smPushMethod;
    try {
        var messages = await buildRetrievalMessages(notebook, query, vault, budget);
        var accessTool = {
            type: 'function',
            function: {
                name: 'access',
                description: 'Deep-search memory by reference.',
                parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] }
            }
        };
        var noteThreadTool = {
            type: 'function',
            function: {
                name: 'note_thread',
                description: 'Register a cross-entity narrative thread (time-discontiguous but thematically linked events).',
                parameters: {
                    type: 'object',
                    properties: {
                        label: { type: 'string', description: 'Short descriptive label for the thread' },
                        stm_ids: { type: 'array', items: { type: 'string' }, description: 'Ordered list of stm_ids in this thread' }
                    },
                    required: ['label', 'stm_ids']
                }
            }
        };
        var accessExecutor = function(args) {
            var ref = args.ref || '';
            // Check notebook Map first
            var nbEntry = notebook.getEntry(ref);
            if (nbEntry) {
                notebook.expand(ref);
                return JSON.stringify(nbEntry.entry);
            }
            // Check topCandidates (fallback)
            for (var ci = 0; ci < topCandidates.length; ci++) {
                if (topCandidates[ci].id === ref || topCandidates[ci].__id === ref) {
                    notebook.expand(ref);
                    return JSON.stringify(topCandidates[ci]);
                }
            }
            // Chain access
            if (ref.indexOf('chain.') === 0 || ref.indexOf('chain:') === 0) {
                var chainEntity = ref.replace(/^(chain\.|chain:)/, '');
                var chainResult = executeAccess(ref, null, getChatId, getChatMessages);
                try {
                    var chainData = JSON.parse(chainResult);
                    if (chainData && chainData.entries && Array.isArray(chainData.entries)) {
                        notebook.addChain(chainEntity, chainData.entries);
                    }
                    return chainData.text || chainResult;
                } catch (e) {
                    return chainResult;
                }
            }
            // Direct access (stm_id, ltm_id, msg_id)
            return executeAccess(ref, null, getChatId, getChatMessages);
        };
        var noteThreadExecutor = function(args) {
            var label = args.label || '';
            var stmIds = args.stm_ids || [];
            if (label && stmIds.length > 0) {
                notebook.addDispersedThread(label, stmIds);
                return 'Registered dispersed thread: ' + label + ' (' + stmIds.length + ' events)';
            }
            return 'No valid thread to register';
        };
        var result = await callMemoryRetrievalWithTools(messages, [accessTool, noteThreadTool], { access: accessExecutor, note_thread: noteThreadExecutor }, { timeout: 8, maxTokens: 2048 });
        synthesized = result;
        smPushMethod = 'llm_synthesis';
    } catch (e) {
        console.warn('[NE] Retrieval LLM failed, using BM25 top results:', e);
        synthesized = formatBM25Results(query, topCandidates.slice(0, 5));
        smPushMethod = 'bm25_fallback';
    }
    // Update notebook snapshot post-synthesis
    globalThis.__ne_debug_last_notebook = {
        version: notebook.version,
        mapSize: notebook.map.size,
        threadCount: Object.keys(notebook.threadIndex).length,
        threadKeys: Object.keys(notebook.threadIndex)
    };
    var retrievalApiMs = Date.now() - retrievalApiStart;
    var smartPushTotalMs = Date.now() - smartPushStart;

    recordTelemetry({
        sm_push_method: smPushMethod,
        bm25_candidate_count: topCandidates ? topCandidates.length : 0,
        bm25_ms: bm25Ms,
        retrieval_api_ms: retrievalApiMs,
        smart_push_total_ms: smartPushTotalMs,
        injection_token_count: synthesized ? (typeof synthesized === 'string' ? synthesized.length : 0) : 0,
        memory_budget: budget
    });

    var parts = [];

    // ── Layer 0: memory_system_prompt ──
    if (vault.memory_system_prompt) {
        parts.push(vault.memory_system_prompt);
    }

    // ── Event memory (memory LLM synthesis) ──
    if (synthesized && typeof synthesized === 'string' && synthesized.trim()) {
        if (parts.length > 0) parts.push('---');
        var synthText = synthesized.trim();
        parts.push(synthText);

        // ── 显式缺口标记（策略2）──
        if (entityNames && entityNames.length > 0 && entityChains && Object.keys(entityChains).length > 0) {
            var gapMarkers = [];
            entityNames.forEach(function(name) {
                var chain = entityChains[name];
                if (chain && chain.length > 0) {
                    var firstPeriod = chain[0].period || '';
                    var lastPeriod = chain[chain.length - 1].period || '';
                    var span = firstPeriod && lastPeriod && firstPeriod !== lastPeriod ? ' ' + firstPeriod + '-' + lastPeriod : (firstPeriod ? ' ' + firstPeriod : '');
                    gapMarkers.push(name + ' 另有 ' + chain.length + ' 条相关事件未展开，跨度' + span);
                }
            });
            if (gapMarkers.length > 0) {
                parts.push(gapMarkers.join('\n'));
            }
        }
    }

    // ── 固定预算信息打包（策略5）──
    var neSettings = {};
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) neSettings = JSON.parse(raw);
    } catch (e) {}
    if (neSettings.retrievalBudgetEnabled) {
        var budgetText = compileRetrievalBudget(content, query, entityNames, entityChains, neSettings.retrievalBudgetTokens || 300);
        if (budgetText) {
            if (parts.length > 0) parts.push('---');
            parts.push(budgetText);
        }
    }

    return parts.join('\n\n');
}

/* ──────── 固定预算检索包编译器（策略5）──────── */
function compileRetrievalBudget(content, query, entityNames, entityChains, budgetTokens) {
    if (!entityChains || Object.keys(entityChains).length === 0) return ''
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || [])
    var allLTM = content.ltm_entries || []

    var scoredEntities = []
    Object.keys(entityChains).forEach(function(name) {
        var chain = entityChains[name]
        if (!chain || chain.length === 0) return
        // BM25相关性评分（简化：实体名在query中的匹配质量）
        var bm25Score = 0
        var qLower = (query || '').toLowerCase()
        var nLower = name.toLowerCase()
        if (qLower.indexOf(nLower) !== -1) bm25Score = 0.8
        else {
            // 部分匹配
            var parts = name.split(/[\s\-_]+/)
            var matched = 0
            parts.forEach(function(p) { if (qLower.indexOf(p.toLowerCase()) !== -1) matched++ })
            bm25Score = parts.length > 0 ? matched / parts.length * 0.5 : 0.1
        }
        // 最近活跃度评分
        var recencyScore = 0
        if (chain.length > 0) {
            var lastEntry = chain[chain.length - 1]
            var daysAgo = lastEntry.timestamp
                ? (Date.now() - new Date(lastEntry.timestamp).getTime()) / 86400000
                : 30
            recencyScore = Math.max(0, 1 - daysAgo / 90)
        }
        // 链长度评分
        var lengthScore = Math.min(chain.length / 15, 1)
        var score = bm25Score * 0.6 + recencyScore * 0.25 + lengthScore * 0.15
        scoredEntities.push({ name: name, chain: chain, score: score })
    })
    if (scoredEntities.length === 0) return ''

    scoredEntities.sort(function(a, b) { return b.score - a.score })

    var totalScore = 0
    scoredEntities.forEach(function(e) { totalScore += e.score })
    if (totalScore === 0) totalScore = 1

    var result = '## 相关实体事件\n'
    var usedTokens = 40 // header ~40 tokens
    var tokenPerEntry = 40

    for (var i = 0; i < scoredEntities.length; i++) {
        var se = scoredEntities[i]
        var allocTokens = Math.floor(budgetTokens * (se.score / totalScore))
        var maxEntries = Math.max(1, Math.floor((allocTokens - 20) / tokenPerEntry))
        var selectedEntries = se.chain.slice(-maxEntries)
        if (usedTokens + 20 > budgetTokens) break

        result += '**' + se.name + '**: '
        var summaries = selectedEntries.map(function(e) {
            return (e.title || e.event || e.summary || '').substring(0, 35)
        })
        result += summaries.join(' | ') + '\n'
        usedTokens += 20 + summaries.length * tokenPerEntry
    }
    return result.trim()
}

/* ──────── Injection builders (no LLM path) ──────── */

function formatFullDump(allSTM, allLTM) {
    var lines = [];
    lines.push('## Event Log');
    lines.push('');

    allSTM.forEach(function(c) {
        var timePart = (c.time_range || c.period || '');
        if (c.time_label) timePart = timePart + '·' + c.time_label;
        var refs = '';
        if (c.msg_ids && c.msg_ids.length > 0) {
            refs = ' [→' + c.msg_ids.join(',') + ']';
        } else if (c.stm_refs && c.stm_refs.length > 0) {
            refs = ' [→' + c.stm_refs.join(',') + ']';
        }
        lines.push('- [' + timePart + '] ' + (c.scene || '') + ': ' + (c.title || c.event || c.summary || '') + refs);
    });

    if (allLTM && allLTM.length > 0) {
        lines.push('');
        lines.push('### Consolidated Memories');
        allLTM.forEach(function(c) {
            var timePart = (c.time_range || c.period || '');
            if (c.time_label) timePart = timePart + '·' + c.time_label;
            lines.push('- [' + timePart + '] ' + (c.scene || '') + ': ' + (c.title || c.event || c.summary || ''));
        });
    }

    return lines.join('\n');
}

export function buildStateOnlyInjection(vault) {
    var parts = [];
    if (vault.memory_system_prompt) {
        parts.push(vault.memory_system_prompt);
    }
    parts.push('[ℹ Current state is maintained in the World Book: NE_Memory_State]');
    return parts.join('\n\n');
}

function buildFullDumpInjection(vault, allSTM, allLTM) {
    var content = vault.content || {};
    var parts = [];

    if (vault.memory_system_prompt) {
        parts.push(vault.memory_system_prompt);
    }

    var dumpText = formatFullDump(allSTM, allLTM);
    if (dumpText) {
        if (parts.length > 0) parts.push('---');
        parts.push(dumpText);
    }

    if (parts.length === 0) {
        return formatMinimalState(vault);
    }

    return parts.join('\n\n');
}

function formatMinimalState(vault) {
    var content = vault.content || {};
    var state = content.state || {};
    var lines = [];
    if (content.story_time || content.story_date || state.time || content.story_scene || state.scene) {
        lines.push('Scene: ' + (state.scene || content.story_scene || ''));
        var minTimeParts = [];
        if (content.story_time || state.time) minTimeParts.push(state.time || content.story_time);
        if (content.story_date) minTimeParts.push(content.story_date);
        if (minTimeParts.length > 0) lines.push('Time: ' + minTimeParts.join(' ─ '));
    }
    return lines.join('\n') || 'No state information available.';
}

function formatBM25Results(query, candidates) {
    if (!candidates || candidates.length === 0) return '';
    var lines = [];
    lines.push('## Relevant memories for: ' + query);
    lines.push('');
    candidates.forEach(function(c) {
        var timePart = (c.time_range || c.period || '');
        if (c.time_label) timePart = timePart + '·' + c.time_label;
        var refs = '';
        if (c.msg_ids && c.msg_ids.length > 0) {
            refs = ' [→' + c.msg_ids.join(',') + ']';
        } else if (c.stm_refs && c.stm_refs.length > 0) {
            refs = ' [→' + c.stm_refs.join(',') + ']';
        }
        lines.push('- [' + timePart + '] ' + (c.scene || '') + ': ' + (c.event || c.summary || '') + refs);
    });
    lines.push('');
    return lines.join('\n');
}

/* ──────── 面板初始化 ──────── */

var _currentGetChatId = null;

export async function renderVaultPanel(getChatId) {
    try {
        if (byId('ne_vault_bottom_overlay')) return;
        _currentGetChatId = getChatId;
        _currentChatIdForCollapse = typeof getChatId === 'function' ? getChatId() : getChatId;
        injectPinCSS();
        injectBottomDrawerCSS();
        var vault = await read(getChatId());
        var c = vault.content || {};

        var drawerHtml = '<div id="ne_vault_bottom_overlay" class="ne-vault-bottom-overlay">' +
            '<div class="ne-vault-collapse-bar" title="' + t('Collapse memory panel') + '">' +
            '<span class="ne-vault-collapse-indicator"></span>' +
            '<span class="ne-vault-collapse-chevron"><i class="fa-solid fa-chevron-down"></i></span>' +
            '</div>' +
            '<div class="ne-vault-pin-row" style="padding:4px 12px 0;display:flex;align-items:center;">' +
            '<h3 class="margin0" style="white-space:nowrap;font-size:var(--mainFontSize);margin:0;padding:0 8px;">' + t('Memory Vault') + '</h3>' +
            '<div style="display:flex;align-items:center;margin-left:auto;gap:8px;">' +
            '<span id="narrative_vault_activity" style="font-size:0.8em;color:#888;">\u25CF</span>' +
            '<span id="narrative_vault_panel_version" style="font-weight:bold;font-size:0.85em;"></span>' +
            '<span id="narrative_secondary_api_status" style="font-size:0.75em;color:#666;cursor:help;" title=""></span>' +
            '<div id="narrative_vault_pin_div" title="' + t('Locked = Memory Vault panel will stay open') + '">' +
            '<input type="checkbox" id="narrative_vault_pin">' +
            '<label for="narrative_vault_pin">' +
            '<div class="fa-solid unchecked fa-unlock right_menu_button" alt=""></div>' +
            '<div class="fa-solid checked fa-lock right_menu_button" alt=""></div>' +
            '</label></div></div></div>' +
            '<div class="ne-vault-tab-bar">' +
            '<div class="ne-vault-tab active" data-tab="memory"><i class="fa-solid fa-brain"></i> ' + t('Memory') + '</div>' +
            '<div class="ne-vault-tab" data-tab="tools"><i class="fa-solid fa-wrench"></i> ' + t('Tools') + '</div>' +
            '<div class="ne-vault-tab" data-tab="settings"><i class="fa-solid fa-gear"></i> ' + t('Settings') + '</div>' +
            '</div>' +
            '<div class="ne-vault-scroll-area">' +
            '<div id="narrative_vault_loading">' + t('Loading...') + '</div>' +
            '<div id="narrative_vault_panel_error" style="display:none;color:#f44336;"></div>' +
            '<div id="narrative_vault_panel_storage_warn" style="display:none;color:#ff9800;font-size:0.85em;margin-bottom:4px;border:1px solid #ff9800;padding:4px;border-radius:4px;"></div>' +
            '<div id="tab-memory" class="ne-vault-tab-content active">' +
            '<div id="ne_quick_index" class="ne-quick-index"></div>' +
            '<div class="ne-accordion open" id="ne-acc-memory-list">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Memory List') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<div class="ne-accordion open" id="ne-acc-stm">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Short-term Memory (STM)') + ' <span id="ne-stm-count" style="margin-left:4px;font-weight:normal;color:var(--grey-50);font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="narrative_vault_panel_stm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">No.</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;">' + t('Scene') + '</th><th style="text-align:left;max-width:180px;font-size:0.8em;">' + t('Msg IDs') + '</th><th style="text-align:left;">' + t('Event') + '</th><th style="width:2em;"></th></tr></thead>' +
            '<tbody id="narrative_vault_panel_stm_body"></tbody></table></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-ltm">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Long-term Memory (LTM)') + ' <span id="ne-ltm-count" style="margin-left:4px;font-weight:normal;color:var(--grey-50);font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="narrative_vault_panel_ltm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">No.</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;max-width:180px;font-size:0.8em;">' + t('STM Refs') + '</th><th style="text-align:left;">' + t('Event (Summary)') + '</th><th style="width:2em;"></th></tr></thead>' +
            '<tbody id="narrative_vault_panel_ltm_body"></tbody></table></div>' +
            '</div></div>' +
            '</div></div>' +
            '<div class="ne-accordion open" id="ne-acc-state-board">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('State Board') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<div class="ne-accordion open" id="ne-acc-global">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Global Data') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<div id="ne_state_block_container"></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-characters">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Characters') + ' <span id="ne-char-count" style="margin-left:4px;font-weight:normal;color:var(--grey-50);font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="ne_character_block_container"></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-quests">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Quests & Events') + ' <span id="ne-quest-count" style="margin-left:4px;font-weight:normal;color:var(--grey-50);font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="ne_quest_block_container"></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-factions">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Factions') + ' <span id="ne-faction-count" style="margin-left:4px;font-weight:normal;color:var(--grey-50);font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="ne_faction_block_container"></div>' +
            '</div></div>' +
            '</div></div>' +
            '</div>' +
            '<div id="tab-tools" class="ne-vault-tab-content">' +
            '<div style="padding:4px 12px;">' +
            '<div class="ne-tool-card">' +
            '<div class="ne-tool-card-title">' + t('Operations') + '</div>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
            '<button id="narrative_vault_panel_refresh" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Refresh') + '</button>' +
            '<button class="narrative_btn_consolidate ne-btn-warning menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Consolidate') + '</button>' +
            '<button id="narrative_vault_process_history" class="ne-btn-danger menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" title="' + t('Process all past messages into memories') + '">' + t('Process History') + '</button>' +
            '</div></div>' +
            '<div class="ne-tool-card">' +
            '<div class="ne-tool-card-title">' + t('Data') + '</div>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
            '<button id="narrative_vault_export_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Export JSON') + '</button>' +
            '<button id="narrative_vault_import_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Import JSON') + '</button>' +
            '<button id="narrative_vault_embed_chat" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" title="' + t('Embed vault into chat_metadata so it travels with chat export/backup') + '">' + t('Embed into Chat') + '</button>' +
            '</div></div>' +
            '<div class="ne-tool-card">' +
            '<div class="ne-tool-card-title">' + t('Diagnostics') + '</div>' +
            '<div class="ne-accordion open" id="ne-tool-injection">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Injection Preview') + '</div>' +
            '<div class="ne-accordion-body"><div id="ne_injection_preview_content"></div></div></div>' +
            '<div class="ne-accordion" id="ne-tool-llm-log">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('LLM Operation Log') + '</div>' +
            '<div class="ne-accordion-body"><div id="narrative_vault_llm_entries" style="font-size:0.8em;"></div></div></div>' +
            '<div class="ne-accordion" id="ne-tool-tool-log">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Tool Calling Log') + '</div>' +
            '<div class="ne-accordion-body"><div id="narrative_vault_tool_calls" style="font-size:0.8em;"></div></div></div>' +
            '<div class="ne-accordion" id="ne-tool-history">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('History') + '</div>' +
            '<div class="ne-accordion-body"><div id="narrative_vault_history_list" style="font-size:0.85em;"></div></div></div>' +
            '<div class="ne-accordion" id="ne-tool-test-runner">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> <span style="margin-right:6px;">\u2699</span> ' + t('Test Runner') + '</div>' +
            '<div class="ne-accordion-body"><div id="ne-tr-container" class="ne-tr-container"></div></div></div>' +
            '<div style="margin-top:8px;">' +
            '<button id="narrative_vault_export_btn" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Export Logs') + '</button>' +
            '</div></div>' +
            '</div></div>' +
            '<div id="tab-settings" class="ne-vault-tab-content">' +
            '<div class="ne-settings-scroll" style="padding:4px 12px;overflow-y:auto;">' +
            '<div class="ne-settings-section-card" style="margin-bottom:8px;">' +
            '<div class="ne-settings-section-title">\u2B50 ' + t('Common Settings') + '</div>' +
            '<div id="ne_common_settings"></div></div>' +
            '<div class="ne-settings-section-card">' +
            '<div class="ne-settings-section-title">\uD83D\uDD2C ' + t('Advanced Settings') + '</div>' +
            '<div id="ne_advanced_settings"></div></div>' +
            '</div></div>' +
            '</div></div>';

        var sheld = byId('sheld');
        if (sheld) {
            sheld.insertAdjacentHTML('beforeend', drawerHtml);
        } else {
            console.error('[NE] #sheld not found');
            return;
        }

        renderMemoryButton(getChatId);
        setupTabSwitching();

        var collapseBar = qs('#ne_vault_bottom_overlay .ne-vault-collapse-bar');
        if (collapseBar) collapseBar.onclick = function () { closeVaultOverlay(); };

        setupAccordionHandlers(typeof getChatId === 'function' ? getChatId() : getChatId);
        var savedState = loadCollapseState(typeof getChatId === 'function' ? getChatId() : getChatId);
        if (savedState) {
            qsa('#tab-memory .ne-accordion').forEach(function(acc) {
                if (acc.id && savedState[acc.id] === true) acc.classList.add('open');
                else if (acc.id && savedState[acc.id] === false) acc.classList.remove('open');
            });
        }

        var ref = byId('narrative_vault_panel_refresh');
        if (ref) ref.onclick = function () {
            setVaultActivity(true);
            updateVaultViewerPopout(getChatId).finally(function () { setVaultActivity(false); });
        };

        var consolidateBtn = qs('.narrative_btn_consolidate');
        if (consolidateBtn) {
            consolidateBtn.onclick = async function () {
                if (!confirm(t('Consolidate will convert STM entries into LTM. Continue?'))) return;
                var prevText = consolidateBtn.textContent;
                consolidateBtn.disabled = true;
                consolidateBtn.textContent = t('Processing...');
                try {
                    await executeConsolidation(getChatId(), true);
                    await updateVaultViewerPopout(getChatId);
                } catch (e) {
                    console.error('[NE] Consolidation failed:', e);
                    alert(t('Consolidation failed') + ': ' + e.message);
                } finally {
                    consolidateBtn.disabled = false;
                    consolidateBtn.textContent = prevText;
                }
            };
        }

        var processHistoryBtn = byId('narrative_vault_process_history');
        if (processHistoryBtn) {
            processHistoryBtn.onclick = async function () {
                if (!confirm(t('This will re-process ALL past messages. It may take a long time. Continue?'))) return;
                var chatMessages = [];
                try {
                    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                        chatMessages = SillyTavern.getContext().chat || [];
                    }
                } catch (e) {}

                if (chatMessages.length === 0) {
                    alert(t('No messages found in chat.'));
                    return;
                }

                // Filter to messages with actual content
                var toProcess = [];
                chatMessages.forEach(function (msg, idx) {
                    var content = msg.mes || '';
                    if (content.trim().length > 0) {
                        toProcess.push({
                            id: idx,
                            is_user: !!msg.is_user,
                            mes: content,
                            name: msg.name || ''
                        });
                    }
                });

                if (toProcess.length === 0) {
                    alert(t('No messages with content to process.'));
                    return;
                }

                var vault = await read(getChatId());
                var stmMsgIdSet = collectAllMsgIds(vault);
                toProcess = toProcess.filter(function (msg) {
                    return !stmMsgIdSet.has(String(msg.id));
                });

                if (toProcess.length === 0) {
                    alert(t('All messages have already been processed.'));
                    return;
                }

                var prevText = processHistoryBtn.textContent;
                processHistoryBtn.disabled = true;
                var BATCH = 30;
                var total = toProcess.length;
                processHistoryBtn.textContent = t('Processing...') + ' (0' + '\u8f6e' + ')';

                var cpKey = 'ne_ph_' + getChatId();
                var processedCount = 0;
                try {
                    var cp = localStorage.getItem(cpKey);
                    if (cp) {
                        var cpData = JSON.parse(cp);
                        if (cpData.t && cpData.i >= total) {
                            console.log('[NE] Process History checkpoint stale, resetting');
                            try { localStorage.removeItem(cpKey); } catch (e2) {}
                        } else if (cpData.t && cpData.i > 0) {
                            processedCount = cpData.i;
                            console.log('[NE] Resuming Process History from message', processedCount + 1, '/', total);
                        }
                    }
                } catch (e) {}

                try {
                    var accumTurns = processedCount;
                    processHistoryBtn.textContent = t('Processing...') + ' (0' + '\u8f6e' + ')';
                    for (var i = processedCount; i < total; i += BATCH) {
                        var batch = toProcess.slice(i, i + BATCH);
                        var result = await executeIncrementalUpdate(getChatId(), batch, true, function(progress) {
                            accumTurns = progress.processedTurns;
                            processHistoryBtn.textContent = t('Processing...') + ' (' + accumTurns + '\u8f6e' + ')';
                        }, true);
                        if (result.added === 0 && batch.length > 0) {
                            console.warn('[NE] Process History batch produced 0 STM entries — batch size=' + batch.length + ', check browser console for pipeline errors');
                        }
                        var done = Math.min(i + BATCH, total);
                        try {
                            localStorage.setItem(cpKey, JSON.stringify({ t: Date.now(), i: done }));
                        } catch (e2) {}
                    }
                    try { localStorage.removeItem(cpKey); } catch (e3) {}
                    try {
                        processHistoryBtn.textContent = t('Consolidating...');
                        await executeConsolidation(getChatId(), true);
                    } catch (consErr) {
                        console.warn('[NE] Process History consolidate failed:', consErr);
                    }
                    processHistoryBtn.textContent = t('Completed') + ' (' + accumTurns + '\u8f6e' + ')';
                } catch (e) {
                    console.error('[NE] Process history failed:', e);
                    alert(t('Process History') + ' failed: ' + e.message);
                    processHistoryBtn.textContent = t('Failed');
                } finally {
                    setTimeout(function () {
                        processHistoryBtn.textContent = prevText;
                        processHistoryBtn.disabled = false;
                    }, 1500);
                    updateVaultViewerPopout(getChatId);
                }
            };
        }

        var exportBtn = byId('narrative_vault_export_json');
        if (exportBtn) {
            exportBtn.onclick = async function () {
                try {
                    var vault = await read(getChatId());
                    var json = JSON.stringify(vault, null, 2);
                    var blob = new Blob([json], { type: 'application/json' });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = 'ne_vault_' + getChatId() + '.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (e) {
                    console.error('[NE] Export failed:', e);
                    alert(t('Export JSON') + ' failed: ' + e.message);
                }
            };
        }

        var importBtn = byId('narrative_vault_import_json');
        if (importBtn) {
            importBtn.onclick = function () {
                var input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = async function () {
                    var file = input.files[0];
                    if (!file) return;
                    try {
                        var text = await file.text();
                        var vault = JSON.parse(text);
                        if (!vault || !vault.content) {
                            alert(t('Import JSON') + ' failed: invalid vault file');
                            return;
                        }
                        await write(getChatId(), vault);
                        updateVaultViewerPopout(getChatId);
                    } catch (e) {
                        console.error('[NE] Import failed:', e);
                        alert(t('Import JSON') + ' failed: ' + e.message);
                    }
                };
                input.click();
            };
        }

        var embedBtn = byId('narrative_vault_embed_chat');
        if (embedBtn) {
            embedBtn.onclick = async function () {
                try {
                    var ctx = window.parent.SillyTavern && window.parent.SillyTavern.getContext ? window.parent.SillyTavern.getContext() : null;
                    if (!ctx || !ctx.chatMetadata || typeof ctx.saveChat !== 'function') {
                        alert(t('Embed into Chat') + ': Cannot access SillyTavern chat API.');
                        return;
                    }
                    var vault = await read(getChatId());
                    ctx.chatMetadata.ne_vault = JSON.stringify(vault);
                    await ctx.saveChat();
                    alert(t('Embed into Chat') + ' ' + t('Done') + ' — ' + t('Vault is now embedded in chat_metadata. Export or backup will carry it.'));
                } catch (e) {
                    console.error('[NE] Embed failed:', e);
                    alert(t('Embed into Chat') + ' failed: ' + e.message);
                }
            };
        }

        // Pin
        byId('narrative_vault_pin').onchange = function () {
            var pin = byId('narrative_vault_pin');
            if (!pin) return;
            var checked = pin.checked;
            var overlay = byId('ne_vault_bottom_overlay');
            if (overlay) overlay.classList.toggle('pinned', checked);
        };

        // Tools tab accordion lazy render handled by setupAccordionHandlers delegation

        // LLM log entry & card expand/collapse
        pdAddEventListener('click', function (e) {
            var header = e.target.closest('.ne_log_header');
            if (header) {
                var body = header.parentElement.querySelector('.ne_log_body');
                if (!body) return;
                var vis = body.style.display !== 'none';
                body.style.display = vis ? 'none' : '';
                header.textContent = (vis ? '\u25B6' : '\u25BC') + header.textContent.substring(1);
                return;
            }
            // Character card toggle
            var charHeader = e.target.closest('.ne_char_header');
            if (charHeader) {
                var cardId = charHeader.getAttribute('data-card-id');
                var detail = byId(cardId + '_detail');
                var toggle = charHeader.querySelector('.ne_char_toggle');
                if (detail) {
                    var vis = detail.style.display !== 'none';
                    detail.style.display = vis ? 'none' : '';
                    if (toggle) toggle.textContent = vis ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Faction card toggle
            var factionHeader = e.target.closest('.ne_faction_header');
            if (factionHeader) {
                var fCardId = factionHeader.getAttribute('data-card-id');
                var fDetail = byId(fCardId + '_detail');
                var fToggle = factionHeader.querySelector('.ne_faction_toggle');
                if (fDetail) {
                    var fVis = fDetail.style.display !== 'none';
                    fDetail.style.display = fVis ? 'none' : '';
                    if (fToggle) fToggle.textContent = fVis ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Quest card toggle
            var questHeader = e.target.closest('.ne_quest_header');
            if (questHeader) {
                var qCardId = questHeader.getAttribute('data-card-id');
                var qDetail = byId(qCardId + '_detail');
                var qToggle = questHeader.querySelector('.ne_quest_toggle');
                if (qDetail) {
                    var qVis = qDetail.style.display !== 'none';
                    qDetail.style.display = qVis ? 'none' : '';
                    if (qToggle) qToggle.textContent = qVis ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Character group toggle
            var groupHeader = e.target.closest('.ne_group_header');
            if (groupHeader) {
                var groupId = groupHeader.getAttribute('data-group-id');
                var cards = byId(groupId + '_cards');
                var toggle = groupHeader.querySelector('.ne_group_toggle');
                if (cards) {
                    var vis = cards.style.display !== 'none';
                    cards.style.display = vis ? 'none' : '';
                    if (toggle) toggle.textContent = vis ? '\u25B6' : '\u25BC';
                }
                return;
            }
        });

        // Export logs
        byId('narrative_vault_export_btn').onclick = function () {
            var llmLog = [];
            var toolLog = [];
            var anomalies = [];
            var tokenUsage = {};
            var userSignals = {};
            try { llmLog = JSON.parse(localStorage.getItem('ne_llm_log') || '[]'); } catch (e) {}
            try { toolLog = JSON.parse(localStorage.getItem('ne_tool_calls') || '[]'); } catch (e) {}
            try { anomalies = JSON.parse(localStorage.getItem('ne_anomalies') || '[]'); } catch (e) {}
            try { tokenUsage = JSON.parse(localStorage.getItem('ne_token_usage') || '{}'); } catch (e) {}
            try { userSignals = JSON.parse(localStorage.getItem('ne_user_signals') || '{}'); } catch (e) {}
            var chatStats = getAllChatStats();

            // Compute derived metrics
            var derived = { per_chat: {} };
            Object.keys(chatStats).forEach(function(cid) {
                var c = chatStats[cid];
                var agg = c.aggregates || {};
                var turns = agg.total_turns || 1;
                var lastTurn = c.turns && c.turns.length > 0 ? c.turns[c.turns.length - 1] : null;
                var firstTurn = c.turns && c.turns.length > 0 ? c.turns[0] : null;
                derived.per_chat[cid] = {
                    stm_per_turn: (agg.total_stm_count || 0) / turns,
                    ltm_per_turn: (agg.total_ltm_count || 0) / turns,
                    llm_calls_per_turn: (agg.total_llm_calls || 0) / turns,
                    tool_calls_per_turn: (agg.total_tool_calls || 0) / turns,
                    tokens_per_turn: (agg.total_tokens || 0) / turns,
                    error_rate: (agg.total_errors || 0) / turns,
                    avg_pipeline_ms: (agg.total_pipeline_duration_ms || 0) / turns
                };
                if (lastTurn && firstTurn && turns > 1) {
                    derived.per_chat[cid].stm_growth_rate = ((lastTurn.stm || 0) - (firstTurn.stm || 0)) / (turns - 1);
                    derived.per_chat[cid].ltm_growth_rate = ((lastTurn.ltm || 0) - (firstTurn.ltm || 0)) / (turns - 1);
                }
            });

            var data = {
                llm_log: llmLog,
                tool_log: toolLog,
                telemetry: telemetryBuffer,
                anomalies: anomalies,
                token_usage: tokenUsage,
                user_signals: userSignals,
                chat_stats: chatStats,
                derived: derived
            };
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var a = pdCreate('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'ne_telemetry_' + new Date().toISOString().split('T')[0] + '.json';
            a.click();
        };

        freezeIframeHeight();

        // Initialize Test Runner UI
        initTestRunner();

        renderSettingsTab();
    } catch (e) {
        console.error('[NE] Vault panel render failed:', e);
    }
}

function renderInjectionPreview() {
    var container = byId('ne_injection_preview_content');
    if (!container) return;
    var logs = [];
    try { logs = JSON.parse(localStorage.getItem('ne_llm_log') || '[]'); } catch (e) {}
    var injection = null;
    for (var i = logs.length - 1; i >= 0; i--) {
        if (logs[i].type === 'smartpush_injection') { injection = logs[i]; break; }
    }
    if (!injection) {
        container.innerHTML = '<div style="color:#888;font-size:0.85em;padding:4px 0;">' + t('No injection recorded yet. Send a message to trigger SmartPush.') + '</div>';
        return;
    }
    var content = (injection.request || '').substring(0, 800);
    var truncated = injection.request && injection.request.length > 800 ? ' ...(' + t('truncated') + ')' : '';
    var charCount = content.length;
    var tokenEst = Math.round(charCount / 3.5);
    container.innerHTML = '<div class="ne-injection-meta">' + t('Last injection') + ' \u00b7 ' + formatLocalTime(injection.time) + ' \u00b7 ~' + tokenEst + ' tokens' + truncated + '</div>' +
        '<div class="ne-injection-preview">' + escapeHtml(content) + (truncated ? '<div style="color:var(--grey-50);margin-top:4px;">' + t('Content truncated at 800 characters.') + '</div>' : '') + '</div>';
}

/* ──────── LLM 日志 ──────── */

var narrativeToolCalls = [];

function renderLLMLog() {
    var container = byId('narrative_vault_llm_entries');
    if (!container) return;
    var html = '';
    var logs = [];
    try { logs = JSON.parse(localStorage.getItem('ne_llm_log') || '[]'); } catch (e) {}
    if (logs.length === 0) {
        html = '<div style="color:#888;padding:8px 0;">' + t('No operations logged') + '</div>';
    } else {
        logs.slice().reverse().forEach(function (entry) {
            html += '<div class="ne_log_entry"><div class="ne_log_header" style="cursor:pointer;font-weight:bold;color:var(--grey70);font-size:0.85em;">\u25BC ' + (entry.type || '') + ' \u00b7 ' + formatLocalTime(entry.time) + (entry.duration_ms ? ' \u00b7 ' + (entry.duration_ms > 1000 ? (entry.duration_ms / 1000).toFixed(1) + 's' : entry.duration_ms + 'ms') : '') + (entry.api_source ? ' \u00b7 [' + escapeHtml(entry.api_source) + ']' : '') + '</div>' +
                '<div class="ne_log_body"><div class="ne_log_label" style="color:#aaa;font-size:0.83em;">Request:</div><pre class="ne_log_pre" style="margin:2px 0 6px;white-space:pre-wrap;max-height:200px;overflow-y:auto;background:var(--black50a);padding:4px;border-radius:2px;font-size:0.83em;">' + escapeHtml(entry.request || '') + '</pre>' +
                '<div class="ne_log_label" style="color:#aaa;font-size:0.83em;">Response:</div><pre class="ne_log_pre" style="margin:2px 0 6px;white-space:pre-wrap;max-height:500px;overflow-y:auto;background:var(--black50a);padding:4px;border-radius:2px;font-size:0.83em;">' + escapeHtml(entry.response || '') + '</pre></div></div>';
        });
    }
    container.innerHTML = html;
}

function renderToolCallLog() {
    var container = byId('narrative_vault_tool_calls');
    if (!container) return;
    var html = '';
    var calls = [];
    try { calls = JSON.parse(localStorage.getItem('ne_tool_calls') || '[]'); } catch (e) {}
    if (calls.length === 0) {
        html = '<div style="color:#888;padding:8px 0;">' + t('No tool calls recorded') + '</div>';
    } else {
        calls.slice().reverse().forEach(function (entry) {
            var emoji = entry.success ? '\uD83D\uDFE2' : '\uD83D\uDD34';
            var dur = entry.duration_ms > 1000 ? (entry.duration_ms / 1000).toFixed(1) + 's' : entry.duration_ms + 'ms';
            html += '<div class="ne_tool_entry" style="margin:3px 0;padding:3px 4px;background:var(--black30a);border-radius:3px;font-size:0.85em;">' + emoji + ' ' + escapeHtml(entry.tool) + ' \u00b7 ' + formatLocalTime(entry.ts) + ' \u00b7 ' + dur + (entry.result_summary ? ' \u00b7 ' + escapeHtml(entry.result_summary) : '') + (entry.error_info ? ' \u00b7 <span style="color:#f44336;">' + escapeHtml(entry.error_info) + '</span>' : '') + '</div>';
        });
    }
    container.innerHTML = html;
}

/* ──────── 历史面板 ──────── */

async function renderHistory(getChatId) {
    var container = byId('narrative_vault_history_list');
    if (!container) return;
    try {
        var snapshots = await listSnapshots(getChatId());
        if (!snapshots || snapshots.length === 0) {
            container.innerHTML = '<div style="color:#888;padding:8px 0;">' + t('No history yet') + '</div>';
            return;
        }
        var html = '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.85em;">' +
            '<thead><tr><th>v</th><th>' + t('Version:').replace(':', '') + '</th><th>' + t('Scene') + '</th><th>' + t('Event') + '</th><th>' + t('Restore') + '</th><th>' + t('Delete') + '</th></tr></thead><tbody>';
        snapshots.forEach(function (snap) {
            var sc = snap.data && snap.data.content;
            var ltmCount = sc && sc.ltm_entries ? sc.ltm_entries.length : 0;
            var stmCount = sc && sc.unconsolidated_stm ? sc.unconsolidated_stm.length : 0;
            html += '<tr><td>' + snap.version + '</td><td>' + formatLocalTime(snap.updated_at) + '</td><td>' + ltmCount + ' LTM</td><td>' + stmCount + ' STM</td>' +
                '<td><button class="narrative_restore_btn menu_button" data-ver="' + snap.version + '" style="font-size:0.8em;padding:1px 5px;">' + t('Restore') + '</button></td>' +
                '<td><button class="narrative_del_btn menu_button" data-ver="' + snap.version + '" style="font-size:0.8em;padding:1px 5px;color:#f44336;">' + t('Delete') + '</button></td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;

        qsa('.narrative_restore_btn').forEach(function (btn) {
            btn.onclick = async function () {
                var ver = parseInt(btn.getAttribute('data-ver'));
                if (confirm(t('Restore to version v{VER}?').replace('{VER}', ver))) {
                    await restoreSnapshot(getChatId(), ver);
                    updateVaultViewerPopout(getChatId);
                }
            };
        });
        qsa('.narrative_del_btn').forEach(function (btn) {
            btn.onclick = async function () {
                var ver = parseInt(btn.getAttribute('data-ver'));
                if (confirm(t('Confirm delete v{VER}?').replace('{VER}', ver))) {
                    await deleteSnapshot(getChatId(), ver);
                    renderHistory(getChatId);
                }
            };
        });
    } catch (e) {
        console.error('[NE] renderHistory error:', e);
        container.innerHTML = '<div style="color:#f44336;">' + t('Failed to load history') + '</div>';
    }
}

/* ──────── 测试运行器 ──────── */

function initTestRunner() {
    var container = byId('ne-tr-container');
    if (!container) return;

    var presets = globalThis.__ne_debug && globalThis.__ne_debug._testPresets;

    container.innerHTML =
        '<select id="ne-tr-select" class="ne-tr-select">' +
        (presets ? Object.keys(presets).map(function(k) {
            return '<option value="' + k + '">' + (presets[k].title || k) + '</option>';
        }).join('') : '<option>' + t('No test cases available') + '</option>') +
        '</select>' +
        '<div class="ne-tr-actions">' +
        '<button id="ne-tr-run" class="ne-tr-btn">\u25B6 ' + t('Run') + '</button>' +
        '<button id="ne-tr-export" class="ne-tr-btn" disabled>' + t('Export') + '</button>' +
        '</div>' +
        '<div id="ne-tr-status" class="ne-tr-status">' + t('Select a test case and press Run') + '</div>' +
        '<div id="ne-tr-result" class="ne-tr-result" style="display:none;"></div>' +
        '<pre id="ne-tr-trace" class="ne-tr-trace"></pre>';

    byId('ne-tr-run').onclick = function() {
        var select = byId('ne-tr-select');
        var key = select.value;
        if (!presets || !presets[key]) return;
        runTestFromUI(key, presets[key]);
    };

    byId('ne-tr-export').onclick = exportTestResults;
}

var _lastTestResult = null;

async function runTestFromUI(key, preset) {
    var runBtn = byId('ne-tr-run');
    var exportBtn = byId('ne-tr-export');
    var statusEl = byId('ne-tr-status');
    var resultEl = byId('ne-tr-result');
    var traceEl = byId('ne-tr-trace');

    runBtn.disabled = true;
    exportBtn.disabled = true;
    resultEl.style.display = 'none';
    traceEl.classList.remove('open');
    statusEl.textContent = '\u23F3 ' + (t('Running') + ': ' + (preset.title || key) + '...');
    statusEl.className = 'ne-tr-status running';

    try {
        var result = await globalThis.__ne_debug.runTest(preset);
        _lastTestResult = result;

        statusEl.textContent = t('Done') + ' \u2014 ' + result.roundCount + t(' rounds, ') + (result.totalDurationMs / 1000).toFixed(1) + 's';
        statusEl.className = 'ne-tr-status';

        renderTestResult(result, resultEl, traceEl);
        exportBtn.disabled = false;
    } catch (e) {
        statusEl.textContent = t('Error') + ': ' + e.message;
        statusEl.className = 'ne-tr-status';
    } finally {
        runBtn.disabled = false;
    }
}

function renderTestResult(result, resultEl, traceEl) {
    var html = '';

    if (result.structuralResults) {
        html += '<div class="ne-tr-result-header">\u26A0 ' + t('Structural') + '</div>';
        result.structuralResults.forEach(function(r) {
            html += '<div class="ne-tr-result-entry"><span class="' + (r.passed ? 'ne-tr-pass' : 'ne-tr-fail') + '">' + (r.passed ? '\u2714' : '\u2718') + '</span> ' + escapeHtml(r.label) + '</div>';
        });
    }

    if (result.semanticResults && result.semanticResults.length > 0) {
        html += '<div class="ne-tr-result-header">\uD83D\uDCDD ' + t('Semantic') + '</div>';
        result.semanticResults.forEach(function(r) {
            html += '<div class="ne-tr-result-entry"><span class="' + (r.passed ? 'ne-tr-pass' : 'ne-tr-fail') + '">' + (r.passed ? '\u2714' : '\u2718') + '</span> ' + escapeHtml(r.question) + '</div>';
            if (r.evaluation) {
                html += '<div class="ne-tr-semantic">' + escapeHtml(r.evaluation) + '</div>';
            }
        });
    }

    html += '<div class="ne-tr-actions" style="margin-top:6px;">' +
        '<button id="ne-tr-toggle-trace" class="ne-tr-btn">' + t('Show Trace') + '</button>' +
        '</div>';

    resultEl.innerHTML = html;
    resultEl.style.display = 'block';

    var traceContent = (result.trace || result.report || '');
    traceEl.textContent = traceContent;

    byId('ne-tr-toggle-trace').onclick = function() {
        traceEl.classList.toggle('open');
        this.textContent = traceEl.classList.contains('open') ? t('Hide Trace') : t('Show Trace');
    };
}

async function exportTestResults() {
    if (!_lastTestResult) return;

    try {
        var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('[NE] Export cancelled or failed:', e.message);
        return;
    }

    var ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    var select = byId('ne-tr-select');
    var name = select ? select.value : 'test';
    var folder = select && select.selectedOptions && select.selectedOptions[0] ? select.selectedOptions[0].text : name;

    try {
        var subDir = await handle.getDirectoryHandle(folder, { create: true });

        if (_lastTestResult.trace) {
            var fh = await subDir.getFileHandle(name + '-' + ts + '-trace.md', { create: true });
            var w = await fh.createWritable();
            await w.write(_lastTestResult.trace);
            await w.close();
        }

        if (_lastTestResult.report) {
            var fh2 = await subDir.getFileHandle(name + '-' + ts + '-report.md', { create: true });
            var w2 = await fh2.createWritable();
            await w2.write(_lastTestResult.report);
            await w2.close();
        }

        byId('ne-tr-status').textContent = '\u2705 ' + t('Exported to') + ' ' + folder + '/';
    } catch (e) {
        console.error('[NE] Export failed:', e);
        byId('ne-tr-status').textContent = '\u274C ' + t('Export failed') + ': ' + e.message;
    }
}

/* ──────── 设置面板 ──────── */

function renderSettingsTab() {
    var container = byId('ne_common_settings');
    var advContainer = byId('ne_advanced_settings');
    if (!container) return;
    var settings = {};
    try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}
    var mc = settings.memoryConfig || {};
    var secApi = {};
    try { var rawApi = localStorage.getItem('ne_secondary_api'); if (rawApi) secApi = JSON.parse(rawApi); } catch (e) {}
    var apiSplitMode = isApiSplitMode();
    var retApi = {};
    if (apiSplitMode) {
        try { var rawRet = localStorage.getItem('ne_retrieval_api'); if (rawRet) retApi = JSON.parse(rawRet); } catch (e) {}
    }
    var statusDot = '<span class="ne-status-dot" style="color:#4caf50;">\u25CF</span>';

    // === Common Settings ===
    var stmBatchAuto = isAuto('stmBatch');
    var computedBatch = computeStmBatch(getTelemetryStats().turnsPerEvent, getSTContextSize());
    var displayBatch = stmBatchAuto ? computedBatch : (settings.stmBatch || 10);
    var commonHtml = '<div class="ne-accordion open" id="ne-set-engine">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Engine') + ' ' + statusDot + '</div>' +
        '<div class="ne-accordion-body">' +
        '<div class="ne-settings-toggle-grid">' +
        '<label><input type="checkbox" id="nes_enable_state_schema" ' + (settings.enableStateSchema ? 'checked' : '') + '> <span>' + t('Enable State Schema') + '</span></label>' +
        '<label><input type="checkbox" id="nes_enable_retrieval" ' + (settings.retrievalEnabled ? 'checked' : '') + '> <span>' + t('Enable Smart Retrieval') + '</span></label>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Memory Budget') + '</span><span class="range-val" id="nes_budget_val">' + (settings.memoryBudget || 800) + ' tok</span></div>' +
        '<input type="range" id="nes_memory_budget" min="500" max="2000" step="100" value="' + (settings.memoryBudget || 800) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Controls max context tokens for memory injection. Higher = more memories visible, higher API cost.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;">' +
            '<span>' + t('STM Extraction Batch') + '</span>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
                '<label style="font-size:0.8em;display:flex;align-items:center;gap:3px;cursor:pointer;">' +
                    '<input type="checkbox" id="nes_stm_batch_auto" ' + (stmBatchAuto ? 'checked' : '') + '> Auto' +
                '</label>' +
                '<span class="range-val" id="nes_stm_batch_val">' + displayBatch + '</span>' +
            '</div>' +
        '</div>' +
        '<input type="range" id="nes_stm_batch" min="1" max="30" step="1" value="' + displayBatch + '" style="width:100%;"' + (stmBatchAuto ? ' disabled' : '') + '>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Memory extraction uses LLM to detect natural scene boundaries, not fixed message counts. This is only a hard cap — unprocessed messages beyond this force extraction. A low value makes it behave like a fixed threshold.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Max Unconsolidated STM') + '</span><span class="range-val" id="nes_stm_unconsolidated_val">' + (settings.stmMaxUnconsolidated || 5) + '</span></div>' +
        '<input type="range" id="nes_stm_max_unconsolidated" min="2" max="30" step="1" value="' + (settings.stmMaxUnconsolidated || 5) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.') + '</div>' +
        '</div></div>' +
        '<div class="ne-accordion open" id="ne-set-api">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Secondary API') + '</div>' +
        '<div class="ne-accordion-body">' +
        '<div class="ne-settings-toggle-grid" style="margin-bottom:8px;">' +
        '<label><input type="checkbox" id="nes_api_split" ' + (apiSplitMode ? 'checked' : '') + '> <span>' + t('Separate API for Retrieval') + '</span></label>' +
        '</div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 12px;">' + t('Split retrieval from maintenance API. Maintenance handles STM/State/LTM extraction; retrieval handles Smart Push / recall.') + '</div>' +
        (apiSplitMode ?
            // ── Split mode ──
            '<div style="margin-bottom:12px;padding:8px;border:1px solid var(--grey20);border-radius:6px;">' +
            '<div style="font-weight:600;margin-bottom:6px;">\u25C8 ' + t('Maintenance API (Pipeline)') + '</div>' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">STM / State / LTM extraction. Needs faithful structured output, no tool calling required.</div>' +
            '<div class="ne-settings-grid">' +
            '<div><label>' + t('API URL') + '</label><input type="text" id="nes_pipeline_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(secApi.url || '') + '"></div>' +
            '<div><label>' + t('API Key') + '</label><input type="password" id="nes_pipeline_key" placeholder="sk-..." value="' + escapeHtml(secApi.key || '') + '"></div>' +
            '<div><label>' + t('Model') + '</label><input type="text" id="nes_pipeline_model" placeholder="deepseek-v4-flash" value="' + escapeHtml(secApi.model || '') + '"></div>' +
            '</div>' +
            '<div><button class="ne-api-btn" id="nes_pipeline_connect">' + t('Connect') + '</button></div>' +
            '<div class="ne-api-status"><span class="ne-api-dot" id="nes_pipeline_dot"></span><span id="nes_pipeline_status_text">' + t('Not connected') + '</span></div>' +
            '</div>' +
            '<div style="padding:8px;border:1px solid var(--grey20);border-radius:6px;">' +
            '<div style="font-weight:600;margin-bottom:6px;">\u25C8 ' + t('Retrieval API (Smart Push)') + '</div>' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">Smart Push / recall_memory. Needs long context + function calling.</div>' +
            '<div class="ne-settings-grid">' +
            '<div><label>' + t('API URL') + '</label><input type="text" id="nes_retrieval_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(retApi.url || '') + '"></div>' +
            '<div><label>' + t('API Key') + '</label><input type="password" id="nes_retrieval_key" placeholder="sk-..." value="' + escapeHtml(retApi.key || '') + '"></div>' +
            '<div><label>' + t('Model') + '</label><input type="text" id="nes_retrieval_model" placeholder="deepseek-v4-flash" value="' + escapeHtml(retApi.model || '') + '"></div>' +
            '</div>' +
            '<div><button class="ne-api-btn" id="nes_retrieval_connect">' + t('Connect') + '</button><button class="ne-api-btn" id="nes_retrieval_test">' + t('Test Message') + '</button></div>' +
            '<div class="ne-api-status"><span class="ne-api-dot" id="nes_retrieval_dot"></span><span id="nes_retrieval_status_text">' + t('Not connected') + '</span></div>' +
            '</div>'
            :
            // ── Unified mode ──
            '<div class="ne-settings-grid">' +
            '<div><label>' + t('API URL') + '</label><input type="text" id="nes_secondary_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(secApi.url || '') + '"></div>' +
            '<div><label>' + t('API Key') + '</label><input type="password" id="nes_secondary_key" placeholder="sk-..." value="' + escapeHtml(secApi.key || '') + '"></div>' +
            '<div><label>' + t('Model') + '</label><input type="text" id="nes_secondary_model" placeholder="deepseek-v4-flash" value="' + escapeHtml(secApi.model || '') + '"></div>' +
            '</div>' +
            '<div><button class="ne-api-btn" id="nes_api_connect">' + t('Connect') + '</button><button class="ne-api-btn" id="nes_api_test">' + t('Test Message') + '</button></div>' +
            '<div class="ne-api-status"><span class="ne-api-dot" id="nes_api_dot"></span><span id="nes_api_status_text">' + t('Not connected') + '</span></div>'
        ) +
        '</div></div>';
    container.innerHTML = commonHtml;

    // Auto-initialize API status if config exists (from auto-connect on page load)
    if (apiSplitMode) {
        if (retApi.url && retApi.model) {
            setTimeout(function () {
                var dot = byId('nes_retrieval_dot'), text = byId('nes_retrieval_status_text');
                testSecondaryApiConnection(retApi).then(function (r) {
                    if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                    if (text) text.textContent = r.success ? (t('Connected') + ': ' + retApi.model) : (t('Not connected') + ' — ' + (r.error || ''));
                });
            }, 100);
        }
        if (secApi.url && secApi.model) {
            setTimeout(function () {
                var dot = byId('nes_pipeline_dot'), text = byId('nes_pipeline_status_text');
                testSecondaryApiConnection(secApi).then(function (r) {
                    if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                    if (text) text.textContent = r.success ? (t('Connected') + ': ' + secApi.model) : (t('Not connected') + ' — ' + (r.error || ''));
                });
            }, 100);
        }
    } else {
        if (secApi.url && secApi.model) {
            setTimeout(function () {
                var dot = byId('nes_api_dot'), text = byId('nes_api_status_text');
                testSecondaryApiConnection(secApi).then(function (r) {
                    if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                    if (text) text.textContent = r.success ? (t('Connected') + ': ' + secApi.model) : (t('Not connected') + ' — ' + (r.error || ''));
                    var hdr = byId('narrative_secondary_api_status');
                    if (hdr) { hdr.style.color = r.success ? '#4caf50' : '#666'; hdr.textContent = r.success ? '\u26A1' : ''; hdr.title = r.success ? 'Secondary API: ' + secApi.model : 'No secondary API configured'; }
                });
            }, 100);
        }
    }

    // === Advanced Settings ===
    if (advContainer) {
        var advHtml = '<div class="ne-accordion" id="ne-set-memory">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Memory Parameters') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<div class="ne-settings-grid">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Extraction Temperature (rec. 0.2)') + '</span><span class="range-val" id="nes_extraction_temp_val">' + (mc.extraction_temperature || mc.temperature || 0.2).toFixed(1) + '</span></div>' +
            '<input type="range" id="nes_extraction_temperature" min="0" max="1" step="0.1" value="' + (mc.extraction_temperature || mc.temperature || 0.2) + '" style="width:100%;">' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('STM/State/LTM memory extraction. Lower = more consistent summaries.') + '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Retrieval Temperature (rec. 0.3)') + '</span><span class="range-val" id="nes_retrieval_temp_val">' + (mc.retrieval_temperature || mc.temperature || 0.3).toFixed(1) + '</span></div>' +
            '<input type="range" id="nes_retrieval_temperature" min="0" max="1" step="0.1" value="' + (mc.retrieval_temperature || mc.temperature || 0.3) + '" style="width:100%;">' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Smart retrieval and tool queries. Higher = more creative answers.') + '</div>' +
            '</div></div></div>' +
            '<div class="ne-accordion" id="ne-set-schema">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Schema Editors') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<label>' + t('State Schema') + ' (Global)</label><textarea id="nes_state_schema" rows="6">' + escapeHtml(settings.stateSchema ? JSON.stringify(settings.stateSchema, null, 2) : '') + '</textarea>' +
            '<label>' + t('Character Schema') + '</label><textarea id="nes_character_schema" rows="6">' + escapeHtml(settings.characterSchema ? JSON.stringify(settings.characterSchema, null, 2) : '') + '</textarea>' +
            '</div></div>';
        advContainer.innerHTML = advHtml;
    }

    // --- Event bindings (save on every change) ---
    // Range sliders — update value display + save
    var tEl = byId('nes_extraction_temperature');
    if (tEl) { tEl.oninput = function () { var v = byId('nes_extraction_temp_val'); if (v) v.textContent = Number(tEl.value).toFixed(1); saveSettingsTab(); }; }
    var rEl = byId('nes_retrieval_temperature');
    if (rEl) { rEl.oninput = function () { var v = byId('nes_retrieval_temp_val'); if (v) v.textContent = Number(rEl.value).toFixed(1); saveSettingsTab(); }; }
    var bEl = byId('nes_memory_budget');
    if (bEl) { bEl.oninput = function () { var v = byId('nes_budget_val'); if (v) v.textContent = bEl.value; saveSettingsTab(); }; }
    var sbEl = byId('nes_stm_batch');
    if (sbEl) { sbEl.oninput = function () { var v = byId('nes_stm_batch_val'); if (v) v.textContent = sbEl.value; saveSettingsTab(); }; }
    var suEl = byId('nes_stm_max_unconsolidated');
    if (suEl) { suEl.oninput = function () { var v = byId('nes_stm_unconsolidated_val'); if (v) v.textContent = suEl.value; saveSettingsTab(); }; }
    // Checkboxes — save on change
    var chkState = byId('nes_enable_state_schema');
    if (chkState) chkState.onchange = function () { saveSettingsTab(); };
    var chkRetrieval = byId('nes_enable_retrieval');
    if (chkRetrieval) chkRetrieval.onchange = function () { saveSettingsTab(); };
    // Auto toggles — save to params auto map and re-render
    var autoSb = byId('nes_stm_batch_auto');
    if (autoSb) {
        autoSb.onchange = function () {
            setAuto('stmBatch', autoSb.checked);
            renderSettingsTab();
        };
    }
    // Textareas — save on blur (not every keystroke to avoid perf issues)
    var ta1 = byId('nes_state_schema');
    if (ta1) ta1.onblur = function () { saveSettingsTab(); };
    var ta2 = byId('nes_character_schema');
    if (ta2) ta2.onblur = function () { saveSettingsTab(); };
    // Secondary API inputs — save on blur
    // ── API split toggle ──
    var splitToggle = byId('nes_api_split');
    if (splitToggle) {
        splitToggle.onchange = function () {
            setApiSplitMode(splitToggle.checked);
            renderSettingsTab(); // 重渲染以切换表单
        };
    }

    var apiSplitModeNow = isApiSplitMode();
    if (apiSplitModeNow) {
        // ── Split mode handlers ──
        // Pipeline auto-save
        var pUrlEl = byId('nes_pipeline_url');
        if (pUrlEl) pUrlEl.onchange = function () { saveSecApiOnly(); };
        var pKeyEl = byId('nes_pipeline_key');
        if (pKeyEl) pKeyEl.onchange = function () { saveSecApiOnly(); };
        var pModelEl = byId('nes_pipeline_model');
        if (pModelEl) pModelEl.onchange = function () { saveSecApiOnly(); };
        var pConnBtn = byId('nes_pipeline_connect');
        if (pConnBtn) pConnBtn.onclick = function () {
            var cfg = { url: byId('nes_pipeline_url').value.trim(), key: byId('nes_pipeline_key').value.trim(), model: byId('nes_pipeline_model').value.trim() };
            saveSecondaryApiConfig(cfg);
            var dot = byId('nes_pipeline_dot'), text = byId('nes_pipeline_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (pConnBtn) pConnBtn.disabled = true;
            testSecondaryApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model) : (t('Not connected') + ' — ' + (r.error || ''));
                if (pConnBtn) pConnBtn.disabled = false;
            });
        };

        // Retrieval auto-save
        var rUrlEl = byId('nes_retrieval_url');
        if (rUrlEl) rUrlEl.onchange = function () { saveRetApiOnly(); };
        var rKeyEl = byId('nes_retrieval_key');
        if (rKeyEl) rKeyEl.onchange = function () { saveRetApiOnly(); };
        var rModelEl = byId('nes_retrieval_model');
        if (rModelEl) rModelEl.onchange = function () { saveRetApiOnly(); };
        var rConnBtn = byId('nes_retrieval_connect');
        if (rConnBtn) rConnBtn.onclick = function () {
            var cfg = { url: byId('nes_retrieval_url').value.trim(), key: byId('nes_retrieval_key').value.trim(), model: byId('nes_retrieval_model').value.trim() };
            saveRetrievalApiConfig(cfg);
            var dot = byId('nes_retrieval_dot'), text = byId('nes_retrieval_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (rConnBtn) rConnBtn.disabled = true;
            testSecondaryApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model) : (t('Not connected') + ' — ' + (r.error || ''));
                if (rConnBtn) rConnBtn.disabled = false;
            });
        };
        var rTestBtn = byId('nes_retrieval_test');
        if (rTestBtn) rTestBtn.onclick = function () {
            var cfg = { url: byId('nes_retrieval_url').value.trim(), key: byId('nes_retrieval_key').value.trim(), model: byId('nes_retrieval_model').value.trim() };
            if (!cfg.url) { alert('Please enter an API URL first.'); return; }
            if (rTestBtn) rTestBtn.disabled = true;
            sendSecondaryTestMessage(cfg).then(function () {
                typeof toastr !== 'undefined' && toastr.success(t('API connection successful!'));
                if (rTestBtn) rTestBtn.disabled = false;
            }).catch(function (e) {
                typeof toastr !== 'undefined' && toastr.error(t('API connection failed. Check browser console (F12) for details.'));
                if (rTestBtn) rTestBtn.disabled = false;
            });
        };
    } else {
        // ── Unified mode handlers ──
        var urlEl = byId('nes_secondary_url');
        if (urlEl) urlEl.onchange = function () { saveSecApiOnly(); };
        var keyEl = byId('nes_secondary_key');
        if (keyEl) keyEl.onchange = function () { saveSecApiOnly(); };
        var modelEl = byId('nes_secondary_model');
        if (modelEl) modelEl.onchange = function () { saveSecApiOnly(); };
        var connBtn = byId('nes_api_connect');
        if (connBtn) connBtn.onclick = function () {
            var cfg = { url: byId('nes_secondary_url').value.trim(), key: byId('nes_secondary_key').value.trim(), model: byId('nes_secondary_model').value.trim() };
            saveSecondaryApiConfig(cfg);
            var dot = byId('nes_api_dot'), text = byId('nes_api_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (connBtn) connBtn.disabled = true;
            testSecondaryApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model) : (t('Not connected') + ' — ' + (r.error || ''));
                if (connBtn) connBtn.disabled = false;
                var hdr = byId('narrative_secondary_api_status');
                if (hdr) { hdr.style.color = r.success ? '#4caf50' : '#666'; hdr.textContent = r.success ? '\u26A1' : ''; hdr.title = r.success ? 'Secondary API: ' + cfg.model : 'No secondary API configured'; }
            });
        };
        var testBtn = byId('nes_api_test');
        if (testBtn) testBtn.onclick = function () {
            var cfg = { url: byId('nes_secondary_url').value.trim(), key: byId('nes_secondary_key').value.trim(), model: byId('nes_secondary_model').value.trim() };
            if (!cfg.url) { alert('Please enter an API URL first.'); return; }
            if (testBtn) testBtn.disabled = true;
            sendSecondaryTestMessage(cfg).then(function () {
                typeof toastr !== 'undefined' && toastr.success(t('API connection successful!'));
                if (testBtn) testBtn.disabled = false;
            }).catch(function (e) {
                typeof toastr !== 'undefined' && toastr.error(t('API connection failed. Check browser console (F12) for details.'));
                if (testBtn) testBtn.disabled = false;
            });
        };
    }
}

function saveSettingsTab() {
    var settings = {
        enableStateSchema: byId('nes_enable_state_schema').checked,
        useDynamicState: false,
        retrievalEnabled: byId('nes_enable_retrieval').checked,
        memoryBudget: Number(byId('nes_memory_budget').value),
        stmBatch: (byId('nes_stm_batch_auto') && byId('nes_stm_batch_auto').checked) ? 'auto' : Number(byId('nes_stm_batch').value),
        stmMaxUnconsolidated: Number(byId('nes_stm_max_unconsolidated').value),
        memoryConfig: {
            extraction_temperature: Number(byId('nes_extraction_temperature').value),
            retrieval_temperature: Number(byId('nes_retrieval_temperature').value),
            temperature: Number(byId('nes_extraction_temperature').value)
        }
    };
    var schemaText = byId('nes_state_schema').value.trim();
    if (schemaText) {
        try { var parsed = JSON.parse(schemaText); if (typeof parsed === 'object' && parsed !== null) settings.stateSchema = parsed; } catch (e) {}
    }
    var charSchemaText = byId('nes_character_schema').value.trim();
    if (charSchemaText) {
        try { var charParsed = JSON.parse(charSchemaText); if (typeof charParsed === 'object' && charParsed !== null) settings.characterSchema = charParsed; } catch (e) {}
    }
    localStorage.setItem('ne_settings', JSON.stringify(settings));
    try {
        import('../vault/schema.js').then(function(m) {
            if (m.setDynamicStateMode) m.setDynamicStateMode(settings.useDynamicState || false);
        });
    } catch (e) {}
    var secApi = {
        url: byId('nes_secondary_url').value.trim(),
        key: byId('nes_secondary_key').value.trim(),
        model: byId('nes_secondary_model').value.trim()
    };
    saveSecondaryApiConfig(secApi);
    console.log('[NE] Settings saved from Settings tab');
}

function saveSecApiOnly() {
    var secApi = {
        url: byId('nes_secondary_url') ? byId('nes_secondary_url').value.trim() : '',
        key: byId('nes_secondary_key') ? byId('nes_secondary_key').value.trim() : '',
        model: byId('nes_secondary_model') ? byId('nes_secondary_model').value.trim() : ''
    };
    saveSecondaryApiConfig(secApi);
}

function saveRetApiOnly() {
    var retApi = {
        url: byId('nes_retrieval_url') ? byId('nes_retrieval_url').value.trim() : '',
        key: byId('nes_retrieval_key') ? byId('nes_retrieval_key').value.trim() : '',
        model: byId('nes_retrieval_model') ? byId('nes_retrieval_model').value.trim() : ''
    };
    saveRetrievalApiConfig(retApi);
}
