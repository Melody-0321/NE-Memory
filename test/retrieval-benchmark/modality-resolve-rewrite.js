// modality-resolve-rewrite.js — D 臂的 resolver pass（resolve-rewrite 二段式）
// 对抽取出的 event 做终态 QA：判定事件所述主题在该对话结束时是否已发生反转。
// - 反转 → 重写 event 文本为"曾主张 → 当前真实状态"（要求引用证据 turn，防幻觉）
// - 未反转 → 原样返回
// 不依赖 modality 字段（原 E 的死因：该标签几乎不产生）。
// 本模块是纯评测期工具：只吃 eventText + 原始对话，返回 { rewritten, eventText, reversed, evidence }。

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

function renderDialogue(c) {
    return c.messages.map(function (m) {
        var who = (m.role === 'user') ? '用户' : (m.name || '角色');
        return who + '：' + m.mes;
    }).join('\n');
}

async function callChat(messages, temperature, maxTokens) {
    var resp = await fetch(LLM.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (LLM.key || '') },
        body: JSON.stringify({
            model: LLM.model, messages: messages, temperature: temperature,
            max_tokens: maxTokens, response_format: { type: 'json_object' }
        })
    });
    if (!resp.ok) throw new Error('LLM HTTP ' + resp.status);
    var data = await resp.json();
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('LLM empty content');
    return content;
}

async function callChatRetry(messages, temperature, maxTokens) {
    var attempt = 0;
    function run() {
        return callChat(messages, temperature, maxTokens).catch(function (err) {
            if (attempt < 2) { attempt++; return run(); }
            throw err;
        });
    }
    return run();
}

// 主入口：对 (case, eventText) 做 resolver，返回标准化结果
//   resolve(caseObj, eventText, { temperature })
//   -> { ok, reversed, rewritten, evidence, reason }
export async function resolveEvent(caseObj, eventText, opts) {
    opts = opts || {};
    var dialogue = renderDialogue(caseObj);
    var user = [
        '下面是对话片段和从其中抽取的一条"事件"。',
        '--- 对话 ---',
        dialogue,
        '--- 抽取的事件 ---',
        '"' + eventText + '"',
        '---',
        '任务：判断到对话**结束时**，该事件涉及的主题/事实，其**当前真实状态**是否与事件文本所声称的状态**相反**（即发生了反转）。',
        '判断要点：只看最终结果，忽略过程中的表态。若最终状态仍是事件文本所述（或事件本就是一次性事实、无反转），返回 reversed=false。',
        '若最终状态已反转，必须：',
        '1) reversed=true；',
        '2) 引用至少一句支撑反转的对话原文（evidence，逐字引用）；',
        '3) 用"先……最终……"改写事件为最终状态（rewritten），不得只保留最初主张。',
        '输出严格 JSON：',
        '{"reversed":true|false,"evidence":"逐字引用或空串","rewritten":"反转后的重写文本（未反转则保持原样）","reason":"一句话说明"}',
    ].join('\n');

    var raw;
    try {
        raw = await callChatRetry([
            { role: 'system', content: '你是严格的对话状态消解引擎，只输出 JSON。' },
            { role: 'user', content: user },
        ], 0.2, 500);
    } catch (e) {
        return { ok: false, error: 'resolver 调用失败: ' + (e && e.message), reversed: null, rewritten: null, evidence: null, reason: null };
    }

    var p = safeJsonParse(raw);
    if (!p || typeof p.reversed !== 'boolean') {
        return { ok: false, error: 'resolver 解析失败: ' + String(raw).slice(0, 120), reversed: null, rewritten: null, evidence: null, reason: null };
    }

    var rewritten = p.rewritten && String(p.rewritten).trim() ? String(p.rewritten).trim() : eventText;
    return {
        ok: true,
        reversed: p.reversed,
        evidence: (p.evidence && String(p.evidence)) || '',
        rewritten: rewritten,
        reason: (p.reason && String(p.reason)) || '',
    };
}