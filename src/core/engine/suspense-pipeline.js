/**
 * engine/suspense-pipeline.js — 悬念簿（计划-核销闭环）管线
 *
 * 从 STM 事件条目中自动检测叙事钩子（伏笔/悬念/威胁/承诺），
 * 追踪其生命周期（raise → develop → resolve/abandon）。
 *
 * 设计要点：
 *   - 条目自足：钩子包含足够信息，不加载对应摘要/原文
 *   - 全量注入 open 钩子（在 injection.js 的 buildSuspenseOverview 中实现）
 *   - 不参与检索打分（与 Meta-LTM 一致，仅参与注入）
 *   - 多决策：单次 LLM 调用返回多个操作（raise + resolve 可同时发生）
 *   - 游标机制：suspense_cursor 追踪最后处理的 STM id，避免重复检查
 *   - 默认关闭，设置开关 suspenseLedgerEnabled 控制
 *   - 统计分类 tok_consolidate（与 LTM/Meta-LTM 共用）
 *
 * 参考 meta-ltm-pipeline.js 的 checkMetaResummary / buildMetaLtmPrompt 模式。
 */

import { safeJsonParse } from './json-fallback.js';
import { validateSuspenseDecisions } from './validate.js';

var MAX_RESOLVED_CATALOG = 5;

// ─── 工具函数 ──────────────────────────────────────────────────

function findNextSuspenseId(vault) {
    var content = vault.content || {};
    var max = 0;
    (content.suspense_entries || []).forEach(function(e) {
        var num = parseInt(String(e.id || '').replace('suspense_', ''), 10);
        if (num > max) max = num;
    });
    return 'suspense_' + (max + 1);
}

function findOpenSuspense(vault) {
    var content = vault.content || {};
    return (content.suspense_entries || []).filter(function(e) { return e.status === 'open'; });
}

function formatOpenHooks(entries) {
    var open = entries.filter(function(e) { return e.status === 'open'; });
    if (open.length === 0) return '(无)';
    return open.map(function(e) {
        var line = '- ' + (e.id || '?') + ' [' + (e.category || 'unknown') + '] ' + (e.title || '') + ': ' + (e.event || '');
        if (e.raised_at_period) line += '\n  来源: ' + e.raised_at_period;
        if (e.present_characters && e.present_characters.length) line += '\n  角色: ' + e.present_characters.join(', ');
        return line;
    }).join('\n');
}

function formatResolvedCatalog(entries) {
    var resolved = entries.filter(function(e) { return e.status === 'resolved'; })
        .sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); })
        .slice(0, MAX_RESOLVED_CATALOG);
    if (resolved.length === 0) return '(无)';
    return resolved.map(function(e) {
        return '- [' + (e.title || '') + '] (' + (e.resolved_at_period || e.raised_at_period || '') + ')';
    }).join('\n');
}

/**
 * 获取游标之后的新 STM 条目（按 id 数值升序）。
 * 若游标超过现有 STM（回滚场景），返回空数组。
 */
function getNewStmEntries(vault) {
    var content = vault.content || {};
    var stmEntries = content.stm_entries || [];
    var cursor = content.suspense_cursor;

    var cursorNum = 0;
    if (cursor) {
        cursorNum = parseInt(String(cursor).replace('stm_', ''), 10) || 0;
    }

    var newEntries = stmEntries.filter(function(e) {
        var num = parseInt(String(e.id || '').replace('stm_', ''), 10) || 0;
        return num > cursorNum;
    }).sort(function(a, b) {
        var na = parseInt(String(a.id || '').replace('stm_', ''), 10) || 0;
        var nb = parseInt(String(b.id || '').replace('stm_', ''), 10) || 0;
        return na - nb;
    });

    return newEntries;
}

function updateSuspenseCursor(vault, lastStmId) {
    if (!vault.content) vault.content = {};
    vault.content.suspense_cursor = lastStmId;
}

function derivePeriodFromStm(stmEntry) {
    if (!stmEntry) return '';
    if (stmEntry.period) return stmEntry.period;
    if (stmEntry.scene) return stmEntry.scene;
    return '';
}

function mergeCharacters(existing, fromStm) {
    var result = [];
    var seen = {};
    (existing || []).forEach(function(n) { if (!seen[n]) { result.push(n); seen[n] = true; } });
    (fromStm || []).forEach(function(n) { if (!seen[n]) { result.push(n); seen[n] = true; } });
    return result;
}

// ─── Prompt 构建 ───────────────────────────────────────────────

function buildSuspensePrompt(vault, newStmEntries) {
    var content = vault.content || {};
    var lang = content.language === 'en' ? 'en' : 'zh';

    var openHooks = findOpenSuspense(vault);
    var allEntries = content.suspense_entries || [];
    var resolvedCatalog = formatResolvedCatalog(allEntries);

    var ctx = '';

    ctx += '\n\n## 当前开放的悬念钩子\n';
    ctx += formatOpenHooks(allEntries);

    ctx += '\n\n## 最近已兑现的悬念\n' + resolvedCatalog + '\n';

    ctx += '\n## 新增 STM 事件\n';
    for (var i = 0; i < newStmEntries.length; i++) {
        var s = newStmEntries[i];
        ctx += '- ' + (s.id || '?') + ' [' + (s.period || '') + (s.scene ? ' · ' + s.scene : '') + '] ' + (s.event || '') + '\n';
        if (s.present_characters && s.present_characters.length) ctx += '  角色: ' + s.present_characters.join(', ') + '\n';
    }

    ctx += '\n## 判断标准\n';
    ctx += 'raise（抛出悬念）: 新 STM 事件中出现了值得追踪的伏笔/悬念/未解之谜/威胁/承诺。需要填写 title（15-40字简短标题）、event（80-140字描述悬念内容、为什么重要、关键约束）、category（mystery/threat/promise/foreshadow）、stm_ref（来源 STM id）、present_characters。\n';
    ctx += 'develop（发展悬念）: 新 STM 事件为已有开放悬念提供了新线索/新发展。需要填写 hook_id 和 stm_ref。\n';
    ctx += 'resolve（兑现悬念）: 新 STM 事件中已有悬念被明确解答/兑现。需要填写 hook_id 和 resolution_note（简述如何兑现）。\n';
    ctx += 'abandon（放弃悬念）: 故事已明显越过该悬念，不再相关。需要填写 hook_id。\n';
    ctx += '无悬念活动时返回空数组 []。\n';

    if (lang === 'en') {
        ctx += '\nOutput JSON with suspense_decisions field:\n{\n  "suspense_decisions": [\n    { "action": "raise", "title": "...", "event": "...", "category": "mystery|threat|promise|foreshadow", "stm_ref": "stm_N", "present_characters": ["..."] },\n    { "action": "develop", "hook_id": "suspense_N", "stm_ref": "stm_N" },\n    { "action": "resolve", "hook_id": "suspense_N", "resolution_note": "..." },\n    { "action": "abandon", "hook_id": "suspense_N" }\n  ]\n}\nReturn empty array [] if no hook activity.\n';
        return {
            system: 'You are a narrative suspense tracker. Based on new STM events and currently open hooks, decide whether to raise, develop, resolve, or abandon narrative hooks.\n\n' +
                'Only output valid JSON with the suspense_decisions field — no surrounding text.\n\n' + ctx,
            user: 'Based on the STM events and open hooks above, output the suspense_decisions.'
        };
    }

    ctx += '\n输出 JSON，包含 suspense_decisions 字段：\n{\n  "suspense_decisions": [\n    { "action": "raise", "title": "...", "event": "...", "category": "mystery|threat|promise|foreshadow", "stm_ref": "stm_N", "present_characters": ["..."] },\n    { "action": "develop", "hook_id": "suspense_N", "stm_ref": "stm_N" },\n    { "action": "resolve", "hook_id": "suspense_N", "resolution_note": "..." },\n    { "action": "abandon", "hook_id": "suspense_N" }\n  ]\n}\n无悬念活动时返回空数组 []。\n';
    return {
        system: '你是叙事悬念追踪者。根据新 STM 事件和当前开放悬念，判断是否需要新增、发展或闭合钩子。\n\n' +
            '只输出包含 suspense_decisions 字段的有效 JSON，不要输出任何其他文字。\n\n' + ctx,
        user: '根据上述 STM 事件和开放悬念，输出 suspense_decisions。'
    };
}

// ─── LLM 调用 + 校验 ──────────────────────────────────────────

async function runSuspenseDecision(vault, newStmEntries, callMemoryPipeline) {
    if (newStmEntries.length === 0) return [];

    var prompt = buildSuspensePrompt(vault, newStmEntries);
    var responseText = '';
    try {
        responseText = await callMemoryPipeline([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ], { operation: 'suspense_extract' }, vault.id);
    } catch (e) {
        console.warn('[NE Suspense] decision LLM failed:', e.message);
        return null;
    }

    if (!responseText || !responseText.trim()) {
        console.warn('[NE Suspense] decision LLM returned empty response');
        return null;
    }

    var parsed = safeJsonParse(responseText);
    if (parsed) {
        var decisions = parsed.suspense_decisions || null;
        if (decisions !== null) {
            decisions = validateSuspenseDecisions(decisions);
            if (decisions === null) {
                console.warn('[NE Suspense] decisions invalid, retrying once');
                try {
                    responseText = await callMemoryPipeline([
                        { role: 'system', content: prompt.system + '\n\n错误：上一轮的 decisions 格式无效。action 必须是 "raise"、"develop"、"resolve" 或 "abandon"。' },
                        { role: 'user', content: prompt.user }
                    ], { operation: 'suspense_extract_retry' }, vault.id);
                    var parsed2 = safeJsonParse(responseText);
                    if (parsed2) {
                        decisions = parsed2.suspense_decisions || null;
                        if (decisions !== null) decisions = validateSuspenseDecisions(decisions);
                    }
                } catch (e2) {
                    console.warn('[NE Suspense] decision retry failed:', e2.message);
                    return null;
                }
                if (decisions === null) {
                    console.warn('[NE Suspense] decision retry also invalid, abandoning');
                    return null;
                }
            }
        }
        return decisions;
    }
    console.warn('[NE Suspense] decision LLM returned non-JSON response');
    return null;
}

// ─── 决策应用 ─────────────────────────────────────────────────

function applySuspenseDecisions(vault, decisions, newStmEntries) {
    if (!decisions || decisions.length === 0) return false;

    var content = vault.content || {};
    if (!content.suspense_entries) content.suspense_entries = [];

    var stmMap = {};
    (content.stm_entries || []).forEach(function(s) { stmMap[s.id] = s; });

    var changed = false;

    for (var i = 0; i < decisions.length; i++) {
        var d = decisions[i];
        var action = d.action;

        if (action === 'raise') {
            var stmRef = d.stm_ref || (newStmEntries[0] && newStmEntries[0].id) || '';
            var sourceStm = stmMap[stmRef] || newStmEntries.find(function(s) { return s.id === stmRef; });
            var hook = {
                id: findNextSuspenseId(vault),
                status: 'open',
                title: d.title || '未命名悬念',
                event: d.event || '',
                category: d.category || 'mystery',
                stm_refs: stmRef ? [stmRef] : [],
                resolution_note: null,
                raised_at_period: derivePeriodFromStm(sourceStm),
                resolved_at_period: null,
                present_characters: d.present_characters || (sourceStm ? (sourceStm.present_characters || []) : []),
                timestamp: Date.now(),
                level: 1
            };
            content.suspense_entries.push(hook);
            changed = true;
            console.log('[NE Suspense] Raised hook:', hook.id, hook.title);

        } else if (action === 'develop') {
            var hookEntry = content.suspense_entries.find(function(e) { return e.id === d.hook_id && e.status === 'open'; });
            if (hookEntry) {
                var devStmRef = d.stm_ref || '';
                if (devStmRef && hookEntry.stm_refs.indexOf(devStmRef) === -1) {
                    hookEntry.stm_refs.push(devStmRef);
                }
                var devStm = stmMap[devStmRef];
                if (devStm) {
                    hookEntry.present_characters = mergeCharacters(hookEntry.present_characters, devStm.present_characters);
                }
                changed = true;
                console.log('[NE Suspense] Developed hook:', d.hook_id);
            }

        } else if (action === 'resolve') {
            var resolveEntry = content.suspense_entries.find(function(e) { return e.id === d.hook_id && e.status === 'open'; });
            if (resolveEntry) {
                resolveEntry.status = 'resolved';
                resolveEntry.resolution_note = d.resolution_note || '';
                var resolveStm = stmMap[d.stm_ref || ''] || (newStmEntries.length > 0 ? newStmEntries[newStmEntries.length - 1] : null);
                resolveEntry.resolved_at_period = derivePeriodFromStm(resolveStm);
                var resolveTs = resolveStm && resolveStm.timestamp;
                if (resolveTs) resolveEntry.timestamp = resolveTs;
                changed = true;
                console.log('[NE Suspense] Resolved hook:', d.hook_id);
            }

        } else if (action === 'abandon') {
            var abandonEntry = content.suspense_entries.find(function(e) { return e.id === d.hook_id && e.status === 'open'; });
            if (abandonEntry) {
                abandonEntry.status = 'abandoned';
                changed = true;
                console.log('[NE Suspense] Abandoned hook:', d.hook_id);
            }
        }
    }

    return changed;
}

// ─── 主入口 ───────────────────────────────────────────────────

/**
 * 触发悬念簿更新（如有必要）。
 * 检查是否有新的 STM 条目需要分析，如有则调用 LLM 提取钩子决策。
 *
 * @param {string} chatId
 * @param {object} vault - 已加载的 vault（会被原地修改）
 * @param {function} callMemoryPipeline - LLM 调用通道
 * @returns {Promise<boolean>} 是否实际产生悬念簿变更
 */
export async function checkSuspenseUpdate(chatId, vault, callMemoryPipeline) {
    if (!vault || !vault.content) return false;

    var newStmEntries = getNewStmEntries(vault);
    if (newStmEntries.length === 0) return false;

    console.log('[NE Suspense] Checking', newStmEntries.length, 'new STM entries for hooks');

    var decisions = await runSuspenseDecision(vault, newStmEntries, callMemoryPipeline);

    // 无论 decisions 是否为 null/空数组，都更新游标（避免重复检查同批 STM）
    updateSuspenseCursor(vault, newStmEntries[newStmEntries.length - 1].id);

    if (decisions === null) {
        console.warn('[NE Suspense] No valid decisions, cursor advanced only');
        return false;
    }

    var changed = applySuspenseDecisions(vault, decisions, newStmEntries);
    if (changed) {
        console.log('[NE Suspense] Applied', decisions.length, 'decision(s) → suspense_entries count:', (vault.content.suspense_entries || []).length);
    }
    return changed;
}

// ─── 导出工具函数（供测试使用） ────────────────────────────────

export { findNextSuspenseId, findOpenSuspense, getNewStmEntries, updateSuspenseCursor };
