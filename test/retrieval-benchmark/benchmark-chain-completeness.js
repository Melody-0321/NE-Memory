// benchmark-chain-completeness.js — P1-T0 链完整率 / 截断率（母计划 §T0 + benchmark-improvement-plan §7）
// 目标：定量回答"状态类查询下，最新态事件是否进了注入 Top-40"，定检索是不是当下真瓶颈。
// 现役检索：bge-m3 + summary（BM25）+ Lin α=0.20 fusion top40（与 benchmark-perquery.js 同管道）
// 状态弧金例：t0-state-arcs.js（7 弧，latest=最新态 / old=旧态）
// 指标：
//   - 链完整率：latest 事件 ∈ Top-40 的比例（事件粒度 + 弧粒度：全部 latest 进 Top-40）
//   - 截断率：old 进 Top-40 而对应 latest 没进（时间线失守）的弧比例
//   - 预算位移量：latest 进原始候选（BM25∪Vector topK）但被 fusion 挤出 Top-40 的数量
//   - 断点归因：每个丢失 latest 事件 → fusion/ranking（原始候选有被挤出）或 index/recall（原始召回失败）
// 用法：node benchmark-chain-completeness.js
// 产出：output/t0-chain-completeness.md
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM } from './fixture.js';
import { stateArcs } from './t0-state-arcs.js';
import { linearFuse } from './benchmark-fusions.js';
import { withProvenanceHeader } from './report-provenance.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__bench_t0_chain__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;
var TOP_K_FUSED = 40;
var ALPHA = 0.20;

function setBgeM3() {
  process.env.EMBEDDING_URL = config.url;
  process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
  process.env.EMBEDDING_API_KEY = config.key;
  delete process.env.NE_BENCHMARK_VECTOR;
}

function stmById() {
  var map = {};
  allSTM.forEach(function (s) { map[s.id] = s; });
  return map;
}

function main() {
  console.log('=== P1-T0 链完整率 / 截断率 ===');
  console.log('状态弧: ' + stateArcs.length + ' | 现役检索: bge-m3 + BM25 + Lin α=' + ALPHA + ' top' + TOP_K_FUSED);

  return (async function () {
    setBgeM3();
    resetVectorIndex(CHAT_ID);
    await ensureVectorIndex(allSTM, {}, CHAT_ID);
    var vecIdx = getVectorIndex(CHAT_ID);
    var byId = stmById();
    console.log('Vector index: ' + vecIdx.entries.length + ' entries\n');

    var rows = [];
    var latestAll = [];      // 所有 latest 事件
    var latestHit = [];      // 进 Top-40 的 latest 事件
    var lostDetails = [];    // 丢失的 latest 事件（含断点归因）
    var truncatedArcs = [];  // 时间线失守的弧
    var displaced = 0;       // 预算位移量（原始候选有、融合后没）

    for (var ai = 0; ai < stateArcs.length; ai++) {
      var arc = stateArcs[ai];
      process.stdout.write('[' + (ai + 1) + '/' + stateArcs.length + '] ' + arc.id + ' ' + arc.name + ' ... ');

      // BM25（现役 summary 检索）
      var bm25Res = await filterCandidates(arc.query, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID);
      var bm25Ids = bm25Res.map(function (r) { return r.__id || r.id; });

      // Vector（bge-m3）
      var queryEmb = await computeEmbedding(arc.query);
      var vecRes = vectorSearch(queryEmb, vecIdx, TOP_K_VEC);
      var vecIds = vecRes.map(function (v) { return v.entry.id; });

      // Lin fusion（现役注入候选 Top-40）
      var linIds = linearFuse(bm25Ids, vecIds, ALPHA, TOP_K_FUSED, 60);

      var rawPool = {};
      bm25Ids.forEach(function (id) { rawPool[id] = true; });
      vecIds.forEach(function (id) { rawPool[id] = true; });
      var fusedSet = {};
      linIds.forEach(function (id) { fusedSet[id] = true; });

      var latestIn = arc.latest.filter(function (id) { return fusedSet[id]; });
      var oldIn = arc.old.filter(function (id) { return fusedSet[id]; });

      latestAll = latestAll.concat(arc.latest);
      latestHit = latestHit.concat(latestIn);

      // 丢失的 latest 事件 + 断点归因
      arc.latest.forEach(function (id) {
        if (fusedSet[id]) return;
        var inRaw = rawPool[id];
        if (inRaw) displaced++;
        lostDetails.push({ arc: arc.id, arcName: arc.name, id: id, inRaw: inRaw, text: (byId[id] || {}).event || '' });
      });

      // 时间线失守：old 进了 Top-40 而 latest 一个都没进
      var trunc = oldIn.length > 0 && latestIn.length === 0;
      if (trunc) truncatedArcs.push(arc.id);

      var chainOk = latestIn.length === arc.latest.length;
      var rankOfLatest = arc.latest.map(function (id) {
        var idx = linIds.indexOf(id);
        return idx >= 0 ? idx + 1 : '-';
      });

      rows.push({
        arc: arc, chainOk: chainOk, latestIn: latestIn.length, latestTotal: arc.latest.length,
        oldInTop40: oldIn.length, oldTotal: arc.old.length, truncated: trunc,
        rankOfLatest: rankOfLatest,
      });

      console.log(
        'latest ' + latestIn.length + '/' + arc.latest.length + (chainOk ? ' ✓' : ' ✗') +
        ' | oldIn ' + oldIn.length + '/' + arc.old.length + (trunc ? ' ⚠截断' : '')
      );
    }

    // ── 聚合 ──
    var eventChainRate = latestHit.length / latestAll.length;
    var arcChainRate = rows.filter(function (r) { return r.chainOk; }).length / rows.length;
    var truncationRate = truncatedArcs.length / rows.length;
    var recallBreak = lostDetails.filter(function (d) { return !d.inRaw; }).length; // 索引/召回断点
    var fusionBreak = lostDetails.filter(function (d) { return d.inRaw; }).length;  // 融合/排序断点

    // ── 报告 ──
    var L = [];
    L.push('# T0 链完整率 / 截断率（P1-T0）');
    L.push('');
    L.push('- 语料：fixture.js 144 条（静态快照，不模拟注入时序）');
    L.push('- 现役检索：bge-m3（vector top' + TOP_K_VEC + '）+ BM25/summary（top' + TOP_K_BM25 + '）+ Lin α=' + ALPHA + ' fusion top' + TOP_K_FUSED + '（=注入 Top-K）');
    L.push('- 状态弧：' + stateArcs.length + ' 条（t0-state-arcs.js，latest=最新态金例 / old=旧态探针）');
    L.push('');
    L.push('## 1. 指标');
    L.push('');
    L.push('| 指标 | 值 | 判据对照 |');
    L.push('|---|---|---|');
    L.push('| 链完整率（事件粒度） | **' + (eventChainRate * 100).toFixed(1) + '%**（' + latestHit.length + '/' + latestAll.length + '） | ≥95% 挂起 T2；<90% 立项 T2 |');
    L.push('| 链完整率（弧粒度：全部 latest 进 Top-40） | **' + (arcChainRate * 100).toFixed(1) + '%**（' + rows.filter(function (r) { return r.chainOk; }).length + '/' + rows.length + '） | 同上 |');
    L.push('| 截断率（旧态在、新态不在） | **' + (truncationRate * 100).toFixed(1) + '%**（' + truncatedArcs.length + '/' + rows.length + ' 弧） | 时间线失守率，人设崩坏频率代理 |');
    L.push('| 预算位移量（latest 进原始候选但被挤出 Top-40） | ' + displaced + ' 事件 | 硬负例挤掉正确事件量（辅助） |');
    L.push('| 断点归因：索引/召回（原始候选即未召回） | ' + recallBreak + ' 事件 | 底层语义检索失败 |');
    L.push('| 断点归因：融合/排序（原始候选有、被挤出） | ' + fusionBreak + ' 事件 | 融合阈值把最新态挤出注入窗口 |');
    L.push('');
    L.push('## 2. 逐弧明细');
    L.push('');
    L.push('| 弧 | 查询 | latest 进 Top-40 | old 进 Top-40 | 断链? | 截断? | latest 排名 |');
    L.push('|---|---|---|---|---|---|---|');
    rows.forEach(function (r) {
      L.push('| ' + r.arc.id + ' ' + r.arc.name + ' | ' + r.arc.query + ' | ' + r.latestIn + '/' + r.latestTotal + ' | ' + r.oldInTop40 + '/' + r.oldTotal + ' | ' + (r.chainOk ? '否' : '**是**') + ' | ' + (r.truncated ? '**是**' : '否') + ' | ' + r.rankOfLatest.join(', ') + ' |');
    });
    L.push('');
    if (lostDetails.length) {
      L.push('## 3. 断链归因明细（丢失的 latest 事件）');
      L.push('');
      L.push('| 弧 | 丢失事件 | 断点 | 事件内容 |');
      L.push('|---|---|---|---|');
      lostDetails.forEach(function (d) {
        L.push('| ' + d.arc + ' | ' + d.id + ' | ' + (d.inRaw ? '融合/排序' : '索引/召回') + ' | ' + (d.text || '').slice(0, 50) + '… |');
      });
      L.push('');
    }
    if (truncatedArcs.length) {
      L.push('## 4. 时间线失守弧（截断）');
      L.push('');
      L.push(truncatedArcs.map(function (a) { return '- **' + a + '**：旧态事件进了 Top-40，但该弧最新态全部未进 —— 用户看到的是过期状态。'; }).join('\n'));
      L.push('');
    }
    L.push('## 5. 判读');
    L.push('');
    var judge;
    if (eventChainRate >= 0.95) {
      judge = '**链完整率 ≥95% → 检索非约束，T2 挂起**，预算转 T1 修复。';
    } else if (eventChainRate < 0.90) {
      judge = '**链完整率 <90% → 立即立项 T2**（reranker/大索引判级，金例本测试已标好可复用）。';
    } else {
      judge = '**链完整率 90-95% → 观察，暂不动。**';
    }
    L.push(judge);
    L.push('');
    L.push('- 断点归因解读：若丢失集中在"融合/排序"，说明底层召回（BM25+vector）状态类语义抓得够，是 fusion 阈值把最新态挤出 40 窗口；若集中在"索引/召回"，说明 embedding/BM25 对状态类查询（"现在…吗/结果/结局"）语义召回失败，指向语义层而非排序层。');
    L.push('- 博客 Limitations 素材：链完整率回答"检索指标与用户可感知质量的映射"——WS 高≠用户记得准，需链完整率/截断率佐证。');

    var outDir = join(__dirname, 'output');
    mkdirSync(outDir, { recursive: true });
    var outPath = join(outDir, 't0-chain-completeness.md');
    writeFileSync(outPath, withProvenanceHeader('t0-chain-completeness', L.join('\n')), 'utf-8');

    console.log('\n\n=== 结果 ===');
    console.log('链完整率(事件) ' + (eventChainRate * 100).toFixed(1) + '% | 弧粒度 ' + (arcChainRate * 100).toFixed(1) + '% | 截断率 ' + (truncationRate * 100).toFixed(1) + '% | 位移 ' + displaced + ' | 召回断点 ' + recallBreak + ' | 融合断点 ' + fusionBreak);
    console.log('判定: ' + judge);
    console.log('报告: ' + outPath);
  })();
}

main().catch(function (e) {
  console.error('T0 crashed:', e);
  process.exit(2);
});
