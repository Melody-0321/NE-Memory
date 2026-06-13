// NE-Memory Test Harness — paste into browser console (F12)
// Requires: NE-Memory v3.0+ loaded, __ne_debug available
// Usage: await NEMTest.seed(5) → await NEMTest.run("query") → NEMTest.report()

window.NEMTest = {
    _debug: window.__ne_debug,
    _cancel: false,

    sleep: function (ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    },

    // ── Seed messages to build STM ──
    seed: async function (count) {
        count = count || 5;
        var seeds = [
            '你好，我叫阿明，是一名矿工。',
            '北山矿洞最近有些异常，频繁有小规模塌方。',
            '我的朋友老张是铁匠，他今天也来矿洞了。',
            '老张脸色很差，他说昨天在矿洞深处看到了奇怪的光。',
            '我觉得应该向工头报告这个情况。不过工头这几天不在。',
            '老张说他认识一个地质师，也许可以请她来看看。',
            '对了，那个地质师叫什么来着？许瑶，对，许瑶。',
            '许瑶以前在这片矿区工作过，后来调走了。不过她应该还住在本镇。',
            '老张说他会去找许瑶。希望她能帮忙。',
            '矿洞入口处的水位也在上升。这很不正常。'
        ];
        count = Math.min(count, seeds.length);
        console.log('[NEM-HARNESS] Seeding ' + count + ' messages...');
        NEMTest._cancel = false;
        for (var i = 0; i < count; i++) {
            if (NEMTest._cancel) { console.log('[NEM-HARNESS] Cancelled'); return; }
            console.log('[' + (i + 1) + '/' + count + '] ' + seeds[i]);
            try { SillyTavern.getContext().sendMessageAsUser(seeds[i]); } catch (e) { console.error(e); return; }
            await NEMTest.waitForGeneration(40000);
            await NEMTest.sleep(3000);
        }
        console.log('[NEM-HARNESS] Seed done. Check: await __ne_debug.getVaultSummary()');
    },

    waitForGeneration: function (timeoutMs) {
        return new Promise(function (resolve) {
            var done = false, timeout = setTimeout(function () {
                if (done) return; done = true; console.warn('[NEM-HARNESS] Generation timed out');
                resolve(false);
            }, timeoutMs || 40000);
            var handler = function () {
                if (done) return; done = true; clearTimeout(timeout);
                SillyTavern.getContext().eventSource.removeEventListener(
                    SillyTavern.getContext().event_types.GENERATION_ENDED, handler
                );
                resolve(true);
            };
            SillyTavern.getContext().eventSource.addEventListener(
                SillyTavern.getContext().event_types.GENERATION_ENDED, handler
            );
        });
    },

    // ── Run test query ──
    run: async function (query) {
        console.log('[NEM-HARNESS] === RUN: ' + query + ' ===');
        try { SillyTavern.getContext().sendMessageAsUser(query); } catch (e) {
            console.error('Send failed:', e); return null;
        }
        await NEMTest.waitForGeneration(40000);
        await NEMTest.sleep(4000); // wait for SmartPush

        var ne = window.__ne_debug;
        var data = {
            injection: ne.getLastInjection ? ne.getLastInjection() : null,
            merge: ne.getLastMerge ? ne.getLastMerge() : null,
            notebook: ne.getLastNotebook ? ne.getLastNotebook() : null,
            pipeline: ne.getLastPipelineOutput ? ne.getLastPipelineOutput() : null,
            target: query,
            time: new Date().toISOString()
        };
        try { data.vault = await ne.getVaultSummary(); } catch (e) { data.vault = null; }

        NEMTest._lastData = data;
        NEMTest._lastReport = NEMTest._formatReport(data);
        console.log(NEMTest._lastReport);
        return data;
    },

    _formatReport: function (data) {
        var L = [];
        L.push('========================================');
        L.push('NE-MEMORY TEST REPORT');
        L.push('Target: ' + data.target);
        L.push('Time:   ' + data.time);
        L.push('========================================');
        if (data.vault) L.push('VAULT: STM=' + data.vault.stmCount + ' LTM=' + data.vault.ltmCount + ' Unc=' + data.vault.unconsolidatedCount);
        if (data.merge) {
            L.push('MERGE: map=' + data.merge.mapSize + ' threads=' + data.merge.threadCount + ' [' + (data.merge.threadKeys || []).join(', ') + ']');
            if (data.merge.availableChains && data.merge.availableChains.length > 0)
                L.push('AVAIL_CHAINS: ' + JSON.stringify(data.merge.availableChains));
        }
        if (data.notebook) L.push('NOTEBOOK: v=' + data.notebook.version + ' map=' + data.notebook.mapSize + ' threads=' + data.notebook.threadCount);
        if (data.injection) {
            L.push('INJECTION (' + data.injection.length + ' chars):');
            L.push(data.injection.substring(0, 800));
            if (data.injection.length > 800) L.push('...');
        } else L.push('NO INJECTION (SmartPush may not have fired)');
        L.push('========================================');
        return L.join('\n');
    },

    // ── Quick pass/fail checks ──
    hasInjection: function () { return !!(NEMTest._lastData && NEMTest._lastData.injection); },
    injectionContains: function (text) {
        return NEMTest._lastData && NEMTest._lastData.injection && NEMTest._lastData.injection.indexOf(text) !== -1;
    },
    hasThreadAnnotation: function () {
        return NEMTest.injectionContains('{L:');
    },
    mergeHasThreads: function () {
        return NEMTest._lastData && NEMTest._lastData.merge && NEMTest._lastData.merge.threadCount > 0;
    },
    availableChainsCount: function () {
        return (NEMTest._lastData && NEMTest._lastData.merge && NEMTest._lastData.merge.availableChains) ?
            NEMTest._lastData.merge.availableChains.length : 0;
    }
};
console.log('[NEM-HARNESS] Loaded. Commands:');
console.log('  await NEMTest.seed(5)       — seed 5 messages to bulk up STM');
console.log('  await NEMTest.run("query")  — send query, collect debug, print report');
console.log('  NEMTest.hasThreadAnnotation() — quick check: injection has thread tags');
console.log('  NEMTest.mergeHasThreads()     — quick check: merge produced threads');
