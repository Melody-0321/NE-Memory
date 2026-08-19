// stm-resolver.js — STM 抽取后的状态消解 pass（resolve-rewrite 二段式，D 方案生产化）
// 定位：抽取器以最初主张为锚点，跨 turn 折叠时丢弃否定/反悔的最终状态（BUGS vNext-N）。
//   resolver 对每个 chunk 抽取出的 events 做终态 QA：命中反转则重写 event 文本为最终态。
// 规格：modality-schema-fix-plan §3.9（K=2 批量 + max_tokens≥1800 + 降级 + 证据约束，canonical §8.3/§8.4 实测）。
// 不改 schema / store / 检索消费方；只改写 event 字段**值**，不增删字段。
//
// 用法（由 stm-pipeline.js 调用）：
//   import { resolveChunkEvents } from './stm-resolver.js';
//   events = await resolveChunkEvents(chunkDialogueText, events, { chatId });
// 返回与原 events 相同结构（失败降级：原样返回）。

import { callMemoryLLM } from '../api/llm.js';
import { safeJsonParse } from './json-fallback.js';
import { readNeSettingsCached } from '../settings.js';
import { recordTelemetry } from '../api/llm.js';

// 生产配置（canonical §8.4 决策：K=2 甜点 + M≥1800；K=4 硬门槛）
var BATCH_SIZE = 2;          // 每批事件数（>2 时分批，不调大 M 替代分批）
var MAX_TOKENS = 1800;       // 输出上限（M=900 下 K=2 有 12.5% 截断，M≥1800 留余量）
var TEMPERATURE = 0.2;       // 与抽取一致（评测同值，保复现性）

// 开关：stmResolveReversal（默认开，false 时原样返回 = 现网行为）
export function isResolverEnabled() {
    try { return readNeSettingsCached().stmResolveReversal !== false; } catch (e) { return true; }
}

// 重试包装：callMemoryLLM 无内置重试，评测版 callChatRetry 的语义在此复刻（≥1 次）
// llmCall 可注入（测试用）；默认走生产 callMemoryLLM
async function callWithRetry(messages, options, llmCall) {
    var fn = llmCall || callMemoryLLM;
    var attempt = 0;
    function run() {
        return fn(messages, options).catch(function (err) {
            if (attempt < 2) { attempt++; return run(); }
            throw err;
        });
    }
    return run();
}

// 构造单批 resolver 的 user prompt（语义对齐评测 resolveBatch，生产输入是 chunk 对话原文 + events）
function buildBatchPrompt(dialogueText, batch) {
    return [
        '下面是对话片段和从其中抽取的 ' + batch.length + ' 条"事件"。',
        '--- 对话 ---',
        dialogueText,
        '--- 抽取的事件 ---',
        batch.map(function (e, i) { return '[' + e._resolverIdx + '] ' + (e.event || ''); }).join('\n'),
        '---',
        '任务：对每条事件，判断到对话**结束时**，该事件涉及的主题/事实，其**当前真实状态**是否与事件文本所声称的状态**相反**（即发生了反转）。',
        '判断要点：只看最终结果，忽略过程中的表态。若最终状态仍是事件文本所述（或事件本就是一次性事实、无反转），返回 reversed=false。',
        '若最终状态已反转，必须：',
        '1) reversed=true；',
        '2) 引用至少一句支撑反转的对话原文（evidence，逐字引用）；',
        '3) 用"先……最终……"改写事件为最终状态（rewritten），不得只保留最初主张。',
        '逐条输出，每条独立判断，不要互相影响。',
        '输出严格 JSON（数组）：',
        '[{"idx":0,"reversed":true|false,"evidence":"逐字引用或空串","rewritten":"反转后的重写文本（未反转则保持原样）","reason":"一句话说明"}, ...]',
    ].join('\n');
}

// 单批解析：按 idx 回填到 batch 内 events，返回该批处理后的 events
function applyBatchResult(batch, parsed) {
    var byIdx = {};
    (parsed || []).forEach(function (p) {
        if (p && p.idx !== undefined) byIdx[p.idx] = p;
    });
    return batch.map(function (e) {
        var p = byIdx[e._resolverIdx];
        if (!p || typeof p.reversed !== 'boolean') {
            // 该条未返回有效对象 → 原样保留（降级：不重写）
            return e;
        }
        // 证据约束（§3.9.2）：reversed=true 必须带 evidence，否则视为未反转（防幻觉编造反转）
        var effectiveReversed = p.reversed && p.evidence && String(p.evidence).trim();
        if (effectiveReversed) {
            var rewritten = p.rewritten && String(p.rewritten).trim() ? String(p.rewritten).trim() : e.event;
            if (rewritten !== e.event) {
                e.event = rewritten; // 只改 event 字段值
            }
        }
        return e;
    });
}

// 主入口：对 chunk 抽取出的 events 做 resolver 消解
// dialogueText：chunk 段内对话原文（buildStmSummaryPrompt 的 user 文本）
// events：该 chunk 抽取出的 events（已 mapEventData，含 event/msgRange/msg_ids 等）
// opts：{ chatId }
// 返回：{ events, calls, failures, rewritten } —— events 为消解后数组（结构不变；失败降级原样保留）
export async function resolveChunkEvents(dialogueText, events, opts) {
    opts = opts || {};
    var stats = { calls: 0, failures: 0, rewritten: 0 };
    if (!events || events.length === 0) return { events: events, calls: 0, failures: 0, rewritten: 0 };
    if (!isResolverEnabled()) return { events: events, calls: 0, failures: 0, rewritten: 0 }; // 开关关闭 = 现网行为

    // 给每个 event 打临时 batch 索引 + 原始 event 快照（统计重写条数用）
    for (var i = 0; i < events.length; i++) {
        events[i]._resolverIdx = i;
        events[i]._resolverOrig = events[i].event;
    }

    var out = [];
    for (var start = 0; start < events.length; start += BATCH_SIZE) {
        var batch = events.slice(start, start + BATCH_SIZE);
        var batchPrompt = buildBatchPrompt(dialogueText, batch);
        var raw = null;
        try {
            var resp = await callWithRetry([
                { role: 'system', content: '你是严格的对话状态消解引擎，只输出 JSON。' },
                { role: 'user', content: batchPrompt },
            ], {
                _forcePipelineApi: true,
                operation: 'stm_extract', // 走 STM 通道（同抽取 API 配置）
                _returnRaw: true,
                temperature: TEMPERATURE,
                max_tokens: MAX_TOKENS,  // 直接传 callMemoryLLM → callCustomAPI 生效（M≥1800）
                chatId: opts.chatId,
            }, opts.llmCall);
            raw = resp && (typeof resp === 'string' ? resp : resp.content);
            stats.calls++;
        } catch (e) {
            console.warn('[NE] resolver 调用失败，原样返回该批：' + (e && e.message));
            stats.calls++; stats.failures++;
            recordTelemetry({ pipeline_task: 'stm_resolve', error: 'call_failed', batch: batch.length }, opts.chatId);
            for (var k = 0; k < batch.length; k++) { delete batch[k]._resolverIdx; delete batch[k]._resolverOrig; out.push(batch[k]); }
            continue;
        }

        var parsed = safeJsonParse(raw);
        if (!parsed || !Array.isArray(parsed)) {
            // parse 失败 → 原样返回该批（降级兜底）
            console.warn('[NE] resolver parse 失败，原样返回该批：' + String(raw || '').slice(0, 120));
            stats.failures++;
            recordTelemetry({ pipeline_task: 'stm_resolve', error: 'parse_fail', batch: batch.length }, opts.chatId);
            for (var k2 = 0; k2 < batch.length; k2++) { delete batch[k2]._resolverIdx; delete batch[k2]._resolverOrig; out.push(batch[k2]); }
            continue;
        }

        var processed = applyBatchResult(batch, parsed);
        processed.forEach(function (e) {
            if (e._resolverOrig !== undefined && e.event !== e._resolverOrig) stats.rewritten++;
            delete e._resolverIdx; delete e._resolverOrig;
        });
        out = out.concat(processed);
    }

    return { events: out, calls: stats.calls, failures: stats.failures, rewritten: stats.rewritten };
}
