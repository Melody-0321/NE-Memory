/**
 * engine/consolidate.js — STM→LTM 整合引擎
 *
 * 当 unconsolidated_stm 达到阈值时触发。
 * 生成 LTM 摘要，标记原始 STM，不删除。
 * 这是 NE 最核心的差异化功能。
 */
import { callMemoryLLM, callMemoryPipeline, recordTelemetry } from '../api/llm.js';
import { validateLTMOutput, postFillLTM } from './validate.js';
import { getStmMinLtmMerge } from '../settings.js';

function findNextId(vault) {
    const content = vault.content || {};
    let max = 0;
    (content.ltm_entries || []).forEach(e => {
        const num = parseInt(String(e.id || '').replace('ltm_', ''), 10);
        if (num > max) max = num;
    });
    return 'ltm_' + (max + 1);
}

function getMaxUnconsolidated() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            return Number(s.stmMaxUnconsolidated) || 5;
        }
    } catch (e) {}
    return 5;
}

export function checkConsolidateThreshold(vault) {
    const content = vault.content || {};
    const unconsolidated = (content.unconsolidated_stm || []).filter(stm => !stm.parent_ltm);
    return unconsolidated.length > getMaxUnconsolidated();
}

export function buildConsolidatePrompt(vault) {
    const content = vault.content || {};
    const lang = content.language === 'en' ? 'en' : 'zh';
    const ltmEntries = content.ltm_entries || [];
    const unconsolidated = (content.unconsolidated_stm || []).filter(stm => !stm.parent_ltm);
    const ltmText = ltmEntries.map((e, i) => {
        const refs = (e.stm_refs || []).join(', ');
        return `${i + 1}. [${e.period || ''}] ${e.title || e.event || ''} [→${refs}]`;
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
- Merge consecutive STM entries into LTMs by story arc. NEVER do 1:1 mapping.
- The LTM "title" is a short scene:label (15-40 chars), NOT a full sentence. e.g. '酒馆:苏蔓失踪·报警'
- The LTM "event" is a complete sentence describing the arc content (80-140 chars).
- "title" MUST be a short label (15-40 chars), NOT a full sentence.

Output JSON with this schema:
{
  "ltm_entries": [
    {
      "stm_refs": ["stm_X", "stm_Y", ...],
      "title": "scene: concise label (15-40 chars)",
      "event": "a complete sentence describing the arc content (80-140 chars)"
    }
  ]
}

IMPORTANT: Use character proper names.`,
            user: 'Elevate these STM entries into high-level LTM. Output JSON with ltm_entries array (title + event per entry).'
        };
    }
    return {
        system: `你是长期记忆编撰者。将多条短期记忆（STM）提升为更高抽象层的长期记忆（LTM）。

已有 LTM：
${ltmText || '(无)'}

待整合 STM（描述连续剧情的细节事件）：
${stmText}

要求：
- 将内容连续的 STM 按剧情弧合并为 LTM。禁止 1:1 映射。
- LTM 的 "title" 是简短的情景标签（15-40 字），不是完整句子。例如'酒馆:苏蔓失踪·报警'
- LTM 的 "event" 是描述弧内容的完整句子（80-140 字）。
- "title" 必须是简短的标签（15-40 字），不是完整句子。

输出 JSON，schema 如下：
{
  "ltm_entries": [
    {
      "stm_refs": ["stm_X", "stm_Y", ...],
      "title": "scene: 简练标签（15-40 字）",
      "event": "描述弧内容的完整句子（80-140 字）"
    }
  ]
}

重要：使用角色全名，禁止代词。`,
        user: '将以下 STM 条目提升为高层 LTM。输出包含 ltm_entries 数组的 JSON（每条含 title + event）。'
    };
}

function parseConsolidateText(text, stmIds) {
    var clean = String(text || '');
    try { return JSON.parse(clean); } catch (_) {}
    var jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) { try { return JSON.parse(jsonMatch[0]); } catch (_) {} }
    var lines = clean.split('\n');
    var ltmEntries = [];
    var currentEntry = null;
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
            currentEntry = { stm_refs: stmRefs.length > 0 ? stmRefs : stmIds, event: '' };
            continue;
        }
        if (!currentEntry) continue;
        var eventMatch = line.match(/event\s*[:：]\s*(.+)/i);
        if (eventMatch) {
            currentEntry.event = eventMatch[1].trim().substring(0, 50);
            continue;
        }
    }
    if (currentEntry && currentEntry.event) {
        ltmEntries.push(currentEntry);
    }
    if (ltmEntries.length === 0) {
        ltmEntries.push({ stm_refs: stmIds, event: 'Consolidated STM ' + stmIds.join(', ') });
    }
    ltmEntries.forEach(function(e) { e.event = e.event.substring(0, 160).trim(); });
    return { ltm_entries: ltmEntries, delete_stm_ids: [] };
}

export function parseConsolidateResponse(llmResponse, stmIds) {
    try {
        const text = String(llmResponse || '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.warn('[NE] Consolidate JSON parse failed, using text fallback');
        return parseConsolidateText(llmResponse, stmIds || []);
    }
}

function normalizeConsolidation(ltmEntries, allStmIds) {
    if (!ltmEntries || ltmEntries.length === 0) return;
    if (!allStmIds || allStmIds.length === 0) return;

    var covered = {};
    ltmEntries.forEach(function(ltm) {
        (ltm.stm_refs || []).forEach(function(id) { covered[id] = true; });
    });

    var stmPos = {};
    allStmIds.forEach(function(id, i) { stmPos[id] = i; });

    ltmEntries.sort(function(a, b) {
        var pa = stmPos[(a.stm_refs || [])[0]];
        var pb = stmPos[(b.stm_refs || [])[0]];
        if (pa === undefined) pa = 999;
        if (pb === undefined) pb = 999;
        return pa - pb;
    });

    // 填补 LTM 内部 gap：连续剧情弧不应该跳过中间 STM
    ltmEntries.forEach(function(ltm) {
        var ids = (ltm.stm_refs || []).filter(function(id) { return stmPos[id] !== undefined; });
        ids.sort(function(a, b) { return stmPos[a] - stmPos[b]; });
        var gapFilled = false;
        for (var gi = 0; gi < ids.length - 1; gi++) {
            var currentPos = stmPos[ids[gi]];
            var nextPos = stmPos[ids[gi + 1]];
            if (nextPos - currentPos > 1) {
                for (var gj = currentPos + 1; gj < nextPos; gj++) {
                    var gapId = allStmIds[gj];
                    if (gapId && !covered[gapId]) {
                        ltm.stm_refs.push(gapId);
                        covered[gapId] = true;
                    }
                }
                gapFilled = true;
            }
        }
        if (gapFilled) {
            ltm.stm_refs.sort(function(a, b) { return (stmPos[a] || 0) - (stmPos[b] || 0); });
        }
    });

    var uncovered = allStmIds.filter(function(id) { return !covered[id]; });
    if (uncovered.length === 0) return;

    var ltmRanges = ltmEntries.map(function(ltm) {
        var ids = ltm.stm_refs || [];
        var positions = ids.map(function(id) { return stmPos[id]; }).filter(function(p) { return p !== undefined; });
        return {
            ltm: ltm,
            firstPos: positions.length > 0 ? Math.min.apply(null, positions) : Infinity,
            lastPos: positions.length > 0 ? Math.max.apply(null, positions) : -Infinity
        };
    });

    if (ltmRanges.length > 0) {
        var firstLtmRange = ltmRanges[0];
        var prefixOrphans = uncovered.filter(function(id) {
            return stmPos[id] !== undefined && stmPos[id] < firstLtmRange.firstPos;
        });
        if (prefixOrphans.length > 0) {
            firstLtmRange.ltm.stm_refs = prefixOrphans.concat(firstLtmRange.ltm.stm_refs || []);
            prefixOrphans.forEach(function(id) { covered[id] = true; });
        }
    }

    for (var li = 0; li < ltmRanges.length; li++) {
        var range = ltmRanges[li];
        var nextPos = (li + 1 < ltmRanges.length) ? ltmRanges[li + 1].firstPos : allStmIds.length;
        var gapOrphans = uncovered.filter(function(id) {
            var pos = stmPos[id];
            return pos !== undefined && pos > range.lastPos && pos < nextPos && !covered[id];
        });
        if (gapOrphans.length > 0) {
            range.ltm.stm_refs = (range.ltm.stm_refs || []).concat(gapOrphans);
            gapOrphans.forEach(function(id) { covered[id] = true; });
        }
    }

    if (ltmRanges.length > 0) {
        var lastLtmRange = ltmRanges[ltmRanges.length - 1];
        var suffixOrphans = uncovered.filter(function(id) {
            return stmPos[id] !== undefined && stmPos[id] > lastLtmRange.lastPos && !covered[id];
        });
        var minMerge = getStmMinLtmMerge();
        if (suffixOrphans.length >= minMerge) {
            lastLtmRange.ltm.stm_refs = (lastLtmRange.ltm.stm_refs || []).concat(suffixOrphans);
            suffixOrphans.forEach(function(id) { covered[id] = true; });
        }
    }

    ltmEntries.forEach(function(ltm) {
        ltm.stm_refs = (ltm.stm_refs || []).sort(function(a, b) {
            return (stmPos[a] || 0) - (stmPos[b] || 0);
        });
    });

    var coveredCount = uncovered.filter(function(id) { return covered[id]; }).length;
    if (coveredCount > 0) {
        console.log('[NE] normalizeConsolidation: covered ' + coveredCount + ' of ' + uncovered.length + ' uncovered STMs');
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
        var maxTs = 0;
        sourceSTM.forEach(function(s) { if (s.timestamp && s.timestamp > maxTs) maxTs = s.timestamp; });
        ltm.timestamp = maxTs || Date.now();

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

export async function executeConsolidation(chatId, force) {
    const { read } = await import('../vault/store.js');
    const { saveVaultWithSnapshot } = await import('./update.js');
    const vault = await read(chatId);
    if (!force && !checkConsolidateThreshold(vault)) return { vault, merged: 0 };
    const content = vault.content || {};
    const unconsolidated = (content.unconsolidated_stm || []).filter(stm => !stm.parent_ltm);
    const stmIds = unconsolidated.map(function(s) { return s.id; }).filter(Boolean);
    if (stmIds.length === 0) { console.log('[NE] Consolidation: no unconsolidated STM, skipping'); return { vault, merged: 0 }; }
    const prompt = buildConsolidatePrompt(vault);
    var response = await callMemoryPipeline([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
    var result = parseConsolidateResponse(response, stmIds);

    var validateErrors = validateLTMOutput(result);
    if (validateErrors.length > 0) {
        console.warn('[NE] LTM output validation failed, retrying:', validateErrors.join('; '));
        var retryMsg = validateErrors.join('; ') + '\n\nFix your output accordingly. Re-output ALL LTM entries as JSON with ltm_entries array.';
        var retryResponse = await callMemoryPipeline([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
            { role: 'assistant', content: response },
            { role: 'user', content: retryMsg }
        ]);
        result = parseConsolidateResponse(retryResponse, stmIds);
    }

    postFillLTM(result, unconsolidated);
    normalizeConsolidation(result.ltm_entries, stmIds);

    // 代码级守卫：从早到晚逐条应用 LTM，不消耗全部 STM（至少保留 1 条未整合）
    // 先按 stm_refs 的最大索引排序（早→晚），确保保留的是最早的剧情弧
    var stmPos = {};
    stmIds.forEach(function(id, i) { stmPos[id] = i; });
    result.ltm_entries.sort(function(a, b) {
        var maxA = (a.stm_refs || []).reduce(function(m, id) { return Math.max(m, stmPos[id] !== undefined ? stmPos[id] : -1); }, -1);
        var maxB = (b.stm_refs || []).reduce(function(m, id) { return Math.max(m, stmPos[id] !== undefined ? stmPos[id] : -1); }, -1);
        return maxA - maxB;
    });
    var threshold = getMaxUnconsolidated();
    var consumed = 0;
    var keepCount = 0;
    for (var k = 0; k < result.ltm_entries.length; k++) {
        var refCount = (result.ltm_entries[k].stm_refs || []).length;
        if (stmIds.length - (consumed + refCount) < 1) break;
        consumed += refCount;
        keepCount++;
    }
    if (keepCount < result.ltm_entries.length) {
        console.log('[NE] Consolidation guard: keeping ' + keepCount + '/' + result.ltm_entries.length + ' LTM entries, consumed=' + consumed + ', threshold=' + threshold);
        result.ltm_entries = result.ltm_entries.slice(0, keepCount);
    }
    if (result.ltm_entries.length === 0) {
        console.log('[NE] Consolidation guard: all LTM entries discarded, leaving ' + stmIds.length + ' unconsolidated STM');
    }

    const merged = applyConsolidation(vault, result);

    globalThis.__ne_debug_last_consolidation = {
        merged: merged,
        merged_ids: result.ltm_entries ? result.ltm_entries.map(function(e) { return e.id || ''; }).filter(Boolean) : [],
        time: new Date().toISOString()
    };

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
