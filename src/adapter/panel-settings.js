import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { testSecondaryApiConnection, sendSecondaryTestMessage,
  saveSecondaryApiConfig, loadSecondaryApiConfig } from '../core/api/llm.js';
import { loadEmbeddingApiConfig, saveEmbeddingApiConfig,
         testEmbeddingApiConnection, isVectorSearchEnabled, runVectorQualityTest } from '../core/engine/embedding.js';
import { setAuto, isAuto, computeStmBatch, getTelemetryStats } from '../core/params.js';
import { qs, qsa, byId, pdCreate, pdHead, pdAddEventListener, t, panelById, panelQS, panelQSA, showToast } from './panel-shared.js';

export function renderSettingsTab() {
    var container = panelById('ne_common_settings');
    var advContainer = panelById('ne_advanced_settings');
    if (!container) return;
    var settings = {};
    try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}
    var mc = settings.memoryConfig || {};
    var secApi = {};
    try { var rawApi = localStorage.getItem('ne_secondary_api'); if (rawApi) secApi = JSON.parse(rawApi); } catch (e) {}
    var embApi = {};
    try { var rawEmb = localStorage.getItem('ne_embedding_api'); if (rawEmb) embApi = JSON.parse(rawEmb); } catch (e) {}
    var stmApi = {};
    try { var rawStm = localStorage.getItem('ne_stm_api'); if (rawStm) stmApi = JSON.parse(rawStm); } catch (e) {}
    var ltmApi = {};
    try { var rawLtm = localStorage.getItem('ne_ltm_api'); if (rawLtm) ltmApi = JSON.parse(rawLtm); } catch (e) {}
    var stateApi = {};
    try { var rawState = localStorage.getItem('ne_state_api'); if (rawState) stateApi = JSON.parse(rawState); } catch (e) {}
    var enableVectorSearch = settings.enableVectorSearch || false;
    var channelsEnabled = settings.apiChannelsEnabled === true;

    // === Common Settings ===
    var stmBatchAuto = isAuto('stmBatch');
    var computedBatch = computeStmBatch(getTelemetryStats().turnsPerEvent);
    var displayBatch = stmBatchAuto ? computedBatch : (settings.stmBatch || 10);
    var commonHtml = '<div class="ne-accordion" id="ne-set-engine">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Engine') + '</div>' +
        '<div class="ne-accordion-body">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('dialog_round_injection_control') + '</span><span class="range-val" id="nes_dialog_window_val">' + (settings.dialogWindowRounds || 10) + '</span></div>' +
        '<input type="range" id="nes_dialog_window_rounds" min="2" max="20" step="1" value="' + (settings.dialogWindowRounds || 10) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Controls how many recent dialog rounds are sent to the LLM. As an alternative to the default token-budget truncation (maxContext), this ensures the LLM always sees a fixed number of recent dialog rounds.') + '</div>' +
        '<div style="margin:0 0 8px;">' +
            '<label style="font-size:0.8em;display:flex;align-items:center;gap:3px;cursor:pointer;">' +
                '<input type="checkbox" id="nes_dialog_override_enabled" ' + (settings.dialogOverrideEnabled ? 'checked' : '') + '> ' + t('override_st_context_window_limit') +
            '</label>' +
            '<div style="color:var(--grey50);font-size:0.75em;">' + t('Disable ST token-budget truncation, using dialog rounds as the sole context control.') + '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Memory Budget') + '</span><span class="range-val" id="nes_budget_val">' + (settings.memoryBudget || 800) + ' ' + t('tok') + '</span></div>' +
        '<input type="range" id="nes_memory_budget" min="500" max="2000" step="100" value="' + (settings.memoryBudget || 800) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Controls max context tokens for memory injection. Higher = more memories visible, higher API cost.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;">' +
            '<span>' + t('STM Extraction Batch') + '</span>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
                '<label style="font-size:0.8em;display:flex;align-items:center;gap:3px;cursor:pointer;">' +
                    '<input type="checkbox" id="nes_stm_batch_auto" ' + (stmBatchAuto ? 'checked' : '') + '> ' + t('Auto') + '</label>' +
                '</label>' +
                '<span class="range-val" id="nes_stm_batch_val">' + displayBatch + '</span>' +
            '</div>' +
        '</div>' +
        '<input type="range" id="nes_stm_batch" min="1" max="30" step="1" value="' + displayBatch + '" style="width:100%;"' + (stmBatchAuto ? ' disabled' : '') + '>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Memory extraction uses LLM to detect natural scene boundaries, not fixed message counts. This is only a hard cap — unprocessed messages beyond this force extraction. A low value makes it behave like a fixed threshold.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Max Unconsolidated STM') + '</span><span class="range-val" id="nes_stm_unconsolidated_val">' + (settings.stmMaxUnconsolidated || 5) + '</span></div>' +
        '<input type="range" id="nes_stm_max_unconsolidated" min="2" max="30" step="1" value="' + (settings.stmMaxUnconsolidated || 5) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('STM Chunk Max Characters') + '</span><span class="range-val" id="nes_stm_chunk_val">' + (settings.stmChunkMaxChars || 4000) + '</span></div>' +
        '<input type="range" id="nes_stm_chunk_max_chars" min="0" max="100" step="1" value="' + Math.max(0, Math.min(100, Math.round(50 * Math.log10((settings.stmChunkMaxChars || 4000) / 100)))) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Max prompt characters per STM extraction call. Non-linear scale: lower values chunk more aggressively — near 100 chars gives roughly one extraction per turn. Higher values merge more turns into fewer LLM calls. A single segment that exceeds this limit is processed alone.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('STM Summary Ratio') + '</span><span class="range-val" id="nes_stm_ratio_val">' + Math.round((settings.stmSummaryRatio || 0.05) * 100) + '%</span></div>' +
        '<input type="range" id="nes_stm_summary_ratio" min="1" max="20" step="1" value="' + Math.round((settings.stmSummaryRatio || 0.05) * 100) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Target compression ratio for STM event summaries. Based on input text length per segment. 5% means ~50 chars output for 1000 chars input. Lower = shorter summaries, higher = more detail retained.') + '</div>' +
        '</div></div>' +
        '<div class="ne-accordion" id="ne-set-api">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Secondary API') + ' <span id="nes_api_header_dot" class="ne-pipeline-header-dot" style="font-size:0.7em;margin-left:4px;color:var(--ne-success);display:none;">\u25CF</span></div>' +
        '<div class="ne-accordion-body">' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_secondary_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(secApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_secondary_key" placeholder="sk-...(local LLM leave blank)" value="' + escapeHtml(secApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label><input type="text" id="nes_secondary_model" placeholder="deepseek-v4-flash or local model name" value="' + escapeHtml(secApi.model || '') + '"></div>' +
        '</div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Supports any OpenAI-compatible endpoint: Ollama, vLLM, LM Studio, LocalAI. Leave API Key empty for local LLMs.') + '</div>' +
        '<div><button class="ne-api-btn" id="nes_api_connect">' + t('Connect') + '</button><button class="ne-api-btn" id="nes_api_test">' + t('Test Message') + '</button></div>' +
        '<div class="ne-api-status"><span class="ne-api-dot" id="nes_api_dot"></span><span id="nes_api_status_text">' + t('Not connected') + '</span></div>' +
        '<div style="margin:10px 0 4px;">' +
        '<label><input type="checkbox" id="nes_api_channels_enabled" ' + (channelsEnabled ? 'checked' : '') + '> <span>' + t('Split API by operation (STM / LTM / State)') + '</span></label>' +
        '</div>' +
        '<div id="ne-api-channels" style="margin-top:4px;' + (channelsEnabled ? '' : 'display:none;') + '">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Default API above is used as fallback when a channel is left blank.') + '</div>' +
        '<div class="ne-channel-group" style="margin:8px 0;padding:8px;border:1px solid var(--grey30);border-radius:6px;">' +
        '<div style="font-weight:bold;margin:0 0 6px;">' + t('STM Extraction') + '</div>' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_stm_api_url" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stmApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_stm_api_key" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stmApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label><input type="text" id="nes_stm_api_model" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stmApi.model || '') + '"></div>' +
        '</div></div>' +
        '<div class="ne-channel-group" style="margin:8px 0;padding:8px;border:1px solid var(--grey30);border-radius:6px;">' +
        '<div style="font-weight:bold;margin:0 0 6px;">' + t('LTM Consolidation') + '</div>' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_ltm_api_url" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(ltmApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_ltm_api_key" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(ltmApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label><input type="text" id="nes_ltm_api_model" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(ltmApi.model || '') + '"></div>' +
        '</div></div>' +
        '<div class="ne-channel-group" style="margin:8px 0;padding:8px;border:1px solid var(--grey30);border-radius:6px;">' +
        '<div style="font-weight:bold;margin:0 0 6px;">' + t('State Extraction') + '</div>' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_state_api_url" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stateApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_state_api_key" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stateApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label><input type="text" id="nes_state_api_model" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stateApi.model || '') + '"></div>' +
        '</div></div>' +
        '<div class="ne-channel-group" style="margin:8px 0;padding:8px;border:1px solid var(--grey30);border-radius:6px;">' +
        '<div style="font-weight:bold;margin:0 0 6px;">' + t('Embedding / Vector') + '</div>' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_embedding_url" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(embApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_embedding_key" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(embApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label><input type="text" id="nes_embedding_model" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(embApi.model || '') + '"></div>' +
        '</div></div>' +
        '</div>' +
        '</div></div>' +
        '</div></div>';
    if (!channelsEnabled) {
        commonHtml +=
        '<div class="ne-accordion" id="ne-set-embedding">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Vector Search (Embedding API)') + ' <span id="nes_embedding_header_dot" class="ne-pipeline-header-dot" style="font-size:0.7em;margin-left:4px;color:var(--ne-success);display:none;">\u25CF</span></div>' +
        '<div class="ne-accordion-body">' +
        '<div class="ne-settings-toggle-grid" style="margin-bottom:8px;">' +
        '<label><input type="checkbox" id="nes_enable_vector_search" ' + (enableVectorSearch ? 'checked' : '') + '> <span>' + t('Enable Vector Search') + '</span></label>' +
        '</div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 12px;">' + t('Requires an OpenAI-compatible Embedding API. When disabled or unconfigured, falls back to BM25-only retrieval.') +
        '<br><span style="color:var(--green50);">' + t('Recommended: free BAAI/bge-m3 on SiliconFlow. Register at siliconflow.cn for an API key, then click one-key fill below.') + '</span></div>' +
        '<div id="ne-embedding-config" style="display:' + (enableVectorSearch ? 'block' : 'none') + '">' +
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
            '<div class="ne-api-status"><span class="ne-api-dot" id="nes_embedding_dot"></span><span id="nes_embedding_status_text">' + t('Not connected') + '</span></div>' +
        '</div>' +
        '</div></div>';
    }
    container.innerHTML = commonHtml;

    // ── API header dots ──
    var apiHdrDot = panelById('nes_api_header_dot');
    if (apiHdrDot) apiHdrDot.style.display = (secApi.url && secApi.model) ? 'inline' : 'none';
    var embHdrDot = panelById('nes_embedding_header_dot');
    if (embHdrDot) embHdrDot.style.display = (enableVectorSearch && embApi.url && embApi.model) ? 'inline' : 'none';

    // Auto-initialize API status if config exists (from auto-connect on page load)
    if (secApi.url && secApi.model) {
        setTimeout(function () {
            var dot = panelById('nes_api_dot'), text = panelById('nes_api_status_text');
            testSecondaryApiConnection(secApi).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + secApi.model) : (t('Not connected') + ' — ' + (r.error || ''));
                var hdr = panelById('narrative_secondary_api_status');
                if (hdr) {
                    hdr.style.color = r.success ? '#4caf50' : '#888';
                    var hdrTitle = r.success ? (t('Secondary API') + ': ' + secApi.model) : t('No secondary API configured');
                    if (enableVectorSearch && embApi.url && embApi.model) hdrTitle += '\n' + t('Vector API') + ': ' + embApi.model;
                    hdr.title = hdrTitle;
                }
            });
        }, 100);
    }
    if (enableVectorSearch && embApi.url && embApi.model) {
        setTimeout(function () {
            var dot = panelById('nes_embedding_dot'), text = panelById('nes_embedding_status_text');
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
    var tEl = panelById('nes_extraction_temperature');
    if (tEl) { tEl.oninput = function () { var v = panelById('nes_extraction_temp_val'); if (v) v.textContent = Number(tEl.value).toFixed(1); saveSettingsTab(); }; }
    var bEl = panelById('nes_memory_budget');
    if (bEl) { bEl.oninput = function () { var v = panelById('nes_budget_val'); if (v) v.textContent = bEl.value; saveSettingsTab(); }; }
    var sbEl = panelById('nes_stm_batch');
    if (sbEl) { sbEl.oninput = function () { var v = panelById('nes_stm_batch_val'); if (v) v.textContent = sbEl.value; saveSettingsTab(); }; }
    var suEl = panelById('nes_stm_max_unconsolidated');
    if (suEl) { suEl.oninput = function () { var v = panelById('nes_stm_unconsolidated_val'); if (v) v.textContent = suEl.value; saveSettingsTab(); }; }
    var scSlider = panelById('nes_stm_chunk_max_chars');
    var scVal = panelById('nes_stm_chunk_val');
    if (scSlider) { scSlider.oninput = function () { var actual = Math.round(100 * Math.pow(10, Number(scSlider.value) * 2 / 100)); if (scVal) scVal.textContent = actual; saveSettingsTab(); }; }
    var srEl = panelById('nes_stm_summary_ratio');
    if (srEl) { srEl.oninput = function () { var v = panelById('nes_stm_ratio_val'); if (v) v.textContent = srEl.value + '%'; saveSettingsTab(); }; }
    var cwEl = panelById('nes_dialog_window_rounds');
    if (cwEl) { cwEl.oninput = function () { var v = panelById('nes_dialog_window_val'); if (v) v.textContent = cwEl.value; saveSettingsTab(); }; }
    var ovEl = panelById('nes_dialog_override_enabled');
    if (ovEl) { ovEl.onchange = function () { saveSettingsTab(); }; }
    // Checkboxes — save on change
    // Auto toggles — save to params auto map and re-render
    var autoSb = panelById('nes_stm_batch_auto');
    if (autoSb) {
        autoSb.onchange = function () {
            setAuto('stmBatch', autoSb.checked);
            renderSettingsTab();
        };
    }
    // Textareas — save on blur (not every keystroke to avoid perf issues)
    var ta1 = panelById('nes_state_schema');
    if (ta1) ta1.onblur = function () { saveSettingsTab(); };
    var ta2 = panelById('nes_character_schema');
    if (ta2) ta2.onblur = function () { saveSettingsTab(); };
    // Secondary API inputs — save on blur
    var urlEl = panelById('nes_secondary_url');
    if (urlEl) urlEl.onchange = function () { saveSecApiOnly(); };
    var keyEl = panelById('nes_secondary_key');
    if (keyEl) keyEl.onchange = function () { saveSecApiOnly(); };
    var modelEl = panelById('nes_secondary_model');
    if (modelEl) modelEl.onchange = function () { saveSecApiOnly(); };
    var connBtn = panelById('nes_api_connect');
    if (connBtn) connBtn.onclick = function () {
            var cfg = { url: panelById('nes_secondary_url').value.trim(), key: panelById('nes_secondary_key').value.trim(), model: panelById('nes_secondary_model').value.trim() };
            saveSecondaryApiConfig(cfg);
            var dot = panelById('nes_api_dot'), text = panelById('nes_api_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (connBtn) connBtn.disabled = true;
            testSecondaryApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model) : (t('Not connected') + ' — ' + (r.error || ''));
                if (connBtn) connBtn.disabled = false;
                // ── Also update API header dot ──
                var aHdrDot = panelById('nes_api_header_dot');
                if (aHdrDot) aHdrDot.style.display = r.success ? 'inline' : 'none';
                var hdr = panelById('narrative_secondary_api_status');
                if (hdr) {
                    hdr.style.color = r.success ? '#4caf50' : '#888';
                    var hdrTitle = r.success ? (t('Secondary API') + ': ' + cfg.model) : t('No secondary API configured');
                    if (enableVectorSearch && embApi.url && embApi.model) hdrTitle += '\n' + t('Vector API') + ': ' + embApi.model;
                    hdr.title = hdrTitle;
                }
            });
        };
        var testBtn = panelById('nes_api_test');
        if (testBtn) testBtn.onclick = function () {
            var cfg = { url: panelById('nes_secondary_url').value.trim(), key: panelById('nes_secondary_key').value.trim(), model: panelById('nes_secondary_model').value.trim() };
            if (!cfg.url) { alert(t('Please enter an API URL first.')); return; }
            if (testBtn) testBtn.disabled = true;
            sendSecondaryTestMessage(cfg).then(function () {
                showToast(t('API connection successful!'), 'success');
                if (testBtn) testBtn.disabled = false;
            }).catch(function (e) {
                showToast(t('API connection failed. Check browser console (F12) for details.'), 'error');
                if (testBtn) testBtn.disabled = false;
            });
        };
    // API channels toggle
    var chToggle = panelById('nes_api_channels_enabled');
    if (chToggle) {
        chToggle.onchange = function () {
            saveSettingsTab();
            renderSettingsTab();
        };
    }
    if (channelsEnabled) {
        var stmUrl = panelById('nes_stm_api_url');
        if (stmUrl) stmUrl.onchange = function () { saveSettingsTab(); };
        var stmKey = panelById('nes_stm_api_key');
        if (stmKey) stmKey.onchange = function () { saveSettingsTab(); };
        var stmModel = panelById('nes_stm_api_model');
        if (stmModel) stmModel.onchange = function () { saveSettingsTab(); };
        var ltmUrl = panelById('nes_ltm_api_url');
        if (ltmUrl) ltmUrl.onchange = function () { saveSettingsTab(); };
        var ltmKey = panelById('nes_ltm_api_key');
        if (ltmKey) ltmKey.onchange = function () { saveSettingsTab(); };
        var ltmModel = panelById('nes_ltm_api_model');
        if (ltmModel) ltmModel.onchange = function () { saveSettingsTab(); };
        var stateUrl = panelById('nes_state_api_url');
        if (stateUrl) stateUrl.onchange = function () { saveSettingsTab(); };
        var stateKey = panelById('nes_state_api_key');
        if (stateKey) stateKey.onchange = function () { saveSettingsTab(); };
        var stateModel = panelById('nes_state_api_model');
        if (stateModel) stateModel.onchange = function () { saveSettingsTab(); };
        var embChUrl = panelById('nes_embedding_url');
        if (embChUrl) embChUrl.onchange = function () { saveSettingsTab(); };
        var embChKey = panelById('nes_embedding_key');
        if (embChKey) embChKey.onchange = function () { saveSettingsTab(); };
        var embChModel = panelById('nes_embedding_model');
        if (embChModel) embChModel.onchange = function () { saveSettingsTab(); };
    }

    var embEnable = panelById('nes_enable_vector_search');
    if (embEnable) {
        embEnable.onchange = function () {
            var settings = {};
            try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}
            settings.enableVectorSearch = embEnable.checked;
            localStorage.setItem('ne_settings', JSON.stringify(settings));
            var config = panelById('ne-embedding-config');
            if (config) config.style.display = embEnable.checked ? 'block' : 'none';
            // ── Update embedding header dot on toggle ──
            var eHdrDot = panelById('nes_embedding_header_dot');
            if (eHdrDot) eHdrDot.style.display = embEnable.checked ? 'inline' : 'none';
        };
    }
    if (enableVectorSearch && !channelsEnabled) {
        var embUrlEl = panelById('nes_embedding_url');
        if (embUrlEl) embUrlEl.onchange = function () { saveEmbeddingApiOnly(); };
        var embKeyEl = panelById('nes_embedding_key');
        if (embKeyEl) embKeyEl.onchange = function () { saveEmbeddingApiOnly(); };
        var embModelEl = panelById('nes_embedding_model');
        if (embModelEl) embModelEl.onchange = function () { saveEmbeddingApiOnly(); };
        var embConnBtn = panelById('nes_embedding_connect');
        if (embConnBtn) embConnBtn.onclick = function () {
            var cfg = { url: panelById('nes_embedding_url').value.trim(), key: panelById('nes_embedding_key').value.trim(), model: panelById('nes_embedding_model').value.trim() };
            saveEmbeddingApiConfig(cfg);
            var dot = panelById('nes_embedding_dot'), text = panelById('nes_embedding_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (embConnBtn) embConnBtn.disabled = true;
            testEmbeddingApiConnection(cfg).then(function (r) {
                if (dot) dot.className = 'ne-api-dot' + (r.success ? ' ok' : '');
                if (text) text.textContent = r.success ? (t('Connected') + ': ' + cfg.model + ' (' + r.dimensions + 'd)') : (t('Not connected') + ' — ' + (r.error || ''));
                if (embConnBtn) embConnBtn.disabled = false;
                // ── Also update embedding header dot ──
                var eHdrDot2 = panelById('nes_embedding_header_dot');
                if (eHdrDot2) eHdrDot2.style.display = r.success ? 'inline' : 'none';
            });
        };
        var embPresetBtn = panelById('nes_embedding_preset');
        if (embPresetBtn) embPresetBtn.onclick = function () {
            var urlEl = panelById('nes_embedding_url');
            var modelEl = panelById('nes_embedding_model');
            if (urlEl) urlEl.value = 'https://api.siliconflow.cn/v1/embeddings';
            if (modelEl) modelEl.value = 'BAAI/bge-m3';
        };
        var embQualityBtn = panelById('nes_embedding_quality');
        var embQualityStat = panelById('nes_embedding_quality_status');
        if (embQualityBtn) embQualityBtn.onclick = function () {
            var cfg = { url: panelById('nes_embedding_url').value.trim(), key: panelById('nes_embedding_key').value.trim(), model: panelById('nes_embedding_model').value.trim() };
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
                    embQualityStat.textContent = '\u2717 ' + t('Failed') + ' \u2014 ' + (r.error || r.detail || t('Unknown error'));
                } else {
                    embQualityStat.style.color = 'var(--yellow50)';
                    embQualityStat.textContent = '⚠ ' + r.detail + ' | ' + r.scoreSummary;
                }
            });
        };
    }
}

function saveSettingsTab() {
    var channelsEnabled = panelById('nes_api_channels_enabled') ? panelById('nes_api_channels_enabled').checked : false;
    var settings = {};
    try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}

    settings.useDynamicState = settings.useDynamicState || false;
    if (panelById('nes_enable_retrieval'))
        settings.retrievalEnabled = panelById('nes_enable_retrieval').checked;
    if (panelById('nes_enable_vector_search'))
        settings.enableVectorSearch = panelById('nes_enable_vector_search').checked;
    if (panelById('nes_memory_budget'))
        settings.memoryBudget = Number(panelById('nes_memory_budget').value);
    if (panelById('nes_stm_batch_auto') && panelById('nes_stm_batch_auto').checked)
        settings.stmBatch = 'auto';
    else if (panelById('nes_stm_batch'))
        settings.stmBatch = Number(panelById('nes_stm_batch').value);
    if (panelById('nes_stm_max_unconsolidated'))
        settings.stmMaxUnconsolidated = Number(panelById('nes_stm_max_unconsolidated').value);
    if (panelById('nes_dialog_window_rounds'))
        settings.dialogWindowRounds = Number(panelById('nes_dialog_window_rounds').value);
    if (panelById('nes_dialog_override_enabled'))
        settings.dialogOverrideEnabled = panelById('nes_dialog_override_enabled').checked;
    if (panelById('nes_api_channels_enabled'))
        settings.apiChannelsEnabled = channelsEnabled;
    var scSlider2 = panelById('nes_stm_chunk_max_chars');
    if (scSlider2) {
        var pos = Number(scSlider2.value);
        settings.stmChunkMaxChars = Math.round(100 * Math.pow(10, pos * 2 / 100));
    }
    if (panelById('nes_stm_summary_ratio'))
        settings.stmSummaryRatio = Number(panelById('nes_stm_summary_ratio').value) / 100;

    settings.memoryConfig = settings.memoryConfig || {};
    if (panelById('nes_extraction_temperature')) {
        settings.memoryConfig.extraction_temperature = Number(panelById('nes_extraction_temperature').value);
        settings.memoryConfig.temperature = settings.memoryConfig.extraction_temperature;
    }

    var schemaEl = panelById('nes_state_schema');
    if (schemaEl) {
        var schemaText = schemaEl.value.trim();
        if (schemaText) {
            try { var parsed = JSON.parse(schemaText); if (typeof parsed === 'object' && parsed !== null) settings.stateSchema = parsed; } catch (e) {}
        }
    }
    var charSchemaEl = panelById('nes_character_schema');
    if (charSchemaEl) {
        var charSchemaText = charSchemaEl.value.trim();
        if (charSchemaText) {
            try { var charParsed = JSON.parse(charSchemaText); if (typeof charParsed === 'object' && charParsed !== null) settings.characterSchema = charParsed; } catch (e) {}
        }
    }
    localStorage.setItem('ne_settings', JSON.stringify(settings));
    setRetrievalEnabled(settings.retrievalEnabled || false);
    var secApi = {
        url: panelById('nes_secondary_url').value.trim(),
        key: panelById('nes_secondary_key').value.trim(),
        model: panelById('nes_secondary_model').value.trim()
    };
    saveSecondaryApiConfig(secApi);
    if (channelsEnabled) {
        var stmApi = {
            url: panelById('nes_stm_api_url') ? panelById('nes_stm_api_url').value.trim() : '',
            key: panelById('nes_stm_api_key') ? panelById('nes_stm_api_key').value.trim() : '',
            model: panelById('nes_stm_api_model') ? panelById('nes_stm_api_model').value.trim() : ''
        };
        localStorage.setItem('ne_stm_api', JSON.stringify(stmApi));
        var ltmApi = {
            url: panelById('nes_ltm_api_url') ? panelById('nes_ltm_api_url').value.trim() : '',
            key: panelById('nes_ltm_api_key') ? panelById('nes_ltm_api_key').value.trim() : '',
            model: panelById('nes_ltm_api_model') ? panelById('nes_ltm_api_model').value.trim() : ''
        };
        localStorage.setItem('ne_ltm_api', JSON.stringify(ltmApi));
        var stateApi = {
            url: panelById('nes_state_api_url') ? panelById('nes_state_api_url').value.trim() : '',
            key: panelById('nes_state_api_key') ? panelById('nes_state_api_key').value.trim() : '',
            model: panelById('nes_state_api_model') ? panelById('nes_state_api_model').value.trim() : ''
        };
        localStorage.setItem('ne_state_api', JSON.stringify(stateApi));
        var chEmbApi = {
            url: panelById('nes_embedding_url') ? panelById('nes_embedding_url').value.trim() : '',
            key: panelById('nes_embedding_key') ? panelById('nes_embedding_key').value.trim() : '',
            model: panelById('nes_embedding_model') ? panelById('nes_embedding_model').value.trim() : ''
        };
        saveEmbeddingApiConfig(chEmbApi);
    }
    console.log('[NE] Settings saved from Settings tab');
}

function saveSecApiOnly() {
    var secApi = {
        url: panelById('nes_secondary_url') ? panelById('nes_secondary_url').value.trim() : '',
        key: panelById('nes_secondary_key') ? panelById('nes_secondary_key').value.trim() : '',
        model: panelById('nes_secondary_model') ? panelById('nes_secondary_model').value.trim() : ''
    };
    saveSecondaryApiConfig(secApi);
}

function saveEmbeddingApiOnly() {
    var embApi = {
        url: panelById('nes_embedding_url') ? panelById('nes_embedding_url').value.trim() : '',
        key: panelById('nes_embedding_key') ? panelById('nes_embedding_key').value.trim() : '',
        model: panelById('nes_embedding_model') ? panelById('nes_embedding_model').value.trim() : ''
    };
    saveEmbeddingApiConfig(embApi);
}
