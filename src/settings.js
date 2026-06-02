/**
 * settings.js — 运行时标志位，从 index.js 提取打破循环依赖
 */
var _retrievalEnabled = false;

export function isRetrievalEnabled() {
    return _retrievalEnabled;
}

export function setRetrievalEnabled(val) {
    if (val) {
        try {
            var raw = localStorage.getItem('ne_settings');
            if (raw) {
                var s = JSON.parse(raw);
                if (!s.memoryEnabled) {
                    console.warn('[NE] Cannot enable Smart Retrieval: Memory System is not enabled');
                    return;
                }
            }
        } catch (e) {}
    }
    _retrievalEnabled = !!val;
}
