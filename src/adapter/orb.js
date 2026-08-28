// orb.js — 页面内悬浮球：插件门面 = 记忆入口按钮 + 实时管线状态显示器
//
// 形态（方案 B）：中心枢纽 + 三卫星节点图标（state/STM/LTM 各一节点），
// 三卫星同时兼作「状态灯」——运行中的管线其卫星点亮 accent，图标本身
// 即状态显示器；hover 显示 rich tooltip（三管线各自状态明细）。
//
// 三档运行状态（真源 = pipeline-guard onPipelineChange，零新增状态机）：
//   idle      无管线运行 → 半透明静止
//   运行中     1~3 条管线 → accent 脉冲环 + 对应卫星点亮，强度随活跃数递增
//   刚完成     有管线 active→idle → success 色短暂 flash（1.5s 回落）
//
// 交互骨架参照柏宝书 FloatingOrb.vue：自由拖拽 + 左右边缘吸附（贴边半隐，
// hover/聚焦整条滑出）+ 位置本机 localStorage 持久化（不跨设备同步）。
// 点击 toggle 底部抽屉；开关 ne_settings.orb_enabled（跨设备同步）。
//
// 挂载：PD.body（主文档，非 shadow——面板关闭时也可见）；样式注入 PD.head
// （id=ne_orb_style）。原底部 #ne_memory_button 迁入 #extensionsMenu（魔杖菜单）。
import orbCss from '../ui/orb.css';
import { PD, byId, pdCreate, t, closeVaultOverlay } from './panel-shared.js';
import { createVaultPopout } from './panel-popout.js';
import { onPipelineChange } from '../core/engine/pipeline-guard.js';

var SNAP_ZONE = 56;         // 松手时距左/右边缘 ≤ 此值吸附贴边
var CLICK_SLOP = 6;         // 位移 < 此值视为点击而非拖动
var ORB_W = 44;             // 与 orb.css width 一致
var ORB_H = 44;
var POS_KEY = 'ne_orb_pos'; // 本机视觉态，不跨设备同步
var FLASH_MS = 1500;        // 完成 flash 保持时长

var _mounted = false;
var _statusBound = false;
var _resizeBound = false;
var _getChatId = null;

// 状态灯节点类名 → 管线名 映射
var PIPE_NODES = [['state', 'ne-node-state'], ['stm', 'ne-node-stm'], ['ltm', 'ne-node-ltm']];

// ── 位置存取（{dock:'left'|'right'|'none', x, y}）──
function loadPos() {
    try {
        var raw = localStorage.getItem(POS_KEY);
        if (raw) {
            var p = JSON.parse(raw);
            if (p && (p.dock === 'left' || p.dock === 'right' || p.dock === 'none')) {
                return { dock: p.dock, x: Number(p.x) || 0, y: Number(p.y) || 0 };
            }
        }
    } catch (e) {}
    // 默认：右侧贴边、纵向居中偏下
    return { dock: 'right', x: 0, y: Math.round(window.innerHeight * 0.6) };
}

function savePos(pos) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {}
}

// 换小屏/旋转后把坐标夹回可视范围
function clampToViewport(pos) {
    var maxY = Math.max(0, window.innerHeight - ORB_H);
    pos.y = Math.min(Math.max(0, pos.y), maxY);
    if (pos.dock === 'none') {
        var maxX = Math.max(0, window.innerWidth - ORB_W);
        pos.x = Math.min(Math.max(0, pos.x), maxX);
    }
}

// ── 定位渲染：贴边 left/right 锚定 + CSS 变量控制半隐；free 绝对 x/y ──
function applyPos(el, pos) {
    el.style.top = pos.y + 'px';
    if (pos.dock === 'left') {
        el.style.left = '0px';
        el.style.right = 'auto';
        el.style.setProperty('--ne-orb-shift', '-28%');
    } else if (pos.dock === 'right') {
        el.style.left = 'auto';
        el.style.right = '0px';
        el.style.setProperty('--ne-orb-shift', '28%');
    } else {
        el.style.left = pos.x + 'px';
        el.style.right = 'auto';
        el.style.setProperty('--ne-orb-shift', '0%');
    }
}

// 贴边态由 right/translate 折算成绝对像素，供拖动起步用
function currentLeft(pos) {
    if (pos.dock === 'right') return window.innerWidth - ORB_W;
    if (pos.dock === 'left') return 0;
    return pos.x;
}

// ── 状态文案 ──
function pipeLabel(pipe) {
    if (pipe === 'state') return t('orb_phase_state');
    if (pipe === 'stm') return t('orb_phase_stm');
    if (pipe === 'ltm') return t('orb_phase_ltm');
    return pipe;
}

function countActive(status) {
    var n = 0;
    if (status.state === 'active') n++;
    if (status.stm === 'active') n++;
    if (status.ltm === 'active') n++;
    return n;
}

// 三档视觉 + 三卫星状态灯 + title
function renderStatus(orb, status) {
    var active = countActive(status);
    var busy = active > 0;
    orb.classList.toggle('busy', busy);
    // 强度档位：data-active = 活跃管线数（0 无转动，1/2/3 递增）
    orb.setAttribute('data-active', String(active));

    // 三卫星状态灯：运行中的管线点亮
    for (var i = 0; i < PIPE_NODES.length; i++) {
        var pipe = PIPE_NODES[i][0];
        var cls = PIPE_NODES[i][1];
        var node = orb.querySelector('.' + cls);
        if (node) node.classList.toggle('lit', status[pipe] === 'active');
    }

    // 语义：图标即状态，title 仅作降级补充
    orb.title = busy ? t('orb_busy') : t('orb_idle');
    orb.setAttribute('aria-label', t('orb_title') + (busy ? ' — ' + t('orb_busy') : ''));
}

// 检测 active→idle 下降沿 → 触发完成 flash（success 色短暂亮）
var _prevStatus = null;
function maybeFlash(orb, status) {
    var prev = _prevStatus;
    _prevStatus = { state: status.state, stm: status.stm, ltm: status.ltm };
    if (!prev) return;
    var completed = false;
    for (var i = 0; i < PIPE_NODES.length; i++) {
        var p = PIPE_NODES[i][0];
        if (prev[p] === 'active' && status[p] !== 'active') completed = true;
    }
    if (!completed) return;
    // 若已有 flash 未结束，重置计时器
    if (orb._flashTimer) clearTimeout(orb._flashTimer);
    orb.classList.add('flash');
    orb._flashTimer = setTimeout(function () {
        orb.classList.remove('flash');
        orb._flashTimer = null;
    }, FLASH_MS);
}

// ── 开关读取（ne_settings.orb_enabled，默认开）──
function isOrbEnabled() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) { var s = JSON.parse(raw); if (s && s.orb_enabled === false) return false; }
    } catch (e) {}
    return true;
}

// ── rich hover tooltip（三管线各自状态，JS 定位 + clamp）──
function buildTip() {
    var tip = pdCreate('div');
    tip.id = 'ne_orb_tip';
    tip.className = 'ne-orb-tip';
    PD.body.appendChild(tip);
    return tip;
}

function renderTip(tip, status) {
    var busy = countActive(status) > 0;
    tip.innerHTML =
        '<div class="ne-orb-tip-title">' + t('orb_title') + ' · ' + (busy ? t('orb_busy') : t('orb_idle')) + '</div>' +
        tipRow('state', status) +
        tipRow('stm', status) +
        tipRow('ltm', status);
    function tipRow(pipe, st) {
        var on = st[pipe] === 'active';
        return '<div class="ne-orb-tip-row' + (on ? ' is-active' : '') + '">' +
            '<span class="ne-orb-tip-dot"></span>' +
            '<span>' + escapeText(pipeLabel(pipe)) + '</span>' +
            '<span class="ne-orb-tip-state">' + (on ? t('orb_status_running') : t('orb_status_idle')) + '</span>' +
            '</div>';
    }
}

function escapeText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function positionTip(tip, orbEl, status) {
    renderTip(tip, status);
    var r = orbEl.getBoundingClientRect();
    var tipW = tip.offsetWidth || 180;
    var tipH = tip.offsetHeight || 90;
    var left = r.right + 10;
    var top = r.top + (r.height - tipH) / 2;
    // 右侧放不下 → 放左侧；垂直夹回视口
    if (left + tipW > window.innerWidth - 8) left = r.left - tipW - 10;
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - tipH - 8));
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.add('visible');
}

function hideTip(tip) {
    if (tip) tip.classList.remove('visible');
}

// ── DOM 构建与交互 ──
function buildOrb() {
    var el = pdCreate('div');
    el.id = 'ne_orb';
    el.className = 'ne-orb';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-active', '0');
    el.title = t('orb_idle');
    el.setAttribute('aria-label', t('orb_title'));
    // 方案 B 枢纽节点图标；currentColor 继承，无颜色字面量
    el.innerHTML =
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" pointer-events="none">' +
            '<circle class="ne-node ne-node-state" cx="12" cy="4.4" r="2.05"/>' +
            '<circle class="ne-node ne-node-stm" cx="4.4" cy="17.2" r="2.05"/>' +
            '<circle class="ne-node ne-node-ltm" cx="19.6" cy="17.2" r="2.05"/>' +
            '<circle class="ne-hub" cx="12" cy="12" r="3.1"/>' +
            '<g class="ne-link">' +
                '<path d="M10.1 6.1 L9.3 8.9"/>' +
                '<path d="M13.9 6.1 L14.7 8.9"/>' +
                '<path d="M6.2 13.6 L4.4 15.4"/>' +
                '<path d="M17.8 13.6 L19.6 15.4"/>' +
            '</g>' +
        '</svg>';
    return el;
}

function bindOrbEvents(el) {
    var pos = loadPos();
    clampToViewport(pos);
    applyPos(el, pos);

    var dragging = false;
    var activePointer = null;
    var startX = 0, startY = 0, moved = 0;
    var grabDX = 0, grabDY = 0;

    el.addEventListener('pointerdown', function (e) {
        activePointer = e.pointerId;
        dragging = true;
        moved = 0;
        startX = e.clientX;
        startY = e.clientY;
        grabDX = e.clientX - currentLeft(pos);
        grabDY = e.clientY - pos.y;
        el.classList.add('is-dragging');
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });

    el.addEventListener('pointermove', function (e) {
        if (!dragging || e.pointerId !== activePointer) return;
        moved = Math.max(moved, Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY));
        // 拖动中一律切 free 跟手（整条可见）
        pos.dock = 'none';
        pos.x = e.clientX - grabDX;
        pos.y = e.clientY - grabDY;
        clampToViewport(pos);
        applyPos(el, pos);
    });

    function onUp(e) {
        if (!dragging || e.pointerId !== activePointer) return;
        dragging = false;
        activePointer = null;
        el.classList.remove('is-dragging');

        if (moved < CLICK_SLOP) {
            // 视为点击 → toggle 底部抽屉（开 ↔ 关）
            var overlay = byId('ne_vault_bottom_overlay');
            if (overlay && overlay.classList.contains('open')) closeVaultOverlay();
            else if (_getChatId) createVaultPopout(_getChatId);
            return;
        }

        // 松手吸附判定：靠近左/右边缘才贴边，否则停在原地
        var left = pos.x;
        var right = window.innerWidth - (pos.x + ORB_W);
        if (left <= SNAP_ZONE) pos.dock = 'left';
        else if (right <= SNAP_ZONE) pos.dock = 'right';
        else pos.dock = 'none';
        clampToViewport(pos);
        applyPos(el, pos);
        savePos(pos);
    }

    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);

    // hover/focus → 显示 rich tooltip
    var tip = buildTip();
    var tipVisible = false;
    function showTip(status) { positionTip(tip, el, status); tipVisible = true; }
    function doHideTip() { hideTip(tip); tipVisible = false; }
    el.addEventListener('mouseenter', function () { if (_lastStatus) showTip(_lastStatus); });
    el.addEventListener('mouseleave', doHideTip);
    el.addEventListener('focus', function () { if (_lastStatus) showTip(_lastStatus); });
    el.addEventListener('blur', doHideTip);

    // 键盘可达：Enter/Space 触发点击
    el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            var overlay = byId('ne_vault_bottom_overlay');
            if (overlay && overlay.classList.contains('open')) closeVaultOverlay();
            else if (_getChatId) createVaultPopout(_getChatId);
        }
    });
}

function injectOrbCSS() {
    if (byId('ne_orb_style')) return;
    var style = pdCreate('style');
    style.id = 'ne_orb_style';
    style.textContent = orbCss;
    PD.head.appendChild(style);
}

// 最近一次管线状态（供 tooltip / 快照）
var _lastStatus = { state: 'idle', stm: 'idle', ltm: 'idle' };

// ── 状态订阅：三档视觉 + 卫星灯 + 完成 flash + tooltip 内容 ──
function initStatusSubscription() {
    onPipelineChange(function (status) {
        _lastStatus = status;
        var orb = byId('ne_orb');
        if (!orb) return;
        renderStatus(orb, status);
        maybeFlash(orb, status);
        var tip = byId('ne_orb_tip');
        if (tip && tip.classList.contains('visible')) renderTip(tip, status);
    });
}

/**
 * 挂载悬浮球（init 双跑守卫）。开关关闭时不挂载，但保留管线订阅与
 * 位置存储，applyOrbVisibility() 可即时挂回。
 */
export function mountNeOrb(getChatId) {
    _getChatId = getChatId;

    if (!_statusBound) {
        _statusBound = true;
        initStatusSubscription();
    }

    if (!isOrbEnabled()) return;
    if (byId('ne_orb')) return; // 双跑守卫

    injectOrbCSS();
    var el = buildOrb();
    bindOrbEvents(el);
    PD.body.appendChild(el);
    _mounted = true;

    // 挂载即同步当前状态（订阅只推增量变化）
    renderStatus(el, _lastStatus);
    maybeFlash(el, _lastStatus);

    if (!_resizeBound) {
        _resizeBound = true;
        window.addEventListener('resize', function () {
            var el2 = byId('ne_orb');
            var tip2 = byId('ne_orb_tip');
            if (!el2) return;
            var pos = loadPos();
            clampToViewport(pos);
            applyPos(el2, pos);
            savePos(pos);
            // 视口变化时重定位 tooltip
            if (tip2 && tip2.classList.contains('visible')) renderTip(tip2, _lastStatus);
        });
    }
}

/**
 * 设置开关回调：即时挂载/卸载悬浮球。
 * 位置与管线订阅保留，重开时无缝恢复。
 */
export function applyOrbVisibility() {
    if (isOrbEnabled()) {
        mountNeOrb(_getChatId);
    } else {
        var el = byId('ne_orb');
        if (el) {
            el.remove();
            if (el._flashTimer) { clearTimeout(el._flashTimer); el._flashTimer = null; }
        }
        var tip = byId('ne_orb_tip');
        if (tip) tip.remove();
        _mounted = false;
    }
}