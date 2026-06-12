/**
 * engine/consolidate.js — STM→LTM 整合引擎
 *
 * 当 unconsolidated_stm 达到阈值时触发。
 * 生成 LTM 摘要，标记原始 STM，不删除。
 * 这是 NE 最核心的差异化功能。
 */
import { callMemoryLLM, callMemoryPipeline, recordTelemetry } from '../api/llm.js';
import { validateLTMOutput, postFillLTM } from './validate.js';

function findNextId(vault) {
    const content = vault.content || {};
    let max = 0;
    (content.ltm_entries || []).forEach(e => {
        const num = parseInt(String(e.id || '').replace('ltm_', ''), 10);
        if (num > max) max = num;
    });
    return 'ltm_' + (max + 1);
}

export function checkConsolidateThreshold(vault) {
    const content = vault.content || {};
    var maxUnconsolidated = 5;
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            maxUnconsolidated = Number(s.stmMaxUnconsolidated) || 5;
        }
    } catch (e) {}
    const unconsolidated = (content.unconsolidated_stm || []).filter(stm => !stm.parent_ltm);
    return unconsolidated.length >= maxUnconsolidated;
}

export function buildConsolidatePrompt(vault) {
    const content = vault.content || {};
    const lang = content.language === 'en' ? 'en' : 'zh';
    const ltmEntries = content.ltm_entries || [];
    const unconsolidated = (content.unconsolidated_stm || []).filter(stm => !stm.parent_ltm);
    const ltmText = ltmEntries.map((e, i) => {
        const refs = (e.stm_refs || []).join(', ');
        return `${i + 1}. [${e.period || ''}] ${e.scene || ''}: ${e.event || ''} [→${refs}]`;
    }).join('\n');
    const stmText = unconsolidated.map((e, i) => {
        const refs = (e.msg_ids || []).join(', ');
        return `${i + 1}. [${e.period || ''}] ${e.time_label ? e.time_label + '·' : ''}${e.scene || ''}: ${e.event || ''} [→${refs}]`;
    }).join('\n');

    if (lang === 'en') {
        return {
            system: `You are a long-term memory editor. Elevate multiple short-term memories (STM) into higher-level long-term memories (LTM).

Existing LTM:
${ltmText || '(none)'}

STM to consolidate (detail events describing continuous story segments):
${stmText}

Requirements:
1. Merge 3-8 consecutive STM entries into ONE LTM. NEVER do 1:1 mapping.
2. The LTM event is a high-level abstract summary — NOT a concatenation of STM details. Omit specific steps, procedure names, implant names.
3. event length: max 50 chars.

Output format (plain text, one LTM block separated by blank lines):
stm_refs: stm_X, stm_Y
period: time range (e.g. 2026-06-01 23:30 → 2026-06-02 02:10)
scene: scene name (1-2 words)
event: abstract summary (max 50 chars)

Example:
stm_refs: stm_1, stm_2, stm_3, stm_4, stm_5
period: Day 3 → Day 5
scene: Hospital
event: Alice and Bob treat Carol's injury at the hospital

IMPORTANT: Use character proper names. Do NOT output JSON.`,
            user: 'Elevate these STM entries into high-level LTM. Output plain text, not JSON.'
        };
    }
    return {
        system: `你是长期记忆编撰者。将多条短期记忆（STM）提升为更高抽象层的长期记忆（LTM）。

已有 LTM：
${ltmText || '(无)'}

待整合 STM（描述连续剧情的细节事件）：
${stmText}

要求：
1. 将 3~8 条时间或场景连续的 STM 合并为一条 LTM。禁止 1:1 映射。
2. LTM 的 event 是对合并内容的高层抽象概要，不是 STM 原文拼句。去掉具体步骤、手术名称、植入件名。
3. event 长度不超过 50 字。

输出格式（纯文本，空行分隔每个 LTM 块）：
stm_refs: stm_X, stm_Y
period: 时间范围（如 2026年6月1日 23:30 → 2026年6月2日 02:10）
scene: 场景名（1~2 词）
event: 抽象概要（最多50字）

示例：
stm_refs: stm_1, stm_2, stm_3, stm_4, stm_5
period: 2026年6月1日 23:30 → 2026年6月2日 01:30
scene: 长安殡仪馆
event: 江岚接收并处理了前女友苏蔓和邻居许瑶的遗体

重要：使用角色全名，禁止代词。不要输出 JSON。`,
        user: '将以下 STM 条目提升为高层 LTM。输出纯文本，不要 JSON。'
    };
}

function parseConsolidateText(text, stmIds) {
    var ltmEntries = [];
    var currentEntry = null;
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) {
            if (currentEntry && currentEntry.event) {
                ltmEntries.push(currentEntry);
                currentEntry = null;
            }
            continue;
        }
        var refMatch = line.match(/stm_refs?\s*[:：]\s*(.+)/i);
        if (refMatch) {
            if (currentEntry && currentEntry.event) {
                ltmEntries.push(currentEntry);
            }
            var refs = refMatch[1].split(/[,，\s]+/);
            var stmRefs = [];
            refs.forEach(function(r) {
                r = r.trim();
                if (r.indexOf('stm_') === 0) r = r;
                else r = 'stm_' + r;
                if (stmIds.indexOf(r) !== -1) stmRefs.push(r);
            });
            currentEntry = { stm_refs: stmRefs.length > 0 ? stmRefs : stmIds, period: '', scene: '', event: '' };
            continue;
        }
        if (!currentEntry) {
            currentEntry = { stm_refs: stmIds, period: '', scene: '', event: '' };
        }
        var periodMatch = line.match(/period\s*[:：]\s*(.+)/i);
        if (periodMatch) {
            currentEntry.period = periodMatch[1].trim().substring(0, 15);
            continue;
        }
        var sceneMatch = line.match(/scene\s*[:：]\s*(.+)/i);
        if (sceneMatch) {
            currentEntry.scene = sceneMatch[1].trim().substring(0, 20);
            continue;
        }
        var eventMatch = line.match(/event\s*[:：]\s*(.+)/i);
        if (eventMatch) {
            currentEntry.event = eventMatch[1].trim().substring(0, 50);
            continue;
        }
        if (line.length >= 3) {
            currentEntry.event = (currentEntry.event ? currentEntry.event + ' ' : '') + line;
        }
    }
    if (currentEntry && currentEntry.event) {
        ltmEntries.push(currentEntry);
    }
    if (ltmEntries.length === 0) {
        ltmEntries.push({ stm_refs: stmIds, period: '', scene: '', event: 'Consolidated STM ' + stmIds.join(', ') });
    }
    ltmEntries.forEach(function(e) { e.event = e.event.substring(0, 50).trim(); });
    return { ltm_entries: ltmEntries, delete_stm_ids: [] };
}

export function parseConsolidateResponse(llmResponse, stmIds) {
    try {
        const text = String(llmResponse || '').trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return JSON.parse(text);
    } catch (e) {
        console.warn('[NE] Consolidate JSON parse failed, using text fallback');
        return parseConsolidateText(llmResponse, stmIds || []);
    }
}

export function applyConsolidation(vault, consolidationResult) {
    const content = vault.content || {};
    content.stm_entries = content.stm_entries || [];
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);

    const ltmEntries = consolidationResult.ltm_entries || [];
    var assignedStmIds = {};
    ltmEntries.forEach(function(ltm) {
        ltm.stm_refs = (ltm.stm_refs || []).filter(function(sid) {
            if (assignedStmIds[sid]) return false;
            assignedStmIds[sid] = true;
            return true;
        });
    });
    ltmEntries.forEach(ltm => {
        if (!ltm.id) ltm.id = findNextId(vault);

        var sourceSTM = allSTM.filter(function(s) {
            return (ltm.stm_refs || []).indexOf(s.id) !== -1;
        });
        ltm.time_range = deriveTimeRange(sourceSTM);

        // 从源 STM 继承 entities（去重）
        var ltmEntities = sourceSTM.reduce(function(acc, s) {
            (s.entities || []).forEach(function(e) {
                if (!acc.find(function(a) { return a.name === e.name; })) {
                    acc.push({ name: e.name, type: e.type || 'character' });
                }
            });
            return acc;
        }, []);
        ltm.entities = ltmEntities;

        content.ltm_entries.push(ltm);
        (ltm.stm_refs || []).forEach(function(stmId) {
            if (vault.stm_index && vault.stm_index[stmId]) {
                vault.stm_index[stmId].ltm_id = ltm.id;
            }
            var found = allSTM.find(function(s) { return s.id === stmId; });
            if (found) found.parent_ltm = ltm.id;
        });
    });
    var unconsolidated = content.unconsolidated_stm || [];
    var consolidated = unconsolidated.filter(function (s) { return s.parent_ltm; });
    if (consolidated.length > 0) {
        content.stm_entries = (content.stm_entries || []).concat(consolidated);
        content.unconsolidated_stm = unconsolidated.filter(function (s) { return !s.parent_ltm; });
    }
    return ltmEntries.length;
}

function deriveTimeRange(sourceSTMEntries) {
    var timed = sourceSTMEntries.filter(function(s) {
        return (s.period || s.time_label);
    });

    if (timed.length === 0) return null;

    var first = timed[0];
    var last = timed[timed.length - 1];

    var fmt = function(s) {
        var parts = [];
        if (s.period) parts.push(s.period);
        if (s.time_label) parts.push(s.time_label);
        return parts.join('·');
    };

    if (timed.length === 1) return fmt(first);

    if (first.period === last.period) {
        if (first.time_label || last.time_label) {
            return first.period + ': ' + (first.time_label || '?') + ' → ' + (last.time_label || '?');
        }
        return first.period;
    }
    return fmt(first) + ' → ' + fmt(last);
}

export async function executeConsolidation(chatId) {
    const { read } = await import('../vault/store.js');
    const { saveVaultWithSnapshot } = await import('./update.js');
    const vault = await read(chatId);
    if (!checkConsolidateThreshold(vault)) return { vault, merged: 0 };
    const content = vault.content || {};
    const unconsolidated = (content.unconsolidated_stm || []).filter(stm => !stm.parent_ltm);
    const stmIds = unconsolidated.map(function(s) { return s.id; }).filter(Boolean);
    const prompt = buildConsolidatePrompt(vault);
    var response = await callMemoryPipeline([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
    var result = parseConsolidateResponse(response, stmIds);

    var validateErrors = validateLTMOutput(result);
    if (validateErrors.length > 0) {
        console.warn('[NE] LTM output validation failed, retrying:', validateErrors.join('; '));
        var retryMsg = validateErrors.join('; ') + '\n\nFix your output accordingly. Re-output ALL LTM entries. Plain text, not JSON.';
        var retryResponse = await callMemoryPipeline([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
            { role: 'assistant', content: response },
            { role: 'user', content: retryMsg }
        ]);
        result = parseConsolidateResponse(retryResponse, stmIds);
    }

    postFillLTM(result, unconsolidated);
    const merged = applyConsolidation(vault, result);
    if (merged > 0) {
        vault._meta = vault._meta || {};
        vault._meta.last_pipeline_task = 'consolidation';
        vault._meta.last_pipeline_time = new Date().toISOString();

        var stmInputCount = (content.unconsolidated_stm || []).filter(function(s) { return !s.parent_ltm; }).length;
        recordTelemetry({
            pipeline_task: 'consolidation',
            consolidation_stm_input_count: stmInputCount,
            consolidation_ltm_output_count: merged
        }, chatId);

        await saveVaultWithSnapshot(chatId, vault);
    }
    return { vault, merged };
}
