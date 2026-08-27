// ui-tokens 源码级断言：tokens.css 单点真源 + 注入管道 + all:initial 切断继承
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

var tokensCss = read('src/ui/tokens.css');
var sharedJs = read('src/adapter/panel-shared.js');
var panelCss = read('src/ui/panel.css');

console.log('\n=== ui-tokens: 单点真源 ===');

// 1. tokens.css 存在且含核心语义槽
assert(tokensCss.indexOf('--ne-ink:') !== -1, 'tokens.css 含 --ne-ink');
assert(tokensCss.indexOf('--ne-scroll-thumb:') !== -1, 'tokens.css 含 --ne-scroll-thumb');

// 2. 滚动条修复：不再使用白色半透明 thumb（亮色主题不可见 bug）
var thumbLine = tokensCss.split('\n').find(function (l) { return l.indexOf('--ne-scroll-thumb:') !== -1 && l.indexOf('hover') === -1; });
assert(thumbLine && thumbLine.indexOf('rgba(255,255,255') === -1, '--ne-scroll-thumb 值不含白色半透明');

// 3. 注入管道：panel-shared.js import tokens.css
assert(sharedJs.indexOf("from '../ui/tokens.css'") !== -1, 'panel-shared.js 引用 tokens.css');

// 4. 单点真源：panel-shared.js 不再重复定义 --ne-success
assert(sharedJs.indexOf('--ne-success:') === -1, 'panel-shared.js 不再重复定义 --ne-success（唯一真源在 tokens.css）');

// 5. all:initial 切断继承：出现在 host 外壳规则且先于 display:none
var allIdx = sharedJs.indexOf('all:initial;');
var dispIdx = sharedJs.indexOf('display:none;flex-direction:column;');
assert(allIdx !== -1, 'panel-shared.js 含 all:initial');
assert(dispIdx !== -1, 'panel-shared.js 含 host 外壳 display:none');
assert(allIdx !== -1 && dispIdx !== -1 && allIdx < dispIdx, 'all:initial 位于外壳规则 display:none 之前');

// 6. 双路径选择器：all:initial 出现于 :host（shadow）与 .ne-vault-bottom-overlay（非 shadow）两条路径
assert(sharedJs.indexOf("':host'") !== -1, '含 :host 双路径分支');
assert(sharedJs.indexOf("'.ne-vault-bottom-overlay'") !== -1, '含 .ne-vault-bottom-overlay 降级路径');

// 7. B1：输入控件白底 hack 已根除（tokens.css :root 单点供血，随 ST 主题）
//    B2 后输入控件规则迁入 panel.css，--ne-input-* 引用真源随之在 panel.css 断言
assert(sharedJs.indexOf('background:#fff') === -1, 'B1: panel-shared.js 不再含 background:#fff 输入白底');
assert(sharedJs.indexOf('color:#000') === -1, 'B1: panel-shared.js 不再含 color:#000 输入硬编码');
assert(sharedJs.indexOf('color:#999') === -1, 'B1: panel-shared.js placeholder 不再硬编码 #999');
assert(panelCss.indexOf('var(--ne-input-bg)') !== -1, 'B1: 输入背景引用 --ne-input-bg（B2 后真源在 panel.css）');
assert(panelCss.indexOf('var(--ne-input-ink)') !== -1, 'B1: 输入文字引用 --ne-input-ink（B2 后真源在 panel.css）');
assert(panelCss.indexOf('var(--ne-input-placeholder)') !== -1, 'B1: placeholder 引用 --ne-input-placeholder（B2 后真源在 panel.css）');

console.log('\n=== ui-tokens: B2 存量 CSS 迁移 ===');

var eventsJs = read('src/adapter/events.js');

// 8. B2 注入管道：panel-shared.js import panel.css（静态真源）
assert(sharedJs.indexOf("from '../ui/panel.css'") !== -1, 'B2: panel-shared.js 引用 panel.css');

// 9. injectBottomDrawerCSS 拼接 panelCss：静态真源随动态外壳规则一并注入
var b2TextIdx = sharedJs.indexOf('style.textContent =');
var b2PanelIdx = sharedJs.indexOf('panelCss;');
assert(b2TextIdx !== -1, 'B2: injectBottomDrawerCSS 含 style.textContent 赋值');
assert(b2PanelIdx !== -1, 'B2: textContent 拼接 panelCss');
assert(b2TextIdx !== -1 && b2PanelIdx !== -1 && b2PanelIdx > b2TextIdx, 'B2: panelCss 在 style.textContent 赋值之后拼接');

// 10. panel.css 存在且覆盖纯 class 真源（核心分区抽查）
assert(panelCss.indexOf('.ne-vault-tab-bar') !== -1, 'B2: panel.css 含 .ne-vault-tab-bar（抽屉 tab）');
assert(panelCss.indexOf('.ne-state-badge') !== -1, 'B2: panel.css 含 .ne-state-badge（状态卡）');
assert(panelCss.indexOf('.ne-usage-card') !== -1, 'B2: panel.css 含 .ne-usage-card（用量）');
assert(panelCss.indexOf('.ne-modal-overlay') !== -1, 'B2: panel.css 含 .ne-modal-overlay（modal）');
assert(panelCss.indexOf('.ne-toast') !== -1, 'B2: panel.css 含 .ne-toast（toast）');
assert(panelCss.indexOf('.ne-config-select') !== -1, 'B2: panel.css 含 .ne-config-select（模板配置）');

// 11. 动态前缀规则未误迁：hostSel/mobileSel 拼接仍留在 JS，panel.css 不含 :host 外壳
assert(panelCss.indexOf(':host') === -1, 'B2: panel.css 不含 :host 动态外壳规则');
assert(sharedJs.indexOf("hostSel + '{' +") !== -1, 'B2: hostSel 外壳规则保留在 JS');
assert(sharedJs.indexOf('mobileSel +') !== -1, 'B2: mobileSel 响应式规则保留在 JS');

// 12. 静态 CSS 引用 token（token 化纪律延续到 panel.css）
assert(panelCss.indexOf('var(--ne-success)') !== -1, 'B2: panel.css 状态色引用 --ne-success');
assert(panelCss.indexOf('var(--ne-scroll-thumb)') !== -1, 'B2: panel.css 滚动条引用 --ne-scroll-thumb');

// 13. 聊天区 banner（主文档）独立注入保留：events.js _ensureBannerCSS 未并入 panel.css
assert(panelCss.indexOf('language-banner') === -1, 'B2: panel.css 不含聊天区 banner（language-banner）规则');
assert(eventsJs.indexOf('ne-state-banner-css') !== -1, 'B2: events.js 保留独立 banner CSS 注入（作用于主文档聊天区）');

console.log('\n=== ui-tokens: 多主题体系（三层结构） ===');

// 14. 三主题作用域块：tokens.css 唯一真源承载体
['ne-dark', 'ne-light', 'st'].forEach(function (name) {
    assert(tokensCss.indexOf(':root[data-ne-theme="' + name + '"]') !== -1,
        'tokens.css 含 data-ne-theme="' + name + '" 主题块');
});

// 15. --ne-font 字体栈令牌（各主题可不同）
assert(tokensCss.indexOf('--ne-font:') !== -1, 'tokens.css 定义 --ne-font 字体栈令牌');
assert(tokensCss.indexOf('var(--mainFontFamily') !== -1, 'st 主题 --ne-font 跟随 ST 主字体');

// 16. ne-dark 为 :root 默认回落（无 data-ne-theme 属性时的行为）
assert(/:root,\s*\n:root\[data-ne-theme="ne-dark"\]\s*\{/.test(tokensCss),
    'ne-dark 与 :root 合写（默认回落值）');

// 17. 面板底色令牌（抽屉/Modal/Confirm 外壳）
assert(tokensCss.indexOf('--ne-panel-bg:') !== -1, 'tokens.css 定义 --ne-panel-bg 面板底色令牌');

console.log('\n=== ui-tokens: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);
