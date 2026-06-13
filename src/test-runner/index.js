/**
 * test-runner/index.js — NE Memory LLM Test Runner 入口
 *
 * 注册到 __ne_debug.runTest(runConfig)：
 *   runConfig = {
 *     name: 'smartpush-01',
 *     title: 'SmartPush 注入非空',
 *     objective: '验证...',
 *     conversationGuide: '积累...',
 *     structural: [{ op, target, value }, ...],
 *     semantic: ['问题1', ...],
 *     maxRounds: 8,
 *     timeoutPerRound: 120000,
 *     seedMessages: ['消息1', '消息2', ...]  // 可选
 *   }
 */
import { parseTestCase } from './files.js';
import { runTestLoop } from './driver.js';

export async function runTest(config, hostDoc) {
    var testCase = parseTestCase(config);
    console.log('[NE-TEST-RUNNER] === Starting: ' + testCase.title + ' ===');
    console.log('[NE-TEST-RUNNER] Objective: ' + testCase.objective);
    console.log('[NE-TEST-RUNNER] Max rounds: ' + testCase.maxRounds);

    try {
        var result = await runTestLoop(testCase, hostDoc);

        console.log('[NE-TEST-RUNNER] === Results ===');
        console.log('[NE-TEST-RUNNER] Rounds: ' + result.roundCount + ', Duration: ' + (result.totalDurationMs / 1000).toFixed(1) + 's');
        console.log('[NE-TEST-RUNNER] Structural:');
        result.structuralResults.forEach(function(r) {
            console.log('  [' + (r.passed ? 'PASS' : 'FAIL') + '] ' + r.label + ' — ' + (r.detail || ''));
        });
        if (result.semanticResults.length > 0) {
            console.log('[NE-TEST-RUNNER] Semantic:');
            result.semanticResults.forEach(function(r) {
                console.log('  [' + (r.passed ? 'PASS' : 'FAIL') + '] ' + r.question);
                if (r.evaluation) console.log('    ' + r.evaluation);
            });
        }
        console.log('[NE-TEST-RUNNER] === Trace (first 500 chars) ===');
        console.log(result.trace.substring(0, 500) + (result.trace.length > 500 ? '\n...' : ''));
        console.log('[NE-TEST-RUNNER] === Report ===');
        console.log(result.report);

        return result;
    } catch (e) {
        console.error('[NE-TEST-RUNNER] Test failed with error:', e);
        return { error: e.message, trace: e.stack, report: '## 执行异常\n' + e.message + '\n\n```\n' + e.stack + '\n```' };
    }
}
