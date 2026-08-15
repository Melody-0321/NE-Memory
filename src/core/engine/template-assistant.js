/**
 * template-assistant.js — 模板 AI 助手（制表 + 改表）
 *
 * 用户手动触发的模板设计 Agent：LLM 读取基线模板（+可选世界书 / 值分布），
 * 输出完整目标态草稿 JSON；经协议校验（fingerprint 回显、字段级元数据校验）
 * 后由 UI 渲染 diff 与高风险项，用户确认才落盘。
 *
 * 设计原则（SHUJUKU_REFS §11）：
 *   - LLM 只产草稿，永不下场改真数据；可靠性靠校验结构不靠模型自觉
 *   - 目标态全量输出（非增量操作），编译器退化为纯校验 + 比对
 *   - 单轮会话 + 失败回喂修复重试（默认 ≤2 次），不做自动多轮
 */

import { callMemoryLLM } from '../api/llm.js';
import { safeJsonParse } from './json-fallback.js';
import {
    ALL_PREDEFINED_FIELDS, PRESET_FIELDS, ROLE_CATEGORY_MAP, getPresetFieldsForRole
} from '../vault/schema.js';
import {
    loadFieldLibrary, addFieldToLibrary, saveTemplate,
    addTemplateRefToField, removeTemplateRefFromField
} from '../vault/store.js';
import { t_field } from '../i18n.js';

export var ASSISTANT_PROTOCOL_VERSION = 1;
export var ASSISTANT_ROLES = ['pc', 'npc', 'faction', 'quest'];
export var PER_ROUND_CANDIDATES = ['current_mood', 'inner_thoughts', 'affection', 'relationship', 'injuries', 'status_effects'];
export var ASSISTANT_MAX_REPAIR_RETRIES = 2;
export var ASSISTANT_CONTEXT_BUDGET_CHARS = 48000;

// ─────────────────────────────────────
// Fingerprint
// ─────────────────────────────────────

function _stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(_stableStringify).join(',') + ']';
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + _stableStringify(value[k]); }).join(',') + '}';
}

function _djb2(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
}

/**
 * 计算模板内容指纹（稳定序列化 + 短哈希）。
 * 传入字符串（'scratch' / 'default:pc' / 'default:npc'）时原样返回（不可变基线标记）。
 * @param {Object|string} template
 * @returns {string}
 */
export function buildTemplateFingerprint(template) {
    if (typeof template === 'string') return template;
    if (!template || typeof template !== 'object') return 'scratch';
    var canonical = {
        name: String(template.name || ''),
        role: String(template.role || 'npc'),
        description: String(template.description || ''),
        presetFields: (template.presetFields || []).slice().sort(),
        customFieldRefs: (template.customFieldRefs || []).slice().sort(),
        perRoundFields: (template.perRoundFields || []).slice().sort(),
        tags: (template.tags || []).slice().sort()
    };
    return 'fp1_' + _djb2(_stableStringify(canonical));
}

// ─────────────────────────────────────
// 上下文组装
// ─────────────────────────────────────

/** 构建按角色分组的预设字段目录文本（注入 prompt 供 LLM 选择 presetFields） */
function _buildPresetCatalogText() {
    var lines = [];
    Object.keys(PRESET_FIELDS).forEach(function (cat) {
        var roleHint = cat === 'faction' ? 'faction' : (cat === 'quest' || cat === 'goal' ? 'quest' : 'pc/npc');
        Object.keys(PRESET_FIELDS[cat]).forEach(function (fn) {
            var def = PRESET_FIELDS[cat][fn];
            lines.push('[' + roleHint + '/' + cat + '] ' + fn + ' (' + def.type + ') ' + (t_field(fn) || fn));
        });
    });
    return lines.join('\n');
}

/**
 * 组装助手消息（system 设计规范 + 输出协议；user 模式/基线/目录/值分布/世界书/需求）。
 * @param {Object} ctx — { mode, fingerprint, baselineTemplate, baselineLabel, userRequest,
 *                         worldBookText, valueSummaryText, fieldLibrarySummary, repairErrors }
 * @returns {Array<{role:string, content:string}>}
 */
export function buildAssistantMessages(ctx) {
    var system = [];
    system.push('你是角色状态模板设计助手。根据需求（和可选的世界书设定）输出完整的目标模板。');

    var sys2 = [];
    sys2.push('# 字段类型规范（每个自定义字段必须完整）');
    sys2.push('- string: 必须带 max_length（建议 10~100）');
    sys2.push('- number: 建议带 min/max（有界数值，如好感度 0~100；支持增量增减）');
    sys2.push('- enum: 必须带 values（2~8 个离散值，必须覆盖该字段全部可能状态，如 ["陌生","熟悉","挚友"]）');
    sys2.push('- boolean: 无附加约束');
    sys2.push('# 设计准则');
    sys2.push('1. 离散状态用 enum（填表可靠），可增减数值用 number（支持增量），自由描述才用 string');
    sys2.push('2. 同语义字段优先复用「字段库已登记字段」中的名字');
    sys2.push('3. 自定义字段名：中文、2~6 字、模板内唯一、语义自含');
    sys2.push('4. 禁止：下划线开头的字段名；与预设字段重名；编造世界书未提及的设定');
    sys2.push('5. 修改模式：只改动需求涉及的字段，其余字段（含 presetFields/perRoundFields）原样复制进输出');
    sys2.push('6. 信息不足以确定某字段时，在 understanding 中说明假设，不要静默编造');
    sys2.push('# 输出协议');
    sys2.push('只输出一个 JSON 对象，无 markdown 代码块、无其他文本：');
    sys2.push('{');
    sys2.push('  "protocolVersion": 1,');
    sys2.push('  "baseFingerprint": "<原样回显上面给出的 fingerprint>",');
    sys2.push('  "understanding": "<3~5 句：你对需求与世界观的理解，以及关键设计假设>",');
    sys2.push('  "template": {');
    sys2.push('    "name": "<模板名>", "role": "pc|npc|faction|quest", "description": "<一句话说明>", "tags": ["<标签>"],');
    sys2.push('    "presetFields": ["<预设字段英文 key，仅限目录内>"],');
    sys2.push('    "perRoundFields": ["<每轮字段 key>"],');
    sys2.push('    "customFields": [ { "name": "<中文>", "type": "string|number|enum|boolean", "max_length": 200, "values": ["..."], "min": 0, "max": 100, "description": "可选", "category": "可选" } ]');
    sys2.push('  }');
    sys2.push('}');
    sys2.push('perRoundFields 仅 pc/npc 模板可用，候选：' + PER_ROUND_CANDIDATES.join('、') + '；faction/quest 模板省略此键。');
    system.push(sys2.join('\n'));

    var user = [];
    user.push('## 模式');
    if (ctx.mode === 'modify') {
        user.push('修改模板「' + (ctx.baselineLabel || '') + '」。只改动需求涉及的字段，其余原样保留。');
    } else {
        user.push('新建模板。基线起点：' + (ctx.baselineLabel || '空白') + '。');
    }
    user.push('## fingerprint（必须在 baseFingerprint 中原样回显）');
    user.push(ctx.fingerprint);

    if (ctx.baselineTemplate && (ctx.baselineTemplate.presetFields || []).concat(ctx.baselineTemplate.customFieldRefs || []).length > 0) {
        user.push('## 基线模板（当前完整内容，未提及的字段必须原样保留在输出中）');
        user.push(JSON.stringify({
            name: ctx.baselineTemplate.name,
            role: ctx.baselineTemplate.role,
            description: ctx.baselineTemplate.description || '',
            presetFields: ctx.baselineTemplate.presetFields || [],
            perRoundFields: ctx.baselineTemplate.perRoundFields || [],
            customFields: (ctx.baselineTemplate.customFieldRefs || [])
        }));
    }

    user.push('## 可选预设字段目录（presetFields 只能从中选择）');
    user.push(_buildPresetCatalogText());

    if (ctx.fieldLibrarySummary && ctx.fieldLibrarySummary.length > 0) {
        user.push('## 字段库已登记字段（同语义优先复用名字）');
        user.push(ctx.fieldLibrarySummary.join('、'));
    }

    if (ctx.valueSummaryText) {
        user.push('## 现有角色状态值分布（改结构时必须向后兼容这些值）');
        user.push(ctx.valueSummaryText);
    }

    if (ctx.worldBookText) {
        user.push('## 世界书设定（世界观与设定的唯一事实来源，不得编造未提及内容）');
        user.push(ctx.worldBookText);
    }

    user.push('## 需求');
    user.push(ctx.userRequest || '');

    if (ctx.repairErrors && ctx.repairErrors.length > 0) {
        user.push('## 上一轮输出的问题（必须全部修正后重新输出完整 JSON）');
        ctx.repairErrors.forEach(function (e, i) { user.push((i + 1) + '. ' + e); });
    }

    return [
        { role: 'system', content: system[0] },
        { role: 'system', content: system[1] },
        { role: 'user', content: user.join('\n') }
    ];
}

// ─────────────────────────────────────
// 值分布（L3）
// ─────────────────────────────────────

/**
 * 聚合基线模板引用字段在当前聊天状态中的值分布。
 * enum/number/boolean 全量 distinct，string 取 top10。
 * @returns {{ text: string, map: Object<string, {distinct:string[], total:number}> }}
 */
export function collectFieldValueSummary(stateVault, template) {
    var map = {};
    var empty = { text: '', map: map };
    if (!stateVault || !stateVault.state || !stateVault.state.characters || !template) return empty;
    var chars = stateVault.state.characters;
    var charNames = Object.keys(chars);
    if (charNames.length === 0) return empty;

    var fieldLib = loadFieldLibrary();
    var fields = (template.presetFields || []).concat(template.customFieldRefs || []);
    var lines = [];

    fields.forEach(function (fn) {
        var counts = {};
        var total = 0;
        charNames.forEach(function (cn) {
            var v = chars[cn] ? chars[cn][fn] : undefined;
            if (v === undefined || v === null || v === '') return;
            var key = (typeof v === 'object') ? JSON.stringify(v) : String(v);
            counts[key] = (counts[key] || 0) + 1;
            total++;
        });
        if (total === 0) return;
        var distinct = Object.keys(counts);
        var def = ALL_PREDEFINED_FIELDS[fn] || (fieldLib.fields && fieldLib.fields[fn]) || null;
        var isString = def && def.type === 'string';
        var shown = distinct.slice();
        if (isString && shown.length > 10) {
            shown.sort(function (a, b) { return counts[b] - counts[a]; });
            shown = shown.slice(0, 10);
        }
        map[fn] = { distinct: distinct, total: total };
        var suffix = shown.length < distinct.length ? ' 等' + distinct.length + '种' : '';
        lines.push(fn + '（' + total + '个角色有值）: ' + shown.map(function (v) { return v + '×' + counts[v]; }).join('、') + suffix);
    });

    var text = lines.join('\n');
    if (text.length > 3000) text = text.slice(0, 3000) + '\n…（已截断）';
    return { text: text, map: map };
}

// ─────────────────────────────────────
// 解析 + 校验
// ─────────────────────────────────────

/**
 * @returns {{ ok: boolean, draft?: Object, failureKind?: 'parse', error?: string }}
 */
export function parseAssistantDraft(aiText) {
    if (!aiText || typeof aiText !== 'string') return { ok: false, failureKind: 'parse', error: 'AI 未返回内容' };
    var obj = safeJsonParse(aiText);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { ok: false, failureKind: 'parse', error: '输出无法解析为 JSON 对象' };
    }
    return { ok: true, draft: obj };
}

function _isStr(v) { return typeof v === 'string'; }

/**
 * 校验草稿（全部硬拒规则）。
 * @param {Object} draft — parse 产物
 * @param {Object} expectedCtx — { fingerprint }
 * @returns {{ ok: boolean, errors: string[], failureKind?: 'validate'|'fingerprint' }}
 */
export function validateAssistantDraft(draft, expectedCtx) {
    var errors = [];
    var failureKind = 'validate';

    if (draft.protocolVersion !== ASSISTANT_PROTOCOL_VERSION) {
        errors.push('protocolVersion 必须为 ' + ASSISTANT_PROTOCOL_VERSION + '（得到 ' + JSON.stringify(draft.protocolVersion) + '）');
    }
    if (draft.baseFingerprint !== expectedCtx.fingerprint) {
        errors.push('baseFingerprint 与请求的 fingerprint 不一致（必须原样回显）');
        failureKind = 'fingerprint';
    }
    if (!_isStr(draft.understanding) || !draft.understanding.trim() || draft.understanding.length > 500) {
        errors.push('understanding 必须为 1~500 字符的非空字符串');
    }

    var tpl = draft.template;
    if (!tpl || typeof tpl !== 'object' || Array.isArray(tpl)) {
        errors.push('template 必须为对象');
        return { ok: false, errors: errors, failureKind: failureKind };
    }
    if (!_isStr(tpl.name) || !tpl.name.trim() || tpl.name.length > 30) {
        errors.push('template.name 必须为 1~30 字符的非空字符串');
    }
    if (ASSISTANT_ROLES.indexOf(tpl.role) === -1) {
        errors.push('template.role 必须为 pc/npc/faction/quest 之一');
    }
    if (tpl.description !== undefined && (!_isStr(tpl.description) || tpl.description.length > 200)) {
        errors.push('template.description 必须为 ≤200 字符的字符串');
    }
    if (tpl.tags !== undefined) {
        if (!Array.isArray(tpl.tags) || tpl.tags.length > 5 || tpl.tags.some(function (tg) { return !_isStr(tg) || !tg.trim() || tg.length > 20; })) {
            errors.push('template.tags 必须为 ≤5 个（每个 1~20 字符）的字符串数组');
        }
    }

    var role = ASSISTANT_ROLES.indexOf(tpl.role) !== -1 ? tpl.role : null;
    var allowedPresets = role ? getPresetFieldsForRole(role) : {};
    if (tpl.presetFields !== undefined) {
        if (!Array.isArray(tpl.presetFields) || tpl.presetFields.some(function (f) { return !_isStr(f); })) {
            errors.push('presetFields 必须为字符串数组');
        } else {
            var seenPreset = {};
            tpl.presetFields.forEach(function (f) {
                if (seenPreset[f]) errors.push('presetFields 存在重复: ' + f);
                seenPreset[f] = true;
                if (!allowedPresets[f]) errors.push('presetFields 中的 "' + f + '" 不在角色 ' + (role || '?') + ' 允许的预设字段目录内');
            });
        }
    }

    if (tpl.perRoundFields !== undefined) {
        if (role !== 'pc' && role !== 'npc') {
            errors.push('perRoundFields 仅 pc/npc 模板可用');
        }
        if (!Array.isArray(tpl.perRoundFields) || tpl.perRoundFields.some(function (f) { return !_isStr(f); })) {
            errors.push('perRoundFields 必须为字符串数组');
        } else {
            tpl.perRoundFields.forEach(function (f) {
                if (PER_ROUND_CANDIDATES.indexOf(f) === -1) {
                    errors.push('perRoundFields 中的 "' + f + '" 不在候选集内（' + PER_ROUND_CANDIDATES.join('、') + '）');
                }
            });
        }
    }

    if (tpl.customFields !== undefined) {
        if (!Array.isArray(tpl.customFields)) {
            errors.push('customFields 必须为数组');
        } else {
            var presetSet = {};
            (tpl.presetFields || []).forEach(function (f) { presetSet[f] = true; });
            var seenCustom = {};
            tpl.customFields.forEach(function (cf, idx) {
                var at = 'customFields[' + idx + ']';
                if (!cf || typeof cf !== 'object' || Array.isArray(cf)) { errors.push(at + ' 必须为对象'); return; }
                var name = cf.name;
                if (!_isStr(name) || !name.trim() || name.length > 20) { errors.push(at + '.name 必须为 1~20 字符的非空字符串'); return; }
                if (name.charAt(0) === '_') errors.push(at + '.name 不得以下划线开头: ' + name);
                if (ALL_PREDEFINED_FIELDS[name]) errors.push(at + '.name 与预定义字段冲突: ' + name);
                if (presetSet[name]) errors.push(at + '.name 与 presetFields 重名: ' + name);
                if (seenCustom[name]) errors.push(at + '.name 在模板内重复: ' + name);
                seenCustom[name] = true;
                var type = cf.type;
                if (['string', 'number', 'enum', 'boolean'].indexOf(type) === -1) {
                    errors.push(at + '("' + name + '").type 必须为 string/number/enum/boolean 之一');
                    return;
                }
                if (type === 'string') {
                    if (typeof cf.max_length !== 'number' || !isFinite(cf.max_length) || cf.max_length < 1 || cf.max_length > 500 || Math.floor(cf.max_length) !== cf.max_length) {
                        errors.push(at + '("' + name + '") string 类型必须带 1~500 的整数 max_length');
                    }
                } else if (type === 'enum') {
                    if (!Array.isArray(cf.values) || cf.values.length < 2 || cf.values.length > 8 || cf.values.some(function (v) { return !_isStr(v) || !v.trim(); })) {
                        errors.push(at + '("' + name + '") enum 类型必须带 2~8 个非空字符串 values');
                    } else {
                        var vs = cf.values.map(function (v) { return v.trim(); });
                        var uniq = vs.filter(function (v, i) { return vs.indexOf(v) === i; });
                        if (uniq.length !== vs.length) errors.push(at + '("' + name + '") enum values 存在重复');
                    }
                } else if (type === 'number') {
                    var hasMin = typeof cf.min === 'number' && isFinite(cf.min);
                    var hasMax = typeof cf.max === 'number' && isFinite(cf.max);
                    if (cf.min !== undefined && !hasMin) errors.push(at + '("' + name + '") min 必须为数字');
                    if (cf.max !== undefined && !hasMax) errors.push(at + '("' + name + '") max 必须为数字');
                    if (hasMin && hasMax && cf.min >= cf.max) errors.push(at + '("' + name + '") min 必须小于 max');
                }
            });
        }
    }

    if (errors.length > 0) return { ok: false, errors: errors, failureKind: failureKind };
    return { ok: true, errors: [] };
}

// ─────────────────────────────────────
// 应用计划（diff + 高风险）
// ─────────────────────────────────────

function _metaOf(cf) {
    var m = { type: cf.type };
    if (cf.type === 'string' || cf.type === 'enum') {
        if (typeof cf.max_length === 'number') m.max_length = cf.max_length;
    }
    if (cf.type === 'enum' && Array.isArray(cf.values)) m.values = cf.values.map(function (v) { return v.trim(); });
    if (cf.type === 'number') {
        if (typeof cf.min === 'number') m.min = cf.min;
        if (typeof cf.max === 'number') m.max = cf.max;
    }
    return m;
}

function _sameMeta(a, b) {
    var ka = Object.keys(a).sort();
    var kb = Object.keys(b).sort();
    if (ka.join(',') !== kb.join(',')) return false;
    return ka.every(function (k) { return JSON.stringify(a[k]) === JSON.stringify(b[k]); });
}

/**
 * 由草稿构建应用计划（不落盘）。
 * @param {Object} draft — 已通过校验的草稿
 * @param {Object|null} baseline — 基线模板（modify 为当前模板；create-from-default 为默认模板）
 * @param {Object} fieldLib — loadFieldLibrary() 结果
 * @param {Object} opts — { mode, valueMap }
 */
export function buildApplyPlan(draft, baseline, fieldLib, opts) {
    opts = opts || {};
    var mode = opts.mode || 'create';
    var valueMap = opts.valueMap || {};
    var t = draft.template;
    var libFields = (fieldLib && fieldLib.fields) || {};

    var customFields = Array.isArray(t.customFields) ? t.customFields : [];
    var customRefs = customFields.map(function (cf) { return cf.name; });
    var presetFields = Array.isArray(t.presetFields) ? t.presetFields : [];
    var perRoundFields = (t.role === 'pc' || t.role === 'npc') ? (Array.isArray(t.perRoundFields) ? t.perRoundFields : []) : undefined;

    // 系统默认模板作为基线（或 create 模式）→ 生成新 id；modify 用户模板 → 保留
    var isSystemBaseline = mode === 'create' || !baseline || baseline.system;
    var now = new Date().toISOString();
    var template = {
        id: isSystemBaseline ? ('tpl_' + Date.now()) : baseline.id,
        name: t.name.trim(),
        role: t.role,
        description: _isStr(t.description) ? t.description : '',
        presetFields: presetFields,
        customFieldRefs: customRefs,
        perRoundFields: perRoundFields,
        tags: Array.isArray(t.tags) ? t.tags : [],
        _locked: !isSystemBaseline && baseline ? !!baseline._locked : false,
        source: isSystemBaseline ? 'ai_generated' : (baseline && baseline.source) || 'user_created',
        system: false,
        createdAt: (!isSystemBaseline && baseline && baseline.createdAt) ? baseline.createdAt : now,
        updatedAt: now
    };

    // 字段库操作：add / update / reuse
    var fieldOps = [];
    customFields.forEach(function (cf) {
        var meta = _metaOf(cf);
        var existing = libFields[cf.name];
        if (!existing) {
            var entry = Object.assign({ description: _isStr(cf.description) ? cf.description : '' }, meta);
            if (_isStr(cf.category)) entry.category = cf.category;
            fieldOps.push({ op: 'add', name: cf.name, entry: entry });
        } else {
            var existingMeta = { type: existing.type };
            if (existing.max_length !== undefined) existingMeta.max_length = existing.max_length;
            if (existing.values !== undefined) existingMeta.values = existing.values;
            if (existing.min !== undefined) existingMeta.min = existing.min;
            if (existing.max !== undefined) existingMeta.max = existing.max;
            if (_sameMeta(existingMeta, meta)) {
                fieldOps.push({ op: 'reuse', name: cf.name });
            } else {
                var merged = Object.assign({}, existing, meta);
                if (_isStr(cf.description) && cf.description) merged.description = cf.description;
                fieldOps.push({
                    op: 'update', name: cf.name, entry: merged,
                    affectedTemplates: (existing.usedByTemplates || []).length
                });
            }
        }
    });

    // ref 维护（仅保留 id 的 modify 场景需要移除旧 ref）
    var oldRefs = (!isSystemBaseline && baseline) ? (baseline.customFieldRefs || []) : [];
    var refAdds = customRefs.filter(function (fn) { return oldRefs.indexOf(fn) === -1; });
    var refRemoves = oldRefs.filter(function (fn) { return customRefs.indexOf(fn) === -1; });

    // diff
    var oldPresets = baseline ? (baseline.presetFields || []) : [];
    var oldPerRound = baseline ? (baseline.perRoundFields || []) : [];
    var diff = {
        presetAdded: presetFields.filter(function (f) { return oldPresets.indexOf(f) === -1; }),
        presetRemoved: oldPresets.filter(function (f) { return presetFields.indexOf(f) === -1; }),
        perRoundAdded: perRoundFields ? perRoundFields.filter(function (f) { return oldPerRound.indexOf(f) === -1; }) : [],
        perRoundRemoved: (t.role === 'pc' || t.role === 'npc') ? oldPerRound.filter(function (f) { return !perRoundFields || perRoundFields.indexOf(f) === -1; }) : [],
        customAdded: customFields.filter(function (cf) { return oldRefs.indexOf(cf.name) === -1; }).map(function (cf) { return _metaOf(cf); }),
        customRemoved: refRemoves.slice(),
        customModified: [],
        metaChanged: baseline ? ['name', 'role', 'description', 'tags'].filter(function (k) {
            return JSON.stringify(baseline[k] || (k === 'tags' ? [] : '')) !== JSON.stringify(k === 'tags' ? template.tags : template[k]);
        }) : []
    };
    customFields.forEach(function (cf) {
        if (oldRefs.indexOf(cf.name) === -1) return;
        var existing = libFields[cf.name];
        if (!existing) return;
        var existingMeta = { type: existing.type };
        if (existing.max_length !== undefined) existingMeta.max_length = existing.max_length;
        if (existing.values !== undefined) existingMeta.values = existing.values;
        if (existing.min !== undefined) existingMeta.min = existing.min;
        if (existing.max !== undefined) existingMeta.max = existing.max;
        var meta = _metaOf(cf);
        if (!_sameMeta(existingMeta, meta)) {
            diff.customModified.push({ name: cf.name, before: existingMeta, after: meta });
        }
    });

    // 高风险项
    var highRiskItems = [];
    refRemoves.forEach(function (fn) {
        var usage = valueMap[fn];
        highRiskItems.push({
            kind: 'field_removed',
            label: fn,
            detail: usage ? usage.total + ' 个角色持有该字段值，应用后字段从模板移除（字段库不删，历史数据不清理）' : ''
        });
    });
    diff.customModified.forEach(function (m) {
        if (m.before.type !== m.after.type) {
            highRiskItems.push({ kind: 'type_changed', label: m.name, detail: m.before.type + ' → ' + m.after.type });
        } else if (m.after.type === 'enum' && Array.isArray(m.before.values)) {
            var removed = (m.before.values || []).filter(function (v) { return (m.after.values || []).indexOf(v) === -1; });
            if (removed.length > 0) {
                var inUse = valueMap[m.name] ? removed.filter(function (v) { return valueMap[m.name].distinct.indexOf(v) !== -1; }) : [];
                highRiskItems.push({
                    kind: 'enum_narrowed',
                    label: m.name,
                    detail: '枚举移除: ' + removed.join('、') + (inUse.length > 0 ? '（其中存量数据在用: ' + inUse.join('、') + '）' : '')
                });
            }
        }
    });
    fieldOps.forEach(function (op) {
        if (op.op === 'update') {
            highRiskItems.push({
                kind: 'lib_update',
                label: op.name,
                detail: '字段库定义将更新' + (op.affectedTemplates > 0 ? '（被 ' + op.affectedTemplates + ' 个模板引用，将一并生效）' : '')
            });
        }
    });

    return {
        mode: mode,
        template: template,
        fieldOps: fieldOps,
        refAdds: refAdds,
        refRemoves: refRemoves,
        diff: diff,
        highRiskItems: highRiskItems
    };
}

/** 应用计划落盘：字段库 → 模板 → ref 维护（与编辑器保存路径同款顺序） */
export function applyAssistantPlan(plan) {
    plan.fieldOps.forEach(function (op) {
        if (op.op === 'add' || op.op === 'update') {
            addFieldToLibrary(op.name, op.entry);
        }
    });
    saveTemplate(plan.template);
    plan.refAdds.forEach(function (fn) { addTemplateRefToField(fn, plan.template.id); });
    plan.refRemoves.forEach(function (fn) { removeTemplateRefFromField(fn, plan.template.id); });
    return { templateId: plan.template.id };
}

// ─────────────────────────────────────
// 编排（单轮 + 修复重试）
// ─────────────────────────────────────

/**
 * @param {Object} ctx — { mode, baselineTemplate, baselineLabel, fingerprint, userRequest,
 *                         worldBookText, valueSummaryText, valueMap, chatId, maxRepairRetries }
 * @returns {Promise<{ok:boolean, draft?:Object, plan?:Object, attempts?:number,
 *                     failureKind?:'context_budget'|'retry_exhausted', errors?:string[], aiRawText?:string}>}
 */
export async function runTemplateAssistant(ctx) {
    var maxRepair = (ctx.maxRepairRetries !== undefined) ? ctx.maxRepairRetries : ASSISTANT_MAX_REPAIR_RETRIES;

    var fieldLib = loadFieldLibrary();
    var libNames = Object.keys(fieldLib.fields || {}).slice(0, 100);
    var base = {
        mode: ctx.mode,
        fingerprint: ctx.fingerprint,
        baselineTemplate: ctx.baselineTemplate || null,
        baselineLabel: ctx.baselineLabel || '',
        userRequest: ctx.userRequest || '',
        worldBookText: ctx.worldBookText || '',
        valueSummaryText: ctx.valueSummaryText || '',
        fieldLibrarySummary: libNames.map(function (n) {
            return n + '(' + ((fieldLib.fields[n] || {}).type || 'string') + ')';
        })
    };

    // 上下文预算门禁：超限硬失败，不静默截断基线/值分布
    var firstMessages = buildAssistantMessages(base);
    var totalChars = firstMessages.reduce(function (s, m) { return s + m.content.length; }, 0);
    if (totalChars > ASSISTANT_CONTEXT_BUDGET_CHARS) {
        return { ok: false, failureKind: 'context_budget', errors: ['上下文超出预算（约 ' + totalChars + ' 字符 > ' + ASSISTANT_CONTEXT_BUDGET_CHARS + '）：请取消勾选世界书或缩减需求'] };
    }

    var repairErrors = [];
    var attempts = 0;
    for (var round = 0; round <= maxRepair; round++) {
        attempts++;
        var messages = (round === 0) ? firstMessages : buildAssistantMessages(Object.assign({}, base, { repairErrors: repairErrors }));
        var aiText = '';
        try {
            aiText = await callMemoryLLM(messages, {
                operation: 'template_assistant',
                temperature: 0.4,
                _forcePipelineApi: true,
                chatId: ctx.chatId || null
            });
        } catch (e) {
            return { ok: false, failureKind: 'llm_error', errors: [(e && e.message) || 'LLM 调用失败'], attempts: attempts };
        }

        var parsed = parseAssistantDraft(aiText);
        if (!parsed.ok) {
            repairErrors = [parsed.error];
            continue;
        }
        var val = validateAssistantDraft(parsed.draft, { fingerprint: base.fingerprint });
        if (!val.ok) {
            repairErrors = val.errors;
            continue;
        }
        var plan = buildApplyPlan(parsed.draft, base.baselineTemplate, fieldLib, { mode: base.mode, valueMap: ctx.valueMap });
        return { ok: true, draft: parsed.draft, plan: plan, attempts: attempts, aiRawText: aiText };
    }
    return { ok: false, failureKind: 'retry_exhausted', errors: repairErrors, attempts: attempts };
}
