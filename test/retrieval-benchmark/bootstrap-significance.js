// 统计显著性基建 —— P0-1（benchmark-improvement-plan §4）
// 配对 bootstrap（B=10000，固定种子）+ 符号检验 + 预注册措辞三选一
// 输入：per-query-scores.json（benchmark-perquery.js 产出）与 scale-benchmark-scores.json（benchmark-scale.js 产出）
// 用法：node bootstrap-significance.js [--split dev|holdout|all]（默认 dev）
//   - dev/holdout/all：从对应 output 目录读 dump、写 output/significance-report.md（holdout 走 output/holdout/）
//   - holdout 仅在配置冻结后运行一次（封存纪律，见 queries-split.json _meta）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSplitName, outputDirFor } from './query-split-utils.js';
import { withProvenanceHeader, computeTuple } from './report-provenance.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var B = 10000;
var SEED = 20260818;
var MODEL_8B = 'Qwen3-E-8B';
var MODEL_BGE = 'bge-m3';

// ── 统计原语（零依赖）──

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(arr, p) {
  var a = arr.slice().sort(function (x, y) { return x - y; });
  var idx = p * (a.length - 1);
  var lo = Math.floor(idx), hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

function binom(n, k) {
  k = Math.min(k, n - k);
  var c = 1;
  for (var i = 0; i < k; i++) c = c * (n - i) / (i + 1);
  return c;
}

// 配对差值的双侧符号检验（排除 0 差）；n 小 / 强并列时比 t 检验稳健
function signTestP(diffs) {
  var pos = 0, neg = 0;
  diffs.forEach(function (d) { if (d > 0) pos++; else if (d < 0) neg++; });
  var nEff = pos + neg;
  if (nEff === 0) return 1;
  var m = Math.max(pos, neg);
  var p = 0;
  for (var x = m; x <= nEff; x++) p += binom(nEff, x) * Math.pow(0.5, nEff);
  return Math.min(1, 2 * p);
}

// 配对 bootstrap：有放回重采样 B 次差值均值 → 95% percentile CI
function bootstrapCI(diffs, bb, seed) {
  var n = diffs.length;
  var rng = mulberry32(seed);
  var means = new Array(bb);
  for (var it = 0; it < bb; it++) {
    var sum = 0;
    for (var j = 0; j < n; j++) sum += diffs[Math.floor(rng() * n)];
    means[it] = sum / n;
  }
  return { lo: percentile(means, 0.025), hi: percentile(means, 0.975) };
}

// 预注册措辞规则（§4.4，写死在输出里，不许事后改）
function wording(meanDiff, ci) {
  var pp = Math.abs(meanDiff) * 100;
  var containsZero = ci.lo <= 0 && ci.hi >= 0;
  if (pp < 2) return '无可测差异';
  if (containsZero) return '方向性观察（样本不足以定论）';
  if (pp >= 5) return '显著优于';
  return '显著倾向（CI 不含 0，幅度<5pp）';
}

function mean(arr) {
  return arr.reduce(function (s, x) { return s + x; }, 0) / (arr.length || 1);
}

function f(v) { return v.toFixed(3); }

// ── 读 dump ──
function readDump(name) {
  var p = join(outputDirFor(__dirname), name);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null;
}

// 总体对比段（含子组，子组只报 CI）
function pairSection(L, rows, getA, getB, title, note) {
  var a = rows.map(getA);
  var b = rows.map(getB);
  var diffs = a.map(function (x, i) { return x - b[i]; });
  var n = diffs.length;
  var md = mean(diffs);
  var ci = bootstrapCI(diffs, B, SEED);
  var pSign = signTestP(diffs);
  L.push('### ' + title);
  L.push('');
  if (note) { L.push('> ' + note); L.push(''); }
  L.push('| n | ΔWS | 95% CI | 符号检验 p | 措辞 |');
  L.push('|---|---|---|---|---|');
  L.push('| ' + n + ' | ' + f(md) + ' | [' + f(ci.lo) + ', ' + f(ci.hi) + '] | ' + pSign.toFixed(3) + ' | ' + wording(md, ci) + ' |');
  L.push('');
  ['narrative', 'targeted'].forEach(function (t) {
    var sub = [];
    for (var i = 0; i < rows.length; i++) if (rows[i].type === t) sub.push(i);
    if (sub.length === 0) return;
    var sd = sub.map(function (i) { return a[i] - b[i]; });
    var sci = bootstrapCI(sd, B, SEED);
    L.push('- 子组 **' + t + '**（n=' + sd.length + '）：ΔWS=' + f(mean(sd)) + '，95% CI [' + f(sci.lo) + ', ' + f(sci.hi) + '] — **仅 CI，不下结论**');
  });
  L.push('');
}

function scaleSection(L, scale, title, modelA, modeA, modelB, modeB, field) {
  L.push('### ' + title);
  L.push('');
  L.push('| 规模 | n | ΔWS | 95% CI | 符号检验 p | 措辞 |');
  L.push('|---|---|---|---|---|---|');
  var sizes = scale._meta.config.sizes;
  sizes.forEach(function (s) {
    var a = scale.results[modelA][modeA][s][field];
    var b = scale.results[modelB][modeB][s][field];
    if (!a || !b) return;
    var diffs = a.map(function (x, i) { return x - b[i]; });
    var md = mean(diffs);
    var ci = bootstrapCI(diffs, B, SEED);
    L.push('| ' + s + ' | ' + diffs.length + ' | ' + f(md) + ' | [' + f(ci.lo) + ', ' + f(ci.hi) + '] | ' + signTestP(diffs).toFixed(3) + ' | ' + wording(md, ci) + ' |');
  });
  L.push('');
}

function main() {
  // ─── Modality 臂评测模式（--modality [--corpus dev|holdout]）───
  if (process.argv.includes('--modality')) {
    modalityMain();
    return;
  }

  // ─── 注入侧臂评测模式（--injection，三层仪器：校准闸门 + 配对检验 + L2 相关）───
  if (process.argv.includes('--injection')) {
    injectionMain();
    return;
  }

  var split = getSplitName();
  var outDir = outputDirFor(__dirname);
  mkdirSync(outDir, { recursive: true });

  var L = [];
  L.push('# 统计显著性报告（P0-1）');
  L.push('');
  L.push('- Split：' + split);
  L.push('- 方法：配对 bootstrap（B=' + B + '，固定种子 ' + SEED + '）+ 双侧符号检验');
  L.push('- 版本四元组：' + JSON.stringify(computeTuple()));
  L.push('');

  L.push('## 措辞规则（预注册，§4.4 — 写死，跑后不挑读数）');
  L.push('');
  L.push('- CI 不含 0 且 |Δ|≥5pp → **显著优于**');
  L.push('- CI 含 0 → **方向性观察（样本不足以定论）**');
  L.push('- |Δ|<2pp → **无可测差异**');
  L.push('- 边界（CI 不含 0 但 2pp≤|Δ|<5pp）→ 显著倾向（明确标注）');
  L.push('- 子组（narrative / targeted）只报 CI，不下显著性结论');
  L.push('');
  L.push('---');
  L.push('');

  var perQuery = readDump('per-query-scores.json');
  if (perQuery) {
    var rows = perQuery.queries;
    L.push('## 1. 融合对比（per-query-scores.json，split=' + perQuery._meta.split + '）');
    L.push('');
    pairSection(L, rows, function (r) { return r.RRF; }, function (r) { return r.BM25; },
      '1.1 wRRF(RRF k=60) vs BM25', '支撑"融合略优"是否站得住');
    pairSection(L, rows, function (r) { return r.RRF; }, function (r) { return r.Vector; },
      '1.2 wRRF(RRF k=60) vs Vector', '支撑"融合略优"是否站得住');
    pairSection(L, rows, function (r) { return r.LinRerank; }, function (r) { return r.Lin; },
      '1.3 Lin+Rerank vs Lin（总体 + 分类型）', 'rerank 分裂（narrative 增益 vs targeted 拖累）的证据强度');
    pairSection(L, rows, function (r) { return r.Lin; }, function (r) { return r.Vector; },
      '1.4 Lin(α=0.20) vs Vector', '融合是否真的优于/劣于纯向量');
    pairSection(L, rows, function (r) { return r.LinRerank; }, function (r) { return r.Vector; },
      '1.5 Lin+Rerank vs Vector', 'rerank 融合 vs 纯向量的证据强度');
    pairSection(L, rows, function (r) { return r.RRF; }, function (r) { return r.Lin; },
      '1.6 RRF vs Lin(α=0.20)', '两种融合方式之争（冻结前决策依据）');
  } else {
    L.push('## 1. 融合对比');
    L.push('- `per-query-scores.json` 不存在，跳过（先跑 `node benchmark-perquery.js`）');
  }
  L.push('');

  var scale = readDump('scale-benchmark-scores.json');
  if (scale) {
    L.push('## 2. 模型对比（scale-benchmark-scores.json，split=' + scale._meta.split + '）');
    L.push('');
    scaleSection(L, scale, '2.1 ' + MODEL_BGE + ' vs ' + MODEL_8B + '（summary 模式，per 规模）',
      MODEL_BGE, 'summary', MODEL_8B, 'summary', 'lin');
    scaleSection(L, scale, '2.2 summary vs raw（' + MODEL_BGE + '，per 规模）',
      MODEL_BGE, 'summary', MODEL_BGE, 'raw', 'lin');
  } else {
    L.push('## 2. 模型对比');
    L.push('- `scale-benchmark-scores.json` 不存在，跳过（先跑 `node benchmark-scale.js`）');
  }
  L.push('');

  L.push('## 3. 审计 §01 粗算复核');
  L.push('');
  L.push('- 发布前用本报告核对 `benchmark-hardness-audit.html` §01 的 p≈0.56 粗算；若被推翻，同步更新该审计 HTML。');

  var report = L.join('\n');
  var outPath = join(outDir, 'significance-report.md');
  writeFileSync(outPath, withProvenanceHeader('significance', report), 'utf-8');
  console.log('Significance report: ' + outPath);
  console.log('提示：holdout 只在配置冻结后运行一次（封存纪律）。');
}

// ─── Modality 臂评测：逐条配对符号检验 + 反悔子集 bootstrap CI ───
function modalityMain() {
  var corpus = process.argv.indexOf('--corpus') !== -1 ? process.argv[process.argv.indexOf('--corpus') + 1] : 'dev';
  var baseDir = join(__dirname, 'output', 'modality-eval', corpus);
  var summaryPath = join(baseDir, 'verdicts-summary.json');
  if (!existsSync(summaryPath)) {
    console.error('缺 ' + summaryPath + '，先跑 run-modality-arms.js + judge-modality-arm.js');
    process.exit(1);
  }
  var summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
  var ARMS = ['base', 'B', 'C', 'D'];
  // 每 (arm,case) 存活编码：1=yes，0=其余（保守口径，与审计一致）
  function scoreOf(arm, caseId) {
    var r = summary.find(function (x) { return x.arm === arm && x.caseId === caseId; });
    return r && r.survived === 'yes' ? 1 : 0;
  }
  var caseIds = [];
  summary.forEach(function (r) { if (caseIds.indexOf(r.caseId) === -1) caseIds.push(r.caseId); });

  var L = [];
  L.push('# Modality 臂评测 · 决策统计（corpus=' + corpus + '）');
  L.push('- 方法：逐条配对符号检验 + 配对 bootstrap（B=' + B + '）');
  L.push('- 存活口径：yes=1，其余=0（保守）\n');

  L.push('## 措辞规则（预注册）');
  L.push('- CI 不含 0 且 |Δ|≥0.25（≥25pp，n 小）→ **显著优于/劣于**');
  L.push('- CI 含 0 → **方向性观察（样本不足以定论）**');
  L.push('- |Δ|<0.05 → **无可测差异**');
  L.push('');

  function pairTable(title, aArm, bArm, notes) {
    var a = [], b = [], ids = [];
    caseIds.forEach(function (id) {
      var av = scoreOf(aArm, id), bv = scoreOf(bArm, id);
      a.push(av); b.push(bv); ids.push(id);
    });
    var diffs = a.map(function (x, i) { return x - b[i]; });
    var md = mean(diffs);
    var ci = bootstrapCI(diffs, B, SEED);
    var pSign = signTestP(diffs);
    L.push('### ' + title + '（n=' + diffs.length + '）');
    if (notes) { L.push(''); L.push('> ' + notes); }
    L.push('| Δ存活率 | 95% CI | 符号检验 p | 措辞 |');
    L.push('|---|---|---|---|');
    L.push('| ' + (md * 100).toFixed(0) + 'pp | [' + (ci.lo * 100).toFixed(0) + ', ' + (ci.hi * 100).toFixed(0) + '] | ' + pSign.toFixed(3) + ' | ' + wording(md, ci) + ' |');
    L.push('');
    // 显式/隐式子组（仅反悔相关，只报 CI 不下结论）
    [true, false].forEach(function (exp) {
      var sA = [], sB = [];
      ids.forEach(function (id, i) {
        var r = summary.find(function (x) { return x.caseId === id && x.arm === bArm; });
        if (r && r.explicit === exp) { sA.push(a[i]); sB.push(b[i]); }
      });
      if (sA.length > 1) {
        var sd = sA.map(function (x, i) { return x - sB[i]; });
        var sci = bootstrapCI(sd, B, SEED);
        L.push('- 子组**' + (exp ? '显式' : '隐式') + '**（n=' + sd.length + '）：Δ=' + (mean(sd) * 100).toFixed(0) + 'pp，95% CI [' + (sci.lo * 100).toFixed(0) + ', ' + (sci.hi * 100).toFixed(0) + '] — **仅 CI，不下结论**');
      }
    });
    L.push('');
  }

  pairTable('B vs base（全类别）', 'B', 'base', 'modality 枚举字段是否提升总存活率');
  pairTable('C vs base（全类别）', 'C', 'base', 'modality+final_status 是否提升总存活率');
  pairTable('B vs C（全类别）', 'B', 'C', '两者是否可区分；平手取更简单的 B（预注册规则 2）');
  pairTable('D vs base（全类别）', 'D', 'base', 'resolve-rewrite 二段式是否提升总存活率');
  pairTable('D vs B（全类别）', 'D', 'B', 'resolve-rewrite vs 纯字段方案');

  L.push('## 反悔类（主指标）');
  var revIds = caseIds.filter(function (id) {
    var r = summary.find(function (x) { return x.caseId === id && x.arm === 'base'; });
    return r && r.category === 'reversal';
  });
  function revPair(title, aArm, bArm) {
    var a = revIds.map(function (id) { return scoreOf(aArm, id); });
    var b = revIds.map(function (id) { return scoreOf(bArm, id); });
    var diffs = a.map(function (x, i) { return x - b[i]; });
    var md = mean(diffs), ci = bootstrapCI(diffs, B, SEED);
    L.push('### 反悔 ' + title + '（n=' + diffs.length + '）');
    L.push('| Δ存活率 | 95% CI | 符号检验 p | 措辞 |');
    L.push('|---|---|---|---|');
    L.push('| ' + (md * 100).toFixed(0) + 'pp | [' + (ci.lo * 100).toFixed(0) + ', ' + (ci.hi * 100).toFixed(0) + '] | ' + signTestP(diffs).toFixed(3) + ' | ' + wording(md, ci) + ' |');
    L.push('');
  }
  revPair('B vs base', 'B', 'base');
  revPair('C vs base', 'C', 'base');
  revPair('C vs B', 'C', 'B');
  revPair('D vs base', 'D', 'base');
  revPair('D vs B', 'D', 'B');

  L.push('## 决策（按预注册规则 1-4）');
  var bRate = revIds.filter(function (id) { return scoreOf('B', id) === 1; }).length / revIds.length;
  var cRate = revIds.filter(function (id) { return scoreOf('C', id) === 1; }).length / revIds.length;
  var dRate = revIds.filter(function (id) { return scoreOf('D', id) === 1; }).length / revIds.length;
  L.push('- 反悔类文本存活率：base= ' +
    ((revIds.filter(function (id) { return scoreOf('base', id) === 1; }).length / revIds.length) * 100).toFixed(0) +
    '%， B= ' + (bRate * 100).toFixed(0) + '%， C= ' + (cRate * 100).toFixed(0) + '%， D= ' + (dRate * 100).toFixed(0) + '%');
  var winner = (dRate >= 0.75) ? 'D' : ((bRate >= cRate) ? 'B' : 'C');
  L.push('- 预注册选臂：**' + winner + '**（D 达到 75% 阈值则选 D；否则在 B/C 中取更高，平手取 B）');
  if (dRate < 0.75) {
    L.push('- ⚠️ D 反悔类 <75% → 按规则 3 测一层 `D+E`（规则 verifier 兜底）；若仍 <75% → 按规则 4 停机回讨论窗口');
  } else {
    L.push('- ✅ D 反悔类 ≥75% → 选择 **D（resolve-rewrite）**，无需再测 E；进入 holdout 封存。');
  }
  L.push('');

  var corpus2 = corpus === 'holdout' ? 'holdout' : 'dev';
  var outPath = join(__dirname, 'output', 'modality-eval', corpus2, 'decision.md');
  mkdirSync(join(__dirname, 'output', 'modality-eval', corpus2), { recursive: true });
  // 使版本四元组真实反映 modality 语料 + 臂定义，避免"假一致"（默认 fixture.js/queries.js 不适用）
  var armDef = JSON.stringify({ arms: ARMS, corpus: corpus2, modalityFixture: corpus2 === 'holdout' ? 'modality-eval-holdout.js' : 'modality-eval-dev.js' });
  writeFileSync(outPath, withProvenanceHeader('modality-decision', L.join('\n'), null, {
    fixturePath: join(__dirname, corpus2 === 'holdout' ? 'modality-eval-holdout.js' : 'modality-eval-dev.js'),
    armPromptText: armDef,
    split: corpus2,
  }), 'utf-8');
  console.log('Modality decision: ' + outPath);
}

// ─── 注入侧臂评测：校准闸门 + 锚级聚类配对检验 + L2 机制相关 ───
// 计划：injection-ablation-rerun-plan.md §3.5
// 输入：output/injection-eval/（aggregate.json 由 run-injection-arms.js 产出）+ 逐事实 dump
// 输出：output/injection-eval/decision.md（含 L0/L1/L2 三层与预注册措辞）
// 锚数据通过文件内静态导入（INJ_ANCHORS），判定从 dump 重算（确定性 contains，与 aggregate 解耦可复核）。

import { qaAnchors as INJ_ANCHORS } from './injection-qa-anchors.js';

function injectionMain() {
  var baseDir = join(__dirname, 'output', 'injection-eval');
  var aggPath = join(baseDir, 'aggregate.json');
  if (!existsSync(aggPath)) {
    console.error('缺 ' + aggPath + '，先跑 run-injection-arms.js --judge / --aggregate-only');
    process.exit(1);
  }
  var agg = JSON.parse(readFileSync(aggPath, 'utf-8'));

  function factVerdict(arm, anchorId, factIdx) {
    var p = join(baseDir, arm, anchorId + '-f' + factIdx + '.json');
    if (!existsSync(p)) return null;
    var d = JSON.parse(readFileSync(p, 'utf-8'));
    if (!d.parseOk) return 0; // parse 失败计 0（保守）
    var anchor = INJ_ANCHORS.find(function (a) { return a.id === anchorId; });
    if (!anchor) return null;
    var fact = anchor.facts[factIdx];
    if (!fact) return null;
    var expects = Array.isArray(fact.expect) ? fact.expect : [fact.expect];
    var a = String(d.answer || '');
    var hit = d.found && expects.some(function (e) { return a.indexOf(e) !== -1; });
    return hit ? 1 : 0;
  }

  function collectFacts(arm) {
    var out = [];
    INJ_ANCHORS.forEach(function (anchor) {
      anchor.facts.forEach(function (fact, xi) {
        var v = factVerdict(arm, anchor.id, xi);
        if (v !== null) out.push({ anchorId: anchor.id, factIdx: xi, tier: anchor.type, verdict: v });
      });
    });
    return out;
  }

  var L = [];
  L.push('# 注入侧臂评测 · 决策报告（key-highlights，三层仪器）');
  L.push('- 计划：injection-ablation-rerun-plan.md；读者=deepseek-v4-flash(temperature=0)，盲评；判定=确定性 contains（零 LLM）');
  L.push('- 主判据 = state tier；narrative tier 仅次级参考');
  L.push('');

  // ── L1 校准闸门（预注册：地板 ≤10%，天花板 ≥75%）──
  L.push('## 1. L1 校准闸门（预注册）');
  var gateFloor = null, gateOracle = null;
  ['floor', 'oracle'].forEach(function (arm) {
    var facts = collectFacts(arm);
    if (!facts.length) { L.push('- ' + arm + '：无数据'); return; }
    var st = facts.filter(function (f) { return f.tier === 'state'; });
    var rate = st.length ? st.reduce(function (a, f) { return a + f.verdict; }, 0) / st.length : null;
    L.push('- **' + arm + '**（state tier）：正确率 ' + (rate === null ? '—' : (rate * 100).toFixed(1) + '% (' + st.filter(function (f) { return f.verdict === 1; }).length + '/' + st.length + ')'));
    if (arm === 'floor') gateFloor = rate;
    if (arm === 'oracle') gateOracle = rate;
  });
  var gatesPassed = true;
  if (gateFloor !== null && gateFloor > 0.10) { L.push('- ⚠️ **地板闸门失败**（' + (gateFloor * 100).toFixed(1) + '% > 10%）：读者在幻觉，仪器作废，停修后重跑'); gatesPassed = false; }
  if (gateOracle !== null && gateOracle < 0.75) { L.push('- ⚠️ **天花板闸门失败**（' + (gateOracle * 100).toFixed(1) + '% < 75%）：读者太弱或题目畸形，仪器作废，停修后重跑'); gatesPassed = false; }
  if (gateFloor !== null && gateOracle !== null && gatesPassed) L.push('- ✅ 校准闸门通过（地板 ≤10% 且 天花板 ≥75%）');
  L.push('');

  // ── L0 文档度量（机制闸门）──
  L.push('## 2. L0 文档度量（机制闸门）');
  if (agg.docMetrics && agg.docMetrics.baseline && agg.docMetrics.hl) {
    var mBase = agg.docMetrics.baseline, mHl = agg.docMetrics.hl;
    var byIdBase = {}, byIdHl = {};
    mBase.forEach(function (m) { byIdBase[m.anchorId] = m.metrics; });
    mHl.forEach(function (m) { byIdHl[m.anchorId] = m.metrics; });
    var fwdSum = 0, fwdN = 0, coverDiff = 0;
    Object.keys(byIdBase).forEach(function (id) {
      if (!byIdHl[id]) return;
      var b = byIdBase[id].firstOccurrencePct, h = byIdHl[id].firstOccurrencePct;
      if (b !== null && h !== null) { fwdSum += (b - h); fwdN++; }
      coverDiff += byIdHl[id].gtCovered - byIdBase[id].gtCovered;
    });
    var avgTokB = mBase.reduce(function (a, m) { return a + m.metrics.docTokens; }, 0) / mBase.length;
    var avgTokH = mHl.reduce(function (a, m) { return a + m.metrics.docTokens; }, 0) / mHl.length;
    L.push('- GT 事件首现位置平均前移：' + (fwdN ? (fwdSum / fwdN * 100).toFixed(1) + 'pp（n=' + fwdN + ' 锚）' : '—'));
    L.push('- 覆盖数差（hl−baseline，应为 0）：' + coverDiff + (coverDiff !== 0 ? ' ⚠️ **管线 bug：覆盖不一致，停修**' : ' ✓'));
    L.push('- 平均 token：baseline=' + avgTokB.toFixed(0) + '，hl=' + avgTokH.toFixed(0) + '（+' + (avgTokH - avgTokB).toFixed(0) + '）');
    if (fwdN > 0 && Math.abs(fwdSum / fwdN) < 0.01) {
      L.push('- ⚠️ **机制未触发**：hl 未前移任何 GT 事件（位置差≈0）——记录后 L1 照跑（防 L0 度量失灵）');
    }
  } else {
    L.push('- baseline/hl 文档度量缺失（先 --render-only 全臂）');
  }
  L.push('');

  // ── L1 主判据：配对检验（锚级聚类 bootstrap）──
  L.push('## 3. L1 主判据：baseline vs hl（配对）');
  function pairTest(tier, armA, armB) {
    armA = armA || 'baseline'; armB = armB || 'hl';
    var baseF = collectFacts(armA).filter(function (f) { return f.tier === tier; });
    var hlF = collectFacts(armB).filter(function (f) { return f.tier === tier; });
    if (!baseF.length || !hlF.length) return null;
    var hlMap = {};
    hlF.forEach(function (f) { hlMap[f.anchorId + '|' + f.factIdx] = f.verdict; });
    var pairs = baseF.filter(function (f) { return hlMap[f.anchorId + '|' + f.factIdx] !== undefined; })
      .map(function (f) { return { anchorId: f.anchorId, a: f.verdict, b: hlMap[f.anchorId + '|' + f.factIdx] }; });
    if (!pairs.length) return null;
    var rateA = pairs.reduce(function (s, p) { return s + p.a; }, 0) / pairs.length;
    var rateB = pairs.reduce(function (s, p) { return s + p.b; }, 0) / pairs.length;
    var diffs = pairs.map(function (p) { return p.b - p.a; });
    var md = mean(diffs);
    // 锚级聚类 bootstrap：重采样按锚抽，事实跟随锚
    var anchorIds = [];
    pairs.forEach(function (p) { if (anchorIds.indexOf(p.anchorId) === -1) anchorIds.push(p.anchorId); });
    var byAnchor = {};
    anchorIds.forEach(function (id) { byAnchor[id] = pairs.filter(function (p) { return p.anchorId === id; }); });
    var rnd = mulberry32(SEED);
    var bootMeans = [];
    for (var bi = 0; bi < B; bi++) {
      var sample = [];
      for (var ai = 0; ai < anchorIds.length; ai++) {
        var pick = anchorIds[Math.floor(rnd() * anchorIds.length)];
        sample = sample.concat(byAnchor[pick]);
      }
      bootMeans.push(mean(sample.map(function (p) { return p.b - p.a; })));
    }
    var ci = { lo: percentile(bootMeans, 0.025), hi: percentile(bootMeans, 0.975) };
    var pSign = signTestP(diffs);
    return { n: pairs.length, rateA: rateA, rateB: rateB, md: md, ci: ci, p: pSign };
  }
  function wordingOf(md, ci) {
    return md > 0 && ci.lo > 0 && md >= 0.10 ? '显著有益' : (md < 0 && ci.hi < 0 && md <= -0.10 ? '显著有害' : (Math.abs(md) < 0.05 ? '无可测差异' : '方向性观察'));
  }

  var st = pairTest('state');
  if (st) {
    L.push('### state tier（主判据，n=' + st.n + ' 配对事实，' + INJ_ANCHORS.filter(function (a) { return a.type === 'state'; }).length + ' 锚）');
    L.push('| baseline | hl | Δ | 95% CI（锚聚类） | 符号检验 p | 措辞 |');
    L.push('|---|---|---|---|---|---|');
    var w = st.md > 0 && st.ci.lo > 0 && st.md >= 0.10 ? '显著有益' : (st.md < 0 && st.ci.hi < 0 && st.md <= -0.10 ? '显著有害' : (Math.abs(st.md) < 0.05 ? '无可测差异' : '方向性观察'));
    L.push('| ' + (st.rateA * 100).toFixed(1) + '% | ' + (st.rateB * 100).toFixed(1) + '% | ' + (st.md * 100).toFixed(1) + 'pp | [' + (st.ci.lo * 100).toFixed(1) + ', ' + (st.ci.hi * 100).toFixed(1) + '] | ' + st.p.toFixed(3) + ' | **' + w + '** |');
    L.push('');
  }
  var na = pairTest('narrative');
  if (na) {
    L.push('### narrative tier（次级参考，n=' + na.n + '，不作主判据）');
    L.push('| baseline | hl | Δ | 95% CI | p |');
    L.push('|---|---|---|---|---|');
    L.push('| ' + (na.rateA * 100).toFixed(1) + '% | ' + (na.rateB * 100).toFixed(1) + '% | ' + (na.md * 100).toFixed(1) + 'pp | [' + (na.ci.lo * 100).toFixed(1) + ', ' + (na.ci.hi * 100).toFixed(1) + '] | ' + na.p.toFixed(3) + ' |');
    L.push('');
  }

  // ── 3b. 结构横评（injection-structure-comparison-plan §0.3）──
  var cmpArms = ['flat', 'grouped', 'baseline', 'hl', 'coverfix', 'oracle'];
  var cmpLabels = { flat: '平铺列表', grouped: '实体分组(无pre)', baseline: '现行(grouped+pre)', hl: '现行+highlights', coverfix: '现行+覆盖补全', oracle: 'GT裸列表(上限)' };
  var available = cmpArms.filter(function (a) { return collectFacts(a).length > 0; });
  if (available.length >= 2) {
    L.push('## 3b. 结构横评（多臂绝对正确率 + 与现行结构配对对比）');
    L.push('（计划：injection-structure-comparison-plan.md；期望表已按预注册偏差修正重算）');
    L.push('');
    L.push('| 臂 | state | narrative |');
    L.push('|---|---|---|');
    available.forEach(function (arm) {
      var s = collectFacts(arm).filter(function (f) { return f.tier === 'state'; });
      var n2 = collectFacts(arm).filter(function (f) { return f.tier === 'narrative'; });
      L.push('| ' + (cmpLabels[arm] || arm) + ' | ' + (s.length ? (s.reduce(function (x, f) { return x + f.verdict; }, 0) / s.length * 100).toFixed(1) + '% (' + s.filter(function (f) { return f.verdict; }).length + '/' + s.length + ')' : '—') + ' | ' + (n2.length ? (n2.reduce(function (x, f) { return x + f.verdict; }, 0) / n2.length * 100).toFixed(1) + '% (' + n2.filter(function (f) { return f.verdict; }).length + '/' + n2.length + ')' : '—') + ' |');
    });
    L.push('');
    // 与现行结构（baseline）的配对对比
    L.push('### 与现行结构配对对比（Δ = 臂 − baseline）');
    [['flat', '现行 vs 平铺'], ['grouped', '现行 vs 分组无pre'], ['coverfix', '覆盖补全 vs 现行'], ['oracle', '上限 vs 现行']].forEach(function (pair) {
      var arm = pair[0], label = pair[1];
      [['state', 'state'], ['narrative', 'narrative']].forEach(function (tt) {
        var r = pairTest(tt[0], 'baseline', arm);
        if (!r) return;
        L.push('- **' + label + '（' + tt[1] + '，n=' + r.n + '）**：Δ=' + (r.md * 100).toFixed(1) + 'pp [' + (r.ci.lo * 100).toFixed(1) + ', ' + (r.ci.hi * 100).toFixed(1) + '] p=' + r.p.toFixed(3) + ' — ' + wordingOf(r.md, r.ci));
      });
    });
    L.push('');
    // cover-fix 损失分解
    var cfS = pairTest('state', 'baseline', 'coverfix');
    var cfN = pairTest('narrative', 'baseline', 'coverfix');
    var orS = pairTest('state', 'baseline', 'oracle');
    var orN = pairTest('narrative', 'baseline', 'oracle');
    if (cfN && orN) {
      L.push('### 检索缺口 vs 呈现损失分解（narrative tier）');
      L.push('- oracle − baseline（总损失）= ' + (orN.md * 100).toFixed(1) + 'pp');
      L.push('- coverfix − baseline（覆盖层损失，检索未召回可补部分）= ' + (cfN.md * 100).toFixed(1) + 'pp');
      L.push('- oracle − coverfix（纯呈现损失上限，补齐覆盖后仍损失）= ' + ((orN.md - cfN.md) * 100).toFixed(1) + 'pp');
      L.push('- 局限登记：coverfix 尾部追加可能含"重复强调"效应，覆盖损失估计为其下限偏保守值。');
      L.push('');
    }
    if (cfS && orS) {
      L.push('### 损失分解（state tier，天花板效应内）');
      L.push('- oracle − baseline = ' + (orS.md * 100).toFixed(1) + 'pp；coverfix − baseline = ' + (cfS.md * 100).toFixed(1) + 'pp；oracle − coverfix = ' + ((orS.md - cfS.md) * 100).toFixed(1) + 'pp');
      L.push('');
    }
  }

  // ── L2 机制相关（描述性）──
  L.push('## 4. L2 机制相关（描述性，不下结论）');
  if (agg.docMetrics && agg.docMetrics.baseline && agg.docMetrics.hl) {
    var byIdBase2 = {}, byIdHl2 = {};
    agg.docMetrics.baseline.forEach(function (m) { byIdBase2[m.anchorId] = m.metrics.firstOccurrencePct; });
    agg.docMetrics.hl.forEach(function (m) { byIdHl2[m.anchorId] = m.metrics.firstOccurrencePct; });
    var xs = [], ys = []; // x=位置前移量(baseline-hl, pct), y=锚级答对率增益
    INJ_ANCHORS.forEach(function (anchor) {
      var b = byIdBase2[anchor.id], h = byIdHl2[anchor.id];
      if (b === undefined || h === undefined || b === null || h === null) return;
      var baseF = collectFacts('baseline').filter(function (f) { return f.anchorId === anchor.id; });
      var hlF = collectFacts('hl').filter(function (f) { return f.anchorId === anchor.id; });
      if (!baseF.length || !hlF.length || baseF.length !== hlF.length) return;
      var rb = baseF.reduce(function (s, f) { return s + f.verdict; }, 0) / baseF.length;
      var rh = hlF.reduce(function (s, f) { return s + f.verdict; }, 0) / hlF.length;
      xs.push(b - h); ys.push(rh - rb);
    });
    if (xs.length > 2) {
      // Spearman（简单实现：秩相关）
      function rank(arr) {
        var sorted = arr.slice().sort(function (a, b) { return a - b; });
        return arr.map(function (v) { return sorted.indexOf(v); });
      }
      var rx = rank(xs), ry = rank(ys);
      var n = xs.length;
      var d2 = 0;
      for (var i = 0; i < n; i++) d2 += Math.pow(rx[i] - ry[i], 2);
      var rho = 1 - 6 * d2 / (n * (n * n - 1));
      L.push('- 逐锚：位置前移量 ↔ 答对率增益，Spearman ρ=' + rho.toFixed(2) + '（n=' + n + ' 锚，描述性）');
      L.push('- 散点（前移pp, 增益pp）：' + xs.map(function (x, i) { return '(' + (x * 100).toFixed(0) + ',' + (ys[i] * 100).toFixed(0) + ')'; }).join(' '));
    } else {
      L.push('- 可配对锚不足（n≤2），跳过');
    }
  } else {
    L.push('- 缺 L0 度量，跳过');
  }
  L.push('');

  // ── 决策（预注册规则）──
  L.push('## 5. 决策（按预注册规则 §2.2 / structure-comparison-plan §0.3）');
  if (!gatesPassed) {
    L.push('- **校准闸门未通过 → 仪器作废，本报告结论不可用**。停修仪器（换判定口径/读者措辞）后全部重跑，不挑读数。');
  } else if (!st) {
    L.push('- 缺 baseline/hl 数据，无法决策。');
  } else {
    var w2 = st.md > 0 && st.ci.lo > 0 && st.md >= 0.10 ? 'significant-positive' : (st.md < 0 && st.ci.hi < 0 && st.md <= -0.10 ? 'significant-negative' : (Math.abs(st.md) < 0.05 ? 'no-diff' : 'directional'));
    if (w2 === 'significant-positive') {
      L.push('- ✅ **显著有益** → 登记 canonical，结论限定词："状态类原子事实探针，n=' + st.n + ' 配对，读者=deepseek-v4-flash"。');
    } else if (w2 === 'significant-negative') {
      L.push('- ⚠️ **显著有害** → 回讨论窗口决定是否下线 highlights（不自动下线）。');
    } else if (w2 === 'no-diff') {
      L.push('- **无可测差异** → 维持现状（已上线，无证据不回退）。');
    } else {
      L.push('- **方向性观察** → 按预注册措辞表述，维持现状。');
    }
  }
  // 横评决策（structure-comparison-plan §0.3 平局规则）
  var cmpS = pairTest('state', 'baseline', 'flat');
  var cmpS2 = pairTest('state', 'baseline', 'grouped');
  var cmpN3 = pairTest('narrative', 'baseline', 'flat');
  var cmpN4 = pairTest('narrative', 'baseline', 'grouped');
  if (cmpS || cmpN3) {
    L.push('');
    L.push('### 结构横评决策');
    [['state', cmpS, cmpS2], ['narrative', cmpN3, cmpN4]].forEach(function (row) {
      var tier = row[0], rFlat = row[1], rGrp = row[2];
      if (rFlat) L.push('- 现行 vs 平铺（' + tier + '）：' + wordingOf(-rFlat.md, { lo: -rFlat.ci.hi, hi: -rFlat.ci.lo }) + '（现行领先 ' + (-rFlat.md * 100).toFixed(1) + 'pp）');
      if (rGrp) L.push('- 现行 vs 分组无pre（' + tier + '）：' + wordingOf(-rGrp.md, { lo: -rGrp.ci.hi, hi: -rGrp.ci.lo }) + '（现行领先 ' + (-rGrp.md * 100).toFixed(1) + 'pp）');
    });
    L.push('- 平局规则：若无可测差异 → 结构选择对取答性能无影响，维持现状（结构选择转为可读性/维护性论据）。');
  }
  L.push('');

  var outPath = join(baseDir, 'decision.md');
  var armDef = JSON.stringify({ arms: ['floor', 'oracle', 'baseline', 'hl', 'flat', 'grouped', 'coverfix'], anchors: INJ_ANCHORS.length, plans: ['injection-ablation-rerun-plan', 'injection-structure-comparison-plan'], expectFix: '2026-08-19' });
  writeFileSync(outPath, withProvenanceHeader('injection-decision', L.join('\n'), null, {
    fixturePath: join(__dirname, 'injection-qa-anchors.js'),
    armPromptText: armDef,
    split: 'dev',
  }), 'utf-8');
  console.log('Injection decision: ' + outPath);
}

main();
