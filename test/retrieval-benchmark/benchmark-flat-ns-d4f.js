// Quick Flat(NS) baseline under d4f judge
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines } from '../../src/core/engine/retrieval.js';
import { allSTM, allLTM } from './fixture.js';
import { queries } from './queries.js';
import { linearFuse } from './benchmark-fusions.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_flat_v4__';

var JUDGE_URL = config.judge_v4 ? config.judge_v4.url : config.url.replace('/embeddings', '/chat/completions');
var JUDGE_MODEL = config.judge_v4 ? config.judge_v4.model : 'deepseek-chat';
var JUDGE_KEY = config.judge_v4 ? config.judge_v4.key : config.key;
var IS_V4 = !!config.judge_v4;

process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;

function buildFlat(mergedMap) {
    var entries = [];
    mergedMap.forEach(function(e) {
        if (e.relevance > 0 && (!e.sources || e.sources.indexOf('ltm_dir') === -1)) entries.push(e);
    });
    entries.sort(function(a, b) { return b.relevance - a.relevance; });
    var lines = ['以下是按相关度排序的记忆检索结果：', ''];
    entries.forEach(function(e, i) {
        var p = e.entry.period || '?';
        var scene = e.entry.scene || '';
        var event = e.entry.event || e.entry.summary || '';
        lines.push((i+1) + '. [' + p + '] ' + (scene ? scene + ': ' : '') + event);
    });
    if (entries.length === 0) lines.push('（未检索到相关记忆）');
    return lines.join('\n');
}

var SP = [
    '你是一个记忆检索质量评估器。',
    '以下是一组从长篇故事对话中提取的记忆条目，以及一个关于故事内容的问题。',
    '请判断这些记忆能否帮助你回答该问题。',
    '',
    '评分标准（1-5分）：',
    '1 — 无法回答 2 — 勉强可猜 3 — 部分可答 4 — 基本完整 5 — 完全可答',
    '',
    '请严格返回JSON：{"score": <1-5>, "reason": "<一句话>"}',
].join('\n');

async function judge(queryText, context) {
    var body = { model: JUDGE_MODEL, messages: [{ role: 'system', content: SP }, { role: 'user', content: context + '\n\n---\n问题：' + queryText }], temperature: 0, max_tokens: 200 };
    if (IS_V4) body.thinking = { type: 'disabled' };
    var resp = await fetch(JUDGE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + JUDGE_KEY }, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error('API ' + resp.status);
    var data = await resp.json();
    var c = data.choices[0].message.content.trim();
    try { var r = JSON.parse(c); } catch(e) { var m = c.match(/"score"\s*:\s*(\d+)/); r = { score: m ? parseInt(m[1]) : -1, reason: c.substring(0,80) }; }
    return r;
}

function avg(arr) { return arr.length ? arr.reduce(function(a,b){return a+b;},0)/arr.length : 0; }

console.log('=== Flat(NS) d4f baseline ===\n');

resetVectorIndex(CHAT_ID);
await ensureVectorIndex(allSTM, {}, CHAT_ID);
var vecIdx = getVectorIndex(CHAT_ID);

var allNames = [];
allSTM.forEach(function(e) { if (e.entities) e.entities.forEach(function(en) { var n = typeof en === 'string' ? en : en.name; if (n && allNames.indexOf(n) === -1) allNames.push(n); }); });

var scores = [], results = [];

for (var i = 0; i < queries.length; i++) {
    var q = queries[i], qt = q.query || q.question, qid = q.id || ('q'+(i+1));
    process.stdout.write('[' + (i+1) + '/' + queries.length + '] ' + qid + ' ... ');

    delete process.env.NE_BENCHMARK_VECTOR;
    var bm25 = await filterCandidates(qt, allSTM, allLTM, 40, 3, {}, CHAT_ID);
    var bm25Ids = bm25.filter(function(r) { return !r.__isDirectory; }).map(function(r) { return r.__id || r.id; });
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
    var emb = await computeEmbedding(qt);
    var vec = vectorSearch(emb, vecIdx, 144);
    linearFuse(bm25Ids, vec.map(function(v) { return v.entry.id; }), 0.20, 40, 60);

    var qLower = qt.toLowerCase();
    var eNames = allNames.filter(function(n) { return n.length > 1 && qLower.indexOf(n.toLowerCase()) !== -1; }).sort(function(a,b){return b.length-a.length;}).slice(0,5);
    var chains = {};
    eNames.forEach(function(name) { chains[name] = []; });
    allSTM.forEach(function(e) {
        if (e.entities) e.entities.forEach(function(en) {
            var n = typeof en === 'string' ? en : en.name;
            if (chains[n]) chains[n].push(e);
        });
    });

    var merged = await mergePipelines(bm25, chains, allLTM, { characters: {}, factions: {} }, allSTM);
    var ctx = buildFlat(merged.map);
    var j;
    try { j = await judge(qt, ctx); } catch(e) { j = { score: -1, reason: 'ERR:' + e.message }; }

    process.stdout.write('Flat=' + j.score + ' |ctx|=' + ctx.length + '\n');
    if (j.score >= 1) scores.push(j.score);
    results.push({ id: qid, type: q.type, query: qt, score: j.score, reason: j.reason, tokens: ctx.length });
}

var outDir = join(__dirname, 'output');
try { mkdirSync(outDir, { recursive: true }); } catch(e) {}
var outFile = join(outDir, 'flat-ns-d4f.md');
var report = ['# Flat(NS) — d4f Judge', '**Score avg**: ' + avg(scores).toFixed(2), ''];
results.forEach(function(r) { report.push('- **' + r.id + '**: ' + r.score + '/5 — ' + r.reason.substring(0, 120)); });
writeFileSync(outFile, report.join('\n'), 'utf-8');

console.log('\n=== Flat(NS) avg: ' + avg(scores).toFixed(2) + ' ===');
console.log('Report: ' + outFile);
