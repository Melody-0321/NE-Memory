import { write } from '../core/vault/store.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { DEFAULT_CHARACTER_SCHEMA } from '../core/vault/schema.js';
import { qs, qsa, byId, pdCreate, pdHead, t, sortLtmByMsgOrder, busEmit, panelById, panelQS, panelQSA, showConfirm } from './panel-shared.js';
import { saveSingleEntry, deleteSingleEntry, _pendingInlineStorage } from './panel-drawer.js';

var ACTIVE_STATUSES = ['活跃'];
var DEPARTED_STATUSES = ['已死亡', '已归隐', '已离去'];

function getCharacterCardType(name, state) {
    if (state && state.protagonist_name && name === state.protagonist_name) return 'protagonist';
    var schemeLookup = state && state._character_schemes && state._character_schemes[name];
    if (schemeLookup && schemeLookup._role === 'protagonist') return 'protagonist';
    if (state && state.characters && state.characters[name] && state.characters[name]._role === 'protagonist') return 'protagonist';
    return 'npc';
}

function renderCharacterCard(name, card, schema, cardType) {
    var cardSchema = (schema && schema[cardType]) ? schema[cardType] : (schema && schema.npc ? schema.npc : null);
    if (!cardSchema || !cardSchema.fields) return '';

    var rows = [];
    var requiredFields = [];
    var optionalFields = [];

    Object.keys(cardSchema.fields).forEach(function (key) {
        if (key === 'name') return;
        if (key === 'status') return; // shown in card header + grouping, redundant in body
        var fieldDef = cardSchema.fields[key];
        var val = card[key];

        // Skip empty non-required fields
        if (!fieldDef.required && (val === undefined || val === null || val === '')) return;

        var displayVal;
        if (typeof val === 'object' && val !== null) {
            try { displayVal = JSON.stringify(val); } catch (e) { displayVal = String(val); }
        } else if (val === undefined || val === null || val === '') {
            displayVal = '<span class="ne-empty-value">' + t('empty_value') + '</span>';
        } else {
            displayVal = String(val);
        }

        var dataAttrs = 'data-char="' + escapeHtml(name) + '" data-field="' + escapeHtml(key) + '" data-type="' + (fieldDef.type || 'string') + '"';
        if (fieldDef.max_length) dataAttrs += ' data-maxlen="' + fieldDef.max_length + '"';
        if (fieldDef.type === 'number') {
            if (fieldDef.min !== undefined) dataAttrs += ' data-min="' + fieldDef.min + '"';
            if (fieldDef.max !== undefined) dataAttrs += ' data-max="' + fieldDef.max + '"';
        }
        if (fieldDef.values) dataAttrs += ' data-values="' + escapeHtml(fieldDef.values.join(',')) + '"';
        var label = t_field(key);
        var row = '<tr><td class="ne-field-label">' + escapeHtml(label) + '</td><td class="ne-char-val" ' + dataAttrs + '><span class="ne-char-val-text">' + escapeHtml(displayVal).replace('&lt;span class=&quot;ne-empty-value&quot;&gt;', '<span class="ne-empty-value">').replace('&lt;/span&gt;', '</span>') + '</span></td></tr>';

        if (fieldDef.required) {
            requiredFields.push(row);
        } else {
            optionalFields.push(row);
        }
    });

    var allRows = requiredFields.concat(optionalFields);
    if (allRows.length === 0) return '';

    // Special: affection progress bar (NPC only)
    var affectionHtml = '';
    if (cardType === 'npc' && card.affection !== undefined && card.affection !== null && card.affection !== '') {
        var affVal = Number(card.affection) || 0;
        var affPercent = Math.min(100, Math.max(0, affVal));
        affectionHtml = '<div class="ne-affection-bar"><div class="ne-affection-fill" style="width:' + affPercent + '%"></div><span class="ne-affection-label">' + escapeHtml(t_field('affection')) + ': ' + affVal + '</span></div>';
    }

    // Render inventory if present
    var inventoryHtml = '';
    if (card.inventory && typeof card.inventory === 'object') {
        var invItems = [];
        Object.keys(card.inventory).forEach(function (slot) {
            invItems.push('<span class="ne-inv-slot">' + escapeHtml(slot) + ': ' + escapeHtml(String(card.inventory[slot])) + '</span>');
        });
        if (invItems.length > 0) {
            inventoryHtml = '<div class="ne-inventory-bar">' + invItems.join(' ') + '</div>';
        }
    }

    var html = '<div class="ne-char-card">';
    html += '<div class="ne-char-card-header" tabindex="0" role="button" aria-label="' + t('Toggle details') + ': ' + escapeHtml(name) + '" onclick="this.parentElement.classList.toggle(\'open\')">';
    html += '<span class="ne-char-toggle">&#9654;</span>';
    html += '<b>' + escapeHtml(name) + '</b> ';
    html += '<span class="ne-char-type ' + (cardType === 'protagonist' ? 'ne-char-type-pc' : 'ne-char-type-npc') + '">' + (cardType === 'protagonist' ? 'PC' : 'NPC') + '</span>';
    html += '<button class="ne-card-edit-btn" data-char="' + escapeHtml(name) + '" data-cardtype="' + escapeHtml(cardType) + '" aria-label="' + t('Edit') + '" onclick="event.stopPropagation()">\u270E</button>';
    html += '<button class="ne-card-delete-btn" data-char="' + escapeHtml(name) + '" aria-label="' + t('Delete') + '" onclick="event.stopPropagation()">\u2715</button>';
    html += '</div>';
    html += '<div class="ne-char-card-body"><table>' + allRows.join('') + '</table>';
    html += affectionHtml;
    html += inventoryHtml;

    // Power slots (independent rendering)
    if (card.power_slots && typeof card.power_slots === 'object') {
        var psKeys = Object.keys(card.power_slots);
        if (psKeys.length > 0) {
            html += '<div class="ne-power-slots">';
            psKeys.forEach(function (sk) {
                var sv = card.power_slots[sk];
                var svStr = (sv && typeof sv === 'object' && sv.level !== undefined) ? sv.level : (typeof sv === 'object' ? JSON.stringify(sv) : String(sv || ''));
                html += '<span class="ne-ps-slot" title="' + escapeHtml(sk) + '">' + escapeHtml(sk) + ': ' + escapeHtml(svStr) + '</span>';
            });
            html += '</div>';
        }
    }

    html += '</div></div>';
    return html;
}

function renderCharacterGroup(label, names, characters, schema, state) {
    if (names.length === 0) return '';
    var protoName = (state && state.protagonist_name) || '';
    var sorted = names.slice();
    if (protoName && sorted.indexOf(protoName) !== -1) {
        sorted = sorted.filter(function(n) { return n !== protoName; });
        sorted.unshift(protoName);
    }
    var activeLabels = [t('活跃'), 'Active', '活跃'];
    var departedLabels = [t('已退场'), 'Departed', '已退场'];
    var headerColor = activeLabels.indexOf(label) !== -1 ? 'var(--ne-success)' : (departedLabels.indexOf(label) !== -1 ? 'var(--ne-danger)' : 'var(--ne-warning)');

    var html = '<details class="ne_character_group" open style="margin:6px 0;">' +
        '<summary style="font-weight:bold;font-size:0.9em;color:' + headerColor + ';cursor:pointer;padding:3px 0;border-bottom:1px solid var(--black30a);">' +
        t(label) + ' (' + names.length + ')</summary>' +
        '<div style="padding-top:2px;">';

    sorted.forEach(function (name) {
        var card = characters[name];
        var cardType = getCharacterCardType(name, state);
        html += renderCharacterCard(name, card, schema, cardType);
    });

    html += '</div></details>';
    return html;
}

export function getCharacterSchemaForPanel(content) {
    return content.character_schema || DEFAULT_CHARACTER_SCHEMA;
}

export function renderCharacterPanelHTML(state, characterSchema) {
    var characters = (state && state.characters) ? state.characters : {};
    var schema = characterSchema || DEFAULT_CHARACTER_SCHEMA;
    var names = Object.keys(characters);
    if (names.length === 0) return '';

    var activeNames = [];
    var inactiveNames = [];
    var departedNames = [];

    names.forEach(function (name) {
        var card = characters[name];
        var status = (card && card.status) ? card.status : '未知';
        if (ACTIVE_STATUSES.indexOf(status) !== -1) {
            activeNames.push(name);
        } else if (DEPARTED_STATUSES.indexOf(status) !== -1) {
            departedNames.push(name);
        } else {
            inactiveNames.push(name);
        }
    });

    var html = '<div class="narrative_character_block" style="margin-bottom:14px;">' +
        '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Characters') + '</div>';

    html += renderCharacterGroup('活跃', activeNames, characters, schema, state);
    html += renderCharacterGroup('非活跃', inactiveNames, characters, schema, state);
    html += renderCharacterGroup('已退场', departedNames, characters, schema, state);

    html += '</div>';
    return html;
}

function renderFactionCard(name, faction) {
    var attitude = faction.attitude_toward_player || '未知';
    var friendlyLabels = ['友好', 'Friendly'];
    var hostileLabels = ['敌对', 'Hostile'];
    var attitudeCls = friendlyLabels.indexOf(attitude) !== -1 ? 'friendly' : (hostileLabels.indexOf(attitude) !== -1 ? 'hostile' : 'neutral');
    var isHidden = !!faction._hidden;
    var cardCls = isHidden ? ' ne-faction-hidden' : '';

    var summaryRows = [];
    if (faction.name) summaryRows.push('<tr><td>' + t_field('name') + '</td><td>' + escapeHtml(String(faction.name).substring(0, 20)) + '</td></tr>');
    summaryRows.push('<tr><td>' + t_field('attitude_toward_player') + '</td><td><span class="ne-state-badge ' + attitudeCls + '">' + escapeHtml(attitude) + '</span></td></tr>');

    var detailLines = [];
    if (faction.description) detailLines.push('<div style="margin:2px 0;">' + t_field('description') + ': ' + escapeHtml(String(faction.description)) + '</div>');
    if (faction.leader) detailLines.push('<div style="margin:2px 0;">' + t_field('leader') + ': ' + escapeHtml(String(faction.leader)) + '</div>');
    if (faction.notes) detailLines.push('<div style="margin:2px 0;">' + t_field('notes') + ': ' + escapeHtml(String(faction.notes)) + '</div>');

    var relations = faction.relations;
    if (relations && typeof relations === 'object') {
        var relKeys = Object.keys(relations);
        if (relKeys.length > 0) {
            var relHtml = '<div style="margin-top:4px;font-size:0.83em;color:#e2b714;">' + t('Relations') + ':</div>';
            relKeys.forEach(function (target) {
                relHtml += '<div style="margin:1px 0 1px 8px;font-size:0.83em;">' + escapeHtml(target) + ': ' + escapeHtml(String(relations[target])) + '</div>';
            });
            detailLines.push(relHtml);
        }
    }

    var hasDetail = detailLines.length > 0;
    var hiddenBadge = isHidden ? '<span style="margin-left:6px;font-size:0.75em;color:#888;border:1px solid #555;border-radius:3px;padding:0 4px;">' + t('hidden_faction') + '</span>' : '';
    var html = `
<div class="ne-faction-card attitude-${attitudeCls}${cardCls}" data-faction="${escapeHtml(name)}">
  <div class="ne-faction-card-header"
       tabindex="0" role="button" aria-label="${t('Toggle details')}: ${escapeHtml(name)}"
       onclick="this.parentElement.classList.toggle('open')">
    <span class="ne-faction-toggle">▶</span>
    <b>${escapeHtml(name)}</b>${hiddenBadge}
    <span class="ne-state-badge ${attitudeCls}">${escapeHtml(attitude)}</span>
  </div>
  <div class="ne-faction-card-body">
    <table class="ne-state-card-table">${summaryRows.join('')}</table>
    ${hasDetail ? '<div class="ne-faction-card-detail">' + detailLines.join('') + '</div>' : ''}
  </div>
</div>`;

    return html;
}

export function renderFactionPanelHTML(state) {
    if (!state || !state.factions) return '';
    var factions = state.factions;
    var names = Object.keys(factions);
    if (names.length === 0) return '';

    var html = '<div class="narrative_faction_block" style="margin-bottom:14px;">' +
        '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Factions') + '</div>';

    names.forEach(function (name) {
        var faction = factions[name];
        if (!faction || typeof faction !== 'object') return;
        html += renderFactionCard(name, faction);
    });

    html += '</div>';
    return html;
}

function renderQuestCard(key, entry, sectionType) {
    var statusLabel = entry.status || '未知';

    var statusColors = { '已完成': 'var(--ne-success)', '已达成': 'var(--ne-success)', '已失败': 'var(--ne-danger)', '已过期': 'var(--ne-warning)', '正在进行': 'var(--ne-info)', '进行中': 'var(--ne-info)', '已放弃': 'var(--ne-muted)', '持续中': 'var(--ne-warning)', '已平息': 'var(--ne-success)', '已结束': 'var(--ne-muted)' };
    var statusColor = statusColors[statusLabel] || 'var(--ne-muted)';

    var iconMap = {
        task: { open: '\u25CB', closed: '\u2714' },
        goal: { open: '\u2192', closed: '\u2714' },
        event: { open: '\u25B2', closed: '\u2714' }
    };
    var icons = iconMap[sectionType] || iconMap.task;
    var isCompleted = statusLabel === '已完成' || statusLabel === '已达成' || statusLabel === '已放弃' || statusLabel === '已失败' || statusLabel === '已过期' || statusLabel === '已平息' || statusLabel === '已结束';
    var statusCls;
    if (isCompleted) {
        statusCls = (statusLabel === '已失败') ? 'failed' : ((statusLabel === '已过期' || statusLabel === '已放弃') ? 'expired' : 'done');
    } else {
        statusCls = 'progress';
    }
    var iconChar = isCompleted ? icons.closed : icons.open;
    var iconColor = isCompleted ? 'var(--ne-success)' : 'var(--ne-muted)';

    var displayName = entry.name || key;
    var deadlineOrStatus = '';
    if (sectionType === 'task' && entry.deadline) {
        deadlineOrStatus = entry.deadline;
    }
    var statusText = sectionType === 'task' ? (entry.deadline || statusLabel) : statusLabel;

    var detailLines = [];
    if (sectionType === 'task') {
        if (entry.type) detailLines.push('<div style="margin:2px 0;">' + t_field('type') + ': ' + escapeHtml(String(entry.type)) + '</div>');
        if (entry.issuer) detailLines.push('<div style="margin:2px 0;">' + t_field('issuer') + ': ' + escapeHtml(String(entry.issuer)) + '</div>');
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">' + t_field('desc') + ': ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.progress) detailLines.push('<div style="margin:2px 0;color:#e2b714;">' + t_field('progress') + ': ' + escapeHtml(String(entry.progress)) + '</div>');
        if (entry.posted_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">' + t_field('posted_time') + ': ' + escapeHtml(String(entry.posted_time)) + '</div>');
        if (entry.reward) detailLines.push('<div style="margin:2px 0;color:var(--ne-success);">' + t_field('reward') + ': ' + escapeHtml(String(entry.reward)) + '</div>');
        if (entry.penalty) detailLines.push('<div style="margin:2px 0;color:var(--ne-danger);">' + t_field('penalty') + ': ' + escapeHtml(String(entry.penalty)) + '</div>');
    } else if (sectionType === 'goal') {
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">' + t_field('desc') + ': ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.progress) detailLines.push('<div style="margin:2px 0;color:#e2b714;">' + t_field('progress') + ': ' + escapeHtml(String(entry.progress)) + '</div>');
        if (entry.posted_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">' + t_field('posted_time') + ': ' + escapeHtml(String(entry.posted_time)) + '</div>');
        if (entry.completed_time) detailLines.push('<div style="margin:2px 0;color:var(--ne-success);">' + t_field('completed_time') + ': ' + escapeHtml(String(entry.completed_time)) + '</div>');
    } else if (sectionType === 'event') {
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">' + t_field('desc') + ': ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.started_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">' + t_field('started_time') + ': ' + escapeHtml(String(entry.started_time)) + '</div>');
        if (entry.ended_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">' + t_field('ended_time') + ': ' + escapeHtml(String(entry.ended_time)) + '</div>');
    }

    var html = `
<div class="ne-quest-card status-${statusCls}">
  <div class="ne-quest-header"
       tabindex="0" role="button" aria-label="${t('Toggle details')}: ${escapeHtml(displayName)}"
       onclick="this.parentElement.classList.toggle('open')">
    <span class="ne-quest-toggle">▶</span>
    <span style="color:${iconColor};">${iconChar}</span>
    <b>${escapeHtml(displayName)}</b>
    <span class="ne-state-badge" style="color:${statusColor};border-color:${statusColor};">${escapeHtml(statusText)}</span>
  </div>
  <div class="ne-quest-detail">
    ${detailLines.join('')}
  </div>
</div>`;

    return html;
}

export function renderQuestPanelHTML(state) {
    if (!state || !state.quests) return '';
    var quests = state.quests;

    var sectionsHtml = '';

    // Tasks
    if (quests.tasks && typeof quests.tasks === 'object' && Object.keys(quests.tasks).length > 0) {
        var taskHtml = '<div class="ne_quest_subsection" style="margin:8px 0;">' +
            '<div style="font-weight:bold;font-size:0.9em;color:var(--ne-info);padding:3px 0;border-bottom:1px solid var(--black30a);">\u25CB ' + t('Tasks') + '</div>';
        Object.keys(quests.tasks).forEach(function (key) {
            taskHtml += renderQuestCard(key, quests.tasks[key], 'task');
        });
        taskHtml += '</div>';
        sectionsHtml += taskHtml;
    }

    // Goals
    if (quests.goals && typeof quests.goals === 'object' && Object.keys(quests.goals).length > 0) {
        var goalHtml = '<div class="ne_quest_subsection" style="margin:8px 0;">' +
            '<div style="font-weight:bold;font-size:0.9em;color:#e2b714;padding:3px 0;border-bottom:1px solid var(--black30a);">\u2192 ' + t('Goals') + '</div>';
        Object.keys(quests.goals).forEach(function (key) {
            goalHtml += renderQuestCard(key, quests.goals[key], 'goal');
        });
        goalHtml += '</div>';
        sectionsHtml += goalHtml;
    }

    // Events
    if (quests.events && typeof quests.events === 'object' && Object.keys(quests.events).length > 0) {
        var eventHtml = '<div class="ne_quest_subsection" style="margin:8px 0;">' +
            '<div style="font-weight:bold;font-size:0.9em;color:var(--ne-warning);padding:3px 0;border-bottom:1px solid var(--black30a);">\u25B2 ' + t('World Events') + '</div>';
        Object.keys(quests.events).forEach(function (key) {
            eventHtml += renderQuestCard(key, quests.events[key], 'event');
        });
        eventHtml += '</div>';
        sectionsHtml += eventHtml;
    }

    if (!sectionsHtml) return '';

    return '<div class="narrative_quest_block" style="margin-bottom:14px;">' +
        '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Quests') + '</div>' +
        sectionsHtml +
        '</div>';
}

export function enterCardEditMode(editBtn) {
    var cardDiv = editBtn.closest('.ne-char-card');
    if (!cardDiv || cardDiv.classList.contains('ne-card-editing')) return;

    cardDiv.classList.add('ne-card-editing');
    cardDiv._neOrigEditBtnHTML = editBtn.outerHTML;

    var body = cardDiv.querySelector('.ne-char-card-body');
    if (!body) return;

    var table = body.querySelector('table');
    if (table) cardDiv._neOrigTableHTML = table.outerHTML;

    var vals = cardDiv.querySelectorAll('.ne-char-val');
    vals.forEach(function(td) {
        var fieldType = td.getAttribute('data-type') || 'string';
        var span = td.querySelector('.ne-char-val-text');
        var textVal = span ? (span.textContent || '').trim() : '';
        if (textVal === t('empty_value') || textVal === '(Not filled)') textVal = '';

        var editor;
        switch (fieldType) {
            case 'enum':
                var values = (td.getAttribute('data-values') || '').split(',');
                editor = '<select class="ne-char-edit">';
                values.forEach(function(v) {
                    var vv = v.trim();
                    var sel = (textVal === vv) ? ' selected' : '';
                    editor += '<option value="' + escapeHtml(vv) + '"' + sel + '>' + escapeHtml(vv) + '</option>';
                });
                editor += '</select>';
                break;
            case 'number':
                var min = td.getAttribute('data-min');
                var max = td.getAttribute('data-max');
                editor = '<input class="ne-char-edit" type="number" value="' + escapeHtml(textVal) + '"' +
                    (min ? ' min="' + min + '"' : '') +
                    (max ? ' max="' + max + '"' : '') + '>';
                break;
            default:
                var maxlen = td.getAttribute('data-maxlen');
                editor = '<input class="ne-char-edit" type="text" value="' + escapeHtml(textVal) + '"' +
                    (maxlen ? ' maxlength="' + maxlen + '"' : '') + '>';
        }
        span.outerHTML = editor;
    });

    editBtn.outerHTML =
        '<button class="ne-card-save-btn">' + t('Save') + '</button>' +
        '<button class="ne-card-cancel-btn">' + t('Cancel') + '</button>';

    var saveBtn = cardDiv.querySelector('.ne-card-save-btn');
    if (saveBtn) saveBtn.onclick = function(e) { e.stopPropagation(); saveCardFields(cardDiv); };

    var cancelBtn = cardDiv.querySelector('.ne-card-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = function(e) { e.stopPropagation(); exitCardEditMode(cardDiv); };
}

function saveCardFields(cardDiv) {
    var stored = _pendingInlineStorage;
    if (!stored || !stored.vault) return;
    var vault = stored.vault;
    var c = vault.content || {};
    var state = c.state || {};
    var chars = state.characters || {};

    var vals = cardDiv.querySelectorAll('.ne-char-val');
    var hasChanges = false;
    vals.forEach(function(td) {
        var charName = td.getAttribute('data-char');
        var fieldName = td.getAttribute('data-field');
        var fieldType = td.getAttribute('data-type') || 'string';
        var input = td.querySelector('.ne-char-edit');
        if (!charName || !fieldName || !input) return;

        var rawVal = input.value.trim();
        var newVal;
        if (fieldType === 'number') {
            newVal = rawVal === '' ? null : Number(rawVal);
        } else {
            newVal = rawVal === '' ? '' : rawVal;
        }

        if (!chars[charName]) chars[charName] = {};
        var old = chars[charName][fieldName];
        if (old !== newVal) { chars[charName][fieldName] = newVal; hasChanges = true; }
    });

    if (!hasChanges) { exitCardEditMode(cardDiv); return; }

    state.characters = chars;
    c.state = state;

    var getChatId = stored.getChatId;
    write(getChatId(), vault).then(function() {
        busEmit('vault:updated', { getChatId: getChatId });
    });
}

function exitCardEditMode(cardDiv) {
    if (!cardDiv) return;

    if (cardDiv._neOrigTableHTML) {
        var table = cardDiv.querySelector('.ne-char-card-body table');
        if (table) table.outerHTML = cardDiv._neOrigTableHTML;
        cardDiv._neOrigTableHTML = null;
    }

    var saveBtn = cardDiv.querySelector('.ne-card-save-btn');
    var cancelBtn = cardDiv.querySelector('.ne-card-cancel-btn');
    if (saveBtn) saveBtn.outerHTML = cardDiv._neOrigEditBtnHTML || '';
    if (cancelBtn && cancelBtn.parentNode) cancelBtn.remove();

    cardDiv.classList.remove('ne-card-editing');
}

export function deleteCharacterFromState(name) {
    var stored = _pendingInlineStorage;
    if (!stored || !stored.vault) return;
    var vault = stored.vault;
    var c = vault.content || {};
    var state = c.state || {};
    var chars = state.characters || {};
    if (!chars[name]) return;
    delete chars[name];
    state.characters = chars;
    c.state = state;
    var getChatId = stored.getChatId;
    write(getChatId(), vault).then(function() {
        busEmit('vault:updated', { getChatId: getChatId });
    });
}

function toggleInlineEdit(row, entryId, entryType) {
    if (!row) return;
    var cells = row.querySelectorAll('td');
    if (cells.length < 4) return;
    var origPeriod = (cells[1].textContent || '').trim();
    var origScene = (cells[2].textContent || '').trim();
    // New column layout: [0]No. [1]Period [2]Scene [3]MsgIDs [4]Event [5]Edit
    // Old column layout: [0]No. [1]Period [2]Scene [3]Event [4]Edit
    var hasIdColumn = cells.length > 5;
    var origEvent = (cells[hasIdColumn ? 4 : 3].textContent || '').trim();
    var origIds = hasIdColumn ? (cells[3].textContent || '').trim() : '';
    row.classList.add('ne-inline-row');
    var savedHTML = row.innerHTML;
    row._neOrigHTML = savedHTML;
    row._neOrigPeriod = origPeriod;
    row._neOrigScene = origScene;
    row._neOrigEvent = origEvent;

    function rebindEditBtn(el) {
        var btn = el.querySelector('.ne-inline-edit-btn');
        if (!btn) return;
        btn.onclick = function() {
            var r = this.closest('tr');
            if (!r || r.classList.contains('ne-inline-row')) return;
            var eid = this.getAttribute('data-entry-id');
            var etype = this.getAttribute('data-entry-type');
            toggleInlineEdit(r, eid, etype);
        };
    }

    var idColumnCell = hasIdColumn
        ? '<td style="font-size:0.75em;max-width:180px;color:var(--ne-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(origIds) + '">' + escapeHtml(origIds) + '</td>'
        : '';
    var eventCellTarget = hasIdColumn ? 5 : 4;

    row.innerHTML = '<td style="text-align:center;width:2em;">' + cells[0].innerHTML + '</td>' +
        '<td><input class="ne-inline-period" value="' + escapeHtml(origPeriod) + '"></td>' +
        '<td><input class="ne-inline-scene" value="' + escapeHtml(origScene) + '"></td>' +
        idColumnCell +
        '<td><textarea class="ne-inline-event" rows="2">' + escapeHtml(origEvent) + '</textarea></td>' +
        '<td style="white-space:nowrap;"><button class="ne-inline-save" aria-label="' + t('Save') + '">\u2713</button>' +
        '<button class="ne-inline-cancel" style="background:var(--ne-danger);color:#fff;border:none;" aria-label="' + t('Cancel') + '">\u2715</button>' +
        '<button class="ne-inline-delete" aria-label="' + t('Delete') + '">\u{1F5D1}</button></td>';
    row.querySelector('.ne-inline-save').onclick = function() {
        var period = row.querySelector('.ne-inline-period').value;
        var scene = row.querySelector('.ne-inline-scene').value;
        var event = row.querySelector('.ne-inline-event').value;
        saveSingleEntry(entryType, entryId, { period: period, scene: scene, event: event });
        row.innerHTML = row._neOrigHTML;
        row.classList.remove('ne-inline-row');
        row.querySelector('td:nth-child(2)').textContent = period;
        row.querySelector('td:nth-child(3)').textContent = scene;
        row.querySelector('td:nth-child(' + eventCellTarget + ')').innerHTML = escapeHtml(event);
        row._neOrigPeriod = period;
        row._neOrigScene = scene;
        row._neOrigEvent = event;
        rebindEditBtn(row);
    };
    row.querySelector('.ne-inline-cancel').onclick = function() {
        row.innerHTML = row._neOrigHTML;
        row.classList.remove('ne-inline-row');
        rebindEditBtn(row);
    };
    row.querySelector('.ne-inline-delete').onclick = async function() {
        if (!await showConfirm(t('Delete this entry?'), t('This cannot be undone.'), t('Delete'), t('Cancel'), true)) return;
        deleteSingleEntry(entryType, entryId);
        row.remove();
    };
}

function renderStmRow(stm, opts) {
    var no = opts.no || 0;
    var fs = opts.fontSize || '0.9em';
    var subPeriod = (stm.period || '') + (stm.time_label ? '\u00b7' + stm.time_label : '');
    var subScene = stm.scene || '';
    var msgCount = (stm.msg_ids || []).length;
    var subAbsMsgStart = stm.absMsgStart;
    var subAbsMsgEnd = stm.absMsgEnd;
    var subMsgDisplay;
    if (subAbsMsgStart !== undefined && subAbsMsgEnd !== undefined && msgCount > 0) {
        subMsgDisplay = 'Msg ' + subAbsMsgStart + '\u2013' + subAbsMsgEnd + ' / ' + msgCount + '\u6761';
    } else if (msgCount > 0) {
        subMsgDisplay = msgCount + '\u6761';
    } else {
        subMsgDisplay = stm.id || '';
    }
    var editCell = opts.showEdit
        ? '<td><button class="ne-inline-edit-btn" data-entry-id="' + stm.id + '" data-entry-type="stm" aria-label="' + t('Edit') + '">\u270E</button></td>'
        : '<td></td>';
    var eventHtml = escapeHtml(stm.event || stm.summary || '');
    var entities = stm.entities || [];
    if (entities.length > 0) {
        eventHtml += '<div class="ne-stm-entities-row">';
        entities.forEach(function(en) {
            eventHtml += '<span class="ne-entity-pill">' + escapeHtml(en) + '</span>';
        });
        eventHtml += '</div>';
    }
    var innerThoughts = stm._inner_thoughts;
    if (innerThoughts && Object.keys(innerThoughts).length > 0) {
        eventHtml += '<div class="ne-stm-thoughts-row">';
        Object.keys(innerThoughts).forEach(function(name) {
            var thoughts = innerThoughts[name] || [];
            var joined = thoughts.join(' \u2192 ');
            eventHtml += '<div class="ne-stm-thought-item"><span class="ne-thought-char">' + escapeHtml(name) + '</span>: ' + escapeHtml(joined) + '</div>';
        });
        eventHtml += '</div>';
    }
    return '<tr' + (opts.cssClass ? ' class="' + opts.cssClass + '"' : '') + '>'
        + '<td style="text-align:center;color:#888;width:2em;font-size:' + fs + ';">' + no + '</td>'
        + '<td style="white-space:nowrap;font-size:' + fs + ';max-width:120px;">' + subPeriod + '</td>'
        + '<td style="font-size:' + fs + ';max-width:100px;">' + escapeHtml(subScene) + '</td>'
        + '<td style="font-size:' + fs + ';max-width:150px;color:#888;">' + escapeHtml(subMsgDisplay) + '</td>'
        + '<td style="font-size:' + fs + ';">' + eventHtml + '</td>'
        + editCell
        + '</tr>';
}

export function renderMemoryTable(tbodyId, entries, type, stmIndexMap) {
    var tbody = panelQS(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!entries || entries.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">(empty)</td></tr>'; return; }
    entries.forEach(function (entry, i) {
        var entryId = entry.id || (type + '_' + i);

        if (type === 'stm') {
            var stmNo = parseInt(String(entry.id || '').replace('stm_', ''), 10) || (i + 1);
            tbody.innerHTML += renderStmRow(entry, { showEdit: true, no: stmNo, fontSize: '0.9em' });
            return;
        }

        if (entry._type === 'orphan_group') {
            var groupId = entry._id;
            var groupStms = entry.stms || [];
            var firstStm = groupStms[0];
            var lastStm = groupStms[groupStms.length - 1];
            var msgLabel = (firstStm && lastStm)
                ? 'Msg ' + (firstStm.absMsgStart || '?') + '\u2013' + (lastStm.absMsgEnd || lastStm.absMsgStart || '?')
                : 'N/A';
            var countLabel = groupStms.length + '\u6761';
            var groupTitle = '[' + t('Unfiled') + '] ' + msgLabel + ' / ' + countLabel;
            var groupPeriod = (firstStm && firstStm.period) ? firstStm.period : '';
            var toggleBtn = '<span class="narrative_ltm_toggle" data-ltm-id="' + groupId + '" tabindex="0" role="button" aria-label="' + t('Toggle STM details') + '">\u25B6</span> ';

            tbody.innerHTML += '<tr data-entry-id="' + groupId + '" class="ne-orphan-group-row">'
                + '<td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td>'
                + '<td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + escapeHtml(groupPeriod) + '</td>'
                + '<td style="font-size:0.85em;max-width:150px;color:#888;">' + escapeHtml(msgLabel) + '</td>'
                + '<td><div style="font-style:italic;color:#888;">' + escapeHtml(groupTitle) + '</div></td>'
                + '<td></td>'
                + '</tr>';

            var detailRows = '';
            groupStms.forEach(function(stm, si) {
                detailRows += renderStmRow(stm, { fontSize: '0.8em', no: si + 1 });
            });
            if (detailRows) {
                tbody.innerHTML += '<tr class="narrative_ltm_detail" data-ltm-parent="' + groupId + '">'
                    + '<td colspan="5"><div class="narrative_ltm_detail_container">'
                    + '<table class="narrative_ltm_sub_table"><tbody>' + detailRows + '</tbody></table>'
                    + '</div></td></tr>';
            }
            return;
        }

        // LTM entry rendering
        var periodCell = entry.time_range || entry.period || '';
        var refs = entry.stm_refs || [];
        var idListFull = refs.join(', ');
        var idDisplay = refs.length > 0 ? '#STM ' + refs.join(', ') : '';
        var idListCell = '<td style="font-size:0.85em;max-width:150px;color:#888;" title="' + escapeHtml(idListFull || '') + '">' + escapeHtml(idDisplay || '') + '</td>';
        var toggleBtn = '<span class="narrative_ltm_toggle" data-ltm-id="' + entryId + '" tabindex="0" role="button" aria-label="' + t('Toggle STM details') + '">\u25B6</span> ';
        var titleStyle = entry.status === 'open' ? 'font-style:italic;color:#888;' : 'font-weight:bold;';
        tbody.innerHTML += '<tr data-entry-id="' + entryId + '"><td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + periodCell + '</td>' + idListCell + '<td>' + '<div style="' + titleStyle + '">' + (entry.title || entry.event || entry.summary || '') + (entry.status === 'open' ? '<span style="color:var(--ne-success);font-size:0.8em;">' + t('in_progress_label') + '</span>' : '') + '</div>' + (entry.title && entry.event && entry.event !== entry.title ? '<div style="font-size:0.85em;color:#999;">' + entry.event.substring(0, 120) + '</div>' : '') + '<td><button class="ne-inline-edit-btn" data-entry-id="' + entryId + '" data-entry-type="ltm" aria-label="' + t('Edit') + '">\u270E</button></td></tr>';

        var detailRows = '';
        refs.forEach(function (stmId, si) {
            var stm = stmIndexMap && stmIndexMap[stmId];
            if (stm) {
                var subNo = parseInt(stmId.replace('stm_', ''), 10) || (si + 1);
                detailRows += renderStmRow(stm, { fontSize: '0.8em', no: subNo });
            }
        });
        if (detailRows) { tbody.innerHTML += '<tr class="narrative_ltm_detail" data-ltm-parent="' + entryId + '"><td colspan="5"><div class="narrative_ltm_detail_container"><table class="narrative_ltm_sub_table"><tbody>' + detailRows + '</tbody></table></div></td></tr>'; }
    });
    if (type === 'ltm') {
        tbody.querySelectorAll('.narrative_ltm_toggle').forEach(function (el) {
            el.onclick = function () {
                var mainRow = el.closest('tr');
                if (!mainRow) return;
                var detailRow = mainRow.nextElementSibling;
                if (!detailRow || !detailRow.classList.contains('narrative_ltm_detail')) return;
                var expanded = detailRow.classList.contains('expanded');
                if (expanded) {
                    detailRow.classList.remove('expanded');
                    el.classList.remove('expanded');
                } else {
                    detailRow.classList.add('expanded');
                    el.classList.add('expanded');
                }
            };
        });
    }
    // Bind inline edit buttons
    panelQSA(tbodyId + ' .ne-inline-edit-btn').forEach(function(btn) {
        btn.onclick = function() {
            var row = this.closest('tr');
            if (!row || row.classList.contains('ne-inline-row')) return;
            var entryId = this.getAttribute('data-entry-id');
            var entryType = this.getAttribute('data-entry-type');
            toggleInlineEdit(row, entryId, entryType);
        };
    });
}
