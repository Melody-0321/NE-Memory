// template-assistant-retry.test.js — runTemplateAssistant 修复重试循环（LLM mock 注入）：
//   R1. 首轮解析失败 → repairErrors 回喂 → 二轮合法 → ok:true, attempts:2
//   R2. maxRepairRetries:0 + 坏输出 → retry_exhausted, attempts:1
//   R3. 默认 2 次修复全失败（3 次尝试）→ retry_exhausted, attempts:3, errors 非空
//   R4. LLM 抛异常 → llm_error, attempts:1（不消耗修复轮次）
//   R5. 校验类错误（指纹不匹配）同样进修复循环 → 二轮修正后成功
//
// 注入点：runtime.generateQuiet（callMemoryLLM 无副 API/主 API 配置时的
// callTavernHelper 首选路径；runtime 为可变导出对象）。

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
// rollup 构建时 define 注入的全局（llm.js 裸引用），源码直跑需补桩
if (typeof globalThis.__NE_DEV_MODE === 'undefined') globalThis.__NE_DEV_MODE = false;

import { runTemplateAssistant } from '../src/core/engine/template-assistant.js';
import { runtime } from '../src/core/runtime.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + val + ')'); }

// ====== LLM mock：按调用次序出队的可编程响应 + prompt 捕获 ======
var _responseQueue = [];
var _capturedPrompts = []; // { user, system }
var _origGenerateQuiet = runtime.generateQuiet;
runtime.generateQuiet = function (userContent, systemContent) {
    _capturedPrompts.push({ user: userContent, system: systemContent });
    var next = _responseQueue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next === undefined ? '' : next);
};

function resetMock(responses) {
    _responseQueue = responses.slice();
    _capturedPrompts = [];
    localStorage.removeItem('ne_field_library');
}

function makeValidDraft(overrides) {
    var d = {
        protocolVersion: 1,
        baseFingerprint: 'fp1_test',
        understanding: '修仙世界宗门长老模板，含境界与灵石字段。',
        template: {
            name: '宗门长老',
            role: 'npc',
            description: '修仙宗门长老',
            tags: ['修仙'],
            presetFields: ['gender_age'],
            perRoundFields: ['current_mood'],
            customFields: [
                { name: '修为境界', type: 'enum', values: ['炼气', '筑基', '金丹'] },
                { name: '灵石数量', type: 'number', min: 0, max: 999999 }
            ]
        }
    };
    if (overrides) {
        Object.keys(overrides).forEach(function (k) {
            if (k === 'template') {
                Object.keys(overrides.template).forEach(function (tk) { d.template[tk] = overrides.template[tk]; });
            } else {
                d[k] = overrides[k];
            }
        });
    }
    return d;
}

function baseCtx(extra) {
    return Object.assign({
        mode: 'create',
        fingerprint: 'fp1_test',
        baselineTemplate: null,
        baselineLabel: '空白',
        userRequest: '修仙世界宗门长老模板',
        chatId: null
    }, extra || {});
}

// ====== R1: 解析失败 → 修复成功 ======
console.log('\n=== template-assistant-retry R1: parse failure repaired on 2nd round ===');
{
    resetMock([
        '这不是JSON{{{',
        JSON.stringify(makeValidDraft())
    ]);
    var r1 = await runTemplateAssistant(baseCtx());
    eq(r1.ok, true, 'R1: succeeds after repair');
    eq(r1.attempts, 2, 'R1: attempts === 2');
    ok(r1.plan, 'R1: plan built');
    eq(r1.draft.template.name, '宗门长老', 'R1: draft parsed');
    eq(_capturedPrompts.length, 2, 'R1: exactly 2 LLM calls');
    ok(_capturedPrompts[1].user.indexOf('上一轮输出的问题') >= 0, 'R1: repair errors fed back into 2nd prompt');
}

// ====== R2: maxRepairRetries 0 → 一次失败即耗尽 ======
console.log('\n=== template-assistant-retry R2: zero repair budget ===');
{
    resetMock(['坏输出']);
    var r2 = await runTemplateAssistant(baseCtx({ maxRepairRetries: 0 }));
    eq(r2.ok, false, 'R2: fails');
    eq(r2.failureKind, 'retry_exhausted', 'R2: failureKind retry_exhausted');
    eq(r2.attempts, 1, 'R2: attempts === 1');
    ok(r2.errors && r2.errors.length > 0, 'R2: carries last errors');
}

// ====== R3: 默认预算（1+2）全失败 ======
console.log('\n=== template-assistant-retry R3: default budget exhausted ===');
{
    resetMock(['坏1', '坏2', '坏3', '不应被调用']);
    var r3 = await runTemplateAssistant(baseCtx());
    eq(r3.ok, false, 'R3: fails');
    eq(r3.failureKind, 'retry_exhausted', 'R3: failureKind retry_exhausted');
    eq(r3.attempts, 3, 'R3: attempts === 3 (1 initial + 2 repairs)');
    eq(_capturedPrompts.length, 3, 'R3: no 4th LLM call');
    ok(r3.errors && r3.errors.length > 0, 'R3: carries errors from last round');
    // 每轮 prompt 都携带上一轮错误
    ok(_capturedPrompts[1].user.indexOf('上一轮输出的问题') >= 0, 'R3: round 2 carries round 1 errors');
    ok(_capturedPrompts[2].user.indexOf('上一轮输出的问题') >= 0, 'R3: round 3 carries round 2 errors');
}

// ====== R4: LLM 异常 → llm_error，不进修复循环 ======
console.log('\n=== template-assistant-retry R4: LLM error short-circuits ===');
{
    resetMock([new Error('backend down')]);
    var r4 = await runTemplateAssistant(baseCtx());
    eq(r4.ok, false, 'R4: fails');
    eq(r4.failureKind, 'llm_error', 'R4: failureKind llm_error');
    eq(r4.attempts, 1, 'R4: attempts === 1');
    eq(_capturedPrompts.length, 1, 'R4: single LLM call');
}

// ====== R5: 校验类错误（指纹不匹配）同样走修复 ======
console.log('\n=== template-assistant-retry R5: validation error (fingerprint) repaired ===');
{
    resetMock([
        JSON.stringify(makeValidDraft({ baseFingerprint: 'fp1_other' })), // 指纹回显错误 → 校验拒绝
        JSON.stringify(makeValidDraft()) // 二轮正确回显
    ]);
    var r5 = await runTemplateAssistant(baseCtx());
    eq(r5.ok, true, 'R5: succeeds after fingerprint repair');
    eq(r5.attempts, 2, 'R5: attempts === 2');
    ok(_capturedPrompts[1].user.indexOf('fingerprint') >= 0 || _capturedPrompts[1].user.indexOf('指纹') >= 0,
        'R5: fingerprint error text fed back');
}

// 恢复 runtime
runtime.generateQuiet = _origGenerateQuiet;

console.log('\n=== template-assistant-retry: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
