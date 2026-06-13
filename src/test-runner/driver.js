/**
 * test-runner/driver.js — LLM Test Driver 核心循环
 *
 * 工作流：读 testCase → 驱动对话 → 收集管线数据 → 断言评估 → 生成报告
 *
 * 设计原则：
 * - Driver 是"模拟玩家"——只看到 AI 回复消息，不读角色卡/世界书内部数据
 * - 角色设定通过 AI 回复自然呈现（就像真实玩家通过对话认知故事世界）
 * - 测试用例的 conversationGuide 提供足够的方向指导
 */
import { collectRoundData, collectVaultSummary } from './monitor.js';
import { evaluateAllStructural, evaluateSemantic } from './assertions.js';
import { createTrace, appendTraceRound, createReport } from './files.js';

export async function runTestLoop(testCase, hostDoc) {
    var doc = hostDoc || document;

    var trace = createTrace(testCase);
    var roundDataList = [];
    var startTime = Date.now();

    if (testCase.seedMessages && testCase.seedMessages.length > 0) {
        console.log('[NE-TEST] Sending seed messages (' + testCase.seedMessages.length + ')...');
        for (var si = 0; si < testCase.seedMessages.length; si++) {
            await sendMessageAndWait(testCase.seedMessages[si], doc, testCase.timeoutPerRound);
            var vaultAfterSeed = await collectVaultSummary();
            console.log('[NE-TEST] Seed ' + (si + 1) + '/' + testCase.seedMessages.length + ' OK, vault: STM=' + (vaultAfterSeed ? vaultAfterSeed.stmCount : '?'));
        }
    }

    var lastAiReply = getLastAiReply();
    var lastInjection = '';
    var gatedResult = null;
    for (var round = 1; round <= testCase.maxRounds; round++) {
        console.log('[NE-TEST] === Round ' + round + '/' + testCase.maxRounds + ' ===');

        var vaultSummary = await collectVaultSummary();

        var driverSystem = buildDriverSystem(testCase);
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

        var userMessage = extractUserMessage(driverResponse);
        if (!userMessage) {
            console.warn('[NE-TEST] Driver did not produce a valid user message.');
            gatedResult = tryParseGated(driverResponse);
            break;
        }
        if (userMessage === '__TEST_DONE__') {
            console.log('[NE-TEST] Driver signaled test completion.');
            gatedResult = tryParseGated(driverResponse);
            break;
        }
        console.log('[NE-TEST] Driver says: ' + userMessage.substring(0, 200));

        await sendMessageAndWait(userMessage, doc, testCase.timeoutPerRound);

        var roundData = collectRoundData();
        lastAiReply = getLastAiReply();
        lastInjection = roundData.injection || '';

        if (!roundData.vault || roundData.vault.stmCount === -1) {
            roundData.vault = await collectVaultSummary();
        }

        roundData.round = round;
        roundData.driverSystem = driverSystem;
        roundData.driverResponse = driverResponse;
        roundData.message = userMessage;
        roundData.aiReply = lastAiReply;
        roundData.progressNote = 'Round ' + round + ' complete.';
        roundDataList.push(roundData);
        trace = appendTraceRound(trace, roundData);

        var structResults = evaluateAllStructural(roundData, testCase.structural);
        var structAllPassed = structResults.every(function(r) { return r.passed; });

        if (round >= testCase.maxRounds - 1 && roundData.injection && structAllPassed) {
            console.log('[NE-TEST] Target likely achieved.');
        }
    }

    var lastRound = roundDataList.length > 0 ? roundDataList[roundDataList.length - 1] : collectRoundData();
    var structuralResults = evaluateAllStructural(lastRound, testCase.structural);

    var semanticResults = [];
    if (testCase.semantic && testCase.semantic.length > 0 && lastRound.injection) {
        console.log('[NE-TEST] Running semantic assertions...');
        semanticResults = await evaluateSemantic(lastRound.injection, testCase.semantic, callMemoryApiForEval);
    }

    var totalDuration = Date.now() - startTime;
    var report = createReport(testCase, roundDataList.length, totalDuration, structuralResults, semanticResults);

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

function getLastAiReply() {
    try {
        var chat = SillyTavern.getContext().chat || [];
        for (var i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user && chat[i].mes) {
                var reasoning = chat[i].extra ? chat[i].extra.reasoning : '';
                if (reasoning && reasoning.length > 0) {
                    return chat[i].mes + '\n\n[思考过程]\n' + reasoning;
                }
                return chat[i].mes;
            }
        }
    } catch (e) {}
    return '';
}

function buildDriverSystem(testCase) {
    var lines = [
        '你是故事参与者，通过与 AI 协作推进故事来测试 NE Memory 记忆系统。',
        '',
        '你可以自由选择交互方式：',
        '- 纯角色对话（"角色名: 内容"）',
        '- 故事叙事（旁白 + 环境描写 + 动作 + 多角色对话）',
        '- 混合模式（在叙事中穿插角色对话）',
        '根据当前故事的自然风格决定。你需要引入角色、事件来推动测试目标。',
        '',
        '## 测试目标',
        testCase.objective,
        '',
        '## 对话指导',
        testCase.conversationGuide,
        '',
        '## 回答格式',
        '每轮输出你的故事内容:',
        'USER_MSG: <文本>',
        '',
        '测试目标达成时:',
        'DONE:',
        'REASON: <达成原因>',
        'DATA: {}'
    ];
    return lines.filter(function(s) { return s !== ''; }).join('\n');
}

function buildDriverUser(testCase, lastAiReply, vaultSummary, lastInjection, round) {
    var lines = [];
    lines.push('## Round ' + round);

    if (vaultSummary) {
        lines.push('记忆系统: STM=' + vaultSummary.stmCount + ' LTM=' + vaultSummary.ltmCount);
    }

    if (lastInjection.length > 0) {
        lines.push('');
        lines.push('上一轮 SmartPush 注入 (前200字):');
        lines.push('```');
        lines.push(lastInjection.substring(0, 200));
        lines.push('```');
    }

    if (lastAiReply.length > 0) {
        lines.push('');
        lines.push('AI 刚刚的回复 (前200字):');
        lines.push('```');
        lines.push(lastAiReply.substring(0, 200));
        lines.push('```');
    }

    lines.push('');
    if (round === 1) {
        lines.push('这是第一轮。请根据对话指导发送第一条消息。');
    } else {
        lines.push('检查测试目标是否已达成。如已达成输出 DONE，否则发送下一条消息。');
    }
    return lines.join('\n');
}

function extractUserMessage(llmResponse) {
    if (!llmResponse) return null;

    if (llmResponse.indexOf('DONE:') !== -1 || llmResponse.indexOf('DONE') === 0) {
        return '__TEST_DONE__';
    }

    var match = llmResponse.match(/USER_MSG:\s*([\s\S]*?)(?:\n\n|\nDONE|\nREASON|\nDATA|$)/);
    if (match) return match[1].trim();

    var trimmed = llmResponse.trim();
    if (trimmed.length > 2 && trimmed.indexOf('\n') === -1) return trimmed;

    var firstLine = trimmed.split('\n')[0].trim();
    if (firstLine.length > 5 && firstLine.indexOf('DONE') === -1 && firstLine.indexOf('Round') === -1) return firstLine;

    return null;
}

function tryParseGated(driverResponse) {
    if (!driverResponse) return null;
    var match = driverResponse.match(/DATA:\s*([\s\S]*?)$/);
    if (!match) return null;
    try {
        var t = match[1].trim();
        if (t.indexOf('```') === 0) t = t.replace(/```(?:json)?\s*/, '').replace(/```$/, '').trim();
        return JSON.parse(t);
    } catch (e) { return null; }
}

async function sendMessageAndWait(message, doc, timeout) {
    var ta = doc.getElementById('send_textarea');
    if (!ta) throw new Error('No textarea');
    ta.value = message;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(function(r) { setTimeout(r, 100); });
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
