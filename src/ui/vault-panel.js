/**
 * ui/vault-panel.js — Vault 面板（ST 原生顶栏 drawer 风格）
 *
 * 通过 window.parent.document 操作主 ST 页面 DOM，#top-settings-holder 挂载。
 * 使用 ST 原生 drawer CSS 类体系（.drawer / .drawer-content / .fillRight 等）。
 */
import { read } from '../vault/store.js';
import { t_narrative } from '../i18n.js';
import { escapeHtml } from './utils.js';
import { renderStateWithTemplate } from './state-templates.js';

/* ──────── 工具 ──────── */

function t(key) { return t_narrative(key); }

function $pd(selector) {
    return $(selector, window.parent.document);
}

/* ──────── Drawer 创建与切换 ──────── */

export function toggleVaultPanel(getChatId) {
    var drawer = $pd('#narrative_vault_drawer');
    var icon = $pd('#narrative_vault_toggle .drawer-icon');
    var opening = !drawer.hasClass('openDrawer');

    $pd('.openDrawer').not('.pinnedOpen').removeClass('openDrawer').addClass('closedDrawer');
    $pd('.openIcon').not('.drawerPinnedOpen').removeClass('openIcon').addClass('closedIcon');

    drawer.toggleClass('openDrawer closedDrawer');
    icon.toggleClass('openIcon closedIcon');

    if (opening) refreshVaultPanel(getChatId);
}

/* ──────── 刷新面板 ──────── */

export async function refreshVaultPanel(getChatId) {
    try {
        var vault = await read(getChatId());
        var c = vault.content || {};
        var html = '';
        html += '<div style="font-weight:bold;font-size:0.9em;">' + t('Version:') + ' ' + (vault.version || 0) + '</div>';
        if (c.state && Object.keys(c.state).length > 0) {
            html += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);font-size:0.9em;">' + t('Current State') + '</div>';
            html += '<div style="font-size:0.9em;">' + renderStateWithTemplate(c.state, c.state_template || 'auto') + '</div>';
        }
        if (c.opening_summary && c.opening_summary.text) {
            html += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);font-size:0.9em;">' + t('Opening Scene') + '</div>';
            html += '<div style="white-space:pre-wrap;font-size:0.9em;">' + escapeHtml(c.opening_summary.text) + '</div>';
        }
        html += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);font-size:0.9em;">' + t('Long-term Memory (LTM)') + '</div>';
        html += '<table class="narrative_memory_table"><thead><tr><th>No.</th><th>' + t('Period') + '</th><th>' + t('Scene') + '</th><th>' + t('Event (Summary)') + '</th></tr></thead><tbody id="ne_vault_ltm_body"></tbody></table>';
        html += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);font-size:0.9em;">' + t('Short-term Memory (STM)') + '</div>';
        html += '<table class="narrative_memory_table"><thead><tr><th>No.</th><th>' + t('Period') + '</th><th>' + t('Scene') + '</th><th>' + t('Event') + '</th></tr></thead><tbody id="ne_vault_stm_body"></tbody></table>';
        html += '<div style="margin-top:8px;display:flex;gap:4px;"><button class="menu_button" style="font-size:0.85em;padding:2px 8px;" id="ne_vault_refresh">' + t('Refresh') + '</button></div>';

        var container = $pd('#narrative_vault_drawer .scrollableInner');
        container.html(html);

        var stmIndexMap = {};
        (c.stm_entries || []).forEach(function (s) { stmIndexMap[s.id] = s; });
        (c.unconsolidated_stm || []).forEach(function (s) { stmIndexMap[s.id] = s; });

        renderMemoryTable('#ne_vault_ltm_body', c.ltm_entries || [], 'ltm', stmIndexMap, $pd);
        renderMemoryTable('#ne_vault_stm_body', c.unconsolidated_stm || [], 'stm', null, $pd);

        $pd('#ne_vault_refresh').on('click', function () { refreshVaultPanel(getChatId); });
    } catch (e) {
        console.error('[NE] Refresh failed:', e);
    }
}

/* ──────── 表格渲染 ──────── */

export function renderMemoryTable(tbodyId, entries, type, stmIndexMap, $sel) {
    if (!$sel) $sel = $;
    var tbody = $sel(tbodyId).empty();
    if (!entries || entries.length === 0) { tbody.append('<tr><td colspan="4" style="color:#888;">(empty)</td></tr>'); return; }
    entries.forEach(function (entry, i) {
        var periodCell = type === 'ltm' ? (entry.period || '') : (entry.period || '') + (entry.time_label ? '\u00b7' + entry.time_label : '');
        var refs = type === 'ltm'
            ? (entry.stm_refs || []).map(function (r) { return '<span class="narrative_link stm-link" data-stm-id="' + r + '">[\u2192' + r + ']</span>'; }).join(' ')
            : (entry.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[\u2192msg#' + mid + ']</span>'; }).join(' ');
        var entryId = entry.id || (type + '_' + i);
        var toggleBtn = type === 'ltm' ? '<span class="narrative_ltm_toggle" data-ltm-id="' + entryId + '" title="Toggle STM details">\u25B6</span> ' : '';
        tbody.append('<tr data-entry-id="' + entryId + '"><td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + periodCell + '</td><td style="font-size:0.85em;max-width:100px;">' + (entry.scene || '') + '</td><td>' + (entry.event || entry.summary || '') + ' ' + refs + '</td></tr>');
        if (type === 'ltm') {
            var detailRows = '';
            var stmRefs = entry.stm_refs || [];
            stmRefs.forEach(function (stmId) {
                var stm = stmIndexMap && stmIndexMap[stmId];
                if (stm) {
                    detailRows += '<div class="narrative_ltm_stm_entry"><span class="narrative_ltm_stm_label">' + (stm.period || '') + (stm.time_label ? '\u00b7' + stm.time_label : '') + '</span><span class="narrative_ltm_stm_scene">' + (stm.scene || '') + '</span><span class="narrative_ltm_stm_event">' + (stm.event || stm.summary || '') + '</span>' + (stm.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[\u2192msg#' + mid + ']</span>'; }).join(' ') + '</div>';
                }
            });
            if (detailRows) { tbody.append('' +
                '<tr class="narrative_ltm_detail" data-ltm-parent="' + entryId + '" style="display:none;">' +
                '<td colspan="4"><div class="narrative_ltm_detail_container">' + detailRows + '</div></td></tr>'); }
        }
    });
    if (type === 'ltm') {
        $sel('.narrative_ltm_toggle').off('click').on('click', function () {
            var ltmId = $sel(this).data('ltm-id');
            var detailRow = tbody.find('tr.narrative_ltm_detail[data-ltm-parent="' + ltmId + '"]');
            if (detailRow.length) { var isHidden = detailRow.css('display') === 'none'; detailRow.toggle(); $sel(this).text(isHidden ? '\u25BC' : '\u25B6'); }
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
        if ($pd('#narrative_vault_holder').length) return;
        var vault = await read(getChatId());
        var c = vault.content || {};

        var drawerHtml = [
            '<div id="narrative_vault_holder" class="drawer">',
            '  <div class="drawer-toggle" id="narrative_vault_toggle">',
            '    <div class="drawer-icon fa-solid fa-book fa-fw closedIcon" title="' + t('Memory Vault') + '"></div>',
            '  </div>',
            '  <div id="narrative_vault_drawer" class="drawer-content closedDrawer fillRight">',
            '    <div id="narrative_vault_panel_header" style="padding:10px;display:flex;align-items:center;border-bottom:1px solid var(--black50a);cursor:move;" class="fa-solid fa-grip drag-grabber">',
            '      <span style="margin-left:8px;font-weight:bold;font-size:1.05em;">' + t('Memory Vault') + '</span>',
            '      <span style="font-size:0.8em;color:var(--grey-50,#888);margin-left:8px;">' + t('Version:') + ' ' + (vault.version || 0) + '</span>',
            '    </div>',
            '    <div class="scrollableInner" style="padding:10px;overflow-y:auto;font-size:var(--mainFontSize);"></div>',
            '  </div>',
            '</div>'
        ].join('\n');

        $pd('#top-settings-holder').append(drawerHtml);

        $pd('#narrative_vault_toggle').on('click', function () { toggleVaultPanel(getChatId); });

        var stmIndexMap = {};
        (c.stm_entries || []).forEach(function (s) { stmIndexMap[s.id] = s; });
        (c.unconsolidated_stm || []).forEach(function (s) { stmIndexMap[s.id] = s; });

        var panelHtml = '';
        if (c.state && Object.keys(c.state).length > 0) {
            panelHtml += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);font-size:0.9em;">' + t('Current State') + '</div>';
            panelHtml += '<div style="font-size:0.9em;">' + renderStateWithTemplate(c.state, c.state_template || 'auto') + '</div>';
        }
        if (c.opening_summary && c.opening_summary.text) {
            panelHtml += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);font-size:0.9em;">' + t('Opening Scene') + '</div>';
            panelHtml += '<div style="white-space:pre-wrap;font-size:0.9em;">' + escapeHtml(c.opening_summary.text) + '</div>';
        }
        panelHtml += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);font-size:0.9em;">' + t('Long-term Memory (LTM)') + '</div>';
        panelHtml += '<table class="narrative_memory_table"><thead><tr><th>No.</th><th>' + t('Period') + '</th><th>' + t('Scene') + '</th><th>' + t('Event (Summary)') + '</th></tr></thead><tbody id="ne_vault_ltm_body_1"></tbody></table>';
        panelHtml += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);font-size:0.9em;">' + t('Short-term Memory (STM)') + '</div>';
        panelHtml += '<table class="narrative_memory_table"><thead><tr><th>No.</th><th>' + t('Period') + '</th><th>' + t('Scene') + '</th><th>' + t('Event') + '</th></tr></thead><tbody id="ne_vault_stm_body_1"></tbody></table>';
        panelHtml += '<div style="margin-top:8px;display:flex;gap:4px;"><button class="menu_button" style="font-size:0.85em;padding:2px 8px;" id="ne_vault_refresh_1">' + t('Refresh') + '</button></div>';

        $pd('#narrative_vault_drawer .scrollableInner').html(panelHtml);
        renderMemoryTable('#ne_vault_ltm_body_1', c.ltm_entries || [], 'ltm', stmIndexMap, $pd);
        renderMemoryTable('#ne_vault_stm_body_1', c.unconsolidated_stm || [], 'stm', null, $pd);
        $pd('#ne_vault_refresh_1').on('click', function () { refreshVaultPanel(getChatId); });
    } catch (e) {
        console.error('[NE] Vault panel render failed:', e);
    }
}
