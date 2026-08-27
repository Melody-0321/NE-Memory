import { STATE_CONTENT_FIELDS, readVault } from '../vault/store.js';
import { isStateSchemaEnabled, DEFAULT_GLOBAL_SCHEMA } from '../vault/schema.js';
import { safeJsonParse } from './json-fallback.js';
import { writeStateWithDelta, writeMemoryWithVersion } from '../vault/state-versions.js';
import { persistVaultToChatFile } from '../auto-restore.js';

var _persistTimer = null;
var _persistChatId = null;

/**
 * 写桥：管线每次写入后，把合并后的完整 vault 持久化进 ST 服务端聊天文件
 * （chat_metadata.ne_vault），使聊天文件成为跨浏览器共通的权威源。
 *
 * 用 50ms 合并窗口去重：同一轮管线内 saveState + saveMemory 两次快速写入
 * 会合并成一次 saveChat。IndexedDB 始终是实时层，聊天文件持久化失败不阻塞主流程。
 *
 * @param {string} chatId
 */
export function persistMergedToChatFile(chatId) {
    if (_persistChatId === chatId && _persistTimer) return;
    _persistChatId = chatId;
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(function () {
        _persistTimer = null;
        _persistChatId = null;
        readVault(chatId).then(function (vault) {
            persistVaultToChatFile(vault);
        }).catch(function (e) {
            console.error('[NE] persist merged vault to chat file failed:', e);
        });
    }, 50);
}

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

/**
 * 保存 State Vault。若传入 deltaData，则 vault + delta + chain 在同一事务内原子写入，
 * 消除 vault 内容与版本链不同步的风险。
 *
 * @param {string} chatId
 * @param {object} stateVault
 * @param {object|null} [deltaData] — { source, summary, changes, message_dates }
 */
export async function saveStateVault(chatId, stateVault, deltaData) {
    stateVault.version = (stateVault.version || 0) + 1;
    stateVault.updated_at = new Date().toISOString();
    try {
        await writeStateWithDelta(chatId, stateVault, deltaData || null);
    } catch (e) {
        console.error('[NE] saveStateVault failed:', e);
        throw e;
    }
    persistMergedToChatFile(chatId);
}



function _stripStateFieldsForMemory(vault) {
    var content = vault && vault.content;
    if (!content) return vault;
    var hasStateField = false;
    for (var i = 0; i < STATE_CONTENT_FIELDS.length; i++) {
        if (content[STATE_CONTENT_FIELDS[i]] !== undefined) { hasStateField = true; break; }
    }
    if (!hasStateField) return vault;
    var cleanContent = {};
    Object.keys(content).forEach(function (k) {
        if (STATE_CONTENT_FIELDS.indexOf(k) === -1) cleanContent[k] = content[k];
    });
    return Object.assign({}, vault, { content: cleanContent });
}

/**
 * 保存 Memory Vault。若传入 versionData，则 vault + version + chain 在同一事务内原子写入，
 * 消除 vault 内容与版本链不同步的风险。
 *
 * @param {string} chatId
 * @param {object} memoryVault
 * @param {object|null} [versionData] — { type, summary, delta, message_dates, derived_from_stm_version }
 */
export async function saveMemoryVault(chatId, memoryVault, versionData) {
    var clean = _stripStateFieldsForMemory(memoryVault);
    clean.version = (clean.version || 0) + 1;
    clean.updated_at = new Date().toISOString();
    try {
        await writeMemoryWithVersion(chatId, clean, versionData || null);
    } catch (e) {
        console.error('[NE] saveMemoryVault failed:', e);
        throw e;
    }
    persistMergedToChatFile(chatId);
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

            var activeChars = vault.content._active_characters || [];
            Object.keys(state.characters).forEach(function (name) {
                var ch = state.characters[name];
                if (!ch || typeof ch !== 'object') return;
                if (!ch.status && activeChars.indexOf(name) !== -1) {
                    ch.status = '\u6D3B\u8DC3';
                }
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
        if (!Array.isArray(e.present_characters)) e.present_characters = [];
        if (!e.character_psyche || typeof e.character_psyche !== 'object') e.character_psyche = {};
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
