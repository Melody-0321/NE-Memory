/**
 * ui/vault-panel.js — Vault 面板 UI（右侧抽屉布局）
 *
 * 布局：屏幕最右侧抽屉，圆形展开按钮在右边缘（一半在内一半在外）。
 * 展开时平滑滑入，隐藏时滑出屏幕。
 */
import { read, write, rollbackByMsgIds } from '../vault/store.js';
import { listSnapshots, restoreSnapshot, deleteSnapshot } from '../vault/versions.js';
import { executeConsolidation } from '../engine/consolidate.js';
import { t_narrative } from '../i18n.js';
import { escapeHtml, formatLocalTime } from './utils.js';
import { renderStateWithTemplate, STATE_TEMPLATES } from './state-templates.js';
import { renderConfigDialog } from './config-dialog.js';
import { telemetryBuffer } from '../api/llm.js';

let vaultLLMLog = [];
let narrativeToolCalls = [];
let lastVaultStateJson = '{}';
let lastVaultStateTemplate = 'auto';
const NE_VAULT_ID = 'ne_memory_vault';

/* ──────── 工具函数 ──────── */

function t(key) { return t_narrative(key); }

/* ──────── Panel 创建与切换 ──────── */

export async function toggleVaultPanel(getChatId) {
    const panel = $('#' + NE_VAULT_ID);
    if (panel.length === 0) {
        await createVaultPanel(getChatId);
    } else {
        const isVisible = panel.css('transform') === 'none' || panel.css('transform') === 'matrix(1, 0, 0, 1, 0, 0)';
        if (isVisible) {
            panel.css('transform', 'translateX(100%)');
            $('#ne_vault_toggle').removeClass('panel-open');
        } else {
            panel.css('transform', 'translateX(0)');
            $('#ne_vault_toggle').addClass('panel-open');
            await refreshVaultPanel(getChatId);
        }
    }
}

async function showVaultPanel(getChatId) {
    $('#' + NE_VAULT_ID).css('transform', 'translateX(0)');
    $('#ne_vault_toggle').addClass('panel-open');
    await refreshVaultPanel(getChatId);
}

function hideVaultPanel() {
    $('#' + NE_VAULT_ID).css('transform', 'translateX(100%)');
    $('#ne_vault_toggle').removeClass('panel-open');
}

async function createVaultPanel(getChatId) {
    if ($('#' + NE_VAULT_ID).length) return;
    const toggleBtn = $('<div id="ne_vault_toggle" class="ne_vault_toggle" title="' + t('Memory Vault') + '">\u25C0</div>');
    $('body').append(toggleBtn);
    toggleBtn.on('click', () => toggleVaultPanel(getChatId));

    const panel = $(`<div id="${NE_VAULT_ID}" class="ne_vault_drawer">
        <div class="ne_vault_header">
            <span class="ne_vault_title">${t('Memory Vault')}</span>
            <span class="ne_vault_version" id="ne_vault_version"></span>
            <span class="ne_vault_close" id="ne_vault_close">\u00D7</span>
        </div>
        <div class="ne_vault_tabs" id="ne_vault_tabs">
            <span class="ne_vault_tab active" data-tab="state">${t('Current State')}</span>
            <span class="ne_vault_tab" data-tab="ltm">LTM</span>
            <span class="ne_vault_tab" data-tab="stm">STM</span>
            <span class="ne_vault_tab" data-tab="history">${t('History')}</span>
            <span class="ne_vault_tab" data-tab="logs">${t('LLM Operation Log')}</span>
        </div>
        <div class="ne_vault_body" id="ne_vault_body">
            <div class="ne_vault_tab_content active" id="ne_tab_state"></div>
            <div class="ne_vault_tab_content" id="ne_tab_ltm"></div>
            <div class="ne_vault_tab_content" id="ne_tab_stm"></div>
            <div class="ne_vault_tab_content" id="ne_tab_history"></div>
            <div class="ne_vault_tab_content" id="ne_tab_logs"></div>
        </div>
        <div class="ne_vault_footer">
            <button class="ne_vault_btn" id="ne_vault_btn_consolidate">${t('Consolidate')}</button>
            <button class="ne_vault_btn" id="ne_vault_btn_extract">${t('Extract State')}</button>
            <button class="ne_vault_btn" id="ne_vault_btn_settings">\u2699</button>
        </div>
    </div>`);
    $('body').append(panel);

    $('#ne_vault_close').on('click', hideVaultPanel);
    $('.ne_vault_tab').on('click', function () {
        $('.ne_vault_tab').removeClass('active');
        $(this).addClass('active');
        $('.ne_vault_tab_content').removeClass('active');
        $('#ne_tab_' + $(this).data('tab')).addClass('active');
    });
    $('#ne_vault_btn_consolidate').on('click', async () => {
        await executeConsolidation(getChatId());
        await refreshVaultPanel(getChatId);
    });
    $('#ne_vault_btn_extract').on('click', () => {
        $('.ne_vault_tab').removeClass('active');
        $('.ne_vault_tab[data-tab="state"]').addClass('active');
        $('.ne_vault_tab_content').removeClass('active');
        $('#ne_tab_state').addClass('active');
    });
    $('#ne_vault_btn_settings').on('click', () => renderConfigDialog(getChatId));
}

/* ──────── 面板内容刷新 ──────── */

export async function refreshVaultPanel(getChatId) {
    try {
        const vault = await read(getChatId());
        const c = vault.content || {};

        $('#ne_vault_version').text(t('Version:') + ' ' + (vault.version || 0) + ' \u00B7 ' + formatLocalTime(vault.updated_at));

        renderStateTab(c);
        renderLTMtab(c, vault);
        renderSTMtab(c);
        renderHistoryTab(getChatId);
        renderLogsTab();
    } catch (e) {
        console.error('[NE] Refresh failed:', e);
    }
}

/* ──────── State Tab ──────── */

function renderStateTab(c) {
    const container = $('#ne_tab_state').empty();
    let html = '';
    if (c.state && Object.keys(c.state).length > 0) {
        html += '<div class="ne_section">' +
            '<div class="ne_section_title">' + t('Current State') + '</div>' +
            '<div class="ne_state_render">' + renderStateWithTemplate(c.state, c.state_template || 'auto') + '</div>' +
            '<div class="ne_state_toolbar">' +
            '<label class="ne_inline_label">' + t('State Template') + ': <select id="ne_state_template_sel" class="text_pole ne_select">' +
            Object.keys(STATE_TEMPLATES).map(function (k) {
                return '<option value="' + k + '"' + (k === (c.state_template || 'auto') ? ' selected' : '') + '>' + k + '</option>';
            }).join('') +
            '</select></label>' +
            '<button class="ne_vault_btn_small ne_extract_state_btn">' + t('Extract State') + '</button>' +
            '<button class="ne_vault_btn_small ne_clear_state_btn" style="color:#f44336;">' + t('Clear') + '</button>' +
            '<button class="ne_vault_btn_small ne_edit_state_btn">' + t('Edit') + '</button>' +
            '</div>' +
            '<div class="ne_state_json" id="ne_state_json_block" style="display:none;"><textarea class="ne_textarea" id="ne_state_json_editor" rows="8"></textarea><button class="ne_vault_btn_small ne_save_state_btn">' + t('Save') + '</button></div>' +
            '</div>';
    }
    if (c.opening_summary && c.opening_summary.text) {
        html += '<div class="ne_section">' +
            '<div class="ne_section_title">' + t('Opening Scene') + '</div>' +
            '<div class="ne_opening_text">' + escapeHtml(c.opening_summary.text) + '</div>' +
            '</div>';
    }
    container.html(html || '<div class="ne_empty">' + t('No history yet') + '</div>');

    $('#ne_state_template_sel').on('change', function () {
        lastVaultStateTemplate = $(this).val();
        $('.ne_state_render').html(renderStateWithTemplate(c.state, lastVaultStateTemplate));
    });
    $('.ne_edit_state_btn').on('click', function () {
        var block = $('#ne_state_json_block');
        block.toggle();
        if (block.is(':visible')) {
            var raw = lastVaultStateJson !== '{}' ? lastVaultStateJson : JSON.stringify(c.state, null, 2);
            $('#ne_state_json_editor').val(raw);
        }
    });
    $('.ne_save_state_btn').on('click', async function () {
        try { JSON.parse($('#ne_state_json_editor').val()); } catch (e) { alert(t('State JSON invalid:') + ' ' + e.message); return; }
        $('.ne_state_render').html(renderStateWithTemplate(JSON.parse($('#ne_state_json_editor').val()), c.state_template || 'auto'));
        $('#ne_state_json_block').hide();
    });
    $('.ne_clear_state_btn').on('click', function () {
        if (confirm(t('Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.'))) {
            c.state = {};
            $('.ne_state_render').empty();
        }
    });
}

/* ──────── LTM Tab ──────── */

function renderLTMtab(c, vault) {
    const container = $('#ne_tab_ltm').empty();
    const stmIndexMap = {};
    (c.stm_entries || []).forEach(function (s) { stmIndexMap[s.id] = s; });
    (c.unconsolidated_stm || []).forEach(function (s) { stmIndexMap[s.id] = s; });

    var html = '<div class="ne_section"><div class="ne_section_title">' + t('Long-term Memory (LTM)') + '</div>';
    html += '<table class="narrative_memory_table"><thead><tr><th>No.</th><th>' + t('Period') + '</th><th>' + t('Scene') + '</th><th>' + t('Event (Summary)') + '</th></tr></thead><tbody id="ne_ltm_tbody"></tbody></table></div>';
    html += '<div class="ne_section_title" style="margin-top:8px;">' + t('The following content is not directly injected. If needed, use lookup_stm or lookup_memory_source tool.') + '</div>';
    container.html(html);
    renderMemoryTable('#ne_ltm_tbody', c.ltm_entries || [], 'ltm', stmIndexMap);
}

/* ──────── STM Tab ──────── */

function renderSTMtab(c) {
    const container = $('#ne_tab_stm').empty();
    var html = '<div class="ne_section"><div class="ne_section_title">' + t('Short-term Memory (Unconsolidated) \u2014 Direct') + '</div>';
    html += '<table class="narrative_memory_table"><thead><tr><th>No.</th><th>' + t('Period') + '</th><th>' + t('Scene') + '</th><th>' + t('Event') + '</th></tr></thead><tbody id="ne_stm_tbody"></tbody></table></div>';
    container.html(html);
    renderMemoryTable('#ne_stm_tbody', c.unconsolidated_stm || [], 'stm');
}

/* ──────── History Tab ──────── */

async function renderHistoryTab(getChatId) {
    const container = $('#ne_tab_history').empty();
    try {
        const snapshots = await listSnapshots(getChatId());
        if (!snapshots || snapshots.length === 0) {
            container.html('<div class="ne_empty">' + t('No history yet') + '</div>');
            return;
        }
        var html = '<div class="ne_section"><div class="ne_section_title">' + t('History') + ' (' + snapshots.length + ')</div>';
        html += '<table class="narrative_memory_table"><thead><tr><th>v</th><th>' + t('Version:').replace(':', '') + '</th><th>' + t('Scene') + '</th><th>' + t('Event') + '</th><th>' + t('Restore') + '</th><th>' + t('Delete') + '</th></tr></thead><tbody>';
        snapshots.forEach(function (s) {
            var c = s.data && s.data.content;
            var ltmCount = (c && c.ltm_entries && c.ltm_entries.length) || 0;
            var stmCount = (c && c.unconsolidated_stm && c.unconsolidated_stm.length) || 0;
            html += '<tr><td>' + s.version + '</td><td>' + formatLocalTime(s.updated_at) + '</td><td>' + ltmCount + ' LTM</td><td>' + stmCount + ' STM</td>' +
                '<td><button class="ne_vault_btn_tiny ne_restore_btn" data-ver="' + s.version + '">' + t('Restore') + '</button></td>' +
                '<td><button class="ne_vault_btn_tiny ne_del_btn" data-ver="' + s.version + '" style="color:#f44336;">' + t('Delete') + '</button></td></tr>';
        });
        html += '</tbody></table></div>';
        container.html(html);

        $('.ne_restore_btn').on('click', async function () {
            var ver = $(this).data('ver');
            if (confirm(t('Restore to version v{VER}?').replace('{VER}', ver))) {
                try {
                    await restoreSnapshot(getChatId(), ver);
                    await refreshVaultPanel(getChatId);
                } catch (e) { alert(t('Restore failed')); }
            }
        });
        $('.ne_del_btn').on('click', async function () {
            var ver = $(this).data('ver');
            if (confirm(t('Confirm delete v{VER}?').replace('{VER}', ver))) {
                try {
                    await deleteSnapshot(getChatId(), ver);
                    await renderHistoryTab(getChatId);
                } catch (e) { alert(t('Delete failed')); }
            }
        });
    } catch (e) {
        container.html('<div class="ne_empty">' + t('Failed to load history') + '</div>');
    }
}

/* ──────── Logs Tab ──────── */

function renderLogsTab() {
    const container = $('#ne_tab_logs').empty();
    var html = '';

    html += '<div class="ne_section"><div class="ne_section_title">' + t('LLM Operation Log') + ' <button class="ne_vault_btn_tiny ne_export_btn" style="float:right;">' + t('Export Logs') + '</button></div>';
    if (vaultLLMLog.length === 0) {
        html += '<div class="ne_empty">' + t('No operations logged') + '</div>';
    } else {
        vaultLLMLog.slice().reverse().forEach(function (entry) {
            html += '<div class="ne_log_entry"><div class="ne_log_header">\u25BC ' + (entry.type || '') + ' \u00B7 ' + formatLocalTime(entry.time) +
                (entry.api_source ? ' \u00B7 [' + escapeHtml(entry.api_source) + ']' : '') + '</div>' +
                '<div class="ne_log_body"><div class="ne_log_label">Request:</div><pre class="ne_log_pre">' + escapeHtml(entry.request || '') + '</pre>' +
                '<div class="ne_log_label">Response:</div><pre class="ne_log_pre">' + escapeHtml(entry.response || '') + '</pre></div></div>';
        });
    }
    html += '</div>';

    html += '<div class="ne_section" style="margin-top:8px;"><div class="ne_section_title">' + t('Tool Calling Log') + '</div>';
    if (narrativeToolCalls.length === 0) {
        html += '<div class="ne_empty">' + t('No tool calls recorded') + '</div>';
    } else {
        narrativeToolCalls.slice().reverse().forEach(function (entry) {
            var icon = entry.success ? '\uD83D\uDFE2' : '\uD83D\uDD34';
            var dur = entry.duration_ms > 1000 ? (entry.duration_ms / 1000).toFixed(1) + 's' : entry.duration_ms + 'ms';
            html += '<div class="ne_tool_entry">' + icon + ' ' + escapeHtml(entry.tool) +
                ' \u00B7 ' + formatLocalTime(entry.ts) + ' \u00B7 ' + dur +
                (entry.result_summary ? ' \u00B7 ' + escapeHtml(entry.result_summary) : '') +
                (entry.error_info ? ' \u00B7 <span style="color:#f44336;">' + escapeHtml(entry.error_info) + '</span>' : '') + '</div>';
        });
    }
    html += '</div>';

    container.html(html);

    $('.ne_export_btn').on('click', function () {
        var data = { llm_log: vaultLLMLog, tool_log: narrativeToolCalls, telemetry: telemetryBuffer };
        var json = JSON.stringify(data, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ne_telemetry_' + new Date().toISOString().split('T')[0] + '.json';
        a.click();
    });
}

/* ──────── 记忆表格渲染 ──────── */

export function renderMemoryTable(tbodyId, entries, type, stmIndexMap) {
    const tbody = $(tbodyId).empty();
    if (!entries || entries.length === 0) {
        tbody.append('<tr><td colspan="4" style="color:#888;">(empty)</td></tr>');
        return;
    }
    entries.forEach(function (entry, i) {
        var periodCell = type === 'ltm' ? (entry.period || '') : (entry.period || '') + (entry.time_label ? '\u00b7' + entry.time_label : '');
        var refs = type === 'ltm'
            ? (entry.stm_refs || []).map(function (r) { return '<span class="narrative_link stm-link" data-stm-id="' + r + '">[→' + r + ']</span>'; }).join(' ')
            : (entry.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[→msg#' + mid + ']</span>'; }).join(' ');
        var entryId = entry.id || (type + '_' + i);
        var toggleBtn = type === 'ltm' ? '<span class="narrative_ltm_toggle" data-ltm-id="' + entryId + '" title="Toggle STM details">\u25B6</span> ' : '';
        tbody.append('<tr data-entry-id="' + entryId + '"><td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + periodCell + '</td><td style="font-size:0.85em;max-width:100px;">' + (entry.scene || '') + '</td><td>' + (entry.event || entry.summary || '') + ' ' + refs + '</td></tr>');
        if (type === 'ltm') {
            var detailRows = '';
            var stmRefs = entry.stm_refs || [];
            stmRefs.forEach(function (stmId) {
                var stm = stmIndexMap && stmIndexMap[stmId];
                if (stm) {
                    detailRows += '<div class="narrative_ltm_stm_entry"><span class="narrative_ltm_stm_label">' + (stm.period || '') + (stm.time_label ? '\u00b7' + stm.time_label : '') + '</span><span class="narrative_ltm_stm_scene">' + (stm.scene || '') + '</span><span class="narrative_ltm_stm_event">' + (stm.event || stm.summary || '') + '</span>' + (stm.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[→msg#' + mid + ']</span>'; }).join(' ') + '</div>';
                } else {
                    detailRows += '<div class="narrative_ltm_stm_entry narrative_ltm_stm_missing"><span class="narrative_ltm_stm_label">' + stmId + '</span> <span style="color:#888;">(not loaded)</span></div>';
                }
            });
            if (detailRows) {
                tbody.append('<tr class="narrative_ltm_detail" data-ltm-parent="' + entryId + '" style="display:none;"><td colspan="4"><div class="narrative_ltm_detail_container">' + detailRows + '</div></td></tr>');
            }
        }
    });
    if (type === 'ltm') {
        $('.narrative_ltm_toggle').off('click').on('click', function () {
            var ltmId = $(this).data('ltm-id');
            var detailRow = tbody.find('tr.narrative_ltm_detail[data-ltm-parent="' + ltmId + '"]');
            if (detailRow.length) {
                var isHidden = detailRow.css('display') === 'none';
                detailRow.toggle();
                $(this).text(isHidden ? '\u25BC' : '\u25B6');
            }
        });
    }
}

/* ──────── 注入格式化 ──────── */

export function formatVaultForPrompt(vault) {
    const content = vault.content || {};
    const parts = [];
    if (vault.memory_system_prompt) { parts.push(vault.memory_system_prompt); parts.push('---'); }
    if (content.opening_summary && content.opening_summary.text) {
        parts.push('## ' + t('Opening Summary (always visible)') + '\n' + content.opening_summary.text);
        parts.push('---');
    }
    if (content.current_scene) {
        parts.push('## ' + t('Current Scene') + '\n' + content.current_scene);
    }
    if (content.state && Object.keys(content.state).length > 0) {
        parts.push('## ' + t('Current State') + '\n' + renderStateWithTemplate(content.state, content.state_template || 'auto'));
        parts.push('---');
    }
    if (content.ltm_entries && content.ltm_entries.length > 0) {
        const ltmLines = content.ltm_entries.map(function (e, i) { return '| ' + (i + 1) + ' | ' + (e.period || '') + ' | ' + (e.scene || '') + ' | ' + (e.event || '') + ' [→' + (e.stm_refs || []).join(',') + '] |'; });
        parts.push('## ' + t('Long-term Memory (LTM) \u2014 Direct') + '\n| ' + t('No.') + ' | ' + t('Period') + ' | ' + t('Scene') + ' | ' + t('Event (Summary)') + ' |\n|' + '---|'.repeat(4) + '\n' + ltmLines.join('\n'));
    }
    if (content.unconsolidated_stm && content.unconsolidated_stm.length > 0) {
        const stmLines = content.unconsolidated_stm.map(function (e, i) {
            var periodLabel = e.period ? e.period + (e.time_label ? '\u00b7' + e.time_label : '') : '';
            return '| ' + (i + 1) + ' | ' + periodLabel + ' | ' + (e.scene || '') + ' | ' + (e.event || '') + ' [→msg#' + (e.msg_ids || []).join(',msg#') + '] |';
        });
        parts.push('## ' + t('Short-term Memory (Unconsolidated) \u2014 Direct') + '\n| ' + t('No.') + ' | ' + t('Period') + ' | ' + t('Scene') + ' | ' + t('Event') + ' |\n|' + '---|'.repeat(4) + '\n' + stmLines.join('\n'));
    }
    parts.push('---', t('The following content is not directly injected. If needed, use lookup_stm or lookup_memory_source tool.'));
    return parts.join('\n\n');
}

/* ──────── 面板渲染入口 ──────── */

export async function renderVaultPanel(getChatId) {
    await createVaultPanel(getChatId);
    await showVaultPanel(getChatId);
}
