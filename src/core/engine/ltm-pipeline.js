import { findOpenLtm, formatLtmCatalog, computeClosureSignals } from './consolidate.js';
import { callMemoryPipeline, recordTelemetry } from '../api/llm.js';
import { safeJsonParse } from './json-fallback.js';
import { validateLTMOutput } from './validate.js';

var EVENT_CLOSING_PUNCT = /[.。！？!?\"\”\)\}\]\>\」』）]$/;

function _validateLtmEventText(label, text) {
    if (!text) return;
    var len = String(text).length;
    var trimmed = String(text).trim();
    if (len > 0 && !EVENT_CLOSING_PUNCT.test(trimmed)) {
        console.warn('[NE-HARNESS] ' + label + ' updated_event may be truncated — ends with: "' + trimmed.slice(-20) + '" (len=' + len + ')');
    }
    if (len < 50) {
        console.warn('[NE-HARNESS] ' + label + ' updated_event too short — len=' + len + ' text="' + trimmed + '"');
    }
}

function buildLtmDecisionPrompt(vault, newStmEntries) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var ltmEntries = content.ltm_entries || [];
    var openLtm = findOpenLtm(vault);
    var closedCatalog = formatLtmCatalog(ltmEntries);

    var ltmCtx = '';

    ltmCtx += '\n\n## 当前进行中的叙事弧（开放 LTM）\n';
    if (openLtm) {
        ltmCtx += 'title: ' + (openLtm.title || '') + '\n';
        ltmCtx += 'event: ' + (openLtm.event || '').substring(0, 200) + '\n';
        ltmCtx += 'period: ' + (openLtm.period || '') + '\n';
        ltmCtx += 'entities: ' + ((openLtm.entities || []).map(function(e) { return e.name; }).join(', ') || '') + '\n';
        ltmCtx += 'stm_refs 数量: ' + ((openLtm.stm_refs || []).length) + '\n';
    } else {
        ltmCtx += '(无)\n';
    }

    ltmCtx += '\n## 最近已闭合的叙事弧\n' + closedCatalog + '\n';

    ltmCtx += '\n## 闭合信号（系统预计算，供参考）\n';
    if (openLtm) {
        var signals = computeClosureSignals(openLtm, []);
        if (signals) {
            ltmCtx += '- 时间：' + signals.timeGap + '\n';
            ltmCtx += '- 场景：' + (signals.openScene || '?') + ' → ' + (signals.newScene || '?') + (signals.sceneChange ? '（切换）' : '（仍在同一场景）') + '\n';
            ltmCtx += '- 实体重叠：' + signals.entityDetail + '\n';
            ltmCtx += '系统建议：' + signals.signalSummary + '\n';
            ltmCtx += '\n你的角色：核实系统信号是否与事件内容一致。仅在以下情况偏离：\n';
            ltmCtx += '- 新事件内容与信号明显矛盾（如系统建议 close，但新事件是同一场景的延续）\n';
            ltmCtx += '- 弧的叙事目标在新事件中明确终结\n';
        }
    } else {
        ltmCtx += '无开放 LTM，若本轮有新事件出现，即为新叙事弧的开始。\n';
    }

    ltmCtx += '\n## 新入库的 STM 事件\n';
    for (var si = 0; si < newStmEntries.length; si++) {
        var s = newStmEntries[si];
        ltmCtx += '- ' + (s.id || '?') + ': ' + (s.event || '') + '\n';
        if (s.period) ltmCtx += '  时间: ' + s.period + '\n';
        if (s.scene) ltmCtx += '  场景: ' + s.scene + '\n';
    }

    ltmCtx += '\n## 判断标准\n';
    ltmCtx += 'append（追加到当前弧）：当新事件与当前弧在叙事上连续 —— 时间在同一日或紧邻的时区、场景在附近区域或同一活动范围内、至少一个核心角色仍在场。';
    ltmCtx += 'updated_event 应保留旧摘要的核心信息，仅追加新事件带来的增量变化——不要重写。\n';
    ltmCtx += 'close_and_new（闭合+开启新弧）：叙事弧已自然终结。时间跨日 / 场景根本性变化 / 核心角色离场 / 事件本身是明确终结点。若新事件与当前弧无明显关联，也应闭合并开启新弧。\n';

    if (lang === 'en') {
        ltmCtx += '\nOutput JSON with ltm_decision field:\n{\n  "ltm_decision": {\n    "action": "append" | "close_and_new",\n    "updated_title": "required (15-40 chars)",\n    "updated_event": "required (80-140 chars)"\n  }\n}\n' +
            'updated_event should preserve prior summary core info — only add incremental changes.\n';
        return {
            system: 'You are a narrative arc manager. Given the current arc state and newly extracted story events, decide how to update the arcs.\n\n' +
                'Only output valid JSON with the ltm_decision field — no surrounding text.\n\n' + ltmCtx,
            user: 'Based on the arc state and new STM events above, output the ltm_decision.'
        };
    }
    ltmCtx += '\n输出 JSON，包含 ltm_decision 字段：\n{\n  "ltm_decision": {\n    "action": "append" | "close_and_new",\n    "updated_title": "必填（15-40字）",\n    "updated_event": "必填（80-140字）"\n  }\n}\n' +
        'updated_event 保留旧摘要核心信息，仅追加增量——不要重写。';
    return {
        system: '你是叙事弧管理者。根据当前弧状态和新提取的故事事件，决定如何更新叙事弧。\n\n' +
            '只输出包含 ltm_decision 字段的有效 JSON，不要输出任何其他文字。\n\n' + ltmCtx,
        user: '根据上述弧状态和新 STM 事件，输出 ltm_decision。'
    };
}

export async function runLtmDecision(vault, newStmIds, callMemoryPipeline) {
    var allSTM = (vault.content.unconsolidated_stm || []).concat(vault.content.stm_entries || []);
    var newStmEntries = newStmIds.map(function(id) { return allSTM.find(function(s) { return s.id === id; }); }).filter(Boolean);
    if (newStmEntries.length === 0) return null;

    var prompt = buildLtmDecisionPrompt(vault, newStmEntries);
    var responseText = '';
    try {
        responseText = await callMemoryPipeline([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ], { operation: 'ltm_decision' }, vault.id);
    } catch (e) {
        console.warn('[NE] LTM decision LLM failed:', e.message);
        return null;
    }

    if (!responseText || !responseText.trim()) {
        console.warn('[NE] LTM decision LLM returned empty response');
        return null;
    }

    var parsed = safeJsonParse(responseText);
    if (parsed) {
        var result = parsed.ltm_decision || null;
        if (result) {
            var ltmErrors = validateLTMOutput(result);
            if (ltmErrors.length > 0) {
                console.warn('[NE] LTM validation warnings:', ltmErrors.join('; '));
                recordTelemetry({ pipeline_task: 'ltm_decision', validation_warnings: ltmErrors }, vault.id);
            }
        }
        if (result && result.updated_event) {
            _validateLtmEventText('ltm_decision', result.updated_event);
        }
        return result;
    }
    console.warn('[NE] LTM decision LLM returned non-JSON response');
    return null;
}
