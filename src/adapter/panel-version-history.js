import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { listStateDeltas, listMemoryVersions, getActiveChain, rollbackState, rollbackMemory, restoreBranch } from '../core/vault/state-versions.js';
import { openDB } from '../core/vault/store.js';
import { qs, qsa, byId, pdCreate, t, PD, closeSlidePanel, emptyStateHtml, busEmit } from './panel-shared.js';

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

function _versionDotClass(isHead) {
    return 'ne-version-dot' + (isHead ? ' active' : '');
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

async function _refreshState(container) {
    if (!_chatId) return;
    try {
        _chain = await getActiveChain(_chatId);
        _stateDeltas = await listStateDeltas(_chatId, 200);
        _stateCursor = _chain ? _chain.state_head_seq : 0;
    } catch (e) {
        _stateDeltas = [];
        _stateCursor = 0;
    }
    _renderStateTimeline(container);
}

async function _refreshMemory(container) {
    if (!_chatId) return;
    try {
        _chain = await getActiveChain(_chatId);
        _memVersions = await listMemoryVersions(_chatId, 200);
        _memCursor = _chain ? _chain.mem_head_seq : 0;
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
            '<span class="' + _versionDotClass(isHead) + '"></span>' +
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
            '<span class="' + _versionDotClass(isHead) + '"></span>' +
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

async function _applyRollback(targetSeq, type) {
    if (!_chatId) return;
    try {
        if (type === 'state') {
            await rollbackState(_chatId, targetSeq);
        } else {
            await rollbackMemory(_chatId, targetSeq);
        }
        busEmit('vault:updated', {});
    } catch (e) {
        console.warn('[NE] Rollback failed:', e);
    }
}

async function _applyRestore(branchId, type) {
    if (!_chatId) return;
    try {
        await restoreBranch(_chatId, branchId);
        _chain = await getActiveChain(_chatId);
        busEmit('vault:updated', {});
    } catch (e) {
        console.warn('[NE] Restore failed:', e);
    }
}

async function _listBranches(chatId, type) {
    try {
        var db = await openDB();
        return await new Promise(function(resolve, reject) {
            var tx = db.transaction(['orphaned_branches'], 'readonly');
            var result = [];
            tx.objectStore('orphaned_branches').openCursor().onsuccess = function(e) {
                var cursor = e.target.result;
                if (cursor) {
                    var b = cursor.value;
                    if (b.chat_id === chatId && b.type === type) result.push(b);
                    cursor.continue();
                } else { resolve(result); }
            };
            tx.onerror = function() { reject(tx.error); };
        });
    } catch (e) { return []; }
}

export async function renderVersionHistoryPanel(container, chatId) {
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
    await _refreshState(container);
    await _refreshMemory(container);

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
        var targetIdx = currentIdx - 1;
        if (targetIdx < 0) targetIdx = 0;
        var targetSeq = _stateDeltas[targetIdx].seq;
        await _applyRollback(targetSeq, 'state');
        _stateCursor = targetSeq;
        _renderStateTimeline(container);
        _updateCursorInfo(container, 'state');
    };

    var stateRestore = container.querySelector('#ne-state-restore-btn');
    if (stateRestore) stateRestore.onclick = async function() {
        try {
            var branches = await _listBranches(_chatId, 'state');
            var branch = branches.find(function(b) { return b.fork_point_seq === _stateCursor; });
            if (branch) {
                await _applyRestore(branch.id, 'state');
                _stateCursor = _chain ? _chain.state_head_seq : 0;
                await _refreshState(container);
                _updateCursorInfo(container, 'state');
            }
        } catch (e) { console.warn('[NE] State restore failed:', e); }
    };

    var memRollback = container.querySelector('#ne-mem-rollback-btn');
    if (memRollback) memRollback.onclick = async function() {
        if (_memVersions.length < 2) return;
        var currentIdx = _memVersions.findIndex(function(v) { return v.seq === _memCursor; });
        var targetIdx = currentIdx - 1;
        if (targetIdx < 0) targetIdx = 0;
        var targetSeq = _memVersions[targetIdx].seq;
        await _applyRollback(targetSeq, 'memory');
        _memCursor = targetSeq;
        _renderMemoryTimeline(container);
        _updateCursorInfo(container, 'memory');
    };

    var memRestore = container.querySelector('#ne-mem-restore-btn');
    if (memRestore) memRestore.onclick = async function() {
        try {
            var branches = await _listBranches(_chatId, 'memory');
            var branch = branches.find(function(b) { return b.fork_point_seq === _memCursor; });
            if (branch) {
                await _applyRestore(branch.id, 'memory');
                _memCursor = _chain ? _chain.mem_head_seq : 0;
                await _refreshMemory(container);
                _updateCursorInfo(container, 'memory');
            }
        } catch (e) { console.warn('[NE] Memory restore failed:', e); }
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
    if (cursor === headSeq || cursor === 0) {
        info.textContent = '\u5F53\u524D: \u6700\u65B0';
    } else {
        info.textContent = '\u5F53\u524D: #' + cursor;
    }
}
