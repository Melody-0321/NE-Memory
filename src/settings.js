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

export function getStmMinLtmMerge() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            return Math.max(3, Number(s.stmMinLtmMerge) || 3);
        }
    } catch (e) {}
    return 3;
}
