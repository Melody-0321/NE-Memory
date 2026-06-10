/**
 * engine/telemetry.js — 遥测写入函数（v0.2 恢复）
 *
 * 存储到 localStorage，受 ne_telemetry_enabled 开关控制。
 * addLLMLog 不受开关控制（始终记录，用于调试）。
 */
import { recordChatStat } from './chat-telemetry.js';

var STORAGE_LLM_LOG = 'ne_llm_log';
var STORAGE_TOOL_CALLS = 'ne_tool_calls';
var STORAGE_ANOMALIES = 'ne_anomalies';
var STORAGE_USER_SIGNALS = 'ne_user_signals';
var STORAGE_TOKEN_USAGE = 'ne_token_usage';
var MAX_LLM_LOG = 10;
var MAX_TOOL_CALLS = 50;
var MAX_ANOMALIES = 50;

export function addLLMLog(type, requestSummary, responseSummary, durationMs, apiSource, chatId) {
    var logs = [];
    try { logs = JSON.parse(localStorage.getItem(STORAGE_LLM_LOG) || '[]'); } catch (e) {}
    var entry = { type: type, time: new Date().toISOString(), request: requestSummary || '', response: responseSummary || '', duration_ms: durationMs || 0, api_source: apiSource || 'narrative' };
    if (chatId) entry.chat_id = chatId;
    logs.unshift(entry);
    if (logs.length > MAX_LLM_LOG) logs.pop();
    localStorage.setItem(STORAGE_LLM_LOG, JSON.stringify(logs));
}

export function addToolCall(toolName, params, success, durationMs, resultSummary, errorInfo, chatId) {
    if (!isTelemetryEnabled()) return;
    var calls = [];
    try { calls = JSON.parse(localStorage.getItem(STORAGE_TOOL_CALLS) || '[]'); } catch (e) {}
    var callEntry = { ts: new Date().toISOString(), tool: toolName, params: params || {}, success: !!success, duration_ms: durationMs || 0, result_summary: (resultSummary || '').substring(0, 200), error_info: errorInfo || '' };
    if (chatId) callEntry.chat_id = chatId;
    calls.push(callEntry);
    if (calls.length > MAX_TOOL_CALLS) calls.shift();
    localStorage.setItem(STORAGE_TOOL_CALLS, JSON.stringify(calls));
    if (durationMs > 5000) addAnomaly('tool_timeout', { tool: toolName, duration_ms: durationMs }, chatId);
    if (!success) {
        var signals = getUserSignals();
        signals.consecutive_fails = (signals.consecutive_fails || 0) + 1;
        if (signals.consecutive_fails >= 3) addAnomaly('rapid_fail_chain', { tool: toolName, fail_count: signals.consecutive_fails }, chatId);
        saveUserSignals(signals);
    } else {
        var s2 = getUserSignals();
        s2.consecutive_fails = 0;
        saveUserSignals(s2);
    }
}

export function addAnomaly(type, context, chatId) {
    if (!isTelemetryEnabled()) return;
    var anomalies = [];
    try { anomalies = JSON.parse(localStorage.getItem(STORAGE_ANOMALIES) || '[]'); } catch (e) {}
    var anomEntry = { ts: new Date().toISOString(), type: type, context: context || {} };
    if (chatId) anomEntry.chat_id = chatId;
    anomalies.push(anomEntry);
    if (anomalies.length > MAX_ANOMALIES) anomalies.shift();
    localStorage.setItem(STORAGE_ANOMALIES, JSON.stringify(anomalies));
    if (chatId) recordChatStat(chatId, 'err', 1);
}

export function incSignal(key) {
    if (!isTelemetryEnabled()) return;
    var signals = getUserSignals();
    signals[key] = (signals[key] || 0) + 1;
    saveUserSignals(signals);
}

export function recordTokenUsage(operation, tokens) {
    if (!isTelemetryEnabled()) return;
    if (!tokens) return;
    var usage = {};
    try { usage = JSON.parse(localStorage.getItem(STORAGE_TOKEN_USAGE) || '{}'); } catch (e) {}
    usage[operation] = (usage[operation] || 0) + tokens;
    usage._total = (usage._total || 0) + tokens;
    localStorage.setItem(STORAGE_TOKEN_USAGE, JSON.stringify(usage));
}

export function isTelemetryEnabled() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) return JSON.parse(raw).enableTelemetry || false;
    } catch (e) {}
    return false;
}

function getUserSignals() {
    try { return JSON.parse(localStorage.getItem(STORAGE_USER_SIGNALS) || '{"export_count":0,"panel_open_count":0,"manual_refresh_count":0,"rollback_count":0,"edit_save_count":0,"consecutive_fails":0}'); } catch (e) { return { export_count: 0, panel_open_count: 0, manual_refresh_count: 0, rollback_count: 0, edit_save_count: 0, consecutive_fails: 0 }; }
}

function saveUserSignals(signals) {
    localStorage.setItem(STORAGE_USER_SIGNALS, JSON.stringify(signals));
}
