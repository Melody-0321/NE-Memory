// judge-gt-map.js — 把盲判材料检索部分（R01-R18）的 Top-10 事件文字
// 映射回 stm_id + GT 分数（queries.js groundTruth），供 LLM 重打 0/1/2 对照。
// 零 API：纯本地确定性匹配（拼接格式与 prepare-judge-calibration.js 相同）。
// 用法：node judge-gt-map.js
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { allSTM } from './fixture.js';
import { queries } from './queries.js';

var __dirname = dirname(fileURLToPath(import.meta.url));

// 1. 建 text -> stmId 映射（拼接格式同 prepare-judge-calibration.js L132）
var textById = {};
allSTM.forEach(function (s) {
  var txt = (s.period ? '[' + s.period + '] ' : '') + (s.scene ? s.scene + '：' : '') + (s.event || s.summary || '');
  if (!textById[txt]) textById[txt] = [];
  textById[txt].push(s.id || s.__id);
});

// GT 分数按查询独立取（同 stm 在不同查询下分数可不同）；非该查询 GT 事件 = 0 分
var gtByQuery = {};
queries.forEach(function (q) { gtByQuery[q.id] = q.groundTruth || {}; });

// 2. 解析盲判材料检索部分
var md = readFileSync(join(__dirname, 'output', 'judge-calibration-blinded.md'), 'utf-8');
var retSec = md.slice(md.indexOf('# 二、'));
var blockRe = /### (R\d+)｜(q\d+) · (叙事|目标) · (高|中|低)\n\n\*\*查询\*\*：([^\n]*)\n\n\*\*Top-10 检索事件（Lin α=0.20）\*\*：\n((?:[^\n]*\n?)*?)(?=\n---|\n### |$)/g;

var out = [];
var m;
while ((m = blockRe.exec(retSec)) !== null) {
  var rid = m[1], qid = m[2], band = m[4];
  var topLines = m[6].split('\n').filter(function (l) { return /^\d+\./.test(l); });
  var top10 = [];
  topLines.forEach(function (line) {
    var rank = parseInt(line.match(/^(\d+)\./)[1], 10);
    var txt = line.replace(/^\d+\.\s*/, '').replace(/　→\s*0\/1\/2：___\s*$/, '').trim();
    var ids = textById[txt] || [];
    if (ids.length !== 1) {
      console.warn('[warn] ' + rid + ' #' + rank + ' 匹配 ' + ids.length + ' 个: ' + txt.slice(0, 40));
    }
    var stmId = ids[0] || null;
    var gt = 0;
    if (stmId && gtByQuery[qid][stmId] !== undefined) gt = gtByQuery[qid][stmId];
    top10.push({ rank: rank, stmId: stmId, text: txt, gt: gt });
  });
  out.push({ rid: rid, qId: qid, band: band, top10: top10 });
}

var file = join(__dirname, 'output', 'judge-retrieval-gt.json');
writeFileSync(file, JSON.stringify({ _meta: { created: '2026-08-18', scope: 'retrieval-gt (R01-R18, dev, Lin alpha=0.20 冻结配置)' }, items: out }, null, 2), 'utf-8');
console.log('GT 表: ' + file);
var matched = 0, total = 0, unknown = 0;
out.forEach(function (it) { it.top10.forEach(function (e) { total++; if (e.stmId) matched++; else unknown++; }); });
console.log('条目: ' + out.length + ' 条 / ' + total + ' 事件；匹配 ' + matched + '，未匹配 ' + unknown);
