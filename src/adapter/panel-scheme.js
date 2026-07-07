/**
 * panel-scheme.js — Template Library Panel
 *
 * #14 (scheme list), #15 (scheme editor / version history),
 * #16 (scheme search/scan), #17 (init/landing page routing)
 *
 * Skeleton implementation — full UI rendering in Phase 6.
 */

import { loadTemplateLibrary, saveTemplate, deleteTemplate, getTemplate } from '../core/vault/store.js';
import { PD } from './panel-shared.js';

var _currentTab = 'library';

/**
 * Render the template library panel (main entry point).
 * @param {HTMLElement} container
 */
export function renderTemplateLibrary(container) {
    if (!container) return;
    container.innerHTML = _buildLibraryHTML();
    _hookLibraryEvents(container);
}

/**
 * Render template detail (version history, presetFields, customFieldRefs).
 * @param {HTMLElement} container
 * @param {string} templateId
 */
export function renderTemplateDetail(container, templateId) {
    var tpl = getTemplate(templateId);
    if (!container) return;
    container.innerHTML = _buildDetailHTML(tpl);
}

/**
 * Render the scheme scan result (world book → template suggestions).
 * @param {HTMLElement} container
 * @param {Object[]} suggestions
 */
export function renderSchemeScan(container, suggestions) {
    if (!container) return;
    container.innerHTML = '<div class="ne-scheme-scan"><h3>Scheme Suggestions</h3>' +
        (suggestions && suggestions.length > 0
            ? suggestions.map(function(s) { return '<div class="ne-scan-item">' + (s.name || '') + '</div>'; }).join('')
            : '<p>No scheme suggestions found. Add a World Book for richer schemes.</p>') +
        '</div>';
}

function _buildLibraryHTML() {
    var lib = loadTemplateLibrary();
    var count = lib.templates ? Object.keys(lib.templates).length : 0;
    return '<div class="ne-template-library">' +
        '<div class="ne-toolbar"><h3>Template Library (' + count + ')</h3></div>' +
        '<div class="ne-template-list" id="ne-template-list"></div>' +
        '<div class="ne-template-actions">' +
        '<button class="ne-btn" id="ne-btn-scan-schemes">Scan World Book</button>' +
        '</div></div>';
}

function _buildDetailHTML(tpl) {
    if (!tpl) return '<div class="ne-empty">Template not found.</div>';
    return '<div class="ne-template-detail">' +
        '<h3>' + (tpl.name || tpl.id) + '</h3>' +
        '<p class="ne-meta">role: ' + (tpl.role || 'npc') + ' | source: ' + (tpl.source || 'unknown') + '</p>' +
        '<div class="ne-field-list">Preset fields: ' + (tpl.presetFields || []).join(', ') + '</div>' +
        '<div class="ne-field-list">Custom fields: ' + (tpl.customFieldRefs || []).join(', ') + '</div>' +
        '</div>';
}

function _hookLibraryEvents(container) {
    var scanBtn = container.querySelector('#ne-btn-scan-schemes');
    if (scanBtn) {
        scanBtn.addEventListener('click', function() {
            PD.notify('info', 'Scheme scanning will be available in the next update.');
        });
    }
}
