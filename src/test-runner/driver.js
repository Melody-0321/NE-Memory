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
            console.warn('[NE-TEST] Driver response not in expected format. Raw:', driverResponse.substring(0, 300));
            var fallback = fallbackUserMessage(driverResponse);
            if (fallback) {
                userMessage = fallback;
                console.log('[NE-TEST] Using fallback message: ' + userMessage.substring(0, 200));
            } else {
                console.warn('[NE-TEST] No message could be extracted, trying next round...');
                roundDataList.push({
                    round: round, driverSystem: driverSystem, driverResponse: driverResponse,
                    message: '', aiReply: '', injection: '',
                    vault: null, progressNote: 'EXTRACTION FAILED — raw: ' + driverResponse.substring(0, 500)
                });
                trace = appendTraceRound(trace, roundDataList[roundDataList.length - 1]);
                continue;
            }
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

    saveReport(testCase.folder || testCase.name, testCase.name, trace, report);

    return {
        trace: trace,
        report: report,
        structuralResults: structuralResults,
        semanticResults: semanticResults,
        roundCount: roundDataList.length,
        totalDurationMs: totalDuration
    };
}

var _reportsDirHandle = null;

function setReportsDirHandle(handle) {
    _reportsDirHandle = handle;
}

async function saveReport(folder, name, trace, report) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    var traceName = name + '-' + ts + '-trace.md';
    var reportName = name + '-' + ts + '-report.md';

    if (!_reportsDirHandle) {
        _reportsDirHandle = await loadDirHandleFromDB();
    }

    if (_reportsDirHandle) {
        try {
            var subDir = await getOrCreateSubDir(folder);
            await writeToDirHandle(subDir, traceName, trace);
            await writeToDirHandle(subDir, reportName, report);
            console.log('[NE-TEST] Reports written to: ' + folder + '/' + traceName);
            return;
        } catch (e) {
            console.warn('[NE-TEST] Direct write failed, falling back to download:', e.message);
        }
    }

    downloadFallback(name, trace, report);
    console.log('[NE-TEST] Reports downloaded via browser (use __ne_debug.setReportsDir() for auto-save).');
}

function downloadFallback(name, trace, report) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([trace], { type: 'text/markdown;charset=utf-8' }));
    a.download = name + '-' + ts + '-trace.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);

    a.href = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
    a.download = name + '-' + ts + '-report.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

async function getOrCreateSubDir(name) {
    try {
        return await _reportsDirHandle.getDirectoryHandle(name, { create: true });
    } catch (e) {
        return _reportsDirHandle;
    }
}

async function writeToDirHandle(dirHandle, filename, content) {
    var fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    var writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

async function loadDirHandleFromDB() {
    try {
        return await new Promise(function(resolve) {
            var req = indexedDB.open('ne_test_runner', 1);
            req.onupgradeneeded = function() { req.result.createObjectStore('files'); };
            req.onsuccess = function() {
                try {
                    var tx = req.result.transaction('files', 'readonly');
                    var getReq = tx.objectStore('files').get('reportsDir');
                    getReq.onsuccess = function() { resolve(getReq.result || null); };
                    getReq.onerror = function() { resolve(null); };
                } catch (e) { resolve(null); }
            };
            req.onerror = function() { resolve(null); };
        });
    } catch (e) { return null; }
}

async function saveDirHandleToDB(handle) {
    try {
        return await new Promise(function(resolve) {
            var req = indexedDB.open('ne_test_runner', 1);
            req.onupgradeneeded = function() { req.result.createObjectStore('files'); };
            req.onsuccess = function() {
                try {
                    var tx = req.result.transaction('files', 'readwrite');
                    tx.objectStore('files').put(handle, 'reportsDir');
                    tx.oncomplete = function() { resolve(); };
                    tx.onerror = function() { resolve(); };
                } catch (e) { resolve(); }
            };
            req.onerror = function() { resolve(); };
        });
    } catch (e) {}
}

export async function setReportsDir() {
    try {
        var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        setReportsDirHandle(handle);
        await saveDirHandleToDB(handle);
        return 'OK — reports will auto-save to the selected directory.';
    } catch (e) {
        if (e.name === 'AbortError') return 'Cancelled.';
        return 'Not supported — use browser download instead. Error: ' + e.message;
    }
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
        '你是故事中的主要参与者。你正在与 AI 进行协作写作。',
        '',
        '从 AI 的回复中了解当前故事的世界、角色和场景。',
        'AI 可能扮演一个或多个角色（旁白、主角、配角）。',
        '找出那些可互动的关键角色——他们是你的关注中心。',
        '',
        '你的驱动力：',
        '1. 你对关键角色有好奇心——了解他们的过去、情感、秘密',
        '2. 你有真实的欲望——想靠近、想了解、想改变、想获得',
        '3. 每轮你都推进关系——对话、动作、情感流露、身体接触、场景转换',
        '4. 你跟随感受——她说了什么触动你，你就沿那个方向走',
        '5. 与场景中最活跃、最有趣的角色互动，不要跑题',
        '',
        '',
        '每次你写你的整个"回合"——包括你如何回应、你的动作、你的内心活动、',
        '以及你推动场景前进的方式。你不是在写一句回话——你是在写你的故事部分。',
        '',
        '',
        '当你认为测试目标已经自然达成时，在输出末尾加上:',
        '[DONE] 原因',
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

function fallbackUserMessage(llmResponse) {
    if (!llmResponse) return null;
    var trimmed = llmResponse.trim();
    if (trimmed.length < 2) return null;
    return trimmed.substring(0, 600);
}

function extractUserMessage(llmResponse) {
    if (!llmResponse) return null;
    var trimmed = llmResponse.trim();

    if (trimmed.length < 2) return null;

    var doneIdx = trimmed.indexOf('[DONE]');
    if (doneIdx !== -1) {
        if (doneIdx === 0) return '__TEST_DONE__';
        return trimmed.substring(0, doneIdx).trim() || '__TEST_DONE__';
    }

    return trimmed.substring(0, 600);
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
