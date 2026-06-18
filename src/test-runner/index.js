/**
 * test-runner/index.js — NE Memory LLM Test Runner 入口
 *
 * 入口函数：
 *   runTestByName(name, hostDoc) — 从 test-case.md 加载配置并运行
 *   listTests() — 返回已知测试用例列表
 *   runTest(config, hostDoc) — 直接传入 JS 对象运行（向下兼容）
 *   setReportsDir() — 设置报告输出目录
 *
 * 测试用例定义在 test-cases/<name>/test-case.md 中，
 * 包含 YAML frontmatter 结构化参数。脚本自动提取和编译。
 */
import { parseTestCase, loadTestCaseByName, listKnownTests } from './files.js';
import { runTestLoop, setReportsDir } from './driver.js';

export { setReportsDir };

/**
 * 运行测试用例：从 test-case.md 加载并执行
 */
export async function runTestByName(name, hostDoc, maxRoundsOverride) {
    var testCase = await loadTestCaseByName(name);
    if (!testCase) {
        console.error('[NE-TEST-RUNNER] Test case "' + name + '" not found.');
        return { error: 'Test case "' + name + '" not found. Ensure test-cases/' + name + '/test-case.md exists and is accessible.' };
    }

    // Group test: run each sub-test sequentially
    if (testCase.tests && testCase.tests.length > 0) {
        return await runTestGroup(testCase, hostDoc, maxRoundsOverride);
    }

    return await executeSingleTest(testCase, hostDoc, maxRoundsOverride);
}

async function runTestGroup(groupCase, hostDoc, maxRoundsOverride) {
    var groupResult = {
        name: groupCase.name,
        title: groupCase.title,
        subResults: [],
        roundCount: 0,
        totalDurationMs: 0,
        allPassed: true,
        endType: 'completed'
    };

    var groupStart = Date.now();
    console.log('[NE-TEST-RUNNER] === Group: ' + groupCase.title + ' ===');

    for (var gi = 0; gi < groupCase.tests.length; gi++) {
        var subName = groupCase.tests[gi];
        console.log('[NE-TEST-RUNNER] --- Sub-test ' + (gi + 1) + '/' + groupCase.tests.length + ': ' + subName + ' ---');

        var subResult = await runTestByName(subName, hostDoc, maxRoundsOverride);
        groupResult.subResults.push({
            name: subName,
            result: subResult
        });
        groupResult.roundCount += subResult.roundCount || 0;

        if (subResult.error || (subResult.structuralResults && !subResult.structuralResults.every(function(r) { return r.passed; }))) {
            groupResult.allPassed = false;
        }
        if (subResult.semanticResults) {
            var semFailed = subResult.semanticResults.some(function(r) { return r.passed === false; });
            if (semFailed) groupResult.allPassed = false;
        }
    }

    groupResult.totalDurationMs = Date.now() - groupStart;
    return groupResult;
}

async function executeSingleTest(testCase, hostDoc, maxRoundsOverride) {
    if (typeof maxRoundsOverride === 'number' && maxRoundsOverride > 0) {
        testCase = Object.assign({}, testCase, { maxRounds: maxRoundsOverride });
    }
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

/**
 * 列出所有已知的测试用例
 */
export function listTests() {
    return listKnownTests();
}

/**
 * 直接传入 JS 对象运行（向下兼容）
 */
export async function runTest(config, hostDoc) {
    var testCase = parseTestCase(config);
    return await executeSingleTest(testCase, hostDoc);
}
