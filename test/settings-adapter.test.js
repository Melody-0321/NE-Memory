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

import { neSync, neLoadAll } from '../src/core/settings-adapter.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

// ====== 准备 SillyTavern mock：extensionSettings.ne_memory + saveSettingsDebounced（提交式） ======
var _extNe = null;
var _saveCount = 0;
function resetExt() {
    _extNe = {};
    _saveCount = 0;
    globalThis.SillyTavern = {
        getContext: function() {
            return {
                extensionSettings: { ne_memory: _extNe },
                saveSettingsDebounced: function() { _saveCount++; }
            };
        }
    };
}
resetExt();

console.log('\n=== settings-adapter: 提交式 neSync + neLoadAll + secret 不转发 ===');

// 场景 1: config-key（ne_settings）转发进 extNe 且提交式落地（saveFn 被调）
(function() {
    localStorage.clear(); resetExt();
    localStorage.setItem('ne_settings', JSON.stringify({ enableTelemetry: true }));
    neSync('ne_settings');
    eq(_extNe.ne_settings, JSON.stringify({ enableTelemetry: true }), '场景1: ne_settings 写入 extNe');
    eq(_saveCount, 1, '场景1: 提交式调用了 saveSettingsDebounced');
})();

// 场景 2: 前缀 config-key（ne_card_templates_*）同样转发并提交
(function() {
    localStorage.clear(); resetExt();
    localStorage.setItem('ne_card_templates_testchar', '{"tpl":"x"}');
    neSync('ne_card_templates_testchar');
    eq(_extNe['ne_card_templates_testchar'], '{"tpl":"x"}', '场景2: ne_card_templates_* 写入 extNe');
    eq(_saveCount, 1, '场景2: 前缀 config-key 也提交式落地');
})();

// 场景 3: secret-key（ne_embedding_api，含 API 密钥）绝不进 extNe、绝不提交服务器
(function() {
    localStorage.clear(); resetExt();
    localStorage.setItem('ne_embedding_api', 'sk-very-secret-value');
    neSync('ne_embedding_api');
    assert(_extNe.ne_embedding_api === undefined, '场景3: secret-key 不进 extNe');
    eq(_saveCount, 0, '场景3: secret-key 不触发服务端提交');
})();

// 场景 4: 遍历全部 secret-key 均不转发（隐私回归守卫：secondary/stm/ltm/state）
(function() {
    localStorage.clear(); resetExt();
    var secrets = ['ne_secondary_api', 'ne_embedding_api', 'ne_stm_api', 'ne_ltm_api', 'ne_state_api'];
    for (var i = 0; i < secrets.length; i++) localStorage.setItem(secrets[i], 'secret-' + i);
    for (var j = 0; j < secrets.length; j++) neSync(secrets[j]);
    eq(_saveCount, 0, '场景4: 全部 secret-key 均不触发服务端提交');
    for (var k = 0; k < secrets.length; k++) {
        assert(_extNe[secrets[k]] === undefined, '场景4: secret-key ' + secrets[k] + ' 不进 extNe');
    }
})();

// 场景 5: 未知/非法 key 不转发
(function() {
    localStorage.clear(); resetExt();
    localStorage.setItem('ne_something_unknown', 'v');
    neSync('ne_something_unknown');
    eq(_saveCount, 0, '场景5: 未知 key 不转发不提交');
    assert(_extNe.ne_something_unknown === undefined, '场景5: 未知 key 不进 extNe');
})();

// 场景 6: neLoadAll 从服务器权威优先覆盖回灌 localStorage（仅 config-key）
(function() {
    localStorage.clear(); resetExt();
    // 服务器已有 config 值（权威）
    _extNe.ne_settings = '{"fromServer":1}';
    _extNe.ne_card_templates_hero = '{"tpl":"server"}';
    // 服务器不应含 secret（历史残留也回灌时被守卫拦截，不回灌）
    _extNe.ne_embedding_api = 'rememberme';
    // 本地有旧的冲突值
    localStorage.setItem('ne_settings', '{"fromLocal":0}');
    neLoadAll();
    eq(localStorage.getItem('ne_settings'), '{"fromServer":1}', '场景6: neLoadAll 覆盖本地为服务器权威值');
    eq(localStorage.getItem('ne_card_templates_hero'), '{"tpl":"server"}', '场景6: neLoadAll 回灌前缀 config-key');
    eq(localStorage.getItem('ne_embedding_api'), null, '场景6: neLoadAll 不回灌 secret-key（本地私有保持独立）');
    eq(_saveCount, 0, '场景6: neLoadAll 是回灌，不回写服务器');
})();

// 场景 7: neLoadAll 本地已存在值时也强行覆盖（优先覆盖，非仅空才填）
(function() {
    localStorage.clear(); resetExt();
    _extNe.ne_template_library = '["libA"]';
    localStorage.setItem('ne_template_library', '["libOld"]');
    neLoadAll();
    eq(localStorage.getItem('ne_template_library'), '["libA"]', '场景7: neLoadAll 覆盖已存在的本地值（非仅空才填）');
})();

console.log('\n=== settings-adapter: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);