/**
 * panel-templates.js - Template Library Slide-in Panel
 *
 * Renders into the slide-in panel (📋 pin row icon):
 *   Tab 1: Template config panel (PC slot / NPC pool / Mode / World context)
 *   Tab 2: Template library browser (role tabs: PC/NPC/Faction/Quest)
 *   Sub-view: Template editor / detail view (with version history)
 */

import { loadTemplateLibrary, saveTemplateLibrary, saveTemplate, deleteTemplate, getTemplate, getEffectiveTemplates,
  loadCardConfig, saveCardConfig, loadCardConfigSync, setDialogueTemplateLock, isDialogueTemplateLocked,
  editTemplateInCard, forkTemplateInCard, pushTemplateToGlobal, restoreTemplateVersion, getActiveVersionKey } from '../core/vault/store.js';
import { PRESET_FIELDS, ALL_PREDEFINED_FIELDS, buildCharacterSchemaFromTemplates, DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE, DEFAULT_FACTION_TEMPLATE, DEFAULT_QUEST_TEMPLATE } from '../core/vault/schema.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { PD, pdCreate, panelById, t, showToast, showConfirm, busEmit, openSlidePanel, closeSlidePanel } from './panel-shared.js';

// ── Slide-in root state ──
var _lastRenderTick = 0;
var _renderTicket = 0;
var _activeTopTab = 'config'; // 'config' | 'library'
var _activeRoleTab = 'npc';   // 'pc' | 'npc' | 'faction' | 'quest'
var _searchQuery = '';
var _activeTagFilter = null;
var _sortBy = 'default';      // 'default' | 'name' | 'date' | 'fields'
var _worldCtxEditing = false;

/** Get current SillyTavern character name for card config key */
function _getCurrentCharName() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.name2) return ctx.name2;
        }
    } catch (e) {}
    try {
        var fn = window.__NE_CURRENT_CHAT_ID;
        if (typeof fn === 'function') return fn();
    } catch (e) {}
    return null;
}

/**
 * Main slide-in entry point. Called by registerSlideRenderer('templates', ...).
 * @param {HTMLElement} container - #ne-slide-panel-content
 */
export function renderTemplatesIntoSlide(container) {
    if (!container) return;
    var ticket = ++_renderTicket;

    var lib = getEffectiveTemplates();
    var templates = (lib && lib.templates) ? lib.templates : {};
    var order = (lib && lib.order) ? lib.order : [];
    var cardConfig = null;
    try {
        var charName = _getCurrentCharName();
        cardConfig = charName ? loadCardConfigSync(charName) : null;
    } catch (e) { /* no card config yet */ }

    if (ticket !== _renderTicket) return;

    var html = '';
    // P1: Top-level Tab bar
    html += '<div class="ne-vault-tab-bar" style="margin-bottom:8px;">';
    html += '<div class="ne-vault-tab' + (_activeTopTab === 'config' ? ' active' : '') + '" data-top-tab="config">' + escapeHtml(t('dialogue_config')) + '</div>';
    html += '<div class="ne-vault-tab' + (_activeTopTab === 'library' ? ' active' : '') + '" data-top-tab="library">' + escapeHtml(t('template_library')) + '</div>';
    html += '</div>';

    // P1: Tab content containers
    html += '<div class="ne-vault-tab-content' + (_activeTopTab === 'config' ? ' active' : '') + '" id="ne-tab-config">';
    html += _renderConfigPanelHTML(cardConfig, templates, order);
    html += '</div>';

    html += '<div class="ne-vault-tab-content' + (_activeTopTab === 'library' ? ' active' : '') + '" id="ne-tab-library">';
    html += _renderLibraryHTML(templates, order, cardConfig);
    html += '</div>';

    container.innerHTML = html;

    // Bind top-level tab events
    _hookTopTabs(container);

    // Bind events
    _hookLibraryEvents(container, templates, order, cardConfig);
    _hookConfigEvents(container, cardConfig, templates, order);

    _lastRenderTick = Date.now();
}

// ─────────────────────────────────────
// Top-level tab switching (P1)
// ─────────────────────────────────────

function _hookTopTabs(container) {
    var tabs = container.querySelectorAll('[data-top-tab]');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function () {
            var tabId = this.getAttribute('data-top-tab');
            _activeTopTab = tabId;
            // Toggle active classes
            var allTabs = container.querySelectorAll('[data-top-tab]');
            for (var j = 0; j < allTabs.length; j++) {
                allTabs[j].classList.toggle('active', allTabs[j].getAttribute('data-top-tab') === tabId);
            }
            var configContent = container.querySelector('#ne-tab-config');
            var libraryContent = container.querySelector('#ne-tab-library');
            if (configContent) configContent.classList.toggle('active', tabId === 'config');
            if (libraryContent) libraryContent.classList.toggle('active', tabId === 'library');
        });
    }
}

// ─────────────────────────────────────
// Config panel (P7: polished)
// ─────────────────────────────────────

function _renderConfigPanelHTML(cardConfig, templates, order) {
    var cfg = cardConfig && cardConfig._templateConfig ? cardConfig._templateConfig : {};
    var pcTemplate = cfg.pc || null;
    var npcPool = (cfg.npc && Array.isArray(cfg.npc)) ? cfg.npc : [];
    var npcMode = cfg._npcTemplateMode || 'smart';
    var worldCtx = (cardConfig && cardConfig._worldContext) ? cardConfig._worldContext : null;
    var hasChar = !!_getCurrentCharName();

    if (!hasChar) {
        return '<div class="ne-template-config" id="ne-template-config">' +
            '<div class="ne-empty-state"><div class="ne-empty-state-icon">📋</div>' +
            '<div class="ne-empty-state-text">' + escapeHtml(t('no_current_char')) + '</div></div></div>';
    }

    var pcOptions = Object.keys(templates).filter(function (id) {
        return templates[id] && templates[id].role === 'pc';
    });
    var npcOptions = Object.keys(templates).filter(function (id) {
        return templates[id] && templates[id].role === 'npc';
    });

    var html = '<div class="ne-template-config" id="ne-template-config">';
    html += '<div class="ne-config-section-title">' + escapeHtml(t('dialogue_config')) + '</div>';

    // PC Template selector
    html += '<div class="ne-config-field">';
    html += '<label>' + escapeHtml(t('pc_scheme')) + '</label>';
    html += '<select id="ne-config-pc-template" class="ne-config-select">';
    html += '<option value="">' + escapeHtml(t('no_selection')) + '</option>';
    pcOptions.forEach(function (id) {
        var tpl = templates[id];
        var selected = (pcTemplate && pcTemplate._templateId === id) ? ' selected' : '';
        html += '<option value="' + escapeHtml(id) + '"' + selected + '>' + escapeHtml(tpl.name || id) + '</option>';
    });
    html += '</select></div>';

    // NPC Pool
    html += '<div class="ne-config-field">';
    html += '<label>' + escapeHtml(t('npc_template_pool')) + '</label>';
    html += '<div id="ne-config-npc-pool">';
    if (npcPool.length === 0) {
        html += '<div class="ne-config-empty">' + escapeHtml(t('no_templates')) + '</div>';
    } else {
        npcPool.forEach(function (entry) {
            var tpl = templates[entry._templateId];
            var label = (tpl && tpl.name) ? tpl.name : (entry._templateId || '?');
            var dtLocked = isDialogueTemplateLocked(_getCurrentCharName(), entry._templateId);
            // N7: Show _state badge from card-level dialogue template
            var dtState = _getDialogueTemplateState(cardConfig, entry._templateId);
            var stateBadge = '';
            if (dtState && dtState !== 'synced') {
                var stateClass = dtState === 'forked' ? 'src-ai' : (dtState === 'orphaned' ? 'src-user' : '');
                var stateLabel = dtState === 'forked' ? t('duplicate') : (dtState === 'orphaned' ? t('orphaned') : '');
                stateBadge = ' <span class="ne-template-source-badge ' + stateClass + '" style="font-size:0.7em;">' + escapeHtml(stateLabel) + '</span>';
            }
            html += '<div class="ne-config-npc-item">' +
                '<span>' + escapeHtml(label) + stateBadge + '</span>' +
                '<span class="ne-npc-lock-btn' + (dtLocked ? ' locked' : '') + '" data-lock-npc="' + escapeHtml(entry._templateId) + '" title="' + escapeHtml(t('lock_tooltip')) + '" data-template-name="' + escapeHtml(label) + '">' + (dtLocked ? '\u{1F512}' : '\u{1F513}') + '</span>' +
                '<button class="ne-btn-small ne-btn-danger" data-remove-npc="' + escapeHtml(entry._templateId) + '" title="' + escapeHtml(t('remove')) + '">\u2715</button>' +
                '</div>';
        });
    }
    html += '</div>';
    html += '<button id="ne-config-add-npc" class="ne-btn-small">' + escapeHtml(t('add_from_library')) + '</button>';
    html += '</div>';

    // NPC Mode
    html += '<div class="ne-config-field">';
    html += '<label>' + escapeHtml(t('npc_mode')) + '</label>';
    html += '<label class="ne-radio-label"><input type="radio" name="ne-npc-mode" value="fast"' + (npcMode === 'fast' ? ' checked' : '') + '> ' + escapeHtml(t('fast_mode')) + '</label>';
    html += '<label class="ne-radio-label"><input type="radio" name="ne-npc-mode" value="smart"' + (npcMode === 'smart' ? ' checked' : '') + '> ' + escapeHtml(t('smart_adjust')) + '</label>';
    html += '</div>';

    // Faction Template selector
    var factionOptions = Object.keys(templates).filter(function (id) {
        return templates[id] && templates[id].role === 'faction';
    });
    var selectedFaction = cfg.faction || '_default_faction';
    html += '<div class="ne-config-field">';
    html += '<label>' + escapeHtml(t('faction_template')) + '</label>';
    html += '<select id="ne-config-faction-template" class="ne-config-select">';
    factionOptions.forEach(function (id) {
        var tpl = templates[id];
        var selected = (selectedFaction === id) ? ' selected' : '';
        html += '<option value="' + escapeHtml(id) + '"' + selected + '>' + escapeHtml(tpl.name || id) + '</option>';
    });
    html += '</select></div>';

    // Quest Template pool
    var questOptions = Object.keys(templates).filter(function (id) {
        return templates[id] && templates[id].role === 'quest';
    });
    var questPool = (cfg.quest && Array.isArray(cfg.quest)) ? cfg.quest : ['_default_quest'];
    html += '<div class="ne-config-field">';
    html += '<label>' + escapeHtml(t('quest_templates')) + '</label>';
    html += '<div id="ne-config-quest-pool">';
    questPool.forEach(function (qid) {
        var qTpl = templates[qid];
        var qLabel = (qTpl && qTpl.name) ? qTpl.name : (qid || '?');
        html += '<div class="ne-config-npc-item">' +
            '<span>' + escapeHtml(qLabel) + '</span>' +
            '<button class="ne-btn-small ne-btn-danger" data-remove-quest="' + escapeHtml(qid) + '" title="' + escapeHtml(t('remove')) + '">\u2715</button>' +
            '</div>';
    });
    html += '</div>';
    if (questOptions.length > 0) {
        html += '<button id="ne-config-add-quest" class="ne-btn-small">' + escapeHtml(t('add_quest_template')) + '</button>';
    }
    html += '</div>';

    // World Context (P7: editable)
    html += '<div class="ne-config-field">';
    html += '<label>' + escapeHtml(t('world_context')) + '</label>';
    html += '<div id="ne-config-world-ctx" class="ne-config-world">';
    if (_worldCtxEditing) {
        var ctxText = worldCtx ? (typeof worldCtx === 'string' ? worldCtx : (worldCtx.summary || worldCtx.text || JSON.stringify(worldCtx))) : '';
        html += '<textarea class="ne-world-ctx-edit-area" id="ne-world-ctx-edit">' + escapeHtml(ctxText) + '</textarea>';
        html += '<div class="ne-world-ctx-actions">';
        html += '<button class="ne-btn-small" id="ne-world-ctx-save">' + escapeHtml(t('Save')) + '</button>';
        html += '<button class="ne-btn-small" id="ne-world-ctx-cancel">' + escapeHtml(t('Cancel')) + '</button>';
        html += '</div>';
    } else if (worldCtx) {
        var displayText = typeof worldCtx === 'string' ? worldCtx : (worldCtx.summary || worldCtx.text || JSON.stringify(worldCtx));
        var ctxTime = (worldCtx._extractedAt || worldCtx.extractedAt || '');
        var genre = (typeof worldCtx === 'object' && worldCtx.genre) ? worldCtx.genre : '';
        html += '<div class="ne-world-ctx-text">' + escapeHtml(displayText.substring(0, 200));
        if (genre) html += ' <span class="ne-template-source-badge src-ai" style="margin-left:4px;">' + escapeHtml(genre) + '</span>';
        html += '</div>';
        if (ctxTime) html += '<div class="ne-world-ctx-meta">' + escapeHtml(t('ai_extracted')) + ' \u00b7 ' + escapeHtml(formatLocalTime(ctxTime)) + '</div>';
        html += '<div class="ne-world-ctx-actions">';
        html += '<button class="ne-btn-small" id="ne-world-ctx-edit-btn">' + escapeHtml(t('edit_world_context')) + '</button>';
        html += '<button class="ne-btn-small ne-btn-danger" id="ne-world-ctx-clear-btn">' + escapeHtml(t('clear_world_context')) + '</button>';
        html += '</div>';
    } else {
        html += '<div class="ne-config-empty">' + escapeHtml(t('no_world_context')) + '</div>';
        html += '<div class="ne-world-ctx-actions">';
        html += '<button class="ne-btn-small" id="ne-world-ctx-edit-btn">' + escapeHtml(t('edit_world_context')) + '</button>';
        html += '</div>';
    }
    html += '</div></div>';

    html += '</div>';
    return html;
}

// ─────────────────────────────────────
// Library view (P2: role tabs, P3: search/filter/sort)
// ─────────────────────────────────────

function _renderLibraryHTML(templates, order, cardConfig) {
    var html = '<div class="ne-template-library" id="ne-template-library">';

    // P3: Toolbar (search + sort)
    html += '<div class="ne-template-toolbar">';
    html += '<input type="text" id="ne-template-search" placeholder="' + escapeHtml(t('search_templates')) + '" value="' + escapeHtml(_searchQuery) + '">';
    html += '<select id="ne-template-sort">';
    html += '<option value="default"' + (_sortBy === 'default' ? ' selected' : '') + '>' + escapeHtml(t('sort_by')) + '</option>';
    html += '<option value="name"' + (_sortBy === 'name' ? ' selected' : '') + '>' + escapeHtml(t('sort_name')) + '</option>';
    html += '<option value="date"' + (_sortBy === 'date' ? ' selected' : '') + '>' + escapeHtml(t('sort_date')) + '</option>';
    html += '<option value="fields"' + (_sortBy === 'fields' ? ' selected' : '') + '>' + escapeHtml(t('sort_fields')) + '</option>';
    html += '</select>';
    html += '<button id="ne-btn-create-template" class="ne-btn-small">+ ' + escapeHtml(t('create_template')) + '</button>';
    html += '</div>';

    // P2: Role tabs
    var roles = [
        { key: 'pc', label: t('role_pc') },
        { key: 'npc', label: t('role_npc') },
        { key: 'faction', label: t('role_faction') },
        { key: 'quest', label: t('role_quest') }
    ];
    html += '<div class="ne-template-role-tabs">';
    roles.forEach(function (r) {
        html += '<div class="ne-template-role-tab' + (_activeRoleTab === r.key ? ' active' : '') + '" data-role-tab="' + r.key + '">' + escapeHtml(r.label) + '</div>';
    });
    html += '</div>';

    // Group templates by role
    var byRole = { pc: [], npc: [], faction: [], quest: [] };
    order.forEach(function (id) {
        var tpl = templates[id];
        if (!tpl) return;
        var role = (tpl.role === 'pc' || tpl.role === 'npc' || tpl.role === 'faction' || tpl.role === 'quest') ? tpl.role : 'npc';
        byRole[role].push(id);
    });

    // Render each role content
    roles.forEach(function (r, idx) {
        var roleIds = byRole[r.key];
        var active = _activeRoleTab === r.key;

        // P3: Collect tags for this role
        var allTags = {};
        roleIds.forEach(function (id) {
            var tpl = templates[id];
            if (tpl && tpl.tags) {
                tpl.tags.forEach(function (tag) { allTags[tag] = true; });
            }
        });

        html += '<div class="ne-template-role-content' + (active ? ' active' : '') + '" data-role-content="' + r.key + '">';

        // P3: Tag filter chips
        var tagKeys = Object.keys(allTags);
        if (tagKeys.length > 0) {
            html += '<div class="ne-tag-chips">';
            html += '<span class="ne-tag-chip' + (!_activeTagFilter ? ' active' : '') + '" data-tag-filter="">' + escapeHtml(t('all_tags')) + '</span>';
            tagKeys.forEach(function (tag) {
                html += '<span class="ne-tag-chip' + (_activeTagFilter === tag ? ' active' : '') + '" data-tag-filter="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</span>';
            });
            html += '</div>';
        }

        if (roleIds.length === 0) {
            html += '<div class="ne-empty-state"><div class="ne-empty-state-icon">📝</div>' +
                '<div class="ne-empty-state-text">' + escapeHtml(t('no_templates')) + '</div></div>';
        } else {
            // Sort
            var sortedIds = _sortTemplateIds(roleIds, templates);

            // NPC: group by first tag
            if (r.key === 'npc') {
                var byCategory = {};
                var uncategorized = [];
                sortedIds.forEach(function (id) {
                    var tpl = templates[id];
                    var cat = (tpl.tags && tpl.tags.length > 0) ? tpl.tags[0] : null;
                    if (cat) {
                        if (!byCategory[cat]) byCategory[cat] = [];
                        byCategory[cat].push(id);
                    } else {
                        uncategorized.push(id);
                    }
                });
                Object.keys(byCategory).forEach(function (cat) {
                    html += '<div class="ne-npc-category-title">' + escapeHtml(cat) + '</div>';
                    byCategory[cat].forEach(function (id) {
                        html += _renderTemplateCardHTML(templates[id], id, cardConfig);
                    });
                });
                uncategorized.forEach(function (id) {
                    html += _renderTemplateCardHTML(templates[id], id, cardConfig);
                });
            } else {
                sortedIds.forEach(function (id) {
                    html += _renderTemplateCardHTML(templates[id], id, cardConfig);
                });
            }
        }

        html += '</div>';
    });

    html += '</div>';
    return html;
}

function _sortTemplateIds(ids, templates) {
    var arr = ids.slice();
    if (_sortBy === 'name') {
        arr.sort(function (a, b) {
            var na = (templates[a] && templates[a].name) || a;
            var nb = (templates[b] && templates[b].name) || b;
            return na.localeCompare(nb);
        });
    } else if (_sortBy === 'date') {
        arr.sort(function (a, b) {
            var da = (templates[a] && templates[a].createdAt) || '';
            var db = (templates[b] && templates[b].createdAt) || '';
            return db.localeCompare(da);
        });
    } else if (_sortBy === 'fields') {
        arr.sort(function (a, b) {
            var fa = (templates[a] ? ((templates[a].presetFields || []).length + (templates[a].customFieldRefs || []).length) : 0);
            var fb = (templates[b] ? ((templates[b].presetFields || []).length + (templates[b].customFieldRefs || []).length) : 0);
            return fb - fa;
        });
    }
    return arr;
}

function _getInUseTemplateIds(cardConfig) {
    if (!cardConfig || !cardConfig._templateConfig) return {};
    var cfg = cardConfig._templateConfig;
    var inUse = {};
    if (cfg.pc && cfg.pc._templateId) inUse[cfg.pc._templateId] = 'pc';
    if (cfg.npc && Array.isArray(cfg.npc)) {
        cfg.npc.forEach(function (n) { if (n._templateId) inUse[n._templateId] = 'npc'; });
    }
    if (cfg.faction) inUse[cfg.faction] = 'faction';
    if (cfg.quest && Array.isArray(cfg.quest)) {
        cfg.quest.forEach(function (q) { if (q) inUse[q] = 'quest'; });
    }
    return inUse;
}

/**
 * N7: Get the _state of the active dialogue template for a given global templateId.
 */
function _getDialogueTemplateState(cardConfig, templateId) {
    if (!cardConfig || !cardConfig._dialogueTemplates) return null;
    var activeKey = getActiveVersionKey(cardConfig._dialogueTemplates, templateId);
    if (!activeKey) return null;
    var dt = cardConfig._dialogueTemplates[activeKey];
    return dt ? (dt._state || 'synced') : null;
}

/**
 * N7: Get the active dialogue template key for a given global templateId.
 */
function _getActiveDialogueTemplateKey(cardConfig, templateId) {
    if (!cardConfig || !cardConfig._dialogueTemplates) return null;
    return getActiveVersionKey(cardConfig._dialogueTemplates, templateId);
}

// P4: Template card redesign
function _renderTemplateCardHTML(tpl, id, cardConfig) {
    if (!tpl) return '';
    var name = tpl.name || id;
    var desc = tpl.description || '';
    var presetCount = (tpl.presetFields && Array.isArray(tpl.presetFields)) ? tpl.presetFields.length : 0;
    var customCount = (tpl.customFieldRefs && Array.isArray(tpl.customFieldRefs)) ? tpl.customFieldRefs.length : 0;
    var role = tpl.role || 'npc';
    var source = tpl.source || (tpl.system ? 'system' : 'user_created');
    var sourceLabel = source === 'ai_generated' ? t('ai_generated') : (source === 'system' ? t('system_template') : t('user_created'));
    var sourceClass = source === 'ai_generated' ? 'src-ai' : (source === 'system' ? 'src-system' : 'src-user');
    var created = tpl.createdAt ? formatLocalTime(tpl.createdAt) : '';
    var locked = tpl._locked ? (' \u{1F512}') : '';
    var inUseMap = _getInUseTemplateIds(cardConfig);
    var inUse = inUseMap[id];
    var isSystem = !!tpl.system;

    var html = '<div class="ne-template-card" data-template-id="' + escapeHtml(id) + '">';
    html += '<div class="ne-template-card-header">';
    html += '<span><span class="ne-template-role-badge role-' + escapeHtml(role) + '">' + escapeHtml(t('role_' + role)) + '</span><b>' + escapeHtml(name) + '</b></span>';
    html += '<span class="ne-template-lock">' + locked + '</span>';
    html += '</div>';
    if (desc) {
        html += '<div class="ne-template-card-desc" data-toggle-desc>' + escapeHtml(desc) + '</div>';
    }
    html += '<div class="ne-template-card-meta">';
    html += '<span class="ne-template-field-chip">' + escapeHtml(presetCount) + ' ' + escapeHtml(t('preset_fields')) + '</span>';
    html += '<span class="ne-template-field-chip">' + escapeHtml(customCount) + ' ' + escapeHtml(t('custom_fields')) + '</span>';
    html += '<span class="ne-template-source-badge ' + sourceClass + '">' + escapeHtml(sourceLabel) + '</span>';
    if (created) html += '<span>' + escapeHtml(created) + '</span>';
    if (inUse) html += '<span class="ne-template-in-use">' + escapeHtml(t('in_use')) + '</span>';
    html += '</div>';
    html += '<div class="ne-template-card-actions">';
    html += '<button class="ne-btn-small ne-btn-edit" data-action="edit" data-template-id="' + escapeHtml(id) + '">' + escapeHtml(t('view_edit')) + '</button>';
    html += '<button class="ne-btn-small" data-action="duplicate" data-template-id="' + escapeHtml(id) + '">' + escapeHtml(t('duplicate')) + '</button>';
    if (!isSystem) {
        html += '<button class="ne-btn-small ne-btn-danger" data-action="delete" data-template-id="' + escapeHtml(id) + '">' + escapeHtml(t('Delete')) + '</button>';
    }
    html += '</div>';
    html += '</div>';
    return html;
}

// ─────────────────────────────────────
// Event hooks
// ─────────────────────────────────────

function _hookConfigEvents(container, cardConfig, templates, order) {
    // PC template select
    var pcSelect = container.querySelector('#ne-config-pc-template');
    if (pcSelect) {
        pcSelect.addEventListener('change', function () {
            _saveCardConfigChange(cardConfig, templates);
        });
    }

    // Remove NPC from pool
    var removeButtons = container.querySelectorAll('[data-remove-npc]');
    for (var i = 0; i < removeButtons.length; i++) {
        removeButtons[i].addEventListener('click', function () {
            var tplId = this.getAttribute('data-remove-npc');
            _removeNpcFromPool(tplId, cardConfig);
        });
    }

    // Lock/unlock NPC template
    var lockBtns = container.querySelectorAll('.ne-npc-lock-btn');
    for (var k = 0; k < lockBtns.length; k++) {
        lockBtns[k].addEventListener('click', function () {
            var tplId = this.getAttribute('data-lock-npc');
            var tplName = this.getAttribute('data-template-name') || tplId;
            var charName = _getCurrentCharName();
            if (!charName) return;
            var wasLocked = this.classList.contains('locked');
            var newLocked = !wasLocked;
            setDialogueTemplateLock(charName, tplId, newLocked);
            if (newLocked) {
                this.classList.add('locked');
                this.textContent = '\u{1F512}';
            } else {
                this.classList.remove('locked');
                this.textContent = '\u{1F513}';
            }
            showToast((newLocked ? t('locked') : t('unlock')) + ': ' + tplName, 'info', 2000);
        });
    }

    // Add NPC from library
    var addBtn = container.querySelector('#ne-config-add-npc');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            _showTemplateSelectorModal({
                title: t('select_npc_template'),
                templates: templates,
                role: 'npc',
                excludeIds: (cardConfig && cardConfig._templateConfig && cardConfig._templateConfig.npc) ?
                    cardConfig._templateConfig.npc.map(function (n) { return n._templateId; }) : [],
                onPick: function (tplId) {
                    _addNpcToPool(tplId, cardConfig, templates);
                }
            });
        });
    }

    // NPC Mode radio
    var modeRadios = container.querySelectorAll('input[name="ne-npc-mode"]');
    for (var j = 0; j < modeRadios.length; j++) {
        modeRadios[j].addEventListener('change', function () {
            if (!cardConfig) return;
            if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
            cardConfig._templateConfig._npcTemplateMode = this.value;
            var charName = _getCurrentCharName();
            if (charName) saveCardConfig(charName, cardConfig);
        });
    }

    // Faction template select
    var factionSelect = container.querySelector('#ne-config-faction-template');
    if (factionSelect) {
        factionSelect.addEventListener('change', function () {
            if (!cardConfig) return;
            if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
            cardConfig._templateConfig.faction = this.value;
            var charName = _getCurrentCharName();
            if (charName) saveCardConfig(charName, cardConfig);
        });
    }

    // Remove Quest from pool
    var removeQuestBtns = container.querySelectorAll('[data-remove-quest]');
    for (var q = 0; q < removeQuestBtns.length; q++) {
        removeQuestBtns[q].addEventListener('click', function () {
            var qid = this.getAttribute('data-remove-quest');
            _removeQuestFromPool(qid, cardConfig);
        });
    }

    // Add Quest from library
    var addQuestBtn = container.querySelector('#ne-config-add-quest');
    if (addQuestBtn) {
        addQuestBtn.addEventListener('click', function () {
            _showTemplateSelectorModal({
                title: t('select_quest_template'),
                templates: templates,
                role: 'quest',
                excludeIds: (cardConfig && cardConfig._templateConfig && cardConfig._templateConfig.quest) ?
                    cardConfig._templateConfig.quest.slice() : [],
                onPick: function (tplId) {
                    if (!cardConfig) return;
                    if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
                    var pool = cardConfig._templateConfig.quest || ['_default_quest'];
                    if (pool.indexOf(tplId) === -1) {
                        pool.push(tplId);
                        cardConfig._templateConfig.quest = pool;
                        var charName = _getCurrentCharName();
                        if (charName) saveCardConfig(charName, cardConfig);
                        _refreshCurrentPanel();
                    }
                }
            });
        });
    }

    // World context edit/clear (P7)
    var editBtn = container.querySelector('#ne-world-ctx-edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', function () {
            _worldCtxEditing = true;
            _refreshCurrentPanel();
        });
    }
    var clearBtn = container.querySelector('#ne-world-ctx-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            showConfirm(t('clear_world_context'), t('confirm_clear_world_context'), t('Delete'), t('Cancel'), true).then(function (confirmed) {
                if (confirmed && cardConfig) {
                    cardConfig._worldContext = null;
                    var charName = _getCurrentCharName();
                    if (charName) saveCardConfig(charName, cardConfig);
                    _refreshCurrentPanel();
                }
            });
        });
    }
    var wcSaveBtn = container.querySelector('#ne-world-ctx-save');
    if (wcSaveBtn) {
        wcSaveBtn.addEventListener('click', function () {
            var editArea = container.querySelector('#ne-world-ctx-edit');
            if (!editArea || !cardConfig) return;
            var text = editArea.value.trim();
            if (text) {
                cardConfig._worldContext = { summary: text, source: 'user_edit', _extractedAt: new Date().toISOString() };
            } else {
                cardConfig._worldContext = null;
            }
            var charName = _getCurrentCharName();
            if (charName) saveCardConfig(charName, cardConfig);
            _worldCtxEditing = false;
            _refreshCurrentPanel();
        });
    }
    var wcCancelBtn = container.querySelector('#ne-world-ctx-cancel');
    if (wcCancelBtn) {
        wcCancelBtn.addEventListener('click', function () {
            _worldCtxEditing = false;
            _refreshCurrentPanel();
        });
    }
}

function _hookLibraryEvents(container, templates, order, cardConfig) {
    // Create template
    var createBtn = container.querySelector('#ne-btn-create-template');
    if (createBtn) {
        createBtn.addEventListener('click', function () {
            _showEditor(container, null, true, templates, order);
        });
    }

    // Edit / Duplicate / Delete buttons
    var editBtns = container.querySelectorAll('[data-action="edit"]');
    for (var i = 0; i < editBtns.length; i++) {
        editBtns[i].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _showEditor(container, tplId, false, templates, order);
        });
    }
    var dupBtns = container.querySelectorAll('[data-action="duplicate"]');
    for (var d = 0; d < dupBtns.length; d++) {
        dupBtns[d].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _duplicateTemplate(tplId, templates, container);
        });
    }
    var delBtns = container.querySelectorAll('[data-action="delete"]');
    for (var j = 0; j < delBtns.length; j++) {
        delBtns[j].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _deleteTemplateConfirm(tplId, templates, order, container);
        });
    }

    // P3: Search input
    var searchInput = container.querySelector('#ne-template-search');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            _searchQuery = this.value.toLowerCase();
            _applySearchFilter(container, templates);
        });
    }

    // P3: Sort select
    var sortSelect = container.querySelector('#ne-template-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', function () {
            _sortBy = this.value;
            renderTemplatesIntoSlide(container);
        });
    }

    // P2: Role tab switching
    var roleTabs = container.querySelectorAll('[data-role-tab]');
    for (var rt = 0; rt < roleTabs.length; rt++) {
        roleTabs[rt].addEventListener('click', function () {
            var roleKey = this.getAttribute('data-role-tab');
            _activeRoleTab = roleKey;
            _activeTagFilter = null;
            renderTemplatesIntoSlide(container);
        });
    }

    // P3: Tag filter chips
    var tagChips = container.querySelectorAll('[data-tag-filter]');
    for (var tc = 0; tc < tagChips.length; tc++) {
        tagChips[tc].addEventListener('click', function () {
            _activeTagFilter = this.getAttribute('data-tag-filter') || null;
            renderTemplatesIntoSlide(container);
        });
    }

    // P4: Expandable description
    var descToggles = container.querySelectorAll('[data-toggle-desc]');
    for (var dt = 0; dt < descToggles.length; dt++) {
        descToggles[dt].addEventListener('click', function () {
            this.classList.toggle('expanded');
        });
    }
}

function _applySearchFilter(container, templates) {
    var cards = container.querySelectorAll('.ne-template-card');
    var anyVisible = false;
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var tplId = card.getAttribute('data-template-id');
        var tpl = templates[tplId];
        if (!tpl) continue;

        var matches = true;
        if (_searchQuery) {
            var name = (tpl.name || tplId).toLowerCase();
            var desc = (tpl.description || '').toLowerCase();
            var tags = (tpl.tags || []).join(' ').toLowerCase();
            matches = name.indexOf(_searchQuery) !== -1 || desc.indexOf(_searchQuery) !== -1 || tags.indexOf(_searchQuery) !== -1;
        }
        if (_activeTagFilter) {
            var tplTags = tpl.tags || [];
            matches = matches && tplTags.indexOf(_activeTagFilter) !== -1;
        }
        card.classList.toggle('ne-search-hidden', !matches);
        if (matches) anyVisible = true;
    }
    // Show/hide no-match message
    var noMatch = container.querySelector('.ne-search-no-match');
    if (!anyVisible && _searchQuery) {
        if (!noMatch) {
            var activeContent = container.querySelector('.ne-template-role-content.active');
            if (activeContent) {
                var msg = pdCreate('div');
                msg.className = 'ne-search-no-match';
                msg.textContent = t('none_available');
                activeContent.appendChild(msg);
            }
        }
    } else if (noMatch) {
        noMatch.remove();
    }
}

// ─────────────────────────────────────
// P5: Unified template selector modal
// ─────────────────────────────────────

function _showTemplateSelectorModal(opts) {
    var title = opts.title || '';
    var templates = opts.templates || {};
    var role = opts.role || 'npc';
    var excludeIds = opts.excludeIds || [];
    var onPick = opts.onPick;

    var available = Object.keys(templates).filter(function (id) {
        return templates[id] && templates[id].role === role && excludeIds.indexOf(id) === -1;
    });

    if (available.length === 0) {
        showToast(t('none_available'), 'info');
        return;
    }

    var html = '<div class="ne-modal-overlay" id="ne-template-selector-modal">';
    html += '<div class="ne-modal">';
    html += '<h3>' + escapeHtml(title) + '</h3>';
    html += '<div class="ne-modal-body">';
    available.forEach(function (id) {
        var tpl = templates[id];
        html += '<label class="ne-preset-field">' +
            '<input type="radio" name="ne-template-select" value="' + escapeHtml(id) + '"> ' +
            escapeHtml(tpl.name || id) +
            (tpl.description ? ' <span style="color:var(--grey-50);font-size:0.85em;">' + escapeHtml(tpl.description.substring(0, 60)) + '</span>' : '') +
            '</label>';
    });
    html += '</div>';
    html += '<div class="ne-modal-footer">';
    html += '<button id="ne-template-select-save" class="menu_button">' + escapeHtml(t('add')) + '</button>';
    html += '<button id="ne-template-select-cancel" class="menu_button">' + escapeHtml(t('Cancel')) + '</button>';
    html += '</div></div></div>';

    var overlay = pdCreate('div');
    overlay.innerHTML = html;
    var modalEl = overlay.firstElementChild;
    PD.body.appendChild(modalEl);

    // Show with animation
    requestAnimationFrame(function () { modalEl.classList.add('show'); });

    // Close handler
    function closeModal() {
        modalEl.classList.remove('show');
        setTimeout(function () { if (modalEl.parentNode) modalEl.parentNode.removeChild(modalEl); }, 200);
    }

    modalEl.querySelector('#ne-template-select-cancel').addEventListener('click', closeModal);
    modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeModal(); });

    modalEl.querySelector('#ne-template-select-save').addEventListener('click', function () {
        var selected = modalEl.querySelector('input[name="ne-template-select"]:checked');
        if (selected && onPick) {
            onPick(selected.value);
        }
        closeModal();
    });
}

// ─────────────────────────────────────
// Template Editor (P6 deferred to phase 3, basic version here)
// ─────────────────────────────────────

function _showEditor(container, templateId, isNew, templates, order) {
    var tpl = isNew
        ? { name: '', role: _activeRoleTab || 'npc', presetFields: [], customFieldRefs: [], tags: [], description: '', source: 'user_created' }
        : (templateId ? templates[templateId] : null);
    if (!tpl && !isNew) return;

    // N7: Load cardConfig for push/detach/version history
    var cardConfig = null;
    var charName = _getCurrentCharName();
    try { if (charName) cardConfig = loadCardConfigSync(charName); } catch (e) {}

    var html = '<div class="ne-template-editor" id="ne-template-editor">';
    html += '<button class="ne-btn-small" id="ne-editor-back">\u2190 ' + escapeHtml(t('back')) + '</button>';

    // Basic info
    html += '<div class="ne-editor-section">';
    html += '<label>' + escapeHtml(t('Name')) + '</label>';
    html += '<input type="text" id="ne-editor-name" class="ne-editor-input" value="' + escapeHtml(tpl.name || '') + '" placeholder="' + escapeHtml(t('Name')) + '">';
    html += '<label>' + escapeHtml(t('Role')) + '</label>';
    html += '<select id="ne-editor-role" class="ne-config-select">';
    html += '<option value="npc"' + (tpl.role === 'npc' || !tpl.role ? ' selected' : '') + '>' + escapeHtml(t('role_npc')) + '</option>';
    html += '<option value="pc"' + (tpl.role === 'pc' ? ' selected' : '') + '>' + escapeHtml(t('role_pc')) + '</option>';
    html += '<option value="faction"' + (tpl.role === 'faction' ? ' selected' : '') + '>' + escapeHtml(t('role_faction')) + '</option>';
    html += '<option value="quest"' + (tpl.role === 'quest' ? ' selected' : '') + '>' + escapeHtml(t('role_quest')) + '</option>';
    html += '</select>';
    html += '<label>' + escapeHtml(t('Description')) + '</label>';
    html += '<textarea id="ne-editor-desc" class="ne-editor-textarea" rows="2">' + escapeHtml(tpl.description || '') + '</textarea>';
    html += '</div>';

    // Preset fields
    html += '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('preset_fields')) + '</div>';
    var existingPresets = (tpl.presetFields && Array.isArray(tpl.presetFields)) ? tpl.presetFields : [];
    Object.keys(PRESET_FIELDS).forEach(function (cat) {
        html += '<div class="ne-preset-category">';
        html += '<div class="ne-npc-category-title">' + escapeHtml(cat) + '</div>';
        Object.keys(PRESET_FIELDS[cat]).forEach(function (fn) {
            var checked = existingPresets.indexOf(fn) !== -1;
            html += '<label class="ne-preset-field">' +
                '<input type="checkbox" class="ne-preset-checkbox" value="' + escapeHtml(fn) + '"' + (checked ? ' checked' : '') + '> ' +
                escapeHtml(t_field(fn)) + ' (' + escapeHtml(PRESET_FIELDS[cat][fn].type) + ')' +
                '</label>';
        });
        html += '</div>';
    });
    html += '</div>';

    // Custom fields
    html += '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('custom_fields')) + '</div>';
    var customFields = (tpl.customFieldRefs && Array.isArray(tpl.customFieldRefs)) ? tpl.customFieldRefs : [];
    html += '<div id="ne-editor-custom-fields">';
    customFields.forEach(function (fn) {
        html += '<div class="ne-custom-field-item">' +
            '<span>' + escapeHtml(fn) + '</span>' +
            '<button class="ne-btn-small ne-btn-danger" data-remove-custom="' + escapeHtml(fn) + '">\u2715</button>' +
            '</div>';
    });
    html += '</div>';
    html += '<div class="ne-custom-field-add">';
    html += '<input type="text" id="ne-editor-add-custom" class="ne-editor-input" placeholder="' + escapeHtml(t('add_custom_field')) + '">';
    html += '</div>';
    html += '</div>';

    html += '<div class="ne-editor-section" id="ne-editor-perround-section"' + ((tpl.role === 'faction' || tpl.role === 'quest') ? ' style="display:none"' : '') + '>';
    html += '<div class="ne-section-title">' + escapeHtml(t('per_round_fields')) + '</div>';
    html += '<div class="ne-preset-category">';
    var roundFieldCandidates = ['current_mood', 'inner_thoughts', 'affection', 'relationship', 'injuries', 'status_effects'];
    var existingPerRound = (tpl.perRoundFields && Array.isArray(tpl.perRoundFields)) ? tpl.perRoundFields : [];
    roundFieldCandidates.forEach(function (fn) {
        var checked = existingPerRound.indexOf(fn) !== -1;
        html += '<label class="ne-preset-field">' +
            '<input type="checkbox" class="ne-perround-checkbox" value="' + escapeHtml(fn) + '"' + (checked ? ' checked' : '') + '> ' +
            escapeHtml(t_field(fn)) +
            '</label>';
    });
    html += '</div></div>';

    // Tags
    html += '<div class="ne-editor-section">';
    html += '<label>' + escapeHtml(t('Tags')) + '</label>';
    var tags = (tpl.tags && Array.isArray(tpl.tags)) ? tpl.tags.join(', ') : '';
    html += '<input type="text" id="ne-editor-tags" class="ne-editor-input" value="' + escapeHtml(tags) + '" placeholder="tag1, tag2">';
    html += '</div>';

    // Version history
    if (!isNew && tpl.versions && tpl.versions.length > 0) {
        html += _renderVersionHistoryHTML(tpl);
    }

    // Lock toggle
    var isLocked = !!(tpl._locked);
    html += '<div class="ne-editor-section">';
    html += '<label class="ne-lock-toggle">' +
        '<input type="checkbox" id="ne-editor-lock"' + (isLocked ? ' checked' : '') + '> ' +
        escapeHtml(t('lock_template')) +
        '</label>';
    html += '</div>';

    // N7: Push to global / Detach buttons (only when editing existing, not new)
    if (!isNew && cardConfig && cardConfig._dialogueTemplates) {
        var activeDtKey = _getActiveDialogueTemplateKey(cardConfig, templateId);
        if (activeDtKey) {
            var dtState = _getDialogueTemplateState(cardConfig, templateId);
            if (dtState === 'forked' || dtState === 'orphaned') {
                html += '<div class="ne-editor-section">';
                html += '<button id="ne-editor-push-global" class="ne-btn-small" data-dt-key="' + escapeHtml(activeDtKey) + '">' + escapeHtml(t('push_to_global')) + '</button>';
                if (dtState !== 'orphaned') {
                    html += ' <button id="ne-editor-detach" class="ne-btn-small ne-btn-danger" data-dt-key="' + escapeHtml(activeDtKey) + '">' + escapeHtml(t('detach_template')) + '</button>';
                }
                html += '</div>';
            }
        }
    }

    // Actions
    html += '<div class="ne-editor-actions">';
    html += '<button id="ne-editor-save" class="menu_button">' + escapeHtml(t('Save')) + '</button>';
    html += '<button id="ne-editor-cancel" class="menu_button">' + escapeHtml(t('Cancel')) + '</button>';
    html += '</div>';

    html += '</div>';

    container.innerHTML = html;

    // Bind editor events
    var backBtn = container.querySelector('#ne-editor-back');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            _activeTopTab = 'library';
            renderTemplatesIntoSlide(container);
        });
    }

    var cancelBtn = container.querySelector('#ne-editor-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            _activeTopTab = 'library';
            renderTemplatesIntoSlide(container);
        });
    }

    var saveBtn = container.querySelector('#ne-editor-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            _saveTemplateFromEditor(container, templateId, isNew, templates, order);
        });
    }

    // Add custom field
    var addCustomInput = container.querySelector('#ne-editor-add-custom');
    if (addCustomInput) {
        addCustomInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                _addCustomFieldToEditor(container);
            }
        });
    }

    // Remove custom field
    var removeCustomBtns = container.querySelectorAll('[data-remove-custom]');
    for (var r = 0; r < removeCustomBtns.length; r++) {
        removeCustomBtns[r].addEventListener('click', function () {
            var fn = this.getAttribute('data-remove-custom');
            _removeCustomFieldFromEditor(container, fn);
        });
    }

    // Role change: toggle perRoundFields section
    var roleSelect = container.querySelector('#ne-editor-role');
    if (roleSelect) {
        roleSelect.addEventListener('change', function() {
            var perRoundSection = container.querySelector('#ne-editor-perround-section');
            if (perRoundSection) {
                if (this.value === 'faction' || this.value === 'quest') {
                    perRoundSection.style.display = 'none';
                } else {
                    perRoundSection.style.display = '';
                }
            }
        });
    }

    // N3: Rollback button binding
    var rollbackBtns = container.querySelectorAll('[data-rollback-version]');
    for (var rb = 0; rb < rollbackBtns.length; rb++) {
        rollbackBtns[rb].addEventListener('click', function () {
            var versionKey = this.getAttribute('data-rollback-version');
            var charName = _getCurrentCharName();
            if (!charName || !versionKey) return;
            showConfirm(t('rollback_to_version'), t('confirm_rollback'), t('rollback_to_version'), t('Cancel'), false).then(function (confirmed) {
                if (!confirmed) return;
                restoreTemplateVersion(charName, versionKey);
                showToast(t('rollback_to_version') + ': OK', 'success', 3000);
                _activeTopTab = 'library';
                renderTemplatesIntoSlide(container);
            });
        });
    }

    // N7: Push to global library button
    var pushBtn = container.querySelector('#ne-editor-push-global');
    if (pushBtn) {
        pushBtn.addEventListener('click', function () {
            var dtKey = this.getAttribute('data-dt-key');
            var charName = _getCurrentCharName();
            if (!charName || !dtKey) return;
            showConfirm(t('push_to_global'), t('confirm_push_to_global'), t('Save'), t('Cancel'), false).then(function (confirmed) {
                if (!confirmed) return;
                var newId = pushTemplateToGlobal(charName, dtKey);
                if (newId) {
                    showToast(t('template_saved'), 'success', 3000);
                    _activeTopTab = 'library';
                    renderTemplatesIntoSlide(container);
                } else {
                    showToast(t('Save') + ': ERROR', 'error', 3000);
                }
            });
        });
    }

    // N7: Detach from global button
    var detachBtn = container.querySelector('#ne-editor-detach');
    if (detachBtn) {
        detachBtn.addEventListener('click', function () {
            var dtKey = this.getAttribute('data-dt-key');
            var charName = _getCurrentCharName();
            if (!charName || !dtKey) return;
            showConfirm(t('detach_template'), t('confirm_detach'), t('Delete'), t('Cancel'), true).then(function (confirmed) {
                if (!confirmed) return;
                var config = loadCardConfigSync(charName);
                if (config && config._dialogueTemplates && config._dialogueTemplates[dtKey]) {
                    config._dialogueTemplates[dtKey]._state = 'orphaned';
                    saveCardConfig(charName, config);
                    showToast(t('detach_template') + ': OK', 'info', 3000);
                    _activeTopTab = 'library';
                    renderTemplatesIntoSlide(container);
                }
            });
        });
    }
}

function _renderVersionHistoryHTML(tpl) {
    // N3: Read versions from cardConfig._dialogueTemplates (card-level), not from global template
    var cardConfig = null;
    var charName = _getCurrentCharName();
    try { if (charName) cardConfig = loadCardConfigSync(charName); } catch (e) {}
    if (!cardConfig || !cardConfig._dialogueTemplates) return '';

    // Find all versions for this template
    var versions = [];
    Object.keys(cardConfig._dialogueTemplates).forEach(function (k) {
        var dt = cardConfig._dialogueTemplates[k];
        if (dt._templateId === tpl.id) {
            versions.push({ key: k, tpl: dt });
        }
    });
    if (versions.length === 0) return '';

    // Sort by createdAt descending
    versions.sort(function (a, b) { return new Date(b.tpl.createdAt) - new Date(a.tpl.createdAt); });

    var html = '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('version_history')) + '</div>';
    html += '<div class="ne-version-timeline">';
    versions.forEach(function (ver) {
        var isActive = !!ver.tpl._active;
        var date = ver.tpl.createdAt ? formatLocalTime(ver.tpl.createdAt) : '';
        var dotClass = isActive ? 'ne-version-dot active' : 'ne-version-dot';
        var verSource = ver.tpl.source || 'user_created';
        var verSourceLabel = verSource === 'ai_generated' ? t('ai_generated') : (verSource === 'user_rollback' ? t('rollback') : t('user_created'));
        var verSourceClass = verSource === 'ai_generated' ? 'src-ai' : 'src-user';
        var stateLabel = ver.tpl._state ? ver.tpl._state : '';
        html += '<div class="ne-version-item">';
        html += '<span class="' + dotClass + '"></span>';
        html += '<div class="ne-version-info">';
        html += '<span class="ne-version-date">' + escapeHtml(date) + '</span>';
        if (isActive) html += ' <span class="ne-version-badge">(' + escapeHtml(t('current')) + ')</span>';
        html += ' <span class="ne-template-source-badge ' + verSourceClass + '" style="font-size:0.7em;">' + escapeHtml(verSourceLabel) + '</span>';
        if (stateLabel && stateLabel !== 'synced') {
            html += ' <span class="ne-template-source-badge src-user" style="font-size:0.7em;">' + escapeHtml(stateLabel) + '</span>';
        }
        // N3: Rollback button for non-active versions
        if (!isActive) {
            html += ' <button class="ne-btn-small" data-rollback-version="' + escapeHtml(ver.key) + '" style="font-size:0.75em;">' + escapeHtml(t('rollback_to_version')) + '</button>';
        }
        var presetCount = (ver.tpl.presetFields || []).length;
        var customCount = (ver.tpl.customFieldRefs || []).length;
        html += '<div class="ne-version-diff">' + escapeHtml(presetCount) + ' ' + escapeHtml(t('preset_fields')) + ', ' + escapeHtml(customCount) + ' ' + escapeHtml(t('custom_fields')) + '</div>';
        html += '</div></div>';
    });
    html += '</div></div>';
    return html;
}

function _saveTemplateFromEditor(container, templateId, isNew, templates, order) {
    var nameEl = container.querySelector('#ne-editor-name');
    var roleEl = container.querySelector('#ne-editor-role');
    var descEl = container.querySelector('#ne-editor-desc');
    var tagsEl = container.querySelector('#ne-editor-tags');
    var lockEl = container.querySelector('#ne-editor-lock');

    if (!nameEl || !nameEl.value.trim()) {
        showToast(t('name_required'), 'warn');
        return;
    }

    var presetFields = [];
    var checkboxes = container.querySelectorAll('.ne-preset-checkbox:checked');
    for (var c = 0; c < checkboxes.length; c++) {
        presetFields.push(checkboxes[c].value);
    }

    var customFieldRefs = [];
    var customItems = container.querySelectorAll('.ne-custom-field-item span');
    for (var i = 0; i < customItems.length; i++) {
        customFieldRefs.push(customItems[i].textContent);
    }

    var tags = tagsEl ? tagsEl.value.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
    var isLocked = lockEl ? lockEl.checked : false;

    var perRoundFields = [];
    var perRoundCheckboxes = container.querySelectorAll('.ne-perround-checkbox:checked');
    for (var pr = 0; pr < perRoundCheckboxes.length; pr++) {
        perRoundFields.push(perRoundCheckboxes[pr].value);
    }
    var roleVal = roleEl ? roleEl.value : 'npc';

    var template = {
        id: isNew ? ('tpl_' + Date.now()) : templateId,
        name: nameEl.value.trim(),
        role: roleVal,
        description: descEl ? descEl.value.trim() : '',
        presetFields: presetFields,
        customFieldRefs: customFieldRefs,
        perRoundFields: (roleVal === 'pc' || roleVal === 'npc') ? perRoundFields : undefined,
        tags: tags,
        _locked: isLocked,
        source: 'user_created',
        createdAt: isNew ? new Date().toISOString() : (templates[templateId] ? templates[templateId].createdAt : new Date().toISOString()),
        updatedAt: new Date().toISOString()
    };

    saveTemplate(template);
    showToast(t('template_saved'), 'success', 3000);
    _activeTopTab = 'library';
    renderTemplatesIntoSlide(container);
}

function _addCustomFieldToEditor(container) {
    var input = container.querySelector('#ne-editor-add-custom');
    if (!input || !input.value.trim()) return;
    var fieldName = input.value.trim();
    // P6: conflict check with predefined fields
    if (ALL_PREDEFINED_FIELDS && ALL_PREDEFINED_FIELDS[fieldName]) {
        showToast(t('custom_field_conflict'), 'warn');
        return;
    }
    var listEl = container.querySelector('#ne-editor-custom-fields');
    if (!listEl) return;
    var existing = listEl.querySelectorAll('.ne-custom-field-item span');
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].textContent === fieldName) return;
    }
    var item = pdCreate('div');
    item.className = 'ne-custom-field-item';
    item.innerHTML = '<span>' + escapeHtml(fieldName) + '</span>' +
        '<button class="ne-btn-small ne-btn-danger" data-remove-custom="' + escapeHtml(fieldName) + '">\u2715</button>';
    item.querySelector('[data-remove-custom]').addEventListener('click', function() {
        item.remove();
    });
    listEl.appendChild(item);
    input.value = '';
}

function _removeCustomFieldFromEditor(container, fieldName) {
    var items = container.querySelectorAll('.ne-custom-field-item');
    for (var i = 0; i < items.length; i++) {
        var span = items[i].querySelector('span');
        if (span && span.textContent === fieldName) {
            items[i].remove();
            return;
        }
    }
}

// ─────────────────────────────────────
// Actions
// ─────────────────────────────────────

function _deleteTemplateConfirm(templateId, templates, order, container) {
    showConfirm(
        t('Confirm'),
        t('Delete this entry? This cannot be undone.'),
        t('Delete'), t('Cancel'), true
    ).then(function(confirmed) {
        if (confirmed) {
            deleteTemplate(templateId);
            showToast(t('template_deleted'), 'info', 3000);
            renderTemplatesIntoSlide(container || panelById('ne-slide-panel-content'));
        }
    });
}

function _duplicateTemplate(templateId, templates, container) {
    var tpl = templates[templateId];
    if (!tpl) return;
    showConfirm(t('duplicate'), t('confirm_duplicate'), t('duplicate'), t('Cancel'), false).then(function(confirmed) {
        if (!confirmed) return;
        var newId = 'tpl_' + Date.now();
        var newTpl = JSON.parse(JSON.stringify(tpl));
        newTpl.id = newId;
        newTpl.name = (tpl.name || templateId) + ' ' + t('duplicated_suffix');
        newTpl.source = 'user_created';
        newTpl._locked = false;
        newTpl.system = false;
        newTpl.createdAt = new Date().toISOString();
        newTpl.updatedAt = new Date().toISOString();
        delete newTpl.versions;
        delete newTpl._activeVersion;
        saveTemplate(newTpl);
        showToast(t('template_saved'), 'success', 3000);
        renderTemplatesIntoSlide(container || panelById('ne-slide-panel-content'));
    });
}

function _saveCardConfigChange(cardConfig, templates) {
    if (!cardConfig) return;
    var charName = _getCurrentCharName();
    if (!charName) return;

    var pcSelect = panelById('ne-config-pc-template');
    if (!pcSelect) return;

    if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
    var selectedId = pcSelect.value;
    if (selectedId) {
        var tpl = templates[selectedId];
        cardConfig._templateConfig.pc = {
            _templateId: selectedId,
            name: tpl ? tpl.name : '',
            role: 'protagonist'
        };
    } else {
        delete cardConfig._templateConfig.pc;
    }

    saveCardConfig(charName, cardConfig);
    showToast(t('Settings saved.'), 'success', 2000);
}

function _removeNpcFromPool(npcId, cardConfig) {
    if (!cardConfig || !cardConfig._templateConfig) return;
    var pool = cardConfig._templateConfig.npc || ['_default_npc'];
    var idx = pool.indexOf(npcId);
    if (idx === -1) {
        // Try by _templateId
        for (var i = 0; i < pool.length; i++) {
            if (pool[i] && pool[i]._templateId === npcId) { idx = i; break; }
        }
    }
    if (idx === -1) return;
    if (pool.length <= 1) {
        console.log('[NE-Templates] Cannot remove last NPC template from pool');
        return;
    }
    pool.splice(idx, 1);
    cardConfig._templateConfig.npc = pool;
    var charName = _getCurrentCharName();
    if (charName) {
        saveCardConfig(charName, cardConfig);
        _refreshCurrentPanel();
    }
}

function _removeQuestFromPool(questId, cardConfig) {
    if (!cardConfig || !cardConfig._templateConfig) return;
    var pool = cardConfig._templateConfig.quest || ['_default_quest'];
    var idx = pool.indexOf(questId);
    if (idx === -1) return;
    if (pool.length <= 1) {
        console.log('[NE-Templates] Cannot remove last Quest template from pool');
        return;
    }
    pool.splice(idx, 1);
    cardConfig._templateConfig.quest = pool;
    var charName = _getCurrentCharName();
    if (charName) {
        saveCardConfig(charName, cardConfig);
        _refreshCurrentPanel();
    }
}

function _addNpcToPool(templateId, cardConfig, templates) {
    if (!cardConfig) return;
    if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
    if (!cardConfig._templateConfig.npc) cardConfig._templateConfig.npc = [];
    for (var i = 0; i < cardConfig._templateConfig.npc.length; i++) {
        if (cardConfig._templateConfig.npc[i]._templateId === templateId) return;
    }
    var tpl = templates[templateId];
    cardConfig._templateConfig.npc.push({
        _templateId: templateId,
        name: tpl ? tpl.name : '',
        role: 'npc'
    });
    var charName = _getCurrentCharName();
    if (charName) saveCardConfig(charName, cardConfig);
    _refreshCurrentPanel();
}

function _refreshCurrentPanel() {
    var container = panelById('ne-slide-panel-content');
    if (container) renderTemplatesIntoSlide(container);
}
