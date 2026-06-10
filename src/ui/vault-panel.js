/**
 * ui/vault-panel.js — Vault 面板（精确复制 v0.1.0 UI）
 *
 * 通过 window.parent.document 操作主 ST 页面 DOM。
 * Drawer HTML 结构与 v0.1.0 完全一致。
 */
import { read, write, rollbackByMsgIds, isStorageBlocked } from '../vault/store.js';
import { listSnapshots, restoreSnapshot, deleteSnapshot } from '../vault/versions.js';
import { executeConsolidation } from '../engine/consolidate.js';
import { executeIncrementalUpdate } from '../engine/update.js';
import { t_narrative, t_field, setFieldLocale } from '../i18n.js';
import { escapeHtml, formatLocalTime } from './utils.js';
import { formatStateSummary, DEFAULT_CHARACTER_SCHEMA, formatCharacterSummary, formatActiveCharacterSummary, DEFAULT_FACTION_SCHEMA, formatQuestSummary, isStateSchemaEnabled, isDynamicStateMode, formatCoreStateSummary, getEffectiveSchema, buildDynamicCharacterSchema, formatEntityChainHeaders } from '../vault/schema.js';
import { telemetryBuffer, recordTelemetry, callMemoryRetrieval } from '../api/llm.js';
import { filterCandidates } from '../vault/retrieval-filter.js';
import { buildRetrievalMessages } from '../engine/retrieval.js';
import { extractEntityNames, lookupEntityChains } from '../engine/retrieval.js';
import { resolveAmbiguousReferences, resolveWithLM } from '../engine/ambiguity.js';
import { getAllChatStats } from '../engine/chat-telemetry.js';

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
    if (byId('ne_vault_bottom_style')) return;
    var style = pdCreate('style');
    style.id = 'ne_vault_bottom_style';
    style.textContent = '.ne-vault-bottom-overlay{' +
        'position:absolute;left:0;right:0;z-index:35;display:flex;flex-direction:column;' +
        'transform:translateY(100%);transition:transform .35s cubic-bezier(.4,0,.2,1);' +
        'background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border-top:1px solid var(--SmartThemeBorderColor);border-radius:12px 12px 0 0;pointer-events:none;}' +
        '.ne-vault-bottom-overlay.open{transform:translateY(0);pointer-events:auto;}' +
        '.ne-vault-collapse-bar{flex-shrink:0;display:flex;justify-content:center;align-items:center;' +
        'padding:10px 0 6px;cursor:pointer;min-height:28px;}' +
        '.ne-vault-collapse-indicator{width:48px;height:5px;background:var(--SmartThemeBorderColor);' +
        'border-radius:3px;opacity:.6;transition:opacity .2s;}' +
        '.ne-vault-collapse-bar:hover .ne-vault-collapse-indicator{opacity:1;}' +
        '.ne-vault-collapse-chevron{margin-left:4px;color:var(--SmartThemeBorderColor);font-size:10px;opacity:.6;}' +
        '.ne-vault-scroll-area{flex:1;overflow-y:auto;overflow-x:hidden;padding:0 12px 12px;}' +
        '.ne-memory-btn{cursor:pointer;border:none;background:transparent;color:var(--grey-50,#888);' +
        'font-size:1.1em;padding:4px 6px;border-radius:4px;transition:color .15s,background .15s;line-height:1;}' +
        '.ne-memory-btn:hover{color:var(--text,#ddd);background:var(--black30a);}' +
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
        '.ne-inline-edit-btn{font-size:0.75em;cursor:pointer;opacity:0.4;padding:0 3px;transition:opacity .15s;}' +
        '.ne-inline-edit-btn:hover{opacity:1;}' +
        '.ne-inline-row td{padding:2px 4px!important;}' +
        '.ne-inline-row input,.ne-inline-row textarea{width:100%;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);color:var(--text);padding:3px 6px;border-radius:3px;font-size:0.85em;font-family:inherit;}' +
        '.ne-inline-save,.ne-inline-cancel{font-size:0.75em;padding:1px 6px;cursor:pointer;border-radius:3px;margin:0 2px;}' +
        '.ne-inline-save{background:#4caf50;color:#fff;border:none;}' +
        '.ne-inline-cancel{background:transparent;color:var(--grey-50);border:1px solid var(--grey-50);}' +
        '.ne-settings-section{margin-bottom:8px;}' +
        '.ne-settings-section .ne-accordion-body{padding:8px 12px;}' +
        '.ne-settings-section label{display:block;padding:6px 0;font-size:0.9em;color:var(--text);cursor:pointer;}' +
        '.ne-settings-section input[type=text],.ne-settings-section input[type=password],.ne-settings-section input[type=number]{width:100%;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);color:var(--text);padding:6px 10px;border-radius:4px;margin:2px 0 8px;font-size:0.9em;}' +
        '.ne-settings-section textarea{width:100%;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);color:var(--text);padding:6px 10px;border-radius:4px;margin:2px 0 8px;font-family:monospace;font-size:0.8em;resize:vertical;}' +
        '.ne-settings-section input[type=range]{width:100%;margin:4px 0;}' +
        '.ne-settings-section .range-val{font-size:0.8em;color:var(--grey-50);margin-left:6px;}' +
        '.ne-settings-save-btn{margin-top:12px;padding:8px 24px;background:var(--black50a);color:var(--text);border:1px solid var(--SmartThemeBorderColor);border-radius:4px;cursor:pointer;font-size:0.95em;}' +
        '.ne-settings-save-btn:hover{background:var(--black70a);}' +
        '.ne-settings-cascade{margin-left:16px;padding-left:8px;border-left:2px solid var(--black30a);}' +
        '.ne-inline-state-edit-btn{margin-left:6px;font-size:0.75em;cursor:pointer;opacity:0.5;transition:opacity .15s;}' +
        '.ne-inline-state-edit-btn:hover{opacity:1;}' +
        '.ne-inline-state-edit-area{display:none;margin-top:6px;}' +
        '.ne-inline-state-edit-area.active{display:block;}' +
        '.ne-inline-state-edit-area textarea{width:100%;min-height:120px;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);color:var(--text);padding:6px 10px;border-radius:4px;font-family:monospace;font-size:0.85em;}' +
        '.ne-inline-state-view.hidden{display:none;}';
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

function setupAccordionHandlers(chatId) {
    qsa('#tab-memory .ne-accordion-header').forEach(function(header) {
        if (header._neAccBound) return;
        header._neAccBound = true;
        header.onclick = function() {
            var acc = header.parentElement;
            var isOpen = acc.classList.contains('open');
            var siblings = acc.parentElement.querySelectorAll(':scope > .ne-accordion');
            siblings.forEach(function(sib) { sib.classList.remove('open'); });
            if (!isOpen) acc.classList.add('open');
            saveCollapseState(chatId);
        };
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

function saveSingleEntry(chatId, entryType, entryId, updates) {
    var vault = _pendingInlineStorage;
    if (!vault) return;
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
    write(chatId, vault).then(function() {
        _pendingInlineStorage = null;
    });
}

function updateVaultOverlayGeometry() {
    var overlay = byId('ne_vault_bottom_overlay');
    var formSheld = byId('form_sheld');
    if (!overlay || !formSheld) return;
    var topBarHeight = parseFloat(getComputedStyle(PD.documentElement).getPropertyValue('--topBarBlockSize')) || 0;
    var formHeight = formSheld.offsetHeight;
    overlay.style.top = topBarHeight + 'px';
    overlay.style.height = 'calc(100vh - ' + (topBarHeight + formHeight) + 'px)';
}

function closeVaultOverlay() {
    var overlay = byId('ne_vault_bottom_overlay');
    if (overlay) overlay.classList.remove('open');
}

function renderMemoryButton(getChatId) {
    if (byId('ne_memory_button')) return;
    var leftSend = byId('leftSendForm');
    if (!leftSend) return;
    var btn = pdCreate('button');
    btn.id = 'ne_memory_button';
    btn.className = 'ne-memory-btn';
    btn.title = t('Memory Vault');
    btn.innerHTML = '<i class="fa-solid fa-book-bookmark"></i>';
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

var _vaultFormObserver = null;
function startFormHeightObserver() {
    if (_vaultFormObserver) return;
    var formSheld = byId('form_sheld');
    if (!formSheld) return;
    _vaultFormObserver = new ResizeObserver(function () {
        updateVaultOverlayGeometry();
    });
    _vaultFormObserver.observe(formSheld);
}

/* ──────── 面板切换 ──────── */

function createVaultPopout(getChatId) {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay) return;
    var opening = !overlay.classList.contains('open');
    if (opening) {
        updateVaultOverlayGeometry();
        overlay.classList.add('open');
        updateVaultViewerPopout(getChatId);
    } else {
        overlay.classList.remove('open');
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
    try {
        var vault = await read(getChatId());
        var c = vault.content || {};
        lastVaultStateJson = c.state ? JSON.stringify(c.state, null, 2) : '{}';

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

        var panelBody = verEl ? verEl.parentElement : null;
        if (!panelBody) return;

        // 移除旧区块
        qsa('.narrative_state_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_opening_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_faction_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_character_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_quest_block').forEach(function (el) { el.remove(); });

        // State 区块 → #ne_state_block_container
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

        // Character block → #ne_character_block_container
        var charContainer = byId('ne_character_block_container');
        if (charContainer && isStateSchemaEnabled()) {
            var charSchema = getCharacterSchemaForPanel(c);
            var charHtml = renderCharacterPanelHTML(c.state || {}, charSchema);
            charContainer.innerHTML = charHtml || '<div style="color:#888;font-size:0.85em;padding:4px 0;">(' + t('No character data') + ')</div>';
        }

        // Faction block → #ne_faction_block_container
        var factionContainer = byId('ne_faction_block_container');
        if (factionContainer && isStateSchemaEnabled()) {
            var factionHtml = renderFactionPanelHTML(c.state || {});
            factionContainer.innerHTML = factionHtml || '<div style="color:#888;font-size:0.85em;padding:4px 0;">(' + t('No faction data') + ')</div>';
        }

        // Quest block → #ne_quest_block_container
        var questContainer = byId('ne_quest_block_container');
        if (questContainer && isStateSchemaEnabled()) {
            var questHtml = renderQuestPanelHTML(c.state || {});
            questContainer.innerHTML = questHtml || '<div style="color:#888;font-size:0.85em;padding:4px 0;">(' + t('No quest data') + ')</div>';
        }

        var stmIndexMap = {};
        (c.stm_entries || []).forEach(function (s) { stmIndexMap[s.id] = s; });
        (c.unconsolidated_stm || []).forEach(function (s) { stmIndexMap[s.id] = s; });

        // Self-heal
        var misplacedEntries = (c.unconsolidated_stm || []).filter(function (e) { return e.parent_ltm; });
        if (misplacedEntries.length > 0) {
            console.log('[NE] Vault panel: moving ' + misplacedEntries.length + ' consolidated STM entries from unconsolidated_stm to stm_entries');
            c.stm_entries = (c.stm_entries || []).concat(misplacedEntries);
            c.unconsolidated_stm = (c.unconsolidated_stm || []).filter(function (e) { return !e.parent_ltm; });
            await write(getChatId(), vault);
            stmIndexMap = {};
            (c.stm_entries || []).forEach(function (s) { stmIndexMap[s.id] = s; });
            (c.unconsolidated_stm || []).forEach(function (s) { stmIndexMap[s.id] = s; });
        }

        var unconsolidatedSTM = c.unconsolidated_stm || [];
        var ltmCount = (c.ltm_entries || []).length;
        var stmCount = unconsolidatedSTM.length;

        renderMemoryTable('#narrative_vault_panel_ltm_body', c.ltm_entries || [], 'ltm', stmIndexMap);
        renderMemoryTable('#narrative_vault_panel_stm_body', unconsolidatedSTM, 'stm');

        // Update counts
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

        // Update quick index
        var chatId = typeof getChatId === 'function' ? getChatId() : getChatId;
        renderQuickIndex(stmCount, ltmCount, charCount, questCount, factionCount, c.state && Object.keys(c.state).length > 0, chatId);

        // State inline edit handlers
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
                    await updateVaultViewerPopout(getChatId());
                } catch(e) { alert(t('Invalid JSON') + ': ' + e.message); }
            };
        });

        // Clear state
        qsa('.narrative_clear_state_btn').forEach(function (btn) {
            btn.onclick = async function () {
                try {
                    if (confirm(t('Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.'))) {
                        c.state = {};
                        await write(getChatId(), vault);
                        await updateVaultViewerPopout(getChatId());
                    }
                } catch (e) {
                    console.warn('[NE] Clear state failed:', e);
                }
            };
        });
    } catch (e) {
        if (errDiv) { errDiv.textContent = t('Failed to load vault:') + ' ' + e.message; errDiv.style.display = ''; }
    } finally {
        if (loading) loading.style.display = 'none';
        _updatingPopout = false;
    }
}

/* ──────── 编辑模式 ──────── */

var vaultEditData = null;

async function toggleVaultEditMode(getChatId) {
    var saveBtn = byId('narrative_vault_panel_save_btn');
    if (!saveBtn) return;
    var isEditing = saveBtn.style.display !== 'none';
    if (isEditing) {
        byId('narrative_vault_panel_ltm_view').style.display = '';
        byId('narrative_vault_panel_ltm_edit').style.display = 'none';
        byId('narrative_vault_panel_stm_view').style.display = '';
        byId('narrative_vault_panel_stm_edit').style.display = 'none';
        byId('narrative_vault_panel_edit_btn').textContent = t('Edit');
        saveBtn.style.display = 'none';
        vaultEditData = null;
        qsa('.narrative_opening_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_state_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_character_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_faction_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_quest_block').forEach(function (el) { el.style.display = ''; });
        var oe = byId('narrative_vault_panel_opening_edit');
        if (oe) oe.remove();
        var se = byId('narrative_vault_panel_state_edit');
        if (se) se.remove();
        updateVaultViewerPopout(getChatId);
    } else {
        var vault = await read(getChatId());
        vaultEditData = vault;
        buildEditForms(vault, getChatId);
        byId('narrative_vault_panel_edit_btn').textContent = t('Cancel');
        byId('narrative_vault_panel_save_btn').style.display = '';
    }
}

function buildEditForms(vault, getChatId) {
    var c = vault.content || {};
    var ltmEdit = byId('narrative_vault_panel_ltm_edit');
    var stmEdit = byId('narrative_vault_panel_stm_edit');
    if (!ltmEdit || !stmEdit) return;
    byId('narrative_vault_panel_ltm_view').style.display = 'none';
    byId('narrative_vault_panel_stm_view').style.display = 'none';
    qsa('.narrative_opening_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_state_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_character_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_faction_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_quest_block').forEach(function (el) { el.style.display = 'none'; });
    ltmEdit.style.display = '';
    ltmEdit.innerHTML = '';
    stmEdit.style.display = '';
    stmEdit.innerHTML = '';

    // State edit
    if (lastVaultStateJson) {
        var se = pdCreate('div');
        se.id = 'narrative_vault_panel_state_edit';
        se.style.marginBottom = '10px';
        se.innerHTML = '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Current State (JSON)') + '</div>' +
            '<textarea id="narrative_vault_state_textarea" style="width:100%;box-sizing:border-box;font-size:0.85em;resize:vertical;min-height:120px;font-family:monospace;" placeholder="{}">' + escapeHtml(lastVaultStateJson) + '</textarea>';
        var ltmView = byId('narrative_vault_panel_ltm_view');
        if (ltmView && ltmView.parentNode) ltmView.parentNode.insertBefore(se, ltmView);
    }

    // LTM entry edit cards
    (c.ltm_entries || []).forEach(function (entry, i) {
        var card = pdCreate('div');
        card.style.cssText = 'margin:4px 0;padding:6px;background:var(--black30a);border-radius:4px;';
        card.innerHTML = '<div style="display:flex;align-items:center;gap:6px;">' +
            '<input class="narrative_edit_period" data-id="' + entry.id + '" value="' + escapeHtml(entry.period || '') + '" style="width:80px;font-size:0.85em;" placeholder="Period">' +
            '<input class="narrative_edit_scene" data-id="' + entry.id + '" value="' + escapeHtml(entry.scene || '') + '" style="flex:1;font-size:0.85em;" placeholder="Scene">' +
            '<span class="narrative_del_entry" data-id="' + entry.id + '" style="cursor:pointer;color:#f44336;font-size:0.85em;" title="' + t('Delete') + '">&#10005;</span>' +
            '</div>' +
            '<textarea class="narrative_edit_event" data-id="' + entry.id + '" style="width:100%;box-sizing:border-box;margin-top:4px;min-height:40px;font-size:0.85em;" placeholder="Event">' + escapeHtml(entry.event || '') + '</textarea>';
        ltmEdit.appendChild(card);
    });

    // STM entry edit cards
    (c.unconsolidated_stm || []).forEach(function (entry, i) {
        var card = pdCreate('div');
        card.style.cssText = 'margin:4px 0;padding:6px;background:var(--black30a);border-radius:4px;';
        card.innerHTML = '<div style="display:flex;align-items:center;gap:6px;">' +
            '<input class="narrative_edit_period" data-id="' + entry.id + '" value="' + escapeHtml(entry.period || '') + '" style="width:80px;font-size:0.85em;" placeholder="Period">' +
            '<input class="narrative_edit_scene" data-id="' + entry.id + '" value="' + escapeHtml(entry.scene || '') + '" style="flex:1;font-size:0.85em;" placeholder="Scene">' +
            '<span class="narrative_del_entry" data-id="' + entry.id + '" style="cursor:pointer;color:#f44336;font-size:0.85em;" title="' + t('Delete') + '">&#10005;</span>' +
            '</div>' +
            '<input class="narrative_edit_time_label" data-id="' + entry.id + '" value="' + escapeHtml(entry.time_label || '') + '" style="width:100%;margin-top:4px;font-size:0.85em;" placeholder="Time label">' +
            '<textarea class="narrative_edit_event" data-id="' + entry.id + '" style="width:100%;box-sizing:border-box;margin-top:4px;min-height:40px;font-size:0.85em;" placeholder="Event">' + escapeHtml(entry.event || '') + '</textarea>';
        stmEdit.appendChild(card);
    });

    // Delete entry toggle
    qsa('.narrative_del_entry').forEach(function (el) {
        el.onclick = function () {
            el.classList.toggle('deleted');
            el.style.opacity = el.classList.contains('deleted') ? '0.3' : '1';
            var card = el.parentElement.parentElement;
            if (card) card.style.opacity = el.classList.contains('deleted') ? '0.3' : '1';
        };
    });
}

async function saveVaultEdits(getChatId) {
    setVaultActivity(true);
    try {
        var vault = await read(getChatId());
        var c = vault.content || {};

        var stateTextarea = byId('narrative_vault_state_textarea');
        if (stateTextarea) {
            var st = String(stateTextarea.value || '').trim();
            if (st) {
                try { c.state = JSON.parse(st); } catch (e) { alert(t('State JSON invalid:') + ' ' + e.message); }
            } else {
                c.state = {};
            }
        }

        var ltmEntries = [];
        var deleteLtmIds = [];
        var ltmEdit = byId('narrative_vault_panel_ltm_edit');
        var cards = ltmEdit ? ltmEdit.querySelectorAll('[style*="background"]') : [];
        cards.forEach(function (card) {
            if (card.style.opacity === '0.3') {
                var delEl = card.querySelector('.narrative_del_entry');
                if (delEl && delEl.classList.contains('deleted')) deleteLtmIds.push(delEl.getAttribute('data-id'));
                return;
            }
            var periodEl = card.querySelector('.narrative_edit_period');
            if (!periodEl) return;
            var id = periodEl.getAttribute('data-id');
            ltmEntries.push({ id: id, period: periodEl.value || '', scene: (card.querySelector('.narrative_edit_scene') || {}).value || '', event: (card.querySelector('.narrative_edit_event') || {}).value || '' });
        });

        var stmEntries = [];
        var deleteStmIds = [];
        var stmEdit = byId('narrative_vault_panel_stm_edit');
        var cards2 = stmEdit ? stmEdit.querySelectorAll('[style*="background"]') : [];
        cards2.forEach(function (card) {
            if (card.style.opacity === '0.3') {
                var delEl = card.querySelector('.narrative_del_entry');
                if (delEl && delEl.classList.contains('deleted')) deleteStmIds.push(delEl.getAttribute('data-id'));
                return;
            }
            var periodEl = card.querySelector('.narrative_edit_period');
            if (!periodEl) return;
            var id = periodEl.getAttribute('data-id');
            stmEntries.push({ id: id, period: periodEl.value || '', scene: (card.querySelector('.narrative_edit_scene') || {}).value || '', event: (card.querySelector('.narrative_edit_event') || {}).value || '', time_label: (card.querySelector('.narrative_edit_time_label') || {}).value || '' });
        });

        var ltmList = c.ltm_entries || [];
        ltmEntries.forEach(function (e) { var f = ltmList.find(function (x) { return x.id === e.id; }); if (f) { f.period = e.period; f.scene = e.scene; f.event = e.event; } });
        c.ltm_entries = ltmList.filter(function (x) { return deleteLtmIds.indexOf(x.id) === -1; });

        var stmList = c.unconsolidated_stm || [];
        stmEntries.forEach(function (e) { var f = stmList.find(function (x) { return x.id === e.id; }); if (f) { f.period = e.period; f.scene = e.scene; f.event = e.event; if (e.time_label) f.time_label = e.time_label; } });

        // 收集被删 STM 的 msg_ids，回滚 processed_msg_ids 以允许重新提取
        var deletedMsgIds = [];
        deleteStmIds.forEach(function(delId) {
            var found = stmList.find(function(x) { return x.id === delId; });
            if (found && found.msg_ids) {
                found.msg_ids.forEach(function(mid) { deletedMsgIds.push(mid); });
            }
        });

        c.unconsolidated_stm = stmList.filter(function (x) { return deleteStmIds.indexOf(x.id) === -1; });

        // 清除 processed_msg_ids，让被删 STM 覆盖的消息可被 cursor engine 重新提取
        if (deletedMsgIds.length > 0) {
            rollbackByMsgIds(vault, deletedMsgIds);
        }

        vault.content = c;
        await write(getChatId(), vault);
        toggleVaultEditMode(getChatId);
    } catch (e) {
        console.error('[NE] Save edits failed:', e);
        alert(t('Save') + ' failed: ' + e.message);
    } finally {
        setVaultActivity(false);
    }
}

/* ──────── 表格渲染 ──────── */

function toggleInlineEdit(row, entryId, entryType) {
    if (!row) return;
    var cells = row.querySelectorAll('td');
    if (cells.length < 4) return;
    var origPeriod = (cells[1].textContent || '').trim();
    var origScene = (cells[2].textContent || '').trim();
    var origEvent = (cells[3].textContent || '').trim();
    row.classList.add('ne-inline-row');
    var savedHTML = row.innerHTML;
    row._neOrigHTML = savedHTML;
    row._neOrigPeriod = origPeriod;
    row._neOrigScene = origScene;
    row._neOrigEvent = origEvent;
    row.innerHTML = '<td style="text-align:center;width:2em;">' + cells[0].innerHTML + '</td>' +
        '<td><input class="ne-inline-period" value="' + escapeHtml(origPeriod) + '"></td>' +
        '<td><input class="ne-inline-scene" value="' + escapeHtml(origScene) + '"></td>' +
        '<td><textarea class="ne-inline-event" rows="2">' + escapeHtml(origEvent) + '</textarea></td>' +
        '<td><button class="ne-inline-save">\u2714</button><button class="ne-inline-cancel">\u2716</button></td>';
    row.querySelector('.ne-inline-save').onclick = function() {
        var period = row.querySelector('.ne-inline-period').value;
        var scene = row.querySelector('.ne-inline-scene').value;
        var event = row.querySelector('.ne-inline-event').value;
        saveSingleEntry(null, entryType, entryId, { period: period, scene: scene, event: event });
        row.innerHTML = row._neOrigHTML;
        row.classList.remove('ne-inline-row');
        row.querySelector('td:nth-child(2)').textContent = period;
        row.querySelector('td:nth-child(3)').textContent = scene;
        row.querySelector('td:nth-child(4)').innerHTML = escapeHtml(event);
        row._neOrigPeriod = period;
        row._neOrigScene = scene;
        row._neOrigEvent = event;
    };
    row.querySelector('.ne-inline-cancel').onclick = function() {
        row.innerHTML = row._neOrigHTML;
        row.classList.remove('ne-inline-row');
    };
}

export function renderMemoryTable(tbodyId, entries, type, stmIndexMap) {
    var tbody = qs(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!entries || entries.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="color:#888;">(empty)</td></tr>'; return; }
    entries.forEach(function (entry, i) {
        var periodCell = type === 'ltm' ? (entry.time_range || entry.period || '') : (entry.period || '') + (entry.time_label ? '\u00b7' + entry.time_label : '');
        var refs = type === 'ltm'
            ? (entry.stm_refs || []).map(function (r) { return '<span class="narrative_link stm-link" data-stm-id="' + r + '">[\u2192' + r + ']</span>'; }).join(' ')
            : (entry.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[\u2192' + mid + ']</span>'; }).join(' ');
        var entryId = entry.id || (type + '_' + i);
        var toggleBtn = type === 'ltm' ? '<span class="narrative_ltm_toggle" data-ltm-id="' + entryId + '" title="Toggle STM details">\u25B6</span> ' : '';
        tbody.innerHTML += '<tr data-entry-id="' + entryId + '"><td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + periodCell + '</td><td style="font-size:0.85em;max-width:100px;">' + (entry.scene || '') + '</td><td>' + (entry.event || entry.summary || '') + ' ' + refs + '</td><td><span class="ne-inline-edit-btn" data-entry-id="' + entryId + '" data-entry-type="' + type + '" title="Edit">\u270E</span></td></tr>';
        if (type === 'ltm') {
            var detailRows = '';
            var stmRefs = entry.stm_refs || [];
            stmRefs.forEach(function (stmId, si) {
                var stm = stmIndexMap && stmIndexMap[stmId];
                if (stm) {
                    var subPeriod = (stm.period || '') + (stm.time_label ? '\u00b7' + stm.time_label : '');
                    var subRefs = (stm.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[\u2192' + mid + ']</span>'; }).join(' ');
                    detailRows += '<tr><td style="text-align:center;color:#888;width:2em;font-size:0.8em;">' + (si + 1) + '</td><td style="white-space:nowrap;font-size:0.8em;max-width:120px;">' + subPeriod + '</td><td style="font-size:0.8em;max-width:100px;">' + (stm.scene || '') + '</td><td style="font-size:0.8em;">' + (stm.event || stm.summary || '') + ' ' + subRefs + '</td><td></td></tr>';
                }
            });
            if (detailRows) { tbody.innerHTML += '<tr class="narrative_ltm_detail" data-ltm-parent="' + entryId + '" style="display:none;"><td colspan="5"><div class="narrative_ltm_detail_container"><table class="narrative_ltm_sub_table"><tbody>' + detailRows + '</tbody></table></div></td></tr>'; }
        }
    });
    if (type === 'ltm') {
        qsa('.narrative_ltm_toggle').forEach(function (el) {
            el.onclick = function () {
                var ltmId = el.getAttribute('data-ltm-id');
                var detailRow = qs('tr.narrative_ltm_detail[data-ltm-parent="' + ltmId + '"]');
                if (detailRow) { var h = detailRow.style.display === 'none'; detailRow.style.display = h ? '' : 'none'; el.textContent = h ? '\u25BC' : '\u25B6'; }
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

export function formatVaultForPrompt(vault, chatMessages) {
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
                var topK = filterCandidates(query, allStm, ltm, 25);
                showLtm = topK.filter(function (e) { return e.__type === 'ltm'; });
                showStm = topK.filter(function (e) { return e.__type === 'stm'; });
            }
        } catch (e) {
            console.warn('[NE] BM25 filter in formatVaultForPrompt failed, using full injection:', e);
        }
    }

    if (showLtm.length > 0) {
        var ltmLines = showLtm.map(function (e, i) { return '| ' + (i + 1) + ' | ' + (e.time_range || e.period || '') + ' | ' + (e.scene || '') + ' | ' + (e.event || '') + ' [\u2192' + (e.stm_refs || []).join(',') + '] |'; });
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

    var SMART_PUSH_MIN_STM = 20;

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
            entityChains = lookupEntityChains(content, entityNames);
        } catch (e) {}
    }

    var smartPushStart = Date.now();
    var bm25Start = Date.now();

    var topCandidates;
    try {
        topCandidates = filterCandidates(query, allSTM, allLTM, 40);
    } catch (e) {
        console.warn('[NE] BM25 filter failed, falling back to full dump injection:', e);
        return buildFullDumpInjection(vault, allSTM, allLTM);
    }
    var bm25Ms = Date.now() - bm25Start;

    if (!topCandidates || topCandidates.length === 0) {
        return buildFullDumpInjection(vault, allSTM, allLTM);
    }

    var retrievalApiStart = Date.now();
    var synthesized;
    var smPushMethod;
    try {
        var messages = buildRetrievalMessages(query, topCandidates, vault, budget);
        var result = await callMemoryRetrieval(messages, { timeout: 3 });
        synthesized = result;
        smPushMethod = 'llm_synthesis';
    } catch (e) {
        console.warn('[NE] Retrieval LLM failed, using BM25 top results:', e);
        synthesized = formatBM25Results(query, topCandidates.slice(0, 5));
        smPushMethod = 'bm25_fallback';
    }
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

    // ── Layer 1: Current situation (state snapshot) ──
    if (content.state && Object.keys(content.state).length > 0 && isStateSchemaEnabled()) {
        var stateSchema = content.state_schema || null;
        var stateSummary = formatStateSummary(content.state, stateSchema);
        if (stateSummary) {
            parts.push('## Current State\n' + stateSummary);
        }
        var charSchema = isDynamicStateMode() && content.dynamic_state
            ? buildDynamicCharacterSchema(content.dynamic_state)
            : (content.character_schema || null);
        var charSummary = formatActiveCharacterSummary(content.state, charSchema);
        if (charSummary) {
            // ── 实体摘要头（容器B）──
            var chainHeaders = {};
            try {
                if (entityNames && entityNames.length > 0) {
                    var activeCharNames = [];
                    var chars = content.state.characters || {};
                    Object.keys(chars).forEach(function(name) {
                        if (chars[name] && chars[name].status === '活跃') activeCharNames.push(name);
                    });
                    chainHeaders = formatEntityChainHeaders(activeCharNames, entityChains, entityNames);
                }
            } catch (e) {}
            if (Object.keys(chainHeaders).length > 0) {
                var enhancedCharSummary = charSummary;
                Object.keys(chainHeaders).forEach(function(name) {
                    if (enhancedCharSummary.indexOf(name) !== -1) {
                        enhancedCharSummary = enhancedCharSummary.replace(
                            new RegExp('(' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':.+?)(\\n|$)'),
                            '$1 ' + chainHeaders[name] + '\n'
                        );
                    }
                });
                charSummary = enhancedCharSummary;
            }
            parts.push('## Characters\n' + charSummary);
        }
        var factionSummary = formatActiveFactionSummary(content.state);
        if (factionSummary) {
            parts.push('## Factions\n' + factionSummary);
        }
        var questSummary = formatQuestSummary(content.state);
        if (questSummary) {
            parts.push('## Quests\n' + questSummary);
        }
    }

    // ── Layer 2: Event memory (memory LLM synthesis) ──
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
                    gapMarkers.push('chain.' + name + '(' + chain.length + '条)');
                }
            });
            if (gapMarkers.length > 0) {
                parts.push('[ℹ 更多可用记忆: ' + gapMarkers.join(', ') + '  — 需要时使用 access("chain.X") ]');
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

    // ── Layer 3: Tool hints ──
    if (parts.length > 0) parts.push('---');
    parts.push('If you need more historical details, use recall_memory. To inspect specific characters, factions, quests, entity chains, or original messages, use access. [ℹ] tags above mark available chains.');

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
            return (e.event || e.summary || '').substring(0, 35)
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
        lines.push('- [' + timePart + '] ' + (c.scene || '') + ': ' + (c.event || c.summary || '') + refs);
    });

    if (allLTM && allLTM.length > 0) {
        lines.push('');
        lines.push('### Consolidated Memories');
        allLTM.forEach(function(c) {
            var timePart = (c.time_range || c.period || '');
            if (c.time_label) timePart = timePart + '·' + c.time_label;
            lines.push('- [' + timePart + '] ' + (c.scene || '') + ': ' + (c.event || c.summary || ''));
        });
    }

    return lines.join('\n');
}

export function buildStateOnlyInjection(vault) {
    var content = vault.content || {};
    var state = content.state || {};
    var parts = [];

    if (vault.memory_system_prompt) {
        parts.push(vault.memory_system_prompt);
    }

    if (state && Object.keys(state).length > 0 && isStateSchemaEnabled()) {
        var stateSchema = content.state_schema || null;
        var stateSummary = formatStateSummary(state, stateSchema);
        if (stateSummary) {
            parts.push('## Current State\n' + stateSummary);
        }
        var charSchema = isDynamicStateMode() && content.dynamic_state
            ? buildDynamicCharacterSchema(content.dynamic_state)
            : (content.character_schema || null);
        var charSummary = formatActiveCharacterSummary(state, charSchema);
        if (charSummary) {
            parts.push('## Characters\n' + charSummary);
        }
        var factionSummary = formatActiveFactionSummary(state);
        if (factionSummary) {
            parts.push('## Factions\n' + factionSummary);
        }
        var questSummary = formatQuestSummary(state);
        if (questSummary) {
            parts.push('## Quests\n' + questSummary);
        }
    }

    if (parts.length === 0) {
        return formatMinimalState(vault);
    }

    parts.push('---');
    parts.push('If you need more historical details, use recall_memory. To inspect specific characters, factions, or quests, use access.');

    return parts.join('\n\n');
}

function buildFullDumpInjection(vault, allSTM, allLTM) {
    var content = vault.content || {};
    var state = content.state || {};
    var parts = [];

    if (vault.memory_system_prompt) {
        parts.push(vault.memory_system_prompt);
    }

    if (state && Object.keys(state).length > 0 && isStateSchemaEnabled()) {
        var stateSchema = content.state_schema || null;
        var stateSummary = formatStateSummary(state, stateSchema);
        if (stateSummary) {
            parts.push('## Current State\n' + stateSummary);
        }
        var charSchema = isDynamicStateMode() && content.dynamic_state
            ? buildDynamicCharacterSchema(content.dynamic_state)
            : (content.character_schema || null);
        var charSummary = formatActiveCharacterSummary(state, charSchema);
        if (charSummary) {
            parts.push('## Characters\n' + charSummary);
        }
        var factionSummary = formatActiveFactionSummary(state);
        if (factionSummary) {
            parts.push('## Factions\n' + factionSummary);
        }
        var questSummary = formatQuestSummary(state);
        if (questSummary) {
            parts.push('## Quests\n' + questSummary);
        }
    }

    var dumpText = formatFullDump(allSTM, allLTM);
    if (dumpText) {
        if (parts.length > 0) parts.push('---');
        parts.push(dumpText);
    }

    if (parts.length === 0) {
        return formatMinimalState(vault);
    }

    parts.push('---');
    parts.push('If you need more historical details, use recall_memory. To inspect specific characters, factions, or quests, use access.');

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
            '<thead><tr><th style="text-align:center;width:2em;">No.</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;">' + t('Scene') + '</th><th style="text-align:left;">' + t('Event') + '</th><th style="width:2em;"></th></tr></thead>' +
            '<tbody id="narrative_vault_panel_stm_body"></tbody></table></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-ltm">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Long-term Memory (LTM)') + ' <span id="ne-ltm-count" style="margin-left:4px;font-weight:normal;color:var(--grey-50);font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="narrative_vault_panel_ltm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">No.</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;">' + t('Scene') + '</th><th style="text-align:left;">' + t('Event (Summary)') + '</th><th style="width:2em;"></th></tr></thead>' +
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
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">' +
            '<button id="narrative_vault_panel_refresh" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Refresh') + '</button>' +
            '<button class="narrative_btn_consolidate menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Consolidate') + '</button>' +
            '<button id="narrative_vault_process_history" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" title="' + t('Process all past messages into memories') + '">' + t('Process History') + '</button>' +
            '</div>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;">' +
            '<button id="narrative_vault_export_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Export JSON') + '</button>' +
            '<button id="narrative_vault_import_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Import JSON') + '</button>' +
            '<button id="narrative_vault_embed_chat" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" title="' + t('Embed vault into chat_metadata so it travels with chat export/backup') + '">' + t('Embed into Chat') + '</button>' +
            '</div>' +
            '<div id="narrative_vault_llm_log" style="margin-bottom:8px;font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_llm_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('LLM Operation Log') + '</div>' +
            '<div id="narrative_vault_llm_entries" style="display:none;max-height:250px;overflow-y:auto;"></div></div>' +
            '<div id="narrative_vault_tool_call_log" style="font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_tool_call_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('Tool Calling Log') + '</div>' +
            '<div id="narrative_vault_tool_calls" style="display:none;max-height:200px;overflow-y:auto;"></div></div>' +
            '<div style="margin-top:8px;display:flex;gap:4px;margin-bottom:8px;">' +
            '<button id="narrative_vault_export_btn" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Export Logs') + '</button>' +
            '</div>' +
            '<div id="narrative_vault_history_section" style="font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_history_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('History') + '</div>' +
            '<div id="narrative_vault_history_list" style="display:none;max-height:250px;overflow-y:auto;font-size:0.85em;"></div></div>' +
            '</div></div>' +
            '<div id="tab-settings" class="ne-vault-tab-content">' +
            '<div class="ne-settings-scroll" style="padding:4px 12px;overflow-y:auto;">' +
            '<div id="ne_settings_content"></div>' +
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
        startFormHeightObserver();
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
                try {
                    setVaultActivity(true);
                    await executeConsolidation(getChatId());
                    await updateVaultViewerPopout(getChatId());
                } catch (e) {
                    console.error('[NE] Consolidation failed:', e);
                    alert(t('Consolidation failed') + ': ' + e.message);
                } finally {
                    setVaultActivity(false);
                }
            };
        }

        var processHistoryBtn = byId('narrative_vault_process_history');
        if (processHistoryBtn) {
            processHistoryBtn.onclick = async function () {
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
                chatMessages.forEach(function (msg) {
                    var content = msg.mes || '';
                    if (content.trim().length > 0) {
                        toProcess.push({
                            id: msg.id || msg.mes_id,
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

                var prevText = processHistoryBtn.textContent;
                processHistoryBtn.textContent = t('Processing...');
                processHistoryBtn.disabled = true;
                var BATCH = 10;
                var totalBatches = Math.ceil(toProcess.length / BATCH);

                var cpKey = 'ne_ph_' + getChatId();
                var startBatch = 0;
                try {
                    var cp = localStorage.getItem(cpKey);
                    if (cp) {
                        var cpData = JSON.parse(cp);
                        if (cpData.t && cpData.i < toProcess.length) {
                            startBatch = Math.floor(cpData.i / BATCH);
                            console.log('[NE] Resuming Process History from batch', startBatch + 1, '/', totalBatches);
                        }
                    }
                } catch (e) {}

                try {
                    for (var i = startBatch * BATCH; i < toProcess.length; i += BATCH) {
                        var batch = toProcess.slice(i, i + BATCH);
                        var batchNum = Math.floor(i / BATCH) + 1;
                        processHistoryBtn.textContent = t('Processing...') + ' (' + batchNum + '/' + totalBatches + ')';
                        await executeIncrementalUpdate(getChatId(), batch, true);
                        try {
                            localStorage.setItem(cpKey, JSON.stringify({ t: Date.now(), i: Math.min(i + BATCH, toProcess.length) }));
                        } catch (e2) {}
                    }
                    await executeConsolidation(getChatId());
                    try { localStorage.removeItem(cpKey); } catch (e3) {}
                } catch (e) {
                    console.error('[NE] Process history failed:', e);
                    alert(t('Process History') + ' failed: ' + e.message);
                } finally {
                    processHistoryBtn.textContent = prevText;
                    processHistoryBtn.disabled = false;
                    updateVaultViewerPopout(getChatId());
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
                        updateVaultViewerPopout(getChatId());
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

        // LLM log toggle
        byId('narrative_vault_llm_toggle').onclick = function () {
            var entries = byId('narrative_vault_llm_entries');
            if (!entries) return;
            var h = entries.style.display !== 'none';
            entries.style.display = h ? 'none' : '';
            byId('narrative_vault_llm_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('LLM Operation Log');
            if (!h) renderLLMLog();
        };

        // LLM log entry expand/collapse
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

        // Tool call toggle
        byId('narrative_vault_tool_call_toggle').onclick = function () {
            var entries = byId('narrative_vault_tool_calls');
            if (!entries) return;
            var h = entries.style.display !== 'none';
            entries.style.display = h ? 'none' : '';
            byId('narrative_vault_tool_call_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('Tool Calling Log');
            if (!h) renderToolCallLog();
        };

        // History toggle
        byId('narrative_vault_history_toggle').onclick = function () {
            var list = byId('narrative_vault_history_list');
            if (!list) return;
            var h = list.style.display !== 'none';
            list.style.display = h ? 'none' : '';
            byId('narrative_vault_history_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('History');
            if (!h) renderHistory(getChatId);
        };

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
        renderSettingsTab();
    } catch (e) {
        console.error('[NE] Vault panel render failed:', e);
    }
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
                    updateVaultViewerPopout(getChatId());
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
        container.innerHTML = '<div style="color:#f44336;">' + t('Failed to load history') + '</div>';
    }
}

/* ──────── 设置面板 ──────── */

function renderSettingsTab() {
    var container = byId('ne_settings_content');
    if (!container) return;
    var settings = {};
    try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}
    var mc = settings.memoryConfig || {};

    var html = '<div class="ne-settings-section">' +
        '<div class="ne-accordion open" id="ne-set-basic">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Basic Settings') + '</div>' +
        '<div class="ne-accordion-body">' +
        '<label><input type="checkbox" id="nes_enable_engine" ' + (settings.enabled ? 'checked' : '') + '> <span>' + t('Enable Narrative Engine') + '</span></label>' +
        '<div class="ne-settings-cascade" id="nes_gm_section"><label><input type="checkbox" id="nes_enable_gm" ' + (settings.gmEnabled ? 'checked' : '') + '> <span>' + t('Enable GM Agent') + '</span></label></div>' +
        '<div class="ne-settings-cascade" id="nes_memory_section"><label><input type="checkbox" id="nes_enable_memory" ' + (settings.memoryEnabled ? 'checked' : '') + '> <span>' + t('Enable Memory System') + '</span></label>' +
        '<div class="ne-settings-cascade"><label><input type="checkbox" id="nes_enable_state_schema" ' + (settings.enableStateSchema ? 'checked' : '') + '> <span>' + t('Enable State Schema') + '</span></label>' +
        '<div class="ne-settings-cascade"><label><input type="checkbox" id="nes_enable_dynamic" ' + (settings.useDynamicState ? 'checked' : '') + '> <span>' + t('Use Dynamic Field Discovery') + '</span></label></div>' +
        '<div class="ne-settings-cascade"><label><input type="checkbox" id="nes_enable_retrieval" ' + (settings.retrievalEnabled ? 'checked' : '') + '> <span>' + t('Enable Smart Retrieval') + '</span></label>' +
        '<div style="margin-left:1em;"><span>' + t('Memory Budget') + ': <span class="range-val" id="nes_budget_val">' + (settings.memoryBudget || 800) + '</span> tok</span>' +
        '<input type="range" id="nes_memory_budget" min="500" max="2000" step="100" value="' + (settings.memoryBudget || 800) + '" style="width:100%;"></div></div></div>' +
        '<label><input type="checkbox" id="nes_enable_ambiguity" ' + (settings.ambiguityLmEnabled ? 'checked' : '') + '> <span>' + t('Ambiguity: LM-assisted resolution') + '</span></label>' +
        '<label><input type="checkbox" id="nes_enable_retrieval_budget" ' + (settings.retrievalBudgetEnabled ? 'checked' : '') + '> <span>' + t('Enable Retrieval Budget') + '</span></label>' +
        '<label><input type="checkbox" id="nes_enable_contradiction" ' + (settings.contradictionDetectionEnabled ? 'checked' : '') + '> <span>' + t('Enable Contradiction Detection') + '</span></label>' +
        '<label><input type="checkbox" id="nes_enable_telemetry" ' + (settings.enableTelemetry ? 'checked' : '') + '> <span>' + t('Enable Telemetry') + '</span></label>' +
        '<div style="margin:6px 0;"><span>' + t('STM Extraction Batch') + ': <span class="range-val" id="nes_stm_batch_val">' + (settings.stmBatch || 10) + '</span></span>' +
        '<input type="range" id="nes_stm_batch" min="1" max="30" step="1" value="' + (settings.stmBatch || 10) + '" style="width:100%;"></div>' +
        '<div style="margin:6px 0;"><span>' + t('Max Unconsolidated STM') + ': <span class="range-val" id="nes_stm_unconsolidated_val">' + (settings.stmMaxUnconsolidated || 5) + '</span></span>' +
        '<input type="range" id="nes_stm_max_unconsolidated" min="2" max="30" step="1" value="' + (settings.stmMaxUnconsolidated || 5) + '" style="width:100%;"></div>' +
        '</div></div></div>' +
        '<div class="ne-settings-section">' +
        '<div class="ne-accordion open" id="ne-set-api">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Secondary API') + '</div>' +
        '<div class="ne-accordion-body">';

    var secApi = {};
    try { var rawApi = localStorage.getItem('ne_secondary_api'); if (rawApi) secApi = JSON.parse(rawApi); } catch (e) {}

    html += '<label>' + t('API URL') + '</label><input type="text" id="nes_secondary_url" placeholder="http://127.0.0.1:8000/llm/chat" value="' + escapeHtml(secApi.url || '') + '">' +
        '<label>' + t('API Key') + '</label><input type="password" id="nes_secondary_key" placeholder="sk-..." value="' + escapeHtml(secApi.key || '') + '">' +
        '<label>' + t('Model') + '</label><input type="text" id="nes_secondary_model" placeholder="deepseek-v4-flash" value="' + escapeHtml(secApi.model || '') + '">' +
        '</div></div></div>' +
        '<div class="ne-settings-section">' +
        '<div class="ne-accordion" id="ne-set-memory">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Memory Processing') + '</div>' +
        '<div class="ne-accordion-body">' +
        '<div style="margin:4px 0;"><span>' + t('Temperature') + ': <span class="range-val" id="nes_temp_val">' + ((mc.temperature || 0.2)).toFixed(1) + '</span></span>' +
        '<input type="range" id="nes_memory_temperature" min="0" max="1" step="0.1" value="' + (mc.temperature || 0.2) + '" style="width:100%;"></div>' +
        '<label>' + t('STM Max Output Tokens') + '</label><input type="number" id="nes_stm_max_tokens" min="100" max="4096" value="' + (mc.stm_max_tokens || 800) + '">' +
        '<label>' + t('STM Per-Event Char Limit') + '</label><input type="number" id="nes_stm_max_chars" min="20" max="500" value="' + (mc.stm_max_chars || 120) + '">' +
        '<label>' + t('LTM Max Output Tokens') + '</label><input type="number" id="nes_ltm_max_tokens" min="100" max="4096" value="' + (mc.ltm_max_tokens || 500) + '">' +
        '<label>' + t('LTM Per-Event Char Limit') + '</label><input type="number" id="nes_ltm_max_chars" min="20" max="500" value="' + (mc.ltm_max_chars || 100) + '">' +
        '</div></div></div>' +
        '<div class="ne-settings-section">' +
        '<div class="ne-accordion" id="ne-set-schema">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Schema Editors') + '</div>' +
        '<div class="ne-accordion-body">' +
        '<label>' + t('State Schema') + ' (Global)</label><textarea id="nes_state_schema" rows="6">' + escapeHtml(settings.stateSchema ? JSON.stringify(settings.stateSchema, null, 2) : '') + '</textarea>' +
        '<label>' + t('Character Schema') + '</label><textarea id="nes_character_schema" rows="6">' + escapeHtml(settings.characterSchema ? JSON.stringify(settings.characterSchema, null, 2) : '') + '</textarea>' +
        '<label><input type="checkbox" id="nes_enable_quests" ' + (settings.enableQuests ? 'checked' : '') + '> <span>' + t('Enable Quests Block') + '</span></label>' +
        '</div></div></div>' +
        '<button id="nes_save_btn" class="ne-settings-save-btn">' + t('Save Settings') + '</button>';

    container.innerHTML = html;

    byId('nes_save_btn').onclick = function () { saveSettingsTab(); };
    byId('nes_memory_temperature').oninput = function () { byId('nes_temp_val').textContent = Number(byId('nes_memory_temperature').value).toFixed(1); };
    byId('nes_memory_budget').oninput = function () { byId('nes_budget_val').textContent = byId('nes_memory_budget').value; };
    byId('nes_stm_batch').oninput = function () { byId('nes_stm_batch_val').textContent = byId('nes_stm_batch').value; };
    byId('nes_stm_max_unconsolidated').oninput = function () { byId('nes_stm_unconsolidated_val').textContent = byId('nes_stm_max_unconsolidated').value; };
}

function saveSettingsTab() {
    var settings = {
        enabled: byId('nes_enable_engine').checked,
        gmEnabled: byId('nes_enable_gm').checked,
        memoryEnabled: byId('nes_enable_memory').checked,
        enableTelemetry: byId('nes_enable_telemetry').checked,
        enableQuests: byId('nes_enable_quests').checked,
        enableStateSchema: byId('nes_enable_state_schema').checked,
        useDynamicState: byId('nes_enable_dynamic').checked,
        retrievalEnabled: byId('nes_enable_retrieval').checked,
        ambiguityLmEnabled: byId('nes_enable_ambiguity').checked,
        retrievalBudgetEnabled: byId('nes_enable_retrieval_budget').checked,
        contradictionDetectionEnabled: byId('nes_enable_contradiction').checked,
        memoryBudget: Number(byId('nes_memory_budget').value),
        stmBatch: Number(byId('nes_stm_batch').value),
        stmMaxUnconsolidated: Number(byId('nes_stm_max_unconsolidated').value),
        memoryConfig: {
            temperature: Number(byId('nes_memory_temperature').value),
            stm_max_tokens: Number(byId('nes_stm_max_tokens').value),
            stm_max_chars: Number(byId('nes_stm_max_chars').value),
            ltm_max_tokens: Number(byId('nes_ltm_max_tokens').value),
            ltm_max_chars: Number(byId('nes_ltm_max_chars').value)
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
    localStorage.setItem('ne_secondary_api', JSON.stringify(secApi));
    console.log('[NE] Settings saved from Settings tab');
}
