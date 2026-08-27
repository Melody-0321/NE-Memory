// 字号字面量棘轮（V2）：禁止 UI 层新增硬编码 font-size 字面量（em/px）
// 渐进迁移：count <= BASELINE，只许降不许升；随分批替换逐步降低 BASELINE
// 与 color-literals 不同：本棘轮**包含** src/ui/panel.css ——
//   颜色已在 B2 收敛到 panel.css 静态真源（JS 扫描豁免即可），
//   但字号的替换主战场恰好是 panel.css 自身（155+ 处字面量 → --ne-text-*），
//   故需同时盯住 panel.css 与 adapter JS 内联串，防止迁移过程中新增/回潮。
// 替换目标：font-size:0.83em 等 → font-size:var(--ne-text-sm)（引用不计入）
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname, '..');
var ADAPTER_DIR = path.resolve(ROOT, 'src/adapter');

// 迁移期基线（V2 门禁落地实测：panel.css + adapter JS 内联 = 280）
// 均为合法存量待收敛项；随批次替换下调此值，只许降不许升
var BASELINE = 280;

var FSIZE_RE = /font-size:\s*(?!var\()[\d.]+(?:em|px|rem)/i;

var test = { passed: 0, failed: 0 };
var total = 0;
var perFile = {};

function scanFile(filePath, displayName) {
    var lines = readFileSync(filePath, 'utf8').split('\n');
    var count = 0;
    lines.forEach(function (line) {
        var code = stripComments(line);
        if (FSIZE_RE.test(code)) count++;
    });
    perFile[displayName] = count;
    total += count;
}

// panel.css（静态真源） + adapter/*.js（内联 style 串）
scanFile(path.resolve(ROOT, 'src/ui/panel.css'), 'panel.css');
readdirSync(ADAPTER_DIR).filter(function (f) { return f.endsWith('.js'); })
    .forEach(function (f) {
        scanFile(path.join(ADAPTER_DIR, f), f);
    });

function assert(cond, msg) {
    if (cond) { test.passed++; } else { test.failed++; console.error('  FAIL: ' + msg); }
}

console.log('\n=== ratchet-font-size-literals: 字号字面量门禁 ===');
console.log('  基线=' + BASELINE + ' 当前=' + total);
Object.keys(perFile).forEach(function (k) {
    if (perFile[k] > 0) console.log('  ' + k + ': ' + perFile[k]);
});

assert(total <= BASELINE, '字号字面量 ' + total + ' 超过迁移期基线 ' + BASELINE + '（禁止新增，应先收敛再改）');

// tokens.css 单点真源未被误删：必须仍定义字号档位
var tokensCss = readFileSync(path.resolve(ROOT, 'src/ui/tokens.css'), 'utf8');
assert(tokensCss.indexOf('--ne-text-sm:') !== -1, 'tokens.css 仍含 --ne-text-sm');

console.log('\n=== ratchet-font-size-literals: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);

function stripComments(line) {
    line = line.replace(/\/\*[\s\S]*?\*\//g, '');
    line = line.replace(/\/\/.*$/, '');
    return line;
}