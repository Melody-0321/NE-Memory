/**
 * engine/suspense-pipeline.js — 悬念簿（计划-核销闭环）管线
 *
 * 从 STM 事件条目中自动检测叙事钩子（计划/悬念），
 * 追踪其生命周期（raise → develop → resolve）。
 * 检测规则对齐柏宝书 plans 领域：跨场景存活测试 + 类型准入 +
 * 排除清单（禁止把设定/心境/伪悬念写成钩子）。
 *
 * 设计要点：
 *   - 条目自足：钩子包含足够信息，不加载对应摘要/原文
 *   - 全量注入 open 钩子（在 injection.js 的 buildSuspenseOverview 中实现）
 *   - 不参与检索打分（与 Meta-LTM 一致，仅参与注入）
 *   - 多决策：单次 LLM 调用返回多个操作（raise + resolve 可同时发生）
 *   - 核销语义：resolve 必须带 outcome（done/cancelled/failed）+ reason，
 *     悬念不因时间流逝自动消失
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
        var outcomeLabel = e.outcome || 'done';
        return '- [' + (e.title || '') + '] (' + outcomeLabel + ') (' + (e.resolved_at_period || e.raised_at_period || '') + ')';
    }).join('\n');
}

/**
 * 获取游标之后的新 STM 条目（按 id 数值升序）。
 * 同时扫描 unconsolidated_stm + stm_entries（按 id 去重），
 * 使悬念检测紧跟 STM 提取，不依赖 LTM 合并节奏。
 * 若游标超过现有 STM（回滚场景），返回空数组。
 */
function getNewStmEntries(vault) {
    var content = vault.content || {};
    var cursor = content.suspense_cursor;

    var cursorNum = 0;
    if (cursor) {
        cursorNum = parseInt(String(cursor).replace('stm_', ''), 10) || 0;
    }

    var seen = {};
    var allStm = [];
    (content.unconsolidated_stm || []).forEach(function(e) {
        if (e && e.id && !seen[e.id]) { seen[e.id] = true; allStm.push(e); }
    });
    (content.stm_entries || []).forEach(function(e) {
        if (e && e.id && !seen[e.id]) { seen[e.id] = true; allStm.push(e); }
    });

    var newEntries = allStm.filter(function(e) {
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

    ctx += '\n\n## 最近已了结的钩子\n' + resolvedCatalog + '\n';

    ctx += '\n## 新增 STM 事件\n';
    for (var i = 0; i < newStmEntries.length; i++) {
        var s = newStmEntries[i];
        ctx += '- ' + (s.id || '?') + ' [' + (s.period || '') + (s.scene ? ' · ' + s.scene : '') + '] ' + (s.event || '') + '\n';
        if (s.present_characters && s.present_characters.length) ctx += '  角色: ' + s.present_characters.join(', ') + '\n';
    }

    ctx += '\n## 判断标准\n';
    ctx += '钩子分两类：plan（计划）= 行动主体真心决定/承诺/约定要做的未来行动；suspense（悬念）= 待揭晓事实或已启动的外部事件。\n';
    ctx += '共同铁律：【默认不写】。只有必须被长期记住、否则会损害后续剧情的事才记录。绝大多数 STM 批次不产生任何 raise。\n';
    ctx += '\n### raise（新增钩子）—— 必须依次通过三道关卡，缺一不可：\n';
    ctx += '1. 跨场景存活测试：问"这件事会在接下来一两个回合的自然推进里得到结果吗？" 会 → 不写，它只是当前还没写完的剧情。只有需要【时间跨度】或【外部条件】才能解决的事才可能进入。\n';
    ctx += '   反例（很快兑现，一律不写）：犹豫要不要表白、有人敲门、对方欲言又止、检定待揭晓、"他会怎么回答"、普通寒暄约饭。\n';
    ctx += '   正例（跨得过当前场景才考虑）：三日后决斗、毒药七天后发作、铁匠承诺改日打造武器、某组织正在暗中追查。\n';
    ctx += '2. 类型准入测试：plan 必须来自正文明确写出的真心承诺（有具体对象/时间/条件，不是敷衍客套）；suspense 只允许两类——A.待揭晓事实（正文留下未知的身份/动机/来源/去向/真相，有具体线索）；B.已启动外部事件（追捕已展开、毒药已进入倒计时、触发条件已成立）。\n';
    ctx += '3. 排除清单：以下内容即使重要也【绝非钩子】，不得 raise——已解释清楚的世界观设定/机制、伤势诅咒等持续状态、人物内心挣扎/感情纠葛/身份矛盾、关系张力、"存在弱点""可能被利用""构成潜在威胁""埋下隐患""矛盾将持续"、仅"X会不会Y？""将如何收场？"的万能疑问。这些应留在 STM/summary，不得包装成钩子。\n';
    ctx += '新增前查重：把候选与当前开放的钩子归一为"等待揭晓的答案"或"等待结果的同一个事件"，若本质相同 → 不 add，新线索只写 develop。已了结的禁止换个说法重新 add。\n';
    ctx += '核销预检：新增前必须能设想未来如何 resolve——必须能写成"未知答案揭晓为…"或"已启动事件的结果为…"。只能写"这种状态后来消失/改变了"的 → 不是钩子，不写。\n';
    ctx += 'raise 需填写：title（15-40字简短标题）、event（80-140字客观写出已知关键事实+精确未决点，禁止抒情和"潜在威胁"式收尾）、category（plan 或 suspense）、stm_ref（来源 STM id）、present_characters。\n';
    ctx += '\n### develop（发展钩子）: 新 STM 事件为已有开放钩子提供了新线索/新发展。填写 hook_id 和 stm_ref。\n';
    ctx += '\n### resolve（核销钩子）: 只有文本明确说明此事已解决/揭晓/兑现/推翻/撤销/彻底不可能再发生时才能 resolve。悬念不因时间流逝自动消失。填写 hook_id、outcome、resolution_note。\n';
    ctx += 'outcome 三选一，务必分清：\n';
    ctx += '  · done = 计划真兑现了 / 悬念真揭晓了（结果/答案已明确）；\n';
    ctx += '  · cancelled = 没做成，而是被取消/撤回/放弃/作废/当场化解（对方收回要求、情势变了、不了了之）；\n';
    ctx += '  · failed = 尝试过但失败，或悬念以坏结局收场。\n';
    ctx += '注意最易错的坑：一件事"被提出后又当场化解、对方退让、不了了之" → 这是 cancelled，绝不是 done。resolution_note 必填一句"如何了结/为什么了结"。\n';
    ctx += '无钩子活动时返回空数组 []。\n';

    if (lang === 'en') {
        ctx += '\nOutput JSON with suspense_decisions field:\n{\n  "suspense_decisions": [\n    { "action": "raise", "title": "...", "event": "...", "category": "plan|suspense", "stm_ref": "stm_N", "present_characters": ["..."] },\n    { "action": "develop", "hook_id": "suspense_N", "stm_ref": "stm_N" },\n    { "action": "resolve", "hook_id": "suspense_N", "outcome": "done|cancelled|failed", "resolution_note": "..." }\n  ]\n}\nReturn empty array [] if no hook activity.\n';
        return {
            system: 'You are a narrative suspense tracker. Based on new STM events and currently open hooks, decide whether to raise, develop, or resolve hooks. Apply the strict admission rules before raising any hook.\n\n' +
                'Only output valid JSON with the suspense_decisions field — no surrounding text.\n\n' + ctx,
            user: 'Based on the STM events and open hooks above, output the suspense_decisions.'
        };
    }

    ctx += '\n输出 JSON，包含 suspense_decisions 字段：\n{\n  "suspense_decisions": [\n    { "action": "raise", "title": "...", "event": "...", "category": "plan|suspense", "stm_ref": "stm_N", "present_characters": ["..."] },\n    { "action": "develop", "hook_id": "suspense_N", "stm_ref": "stm_N" },\n    { "action": "resolve", "hook_id": "suspense_N", "outcome": "done|cancelled|failed", "resolution_note": "..." }\n  ]\n}\n无钩子活动时返回空数组 []。\n';
    return {
        system: '你是叙事悬念追踪者。根据新 STM 事件和当前开放钩子，判断是否需要新增、发展或核销钩子。新增钩子前必须严格执行三道准入关卡（跨场景存活测试、类型准入测试、排除清单），避免把剧情笔记、心境档案和伪悬念写进簿子。\n\n' +
            '只输出包含 suspense_decisions 字段的有效 JSON，不要输出任何其他文字。\n\n' + ctx,
        user: '根据上述 STM 事件和开放钩子，输出 suspense_decisions。'
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
                        { role: 'system', content: prompt.system + '\n\n错误：上一轮的 decisions 格式无效。action 必须是 "raise"、"develop" 或 "resolve"；resolve 需带 outcome（done/cancelled/failed）。' },
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
                title: d.title || '未命名钩子',
                event: d.event || '',
                category: d.category || 'suspense',
                stm_refs: stmRef ? [stmRef] : [],
                resolution_note: null,
                outcome: null,
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
                resolveEntry.outcome = d.outcome || 'done';
                var resolveStm = stmMap[d.stm_ref || ''] || (newStmEntries.length > 0 ? newStmEntries[newStmEntries.length - 1] : null);
                resolveEntry.resolved_at_period = derivePeriodFromStm(resolveStm);
                var resolveTs = resolveStm && resolveStm.timestamp;
                if (resolveTs) resolveEntry.timestamp = resolveTs;
                changed = true;
                console.log('[NE Suspense] Resolved hook (' + resolveEntry.outcome + '):', d.hook_id);
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
