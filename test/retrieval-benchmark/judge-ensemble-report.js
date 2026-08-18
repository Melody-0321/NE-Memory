// P0-2 多模型 judge 合奏：聚合 → per-model 存活率 + 多数票共识 + 分歧热点
// 用法：node judge-ensemble-report.js
// 输入：output/judge-ensemble-results.json（record-judge-verdict.js 追加）
// 输出：output/judge-ensemble-report.md
// 口径：不确定 计入未存活（与 T1 审计一致，保守口径）
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { withProvenanceHeader } from './report-provenance.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var IN = join(__dirname, 'output', 'judge-ensemble-results.json');
var OUT_FILE = join(__dirname, 'output', 'judge-ensemble-report.md');

var data = JSON.parse(readFileSync(IN, 'utf-8'));
var models = data.models;
var CAT = { T: '打趣/戏言', H: '假设/意愿', R: '否定/反悔' };
function catOf(id) { return CAT[id[0]] || '?'; }

// 泛化：条目并集从数据推导（不再硬编码 ITEM_ORDER），保持首字母类别映射
var _seen = {};
models.forEach(function (m) { Object.keys(m.verdicts || {}).forEach(function (id) { _seen[id] = 1; }); });
var items = Object.keys(_seen).sort();

function f(v) { return (v * 100).toFixed(1) + '%'; }

var L = [];
L.push('# 多模型 Judge 合奏报告（modality，n=' + items.length + '）');
L.push('');
L.push('- 模型数：' + models.length);
L.push('- 口径：不确定 计入未存活（保守，与 T1 审计一致）');
L.push('- 模型身份由操作者手动切换并报告（非自动可验证）');
L.push('');
L.push('## 1. 每模型存活率');
L.push('');
L.push('| 模型 | 存活 | 总数 | 存活率 | 打趣 | 假设 | 否定/反悔 |');
L.push('|---|---|---|---|---|---|---|');
models.forEach(function (m) {
  var total = 0, alive = 0;
  var byCat = { '打趣/戏言': { a: 0, n: 0 }, '假设/意愿': { a: 0, n: 0 }, '否定/反悔': { a: 0, n: 0 } };
  items.forEach(function (id) {
    var v = m.verdicts[id];
    if (v === undefined) return;
    var c = catOf(id);
    total++;
    byCat[c].n++;
    if (v === '存活') { alive++; byCat[c].a++; }
  });
  var cells = [m.model, alive, total, f(alive / total)];
  ['打趣/戏言', '假设/意愿', '否定/反悔'].forEach(function (c) {
    cells.push(byCat[c].n > 0 ? f(byCat[c].a / byCat[c].n) : '—');
  });
  L.push('| ' + cells.join(' | ') + ' |');
});
L.push('');

// 逐条矩阵
L.push('## 2. 逐条裁决矩阵');
L.push('');
var header = ['条目', '类别'].concat(models.map(function (m) { return m.model; }), ['共识', '分歧']);
L.push('| ' + header.join(' | ') + ' |');
L.push('|' + header.map(function () { return '---'; }).join('|') + '|');

var hotspots = [];
var consensus = {};
items.forEach(function (id) {
  var counts = { '存活': 0, '丢失': 0, '不确定': 0 };
  var row = [id, catOf(id)];
  models.forEach(function (m) {
    var v = m.verdicts[id] || '—';
    row.push(v);
    if (v !== '—') counts[v]++;
  });
  // 多数票共识：存活 > 丢失 且 存活 > 不确定 → 存活；反之丢失；否则平票/分歧
  var c;
  if (counts['存活'] > counts['丢失'] && counts['存活'] > counts['不确定']) c = '存活';
  else if (counts['丢失'] > counts['存活'] && counts['丢失'] > counts['不确定']) c = '丢失';
  else c = '平票/分歧';
  consensus[id] = c;
  var allSame = new Set(models.filter(function (m) { return m.verdicts[id] !== undefined; }).map(function (m) { return m.verdicts[id]; })).size === 1;
  var isHotspot = !allSame || c === '平票/分歧';
  row.push(c);
  row.push(isHotspot ? '⚠️ 分歧' : '一致');
  L.push('| ' + row.join(' | ') + ' |');
  if (isHotspot) hotspots.push(id);
});
L.push('');

// 共识与分歧
var consAlive = items.filter(function (id) { return consensus[id] === '存活'; }).length;
L.push('## 3. 共识与分歧');
L.push('');
L.push('- 多数票共识存活率：' + consAlive + '/' + items.length + '（' + f(consAlive / items.length) + '）');
L.push('- 分歧热点（模型不一致 / 平票）：' + (hotspots.length ? hotspots.join(', ') : '无'));
L.push('');
L.push('> 分歧热点 = 标准本身模糊的位置。单模型/单裁判在这些条目上不可信，需人工或 schema 级处理。');
L.push('> 本报告与 canonical-numbers.md §4（单 judge 58.3%）对比，若合奏结论不同，以合奏为更稳口径。');

mkdirSync(join(__dirname, 'output'), { recursive: true });
writeFileSync(OUT_FILE, withProvenanceHeader('judge-ensemble', L.join('\n')), 'utf-8');
console.log('Judge ensemble report: ' + OUT_FILE);
