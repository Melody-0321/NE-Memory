// orb 悬浮球源码级断言：样式令牌纪律 + 交互骨架 + 状态接线 + 设置开关
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

var orbCss = read('src/ui/orb.css');
var orbJs = read('src/adapter/orb.js');
var initJs = read('src/adapter/panel-init.js');
var settingsJs = read('src/adapter/panel-settings.js');
var panelCss = read('src/ui/panel.css');

console.log('\n=== orb: 样式（orb.css 令牌纪律） ===');

// 1. 二态脉冲核心：busy 态 accent + 脉冲环动画
assert(orbCss.indexOf('.ne-orb.busy') !== -1, '含 .ne-orb.busy 态');
assert(orbCss.indexOf('ne-orb-pulse') !== -1, '含 ne-orb-pulse 脉冲动画');
assert(orbCss.indexOf('var(--ne-accent)') !== -1, 'busy 态引用 --ne-accent 令牌');
assert(orbCss.indexOf('animation:none') !== -1, 'reduced-motion 下动画降级');

// 2. 门禁协调：border-radius 用百分比（不触 layout-literals），无 999px
assert(orbCss.indexOf('border-radius:50%') !== -1, 'border-radius 用 50%');
assert(orbCss.indexOf('999px') === -1, '无 999px 圆角字面量');

// 3. 颜色令牌纪律：无 hex/rgb 颜色字面量
assert(!/#[0-9a-fA-F]{3,8}\b/.test(orbCss), 'orb.css 无 hex 颜色字面量');
assert(orbCss.indexOf('rgb(') === -1, 'orb.css 无 rgb() 颜色字面量');

// 4. z-index 协调：orb(9997) 低于 tooltip/toast(9999) 与 help-card(9998)
assert(orbCss.indexOf('z-index:9997') !== -1, 'orb z-index=9997');
assert(panelCss.indexOf('z-index:9999') !== -1, 'panel.css 浮层 z-index=9999 高于 orb');

// 5. 交互态完备：hover/focus-visible/dragging、贴边半隐变量
assert(orbCss.indexOf('.ne-orb:hover') !== -1, 'hover 全显');
assert(orbCss.indexOf('.ne-orb:focus-visible') !== -1, 'focus-visible 键盘可达');
assert(orbCss.indexOf('.ne-orb.is-dragging') !== -1, '拖拽态');
assert(orbCss.indexOf('--ne-orb-shift') !== -1, '贴边半隐 CSS 变量');

// 6. reduced-motion 支持
assert(orbCss.indexOf('prefers-reduced-motion') !== -1, 'prefers-reduced-motion 降级块');

console.log('\n=== orb: 交互骨架（orb.js，参照柏宝书 FloatingOrb） ===');

// 7. 核心常量
assert(orbJs.indexOf('SNAP_ZONE = 56') !== -1, 'SNAP_ZONE=56 边缘吸附');
assert(orbJs.indexOf('CLICK_SLOP = 6') !== -1, 'CLICK_SLOP=6 点击判定');
assert(orbJs.indexOf("'ne_orb_pos'") !== -1, 'POS_KEY 本机位置持久化');

// 8. 拖拽与吸附实现
assert(orbJs.indexOf('pointerdown') !== -1, 'pointerdown 拖拽');
assert(orbJs.indexOf('setPointerCapture') !== -1, 'setPointerCapture');
assert(orbCss.indexOf('touch-action:none') !== -1, 'orb.css touch-action:none（拖拽不滚屏）');

// 9. 位置持久化：localStorage 读写 + clamp
assert(orbJs.indexOf("localStorage.getItem(POS_KEY)") !== -1, 'loadPos 读 localStorage');
assert(orbJs.indexOf("localStorage.setItem(POS_KEY") !== -1, 'savePos 写 localStorage');
assert(orbJs.indexOf('clampToViewport') !== -1, '视口夹取');

// 10. 点击 toggle 抽屉（双分支）
assert(orbJs.indexOf("createVaultPopout(_getChatId)") !== -1, '点击打开面板分支');
assert(orbJs.indexOf('closeVaultOverlay()') !== -1, '点击关闭面板分支');
assert(orbJs.indexOf("classList.contains('open')") !== -1, 'open 状态判定');

// 11. 键盘可达
assert(orbJs.indexOf("e.key === 'Enter'") !== -1, 'Enter/Space 键盘触发');

// 12. 双跑守卫
assert(orbJs.indexOf("byId('ne_orb')") !== -1, 'byId 双跑守卫');

console.log('\n=== orb: 状态接线（二态脉冲，真源 pipeline-guard） ===');

// 13. 订阅管线状态
assert(orbJs.indexOf('onPipelineChange') !== -1, 'onPipelineChange 订阅');
assert(orbJs.indexOf("classList.toggle('busy'") !== -1, 'busy 二态切换');

// 14. 挂载即同步当前快照（订阅只推增量）
assert(orbJs.indexOf('getPipelinePhase') !== -1, 'getPipelinePhase 快照');

// 15. 开关读取（ne_settings.orb_enabled 默认开）
assert(orbJs.indexOf('orb_enabled === false') !== -1, '默认开启（仅 false 关）');
assert(orbJs.indexOf('applyOrbVisibility') !== -1, 'applyOrbVisibility 即时挂载/卸载');

// 16. SVG currentColor（无颜色字面量）
assert(orbJs.indexOf('currentColor') !== -1, 'SVG 用 currentColor');
assert(!/fill="#|stroke="#/.test(orbJs), 'SVG 无 hex 颜色字面量');

console.log('\n=== orb: 接线 ===');

// 17. panel-init.js 挂载调用
assert(initJs.indexOf("import { mountNeOrb } from './orb.js'") !== -1, 'panel-init import mountNeOrb');
assert(initJs.indexOf('mountNeOrb(getChatId)') !== -1, 'panel-init 调用 mountNeOrb');

// 18. 设置面板开关 + 持久化
assert(settingsJs.indexOf('nes_orb_enabled') !== -1, '设置面板含 nes_orb_enabled 开关');
assert(settingsJs.indexOf('s.orb_enabled = orbChk.checked') !== -1, 'onchange 写 ne_settings.orb_enabled');
assert(settingsJs.indexOf('applyOrbVisibility()') !== -1, 'onchange 即时生效');
assert(settingsJs.indexOf("applyOrbVisibility } from './orb.js'") !== -1, 'settings import applyOrbVisibility');

console.log('\n=== orb: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);
