// modality-arm-prompt.js — 评测期臂构造（不改生产代码）
// 在 buildStmSummaryPrompt 产出的系统提示字符串上做注入，构造不同实验臂：
//   base  A0 基线（原样）
//   B    事件 JSON schema 增加可选 modality 枚举字段 + reversal 最终状态规则
//   C    B 基础上再增加 final_status 字段（reversal 必填）+ 硬约束规则
//
// 注入锚点：4 个分支的 schema 文字块都含字面量 `"present_characters"`，在此字段前插入新字段，
// 并在系统串末尾（现有 MODALITY_RULES 之后）追加对应规则。测试 vault 为空 → lang='zh'。
// 导出 `applyModalityArmWithAssert` 供断言测试；导出 `applyModalityArm` 供生产使用。

var FIELD_B = '      "modality": "fact | teasing | hypothetical | reversal",';
var FIELD_C = '      "final_status": "描述最终真实状态（仅 reversal 必填）",';

var RULE_B = '- modality 必须显式标注情态类别；reversal 时 event 必须写清最终状态（当前真实状态），不得只保留最初主张。';
var RULE_C = '- 当 modality=reversal 时，final_status 为必填，必须描写当前真实状态的结局（谁/做了什么/当下如何）。';

// 断言点集合，供单元验证遍历
export var assertPoints = ['zh_schema', 'zh_rules', 'field_B', 'field_C'];

export function applyModalityArm(baseSystem, arm) {
    if (arm === 'base' || !baseSystem) return baseSystem;
    var out = baseSystem;
    // 字段注入（B 与 C 都加 modality；C 额外加 final_status）
    if (arm === 'B') {
        out = out.replace('"present_characters"', FIELD_B + '\n      "present_characters"');
    } else if (arm === 'C') {
        out = out.replace('"present_characters"', FIELD_C + '\n' + FIELD_B + '\n      "present_characters"');
    }
    // 规则注入（追加到末尾）
    if (arm === 'B') {
        out = out + '\n' + RULE_B;
    } else if (arm === 'C') {
        out = out + '\n' + RULE_B + '\n' + RULE_C;
    }
    return out;
}

// 断言：注入后关键标记是否就位
export function assertArm(baseSystem, arm) {
    if (arm === 'base') {
        return {
            ok: baseSystem.indexOf('"modality"') === -1 && baseSystem.indexOf('final_status') === -1,
            detail: 'base 不应含 modality/final_status',
        };
    }
    var injected = applyModalityArm(baseSystem, arm);
    var issues = [];
    if (injected.indexOf('"modality"') === -1) issues.push('缺 modality 字段');
    if (arm === 'B') {
        if (injected.indexOf(RULE_B) === -1) issues.push('缺 B 规则');
        if (injected.indexOf('final_status') !== -1) issues.push('B 不应含 final_status');
    }
    if (arm === 'C') {
        if (injected.indexOf('final_status') === -1) issues.push('缺 final_status 字段');
        if (injected.indexOf(RULE_C) === -1) issues.push('缺 C 规则');
    }
    return { ok: issues.length === 0, detail: issues.length ? issues.join('; ') : 'ok' };
}