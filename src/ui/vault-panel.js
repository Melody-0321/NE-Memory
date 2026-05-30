import { read } from '../vault/store.js';
import { t_narrative } from '../i18n.js';
import { escapeHtml } from './utils.js';
import { renderStateWithTemplate } from './state-templates.js';

export function formatVaultForPrompt(vault) {
    const content = vault.content || {};
    const parts = [];
    if (vault.memory_system_prompt) { parts.push(vault.memory_system_prompt); parts.push('---'); }
    if (content.opening_summary && content.opening_summary.text) {
        parts.push('## ' + t_narrative('Opening Summary (always visible)') + '\n' + content.opening_summary.text);
        parts.push('---');
    }
    if (content.current_scene) {
        parts.push('## ' + t_narrative('Current Scene') + '\n' + content.current_scene);
    }
    if (content.state && Object.keys(content.state).length > 0) {
        const rendered = renderStateWithTemplate(content.state, content.state_template || 'auto');
        parts.push('## ' + t_narrative('Current State') + '\n' + rendered);
        parts.push('---');
    }
    if (content.ltm_entries && content.ltm_entries.length > 0) {
        const ltmLines = content.ltm_entries.map((e, i) => {
            const refs = (e.stm_refs || []).join(', ');
            return `| ${i + 1} | ${e.period || ''} | ${e.scene || ''} | ${e.event || ''} [→${refs}] |`;
        });
        parts.push('## ' + t_narrative('Long-term Memory (LTM) \u2014 Direct') + '\n| ' + t_narrative('No.') + ' | ' + t_narrative('Period') + ' | ' + t_narrative('Scene') + ' | ' + t_narrative('Event (Summary)') + ' |\n|' + '---|'.repeat(4) + '\n' + ltmLines.join('\n'));
    }
    if (content.unconsolidated_stm && content.unconsolidated_stm.length > 0) {
        const stmLines = content.unconsolidated_stm.map((e, i) => {
            const refs = (e.msg_ids || []).map(mid => 'msg#' + mid).join(', ');
            const periodLabel = e.period ? `${e.period}${e.time_label ? '\u00b7' + e.time_label : ''}` : '';
            return `| ${i + 1} | ${periodLabel} | ${e.scene || ''} | ${e.event || ''} [→${refs}] |`;
        });
        parts.push('## ' + t_narrative('Short-term Memory (Unconsolidated) \u2014 Direct') + '\n| ' + t_narrative('No.') + ' | ' + t_narrative('Period') + ' | ' + t_narrative('Scene') + ' | ' + t_narrative('Event') + ' |\n|' + '---|'.repeat(4) + '\n' + stmLines.join('\n'));
    }
    parts.push('---', t_narrative('The following content is not directly injected. If needed, use lookup_stm or lookup_memory_source tool.'));
    return parts.join('\n\n');
}

export function renderMemoryTable(tbodyId, entries, type, stmIndexMap) {
    const tbody = $(tbodyId).empty();
    if (!entries || entries.length === 0) { tbody.append('<tr><td colspan="4" style="color:#888;">(empty)</td></tr>'); return; }
    entries.forEach((entry, i) => {
        const periodCell = type === 'ltm' ? (entry.period || '') : `${entry.period || ''}${entry.time_label ? '\u00b7' + entry.time_label : ''}`;
        const refs = type === 'ltm'
            ? (entry.stm_refs || []).map(r => `<span class="narrative_link stm-link" data-stm-id="${r}">[→${r}]</span>`).join(' ')
            : (entry.msg_ids || []).map(mid => `<span class="narrative_link msg-link" data-msg-id="${mid}">[→msg#${mid}]</span>`).join(' ');
        const entryId = entry.id || (type + '_' + i);
        const toggleBtn = type === 'ltm' ? `<span class="narrative_ltm_toggle" data-ltm-id="${entryId}" title="Toggle STM details">▶</span> ` : '';
        tbody.append(`<tr data-entry-id="${entryId}"><td style="text-align:center;color:#888;width:2em;">${toggleBtn}${i + 1}</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">${periodCell}</td><td style="font-size:0.85em;max-width:100px;">${entry.scene || ''}</td><td>${entry.event || entry.summary || ''} ${refs}</td></tr>`);
        if (type === 'ltm') { var detailRows = ''; var stmRefs = entry.stm_refs || []; stmRefs.forEach(function (stmId) { var stm = stmIndexMap && stmIndexMap[stmId]; if (stm) { var stmPeriod = stm.period || ''; var stmTime = stm.time_label ? '\u00b7' + stm.time_label : ''; var stmScene = stm.scene || ''; var stmEvent = stm.event || stm.summary || ''; var stmRefLinks = (stm.msg_ids || []).map(function (mid) { return `<span class="narrative_link msg-link" data-msg-id="${mid}">[→msg#${mid}]</span>`; }).join(' '); detailRows += `<div class="narrative_ltm_stm_entry"><span class="narrative_ltm_stm_label">${stmPeriod}${stmTime}</span><span class="narrative_ltm_stm_scene">${stmScene}</span><span class="narrative_ltm_stm_event">${stmEvent}</span> ${stmRefLinks}</div>`; } }); if (detailRows) { tbody.append(`<tr class="narrative_ltm_detail" data-ltm-parent="${entryId}" style="display:none;"><td colspan="4"><div class="narrative_ltm_detail_container">${detailRows}</div></td></tr>`); } }
    });
}

export async function updateVaultViewerPopout(getChatId) {
    const vault = await read(getChatId());
    const c = vault.content || {};
    let html = '';
    html += '<div style="font-weight:bold;">' + t_narrative('Version:') + ' ' + (vault.version || 0) + '</div>';
    if (c.state && Object.keys(c.state).length > 0) {
        html += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t_narrative('Current State') + '</div>';
        html += '<div>' + renderStateWithTemplate(c.state, c.state_template || 'auto') + '</div>';
    }
    if (c.opening_summary && c.opening_summary.text) {
        html += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t_narrative('Opening Scene') + '</div>';
        html += '<div style="white-space:pre-wrap;">' + escapeHtml(c.opening_summary.text) + '</div>';
    }
    html += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t_narrative('Long-term Memory (LTM)') + '</div>';
    html += '<table class="narrative_memory_table"><thead><tr><th>No.</th><th>Period</th><th>Scene</th><th>Event</th></tr></thead><tbody id="ne_vault_ltm_body"></tbody></table>';
    html += '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t_narrative('Short-term Memory (STM)') + '</div>';
    html += '<table class="narrative_memory_table"><thead><tr><th>No.</th><th>Period</th><th>Scene</th><th>Event</th></tr></thead><tbody id="ne_vault_stm_body"></tbody></table>';
    html += '<div style="margin-top:8px;display:flex;gap:4px;"><button id="ne_vault_refresh" class="menu_button" style="font-size:0.85em;padding:2px 8px;">' + t_narrative('Refresh') + '</button></div>';
    return html;
}

export async function renderVaultPanel(getChatId) {
    try {
        const vault = await read(getChatId());
        const panelHtml = await updateVaultViewerPopout(getChatId);
        const c = vault.content || {};
        const stmIndexMap = {};
        (c.stm_entries || []).forEach(s => { stmIndexMap[s.id] = s; });
        (c.unconsolidated_stm || []).forEach(s => { stmIndexMap[s.id] = s; });
        const container = $('#ne_vault_container');
        if (container.length === 0) {
            const div = $('<div id="ne_vault_container" style="display:none;position:fixed;top:10%;left:50%;transform:translateX(-50%);z-index:9999;background:var(--SmartThemeBlurTintColor);border:1px solid var(--grey5050a);border-radius:8px;padding:16px;max-width:700px;max-height:80vh;overflow-y:auto;box-shadow:0 4px 24px rgba(0,0,0,0.5);"></div>');
            $('body').append(div);
        }
        const container2 = $('#ne_vault_container');
        container2.html(`<h3 style="margin-top:0;">${t_narrative('Memory Vault')}</h3>${panelHtml}`);
        renderMemoryTable('#ne_vault_ltm_body', c.ltm_entries || [], 'ltm', stmIndexMap);
        renderMemoryTable('#ne_vault_stm_body', c.unconsolidated_stm || [], 'stm');
        $('#ne_vault_refresh').on('click', async () => {
            const html = await updateVaultViewerPopout(getChatId);
            container2.html(`<h3 style="margin-top:0;">${t_narrative('Memory Vault')}</h3>${html}`);
            const v2 = await read(getChatId());
            const c2 = v2.content || {};
            const idx2 = {};
            (c2.stm_entries || []).forEach(s => { idx2[s.id] = s; });
            renderMemoryTable('#ne_vault_ltm_body', c2.ltm_entries || [], 'ltm', idx2);
            renderMemoryTable('#ne_vault_stm_body', c2.unconsolidated_stm || [], 'stm');
        });
        container2.show();
    } catch (e) {
        console.error('[NE] Vault panel render failed:', e);
    }
}
