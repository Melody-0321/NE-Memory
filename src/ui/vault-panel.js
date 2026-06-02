/**
 * ui/vault-panel.js — Vault 面板（精确复制 v0.1.0 UI）
 *
 * 通过 window.parent.document 操作主 ST 页面 DOM。
 * Drawer HTML 结构与 v0.1.0 完全一致。
 */
import { read, write, rollbackByMsgIds, isStorageBlocked } from '../vault/store.js';
import { listSnapshots, restoreSnapshot, deleteSnapshot } from '../vault/versions.js';
import { executeConsolidation } from '../engine/consolidate.js';
import { executeIncrementalUpdate } from '../engine/update.js';
import { t_narrative } from '../i18n.js';
import { escapeHtml, formatLocalTime } from './utils.js';
import { renderStateWithTemplate, STATE_TEMPLATES } from './state-templates.js';
import { formatStateSummary, DEFAULT_CHARACTER_SCHEMA, formatCharacterSummary, formatActiveCharacterSummary, DEFAULT_FACTION_SCHEMA, formatQuestSummary, isStateSchemaEnabled } from '../vault/schema.js';
import { renderConfigDialog } from './config-dialog.js';
import { telemetryBuffer, recordTelemetry, callMemoryRetrieval } from '../api/llm.js';
import { filterCandidates } from '../vault/retrieval-filter.js';
import { buildRetrievalMessages } from '../engine/retrieval.js';

/* ──────── 工具 ──────── */

function t(key) { return t_narrative(key); }

var PD = window.parent.document;
function qs(sel) { return PD.querySelector(sel); }
function qsa(sel) { return PD.querySelectorAll(sel); }
function byId(id) { return PD.getElementById(id); }

function freezeIframeHeight() {
    try { if (window.frameElement) { window.frameElement.style.height = '0px'; window.frameElement.style.minHeight = '0px'; } } catch (e) {}
}

function setVaultActivity(active) {
    var el = byId('narrative_vault_activity');
    if (!el) return;
    if (active) {
        el.innerHTML = '&#9696;';
        el.style.color = '#4caf50';
        el.style.animation = 'fa-spin 1s linear infinite';
    } else {
        el.innerHTML = '&#9679;';
        el.style.color = '#888';
        el.style.animation = '';
    }
}

function injectPinCSS() {
    if (byId('ne_pin_style')) return;
    var style = PD.createElement('style');
    style.id = 'ne_pin_style';
    style.textContent = '#narrative_vault_pin_div{font-size:24px;display:inline;padding:1px;opacity:0.5;transition:0.2s}' +
        '#narrative_vault_pin_div:hover,#narrative_vault_pin_div:has(:focus-visible){opacity:1}' +
        '#narrative_vault_pin{display:none}' +
        '#narrative_vault_pin:checked+label .checked{display:inline}' +
        '#narrative_vault_pin:checked+label .unchecked{display:none}' +
        '#narrative_vault_pin:not(:checked)+label .checked{display:none}' +
        '#narrative_vault_pin:not(:checked)+label .unchecked{display:inline}';
    PD.head.appendChild(style);
}

var vaultLLMLog = [];
var lastVaultStateJson = '{}';
var lastVaultStateTemplate = 'auto';

/* ──────── 面板切换 ──────── */

function createVaultPopout(getChatId) {
    var drawer = byId('narrative_vault_drawer');
    var icon = qs('#narrative_vault_toggle .drawer-icon');
    if (!drawer) return;
    var opening = !drawer.classList.contains('openDrawer');
    qsa('.openDrawer').forEach(function (el) { if (!el.classList.contains('pinnedOpen')) { el.classList.remove('openDrawer'); el.classList.add('closedDrawer'); } });
    qsa('.openIcon').forEach(function (el) { if (!el.classList.contains('drawerPinnedOpen')) { el.classList.remove('openIcon'); el.classList.add('closedIcon'); } });
    drawer.classList.toggle('openDrawer');
    drawer.classList.toggle('closedDrawer');
    if (icon) { icon.classList.toggle('openIcon'); icon.classList.toggle('closedIcon'); }
    if (opening) updateVaultViewerPopout(getChatId);
}

export function toggleVaultPanel(getChatId) { createVaultPopout(getChatId); }

/* ──────── 角色卡面板渲染 ──────── */

var ACTIVE_STATUSES = ['活跃'];
var DEPARTED_STATUSES = ['已死亡', '已归隐', '已离去'];

function getCharacterCardType(name, state) {
    var npcNames = state && state.npc_names;
    if (npcNames && Array.isArray(npcNames) && npcNames.indexOf(name) !== -1) return 'npc';
    return 'protagonist';
}

function renderCharacterCard(name, card, schema, cardType) {
    var cardSchema = schema[cardType] || schema.npc;
    var fields = cardSchema.fields || {};
    var summaryLines = [];
    var detailLines = [];

    Object.keys(fields).forEach(function (key) {
        var fieldDef = fields[key];
        var val = card[key];
        if (val === undefined || val === null || val === '') return;
        if (key === 'status') return;

        var displayVal = key === 'clothing_build' && card.clothing_mode === true
            ? String(val).substring(0, 30) + '...'
            : String(val).substring(0, 50);

        if (fieldDef.expose_level === 'summary') {
            summaryLines.push(key + ': ' + displayVal);
        } else if (fieldDef.expose_level === 'detail') {
            detailLines.push(key + ': ' + escapeHtml(String(val)));
        }
    });

    // Virtual equipment: filter inventory items where equipped===true
    var equipmentHtml = '';
    var inventory = card.inventory;
    if (inventory && typeof inventory === 'object' && Array.isArray(inventory.items)) {
        var equipped = inventory.items.filter(function (item) { return item && item.equipped === true; });
        if (equipped.length > 0) {
            equipmentHtml = '<div style="margin-top:3px;font-size:0.85em;color:#e2b714;">Equipment: ';
            equipped.forEach(function (item) {
                equipmentHtml += escapeHtml(item.name || '?') + (item.qty && item.qty > 1 ? '\u00D7' + item.qty : '') + ' ';
            });
            equipmentHtml += '</div>';
        }
    }

    // Injuries / status_effects
    if (card.injuries) {
        detailLines.push('injuries: ' + escapeHtml(String(card.injuries)));
    }
    if (card.status_effects) {
        detailLines.push('status_effects: ' + escapeHtml(String(card.status_effects)));
    }

    // Inventory detail
    var invMode = card.inventory_mode || '关闭';
    if (invMode !== '关闭' && inventory && Array.isArray(inventory.items)) {
        var invLines = [];
        var allItems = inventory.items.filter(function (item) { return item && !item.equipped; });
        allItems.forEach(function (item) {
            invLines.push(escapeHtml(item.name || '?') + (item.qty && item.qty > 1 ? '\u00D7' + item.qty : ''));
        });
        if (invLines.length > 0 || (inventory.gold != null)) {
            var invHtml = '<div style="margin-top:2px;font-size:0.85em;">Inventory' + (invMode === '静态' ? ' (static)' : '') + ': ';
            if (inventory.gold != null) invHtml += escapeHtml(String(inventory.gold)) + 'G ';
            invHtml += invLines.join(', ') + '</div>';
            detailLines.push(invHtml);
        }
    }

    var powerSlotDefs = card.power_slot_defs;
    var powerSlotValues = card.power_slots;
    var powerSlotBar = '';
    if (powerSlotDefs && Array.isArray(powerSlotDefs) && powerSlotDefs.length > 0) {
        var slotParts = [];
        powerSlotDefs.forEach(function (def) {
            var val = (powerSlotValues && typeof powerSlotValues === 'object' && powerSlotValues[def.key]) || '-';
            slotParts.push(escapeHtml(String(def.label)) + ': ' + escapeHtml(String(val)));
        });
        if (slotParts.length > 0) {
            powerSlotBar = '<div style="margin-top:3px;font-size:0.85em;color:#e2b714;padding:3px 6px;background:var(--black20a);border-radius:3px;">' + slotParts.join(' | ') + '</div>';
        }
    }

    var cardId = 'ne_char_' + name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var statusLabel = card.status || '未知';

    var html = '<div class="ne_character_card" style="margin:4px 0;padding:6px 8px;background:var(--black30a);border-radius:4px;cursor:pointer;">' +
        '<div class="ne_char_header" data-card-id="' + cardId + '" style="display:flex;align-items:center;gap:6px;">' +
        '<span class="ne_char_toggle" style="font-size:0.8em;">\u25B6</span>' +
        '<b>' + escapeHtml(name) + '</b>' +
        '<span style="font-size:0.8em;color:var(--grey70);">[' + statusLabel + ']</span>' +
        '<span style="font-size:0.75em;color:var(--grey50);">' + (cardType === 'npc' ? 'NPC' : 'PC') + '</span>' +
        '</div>' +
        '<div class="ne_char_summary" style="font-size:0.85em;margin-top:3px;color:#ccc;">' + summaryLines.join(' | ') + '</div>' +
        powerSlotBar +
        equipmentHtml +
        '<div class="ne_char_detail" id="' + cardId + '_detail" style="display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;">' +
        detailLines.map(function (l) { return '<div style="margin:2px 0;">' + l + '</div>'; }).join('') +
        '</div>' +
        '</div>';

    return html;
}

function renderCharacterGroup(label, names, characters, schema, state) {
    if (names.length === 0) return '';
    var groupId = 'ne_char_group_' + label.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var headerColor = label === '活跃' ? '#4caf50' : (label === '已退场' ? '#f44336' : '#ff9800');

    var html = '<div class="ne_character_group" style="margin:6px 0;">' +
        '<div class="ne_group_header" data-group-id="' + groupId + '" style="font-weight:bold;font-size:0.9em;color:' + headerColor + ';cursor:pointer;padding:3px 0;border-bottom:1px solid var(--black30a);">' +
        '<span class="ne_group_toggle">\u25BC</span> ' + t(label) + ' (' + names.length + ')' +
        '</div>' +
        '<div class="ne_group_cards" id="' + groupId + '_cards">';

    names.forEach(function (name) {
        var card = characters[name];
        var cardType = getCharacterCardType(name, state);
        html += renderCharacterCard(name, card, schema, cardType);
    });

    html += '</div></div>';
    return html;
}

function renderCharacterPanelHTML(state, characterSchema) {
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
    var cardId = 'ne_faction_' + name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var attitude = faction.attitude_toward_player || '未知';
    var attitudeColor = attitude === '友好' ? '#4caf50' : (attitude === '敌对' ? '#f44336' : (attitude === '冷淡' ? '#ff9800' : '#ff9800'));

    var summaryFields = [];
    if (faction.name) summaryFields.push('name: ' + escapeHtml(String(faction.name).substring(0, 20)));
    var displayAttitude = faction.attitude_toward_player || '未知';
    summaryFields.push('attitude: <span style="color:' + attitudeColor + '">' + escapeHtml(displayAttitude) + '</span>');

    var detailLines = [];
    if (faction.description) detailLines.push('<div style="margin:2px 0;">description: ' + escapeHtml(String(faction.description)) + '</div>');
    if (faction.leader) detailLines.push('<div style="margin:2px 0;">leader: ' + escapeHtml(String(faction.leader)) + '</div>');
    if (faction.notes) detailLines.push('<div style="margin:2px 0;">notes: ' + escapeHtml(String(faction.notes)) + '</div>');

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

    var html = '<div class="ne_faction_card" style="margin:4px 0;padding:6px 8px;background:var(--black30a);border-radius:4px;cursor:pointer;">' +
        '<div class="ne_faction_header" data-card-id="' + cardId + '" style="display:flex;align-items:center;gap:6px;">' +
        '<span class="ne_faction_toggle" style="font-size:0.8em;">\u25B6</span>' +
        '<b>' + escapeHtml(name) + '</b>' +
        '<span style="font-size:0.8em;color:' + attitudeColor + ';">[' + escapeHtml(attitude) + ']</span>' +
        '</div>' +
        '<div class="ne_faction_summary" style="font-size:0.85em;margin-top:3px;color:#ccc;">' + summaryFields.join(' | ') + '</div>' +
        '<div class="ne_faction_detail" id="' + cardId + '_detail" style="display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;">' +
        detailLines.join('') +
        '</div>' +
        '</div>';

    return html;
}

function renderFactionPanelHTML(state) {
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

function formatActiveFactionSummary(state) {
    if (!state || !state.factions) return '';
    var factions = state.factions;
    var names = Object.keys(factions);
    if (names.length === 0) return '';

    var lines = [];
    names.forEach(function (name) {
        var faction = factions[name];
        if (!faction || typeof faction !== 'object') return;
        if (faction.attitude_toward_player === '中立') return;
        var parts = [];
        parts.push(name);
        if (faction.attitude_toward_player) parts.push(faction.attitude_toward_player);
        if (faction.leader) parts.push('leader=' + String(faction.leader).substring(0, 20));
        if (faction.description) parts.push(String(faction.description).substring(0, 40));
        if (faction.relations && typeof faction.relations === 'object') {
            var relPairs = [];
            Object.keys(faction.relations).forEach(function (target) {
                relPairs.push(target + ':' + String(faction.relations[target]).substring(0, 20));
            });
            if (relPairs.length > 0) parts.push('relations={' + relPairs.join(', ') + '}');
        }
        lines.push(parts.join(' | '));
    });

    return lines.length > 0 ? lines.join('\n') : '';
}

function renderQuestCard(key, entry, sectionType) {
    var cardId = 'ne_quest_' + sectionType + '_' + key.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    var statusLabel = entry.status || '未知';

    var statusColors = { '已完成': '#4caf50', '已达成': '#4caf50', '已失败': '#f44336', '已过期': '#ff9800', '正在进行': '#2196f3', '进行中': '#2196f3', '已放弃': '#888', '持续中': '#ff9800', '已平息': '#4caf50', '已结束': '#888' };
    var statusColor = statusColors[statusLabel] || '#888';

    var iconMap = {
        task: { open: '\u25CB', closed: '\u2714' },
        goal: { open: '\u2192', closed: '\u2714' },
        event: { open: '\u25B2', closed: '\u2714' }
    };
    var icons = iconMap[sectionType] || iconMap.task;
    var isCompleted = statusLabel === '已完成' || statusLabel === '已达成' || statusLabel === '已放弃' || statusLabel === '已失败' || statusLabel === '已过期' || statusLabel === '已平息' || statusLabel === '已结束';
    var iconChar = isCompleted ? icons.closed : icons.open;
    var iconColor = isCompleted ? '#4caf50' : '#888';

    var displayName = entry.name || key;
    var deadlineOrStatus = '';
    if (sectionType === 'task' && entry.deadline) {
        deadlineOrStatus = entry.deadline;
    }
    var statusText = sectionType === 'task' ? (entry.deadline || statusLabel) : statusLabel;

    var detailLines = [];
    if (sectionType === 'task') {
        if (entry.type) detailLines.push('<div style="margin:2px 0;">type: ' + escapeHtml(String(entry.type)) + '</div>');
        if (entry.issuer) detailLines.push('<div style="margin:2px 0;">issuer: ' + escapeHtml(String(entry.issuer)) + '</div>');
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">desc: ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.progress) detailLines.push('<div style="margin:2px 0;color:#e2b714;">progress: ' + escapeHtml(String(entry.progress)) + '</div>');
        if (entry.posted_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">posted: ' + escapeHtml(String(entry.posted_time)) + '</div>');
        if (entry.reward) detailLines.push('<div style="margin:2px 0;color:#4caf50;">reward: ' + escapeHtml(String(entry.reward)) + '</div>');
        if (entry.penalty) detailLines.push('<div style="margin:2px 0;color:#f44336;">penalty: ' + escapeHtml(String(entry.penalty)) + '</div>');
    } else if (sectionType === 'goal') {
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">desc: ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.progress) detailLines.push('<div style="margin:2px 0;color:#e2b714;">progress: ' + escapeHtml(String(entry.progress)) + '</div>');
        if (entry.posted_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">posted: ' + escapeHtml(String(entry.posted_time)) + '</div>');
        if (entry.completed_time) detailLines.push('<div style="margin:2px 0;color:#4caf50;">completed: ' + escapeHtml(String(entry.completed_time)) + '</div>');
    } else if (sectionType === 'event') {
        if (entry.desc) detailLines.push('<div style="margin:2px 0;">desc: ' + escapeHtml(String(entry.desc)) + '</div>');
        if (entry.started_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">started: ' + escapeHtml(String(entry.started_time)) + '</div>');
        if (entry.ended_time) detailLines.push('<div style="margin:2px 0;font-size:0.83em;color:var(--grey50);">ended: ' + escapeHtml(String(entry.ended_time)) + '</div>');
    }

    var html = '<div class="ne_quest_card" style="margin:4px 0;padding:6px 8px;background:var(--black30a);border-radius:4px;cursor:pointer;">' +
        '<div class="ne_quest_header" data-card-id="' + cardId + '" style="display:flex;align-items:center;gap:6px;">' +
        '<span class="ne_quest_toggle" style="font-size:0.8em;">\u25B6</span>' +
        '<span style="color:' + iconColor + ';">' + iconChar + '</span>' +
        '<b>' + escapeHtml(displayName) + '</b>' +
        '<span style="font-size:0.8em;color:' + statusColor + ';">[' + escapeHtml(statusText) + ']</span>' +
        '</div>' +
        '<div class="ne_quest_detail" id="' + cardId + '_detail" style="display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;">' +
        detailLines.join('') +
        '</div>' +
        '</div>';

    return html;
}

function renderQuestPanelHTML(state) {
    if (!state || !state.quests) return '';
    var quests = state.quests;

    var sectionsHtml = '';

    // Tasks
    if (quests.tasks && typeof quests.tasks === 'object' && Object.keys(quests.tasks).length > 0) {
        var taskHtml = '<div class="ne_quest_subsection" style="margin:8px 0;">' +
            '<div style="font-weight:bold;font-size:0.9em;color:#2196f3;padding:3px 0;border-bottom:1px solid var(--black30a);">\u25CB ' + t('Tasks') + '</div>';
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
            '<div style="font-weight:bold;font-size:0.9em;color:#ff9800;padding:3px 0;border-bottom:1px solid var(--black30a);">\u25B2 ' + t('World Events') + '</div>';
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

/* ──────── 面板内容渲染 ──────── */

async function updateVaultViewerPopout(getChatId) {
    var loading = byId('narrative_vault_loading');
    var errDiv = byId('narrative_vault_panel_error');
    if (loading) loading.style.display = '';
    if (errDiv) errDiv.style.display = 'none';
    var warnDiv = byId('narrative_vault_panel_storage_warn');
    if (warnDiv) {
        if (isStorageBlocked()) {
            warnDiv.textContent = t('Storage blocked: Memories cannot be saved. Disable tracking prevention for this site in your browser settings.');
            warnDiv.style.display = '';
        } else {
            warnDiv.style.display = 'none';
        }
    }
    try {
        var vault = await read(getChatId());
        var c = vault.content || {};
        lastVaultStateJson = c.state ? JSON.stringify(c.state, null, 2) : '{}';
        lastVaultStateTemplate = c.state_template || 'auto';

        var verEl = byId('narrative_vault_panel_version');
        if (verEl) {
            var verText = t('Version:') + ' ' + (vault.version || 0);
            var ts = formatLocalTime(vault.updated_at);
            if (ts) verText += ' \u00b7 ' + ts;
            verEl.textContent = verText;
        }

        var panelBody = verEl ? verEl.parentElement : null;
        if (!panelBody) return;

        // 移除旧区块
        qsa('.narrative_state_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_opening_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_faction_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_character_block').forEach(function (el) { el.remove(); });
        qsa('.narrative_quest_block').forEach(function (el) { el.remove(); });

        // State 区块
        if (isStateSchemaEnabled() && c.state && Object.keys(c.state).length > 0) {
            var stateHtml = renderStateWithTemplate(c.state, lastVaultStateTemplate);
            var templateOpts = '';
            var tkeys = Object.keys(STATE_TEMPLATES);
            if (tkeys.indexOf('auto') === -1) tkeys.unshift('auto');
            for (var ti = 0; ti < tkeys.length; ti++) {
                var sel = tkeys[ti] === lastVaultStateTemplate ? ' selected' : '';
                templateOpts += '<option value="' + tkeys[ti] + '"' + sel + '>' + tkeys[ti] + '</option>';
            }
            var stmView = byId('narrative_vault_panel_stm_view');
            if (stmView) {
                stmView.insertAdjacentHTML('beforebegin',
                    '<div class="narrative_state_block" style="margin-bottom:14px;">' +
                    '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Current State') + '</div>' +
                    '<div style="background:var(--black50a);padding:8px;border-radius:4px;font-size:0.9em;">' + stateHtml + '</div>' +
                    '<div style="margin-top:4px;">' +
                    '<div style="margin-top:4px;display:flex;align-items:center;gap:6px;">' +
                    '<span style="font-size:0.85em;">' + t('State Template') + ':</span>' +
                    '<select id="narrative_state_template_sel" class="text_pole" style="font-size:0.85em;width:auto;">' + templateOpts + '</select>' +
                    '</div>' +
                    '<div style="margin-top:4px;display:flex;gap:4px;">' +
                    '<button class="narrative_btn_extract_state menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Extract State') + '</button>' +
                    '<button class="narrative_clear_state_btn menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;color:#f44336;">' + t('Clear') + '</button>' +
                    '</div></div></div>'
                );
            }
        }

        // Character panel
        if (isStateSchemaEnabled()) {
            var charSchema = c.character_schema || null;
            var charHtml = renderCharacterPanelHTML(c.state || {}, charSchema);
            if (charHtml) {
                var stmViewChar = byId('narrative_vault_panel_stm_view');
                if (stmViewChar) {
                    stmViewChar.insertAdjacentHTML('beforebegin', charHtml);
                }
            }

            // Faction panel
            var factionHtml = renderFactionPanelHTML(c.state || {});
            if (factionHtml) {
                var stmViewFaction = byId('narrative_vault_panel_stm_view');
                if (stmViewFaction) {
                    stmViewFaction.insertAdjacentHTML('beforebegin', factionHtml);
                }
            }

            // Quest panel
            var questHtml = renderQuestPanelHTML(c.state || {});
            if (questHtml) {
                var stmViewQuest = byId('narrative_vault_panel_stm_view');
                if (stmViewQuest) {
                    stmViewQuest.insertAdjacentHTML('beforebegin', questHtml);
                }
            }
        }

        var stmIndexMap = {};
        (c.stm_entries || []).forEach(function (s) { stmIndexMap[s.id] = s; });
        (c.unconsolidated_stm || []).forEach(function (s) { stmIndexMap[s.id] = s; });

        renderMemoryTable('#narrative_vault_panel_ltm_body', c.ltm_entries || [], 'ltm', stmIndexMap);
        renderMemoryTable('#narrative_vault_panel_stm_body', c.unconsolidated_stm || [], 'stm');

        // State template change
        var stateSel = byId('narrative_state_template_sel');
        if (stateSel) {
            stateSel.onchange = async function () {
                lastVaultStateTemplate = stateSel.value;
                var vault2 = await read(getChatId());
                vault2.content.state_template = stateSel.value;
                await write(getChatId(), vault2);
                renderStateBlock();
            };
        }
        // Extract state
        qsa('.narrative_btn_extract_state').forEach(function (btn) {
            btn.onclick = function () { extractState(getChatId); };
        });
        // Clear state
        qsa('.narrative_clear_state_btn').forEach(function (btn) {
            btn.onclick = function () {
                if (confirm(t('Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.'))) {
                    c.state = {};
                    write(getChatId(), vault).then(function () { updateVaultViewerPopout(getChatId()); });
                }
            };
        });
    } catch (e) {
        if (errDiv) { errDiv.textContent = t('Failed to load vault:') + ' ' + e.message; errDiv.style.display = ''; }
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderStateBlock() {
    try {
        var vault = JSON.parse(lastVaultStateJson || '{}');
        var rendered = renderStateWithTemplate(vault, lastVaultStateTemplate);
        var container = qs('.narrative_state_block div[style*="background:var(--black50a);padding:8px"]');
        if (container) container.innerHTML = rendered;
    } catch (e) {}
}

async function extractState(getChatId) {
    setVaultActivity(true);
    try {
        var vault = await read(getChatId());
        if (!vault.content.state) vault.content.state = {};
        lastVaultStateJson = JSON.stringify(vault.content.state, null, 2);
        await executeConsolidation(getChatId());
        await updateVaultViewerPopout(getChatId);
    } catch (e) {
        console.error('[NE] Extract failed:', e);
    } finally {
        setVaultActivity(false);
    }
}

/* ──────── 编辑模式 ──────── */

var vaultEditData = null;

async function toggleVaultEditMode(getChatId) {
    var isEditing = byId('narrative_vault_panel_save_btn').style.display !== 'none';
    if (isEditing) {
        byId('narrative_vault_panel_ltm_view').style.display = '';
        byId('narrative_vault_panel_ltm_edit').style.display = 'none';
        byId('narrative_vault_panel_stm_view').style.display = '';
        byId('narrative_vault_panel_stm_edit').style.display = 'none';
        byId('narrative_vault_panel_edit_btn').textContent = t('Edit');
        byId('narrative_vault_panel_save_btn').style.display = 'none';
        vaultEditData = null;
        qsa('.narrative_opening_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_state_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_character_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_faction_block').forEach(function (el) { el.style.display = ''; });
        qsa('.narrative_quest_block').forEach(function (el) { el.style.display = ''; });
        var oe = byId('narrative_vault_panel_opening_edit');
        if (oe) oe.remove();
        var se = byId('narrative_vault_panel_state_edit');
        if (se) se.remove();
        updateVaultViewerPopout(getChatId);
    } else {
        var vault = await read(getChatId());
        vaultEditData = vault;
        buildEditForms(vault, getChatId);
        byId('narrative_vault_panel_edit_btn').textContent = t('Cancel');
        byId('narrative_vault_panel_save_btn').style.display = '';
    }
}

function buildEditForms(vault, getChatId) {
    var c = vault.content || {};
    byId('narrative_vault_panel_ltm_view').style.display = 'none';
    byId('narrative_vault_panel_stm_view').style.display = 'none';
    qsa('.narrative_opening_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_state_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_character_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_faction_block').forEach(function (el) { el.style.display = 'none'; });
    qsa('.narrative_quest_block').forEach(function (el) { el.style.display = 'none'; });

    var ltmEdit = byId('narrative_vault_panel_ltm_edit');
    ltmEdit.style.display = '';
    ltmEdit.innerHTML = '';
    var stmEdit = byId('narrative_vault_panel_stm_edit');
    stmEdit.style.display = '';
    stmEdit.innerHTML = '';

    // State edit
    if (lastVaultStateJson) {
        var se = PD.createElement('div');
        se.id = 'narrative_vault_panel_state_edit';
        se.style.marginBottom = '10px';
        se.innerHTML = '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Current State (JSON)') + '</div>' +
            '<textarea id="narrative_vault_state_textarea" style="width:100%;box-sizing:border-box;font-size:0.85em;resize:vertical;min-height:120px;font-family:monospace;" placeholder="{}">' + escapeHtml(lastVaultStateJson) + '</textarea>';
        var ltmView = byId('narrative_vault_panel_ltm_view');
        ltmView.parentNode.insertBefore(se, ltmView);
    }

    // LTM entry edit cards
    (c.ltm_entries || []).forEach(function (entry, i) {
        var card = PD.createElement('div');
        card.style.cssText = 'margin:4px 0;padding:6px;background:var(--black30a);border-radius:4px;';
        card.innerHTML = '<div style="display:flex;align-items:center;gap:6px;">' +
            '<input class="narrative_edit_period" data-id="' + entry.id + '" value="' + escapeHtml(entry.period || '') + '" style="width:80px;font-size:0.85em;" placeholder="Period">' +
            '<input class="narrative_edit_scene" data-id="' + entry.id + '" value="' + escapeHtml(entry.scene || '') + '" style="flex:1;font-size:0.85em;" placeholder="Scene">' +
            '<span class="narrative_del_entry" data-id="' + entry.id + '" style="cursor:pointer;color:#f44336;font-size:0.85em;" title="' + t('Delete') + '">&#10005;</span>' +
            '</div>' +
            '<textarea class="narrative_edit_event" data-id="' + entry.id + '" style="width:100%;box-sizing:border-box;margin-top:4px;min-height:40px;font-size:0.85em;" placeholder="Event">' + escapeHtml(entry.event || '') + '</textarea>';
        ltmEdit.appendChild(card);
    });

    // STM entry edit cards
    (c.unconsolidated_stm || []).forEach(function (entry, i) {
        var card = PD.createElement('div');
        card.style.cssText = 'margin:4px 0;padding:6px;background:var(--black30a);border-radius:4px;';
        card.innerHTML = '<div style="display:flex;align-items:center;gap:6px;">' +
            '<input class="narrative_edit_period" data-id="' + entry.id + '" value="' + escapeHtml(entry.period || '') + '" style="width:80px;font-size:0.85em;" placeholder="Period">' +
            '<input class="narrative_edit_scene" data-id="' + entry.id + '" value="' + escapeHtml(entry.scene || '') + '" style="flex:1;font-size:0.85em;" placeholder="Scene">' +
            '<span class="narrative_del_entry" data-id="' + entry.id + '" style="cursor:pointer;color:#f44336;font-size:0.85em;" title="' + t('Delete') + '">&#10005;</span>' +
            '</div>' +
            '<input class="narrative_edit_time_label" data-id="' + entry.id + '" value="' + escapeHtml(entry.time_label || '') + '" style="width:100%;margin-top:4px;font-size:0.85em;" placeholder="Time label">' +
            '<textarea class="narrative_edit_event" data-id="' + entry.id + '" style="width:100%;box-sizing:border-box;margin-top:4px;min-height:40px;font-size:0.85em;" placeholder="Event">' + escapeHtml(entry.event || '') + '</textarea>';
        stmEdit.appendChild(card);
    });

    // Delete entry toggle
    qsa('.narrative_del_entry').forEach(function (el) {
        el.onclick = function () {
            el.classList.toggle('deleted');
            el.style.opacity = el.classList.contains('deleted') ? '0.3' : '1';
            var card = el.parentElement.parentElement;
            if (card) card.style.opacity = el.classList.contains('deleted') ? '0.3' : '1';
        };
    });
}

async function saveVaultEdits(getChatId) {
    setVaultActivity(true);
    try {
        var vault = await read(getChatId());
        var c = vault.content || {};

        var stateTextarea = byId('narrative_vault_state_textarea');
        if (stateTextarea) {
            var st = String(stateTextarea.value || '').trim();
            if (st) {
                try { c.state = JSON.parse(st); } catch (e) { alert(t('State JSON invalid:') + ' ' + e.message); }
            } else {
                c.state = {};
            }
        }

        var ltmEntries = [];
        var deleteLtmIds = [];
        var ltmEdit = byId('narrative_vault_panel_ltm_edit');
        var cards = ltmEdit ? ltmEdit.querySelectorAll('[style*="background"]') : [];
        cards.forEach(function (card) {
            if (card.style.opacity === '0.3') {
                var delEl = card.querySelector('.narrative_del_entry');
                if (delEl && delEl.classList.contains('deleted')) deleteLtmIds.push(delEl.getAttribute('data-id'));
                return;
            }
            var periodEl = card.querySelector('.narrative_edit_period');
            if (!periodEl) return;
            var id = periodEl.getAttribute('data-id');
            ltmEntries.push({ id: id, period: periodEl.value || '', scene: (card.querySelector('.narrative_edit_scene') || {}).value || '', event: (card.querySelector('.narrative_edit_event') || {}).value || '' });
        });

        var stmEntries = [];
        var deleteStmIds = [];
        var stmEdit = byId('narrative_vault_panel_stm_edit');
        var cards2 = stmEdit ? stmEdit.querySelectorAll('[style*="background"]') : [];
        cards2.forEach(function (card) {
            if (card.style.opacity === '0.3') {
                var delEl = card.querySelector('.narrative_del_entry');
                if (delEl && delEl.classList.contains('deleted')) deleteStmIds.push(delEl.getAttribute('data-id'));
                return;
            }
            var periodEl = card.querySelector('.narrative_edit_period');
            if (!periodEl) return;
            var id = periodEl.getAttribute('data-id');
            stmEntries.push({ id: id, period: periodEl.value || '', scene: (card.querySelector('.narrative_edit_scene') || {}).value || '', event: (card.querySelector('.narrative_edit_event') || {}).value || '', time_label: (card.querySelector('.narrative_edit_time_label') || {}).value || '' });
        });

        var ltmList = c.ltm_entries || [];
        ltmEntries.forEach(function (e) { var f = ltmList.find(function (x) { return x.id === e.id; }); if (f) { f.period = e.period; f.scene = e.scene; f.event = e.event; } });
        deleteLtmIds.forEach(function (id) { c.ltm_entries = ltmList.filter(function (x) { return x.id !== id; }); });
        c.ltm_entries = ltmList.filter(function (x) { return deleteLtmIds.indexOf(x.id) === -1; });

        var stmList = c.unconsolidated_stm || [];
        stmEntries.forEach(function (e) { var f = stmList.find(function (x) { return x.id === e.id; }); if (f) { f.period = e.period; f.scene = e.scene; f.event = e.event; if (e.time_label) f.time_label = e.time_label; } });
        c.unconsolidated_stm = stmList.filter(function (x) { return deleteStmIds.indexOf(x.id) === -1; });

        vault.content = c;
        await write(getChatId(), vault);
        toggleVaultEditMode(getChatId);
    } catch (e) {
        console.error('[NE] Save edits failed:', e);
        alert(t('Save') + ' failed: ' + e.message);
    } finally {
        setVaultActivity(false);
    }
}

/* ──────── 表格渲染 ──────── */

export function renderMemoryTable(tbodyId, entries, type, stmIndexMap) {
    var tbody = qs(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!entries || entries.length === 0) { tbody.innerHTML = '<tr><td colspan="4" style="color:#888;">(empty)</td></tr>'; return; }
    entries.forEach(function (entry, i) {
        var periodCell = type === 'ltm' ? (entry.time_range || entry.period || '') : (entry.period || '') + (entry.time_label ? '\u00b7' + entry.time_label : '');
        var refs = type === 'ltm'
            ? (entry.stm_refs || []).map(function (r) { return '<span class="narrative_link stm-link" data-stm-id="' + r + '">[\u2192' + r + ']</span>'; }).join(' ')
            : (entry.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[\u2192' + mid + ']</span>'; }).join(' ');
        var entryId = entry.id || (type + '_' + i);
        var toggleBtn = type === 'ltm' ? '<span class="narrative_ltm_toggle" data-ltm-id="' + entryId + '" title="Toggle STM details">\u25B6</span> ' : '';
        tbody.innerHTML += '<tr data-entry-id="' + entryId + '"><td style="text-align:center;color:#888;width:2em;">' + toggleBtn + (i + 1) + '</td><td style="white-space:nowrap;font-size:0.85em;max-width:120px;">' + periodCell + '</td><td style="font-size:0.85em;max-width:100px;">' + (entry.scene || '') + '</td><td>' + (entry.event || entry.summary || '') + ' ' + refs + '</td></tr>';
        if (type === 'ltm') {
            var detailRows = '';
            var stmRefs = entry.stm_refs || [];
            stmRefs.forEach(function (stmId) {
                var stm = stmIndexMap && stmIndexMap[stmId];
                if (stm) {
                    detailRows += '<div class="narrative_ltm_stm_entry"><span class="narrative_ltm_stm_label">' + (stm.period || '') + (stm.time_label ? '\u00b7' + stm.time_label : '') + '</span><span class="narrative_ltm_stm_scene">' + (stm.scene || '') + '</span><span class="narrative_ltm_stm_event">' + (stm.event || stm.summary || '') + '</span>' + (stm.msg_ids || []).map(function (mid) { return '<span class="narrative_link msg-link" data-msg-id="' + mid + '">[\u2192' + mid + ']</span>'; }).join(' ') + '</div>';
                }
            });
            if (detailRows) { tbody.innerHTML += '<tr class="narrative_ltm_detail" data-ltm-parent="' + entryId + '" style="display:none;"><td colspan="4"><div class="narrative_ltm_detail_container">' + detailRows + '</div></td></tr>'; }
        }
    });
    if (type === 'ltm') {
        qsa('.narrative_ltm_toggle').forEach(function (el) {
            el.onclick = function () {
                var ltmId = el.getAttribute('data-ltm-id');
                var detailRow = qs('tr.narrative_ltm_detail[data-ltm-parent="' + ltmId + '"]');
                if (detailRow) { var h = detailRow.style.display === 'none'; detailRow.style.display = h ? '' : 'none'; el.textContent = h ? '\u25BC' : '\u25B6'; }
            };
        });
    }
}

/* ──────── 注入格式化 ──────── */

export function formatVaultForPrompt(vault, chatMessages) {
    var content = vault.content || {};
    var parts = [];
    if (vault.memory_system_prompt) { parts.push(vault.memory_system_prompt); parts.push('---'); }
    if (content.story_time || content.story_scene) {
        parts.push('## ' + t('Current Scene') + '\n' + (content.story_time ? content.story_time + ' · ' : '') + (content.story_scene || ''));
        parts.push('---');
    }
    if (content.state && Object.keys(content.state).length > 0) {
        if (isStateSchemaEnabled()) {
            var stateSchema = content.state_schema || null;
            var stateSummary = formatStateSummary(content.state, stateSchema);
            if (stateSummary) {
                parts.push('## ' + t('Current State') + '\n' + stateSummary);
                parts.push('---');
            }
            var charSummary = formatActiveCharacterSummary(content.state, content.character_schema || null);
            if (charSummary) {
                parts.push('## ' + t('Characters') + ' (' + t('活跃') + ')\n' + charSummary);
                parts.push('---');
            }
            var factionSummary = formatActiveFactionSummary(content.state);
            if (factionSummary) {
                parts.push('## ' + t('Factions') + '\n' + factionSummary);
                parts.push('---');
            }
            var questSummary = formatQuestSummary(content.state);
            if (questSummary) {
                parts.push('## ' + t('Quests') + '\n' + questSummary);
                parts.push('---');
            }
        }
    }

    // BM25 pre-filter: LTM + unconsolidated STM only (never stm_entries with parent_ltm)
    var ltm = content.ltm_entries || [];
    var unconsolidated = (content.unconsolidated_stm || []).filter(function (e) { return !e.parent_ltm; });
    var showLtm = ltm;
    var showStm = unconsolidated;

    if ((ltm.length > 0 || unconsolidated.length > 0) && typeof filterCandidates === 'function') {
        try {
            var query;
            if (chatMessages && chatMessages.length > 0) {
                var userMessages = [];
                for (var mi = chatMessages.length - 1; mi >= 0 && userMessages.length < 5; mi--) {
                    var m = chatMessages[mi];
                    if (m && (m.role === 'user' || m.is_user)) {
                        var text = typeof m.mes === 'string' ? m.mes : (m.content || '');
                        if (text && text.trim().length > 5) userMessages.unshift(text.trim().substring(0, 200));
                    }
                }
                query = userMessages.length > 0 ? userMessages.join(' ').substring(0, 500) : null;
            }
            if (!query) {
                var state = content.state || {};
                query = (state.time || '') + ' ' + (state.scene || '') + ' ' + (state.main_event || '');
                if (!query.trim()) query = 'recent events';
            }

            // Build full STM pool (unconsolidated + stm_entries)
            var allStm = [].concat(unconsolidated).concat(content.stm_entries || []);
            var allCandidates = [].concat(ltm).concat(allStm);
            if (allCandidates.length > 25) {
                var topK = filterCandidates(query, allStm, ltm, 25);
                showLtm = topK.filter(function (e) { return e.__type === 'ltm'; });
                showStm = topK.filter(function (e) { return e.__type === 'stm'; });
            }
        } catch (e) {
            console.warn('[NE] BM25 filter in formatVaultForPrompt failed, using full injection:', e);
        }
    }

    if (showLtm.length > 0) {
        var ltmLines = showLtm.map(function (e, i) { return '| ' + (i + 1) + ' | ' + (e.time_range || e.period || '') + ' | ' + (e.scene || '') + ' | ' + (e.event || '') + ' [\u2192' + (e.stm_refs || []).join(',') + '] |'; });
        parts.push('## ' + t('Long-term Memory (LTM) \u2014 Direct') + '\n| ' + t('No.') + ' | ' + t('Period') + ' | ' + t('Scene') + ' | ' + t('Event (Summary)') + ' |\n|' + '---|'.repeat(4) + '\n' + ltmLines.join('\n'));
    }
    if (showStm.length > 0) {
        var stmLines = showStm.map(function (e, i) {
            var label = e.period ? e.period + (e.time_label ? '\u00b7' + e.time_label : '') : '';
            return '| ' + (i + 1) + ' | ' + label + ' | ' + (e.scene || '') + ' | ' + (e.event || '') + ' [\u2192' + (e.msg_ids || []).join(',') + '] |';
        });
        parts.push('## ' + t('Short-term Memory (Unconsolidated) \u2014 Direct') + '\n| ' + t('No.') + ' | ' + t('Period') + ' | ' + t('Scene') + ' | ' + t('Event') + ' |\n|' + '---|'.repeat(4) + '\n' + stmLines.join('\n'));
    }
    parts.push('---', t('The following content is not directly injected. If needed, use access or recall tool.'));
    parts.push(t('[Tip] The chat history below is for recent context only. For older events, rely on the Memory section above.'));
    return parts.join('\n\n');
}

export function estimateComplexityBudget(chatMessages, defaultBudget) {
    defaultBudget = defaultBudget || 800;
    if (!chatMessages || chatMessages.length === 0) return defaultBudget;

    var lastMsg = chatMessages[chatMessages.length - 1];
    var text = (typeof lastMsg.mes === 'string' ? lastMsg.mes : '') || '';

    var len = text.length;
    var questionCount = (text.match(/[？?！!]/g) || []).length;
    var entityCount = (text.match(/(?:Dragonfang|Frost|爱丽丝|Ember|Elder Thorn|[A-Z][a-z]+)/g) || []).length;
    var narrativeKeywords = (text.match(/(?:为什么|什么时候|怎么|之前|后来|原因|动机)/g) || []).length;

    var score = 0;
    if (len < 100) score += 0;
    else if (len < 500) score += 1;
    else score += 2;

    if (questionCount <= 1) score += 0;
    else if (questionCount <= 3) score += 1;
    else score += 2;

    if (entityCount <= 1) score += 0;
    else if (entityCount <= 3) score += 1;
    else score += 2;

    if (narrativeKeywords <= 1) score += 0;
    else score += 1;

    if (score <= 1) return 500;
    if (score <= 4) return 800;
    return 1200;
}

export function formatSmartContext(vault, chatMessages, budget) {
    if (!budget) {
        budget = estimateComplexityBudget(chatMessages);
    }
    var content = vault.content || {};
    var state = content.state || {};

    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    var allLTM = content.ltm_entries || [];

    if (allSTM.length === 0 && allLTM.length === 0) {
        return formatMinimalState(vault);
    }

    var query;
    if (chatMessages && chatMessages.length > 0) {
        // Use recent user messages as query (get up to 5 most recent user messages)
        var userMessages = [];
        for (var i = chatMessages.length - 1; i >= 0 && userMessages.length < 5; i--) {
            var m = chatMessages[i];
            if (m && (m.role === 'user' || m.is_user)) {
                var text = typeof m.mes === 'string' ? m.mes : (m.content || '');
                if (text && text.trim().length > 5) userMessages.unshift(text.trim().substring(0, 200));
            }
        }
        query = userMessages.length > 0 ? userMessages.join(' ').substring(0, 500) : null;
    }
    if (!query) {
        var queryParts = [];
        if (content.story_time) queryParts.push(content.story_time);
        if (content.story_scene) queryParts.push(content.story_scene);
        if (state.time) queryParts.push(state.time);
        if (state.scene) queryParts.push(state.scene);
        if (state.main_event) queryParts.push(state.main_event);
        query = queryParts.length > 0 ? queryParts.join(' · ') : 'recent events';
    }

    var smartPushStart = Date.now();
    var bm25Start = Date.now();

    var topCandidates;
    try {
        topCandidates = filterCandidates(query, allSTM, allLTM, 40);
    } catch (e) {
        console.warn('[NE] BM25 filter failed, falling back to full injection:', e);
        return formatVaultForPrompt(vault);
    }
    var bm25Ms = Date.now() - bm25Start;

    if (!topCandidates || topCandidates.length === 0) {
        return formatMinimalState(vault);
    }

    var retrievalApiStart = Date.now();
    var synthesized;
    var smPushMethod;
    try {
        var messages = buildRetrievalMessages(query, topCandidates, vault, budget);
        var result = callMemoryRetrieval(messages, { timeout: 3 });

        if (result && typeof result.then === 'function') {
            console.warn('[NE] Async retrieval not yet supported, using BM25 top results');
            synthesized = formatBM25Results(query, topCandidates.slice(0, 5));
            smPushMethod = 'bm25_fallback';
        } else {
            synthesized = result;
            smPushMethod = 'llm_synthesis';
        }
    } catch (e) {
        console.warn('[NE] Retrieval LLM failed, using BM25 top results:', e);
        synthesized = formatBM25Results(query, topCandidates.slice(0, 5));
        smPushMethod = 'bm25_fallback';
    }
    var retrievalApiMs = Date.now() - retrievalApiStart;
    var smartPushTotalMs = Date.now() - smartPushStart;

    recordTelemetry({
        sm_push_method: smPushMethod,
        bm25_candidate_count: topCandidates ? topCandidates.length : 0,
        bm25_ms: bm25Ms,
        retrieval_api_ms: retrievalApiMs,
        smart_push_total_ms: smartPushTotalMs,
        injection_token_count: synthesized ? (typeof synthesized === 'string' ? synthesized.length : 0) : 0,
        memory_budget: budget
    });

    var parts = [];
    if (synthesized && typeof synthesized === 'string' && synthesized.trim()) {
        parts.push(synthesized.trim());
    }

    var stateLines = [];
    if (state.present_characters) {
        stateLines.push('Present: ' + state.present_characters);
    } else {
        var activeChars = [];
        var chars = state.characters || {};
        Object.keys(chars).forEach(function(name) {
            if (chars[name] && chars[name].status === '活跃') {
                activeChars.push(name);
            }
        });
        if (activeChars.length > 0) {
            stateLines.push('Present: ' + activeChars.join(', '));
        }
    }
    if (state.scene || content.story_scene) stateLines.push('Scene: ' + (state.scene || content.story_scene));
    if (state.time || content.story_time) stateLines.push('Time: ' + (state.time || content.story_time) + ' [→state:time]');

    if (stateLines.length > 0) {
        parts.push('---\n' + stateLines.join('\n'));
    }

    parts.push('---\nIf you need more historical details, use the recall_memory tool.');

    return parts.join('\n\n');
}

function formatMinimalState(vault) {
    var content = vault.content || {};
    var state = content.state || {};
    var lines = [];
    if (content.story_time || state.time || content.story_scene || state.scene) {
        lines.push('Scene: ' + (state.scene || content.story_scene || ''));
        if (content.story_time || state.time) lines.push('Time: ' + (state.time || content.story_time));
    }
    return lines.join('\n') || 'No state information available.';
}

function formatBM25Results(query, candidates) {
    if (!candidates || candidates.length === 0) return '';
    var lines = [];
    lines.push('## Relevant memories for: ' + query);
    lines.push('');
    candidates.forEach(function(c) {
        var timePart = (c.time_range || c.period || '');
        if (c.time_label) timePart = timePart + '·' + c.time_label;
        var refs = '';
        if (c.msg_ids && c.msg_ids.length > 0) {
            refs = ' [→' + c.msg_ids.join(',') + ']';
        } else if (c.stm_refs && c.stm_refs.length > 0) {
            refs = ' [→' + c.stm_refs.join(',') + ']';
        }
        lines.push('- [' + timePart + '] ' + (c.scene || '') + ': ' + (c.event || c.summary || '') + refs);
    });
    lines.push('');
    return lines.join('\n');
}

/* ──────── 面板初始化 ──────── */

export async function renderVaultPanel(getChatId) {
    try {
        if (byId('narrative_vault_holder')) return;
        injectPinCSS();
        var vault = await read(getChatId());
        var c = vault.content || {};

        var drawerHtml = '<div id="narrative_vault_holder" class="drawer">' +
            '<div class="drawer-toggle" id="narrative_vault_toggle">' +
            '<div class="drawer-icon fa-solid fa-book fa-fw closedIcon" title="' + t('Memory Vault') + '"></div>' +
            '</div>' +
            '<div id="narrative_vault_drawer" class="drawer-content closedDrawer fillRight">' +
            '<div id="narrative_vault_panel_header" class="fa-solid fa-grip drag-grabber"></div>' +
            '<div class="flex-container flexnowrap">' +
            '<div class="flexFlowColumn flex-container">' +
            '<div id="narrative_vault_pin_div" class="alignitemsflexstart" title="' + t('Locked = Memory Vault panel will stay open') + '">' +
            '<input type="checkbox" id="narrative_vault_pin">' +
            '<label for="narrative_vault_pin">' +
            '<div class="fa-solid unchecked fa-unlock right_menu_button" alt=""></div>' +
            '<div class="fa-solid checked fa-lock right_menu_button" alt=""></div>' +
            '</label></div></div></div>' +
            '<h3 class="margin0" style="white-space:nowrap;font-size:var(--mainFontSize);margin:auto;padding:0 8px;">' + t('Memory Vault') + '</h3>' +
            '<div class="scrollableInner" style="padding:10px;overflow-y:auto;font-size:var(--mainFontSize);">' +
            '<div style="display:flex;align-items:center;margin-bottom:6px;">' +
            '<div id="narrative_vault_panel_version" style="font-weight:bold;"></div>' +
            '<span id="narrative_vault_activity" style="margin-left:6px;font-size:0.8em;color:#888;">\u25CF</span></div>' +
            '<div id="narrative_vault_loading">' + t('Loading...') + '</div>' +
            '<div id="narrative_vault_panel_error" style="display:none;color:#f44336;"></div>' +
            '<div id="narrative_vault_panel_storage_warn" style="display:none;color:#ff9800;font-size:0.85em;margin-bottom:4px;border:1px solid #ff9800;padding:4px;border-radius:4px;"></div>' +
            '<div style="margin-bottom:10px;">' +
            '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Short-term Memory (STM)') + '</div>' +
            '<div id="narrative_vault_panel_stm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">No.</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;">' + t('Scene') + '</th><th style="text-align:left;">' + t('Event') + '</th></tr></thead>' +
            '<tbody id="narrative_vault_panel_stm_body"></tbody></table></div>' +
            '<div id="narrative_vault_panel_stm_edit" style="display:none;"></div></div>' +
            '<div>' +
            '<div style="font-weight:bold;margin:6px 0 3px;border-bottom:1px solid var(--black50a);">' + t('Long-term Memory (LTM)') + '</div>' +
            '<div id="narrative_vault_panel_ltm_view">' +
            '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.9em;">' +
            '<thead><tr><th style="text-align:center;width:2em;">No.</th><th style="text-align:left;">' + t('Period') + '</th><th style="text-align:left;">' + t('Scene') + '</th><th style="text-align:left;">' + t('Event (Summary)') + '</th></tr></thead>' +
            '<tbody id="narrative_vault_panel_ltm_body"></tbody></table></div>' +
            '<div id="narrative_vault_panel_ltm_edit" style="display:none;"></div></div>' +
            '<div style="margin-top:8px;display:flex;gap:4px;white-space:nowrap;">' +
            '<button id="narrative_vault_panel_refresh" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Refresh') + '</button>' +
            '<button id="narrative_vault_panel_edit_btn" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Edit') + '</button>' +
            '<button id="narrative_vault_panel_save_btn" class="menu_button" style="display:none;font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Save') + '</button>' +
            '<button class="narrative_btn_consolidate menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Consolidate') + '</button>' +
            '<button id="narrative_vault_process_history" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;margin-left:4px;" title="' + t('Process all past messages into memories') + '">' + t('Process History') + '</button>' +
            '</div>' +
            '<div style="margin-top:4px;display:flex;gap:4px;white-space:nowrap;">' +
            '<button id="narrative_vault_export_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Export JSON') + '</button>' +
            '<button id="narrative_vault_import_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Import JSON') + '</button>' +
            '<button id="narrative_vault_embed_chat" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;" title="' + t('Embed vault into chat_metadata so it travels with chat export/backup') + '">' + t('Embed into Chat') + '</button>' +
            '</div>' +
            '<div id="narrative_vault_llm_log" style="margin-top:10px;font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_llm_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('LLM Operation Log') + '</div>' +
            '<div id="narrative_vault_llm_entries" style="display:none;max-height:250px;overflow-y:auto;"></div></div>' +
            '<div id="narrative_vault_tool_call_log" style="font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_tool_call_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('Tool Calling Log') + '</div>' +
            '<div id="narrative_vault_tool_calls" style="display:none;max-height:200px;overflow-y:auto;"></div></div>' +
            '<div style="margin-top:8px;display:flex;gap:4px;">' +
            '<button id="narrative_vault_export_btn" class="menu_button" style="font-size:0.85em;padding:2px 8px;white-space:nowrap;">' + t('Export Logs') + '</button>' +
            '</div>' +
            '<div id="narrative_vault_history_section" style="font-size:0.8em;border-top:1px solid var(--black50a);">' +
            '<div id="narrative_vault_history_toggle" style="font-weight:bold;margin:6px 0 3px;cursor:pointer;color:var(--grey70);">\u25B6 ' + t('History') + '</div>' +
            '<div id="narrative_vault_history_list" style="display:none;max-height:250px;overflow-y:auto;font-size:0.85em;"></div></div>' +
            '</div></div></div>';

        var holder = byId('top-settings-holder');
        if (holder) {
            holder.insertAdjacentHTML('beforeend', drawerHtml);
        } else {
            console.error('[NE] #top-settings-holder not found');
            return;
        }

        byId('narrative_vault_toggle').onclick = function () { createVaultPopout(getChatId); };
        byId('narrative_vault_panel_refresh').onclick = function () {
            setVaultActivity(true);
            updateVaultViewerPopout(getChatId).finally(function () { setVaultActivity(false); });
        };
        byId('narrative_vault_panel_edit_btn').onclick = function () { toggleVaultEditMode(getChatId); };
        byId('narrative_vault_panel_save_btn').onclick = function () { saveVaultEdits(getChatId); };

        var consolidateBtn = qs('.narrative_btn_consolidate');
        if (consolidateBtn) {
            consolidateBtn.onclick = async function () {
                await executeConsolidation(getChatId());
                updateVaultViewerPopout(getChatId());
            };
        }

        var processHistoryBtn = byId('narrative_vault_process_history');
        if (processHistoryBtn) {
            processHistoryBtn.onclick = async function () {
                var chatMessages = [];
                try {
                    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                        chatMessages = SillyTavern.getContext().chat || [];
                    }
                } catch (e) {}

                if (chatMessages.length === 0) {
                    alert(t('No messages found in chat.'));
                    return;
                }

                // Filter to messages with actual content
                var toProcess = [];
                chatMessages.forEach(function (msg) {
                    var content = msg.mes || '';
                    if (content.trim().length > 0) {
                        toProcess.push({
                            id: msg.id || msg.mes_id,
                            is_user: !!msg.is_user,
                            mes: content,
                            name: msg.name || ''
                        });
                    }
                });

                if (toProcess.length === 0) {
                    alert(t('No messages with content to process.'));
                    return;
                }

                var prevText = processHistoryBtn.textContent;
                processHistoryBtn.textContent = t('Processing...');
                processHistoryBtn.disabled = true;
                var BATCH = 10;
                var totalBatches = Math.ceil(toProcess.length / BATCH);

                try {
                    for (var i = 0; i < toProcess.length; i += BATCH) {
                        var batch = toProcess.slice(i, i + BATCH);
                        var batchNum = Math.floor(i / BATCH) + 1;
                        processHistoryBtn.textContent = t('Processing...') + ' (' + batchNum + '/' + totalBatches + ')';
                        await executeIncrementalUpdate(getChatId(), batch, true);
                    }
                    await executeConsolidation(getChatId());
                } catch (e) {
                    console.error('[NE] Process history failed:', e);
                    alert(t('Process History') + ' failed: ' + e.message);
                } finally {
                    processHistoryBtn.textContent = prevText;
                    processHistoryBtn.disabled = false;
                    updateVaultViewerPopout(getChatId());
                }
            };
        }

        var exportBtn = byId('narrative_vault_export_json');
        if (exportBtn) {
            exportBtn.onclick = async function () {
                try {
                    var vault = await read(getChatId());
                    var json = JSON.stringify(vault, null, 2);
                    var blob = new Blob([json], { type: 'application/json' });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = 'ne_vault_' + getChatId() + '.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (e) {
                    console.error('[NE] Export failed:', e);
                    alert(t('Export JSON') + ' failed: ' + e.message);
                }
            };
        }

        var importBtn = byId('narrative_vault_import_json');
        if (importBtn) {
            importBtn.onclick = function () {
                var input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = async function () {
                    var file = input.files[0];
                    if (!file) return;
                    try {
                        var text = await file.text();
                        var vault = JSON.parse(text);
                        if (!vault || !vault.content) {
                            alert(t('Import JSON') + ' failed: invalid vault file');
                            return;
                        }
                        await write(getChatId(), vault);
                        updateVaultViewerPopout(getChatId());
                    } catch (e) {
                        console.error('[NE] Import failed:', e);
                        alert(t('Import JSON') + ' failed: ' + e.message);
                    }
                };
                input.click();
            };
        }

        var embedBtn = byId('narrative_vault_embed_chat');
        if (embedBtn) {
            embedBtn.onclick = async function () {
                try {
                    var ctx = window.parent.SillyTavern && window.parent.SillyTavern.getContext ? window.parent.SillyTavern.getContext() : null;
                    if (!ctx || !ctx.chatMetadata || typeof ctx.saveChat !== 'function') {
                        alert(t('Embed into Chat') + ': Cannot access SillyTavern chat API.');
                        return;
                    }
                    var vault = await read(getChatId());
                    ctx.chatMetadata.ne_vault = JSON.stringify(vault);
                    await ctx.saveChat();
                    alert(t('Embed into Chat') + ' ' + t('Done') + ' — ' + t('Vault is now embedded in chat_metadata. Export or backup will carry it.'));
                } catch (e) {
                    console.error('[NE] Embed failed:', e);
                    alert(t('Embed into Chat') + ' failed: ' + e.message);
                }
            };
        }

        // Pin
        byId('narrative_vault_pin').onchange = function () {
            var checked = byId('narrative_vault_pin').checked;
            byId('narrative_vault_drawer').classList.toggle('pinnedOpen', checked);
            qs('#narrative_vault_toggle .drawer-icon').classList.toggle('drawerPinnedOpen', checked);
        };

        // LLM log toggle
        byId('narrative_vault_llm_toggle').onclick = function () {
            var entries = byId('narrative_vault_llm_entries');
            var h = entries.style.display !== 'none';
            entries.style.display = h ? 'none' : '';
            byId('narrative_vault_llm_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('LLM Operation Log');
            if (!h) renderLLMLog();
        };

        // LLM log entry expand/collapse
        PD.addEventListener('click', function (e) {
            var header = e.target.closest('.ne_log_header');
            if (header) {
                var body = header.parentElement.querySelector('.ne_log_body');
                if (!body) return;
                var vis = body.style.display !== 'none';
                body.style.display = vis ? 'none' : '';
                header.textContent = (vis ? '\u25B6' : '\u25BC') + header.textContent.substring(1);
                return;
            }
            // Character card toggle
            var charHeader = e.target.closest('.ne_char_header');
            if (charHeader) {
                var cardId = charHeader.getAttribute('data-card-id');
                var detail = byId(cardId + '_detail');
                var toggle = charHeader.querySelector('.ne_char_toggle');
                if (detail) {
                    var vis = detail.style.display !== 'none';
                    detail.style.display = vis ? 'none' : '';
                    if (toggle) toggle.textContent = vis ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Faction card toggle
            var factionHeader = e.target.closest('.ne_faction_header');
            if (factionHeader) {
                var fCardId = factionHeader.getAttribute('data-card-id');
                var fDetail = byId(fCardId + '_detail');
                var fToggle = factionHeader.querySelector('.ne_faction_toggle');
                if (fDetail) {
                    var fVis = fDetail.style.display !== 'none';
                    fDetail.style.display = fVis ? 'none' : '';
                    if (fToggle) fToggle.textContent = fVis ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Quest card toggle
            var questHeader = e.target.closest('.ne_quest_header');
            if (questHeader) {
                var qCardId = questHeader.getAttribute('data-card-id');
                var qDetail = byId(qCardId + '_detail');
                var qToggle = questHeader.querySelector('.ne_quest_toggle');
                if (qDetail) {
                    var qVis = qDetail.style.display !== 'none';
                    qDetail.style.display = qVis ? 'none' : '';
                    if (qToggle) qToggle.textContent = qVis ? '\u25B6' : '\u25BC';
                }
                return;
            }
            // Character group toggle
            var groupHeader = e.target.closest('.ne_group_header');
            if (groupHeader) {
                var groupId = groupHeader.getAttribute('data-group-id');
                var cards = byId(groupId + '_cards');
                var toggle = groupHeader.querySelector('.ne_group_toggle');
                if (cards) {
                    var vis = cards.style.display !== 'none';
                    cards.style.display = vis ? 'none' : '';
                    if (toggle) toggle.textContent = vis ? '\u25B6' : '\u25BC';
                }
                return;
            }
        });

        // Tool call toggle
        byId('narrative_vault_tool_call_toggle').onclick = function () {
            var entries = byId('narrative_vault_tool_calls');
            var h = entries.style.display !== 'none';
            entries.style.display = h ? 'none' : '';
            byId('narrative_vault_tool_call_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('Tool Calling Log');
            if (!h) renderToolCallLog();
        };

        // History toggle
        byId('narrative_vault_history_toggle').onclick = function () {
            var list = byId('narrative_vault_history_list');
            var h = list.style.display !== 'none';
            list.style.display = h ? 'none' : '';
            byId('narrative_vault_history_toggle').textContent = (h ? '\u25B6' : '\u25BC') + ' ' + t('History');
            if (!h) renderHistory(getChatId);
        };

        // Export logs
        byId('narrative_vault_export_btn').onclick = function () {
            var data = { llm_log: vaultLLMLog, tool_log: narrativeToolCalls, telemetry: telemetryBuffer };
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var a = PD.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'ne_telemetry_' + new Date().toISOString().split('T')[0] + '.json';
            a.click();
        };

        freezeIframeHeight();
        renderConfigDialog(getChatId);
    } catch (e) {
        console.error('[NE] Vault panel render failed:', e);
    }
}

/* ──────── LLM 日志 ──────── */

var narrativeToolCalls = [];

function renderLLMLog() {
    var container = byId('narrative_vault_llm_entries');
    if (!container) return;
    var html = '';
    if (vaultLLMLog.length === 0) {
        html = '<div style="color:#888;padding:8px 0;">' + t('No operations logged') + '</div>';
    } else {
        vaultLLMLog.slice().reverse().forEach(function (entry) {
            html += '<div class="ne_log_entry"><div class="ne_log_header" style="cursor:pointer;font-weight:bold;color:var(--grey70);font-size:0.85em;">\u25BC ' + (entry.type || '') + ' \u00b7 ' + formatLocalTime(entry.time) + (entry.api_source ? ' \u00b7 [' + escapeHtml(entry.api_source) + ']' : '') + '</div>' +
                '<div class="ne_log_body"><div class="ne_log_label" style="color:#aaa;font-size:0.83em;">' + t('Request:') + '</div><pre class="ne_log_pre" style="margin:2px 0 6px;white-space:pre-wrap;max-height:200px;overflow-y:auto;background:var(--black50a);padding:4px;border-radius:2px;font-size:0.83em;">' + escapeHtml(entry.request || '') + '</pre>' +
                '<div class="ne_log_label" style="color:#aaa;font-size:0.83em;">' + t('Response:') + '</div><pre class="ne_log_pre" style="margin:2px 0 6px;white-space:pre-wrap;max-height:200px;overflow-y:auto;background:var(--black50a);padding:4px;border-radius:2px;font-size:0.83em;">' + escapeHtml(entry.response || '') + '</pre></div></div>';
        });
    }
    container.innerHTML = html;
}

function renderToolCallLog() {
    var container = byId('narrative_vault_tool_calls');
    if (!container) return;
    var html = '';
    if (narrativeToolCalls.length === 0) {
        html = '<div style="color:#888;padding:8px 0;">' + t('No tool calls recorded') + '</div>';
    } else {
        narrativeToolCalls.slice().reverse().forEach(function (entry) {
            var emoji = entry.success ? '\uD83D\uDFE2' : '\uD83D\uDD34';
            var dur = entry.duration_ms > 1000 ? (entry.duration_ms / 1000).toFixed(1) + 's' : entry.duration_ms + 'ms';
            html += '<div class="ne_tool_entry" style="margin:3px 0;padding:3px 4px;background:var(--black30a);border-radius:3px;font-size:0.85em;">' + emoji + ' ' + escapeHtml(entry.tool) + ' \u00b7 ' + formatLocalTime(entry.ts) + ' \u00b7 ' + dur + (entry.result_summary ? ' \u00b7 ' + escapeHtml(entry.result_summary) : '') + (entry.error_info ? ' \u00b7 <span style="color:#f44336;">' + escapeHtml(entry.error_info) + '</span>' : '') + '</div>';
        });
    }
    container.innerHTML = html;
}

/* ──────── 历史面板 ──────── */

async function renderHistory(getChatId) {
    var container = byId('narrative_vault_history_list');
    if (!container) return;
    try {
        var snapshots = await listSnapshots(getChatId());
        if (!snapshots || snapshots.length === 0) {
            container.innerHTML = '<div style="color:#888;padding:8px 0;">' + t('No history yet') + '</div>';
            return;
        }
        var html = '<table class="narrative_memory_table" style="width:100%;border-collapse:collapse;font-size:0.85em;">' +
            '<thead><tr><th>v</th><th>' + t('Version:').replace(':', '') + '</th><th>' + t('Scene') + '</th><th>' + t('Event') + '</th><th>' + t('Restore') + '</th><th>' + t('Delete') + '</th></tr></thead><tbody>';
        snapshots.forEach(function (snap) {
            var sc = snap.data && snap.data.content;
            var ltmCount = sc && sc.ltm_entries ? sc.ltm_entries.length : 0;
            var stmCount = sc && sc.unconsolidated_stm ? sc.unconsolidated_stm.length : 0;
            html += '<tr><td>' + snap.version + '</td><td>' + formatLocalTime(snap.updated_at) + '</td><td>' + ltmCount + ' LTM</td><td>' + stmCount + ' STM</td>' +
                '<td><button class="narrative_restore_btn menu_button" data-ver="' + snap.version + '" style="font-size:0.8em;padding:1px 5px;">' + t('Restore') + '</button></td>' +
                '<td><button class="narrative_del_btn menu_button" data-ver="' + snap.version + '" style="font-size:0.8em;padding:1px 5px;color:#f44336;">' + t('Delete') + '</button></td></tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;

        qsa('.narrative_restore_btn').forEach(function (btn) {
            btn.onclick = async function () {
                var ver = parseInt(btn.getAttribute('data-ver'));
                if (confirm(t('Restore to version v{VER}?').replace('{VER}', ver))) {
                    await restoreSnapshot(getChatId(), ver);
                    updateVaultViewerPopout(getChatId());
                }
            };
        });
        qsa('.narrative_del_btn').forEach(function (btn) {
            btn.onclick = async function () {
                var ver = parseInt(btn.getAttribute('data-ver'));
                if (confirm(t('Confirm delete v{VER}?').replace('{VER}', ver))) {
                    await deleteSnapshot(getChatId(), ver);
                    renderHistory(getChatId);
                }
            };
        });
    } catch (e) {
        container.innerHTML = '<div style="color:#f44336;">' + t('Failed to load history') + '</div>';
    }
}
