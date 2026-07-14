/**
 * panel-templates.js - Template Library Slide-in Panel
 *
 * Renders into the slide-in panel (📋 pin row icon):
 *   Unified dual-zone view:
 *     TOP: Global template library (cards grouped by role in accordions)
 *     BOTTOM: Current dialogue config (cards showing what's in use + template mode + world context)
 *   Sub-view: Template editor / detail view (with version history)
 */

import { loadTemplateLibrary, saveTemplateLibrary, saveTemplate, deleteTemplate, getTemplate, getEffectiveTemplates,
  loadCardConfig, saveCardConfig, loadCardConfigSync, setDialogueTemplateLock, isDialogueTemplateLocked,
  editTemplateInCard, forkTemplateInCard, pushTemplateToGlobal, restoreTemplateVersion, getActiveVersionKey, cloneTemplateToCard } from '../core/vault/store.js';
import { PRESET_FIELDS, ALL_PREDEFINED_FIELDS, buildCharacterSchemaFromTemplates, DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE, DEFAULT_FACTION_TEMPLATE, DEFAULT_QUEST_TEMPLATE, ROLE_CATEGORY_MAP, getPresetFieldsForRole } from '../core/vault/schema.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { PD, pdCreate, panelById, t, showToast, showConfirm, busEmit, openSlidePanel, closeSlidePanel } from './panel-shared.js';

// ── Slide-in root state ──
var _lastRenderTick = 0;
var _renderTicket = 0;
var _searchQuery = '';
var _activeTagFilter = null;
var _sortBy = 'default';      // 'default' | 'name' | 'date' | 'fields'
var _worldCtxEditing = false;
var _libAccordionState = { pc: true, npc: true, faction: false, quest: false };
var _cfgAccordionState = { pc: true, npc: true, faction: false, quest: false };

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
 * Renders a unified dual-zone view:
 *   TOP half: Global template library (cards grouped by role in accordions)
 *   BOTTOM half: Current dialogue config (cards showing what's in use + template mode + world context)
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
    // Mobile zone switcher
    html += '<div class="ne-mobile-zone-switch">';
    html += '<div class="ne-mobile-zone-tab active" data-mobile-zone="library">' + escapeHtml(t('global_library')) + '</div>';
    html += '<div class="ne-mobile-zone-tab" data-mobile-zone="config">' + escapeHtml(t('current_dialogue_config')) + '</div>';
    html += '</div>';

    html += '<div class="ne-unified-view">';
    // Top: Global library
    html += '<div class="ne-unified-section ne-mobile-active" id="ne-unified-library">';
    html += '<div class="ne-unified-section-title">' + escapeHtml(t('global_library')) + '</div>';
    html += _renderGlobalLibraryHTML(templates, order, cardConfig);
    html += '</div>';
    html += '<div class="ne-unified-divider"></div>';
    // Bottom: Dialogue config
    html += '<div class="ne-unified-section" id="ne-unified-config">';
    html += '<div class="ne-unified-section-title">' + escapeHtml(t('current_dialogue_config')) + '</div>';
    html += _renderDialogueConfigHTML(cardConfig, templates, order);
    html += '</div>';
    html += '</div>';

    container.innerHTML = html;
    // Set container flex styles for dual-zone layout
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100%';
    container.style.overflow = 'hidden';

    _hookUnifiedEvents(container, templates, order, cardConfig);
    _lastRenderTick = Date.now();
}

// ─────────────────────────────────────
// Dialogue config panel (bottom half)
// ─────────────────────────────────────

function _renderDialogueConfigHTML(cardConfig, templates, order) {
    var cfg = cardConfig && cardConfig._templateConfig ? cardConfig._templateConfig : {};
    var pcTemplate = cfg.pc || null;
    var npcPool = (cfg.npc && Array.isArray(cfg.npc)) ? cfg.npc : [];
    var factionId = cfg.faction || '_default_faction';
    var questPool = (cfg.quest && Array.isArray(cfg.quest)) ? cfg.quest : ['_default_quest'];
    var templateMode = cfg._templateMode || cfg._npcTemplateMode || 'smart';
    var worldCtx = (cardConfig && cardConfig._worldContext) ? cardConfig._worldContext : null;
    var hasChar = !!_getCurrentCharName();

    if (!hasChar) {
        return '<div class="ne-template-config" id="ne-template-config">' +
            '<div class="ne-empty-state"><div class="ne-empty-state-icon">📋</div>' +
            '<div class="ne-empty-state-text">' + escapeHtml(t('no_current_char')) + '</div></div></div>';
    }

    var html = '<div class="ne-template-config" id="ne-template-config">';

    // Template mode radios
    html += '<div class="ne-config-field ne-template-mode-field">';
    html += '<label>' + escapeHtml(t('template_mode')) + '</label>';
    html += '<label class="ne-radio-label"><input type="radio" name="ne-template-mode" value="fast"' + (templateMode === 'fast' ? ' checked' : '') + '> ' + escapeHtml(t('fast_mode')) + '</label>';
    html += '<label class="ne-radio-label"><input type="radio" name="ne-template-mode" value="smart"' + (templateMode === 'smart' ? ' checked' : '') + '> ' + escapeHtml(t('smart_adjust')) + '</label>';
    html += '</div>';
    // Mode hint
    html += '<div class="ne-template-mode-hint">' + escapeHtml(templateMode === 'fast' ? t('fast_mode_hint') : t('smart_mode_hint')) + '</div>';

    // Role accordions
    var roles = [
        { key: 'pc', label: t('role_pc') },
        { key: 'npc', label: t('role_npc') },
        { key: 'faction', label: t('role_faction') },
        { key: 'quest', label: t('role_quest') }
    ];

    roles.forEach(function (r) {
        var expanded = _cfgAccordionState[r.key];
        var count = 0;
        var cardsHtml = '';

        if (r.key === 'pc') {
            if (pcTemplate && pcTemplate._templateId) {
                var pcTpl = templates[pcTemplate._templateId];
                if (pcTpl) {
                    cardsHtml = _renderConfigCardHTML(pcTpl, pcTemplate._templateId, cardConfig, 'pc');
                    count = 1;
                }
            }
        } else if (r.key === 'npc') {
            npcPool.forEach(function (entry) {
                var tpl = templates[entry._templateId];
                if (tpl) {
                    cardsHtml += _renderConfigCardHTML(tpl, entry._templateId, cardConfig, 'npc');
                    count++;
                }
            });
        } else if (r.key === 'faction') {
            if (factionId && factionId !== '_default_faction') {
                var facTpl = templates[factionId];
                if (facTpl) {
                    cardsHtml = _renderConfigCardHTML(facTpl, factionId, cardConfig, 'faction');
                    count = 1;
                }
            }
        } else if (r.key === 'quest') {
            questPool.forEach(function (qid) {
                if (qid && qid !== '_default_quest') {
                    var qTpl = templates[qid];
                    if (qTpl) {
                        cardsHtml += _renderConfigCardHTML(qTpl, qid, cardConfig, 'quest');
                        count++;
                    }
                }
            });
        }

        // Empty slot for single-select roles
        if (count === 0 && (r.key === 'pc' || r.key === 'faction')) {
            cardsHtml = '<div class="ne-config-empty-slot">' +
                '<span class="ne-config-empty-text">' + escapeHtml(r.key === 'pc' ? t('no_pc_template') : t('no_faction_template')) + '</span>' +
                '<button class="ne-btn-small" data-action="go-to-library" data-role-type="' + r.key + '">' + escapeHtml(t('go_to_library')) + '</button>' +
                '</div>';
        }
        // Empty placeholder for multi-select roles
        if (count === 0 && (r.key === 'npc' || r.key === 'quest')) {
            cardsHtml = '<div class="ne-config-empty-slot ne-config-empty-dashed">' +
                '<span class="ne-config-empty-text">' + escapeHtml(t('no_templates')) + '</span>' +
                '<button class="ne-btn-small" data-action="go-to-library" data-role-type="' + r.key + '">' + escapeHtml(t('go_to_library')) + '</button>' +
                '</div>';
        }

        html += '<div class="ne-accordion">';
        html += '<div class="ne-accordion-header" data-cfg-accordion="' + r.key + '">';
        html += '<span>' + escapeHtml(r.label) + '</span>';
        html += '<span class="ne-role-accordion-count">(' + count + ')</span>';
        html += '</div>';
        html += '<div class="ne-accordion-body" style="display:' + (expanded ? 'block' : 'none') + ';">';
        html += cardsHtml;
        html += '</div>';
        html += '</div>';
    });

    // World Context (editable)
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
// Global library view (top half: accordions by role)
// ─────────────────────────────────────

function _renderGlobalLibraryHTML(templates, order, cardConfig) {
    var html = '<div class="ne-template-library" id="ne-template-library">';

    // If library is completely empty
    if (!order || order.length === 0) {
        html += '<div class="ne-empty-state"><div class="ne-empty-state-icon">📝</div>';
        html += '<div class="ne-empty-state-text">' + escapeHtml(t('no_templates_yet')) + '</div>';
        html += '<button class="ne-btn-small" data-action="create-first">+ ' + escapeHtml(t('create_first_template')) + '</button>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    // Toolbar (search + sort + create)
    html += '<div class="ne-template-toolbar">';
    html += '<input type="text" id="ne-template-search" placeholder="' + escapeHtml(t('search_templates')) + '" value="' + escapeHtml(_searchQuery) + '">';
    html += '<select id="ne-template-sort">';
    html += '<option value="default"' + (_sortBy === 'default' ? ' selected' : '') + '>' + escapeHtml(t('sort_by')) + '</option>';
    html += '<option value="name"' + (_sortBy === 'name' ? ' selected' : '') + '>' + escapeHtml(t('sort_name')) + '</option>';
    html += '<option value="date"' + (_sortBy === 'date' ? ' selected' : '') + '>' + escapeHtml(t('sort_date')) + '</option>';
    html += '<option value="fields"' + (_sortBy === 'fields' ? ' selected' : '') + '>' + escapeHtml(t('sort_fields')) + '</option>';
    html += '</select>';
    html += '<button id="ne-btn-create-template" class="ne-btn-small" data-action="create-first">+ ' + escapeHtml(t('create_template')) + '</button>';
    html += '</div>';

    // Group templates by role
    var roles = [
        { key: 'pc', label: t('role_pc') },
        { key: 'npc', label: t('role_npc') },
        { key: 'faction', label: t('role_faction') },
        { key: 'quest', label: t('role_quest') }
    ];
    var byRole = { pc: [], npc: [], faction: [], quest: [] };
    order.forEach(function (id) {
        var tpl = templates[id];
        if (!tpl) return;
        var role = (tpl.role === 'pc' || tpl.role === 'npc' || tpl.role === 'faction' || tpl.role === 'quest') ? tpl.role : 'npc';
        byRole[role].push(id);
    });

    // Render each role as accordion
    roles.forEach(function (r) {
        var roleIds = byRole[r.key];
        var expanded = _libAccordionState[r.key];

        html += '<div class="ne-accordion">';
        html += '<div class="ne-accordion-header" data-lib-accordion="' + r.key + '">';
        html += '<span>' + escapeHtml(r.label) + '</span>';
        html += '<span class="ne-role-accordion-count">(' + roleIds.length + ')</span>';
        html += '</div>';
        html += '<div class="ne-accordion-body" style="display:' + (expanded ? 'block' : 'none') + ';">';

        if (roleIds.length === 0) {
            html += '<div class="ne-empty-state"><div class="ne-empty-state-icon">📝</div>' +
                '<div class="ne-empty-state-text">' + escapeHtml(t('no_templates')) + '</div></div>';
        } else {
            // Tag filter chips
            var allTags = {};
            roleIds.forEach(function (id) {
                var tpl = templates[id];
                if (tpl && tpl.tags) {
                    tpl.tags.forEach(function (tag) { allTags[tag] = true; });
                }
            });
            var tagKeys = Object.keys(allTags);
            if (tagKeys.length > 0) {
                html += '<div class="ne-tag-chips">';
                html += '<span class="ne-tag-chip' + (!_activeTagFilter ? ' active' : '') + '" data-tag-filter="">' + escapeHtml(t('all_tags')) + '</span>';
                tagKeys.forEach(function (tag) {
                    html += '<span class="ne-tag-chip' + (_activeTagFilter === tag ? ' active' : '') + '" data-tag-filter="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</span>';
                });
                html += '</div>';
            }

            html += '<div class="ne-library-card-grid">';
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
                        html += _renderTemplateCardHTML(templates[id], id, cardConfig, 'library');
                    });
                });
                uncategorized.forEach(function (id) {
                    html += _renderTemplateCardHTML(templates[id], id, cardConfig, 'library');
                });
            } else {
                sortedIds.forEach(function (id) {
                    html += _renderTemplateCardHTML(templates[id], id, cardConfig, 'library');
                });
            }
            html += '</div>';
        }

        html += '</div>'; // accordion-body
        html += '</div>'; // accordion
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
function _renderTemplateCardHTML(tpl, id, cardConfig, mode) {
    if (!tpl) return '';
    mode = mode || 'library';
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
    var isSingleSelect = (role === 'pc' || role === 'faction');
    var alreadyInConfig = !!inUse;

    var html = '<div class="ne-template-card" data-template-id="' + escapeHtml(id) + '" data-role-type="' + escapeHtml(role) + '">';
    html += '<div class="ne-template-card-header" data-action="toggle-desc">';
    html += '<span><span class="ne-template-role-badge role-' + escapeHtml(role) + '">' + escapeHtml(t('role_' + role)) + '</span><b>' + escapeHtml(name) + '</b></span>';
    html += '<span class="ne-template-lock">' + locked + '</span>';
    html += '</div>';
    if (desc) {
        html += '<div class="ne-template-card-desc">' + escapeHtml(desc) + '</div>';
    }
    html += '<div class="ne-template-card-meta">';
    html += '<span class="ne-template-field-chip">' + escapeHtml(presetCount) + ' ' + escapeHtml(t('preset_fields')) + '</span>';
    html += '<span class="ne-template-field-chip">' + escapeHtml(customCount) + ' ' + escapeHtml(t('custom_fields')) + '</span>';
    html += '<span class="ne-template-source-badge ' + sourceClass + '">' + escapeHtml(sourceLabel) + '</span>';
    if (created) html += '<span>' + escapeHtml(created) + '</span>';
    if (inUse) html += '<span class="ne-template-in-use">' + escapeHtml(t('in_use')) + '</span>';
    html += '</div>';

    // Fields preview (hidden by default, shown when card is expanded)
    var allFields = [];
    if (tpl.presetFields && Array.isArray(tpl.presetFields)) {
        allFields = allFields.concat(tpl.presetFields);
    }
    if (tpl.customFieldRefs && Array.isArray(tpl.customFieldRefs)) {
        allFields = allFields.concat(tpl.customFieldRefs);
    }
    if (allFields.length > 0) {
        html += '<div class="ne-template-card-fields-preview" style="display:none;">';
        allFields.forEach(function (fn) {
            html += '<span class="ne-template-field-chip">' + escapeHtml(fn) + '</span>';
        });
        html += '</div>';
    }

    html += '<div class="ne-template-card-actions">';
    // Library mode: add-to-dialogue / set-as-active button
    if (mode === 'library') {
        if (alreadyInConfig) {
            // Already in config - show badge, no action button
            html += '<span class="ne-template-in-use-badge">' + escapeHtml(isSingleSelect ? t('current_active') : t('already_added')) + ' \u2713</span>';
        } else {
            if (isSingleSelect) {
                html += '<button class="ne-btn-small ne-btn-add" data-action="add-to-dialogue" data-template-id="' + escapeHtml(id) + '" data-role-type="' + escapeHtml(role) + '">' + escapeHtml(t('set_as_active')) + '</button>';
            } else {
                html += '<button class="ne-btn-small ne-btn-add" data-action="add-to-dialogue" data-template-id="' + escapeHtml(id) + '" data-role-type="' + escapeHtml(role) + '">' + escapeHtml(t('add_to_dialogue')) + '</button>';
            }
        }
    }
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
// Config card (bottom half)
// ─────────────────────────────────────

function _renderConfigCardHTML(tpl, id, cardConfig, roleType) {
    if (!tpl) return '';
    var name = tpl.name || id;
    var desc = tpl.description || '';
    var presetCount = (tpl.presetFields && Array.isArray(tpl.presetFields)) ? tpl.presetFields.length : 0;
    var customCount = (tpl.customFieldRefs && Array.isArray(tpl.customFieldRefs)) ? tpl.customFieldRefs.length : 0;
    var source = tpl.source || (tpl.system ? 'system' : 'user_created');
    var sourceLabel = source === 'ai_generated' ? t('ai_generated') : (source === 'system' ? t('system_template') : t('user_created'));
    var sourceClass = source === 'ai_generated' ? 'src-ai' : (source === 'system' ? 'src-system' : 'src-user');
    var dtState = _getDialogueTemplateState(cardConfig, id);
    var stateClass = dtState === 'forked' ? 'state-forked' : (dtState === 'orphaned' ? 'state-orphaned' : 'state-synced');
    var stateLabel = dtState === 'forked' ? t('forked') : (dtState === 'orphaned' ? t('orphaned') : t('version_synced'));
    var stateTooltip = dtState === 'forked' ? t('forked_tooltip') : (dtState === 'orphaned' ? t('orphaned_tooltip') : t('synced_tooltip'));
    var dtLocked = isDialogueTemplateLocked(_getCurrentCharName(), id);
    var activeDtKey = _getActiveDialogueTemplateKey(cardConfig, id);

    var html = '<div class="ne-config-card ' + stateClass + '" data-template-id="' + escapeHtml(id) + '" data-role-type="' + escapeHtml(roleType) + '">';
    html += '<div class="ne-config-card-header">';
    html += '<span><span class="ne-template-role-badge role-' + escapeHtml(roleType) + '">' + escapeHtml(t('role_' + roleType)) + '</span><b>' + escapeHtml(name) + '</b></span>';
    html += '<span class="ne-template-state-badge" title="' + escapeHtml(stateTooltip) + '">' + escapeHtml(stateLabel) + '</span>';
    html += '</div>';
    if (desc) {
        html += '<div class="ne-config-card-desc">' + escapeHtml(desc.substring(0, 120)) + (desc.length > 120 ? '...' : '') + '</div>';
    }
    html += '<div class="ne-config-card-meta">';
    html += '<span class="ne-template-field-chip">' + escapeHtml(presetCount) + ' ' + escapeHtml(t('preset_fields')) + '</span>';
    html += '<span class="ne-template-field-chip">' + escapeHtml(customCount) + ' ' + escapeHtml(t('custom_fields')) + '</span>';
    html += '<span class="ne-template-source-badge ' + sourceClass + '">' + escapeHtml(sourceLabel) + '</span>';
    html += '</div>';
    html += '<div class="ne-config-card-actions">';
    // Lock toggle (NPC only)
    if (roleType === 'npc') {
        html += '<button class="ne-btn-small ne-btn-lock' + (dtLocked ? ' locked' : '') + '" data-action="toggle-lock" data-template-id="' + escapeHtml(id) + '" title="' + escapeHtml(t('lock_tooltip')) + '">' + (dtLocked ? '\u{1F512}' : '\u{1F513}') + '</button>';
    }
    // Edit card-level
    if (activeDtKey) {
        html += '<button class="ne-btn-small ne-btn-edit" data-action="edit-card-level" data-dt-key="' + escapeHtml(activeDtKey) + '" data-template-id="' + escapeHtml(id) + '" title="' + escapeHtml(t('view_edit')) + '">\u270E</button>';
    }
    // Push to global (forked/orphaned only)
    if ((dtState === 'forked' || dtState === 'orphaned') && activeDtKey) {
        html += '<button class="ne-btn-small" data-action="push-global" data-dt-key="' + escapeHtml(activeDtKey) + '" title="' + escapeHtml(t('push_to_global')) + '">\u2191</button>';
    }
    // Remove from config
    html += '<button class="ne-btn-small ne-btn-danger" data-action="remove-from-config" data-template-id="' + escapeHtml(id) + '" data-role-type="' + escapeHtml(roleType) + '" title="' + escapeHtml(t('remove')) + '">\u2715</button>';
    html += '</div>';
    html += '</div>';
    return html;
}

// ─────────────────────────────────────
// Unified event hooks
// ─────────────────────────────────────

function _hookUnifiedEvents(container, templates, order, cardConfig) {
    // ── Accordion toggles (library) ──
    var libAccordionHeaders = container.querySelectorAll('[data-lib-accordion]');
    for (var la = 0; la < libAccordionHeaders.length; la++) {
        libAccordionHeaders[la].addEventListener('click', function () {
            var roleKey = this.getAttribute('data-lib-accordion');
            _libAccordionState[roleKey] = !_libAccordionState[roleKey];
            var body = this.nextElementSibling;
            if (body) body.style.display = _libAccordionState[roleKey] ? 'block' : 'none';
        });
    }

    // ── Accordion toggles (config) ──
    var cfgAccordionHeaders = container.querySelectorAll('[data-cfg-accordion]');
    for (var ca = 0; ca < cfgAccordionHeaders.length; ca++) {
        cfgAccordionHeaders[ca].addEventListener('click', function () {
            var roleKey = this.getAttribute('data-cfg-accordion');
            _cfgAccordionState[roleKey] = !_cfgAccordionState[roleKey];
            var body = this.nextElementSibling;
            if (body) body.style.display = _cfgAccordionState[roleKey] ? 'block' : 'none';
        });
    }

    // ── Toggle desc (expand/collapse card) ──
    var descToggles = container.querySelectorAll('[data-action="toggle-desc"]');
    for (var td = 0; td < descToggles.length; td++) {
        descToggles[td].addEventListener('click', function () {
            var card = this.closest('.ne-template-card');
            if (card) {
                card.classList.toggle('expanded');
                var preview = card.querySelector('.ne-template-card-fields-preview');
                if (preview) {
                    preview.style.display = card.classList.contains('expanded') ? 'flex' : 'none';
                }
            }
        });
    }

    // ── Add to dialogue ──
    var addBtns = container.querySelectorAll('[data-action="add-to-dialogue"]');
    for (var ad = 0; ad < addBtns.length; ad++) {
        addBtns[ad].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            var roleType = this.getAttribute('data-role-type');
            _addTemplateToDialogue(tplId, roleType, cardConfig, templates, container);
        });
    }

    // ── Remove from config ──
    var removeBtns = container.querySelectorAll('[data-action="remove-from-config"]');
    for (var rm = 0; rm < removeBtns.length; rm++) {
        removeBtns[rm].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            var roleType = this.getAttribute('data-role-type');
            _removeTemplateFromDialogue(tplId, roleType, cardConfig, container);
        });
    }

    // ── Edit (global mode) ──
    var editBtns = container.querySelectorAll('[data-action="edit"]');
    for (var ed = 0; ed < editBtns.length; ed++) {
        editBtns[ed].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _showEditor(container, tplId, false, templates, order);
        });
    }

    // ── Edit card-level ──
    var editCardBtns = container.querySelectorAll('[data-action="edit-card-level"]');
    for (var ec = 0; ec < editCardBtns.length; ec++) {
        editCardBtns[ec].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            var dtKey = this.getAttribute('data-dt-key');
            if (!tplId || !dtKey) return;
            _showEditor(container, tplId, false, templates, order, true, dtKey);
        });
    }

    // ── Duplicate ──
    var dupBtns = container.querySelectorAll('[data-action="duplicate"]');
    for (var du = 0; du < dupBtns.length; du++) {
        dupBtns[du].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _duplicateTemplate(tplId, templates, container);
        });
    }

    // ── Delete ──
    var delBtns = container.querySelectorAll('[data-action="delete"]');
    for (var dl = 0; dl < delBtns.length; dl++) {
        delBtns[dl].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _deleteTemplateConfirm(tplId, templates, order, container);
        });
    }

    // ── Create first / Create template ──
    var createFirstBtns = container.querySelectorAll('[data-action="create-first"]');
    for (var cf = 0; cf < createFirstBtns.length; cf++) {
        createFirstBtns[cf].addEventListener('click', function () {
            _showEditor(container, null, true, templates, order);
        });
    }

    // ── Go to library ──
    var goToLibBtns = container.querySelectorAll('[data-action="go-to-library"]');
    for (var gl = 0; gl < goToLibBtns.length; gl++) {
        goToLibBtns[gl].addEventListener('click', function () {
            var roleType = this.getAttribute('data-role-type');
            // Expand the corresponding library accordion
            _libAccordionState[roleType] = true;
            // Scroll to library section
            var libSection = container.querySelector('#ne-unified-library');
            if (libSection) {
                libSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Highlight the accordion
                var accordion = libSection.querySelector('[data-lib-accordion="' + roleType + '"]');
                if (accordion) {
                    accordion.classList.add('ne-highlight-pulse');
                    setTimeout(function () { accordion.classList.remove('ne-highlight-pulse'); }, 2000);
                }
                // Make sure the body is visible
                var body = accordion ? accordion.nextElementSibling : null;
                if (body) body.style.display = 'block';
            }
        });
    }

    // ── Toggle lock (NPC config cards) ──
    var lockBtns = container.querySelectorAll('[data-action="toggle-lock"]');
    for (var lk = 0; lk < lockBtns.length; lk++) {
        lockBtns[lk].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
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
            showToast((newLocked ? t('locked') : t('unlock')) + ': ' + tplId, 'info', 2000);
        });
    }

    // ── Push to global (config cards) ──
    var pushBtns = container.querySelectorAll('[data-action="push-global"]');
    for (var pb = 0; pb < pushBtns.length; pb++) {
        pushBtns[pb].addEventListener('click', function () {
            var dtKey = this.getAttribute('data-dt-key');
            var charName = _getCurrentCharName();
            if (!charName || !dtKey) return;
            showConfirm(t('push_to_global'), t('confirm_push_to_global'), t('Save'), t('Cancel'), false).then(function (confirmed) {
                if (!confirmed) return;
                var newId = pushTemplateToGlobal(charName, dtKey);
                if (newId) {
                    showToast(t('template_saved'), 'success', 3000);
                    renderTemplatesIntoSlide(container);
                } else {
                    showToast(t('Save') + ': ERROR', 'error', 3000);
                }
            });
        });
    }

    // ── Search input ──
    var searchInput = container.querySelector('#ne-template-search');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            _searchQuery = this.value.toLowerCase();
            _applySearchFilter(container, templates);
        });
    }

    // ── Sort select ──
    var sortSelect = container.querySelector('#ne-template-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', function () {
            _sortBy = this.value;
            renderTemplatesIntoSlide(container);
        });
    }

    // ── Tag filter chips ──
    var tagChips = container.querySelectorAll('[data-tag-filter]');
    for (var tc = 0; tc < tagChips.length; tc++) {
        tagChips[tc].addEventListener('click', function () {
            _activeTagFilter = this.getAttribute('data-tag-filter') || null;
            renderTemplatesIntoSlide(container);
        });
    }

    // ── Template mode radios ──
    var modeRadios = container.querySelectorAll('input[name="ne-template-mode"]');
    for (var mr = 0; mr < modeRadios.length; mr++) {
        modeRadios[mr].addEventListener('change', function () {
            if (!cardConfig) return;
            if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
            cardConfig._templateConfig._templateMode = this.value;
            // Also update _npcTemplateMode for backward compat
            cardConfig._templateConfig._npcTemplateMode = this.value;
            var charName = _getCurrentCharName();
            if (charName) saveCardConfig(charName, cardConfig);
            // Update hint text
            var hintEl = container.querySelector('.ne-template-mode-hint');
            if (hintEl) {
                hintEl.textContent = this.value === 'fast' ? t('fast_mode_hint') : t('smart_mode_hint');
            }
        });
    }

    // ── World context edit/save/cancel/clear ──
    var wcEditBtn = container.querySelector('#ne-world-ctx-edit-btn');
    if (wcEditBtn) {
        wcEditBtn.addEventListener('click', function () {
            _worldCtxEditing = true;
            _refreshCurrentPanel();
        });
    }
    var wcClearBtn = container.querySelector('#ne-world-ctx-clear-btn');
    if (wcClearBtn) {
        wcClearBtn.addEventListener('click', function () {
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

    // ── Mobile zone switcher ──
    var mobileTabs = container.querySelectorAll('[data-mobile-zone]');
    for (var mt = 0; mt < mobileTabs.length; mt++) {
        mobileTabs[mt].addEventListener('click', function () {
            var zone = this.getAttribute('data-mobile-zone');
            // Toggle active classes on tabs
            var allMobileTabs = container.querySelectorAll('[data-mobile-zone]');
            for (var am = 0; am < allMobileTabs.length; am++) {
                allMobileTabs[am].classList.toggle('active', allMobileTabs[am].getAttribute('data-mobile-zone') === zone);
            }
            // Toggle sections
            var libSection = container.querySelector('#ne-unified-library');
            var cfgSection = container.querySelector('#ne-unified-config');
            if (libSection) libSection.classList.toggle('ne-mobile-active', zone === 'library');
            if (cfgSection) cfgSection.classList.toggle('ne-mobile-active', zone === 'config');
        });
    }
}

// ─────────────────────────────────────
// Add / Remove template from dialogue
// ─────────────────────────────────────

function _addTemplateToDialogue(tplId, roleType, cardConfig, templates, container) {
    var charName = _getCurrentCharName();
    if (!charName) {
        showToast(t('no_character_selected') || 'No character selected', 'warn', 3000);
        return;
    }
    // Create cardConfig if it doesn't exist yet
    if (!cardConfig) {
        cardConfig = {
            _templateConfig: {
                pc: null,
                npc: [],
                faction: '_default_faction',
                quest: ['_default_quest'],
                _templateMode: 'smart'
            },
            _dialogueTemplates: {}
        };
    }
    if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
    if (!cardConfig._dialogueTemplates) cardConfig._dialogueTemplates = {};
    var tpl = templates[tplId];
    if (!tpl) return;

    if (roleType === 'pc' || roleType === 'faction') {
        // Single-select: if existing different template, confirm replace
        var existing = cardConfig._templateConfig[roleType];
        var existingId = (roleType === 'pc' && existing && existing._templateId) ? existing._templateId : (roleType === 'faction' ? existing : null);
        if (existingId && existingId !== tplId) {
            showConfirm(t('set_as_active'), t('confirm_replace_single').replace('{name}', tpl.name || tplId), t('Save'), t('Cancel'), false).then(function (confirmed) {
                if (!confirmed) return;
                // Clone template to card (saves to localStorage), then reload to get fresh state
                if (charName) cloneTemplateToCard(charName, tpl);
                cardConfig = loadCardConfigSync(charName) || cardConfig;
                if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
                if (roleType === 'pc') {
                    cardConfig._templateConfig.pc = { _templateId: tplId, name: tpl.name || '', role: 'protagonist' };
                } else {
                    cardConfig._templateConfig.faction = tplId;
                }
                if (charName) saveCardConfig(charName, cardConfig);
                showToast(t('template_saved'), 'success', 2000);
                renderTemplatesIntoSlide(container);
            });
        } else {
            // No existing or same template
            if (charName) cloneTemplateToCard(charName, tpl);
            cardConfig = loadCardConfigSync(charName) || cardConfig;
            if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
            if (roleType === 'pc') {
                cardConfig._templateConfig.pc = { _templateId: tplId, name: tpl.name || '', role: 'protagonist' };
            } else {
                cardConfig._templateConfig.faction = tplId;
            }
            if (charName) saveCardConfig(charName, cardConfig);
            showToast(t('template_saved'), 'success', 2000);
            renderTemplatesIntoSlide(container);
        }
    } else {
        // Multi-select (NPC/Quest): check not already in pool
        if (roleType === 'npc') {
            if (!cardConfig._templateConfig.npc) cardConfig._templateConfig.npc = [];
            for (var i = 0; i < cardConfig._templateConfig.npc.length; i++) {
                if (cardConfig._templateConfig.npc[i]._templateId === tplId) {
                    showToast(t('already_in_pool'), 'info', 2000);
                    return;
                }
            }
            if (charName) cloneTemplateToCard(charName, tpl);
            cardConfig = loadCardConfigSync(charName) || cardConfig;
            if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
            if (!cardConfig._templateConfig.npc) cardConfig._templateConfig.npc = [];
            cardConfig._templateConfig.npc.push({ _templateId: tplId, name: tpl.name || '', role: 'npc' });
        } else if (roleType === 'quest') {
            if (!cardConfig._templateConfig.quest) cardConfig._templateConfig.quest = ['_default_quest'];
            if (cardConfig._templateConfig.quest.indexOf(tplId) !== -1) {
                showToast(t('already_in_pool'), 'info', 2000);
                return;
            }
            if (charName) cloneTemplateToCard(charName, tpl);
            cardConfig = loadCardConfigSync(charName) || cardConfig;
            if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
            if (!cardConfig._templateConfig.quest) cardConfig._templateConfig.quest = ['_default_quest'];
            cardConfig._templateConfig.quest.push(tplId);
        }
        if (charName) saveCardConfig(charName, cardConfig);
        showToast(t('template_saved'), 'success', 2000);
        renderTemplatesIntoSlide(container);
    }
}

function _removeTemplateFromDialogue(tplId, roleType, cardConfig, container) {
    if (!cardConfig || !cardConfig._templateConfig) return;
    var charName = _getCurrentCharName();

    if (roleType === 'pc') {
        delete cardConfig._templateConfig.pc;
    } else if (roleType === 'faction') {
        cardConfig._templateConfig.faction = '_default_faction';
    } else if (roleType === 'npc') {
        var npcPool = cardConfig._templateConfig.npc || [];
        var idx = -1;
        for (var i = 0; i < npcPool.length; i++) {
            if (npcPool[i]._templateId === tplId) { idx = i; break; }
        }
        if (idx === -1) return;
        if (npcPool.length <= 1) {
            showToast(t('no_templates'), 'warn', 2000);
            return;
        }
        npcPool.splice(idx, 1);
        cardConfig._templateConfig.npc = npcPool;
    } else if (roleType === 'quest') {
        var questPool = cardConfig._templateConfig.quest || ['_default_quest'];
        var qIdx = questPool.indexOf(tplId);
        if (qIdx === -1) return;
        if (questPool.length <= 1) {
            showToast(t('no_templates'), 'warn', 2000);
            return;
        }
        questPool.splice(qIdx, 1);
        cardConfig._templateConfig.quest = questPool;
    }

    if (charName) saveCardConfig(charName, cardConfig);
    renderTemplatesIntoSlide(container);
}

function _applySearchFilter(container, templates) {
    var cards = container.querySelectorAll('#ne-unified-library .ne-template-card');
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

    // Also check config cards for search match
    var configCards = container.querySelectorAll('#ne-unified-config .ne-config-card');
    for (var cc = 0; cc < configCards.length; cc++) {
        var cfgCard = configCards[cc];
        var cfgTplId = cfgCard.getAttribute('data-template-id');
        var cfgTpl = templates[cfgTplId];
        if (!cfgTpl) continue;
        var cfgMatches = true;
        if (_searchQuery) {
            var cfgName = (cfgTpl.name || cfgTplId).toLowerCase();
            var cfgDesc = (cfgTpl.description || '').toLowerCase();
            cfgMatches = cfgName.indexOf(_searchQuery) !== -1 || cfgDesc.indexOf(_searchQuery) !== -1;
        }
        cfgCard.classList.toggle('search-hit', cfgMatches);
    }

    // Show/hide no-match message
    var noMatch = container.querySelector('.ne-search-no-match');
    if (!anyVisible && _searchQuery) {
        if (!noMatch) {
            var activeContent = container.querySelector('.ne-accordion-body');
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

/** @deprecated Replaced by inline add-to-dialogue buttons in the unified view. */
function _showTemplateSelectorModal(opts) {
    var title = opts.title || '';
    var templates = opts.templates || {};
    var role = opts.role || 'npc';
    var excludeIds = opts.excludeIds || [];
    var onPick = opts.onPick;

    var available = Object.keys(templates).filter(function (id) {
        return templates[id] && templates[id].role === role && excludeIds.indexOf(id) === -1;
    });

    var html = '<div class="ne-modal-overlay" id="ne-template-selector-modal">';
    html += '<div class="ne-modal">';
    html += '<h3>' + escapeHtml(title) + '</h3>';
    html += '<div class="ne-modal-body">';
    if (available.length === 0) {
        // Show empty state with guidance instead of silent toast
        html += '<div class="ne-empty-state"><div class="ne-empty-state-icon">\u{1F4CB}</div>';
        html += '<div class="ne-empty-state-text">' + escapeHtml(t('none_available')) + '</div>';
        html += '<div style="margin-top:8px;font-size:0.85em;color:var(--grey-50);">' + escapeHtml(t('create_first_hint') || 'Create a template in the Template Library first.') + '</div>';
        html += '</div>';
    } else {
        available.forEach(function (id) {
            var tpl = templates[id];
            html += '<label class="ne-preset-field">' +
                '<input type="radio" name="ne-template-select" value="' + escapeHtml(id) + '"> ' +
                escapeHtml(tpl.name || id) +
                (tpl.description ? ' <span style="color:var(--grey-50);font-size:0.85em;">' + escapeHtml(tpl.description.substring(0, 60)) + '</span>' : '') +
                '</label>';
        });
    }
    html += '</div>';
    html += '<div class="ne-modal-footer">';
    if (available.length > 0) {
        html += '<button id="ne-template-select-save" class="menu_button">' + escapeHtml(t('add')) + '</button>';
    }
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

    var cancelBtn = modalEl.querySelector('#ne-template-select-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeModal(); });

    var saveBtn = modalEl.querySelector('#ne-template-select-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            var selected = modalEl.querySelector('input[name="ne-template-select"]:checked');
            if (selected && onPick) {
                onPick(selected.value);
            }
            closeModal();
        });
    }
}

// ─────────────────────────────────────
// Template Editor (P6 deferred to phase 3, basic version here)
// ─────────────────────────────────────

function _showEditor(container, templateId, isNew, templates, order, isCardLevel, cardDtKey) {
    // Clear flex styles from dual-zone layout
    container.style.cssText = '';
    // N7: Load cardConfig first (needed for card-level mode)
    var cardConfig = null;
    var charName = _getCurrentCharName();
    try { if (charName) cardConfig = loadCardConfigSync(charName); } catch (e) {}

    var tpl;
    if (isNew) {
        tpl = { name: '', role: 'npc', presetFields: [], customFieldRefs: [], tags: [], description: '', source: 'user_created' };
    } else if (isCardLevel && cardDtKey && cardConfig && cardConfig._dialogueTemplates && cardConfig._dialogueTemplates[cardDtKey]) {
        // Card-level mode: load from dialogue template version
        var dt = cardConfig._dialogueTemplates[cardDtKey];
        tpl = {
            id: dt._templateId,
            name: (templates[dt._templateId] && templates[dt._templateId].name) || dt._templateId || 'Card Version',
            role: (templates[dt._templateId] && templates[dt._templateId].role) || 'npc',
            presetFields: dt.presetFields || [],
            customFieldRefs: dt.customFieldRefs || [],
            tags: (templates[dt._templateId] && templates[dt._templateId].tags) || [],
            description: (templates[dt._templateId] && templates[dt._templateId].description) || '',
            source: dt.source || 'user_created',
            createdAt: dt.createdAt,
            _state: dt._state || 'synced',
            _active: dt._active
        };
    } else {
        tpl = templateId ? templates[templateId] : null;
    }
    if (!tpl && !isNew) return;

    var html = '<div class="ne-template-editor" id="ne-template-editor">';
    // P6: Breadcrumb navigation
    html += '<div class="ne-breadcrumb" style="display:flex;align-items:center;gap:4px;margin-bottom:8px;font-size:0.82em;">';
    if (isCardLevel) {
        html += '<span class="ne-breadcrumb-link" id="ne-editor-bc-library" style="cursor:pointer;color:var(--ne-info);">' + escapeHtml(t('dialogue_config')) + '</span>';
    } else {
        html += '<span class="ne-breadcrumb-link" id="ne-editor-bc-library" style="cursor:pointer;color:var(--ne-info);">' + escapeHtml(t('breadcrumb_library')) + '</span>';
    }
    html += '<span style="color:var(--grey-50);"> \u203a </span>';
    html += '<span style="color:var(--grey-50);">' + (isNew ? escapeHtml(t('breadcrumb_new')) : escapeHtml(t('breadcrumb_edit'))) + '</span>';
    if (!isNew && tpl.name) {
        html += '<span style="color:var(--grey-50);"> \u203a </span>';
        html += '<span>' + escapeHtml(tpl.name) + '</span>';
    }
    if (isCardLevel) {
        html += ' <span class="ne-template-source-badge src-user" style="font-size:0.75em;">' + escapeHtml(t('card_level')) + '</span>';
    }
    html += '</div>';

    // Basic info (read-only in card-level mode)
    var metaDisabled = isCardLevel ? ' disabled' : '';
    html += '<div class="ne-editor-section">';
    html += '<label>' + escapeHtml(t('Name')) + '</label>';
    html += '<input type="text" id="ne-editor-name" class="ne-editor-input" value="' + escapeHtml(tpl.name || '') + '" placeholder="' + escapeHtml(t('Name')) + '"' + metaDisabled + '>';
    html += '<label>' + escapeHtml(t('Role')) + '</label>';
    html += '<select id="ne-editor-role" class="ne-config-select"' + metaDisabled + '>';
    html += '<option value="npc"' + (tpl.role === 'npc' || !tpl.role ? ' selected' : '') + '>' + escapeHtml(t('role_npc')) + '</option>';
    html += '<option value="pc"' + (tpl.role === 'pc' ? ' selected' : '') + '>' + escapeHtml(t('role_pc')) + '</option>';
    html += '<option value="faction"' + (tpl.role === 'faction' ? ' selected' : '') + '>' + escapeHtml(t('role_faction')) + '</option>';
    html += '<option value="quest"' + (tpl.role === 'quest' ? ' selected' : '') + '>' + escapeHtml(t('role_quest')) + '</option>';
    html += '</select>';
    html += '<label>' + escapeHtml(t('Description')) + '</label>';
    html += '<textarea id="ne-editor-desc" class="ne-editor-textarea" rows="2"' + metaDisabled + '>' + escapeHtml(tpl.description || '') + '</textarea>';
    if (isCardLevel) {
        html += '<div style="font-size:0.8em;color:var(--grey-50);margin-top:4px;">' + escapeHtml(t('card_version_edit_hint') || 'Editing card-level fields only. Metadata is read-only.') + '</div>';
    }
    html += '</div>';

    // Preset fields
    html += '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('preset_fields')) + '</div>';
    var existingPresets = (tpl.presetFields && Array.isArray(tpl.presetFields)) ? tpl.presetFields : [];
    var role = tpl.role || 'npc';
    var allowedCats = ROLE_CATEGORY_MAP[role] || ROLE_CATEGORY_MAP.npc;
    Object.keys(PRESET_FIELDS).forEach(function (cat) {
        if (allowedCats.indexOf(cat) === -1) return;
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

    // Tags (hidden in card-level mode)
    if (!isCardLevel) {
        html += '<div class="ne-editor-section">';
        html += '<label>' + escapeHtml(t('Tags')) + '</label>';
        var tags = (tpl.tags && Array.isArray(tpl.tags)) ? tpl.tags.join(', ') : '';
        html += '<input type="text" id="ne-editor-tags" class="ne-editor-input" value="' + escapeHtml(tags) + '" placeholder="tag1, tag2">';
        html += '</div>';
    }

    // Version history - always check for non-new templates (reads from cardConfig._dialogueTemplates)
    if (!isNew) {
        var vhHtml = _renderVersionHistoryHTML(tpl);
        if (vhHtml) html += vhHtml;
    }

    // Lock toggle (hidden in card-level mode - lock is managed from config panel)
    if (!isCardLevel) {
        var isLocked = !!(tpl._locked);
        html += '<div class="ne-editor-section">';
        html += '<label class="ne-lock-toggle">' +
            '<input type="checkbox" id="ne-editor-lock"' + (isLocked ? ' checked' : '') + '> ' +
            escapeHtml(t('lock_template')) +
            '</label>';
        html += '</div>';
    }

    // P6: Show in-use count for non-new templates
    if (!isNew && cardConfig && cardConfig._dialogueTemplates) {
        var inUseCount = 0;
        var usedNames = [];
        Object.keys(cardConfig._dialogueTemplates).forEach(function (dtKey) {
            var dt = cardConfig._dialogueTemplates[dtKey];
            if (dt && dt._templateId === templateId) {
                inUseCount++;
                usedNames.push(dtKey);
            }
        });
        if (inUseCount > 0) {
            html += '<div class="ne-editor-section">';
            html += '<span style="font-size:0.85em;color:var(--ne-info);">' + escapeHtml(t('in_use')) + ': ' + inUseCount + '</span>';
            if (usedNames.length <= 3) {
                html += ' <span style="font-size:0.78em;color:var(--grey-50);">(' + usedNames.map(escapeHtml).join(', ') + ')</span>';
            }
            html += '</div>';
        }
    }

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
    // P6: Breadcrumb click returns to previous view
    var bcLib = container.querySelector('#ne-editor-bc-library');
    if (bcLib) {
        bcLib.addEventListener('click', function () {
            renderTemplatesIntoSlide(container);
        });
    }

    var cancelBtn = container.querySelector('#ne-editor-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            renderTemplatesIntoSlide(container);
        });
    }

    var saveBtn = container.querySelector('#ne-editor-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            if (isCardLevel) {
                _saveCardLevelEditor(container, charName, cardDtKey, cardConfig, templates, order);
            } else {
                _saveTemplateFromEditor(container, templateId, isNew, templates, order);
            }
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

function _saveCardLevelEditor(container, charName, cardDtKey, cardConfig, templates, order) {
    // Read preset fields from checkboxes
    var presetFields = [];
    var checkboxes = container.querySelectorAll('.ne-preset-checkbox:checked');
    for (var i = 0; i < checkboxes.length; i++) {
        presetFields.push(checkboxes[i].value);
    }
    // Read custom fields
    var customFieldRefs = [];
    var customItems = container.querySelectorAll('.ne-custom-field-item span');
    for (var j = 0; j < customItems.length; j++) {
        customFieldRefs.push(customItems[j].textContent);
    }

    // Use editTemplateInCard to create new immutable version
    var newKey = editTemplateInCard(charName, cardDtKey, presetFields, customFieldRefs);
    if (newKey) {
        showToast(t('template_saved'), 'success', 3000);
        renderTemplatesIntoSlide(container);
    } else {
        showToast(t('Save') + ': ERROR', 'error', 3000);
    }
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
