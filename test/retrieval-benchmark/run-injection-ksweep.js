// run-injection-ksweep.js — 注入量 k 扫描（Phase B）：k=40/80/100 整窗灌入对比
// 计划：.trae/documents/injection-kscan-phaseb-plan.md
// 独立脚本：不改既有 injection-eval 产物。k=40 渲染必须复现既有 baseline（渲染闸门）。
// 读者=deepseek-v4-flash(temperature=0,盲评)；判定=确定性 contains。

import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { mergePipelines, groupCandidatesByEntity } from '../../src/core/engine/retrieval.js';
import { buildKeyHighlights } from '../../src/core/engine/injection.js';
import { linearFuse } from './benchmark-fusions.js';
import { allSTM, allLTM, allChatMessages } from './fixture.js';
import { qaAnchors } from './injection-qa-anchors.js';
import { askReader } from './judge-injection-arm-lib.js';
import { computeTuple } from './report-provenance.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_ksweep__';
var KSWEEP = [40, 80, 100];
var TOP_K_VEC = 144;   // fused 扩窗的 vector 深度（与 Step 0 一致）
var ALPHA = 0.20;      // linearFuse α（与 Step 0 / benchmark-topk-sweep 一致）
var RRF_K = 60;
var B = 10000;
var SEED = 42;
var OUT = join(__dirname, 'output', 'ksweep');
var OUT_BASE_INJ = join(__dirname, 'output', 'injection-eval');

process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;
delete process.env.NE_BENCHMARK_VECTOR;

var argv = process.argv;
var RENDER_ONLY = argv.includes('--render-only');
var NO_JUDGE = argv.includes('--no-judge');
var AGG_ONLY = argv.includes('--aggregate-only');
var JUDGE_ONLY = argv.includes('--judge-only');

var stmById = {};
allSTM.forEach(function (e) { stmById[e.id || e.__id] = e; });

function extractEntityNames(query, allEntityNames) {
  var q = query.toLowerCase();
  var matched = allEntityNames.filter(function (n) { return n.length > 1 && q.indexOf(n.toLowerCase()) !== -1; });
  matched.sort(function (a, b) { return b.length - a.length; });
  return matched.slice(0, 5);
}
function collectAllEntityNames() {
  var s = {}, names = [];
  allSTM.forEach(function (e) { (e.entities || []).forEach(function (en) { var n = typeof en === 'string' ? en : en.name; s[n] = 1; }); });
  return Object.keys(s);
}
function buildEntityChains(stmArr, names) {
  var chains = {};
  names.forEach(function (name) {
    var ce = stmArr.filter(function (e) { return e.entities && e.entities.some(function (en) { return (typeof en === 'string' ? en : en.name) === name; }); });
    if (ce.length) { ce.sort(function (a, b) { return ((a.msg_ids && a.msg_ids[0]) || 0) - ((b.msg_ids && b.msg_ids[0]) || 0); }); chains[name] = ce; }
  });
  return chains;
}
// 以下 buildContext / foldMissRunsText / applyPrefetch 与 run-injection-arms.js baseline 完全一致
// （渲染闸门硬约束：k40 文档必须逐锚复现既有 baseline）
function foldMissRunsText(entries) {
  var result = [], missRun = [], num = 0;
  function flushMiss() {
    if (missRun.length === 0) return;
    if (missRun.length === 1) {
      num++;
      var p = missRun[0].entry.period || '?';
      result.push(' ' + num + '. [' + p + '] （' + p + ' 未展开）');
    } else {
      num++;
      var fp = missRun[0].entry.period || '?';
      var lp = missRun[missRun.length - 1].entry.period || '?';
      result.push(' ' + num + '. [' + fp + '] ' + fp + '-' + lp + '（' + missRun.length + '条事件未展开）');
    }
    missRun = [];
  }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.relevance > 0) {
      flushMiss();
      num++;
      var period = e.entry.period || '?';
      var scene = e.entry.scene || '';
      var event = e.entry.event || e.entry.summary || '';
      var line = ' ' + num + '. [' + period + '] ' + (scene ? scene + ': ' : '') + event;
      if (e._originalText) line += '\n   > ' + e._originalText.replace(/\n/g, '\n   > ');
      result.push(line);
    } else {
      missRun.push(e);
    }
  }
  flushMiss();
  return result;
}

function buildContext(mergedMap, grouped, activeEntities, withHighlights) {
  var lines = [];
  if (withHighlights) {
    var hl = buildKeyHighlights(mergedMap, grouped, 5);
    if (hl) {
      lines.push(hl);
      lines.push('---');
    }
  }
  lines.push('## 实体记忆链');
  lines.push('');
  var activeNames = [];
  var externalNames = [];
  Object.keys(grouped.groups).forEach(function (name) {
    if (activeEntities && activeEntities.indexOf(name) !== -1) activeNames.push(name);
    else externalNames.push(name);
  });

  function renderGroup(name, group) {
    var entries = group.entries;
    var total = entries.length;
    var hitCount = entries.filter(function (e) { return e.relevance > 0; }).length;
    var refCount = group.refs ? group.refs.length : 0;
    lines.push('### ' + name + ' (' + total + ' events in chain, ' + hitCount + ' hits, ' + refCount + ' refs)');
    var textLines = foldMissRunsText(entries);
    textLines.forEach(function (l) { lines.push(l); });
    if (group.refs && group.refs.length > 0) {
      var refIds = group.refs.map(function (r) { return r.entryId; });
      var refNames = [];
      group.refs.forEach(function (r) { if (refNames.indexOf(r.primaryName) === -1) refNames.push(r.primaryName); });
      lines.push('   关联: 见' + refNames.map(function (n) { return '\u300c' + n + '\u300d'; }).join('') + ' ' + refIds.join(', '));
    }
    lines.push('');
  }
  activeNames.forEach(function (name) { renderGroup(name, grouped.groups[name]); });
  if (grouped.unassigned && grouped.unassigned.length > 0) {
    lines.push('### 未标注条目 (' + grouped.unassigned.length + ' entries)');
    grouped.unassigned.forEach(function (e, i) {
      var period = e.entry.period || '?';
      var scene = e.entry.scene || '';
      var event = e.entry.event || e.summary || '';
      lines.push(' ' + (i + 1) + '. [' + period + '] ' + (scene ? scene + ': ' : '') + event);
    });
    lines.push('');
  }
  if (externalNames.length > 0) {
    lines.push('### 场景外角色');
    lines.push('');
    externalNames.forEach(function (name) { renderGroup(name, grouped.groups[name]); });
  }
  return lines.join('\n');
}

function applyPrefetch(mapObj, chatMessages, topK) {
  if (!chatMessages || chatMessages.length === 0) return;
  topK = topK || 3;
  var entries = [];
  mapObj.forEach(function (v) { entries.push(v); });
  entries.sort(function (a, b) { return (b.relevance || 0) - (a.relevance || 0); });
  entries.slice(0, topK).forEach(function (entry) {
    var msgIds = entry.entry.msg_ids;
    if (!msgIds || msgIds.length === 0) return;
    var originalLines = [];
    msgIds.forEach(function (mid) {
      var msg = chatMessages.find(function (m) { return String(m.id) === String(mid); });
      if (msg) {
        var text = typeof msg.mes === 'string' ? msg.mes : (msg.content || '');
        if (text) originalLines.push('[msg_' + mid + '] ' + text.substring(0, 200));
      }
    });
    if (originalLines.length > 0) entry._originalText = originalLines.join('\n');
  });
}
function measureDoc(docText, anchor) {
  var len = Math.max(docText.length, 1), covered = 0, positions = [];
  (anchor.gtEventIds || []).forEach(function (eid) {
    var ev = stmById[eid]; if (!ev) return;
    var frag = ev.event || ev.summary || ''; if (!frag) return;
    var idx = docText.indexOf(frag); if (idx === -1) idx = docText.indexOf(frag.slice(0, 20));
    if (idx !== -1) { covered++; positions.push(idx / len); }
  });
  return { docChars: docText.length, docTokens: Math.round(docText.length / 1.6), gtCovered: covered, gtTotal: (anchor.gtEventIds || []).length, firstOccurrencePct: positions.length ? Math.min.apply(null, positions) : null, positions: positions };
}
function judgeFact(answer, expect) {
  var ex = Array.isArray(expect) ? expect : [expect];
  var a = String(answer || '');
  return ex.some(function (x) { return a.indexOf(x) !== -1; });
}

async function renderArm(k) {
  var kDir = join(OUT, 'k' + k, 'docs');
  mkdirSync(kDir, { recursive: true });
  resetVectorIndex(CHAT_ID);
  await ensureVectorIndex(allSTM, {}, CHAT_ID);
  var vecIdx = getVectorIndex(CHAT_ID);
  var entityNames = collectAllEntityNames();
  for (var qi = 0; qi < qaAnchors.length; qi++) {
    var a = qaAnchors[qi];
    delete process.env.NE_BENCHMARK_VECTOR;
    var bm25 = await filterCandidates(a.query, allSTM, allLTM, 40, 3, {}, CHAT_ID);
    var bm25Ids = bm25.filter(function (r) { return !r.__isDirectory; }).map(function (r) { return r.__id || r.id; });
    var pool = bm25;
    if (k !== 40) {
      // 整窗灌入扩展：fused top-k 候选池（k=40 保留 BM25-40 以复现 baseline）
      // 生产管线 filterCandidates 对 BM25 topK 硬封 40（denoiseResults.slice(0,40) + isAuto topK），
      // 因此放宽只能从 vector 侧扩窗：Step 0 的 rank 口径本就是 BM25-40 ∪ vector-144 fused。
      setBgeM3();
      var qemb = await computeEmbedding(a.query);
      var vres = vectorSearch(qemb, vecIdx, TOP_K_VEC);
      var fusedIds = linearFuse(bm25Ids, vres.map(function (v) { return v.entry.id; }), ALPHA, TOP_K_VEC, RRF_K).slice(0, k);
      var emap = {};
      bm25.forEach(function (r) { emap[r.__id || r.id] = r; });
      pool = fusedIds.map(function (id, i) { return emap[id] || stmById[id]; }).filter(Boolean)
        .map(function (r, i) { var c = Object.assign({ __id: r.__id || r.id, __type: 'stm' }, r); c.__relevance = 1 / (1 + i); return c; });
    }
    var ent = extractEntityNames(a.query, entityNames);
    var chains = buildEntityChains(allSTM, ent);
    var merged = await mergePipelines(pool, chains, allLTM, { characters: {}, factions: {} }, allSTM);
    var grouped = groupCandidatesByEntity(merged.map, merged.threadIndex);
    applyPrefetch(merged.map, allChatMessages, 3);
    var text = buildContext(merged.map, grouped, ent, false);
    var metrics = measureDoc(text, a);
    var obj = { arm: 'k' + k, anchorId: a.id, tier: a.type, query: a.query, text: text, metrics: metrics, bm25CandidateCount: pool.length };
    writeFileSync(join(kDir, a.id + '.json'), JSON.stringify(obj, null, 2), 'utf-8');
    console.log('[k' + k + '][' + a.id + '] docTokens=' + metrics.docTokens + ' cover=' + metrics.gtCovered + '/' + metrics.gtTotal);
  }
}
function setBgeM3() { process.env.EMBEDDING_MODEL = 'BAAI/bge-m3'; }

async function judgeArm(k) {
  var kDir = join(OUT, 'k' + k, 'docs');
  var jDir = join(OUT, 'k' + k);
  mkdirSync(jDir, { recursive: true });
  for (var qi = 0; qi < qaAnchors.length; qi++) {
    var a = qaAnchors[qi];
    var docPath = join(kDir, a.id + '.json');
    if (!existsSync(docPath)) continue;
    var doc = JSON.parse(readFileSync(docPath, 'utf-8'));
    for (var fi = 0; fi < a.facts.length; fi++) {
      var fact = a.facts[fi];
      var outPath = join(jDir, a.id + '-f' + fi + '.json');
      if (existsSync(outPath)) { process.stdout.write('.'); continue; }
      var res;
      try { res = await askReader(doc.text, fact.q); }
      catch (e) { res = { parseOk: false, answer: 'ERR:' + (e && e.message), found: false, raw: '' }; }
      res.arm = 'k' + k; res.anchorId = a.id; res.factIdx = fi; res.tier = a.type; res.question = fact.q;
      writeFileSync(outPath, JSON.stringify(res, null, 2), 'utf-8');
      console.log('\n[k' + k + '][' + a.id + '-f' + fi + '] ' + (res.parseOk ? (res.found ? 'found' : 'notfound') : 'PARSE') + ' ' + String(res.answer).slice(0, 24));
    }
  }
  console.log('\n[k' + k + '] judge done');
}

// ── 读取某臂的逐事实判定（memory 复用 judge dump 或 ksweep dump）──
function collectFacts(armDir, arm) {
  if (!existsSync(armDir)) return [];
  var files = readdirSync(armDir).filter(function (f) { return f.indexOf('-f') !== -1 && f.endsWith('.json'); });
  var out = [];
  files.forEach(function (f) {
    var d = JSON.parse(readFileSync(join(armDir, f), 'utf-8'));
    var anchor = qaAnchors.find(function (x) { return x.id === d.anchorId; });
    if (!anchor) return;
    var fact = anchor.facts[d.factIdx];
    var verdict = 0;
    if (d.parseOk) { if (d.found && judgeFact(d.answer, fact.expect)) verdict = 1; }
    else verdict = -1; // parseFail 标记
    out.push({ anchorId: d.anchorId, factIdx: d.factIdx, tier: d.tier || anchor.type, verdict: verdict, parseOk: d.parseOk });
  });
  return { arm: arm, facts: out };
}

function aggregateByTier(facts) {
  var t = { state: { total: 0, correct: 0, notfound: 0, parseFail: 0 }, narrative: { total: 0, correct: 0, notfound: 0, parseFail: 0 } };
  facts.forEach(function (f) {
    if (!t[f.tier]) t[f.tier] = { total: 0, correct: 0, notfound: 0, parseFail: 0 };
    t[f.tier].total++;
    if (!f.parseOk) { t[f.tier].parseFail++; return; }
    if (f.verdict === 1) t[f.tier].correct++;
    if (f.verdict === 0) t[f.tier].notfound++;
  });
  return t;
}

// ── 锚级聚类 bootstrap（与 canonical injectionMain pairTest 一致口径）──
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function percentile(arr, q) { var s = arr.slice().sort(function (a, b) { return a - b; }); return s[Math.floor(q * (s.length - 1))]; }
function mean(arr) { return arr.reduce(function (s, x) { return s + x; }, 0) / (arr.length || 1); }
function signTestP(diffs) {
  var pos = 0, neg = 0;
  diffs.forEach(function (d) { if (d > 1e-9) pos++; else if (d < -1e-9) neg++; });
  var nn = pos + neg;
  if (nn === 0) return 1;
  var m = Math.max(pos, neg);
  var p = 0;
  for (var x = m; x <= nn; x++) p += comb(nn, x) * Math.pow(0.5, nn);
  return Math.min(1, 2 * p);
}
function comb(n, k) { k = Math.min(k, n - k); var r = 1; for (var i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }
function anchorBootstrap(aFacts, bFacts, tier) {
  var a = aFacts.filter(function (f) { return (f.tier || 'state') === tier && f.parseOk; });
  var b = bFacts.filter(function (f) { return (f.tier || 'state') === tier && f.parseOk; });
  var bm = {};
  b.forEach(function (f) { bm[f.anchorId + '|' + f.factIdx] = f.verdict; });
  var pairs = a.filter(function (f) { return bm[f.anchorId + '|' + f.factIdx] !== undefined; })
    .map(function (f) { return { anchorId: f.anchorId, a: f.verdict, b: bm[f.anchorId + '|' + f.factIdx] }; });
  if (!pairs.length) return null;
  var rateA = mean(pairs.map(function (p) { return p.a; })), rateB = mean(pairs.map(function (p) { return p.b; }));
  var diffs = pairs.map(function (p) { return p.b - p.a; });
  var anchors = [];
  pairs.forEach(function (p) { if (anchors.indexOf(p.anchorId) === -1) anchors.push(p.anchorId); });
  var byAn = {};
  anchors.forEach(function (id) { byAn[id] = pairs.filter(function (p) { return p.anchorId === id; }); });
  var rnd = mulberry32(SEED), boot = [];
  for (var bi = 0; bi < B; bi++) {
    var sample = [];
    for (var ai = 0; ai < anchors.length; ai++) { var pick = anchors[Math.floor(rnd() * anchors.length)]; sample = sample.concat(byAn[pick]); }
    boot.push(mean(sample.map(function (p) { return p.b - p.a; })));
  }
  var ci = { lo: percentile(boot, 0.025), hi: percentile(boot, 0.975) };
  return { n: pairs.length, rateA: rateA, rateB: rateB, md: mean(diffs), ci: ci, p: signTestP(diffs) };
}
function wordingK(md, ci) {
  var pp = Math.abs(md) * 100;
  if (pp < 5) return '无可测差异';
  if (md > 0 && ci.lo > 0 && pp >= 10) return '显著有益';
  if (md < 0 && ci.hi < 0 && pp >= 10) return '显著有害';
  return '方向性观察';
}

async function main() {
  if (AGG_ONLY) { analyze(); return; }
  if (!JUDGE_ONLY) { for (var i = 0; i < KSWEEP.length; i++) { if (RENDER_ONLY || !NO_JUDGE) await renderArm(KSWEEP[i]); } }
  if (!RENDER_ONLY && !NO_JUDGE) { for (var j = 0; j < KSWEEP.length; j++) await judgeArm(KSWEEP[j]); }
  if (RENDER_ONLY || NO_JUDGE) { console.log('\n渲染完成（未判）；--aggregate-only 重跑分析'); }
  else analyze();
}

function analyze() {
  var kArms = {};
  KSWEEP.forEach(function (k) { kArms['k' + k] = collectFacts(join(OUT, 'k' + k), 'k' + k); });
  var ref = {};
  var refNames = { baseline: 'baseline', coverfix: 'coverfix', oracle: 'oracle' };
  Object.keys(refNames).forEach(function (rn) { ref[rn] = collectFacts(join(OUT_BASE_INJ, rn), rn); });

  var agg = {};
  ['k40', 'k80', 'k100'].concat(Object.keys(ref)).forEach(function (arm) {
    var src = kArms[arm] || ref[arm];
    agg[arm] = aggregateByTier(src ? src.facts : []);
  });

  // L0 doc 统计（k 档）
  var l0 = {};
  KSWEEP.forEach(function (k) {
    var dir = join(OUT, 'k' + k, 'docs'); var arr = [];
    if (existsSync(dir)) readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).forEach(function (f) { arr.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')).metrics || {}); });
    var dt = arr.map(function (m) { return m.docTokens || 0; });
    l0['k' + k] = { anchors: arr.length, meanDocTokens: mean(dt), totalCover: arr.reduce(function (s, m) { return s + m.gtCovered; }, 0), totalGt: arr.reduce(function (s, m) { return s + m.gtTotal; }, 0) };
  });

  function row(a, b, tier) {
    var r = anchorBootstrap(kArms[a] ? kArms[a].facts : ref[a].facts, kArms[b] ? kArms[b].facts : ref[b].facts, tier);
    return r ? { n: r.n, rateA: r.rateA * 100, rateB: r.rateB * 100, md: r.md * 100, lo: r.ci.lo * 100, hi: r.ci.hi * 100, p: r.p, w: wordingK(r.md, r.ci) } : null;
  }

  var L = [];
  L.push('# 注入量 k 扫描 · Phase B 结果（k=40/80/100 整窗灌入）');
  L.push(''); 
  var t = computeTuple(null, { fixturePath: join(__dirname, 'injection-qa-anchors.js'), armPromptText: 'injection-kscan-phaseb ' + KSWEEP.join('/'), split: 'dev' });
  var headTxt = ['<!-- version: report=injection-ksweep fixture=' + t.fixture + ' queries=' + t.queries + ' split=' + t.split + ' config=' + t.config + ' judge=' + t.judge + ' -->'];
  L[0] = headTxt[0] + '\n# 注入量 k 扫描 · Phase B 结果（k=40/80/100 整窗灌入）';
  L.push('**生成**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  L.push('**方法**: 锚级聚类配对 bootstrap B=' + B + '（seed=' + SEED + '）+ 双侧符号检验；读者=deepseek-v4-flash(temp=0)。');
  L.push('**预注册措辞**: Δ≥10pp 且 CI 下界>0 → 显著有益；|Δ|<5pp → 无可测差异；否则方向性观察。');
  L.push('');

  L.push('## 1. 各臂正确率（逐 tier）');
  L.push('| 臂 | state n/c | state % | narrative n/c | narrative % |');
  L.push('|---|---|---|---|---|');
  ['k40', 'k80', 'k100', 'baseline', 'coverfix', 'oracle'].forEach(function (a) {
    var s = agg[a].state, n = agg[a].narrative;
    L.push('| ' + a + ' | ' + s.correct + '/' + s.total + ' | ' + (s.total ? (s.correct / s.total * 100).toFixed(1) + '%' : '-') + ' | ' + n.correct + '/' + n.total + ' | ' + (n.total ? (n.correct / n.total * 100).toFixed(1) + '%' : '-') + ' |');
  });
  L.push('');
  L.push('## 2. L0 文档度量（token 成本 + 覆盖）');
  L.push('| k | 平均 docTokens | 覆盖(GT) |');
  L.push('|---|---|---|');
  KSWEEP.forEach(function (k) { L.push('| k' + k + ' | ' + l0['k' + k].meanDocTokens.toFixed(0) + ' | ' + l0['k' + k].totalCover + '/' + l0['k' + k].totalGt + ' |'); });
  L.push('');
  L.push('> 预算参照：现状(k=40) 完整注入 doc ~2900 token 已归档；4400 = 1.5× 预算限。');
  L.push('');
  L.push('## 3. 数量/稀释/选择 三分解（锚级聚类 bootstrap）');
  function sec(title, a, b) {
    var narr = row(a, b, 'narrative'), st = row(a, b, 'state');
    L.push('### ' + title);
    L.push('| tier | n | A | B | Δ | 95% CI | p | 措辞 |');
    L.push('|---|---|---|---|---|---|---|---|');
    if (st) L.push('| state | ' + st.n + ' | ' + st.rateA.toFixed(1) + '% | ' + st.rateB.toFixed(1) + '% | ' + (st.md >= 0 ? '+' : '') + st.md.toFixed(1) + 'pp | [' + st.lo.toFixed(1) + ', ' + st.hi.toFixed(1) + '] | ' + st.p.toFixed(3) + ' | ' + st.w + ' |');
    if (narr) L.push('| narrative | ' + narr.n + ' | ' + narr.rateA.toFixed(1) + '% | ' + narr.rateB.toFixed(1) + '% | ' + (narr.md >= 0 ? '+' : '') + narr.md.toFixed(1) + 'pp | [' + narr.lo.toFixed(1) + ', ' + narr.hi.toFixed(1) + '] | ' + narr.p.toFixed(3) + ' | ' + narr.w + ' |');
    if (!st && !narr) L.push('（无配对）');
    L.push('');
  }
  sec('3.1 数量效应：k80 vs k40', 'k40', 'k80');
  sec('3.2 数量效应(更大)：k100 vs k40', 'k40', 'k100');
  sec('3.3 稀释检查：k100 vs k80', 'k80', 'k100');
  sec('3.4 选择效应上界：k100 vs coverfix(40型)', 'coverfix', 'k100');
  L.push('');
  L.push('## 4. 决策预读');
  L.push('- 若 k80/k100 narrative 显著有益且 meanDocTokens ≤ 4400 → 采纳整窗扩档。');
  L.push('- 若显著有益但 token 超预算 → 立项"扩窗+回选"（两段），整窗仅作上界。');
  L.push('- 若无可测差异或稀释显现 → 整窗无效论，覆盖修复回到排名侧。');
  L.push('');
  L.push('- **LLM 非确定性**：正确率由单读者判定（噪声=中，见 canonical §0）；检索/渲染确定性。');

  mkdirSync(OUT, { recursive: true });
  var report = L.join('\n');
  writeFileSync(join(OUT, 'report.md'), report, 'utf-8');
  writeFileSync(join(OUT, 'aggregate-ksweep.json'), JSON.stringify({ arms: agg, l0: l0 }, null, 2), 'utf-8');
  console.log('\n报告: ' + join(OUT, 'report.md'));
  console.log('k40 narrative: ' + agg.k40.narrative.correct + '/' + agg.k40.narrative.total, '| k80: ' + agg.k80.narrative.correct + '/' + agg.k80.narrative.total, '| k100: ' + agg.k100.narrative.correct + '/' + agg.k100.narrative.total);
  console.log('l0 meanDocTokens: ' + KSWEEP.map(function (k) { return 'k' + k + '=' + l0['k' + k].meanDocTokens.toFixed(0); }).join(' '));
}

main().catch(function (e) { console.error('FATAL', e); process.exit(1); });