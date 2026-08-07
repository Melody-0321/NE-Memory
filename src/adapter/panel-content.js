import { readVault, write, isStorageBlocked, collectAllMsgIds, sortStmByMsgOrder } from '../core/vault/store.js';
import { recordMemoryVersion, recordStateDelta } from '../core/vault/state-versions.js';
import { splitStmsIntoContiguousGroups } from '../core/engine/consolidate.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { qs, qsa, byId, pdCreate, pdHead, pdAddEventListener, t, PD,
  sortLtmByMsgOrder, closeVaultOverlay, vaultLLMLog, lastVaultStateJson,
  _updatingPopout, _currentGetChatId, setUpdatingPopout, setLastVaultStateJson,
  panelById, panelQS, panelQSA, showConfirm, showToast, emptyStateHtml, getPanelRoot } from './panel-shared.js';
import { renderQuickIndex, _pendingInlineStorage, _lazyRendered,
  _currentCollapseState, _currentChatIdForCollapse, setPendingInlineStorage } from './panel-drawer.js';
import { renderCharacterPanelHTML, renderFactionPanelHTML, renderQuestPanelHTML,
  renderMemoryTable, enterCardEditMode, enterSchemeEditMode, getCharacterSchemaForPanel } from './panel-state-cards.js';

export async function updateVaultViewerPopout(getChatId) {
    if (_updatingPopout) return;
    var _overlay = byId('ne_vault_bottom_overlay');
    if (_overlay && _overlay.style.display === 'none') return;
    if (typeof getChatId !== 'function') {
        console.error('[NE-VAULT] updateVaultViewerPopout called with non-function getChatId (type=' + typeof getChatId + ')', getChatId);
        return;
    }
    console.log('[NE-VAULT] updateVaultViewerPopout start ts=' + Date.now());
    setUpdatingPopout(true);
    var errDiv = panelById('narrative_vault_panel_error');
    if (errDiv) errDiv.style.display = 'none';
    var warnDiv = panelById('narrative_vault_panel_storage_warn');
    if (warnDiv) {
        if (isStorageBlocked()) {
            warnDiv.textContent = t('Storage blocked: Memories cannot be saved. Disable tracking prevention for this site in your browser settings.');
            warnDiv.style.display = '';
        } else {
            warnDiv.style.display = 'none';
        }
    }

    function _logSection(name, e) {
        console.error('[NE-VAULT] Section [' + name + '] failed:', e);
        console.error('[NE-VAULT] Stack:', e.stack);
    }

    // ── Refresh protection: skip rebuild if user is editing ──
    try {
        var root = getPanelRoot();
        var ae = root ? root.activeElement : document.activeElement;
        if (ae && (ae.closest('.ne-card-edit-form') || ae.closest('.ne-inline-state-edit-area') || ae.closest('.ne-stm-edit-cell') || ae.closest('.ne-ltm-edit-cell') || ae.closest('.ne-inline-row') || ae.closest('.ne-char-edit'))) {
            showToast(t('Data updated — save your changes then refresh'), 'info', 3000);
            setUpdatingPopout(false);
            return;
        }
    } catch (e) {}

    // ── Save scroll position + open accordions for restore ──
    var _savedAccordions = [];
    var _savedScrollTop = 0;
    try {
        var scrollArea = panelQS('.ne-vault-scroll-area');
        if (scrollArea) _savedScrollTop = scrollArea.scrollTop;
        panelQSA('.ne-accordion.open').forEach(function(acc) {
            if (acc.id) _savedAccordions.push(acc.id);
        });
    } catch (e) {}

    var vault, c;
    try {
        vault = await readVault(getChatId());
        c = vault.content || {};
        if (__NE_DEV_MODE) console.log('[NE-PANEL] updateVaultViewerPopout chatId=' + getChatId() + ' version=' + (vault.version) + ' stm=' + (Array.isArray(c.unconsolidated_stm) ? c.unconsolidated_stm.length : 0) + ' ltm=' + (Array.isArray(c.ltm_entries) ? c.ltm_entries.length : 0));
        setPendingInlineStorage({ vault: vault, getChatId: getChatId });
        setLastVaultStateJson(c.state ? JSON.stringify(c.state, null, 2) : '{}');
    } catch (e) {
        _logSection('read-vault', e);
        if (errDiv) { errDiv.textContent = t('Failed to load vault:') + ' ' + e.message; errDiv.style.display = ''; }
        setUpdatingPopout(false);
        return;
    }

    // ── Section A: Scene info (State tab) ──
    try {
        var sceneEl = panelById('ne-state-scene');
        if (sceneEl) {
            var sceneParts = [];
            if (c.story_time) sceneParts.push(c.story_time);
            if (c.story_scene) sceneParts.push(c.story_scene);
            if (c.story_date) sceneParts.push(c.story_date);
            sceneEl.textContent = sceneParts.join(' \u2500 ');
        }
    } catch (e) { _logSection('header', e); }

    if (!panelById('tab-memory')) { setUpdatingPopout(false); return; }

    // 修复区域中嵌套 Accordion 面板的显示状态，将所有子 accordion-content 统一标记
    panelQSA('.narrative_state_block').forEach(function (el) { el.remove(); });
    panelQSA('.narrative_opening_block').forEach(function (el) { el.remove(); });
    panelQSA('.narrative_faction_block').forEach(function (el) { el.remove(); });
    panelQSA('.narrative_character_block').forEach(function (el) { el.remove(); });
    panelQSA('.narrative_quest_block').forEach(function (el) { el.remove(); });

    // ── Section C: Character block ──
    var _anyBlockChanged = false;
    try {
        var charContainer = panelById('ne_character_block_container');
        if (charContainer) {
            var charSchema = getCharacterSchemaForPanel(c);
            var charHtml = renderCharacterPanelHTML(c.state || {}, charSchema);
            var charFinalHtml = charHtml || emptyStateHtml('\u{1F464}', t('No character data'), t('Send a message to start tracking'));
            var charChanged = charFinalHtml !== _renderCache.char;
            if (charChanged) {
                charContainer.innerHTML = charFinalHtml;
                _renderCache.char = charFinalHtml;
                _anyBlockChanged = true;
                // 同步绑定（innerHTML 赋值后 DOM 已就绪，无需 setTimeout 50ms）
                var buttons = charContainer.querySelectorAll('.ne-card-edit-btn');
                buttons.forEach(function(btn) {
                    btn.onclick = function(e) {
                        e.stopPropagation();
                        enterCardEditMode(this);
                    };
                });
                var schemeBtns = charContainer.querySelectorAll('.ne-card-scheme-btn');
                for (var i = 0; i < schemeBtns.length; i++) {
                    schemeBtns[i].addEventListener('click', function(e) {
                        e.stopPropagation();
                        var card = this.closest('.ne-char-card');
                        var charName = this.getAttribute('data-char');
                        var cardType = this.getAttribute('data-cardtype') || 'npc';
                        enterSchemeEditMode(card, charName, cardType);
                    });
                }
                var lockBtns = charContainer.querySelectorAll('.ne-card-lock-btn');
                for (var j = 0; j < lockBtns.length; j++) {
                    lockBtns[j].addEventListener('click', async function(e) {
                        e.stopPropagation();
                        var name = this.getAttribute('data-char');
                        var chatId = _currentGetChatId ? _currentGetChatId() : null;
                        if (!chatId) { showToast('No active chat', 'warn', 2000); return; }
                        var vault = await readVault(chatId);
                        if (!vault || !vault.content || !vault.content.state) { showToast('No state data', 'warn', 2000); return; }
                        var state = vault.content.state;
                        if (!state.characters) state.characters = {};
                        if (!state.characters[name]) state.characters[name] = {};
                        var isLocked = !state.characters[name]._templateLocked;
                        state.characters[name]._templateLocked = isLocked;
                        await write(chatId, vault);
                        recordStateDelta(chatId, { source: 'manual_edit', summary: '切换模板锁定 ' + name, changes: [], message_dates: [] }).catch(function(e) { console.warn('[NE] manual_edit version record failed:', e); });
                        if (isLocked) {
                            this.classList.add('locked');
                            this.textContent = '\u{1F512}';
                        } else {
                            this.classList.remove('locked');
                            this.textContent = '\u{1F513}';
                        }
                        showToast((isLocked ? t('locked') : t('unlock')) + ': ' + name, 'info', 2000);
                    });
                }
            }
        }
    } catch (e) { _logSection('char-block', e); }

    // ── Section D: Faction block ──
    try {
        var factionContainer = panelById('ne_faction_block_container');
        if (factionContainer) {
            var factionHtml = renderFactionPanelHTML(c.state || {});
            var factionFinalHtml = factionHtml || emptyStateHtml('\u2691', t('No faction data'), t('Faction state will appear when detected'));
            if (factionFinalHtml !== _renderCache.faction) {
                factionContainer.innerHTML = factionFinalHtml;
                _renderCache.faction = factionFinalHtml;
                _anyBlockChanged = true;
            }
        }
    } catch (e) { _logSection('faction-block', e); }

    // ── Section E: Quest block ──
    try {
        var questContainer = panelById('ne_quest_block_container');
        if (questContainer) {
            var questHtml = renderQuestPanelHTML(c.state || {});
            var questFinalHtml = questHtml || emptyStateHtml('\u{1F4DC}', t('No quest data'), t('Quest progress will be tracked automatically'));
            if (questFinalHtml !== _renderCache.quest) {
                questContainer.innerHTML = questFinalHtml;
                _renderCache.quest = questFinalHtml;
                _anyBlockChanged = true;
            }
        }
    } catch (e) { _logSection('quest-block', e); }

    // ── Section F: STM index + self-heal ──
    var stmIndexMap = {};
    try {
        var stmEntries = Array.isArray(c.stm_entries) ? c.stm_entries : [];
        var unconsolidatedRaw = Array.isArray(c.unconsolidated_stm) ? c.unconsolidated_stm : [];
        stmEntries.forEach(function (s) { stmIndexMap[s.id] = s; });
        unconsolidatedRaw.forEach(function (s) { stmIndexMap[s.id] = s; });

        var misplacedEntries = unconsolidatedRaw.filter(function (e) { return e.parent_ltm; });
        if (misplacedEntries.length > 0) {
            console.log('[NE] Vault panel: moving ' + misplacedEntries.length + ' consolidated STM entries from unconsolidated_stm to stm_entries');
            c.stm_entries = stmEntries.concat(misplacedEntries);
            c.unconsolidated_stm = unconsolidatedRaw.filter(function (e) { return !e.parent_ltm; });
            await write(getChatId(), vault);
            recordMemoryVersion(getChatId(), { type: 'manual_edit', summary: 'STM 自愈迁移 ' + misplacedEntries.length + ' 条', delta: {}, message_dates: [] }).catch(function(e) { console.warn('[NE] manual_edit version record failed:', e); });
            stmIndexMap = {};
            var stmEntries2 = Array.isArray(c.stm_entries) ? c.stm_entries : [];
            var unconsolidatedRaw2 = Array.isArray(c.unconsolidated_stm) ? c.unconsolidated_stm : [];
            stmEntries2.forEach(function (s) { stmIndexMap[s.id] = s; });
            unconsolidatedRaw2.forEach(function (s) { stmIndexMap[s.id] = s; });
        }
    } catch (e) { _logSection('stm-index+selfheal', e); }

    // ── Section G: Memory table rendering ──
    var rawSTM = Array.isArray(c.unconsolidated_stm) ? c.unconsolidated_stm : [];
    var freshSTM = rawSTM.filter(function(s) { return s.parent_ltm !== null; });
    var orphans = rawSTM.filter(function(s) { return s.parent_ltm === null; });
    var orphanGroups = splitStmsIntoContiguousGroups(orphans, 3);

    var ltmEntries = sortLtmByMsgOrder(Array.isArray(c.ltm_entries) ? c.ltm_entries : [], stmIndexMap);

    function getFirstMsgStart(entry, stmIdx) {
        if (entry._type === 'orphan_group') {
            return (entry.stms[0] && entry.stms[0].absMsgStart !== undefined) ? entry.stms[0].absMsgStart : Infinity;
        }
        var refs = entry.stm_refs || [];
        var firstStm = stmIdx[refs[0]];
        return (firstStm && firstStm.absMsgStart !== undefined) ? firstStm.absMsgStart : Infinity;
    }

    var mergedList = [];
    ltmEntries.forEach(function(ltm) { mergedList.push(ltm); });
    orphanGroups.forEach(function(group, gi) {
        mergedList.push({ _type: 'orphan_group', _id: 'orphan_' + gi, stms: group });
    });
    mergedList.sort(function(a, b) {
        return getFirstMsgStart(a, stmIndexMap) - getFirstMsgStart(b, stmIndexMap);
    });

    var ltmCount = ltmEntries.length;
    var stmView = sortStmByMsgOrder(freshSTM);
    var stmCount = stmView.length;

    // ── UIP-1: tbody 输入签名缓存（JSON 序列化覆盖全部渲染字段，安全失效） ──
    var ltmSig = JSON.stringify(mergedList);
    var stmSig = JSON.stringify(stmView);
    try {
        if (ltmSig !== _renderCache.ltm) {
            renderMemoryTable('#narrative_vault_panel_ltm_body', mergedList, 'ltm', stmIndexMap);
            _renderCache.ltm = ltmSig;
            _anyBlockChanged = true;
        }
    } catch (e) { _logSection('render-ltm-table', e); }
    try {
        if (stmSig !== _renderCache.stm) {
            renderMemoryTable('#narrative_vault_panel_stm_body', stmView, 'stm');
            _renderCache.stm = stmSig;
            _anyBlockChanged = true;
        }
    } catch (e) { _logSection('render-stm-table', e); }

    // ── Section H: Counts + quick index ──
    try {
        var stmCountEl = panelById('ne-stm-count');
        if (stmCountEl) stmCountEl.textContent = '\u00B7 ' + stmCount + ' ' + t('entries');
        var ltmCountEl = panelById('ne-ltm-count');
        if (ltmCountEl) ltmCountEl.textContent = '\u00B7 ' + ltmCount + ' ' + t('entries');

        var chars = (c.state && c.state.characters) ? c.state.characters : {};
        var charCount = Object.keys(chars).length;
        var factions = (c.state && c.state.factions) ? c.state.factions : {};
        var factionCount = Object.keys(factions).length;
        var quests = (c.state && c.state.quests) ? c.state.quests : {};
        var questCount = (quests.tasks ? Object.keys(quests.tasks).length : 0) + (quests.goals ? Object.keys(quests.goals).length : 0) + (quests.events ? Object.keys(quests.events).length : 0);

        var charCountEl = panelById('ne-char-count');
        if (charCountEl) charCountEl.textContent = '\u00B7 ' + charCount;
        var questCountEl = panelById('ne-quest-count');
        if (questCountEl) questCountEl.textContent = '\u00B7 ' + questCount;
        var factionCountEl = panelById('ne-faction-count');
        if (factionCountEl) factionCountEl.textContent = '\u00B7 ' + factionCount;

        var chatId = getChatId();
        renderQuickIndex(stmCount, ltmCount, charCount, questCount, factionCount, c.state && Object.keys(c.state).length > 0, chatId);
    } catch (e) { _logSection('counts+quickindex', e); }

    // ── Section I: Event handlers + scroll/accordion restore ──
    // UIP-1: 所有区块均未变化时 DOM 未动，跳过重绑与恢复（旧绑定依然有效）
    if (_anyBlockChanged) {
    try {
        panelQSA('.ne-inline-state-edit-btn').forEach(function(btn) {
            btn.onclick = function() {
                panelQS('.ne-inline-state-view').classList.add('hidden');
                panelQS('.ne-inline-state-edit-area').classList.add('active');
            };
        });
        panelQSA('.ne-state-edit-cancel').forEach(function(btn) {
            btn.onclick = function() {
                panelQS('.ne-inline-state-edit-area').classList.remove('active');
                panelQS('.ne-inline-state-view').classList.remove('hidden');
            };
        });
        panelQSA('.ne-state-edit-save').forEach(function(btn) {
            btn.onclick = async function() {
                try {
                    var ta = panelById('ne_state_edit_textarea');
                    var json = ta ? JSON.parse(ta.value) : {};
                    c.state = json;
                    await write(getChatId(), vault);
                    recordStateDelta(getChatId(), { source: 'manual_edit', summary: 'JSON 编辑 state', changes: [], message_dates: [] }).catch(function(e) { console.warn('[NE] manual_edit version record failed:', e); });
                    await updateVaultViewerPopout(getChatId);
                } catch(e) { alert(t('Invalid JSON') + ': ' + e.message); }
            };
        });

        panelQSA('.narrative_clear_state_btn').forEach(function (btn) {
            btn.onclick = async function () {
                try {
                    if (await showConfirm(t('Clear all state?'), t('LLM will regenerate from character card and world book on next turn.'), t('Clear'), t('Cancel'), true)) {
                        c.state = {};
                        await write(getChatId(), vault);
                        recordStateDelta(getChatId(), { source: 'manual_edit', summary: '清空 state', changes: [], message_dates: [] }).catch(function(e) { console.warn('[NE] manual_edit version record failed:', e); });
                        await updateVaultViewerPopout(getChatId);
                    }
                } catch (e) {
                    console.warn('[NE] Clear state failed:', e);
                }
            };
        });
    } catch (e) { _logSection('event-handlers', e); }

    // ── Restore scroll position + accordion states ──
    try {
        if (_savedAccordions.length > 0 || _savedScrollTop > 0) {
            requestAnimationFrame(function() {
                _savedAccordions.forEach(function(id) {
                    var acc = panelById(id);
                    if (acc) acc.classList.add('open');
                });
                var sa = panelQS('.ne-vault-scroll-area');
                if (sa && _savedScrollTop > 0) sa.scrollTop = _savedScrollTop;
            });
        }
    } catch (e) {}
    }

    setUpdatingPopout(false);
}
