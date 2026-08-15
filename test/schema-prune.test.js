// Node.js localStorage polyfill — schema.js 依赖 store.js（loadFieldLibrary 读 ne_field_library）
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

import { ensureCharacterTemplate } from '../src/core/vault/schema.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }
function notOk(val, msg) { assert(!val, msg + ' (should be falsy, got ' + val + ')'); }

// 字段库登记一个自定义字段（模板裁剪不得误删）
localStorage.setItem('ne_field_library', JSON.stringify({
    fields: {
        custom_hobby: { type: 'string', max_length: 50, category: 'custom' }
    },
    updatedAt: new Date().toISOString()
}));

console.log('\n=== schema-prune: ensureCharacterTemplate 孤儿裁剪 ===');

// 1. PC 角色：孤儿字段被裁剪，模板字段/系统键/字段库字段保留
var state1 = {
    protagonist_name: 'Alice',
    characters: {
        Alice: {
            _scheme: '_default_pc',
            _templateLocked: true,
            name: 'Alice',
            gender_age: '25',
            personality: 'curious',
            stale_old_field: 'should be pruned',
            stale_renamed: 'old name key',
            custom_hobby: 'reading',
            affection: 80,
            power_level: 5
        }
    }
};
var mod1 = ensureCharacterTemplate(state1, 'Alice', null, null, {});
var alice1 = state1.characters.Alice;
ok(mod1 === true, 'prune marks modified=true');
notOk(alice1.hasOwnProperty('stale_old_field'), 'orphan preset field pruned');
notOk(alice1.hasOwnProperty('stale_renamed'), 'renamed-away field pruned');
ok(alice1.hasOwnProperty('gender_age'), 'template field preserved');
ok(alice1.hasOwnProperty('personality'), 'template field preserved');
ok(alice1.hasOwnProperty('name'), 'name preserved');
ok(alice1.hasOwnProperty('status'), 'status (system required) preserved');
ok(alice1.hasOwnProperty('_scheme'), '_scheme preserved');
ok(alice1.hasOwnProperty('_templateLocked'), '_templateLocked preserved');
ok(alice1.hasOwnProperty('custom_hobby'), 'library-registered custom field preserved');
ok(alice1.hasOwnProperty('affection'), 'predefined field (not in current template) preserved — LLM __inc depends on it');
ok(alice1.hasOwnProperty('power_level'), 'predefined field (not in current template) preserved');

// 2. 无孤儿且字段齐全时：不裁剪、不改动（modified=false）
var state2 = {
    protagonist_name: 'Bob',
    characters: {
        Bob: {
            _scheme: '_default_pc',
            name: 'Bob',
            status: '活跃',
            gender_age: '30',
            physique: '',
            occupation: '',
            personality: '',
            clothing_build: '',
            current_outfit: '',
            injuries: '',
            status_effects: '',
            past_experience: '',
            inventory: {},
            abilities: {},
            power_level: ''
        }
    }
};
var mod2 = ensureCharacterTemplate(state2, 'Bob', null, null, {});
notOk(mod2, 'no orphans, no backfill -> modified=false');
assert(Object.keys(state2.characters.Bob).length === 15, 'no keys added/removed when fields complete');

// 3. 空角色（新建路径）：完整模板字段 + name，无孤儿裁剪干扰
var state3 = { protagonist_name: 'Carol', characters: {} };
ensureCharacterTemplate(state3, 'Carol', null, null, {});
var carol = state3.characters.Carol;
ok(carol.hasOwnProperty('gender_age'), 'new character has template fields');
ok(carol.hasOwnProperty('name'), 'new character has name');
ok(carol.hasOwnProperty('_scheme'), 'new character has _scheme');

// 4. NPC：走自定义模板解析路径（schemeKey 显式指定），孤儿裁剪同样生效
var state4 = {
    protagonist_name: 'Diana',
    characters: {
        NPC1: {
            _scheme: '_default_npc',
            name: 'NPC1',
            gender_age: '40',
            stale_npc_field: 'old'
        }
    }
};
var mod4 = ensureCharacterTemplate(state4, 'NPC1', '_default_npc', null, {});
notOk(state4.characters.NPC1.hasOwnProperty('stale_npc_field'), 'NPC orphan field pruned');
ok(state4.characters.NPC1.hasOwnProperty('gender_age'), 'NPC template field preserved');
ok(state4.characters.NPC1.hasOwnProperty('_scheme'), 'NPC _scheme preserved');

console.log('\n=== schema-prune: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);