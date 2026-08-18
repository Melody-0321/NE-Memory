// judge-injection-arm.js — L1 读者批跑器（独立入口；主流程已内置在 run-injection-arms.js --judge）
// 场景：分臂跑（如校准臂先行 floor/oracle，待比臂后跑）或对已渲染文档补跑读者。
// 输入：output/injection-eval/docs/{arm}/{anchorId}.json（run-injection-arms.js --render-only 产物）
// 输出：output/injection-eval/{arm}/{anchorId}-f{factIdx}.json
// 用法：node judge-injection-arm.js [--arms floor,oracle] [--dry]

import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { qaAnchors } from './injection-qa-anchors.js';
import { askReader } from './judge-injection-arm-lib.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var DRY = process.argv.includes('--dry');
var armsArg = process.argv.indexOf('--arms') !== -1 ? process.argv[process.argv.indexOf('--arms') + 1] : 'floor,oracle,baseline,hl';
var ARMS = armsArg.split(',').map(function (a) { return a.trim(); });

var OUT_BASE = join(__dirname, 'output', 'injection-eval');
var DOCS_DIR = join(OUT_BASE, 'docs');

async function main() {
    var anchorById = {};
    qaAnchors.forEach(function (a) { anchorById[a.id] = a; });
    var totalCalls = 0;

    console.log('=== judge-injection-arm arms=' + ARMS.join(',') + (DRY ? ' (DRY)' : ''));

    for (var ai = 0; ai < ARMS.length; ai++) {
        var arm = ARMS[ai];
        var docsDir = join(DOCS_DIR, arm);
        if (!existsSync(docsDir)) { console.warn('  [skip] ' + arm + ' 无预渲染文档（先跑 run-injection-arms.js --render-only）'); continue; }
        var files = readdirSync(docsDir).filter(function (f) { return f.endsWith('.json'); });
        var outDir = join(OUT_BASE, arm);
        mkdirSync(outDir, { recursive: true });

        for (var fi = 0; fi < files.length; fi++) {
            var doc = JSON.parse(readFileSync(join(docsDir, files[fi]), 'utf-8'));
            var anchor = anchorById[doc.anchorId];
            if (!anchor) continue;

            for (var xi = 0; xi < anchor.facts.length; xi++) {
                var fact = anchor.facts[xi];
                var outPath = join(outDir, anchor.id + '-f' + xi + '.json');
                if (existsSync(outPath) && !DRY) continue; // 幂等：已答过跳过

                if (DRY) { console.log('  [dry][' + arm + '][' + anchor.id + '-f' + xi + '] ' + fact.q); continue; }
                process.stdout.write('  [' + arm + '][' + anchor.id + '-f' + xi + '] ... ');
                var res;
                try { res = await askReader(doc.text, fact.q); }
                catch (e) { res = { parseOk: false, answer: 'ERR:' + (e && e.message), found: false, raw: '' }; }
                totalCalls++;
                writeFileSync(outPath, JSON.stringify({
                    arm: arm, anchorId: anchor.id, factIdx: xi, tier: anchor.type,
                    question: fact.q, answer: res.answer, found: res.found, parseOk: res.parseOk, raw: res.raw,
                }, null, 2), 'utf-8');
                console.log((res.parseOk ? (res.found ? 'found' : 'notfound') : 'PARSE_FAIL') + ' | ' + String(res.answer).slice(0, 40));
            }
        }
    }
    if (!DRY) {
        console.log('共 ' + totalCalls + ' 次读者调用完成');
        console.log('提示：跑 node run-injection-arms.js --aggregate-only 重算 aggregate');
    }
}

main().catch(function (err) { console.error('\nFATAL:', err && err.stack || err); process.exit(1); });