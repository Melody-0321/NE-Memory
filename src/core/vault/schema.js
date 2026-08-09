// vault/schema.js — 状态 Schema 引擎
//
// Schema 是可选的结构化状态定义。当 state_schema 为 null/undefined 时，
// 所有路径回退到旧自由 JSON 行为。
//
import { t_field } from '../i18n.js';
import { neSync } from '../settings-adapter.js';
import { invalidateNeSettingsCache } from '../settings.js';
import { loadCardConfigSync, getActiveVersion, getEffectiveTemplates, loadFieldLibrary, saveFieldLibrary, addFieldToLibrary, addTemplateRefToField, removeTemplateRefFromField } from './store.js';
import { DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE, DEFAULT_FACTION_TEMPLATE, DEFAULT_TASK_TEMPLATE, DEFAULT_GOAL_TEMPLATE } from './template-defs.js';
export { DEFAULT_PC_TEMPLATE, DEFAULT_NPC_TEMPLATE, DEFAULT_FACTION_TEMPLATE, DEFAULT_TASK_TEMPLATE, DEFAULT_GOAL_TEMPLATE };
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
    invalidateNeSettingsCache();
    try { neSync('ne_settings'); } catch (e) {}
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
        past_experience: { type: 'string', max_length: 200, required: false, category: 'identity' },
        current_outfit:  { type: 'string', max_length: 100, required: false, category: 'identity' }
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
    ability: {
        abilities: {
            type: 'object', required: false, category: 'ability',
            item_schema: {
                name:   { type: 'string', max_length: 40, description: '技能/能力名称' },
                type:   { type: 'enum', values: ['被动','主动','天赋','种族'], description: '技能类型' },
                level:  { type: 'string', max_length: 30, description: '等级/阶段/境界' },
                effect: { type: 'string', max_length: 200, description: '效果描述' }
            }
        },
        power_level:     { type: 'string', max_length: 30, required: false, category: 'ability' }
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
    },
    faction: {
        name:                { type: 'string', max_length: 20, _system: true },
        description:         { type: 'string', max_length: 80 },
        type:                { type: 'string', max_length: 20 },
        leader:              { type: 'string', max_length: 30 },
        attitude_toward_player: { type: 'enum', values: ['友好','中立','冷淡','敌对'] },
        reputation_with_pc:  { type: 'string', max_length: 60 },
        current_goal:        { type: 'string', max_length: 120 },
        relations:           { type: 'string', max_length: 100 },
        notes:               { type: 'string', max_length: 200 }
    },
    quest: {
        name:         { type: 'string', max_length: 40, _system: true },
        deadline:     { type: 'string', max_length: 30 },
        status:       { type: 'enum', values: ['正在进行','已完成','已失败','已过期'] },
        type:         { type: 'enum', values: ['主线','支线','日常'] },
        issuer:       { type: 'string', max_length: 30 },
        objective:    { type: 'string', max_length: 120 },
        desc:         { type: 'string', max_length: 200 },
        progress:     { type: 'string', max_length: 60 },
        posted_time:  { type: 'string', max_length: 30 },
        reward:       { type: 'string', max_length: 100 },
        penalty:      { type: 'string', max_length: 100 }
    },
    goal: {
        name:         { type: 'string', max_length: 40, _system: true },
        status:       { type: 'enum', values: ['进行中','已达成','已放弃'] },
        motivation:   { type: 'string', max_length: 120 },
        desc:         { type: 'string', max_length: 200 },
        progress:     { type: 'string', max_length: 60 },
        posted_time:  { type: 'string', max_length: 30 },
        notes:        { type: 'string', max_length: 200 }
    },
    event: {
        name:         { type: 'string', max_length: 40, _system: true },
        status:       { type: 'enum', values: ['持续中','已平息','已结束'] },
        desc:         { type: 'string', max_length: 300 },
        started_time: { type: 'string', max_length: 30 },
        ended_time:   { type: 'string', max_length: 30 }
    }
};

/**
 * N5b: Category-to-role mapping. Determines which preset field categories
 * are available for each template role.
 */
export var ROLE_CATEGORY_MAP = {
    pc:     ['identity', 'psychology', 'social', 'battle', 'inventory', 'ability'],
    npc:    ['identity', 'psychology', 'social', 'battle', 'inventory', 'ability'],
    faction: ['faction'],
    quest:   ['quest', 'goal'],
    event:   ['event']
};

/**
 * N5b: Get all preset field definitions applicable to a given template role.
 * Returns a flat map of { fieldName: fieldDef } from the relevant categories.
 * @param {string} role - 'pc' | 'npc' | 'faction' | 'quest' | 'event'
 * @returns {Object}
 */
export function getPresetFieldsForRole(role) {
    var categories = ROLE_CATEGORY_MAP[role] || ROLE_CATEGORY_MAP.npc;
    var result = {};
    categories.forEach(function (cat) {
        if (PRESET_FIELDS[cat]) {
            Object.keys(PRESET_FIELDS[cat]).forEach(function (fn) {
                result[fn] = PRESET_FIELDS[cat][fn];
            });
        }
    });
    return result;
}

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

export function buildFactionSchemaFromTemplate(template) {
    var fields = expandTemplateFields(template);
    fields.name = { type: 'string', max_length: 20 };
    return { type: 'object', fields: fields };
}

export function buildTaskSchemaFromTemplate(template) {
    var fields = expandTemplateFields(template);
    fields.name = { type: 'string', max_length: 40 };
    return { type: 'object', fields: fields };
}

export function buildGoalSchemaFromTemplate(template) {
    var fields = expandTemplateFields(template);
    fields.name = { type: 'string', max_length: 40 };
    return { type: 'object', fields: fields };
}

var __CACHED_FACTION_SCHEMA = null;
function _factionSchema() {
    if (__CACHED_FACTION_SCHEMA) return __CACHED_FACTION_SCHEMA;
    __CACHED_FACTION_SCHEMA = buildFactionSchemaFromTemplate(DEFAULT_FACTION_TEMPLATE);
    return __CACHED_FACTION_SCHEMA;
}

var __CACHED_TASK_SCHEMA = null;
function _taskSchema() {
    if (__CACHED_TASK_SCHEMA) return __CACHED_TASK_SCHEMA;
    __CACHED_TASK_SCHEMA = buildTaskSchemaFromTemplate(DEFAULT_TASK_TEMPLATE);
    return __CACHED_TASK_SCHEMA;
}

var __CACHED_GOAL_SCHEMA = null;
function _goalSchema() {
    if (__CACHED_GOAL_SCHEMA) return __CACHED_GOAL_SCHEMA;
    __CACHED_GOAL_SCHEMA = buildGoalSchemaFromTemplate(DEFAULT_GOAL_TEMPLATE);
    return __CACHED_GOAL_SCHEMA;
}


export var DEFAULT_GLOBAL_SCHEMA = (function() {
    var factionFields = _factionSchema().fields;
    var taskFields = _taskSchema().fields;
    var goalFields = _goalSchema().fields;

    return {
    type: 'object',
    fields: {
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
                        fields: factionFields
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
                                    fields: taskFields
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
                                    fields: goalFields
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
})();

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
    } else if (type === 'object') {
        // P1-7: object 类型原零校验（任意值放行），补类型检查；子字段校验由
        // resolveSchemaPath 的 item_schema 步进 + 扁平化 changes 的独立路径完成
        if (value === null || value === undefined) {
            value = {};
        } else if (typeof value !== 'object' || Array.isArray(value)) {
            return { ok: false, value: value, error: 'Expected object, got: ' + (Array.isArray(value) ? 'array' : typeof value) };
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
    var inItemSchema = false;
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!current) return null;
        if (current.type === 'object' && current.item_schema) {
            // P1-7: map 容器（abilities/inventory）——动态键层（技能名/物品名）不参与
            // schema 匹配，丢弃后进入 item_schema 模板，下一段按字段名匹配
            current = current.item_schema;
            inItemSchema = true;
            continue;
        }
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
        } else if (inItemSchema) {
            // item_schema 裸字段 map（无 type/fields 包装）：part 直接作为字段名。
            // 注意不能靠 !current.type 判断——item_schema 里可能存在名为 type 的字段定义
            current = current[part] || null;
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

    function isEmptyValue(v) {
        return v === undefined || v === null || v === '' || (typeof v === 'number' && isNaN(v));
    }

    Object.keys(changes).forEach(function (path) {
        var fieldSchema = resolveSchemaPath(stateSchema, path);

        if (!fieldSchema) {
            var parts = path.split('.');
            if (parts.length >= 3) {
                var parentPath = parts.slice(0, parts.length - 1).join('.');
                var parentSchema = resolveSchemaPath(stateSchema, parentPath);
                if (parentSchema) {
                    warnings.push({ path: path, warning: 'Rejected unknown sub-field under known parent: ' + path });
                    return;
                }
            }
            warnings.push({ path: path, warning: 'Field not in schema, passing through: ' + path });
            validated[path] = changes[path];
            return;
        }

        var result = validateField(changes[path], fieldSchema);
        if (result.ok) {
            // P1-7: required 字段空值 → 拒绝写入 + warning（保留旧值，避免空值覆盖质量数据）
            if (fieldSchema.required && isEmptyValue(result.value)) {
                warnings.push({ path: path, warning: 'Required field cannot be empty: ' + path });
            } else {
                validated[path] = result.value;
            }
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

// ====== Template Resolution Helpers (N5 three-layer architecture) ======

/**
 * Resolve character template fields using a lock-aware active-version chain.
 * Thin wrapper over resolveActiveTemplateCopy + expandTemplateFields.
 *
 * @param {string|null} stCharName - ST character card name for loading cardConfig
 * @param {string|null} schemeKey - Dialogue template key / scheme ID / sentinel
 * @param {object} [charData] - Character state entry (for _templateLocked / _role)
 * @returns {Object<string, import('../../types.js').SchemaFieldDef>}
 */
export function resolveActiveTemplateFields(stCharName, schemeKey, charData) {
    var copy = resolveActiveTemplateCopy(stCharName, schemeKey, charData);
    return expandTemplateFields(copy);
}

/**
 * Resolve the active template COPY object (the single source of truth for
 * "which template does this character currently use"). Lock-aware:
 *   1. cardConfig._dialogueTemplates:
 *      - schemeKey 直接命中副本：锁定角色钉在该副本；非锁定角色按其 _templateId
 *        解析到当前 _active 主副本（跟随主本）。
 *      - 未直接命中（哨兵 _default_pc / _default_npc 或 KEY 已删除）：按 _templateId
 *        取当前 _active 主副本。
 *   2. Global template library (getEffectiveTemplates) by schemeKey as global ID
 *   3. System default by role (PC->DEFAULT_PC_TEMPLATE, NPC->DEFAULT_NPC_TEMPLATE)
 *
 * Returns a template-like object with presetFields/customFieldRefs. All UI/edit
 * paths should use this instead of re-implementing sentinel/default lookups.
 *
 * @param {string|null} stCharName - ST character card name for loading cardConfig
 * @param {string|null} schemeKey - Dialogue template key / scheme ID / sentinel
 * @param {object} [charData] - Character state entry (for _templateLocked / _role)
 * @returns {object|null} template-like object (presetFields/customFieldRefs/...)
 */
export function resolveActiveTemplateCopy(stCharName, schemeKey, charData) {
    charData = charData || {};
    var isPC = charData._role === 'protagonist' || schemeKey === '_default_pc';
    var locked = !!charData._templateLocked;

    if (stCharName) {
        var cardConfig = loadCardConfigSync(stCharName);
        if (cardConfig && cardConfig._dialogueTemplates && schemeKey) {
            var dt = cardConfig._dialogueTemplates;
            var direct = dt[schemeKey];
            if (direct) {
                if (locked) return direct;
                var tid = direct._templateId;
                var active = (tid && getActiveVersion(dt, tid)) || direct;
                return active;
            }
            var sentinelActive = getActiveVersion(dt, schemeKey);
            if (sentinelActive) return sentinelActive;
        }
    }
    // Fallback 2: global template library lookup by schemeKey as global template ID
    if (schemeKey) {
        var effectiveTpls = getEffectiveTemplates();
        if (effectiveTpls && effectiveTpls.templates && effectiveTpls.templates[schemeKey]) {
            return effectiveTpls.templates[schemeKey];
        }
    }
    // Fallback 3: system default by role
    return isPC ? DEFAULT_PC_TEMPLATE : DEFAULT_NPC_TEMPLATE;
}

/**
 * Resolve faction template fields from cardConfig dialogue templates,
 * falling back to DEFAULT_FACTION_TEMPLATE.
 *
 * @param {string|null} stCharName
 * @returns {Object<string, import('../../types.js').SchemaFieldDef>}
 */
function _resolveFactionTemplateFields(stCharName) {
    if (stCharName) {
        var cardConfig = loadCardConfigSync(stCharName);
        if (cardConfig && cardConfig._dialogueTemplates) {
            var activeTemplate = getActiveVersion(cardConfig._dialogueTemplates, '_default_faction');
            if (activeTemplate) return expandTemplateFields(activeTemplate);
        }
    }
    return expandTemplateFields(DEFAULT_FACTION_TEMPLATE);
}

/**
 * @param {import('../../types.js').State} state
 * @param {string} name
 * @param {string} [schemeKey]
 * @param {string} [stCharName]
 * @param {Object} [tplCache] - D4: 轮内解析缓存（mergeStateChanges 传入，同轮多字段只解析一次模板）
 */
export function ensureCharacterTemplate(state, name, schemeKey, stCharName, tplCache) {
    if (!state.characters) state.characters = {};

    var isPC = (state.protagonist_name && name === state.protagonist_name) ||
        (state.characters[name] && state.characters[name]._role === 'protagonist');

    // Infer default sentinel if schemeKey not provided
    if (!schemeKey) {
        schemeKey = isPC ? '_default_pc' : '_default_npc';
    }

    var template;
    if (isPC) {
        template = _characterSchema().protagonist.fields;
    } else {
        // NPC: resolve template via lock-aware active-version chain
        // D4: 轮内缓存——(stCharName, schemeKey, locked) 相同则复用解析结果，
        // 避免同轮 merge 对 N 个 characters 字段重复 localStorage 读
        var charData = state.characters[name] || {};
        var locked = !!charData._templateLocked;
        var cacheKey = (stCharName || '') + '\x00' + schemeKey + '\x00' + (locked ? '1' : '0');
        if (tplCache && tplCache[cacheKey]) {
            template = tplCache[cacheKey];
        } else {
            template = resolveActiveTemplateFields(stCharName, schemeKey, charData);
            if (tplCache) tplCache[cacheKey] = template;
        }
    }

    // D3: 隐式修改标记——ensureCharacterTemplate 可能补建角色/补齐模板字段，
    // 这些写入不经过 dot-path 值比较，必须返回给 mergeStateChanges 并入 changed，
    // 否则新角色仅输出与骨架默认值相同的字段（如 name）时整体漏写。
    var modified = false;

    // Backfill: if character already exists, add any missing template fields
    if (state.characters[name] && typeof state.characters[name] === 'object' && Object.keys(state.characters[name]).length > 0) {
        Object.keys(template).forEach(function (fk) {
            if (!state.characters[name].hasOwnProperty(fk)) {
                var field = template[fk];
                if (field.type === 'boolean') {
                    state.characters[name][fk] = false;
                } else if (field.type === 'number') {
                    state.characters[name][fk] = null;
                } else {
                    state.characters[name][fk] = '';
                }
                modified = true;
            }
        });
        return modified;
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
    if (!isPC) {
        state.characters[name]._scheme = schemeKey;
    } else {
        state.characters[name]._scheme = '_default_pc';
    }
    return true; // 新角色创建必然修改 state
}

// P1-6: 原型链保留键 —— __proto__/constructor/prototype path 可触发原型污染或校验绕过，写入前一律拦截
function isReservedKey(key) {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
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
    var backfilled = false; // D3: 标记 _scheme 补填——state 值变化但不产生 capturedChanges
    var templateApplied = false; // D3 修复: ensureCharacterTemplate 隐式建角色/补字段的修改标记

    // Backfill _scheme for legacy characters that predate the _scheme field
    if (newState && newState.characters) {
        var protoName = newState.protagonist_name || '';
        Object.keys(newState.characters).forEach(function (cn) {
            var cd = newState.characters[cn];
            if (!cd || typeof cd !== 'object') return;
            if (cd._scheme) return;
            var isPC = (cn === protoName) || (cd._role === 'protagonist');
            cd._scheme = isPC ? '_default_pc' : '_default_npc';
            backfilled = true; // D3
        });
    }

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

    var knownChars = {};
    if (newState && newState.characters) {
        Object.keys(newState.characters).forEach(function (n) { knownChars[n] = true; });
    }
    Object.keys(flattened).forEach(function (p) {
        var pp = p.split('.');
        if (pp[0] === 'characters' && pp[1] && pp[1] !== '*') {
            knownChars[pp[1]] = true;
        }
    });
    var normalizedFlattened = {};
    Object.keys(flattened).forEach(function (path) {
        var parts = path.split('.');
        var newPath = path;
        if (parts.length === 2 && knownChars[parts[1]]) {
            newPath = 'characters.' + parts[1] + '.' + parts[0];
        } else if (parts.length === 2 && knownChars[parts[0]] && parts[0] !== 'characters') {
            newPath = 'characters.' + parts[0] + '.' + parts[1];
        }
        if (newPath !== path) {
            console.warn('[NE] Normalized legacy path:', path, '\u2192', newPath);
        }
        normalizedFlattened[newPath] = flattened[path];
    });
    flattened = normalizedFlattened;

    var hasChanges = false;
    // D4: 轮内模板解析缓存——同轮 merge 对同一 (stCharName, schemeKey, locked) 只解析一次
    var mergeTplCache = {};
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
                    // Still ensure the character exists (with _default_pc from ensureCharacterTemplate)
                    if (!newState.characters[schCharName]) {
                        if (ensureCharacterTemplate(newState, schCharName, '_default_pc', newState.protagonist_name, mergeTplCache)) templateApplied = true;
                    }
                    return;
                }
                // Non-protagonist without _scheme: allow LLM to set it
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
                if (isReservedKey(charName)) return; // P1-6: 拦截 characters.__proto__ 等路径，防止 ensureCharacterTemplate 设置原型
                if (ensureCharacterTemplate(newState, charName, null, newState.protagonist_name, mergeTplCache)) templateApplied = true;
            }
        }

        // 兼容旧 prompt 的 flat quest 路径 quests.<name>.<field> → quests.tasks.<name>.<field>
        if (parts[0] === 'quests' && parts.length >= 3 && parts[1] !== 'tasks' && parts[1] !== 'goals' && parts[1] !== 'events') {
            parts.splice(1, 0, 'tasks');
            console.warn('[NE] Remapped legacy quest path:', path, '→', parts.join('.'));
        }

        var current = newState;

        for (var i = 0; i < parts.length - 1; i++) {
            if (isReservedKey(parts[i])) return; // P1-6: 拦截原型链保留键路径
            if (current[parts[i]] === undefined || current[parts[i]] === null || typeof current[parts[i]] !== 'object') {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }

        var lastKey = parts[parts.length - 1];
        if (isReservedKey(lastKey)) return; // P1-6: 拦截原型链保留键路径
        if (flattened[path] && typeof flattened[path] === 'object' && flattened[path].__inc) {
            // P1-8: 增量语法对任意 number 字段生效（原只对 affection 特判），affection 保留 0-100 clamp
            var delta = flattened[path].delta;
            var curVal = Number(current[lastKey]) || 0;
            var nextVal = curVal + delta;
            if (lastKey === 'affection') nextVal = Math.max(0, Math.min(100, nextVal));
            current[lastKey] = nextVal;
            capturedChanges.push({ path: path, old: curVal, new: nextVal });
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

    // D3: changed 覆盖 capturedChanges 应用 + _scheme backfill + ensureCharacterTemplate 隐式修改
    return { state: newState, changes: capturedChanges, changed: hasChanges || backfilled || templateApplied };
}

// Fields injected for NPC — derived from character schema

/**
 * @param {import('../../types.js').State} state
 * @param {string} name
 * @param {string} [stCharName]
 * @returns {string[]}
 */
export function getNpcInjectionFields(state, name, stCharName) {
    var charData = (state && state.characters && state.characters[name]) || {};
    var schemeKey = charData._scheme || '_default';
    var template = resolveActiveTemplateFields(stCharName, schemeKey, charData);
    return Object.keys(template).filter(function(k) { return k !== 'name'; });
}

/**
 * Dynamically resolve PC injection fields from current PC template or default.
 * Replaces the static PC_INJECTION_FIELDS constant.
 * @param {import('../../types.js').State|null} state
 * @param {string} name
 * @param {string} [stCharName]
 * @returns {string[]}
 */
export function getCharacterInjectionFields(state, name, stCharName) {
    var charData = (state && state.characters && state.characters[name]) || {};
    var isPC = (state && state.protagonist_name && name === state.protagonist_name) ||
        (charData._role === 'protagonist');
    if (!isPC) return getNpcInjectionFields(state, name, stCharName);
    // PC: resolve via unified lock-aware resolver (sentinel _default_pc -> active main copy)
    var pcSchemeKey = charData._scheme || '_default_pc';
    var pcTpl = resolveActiveTemplateFields(stCharName, pcSchemeKey, charData);
    if (pcTpl && Object.keys(pcTpl).length > 0) {
        return Object.keys(pcTpl).filter(function(k) { return k !== 'name'; });
    }
    return Object.keys(_characterSchema().protagonist.fields).filter(function(k) { return k !== 'name'; });
}

/**
 * @param {import('../../types.js').State|null} state
 * @param {Array} messages
 * @param {Object} maxItems
 * @param {Object} world
 * @param {string} [stCharName]
 * @returns {string}
 */
// D5: '本轮提及'判定窗口——最近 N 条消息 + 文本上限，避免全量历史拼接 + 每角色 indexOf 扫描
var INJECTION_MENTION_WINDOW = 20;
var INJECTION_MENTION_MAX_TEXT = 16000;

export function buildStateInjectionTable(state, messages, maxItems, world, stCharName) {
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
            // D5: 只扫最近 INJECTION_MENTION_WINDOW 条，超长文本截断
            var mentionMessages = messages.slice(-INJECTION_MENTION_WINDOW);
            var msgText = mentionMessages.map(function(m) { return m.content || ''; }).join(' ');
            if (msgText.length > INJECTION_MENTION_MAX_TEXT) msgText = msgText.slice(-INJECTION_MENTION_MAX_TEXT);
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
                var fields = isPC ? getCharacterInjectionFields(state, item.key, stCharName) : getNpcInjectionFields(state, item.key, stCharName);

                var fieldDefs;
                if (isPC) {
                    fieldDefs = _characterSchema().protagonist.fields;
                } else {
                    var npcSchemeKey = item.card._scheme || '_default';
                    fieldDefs = resolveActiveTemplateFields(stCharName, npcSchemeKey, item.card);
                }

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
        var factionTemplateFields = _resolveFactionTemplateFields(stCharName);
        var factionNames = Object.keys(state.factions);
        var visibleFactions = factionNames.filter(function (name) {
            var f = state.factions[name];
            return f && typeof f === 'object' && !f._hidden;
        });
        var factionFieldNames = Object.keys(factionTemplateFields).filter(function(fk) { return fk !== 'name'; });
        var factionEnumFields = {};
        factionFieldNames.forEach(function(fk) {
            var def = factionTemplateFields[fk];
            if (def && def.type === 'enum' && def.values) factionEnumFields[fk] = def.values;
        });
        if (visibleFactions.length === 0) {
            parts.push('=== Factions ===');
            var availPaths = factionFieldNames.map(function(fk) {
                var enumSuffix = factionEnumFields[fk] ? '[' + factionEnumFields[fk].join('/') + ']' : '';
                return 'factions.<Name>.' + fk + enumSuffix;
            }).join(', ');
            parts.push('(available paths: ' + availPaths + ')');
            parts.push('(empty — create via factions.<Name>.attitude_toward_player)');
            parts.push('');
        } else {
            parts.push('=== Factions ===');
            visibleFactions.forEach(function (name) {
                var f = state.factions[name];
                if (!f || typeof f !== 'object') return;
                var fields = [];
                factionFieldNames.forEach(function (fk) {
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
        var taskFieldNames = Object.keys(_taskSchema().fields).filter(function(fk) { return fk !== 'name'; });
        var taskEnumFields = {};
        taskFieldNames.forEach(function(fk) {
            var def = _taskSchema().fields[fk];
            if (def && def.type === 'enum' && def.values) taskEnumFields[fk] = def.values;
        });
        var goalFieldNames = Object.keys(_goalSchema().fields).filter(function(fk) { return fk !== 'name'; });
        var goalEnumFields = {};
        goalFieldNames.forEach(function(fk) {
            var def = _goalSchema().fields[fk];
            if (def && def.type === 'enum' && def.values) goalEnumFields[fk] = def.values;
        });
        var hasQuests = false;
        ['tasks', 'goals', 'events'].forEach(function (cat) {
            if (state.quests[cat] && typeof state.quests[cat] === 'object' && Object.keys(state.quests[cat]).length > 0) {
                hasQuests = true;
            }
        });
        if (!hasQuests) {
            parts.push('=== Quests ===');
            parts.push('(available paths:');
            var taskPaths = taskFieldNames.map(function(fk) {
                var enumSuffix = taskEnumFields[fk] ? '[' + taskEnumFields[fk].join('/') + ']' : '';
                return 'quests.tasks.<Name>.' + fk + enumSuffix;
            }).join(', ');
            parts.push('  ' + taskPaths);
            var goalPaths = goalFieldNames.map(function(fk) {
                var enumSuffix = goalEnumFields[fk] ? '[' + goalEnumFields[fk].join('/') + ']' : '';
                return 'quests.goals.<Name>.' + fk + enumSuffix;
            }).join(', ');
            parts.push('  ' + goalPaths);
            parts.push('  quests.events.<Name>.name, status[持续中/已平息/已结束], desc)');
            parts.push('(empty — create via quests.tasks.<Name>.status)');
            parts.push('');
        } else {
            parts.push('=== Quests ===');
            ['tasks', 'goals', 'events'].forEach(function (cat) {
                var catObj = state.quests[cat];
                if (!catObj || typeof catObj !== 'object') return;
                var names = Object.keys(catObj);
                var displayFields = (cat === 'tasks') ? ['name'].concat(taskFieldNames) : (cat === 'goals') ? ['name'].concat(goalFieldNames) : ['name', 'status', 'desc'];
                names.forEach(function (name) {
                    var q = catObj[name];
                    if (!q || typeof q !== 'object') return;
                    var fields = [];
                    displayFields.forEach(function (fk) {
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
        // D4: 字段库只读一次（此前循环内每次 loadFieldLibrary 读 localStorage + JSON.parse）
        var fieldLib = loadFieldLibrary();
        template.customFieldRefs.forEach(function(fn) {
            var def = fieldLib && fieldLib.fields && fieldLib.fields[fn];
            if (def) {
                fields[fn] = { type: def.type };
                if (def.max_length) fields[fn].max_length = def.max_length;
                if (def.min !== undefined) fields[fn].min = def.min;
                if (def.max !== undefined) fields[fn].max = def.max;
                if (def.values) fields[fn].values = def.values.slice();
                if (def.category) fields[fn].category = def.category;
            } else {
                // Fallback: treat as plain string to avoid silent data loss
                fields[fn] = { type: 'string', max_length: 200, category: 'custom' };
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

/**
 * Register a field definition to an NPC scheme's fields map (runtime instance).
 * Used by template LLM's resolveFieldProposal handler when a new field is accepted.
 *
 * NOTE: This operates on the runtime scheme.fields map (the instantiated tracking
 * fields for a specific NPC). For adding a custom field reference to a *template*
 * definition (so it's reused across conversations), use
 * store.js `registerFieldToTemplate(templateId, fieldName)` instead.
 *
 * @param {Object} scheme - dialogue template copy entry { fields: {...} }
 * @param {string} fieldName
 * @param {import('../../types.js').SchemaFieldDef} fieldDef
 * @param {'ai_generated'|'user_created'} source
 */
export function registerFieldToScheme(scheme, fieldName, fieldDef, source) {
    if (!scheme || !scheme.fields) scheme.fields = {};
    fieldDef._source = source || 'ai_generated';
    scheme.fields[fieldName] = fieldDef;
}
