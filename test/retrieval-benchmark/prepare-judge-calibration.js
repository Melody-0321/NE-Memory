// P0-2 材料准备（盲判版）：生成 30 条 judge 人工校准材料
// A. modality 12 条：原文对话 + 抽取摘要 + ground-truth expectedNote → 人工判"存活/丢失/不确定"
//    （刻意隐藏 judge 原始判定，防锚定；抽取摘要镜像自 modality-survival.md 2026-08-17）
// B. 检索 18 条（dev，按 Lin WS 分层 高/中/低）：查询 + Top-10 检索事件（Lin α=0.20 冻结配置）→ 人工重打 0/1/2 相关分
// 用法：node prepare-judge-calibration.js [--split dev]（仅 dev 有意义，holdout 已封存不用于校准）
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterCandidates } from '../../src/core/vault/retrieval-filter.js';
import { resetVectorIndex, ensureVectorIndex, getVectorIndex, vectorSearch } from '../../src/core/engine/retrieval-fusion.js';
import { computeEmbedding } from '../../src/core/engine/embedding.js';
import { allSTM, allLTM } from './fixture.js';
import { modalityCases } from './modality-fixture.js';
import { loadSplitQueries } from './query-split-utils.js';
var queries = loadSplitQueries();
import { withProvenanceHeader } from './report-provenance.js';
import { linearFuse } from './benchmark-fusions.js';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));
var CHAT_ID = '__judge_calib__';
var TOP_K_BM25 = 40;
var TOP_K_VEC = 144;
var SHOW_K = 10;

// 抽取摘要镜像（modality-survival.md 2026-08-17；judge 判定 yes/no 故意不在此出现，供后续比对脚本单独引用）
var EXTRACT_SUMMARY = {
  T1: '安然抱怨写稿疲惫，戏言想搬到海边躺平不写。',
  T2: '林晚与安然聊天，开玩笑说想辞职去环游世界。',
  T3: '江岚称与己约定本周暴瘦十斤。',
  T4: '苏茉打趣要给对方介绍靠谱对象。',
  H1: '江岚提议养猫，安然反问时间是否足够。',
  H2: '安然假设自己不写小说，询问未来可能从事的职业方向。',
  H3: '江岚表示想攒钱将来在城里买房。',
  H4: '林晚谈及正打磨短篇、打算投给大平台试水，目前仅是计划尚未投稿。',
  R1: '安然宣布从今天起戒咖啡。',
  R2: '*(解析失败)* — 原始 LLM 输出 JSON 解析失败（见 modality-survival.md R2 明细）',
  R3: '安然提议先冷静两天',
  R4: '林晚称下周搬家，并表示住三年已足够。',
};

function setBgeM3() {
  process.env.EMBEDDING_URL = config.url;
  process.env.EMBEDDING_MODEL = 'BAAI/bge-m3';
  process.env.EMBEDDING_API_KEY = config.key;
  delete process.env.NE_BENCHMARK_VECTOR;
}

function renderModality(L) {
  L.push('# 一、Modality 存活率人工校准（12 条）');
  L.push('');
  L.push('> 任务：阅读「原文对话 + 抽取摘要 + Ground-truth 情态」，独立判定抽取摘要是否**保留了**该情态语义。');
  L.push('> 判据：摘要把打趣/假设/反悔写成了**事实** → 丢失；摘要保留了"开玩笑/打算/反悔"等语义 → 存活。');
  L.push('> 不要参考任何既往 judge 判定（本材料已隐藏）。每条填一个：**存活 / 丢失 / 不确定**。');
  L.push('');
  var idx = 0;
  modalityCases.forEach(function (c) {
    idx++;
    L.push('---');
    L.push('');
    L.push('### M' + String(idx).padStart(2, '0') + '｜' + c.id + ' · ' + c.categoryLabel);
    L.push('');
    L.push('**原文对话**：');
    c.messages.forEach(function (m, i) {
      L.push((i + 1) + '. [' + m.role + '] ' + (m.name || '') + '：' + m.mes);
    });
    L.push('');
    L.push('**抽取摘要**：' + (EXTRACT_SUMMARY[c.id] || '(缺失)'));
    L.push('');
    L.push('**Ground-truth 情态**：' + c.expectedNote);
    L.push('');
    L.push('**你的判定**：□ 存活　□ 丢失　□ 不确定　→ 判定：_______');
    L.push('');
  });
}

async function renderRetrieval(L) {
  var dump = JSON.parse(readFileSync(join(__dirname, 'output', 'per-query-scores.json'), 'utf-8'));
  var linMap = {};
  dump.queries.forEach(function (q) { linMap[q.id] = { lin: q.Lin, type: q.type }; });

  // 按 Lin WS 分带：高 ≥0.7 / 中 0.3–0.7 / 低 <0.3（dev 实际分布 8/7/3，如实记录）
  var band = function (ws) { return ws >= 0.7 ? '高' : (ws >= 0.3 ? '中' : '低'); };
  var ordered = queries.slice().sort(function (a, b) { return (linMap[b.id] ? linMap[b.id].lin : 0) - (linMap[a.id] ? linMap[a.id].lin : 0); });

  L.push('# 二、检索相关度人工校准（18 条，dev）');
  L.push('');
  L.push('> 任务：对每条查询，独立给「Top-10 检索事件」标 0/1/2 相关度——0=无关，1=部分相关，2=直接相关。');
  L.push('> 判据以你的判断为准（该条查询"应该想起来什么"）；检索事件按 Lin α=0.20 融合（冻结配置）返回。');
  L.push('> 分带：高(WS≥0.7) / 中(0.3–0.7) / 低(<0.3)，按 Lin WS 排序。');
  L.push('');

  // 每查询一次检索（BM25 本地 + Vector API），Lin 融合取 Top-10
  setBgeM3();
  resetVectorIndex(CHAT_ID);
  await ensureVectorIndex(allSTM, {}, CHAT_ID);
  var vecIdx = getVectorIndex(CHAT_ID);
  var stmById = {};
  allSTM.forEach(function (s) { stmById[s.id || s.__id] = s; });

  var bands = { '高': [], '中': [], '低': [] };
  for (var qi = 0; qi < ordered.length; qi++) {
    var q = ordered[qi];
    var text = q.query || q.question;
    var bm25Ids = (await filterCandidates(text, allSTM, allLTM, TOP_K_BM25, 3, {}, CHAT_ID)).map(function (r) { return r.__id || r.id; });
    var queryEmb = await computeEmbedding(text);
    var vecIds = vectorSearch(queryEmb, vecIdx, TOP_K_VEC).map(function (v) { return v.entry.id; });
    var fused = linearFuse(bm25Ids, vecIds, 0.20, TOP_K_BM25, 60).slice(0, SHOW_K);
    var ws = linMap[q.id] ? linMap[q.id].lin : 0;
    var b = band(ws);
    bands[b].push({ q: q, ws: ws, fused: fused, stmById: stmById });
    process.stdout.write('[' + (qi + 1) + '/' + ordered.length + '] ' + q.id + ' ' + b + ' ...\n');
  }

  var idx = 0;
  Object.keys(bands).forEach(function (b) {
    L.push('---');
    L.push('');
    L.push('## 分带：' + b + '（n=' + bands[b].length + '）');
    L.push('');
    bands[b].forEach(function (item) {
      idx++;
      var q = item.q;
      L.push('### R' + String(idx).padStart(2, '0') + '｜' + q.id + ' · ' + (item.q.type === 'narrative' ? '叙事' : '目标') + ' · ' + b);
      L.push('');
      L.push('**查询**：' + (q.question || q.query));
      L.push('');
      L.push('**Top-' + SHOW_K + ' 检索事件（Lin α=0.20）**：');
      item.fused.forEach(function (id, i) {
        var e = item.stmById[id];
        var txt = e ? (e.period ? '[' + e.period + '] ' : '') + (e.scene ? e.scene + '：' : '') + (e.event || e.summary || '') : '(事件缺失 ' + id + ')';
        L.push((i + 1) + '. ' + txt + '　→ 0/1/2：___');
      });
      L.push('');
    });
  });
}

async function main() {
  var outDir = join(__dirname, 'output');
  mkdirSync(outDir, { recursive: true });
  var L = [];
  L.push('# Judge 人工校准盲判材料（P0-2）');
  L.push('');
  L.push('- 共 30 条：modality 12 + 检索 18（dev）');
  L.push('- 盲判：全部隐藏 judge 原始判定，防锚定');
  L.push('- 判据预注册：≥85% 一致→单裁判可继续；70–85%→降格；<70%→修 judge prompt 再重跑');
  L.push('');
  renderModality(L);
  await renderRetrieval(L);

  var outPath = join(outDir, 'judge-calibration-blinded.md');
  writeFileSync(outPath, withProvenanceHeader('judge-calibration', L.join('\n')), 'utf-8');
  console.log('盲判材料: ' + outPath);
}

main().catch(function (e) { console.error('prepare-judge-calibration crashed:', e); process.exit(2); });
