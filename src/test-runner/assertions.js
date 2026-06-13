/**
 * test-runner/assertions.js — 结构性断言 + 语义性断言
 */

/**
 * 求值单个结构性断言
 * @param {object} collected - 采集的数据
 * @param {object} assertion - { op, target, value }
 * @returns {object} { passed, label, detail }
 */
export function evaluateStructural(collected, assertion) {
    var target = resolveTarget(collected, assertion.target);
    var op = assertion.op;
    var value = assertion.value;

    var label = op + ': ' + assertion.target + ' ' + describeValue(op, value);
    var detail = '';

    switch (op) {
    case 'min_length':
        var len = typeof target === 'string' ? target.length : (Array.isArray(target) ? target.length : -1);
        return { passed: len >= value, label: label, detail: '实际长度=' + len + ' (要求>=' + value + ')' };

    case 'max_length':
        var len2 = typeof target === 'string' ? target.length : (Array.isArray(target) ? target.length : -1);
        return { passed: len2 <= value, label: label, detail: '实际长度=' + len2 + ' (要求<=' + value + ')' };

    case 'contains':
        if (typeof target !== 'string') return { passed: false, label: label, detail: 'target 不是字符串' };
        var vals = Array.isArray(value) ? value : [value];
        var missing = vals.filter(function(v) { return target.indexOf(v) === -1; });
        return { passed: missing.length === 0, label: label, detail: missing.length > 0 ? '缺少: ' + missing.join(', ') : '全部包含' };

    case 'not_contains':
        if (typeof target !== 'string') return { passed: false, label: label, detail: 'target 不是字符串' };
        var found = target.indexOf(value) !== -1;
        return { passed: !found, label: label, detail: found ? '发现禁止内容: ' + value : '未发现' };

    case 'equals':
        var actual = target;
        return { passed: actual === value, label: label, detail: '实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(value) };

    case 'exists':
        var exists = target !== null && target !== undefined && target !== '';
        return { passed: exists === value, label: label, detail: exists ? '存在' : '不存在' };

    case 'regex':
        if (typeof target !== 'string') return { passed: false, label: label, detail: 'target 不是字符串' };
        try {
            var re = new RegExp(value);
            return { passed: re.test(target), label: label, detail: re.test(target) ? '匹配' : '不匹配' };
        } catch (e) { return { passed: false, label: label, detail: '正则错误: ' + e.message }; }

    case 'type':
        return { passed: typeof target === value, label: label, detail: '实际类型=' + typeof target };

    default:
        return { passed: false, label: label, detail: '未知操作: ' + op };
    }
}

export function evaluateAllStructural(collected, assertions) {
    return assertions.map(function(a) { return evaluateStructural(collected, a); });
}

/**
 * 语义性断言 — 用 LLM 评估
 * @param {string} injection - SmartPush 注入文本
 * @param {Array<string>} questions - 语义问题列表
 * @param {Function} callLLM - 调用 LLM 的函数 (systemPrompt, userPrompt) => string
 * @returns {Array<object>} [{ question, passed, evaluation }]
 */
export async function evaluateSemantic(injection, questions, callLLM) {
    if (!injection || injection.length === 0) {
        return questions.map(function(q) { return { question: q, passed: false, evaluation: '无注入内容可评估。' }; });
    }
    var systemPrompt = '你是 NE Memory 的测试评估器。给定 SmartPush 注入内容和测试问题，判断注入是否满足要求。回答 JSON: {"passed": true/false, "evaluation": "评估说明"}';
    var userPrompt = '## 注入内容\n```\n' + injection.substring(0, 2000) + '\n```\n\n## 测试问题\n' + questions.map(function(q, i) { return (i + 1) + '. ' + q; }).join('\n') + '\n\n请对每个问题给出评估。回答 JSON 数组: [{"question_index": 1, "passed": true/false, "evaluation": "..."}]';

    try {
        var response = await callLLM(systemPrompt, userPrompt);
        var parsed = parseJsonFromResponse(response);
        if (parsed && Array.isArray(parsed)) {
            return questions.map(function(q, i) {
                var match = parsed.find(function(r) { return r.question_index === i + 1; });
                return {
                    question: q,
                    passed: match ? match.passed : false,
                    evaluation: match ? match.evaluation : 'LLM 未给出评估'
                };
            });
        }
    } catch (e) {}
    return questions.map(function(q) { return { question: q, passed: false, evaluation: 'LLM 评估失败。' }; });
}

function resolveTarget(collected, targetName) {
    switch (targetName) {
    case 'smartpush_injection': return collected.injection || '';
    case 'pipeline_changes': return collected.pipeline ? JSON.stringify(collected.pipeline.changes || {}) : '';
    case 'stm_events': return collected.stmEvents ? JSON.stringify(collected.stmEvents.events || []) : '';
    case 'injection': return collected.injection || '';
    default: return '';
    }
}

function describeValue(op, value) {
    switch (op) {
    case 'min_length': return '>=' + value;
    case 'max_length': return '<=' + value;
    case 'contains': return '含 ' + JSON.stringify(value);
    case 'not_contains': return '不含 "' + value + '"';
    case 'equals': return '= ' + JSON.stringify(value);
    case 'exists': return value ? '存在' : '不存在';
    case 'regex': return '匹配 /' + value + '/';
    case 'type': return '类型为 ' + value;
    default: return '';
    }
}

function parseJsonFromResponse(text) {
    if (!text) return null;
    var jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) text = jsonMatch[1].trim();
    else {
        var bracketMatch = text.match(/\[[\s\S]*\]/);
        if (bracketMatch) text = bracketMatch[0];
    }
    try { return JSON.parse(text); } catch (e) { return null; }
}
