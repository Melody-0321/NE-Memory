import { findOpenLtm, formatLtmCatalog, computeClosureSignals, MAX_OPEN_STM_REFS } from './consolidate.js';
import { safeJsonParse } from './json-fallback.js';
import { validateLtmDecision } from './validate.js';

function buildLtmDecisionPrompt(vault, newStmEntries, forceClose) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var ltmEntries = content.ltm_entries || [];
    var openLtm = findOpenLtm(vault);
    var closedCatalog = formatLtmCatalog(ltmEntries);

    var ltmCtx = '';

    ltmCtx += '\n\n## 当前进行中的叙事弧（开放 LTM）\n';
    if (openLtm) {
        ltmCtx += 'title: ' + (openLtm.title || '') + '\n';
        // 累积式摘要下 event 逐拍增长：展示尾部——增量句需衔接"已写到哪"，闭弧定稿需覆盖整弧叙事
        var evText = openLtm.event || '';
        ltmCtx += 'event: ' + (evText.length > 500 ? '…' + evText.slice(-500) : evText) + '\n';
        ltmCtx += 'period: ' + (openLtm.period || '') + '\n';
        ltmCtx += 'entities: ' + ((openLtm.present_characters || openLtm.entities || []).map(function(e) { return typeof e === 'string' ? e : e.name; }).join(', ') || '') + '\n';
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
    ltmCtx += 'append（追加到当前弧）：当新事件与当前弧在叙事上连续 —— 时间在同一日或紧邻的时区、场景在附近区域或同一活动范围内、至少一个核心角色仍在场。\n';
    if (forceClose) {
        ltmCtx += '  ⚠️ 你必须填写 updated_title（15-40字）和 updated_event（80-140字）。该弧已达 STM 上限，本轮后将被强制闭合，需要为这条已完结的叙事弧撰写标题和摘要。\n';
    } else {
        ltmCtx += '  填写 updated_event：把本轮新 STM 事件整合成一句增量叙事（20-60字），衔接现有摘要末尾往下写，禁止重复已有内容；updated_title 留空 ""（标题闭合时才定稿）。\n';
    }
    ltmCtx += 'close_and_new（闭合+开启新弧）：叙事弧已自然终结。时间跨日 / 场景根本性变化 / 核心角色离场 / 事件本身是明确终结点。若新事件与当前弧无明显关联，也应闭合并开启新弧。\n';
    ltmCtx += '  此时 updated_title/updated_event 为刚闭合的弧撰写标题和摘要，总结这条已完结弧的核心内容。\n';

    if (lang === 'en') {
        ltmCtx += '\nOutput JSON with ltm_decision field:\n{\n  "ltm_decision": {\n    "action": "append" | "close_and_new",\n    "updated_title": "append: leave empty \\"\\"; close_and_new: fill title for the arc being CLOSED (15-40 chars)",\n    "updated_event": "append: one incremental sentence covering THIS ROUND\'S new events (20-60 chars, continue from the end of the existing summary, no repetition); close_and_new: fill full summary for the arc being CLOSED (80-140 chars)"\n  }\n}\n';
        if (forceClose) {
            ltmCtx += 'This arc will be forcibly closed — fill title and summary regardless of action.\n';
        } else {
            ltmCtx += 'For append, fill updated_event with one incremental sentence for this round\'s new events; leave updated_title empty.\n';
        }
        return {
            system: 'You are a narrative arc manager. Given the current arc state and newly extracted story events, decide how to update the arcs.\n\n' +
                'Only output valid JSON with the ltm_decision field — no surrounding text.\n\n' + ltmCtx,
            user: 'Based on the arc state and new STM events above, output the ltm_decision.'
        };
    }
    ltmCtx += '\n输出 JSON，包含 ltm_decision 字段：\n{\n  "ltm_decision": {\n    "action": "append" | "close_and_new",\n    "updated_title": "append时留空\\"\\"；close_and_new时为刚闭合的弧填写标题（15-40字）",\n    "updated_event": "append时为本轮新事件写一句增量叙事（20-60字，衔接现有摘要末尾，禁止重复）；close_and_new时为刚闭合的弧填写完整摘要（80-140字）"\n  }\n}\n';
    if (forceClose) {
        ltmCtx += '本轮强制闭合——无论 decision 是 append 还是 close_and_new，都必须填写标题和摘要。';
    } else {
        ltmCtx += 'append时填写 updated_event 增量句（本轮新事件的一句话，衔接现有摘要末尾，禁止重复已有内容）；updated_title 留空，闭合时才定稿。';
    }
    return {
        system: '你是叙事弧管理者。根据当前弧状态和新提取的故事事件，决定如何更新叙事弧。\n\n' +
            '只输出包含 ltm_decision 字段的有效 JSON，不要输出任何其他文字。\n\n' + ltmCtx,
        user: '根据上述弧状态和新 STM 事件，输出 ltm_decision。'
    };
}

export async function runLtmDecision(vault, newStmIds, callMemoryPipeline, forceClose) {
    var allSTM = (vault.content.unconsolidated_stm || []).concat(vault.content.stm_entries || []);
    var newStmEntries = newStmIds.map(function(id) { return allSTM.find(function(s) { return s.id === id; }); }).filter(Boolean);
    if (newStmEntries.length === 0) return null;

    var prompt = buildLtmDecisionPrompt(vault, newStmEntries, forceClose);
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
            result = validateLtmDecision(result);
            if (!result) {
                console.warn('[NE] LTM decision action invalid, retrying once');
                try {
                    responseText = await callMemoryPipeline([
                        { role: 'system', content: prompt.system + '\n\n错误：上一轮的 action 值无效。action 必须是 "append" 或 "close_and_new"。' },
                        { role: 'user', content: prompt.user }
                    ], { operation: 'ltm_decision_retry' }, vault.id);
                    var parsed2 = safeJsonParse(responseText);
                    if (parsed2) {
                        result = parsed2.ltm_decision || null;
                        if (result) result = validateLtmDecision(result);
                    }
                } catch (e2) {
                    console.warn('[NE] LTM decision retry failed:', e2.message);
                    return null;
                }
                if (!result) {
                    console.warn('[NE] LTM decision retry also invalid, abandoning');
                    return null;
                }
            }
        }
        return result;
    }
    console.warn('[NE] LTM decision LLM returned non-JSON response');
    return null;
}

export async function runBatchLtmDecision(vault, eligibleIds, callMemoryPipeline) {
    var allSTM = (vault.content.unconsolidated_stm || []).concat(vault.content.stm_entries || []);
    var stmEntries = eligibleIds.map(function(id) { return allSTM.find(function(s) { return s.id === id; }); }).filter(Boolean);
    if (stmEntries.length === 0) return [];

    var groups = splitStmsIntoContiguousGroups(stmEntries, 3);
    var batchResults = [];

    // forceClose 接线：开放弧即将触达 STM 上限时激活定稿路径（prompt 要求为整弧写标题+摘要，
    // applyLtmDecision 按 refs>=MAX 识别定稿做整体替换）——修复原先恒 false 导致自动闭合弧零摘要的断线。
    // decision 期间 vault 不落库，用 openRefs 模拟 apply 序列推进，保证后续 group 的判断与实际 apply 时点一致。
    var openLtm = findOpenLtm(vault);
    var openRefs = openLtm ? (openLtm.stm_refs || []).length : 0;

    for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var groupIds = group.map(function(s) { return s.id; });
        var forceClose = openRefs > 0 && (openRefs + groupIds.length) >= MAX_OPEN_STM_REFS;
        var result = await runLtmDecision(vault, groupIds, callMemoryPipeline, forceClose);
        if (result) {
            batchResults.push({
                stm_ids: groupIds,
                action: result.action,
                title: result.updated_title || '',
                event: result.updated_event || '',
                target_ltm: result.target_ltm || undefined
            });
            // 模拟 apply 序列：推进开放弧 refs 计数（close_and_new 开新弧；append 触上限自动闭合后归零）
            if (result.action === 'close_and_new') {
                openRefs = groupIds.length;
            } else if (result.action === 'append') {
                openRefs = openRefs + groupIds.length;
                if (openRefs >= MAX_OPEN_STM_REFS) openRefs = 0;
            }
        }
    }

    return batchResults;
}

function splitStmsIntoContiguousGroups(stms, tolerance) {
    if (stms.length === 0) return [];
    var sorted = stms.slice().sort(function(a, b) {
        var aStart = a.msgRange ? a.msgRange[0] : 999999;
        var bStart = b.msgRange ? b.msgRange[0] : 999999;
        return aStart - bStart;
    });
    var groups = [];
    var currentGroup = [sorted[0]];
    for (var i = 1; i < sorted.length; i++) {
        var prev = sorted[i - 1];
        var curr = sorted[i];
        var prevEnd = prev.msgRange ? prev.msgRange[1] : (prev.msgRange ? prev.msgRange[0] : 999999);
        var currStart = curr.msgRange ? curr.msgRange[0] : 999999;
        if (currStart - prevEnd <= tolerance) {
            currentGroup.push(curr);
        } else {
            groups.push(currentGroup);
            currentGroup = [curr];
        }
    }
    groups.push(currentGroup);
    return groups;
}
