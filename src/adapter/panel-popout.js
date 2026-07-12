import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { isStateSchemaEnabled } from '../core/vault/schema.js';
import { isAuto, computeStmBatch, getTelemetryStats } from '../core/params.js';
import { readVault } from '../core/vault/store.js';
import { qs, qsa, byId, pdCreate, t, PD, injectPinCSS, injectBottomDrawerCSS,
  setVaultActivity, freezeIframeHeight, vaultLLMLog, lastVaultStateJson,
  closeVaultOverlay, sortLtmByMsgOrder, busEmit, panelById, panelQSA, showConfirm, emptyStateHtml,
  syncOverlayBounds, startOverlayResizeWatcher, stopOverlayResizeWatcher } from './panel-shared.js';
import { renderVaultPanel } from './panel-init.js';
import { renderSettingsTab } from './panel-settings.js';

export function createVaultPopout(getChatId) {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay) return;
    var opening = !overlay.classList.contains('open');
    var chat = byId('chat');
    if (opening) {
        syncOverlayBounds();
        startOverlayResizeWatcher();
        if (chat) { chat.style.opacity = '0'; chat.style.pointerEvents = 'none'; chat.style.transition = 'opacity var(--ne-transition-normal)'; }
        overlay.style.display = 'flex';
        overlay.style.transform = 'translateY(0)';
        overlay.style.pointerEvents = 'auto';
        overlay.style.transition = 'transform 0.2s cubic-bezier(0, 0, 0.2, 1)';
        overlay.scrollTop = 0;
        requestAnimationFrame(function() {
            overlay.classList.add('open');
        });
        busEmit('vault:updated', { getChatId: getChatId });
        renderSettingsTab();
    } else {
        stopOverlayResizeWatcher();
        overlay.classList.remove('open');
        overlay.style.pointerEvents = '';
        overlay.style.transform = 'translateY(100%)';
        var tid = setTimeout(function() {
            overlay.style.display = 'none';
            overlay.style.transition = '';
            if (chat) { chat.style.opacity = ''; chat.style.pointerEvents = ''; chat.style.transition = ''; }
        }, 600);
        overlay.addEventListener('transitionend', function handler() {
            overlay.removeEventListener('transitionend', handler);
            clearTimeout(tid);
            overlay.style.display = 'none';
            overlay.style.transition = '';
            if (chat) { chat.style.opacity = ''; chat.style.pointerEvents = ''; chat.style.transition = ''; }
        });
    }
}

export function toggleVaultPanel(getChatId) { createVaultPopout(getChatId); }
export { closeVaultOverlay };
