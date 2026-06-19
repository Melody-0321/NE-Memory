/**
 * engine/telemetry.js — 遥测写入函数（v0.2 恢复）
 *
 * 存储到 localStorage，受 ne_telemetry_enabled 开关控制。
 */
import { recordChatStat } from './chat-telemetry.js';

var STORAGE_ANOMALIES = 'ne_anomalies';
var STORAGE_USER_SIGNALS = 'ne_user_signals';
var STORAGE_TOKEN_USAGE = 'ne_token_usage';
var MAX_ANOMALIES = 50;

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
