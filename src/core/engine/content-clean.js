/**
 * engine/content-clean.js — 内容清洗核心（剔除消息中的非剧情格式块）
 *
 * 保守默认集：<think>/<thinking> 块 + HTML 注释 + 用户自定义标签。
 * 读取时清洗（不改 vault 原文），作用于"消息 → LLM prompt"的格式化路径。
 *
 * 参考：ST-BaiBai-Book src/memory/timeTag.ts（stripThinkBlocks / stripCustomTags）
 */

// 思维链块正则（配对块，含内部内容）
var RE_THINK_BLOCK = /<(?:think|thinking)\b[\s\S]*?<\/(?:think|thinking)>/gi;

// HTML 注释
var RE_HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * 归一化用户自定义标签名：剥掉误填的 < > / 与空白。
 * 例：'<note>' → 'note'、' think ' → 'think'、'note>' → 'note'
 * @param {*} rawTag
 * @returns {string}
 */
export function normalizeStripTag(rawTag) {
    return String(rawTag == null ? '' : rawTag).replace(/[<>/]/g, '').trim();
}

/** 转义正则特殊字符，防止用户输入污染标签正则（如 'note(' 抛 SyntaxError / 'a.b' 误匹配） */
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTagPairRegex(tag) {
    return new RegExp('<' + escapeRegExp(tag) + '(?=[\\s/>])[^>]*>[\\s\\S]*?</' + escapeRegExp(tag) + '>', 'gi');
}

function buildTagLoneRegex(tag) {
    return new RegExp('<\\/?' + escapeRegExp(tag) + '(?=[\\s/>])[^>]*\\/?>', 'gi');
}

/**
 * 清洗单条消息文本，剔除非剧情格式块。
 * @param {string} text - 原始消息文本
 * @param {string[]} [customStripTags] - 用户自定义整块删除的标签名（无尖括号，内部自动容错）
 * @returns {string} 清洗后的文本
 */
export function cleanMessageText(text, customStripTags) {
    if (!text || typeof text !== 'string') return text;
    // 类型兜底：customStripTags 必须是数组（防 localStorage 被手写成字符串时按字符迭代误删）
    var tags = Array.isArray(customStripTags) ? customStripTags : [];

    var out = text;
    out = out.replace(RE_THINK_BLOCK, '');
    out = out.replace(RE_HTML_COMMENT, '');

    if (tags.length) {
        for (var i = 0; i < tags.length; i++) {
            var tag = normalizeStripTag(tags[i]);
            if (!tag) continue;
            out = out.replace(buildTagPairRegex(tag), '');
            out = out.replace(buildTagLoneRegex(tag), '');
        }
    }

    return out;
}
