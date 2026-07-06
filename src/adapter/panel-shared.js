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
        '#tab-settings label{display:block;padding:6px 0;font-size:0.9em;color:var(--text);cursor:pointer;}' +
        '#tab-settings input[type=text],#tab-settings input[type=password],#tab-settings input[type=number]{width:100%;background:#fff !important;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:6px 10px;border-radius:4px;margin:2px 0 8px;font-size:0.9em;text-shadow:none !important;}' +
        '#tab-settings input::placeholder{color:#999 !important;opacity:1 !important;-webkit-text-fill-color:#999 !important;}' +
        '#tab-settings textarea{width:100%;background:#fff !important;border:1px solid var(--SmartThemeBorderColor);color:#000 !important;-webkit-text-fill-color:#000 !important;padding:6px 10px;border-radius:4px;margin:2px 0 8px;font-family:monospace;font-size:0.8em;resize:vertical;text-shadow:none !important;}' +
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
        '.ne-settings-cascade-card{background:var(--black10a);border-left:3px solid var(--SmartThemeBorderColor);border-radius:0 4px 4px 0;padding:4px 8px;margin-left:12px;margin-top:4px;}' +
        '.ne-settings-toggle-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;padding:6px 8px;background:var(--black10a);border:1px solid var(--SmartThemeBorderColor);border-radius:6px;margin:4px 0 6px;}' +
        '.ne-settings-toggle-grid label{padding:3px 0 !important;font-size:0.85em !important;}' +
        '.ne-api-status{display:flex;align-items:center;gap:6px;margin:4px 0;font-size:0.85em;}' +
        '.ne-api-dot{width:10px;height:10px;border-radius:50%;display:inline-block;background:#cc3333;}' +
        '.ne-api-dot.ok{background:var(--ne-success);}' +
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
        '.narrative_memory_table tbody tr:nth-child(even),.narrative_ltm_sub_table tbody tr:nth-child(even),.ne-usage-chat-table tr:nth-child(even){background:var(--black10a);}' +
        '.narrative_memory_table tbody tr:hover,.narrative_ltm_sub_table tbody tr:hover,.ne-usage-chat-table tr:hover{background:var(--black20a)!important;transition:background var(--ne-transition-fast);}' +
        '.ne-accordion-chevron{transition:transform var(--ne-transition-normal);}' +
        '.ne_vault_btn_small{padding:4px 10px;}' +
        '.ne_vault_btn_tiny{padding:4px 8px;}' +
        // ── L2: Chevron toggle unified animations ──
        '.ne-char-toggle,.ne-faction-toggle,.ne-quest-toggle{display:inline-block;transition:transform var(--ne-transition-normal);font-size:10px;margin-right:4px;cursor:pointer;user-select:none;}' +
        '.ne-char-toggle:focus-visible,.ne-faction-toggle:focus-visible,.ne-quest-toggle:focus-visible{outline:2px solid var(--ne-info);outline-offset:2px;}' +
        '.ne-char-card.open .ne-char-toggle,.ne-faction-card.open>.ne-faction-card-header .ne-faction-toggle,.ne-quest-card.open .ne-quest-toggle{transform:rotate(90deg);}' +
        // ── L2: Card header keyboard focus ──
        '.ne-char-card-header:focus-visible,.ne-faction-card-header:focus-visible,.ne-quest-header:focus-visible{outline:2px solid var(--ne-info);outline-offset:1px;}' +
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
        // ── L2: Faction card body ──
        '.ne-faction-card-body{display:none;padding:8px 12px;}' +
        '.ne-faction-card.open>.ne-faction-card-body{display:block;}' +
        // ── L2: Char card body padding ──
        '.ne-char-card-body{padding:8px 12px;}' +
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
        '.ne-mobile .ne-vault-bottom-overlay::before{backdrop-filter:none;-webkit-backdrop-filter:none;}' +
        '.ne-mobile .ne-vault-scroll-area{padding:0 6px 60px;}' +
        '.ne-mobile .ne-vault-tab-bar{padding:0 6px 4px;}' +
        '.ne-mobile .ne-accordion-header{padding:6px 8px;font-size:0.88em;}' +
        '.ne-mobile .ne-quick-index{padding:2px 6px;}' +
        '.ne-mobile .ne-vault-collapse-bar{padding:6px 0 4px;min-height:22px;}' +
        '.ne-mobile .ne-vault-tab{font-size:0.82em;padding:6px 0;}' +
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
        '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important}}';
    if (_panelRoot) { _panelRoot.appendChild(style); } else { pdHead().appendChild(style); }
}

export var vaultLLMLog = [];
export var lastVaultStateJson = '{}';
export function setLastVaultStateJson(v) { lastVaultStateJson = v; }


export function closeVaultOverlay() {
    stopOverlayResizeWatcher();
    var overlay = byId('ne_vault_bottom_overlay');
    if (overlay) {
        overlay.classList.remove('open');
        var tid = setTimeout(function() { overlay.style.display = 'none'; }, 600);
        overlay.addEventListener('transitionend', function handler() {
            overlay.removeEventListener('transitionend', handler);
            clearTimeout(tid);
            overlay.style.display = 'none';
        });
    }
    var chat = byId('chat');
    if (chat) { chat.style.opacity = ''; chat.style.pointerEvents = ''; chat.style.transition = ''; }
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

        function close(val) {
            overlay.classList.remove('show');
            overlay.addEventListener('transitionend', function h() {
                overlay.removeEventListener('transitionend', h);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(val);
            });
        }

        overlay.querySelector('#ne-confirm-ok').addEventListener('click', function() { close(true); });
        overlay.querySelector('#ne-confirm-cancel').addEventListener('click', function() { close(false); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(false); });
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); close(false); }
        });

        requestAnimationFrame(function() { overlay.classList.add('show'); });
    });
}

export var _updatingPopout = false;
export var _currentGetChatId = null;
export var _vaultChangeBound = false;

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
