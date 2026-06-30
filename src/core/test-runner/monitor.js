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

function _computeTokenSummary(calls) {
    var summary = {};
    var totalPrompt = 0;
    var totalCompletion = 0;
    var totalTokens = 0;
    for (var i = 0; i < calls.length; i++) {
        var c = calls[i];
        var op = c.operation || 'unknown';
        if (!summary[op]) summary[op] = { calls: 0, prompt: 0, completion: 0, total: 0 };
        summary[op].calls++;
        if (c.usage) {
            var p = c.usage.prompt_tokens || 0;
            var comp = c.usage.completion_tokens || 0;
            var tot = c.usage.total_tokens || (p + comp);
            summary[op].prompt += p;
            summary[op].completion += comp;
            summary[op].total += tot;
            totalPrompt += p;
            totalCompletion += comp;
            totalTokens += tot;
        }
    }
    return { byOperation: summary, totalPrompt: totalPrompt, totalCompletion: totalCompletion, totalTokens: totalTokens };
}

export function collectRoundData(roundTag) {
    var injection = globalThis.__ne_debug_last_injection || null;
    var pipelineCalls = roundTag != null ? _filterByRoundTag(roundTag) : _filterByRoundTag(null);

    var truncationCount = 0;
    var fallbackCount = 0;
    for (var i = 0; i < pipelineCalls.length; i++) {
        var c = pipelineCalls[i];
        if (c.usage && c.usage.completion_tokens >= 2048) truncationCount++;
        if (c.source === 'tavern') fallbackCount++;
    }

    return {
        injection: injection,
        injectionLength: injection ? injection.length : 0,
        injectionPreview: injection || null,
        pipeline: globalThis.__ne_debug_last_pipeline || null,
        pipelineCalls: pipelineCalls,
        tokenSummary: _computeTokenSummary(pipelineCalls),
        merge: globalThis.__ne_debug_last_merge || null,
        notebook: globalThis.__ne_debug_last_notebook || null,
        stmEvents: globalThis.__ne_debug_last_stm_events || null,
        consolidation: globalThis.__ne_debug_last_consolidation || null,
        ltmDecision: globalThis.__ne_debug_last_ltm_decision || null,
        ltmState: globalThis.__ne_debug_last_ltm_state || null,
        cursor: globalThis.__ne_debug_last_cursor || null,
        smartpushPrompt: globalThis.__ne_debug_last_smartpush_prompt || null,
        stateBlockInstruction: globalThis.__ne_debug_last_state_block_instruction || null,
        factionState: globalThis.__ne_debug_last_faction_state || null,
        pipelineResponses: globalThis.__ne_debug_all_pipeline_responses || null,
        truncationCount: truncationCount,
        fallbackCount: fallbackCount,
        vectorUsed: globalThis.__ne_debug_vector_used || false,
        vectorCandidateCount: globalThis.__ne_debug_vector_candidate_count || 0,
        bm25CandidateCount: globalThis.__ne_debug_bm25_candidate_count || 0,
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
