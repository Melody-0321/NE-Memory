import { readVault, collectAllMsgIds, getFieldFromLibrary } from '../core/vault/store.js';
import { scanOrphans, purgeOrphanChatData } from '../core/vault/garbage-collector.js';
import { executeIncrementalUpdate } from '../core/engine/update.js';
import { getState, onPipelineChange, offPipelineChange, enqueueStmWrite } from '../core/engine/pipeline-guard.js';
import { runLtmConsolidation } from './events.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { setRetrievalEnabled } from '../core/settings.js';
import { qs, qsa, byId, pdCreate, pdHead, pdAddEventListener, t, PD,
  injectPinCSS, injectBottomDrawerCSS, setVaultActivity, freezeIframeHeight,
  vaultLLMLog, lastVaultStateJson, closeVaultOverlay, _currentGetChatId,
  _vaultChangeBound, _updatingPopout, setCurrentGetChatId, setVaultChangeBound,
  busOn, busEmit,
  setPanelRoot, getPanelRoot, panelById, panelQS, panelQSA, showConfirm, showToast,
  openSlidePanel, closeSlidePanel, registerSlideRenderer } from './panel-shared.js';
import { _currentChatIdForCollapse, _currentCollapseState,
  _lazyRendered, _pendingInlineStorage,
  saveCollapseState, loadCollapseState, navigateToAccordion,
  setupAccordionHandlers, setupTabSwitching, setupSlidePanel, renderMemoryButton,
  saveSingleEntry, injectStateBanner, deleteSingleEntry,
  renderQuickIndex, setCurrentChatIdForCollapse,
  setupMobileGestureClose } from './panel-drawer.js';
import { renderCharacterPanelHTML, renderFactionPanelHTML, renderQuestPanelHTML,
  enterCardEditMode } from './panel-state-cards.js';
import { updateVaultViewerPopout } from './panel-content.js';
import { renderUsageIntoContainer } from './panel-usage.js';
import { renderSettingsIntoSlide } from './panel-settings.js';
import { renderTemplatesIntoSlide } from './panel-templates.js';
import { renderVersionHistoryPanel, initVersionNavButtons } from './panel-version-history.js';

function _onVaultUpdated(payload) {
    var gc = payload && payload.getChatId;
    if (typeof gc === 'function') {
        updateVaultViewerPopout(gc).finally(function () { setVaultActivity(false); });
    } else if (typeof gc === 'string' && _currentGetChatId) {
        updateVaultViewerPopout(_currentGetChatId).finally(function () { setVaultActivity(false); });
    } else if (_currentGetChatId) {
        updateVaultViewerPopout(_currentGetChatId).finally(function () { setVaultActivity(false); });
    }
}

function _onVaultUpdatedVersionHistory() {
    // Version history is now handled by panel-version-history.js (~state-versions)
}

var _pipelineUIHandler = null;
function _updatePipelineUI(status) {
    var el = panelById('ne_pipeline_status');
    if (!el) return;
    var dots = [
        { key: 'state', label: t('State') },
        { key: 'stm',   label: t('STM') },
        { key: 'ltm',   label: t('LTM') }
    ];
    var activeCount = dots.filter(function(d) { return status[d.key] === 'active'; }).length;
    if (activeCount === 0) {
        el.innerHTML = '<span class="ne-text-soft">\u25CF</span> ' + t('Idle');
        el.style.color = 'var(--grey-50)';
    } else {
        var parts = dots.map(function(d) {
            var color = status[d.key] === 'active' ? 'var(--ne-success)' : 'var(--grey-50)';
            return '<span style="color:' + color + ';" title="' + d.label + '">\u25CF</span>';
        });
        el.innerHTML = parts.join(' ') + ' <span style="font-size:0.85em;">' + activeCount + ' ' + t('active') + '</span>';
        el.style.color = 'var(--grey-60)';
    }
}

export async function renderVaultPanel(getChatId) {
    try {
        if (byId('ne_vault_bottom_overlay')) return;
        setCurrentGetChatId(getChatId);
        if (!_vaultChangeBound) {
            setVaultChangeBound(true);
            var _vaultRefreshDebounce = null;
            pdAddEventListener('ne:vault-changed', function() {
                if (_vaultRefreshDebounce) clearTimeout(_vaultRefreshDebounce);
                _vaultRefreshDebounce = setTimeout(function() {
                    _vaultRefreshDebounce = null;
                    if (_currentGetChatId) busEmit('vault:updated', { getChatId: _currentGetChatId });
                }, 300);
            });
        }

        // ── StateBus subscribers: vault:updated triggers full UI refresh ──
        busOn('vault:updated', _onVaultUpdated);
        busOn('vault:updated', _onVaultUpdatedVersionHistory);
        setCurrentChatIdForCollapse(typeof getChatId === 'function' ? getChatId() : getChatId);
        var vault = await readVault(getChatId());
        var c = vault.content || {};
        console.log('[NE-PANEL] renderVaultPanel chatId=' + getChatId() + ' vault.version=' + (vault.version) + ' stm=' + (c.unconsolidated_stm ? c.unconsolidated_stm.length : 0) + ' ltm=' + (c.ltm_entries ? c.ltm_entries.length : 0));

        var drawerHtml = '<div id="ne_vault_bottom_overlay" class="ne-vault-bottom-overlay">' +
            '<div class="ne-vault-collapse-bar" tabindex="0" role="button" aria-label="' + t('Collapse memory panel') + '" title="' + t('Collapse memory panel') + '">' +
            '<span class="ne-vault-collapse-indicator"></span>' +
            '<span class="ne-vault-collapse-chevron">\u25BC</span>' +
            '</div>' +
            '<div class="ne-vault-pin-row" style="padding:4px 12px 0;display:flex;align-items:center;">' +
            '<h3 class="margin0" style="white-space:nowrap;font-size:var(--mainFontSize);margin:0;padding:0 8px;">' + t('NE Narrative Engine') + '</h3>' +
            '<span id="ne_pipeline_status" class="ne-text-soft" style="font-size:0.75em;white-space:nowrap;margin-left:6px;"></span>' +
            '<div style="display:flex;align-items:center;margin-left:auto;gap:8px;">' +
            '<span id="ne_pin_templates" class="ne-pin-icon ne-text-soft" title="' + t('template_library') + '" style="font-size:1em;cursor:pointer;padding:0 2px;">\u{1F4CB}</span>' +
            '<span id="ne_pin_usage" class="ne-pin-icon ne-text-soft" title="' + t('Usage Statistics') + '" style="font-size:0.78em;cursor:pointer;white-space:nowrap;">\u{1F4CA} --</span>' +
            '<span id="ne_pin_settings" class="ne-pin-icon ne-text-soft" title="' + t('Settings & Data Management') + '" style="font-size:1em;cursor:pointer;padding:0 2px;">\u2699</span>' +
            '</div></div>' +
            // ── 仅摘要模式警示条 ──
            '<div id="ne_summary_only_notice" class="ne-summary-only-notice" style="display:none;">' +
                '<span class="ne-summary-only-icon">\u{1F441}\u200D\u23EC</span>' +
                '<div class="ne-summary-only-copy">' +
                    '<strong>' + t('summary_only_notice_title') + '</strong>' +
                    '<p>' + t('summary_only_notice_body') + '</p>' +
                '</div>' +
            '</div>' +
            '<div class="ne-vault-tab-bar">' +
            '<div class="ne-vault-tab active" data-tab="state">\u{1F4CB} ' + t('State') + '</div>' +
            '<div class="ne-vault-tab" data-tab="memory">\u{1F9E0} ' + t('Memory') + '</div>' +
            '</div>' +
            '<div class="ne-vault-scroll-area">' +
            '<div id="narrative_vault_loading"></div>' +
            '<div id="narrative_vault_panel_error" class="ne-text-danger" style="display:none;"></div>' +
            '<div id="narrative_vault_panel_storage_warn" class="ne-text-warning" style="display:none;font-size:0.85em;margin-bottom:4px;border:1px solid var(--ne-warning);padding:4px;border-radius:4px;"></div>' +
            // ── State tab ──
            '<div id="tab-state" class="ne-vault-tab-content active">' +
            '<div id="ne-state-search-bar" style="padding:4px 12px 6px;">' +
            '<input type="text" id="ne-state-search-input" placeholder="' + t('Search') + '..." aria-label="' + t('Search characters, factions, quests') + '" style="width:100%;padding:6px 10px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--text);font-size:0.85em;">' +
            '</div>' +
            '<div id="ne_state_quick_index" class="ne-quick-index"></div>' +
            '<div style="padding:0 12px 4px;display:flex;align-items:center;gap:6px;">' +
            '<span id="ne-state-scene" class="ne-text-soft" style="font-size:0.82em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;"></span>' +
            '<button id="ne-state-rollback-btn" class="ne-version-nav-btn" disabled title="\u56DE\u9000\u5230\u4E0A\u4E00\u4E2A\u7248\u672C">\u25C0 \u56DE\u9000</button>' +
            '<span id="ne-state-cursor-info" class="ne-version-cursor-info">\u5F53\u524D: \u6700\u65B0</span>' +
            '<button id="ne-state-restore-btn" class="ne-version-nav-btn" disabled title="\u524D\u8FDB\u5230\u4E0B\u4E00\u4E2A\u7248\u672C">\u524D\u8FDB \u25B6</button>' +
            '<button id="ne-state-history-btn" class="menu_button" style="margin-left:auto;font-size:0.78em;padding:2px 8px;white-space:nowrap;">\u{1F4CB} ' + '\u7248\u672C\u5386\u53F2' + '</button>' +
            '</div>' +
            // State accordion: Characters / Quests / Factions
            '<div class="ne-accordion open" id="ne-acc-characters">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Characters') + ' <span id="ne-char-count" class="ne-text-soft" style="margin-left:4px;font-weight:normal;font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="ne-state-template-entry" class="ne-text-soft" style="padding:2px 0 8px;font-size:0.82em;cursor:pointer;" title="' + t('manage_templates') + '">\u{1F4CB} ' + t('manage_templates') + ' \u2192</div>' +
            '<div id="ne_character_block_container"></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-quests">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Quests & Events') + ' <span id="ne-quest-count" class="ne-text-soft" style="margin-left:4px;font-weight:normal;font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="ne_quest_block_container"></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-factions">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Factions') + ' <span id="ne-faction-count" class="ne-text-soft" style="margin-left:4px;font-weight:normal;font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="ne_faction_block_container"></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-suspense">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('suspense_section_title') + ' <span id="ne-suspense-count" class="ne-text-soft" style="margin-left:4px;font-weight:normal;font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="ne_suspense_block_container"></div>' +
            '</div></div>' +
            '</div>' +
            // ── Memory tab ──
            '<div id="tab-memory" class="ne-vault-tab-content">' +
            '<div style="display:flex;align-items:center;padding:4px 12px 6px;gap:6px;">' +
            '<input type="text" id="ne-memory-search-input" placeholder="' + t('Search') + '..." aria-label="' + t('Search memory entries') + '" style="flex:1;padding:6px 10px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--text);font-size:0.85em;">' +
            '<button id="narrative_vault_panel_refresh" class="menu_button" style="font-size:0.82em;padding:3px 8px;white-space:nowrap;flex-shrink:0;">' + t('Refresh') + '</button>' +
            '<button class="narrative_btn_consolidate ne-btn-warning menu_button" style="font-size:0.82em;padding:3px 8px;white-space:nowrap;flex-shrink:0;">' + t('Consolidate') + '</button>' +
            '<button id="narrative_vault_process_history" class="ne-btn-danger menu_button" style="font-size:0.82em;padding:3px 8px;white-space:nowrap;flex-shrink:0;">' + t('Process History') + '</button>' +
            '</div>' +
            '<div id="ne_quick_index" class="ne-quick-index"></div>' +
            '<div style="padding:0 12px 4px;display:flex;align-items:center;gap:6px;">' +
            '<button id="ne-mem-rollback-btn" class="ne-version-nav-btn" disabled title="\u56DE\u9000\u5230\u4E0A\u4E00\u4E2A\u7248\u672C">\u25C0 \u56DE\u9000</button>' +
            '<span id="ne-mem-cursor-info" class="ne-version-cursor-info">\u5F53\u524D: \u6700\u65B0</span>' +
            '<button id="ne-mem-restore-btn" class="ne-version-nav-btn" disabled title="\u524D\u8FDB\u5230\u4E0B\u4E00\u4E2A\u7248\u672C">\u524D\u8FDB \u25B6</button>' +
            '<button id="ne-memory-history-btn" class="menu_button" style="margin-left:auto;font-size:0.78em;padding:2px 8px;white-space:nowrap;">' + '\u{1F4CB} ' + '\u7248\u672C\u5386\u53F2' + '</button>' +
            '</div>' +
            '<div class="ne-accordion open" id="ne-acc-memory-list">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Memory List') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<div class="ne-accordion open" id="ne-acc-stm">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Short-term Memory (STM)') + ' <span id="ne-stm-count" class="ne-text-soft" style="margin-left:4px;font-weight:normal;font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="narrative_vault_panel_stm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">' + t('No.') + '</th><th style="text-align:left;">' + t('Meta') + '</th><th style="text-align:left;">' + t('Event') + '</th><th style="width:2em;"></th></tr></thead>' +
            '<tbody id="narrative_vault_panel_stm_body"></tbody></table></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-ltm">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Long-term Memory (LTM)') + ' <span id="ne-ltm-count" class="ne-text-soft" style="margin-left:4px;font-weight:normal;font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="narrative_vault_panel_ltm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">' + t('No.') + '</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;max-width:180px;font-size:0.8em;">' + t('STM Refs') + '</th><th style="text-align:left;">' + t('Event (Summary)') + '</th><th style="width:2em;"></th></tr></thead>' +
            '<tbody id="narrative_vault_panel_ltm_body"></tbody></table></div>' +
            '</div></div>' +
            '</div></div>' +
            '</div>' +
            // ── Slide-in panel infrastructure ──
            '<div id="ne-slide-backdrop" class="ne-slide-backdrop"></div>' +
            '<div id="ne-slide-panel" class="ne-slide-panel">' +
            '<div class="ne-slide-title" id="ne-slide-title">' + t('Settings') + '</div>' +
            '<span class="ne-slide-close" id="ne-slide-close" title="' + t('Close') + '">\u2715</span>' +
            '<div id="ne-slide-panel-content"></div>' +
            '</div>' +
            '</div></div>';

        var sheld = byId('sheld');
        if (!sheld) {
            console.error('[NE] #sheld not found');
            return;
        }

        // Create Shadow Root on #ne_vault_bottom_overlay for style isolation
        var tempDiv = pdCreate('div');
        tempDiv.innerHTML = drawerHtml;
        var overlayEl = tempDiv.querySelector('#ne_vault_bottom_overlay');
        if (!overlayEl) {
            console.error('[NE] Failed to parse overlay from drawerHtml');
            return;
        }
        overlayEl.style.display = 'none';

        var shadowRoot;
        try {
            shadowRoot = overlayEl.attachShadow({ mode: 'open' });
        } catch (e) {
            console.error('[NE] Shadow DOM not supported, falling back:', e.message);
            shadowRoot = null;
        }

        if (shadowRoot) {
            while (overlayEl.children.length > 0) {
                shadowRoot.appendChild(overlayEl.children[0]);
            }
            setPanelRoot(shadowRoot);
            injectPinCSS();
            injectBottomDrawerCSS();
            PD.body.appendChild(overlayEl);
        } else {
            setPanelRoot(null);
            injectPinCSS();
            injectBottomDrawerCSS();
            PD.body.appendChild(overlayEl);
        }

        renderMemoryButton(getChatId);
        setupTabSwitching();
        setupSlidePanel();

        // Register slide-in panel renderers
        registerSlideRenderer('usage', renderUsageIntoContainer);
        registerSlideRenderer('settings', renderSettingsIntoSlide);
        registerSlideRenderer('templates', renderTemplatesIntoSlide);
        registerSlideRenderer('versions', function(container) {
            var cid = typeof getChatId === 'function' ? getChatId() : getChatId;
            renderVersionHistoryPanel(container, cid);
        });

        var collapseBar = panelQS('.ne-vault-collapse-bar');
        if (collapseBar) collapseBar.onclick = function () { closeVaultOverlay(); };

        setupAccordionHandlers(typeof getChatId === 'function' ? getChatId() : getChatId);
        setupMobileGestureClose();
        // ── State tab search (debounced) ──
        var stateSearchDebounce = null;
        var stateSearchInput = panelById('ne-state-search-input');
        if (stateSearchInput) {
            stateSearchInput.oninput = function() {
                if (stateSearchDebounce) clearTimeout(stateSearchDebounce);
                var q = this.value.trim().toLowerCase();
                stateSearchDebounce = setTimeout(function() {
                    var hasVisible = false;
                    panelQSA('.ne-char-card, .ne-faction-card, .ne-quest-card').forEach(function(card) {
                        var text = (card.textContent || '').toLowerCase();
                        var visible = !q || text.indexOf(q) !== -1;
                        card.classList.toggle('ne-search-hidden', !visible);
                        if (visible) hasVisible = true;
                    });
                    var noMatch = panelById('ne-state-no-match');
                    if (!hasVisible && q) {
                        if (!noMatch) {
                            var div = pdCreate('div');
                            div.id = 'ne-state-no-match';
                            div.className = 'ne-search-no-match';
                            div.textContent = t('No matches found');
                            var container = panelById('tab-state');
                            if (container) {
                                var quickIdx = panelById('ne_state_quick_index');
                                if (quickIdx && quickIdx.nextSibling) quickIdx.nextSibling.before(div);
                                else container.appendChild(div);
                            }
                        }
                        if (noMatch) noMatch.style.display = '';
                    } else {
                        if (noMatch) noMatch.style.display = 'none';
                    }
                }, 200);
            };
        }
        // ── Memory tab search (debounced) ──
        var memSearchDebounce = null;
        var searchInput = panelById('ne-memory-search-input');
        if (searchInput) {
            searchInput.oninput = function() {
                if (memSearchDebounce) clearTimeout(memSearchDebounce);
                var q = this.value.trim().toLowerCase();
                memSearchDebounce = setTimeout(function() {
                    var hasVisible = false;
                    panelQSA('#narrative_vault_panel_stm_body tr, #narrative_vault_panel_ltm_body tr').forEach(function(row) {
                        var text = (row.textContent || '').toLowerCase();
                        var visible = !q || text.indexOf(q) !== -1;
                        row.classList.toggle('ne-search-hidden', !visible);
                        if (visible) hasVisible = true;
                    });
                    var noMatch = panelById('ne-memory-no-match');
                    if (!hasVisible && q) {
                        if (!noMatch) {
                            var div2 = pdCreate('div');
                            div2.id = 'ne-memory-no-match';
                            div2.className = 'ne-search-no-match';
                            div2.textContent = t('No matches found');
                            var container2 = panelById('tab-memory');
                            if (container2) {
                                var quickIdx2 = panelById('ne_quick_index');
                                if (quickIdx2 && quickIdx2.nextSibling) quickIdx2.nextSibling.before(div2);
                                else container2.appendChild(div2);
                            }
                        }
                        if (noMatch) noMatch.style.display = '';
                    } else {
                        if (noMatch) noMatch.style.display = 'none';
                    }
                }, 200);
            };
        }
        // Load collapse state for both tabs
        var savedState = loadCollapseState(typeof getChatId === 'function' ? getChatId() : getChatId);
        if (savedState) {
            panelQSA('#tab-memory .ne-accordion, #tab-state .ne-accordion').forEach(function(acc) {
                if (acc.id && savedState[acc.id] === true) acc.classList.add('open');
                else if (acc.id && savedState[acc.id] === false) acc.classList.remove('open');
            });
        }

        var ref = panelById('narrative_vault_panel_refresh');
        if (ref) ref.onclick = function () {
            setVaultActivity(true);
            busEmit('vault:updated', { getChatId: getChatId });
        };

        var consolidateBtn = panelQS('.narrative_btn_consolidate');
        if (consolidateBtn) {
            consolidateBtn.onclick = async function () {
                var chatId = getChatId();
                console.log('[NE] Consolidate button clicked, chatId=' + chatId);
                if (!await showConfirm(t('Process pending STM entries?'), t('This will process pending STM entries. Continue?'))) return;
                var prevText = consolidateBtn.textContent;
                consolidateBtn.disabled = true;
                consolidateBtn.textContent = t('Processing...');
                try {
                    await runLtmConsolidation(chatId);
                    busEmit('vault:updated', { getChatId: getChatId });
                } catch (e) {
                    console.error('[NE] Consolidation failed:', e);
                    alert(t('Process failed') + ': ' + e.message);
                } finally {
                    consolidateBtn.disabled = false;
                    consolidateBtn.textContent = prevText;
                }
            };
        }

        // Process History
        var processHistoryBtn = panelById('narrative_vault_process_history');
        if (processHistoryBtn) {
            processHistoryBtn.onclick = async function() {
                if (!await showConfirm(t('Re-process all messages?'), t('This will re-process ALL past messages. It may take a long time. Continue?'))) return;
                var prevText = processHistoryBtn.textContent;
                var PH_BATCH_CHARS = 4000;
                try {
                    var rs = localStorage.getItem('ne_settings');
                    if (rs) { var ps = JSON.parse(rs); if (ps.phBatchChars) PH_BATCH_CHARS = Number(ps.phBatchChars); }
                } catch (e) {}
                var total = 0;
                try {
                    var chatMessages = [];
                    try {
                        if (typeof window.parent.SillyTavern !== 'undefined' && window.parent.SillyTavern.getContext) {
                            chatMessages = window.parent.SillyTavern.getContext().chat || [];
                        } else if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                            chatMessages = SillyTavern.getContext().chat || [];
                        }
                    } catch (e) {}
                    if (chatMessages.length === 0) { alert(t('No messages found in chat.')); return; }
                    var toProcess = [];
                    chatMessages.forEach(function(msg, idx) {
                        var content = msg.mes || '';
                        if (content.trim().length > 0) {
                            toProcess.push({ id: idx, is_user: !!msg.is_user, mes: content, name: msg.name || '' });
                        }
                    });
                    if (toProcess.length === 0) { alert(t('No messages with content to process.')); return; }
                    var vault = await readVault(_currentGetChatId);
                    var stmMsgIdSet = collectAllMsgIds(vault);
                    toProcess = toProcess.filter(function(msg) { return !stmMsgIdSet.has(String(msg.id)); });
                    if (toProcess.length === 0) { alert(t('All messages have already been processed.')); return; }
                    processHistoryBtn.disabled = true;
                    total = toProcess.length;
                    processHistoryBtn.textContent = t('Processing...') + ' (0' + t('turns_suffix') + ')';
                    var cpKey = 'ne_ph_' + _currentGetChatId();
                    var processedCount = 0;
                    try {
                        var cp = localStorage.getItem(cpKey);
                        if (cp) {
                            var cpData = JSON.parse(cp);
                            if (cpData.t && cpData.i >= total) { try { localStorage.removeItem(cpKey); } catch (e2) {} }
                            else if (cpData.t && cpData.i > 0) { processedCount = cpData.i; }
                        }
                    } catch (e) {}
                    await enqueueStmWrite(async function() {
                    var accumTurns = processedCount, batchStart = processedCount, batchChars = 0;
                    for (var i = processedCount; i < total; i++) {
                        var msgLen = toProcess[i].mes.length;
                        if (batchChars + msgLen > PH_BATCH_CHARS && i > batchStart) {
                            var batch = toProcess.slice(batchStart, i);
                            processHistoryBtn.textContent = t('Processing...') + ' (' + accumTurns + t('turns_suffix') + ')';
                            await executeIncrementalUpdate(_currentGetChatId, batch, true, function(progress) { accumTurns = progress.processedTurns; });
                            accumTurns = i;
                            try { localStorage.setItem(cpKey, JSON.stringify({ t: Date.now(), i: i })); } catch (e2) {}
                            batchStart = i; batchChars = 0;
                        }
                        batchChars += msgLen;
                    }
                    if (batchStart < total) {
                        var batch = toProcess.slice(batchStart, total);
                        await executeIncrementalUpdate(_currentGetChatId, batch, true, function(progress) { accumTurns = progress.processedTurns; });
                        accumTurns = total;
                        try { localStorage.removeItem(cpKey); } catch (e3) {}
                    }
                    processHistoryBtn.textContent = t('Completed') + ' (' + accumTurns + t('turns_suffix') + ')';
                    });
                } catch (e) {
                    console.error('[NE] Process history failed:', e);
                    processHistoryBtn.textContent = t('Failed');
                    showToast(t('Process History') + ': ' + e.message, 'error', 6000);
                } finally {
                    setTimeout(function() { processHistoryBtn.textContent = prevText; processHistoryBtn.disabled = false; }, 2000);
                    busEmit('vault:updated', { getChatId: _currentGetChatId });
                }
            };
        }

        // Tools tab accordion lazy render handled by setupAccordionHandlers delegation

        // LLM log entry & card expand/collapse
        pdAddEventListener('click', function (e) {
            var target = (e.composedPath && e.composedPath()[0]) || e.target;
            var header = target.closest('.ne_log_header');
            if (header) {
                var body = header.parentElement.querySelector('.ne_log_body');
                if (!body) return;
                var vis = body.style.display !== 'none';
                body.style.display = vis ? 'none' : '';
                header.textContent = (vis ? '\u25B6' : '\u25BC') + header.textContent.substring(1);
                return;
            }
            // Character card toggle
            var charHeader = target.closest('.ne_char_header');
            if (charHeader) {
                var cardId = charHeader.getAttribute('data-card-id');
                var detail = panelById(cardId + '_detail');
                var toggle = charHeader.querySelector('.ne_char_toggle');
                if (detail) {
                    var vis = detail.style.display !== 'none';
                    detail.style.display = vis ? 'none' : '';
                    if (toggle) toggle.textContent = vis ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Faction card toggle
            var factionHeader = target.closest('.ne_faction_header');
            if (factionHeader) {
                var fCardId = factionHeader.getAttribute('data-card-id');
                var fDetail = panelById(fCardId + '_detail');
                var fToggle = factionHeader.querySelector('.ne_faction_toggle');
                if (fDetail) {
                    var fVis = fDetail.style.display !== 'none';
                    fDetail.style.display = fVis ? 'none' : '';
                    if (fToggle) fToggle.textContent = fVis ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Quest card toggle
            var questHeader = target.closest('.ne-quest-header');
            if (questHeader) {
                var qCard = questHeader.closest('.ne-quest-card');
                var qDetail = qCard ? qCard.querySelector('.ne-quest-detail') : null;
                var qToggle = questHeader.querySelector('.ne-quest-toggle');
                if (qDetail && qCard) {
                    qCard.classList.toggle('open');
                    qDetail.style.display = qCard.classList.contains('open') ? 'block' : 'none';
                    if (qToggle) qToggle.textContent = qCard.classList.contains('open') ? '\u25BE' : '\u25B6';
                }
                return;
            }
            // Suspense card toggle
            var suspenseHeader = target.closest('.ne-suspense-header');
            if (suspenseHeader) {
                var sCard = suspenseHeader.closest('.ne-suspense-card');
                var sDetail = sCard ? sCard.querySelector('.ne-suspense-detail') : null;
                var sToggle = suspenseHeader.querySelector('.ne-suspense-toggle');
                if (sDetail && sCard) {
                    sCard.classList.toggle('open');
                    sDetail.style.display = sCard.classList.contains('open') ? 'block' : 'none';
                    if (sToggle) sToggle.textContent = sCard.classList.contains('open') ? '\u25BE' : '\u25B6';
                }
                return;
            }
            // Character group toggle
            var groupHeader = target.closest('.ne_group_header');
            if (groupHeader) {
                var groupId = groupHeader.getAttribute('data-group-id');
                var cards = panelById(groupId + '_cards');
                var toggle = groupHeader.querySelector('.ne_group_toggle');
                if (cards) {
                    var vis = cards.style.display !== 'none';
                    cards.style.display = vis ? 'none' : '';
                    if (toggle) toggle.textContent = vis ? '\u25B6' : '\u25BC';
                }
                return;
            }
        });

        // ── L3: ResizeObserver for mobile responsive ──
        (function setupMobileObserver() {
            var sheld = byId('sheld');
            if (!sheld) return;
            var overlay = byId('ne_vault_bottom_overlay');
            if (!overlay) return;
            // UIS-5: 若已有观察器先断开，避免 init 双跑时重复创建累积
            if (overlay._neResizeObserver) {
                try { overlay._neResizeObserver.disconnect(); } catch (e) {}
                overlay._neResizeObserver = null;
            }
            try {
                var ro = new ResizeObserver(function(entries) {
                    if (!overlay.classList.contains('open')) return;
                    var width = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0;
                    if (width <= 600) {
                        overlay.classList.add('ne-mobile');
                    } else {
                        overlay.classList.remove('ne-mobile');
                    }
                });
                ro.observe(sheld);
                overlay._neResizeObserver = ro;
            } catch (e) {
                console.warn('[NE] ResizeObserver not supported, using CSS fallback:', e.message);
            }
        })();

        freezeIframeHeight();

        setVaultActivity(true);
        busEmit('vault:updated', { getChatId: getChatId });

        // Initialize Test Runner UI (lazy — only when settings slide opens)
        // renderSettingsTab removed — now rendered via slide panel on demand

        // ── L3: Esc to close vault overlay ──
        pdAddEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            var overlay = byId('ne_vault_bottom_overlay');
            if (overlay && overlay.classList.contains('open')) {
                closeVaultOverlay();
            }
        });

        // ── Pipeline status callback (push from pipeline-guard) ──
        if (_pipelineUIHandler) offPipelineChange(_pipelineUIHandler);
        _pipelineUIHandler = _updatePipelineUI;
        onPipelineChange(_updatePipelineUI);
        _updatePipelineUI(getState());

        // ── Pin row: templates, usage & settings icons ──
        var tmplPin = panelById('ne_pin_templates');
        if (tmplPin) tmplPin.onclick = function() { openSlidePanel('templates'); };
        var stateTmplEntry = panelById('ne-state-template-entry');
        if (stateTmplEntry) stateTmplEntry.onclick = function() { openSlidePanel('templates'); };
        var usagePin = panelById('ne_pin_usage');
        if (usagePin) usagePin.onclick = function() { openSlidePanel('usage'); };
        var settingsPin = panelById('ne_pin_settings');
        if (settingsPin) settingsPin.onclick = function() { openSlidePanel('settings'); };
        var stateHistoryBtn = panelById('ne-state-history-btn');
        if (stateHistoryBtn) stateHistoryBtn.onclick = function() { openSlidePanel('versions'); };
        var memHistoryBtn = panelById('ne-memory-history-btn');
        if (memHistoryBtn) memHistoryBtn.onclick = function() { openSlidePanel('versions'); };

        var chatId = typeof getChatId === 'function' ? getChatId() : getChatId;
        if (chatId) {
            var vStateEls = { rollbackBtn: panelById('ne-state-rollback-btn'), restoreBtn: panelById('ne-state-restore-btn'), cursorInfo: panelById('ne-state-cursor-info') };
            var vMemEls = { rollbackBtn: panelById('ne-mem-rollback-btn'), restoreBtn: panelById('ne-mem-restore-btn'), cursorInfo: panelById('ne-mem-cursor-info') };
            initVersionNavButtons(chatId, vStateEls, vMemEls);
        }
    } catch (e) {
        console.error('[NE] Vault panel render failed:', e);
    }
}
