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
export function computeTuple(judgePromptText) {
  return {
    fixture: fileHash(join(__dirname, 'fixture.js')),
    queries: h(fileHash(join(__dirname, 'queries.js')) + '|' + fileHash(join(__dirname, 'queries-split.json'))),
    split: getSplitName(),
    config: configHash(),
    judge: judgePromptText ? h(judgePromptText) : 'n/a',
  };
}

// 与 canonical-numbers.md 登记表比对，不符打印醒目警告
function checkAgainstCanonical(reportKey, t) {
  if (!existsSync(CANONICAL)) return;
  var text = readFileSync(CANONICAL, 'utf-8');
  var re = new RegExp('\\|\\s*' + reportKey + '\\s*\\|\\s*([0-9a-f]+)\\s*\\|\\s*([0-9a-f]+)\\s*\\|\\s*([a-z]+)\\s*\\|\\s*([0-9a-f]+)\\s*\\|\\s*([0-9a-f]+|n/a)\\s*\\|');
  var m = text.match(re);
  if (!m) {
    console.warn('[provenance] ' + reportKey + ' 未在 canonical-numbers.md 登记（P0-1 权威运行后登记）');
    return;
  }
  var cur = [t.fixture, t.queries, t.split, t.config, t.judge].join('|');
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
export function withProvenanceHeader(reportKey, text, judgePromptText) {
  var t = computeTuple(judgePromptText);
  checkAgainstCanonical(reportKey, t);
  return (
    '<!-- version: report=' + reportKey +
    ' fixture=' + t.fixture +
    ' queries=' + t.queries +
    ' split=' + t.split +
    ' config=' + t.config +
    ' judge=' + t.judge +
    ' -->\n' + text
  );
}
