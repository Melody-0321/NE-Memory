/**
 * tools.js — Tool-calling 注册（通过 TH API）
 */
import { read } from './vault/store.js';
import { applyStateChanges, validateChanges } from './vault/schema.js';
import { saveVaultWithSnapshot } from './engine/update.js';

export function registerAllTools(getChatId, getChatMessages) {
    if (typeof ToolManager === 'undefined') return;
    registerLookupMemorySource(getChatId, getChatMessages);
    registerLookupSTM(getChatId);
    registerUpdateOpeningSummary(getChatId);
    registerUpdateState(getChatId);
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
        description: 'Update character/scene/time state. Each key is a JSON path like "time", "scene", "characters.Alice.mood".',
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
                const result = validateChanges(schema, args.changes);
                if (result.rejected.length > 0) {
                    return 'Some changes rejected: ' + result.rejected.map(r => r.path + '(' + r.error + ')').join(', ');
                }
                validated = result.validated;
            } else {
                validated = args.changes;
            }
            content.state = applyStateChanges(content.state || {}, validated);
            vault.content = content;
            await saveVaultWithSnapshot(chatId, vault);
            return 'State updated successfully';
        }
    });
}
