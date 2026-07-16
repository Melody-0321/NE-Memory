import { readState, writeState, getEffectiveTemplates, loadCardConfigSync, getActiveVersion, getActiveVersionKey, editTemplateInCard, pushTemplateToGlobal, cloneTemplateToCard, restoreTemplateVersion, deleteTemplateVersion, loadFieldLibrary, addFieldToLibrary, getFieldFromLibrary, addTemplateRefToField, removeTemplateRefToField } from '../core/vault/store.js';

function _getChatId() {
    try {
        if (_pendingInlineStorage && typeof _pendingInlineStorage.getChatId === 'function') {
            return _pendingInlineStorage.getChatId();
        }
    } catch (e) {}
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.chatId && ctx.chatId !== 'default') return ctx.chatId;
        }
    } catch (e) {}
    try {
        if (typeof window.__NE_CURRENT_CHAT_ID === 'function') return window.__NE_CURRENT_CHAT_ID();
    } catch (e) {}
    return null;
}
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { buildCharacterSchemaFromTemplates, DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE, DEFAULT_FACTION_TEMPLATE, DEFAULT_TASK_TEMPLATE, DEFAULT_GOAL_TEMPLATE, PRESET_FIELDS, ALL_PREDEFINED_FIELDS, ROLE_CATEGORY_MAP, getPresetFieldsForRole, resolveActiveTemplateFields } from '../core/vault/schema.js';
import { qs, qsa, byId, pdCreate, pdHead, t, sortLtmByMsgOrder, busEmit, panelById, panelQS, panelQSA, showConfirm, showToast } from './panel-shared.js';
import { saveSingleEntry, deleteSingleEntry, _pendingInlineStorage } from './panel-drawer.js';
import { recordStateDelta } from '../core/vault/state-versions.js';

var ACTIVE_STATUSES = ['活跃'];
var DEPARTED_STATUSES = ['已死亡', '已归隐', '已离去'];

function getCharacterCardType(name, state) {
    if (state && state.protagonist_name && name === state.protagonist_name) return 'protagonist';
    if (state && state.characters && state.characters[name] && state.characters[name]._role === 'protagonist') return 'protagonist';
    return 'npc';
}

function renderCharacterCard(name, card, schema, cardType) {
    var cardSchema = (schema && schema[cardType]) ? schema[cardType] : (schema && schema.npc ? schema.npc : null);

    // Resolve actual template fields from character's _scheme instead of always using default schema
    var schemeKey = (card && card._scheme) || null;
    if (schemeKey && schemeKey.indexOf('_default_') !== 0) {
        var protoName = _getCurrentCharName();
        if (protoName) {
            var resolvedFields = resolveActiveTemplateFields(protoName, schemeKey);
            if (resolvedFields && Object.keys(resolvedFields).length > 0) {
                // Build a cardSchema from resolved fields, preserving system fields
                cardSchema = { fields: resolvedFields };
                // Ensure name and status are present
                if (!cardSchema.fields.name) cardSchema.fields.name = { type: 'string', max_length: 30, required: true, _system: true };
                if (!cardSchema.fields.status) cardSchema.fields.status = { type: 'enum', values: ['活跃','非活跃','已死亡','已归隐','已离去'], required: true, _system: true };
            }
        }
    }

    if (!cardSchema || !cardSchema.fields) return '';

    var rows = [];
    var requiredFields = [];
    var optionalFields = [];

    Object.keys(cardSchema.fields).forEach(function (key) {
        if (key === 'status') return; // shown in card header + grouping, redundant in body
        if (key.startsWith('_')) return; // skip system fields like _scheme, _templateLocked
        var fieldDef = cardSchema.fields[key];
        var val = card[key];

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

    // Render inventory if present
    var inventoryHtml = '';
    if (card.inventory && typeof card.inventory === 'object') {
        var invItems = [];
        if (Array.isArray(card.inventory)) {
            card.inventory.forEach(function(item) {
                if (item && typeof item === 'object') {
                    var itemName = item.name || '?';
                    var parts = [];
                    if (item.description) parts.push(item.description);
                    if (item.rarity) parts.push(item.rarity);
                    if (item.properties && item.properties !== '无') parts.push(item.properties);
                    invItems.push('<span class="ne-inv-slot"><span class="ne-inv-key">' + escapeHtml(itemName) + '</span><span class="ne-inv-val">' + escapeHtml(parts.join(' / ')) + '</span></span>');
                } else {
                    invItems.push('<span class="ne-inv-slot"><span class="ne-inv-val">' + escapeHtml(String(item)) + '</span></span>');
                }
            });
        } else {
            Object.keys(card.inventory).forEach(function (slot) {
                invItems.push('<span class="ne-inv-slot"><span class="ne-inv-key">' + escapeHtml(slot) + '</span><span class="ne-inv-val">' + escapeHtml(String(card.inventory[slot])) + '</span></span>');
            });
        }
        if (invItems.length > 0) {
            inventoryHtml = '<div class="ne-inventory-bar">' + invItems.join(' ') + '</div>';
        }
    }

    var displayName = card.name || name;
    var html = '<div class="ne-char-card">';
    html += '<div class="ne-char-card-header" tabindex="0" role="button" aria-label="' + t('Toggle details') + ': ' + escapeHtml(displayName) + '" onclick="this.parentElement.classList.toggle(\'open\')">';
    html += '<span class="ne-char-toggle">&#9654;</span>';
    html += '<b>' + escapeHtml(displayName) + '</b> ';
    html += '<span class="ne-char-type ' + (cardType === 'protagonist' ? 'ne-char-type-pc' : 'ne-char-type-npc') + '">' + (cardType === 'protagonist' ? 'PC' : 'NPC') + '</span>';
    html += '<button class="ne-card-scheme-btn" data-char="' + escapeHtml(name) + '" data-cardtype="' + escapeHtml(cardType) + '" title="' + escapeHtml(t('edit_scheme')) + '" aria-label="' + escapeHtml(t('edit_scheme')) + '" onclick="event.stopPropagation()">\u2699</button>';
    var isTemplateLocked = card && card._templateLocked;
    html += '<button class="ne-card-lock-btn' + (isTemplateLocked ? ' locked' : '') + '" data-char="' + escapeHtml(name) + '" title="' + escapeHtml(t('lock_character')) + '" aria-label="' + escapeHtml(t('lock_character')) + '" onclick="event.stopPropagation()">' + (isTemplateLocked ? '\u{1F512}' : '\u{1F513}') + '</button>';
    html += '<button class="ne-card-edit-btn" data-char="' + escapeHtml(name) + '" data-cardtype="' + escapeHtml(cardType) + '" aria-label="' + t('Edit') + '" onclick="event.stopPropagation()">\u270E</button>';
    html += '</div>';
    html += '<div class="ne-char-card-body"><table>' + allRows.join('') + '</table>';
    html += inventoryHtml;

    // Power slots (independent rendering)
    if (card.power_slots && typeof card.power_slots === 'object') {
        var psKeys = Object.keys(card.power_slots);
        if (psKeys.length > 0) {
            html += '<div class="ne-power-slots">';
            psKeys.forEach(function (sk) {
                var sv = card.power_slots[sk];
                var svStr = (sv && typeof sv === 'object' && sv.level !== undefined) ? sv.level : (typeof sv === 'object' ? JSON.stringify(sv) : String(sv || ''));
                html += '<span class="ne-ps-slot" title="' + escapeHtml(sk) + '"><span class="ne-ps-key">' + escapeHtml(sk) + '</span><span class="ne-ps-val">' + escapeHtml(svStr) + '</span></span>';
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
    // Always rebuild from current template definitions — persisted character_schema
    // can be stale after template updates
    return buildCharacterSchemaFromTemplates(DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE);
}

export function renderCharacterPanelHTML(state, characterSchema) {
    var characters = (state && state.characters) ? state.characters : {};
    var schema = characterSchema || buildCharacterSchemaFromTemplates(DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE);
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

        // object/array fields: read-only, not editable as plain text
        if (fieldType === 'object') return;

        var editor;
        switch (fieldType) {
            case 'enum':
                var values = (td.getAttribute('data-values') || '').split(',');
                editor = '<select class="ne-char-edit">';
                values.forEach(function(v) {
                    var vv = v.trim();
                    var sel = (textVal === vv) ? ' selected' : '';
                    editor += '<option value="' + escapeHtml(vv).replace(/"/g, '&quot;') + '"' + sel + '>' + escapeHtml(vv) + '</option>';
                });
                editor += '</select>';
                break;
            case 'number':
                var min = td.getAttribute('data-min');
                var max = td.getAttribute('data-max');
                editor = '<input class="ne-char-edit" type="number" value="' + escapeHtml(textVal).replace(/"/g, '&quot;') + '"' +
                    (min ? ' min="' + min + '"' : '') +
                    (max ? ' max="' + max + '"' : '') + '>';
                break;
            default:
                var maxlen = td.getAttribute('data-maxlen');
                editor = '<input class="ne-char-edit" type="text" value="' + escapeHtml(textVal).replace(/"/g, '&quot;') + '"' +
                    (maxlen ? ' maxlength="' + maxlen + '"' : '') + '>';
        }
        span.outerHTML = editor;
    });

    var charName = editBtn.getAttribute('data-char');

    editBtn.outerHTML =
        '<button class="ne-card-save-btn">' + t('Save') + '</button>' +
        '<button class="ne-card-cancel-btn">' + t('Cancel') + '</button>' +
        '<button class="ne-card-delete-btn" style="background:#d32f2f;color:#fff;margin-left:2px;">' + t('Delete') + '</button>';

    var saveBtn = cardDiv.querySelector('.ne-card-save-btn');
    if (saveBtn) saveBtn.onclick = function(e) { e.stopPropagation(); saveCardFields(cardDiv); };

    var cancelBtn = cardDiv.querySelector('.ne-card-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = function(e) { e.stopPropagation(); exitCardEditMode(cardDiv); };

    var deleteBtn = cardDiv.querySelector('.ne-card-delete-btn');
    if (deleteBtn) deleteBtn.onclick = async function(e) {
        e.stopPropagation();
        if (!await showConfirm(t('Delete character card?').replace('{CHAR}', charName), escapeHtml(charName) + ': ' + t('This will remove the character and all its state data. The LLM may re-extract it from future dialogue.'), t('Delete'), t('Cancel'), true)) return;
        deleteCharacterCard(cardDiv, charName);
    };
}

function saveCardFields(cardDiv) {
    var stored = _pendingInlineStorage;
    if (!stored || !stored.vault) return;
    var stateVault = stored.vault;
    var c = stateVault.content || {};
    var state = c.state || {};
    var chars = state.characters || {};

    var vals = cardDiv.querySelectorAll('.ne-char-val');
    var hasChanges = false;
    var capturedChanges = [];
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
        if (old !== newVal) {
            chars[charName][fieldName] = newVal;
            hasChanges = true;
            capturedChanges.push({ path: 'characters.' + charName + '.' + fieldName, old: old, new: newVal });
        }
    });

    if (!hasChanges) { exitCardEditMode(cardDiv); return; }

    state.characters = chars;
    c.state = state;

    var getChatId = stored.getChatId;
    var chatId = getChatId();
    writeState(chatId, stateVault).then(function() {
        busEmit('vault:updated', { getChatId: getChatId });
    });

    if (capturedChanges.length > 0) {
        recordStateDelta(chatId, {
            source: 'manual_edit',
            summary: '\u624B\u52A8\u7F16\u8F91 ' + capturedChanges.map(function(c) { return c.path.split('.').pop(); }).join(', '),
            changes: capturedChanges,
            message_dates: []
        }).catch(function(err) { console.error('[NE] recordStateDelta (manual edit) failed for ' + chatId, err); });
    }

    cardDiv.classList.remove('ne-card-editing');
    var form = cardDiv.querySelector('.ne-card-edit-form');
    if (form) form.remove();
    var btnBar = cardDiv.querySelector('.ne-card-edit-btns');
    if (btnBar) btnBar.remove();
}

var _schemeEditStates = {};  // per-character scheme editor state

export function enterSchemeEditMode(cardEl, charName, charCardType) {
    if (!cardEl || !charName) return;
    var body = cardEl.querySelector('.ne-char-card-body');
    var header = cardEl.querySelector('.ne-char-card-header');
    if (!body || !header) return;

    // Check if already in edit mode
    if (cardEl.classList.contains('ne-scheme-editing')) {
        _exitSchemeEditMode(cardEl);
        return;
    }

    // Get state and protagonist name
    var state = _getCurrentState();
    var protoName = _getCurrentCharName();
    if (!protoName) {
        showToast('No protagonist configured', 'error', 3000);
        return;
    }
    // Sync state.protagonist_name if missing
    if (state && !state.protagonist_name) state.protagonist_name = protoName;

    // Load card config (per-protagonist) and global template library
    var cardConfig = loadCardConfigSync(protoName) || { _dialogueTemplates: {}, _templateConfig: {}, _version: 0 };
    var dialogueTemplates = cardConfig._dialogueTemplates || {};
    var lib = getEffectiveTemplates();
    var templates = (lib && lib.templates) ? lib.templates : {};

    // Determine role FIRST (needed for default scheme inference)
    var role = 'npc';
    if (charCardType === 'protagonist') {
        role = 'pc';
    } else if (state && state.factions && state.factions.hasOwnProperty(charName)) {
        role = 'faction';
    } else if (state && state.quests && state.quests.tasks && state.quests.tasks.hasOwnProperty(charName)) {
        role = 'quest';
    }

    // Get character data: _scheme is now a dialogue template key in cardConfig
    var charData = (state && state.characters && state.characters[charName]) || {};
    var dtKey = charData._scheme || null;

    // If no _scheme, infer default sentinel from role
    if (!dtKey) {
        dtKey = '_default_' + role;
    }

    var dt = dtKey ? dialogueTemplates[dtKey] : null;
    var tplId = dt ? dt._templateId : null;
    var tpl = tplId ? templates[tplId] : null;

    // Fallback: if _scheme is a default sentinel (_default_npc etc), use DEFAULT template
    var isDefaultScheme = dtKey && dtKey.indexOf('_default_') === 0;
    if (!dt && isDefaultScheme) {
        var defaultMap = {
            '_default_pc': DEFAULT_PC_TEMPLATE,
            '_default_npc': DEFAULT_NPC_TEMPLATE,
            '_default_faction': DEFAULT_FACTION_TEMPLATE,
            '_default_task': DEFAULT_TASK_TEMPLATE,
            '_default_goal': DEFAULT_GOAL_TEMPLATE
        };
        dt = defaultMap[dtKey] || null;
    }

    // Get current field values from card-level template (or default template)
    var currentPresets = (dt && dt.presetFields) ? dt.presetFields.slice() : [];
    var currentCustoms = (dt && dt.customFieldRefs) ? dt.customFieldRefs.slice() : [];

    if (currentPresets.length === 0 && charData) {
        var usedPresets = [];
        Object.keys(PRESET_FIELDS).forEach(function(cat) {
            Object.keys(PRESET_FIELDS[cat]).forEach(function(fn) {
                if (charData.hasOwnProperty(fn) && charData[fn] !== '' && charData[fn] !== null && charData[fn] !== false) {
                    usedPresets.push(fn);
                }
            });
        });
        if (usedPresets.length > 0) currentPresets = usedPresets;
    }
    if (currentCustoms.length === 0 && charData) {
        var allPresetNames = [];
        Object.keys(PRESET_FIELDS).forEach(function(cat) {
            Object.keys(PRESET_FIELDS[cat]).forEach(function(fn) { allPresetNames.push(fn); });
        });
        var usedCustoms = [];
        Object.keys(charData).forEach(function(k) {
            if (k === 'name' || k === 'status') return;
            if (k.startsWith('_')) return;
            if (allPresetNames.indexOf(k) !== -1) return;
            if (charData[k] !== '' && charData[k] !== null) usedCustoms.push(k);
        });
        if (usedCustoms.length > 0) currentCustoms = usedCustoms;
    }

    // Build scheme editor HTML
    var html = '<div class="ne-scheme-editor">';

    // P9: Mode-driven tab selector - three actionable paths
    // edit_current is always enabled: every character has a scheme (explicit or inferred default)
    var hasCurrentDt = !!(dtKey && (dialogueTemplates[dtKey] || isDefaultScheme));
    var defaultMode = hasCurrentDt ? 'edit_current' : 'switch_template';
    html += '<div class="ne-scheme-mode-bar" style="display:flex;gap:0;margin-bottom:12px;border-bottom:1px solid var(--grey-20);">';
    var modes = [
        { key: 'edit_current', label: t('edit_from_current'), enabled: hasCurrentDt },
        { key: 'switch_template', label: t('switch_template'), enabled: true },
        { key: 'from_scratch', label: t('start_from_scratch'), enabled: true }
    ];
    modes.forEach(function(m) {
        var isActive = (m.key === defaultMode);
        var style = 'flex:1;padding:6px 8px;text-align:center;font-size:0.8em;cursor:' + (m.enabled ? 'pointer' : 'default') +
            ';border-bottom:2px solid ' + (isActive ? 'var(--ne-accent)' : 'transparent') +
            ';color:' + (isActive ? 'var(--ne-accent)' : (!m.enabled ? 'var(--grey-30)' : 'var(--grey-50)')) +
            ';opacity:' + (m.enabled ? '1' : '0.4') + ';';
        html += '<div class="ne-scheme-mode-tab' + (isActive ? ' active' : '') + '" data-scheme-mode="' + m.key + '"' + (!m.enabled ? ' data-disabled="1"' : '') + ' style="' + style + '">' + escapeHtml(m.label) + '</div>';
    });
    html += '</div>';

    // switch_template mode: copy/version list (primary) + global template dropdown (secondary)
    var tplDisplay = (defaultMode === 'switch_template') ? '' : ' display:none;';
    var tplOptionsHtml = '<option value="">— ' + escapeHtml(t('select_template')) + ' —</option>';
    Object.keys(templates).forEach(function(tid) {
        var gt = templates[tid];
        if (!gt || !gt.name) return;
        tplOptionsHtml += '<option value="__global__' + escapeHtml(tid) + '">' + escapeHtml(gt.name) + '</option>';
    });
    html += '<div class="ne-scheme-section" id="ne-scheme-tpl-section" style="margin-bottom:8px;' + tplDisplay + '">';

    // Primary: main copy + collapsible history copies
    var allDtKeys = Object.keys(dialogueTemplates);
    if (allDtKeys.length > 0) {
        var mainTpl = (dtKey && dialogueTemplates[dtKey]) ? dialogueTemplates[dtKey] : null;
        if (mainTpl) {
            var gtMain = templates[mainTpl._templateId];
            var mainName = (gtMain && gtMain.name) ? gtMain.name : (mainTpl._templateId || '?');
            html += '<div style="padding:8px;border:1px solid var(--ne-info-border);border-radius:6px;background:var(--ne-info-bg);margin-bottom:8px;">';
            html += '<div style="font-weight:bold;color:var(--ne-info);">' + escapeHtml(t('current')) + '</div>';
            html += '<div style="font-size:0.85em;margin-top:2px;">' + escapeHtml(mainName) + '</div>';
            html += '<div style="font-size:0.78em;color:var(--grey-50);">' + escapeHtml(mainTpl.createdAt ? formatLocalTime(mainTpl.createdAt) : '?') + '</div>';
            html += '</div>';
        }

        var historyKeys = allDtKeys.filter(function(k) { return k !== dtKey; });
        if (historyKeys.length > 0) {
            html += '<div style="margin-bottom:8px;">';
            html += '<div id="ne-scheme-history-toggle" style="cursor:pointer;padding:4px 6px;font-size:0.8em;color:var(--grey-50);user-select:none;">';
            html += '<span id="ne-scheme-history-arrow">\u25B6</span> ' + escapeHtml(t('history_copies')) + ' (' + historyKeys.length + ')</div>';
            html += '<div id="ne-scheme-history-list" style="display:none;max-height:200px;overflow-y:auto;font-size:0.78em;">';
            historyKeys.forEach(function(k) {
                var h = dialogueTemplates[k];
                if (!h) return;
                html += '<div style="padding:4px 6px;display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--black20a);">';
                html += '<span style="color:var(--grey-50);flex:1;">' + escapeHtml(h.createdAt ? formatLocalTime(h.createdAt) : '?') + '</span>';
                html += '<button class="ne-btn-small" data-switch-version="' + escapeHtml(k) + '" style="font-size:0.75em;">' + escapeHtml(t('switch_to')) + '</button>';
                html += '<button class="ne-btn-small" data-delete-version="' + escapeHtml(k) + '" style="font-size:0.75em;color:var(--ne-error);">' + escapeHtml(t('Delete')) + '</button>';
                html += '</div>';
            });
            html += '</div></div>';
        }
    } else {
        html += '<div style="padding:8px;color:var(--grey-50);font-size:0.8em;text-align:center;">' + escapeHtml(t('no_templates')) + '</div>';
    }

    // Secondary: global template dropdown (switch to a different template entirely)
    html += '<label style="display:block;margin-top:8px;font-size:0.8em;color:var(--grey-50);">' + escapeHtml(t('switch_template')) + '</label>';
    html += '<select id="ne-scheme-template-select" class="ne-config-select" style="width:100%;">' + tplOptionsHtml + '</select>';
    html += '</div>';

    // Field editing area — hidden in switch_template mode (no field-level editing when switching templates)
    var fieldsDisplay = (defaultMode === 'switch_template') ? ' display:none;' : '';
    html += '<div id="ne-scheme-fields-editor" style="' + fieldsDisplay + '">';

    // Required fields section
    html += '<div class="ne-scheme-section ne-scheme-required">';
    html += '<div class="ne-scheme-section-title">' + escapeHtml(t('required_section')) + '</div>';
    html += '<div class="ne-scheme-fields">';
    var requiredFields = ['status', 'name'];
    requiredFields.forEach(function(fn) {
        html += '<div class="ne-scheme-field ne-scheme-field-locked">' +
            '<span class="ne-scheme-field-icon">\u{1F512}</span> ' +
            '<span>' + escapeHtml(fn) + '</span> ' +
            '<span class="ne-scheme-field-type">string</span>' +
            '</div>';
    });
    html += '</div></div>';

    // Preset fields section — P9: filtered by role
    html += '<div class="ne-scheme-section">';
    html += '<div class="ne-scheme-section-title">' + escapeHtml(t('preset_section')) + '</div>';
    html += '<div class="ne-scheme-hint">' + escapeHtml('Unchecking preserves existing data but stops tracking new changes.') + '</div>';
    html += '<div class="ne-scheme-fields">';
    var allowedCats = ROLE_CATEGORY_MAP[role] || ROLE_CATEGORY_MAP.npc;
    Object.keys(PRESET_FIELDS).forEach(function(cat) {
        if (allowedCats.indexOf(cat) === -1) return;
        html += '<div class="ne-scheme-category">' + escapeHtml(cat) + '</div>';
        Object.keys(PRESET_FIELDS[cat]).forEach(function(fn) {
            var checked = currentPresets.indexOf(fn) !== -1;
            var fd = PRESET_FIELDS[cat][fn];
            html += '<label class="ne-scheme-field">' +
                '<input type="checkbox" class="ne-scheme-checkbox" value="' + escapeHtml(fn) + '"' + (checked ? ' checked' : '') + '> ' +
                escapeHtml(t_field(fn)) + ' <span class="ne-scheme-field-type">' + escapeHtml(fd.type || 'string') + '</span>' +
                '</label>';
        });
    });
    html += '</div></div>';

    // Custom fields section
    html += '<div class="ne-scheme-section">';
    html += '<div class="ne-scheme-section-title">' + escapeHtml(t('custom_section')) + '</div>';
    html += '<div class="ne-scheme-hint">' + escapeHtml(t('custom_field_lib_hint')) + '</div>';
    html += '<div class="ne-scheme-fields" id="ne-scheme-custom-fields">';
    currentCustoms.forEach(function(fn) {
        var libEntry = getFieldFromLibrary(fn);
        var typeLabel = libEntry ? libEntry.type : 'string';
        html += '<div class="ne-scheme-field ne-scheme-custom-item">' +
            '<span>' + escapeHtml(fn) + '</span>' +
            '<span class="ne-custom-field-type">' + escapeHtml(typeLabel) + '</span>' +
            '<button class="ne-btn-small ne-btn-danger ne-scheme-remove-custom" data-field="' + escapeHtml(fn) + '">\u2715</button>' +
            '</div>';
    });
    html += '</div>';
    html += '<div class="ne-scheme-add-custom" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">';
    html += '<input type="text" id="ne-scheme-add-custom-input" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_name')) + '" style="flex:1;min-width:80px">';
    html += '<select id="ne-scheme-custom-type" class="ne-editor-select" style="width:auto">';
    html += '<option value="string">string</option>';
    html += '<option value="number">number</option>';
    html += '<option value="enum">enum</option>';
    html += '<option value="boolean">boolean</option>';
    html += '</select>';
    html += '<input type="number" id="ne-scheme-custom-maxlen" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_maxlen')) + '" value="200" style="width:70px">';
    html += '<button id="ne-scheme-add-custom-btn" class="menu_button" style="width:auto;padding:4px 8px">+</button>';
    html += '</div>';
    html += '<div id="ne-scheme-custom-enum-row" style="display:none;margin-top:4px">';
    html += '<input type="text" id="ne-scheme-custom-enum-values" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_enum_values')) + '">';
    html += '</div>';
    html += '<div id="ne-scheme-custom-num-row" style="display:none;margin-top:4px;gap:6px">';
    html += '<input type="number" id="ne-scheme-custom-min" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_min')) + '" style="width:70px">';
    html += '<input type="number" id="ne-scheme-custom-max" class="ne-editor-input" placeholder="' + escapeHtml(t('custom_field_max')) + '" style="width:70px">';
    html += '</div>';
    html += '</div>';

    // History copies — edit_current mode only (collapsible, same as switch_template)
    var vhDisplay = (defaultMode === 'edit_current') ? '' : ' display:none;';
    if (dtKey && dialogueTemplates[dtKey]) {
        var edHistoryKeys = Object.keys(dialogueTemplates).filter(function(k) { return k !== dtKey; });
        if (edHistoryKeys.length > 0) {
            html += '<div class="ne-scheme-section" id="ne-scheme-version-section" style="' + vhDisplay + '">';
            html += '<div id="ne-edu-history-toggle" style="cursor:pointer;padding:4px 6px;font-size:0.8em;color:var(--grey-50);user-select:none;">';
            html += '<span id="ne-edu-history-arrow">\u25B6</span> ' + escapeHtml(t('history_copies')) + ' (' + edHistoryKeys.length + ')</div>';
            html += '<div id="ne-edu-history-list" style="display:none;max-height:200px;overflow-y:auto;font-size:0.78em;">';
            edHistoryKeys.forEach(function(k) {
                var h = dialogueTemplates[k];
                if (!h) return;
                html += '<div style="padding:4px 6px;display:flex;align-items:center;gap:4px;border-bottom:1px solid var(--black20a);">';
                html += '<span style="color:var(--grey-50);flex:1;">' + escapeHtml(h.createdAt ? formatLocalTime(h.createdAt) : '?') + '</span>';
                html += '<button class="ne-btn-small" data-switch-version="' + escapeHtml(k) + '" style="font-size:0.75em;">' + escapeHtml(t('switch_to')) + '</button>';
                html += '<button class="ne-btn-small" data-delete-version="' + escapeHtml(k) + '" style="font-size:0.75em;color:var(--ne-error);">' + escapeHtml(t('Delete')) + '</button>';
                html += '</div>';
            });
            html += '</div></div>';
        }
    }

    html += '</div>'; // close #ne-scheme-fields-editor

    // Actions — differentiated by mode
    html += '<div class="ne-scheme-actions" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;">';
    // apply-template: only for switch_template mode
    var applyDisplay = (defaultMode === 'switch_template') ? '' : ' display:none;';
    html += '<button class="menu_button" id="ne-scheme-apply-template" style="flex:1;min-width:80px;' + applyDisplay + '">' + escapeHtml(t('apply')) + '</button>';
    // save / save-as: only for edit_current / from_scratch modes
    var editBtnDisplay = (defaultMode === 'switch_template') ? ' display:none;' : '';
    html += '<button class="menu_button" id="ne-scheme-save" style="flex:1;min-width:80px;' + editBtnDisplay + '">' + escapeHtml(t('save_scheme')) + '</button>';
    html += '<button class="menu_button" id="ne-scheme-save-as-template" style="flex:1;min-width:80px;' + editBtnDisplay + '">' + escapeHtml(t('save_as_template')) + '</button>';
    html += '<button class="menu_button" id="ne-scheme-cancel" style="flex:1;min-width:80px;">' + escapeHtml(t('Cancel')) + '</button>';
    html += '</div>';
    html += '</div>';

    // Save original content
    _schemeEditStates[charName] = { originalHtml: body.innerHTML };
    cardEl.classList.add('ne-scheme-editing');
    body.style.display = 'none';

    // Create editor container after body
    var editorContainer = pdCreate('div');
    editorContainer.className = 'ne-scheme-editor-container';
    editorContainer.id = 'ne-scheme-editor-' + escapeHtml(charName).replace(/[^a-zA-Z0-9_-]/g, '_');
    editorContainer.innerHTML = html;
    body.parentNode.insertBefore(editorContainer, body.nextSibling);

    // Hide the edit (✎) button while in scheme mode
    var editBtn = header.querySelector('.ne-card-edit-btn');
    if (editBtn) editBtn.style.display = 'none';

    // Bind events
    _bindSchemeEditorEvents(cardEl, charName, charCardType, protoName, dtKey, tpl, cardConfig, templates);
}

function _refreshSchemeCheckboxes(cardEl, presets) {
    var checkboxes = cardEl.querySelectorAll('.ne-scheme-checkbox');
    for (var ci = 0; ci < checkboxes.length; ci++) {
        checkboxes[ci].checked = presets.indexOf(checkboxes[ci].value) !== -1;
    }
}

function _refreshSchemeCustomFields(cardEl, customFields) {
    var customContainer = cardEl.querySelector('#ne-scheme-custom-fields');
    if (!customContainer) return;
    customContainer.innerHTML = '';
    (customFields || []).forEach(function(fn) {
        var libEntry = getFieldFromLibrary(fn);
        var typeLabel = libEntry ? libEntry.type : 'string';
        var div = document.createElement('div');
        div.className = 'ne-scheme-field ne-scheme-custom-item';
        div.innerHTML = '<span>' + escapeHtml(fn) + '</span>' +
            '<span class="ne-custom-field-type">' + escapeHtml(typeLabel) + '</span>' +
            '<button class="ne-btn-small ne-btn-danger ne-scheme-remove-custom" data-field="' + escapeHtml(fn) + '">\u2715</button>';
        customContainer.appendChild(div);
        div.querySelector('.ne-scheme-remove-custom').addEventListener('click', function() {
            div.remove();
        });
    });
}

function _exitSchemeEditMode(cardEl) {
    if (!cardEl) return;
    cardEl.classList.remove('ne-scheme-editing');
    var body = cardEl.querySelector('.ne-char-card-body');
    if (body) body.style.display = '';
    var editorContainer = cardEl.querySelector('.ne-scheme-editor-container');
    if (editorContainer) editorContainer.remove();
    var header = cardEl.querySelector('.ne-char-card-header');
    var editBtn = header ? header.querySelector('.ne-card-edit-btn') : null;
    if (editBtn) editBtn.style.display = '';
}

function _bindSchemeEditorEvents(cardEl, charName, charCardType, protoName, dtKey, tpl, cardConfig, templates) {
    var dialogueTemplates = cardConfig._dialogueTemplates || {};

    // Mode tab switching — controls visibility of template dropdown, field editor, and action buttons
    var modeTabs = cardEl.querySelectorAll('.ne-scheme-mode-tab');
    for (var mi = 0; mi < modeTabs.length; mi++) {
        modeTabs[mi].addEventListener('click', function() {
            if (this.getAttribute('data-disabled') === '1') return;
            var mode = this.getAttribute('data-scheme-mode');
            // Update tab styles
            for (var tj = 0; tj < modeTabs.length; tj++) {
                var tab = modeTabs[tj];
                var tabMode = tab.getAttribute('data-scheme-mode');
                var isActive = (tabMode === mode);
                var tabEnabled = tab.getAttribute('data-disabled') !== '1';
                tab.className = 'ne-scheme-mode-tab' + (isActive ? ' active' : '');
                tab.style.borderBottomColor = isActive ? 'var(--ne-accent)' : 'transparent';
                tab.style.color = isActive ? 'var(--ne-accent)' : (!tabEnabled ? 'var(--grey-30)' : 'var(--grey-50)');
            }

            var isSwitchMode = (mode === 'switch_template');

            // Toggle template dropdown
            var tplSection = cardEl.querySelector('#ne-scheme-tpl-section');
            if (tplSection) tplSection.style.display = isSwitchMode ? '' : 'none';

            // Toggle field editing panel (hidden in switch_template)
            var fieldsEditor = cardEl.querySelector('#ne-scheme-fields-editor');
            if (fieldsEditor) fieldsEditor.style.display = isSwitchMode ? 'none' : '';

            // Toggle version history (edit_current only)
            var vhSection = cardEl.querySelector('#ne-scheme-version-section');
            if (vhSection) vhSection.style.display = (mode === 'edit_current') ? '' : 'none';

            // Toggle action buttons
            var applyBtn = cardEl.querySelector('#ne-scheme-apply-template');
            var saveBtn = cardEl.querySelector('#ne-scheme-save');
            var saveAsBtn = cardEl.querySelector('#ne-scheme-save-as-template');
            if (applyBtn) applyBtn.style.display = isSwitchMode ? '' : 'none';
            if (saveBtn) saveBtn.style.display = isSwitchMode ? 'none' : '';
            if (saveAsBtn) saveAsBtn.style.display = isSwitchMode ? 'none' : '';

            // Mode-specific field loading
            if (mode === 'edit_current') {
                var curDt = dtKey ? dialogueTemplates[dtKey] : null;
                if (!curDt && dtKey && dtKey.indexOf('_default_') === 0) {
                    var defMap = { '_default_pc': DEFAULT_PC_TEMPLATE, '_default_npc': DEFAULT_NPC_TEMPLATE, '_default_faction': DEFAULT_FACTION_TEMPLATE, '_default_task': DEFAULT_TASK_TEMPLATE, '_default_goal': DEFAULT_GOAL_TEMPLATE };
                    curDt = defMap[dtKey] || null;
                }
                _refreshSchemeCheckboxes(cardEl, (curDt && curDt.presetFields) || []);
                _refreshSchemeCustomFields(cardEl, (curDt && curDt.customFieldRefs) || []);
            } else if (mode === 'from_scratch') {
                _refreshSchemeCheckboxes(cardEl, []);
                _refreshSchemeCustomFields(cardEl, []);
                dtKey = null;
                tpl = null;
            }
        });
    }

    // Template selector — switch_template mode only: store selection for apply button
    var tplSelect = cardEl.querySelector('#ne-scheme-template-select');
    if (tplSelect) {
        tplSelect.addEventListener('change', function() {
            var selectedKey = this.value;
            if (!selectedKey) {
                dtKey = null;
                tpl = null;
                return;
            }
            if (selectedKey.indexOf('__global__') === 0) {
                var globalTplId = selectedKey.replace('__global__', '');
                dtKey = selectedKey; // keep marker for _applyTemplateSwitch
                tpl = templates[globalTplId] || null;
            }
        });
    }
    // Save
    var saveBtn = cardEl.querySelector('#ne-scheme-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            _saveSchemeChanges(cardEl, charName, protoName, dtKey, cardConfig);
        });
    }
    // Apply template (switch_template mode only)
    var applyBtn = cardEl.querySelector('#ne-scheme-apply-template');
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            _applyTemplateSwitch(cardEl, charName, protoName, cardConfig);
        });
    }
    // Cancel
    var cancelBtn = cardEl.querySelector('#ne-scheme-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            _exitSchemeEditMode(cardEl);
        });
    }
    // Save as template
    var saveAsBtn = cardEl.querySelector('#ne-scheme-save-as-template');
    if (saveAsBtn) {
        saveAsBtn.addEventListener('click', function() {
            _saveSchemeAsTemplate(cardEl, charName, protoName, dtKey, cardConfig);
        });
    }
    // Add custom field (Enter key)
    var addInput = cardEl.querySelector('#ne-scheme-add-custom-input');
    if (addInput) {
        addInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                _addSchemeCustomField(cardEl);
            }
        });
    }
    var addBtn = cardEl.querySelector('#ne-scheme-add-custom-btn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            _addSchemeCustomField(cardEl);
        });
    }
    var schemeTypeSelect = cardEl.querySelector('#ne-scheme-custom-type');
    if (schemeTypeSelect) {
        schemeTypeSelect.addEventListener('change', function() {
            var enumRow = cardEl.querySelector('#ne-scheme-custom-enum-row');
            var numRow = cardEl.querySelector('#ne-scheme-custom-num-row');
            var maxlenInput = cardEl.querySelector('#ne-scheme-custom-maxlen');
            if (enumRow) enumRow.style.display = (this.value === 'enum') ? '' : 'none';
            if (numRow) numRow.style.display = (this.value === 'number') ? 'flex' : 'none';
            if (maxlenInput) maxlenInput.style.display = (this.value === 'string' || this.value === 'enum') ? '' : 'none';
        });
    }
    // Remove custom field
    var removeBtns = cardEl.querySelectorAll('.ne-scheme-remove-custom');
    for (var i = 0; i < removeBtns.length; i++) {
        removeBtns[i].addEventListener('click', function() {
            this.closest('.ne-scheme-custom-item').remove();
        });
    }

    // P9: Version switch buttons - use restoreTemplateVersion from store
    var switchBtns = cardEl.querySelectorAll('[data-switch-version]');
    for (var j = 0; j < switchBtns.length; j++) {
        switchBtns[j].addEventListener('click', function() {
            var versionKey = this.getAttribute('data-switch-version');
            if (!versionKey || !protoName) return;
            var chatId = _getChatId();
            console.log('[NE Scheme Switch] versionKey:', versionKey, '| chatId:', chatId);
            if (!chatId) {
                console.warn('[NE Scheme Switch] chatId null — state NOT persisted');
                restoreTemplateVersion(protoName, versionKey);
                showToast(t('version_switched'), 'success', 2000);
                busEmit('vault:updated', {});
                return;
            }
            readState(chatId).then(function(vault) {
                console.log('[NE Scheme Switch] readState:', vault ? 'OK' : 'null');
                if (!vault || !vault.content || !vault.content.state) {
                    console.warn('[NE Scheme Switch] vault invalid — state NOT persisted');
                    restoreTemplateVersion(protoName, versionKey);
                    busEmit('vault:updated', {});
                    return;
                }
                var state = vault.content.state;
                var oldScheme = state.characters && state.characters[charName] && state.characters[charName]._scheme;
                var ok = restoreTemplateVersion(protoName, versionKey, state);
                console.log('[NE Scheme Switch] restoreTemplateVersion:', ok, '| old _scheme:', oldScheme);
                if (!ok) {
                    showToast(t('Save failed'), 'error', 3000);
                    return;
                }
                console.log('[NE Scheme Switch] writing state back to vault...');
                return writeState(chatId, vault).then(function() {
                    console.log('[NE Scheme Switch] state persisted OK');
                    showToast(t('version_switched'), 'success', 2000);
                    busEmit('vault:updated', { getChatId: chatId });
                });
            }).catch(function(err) {
                console.error('[NE Scheme Switch] error:', err);
                showToast(t('Save failed'), 'error', 3000);
            });
        });
    }

    // P10: Delete version buttons
    var delBtns = cardEl.querySelectorAll('[data-delete-version]');
    for (var d = 0; d < delBtns.length; d++) {
        delBtns[d].addEventListener('click', function() {
            var versionKey = this.getAttribute('data-delete-version');
            if (!versionKey || !protoName) return;
            showConfirm(t('Delete'), t('confirm_delete_copy'), t('Delete'), t('Cancel'), true).then(function(confirmed) {
                if (!confirmed) return;
                var ok = deleteTemplateVersion(protoName, versionKey);
                if (ok) {
                    showToast(t('copy_deleted'), 'success', 2000);
                    busEmit('vault:updated', {});
                } else {
                    showToast(t('cannot_delete_active'), 'error', 3000);
                }
            });
        });
    }

    // P11: History collapse toggles (switch_template + edit_current)
    var swToggle = cardEl.querySelector('#ne-scheme-history-toggle');
    if (swToggle) {
        swToggle.addEventListener('click', function() {
            var list = cardEl.querySelector('#ne-scheme-history-list');
            var arrow = cardEl.querySelector('#ne-scheme-history-arrow');
            if (list) {
                var isHidden = list.style.display === 'none';
                list.style.display = isHidden ? '' : 'none';
                if (arrow) arrow.textContent = isHidden ? '\u25BC' : '\u25B6';
            }
        });
    }
    var eduToggle = cardEl.querySelector('#ne-edu-history-toggle');
    if (eduToggle) {
        eduToggle.addEventListener('click', function() {
            var list = cardEl.querySelector('#ne-edu-history-list');
            var arrow = cardEl.querySelector('#ne-edu-history-arrow');
            if (list) {
                var isHidden = list.style.display === 'none';
                list.style.display = isHidden ? '' : 'none';
                if (arrow) arrow.textContent = isHidden ? '\u25BC' : '\u25B6';
            }
        });
    }
}

function _applyTemplateSwitch(cardEl, charName, protoName, cardConfig) {
    var tplSelect = cardEl.querySelector('#ne-scheme-template-select');
    if (!tplSelect || !tplSelect.value) return;

    var selectedKey = tplSelect.value;
    if (selectedKey.indexOf('__global__') !== 0) return;

    var globalTplId = selectedKey.replace('__global__', '');
    var lib = getEffectiveTemplates();
    var templates = (lib && lib.templates) ? lib.templates : {};
    var template = templates[globalTplId];
    if (!template) { showToast('Template not found', 'error', 3000); return; }

    // Clone global template into card-level dialogue templates
    var clonedKey = cloneTemplateToCard(protoName, template);
    if (!clonedKey) { showToast(t('Save failed'), 'error', 3000); return; }

    // Refresh cardConfig so it contains the new clone
    cardConfig = loadCardConfigSync(protoName) || cardConfig;
    var clonedDt = cardConfig._dialogueTemplates && cardConfig._dialogueTemplates[clonedKey];
    var tplId = clonedDt && clonedDt._templateId;

    // Persist scheme update — cascade same-template characters + current character
    var chatId = _getChatId();
    if (!chatId) { busEmit('vault:updated', {}); }
    else {
        readState(chatId).then(function(vault) {
            if (!vault || !vault.content || !vault.content.state) return;
            var vs = vault.content.state;
            if (!vs.characters) return;
            // Cascade to same-template characters (skip locked ones)
            if (tplId) {
                Object.keys(vs.characters).forEach(function(name) {
                    if (name === charName) return;
                    var c = vs.characters[name];
                    if (c._templateLocked) return;
                    var theirDtKey = c._scheme;
                    var dt = theirDtKey && cardConfig._dialogueTemplates && cardConfig._dialogueTemplates[theirDtKey];
                    if (dt && dt._templateId === tplId) {
                        c._scheme = clonedKey;
                    }
                });
            }
            if (vs.characters[charName]) {
                vs.characters[charName]._scheme = clonedKey;
            }
            return writeState(chatId, vault);
        }).then(function() {
            busEmit('vault:updated', { getChatId: chatId });
        }).catch(function() {
            busEmit('vault:updated', {});
        });
    }

    showToast(t('template_saved'), 'success', 3000);
    _exitSchemeEditMode(cardEl);
}

function _saveSchemeChanges(cardEl, charName, protoName, dtKey, cardConfig) {
    var presetFields = [];
    var checkboxes = cardEl.querySelectorAll('.ne-scheme-checkbox:checked');
    for (var i = 0; i < checkboxes.length; i++) {
        presetFields.push(checkboxes[i].value);
    }
    var customFieldRefs = [];
    var customItems = cardEl.querySelectorAll('.ne-scheme-custom-item span');
    for (var j = 0; j < customItems.length; j++) {
        customFieldRefs.push(customItems[j].textContent);
    }

    if (dtKey) {
        // Default sentinels (_default_pc/_default_npc/...) are virtual — not in cardConfig._dialogueTemplates.
        // Clone the corresponding DEFAULT_*_TEMPLATE to card-level first, then edit.
        if (dtKey.indexOf('_default_') === 0 && (!cardConfig._dialogueTemplates || !cardConfig._dialogueTemplates[dtKey])) {
            var defaultMap = {
                '_default_pc': DEFAULT_PC_TEMPLATE,
                '_default_npc': DEFAULT_NPC_TEMPLATE,
                '_default_faction': DEFAULT_FACTION_TEMPLATE,
                '_default_task': DEFAULT_TASK_TEMPLATE,
                '_default_goal': DEFAULT_GOAL_TEMPLATE
            };
            var defaultTpl = defaultMap[dtKey];
            if (defaultTpl) {
                var clonedKey = cloneTemplateToCard(protoName, defaultTpl);
                if (clonedKey) {
                    dtKey = clonedKey;
                    // Refresh cardConfig so editTemplateInCard can see the new clone
                    cardConfig = loadCardConfigSync(protoName) || cardConfig;
                }
            }
        }
        // Edit existing card-level template (immutable: creates new version)
        var oldDt = cardConfig && cardConfig._dialogueTemplates ? cardConfig._dialogueTemplates[dtKey] : null;
        var oldCustomRefs = oldDt ? (oldDt.customFieldRefs || []) : [];
        var newKey = editTemplateInCard(protoName, dtKey, presetFields, customFieldRefs);
        var savedKey = newKey;
        if (!newKey) {
            showToast(t('Save failed'), 'error', 3000);
            _exitSchemeEditMode(cardEl);
            return;
        }
    } else {
        // Create new global template and clone to card
        var tplId = 'tpl_' + Date.now();
        var newTpl = {
            id: tplId,
            name: charName,
            role: 'npc',
            presetFields: presetFields,
            customFieldRefs: customFieldRefs,
            tags: [],
            _locked: false,
            source: 'user_created',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        // Save to global library first (cloneTemplateToCard requires a global template)
        var lib = getEffectiveTemplates();
        var templates = (lib && lib.templates) ? lib.templates : {};
        templates[tplId] = newTpl;
        // Update cardConfig and character
        savedKey = cloneTemplateToCard(protoName, newTpl);
        if (!savedKey) {
            showToast(t('Save failed'), 'error', 3000);
            _exitSchemeEditMode(cardEl);
            return;
        }
    }

    // 维护字段库引用追踪
    var safeOldRefs = oldCustomRefs || [];
    var safeOldDtKey = dtKey || '';
    customFieldRefs.forEach(function(fn) {
        if (safeOldRefs.indexOf(fn) === -1) addTemplateRefToField(fn, savedKey);
    });
    safeOldRefs.forEach(function(fn) {
        if (customFieldRefs.indexOf(fn) === -1) removeTemplateRefFromField(fn, safeOldDtKey);
    });

    // Persist _scheme update — cascade same-template characters + current character
    var chatId = _getChatId();
    console.log('[NE Scheme Save] chatId:', chatId, '| charName:', charName, '| protoName:', protoName, '| savedKey:', savedKey, '| dtKey:', dtKey);
    if (!chatId) {
        console.warn('[NE Scheme Save] chatId is null — state NOT persisted');
        busEmit('vault:updated', {});
    }
    else {
        readState(chatId).then(function(vault) {
            console.log('[NE Scheme Save] readState returned:', vault ? 'OK' : 'null', '| has content:', !!(vault && vault.content), '| has state:', !!(vault && vault.content && vault.content.state));
            if (!vault || !vault.content || !vault.content.state) {
                console.warn('[NE Scheme Save] vault structure invalid — aborting writeState');
                return;
            }
            var vs = vault.content.state;
            if (!vs.characters) {
                console.warn('[NE Scheme Save] vs.characters missing — aborting writeState. state keys:', Object.keys(vs));
                return;
            }
            console.log('[NE Scheme Save] characters in state:', Object.keys(vs.characters), '| charName match:', !!vs.characters[charName]);
            // Cascade to same-template characters (skip locked ones)
            var freshConfig = loadCardConfigSync(protoName) || cardConfig || {};
            var saveDt = freshConfig._dialogueTemplates && freshConfig._dialogueTemplates[savedKey];
            var tplId = saveDt && saveDt._templateId;
            if (tplId) {
                Object.keys(vs.characters).forEach(function(name) {
                    if (name === charName) return;
                    var c = vs.characters[name];
                    if (c._templateLocked) return;
                    var theirDtKey = c._scheme;
                    var dt = theirDtKey && freshConfig._dialogueTemplates && freshConfig._dialogueTemplates[theirDtKey];
                    if (dt && dt._templateId === tplId) {
                        c._scheme = savedKey;
                    }
                });
            }
            if (vs.characters[charName]) {
                var oldScheme = vs.characters[charName]._scheme;
                vs.characters[charName]._scheme = savedKey;
                console.log('[NE Scheme Save] _scheme updated:', oldScheme, '->', savedKey);
            } else {
                console.warn('[NE Scheme Save] charName not in characters — _scheme NOT updated');
            }
            console.log('[NE Scheme Save] calling writeState...');
            return writeState(chatId, vault);
        }).then(function() {
            console.log('[NE Scheme Save] writeState completed, emitting vault:updated');
            busEmit('vault:updated', { getChatId: chatId });
        }).catch(function(err) {
            console.error('[NE Scheme Save] ERROR in save chain:', err);
            busEmit('vault:updated', {});
        });
    }

    showToast(t('template_saved'), 'success', 3000);
    _exitSchemeEditMode(cardEl);

}

function _saveSchemeAsTemplate(cardEl, charName, protoName, dtKey, cardConfig) {
    if (!dtKey) {
        showToast(t('save_scheme_first'), 'error', 3000);
        return;
    }
    showConfirm(
        t('save_as_template'),
        'Push current card template to global library?',
        t('Save'), t('Cancel')
    ).then(function(confirmed) {
        if (!confirmed) return;
        var result = pushTemplateToGlobal(protoName, dtKey);
        if (result) {
            showToast(t('template_saved'), 'success', 3000);
            _exitSchemeEditMode(cardEl);
        } else {
            showToast(t('Save failed'), 'error', 3000);
        }
    });
}

function _addSchemeCustomField(cardEl) {
    var input = cardEl.querySelector('#ne-scheme-add-custom-input');
    if (!input || !input.value.trim()) return;
    var fieldName = input.value.trim();
    // Conflict check with predefined fields
    if (ALL_PREDEFINED_FIELDS && ALL_PREDEFINED_FIELDS[fieldName]) {
        showToast(t('custom_field_conflict'), 'warn');
        return;
    }
    var listEl = cardEl.querySelector('#ne-scheme-custom-fields');
    if (!listEl) return;
    // Check duplicate
    var existing = listEl.querySelectorAll('.ne-scheme-custom-item span');
    for (var i = 0; i < existing.length; i++) {
        if (existing[i].textContent === fieldName) return;
    }

    // 读取类型和约束
    var typeSelect = cardEl.querySelector('#ne-scheme-custom-type');
    var fieldType = typeSelect ? typeSelect.value : 'string';
    var entry = { name: fieldName, type: fieldType, description: '', usedByTemplates: [] };

    if (fieldType === 'string' || fieldType === 'enum') {
        var maxlenInput = cardEl.querySelector('#ne-scheme-custom-maxlen');
        if (maxlenInput && maxlenInput.value) entry.max_length = parseInt(maxlenInput.value, 10) || 200;
    }
    if (fieldType === 'enum') {
        var enumInput = cardEl.querySelector('#ne-scheme-custom-enum-values');
        var enumRaw = enumInput && enumInput.value ? enumInput.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
        if (enumRaw.length > 0) entry.values = enumRaw;
    }
    if (fieldType === 'number') {
        var minInput = cardEl.querySelector('#ne-scheme-custom-min');
        var maxInput = cardEl.querySelector('#ne-scheme-custom-max');
        if (minInput && minInput.value !== '') entry.min = parseFloat(minInput.value);
        if (maxInput && maxInput.value !== '') entry.max = parseFloat(maxInput.value);
    }

    // 写入字段库
    addFieldToLibrary(fieldName, entry);

    var item = pdCreate('div');
    item.className = 'ne-scheme-field ne-scheme-custom-item';
    item.innerHTML = '<span>' + escapeHtml(fieldName) + '</span>' +
        '<span class="ne-custom-field-type">' + escapeHtml(fieldType) + '</span>' +
        '<button class="ne-btn-small ne-btn-danger ne-scheme-remove-custom" data-field="' + escapeHtml(fieldName) + '">\u2715</button>';
    item.querySelector('.ne-scheme-remove-custom').addEventListener('click', function() {
        item.remove();
    });
    listEl.appendChild(item);
    input.value = '';
    // 重置约束输入
    if (typeSelect) typeSelect.value = 'string';
    var enumRow = cardEl.querySelector('#ne-scheme-custom-enum-row');
    var numRow = cardEl.querySelector('#ne-scheme-custom-num-row');
    var maxlenInput2 = cardEl.querySelector('#ne-scheme-custom-maxlen');
    if (enumRow) enumRow.style.display = 'none';
    if (numRow) numRow.style.display = 'none';
    if (maxlenInput2) { maxlenInput2.value = '200'; maxlenInput2.style.display = ''; }
    showToast(t('custom_field_added'), 'success', 2000);
}

function _getCurrentState() {
    try {
        if (typeof window.__NE_CURRENT_VAULT_STATE !== 'undefined') return window.__NE_CURRENT_VAULT_STATE;
    } catch (e) {}
    try {
        if (_pendingInlineStorage && _pendingInlineStorage.vault && _pendingInlineStorage.vault.content) {
            return _pendingInlineStorage.vault.content.state;
        }
    } catch (e) {}
    return null;
}

function _getCurrentCharName() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.name2) return ctx.name2;
        }
    } catch (e) {}
    try {
        if (typeof window.__NE_CURRENT_CHAT_ID === 'function') return window.__NE_CURRENT_CHAT_ID();
    } catch (e) {}
    var st = _getCurrentState();
    return (st && st.protagonist_name) || null;
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
    var deleteBtn = cardDiv.querySelector('.ne-card-delete-btn');
    if (saveBtn) saveBtn.outerHTML = cardDiv._neOrigEditBtnHTML || '';
    if (cancelBtn && cancelBtn.parentNode) cancelBtn.remove();
    if (deleteBtn && deleteBtn.parentNode) deleteBtn.remove();

    var restoredEditBtn = cardDiv.querySelector('.ne-card-edit-btn');
    if (restoredEditBtn) {
        restoredEditBtn.onclick = function(e) { e.stopPropagation(); enterCardEditMode(this); };
    }

    cardDiv.classList.remove('ne-card-editing');
}

function deleteCharacterCard(cardDiv, charName) {
    var stored = _pendingInlineStorage;
    if (!stored || !stored.vault) return;
    var vault = stored.vault;
    var c = vault.content || {};
    var state = c.state || {};
    var chars = state.characters || {};

    delete chars[charName];
    state.characters = chars;
    c.state = state;

    var getChatId = stored.getChatId;
    writeState(getChatId(), vault).then(function() {
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
        '<button class="ne-inline-cancel" style="background:var(--grey-40);color:#fff;border:none;" aria-label="' + t('Cancel') + '">\u2190</button>' +
        '<button class="ne-inline-delete" style="background:#d32f2f;color:#fff;border:none;margin-left:2px;" aria-label="' + t('Delete') + '">\u{1F5D1}</button></td>';
    row.querySelector('.ne-inline-save').onclick = async function() {
        var period = row.querySelector('.ne-inline-period').value;
        var scene = row.querySelector('.ne-inline-scene').value;
        var event = row.querySelector('.ne-inline-event').value;
        try {
            await saveSingleEntry(entryType, entryId, { period: period, scene: scene, event: event });
        } catch (err) {
            showToast(t('Save failed:') + ' ' + err.message, 'error', 4000);
            return;
        }
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
        try {
            await deleteSingleEntry(entryType, entryId);
        } catch (err) {
            showToast(t('Delete failed:') + ' ' + err.message, 'error', 4000);
            return;
        }
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
        subMsgDisplay = t('Msg ') + subAbsMsgStart + '\u2013' + subAbsMsgEnd + ' / ' + msgCount + '\u6761';
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
    if (!entries || entries.length === 0) { tbody.innerHTML = '<tr><td colspan="6" style="color:#888;">' + t('(empty)') + '</td></tr>'; return; }
    var entryMap = {};
    entries.forEach(function(e) { if (e && e.id) entryMap[e.id] = e; });

    var rows = [];
    entries.forEach(function (entry, i) {
        var entryId = entry.id || (type + '_' + i);

        if (type === 'stm') {
            var stmNo = parseInt(String(entry.id || '').replace('stm_', ''), 10) || (i + 1);
            rows.push(renderStmRow(entry, { showEdit: true, no: stmNo, fontSize: '0.9em' }));
            return;
        }

        if (entry._type === 'orphan_group') {
            var groupId = entry._id;
            var groupStms = entry.stms || [];
            var firstStm = groupStms[0];
            var lastStm = groupStms[groupStms.length - 1];
            var msgLabel = (firstStm && lastStm)
                ? t('Msg ') + (firstStm.absMsgStart || '?') + '\u2013' + (lastStm.absMsgEnd || lastStm.absMsgStart || '?')
                : t('N/A');
            var countLabel = groupStms.length + '\u6761';
            var groupTitle = '[' + t('Unfiled') + '] ' + msgLabel + ' / ' + countLabel;
            var groupPeriod = (firstStm && firstStm.period) ? firstStm.period : '';
            var toggleBtn = '<span class="narrative_ltm_toggle" data-ltm-id="' + groupId + '" tabindex="0" role="button" aria-label="' + t('Toggle STM details') + '">\u25B6</span> ';

            rows.push('<tr data-entry-id="' + groupId + '" class="ne-orphan-group-row">'
                + '<td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td>'
                + '<td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + escapeHtml(groupPeriod) + '</td>'
                + '<td style="font-size:0.85em;max-width:150px;color:#888;">' + escapeHtml(msgLabel) + '</td>'
                + '<td><div style="font-style:italic;color:#888;">' + escapeHtml(groupTitle) + '</div></td>'
                + '<td></td>'
                + '</tr>');

            var detailRows = '';
            groupStms.forEach(function(stm, si) {
                detailRows += renderStmRow(stm, { showEdit: true, fontSize: '0.8em', no: si + 1 });
            });
            if (detailRows) {
                rows.push('<tr class="narrative_ltm_detail" data-ltm-parent="' + groupId + '">'
                    + '<td colspan="5"><div class="narrative_ltm_detail_container">'
                    + '<table class="narrative_ltm_sub_table"><tbody>' + detailRows + '</tbody></table>'
                    + '</div></td></tr>');
            }
            return;
        }

        var periodCell = entry.time_range || entry.period || '';
        var refs = entry.stm_refs || [];
        var idListFull = refs.join(', ');
        var idDisplay = refs.length > 0 ? '#STM ' + refs.join(', ') : '';
        var idListCell = '<td style="font-size:0.85em;max-width:150px;color:#888;" title="' + escapeHtml(idListFull || '') + '">' + escapeHtml(idDisplay || '') + '</td>';
        var toggleBtn = '<span class="narrative_ltm_toggle" data-ltm-id="' + entryId + '" tabindex="0" role="button" aria-label="' + t('Toggle STM details') + '">\u25B6</span> ';
        var titleStyle = entry.status === 'open' ? 'font-style:italic;color:#888;' : 'font-weight:bold;';
        rows.push('<tr data-entry-id="' + entryId + '"><td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + periodCell + '</td>' + idListCell + '<td>' + '<div style="' + titleStyle + '">' + (entry.title || entry.event || entry.summary || '') + (entry.status === 'open' ? '<span style="color:var(--ne-success);font-size:0.8em;">' + t('in_progress_label') + '</span>' : '') + '</div>' + (entry.title && entry.event && entry.event !== entry.title ? '<div style="font-size:0.85em;color:#999;">' + entry.event.substring(0, 120) + '</div>' : '') + '<td><button class="ne-inline-edit-btn" data-entry-id="' + entryId + '" data-entry-type="ltm" aria-label="' + t('Edit') + '">\u270E</button></td></tr>');

        rows.push('<tr class="narrative_ltm_detail" data-ltm-parent="' + entryId + '" data-lazy="1"><td colspan="5"></td></tr>');
    });
    tbody.innerHTML = rows.join('');
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
                    if (detailRow.getAttribute('data-lazy') === '1') {
                        var ltmId = detailRow.getAttribute('data-ltm-parent');
                        var ltmEntry = entryMap[ltmId];
                        var refs = (ltmEntry && ltmEntry.stm_refs) ? ltmEntry.stm_refs : [];
                        var lazyRows = '';
                        refs.forEach(function (stmId, si) {
                            var stm = stmIndexMap && stmIndexMap[stmId];
                            if (stm) {
                                var subNo = parseInt(stmId.replace('stm_', ''), 10) || (si + 1);
                                lazyRows += renderStmRow(stm, { showEdit: true, fontSize: '0.8em', no: subNo });
                            }
                        });
                        detailRow.innerHTML = '<td colspan="5"><div class="narrative_ltm_detail_container"><table class="narrative_ltm_sub_table"><tbody>' + lazyRows + '</tbody></table></div></td>';
                        detailRow.removeAttribute('data-lazy');
                        detailRow.querySelectorAll('.ne-inline-edit-btn').forEach(function(btn) {
                            btn.onclick = function() {
                                var row = this.closest('tr');
                                if (!row || row.classList.contains('ne-inline-row')) return;
                                var sid = this.getAttribute('data-entry-id');
                                toggleInlineEdit(row, sid, 'stm');
                            };
                        });
                    }
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
