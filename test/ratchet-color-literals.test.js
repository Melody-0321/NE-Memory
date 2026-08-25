// 颜色字面量棘轮：禁止 UI 层新增硬编码颜色（#hex / rgb( / rgba(）
// 迁移期（B0-B2）：count <= BASELINE，只许降不许升
// B2 完成后翻硬为 0（见计划 P0-UI-token化实施计划 Q6）
// tokens.css 是唯一合法颜色真源（本扫描范围不含 src/ui/，天然豁免）
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ADAPTER_DIR = path.resolve(__dirname, '../src/adapter');

// 迁移期基线（B0 后剥离注释实测 134；B2 面板 CSS 迁移 + token 化后实测 50）
// B3 内联颜色→class 迁移完成后实测 34，剩余均为合法存量保留：
//   - events.js 2：状态 banner 棕色系（无等价 --ne-* token，品牌存量）
//   - panel-shared.js 18：var(--x,fallback) 回退值 + 前景 on-color（#fff/#333/#c62828）+ tooltip/guide 辅助 rgba
//   - panel-usage.js 6：Chart.js 色板（图表数据配置，非样式内联）
//   - panel-settings.js 2：var(--yellow40,#e6a817) 回退值
//   - panel-templates.js 2：border-left var(--ne-warn,#e0a800)/var(--ne-danger,#c04444) 回退值
//   - panel-state-cards.js 4：&#9654; HTML 实体误报 + #555 徽章边框（无等价 class）+ #8b949e 回退值 + #999 描述色（无等价 class）
var BASELINE = 34;

var COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
var files = readdirSync(ADAPTER_DIR).filter(function (f) { return f.endsWith('.js'); });

var total = 0;
var perFile = {};

files.forEach(function (f) {
    var lines = readFileSync(path.join(ADAPTER_DIR, f), 'utf8').split('\n');
    var count = 0;
    lines.forEach(function (line) {
        var code = stripComments(line);
        if (COLOR_RE.test(code)) count++;
    });
    perFile[f] = count;
    total += count;
});

var test = { passed: 0, failed: 0 };

function assert(cond, msg) {
    if (cond) { test.passed++; } else { test.failed++; console.error('  FAIL: ' + msg); }
}

console.log('\n=== ratchet-color-literals: 颜色字面量门禁 ===');
console.log('  基线=' + BASELINE + ' 当前=' + total);
Object.keys(perFile).forEach(function (k) {
    if (perFile[k] > 0) console.log('  ' + k + ': ' + perFile[k]);
});

assert(total <= BASELINE, '颜色字面量 ' + total + ' 超过迁移期基线 ' + BASELINE);

// tokens.css 单点真源未被误删：必须仍定义状态色
var tokensCss = readFileSync(path.resolve(__dirname, '../src/ui/tokens.css'), 'utf8');
assert(tokensCss.indexOf('--ne-success:') !== -1, 'tokens.css 仍含 --ne-success');

console.log('\n=== ratchet-color-literals: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);

function stripComments(line) {
    // 去掉 // 行注释与 /* */ 块注释（粗略，足够门禁用）
    line = line.replace(/\/\*[\s\S]*?\*\//g, '');
    line = line.replace(/\/\/.*$/, '');
    return line;
}
