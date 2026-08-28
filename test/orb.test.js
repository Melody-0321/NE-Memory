// orb 悬浮球源码级断言：方案B枢纽图标 + 三档状态 + rich tooltip + 菜单迁移
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
var drawerJs = read('src/adapter/panel-drawer.js');
var settingsJs = read('src/adapter/panel-settings.js');
var i18nJs = read('src/core/i18n.js');
var panelCss = read('src/ui/panel.css');

console.log('\n=== orb: 样式令牌纪律（orb.css） ===');

// 1. 运行中三档脉冲：busy 态 + accent + 外圈脉冲环 + 强度递增
assert(orbCss.indexOf('.ne-orb.busy') !== -1, '含 .ne-orb.busy 运行态');
assert(orbCss.indexOf('ne-orb-pulse') !== -1, '含 ne-orb-pulse 脉冲动画');
assert(orbCss.indexOf('var(--ne-accent)') !== -1, 'busy 态引用 --ne-accent 令牌');
assert(orbCss.indexOf('[data-active="2"]') !== -1, 'data-active=2 增强档');
assert(orbCss.indexOf('[data-active="3"]') !== -1, 'data-active=3 最强档');
assert(orbCss.indexOf('animation:none') !== -1, 'reduced-motion 下动画降级');
assert(orbCss.indexOf('.ne-orb.flash') !== -1, '含 .flash 完成态');

// 2. 门禁协调：border-radius 用百分比（不触 layout-literals），无 999px
assert(orbCss.indexOf('border-radius:50%') !== -1, 'border-radius 用 50%');
assert(orbCss.indexOf('999px') === -1, '无 999px 圆角字面量');

// 3. 颜色令牌纪律：无 hex/rgb 颜色字面量
assert(!/#[0-9a-fA-F]{3,8}\b/.test(orbCss), 'orb.css 无 hex 颜色字面量');
assert(orbCss.indexOf('rgb(') === -1, 'orb.css 无 rgb() 颜色字面量');

// 4. z-index 协调：orb(9997) 低于 tooltip/toast(9999)
assert(orbCss.indexOf('z-index:9997') !== -1, 'orb z-index=9997');
assert(orbCss.indexOf('.ne-orb-tip') !== -1, '含 rich tooltip 样式');
assert(orbCss.indexOf('z-index:9999') !== -1, 'tooltip z-index=9999 高于 orb');
assert(panelCss.indexOf('z-index:9999') !== -1, 'panel.css 浮层 z-index=9999 高于 orb');

// 5. 交互态完备：hover/focus-visible/dragging、贴边半隐、拖拽不滚屏
assert(orbCss.indexOf('.ne-orb:hover') !== -1, 'hover 全显');
assert(orbCss.indexOf('.ne-orb:focus-visible') !== -1, 'focus-visible 键盘可达');
assert(orbCss.indexOf('.ne-orb.is-dragging') !== -1, '拖拽态');
assert(orbCss.indexOf('--ne-orb-shift') !== -1, '贴边半隐 CSS 变量');

// 5b. 门面可发现性：idle 不暗淡、贴边不外移过多（球体大体露出）
assert(orbCss.indexOf('opacity:.92') !== -1, 'idle 高可发现(≥.9)');
assert(orbCss.indexOf('touch-action:none') !== -1, 'touch-action:none（拖拽不滚屏）');

// 6. 方案B 枢纽图标结构：中心 hub + 三卫星 node（兼状态灯）+ 轨道连线
assert(orbCss.indexOf('.ne-hub') !== -1, '中心枢纽 ne-hub');
assert(orbCss.indexOf('.ne-node-state') !== -1, 'state 卫星节点');
assert(orbCss.indexOf('.ne-node-stm') !== -1, 'stm 卫星节点');
assert(orbCss.indexOf('.ne-node-ltm') !== -1, 'ltm 卫星节点');
assert(orbCss.indexOf('.ne-node.lit') !== -1, '卫星点亮状态 .lit');
assert(orbCss.indexOf('var(--ne-accent)') !== -1, '点亮节点引用 --ne-accent');

// 7. reduced-motion 支持
assert(orbCss.indexOf('prefers-reduced-motion') !== -1, 'prefers-reduced-motion 降级块');

console.log('\n=== orb: 交互骨架（orb.js，参照柏宝书 FloatingOrb） ===');

// 8. 核心常量
assert(orbJs.indexOf('SNAP_ZONE = 56') !== -1, 'SNAP_ZONE=56 边缘吸附');
assert(orbJs.indexOf('CLICK_SLOP = 6') !== -1, 'CLICK_SLOP=6 点击判定');
assert(orbJs.indexOf("'ne_orb_pos'") !== -1, 'POS_KEY 本机位置持久化');

// 9. 拖拽与吸附实现
assert(orbJs.indexOf('pointerdown') !== -1, 'pointerdown 拖拽');
assert(orbJs.indexOf('setPointerCapture') !== -1, 'setPointerCapture');

// 10. 位置持久化：localStorage 读写 + clamp
assert(orbJs.indexOf("localStorage.getItem(POS_KEY)") !== -1, 'loadPos 读 localStorage');
assert(orbJs.indexOf("localStorage.setItem(POS_KEY") !== -1, 'savePos 写 localStorage');
assert(orbJs.indexOf('clampToViewport') !== -1, '视口夹取');

// 11. 点击 toggle 抽屉（双分支）
assert(orbJs.indexOf('createVaultPopout(_getChatId)') !== -1, '点击打开面板分支');
assert(orbJs.indexOf('closeVaultOverlay()') !== -1, '点击关闭面板分支');
assert(orbJs.indexOf("classList.contains('open')") !== -1, 'open 状态判定');

// 12. 键盘可达
assert(orbJs.indexOf("e.key === 'Enter'") !== -1, 'Enter/Space 键盘触发');

// 13. 双跑守卫
assert(orbJs.indexOf("byId('ne_orb')") !== -1, 'byId 双跑守卫');

console.log('\n=== orb: 三档状态 + 状态灯接线（真源 pipeline-guard） ===');

// 14. 订阅管线状态
assert(orbJs.indexOf('onPipelineChange') !== -1, 'onPipelineChange 订阅');
assert(orbJs.indexOf("classList.toggle('busy'") !== -1, 'busy 二态切换');

// 15. 三档强度：data-active 随活跃管线数写入（0/1/2/3）
assert(orbJs.indexOf("setAttribute('data-active'") !== -1, '写入 data-active 强度档');
assert(orbJs.indexOf('String(active)') !== -1, '强度 = 活跃管线数');

// 16. 三卫星状态灯：运行中的管线其节点 .lit 点亮
assert(orbJs.indexOf("classList.toggle('lit'") !== -1, '卫星节点 toggle .lit');
assert(orbJs.indexOf('PIPE_NODES') !== -1, '管线→节点映射 PIPE_NODES');
assert(orbJs.indexOf("ne-node-state" ) !== -1, 'state 节点类映射');
assert(orbJs.indexOf('ne-node-stm') !== -1, 'stm 节点类映射');
assert(orbJs.indexOf('ne-node-ltm') !== -1, 'ltm 节点类映射');

// 17. 完成 flash：active→idle 下降沿 → success 色
assert(orbJs.indexOf('maybeFlash') !== -1, '完成 flash 检测函数');
assert(orbJs.indexOf("classList.add('flash')") !== -1, '加 .flash');
assert(orbJs.indexOf('FLASH_MS') !== -1, 'flash 保持时长常量');
assert(orbJs.indexOf('clearTimeout') !== -1, '重置 flash 计时器');

// 18. 挂载即同步当前快照（订阅只推增量）
assert(orbJs.indexOf('renderStatus(el, _lastStatus)') !== -1, '挂载同步当前状态快照');

// 19. 开关读取（ne_settings.orb_enabled 默认开）+ 即时挂载/卸载
assert(orbJs.indexOf('orb_enabled === false') !== -1, '默认开启（仅 false 关）');
assert(orbJs.indexOf('applyOrbVisibility') !== -1, 'applyOrbVisibility 即时挂载/卸载');

console.log('\n=== orb: rich tooltip（三管线状态明细） ===');

// 20. tooltip 构建/定位/状态词
assert(orbJs.indexOf('buildTip') !== -1, 'tooltip 构建');
assert(orbJs.indexOf('positionTip') !== -1, 'tooltip 定位 + clamp');
assert(orbJs.indexOf("'ne_orb_tip'") !== -1, 'tooltip id');
assert(orbJs.indexOf('ne-orb-tip-title') !== -1, 'tooltip 标题行');
assert(orbJs.indexOf('orb_status_running') !== -1, 'tooltip 运行中状态词键');
assert(orbJs.indexOf('orb_status_idle') !== -1, 'tooltip 待机状态词键');
assert(orbJs.indexOf("mouseenter") !== -1, 'hover 触发展示 tooltip');
assert(orbJs.indexOf('getBoundingClientRect') !== -1, '按 orb 位置定位 tooltip');

// 21. i18n 三语言块均含 tooltip 状态词 + 图标语义键
assert((i18nJs.match(/'orb_status_running'/g) || []).length >= 3, 'orb_status_running 三语言块');
assert((i18nJs.match(/'orb_status_idle'/g) || []).length >= 3, 'orb_status_idle 三语言块');
assert((i18nJs.match(/'orb_phase_state'/g) || []).length >= 3, 'orb_phase_state 三语言块');

// 22. 方案B 图标：SVG currentColor，无颜色字面量
assert(orbJs.indexOf('ne-hub') !== -1, 'SVG 含枢纽 ne-hub');
assert(orbJs.indexOf('currentColor') !== -1, 'SVG 用 currentColor');
assert(!/fill="#|stroke="#/.test(orbJs), 'SVG 无 hex 颜色字面量');

console.log('\n=== orb: 接线 + 菜单迁移 ===');

var bootJs = read('src/adapter/bootstrap.js');

// 23. 挂载于初始化（bootstrap 独立挂载，不依赖面板渲染/#sheld）
assert(bootJs.indexOf("import { mountNeOrb } from './orb.js'") !== -1, 'bootstrap import mountNeOrb');
assert(bootJs.indexOf('mountNeOrb(function') !== -1, 'bootstrap 初始化时挂载悬浮球');
assert(initJs.indexOf('mountNeOrb') === -1, 'panel-init 不再门控挂载（解耦）');

// 24. 设置面板开关 + 持久化 + 即时生效
assert(settingsJs.indexOf('nes_orb_enabled') !== -1, '设置面板含 nes_orb_enabled 开关');
assert(settingsJs.indexOf('s.orb_enabled = orbChk.checked') !== -1, 'onchange 写 ne_settings.orb_enabled');
assert(settingsJs.indexOf('applyOrbVisibility()') !== -1, 'onchange 即时生效');
assert(settingsJs.indexOf("applyOrbVisibility } from './orb.js'") !== -1, 'settings import applyOrbVisibility');

// 25. 原底部按钮迁入 #extensionsMenu（轮询注入，参照柏宝书）
assert(drawerJs.indexOf('extensionsMenu') !== -1, 'panel-drawer 引用 #extensionsMenu');
assert(drawerJs.indexOf('ne_menu_button') !== -1, '菜单项 id ne_menu_button');
assert(drawerJs.indexOf('setInterval') !== -1, '轮询注入');
assert(drawerJs.indexOf('list-group-item') !== -1, '菜单项用 ST list-group-item 类');
assert(drawerJs.indexOf('createVaultPopout(getChatId)') !== -1, '菜单项点击打开面板');

console.log('\n=== orb: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);