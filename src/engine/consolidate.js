/**
 * engine/consolidate.js — STM→LTM 整合引擎
 *
 * 当 unconsolidated_stm 达到阈值时触发。
 * 生成 LTM 摘要，标记原始 STM，不删除。
 * 这是 NE 最核心的差异化功能。
 */
import { callMemoryLLM, recordTelemetry } from '../api/llm.js';

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
    const threshold = content.consolidate_threshold || 5;
    const unconsolidated = (content.unconsolidated_stm || []).filter(stm => !stm.parent_ltm);
    if (unconsolidated.length < threshold) return false;
    var totalText = 0;
    unconsolidated.forEach(function(s) {
        totalText += (s.event || '').length + (s.scene || '').length;
    });
    // Adaptive: skip consolidation if entries are too sparse (avg < 40 chars per entry)
    if (totalText < threshold * 40) return false;
    return true;
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
        return `${i + 1}. [${e.period || ''}] ${e.time_label ? e.time_label + '·' : ''}${e.scene || ''}: ${e.event || ''} [→msg#${refs}]`;
    }).join('\n');

    if (lang === 'en') {
        return {
            system: `You merge short-term memories into long-term memory summaries.

Existing LTM:
${ltmText || '(none)'}

Unconsolidated STM:
${stmText}

Output ONLY a JSON object:
{
  "ltm_entries": [{ "period": "time range from source STM entries (max 15). Use same format as state.time, e.g. 'Day 3-5' or 'Day 3·黄昏→Day 5·深夜'", "scene": "scene (max 20)", "event": "merged summary (max 100)", "stm_refs": ["stm_id1", "stm_id2"] }],
  "delete_stm_ids": []
}

IMPORTANT: NEVER put STM IDs in "delete_stm_ids". Always keep original STM entries. Only add new LTM entries and reference the STM IDs in stm_refs.`,
            user: 'Merge these short-term memories. Only output JSON.'
        };
    }
    return {
        system: `你将短期记忆合并为长期记忆摘要。

已有 LTM：
${ltmText || '(无)'}

待整合 STM：
${stmText}

仅输出 JSON 对象：
{
  "ltm_entries": [{ "period": "时间范围（最长15字）。使用与 state.time 相同的格式，如 'Day 3-5' 或 'Day 3·黄昏→Day 5·深夜'", "scene": "场景(最长20字)", "event": "合并摘要(最长100字)", "stm_refs": ["stm_id1", "stm_id2"] }],
  "delete_stm_ids": []
}

重要：绝不要往 "delete_stm_ids" 中放 STM ID。始终保留原始 STM 条目。只在 ltm_entries 中新增 LTM 条目并通过 stm_refs 引用 STM ID。`,
        user: '合并这些短期记忆。仅输出 JSON。'
    };
}

export function parseConsolidateResponse(llmResponse) {
    try {
        const text = String(llmResponse || '').trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return JSON.parse(text);
    } catch (e) {
        return { ltm_entries: [], delete_stm_ids: [] };
    }
}

export function applyConsolidation(vault, consolidationResult) {
    const content = vault.content || {};
    content.stm_entries = content.stm_entries || [];
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);

    const ltmEntries = consolidationResult.ltm_entries || [];
    ltmEntries.forEach(ltm => {
        if (!ltm.id) ltm.id = findNextId(vault);

        var sourceSTM = allSTM.filter(function(s) {
            return (ltm.stm_refs || []).indexOf(s.id) !== -1;
        });
        ltm.time_range = deriveTimeRange(sourceSTM);

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
        return first.period + ': ' + (first.time_label || '?') + ' → ' + (last.time_label || '?');
    }
    return fmt(first) + ' → ' + fmt(last);
}

export async function executeConsolidation(chatId) {
    const { read } = await import('../vault/store.js');
    const { saveVaultWithSnapshot } = await import('./update.js');
    const vault = await read(chatId);
    if (!checkConsolidateThreshold(vault)) return { vault, merged: 0 };
    const prompt = buildConsolidatePrompt(vault);
    const response = await callMemoryLLM([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
    const result = parseConsolidateResponse(response);
    const merged = applyConsolidation(vault, result);
    if (merged > 0) {
        vault._meta = vault._meta || {};
        vault._meta.last_pipeline_task = 'consolidation';
        vault._meta.last_pipeline_time = new Date().toISOString();

        var content = vault.content || {};
        var stmInputCount = (content.unconsolidated_stm || []).filter(function(s) { return !s.parent_ltm; }).length;
        recordTelemetry({
            pipeline_task: 'consolidation',
            consolidation_stm_input_count: stmInputCount,
            consolidation_ltm_output_count: merged
        });

        await saveVaultWithSnapshot(chatId, vault);
    }
    return { vault, merged };
}
