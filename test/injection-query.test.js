/**
 * injection-query.test.js — P0 query 加权融合测试
 *
 * 覆盖：
 * - buildWeightedQueryLegs：用户输入主信号提取（不截断）、末条 assistant 辅助信号（≤400字）、
 *   queryAiWeight=low 时 ctx 截 200、短消息（≤5字）跳过、ST 格式（is_user+mes）与 role/content 格式兼容
 * - fuseWeightedRuns：双路分数加权合并（0.78u + 0.22x）、缺腿记 0、降序排序、null 容错
 */
import { buildWeightedQueryLegs, fuseWeightedRuns } from '../src/core/engine/injection.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

console.log('\n=== injection-query: buildWeightedQueryLegs ===');

// 空输入
var emptyLegs = buildWeightedQueryLegs([], {});
eq(emptyLegs.userLeg, '', 'empty chat => empty userLeg');
eq(emptyLegs.ctxLeg, '', 'empty chat => empty ctxLeg');

// ST 格式：末条 user + 末条 assistant
var stChat = [
    { mes: '更早的assistant消息内容', is_user: false },
    { mes: '更早的用户消息内容', is_user: true },
    { mes: '这是末条assistant消息', is_user: false },
    { mes: '这是当前用户输入', is_user: true }
];
var stLegs = buildWeightedQueryLegs(stChat, {});
eq(stLegs.userLeg, '这是当前用户输入', 'ST 格式提取当前用户输入');
eq(stLegs.ctxLeg, '这是末条assistant消息', 'ST 格式提取末条 assistant');

// role/content 格式
var roleChat = [
    { role: 'assistant', content: 'assistant上下文内容' },
    { role: 'user', content: '用户输入内容' }
];
var roleLegs = buildWeightedQueryLegs(roleChat, {});
eq(roleLegs.userLeg, '用户输入内容', 'role/content 格式提取用户输入');
eq(roleLegs.ctxLeg, 'assistant上下文内容', 'role/content 格式提取末条 assistant');

// ctx 截断：默认 400 字
var longCtx = new Array(500 + 1).join('a'); // 500 chars
var longUserInput = '这是一段足够长的用户输入内容';
var longLegs = buildWeightedQueryLegs([
    { role: 'assistant', content: longCtx },
    { role: 'user', content: longUserInput }
], {});
eq(longLegs.ctxLeg.length, 400, 'ctx 默认截断 400 字');
eq(longLegs.userLeg, longUserInput, '用户输入不截断');

// queryAiWeight=low：ctx 截 200
var lowLegs = buildWeightedQueryLegs([
    { role: 'assistant', content: longCtx },
    { role: 'user', content: longUserInput }
], { queryAiWeight: 'low' });
eq(lowLegs.ctxLeg.length, 200, 'queryAiWeight=low 时 ctx 截 200');

// 短消息（≤5字）跳过，回溯找更早的有效消息
var skipLegs = buildWeightedQueryLegs([
    { role: 'assistant', content: '这是一条有效的上下文消息' },
    { role: 'assistant', content: '短' },
    { role: 'user', content: 'ok' },
    { role: 'user', content: '这是有效用户输入' }
], {});
eq(skipLegs.userLeg, '这是有效用户输入', '≤5字用户消息被跳过');
eq(skipLegs.ctxLeg, '这是一条有效的上下文消息', '≤5字 assistant 消息被跳过');

// 只有 assistant 无 user（narrator-only）：userLeg 为空，ctxLeg 正常
var noUserLegs = buildWeightedQueryLegs([
    { role: 'assistant', content: '只有assistant的消息' }
], {});
eq(noUserLegs.userLeg, '', '无用户输入 => userLeg 空');
eq(noUserLegs.ctxLeg, '只有assistant的消息', '无用户输入时 ctxLeg 仍提取');

console.log('\n=== injection-query: fuseWeightedRuns ===');

// 加权合并：两腿共有 id => 0.78u + 0.22x；仅 user 腿 => 0.78u；仅 ctx 腿 => 0.22x
var userRun = [
    { __id: 'a', __relevance: 0.9 },
    { __id: 'b', __relevance: 0.5 },
    { __id: 'c', __relevance: 0.8 }
];
var ctxRun = [
    { __id: 'b', __relevance: 1.0 },
    { __id: 'd', __relevance: 0.9 },
    { __id: 'a', __relevance: 0.2 }
];
var fused = fuseWeightedRuns(userRun, ctxRun, 0.78);
eq(fused.length, 4, '融合结果含两腿全部 id');

var byId = {};
fused.forEach(function (f) { byId[f.__id] = f.__relevance; });
assert(Math.abs(byId.a - (0.78 * 0.9 + 0.22 * 0.2)) < 1e-9, '两腿共有 a: 0.78*0.9 + 0.22*0.2 (got ' + byId.a + ')');
assert(Math.abs(byId.b - (0.78 * 0.5 + 0.22 * 1.0)) < 1e-9, '两腿共有 b: 0.78*0.5 + 0.22*1.0 (got ' + byId.b + ')');
assert(Math.abs(byId.c - (0.78 * 0.8)) < 1e-9, '仅 user 腿 c: 0.78*0.8 (got ' + byId.c + ')');
assert(Math.abs(byId.d - (0.22 * 0.9)) < 1e-9, '仅 ctx 腿 d: 0.22*0.9 (got ' + byId.d + ')');

// 降序排序验证：b(0.61) < c(0.624)? 0.78*0.5+0.22 = 0.61; c=0.624; a=0.746; d=0.198
// 期望顺序: a(0.746) > c(0.624) > b(0.61) > d(0.198)
eq(fused[0].__id, 'a', '排序第 1 位是 a (分数最高)');
eq(fused[1].__id, 'c', '排序第 2 位是 c');
eq(fused[2].__id, 'b', '排序第 3 位是 b');
eq(fused[3].__id, 'd', '排序第 4 位是 d');

// 缺腿容错
var userOnly = fuseWeightedRuns(userRun, null, 0.78);
eq(userOnly.length, 3, 'ctxRun=null 时仅保留 user 腿');
assert(Math.abs(userOnly[0].__relevance - 0.78 * 0.9) < 1e-9, '仅 user 腿分数 = 0.78*u');

var ctxOnly = fuseWeightedRuns(null, ctxRun, 0.78);
eq(ctxOnly.length, 3, 'userRun=null 时仅保留 ctx 腿');
assert(Math.abs(ctxOnly[0].__relevance - 0.22 * 1.0) < 1e-9, '仅 ctx 腿分数 = 0.22*x');

var bothNull = fuseWeightedRuns(undefined, undefined, 0.78);
eq(bothNull.length, 0, '双 null => 空结果');

// __relevance 缺失记 0
var noScore = fuseWeightedRuns([{ __id: 'x' }], [{ __id: 'x' }], 0.78);
assert(noScore[0].__relevance === 0, '缺失 __relevance 记 0');

// 不修改入参（浅拷贝合并）
var origUser = [{ __id: 'a', __relevance: 0.9 }];
fuseWeightedRuns(origUser, [], 0.78);
eq(origUser[0].__relevance, 0.9, '融合不修改入參分数');

console.log('\n=== injection-query: 拼接形态回归（防退化） ===');
// 意图稀释回归：user 输入在 query 中的占比不应被上下文拼接稀释。
// legs 形态下 userLeg 独立成腿（不与 ctx 拼接），检索时 user 腿权重 0.78 > ctx 0.22
var dilutionLegs = buildWeightedQueryLegs([
    { role: 'assistant', content: longCtx },
    { role: 'user', content: '用户的关键问题' }
], {});
assert(dilutionLegs.userLeg.indexOf('用户的关键问题') >= 0 && dilutionLegs.userLeg.length === '用户的关键问题'.length,
    'userLeg 只含用户输入，无上下文拼接');
assert(dilutionLegs.ctxLeg !== dilutionLegs.userLeg, '两腿分离，非拼接形态');

if (failed > 0) {
    console.error('\ninjection-query: ' + failed + ' FAILED, ' + passed + ' passed');
    process.exit(1);
} else {
    console.log('\ninjection-query: all ' + passed + ' assertions passed');
}
