import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { listStateDeltas, listMemoryVersions, getActiveChain, foldState, foldMemory } from '../core/vault/state-versions.js';
import { readVault, write } from '../core/vault/store.js';
import { qs, qsa, byId, pdCreate, t, PD, closeSlidePanel, emptyStateHtml, busEmit, busOn, busOff } from './panel-shared.js';
import { neSync } from '../core/settings-adapter.js';

var STATE_VERSION_LIMIT_KEY = 'ne_state_version_limit';
var MEM_VERSION_LIMIT_KEY = 'ne_mem_version_limit';
var DEFAULT_LIMIT = 100;

function getConfig() {
    try {
        return JSON.parse(localStorage.getItem('ne_version_config') || '{}');
    } catch (e) { return {}; }
}

function saveConfig(cfg) {
    localStorage.setItem('ne_version_config', JSON.stringify(cfg));
    try { neSync('ne_version_config'); } catch (e) {}
}

/** @param {string} key @returns {number} */
function getLimit(key) {
    var cfg = getConfig();
    return cfg[key] || DEFAULT_LIMIT;
}

var _chatId = null;

var _stateDeltas = [];
var _memVersions = [];
var _chain = null;
var _stateCursor = -1;
var _memCursor = -1;

var _origVault = null;
var _extStateEls = null;
var _extMemEls = null;
var _extNavHandler = null;
var _extNavTimer = null;

function _versionDotClass(isHead, isCursor) {
    if (isHead) return 'ne-version-dot active';
    if (isCursor) return 'ne-version-dot cursor';
    return 'ne-version-dot';
}

function _typeLabel(s) {
    if (s === 'ai_update') return '\u{1F916} AI';
    if (s === 'manual_edit') return '\u{270F} \u624B\u52A8';
    if (s === 'rollback_restore') return '\u{21A9} \u56DE\u9000';
    if (s === 'init') return '\u{1F504} \u521D\u59CB';
    return s;
}

function _memTypeLabel(t) {
    if (t === 'stm_batch') return '\u{1F4E5} STM';
    if (t === 'ltm_consolidation') return '\u{1F4E6} LTM';
    if (t === 'stm_reroll') return '\u{1F504} STM Re-roll';
    if (t === 'ltm_reroll') return '\u{1F504} LTM Re-roll';
    if (t === 'manual_edit') return '\u{270F} \u624B\u52A8';
    if (t === 'init') return '\u{1F504} \u521D\u59CB';
    return t;
}

function _formatTime(ts) {
    if (!ts) return '';
    try {
        var d = new Date(ts);
        var now = Date.now();
        var diff = now - d.getTime();
        if (diff < 60000) return '\u521A\u521A';
        if (diff < 3600000) return Math.floor(diff / 60000) + '\u5206\u949F\u524D';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '\u5C0F\u65F6\u524D';
        return formatLocalTime(ts);
    } catch (e) { return ts; }
}

async function _refreshState(container, keepCursorSeq) {
    if (!_chatId) return;
    try {
        _chain = await getActiveChain(_chatId);
        _stateDeltas = await listStateDeltas(_chatId, 200);
        if (!keepCursorSeq) _stateCursor = _chain ? _chain.state_head_seq : 0;
    } catch (e) {
        _stateDeltas = [];
        _stateCursor = 0;
    }
    _renderStateTimeline(container);
}

async function _refreshMemory(container, keepCursorSeq) {
    if (!_chatId) return;
    try {
        _chain = await getActiveChain(_chatId);
        _memVersions = await listMemoryVersions(_chatId, 200);
        if (!keepCursorSeq) _memCursor = _chain ? _chain.mem_head_seq : 0;
    } catch (e) {
        _memVersions = [];
        _memCursor = 0;
    }
    _renderMemoryTimeline(container);
}

function _renderStateTimeline(container) {
    var body = container.querySelector('#ne-state-timeline-body');
    if (!body) return;

    var headSeq = _chain ? _chain.state_head_seq : 0;
    if (!_stateDeltas.length) {
        body.innerHTML = emptyStateHtml('\u{1F4CB}', '\u6682\u65E0\u7248\u672C\u5386\u53F2', '\u804A\u5929\u540E\u72B6\u6001\u53D8\u66F4\u4F1A\u81EA\u52A8\u8BB0\u5F55');
        return;
    }

    var limit = getLimit(STATE_VERSION_LIMIT_KEY);
    body.closest('.ne-timeline-section').querySelector('.ne-version-limit-info').textContent =
        '\u4FDD\u7559\u8FD1 ' + limit + ' \u4E2A\u7248\u672C';

    var html = '';
    var reversed = _stateDeltas.slice().reverse();
    for (var i = 0; i < reversed.length; i++) {
        var d = reversed[i];
        var isHead = d.seq === headSeq;
        var isCursor = d.seq === _stateCursor;

        html += '<div class="ne-version-item' + (isCursor ? ' ne-version-item-current' : '') + '" data-seq="' + d.seq + '">' +
            '<span class="' + _versionDotClass(isHead, isCursor) + '"></span>' +
            '<div class="ne-version-meta">' +
            '<span class="ne-version-seq">#' + d.seq + '</span>' +
            '<span class="ne-version-type">' + _typeLabel(d.source) + '</span>' +
            '<span class="ne-version-time">' + _formatTime(d.timestamp) + '</span>' +
            '</div>' +
            '<div class="ne-version-summary">' + escapeHtml(d.summary || '') + '</div>';
        if (d.changes && d.changes.length > 0) {
            html += '<div class="ne-version-changes">';
            for (var ci = 0; ci < Math.min(d.changes.length, 5); ci++) {
                var c = d.changes[ci];
                html += '<div class="ne-change-entry">' +
                    '<code class="ne-change-path">' + escapeHtml(c.path) + '</code>' +
                    ': <span class="ne-change-old">' + escapeHtml(String(c.old || '').substring(0, 30)) + '</span>' +
                    ' \u2192 <span class="ne-change-new">' + escapeHtml(String(c.new || '').substring(0, 30)) + '</span>' +
                    '</div>';
            }
            if (d.changes.length > 5) html += '<div class="ne-change-more">...\u7B49 ' + d.changes.length + ' \u9879</div>';
            html += '</div>';
        }
        html += '</div>';
    }
    body.innerHTML = html;
}

function _renderMemoryTimeline(container) {
    var body = container.querySelector('#ne-mem-timeline-body');
    if (!body) return;

    var headSeq = _chain ? _chain.mem_head_seq : 0;
    if (!_memVersions.length) {
        body.innerHTML = emptyStateHtml('\u{1F4CB}', '\u6682\u65E0\u7248\u672C\u5386\u53F2', '\u804A\u5929\u540E\u8BB0\u5FC6\u53D8\u66F4\u4F1A\u81EA\u52A8\u8BB0\u5F55');
        return;
    }

    var limit = getLimit(MEM_VERSION_LIMIT_KEY);
    body.closest('.ne-timeline-section').querySelector('.ne-version-limit-info').textContent =
        '\u4FDD\u7559\u8FD1 ' + limit + ' \u4E2A\u7248\u672C';

    var html = '';
    var reversed = _memVersions.slice().reverse();
    for (var i = 0; i < reversed.length; i++) {
        var v = reversed[i];
        var isHead = v.seq === headSeq;
        var isCursor = v.seq === _memCursor;

        html += '<div class="ne-version-item' + (isCursor ? ' ne-version-item-current' : '') + '" data-seq="' + v.seq + '">' +
            '<span class="' + _versionDotClass(isHead, isCursor) + '"></span>' +
            '<div class="ne-version-meta">' +
            '<span class="ne-version-seq">#' + v.seq + '</span>' +
            '<span class="ne-version-type">' + _memTypeLabel(v.type) + '</span>' +
            '<span class="ne-version-time">' + _formatTime(v.timestamp) + '</span>' +
            '</div>' +
            '<div class="ne-version-summary">' + escapeHtml(v.summary || '') + '</div>';
        html += '</div>';
    }
    body.innerHTML = html;
}

/** @param {HTMLElement} container */
function _renderSettings(container) {
    var stateLimit = getLimit(STATE_VERSION_LIMIT_KEY);
    var memLimit = getLimit(MEM_VERSION_LIMIT_KEY);

    container.querySelector('#ne-state-limit-slider').value = stateLimit;
    container.querySelector('#ne-state-limit-value').textContent = stateLimit;
    container.querySelector('#ne-mem-limit-slider').value = memLimit;
    container.querySelector('#ne-mem-limit-value').textContent = memLimit;
}

async function _saveOrigIfAtHead(type) {
    if (!_chain) return;
    var headSeq = type === 'state' ? _chain.state_head_seq : _chain.mem_head_seq;
    var cursor = type === 'state' ? _stateCursor : _memCursor;
    if (cursor === headSeq && !_origVault) {
        _origVault = await readVault(_chatId);
    }
}

async function _navigateToVersion(targetSeq, type, container) {
    if (!_chatId || !_chain) return;
    var headSeq = type === 'state' ? _chain.state_head_seq : _chain.mem_head_seq;

    try {
        if (targetSeq === headSeq && _origVault) {
            if (type === 'state') {
                globalThis.__ne_pending_state_rollback = null;
                var restoredHeadState = _origVault.content ? _origVault.content.state : null;
                _origVault.content.state = await foldState(_chatId, headSeq, restoredHeadState);
            }
            await write(_chatId, _origVault);
            _origVault = null;
        } else if (targetSeq !== headSeq) {
            await _saveOrigIfAtHead(type);
            if (type === 'state' && targetSeq < headSeq) {
                globalThis.__ne_pending_state_rollback = { chatId: _chatId, targetSeq: targetSeq };
            } else if (type === 'memory' && targetSeq < headSeq) {
                globalThis.__ne_pending_mem_rollback = { chatId: _chatId, targetSeq: targetSeq };
            }
            var vault = _origVault ? JSON.parse(JSON.stringify(_origVault)) : await readVault(_chatId);
            if (type === 'state') {
                var headState = _origVault && _origVault.content ? _origVault.content.state : null;
                vault.content.state = await foldState(_chatId, targetSeq, headState);
            } else {
                var foldedMem = await foldMemory(_chatId, targetSeq);
                vault.content.stm_entries = foldedMem.stm_entries;
                vault.content.unconsolidated_stm = foldedMem.unconsolidated_stm;
                vault.content.ltm_entries = foldedMem.ltm_entries;
            }
            await write(_chatId, vault);
        }
    } catch (e) {
        console.error('[NE] _navigateToVersion failed:', e);
        return;
    }

    if (type === 'state') {
        _stateCursor = targetSeq;
        await _refreshState(container, true);
    } else {
        _memCursor = targetSeq;
        await _refreshMemory(container, true);
    }
    _updateCursorInfo(container, type);
    busEmit('vault:updated', {});
}

export async function renderVersionHistoryPanel(container, chatId) {
    var sameChat = _chatId === chatId;
    _chatId = chatId;

    container.innerHTML =
        '<div class="ne-version-history-root">' +
        '<div class="ne-version-tab-bar">' +
        '<button class="ne-version-tab active" data-vtab="state">' + '\u{1F3AD} State \u7248\u672C' + '</button>' +
        '<button class="ne-version-tab" data-vtab="memory">' + '\u{1F9E0} Memory \u7248\u672C' + '</button>' +
        '<button class="ne-version-tab" data-vtab="settings">' + '\u2699 \u8BBE\u7F6E' + '</button>' +
        '</div>' +

        '<div class="ne-version-scroll-area">' +

        '<div id="vt-pane-state" class="ne-timeline-section" style="display:block;">' +
        '<div class="ne-version-toolbar">' +
        '<button class="ne-version-nav-btn" id="ne-state-rollback-btn" title="\u56DE\u9000\u5230\u4E0A\u4E00\u4E2A\u7248\u672C">\u25C0 \u56DE\u9000</button>' +
        '<span class="ne-version-cursor-info" id="ne-state-cursor-info">\u5F53\u524D: \u6700\u65B0</span>' +
        '<button class="ne-version-nav-btn" id="ne-state-restore-btn" title="\u524D\u8FDB\u5230\u4E0B\u4E00\u4E2A\u7248\u672C">\u524D\u8FDB \u25B6</button>' +
        '<span class="ne-version-limit-info" style="margin-left:auto;font-size:0.75em;color:var(--grey-50);">\u4FDD\u7559\u8FD1 ' + getLimit(STATE_VERSION_LIMIT_KEY) + ' \u4E2A\u7248\u672C</span>' +
        '</div>' +
        '<div id="ne-state-timeline-body" class="ne-version-timeline"></div>' +
        '</div>' +

        '<div id="vt-pane-memory" class="ne-timeline-section" style="display:none;">' +
        '<div class="ne-version-toolbar">' +
        '<button class="ne-version-nav-btn" id="ne-mem-rollback-btn" title="\u56DE\u9000\u5230\u4E0A\u4E00\u4E2A\u7248\u672C">\u25C0 \u56DE\u9000</button>' +
        '<span class="ne-version-cursor-info" id="ne-mem-cursor-info">\u5F53\u524D: \u6700\u65B0</span>' +
        '<button class="ne-version-nav-btn" id="ne-mem-restore-btn" title="\u524D\u8FDB\u5230\u4E0B\u4E00\u4E2A\u7248\u672C">\u524D\u8FDB \u25B6</button>' +
        '<span class="ne-version-limit-info" style="margin-left:auto;font-size:0.75em;color:var(--grey-50);">\u4FDD\u7559\u8FD1 ' + getLimit(MEM_VERSION_LIMIT_KEY) + ' \u4E2A\u7248\u672C</span>' +
        '</div>' +
        '<div id="ne-mem-timeline-body" class="ne-version-timeline"></div>' +
        '</div>' +

        '<div id="vt-pane-settings" class="ne-timeline-section" style="display:none;">' +
        '<div class="ne-version-settings-block">' +
        '<h4>' + '\u{1F3AD} State \u7248\u672C\u4FDD\u7559\u6570' + '</h4>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<input type="range" id="ne-state-limit-slider" min="10" max="500" step="10" value="' + getLimit(STATE_VERSION_LIMIT_KEY) + '" style="flex:1;">' +
        '<span id="ne-state-limit-value" style="font-weight:bold;min-width:2em;text-align:right;">' + getLimit(STATE_VERSION_LIMIT_KEY) + '</span>' +
        '</div>' +
        '<div style="font-size:0.75em;color:var(--grey-70);margin-top:4px;">' +
            '\u8D85\u8FC7\u9650\u5236\u540E\uFF0C\u65E7\u7248\u672C\u5C06\u81EA\u52A8\u538B\u7F29\u5230 base \u7248\u672C\u3002\u538B\u7F29\u540E\u56DE\u9000\u4ECD\u53EF\u7528\uFF0C\u4F46\u7C92\u5EA6\u53D8\u7C97\u3002' +
        '</div>' +
        '</div>' +
        '<div class="ne-version-settings-block">' +
        '<h4>' + '\u{1F9E0} Memory \u7248\u672C\u4FDD\u7559\u6570' + '</h4>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<input type="range" id="ne-mem-limit-slider" min="10" max="500" step="10" value="' + getLimit(MEM_VERSION_LIMIT_KEY) + '" style="flex:1;">' +
        '<span id="ne-mem-limit-value" style="font-weight:bold;min-width:2em;text-align:right;">' + getLimit(MEM_VERSION_LIMIT_KEY) + '</span>' +
        '</div>' +
        '<div style="font-size:0.75em;color:var(--grey-70);margin-top:4px;">' +
            '\u8D85\u8FC7\u9650\u5236\u540E\uFF0C\u65E7\u7248\u672C\u5C06\u81EA\u52A8\u538B\u7F29\u5230 base \u7248\u672C\u3002\u538B\u7F29\u540E\u56DE\u9000\u4ECD\u53EF\u7528\uFF0C\u4F46\u7C92\u5EA6\u53D8\u7C97\u3002' +
        '</div>' +
        '</div>' +
        '</div>' +

        '</div></div>';

    _renderSettings(container);
    await _refreshState(container, sameChat);
    await _refreshMemory(container, sameChat);

    var tabs = container.querySelectorAll('.ne-version-tab');
    tabs.forEach(function(t) {
        t.onclick = function() {
            tabs.forEach(function(x) { x.classList.remove('active'); });
            t.classList.add('active');
            var pane = t.getAttribute('data-vtab');
            container.querySelector('#vt-pane-state').style.display = pane === 'state' ? 'block' : 'none';
            container.querySelector('#vt-pane-memory').style.display = pane === 'memory' ? 'block' : 'none';
            container.querySelector('#vt-pane-settings').style.display = pane === 'settings' ? 'block' : 'none';
        };
    });

    var stateRollback = container.querySelector('#ne-state-rollback-btn');
    if (stateRollback) stateRollback.onclick = async function() {
        if (_stateDeltas.length < 2) return;
        var currentIdx = _stateDeltas.findIndex(function(d) { return d.seq === _stateCursor; });
        if (currentIdx < 0) return;
        var targetIdx = currentIdx + 1;
        if (targetIdx >= _stateDeltas.length) return;
        await _navigateToVersion(_stateDeltas[targetIdx].seq, 'state', container);
    };

    var stateRestore = container.querySelector('#ne-state-restore-btn');
    if (stateRestore) stateRestore.onclick = async function() {
        if (!_stateDeltas.length) return;
        var currentIdx = _stateDeltas.findIndex(function(d) { return d.seq === _stateCursor; });
        if (currentIdx <= 0) return;
        await _navigateToVersion(_stateDeltas[currentIdx - 1].seq, 'state', container);
    };

    var memRollback = container.querySelector('#ne-mem-rollback-btn');
    if (memRollback) memRollback.onclick = async function() {
        if (_memVersions.length < 2) return;
        var currentIdx = _memVersions.findIndex(function(v) { return v.seq === _memCursor; });
        if (currentIdx < 0) return;
        var targetIdx = currentIdx + 1;
        if (targetIdx >= _memVersions.length) return;
        await _navigateToVersion(_memVersions[targetIdx].seq, 'memory', container);
    };

    var memRestore = container.querySelector('#ne-mem-restore-btn');
    if (memRestore) memRestore.onclick = async function() {
        if (!_memVersions.length) return;
        var currentIdx = _memVersions.findIndex(function(v) { return v.seq === _memCursor; });
        if (currentIdx <= 0) return;
        await _navigateToVersion(_memVersions[currentIdx - 1].seq, 'memory', container);
    };

    var stateSlider = container.querySelector('#ne-state-limit-slider');
    if (stateSlider) stateSlider.oninput = function() {
        var v = parseInt(stateSlider.value, 10);
        container.querySelector('#ne-state-limit-value').textContent = v;
        var cfg = getConfig();
        cfg[STATE_VERSION_LIMIT_KEY] = v;
        saveConfig(cfg);
        var info = container.querySelector('#vt-pane-state .ne-version-limit-info');
        if (info) info.textContent = '\u4FDD\u7559\u8FD1 ' + v + ' \u4E2A\u7248\u672C';
    };

    var memSlider = container.querySelector('#ne-mem-limit-slider');
    if (memSlider) memSlider.oninput = function() {
        var v = parseInt(memSlider.value, 10);
        container.querySelector('#ne-mem-limit-value').textContent = v;
        var cfg = getConfig();
        cfg[MEM_VERSION_LIMIT_KEY] = v;
        saveConfig(cfg);
        var info = container.querySelector('#vt-pane-memory .ne-version-limit-info');
        if (info) info.textContent = '\u4FDD\u7559\u8FD1 ' + v + ' \u4E2A\u7248\u672C';
    };
}

function _updateCursorInfo(container, type) {
    var headSeq = _chain ? _chain[type + '_head_seq'] : 0;
    var info = container.querySelector('#ne-' + type + '-cursor-info');
    if (!info) return;
    var cursor = type === 'state' ? _stateCursor : _memCursor;
    _setCursorText(info, cursor, headSeq);
}

function _setCursorText(el, cursor, headSeq) {
    if (cursor === headSeq || cursor === 0) {
        el.textContent = '\u5F53\u524D: \u6700\u65B0';
    } else {
        el.textContent = '\u5F53\u524D: #' + cursor;
    }
}

function _updateNavButtonState(el, disabled) {
    if (el) el.disabled = !!disabled;
}

export async function initVersionNavButtons(chatId, stateEls, memEls) {
    _chatId = chatId;
    if (!_chatId) return;

    var headStateSeq = 0, headMemSeq = 0;

    async function _reloadChains() {
        if (!_chatId) return false;
        try {
            _chain = await getActiveChain(_chatId);
            _stateDeltas = _chain ? await listStateDeltas(_chatId, getLimit(STATE_VERSION_LIMIT_KEY)) : [];
            _memVersions = _chain ? await listMemoryVersions(_chatId, getLimit(MEM_VERSION_LIMIT_KEY)) : [];
        } catch (e) {
            console.warn('[NE] initVersionNavButtons: failed to reload chains', e);
            return false;
        }
        if (_chain) {
            headStateSeq = _chain.state_head_seq;
            headMemSeq = _chain.mem_head_seq;
        }
        if (_stateCursor === 0 || _stateCursor === -1) _stateCursor = headStateSeq;
        if (_memCursor === 0 || _memCursor === -1) _memCursor = headMemSeq;
        return true;
    }

    function _refreshUI(type, els) {
        var deltas = type === 'state' ? _stateDeltas : _memVersions;
        var cursor = type === 'state' ? _stateCursor : _memCursor;
        var headSeq = type === 'state' ? headStateSeq : headMemSeq;
        var seqs = deltas.map(function(d) { return d.seq; });
        var idx = seqs.indexOf(cursor);
        var hasVersions = seqs.length > 0;
        if (els.rollbackBtn) {
            if (!hasVersions) { els.rollbackBtn.disabled = true; }
            else { _updateNavButtonState(els.rollbackBtn, idx >= seqs.length - 1); }
        }
        if (els.restoreBtn) {
            if (!hasVersions) { els.restoreBtn.disabled = true; }
            else { _updateNavButtonState(els.restoreBtn, idx <= 0); }
        }
        if (els.cursorInfo) _setCursorText(els.cursorInfo, cursor, headSeq);
    }

    async function _doNavigate(type, targetSeq, els) {
        if (!_chatId || !_chain) return;
        var headSeq = type === 'state' ? _chain.state_head_seq : _chain.mem_head_seq;
        try {
            if (targetSeq === headSeq && _origVault) {
                if (type === 'state') globalThis.__ne_pending_state_rollback = null;
                else globalThis.__ne_pending_mem_rollback = null;
                await write(_chatId, _origVault);
                _origVault = null;
            } else if (targetSeq !== headSeq) {
                await _saveOrigIfAtHead(type);
                if (type === 'state' && targetSeq < headSeq) {
                    globalThis.__ne_pending_state_rollback = { chatId: _chatId, targetSeq: targetSeq };
                } else if (type === 'memory' && targetSeq < headSeq) {
                    globalThis.__ne_pending_mem_rollback = { chatId: _chatId, targetSeq: targetSeq };
                }
                var vault = _origVault ? JSON.parse(JSON.stringify(_origVault)) : await readVault(_chatId);
                if (type === 'state') {
                    var headState = _origVault && _origVault.content ? _origVault.content.state : null;
                    vault.content.state = await foldState(_chatId, targetSeq, headState);
                } else {
                    var foldedMem = await foldMemory(_chatId, targetSeq);
                    vault.content.stm_entries = foldedMem.stm_entries;
                    vault.content.unconsolidated_stm = foldedMem.unconsolidated_stm;
                    vault.content.ltm_entries = foldedMem.ltm_entries;
                }
                await write(_chatId, vault);
            }
            if (type === 'state') _stateCursor = targetSeq;
            else _memCursor = targetSeq;
        } catch (e) {
            console.error('[NE] version nav failed:', type, e);
            return;
        }
        _refreshUI(type, els);
        busEmit('vault:updated', {});
    }

    // Initial load
    if (!await _reloadChains()) return;
    _refreshUI('state', stateEls);
    _refreshUI('memory', memEls);

    // State — reload chain on every click so button state reflects latest versions
    if (stateEls.rollbackBtn) stateEls.rollbackBtn.onclick = async function() {
        if (!await _reloadChains()) return;
        _refreshUI('state', stateEls);
        var seqs = _stateDeltas.map(function(d) { return d.seq; });
        var idx = seqs.indexOf(_stateCursor);
        if (idx < seqs.length - 1) await _doNavigate('state', seqs[idx + 1], stateEls);
    };
    if (stateEls.restoreBtn) stateEls.restoreBtn.onclick = async function() {
        if (!await _reloadChains()) return;
        _refreshUI('state', stateEls);
        var seqs = _stateDeltas.map(function(d) { return d.seq; });
        var idx = seqs.indexOf(_stateCursor);
        if (idx > 0) await _doNavigate('state', seqs[idx - 1], stateEls);
    };

    // Memory — same pattern
    if (memEls.rollbackBtn) memEls.rollbackBtn.onclick = async function() {
        if (!await _reloadChains()) return;
        _refreshUI('memory', memEls);
        var seqs = _memVersions.map(function(d) { return d.seq; });
        var idx = seqs.indexOf(_memCursor);
        if (idx < seqs.length - 1) await _doNavigate('memory', seqs[idx + 1], memEls);
    };
    if (memEls.restoreBtn) memEls.restoreBtn.onclick = async function() {
        if (!await _reloadChains()) return;
        _refreshUI('memory', memEls);
        var seqs = _memVersions.map(function(d) { return d.seq; });
        var idx = seqs.indexOf(_memCursor);
        if (idx > 0) await _doNavigate('memory', seqs[idx - 1], memEls);
    };

    // 保存引用供 bus 监听使用
    _extStateEls = stateEls;
    _extMemEls = memEls;
    if (_extNavHandler) busOff('vault:updated', _extNavHandler);
    _extNavHandler = function() {
        if (_extNavTimer !== null) clearTimeout(_extNavTimer);
        _extNavTimer = setTimeout(async function() {
            _extNavTimer = null;
            if (!_chatId) return;
            try {
                _chain = await getActiveChain(_chatId);
                _stateDeltas = _chain ? await listStateDeltas(_chatId, getLimit(STATE_VERSION_LIMIT_KEY)) : [];
                _memVersions = _chain ? await listMemoryVersions(_chatId, getLimit(MEM_VERSION_LIMIT_KEY)) : [];
            } catch (e) { return; }
            var hs = _chain ? _chain.state_head_seq : 0;
            var hm = _chain ? _chain.mem_head_seq : 0;
            if (_extStateEls) {
                var ss = _stateDeltas.map(function(d) { return d.seq; });
                var si = ss.indexOf(_stateCursor);
                _extStateEls.rollbackBtn && (_extStateEls.rollbackBtn.disabled = ss.length === 0 || si >= ss.length - 1);
                _extStateEls.restoreBtn && (_extStateEls.restoreBtn.disabled = ss.length === 0 || si <= 0);
                _extStateEls.cursorInfo && _setCursorText(_extStateEls.cursorInfo, _stateCursor, hs);
            }
            if (_extMemEls) {
                var ms = _memVersions.map(function(d) { return d.seq; });
                var mi = ms.indexOf(_memCursor);
                _extMemEls.rollbackBtn && (_extMemEls.rollbackBtn.disabled = ms.length === 0 || mi >= ms.length - 1);
                _extMemEls.restoreBtn && (_extMemEls.restoreBtn.disabled = ms.length === 0 || mi <= 0);
                _extMemEls.cursorInfo && _setCursorText(_extMemEls.cursorInfo, _memCursor, hm);
            }
        }, 300);
    };
    busOn('vault:updated', _extNavHandler);
}
