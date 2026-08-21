/**
 * stm-period.test.js — Fix B period 基准推进与规范化测试
 *
 * 覆盖：
 * - normalizeStmPeriod：Day 前缀规范化、缺失/"-"/"—" 回退基准、裸时段词挂 Day 前缀、无基准自设 Day 1
 * - buildStmSummaryPrompt：基准 period 从 unconsolidated_stm+stm_entries 合并推导（追赶批次基准缺失回归）、
 *   baselinePeriodOverride 优先、fallback prompt 无模糊词示例、强制 Day N + 时段格式指令
 */
import { normalizeStmPeriod, buildStmSummaryPrompt, resolvePromptArm } from '../src/core/engine/stm-pipeline.js';
import { formatTurnsText, groupMessagesIntoTurns } from '../src/core/engine/turn-segmenter.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }
function eq(a, b, msg) { assert(a === b, msg + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }
function ok(val, msg) { assert(!!val, msg + ' (got ' + JSON.stringify(val) + ')'); }

console.log('\n=== stm-period: normalizeStmPeriod ===');

// 已带 Day 前缀：仅规范化空格，不重写内容
eq(normalizeStmPeriod('Day 3 深夜', 'Day 2 上午'), 'Day 3 深夜', 'Day 前缀原样保留');
eq(normalizeStmPeriod('day  4 傍晚', 'Day 2 上午'), 'Day 4 傍晚', '小写 day + 多空格规范化为 Day N');
eq(normalizeStmPeriod('Day 5', ''), 'Day 5', '仅 Day 前缀无时段也通过');

// 缺失 / "-" / "—"：回退基准；无基准自设 Day 1
eq(normalizeStmPeriod('-', 'Day 2 上午'), 'Day 2 上午', '"-" 回退基准 period');
eq(normalizeStmPeriod('—', 'Day 2 上午'), 'Day 2 上午', '"—" 回退基准 period');
eq(normalizeStmPeriod('', 'Day 2 上午'), 'Day 2 上午', '空串回退基准 period');
eq(normalizeStmPeriod(undefined, 'Day 2 上午'), 'Day 2 上午', 'undefined 回退基准 period');
eq(normalizeStmPeriod(null, 'Day 2 上午'), 'Day 2 上午', 'null 回退基准 period');
eq(normalizeStmPeriod('-', ''), 'Day 1', '"-" 且无基准 => Day 1');
eq(normalizeStmPeriod('', ''), 'Day 1', '空且无基准 => Day 1');
eq(normalizeStmPeriod('-', '深夜'), 'Day 1', '基准无 Day 前缀时不继承模糊基准，自设 Day 1');

// 裸时段词：挂到基准 Day 前缀上
eq(normalizeStmPeriod('深夜', 'Day 2 上午'), 'Day 2 深夜', '裸时段词挂基准 Day 前缀');
eq(normalizeStmPeriod('傍晚', 'Day  7 中午'), 'Day 7 傍晚', '基准多空格也正确提取 Day 前缀');
eq(normalizeStmPeriod('深夜', ''), 'Day 1 深夜', '裸时段词无基准 => Day 1 + 时段');
eq(normalizeStmPeriod('深夜', '中午'), 'Day 1 深夜', '基准无 Day 前缀 => Day 1 + 时段');

console.log('\n=== stm-period: buildStmSummaryPrompt 基准推导 ===');

function makeTurns(n) {
    var msgs = [];
    for (var i = 0; i < n; i++) {
        msgs.push({ role: 'user', mes: '用户消息' + i + '的完整内容文本', is_user: true, _absIdx: i * 2 });
        msgs.push({ role: 'assistant', mes: '助手回复' + i + '的完整内容文本', _absIdx: i * 2 + 1 });
    }
    return groupMessagesIntoTurns(msgs);
}

function makeVault(unconsolidated, stmEntries) {
    return { content: {
        unconsolidated_stm: unconsolidated || [],
        stm_entries: stmEntries || [],
        state: {}
    } };
}

var emptyStateVault = { content: {} };
var turns = makeTurns(2);
var segTexts = {};
var segKey = [[0, 1]];

// 回归：基准必须合并 unconsolidated_stm + stm_entries（旧实现只读 stm_entries，追赶批次基准为空）
var vaultUnconsolidatedOnly = makeVault([
    { id: 'stm_9', period: 'Day 3 深夜', scene: '书房', event: '旧事件', msgRange: [0, 1] }
], []);
globalThis.__ne_banner_matched = false;
var prompt1 = buildStmSummaryPrompt(segKey, turns, vaultUnconsolidatedOnly, emptyStateVault, 0.05, segTexts);
ok(prompt1.user.indexOf('基准 period: Day 3 深夜') >= 0,
    '基准从 unconsolidated_stm 推导（追赶批次基准缺失回归）');

// stm_entries 也能推导
var vaultStmOnly = makeVault([], [
    { id: 'stm_5', period: 'Day 2 上午', scene: '客厅', event: '旧事件', msgRange: [0, 1] }
]);
var prompt2 = buildStmSummaryPrompt(segKey, turns, vaultStmOnly, emptyStateVault, 0.05, segTexts);
ok(prompt2.user.indexOf('基准 period: Day 2 上午') >= 0, '基准从 stm_entries 推导');

// 合并两侧取末条（msg 序最大）
var vaultBoth = makeVault(
    [{ id: 'stm_9', period: 'Day 3 深夜', msgRange: [4, 5], event: '新条目' }],
    [{ id: 'stm_5', period: 'Day 2 上午', msgRange: [0, 1], event: '旧条目' }]
);
var prompt3 = buildStmSummaryPrompt(segKey, turns, vaultBoth, emptyStateVault, 0.05, segTexts);
ok(prompt3.user.indexOf('基准 period: Day 3 深夜') >= 0, '合并两侧取 msg 序末条为基准');

// baselinePeriodOverride 优先于推导值
var prompt4 = buildStmSummaryPrompt(segKey, turns, vaultBoth, emptyStateVault, 0.05, segTexts, 'Day 10 黎明');
ok(prompt4.user.indexOf('基准 period: Day 10 黎明') >= 0, 'baselinePeriodOverride 优先');

// 无任何 STM：提示自设初始锚
var vaultEmpty = makeVault();
var prompt5 = buildStmSummaryPrompt(segKey, turns, vaultEmpty, emptyStateVault, 0.05, segTexts);
ok(prompt5.user.indexOf('自设初始锚') >= 0, '无基准时提示自设初始锚 Day 1');

console.log('\n=== stm-period: fallback prompt 无模糊词 + 格式强制 ===');

// fallback 分支（banner 未匹配）system prompt 断言
var sys = prompt1.system;
ok(sys.indexOf('深夜/清晨') < 0 && sys.indexOf('深夜、清晨') < 0, 'fallback prompt 不含 "深夜/清晨" 模糊词示例');
ok(sys.indexOf('基准 period') >= 0 || sys.indexOf('baseline period') >= 0, 'fallback prompt 含基准推进指令');
ok(sys.indexOf('Day N + 时段') >= 0 || sys.indexOf('Day N + time-of-day') >= 0, 'fallback prompt 强制 Day N + 时段格式');
ok(sys.indexOf('禁止输出') >= 0 || sys.indexOf('Never output') >= 0, 'fallback prompt 禁止 "-" 输出');

// 近期记忆条目携带 period（供 LLM 参考）
ok(prompt3.user.indexOf('Day 3 深夜') >= 0 && prompt3.user.indexOf('近期记忆条目') >= 0,
    '近期记忆条目区携带 period');

console.log('\n=== stm-period: prompt-arm override ===');

// 幂等性：不设 __ne_prompt_arm 时 prompt 与现状逐字节一致（生产零行为变化）
globalThis.__ne_prompt_arm = undefined;
var promptNoArm = buildStmSummaryPrompt(segKey, turns, vaultBoth, emptyStateVault, 0.05, segTexts);
ok(promptNoArm.system === prompt3.system && promptNoArm.user === prompt3.user,
    '不设 __ne_prompt_arm 时输出与现状逐字节一致');
ok(resolvePromptArm() === null && resolvePromptArm(undefined) === null, 'resolvePromptArm 无 arm 时返回 null');

// 未知 arm 名拒绝（防拼错名静默跑成现状）
ok(resolvePromptArm('L9') === null, '未知 arm 名返回 null');

// C0：摘密度引导（推荐字数引用/压缩指令/header 推荐字数）
globalThis.__ne_prompt_arm = 'C0';
var promptC0 = buildStmSummaryPrompt(segKey, turns, vaultBoth, emptyStateVault, 0.05, segTexts);
ok(promptC0.system.indexOf('推荐摘要字数') < 0, 'C0 system 无推荐字数引用');
ok(promptC0.system.indexOf('仍只输出一条事件来概括') < 0, 'C0 移除压缩指令');
ok(promptC0.user.indexOf('推荐摘要约') < 0, 'C0 header 无推荐字数');
ok(promptC0.system.indexOf('严禁拆分区间') >= 0, 'C0 保留覆盖规则（管线正确性依赖）');

// L1a：ratio 覆盖（header 推荐字数 0.05→0.15）
globalThis.__ne_prompt_arm = 'L1a';
var promptL1a = buildStmSummaryPrompt(segKey, turns, vaultBoth, emptyStateVault, 0.05, segTexts);
ok(promptL1a.user.indexOf('推荐摘要约') >= 0, 'L1a header 仍带推荐字数');
function headerRec(user) { var m = user.match(/推荐摘要约 (\d+) 字/); return m ? Number(m[1]) : null; }
ok(headerRec(promptL1a.user) > headerRec(prompt3.user),
    'L1a 推荐字数高于默认 ratio（' + headerRec(promptL1a.user) + ' > ' + headerRec(prompt3.user) + '）');

// L1b+L2 组合：ratio 后者叠加 + extraRules 拼接 + 压缩指令移除
globalThis.__ne_prompt_arm = 'L1b+L2';
var promptStack = buildStmSummaryPrompt(segKey, turns, vaultBoth, emptyStateVault, 0.05, segTexts);
ok(promptStack.system.indexOf('仍只输出一条事件来概括') < 0, 'L1b+L2 移除压缩指令');
ok(promptStack.system.indexOf('保留具体数字') >= 0, 'L1b+L2 追加保留清单');
ok(promptStack.system.indexOf('附加规则') >= 0, '组合 arm 的 extraRules 挂在附加规则区');

// 清理：不留全局污染
globalThis.__ne_prompt_arm = undefined;

if (failed > 0) {
    console.error('\nstm-period: ' + failed + ' FAILED, ' + passed + ' passed');
    process.exit(1);
} else {
    console.log('\nstm-period: all ' + passed + ' assertions passed');
}
