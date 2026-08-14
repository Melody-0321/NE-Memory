/**
 * 公开只读 API — core 层纯函数（平台无关）。
 *
 * 所有返回值强制深拷贝，外部修改不污染内部 IndexedDB 缓存。
 * adapter 层（public-api.js）负责把这些函数包装成 slash 命令 / ST 宏 / window.neMemory。
 *
 * 设计参考：柏宝书 v1.2.4 src/public/query.ts 的 DTO 深拷贝 + 历史时点快照。
 */

import { readVault } from '../vault/store.js';
import { foldState, getActiveChain, listStateDeltas } from '../vault/state-versions.js';

/** API 版本号，外部可据此判断接口兼容性 */
export var PUBLIC_API_VERSION = '1.0.0';

/**
 * 深拷贝——优先用 structuredClone，降级到 JSON。
 * 不直接返回 vault 引用是公开 API 的铁律（__ne_debug 的教训）。
 */
function deepClone(obj) {
    if (obj === null || obj === undefined) return obj;
    try {
        return structuredClone(obj);
    } catch (e) {
        try { return JSON.parse(JSON.stringify(obj)); } catch (e2) { return obj; }
    }
}

/**
 * 获取当前聊天的完整记忆快照（深拷贝）。
 * @param {string} chatId
 * @returns {Promise<object|null>} vault.content 的深拷贝，含 state/stm_entries/ltm_entries/story_* 等
 */
export async function getVaultSnapshot(chatId) {
    try {
        var v = await readVault(chatId);
        if (!v || !v.content) return null;
        return deepClone(v.content);
    } catch (e) {
        console.warn('[NE public-read] getVaultSnapshot failed:', e && e.message);
        return null;
    }
}

/**
 * 获取当前状态（State）的深拷贝。
 * @param {string} chatId
 * @returns {Promise<object|null>} state 对象（characters/factions/quests/protagonist_name 等）
 */
export async function getStateSnapshot(chatId) {
    try {
        var v = await readVault(chatId);
        if (!v || !v.content || !v.content.state) return null;
        return deepClone(v.content.state);
    } catch (e) {
        console.warn('[NE public-read] getStateSnapshot failed:', e && e.message);
        return null;
    }
}

/**
 * 获取场景/时间信息的深拷贝。
 * @param {string} chatId
 * @returns {Promise<object|null>} { story_time, story_scene, story_date, present_characters, ... }
 */
export async function getSceneSnapshot(chatId) {
    try {
        var v = await readVault(chatId);
        if (!v || !v.content) return null;
        var c = v.content;
        return deepClone({
            story_time: c.story_time || '',
            story_scene: c.story_scene || '',
            story_date: c.story_date || '',
            language: c.language || ''
        });
    } catch (e) {
        console.warn('[NE public-read] getSceneSnapshot failed:', e && e.message);
        return null;
    }
}

/**
 * 获取 STM 条目列表的深拷贝。
 * @param {string} chatId
 * @returns {Promise<Array|null>}
 */
export async function getStmSnapshot(chatId) {
    try {
        var v = await readVault(chatId);
        if (!v || !v.content) return null;
        var unconsolidated = v.content.unconsolidated_stm || [];
        var consolidated = v.content.stm_entries || [];
        return deepClone(unconsolidated.concat(consolidated));
    } catch (e) {
        console.warn('[NE public-read] getStmSnapshot failed:', e && e.message);
        return null;
    }
}

/**
 * 获取 LTM 条目列表的深拷贝。
 * @param {string} chatId
 * @returns {Promise<Array|null>}
 */
export async function getLtmSnapshot(chatId) {
    try {
        var v = await readVault(chatId);
        if (!v || !v.content) return null;
        return deepClone(v.content.ltm_entries || []);
    } catch (e) {
        console.warn('[NE public-read] getLtmSnapshot failed:', e && e.message);
        return null;
    }
}

/**
 * 获取指定角色的字段值（深拷贝标量/对象）。
 * @param {string} chatId
 * @param {string} charName — 角色名（state.characters 的 key）
 * @param {string} [field] — 可选字段名（如 status/current_mood/affection/relationship/ties）。
 *                           不传则返回整个角色卡的深拷贝。
 * @returns {Promise<*>} 字段值或角色卡；角色不存在返回 null
 */
export async function getCharacterField(chatId, charName, field) {
    try {
        var v = await readVault(chatId);
        if (!v || !v.content || !v.content.state || !v.content.state.characters) return null;
        var card = v.content.state.characters[charName];
        if (!card) return null;
        if (field === undefined || field === null || field === '') return deepClone(card);
        return deepClone(card[field] !== undefined ? card[field] : null);
    } catch (e) {
        console.warn('[NE public-read] getCharacterField failed:', e && e.message);
        return null;
    }
}

/**
 * 获取所有角色名的深拷贝数组。
 * @param {string} chatId
 * @returns {Promise<Array<string>>}
 */
export async function getCharacterNames(chatId) {
    try {
        var v = await readVault(chatId);
        if (!v || !v.content || !v.content.state || !v.content.state.characters) return [];
        return Object.keys(v.content.state.characters).slice();
    } catch (e) {
        console.warn('[NE public-read] getCharacterNames failed:', e && e.message);
        return [];
    }
}

/**
 * 获取用量统计摘要的深拷贝。
 * @param {string} chatId
 * @returns {Promise<object|null>} { stm_count, ltm_count, unconsolidated_count, character_count, faction_count }
 */
export async function getSummary(chatId) {
    try {
        var v = await readVault(chatId);
        if (!v || !v.content) return null;
        var c = v.content;
        var state = c.state || {};
        return {
            stm_count: (c.unconsolidated_stm || []).length + (c.stm_entries || []).length,
            ltm_count: (c.ltm_entries || []).length,
            unconsolidated_count: (c.unconsolidated_stm || []).length,
            character_count: state.characters ? Object.keys(state.characters).length : 0,
            faction_count: state.factions ? Object.keys(state.factions).length : 0,
            updated_at: v.updated_at || null
        };
    } catch (e) {
        console.warn('[NE public-read] getSummary failed:', e && e.message);
        return null;
    }
}

/**
 * 历史时点状态快照——复用 foldState 回放到指定 seq。
 *
 * @param {string} chatId
 * @param {number} targetSeq — 版本链的 seq 号（来自 listStateDeltas 或 getActiveChain）
 * @returns {Promise<object>} 回放后的 state 深拷贝；seq 无效返回 {}
 */
export async function getStateAtSeq(chatId, targetSeq) {
    try {
        var state = await foldState(chatId, targetSeq, null);
        return deepClone(state || {});
    } catch (e) {
        console.warn('[NE public-read] getStateAtSeq failed:', e && e.message);
        return {};
    }
}

/**
 * 获取版本链元信息（深拷贝）——外部可据此查询历史 seq 列表。
 * @param {string} chatId
 * @returns {Promise<object|null>} chain 的深拷贝，含 state_head_seq / state_base_seq 等
 */
export async function getChainInfo(chatId) {
    try {
        var chain = await getActiveChain(chatId);
        return chain ? deepClone(chain) : null;
    } catch (e) {
        console.warn('[NE public-read] getChainInfo failed:', e && e.message);
        return null;
    }
}

/**
 * 列出最近的 State Delta（深拷贝）——每条 delta 对应一次状态变更。
 * @param {string} chatId
 * @param {number} [limit=20] — 最多返回条数
 * @returns {Promise<Array>} delta 数组，每条含 seq/changes/timestamp
 */
export async function getRecentDeltas(chatId, limit) {
    try {
        var deltas = await listStateDeltas(chatId, limit || 20);
        return deepClone(deltas || []);
    } catch (e) {
        console.warn('[NE public-read] getRecentDeltas failed:', e && e.message);
        return [];
    }
}
