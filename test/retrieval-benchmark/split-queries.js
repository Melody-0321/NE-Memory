// P0-0: dev/holdout 分离 —— 固定种子分层，输出 queries-split.json
// 用法：node split-queries.js（无参数）。跑一次即提交，之后不再变更。
// 说明：修复 train-on-test —— 28 条按 type 分层切 18/10，holdout 封存。
// 本脚本唯一真源是 queries.js（28 条 id 集合）；queries-split.json 由它一次性生成。
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { queries } from './queries.js';

var __dirname = dirname(fileURLToPath(import.meta.url));

// hard-bone 查询（per-query-analysis.md：所有方法 WS < 0.30）
var HARD_BONE = ['q4', 'q23', 'q25', 'q27', 'q28'];

// 固定种子 PRNG（mulberry32），结果可复现
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function byId(ids) {
  var s = {};
  ids.forEach(function (x) { s[x] = true; });
  return s;
}

function main() {
  var SEED = 20260818;

  var narrative = queries.filter(function (q) { return q.type === 'narrative'; }).map(function (q) { return q.id; });
  var targeted = queries.filter(function (q) { return q.type === 'targeted'; }).map(function (q) { return q.id; });
  if (queries.length !== 28 || narrative.length !== 10 || targeted.length !== 18) {
    console.error('预期 28（10 narr + 18 tgt），实际 ' + queries.length + '（' + narrative.length + ' narr + ' + targeted.length + ' tgt），中止（防止在错误语料上切分）');
    process.exit(1);
  }

  var rand = mulberry32(SEED);
  var hb = byId(HARD_BONE);
  var adjustments = [];

  // narrative：唯一 hard-bone q4 固定进 holdout（保证 holdout 有难度覆盖），其余 9 条随机切 dev 6 / holdout 3
  var narrOthers = shuffle(narrative.filter(function (id) { return id !== 'q4'; }), rand);
  var narrDev = narrOthers.slice(0, 6);
  var narrHold = ['q4'].concat(narrOthers.slice(6, 9));

  // targeted：先纯随机 12/6；若 holdout 无 targeted hard-bone（q23/q25/q27/q28），强制交换一条并记录
  var tgtShuffled = shuffle(targeted, rand);
  var tgtDev = tgtShuffled.slice(0, 12);
  var tgtHold = tgtShuffled.slice(12, 18);
  var tgtHoldHard = tgtHold.filter(function (id) { return hb[id]; });
  if (tgtHoldHard.length === 0) {
    var hardInDev = tgtDev.filter(function (id) { return hb[id]; });
    var nonHardInHold = tgtHold.filter(function (id) { return !hb[id]; });
    if (hardInDev.length > 0 && nonHardInHold.length > 0) {
      var i1 = tgtDev.indexOf(hardInDev[0]);
      var i2 = tgtHold.indexOf(nonHardInHold[0]);
      tgtDev[i1] = nonHardInHold[0];
      tgtHold[i2] = hardInDev[0];
      adjustments.push('targeted holdout 无 hard-bone：' + hardInDev[0] + ' ↔ ' + nonHardInHold[0] + ' 交换');
    }
  }

  var dev = narrDev.concat(tgtDev);
  var holdout = narrHold.concat(tgtHold);

  // 断言：计数 + 覆盖（无重复、无遗漏）
  if (dev.length !== 18 || holdout.length !== 10) {
    console.error('split 计数错误: dev=' + dev.length + ' holdout=' + holdout.length);
    process.exit(1);
  }
  var uniq = {};
  dev.concat(holdout).forEach(function (id) { uniq[id] = true; });
  if (Object.keys(uniq).length !== 28) {
    console.error('split 覆盖错误（非 28 个唯一 id）');
    process.exit(1);
  }

  var meta = {
    purpose: 'dev/holdout 分离 —— 修复 train-on-test。dev 用于一切调参与探索；holdout 封存，仅在配置冻结后运行一次。',
    seed: SEED,
    method: '按 type 分层（narrative 10→6/4，targeted 18→12/6）；narrative 唯一 hard-bone q4 固定进 holdout；targeted 保证 holdout 至少 1 条 hard-bone。',
    hard_bone: HARD_BONE,
    hard_bone_placement: {
      dev: dev.filter(function (id) { return hb[id]; }).sort(),
      holdout: holdout.filter(function (id) { return hb[id]; }).sort(),
    },
    counts: { dev: 18, holdout: 10, dev_narrative: 6, dev_targeted: 12, holdout_narrative: 4, holdout_targeted: 6 },
    adjustments: adjustments,
    sealed_discipline: '封存纪律：holdout 只在 P0-1 封存运行时执行一次；解封前冻结全部检索配置（融合权重、BM25 参数、embedding 模型、topK）；解封后无论结果如何不得回改配置重跑。跑前冻结，跑后不挑读数。',
    created: new Date().toISOString().slice(0, 10),
  };

  var out = {
    _meta: meta,
    dev: dev.slice().sort(),
    holdout: holdout.slice().sort(),
  };

  writeFileSync(join(__dirname, 'queries-split.json'), JSON.stringify(out, null, 2) + '\n', 'utf-8');

  console.log('=== dev/holdout 分离 ===');
  console.log('dev      : ' + dev.length + ' 条（' + narrDev.length + ' narr + ' + tgtDev.length + ' tgt）');
  console.log('holdout  : ' + holdout.length + ' 条（' + narrHold.length + ' narr + ' + tgtHold.length + ' tgt）');
  console.log('holdout hard-bone: ' + meta.hard_bone_placement.holdout.join(', '));
  if (adjustments.length) console.log('调整：' + adjustments.join('；'));
  console.log('已写入 queries-split.json。此文件跑一次即提交，之后不再变更。');
}

main();
