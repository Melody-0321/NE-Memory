// vault/schema.js — 状态 Schema 引擎
//
// Schema 是可选的结构化状态定义。当 state_schema 为 null/undefined 时，
// 所有路径回退到旧自由 JSON 行为。
//
import { t_field } from '../i18n.js';
// 功能：
//   - 字段级别类型校验 + max_length 截断 + enum 校验
//   - dot-path 递归解析
//   - 变更验证（未知字段警告但不阻塞，向后兼容）
//   - dot-path 深度合并
//   - 格式化摘要输出
//   - 全局块内置预设
//   - 角色卡 Schema 定义与校验
//
// 全局开关：可通过 isStateSchemaEnabled() / setStateSchemaEnabled() 控制整个 Schema 系统开关

let _stateSchemaEnabled = false;
let _dynamicStateMode = false;

export function isStateSchemaEnabled() {
    return _stateSchemaEnabled;
}

export function setStateSchemaEnabled(val) {
    if (val) {
        try {
            var raw = localStorage.getItem('ne_settings');
            if (raw) {
                var s = JSON.parse(raw);
                if (!s.memoryEnabled) {
                    console.warn('[NE] Cannot enable State Schema: Memory System is not enabled');
                    return;
                }
            }
        } catch (e) {}
    }
    _stateSchemaEnabled = !!val;
}

export function isDynamicStateMode() {
    return _stateSchemaEnabled && _dynamicStateMode;
}

export function setDynamicStateMode(val) {
    _dynamicStateMode = !!val;
}

// ─── Core Layer（永远存在，不受 Schema 开关影响）───

export const CORE_SCHEMA = {
    type: 'object',
    fields: {
        time: { type: 'string', max_length: 40, expose_level: 'summary', update_rule: 'replace' },
        scene: { type: 'string', max_length: 60, expose_level: 'summary', update_rule: 'replace' },
        story_date: { type: 'string', max_length: 40, expose_level: 'summary', update_rule: 'replace' }
    }
};

export const CORE_STATE_FIELDS = Object.keys(CORE_SCHEMA.fields);
// ['time', 'scene', 'story_date']

export const POWER_SLOTS_TEMPLATES = {
    cultivation: {
        name: 'cultivation',
        label_en: 'Cultivation',
        label_zh: '修仙体系',
        slots: {
            vitality: { key: 'vitality', label: '气血', label_en: 'Vitality', description: 'Physical health / vitality level' },
            energy: { key: 'energy', label: '灵力', label_en: 'Spiritual Energy', description: 'Spiritual power or mana reserve' },
            realm: { key: 'realm', label: '境界', label_en: 'Realm', description: 'Cultivation realm or stage' }
        }
    },
    scifi: {
        name: 'scifi',
        label_en: 'Sci-Fi',
        label_zh: '科幻体系',
        slots: {
            vitality: { key: 'vitality', label: '生命体征', label_en: 'Vitals', description: 'Physical health or bio-status' },
            energy: { key: 'energy', label: '能量', label_en: 'Energy', description: 'Energy reserves or power level' },
            realm: { key: 'realm', label: '权限等级', label_en: 'Clearance', description: 'Access level or rank within the system' }
        }
    },
    modern: {
        name: 'modern',
        label_en: 'Modern',
        label_zh: '现代体系',
        slots: {
            vitality: { key: 'vitality', label: '身体状况', label_en: 'Health', description: 'Physical condition' },
            energy: { key: 'energy', label: '精力', label_en: 'Stamina', description: 'Energy or mental stamina' },
            realm: { key: 'realm', label: '社会地位', label_en: 'Status', description: 'Social standing or rank' }
        }
    }
};

export const DEFAULT_GLOBAL_SCHEMA = {
    type: 'object',
    fields: {
        scene: { type: 'string', max_length: 60, expose_level: 'summary', update_rule: 'replace' },
        time: { type: 'string', max_length: 40, expose_level: 'summary', update_rule: 'replace' },
        story_date: { type: 'string', max_length: 40, expose_level: 'summary', update_rule: 'replace' },
        main_event: { type: 'string', max_length: 120, expose_level: 'summary', update_rule: 'replace' },
        present_characters: { type: 'string', max_length: 80, expose_level: 'summary', update_rule: 'replace' },
        factions: {
            type: 'object',
            enabled: false,
            schema: {
                type: 'object',
                fields: {
                    '*': {
                        type: 'object',
                        fields: {
                            name: { type: 'string', max_length: 20, expose_level: 'summary' },
                            description: { type: 'string', max_length: 80, expose_level: 'detail' },
                            leader: { type: 'string', max_length: 30, expose_level: 'detail' },
                            attitude_toward_player: { type: 'enum', values: ['友好', '中立', '冷淡', '敌对'], expose_level: 'summary' },
                            relations: { type: 'object', expose_level: 'detail' },
                            notes: { type: 'string', max_length: 200, expose_level: 'detail' }
                        }
                    }
                }
            }
        },
        quests: {
            type: 'object',
            enabled: false,
            schema: {
                type: 'object',
                fields: {
                    tasks: {
                        type: 'object',
                        schema: {
                            type: 'object',
                            fields: {
                                '*': {
                                    type: 'object',
                                    fields: {
                                        name: { type: 'string', max_length: 40, expose_level: 'summary' },
                                        deadline: { type: 'string', max_length: 30, expose_level: 'summary' },
                                        status: { type: 'enum', values: ['正在进行', '已完成', '已失败', '已过期'], expose_level: 'summary' },
                                        type: { type: 'enum', values: ['主线', '支线', '事件'], expose_level: 'detail' },
                                        issuer: { type: 'string', max_length: 30, expose_level: 'detail' },
                                        desc: { type: 'string', max_length: 200, expose_level: 'detail' },
                                        progress: { type: 'string', max_length: 60, expose_level: 'detail' },
                                        posted_time: { type: 'string', max_length: 30, expose_level: 'detail' },
                                        reward: { type: 'string', max_length: 100, expose_level: 'detail' },
                                        penalty: { type: 'string', max_length: 100, expose_level: 'detail' }
                                    }
                                }
                            }
                        }
                    },
                    goals: {
                        type: 'object',
                        schema: {
                            type: 'object',
                            fields: {
                                '*': {
                                    type: 'object',
                                    fields: {
                                        name: { type: 'string', max_length: 40, expose_level: 'summary' },
                                        status: { type: 'enum', values: ['进行中', '已达成', '已放弃'], expose_level: 'summary' },
                                        desc: { type: 'string', max_length: 200, expose_level: 'detail' },
                                        progress: { type: 'string', max_length: 60, expose_level: 'detail' },
                                        posted_time: { type: 'string', max_length: 30, expose_level: 'detail' },
                                        completed_time: { type: 'string', max_length: 30, expose_level: 'detail' }
                                    }
                                }
                            }
                        }
                    },
                    events: {
                        type: 'object',
                        schema: {
                            type: 'object',
                            fields: {
                                '*': {
                                    type: 'object',
                                    fields: {
                                        name: { type: 'string', max_length: 40, expose_level: 'summary' },
                                        status: { type: 'enum', values: ['持续中', '已平息', '已结束'], expose_level: 'summary' },
                                        desc: { type: 'string', max_length: 300, expose_level: 'detail' },
                                        started_time: { type: 'string', max_length: 30, expose_level: 'detail' },
                                        ended_time: { type: 'string', max_length: 30, expose_level: 'detail' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};

export const DEFAULT_FACTION_SCHEMA = {
    type: 'object',
    schema: {
        type: 'object',
        fields: {
            '*': {
                type: 'object',
                fields: {
                    name: { type: 'string', max_length: 20, expose_level: 'summary' },
                    description: { type: 'string', max_length: 80, expose_level: 'detail' },
                    leader: { type: 'string', max_length: 30, expose_level: 'detail' },
                    attitude_toward_player: { type: 'enum', values: ['友好', '中立', '冷淡', '敌对'], expose_level: 'summary' },
                    relations: { type: 'object', expose_level: 'detail' },
                    notes: { type: 'string', max_length: 200, expose_level: 'detail' }
                }
            }
        }
    }
};

export const DEFAULT_CHARACTER_SCHEMA = {
    protagonist: {
        fields: {
            name: { type: 'string', max_length: 30, expose_level: 'summary', required: true },
            gender_age: { type: 'string', max_length: 20, expose_level: 'summary', required: true },
            occupation: { type: 'string', max_length: 30, expose_level: 'summary', required: true },
            clothing_build: { type: 'string', max_length: 60, expose_level: 'detail', required: true },
            personality: { type: 'string', max_length: 80, expose_level: 'summary', required: true },
            status: { type: 'enum', values: ['活跃', '非活跃', '已死亡', '已归隐', '已离去'], expose_level: 'summary', required: true },
            clothing_mode: { type: 'boolean', expose_level: 'summary', required: false },
            inventory_mode: { type: 'enum', values: ['开启', '静态', '关闭'], expose_level: 'summary', required: false },
            inventory: { type: 'object', expose_level: 'detail', required: false },
            injuries: { type: 'string', max_length: 120, expose_level: 'detail', required: false },
            status_effects: { type: 'string', max_length: 120, expose_level: 'detail', required: false },
            power_slot_defs: { type: 'object', expose_level: 'detail', required: false },
            power_slots: { type: 'object', expose_level: 'summary', required: false }
        }
    },
    npc: {
        fields: {
            name: { type: 'string', max_length: 30, expose_level: 'summary', required: true },
            gender_age: { type: 'string', max_length: 20, expose_level: 'summary', required: true },
            occupation: { type: 'string', max_length: 30, expose_level: 'summary', required: true },
            clothing_build: { type: 'string', max_length: 60, expose_level: 'detail', required: true },
            personality: { type: 'string', max_length: 80, expose_level: 'summary', required: true },
            inner_thoughts: { type: 'string', max_length: 120, expose_level: 'detail', required: true },
            affection: { type: 'number', min: 0, max: 100, expose_level: 'summary', required: true },
            relationship: { type: 'string', max_length: 50, expose_level: 'summary', required: true },
            current_mood: { type: 'string', max_length: 30, expose_level: 'summary', required: true },
            past_experience: { type: 'string', max_length: 200, expose_level: 'detail', required: false },
            status: { type: 'enum', values: ['活跃', '非活跃', '已死亡', '已归隐', '已离去'], expose_level: 'summary', required: true },
            clothing_mode: { type: 'boolean', expose_level: 'summary', required: false },
            inventory_mode: { type: 'enum', values: ['开启', '静态', '关闭'], expose_level: 'summary', required: false },
            inventory: { type: 'object', expose_level: 'detail', required: false },
            injuries: { type: 'string', max_length: 120, expose_level: 'detail', required: false },
            status_effects: { type: 'string', max_length: 120, expose_level: 'detail', required: false },
            power_slot_defs: { type: 'object', expose_level: 'detail', required: false },
            power_slots: { type: 'object', expose_level: 'summary', required: false }
        }
    }
};

export const DEFAULT_QUESTS_SCHEMA = {
    tasks: {
        type: 'object',
        schema: {
            type: 'object',
            fields: {
                '*': {
                    type: 'object',
                    fields: {
                        name: { type: 'string', max_length: 40, expose_level: 'summary' },
                        deadline: { type: 'string', max_length: 30, expose_level: 'summary' },
                        status: { type: 'enum', values: ['正在进行', '已完成', '已失败', '已过期'], expose_level: 'summary' },
                        type: { type: 'enum', values: ['主线', '支线', '事件'], expose_level: 'detail' },
                        issuer: { type: 'string', max_length: 30, expose_level: 'detail' },
                        desc: { type: 'string', max_length: 200, expose_level: 'detail' },
                        progress: { type: 'string', max_length: 60, expose_level: 'detail' },
                        posted_time: { type: 'string', max_length: 30, expose_level: 'detail' },
                        reward: { type: 'string', max_length: 100, expose_level: 'detail' },
                        penalty: { type: 'string', max_length: 100, expose_level: 'detail' }
                    }
                }
            }
        }
    },
    goals: {
        type: 'object',
        schema: {
            type: 'object',
            fields: {
                '*': {
                    type: 'object',
                    fields: {
                        name: { type: 'string', max_length: 40, expose_level: 'summary' },
                        status: { type: 'enum', values: ['进行中', '已达成', '已放弃'], expose_level: 'summary' },
                        desc: { type: 'string', max_length: 200, expose_level: 'detail' },
                        progress: { type: 'string', max_length: 60, expose_level: 'detail' },
                        posted_time: { type: 'string', max_length: 30, expose_level: 'detail' },
                        completed_time: { type: 'string', max_length: 30, expose_level: 'detail' }
                    }
                }
            }
        }
    },
    events: {
        type: 'object',
        schema: {
            type: 'object',
            fields: {
                '*': {
                    type: 'object',
                    fields: {
                        name: { type: 'string', max_length: 40, expose_level: 'summary' },
                        status: { type: 'enum', values: ['持续中', '已平息', '已结束'], expose_level: 'summary' },
                        desc: { type: 'string', max_length: 300, expose_level: 'detail' },
                        started_time: { type: 'string', max_length: 30, expose_level: 'detail' },
                        ended_time: { type: 'string', max_length: 30, expose_level: 'detail' }
                    }
                }
            }
        }
    }
};

// validateField — 类型检查 + max_length 截断 + enum 值校验
export function validateField(value, fieldSchema) {
    if (!fieldSchema) return { ok: true, value: value };

    var type = fieldSchema.type;

    if (type === 'string') {
        if (typeof value !== 'string') {
            if (value === null || value === undefined) return { ok: true, value: '' };
            value = String(value);
        }
        if (fieldSchema.max_length && value.length > fieldSchema.max_length) {
            value = value.substring(0, fieldSchema.max_length);
        }
    } else if (type === 'number') {
        if (typeof value !== 'number') {
            var n = Number(value);
            if (isNaN(n)) return { ok: false, value: value, error: 'Expected number, got: ' + typeof value };
            value = n;
        }
        if (fieldSchema.min !== undefined && value < fieldSchema.min) {
            return { ok: false, value: value, error: 'Value below min: ' + fieldSchema.min };
        }
        if (fieldSchema.max !== undefined && value > fieldSchema.max) {
            return { ok: false, value: value, error: 'Value above max: ' + fieldSchema.max };
        }
    } else if (type === 'boolean') {
        if (typeof value !== 'boolean') {
            return { ok: false, value: value, error: 'Expected boolean, got: ' + typeof value };
        }
    } else if (type === 'enum') {
        if (!Array.isArray(fieldSchema.values) || fieldSchema.values.indexOf(value) === -1) {
            return { ok: false, value: value, error: 'Value not in enum: ' + JSON.stringify(fieldSchema.values) };
        }
    }

    return { ok: true, value: value };
}

// resolveSchemaPath — 递归解析 dot-separated 路径到 Schema 定义
export function resolveSchemaPath(stateSchema, dotPath) {
    if (!stateSchema) return null;
    var parts = dotPath.split('.');
    var current = stateSchema;
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!current) return null;
        if (current.type === 'object' && current.fields) {
            current = current.fields[part] || current.fields['*'] || null;
        } else if (current.type === 'object' && current.schema) {
            if (current.schema && current.schema.fields) {
                current = current.schema.fields[part] || current.schema.fields['*'] || null;
            } else {
                return null;
            }
        } else {
            return null;
        }
    }
    return current;
}

// validateStateChanges — 校验变更，未知字段警告但不阻塞（向后兼容）
export function validateStateChanges(stateSchema, changes) {
    var validated = {};
    var warnings = [];

    Object.keys(changes).forEach(function (path) {
        var fieldSchema = resolveSchemaPath(stateSchema, path);

        if (!fieldSchema) {
            warnings.push({ path: path, warning: 'Field not in schema, passing through: ' + path });
            validated[path] = changes[path];
            return;
        }

        var result = validateField(changes[path], fieldSchema);
        if (result.ok) {
            validated[path] = result.value;
        } else {
            warnings.push({ path: path, warning: result.error });
        }
    });

    return { validated: validated, warnings: warnings };
}

// rebuildPresentCharacters — 从 characters.*.status==='活跃' 重建 present_characters
export function rebuildPresentCharacters(state) {
    if (!state) return state;
    var characters = state.characters;
    if (!characters || typeof characters !== 'object') return state;
    var activeNames = [];
    Object.keys(characters).forEach(function (name) {
        var card = characters[name];
        if (card && typeof card === 'object' && card.status === '活跃') {
            activeNames.push(name);
        }
    });
    state.present_characters = activeNames.join(', ');
    return state;
}

// mergeStateChanges — 按 dot-path 深度合并到状态对象
// 每次合并后自动重建 present_characters
export function mergeStateChanges(state, validatedChanges) {
    var newState = JSON.parse(JSON.stringify(state || {}));

    var hasChanges = false;
    Object.keys(validatedChanges).forEach(function (path) {
        var parts = path.split('.');
        var current = newState;

        for (var i = 0; i < parts.length - 1; i++) {
            if (current[parts[i]] === undefined || current[parts[i]] === null || typeof current[parts[i]] !== 'object') {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }

        var lastKey = parts[parts.length - 1];
        current[lastKey] = validatedChanges[path];
        hasChanges = true;
    });

    if (hasChanges) {
        newState = rebuildPresentCharacters(newState);
    }

    return newState;
}

// ─── getEffectiveSchema — 根据当前模式返回实际生效的完整 schema ───

function mergeSchemas(core, extension) {
    var merged = JSON.parse(JSON.stringify(core));
    if (extension && extension.fields) {
        Object.keys(extension.fields).forEach(function (key) {
            if (!merged.fields[key]) {
                merged.fields[key] = extension.fields[key];
            }
        });
    }
    return merged;
}

function buildDynamicEffectiveSchema(vault) {
    var ds = vault.content.dynamic_state;
    var schema = JSON.parse(JSON.stringify(CORE_SCHEMA));

    // 从 dynamic_state 构建字符字段
    if (ds && ds.characters) {
        schema.fields.characters = { type: 'object', fields: {} };
        Object.keys(ds.characters).forEach(function (charName) {
            var fields = {};
            var charFields = ds.characters[charName];
            if (charFields && typeof charFields === 'object') {
                Object.keys(charFields).forEach(function (fieldName) {
                    fields[fieldName] = { type: 'string', expose_level: 'summary' };
                });
            }
            schema.fields.characters.fields[charName] = { type: 'object', fields: fields };
        });
    }

    // 可选：从 state_schema 合并 factions/quests（预设 schema）
    var stateSchema = vault.content.state_schema;
    if (stateSchema && stateSchema.fields) {
        if (stateSchema.fields.factions && stateSchema.fields.factions.enabled) {
            schema.fields.factions = stateSchema.fields.factions;
        }
        if (stateSchema.fields.quests && stateSchema.fields.quests.enabled) {
            schema.fields.quests = stateSchema.fields.quests;
        }
    }

    return schema;
}

/**
 * 返回当前实际生效的完整 schema：
 * - Schema OFF: 仅 CORE_SCHEMA
 * - Schema ON 预设: CORE_SCHEMA + state_schema 中的扩展字段
 * - Schema ON 动态: CORE_SCHEMA + 从 dynamic_state 构建的扩展字段
 */
export function getEffectiveSchema(vault) {
    if (!_stateSchemaEnabled) {
        return CORE_SCHEMA;
    }
    if (_dynamicStateMode && vault.content.dynamic_state) {
        return buildDynamicEffectiveSchema(vault);
    }
    return mergeSchemas(CORE_SCHEMA, vault.content.state_schema || DEFAULT_GLOBAL_SCHEMA);
}

/**
 * 仅渲染 Core 字段的状态摘要（用于 Schema OFF 时的面板显示）
 */
export function formatCoreStateSummary(state) {
    var lines = [];
    for (var i = 0; i < CORE_STATE_FIELDS.length; i++) {
        var key = CORE_STATE_FIELDS[i];
        if (state[key]) {
            lines.push(t_field(key) + ': ' + state[key]);
        }
    }
    return lines.join('\n');
}

/**
 * 从 dynamic_state 构建与 renderCharacterCard / formatCharacterSummary 兼容的字符 schema。
 * 返回 { protagonist: { fields: {...} }, npc: { fields: {...} } } 格式，或 null。
 */
export function buildDynamicCharacterSchema(dynamicState) {
    if (!dynamicState || !dynamicState.characters) return null;

    var allFields = {};
    var charKeys = Object.keys(dynamicState.characters);
    for (var i = 0; i < charKeys.length; i++) {
        var charFields = dynamicState.characters[charKeys[i]];
        if (charFields && typeof charFields === 'object') {
            var fieldKeys = Object.keys(charFields);
            for (var j = 0; j < fieldKeys.length; j++) {
                var fn = fieldKeys[j];
                if (!allFields[fn]) {
                    allFields[fn] = { type: 'string', expose_level: 'summary' };
                }
            }
        }
    }

    if (Object.keys(allFields).length === 0) return null;

    // 两个角色类型共用同一套动态字段
    return {
        protagonist: { fields: JSON.parse(JSON.stringify(allFields)) },
        npc: { fields: JSON.parse(JSON.stringify(allFields)) }
    };
}

// validateCharacterCard — 校验单个角色卡是否符合 protagonist/npc Schema 的 required 字段
export function validateCharacterCard(characterData, cardType) {
    var schema = DEFAULT_CHARACTER_SCHEMA[cardType];
    if (!schema) return { valid: false, errors: ['Unknown card type: ' + cardType] };

    var errors = [];
    var fields = schema.fields || {};

    Object.keys(fields).forEach(function (key) {
        var fieldDef = fields[key];
        if (!fieldDef.required) return;
        var val = characterData[key];
        if (val === undefined || val === null || val === '') {
            errors.push('Missing required field: ' + key);
        } else if (fieldDef.type === 'enum' && Array.isArray(fieldDef.values) && fieldDef.values.indexOf(val) === -1) {
            errors.push('Invalid enum value for ' + key + ': ' + val);
        }
    });

    return { valid: errors.length === 0, errors: errors };
}

// formatCharacterSummary — 将角色卡渲染为摘要文本行
export function formatCharacterSummary(state, characterSchema) {
    if (!state || !state.characters) return '';
    var schema = characterSchema || DEFAULT_CHARACTER_SCHEMA;
    var characters = state.characters;
    var lines = [];

    function getCardType(name) {
        var npcNames = state.npc_names;
        if (npcNames && Array.isArray(npcNames) && npcNames.indexOf(name) !== -1) return 'npc';
        return 'protagonist';
    }

    Object.keys(characters).forEach(function (name) {
        var card = characters[name];
        if (!card || typeof card !== 'object') return;
        var cardType = getCardType(name);
        var cardSchema = schema[cardType] || schema.npc;
        var fields = cardSchema.fields || {};

        var summaryFields = [];
        var status = card.status || '未知';
        summaryFields.push('[' + status + ']');

        Object.keys(fields).forEach(function (key) {
            var fieldDef = fields[key];
            if (fieldDef.expose_level !== 'summary') return;
            if (key === 'status') return;
            if (key === 'name') return; // 名字已在卡片标题显示
            var val = card[key];
            if (val !== undefined && val !== null && val !== '') {
                var strVal;
                if (typeof val === 'object') {
                    try { strVal = JSON.stringify(val); } catch (e) { strVal = String(val); }
                } else {
                    strVal = String(val);
                }
                summaryFields.push(key + '=' + strVal.substring(0, 40));
            }
        });

        if (summaryFields.length > 1) {
            lines.push(name + ': ' + summaryFields.join(', '));
        }
    });

    return lines.join('\n');
}

// formatActiveCharacterSummary — 只渲染 status==='活跃' 的角色摘要
export function formatActiveCharacterSummary(state, characterSchema) {
    if (!state || !state.characters) return '';
    var activeState = { characters: {}, npc_names: state.npc_names };
    var characters = state.characters;
    Object.keys(characters).forEach(function (name) {
        var card = characters[name];
        if (card && card.status === '活跃') {
            activeState.characters[name] = card;
        }
    });
    if (Object.keys(activeState.characters).length === 0) return '';
    return formatCharacterSummary(activeState, characterSchema);
}

// formatStateSummary — 有 Schema 时输出扁平摘要，无 Schema 时回退 JSON
export function formatStateSummary(state, stateSchema) {
    if (!stateSchema) {
        if (!state || Object.keys(state).length === 0) return '';
        try { return JSON.stringify(state); } catch (e) { return ''; }
    }

    var lines = [];

    // translate a dotted path, only translating the leaf field name
    function displayPath(fullPath) {
        var parts = fullPath.split('.');
        if (parts.length === 1) return t_field(parts[0]);
        parts[parts.length - 1] = t_field(parts[parts.length - 1]);
        return parts.join('.');
    }

    function walk(obj, prefix, sch) {
        if (!sch) return;
        if (sch.type !== 'object') return;

        var fields = sch.fields;
        if (!fields && sch.schema && sch.schema.type === 'object' && sch.schema.fields) {
            fields = sch.schema.fields;
        }
        if (!fields) return;

        var wildcardSch = fields['*'];
        var coveredKeys = {};

        Object.keys(fields).forEach(function (key) {
            if (key === '*') return;
            coveredKeys[key] = true;
            var fieldSch = fields[key];
            var fullPath = prefix ? prefix + '.' + key : key;
            var val = obj && obj[key];

            if (fieldSch.type === 'object' && typeof val === 'object' && val !== null && !Array.isArray(val)) {
                walk(val, fullPath, fieldSch);
            } else {
                if (val === null || val === undefined || val === '') {
                    // 跳过空值，不显示 '-'
                } else {
                    var display = String(val).substring(0, 50);
                    lines.push(displayPath(fullPath) + '=' + display);
                }
            }
        });

        if (wildcardSch && obj && typeof obj === 'object') {
            Object.keys(obj).forEach(function (key) {
                if (coveredKeys[key]) return;
                var fullPath = prefix ? prefix + '.' + key : key;
                var val = obj[key];
                if (wildcardSch.type === 'object' && typeof val === 'object' && val !== null && !Array.isArray(val)) {
                    walk(val, fullPath, wildcardSch);
                } else {
                    var display = val === null || val === undefined ? '-' : String(val).substring(0, 50);
                    lines.push(displayPath(fullPath) + '=' + display);
                }
            });
        }
    }

    walk(state, '', stateSchema);
    return lines.join(', ');
}

// formatQuestSummary — bi-level: only name + status/deadline, no detail fields
export function formatQuestSummary(state) {
    if (!state || !state.quests) return '';
    var quests = state.quests;
    var sections = [];

    function calcRemaining(deadline, currentTime) {
        if (!deadline || !currentTime) return '';
        try {
            var d = new Date(deadline);
            var c = new Date(currentTime);
            if (isNaN(d.getTime()) || isNaN(c.getTime())) {
                var dNum = parseInt(deadline, 10);
                var cNum = parseInt(currentTime, 10);
                if (!isNaN(dNum) && !isNaN(cNum)) return Math.max(0, dNum - cNum) + '天';
            }
            var diffMs = d.getTime() - c.getTime();
            var diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            return diffDays > 0 ? diffDays + '天' : (diffDays === 0 ? '今天' : '');
        } catch (e) { return ''; }
    }

    var currentTime = state.time || '';

    // Tasks
    if (quests.tasks && typeof quests.tasks === 'object') {
        var taskNames = Object.keys(quests.tasks);
        if (taskNames.length > 0) {
            var taskLines = ['【任务】'];
            taskNames.forEach(function (name) {
                var t = quests.tasks[name];
                if (!t || typeof t !== 'object') return;
                var remaining = calcRemaining(t.deadline, currentTime);
                var suffix = remaining ? ' — 剩余' + remaining : ' — ' + (t.status || '未知');
                taskLines.push('  ' + (t.name || name) + suffix);
            });
            sections.push(taskLines.join('\n'));
        }
    }

    // Goals
    if (quests.goals && typeof quests.goals === 'object') {
        var goalNames = Object.keys(quests.goals);
        if (goalNames.length > 0) {
            var goalLines = ['【目标】'];
            goalNames.forEach(function (name) {
                var g = quests.goals[name];
                if (!g || typeof g !== 'object') return;
                goalLines.push('  ' + (g.name || name) + ' — ' + (g.status || '未知'));
            });
            sections.push(goalLines.join('\n'));
        }
    }

    // Events
    if (quests.events && typeof quests.events === 'object') {
        var eventNames = Object.keys(quests.events);
        if (eventNames.length > 0) {
            var eventLines = ['【世界事件】'];
            eventNames.forEach(function (name) {
                var e = quests.events[name];
                if (!e || typeof e !== 'object') return;
                eventLines.push('  ' + (e.name || name) + ' — ' + (e.status || '未知'));
            });
            sections.push(eventLines.join('\n'));
        }
    }

    return sections.join('\n\n');
}

export function formatEntityChainHeaders(activeCharNames, entityChains, entityNames) {
    var headers = {};
    if (!entityChains || !activeCharNames || !entityNames) return headers;
    activeCharNames.forEach(function(name) {
        var chains = entityChains[name];
        if (!chains || !chains.length) return;
        var mention = chains.slice(0, 2).join('; ');
        if (mention) headers[name] = '\u2192 ' + mention;
    });
    return headers;
}
