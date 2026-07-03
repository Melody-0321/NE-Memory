import { read, write, isStorageBlocked, collectAllMsgIds, sortStmByMsgOrder } from '../core/vault/store.js';
import { loadVault } from '../core/auto-restore.js';
import { splitStmsIntoContiguousGroups } from '../core/engine/consolidate.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { isStateSchemaEnabled } from '../core/vault/schema.js';
import { qs, qsa, byId, pdCreate, pdHead, pdAddEventListener, t, PD,
  sortLtmByMsgOrder, closeVaultOverlay, vaultLLMLog, lastVaultStateJson,
  _updatingPopout, _currentGetChatId, setUpdatingPopout, setLastVaultStateJson,
  panelById, panelQS, panelQSA, showConfirm, emptyStateHtml } from './panel-shared.js';
import { renderQuickIndex, _pendingInlineStorage, _lazyRendered,
  _currentCollapseState, _currentChatIdForCollapse, setPendingInlineStorage } from './panel-drawer.js';
import { renderCharacterPanelHTML, renderFactionPanelHTML, renderQuestPanelHTML,
  renderMemoryTable, enterCardEditMode, getCharacterSchemaForPanel } from './panel-state-cards.js';

export async function updateVaultViewerPopout(getChatId) {
    if (_updatingPopout) return;
    if (typeof getChatId !== 'function') {
        console.error('[NE-VAULT] updateVaultViewerPopout called with non-function getChatId (type=' + typeof getChatId + ')', getChatId);
        return;
    }
    console.log('[NE-VAULT] updateVaultViewerPopout start ts=' + Date.now());
    setUpdatingPopout(true);
    var loading = panelById('narrative_vault_loading');
    var errDiv = panelById('narrative_vault_panel_error');
    if (loading) loading.style.display = '';
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

    var vault, c;
    try {
        vault = await loadVault(getChatId());
        c = vault.content || {};
        console.log('[NE-PANEL] updateVaultViewerPopout chatId=' + getChatId() + ' version=' + (vault.version) + ' stm=' + (Array.isArray(c.unconsolidated_stm) ? c.unconsolidated_stm.length : 0) + ' ltm=' + (Array.isArray(c.ltm_entries) ? c.ltm_entries.length : 0));
        setPendingInlineStorage({ vault: vault, getChatId: getChatId });
        setLastVaultStateJson(c.state ? JSON.stringify(c.state, null, 2) : '{}');
    } catch (e) {
        _logSection('read-vault', e);
        if (errDiv) { errDiv.textContent = t('Failed to load vault:') + ' ' + e.message; errDiv.style.display = ''; }
        if (loading) loading.style.display = 'none';
        setUpdatingPopout(false);
        return;
    }

    // ── Section A: Header (pipeline status + API status) ──
    try {
        var verEl = panelById('ne-memory-version');
        if (verEl) {
            var verText = t('Version:') + ' ' + (vault.version || 0);
            var ts = formatLocalTime(vault.updated_at);
            if (ts) verText += ' \u00b7 ' + ts;
            verEl.textContent = verText;
        }
        var sceneEl = panelById('narrative_vault_panel_scene');
        if (sceneEl) {
            var sceneParts = [];
            if (c.story_time) sceneParts.push(c.story_time);
            if (c.story_scene) sceneParts.push(c.story_scene);
            if (c.story_date) sceneParts.push(c.story_date);
            if (c.state && c.state.main_event) sceneParts.push(c.state.main_event);
            sceneEl.textContent = sceneParts.join(' ─ ');
        }
        var apiStatus = panelById('narrative_secondary_api_status');
        if (apiStatus) {
            try {
                var raw = localStorage.getItem('ne_secondary_api');
                var secondaryConfig = raw ? JSON.parse(raw) : null;
                if (secondaryConfig && secondaryConfig.url && secondaryConfig.model) {
                    apiStatus.style.color = '#4caf50';
                    apiStatus.title = t('Secondary API:') + ' ' + secondaryConfig.model;
                } else {
                    apiStatus.style.color = '#888';
                    apiStatus.title = t('No secondary API configured');
                }
            } catch (e) { apiStatus.style.color = '#888'; }
        }
    } catch (e) { _logSection('header', e); }

    var panelBody = verEl ? verEl.parentElement : null;
    if (!panelBody) { if (loading) loading.style.display = 'none'; setUpdatingPopout(false); return; }

    // 修复区域中嵌套 Accordion 面板的显示状态，将所有子 accordion-content 统一标记
    panelQSA('.narrative_state_block').forEach(function (el) { el.remove(); });
    panelQSA('.narrative_opening_block').forEach(function (el) { el.remove(); });
    panelQSA('.narrative_faction_block').forEach(function (el) { el.remove(); });
    panelQSA('.narrative_character_block').forEach(function (el) { el.remove(); });
    panelQSA('.narrative_quest_block').forEach(function (el) { el.remove(); });

    // ── Section C: Character block ──
    try {
        var charContainer = panelById('ne_character_block_container');
        if (charContainer && isStateSchemaEnabled()) {
            var charSchema = getCharacterSchemaForPanel(c);
            var charHtml = renderCharacterPanelHTML(c.state || {}, charSchema);
            charContainer.innerHTML = charHtml || emptyStateHtml('fa-user', t('No character data'), t('Send a message to start tracking'));
            setTimeout(function() {
                var block = panelById('ne_character_block_container');
                if (!block) return;
                var buttons = block.querySelectorAll('.ne-card-edit-btn');
                buttons.forEach(function(btn) {
                    btn.onclick = function(e) {
                        e.stopPropagation();
                        enterCardEditMode(this);
                    };
                });
            }, 50);
        }
    } catch (e) { _logSection('char-block', e); }

    // ── Section D: Faction block ──
    try {
        var factionContainer = panelById('ne_faction_block_container');
        if (factionContainer && isStateSchemaEnabled()) {
            var factionHtml = renderFactionPanelHTML(c.state || {});
            factionContainer.innerHTML = factionHtml || emptyStateHtml('fa-flag', t('No faction data'), t('Faction state will appear when detected'));
        }
    } catch (e) { _logSection('faction-block', e); }

    // ── Section E: Quest block ──
    try {
        var questContainer = panelById('ne_quest_block_container');
        if (questContainer && isStateSchemaEnabled()) {
            var questHtml = renderQuestPanelHTML(c.state || {});
            questContainer.innerHTML = questHtml || emptyStateHtml('fa-scroll', t('No quest data'), t('Quest progress will be tracked automatically'));
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
    var stmCount = sortStmByMsgOrder(freshSTM).length;

    try {
        renderMemoryTable('#narrative_vault_panel_ltm_body', mergedList, 'ltm', stmIndexMap);
    } catch (e) { _logSection('render-ltm-table', e); }
    try {
        renderMemoryTable('#narrative_vault_panel_stm_body', sortStmByMsgOrder(freshSTM), 'stm');
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

    // ── Section I: Event handlers ──
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
                        await updateVaultViewerPopout(getChatId);
                    }
                } catch (e) {
                    console.warn('[NE] Clear state failed:', e);
                }
            };
        });
    } catch (e) { _logSection('event-handlers', e); }

    if (loading) loading.style.display = 'none';
    setUpdatingPopout(false);
}
