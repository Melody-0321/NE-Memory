/**
 * engine/state-discovery.js — 动态字段发现
 *
 * 从角色卡描述、开场白、世界书中自动发现状态栏字段定义，
 * 使 ne-memory 的 state 系统能自适应任意角色卡。
 *
 * 双模式：
 *   - dynamic_state 有数据 → 动态模式（使用发现的自定义字段）
 *   - dynamic_state 为空   → 固定模式（回退到现有硬编码字段）
 */

// ─── 常见叙述词，过滤假阳性 ───
var NARRATIVE_KEYS = [
    '他说', '我说', '你说', '她说', '因为', '然后', '所以', '但是', '不过',
    '如果', '虽然', '于是', '接着', '最后', '首先', '其次', '总之',
    '另外', '例如', '比如', '包括', '除了', '关于', '对于', '根据',
    'he said', 'she said', 'i said', 'because', 'then', 'but', 'however',
    'if', 'although', 'so', 'next', 'finally', 'first', 'second', 'also',
    'for example', 'including', 'regarding', 'according to', 'about'
];

// ─── 字段名最小/最大长度 ───
var MIN_KEY_LENGTH = 1;
var MAX_KEY_LENGTH = 25;
var MAX_VALUE_LENGTH = 200;

// ─── 状态栏指示关键词（这些行附近更容易出现状态字段） ───
var STATUSBAR_KEYWORDS = [
    '状态', 'status', '属性', 'stats', '数值', '参数',
    'HP', 'MP', 'SP', '体力', '魔力', '生命', '精力'
];

function isNarrativeKey(key) {
    var lower = key.toLowerCase().trim();
    for (var i = 0; i < NARRATIVE_KEYS.length; i++) {
        if (lower === NARRATIVE_KEYS[i].toLowerCase()) return true;
    }
    return false;
}

function isValidFieldKey(key) {
    key = key.trim();
    if (!key || key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) return false;
    if (isNarrativeKey(key)) return false;
    // 排除纯数字/纯标点
    if (/^[\d\p{P}]+$/u.test(key)) return false;
    // 排除看起来像句子开头的
    if (/[\u4e00-\u9fff]{15,}/.test(key)) return false;
    return true;
}

function isValidFieldValue(value) {
    value = value.trim();
    if (!value || value.length > MAX_VALUE_LENGTH) return false;
    return true;
}

/**
 * 从文本中提取 key:value 对
 * 返回 { global: { key: value }, byCharacter: { name: { key: value } } }
 */
export function extractStateFields(text, characterNames) {
    if (!text || typeof text !== 'string') return { global: {}, byCharacter: {} };
    characterNames = characterNames || [];

    var global = {};
    var byCharacter = {};
    var lines = text.split('\n');

    // ── 模式 1：单行独立字段 "key: value" 或 "key： value" ──
    var kvRegex = /^\s*(\S[^:：]{0,24})[:：]\s*(.+?)\s*$/;

    // ── 模式 2：多字段同行（用 2+ 空格或 | 分隔） "HP: 100  MP: 200"
    var multiKvRegex = /(\S[^:：]{0,24})[:：]\s*(\S+)/g;

    // ── 模式 3：括号字段 "【key:value】" / "[key: value]"
    var bracketRegex = /[【\[](\S[^：:\]】]{0,24})[：:]([^】\]\n]+?)[】\]]/g;

    // ── 模式 4：ST 变量语法 "{{getvar::name}}" / "{{setvar::name::value}}"
    var stVarRegex = /\{\{(?:getvar|setvar)::(\S+?)::?(\S*?)\}\}/g;

    var statusBarNearby = false;
    var statusBarLineCount = 0;

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li];

        // 检测是否在状态栏附近
        var lowerLine = line.toLowerCase();
        for (var k = 0; k < STATUSBAR_KEYWORDS.length; k++) {
            if (lowerLine.indexOf(STATUSBAR_KEYWORDS[k].toLowerCase()) !== -1) {
                statusBarNearby = true;
                statusBarLineCount = 3; // 接下来的 3 行也在状态栏范围内
                break;
            }
        }

        // ── 单行独立字段 ──
        var singleMatch = line.match(kvRegex);
        if (singleMatch) {
            var key = singleMatch[1].trim();
            var val = singleMatch[2].trim();

            if (isValidFieldKey(key) && isValidFieldValue(val)) {
                // 检查是否在某角色名下
                var belongsTo = null;
                for (var c = 0; c < characterNames.length; c++) {
                    if (key.indexOf(characterNames[c]) === 0 || line.indexOf(characterNames[c]) !== -1) {
                        belongsTo = characterNames[c];
                        break;
                    }
                }
                if (belongsTo) {
                    if (!byCharacter[belongsTo]) byCharacter[belongsTo] = {};
                    byCharacter[belongsTo][key] = val;
                } else if (statusBarNearby || statusBarLineCount > 0) {
                    global[key] = val;
                }
            }
        }

        // ── 多字段同行 ──
        if (statusBarNearby || statusBarLineCount > 0) {
            var multiMatch = line.matchAll(multiKvRegex);
            if (multiMatch) {
                var matches = Array.from(multiMatch);
                if (matches.length >= 2) {
                    for (var m = 0; m < matches.length; m++) {
                        var mk = matches[m][1].trim();
                        var mv = matches[m][2].trim();
                        if (isValidFieldKey(mk) && isValidFieldValue(mv)) {
                            global[mk] = mv;
                        }
                    }
                }
            }
        }

        // ── 括号字段 ──
        var bracketMatch = line.matchAll(bracketRegex);
        if (bracketMatch) {
            var bMatches = Array.from(bracketMatch);
            for (var b = 0; b < bMatches.length; b++) {
                var bk = bMatches[b][1].trim();
                var bv = bMatches[b][2].trim();
                if (isValidFieldKey(bk) && isValidFieldValue(bv)) {
                    // 括号字段通常属于特定角色
                    var bBelongsTo = null;
                    for (var bc = 0; bc < characterNames.length; bc++) {
                        if (line.indexOf(characterNames[bc]) !== -1) {
                            bBelongsTo = characterNames[bc];
                            break;
                        }
                    }
                    if (bBelongsTo) {
                        if (!byCharacter[bBelongsTo]) byCharacter[bBelongsTo] = {};
                        byCharacter[bBelongsTo][bk] = bv;
                    } else {
                        global[bk] = bv;
                    }
                }
            }
        }

        // ── ST 变量 ──
        var varMatch = line.matchAll(stVarRegex);
        if (varMatch) {
            var vMatches = Array.from(varMatch);
            for (var v = 0; v < vMatches.length; v++) {
                var vk = vMatches[v][1].trim();
                var vv = vMatches[v][2].trim() || '';
                if (isValidFieldKey(vk)) {
                    global[vk] = vv || '(variable)';
                }
            }
        }

        if (statusBarLineCount > 0) statusBarLineCount--;
    }

    return { global: global, byCharacter: byCharacter };
}

/**
 * 从 ST context 读取角色卡和世界书，发现动态字段
 * 返回 { discovered: boolean, fields: object }
 */
export function discoverDynamicFields(vault) {
    if (!vault || !vault.content) return { discovered: false };

    var dynamicState = null;
    var ctx = null;
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            ctx = SillyTavern.getContext();
        }
    } catch (e) {
        return { discovered: false };
    }
    if (!ctx) return { discovered: false };

    var characters = ctx.characters || [];
    var worldInfo = ctx.worldInfo;
    var characterNames = [];
    var texts = [];

    // 收集角色卡文本
    for (var i = 0; i < characters.length; i++) {
        var char = characters[i];
        if (!char || !char.name) continue;
        characterNames.push(char.name);

        if (char.description) texts.push(char.description);
        if (char.first_mes) texts.push(char.first_mes);
        if (char.personality) texts.push(char.personality);
        if (char.scenario) texts.push(char.scenario);
    }

    // 收集世界书文本（仅启用的世界书 + 未禁用的条目）
    if (worldInfo && worldInfo.entries) {
        // 构建启用的世界书名集合（多重回退）
        var enabledBooks = {};
        try {
            var globalSelect = null;
            // 方法1: ctx.extensionSettings.world_info.globalSelect
            var extSettings = ctx.extensionSettings || null;
            if (extSettings && extSettings.world_info && Array.isArray(extSettings.world_info.globalSelect)) {
                globalSelect = extSettings.world_info.globalSelect;
                console.log('[NE] Enabled books from extensionSettings:', globalSelect.length);
            }
            // 方法2: ctx.powerUserSettings.world_info.globalSelect
            if (!globalSelect && ctx.powerUserSettings && ctx.powerUserSettings.world_info && Array.isArray(ctx.powerUserSettings.world_info.globalSelect)) {
                globalSelect = ctx.powerUserSettings.world_info.globalSelect;
                console.log('[NE] Enabled books from powerUserSettings:', globalSelect.length);
            }
            // 方法3: 从 ST 全局变量读取
            if (!globalSelect && typeof window !== 'undefined') {
                try {
                    var wi = window.world_info || (window.__ST && window.__ST.world_info);
                    if (wi && wi.globalSelect && Array.isArray(wi.globalSelect)) {
                        globalSelect = wi.globalSelect;
                        console.log('[NE] Enabled books from window:', globalSelect.length);
                    }
                } catch (ww) {}
            }
            if (globalSelect) {
                for (var si = 0; si < globalSelect.length; si++) {
                    enabledBooks[globalSelect[si]] = true;
                }
            }
            // 角色绑定的世界书
            for (var ci = 0; ci < characters.length; ci++) {
                var charWorld = characters[ci] && characters[ci].data && characters[ci].data.extensions && characters[ci].data.extensions.world;
                if (charWorld) enabledBooks[charWorld] = true;
            }
        } catch (e) { console.warn('[NE] Failed to build enabled books set:', e); }

        var hasEnabledFilter = Object.keys(enabledBooks).length > 0;
        var entryKeys = Object.keys(worldInfo.entries);
        for (var j = 0; j < entryKeys.length; j++) {
            var entry = worldInfo.entries[entryKeys[j]];
            if (!entry || !entry.content) continue;
            // 条目级：跳过手动禁用的
            if (entry.disable) continue;
            // 世界书级：只保留已启用世界书中的条目（如果能获取到启用列表）
            if (hasEnabledFilter && entry.world && !enabledBooks[entry.world]) continue;
            texts.push(entry.content);
        }
    }

    if (texts.length === 0) return { discovered: false };

    // 从所有文本中提取字段
    var allGlobal = {};
    var allByCharacter = {};

    for (var t = 0; t < texts.length; t++) {
        var extracted = extractStateFields(texts[t], characterNames);
        // 合并全局字段
        var globalKeys = Object.keys(extracted.global);
        for (var g = 0; g < globalKeys.length; g++) {
            var gk = globalKeys[g];
            if (!(gk in allGlobal)) allGlobal[gk] = extracted.global[gk];
        }
        // 合并角色字段
        var charKeys = Object.keys(extracted.byCharacter);
        for (var c = 0; c < charKeys.length; c++) {
            var cn = charKeys[c];
            if (!allByCharacter[cn]) allByCharacter[cn] = {};
            var fKeys = Object.keys(extracted.byCharacter[cn]);
            for (var f = 0; f < fKeys.length; f++) {
                var fk = fKeys[f];
                if (!(fk in allByCharacter[cn])) {
                    allByCharacter[cn][fk] = extracted.byCharacter[cn][fk];
                }
            }
        }
    }

    var hasFields = Object.keys(allGlobal).length > 0 || Object.keys(allByCharacter).length > 0;
    if (!hasFields) return { discovered: false };

    // 检测当前语言
    var lang = 'zh';
    try {
        var rawSettings = localStorage.getItem('ne_settings');
        if (rawSettings) {
            var settings = JSON.parse(rawSettings);
            if (settings.language) lang = settings.language;
        }
    } catch (e) {}

    // 存储到 vault
    vault.content.dynamic_state = {
        _discovered: Date.now(),
        global: allGlobal,
        characters: allByCharacter
    };

    return {
        discovered: true,
        fields: vault.content.dynamic_state
    };
}

/**
 * 构建动态字段 prompt 注入文本
 * @param {object} dynamicState - vault.content.dynamic_state
 * @param {string} lang - 'en' | 'zh'
 * @returns {string} prompt text
 */
export function buildDynamicStatePrompt(dynamicState, lang) {
    if (!dynamicState) return '';
    lang = lang || 'zh';

    var global = dynamicState.global || {};
    var characters = dynamicState.characters || {};
    var lines = [];

    if (lang === 'en') {
        // 全局字段
        var gKeys = Object.keys(global);
        if (gKeys.length > 0) {
            var gParts = [];
            for (var i = 0; i < gKeys.length; i++) {
                gParts.push(gKeys[i] + '=' + global[gKeys[i]]);
            }
            lines.push('Global dynamic state: ' + gParts.join(', '));
        }

        // 角色字段
        var cNames = Object.keys(characters);
        for (var j = 0; j < cNames.length; j++) {
            var cn = cNames[j];
            var cf = characters[cn];
            var fKeys = Object.keys(cf);
            if (fKeys.length === 0) continue;
            var cParts = [];
            for (var k = 0; k < fKeys.length; k++) {
                cParts.push(fKeys[k] + '=' + cf[fKeys[k]]);
            }
            lines.push('- dynamic.characters.' + cn + ': ' + cParts.join(', '));
        }

        if (lines.length === 0) return '';

        return '\n=== Dynamic Character States (discovered from character card) ===\n' +
            lines.join('\n') + '\n\n' +
            'You can update any dynamic field via <state_changes> using the exact key names above, e.g.:\n' +
            '<state_changes>{"dynamic.characters.Alice.HP":"80/100"}</state_changes>\n';
    } else {
        // 中文
        var gKeysZh = Object.keys(global);
        if (gKeysZh.length > 0) {
            var gPartsZh = [];
            for (var iz = 0; iz < gKeysZh.length; iz++) {
                gPartsZh.push(gKeysZh[iz] + '=' + global[gKeysZh[iz]]);
            }
            lines.push('全局动态状态：' + gPartsZh.join('、'));
        }

        var cNamesZh = Object.keys(characters);
        for (var jz = 0; jz < cNamesZh.length; jz++) {
            var cnz = cNamesZh[jz];
            var cfz = characters[cnz];
            var fKeysZh = Object.keys(cfz);
            if (fKeysZh.length === 0) continue;
            var cPartsZh = [];
            for (var kz = 0; kz < fKeysZh.length; kz++) {
                cPartsZh.push(fKeysZh[kz] + '=' + cfz[fKeysZh[kz]]);
            }
            lines.push('- dynamic.characters.' + cnz + '：' + cPartsZh.join('、'));
        }

        if (lines.length === 0) return '';

        return '\n=== 动态角色状态（从角色卡自动发现） ===\n' +
            lines.join('\n') + '\n\n' +
            '你可以通过 <state_changes> 更新任意动态字段，使用上述完整路径名，如：\n' +
            '<state_changes>{"dynamic.characters.张三.气血":"重伤"}</state_changes>\n';
    }
}

/**
 * 合并动态状态变更（浅合并，dot-path 支持）
 */
export function mergeDynamicState(dynamicState, changes) {
    if (!dynamicState || !changes) return dynamicState || {};
    var result = JSON.parse(JSON.stringify(dynamicState));

    var keys = Object.keys(changes);
    for (var i = 0; i < keys.length; i++) {
        var path = keys[i];
        var value = changes[path];
        var parts = path.split('.');
        var current = result;
        for (var j = 0; j < parts.length - 1; j++) {
            if (!current[parts[j]] || typeof current[parts[j]] !== 'object') {
                current[parts[j]] = {};
            }
            current = current[parts[j]];
        }
        current[parts[parts.length - 1]] = value;
    }

    return result;
}

/**
 * 格式化动态 state 为摘要文本（用于 Smart Push 注入）
 */
export function formatDynamicStateSummary(dynamicState) {
    if (!dynamicState) return '';
    return buildDynamicStatePrompt(dynamicState, 'zh');
}
