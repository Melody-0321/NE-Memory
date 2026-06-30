import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { isStateSchemaEnabled, setStateSchemaEnabled } from '../core/vault/schema.js';
import { testSecondaryApiConnection, sendSecondaryTestMessage,
  saveSecondaryApiConfig, loadSecondaryApiConfig,
  loadRetrievalApiConfig, saveRetrievalApiConfig,
  isApiSplitMode, setApiSplitMode } from '../core/api/llm.js';
import { loadEmbeddingApiConfig, saveEmbeddingApiConfig,
         testEmbeddingApiConnection, isVectorSearchEnabled, runVectorQualityTest } from '../core/engine/embedding.js';
import { setAuto, isAuto, computeStmBatch, getTelemetryStats } from '../core/params.js';
import { qs, qsa, byId, pdCreate, pdHead, pdAddEventListener, t } from './panel-shared.js';

export function renderSettingsTab() {
    var container = byId('ne_common_settings');
    var advContainer = byId('ne_advanced_settings');
    if (!container) return;
    var settings = {};
    try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}
    var mc = settings.memoryConfig || {};
    var secApi = {};
    try { var rawApi = localStorage.getItem('ne_secondary_api'); if (rawApi) secApi = JSON.parse(rawApi); } catch (e) {}
    var apiSplitMode = isApiSplitMode();
    var retApi = {};
    if (apiSplitMode) {
        try { var rawRet = localStorage.getItem('ne_retrieval_api'); if (rawRet) retApi = JSON.parse(rawRet); } catch (e) {}
    }
    var embApi = {};
    try { var rawEmb = localStorage.getItem('ne_embedding_api'); if (rawEmb) embApi = JSON.parse(rawEmb); } catch (e) {}
    var enableVectorSearch = settings.enableVectorSearch || false;
    var statusDot = '<span class="ne-status-dot" style="color:#4caf50;">\u25CF</span>';

    // === Common Settings ===
    var stmBatchAuto = isAuto('stmBatch');
    var computedBatch = computeStmBatch(getTelemetryStats().turnsPerEvent);
    var displayBatch = stmBatchAuto ? computedBatch : (settings.stmBatch || 10);
    var commonHtml = '<div class="ne-accordion open" id="ne-set-engine">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Engine') + ' ' + statusDot + '</div>' +
        '<div class="ne-accordion-body">' +
        '<div class="ne-settings-toggle-grid">' +
        '<label><input type="checkbox" id="nes_enable_state_schema" ' + (settings.enableStateSchema ? 'checked' : '') + '> <span>' + t('Enable State Schema') + '</span></label>' +
        '<label><input type="checkbox" id="nes_enable_retrieval" ' + (settings.retrievalEnabled ? 'checked' : '') + '> <span>' + t('Enable Smart Retrieval') + '</span></label>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Memory Budget') + '</span><span class="range-val" id="nes_budget_val">' + (settings.memoryBudget || 800) + ' tok</span></div>' +
        '<input type="range" id="nes_memory_budget" min="500" max="2000" step="100" value="' + (settings.memoryBudget || 800) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Controls max context tokens for memory injection. Higher = more memories visible, higher API cost.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;">' +
            '<span>' + t('STM Extraction Batch') + '</span>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
                '<label style="font-size:0.8em;display:flex;align-items:center;gap:3px;cursor:pointer;">' +
                    '<input type="checkbox" id="nes_stm_batch_auto" ' + (stmBatchAuto ? 'checked' : '') + '> Auto' +
                '</label>' +
                '<span class="range-val" id="nes_stm_batch_val">' + displayBatch + '</span>' +
            '</div>' +
        '</div>' +
        '<input type="range" id="nes_stm_batch" min="1" max="30" step="1" value="' + displayBatch + '" style="width:100%;"' + (stmBatchAuto ? ' disabled' : '') + '>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Memory extraction uses LLM to detect natural scene boundaries, not fixed message counts. This is only a hard cap — unprocessed messages beyond this force extraction. A low value makes it behave like a fixed threshold.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Max Unconsolidated STM') + '</span><span class="range-val" id="nes_stm_unconsolidated_val">' + (settings.stmMaxUnconsolidated || 5) + '</span></div>' +
        '<input type="range" id="nes_stm_max_unconsolidated" min="2" max="30" step="1" value="' + (settings.stmMaxUnconsolidated || 5) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('dialog_round_injection_control') + '</span><span class="range-val" id="nes_dialog_window_val">' + (settings.dialogWindowRounds || 10) + '</span></div>' +
        '<input type="range" id="nes_dialog_window_rounds" min="2" max="20" step="1" value="' + (settings.dialogWindowRounds || 10) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Controls how many recent dialog rounds are sent to the LLM. As an alternative to the default token-budget truncation (maxContext), this ensures the LLM always sees a fixed number of recent dialog rounds.') + '</div>' +
        '<div style="margin:0 0 8px;">' +
            '<label style="font-size:0.8em;display:flex;align-items:center;gap:3px;cursor:pointer;">' +
                '<input type="checkbox" id="nes_dialog_override_enabled" ' + (settings.dialogOverrideEnabled ? 'checked' : '') + '> ' + t('override_st_context_window_limit') +
            '</label>' +
            '<div style="color:var(--grey50);font-size:0.75em;">' + t('Disable ST token-budget truncation, using dialog rounds as the sole context control.') + '</div>' +
        '</div>' +
        '</div></div>' +
        '<div class="ne-accordion open" id="ne-set-api">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Secondary API') + '</div>' +
        '<div class="ne-accordion-body">' +
        '<div class="ne-settings-toggle-grid" style="margin-bottom:8px;">' +
        '<label><input type="checkbox" id="nes_api_split" ' + (apiSplitMode ? 'checked' : '') + '> <span>' + t('Separate API for Retrieval') + '</span></label>' +
        '</div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 12px;">' + t('Split retrieval from maintenance API. Maintenance handles STM/State/LTM extraction; retrieval handles Smart Push / recall.') + '</div>' +
        (apiSplitMode ?
            // ── Split mode ──
            '<div style="margin-bottom:12px;padding:8px;border:1px solid var(--grey20);border-radius:6px;">' +
            '<div style="font-weight:600;margin-bottom:6px;">\u25C8 ' + t('Maintenance API (Pipeline)') + '</div>' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">STM / State / LTM extraction. Needs faithful structured output, no tool calling required.</div>' +
            '<div class="ne-settings-grid">' +
            '<div><label>' + t('API URL') + '</label><input type="text" id="nes_pipeline_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(secApi.url || '') + '"></div>' +
            '<div><label>' + t('API Key') + '</label><input type="password" id="nes_pipeline_key" placeholder="sk-..." value="' + escapeHtml(secApi.key || '') + '"></div>' +
            '<div><label>' + t('Model') + '</label><input type="text" id="nes_pipeline_model" placeholder="deepseek-v4-flash" value="' + escapeHtml(secApi.model || '') + '"></div>' +
            '</div>' +
            '<div><button class="ne-api-btn" id="nes_pipeline_connect">' + t('Connect') + '</button></div>' +
            '<div class="ne-api-status"><span class="ne-api-dot" id="nes_pipeline_dot"></span><span id="nes_pipeline_status_text">' + t('Not connected') + '</span></div>' +
            '</div>' +
            '<div style="padding:8px;border:1px solid var(--grey20);border-radius:6px;">' +
            '<div style="font-weight:600;margin-bottom:6px;">\u25C8 ' + t('Retrieval API (Smart Push)') + '</div>' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">Smart Push / recall_memory. Needs long context + function calling.</div>' +
            '<div class="ne-settings-grid">' +
            '<div><label>' + t('API URL') + '</label><input type="text" id="nes_retrieval_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(retApi.url || '') + '"></div>' +
            '<div><label>' + t('API Key') + '</label><input type="password" id="nes_retrieval_key" placeholder="sk-..." value="' + escapeHtml(retApi.key || '') + '"></div>' +
            '<div><label>' + t('Model') + '</label><input type="text" id="nes_retrieval_model" placeholder="deepseek-v4-flash" value="' + escapeHtml(retApi.model || '') + '"></div>' +
            '</div>' +
            '<div><button class="ne-api-btn" id="nes_retrieval_connect">' + t('Connect') + '</button><button class="ne-api-btn" id="nes_retrieval_test">' + t('Test Message') + '</button></div>' +
            '<div class="ne-api-status"><span class="ne-api-dot" id="nes_retrieval_dot"></span><span id="nes_retrieval_status_text">' + t('Not connected') + '</span></div>' +
            '</div>'
            :
            // ── Unified mode ──
            '<div class="ne-settings-grid">' +
            '<div><label>' + t('API URL') + '</label><input type="text" id="nes_secondary_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(secApi.url || '') + '"></div>' +
            '<div><label>' + t('API Key') + '</label><input type="password" id="nes_secondary_key" placeholder="sk-..." value="' + escapeHtml(secApi.key || '') + '"></div>' +
            '<div><label>' + t('Model') + '</label><input type="text" id="nes_secondary_model" placeholder="deepseek-v4-flash" value="' + escapeHtml(secApi.model || '') + '"></div>' +
            '</div>' +
            '<div><button class="ne-api-btn" id="nes_api_connect">' + t('Connect') + '</button><button class="ne-api-btn" id="nes_api_test">' + t('Test Message') + '</button></div>' +
            '<div class="ne-api-status"><span class="ne-api-dot" id="nes_api_dot"></span><span id="nes_api_status_text">' + t('Not connected') + '</span></div>'
        ) +
        '</div></div>' +
        // ── Embedding API (Vector Search) ──
        '<div class="ne-accordion" id="ne-set-embedding">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Vector Search (Embedding API)') + '</div>' +
        '<div class="ne-accordion-body">' +
        '<div class="ne-settings-toggle-grid" style="margin-bottom:8px;">' +
        '<label><input type="checkbox" id="nes_enable_vector_search" ' + (enableVectorSearch ? 'checked' : '') + '> <span>' + t('Enable Vector Search') + '</span></label>' +
        '</div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 12px;">' + t('Requires an OpenAI-compatible Embedding API. When disabled or unconfigured, falls back to BM25-only retrieval.') +
        '<br><span style="color:var(--green50);">' + t('Recommended: free BAAI/bge-m3 on SiliconFlow. Register at siliconflow.cn for an API key, then click one-key fill below.') + '</span></div>' +
        (enableVectorSearch ?
            '<div class="ne-settings-grid">' +
            '<div><label>' + t('API URL') + '</label><input type="text" id="nes_embedding_url" placeholder="https://api.siliconflow.cn/v1/embeddings" value="' + escapeHtml(embApi.url || '') + '"></div>' +
            '<div><label>' + t('API Key') + '</label><input type="password" id="nes_embedding_key" placeholder="sk-..." value="' + escapeHtml(embApi.key || '') + '"></div>' +
            '<div><label>' + t('Model') + '</label><input type="text" id="nes_embedding_model" placeholder="BAAI/bge-m3" value="' + escapeHtml(embApi.model || '') + '"></div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<button class="ne-api-btn" id="nes_embedding_connect">' + t('Connect') + '</button>' +
            '<button class="ne-api-btn" id="nes_embedding_preset" style="font-size:0.8em;opacity:0.85;" title="' + t('Pre-fill URL & Model with free SiliconFlow bge-m3') + '">' + t('One-key fill') + '</button>' +
            '</div>' +
            '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;">' +
            '<button class="ne-api-btn" id="nes_embedding_quality" style="font-size:0.9em;" title="' + t('Run a semantic retrieval quality test: embed a test set, query with a similar text, verify the correct result ranks highest.') + '">' + t('Quality Test') + '</button>' +
            '<span id="nes_embedding_quality_status" style="font-size:0.75em;color:var(--grey50);"></span>' +
            '</div>' +
            '<div class="ne-api-status"><span class="ne-api-dot" id="nes_embedding_dot"></span><span id="nes_embedding_status_text">' + t('Not connected') + '</span></div>'
            : '') +
        '</div></div>';
    container.innerHTML = commonHtml;

    // Auto-initialize API status if config exists (from auto-connect on page load)
    if (apiSplitMode) {
        if (retApi.url && retApi.model) {
            setTimeout(function () {
                var dot = byId('nes_retrieval_dot'), text = byId('nes_retrieval_status_text');
                testSecondaryApiConnection(retApi).then(function (r) {
                    if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                    if (text) text.textContent = r.success ? (t('Connected') + ': ' + retApi.model) : (t('Not connected') + ' — ' + (r.error || ''));
                });
            }, 100);
        }
        if (secApi.url && secApi.model) {
            setTimeout(function () {
                var dot = byId('nes_pipeline_dot'), text = byId('nes_pipeline_status_text');
                testSecondaryApiConnection(secApi).then(function (r) {
                    if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                    if (text) text.textContent = r.success ? (t('Connected') + ': ' + secApi.model) : (t('Not connected') + ' — ' + (r.error || ''));
                });
            }, 100);
        }
    } else {
        if (secApi.url && secApi.model) {
            setTimeout(function () {
                var dot = byId('nes_api_dot'), text = byId('nes_api_status_text');
                testSecondaryApiConnection(secApi).then(function (r) {
                    if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                    if (text) text.textContent = r.success ? (t('Connected') + ': ' + secApi.model) : (t('Not connected') + ' — ' + (r.error || ''));
                    var hdr = byId('narrative_secondary_api_status');
                    if (hdr) { hdr.style.color = r.success ? '#4caf50' : '#666'; hdr.textContent = r.success ? '\u26A1' : ''; hdr.title = r.success ? 'Secondary API: ' + secApi.model : 'No secondary API configured'; }
                });
            }, 100);
        }
    }
    if (enableVectorSearch && embApi.url && embApi.model) {
        setTimeout(function () {
            var dot = byId('nes_embedding_dot'), text = byId('nes_embedding_status_text');
            testEmbeddingApiConnection(embApi).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + embApi.model + ' (' + r.dimensions + 'd)') : (t('Not connected') + ' — ' + (r.error || ''));
            });
        }, 100);
    }

    // === Advanced Settings ===
    if (advContainer) {
        var advHtml = '<div class="ne-accordion" id="ne-set-memory">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Memory Parameters') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<div class="ne-settings-grid">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Extraction Temperature (rec. 0.2)') + '</span><span class="range-val" id="nes_extraction_temp_val">' + (mc.extraction_temperature || mc.temperature || 0.2).toFixed(1) + '</span></div>' +
            '<input type="range" id="nes_extraction_temperature" min="0" max="1" step="0.1" value="' + (mc.extraction_temperature || mc.temperature || 0.2) + '" style="width:100%;">' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('STM/State/LTM memory extraction. Lower = more consistent summaries.') + '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Retrieval Temperature (rec. 0.3)') + '</span><span class="range-val" id="nes_retrieval_temp_val">' + (mc.retrieval_temperature || mc.temperature || 0.3).toFixed(1) + '</span></div>' +
            '<input type="range" id="nes_retrieval_temperature" min="0" max="1" step="0.1" value="' + (mc.retrieval_temperature || mc.temperature || 0.3) + '" style="width:100%;">' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Smart retrieval and tool queries. Higher = more creative answers.') + '</div>' +
            '</div></div></div>' +
            '<div class="ne-accordion" id="ne-set-schema">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Schema Editors') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<label>' + t('State Schema') + ' (Global)</label><textarea id="nes_state_schema" rows="6">' + escapeHtml(settings.stateSchema ? JSON.stringify(settings.stateSchema, null, 2) : '') + '</textarea>' +
            '<label>' + t('Character Schema') + '</label><textarea id="nes_character_schema" rows="6">' + escapeHtml(settings.characterSchema ? JSON.stringify(settings.characterSchema, null, 2) : '') + '</textarea>' +
            '</div></div>';
        advContainer.innerHTML = advHtml;
    }

    // --- Event bindings (save on every change) ---
    // Range sliders — update value display + save
    var tEl = byId('nes_extraction_temperature');
    if (tEl) { tEl.oninput = function () { var v = byId('nes_extraction_temp_val'); if (v) v.textContent = Number(tEl.value).toFixed(1); saveSettingsTab(); }; }
    var rEl = byId('nes_retrieval_temperature');
    if (rEl) { rEl.oninput = function () { var v = byId('nes_retrieval_temp_val'); if (v) v.textContent = Number(rEl.value).toFixed(1); saveSettingsTab(); }; }
    var bEl = byId('nes_memory_budget');
    if (bEl) { bEl.oninput = function () { var v = byId('nes_budget_val'); if (v) v.textContent = bEl.value; saveSettingsTab(); }; }
    var sbEl = byId('nes_stm_batch');
    if (sbEl) { sbEl.oninput = function () { var v = byId('nes_stm_batch_val'); if (v) v.textContent = sbEl.value; saveSettingsTab(); }; }
    var suEl = byId('nes_stm_max_unconsolidated');
    if (suEl) { suEl.oninput = function () { var v = byId('nes_stm_unconsolidated_val'); if (v) v.textContent = suEl.value; saveSettingsTab(); }; }
    var cwEl = byId('nes_dialog_window_rounds');
    if (cwEl) { cwEl.oninput = function () { var v = byId('nes_dialog_window_val'); if (v) v.textContent = cwEl.value; saveSettingsTab(); }; }
    var ovEl = byId('nes_dialog_override_enabled');
    if (ovEl) { ovEl.onchange = function () { saveSettingsTab(); }; }
    // Checkboxes — save on change
    var chkState = byId('nes_enable_state_schema');
    if (chkState) chkState.onchange = function () { saveSettingsTab(); };
    var chkRetrieval = byId('nes_enable_retrieval');
    if (chkRetrieval) chkRetrieval.onchange = function () { saveSettingsTab(); };
    // Auto toggles — save to params auto map and re-render
    var autoSb = byId('nes_stm_batch_auto');
    if (autoSb) {
        autoSb.onchange = function () {
            setAuto('stmBatch', autoSb.checked);
            renderSettingsTab();
        };
    }
    // Textareas — save on blur (not every keystroke to avoid perf issues)
    var ta1 = byId('nes_state_schema');
    if (ta1) ta1.onblur = function () { saveSettingsTab(); };
    var ta2 = byId('nes_character_schema');
    if (ta2) ta2.onblur = function () { saveSettingsTab(); };
    // Secondary API inputs — save on blur
    // ── API split toggle ──
    var splitToggle = byId('nes_api_split');
    if (splitToggle) {
        splitToggle.onchange = function () {
            setApiSplitMode(splitToggle.checked);
            renderSettingsTab(); // 重渲染以切换表单
        };
    }

    var apiSplitModeNow = isApiSplitMode();
    if (apiSplitModeNow) {
        // ── Split mode handlers ──
        // Pipeline auto-save
        var pUrlEl = byId('nes_pipeline_url');
        if (pUrlEl) pUrlEl.onchange = function () { saveSecApiOnly(); };
        var pKeyEl = byId('nes_pipeline_key');
        if (pKeyEl) pKeyEl.onchange = function () { saveSecApiOnly(); };
        var pModelEl = byId('nes_pipeline_model');
        if (pModelEl) pModelEl.onchange = function () { saveSecApiOnly(); };
        var pConnBtn = byId('nes_pipeline_connect');
        if (pConnBtn) pConnBtn.onclick = function () {
            var cfg = { url: byId('nes_pipeline_url').value.trim(), key: byId('nes_pipeline_key').value.trim(), model: byId('nes_pipeline_model').value.trim() };
            saveSecondaryApiConfig(cfg);
            var dot = byId('nes_pipeline_dot'), text = byId('nes_pipeline_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (pConnBtn) pConnBtn.disabled = true;
            testSecondaryApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model) : (t('Not connected') + ' — ' + (r.error || ''));
                if (pConnBtn) pConnBtn.disabled = false;
            });
        };

        // Retrieval auto-save
        var rUrlEl = byId('nes_retrieval_url');
        if (rUrlEl) rUrlEl.onchange = function () { saveRetApiOnly(); };
        var rKeyEl = byId('nes_retrieval_key');
        if (rKeyEl) rKeyEl.onchange = function () { saveRetApiOnly(); };
        var rModelEl = byId('nes_retrieval_model');
        if (rModelEl) rModelEl.onchange = function () { saveRetApiOnly(); };
        var rConnBtn = byId('nes_retrieval_connect');
        if (rConnBtn) rConnBtn.onclick = function () {
            var cfg = { url: byId('nes_retrieval_url').value.trim(), key: byId('nes_retrieval_key').value.trim(), model: byId('nes_retrieval_model').value.trim() };
            saveRetrievalApiConfig(cfg);
            var dot = byId('nes_retrieval_dot'), text = byId('nes_retrieval_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (rConnBtn) rConnBtn.disabled = true;
            testSecondaryApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model) : (t('Not connected') + ' — ' + (r.error || ''));
                if (rConnBtn) rConnBtn.disabled = false;
            });
        };
        var rTestBtn = byId('nes_retrieval_test');
        if (rTestBtn) rTestBtn.onclick = function () {
            var cfg = { url: byId('nes_retrieval_url').value.trim(), key: byId('nes_retrieval_key').value.trim(), model: byId('nes_retrieval_model').value.trim() };
            if (!cfg.url) { alert('Please enter an API URL first.'); return; }
            if (rTestBtn) rTestBtn.disabled = true;
            sendSecondaryTestMessage(cfg).then(function () {
                typeof toastr !== 'undefined' && toastr.success(t('API connection successful!'));
                if (rTestBtn) rTestBtn.disabled = false;
            }).catch(function (e) {
                typeof toastr !== 'undefined' && toastr.error(t('API connection failed. Check browser console (F12) for details.'));
                if (rTestBtn) rTestBtn.disabled = false;
            });
        };
    } else {
        // ── Unified mode handlers ──
        var urlEl = byId('nes_secondary_url');
        if (urlEl) urlEl.onchange = function () { saveSecApiOnly(); };
        var keyEl = byId('nes_secondary_key');
        if (keyEl) keyEl.onchange = function () { saveSecApiOnly(); };
        var modelEl = byId('nes_secondary_model');
        if (modelEl) modelEl.onchange = function () { saveSecApiOnly(); };
        var connBtn = byId('nes_api_connect');
        if (connBtn) connBtn.onclick = function () {
            var cfg = { url: byId('nes_secondary_url').value.trim(), key: byId('nes_secondary_key').value.trim(), model: byId('nes_secondary_model').value.trim() };
            saveSecondaryApiConfig(cfg);
            var dot = byId('nes_api_dot'), text = byId('nes_api_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (connBtn) connBtn.disabled = true;
            testSecondaryApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model) : (t('Not connected') + ' — ' + (r.error || ''));
                if (connBtn) connBtn.disabled = false;
                var hdr = byId('narrative_secondary_api_status');
                if (hdr) { hdr.style.color = r.success ? '#4caf50' : '#666'; hdr.textContent = r.success ? '\u26A1' : ''; hdr.title = r.success ? 'Secondary API: ' + cfg.model : 'No secondary API configured'; }
            });
        };
        var testBtn = byId('nes_api_test');
        if (testBtn) testBtn.onclick = function () {
            var cfg = { url: byId('nes_secondary_url').value.trim(), key: byId('nes_secondary_key').value.trim(), model: byId('nes_secondary_model').value.trim() };
            if (!cfg.url) { alert('Please enter an API URL first.'); return; }
            if (testBtn) testBtn.disabled = true;
            sendSecondaryTestMessage(cfg).then(function () {
                typeof toastr !== 'undefined' && toastr.success(t('API connection successful!'));
                if (testBtn) testBtn.disabled = false;
            }).catch(function (e) {
                typeof toastr !== 'undefined' && toastr.error(t('API connection failed. Check browser console (F12) for details.'));
                if (testBtn) testBtn.disabled = false;
            });
        };
    }

    var embEnable = byId('nes_enable_vector_search');
    if (embEnable) {
        embEnable.onchange = function () {
            var settings = {};
            try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}
            settings.enableVectorSearch = embEnable.checked;
            localStorage.setItem('ne_settings', JSON.stringify(settings));
            renderSettingsTab();
        };
    }
    if (enableVectorSearch) {
        var embUrlEl = byId('nes_embedding_url');
        if (embUrlEl) embUrlEl.onchange = function () { saveEmbeddingApiOnly(); };
        var embKeyEl = byId('nes_embedding_key');
        if (embKeyEl) embKeyEl.onchange = function () { saveEmbeddingApiOnly(); };
        var embModelEl = byId('nes_embedding_model');
        if (embModelEl) embModelEl.onchange = function () { saveEmbeddingApiOnly(); };
        var embConnBtn = byId('nes_embedding_connect');
        if (embConnBtn) embConnBtn.onclick = function () {
            var cfg = { url: byId('nes_embedding_url').value.trim(), key: byId('nes_embedding_key').value.trim(), model: byId('nes_embedding_model').value.trim() };
            saveEmbeddingApiConfig(cfg);
            var dot = byId('nes_embedding_dot'), text = byId('nes_embedding_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (embConnBtn) embConnBtn.disabled = true;
            testEmbeddingApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model + ' (' + r.dimensions + 'd)') : (t('Not connected') + ' — ' + (r.error || ''));
                if (embConnBtn) embConnBtn.disabled = false;
            });
        };
        var embPresetBtn = byId('nes_embedding_preset');
        if (embPresetBtn) embPresetBtn.onclick = function () {
            var urlEl = byId('nes_embedding_url');
            var modelEl = byId('nes_embedding_model');
            if (urlEl) urlEl.value = 'https://api.siliconflow.cn/v1/embeddings';
            if (modelEl) modelEl.value = 'BAAI/bge-m3';
        };
        var embQualityBtn = byId('nes_embedding_quality');
        var embQualityStat = byId('nes_embedding_quality_status');
        if (embQualityBtn) embQualityBtn.onclick = function () {
            var cfg = { url: byId('nes_embedding_url').value.trim(), key: byId('nes_embedding_key').value.trim(), model: byId('nes_embedding_model').value.trim() };
            saveEmbeddingApiConfig(cfg);
            if (embQualityStat) embQualityStat.textContent = t('Running...');
            if (embQualityBtn) embQualityBtn.disabled = true;
            runVectorQualityTest(cfg).then(function (r) {
                if (embQualityBtn) embQualityBtn.disabled = false;
                if (!embQualityStat) return;
                if (r.pass) {
                    embQualityStat.style.color = 'var(--green50)';
                    embQualityStat.textContent = '✓ ' + t('Passed') + ' — ' + r.detail;
                } else if (r.success === false) {
                    embQualityStat.style.color = 'var(--red50)';
                    embQualityStat.textContent = '✗ ' + t('Failed') + ' — ' + (r.error || r.detail || 'Unknown error');
                } else {
                    embQualityStat.style.color = 'var(--yellow50)';
                    embQualityStat.textContent = '⚠ ' + r.detail + ' | ' + r.scoreSummary;
                }
            });
        };
    }
}

function saveSettingsTab() {
    var settings = {
        enableStateSchema: byId('nes_enable_state_schema').checked,
        useDynamicState: false,
        retrievalEnabled: byId('nes_enable_retrieval').checked,
        enableVectorSearch: byId('nes_enable_vector_search') ? byId('nes_enable_vector_search').checked : false,
        memoryBudget: Number(byId('nes_memory_budget').value),
        stmBatch: (byId('nes_stm_batch_auto') && byId('nes_stm_batch_auto').checked) ? 'auto' : Number(byId('nes_stm_batch').value),
        stmMaxUnconsolidated: Number(byId('nes_stm_max_unconsolidated').value),
        dialogWindowRounds: Number(byId('nes_dialog_window_rounds').value),
        dialogOverrideEnabled: byId('nes_dialog_override_enabled').checked,
        memoryConfig: {
            extraction_temperature: Number(byId('nes_extraction_temperature').value),
            retrieval_temperature: Number(byId('nes_retrieval_temperature').value),
            temperature: Number(byId('nes_extraction_temperature').value)
        }
    };
    var schemaText = byId('nes_state_schema').value.trim();
    if (schemaText) {
        try { var parsed = JSON.parse(schemaText); if (typeof parsed === 'object' && parsed !== null) settings.stateSchema = parsed; } catch (e) {}
    }
    var charSchemaText = byId('nes_character_schema').value.trim();
    if (charSchemaText) {
        try { var charParsed = JSON.parse(charSchemaText); if (typeof charParsed === 'object' && charParsed !== null) settings.characterSchema = charParsed; } catch (e) {}
    }
    localStorage.setItem('ne_settings', JSON.stringify(settings));
    setStateSchemaEnabled(settings.enableStateSchema || false);
    setRetrievalEnabled(settings.retrievalEnabled || false);
    var secApi = {
        url: byId('nes_secondary_url').value.trim(),
        key: byId('nes_secondary_key').value.trim(),
        model: byId('nes_secondary_model').value.trim()
    };
    saveSecondaryApiConfig(secApi);
    console.log('[NE] Settings saved from Settings tab');
}

function saveSecApiOnly() {
    var secApi = {
        url: byId('nes_secondary_url') ? byId('nes_secondary_url').value.trim() : '',
        key: byId('nes_secondary_key') ? byId('nes_secondary_key').value.trim() : '',
        model: byId('nes_secondary_model') ? byId('nes_secondary_model').value.trim() : ''
    };
    saveSecondaryApiConfig(secApi);
}

function saveRetApiOnly() {
    var retApi = {
        url: byId('nes_retrieval_url') ? byId('nes_retrieval_url').value.trim() : '',
        key: byId('nes_retrieval_key') ? byId('nes_retrieval_key').value.trim() : '',
        model: byId('nes_retrieval_model') ? byId('nes_retrieval_model').value.trim() : ''
    };
    saveRetrievalApiConfig(retApi);
}

function saveEmbeddingApiOnly() {
    var embApi = {
        url: byId('nes_embedding_url') ? byId('nes_embedding_url').value.trim() : '',
        key: byId('nes_embedding_key') ? byId('nes_embedding_key').value.trim() : '',
        model: byId('nes_embedding_model') ? byId('nes_embedding_model').value.trim() : ''
    };
    saveEmbeddingApiConfig(embApi);
}
