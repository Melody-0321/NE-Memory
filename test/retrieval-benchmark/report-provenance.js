// 版本四元组 —— P0-4（benchmark-improvement-plan §3）
// 每个报告头部写入四元组：语料 fixture hash / queries 版本（含 split）/ config hash / judge prompt hash
// 与 output/canonical-numbers.md 登记值不符时打印醒目警告（防 7/1 vs 7/2 口径漂移复发）
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSplitName } from './query-split-utils.js';

var __dirname = dirname(fileURLToPath(import.meta.url));

var CANONICAL = join(__dirname, 'output', 'canonical-numbers.md');

function h(s) {
  return createHash('sha256').update(s, 'utf-8').digest('hex').slice(0, 12);
}

function fileHash(p) {
  return existsSync(p) ? h(readFileSync(p, 'utf-8')) : 'missing';
}

// config hash：剥离 key/api_key/token，避免换 key 误触发口径变化
function configHash() {
  var p = join(__dirname, 'config.json');
  if (!existsSync(p)) return 'missing';
  var cfg = JSON.parse(readFileSync(p, 'utf-8'));
  function clean(v) {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) {
        if (k === 'key' || k === 'api_key' || k === 'apiKey' || k === 'token') return;
        o[k] = clean(v[k]);
      });
      return o;
    }
    return v;
  }
  return h(JSON.stringify(clean(cfg)));
}

// 当前版本四元组：fixture / queries（含 split 文件）/ split 名 / config / judge prompt
// opts 可选：{ fixturePath, armPromptText, queriesOverrideHash } —— 供 modality 臂评测等非检索场景用。
//   - fixturePath：替代默认 fixture.js 的文件路径（如 modality-eval-dev.js）
//   - armPromptText：注入后的臂提示文本；计算其 hash 作为行内 `arm`（并入 queries 位）
export function computeTuple(judgePromptText, opts) {
  opts = opts || {};
  var fixtureHashVal = opts.fixturePath
    ? h(fileHash(opts.fixturePath))
    : fileHash(join(__dirname, 'fixture.js'));
  var queriesVal;
  if (opts.armPromptText != null) {
    // modality 臂模式：queries 位承载「arm 注入文本 hash + split」
    queriesVal = h(opts.armPromptText) + '|arm';
  } else {
    queriesVal = h(fileHash(join(__dirname, 'queries.js')) + '|' + fileHash(join(__dirname, 'queries-split.json')));
  }
  return {
    fixture: fixtureHashVal,
    queries: queriesVal,
    split: (opts && opts.split) || getSplitName(),
    config: configHash(),
    judge: judgePromptText ? h(judgePromptText) : 'n/a',
  };
}

// 与 canonical-numbers.md 登记表比对，不符打印醒目警告
// 同一 reportKey 可能登记多行（不同 split / 修订版本）：按当前 split 匹配，取**最后一行**（最新登记）。
function checkAgainstCanonical(reportKey, t) {
  if (!existsSync(CANONICAL)) return;
  var text = readFileSync(CANONICAL, 'utf-8');
  var lines = text.split('\n');
  var m = null;
  for (var i = 0; i < lines.length; i++) {
    var re = new RegExp('^\\|\\s*' + reportKey + '\\s*\\|\\s*([0-9a-f]+)\\s*\\|\\s*([0-9a-f]+)(?:\\|arm)?\\s*\\|\\s*(' + (t.split || '') + ')\\s*\\|\\s*([0-9a-f]+)\\s*\\|\\s*([0-9a-f]+|n/a)\\s*\\|');
    var row = lines[i].match(re);
    if (row) { m = row; } // 不 break：取最后命中（最新登记）
  }
  if (!m) {
    console.warn('[provenance] ' + reportKey + ' 未在 canonical-numbers.md 登记（P0-1 权威运行后登记）');
    return;
  }
  var curQ = String(t.queries).replace(/\|arm$/, '');
  var cur = [t.fixture, curQ, t.split, t.config, t.judge].join('|');
  var reg = [m[1], m[2], m[3], m[4], m[5]].join('|');
  if (cur !== reg) {
    console.warn(
      '⚠️ [provenance] ' + reportKey + ' 版本四元组与登记不符（口径可能漂移）：\n' +
      '  当前: ' + cur + '\n' +
      '  登记: ' + reg + '\n' +
      '  请检查 fixture/queries/config/judge 是否被改动，勿在旧口径上写新结论。'
    );
  } else {
    console.log('[provenance] ' + reportKey + ' 版本四元组与登记一致');
  }
}

// 在报告文本前插入版本头并触发比对。脚本写文件时调用。
// opts 透传给 computeTuple：modality 臂评测等场景传 { fixturePath, armPromptText, split } 使四元组真实反映语料。
// 自动追加 LLM 非确定性声明（DoD：报告头含 judge 模型/temperature/是否重试）。判定依赖 GT 的脚本可传 opts.noiseHint 补充说明。
export function withProvenanceHeader(reportKey, text, judgePromptText, opts) {
  opts = opts || {};
  var t = computeTuple(judgePromptText, opts);
  checkAgainstCanonical(reportKey, t);
  var determinismLine = opts.noiseHint
    ? '- **LLM 非确定性**：' + opts.noiseHint
    : '- **LLM 非确定性**：检索分数/排序由确定性计算（噪声=确定性，见 canonical §0）；若判据依赖 LLM 标注的 GT，其噪声见 canonical §4.5（噪声=中）。';
  return (
    '<!-- version: report=' + reportKey +
    ' fixture=' + t.fixture +
    ' queries=' + t.queries +
    ' split=' + t.split +
    ' config=' + t.config +
    ' judge=' + t.judge +
    ' -->\n' + text +
    '\n' + determinismLine + '\n'
  );
}
