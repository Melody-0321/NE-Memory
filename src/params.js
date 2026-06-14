var TELEMETRY_KEY = 'ne_stm_telemetry';
var AUTO_KEY = 'ne_params_auto';
var MAX_TELEMETRY = 20;
var STM_BATCH_AUTO_NAME = 'stmBatch';
var STM_MAX_TOKENS_AUTO_NAME = 'stmMaxTokens';
var TOP_K_AUTO_NAME = 'topK';
var MIN_RESULTS_AUTO_NAME = 'minResults';
var LTM_DIR_COUNT_AUTO_NAME = 'ltmDirCount';
var CHAIN_DEPTH_AUTO_NAME = 'chainDepth';
var CHAIN_RECENT_WINDOW_AUTO_NAME = 'chainRecentWindow';

function readTelemetry() {
    try {
        var raw = localStorage.getItem(TELEMETRY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function writeTelemetry(data) {
    try { localStorage.setItem(TELEMETRY_KEY, JSON.stringify(data)); } catch (e) {}
}

export function recordTelemetry(entry) {
    var data = readTelemetry();
    data.push({ ts: Date.now(), turns: entry.turns, events: entry.events });
    if (data.length > MAX_TELEMETRY) data = data.slice(-MAX_TELEMETRY);
    writeTelemetry(data);
}

export function getTelemetryStats() {
    var data = readTelemetry();
    if (data.length < 1) return { turnsPerEvent: 3 };
    var totalTurns = 0, totalEvents = 0, count = 0;
    var recent = data.slice(-5);
    recent.forEach(function(e) { totalTurns += e.turns; totalEvents += e.events; count++; });
    var avg = count > 0 && totalEvents > 0 ? totalTurns / totalEvents : 3;
    return { turnsPerEvent: Math.max(1, Math.min(20, avg)) };
}

function readAutoMap() {
    try {
        var raw = localStorage.getItem(AUTO_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function writeAutoMap(map) {
    try { localStorage.setItem(AUTO_KEY, JSON.stringify(map)); } catch (e) {}
}

export function isAuto(paramName) {
    var map = readAutoMap();
    return map[paramName] !== false;
}

export function setAuto(paramName, auto) {
    var map = readAutoMap();
    map[paramName] = auto;
    writeAutoMap(map);
}

function logScale(value, minIn, maxIn, minOut, maxOut) {
    if (value <= minIn) return minOut;
    if (value >= maxIn) return maxOut;
    var ratio = Math.log(value / minIn) / Math.log(maxIn / minIn);
    return Math.round(minOut + (maxOut - minOut) * ratio);
}

export function computeStmBatch(turnsPerEvent, contextSize) {
    var maxByContext = contextSize ? Math.max(3, Math.floor(contextSize * 0.55 / 250)) : 25;
    return Math.max(5, Math.min(25, Math.round(4 * turnsPerEvent), maxByContext));
}

export function getSTContextSize() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            return ctx.contextSize || ctx.max_context || 4096;
        }
    } catch (e) {}
    return 4096;
}

export function computeStmMaxTokens(stmBatch) {
    return Math.max(400, Math.min(2500, Math.round(40 * stmBatch)));
}

export function computeTopK(totalSTM) {
    return logScale(totalSTM, 15, 200, 15, 80);
}

export function computeChainDepth(chainLength) {
    return logScale(chainLength, 10, 100, 10, 40);
}

export function computeChainRecentWindow(chainLength) {
    return logScale(chainLength, 10, 100, 10, 40);
}

export function computeLtmDirCount(totalLTM) {
    return logScale(totalLTM, 5, 50, 5, 35);
}

export function computeMinResults(totalSTM) {
    return Math.max(3, Math.min(10, Math.floor(totalSTM / 50) + 3));
}

export function computeChainHeadCount() {
    return 5;
}

export function computeAll(stats) {
    var ctxSize = getSTContextSize();
    return {
        stmBatch: computeStmBatch(stats.turnsPerEvent, ctxSize),
        stmMaxTokens: computeStmMaxTokens(computeStmBatch(stats.turnsPerEvent, ctxSize)),
        topK: computeTopK(stats.totalSTM || 0),
        chainDepth: computeChainDepth(stats.chainLength || 0),
        chainRecentWindow: computeChainRecentWindow(stats.chainLength || 0),
        chainHeadCount: computeChainHeadCount(),
        ltmDirCount: computeLtmDirCount(stats.totalLTM || 0),
        minResults: computeMinResults(stats.totalSTM || 0)
    };
}
