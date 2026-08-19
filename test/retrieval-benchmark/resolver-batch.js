// resolver-batch.js — D 臂 resolver 批量化（K 粒度实验核心）
// 基于 modality-resolve-rewrite.js 改造：resolveBatch(dialogue, events, K)
// 一次调用裁决 K 条事件（对话只喂一次），输出 [{idx, reversed, rewritten, evidence}]。
// K=1 时语义与现 resolveEvent 等价（保证可比）。
// 成本捕获：deepseek API 的 usage.prompt_tokens（2026-08-19 探测确认，非 input_tokens）。

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

function callChat(messages, temperature, maxTokens) {
    return fetch(LLM.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (LLM.key || '') },
        body: JSON.stringify({
            model: LLM.model, messages: messages, temperature: temperature,
            max_tokens: maxTokens, response_format: { type: 'json_object' }
        })
    }).then(function (resp) {
        if (!resp.ok) throw new Error('LLM HTTP ' + resp.status);
        return resp.json();
    }).then(function (data) {
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('LLM empty content');
        // 成本捕获：deepseek usage.prompt_tokens（兼容 OpenAI input_tokens 作回退）
        var promptTokens = null;
        if (data.usage && data.usage.prompt_tokens != null) promptTokens = data.usage.prompt_tokens;
        else if (data.usage && data.usage.input_tokens != null) promptTokens = data.usage.input_tokens;
        // 输出成本捕获（2026-08-19 补：让"每事件总成本"从估算变实测，canonical §8.3/§8.4 引用）
        var completionTokens = null;
        if (data.usage && data.usage.completion_tokens != null) completionTokens = data.usage.completion_tokens;
        else if (data.usage && data.usage.output_tokens != null) completionTokens = data.usage.output_tokens;
        // 截断直接证据：finish_reason === 'length'（2026-08-19 探测确认 deepseek 返回该字段）
        var finishReason = data.choices && data.choices[0] ? data.choices[0].finish_reason : null;
        return { content: content, promptTokens: promptTokens, completionTokens: completionTokens, finishReason: finishReason };
    });
}

function callChatRetry(messages, temperature, maxTokens) {
    var attempt = 0;
    function run() {
        return callChat(messages, temperature, maxTokens).catch(function (err) {
            if (attempt < 2) { attempt++; return run(); }
            throw err;
        });
    }
    return run();
}

function renderDialogue(messages) {
    return messages.map(function (m) {
        var who = (m.role === 'user') ? '用户' : (m.name || '角色');
        return who + '：' + m.mes;
    }).join('\n');
}

// 批量化 resolver：对 batch 内 K 条事件一次裁决
// events: [{ idx, eventText }]（idx 用于回填，必须是 0..K-1）
// opts: { temperature, maxTokens }（maxTokens 默认 900；阶段 A 会放松到 1800/3600）
// 返回 { ok, promptTokens, finishReason, truncated, results: [...] }
export async function resolveBatch(dialogue, events, opts) {
    opts = opts || {};
    var K = events.length;
    var maxTokens = opts.maxTokens || 900;

    var user = [
        '下面是对话片段和从中抽取的 ' + K + ' 条"事件"。',
        '--- 对话 ---',
        dialogue,
        '--- 抽取的事件 ---',
        events.map(function (e, i) { return '[' + i + '] ' + e.eventText; }).join('\n'),
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

    var raw;
    var promptTokens = null;
    var completionTokens = null;
    var finishReason = null;
    try {
        var resp = await callChatRetry([
            { role: 'system', content: '你是严格的对话状态消解引擎，只输出 JSON。' },
            { role: 'user', content: user },
        ], 0.2, maxTokens);
        raw = resp.content;
        promptTokens = resp.promptTokens;
        completionTokens = resp.completionTokens;
        finishReason = resp.finishReason;
    } catch (e) {
        return { ok: false, promptTokens: promptTokens, completionTokens: completionTokens, finishReason: finishReason, truncated: false, results: events.map(function (e) { return { idx: e.idx, ok: false, error: 'resolver 调用失败: ' + (e && e.message) }; }) };
    }

    // 截断直接证据：finish_reason === 'length'（阶段 A 核心信号）
    var truncated = finishReason === 'length';

    var parsed = safeJsonParse(raw);
    if (!parsed || !Array.isArray(parsed)) {
        return { ok: false, promptTokens: promptTokens, completionTokens: completionTokens, finishReason: finishReason, truncated: truncated, results: events.map(function (e) { return { idx: e.idx, ok: false, parseFail: true, raw: String(raw).slice(0, 150) }; }) };
    }

    var byIdx = {};
    parsed.forEach(function (p) {
        if (p && p.idx !== undefined) byIdx[p.idx] = p;
    });

    var results = events.map(function (e) {
        var p = byIdx[e.idx];
        if (!p || typeof p.reversed !== 'boolean') {
            return { idx: e.idx, ok: false, parseFail: true, raw: 'idx ' + e.idx + ' 未返回有效对象' };
        }
        var rewritten = p.rewritten && String(p.rewritten).trim() ? String(p.rewritten).trim() : e.eventText;
        return {
            idx: e.idx,
            ok: true,
            reversed: p.reversed,
            evidence: (p.evidence && String(p.evidence)) || '',
            rewritten: rewritten,
            reason: (p.reason && String(p.reason)) || '',
        };
    });

    return { ok: true, promptTokens: promptTokens, completionTokens: completionTokens, finishReason: finishReason, truncated: truncated, results: results, raw: raw.slice(0, 200) };
}