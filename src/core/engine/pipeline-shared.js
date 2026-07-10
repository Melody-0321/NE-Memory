import { writeState, writeMemory } from '../vault/store.js';
import { persistVaultToChatFile } from '../auto-restore.js';
import { isStateSchemaEnabled, DEFAULT_GLOBAL_SCHEMA } from '../vault/schema.js';
import { safeJsonParse } from './json-fallback.js';

var _checkChatTag = '';

export function _checkChatIntegrity(tag) {
    try {
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        var chat = ctx && ctx.chat;
        if (!chat || !Array.isArray(chat)) return;
        for (var i = 0; i < chat.length; i++) {
            if (chat[i] === undefined || chat[i] === null) {
                if (!_checkChatTag) {
                    _checkChatTag = tag;
                    console.error('[NE-CHECK] chat[] corrupted at index ' + i + ' @ ' + tag + ' (total length=' + chat.length + ')');
                }
                return;
            }
        }
    } catch (e) {}
}

export function _resetCheckChatTag() { _checkChatTag = ''; }

export async function saveStateVault(chatId, stateVault) {
    stateVault.version = (stateVault.version || 0) + 1;
    stateVault.updated_at = new Date().toISOString();
    try {
        await writeState(chatId, stateVault);
    } catch (e) {
        console.error('[NE] saveStateVault failed:', e);
    }
}

export async function saveMemoryVault(chatId, memoryVault) {
    memoryVault.version = (memoryVault.version || 0) + 1;
    memoryVault.updated_at = new Date().toISOString();
    console.log('[NE-DIAG] saveMemoryVault chatId=' + chatId + ' v=' + memoryVault.version + ' unc=' + ((memoryVault.content && memoryVault.content.unconsolidated_stm) || []).length);
    try {
        await writeMemory(chatId, memoryVault);
    } catch (e) {
        console.error('[NE] saveMemoryVault failed:', e);
    }
}

export async function saveVault(chatId, vault) {
    console.warn('[NE] saveVault() is deprecated — use saveStateVault() or saveMemoryVault()');
    var stateVault = { chat_id: chatId, version: vault.version || 0, tokens: 0, updated_at: new Date().toISOString(), _meta: { created_at: (vault._meta && vault._meta.created_at) || new Date().toISOString(), last_state_task: (vault._meta && vault._meta.last_state_task) || null, last_state_time: (vault._meta && vault._meta.last_state_time) || null }, content: { state: vault.content.state || {}, story_time: vault.content.story_time || '', story_scene: vault.content.story_scene || '', story_date: vault.content.story_date || '', state_schema: vault.content.state_schema || null, state_css: vault.content.state_css || '', character_schema: vault.content.character_schema || null, _active_characters: vault.content._active_characters || [], faction_keywords: vault.content.faction_keywords || {} } };
    var memoryVault = { chat_id: chatId, version: vault.version || 0, tokens: 0, updated_at: new Date().toISOString(), _meta: { created_at: (vault._meta && vault._meta.created_at) || new Date().toISOString(), last_pipeline_task: (vault._meta && vault._meta.last_pipeline_task) || null, last_pipeline_time: (vault._meta && vault._meta.last_pipeline_time) || null }, content: { unconsolidated_stm: vault.content.unconsolidated_stm || [], stm_entries: vault.content.stm_entries || [], ltm_entries: vault.content.ltm_entries || [], cursor_state: vault.content.cursor_state || { stm: { position: 0, pending_partials: [], completedTurns: 0 }, ltm: { position: 0, pending_partials: [] } }, segment_counter: vault.content.segment_counter || 0, consolidate_threshold: vault.content.consolidate_threshold || 5, language: vault.content.language || 'zh', memory_config: vault.content.memory_config || {}, summary: vault.content.summary || '', current_scene: vault.content.current_scene || '', character_states: vault.content.character_states || {}, relationships: vault.content.relationships || [] }, stm_index: vault.stm_index || {}, link_index: vault.link_index || {}, memory_system_prompt: vault.memory_system_prompt || '' };
    try {
        await writeState(chatId, stateVault);
        await writeMemory(chatId, memoryVault);
        persistVaultToChatFile(vault);
    } catch (e) {
        console.error('[NE] saveVault (deprecated) failed:', e);
    }
}

export function ensureStateStructure(vault) {
    if (!vault.content.state) vault.content.state = {};
    vault.content.state_css = vault.content.state_css || '';
    var state = vault.content.state;
    var schema = vault.content.state_schema || DEFAULT_GLOBAL_SCHEMA;
    if (isStateSchemaEnabled()) {
        if (!schema) return;
        if (!vault.content.state_schema) {
            vault.content.state_schema = schema;
        }
    }
    schema = schema || DEFAULT_GLOBAL_SCHEMA;
    if (state.characters && schema.fields && schema.fields.characters) {
        var charSchema = schema.fields.characters.schema;
        if (charSchema && charSchema.fields && charSchema.fields['*']) {
            var template = charSchema.fields['*'].fields;
            Object.keys(state.characters).forEach(function (name) {
                var ch = state.characters[name];
                if (!ch || typeof ch !== 'object') {
                    state.characters[name] = {};
                    ch = state.characters[name];
                }
                Object.keys(template).forEach(function (fk) {
                    if (fk === '*') return;
                    if (ch[fk] === undefined) {
                        var ff = template[fk];
                        if (ff.type === 'boolean') ch[fk] = false;
                        else if (ff.type === 'number') ch[fk] = null;
                        else ch[fk] = '';
                    }
                });
            });
        }
    }
}

function initStateFromSchema(schema, knownKeys) {
    if (!schema || !schema.fields) return {};
    var state = {};
    Object.keys(schema.fields).forEach(function (key) {
        var field = schema.fields[key];
        if (!field) return;
        if (field.enabled === false) return;
        if (key === '*') {
            if (knownKeys && knownKeys.length > 0 && field.fields) {
                knownKeys.forEach(function (name) {
                    state[name] = {};
                    Object.keys(field.fields).forEach(function (fk) {
                        var ff = field.fields[fk];
                        if (fk === '*') return;
                        if (ff.type === 'boolean') {
                            state[name][fk] = false;
                        } else if (ff.type === 'number') {
                            state[name][fk] = 0;
                        } else {
                            state[name][fk] = '';
                        }
                    });
                });
            }
            return;
        }
        if (field.type === 'object') {
            if (field.schema) {
                state[key] = initStateFromSchema(field.schema, knownKeys);
            }
            return;
        }
        state[key] = '';
    });
    return state;
}

export function filterNewMessages(messages, processedIds) {
    return messages.filter(m => {
        const id = (m.id != null) ? m.id : m.mes_id;
        if (id == null) return true;
        return !processedIds.has(String(id));
    });
}

function flattenNestedChanges(changes, prefix) {
    prefix = prefix || '';
    var flat = {};
    Object.keys(changes).forEach(function(key) {
        var fullPath = prefix ? prefix + '.' + key : key;
        var val = changes[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            var childKeys = Object.keys(val);
            var hasNestedObjects = childKeys.some(function(ck) {
                return val[ck] !== null && typeof val[ck] === 'object' && !Array.isArray(val[ck]);
            });
            if (hasNestedObjects) {
                var sub = flattenNestedChanges(val, fullPath);
                Object.keys(sub).forEach(function(sk) { flat[sk] = sub[sk]; });
            } else {
                childKeys.forEach(function(ck) { flat[fullPath + '.' + ck] = val[ck]; });
            }
        } else {
            flat[fullPath] = val;
        }
    });
    return flat;
}

export function parseSTMResponse(llmResponse) {
    var text = String(llmResponse || '').trim();
    if (!text) {
        return { stmEntries: [], stateChanges: {} };
    }

    var stmEntries = [];
    var stateChanges = {};

    var parsed = safeJsonParse(text);
    if (parsed) {
        stmEntries = parsed.stm_entries || [];
        if (parsed.state_changes) {
            if (Array.isArray(parsed.state_changes)) {
                var flat = {};
                parsed.state_changes.forEach(function(item) {
                    if (item && item.path !== undefined) flat[item.path] = item.value;
                });
                stateChanges = isStateSchemaEnabled() ? flat : {};
            } else if (typeof parsed.state_changes === 'object') {
                var nested = isStateSchemaEnabled() ? parsed.state_changes : {};
                stateChanges = flattenNestedChanges(nested);
            }
        }
    } else {
        console.warn('[NE] State LLM response is not valid JSON');
        return { stmEntries: [], stateChanges: {} };
    }

    // 确保每条 entry 有 msgRange、status 和 entities 默认值
    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        if (!e.status) e.status = 'closed';
        if (!e.msgRange || e.msgRange.length !== 2) {
            e.msgRange = [i, i];
        }
        e.entities = [];
    }

    return { stmEntries: stmEntries, stateChanges: stateChanges };
}

export function handleQuestCompletion(state, validatedChanges, currentTime) {
    if (!state || !validatedChanges) return;
    currentTime = currentTime || '';
    if (!currentTime) return;

    Object.keys(validatedChanges).forEach(function (path) {
        var parts = path.split('.');
        if (parts.length === 4 && parts[0] === 'quests' && parts[1] === 'tasks' && parts[3] === 'status') {
            var taskName = parts[2];
            if (validatedChanges[path] === '已完成') {
                if (!state.quests) state.quests = {};
                if (!state.quests.tasks) state.quests.tasks = {};
                if (!state.quests.tasks[taskName]) state.quests.tasks[taskName] = {};
                state.quests.tasks[taskName].deadline = currentTime;
            }
        }
    });
}
