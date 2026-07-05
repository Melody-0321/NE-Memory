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
import { collectRoundData, collectVaultSummary, startCollectingPipelineCalls, stopCollectingPipelineCalls, drainOrphanPipelineCalls } from '../core/test-runner/monitor.js';
import { evaluateAllStructural, evaluateSemantic } from '../core/test-runner/assertions.js';
import { createTrace, appendTraceRound, createReport } from '../core/test-runner/files.js';
import { callMemoryLLM } from '../core/api/llm.js';

function __ne_waitForPipelineDrain(timeoutMs) {
    var debug = globalThis.__ne_debug;
    if (!debug || !debug.waitForPipelineIdle) return;
    return debug.waitForPipelineIdle(timeoutMs);
}

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
    var endType = 'completed';
    // ── 语义评估追踪 ──
    var semanticResults = null;
    var semanticDefinitive = false;  // 所有语义断言是否已得出明确结论
    var structuralDefinitive = false; // 所有结构断言是否已得出明确结论
    // 无结构断言的测试，结构部分视为已完成
    if (!testCase.structural || testCase.structural.length === 0) {
        structuralDefinitive = true;
    }

    if (testCase.preconditions && testCase.preconditions.length > 0) {
        console.log('[NE-TEST] Verifying preconditions...');
        for (var pi = 0; pi < testCase.preconditions.length; pi++) {
            var cond = testCase.preconditions[pi];
            var failed = null;
            if (cond.indexOf('State Schema') !== -1) {
                try {
                    var raw = localStorage.getItem('ne_settings');
                    var enabled = raw ? !!JSON.parse(raw).enableStateSchema : false;
                    if (!enabled) failed = 'State Schema is disabled (ne_settings.enableStateSchema is falsy)';
                } catch(e) { failed = 'Cannot verify State Schema: ' + e.message; }
            }
            if (cond.indexOf('SmartPush') !== -1) {
            }
            if (failed) {
                console.error('[NE-TEST] Precondition FAILED: "' + cond + '" — ' + failed);
                return {
                    error: 'Precondition FAILED: "' + cond + '" — ' + failed + '. Please fix and re-run.',
                    structuralResults: [],
                    semanticResults: [],
                    roundCount: 0,
                    totalDurationMs: 0,
                    trace: '',
                    report: ''
                };
            }
        }
        console.log('[NE-TEST] All preconditions verified OK.');
    }

    startCollectingPipelineCalls();
    for (var round = 1; round <= testCase.maxRounds; round++) {
        console.log('[NE-TEST] === Round ' + round + '/' + testCase.maxRounds + ' ===');

        var vaultSummary = await collectVaultSummary();

        var driverSystem = buildPlayerPrompt(testCase, round);
        var driverUser = buildDriverUser(testCase, lastAiReply, vaultSummary, lastInjection, round);

        console.log('[NE-TEST] Calling LLM Driver (main API)...');
        var driverResponse = '';
        try {
            driverResponse = await callMainApi(driverSystem, driverUser);
        } catch (e) {
            console.error('[NE-TEST] Driver LLM call failed:', e.message);
            endType = 'error';
            break;
        }
        if (!driverResponse || driverResponse.trim().length === 0) {
            console.warn('[NE-TEST] Driver returned empty response, stopping.');
            endType = 'error';
            break;
        }

        var userMessage = extractUserMessage(driverResponse, round, testCase.minRounds);
        if (!userMessage) {
            console.warn('[NE-TEST] Driver response not in expected format. Raw:', driverResponse);
            var fallback = fallbackUserMessage(driverResponse);
            if (fallback) {
                userMessage = fallback;
                console.log('[NE-TEST] Using fallback message: ' + userMessage);
            } else {
                console.warn('[NE-TEST] No message could be extracted, trying next round...');
                roundDataList.push({
                    round: round, driverSystem: driverSystem, driverResponse: driverResponse,
                    message: '', aiReply: '', injection: '',
                    vault: null, progressNote: 'EXTRACTION FAILED — raw: ' + driverResponse
                });
                trace = appendTraceRound(trace, roundDataList[roundDataList.length - 1]);
                continue;
            }
        }
        if (userMessage === '__TEST_DONE__') {
            console.log('[NE-TEST] Driver signaled test completion.');
            endType = 'natural_done';
            gatedResult = tryParseGated(driverResponse);
            break;
        }
        console.log('[NE-TEST] Driver says: ' + userMessage);

        globalThis.__ne_tr_currentRound = round;
        await sendMessageAndWait(userMessage, doc, testCase.timeoutPerRound);
        await __ne_waitForPipelineDrain(testCase.timeoutPerRound * 3);

        var roundData = collectRoundData(round, round);
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

        // ── 结构性断言（minRounds 后检查，单条不通过不终止）──
        if (!structuralDefinitive && testCase.structural && testCase.structural.length > 0 && round >= testCase.minRounds) {
            var structResults = evaluateAllStructural(roundData, testCase.structural);
            var structAllPassed = structResults.every(function(r) { return r.passed; });
            if (structAllPassed) {
                structuralDefinitive = true;
                console.log('[NE-TEST] All structural assertions PASSED (round ' + round + ').');
            } else {
                var structFailedCount = structResults.filter(function(r) { return !r.passed; }).length;
                console.log('[NE-TEST] Structural: ' + structFailedCount + '/' + structResults.length + ' failed, continuing.');
            }
        }

        // ── 语义性断言（三态：通过/不通过/无法判断） ──
        var semanticQuestions = testCase.semantic;
        if (semanticQuestions && semanticQuestions.length > 0 && !semanticDefinitive && round >= testCase.minRounds && round % 3 === 0) {
            try {
                var semResults = await evaluateSemantic(roundData.pipelineResponses, semanticQuestions, callMemoryApiForEval, round);
                semanticResults = semResults;
                // 分类结果：明确通过、明确不通过、无法判断
                var semPassed = semResults.filter(function(r) { return r.passed === true; }).length;
                var semFailed = semResults.filter(function(r) { return r.passed === false; }).length;
                var semInconclusive = semResults.filter(function(r) { return r.passed === null; }).length;

                if (semFailed > 0) {
                    console.log('[NE-TEST] Semantic assertion definitively FAILED, stopping.');
                    endType = 'semantic_fail';
                    break;
                }
                if (semInconclusive === 0) {
                    semanticDefinitive = true;
                    if (semPassed === semResults.length && structuralDefinitive) {
                        if (round >= testCase.minRounds + 3) {
                            console.log('[NE-TEST] All semantic + structural assertions PASSED (round ' + round + ' >= minRounds+3).');
                            endType = 'natural_done';
                            break;
                        }
                        console.log('[NE-TEST] All assertions PASSED but round ' + round + ' < minRounds+3, continuing for data collection.');
                    } else if (semPassed === semResults.length && !structuralDefinitive) {
                        console.log('[NE-TEST] Semantic assertions all PASSED but structural not yet definitive, continuing.');
                    }
                }
                // semPassed > 0 但有 semInconclusive → 部分通过但还有无法判断的，继续
                console.log('[NE-TEST] Semantic eval: ' + semPassed + ' passed, ' + semFailed + ' failed, ' + semInconclusive + ' inconclusive, continuing.');
            } catch (e) {
                console.warn('[NE-TEST] Semantic evaluation failed:', e);
            }
        }

        if (round >= testCase.maxRounds) {
            endType = 'forced_max_rounds';
            break;
        }
    }

    stopCollectingPipelineCalls();

    // 清理全局状态
    delete globalThis.__ne_tr_currentRound;

    // 添加结束类型到 trace
    trace += '\n\n---\n**测试结束类型**: ' + endType + '\n';

    // 回收晚到的管线调用，追加到最后一条 trace 末尾
    var orphanCalls = drainOrphanPipelineCalls();
    if (orphanCalls.length > 0) {
        trace += '\n\n## 轮次外管线调用（延迟到达）\n';
        for (var oi = 0; oi < orphanCalls.length; oi++) {
            var oc = orphanCalls[oi];
            trace += '\n### 调用 #' + (oi + 1) + ' — ' + oc.operation + ' (roundTag=' + oc.roundTag + ', ' + oc.source + ', ' + oc.durationMs + 'ms)';
            if (oc.usage) {
                var pt2 = oc.usage.prompt_tokens || '?';
                var ct2 = oc.usage.completion_tokens || '?';
                var tt2 = oc.usage.total_tokens || (pt2 !== '?' && ct2 !== '?' ? pt2 + ct2 : '?');
                trace += '\n- **Tokens:** prompt=' + pt2 + ' completion=' + ct2 + ' total=' + tt2;
            }
            trace += '\n\n';
            trace += '**System Prompt:**\n```\n' + (oc.messages ? (oc.messages.find(function(m) { return m.role === 'system'; }) || {}).content || '(none)' : '') + '\n```\n\n';
            trace += '**User Prompt:**\n```\n' + (oc.messages ? (oc.messages.find(function(m) { return m.role === 'user'; }) || {}).content || '(none)' : '') + '\n```\n\n';
            trace += '**LLM Response:**\n```\n' + (oc.response || '') + '\n```\n';
        }
    }

    var lastRound = roundDataList.length > 0 ? roundDataList[roundDataList.length - 1] : collectRoundData();
    var structuralResults = evaluateAllStructural(lastRound, testCase.structural);

    // ── 最终语义评估 ──
    // 如果循环内已作出明确结论，复用结果；否则在结束时做一次终局评估
    if (testCase.semantic && testCase.semantic.length > 0) {
        if (semanticResults && semanticDefinitive) {
            console.log('[NE-TEST] Using loop-collected semantic results (definitive).');
        } else if (lastRound && lastRound.pipelineResponses) {
            console.log('[NE-TEST] Running final semantic assertions...');
            semanticResults = await evaluateSemantic(lastRound.pipelineResponses, testCase.semantic, callMemoryApiForEval, roundDataList.length);
        } else {
            semanticResults = [];
        }
        if (endType === 'forced_max_rounds') {
            semanticResults = (semanticResults || []).map(function(r) {
                if (r.passed === null) {
                    return { question: r.question, passed: false, evaluation: r.evaluation + ' (超时截断，按不通过处理)' };
                }
                return r;
            });
        }
    } else {
        semanticResults = [];
    }

    var totalDuration = Date.now() - startTime;
    var tokenRounds = roundDataList.map(function(rd) { return rd.tokenSummary; });
    var report = createReport(testCase, roundDataList.length, totalDuration, structuralResults, semanticResults, tokenRounds, roundDataList);
    report += '\n\n**结束类型**: ' + endType + '\n';

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
        totalDurationMs: totalDuration,
        endType: endType
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
        if (_reportsDirHandle) {
            try {
                var perm = await _reportsDirHandle.requestPermission({ mode: 'readwrite' });
                if (perm !== 'granted') {
                    console.warn('[NE-TEST] Stored directory permission revoked, clearing handle');
                    _reportsDirHandle = null;
                    try {
                        await new Promise(function(resolve) {
                            var req = indexedDB.open('ne_test_runner', 1);
                            req.onsuccess = function() {
                                var tx = req.result.transaction('files', 'readwrite');
                                tx.objectStore('files').delete('reportsDir');
                                tx.oncomplete = resolve;
                                tx.onerror = resolve;
                            };
                            req.onerror = resolve;
                        });
                    } catch (e) {}
                }
            } catch (e) {
                console.warn('[NE-TEST] Permission request failed:', e.message);
                _reportsDirHandle = null;
            }
        }
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
    var traceUrl, reportUrl;

    traceUrl = URL.createObjectURL(new Blob([trace], { type: 'text/markdown;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = traceUrl; a.download = name + '-' + ts + '-trace.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(traceUrl); }, 5000);

    reportUrl = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
    a.href = reportUrl; a.download = name + '-' + ts + '-report.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(reportUrl); }, 5000);
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
                    tx.onerror = function(ev) {
                        console.warn('[NE-TEST] IndexedDB save failed (non-Chrome browsers may not support storing directory handles):', ev.target && ev.target.error ? ev.target.error.message : '');
                        resolve();
                    };
                } catch (e) { console.warn('[NE-TEST] IndexedDB save failed:', e.message); resolve(); }
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
function buildPlayerPrompt(testCase, round) {
    var expectedRounds = testCase.expectedRounds || '5-8';
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
        '3. 每轮你都推动关系——对话、动作、情感、场景转换',
        '4. 你跟随感受——她说了什么触动你，你就沿那个方向走',
        '5. 与场景中最活跃、最有趣的角色互动，不要跑题',
        '',
        '用玩家的方式输出：一两句话表达你的回应、做出一个动作、或提出一个问题。',
        '保持简练。不要写长篇叙事、不要内心独白、不要环境描写。你只需要说一句话或做一个小动作。',
        '不要使用方括号包裹场景/时间/事件/在场角色等元数据（如 "[场景，时间，第N天，事件，在场：角色]"）。那是系统格式，不是你的对话内容。',
        '',
        '轮次信息：',
        '- 预期可在 ' + expectedRounds + ' 轮内自然完成。',
        '- 如果测试目标尚未达成，你可以继续推进。',
        '- 当前第 ' + round + ' 轮。',
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
        var preview = lastInjection.substring(0, 500);
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
    var minR = testCase.minRounds || 0;
    if (stm === 0 && round === 1) return '这是第一轮。自然开场即可。';
    if (stm >= 4 && round >= 3 && round < minR + 2) return 'STM 已积累 ' + stm + ' 条。可以在对话中提出一个与早期已建立的信息相关的具体问题。';
    if (stm >= 4 && round >= minR + 2 && round <= minR + 4) return 'STM 已积累 ' + stm + ' 条。如果已经问过一次，可以再次提出与同一事件相关的问题，观察注入内容的变化。';
    if (round >= maxR - 2) return '还剩不到 2 轮。如果测试目标还未达成，尽快引入测试查询。';
    return '';
}

function buildDriverUser(testCase, lastAiReply, vaultSummary, lastInjection, round) {
    var lines = [];

    if (lastAiReply.length > 0) {
        lines.push('AI 刚刚说:');
        lines.push('```');
        lines.push(cleanAiReply(lastAiReply).substring(0, 2000));
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
    return trimmed;
}

function extractUserMessage(llmResponse, currentRound, minRounds) {
    if (!llmResponse) return null;
    var trimmed = llmResponse.trim();
    if (trimmed.length < 2) return null;

    var doneIdx = trimmed.indexOf('[DONE]');
    if (doneIdx !== -1) {
        if (currentRound < minRounds) {
            console.log('[NE-TEST] [DONE] ignored before minRounds (' + currentRound + '/' + minRounds + ')');
            var preDone = trimmed.substring(0, doneIdx).trim();
            return preDone.length > 0 ? stripFormatTags(preDone) : null;
        }
        if (doneIdx === 0) return '__TEST_DONE__';
        return stripFormatTags(trimmed.substring(0, doneIdx).trim()) || '__TEST_DONE__';
    }

    return stripFormatTags(trimmed);
}

function stripFormatTags(text) {
    return text
        .replace(/<!--NE-CHAR:[^-]+-{2,3}>\{[\s\S]*?\}<!--\/NE-CHAR-->/g, '')
        .replace(/<\/?content>/gi, '')
        .replace(/<Time>.*?<\/Time>/gs, '')
        .replace(/<Time\/>/gi, '')
        .replace(/\[思考过程\][\s\S]*?(?=\n\n###|$)/, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function cleanAiReply(text) {
    return text
        .replace(/<!--NE-CHAR:[^-]+-{2,3}>\{[\s\S]*?\}<!--\/NE-CHAR-->/g, '')
        .replace(/<\/?content>/gi, '')
        .replace(/<Time>.*?<\/Time>/gs, '')
        .replace(/<Time\/>/gi, '')
        .replace(/\[思考过程\][\s\S]*?(?=\n\n###|$)/, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
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
        var response = await callMemoryLLM(
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            { operation: 'test_eval', timeout: 30 }
        );
        return response || '';
    } catch (e) {
        console.warn('[NE-TEST] Evaluator LLM call failed:', e.message);
    }
    return '';
}
