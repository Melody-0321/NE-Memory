// judge-injection-arm-lib.js — L1 盲读者协议（被 run-injection-arms.js 复用）
// 读者只看「记忆文档 + 问题」，只依据文档作答，找不到答"不知道"（幻觉守门）。
// 盲评：不知臂名；prompt 无机制提示词；四臂统一中性引导语。

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { safeJsonParse } from '../../src/core/engine/json-fallback.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var LLM = config.judge_v4 || { url: null, model: null, key: null };

export var READER_SYSTEM = [
  '你是严格的事实问答引擎。你会收到一份记忆文档和一个问题。',
  '只依据记忆文档中的内容作答。文档中没有的信息，回答"不知道"。',
  '不要猜测，不要使用你自己的知识，不要根据常识推断。',
  '返回严格 JSON：{"answer":"简短作答（一句话内）","found":true|false}',
  'found=true 表示答案来自记忆文档；找不到信息时 answer="不知道" 且 found=false。',
].join('\n');

function callChatRetry(messages, temperature, maxTokens) {
    var attempt = 0;
    function call() {
        return fetch(LLM.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (LLM.key || '') },
            body: JSON.stringify({
                model: LLM.model, messages: messages, temperature: temperature,
                max_tokens: maxTokens, response_format: { type: 'json_object' },
            }),
        }).then(function (resp) {
            if (!resp.ok) throw new Error('LLM HTTP ' + resp.status);
            return resp.json();
        }).then(function (data) {
            var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (!content) throw new Error('LLM empty content');
            return content;
        });
    }
    function run() {
        return call().catch(function (err) {
            if (attempt < 2) { attempt++; return run(); }
            throw err;
        });
    }
    return run();
}

// maxTokens 可调：默认 400（修 reader 截断假阴性——旧默认 200 会掐断长 JSON 答案）。
// 传 maxTokens=false/0 时保留旧行为（若某处需严格复现历史 200 口径）。
const DEFAULT_MAX_TOKENS = 400;

export async function askReader(docText, question, maxTokens) {
    var mt = (maxTokens === undefined || maxTokens === null) ? DEFAULT_MAX_TOKENS : (maxTokens === false ? 200 : maxTokens);
    var user = [
        '## 记忆文档',
        docText && docText.length > 0 ? docText : '（文档为空）',
        '',
        '## 问题',
        question,
    ].join('\n');
    var raw = await callChatRetry([
        { role: 'system', content: READER_SYSTEM },
        { role: 'user', content: user },
    ], 0, mt);
    var p = safeJsonParse(raw);
    if (!p || typeof p.answer !== 'string') {
        return { parseOk: false, answer: raw ? raw.slice(0, 100) : '(empty)', found: false, raw: (raw || '').slice(0, 200) };
    }
    return { parseOk: true, answer: p.answer, found: p.found === true, raw: (raw || '').slice(0, 200) };
}