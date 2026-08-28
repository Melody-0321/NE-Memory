import { write, readVault } from '../core/vault/store.js';
import { recordMemoryVersion } from '../core/vault/state-versions.js';
import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { qs, qsa, byId, pdCreate, t, closeVaultOverlay, _currentGetChatId, panelById, panelQS, panelQSA, stopOverlayResizeWatcher } from './panel-shared.js';
import { createVaultPopout } from './panel-popout.js';
import { neSync } from '../core/settings-adapter.js';
import { renderUsageTab } from './panel-usage.js';
import { swipeDecision } from '../ui/gesture-math.js';

export var _currentCollapseState = {};
export var _currentChatIdForCollapse = null;
export function setCurrentChatIdForCollapse(v) { _currentChatIdForCollapse = v; }

export function saveCollapseState(chatId) {
    var state = {};
    panelQSA('#tab-memory .ne-accordion, #tab-state .ne-accordion').forEach(function(acc) {
        if (acc.id) state[acc.id] = acc.classList.contains('open');
    });
    try { var k = 'ne_collapse_' + (chatId || _currentChatIdForCollapse || 'global');
        if (chatId || _currentChatIdForCollapse) localStorage.setItem(k, JSON.stringify(state)); 
        try { neSync(k); } catch (e) {}
    } catch(e) {}
}

export function loadCollapseState(chatId) {
    try {
        var k = 'ne_collapse_' + (chatId || 'global');
        var raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
}

export var _lazyRendered = {};

// ── P2-G2: accordion 开合高度动画（WAAPI，仅点击驱动；恢复/搜索路径瞬时） ──
var _ACC_EASING = 'cubic-bezier(0.4,0,0.2,1)';
function _animateAccordionToggle(acc) {
    try {
        var body = acc.querySelector(':scope > .ne-accordion-body');
        if (!body || typeof body.animate !== 'function') return; // 旧浏览器瞬时降级
        if (acc.classList.contains('open')) {
            // 展开：class 已置 display:block，从 0 动画到自然高度
            var h = body.scrollHeight;
            if (h <= 0) return;
            body.style.overflow = 'hidden';
            var anim = body.animate([{ height: '0px' }, { height: h + 'px' }], { duration: 200, easing: _ACC_EASING });
            anim.onfinish = function () { body.style.overflow = ''; };
        } else {
            // 收起：class 已移除（display:none），先内联撑开再动画回 0
            body.style.display = 'block';
            var h0 = body.scrollHeight;
            if (h0 <= 0) { body.style.display = ''; return; }
            body.style.overflow = 'hidden';
            var anim0 = body.animate([{ height: h0 + 'px' }, { height: '0px' }], { duration: 200, easing: _ACC_EASING });
            anim0.onfinish = function () { body.style.display = ''; body.style.overflow = ''; };
        }
    } catch (e) { /* 动画失败不影响开合语义 */ }
}

export function setupAccordionHandlers(chatId) {
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay || overlay._neAccDel) return;
    overlay._neAccDel = true;
    overlay.addEventListener('click', function(e) {
        var path = e.composedPath();
        var header = null;
        for (var i = 0; i < path.length; i++) {
            if (path[i] && path[i].closest) {
                header = path[i].closest('.ne-vault-tab-content .ne-accordion-header');
                if (header) break;
            }
        }
        if (!header) return;
        var acc = header.closest('.ne-accordion');
        if (!acc) return;
        acc.classList.toggle('open');
        _animateAccordionToggle(acc);
        if (acc.closest('#tab-memory') || acc.closest('#tab-state')) saveCollapseState(chatId);
        if (acc.classList.contains('open') && acc.id && !_lazyRendered[acc.id]) {
            _lazyRendered[acc.id] = true;
        }
    });
    // ── L3: Accordion keyboard support (Enter/Space) ──
    overlay.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var path = e.composedPath();
        var header = null;
        for (var i = 0; i < path.length; i++) {
            if (path[i] && path[i].closest) {
                header = path[i].closest('.ne-accordion-header');
                if (header) break;
            }
        }
        if (!header) return;
        e.preventDefault();
        header.click();
    });
}

// ── P2-G3: 搜索过滤态（模块级 query + 渲染后重放） ──
// oninput 只更新 query 并 debounce 触发 apply；updateVaultViewerPopout 在块重建后
// 调 apply 重放过滤（innerHTML 重建会丢失 ne-search-hidden class）。
var _stateSearchQuery = '';
var _memorySearchQuery = '';

export function setStateSearchQuery(q) { _stateSearchQuery = q; }
export function setMemorySearchQuery(q) { _memorySearchQuery = q; }

export function applyStateSearchFilter() {
    var q = _stateSearchQuery.trim().toLowerCase();
    var hasVisible = false;
    panelQSA('.ne-char-card, .ne-faction-card, .ne-quest-card').forEach(function(card) {
        var text = (card.textContent || '').toLowerCase();
        var visible = !q || text.indexOf(q) !== -1;
        card.classList.toggle('ne-search-hidden', !visible);
        if (visible) hasVisible = true;
    });
    var noMatch = panelById('ne-state-no-match');
    if (!hasVisible && q) {
        if (!noMatch) {
            var div = pdCreate('div');
            div.id = 'ne-state-no-match';
            div.className = 'ne-search-no-match';
            div.textContent = t('No matches found');
            var container = panelById('tab-state');
            if (container) {
                var anchor = panelById('ne-state-search-bar');
                if (anchor) anchor.insertAdjacentElement('afterend', div);
                else container.appendChild(div);
            }
        }
        if (noMatch) noMatch.style.display = '';
    } else {
        if (noMatch) noMatch.style.display = 'none';
    }
}

export function applyMemorySearchFilter() {
    var q = _memorySearchQuery.trim().toLowerCase();
    var hasVisible = false;
    panelQSA('#narrative_vault_panel_stm_body tr, #narrative_vault_panel_ltm_body tr').forEach(function(row) {
        var text = (row.textContent || '').toLowerCase();
        var visible = !q || text.indexOf(q) !== -1;
        row.classList.toggle('ne-search-hidden', !visible);
        if (visible) hasVisible = true;
    });
    var noMatch = panelById('ne-memory-no-match');
    if (!hasVisible && q) {
        if (!noMatch) {
            var div2 = pdCreate('div');
            div2.id = 'ne-memory-no-match';
            div2.className = 'ne-search-no-match';
            div2.textContent = t('No matches found');
            var container2 = panelById('tab-memory');
            if (container2) {
                var anchor2 = panelQS('#tab-memory .ne-search-row');
                if (anchor2) anchor2.insertAdjacentElement('afterend', div2);
                else container2.appendChild(div2);
            }
        }
        if (noMatch) noMatch.style.display = '';
    } else {
        if (noMatch) noMatch.style.display = 'none';
    }
}

export function setupTabSwitching() {
    panelQSA('.ne-vault-tab').forEach(function(tab) {
        tab.onclick = function() {
            var tabName = this.getAttribute('data-tab');
            panelQSA('.ne-vault-tab').forEach(function(t) { t.classList.remove('active'); });
            this.classList.add('active');
            panelQSA('.ne-vault-tab-content').forEach(function(c) { c.classList.remove('active'); });
            var content = panelById('tab-' + tabName);
            if (content) content.classList.add('active');
        };
    });
}

export var _pendingInlineStorage = null;
export function setPendingInlineStorage(v) { _pendingInlineStorage = v; }

// 条目编辑路径兜底：_pendingInlineStorage 缺失时读库再写回，失败则 throw
// 让调用方（inline 保存/删除的 try/catch+toast）反馈。消除原先「!stored
// 静默 return」导致的「编辑了但没保存、界面无任何反应」——与 saveCardFields
// 旧 bug 同款。
async function _loadEntryVault() {
    var stored = _pendingInlineStorage;
    if (stored && stored.vault) return stored;
    var chatId = (_currentGetChatId && typeof _currentGetChatId === 'function') ? _currentGetChatId() : '';
    if (!chatId) throw new Error('no active chat');
    var vault = await readVault(chatId);
    if (!vault) throw new Error('vault not found');
    return { vault: vault, getChatId: function() { return chatId; } };
}

export async function saveSingleEntry(entryType, entryId, updates) {
    var stored = await _loadEntryVault();
    var vault = stored.vault;
    var getChatId = stored.getChatId;
    var c = vault.content || {};
    var list;
    if (entryType === 'stm') list = c.unconsolidated_stm || [];
    else list = c.ltm_entries || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === entryId) {
            Object.keys(updates).forEach(function(k) { list[i][k] = updates[k]; });
            break;
        }
    }
    if (entryType === 'ltm') {
        var stmList = c.stm_entries || [];
        for (var j = 0; j < stmList.length; j++) {
            if (stmList[j].id === entryId) {
                Object.keys(updates).forEach(function(k) { stmList[j][k] = updates[k]; });
                break;
            }
        }
    }
    try {
        await write(getChatId(), vault);
        console.log('[NE] saveSingleEntry: persisted ' + entryType + ' ' + entryId);
    } catch (err) {
        console.error('[NE] saveSingleEntry: write failed for ' + entryType + ' ' + entryId, err);
        throw err;
    }
    recordMemoryVersion(getChatId(), { type: 'manual_edit', summary: '手动编辑 ' + entryType + ' ' + entryId, delta: {}, message_dates: [] }).catch(function(e) { console.warn('[NE] manual_edit version record failed:', e); });
}

export async function deleteSingleEntry(entryType, entryId) {
    var stored = await _loadEntryVault();
    var vault = stored.vault;
    var getChatId = stored.getChatId;
    var c = vault.content || {};
    if (entryType === 'stm') {
        c.unconsolidated_stm = (c.unconsolidated_stm || []).filter(function(e) { return e.id !== entryId; });
        c.stm_entries = (c.stm_entries || []).filter(function(e) { return e.id !== entryId; });
    } else {
        var targetLtm = (c.ltm_entries || []).find(function(e) { return e.id === entryId; });
        var releasedStmIds = targetLtm ? (targetLtm.stm_refs || []) : [];

        var stmEntries = c.stm_entries || [];
        var toRelease = stmEntries.filter(function(s) { return releasedStmIds.indexOf(s.id) !== -1; });
        toRelease.forEach(function(stm) {
            stm.parent_ltm = null;
            if (vault.stm_index && vault.stm_index[stm.id]) {
                vault.stm_index[stm.id].ltm_id = null;
            }
        });

        c.unconsolidated_stm = (c.unconsolidated_stm || []).concat(toRelease);

        c.stm_entries = stmEntries.filter(function(s) { return releasedStmIds.indexOf(s.id) === -1; });

        c.ltm_entries = (c.ltm_entries || []).filter(function(e) { return e.id !== entryId; });
    }
    try {
        await write(getChatId(), vault);
        console.log('[NE] deleteSingleEntry: persisted deletion of ' + entryType + ' ' + entryId);
    } catch (err) {
        console.error('[NE] deleteSingleEntry: write failed for ' + entryType + ' ' + entryId, err);
        throw err;
    }
    recordMemoryVersion(getChatId(), { type: 'manual_edit', summary: '删除 ' + entryType + ' ' + entryId, delta: { stm_removed: [entryId] }, message_dates: [] }).catch(function(e) { console.warn('[NE] manual_edit version record failed:', e); });
}

export function renderMemoryButton(getChatId) {
    if (byId('ne_memory_button')) return;
    var leftSend = byId('leftSendForm');
    if (!leftSend) return;
    var btn = pdCreate('div');
    btn.id = 'ne_memory_button';
    btn.className = 'fa-solid fa-book-bookmark interactable';
    btn.title = t('NE Narrative Engine');
    btn.style.fontSize = 'var(--bottomFormIconSize)';
    btn.onclick = function () { createVaultPopout(getChatId); };
    var extBtn = byId('extensionsMenuButton');
    if (extBtn) {
        extBtn.insertAdjacentElement('afterend', btn);
    } else {
        var optBtn = byId('options_button');
        if (optBtn) optBtn.insertAdjacentElement('afterend', btn);
        else leftSend.appendChild(btn);
    }
}

export function injectStateBanner(messageId) {
    if (globalThis.__ne_injectStateBanner) {
        globalThis.__ne_injectStateBanner(messageId);
    }
}

// ── L3: Mobile gesture swipe-down to close (P2-G1 增强) ──
var _gestureBound = false;
export function setupMobileGestureClose() {
    if (_gestureBound) return;
    var overlay = byId('ne_vault_bottom_overlay');
    if (!overlay) return;
    _gestureBound = true;

    var startY = 0, startX = 0, movedY = 0, tracking = false, dirLocked = false;
    var lastT = 0, lastY = 0, velocity = 0;

    overlay.addEventListener('touchstart', function(e) {
        // 交互元素上不起手（避免吞掉按钮/输入的点击与长按）
        if (e.target.closest && e.target.closest('button,input,a,select,textarea,label')) return;
        if (overlay.scrollTop > 5) return; // 内容未滚到顶部，让原生滚动接管
        tracking = true;
        dirLocked = false;
        movedY = 0; velocity = 0;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastT = e.timeStamp;
        lastY = startY;
        overlay.style.transition = 'none';
    }, { passive: false });
    overlay.addEventListener('touchmove', function(e) {
        if (!tracking) return;
        var dx = e.touches[0].clientX - startX;
        var dy = e.touches[0].clientY - startY;
        // 方向锁定：首个有效 move 横向主导 → 取消追踪（让位横向滚动）
        if (!dirLocked && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            if (Math.abs(dx) > Math.abs(dy)) { tracking = false; overlay.style.transition = ''; overlay.style.transform = ''; return; }
            dirLocked = true;
        }
        movedY = dy;
        // 速度采样（px/ms，最近两点）
        var dt = e.timeStamp - lastT;
        if (dt > 0) { velocity = (e.touches[0].clientY - lastY) / dt; lastT = e.timeStamp; lastY = e.touches[0].clientY; }
        if (movedY > 0) {
            overlay.style.transform = 'translateY(' + movedY + 'px)';
        } else {
            overlay.style.transform = 'translateY(0)';
        }
    }, { passive: false });
    overlay.addEventListener('touchend', function() {
        if (!tracking) return;
        tracking = false;
        if (swipeDecision(movedY, velocity)) {
            overlay.style.transition = '';
            overlay.style.transform = '';
            stopOverlayResizeWatcher();
            overlay.classList.remove('open');
            var tid = setTimeout(function() { overlay.style.display = 'none'; }, 600);
            overlay.addEventListener('transitionend', function h() {
                overlay.removeEventListener('transitionend', h);
                clearTimeout(tid);
                overlay.style.display = 'none';
            });
            var chat = byId('chat');
            if (chat) { chat.style.opacity = ''; chat.style.pointerEvents = ''; chat.style.transition = ''; }
        } else {
            // 回弹：过渡回 translateY(0)，结束后清理内联字段
            overlay.style.transition = 'transform var(--ne-transition-normal) var(--ne-easing-standard)';
            overlay.style.transform = 'translateY(0)';
            var cleanup = function() {
                overlay.removeEventListener('transitionend', cleanup);
                overlay.style.transition = '';
                overlay.style.transform = '';
            };
            overlay.addEventListener('transitionend', cleanup);
            setTimeout(cleanup, 300); // transition 被禁用时的兜底
        }
        movedY = 0;
    });
}
