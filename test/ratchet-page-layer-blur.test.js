// 页层遮罩棘轮：防止 .ne-page-layer 的不透明遮罩方案被再次 revert
// 历史：P1 曾修复子面板与主面板重合显示（dcf9dab：本体 transparent + ::before blur 遮罩）。
// 但骨架屏提交 67aaadc 为给骨架屏不透明底，把这行改回 background:var(--ne-surface-1)
// （30% 半透明），导致子面板打开时主面板透出、两者重合 —— 问题回归未被发现。
// 本棘轮断言关键修复特征必须存在，任何还原（改回 surface-1 / 删 ::before）都会失败。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

var panelCss = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/ui/panel.css'), 'utf8');

var test = { passed: 0, failed: 0 };
function assert(cond, msg) {
    if (cond) { test.passed++; } else { test.failed++; console.error('  FAIL: ' + msg); }
}

console.log('\n=== ratchet-page-layer-blur: 页层遮罩防回归 ===');
// 1) .ne-page-layer 本体必须 transparent（透明，由 ::before 供血），不得回退 surface-1
assert(/\.ne-page-layer\{[^}]*background:transparent/.test(panelCss), '.ne-page-layer 本体必须 background:transparent');
assert(/\.ne-page-layer\{[^}]*isolation:isolate/.test(panelCss), '.ne-page-layer 必须 isolation:isolate (让 ::before z-index:-1 生效)');
// 2) ::before 遮罩块必须存在，含不透明底 + 毛玻璃
assert(/\.ne-page-layer::before/.test(panelCss), '.ne-page-layer::before 遮罩块必须存在');
assert(/\.ne-page-layer::before\{[^}]*backdrop-filter[^}]*\}/.test(panelCss), '::before 必须含 backdrop-filter 毛玻璃');

console.log('\n=== ratchet-page-layer-blur: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);