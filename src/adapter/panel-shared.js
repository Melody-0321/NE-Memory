import { t_narrative, t_field, setFieldLocale } from '../core/i18n.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { isStateSchemaEnabled } from '../core/vault/schema.js';

export function t(key) { return t_narrative(key); }

export var PD;
try {
    PD = window.__NE_EXTENSION_MODE ? document : (window.parent.document || document);
} catch(e) { PD = document; }
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
        el.innerHTML = '&#9696;';
        el.style.color = 'var(--ne-success)';
        el.style.animation = 'ne_spin 1s linear infinite';
    } else {
        el.innerHTML = '&#9679;';
        el.style.color = '#888';
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
    style.textContent = hostSel + '{' +
        'display:none;flex-direction:column;flex-grow:1;min-height:0;overflow:hidden;' +
        'position:fixed;inset:0;z-index:35;background:transparent;' +
        'border-top:1px solid var(--SmartThemeBorderColor);border-radius:12px 12px 0 0;' +
        'transform:translateY(100%);pointer-events:none;' +
        'transition:transform var(--ne-transition-normal) var(--ne-easing-decelerate);}' +
        hostSel + '::before{' +
        'content:"";position:absolute;inset:0;z-index:-1;' +
        'background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border-radius:inherit;}' +
        (isShadow ? ':host(.open){' : '.ne-vault-bottom-overlay.open{') +
        'display:flex;transform:translateY(0);pointer-events:auto;}' +
        '.ne-vault-collapse-bar{flex-shrink:0;display:flex;justify-content:center;align-items:center;' +
        'padding:10px 0 6px;cursor:pointer;min-height:28px;}' +
        '.ne-vault-collapse-indicator{width:48px;height:5px;background:var(--SmartThemeBorderColor);' +
        'border-radius:3px;opacity:.6;transition:opacity .2s;}' +
        '.ne-vault-collapse-bar:hover .ne-vault-collapse-indicator{opacity:1;}' +
        '.ne-vault-collapse-chevron{margin-left:4px;color:var(--SmartThemeBorderColor);font-size:10px;opacity:.6;}' +
        '.ne-vault-scroll-area{flex:1;overflow-y:auto;overflow-x:hidden;padding:0 12px 12px;min-height:0;}' +
        '.ne-vault-pin-row{display:flex;align-items:center;padding:0 0 8px;min-height:24px;}' +
        '.ne-summary-only-notice{display:flex;align-items:flex-start;gap:8px;margin:0 12px 4px;padding:8px 10px;border:1px solid var(--ne-warning,var(--yellow40,#e6a817));border-radius:6px;background:var(--black20a);box-shadow:inset 3px 0 0 var(--ne-warning,var(--yellow40,#e6a817));}' +
        '.ne-summary-only-icon{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--ne-warning,var(--yellow40,#e6a817));border-radius:4px;color:var(--ne-warning,var(--yellow40,#e6a817));font-size:13px;}' +
        '.ne-summary-only-copy{min-width:0;}' +
        '.ne-summary-only-copy strong{display:block;color:var(--ne-warning,var(--yellow40,#e6a817));font-size:0.82em;line-height:1.3;}' +
        '.ne-summary-only-copy p{margin:2px 0 0;color:var(--grey50,#888);font-size:0.7em;line-height:1.45;}' +
        '.ne-vault-tab-bar{display:flex;gap:2px;padding:0 12px 6px;border-bottom:1px solid var(--SmartThemeBorderColor);margin-bottom:4px;}' +
        '.ne-vault-tab{flex:1;text-align:center;padding:8px 0;cursor:pointer;font-size:0.9em;color:var(--grey-70);border-bottom:2px solid transparent;transition:color .15s,border-color .15s;user-select:none;}' +
        '.ne-vault-tab:hover{color:var(--text,#ddd);}' +
        '.ne-vault-tab.active{color:var(--text,#fff);border-bottom-color:var(--SmartThemeBorderColor);font-weight:bold;}' +
        '.ne-vault-tab-content{display:none;}' +
        '.ne-vault-tab-content.active{display:block;}' +
        '.ne-quick-index{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:4px;padding:4px 12px;margin-bottom:6px;background:var(--SmartThemeBlurTintColor);border-radius:0 0 6px 6px;}' +
        '.ne-index-item{font-size:0.78em;padding:2px 8px;cursor:pointer;border-radius:4px;background:var(--black30a);color:var(--grey-70);white-space:nowrap;transition:background .15s,color .15s;}' +
        '.ne-index-item:hover{background:var(--black50a);color:var(--text,#ddd);}' +
        '.ne-index-item em{font-style:normal;font-weight:bold;color:var(--grey-50);margin-left:2px;}' +
        '.ne-index-item.ne-index-empty{background:transparent;color:var(--grey-30);cursor:default;border:1px dashed var(--grey-30);}' +
        '.ne-index-item.ne-index-empty:hover{background:transparent;color:var(--grey-30);}' +
        '.ne-accordion{margin-bottom:4px;}' +
        '.ne-accordion-header{display:flex;align-items:center;padding:8px 12px;cursor:pointer;user-select:none;background:var(--black30a);border-radius:6px;font-weight:bold;font-size:0.95em;transition:background .15s;}' +
        '.ne-accordion-header:hover{background:var(--black50a);}' +
        '.ne-accordion-chevron{margin-right:8px;font-size:0.7em;transition:transform .2s;color:var(--grey-50);display:inline-block;}' +
        '.ne-accordion.open>.ne-accordion-header .ne-accordion-chevron{transform:rotate(90deg);}' +
        '.ne-accordion-body{display:none;padding:4px 0 4px 12px;}' +
        '.ne-accordion.open>.ne-accordion-body{display:block;}' +
        '.ne-accordion-body .ne-accordion-header{background:transparent;font-weight:normal;font-size:0.9em;padding:6px 8px;border-left:3px solid transparent;border-radius:0;}' +
        '.ne-accordion-body .ne-accordion.open>.ne-accordion-header{border-left-color:var(--SmartThemeBorderColor);}' +
        '.ne-accordion-highlight{box-shadow:0 0 0 2px var(--SmartThemeBorderColor)!important;}' +
        '.ne-tr-container{padding:4px 0;font-size:0.85em;}' +
        '.ne-tr-select{width:100%;background:var(--black30a);color:var(--text);border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:4px 6px;font-size:0.9em;margin-bottom:6px;}' +
        '.ne-tr-actions{display:flex;gap:4px;margin-bottom:6px;}' +
        '.ne-tr-btn{flex:1;padding:4px 8px;font-size:0.85em;line-height:1.4;border-radius:4px;border:1px solid var(--SmartThemeBorderColor);background:var(--black30a);color:var(--text);cursor:pointer;text-align:center;-webkit-appearance:none;appearance:none;font-family:inherit;}' +
        '.ne-tr-btn:hover{background:var(--black50a);color:var(--text);}' +
        '.ne-tr-btn:disabled{opacity:0.5;cursor:not-allowed;}' +
        '.ne-tr-btn.ok{background:var(--ne-success);border-color:var(--ne-success);color:#fff;}' +
        '.ne-tr-btn.ok:hover{background:#388e3c;}' +
        '.ne-tr-status{padding:4px 0;min-height:1.2em;font-size:0.9em;color:var(--grey-50);}' +
        '.ne-tr-status.running{color:var(--text);}' +
        '.ne-tr-result{padding:4px 0;}' +
        '.ne-tr-result-header{font-weight:bold;margin:6px 0 2px;display:flex;align-items:center;gap:6px;}' +
        '.ne-tr-result-entry{padding:2px 0 2px 12px;display:flex;align-items:center;gap:4px;font-size:0.9em;}' +
        '.ne-tr-pass{color:var(--ne-success);font-weight:bold;}' +
        '.ne-tr-fail{color:var(--ne-danger);font-weight:bold;}' +
        '.ne-tr-semantic{margin-top:4px;padding:4px 8px;border-left:3px solid var(--SmartThemeBorderColor);font-size:0.85em;}' +
        '.ne-tr-trace{display:none;margin-top:6px;padding:6px;background:var(--black20a);border-radius:4px;font-family:monospace;font-size:0.75em;white-space:pre-wrap;max-height:300px;overflow-y:auto;}' +
        '.ne-tr-trace.open{display:block;}' +
        '.ne-tr-smoke-section{border:1px dashed var(--SmartThemeBorderColor);border-radius:6px;padding:6px;margin-bottom:8px;background:var(--black10a);}' +
        '.ne-tr-smoke-label{font-size:0.85em;font-weight:bold;margin-bottom:4px;color:var(--text);display:flex;align-items:center;gap:4px;}' +
        '.ne-tr-slider-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:0.85em;}' +
        '.ne-tr-slider{flex:1;height:6px;-webkit-appearance:none;appearance:none;background:var(--black30a);border-radius:3px;outline:none;}' +
        '.ne-tr-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--SmartThemeQuoteColor);cursor:pointer;}' +
        '.ne-tr-slider-value{min-width:2em;text-align:right;font-weight:bold;}' +
        '.ne-usage-section{margin-bottom:12px;}' +
        '.ne-usage-section-title{font-size:0.9em;font-weight:bold;margin-bottom:6px;color:var(--text);}' +
        '.ne-usage-cards{display:flex;gap:8px;margin-bottom:6px;}' +
        '.ne-usage-card{flex:1;border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px 10px;background:var(--black10a);}' +
        '.ne-usage-card-value{font-size:1.1em;font-weight:bold;}' +
        '.ne-usage-card-sub{font-size:0.75em;color:var(--grey-50);margin-top:2px;}' +
        '.ne-usage-chart-wrap{max-width:100%;height:200px;margin-top:4px;}' +
        '.ne-usage-chart-wrap-tall{max-width:100%;height:280px;margin-top:4px;}' +
        '.ne-usage-chat-table{width:100%;font-size:0.82em;border-collapse:collapse;}' +
        '.ne-usage-chat-table th{text-align:left;padding:4px 6px;border-bottom:1px solid var(--SmartThemeBorderColor);color:var(--grey-50);}' +
        '.ne-usage-chat-table td{padding:4px 6px;border-bottom:1px solid var(--black20a);}' +
        '.ne-usage-chat-table tr{cursor:pointer;}' +
        '.ne-usage-chat-table tr:hover{background:var(--black10a);}' +
        '.ne-usage-loading{text-align:center;padding:20px;color:var(--grey-50);}' +
        '.ne-tr-export-bar{display:flex;gap:4px;margin-top:6px;}' +
        '.narrative_ltm_toggle{display:inline-block;transition:transform .2s;font-size:0.7em;color:var(--grey-50);cursor:pointer;}' +
        '.narrative_ltm_toggle.expanded{transform:rotate(90deg);}' +
        '.narrative_ltm_detail{display:none;}' +
        '.narrative_ltm_detail.expanded{display:table-row!important;}' +
        '.narrative_ltm_detail .narrative_ltm_detail_container{border-left:3px solid transparent;padding-left:8px;transition:border-color .2s;}' +
        '.narrative_ltm_detail.expanded .narrative_ltm_detail_container{border-left-color:var(--SmartThemeBorderColor);}' +
        '.narrative_ltm_sub_table{width:100%;border-collapse:collapse;font-size:0.85em;margin:4px 0;}' +
        '.narrative_ltm_sub_table tr:nth-child(even){background:var(--black10a);}' +
        '.narrative_ltm_sub_table td{padding:2px 6px;}' +
        '.ne-orphan-group-row td{border-top:1px dashed var(--SmartThemeBorderColor);border-bottom:1px dashed var(--SmartThemeBorderColor);}' +
        '.ne-inline-edit-btn{font-size:0.75em;cursor:pointer;opacity:0.4;padding:0 3px;transition:opacity .15s;}' +
        '.ne-inline-edit-btn:hover{opacity:1;}' +
        '.ne-inline-row td{padding:2px 4px!important;}' +
        '.ne-inline-row input,.ne-inline-row textarea{width:100%;background:#fff;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:3px 6px;border-radius:3px;font-size:0.85em;font-family:inherit;text-shadow:none !important;}' +
        '.ne-inline-save,.ne-inline-cancel,.ne-inline-delete{font-size:0.75em;padding:1px 6px;cursor:pointer;border-radius:3px;margin:0 2px;}' +
        '.ne-inline-save{background:var(--ne-success);color:#fff;border:none;}' +
        '.ne-settings-section{margin-bottom:8px;}' +
        '#tab-settings .ne-accordion-body{padding:8px 12px;}' +
        '#tab-settings label, .ne-slide-panel label{display:block;padding:6px 0;font-size:0.9em;color:var(--text);cursor:pointer;}' +
        '#tab-settings input[type=text],#tab-settings input[type=password],#tab-settings input[type=number],' +
        '.ne-slide-panel input[type=text],.ne-slide-panel input[type=password],.ne-slide-panel input[type=number]{' +
        'width:100%;background:#fff !important;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:6px 10px;border-radius:4px;margin:2px 0 8px;font-size:0.9em;text-shadow:none !important;}' +
        '#tab-settings input::placeholder{color:#999 !important;opacity:1 !important;-webkit-text-fill-color:#999 !important;}' +
        '.ne-slide-panel input::placeholder,.ne-slide-panel textarea::placeholder{color:#999 !important;opacity:1 !important;-webkit-text-fill-color:#999 !important;}' +
        '#tab-settings textarea,.ne-slide-panel textarea{width:100%;background:#fff !important;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:6px 10px;border-radius:4px;margin:2px 0 8px;font-family:monospace;font-size:0.8em;resize:vertical;text-shadow:none !important;}' +
        '#tab-settings input[type=range]{width:100%;margin:4px 0;-webkit-appearance:none;appearance:none;height:5px;background:var(--SmartThemeBodyColor);border-radius:15px;box-shadow:inset 0 0 2px black;cursor:ew-resize;filter:brightness(0.75);}' +
        '#tab-settings input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;height:15px;width:15px;border-radius:50%;background:var(--SmartThemeCheckboxTickColor);border:2px solid var(--SmartThemeBodyColor);}' +
        '#tab-settings input[type=range]::-moz-range-thumb{height:15px;width:15px;border-radius:50%;background:var(--SmartThemeCheckboxTickColor);border:2px solid var(--SmartThemeBodyColor);box-sizing:border-box;}' +
        '#tab-settings input[type=range]::-moz-range-track{height:5px;background:var(--SmartThemeBodyColor);border-radius:15px;box-shadow:inset 0 0 2px black;}' +
        '#tab-settings input[type=range]:hover{filter:brightness(1.25);}' +
        '#tab-settings input[type=range]:focus-visible{outline:1px solid var(--interactable-outline-color);}' +
        '#tab-settings .range-val{font-size:0.8em;color:var(--grey-50);margin-left:6px;}' +
        '.ne-state-card-table{width:100%;border-collapse:collapse;font-size:0.85em;}' +
        '.ne-state-card-table td{padding:2px 6px;vertical-align:middle;}' +
        '.ne-state-card-table td:first-child{color:var(--grey-50);width:85px;text-align:right;white-space:nowrap;}' +
        '.ne-state-badge{display:inline-block;padding:1px 7px;border-radius:3px;font-size:0.78em;font-weight:bold;}' +
        '.ne-state-badge.active{background:var(--ne-success-bg);color:var(--ne-success);border:1px solid var(--ne-success-border);}' +
        '.ne-state-badge.inactive{background:var(--ne-warning-bg);color:var(--ne-warning);border:1px solid var(--ne-warning-border);}' +
        '.ne-state-badge.departed{background:var(--ne-danger-bg);color:var(--ne-danger);border:1px solid var(--ne-danger-border);}' +
        '.ne-state-badge.friendly{background:var(--ne-success-bg);color:var(--ne-success);border:1px solid var(--ne-success-border);}' +
        '.ne-state-badge.hostile{background:var(--ne-danger-bg);color:var(--ne-danger);border:1px solid var(--ne-danger-border);}' +
        '.ne-state-badge.neutral{background:var(--ne-warning-bg);color:var(--ne-warning);border:1px solid var(--ne-warning-border);}' +
        '.ne-state-badge.suspense-open{background:var(--ne-success-bg);color:var(--ne-success);border:1px solid var(--ne-success-border);}' +
        '.ne-state-badge.suspense-resolved{background:var(--black50a);color:var(--ne-muted);border:1px solid var(--grey-50);}' +
        '.ne-state-badge.suspense-abandoned{background:var(--black50a);color:var(--grey-50);border:1px solid var(--grey-50);}' +
        '.ne-state-badge.cat-mystery{background:var(--black30a);color:var(--ne-info);border:1px solid var(--ne-info);}' +
        '.ne-state-badge.cat-threat{background:var(--black30a);color:var(--ne-danger);border:1px solid var(--ne-danger);}' +
        '.ne-state-badge.cat-promise{background:var(--black30a);color:#e2b714;border:1px solid #e2b714;}' +
        '.ne-state-badge.cat-foreshadow{background:var(--black30a);color:#a855f7;border:1px solid #a855f7;}' +
        '.ne-char-card{margin:4px 0;padding:8px 10px;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);border-left:3px solid var(--SmartThemeBorderColor);border-radius:6px;}' +
        '.ne-char-card.status-active{border-left-color:var(--ne-success);}' +
        '.ne-char-card.status-inactive{border-left-color:var(--ne-warning);}' +
        '.ne-char-card.status-departed{border-left-color:var(--ne-danger);}' +
        '.ne-char-card-header{display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.92em;}' +
        '.ne-char-toggle { display: inline-block; transition: transform 0.2s; font-size: 10px; margin-right: 4px; }' +
        '.ne-char-card.open .ne-char-toggle { transform: rotate(90deg); }' +
        '.ne-char-card-body { display: none; }' +
        '.ne-char-card.open .ne-char-card-body { display: block; }' +
        '.ne-char-card-detail { display: none; }' +
        '.ne-char-card.open .ne-char-card-detail { display: block; }' +
        '.ne-char-card-detail .ne-char-card-detail-row{margin:2px 0;}' +
        '.ne-state-global-block{background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px 10px;margin-bottom:8px;}' +
        '.ne-state-global-block .ne-state-global-table{width:100%;border-collapse:collapse;font-size:0.88em;}' +
        '.ne-state-global-block .ne-state-global-table td{padding:3px 6px;vertical-align:middle;}' +
        '.ne-state-global-block .ne-state-global-table td:first-child{color:var(--grey-50);width:80px;text-align:right;white-space:nowrap;}' +
        '.ne-faction-card{margin:4px 0;padding:8px 10px;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);border-left:3px solid var(--SmartThemeBorderColor);border-radius:6px;}' +
        '.ne-faction-card.attitude-friendly{border-left-color:var(--ne-success);}' +
        '.ne-faction-card.attitude-hostile{border-left-color:var(--ne-danger);}' +
        '.ne-faction-card.attitude-neutral{border-left-color:var(--ne-warning);}' +
        '.ne-faction-card-header{display:flex;align-items:center;gap:6px;cursor:pointer;}' +
        '.ne-faction-card-header .ne-faction-toggle{font-size:0.75em;color:var(--grey-50);transition:transform .2s;}' +
        '.ne-faction-card.open>.ne-faction-card-header .ne-faction-toggle{transform:rotate(90deg);}' +
        '.ne-faction-card-body{padding-top:4px;}' +
        '.ne-faction-card-detail{display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;}' +
        '.ne-faction-card.open>.ne-faction-card-detail{display:block;}' +
        '.ne-faction-card.ne-faction-hidden{opacity:0.55;border-left-color:#555;}' +
        '.ne-faction-card.ne-faction-hidden:hover{opacity:0.85;}' +
        '.ne-quest-card{margin:4px 0;padding:8px 10px;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);border-left:3px solid var(--SmartThemeBorderColor);border-radius:6px;cursor:pointer;}' +
        '.ne-quest-card.status-progress{border-left-color:var(--ne-info);}' +
        '.ne-quest-card.status-done{border-left-color:var(--ne-success);}' +
        '.ne-quest-card.status-failed{border-left-color:var(--ne-danger);}' +
        '.ne-quest-card.status-expired{border-left-color:var(--ne-warning);}' +
        '.ne-quest-header{display:flex;align-items:center;gap:6px;}' +
        '.ne-quest-toggle{font-size:0.8em;}' +
        '.ne-quest-detail{display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;}' +
        '.ne-quest-card.open>.ne-quest-detail{display:block;}' +
        '.ne-suspense-card{margin:4px 0;padding:8px 10px;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);border-left:3px solid var(--SmartThemeBorderColor);border-radius:6px;cursor:pointer;}' +
        '.ne-suspense-card.cat-mystery{border-left-color:var(--ne-info);}' +
        '.ne-suspense-card.cat-threat{border-left-color:var(--ne-danger);}' +
        '.ne-suspense-card.cat-promise{border-left-color:#e2b714;}' +
        '.ne-suspense-card.cat-foreshadow{border-left-color:#a855f7;}' +
        '.ne-suspense-card.status-resolved,.ne-suspense-card.status-abandoned{opacity:0.65;}' +
        '.ne-suspense-header{display:flex;align-items:center;gap:6px;}' +
        '.ne-suspense-detail{display:none;margin-top:4px;padding-top:4px;border-top:1px solid var(--black50a);font-size:0.83em;}' +
        '.ne-suspense-card.open>.ne-suspense-detail{display:block;}' +
        '.ne-suspense-meta{color:var(--grey-50);font-size:0.78em;margin-top:3px;}' +
        '.ne-suspense-resolution{color:var(--grey-50);font-style:italic;margin-top:4px;padding:4px 6px;background:var(--black10a);border-radius:3px;}' +
        '.ne-settings-save-btn{margin-top:12px;padding:8px 24px;background:var(--black50a);color:var(--text);border:1px solid var(--SmartThemeBorderColor);border-radius:4px;cursor:pointer;font-size:0.95em;}' +
        '.ne-settings-save-btn:hover{background:var(--black70a);}' +
        '.ne-settings-cascade{margin-left:16px;padding-left:8px;border-left:2px solid var(--black30a);}' +
        '.ne-inline-state-edit-btn{margin-left:6px;font-size:0.75em;cursor:pointer;opacity:0.5;transition:opacity .15s;}' +
        '.ne-inline-state-edit-btn:hover{opacity:1;}' +
        '.ne-inline-state-edit-area{display:none;margin-top:6px;}' +
        '.ne-inline-state-edit-area.active{display:block;}' +
        '.ne-inline-state-edit-area textarea{width:100%;min-height:120px;background:#fff;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:6px 10px;border-radius:4px;font-family:monospace;font-size:0.85em;text-shadow:none !important;}' +
        '.ne-inline-state-view.hidden{display:none;}' +
        '.ne-tool-card{background:var(--black20a);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px 12px;margin-bottom:8px;}' +
        '.ne-tool-card-title{font-weight:bold;font-size:0.85em;color:var(--grey-70);margin-bottom:8px;}' +
        '.ne-btn-warning{background:var(--ne-warning-bg)!important;border-color:var(--ne-warning-border)!important;color:var(--ne-warning)!important;}' +
        '.ne-btn-danger{background:var(--ne-danger-bg)!important;border-color:var(--ne-danger-border)!important;color:var(--ne-danger)!important;}' +
        '.ne-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;}' +
        '.ne-settings-grid input, .ne-settings-grid select, .ne-settings-grid textarea{width:100%;padding:6px 10px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--text);font-size:0.9em;box-sizing:border-box;}' +
        '.ne-settings-grid>.ne-settings-full{grid-column:1/-1;}' +
        '.ne-seg-btn{flex:1;padding:5px 6px;cursor:pointer;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--SmartThemeBodyColor);font-size:0.8em;text-align:center;}' +
        '.ne-seg-btn:hover{border-color:var(--SmartThemeBorderColor);color:var(--text);}' +
        '.ne-seg-btn.active{background:var(--ne-success);border-color:var(--ne-success);color:#fff;font-weight:bold;}' +
        '.ne-settings-cascade-card{background:var(--black10a);border-left:3px solid var(--SmartThemeBorderColor);border-radius:0 4px 4px 0;padding:4px 8px;margin-left:12px;margin-top:4px;}' +
        '.ne-settings-toggle-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;padding:6px 8px;background:var(--black10a);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;margin:4px 0 6px;}' +
        '.ne-settings-toggle-grid label{padding:3px 0 !important;font-size:0.85em !important;}' +
        '.ne-api-status{display:flex;align-items:center;gap:6px;margin:4px 0;font-size:0.85em;}' +
        '.ne-api-dot{width:10px;height:10px;border-radius:50%;display:inline-block;background:#cc3333;}' +
        '.ne-api-dot.ok{background:var(--ne-success);}' +
        '.ne-api-dot.warn{background:var(--yellow40, #e6a817);}' +
        '.ne-api-fetch-models{width:28px;height:28px;border:none;border-radius:4px;background:var(--grey30, #555);color:var(--grey70, #aaa);cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;}' +
        '.ne-api-fetch-models:hover{background:var(--grey50, #777);color:#fff;}' +
        '.ne-api-fetch-models:disabled{opacity:0.4;cursor:not-allowed;}' +
        '.ne-model-select{background:var(--grey10, #222);color:var(--grey80, #ccc);border:1px solid var(--grey30, #555);border-radius:4px;padding:4px 6px;font-size:13px;min-width:0;}' +
        '.ne-key-validation-warn{color:var(--yellow40, #e6a817);font-size:0.75em;margin-top:2px;}' +
        '.ne-api-btn{padding:4px 10px;margin:4px 4px 0 0;cursor:pointer;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--SmartThemeBodyColor);font-size:0.8em;}' +
        '.ne-api-btn:disabled{opacity:0.4;cursor:not-allowed;}' +
        '.ne-settings-section-card{background:var(--black20a);border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px 12px;margin-bottom:8px;}' +
        '.ne-settings-section-card .ne-settings-section-title{font-weight:bold;font-size:0.85em;color:var(--grey-70);margin-bottom:8px;display:flex;align-items:center;gap:4px;}' +
        '.ne-settings-section-card .ne-accordion-body{padding:4px 0 0 0;}' +
        '.ne-status-dot{font-size:0.7em;margin-left:4px;}' +
        '.ne-state-global-summary{background:var(--black20a);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:6px 8px;margin-bottom:8px;font-size:0.82em;}' +
        '.ne-state-global-summary summary{cursor:pointer;color:var(--grey-60);font-weight:bold;}' +
        '.ne-state-global-summary summary:hover{color:var(--text);}' +
        '.ne-state-global-summary-detail .ne-state-global-block{border:none;padding:4px 0 0 0;background:transparent;}' +
        '.ne-entity-chain-tag{display:inline-block;padding:1px 6px;border-radius:3px;margin:2px 4px 2px 0;font-size:0.8em;white-space:nowrap;}' +
        '.ne-entity-chain-tag.short{background:var(--ne-success-bg);color:var(--ne-success);border:1px solid var(--ne-success-border);}' +
        '.ne-entity-chain-tag.long{background:var(--ne-warning-bg);color:var(--ne-warning);border:1px solid var(--ne-warning-border);}' +
        '.ne-stm-entities-row{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;}' +
        '.ne-entity-pill{display:inline-block;padding:1px 6px;background:var(--ne-success-bg);border:1px solid var(--ne-success-border);border-radius:10px;font-size:0.75em;color:var(--ne-success);white-space:nowrap;}' +
        '.ne-stm-thoughts-row{margin-top:4px;padding:4px 6px;background:var(--ne-warning-bg);border-left:2px solid var(--ne-warning-border);border-radius:2px;font-size:0.78em;}' +
        '.ne-stm-thought-item{color:var(--grey-60);padding:1px 0;}' +
        '.ne-thought-char{color:var(--grey-40);font-weight:bold;}' +
        '.ne-psyche-mood{color:var(--ne-warning,#f0ad4e);font-size:0.85em;font-style:italic;margin-left:2px;}' +
        '.ne-state-banner{margin:0 0 8px 0;padding:8px 12px;border-radius:6px;background:linear-gradient(135deg,rgba(125,73,64,.06),rgba(125,73,64,.02));border:1px solid rgba(125,73,64,.12);font-size:13px;line-height:1.6;}' +
        '.ne-state-banner-top{display:flex;gap:16px;align-items:baseline;}' +
        '.ne-state-scene{font-weight:600;color:var(--SmartThemeBodyColor,#c1b9ad);}' +
        '.ne-state-time{font-size:12px;color:var(--SmartThemeEmColor,#9e978e);}' +
        '.ne-state-day{font-size:12px;color:var(--SmartThemeEmColor,#9e978e);}' +
        '.ne-state-event{margin-top:2px;font-size:12px;color:var(--grey-60,#888);font-style:italic;}' +
        '.ne-state-chars{margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;}' +
        '.ne-state-char-pill{display:inline-block;padding:1px 8px;border-radius:10px;background:rgba(125,73,64,.08);border:1px solid rgba(125,73,64,.15);font-size:12px;color:var(--SmartThemeBodyColor,#c1b9ad);}' +
        '.ne-state-banner-missing{font-style:italic;color:var(--grey-50);font-size:12px;}' +
        '.ne-card-edit-btn{font-size:0.85em;padding:0 4px;cursor:pointer;opacity:0.6;border:none;background:none;color:var(--SmartThemeBodyColor,#c1b9ad);margin-left:auto;}' +
        '.ne-card-edit-btn:hover{opacity:1;}' +
        '.ne-card-save-btn{font-size:0.82em;padding:1px 8px;cursor:pointer;margin-left:auto;background:var(--ne-success);color:#fff;border:none;border-radius:3px;}' +
        '.ne-card-cancel-btn{font-size:0.82em;padding:1px 8px;cursor:pointer;margin-left:4px;background:var(--ne-danger);color:#fff;border:none;border-radius:3px;}' +
        '.ne-char-edit{width:100%;padding:2px 4px;border:1px solid var(--SmartThemeBorderColor,rgba(155,109,94,.15));border-radius:3px;background:var(--black20a,rgba(0,0,0,.2));color:var(--SmartThemeBodyColor,#c1b9ad);font-size:0.82em;}' +
        '.ne-char-edit:focus{outline:1px solid var(--SmartThemeEmColor,#7d4940);border-color:var(--SmartThemeEmColor,#7d4940);}' +
        '.ne-card-editing .ne-field-label{vertical-align:middle;}' +
        '.ne-vault-btn,.ne-api-btn,.menu_button{transition:background var(--ne-transition-fast),opacity var(--ne-transition-fast);}' +
        '.menu_button{padding:6px 12px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--SmartThemeBodyColor);cursor:pointer;font-family:inherit;}' +
        '.menu_button:hover{background:var(--black50a);}' +
        '.menu_button:disabled{opacity:0.5;cursor:not-allowed;}' +
        // ── Memory table base (migrated from style.css, which is never loaded) ──
        '.narrative_memory_table{width:100%;border-collapse:collapse;font-size:0.85em;line-height:1.5;margin-top:4px;}' +
        '.narrative_memory_table th{background:var(--black50a);padding:6px 8px;text-align:left;font-weight:bold;border-bottom:2px solid var(--black70a);white-space:nowrap;}' +
        '.narrative_memory_table td{padding:6px 8px;border-bottom:1px solid var(--black30a);vertical-align:top;word-break:break-word;}' +
        '.narrative_memory_table tbody tr:nth-child(even),.narrative_ltm_sub_table tbody tr:nth-child(even),.ne-usage-chat-table tr:nth-child(even){background:var(--black10a);}' +
        '.narrative_memory_table tbody tr:hover,.narrative_ltm_sub_table tbody tr:hover,.ne-usage-chat-table tr:hover{background:var(--black20a)!important;transition:background var(--ne-transition-fast);}' +
        '.ne-accordion-chevron{transition:transform var(--ne-transition-normal);}' +
        '.ne_vault_btn_small{padding:4px 10px;}' +
        '.ne_vault_btn_tiny{padding:4px 8px;}' +
        // ── L2: Chevron toggle unified animations ──
        '.ne-char-toggle,.ne-faction-toggle,.ne-quest-toggle,.ne-suspense-toggle{display:inline-block;transition:transform var(--ne-transition-normal);font-size:10px;margin-right:4px;cursor:pointer;user-select:none;}' +
        '.ne-char-toggle:focus-visible,.ne-faction-toggle:focus-visible,.ne-quest-toggle:focus-visible,.ne-suspense-toggle:focus-visible{outline:2px solid var(--ne-info);outline-offset:2px;}' +
        '.ne-char-card.open .ne-char-toggle,.ne-faction-card.open>.ne-faction-card-header .ne-faction-toggle,.ne-quest-card.open .ne-quest-toggle,.ne-suspense-card.open .ne-suspense-toggle{transform:rotate(90deg);}' +
        // ── L2: Card header keyboard focus ──
        '.ne-char-card-header:focus-visible,.ne-faction-card-header:focus-visible,.ne-quest-header:focus-visible,.ne-suspense-header:focus-visible{outline:2px solid var(--ne-info);outline-offset:1px;}' +
        // ── L2: PC/NPC badge ──
        '.ne-char-type{display:inline-block;padding:1px 7px;border-radius:3px;font-size:0.75em;font-weight:bold;margin-left:6px;}' +
        '.ne-char-type-pc{background:var(--ne-info-bg);color:var(--ne-info);border:1px solid var(--ne-info-border);}' +
        '.ne-char-type-npc{background:var(--ne-muted-bg);color:var(--ne-muted);border:1px solid rgba(136,136,136,0.25);}' +
        // ── L2: Faction hidden card ──
        '.ne-faction-card.ne-faction-hidden{opacity:0.55;border-left-color:var(--ne-muted);border-left-style:dashed;}' +
        '.ne-faction-card.ne-faction-hidden:hover{opacity:0.8;}' +
        // ── L2: Quest card detail ──
        '.ne-quest-detail{display:none;background:var(--black10a);border-radius:4px;padding:6px 8px;}' +
        '.ne-quest-card.open>.ne-quest-detail{display:block;}' +
        // ── L2: Inline edit row ──
        '.ne-inline-row input,.ne-inline-row textarea{background:var(--black20a)!important;border:1px solid var(--ne-info-border);color:var(--text)!important;}' +
        // ── L2: Inline edit row（纵向分行）──
        '.ne-inline-row .ne-inline-edit-cell{padding:8px 10px!important;}' +
        '.ne-inline-edit-grid{display:flex;flex-direction:column;gap:8px;}' +
        '.ne-inline-field{display:flex;flex-direction:column;gap:2px;}' +
        '.ne-inline-label{font-size:0.75em;color:var(--grey-60);font-weight:600;letter-spacing:0.3px;}' +
        '.ne-inline-actions{display:flex;align-items:center;gap:2px;margin-top:2px;}' +
        // ── L2: Faction card body ──
        '.ne-faction-card-body{display:none;padding:8px 12px;}' +
        '.ne-faction-card.open>.ne-faction-card-body{display:block;}' +
        // ── L2: Char card body padding ──
        '.ne-char-card-body{padding:8px 12px;}' +
        // ── Char card field table — fixed column sizing ──
        '.ne-char-card-body>table{width:100%;border-collapse:collapse;font-size:0.85em;}' +
        '.ne-char-card-body>table td{padding:3px 6px;vertical-align:top;border-bottom:1px solid var(--black20a);}' +
        '.ne-char-card-body>table tr:last-child td{border-bottom:none;}' +
        '.ne-field-label{color:var(--grey-50);width:90px;min-width:70px;text-align:right;white-space:nowrap;font-size:0.88em;padding-right:8px!important;}' +
        '.ne-char-val{word-break:break-word;line-height:1.5;}' +
        '.ne-empty-value{color:var(--grey-50);font-style:italic;opacity:0.5;}' +
        // ── Section header ──
        '.ne-section-header{display:flex;align-items:center;gap:6px;margin-top:10px;padding:4px 0;font-size:0.82em;font-weight:600;color:var(--grey-70);text-transform:uppercase;letter-spacing:0.5px;}' +
        '.ne-section-count{font-size:0.85em;font-weight:400;color:var(--grey-50);background:var(--black30a);padding:0 6px;border-radius:8px;line-height:1.4;}' +
        // ── Inventory section ──
        '.ne-inventory-section{display:flex;flex-direction:column;gap:0;margin-bottom:2px;}' +
        '.ne-inv-item{padding:6px 8px;border-bottom:1px solid var(--black20a);}' +
        '.ne-inv-item:last-child{border-bottom:none;}' +
        '.ne-inv-item-header{display:flex;align-items:baseline;gap:6px;}' +
        '.ne-inv-name{font-weight:600;color:var(--text);font-size:0.88em;}' +
        '.ne-inv-rarity{font-size:0.72em;padding:0 5px;border-radius:3px;background:var(--ne-info-bg);color:var(--ne-info);border:1px solid var(--ne-info-border);line-height:1.5;white-space:nowrap;}' +
        '.ne-inv-desc{font-size:0.78em;color:var(--grey-60);margin-top:2px;line-height:1.4;}' +
        // ── Power slots section ──
        '.ne-power-slots-section{display:flex;flex-direction:column;gap:0;}' +
        '.ne-ps-item{padding:6px 8px;border-bottom:1px solid var(--black20a);}' +
        '.ne-ps-item:last-child{border-bottom:none;}' +
        '.ne-ps-item-header{display:flex;align-items:baseline;gap:6px;}' +
        '.ne-ps-name{font-weight:600;color:var(--text);font-size:0.88em;}' +
        '.ne-ps-level{font-size:0.72em;padding:0 5px;border-radius:3px;background:var(--ne-warning-bg);color:var(--ne-warning);border:1px solid var(--ne-warning-border);line-height:1.5;white-space:nowrap;}' +
        '.ne-ps-desc{font-size:0.78em;color:var(--grey-60);margin-top:2px;line-height:1.4;}' +
        // ── L2: Global State Block ──
        '.ne-state-global-block .ne-state-global-table td:first-child{color:var(--grey-50);width:90px;text-align:right;white-space:nowrap;}' +
        '.ne-state-global-block+.ne-state-global-block{margin-top:6px;}' +
        // ── L2: inline edit btn as button ──
        '.ne-inline-edit-btn{cursor:pointer;font-size:0.85em;opacity:0.6;border:none;background:none;color:var(--SmartThemeBodyColor,#c1b9ad);padding:0 4px;}' +
        '.ne-inline-edit-btn:hover{opacity:1;}' +
        '.ne-inline-edit-btn:focus-visible{outline:2px solid var(--ne-info);outline-offset:1px;}' +
        // ── L2: collapse bar accessibility ──
        '.ne-vault-collapse-bar:focus-visible{outline:2px solid var(--ne-info);outline-offset:1px;}' +
        // ── L2: LTM toggle accessibility ──
        '.narrative_ltm_toggle{display:inline-block;cursor:pointer;transition:transform var(--ne-transition-normal);}' +
        '.narrative_ltm_toggle.expanded{transform:rotate(90deg);}' +
        '.narrative_ltm_toggle:focus-visible{outline:2px solid var(--ne-info);outline-offset:2px;}' +
        // ── L3: Mobile responsive (controlled by .ne-mobile class on host) ──
        mobileSel + '::before{backdrop-filter:none;-webkit-backdrop-filter:none;}' +
        mobileSel + ' .ne-vault-scroll-area{padding:0 6px 60px;}' +
        mobileSel + ' .ne-vault-tab-bar{padding:0 6px 4px;}' +
        mobileSel + ' .ne-accordion-header{padding:6px 8px;font-size:0.88em;}' +
        mobileSel + ' .ne-quick-index{padding:2px 6px;}' +
        mobileSel + ' .ne-vault-collapse-bar{padding:6px 0 4px;min-height:22px;}' +
        mobileSel + ' .ne-vault-tab{font-size:0.82em;padding:6px 0;}' +
        // ── L3: Empty & error states ──
        '.ne-empty-state{text-align:center;padding:24px 16px;color:var(--ne-muted);}' +
        '.ne-empty-state-icon{font-size:2em;margin-bottom:8px;opacity:.5;}' +
        '.ne-empty-state-text{font-size:0.9em;margin-bottom:4px;}' +
        '.ne-empty-state-hint{font-size:0.8em;opacity:.7;}' +
        '.ne-error-state{text-align:center;padding:16px;color:var(--ne-danger);}' +
        '.ne-error-retry{display:inline-block;margin-top:8px;padding:4px 12px;border-radius:var(--ne-radius-sm);' +
        'border:1px solid var(--ne-danger);background:var(--ne-danger-bg);color:var(--ne-danger);cursor:pointer;font-size:0.85em;transition:background .15s;}' +
        '.ne-error-retry:hover{background:var(--ne-danger-border);}' +
        // ── L3: Micro-interactions ──
        (isShadow ? ':host{' : '.ne-vault-bottom-overlay{') + 'touch-action:manipulation;}' +
        '.ne-vault-btn:active,.ne-api-btn:active,.menu_button:active,' +
        '.ne_vault_btn_small:active,.ne_vault_btn_tiny:active,' +
        '.ne-confirm-btn:active,.ne-inline-save:active,.ne-inline-cancel:active,.ne-inline-delete:active,' +
        '.ne-settings-save-btn:active,.ne-tr-btn:active,' +
        '.ne-card-edit-btn:active,.ne-card-save-btn:active,.ne-card-cancel-btn:active,' +
        '.ne-inline-edit-btn:active,.ne-error-retry:active,' +
        '.ne-index-item:active,.ne-vault-tab:active,.ne-vault-collapse-bar:active{' +
        'transform:scale(.97);transition:transform .1s var(--ne-easing-standard);}' +
        '#tab-settings input:focus-visible,#tab-settings select:focus-visible{outline:2px solid var(--ne-info);outline-offset:-1px;}' +
        // ── L3: Search / Filter ──
        '#ne-memory-search-input:focus-visible{outline:2px solid var(--ne-info);outline-offset:-1px;border-color:var(--ne-info-border);}' +
        '.ne-search-hidden{display:none!important;}' +
        '.ne-search-no-match{color:var(--ne-muted);font-style:italic;padding:8px;text-align:center;}' +
        // Bind all semantic tokens inside Shadow DOM scope (hardcoded — no external :root dependency)
        (isShadow ? ':host{' : ':root{') +
        '--ne-success:#4caf50;--ne-success-bg:rgba(76,175,80,.12);--ne-success-border:rgba(76,175,80,.3);' +
        '--ne-warning:#f0ad4e;--ne-warning-bg:rgba(240,173,78,.12);--ne-warning-border:rgba(240,173,78,.3);' +
        '--ne-danger:#e53935;--ne-danger-bg:rgba(229,57,53,.12);--ne-danger-border:rgba(229,57,53,.3);' +
        '--ne-info:#2196f3;--ne-info-bg:rgba(33,150,243,.12);--ne-info-border:rgba(33,150,243,.3);' +
        '--ne-muted:#888;--ne-muted-bg:rgba(136,136,136,.08);' +
        '--ne-radius-sm:4px;--ne-radius-md:8px;--ne-radius-lg:12px;' +
        '}' +
        // ── Custom scrollbar (Webkit + Firefox) ──
        (isShadow ? ':host' : '.ne-vault-bottom-overlay, .ne-slide-panel, .ne-template-editor') + '{' +
        '--ne-scroll-thumb:rgba(255,255,255,.15);' +
        '--ne-scroll-thumb-hover:rgba(255,255,255,.28);' +
        '--ne-scroll-track:transparent;' +
        '}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar,' +
        '.ne-slide-panel *::-webkit-scrollbar{width:8px;height:8px;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar-track,' +
        '.ne-slide-panel *::-webkit-scrollbar-track{background:var(--ne-scroll-track);border-radius:4px;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar-thumb,' +
        '.ne-slide-panel *::-webkit-scrollbar-thumb{background:var(--ne-scroll-thumb);border-radius:4px;' +
        'border:2px solid transparent;background-clip:padding-box;transition:background .15s;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar-thumb:hover,' +
        '.ne-slide-panel *::-webkit-scrollbar-thumb:hover{background:var(--ne-scroll-thumb-hover);background-clip:padding-box;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *::-webkit-scrollbar-corner,' +
        '.ne-slide-panel *::-webkit-scrollbar-corner{background:transparent;}' +
        (isShadow ? ':host' : '.ne-vault-bottom-overlay') + ' *,' +
        '.ne-slide-panel *{scrollbar-width:thin;scrollbar-color:var(--ne-scroll-thumb) var(--ne-scroll-track);}' +
        // ── Slide-in panel ──
        '.ne-slide-panel{position:absolute;top:0;right:0;bottom:0;width:85%;' +
        'background:var(--SmartThemeBlurTintColor);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
        'border-left:1px solid var(--SmartThemeBorderColor);transform:translateX(100%);' +
        'transition:transform var(--ne-transition-normal) var(--ne-easing-decelerate);' +
        'z-index:40;overflow-y:auto;padding:12px;}' +
        '.ne-slide-panel.open{transform:translateX(0);}' +
        '.ne-slide-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.3);' +
        'opacity:0;pointer-events:none;transition:opacity 0.2s;z-index:39;}' +
        '.ne-slide-backdrop.open{opacity:1;pointer-events:auto;}' +
        '.ne-slide-panel .ne-slide-close{position:sticky;top:0;float:right;font-size:1.2em;cursor:pointer;' +
        'color:var(--grey-50);padding:4px 8px;border-radius:4px;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);' +
        'z-index:1;line-height:1;}' +
        '.ne-slide-panel .ne-slide-close:hover{background:var(--black50a);color:var(--text);}' +
        '.ne-slide-panel .ne-slide-title{font-size:1em;font-weight:bold;margin-bottom:8px;padding-bottom:6px;' +
        'border-bottom:1px solid var(--SmartThemeBorderColor);}' +
        // ── Template library ──
        '.ne-template-config{border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:10px 12px;margin-bottom:12px;}' +
        '.ne-config-section-title{font-weight:bold;font-size:0.9em;margin-bottom:8px;color:var(--text);}' +
        '.ne-config-field{margin-bottom:8px;}' +
        '.ne-config-field label{display:block;font-size:0.82em;color:var(--grey-50);margin-bottom:3px;}' +
        '.ne-config-select{width:100%;padding:5px 8px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--text);font-size:0.85em;}' +
        '.ne-config-empty{font-size:0.82em;color:var(--grey-50);padding:4px 0;}' +
        '.ne-config-npc-item{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;margin:3px 0;background:var(--black30a);border-radius:4px;font-size:0.85em;}' +
        '.ne-npc-lock-btn{cursor:pointer;padding:0 4px;font-size:0.95em;opacity:0.7;transition:opacity 0.15s;}' +
        '.ne-npc-lock-btn:hover{opacity:1;}' +
        '.ne-npc-lock-btn.locked{opacity:1;color:var(--golden-brown);}' +
        '.ne-radio-label{display:block;font-size:0.85em;margin:3px 0;cursor:pointer;}' +
        '.ne-config-world{font-size:0.82em;color:var(--grey-60);}' +
        '.ne-world-ctx-text{padding:6px 8px;background:var(--black30a);border-radius:4px;margin-bottom:4px;line-height:1.5;}' +
        '.ne-world-ctx-meta{font-size:0.78em;color:var(--grey-50);}' +
        // ── Template library cards ──
        '.ne-template-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}' +
        '.ne-template-col{min-width:0;}' +
        '.ne-col-title{font-weight:bold;font-size:0.88em;margin-bottom:8px;color:var(--text);padding-bottom:4px;border-bottom:1px solid var(--SmartThemeBorderColor);}' +
        '.ne-template-card{border:1px solid var(--SmartThemeBorderColor);border-radius:8px;padding:8px 10px;margin-bottom:8px;background:var(--black30a);}' +
        '.ne-template-card:hover{border-color:var(--ne-info,rgba(59,130,246,0.5));}' +
        '.ne-template-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;}' +
        '.ne-template-card-header b{font-size:0.9em;}' +
        '.ne-template-card-desc{font-size:0.8em;color:var(--grey-50);margin-bottom:4px;line-height:1.4;}' +
        '.ne-template-card-meta{font-size:0.78em;color:var(--grey-60);margin-bottom:6px;}' +
        '.ne-template-card-actions{display:flex;gap:6px;}' +
        '.ne-template-lock{font-size:0.8em;}' +
        '.ne-btn-small{padding:2px 8px;font-size:0.78em;border-radius:4px;border:1px solid var(--SmartThemeBorderColor);background:var(--black30a);color:var(--text);cursor:pointer;}' +
        '.ne-btn-small:hover{background:var(--black50a);}' +
        '.ne-btn-edit{color:var(--ne-info,rgba(59,130,246,1));}' +
        '.ne-btn-danger{color:var(--ne-danger,#ef4444);}' +
        '.ne-library-toolbar{margin-bottom:12px;}' +
        '.ne-npc-category-title{font-size:0.82em;font-weight:bold;color:var(--grey-50);margin:8px 0 4px;}' +
        // ── Template editor ──
        '.ne-template-editor{padding:0;}' +
        '.ne-editor-section{margin-bottom:12px;}' +
        '.ne-editor-section label{display:block;font-size:0.82em;color:var(--grey-50);margin-bottom:3px;}' +
        '.ne-editor-input,.ne-editor-textarea{width:100%;padding:6px 8px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--text);font-size:0.85em;font-family:inherit;}' +
        '.ne-editor-textarea{resize:vertical;min-height:40px;}' +
        '.ne-preset-category{margin-bottom:8px;}' +
        '.ne-preset-field{display:block;font-size:0.85em;margin:2px 0;cursor:pointer;}' +
        '.ne-preset-field input{margin-right:6px;}' +
        '.ne-custom-field-item{display:flex;justify-content:space-between;align-items:center;padding:3px 8px;margin:3px 0;background:var(--black30a);border-radius:4px;font-size:0.85em;}' +
        '.ne-custom-field-add{margin-top:6px;}' +
        '.ne-lock-toggle{font-size:0.85em;cursor:pointer;display:flex;align-items:center;gap:6px;}' +
        '.ne-editor-actions{display:flex;gap:8px;margin-top:12px;}' +
        '.ne-section-title{font-weight:bold;font-size:0.9em;margin-bottom:6px;color:var(--text);}' +
        // ── Version timeline ──
        '.ne-version-timeline{border-left:2px solid var(--SmartThemeBorderColor);padding-left:12px;margin-left:4px;}' +
        '.ne-version-item{position:relative;margin-bottom:8px;padding-left:4px;}' +
        '.ne-version-item.ne-version-item-current{background:var(--black20a);border-radius:4px;padding:4px 4px 4px 8px;}' +
        '.ne-version-dot{position:absolute;left:-19px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--grey-50);border:2px solid var(--SmartThemeBorderColor);}' +
        '.ne-version-dot.active{background:var(--ne-success,rgba(34,197,94,1));}' +
        '.ne-version-dot.cursor{background:var(--ne-accent,rgba(59,130,246,0.9));}' +
        '.ne-version-date{font-size:0.8em;color:var(--grey-50);}' +
        '.ne-version-badge{font-size:0.75em;color:var(--ne-success,rgba(34,197,94,1));}' +
        '.ne-version-diff{font-size:0.78em;color:var(--ne-success,#22c55e);margin:2px 0;}' +
        '.ne-version-diff.ne-diff-removed{color:var(--ne-danger,#ef4444);}' +
        // ── Version history panel ──
        '.ne-version-history-root{display:flex;flex-direction:column;height:100%;}' +
        '.ne-version-tab-bar{display:flex;gap:4px;padding:8px 12px;border-bottom:1px solid var(--SmartThemeBorderColor);flex-shrink:0;}' +
        '.ne-version-tab{padding:6px 14px;border:1px solid var(--SmartThemeBorderColor);border-radius:6px 6px 0 0;background:var(--black20a);color:var(--grey-70);cursor:pointer;font-size:0.85em;border-bottom:none;}' +
        '.ne-version-tab.active{background:var(--black30a);color:var(--text);font-weight:bold;}' +
        '.ne-version-scroll-area{flex:1;overflow-y:auto;padding:12px;}' +
        '.ne-timeline-section{padding:0;}' +
        '.ne-version-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:4px 0;}' +
        '.ne-version-nav-btn{padding:4px 10px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black20a);color:var(--text);cursor:pointer;font-size:0.82em;white-space:nowrap;}' +
        '.ne-version-nav-btn:hover{background:var(--black30a);}' +
        '.ne-version-nav-btn:disabled{opacity:0.4;cursor:default;}' +
        '.ne-version-cursor-info{font-size:0.82em;color:var(--grey-70);min-width:100px;text-align:center;}' +
        '.ne-version-meta{display:flex;align-items:center;gap:6px;margin-bottom:2px;}' +
        '.ne-version-seq{font-weight:bold;font-size:0.85em;color:var(--text);}' +
        '.ne-version-type{font-size:0.78em;color:var(--grey-70);padding:1px 6px;border-radius:3px;background:var(--black10a);}' +
        '.ne-version-time{font-size:0.75em;color:var(--grey-50);}' +
        '.ne-version-summary{font-size:0.82em;color:var(--text);margin-bottom:2px;}' +
        '.ne-version-changes{margin-top:4px;padding:4px 8px;background:var(--black10a);border-radius:4px;font-size:0.78em;}' +
        '.ne-change-entry{margin-bottom:2px;}' +
        '.ne-change-path{font-size:0.75em;color:var(--grey-70);}' +
        '.ne-change-old{color:var(--ne-danger,#ef4444);text-decoration:line-through;}' +
        '.ne-change-new{color:var(--ne-success,#22c55e);}' +
        '.ne-change-more{color:var(--grey-50);font-size:0.75em;margin-top:2px;}' +
        '.ne-version-settings-block{margin-bottom:20px;padding:12px;background:var(--black10a);border-radius:6px;}' +
        '.ne-version-settings-block h4{font-size:0.9em;color:var(--text);margin:0 0 8px;}' +
        '.ne-version-limit-info{margin-left:auto;font-size:0.75em;color:var(--grey-50);}' +
        // ── Scheme editor (in-card) ──
        '.ne-scheme-editor-container{margin-top:4px;}' +
        '.ne-scheme-editor{background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:10px 12px;}' +
        '.ne-scheme-section{margin-bottom:12px;}' +
        '.ne-scheme-section-title{font-weight:bold;font-size:0.88em;margin-bottom:4px;color:var(--text);}' +
        '.ne-scheme-hint{font-size:0.78em;color:var(--grey-50);margin:0 0 6px;font-style:italic;}' +
        '.ne-scheme-required{opacity:0.6;pointer-events:none;}' +
        '.ne-scheme-fields{margin:4px 0;}' +
        '.ne-scheme-field{display:flex;align-items:center;gap:6px;font-size:0.85em;padding:3px 0;}' +
        '.ne-scheme-field-type{font-size:0.78em;color:var(--grey-50);margin-left:auto;}' +
        '.ne-scheme-field-icon{font-size:0.75em;}' +
        '.ne-scheme-category{font-weight:bold;font-size:0.8em;color:var(--grey-50);margin:6px 0 2px;text-transform:capitalize;}' +
        '.ne-scheme-checkbox{cursor:pointer;}' +
        '.ne-scheme-add-custom{margin:8px 0;}' +
        '.ne-scheme-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}' +
        '.ne-scheme-custom-item{justify-content:space-between;}' +
        // ── Card buttons ──
        '.ne-card-scheme-btn{background:none;border:none;color:var(--grey-50);cursor:pointer;font-size:1em;padding:0 2px;opacity:0.5;}' +
        '.ne-card-scheme-btn:hover{opacity:1;color:var(--text);}' +
        '.ne-card-lock-btn{background:none;border:none;color:var(--grey-50);cursor:pointer;font-size:0.9em;padding:0 2px;opacity:0.5;}' +
        '.ne-card-lock-btn:hover{opacity:1;}' +
        '.ne-card-lock-btn.locked{opacity:1;}' +
        // ── NPC Selector ──
        '.ne-npc-selector{background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:10px 12px;margin-top:6px;}' +
        '.ne-npc-select-item{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;margin:3px 0;font-size:0.85em;}' +
        // ── Responsive: 768px two-col -> stacked ──
        mobileSel + ' .ne-template-grid{grid-template-columns:1fr;}' +
        // ── Modal overlay (P5: unified selector modal) ──
        '.ne-modal-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,.5);opacity:0;transition:opacity .15s;}' +
        '.ne-modal-overlay.show{opacity:1;}' +
        '.ne-modal{background:var(--SmartThemeBlurTintColor,#1e1e1e);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
        'border:1px solid var(--SmartThemeBorderColor,#444);border-radius:12px;padding:16px 20px;min-width:300px;max-width:90vw;max-height:70vh;' +
        'display:flex;flex-direction:column;transform:scale(.9);transition:transform .2s cubic-bezier(0,0,0.2,1);}' +
        '.ne-modal-overlay.show .ne-modal{transform:scale(1);}' +
        '.ne-modal h3{font-size:1em;font-weight:bold;margin:0 0 10px;}' +
        '.ne-modal-body{flex:1;overflow-y:auto;margin-bottom:12px;}' +
        '.ne-modal-footer{display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;}' +
        // ── Template toolbar (P3: search + filter + sort) ──
        '.ne-template-toolbar{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}' +
        '.ne-template-toolbar input[type=text]{flex:1;min-width:120px;padding:4px 8px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--text);font-size:0.82em;}' +
        '.ne-template-toolbar select{padding:4px 8px;border:1px solid var(--SmartThemeBorderColor);border-radius:4px;background:var(--black30a);color:var(--text);font-size:0.82em;}' +
        '.ne-tag-chips{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;}' +
        '.ne-tag-chip{padding:2px 8px;border-radius:10px;font-size:0.75em;cursor:pointer;background:var(--black20a);color:var(--grey-60);border:1px solid var(--SmartThemeBorderColor);transition:background .15s,color .15s;}' +
        '.ne-tag-chip:hover{background:var(--black30a);color:var(--text);}' +
        '.ne-tag-chip.active{background:var(--ne-info-bg);color:var(--ne-info);border-color:var(--ne-info-border);}' +
        // ── Template card redesign (P4) ──
        '.ne-template-card-desc{font-size:0.8em;color:var(--grey-50);margin-bottom:4px;line-height:1.4;cursor:pointer;' +
        'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}' +
        '.ne-template-card-desc.expanded{-webkit-line-clamp:unset;overflow:visible;}' +
        '.ne-template-role-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.72em;font-weight:bold;margin-right:4px;}' +
        '.ne-template-role-badge.role-pc{background:var(--ne-info-bg);color:var(--ne-info);border:1px solid var(--ne-info-border);}' +
        '.ne-template-role-badge.role-npc{background:var(--ne-muted-bg);color:var(--ne-muted);border:1px solid rgba(136,136,136,0.25);}' +
        '.ne-template-role-badge.role-faction{background:var(--ne-warning-bg);color:var(--ne-warning);border:1px solid var(--ne-warning-border);}' +
        '.ne-template-role-badge.role-quest{background:var(--ne-success-bg);color:var(--ne-success);border:1px solid var(--ne-success-border);}' +
        '.ne-template-source-badge{font-size:0.72em;padding:1px 5px;border-radius:3px;margin-right:4px;}' +
        '.ne-template-source-badge.src-system{background:var(--ne-info-bg);color:var(--ne-info);}' +
        '.ne-template-source-badge.src-ai{background:var(--ne-warning-bg);color:var(--ne-warning);}' +
        '.ne-template-source-badge.src-user{background:var(--ne-muted-bg);color:var(--ne-muted);}' +
        '.ne-template-field-chip{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.72em;margin-right:3px;background:var(--black20a);color:var(--grey-60);}' +
        '.ne-template-in-use{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.72em;font-weight:bold;background:var(--ne-success-bg);color:var(--ne-success);border:1px solid var(--ne-success-border);}' +
        '.ne-template-card-meta{display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:0.75em;color:var(--grey-60);margin-bottom:6px;}' +
        // ── Config panel polish (P7) ──
        '.ne-config-in-use-badge{font-size:0.7em;padding:1px 5px;border-radius:3px;background:var(--ne-success-bg);color:var(--ne-success);border:1px solid var(--ne-success-border);margin-left:4px;}' +
        '.ne-world-ctx-actions{display:flex;gap:6px;margin-top:4px;}' +
        '.ne-world-ctx-edit-area{width:100%;min-height:80px;background:var(--black30a);border:1px solid var(--SmartThemeBorderColor);color:var(--text);border-radius:4px;padding:6px 8px;font-size:0.82em;font-family:inherit;resize:vertical;}' +
        // ── Role tabs within library (P2) ──
        '.ne-template-role-tabs{display:flex;gap:2px;margin-bottom:8px;border-bottom:1px solid var(--SmartThemeBorderColor);}' +
        '.ne-template-role-tab{flex:1;text-align:center;padding:6px 0;cursor:pointer;font-size:0.85em;color:var(--grey-70);border-bottom:2px solid transparent;transition:color .15s,border-color .15s;user-select:none;}' +
        '.ne-template-role-tab:hover{color:var(--text,#ddd);}' +
        '.ne-template-role-tab.active{color:var(--text,#fff);border-bottom-color:var(--SmartThemeBorderColor);font-weight:bold;}' +
        '.ne-template-role-content{display:none;}' +
        '.ne-template-role-content.active{display:block;}' +
        /* ── Unified view layout ── */
        '.ne-unified-view{display:flex;flex-direction:column;height:100%;overflow:hidden;gap:0;}' +
        '.ne-unified-section{flex:1;overflow-y:auto;min-height:0;padding:0 2px;}' +
        '.ne-unified-section-title{font-weight:bold;font-size:0.9em;padding:6px 0 4px;position:sticky;top:0;z-index:5;background:var(--SmartThemeBlurTintColor,#1a1a2e);border-bottom:1px solid var(--SmartThemeBorderColor,#444);}' +
        '.ne-unified-divider{flex-shrink:0;height:3px;margin:4px 0;background:var(--SmartThemeBorderColor,#444);border-radius:2px;opacity:0.4;}' +
        /* ── Config card (bottom half) ── */
        '.ne-config-card{border:1px solid var(--SmartThemeBorderColor,#444);border-left:3px solid var(--ne-info,#58a6ff);border-radius:6px;padding:8px 10px;margin-bottom:6px;background:rgba(0,0,0,0.15);}' +
        '.ne-config-card.state-synced{border-left-color:var(--ne-info,#58a6ff);}' +
        '.ne-config-card.state-forked{border-left-color:var(--ne-warn,#f0883e);}' +
        '.ne-config-card.state-orphaned{border-left-color:var(--ne-danger,#f85149);}' +
        '.ne-config-card.search-hit{box-shadow:0 0 0 2px var(--ne-info,#58a6ff);}' +
        '.ne-config-card-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;}' +
        /* ── Empty slot ── */
        '.ne-config-empty-slot{border:1px dashed var(--SmartThemeBorderColor,#444);border-radius:6px;padding:12px;text-align:center;color:var(--grey-50,#8b949e);font-size:0.82em;}' +
        '.ne-config-empty-slot button{margin-top:6px;}' +
        /* ── Library card grid ── */
        '.ne-library-card-grid{display:grid;grid-template-columns:1fr;gap:6px;padding:4px 0;}' +
        '@media(min-width:500px){.ne-library-card-grid{grid-template-columns:1fr 1fr;}}' +
        /* ── Accordion count badge ── */
        '.ne-role-accordion-count{font-size:0.75em;font-weight:normal;color:var(--grey-50,#8b949e);margin-left:6px;}' +
        '.ne-role-accordion-header.no-match{opacity:0.5;}' +
        /* ── Current badge ── */
        '.ne-card-current-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.72em;font-weight:bold;background:rgba(88,166,255,0.15);color:var(--ne-info,#58a6ff);border:1px solid rgba(88,166,255,0.3);}' +
        /* ── Template card expanded state ── */
        '.ne-template-card-fields-preview{display:none;margin-top:4px;padding:4px 6px;background:rgba(0,0,0,0.1);border-radius:4px;font-size:0.78em;}' +
        '.ne-template-card.expanded .ne-template-card-fields-preview{display:block;}' +
        /* ── Highlight animation for "go to library" ── */
        '@keyframes ne-highlight-flash{0%,100%{box-shadow:none;}50%{box-shadow:0 0 0 3px var(--ne-info,#58a6ff);}}' +
        '.ne-unified-section-highlight{animation:ne-highlight-flash 0.5s ease-in-out 3;}' +
        /* ── Template mode hint ── */
        '.ne-template-mode-hint{font-size:0.78em;color:var(--grey-50,#8b949e);margin-top:2px;margin-bottom:6px;}' +
        /* ── Mobile dual-zone switcher ── */
        '.ne-mobile-zone-switch{display:none;}' +
        '@media(max-width:499px){' + mobileSel + ' .ne-mobile-zone-switch{display:flex;gap:2px;margin-bottom:6px;}' +
        mobileSel + ' .ne-unified-section{display:none;}' +
        mobileSel + ' .ne-unified-section.ne-mobile-active{display:block;flex:1;overflow-y:auto;}' +
        mobileSel + ' .ne-mobile-zone-tab{flex:1;text-align:center;padding:6px 0;cursor:pointer;font-size:0.85em;border-bottom:2px solid transparent;color:var(--grey-50,#8b949e);}' +
        mobileSel + ' .ne-mobile-zone-tab.active{color:var(--text,#fff);border-bottom-color:var(--SmartThemeBorderColor,#444);font-weight:bold;}}' +
        '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important}}' +
        // 楼内面板"在主面板查看"定位高亮
        '@keyframes ne-fp-flash{0%,100%{background:transparent}50%{background:var(--SmartThemeQuoteColor,#ffeb3b);opacity:0.3}}' +
        '.ne-fp-highlight{animation:ne-fp-flash 1s ease-in-out 2}';
    if (_panelRoot) { _panelRoot.appendChild(style); } else { pdHead().appendChild(style); }

    // Modal CSS must also be in PD.head (main document) since modals are appended to PD.body
    if (_panelRoot) {
        var modalStyleExists = PD.getElementById('ne_modal_style');
        if (!modalStyleExists) {
            var modalStyle = pdCreate('style');
            modalStyle.id = 'ne_modal_style';
            modalStyle.textContent =
                '.ne-modal-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;' +
                'background:rgba(0,0,0,.5);opacity:0;transition:opacity .15s;}' +
                '.ne-modal-overlay.show{opacity:1;}' +
                '.ne-modal{background:var(--SmartThemeBlurTintColor,#1e1e1e);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
                'border:1px solid var(--SmartThemeBorderColor,#444);border-radius:12px;padding:16px 20px;min-width:300px;max-width:90vw;max-height:70vh;' +
                'display:flex;flex-direction:column;transform:scale(.9);transition:transform .2s cubic-bezier(0,0,0.2,1);}' +
                '.ne-modal-overlay.show .ne-modal{transform:scale(1);}' +
                '.ne-modal h3{font-size:1em;font-weight:bold;margin:0 0 10px;}' +
                '.ne-modal-body{flex:1;overflow-y:auto;margin-bottom:12px;}' +
                '.ne-modal-footer{display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;}' +
                '.ne-modal *::-webkit-scrollbar{width:6px;height:6px;}' +
                '.ne-modal *::-webkit-scrollbar-track{background:transparent;}' +
                '.ne-modal *::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:3px;}' +
                '.ne-modal *::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28);}' +
                '.ne-modal *{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.15) transparent;}';
            pdHead().appendChild(modalStyle);
        }
    }

    // Design token variables must live in PD.head (:root) — custom properties inherit through the
    // shadow boundary from the host, so this also feeds shadow-root panels. Migrated from style.css,
    // which is never loaded by the manifest/rollup/CDN installers.
    if (!PD.getElementById('ne_vars_style')) {
        var varsStyle = pdCreate('style');
        varsStyle.id = 'ne_vars_style';
        varsStyle.textContent = ':root{' +
            '--ne-success:#4caf50;--ne-success-bg:rgba(76,175,80,0.12);--ne-success-border:rgba(76,175,80,0.3);' +
            '--ne-warning:#f0ad4e;--ne-warning-bg:rgba(240,173,78,0.12);--ne-warning-border:rgba(240,173,78,0.3);' +
            '--ne-danger:#e53935;--ne-danger-bg:rgba(229,57,53,0.12);--ne-danger-border:rgba(229,57,53,0.3);' +
            '--ne-info:#2196f3;--ne-info-bg:rgba(33,150,243,0.12);--ne-info-border:rgba(33,150,243,0.3);' +
            '--ne-muted:#888;--ne-muted-bg:rgba(136,136,136,0.08);' +
            '--ne-space-xs:4px;--ne-space-sm:8px;--ne-space-md:12px;--ne-space-lg:16px;--ne-space-xl:20px;--ne-space-2xl:24px;--ne-space-3xl:32px;' +
            '--ne-text-xs:0.75em;--ne-text-sm:0.82em;--ne-text-base:0.9em;--ne-text-lg:1em;--ne-text-xl:1.1em;' +
            '--ne-radius-sm:4px;--ne-radius-md:8px;--ne-radius-lg:12px;' +
            '--ne-transition-fast:0.15s;--ne-transition-normal:0.2s;--ne-transition-slow:0.35s;' +
            '--ne-easing-standard:cubic-bezier(0.4,0,0.2,1);--ne-easing-decelerate:cubic-bezier(0,0,0.2,1);--ne-easing-accelerate:cubic-bezier(0.4,0,1,1);' +
            '--ne-shadow-sm:0 1px 3px rgba(0,0,0,0.12);--ne-shadow-md:0 4px 12px rgba(0,0,0,0.15);' +
            '--ne-z-overlay:1000;}';
        pdHead().appendChild(varsStyle);
    }
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
        'padding:10px 20px;border-radius:8px;font-size:0.9em;color:#fff;opacity:0;' +
        'transition:opacity .2s,transform .2s cubic-bezier(0,0,0.2,1);pointer-events:none;max-width:90vw;text-align:center;}' +
        '.ne-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}' +
        '.ne-toast.success{background:var(--ne-success);}' +
        '.ne-toast.error{background:var(--ne-danger);}' +
        '.ne-toast.warning{background:var(--ne-warning);color:#333;}' +
        '.ne-toast.info{background:var(--ne-info);}' +
        '.ne-confirm-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,.5);opacity:0;transition:opacity .15s;}' +
        '.ne-confirm-overlay.show{opacity:1;}' +
        '.ne-confirm-dialog{background:var(--SmartThemeBlurTintColor,#1e1e1e);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
        'border:1px solid var(--SmartThemeBorderColor,#444);border-radius:12px;padding:20px 24px;min-width:280px;max-width:90vw;' +
        'transform:scale(.9);transition:transform .2s cubic-bezier(0,0,0.2,1);}' +
        '.ne-confirm-overlay.show .ne-confirm-dialog{transform:scale(1);}' +
        '.ne-confirm-title{font-size:1.1em;font-weight:bold;margin-bottom:8px;}' +
        '.ne-confirm-message{font-size:0.9em;color:var(--grey-70,#aaa);margin-bottom:16px;line-height:1.5;}' +
        '.ne-confirm-actions{display:flex;gap:8px;justify-content:flex-end;}' +
        '.ne-confirm-btn{padding:6px 18px;border-radius:4px;border:1px solid var(--SmartThemeBorderColor,#444);' +
        'background:var(--black30a,rgba(0,0,0,.3));color:var(--text,#ddd);cursor:pointer;font-size:0.9em;transition:background .15s;}' +
        '.ne-confirm-btn:hover{background:var(--black50a,rgba(0,0,0,.5));}' +
        '.ne-confirm-btn.danger{background:#e53935;border-color:#e53935;color:#fff;}' +
        '.ne-confirm-btn.danger:hover{background:#c62828;}';
    pdHead().appendChild(style);
}

export function showToast(message, type, duration) {
    _ensureToastCss();
    type = type || 'info';
    duration = duration || 3000;
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

// ── Slide-in panel manager ──
var _slideType = null;
var _slideRenderers = {};

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
        '.ne-tooltip{position:fixed;z-index:9999;max-width:260px;padding:6px 10px;background:var(--black90a,rgba(0,0,0,0.9));color:var(--text,#fff);font-size:0.82em;border-radius:6px;line-height:1.4;pointer-events:none;opacity:0;transition:opacity 0.15s;}' +
        '.ne-tooltip.visible{opacity:1;}' +
        '.ne-help-card{position:fixed;z-index:9998;min-width:280px;max-width:340px;background:var(--black30a,rgba(0,0,0,0.95));border:1px solid var(--SmartThemeBorderColor,#444);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.4);font-size:0.85em;line-height:1.5;color:var(--text);}' +
        '.ne-help-card-header{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--SmartThemeBorderColor,#444);font-weight:bold;font-size:0.92em;}' +
        '.ne-help-card-close{cursor:pointer;opacity:0.5;font-size:1.1em;}' +
        '.ne-help-card-close:hover{opacity:1;}' +
        '.ne-help-card-body{padding:8px 10px;max-height:260px;overflow-y:auto;}' +
        '.ne-guide-banner{background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:6px;padding:10px 28px 10px 12px;margin-bottom:12px;font-size:0.85em;color:var(--text);position:relative;}' +
        '.ne-guide-banner-close{position:absolute;top:6px;right:8px;cursor:pointer;opacity:0.5;font-size:0.9em;}' +
        '.ne-guide-banner-close:hover{opacity:1;}';
    pdHead().appendChild(style);
})();

export function registerSlideRenderer(type, fn) {
    _slideRenderers[type] = fn;
}

export function openSlidePanel(type) {
    if (_slideType === type) return; // already open
    // Close current panel if different
    if (_slideType) closeSlidePanel();
    _slideType = type;

    var backdrop = panelById('ne-slide-backdrop');
    var panel = panelById('ne-slide-panel');
    if (!backdrop || !panel) return;

    // Prevent collapse bar interaction while slide panel is open
    var collapseBar = panelQS('.ne-vault-collapse-bar');
    if (collapseBar) collapseBar.style.pointerEvents = 'none';

    backdrop.classList.add('open');
    panel.classList.add('open');

    // Update title
    var titleEl = panelById('ne-slide-title');
    if (titleEl) {
        if (type === 'usage') titleEl.textContent = t('Usage Statistics');
        else if (type === 'templates') titleEl.textContent = t('template_library');
        else titleEl.textContent = t('Settings & Data Management');
    }

    // Call registered renderer
    if (_slideRenderers[type]) {
        var container = panelById('ne-slide-panel-content');
        if (container) _slideRenderers[type](container);
    }
}

function closeSlidePanel() {
    _slideType = null;
    var backdrop = panelById('ne-slide-backdrop');
    var panel = panelById('ne-slide-panel');
    if (!backdrop || !panel) return;

    backdrop.classList.remove('open');
    panel.classList.remove('open');

    var collapseBar = panelQS('.ne-vault-collapse-bar');
    if (collapseBar) collapseBar.style.pointerEvents = '';
}

export { closeSlidePanel };

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
