/**
 * 楼内摘要面板 — 按钮展开式（参考柏宝书 floorPanel.ts 的 DOM 挂载策略）。
 *
 * NE 与柏宝书的关键差异：
 *   - 柏宝书：摘要嵌在 chat[N].extra.bbs_leaf，1:1 严格对应，面板直接读消息属性
 *   - NE：STM 数据存在外部 vault（IndexedDB），按 msg_ids 反查定位所属 STM
 *
 * 挂载位置：.mes_text 的 afterend（下一个兄弟），与柏宝书一致，不嵌入 ST 按钮行。
 *
 * 交互模型：
 *   - 折叠态：▸ 按钮（有摘要可点击）/ ∅ 灰显（无摘要不可点）
 *   - 展开态：▼ 按钮 + 卡片显示 STM 摘要 + "在主面板查看 ↗"链接
 *   - vault:updated 触发刷新，已展开的卡片同步更新内容
 *
 * 默认关闭：设置开关 floorPanelEnabled（panel-settings.js）。
 */

import { readVault } from '../core/vault/store.js';
import { formatStmEntry } from '../core/engine/injection.js';
import { buildMsgId } from '../core/engine/msg-id.js';
import { on as busOn, off as busOff } from './stateBus.js';
import { t } from '../core/i18n.js';
import { panelQS } from './panel-shared.js';
import { createVaultPopout } from './panel-popout.js';

var _mutationObserver = null;
var _eventUnbinders = [];
var _mountedHosts = new Map(); // mesid -> { host, shadowRoot, btn, card, lastSignature, isOpen, stmEntry }
var _getChatIdFn = null;
var _vaultUpdateListener = null;
var _scanTimer = null;

// ─── 设置开关读取 ─────────────────────────────────────────
function _isEnabled() {
    try {
        var s = JSON.parse(localStorage.getItem('ne_settings') || '{}');
        return !!s.floorPanelEnabled;
    } catch (e) { return false; }
}

// ─── 从 mesid 查找该楼所属的单条 STM ─────────────────────
// 确定性匹配（非"最匹配"）：msg_ids.indexOf 命中即归属。
// 一条 AI 消息正常只属于一条 STM；异常命中多条时取第一条 + 警告。
async function _findStmForMesid(mesid) {
    var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx || !ctx.chat) return null;
    var message = ctx.chat[mesid];
    if (!message) return null;
    // 必须用 buildMsgId 构造，与 STM 提取时 msg_ids 存储的格式一致：
    // "{idx}_{send_date}_{role}"，例如 "3_2026-07-09T06:55:00.000Z_user"
    var msgIdStr = buildMsgId(message, mesid);

    var chatId = _getChatIdFn ? _getChatIdFn() : (ctx.chatId || 'default');
    var vault = await readVault(chatId);
    if (!vault || !vault.content) return null;

    var all = (vault.content.unconsolidated_stm || []).concat(vault.content.stm_entries || []);
    var matched = all.filter(function(e) {
        return e.msg_ids && e.msg_ids.indexOf(msgIdStr) !== -1;
    });

    if (matched.length === 0) {
        // 兜底：msg_ids 未命中时用 msgRange（绝对消息下标）匹配
        matched = all.filter(function(e) {
            return e.msgRange && mesid >= e.msgRange[0] && mesid <= e.msgRange[1];
        });
    }

    if (matched.length === 0) return null;
    if (matched.length > 1) {
        console.warn('[NE floor-panel] mesid=' + mesid + ' 命中 ' + matched.length + ' 条 STM（预期 1 条），取第一条');
    }
    return matched[0];
}

// ─── Shadow DOM 样式 ──────────────────────────────────────
var FLOOR_PANEL_CSS = `
.ne-fp-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
    padding: 2px 8px;
    font-size: 0.8em;
    border: 1px solid var(--SmartThemeQuoteColor, #888);
    border-radius: 3px;
    background: transparent;
    color: var(--SmartThemeBodyColor, #555);
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
}
.ne-fp-btn:hover { background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.05)); }
.ne-fp-btn.ne-fp-empty {
    border-style: dashed;
    opacity: 0.4;
    cursor: default;
}
.ne-fp-btn.ne-fp-empty:hover { background: transparent; }
.ne-fp-btn.ne-fp-open { background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.08)); }

.ne-fp-card {
    margin-top: 6px;
    padding: 8px 12px;
    border-left: 3px solid var(--SmartThemeQuoteColor, #888);
    background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.03));
    font-size: 0.85em;
    color: var(--SmartThemeBodyColor, #333);
    border-radius: 0 4px 4px 0;
    line-height: 1.5;
}
.ne-fp-card-line { margin-bottom: 2px; }
.ne-fp-card-psyche {
    margin-left: 16px;
    font-style: italic;
    opacity: 0.8;
}
.ne-fp-card-footer {
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px dashed var(--SmartThemeQuoteColor, #ccc);
    font-size: 0.85em;
    opacity: 0.7;
}
.ne-fp-card-link {
    color: var(--SmartThemeQuoteColor, #4488ff);
    cursor: pointer;
    text-decoration: underline;
}
.ne-fp-card-link:hover { opacity: 0.8; }
`;

// ─── 渲染按钮状态 ─────────────────────────────────────────
function _renderButton(shadowRoot, hasStm, isOpen) {
    var btn = shadowRoot.querySelector('.ne-fp-btn');
    if (!btn) return;
    if (!hasStm) {
        btn.className = 'ne-fp-btn ne-fp-empty';
        btn.textContent = '\u2205 ' + t('floor_panel_no_summary');
        btn.title = t('floor_panel_no_summary');
    } else if (isOpen) {
        btn.className = 'ne-fp-btn ne-fp-open';
        btn.textContent = '\u25BC ' + t('floor_panel_title');
        btn.title = '';
    } else {
        btn.className = 'ne-fp-btn';
        btn.textContent = '\u25B8 ' + t('floor_panel_title');
        btn.title = '';
    }
}

// ─── 渲染展开的卡片内容 ───────────────────────────────────
function _renderCard(shadowRoot, stmEntry, mesid) {
    var card = shadowRoot.querySelector('.ne-fp-card');
    if (!card) return;

    if (!stmEntry) {
        card.innerHTML = '<div>' + _escapeHtml(t('floor_panel_no_summary')) + '</div>';
        return;
    }

    var storyTime = Date.now();
    var formatted = formatStmEntry(stmEntry, storyTime);
    var lines = formatted.split('\n').map(function(line) {
        if (!line) return '';
        var cls = line.indexOf('   > ') === 0 ? 'ne-fp-card-psyche' : 'ne-fp-card-line';
        return '<div class="' + cls + '">' + _escapeHtml(line) + '</div>';
    }).join('');

    // 主面板定位链接
    var stmId = stmEntry.id || '';
    var footer = '<div class="ne-fp-card-footer">' +
        '<span class="ne-fp-card-link" data-ne-fp-locate="' + _escapeHtml(stmId) + '">' +
        _escapeHtml(t('floor_panel_locate_in_main')) + ' \u2197</span>' +
        '</div>';

    card.innerHTML = lines + footer;
}

function _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// ─── 挂载单个按钮 ─────────────────────────────────────────
function _mountPanel(mesElement, mesid) {
    if (!mesElement) return;
    if (mesElement.getAttribute('data-ne-fp') === '1') return; // 已挂载
    if (mesElement.querySelector('.ne-fp-host')) return;

    // 只挂 AI 消息（非 user）
    var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx || !ctx.chat) return;
    var message = ctx.chat[mesid];
    if (!message || message.is_user) return;

    var mesText = mesElement.querySelector('.mes_text');
    if (!mesText) return;

    var host = document.createElement('div');
    host.className = 'ne-fp-host';
    host.setAttribute('data-ne-fp-floor', String(mesid));

    var shadowRoot = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = FLOOR_PANEL_CSS;
    shadowRoot.appendChild(style);

    // 按钮（默认折叠态，无摘要时灰显）
    var btn = document.createElement('div');
    btn.className = 'ne-fp-btn ne-fp-empty'; // 初始无摘要态，refresh 后更新
    btn.textContent = '\u2205 ' + t('floor_panel_no_summary');
    shadowRoot.appendChild(btn);

    // 卡片容器（默认隐藏）
    var card = document.createElement('div');
    card.className = 'ne-fp-card';
    card.style.display = 'none';
    shadowRoot.appendChild(card);

    mesText.insertAdjacentElement('afterend', host);
    mesElement.setAttribute('data-ne-fp', '1');

    var state = {
        host: host,
        shadowRoot: shadowRoot,
        btn: btn,
        card: card,
        lastSignature: '',
        isOpen: false,
        stmEntry: null,
    };

    // 按钮点击：切换展开/折叠
    btn.addEventListener('click', function() {
        if (!state.stmEntry) return; // 无摘要不可点
        state.isOpen = !state.isOpen;
        card.style.display = state.isOpen ? 'block' : 'none';
        _renderButton(shadowRoot, !!state.stmEntry, state.isOpen);
        if (state.isOpen) {
            _renderCard(shadowRoot, state.stmEntry, mesid);
        }
    });

    // 卡片内"在主面板查看"链接（事件委托，因 card 内容动态重建）
    card.addEventListener('click', function(ev) {
        var target = ev.target;
        if (target && target.hasAttribute && target.hasAttribute('data-ne-fp-locate')) {
            var stmId = target.getAttribute('data-ne-fp-locate');
            _locateInMainPanel(stmId);
        }
    });

    _mountedHosts.set(mesid, state);

    // 异步查询 STM 并更新按钮状态
    _refreshPanel(mesid);
}

// ─── 主面板定位 ───────────────────────────────────────────
function _locateInMainPanel(stmId) {
    try {
        // 1. 打开底部抽屉（复用 panel-popout.js 的 createVaultPopout，处理了
        //    syncOverlayBounds / resize watcher / .open 类 / vault:updated 渲染）
        var getChatId = _getChatIdFn || function() { return 'default'; };
        createVaultPopout(getChatId);

        // 2. 等 STM 列表渲染后滚动定位（STM 行在 Shadow DOM 内，必须用 panelQS）
        setTimeout(function() {
            var row = panelQS('[data-ne-stm-id="' + stmId + '"]');
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // 高亮闪烁
                row.classList.add('ne-fp-highlight');
                setTimeout(function() { row.classList.remove('ne-fp-highlight'); }, 2000);
            }
        }, 500);
    } catch (e) {
        console.warn('[NE floor-panel] locate failed:', e);
    }
}

// ─── 刷新单个面板 ─────────────────────────────────────────
async function _refreshPanel(mesid) {
    var state = _mountedHosts.get(mesid);
    if (!state) return;
    try {
        var stmEntry = await _findStmForMesid(mesid);
        var sig = stmEntry ? (stmEntry.id + '|' + stmEntry.event) : 'null';
        if (sig === state.lastSignature) return; // 签名未变跳过
        state.lastSignature = sig;
        state.stmEntry = stmEntry;

        // 更新按钮状态
        _renderButton(state.shadowRoot, !!stmEntry, state.isOpen);

        // 若已展开，同步更新卡片内容
        if (state.isOpen && stmEntry) {
            _renderCard(state.shadowRoot, stmEntry, mesid);
        }
    } catch (e) {
        console.warn('[NE floor-panel] refresh failed for mesid=' + mesid, e);
    }
}

// ─── 扫描补挂缺失面板 ─────────────────────────────────────
function _scanMissing() {
    if (!_isEnabled()) return;
    if (_scanTimer) clearTimeout(_scanTimer);
    _scanTimer = setTimeout(function() {
        _scanTimer = null;
        var allMes = document.querySelectorAll('.mes[mesid]');
        allMes.forEach(function(mesEl) {
            var mesid = Number(mesEl.getAttribute('mesid'));
            if (isNaN(mesid)) return;
            _mountPanel(mesEl, mesid);
        });
        // 清理失效条目
        _mountedHosts.forEach(function(state, mesid) {
            if (!document.body.contains(state.host)) {
                _mountedHosts.delete(mesid);
            }
        });
    }, 200);
}

// ─── 事件处理 ─────────────────────────────────────────────
function _onCharacterMessageRendered(mesid) {
    if (!_isEnabled()) return;
    if (mesid == null) return;
    var mesEl = document.querySelector('.mes[mesid="' + mesid + '"]');
    if (mesEl) {
        _mountPanel(mesEl, Number(mesid));
    }
}

function _onChatChanged() {
    // 切换聊天时清空所有已挂面板，等新消息渲染后重新挂
    _mountedHosts.forEach(function(state) { state.host.remove(); });
    _mountedHosts.clear();
    setTimeout(_scanMissing, 300);
}

function _onMessageDeleted() {
    setTimeout(_scanMissing, 100);
}

// ─── 初始化 ───────────────────────────────────────────────
export function initFloorPanel(getChatIdFn) {
    _getChatIdFn = getChatIdFn;

    // 1. 注册 ST 事件
    try {
        var es = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext().eventSource : null;
        if (es) {
            var handler1 = function(_, mesid) { _onCharacterMessageRendered(mesid); };
            es.on('character_message_rendered', handler1);
            _eventUnbinders.push(function() { try { es.off('character_message_rendered', handler1); } catch (e) {} });

            var handler2 = function() { _onChatChanged(); };
            es.on('chat_id_changed', handler2);
            _eventUnbinders.push(function() { try { es.off('chat_id_changed', handler2); } catch (e) {} });

            var handler3 = function() { _onMessageDeleted(); };
            es.on('message_deleted', handler3);
            _eventUnbinders.push(function() { try { es.off('message_deleted', handler3); } catch (e) {} });
        }
    } catch (e) { console.warn('[NE floor-panel] event registration failed:', e); }

    // 2. MutationObserver 兜底
    try {
        var chat = document.getElementById('chat');
        if (chat && typeof MutationObserver !== 'undefined') {
            _mutationObserver = new MutationObserver(function() { _scanMissing(); });
            _mutationObserver.observe(chat, { childList: true, subtree: true });
        }
    } catch (e) { console.warn('[NE floor-panel] MutationObserver failed:', e); }

    // 3. 订阅 vault:updated 刷新所有面板
    _vaultUpdateListener = function() {
        _mountedHosts.forEach(function(state, mesid) { _refreshPanel(mesid); });
    };
    busOn('vault:updated', _vaultUpdateListener);

    // 4. 初始扫描
    setTimeout(_scanMissing, 500);
}

export function destroyFloorPanel() {
    if (_mutationObserver) { _mutationObserver.disconnect(); _mutationObserver = null; }
    _eventUnbinders.forEach(function(fn) { try { fn(); } catch (e) {} });
    _eventUnbinders = [];
    if (_vaultUpdateListener) { busOff('vault:updated', _vaultUpdateListener); _vaultUpdateListener = null; }
    _mountedHosts.forEach(function(state) { state.host.remove(); });
    _mountedHosts.clear();
}

export function refreshAllFloorPanels() {
    _mountedHosts.forEach(function(state, mesid) { _refreshPanel(mesid); });
}

/** 设置开关变化时调用 */
export function onFloorPanelSettingChanged(enabled) {
    if (enabled) {
        initFloorPanel(_getChatIdFn);
    } else {
        destroyFloorPanel();
    }
}
