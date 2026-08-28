// orb（方案 B 悬浮球）源码级断言：
//  - 标准 FAB 约定：ne_orb_pos_v2 持久化、无贴边磁吸(SNAP_ZONE/--ne-orb-shift)、window 级拖拽、无 setPointerCapture
//  - 方案 B 结构：三卫星节点(ne-node-state/stm/ltm) + 枢纽
//  - 可见性硬约束：挂载当下自注入 #ne_vars_style + #ne_orb_style
//  - 纪律：orb.js 零颜色字面量；面板层翻译经 panel-shared 的 t
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname, '..');

var test = { passed: 0, failed: 0 };

function assert(condition, msg) {
    if (condition) {
        test.passed++;
    } else {
        test.failed++;
        console.error('  FAIL: ' + msg);
    }
}

function read(rel) {
    return readFileSync(path.join(ROOT, rel), 'utf8');
}

var orbJs = read('src/adapter/orb.js');
var orbCss = read('src/ui/orb.css');
var bootstrapJs = read('src/adapter/bootstrap.js');
var sharedJs = read('src/adapter/panel-shared.js');
var i18nJs = read('src/core/i18n.js');

console.log('\n=== orb: 标准 FAB 约定 ===');

// 1. 位置持久化键
assert(orbJs.indexOf("'ne_orb_pos_v2'") !== -1, 'orb.js 使用 ne_orb_pos_v2 位置键');
assert(orbJs.indexOf('typeof p.x === \'number\'') !== -1, 'loadPos 仅采数值 x/y（忽略旧 dock 字段）');

// 2. 无贴边磁吸 / 半隐
assert(orbJs.indexOf('SNAP_ZONE') === -1, 'orb.js 不含 SNAP_ZONE（无贴边磁吸）');
assert(orbCss.indexOf('--ne-orb-shift') === -1, 'orb.css 不含 --ne-orb-shift（无贴边半隐）');
assert(orbJs.indexOf('setPointerCapture') === -1, 'orb.js 不用 setPointerCapture（window 级拖拽更稳）');

// 3. window 级拖拽
assert(orbJs.indexOf('window.addEventListener(\'pointermove\'') !== -1, 'orb.js 挂 window pointermove');
assert(orbJs.indexOf('window.addEventListener(\'pointerup\'') !== -1, 'orb.js 挂 window pointerup');

console.log('\n=== orb: 方案 B 结构 ===');

// 4. 三卫星管线节点
assert(orbJs.indexOf('ne-node-state') !== -1, 'orb.js 含 ne-node-state 节点');
assert(orbJs.indexOf('ne-node-stm') !== -1, 'orb.js 含 ne-node-stm 节点');
assert(orbJs.indexOf('ne-node-ltm') !== -1, 'orb.js 含 ne-node-ltm 节点');

// 5. orb.css 对应卫星样式存在
assert(orbCss.indexOf('.ne-node-state') !== -1, 'orb.css 含 .ne-node-state');
assert(orbCss.indexOf('.ne-node-stm') !== -1, 'orb.css 含 .ne-node-stm');
assert(orbCss.indexOf('.ne-node-ltm') !== -1, 'orb.css 含 .ne-node-ltm');

console.log('\n=== orb: 可见性硬约束（上次失败根因回归） ===');

// 6. 挂载当下自注入令牌 + CSS
assert(orbJs.indexOf("'ne_vars_style'") !== -1, 'orb.js 注入守卫含 ne_vars_style（tokens 自给）');
assert(orbJs.indexOf("'ne_orb_style'") !== -1, 'orb.js 注入守卫含 ne_orb_style（orb css 自给）');
assert(sharedJs.indexOf("'ne_vars_style'") !== -1, 'panel-shared 亦注入 ne_vars_style（一致性契约）');

// 7. bootstrap 早期挂载：在 loadVault 之前的同步区调用
assert(bootstrapJs.indexOf("mountNeOrb(function") !== -1, 'bootstrap.js 调用 mountNeOrb');
assert(bootstrapJs.indexOf("mountNeOrb(function") < bootstrapJs.indexOf('var vault = await loadVault('), 'mountNeOrb 早于 loadVault（早期解耦，不依赖面板）');

console.log('\n=== orb: 纪律 ===');

// 8. orb.js 零颜色字面量（ratchet-color-literals 门禁延伸断言）
var colors = orbJs.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
assert(!colors || colors.length === 0, 'orb.js 无颜色字面量' + (colors ? '（发现: ' + colors.join(',') + '）' : ''));

// 9. 面板层翻译经 panel-shared 的 t，而非直接 core/i18n
assert(orbJs.indexOf("from './panel-shared.js'") !== -1 && orbJs.indexOf('t(') !== -1, 'orb.js 引用 panel-shared');
assert(orbJs.indexOf("import { t_narrative } from '../core/i18n.js'") === -1, 'orb.js 不直接 import core/i18n 的 t_narrative');

// 10. orb.css 全令牌（抽查关键槽），无裸颜色
assert(orbCss.indexOf('var(--ne-surface-2)') !== -1, 'orb.css 背景用 --ne-surface-2');
assert(orbCss.indexOf('var(--ne-accent)') !== -1, 'orb.css 脉冲用 --ne-accent');
assert(orbCss.indexOf('var(--ne-success)') !== -1, 'orb.css flash 用 --ne-success');
assert(orbCss.indexOf('var(--ne-ink)') !== -1, 'orb.css 文本用 --ne-ink');

// 11. i18n orb_* 键已补齐三语言
assert(i18nJs.indexOf("'orb_title'") !== -1, 'i18n 含 orb_title');
assert(i18nJs.indexOf("'orb_phase_state'") !== -1, 'i18n 含 orb_phase_state');
assert(i18nJs.indexOf("'orb_phase_stm'") !== -1, 'i18n 含 orb_phase_stm');
assert(i18nJs.indexOf("'orb_phase_ltm'") !== -1, 'i18n 含 orb_phase_ltm');
assert(i18nJs.indexOf("'orb_idle'") !== -1, 'i18n 含 orb_idle');
assert(i18nJs.indexOf("'orb_busy'") !== -1, 'i18n 含 orb_busy');
assert(i18nJs.indexOf("'orb_tooltip_hint'") !== -1, 'i18n 含 orb_tooltip_hint');

console.log('\n=== orb: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);