/**
 * test-runner/monitor.js — Hook Monitor: 采集 NE Memory 管线数据
 */

export function collectRoundData() {
    var injection = globalThis.__ne_debug_last_injection || null;
    var vaultSummary = null;
    try {
        vaultSummary = {
            stmCount: typeof globalThis.__ne_debug_last_stm_events !== 'undefined' && globalThis.__ne_debug_last_stm_events ? globalThis.__ne_debug_last_stm_events.count : -1,
            ltmCount: -1,
            unconsolidatedCount: -1
        };
    } catch (e) {}

    return {
        injection: injection,
        injectionLength: injection ? injection.length : 0,
        injectionPreview: injection ? injection.substring(0, 300) : null,
        pipeline: globalThis.__ne_debug_last_pipeline || null,
        merge: globalThis.__ne_debug_last_merge || null,
        notebook: globalThis.__ne_debug_last_notebook || null,
        stmEvents: globalThis.__ne_debug_last_stm_events || null,
        consolidation: globalThis.__ne_debug_last_consolidation || null,
        cursor: globalThis.__ne_debug_last_cursor || null,
        vault: vaultSummary,
        timestamp: new Date().toISOString()
    };
}

export async function collectVaultSummary() {
    try {
        if (typeof globalThis.__ne_debug !== 'undefined' && globalThis.__ne_debug.getVaultSummary) {
            return await globalThis.__ne_debug.getVaultSummary();
        }
    } catch (e) {}
    return null;
}
