import { escapeHtml } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { qs, qsa, byId, pdCreate, t } from './panel-shared.js';

var ENTITY_TYPE_ICONS = {
    character: '\uD83E\uDDD1',
    faction: '\uD83C\uDFF0',
    location: '\uD83C\uDFD9\uFE0F',
    item: '\uD83D\uDCE6',
    concept: '\uD83D\uDCA1',
    event: '\uD83C\uDF0D'
};

export function collectAllEntityNames(content) {
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    var allLTM = content.ltm_entries || [];
    var nameMap = {};
    allSTM.concat(allLTM).forEach(function(e) {
        (e.entities || []).forEach(function(en) {
            var n = typeof en === 'string' ? en : en.name;
            if (n && !nameMap[n]) {
                nameMap[n] = { name: n, type: 'character', count: 0 };
            }
            if (nameMap[n]) nameMap[n].count++;
        });
    });
    return Object.values(nameMap).sort(function(a, b) { return b.count - a.count; });
}

export function renderEntitySummaryBar(vault) {
    if (!window.__NE_DEV_MODE) return;
    var bar = byId('ne_entity_summary');
    if (!bar) return;
    var content = vault.content || {};
    var entities = collectAllEntityNames(content);
    if (entities.length === 0) { bar.style.display = 'none'; return; }
    bar.style.display = '';

    var shortCount = entities.filter(function(e) { return e.count <= 5; }).length;
    var longCount = entities.length - shortCount;

    var tagsHtml = entities.map(function(en) {
        var cls = en.count <= 5 ? 'short' : 'long';
        var label = en.count <= 5 ? 'inline' : 'avail';
        return '<span class="ne-entity-chain-tag ' + cls + '">' + escapeHtml(en.name) + ' (' + en.count + ', ' + label + ')</span>';
    }).join('');

    var summaryText = 'Entities: ' + entities.length + ' total';
    if (shortCount > 0) summaryText += ', ' + shortCount + ' short (inlined)';
    if (longCount > 0) summaryText += ', ' + longCount + ' long (available)';

    bar.innerHTML = '<details><summary>' + escapeHtml(summaryText) + '</summary><div style="padding-top:4px;">' + tagsHtml + '</div></details>';
}

export function renderEntitiesTab(vault) {
    if (!window.__NE_DEV_MODE) return;
    var listEl = byId('ne_entity_list');
    var detailEl = byId('ne_entity_chain_detail');
    if (!listEl) return;
    var content = vault.content || {};
    var entities = collectAllEntityNames(content);

    if (entities.length === 0) {
        listEl.innerHTML = '<div class="ne-empty-hint">No entities tracked yet. Entities are extracted from STM/LTM entries via the entity annotation field.</div>';
        if (detailEl) detailEl.innerHTML = '';
        return;
    }

    var allSTMLTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []).concat(content.ltm_entries || []);

    var rowsHtml = entities.map(function(en, idx) {
        var icon = ENTITY_TYPE_ICONS[en.type] || '\u2753';
        var statusCls = en.count <= 5 ? 'inline' : 'available';
        var statusLabel = en.count <= 5 ? 'inlined' : 'available';
        return '<div class="ne-entity-row" data-entity-idx="' + idx + '" data-entity-name="' + escapeHtml(en.name) + '">' +
            '<span class="ne-entity-icon">' + icon + '</span>' +
            '<span class="ne-entity-name">' + escapeHtml(en.name) + '</span>' +
            '<span class="ne-entity-type">' + escapeHtml(en.type) + '</span>' +
            '<span class="ne-entity-count">' + en.count + ' entries</span>' +
            '<span class="ne-entity-status ' + statusCls + '">' + statusLabel + '</span>' +
            '</div>';
    }).join('');

    listEl.innerHTML = rowsHtml;
    if (detailEl) detailEl.innerHTML = '';

    var rows = listEl.querySelectorAll('.ne-entity-row');
    rows.forEach(function(row) {
        row.onclick = function() {
            var wasSelected = this.classList.contains('selected');
            rows.forEach(function(r) { r.classList.remove('selected'); });
            if (detailEl) detailEl.innerHTML = '';
            if (wasSelected) return;
            this.classList.add('selected');

            var entityName = this.getAttribute('data-entity-name');
            var type = entities[Number(this.getAttribute('data-entity-idx'))].type;

            var chainEntries = [];
            allSTMLTM.forEach(function(e) {
                if (e.entities && e.entities.some(function(en) { return (typeof en === 'string' ? en : en.name) === entityName; })) {
                    chainEntries.push(e);
                }
            });
            chainEntries.sort(function(a, b) {
                return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
            });

            if (detailEl && chainEntries.length > 0) {
                var detailRows = chainEntries.map(function(e, i) {
                    var timePart = e.period || '';
                    var scenePart = e.scene || '';
                    var eventPart = e.event || e.summary || '';
                    return '<div class="ne-chain-entry">' +
                        '<span class="ne-chain-time">' + escapeHtml(timePart) + '</span>' +
                        '<span class="ne-chain-scene">' + escapeHtml(scenePart) + '</span>' +
                        '<span>' + escapeHtml(eventPart) + '</span>' +
                        '</div>';
                }).join('');
                detailEl.innerHTML = '<div class="ne-chain-detail" style="margin-top:6px;">' +
                    '<div style="font-weight:bold;margin-bottom:4px;color:var(--grey-60);">' +
                    escapeHtml(entityName) + ' (' + escapeHtml(type) + ') — ' + chainEntries.length + ' events</div>' +
                    detailRows + '</div>';
            }
        };
    });
}
