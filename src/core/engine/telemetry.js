/**
 * engine/telemetry.js — 遥测写入函数（v0.2 恢复）
 *
 * 存储到 localStorage，受 ne_telemetry_enabled 开关控制。
 */
import { recordChatStat } from './chat-telemetry.js';
import { neSync } from '../settings-adapter.js';

var STORAGE_ANOMALIES = 'ne_anomalies';
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
    try { neSync(STORAGE_ANOMALIES); } catch (e) {}
    if (chatId) recordChatStat(chatId, 'err', 1);
}

export function isTelemetryEnabled() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) return JSON.parse(raw).enableTelemetry || false;
    } catch (e) {}
    return false;
}
