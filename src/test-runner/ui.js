export function renderTestRunnerTab(container) {
    container.innerHTML =
        '<div style="padding:8px 12px;">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
        '<select id="ne-test-case-select" style="flex:1;padding:4px 8px;' +
        'font-size:0.9em;background:var(--inputBG,#333);color:var(--text,#ddd);border:1px solid var(--SmartThemeBorderColor);border-radius:4px;">' +
        '<option value="">-- Select test case --</option>' +
        '</select>' +
        '<button id="ne-test-run-btn" disabled style="padding:4px 16px;cursor:pointer;border:none;border-radius:4px;' +
        'background:var(--cobalt,#4a6cf7);color:#fff;font-size:0.9em;">Run</button>' +
        '</div>' +
        '<div id="ne-test-status" style="font-size:0.85em;color:var(--grey-50,#888);margin-bottom:6px;">Idle</div>' +
        '<div id="ne-test-progress-bar" style="height:3px;background:var(--SmartThemeBorderColor);border-radius:2px;margin-bottom:8px;overflow:hidden;">' +
        '<div id="ne-test-progress-fill" style="width:0%;height:100%;background:var(--cobalt,#4a6cf7);transition:width .3s;"></div>' +
        '</div>' +
        '<div id="ne-test-results" style="font-size:0.85em;line-height:1.6;"></div>' +
        '<div style="margin-top:8px;display:flex;gap:8px;">' +
        '<button id="ne-test-download-btn" disabled style="padding:4px 12px;cursor:pointer;border:none;border-radius:4px;' +
        'background:var(--SmartThemeBodyColor,#555);color:var(--text,#ddd);font-size:0.85em;">Download Report</button>' +
        '<span id="ne-test-export-path" style="font-size:0.75em;color:var(--grey-70,#666);align-self:center;"></span>' +
        '</div>' +
        '</div>';

    var select = container.querySelector('#ne-test-case-select');
    var runBtn = container.querySelector('#ne-test-run-btn');
    var statusEl = container.querySelector('#ne-test-status');
    var progressFill = container.querySelector('#ne-test-progress-fill');
    var resultsEl = container.querySelector('#ne-test-results');
    var downloadBtn = container.querySelector('#ne-test-download-btn');
    var exportPathEl = container.querySelector('#ne-test-export-path');

    var lastReport = null;

    loadPresets(select);

    select.onchange = function() {
        runBtn.disabled = !this.value;
    };

    runBtn.onclick = function() {
        if (runBtn.textContent === 'Running...') return;
        runTest(select.value, statusEl, progressFill, resultsEl, runBtn, downloadBtn, exportPathEl);
    };

    downloadBtn.onclick = function() {
        if (!lastReport) return;
        var blob = new Blob([lastReport.report], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = lastReport.reportName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 100);

        var traceBlob = new Blob([lastReport.trace], { type: 'text/markdown;charset=utf-8' });
        var traceUrl = URL.createObjectURL(traceBlob);
        var ta = document.createElement('a');
        ta.href = traceUrl;
        ta.download = lastReport.traceName;
        document.body.appendChild(ta);
        ta.click();
        document.body.removeChild(ta);
        setTimeout(function() { URL.revokeObjectURL(traceUrl); }, 100);
    };
}

function loadPresets(select) {
    try {
        var presets = globalThis.__ne_debug && globalThis.__ne_debug._testPresets;
        if (presets) {
            var keys = Object.keys(presets);
            keys.sort();
            for (var i = 0; i < keys.length; i++) {
                var p = presets[keys[i]];
                var opt = document.createElement('option');
                opt.value = keys[i];
                opt.textContent = p.title || keys[i];
                select.appendChild(opt);
            }
        }
    } catch (e) {
        console.warn('[NE-TEST-UI] Failed to load presets:', e);
    }
}

async function runTest(presetKey, statusEl, progressFill, resultsEl, runBtn, downloadBtn, exportPathEl) {
    runBtn.disabled = true;
    runBtn.textContent = 'Running...';
    statusEl.textContent = 'Connecting...';
    resultsEl.innerHTML = '';
    downloadBtn.disabled = true;
    exportPathEl.textContent = '';

    var presetKeyRef = presetKey;

    try {
        var prevLog = globalThis.__ne_debug && globalThis.__ne_debug._testPresets && globalThis.__ne_debug._testPresets[presetKeyRef];
        if (!prevLog) throw new Error('Test case not found: ' + presetKeyRef);

        var result = await globalThis.__ne_debug.runTest(prevLog);

        statusEl.textContent = 'Done (' + (result.duration || '?') + 's)';
        progressFill.style.width = '100%';

        var hasFail = false;
        var resultLines = [];

        if (result.structuralResults && result.structuralResults.length) {
            resultLines.push('<div style="margin:4px 0;"><b>Structural:</b></div>');
            for (var i = 0; i < result.structuralResults.length; i++) {
                var sr = result.structuralResults[i];
                var pass = sr.pass !== false;
                if (!pass) hasFail = true;
                resultLines.push('<div style="margin:1px 0;padding-left:12px;font-size:0.85em;color:' +
                    (pass ? '#4caf50' : '#f44336') + ';">' +
                    (pass ? '[PASS]' : '[FAIL]') + ' ' + escapeHtml(sr.label || sr.description || sr.name || '') +
                    '</div>');
            }
        }

        if (result.semanticResults && result.semanticResults.length) {
            resultLines.push('<div style="margin:4px 0;"><b>Semantic:</b></div>');
            for (var j = 0; j < result.semanticResults.length; j++) {
                var sr2 = result.semanticResults[j];
                var pass2 = sr2.pass !== false;
                if (!pass2) hasFail = true;
                resultLines.push('<div style="margin:1px 0;padding-left:12px;font-size:0.85em;color:' +
                    (pass2 ? '#4caf50' : '#f44336') + ';">' +
                    (pass2 ? '[PASS]' : '[FAIL]') + ' ' + escapeHtml(sr2.description || '') +
                    '</div>');
                if (sr2.evaluation && !pass2) {
                    resultLines.push('<div style="padding-left:24px;font-size:0.8em;color:var(--grey-50,#888);">' +
                        escapeHtml((sr2.evaluation || '').substring(0, 200)) + '</div>');
                }
            }
        }

        if (resultLines.length === 0) {
            resultLines.push('<div style="color:var(--grey-50,#888);">No structured results returned.</div>');
        }

        resultLines.push('<div style="margin-top:6px;font-size:0.85em;color:var(--grey-50,#888);">Rounds: ' +
            (result.rounds || '?') + ' | Duration: ' + (result.duration || '?') + 's</div>');

        resultsEl.innerHTML = '<div style="padding:4px 0;">' +
            '<div style="font-size:1em;font-weight:bold;margin-bottom:4px;color:' +
            (hasFail ? '#f44336' : '#4caf50') + ';">' +
            (hasFail ? 'FAILED' : 'PASSED') + '</div>' +
            resultLines.join('') + '</div>';

        if (result.trace && result.report) {
            var testName = prevLog.name || presetKeyRef;
            var testFolder = prevLog.folder || testName;
            var ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
            lastReport = {
                trace: result.trace,
                report: result.report,
                traceName: testName + '-' + ts + '-trace.md',
                reportName: testName + '-' + ts + '-report.md',
                folder: testFolder
            };
            downloadBtn.disabled = false;
            exportPathEl.textContent = 'test-cases/' + testFolder + '/';
        }

    } catch (e) {
        statusEl.textContent = 'Error: ' + e.message;
        resultsEl.innerHTML = '<div style="color:#f44336;font-size:0.85em;">' + escapeHtml(e.message) + '</div>';
        console.error('[NE-TEST-UI] Run failed:', e);
    }

    runBtn.textContent = 'Run';
    runBtn.disabled = false;
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
