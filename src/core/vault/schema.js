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
    return true;
}

/** @param {boolean} val */
export function setStateSchemaEnabled(val) {
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

/** @type {import('../../types.js').SchemaFieldDef} */
export var SYSTEM_REQUIRED_FIELDS = {
    name:   { type: 'string', max_length: 30, required: true, _system: true },
    status: { type: 'enum',   values: ['活跃','非活跃','已死亡','已归隐','已离去'], required: true, _system: true }
};

export var PRESET_FIELDS = {
    identity: {
        gender_age:      { type: 'string', max_length: 20,  required: false, category: 'identity' },
        physique:        { type: 'string', max_length: 60,  required: false, category: 'identity' },
        occupation:      { type: 'string', max_length: 30,  required: false, category: 'identity' },
        clothing_build:  { type: 'string', max_length: 60,  required: false, category: 'identity' },
        personality:     { type: 'string', max_length: 80,  required: false, category: 'identity' },
        past_experience: { type: 'string', max_length: 200, required: false, category: 'identity' }
    },
    psychology: {
        inner_thoughts:  { type: 'string', max_length: 120, required: false, category: 'psychology' },
        current_mood:    { type: 'string', max_length: 30,  required: false, category: 'psychology' }
    },
    social: {
        affection:       { type: 'number', min: 0, max: 100, required: false, category: 'social' },
        relationship:    { type: 'string', max_length: 50,  required: false, category: 'social' }
    },
    battle: {
        injuries:        { type: 'string', max_length: 120, required: false, category: 'battle' },
        status_effects:  { type: 'string', max_length: 120, required: false, category: 'battle' }
    },
    inventory: {
        inventory:       { type: 'object', required: false, category: 'inventory',
            item_schema: {
                name:        { type: 'string', max_length: 60, description: '物品名称' },
                description: { type: 'string', max_length: 200, description: '外观/来源/背景' },
                rarity:      { type: 'string', max_length: 20, description: '稀有度/品质/品阶' },
                properties:  { type: 'string', max_length: 200, description: '特殊属性/词条/附魔效果' }
            }
        }
    }
};

/** @type {Object<string, import('../../types.js').SchemaFieldDef>} */
export var ALL_PREDEFINED_FIELDS = (function() {
    var m = Object.assign({}, SYSTEM_REQUIRED_FIELDS);
    Object.keys(PRESET_FIELDS).forEach(function(cat) {
        Object.keys(PRESET_FIELDS[cat]).forEach(function(fn) {
            m[fn] = PRESET_FIELDS[cat][fn];
        });
    });
    return m;
})();

export var DEFAULT_PC_TEMPLATE = {
    id: '_default_pc',
    name: 'Default PC',
    role: 'pc',
    description: 'Default protagonist scheme (9 preset fields)',
    source: 'system',
    system: true,
    presetFields: ['gender_age','physique','occupation','personality','clothing_build','injuries','status_effects','past_experience','inventory'],
    customFieldRefs: [],
    _locked: false
};

export var DEFAULT_NPC_TEMPLATE = {
    id: '_default_npc',
    name: 'Default NPC',
    role: 'npc',
    description: 'Default NPC scheme (14 preset fields)',
    source: 'system',
    system: true,
    presetFields: ['gender_age','physique','occupation','personality','clothing_build','inner_thoughts','relationship','current_mood','past_experience','injuries','status_effects','inventory'],
    customFieldRefs: [],
    _locked: false
};

/**
 * Build character schema dynamically from templates.
 * Returns { protagonist: { fields }, npc: { fields } } shape.
 * @param {Object} pcTemplate
 * @param {Object} npcTemplate
 * @returns {Object}
 */
export function buildCharacterSchemaFromTemplates(pcTemplate, npcTemplate) {
    var pcFields = expandTemplateFields(pcTemplate);
    var npcFields = expandTemplateFields(npcTemplate);
    pcFields.name = { type: 'string', max_length: 30, required: true, _system: true };
    pcFields.status = { type: 'enum', values: ['活跃','非活跃','已死亡','已归隐','已离去'], required: true, _system: true };
    npcFields.name = { type: 'string', max_length: 30, required: true, _system: true };
    npcFields.status = { type: 'enum', values: ['活跃','非活跃','已死亡','已归隐','已离去'], required: true, _system: true };
    return { protagonist: { fields: pcFields }, npc: { fields: npcFields } };
}

var __CACHED_CHARACTER_SCHEMA = null;
function _characterSchema() {
    if (__CACHED_CHARACTER_SCHEMA) return __CACHED_CHARACTER_SCHEMA;
    __CACHED_CHARACTER_SCHEMA = buildCharacterSchemaFromTemplates(DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE);
    return __CACHED_CHARACTER_SCHEMA;
}

export var DEFAULT_NPC_SCHEME = (function() {
    var npcFields = expandTemplateFields(DEFAULT_NPC_TEMPLATE);
    var fields = {};
    Object.keys(npcFields).forEach(function(k) {
        if (k === 'name') return;
        fields[k] = Object.assign({}, npcFields[k]);
    });
    return { _default: { fields: fields } };
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
                    '*': _characterSchema().npc
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
            activeNames.push(card.name || name);
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
        template = _characterSchema().protagonist.fields;
    } else if (schemeKey && state.npc_schemes && state.npc_schemes[schemeKey]) {
        var scheme = state.npc_schemes[schemeKey];
        var norm = normalizeScheme(scheme);
        template = norm || _characterSchema().npc.fields;
    } else {
        template = _characterSchema().npc.fields;
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
    var capturedChanges = [];

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
            var newAffection = Math.max(0, Math.min(100, currentAffection + delta));
            current[lastKey] = newAffection;
            capturedChanges.push({ path: path, old: currentAffection, new: newAffection });
            hasChanges = true;
            return;
        }
        var oldVal = current[lastKey];
        if (oldVal !== flattened[path]) {
            current[lastKey] = flattened[path];
            capturedChanges.push({ path: path, old: oldVal, new: flattened[path] });
            hasChanges = true;
        }
    });

    if (hasChanges) {
        var oldPresent = newState.present_characters;
        newState = rebuildPresentCharacters(newState);
        if (oldPresent !== undefined && JSON.stringify(oldPresent) !== JSON.stringify(newState.present_characters)) {
            capturedChanges.push({ path: 'present_characters', old: oldPresent, new: newState.present_characters });
        }
    }

    return { state: newState, changes: capturedChanges };
}

/**
 * @param {import('../../types.js').Vault} vault
 * @returns {Object}
 */
export function getEffectiveSchema(vault) {
    return vault.content.state_schema || DEFAULT_GLOBAL_SCHEMA;
}

// Fields injected for NPC — derived from character schema

/**
 * @param {import('../../types.js').State} state
 * @param {string} name
 * @returns {string[]}
 */
export function getNpcInjectionFields(state, name) {
    var charData = (state && state.characters && state.characters[name]) || {};
    var schemeKey = charData._scheme || '_default';
    var npcSchemes = (state && state.npc_schemes) || DEFAULT_NPC_SCHEME;
    var scheme = npcSchemes[schemeKey];
    if (!scheme) scheme = DEFAULT_NPC_SCHEME._default;
    var norm = normalizeScheme(scheme);
    if (norm) return Object.keys(norm);
    return Object.keys(_characterSchema().npc.fields).filter(function(k) { return k !== 'name'; });
}

/**
 * Dynamically resolve PC injection fields from current PC template or default.
 * Replaces the static PC_INJECTION_FIELDS constant.
 * @param {import('../../types.js').State|null} state
 * @param {string} name
 * @returns {string[]}
 */
export function getCharacterInjectionFields(state, name) {
    var charData = (state && state.characters && state.characters[name]) || {};
    var isPC = (state && state.protagonist_name && name === state.protagonist_name) ||
        (charData._role === 'protagonist');
    if (!isPC) return getNpcInjectionFields(state, name);
    if (charData._templateKey) {
        return Object.keys(_characterSchema().protagonist.fields).filter(function(k) { return k !== 'name'; });
    }
    return Object.keys(_characterSchema().protagonist.fields).filter(function(k) { return k !== 'name'; });
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
                var card = state.characters[name];
                var displayName = (card && card.name) ? card.name : name;
                if (msgText.indexOf(name) !== -1 || msgText.indexOf(displayName) !== -1) mentionedNames[name] = true;
            });
        }

        charNames.forEach(function(name) {
            var card = state.characters[name];
            if (!card || typeof card !== 'object') return;
            var isActive = card.status === '活跃' || mentionedNames[name];
            var displayName = card.name || name;
            if (isActive) {
                activeCards.push({ name: displayName, key: name, card: card });
            } else {
                inactiveCards.push({ name: displayName, key: name, card: card });
            }
        });

        // Active characters
        if (activeCards.length > 0) {
            parts.push('=== Characters (Active) ===');
            activeCards.forEach(function(item) {
                var isPC = (item.key === protagonistName) || (item.card._role === 'protagonist');
                var fields = isPC ? getCharacterInjectionFields(state, item.key) : getNpcInjectionFields(state, item.key);
                var fieldDefs = isPC ? _characterSchema().protagonist.fields : _characterSchema().npc.fields;

                var label = isPC ? '[PC] ' : '[NPC] ';
                parts.push(label + '[' + item.name + ']');
                for (var j = 0; j < fields.length; j++) {
                    var fk = fields[j];
                    var fv = item.card[fk] !== undefined ? item.card[fk] : '';
                    var valStr = (fv === undefined || fv === null || fv === '') ? '(empty)' : String(fv);
                    var isEmpty = (fv === undefined || fv === '' || (fk === 'affection' && Number(fv) === 0));
                    var suffix = '';
                    var fieldDef = fieldDefs[fk] || {};
                    if (fieldDef._deprecated) continue;
                    if (fk === 'status') suffix = ' (enum: 活跃/非活跃/已死亡/已归隐/已离去)';
                    else if (fk === 'affection') suffix = ' (0-100)';
                    else if (fieldDef.type === 'enum' && fieldDef.values) suffix = ' (enum: ' + fieldDef.values.join('/') + ')';
                    else if (fieldDef.type === 'number' && fieldDef.min !== undefined && fieldDef.max !== undefined) suffix = ' (' + fieldDef.min + '-' + fieldDef.max + ')';
                    else if (fieldDef.type === 'object' && fieldDef.item_schema) {
                        var isKeys = Object.keys(fieldDef.item_schema);
                        suffix = ' (object, 每个物品应包含: ' + isKeys.join('/') + ')';
                    }
                    var translatedLabel = t_field(fk);
                    if (fieldDef.required && isEmpty) {
                        suffix = ' (未填)' + suffix;
                    }
                    if (fk !== 'name') parts.push('  ' + translatedLabel + ' (' + fk + '): ' + valStr + suffix);
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

// ====== Open Character Schema Utilities ======

/**
 * Safely get a nested value from an object by dot-path.
 * @param {Object} obj
 * @param {string} path
 * @returns {any}
 */
function getNestedValue(obj, path) {
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
        if (current === undefined || current === null || typeof current !== 'object') return undefined;
        current = current[parts[i]];
    }
    return current;
}

/**
 * Normalize legacy scheme format (required/optional arrays) to fields map.
 * Accepts 'default' (no prefix), '_default', or any other key.
 * Returns null if scheme is undefined/null.
 *
 * @param {Object|null} scheme
 * @returns {Object<string, import('../../types.js').SchemaFieldDef>|null}
 */
export function normalizeScheme(scheme) {
    if (!scheme) return null;
    if (scheme.fields && typeof scheme.fields === 'object' && !Array.isArray(scheme.fields)) {
        return scheme.fields;
    }
    var fields = {};
    (scheme.required || []).forEach(function(k) {
        if (ALL_PREDEFINED_FIELDS[k]) fields[k] = Object.assign({}, ALL_PREDEFINED_FIELDS[k]);
    });
    (scheme.optional || []).forEach(function(k) {
        if (ALL_PREDEFINED_FIELDS[k]) fields[k] = Object.assign({}, ALL_PREDEFINED_FIELDS[k]);
    });
    return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * Expand a template's presetFields + customFieldRefs into a full fields map.
 * Called by get_character_scheme handler (Mode 1 direct copy).
 *
 * @param {Object} template - Template or DialogueTemplate object
 * @returns {Object<string, import('../../types.js').SchemaFieldDef>}
 */
export function expandTemplateFields(template) {
    var fields = {};
    if (template.presetFields) {
        template.presetFields.forEach(function(fn) {
            var def = ALL_PREDEFINED_FIELDS[fn];
            if (def) fields[fn] = Object.assign({}, def);
        });
    }
    if (template.customFieldRefs) {
        template.customFieldRefs.forEach(function(fn) {
            var fieldLib = loadFieldLibrary();
            var def = fieldLib && fieldLib.fields && fieldLib.fields[fn];
            if (def) {
                fields[fn] = { type: def.type };
                if (def.max_length) fields[fn].max_length = def.max_length;
                if (def.min !== undefined) fields[fn].min = def.min;
                if (def.max !== undefined) fields[fn].max = def.max;
                if (def.values) fields[fn].values = def.values.slice();
                if (def.category) fields[fn].category = def.category;
            }
        });
    }
    fields.name = Object.assign({}, SYSTEM_REQUIRED_FIELDS.name);
    fields.status = Object.assign({}, SYSTEM_REQUIRED_FIELDS.status);
    return fields;
}

/**
 * Resolve a field's definition with precedence: field library > ALL_PREDEFINED_FIELDS > null.
 * Returns { def, source: 'library'|'preset'|null }.
 *
 * @param {string} fieldName
 * @returns {{ def: import('../../types.js').SchemaFieldDef|null, source: string|null }}
 */
export function resolveFieldDef(fieldName) {
    var fieldLib = loadFieldLibrary();
    if (fieldLib && fieldLib.fields && fieldLib.fields[fieldName]) {
        return { def: fieldLib.fields[fieldName], source: 'library' };
    }
    if (ALL_PREDEFINED_FIELDS[fieldName]) {
        return { def: ALL_PREDEFINED_FIELDS[fieldName], source: 'preset' };
    }
    return { def: null, source: null };
}

/** @returns {import('../../types.js').FieldLibrary} */
export function loadFieldLibrary() {
    try {
        var raw = localStorage.getItem('ne_field_library');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { fields: {}, updatedAt: new Date().toISOString() };
}

/** @param {import('../../types.js').FieldLibrary} lib */
export function saveFieldLibrary(lib) {
    try {
        lib.updatedAt = new Date().toISOString();
        localStorage.setItem('ne_field_library', JSON.stringify(lib));
    } catch (e) {}
}

/**
 * Register a field definition to an NPC scheme's fields map.
 * Used by template LLM's resolveFieldProposal handler when a new field is accepted.
 * @param {Object} scheme — npc_schemes entry { fields: {...} }
 * @param {string} fieldName
 * @param {import('../../types.js').SchemaFieldDef} fieldDef
 * @param {'ai_generated'|'user_created'} source
 */
export function registerFieldToScheme(scheme, fieldName, fieldDef, source) {
    if (!scheme || !scheme.fields) scheme.fields = {};
    fieldDef._source = source || 'ai_generated';
    scheme.fields[fieldName] = fieldDef;
}

