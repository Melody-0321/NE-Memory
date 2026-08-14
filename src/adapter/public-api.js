/**
 * 公开只读 API — adapter 层注册（slash 命令 + ST 宏 + window.neMemory）。
 *
 * 三通道并行，覆盖三类受众：
 *   1. window.neMemory           — JS API（脚本作者）
 *   2. /ne-get slash 命令          — STscript 用户
 *   3. {{neState}} / {{neChar::name.field}} 宏 — 预设作者
 *
 * 所有读操作委托给 core/api/public-read.js（平台无关 + 强制深拷贝）。
 * slash/宏注册用动态 import ST 脚本（参考柏宝书 register.ts 的模式），
 * 失败时降级——只暴露 window.neMemory，slash/宏不可用。
 *
 * 事件订阅：复用 StateBus 的 vault:updated 事件，外部通过 neMemory.onChange(fn) 订阅。
 */

import {
    PUBLIC_API_VERSION,
    getVaultSnapshot,
    getStateSnapshot,
    getSceneSnapshot,
    getStmSnapshot,
    getLtmSnapshot,
    getCharacterField,
    getCharacterNames,
    getSummary,
    getStateAtSeq,
    getChainInfo,
    getRecentDeltas,
} from '../core/api/public-read.js';
import { on as busOn } from './stateBus.js';

var _registered = false;
var _ready = false;
var _listeners = [];
var _capabilities = {
    globalApi: true,
    slashCommand: false,
    macros: false,
    parameterizedMacros: false,
    events: true,
};

// ─── 同步缓存（供宏使用，宏需要同步返回）──────────────────────
// vault:updated 事件触发异步刷新，宏 handler 从缓存同步读取。
var _syncCache = {
    state: null,
    scene: null,
    summary: null,
    characters: {},   // name -> 角色卡深拷贝
    chatId: null,
    timestamp: 0,
};
var _cacheRefreshing = false;

/** 从 payload 提取 chatId（兼容 function / string / undefined） */
function _extractChatId(payload) {
    var gc = payload && payload.getChatId;
    if (typeof gc === 'function') {
        try { return gc(); } catch (e) { return null; }
    }
    if (typeof gc === 'string') return gc;
    return _chatId();
}

/** 异步刷新同步缓存——vault:updated 时调用 */
async function _refreshSyncCache(chatId) {
    if (!chatId) return;
    if (_cacheRefreshing) return;
    _cacheRefreshing = true;
    try {
        var state = await getStateSnapshot(chatId);
        _syncCache.state = state;
        _syncCache.scene = await getSceneSnapshot(chatId);
        _syncCache.summary = await getSummary(chatId);
        _syncCache.characters = {};
        if (state && state.characters) {
            for (var name in state.characters) {
                _syncCache.characters[name] = state.characters[name];
            }
        }
        _syncCache.chatId = chatId;
        _syncCache.timestamp = Date.now();
    } catch (e) {
        console.warn('[NE public-api] sync cache refresh failed:', e && e.message);
    } finally {
        _cacheRefreshing = false;
    }
}

/** 获取当前 chatId——复用 runtime 注入的 getChatId */
function _chatId() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.chatId && ctx.chatId !== 'default') return ctx.chatId;
        }
    } catch (e) {}
    return null;
}

/** 标量转文本——宏和 slash 命令返回 string */
function _scalarText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch (e) { return String(value); }
}

/** vault:updated 事件 handler——刷新同步缓存 + 通知外部订阅者 */
function _onVaultUpdated(payload) {
    var chatId = _extractChatId(payload);
    // 异步刷新宏用的同步缓存
    _refreshSyncCache(chatId);
    // 通知外部订阅者
    _emitChange(chatId);
}

/** 通知所有订阅者 vault 已更新 */
function _emitChange(chatId) {
    var detail = {
        apiVersion: PUBLIC_API_VERSION,
        chatId: chatId || _chatId(),
        capabilities: Object.assign({}, _capabilities),
    };
    for (var i = 0; i < _listeners.length; i++) {
        try { _listeners[i](detail); } catch (e) { console.warn('[NE public-api] 订阅回调异常', e); }
    }
    try {
        window.dispatchEvent(new CustomEvent('ne-memory:changed', { detail: detail }));
    } catch (e) {}
}

// ─── JS API 对象（window.neMemory）──────────────────────────

function _createJsApi() {
    return Object.freeze({
        apiVersion: PUBLIC_API_VERSION,

        get capabilities() { return Object.assign({}, _capabilities); },

        /** 完整 vault 快照（state + stm + ltm + scene） */
        getSnapshot: function() { return getVaultSnapshot(_chatId()); },
        /** 当前状态（characters/factions/quests） */
        getState: function() { return getStateSnapshot(_chatId()); },
        /** 场景时间信息 */
        getScene: function() { return getSceneSnapshot(_chatId()); },
        /** STM 条目列表 */
        getStm: function() { return getStmSnapshot(_chatId()); },
        /** LTM 条目列表 */
        getLtm: function() { return getLtmSnapshot(_chatId()); },
        /** 用量摘要 */
        getSummary: function() { return getSummary(_chatId()); },

        /** 获取指定角色字段（不传 field 返回整张角色卡） */
        getChar: function(name, field) { return getCharacterField(_chatId(), name, field); },
        /** 所有角色名 */
        getCharNames: function() { return getCharacterNames(_chatId()); },

        /** 历史时点状态快照（回放到指定 seq） */
        getStateAtSeq: function(seq) { return getStateAtSeq(_chatId(), seq); },
        /** 版本链元信息 */
        getChainInfo: function() { return getChainInfo(_chatId()); },
        /** 最近 N 条 State Delta */
        getRecentDeltas: function(limit) { return getRecentDeltas(_chatId(), limit); },

        /** 订阅 vault 变更，返回取消订阅函数 */
        onChange: function(listener) {
            if (typeof listener !== 'function') throw new TypeError('onChange listener 必须是函数');
            _listeners.push(listener);
            return function() {
                var idx = _listeners.indexOf(listener);
                if (idx !== -1) _listeners.splice(idx, 1);
            };
        },
    });
}

// ─── Slash 命令注册 ─────────────────────────────────────────

async function _registerSlashCommand() {
    try {
        var parserPath = '/scripts/slash-commands/SlashCommandParser.js';
        var commandPath = '/scripts/slash-commands/SlashCommand.js';
        var argumentPath = '/scripts/slash-commands/SlashCommandArgument.js';
        var results = await Promise.all([
            import(parserPath),
            import(commandPath),
            import(argumentPath),
        ]);
        var SlashCommandParser = results[0].SlashCommandParser;
        var SlashCommand = results[1].SlashCommand;
        var argMod = results[2];
        var ARGUMENT_TYPE = argMod.ARGUMENT_TYPE;
        var SlashCommandArgument = argMod.SlashCommandArgument;
        var SlashCommandNamedArgument = argMod.SlashCommandNamedArgument;

        function named(props) { return SlashCommandNamedArgument.fromProps(props); }

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'ne-get',
            callback: function(args, unnamed) {
                var resource = String(args.resource || (unnamed && unnamed.length ? unnamed[0] : 'snapshot')).trim().toLowerCase();
                var format = String(args.format || 'json').trim().toLowerCase();

                // 同步返回——slash 命令支持返回 Promise
                return _handleSlashQuery(resource, args, format);
            },
            namedArgumentList: [
                named({
                    name: 'resource',
                    description: '要读取的资源：state/scene/stm/ltm/summary/char/chain/deltas',
                    typeList: [ARGUMENT_TYPE.STRING],
                    enumList: ['state', 'scene', 'stm', 'ltm', 'summary', 'char', 'chain', 'deltas', 'snapshot'],
                }),
                named({
                    name: 'name',
                    description: '角色名（resource=char 时必填）',
                    typeList: [ARGUMENT_TYPE.STRING],
                }),
                named({
                    name: 'field',
                    description: '角色字段名（如 status/current_mood/affection/relationship/ties）',
                    typeList: [ARGUMENT_TYPE.STRING],
                }),
                named({
                    name: 'seq',
                    description: '版本链 seq 号（resource=stateAt 时使用）',
                    typeList: [ARGUMENT_TYPE.NUMBER],
                }),
                named({
                    name: 'limit',
                    description: '最近 Delta 条数（resource=deltas 时使用，默认 20）',
                    typeList: [ARGUMENT_TYPE.NUMBER],
                }),
                named({
                    name: 'format',
                    description: '返回格式：json/raw/text',
                    typeList: [ARGUMENT_TYPE.STRING],
                    defaultValue: 'json',
                    enumList: ['json', 'raw', 'text'],
                }),
            ],
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: '可选资源名，默认 snapshot',
                    typeList: [ARGUMENT_TYPE.STRING],
                    enumList: ['state', 'scene', 'stm', 'ltm', 'summary', 'char', 'chain', 'deltas', 'snapshot'],
                }),
            ],
            helpString: '<div>读取 NE Memory 的只读记忆数据。</div>' +
                '<div><code>/ne-get resource=state</code> — 当前状态 JSON</div>' +
                '<div><code>/ne-get resource=char name="张三" field=ties format=raw</code> — 角色字段</div>' +
                '<div><code>/ne-get resource=deltas limit=5</code> — 最近 5 条变更</div>',
            returns: ARGUMENT_TYPE.STRING,
        }));
        return true;
    } catch (error) {
        console.warn('[NE public-api] /ne-get 注册失败', error);
        return false;
    }
}

async function _handleSlashQuery(resource, args, format) {
    var chatId = _chatId();
    var value;
    switch (resource) {
        case 'state':
            value = await getStateSnapshot(chatId); break;
        case 'scene':
            value = await getSceneSnapshot(chatId); break;
        case 'stm':
            value = await getStmSnapshot(chatId); break;
        case 'ltm':
            value = await getLtmSnapshot(chatId); break;
        case 'summary':
            value = await getSummary(chatId); break;
        case 'char':
            var charName = args.name ? String(args.name) : '';
            var field = args.field ? String(args.field) : undefined;
            if (!charName) return JSON.stringify({ error: 'name 参数必填' });
            value = await getCharacterField(chatId, charName, field); break;
        case 'chain':
            value = await getChainInfo(chatId); break;
        case 'deltas':
            value = await getRecentDeltas(chatId, Number(args.limit) || 20); break;
        case 'snapshot':
        default:
            value = await getVaultSnapshot(chatId); break;
    }
    if (format === 'raw') return _scalarText(value);
    if (format === 'text') return _scalarText(value);
    try { return JSON.stringify(value, null, 2); } catch (e) { return _scalarText(value); }
}

// ─── ST 宏注册 ──────────────────────────────────────────────
// 宏 handler 必须同步返回。所有宏从 _syncCache 读取（vault:updated 时异步刷新）。
// 首次访问时缓存可能为空——返回空串，下一个 vault:updated 周期后才有值。

/** 同步读 state JSON */
function _macroState() {
    return _syncCache.state ? JSON.stringify(_syncCache.state) : '';
}
/** 同步读 scene JSON */
function _macroScene() {
    return _syncCache.scene ? JSON.stringify(_syncCache.scene) : '';
}
/** 同步读 summary JSON */
function _macroSummary() {
    return _syncCache.summary ? JSON.stringify(_syncCache.summary) : '';
}
/** 同步读角色字段——不传 field 返回整张角色卡 JSON */
function _macroChar(name, field) {
    if (!name || !_syncCache.characters) return '';
    var card = _syncCache.characters[name];
    if (!card) return '';
    if (!field) return JSON.stringify(card);
    return _scalarText(card[field]);
}

async function _registerMacros() {
    try {
        // 先检测是否启用新版宏引擎
        var powerUserPath = '/scripts/power-user.js';
        var powerUserModule = await import(powerUserPath);
        var useNewEngine = powerUserModule.power_user && powerUserModule.power_user.experimental_macro_engine;

        if (useNewEngine) {
            var macroSystemPath = '/scripts/macros/macro-system.js';
            var macroModule = await import(macroSystemPath);
            var register = macroModule.macros.register;
            var MacroCategory = macroModule.MacroCategory || {};
            var catChat = MacroCategory.CHAT || 'chat';
            var catVar = MacroCategory.VARIABLE || 'variable';

            // 新版参数化宏
            register('neState', {
                category: catChat,
                description: '返回 NE Memory 当前状态 JSON（characters/factions/quests）。同步读缓存，vault 更新后生效。',
                handler: function() { return _macroState(); },
            });
            register('neScene', {
                category: catChat,
                description: '返回 NE Memory 当前场景时间 JSON。',
                handler: function() { return _macroScene(); },
            });
            register('neSummary', {
                category: catChat,
                description: '返回 NE Memory 用量摘要 JSON（stm/ltm/角色计数）。',
                handler: function() { return _macroSummary(); },
            });
            // 参数化宏：{{neChar::角色名}} 或 {{neChar::角色名::字段}}
            register('neChar', {
                category: catVar,
                unnamedArgs: [
                    { name: 'name', type: 'string', sampleValue: '张三', description: '角色名' },
                    { name: 'field', optional: true, type: 'string', sampleValue: 'ties', description: '字段名（省略则返回整个角色卡 JSON）' },
                ],
                description: '返回 NE Memory 中指定角色的字段值。如 {{neChar::张三::ties}} 返回张三的长期关系网。',
                exampleUsage: ['{{neChar::张三::ties}}', '{{neChar::张三::status}}'],
                handler: function(ctx) {
                    var name = ctx.unnamedArgs[0];
                    var field = ctx.unnamedArgs[1];
                    return _macroChar(name, field);
                },
            });
            return { macros: true, parameterized: true };
        }

        // 旧版 fallback——只支持无参宏（不支持 ::参数）
        var legacyPath = '/scripts/macros.js';
        var legacyModule = await import(legacyPath);
        var MacrosParser = legacyModule.MacrosParser;
        if (MacrosParser && typeof MacrosParser.registerMacro === 'function') {
            MacrosParser.registerMacro('neState', function() { return _macroState(); }, '返回 NE Memory 当前状态 JSON。');
            MacrosParser.registerMacro('neScene', function() { return _macroScene(); }, '返回 NE Memory 当前场景时间 JSON。');
            MacrosParser.registerMacro('neSummary', function() { return _macroSummary(); }, '返回 NE Memory 用量摘要 JSON。');
            return { macros: true, parameterized: false };
        }
        console.warn('[NE public-api] 旧版宏引擎 MacrosParser.registerMacro 不可用');
        return { macros: false, parameterized: false };
    } catch (error) {
        console.warn('[NE public-api] 宏注册失败', error);
        return { macros: false, parameterized: false };
    }
}

// ─── 主注册入口 ─────────────────────────────────────────────

/**
 * 注册公开只读 API——三通道并行。
 * 在 init() 完成后调用（vault 已就绪）。
 */
export async function registerPublicApi() {
    if (_registered) return;
    _registered = true;

    // 1. 暴露 window.neMemory（始终可用）
    window.neMemory = _createJsApi();

    // 2. 订阅 StateBus vault:updated 事件——刷新同步缓存 + 通知外部订阅者
    busOn('vault:updated', _onVaultUpdated);

    // 3. 并行注册 slash 命令 + 宏（动态 import ST 脚本，可能失败）
    var results = await Promise.all([
        _registerSlashCommand(),
        _registerMacros(),
    ]);
    _capabilities.slashCommand = results[0];
    _capabilities.macros = results[1].macros;
    _capabilities.parameterizedMacros = results[1].parameterized;

    // 4. 初始刷新同步缓存（宏首次调用时即有数据）
    _refreshSyncCache(_chatId());

    _ready = true;

    // 5. 排发 ready 事件
    try {
        window.dispatchEvent(new CustomEvent('ne-memory:ready', {
            detail: { apiVersion: PUBLIC_API_VERSION, capabilities: Object.assign({}, _capabilities) }
        }));
    } catch (e) {}

    console.log('[NE public-api] 公开只读接口已就绪', Object.assign({}, _capabilities));
}
