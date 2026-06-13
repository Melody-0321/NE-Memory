/**
 * test-runner/driver.js — LLM Test Driver 核心循环
 *
 * 工作流：读 testCase → 驱动对话 → 收集管线数据 → 断言评估 → 生成报告
 */
import { collectRoundData, collectVaultSummary } from './monitor.js';
import { evaluateAllStructural, evaluateSemantic } from './assertions.js';
import { createTrace, appendTraceRound, createReport } from './files.js';

export async function runTestLoop(testCase, hostDoc) {
    var doc = hostDoc || document;

    // ── 1. 读角色卡 & 世界书 ──
    var charInfo = readCharacterInfo();
    var worldbookSummary = readWorldbookSummary();

    // ── 2. 初始化 trace ──
    var trace = createTrace(testCase);
    var roundDataList = [];
    var startTime = Date.now();

    // ── 3. 发送种子消息（如果用例指定）──
    if (testCase.seedMessages && testCase.seedMessages.length > 0) {
        console.log('[NE-TEST] Sending seed messages (' + testCase.seedMessages.length + ')...');
        for (var si = 0; si < testCase.seedMessages.length; si++) {
            var seedMsg = testCase.seedMessages[si];
            await sendMessageAndWait(seedMsg, doc, testCase.timeoutPerRound);
            var vaultAfterSeed = await collectVaultSummary();
            console.log('[NE-TEST] Seed ' + (si + 1) + '/' + testCase.seedMessages.length + ' OK, vault: STM=' + (vaultAfterSeed ? vaultAfterSeed.stmCount : '?'));
        }
    }

    // ── 4. 主循环 ──
    var lastAiReply = '';
    var lastInjection = '';
    var gatedResult = null;
    for (var round = 1; round <= testCase.maxRounds; round++) {
        console.log('[NE-TEST] === Round ' + round + '/' + testCase.maxRounds + ' ===');

        // 采集上一轮的 vault 状态
        var vaultSummary = await collectVaultSummary();

        // 构建 Driver System Prompt
        var driverSystem = buildDriverSystem(testCase, charInfo, worldbookSummary, vaultSummary);
        var driverUser = buildDriverUser(testCase, lastAiReply, vaultSummary, lastInjection, round);

        console.log('[NE-TEST] Calling LLM Driver (main API)...');
        var driverResponse = '';
        try {
            driverResponse = await callMainApi(driverSystem, driverUser);
        } catch (e) {
            console.error('[NE-TEST] Driver LLM call failed:', e.message);
            break;
        }
        if (!driverResponse || driverResponse.trim().length === 0) {
            console.warn('[NE-TEST] Driver returned empty response, stopping.');
            break;
        }

        // 提取用户消息
        var userMessage = extractUserMessage(driverResponse);
        if (!userMessage) {
            console.warn('[NE-TEST] Driver did not produce a valid user message.');
            // 尝试分派 gate 结果
            gatedResult = tryParseGated(driverResponse);
            break;
        }
        if (userMessage === '__TEST_DONE__') {
            console.log('[NE-TEST] Driver signaled test completion.');
            gatedResult = tryParseGated(driverResponse);
            break;
        }
        console.log('[NE-TEST] Driver says: ' + userMessage.substring(0, 200));

        // 发送消息 → 等待回复
        await sendMessageAndWait(userMessage, doc, testCase.timeoutPerRound);

        // 收集数据
        var roundData = collectRoundData();
        lastAiReply = roundData.injectionPreview || '';
        lastInjection = roundData.injection || '';

        // 补充 vault
        if (!roundData.vault || roundData.vault.stmCount === -1) {
            var vs = await collectVaultSummary();
            roundData.vault = vs;
        }

        // 写入 trace
        roundData.round = round;
        roundData.driverSystem = driverSystem;
        roundData.driverResponse = driverResponse;
        roundData.message = userMessage;
        roundData.progressNote = 'Round ' + round + ' complete.';
        roundDataList.push(roundData);
        trace = appendTraceRound(trace, roundData);

        // 结构性断言即时检查（提前知道是否达成）
        var structResults = evaluateAllStructural(roundData, testCase.structural);
        var structAllPassed = structResults.every(function(r) { return r.passed; });

        // 如果最后一轮注入非空+结构断言通过，认为目标达成
        if (round >= testCase.maxRounds - 1 && roundData.injection && structAllPassed) {
            console.log('[NE-TEST] Target likely achieved.');
        }
    }

    // ── 5. 最终断言 ──
    var lastRound = roundDataList.length > 0 ? roundDataList[roundDataList.length - 1] : collectRoundData();
    var structuralResults = evaluateAllStructural(lastRound, testCase.structural);

    // 语义断言（使用副 API，如果有）
    var semanticResults = [];
    if (testCase.semantic && testCase.semantic.length > 0 && lastRound.injection) {
        console.log('[NE-TEST] Running semantic assertions...');
        semanticResults = await evaluateSemantic(lastRound.injection, testCase.semantic, callMemoryApiForEval);
    }

    // ── 6. 生成报告 ──
    var totalDuration = Date.now() - startTime;
    var report = createReport(testCase, roundDataList.length, totalDuration, structuralResults, semanticResults);

    // 如果有 gated 额外数据，追加
    if (gatedResult) {
        report += '\n\n## LLM 分派结果\n```json\n' + JSON.stringify(gatedResult, null, 2) + '\n```\n';
    }

    return {
        trace: trace,
        report: report,
        structuralResults: structuralResults,
        semanticResults: semanticResults,
        roundCount: roundDataList.length,
        totalDurationMs: totalDuration
    };
}

// ── Helpers ──

function readCharacterInfo() {
    try {
        var ctx = SillyTavern.getContext();
        if (ctx.characters && ctx.characters.length > 0) {
            var ch = ctx.characters[0];
            return {
                name: ch.name || '',
                description: (ch.description || '').substring(0, 500),
                personality: (ch.personality || '').substring(0, 300),
                firstMes: (ch.first_mes || '').substring(0, 500),
                scenario: (ch.scenario || '').substring(0, 300)
            };
        }
    } catch (e) {}
    return { name: '未知角色', description: '', personality: '', firstMes: '', scenario: '' };
}

function readWorldbookSummary() {
    try {
        var ctx = SillyTavern.getContext();
        if (ctx.worldInfo) {
            var entries = ctx.worldInfo.entries || [];
            if (entries.length === 0) return '无世界书。';
            return entries.length + ' 个世界书条目: ' + entries.map(function(e) { return (e.comment || e.key || '') + (e.content ? ' (' + e.content.substring(0, 40) + '...)' : ''); }).join('; ').substring(0, 800);
        }
    } catch (e) {}
    return '无世界书。';
}

function buildDriverSystem(testCase, charInfo, worldbookSummary, vaultSummary) {
    return [
        '你是 NE Memory 记忆系统的智能测试用户。',
        '',
        '## 角色设定',
        '当前角色: ' + charInfo.name,
        charInfo.description ? '描述: ' + charInfo.description : '',
        charInfo.personality ? '性格: ' + charInfo.personality : '',
        charInfo.firstMes ? '开场白: ' + charInfo.firstMes : '',
        '',
        '## 世界书',
        worldbookSummary,
        '',
        '## 测试目标',
        testCase.objective,
        '',
        '## 对话设计指导',
        testCase.conversationGuide,
        '',
        '## 回答格式',
        '你需要扮演测试用户，生成一条自然对话消息。',
        '',
        '每轮输出格式:',
        'USER_MSG: <你的消息文本>',
        '',
        '当测试目标达成时，输出:',
        'DONE:',
        'REASON: <达成原因>',
        'DATA: <JSON 格式的分派结果>',
        '',
        '你可以在 USER_MSG 的括号内给出你的角色设定，例如 "USER_MSG: 你好，我叫阿明，是矿工。"'
    ].filter(function(s) { return s !== ''; }).join('\n');
}

function buildDriverUser(testCase, lastAiReply, vaultSummary, lastInjection, round) {
    var lines = [];
    lines.push('## Round ' + round);
    lines.push('');
    lines.push('### 系统状态');
    if (vaultSummary) lines.push('- STM: ' + vaultSummary.stmCount + ', LTM: ' + vaultSummary.ltmCount + ', 未合并: ' + vaultSummary.unconsolidatedCount);
    lines.push('');
    if (lastInjection && lastInjection.length > 0) {
        lines.push('### 上轮 SmartPush 注入 (' + lastInjection.length + ' chars, 前300字)');
        lines.push('```');
        lines.push(lastInjection.substring(0, 300));
        lines.push('```');
    }
    lines.push('');
    if (lastAiReply && lastAiReply.length > 0) {
        lines.push('### 上次 AI 回复 (前200字)');
        lines.push('```');
        lines.push(lastAiReply.substring(0, 200));
        lines.push('```');
    }
    lines.push('');
    if (round === 1) {
        lines.push('请发送第一条测试消息。根据角色开场白开始自然对话。');
    } else {
        lines.push('请检查测试目标是否达成。如果已达成，输出 DONE。否则，发送下一条用户消息推进测试。');
    }
    return lines.join('\n');
}

function extractUserMessage(llmResponse) {
    if (!llmResponse) return null;

    // 检查 DONE 信号
    if (llmResponse.indexOf('DONE:') !== -1 || llmResponse.indexOf('DONE') === 0) {
        return '__TEST_DONE__';
    }

    // 提取 USER_MSG 后的内容
    var userMsgMatch = llmResponse.match(/USER_MSG:\s*([\s\S]*?)(?:\n\n|\nDONE|\nREASON|\nDATA|$)/);
    if (userMsgMatch) {
        return userMsgMatch[1].trim();
    }

    // 回退：如果整个响应只是一条消息（第一轮常见）
    var trimmed = llmResponse.trim();
    if (trimmed.length > 2 && trimmed.indexOf('\n') === -1) {
        return trimmed;
    }

    // 再回退：取第一行作为消息
    var firstLine = trimmed.split('\n')[0].trim();
    if (firstLine.length > 5 && firstLine.indexOf('DONE') === -1 && firstLine.indexOf('Round') === -1) {
        return firstLine;
    }

    return null;
}

function tryParseGated(driverResponse) {
    if (!driverResponse) return null;
    var dataMatch = driverResponse.match(/DATA:\s*([\s\S]*?)$/);
    if (dataMatch) {
        try {
            var jsonStr = dataMatch[1].trim();
            if (jsonStr.indexOf('```') === 0) {
                jsonStr = jsonStr.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();
            }
            return JSON.parse(jsonStr);
        } catch (e) { return null; }
    }
    return null;
}

async function sendMessageAndWait(message, doc, timeout) {
    var ta = doc.getElementById('send_textarea');
    if (!ta) throw new Error('No textarea');
    ta.value = message;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(function(resolve) { setTimeout(resolve, 100); });
    var btn = doc.getElementById('send_but');
    if (btn) btn.click();
    await __ne_waitUntilReply(timeout, doc);
}

function __ne_waitUntilReply(maxMs, doc) {
    return new Promise(function(resolve) {
        var es = SillyTavern.getContext().eventSource;
        var totalTimer = setTimeout(function() { resolve(); }, maxMs || 120000);
        function pollDone() {
            if (!doc.body.dataset.generating) {
                clearTimeout(totalTimer);
                setTimeout(resolve, 500);
                return;
            }
            setTimeout(pollDone, 150);
        }
        es.once('message_received', function() { pollDone(); });
    });
}

async function callMainApi(systemPrompt, userPrompt) {
    var ctx = SillyTavern.getContext();
    if (ctx.generateQuietPrompt) {
        var resp = await ctx.generateQuietPrompt(userPrompt, systemPrompt);
        return resp || '';
    }
    throw new Error('generateQuietPrompt not available');
}

async function callMemoryApiForEval(systemPrompt, userPrompt) {
    try {
        var ctx = SillyTavern.getContext();
        if (ctx.generateQuietPrompt) {
            return await ctx.generateQuietPrompt(userPrompt, systemPrompt);
        }
    } catch (e) {}
    return '';
}
