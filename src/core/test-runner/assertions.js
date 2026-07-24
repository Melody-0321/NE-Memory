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
        var len = typeof target === 'number' ? target : (typeof target === 'string' ? target.length : (Array.isArray(target) ? target.length : -1));
        return { op: op, passed: len >= value, label: label, detail: '实际=' + len + ' (要求>=' + value + ')' };

    case 'max_length':
        var len2 = typeof target === 'number' ? target : (typeof target === 'string' ? target.length : (Array.isArray(target) ? target.length : -1));
        return { op: op, passed: len2 <= value, label: label, detail: '实际=' + len2 + ' (要求<=' + value + ')' };

    case 'contains':
        if (typeof target !== 'string') return { op: op, passed: false, label: label, detail: 'target 不是字符串' };
        var vals = Array.isArray(value) ? value : [value];
        var missing = vals.filter(function(v) { return target.indexOf(v) === -1; });
        return { op: op, passed: missing.length === 0, label: label, detail: missing.length > 0 ? '缺少: ' + missing.join(', ') : '全部包含' };

    case 'not_contains':
        if (typeof target !== 'string') return { op: op, passed: false, label: label, detail: 'target 不是字符串' };
        var found = target.indexOf(value) !== -1;
        return { op: op, passed: !found, label: label, detail: found ? '发现禁止内容: ' + value : '未发现' };

    case 'equals':
        var actual = target;
        return { op: op, passed: actual === value, label: label, detail: '实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(value) };

    case 'exists':
        var exists = target !== null && target !== undefined && target !== '';
        var expected = value !== undefined ? value : true;
        return { op: op, passed: exists === expected, label: label, detail: (exists ? '存在' : '不存在') + ', 期望=' + expected };

    case 'regex':
        if (typeof target !== 'string') return { op: op, passed: false, label: label, detail: 'target 不是字符串' };
        try {
            var re = new RegExp(value);
            return { op: op, passed: re.test(target), label: label, detail: re.test(target) ? '匹配' : '不匹配' };
        } catch (e) { return { op: op, passed: false, label: label, detail: '正则错误: ' + e.message }; }

    case 'type':
        return { op: op, passed: typeof target === value, label: label, detail: '实际类型=' + typeof target };

    default:
        return { op: op, passed: false, label: label, detail: '未知操作: ' + op };
    }
}

export function evaluateAllStructural(collected, assertions) {
    return assertions.map(function(a) { return evaluateStructural(collected, a); });
}

/**
 * 语义性断言 — 用 LLM 评估
 * 支持三态结果：passed=true(通过), passed=false(不通过), passed=null(无法判断，需继续)
 * @param {string} pipelineResponses - 管线 LLM 调用记录
 * @param {Array<string>} questions - 语义问题列表
 * @param {Function} callLLM - 调用 LLM 的函数 (systemPrompt, userPrompt) => string
 * @param {number} round - 当前轮次
 * @returns {Array<object>} [{ question, passed, evaluation }]
 */
export async function evaluateSemantic(pipelineResponses, questions, callLLM, round) {
    if (!pipelineResponses || pipelineResponses.length === 0) {
        return questions.map(function(q) { return { question: q, passed: null, evaluation: '尚无管线数据，无法判断。' }; });
    }
    var systemPrompt = '你是 NE Memory 的测试评估器。给定管线 LLM 调用记录和测试问题，对每个问题判断是否满足要求。\n' +
        '注意：如果当前轮次的数据尚不足以判断（比如故事还在展开、记忆还在积累中），可以回答 "无法判断"。\n' +
        '回答 JSON 数组: [{"question_index": 1, "passed": true/false/null, "evaluation": "简短评估说明"}]。\n' +
        'passed=true = 确定通过; passed=false = 确定不通过; passed=null = 数据不足，尚且无法判断。';
    var userPrompt = '(第 ' + (round || '?') + ' 轮)\n## 管线 LLM 调用记录\n```\n' + String(pipelineResponses).substring(0, 3000) + '\n```';
    userPrompt += '\n\n## 测试问题\n' + questions.map(function(q, i) { return (i + 1) + '. ' + q; }).join('\n') + '\n\n请对每个问题给出评估。回答 JSON 数组: [{"question_index": 1, "passed": true/false/null, "evaluation": "..."}]';

    try {
        var response = await callLLM(systemPrompt, userPrompt);
        var parsed = parseJsonFromResponse(response);
        if (parsed && Array.isArray(parsed)) {
            return questions.map(function(q, i) {
                var match = parsed.find(function(r) { return r.question_index === i + 1; });
                if (!match) return { question: q, passed: null, evaluation: 'LLM 未给出该问题的评估' };
                return {
                    question: q,
                    passed: match.passed,
                    evaluation: match.evaluation || ''
                };
            });
        }
    } catch (e) {}
    return questions.map(function(q) { return { question: q, passed: null, evaluation: 'LLM 评估失败，无法判断。' }; });
}

function resolveTarget(collected, targetName) {
    switch (targetName) {
    case 'smartpush_injection': return collected.injection || '';
    case 'pipeline_changes': return collected.pipeline ? JSON.stringify(collected.pipeline.changes || {}) : '';
    case 'stm_events': return collected.stmEvents ? JSON.stringify(collected.stmEvents.events || []) : '';
    case 'injection': return collected.injection || '';
    case 'smartpush_prompt': return collected.smartpushPrompt || '';
    case 'pipeline_responses': return collected.pipelineResponses || globalThis.__ne_debug_all_pipeline_responses || '';
    case 'ltm_decision': return collected.ltmDecision ? JSON.stringify(collected.ltmDecision) : '';
    case 'ltm_state': return collected.ltmState ? JSON.stringify(collected.ltmState) : '';
    case 'state_block_instruction': return collected.stateBlockInstruction || '';
    case 'context_memory': return collected.contextMemory || '';
    case 'faction_state': return collected.factionState ? JSON.stringify(collected.factionState) : '';
    case 'truncation_count': return collected.truncationCount;
    case 'fallback_count': return collected.fallbackCount;
    case 'vector_used': return collected.vectorUsed;
    case 'vector_candidate_count': return collected.vectorCandidateCount;
    case 'bm25_candidate_count': return collected.bm25CandidateCount;
    case 'adaptive_triggered': return collected.adaptiveResult ? collected.adaptiveResult.triggered : false;
    case 'adaptive_action': return collected.adaptiveResult ? collected.adaptiveResult.action : '';
    case 'adaptive_tokens_before': return collected.adaptiveResult ? collected.adaptiveResult.totalTokensBefore : 0;
    case 'adaptive_tokens_after': return collected.adaptiveResult ? collected.adaptiveResult.totalTokensAfter : 0;
    case 'adaptive_dialog_rounds_after': return collected.adaptiveResult ? collected.adaptiveResult.dialogRoundsAfter : 0;
    case 'adaptive_budget': return collected.adaptiveResult ? collected.adaptiveResult.totalBudget : 0;
    case 'adaptive_golden_tier': return collected.adaptiveResult ? collected.adaptiveResult.goldenTier : '';
    case 'adaptive_golden_upper': return collected.adaptiveResult ? collected.adaptiveResult.goldenUpper : 0;
    case 'adaptive_golden_lower': return collected.adaptiveResult ? collected.adaptiveResult.goldenLower : 0;
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
