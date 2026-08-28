// ════════════════════════════════════════════════════════════════
//   NE Memory — 页面内悬浮球（方案 B：枢纽中枢 + 三卫星管线状态灯）
// ════════════════════════════════════════════════════════════════
//   - 标准 FAB：自由悬浮、整球可见、可拖拽、无贴边磁吸
//   - 位置本机持久化（localStorage: ne_orb_pos_v2），忽略旧版 dock 字段
//   - 可见性硬约束：挂载当下自注入 #ne_vars_style(tokens) + #ne_orb_style(css)
//     彻底规避 token 未就绪 → 透明隐形（上次失败根因）
//   - 纪律：本文件不得出现颜色字面量（ratchet-color-literals 扫描 src/adapter/*.js）
// ════════════════════════════════════════════════════════════════
import orbCss from '../ui/orb.css';
import tokensCss from '../ui/tokens.css';
import { byId, pdCreate, pdHead, pdBody, closeVaultOverlay, t } from './panel-shared.js';
import { createVaultPopout } from './panel-popout.js';
import { onPipelineChange, offPipelineChange, getState } from '../core/engine/pipeline-guard.js';

var ORB_ID = 'ne_orb';
var TOOLTIP_ID = 'ne_orb_tooltip';
var POS_KEY = 'ne_orb_pos_v2';
var SIZE = 44;
var CLICK_SLOP = 6;
var FLASH_MS = 1600;

// [pipeline_key, node_class]；节点顺序固定，tooltip/状态灯遍历用
var PIPE_NODES = [
    ['state', 'ne-node-state'],
    ['stm', 'ne-node-stm'],
    ['ltm', 'ne-node-ltm']
];

var _mounted = false;
var _getChatId = null;
var _orb = null;
var _onChange = null;
var _dragging = false;
var _drag = null;
var _lastActive = { state: false, stm: false, ltm: false };
var _flashTimer = null;

// ── 可见性硬约束：令牌 + CSS 就地注入 ──
export function injectOrbCSS() {
    if (!byId('ne_vars_style')) {
        var vars = pdCreate('style');
        vars.id = 'ne_vars_style';
        vars.textContent = tokensCss;
        pdHead().appendChild(vars);
    }
    if (!byId('ne_orb_style')) {
        var style = pdCreate('style');
        style.id = 'ne_orb_style';
        style.textContent = orbCss;
        pdHead().appendChild(style);
    }
}

function createOrbElement() {
    var orb = pdCreate('div');
    orb.id = ORB_ID;
    orb.className = 'ne-orb idle';
    orb.setAttribute('role', 'button');
    orb.setAttribute('aria-label', t('orb_title'));
    orb.setAttribute('tabindex', '0');
    // 中央枢纽图标：三管线汇入中枢记忆（SVG 全 currentColor 继承，不写死颜色）
    orb.innerHTML =
        '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">' +
        '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
        '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>' +
        '<path d="M12 9V4M12 15v5"/>' +
        '<path d="M10 10.5 5.5 6.5M14 10.5 18.5 6.5M10 13.5 5.5 17.5M14 13.5 18.5 17.5"/>' +
        '</g></svg>';
    // 三卫星节点（管线状态灯，pointer-events:none 不拦截拖拽）
    PIPE_NODES.forEach(function (nd) {
        var node = pdCreate('div');
        node.className = nd[1];
        orb.appendChild(node);
    });
    return orb;
}

// ── 位置持久化（标准 FAB，仅采 x/y） ──
function clampToViewport(p, winW, winH) {
    winW = winW || window.innerWidth;
    winH = winH || window.innerHeight;
    var m = 8;
    return {
        x: Math.max(m, Math.min(winW - SIZE - m, p.x)),
        y: Math.max(m, Math.min(winH - SIZE - m, p.y))
    };
}

function loadPos() {
    var fallback = clampToViewport({
        x: window.innerWidth - SIZE - 24,
        y: Math.round(window.innerHeight * 0.28)
    });
    try {
        var raw = window.localStorage.getItem(POS_KEY);
        if (!raw) return fallback;
        var p = JSON.parse(raw);
        if (typeof p.x === 'number' && typeof p.y === 'number') return clampToViewport(p);
        return fallback;
    } catch (e) { return fallback; }
}

function savePos() {
    try {
        var r = _orb.getBoundingClientRect();
        window.localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
    } catch (e) { /* 存储失败不影响本次会话展示 */ }
}

function loadAndSetPosition() {
    var p = loadPos();
    _orb.style.left = p.x + 'px';
    _orb.style.top = p.y + 'px';
}

// ── 点击：开关底部记忆面板 ──
function handleClick() {
    var overlay = byId('ne_vault_bottom_overlay');
    var chatIdFn = _getChatId || function () { return null; };
    if (overlay && overlay.classList.contains('open')) {
        closeVaultOverlay();
    } else {
        createVaultPopout(chatIdFn);
    }
}

// ── 拖拽：window 级 pointer 事件，稳定、不依赖 pointer capture、无贴边 ──
function bindEvents() {
    _orb.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    _orb.addEventListener('keydown', onKeyDown);
    _orb.addEventListener('pointerenter', onEnter);
    _orb.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);
}

function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); }
}

function onPointerDown(e) {
    if (e.button !== 0) return;
    _dragging = true;
    _drag = {
        startX: e.clientX,
        startY: e.clientY,
        left: _orb.offsetLeft,
        top: _orb.offsetTop,
        moved: false
    };
    _orb.classList.add('dragging');
}

function onPointerMove(e) {
    if (!_dragging || !_drag) return;
    var dx = e.clientX - _drag.startX;
    var dy = e.clientY - _drag.startY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (!_drag.moved && dist < CLICK_SLOP) return;
    _drag.moved = true;
    e.preventDefault();
    var p = clampToViewport({ x: _drag.left + dx, y: _drag.top + dy });
    _orb.style.left = p.x + 'px';
    _orb.style.top = p.y + 'px';
}

function onPointerUp() {
    if (!_dragging) return;
    _dragging = false;
    _orb.classList.remove('dragging');
    if (_drag) {
        if (_drag.moved) savePos();
        else handleClick();
    }
    _drag = null;
}

function onResize() {
    var p = clampToViewport({ x: _orb.offsetLeft, y: _orb.offsetTop });
    _orb.style.left = p.x + 'px';
    _orb.style.top = p.y + 'px';
}

// ── 状态灯：active → .lit 点亮卫星 + busy 脉冲；active→idle 下降沿触发 flash ──
function triggerFlash() {
    if (!_orb) return;
    if (_flashTimer) { clearTimeout(_flashTimer); _flashTimer = null; }
    _orb.classList.remove('flash');
    void _orb.offsetWidth; // 重排以重启 animation
    _orb.classList.add('flash');
    _flashTimer = setTimeout(function () {
        if (_orb) _orb.classList.remove('flash');
        _flashTimer = null;
    }, FLASH_MS);
}

function renderStatus(status) {
    var st = status || getState() || {};
    var activeCount = 0;
    PIPE_NODES.forEach(function (nd) {
        var active = st[nd[0]] === 'active';
        if (active) activeCount++;
        var node = _orb.querySelector('.' + nd[1]);
        if (node) node.classList.toggle('lit', active);
        if (_lastActive[nd[0]] === true && !active) triggerFlash();
        _lastActive[nd[0]] = active;
    });
    if (activeCount > 0) {
        _orb.classList.add('busy');
        _orb.classList.remove('idle');
    } else {
        _orb.classList.remove('busy');
        _orb.classList.add('idle');
    }
    _orb.setAttribute('data-active', activeCount);
}

// ── rich tooltip：三管线状态明细 + 拖拽/点击提示 ──
function buildTooltip() {
    var tip = byId(TOOLTIP_ID);
    if (!tip) {
        tip = pdCreate('div');
        tip.id = TOOLTIP_ID;
        pdBody().appendChild(tip);
    }
    var st = getState() || {};
    tip.innerHTML = '';
    var title = pdCreate('div');
    title.className = 'ne-orb-tip-title';
    title.textContent = t('orb_title');
    tip.appendChild(title);
    PIPE_NODES.forEach(function (nd) {
        var active = st[nd[0]] === 'active';
        var row = pdCreate('div');
        row.className = 'ne-orb-tip-row';
        var dot = pdCreate('span');
        dot.className = 'ne-orb-tip-dot' + (active ? ' on' : '');
        var label = pdCreate('span');
        label.textContent = t('orb_phase_' + nd[0]) + ': ' + (active ? t('orb_busy') : t('orb_idle'));
        row.appendChild(dot);
        row.appendChild(label);
        tip.appendChild(row);
    });
    var hint = pdCreate('div');
    hint.className = 'ne-orb-tip-hint';
    hint.textContent = t('orb_tooltip_hint');
    tip.appendChild(hint);
    return tip;
}

function positionTooltip() {
    var tip = byId(TOOLTIP_ID);
    if (!tip || !_orb) return;
    var r = _orb.getBoundingClientRect();
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var x = r.left;
    var y = r.top - th - 8;
    if (y < 6) y = r.bottom + 8;
    if (x + tw > window.innerWidth - 6) x = window.innerWidth - 6 - tw;
    if (x < 6) x = 6;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
}

function onEnter() {
    var tip = buildTooltip();
    positionTooltip();
    tip.classList.add('visible');
}

function onLeave() {
    var tip = byId(TOOLTIP_ID);
    if (tip) tip.classList.remove('visible');
}

// ── 挂载 / 卸载 ──
export function mountNeOrb(getChatIdFn) {
    injectOrbCSS();
    if (_mounted) return _orb;
    _mounted = true;
    _getChatId = getChatIdFn || null;
    _orb = createOrbElement();
    pdBody().appendChild(_orb);
    loadAndSetPosition();
    bindEvents();
    _onChange = renderStatus;
    onPipelineChange(_onChange);
    renderStatus(getState());
    return _orb;
}

export function unmountNeOrb() {
    if (!_mounted) return;
    _mounted = false;
    if (_onChange) { offPipelineChange(_onChange); _onChange = null; }
    if (_orb) {
        _orb.removeEventListener('pointerdown', onPointerDown);
        _orb.removeEventListener('keydown', onKeyDown);
        _orb.removeEventListener('pointerenter', onEnter);
        _orb.removeEventListener('pointerleave', onLeave);
        if (_orb.parentNode) _orb.parentNode.removeChild(_orb);
        _orb = null;
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('resize', onResize);
    var tip = byId(TOOLTIP_ID);
    if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
    _drag = null;
    _dragging = false;
}