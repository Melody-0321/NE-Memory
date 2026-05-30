/**
 * ui/vault-panel.js — Vault 面板（精确复制 v0.1.0 UI）
 *
 * 通过 window.parent.document 操作主 ST 页面 DOM。
 * Drawer HTML 结构与 v0.1.0 完全一致。
 */
import { read, write, rollbackByMsgIds } from '../vault/store.js';
import { listSnapshots, restoreSnapshot, deleteSnapshot } from '../vault/versions.js';
import { executeConsolidation } from '../engine/consolidate.js';
import { t_narrative } from '../i18n.js';
import { escapeHtml, formatLocalTime } from './utils.js';
import { renderStateWithTemplate, STATE_TEMPLATES } from './state-templates.js';
import { renderConfigDialog } from './config-dialog.js';
import { telemetryBuffer } from '../api/llm.js';

/* ──────── 工具 ──────── */

function t(key) { return t_narrative(key); }

var PD = window.parent.document;
function qs(sel) { return PD.querySelector(sel); }
function qsa(sel) { return PD.querySelectorAll(sel); }
function byId(id) { return PD.getElementById(id); }

function freezeIframeHeight() {
    try { if (window.frameElement) { window.frameElement.style.height = '0px'; window.frameElement.style.minHeight = '0px'; } } catch (e) {}
}

function setVaultActivity(active) {
    var el = byId('narrative_vault_activity');
    if (!el) return;
    if (active) {
        el.innerHTML = '&#9696;';
        el.style.color = '#4caf50';
        el.style.animation = 'fa-spin 1s linear infinite';
    } else {
        el.innerHTML = '&#9679;';
        el.style.color = '#888';
        el.style.animation = '';
    }
}

function injectPinCSS() {
    if (byId('ne_pin_style')) return;
    var style = PD.createElement('style');
    style.id = 'ne_pin_style';
    style.textContent = '#narrative_vault_pin{display:none}' +
        '#narrative_vault_pin:checked+label .checked{display:inline}' +
        '#narrative_vault_pin:checked+label .unchecked{display:none}' +
        '#narrative_vault_pin:not(:checked)+label .checked{display:none}' +
        '#narrative_vault_pin:not(:checked)+label .unchecked{display:inline}';
    PD.head.appendChild(style);
}

var vaultLLMLog = [];
var lastVaultStateJson = '{}';
var lastVaultStateTemplate = 'auto';

/* ──────── 面板切换 ──────── */

function createVaultPopout(getChatId) {
    var drawer = byId('narrative_vault_drawer');
    var icon = qs('#narrative_vault_toggle .drawer-icon');
    if (!drawer) return;
    var opening = !drawer.classList.contains('openDrawer');
    qsa('.openDrawer').forEach(function (el) { if (!el.classList.contains('pinnedOpen')) { el.classList.remove('openDrawer'); el.classList.add('closedDrawer'); } });
    qsa('.openIcon').forEach(function (el) { if (!el.classList.contains('drawerPinnedOpen')) { el.classList.remove('openIcon'); el.classList.add('closedIcon'); } });
    drawer.classList.toggle('openDrawer');
    drawer.classList.toggle('closedDrawer');
    if (icon) { icon.classList.toggle('openIcon'); icon.classList.toggle('closedIcon'); }
    if (opening) updateVaultViewerPopout(getChatId);
}

export function toggleVaultPanel(getChatId) { createVaultPopout(getChatId); }

/* ──────── 面板内容渲染 ──────── */

async function updateVaultViewerPopout(getChatId) {
    var loading = byId('narrative_vault_loading');
    var errDiv = byId('narrative_vault_panel_error');
    if (loading) loading.style.display = '';
    if (errDiv) errDiv.style.display = 'none';
    try {
        var vault = await read(getChatId());
        var c = vault.content || {};
        lastVaultStateJson = c.state ? JSON.stringify(c.state, null, 2) : '{}';
        lastVaultStateTemplate = c.state_template || 'auto';

        var verEl = byId('narrative_vault_panel_version');
        if (verEl) {
            var verText = t('Version:') + ' ' + (vault.version || 0);
            var ts = formatLocalTime(vault.updated_at);
            if (ts) verText += ' \u00b7 ' + ts;
            verEl.textContent = verText;
        }

        var panelBody = verEl ? verEl.parentElement : null;
        if (!panelBody) return;

        // 移除旧区块
        qsa('.narrative_state_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_opening_block').forEach(function (el) { el.remove(); });

        // State 区块
        if (c.state && Object.keys(c.state).length > 0) {
            var stateHtml = renderStateWithTemplate(c.state, lastVaultStateTemplate);
            var templateOpts = '';
            var tkeys = Object.keys(STATE_TEMPLATES);
            if (tkeys.indexOf('auto') === -1) tkeys.unshift('auto');
            for (var ti = 0; ti < tkeys.length; ti++) {
                var sel = tkeys[ti] === lastVaultStateTemplate ? ' selected' : '';
                templateOpts += '<option value="' + tkeys[ti] + '"' + sel + '>' + tkeys[ti] + '</option>';
            }
            var stmView = byId('narrative_vault_panel_stm_view');
            if (stmView) {
                stmView.insertAdjacentHTML('beforebegin',
                    '<div class="narrative_state_block" style="margin-bottom:14px;">' +
                    '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Current State') + '</div>' +
                    '<div style="background:var(--black50a);padding:8px;border-radius:4px;font-size:0.9em;">' + stateHtml + '</div>' +
                    '<div style="margin-top:4px;">' +
                    '<div style="margin-top:4px;display:flex;align-items:center;gap:6px;">' +
                    '<span style="font-size:0.85em;">' + t('State Template') + ':</span>' +
                    '<select id="narrative_state_template_sel" class="text_pole" style="font-size:0.85em;width:auto;">' + templateOpts + '</select>' +
                    '</div>' +
                    '<div style="margin-top:4px;display:flex;gap:4px;">' +
                    '<button class="narrative_btn_extract_state menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Extract State') + '</button>' +
                    '<button class="narrative_clear_state_btn menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;color:#f44336;">' + t('Clear') + '</button>' +
                    '</div></div></div>'
                );
            }
        }

        // Opening 区块
        if (c.opening_summary && c.opening_summary.text) {
            var stmView2 = byId('narrative_vault_panel_stm_view');
            if (stmView2) {
                stmView2.insertAdjacentHTML('beforebegin',
                    '<div class="narrative_opening_block" style="margin-bottom:14px;"><div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Opening Scene') + '</div>' +
                    '<div style="background:var(--black50a);padding:8px;border-radius:4px;white-space:pre-wrap;font-size:0.9em;">' + escapeHtml(c.opening_summary.text) + '</div></div>'
                );
            }
        }

        var stmIndexMap = {};
        (c.stm_entries || []).forEach(function (s) { stmIndexMap[s.id] = s; });
        (c.unconsolidated_stm || []).forEach(function (s) { stmIndexMap[s.id] = s; });

        renderMemoryTable('#narrative_vault_panel_ltm_body', c.ltm_entries || [], 'ltm', stmIndexMap);
        renderMemoryTable('#narrative_vault_panel_stm_body', c.unconsolidated_stm || [], 'stm');

        // State template change
        var stateSel = byId('narrative_state_template_sel');
        if (stateSel) {
            stateSel.onchange = async function () {
                lastVaultStateTemplate = stateSel.value;
                var vault2 = await read(getChatId());
                vault2.content.state_template = stateSel.value;
                await write(getChatId(), vault2);
                renderStateBlock();
            };
        }
        // Extract state
        qsa('.narrative_btn_extract_state').forEach(function (btn) {
            btn.onclick = function () { extractState(getChatId); };
        });
        // Clear state
        qsa('.narrative_clear_state_btn').forEach(function (btn) {
            btn.onclick = function () {
                if (confirm(t('Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.'))) {
                    c.state = {};
                    write(getChatId(), vault).then(function () { updateVaultViewerPopout(getChatId()); });
                }
            };
        });
    } catch (e) {
        if (errDiv) { errDiv.textContent = t('Failed to load vault:') + ' ' + e.message; errDiv.style.display = ''; }
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderStateBlock() {
    try {
        var vault = JSON.parse(lastVaultStateJson || '{}');
        var rendered = renderStateWithTemplate(vault, lastVaultStateTemplate);
        var container = qs('.narrative_state_block div[style*="background:var(--black50a);padding:8px"]');
        if (container) container.innerHTML = rendered;
    } catch (e) {}
}

async function extractState(getChatId) {
    setVaultActivity(true);
    try {
        var vault = await read(getChatId());
        if (!vault.content.state) vault.content.state = {};
        lastVaultStateJson = JSON.stringify(vault.content.state, null, 2);
        await executeConsolidation(getChatId());
        await updateVaultViewerPopout(getChatId);
    } catch (e) {
        console.error('[NE] Extract failed:', e);
    } finally {
        setVaultActivity(false);
    }
}

/* ──────── 编辑模式 ──────── */

var vaultEditData = null;

async function toggleVaultEditMode(getChatId) {
    var isEditing = byId('narrative_vault_panel_save_btn').style.display !== 'none';
    if (isEditing) {
        byId('narrative_vault_panel_ltm_view').style.display = '';
        byId('narrative_vault_panel_ltm_edit').style.display = 'none';
        byId('narrative_vault_panel_stm_view').style.display = '';
        byId('narrative_vault_panel_stm_edit').style.display = 'none';
        byId('narrative_vault_panel_edit_btn').textContent = t('Edit');
        byId('narrative_vault_panel_save_btn').style.display = 'none';
        vaultEditData = null;
        qsa('.narrative_opening_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_state_block').forEach(function (el) { el.style.display = ''; });
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
    byId('narrative_vault_panel_ltm_view').style.display = 'none';
    byId('narrative_vault_panel_stm_view').style.display = 'none';
    qsa('.narrative_opening_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_state_block').forEach(function (el) { el.style.display = 'none'; });

    var ltmEdit = byId('narrative_vault_panel_ltm_edit');
    ltmEdit.style.display = '';
    ltmEdit.innerHTML = '';
    var stmEdit = byId('narrative_vault_panel_stm_edit');
    stmEdit.style.display = '';
    stmEdit.innerHTML = '';

    // Opening summary edit
    var openingText = c.opening_summary && c.opening_summary.text ? c.opening_summary.text : '';
    if (openingText || true) {
        var oe = PD.createElement('div');
        oe.id = 'narrative_vault_panel_opening_edit';
        oe.style.marginBottom = '10px';
        oe.innerHTML = '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Opening Scene') + '</div>' +
            '<textarea id="narrative_vault_opening_textarea" style="width:100%;box-sizing:border-box;font-size:0.9em;resize:vertical;min-height:80px;" placeholder="Opening scene summary...">' + escapeHtml(openingText) + '</textarea>';
        byId('narrative_vault_panel_ltm_view').parentNode.insertBefore(oe, byId('narrative_vault_panel_ltm_view'));
    }

    // State edit
    if (lastVaultStateJson) {
        var se = PD.createElement('div');
        se.id = 'narrative_vault_panel_state_edit';
        se.style.marginBottom = '10px';
        se.innerHTML = '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Current State (JSON)') + '</div>' +
            '<textarea id="narrative_vault_state_textarea" style="width:100%;box-sizing:border-box;font-size:0.85em;resize:vertical;min-height:120px;font-family:monospace;" placeholder="{}">' + escapeHtml(lastVaultStateJson) + '</textarea>';
        var ltmView = byId('narrative_vault_panel_ltm_view');
        ltmView.parentNode.insertBefore(se, ltmView);
    }

    // LTM entry edit cards
    (c.ltm_entries || []).forEach(function (entry, i) {
        var card = PD.createElement('div');
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
        var card = PD.createElement('div');
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

        var openingTextarea = byId('narrative_vault_opening_textarea');
        if (openingTextarea) {
            var text = String(openingTextarea.value || '').trim();
            c.opening_summary = c.opening_summary || {};
            c.opening_summary.text = text;
            c.opening_summary.updated_at = new Date().toISOString();
        }

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
        deleteLtmIds.forEach(function (id) { c.ltm_entries = ltmList.filter(function (x) { return x.id !== id; }); });
        c.ltm_entries = ltmList.filter(function (x) { return deleteLtmIds.indexOf(x.id) === -1; });

        var stmList = c.unconsolidated_stm || [];
        stmEntries.forEach(function (e) { var f = stmList.find(function (x) { return x.id === e.id; }); if (f) { f.period = e.period; f.scene = e.scene; f.event = e.event; if (e.time_label) f.time_label = e.time_label; } });
        c.unconsolidated_stm = stmList.filter(function (x) { return deleteStmIds.indexOf(x.id) === -1; });

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

export function renderMemoryTable(tbodyId, entries, type, stmIndexMap) {
    var tbody = qs(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!entries || entries.length === 0) { tbody.innerHTML = '<tr><td colspan="4" style="color:#888;">(empty)</td></tr>'; return; }
    entries.forEach(function (entry, i) {
        var periodCell = type === 'ltm' ? (entry.period || '') : (entry.period || '') + (entry.time_label ? '\u00b7' + entry.time_label : '');
        var refs = type === 'ltm'
            ? (entry.stm_refs || []).map(function (r) { return '<span class="narrative_link stm-link" data-stm-id="' + r + '">[\u2192' + r + ']</span>'; }).join(' ')
            : (entry.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[\u2192msg#' + mid + ']</span>'; }).join(' ');
        var entryId = entry.id || (type + '_' + i);
        var toggleBtn = type === 'ltm' ? '<span class="narrative_ltm_toggle" data-ltm-id="' + entryId + '" title="Toggle STM details">\u25B6</span> ' : '';
        tbody.innerHTML += '<tr data-entry-id="' + entryId + '"><td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + periodCell + '</td><td style="font-size:0.85em;max-width:100px;">' + (entry.scene || '') + '</td><td>' + (entry.event || entry.summary || '') + ' ' + refs + '</td></tr>';
        if (type === 'ltm') {
            var detailRows = '';
            var stmRefs = entry.stm_refs || [];
            stmRefs.forEach(function (stmId) {
                var stm = stmIndexMap && stmIndexMap[stmId];
                if (stm) {
                    detailRows += '<div class="narrative_ltm_stm_entry"><span class="narrative_ltm_stm_label">' + (stm.period || '') + (stm.time_label ? '\u00b7' + stm.time_label : '') + '</span><span class="narrative_ltm_stm_scene">' + (stm.scene || '') + '</span><span class="narrative_ltm_stm_event">' + (stm.event || stm.summary || '') + '</span>' + (stm.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[\u2192msg#' + mid + ']</span>'; }).join(' ') + '</div>';
                }
            });
            if (detailRows) { tbody.innerHTML += '<tr class="narrative_ltm_detail" data-ltm-parent="' + entryId + '" style="display:none;"><td colspan="4"><div class="narrative_ltm_detail_container">' + detailRows + '</div></td></tr>'; }
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
}

/* ──────── 注入格式化 ──────── */

export function formatVaultForPrompt(vault) {
    var content = vault.content || {};
    var parts = [];
    if (vault.memory_system_prompt) { parts.push(vault.memory_system_prompt); parts.push('---'); }
    if (content.opening_summary && content.opening_summary.text) {
        parts.push('## ' + t('Opening Summary (always visible)') + '\n' + content.opening_summary.text);
        parts.push('---');
    }
    if (content.current_scene) { parts.push('## ' + t('Current Scene') + '\n' + content.current_scene); }
    if (content.state && Object.keys(content.state).length > 0) {
        parts.push('## ' + t('Current State') + '\n' + renderStateWithTemplate(content.state, content.state_template || 'auto'));
        parts.push('---');
    }
    if (content.ltm_entries && content.ltm_entries.length > 0) {
        var ltmLines = content.ltm_entries.map(function (e, i) { return '| ' + (i + 1) + ' | ' + (e.period || '') + ' | ' + (e.scene || '') + ' | ' + (e.event || '') + ' [\u2192' + (e.stm_refs || []).join(',') + '] |'; });
        parts.push('## ' + t('Long-term Memory (LTM) \u2014 Direct') + '\n| ' + t('No.') + ' | ' + t('Period') + ' | ' + t('Scene') + ' | ' + t('Event (Summary)') + ' |\n|' + '---|'.repeat(4) + '\n' + ltmLines.join('\n'));
    }
    if (content.unconsolidated_stm && content.unconsolidated_stm.length > 0) {
        var stmLines = content.unconsolidated_stm.map(function (e, i) {
            var label = e.period ? e.period + (e.time_label ? '\u00b7' + e.time_label : '') : '';
            return '| ' + (i + 1) + ' | ' + label + ' | ' + (e.scene || '') + ' | ' + (e.event || '') + ' [\u2192msg#' + (e.msg_ids || []).join(',msg#') + '] |';
        });
        parts.push('## ' + t('Short-term Memory (Unconsolidated) \u2014 Direct') + '\n| ' + t('No.') + ' | ' + t('Period') + ' | ' + t('Scene') + ' | ' + t('Event') + ' |\n|' + '---|'.repeat(4) + '\n' + stmLines.join('\n'));
    }
    parts.push('---', t('The following content is not directly injected. If needed, use lookup_stm or lookup_memory_source tool.'));
    return parts.join('\n\n');
}

/* ──────── 面板初始化 ──────── */

export async function renderVaultPanel(getChatId) {
    try {
        if (byId('narrative_vault_holder')) return;
        injectPinCSS();
        var vault = await read(getChatId());
        var c = vault.content || {};

        var drawerHtml = '<div id="narrative_vault_holder" class="drawer">' +
            '<div class="drawer-toggle" id="narrative_vault_toggle">' +
            '<div class="drawer-icon fa-solid fa-book fa-fw closedIcon" title="' + t('Memory Vault') + '"></div>' +
            '</div>' +
            '<div id="narrative_vault_drawer" class="drawer-content closedDrawer fillRight">' +
            '<div id="narrative_vault_panel_header" class="fa-solid fa-grip drag-grabber"></div>' +
            '<div class="flex-container flexnowrap">' +
            '<div class="flexFlowColumn flex-container">' +
            '<div id="narrative_vault_pin_div" class="alignitemsflexstart" title="' + t('Locked = Memory Vault panel will stay open') + '">' +
            '<input type="checkbox" id="narrative_vault_pin">' +
            '<label for="narrative_vault_pin">' +
            '<div class="fa-solid unchecked fa-unlock right_menu_button" alt=""></div>' +
            '<div class="fa-solid checked fa-lock right_menu_button" alt=""></div>' +
            '</label></div></div></div>' +
            '<h3 class="margin0" style="white-space:nowrap;font-size:var(--mainFontSize);margin:auto;padding:0 8px;">' + t('Memory Vault') + '</h3>' +
            '<div class="scrollableInner" style="padding:10px;overflow-y:auto;font-size:var(--mainFontSize);">' +
            '<div style="display:flex;align-items:center;margin-bottom:6px;">' +
            '<div id="narrative_vault_panel_version" style="font-weight:bold;"></div>' +
            '<span id="narrative_vault_activity" style="margin-left:6px;font-size:0.8em;color:#888;">\u25CF</span></div>' +
            '<div id="narrative_vault_loading">' + t('Loading...') + '</div>' +
            '<div id="narrative_vault_panel_error" style="display:none;color:#f44336;"></div>' +
            '<div style="margin-bottom:10px;">' +
            '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Short-term Memory (STM)') + '</div>' +
            '<div id="narrative_vault_panel_stm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">No.</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;">' + t('Scene') + '</th><th style="text-align:left;">' + t('Event') + '</th></tr></thead>' +
            '<tbody id="narrative_vault_panel_stm_body"></tbody></table></div>' +
            '<div id="narrative_vault_panel_stm_edit" style="display:none;"></div></div>' +
            '<div>' +
            '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Long-term Memory (LTM)') + '</div>' +
            '<div id="narrative_vault_panel_ltm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">No.</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;">' + t('Scene') + '</th><th style="text-align:left;">' + t('Event (Summary)') + '</th></tr></thead>' +
            '<tbody id="narrative_vault_panel_ltm_body"></tbody></table></div>' +
            '<div id="narrative_vault_panel_ltm_edit" style="display:none;"></div></div>' +
            '<div style="margin-top:8px;display:flex;gap:4px;white-space:nowrap;">' +
            '<button id="narrative_vault_panel_refresh" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Refresh') + '</button>' +
            '<button id="narrative_vault_panel_edit_btn" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Edit') + '</button>' +
            '<button id="narrative_vault_panel_save_btn" class="menu_button" style="display:none;font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Save') + '</button>' +
            '<button class="narrative_btn_consolidate menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Consolidate') + '</button>' +
            '</div>' +
            '<div id="narrative_vault_llm_log" style="margin-top:10px;font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_llm_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('LLM Operation Log') + '</div>' +
            '<div id="narrative_vault_llm_entries" style="display:none;max-height:250px;overflow-y:auto;"></div></div>' +
            '<div id="narrative_vault_tool_call_log" style="font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_tool_call_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('Tool Calling Log') + '</div>' +
            '<div id="narrative_vault_tool_calls" style="display:none;max-height:200px;overflow-y:auto;"></div></div>' +
            '<div style="margin-top:8px;display:flex;gap:4px;">' +
            '<button id="narrative_vault_export_btn" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Export Logs') + '</button>' +
            '</div>' +
            '<div id="narrative_vault_history_section" style="font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_history_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('History') + '</div>' +
            '<div id="narrative_vault_history_list" style="display:none;max-height:250px;overflow-y:auto;font-size:0.85em;"></div></div>' +
            '</div></div></div>';

        var holder = byId('top-settings-holder');
        if (holder) {
            holder.insertAdjacentHTML('beforeend', drawerHtml);
        } else {
            console.error('[NE] #top-settings-holder not found');
            return;
        }

        byId('narrative_vault_toggle').onclick = function () { createVaultPopout(getChatId); };
        byId('narrative_vault_panel_refresh').onclick = function () {
            setVaultActivity(true);
            updateVaultViewerPopout(getChatId).finally(function () { setVaultActivity(false); });
        };
        byId('narrative_vault_panel_edit_btn').onclick = function () { toggleVaultEditMode(getChatId); };
        byId('narrative_vault_panel_save_btn').onclick = function () { saveVaultEdits(getChatId); };

        var consolidateBtn = qs('.narrative_btn_consolidate');
        if (consolidateBtn) {
            consolidateBtn.onclick = async function () {
                await executeConsolidation(getChatId());
                updateVaultViewerPopout(getChatId());
            };
        }

        // Pin
        byId('narrative_vault_pin').onchange = function () {
            var checked = byId('narrative_vault_pin').checked;
            byId('narrative_vault_drawer').classList.toggle('pinnedOpen', checked);
            qs('#narrative_vault_toggle .drawer-icon').classList.toggle('drawerPinnedOpen', checked);
        };

        // LLM log toggle
        byId('narrative_vault_llm_toggle').onclick = function () {
            var entries = byId('narrative_vault_llm_entries');
            var h = entries.style.display !== 'none';
            entries.style.display = h ? 'none' : '';
            byId('narrative_vault_llm_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('LLM Operation Log');
            if (!h) renderLLMLog();
        };

        // LLM log entry expand/collapse
        PD.addEventListener('click', function (e) {
            var header = e.target.closest('.ne_log_header');
            if (!header) return;
            var body = header.parentElement.querySelector('.ne_log_body');
            if (!body) return;
            var vis = body.style.display !== 'none';
            body.style.display = vis ? 'none' : '';
            header.textContent = (vis ? '\u25B6' : '\u25BC') + header.textContent.substring(1);
        });

        // Tool call toggle
        byId('narrative_vault_tool_call_toggle').onclick = function () {
            var entries = byId('narrative_vault_tool_calls');
            var h = entries.style.display !== 'none';
            entries.style.display = h ? 'none' : '';
            byId('narrative_vault_tool_call_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('Tool Calling Log');
            if (!h) renderToolCallLog();
        };

        // History toggle
        byId('narrative_vault_history_toggle').onclick = function () {
            var list = byId('narrative_vault_history_list');
            var h = list.style.display !== 'none';
            list.style.display = h ? 'none' : '';
            byId('narrative_vault_history_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('History');
            if (!h) renderHistory(getChatId);
        };

        // Export logs
        byId('narrative_vault_export_btn').onclick = function () {
            var data = { llm_log: vaultLLMLog, tool_log: narrativeToolCalls, telemetry: telemetryBuffer };
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var a = PD.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'ne_telemetry_' + new Date().toISOString().split('T')[0] + '.json';
            a.click();
        };

        freezeIframeHeight();
        renderConfigDialog(getChatId);
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
    if (vaultLLMLog.length === 0) {
        html = '<div style="color:#888;padding:8px 0;">' + t('No operations logged') + '</div>';
    } else {
        vaultLLMLog.slice().reverse().forEach(function (entry) {
            html += '<div class="ne_log_entry"><div class="ne_log_header" style="cursor:pointer;font-weight:bold;color:var(--grey70);font-size:0.85em;">\u25BC ' + (entry.type || '') + ' \u00b7 ' + formatLocalTime(entry.time) + (entry.api_source ? ' \u00b7 [' + escapeHtml(entry.api_source) + ']' : '') + '</div>' +
                '<div class="ne_log_body"><div class="ne_log_label" style="color:#aaa;font-size:0.83em;">' + t('Request:') + '</div><pre class="ne_log_pre" style="margin:2px 0 6px;white-space:pre-wrap;max-height:200px;overflow-y:auto;background:var(--black50a);padding:4px;border-radius:2px;font-size:0.83em;">' + escapeHtml(entry.request || '') + '</pre>' +
                '<div class="ne_log_label" style="color:#aaa;font-size:0.83em;">' + t('Response:') + '</div><pre class="ne_log_pre" style="margin:2px 0 6px;white-space:pre-wrap;max-height:200px;overflow-y:auto;background:var(--black50a);padding:4px;border-radius:2px;font-size:0.83em;">' + escapeHtml(entry.response || '') + '</pre></div></div>';
        });
    }
    container.innerHTML = html;
}

function renderToolCallLog() {
    var container = byId('narrative_vault_tool_calls');
    if (!container) return;
    var html = '';
    if (narrativeToolCalls.length === 0) {
        html = '<div style="color:#888;padding:8px 0;">' + t('No tool calls recorded') + '</div>';
    } else {
        narrativeToolCalls.slice().reverse().forEach(function (entry) {
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
