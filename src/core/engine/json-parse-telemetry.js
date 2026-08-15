/**
 * json-parse-telemetry.js — JSON 解析质量分级计数
 *
 * 记录 safeJsonParse 各级成功/失败次数，量化 5 级容错解析的实际兜底率。
 * 纯内存计数 + 节流落盘 localStorage（key: ne_json_parse_stats），
 * 受 enableTelemetry 开关控制（与 addAnomaly 语义一致）。不记录内容/上下文（隐私最小化）。
 */

import { readNeSettingsCached } from '../settings.js';

var STORAGE_KEY = 'ne_json_parse_stats';
var FLUSH_DELAY_MS = 500;

var _stats = { total: 0, direct: 0, code_block: 0, balanced: 0, trailing_comma: 0, truncated: 0, failed: 0 };
var _loaded = false;
var _dirty = false;
var _timer = null;

function _load() {
    if (_loaded) return;
    _loaded = true;
    try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            var parsed = JSON.parse(raw);
            var keys = ['total', 'direct', 'code_block', 'balanced', 'trailing_comma', 'truncated', 'failed'];
            for (var i = 0; i < keys.length; i++) {
                if (typeof parsed[keys[i]] !== 'number') parsed[keys[i]] = 0;
            }
            _stats = parsed;
        }
    } catch (e) {}
}

function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_stats)); } catch (e) {}
}

function _scheduleFlush() {
    _dirty = true;
    if (_timer !== null) return;
    _timer = setTimeout(function() {
        _timer = null;
        if (_dirty) { _dirty = false; _save(); }
    }, FLUSH_DELAY_MS);
}

/** 立即落盘（测试/退出边界用） */
export function flushJsonParseStats() {
    if (_timer !== null) { clearTimeout(_timer); _timer = null; }
    if (_dirty) { _dirty = false; _save(); }
}

/** 返回分级计数深拷贝（只读） */
export function getJsonParseStats() {
    _load();
    return JSON.parse(JSON.stringify(_stats));
}

/** 清空计数 + 立即落盘（测试用） */
export function resetJsonParseStats() {
    _loaded = true;
    _stats = { total: 0, direct: 0, code_block: 0, balanced: 0, trailing_comma: 0, truncated: 0, failed: 0 };
    _dirty = false;
    _save();
}

/**
 * 记录一次解析结果（按成功级别或失败）。受 enableTelemetry 开关控制，未启用静默 no-op。
 * @param {'direct'|'code_block'|'balanced'|'trailing_comma'|'truncated'|'failed'} level
 */
export function recordJsonParseResult(level) {
    try {
        if (!readNeSettingsCached().enableTelemetry) return;
    } catch (e) { return; }
    _load();
    if (!_stats.hasOwnProperty(level)) _stats[level] = 0;
    _stats[level]++;
    _stats.total++;
    _scheduleFlush();
}
