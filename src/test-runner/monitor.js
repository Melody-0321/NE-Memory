/**
 * test-runner/monitor.js — Hook Monitor: 采集 NE Memory 管线数据
 */

var _pipelineCallsPerRound = [];

export function startCollectingPipelineCalls() {
    _pipelineCallsPerRound = [];
    try {
        var llmApi = globalThis.__ne_llm_hook;
        if (llmApi && llmApi.onPipelineLLMCall) {
            llmApi.onPipelineLLMCall(_onPipelineCall);
        }
    } catch (e) {}
}

export function stopCollectingPipelineCalls() {
    try {
        var llmApi = globalThis.__ne_llm_hook;
        if (llmApi && llmApi.offPipelineLLMCall) {
            llmApi.offPipelineLLMCall(_onPipelineCall);
        }
    } catch (e) {}
}

function _onPipelineCall(data) {
    _pipelineCallsPerRound.push(data);
}

function _filterByRoundTag(roundTag) {
    var matching = [];
    var remaining = [];
    for (var i = 0; i < _pipelineCallsPerRound.length; i++) {
        var c = _pipelineCallsPerRound[i];
        if (c.roundTag === roundTag) {
            matching.push(c);
        } else {
            remaining.push(c);
        }
    }
    _pipelineCallsPerRound = remaining;
    return matching;
}

export function collectRoundData(roundTag) {
    var injection = globalThis.__ne_debug_last_injection || null;
    var pipelineCalls = roundTag != null ? _filterByRoundTag(roundTag) : _filterByRoundTag(null);

    return {
        injection: injection,
        injectionLength: injection ? injection.length : 0,
        injectionPreview: injection || null,
        pipeline: globalThis.__ne_debug_last_pipeline || null,
        pipelineCalls: pipelineCalls,
        merge: globalThis.__ne_debug_last_merge || null,
        notebook: globalThis.__ne_debug_last_notebook || null,
        stmEvents: globalThis.__ne_debug_last_stm_events || null,
        consolidation: globalThis.__ne_debug_last_consolidation || null,
        cursor: globalThis.__ne_debug_last_cursor || null,
        vault: null,
        timestamp: new Date().toISOString()
    };
}

export function drainOrphanPipelineCalls() {
    var calls = _pipelineCallsPerRound.slice();
    _pipelineCallsPerRound.length = 0;
    return calls;
}

export async function collectVaultSummary() {
    try {
        if (typeof globalThis.__ne_debug !== 'undefined' && globalThis.__ne_debug.getVaultSummary) {
            return await globalThis.__ne_debug.getVaultSummary();
        }
    } catch (e) {}
    return null;
}
