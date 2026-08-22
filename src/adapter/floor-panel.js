/**
 * 楼内摘要面板 — 按钮展开式（参考柏宝书 floorPanel.ts 的 DOM 挂载策略）。
 *
 * NE 与柏宝书的关键差异：
 *   - 柏宝书：摘要嵌在 chat[N].extra.bbs_leaf，1:1 严格对应，面板直接读消息属性
 *   - NE：STM 数据存在外部 vault（IndexedDB），按 msg_ids 反查定位所属 STM
 *
 * 挂载位置：.mes_text 的 afterend（下一个兄弟），与柏宝书一致，不嵌入 ST 按钮行。
 *
 * 交互模型（v2，摘要扩容 74 字后适配，参考柏宝书交互模式）：
 *   - 折叠态：▸ 按钮 + 2 行 clamp 事件预览（收起也有信息 scent）/ ∅ 灰显（无摘要不可点）
 *   - 展开态：▼ 按钮 + grid 0fr↔1fr 抽屉（chips 元信息 + 事件全文 + 心理行）+ "在主面板查看 ↗"链接
 *   - 抽屉内容常驻 DOM（收起态也渲染），vault:updated 触发刷新同步更新
 *   - 样式表共享：adoptedStyleSheets 一次解析 N 楼复用（柏宝书同款），不可用时回退每楼 <style>
 *
 * 默认关闭：设置开关 floorPanelEnabled（panel-settings.js）。
 */

import { readVault } from '../core/vault/store.js';
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
.ne-fp-head {
    margin-top: 6px;
}
.ne-fp-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
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

/* 收起态事件预览：2 行 clamp（74 字摘要常态下的信息 scent） */
.ne-fp-preview {
    margin-top: 3px;
    font-size: 0.78em;
    line-height: 1.45;
    color: var(--SmartThemeBodyColor, #666);
    opacity: 0.75;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    cursor: pointer;
}
.ne-fp-preview.is-hidden { display: none; }

/* 抽屉：grid 0fr↔1fr 高度过渡，内容常驻不脱流（柏宝书同款） */
.ne-fp-drawer {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.25s ease;
}
.ne-fp-drawer.is-open { grid-template-rows: 1fr; }
.ne-fp-drawer-inner {
    overflow: hidden;
    min-height: 0;
}

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

/* 元信息 chips 行：时间 / 场景 / 在场角色 */
.ne-fp-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
}
.ne-fp-chip {
    display: inline-block;
    padding: 1px 8px;
    border: 1px solid var(--SmartThemeQuoteColor, #ccc);
    border-radius: 10px;
    font-size: 0.88em;
    opacity: 0.85;
    white-space: nowrap;
}
.ne-fp-text {
    word-break: break-word;
}
.ne-fp-psyche {
    margin: 2px 0 0 16px;
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

@media (prefers-reduced-motion: reduce) {
    .ne-fp-drawer { transition: none; }
}
`;

// ─── 共享样式表（adoptedStyleSheets 一次解析 N 楼复用） ──
var _sharedSheet = null;
function _ensureSharedSheet() {
    if (_sharedSheet) return _sharedSheet;
    if (typeof CSSStyleSheet === 'undefined') return null;
    try {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(FLOOR_PANEL_CSS);
        _sharedSheet = sheet;
    } catch (e) {
        _sharedSheet = null;
    }
    return _sharedSheet;
}

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

// ─── 渲染收起态事件预览（2 行 clamp，展开态隐藏避免与全文重复） ──
function _renderPreview(state) {
    var entry = state.stmEntry;
    var show = !!(entry && (entry.event || entry.summary)) && !state.isOpen;
    state.preview.classList.toggle('is-hidden', !show);
    if (show) state.preview.textContent = entry.event || entry.summary;
}

// ─── 渲染抽屉卡片内容（从 stmEntry 字段直取，不经过 formatStmEntry——
//     注入侧共用格式化器需全文单行形态，此处为 UI 结构化渲染） ──
function _renderCard(shadowRoot, stmEntry, mesid) {
    var card = shadowRoot.querySelector('.ne-fp-card');
    if (!card) return;

    if (!stmEntry) {
        card.innerHTML = '<div>' + _escapeHtml(t('floor_panel_no_summary')) + '</div>';
        return;
    }

    // chips 行：时间 / 场景 / 在场角色（兼容旧 entities）
    var chips = [];
    if (stmEntry.period) chips.push('\uD83D\uDD52 ' + stmEntry.period);
    if (stmEntry.scene) chips.push('\uD83D\uDCCD ' + stmEntry.scene);
    var present = stmEntry.present_characters || stmEntry.entities || [];
    if (present && present.length > 0) {
        var names = present.map(function(p) { return typeof p === 'string' ? p : p.name; }).filter(Boolean);
        if (names.length > 0) chips.push('\uD83D\uDC64 ' + names.join('\u3001'));
    }
    var chipsHtml = chips.length > 0
        ? '<div class="ne-fp-chips">' + chips.map(function(c) {
            return '<span class="ne-fp-chip">' + _escapeHtml(c) + '</span>';
        }).join('') + '</div>'
        : '';

    // 事件全文
    var textHtml = '<div class="ne-fp-text">' + _escapeHtml(stmEntry.event || stmEntry.summary || '') + '</div>';

    // 角色心理（兼容旧 _inner_thoughts：{角色名: [想法...]}）
    var psycheHtml = '';
    var psyche = stmEntry.character_psyche;
    var psycheLines = [];
    if (psyche && Object.keys(psyche).length > 0) {
        Object.keys(psyche).forEach(function(name) {
            var p = psyche[name] || {};
            var mood = p.current_mood || '';
            var thoughts = p.inner_thoughts || '';
            if (mood || thoughts) {
                psycheLines.push(name + (mood ? ' [' + mood + ']' : '') + (thoughts ? ': ' + thoughts : ''));
            }
        });
    } else if (stmEntry._inner_thoughts && Object.keys(stmEntry._inner_thoughts).length > 0) {
        Object.keys(stmEntry._inner_thoughts).forEach(function(name) {
            var thoughtsArr = stmEntry._inner_thoughts[name] || [];
            if (thoughtsArr.length > 0) {
                psycheLines.push(name + ' 内心: ' + thoughtsArr.join(' \u2192 '));
            }
        });
    }
    psycheHtml = psycheLines.map(function(l) {
        return '<div class="ne-fp-psyche">' + _escapeHtml(l) + '</div>';
    }).join('');

    // footer：主面板定位链接
    var stmId = stmEntry.id || '';
    var footer = '<div class="ne-fp-card-footer">' +
        '<span class="ne-fp-card-link" data-ne-fp-locate="' + _escapeHtml(stmId) + '">' +
        _escapeHtml(t('floor_panel_locate_in_main')) + ' \u2197</span>' +
        '</div>';

    card.innerHTML = chipsHtml + textHtml + psycheHtml + footer;
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
    if (!ctx || !ctx.chat) { console.warn('[NE floor-panel] mount 跳过 mesid=' + mesid + ': getContext/chat 不可用'); return; }
    var message = ctx.chat[mesid];
    if (!message) { console.warn('[NE floor-panel] mount 跳过 mesid=' + mesid + ': chat[' + mesid + '] 不存在'); return; }
    if (message.is_user) return;

    var mesText = mesElement.querySelector('.mes_text');
    if (!mesText) { console.warn('[NE floor-panel] mount 跳过 mesid=' + mesid + ': .mes_text 未找到'); return; }

    var host = document.createElement('div');
    host.className = 'ne-fp-host';
    host.setAttribute('data-ne-fp-floor', String(mesid));

    var shadowRoot = host.attachShadow({ mode: 'open' });

    // 样式：优先共享样式表（一次解析 N 楼复用），失败回退每楼 <style> 副本
    var sheet = _ensureSharedSheet();
    if (sheet) {
        try {
            shadowRoot.adoptedStyleSheets = [sheet];
        } catch (e) { sheet = null; }
    }
    if (!sheet) {
        var style = document.createElement('style');
        style.textContent = FLOOR_PANEL_CSS;
        shadowRoot.appendChild(style);
    }

    // head（点击开合锚点）：按钮 + 事件预览
    var head = document.createElement('div');
    head.className = 'ne-fp-head';

    var btn = document.createElement('div');
    btn.className = 'ne-fp-btn ne-fp-empty'; // 初始无摘要态，refresh 后更新
    btn.textContent = '\u2205 ' + t('floor_panel_no_summary');
    head.appendChild(btn);

    var preview = document.createElement('div');
    preview.className = 'ne-fp-preview is-hidden'; // 无摘要/展开态隐藏，refresh 后更新
    head.appendChild(preview);

    shadowRoot.appendChild(head);

    // 抽屉（grid 0fr↔1fr 过渡；内容常驻 DOM，收起态也渲染）
    var drawer = document.createElement('div');
    drawer.className = 'ne-fp-drawer';
    var drawerInner = document.createElement('div');
    drawerInner.className = 'ne-fp-drawer-inner';
    var card = document.createElement('div');
    card.className = 'ne-fp-card';
    drawerInner.appendChild(card);
    drawer.appendChild(drawerInner);
    shadowRoot.appendChild(drawer);

    mesText.insertAdjacentElement('afterend', host);
    mesElement.setAttribute('data-ne-fp', '1');

    var state = {
        host: host,
        shadowRoot: shadowRoot,
        head: head,
        btn: btn,
        preview: preview,
        drawer: drawer,
        card: card,
        lastSignature: '',
        isOpen: false,
        stmEntry: null,
    };

    // head 点击：切换展开/折叠（无摘要不可点）
    head.addEventListener('click', function() {
        if (!state.stmEntry) return;
        state.isOpen = !state.isOpen;
        drawer.classList.toggle('is-open', state.isOpen);
        _renderButton(shadowRoot, !!state.stmEntry, state.isOpen);
        _renderPreview(state);
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

    // 异步查询 STM 并更新按钮/预览/抽屉内容
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
        // 签名含 chips 字段（scene/period），元信息变更也触发刷新
        var sig = stmEntry
            ? [stmEntry.id, stmEntry.event, stmEntry.scene, stmEntry.period].join('|')
            : 'null';
        if (sig === state.lastSignature) return; // 签名未变跳过
        state.lastSignature = sig;
        state.stmEntry = stmEntry;

        // 更新按钮状态
        _renderButton(state.shadowRoot, !!stmEntry, state.isOpen);

        // 预览行 + 抽屉内容常驻渲染（收起态也渲染，供 grid 动画与刷新同步）
        _renderPreview(state);
        if (stmEntry) {
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
    console.info('[NE floor-panel] init: es=' +
        ((typeof SillyTavern !== 'undefined' && SillyTavern.getContext && SillyTavern.getContext().eventSource) ? 'yes' : 'no') +
        ', #chat=' + (document.getElementById('chat') ? 'yes' : 'no'));

    // 1. 注册 ST 事件
    try {
        var es = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext().eventSource : null;
        if (es) {
            // ST emitter 签名 (messageId, type)：type 是 'swipe' 等类型字符串，
            // 旧代码 function(_, mesid) 误把 type 当 mesid → 永远扑空（2026-08-22 修复）
            var handler1 = function(messageId, type) { _onCharacterMessageRendered(messageId); };
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

    // 4. 初始扫描：退避重试（500ms/1s/3s/8s）——ST 渲染长聊天是异步分批的，
    //    单次扫描可能在 .mes 渲染完成前扑空。_scanMissing 幂等（data-ne-fp 标记），
    //    重复扫描无害；每次输出诊断日志，断点直接可见。
    var delays = [500, 1000, 3000, 8000];
    delays.forEach(function(d, i) {
        setTimeout(function() {
            var before = _mountedHosts.size;
            _scanMissing();
            var mounted = _mountedHosts.size - before;
            var mesCount = document.querySelectorAll('.mes[mesid]').length;
            console.info('[NE floor-panel] scan#' + (i + 1) + ': .mes=' + mesCount + ', 新挂=' + mounted + ', 已挂总=' + _mountedHosts.size + (mesCount > 0 && _mountedHosts.size === 0 ? ' [WARN] 有消息但零挂载——见上方 mount 层日志' : ''));
        }, d);
    });
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
