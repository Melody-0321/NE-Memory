// run-coverage-diagnostic.js — 注入量 k 扫描 Step 0：确定性覆盖诊断（零读者调用）
// 计划：.trae/documents/injection-kscan-step0-plan.md §3.1
// 口径：冻结检索配置（BM25 top-40 + Vector top-144 + linearFuse α=0.20 / rrfK=60），
//   与 benchmark-topk-sweep.js 完全一致。输出：
//   - 每个 GT 事件在融合排序中的 rank（>144 即窗口外）
//   - coverage(k) = #{GT | rank<=k} / #{GT}，k ∈ {20,40,...,144}（逐锚 + narrative 合并 + 全锚合并）
//   - 缺失事件 EDF（rank 分桶）
//   - 窗口统计（每锚 top-k 命中事件数 + 估算 token，中文 ∕1.6，口径同 run-injection-arms measureDoc）

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM } from './fixture.js';
import { qaAnchors } from './injection-qa-anchors.js';
import { linearFuse } from './benchmark-fusions.js';
import { computeTuple } from './report-provenance.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_coverage_diag__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;
var FUSE_TOP_K = 144; // 截断到全集窗口，以获知 top-144 内的真实 rank
var ALPHA = 0.20;
var RRF_K = 60;
var KSWEEP = [20, 40, 60, 80, 100, 120, 140, 144];
var KNOWN_MISSING_OLD = ['stm_51', 'stm_24', 'stm_44', 'stm_36', 'stm_37', 'stm_40'];

var OUT = join(__dirname, 'output', 'coverage-diagnostic');
mkdirSync(OUT, { recursive: true });

process.env.EMBEDDING_URL = config.url;
process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
process.env.EMBEDDING_API_KEY = config.key;
delete process.env.NE_BENCHMARK_VECTOR;

var idText = {};
allSTM.forEach(function (e) { idText[e.id] = e.event || ''; });
allLTM.forEach(function (e) { idText[e.id] = e.event || ''; });

function f(v, d) { d = d == null ? 1 : d; return Number(v).toFixed(d); }

function rankInfo(fusedIds, gtIds, idTextMap) {
  var pos = {};
  fusedIds.forEach(function (id, i) { pos[id] = i + 1; });
  var rows = [], cov = {}, missingAt40 = 0, missingAt144 = 0, totalTok = {};
  var K_MAX = KSWEEP[KSWEEP.length - 1];
  KSWEEP.forEach(function (k) { cov[k] = 0; totalTok[k] = 0; });
  gtIds.forEach(function (gid) {
    var r = pos[gid] || null; // null => >144 / 未召回
    var eff = r || (K_MAX + 1);
    rows.push({ gtId: gid, rank: r, rankBucket: eff <= 20 ? '1-20' : eff <= 40 ? '21-40' : eff <= 60 ? '41-60' : eff <= 80 ? '61-80' : eff <= 100 ? '81-100' : eff <= 120 ? '101-120' : eff <= 140 ? '121-140' : eff <= 144 ? '141-144' : '>144' });
    KSWEEP.forEach(function (k) { if (eff <= k) cov[k]++; });
    if (r == null || r > 40) missingAt40++;
    if (r == null) missingAt144++;
  });
  fusedIds.forEach(function (id, i) {
    var i1 = i + 1;
    KSWEEP.forEach(function (k) { if (i1 <= k) totalTok[k] += Math.round((idTextMap[id] || '').length / 1.6); });
  });
  return {
    gtTotal: gtIds.length,
    coverage: cov,
    missingAt40: missingAt40,
    missingAt144: missingAt144,
    missingAt144Pct: f(missingAt144 / gtIds.length * 100, 1) + '%',
    windowEvents: KSWEEP.reduce(function (o, k) { o[k] = Math.min(k, fusedIds.length); return o; }, {}),
    windowTokens: totalTok,
    rows: rows,
  };
}

async function main() {
  console.log('=== 注入量 k 扫描 Step 0：确定性覆盖诊断 ===');
  console.log('TOP_K_bm25=' + TOP_K_BM25 + ', TOP_K_vec=' + TOP_K_VEC + ', Fuse α=' + ALPHA + ', rrfK=' + RRF_K + ', Fuse截断=' + FUSE_TOP_K);

  resetVectorIndex(CHAT_ID);
  await ensureVectorIndex(allSTM, {}, CHAT_ID);
  var vecIdx = getVectorIndex(CHAT_ID);
  console.log('向量索引: ' + vecIdx.entries.length + ' 条\n');

  var byAnchor = {};
  var nArr = [], allArr = [];

  for (var qi = 0; qi < qaAnchors.length; qi++) {
    var a = qaAnchors[qi];
    process.stdout.write('[' + (qi + 1) + '/' + qaAnchors.length + '] ' + a.id + '(' + a.type + ') ... ');

    delete process.env.NE_BENCHMARK_VECTOR;
    var bm25r = await filterCandidates(a.query, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
    process.env.EMBEDDING_URL = config.url;
    process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
    process.env.EMBEDDING_API_KEY = config.key;
    var qemb = await computeEmbedding(a.query);
    var vres = vectorSearch(qemb, vecIdx, TOP_K_VEC);
    var bm25Ids = bm25r.filter(function (r) { return !r.__isDirectory; }).map(function (r) { return r.__id || r.id; });
    var vecIds = vres.map(function (v) { return v.entry.id; });
    var fused = linearFuse(bm25Ids, vecIds, ALPHA, FUSE_TOP_K, RRF_K);

    var info = rankInfo(fused, a.gtEventIds || [], idText);
    byAnchor[a.id] = { id: a.id, type: a.type, source: a.source, query: a.query, gtTotal: info.gtTotal, coverage: info.coverage, missingAt40: info.missingAt40, missingAt144: info.missingAt144, missingAt144Pct: info.missingAt144Pct, windowEvents: info.windowEvents, windowTokens: info.windowTokens };
    if (a.type === 'narrative') nArr.push(info); else allArr.push(info);
    allArr.push(info);
    console.log('coverage@40=' + f(info.coverage[40] / info.gtTotal * 100) + '%, @144=' + f(info.coverage[144] / info.gtTotal * 100) + '%');
  }

  function merge(arr) {
    var m = {};
    KSWEEP.forEach(function (k) { m['c' + k] = 0; });
    var gt = 0, miss40 = 0, miss144 = 0;
    arr.forEach(function (i) { gt += i.gtTotal; miss40 += i.missingAt40; miss144 += i.missingAt144; KSWEEP.forEach(function (k) { m['c' + k] += i.coverage[k]; }); });
    var cov = {};
    KSWEEP.forEach(function (k) { cov[k] = f(m['c' + k] / gt * 100, 1) + '%'; cov[String(k)] = cov[k]; });
    return { gtTotal: gt, coverage: cov, missingAt40: miss40, missingAt40Pct: f(miss40 / gt * 100, 1) + '%', missingAt144: miss144, missingAt144Pct: f(miss144 / gt * 100, 1) + '%' };
  }

  var narrativeMerged = merge(nArr);
  var allMerged = merge(allArr);

  // 缺失 EDF：全部 GT 事件按 rank 桶计数
  var edf = {};
  allArr.forEach(function (i) { i.rows.forEach(function (r) { edf[r.rankBucket] = (edf[r.rankBucket] || 0) + 1; }); });
  var knownMiss = {};
  KNOWN_MISSING_OLD.forEach(function (id) { knownMiss[id] = 'known-old'; });

  var summary = {
    config: { TOP_K_BM25: TOP_K_BM25, TOP_K_VEC: TOP_K_VEC, FUSE_TOP_K: FUSE_TOP_K, alpha: ALPHA, rrfK: RRF_K, kSweep: KSWEEP },
    corpus: { stmEntries: vecIdx.entries.length, ltmEvents: allLTM.length },
    narrativeMerged: narrativeMerged,
    allMerged: allMerged,
    missingEdfAllGtByRankBucket: edf,
    knownOldMissing: KNOWN_MISSING_OLD,
    anchors: byAnchor,
  };

  writeFileSync(join(OUT, 'coverage_by_anchor.json'), JSON.stringify(byAnchor, null, 2), 'utf-8');
  writeFileSync(join(OUT, 'narrative_merged_coverage.json'), JSON.stringify(narrativeMerged, null, 2), 'utf-8');
  writeFileSync(join(OUT, 'all_merged_coverage.json'), JSON.stringify(allMerged, null, 2), 'utf-8');
  writeFileSync(join(OUT, 'missing_edf.json'), JSON.stringify({ rankBuckets: edf, knownOldMissing: KNOWN_MISSING_OLD }, null, 2), 'utf-8');
  writeFileSync(join(OUT, 'window_stats.json'), JSON.stringify({ anchors: byAnchor }, null, 2), 'utf-8');

  var t = computeTuple(null, { fixturePath: join(__dirname, 'injection-qa-anchors.js'), armPromptText: 'injection-kscan-step0 coverage diagnostic', split: 'dev' });
  var md = [
    '<!-- version: report=coverage-diagnostic fixture=' + t.fixture + ' queries=' + t.queries + ' split=' + t.split + ' config=' + t.config + ' judge=' + t.judge + ' -->',
    '# 注入量 k 扫描 · Step 0 确定性覆盖诊断',
    '',
    '**生成**: ' + new Date().toISOString().replace('T', ' ').slice(0, 19),
    '**口径**: BM25 top-' + TOP_K_BM25 + ' + Vector top-' + TOP_K_VEC + ' + linearFuse(α=' + ALPHA + ', rrfK=' + RRF_K + ', 截断 ' + FUSE_TOP_K + ')；与 benchmark-topk-sweep 一致。',
    '**语料**: allSTM ' + vecIdx.entries.length + ' 条 + allLTM ' + allLTM.length + ' 条。零读者调用（纯确定性）。',
    '',
    '## narrative 合并（9 叙事锚）',
    '',
    '- GT 总数: ' + narrativeMerged.gtTotal,
    '- coverage(k): ' + KSWEEP.map(function (k) { return 'k=' + k + ' → ' + narrativeMerged.coverage[k]; }).join('，'),
    '- 窗口外缺失(rank>40): ' + narrativeMerged.missingAt40 + '/' + narrativeMerged.gtTotal + ' = ' + narrativeMerged.missingAt40Pct,
    '- 窗口外缺失(rank>144): ' + narrativeMerged.missingAt144 + '/' + narrativeMerged.gtTotal + ' = ' + narrativeMerged.missingAt144Pct,
    '',
    '## 全锚合并（21 锚）',
    '',
    '- GT 总数: ' + allMerged.gtTotal,
    '- coverage(k): ' + KSWEEP.map(function (k) { return 'k=' + k + ' → ' + allMerged.coverage[k]; }).join('，'),
    '- 窗口外缺失(rank>40): ' + allMerged.missingAt40 + '/' + allMerged.gtTotal + ' = ' + allMerged.missingAt40Pct,
    '- 窗口外缺失(rank>144): ' + allMerged.missingAt144 + '/' + allMerged.gtTotal + ' = ' + allMerged.missingAt144Pct,
    '',
    '## 缺失事件 EDF（全部 GT 事件按融合 rank 分桶）',
    '',
    '| rank 桶 | 计数 |',
    '|---|---|',
  ].concat(Object.keys(edf).sort(function (a, b) { return bucketOrd(a) - bucketOrd(b); }).map(function (b) { return '| ' + b + ' | ' + edf[b] + ' |'; })).concat([
    '',
    '## 已知旧缺失事件（canonical §8 6 个，作为对照锚点）',
    '',
    '| 事件 | 是否承载在新 facts 批次 |',
    '|---|---|',
  ].concat(KNOWN_MISSING_OLD.map(function (id) { return '| ' + id + ' | — |'; })).concat([
    '',
    '- **LLM 非确定性**：检索分数/排序由确定性计算（噪声=确定性，见 canonical §0）。',
    '',
  ]));
  writeFileSync(join(OUT, 'README.md'), md.join('\n'), 'utf-8');

  console.log('\n=== 结果摘要 ===');
  console.log('narrative coverage: ' + KSWEEP.map(function (k) { return 'k=' + k + ':' + narrativeMerged.coverage[k]; }).join(' '));
  console.log('narrative missing(>40): ' + narrativeMerged.missingAt40 + '/' + narrativeMerged.gtTotal + '  missing(>144): ' + narrativeMerged.missingAt144 + '/' + narrativeMerged.gtTotal);
  console.log('全锚 missing(>40): ' + allMerged.missingAt40 + '/' + allMerged.gtTotal + '  missing(>144): ' + allMerged.missingAt144 + '/' + allMerged.gtTotal);
  console.log('\n输出: ' + OUT);
}

function bucketOrd(b) { return { '1-20': 1, '21-40': 2, '41-60': 3, '61-80': 4, '81-100': 5, '101-120': 6, '121-140': 7, '141-144': 8, '>144': 9 }[b] || 99; }

main().catch(function (e) { console.error('FATAL', e); process.exit(1); });