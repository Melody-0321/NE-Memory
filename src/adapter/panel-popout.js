import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { isStateSchemaEnabled } from '../core/vault/schema.js';
import { listSnapshots, restoreSnapshot, deleteSnapshot } from '../core/vault/versions.js';
import { isAuto, computeStmBatch, getTelemetryStats } from '../core/params.js';
import { read } from '../core/vault/store.js';
import { qs, qsa, byId, pdCreate, t, PD, injectPinCSS, injectBottomDrawerCSS,
  setVaultActivity, freezeIframeHeight, vaultLLMLog, lastVaultStateJson,
  closeVaultOverlay, sortLtmByMsgOrder, busEmit, panelById, panelQSA } from './panel-shared.js';
import { renderVaultPanel } from './panel-init.js';
import { renderSettingsTab } from './panel-settings.js';

export function createVaultPopout(getChatId) {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay) return;
    var opening = !overlay.classList.contains('open');
    var chat = byId('chat');
    if (opening) {
        if (chat) chat.style.display = 'none';
        overlay.classList.add('open');
        busEmit('vault:updated', { getChatId: getChatId });
        renderSettingsTab();
    } else {
        overlay.classList.remove('open');
        if (chat) chat.style.display = '';
    }
}

export function toggleVaultPanel(getChatId) { createVaultPopout(getChatId); }
export { closeVaultOverlay };

export async function renderHistory(getChatId) {
    var container = panelById('narrative_vault_history_list');
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
                '<td><button class="narrative_del_btn menu_button" data-ver="' + snap.version + '" style="font-size:0.8em;padding:1px 5px;color:var(--ne-danger);">' + t('Delete') + '</button></td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;

        panelQSA('.narrative_restore_btn').forEach(function (btn) {
            btn.onclick = async function () {
                var ver = parseInt(btn.getAttribute('data-ver'));
                if (confirm(t('Restore to version v{VER}?').replace('{VER}', ver))) {
                    await restoreSnapshot(getChatId(), ver);
                    busEmit('vault:updated', { getChatId: getChatId });
                }
            };
        });
        panelQSA('.narrative_del_btn').forEach(function (btn) {
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
        container.innerHTML = '<div style="color:var(--ne-danger);">' + t('Failed to load history') + '</div>';
    }
}
