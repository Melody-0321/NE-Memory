// ne-theme 多主题体系源码级断言：三主题块 + applyNeTheme 机制 + 设置面板绑定
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
var settingsJs = read('src/adapter/panel-settings.js');

console.log('\n=== ne-theme: 三主题块结构 ===');

// 1. tokens.css 含三个主题作用域块
['ne-dark', 'ne-light', 'st'].forEach(function (name) {
    assert(tokensCss.indexOf(':root[data-ne-theme="' + name + '"]') !== -1,
        'tokens.css 含 :root[data-ne-theme="' + name + '"] 主题块');
});

// 2. ne-dark 是 :root 默认回落（无属性时即 ne-dark）
assert(/:root,\s*\n:root\[data-ne-theme="ne-dark"\]\s*\{/.test(tokensCss),
    'ne-dark 与 :root 合写（默认回落）');

// 3. st 主题保留 ST 主题变量派生（跟随ST行为不变）
assert(tokensCss.indexOf('var(--SmartThemeBlurTintColor') !== -1, 'st 主题块保留 SmartThemeBlurTintColor 派生');
assert(tokensCss.indexOf('var(--SmartThemeBorderColor') !== -1, 'st 主题块保留 SmartThemeBorderColor 派生');
assert(tokensCss.indexOf('var(--SmartThemeQuoteColor') !== -1, 'st 主题块保留 SmartThemeQuoteColor 派生');

// 4. 各主题令牌 key 集合一致（防漏定义：新主题必须覆盖全部主题令牌）
function extractThemeKeys(attr) {
    var re = new RegExp(':root\\[data-ne-theme="' + attr + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}');
    var m = tokensCss.match(re);
    if (!m) return null;
    var keys = [];
    var propRe = /(--ne-[a-z0-9-]+)\s*:/g;
    var mm;
    while ((mm = propRe.exec(m[1]))) keys.push(mm[1]);
    return keys.sort();
}

var darkKeys = extractThemeKeys('ne-dark');
var lightKeys = extractThemeKeys('ne-light');
var stKeys = extractThemeKeys('st');
assert(darkKeys && darkKeys.length >= 20, 'ne-dark 主题块令牌数 >= 20（实际 ' + (darkKeys ? darkKeys.length : 0) + '）');
assert(lightKeys && darkKeys && lightKeys.join(',') === darkKeys.join(','), 'ne-light 与 ne-dark 令牌 key 集合一致');
assert(stKeys && darkKeys && stKeys.join(',') === darkKeys.join(','), 'st 与 ne-dark 令牌 key 集合一致');

// 5. 分类语义色令牌三主题齐备（悬念卡 promise/plan/foreshadow 消费）
['ne-dark', 'ne-light', 'st'].forEach(function (name) {
    var keys = extractThemeKeys(name);
    assert(keys && keys.indexOf('--ne-gold') !== -1, name + ' 定义 --ne-gold');
    assert(keys && keys.indexOf('--ne-violet') !== -1, name + ' 定义 --ne-violet');
});

console.log('\n=== ne-theme: applyNeTheme 机制（panel-shared.js） ===');

// 6. 白名单 + 切换实现
assert(sharedJs.indexOf("var NE_THEMES = { 'ne-dark': true, 'ne-light': true, 'st': true }") !== -1,
    'NE_THEMES 白名单含三主题');
assert(sharedJs.indexOf("if (!NE_THEMES[theme]) theme = 'ne-dark';") !== -1, 'applyNeTheme 非法值回落 ne-dark');
assert(sharedJs.indexOf("removeAttribute('data-ne-theme')") !== -1, 'ne-dark 时移除属性（:root 默认回落）');
assert(sharedJs.indexOf("setAttribute('data-ne-theme', theme)") !== -1, '非默认主题写 data-ne-theme 属性');

// 7. readNeTheme 持久化读取 + 默认值
assert(sharedJs.indexOf("JSON.parse(localStorage.getItem('ne_settings'))") !== -1 || sharedJs.indexOf("localStorage.getItem('ne_settings')") !== -1,
    'readNeTheme 读 ne_settings');
assert(/return 'ne-dark';\s*\n\}/.test(sharedJs), 'readNeTheme 无值时返回 ne-dark 默认');

// 8. 启动应用：CSS 注入后调用 applyNeTheme(readNeTheme())
var injectIdx = sharedJs.indexOf('applyNeTheme(readNeTheme())');
assert(injectIdx !== -1, 'panel-shared.js 启动时调用 applyNeTheme(readNeTheme())');
var cssInjectIdx = sharedJs.indexOf('tokens.css');
assert(cssInjectIdx !== -1 && injectIdx > cssInjectIdx, '主题应用位于 tokens.css 注入之后（令牌先就位）');

console.log('\n=== ne-theme: 设置面板绑定（panel-settings.js） ===');

// 9. 主题选择器存在且含三个 option
assert(settingsJs.indexOf('id="nes_ui_theme"') !== -1, '设置面板含 nes_ui_theme 选择器');
['ne-dark', 'ne-light', 'st'].forEach(function (v) {
    assert(settingsJs.indexOf('value="' + v + '"') !== -1, '选择器含 option value="' + v + '"');
});

// 10. 切换逻辑：立即生效 + 持久化 ne_settings.ui_theme
var bindIdx = settingsJs.indexOf("themeSel.onchange");
assert(bindIdx !== -1, '绑定 onchange 切换逻辑');
assert(settingsJs.indexOf("s.ui_theme = themeSel.value") !== -1, '切换时写入 ne_settings.ui_theme');
assert(settingsJs.indexOf('applyNeTheme(themeSel.value)') !== -1, '切换时立即调用 applyNeTheme');
assert(settingsJs.indexOf('neSync(\'ne_settings\')') !== -1, '切换时同步 extensionSettings（跨设备）');

// 11. 消费侧：panel.css 分类徽章不再使用硬编码分类色（已令牌化）
var panelCss = read('src/ui/panel.css');
assert(panelCss.indexOf('#e2b714') === -1, 'panel.css 不再含硬编码 #e2b714（已令牌化 --ne-gold）');
assert(panelCss.indexOf('#a855f7') === -1, 'panel.css 不再含硬编码 #a855f7（已令牌化 --ne-violet）');
assert(panelCss.indexOf('var(--ne-gold)') !== -1, 'panel.css 消费 --ne-gold');
assert(panelCss.indexOf('var(--ne-violet)') !== -1, 'panel.css 消费 --ne-violet');

console.log('\n=== ne-theme: ' + test.passed + ' passed, ' + test.failed + ' failed ===');
if (test.failed > 0) process.exit(1);
