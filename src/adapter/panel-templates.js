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
  loadCardConfig, saveCardConfig, loadCardConfigSync, setDialogueTemplateLock,
  editTemplateInCard, forkTemplateInCard, pushTemplateToGlobal, cloneTemplateToCard, getTemplateCopyByTemplateId,
  loadFieldLibrary, addFieldToLibrary, getFieldFromLibrary, addTemplateRefToField, removeTemplateRefFromField, readState } from '../core/vault/store.js';
import { PRESET_FIELDS, ALL_PREDEFINED_FIELDS, buildCharacterSchemaFromTemplates, DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE, DEFAULT_FACTION_TEMPLATE, DEFAULT_TASK_TEMPLATE, DEFAULT_GOAL_TEMPLATE, ROLE_CATEGORY_MAP, getPresetFieldsForRole } from '../core/vault/schema.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { PD, pdCreate, panelById, t, showToast, showConfirm, busEmit } from './panel-shared.js';
import { runTemplateAssistant, buildTemplateFingerprint, applyAssistantPlan, collectFieldValueSummary } from '../core/engine/template-assistant.js';
import { collectWorldBookContent } from '../core/engine/state-pipeline.js';

// ── Page root state ──
var _lastRenderTick = 0;
var _renderTicket = 0;
var _searchQuery = '';
var _activeTagFilter = null;
var _sortBy = 'default';      // 'default' | 'name' | 'date' | 'fields'
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
 * Main nav page entry point. Called by registerNavPage('templates', ...).
 * Renders a unified dual-zone view:
 *   TOP half: Global template library (cards grouped by role in accordions)
 *   BOTTOM half: Current dialogue config (cards showing what's in use + template mode + world context)
 * @param {HTMLElement} container - #ne-page-content
 */
export function renderTemplatesIntoSlide(container) {
    if (!container) return;
    var ticket = ++_renderTicket;

    var _scrollParent = container.parentElement;
    var _savedScrollTop = _scrollParent ? _scrollParent.scrollTop : 0;

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

    if (_scrollParent) _scrollParent.scrollTop = _savedScrollTop;

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
    var factionId = cfg.faction || null;
    var questPool = (cfg.quest && Array.isArray(cfg.quest)) ? cfg.quest : [];
    var hasChar = !!_getCurrentCharName();

    if (!hasChar) {
        return '<div class="ne-template-config" id="ne-template-config">' +
            '<div class="ne-empty-state"><div class="ne-empty-state-icon">📋</div>' +
            '<div class="ne-empty-state-text">' + escapeHtml(t('no_current_char')) + '</div></div></div>';
    }

    var html = '<div class="ne-template-config" id="ne-template-config">';

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
            if (factionId) {
                var facTpl = templates[factionId];
                if (facTpl) {
                    cardsHtml = _renderConfigCardHTML(facTpl, factionId, cardConfig, 'faction');
                    count = 1;
                }
            }
        } else if (r.key === 'quest') {
            questPool.forEach(function (qid) {
                if (qid) {
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
    html += '<button id="ne-btn-ai-template" class="ne-btn-small" data-action="ai-create" title="' + escapeHtml(t('ai_assistant_title')) + '">✨ ' + escapeHtml(t('ai_assistant_btn')) + '</button>';
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
    var activeKey = getTemplateCopyByTemplateId(cardConfig._dialogueTemplates, templateId);
    if (!activeKey) return null;
    var dt = cardConfig._dialogueTemplates[activeKey];
    return dt ? (dt._state || 'synced') : null;
}

/**
 * N7: Get the active dialogue template key for a given global templateId.
 */
function _getActiveDialogueTemplateKey(cardConfig, templateId) {
    if (!cardConfig || !cardConfig._dialogueTemplates) return null;
    return getTemplateCopyByTemplateId(cardConfig._dialogueTemplates, templateId);
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
    html += '<button class="ne-btn-small" data-action="ai-edit" data-template-id="' + escapeHtml(id) + '" title="' + escapeHtml(t('ai_assistant_title')) + '">✨ ' + escapeHtml(t('ai_assistant_btn')) + '</button>';
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

// UIP-2: 基于已读入的 cardConfig 判断对话模板锁定态（避免每卡重复 loadCardConfigSync）
function _tplConfigLocked(cardConfig, globalTemplateId) {
    if (!cardConfig || !cardConfig._dialogueTemplates) return false;
    var dtKeys = Object.keys(cardConfig._dialogueTemplates);
    for (var i = 0; i < dtKeys.length; i++) {
        var dt = cardConfig._dialogueTemplates[dtKeys[i]];
        if (dt._templateId === globalTemplateId && dt._locked) return true;
    }
    return false;
}

function _renderConfigCardHTML(tpl, id, cardConfig, roleType) {
    if (!tpl) return '';
    var name = tpl.name || id;
    var desc = tpl.description || '';
    var dtLocked = _tplConfigLocked(cardConfig, id);
    var activeDtKey = _getActiveDialogueTemplateKey(cardConfig, id);
    // 字段数 chips 从实际生效的卡片级副本取（与 ✎ 编辑器同数据源）。
    // 副本 forked 后字段数与全局模板分叉，若显示全局数会造成
    // "模板库显示的字段数 ≠ 进入编辑模式后的字段数"
    var effectiveSrc = tpl;
    if (activeDtKey && cardConfig && cardConfig._dialogueTemplates && cardConfig._dialogueTemplates[activeDtKey]) {
        effectiveSrc = cardConfig._dialogueTemplates[activeDtKey];
    }
    var presetCount = (effectiveSrc.presetFields && Array.isArray(effectiveSrc.presetFields)) ? effectiveSrc.presetFields.length : 0;
    var customCount = (effectiveSrc.customFieldRefs && Array.isArray(effectiveSrc.customFieldRefs)) ? effectiveSrc.customFieldRefs.length : 0;
    var source = tpl.source || (tpl.system ? 'system' : 'user_created');
    var sourceLabel = source === 'ai_generated' ? t('ai_generated') : (source === 'system' ? t('system_template') : t('user_created'));
    var sourceClass = source === 'ai_generated' ? 'src-ai' : (source === 'system' ? 'src-system' : 'src-user');
    var dtState = _getDialogueTemplateState(cardConfig, id);
    var stateClass = dtState === 'forked' ? 'state-forked' : (dtState === 'orphaned' ? 'state-orphaned' : 'state-synced');
    var stateLabel = dtState === 'forked' ? t('forked') : (dtState === 'orphaned' ? t('orphaned') : t('version_synced'));
    var stateTooltip = dtState === 'forked' ? t('forked_tooltip') : (dtState === 'orphaned' ? t('orphaned_tooltip') : t('synced_tooltip'));

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

    // ── AI assistant: modify from card ──
    var aiEditBtns = container.querySelectorAll('[data-action="ai-edit"]');
    for (var ae = 0; ae < aiEditBtns.length; ae++) {
        aiEditBtns[ae].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _showAssistant(container, 'modify', tplId, templates, order);
        });
    }

    // ── AI assistant: create from toolbar ──
    var aiCreateBtn = container.querySelector('#ne-btn-ai-template');
    if (aiCreateBtn) {
        aiCreateBtn.addEventListener('click', function () {
            _showAssistant(container, 'create', null, templates, order);
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
                faction: null,
                quest: [],
                _templateMode: 'fast'
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
            if (!cardConfig._templateConfig.quest) cardConfig._templateConfig.quest = [];
            if (cardConfig._templateConfig.quest.indexOf(tplId) !== -1) {
                showToast(t('already_in_pool'), 'info', 2000);
                return;
            }
            if (charName) cloneTemplateToCard(charName, tpl);
            cardConfig = loadCardConfigSync(charName) || cardConfig;
            if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
            if (!cardConfig._templateConfig.quest) cardConfig._templateConfig.quest = [];
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
        cardConfig._templateConfig.faction = null;
    } else if (roleType === 'npc') {
        var npcPool = cardConfig._templateConfig.npc || [];
        var idx = -1;
        for (var i = 0; i < npcPool.length; i++) {
            if (npcPool[i]._templateId === tplId) { idx = i; break; }
        }
        if (idx === -1) return;
        npcPool.splice(idx, 1);
        cardConfig._templateConfig.npc = npcPool;
    } else if (roleType === 'quest') {
        var questPool = cardConfig._templateConfig.quest || [];
        var qIdx = questPool.indexOf(tplId);
        if (qIdx === -1) return;
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

// ─────────────────────────────────────
// AI Assistant (create / modify template)
// ─────────────────────────────────────

function _aiGetChatId() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.chatId) return ctx.chatId;
        }
    } catch (e) {}
    return null;
}

function _aiResolveBaseline(mode, templateId, templates, baselineSel) {
    if (mode === 'modify') {
        return templateId ? (templates[templateId] || null) : null;
    }
    if (baselineSel === 'default:pc') return DEFAULT_PC_TEMPLATE;
    if (baselineSel === 'default:npc') return DEFAULT_NPC_TEMPLATE;
    return null;
}

function _aiFormatMeta(meta) {
    if (!meta) return '';
    var parts = [meta.type];
    if (meta.values) parts.push(meta.values.join('/'));
    if (meta.max_length !== undefined) parts.push('≤' + meta.max_length);
    if (meta.min !== undefined) parts.push('≥' + meta.min);
    if (meta.max !== undefined && meta.min !== undefined) parts.push('≤' + meta.max);
    else if (meta.max !== undefined) parts.push('≤' + meta.max);
    return parts.join(' ');
}

function _showAssistant(container, mode, templateId, templates, order) {
    // Clear flex styles from dual-zone layout (same as editor)
    container.style.cssText = '';
    var tpl = null;
    if (mode === 'modify') {
        tpl = templateId ? templates[templateId] : null;
        if (!tpl) return;
    }

    var html = '<div class="ne-template-editor" id="ne-ai-assistant">';
    // Breadcrumb
    html += '<div class="ne-breadcrumb" style="display:flex;align-items:center;gap:4px;margin-bottom:8px;font-size:0.82em;">';
    html += '<span class="ne-breadcrumb-link ne-text-info" id="ne-ai-bc-lib" style="cursor:pointer;">' + escapeHtml(t('breadcrumb_library')) + '</span>';
    html += '<span class="ne-text-soft"> › </span>';
    html += '<span class="ne-text-soft">' + escapeHtml(t('ai_assistant_title')) + (mode === 'modify' && tpl && tpl.name ? ' · ' + escapeHtml(tpl.name) : '') + '</span>';
    html += '</div>';

    // Mode info
    html += '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('ai_assistant_title')) + ' — ' + escapeHtml(mode === 'modify' ? t('ai_mode_modify') : t('ai_mode_create')) + '</div>';
    if (mode === 'modify') {
        if (tpl.system) {
            html += '<div class="ne-text-soft" style="font-size:0.8em;">' + escapeHtml(t('system_template')) + ' → ' + escapeHtml(t('save_as_new')) + '</div>';
        }
        html += '<div class="ne-text-soft" style="font-size:0.8em;margin-top:4px;">ℹ ' + escapeHtml(t('ai_value_dist_included')) + '</div>';
    } else {
        html += '<label>' + escapeHtml(t('ai_baseline_label')) + '</label>';
        html += '<select id="ne-ai-baseline" class="ne-editor-select">';
        html += '<option value="scratch">' + escapeHtml(t('ai_baseline_scratch')) + '</option>';
        html += '<option value="default:pc">' + escapeHtml(t('ai_baseline_default_pc')) + '</option>';
        html += '<option value="default:npc" selected>' + escapeHtml(t('ai_baseline_default_npc')) + '</option>';
        html += '</select>';
    }
    html += '</div>';

    // Request input
    html += '<div class="ne-editor-section">';
    html += '<textarea id="ne-ai-request" class="ne-editor-textarea" rows="4" placeholder="' + escapeHtml(t('ai_requirement_placeholder')) + '"></textarea>';
    html += '<label class="ne-preset-field" style="margin-top:6px;"><input type="checkbox" id="ne-ai-worldbook"> ' + escapeHtml(t('ai_use_worldbook')) + '</label>';
    html += '</div>';

    html += '<div style="margin-bottom:10px;">';
    html += '<button id="ne-ai-generate" class="menu_button">✨ ' + escapeHtml(t('ai_generate')) + '</button>';
    html += '</div>';
    html += '<div id="ne-ai-result"></div>';
    html += '</div>';
    container.innerHTML = html;

    var bcLib = container.querySelector('#ne-ai-bc-lib');
    if (bcLib) bcLib.addEventListener('click', function () { renderTemplatesIntoSlide(container); });

    var genBtn = container.querySelector('#ne-ai-generate');
    if (genBtn) {
        genBtn.addEventListener('click', function () {
            _aiGenerate(container, mode, templateId, templates);
        });
    }
}

async function _aiGenerate(container, mode, templateId, templates) {
    var requestEl = container.querySelector('#ne-ai-request');
    var resultEl = container.querySelector('#ne-ai-result');
    var genBtn = container.querySelector('#ne-ai-generate');
    var request = requestEl ? requestEl.value.trim() : '';
    if (!request) { showToast(t('ai_request_required'), 'warn'); return; }

    var selEl = container.querySelector('#ne-ai-baseline');
    var baselineSel = selEl ? selEl.value : 'scratch';
    var baselineTemplate = _aiResolveBaseline(mode, templateId, templates, baselineSel);
    if (mode === 'modify' && !baselineTemplate) return;

    var fingerprint = (mode === 'modify')
        ? buildTemplateFingerprint(baselineTemplate)
        : baselineSel; // 'scratch' | 'default:pc' | 'default:npc'

    // World book (read-only, opt-in)
    var worldBookText = '';
    var wbEl = container.querySelector('#ne-ai-worldbook');
    if (wbEl && wbEl.checked) {
        try {
            var entries = await collectWorldBookContent();
            worldBookText = (entries || []).map(function (e) { return e.content || ''; }).join('\n').trim();
            if (worldBookText.length > 8000) worldBookText = worldBookText.slice(0, 8000) + '\n…（已截断）';
        } catch (e) { worldBookText = ''; }
    }

    // Value distribution (modify mode, best-effort)
    var valueSummaryText = '';
    var valueMap = {};
    if (mode === 'modify') {
        try {
            var chatId = _aiGetChatId();
            if (chatId) {
                var stateVault = await readState(chatId);
                var vs = collectFieldValueSummary(stateVault, baselineTemplate);
                valueSummaryText = vs.text;
                valueMap = vs.map;
            }
        } catch (e) { /* skip L3 silently */ }
    }

    if (genBtn) { genBtn.disabled = true; genBtn.textContent = t('ai_generating'); }
    if (resultEl) resultEl.innerHTML = '<div class="ne-editor-section"><div class="ne-hint">' + escapeHtml(t('ai_generating')) + '</div></div>';

    var result;
    try {
        result = await runTemplateAssistant({
            mode: mode,
            baselineTemplate: baselineTemplate,
            baselineLabel: (mode === 'modify') ? ((baselineTemplate && baselineTemplate.name) || templateId || '') : baselineSel,
            fingerprint: fingerprint,
            userRequest: request,
            worldBookText: worldBookText,
            valueSummaryText: valueSummaryText,
            valueMap: valueMap,
            chatId: _aiGetChatId()
        });
    } catch (e) {
        result = { ok: false, failureKind: 'llm_error', errors: [(e && e.message) || String(e)] };
    }

    if (genBtn) { genBtn.disabled = false; genBtn.textContent = '✨ ' + t('ai_generate'); }
    if (!result.ok) {
        _aiRenderFailure(container, result);
        return;
    }
    _aiRenderResult(container, result, mode, templateId, fingerprint, baselineTemplate);
}

function _aiRenderFailure(container, result) {
    var resultEl = container.querySelector('#ne-ai-result');
    if (!resultEl) return;
    var msg = (result.failureKind === 'context_budget') ? t('ai_context_budget')
        : (result.failureKind === 'retry_exhausted') ? t('ai_retry_exhausted')
        : t('ai_draft_failed');
    var html = '<div class="ne-editor-section" style="border-left:3px solid var(--ne-warning);">';
    html += '<div class="ne-section-title">' + escapeHtml(msg) + '</div>';
    if (result.errors && result.errors.length) {
        html += '<ul class="ne-text-soft" style="margin:4px 0 0 16px;font-size:0.82em;">';
        result.errors.slice(0, 10).forEach(function (e) { html += '<li>' + escapeHtml(String(e)) + '</li>'; });
        html += '</ul>';
    }
    html += '</div>';
    resultEl.innerHTML = html;
}

function _aiRenderResult(container, result, mode, templateId, fingerprint, baselineTemplate) {
    var resultEl = container.querySelector('#ne-ai-result');
    if (!resultEl) return;
    var draft = result.draft;
    var plan = result.plan;
    var diff = plan.diff;
    var html = '';

    // Understanding
    html += '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('ai_understanding')) + '</div>';
    html += '<div style="font-size:0.85em;white-space:pre-wrap;">' + escapeHtml(draft.understanding) + '</div>';
    html += '</div>';

    // Diff
    html += '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('ai_diff_summary')) + ' — ' + escapeHtml(plan.template.name) + ' (' + escapeHtml(t('role_' + plan.template.role)) + ')</div>';
    var rows = [];
    (diff.presetAdded || []).forEach(function (f) { rows.push('<li>＋ ' + escapeHtml(t_field(f) || f) + '</li>'); });
    (diff.presetRemoved || []).forEach(function (f) { rows.push('<li>－ ' + escapeHtml(t_field(f) || f) + '</li>'); });
    (diff.customAdded || []).forEach(function (m) { rows.push('<li>＋ ' + escapeHtml(m.name) + ' <span class="ne-text-soft">' + escapeHtml(_aiFormatMeta(m)) + '</span></li>'); });
    (diff.customRemoved || []).forEach(function (n) { rows.push('<li>－ ' + escapeHtml(n) + '</li>'); });
    (diff.customModified || []).forEach(function (m) { rows.push('<li>± ' + escapeHtml(m.name) + ' <span class="ne-text-soft">' + escapeHtml(_aiFormatMeta(m.before)) + ' → ' + escapeHtml(_aiFormatMeta(m.after)) + '</span></li>'); });
    (diff.perRoundAdded || []).forEach(function (f) { rows.push('<li>＋ ' + escapeHtml(t('per_round_fields')) + ': ' + escapeHtml(t_field(f) || f) + '</li>'); });
    (diff.perRoundRemoved || []).forEach(function (f) { rows.push('<li>－ ' + escapeHtml(t('per_round_fields')) + ': ' + escapeHtml(t_field(f) || f) + '</li>'); });
    (diff.metaChanged || []).forEach(function (k) { rows.push('<li>± ' + escapeHtml(k) + '</li>'); });
    if (rows.length === 0) rows.push('<li class="ne-text-soft">—</li>');
    html += '<ul style="margin:4px 0 0 16px;font-size:0.85em;">' + rows.join('') + '</ul>';
    html += '</div>';

    // High-risk confirmations
    if (plan.highRiskItems.length > 0) {
        html += '<div class="ne-editor-section" style="border-left:3px solid var(--ne-danger,#c04444);">';
        html += '<div class="ne-section-title">' + escapeHtml(t('ai_risk_title')) + '</div>';
        plan.highRiskItems.forEach(function (r, i) {
            var kindLabel = t('ai_risk_' + ({ field_removed: 'field_removed', type_changed: 'type_changed', enum_narrowed: 'enum_narrowed', lib_update: 'lib_update' }[r.kind] || 'field_removed'));
            html += '<label class="ne-preset-field" style="display:block;margin:2px 0;">';
            html += '<input type="checkbox" class="ne-ai-risk-check" data-risk-idx="' + i + '"> ';
            html += escapeHtml(kindLabel + ': ' + r.label + (r.detail ? ' — ' + r.detail : ''));
            html += '</label>';
        });
        html += '</div>';
    }

    // Actions
    html += '<div style="display:flex;gap:8px;margin-top:8px;">';
    html += '<button id="ne-ai-apply" class="menu_button"' + (plan.highRiskItems.length > 0 ? ' disabled' : '') + '>' + escapeHtml(t('ai_apply')) + '</button>';
    html += '<button id="ne-ai-cancel" class="ne-btn-small">' + escapeHtml(t('ai_cancel')) + '</button>';
    html += '</div>';
    resultEl.innerHTML = html;

    // Risk checkboxes gate the apply button
    var applyBtn = resultEl.querySelector('#ne-ai-apply');
    var riskChecks = resultEl.querySelectorAll('.ne-ai-risk-check');
    for (var rc = 0; rc < riskChecks.length; rc++) {
        riskChecks[rc].addEventListener('change', function () {
            var all = true;
            var boxes = resultEl.querySelectorAll('.ne-ai-risk-check');
            for (var b = 0; b < boxes.length; b++) { if (!boxes[b].checked) { all = false; break; } }
            if (applyBtn) applyBtn.disabled = !all;
        });
    }
    var cancelBtn = resultEl.querySelector('#ne-ai-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { resultEl.innerHTML = ''; });

    if (applyBtn) {
        applyBtn.addEventListener('click', function () {
            // Fingerprint re-check: template must not have changed during review
            if (mode === 'modify' && templateId && baselineTemplate && !baselineTemplate.system) {
                var current = getTemplate(templateId);
                if (!current || buildTemplateFingerprint(current) !== fingerprint) {
                    showToast(t('ai_fingerprint_changed'), 'warn', 4000);
                    return;
                }
            }
            applyAssistantPlan(plan);
            showToast(t('ai_apply_ok'), 'success', 3000);
            renderTemplatesIntoSlide(container);
        });
    }
}

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
        html += '<div class="ne-text-soft" style="margin-top:8px;font-size:0.85em;">' + escapeHtml(t('create_first_hint') || 'Create a template in the Template Library first.') + '</div>';
        html += '</div>';
    } else {
        available.forEach(function (id) {
            var tpl = templates[id];
            html += '<label class="ne-preset-field">' +
                '<input type="radio" name="ne-template-select" value="' + escapeHtml(id) + '"> ' +
                escapeHtml(tpl.name || id) +
                (tpl.description ? ' <span class="ne-text-soft" style="font-size:0.85em;">' + escapeHtml(tpl.description.substring(0, 60)) + '</span>' : '') +
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
            _state: dt._state || 'synced'
        };
    } else {
        tpl = templateId ? templates[templateId] : null;
    }
    if (!tpl && !isNew) return;

    var html = '<div class="ne-template-editor" id="ne-template-editor">';
    // P6: Breadcrumb navigation
    html += '<div class="ne-breadcrumb" style="display:flex;align-items:center;gap:4px;margin-bottom:8px;font-size:0.82em;">';
    if (isCardLevel) {
        html += '<span class="ne-breadcrumb-link ne-text-info" id="ne-editor-bc-library" style="cursor:pointer;">' + escapeHtml(t('dialogue_config')) + '</span>';
    } else {
        html += '<span class="ne-breadcrumb-link ne-text-info" id="ne-editor-bc-library" style="cursor:pointer;">' + escapeHtml(t('breadcrumb_library')) + '</span>';
    }
    html += '<span class="ne-text-soft"> \u203a </span>';
    html += '<span class="ne-text-soft">' + (isNew ? escapeHtml(t('breadcrumb_new')) : escapeHtml(t('breadcrumb_edit'))) + '</span>';
    if (!isNew && tpl.name) {
        html += '<span class="ne-text-soft"> \u203a </span>';
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
        html += '<div class="ne-text-soft" style="font-size:0.8em;margin-top:4px;">' + escapeHtml(t('card_version_edit_hint') || 'Editing card-level fields only. Metadata is read-only.') + '</div>';
    }
    html += '</div>';

    // Preset fields
    html += '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('preset_fields')) + '</div>';
    var existingPresets = (tpl.presetFields && Array.isArray(tpl.presetFields)) ? tpl.presetFields : [];
    var role = tpl.role || 'npc';
    var allowedCats = ROLE_CATEGORY_MAP[role] || ROLE_CATEGORY_MAP.npc;
    var _renderedVals = {};
    Object.keys(PRESET_FIELDS).forEach(function (cat) {
        if (allowedCats.indexOf(cat) === -1) return;
        html += '<div class="ne-preset-category">';
        html += '<div class="ne-npc-category-title">' + escapeHtml(cat) + '</div>';
        Object.keys(PRESET_FIELDS[cat]).forEach(function (fn) {
            _renderedVals[fn] = true;
            var checked = existingPresets.indexOf(fn) !== -1;
            html += '<label class="ne-preset-field">' +
                '<input type="checkbox" class="ne-preset-checkbox" value="' + escapeHtml(fn) + '"' + (checked ? ' checked' : '') + '> ' +
                escapeHtml(t_field(fn)) + ' (' + escapeHtml(PRESET_FIELDS[cat][fn].type) + ')' +
                '</label>';
        });
        html += '</div>';
    });
    // 类别外/已下架字段保真：模板持有但当前 role 类别未渲染的字段必须可见，
    // 否则"进入编辑后字段数变少"且保存时静默丢失（模板卡显示 12 字段、编辑器只渲染部分）
    var _otherFields = existingPresets.filter(function (fn) { return !_renderedVals[fn]; });
    if (_otherFields.length > 0) {
        html += '<div class="ne-preset-category">';
        html += '<div class="ne-npc-category-title">' + escapeHtml(t('other_preset_fields')) + '</div>';
        _otherFields.forEach(function (fn) {
            var fd = (ALL_PREDEFINED_FIELDS && ALL_PREDEFINED_FIELDS[fn]) || getFieldFromLibrary(fn) || null;
            html += '<label class="ne-preset-field">' +
                '<input type="checkbox" class="ne-preset-checkbox" value="' + escapeHtml(fn) + '" checked> ' +
                escapeHtml(t_field(fn) || fn) + ' (' + escapeHtml((fd && fd.type) || 'string') + ')' +
                '</label>';
        });
        html += '</div>';
    }
    html += '</div>';

    // Custom fields
    html += '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('custom_fields')) + '</div>';
    var customFields = (tpl.customFieldRefs && Array.isArray(tpl.customFieldRefs)) ? tpl.customFieldRefs : [];
    html += '<div id="ne-editor-custom-fields">';
    customFields.forEach(function (fn) {
        var libEntry = getFieldFromLibrary(fn);
        var typeLabel = libEntry ? libEntry.type : 'string';
        html += '<div class="ne-custom-field-item">' +
            '<span>' + escapeHtml(fn) + '</span>' +
            '<span class="ne-custom-field-type">' + escapeHtml(typeLabel) + '</span>' +
            '<button class="ne-btn-small ne-btn-danger" data-remove-custom="' + escapeHtml(fn) + '">\u2715</button>' +
            '</div>';
    });
    html += '</div>';
    html += '<div class="ne-custom-field-add">';
    html += '<input type="text" id="ne-editor-add-custom" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_name')) + '" style="flex:1;min-width:80px">';
    html += '<select id="ne-editor-custom-type" class="ne-editor-select" style="width:auto">';
    html += '<option value="string">string</option>';
    html += '<option value="number">number</option>';
    html += '<option value="enum">enum</option>';
    html += '<option value="boolean">boolean</option>';
    html += '</select>';
    html += '<input type="number" id="ne-editor-custom-maxlen" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_maxlen')) + '" value="200" style="width:70px">';
    html += '<button id="ne-editor-add-custom-btn" class="menu_button" style="width:auto;padding:4px 8px">+</button>';
    html += '</div>';
    html += '<div id="ne-editor-custom-enum-row" style="display:none;margin-top:4px">';
    html += '<input type="text" id="ne-editor-custom-enum-values" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_enum_values')) + '">';
    html += '</div>';
    html += '<div id="ne-editor-custom-num-row" style="display:none;margin-top:4px;gap:6px">';
    html += '<input type="number" id="ne-editor-custom-min" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_min')) + '" style="width:70px">';
    html += '<input type="number" id="ne-editor-custom-max" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_max')) + '" style="width:70px">';
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

    // 单一副本模型：无版本历史 UI（版本链已删除）

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
            html += '<span class="ne-text-info" style="font-size:0.85em;">' + escapeHtml(t('in_use')) + ': ' + inUseCount + '</span>';
            if (usedNames.length <= 3) {
                html += ' <span class="ne-text-soft" style="font-size:0.78em;">(' + usedNames.map(escapeHtml).join(', ') + ')</span>';
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
    var isEditingSystem = !isNew && !isCardLevel && !!(tpl.system);
    html += '<div class="ne-editor-actions">';
    if (isEditingSystem) {
        html += '<button id="ne-editor-save" class="menu_button" data-system-copy="1">' + escapeHtml(t('copy_and_save')) + '</button>';
    } else {
        html += '<button id="ne-editor-save" class="menu_button">' + escapeHtml(t('Save')) + '</button>';
    }
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
    var addCustomBtn = container.querySelector('#ne-editor-add-custom-btn');
    if (addCustomBtn) {
        addCustomBtn.addEventListener('click', function () {
            _addCustomFieldToEditor(container);
        });
    }
    var customTypeSelect = container.querySelector('#ne-editor-custom-type');
    if (customTypeSelect) {
        customTypeSelect.addEventListener('change', function () {
            var enumRow = container.querySelector('#ne-editor-custom-enum-row');
            var numRow = container.querySelector('#ne-editor-custom-num-row');
            var maxlenInput = container.querySelector('#ne-editor-custom-maxlen');
            if (enumRow) enumRow.style.display = (this.value === 'enum') ? '' : 'none';
            if (numRow) numRow.style.display = (this.value === 'number') ? 'flex' : 'none';
            if (maxlenInput) maxlenInput.style.display = (this.value === 'string' || this.value === 'enum') ? '' : 'none';
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

    // 单一副本模型：无回滚 / 历史副本折叠 / 删除副本按钮（版本链已删除）

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

function _saveCardLevelEditor(container, charName, cardDtKey, cardConfig, templates, order) {
    // Read preset fields from checkboxes
    var presetFields = [];
    var checkboxes = container.querySelectorAll('.ne-preset-checkbox:checked');
    for (var i = 0; i < checkboxes.length; i++) {
        presetFields.push(checkboxes[i].value);
    }
    // Read custom fields
    var customFieldRefs = [];
    var customItems = container.querySelectorAll('.ne-custom-field-item > span:first-child');
    for (var j = 0; j < customItems.length; j++) {
        customFieldRefs.push(customItems[j].textContent);
    }

    // Use editTemplateInCard to create new immutable version
    var newKey = editTemplateInCard(charName, cardDtKey, presetFields, customFieldRefs);
    if (newKey) {
        // 维护字段库引用追踪
        var cardCfg = loadCardConfigSync(charName);
        var oldDt = cardCfg && cardCfg._dialogueTemplates ? cardCfg._dialogueTemplates[cardDtKey] : null;
        var oldCustomRefs = oldDt ? (oldDt.customFieldRefs || []) : [];
        var refId = newKey;
        customFieldRefs.forEach(function(fn) {
            if (oldCustomRefs.indexOf(fn) === -1) addTemplateRefToField(fn, refId);
        });
        oldCustomRefs.forEach(function(fn) {
            if (customFieldRefs.indexOf(fn) === -1) removeTemplateRefFromField(fn, cardDtKey);
        });
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
    var saveBtn = container.querySelector('#ne-editor-save');
    var isSystemCopy = saveBtn && saveBtn.getAttribute('data-system-copy') === '1';

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
    var customItems = container.querySelectorAll('.ne-custom-field-item > span:first-child');
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

    // System template copy: always create new ID, mark as non-system
    var effectiveIsNew = isNew || isSystemCopy;
    var effectiveId = effectiveIsNew ? ('tpl_' + Date.now()) : templateId;

    var template = {
        id: effectiveId,
        name: nameEl.value.trim(),
        role: roleVal,
        description: descEl ? descEl.value.trim() : '',
        presetFields: presetFields,
        customFieldRefs: customFieldRefs,
        perRoundFields: (roleVal === 'pc' || roleVal === 'npc') ? perRoundFields : undefined,
        tags: tags,
        _locked: isLocked,
        source: 'user_created',
        system: false,
        createdAt: effectiveIsNew ? new Date().toISOString() : (templates[templateId] ? templates[templateId].createdAt : new Date().toISOString()),
        updatedAt: new Date().toISOString()
    };

    saveTemplate(template);

    // 维护字段库引用追踪
    var oldCustomRefs = (!effectiveIsNew && templates[templateId]) ? (templates[templateId].customFieldRefs || []) : [];
    customFieldRefs.forEach(function(fn) {
        if (oldCustomRefs.indexOf(fn) === -1) addTemplateRefToField(fn, effectiveId);
    });
    oldCustomRefs.forEach(function(fn) {
        if (customFieldRefs.indexOf(fn) === -1) removeTemplateRefFromField(fn, effectiveId);
    });

    if (isSystemCopy) {
        showToast(t('template_copied'), 'success', 3000);
    } else {
        showToast(t('template_saved'), 'success', 3000);
    }
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
    var existing = listEl.querySelectorAll('.ne-custom-field-item > span:first-child');
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].textContent === fieldName) return;
    }

    // 读取类型和约束
    var typeSelect = container.querySelector('#ne-editor-custom-type');
    var fieldType = typeSelect ? typeSelect.value : 'string';
    var entry = { name: fieldName, type: fieldType, description: '', usedByTemplates: [] };

    if (fieldType === 'string' || fieldType === 'enum') {
        var maxlenInput = container.querySelector('#ne-editor-custom-maxlen');
        if (maxlenInput && maxlenInput.value) entry.max_length = parseInt(maxlenInput.value, 10) || 200;
    }
    if (fieldType === 'enum') {
        var enumInput = container.querySelector('#ne-editor-custom-enum-values');
        var enumRaw = enumInput && enumInput.value ? enumInput.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
        if (enumRaw.length > 0) entry.values = enumRaw;
    }
    if (fieldType === 'number') {
        var minInput = container.querySelector('#ne-editor-custom-min');
        var maxInput = container.querySelector('#ne-editor-custom-max');
        if (minInput && minInput.value !== '') entry.min = parseFloat(minInput.value);
        if (maxInput && maxInput.value !== '') entry.max = parseFloat(maxInput.value);
    }

    // 写入字段库
    addFieldToLibrary(fieldName, entry);

    var item = pdCreate('div');
    item.className = 'ne-custom-field-item';
    item.innerHTML = '<span>' + escapeHtml(fieldName) + '</span>' +
        '<span class="ne-custom-field-type">' + escapeHtml(fieldType) + '</span>' +
        '<button class="ne-btn-small ne-btn-danger" data-remove-custom="' + escapeHtml(fieldName) + '">\u2715</button>';
    item.querySelector('[data-remove-custom]').addEventListener('click', function() {
        item.remove();
    });
    listEl.appendChild(item);
    input.value = '';
    // 重置约束输入
    if (typeSelect) typeSelect.value = 'string';
    var enumRow = container.querySelector('#ne-editor-custom-enum-row');
    var numRow = container.querySelector('#ne-editor-custom-num-row');
    var maxlenInput2 = container.querySelector('#ne-editor-custom-maxlen');
    if (enumRow) enumRow.style.display = 'none';
    if (numRow) numRow.style.display = 'none';
    if (maxlenInput2) { maxlenInput2.value = '200'; maxlenInput2.style.display = ''; }
    showToast(t('custom_field_added'), 'success', 2000);
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
            renderTemplatesIntoSlide(container || panelById('ne-page-content'));
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
        saveTemplate(newTpl);
        showToast(t('template_saved'), 'success', 3000);
        renderTemplatesIntoSlide(container || panelById('ne-page-content'));
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
    var pool = cardConfig._templateConfig.quest || [];
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
    var container = panelById('ne-page-content');
    if (container) renderTemplatesIntoSlide(container);
}
