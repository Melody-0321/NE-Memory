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

/** @returns {boolean} */
export function isStateSchemaEnabled() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) return !!JSON.parse(raw).enableStateSchema;
    } catch (e) {}
    return false;
}

/** @param {boolean} val */
export function setStateSchemaEnabled(val) {
    var settings = {};
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) settings = JSON.parse(raw);
    } catch (e) {}
    settings.enableStateSchema = !!val;
    try { localStorage.setItem('ne_settings', JSON.stringify(settings)); } catch (e) {}
}

/** @param {boolean} val */
export function setDynamicStateMode(val) {
    var settings = {};
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) settings = JSON.parse(raw);
    } catch (e) {}
    settings.useDynamicState = !!val;
    try { localStorage.setItem('ne_settings', JSON.stringify(settings)); } catch (e) {}
}

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

export const DEFAULT_CHARACTER_SCHEMA = {
    protagonist: {
        fields: {
            name: { type: 'string', max_length: 30, required: true },
            gender_age: { type: 'string', max_length: 20, required: true },
            physique: { type: 'string', max_length: 60, required: true },
            occupation: { type: 'string', max_length: 30, required: true },
            clothing_build: { type: 'string', max_length: 60, required: true },
            personality: { type: 'string', max_length: 80, required: true },
            status: { type: 'enum', values: ['活跃', '非活跃', '已死亡', '已归隐', '已离去'], required: true },
            inventory: { type: 'object', required: false },
            injuries: { type: 'string', max_length: 120, required: false },
            status_effects: { type: 'string', max_length: 120, required: false }
        }
    },
    npc: {
        fields: {
            name: { type: 'string', max_length: 30, required: true },
            gender_age: { type: 'string', max_length: 20, required: true },
            physique: { type: 'string', max_length: 60, required: true },
            occupation: { type: 'string', max_length: 30, required: true },
            clothing_build: { type: 'string', max_length: 60, required: true },
            personality: { type: 'string', max_length: 80, required: true },
            inner_thoughts: { type: 'string', max_length: 120, required: true },
            affection: { type: 'number', min: 0, max: 100, required: true },
            relationship: { type: 'string', max_length: 50, required: true },
            current_mood: { type: 'string', max_length: 30, required: true },
            past_experience: { type: 'string', max_length: 200, required: false },
            status: { type: 'enum', values: ['活跃', '非活跃', '已死亡', '已归隐', '已离去'], required: true },
            inventory: { type: 'object', required: false },
            injuries: { type: 'string', max_length: 120, required: false },
            status_effects: { type: 'string', max_length: 120, required: false }
        }
    }
};

export var DEFAULT_NPC_SCHEME = (function() {
    var npcFields = DEFAULT_CHARACTER_SCHEMA.npc.fields;
    var required = [];
    var optional = [];
    Object.keys(npcFields).forEach(function(k) {
        if (k === 'name' || k === 'inventory') return;
        if (npcFields[k].required) required.push(k);
        else optional.push(k);
    });
    return {
        default: {
            description: 'Default NPC scheme (all standard fields)',
            required: required,
            optional: optional
        }
    };
})();

export const DEFAULT_GLOBAL_SCHEMA = {
    type: 'object',
    fields: {
        main_event: { type: 'string', max_length: 120 },
        present_characters: { type: 'string', max_length: 80 },
        characters: {
            type: 'object',
            schema: {
                type: 'object',
                fields: {
                    '*': DEFAULT_CHARACTER_SCHEMA.npc
                }
            }
        },
        factions: {
            type: 'object',
            enabled: true,
            schema: {
                type: 'object',
                fields: {
                    '*': {
                        type: 'object',
                        fields: {
                            name: { type: 'string', max_length: 20 },
                            description: { type: 'string', max_length: 80 },
                            leader: { type: 'string', max_length: 30 },
                            attitude_toward_player: { type: 'enum', values: ['友好', '中立', '冷淡', '敌对'] },
                            relations: { type: 'object' },
                            notes: { type: 'string', max_length: 200 },
                            _hidden: { type: 'boolean', default: true }
                        }
                    }
                }
            }
        },
        quests: {
            type: 'object',
            enabled: true,
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
                                        name: { type: 'string', max_length: 40 },
                                        deadline: { type: 'string', max_length: 30 },
                                        status: { type: 'enum', values: ['正在进行', '已完成', '已失败', '已过期'] },
                                        type: { type: 'enum', values: ['主线', '支线', '事件'] },
                                        issuer: { type: 'string', max_length: 30 },
                                        desc: { type: 'string', max_length: 200 },
                                        progress: { type: 'string', max_length: 60 },
                                        posted_time: { type: 'string', max_length: 30 },
                                        reward: { type: 'string', max_length: 100 },
                                        penalty: { type: 'string', max_length: 100 }
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
                                        name: { type: 'string', max_length: 40 },
                                        status: { type: 'enum', values: ['进行中', '已达成', '已放弃'] },
                                        desc: { type: 'string', max_length: 200 },
                                        progress: { type: 'string', max_length: 60 },
                                        posted_time: { type: 'string', max_length: 30 },
                                        completed_time: { type: 'string', max_length: 30 }
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
                                        name: { type: 'string', max_length: 40 },
                                        status: { type: 'enum', values: ['持续中', '已平息', '已结束'] },
                                        desc: { type: 'string', max_length: 300 },
                                        started_time: { type: 'string', max_length: 30 },
                                        ended_time: { type: 'string', max_length: 30 }
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
                    name: { type: 'string', max_length: 20 },
                    description: { type: 'string', max_length: 80 },
                    leader: { type: 'string', max_length: 30 },
                    attitude_toward_player: { type: 'enum', values: ['友好', '中立', '冷淡', '敌对'] },
                    relations: { type: 'object' },
                    notes: { type: 'string', max_length: 200 },
                    _hidden: { type: 'boolean', default: true }
                }
            }
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
                        name: { type: 'string', max_length: 40 },
                        deadline: { type: 'string', max_length: 30 },
                        status: { type: 'enum', values: ['正在进行', '已完成', '已失败', '已过期'] },
                        type: { type: 'enum', values: ['主线', '支线', '事件'] },
                        issuer: { type: 'string', max_length: 30 },
                        desc: { type: 'string', max_length: 200 },
                        progress: { type: 'string', max_length: 60 },
                        posted_time: { type: 'string', max_length: 30 },
                        reward: { type: 'string', max_length: 100 },
                        penalty: { type: 'string', max_length: 100 }
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
                        name: { type: 'string', max_length: 40 },
                        status: { type: 'enum', values: ['进行中', '已达成', '已放弃'] },
                        desc: { type: 'string', max_length: 200 },
                        progress: { type: 'string', max_length: 60 },
                        posted_time: { type: 'string', max_length: 30 },
                        completed_time: { type: 'string', max_length: 30 }
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
                        name: { type: 'string', max_length: 40 },
                        status: { type: 'enum', values: ['持续中', '已平息', '已结束'] },
                        desc: { type: 'string', max_length: 300 },
                        started_time: { type: 'string', max_length: 30 },
                        ended_time: { type: 'string', max_length: 30 }
                    }
                }
            }
        }
    }
};

// validateField — 类型检查 + max_length 截断 + enum 值校验
/**
 * @param {*} value
 * @param {import('../../types.js').SchemaFieldDef|null} fieldSchema
 * @returns {import('../../types.js').ValidationResult}
 */
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
            var strVal = String(value).trim();
            var incMatch = strVal.match(/^([+-])\s*(\d+)$/);
            if (incMatch) {
                return { ok: true, value: { __inc: true, delta: (incMatch[1] === '+' ? 1 : -1) * parseInt(incMatch[2], 10) } };
            }
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
/**
 * @param {Object|null} stateSchema
 * @param {string} dotPath
 * @returns {Object|null}
 */
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
        } else if (current.fields) {
            current = current.fields[part] || null;
        } else {
            return null;
        }
    }
    return current;
}

/**
 * @param {Object} stateSchema
 * @param {Object<string, any>} changes
 * @returns {{validated: Object<string, any>, warnings: Array<{path: string, warning: string}>}}
 */
export function validateStateChanges(stateSchema, changes) {
    var validated = {};
    var warnings = [];

    Object.keys(changes).forEach(function (path) {
        var fieldSchema = resolveSchemaPath(stateSchema, path);

        if (!fieldSchema) {
            var parts = path.split('.');
            if (parts.length >= 3) {
                var parentPath = parts.slice(0, parts.length - 1).join('.');
                var parentSchema = resolveSchemaPath(stateSchema, parentPath);
                if (parentSchema) {
                    warnings.push({ path: path, warning: 'Unknown sub-field under known parent, passing through: ' + path });
                    validated[path] = changes[path];
                    return;
                }
            }
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
/**
 * @param {import('../../types.js').State|null} state
 * @returns {import('../../types.js').State}
 */
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

/**
 * @param {import('../../types.js').State} state
 * @param {string} name
 * @param {string} [schemeKey]
 */
export function ensureCharacterTemplate(state, name, schemeKey) {
    if (!state.characters) state.characters = {};
    if (state.characters[name] && typeof state.characters[name] === 'object' && Object.keys(state.characters[name]).length > 0) return;

    var isPC = (state.protagonist_name && name === state.protagonist_name) ||
        (state._character_schemes && state._character_schemes[name] && state._character_schemes[name]._role === 'protagonist');
    var template;
    if (isPC) {
        template = DEFAULT_CHARACTER_SCHEMA.protagonist.fields;
    } else if (schemeKey && state.npc_schemes && state.npc_schemes[schemeKey]) {
        var scheme = state.npc_schemes[schemeKey];
        var fieldNames = [];
        (scheme.required || []).forEach(function(f) { if (fieldNames.indexOf(f) === -1) fieldNames.push(f); });
        (scheme.optional || []).forEach(function(f) { if (fieldNames.indexOf(f) === -1) fieldNames.push(f); });
        template = {};
        fieldNames.forEach(function(fn) {
            if (DEFAULT_CHARACTER_SCHEMA.npc.fields[fn]) {
                template[fn] = DEFAULT_CHARACTER_SCHEMA.npc.fields[fn];
            }
        });
    } else {
        template = DEFAULT_CHARACTER_SCHEMA.npc.fields;
    }

    state.characters[name] = {};
    Object.keys(template).forEach(function (fk) {
        var field = template[fk];
        if (field.type === 'boolean') {
            state.characters[name][fk] = false;
        } else if (field.type === 'number') {
            state.characters[name][fk] = null;
        } else {
            state.characters[name][fk] = '';
        }
    });
    state.characters[name].name = name;
    if (!isPC && schemeKey) {
        state.characters[name]._scheme = schemeKey;
    }
}

// mergeStateChanges — 按 dot-path 深度合并到状态对象
// 每次合并后自动重建 present_characters
/**
 * @param {import('../../types.js').State} state
 * @param {Object<string, any>} validatedChanges
 * @returns {import('../../types.js').State}
 */
export function mergeStateChanges(state, validatedChanges) {
    var newState = JSON.parse(JSON.stringify(state || {}));

    var flattened = {};
    Object.keys(validatedChanges).forEach(function(path) {
        var val = validatedChanges[path];
        if (val !== null && typeof val === 'object' && !Array.isArray(val) && !val.__inc) {
            Object.keys(val).forEach(function(subKey) {
                flattened[path + '.' + subKey] = val[subKey];
            });
        } else {
            flattened[path] = val;
        }
    });

    var hasChanges = false;
    Object.keys(flattened).forEach(function (path) {
        var parts = path.split('.');

        if (path.endsWith('._scheme')) {
            var schCharName = parts[1];
            var existingScheme = (newState.characters && newState.characters[schCharName] && newState.characters[schCharName]._scheme) || null;
            var isProtagonist = (newState.protagonist_name && newState.protagonist_name === schCharName) ||
                (newState.characters && newState.characters[schCharName] && newState.characters[schCharName]._role === 'protagonist');
            if (existingScheme && existingScheme !== flattened[path]) {
                console.warn('[NE] _scheme protected: ' + schCharName + ' already has _scheme=' + existingScheme + ', ignoring change to ' + flattened[path]);
                return;
            }
            if (!existingScheme) {
                if (isProtagonist) {
                    console.warn('[NE] _scheme protected: ' + schCharName + ' is protagonist, ignoring _scheme change');
                    return;
                }
            }
        }

        if (path.endsWith('._role')) {
            var roleCharName = parts[1];
            var isRoleProtagonist = (newState.protagonist_name && newState.protagonist_name === roleCharName) ||
                (newState.characters && newState.characters[roleCharName] && newState.characters[roleCharName]._role === 'protagonist');
            if (isRoleProtagonist) {
                console.warn('[NE] _role protected: ' + roleCharName + ' is protagonist, ignoring role change');
                return;
            }
        }

        if (parts[0] === 'characters' && parts.length >= 2) {
            var charName = parts[1];
            if (charName && charName !== '*') {
                ensureCharacterTemplate(newState, charName);
            }
        }

        // 兼容旧 prompt 的 flat quest 路径 quests.<name>.<field> → quests.tasks.<name>.<field>
        if (parts[0] === 'quests' && parts.length >= 3 && parts[1] !== 'tasks' && parts[1] !== 'goals' && parts[1] !== 'events') {
            parts.splice(1, 0, 'tasks');
            console.warn('[NE] Remapped legacy quest path:', path, '→', parts.join('.'));
        }

        var current = newState;

        for (var i = 0; i < parts.length - 1; i++) {
            if (current[parts[i]] === undefined || current[parts[i]] === null || typeof current[parts[i]] !== 'object') {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }

        var lastKey = parts[parts.length - 1];
        if (lastKey === 'affection' && flattened[path] && typeof flattened[path] === 'object' && flattened[path].__inc) {
            var delta = flattened[path].delta;
            var currentAffection = Number(current[lastKey]) || 0;
            current[lastKey] = Math.max(0, Math.min(100, currentAffection + delta));
            hasChanges = true;
            return;
        }
        current[lastKey] = flattened[path];
        hasChanges = true;
    });

    if (hasChanges) {
        newState = rebuildPresentCharacters(newState);
    }

    return newState;
}

/**
 * @param {import('../../types.js').Vault} vault
 * @returns {Object}
 */
export function getEffectiveSchema(vault) {
    return vault.content.state_schema || DEFAULT_GLOBAL_SCHEMA;
}

// Fields injected for PC — derived from DEFAULT_CHARACTER_SCHEMA.protagonist
/** @type {string[]} */
export var PC_INJECTION_FIELDS = ['status', 'gender_age', 'physique', 'occupation', 'personality', 'clothing_build', 'injuries', 'status_effects', 'past_experience'];

// Fields injected for NPC — derived from DEFAULT_CHARACTER_SCHEMA.npc

// Static field categories — used by buildStateInjectionTable to annotate unfilled required fields
var STATIC_FIELD_CATEGORIES = { gender_age: true, physique: true, occupation: true, personality: true };

/**
 * @param {import('../../types.js').State} state
 * @param {string} name
 * @returns {string[]}
 */
export function getNpcInjectionFields(state, name) {
    var charData = (state && state.characters && state.characters[name]) || {};
    var schemeKey = charData._scheme || 'default';
    var npcSchemes = (state && state.npc_schemes) || DEFAULT_NPC_SCHEME;
    var scheme = npcSchemes[schemeKey];
    if (!scheme) {
        scheme = npcSchemes['default'] || DEFAULT_NPC_SCHEME.default;
    }
    var fields = [];
    (scheme.required || []).forEach(function(f) { if (fields.indexOf(f) === -1) fields.push(f); });
    (scheme.optional || []).forEach(function(f) { if (fields.indexOf(f) === -1) fields.push(f); });
    return fields;
}

/**
 * @param {import('../../types.js').State|null} state
 * @param {Array} messages
 * @param {Object} maxItems
 * @param {Object} world
 * @returns {string}
 */
export function buildStateInjectionTable(state, messages, maxItems, world) {
    if (!state) return '';
    maxItems = maxItems || { characters: Infinity, factions: Infinity, quests: Infinity };
    world = world || {};
    var parts = [];

    parts.push('=== Current State ===');
    parts.push('');

    parts.push('[World]');
    parts.push('time: ' + (world.story_time || ''));
    parts.push('scene: ' + (world.story_scene || ''));
    parts.push('story_date: ' + (world.story_date || ''));
    parts.push('main_event: ' + (state.main_event || ''));
    parts.push('');

    // Determine protagonist name
    var protagonistName = state.protagonist_name || '';

    if (state.characters && typeof state.characters === 'object') {
        var charNames = Object.keys(state.characters);
        var activeCards = [];
        var inactiveCards = [];

        // Build a set of names mentioned in this round's messages (for auto-expand)
        var mentionedNames = {};
        if (messages && messages.length > 0) {
            var msgText = messages.map(function(m) { return m.content || ''; }).join(' ');
            charNames.forEach(function(name) {
                if (msgText.indexOf(name) !== -1) mentionedNames[name] = true;
            });
        }

        charNames.forEach(function(name) {
            var card = state.characters[name];
            if (!card || typeof card !== 'object') return;
            var isActive = card.status === '活跃' || mentionedNames[name];
            if (isActive) {
                activeCards.push({ name: name, card: card });
            } else {
                inactiveCards.push({ name: name, card: card });
            }
        });

        // Active characters
        if (activeCards.length > 0) {
            if (state && state.npc_schemes && Object.keys(state.npc_schemes).length > 1) {
                parts.push('=== NPC Schemes Available ===');
                Object.keys(state.npc_schemes).forEach(function(sk) {
                    var s = state.npc_schemes[sk];
                    parts.push(sk + ': ' + (s.description || '') + ' (required: ' + (s.required || []).join(', ') + ', optional: ' + (s.optional || []).join(', ') + ')');
                });
                parts.push('');
            }
            parts.push('=== Characters (Active) ===');
            activeCards.forEach(function(item) {
                var isPC = (item.name === protagonistName) || (item.card._role === 'protagonist');
                var cardType = isPC ? 'protagonist' : 'npc';
                var fields = isPC ? PC_INJECTION_FIELDS : getNpcInjectionFields(state, item.name);
                var requiredSet = {};
                var schema = DEFAULT_CHARACTER_SCHEMA[cardType];
                if (schema && schema.fields) {
                    Object.keys(schema.fields).forEach(function(k) {
                        if (schema.fields[k].required) requiredSet[k] = true;
                    });
                }

                var label = isPC ? '[PC] ' : '[NPC] ';
                parts.push(label + '[' + item.name + ']');
                for (var j = 0; j < fields.length; j++) {
                    var fk = fields[j];
                    var fv = item.card[fk] !== undefined ? item.card[fk] : '';
                    var valStr = (fv === undefined || fv === null || fv === '') ? '(empty)' : String(fv);
                    var isEmpty = (fv === undefined || fv === '' || (fk === 'affection' && Number(fv) === 0));
                    var suffix = '';
                    if (fk === 'status') suffix = ' (enum: 活跃/非活跃/已死亡/已归隐/已离去)';
                    else if (fk === 'affection') suffix = ' (0-100)';
                    else if (fk === 'past_experience') suffix = ' (增量追加)';
                    var translatedLabel = t_field(fk);
                    if (requiredSet[fk] && isEmpty) {
                        suffix = ' (未填)' + suffix;
                        if (STATIC_FIELD_CATEGORIES[fk]) suffix += ' (静态字段，从来源提取)';
                    }
                    parts.push('  ' + translatedLabel + ' (' + fk + '): ' + valStr + suffix);
                }
            });
        }

        // Inactive characters (simple summary)
        if (inactiveCards.length > 0) {
            parts.push('');
            var inactiveLines = [];
            inactiveCards.forEach(function(item) {
                var status = item.card.status || '';
                inactiveLines.push('[' + item.name + '] status: ' + status);
            });
            parts.push('  Non-active: ' + inactiveLines.join(' | '));
        }
        parts.push('');
    }

    if (state.factions && typeof state.factions === 'object') {
        var factionNames = Object.keys(state.factions);
        var visibleFactions = factionNames.filter(function (name) {
            var f = state.factions[name];
            return f && typeof f === 'object' && !f._hidden;
        });
        if (visibleFactions.length === 0) {
            parts.push('=== Factions ===');
            parts.push('(available paths: factions.<Name>.name, description, leader, attitude_toward_player[友好/中立/冷淡/敌对], relations, notes)');
            parts.push('(empty — create via factions.<Name>.attitude_toward_player)');
            parts.push('');
        } else {
            parts.push('=== Factions ===');
            visibleFactions.forEach(function (name) {
                var f = state.factions[name];
                if (!f || typeof f !== 'object') return;
                var fields = [];
                ['name', 'leader', 'attitude_toward_player', 'notes'].forEach(function (fk) {
                    if (f[fk] !== undefined && f[fk] !== '') {
                        fields.push(fk + ': ' + f[fk]);
                    }
                });
                parts.push('[' + name + '] ' + fields.join(', '));
            });
            parts.push('');
        }
    }

    if (state.quests && typeof state.quests === 'object') {
        var hasQuests = false;
        ['tasks', 'goals', 'events'].forEach(function (cat) {
            if (state.quests[cat] && typeof state.quests[cat] === 'object' && Object.keys(state.quests[cat]).length > 0) {
                hasQuests = true;
            }
        });
        if (!hasQuests) {
            parts.push('=== Quests ===');
            parts.push('(available paths:');
            parts.push('  quests.tasks.<Name>.name, deadline, status[正在进行/已完成/已失败/已过期], progress');
            parts.push('  quests.goals.<Name>.name, status[进行中/已达成/已放弃], progress');
            parts.push('  quests.events.<Name>.name, status[持续中/已平息/已结束], desc)');
            parts.push('(empty — create via quests.tasks.<Name>.status)');
            parts.push('');
        } else {
            parts.push('=== Quests ===');
            ['tasks', 'goals', 'events'].forEach(function (cat) {
                var catObj = state.quests[cat];
                if (!catObj || typeof catObj !== 'object') return;
                var names = Object.keys(catObj);
                names.forEach(function (name) {
                    var q = catObj[name];
                    if (!q || typeof q !== 'object') return;
                    var fields = [];
                    ['name', 'status', 'deadline', 'progress', 'desc'].forEach(function (fk) {
                        if (q[fk] !== undefined && q[fk] !== '') {
                            fields.push(fk + ': ' + q[fk]);
                        }
                    });
                    parts.push('[' + cat + '.' + name + '] ' + fields.join(', '));
                });
            });
            parts.push('');
        }
    }

    return parts.join('\n');
}
