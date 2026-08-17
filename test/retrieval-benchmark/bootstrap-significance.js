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

main();
