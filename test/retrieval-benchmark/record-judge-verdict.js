// P0-2 多模型 judge 合奏：记录单模型 verdict
// 用法：node record-judge-verdict.js --model <模型名> --verdicts '<JSON>' | --verdicts-file <路径>
//   --verdicts 形如 {"T1":"存活","T2":"丢失",...}；--verdicts-file 从文件读同一 JSON（避免 shell 引号问题）。
//   重复模型名则覆盖同 pass 旧记录。
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

var __dirname = dirname(fileURLToPath(import.meta.url));
var OUT = join(__dirname, 'output', 'judge-ensemble-results.json');

function arg(name) {
  var i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
}

var model = arg('model');
var verdictsRaw = arg('verdicts');
var verdictsFile = arg('verdicts-file');
if (!model || (!verdictsRaw && !verdictsFile)) {
  console.error('usage: node record-judge-verdict.js --model <name> --verdicts <json> | --verdicts-file <path>');
  process.exit(1);
}
var verdicts = verdictsRaw ? JSON.parse(verdictsRaw) : JSON.parse(readFileSync(verdictsFile, 'utf-8'));

var data = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, 'utf-8'))
  : { _meta: { created: new Date().toISOString().slice(0, 10), scope: 'modality' }, models: [] };

// 同名模型覆盖旧记录（防重复 pass 造成假"多模型"）
var existing = data.models.find(function (m) { return m.model === model; });
if (existing) {
  existing.verdicts = verdicts;
  existing.recordedAt = new Date().toISOString();
  console.log('[ensemble] updated ' + model);
} else {
  data.models.push({ model: model, pass: data.models.length + 1, verdicts: verdicts, recordedAt: new Date().toISOString() });
  console.log('[ensemble] recorded ' + Object.keys(verdicts).length + ' verdicts for ' + model + ' (pass ' + data.models.length + ')');
}

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf-8');
