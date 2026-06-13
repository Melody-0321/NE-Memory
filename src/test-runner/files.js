/**
 * test-runner/files.js — 测试用例 & 报告文件处理
 */

export function parseTestCase(raw) {
    var tc = {};
    tc.name = raw.name || 'unnamed';
    tc.title = raw.title || raw.name || '';
    tc.objective = raw.objective || '';
    tc.preconditions = raw.preconditions || [];
    tc.conversationGuide = raw.conversationGuide || '';
    tc.structural = raw.structural || [];
    tc.semantic = raw.semantic || [];
    tc.maxRounds = raw.maxRounds || 8;
    tc.timeoutPerRound = raw.timeoutPerRound || 120000;
    tc.seedMessages = raw.seedMessages || null;
    return tc;
}

export function createTrace(testCase) {
    var lines = [];
    lines.push('# ' + testCase.title + ' — 操作日志');
    lines.push('运行时间: ' + new Date().toISOString());
    lines.push('');
    lines.push('## 测试目标');
    lines.push(testCase.objective);
    lines.push('');
    lines.push('## 前置条件');
    testCase.preconditions.forEach(function(c) { lines.push('- ' + c); });
    lines.push('');
    lines.push('## 对话设计指导');
    lines.push(testCase.conversationGuide);
    lines.push('');
    return lines.join('\n');
}

export function appendTraceRound(trace, roundData) {
    var lines = trace.split('\n');
    lines.push('## Round ' + roundData.round);
    lines.push('');
    lines.push('### 上下文');
    lines.push('- STM: ' + (roundData.vault ? roundData.vault.stmCount : '?') + ', LTM: ' + (roundData.vault ? roundData.vault.ltmCount : '?'));
    lines.push('');
    lines.push('### Driver 思维链');
    lines.push('```');
    lines.push('System: ' + (roundData.driverSystem || '').substring(0, 500));
    lines.push('---');
    lines.push('Response: ' + (roundData.driverResponse || '').substring(0, 1000));
    lines.push('```');
    lines.push('');
    lines.push('### 发送消息');
    lines.push('> ' + (roundData.message || ''));
    lines.push('');
    lines.push('### AI 回复');
    lines.push('> ' + (roundData.aiReply || '').substring(0, 300));
    lines.push('');
    lines.push('### 管线数据');
    if (roundData.pipeline) {
        lines.push('- SmartPush injection: ' + (roundData.pipeline.injectionLength || 0) + ' chars');
        if (roundData.pipeline.injectionPreview) {
            lines.push('  ```');
            lines.push('  ' + roundData.pipeline.injectionPreview.substring(0, 200));
            lines.push('  ```');
        }
    }
    if (roundData.stmEvents) {
        lines.push('- STM events added: ' + roundData.stmEvents.count);
    }
    if (roundData.vault) {
        lines.push('- Vault: STM=' + roundData.vault.stmCount + ' LTM=' + roundData.vault.ltmCount + ' Unc=' + roundData.vault.unconsolidatedCount);
    }
    lines.push('');
    lines.push('### 进度评估');
    lines.push(roundData.progressNote || '');
    lines.push('');
    return lines.join('\n');
}

export function createReport(testCase, roundCount, totalDurationMs, structuralResults, semanticResults) {
    var lines = [];
    lines.push('# ' + testCase.title + ' — 测试报告');
    lines.push('运行时间: ' + new Date().toISOString());
    lines.push('实际轮次: ' + roundCount);
    lines.push('总耗时: ' + formatDuration(totalDurationMs));
    lines.push('');
    lines.push('## 断言结果');
    lines.push('');
    lines.push('### 结构性断言');
    structuralResults.forEach(function(r, i) {
        var icon = r.passed ? '[x]' : '[ ]';
        lines.push('- ' + icon + ' `' + r.op + '`: ' + r.label + ' → **' + (r.passed ? 'PASS' : 'FAIL') + '**');
        if (!r.passed && r.detail) lines.push('  - 详情: ' + r.detail);
    });
    lines.push('');
    lines.push('### 语义性断言');
    semanticResults.forEach(function(r, i) {
        var icon = r.passed ? '[x]' : '[ ]';
        lines.push('- ' + icon + ' ' + r.question + ' → **' + (r.passed ? 'PASS' : 'FAIL') + '**');
        if (r.evaluation) lines.push('  - 评估: ' + r.evaluation);
    });
    lines.push('');
    var allPassed = structuralResults.every(function(r) { return r.passed; }) && semanticResults.every(function(r) { return r.passed; });
    lines.push('## 总结');
    lines.push(allPassed ? '**通过。** 所有断言通过。' : '**未通过。** 存在失败的断言，详见上方。');
    return lines.join('\n');
}

export function formatDuration(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    if (m > 0) return m + ' 分 ' + s + ' 秒';
    return s + ' 秒';
}
