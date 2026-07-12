import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { isStateSchemaEnabled } from '../core/vault/schema.js';
import { isAuto, computeStmBatch, getTelemetryStats } from '../core/params.js';
import { readVault } from '../core/vault/store.js';
import { qs, qsa, byId, pdCreate, t, PD, injectPinCSS, injectBottomDrawerCSS,
  setVaultActivity, freezeIframeHeight, vaultLLMLog, lastVaultStateJson,
  closeVaultOverlay, sortLtmByMsgOrder, busEmit, panelById, panelQSA, showConfirm, emptyStateHtml,
  syncOverlayBounds, startOverlayResizeWatcher } from './panel-shared.js';
import { renderVaultPanel } from './panel-init.js';
import { renderSettingsTab } from './panel-settings.js';

export function createVaultPopout(getChatId) {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay || overlay.classList.contains('open')) return;
    syncOverlayBounds();
    startOverlayResizeWatcher();
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
}

export { closeVaultOverlay };
