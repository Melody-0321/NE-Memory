/**
 * settings.js — 运行时标志位，从 index.js 提取打破循环依赖
 */
var _retrievalEnabled = false;

export function isRetrievalEnabled() {
    return _retrievalEnabled;
}

export function setRetrievalEnabled(val) {
    _retrievalEnabled = !!val;
}
