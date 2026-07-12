/**
 * api/llm.js — LLM 调用封装
 *
 * 优先级：localStorage 中的副 API 配置 → TavernHelper.generateRaw() 回退
 * 副 API Key 永远不到云端，存在浏览器本地。
 */
import { POWER_SLOTS_TEMPLATES } from '../vault/schema.js';
import { runtime } from '../runtime.js';
import { recordChatStat, recordChatToken } from '../engine/chat-telemetry.js';
import { recordDailyToken } from '../engine/token-stats.js';
import { neSync } from '../settings-adapter.js';

function getConfiguredTimeoutSec(fallbackSec) {
    fallbackSec = fallbackSec || 120;
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var settings = JSON.parse(raw);
            if (settings.apiTimeoutMs && typeof settings.apiTimeoutMs === 'number') {
                return Math.max(10, Math.floor(settings.apiTimeoutMs / 1000));
            }
        }
    } catch (e) {}
    return fallbackSec;
}

export function validateApiKey(key) {
    if (!key) return { valid: true, warning: null };
    var issues = [];
    if (/[^\x20-\x7E]/.test(key)) {
        issues.push('API Key contains non-ASCII characters (e.g. Chinese punctuation, fullwidth spaces)');
    }
    if (key.startsWith('sk-') && key.length < 20) {
        issues.push('API Key starts with sk- but seems too short (length < 20)');
    }
    if (key !== key.trim()) {
        issues.push('API Key has leading/trailing spaces — auto-trimmed on save');
    }
    return {
        valid: issues.length === 0,
        warning: issues.length > 0 ? issues.join('; ') : null
    };
}
import { countTokens } from '../engine/text-utils.js';

export let telemetryBuffer = [];

export function recordTelemetry(entry, chatId) {
    entry.chat_id = chatId || null;
    telemetryBuffer.push({ ts: new Date().toISOString(), ...entry });
    if (telemetryBuffer.length > 200) telemetryBuffer.shift();
}

export function isTelemetryEnabled() {
    try {
        const raw = localStorage.getItem('ne_settings');
        if (raw) return JSON.parse(raw).enableTelemetry || false;
    } catch (e) {}
    return false;
}

async function loadMemoryConfig() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            return s.memoryConfig || {};
        }
    } catch (e) {}
    return {};
}

export async function callMemoryLLM(messages, options = {}) {
    var callRoundTag = globalThis.__ne_tr_currentRound || null;
    var secondaryConfig;
    if (options._forcePipelineApi) {
        secondaryConfig = resolvePipelineApi(options.operation);
    } else {
        secondaryConfig = loadSecondaryApiConfig();
    }
    const startTime = Date.now();
    let response = null;
    let apiSource = 'tavern';
    let usage = null;
    var _toolCalls = null;

    if (secondaryConfig && secondaryConfig.url && secondaryConfig.model) {
        try {
            console.log('[NE] LLM call via secondary API:', secondaryConfig.model);
            var defaultResponseFormat = options.hasOwnProperty('responseFormat') ? options.responseFormat : { type: "json_object" };
            var callOpts = Object.assign({}, options, { responseFormat: defaultResponseFormat });
            var customResult = await callCustomAPI(secondaryConfig, messages, callOpts);
            response = customResult.content;
            usage = customResult.usage;
            _toolCalls = customResult.tool_calls || null;
            apiSource = customResult._viaProxy ? 'proxy' : 'secondary';
        } catch (e) {
            console.warn('[NE] Secondary API failed, falling back to TH:', e.message);
            console.warn('[NE]   URL:', secondaryConfig.url, ' Model:', secondaryConfig.model);
            notifySecondaryApiFailure(e.message);
            response = await callTavernHelper(messages, options);
            apiSource = 'tavern';
        }
    } else {
        console.log('[NE] LLM call via TavernHelper (no secondary API configured)');
        response = await callTavernHelper(messages, options);
        apiSource = 'tavern';
    }

    var durationMs = Date.now() - startTime;

    console.log('[NE] LLM call done — source=' + apiSource + ', dur=' + durationMs + 'ms, len=' + (response ? response.length : 0));

    if (options._returnRaw) {
        return { content: response || '', usage: usage, tool_calls: _toolCalls, source: apiSource, durationMs: durationMs };
    }

    var chatId = options.chatId || null;

    var TOKEN_OP_MAP = {
        stm_extract: 'tok_stm',
        ltm_decision: 'tok_ltm', ltm_decision_retry: 'tok_ltm', ltm_rebatch: 'tok_ltm',
        state_extract: 'tok_state', faction_discovery: 'tok_state',
        scheme_discovery: 'tok_tool', template_scheme: 'tok_tool', template_proposal: 'tok_tool',
        access: 'tok_tool', recall_memory: 'tok_tool', init_power_slots: 'tok_tool'
    };

    if (chatId) {
        recordChatStat(chatId, 'llm', 1);
        var totalTokens = usage ? (usage.total_tokens || 0) : 0;
        if (totalTokens > 0) {
            var op = options.operation || 'memory';
            var tokenOp = TOKEN_OP_MAP[op] || 'tok';
            recordChatToken(chatId, tokenOp, totalTokens);
            recordDailyToken(tokenOp, totalTokens);
        } else if (response) {
            var responseText = typeof response === 'string' ? response : (response.content || '');
            var estimated = countTokens(responseText);
            if (estimated > 0) {
                var op = options.operation || 'memory';
                var tokenOp = TOKEN_OP_MAP[op] || 'tok';
                recordChatToken(chatId, tokenOp, estimated);
                recordDailyToken(tokenOp, estimated);
            }
        }
    }

    if (isTelemetryEnabled()) {
        recordTelemetry({
            operation: options.operation || 'memory',
            api_source: apiSource,
            duration_ms: durationMs,
            response_length: response ? response.length : 0,
            prompt_tokens: usage ? usage.prompt_tokens : undefined,
            completion_tokens: usage ? usage.completion_tokens : undefined,
            total_tokens: usage ? usage.total_tokens : undefined
        }, chatId);
    }

    firePipelineCallbacks({
        operation: options.operation || 'memory',
        messages: messages,
        response: response || '',
        usage: usage,
        source: apiSource,
        durationMs: durationMs,
        ts: new Date().toISOString(),
        roundTag: callRoundTag
    });

    if (globalThis.__NE_DEV_MODE) {
        globalThis.__ne_debug_all_pipeline_responses = (globalThis.__ne_debug_all_pipeline_responses || '') + (response || '') + '\n---\n';
    }

    return response;
}

var _pipelineCallbacks = [];

export function onPipelineLLMCall(fn) {
    _pipelineCallbacks.push(fn);
}

export function offPipelineLLMCall(fn) {
    var idx = _pipelineCallbacks.indexOf(fn);
    if (idx !== -1) _pipelineCallbacks.splice(idx, 1);
}

function firePipelineCallbacks(data) {
    for (var i = 0; i < _pipelineCallbacks.length; i++) {
        try { _pipelineCallbacks[i](data); } catch (e) {}
    }
}

export async function callMemoryPipeline(messages, options = {}, chatId = null) {
    var mc = await loadMemoryConfig();
    return callMemoryLLM(messages, Object.assign({}, options, {
        _forcePipelineApi: true,
        temperature: mc.extraction_temperature || mc.temperature || 0.2,
        max_tokens: mc.stm_max_tokens,
        chatId: chatId
    }));
}

/**
 * callMemoryPipeline with optional function-calling tool loop support.
 * If options.tools is present, the LLM call includes tool definitions.
 * On tool_calls in the response, tools are processed and the loop continues
 * for up to MAX_TOOL_ITERATIONS rounds.
 *
 * @param {Array<Object>} messages
 * @param {Object} [options]
 * @param {Array<Object>} [options.tools]
 * @param {function(Array, Object, string):Promise<Object>} [options.processToolCalls]
 * @param {number} [options.maxToolIterations]
 * @param {string|null} [chatId]
 * @returns {Promise<string>} — final text response (without tool_calls)
 */
export async function callMemoryPipelineWithTools(messages, options, chatId) {
    options = options || {};
    var tools = options.tools;
    if (!tools || !tools.length) {
        var textResp = await callMemoryPipeline(messages, options, chatId);
        return { text: textResp, tool_calls: null };
    }

    var mc = await loadMemoryConfig();
    var result = await callMemoryLLM(messages, Object.assign({}, options, {
        _forcePipelineApi: true,
        _returnRaw: true,
        tool_choice: 'auto',
        temperature: mc.extraction_temperature || mc.temperature || 0.2,
        max_tokens: mc.stm_max_tokens,
        chatId: chatId
    }));

    return { text: result.content || '', tool_calls: result.tool_calls || null };
}


export async function callMemoryRetrieval(messages, options = {}, chatId = null) {
    var mc = await loadMemoryConfig();
    return callMemoryLLM(messages, Object.assign({ temperature: mc.temperature || 0.3, max_tokens: mc.stm_max_tokens, chatId: chatId }, options));
}

function resolvePipelineApi(operation) {
    var channelsEnabled = false;
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            channelsEnabled = s.apiChannelsEnabled === true;
        }
    } catch (e) {}

    if (!channelsEnabled) {
        return loadSecondaryApiConfig();
    }

    var channelKey = null;
    if (operation === 'stm_extract' || operation === 'stm_boundary') {
        channelKey = 'ne_stm_api';
    } else if (operation && (operation.startsWith('ltm_') || operation === 'ltm_rebatch')) {
        channelKey = 'ne_ltm_api';
    } else if (operation === 'state_extract' || operation === 'scheme_discovery' || operation === 'faction_discovery') {
        channelKey = 'ne_state_api';
    }

    if (channelKey) {
        var channelConfig = null;
        try {
            var channelRaw = localStorage.getItem(channelKey);
            if (channelRaw) channelConfig = JSON.parse(channelRaw);
        } catch (e) {}
        if (channelConfig && channelConfig.url && channelConfig.model) {
            return channelConfig;
        }
    }

    return loadSecondaryApiConfig();
}

export function loadSecondaryApiConfig() {
    try {
        const raw = localStorage.getItem('ne_secondary_api');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

export function saveSecondaryApiConfig(config) {
    if (config && config.url) config.url = normalizeApiUrl(config.url);
    localStorage.setItem('ne_secondary_api', JSON.stringify(config));
    try { neSync('ne_secondary_api'); } catch (e) {}
}


function normalizeApiUrl(url) {
    if (!url || typeof url !== 'string') return url;
    var trimmed = url.trim().replace(/\/+$/, '');
    // ST local proxy — leave as-is (it has its own path format)
    if (/\/llm\/chat$/.test(trimmed)) return trimmed;
    // Common OpenAI-compatible endpoint — already correct
    if (/\/v1\/chat\/completions$/.test(trimmed)) return trimmed;
    // Base URL without path: append /v1/chat/completions
    if (/^(https?:\/\/[^\/]+)\/?$/.test(trimmed)) {
        return trimmed.replace(/\/+$/, '') + '/v1/chat/completions';
    }
    // Partial path like /v1 or /v1/chat — append completions
    if (/\/v1\/?$/.test(trimmed)) { return trimmed.replace(/\/+$/, '') + '/chat/completions'; }
    if (/\/v1\/chat\/?$/.test(trimmed)) { return trimmed.replace(/\/+$/, '') + '/completions'; }
    // Unknown path — warn but don't modify
    console.warn('[NE] API URL may be incorrect — expected /v1/chat/completions or /llm/chat, got:', trimmed);
    return trimmed;
}

function notifySecondaryApiFailure(reason) {
    var now = Date.now();
    if (now - _lastSecondaryApiWarn < 60000) return; // at most once per minute
    _lastSecondaryApiWarn = now;
    try {
        runtime.notify('Falling back to main API. ' + (reason || 'Connection failed'), 'Secondary API unreachable', { timeOut: 6000, type: 'warning' });
    } catch (e) {}
}

function deriveModelsUrl(chatUrl) {
    if (!chatUrl || typeof chatUrl !== 'string') return null;
    var trimmed = chatUrl.trim().replace(/\/+$/, '');
    if (/\/v1\/chat\/completions$/.test(trimmed)) {
        return trimmed.replace(/\/chat\/completions$/, '/models');
    }
    if (/\/v1\/?$/.test(trimmed)) {
        return trimmed.replace(/\/+$/, '') + '/models';
    }
    if (/^(https?:\/\/[^\/]+)\/?$/.test(trimmed)) {
        return trimmed.replace(/\/+$/, '') + '/v1/models';
    }
    if (/\/llm\/chat$/.test(trimmed)) {
        return trimmed.replace(/\/chat$/, '/models');
    }
    return null;
}

export async function fetchAvailableModels(config, timeoutSec) {
    timeoutSec = timeoutSec || 5;
    if (!config || !config.url) throw new Error('No URL configured');
    var modelsUrl = deriveModelsUrl(config.url);
    if (!modelsUrl) throw new Error('Cannot derive /v1/models URL from: ' + config.url);

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutSec * 1000);

    function doFetch(targetUrl) {
        return fetch(targetUrl, {
            method: 'GET',
            headers: config.key ? { 'Authorization': 'Bearer ' + config.key } : {},
            signal: controller.signal
        }).then(function (resp) {
            clearTimeout(timer);
            if (!resp.ok) throw new Error('API error: ' + resp.status);
            return resp.json().then(function (data) {
                if (!data || !Array.isArray(data.data)) throw new Error('Unexpected response format from /v1/models');
                return data.data.map(function (m) { return m.id; });
            });
        }, function (e) {
            clearTimeout(timer);
            throw e;
        });
    }

    function isNetErr(e) {
        var msg = e.message || 'Unknown error';
        return /Load[_ ]?[Ff]ailed/i.test(msg) || /NetworkError/i.test(msg) || msg === 'Failed to fetch' || msg === 'TypeError: Failed to fetch';
    }

    try {
        return await doFetch(modelsUrl);
    } catch (e) {
        if (!isNetErr(e)) {
            if (e.name === 'AbortError') throw new Error('Request timed out after ' + timeoutSec + 's');
            throw e;
        }
        console.warn('[NE] /v1/models direct fetch failed (' + e.message + '), trying ST proxy...');
    }

    try {
        var proxyUrl = 'http://127.0.0.1:8000/proxy/' + encodeURIComponent(modelsUrl);
        return await doFetch(proxyUrl);
    } catch (e2) {
        if (isNetErr(e2)) {
            throw new Error('Cannot reach /v1/models — direct fetch blocked (CORS/mixed-content)');
        }
        if (e2.name === 'AbortError') throw new Error('Request timed out after ' + timeoutSec + 's (via proxy)');
        throw e2;
    }
}

export async function testSecondaryApiConnection(config) {
    if (!config || !config.url) return { success: false, error: 'No URL configured', errorType: null };
    if (!config.model) return { success: false, error: 'No model configured', errorType: null };

    try {
        var models = await fetchAvailableModels(config, 5);
        if (models && models.length > 0) {
            var modelInList = models.indexOf(config.model) !== -1;
            return {
                success: true,
                connectionType: 'models',
                models: models,
                model: config.model,
                modelInList: modelInList,
                error: modelInList ? null : 'Model "' + config.model + '" not found in /v1/models list (API is reachable)',
                errorType: null
            };
        }
        return {
            success: false,
            connectionType: 'models',
            models: models,
            model: config.model,
            modelInList: false,
            error: '/v1/models returned empty list',
            errorType: 'empty_list'
        };
    } catch (e) {
        console.warn('[NE] /v1/models failed, falling back to chat ping:', e.message);
    }

    try {
        var result = await callCustomAPI(config, [
            { role: 'system', content: 'Respond with OK only. No other text.' },
            { role: 'user', content: 'ping' }
        ], { timeout: getConfiguredTimeoutSec(120), temperature: 0, max_tokens: 64 });
        if (!result.content || result.content.trim().length === 0) {
            console.warn('[NE] testSecondaryApiConnection — raw response:', JSON.stringify(result._raw).substring(0, 500));
            return { success: false, connectionType: 'ping', models: [], model: config.model, modelInList: null, error: 'API returned empty response. Check browser console (F12) for raw response data.', errorType: 'empty_response' };
        }
        return { success: true, connectionType: 'ping', models: [], model: config.model, modelInList: null, error: null, errorType: null };
    } catch (e) {
        console.warn('[NE] testSecondaryApiConnection — error:', e.message || e);
        var errorType = 'unknown';
        var msg = e.message || 'Connection failed';
        if (e.name === 'AbortError') {
            errorType = 'timeout';
        } else if (/Load[_ ]?[Ff]ailed|NetworkError|Failed to fetch|TypeError: Failed to fetch/i.test(msg)) {
            errorType = 'network';
        } else if (/API error: 401|403/.test(msg)) {
            errorType = 'auth';
        } else if (/API error: 4\d\d/.test(msg)) {
            errorType = 'http_4xx';
        } else if (/API error: 5\d\d/.test(msg)) {
            errorType = 'http_5xx';
        }
        return { success: false, connectionType: 'none', models: [], model: config.model, modelInList: null, error: msg, errorType: errorType };
    }
}

export async function sendSecondaryTestMessage(config) {
    if (!config || !config.url) throw new Error('No URL configured');
    var startMs = Date.now();
    var timeoutSec = getConfiguredTimeoutSec(120);
    var result = await callCustomAPI(config, [{ role: 'user', content: 'Hi' }], { timeout: timeoutSec, temperature: 0.0, max_tokens: 128 });
    var latencyMs = Date.now() - startMs;
    if (!result.content || result.content.trim().length === 0) {
        console.warn('[NE] sendSecondaryTestMessage — raw response:', JSON.stringify(result._raw).substring(0, 500));
        throw new Error('API returned empty response. Check browser console (F12) for raw response data.');
    }
    return { content: result.content, latencyMs: latencyMs };
}

var _proxyNotified = false;

async function callCustomAPI(config, messages, options) {
    if (!config.url) throw new Error('No API URL configured');
    if (!config.model) throw new Error('No API model configured');
    const headers = { 'Content-Type': 'application/json' };
    if (config.key) headers['Authorization'] = 'Bearer ' + config.key;
    const body = JSON.stringify({
        model: config.model,
        messages: messages,
        temperature: options.temperature || 0.3,
        max_tokens: options.max_tokens || 4096,
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
        ...(options.thinking === true ? { thinking: { type: 'enabled' } } : {}),
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.tool_choice ? { tool_choice: options.tool_choice } : {})
    });
    const timeoutSec = options.timeout || getConfiguredTimeoutSec(120);

    // --- inner: attempt a single fetch ---
    function attemptFetch(targetUrl) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutSec * 1000);
        return fetch(targetUrl, {
            method: 'POST',
            headers: headers,
            body: body,
            signal: controller.signal
        }).then(function (response) {
            clearTimeout(timer);
            if (!response.ok) throw new Error('API error: ' + response.status);
            return response.json().then(function (data) {
                var msg = data.choices?.[0]?.message || {};
                var content = msg.content || msg.reasoning_content || data.choices?.[0]?.text || data.content || '';
                var usage = data.choices?.[0]?.usage || data.usage || null;
                var toolCalls = msg.tool_calls || null;
                if (!content && !toolCalls) {
                    console.warn('[NE] API returned empty content — status=' + response.status + ', keys=' + Object.keys(data).join(',') + ', hasChoices=' + !!data.choices + ', choiceCount=' + (data.choices ? data.choices.length : 0) + ', firstChoiceKeys=' + (data.choices?.[0] ? Object.keys(data.choices[0]).join(',') : 'none') + ', usage=' + JSON.stringify(usage || {}));
                }
                return { content: content, usage: usage, tool_calls: toolCalls, _raw: data };
            });
        }, function (e) {
            clearTimeout(timer);
            throw e;
        });
    }

    function isNetworkError(e) {
        var msg = e.message || 'Unknown error';
        return /Load[_ ]?[Ff]ailed/i.test(msg) || /NetworkError/i.test(msg) || msg === 'Failed to fetch' || msg === 'TypeError: Failed to fetch';
    }

    function shouldRetry(e) {
        if (e.name === 'AbortError') return true;
        var msg = e.message || '';
        if (/NetworkError|Failed to fetch|Load[_ ]?[Ff]ailed/i.test(msg)) return true;
        if (/API error: 5\d\d/.test(msg)) return true;
        if (/API error: 401|403/.test(msg)) return false;
        if (/API error: 4\d\d/.test(msg)) return false;
        return false;
    }

    var maxRetries = 2;
    var retryDelayMs = 1000;
    var proxyAttempted = false;

    for (var attempt = 0; attempt <= maxRetries; attempt++) {
        var lastError = null;

        // 1. Try direct
        try {
            return await attemptFetch(config.url);
        } catch (e) {
            lastError = e;
            if (!isNetworkError(e)) {
                if (e.name === 'AbortError') lastError = new Error('Request timed out after ' + timeoutSec + 's');
                if (!shouldRetry(lastError)) throw lastError;
            } else {
                console.warn('[NE] Direct fetch failed (' + e.message + '), trying ST proxy...');
                proxyAttempted = true;
            }
        }

        // 2. Retry through ST CORS proxy
        try {
            var origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://127.0.0.1:8000';
            var proxyUrl = origin + '/proxy/' + encodeURIComponent(config.url);
            var result = await attemptFetch(proxyUrl);
            result._viaProxy = true;
            if (!_proxyNotified) {
                _proxyNotified = true;
                console.log('[NE] Connected via ST CORS proxy (' + proxyUrl + ')');
            }
            return result;
        } catch (e2) {
            lastError = e2;
            if (isNetworkError(e2) || (e2.message && /^API error: 404/.test(e2.message))) {
                lastError = new Error(
                    'Cannot reach ' + (config.url || 'API') + ' — direct fetch blocked (CORS/mixed-content) and ST CORS proxy is unreachable. ' +
                    'Check:\n' +
                    '1. SillyTavern is running (not just the config file)\n' +
                    '2. config.yaml: enableCorsProxy: true\n' +
                    '3. Restarted SillyTavern after changing config\n' +
                    '4. URL is accessible from this machine (not behind VPN/firewall)\n' +
                    'Proxy URL tried: ' + proxyUrl
                );
            } else if (e2.name === 'AbortError') {
                lastError = new Error('Request timed out after ' + timeoutSec + 's (via proxy)');
            }

            if (shouldRetry(lastError) && attempt < maxRetries) {
                var delay = retryDelayMs * Math.pow(2, attempt);
                console.warn('[NE] API call attempt ' + (attempt + 1) + ' failed, retrying in ' + delay + 'ms:', lastError.message);
                await new Promise(function (r) { setTimeout(r, delay); });
                continue;
            }
            throw lastError;
        }
    }
}

async function callTavernHelper(messages, options) {
    // Note: TH API does not support AbortController. Promise.race timeout
    // rejects the caller's promise but the underlying HTTP request continues.
    // callCustomAPI correctly uses AbortController for the secondary API path.
    var timeoutMs = (options.timeout || getConfiguredTimeoutSec(120)) * 1000;

    var raceWithTimeout = function(promise) {
        return Promise.race([
            promise,
            new Promise(function(_, reject) {
                setTimeout(function() { reject(new Error('Timeout after ' + (options.timeout || getConfiguredTimeoutSec(120)) + 's')); }, timeoutMs);
            })
        ]);
    };

    // 1. Primary: generateQuiet — silent background processing, no chat output
    try {
        console.log('[NE] callTavernHelper via generateQuiet, timeout=' + (options.timeout || 120) + 's');
        var quietResponse = await raceWithTimeout(runtime.generateQuiet(
            messages[messages.length - 1].content,
            messages[0].content
        ));
        if (quietResponse) return quietResponse;
    } catch (e) {
        console.warn('[NE] Quiet prompt failed:', e);
    }

    // 2. Fallback: generateRaw — may produce visible chat output in some ST versions
    try {
        console.log('[NE] callTavernHelper via generateRaw (fallback), timeout=' + (options.timeout || 120) + 's');
        var rawResponse = await raceWithTimeout(runtime.generateRaw({
            ordered_prompts: messages,
            should_stream: false
        }));
        if (rawResponse) return rawResponse;
    } catch (e) {
        console.warn('[NE] generateRaw failed:', e);
    }
    throw new Error('No LLM backend available. Configure secondary API in NE settings.');
}

var _powerSlotsInited = {};
var _lastSecondaryApiWarn = 0;

export async function initPowerSlots(characterName, existingSlotsForWorld) {
    // Dedup: skip if already attempted for this character (success or failure)
    if (_powerSlotsInited[characterName]) return null;
    _powerSlotsInited[characterName] = true;

    var contextText = '';
    try {
        var chars = runtime.getCharacters() || [];
        var char = chars.find(function (c) { return c.name === characterName; });
        if (char) {
            contextText += '=== Character Card ===\n';
            contextText += 'Name: ' + (char.name || characterName) + '\n';
            if (char.description) contextText += 'Description: ' + char.description + '\n';
            if (char.personality) contextText += 'Personality: ' + char.personality + '\n';
            if (char.scenario) contextText += 'Scenario: ' + char.scenario + '\n';
        }
        var worldInfo = runtime.getWorldInfo();
        if (worldInfo && worldInfo.entries && Object.keys(worldInfo.entries).length > 0) {
            var enabledBooks = {};
            try {
                var globalSelect = null;
                var wi2 = runtime.getWorldInfo();
                if (wi2 && wi2.globalSelect && Array.isArray(wi2.globalSelect)) {
                    globalSelect = wi2.globalSelect;
                }
                if (!globalSelect) {
                    var pus2 = runtime.getPowerUserCfg();
                    if (pus2 && pus2.world_info && Array.isArray(pus2.world_info.globalSelect)) {
                        globalSelect = pus2.world_info.globalSelect;
                    }
                }
                if (globalSelect) {
                    for (var si2 = 0; si2 < globalSelect.length; si2++) {
                        enabledBooks[globalSelect[si2]] = true;
                    }
                }
            } catch (e2) {}
            var hasEnabledFilter2 = Object.keys(enabledBooks).length > 0;

            contextText += '\n=== World Book Entries ===\n';
            Object.keys(worldInfo.entries).forEach(function (key) {
                var entry = worldInfo.entries[key];
                if (!entry || !entry.content) return;
                if (entry.disable) return;
                if (hasEnabledFilter2 && entry.world && !enabledBooks[entry.world]) return;
                contextText += '[' + (entry.key || key) + '] ' + entry.content + '\n';
            });
        }
    } catch (e) {}

    if (!contextText) return null;

    var lowerText = contextText.toLowerCase();
    var powerKeywords = ['修炼', '灵力', '真气', '内力', '修为', '境界', '筑基', '金丹', '元婴',
        'cultivation', 'mana', 'qi', 'chi', 'spiritual', 'realm', 'combat', '战斗',
        'power level', 'energy', 'vitality', 'strength', '等级', '权限'];
    var hasPowerSystem = false;
    for (var i = 0; i < powerKeywords.length; i++) {
        if (lowerText.indexOf(powerKeywords[i].toLowerCase()) !== -1) {
            hasPowerSystem = true;
            break;
        }
    }
    if (!hasPowerSystem) return null;

    var customTemplates = null;
    try {
        var raw = localStorage.getItem('ne_power_slots_templates');
        if (raw) customTemplates = JSON.parse(raw);
    } catch (e) {}
    var templates = customTemplates || POWER_SLOTS_TEMPLATES;

    var templateSummary = '';
    var tkeys = Object.keys(templates);
    tkeys.forEach(function (key) {
        var t = templates[key];
        templateSummary += key + ': vitality=' + t.slots.vitality.label + ', energy=' + t.slots.energy.label + ', realm=' + t.slots.realm.label + '\n';
    });

    var existingText = '';
    if (existingSlotsForWorld && existingSlotsForWorld.length > 0) {
        existingText = '\nIMPORTANT: Other characters in this world already use these slot labels. If this character belongs to the same cultivation/power system, REUSE the same labels:\n';
        existingSlotsForWorld.forEach(function (s) {
            existingText += '- ' + s.key + ': "' + s.label + '"\n';
        });
    }

    var prompt = {
        system: 'You analyze a character card and world book to determine if power/energy tracking slots are needed.\n\n' +
            'Reference templates (guidance only, world book definitions take priority):\n' + templateSummary + '\n' +
            'Rules:\n' +
            '- At most 3 slots: 1 vitality, 1 energy, 1 realm\n' +
            '- If world book has clear energy/power system definitions, use those exact names as labels\n' +
            '- If world book has no clear definitions but the world implies a power system, infer appropriate names from context\n' +
            '- If the character has no combat/cultivation/power elements, output NO_POWER_SLOTS\n' +
            '- Templates are reference ONLY; always prioritize world book definitions\n' +
            '- Labels should be in Chinese if the world is Chinese-themed, in English otherwise\n' +
            existingText + '\n' +
            'Output format:\n' +
            'If power slots are needed: a JSON array of slot definitions\n' +
            '[{"key":"vitality","label":"气血","description":"Physical health and vitality level"},...]\n' +
            'If NOT needed: NO_POWER_SLOTS\n' +
            'Only output the JSON array or NO_POWER_SLOTS. No other text.',
        user: contextText + '\n\nDetermine if this character needs power_slots. If yes, output slot definitions.'
    };

    try {
        var response = await callMemoryLLM([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], { operation: 'init_power_slots' });
        var text = String(response || '').trim();

        if (text.indexOf('NO_POWER_SLOTS') !== -1) return null;

        var jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            var slots = JSON.parse(jsonMatch[0]);
            if (Array.isArray(slots) && slots.length > 0) {
                var validSlots = [];
                var usedKeys = {};
                var keyOrder = ['vitality', 'energy', 'realm'];
                for (var k = 0; k < keyOrder.length; k++) {
                    for (var j = 0; j < slots.length; j++) {
                        var slot = slots[j];
                        if (slot.key === keyOrder[k] && !usedKeys[slot.key]) {
                            usedKeys[slot.key] = true;
                            validSlots.push({
                                key: slot.key,
                                label: String(slot.label || '').substring(0, 20),
                                description: String(slot.description || '').substring(0, 80)
                            });
                        }
                    }
                }
                for (var j2 = 0; j2 < slots.length; j2++) {
                    var slot2 = slots[j2];
                    if (!usedKeys[slot2.key] && validSlots.length < 3) {
                        usedKeys[slot2.key] = true;
                        validSlots.push({
                            key: String(slot2.key || '').substring(0, 20),
                            label: String(slot2.label || '').substring(0, 20),
                            description: String(slot2.description || '').substring(0, 80)
                        });
                    }
                }
                if (validSlots.length > 0) return validSlots;
            }
        }
    } catch (e) {
        console.warn('[NE] initPowerSlots LLM call failed:', e);
    }

    return null;
}
