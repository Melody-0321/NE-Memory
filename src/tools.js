/**
 * tools.js — Tool-calling 注册（通过 TH API）
 */
import { read, rollbackByMsgIds } from './vault/store.js';
import { mergeStateChanges, validateStateChanges, isStateSchemaEnabled } from './vault/schema.js';
import { saveVaultWithSnapshot } from './engine/update.js';

export function registerAllTools(getChatId, getChatMessages) {
    if (typeof ToolManager === 'undefined') return;
    registerLookupMemorySource(getChatId, getChatMessages);
    registerLookupSTM(getChatId);
    registerUpdateOpeningSummary(getChatId);
    registerRollbackMemory(getChatId);
    if (isStateSchemaEnabled()) {
        registerVaultLookup(getChatId);
        registerUpdateState(getChatId);
    }
}

function registerLookupMemorySource(getChatId, getChatMessages) {
    ToolManager.registerFunctionTool({
        name: 'lookup_memory_source',
        displayName: 'Lookup Memory Source',
        description: 'Look up original conversation messages by their message IDs.',
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                chat_id: { type: 'string', description: 'Chat session ID.' },
                msg_ids: { type: 'array', items: { type: 'integer' }, description: 'Message IDs to retrieve (1-5 recommended).' }
            },
            required: ['chat_id', 'msg_ids']
        }),
        action: async function (args) {
            const startTime = Date.now();
            try {
                if (!args || !args.msg_ids) return 'Error: Missing msg_ids';
                const chat = getChatMessages();
                const idSet = new Set(args.msg_ids);
                const messages = chat.filter(m => idSet.has(m.id || m.mes_id));
                if (messages.length === 0) return 'No matching messages found.';
                const result = messages.map(m => {
                    const name = m.name || '';
                    return `[#${m.id || m.mes_id}] ${name ? name + ': ' : ''}${m.mes || ''}`;
                }).join('\n');
                return result;
            } catch (e) {
                return 'Error: ' + e.message;
            }
        }
    });
}

function registerLookupSTM(getChatId) {
    ToolManager.registerFunctionTool({
        name: 'lookup_stm',
        displayName: 'Lookup STM Details',
        description: 'Look up detailed short-term memory entries by their IDs.',
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                stm_ids: { type: 'array', items: { type: 'string' }, description: 'STM entry IDs (1-5 recommended).' }
            },
            required: ['stm_ids']
        }),
        action: async function (args) {
            try {
                const chatId = getChatId ? getChatId() : 'default';
                const vault = await read(chatId);
                const content = vault.content || {};
                const allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
                const idSet = new Set(args.stm_ids);
                const found = allSTM.filter(e => idSet.has(e.id));
                if (found.length === 0) return 'No STM entries found.';
                return found.map(e => {
                    const periodLabel = e.period ? `[${e.period}] ` : '';
                    const timeLabel = e.time_label ? `${e.time_label}·` : '';
                    const refs = (e.msg_ids || []).map(mid => `msg#${mid}`).join(', ');
                    return `${periodLabel}${timeLabel}${e.scene || ''}: ${e.event || ''}${refs ? ' [→' + refs + ']' : ''}`;
                }).join('\n');
            } catch (e) {
                return 'Error: ' + e.message;
            }
        }
    });
}

function registerVaultLookup(getChatId) {
    ToolManager.registerFunctionTool({
        name: 'vault_lookup',
        displayName: 'Vault Lookup',
        description: 'Look up any tracked entity from the narrative vault. Type "character" for full character detail cards (personality, appearance, inner thoughts, affection, relationship, inventory, injuries, etc.). Type "faction" for faction details (leader, attitude, relations, notes). Type "quest" for tasks, goals, or world events (all fields including progress, reward, penalty).',
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['character', 'faction', 'quest'], description: 'Entity type to look up.' },
                name: { type: 'string', description: 'Exact name of the entity to look up.' }
            },
            required: ['type', 'name']
        }),
        action: async function (args) {
            try {
                const chatId = getChatId ? getChatId() : 'default';
                const vault = await read(chatId);
                const content = vault.content || {};
                const state = content.state || {};

                if (args.type === 'character') {
                    return lookupCharacter(state, args.name);
                } else if (args.type === 'faction') {
                    return lookupFaction(state, args.name);
                } else if (args.type === 'quest') {
                    return lookupQuest(state, args.name);
                }
                return 'Unknown entity type: ' + args.type;
            } catch (e) {
                return 'Error: ' + e.message;
            }
        }
    });
}

function lookupCharacter(state, name) {
    const characters = state.characters || {};
    const card = characters[name];
    if (!card || typeof card !== 'object') {
        return 'Character "' + name + '" not found. Available: ' + Object.keys(characters).join(', ');
    }

    var lines = [];
    lines.push('=== ' + name + ' ===');
    lines.push('');

    var npcNames = state.npc_names;
    var isNPC = npcNames && Array.isArray(npcNames) && npcNames.indexOf(name) !== -1;

    var coreFields = ['name', 'gender_age', 'occupation', 'clothing_build', 'personality', 'status'];
    coreFields.forEach(function (key) {
        if (card[key] !== undefined && card[key] !== null && card[key] !== '') {
            lines.push(key + ': ' + String(card[key]));
        }
    });

    if (isNPC) {
        if (card.inner_thoughts) lines.push('inner_thoughts: ' + String(card.inner_thoughts));
        if (card.affection !== undefined && card.affection !== null) lines.push('affection: ' + card.affection + '/100');
        if (card.relationship) lines.push('relationship: ' + String(card.relationship));
        if (card.current_mood) lines.push('current_mood: ' + String(card.current_mood));
        if (card.past_experience) lines.push('past_experience: ' + String(card.past_experience));
    }

    if (card.injuries) lines.push('injuries: ' + String(card.injuries));
    if (card.status_effects) lines.push('status_effects: ' + String(card.status_effects));
    if (card.clothing_mode !== undefined) lines.push('clothing_mode: ' + (card.clothing_mode ? 'detailed' : 'simple'));

    var inv = card.inventory;
    var invMode = card.inventory_mode || '关闭';
    if (invMode !== '关闭' && inv && typeof inv === 'object') {
        var invLines = [];
        if (inv.gold !== undefined && inv.gold !== null) invLines.push('Gold: ' + inv.gold + 'G');
        var items = inv.items || [];
        if (items.length > 0) {
            var itemDescs = items.map(function (item) {
                var desc = (item.name || '?') + (item.qty && item.qty > 1 ? ' x' + item.qty : '');
                if (item.equipped) desc += ' [Equipped]';
                if (item.desc) desc += ' - ' + item.desc;
                return desc;
            });
            invLines.push('Items: ' + itemDescs.join('; '));
        }
        if (invLines.length > 0) {
            lines.push('inventory_mode: ' + invMode);
            lines.push('inventory: ' + invLines.join(' | '));
        }
    }

    return lines.join('\n');
}

function lookupFaction(state, name) {
    const factions = state.factions || {};
    const faction = factions[name];
    if (!faction || typeof faction !== 'object') {
        return 'Faction "' + name + '" not found. Available: ' + Object.keys(factions).join(', ');
    }

    var lines = [];
    lines.push('=== ' + name + ' ===');
    lines.push('');

    if (faction.name) lines.push('name: ' + String(faction.name));
    if (faction.description) lines.push('description: ' + String(faction.description));
    if (faction.leader) lines.push('leader: ' + String(faction.leader));
    if (faction.attitude_toward_player) lines.push('attitude_toward_player: ' + String(faction.attitude_toward_player));
    if (faction.notes) lines.push('notes: ' + String(faction.notes));

    var relations = faction.relations;
    if (relations && typeof relations === 'object') {
        var relKeys = Object.keys(relations);
        if (relKeys.length > 0) {
            lines.push('');
            lines.push('--- Relations ---');
            relKeys.forEach(function (target) {
                lines.push(target + ': ' + String(relations[target]));
            });
        }
    }

    return lines.join('\n');
}

function lookupQuest(state, name) {
    const quests = state.quests;
    if (!quests || typeof quests !== 'object') {
        return 'No quests found in state.';
    }

    var found = null;
    var foundType = null;

    if (quests.tasks && typeof quests.tasks === 'object') {
        Object.keys(quests.tasks).forEach(function (key) {
            var t = quests.tasks[key];
            if (t && (t.name === name || key === name)) { found = t; foundType = 'task'; }
        });
    }
    if (!found && quests.goals && typeof quests.goals === 'object') {
        Object.keys(quests.goals).forEach(function (key) {
            var g = quests.goals[key];
            if (g && (g.name === name || key === name)) { found = g; foundType = 'goal'; }
        });
    }
    if (!found && quests.events && typeof quests.events === 'object') {
        Object.keys(quests.events).forEach(function (key) {
            var e = quests.events[key];
            if (e && (e.name === name || key === name)) { found = e; foundType = 'event'; }
        });
    }

    if (!found) {
        var allNames = [];
        ['tasks', 'goals', 'events'].forEach(function (section) {
            if (quests[section] && typeof quests[section] === 'object') {
                Object.keys(quests[section]).forEach(function (k) {
                    var item = quests[section][k];
                    allNames.push(item && item.name ? item.name : k);
                });
            }
        });
        return 'Quest "' + name + '" not found. Available: ' + (allNames.length > 0 ? allNames.join(', ') : '(none)');
    }

    var lines = [];
    var typeLabels = { task: '=== Task ===', goal: '=== Goal ===', event: '=== World Event ===' };
    lines.push(typeLabels[foundType] || '=== Quest ===');
    lines.push('');

    if (foundType === 'task') {
        if (found.name) lines.push('name: ' + String(found.name));
        if (found.deadline) lines.push('deadline: ' + String(found.deadline));
        if (found.status) lines.push('status: ' + String(found.status));
        if (found.type) lines.push('type: ' + String(found.type));
        if (found.issuer) lines.push('issuer: ' + String(found.issuer));
        if (found.desc) lines.push('desc: ' + String(found.desc));
        if (found.progress) lines.push('progress: ' + String(found.progress));
        if (found.posted_time) lines.push('posted_time: ' + String(found.posted_time));
        if (found.reward) lines.push('reward: ' + String(found.reward));
        if (found.penalty) lines.push('penalty: ' + String(found.penalty));
    } else if (foundType === 'goal') {
        if (found.name) lines.push('name: ' + String(found.name));
        if (found.status) lines.push('status: ' + String(found.status));
        if (found.desc) lines.push('desc: ' + String(found.desc));
        if (found.progress) lines.push('progress: ' + String(found.progress));
        if (found.posted_time) lines.push('posted_time: ' + String(found.posted_time));
        if (found.completed_time) lines.push('completed_time: ' + String(found.completed_time));
    } else if (foundType === 'event') {
        if (found.name) lines.push('name: ' + String(found.name));
        if (found.status) lines.push('status: ' + String(found.status));
        if (found.desc) lines.push('desc: ' + String(found.desc));
        if (found.started_time) lines.push('started_time: ' + String(found.started_time));
        if (found.ended_time) lines.push('ended_time: ' + String(found.ended_time));
    }

    return lines.join('\n');
}

function registerUpdateOpeningSummary(getChatId) {
    ToolManager.registerFunctionTool({
        name: 'update_opening_summary',
        displayName: 'Update Opening Summary',
        description: 'Provide an updated summary of the story opening.',
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: { text: { type: 'string', description: 'Updated opening summary text.' } },
            required: ['text']
        }),
        action: async function (args) {
            const chatId = getChatId ? getChatId() : 'default';
            const vault = await read(chatId);
            vault.content = vault.content || {};
            vault.content.opening_summary = vault.content.opening_summary || {};
            vault.content.opening_summary.text = args.text;
            vault.content.opening_summary.updated_at = new Date().toISOString();
            await saveVaultWithSnapshot(chatId, vault);
            return 'Opening summary updated successfully';
        }
    });
}

function registerUpdateState(getChatId) {
    ToolManager.registerFunctionTool({
        name: 'update_state',
        displayName: 'Update Current State',
        description: 'Update character/scene/time state. Each key is a JSON path like "time", "scene", "characters.Alice.status", "characters.Bob.mood". To change which characters are present, update characters.<name>.status to one of: 活跃/非活跃/已死亡/已归隐/已离去.',
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                changes: { type: 'object', description: 'Key-value pairs of state changes.' }
            },
            required: ['changes']
        }),
        action: async function (args) {
            const chatId = getChatId ? getChatId() : 'default';
            const vault = await read(chatId);
            const content = vault.content || {};
            const schema = content.state_schema || null;
            let validated;
            if (schema) {
                const result = validateStateChanges(schema, args.changes);
                if (result.warnings.length > 0) {
                    return 'Some changes rejected: ' + result.warnings.map(r => r.path + '(' + r.warning + ')').join(', ');
                }
                validated = result.validated;
            } else {
                validated = args.changes;
            }
            content.state = mergeStateChanges(content.state || {}, validated);
            vault.content = content;
            await saveVaultWithSnapshot(chatId, vault);
            return 'State updated successfully';
        }
    });
}

function registerRollbackMemory(getChatId) {
    ToolManager.registerFunctionTool({
        name: 'rollback_memory',
        displayName: 'Rollback Memory',
        description: 'Roll back vault memory entries that reference the given message IDs. Use when AI recalled wrong or fabricated information.',
        parameters: Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                msg_ids: { type: 'array', items: { type: 'integer' }, description: 'Message IDs to remove from memory (1-10 recommended).' }
            },
            required: ['msg_ids']
        }),
        action: async function (args) {
            try {
                const chatId = getChatId ? getChatId() : 'default';
                const removed = await rollbackByMsgIds(chatId, args.msg_ids);
                return 'Rolled back ' + (removed || 0) + ' memory entries referencing the given message IDs.';
            } catch (e) {
                return 'Error: ' + e.message;
            }
        }
    });
}
