/**
 * panel-templates.js — Template Library Slide-in Panel
 *
 * Renders into the slide-in panel (📋 pin row icon):
 *   1. Template config panel (PC slot / NPC pool / Mode / World context)
 *   2. Template library browser (PC/NPC split)
 *   3. Template editor / detail view (with version history)
 *
 * Replaces panel-scheme.js — full implementation for Phase 6.
 */

import { loadTemplateLibrary, saveTemplateLibrary, saveTemplate, deleteTemplate, getTemplate,
  loadCardConfig, saveCardConfig, loadCardConfigSync } from '../core/vault/store.js';
import { PRESET_FIELDS, ALL_PREDEFINED_FIELDS, DEFAULT_CHARACTER_SCHEMA } from '../core/vault/schema.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { PD, pdCreate, panelById, t, showToast, showConfirm, busEmit, openSlidePanel, closeSlidePanel } from './panel-shared.js';

// ── Slide-in root state ──
var _lastRenderTick = 0;
var _renderTicket = 0;

/** Get current SillyTavern character name for card config key */
function _getCurrentCharName() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.name2) return ctx.name2;
        }
    } catch (e) {}
    // Fallback: try window.__NE_CURRENT_CHAT_ID
    try {
        var fn = window.__NE_CURRENT_CHAT_ID;
        if (typeof fn === 'function') return fn();
    } catch (e) {}
    return null;
}

/**
 * Main slide-in entry point. Called by registerSlideRenderer('templates', ...).
 * Renders the full template slide: config panel + library.
 * @param {HTMLElement} container — #ne-slide-panel-content
 */
export function renderTemplatesIntoSlide(container) {
    if (!container) return;
    var ticket = ++_renderTicket;

    // Load data
    var lib = loadTemplateLibrary();
    var templates = (lib && lib.templates) ? lib.templates : {};
    var order = (lib && lib.order) ? lib.order : [];
    // Try to load card config using SillyTavern context character name
    var cardConfig = null;
    try {
        var charName = _getCurrentCharName();
        cardConfig = charName ? loadCardConfigSync(charName) : null;
    } catch (e) { /* no card config yet */ }

    if (ticket !== _renderTicket) return; // stale render

    var html = '';
    // ── Config panel ──
    html += _renderConfigPanelHTML(cardConfig, templates, order);
    // ── Template library ──
    html += _renderLibraryHTML(templates, order);

    container.innerHTML = html;

    // ── Bind events ──
    _hookLibraryEvents(container, templates, order);
    _hookConfigEvents(container, cardConfig, templates, order);

    _lastRenderTick = Date.now();
}

// ─────────────────────────────────────
// Config panel
// ─────────────────────────────────────

function _renderConfigPanelHTML(cardConfig, templates, order) {
    var cfg = cardConfig && cardConfig._templateConfig ? cardConfig._templateConfig : {};
    var pcTemplate = cfg.pc || null;
    var npcPool = (cfg.npc && Array.isArray(cfg.npc)) ? cfg.npc : [];
    var npcMode = cfg._npcTemplateMode || 'smart';
    var worldCtx = (cardConfig && cardConfig._worldContext) ? cardConfig._worldContext : null;

    var pcOptions = Object.keys(templates).filter(function (id) {
        return templates[id] && templates[id].role === 'protagonist';
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
            html += '<div class="ne-config-npc-item">' +
                '<span>' + escapeHtml(label) + '</span>' +
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

    // World Context
    html += '<div class="ne-config-field">';
    html += '<label>' + escapeHtml(t('world_context')) + '</label>';
    html += '<div id="ne-config-world-ctx" class="ne-config-world">';
    if (worldCtx) {
        var ctxText = typeof worldCtx === 'string' ? worldCtx : (worldCtx.text || JSON.stringify(worldCtx));
        var ctxTime = worldCtx.extractedAt || '';
        html += '<div class="ne-world-ctx-text">' + escapeHtml(ctxText.substring(0, 200)) + '</div>';
        if (ctxTime) html += '<div class="ne-world-ctx-meta">' + escapeHtml(t('ai_extracted')) + ' · ' + escapeHtml(ctxTime) + '</div>';
    } else {
        html += '<div class="ne-config-empty">' + escapeHtml(t('no_world_context')) + '</div>';
    }
    html += '</div></div>';

    html += '</div>'; // .ne-template-config
    return html;
}

// ─────────────────────────────────────
// Library view (PC / NPC split)
// ─────────────────────────────────────

function _renderLibraryHTML(templates, order) {
    var html = '<div class="ne-template-library" id="ne-template-library">';
    html += '<div class="ne-library-toolbar">';
    html += '<button id="ne-btn-create-template" class="menu_button">+ ' + escapeHtml(t('create_template')) + '</button>';
    html += '</div>';

    // Organize: PC templates, NPC templates by category tags
    var pcIds = [];
    var npcIds = [];
    order.forEach(function (id) {
        var tpl = templates[id];
        if (!tpl) return;
        if (tpl.role === 'protagonist') { pcIds.push(id); }
        else { npcIds.push(id); }
    });

    html += '<div class="ne-template-grid">';
    // PC Column
    html += '<div class="ne-template-col">';
    html += '<div class="ne-col-title">' + escapeHtml(t('pc_templates')) + '</div>';
    if (pcIds.length === 0) {
        html += '<div class="ne-empty-state">' + escapeHtml(t('no_templates')) + '</div>';
    } else {
        pcIds.forEach(function (id) {
            html += _renderTemplateCardHTML(templates[id], id);
        });
    }
    html += '</div>';

    // NPC Column
    html += '<div class="ne-template-col">';
    html += '<div class="ne-col-title">' + escapeHtml(t('npc_templates')) + '</div>';
    if (npcIds.length === 0) {
        html += '<div class="ne-empty-state">' + escapeHtml(t('no_templates')) + '</div>';
    } else {
        // Group by tags/category
        var byCategory = {};
        npcIds.forEach(function (id) {
            var tpl = templates[id];
            var cat = (tpl.tags && tpl.tags.length > 0) ? tpl.tags[0] : '__other__';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(id);
        });
        Object.keys(byCategory).forEach(function (cat) {
            if (cat !== '__other__') {
                html += '<div class="ne-npc-category-title">' + escapeHtml(cat) + '</div>';
            }
            byCategory[cat].forEach(function (id) {
                html += _renderTemplateCardHTML(templates[id], id);
            });
        });
    }
    html += '</div>';
    html += '</div>'; // .ne-template-grid
    html += '</div>'; // .ne-template-library
    return html;
}

function _renderTemplateCardHTML(tpl, id) {
    if (!tpl) return '';
    var name = tpl.name || id;
    var desc = tpl.description || '';
    if (desc.length > 50) desc = desc.substring(0, 50) + '...';
    var presetCount = (tpl.presetFields && Array.isArray(tpl.presetFields)) ? tpl.presetFields.length : 0;
    var customCount = (tpl.customFieldRefs && Array.isArray(tpl.customFieldRefs)) ? tpl.customFieldRefs.length : 0;
    var sourceLabel = tpl.source === 'ai_generated' ? t('ai_generated') : t('user_created');
    var created = tpl.createdAt ? formatLocalTime(tpl.createdAt) : '';
    var locked = tpl._locked ? (' \u{1F512}') : '';

    return '<div class="ne-template-card" data-template-id="' + escapeHtml(id) + '">' +
        '<div class="ne-template-card-header">' +
        '<b>' + escapeHtml(name) + '</b>' +
        '<span class="ne-template-lock">' + locked + '</span>' +
        '</div>' +
        (desc ? '<div class="ne-template-card-desc">' + escapeHtml(desc) + '</div>' : '') +
        '<div class="ne-template-card-meta">' +
        escapeHtml(presetCount) + ' ' + t('preset_fields') + ' · ' +
        escapeHtml(customCount) + ' ' + t('custom_fields') +
        ' · ' + escapeHtml(sourceLabel) +
        (created ? ' · ' + escapeHtml(created) : '') +
        '</div>' +
        '<div class="ne-template-card-actions">' +
        '<button class="ne-btn-small ne-btn-edit" data-action="edit" data-template-id="' + escapeHtml(id) + '">' + escapeHtml(t('view_edit')) + '</button>' +
        '<button class="ne-btn-small ne-btn-danger" data-action="delete" data-template-id="' + escapeHtml(id) + '">' + escapeHtml(t('Delete')) + '</button>' +
        '</div>' +
        '</div>';
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

    // Add NPC from library
    var addBtn = container.querySelector('#ne-config-add-npc');
    if (addBtn) {
        addBtn.addEventListener('click', function () {
            _showNpcSelector(templates, cardConfig);
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
}

function _hookLibraryEvents(container, templates, order) {
    // Create template
    var createBtn = container.querySelector('#ne-btn-create-template');
    if (createBtn) {
        createBtn.addEventListener('click', function () {
            _showEditor(container, null, true, templates, order);
        });
    }

    // Edit / Delete buttons
    var editBtns = container.querySelectorAll('[data-action="edit"]');
    for (var i = 0; i < editBtns.length; i++) {
        editBtns[i].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _showEditor(container, tplId, false, templates, order);
        });
    }
    var delBtns = container.querySelectorAll('[data-action="delete"]');
    for (var j = 0; j < delBtns.length; j++) {
        delBtns[j].addEventListener('click', function () {
            var tplId = this.getAttribute('data-template-id');
            _deleteTemplateConfirm(tplId, templates, order, container);
        });
    }
}

// ─────────────────────────────────────
// Template Editor
// ─────────────────────────────────────

function _showEditor(container, templateId, isNew, templates, order) {
    var tpl = isNew
        ? { name: '', role: 'npc', presetFields: [], customFieldRefs: [], tags: [], description: '', source: 'user_created' }
        : (templateId ? templates[templateId] : null);
    if (!tpl && !isNew) return;

    var html = '<div class="ne-template-editor" id="ne-template-editor">';
    html += '<button class="ne-btn-small" id="ne-editor-back">\u2190 ' + escapeHtml(t('back')) + '</button>';

    // Basic info
    html += '<div class="ne-editor-section">';
    html += '<label>' + escapeHtml(t('Name')) + '</label>';
    html += '<input type="text" id="ne-editor-name" class="ne-editor-input" value="' + escapeHtml(tpl.name || '') + '" placeholder="' + escapeHtml(t('Name')) + '">';
    html += '<label>' + escapeHtml(t('Role')) + '</label>';
    html += '<select id="ne-editor-role" class="ne-config-select">';
    html += '<option value="npc"' + (tpl.role === 'npc' || !tpl.role ? ' selected' : '') + '>NPC</option>';
    html += '<option value="protagonist"' + (tpl.role === 'protagonist' ? ' selected' : '') + '>PC</option>';
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

    // Actions
    html += '<div class="ne-editor-actions">';
    html += '<button id="ne-editor-save" class="menu_button">' + escapeHtml(t('Save')) + '</button>';
    html += '<button id="ne-editor-cancel" class="menu_button">' + escapeHtml(t('Cancel')) + '</button>';
    html += '</div>';

    html += '</div>'; // .ne-template-editor

    container.innerHTML = html;

    // Bind editor events
    var backBtn = container.querySelector('#ne-editor-back');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
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
}

function _renderVersionHistoryHTML(tpl) {
    var versions = (tpl.versions && Array.isArray(tpl.versions)) ? tpl.versions : [];
    if (versions.length === 0) return '';
    var activeVer = tpl._activeVersion || (versions.length > 0 ? versions[versions.length - 1]._versionId : null);

    var html = '<div class="ne-editor-section">';
    html += '<div class="ne-section-title">' + escapeHtml(t('version_history')) + '</div>';
    html += '<div class="ne-version-timeline">';
    versions.slice().reverse().forEach(function (ver, idx) {
        var isActive = ver._versionId === activeVer;
        var date = ver.createdAt ? formatLocalTime(ver.createdAt) : '';
        var dotClass = isActive ? 'ne-version-dot active' : 'ne-version-dot';
        html += '<div class="ne-version-item">';
        html += '<span class="' + dotClass + '"></span>';
        html += '<div class="ne-version-info">';
        html += '<span class="ne-version-date">' + escapeHtml(date) + '</span>';
        if (isActive) html += ' <span class="ne-version-badge">(' + escapeHtml(t('current')) + ')</span>';
        if (ver.added && ver.added.length) html += '<div class="ne-version-diff">+ ' + escapeHtml(ver.added.join(', ')) + '</div>';
        if (ver.removed && ver.removed.length) html += '<div class="ne-version-diff ne-diff-removed">- ' + escapeHtml(ver.removed.join(', ')) + '</div>';
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
        showToast('Name is required.', 'warn');
        return;
    }

    // Collect preset fields
    var presetFields = [];
    var checkboxes = container.querySelectorAll('.ne-preset-checkbox:checked');
    for (var c = 0; c < checkboxes.length; c++) {
        presetFields.push(checkboxes[c].value);
    }

    // Collect custom fields
    var customFieldRefs = [];
    var customItems = container.querySelectorAll('.ne-custom-field-item span');
    for (var i = 0; i < customItems.length; i++) {
        customFieldRefs.push(customItems[i].textContent);
    }

    var tags = tagsEl ? tagsEl.value.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
    var isLocked = lockEl ? lockEl.checked : false;

    var template = {
        id: isNew ? ('tpl_' + Date.now()) : templateId,
        name: nameEl.value.trim(),
        role: roleEl ? roleEl.value : 'npc',
        description: descEl ? descEl.value.trim() : '',
        presetFields: presetFields,
        customFieldRefs: customFieldRefs,
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
    var listEl = container.querySelector('#ne-editor-custom-fields');
    if (!listEl) return;
    // Check dup
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
        t('Delete'), t('Cancel'), true/*isDanger*/
    ).then(function(confirmed) {
        if (confirmed) {
            deleteTemplate(templateId);
            showToast(t('template_deleted'), 'info', 3000);
            renderTemplatesIntoSlide(container || panelById('ne-slide-panel-content'));
        }
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
    showToast('Settings saved.', 'success', 2000);
}

function _removeNpcFromPool(templateId, cardConfig) {
    if (!cardConfig || !cardConfig._templateConfig) return;
    var pool = cardConfig._templateConfig.npc;
    if (!pool || !Array.isArray(pool)) return;
    cardConfig._templateConfig.npc = pool.filter(function(e) {
        return e._templateId !== templateId;
    });
    var charName = _getCurrentCharName();
    if (charName) saveCardConfig(charName, cardConfig);
    var container = panelById('ne-slide-panel-content');
    if (container) renderTemplatesIntoSlide(container);
}

function _showNpcSelector(templates, cardConfig) {
    var npcTpls = Object.keys(templates).filter(function(id) {
        return templates[id] && templates[id].role === 'npc';
    });
    if (npcTpls.length === 0) {
        showToast(t('no_templates'), 'info');
        return;
    }

    var container = panelById('ne-slide-panel-content');
    if (!container) return;

    var html = '<div class="ne-npc-selector" id="ne-npc-selector">';
    html += '<div class="ne-section-title">' + escapeHtml(t('add_from_library')) + '</div>';
    npcTpls.forEach(function(id) {
        var tpl = templates[id];
        html += '<div class="ne-npc-select-item">' +
            '<span>' + escapeHtml(tpl.name || id) + '</span>' +
            '<button class="ne-btn-small" data-select-npc="' + escapeHtml(id) + '">+</button>' +
            '</div>';
    });
    html += '<button class="ne-btn-small" id="ne-npc-selector-cancel">' + escapeHtml(t('Cancel')) + '</button>';
    html += '</div>';

    container.innerHTML = html;

    // Bind
    var selBtns = container.querySelectorAll('[data-select-npc]');
    for (var i = 0; i < selBtns.length; i++) {
        selBtns[i].addEventListener('click', function() {
            var tplId = this.getAttribute('data-select-npc');
            _addNpcToPool(tplId, cardConfig, templates);
        });
    }
    var cancelBtn = container.querySelector('#ne-npc-selector-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            renderTemplatesIntoSlide(container);
        });
    }
}

function _addNpcToPool(templateId, cardConfig, templates) {
    if (!cardConfig) return;
    if (!cardConfig._templateConfig) cardConfig._templateConfig = {};
    if (!cardConfig._templateConfig.npc) cardConfig._templateConfig.npc = [];
    // Check duplicate
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
    var container = panelById('ne-slide-panel-content');
    if (container) renderTemplatesIntoSlide(container);
}
