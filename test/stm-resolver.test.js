/**
 * stm-resolver.test.js — 生产 resolver（D 方案，stm-resolver.js）单元测试
 *
 * 覆盖（fix-plan §4.5 要求，4 分支 + 开关 + 分批）：
 * 1. 反转重写：reversed=true + evidence → event 文本重写为最终态
 * 2. 未反转原样：reversed=false → event 不变
 * 3. 降级兜底：LLM 调用失败 → events 原样返回（不重写、不丢失）
 * 4. 证据缺失视为未反转：reversed=true 但无 evidence → event 不变（防幻觉）
 * 5. 开关关闭：stmResolveReversal=false → 原样返回（零调用）
 * 6. 分批：>2 事件 → 按 K=2 分多批调用
 */
import { resolveChunkEvents, isResolverEnabled } from '../src/core/engine/stm-resolver.js';
import { invalidateNeSettingsCache } from '../src/core/settings.js';

// ---- mock 环境 ----
globalThis.localStorage = {
    _data: {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
    setItem: function (k, v) { this._data[k] = String(v); },
    removeItem: function (k) { delete this._data[k]; },
};

function setSetting(key, val) {
    var s = {};
    try { s = JSON.parse(localStorage.getItem('ne_settings') || '{}'); } catch (e) {}
    if (val === undefined) delete s[key]; else s[key] = val;
    localStorage.setItem('ne_settings', JSON.stringify(s));
    invalidateNeSettingsCache(); // 让 readNeSettingsCached 重新读取
}

// ---- 测试辅助 ----
var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + JSON.stringify(val) + ')'); }

function makeEvents(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
        out.push({ event: '事件' + i + '：最初主张', msgRange: [i, i], msg_ids: ['m' + i] });
    }
    return out;
}

// 可编程 LLM mock：队列响应（字符串 = content），支持 Error 抛错；捕获调用参数
function makeMock(responder) {
    var calls = [];
    var fn = async function (messages, options) {
        calls.push({ messages: messages, options: options });
        var r = await responder(calls.length - 1, messages, options);
        return r; // 返回 { content } 或 throw
    };
    fn.calls = calls;
    return fn;
}

// ============ 用例 ============

async function testReversalRewrite() {
    var llm = makeMock(function () {
        return { content: '[{"idx":0,"reversed":true,"evidence":"完蛋，我又没忍住","rewritten":"先发誓不熬夜，最终又熬到深夜","reason":"反悔"}]' };
    });
    var events = makeEvents(1);
    var res = await resolveChunkEvents('角色：今天起再也不熬夜！', events, { llmCall: llm });
    eq(res.events.length, 1, '反转重写：事件数不变');
    eq(res.events[0].event, '先发誓不熬夜，最终又熬到深夜', '反转重写：event 被重写');
    eq(res.rewritten, 1, '反转重写：rewritten 计数=1');
    eq(res.failures, 0, '反转重写：无失败');
    eq(llm.calls.length, 1, '反转重写：调用 1 次');
    ok(res.events[0]._resolverIdx === undefined, '反转重写：临时字段已清理');
    console.log('  ✓ 反转重写');
}

async function testNoReversal() {
    var llm = makeMock(function () {
        return { content: '[{"idx":0,"reversed":false,"evidence":"","rewritten":"事件0：最初主张","reason":"未反转"}]' };
    });
    var events = makeEvents(1);
    var res = await resolveChunkEvents('角色：随便聊聊。', events, { llmCall: llm });
    eq(res.events[0].event, '事件0：最初主张', '未反转：event 保持不变');
    eq(res.rewritten, 0, '未反转：rewritten 计数=0');
    console.log('  ✓ 未反转原样');
}

async function testDegradeOnFailure() {
    var llm = makeMock(function () { throw new Error('API down'); });
    var events = makeEvents(2);
    var res = await resolveChunkEvents('角色：对话', events, { llmCall: llm });
    eq(res.events.length, 2, '降级：事件数不变（不丢失）');
    eq(res.events[0].event, '事件0：最初主张', '降级：event 原样');
    eq(res.events[1].event, '事件1：最初主张', '降级：event 原样');
    eq(res.failures, 1, '降级：failures 计数=1');
    eq(res.rewritten, 0, '降级：rewritten=0');
    console.log('  ✓ 降级兜底');
}

async function testEvidenceRequired() {
    // reversed=true 但 evidence 为空 → 视为未反转（防幻觉）
    var llm = makeMock(function () {
        return { content: '[{"idx":0,"reversed":true,"evidence":"","rewritten":"凭空捏造的反转","reason":"无证据"}]' };
    });
    var events = makeEvents(1);
    var res = await resolveChunkEvents('角色：说点什么', events, { llmCall: llm });
    eq(res.events[0].event, '事件0：最初主张', '证据缺失：event 不变（视为未反转）');
    eq(res.rewritten, 0, '证据缺失：rewritten=0');
    console.log('  ✓ 证据缺失视为未反转');
}

async function testDisabled() {
    setSetting('stmResolveReversal', false);
    eq(isResolverEnabled(), false, '开关关闭：isResolverEnabled=false');
    var llm = makeMock(function () { return { content: 'should not be called' }; });
    var events = makeEvents(1);
    var res = await resolveChunkEvents('角色：对话', events, { llmCall: llm });
    eq(llm.calls.length, 0, '开关关闭：零 LLM 调用');
    eq(res.events[0].event, '事件0：最初主张', '开关关闭：event 原样');
    setSetting('stmResolveReversal', undefined);
    console.log('  ✓ 开关关闭');
}

async function testBatching() {
    // 5 个事件 → 3 批（2+2+1）
    var llm = makeMock(function (idx) {
        // 每批返回对应条数
        var arr = [];
        var start = idx * 2;
        var cnt = Math.min(2, 5 - start);
        for (var i = 0; i < cnt; i++) {
            arr.push({ idx: start + i, reversed: false, evidence: '', rewritten: '', reason: 'ok' });
        }
        return { content: JSON.stringify(arr) };
    });
    var events = makeEvents(5);
    var res = await resolveChunkEvents('角色：长对话……', events, { llmCall: llm });
    eq(llm.calls.length, 3, '分批：5 事件 → 3 批调用');
    eq(res.events.length, 5, '分批：事件数不变');
    eq(res.failures, 0, '分批：无失败');
    console.log('  ✓ 分批 K=2');
}

// ---- 运行 ----
async function run() {
    console.log('=== stm-resolver.test.js ===');
    await testReversalRewrite();
    await testNoReversal();
    await testDegradeOnFailure();
    await testEvidenceRequired();
    await testDisabled();
    await testBatching();
    console.log('=== stm-resolver: ' + passed + ' passed, ' + failed + ' failed ===');
    if (failed > 0) process.exit(1);
}
run().catch(function (e) { console.error('FATAL:', e); process.exit(1); });
