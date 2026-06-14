/**
 * api/llm.js — LLM 调用封装
 *
 * 优先级：localStorage 中的副 API 配置 → TavernHelper.generateRaw() 回退
 * 副 API Key 永远不到云端，存在浏览器本地。
 */
import { POWER_SLOTS_TEMPLATES } from '../vault/schema.js';
import { addLLMLog } from '../engine/telemetry.js';
import { recordChatStat } from '../engine/chat-telemetry.js';

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
        secondaryConfig = loadSecondaryApiConfig();
    } else {
        secondaryConfig = loadRetrievalApiConfig();
    }
    const startTime = Date.now();
    let response = null;
    let apiSource = 'tavern';
    let usage = null;

    if (secondaryConfig && secondaryConfig.url && secondaryConfig.model) {
        try {
            console.log('[NE] LLM call via secondary API:', secondaryConfig.model);
            var customResult = await callCustomAPI(secondaryConfig, messages, options);
            response = customResult.content;
            usage = customResult.usage;
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

    var chatId = options.chatId || null;
    var promptStr = JSON.stringify(messages, null, 2);
    addLLMLog(options.operation || 'memory', promptStr.substring(0, 500), response || '', durationMs, apiSource, chatId);

    if (chatId) {
        recordChatStat(chatId, 'llm', 1);
        var totalTokens = usage ? (usage.total_tokens || 0) : (options.operation !== 'init_power_slots' ? 0 : 0);
        if (totalTokens > 0) recordChatStat(chatId, 'tok', totalTokens);
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
    return callMemoryLLM(messages, Object.assign({}, options, { _forcePipelineApi: true, temperature: mc.extraction_temperature || mc.temperature || 0.2, max_tokens: mc.stm_max_tokens, chatId: chatId }));
}

function robustParseJson(raw) {
    if (!raw) return {};
    var text = String(raw);
    // 1) 剥离 <thought>...</thought> 推理缓冲区（DeepSeek-R1 系列常见）
    text = text.replace(/<thought>[\s\S]*?<\/thought>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    // 2) 剥离 ```json / ``` 代码围栏
    text = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    // 3) 尝试直接解析
    try { return JSON.parse(text); } catch (_) {}
    // 4) 寻找第一对 {} 之间的内容
    var firstBrace = text.indexOf('{');
    if (firstBrace === -1) {
        // 没有 {} 就不可能是对象，尝试数组 [ ]
        var firstBracket = text.indexOf('[');
        if (firstBracket !== -1) {
            try {
                var lastBracket = text.lastIndexOf(']');
                if (lastBracket > firstBracket) return JSON.parse(text.substring(firstBracket, lastBracket + 1));
            } catch (_) {}
        }
        console.warn('[NE] robustParseJson gave up on input:', text.substring(0, 200));
        return {};
    }
    var lastBrace = text.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace > firstBrace) {
        try { return JSON.parse(text.substring(firstBrace, lastBrace + 1)); } catch (_) {}
    }
    // 5) JSON 前缀处理（字符串被截断或未闭合）：逐字符扫描，
    //    追踪引号/转义状态，找到最后一个完整的 JSON 前缀位置，
    //    然后补全括号。
    var sliceEnd = findValidJsonPrefixEnd(text, firstBrace);
    if (sliceEnd > firstBrace) {
        var prefix = text.substring(firstBrace, sliceEnd);
        // 去掉尾部可能残留的逗号或冒号
        prefix = prefix.replace(/[,:\s]+$/, '');
        // 补全未闭合的字符串引号和括号/数组
        var depth = 0;
        var stack = [];
        var inString = false;
        for (var ci = 0; ci < prefix.length; ci++) {
            var c = prefix[ci];
            if (inString) {
                if (c === '\\') { ci++; continue; }
                if (c === '"') inString = false;
                continue;
            }
            if (c === '"') { inString = true; continue; }
            if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); depth++; }
            else if (c === '}' || c === ']') { stack.pop(); depth--; }
        }
        // 如果还在字符串内，先补上闭合引号
        if (inString) prefix += '"';
        // 然后补全未闭合的括号
        while (stack.length > 0) prefix += stack.pop();
        try { return JSON.parse(prefix); } catch (_) {}
    }
    console.warn('[NE] robustParseJson gave up on input:', text.substring(0, 200));
    return {};
}

function skipString(s, startIdx) {
    for (var i = startIdx + 1; i < s.length; i++) {
        var c = s[i];
        if (c === '\\') { i++; continue; }
        if (c === '"') return i;
    }
    return s.length;
}

function findValidJsonPrefixEnd(text, startIdx) {
    var inString = false;
    var i = startIdx;
    while (i < text.length) {
        var c = text[i];
        if (inString) {
            if (c === '\\') { i += 2; continue; }
            if (c === '"') inString = false;
            i++;
        } else {
            if (c === '"') { inString = true; i++; continue; }
            // 允许在非字符串区域的字符（数字、字母、{ } [ ] : , 空白）
            // 遇到不在这些集合里的字符视为截断点
            if (c !== '{' && c !== '}' && c !== '[' && c !== ']' && c !== ':' && c !== ','
                && c !== '-' && c !== '.' && !(c >= '0' && c <= '9')
                && c !== 't' && c !== 'r' && c !== 'u' && c !== 'e' && c !== 'f' && c !== 'a' && c !== 'l' && c !== 's' && c !== 'n' && c !== 'u'
                && c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r'
                && c.charCodeAt(0) < 128) {
                return i;
            }
            i++;
        }
    }
    return i;
}

export async function callMemoryLLMWithTools(messages, tools, toolExecutors, options, chatId) {
    var callRoundTag = globalThis.__ne_tr_currentRound || null;
    var secondaryConfig = options._apiConfig || loadRetrievalApiConfig();
    if (!secondaryConfig || !secondaryConfig.url || !secondaryConfig.model) {
        throw new Error('Tool calling requires secondary API configured');
    }
    var mc = loadMemoryConfig();
    var opts = Object.assign({ temperature: mc.extraction_temperature || mc.temperature || 0.2, max_tokens: mc.stm_max_tokens || 2048, chatId: chatId }, options || {});
    var msgs = messages.slice();
    var finalContent = '';
    var startTime = Date.now();
    var totalUsage = null;

    for (var round = 0; round < 5; round++) {
        try {
            var result = await callCustomAPITools(secondaryConfig, msgs, opts, tools);
            var assistantMsg = result.msg;
            if (!assistantMsg) throw new Error('No message in response');

            msgs.push(assistantMsg);
            if (result.usage) totalUsage = result.usage;

            if (assistantMsg.content) finalContent = assistantMsg.content;

            var toolCalls = assistantMsg.tool_calls;
            if (!toolCalls || toolCalls.length === 0) break;

            var parallelJobs = toolCalls.map(function(tc) {
                var fn = tc.function;
                var executor = toolExecutors[fn.name];
                if (!executor) return Promise.resolve({ tc: tc, content: 'Error: unknown tool ' + fn.name });
                // 使用健壮的 JSON 解析，避免 DeepSeek v4/R1 的 reasoning 内容污染 arguments
                var parsedArgs = {};
                try {
                    parsedArgs = robustParseJson(fn.arguments);
                } catch (argErr) {
                    console.warn('[NE] tool ' + fn.name + ' arguments unparseable, falling back to {}:', (fn.arguments || '').substring(0, 200));
                }
                return Promise.resolve()
                    .then(function() { return executor(parsedArgs); })
                    .then(function(r) { return { tc: tc, content: r }; })
                    .catch(function(e) { return { tc: tc, content: 'Error: ' + e.message }; });
            });
            var results = await Promise.all(parallelJobs);
            results.forEach(function(r) {
                msgs.push({ role: 'tool', tool_call_id: r.tc.id, content: r.content });
            });
        } catch (e) {
            console.warn('[NE] Tool call round ' + (round + 1) + ' failed:', e.message);
            break;
        }
    }

    var rawFinalContent = finalContent;

    firePipelineCallbacks({
        operation: options.operation || 'retrieval_synthesis',
        messages: messages,
        fullConversation: msgs,
        rawResponse: rawFinalContent || (msgs.length > 0 && msgs[msgs.length - 1].content) || '',
        response: rawFinalContent || (msgs.length > 0 && msgs[msgs.length - 1].content) || '',
        usage: totalUsage,
        source: 'secondary',
        durationMs: Date.now() - startTime,
        ts: new Date().toISOString(),
        roundTag: callRoundTag
    });

    // 剥离最终文本中的推理标记，避免下游 parseResponse 失败
    if (finalContent) {
        finalContent = String(finalContent).replace(/<thought>[\s\S]*?<\/thought>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
    }

    console.log('[NE] LLM with tools done — dur=' + (Date.now() - startTime) + 'ms, rounds=' + (msgs.length > Math.min(2, messages.length) ? Math.ceil((msgs.length - messages.length) / 2) : 0) + ', len=' + (finalContent ? finalContent.length : 0));
    return finalContent || (msgs.length > 0 && msgs[msgs.length - 1].content) || '';
}

async function callCustomAPITools(config, messages, options, tools) {
    if (!config.url) throw new Error('No API URL configured');
    if (!config.model) throw new Error('No API model configured');
    var headers = { 'Content-Type': 'application/json' };
    if (config.key) headers['Authorization'] = 'Bearer ' + config.key;
    var body = JSON.stringify({
        model: config.model,
        messages: messages,
        tools: tools,
        tool_choice: 'auto',
        temperature: options.temperature || 0.3,
        max_tokens: options.max_tokens || 2048
    });
    var timeoutSec = options.timeout || 120;
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutSec * 1000);

    function attemptFetch(url) {
        return fetch(url, {
            method: 'POST',
            headers: headers,
            body: body,
            signal: controller.signal
        }).then(function(resp) {
            clearTimeout(timer);
            if (!resp.ok) throw new Error('API error: ' + resp.status);
            return resp.json();
        }).then(function(data) {
            var msg = data.choices?.[0]?.message;
            var usage = data.usage || null;
            return { msg: msg, usage: usage, _raw: data };
        }).catch(function(e) {
            clearTimeout(timer);
            throw e;
        });
    }

    try {
        return await attemptFetch(config.url);
    } catch (e) {
        if (!/Load[_ ]?[Ff]ailed|NetworkError|Failed to fetch|TypeError: Failed to fetch/i.test(e.message || '')) {
            if (e.name === 'AbortError') throw new Error('Request timed out after ' + timeoutSec + 's');
            throw e;
        }
        console.warn('[NE] Direct tools fetch failed (' + (e.message || '') + '), trying ST proxy...');
        var proxyUrl = 'http://127.0.0.1:8000/proxy/' + encodeURIComponent(config.url);
        return await attemptFetch(proxyUrl);
    }
}

export async function callMemoryRetrieval(messages, options = {}, chatId = null) {
    var mc = await loadMemoryConfig();
    return callMemoryLLM(messages, Object.assign({ temperature: mc.retrieval_temperature || mc.temperature || 0.3, max_tokens: mc.stm_max_tokens, chatId: chatId }, options));
}

export async function callMemoryRetrievalWithTools(messages, tools, toolExecutors, options = {}) {
    var secCfg = loadRetrievalApiConfig();
    if (secCfg && secCfg.url && secCfg.model) {
        return callMemoryLLMWithTools(messages, tools, toolExecutors, options, options.chatId);
    }
    return callMemoryRetrieval(messages, options, options.chatId);
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
}

// ── 检索专用 API（分离模式）──

export function loadRetrievalApiConfig() {
    try {
        var raw = localStorage.getItem('ne_retrieval_api');
        if (raw) {
            var cfg = JSON.parse(raw);
            if (cfg && cfg.url) return cfg;
        }
    } catch (e) {}
    // Fallback to unified API (backward compat / unified mode)
    return loadSecondaryApiConfig();
}

export function saveRetrievalApiConfig(config) {
    if (config && config.url) config.url = normalizeApiUrl(config.url);
    localStorage.setItem('ne_retrieval_api', JSON.stringify(config));
}

export function isApiSplitMode() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) return !!JSON.parse(raw).apiSplitMode;
    } catch (e) {}
    return false;
}

/**
 * Toggle API split mode. Handles data transition:
 *   0→1 (unified→split): copy unified → retrieval; pipeline cleared
 *   1→0 (split→unified): copy retrieval → unified; retrieval preserved in localStorage
 */
export function setApiSplitMode(enabled) {
    var settings = {};
    try { var raw = localStorage.getItem('ne_settings'); if (raw) settings = JSON.parse(raw); } catch (e) {}
    var wasSplit = settings.apiSplitMode;

    if (enabled && !wasSplit) {
        // 0→1: unified → split
        var unified = loadSecondaryApiConfig() || {};
        saveRetrievalApiConfig({ url: unified.url || '', key: unified.key || '', model: unified.model || '' });
        saveSecondaryApiConfig({ url: '', key: '', model: '' });
    } else if (!enabled && wasSplit) {
        // 1→0: split → unified
        var retrieval = loadRetrievalApiConfig() || {};
        saveSecondaryApiConfig({ url: retrieval.url || '', key: retrieval.key || '', model: retrieval.model || '' });
        // ne_retrieval_api 保留不删（用户可能在 1→0→1 后恢复）
    }

    settings.apiSplitMode = enabled;
    localStorage.setItem('ne_settings', JSON.stringify(settings));
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
        if (typeof toastr !== 'undefined' && toastr.warning) {
            toastr.warning('Falling back to main API. ' + (reason || 'Connection failed'), 'Secondary API unreachable', { timeOut: 6000 });
        }
    } catch (e) {}
}

export async function testSecondaryApiConnection(config) {
    if (!config || !config.url) return { success: false, error: 'No URL configured' };
    if (!config.model) return { success: false, error: 'No model configured' };
    try {
        var result = await callCustomAPI(config, [
            { role: 'system', content: 'Respond with OK only. No other text.' },
            { role: 'user', content: 'ping' }
        ], { timeout: 10, temperature: 0, max_tokens: 64 });
        if (!result.content || result.content.trim().length === 0) {
            console.warn('[NE] testSecondaryApiConnection — raw response:', JSON.stringify(result._raw).substring(0, 500));
            return { success: false, error: 'API returned empty response. Check browser console (F12) for raw response data.' };
        }
        return { success: true, model: config.model || 'connected' };
    } catch (e) {
        console.warn('[NE] testSecondaryApiConnection — error:', e.message);
        return { success: false, error: e.message || 'Connection failed' };
    }
}

export async function sendSecondaryTestMessage(config) {
    if (!config || !config.url) throw new Error('No URL configured');
    var result = await callCustomAPI(config, [{ role: 'user', content: 'Hi' }], { timeout: 15, temperature: 0.0, max_tokens: 128 });
    if (!result.content || result.content.trim().length === 0) {
        console.warn('[NE] sendSecondaryTestMessage — raw response:', JSON.stringify(result._raw).substring(0, 500));
        throw new Error('API returned empty response. Check browser console (F12) for raw response data.');
    }
    return result.content;
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
        max_tokens: options.max_tokens || 2048
    });
    const timeoutSec = options.timeout || 120;

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
                if (!content) {
                    console.warn('[NE] API returned empty content — status=' + response.status + ', keys=' + Object.keys(data).join(',') + ', hasChoices=' + !!data.choices + ', choiceCount=' + (data.choices ? data.choices.length : 0) + ', firstChoiceKeys=' + (data.choices?.[0] ? Object.keys(data.choices[0]).join(',') : 'none') + ', usage=' + JSON.stringify(usage || {}));
                }
                return { content: content, usage: usage, _raw: data };
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

    var proxyAttempted = false;

    // 1. Try direct
    try {
        return await attemptFetch(config.url);
    } catch (e) {
        if (!isNetworkError(e)) {
            if (e.name === 'AbortError') throw new Error('Request timed out after ' + timeoutSec + 's');
            throw e;
        }
        console.warn('[NE] Direct fetch failed (' + e.message + '), trying ST proxy...');
        proxyAttempted = true;
    }

    // 2. Retry through ST CORS proxy
    try {
        var proxyUrl = 'http://127.0.0.1:8000/proxy/' + encodeURIComponent(config.url);
        var result = await attemptFetch(proxyUrl);
        result._viaProxy = true;
        if (!_proxyNotified) {
            _proxyNotified = true;
            console.log('[NE] Connected via ST CORS proxy (' + proxyUrl + ')');
        }
        return result;
    } catch (e2) {
        if (isNetworkError(e2) || (e2.message && /^API error: 404/.test(e2.message))) {
            throw new Error(
                'Cannot reach ' + (config.url || 'API') + ' — direct fetch blocked (CORS/mixed-content). ' +
                'ST CORS proxy is disabled or unreachable. Enable it:\n' +
                '1. Open SillyTavern/config.yaml\n' +
                '2. Set enableCorsProxy: true\n' +
                '3. Restart SillyTavern'
            );
        }
        if (e2.name === 'AbortError') throw new Error('Request timed out after ' + timeoutSec + 's (via proxy)');
        throw e2;
    }
}

async function callTavernHelper(messages, options) {
    // Note: TH API does not support AbortController. Promise.race timeout
    // rejects the caller's promise but the underlying HTTP request continues.
    // callCustomAPI correctly uses AbortController for the secondary API path.
    var timeoutMs = (options.timeout || 120) * 1000;

    var raceWithTimeout = function(promise) {
        return Promise.race([
            promise,
            new Promise(function(_, reject) {
                setTimeout(function() { reject(new Error('Timeout after ' + (options.timeout || 120) + 's')); }, timeoutMs);
            })
        ]);
    };

    // 1. Primary: generateQuietPrompt — silent background processing, no chat output
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            if (ctx.generateQuietPrompt) {
                console.log('[NE] callTavernHelper via generateQuietPrompt, timeout=' + (options.timeout || 120) + 's');
                var quietResponse = await raceWithTimeout(ctx.generateQuietPrompt(
                    messages[messages.length - 1].content,
                    messages[0].content
                ));
                return quietResponse || '';
            }
        }
    } catch (e) {
        console.warn('[NE] Quiet prompt failed:', e);
    }

    // 2. Fallback: generateRaw — may produce visible chat output in some ST versions
    try {
        if (typeof TavernHelper !== 'undefined' && TavernHelper.generateRaw) {
            console.log('[NE] callTavernHelper via generateRaw (fallback), timeout=' + (options.timeout || 120) + 's');
            var rawResponse = await raceWithTimeout(TavernHelper.generateRaw({
                ordered_prompts: messages,
                should_stream: false
            }));
            return rawResponse || '';
        }
    } catch (e) {
        console.warn('[NE] TavernHelper.generateRaw failed:', e);
    }
    throw new Error('No LLM backend available. Configure secondary API in NE settings or ensure TavernHelper is loaded.');
}

var _powerSlotsInited = {};
var _lastSecondaryApiWarn = 0;

export async function initPowerSlots(characterName, existingSlotsForWorld) {
    // Dedup: skip if already attempted for this character (success or failure)
    if (_powerSlotsInited[characterName]) return null;
    _powerSlotsInited[characterName] = true;

    var contextText = '';
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            var ctx = SillyTavern.getContext();
            var chars = ctx.characters || [];
            var char = chars.find(function (c) { return c.name === characterName; });
            if (char) {
                contextText += '=== Character Card ===\n';
                contextText += 'Name: ' + (char.name || characterName) + '\n';
                if (char.description) contextText += 'Description: ' + char.description + '\n';
                if (char.personality) contextText += 'Personality: ' + char.personality + '\n';
                if (char.scenario) contextText += 'Scenario: ' + char.scenario + '\n';
            }
            var worldInfo = ctx.worldInfo;
            if (worldInfo && worldInfo.entries && Object.keys(worldInfo.entries).length > 0) {
                // 构建启用的世界书名集合（与 state-discovery.js 相同逻辑）
                var enabledBooks = {};
                try {
                    var globalSelect = null;
                    var extSettings2 = ctx.extensionSettings || null;
                    if (extSettings2 && extSettings2.world_info && Array.isArray(extSettings2.world_info.globalSelect)) {
                        globalSelect = extSettings2.world_info.globalSelect;
                    }
                    if (!globalSelect && ctx.powerUserSettings && ctx.powerUserSettings.world_info && Array.isArray(ctx.powerUserSettings.world_info.globalSelect)) {
                        globalSelect = ctx.powerUserSettings.world_info.globalSelect;
                    }
                    if (!globalSelect && typeof window !== 'undefined') {
                        try {
                            var wi2 = window.world_info || (window.__ST && window.__ST.world_info);
                            if (wi2 && wi2.globalSelect && Array.isArray(wi2.globalSelect)) {
                                globalSelect = wi2.globalSelect;
                            }
                        } catch (ww) {}
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
