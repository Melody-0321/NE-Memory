/**
 * settings.js - 运行时标志位，从 index.js 提取打破循环依赖
 */
var _retrievalEnabled = false;

export function isRetrievalEnabled() {
    return _retrievalEnabled;
}

export function setRetrievalEnabled(val) {
    _retrievalEnabled = !!val;
}

/**
 * 读取 ne_settings 的完整对象。解析失败或不存在时返回空对象。
 * @returns {Object}
 */
export function readNeSettingsObject() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) return JSON.parse(raw) || {};
    } catch (e) {}
    return {};
}

/**
 * 读取 ne_settings 中的单个键值。
 * @param {string} key - 设置键名
 * @param {*} defaultValue - 键缺失或解析失败时的默认值
 * @returns {*}
 */
export function readNeSetting(key, defaultValue) {
    var s = readNeSettingsObject();
    var v = s[key];
    return v === undefined ? defaultValue : v;
}

export function getStmMinLtmMerge() {
    return Math.max(3, Number(readNeSetting('stmMinLtmMerge', 3)) || 3);
}
