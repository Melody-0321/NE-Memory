/**
 * engine/meta-ltm-pipeline.js — 单层 Meta-LTM 跨弧摘要管线
 *
 * 在已闭合的 LTM 叙事弧之上，生成更高层级的跨弧摘要（Meta-LTM）。
 * 解决长对话下 LTM 列表冗长难扫读的展示痛点。
 *
 * 设计要点：
 *   - 单层（level=1），预留 level 字段未来支持无限递归
 *   - 不参与检索打分（与 LTM 保持一致，等 benchmark 拐点）
 *   - 参与注入（顶部"故事弧概览"），这是 Meta-LTM 存在的唯一价值
 *   - 默认关闭，设置开关 metaLtmEnabled + 阈值 metaLtmThreshold 可配
 *   - 统计分类 tok_consolidate（与 LTM 管线共用）
 *
 * 参考 ltm-pipeline.js 的 runBatchLtmDecision / buildLtmDecisionPrompt 模式。
 */

import { safeJsonParse } from './json-fallback.js';
import { validateMetaLtmDecision } from './validate.js';

var MAX_OPEN_LTM_REFS = 15;

// ─── 工具函数 ──────────────────────────────────────────────────

function findNextMetaId(vault) {
    var content = vault.content || {};
    var max = 0;
    (content.meta_ltm_entries || []).forEach(function(e) {
        var num = parseInt(String(e.id || '').replace('meta_ltm_', ''), 10);
        if (num > max) max = num;
    });
    return 'meta_ltm_' + (max + 1);
}

function findOpenMetaLtm(vault) {
    var content = vault.content || {};
    var openMetas = (content.meta_ltm_entries || []).filter(function(e) { return e.status === 'open'; });
    if (openMetas.length > 1) {
        console.warn('[NE Meta-LTM] Multiple open Meta-LTM detected, closing all');
        openMetas.forEach(function(e) { e.status = 'closed'; });
        return null;
    }
    return openMetas.length === 1 ? openMetas[0] : null;
}

function getMetaLtmThreshold() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            return Number(s.metaLtmThreshold) || 20;
        }
    } catch (e) {}
    return 20;
}

/**
 * 获取待摘要的候选 LTM（已闭合且无 parent_meta_ltm）
 */
function getCandidateLtmIds(vault) {
    var content = vault.content || {};
    var closedLtms = (content.ltm_entries || []).filter(function(e) {
        return e.status === 'closed' && !e.parent_meta_ltm;
    });
    if (closedLtms.length < getMetaLtmThreshold()) return [];

    // 按 timestamp 升序，取最早的（先整合旧的）
    closedLtms.sort(function(a, b) {
        return (a.timestamp || 0) - (b.timestamp || 0);
    });

    var openMeta = findOpenMetaLtm(vault);
    var batchSize = openMeta ? Math.max(1, MAX_OPEN_LTM_REFS - (openMeta.ltm_refs || []).length) : MAX_OPEN_LTM_REFS;
    return closedLtms.slice(0, Math.min(batchSize, closedLtms.length)).map(function(e) { return e.id; });
}

function deriveMetaTimeRange(sourceLtmEntries) {
    var timed = sourceLtmEntries.filter(function(l) { return l.time_range; });
    if (timed.length === 0) return null;
    if (timed.length === 1) return timed[0].time_range;
    return (timed[0].time_range || '') + ' → ' + (timed[timed.length - 1].time_range || '');
}

function formatMetaLtmCatalog(metaLtmEntries) {
    var closedMetas = (metaLtmEntries || []).filter(function(e) { return e.status !== 'open'; });
    var recent = closedMetas.slice(-5);
    if (recent.length === 0) return '(无)';
    return recent.map(function(e) {
        return '- [' + (e.title || e.event || '').substring(0, 60) + '] ' + (e.period || '') + ' (' + (e.arc_count || (e.ltm_refs || []).length) + ' 弧)';
    }).join('\n');
}

// ─── Prompt 构建 ───────────────────────────────────────────────

function buildMetaLtmPrompt(vault, candidateLtms) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var openMeta = findOpenMetaLtm(vault);
    var closedCatalog = formatMetaLtmCatalog(content.meta_ltm_entries || []);

    var ctx = '';

    ctx += '\n\n## 当前进行中的 Meta-LTM（跨弧摘要，开放）\n';
    if (openMeta) {
        ctx += 'title: ' + (openMeta.title || '') + '\n';
        ctx += 'event: ' + (openMeta.event || '').substring(0, 200) + '\n';
        ctx += 'ltm_refs 数量: ' + ((openMeta.ltm_refs || []).length) + '\n';
        ctx += 'arc_count: ' + (openMeta.arc_count || (openMeta.ltm_refs || []).length) + '\n';
    } else {
        ctx += '(无)\n';
    }

    ctx += '\n## 最近已闭合的 Meta-LTM\n' + closedCatalog + '\n';

    ctx += '\n## 待整合的已闭合叙事弧（LTM）\n';
    for (var i = 0; i < candidateLtms.length; i++) {
        var l = candidateLtms[i];
        ctx += '- ' + (l.id || '?') + ': ' + (l.title || l.event || '') + '\n';
        if (l.period) ctx += '  时间: ' + l.period + '\n';
        if (l.event) ctx += '  摘要: ' + l.event.substring(0, 120) + '\n';
    }

    ctx += '\n## 判断标准\n';
    ctx += 'append（追加到当前 Meta-LTM）：当新弧与当前 Meta-LTM 在宏观叙事上属于同一"卷"或"章" —— 时间跨度相邻、主题/角色群有延续。\n';
    ctx += '  无需填写 updated_title/updated_event（留空 ""）—— 开放 Meta-LTM 使用占位符。\n';
    ctx += 'close_and_new（闭合+开启新 Meta-LTM）：当前 Meta-LTM 已覆盖足够多的弧（如一卷已完结），或新弧在主题/时间上与当前 Meta-LTM 脱节。\n';
    ctx += '  此时 updated_title/updated_event 为刚闭合的 Meta-LTM 撰写跨弧标题（15-40字）和跨弧摘要（100-200字），宏观总结这条已完结的跨弧内容。\n';

    if (lang === 'en') {
        ctx += '\nOutput JSON with meta_ltm_decision field:\n{\n  "meta_ltm_decision": {\n    "action": "append" | "close_and_new",\n    "updated_title": "append: leave empty \\"\\"; close_and_new: fill cross-arc title (15-40 chars)",\n    "updated_event": "append: leave empty \\"\\"; close_and_new: fill cross-arc summary (100-200 chars)"\n  }\n}\n';
        return {
            system: 'You are a cross-arc narrative summarizer. Given the current Meta-LTM state and newly closed story arcs, decide how to update the meta-level summary.\n\n' +
                'Only output valid JSON with the meta_ltm_decision field — no surrounding text.\n\n' + ctx,
            user: 'Based on the Meta-LTM state and newly closed LTM arcs above, output the meta_ltm_decision.'
        };
    }

    ctx += '\n输出 JSON，包含 meta_ltm_decision 字段：\n{\n  "meta_ltm_decision": {\n    "action": "append" | "close_and_new",\n    "updated_title": "append时留空\\"\\"；close_and_new时为刚闭合的 Meta-LTM 填写跨弧标题（15-40字）",\n    "updated_event": "append时留空\\"\\"；close_and_new时为刚闭合的 Meta-LTM 填写跨弧摘要（100-200字）"\n  }\n}\n';
    return {
        system: '你是跨弧叙事摘要者。根据当前 Meta-LTM 状态和新闭合的叙事弧，决定如何更新跨弧摘要。\n\n' +
            '只输出包含 meta_ltm_decision 字段的有效 JSON，不要输出任何其他文字。\n\n' + ctx,
        user: '根据上述 Meta-LTM 状态和新闭合的 LTM 弧，输出 meta_ltm_decision。'
    };
}

// ─── LLM 调用 + 校验 ──────────────────────────────────────────

async function runMetaLtmDecision(vault, candidateLtmIds, callMemoryPipeline) {
    var allLtm = vault.content.ltm_entries || [];
    var candidateLtms = candidateLtmIds.map(function(id) {
        return allLtm.find(function(l) { return l.id === id; });
    }).filter(Boolean);
    if (candidateLtms.length === 0) return null;

    var prompt = buildMetaLtmPrompt(vault, candidateLtms);
    var responseText = '';
    try {
        responseText = await callMemoryPipeline([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ], { operation: 'meta_ltm_decision' }, vault.id);
    } catch (e) {
        console.warn('[NE Meta-LTM] decision LLM failed:', e.message);
        return null;
    }

    if (!responseText || !responseText.trim()) {
        console.warn('[NE Meta-LTM] decision LLM returned empty response');
        return null;
    }

    var parsed = safeJsonParse(responseText);
    if (parsed) {
        var result = parsed.meta_ltm_decision || null;
        if (result) {
            result = validateMetaLtmDecision(result);
            if (!result) {
                console.warn('[NE Meta-LTM] decision action invalid, retrying once');
                try {
                    responseText = await callMemoryPipeline([
                        { role: 'system', content: prompt.system + '\n\n错误：上一轮的 action 值无效。action 必须是 "append" 或 "close_and_new"。' },
                        { role: 'user', content: prompt.user }
                    ], { operation: 'meta_ltm_decision_retry' }, vault.id);
                    var parsed2 = safeJsonParse(responseText);
                    if (parsed2) {
                        result = parsed2.meta_ltm_decision || null;
                        if (result) result = validateMetaLtmDecision(result);
                    }
                } catch (e2) {
                    console.warn('[NE Meta-LTM] decision retry failed:', e2.message);
                    return null;
                }
                if (!result) {
                    console.warn('[NE Meta-LTM] decision retry also invalid, abandoning');
                    return null;
                }
            }
        }
        return result;
    }
    console.warn('[NE Meta-LTM] decision LLM returned non-JSON response');
    return null;
}

// ─── 决策应用 ─────────────────────────────────────────────────

function applyMetaLtmDecision(vault, decision, candidateLtmIds) {
    if (!decision) return false;

    var content = vault.content || {};
    var action = decision.action;
    var updatedTitle = decision.updated_title || '';
    var updatedEvent = decision.updated_event || '';

    var openMeta = findOpenMetaLtm(vault);
    var allLtm = content.ltm_entries || [];
    var sourceLtms = allLtm.filter(function(l) { return candidateLtmIds.indexOf(l.id) !== -1; });

    if (action === 'close_and_new') {
        if (openMeta) {
            if (updatedTitle) openMeta.title = updatedTitle;
            if (updatedEvent) openMeta.event = updatedEvent;
            openMeta.status = 'closed';
        }
        openMeta = null;
        updatedTitle = '';
        updatedEvent = '';
        action = 'append';
    }

    if (action === 'append') {
        if (!openMeta) {
            openMeta = {
                id: findNextMetaId(vault),
                status: 'open',
                ltm_refs: [],
                title: updatedTitle || '',
                event: updatedEvent || '',
                period: '',
                time_range: null,
                present_characters: [],
                timestamp: Date.now(),
                level: 1,
                arc_count: 0
            };
            content.meta_ltm_entries = content.meta_ltm_entries || [];
            content.meta_ltm_entries.push(openMeta);
        }

        // 追加 LTM refs
        openMeta.ltm_refs = (openMeta.ltm_refs || []).concat(candidateLtmIds);
        if (updatedTitle) openMeta.title = updatedTitle;
        if (updatedEvent) openMeta.event = updatedEvent;

        // 派生 time_range
        var allReferenced = allLtm.filter(function(l) {
            return (openMeta.ltm_refs || []).indexOf(l.id) !== -1;
        });
        openMeta.time_range = deriveMetaTimeRange(allReferenced);

        // 更新 timestamp
        var maxTs = 0;
        sourceLtms.forEach(function(l) { if (l.timestamp && l.timestamp > maxTs) maxTs = l.timestamp; });
        openMeta.timestamp = maxTs || Date.now();

        // 合并 present_characters
        var entities = [];
        var seen = {};
        (openMeta.present_characters || []).forEach(function(n) { if (!seen[n]) { entities.push(n); seen[n] = true; } });
        sourceLtms.forEach(function(l) {
            (l.present_characters || []).forEach(function(n) {
                if (!seen[n]) { entities.push(n); seen[n] = true; }
            });
        });
        openMeta.present_characters = entities;
        openMeta.arc_count = (openMeta.ltm_refs || []).length;

        // 标记 LTM 的 parent_meta_ltm（反向指针）
        candidateLtmIds.forEach(function(ltmId) {
            var ltm = allLtm.find(function(l) { return l.id === ltmId; });
            if (ltm) ltm.parent_meta_ltm = openMeta.id;
        });

        // 达到上限自动闭合
        if ((openMeta.ltm_refs || []).length >= MAX_OPEN_LTM_REFS) {
            openMeta.status = 'closed';
        }
    }

    return true;
}

// ─── 主入口 ───────────────────────────────────────────────────

/**
 * 触发 Meta-LTM 跨弧摘要（如有必要）。
 * 闭合 LTM 数 >= metaLtmThreshold 时触发。
 *
 * @param {string} chatId
 * @param {object} vault - 已加载的 vault（会被原地修改）
 * @param {function} callMemoryPipeline - LLM 调用通道
 * @returns {Promise<boolean>} 是否实际产生 Meta-LTM 变更
 */
export async function checkMetaResummary(chatId, vault, callMemoryPipeline) {
    if (!vault || !vault.content) return false;

    var candidateLtmIds = getCandidateLtmIds(vault);
    if (candidateLtmIds.length === 0) return false;

    console.log('[NE Meta-LTM] Triggering cross-arc summary for', candidateLtmIds.length, 'closed LTM(s)');

    var decision = await runMetaLtmDecision(vault, candidateLtmIds, callMemoryPipeline);
    if (!decision) {
        console.warn('[NE Meta-LTM] No valid decision, skipping');
        return false;
    }

    var changed = applyMetaLtmDecision(vault, decision, candidateLtmIds);
    if (changed) {
        console.log('[NE Meta-LTM] Applied decision:', decision.action, '→ meta_ltm_entries count:', (vault.content.meta_ltm_entries || []).length);
    }
    return changed;
}
