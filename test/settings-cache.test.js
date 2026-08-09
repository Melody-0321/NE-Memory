// Node.js localStorage polyfill (not available in Node)
if (typeof localStorage === 'undefined') {
    var _store = {};
    globalThis.localStorage = {
        getItem: function(k) { return _store.hasOwnProperty(k) ? _store[k] : null; },
        setItem: function(k, v) { _store[k] = String(v); },
        removeItem: function(k) { delete _store[k]; },
        clear: function() { _store = {}; },
        get length() { return Object.keys(_store).length; },
        key: function(i) { return Object.keys(_store)[i] || null; }
    };
}

import { readNeSettingsCached, invalidateNeSettingsCache } from '../src/core/settings.js';
import { setDynamicStateMode } from '../src/core/vault/schema.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

// ====== P7: ne_settings 缓存解析 + 失效钩子 ======
console.log('\n=== settings-cache: readNeSettingsCached / invalidateNeSettingsCache (P7) ===');

// 场景 1: 无设置时返回空对象（不抛异常）
(function() {
    localStorage.clear();
    invalidateNeSettingsCache();
    eq(readNeSettingsCached(), {}, '场景1: 无设置返回空对象');
})();

// 场景 2: 返回解析后的设置对象
(function() {
    localStorage.clear();
    localStorage.setItem('ne_settings', JSON.stringify({ enableTelemetry: true, apiTimeoutMs: 60000, memoryConfig: { model: 'gpt-4o' } }));
    invalidateNeSettingsCache();
    var s = readNeSettingsCached();
    eq(s.enableTelemetry, true, '场景2: enableTelemetry 解析正确');
    eq(s.apiTimeoutMs, 60000, '场景2: apiTimeoutMs 解析正确');
    eq(s.memoryConfig.model, 'gpt-4o', '场景2: 嵌套 memoryConfig 解析正确');
})();

// 场景 3: 缓存生效 — 外部直写 localStorage 后，未失效前读到旧值（跨 tab 陈旧为已接受行为）
(function() {
    localStorage.clear();
    localStorage.setItem('ne_settings', JSON.stringify({ useDynamicState: false }));
    invalidateNeSettingsCache();
    readNeSettingsCached();
    // 模拟其他写入者直接改 localStorage
    localStorage.setItem('ne_settings', JSON.stringify({ useDynamicState: true }));
    eq(readNeSettingsCached().useDynamicState, false, '场景3: 缓存命中旧值（未失效）');
    // 失效后重读 → 新值
    invalidateNeSettingsCache();
    eq(readNeSettingsCached().useDynamicState, true, '场景3: 失效后读到新值');
})();

// 场景 4: 浅拷贝 — 调用方修改返回对象不污染缓存
(function() {
    localStorage.clear();
    localStorage.setItem('ne_settings', JSON.stringify({ enableTelemetry: false }));
    invalidateNeSettingsCache();
    var s1 = readNeSettingsCached();
    s1.enableTelemetry = true; // 调用方误改
    var s2 = readNeSettingsCached();
    eq(s2.enableTelemetry, false, '场景4: 返回浅拷贝，误改不影响后续读取');
})();

// 场景 5: 非法 JSON — 优雅降级为空对象
(function() {
    localStorage.clear();
    localStorage.setItem('ne_settings', '{broken json');
    invalidateNeSettingsCache();
    eq(readNeSettingsCached(), {}, '场景5: 非法 JSON 返回空对象');
})();

// 场景 6: setDynamicStateMode 写路径自动失效 — 写入后缓存立即读到新值
(function() {
    localStorage.clear();
    localStorage.setItem('ne_settings', JSON.stringify({ useDynamicState: false }));
    invalidateNeSettingsCache();
    eq(readNeSettingsCached().useDynamicState, false, '场景6: 初始 useDynamicState=false');
    setDynamicStateMode(true);
    var s = readNeSettingsCached();
    eq(s.useDynamicState, true, '场景6: setDynamicStateMode 写后缓存自动失效并读到 true');
    setDynamicStateMode(false);
    eq(readNeSettingsCached().useDynamicState, false, '场景6: 切回 false 亦生效');
})();

console.log('\n=== settings-cache: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
