// metamorphic-assertions.js — P1-met 变形关系断言（benchmark-improvement-plan §8）
// 4 条确定性断言，不需要 LLM judge，全部跑在 dev split（loadSplitQueries，默认 dev）。
// 每条对每个检索方法（BM25 / Vector / Lin / RRF）分别断言。
//   M1 单调性：复制 GT 事件入语料 → 该副本仍被检索到（相关材料在正向膨胀下保持可回）
//   M2 无关性：追加主题正交干扰项 → 原排序（原文档相对顺序）不变（Kendall τ=1）
//   M3 版本单调性：R 类"初始主张 vs 最终状态"事件对，最新态查询 → 最终版必须排在初始版前
//   M4 等价重排：语料逆序 → 排序结果不变（结果 id 列表逐一相等）
// 效率：对全部语料变体的并集"唯一搜索文本"只 embed 一次，各变体复用嵌入缓存手动建索引。
// 用法：node metamorphic-assertions.js
// 产出：output/metamorphic-report.md
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { computeEmbeddings, computeEmbedding, normalizeVec } from '../../src/core/engine/embedding.js';
import { buildSearchableText } from '../../src/core/engine/retrieval-text.js';
import { allSTM, allLTM } from './fixture.js';
import { loadSplitQueries } from './query-split-utils.js';
import { linearFuse, rrfFuse } from './benchmark-fusions.js';
import { withProvenanceHeader } from './report-provenance.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_met__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;
var TOP_K_FUSED = 40;
var ALPHA = 0.20;
var DISTRACTOR_SAMPLE = 60;

var queries = loadSplitQueries();
var STD = { bm25: TOP_K_BM25, vec: TOP_K_VEC, fused: TOP_K_FUSED };

function setBgeM3() {
  process.env.EMBEDDING_URL = config.url;
  process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
  process.env.EMBEDDING_API_KEY = config.key;
  delete process.env.NE_BENCHMARK_VECTOR;
}

// ── M3 语料：R 类（否定/反悔）4 组 → 每组 initial+final 事件 + 最新态查询 ──
function m3arc(u) {
  var suffix = ' Day 90 深夜 702公寓';
  return {
    id: u.id, name: u.name, query: u.query,
    initial: { id: u.id + '_init', event: u.initialText, period: 'Day 88 上午', scene: '702公寓', entities: u.entities, status: 'closed', noise: false },
    final: { id: u.id + '_final', event: u.finalText, period: 'Day 90 深夜', scene: '702公寓', entities: u.entities, status: 'closed', noise: false },
  };
}
var m3raw = [
  {
    id: 'M3a', name: '戒咖啡', entities: [ { name: '安然', type: 'character' } ],
    initialText: '安然决定从今天起戒咖啡，省得晚上睡不着写稿，戒咖啡是一个新的决心',
    finalText: '安然宣布戒咖啡失败反悔，第二天又喝了拿铁，仍然继续喝咖啡没戒掉',
    query: '安然现在戒咖啡了吗？她现在的咖啡习惯是什么？',
  },
  {
    id: 'M3b', name: '催稿', entities: [ { name: '江岚', type: 'character' } ],
    initialText: '江岚对安然说再也不催她的稿子了，让安然自己看着办',
    finalText: '江岚没忍住又催了安然的稿子，小声问安然今天那章写完没有',
    query: '江岚现在还催安然的稿子吗？',
  },
  {
    id: 'M3c', name: '吵架和好', entities: [ { name: '江岚', type: 'character' }, { name: '安然', type: 'character' } ],
    initialText: '安然和江岚吵架，说这日子没法过了要先冷静两天，两人闹翻冷战',
    finalText: '江岚和安然当晚就和好了，江岚炒了份炒面给安然，安然认错说刚才是她不好',
    query: '江岚和安然现在还在闹矛盾吗？他们和好了没？',
  },
  {
    id: 'M3d', name: '搬家', entities: [ { name: '林晚', type: 'character' } ],
    initialText: '林晚宣布下周搬家，在这住了三年也够了',
    finalText: '林晚最终决定不搬家了，行李装好又放下，继续住在原来的地方',
    query: '林晚现在搬走了吗？她还在原来的住处吗？',
  },
];
var m3arcs = m3raw.map(m3arc);

// ── 构建各语料变体 ──
var distractors = JSON.parse(readFileSync(join(__dirname, 'distractors.json'), 'utf-8')).events || [];

// dev 查询的 GT 唯一事件集（M1 复制的来源）
var gtUnique = {};
queries.forEach(function (q) {
  Object.keys(q.groundTruth || {}).forEach(function (id) { gtUnique[id] = true; });
});

function makeCopy(s) {
  return { id: 'copy_' + s.id, event: s.event, period: s.period, scene: s.scene, entities: s.entities, status: s.status, msg_ids: [], noise: s.noise };
}
var byId = {};
allSTM.forEach(function (s) { byId[s.id] = s; });
var copies = Object.keys(gtUnique).filter(function (id) { return byId[id]; }).map(function (id) { return makeCopy(byId[id]); });

var m1Corpus = allSTM.concat(copies);
var m2Corpus = allSTM.concat(distractors.slice(0, DISTRACTOR_SAMPLE));
var m3Corpus = allSTM.concat(m3arcs.map(function (a) { return [a.initial, a.final]; }).reduce(function (x, y) { return x.concat(y); }, []));
var m4Corpus = allSTM.slice().reverse();

// ── 嵌入缓存：所有变体全部文档的并集唯一文本，只 embed 一次 ──
function uniqueTexts(corpusArr) {
  var seen = {}, list = [];
  corpusArr.forEach(function (d) { var t = buildSearchableText(d); if (!seen[t]) { seen[t] = true; list.push(t); } });
  return list;
}
var allVariantTexts = uniqueTexts([].concat(allSTM, copies, distractors.slice(0, DISTRACTOR_SAMPLE),
  m3arcs.map(function (a) { return [a.initial, a.final]; }).reduce(function (x, y) { return x.concat(y); }, [])));

function buildIndex(corpus, embedByText) {
  var entries = [], vectors = [], idToIdx = {};
  corpus.forEach(function (d) {
    var t = buildSearchableText(d);
    if (embedByText[t] === undefined) throw new Error('missing embedding for ' + d.id);
    var pos = entries.length;
    entries.push({ id: d.id, text: t });
    vectors.push(embedByText[t]);
    idToIdx[d.id] = pos;
  });
  return { entries: entries, vectors: vectors, idToIdx: idToIdx };
}

async function retrieve(orderIdx, method, corpus, idx, query, qEmbed, isVectorOnly) {
  // BM25
  delete process.env.NE_BENCHMARK_VECTOR;
  var bm25Res = await filterCandidates(query, corpus, allLTM, TOP_K_BM25, 3, {}, CHAT_ID + '_' + orderIdx + '_' + method);
  var bm25Ids = bm25Res.map(function (r) { return r.__id || r.id; });
  if (method === 'BM25') return bm25Ids;
  // Vector
  setBgeM3();
  var vecRes = vectorSearchIdx(qEmbed, idx, TOP_K_VEC);
  var vecIds = vecRes.map(function (v) { return v.entry.id; });
  if (method === 'Vector') return vecIds;
  if (method === 'Lin') return linearFuse(bm25Ids, vecIds, ALPHA, TOP_K_FUSED, 60);
  if (method === 'RRF') return rrfFuse(bm25Ids, vecIds, TOP_K_FUSED, 60);
  throw new Error('unknown method ' + method);
}

function vectorSearchIdx(q, idx, k) {
  var qn = normalizeVec(new Float32Array(q));
  var res = [];
  for (var i = 0; i < idx.entries.length; i++) {
    var dot = 0, v = idx.vectors[i];
    for (var j = 0; j < qn.length; j++) dot += qn[j] * v[j];
    res.push({ entry: idx.entries[i], similarity: dot });
  }
  res.sort(function (a, b) { return b.similarity - a.similarity; });
  return res.slice(0, Math.min(k, res.length));
}

function kendallTau(a, b) {
  var posA = {}, posB = {};
  a.forEach(function (x, i) { posA[x] = i; });
  b.forEach(function (x, i) { posB[x] = i; });
  var common = a.filter(function (x) { return Object.prototype.hasOwnProperty.call(posB, x); });
  if (common.length < 2) return (a.join() === b.join()) ? 1 : 0;
  var con = 0, dis = 0;
  for (var i = 0; i < common.length; i++) {
    for (var j = i + 1; j < common.length; j++) {
      var da = posA[common[i]] - posA[common[j]];
      var db = posB[common[i]] - posB[common[j]];
      if (da * db > 0) con++; else dis++;
    }
  }
  return (con - dis) / (con + dis);
}

var METHODS = ['BM25', 'Vector', 'Lin', 'RRF'];
var K = TOP_K_FUSED;

function sliceK(ids) { return ids.slice(0, K); }

function main() {
  console.log('=== P1-met 变形关系断言 ===');
  console.log('dev 查询: ' + queries.length + ' | 方法: ' + METHODS.join('/') + ' | Top-K=' + K);

  return (async function () {
    setBgeM3();
    // 统一 embed 一次（全变体并集唯一文本）
    console.log('embedding ' + allVariantTexts.length + ' unique texts ...');
    var embeds = await computeEmbeddings(allVariantTexts);
    var embedByText = {};
    allVariantTexts.forEach(function (t, i) { embedByText[t] = normalizeVec(new Float32Array(embeds[i])); });

    // 建所有变体索引（共用缓存）
    var idxBase = buildIndex(allSTM, embedByText);
    var idxM1 = buildIndex(m1Corpus, embedByText);
    var idxM2 = buildIndex(m2Corpus, embedByText);
    var idxM3 = buildIndex(m3Corpus, embedByText);
    var idxM4 = buildIndex(m4Corpus, embedByText);

    var results = { M1: [], M2: [], M3: [], M4: [] };
    var queryEmbedCache = {};
    async function qEmbed(q) {
      if (!queryEmbedCache[q]) queryEmbedCache[q] = await computeEmbedding(q);
      return queryEmbedCache[q];
    }

    // ═══ M1 单调性 ═══
    for (var qi = 0; qi < queries.length; qi++) {
      var q = queries[qi];
      var qe = await qEmbed(q.query);
      for (var mi2 = 0; mi2 < METHODS.length; mi2++) {
        var m2 = METHODS[mi2];
        var base2 = await retrieve('base2_' + qi + '_' + m2, m2, allSTM, idxBase, q.query, qe);
        var fusedR = await retrieve('m1_' + qi + '_' + m2, m2, m1Corpus, idxM1, q.query, qe);
        var fusedRset = {};
        fusedR.forEach(function (id) { fusedRset[id] = true; });
        var base2set = {};
        base2.forEach(function (id) { base2set[id] = true; });
        var gtKeys = Object.keys(q.groundTruth || {});
        var considered = 0, passed = 0, copiesLost = [];
        gtKeys.forEach(function (sid) {
          var cid = 'copy_' + sid;
          if (!base2set[sid]) return; // 仅断言 baseline 已检索到的 GT 事件副本
          considered++;
          if (fusedRset[cid]) passed++;
          else copiesLost.push(sid);
        });
        results.M1.push({ query: q.id, method: m2, pass: considered > 0 ? passed / considered : null, copiesLost: copiesLost, total: considered, passed: passed });
      }
    }

    // ═══ M2 无关性 ═══
    var m2Fail = [];
    for (var qi2 = 0; qi2 < queries.length; qi2++) {
      var q2 = queries[qi2];
      var qe2 = await qEmbed(q2.query);
      for (var mi3 = 0; mi3 < METHODS.length; mi3++) {
        var m3 = METHODS[mi3];
        var base = await retrieve('m2b_' + qi2 + '_' + m3, m3, allSTM, idxBase, q2.query, qe2);
        var aug = await retrieve('m2a_' + qi2 + '_' + m3, m3, m2Corpus, idxM2, q2.query, qe2);
        var commonSet = {};
        base.forEach(function (id) { if (byId[id]) commonSet[id] = true; });
        aug.forEach(function (id) { if (byId[id]) commonSet[id] = true; });
        var common = Object.keys(commonSet);
        var baseSeq = base.filter(function (id) { return byId[id]; });
        var augSeq = aug.filter(function (id) { return byId[id]; });
        var tau = kendallTau(baseSeq, augSeq);
        var displaced = baseSeq.filter(function (id) { return augSeq.indexOf(id) === -1; });
        results.M2.push({ query: q2.id, method: m3, tau: tau, pass: tau >= 1, displaced: displaced.length });
        if (tau < 1) m2Fail.push({ query: q2.id, method: m3, tau: tau, displaced: displaced });
      }
    }

    // ═══ M3 版本单调性 ═══
    var m3Fail = [];
    for (var ai = 0; ai < m3arcs.length; ai++) {
      var arc = m3arcs[ai];
      var qe3 = await qEmbed(arc.query);
      for (var mi4 = 0; mi4 < METHODS.length; mi4++) {
        var m4 = METHODS[mi4];
        var r = await retrieve('m3_' + ai + '_' + m4, m4, m3Corpus, idxM3, arc.query, qe3);
        var fin = r.indexOf(arc.final.id);
        var ini = r.indexOf(arc.initial.id);
        var pass = fin !== -1 && (ini === -1 || fin < ini);
        results.M3.push({ query: arc.id + ' ' + arc.name, method: m4, pass: pass, finalRank: fin >= 0 ? fin + 1 : null, initialRank: ini >= 0 ? ini + 1 : null });
        if (!pass) m3Fail.push({ arc: arc.id, name: arc.name, method: m4, finalRank: fin >= 0 ? fin + 1 : null, initialRank: ini >= 0 ? ini + 1 : null });
      }
    }

    // ═══ M4 等价重排 ═══
    for (var qi3 = 0; qi3 < queries.length; qi3++) {
      var q4 = queries[qi3];
      var qe4 = await qEmbed(q4.query);
      for (var mi5 = 0; mi5 < METHODS.length; mi5++) {
        var m5 = METHODS[mi5];
        var base = await retrieve('m4b_' + qi3 + '_' + m5, m5, allSTM, idxBase, q4.query, qe4);
        var rev = await retrieve('m4a_' + qi3 + '_' + m5, m5, m4Corpus, idxM4, q4.query, qe4);
        var idEq = base.join() === rev.join();
        results.M4.push({ query: q4.id, method: m5, pass: idEq, base: base, rev: rev });
      }
    }

    // ── 聚合 + 报告 ──
    var L = [];
    L.push('# 变形关系断言报告（P1-met）');
    L.push('');
    L.push('- 语料：fixture.js 144 条；方法：' + METHODS.join(' / ') + '（Lin α=' + ALPHA + ', Top-' + K + '；LinRerank 因每次断言需 rerank API 不纳入，另测）');
    L.push('- dev 查询：' + queries.length + ' 条 | 扰动：M2 追加 ' + DISTRACTOR_SAMPLE + ' 条 orthogonal distractor；M3 追加 8 条 R 类事件；M4 语料逆序重排');
    L.push('- 所有断言确定性（固定语料 + 固定种子），无 LLM 参与');
    L.push('');
    L.push('## 1. 通过率表（关系 × 方法）');
    L.push('');
    L.push('| 关系 | ' + METHODS.join(' | ') + ' | 总检验数 |');
    L.push('|---|---|---|');
    ['M1', 'M2', 'M3', 'M4'].forEach(function (rel) {
      var cells = METHODS.map(function (m) {
        var items = results[rel].filter(function (r) { return r.method === m; });
        if (rel === 'M1') {
          var t = items.reduce(function (s, x) { return s + (x.total || 0); }, 0);
          var p = items.reduce(function (s, x) { return s + (x.passed || 0); }, 0);
          return t ? (p / t * 100).toFixed(1) + '%' : '—';
        }
        var passN = items.filter(function (r) { return r.pass; }).length;
        return items.length ? (passN / items.length * 100).toFixed(1) + '%' : '—';
      });
      var total = results[rel].length;
      L.push('| ' + rel + ' | ' + cells.join(' | ') + ' | ' + total + ' |');
    });
    L.push('');
    L.push('- M1 单调性：断言"baseline 已检索到的 GT 事件的聚合副本在膨胀语料下仍进 Top-' + K + '"；通过率 = 副本检索到 / 考虑的 GT 副本。');
    L.push('- M2 无关性：Kendall τ（原文档相对顺序在追加干扰后是否保持）；τ=1 通过。');
    L.push('- M3 版本单调性：4 组 R 类"初始 vs 最终"事件对，"当前状态"查询下最终版必须排在初始版前。');
    L.push('- M4 等价重排：语料逆序后 Top-' + K + ' 逐一相等即通过。');
    L.push('');
    L.push('## 2. M3 明细（版本单调性，AIRP 核心）');
    L.push('');
    L.push('| 组 | 方法 | 最终版排名 | 初始版排名 | 通过? |');
    L.push('|---|---|---|---|---|');
    results.M3.forEach(function (r) {
      L.push('| ' + r.query + ' | ' + r.method + ' | ' + (r.finalRank === null ? '未进Top' : r.finalRank) + ' | ' + (r.initialRank === null ? '未进Top' : r.initialRank) + ' | ' + (r.pass ? '✅' : '❌') + ' |');
    });
    L.push('');
    L.push('## 3. M1 失败明细（副本未被检索到）');
    L.push('');
    var m1fails = results.M1.filter(function (r) { return r.total > 0 && r.passed < r.total; });
    if (m1fails.length === 0) L.push('（无失败）');
    else m1fails.forEach(function (r) {
      L.push('- ' + r.query + ' ' + r.method + ': ' + r.passed + '/' + r.total + '，丢 ' + r.copiesLost.join(','));
    });
    L.push('');
    L.push('## 4. M2 失败明细（τ<1，干扰项改变原排序）');
    L.push('');
    if (m2Fail.length === 0) L.push('（无失败，主题正交干扰项不改变原排序）');
    else m2Fail.forEach(function (f) {
      L.push('- ' + f.query + ' ' + f.method + ': τ=' + f.tau.toFixed(2) + '，被挤出原文档 ' + f.displaced.length + ' 个');
    });
    L.push('');
    L.push('## 5. M4 明细（等价重排一致性）');
    L.push('');
    var m4fail = results.M4.filter(function (r) { return !r.pass; });
    if (m4fail.length === 0) L.push('全部方法在语料逆序下 Top-' + K + ' 完全一致（无实现级顺序依赖）。');
    else m4fail.forEach(function (f) { L.push('- ' + f.query + ' ' + f.method + ': 顺序不一致'); });
    L.push('');
    L.push('## 6. 判读');
    L.push('');
    L.push('- M3 若失败：实证"判别信息（版本/情态）未被检索器利用 → 检索失效"，直接进博客 Limitations 与抽取修复优先级。M3 的语料在 schema 修复落地后成为 modality 字段的第一个检索侧消费测试。');
    L.push('- M1/M2 若失败：检索器对语料膨胀（相关/与关噪声）状态敏感，需回看融合阈值与过滤。');

    var outDir = join(__dirname, 'output');
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 'metamorphic-report.md');
    writeFileSync(outPath, withProvenanceHeader('metamorphic', L.join('\n')), 'utf-8');

    console.log('\n\n=== 通过率 ===');
    ['M1', 'M2', 'M3', 'M4'].forEach(function (rel) {
      var cell = METHODS.map(function (m) {
        var it = results[rel].filter(function (r) { return r.method === m; });
        if (rel === 'M1') { var t = it.reduce(function (s, x) { return s + (x.total || 0); }, 0), p = it.reduce(function (s, x) { return s + (x.passed || 0); }, 0); return t ? (p / t * 100).toFixed(1) + '%' : '—'; }
        var n = it.filter(function (r) { return r.pass; }).length; return it.length ? (n / it.length * 100).toFixed(1) + '%' : '—';
      });
      console.log(rel + ': ' + cell.join(' | '));
    });
    console.log('M3 failures: ' + m3Fail.length + ' | M2 failures: ' + m2Fail.length + ' | M4 failures: ' + m4fail.length);
    console.log('报告: ' + outPath);
  })();
}

main().catch(function (e) {
  console.error('P1-met crashed:', e);
  process.exit(2);
});