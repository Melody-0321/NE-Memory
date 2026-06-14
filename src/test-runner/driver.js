/**
 * test-runner/driver.js — LLM Test Driver 核心循环
 *
 * 工作流：读 testCase → 驱动对话 → 收集管线数据 → 断言评估 → 生成报告
 *
 * 设计原则：
 * - Driver 是"故事参与者"——只看到 AI 回复消息，不读角色卡/世界书内部数据
 * - 角色设定通过 AI 回复自然呈现（就像真实参与者通过对话认知故事世界）
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

        var driverSystem = buildPlayerPrompt();
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

        if (!roundData.vault) {
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

    saveReport(testCase.name, trace, report);

    return {
        trace: trace,
        report: report,
        structuralResults: structuralResults,
        semanticResults: semanticResults,
        roundCount: roundDataList.length,
        totalDurationMs: totalDuration
    };
}

function saveReport(name, trace, report) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    downloadText(name + '-' + ts + '-trace.md', trace);
    downloadText(name + '-' + ts + '-report.md', report);
    console.log('[NE-TEST] Reports saved: ' + name + '-' + ts + '-trace.md, ' + name + '-' + ts + '-report.md');
}

function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
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

// ── Layer 1: 玩家角色 Prompt（纯身份 + 驱动力，不含测试目标）──
function buildPlayerPrompt() {
    var lines = [
        '你是一个真实玩家。你正在与 AI 进行互动。',
        '',
        '从 AI 的回复中，你可以了解当前故事中有哪些角色、他们是谁。',
        'AI 可能同时扮演一个或多个角色（旁白、主角、配角）。',
        '找出那些可互动的关键角色——他们是你关注的中心。',
        '',
        '你的驱动力（内在动机，不需要思考，按感觉行动）：',
        '',
        '1. 你对故事中的关键角色有好奇心和兴趣。',
        '   你想了解他们——他们的过去、想法、情感。',
        '   如果某个角色对你有吸引力，你会自然靠近。',
        '',
        '2. 你在这个世界中有真实的欲望和目标。',
        '   你不是旁观者——你想参与、想改变、想获得。',
        '   这个欲望可能暧昧、可能对抗、可能合作——跟随场景走。',
        '',
        '3. 每轮你的回复都在推动你和角色的关系向前。',
        '   可以是对话、动作、情感流露、身体接触、环境互动。',
        '   不要让对话原地踏步——每次回复都应该有新内容。',
        '',
        '4. 你跟随感受而非计划。',
        '   上一轮 AI 说了什么触动了你，你就沿那个方向走。',
        '   如果她生气了，你安抚或对抗；如果场景变了，你适应。',
        '',
        '5. 如果场景中有多个角色，与最活跃、最有趣的那个互动。',
        '   不要忽略眼前的互动对象去讨论不在场的角色。',
        '',
        '你**不是**在写小说。你是这个故事的参与者——你在这个世界里，',
        '你对 AI 的角色有真实的兴趣，你会主动推进。',
        '',
        '回答格式：',
        'USER_MSG: <你的下一句对话或行动>',
        '',
        '如果感觉本轮已经是自然的结束（测试目标已间接达成），可以输出：',
        'DONE:',
        'REASON: <解释>'
    ];
    return lines.filter(function(s) { return s !== ''; }).join('\n');
}

// ── Layer 2: 测试元认知附录（附加在 User prompt 末尾，不影响角色身份）──
function buildTestStateBlock(testCase, vaultSummary, lastInjection, round) {
    var lines = [];
    lines.push('---');
    lines.push('[测试状态 — 仅供参考，不影响你的角色行为]');

    if (vaultSummary) {
        lines.push('本轮记忆: STM=' + vaultSummary.stmCount + ' LTM=' + vaultSummary.ltmCount + ' 未合并=' + vaultSummary.unconsolidatedCount);
    }

    if (lastInjection && lastInjection.length > 0) {
        var preview = lastInjection.substring(0, 180);
        lines.push('上轮注入预览: ' + preview.replace(/\n/g, ' '));
    }

    var hint = buildStrategyHint(testCase, vaultSummary, round);
    if (hint) {
        lines.push('');
        lines.push('策略提示: ' + hint);
    }

    return lines.join('\n');
}

function buildStrategyHint(testCase, vaultSummary, round) {
    var stm = vaultSummary ? vaultSummary.stmCount : 0;
    var maxR = testCase.maxRounds || 7;
    if (stm === 0 && round === 1) return '这是第一轮。自然开场即可。';
    if (stm >= 4 && round >= 3) return 'STM 已积累 ' + stm + ' 条。这是自然的时机，可以在对话中提出一个与早期已建立的信息相关的具体问题。';
    if (round >= maxR) return '最后一轮。如果测试目标还未达成，现在自然引入一个与之前对话相关的问题。';
    return '';
}

function buildDriverUser(testCase, lastAiReply, vaultSummary, lastInjection, round) {
    var lines = [];

    if (lastAiReply.length > 0) {
        lines.push('AI 刚刚说:');
        lines.push('```');
        lines.push(lastAiReply.substring(0, 600));
        lines.push('```');
    } else {
        lines.push('（第一轮，等待 AI 开场白或直接开始）');
    }

    lines.push('');
    lines.push(buildTestStateBlock(testCase, vaultSummary, lastInjection, round));

    return lines.join('\n');
}

function extractUserMessage(llmResponse) {
    if (!llmResponse) return null;

    if (/^DONE/i.test(llmResponse.trim())) {
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
        var fullPrompt = systemPrompt + '\n\n---\n\n' + userPrompt;
        var resp = await ctx.generateQuietPrompt({ quietPrompt: fullPrompt, removeReasoning: true });
        return resp || '';
    }
    throw new Error('generateQuietPrompt not available');
}

async function callMemoryApiForEval(systemPrompt, userPrompt) {
    try {
        var ctx = SillyTavern.getContext();
        if (ctx.generateQuietPrompt) {
            var fullPrompt = systemPrompt + '\n\n---\n\n' + userPrompt;
            return await ctx.generateQuietPrompt({ quietPrompt: fullPrompt, removeReasoning: true });
        }
    } catch (e) {}
    return '';
}
