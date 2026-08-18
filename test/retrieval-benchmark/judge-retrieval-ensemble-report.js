// judge-retrieval-ensemble-report.js — 检索 GT 复核聚合报告（P0-2 检索侧）
// 输入：output/judge-retrieval-ensemble-results.json（3 模型 × 18 查询 × 10 事件）
//       output/judge-retrieval-gt.json（现有 GT，按查询独立取分）
// 输出：output/judge-retrieval-ensemble-report.md
//   1. 模型间一致性（exact 三一致 / 多数票）
//   2. 多数票 vs 现有 GT：精确一致率 + ±1 容差一致率
//   3. 分歧归因：GT 过宽（GT=2 但多数票≤1）/ GT 过严（GT=0 但多数票≥1）/ 1-2 边界模糊
//   4. 分歧热点清单（模型不一致的事件）
// 用法：node judge-retrieval-ensemble-report.js
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { withProvenanceHeader } from './report-provenance.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var ens = JSON.parse(readFileSync(join(__dirname, 'output', 'judge-retrieval-ensemble-results.json'), 'utf-8'));
var gtData = JSON.parse(readFileSync(join(__dirname, 'output', 'judge-retrieval-gt.json'), 'utf-8'));

var models = ens.models;
var rids = Object.keys(models[0].verdicts);

function median3(a, b, c) { return [a, b, c].sort(function (x, y) { return x - y; })[1]; }

// ── 逐事件统计 ──
var total = 0, exactAgree = 0, majVsGtExact = 0, majVsGtWithin1 = 0;
var gtTooLenient = []; // GT=2 但多数票≤1
var gtTooStrict = [];  // GT=0 但多数票≥1
var boundary12 = [];   // 多数票与 GT 差 1 且涉及 1/2
var hotspots = [];     // 模型间不一致

var gtByRid = {};
gtData.items.forEach(function (it) { gtByRid[it.rid] = it; });

rids.forEach(function (rid) {
  var gtItem = gtByRid[rid];
  for (var i = 0; i < 10; i++) {
    total++;
    var votes = models.map(function (m) { return m.verdicts[rid][i]; });
    var gt = gtItem.top10[i].gt;
    var maj = median3(votes[0], votes[1], votes[2]);
    if (votes[0] === votes[1] && votes[1] === votes[2]) exactAgree++;
    else hotspots.push({ rid: rid, rank: i + 1, votes: votes, maj: maj, gt: gt, text: gtItem.top10[i].text });
    if (maj === gt) majVsGtExact++;
    if (Math.abs(maj - gt) <= 1) majVsGtWithin1++;
    if (gt === 2 && maj <= 1) gtTooLenient.push({ rid: rid, rank: i + 1, maj: maj, votes: votes, text: gtItem.top10[i].text });
    if (gt === 0 && maj >= 1) gtTooStrict.push({ rid: rid, rank: i + 1, maj: maj, votes: votes, text: gtItem.top10[i].text });
    if (Math.abs(maj - gt) === 1 && ((maj === 1 && gt === 2) || (maj === 2 && gt === 1))) boundary12.push({ rid: rid, rank: i + 1, maj: maj, gt: gt });
  }
});

// ── 每模型 vs GT 一致率（看是否有模型系统性偏严/偏宽）──
var perModel = models.map(function (m) {
  var exact = 0, within1 = 0, sum = 0, n = 0;
  rids.forEach(function (rid) {
    var gtItem = gtByRid[rid];
    for (var i = 0; i < 10; i++) {
      var v = m.verdicts[rid][i], gt = gtItem.top10[i].gt;
      n++; sum += v;
      if (v === gt) exact++;
      if (Math.abs(v - gt) <= 1) within1++;
    }
  });
  return { model: m.model, exact: exact, within1: within1, n: n, avg: sum / n };
});

function pct(x, n) { return (x / n * 100).toFixed(1) + '%'; }

var L = [];
L.push('# 检索 GT 多模型复核报告（P0-2 检索侧，n=' + total + ' 事件）');
L.push('');
L.push('- 模型数：' + models.length + '（' + models.map(function (m) { return m.model; }).join(' / ') + '）');
L.push('- 口径：每事件 0/1/2 三档；多数票 = 三值中位数；GT 按查询独立取分（非 GT 事件=0）');
L.push('- 模型身份由操作者手动切换并报告（非自动可验证）');
L.push('');
L.push('## 1. 模型间一致性');
L.push('');
L.push('- 三模型完全一致：' + exactAgree + '/' + total + '（' + pct(exactAgree, total) + '）');
L.push('- 分歧事件（≥1 模型不同）：' + hotspots.length + '/' + total + '（' + pct(hotspots.length, total) + '）');
L.push('');
L.push('## 2. 多数票 vs 现有 GT');
L.push('');
L.push('| 口径 | 一致 | 总数 | 一致率 |');
L.push('|---|---|---|---|');
L.push('| 精确一致（多数票=GT） | ' + majVsGtExact + ' | ' + total + ' | **' + pct(majVsGtExact, total) + '** |');
L.push('| ±1 容差一致 | ' + majVsGtWithin1 + ' | ' + total + ' | ' + pct(majVsGtWithin1, total) + ' |');
L.push('');
L.push('## 3. 每模型 vs GT（检查系统性偏严/偏宽）');
L.push('');
L.push('| 模型 | 精确一致 | ±1 一致 | 平均打分 |');
L.push('|---|---|---|---|');
perModel.forEach(function (m) {
  L.push('| ' + m.model + ' | ' + pct(m.exact, m.n) + ' | ' + pct(m.within1, m.n) + ' | ' + m.avg.toFixed(2) + ' |');
});
L.push('');
L.push('## 4. 分歧归因');
L.push('');
L.push('- **GT 过宽**（GT=2 但多数票≤1，GT 可能标高）：' + gtTooLenient.length + ' 条');
L.push('- **GT 过严**（GT=0 但多数票≥1，GT 可能漏标）：' + gtTooStrict.length + ' 条');
L.push('- **1/2 边界模糊**（多数票与 GT 差 1 且落在 1↔2）：' + boundary12.length + ' 条');
L.push('');
if (gtTooLenient.length) {
  L.push('### 4.1 GT 过宽清单');
  L.push('');
  gtTooLenient.forEach(function (e) {
    L.push('- ' + e.rid + '#' + e.rank + '（多数票 ' + e.maj + '，票 ' + e.votes.join('/') + '）：' + e.text);
  });
  L.push('');
}
if (gtTooStrict.length) {
  L.push('### 4.2 GT 过严清单');
  L.push('');
  gtTooStrict.forEach(function (e) {
    L.push('- ' + e.rid + '#' + e.rank + '（多数票 ' + e.maj + '，票 ' + e.votes.join('/') + '）：' + e.text);
  });
  L.push('');
}
L.push('## 5. 分歧热点（模型间不一致事件，共 ' + hotspots.length + '）');
L.push('');
L.push('| 事件 | 票（dsv4f/GLM/Qwen） | 多数票 | GT | 摘要 |');
L.push('|---|---|---|---|---|');
hotspots.forEach(function (h) {
  L.push('| ' + h.rid + '#' + h.rank + ' | ' + h.votes.join('/') + ' | ' + h.maj + ' | ' + h.gt + ' | ' + h.text.slice(0, 40) + '… |');
});
L.push('');
L.push('> 判读：分歧集中在 1↔2 边界 → 无害（相关度档位天然模糊）；分歧落在 0↔1 且多数票推翻 GT → GT 标注需复核。');

var outPath = join(__dirname, 'output', 'judge-retrieval-ensemble-report.md');
writeFileSync(outPath, withProvenanceHeader('judge-retrieval-ensemble', L.join('\n')), 'utf-8');
console.log('报告: ' + outPath);
console.log('三一致 ' + pct(exactAgree, total) + ' | 多数票vsGT 精确 ' + pct(majVsGtExact, total) + ' ±1 ' + pct(majVsGtWithin1, total) + ' | GT过宽 ' + gtTooLenient.length + ' GT过严 ' + gtTooStrict.length + ' 1/2边界 ' + boundary12.length);
