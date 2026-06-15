/**
 * test-runner/files.js — 测试用例 & 报告文件处理
 */

export function parseTestCase(raw) {
    var tc = {};
    tc.name = raw.name || 'unnamed';
    tc.folder = raw.folder || tc.name;
    tc.title = raw.title || raw.name || '';
    tc.objective = raw.objective || '';
    tc.preconditions = raw.preconditions || [];
    tc.conversationGuide = raw.conversationGuide || '';
    tc.structural = raw.structural || [];
    tc.semantic = raw.semantic || [];
    tc.maxRounds = raw.maxRounds || 10;
    tc.minRounds = raw.minRounds || 0;
    tc.expectedRounds = raw.expectedRounds || '5-8';
    tc.timeoutPerRound = raw.timeoutPerRound || 120000;
    tc.seedMessages = raw.seedMessages || null;
    tc.tests = raw.tests || null;
    return tc;
}

export function parseTestCaseFile(markdownContent) {
    var raw = parseYamlFrontmatter(markdownContent);
    return parseTestCase(raw);
}

function parseYamlFrontmatter(text) {
    if (typeof text !== 'string') return {};
    var trimmed = text.trim();
    if (trimmed.indexOf('---') !== 0) return {};

    var endIdx = trimmed.indexOf('---', 3);
    if (endIdx === -1) return {};

    var yamlText = trimmed.substring(3, endIdx).trim();
    var body = trimmed.substring(endIdx + 3).trim();

    var result = parseYaml(yamlText);
    result._body = body;
    return result;
}

function parseYaml(yamlText) {
    var result = {};
    var lines = yamlText.split('\n');
    var currentKey = null;
    var currentList = null;
    var listIndent = 0;
    var inBlock = 'none'; // 'none', 'list', 'sub'

    for (var li = 0; li < lines.length; li++) {
        var rawLine = lines[li];
        var line = rawLine.replace(/^\s*/, function(m) { return m; }); // Just read, don't strip
        var indent = rawLine.length - rawLine.replace(/^[ \t]+/, '').length;
        var content = rawLine.trim();
        if (!content || content.charAt(0) === '#') continue;

        if (inBlock === 'list') {
            if (indent > listIndent && content.charAt(0) === '-') {
                var item = content.substring(1).trim();
                if (item.charAt(0) === '{' && item.charAt(item.length - 1) === '}') {
                    currentList.push(parseInlineObject(item));
                } else {
                    item = unquoteString(item);
                    currentList.push(item);
                }
                continue;
            } else if (indent > listIndent && currentKey) {
                var subMatch = content.match(/^(\w+):\s*(.*)/);
                if (subMatch && currentList.length > 0 && typeof currentList[currentList.length - 1] === 'object') {
                    var obj = currentList[currentList.length - 1];
                    obj[subMatch[1]] = parseScalar(subMatch[2]);
                    continue;
                }
            }
        }

        if (inBlock === 'sub' && currentKey) {
            if (indent > listIndent || listIndent === 0) {
                var subMatch = content.match(/^(\w+):\s*(.*)/);
                if (subMatch) {
                    var val = parseScalar(subMatch[2]);
                    if (typeof result[currentKey] !== 'object' || Array.isArray(result[currentKey])) {
                        result[currentKey] = {};
                    }
                    result[currentKey][subMatch[1]] = val;
                    continue;
                }
            }
        }

        // Top-level key
        var match = content.match(/^(\w+):\s*(.*)/);
        if (!match) {
            inBlock = 'none';
            currentKey = null;
            currentList = null;
            continue;
        }

        currentKey = match[1];
        var rest = match[2].trim();

        if (rest === '') {
            // Check next line for list or sub-object
            currentList = null;
            currentKey = currentKey;
            listIndent = indent;
            inBlock = 'pending';
            continue;
        }

        if (rest.charAt(0) === '-') {
            // Inline list start
            var item = rest.substring(1).trim();
            if (item.charAt(0) === '{' && item.charAt(item.length - 1) === '}') {
                result[currentKey] = [parseInlineObject(item)];
            } else {
                result[currentKey] = [unquoteString(item)];
            }
            currentList = result[currentKey];
            listIndent = indent;
            inBlock = 'list';
            continue;
        }

        result[currentKey] = parseScalar(rest);
        inBlock = 'none';
        currentList = null;
    }

    // Second pass: handle pending (multi-line list/sub)
    if (inBlock === 'pending' && currentKey) {
        // Re-scan for indented content
        var pendingKey = currentKey;
        var pendingIndent = listIndent;
        var pendingList = [];
        var pendingIsList = false;
        var pendingIsSub = false;

        for (var li2 = 0; li2 < lines.length; li2++) {
            var rawLine2 = lines[li2];
            var indent2 = rawLine2.length - rawLine2.replace(/^[ \t]+/, '').length;
            var content2 = rawLine2.trim();

            if (!content2 || content2.charAt(0) === '#') continue;

            var match2 = content2.match(/^(\w+):\s*(.*)/);
            if (match2) {
                if (match2[1] === pendingKey && match2[2].trim() === '') {
                    continue; // The header line itself
                }
                if (indent2 > pendingIndent) {
                    // This is a sub-key of pending
                    pendingIsSub = true;
                    break;
                }
                if (indent2 <= pendingIndent && pendingKey) {
                    break;
                }
            } else if (content2.charAt(0) === '-' && indent2 > pendingIndent) {
                pendingIsList = true;
                pendingList.push(content2.substring(1).trim());
            } else if (indent2 > pendingIndent && !pendingIsList) {
                pendingIsSub = true;
                break;
            }
        }

        if (pendingIsList) {
            result[pendingKey] = pendingList.map(function(item) {
                item = item.trim();
                if (item.charAt(0) === '{' && item.charAt(item.length - 1) === '}') {
                    return parseInlineObject(item);
                }
                return unquoteString(item);
            });
        }
    }

    return result;
}

function parseScalar(val) {
    val = val.trim();
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null' || val === '~') return null;
    if (val.length >= 2 && val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
        return val.substring(1, val.length - 1);
    }
    if (val.length >= 2 && val.charAt(0) === "'" && val.charAt(val.length - 1) === "'") {
        return val.substring(1, val.length - 1);
    }
    var num = Number(val);
    if (!isNaN(num) && val.indexOf(' ') === -1) return num;
    return val;
}

function unquoteString(s) {
    s = s.trim();
    if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
        return s.substring(1, s.length - 1);
    }
    if (s.length >= 2 && s.charAt(0) === "'" && s.charAt(s.length - 1) === "'") {
        return s.substring(1, s.length - 1);
    }
    return s;
}

function parseInlineObject(str) {
    var inner = str.substring(1, str.length - 1).trim();
    var obj = {};
    var parts = splitInline(inner);
    for (var pi = 0; pi < parts.length; pi++) {
        var kv = parts[pi].split(/:\s*/);
        if (kv.length >= 2) {
            obj[kv[0].trim()] = parseScalar(kv.slice(1).join(':').trim());
        }
    }
    return obj;
}

function splitInline(str) {
    var result = [];
    var depth = 0;
    var inStr = false;
    var strChar = '';
    var current = '';
    for (var i = 0; i < str.length; i++) {
        var ch = str.charAt(i);
        if (inStr) {
            current += ch;
            if (ch === strChar) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inStr = true;
            strChar = ch;
            current += ch;
            continue;
        }
        if (ch === '{' || ch === '[') { depth++; current += ch; continue; }
        if (ch === '}' || ch === ']') { depth--; current += ch; continue; }
        if (ch === ',' && depth === 0) {
            result.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) result.push(current);
    return result;
}

export function getTestBaseUrl() {
    try {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src || '';
            if (src.indexOf('ne-memory') !== -1 || src.indexOf('ne_memory') !== -1 || src.indexOf('NE-Memory') !== -1) {
                var scriptDir = src.substring(0, src.lastIndexOf('/'));
                return scriptDir + '/../test-cases/';
            }
        }
    } catch (e) {}
    return 'test-cases/';
}

var KNOWN_TESTS = [
    { name: 'smartpush-01', title: 'SmartPush 注入非空' },
    { name: 'smartpush-02', title: 'SmartPush 注入无来源标记' },
    { name: 'smartpush-03', title: '大轮次注入稳定性' },
    { name: 'smartpush-04', title: 'STM=0 注入降级' },
    { name: 'smartpush-05', title: '注入内容去重' },
    { name: 'smartpush-06', title: '跨场景注入切换' },
    { name: 'smartpush-08', title: '可见窗口跳过预取' },
    { name: 'smartpush-09', title: '可见窗口计算精度' },
    { name: 'smartpush-10', title: '预取原文完整度' },
    { name: 'smartpush-11', title: 'query 含 AI reply' },
    { name: 'retrieval-55', title: '检索 System Prompt 结构' },
    { name: 'retrieval-58', title: '短链自动 inline' },
    { name: 'smartpush-group-b', title: '[组合] SmartPush 检索优化（05+08+10+11+55+58）' }
];

export function listKnownTests() {
    return KNOWN_TESTS;
}

export async function loadTestCaseByName(name) {
    var baseUrl = getTestBaseUrl();
    var url = baseUrl + name + '/test-case.md';

    try {
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var markdown = await resp.text();
        return parseTestCaseFile(markdown);
    } catch (e) {
        console.error('[NE-TEST] Failed to load test case "' + name + '" from ' + url, e);
        return null;
    }
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
    lines.push('### Driver System Prompt');
    lines.push('```');
    lines.push(roundData.driverSystem || '');
    lines.push('```');
    lines.push('');
    lines.push('### Driver Response (完整)');
    lines.push('```');
    lines.push(roundData.driverResponse || '');
    lines.push('```');
    lines.push('');
    lines.push('### 发送消息');
    lines.push('> ' + (roundData.message || ''));
    lines.push('');
    lines.push('### AI 回复 (完整)');
    lines.push('> ' + (roundData.aiReply || ''));
    lines.push('');
    lines.push('### NE 管线 LLM 调用');
    if (roundData.pipelineCalls && roundData.pipelineCalls.length > 0) {
        for (var pci = 0; pci < roundData.pipelineCalls.length; pci++) {
            var pc = roundData.pipelineCalls[pci];
            lines.push('');
            lines.push('#### 管线调用 #' + (pci + 1) + ' — ' + pc.operation + ' (' + pc.source + ', ' + pc.durationMs + 'ms)');
            lines.push('');
            lines.push('**System Prompt:**');
            var sysMsg = pc.messages ? pc.messages.find(function(m) { return m.role === 'system'; }) : null;
            lines.push('```');
            lines.push(sysMsg ? sysMsg.content : '(none)');
            lines.push('```');
            lines.push('');
            lines.push('**User Prompt:**');
            var userMsg = pc.messages ? pc.messages.find(function(m) { return m.role === 'user'; }) : null;
            lines.push('```');
            lines.push(userMsg ? userMsg.content : '(none)');
            lines.push('```');
            lines.push('');
            lines.push('**LLM Response (完整):**');
            lines.push('```');
            lines.push(pc.response || '');
            lines.push('```');
            if (pc.fullConversation && pc.fullConversation.length > 0) {
                lines.push('');
                lines.push('**完整对话 (含工具调用轮次):**');
                for (var mi = 0; mi < pc.fullConversation.length; mi++) {
                    var m = pc.fullConversation[mi];
                    lines.push('- [' + m.role + ']');
                    if (m.content) lines.push('  content: ' + m.content);
                    if (m.tool_calls) {
                        m.tool_calls.forEach(function(tc) {
                            lines.push('  tool_call: ' + (tc.function ? tc.function.name : '?') + '(' + (tc.function ? (tc.function.arguments || '') : '') + ')');
                        });
                    }
                    if (m.tool_call_id) lines.push('  tool_result (id=' + m.tool_call_id + '): ' + (m.content || ''));
                }
            }
        }
    } else {
        lines.push('(本轮无 NE 管线 LLM 调用)');
    }
    lines.push('');
    lines.push('### 管线数据');
    lines.push('- SmartPush injection: ' + (roundData.injectionLength || 0) + ' chars');
    if (roundData.injectionPreview) {
        lines.push('  ```');
        lines.push('  ' + roundData.injectionPreview);
        lines.push('  ```');
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
