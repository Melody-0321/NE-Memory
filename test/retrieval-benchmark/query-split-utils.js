// Query dev/holdout split loader — P0-0（benchmark-improvement-plan §2）
// 用法：node <script>.js [--split dev|holdout|all]   （默认 dev）
// - dev（默认）  ：只跑 dev 集 18 条 —— 一切调参/探索都在 dev 上，杜绝 train-on-test
// - holdout      ：封存集 10 条，仅配置冻结后在 P0-1 封存运行时用一次；输出隔离到 output/holdout/
// - all          ：完整 28 条（显式回归用）
// 所有检索类 benchmark 脚本都应通过 loadSplitQueries() 加载查询集，而非直接 import queries.js。
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { queries as allQueries } from './queries.js';

var __dirname = dirname(fileURLToPath(import.meta.url));

var SPLIT_JSON = join(__dirname, 'queries-split.json');

// 解析 --split 参数，非法值回退 dev
export function getSplitName() {
  var i = process.argv.indexOf('--split');
  var v = i >= 0 ? process.argv[i + 1] : 'dev';
  if (v !== 'dev' && v !== 'holdout' && v !== 'all') v = 'dev';
  return v;
}

function normalize(q) {
  if (!q.query) q.query = q.question;
  return q;
}

var cache = null;

// 按当前 --split 返回查询子集（每次进程只缓存一份）
export function loadSplitQueries() {
  if (cache) return cache;
  var split = getSplitName();
  if (split === 'all') {
    cache = allQueries.map(normalize);
  } else {
    var splitData = JSON.parse(readFileSync(SPLIT_JSON, 'utf-8'));
    var ids = splitData[split] || [];
    var set = {};
    ids.forEach(function (id) { set[id] = true; });
    cache = allQueries.filter(function (q) { return set[q.id]; }).map(normalize);
  }
  var narr = cache.filter(function (q) { return q.type === 'narrative'; }).length;
  var tgt = cache.length - narr;
  console.log('[split] ' + split + ': ' + cache.length + ' queries (' + narr + ' narr + ' + tgt + ' tgt)');
  return cache;
}

// 输出目录：holdout 落到 output/holdout/（与常规报告隔离，防误跑覆盖）
export function outputDirFor(dir) {
  return getSplitName() === 'holdout' ? join(dir, 'output', 'holdout') : join(dir, 'output');
}
