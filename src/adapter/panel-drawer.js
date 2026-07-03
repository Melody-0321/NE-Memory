import { write } from '../core/vault/store.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { qs, qsa, byId, pdCreate, t, closeVaultOverlay, _currentGetChatId, panelById, panelQS, panelQSA } from './panel-shared.js';
import { renderHistory, createVaultPopout } from './panel-popout.js';
import { renderUsageTab } from './panel-usage.js';

export var _currentCollapseState = {};
export var _currentChatIdForCollapse = null;
export function setCurrentChatIdForCollapse(v) { _currentChatIdForCollapse = v; }

export function saveCollapseState(chatId) {
    var state = {};
    panelQSA('#tab-memory .ne-accordion').forEach(function(acc) {
        if (acc.id) state[acc.id] = acc.classList.contains('open');
    });
    try { var k = 'ne_collapse_' + (chatId || _currentChatIdForCollapse || 'global');
        if (chatId || _currentChatIdForCollapse) localStorage.setItem(k, JSON.stringify(state)); 
    } catch(e) {}
}

export function loadCollapseState(chatId) {
    try {
        var k = 'ne_collapse_' + (chatId || 'global');
        var raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
}

export function navigateToAccordion(accId, chatId) {
    var target = panelById(accId);
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

export var _lazyRendered = {};

export function setupAccordionHandlers(chatId) {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay || overlay._neAccDel) return;
    overlay._neAccDel = true;
    overlay.addEventListener('click', function(e) {
        var path = e.composedPath();
        var header = null;
        for (var i = 0; i < path.length; i++) {
            if (path[i] && path[i].closest) {
                header = path[i].closest('.ne-vault-tab-content .ne-accordion-header');
                if (header) break;
            }
        }
        if (!header) return;
        var acc = header.closest('.ne-accordion');
        if (!acc) return;
        acc.classList.toggle('open');
        if (acc.closest('#tab-memory')) saveCollapseState(chatId);
        if (acc.classList.contains('open') && acc.id && !_lazyRendered[acc.id]) {
            _lazyRendered[acc.id] = true;
            if (acc.id === 'ne-tool-history') renderHistory(_currentGetChatId);
        }
    });
}

export function renderQuickIndex(stmCount, ltmCount, charCount, questCount, factionCount, _unused, chatId) {
    var idx = panelById('ne_quick_index');
    if (!idx) return;
    var html = '';
    var addItem = function(id, label, count, show) {
        if (show === undefined) show = count > 0;
        if (!show) return;
        html += '<span class="ne-index-item" data-target="' + id + '">' + label + (count !== null ? ' <em>' + count + '</em>' : '') + '</span>';
    };
    addItem('ne-acc-stm', 'STM', stmCount, true);
    addItem('ne-acc-ltm', 'LTM', ltmCount, true);
    addItem('ne-acc-characters', '角色', charCount, true);
    addItem('ne-acc-quests', '任务', questCount, true);
    addItem('ne-acc-factions', '势力', factionCount, true);
    idx.innerHTML = html;
    panelQSA('.ne-index-item').forEach(function(item) {
        item.onclick = function() {
            navigateToAccordion(this.getAttribute('data-target'), chatId);
        };
    });
}

export function setupTabSwitching() {
    panelQSA('.ne-vault-tab').forEach(function(tab) {
        tab.onclick = function() {
            var tabName = this.getAttribute('data-tab');
            panelQSA('.ne-vault-tab').forEach(function(t) { t.classList.remove('active'); });
            this.classList.add('active');
            panelQSA('.ne-vault-tab-content').forEach(function(c) { c.classList.remove('active'); });
            var content = panelById('tab-' + tabName);
            if (content) content.classList.add('active');
            if (tabName === 'usage') {
                try { renderUsageTab(); } catch (e) { console.warn('[NE] Usage tab render failed:', e); }
            }
        };
    });
}

export var _pendingInlineStorage = null;
export function setPendingInlineStorage(v) { _pendingInlineStorage = v; }

export function saveSingleEntry(entryType, entryId, updates) {
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
    write(getChatId(), vault).then(function () {
        console.log('[NE] saveSingleEntry: persisted ' + entryType + ' ' + entryId);
    }).catch(function (err) {
        console.error('[NE] saveSingleEntry: write failed for ' + entryType + ' ' + entryId, err);
    });
}

export function deleteSingleEntry(entryType, entryId) {
    var stored = _pendingInlineStorage;
    if (!stored || !stored.vault) return;
    var vault = stored.vault;
    var getChatId = stored.getChatId;
    var c = vault.content || {};
    if (entryType === 'stm') {
        c.unconsolidated_stm = (c.unconsolidated_stm || []).filter(function(e) { return e.id !== entryId; });
        c.stm_entries = (c.stm_entries || []).filter(function(e) { return e.id !== entryId; });
    } else {
        var targetLtm = (c.ltm_entries || []).find(function(e) { return e.id === entryId; });
        var releasedStmIds = targetLtm ? (targetLtm.stm_refs || []) : [];

        var stmEntries = c.stm_entries || [];
        var toRelease = stmEntries.filter(function(s) { return releasedStmIds.indexOf(s.id) !== -1; });
        toRelease.forEach(function(stm) {
            stm.parent_ltm = null;
            if (vault.stm_index && vault.stm_index[stm.id]) {
                vault.stm_index[stm.id].ltm_id = null;
            }
        });

        c.unconsolidated_stm = (c.unconsolidated_stm || []).concat(toRelease);

        c.stm_entries = stmEntries.filter(function(s) { return releasedStmIds.indexOf(s.id) === -1; });

        c.ltm_entries = (c.ltm_entries || []).filter(function(e) { return e.id !== entryId; });
    }
    write(getChatId(), vault).then(function () {
        console.log('[NE] deleteSingleEntry: persisted deletion of ' + entryType + ' ' + entryId);
    }).catch(function (err) {
        console.error('[NE] deleteSingleEntry: write failed for ' + entryType + ' ' + entryId, err);
    });
}

export function renderMemoryButton(getChatId) {
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

export function injectStateBanner(messageId) {
    if (globalThis.__ne_injectStateBanner) {
        globalThis.__ne_injectStateBanner(messageId);
    }
}
