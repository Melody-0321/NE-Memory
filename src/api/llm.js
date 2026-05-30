/**
 * api/llm.js — LLM 调用封装
 *
 * 优先级：localStorage 中的副 API 配置 → TavernHelper.generateRaw() 回退
 * 副 API Key 永远不到云端，存在浏览器本地。
 */
export let telemetryBuffer = [];

export function recordTelemetry(entry) {
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

export async function callMemoryLLM(messages, options = {}) {
    const secondaryConfig = loadSecondaryApiConfig();
    const startTime = Date.now();
    let response = null;
    let apiSource = 'tavern';
    let usage = null;

    if (secondaryConfig && secondaryConfig.url && secondaryConfig.model) {
        try {
            response = await callCustomAPI(secondaryConfig, messages, options);
            apiSource = 'secondary';
        } catch (e) {
            response = await callTavernHelper(messages, options);
            apiSource = 'tavern';
        }
    } else {
        response = await callTavernHelper(messages, options);
        apiSource = 'tavern';
    }

    const durationMs = Date.now() - startTime;
    if (isTelemetryEnabled()) {
        recordTelemetry({
            operation: options.operation || 'memory',
            api_source: apiSource,
            duration_ms: durationMs,
            response_length: response ? response.length : 0,
            tokens: usage ? usage.total_tokens : undefined
        });
    }
    return response;
}

function loadSecondaryApiConfig() {
    try {
        const raw = localStorage.getItem('ne_secondary_api');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

export function saveSecondaryApiConfig(config) {
    localStorage.setItem('ne_secondary_api', JSON.stringify(config));
}

async function callCustomAPI(config, messages, options) {
    const headers = { 'Content-Type': 'application/json' };
    if (config.key) headers['Authorization'] = 'Bearer ' + config.key;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (options.timeout || 120) * 1000);

    try {
        const response = await fetch(config.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: config.model,
                messages: messages,
                temperature: options.temperature || 0.3,
                max_tokens: options.max_tokens || 2048
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error('API error: ' + response.status);
        }

        const data = await response.json();
        usage = data.usage || null;
        return data.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timeout);
    }
}

async function callTavernHelper(messages, options) {
    try {
        if (typeof TavernHelper !== 'undefined' && TavernHelper.generateRaw) {
            const response = await TavernHelper.generateRaw({
                ordered_prompts: messages,
                should_stream: false
            });
            return response || '';
        }
    } catch (e) {
        console.warn('[NE] TavernHelper.generateRaw failed:', e);
    }
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            if (ctx.generateQuietPrompt) {
                const response = await ctx.generateQuietPrompt(
                    messages[messages.length - 1].content,
                    messages[0].content
                );
                return response || '';
            }
        }
    } catch (e) {
        console.warn('[NE] Quiet prompt failed:', e);
    }
    throw new Error('No LLM backend available. Configure secondary API in NE settings or ensure TavernHelper is loaded.');
}
