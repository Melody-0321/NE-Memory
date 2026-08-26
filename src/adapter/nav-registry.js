// ── P1 导航注册表与页栈（Nav Registry + Page Stack）──
//
// 系统功能页（设置/模板库/用量/版本历史）统一走抽屉内全屏子页：
//   - 注册表数据驱动：入口、标题、渲染函数一处声明
//   - 单容器换页：.ne-page-layer 覆盖 tab bar + 内容区，open 渲染 / close 销毁
//   - 主内容 DOM 不销毁（覆盖式），tab/搜索/accordion 上下文天然保留；
//     仅对 scroll-area 滚动位置做兜底快照（防覆盖期间重渲染重置滚动）
//
// 纪律：
//   - t 从 panel-shared.js 导入（翻译查询），不得从 core/i18n.js 导入 setter
//   - 不引入浏览器测试链；node 层测试走源码级断言（nav-registry.test.js）

import { panelById, panelQS, pdCreate, t } from './panel-shared.js';

var _pages = {};
var _openId = null;
var _scrollSnapshot = 0;

// ── 注册表 ──

export function registerNavPage(page) {
    if (!page || typeof page.id !== 'string' || !page.id) {
        console.warn('[NE] registerNavPage: 缺少有效 id，注册被忽略');
        return;
    }
    if (_pages[page.id]) {
        console.warn('[NE] registerNavPage: 重复注册页 ' + page.id + '，已覆盖');
    }
    _pages[page.id] = page;
}

export function getNavPage(id) {
    return _pages[id];
}

export function getNavPages() {
    return Object.keys(_pages).map(function (id) { return _pages[id]; });
}

// ── 页栈 ──

function _getLayer() {
    return panelById('ne-page-layer');
}

function _getScrollArea() {
    return panelQS('.ne-vault-scroll-area');
}

export function openNavPage(id) {
    if (_openId === id) return; // 已开同页则幂等 no-op
    if (_openId) closeNavPage();
    var page = _pages[id];
    if (!page) {
        console.warn('[NE] openNavPage: 未注册页 ' + id);
        return;
    }
    var layer = _getLayer();
    if (!layer) return;

    // 打开前保存滚动兜底快照（覆盖期间主内容若重渲染，close 后恢复）
    var scrollArea = _getScrollArea();
    if (scrollArea) _scrollSnapshot = scrollArea.scrollTop;

    _openId = id;
    layer.textContent = ''; // 清空旧页

    // 页 header：唯一退出路径 = ← 返回
    var header = pdCreate('div');
    header.className = 'ne-page-header';
    var backBtn = pdCreate('button');
    backBtn.type = 'button';
    backBtn.className = 'ne-page-back';
    backBtn.textContent = '\u2190 ' + t('back');
    backBtn.title = t('back');
    backBtn.addEventListener('click', closeNavPage);
    var title = pdCreate('div');
    title.className = 'ne-page-title';
    title.textContent = t(page.titleKey);
    header.appendChild(backBtn);
    header.appendChild(title);
    layer.appendChild(header);

    // 页内容容器（子页 render 目标）
    var content = pdCreate('div');
    content.className = 'ne-page-content';
    content.id = 'ne-page-content';
    layer.appendChild(content);

    layer.classList.add('open');
    if (typeof page.render === 'function') page.render(content);
}

export function closeNavPage() {
    var layer = _getLayer();
    if (layer) {
        layer.classList.remove('open');
        layer.textContent = '';
    }
    _openId = null;
    var scrollArea = _getScrollArea();
    if (scrollArea) scrollArea.scrollTop = _scrollSnapshot;
}

export function isNavPageOpen() {
    return _openId !== null;
}
