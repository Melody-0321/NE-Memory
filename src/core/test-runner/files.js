/**
 * test-runner/files.js — 测试用例 & 报告文件处理
 */
import { __KNOWN_TESTS, __TEST_MARKDOWN } from './test-data.generated.js';

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

    // State tracking
    var stack = [];  // { key, indent, type: 'list'|'obj', list: []|null }
    var currentObj = result;

    for (var li = 0; li < lines.length; li++) {
        var rawLine = lines[li];
        var indent = rawLine.length - rawLine.replace(/^[ \t]+/, '').length;
        var content = rawLine.trim();

        if (!content || content.charAt(0) === '#') continue;

        // Pop stack for lines with lower or equal indentation
        while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
            var frame = stack.pop();
            if (frame.parentKey && frame.type === 'list') {
                currentObj[frame.parentKey] = frame.list;
            }
            currentObj = frame.parentObj;
        }

        if (content.charAt(0) === '-') {
            // List item
            var itemText = content.substring(1).trim();
            if (stack.length === 0) continue; // top-level list items ignored

            var parent = stack[stack.length - 1];
            if (parent.type !== 'list') continue;

            if (itemText.charAt(0) === '{' && itemText.charAt(itemText.length - 1) === '}') {
                parent.list.push(parseInlineObject(itemText));
            } else {
                parent.list.push(unquoteString(itemText));
            }
            continue;
        }

        // Key: value pair
        var kvMatch = content.match(/^(\w[\w-]*):\s*(.*)/);
        if (!kvMatch) continue;

        var key = kvMatch[1];
        var rest = kvMatch[2].trim();

        if (rest === '') {
            // Check next non-empty line to determine type
            var nextIndent = -1;
            var nextContent = '';
            for (var nli = li + 1; nli < lines.length; nli++) {
                var nLine = lines[nli].trim();
                if (!nLine || nLine.charAt(0) === '#') continue;
                nextIndent = lines[nli].length - lines[nli].replace(/^[ \t]+/, '').length;
                nextContent = nLine;
                break;
            }

            if (nextIndent > indent && nextContent.charAt(0) === '-') {
                // List
                stack.push({ parentKey: key, indent: indent, type: 'list', list: [], parentObj: currentObj });
                currentObj[key] = []; // placeholder
            } else if (nextIndent > indent) {
                // Sub-object
                stack.push({ parentKey: null, indent: indent, type: 'obj', list: null, parentObj: currentObj });
                currentObj = currentObj[key] = {};
            } else {
                // No children, empty key
                currentObj[key] = null;
            }
        } else if (rest === '[]') {
            currentObj[key] = [];
        } else if (rest === '{}') {
            currentObj[key] = {};
        } else {
            currentObj[key] = parseScalar(rest);
        }
    }

    // Flush remaining stack frames
    while (stack.length > 0) {
        var frame = stack.pop();
        if (frame.parentKey && frame.type === 'list') {
            currentObj[frame.parentKey] = frame.list;
        }
        currentObj = frame.parentObj;
    }

    return result;
}

function parseScalar(val) {
    val = val.trim();
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null' || val === '~') return null;
    if (val.length >= 2 && val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
        var inner = val.substring(1, val.length - 1);
        inner = inner.replace(/\\"/g, '"');
        return inner;
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

export function listKnownTests() {
    return __KNOWN_TESTS;
}

export function loadTestCaseByName(name) {
    var markdown = __TEST_MARKDOWN[name];
    if (!markdown) {
        console.error('[NE-TEST] Test case "' + name + '" not found in embedded data');
        return null;
    }
    return parseTestCaseFile(markdown);
}

export function getTestCaseMetadata(name) {
    var entry = (__KNOWN_TESTS || []).find(function(t) { return t.name === name; });
    if (!entry) return null;
    var markdown = __TEST_MARKDOWN[name];
    if (!markdown) return { name: name, title: entry.title, category: entry.category || 'functional', maxRounds: 10, minRounds: 0 };

    var raw = parseYamlFrontmatter(markdown);
    return {
        name: name,
        title: entry.title,
        category: entry.category || 'functional',
        maxRounds: typeof raw.maxRounds === 'number' ? raw.maxRounds : 10,
        minRounds: typeof raw.minRounds === 'number' ? raw.minRounds : 0
    };
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
    if (roundData.smartpushPrompt) {
        lines.push('- SmartPush Prompt (retrieval LLM system prompt): ' + roundData.smartpushPrompt.length + ' chars');
        lines.push('  ```');
        lines.push('  ' + roundData.smartpushPrompt);
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
