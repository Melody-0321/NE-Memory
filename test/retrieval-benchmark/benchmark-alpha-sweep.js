// Lin α 融合权重扫描 —— P0-1（冻结前决策：α=0.20 是否仍是最优）
// 一次 API pass（BM25 本地 + Vector embedding，与 benchmark-perquery.js 相同），本地扫多个 α。
// α 语义（benchmark-fusions.js linearFuse）：α=BM25 权重，1-α=Vector 权重。α=0 纯向量，α=1 纯 BM25。
// 用法：node benchmark-alpha-sweep.js [--split dev|holdout|all]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM, entityToStmIds } from './fixture.js';
import { loadSplitQueries, outputDirFor } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader } from './report-provenance.js';
import { precisionAtK, recallAtK, ndcgAtK, mrr, hitAtK, precisionAtK_active, hitAtK_active, weightedScore, avg } from './metrics.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_alpha_sweep__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;
var ALPHAS = [0.00, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.70, 1.00];

function f(v) { return v.toFixed(3); }

function setBgeM3() {
  process.env.EMBEDDING_URL = config.url;
  process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
  process.env.EMBEDDING_API_KEY = config.key;
  delete process.env.NE_BENCHMARK_VECTOR;
}

function calcScores(ids, gt, q) {
  var s = {
    p5: precisionAtK(ids, gt, 5), p10: precisionAtK(ids, gt, 10), p20: precisionAtK(ids, gt, 20),
    r5: recallAtK(ids, gt, 5), r10: recallAtK(ids, gt, 10), r20: recallAtK(ids, gt, 20),
    ndcg10: ndcgAtK(ids, gt, 10), mrr: mrr(ids, gt), hit5: hitAtK(ids, gt, 5),
    hit3: hitAtK(ids, gt, 3),
    p5a: q.activeEntities ? precisionAtK_active(ids, gt, q.activeEntities, entityToStmIds, 5) : 0,
  };
  s.ws = weightedScore(s);
  return s;
}

async function main() {
  setBgeM3();
  resetVectorIndex(CHAT_ID);
  await ensureVectorIndex(allSTM, {}, CHAT_ID);
  var vecIdx = getVectorIndex(CHAT_ID);
  var outDir = outputDirFor(__dirname);
  mkdirSync(outDir, { recursive: true });

  // 每查询：BM25 ids（本地）+ Vector ids（API 一次）
  var perQuery = [];
  for (var qi = 0; qi < queries.length; qi++) {
    var q = queries[qi];
    var text = q.query || q.question;
    var bm25Ids = (await filterCandidates(text, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID)).map(function (r) { return r.__id || r.id; });
    var queryEmb = await computeEmbedding(text);
    var vecIds = vectorSearch(queryEmb, vecIdx, TOP_K_VEC).map(function (v) { return v.entry.id; });
    perQuery.push({ id: q.id, type: q.type, gt: q.groundTruth, bm25Ids: bm25Ids, vecIds: vecIds });
    process.stdout.write('[' + (qi + 1) + '/' + queries.length + '] ' + q.id + ' ...\n');
  }

  // 每个 α：融合 → WS（本地，零额外 API）
  var rows = ALPHAS.map(function (alpha) {
    var wsAll = [], wsNarr = [], wsTgt = [];
    perQuery.forEach(function (e) {
      var fused = linearFuse(e.bm25Ids, e.vecIds, alpha, TOP_K_BM25, 60);
      var s = calcScores(fused, e.gt, e);
      wsAll.push(s.ws);
      if (e.type === 'narrative') wsNarr.push(s.ws); else wsTgt.push(s.ws);
    });
    return { alpha: alpha, all: avg(wsAll), narr: avg(wsNarr), tgt: avg(wsTgt) };
  });

  // 报告
  var L = [];
  L.push('# Lin α 融合权重扫描');
  L.push('');
  L.push('- Split：' + (process.argv.indexOf('--split') >= 0 ? process.argv[process.argv.indexOf('--split') + 1] : 'dev'));
  L.push('- 语料：fixture.js 144 条（同 benchmark-perquery.js）；BM25 TOP_K=40，Vector TOP_K=144（bge-m3）');
  L.push('- α 语义：α=BM25 权重，1-α=Vector 权重（linearFuse）；α=0 纯向量，α=1 纯 BM25');
  L.push('- 每查询只跑一次 BM25+Vector（一次 API pass），所有 α 本地融合');
  L.push('');
  L.push('| α | WS(总) | WS(narr) | WS(tgt) |');
  L.push('|---|---|---|---|');
  var best = rows.slice().sort(function (a, b) { return b.all - a.all; })[0];
  rows.forEach(function (r) {
    var mark = r.alpha === best.alpha ? ' 🥇' : '';
    L.push('| ' + f(r.alpha) + ' | ' + f(r.all) + ' | ' + f(r.narr) + ' | ' + f(r.tgt) + ' |' + mark);
  });
  L.push('');
  L.push('- 最优 α：' + f(best.alpha) + '（WS=' + f(best.all) + '）');
  L.push('- 生产值 α=0.20 对比最优：Δ=' + f(rows.filter(function (r) { return r.alpha === 0.20; })[0].all - best.all));
  L.push('');
  L.push('<sub>dev 集探索结论；正式生效以配置冻结 + holdout 封存运行后的 canonical-numbers.md 为准。</sub>');

  var outPath = join(outDir, 'alpha-sweep.md');
  writeFileSync(outPath, withProvenanceHeader('alpha-sweep', L.join('\n')), 'utf-8');
  console.log('\nAlpha sweep report: ' + outPath);
}

main().catch(function (e) { console.error('Alpha sweep crashed:', e); process.exit(2); });
