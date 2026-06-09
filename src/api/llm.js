/**
 * api/llm.js — LLM 调用封装
 *
 * 优先级：localStorage 中的副 API 配置 → TavernHelper.generateRaw() 回退
 * 副 API Key 永远不到云端，存在浏览器本地。
 */
import { POWER_SLOTS_TEMPLATES } from '../vault/schema.js';
import { addLLMLog } from '../engine/telemetry.js';

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
    const secondaryConfig = loadSecondaryApiConfig();
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
            apiSource = 'secondary';
        } catch (e) {
            console.warn('[NE] Secondary API failed, falling back to TH:', e.message);
            response = await callTavernHelper(messages, options);
            apiSource = 'tavern';
        }
    } else {
        console.log('[NE] LLM call via TavernHelper (no secondary API configured)');
        response = await callTavernHelper(messages, options);
        apiSource = 'tavern';
    }

    console.log('[NE] LLM call done — source=' + apiSource + ', dur=' + (Date.now() - startTime) + 'ms, len=' + (response ? response.length : 0));

    var promptStr = JSON.stringify(messages, null, 2);
    addLLMLog(options.operation || 'memory', promptStr.substring(0, 500), (response || '').substring(0, 4000), Date.now() - startTime, apiSource);

    const durationMs = Date.now() - startTime;
    if (isTelemetryEnabled()) {
        recordTelemetry({
            operation: options.operation || 'memory',
            api_source: apiSource,
            duration_ms: durationMs,
            response_length: response ? response.length : 0,
            prompt_tokens: usage ? usage.prompt_tokens : undefined,
            completion_tokens: usage ? usage.completion_tokens : undefined,
            total_tokens: usage ? usage.total_tokens : undefined
        });
    }
    return response;
}

export async function callMemoryPipeline(messages, options = {}) {
    var mc = loadMemoryConfig();
    return callMemoryLLM(messages, Object.assign({}, options, { temperature: mc.temperature || 0.1, max_tokens: mc.stm_max_tokens }));
}

export async function callMemoryRetrieval(messages, options = {}) {
    var mc = loadMemoryConfig();
    return callMemoryLLM(messages, Object.assign({ temperature: mc.temperature || 0.3, max_tokens: mc.stm_max_tokens }, options));
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
        var content = data.choices?.[0]?.message?.content || data.content || '';
        var usage = data.choices?.[0]?.usage || data.usage || null;
        // Diagnostic: log response structure when content is unexpectedly empty
        if (!content) {
            console.warn('[NE] API returned empty content — status=' + response.status + ', keys=' + Object.keys(data).join(',') + ', hasChoices=' + !!data.choices + ', choiceCount=' + (data.choices ? data.choices.length : 0) + ', finishReason=' + (data.choices?.[0]?.finish_reason || 'none') + ', usage=' + JSON.stringify(usage || {}));
        }
        return { content: content, usage: usage };
    } finally {
        clearTimeout(timeout);
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

    try {
        if (typeof TavernHelper !== 'undefined' && TavernHelper.generateRaw) {
            console.log('[NE] callTavernHelper via generateRaw, timeout=' + (options.timeout || 120) + 's');
            const response = await raceWithTimeout(TavernHelper.generateRaw({
                ordered_prompts: messages,
                should_stream: false
            }));
            return response || '';
        }
    } catch (e) {
        console.warn('[NE] TavernHelper.generateRaw failed:', e);
    }
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const ctx = SillyTavern.getContext();
            if (ctx.generateQuietPrompt) {
                console.log('[NE] callTavernHelper via generateQuietPrompt, timeout=' + (options.timeout || 120) + 's');
                const response = await raceWithTimeout(ctx.generateQuietPrompt(
                    messages[messages.length - 1].content,
                    messages[0].content
                ));
                return response || '';
            }
        }
    } catch (e) {
        console.warn('[NE] Quiet prompt failed:', e);
    }
    throw new Error('No LLM backend available. Configure secondary API in NE settings or ensure TavernHelper is loaded.');
}

var _powerSlotsInited = {};

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
