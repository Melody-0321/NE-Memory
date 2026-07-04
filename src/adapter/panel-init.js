import { read } from '../core/vault/store.js';
import { loadVault } from '../core/auto-restore.js';
import { listSnapshots, restoreSnapshot, deleteSnapshot } from '../core/vault/versions.js';
import { scanOrphans, purgeOrphanChatData } from '../core/vault/garbage-collector.js';
import { executeIncrementalUpdate } from '../core/engine/update.js';
import { tryAcquire, releasePipeline, waitForPipelineTrackIdle, reset, getState, onPipelineChange, offPipelineChange } from '../core/engine/pipeline-guard.js';
import { runLtmConsolidation } from './events.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { setRetrievalEnabled } from '../core/settings.js';
import { qs, qsa, byId, pdCreate, pdHead, pdAddEventListener, t, PD,
  injectPinCSS, injectBottomDrawerCSS, setVaultActivity, freezeIframeHeight,
  vaultLLMLog, lastVaultStateJson, closeVaultOverlay, _currentGetChatId,
  _vaultChangeBound, _updatingPopout, setCurrentGetChatId, setVaultChangeBound,
  busOn, busEmit,
  setPanelRoot, getPanelRoot, panelById, panelQS, panelQSA, showConfirm } from './panel-shared.js';
import { _currentChatIdForCollapse, _currentCollapseState,
  _lazyRendered, _pendingInlineStorage,
  saveCollapseState, loadCollapseState, navigateToAccordion,
  setupAccordionHandlers, setupTabSwitching, renderMemoryButton,
  saveSingleEntry, injectStateBanner, deleteSingleEntry,
  renderQuickIndex, setCurrentChatIdForCollapse,
  setupMobileGestureClose } from './panel-drawer.js';
import { renderCharacterPanelHTML, renderFactionPanelHTML, renderQuestPanelHTML,
  enterCardEditMode } from './panel-state-cards.js';
import { updateVaultViewerPopout } from './panel-content.js';
import { initTestRunner } from './panel-tools.js';
import { renderUsageTab } from './panel-usage.js';
import { renderSettingsTab } from './panel-settings.js';
import { renderHistory } from './panel-popout.js';

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
        busOn('vault:updated', function(payload) {
            var gc = payload && payload.getChatId;
            if (typeof gc === 'function') {
                updateVaultViewerPopout(gc).finally(function () { setVaultActivity(false); });
            } else if (typeof gc === 'string' && _currentGetChatId) {
                updateVaultViewerPopout(_currentGetChatId).finally(function () { setVaultActivity(false); });
            } else if (_currentGetChatId) {
                updateVaultViewerPopout(_currentGetChatId).finally(function () { setVaultActivity(false); });
            }
        });
        busOn('vault:updated', function() {
            var usageTab = panelQS('.ne-vault-tab.active[data-tab="usage"]');
            if (usageTab) {
                try { renderUsageTab(); } catch (e) { console.warn('[NE] Usage tab auto-refresh failed:', e); }
            }
        });
        busOn('vault:updated', function() {
            var historyAcc = panelById('ne-tool-history');
            if (historyAcc && historyAcc.classList.contains('open')) {
                try { renderHistory(_currentGetChatId); } catch (e) { console.warn('[NE] History auto-refresh failed:', e); }
            }
        });
        setCurrentChatIdForCollapse(typeof getChatId === 'function' ? getChatId() : getChatId);
        var vault = await loadVault(getChatId());
        var c = vault.content || {};
        console.log('[NE-PANEL] renderVaultPanel chatId=' + getChatId() + ' vault.version=' + (vault.version) + ' stm=' + (c.unconsolidated_stm ? c.unconsolidated_stm.length : 0) + ' ltm=' + (c.ltm_entries ? c.ltm_entries.length : 0));

        var drawerHtml = '<div id="ne_vault_bottom_overlay" class="ne-vault-bottom-overlay">' +
            '<div class="ne-vault-collapse-bar" tabindex="0" role="button" aria-label="' + t('Collapse memory panel') + '" title="' + t('Collapse memory panel') + '">' +
            '<span class="ne-vault-collapse-indicator"></span>' +
            '<span class="ne-vault-collapse-chevron">\u25BC</span>' +
            '</div>' +
            '<div class="ne-vault-pin-row" style="padding:4px 12px 0;display:flex;align-items:center;">' +
            '<h3 class="margin0" style="white-space:nowrap;font-size:var(--mainFontSize);margin:0;padding:0 8px;">' + t('NE Narrative Engine') + '</h3>' +
            '<div style="display:flex;align-items:center;margin-left:auto;gap:8px;">' +
            '<span id="ne_pipeline_status" style="font-size:0.75em;color:var(--grey-50);white-space:nowrap;"></span>' +
            '<span id="narrative_vault_panel_scene" style="font-size:0.82em;color:var(--grey-60);margin:0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;"></span>' +
            '<span id="narrative_secondary_api_status" style="display:inline-flex;align-items:center;gap:4px;font-size:0.75em;color:#888;cursor:help;" title="' + t('No secondary API configured') + '"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0;"></span></span>' +
            '</div></div>' +
            '<div class="ne-vault-tab-bar">' +
            '<div class="ne-vault-tab active" data-tab="memory">\u{1F9E0} ' + t('Memory') + '</div>' +
            '<div class="ne-vault-tab" data-tab="tools">\u{1F527} ' + t('Tools') + '</div>' +
            '<div class="ne-vault-tab" data-tab="settings">\u2699 ' + t('Settings') + '</div>' +
            '<div class="ne-vault-tab" data-tab="usage">\u{1F4CA} ' + t('Usage') + '</div>' +
            '</div>' +
            '<div class="ne-vault-scroll-area">' +
            '<div id="narrative_vault_loading">' +
            '<div class="ne-skeleton ne-skeleton-card"></div><div class="ne-skeleton ne-skeleton-card"></div><div class="ne-skeleton ne-skeleton-card"></div>' +
            '</div>' +
            '<div id="narrative_vault_panel_error" style="display:none;color:var(--ne-danger);"></div>' +
            '<div id="narrative_vault_panel_storage_warn" style="display:none;color:var(--ne-warning);font-size:0.85em;margin-bottom:4px;border:1px solid var(--ne-warning);padding:4px;border-radius:4px;"></div>' +
            '<div id="tab-memory" class="ne-vault-tab-content active">' +
            '<div id="ne-memory-search-bar" style="padding:4px 12px 6px;">' +
            '<input type="text" id="ne-memory-search-input" placeholder="' + t('Search') + '..." aria-label="' + t('Search memory entries') + '" style="width:100%;padding:6px 10px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--text);font-size:0.85em;">' +
            '</div>' +
            '<div id="ne-memory-version" style="padding:2px 12px 4px;font-size:0.75em;color:var(--grey-50);"></div>' +
            '<div id="ne_quick_index" class="ne-quick-index"></div>' +
            '<div class="ne-accordion open" id="ne-acc-memory-list">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Memory List') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<div class="ne-accordion open" id="ne-acc-stm">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Short-term Memory (STM)') + ' <span id="ne-stm-count" style="margin-left:4px;font-weight:normal;color:var(--grey-50);font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="narrative_vault_panel_stm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">' + t('No.') + '</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;">' + t('Scene') + '</th><th style="text-align:left;max-width:180px;font-size:0.8em;">' + t('Msg IDs') + '</th><th style="text-align:left;">' + t('Event') + '</th><th style="width:2em;"></th></tr></thead>' +
            '<tbody id="narrative_vault_panel_stm_body"></tbody></table></div>' +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-acc-ltm">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Long-term Memory (LTM)') + ' <span id="ne-ltm-count" style="margin-left:4px;font-weight:normal;color:var(--grey-50);font-size:0.85em;"></span></div>' +
            '<div class="ne-accordion-body">' +
            '<div id="narrative_vault_panel_ltm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">' + t('No.') + '</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;max-width:180px;font-size:0.8em;">' + t('STM Refs') + '</th><th style="text-align:left;">' + t('Event (Summary)') + '</th><th style="width:2em;"></th></tr></thead>' +
            '<tbody id="narrative_vault_panel_ltm_body"></tbody></table></div>' +
            '</div></div>' +
            '</div></div>' +
            '<div class="ne-accordion open" id="ne-acc-state-board">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('State Board') + '</div>' +
            '<div class="ne-accordion-body">' +
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
            '<div class="ne-tool-card">' +
            '<div class="ne-tool-card-title">' + t('Operations') + '</div>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
            '<button id="narrative_vault_panel_refresh" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Refresh') + '</button>' +
            '<button class="narrative_btn_consolidate ne-btn-warning menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Consolidate') + '</button>' +
            '<button id="narrative_vault_process_history" class="ne-btn-danger menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" title="' + t('Process all past messages into memories') + '">' + t('Process History') + '</button>' +
            '</div></div>' +
            '<div class="ne-tool-card">' +
            '<div class="ne-tool-card-title">' + t('Data') + '</div>' +
            '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
            '<button id="narrative_vault_export_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Export JSON') + '</button>' +
            '<button id="narrative_vault_import_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Import JSON') + '</button>' +
            '<button id="narrative_vault_embed_chat" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" title="' + t('Embed vault into chat_metadata so it travels with chat export/backup') + '">' + t('Embed into Chat') + '</button>' +
            '<button id="narrative_vault_clean_orphans" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" title="' + t('Scan and remove IndexedDB data for deleted chats') + '">' + t('Clean Orphan Data') + '</button>' +
            '</div></div>' +
            '<div class="ne-tool-card">' +
            '<div class="ne-tool-card-title">' + t('Diagnostics') + '</div>' +
            '<div class="ne-accordion" id="ne-tool-history">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('History') + '</div>' +
            '<div class="ne-accordion-body"><div id="narrative_vault_history_list" style="font-size:0.85em;"></div></div></div>' +
            '<div class="ne-accordion" id="ne-tool-test-runner" style="' + (window.__NE_DEV_MODE ? '' : 'display:none;') + '">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> <span style="margin-right:6px;">\u2699</span> ' + t('Test Runner') + '</div>' +
            '<div class="ne-accordion-body"><div id="ne-tr-container" class="ne-tr-container"></div></div></div>' +
            '</div></div>' +
            '</div>' +
            '<div id="tab-settings" class="ne-vault-tab-content">' +
            '<div class="ne-settings-section-card" style="margin-bottom:8px;">' +
            '<div class="ne-settings-section-title">\u2605 ' + t('Common Settings') + '</div>' +
            '<div id="ne_common_settings"></div></div>' +
            '<div class="ne-settings-section-card">' +
            '<div class="ne-settings-section-title">\u2697 ' + t('Advanced Settings') + '</div>' +
            '<div id="ne_advanced_settings"></div></div>' +
            '</div>' +
            '<div id="tab-usage" class="ne-vault-tab-content">' +
            '<div id="ne-usage-container"></div>' +
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
            sheld.appendChild(overlayEl);
        } else {
            setPanelRoot(null);
            injectPinCSS();
            injectBottomDrawerCSS();
            sheld.appendChild(overlayEl);
        }

        renderMemoryButton(getChatId);
        setupTabSwitching();

        var collapseBar = panelQS('.ne-vault-collapse-bar');
        if (collapseBar) collapseBar.onclick = function () { closeVaultOverlay(); };

        setupAccordionHandlers(typeof getChatId === 'function' ? getChatId() : getChatId);
        setupMobileGestureClose();
        // ── L3: Search / Filter ──
        var searchInput = panelById('ne-memory-search-input');
        if (searchInput) {
            searchInput.oninput = function() {
                var query = this.value.trim().toLowerCase();
                // Filter STM / LTM rows
                panelQSA('#narrative_vault_panel_stm_body tr, #narrative_vault_panel_ltm_body tr').forEach(function(row) {
                    var text = (row.textContent || '').toLowerCase();
                    row.classList.toggle('ne-search-hidden', query && text.indexOf(query) === -1);
                });
                // Filter character cards
                panelQSA('.ne-char-card').forEach(function(card) {
                    var text = (card.textContent || '').toLowerCase();
                    card.classList.toggle('ne-search-hidden', query && text.indexOf(query) === -1);
                });
                // Filter faction cards
                panelQSA('.ne-faction-card').forEach(function(card) {
                    var text = (card.textContent || '').toLowerCase();
                    card.classList.toggle('ne-search-hidden', query && text.indexOf(query) === -1);
                });
                // Filter quest cards
                panelQSA('.ne-quest-card').forEach(function(card) {
                    var text = (card.textContent || '').toLowerCase();
                    card.classList.toggle('ne-search-hidden', query && text.indexOf(query) === -1);
                });
            };
        }
        var savedState = loadCollapseState(typeof getChatId === 'function' ? getChatId() : getChatId);
        if (savedState) {
            panelQSA('#tab-memory .ne-accordion').forEach(function(acc) {
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

        var processHistoryBtn = panelById('narrative_vault_process_history');
        if (processHistoryBtn) {
            processHistoryBtn.onclick = async function () {
                if (!await showConfirm(t('Re-process all messages?'), t('This will re-process ALL past messages. It may take a long time. Continue?'))) return;
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
                chatMessages.forEach(function (msg, idx) {
                    var content = msg.mes || '';
                    if (content.trim().length > 0) {
                        toProcess.push({
                            id: idx,
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

                var vault = await read(getChatId());
                var stmMsgIdSet = collectAllMsgIds(vault);
                console.log('[NE-DIAG] processHistory pre-filter — chatId=' + getChatId() + ', stmMsgIdSet.size=' + stmMsgIdSet.size + ', toProcessBefore=' + toProcess.length);
                var filteredOut = [];
                toProcess = toProcess.filter(function (msg) {
                    var key = String(msg.id);
                    var skip = stmMsgIdSet.has(key);
                    if (skip) filteredOut.push(msg.id);
                    return !skip;
                });
                if (filteredOut.length > 0) console.log('[NE-DIAG] processHistory pre-filter — removed msg ids:', filteredOut.join(','));
                console.log('[NE-DIAG] processHistory pre-filter — toProcessAfter=' + toProcess.length + ', remaining ids:', toProcess.map(function(m){return m.id;}).join(','));

                if (toProcess.length === 0) {
                    alert(t('All messages have already been processed.'));
                    return;
                }

                var prevText = processHistoryBtn.textContent;
                processHistoryBtn.disabled = true;
                var BATCH = 30;
                var total = toProcess.length;
                processHistoryBtn.textContent = t('Processing...') + ' (0' + t('turns_suffix') + ')';

                var cpKey = 'ne_ph_' + getChatId();
                var processedCount = 0;
                try {
                    var cp = localStorage.getItem(cpKey);
                    if (cp) {
                        var cpData = JSON.parse(cp);
                        if (cpData.t && cpData.i >= total) {
                            console.log('[NE] Process History checkpoint stale, resetting');
                            try { localStorage.removeItem(cpKey); } catch (e2) {}
                        } else if (cpData.t && cpData.i > 0) {
                            processedCount = cpData.i;
                            console.log('[NE] Resuming Process History from message', processedCount + 1, '/', total);
                        }
                    }
                } catch (e) {}

                var PIPELINE_TIMEOUT_MS = 60000;
                if (!tryAcquire('stm')) {
                    console.log('[NE] processHistory: waiting for pipeline — state=' + getState());
                    await waitForPipelineTrackIdle(PIPELINE_TIMEOUT_MS);
                    if (!tryAcquire('stm')) {
                        console.warn('[NE] processHistory: pipeline still blocked, forcing reset');
                        reset();
                        tryAcquire('stm');
                    }
                }
                try {
                    var accumTurns = processedCount;
                    processHistoryBtn.textContent = t('Processing...') + ' (0' + t('turns_suffix') + ')';
                    for (var i = processedCount; i < total; i += BATCH) {
                        var batch = toProcess.slice(i, i + BATCH);
                        var result = await executeIncrementalUpdate(getChatId(), batch, true, function(progress) {
                            accumTurns = progress.processedTurns;
                            processHistoryBtn.textContent = t('Processing...') + ' (' + accumTurns + t('turns_suffix') + ')';
                        }, true);
                        if (result.added === 0 && batch.length > 0) {
                            console.warn('[NE] Process History batch produced 0 STM entries — batch size=' + batch.length + ', check browser console for pipeline errors');
                        }
                        var done = Math.min(i + BATCH, total);
                        try {
                            localStorage.setItem(cpKey, JSON.stringify({ t: Date.now(), i: done }));
                        } catch (e2) {}
                    }
                    try { localStorage.removeItem(cpKey); } catch (e3) {}
                    processHistoryBtn.textContent = t('Completed') + ' (' + accumTurns + t('turns_suffix') + ')';
                } catch (e) {
                    console.error('[NE] Process history failed:', e);
                    alert(t('Process History') + ' failed: ' + e.message);
                    processHistoryBtn.textContent = t('Failed');
                } finally {
                    releasePipeline();
                    setTimeout(function () {
                        processHistoryBtn.textContent = prevText;
                        processHistoryBtn.disabled = false;
                    }, 1500);
                    busEmit('vault:updated', { getChatId: getChatId });
                }
            };
        }

        var exportBtn = panelById('narrative_vault_export_json');
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

        var importBtn = panelById('narrative_vault_import_json');
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
                        busEmit('vault:updated', { getChatId: getChatId });
                    } catch (e) {
                        console.error('[NE] Import failed:', e);
                        alert(t('Import JSON') + ' failed: ' + e.message);
                    }
                };
                input.click();
            };
        }

        var embedBtn = panelById('narrative_vault_embed_chat');
        if (embedBtn) {
            embedBtn.onclick = async function () {
                try {
                    var ctx = window.parent.SillyTavern && window.parent.SillyTavern.getContext ? window.parent.SillyTavern.getContext() : null;
                    if (!ctx || !ctx.chatMetadata || typeof ctx.saveChat !== 'function') {
                        alert(t('Embed into Chat') + ': Cannot access SillyTavern chat API.');
                        return;
                    }
                    var vault = await loadVault(getChatId());
                    ctx.chatMetadata.ne_vault = JSON.stringify(vault);
                    await ctx.saveChat();
                    alert(t('Embed into Chat') + ' ' + t('Done') + ' — ' + t('Vault is now embedded in chat_metadata. Export or backup will carry it.'));
                } catch (e) {
                    console.error('[NE] Embed failed:', e);
                    alert(t('Embed into Chat') + ' failed: ' + e.message);
                }
            };
        }

        var cleanOrphansBtn = panelById('narrative_vault_clean_orphans');
        if (cleanOrphansBtn) {
            cleanOrphansBtn.onclick = async function () {
                try {
                    cleanOrphansBtn.disabled = true;
                    cleanOrphansBtn.textContent = t('Scanning...');
                    var results = await scanOrphans();
                    cleanOrphansBtn.textContent = t('Clean Orphan Data');
                    cleanOrphansBtn.disabled = false;

                    var activeCount = 0;
                    var aliveCount = 0;
                    var orphans = [];
                    for (var i = 0; i < results.length; i++) {
                        var r = results[i];
                        if (r.status === 'active') activeCount++;
                        else if (r.status === 'alive') aliveCount++;
                        else if (r.status === 'orphan') orphans.push(r);
                    }

                    if (orphans.length === 0) {
                        alert(t('No orphan data found. All IndexedDB entries are linked to existing chats.') +
                            '\n' + t('Active:') + ' ' + activeCount + ' | ' + t('Fingerprint matches:') + ' ' + aliveCount);
                        return;
                    }

                    var msg = t('Orphan data scan results:') + '\n\n' +
                        t('Active chats:') + ' ' + activeCount + '\n' +
                        t('Fingerprint matches:') + ' ' + aliveCount + '\n' +
                        t('Orphan entries:') + ' ' + orphans.length + '\n\n' +
                        t('Orphan chat IDs:') + '\n';
                    for (var j = 0; j < orphans.length; j++) {
                        var o = orphans[j];
                        msg += '  - ' + o.chat_id + ' (v' + o.version + ', stm=' + o.stm + ', ltm=' + o.ltm + ')\n';
                    }
                    msg += '\n' + t('Delete these orphan vaults and all their snapshots?');

                    if (!await showConfirm(t('Delete orphan vaults?'), msg.split('\n').slice(0, -1).join('\n'), t('Delete'), t('Cancel'), true)) return;

                    var cleanedCount = 0;
                    for (var k = 0; k < orphans.length; k++) {
                        await purgeOrphanChatData(orphans[k].chat_id);
                        cleanedCount++;
                    }
                    alert(t('Cleaned') + ' ' + cleanedCount + ' ' + t('orphan entries') + '.');

                    var currentId = getChatId();
                    if (currentId) renderHistory(currentId);
                } catch (e) {
                    console.error('[NE] Clean orphans failed:', e);
                    alert(t('Clean Orphan Data') + ' failed: ' + e.message);
                    if (cleanOrphansBtn) {
                        cleanOrphansBtn.textContent = t('Clean Orphan Data');
                        cleanOrphansBtn.disabled = false;
                    }
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
            try {
                var ro = new ResizeObserver(function(entries) {
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

        // Initialize Test Runner UI
        if (window.__NE_DEV_MODE) initTestRunner();

        renderSettingsTab();

        // ── L3: Esc to close vault overlay ──
        pdAddEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            var overlay = byId('ne_vault_bottom_overlay');
            if (overlay && overlay.classList.contains('open')) {
                closeVaultOverlay();
            }
        });

        // ── Pipeline status callback (no polling — push from pipeline-guard) ──
        var _updatePipelineUI = function(phase) {
            var el = panelById('ne_pipeline_status');
            if (!el) return;
            if (phase === 'idle') {
                el.textContent = t('Idle');
                el.style.color = 'var(--grey-50)';
            } else {
                el.textContent = t('Active:') + ' ' + t(phase === 'state' ? 'State Extraction' : phase === 'stm' ? 'STM Extraction' : 'LTM Consolidation');
                el.style.color = 'var(--ne-warning)';
            }
        };
        onPipelineChange(_updatePipelineUI);
        _updatePipelineUI(getState());
    } catch (e) {
        console.error('[NE] Vault panel render failed:', e);
    }
}
