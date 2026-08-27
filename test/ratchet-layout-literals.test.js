// 布局字面量棘轮（V2）：禁止 UI 层新增 padding/margin/gap/border-radius 的 px 字面量
// 渐进迁移：count <= BASELINE，只许降不许升；随"圆角语义均分 + 间距就近归并"批次逐步下调
// 与 color-literals 不同：本棘轮**包含** src/ui/panel.css —— 间距/圆角替换主战场就是它
// 归并策略：
//   radius(语义均分): 2/3/4→sm(4), 6/8/10→md(8), 12/15→lg(12)；50%/0/inherit 保留
//   space(就近归并):  2/3/4/5→xs(4), 6/8→sm(8), 10/12→md(12), 14/16→lg(16),
//                     18/20→xl(20), 24→2xl(24), 28/32→3xl(32)；60px 移动端底部避让异常值保留
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname, '..');
var ADAPTER_DIR = path.resolve(ROOT, 'src/adapter');

// 迁移期基线（V2 批次3后：radius 语义均分 + space 就近归并完成，剩 border 内衬 1px/移动避让 60px/safe-area 0px = 19）
// 均为刻意保留的异常窄档，只许降不许升
var BASELINE = 19;

// 匹配布局属性声明中含 px 字面量（属性：padding/margin 全变体/gap/(row|column)-gap/border-radius）
var LAYOUT_RE = /((?:padding|margin)[-\w]*|gap|border-radius[-\w]*)\s*:\s*[^;}]*?\d+px/gi;

var total = 0;
var perFile = {};

function scanFile(filePath, displayName) {
    var content = readFileSync(filePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    var count = (content.match(LAYOUT_RE) || []).length;
    perFile[displayName] = count;
    total += count;
}

scanFile(path.resolve(ROOT, 'src/ui/panel.css'), 'panel.css');
readdirSync(ADAPTER_DIR).filter(function (f) { return f.endsWith('.js'); })
    .forEach(function (f) { scanFile(path.join(ADAPTER_DIR, f), f); });

function assert(cond, msg) {
    if (cond) { test.passed++; } else { test.failed++; console.error('  FAIL: ' + msg); }
}
var test = { passed: 0, failed: 0 };

console.log('\n=== ratchet-layout-literals: 布局字面量门禁 ===');
console.log('  基线=' + BASELINE + ' 当前=' + total);
Object.keys(perFile).forEach(function (k) { if (perFile[k] > 0) console.log('  ' + k + ': ' + perFile[k]); });

assert(total <= BASELINE, '布局字面量 ' + total + ' 超过迁移期基线 ' + BASELINE + '（禁止新增，应先收敛）');

var tokensCss = readFileSync(path.resolve(ROOT, 'src/ui/tokens.css'), 'utf8');
assert(tokensCss.indexOf('--ne-space-') !== -1 && tokensCss.indexOf('--ne-radius-') !== -1, 'tokens.css 仍含 --ne-space-* 与 --ne-radius-*');

console.log('\n=== ratchet-layout-literals: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);