/**
 * 消息栏记忆按钮 — AI 消息 .extraMesButtons 注入 🧠 按钮。
 *
 * 宿主结构（ST index.html）：.mes_buttons > .extraMesButtons（hover 展开，
 * 天然默认隐藏），按钮即 <div class="mes_button <自有类> fa-solid fa-<icon>">。
 *
 * 点击行为（懒查询——挂载零成本，点击才 readVault）：
 *   - 查询该楼（mesid）归属的全部 STM 条目（msg_ids 确定性匹配 + msgRange 兜底）
 *   - 0 条：打开主面板 + toast「该楼暂无摘要条目」
 *   - N 条：打开主面板 → 定位高亮全部命中行 + 滚动第一条 + 展开第一条详情
 *
 * 宿主环境（Tavern Helper srcdoc iframe）：聊天 DOM 在主文档，
 * 必须用 _chatDoc() 跨文档定位（floor-panel 时代云端实测验证）。
 *
 * 无设置开关：按钮常驻 AI 消息（用户裁决「全删光」）；user 消息不挂；
 * .extraMesButtons 缺失时静默跳过（按钮缺失是最轻失败模式）。
 */

import { readVault } from '../core/vault/store.js';
import { buildMsgId } from '../core/engine/msg-id.js';
// t 必须取 panel-shared 的翻译查询包装（t_narrative）。
// core/i18n.js 的 t 是 locale setter——误用会把 _locale 污染成翻译 key，
// 导致整个面板英文回退（3aba810 回归根因）
import { showToast, t } from './panel-shared.js';
import { createVaultPopout } from './panel-popout.js';
import { locateStmEntries } from './panel-state-cards.js';

var _mutationObserver = null;
var _eventUnbinders = [];
var _getChatIdFn = null;
var _scanTimer = null;
var _lastScanSig = '';

// ─── 文档定位（云端嵌入场景） ─────────────────────────────
// NE 脚本可能跑在与聊天 DOM 不同的 document（Tavern Helper srcdoc iframe）。
// 同源下优先返回持有 #chat 的文档；跨域访问 top 抛错时回退自身。
function _chatDoc() {
    if (document.getElementById('chat')) return document;
    try {
        if (window.top && window.top !== window && window.top.document && window.top.document.getElementById('chat')) {
            return window.top.document;
        }
    } catch (e) {} // 跨域 iframe
    return document;
}

// ─── 从 mesid 查找该楼归属的全部 STM 条目 ─────────────────
// 确定性匹配（非"最匹配"）：msg_ids.indexOf 命中即归属；
// msg_ids 未命中时用 msgRange（绝对消息下标）兜底。
async function _findStmForMesid(mesid) {
    var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx || !ctx.chat) return [];
    var message = ctx.chat[mesid];
    if (!message) return [];
    // 必须用 buildMsgId 构造，与 STM 提取时 msg_ids 存储的格式一致：
    // "{idx}_{send_date}_{role}"，例如 "3_2026-07-09T06:55:00.000Z_user"
    var msgIdStr = buildMsgId(message, mesid);

    var chatId = _getChatIdFn ? _getChatIdFn() : (ctx.chatId || 'default');
    var vault = await readVault(chatId);
    if (!vault || !vault.content) return [];

    var all = (vault.content.unconsolidated_stm || []).concat(vault.content.stm_entries || []);
    var matched = all.filter(function(e) {
        return e.msg_ids && e.msg_ids.indexOf(msgIdStr) !== -1;
    });
    if (matched.length === 0) {
        matched = all.filter(function(e) {
            return e.msgRange && mesid >= e.msgRange[0] && mesid <= e.msgRange[1];
        });
    }
    return matched;
}

// ─── 按钮点击 ─────────────────────────────────────────────
async function _onButtonClick(mesid) {
    try {
        var entries = await _findStmForMesid(mesid);
        var getChatId = _getChatIdFn || function() { return 'default'; };
        createVaultPopout(getChatId);
        if (!entries || entries.length === 0) {
            showToast(t('mes_button_none'), 'info');
            return;
        }
        var ids = entries.map(function(e) { return e.id; }).filter(Boolean);
        // 等 STM 列表渲染后定位（高亮全部 + 滚动第一条 + 展开第一条详情）
        setTimeout(function() { locateStmEntries(ids); }, 500);
    } catch (e) {
        console.warn('[NE mes-button] click handler failed:', e);
    }
}

// ─── 挂载单个按钮 ─────────────────────────────────────────
function _mountButton(mesEl, mesid) {
    if (!mesEl) return false;
    var bar = mesEl.querySelector('.extraMesButtons');
    if (!bar) return false; // 按钮栏缺失：静默跳过

    // 幂等：按钮已在（含 ST 重渲染克隆出的无监听副本）→ 只补绑监听
    var btn = bar.querySelector('.ne-mes-memory');
    if (btn) {
        if (!btn._neMbBound) {
            btn._neMbBound = true;
            btn.addEventListener('click', function() { _onButtonClick(mesid); });
        }
        return false;
    }

    // 仅 AI 消息（user 消息不挂）
    var ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
    if (!ctx || !ctx.chat) return false;
    var message = ctx.chat[mesid];
    if (!message || message.is_user) return false;

    btn = document.createElement('div');
    btn.className = 'mes_button ne-mes-memory fa-solid fa-brain';
    btn.title = t('mes_button_title');
    btn.setAttribute('data-ne-mesid', String(mesid));
    btn._neMbBound = true;
    btn.addEventListener('click', function() { _onButtonClick(mesid); });
    bar.appendChild(btn);
    return true;
}

// ─── 扫描补挂 ─────────────────────────────────────────────
// observer 懒挂：init 时 #chat 可能不存在（云端嵌入/晚渲染），
// 每次扫描自愈补挂——一次性 if(chat) 静默跳过后再无机会
function _ensureObserver() {
    if (_mutationObserver) return;
    if (typeof MutationObserver === 'undefined') return;
    try {
        var chatEl = _chatDoc().getElementById('chat');
        if (!chatEl) return;
        _mutationObserver = new MutationObserver(function() { _scanMissing(); });
        _mutationObserver.observe(chatEl, { childList: true, subtree: true });
    } catch (e) { console.warn('[NE mes-button] MutationObserver attach failed:', e); }
}

function _scanMissing() {
    if (_scanTimer) clearTimeout(_scanTimer);
    _scanTimer = setTimeout(function() {
        _scanTimer = null;
        _ensureObserver();
        var doc = _chatDoc();
        var allMes = doc.querySelectorAll('.mes[mesid]');
        var mounted = 0;
        allMes.forEach(function(mesEl) {
            var mesid = Number(mesEl.getAttribute('mesid'));
            if (isNaN(mesid)) return;
            if (_mountButton(mesEl, mesid)) mounted++;
        });
        // 概要日志：状态变化才打（避免 observer 高频触发下的刷屏）
        var sig = allMes.length + '/' + mounted;
        if (allMes.length > 0 && sig !== _lastScanSig) {
            _lastScanSig = sig;
            console.info('[NE mes-button] scan: total=' + allMes.length + ', mounted=' + mounted);
        }
    }, 200);
}

// ─── 事件处理 ─────────────────────────────────────────────
function _onCharacterMessageRendered(mesid) {
    if (mesid == null) return;
    var mesEl = _chatDoc().querySelector('.mes[mesid="' + mesid + '"]');
    if (mesEl) _mountButton(mesEl, Number(mesid));
}

function _onChatChanged() {
    // 切聊天后 ST 重建消息 DOM（按钮随宿主消失），延迟重扫补挂
    setTimeout(_scanMissing, 300);
}

function _onMessageDeleted() {
    setTimeout(_scanMissing, 100);
}

// ─── 初始化 ───────────────────────────────────────────────
export function initMesButton(getChatIdFn) {
    _getChatIdFn = getChatIdFn;

    // 1. 注册 ST 事件（emitter 签名 (messageId, type)：type 是 'swipe' 等类型字符串）
    try {
        var es = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext().eventSource : null;
        if (es) {
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
    } catch (e) { console.warn('[NE mes-button] event registration failed:', e); }

    // 2. MutationObserver 兜底（懒挂）
    _ensureObserver();

    // 3. 初始扫描：退避重试（500ms/1s/3s/8s）——ST 渲染长聊天是异步分批的，
    //    单次扫描可能在 .mes 渲染完成前扑空。_scanMissing 幂等，重复扫描无害。
    [500, 1000, 3000, 8000].forEach(function(d) {
        setTimeout(_scanMissing, d);
    });
}
