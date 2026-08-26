// nav-registry 源码级断言：P1 导航注册表与页栈基建接线
// 遵循项目纪律：node 层测试，不引入浏览器/jsdom 链；断言文件结构而非运行时行为。
// nav-registry.js 依赖 panel-shared（模块级访问 window/document + 导入 .css），
// node 无法运行时导入，故采用与 ui-tokens.test.js 相同的源码级断言方式。
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

var navJs = read('src/adapter/nav-registry.js');
var initJs = read('src/adapter/panel-init.js');
var panelCss = read('src/ui/panel.css');

console.log('\n=== nav-registry: API 面 ===');

// 1. 导出函数齐全
['registerNavPage', 'getNavPage', 'getNavPages', 'openNavPage', 'closeNavPage', 'isNavPageOpen'].forEach(function (fn) {
    assert(new RegExp('export function ' + fn + '\\b').test(navJs), 'nav-registry.js 导出 ' + fn);
});

// 2. i18n 纪律：t 从 panel-shared.js 导入，不得从 core/i18n.js 导入 setter
assert(navJs.indexOf("from './panel-shared.js'") !== -1, 'nav-registry.js 依赖 panel-shared.js');
assert(navJs.indexOf("from '../core/i18n.js'") === -1, 'nav-registry.js 不直接导入 core/i18n.js（避免误用 locale setter）');

// 3. 幂等与守卫：openNavPage 同页 no-op、未注册 id 警告
assert(navJs.indexOf('if (_openId === id) return') !== -1, 'openNavPage 同页幂等 no-op');
assert(navJs.indexOf('未注册页') !== -1, 'openNavPage 未注册页有守卫');

console.log('\n=== nav-registry: 抽屉接线 ===');

// 4. 抽屉模板：.ne-drawer-body 包裹层 + .ne-page-layer 占位
assert(initJs.indexOf("'<div class=\"ne-drawer-body\">'") !== -1, 'panel-init.js 模板含 .ne-drawer-body 包裹层');
assert(initJs.indexOf("'<div id=\"ne-page-layer\" class=\"ne-page-layer\"></div>'") !== -1, 'panel-init.js 模板含 .ne-page-layer 占位');

// 5. 页层在 tab bar 之后、scroll-area 同层包裹（drawer-body 覆盖 tab bar + 内容区）
var bodyIdx = initJs.indexOf("'<div class=\"ne-drawer-body\">'");
var tabIdx = initJs.indexOf("'<div class=\"ne-vault-tab-bar\">'");
var layerIdx = initJs.indexOf("'<div id=\"ne-page-layer\"");
assert(bodyIdx !== -1 && tabIdx !== -1 && tabIdx < bodyIdx, 'drawer-body 位于 tab bar 之后（覆盖 tab bar + 内容区）');
assert(layerIdx !== -1 && layerIdx > bodyIdx, 'page-layer 占位位于 drawer-body 内');

console.log('\n=== nav-registry: 页栈样式 ===');

// 6. panel.css 提供页栈规则
['.ne-drawer-body', '.ne-page-layer', '.ne-page-header', '.ne-page-back', '.ne-page-title', '.ne-page-content'].forEach(function (sel) {
    assert(panelCss.indexOf(sel) !== -1, 'panel.css 含 ' + sel + ' 规则');
});

// 7. page-layer 覆盖层语义：absolute + z-index:40（与 slide-panel 平级竞争），open 才显示
assert(panelCss.indexOf('.ne-page-layer{position:absolute;inset:0;z-index:40;') !== -1, '.ne-page-layer 为 absolute 覆盖层且 z-index:40');
assert(panelCss.indexOf('.ne-page-layer.open{display:flex;opacity:1;}') !== -1, '.ne-page-layer.open 才显示');

// 8. 颜色纪律：页栈规则引用 --ne-* token，不新增颜色字面量
var p1Start = panelCss.indexOf('P1 导航页栈');
var p1End = panelCss.indexOf('Template library');
var pageSection = panelCss.slice(p1Start, p1End === -1 ? undefined : p1End);
assert(pageSection.indexOf('var(--ne-') !== -1, '页栈规则引用 --ne-* token');
assert(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(pageSection) === false, '页栈规则不含颜色字面量');

console.log('\n=== nav-registry: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);
