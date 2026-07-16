import { escapeHtml, formatLocalTime } from '../ui/utils.js';
import { t_narrative, t_field } from '../core/i18n.js';
import { testSecondaryApiConnection, sendSecondaryTestMessage, fetchAvailableModels, validateApiKey,
  saveSecondaryApiConfig, loadSecondaryApiConfig } from '../core/api/llm.js';
import { loadEmbeddingApiConfig, saveEmbeddingApiConfig,
         testEmbeddingApiConnection, isVectorSearchEnabled, runVectorQualityTest } from '../core/engine/embedding.js';
import { neSyncAll } from '../core/settings-adapter.js';
import { setAuto, isAuto, computeStmBatch, getTelemetryStats } from '../core/params.js';
import { qs, qsa, byId, pdCreate, pdHead, pdAddEventListener, t, panelById, panelQS, panelQSA, showToast, showConfirm, _currentGetChatId, busEmit } from './panel-shared.js';
import { readVault, writeMemory } from '../core/vault/store.js';
import { recordMemoryVersion, recordStateDelta } from '../core/vault/state-versions.js';
import { getActiveChain, listStateDeltas, listMemoryVersions } from '../core/vault/state-versions.js';
import { scanOrphans, purgeOrphanChatData } from '../core/vault/garbage-collector.js';
import { initTestRunner } from './panel-tools.js';

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
    var templateApi = {};
    try { var rawTemplate = localStorage.getItem('ne_template_api'); if (rawTemplate) templateApi = JSON.parse(rawTemplate); } catch (e) {}
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
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('STM Chunk Max Characters') + '</span><span class="range-val" id="nes_stm_chunk_val">' + (settings.stmChunkMaxChars || 500) + '</span></div>' +
        '<div style="display:flex;gap:6px;align-items:center;">' +
            '<input type="number" id="nes_stm_chunk_input" min="100" max="10000" step="10" value="' + (settings.stmChunkMaxChars || 500) + '" style="width:80px;text-align:right;flex-shrink:0;">' +
            '<input type="range" id="nes_stm_chunk_max_chars" min="0" max="100" step="1" value="' + Math.max(0, Math.min(100, Math.round(50 * Math.log10((settings.stmChunkMaxChars || 500) / 100)))) + '" style="flex:1;">' +
        '</div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Max prompt characters per STM extraction call. Non-linear scale: lower values chunk more aggressively — near 100 chars gives roughly one extraction per turn. Higher values merge more turns into fewer LLM calls. A single segment that exceeds this limit is processed alone.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('PH Batch Max Chars') + '</span><span class="range-val" id="nes_ph_batch_val">' + (settings.phBatchChars || 4000) + '</span></div>' +
        '<div style="display:flex;gap:6px;align-items:center;">' +
            '<input type="number" id="nes_ph_batch_input" min="1000" max="8000" step="500" value="' + (settings.phBatchChars || 4000) + '" style="width:80px;text-align:right;flex-shrink:0;">' +
            '<input type="range" id="nes_ph_batch_slider" min="0" max="100" step="1" value="' + Math.max(0, Math.min(100, Math.round(100 * Math.log10(((settings.phBatchChars || 4000) / 1000)) / Math.log10(8)))) + '" style="flex:1;">' +
        '</div>' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Max dialogue characters per Process History batch. Higher = fewer LLM calls but larger prompts.') + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('STM Summary Ratio') + '</span><span class="range-val" id="nes_stm_ratio_val">' + Math.round((settings.stmSummaryRatio || 0.05) * 100) + '%</span></div>' +
        '<input type="range" id="nes_stm_summary_ratio" min="1" max="20" step="1" value="' + Math.round((settings.stmSummaryRatio || 0.05) * 100) + '" style="width:100%;">' +
        '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('Target compression ratio for STM event summaries. Based on input text length per segment. 5% means ~50 chars output for 1000 chars input. Lower = shorter summaries, higher = more detail retained.') + '</div>' +
        '</div></div>' +
        '<div class="ne-accordion" id="ne-set-api">' +
        '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Secondary API') + ' <span id="nes_api_header_dot" class="ne-pipeline-header-dot" style="font-size:0.7em;margin-left:4px;color:var(--ne-success);display:none;">\u25CF</span></div>' +
        '<div class="ne-accordion-body">' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_secondary_url" placeholder="https://api.deepseek.com/v1/chat/completions" value="' + escapeHtml(secApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_secondary_key" placeholder="sk-...(local LLM leave blank)" value="' + escapeHtml(secApi.key || '') + '">' +
        '<div id="nes_secondary_key_warn" class="ne-key-validation-warn" style="display:none;color:var(--yellow40,#e6a817);font-size:0.75em;margin-top:2px;"></div></div>' +
        '<div><label>' + t('Model') + '</label>' +
        '<div id="nes_secondary_model_wrapper" style="display:flex;gap:4px;align-items:center;">' +
          '<select id="nes_secondary_model_select" class="ne-model-select" style="display:none;flex:1;"></select>' +
          '<input type="text" id="nes_secondary_model_text" placeholder="deepseek-v4-flash or local model name" value="' + escapeHtml(secApi.model || '') + '" style="flex:1;">' +
          '<button class="ne-api-fetch-models" id="nes_secondary_fetch_models" title="' + t('Fetch models') + '" style="flex-shrink:0;">\u{1F504}</button>' +
        '</div></div>' +
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
        '<div><label>' + t('Model') + '</label>' +
        '<div id="nes_stm_model_wrapper" style="display:flex;gap:4px;align-items:center;">' +
          '<select id="nes_stm_api_model_select" class="ne-model-select" style="display:none;flex:1;"></select>' +
          '<input type="text" id="nes_stm_api_model_text" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stmApi.model || '') + '" style="flex:1;">' +
          '<button class="ne-api-fetch-models" id="nes_stm_fetch_models" title="' + t('Fetch models') + '" style="flex-shrink:0;">\u{1F504}</button>' +
        '</div></div>' +
        '</div></div>' +
        '<div class="ne-channel-group" style="margin:8px 0;padding:8px;border:1px solid var(--grey30);border-radius:6px;">' +
        '<div style="font-weight:bold;margin:0 0 6px;">' + t('LTM Consolidation') + '</div>' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_ltm_api_url" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(ltmApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_ltm_api_key" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(ltmApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label>' +
        '<div id="nes_ltm_model_wrapper" style="display:flex;gap:4px;align-items:center;">' +
          '<select id="nes_ltm_api_model_select" class="ne-model-select" style="display:none;flex:1;"></select>' +
          '<input type="text" id="nes_ltm_api_model_text" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(ltmApi.model || '') + '" style="flex:1;">' +
          '<button class="ne-api-fetch-models" id="nes_ltm_fetch_models" title="' + t('Fetch models') + '" style="flex-shrink:0;">\u{1F504}</button>' +
        '</div></div>' +
        '</div></div>' +
        '<div class="ne-channel-group" style="margin:8px 0;padding:8px;border:1px solid var(--grey30);border-radius:6px;">' +
        '<div style="font-weight:bold;margin:0 0 6px;">' + t('State Extraction') + '</div>' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_state_api_url" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stateApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_state_api_key" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stateApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label>' +
        '<div id="nes_state_model_wrapper" style="display:flex;gap:4px;align-items:center;">' +
          '<select id="nes_state_api_model_select" class="ne-model-select" style="display:none;flex:1;"></select>' +
          '<input type="text" id="nes_state_api_model_text" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(stateApi.model || '') + '" style="flex:1;">' +
          '<button class="ne-api-fetch-models" id="nes_state_fetch_models" title="' + t('Fetch models') + '" style="flex-shrink:0;">\u{1F504}</button>' +
        '</div></div>' +
        '</div></div>' +
        '<div class="ne-channel-group" style="margin:8px 0;padding:8px;border:1px solid var(--grey30);border-radius:6px;">' +
        '<div style="font-weight:bold;margin:0 0 6px;">' + t('Template LLM') + '</div>' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_template_api_url" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(templateApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_template_api_key" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(templateApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label>' +
        '<div id="nes_template_model_wrapper" style="display:flex;gap:4px;align-items:center;">' +
          '<select id="nes_template_api_model_select" class="ne-model-select" style="display:none;flex:1;"></select>' +
          '<input type="text" id="nes_template_api_model_text" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(templateApi.model || '') + '" style="flex:1;">' +
          '<button class="ne-api-fetch-models" id="nes_template_fetch_models" title="' + t('Fetch models') + '" style="flex-shrink:0;">\u{1F504}</button>' +
        '</div></div>' +
        '</div></div>' +
        (channelsEnabled ? ('<div class="ne-channel-group" style="margin:8px 0;padding:8px;border:1px solid var(--grey30);border-radius:6px;">' +
        '<div style="font-weight:bold;margin:0 0 6px;">' + t('Embedding / Vector') + '</div>' +
        '<div class="ne-settings-grid">' +
        '<div><label>' + t('API URL') + '</label><input type="text" id="nes_embedding_url" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(embApi.url || '') + '"></div>' +
        '<div><label>' + t('API Key') + '</label><input type="password" id="nes_embedding_key" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(embApi.key || '') + '"></div>' +
        '<div><label>' + t('Model') + '</label>' +
        '<div id="nes_embedding_model_wrapper" style="display:flex;gap:4px;align-items:center;">' +
          '<select id="nes_embedding_model_select" class="ne-model-select" style="display:none;flex:1;"></select>' +
          '<input type="text" id="nes_embedding_model_text" placeholder="' + t('blank = use default') + '" value="' + escapeHtml(embApi.model || '') + '" style="flex:1;">' +
          '<button class="ne-api-fetch-models" id="nes_embedding_fetch_models" title="' + t('Fetch models') + '" style="flex-shrink:0;">\u{1F504}</button>' +
        '</div></div>' +
        '</div></div>') : '') +
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
        var advHtml = '<div style="margin:8px 0;">' +
            '<label><input type="checkbox" id="nes_disable_state_schema" ' + (settings.disableStateSchema ? 'checked' : '') + '> ' +
            '<span>' + t('Disable State Schema') + '</span></label>' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:2px 0 8px 22px;">' +
            t('When enabled, stops auto-tracking character state and injecting State Table. Use for MVU variable cards that manage state independently. STM/LTM memory continues.') +
            '</div></div>' +
            '<div class="ne-accordion" id="ne-set-memory">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> ' + t('Memory Parameters') + '</div>' +
            '<div class="ne-accordion-body">' +
            '<div class="ne-settings-grid">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;"><span>' + t('Extraction Temperature (rec. 0.2)') + '</span><span class="range-val" id="nes_extraction_temp_val">' + (mc.extraction_temperature || mc.temperature || 0.2).toFixed(1) + '</span></div>' +
            '<input type="range" id="nes_extraction_temperature" min="0" max="1" step="0.1" value="' + (mc.extraction_temperature || mc.temperature || 0.2) + '" style="width:100%;">' +
            '<div style="color:var(--grey50);font-size:0.75em;margin:0 0 8px;">' + t('STM/State/LTM memory extraction. Lower = more consistent summaries.') + '</div>' +
            '</div></div></div>';
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
    var scInput = panelById('nes_stm_chunk_input');
    var _scSync = false;
    if (scSlider) { scSlider.oninput = function () { if (_scSync) return; _scSync = true; var actual = Math.round(100 * Math.pow(10, Number(scSlider.value) * 2 / 100)); if (scVal) scVal.textContent = actual; if (scInput) scInput.value = actual; _scSync = false; saveSettingsTab(); }; }
    if (scInput) { scInput.onchange = function () { if (_scSync) return; _scSync = true; var v = Math.max(100, Math.min(10000, Number(scInput.value) || 4000)); scInput.value = v; if (scVal) scVal.textContent = v; if (scSlider) scSlider.value = Math.round(50 * Math.log10(v / 100)); _scSync = false; saveSettingsTab(); }; }
    var phSlider = panelById('nes_ph_batch_slider');
    var phVal = panelById('nes_ph_batch_val');
    var phInput = panelById('nes_ph_batch_input');
    var _phSync = false;
    if (phSlider) { phSlider.oninput = function () { if (_phSync) return; _phSync = true; var actual = Math.round(1000 * Math.pow(8, Number(phSlider.value) / 100)); actual = Math.max(1000, Math.min(8000, Math.round(actual / 500) * 500)); if (phVal) phVal.textContent = actual; if (phInput) phInput.value = actual; _phSync = false; saveSettingsTab(); }; }
    if (phInput) { phInput.onchange = function () { if (_phSync) return; _phSync = true; var v = Math.max(1000, Math.min(8000, Math.round((Number(phInput.value) || 4000) / 500) * 500)); phInput.value = v; if (phVal) phVal.textContent = v; if (phSlider) phSlider.value = Math.round(100 * Math.log10(v / 1000) / Math.log10(8)); _phSync = false; saveSettingsTab(); }; }
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
    // Secondary API inputs — save on blur
    var urlEl = panelById('nes_secondary_url');
    if (urlEl) urlEl.onchange = function () { saveSecApiOnly(); };
    var keyEl = panelById('nes_secondary_key');
    if (keyEl) { keyEl.onchange = function () { saveSecApiOnly(); validateAndShowKeyWarn('nes_secondary', keyEl.value); }; keyEl.onblur = function () { validateAndShowKeyWarn('nes_secondary', keyEl.value); }; }
    var modelEl = panelById('nes_secondary_model_text');
    if (modelEl) modelEl.onchange = function () { saveSecApiOnly(); };
    var modelSel = panelById('nes_secondary_model_select');
    if (modelSel) modelSel.onchange = function () {
        if (modelSel.value === '') {
            modelSel.style.display = 'none';
            var txt = panelById('nes_secondary_model_text');
            if (txt) { txt.style.display = ''; txt.value = ''; }
        }
        saveSecApiOnly();
    };
    var fetchBtn = panelById('nes_secondary_fetch_models');
    if (fetchBtn) fetchBtn.onclick = function () {
        var url = panelById('nes_secondary_url').value.trim();
        var key = panelById('nes_secondary_key').value.trim();
        if (!url) { showToast(t('Please enter an API URL first.'), 'warning'); return; }
        if (fetchBtn) fetchBtn.disabled = true;
        fetchAvailableModels({ url: url, key: key }, 5).then(function (models) {
            populateModelSelect('nes_secondary', models);
            if (fetchBtn) fetchBtn.disabled = false;
        }).catch(function (e) {
            showToast(t('Could not fetch model list') + ': ' + (e.message || ''), 'error');
            if (fetchBtn) fetchBtn.disabled = false;
        });
    };
    var connBtn = panelById('nes_api_connect');
    if (connBtn) connBtn.onclick = function () {
            var urlEl = panelById('nes_secondary_url'), keyEl = panelById('nes_secondary_key');
            var cfg = { url: urlEl.value.trim(), key: keyEl.value.trim(), model: getModelValue('nes_secondary') };
            saveSecondaryApiConfig(cfg);
            var dot = panelById('nes_api_dot'), text = panelById('nes_api_status_text');
            if (dot) dot.className = 'ne-api-dot';
            if (text) text.textContent = t('Connecting...');
            if (connBtn) connBtn.disabled = true;
            testSecondaryApiConnection(cfg).then(function (r) {
                if (r.success && r.models && r.models.length > 0) {
                    populateModelSelect('nes_secondary', r.models, cfg.model);
                }
                if (dot) {
                    if (r.success && r.modelInList === true) {
                        dot.className = 'ne-api-dot ok';
                    } else if (r.success && r.modelInList === false) {
                        dot.className = 'ne-api-dot warn';
                    } else if (r.success) {
                        dot.className = 'ne-api-dot ok';
                    } else {
                        dot.className = 'ne-api-dot';
                    }
                }
                if (text) {
                    if (r.success && r.modelInList === true) {
                        text.textContent = t('Connected') + ': ' + cfg.model;
                    } else if (r.success && r.modelInList === false) {
                        text.textContent = t('API reachable but model not found') + ': ' + cfg.model;
                    } else if (r.success) {
                        text.textContent = t('Connected') + ' (' + t('API not exposing model list') + '): ' + cfg.model;
                    } else if (r.errorType === 'timeout') {
                        text.textContent = t('Connection timed out') + ' — ' + t('API may still be usable but has high latency');
                    } else if (r.errorType === 'network') {
                        text.textContent = t('Cannot reach API') + ' — ' + (r.error || '');
                    } else if (r.errorType === 'auth') {
                        text.textContent = t('Authentication failed') + ' — ' + (r.error || '');
                    } else {
                        text.textContent = t('Not connected') + ' — ' + (r.error || '');
                    }
                }
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
            }).catch(function (e) {
                if (connBtn) connBtn.disabled = false;
                if (dot) dot.className = 'ne-api-dot';
                if (text) text.textContent = t('Not connected') + ' — ' + (e.message || '');
            });
        };
        var testBtn = panelById('nes_api_test');
        if (testBtn) testBtn.onclick = function () {
            var cfg = { url: panelById('nes_secondary_url').value.trim(), key: panelById('nes_secondary_key').value.trim(), model: getModelValue('nes_secondary') };
            if (!cfg.url) { alert(t('Please enter an API URL first.')); return; }
            if (testBtn) testBtn.disabled = true;
            sendSecondaryTestMessage(cfg).then(function (r) {
                var latencySec = (r && typeof r.latencyMs === 'number') ? (r.latencyMs / 1000).toFixed(1) : '?';
                showToast(t('API connection successful!') + ' (' + latencySec + 's)', 'success');
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
        var stmModel = panelById('nes_stm_api_model_text');
        if (stmModel) stmModel.onchange = function () { saveSettingsTab(); };
        bindChannelFetch('nes_stm');
        var ltmUrl = panelById('nes_ltm_api_url');
        if (ltmUrl) ltmUrl.onchange = function () { saveSettingsTab(); };
        var ltmKey = panelById('nes_ltm_api_key');
        if (ltmKey) ltmKey.onchange = function () { saveSettingsTab(); };
        var ltmModel = panelById('nes_ltm_api_model_text');
        if (ltmModel) ltmModel.onchange = function () { saveSettingsTab(); };
        bindChannelFetch('nes_ltm');
        var stateUrl = panelById('nes_state_api_url');
        if (stateUrl) stateUrl.onchange = function () { saveSettingsTab(); };
        var stateKey = panelById('nes_state_api_key');
        if (stateKey) stateKey.onchange = function () { saveSettingsTab(); };
        var stateModel = panelById('nes_state_api_model_text');
        if (stateModel) stateModel.onchange = function () { saveSettingsTab(); };
        bindChannelFetch('nes_state');
        var tplUrl = panelById('nes_template_api_url');
        if (tplUrl) tplUrl.onchange = function () { saveSettingsTab(); };
        var tplKey = panelById('nes_template_api_key');
        if (tplKey) tplKey.onchange = function () { saveSettingsTab(); };
        var tplModel = panelById('nes_template_api_model_text');
        if (tplModel) tplModel.onchange = function () { saveSettingsTab(); };
        bindChannelFetch('nes_template');
        var embChUrl = panelById('nes_embedding_url');
        if (embChUrl) embChUrl.onchange = function () { saveSettingsTab(); };
        var embChKey = panelById('nes_embedding_key');
        if (embChKey) embChKey.onchange = function () { saveSettingsTab(); };
        var embChModel = panelById('nes_embedding_model_text');
        if (embChModel) embChModel.onchange = function () { saveSettingsTab(); };
        bindChannelFetch('nes_embedding');
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
    // One-key fill preset — bind whenever button exists (not gated on enableVectorSearch)
    if (!channelsEnabled) {
        var embPresetBtn = panelById('nes_embedding_preset');
        if (embPresetBtn) embPresetBtn.onclick = function () {
            var urlEl = panelById('nes_embedding_url');
            var modelEl = panelById('nes_embedding_model');
            if (urlEl) urlEl.value = 'https://api.siliconflow.cn/v1/embeddings';
            if (modelEl) modelEl.value = 'BAAI/bge-m3';
        };
    }
}

function getModelValue(prefix) {
    var sel = panelById(prefix + '_model_select');
    if (sel && sel.style.display !== 'none' && sel.value) {
        return sel.value;
    }
    var txt = panelById(prefix + '_model_text') || panelById(prefix + '_model');
    if (txt) return txt.value.trim();
    return '';
}

function validateAndShowKeyWarn(prefix, keyValue) {
    var warnEl = panelById(prefix + '_key_warn');
    if (!warnEl) return;
    if (!keyValue || keyValue.trim() === '') {
        warnEl.style.display = 'none';
        warnEl.textContent = '';
        return;
    }
    var trimmed = keyValue.trim();
    if (trimmed.startsWith('sk-') || trimmed.length >= 20) {
        warnEl.style.display = 'none';
        warnEl.textContent = '';
    } else {
        warnEl.style.display = '';
        warnEl.textContent = t('API key format may be incorrect. Most cloud APIs use keys starting with "sk-".');
    }
}

function populateModelSelect(prefix, models, currentModel) {
    var sel = panelById(prefix + '_model_select');
    var txt = panelById(prefix + '_model_text') || panelById(prefix + '_model');
    if (!sel) return;
    sel.innerHTML = '';
    var found = false;
    if (currentModel !== undefined && currentModel !== null) {
        found = models.indexOf(currentModel) !== -1;
    }
    if (!found && currentModel) {
        var savedOpt = document.createElement('option');
        savedOpt.value = currentModel;
        savedOpt.textContent = '\u270E ' + currentModel + ' (' + t('(saved: {model})').replace('{model}', currentModel) + ')';
        savedOpt.style.fontStyle = 'italic';
        savedOpt.style.color = 'var(--grey50)';
        sel.appendChild(savedOpt);
        found = true;
    }
    for (var i = 0; i < models.length; i++) {
        var opt = document.createElement('option');
        opt.value = models[i];
        opt.textContent = models[i];
        sel.appendChild(opt);
    }
    var manualOpt = document.createElement('option');
    manualOpt.value = '';
    manualOpt.textContent = '\u270E ' + t('Manual input...');
    manualOpt.style.fontStyle = 'italic';
    manualOpt.style.color = 'var(--grey50)';
    sel.appendChild(manualOpt);
    if (found) sel.value = currentModel;
    sel.style.display = '';
    if (txt) txt.style.display = 'none';
    saveModelListCache(prefix, models);
}

function saveModelListCache(prefix, models) {
    try {
        var api = {};
        if (prefix === 'nes_secondary') {
            api = loadSecondaryApiConfig ? loadSecondaryApiConfig() : {};
        } else {
            var key = 'ne_' + prefix.substring(4) + '_api';
            var raw = localStorage.getItem(key);
            if (raw) api = JSON.parse(raw);
        }
        var cache = { models: models, url: api.url || '', fetchedAt: Date.now() };
        localStorage.setItem(prefix + '_models', JSON.stringify(cache));
    } catch (e) {}
}

function bindChannelFetch(prefix) {
    var fetchBtn = panelById(prefix + '_fetch_models');
    if (!fetchBtn) return;

    var urlId = prefix + '_api_url';
    var keyId = prefix + '_api_key';

    fetchBtn.onclick = function () {
        var urlEl = panelById(urlId);
        var keyEl = panelById(keyId);
        if (!urlEl || !urlEl.value.trim()) {
            var chUrlId = prefix === 'nes_embedding' ? 'nes_embedding_url' : urlId;
            urlEl = panelById(chUrlId);
            if (!urlEl || !urlEl.value.trim()) {
                showToast(t('Please enter an API URL first.'), 'warning');
                return;
            }
        }
        if (fetchBtn) fetchBtn.disabled = true;
        var key = keyEl ? keyEl.value.trim() : '';
        fetchAvailableModels({ url: urlEl.value.trim(), key: key }, 5).then(function (models) {
            var curModel = getModelValue(prefix);
            populateModelSelect(prefix, models, curModel);
            if (fetchBtn) fetchBtn.disabled = false;
        }).catch(function (e) {
            showToast(t('Could not fetch model list') + ': ' + (e.message || ''), 'error');
            if (fetchBtn) fetchBtn.disabled = false;
        });
    };

    var sel = panelById(prefix + '_model_select');
    if (sel) sel.onchange = function () {
        if (sel.value === '') {
            sel.style.display = 'none';
            var txt = panelById(prefix + '_model_text') || panelById(prefix + '_model');
            if (txt) { txt.style.display = ''; txt.value = ''; }
        }
        saveSettingsTab();
    };
}

function saveSettingsTab() {
    var channelsEnabled = panelById('nes_api_channels_enabled') ? panelById('nes_api_channels_enabled').checked : false;
    var settings = {};
    try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}

    settings.useDynamicState = settings.useDynamicState || false;
    if (panelById('nes_disable_state_schema'))
        settings.disableStateSchema = panelById('nes_disable_state_schema').checked;
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
    var scInput2 = panelById('nes_stm_chunk_input');
    if (scInput2) {
        settings.stmChunkMaxChars = Math.max(100, Math.min(10000, Number(scInput2.value) || 500));
    }
    var phInput2 = panelById('nes_ph_batch_input');
    if (phInput2) {
        settings.phBatchChars = Math.max(1000, Math.min(8000, Number(phInput2.value) || 4000));
    }
    if (panelById('nes_stm_summary_ratio'))
        settings.stmSummaryRatio = Number(panelById('nes_stm_summary_ratio').value) / 100;

    settings.memoryConfig = settings.memoryConfig || {};
    if (panelById('nes_extraction_temperature')) {
        settings.memoryConfig.extraction_temperature = Number(panelById('nes_extraction_temperature').value);
        settings.memoryConfig.temperature = settings.memoryConfig.extraction_temperature;
    }
    if (panelById('nes_secondary_url')) {
        settings.memoryConfig.url = panelById('nes_secondary_url').value.trim();
        settings.memoryConfig.model = getModelValue('nes_secondary');
    }

    localStorage.setItem('ne_settings', JSON.stringify(settings));
    setRetrievalEnabled(settings.retrievalEnabled || false);
    var secApi = {
        url: panelById('nes_secondary_url').value.trim(),
        key: panelById('nes_secondary_key').value.trim(),
        model: getModelValue('nes_secondary')
    };
    saveSecondaryApiConfig(secApi);
    if (channelsEnabled) {
        var stmApi = {
            url: panelById('nes_stm_api_url') ? panelById('nes_stm_api_url').value.trim() : '',
            key: panelById('nes_stm_api_key') ? panelById('nes_stm_api_key').value.trim() : '',
            model: getModelValue('nes_stm_api')
        };
        localStorage.setItem('ne_stm_api', JSON.stringify(stmApi));
        var ltmApi = {
            url: panelById('nes_ltm_api_url') ? panelById('nes_ltm_api_url').value.trim() : '',
            key: panelById('nes_ltm_api_key') ? panelById('nes_ltm_api_key').value.trim() : '',
            model: getModelValue('nes_ltm_api')
        };
        localStorage.setItem('ne_ltm_api', JSON.stringify(ltmApi));
        var stateApi = {
            url: panelById('nes_state_api_url') ? panelById('nes_state_api_url').value.trim() : '',
            key: panelById('nes_state_api_key') ? panelById('nes_state_api_key').value.trim() : '',
            model: getModelValue('nes_state_api')
        };
        localStorage.setItem('ne_state_api', JSON.stringify(stateApi));
        var templateApi = {
            url: panelById('nes_template_api_url') ? panelById('nes_template_api_url').value.trim() : '',
            key: panelById('nes_template_api_key') ? panelById('nes_template_api_key').value.trim() : '',
            model: getModelValue('nes_template_api')
        };
        localStorage.setItem('ne_template_api', JSON.stringify(templateApi));
        var chEmbApi = {
            url: panelById('nes_embedding_url') ? panelById('nes_embedding_url').value.trim() : '',
            key: panelById('nes_embedding_key') ? panelById('nes_embedding_key').value.trim() : '',
            model: getModelValue('nes_embedding')
        };
        saveEmbeddingApiConfig(chEmbApi);
    }
    console.log('[NE] Settings saved from Settings tab');
    neSyncAll();
}

function saveSecApiOnly() {
    var secApi = {
        url: panelById('nes_secondary_url') ? panelById('nes_secondary_url').value.trim() : '',
        key: panelById('nes_secondary_key') ? panelById('nes_secondary_key').value.trim() : '',
        model: getModelValue('nes_secondary')
    };
    saveSecondaryApiConfig(secApi);
}

function saveEmbeddingApiOnly() {
    var embApi = {
        url: panelById('nes_embedding_url') ? panelById('nes_embedding_url').value.trim() : '',
        key: panelById('nes_embedding_key') ? panelById('nes_embedding_key').value.trim() : '',
        model: getModelValue('nes_embedding')
    };
    saveEmbeddingApiConfig(embApi);
}

// Renders settings + tools into a slide-in panel container
export function renderSettingsIntoSlide(container) {
    container.innerHTML = '';

    // ── Engine & API Settings ──
    var secTitle = pdCreate('div');
    secTitle.className = 'ne-settings-section-card';
    secTitle.style.marginBottom = '8px';
    secTitle.innerHTML = '<div class="ne-settings-section-title">\u2605 ' + t('Common Settings') + '</div><div id="ne_common_settings"></div>';
    container.appendChild(secTitle);

    var advTitle = pdCreate('div');
    advTitle.className = 'ne-settings-section-card';
    advTitle.innerHTML = '<div class="ne-settings-section-title">\u2697 ' + t('Advanced Settings') + '</div><div id="ne_advanced_settings"></div>';
    container.appendChild(advTitle);

    // ── Data Management ──
    var dmTitle = pdCreate('div');
    dmTitle.className = 'ne-tool-card';
    dmTitle.innerHTML = '<div class="ne-tool-card-title">' + t('Data') + '</div>' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
        '<button id="narrative_vault_export_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;">' + t('Export JSON') + '</button>' +
        '<button id="narrative_vault_export_diag" class="menu_button" style="font-size:0.85em;padding:2px 8px;">' + '诊断导出' + '</button>' +
        '<button id="narrative_vault_import_json" class="menu_button" style="font-size:0.85em;padding:2px 8px;">' + t('Import JSON') + '</button>' +
        '<button id="narrative_vault_embed_chat" class="menu_button" style="font-size:0.85em;padding:2px 8px;">' + t('Embed into Chat') + '</button>' +
        '<button id="narrative_vault_clean_orphans" class="menu_button" style="font-size:0.85em;padding:2px 8px;">' + t('Clean Orphan Data') + '</button>' +
        '</div>';
    container.appendChild(dmTitle);

    // ── Diagnostics (dev only) ──
    if (__NE_DEV_MODE) {
        var diagTitle = pdCreate('div');
        diagTitle.className = 'ne-tool-card';
        diagTitle.innerHTML = '<div class="ne-tool-card-title">' + t('Diagnostics') + '</div>' +
            '<div class="ne-accordion" id="ne-tool-test-runner">' +
            '<div class="ne-accordion-header"><span class="ne-accordion-chevron">\u25B6</span> <span style="margin-right:6px;">\u2699</span> ' + t('Test Runner') + '</div>' +
            '<div class="ne-accordion-body"><div id="ne-tr-container" class="ne-tr-container"></div></div></div>';
        container.appendChild(diagTitle);

        // ── Troubleshoot (dev only) ──
        var tsTitle = pdCreate('div');
        tsTitle.className = 'ne-tool-card';
        tsTitle.innerHTML = '<div class="ne-tool-card-title">' + t('Troubleshoot') + '</div>';
        container.appendChild(tsTitle);
    }

    // Render settings content
    renderSettingsTab();

    // Event handlers for data management buttons

    // Export button
    var exportBtn = container.querySelector('#narrative_vault_export_json');
    if (exportBtn) {
        exportBtn.onclick = async function() {
            var chatId = typeof _currentGetChatId === 'function' ? _currentGetChatId() : _currentGetChatId;
            try {
                var vault = await readVault(chatId);
                var json = JSON.stringify(vault, null, 2);
                var blob = new Blob([json], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = 'ne_vault_' + chatId + '.json';
                document.body.appendChild(a); a.click();
                document.body.removeChild(a); URL.revokeObjectURL(url);
            } catch (e) { alert(t('Export failed') + ': ' + e.message); }
        };
    }

    // Diagnostic export button
    var diagBtn = container.querySelector('#narrative_vault_export_diag');
    if (diagBtn) {
        diagBtn.onclick = async function() {
            var chatId = typeof _currentGetChatId === 'function' ? _currentGetChatId() : _currentGetChatId;
            try {
                var [vault, chain, deltas, versions] = await Promise.all([
                    readVault(chatId),
                    getActiveChain(chatId),
                    listStateDeltas(chatId, 200),
                    listMemoryVersions(chatId, 200)
                ]);
                var output = {
                    chatId: chatId,
                    exported_at: new Date().toISOString(),
                    vault: vault,
                    versionChain: chain,
                    stateDeltas: deltas,
                    memoryVersions: versions
                };
                var json = JSON.stringify(output, null, 2);
                var blob = new Blob([json], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = 'ne_diag_' + chatId + '.json';
                document.body.appendChild(a); a.click();
                document.body.removeChild(a); URL.revokeObjectURL(url);
                showToast('诊断数据已导出', 'success');
            } catch (e) {
                showToast('诊断导出失败: ' + e.message, 'error', 6000);
            }
        };
    }

    // Import button
    var importBtn = container.querySelector('#narrative_vault_import_json');
    if (importBtn) {
        importBtn.onclick = function() {
            var chatId = typeof _currentGetChatId === 'function' ? _currentGetChatId() : _currentGetChatId;
            var input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
            input.onchange = async function() {
                var file = input.files[0]; if (!file) return;
                try {
                    var text = await new Promise(function(r) { var fr = new FileReader(); fr.onload = function(e) { r(e.target.result); }; fr.readAsText(file); });
                    var imported = JSON.parse(text);
                    await writeMemory(chatId, imported);
                    recordMemoryVersion(chatId, { type: 'manual_edit', summary: '导入 vault', delta: {}, message_dates: [] }).catch(function(e) { console.warn('[NE] manual_edit version record failed:', e); });
                    recordStateDelta(chatId, { source: 'manual_edit', summary: '导入 vault', changes: [], message_dates: [] }).catch(function(e) { console.warn('[NE] manual_edit version record failed:', e); });
                    busEmit('vault:updated', { getChatId: _currentGetChatId });
                } catch (e) { alert(t('Import failed') + ': ' + e.message); }
            };
            input.click();
        };
    }

    // Embed button
    var embedBtn = container.querySelector('#narrative_vault_embed_chat');
    if (embedBtn) {
        embedBtn.onclick = async function() {
            try {
                if (!confirm(t('Embed vault into chat_metadata for backup?'))) return;
                var ctx = window.parent.SillyTavern && window.parent.SillyTavern.getContext ? window.parent.SillyTavern.getContext() : null;
                if (!ctx || !ctx.chatMetadata || typeof ctx.saveChat !== 'function') { alert(t('Cannot access chat metadata.')); return; }
                var vault = await readVault(_currentGetChatId);
                ctx.chatMetadata.ne_embedded_vault = vault;
                if (typeof ctx.saveChatDebounced === 'function') ctx.saveChatDebounced();
                else if (typeof ctx.saveChat === 'function') ctx.saveChat();
                alert(t('Vault embedded successfully.'));
            } catch (e) { alert(t('Embed failed') + ': ' + e.message); }
        };
    }

    // Clean orphans
    var cleanBtn = container.querySelector('#narrative_vault_clean_orphans');
    if (cleanBtn) {
        cleanBtn.onclick = async function() {
            try {
                cleanBtn.disabled = true; cleanBtn.textContent = t('Scanning...');
                var results = await scanOrphans();
                cleanBtn.disabled = false; cleanBtn.textContent = t('Clean Orphan Data');
                var orphans = results.filter(function(r) { return r.status === 'orphan'; });
                if (orphans.length === 0) { alert(t('No orphan data found.')); return; }
                var msg = t('Orphan data scan results:') + '\n' + orphans.length + ' ' + t('orphans') + '\n';
                orphans.forEach(function(o) { msg += '  - ' + o.chat_id + '\n'; });
                if (!confirm(msg + '\n' + t('Delete these orphan vaults?'))) return;
                var count = 0;
                orphans.forEach(function(o) { purgeOrphanChatData(o.chat_id); count++; });
                alert(t('Cleaned') + ' ' + count + ' ' + t('orphan entries') + '.');
            } catch (e) { alert(t('Clean Orphan Data') + ' failed: ' + e.message); cleanBtn.disabled = false; cleanBtn.textContent = t('Clean Orphan Data'); }
        };
    }

    // Accordion setup for test runner
    var accs = container.querySelectorAll('.ne-accordion-header');
    accs.forEach(function(header) {
        header.onclick = function() {
            var acc = this.closest('.ne-accordion');
            if (!acc) return;
            acc.classList.toggle('open');
        };
    });

    // Init test runner
    if (__NE_DEV_MODE) {
        try { initTestRunner(); } catch (e) {}
    }
}
