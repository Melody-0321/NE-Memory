// orb.js — 页面内悬浮球：记忆入口按钮 + 运行状态显示器
//
// 交互骨架参照柏宝书 FloatingOrb.vue：自由拖拽 + 左右边缘吸附（贴边半隐，
// hover/聚焦整条滑出）+ 位置本机 localStorage 持久化（不跨设备同步——
// 各设备屏幕尺寸不同，同步反而会跑到屏幕外）。
//
// 差异点（NE 独有）：二态脉冲状态显示——真源为 pipeline-guard 的
// onPipelineChange({state, stm, ltm})，任一 active → .busy（accent 脉冲环），
// 零新增状态机。点击 toggle 底部抽屉面板。
//
// 挂载：PD.body（主文档，非 shadow——面板关闭时也可见）；样式注入 PD.head
// （id=ne_orb_style）。开关持久化于 ne_settings.orb_enabled（跨设备同步）。
import orbCss from '../ui/orb.css';
import { PD, byId, pdCreate, t, closeVaultOverlay } from './panel-shared.js';
import { createVaultPopout } from './panel-popout.js';
import { onPipelineChange, getPipelinePhase } from '../core/engine/pipeline-guard.js';

var SNAP_ZONE = 56;         // 松手时距左/右边缘 ≤ 此值吸附贴边
var CLICK_SLOP = 6;         // 位移 < 此值视为点击而非拖动
var ORB_W = 44;             // 与 orb.css width 一致
var ORB_H = 44;
var POS_KEY = 'ne_orb_pos'; // 本机视觉态，不跨设备同步

var _mounted = false;
var _statusBound = false;
var _resizeBound = false;
var _getChatId = null;

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
        el.style.setProperty('--ne-orb-shift', '-58%');
    } else if (pos.dock === 'right') {
        el.style.left = 'auto';
        el.style.right = '0px';
        el.style.setProperty('--ne-orb-shift', '58%');
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

// ── 运行状态 tooltip 文案 ──
function phaseLabel(status) {
    var parts = [];
    if (status.state === 'active') parts.push(t('orb_phase_state'));
    if (status.stm === 'active') parts.push(t('orb_phase_stm'));
    if (status.ltm === 'active') parts.push(t('orb_phase_ltm'));
    return parts.length > 0 ? '（' + parts.join(' / ') + '）' : '';
}

function updateOrbStatus(status) {
    var orb = byId('ne_orb');
    if (!orb) return;
    var busy = status.state === 'active' || status.stm === 'active' || status.ltm === 'active';
    orb.classList.toggle('busy', busy);
    orb.title = busy ? t('orb_busy') + phaseLabel(status) : t('orb_idle');
    orb.setAttribute('aria-label', t('orb_title') + (busy ? ' — ' + t('orb_busy') : ''));
}

// ── 开关读取（ne_settings.orb_enabled，默认开）──
function isOrbEnabled() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) { var s = JSON.parse(raw); if (s && s.orb_enabled === false) return false; }
    } catch (e) {}
    return true;
}

// ── DOM 构建与交互 ──
function buildOrb() {
    var el = pdCreate('div');
    el.id = 'ne_orb';
    el.className = 'ne-orb';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.title = t('orb_idle');
    el.setAttribute('aria-label', t('orb_title'));
    // 书签图标（与底栏 fa-book-bookmark 品牌一致）；currentColor 继承，无颜色字面量
    el.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" pointer-events="none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
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

/**
 * 挂载悬浮球（init 双跑守卫）。开关关闭时不挂载，但保留管线订阅与
 * 位置存储，applyOrbVisibility() 可即时挂回。
 */
export function mountNeOrb(getChatId) {
    _getChatId = getChatId;

    // 管线状态订阅（模块级单次）：真源 pipeline-guard，二态脉冲
    if (!_statusBound) {
        _statusBound = true;
        onPipelineChange(function (status) { updateOrbStatus(status); });
    }

    if (!isOrbEnabled()) return;
    if (byId('ne_orb')) return; // 双跑守卫

    injectOrbCSS();
    var el = buildOrb();
    bindOrbEvents(el);
    PD.body.appendChild(el);
    _mounted = true;

    // 挂载即同步当前状态（订阅只推增量变化）
    updateOrbStatus(getPipelinePhaseSnapshot());

    // 视口变化时夹回可视范围（模块级单次绑定）
    if (!_resizeBound) {
        _resizeBound = true;
        window.addEventListener('resize', function () {
            var el2 = byId('ne_orb');
            if (!el2) return;
            var pos = loadPos();
            clampToViewport(pos);
            applyPos(el2, pos);
            savePos(pos);
        });
    }
}

// pipeline-guard 只暴露 onPipelineChange（增量通知），挂载时读当前快照
function getPipelinePhaseSnapshot() {
    var phase = getPipelinePhase();
    var s = { state: 'idle', stm: 'idle', ltm: 'idle' };
    if (phase !== 'idle') {
        var parts = phase.split(',');
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === 'state' || parts[i] === 'stm' || parts[i] === 'ltm') s[parts[i]] = 'active';
        }
    }
    return s;
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
        if (el) el.remove();
        _mounted = false;
    }
}
