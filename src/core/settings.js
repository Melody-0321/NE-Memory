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

// === P7: ne_settings 缓存解析（热路径 LLM/embedding/telemetry 复用，写路径需调用 invalidateNeSettingsCache）===
var _neSettingsCache = null;

/**
 * 缓存版设置读取：首次调用解析一次，之后复用；返回浅拷贝防调用方误改缓存。
 * 设置被改写后必须调用 invalidateNeSettingsCache() 使缓存失效。
 */
export function readNeSettingsCached() {
    if (_neSettingsCache === null) _neSettingsCache = readNeSettingsObject();
    return Object.assign({}, _neSettingsCache);
}

/** 设置写路径失效钩子：任何 ne_settings 落盘后调用 */
export function invalidateNeSettingsCache() {
    _neSettingsCache = null;
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
