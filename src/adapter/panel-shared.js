import { t_narrative, t_field, setFieldLocale } from '../core/i18n.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { isStateSchemaEnabled } from '../core/vault/schema.js';
import tokensCss from '../ui/tokens.css';
import panelCss from '../ui/panel.css';

export function t(key) { return t_narrative(key); }

export var PD;
try {
    PD = window.__NE_EXTENSION_MODE ? document : (window.parent.document || document);
} catch(e) { PD = document; }

// ── 多主题（data-ne-theme）：ne-dark 默认 / ne-light / st 跟随ST ──
// 持久化于 ne_settings.ui_theme（随 extensionSettings 跨设备同步）。
var NE_THEMES = { 'ne-dark': true, 'ne-light': true, 'st': true };
export function applyNeTheme(theme) {
    if (!NE_THEMES[theme]) theme = 'ne-dark';
    try {
        if (theme === 'ne-dark') {
            // :root 默认即 ne-dark（tokens.css 回落值），移除属性即可
            PD.documentElement.removeAttribute('data-ne-theme');
        } else {
            PD.documentElement.setAttribute('data-ne-theme', theme);
        }
    } catch (e) {}
}
export function readNeTheme() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) { var s = JSON.parse(raw); if (s && NE_THEMES[s.ui_theme]) return s.ui_theme; }
    } catch (e) {}
    return 'ne-dark';
}
export function qs(sel) { return PD.querySelector(sel); }
export function qsa(sel) { return PD.querySelectorAll(sel); }
export function byId(id) { return PD.getElementById(id); }
export function pdCreate(tag) { return PD.createElement(tag); }
export function pdHead() { return PD.head; }
export function pdBody() { return PD.body; }
export function pdAddEventListener(type, fn, opts) { PD.addEventListener(type, fn, opts); }

// ── Shadow DOM aware panel queries ──
var _panelRoot = null;
export function setPanelRoot(root) { _panelRoot = root; }
export function getPanelRoot() { return _panelRoot; }
export function panelById(id) {
    if (_panelRoot) return _panelRoot.getElementById(id);
    return byId(id);
}
export function panelQS(sel) {
    if (_panelRoot) return _panelRoot.querySelector(sel);
    return qs(sel);
}
export function panelQSA(sel) {
    if (_panelRoot) return _panelRoot.querySelectorAll(sel);
    return qsa(sel);
}

export function sortLtmByMsgOrder(ltmEntries, stmIndexMap) {
    if (!ltmEntries || ltmEntries.length < 2) return ltmEntries || [];
    return ltmEntries.slice().sort(function(a, b) {
        var aId = (a.stm_refs || [])[0];
        var bId = (b.stm_refs || [])[0];
        var aPos = (stmIndexMap[aId] && stmIndexMap[aId].absMsgStart !== undefined) ? stmIndexMap[aId].absMsgStart : Infinity;
        var bPos = (stmIndexMap[bId] && stmIndexMap[bId].absMsgStart !== undefined) ? stmIndexMap[bId].absMsgStart : Infinity;
        return aPos - bPos;
    });
}

export function freezeIframeHeight() {
    try { if (window.frameElement) { window.frameElement.style.height = '0px'; window.frameElement.style.minHeight = '0px'; } } catch (e) {}
}

export function setVaultActivity(active) {
    var el = panelById('narrative_vault_activity');
    if (!el) return;
    if (active) {
        el.innerHTML = '\u25e0';
        el.style.color = 'var(--ne-success)';
        el.style.animation = 'ne_spin 1s linear infinite';
    } else {
        el.innerHTML = '\u25cf';
        el.style.color = 'var(--ne-muted)';
        el.style.animation = '';
    }
}

export function injectPinCSS() {
    var exists = _panelRoot ? _panelRoot.getElementById('ne_pin_style') : byId('ne_pin_style');
    if (exists) return;
    var style = pdCreate('style');
    style.id = 'ne_pin_style';
    style.textContent = '@keyframes ne_spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}';
    if (_panelRoot) { _panelRoot.appendChild(style); } else { pdHead().appendChild(style); }
}

export function injectBottomDrawerCSS() {
    var exists = _panelRoot ? _panelRoot.getElementById('ne_vault_bottom_style') : byId('ne_vault_bottom_style');
    if (exists) exists.remove();
    var isShadow = !!_panelRoot;
    var hostSel = isShadow ? ':host' : '.ne-vault-bottom-overlay';
    var mobileSel = isShadow ? ':host(.ne-mobile)' : '.ne-vault-bottom-overlay.ne-mobile';
    var style = pdCreate('style');
    style.id = 'ne_vault_bottom_style';
    style.textContent =
        // ── 外壳规则（动态：hostSel / isShadow 运行时拼接）──
        hostSel + '{' +
        'all:initial;' + // 切断 ST 排版污染继承；all 不重置 custom properties，--ne-* 仍由 :root 穿透供血
        'display:none;flex-direction:column;flex-grow:1;min-height:0;overflow:hidden;' +
        'position:fixed;inset:0;z-index:35;background:transparent;' +
        'border-top:1px solid var(--ne-line);border-radius:var(--ne-radius-lg) var(--ne-radius-lg) 0 0;' +
        'transform:translateY(100%);pointer-events:none;' +
        'font-family:var(--ne-font);font-size:var(--mainFontSize,inherit);line-height:1.55;color:var(--ne-ink);' +
        'transition:transform var(--ne-transition-normal) var(--ne-easing-decelerate);}' +
        hostSel + '::before{' +
        'content:"";position:absolute;inset:0;z-index:-1;' +
        'background:var(--ne-panel-bg);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border-radius:inherit;}' +
        (isShadow ? ':host(.open){' : '.ne-vault-bottom-overlay.open{') +
        'display:flex;transform:translateY(0);pointer-events:auto;}' +
        // ── 响应式：mobileSel 前缀（动态）──
        mobileSel + '::before{backdrop-filter:none;-webkit-backdrop-filter:none;}' +
        mobileSel + ' .ne-vault-scroll-area{padding:0 var(--ne-space-sm) 60px;}' +
        mobileSel + ' .ne-vault-tab-bar{padding:0 var(--ne-space-sm) var(--ne-space-xs);}' +
        mobileSel + ' .ne-accordion-header{padding:var(--ne-space-sm) var(--ne-space-sm);font-size:var(--ne-text-base);}' +
        mobileSel + ' .ne-vault-collapse-bar{padding:var(--ne-space-sm) 0 var(--ne-space-xs);min-height:22px;}' +
        mobileSel + ' .ne-vault-tab{font-size:var(--ne-text-sm);padding:var(--ne-space-sm) 0;}' +
        (isShadow ? ':host{' : '.ne-vault-bottom-overlay{') + 'touch-action:manipulation;}' +
        // ── 自定义滚动条（动态：isShadow 宿主前缀；--ne-scroll-* 值由 tokens.css :root 单点供血，此处不再覆盖）──
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar{width:8px;height:8px;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar-track{background:var(--ne-scroll-track);border-radius:var(--ne-radius-sm);}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar-thumb{background:var(--ne-scroll-thumb);border-radius:var(--ne-radius-sm);' +
        'border:2px solid transparent;background-clip:padding-box;transition:background .15s;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar-thumb:hover{background:var(--ne-scroll-thumb-hover);background-clip:padding-box;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar-corner{background:transparent;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *{scrollbar-width:thin;scrollbar-color:var(--ne-scroll-thumb) var(--ne-scroll-track);}' +
        // ── 响应式：768px two-col -> stacked（动态：mobileSel 前缀）──
        mobileSel + ' .ne-template-grid{grid-template-columns:1fr;}' +
        // ── Mobile dual-zone switcher（动态：mobileSel 前缀 + media query）──
        '@media(max-width:499px){' + mobileSel + ' .ne-mobile-zone-switch{display:flex;gap:var(--ne-space-xs);margin-bottom:var(--ne-space-sm);}' +
        mobileSel + ' .ne-unified-section{display:none;}' +
        mobileSel + ' .ne-unified-section.ne-mobile-active{display:block;flex:1;overflow-y:auto;}' +
        mobileSel + ' .ne-mobile-zone-tab{flex:1;text-align:center;padding:var(--ne-space-sm) 0;cursor:pointer;font-size:var(--ne-text-sm);border-bottom:2px solid transparent;color:var(--ne-ink-soft);}' +
        mobileSel + ' .ne-mobile-zone-tab.active{color:var(--ne-ink);border-bottom-color:var(--ne-line);font-weight:bold;}}' +
        // ── 纯 class 规则（静态真源 panel.css，经 rollup cssString 内联；含 Toast/Confirm/Modal/Tooltip/Guide 等的非 shadow 同款）──
        panelCss;
    if (_panelRoot) { _panelRoot.appendChild(style); } else { pdHead().appendChild(style); }

    // Modal CSS must also be in PD.head (main document) since modals are appended to PD.body
    if (_panelRoot) {
        var modalStyleExists = PD.getElementById('ne_modal_style');
        if (!modalStyleExists) {
            var modalStyle = pdCreate('style');
            modalStyle.id = 'ne_modal_style';
            modalStyle.textContent =
                '.ne-modal-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;' +
                'background:var(--ne-surface-2);opacity:0;transition:opacity .15s;}' +
                '.ne-modal-overlay.show{opacity:1;}' +
                '.ne-modal{background:var(--ne-panel-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
                'border:1px solid var(--ne-line);border-radius:var(--ne-radius-lg);padding:var(--ne-space-lg) var(--ne-space-xl);min-width:300px;max-width:90vw;max-height:70vh;' +
                'display:flex;flex-direction:column;transform:scale(.9);transition:transform .2s cubic-bezier(0,0,0.2,1);}' +
                '.ne-modal-overlay.show .ne-modal{transform:scale(1);}' +
                '.ne-modal h3{font-size:var(--ne-text-lg);font-weight:bold;margin:0 0 var(--ne-space-md);}' +
                '.ne-modal-body{flex:1;overflow-y:auto;margin-bottom:var(--ne-space-md);}' +
                '.ne-modal-footer{display:flex;gap:var(--ne-space-sm);justify-content:flex-end;flex-shrink:0;}' +
                '.ne-modal *::-webkit-scrollbar{width:6px;height:6px;}' +
                '.ne-modal *::-webkit-scrollbar-track{background:transparent;}' +
                '.ne-modal *::-webkit-scrollbar-thumb{background:var(--ne-scroll-thumb);border-radius:var(--ne-radius-sm);}' +
                '.ne-modal *::-webkit-scrollbar-thumb:hover{background:var(--ne-scroll-thumb-hover);}' +
                '.ne-modal *{scrollbar-width:thin;scrollbar-color:var(--ne-scroll-thumb) transparent;}';
            pdHead().appendChild(modalStyle);
        }
    }

    // Design token variables must live in PD.head (:root) — custom properties inherit through the
    // shadow boundary from the host, so this also feeds shadow-root panels. Single source of truth:
    // src/ui/tokens.css（经 rollup cssString 内联），本处仅注入。
    if (!PD.getElementById('ne_vars_style')) {
        var varsStyle = pdCreate('style');
        varsStyle.id = 'ne_vars_style';
        varsStyle.textContent = tokensCss;
        pdHead().appendChild(varsStyle);
    }
    // 多主题：令牌注入后立即应用持久化主题（ne_settings.ui_theme；缺省 ne-dark）
    applyNeTheme(readNeTheme());
}

export var vaultLLMLog = [];
export var lastVaultStateJson = '{}';
export function setLastVaultStateJson(v) { lastVaultStateJson = v; }


// UIS-3: 命名 handler + 每次关闭前先移除，避免重复调用 closeVaultOverlay 累积 transitionend 监听
var _overlayHideTimer = null;
function _hideOverlayNow(overlay) {
    overlay.style.display = 'none';
    overlay.style.transition = '';
}
function _overlayTransitionDone(ev) {
    var overlay = ev.currentTarget;
    overlay.removeEventListener('transitionend', _overlayTransitionDone);
    if (_overlayHideTimer) { clearTimeout(_overlayHideTimer); _overlayHideTimer = null; }
    _hideOverlayNow(overlay);
}

export function closeVaultOverlay() {
    stopOverlayResizeWatcher();
    var overlay = byId('ne_vault_bottom_overlay');
    if (overlay) {
        overlay.classList.remove('open');
        overlay.style.pointerEvents = '';
        overlay.style.transform = 'translateY(100%)';
        overlay.removeEventListener('transitionend', _overlayTransitionDone);
        if (_overlayHideTimer) { clearTimeout(_overlayHideTimer); _overlayHideTimer = null; }
        _overlayHideTimer = setTimeout(function () {
            _overlayHideTimer = null;
            _hideOverlayNow(overlay);
        }, 600);
        overlay.addEventListener('transitionend', _overlayTransitionDone);
    }
}

// ── Overlay bounds syncing ──
var _overlayResizeHandler = null;

export function syncOverlayBounds() {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay) return;
    var sheld = byId('sheld');
    if (!sheld) return;
    var rect = sheld.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
}

export function startOverlayResizeWatcher() {
    if (_overlayResizeHandler) return;
    _overlayResizeHandler = function() { syncOverlayBounds(); };
    window.addEventListener('resize', _overlayResizeHandler);
}

export function stopOverlayResizeWatcher() {
    if (_overlayResizeHandler) {
        window.removeEventListener('resize', _overlayResizeHandler);
        _overlayResizeHandler = null;
    }
    // UIS-5: 一并断开挂载在 overlay 上的 ResizeObserver，避免关闭后继续观察/重复创建累积
    var overlay = byId('ne_vault_bottom_overlay');
    if (overlay && overlay._neResizeObserver) {
        try { overlay._neResizeObserver.disconnect(); } catch (e) {}
        overlay._neResizeObserver = null;
    }
}

// ── L3: Toast notification ──
var _toastTimer = null;
var _toastEl = null;
var _toastCssInjected = false;
function _ensureToastCss() {
    if (_toastCssInjected) return;
    _toastCssInjected = true;
    var style = pdCreate('style');
    style.id = 'ne_toast_style';
    style.textContent =
        '.ne-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);z-index:9999;' +
        'padding:var(--ne-space-md) var(--ne-space-xl);border-radius:var(--ne-radius-md);font-size:var(--ne-text-base);color:#fff;opacity:0;' +
        'transition:opacity .2s,transform .2s cubic-bezier(0,0,0.2,1);pointer-events:none;max-width:90vw;text-align:center;}' +
        '.ne-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}' +
        '.ne-toast.success{background:var(--ne-success);}' +
        '.ne-toast.error{background:var(--ne-danger);}' +
        '.ne-toast.warning{background:var(--ne-warning);color:#333;}' +
        '.ne-toast.info{background:var(--ne-info);}' +
        '.ne-confirm-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;' +
        'background:var(--ne-surface-2);opacity:0;transition:opacity .15s;}' +
        '.ne-confirm-overlay.show{opacity:1;}' +
        '.ne-confirm-dialog{background:var(--ne-panel-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
        'border:1px solid var(--ne-line);border-radius:var(--ne-radius-lg);padding:var(--ne-space-xl) var(--ne-space-2xl);min-width:280px;max-width:90vw;' +
        'transform:scale(.9);transition:transform .2s cubic-bezier(0,0,0.2,1);}' +
        '.ne-confirm-overlay.show .ne-confirm-dialog{transform:scale(1);}' +
        '.ne-confirm-title{font-size:var(--ne-text-xl);font-weight:bold;margin-bottom:var(--ne-space-sm);}' +
        '.ne-confirm-message{font-size:var(--ne-text-base);color:var(--ne-ink-soft);margin-bottom:var(--ne-space-lg);line-height:1.55;}' +
        '.ne-confirm-actions{display:flex;gap:var(--ne-space-sm);justify-content:flex-end;}' +
        '.ne-confirm-btn{padding:var(--ne-space-sm) var(--ne-space-xl);border-radius:var(--ne-radius-sm);border:1px solid var(--ne-line);' +
        'background:var(--ne-surface-1);color:var(--ne-ink);cursor:pointer;font-size:var(--ne-text-base);transition:background var(--ne-transition-fast);}' +
        '.ne-confirm-btn:hover{background:var(--ne-surface-2);}' +
        '.ne-confirm-btn.danger{background:var(--ne-danger);border-color:var(--ne-danger);color:#fff;}' +
        '.ne-confirm-btn.danger:hover{background:#c62828;}' +
        // P2-G1: 触屏主输入设备下 confirm 变底部弹层（bottom sheet）
        '@media (pointer:coarse){' +
        '.ne-confirm-overlay{align-items:flex-end;}' +
        '.ne-confirm-dialog{width:100%;max-width:520px;margin:0;min-width:0;' +
        'border-radius:var(--ne-radius-lg) var(--ne-radius-lg) 0 0;' +
        'padding-bottom:calc(var(--ne-space-xl) + env(safe-area-inset-bottom,0px));' +
        'transform:translateY(100%);transition:transform .25s cubic-bezier(0,0,0.2,1);}' +
        '.ne-confirm-overlay.show .ne-confirm-dialog{transform:translateY(0);}' +
        '}';
    pdHead().appendChild(style);
}

export function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    // 优先 ST 原生 toastr（主窗口全局可用，样式与 ST 生态一致）
    var toastr = null;
    try {
        toastr = (typeof window !== 'undefined' && window.toastr) || (window.parent && window.parent.toastr) || null;
    } catch (e) {}
    if (toastr) {
        var method = type === 'warn' ? 'warning' : type;
        if (typeof toastr[method] === 'function') {
            toastr[method](message, null, { timeOut: duration });
            return;
        }
    }
    // 降级：自建 DOM toast（iframe / toastr 缺失场景）
    _ensureToastCss();
    if (!_toastEl) {
        _toastEl = pdCreate('div');
        _toastEl.className = 'ne-toast';
        _toastEl.setAttribute('aria-live', 'polite');
        pdBody().appendChild(_toastEl);
    }
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastEl.className = 'ne-toast ' + type;
    _toastEl.textContent = message;
    requestAnimationFrame(function() { _toastEl.classList.add('show'); });
    _toastTimer = setTimeout(function() {
        _toastEl.classList.remove('show');
        _toastTimer = null;
    }, duration);
}

// ── L3: Confirm dialog ──
export function showConfirm(title, message, confirmLabel, cancelLabel, isDanger) {
    _ensureToastCss();
    confirmLabel = confirmLabel || 'OK';
    cancelLabel = cancelLabel || 'Cancel';
    return new Promise(function(resolve) {
        var overlay = pdCreate('div');
        overlay.className = 'ne-confirm-overlay';
        var dangerClass = isDanger ? ' danger' : '';
        overlay.innerHTML =
            '<div class="ne-confirm-dialog">' +
            '<div class="ne-confirm-title">' + escapeHtml(title) + '</div>' +
            '<div class="ne-confirm-message">' + escapeHtml(message) + '</div>' +
            '<div class="ne-confirm-actions">' +
            '<button class="ne-confirm-btn" id="ne-confirm-cancel">' + escapeHtml(cancelLabel) + '</button>' +
            '<button class="ne-confirm-btn' + dangerClass + '" id="ne-confirm-ok">' + escapeHtml(confirmLabel) + '</button>' +
            '</div></div>';
        pdBody().appendChild(overlay);

        function escHandler(e) {
            if (e.key === 'Escape') close(false);
        }
        function close(val) {
            // UIS-1: 任何关闭路径都移除 Esc 监听，避免每次弹窗残留一个
            document.removeEventListener('keydown', escHandler);
            overlay.classList.remove('show');
            // UIS-7: transitionend 驱动移除 + 超时兜底 —— 若弹窗 CSS transition 被主题/
            // 样式覆盖禁用（transition:none 等），transitionend 永不触发，原实现 Promise 永久
            // 挂起 → 确认后的删除/保存代码不执行，用户看到"点了没反应"
            var fallback = setTimeout(function() {
                overlay.removeEventListener('transitionend', done);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(val);
            }, 300);
            function done() {
                clearTimeout(fallback);
                overlay.removeEventListener('transitionend', done);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(val);
            }
            overlay.addEventListener('transitionend', done);
        }

        overlay.querySelector('#ne-confirm-ok').addEventListener('click', function() { close(true); });
        overlay.querySelector('#ne-confirm-cancel').addEventListener('click', function() { close(false); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(false); });
        document.addEventListener('keydown', escHandler);

        requestAnimationFrame(function() { overlay.classList.add('show'); });
    });
}

export var _updatingPopout = false;
export var _currentGetChatId = null;
export var _vaultChangeBound = false;

// ── Tooltip system (G6) ──
var _tooltipTimer = null;
var _tooltipEl = null;

export function showTooltip(triggerEl, text) {
    if (!triggerEl || !text) return;
    _tooltipTimer = setTimeout(function () {
        hideTooltip();
        _tooltipEl = PD.createElement('div');
        _tooltipEl.className = 'ne-tooltip';
        _tooltipEl.textContent = text;
        PD.body.appendChild(_tooltipEl);
        var rect = triggerEl.getBoundingClientRect();
        _tooltipEl.style.left = rect.left + 'px';
        _tooltipEl.style.top = (rect.bottom + 6) + 'px';
        // Force reflow then show
        _tooltipEl.offsetHeight;
        _tooltipEl.classList.add('visible');
    }, 1500);
}

export function hideTooltip() {
    if (_tooltipTimer) { clearTimeout(_tooltipTimer); _tooltipTimer = null; }
    if (_tooltipEl) {
        if (_tooltipEl.parentNode) _tooltipEl.parentNode.removeChild(_tooltipEl);
        _tooltipEl = null;
    }
}

// ── Help card (G7) ──
export function showHelpCard(relativeToEl, title, body) {
    if (!relativeToEl) return;
    hideHelpCard();
    var card = PD.createElement('div');
    card.className = 'ne-help-card';
    card.innerHTML = '<div class="ne-help-card-header">' +
        '<span class="ne-help-card-title">' + title + '</span>' +
        '<span class="ne-help-card-close">\u2715</span>' +
        '</div>' +
        '<div class="ne-help-card-body">' + body + '</div>';
    PD.body.appendChild(card);
    // UIS-2: 统一关闭路径（X 按钮 / 外部点击 / hideHelpCard），确保外部点击监听一并移除
    function closeCard() {
        if (!card.parentNode) return;
        card.remove();
        if (card.__ne_outsideHandler) {
            PD.removeEventListener('click', card.__ne_outsideHandler, true);
            card.__ne_outsideHandler = null;
        }
    }
    card.querySelector('.ne-help-card-close').addEventListener('click', closeCard);
    var outsideHandler = function (e) {
        if (!card.parentNode) { PD.removeEventListener('click', outsideHandler, true); return; }
        if (!card.contains(e.target) && e.target !== relativeToEl) closeCard();
    };
    card.__ne_outsideHandler = outsideHandler;
    setTimeout(function () {
        PD.addEventListener('click', outsideHandler, true);
    }, 0);
    var rect = relativeToEl.getBoundingClientRect();
    card.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
    card.style.top = (rect.bottom + 4) + 'px';
    return card;
}

function hideHelpCard() {
    var existing = PD.querySelector('.ne-help-card');
    if (existing) {
        if (existing.__ne_outsideHandler) PD.removeEventListener('click', existing.__ne_outsideHandler, true);
        existing.remove();
    }
}

// ── Guide banner (G3) ──
export function showGuideBanner(container, text, storageKey) {
    if (!container) return;
    if (storageKey && localStorage[storageKey] === '1') return;
    var banner = pdCreate('div');
    banner.className = 'ne-guide-banner';
    banner.innerHTML = '<div class="ne-guide-banner-body">' + text + '</div>' +
        '<span class="ne-guide-banner-close" title="' + (typeof t === 'function' ? t('Close') : 'Close') + '">\u2715</span>';
    var closeBtn = banner.querySelector('.ne-guide-banner-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function () {
            banner.remove();
            if (storageKey) {
                try { localStorage.setItem(storageKey, '1'); } catch (e) {}
            }
        });
    }
    container.prepend(banner);
    return banner;
}

// ── Tooltip / Help / Guide CSS (injected to PD for PD.body elements) ──
(function () {
    if (PD.getElementById('ne_tooltip_style')) return;
    var style = pdCreate('style');
    style.id = 'ne_tooltip_style';
    style.textContent = '' +
        '.ne-tooltip{position:fixed;z-index:9999;max-width:260px;padding:var(--ne-space-sm) var(--ne-space-md);background:var(--black90a,rgba(0,0,0,0.9));color:var(--text,#fff);font-size:var(--ne-text-sm);border-radius:var(--ne-radius-md);line-height:1.4;pointer-events:none;opacity:0;transition:opacity 0.15s;}' +
        '.ne-tooltip.visible{opacity:1;}' +
        '.ne-help-card{position:fixed;z-index:9998;min-width:280px;max-width:340px;background:var(--ne-surface-1);border:1px solid var(--ne-line);border-radius:var(--ne-radius-md);box-shadow:var(--ne-shadow-md);font-size:var(--ne-text-sm);line-height:1.55;color:var(--ne-ink);}' +
        '.ne-help-card-header{display:flex;justify-content:space-between;align-items:center;padding:var(--ne-space-sm) var(--ne-space-md);border-bottom:1px solid var(--ne-line);font-weight:bold;font-size:var(--ne-text-base);}' +
        '.ne-help-card-close{cursor:pointer;opacity:0.5;font-size:var(--ne-text-xl);}' +
        '.ne-help-card-close:hover{opacity:1;}' +
        '.ne-help-card-body{padding:var(--ne-space-sm) var(--ne-space-md);max-height:260px;overflow-y:auto;}' +
        '.ne-guide-banner{background:var(--ne-info-bg);border:1px solid var(--ne-info-border);border-radius:var(--ne-radius-md);padding:var(--ne-space-md) var(--ne-space-3xl) var(--ne-space-md) var(--ne-space-md);margin-bottom:var(--ne-space-md);font-size:var(--ne-text-sm);color:var(--ne-ink);position:relative;}' +
        '.ne-guide-banner-close{position:absolute;top:6px;right:8px;cursor:pointer;opacity:0.5;font-size:var(--ne-text-base);}' +
        '.ne-guide-banner-close:hover{opacity:1;}';
    pdHead().appendChild(style);
})();

// ── L3: Empty state helper ──
export function emptyStateHtml(icon, text, hint) {
    return '<div class="ne-empty-state">' +
        (icon ? '<div class="ne-empty-state-icon">' + icon + '</div>' : '') +
        '<div class="ne-empty-state-text">' + text + '</div>' +
        (hint ? '<div class="ne-empty-state-hint">' + hint + '</div>' : '') +
        '</div>';
}

export function setUpdatingPopout(v) { _updatingPopout = v; }
export function setCurrentGetChatId(v) { _currentGetChatId = v; }
export function setVaultChangeBound(v) { _vaultChangeBound = v; }

// ── StateBus bridge ──
import { on as busOn, off as busOff, emit as busEmit } from './stateBus.js';
export { busOn, busOff, busEmit };
