import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_field } from '../core/i18n.js';
import { qs, qsa, byId, pdCreate, t, panelById, panelQS, panelQSA } from './panel-shared.js';

export function initTestRunner() {
    if (!__NE_DEV_MODE) return;
    var container = panelById('ne-tr-container');
    if (!container) return;

    var debug = globalThis.__ne_debug;
    var tests = debug && debug.listTests ? debug.listTests() : [];

    var smokeTests = tests.filter(function(t) { return t.category === 'smoke'; });
    var funcTests = tests.filter(function(t) { return t.category !== 'smoke'; });

    var smokeHtml = '';
    if (smokeTests.length > 0) {
        smokeHtml =
            '<div class="ne-tr-smoke-section">' +
            '<div class="ne-tr-smoke-label">\uD83D\uDD25 ' + t('Smoke Tests') + '</div>' +
            '<select id="ne-tr-smoke-select" class="ne-tr-select">' +
            smokeTests.map(function(t) {
                return '<option value="' + t.name + '">' + t.title + '</option>';
            }).join('') +
            '</select>' +
            '<div class="ne-tr-slider-row">' +
            '<span>\u2699 ' + t('Max Rounds') + ':</span>' +
            '<input type="range" id="ne-tr-smoke-slider" class="ne-tr-slider" min="2" max="30" step="2" value="8">' +
            '<span id="ne-tr-smoke-slider-value" class="ne-tr-slider-value">8</span>' +
            '</div>' +
            '<div class="ne-tr-actions">' +
            '<button id="ne-tr-smoke-run" class="ne-tr-btn">\u25B6 ' + t('Run') + '</button>' +
            '<button id="ne-tr-smoke-export" class="ne-tr-btn" disabled>' + t('Export') + '</button>' +
            '</div>' +
            '</div>';
    }

    var funcHtml = '';
    if (funcTests.length > 0) {
        funcHtml =
            '<div class="ne-tr-smoke-label" style="margin-top:8px;">\uD83E\uDDEA ' + t('Functional Tests') + '</div>' +
            '<select id="ne-tr-func-select" class="ne-tr-select">' +
            funcTests.map(function(t) {
                return '<option value="' + t.name + '">' + t.title + '</option>';
            }).join('') +
            '</select>' +
            '<div class="ne-tr-actions">' +
            '<button id="ne-tr-func-run" class="ne-tr-btn">\u25B6 ' + t('Run') + '</button>' +
            '<button id="ne-tr-func-export" class="ne-tr-btn" disabled>' + t('Export') + '</button>' +
            '</div>';
    }

    container.innerHTML = smokeHtml + funcHtml +
        '<div id="ne-tr-status" class="ne-tr-status">' + t('Select a test case and press Run') + '</div>' +
        '<div id="ne-tr-result" class="ne-tr-result" style="display:none;"></div>' +
        '<pre id="ne-tr-trace" class="ne-tr-trace"></pre>';

    setupTestRunnerEvents();
}

function setupTestRunnerEvents() {
    var slider = panelById('ne-tr-smoke-slider');
    var sliderVal = panelById('ne-tr-smoke-slider-value');
    if (slider && sliderVal) {
        updateSmokeSliderDefault();

        slider.oninput = function() {
            sliderVal.textContent = slider.value;
        };

        var smokeSelect = panelById('ne-tr-smoke-select');
        if (smokeSelect) {
            smokeSelect.onchange = function() {
                updateSmokeSliderDefault();
            };
        }
    }

    var smokeRun = panelById('ne-tr-smoke-run');
    if (smokeRun) {
        smokeRun.onclick = function() {
            var select = panelById('ne-tr-smoke-select');
            var name = select ? select.value : '';
            if (!name) return;
            var slider = panelById('ne-tr-smoke-slider');
            var maxRounds = slider ? parseInt(slider.value, 10) : undefined;
            runTestFromUI(name, maxRounds);
        };
    }

    var smokeExport = panelById('ne-tr-smoke-export');
    if (smokeExport) {
        smokeExport.onclick = function() {
            var select = panelById('ne-tr-smoke-select');
            _exportTestName = select ? select.value : '';
            exportTestResults();
        };
    }

    var funcRun = panelById('ne-tr-func-run');
    if (funcRun) {
        funcRun.onclick = function() {
            var select = panelById('ne-tr-func-select');
            var name = select ? select.value : '';
            if (!name) return;
            runTestFromUI(name);
        };
    }

    var funcExport = panelById('ne-tr-func-export');
    if (funcExport) {
        funcExport.onclick = function() {
            var select = panelById('ne-tr-func-select');
            _exportTestName = select ? select.value : '';
            exportTestResults();
        };
    }
}

function updateSmokeSliderDefault() {
    var select = panelById('ne-tr-smoke-select');
    var slider = panelById('ne-tr-smoke-slider');
    var sliderVal = panelById('ne-tr-smoke-slider-value');
    if (!select || !slider || !sliderVal) return;

    var name = select.value;
    if (!name) return;

    try {
        var debug = globalThis.__ne_debug;
        var meta = debug && debug.getTestCaseMetadata ? debug.getTestCaseMetadata(name) : null;
        if (meta && typeof meta.maxRounds === 'number') {
            slider.value = meta.maxRounds;
            sliderVal.textContent = meta.maxRounds;
        }
    } catch (e) {}
}

var _lastTestResult = null;
var _exportTestName = null;

async function runTestFromUI(name, maxRoundsOverride) {
    var runBtn = panelById('ne-tr-smoke-run') || panelById('ne-tr-func-run');
    var exportBtn = panelById('ne-tr-smoke-export') || panelById('ne-tr-func-export');
    var statusEl = panelById('ne-tr-status');
    var resultEl = panelById('ne-tr-result');
    var traceEl = panelById('ne-tr-trace');
    var debug = globalThis.__ne_debug;

    runBtn.disabled = true;
    exportBtn.disabled = true;
    resultEl.style.display = 'none';
    traceEl.classList.remove('open');
    statusEl.textContent = '\u23F3 ' + (t('Running') + ': ' + name + '...');
    statusEl.className = 'ne-tr-status running';

    try {
        var result = await debug.runTestByName(name, undefined, maxRoundsOverride);
        _lastTestResult = result;

        statusEl.textContent = t('Done') + ' \u2014 ' + (result.roundCount || '?') + ' rounds, ' + ((result.totalDurationMs || 0) / 1000).toFixed(1) + 's';
        statusEl.className = 'ne-tr-status';

        renderTestResult(result, resultEl, traceEl);
        exportBtn.disabled = false;
    } catch (e) {
        statusEl.textContent = t('Error') + ': ' + e.message;
        statusEl.className = 'ne-tr-status';
    } finally {
        runBtn.disabled = false;
    }
}

function renderTestResult(result, resultEl, traceEl) {
    var html = '';

    if (result.structuralResults) {
        html += '<div class="ne-tr-result-header">\u26A0 ' + t('Structural') + '</div>';
        result.structuralResults.forEach(function(r) {
            html += '<div class="ne-tr-result-entry"><span class="' + (r.passed ? 'ne-tr-pass' : 'ne-tr-fail') + '">' + (r.passed ? '\u2714' : '\u2718') + '</span> ' + escapeHtml(r.label) + '</div>';
        });
    }

    if (result.semanticResults && result.semanticResults.length > 0) {
        html += '<div class="ne-tr-result-header">\uD83D\uDCDD ' + t('Semantic') + '</div>';
        result.semanticResults.forEach(function(r) {
            html += '<div class="ne-tr-result-entry"><span class="' + (r.passed ? 'ne-tr-pass' : 'ne-tr-fail') + '">' + (r.passed ? '\u2714' : '\u2718') + '</span> ' + escapeHtml(r.question) + '</div>';
            if (r.evaluation) {
                html += '<div class="ne-tr-semantic">' + escapeHtml(r.evaluation) + '</div>';
            }
        });
    }

    html += '<div class="ne-tr-actions" style="margin-top:6px;">' +
        '<button id="ne-tr-toggle-trace" class="ne-tr-btn">' + t('Show Trace') + '</button>' +
        '</div>';

    resultEl.innerHTML = html;
    resultEl.style.display = 'block';

    var traceContent = (result.trace || result.report || '');
    traceEl.textContent = traceContent;

    panelById('ne-tr-toggle-trace').onclick = function() {
        traceEl.classList.toggle('open');
        this.textContent = traceEl.classList.contains('open') ? t('Hide Trace') : t('Show Trace');
    };
}

async function exportTestResults() {
    if (!_lastTestResult) return;

    try {
        var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('[NE] Export cancelled or failed:', e.message);
        return;
    }

    var ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    var name = _exportTestName || 'test';
    var folder = name;

    try {
        var subDir = await handle.getDirectoryHandle(folder, { create: true });

        if (_lastTestResult.trace) {
            var fh = await subDir.getFileHandle(name + '-' + ts + '-trace.md', { create: true });
            var w = await fh.createWritable();
            await w.write(_lastTestResult.trace);
            await w.close();
        }

        if (_lastTestResult.report) {
            var fh2 = await subDir.getFileHandle(name + '-' + ts + '-report.md', { create: true });
            var w2 = await fh2.createWritable();
            await w2.write(_lastTestResult.report);
            await w2.close();
        }

        panelById('ne-tr-status').textContent = '\u2705 ' + t('Exported to') + ' ' + folder + '/';
    } catch (e) {
        console.error('[NE] Export failed:', e);
        panelById('ne-tr-status').textContent = '\u274C ' + t('Export failed') + ': ' + e.message;
    }
}
