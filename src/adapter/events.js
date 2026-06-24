/**
 * events.js — ST 事件绑定（通过 TH API）
 */
import { executeIncrementalUpdate, extractStateChangesOnly, runLtmDecision, saveVaultWithSnapshot } from '../core/engine/update.js';
import { read, write, rollbackByMsgIds } from '../core/vault/store.js';
import { incrementChatTurn, recordChatStat, recordChatToken } from '../core/engine/chat-telemetry.js';
import { recordDailyToken } from '../core/engine/token-stats.js';
import { runtime } from '../core/runtime.js';
import { detectContradictions } from '../core/engine/contradiction.js';
import { closeVaultOverlay } from './panel.js';
import { formatSmartContext, buildStateOnlyInjection } from '../core/engine/injection.js';
import { formatContextMemory } from '../core/engine/context-window.js';
import { countTokens } from '../core/engine/text-utils.js';
import { isAuto, computeStmBatch, getTelemetryStats, recordTelemetry } from '../core/params.js';
import { isStateSchemaEnabled } from '../core/vault/schema.js';
import { getNextEligibleStmId, runLtmRebatch, applyLtmDecision } from '../core/engine/consolidate.js';
import { callMemoryPipeline } from '../core/api/llm.js';
import { tryAcquire, transitionTo, releasePipeline, isIdle, getPipelinePhase, getState, reset, waitForPipelineTrackIdle } from '../core/engine/pipeline-guard.js';
import { t_narrative } from '../core/i18n.js';

var MEMORY_INJECTION_WRAPPER = [
    '[以下是你在故事中积累的记忆。]',
    '',
    '每个记忆章节末尾的 [KB: 角色=等级] 标明了该故事线中各个角色的知情程度。',
    '当你扮演某个角色或从这个角色的视角写作时，只能写出该角色知情的内容：',
    '  直接知晓 — 该角色亲身经历了该事件，可以自由谈论或回忆',
    '  线索       — 该角色可能间接了解，只能模糊或不确指地提及',
    '  未知       — 该角色对此事完全不知情：不要从其口中说出，也不要从其内心视角呈现',
    '如果你以旁白/叙述者身份写作，只需遵循事实，不区分角色视角。'
].join('\n');

let getChatIdFn = null;
let getChatMessagesFn = null;
let lastKnownChatId = null;
let pendingMessages = [];
let getContextBudgetFn = null;
let lastMemoryInjectionTokens = 0;
var consecutiveFailures = 0;
var _drainContinuationCount = 0;
var retroCapturedChatId = null; // 追捕开场白只执行一次
var _isInjecting = false;
const MAX_DRAIN_CONTINUATIONS = 3;
const MIN_GENERATION_INTERVAL_MS = 500;
let lastGenerationTime = 0;

function countWords(text) {
    if (!text) return 0;
    var cjkCount = 0;
    for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i);
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) || (code >= 0x3000 && code <= 0x303F)) {
            cjkCount++;
        }
    }
    var nonCjkText = text.replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F]+/g, ' ').trim();
    var spaceWords = nonCjkText ? nonCjkText.split(/\s+/).length : 0;
    return cjkCount + spaceWords;
}

function persistPending() {
    try { localStorage.setItem('ne_pending', JSON.stringify(pendingMessages)); } catch (e) {}
}

export function restorePending() {
    try {
        var raw = localStorage.getItem('ne_pending');
        if (raw) {
            try { pendingMessages = JSON.parse(raw); } catch (parseErr) { console.warn('[NE] Failed to parse ne_pending, discarding:', parseErr.message); }
            localStorage.removeItem('ne_pending');
        }
        var inflight = localStorage.getItem('ne_inflight');
        if (inflight) {
            var inflightBatch;
            try { inflightBatch = JSON.parse(inflight); } catch (parseErr) { console.warn('[NE] Failed to parse ne_inflight, discarding:', parseErr.message); }
            if (inflightBatch) {
                pendingMessages = inflightBatch.concat(pendingMessages);
                console.log('[NE] Restored ' + inflightBatch.length + ' inflight messages from crashed pipeline');
            }
            localStorage.removeItem('ne_inflight');
        }
    } catch (e) { console.warn('[NE] restorePending error:', e); }
}

async function getStmBatchSize() {
    if (isAuto('stmBatch')) {
        return computeStmBatch(getTelemetryStats().turnsPerEvent);
    }
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            return Number(s.stmBatch) || 10;
        }
    } catch (e) {}
    return 10;
}

function getStmWordsThreshold() {
    try {
        var raw = localStorage.getItem('ne_settings');
        if (raw) {
            var s = JSON.parse(raw);
            return Number(s.stmWordsThreshold) || 500;
        }
    } catch (e) {}
    return 500;
}

export function setContextFns(getChatId, getChatMessages) {
    getChatIdFn = getChatId;
    getChatMessagesFn = getChatMessages;
    lastKnownChatId = getChatId();
}
export function setGetContextBudgetFn(fn) {
    getContextBudgetFn = fn;
}
export function trackMemoryInjection(tokenCount) {
    lastMemoryInjectionTokens = tokenCount;
}
function computeContextPressure(pendingTokenCount) {
    if (!runtime.maxContext) return -1;
    var maxCtx = runtime.maxContext;
    if (!maxCtx || maxCtx <= 0) return -1;
    var usable = maxCtx - 1500 - lastMemoryInjectionTokens;
    if (usable <= 0) return 1;
    return pendingTokenCount / usable;
}
function notifyVaultChanged() {
    try {
        var doc = window.parent && window.parent !== window ? window.parent.document : document;
        doc.dispatchEvent(new CustomEvent('ne:vault-changed'));
    } catch (e) {}
}

export function neSyncChatId(chatId) {
    if (chatId !== lastKnownChatId) {
        pendingMessages = [];
        persistPending();
        reset();
        consecutiveFailures = 0;
        retroCapturedChatId = null;
    }
    lastKnownChatId = chatId;
}

export function onMessageSent(messageIndex) {
    try {
        closeVaultOverlay();
        if (!runtime.getChat) return;
        const chat = runtime.getChat();

        // 首个消息：追捕所有前序消息（开场白等），仅执行一次
        if (pendingMessages.length === 0 && typeof messageIndex === 'number') {
            var currentChatId = runtime.getChatId();
            if (currentChatId !== retroCapturedChatId) {
                retroCapturedChatId = currentChatId;
                for (var i = 0; i < chat.length; i++) {
                    var earlyMsg = chat[i];
                    var earlyId = earlyMsg.id || earlyMsg.mes_id;
                    if (earlyId === messageIndex) break;
                    if (earlyId !== undefined) {
                        pendingMessages.push({
                            role: earlyMsg.is_user ? 'user' : 'assistant',
                            content: earlyMsg.mes || '',
                            id: earlyId,
                            timestamp: earlyMsg.send_date ? new Date(earlyMsg.send_date).getTime() : Date.now()
                        });
                    }
                }
                if (pendingMessages.length > 0) {
                    persistPending();
                    console.log('[NE] onMessageSent: retroactively captured ' + pendingMessages.length + ' preceding messages (incl. opening)');
                }
            }
        }

        var message = chat[messageIndex];
        if (!message) { message = chat.find(function (m) { return m.mes_id === messageIndex; }); }
        if (message) {
            pendingMessages.push({ role: 'user', content: message.mes || '', id: messageIndex, timestamp: Date.now() });
            persistPending();
            console.log('[NE] onMessageSent: pending=' + pendingMessages.length);
        } else {
            console.log('[NE] onMessageSent: message not found at index=' + messageIndex);
        }
    } catch (e) {
        console.error('[NE] onMessageSent crashed:', e);
    }
}

export async function onMessageReceived(messageIndex) {
    try {
        if (!getChatMessagesFn) return;
        const chat = getChatMessagesFn();
        var message = chat[messageIndex];
        if (!message) { message = chat.find(function (m) { return m.mes_id === messageIndex; }); }
        if (message) {

            var assistantMsg = { role: 'assistant', content: message.mes || '', id: messageIndex, timestamp: Date.now() };

            // 提取 Main LLM 开头的状态栏（管道分隔：场景|时间|天数|事件|角色）
            var stateBlockMatch = (message.mes || '').match(
                /<!--NE-BANNER-->([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)<!--\/NE-BANNER-->/
            );
            if (stateBlockMatch) {
                globalThis.__ne_pending_state_block = {
                    scene: (stateBlockMatch[1] || '').trim(),
                    time: (stateBlockMatch[2] || '').trim(),
                    day: (stateBlockMatch[3] || '').trim(),
                    event: (stateBlockMatch[4] || '').trim(),
                    present: (stateBlockMatch[5] || '').trim().split(/[、，,\s]+/).filter(Boolean)
                };
                console.log('[NE-BANNER] state block detected in msg id=' + (message.mes_id || messageIndex) + ' scene=' + stateBlockMatch[1]);
            }

            var charBlockRegex = /<!--NE-CHAR:([^-]+?)-->(\{[\s\S]*?\})<!--\/NE-CHAR-->/g;
            var charBlockMatch;
            var newCharBlocks = [];
            while ((charBlockMatch = charBlockRegex.exec(message.mes || '')) !== null) {
                var charName = (charBlockMatch[1] || '').trim();
                var charJson = (charBlockMatch[2] || '').trim();
                try {
                    var charData = JSON.parse(charJson);
                    newCharBlocks.push({ name: charName, fields: charData });
                    console.log('[NE-CHAR] new character block detected:', charName, Object.keys(charData).join(', '));
                } catch (e) {
                    console.warn('[NE-CHAR] invalid JSON in char block for:', charName, e.message);
                }
            }
            if (newCharBlocks.length > 0) {
                globalThis.__ne_pending_char_blocks = (globalThis.__ne_pending_char_blocks || []).concat(newCharBlocks);
            }

            // ── NE-CHAR 剥离监测：在 ST 全局正则之前自行剥离并记录 ──
            var rawMes = message.mes || '';
            var stripRegex = /<!--NE-CHAR:([^-]+?)-->\{[\s\S]*?\}<!--\/NE-CHAR-->/g;
            var stripCount = 0;
            var strippedNames = [];
            var strippedMes = rawMes.replace(stripRegex, function(match, name) {
                stripCount++;
                strippedNames.push(name.trim());
                return '';
            });
            if (stripCount > 0) {
                message.mes = strippedMes;
                assistantMsg.content = strippedMes;
                console.log('[NE-CHAR-MONITOR] stripped ' + stripCount + ' block(s): ' + strippedNames.join(', ') +
                    ' | raw had ' + (rawMes.match(/<!--NE-CHAR/g) || []).length + ' tag(s)');
            }

            pendingMessages.push(assistantMsg);
            persistPending();
            console.log('[NE] onMessageReceived: pending=' + pendingMessages.length);

            if (!isIdle()) return;

            const totalWords = pendingMessages.reduce(function(sum, m) { return sum + countWords(m.content); }, 0);
            var pendingTokenCount = pendingMessages.reduce(function(s, m) { return s + countTokens(m.content || ''); }, 0);
            var pressureVal = computeContextPressure(pendingTokenCount);
            var shouldRunPipeline = pendingMessages.length >= await getStmBatchSize()
                || (totalWords >= getStmWordsThreshold() && pendingMessages.length > 2)
                || (pressureVal >= 0.50 && pressureVal > 0);

            if (isStateSchemaEnabled() && pendingMessages.length > 2) {
                triggerPerRoundExtraction(assistantMsg);
            }
            if (shouldRunPipeline) {
                flushPendingMessages().catch(function(e) { console.warn('[NE] BG pipeline failed:', e); });
            }

            try {
                var ctx = globalThis.SillyTavern && globalThis.SillyTavern.getContext();
                if (ctx && ctx.chat) {
                    var chatArr = ctx.chat;
                    var lastMsgIdx = chatArr.length - 1;
                    if (lastMsgIdx >= 0) {
                        var lastMsg = chatArr[lastMsgIdx];
                        var chatTokens = (lastMsg && lastMsg.extra && lastMsg.extra.token_count) || 0;
                        if (chatTokens > 0) {
                            recordChatToken(chatId, 'tok_chat', chatTokens);
                            recordDailyToken('tok_chat', chatTokens);
                        }
                    }
                }
            } catch (e) {}
        } else {
            console.log('[NE] onMessageReceived: message not found at index=' + messageIndex);
        }
    } catch (e) {
        console.error('[NE] onMessageReceived crashed:', e);
    }
}

async function flushPendingMessages() {
    if (!tryAcquire('stm')) {
        console.log('[NE] flushPendingMessages: waiting for state pipeline — state=' + getState());
        await waitForPipelineTrackIdle(15000);
        if (!tryAcquire('stm')) {
            console.log('[NE] flushPendingMessages: guard still blocked after wait, deferring');
            return;
        }
        console.log('[NE] flushPendingMessages: state pipeline done, proceeding');
    }
    if (pendingMessages.length === 0) return;
    const totalWords = pendingMessages.reduce(function(sum, m) { return sum + countWords(m.content); }, 0);
    var pendingTokenCount = pendingMessages.reduce(function(s, m) { return s + countTokens(m.content || ''); }, 0);
    var pressureVal = computeContextPressure(pendingTokenCount);
    if (pendingMessages.length < await getStmBatchSize() && totalWords < getStmWordsThreshold() && pressureVal < 0.50) {
        console.log('[NE] flushPendingMessages: pending=' + pendingMessages.length + ' words=' + totalWords + ' batch=' + await getStmBatchSize() + ' threshold=' + getStmWordsThreshold() + ' pressure=' + (pressureVal >= 0 ? (pressureVal * 100).toFixed(0) + '%' : 'N/A') + ' — not enough');
        return;
    }
    const batch = pendingMessages.splice(0);
    persistPending();
    try { localStorage.setItem('ne_inflight', JSON.stringify(batch)); } catch (e) {}
    console.log('[NE] Pipeline starting: batch=' + batch.length);
    const chatId = runtime.getChatId() || 'default';
    var pipelineStart = Date.now();
    incrementChatTurn(chatId);
    try {
        const result = await executeIncrementalUpdate(chatId, batch);
        var latestVault = result.vault;
        console.log('[NE] Incremental update done, added=' + result.added);
        if (result.added > 0 && batch.length > 0) {
            recordTelemetry({ turns: batch.length, events: result.added });
        }

        // Record vault size snapshot
        var content = latestVault && latestVault.content ? latestVault.content : {};
        var stmCount = ((content.unconsolidated_stm || []).concat(content.stm_entries || [])).length;
        var ltmCount = (content.ltm_entries || []).length;
        recordChatStat(chatId, 'stm', stmCount);
        recordChatStat(chatId, 'ltm', ltmCount);

        notifyVaultChanged();
        consecutiveFailures = 0;
        recordChatStat(chatId, 'dur', Date.now() - pipelineStart);
        try { localStorage.removeItem('ne_inflight'); } catch (e) {}
    } catch (e) {
        console.warn('[NE] Incremental update failed:', e);
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
            console.error('[NE] Pipeline failed ' + consecutiveFailures + ' consecutive times, dropping batch');
            consecutiveFailures = 0;
            try { localStorage.removeItem('ne_inflight'); } catch (e2) {}
        } else {
            pendingMessages.unshift.apply(pendingMessages, batch);
            persistPending();
        }
    } finally {
        console.log('[NE] Pipeline: releasing guard pipeline (stm)');
        releasePipeline();
        persistPending();

        (async function() {
            var MAX_LTM_PASSES = 20;
            var ranLtm = false;
            for (var ltmPass = 0; ltmPass < MAX_LTM_PASSES; ltmPass++) {
                var postStmVault = await read(chatId);
                if (!postStmVault || !postStmVault.content) return;

                var nextId = getNextEligibleStmId(postStmVault);
                if (nextId === null) break;

                if (!tryAcquire('ltm')) {
                    console.log('[NE] LTM pass ' + (ltmPass+1) + ': waiting for pipeline track — state=' + getState());
                    await waitForPipelineTrackIdle(15000);
                    if (!tryAcquire('ltm')) {
                        console.log('[NE] LTM: guard still blocked, deferring remaining passes');
                        break;
                    }
                }
                console.log('[NE-GUARD] acquire ltm (idle → ltm) — pass ' + (ltmPass+1) + ', stm=' + nextId);

                ranLtm = true;
                try {
                    var ltmDecision = await runLtmDecision(postStmVault, [nextId], callMemoryPipeline);
                    if (ltmDecision) {
                        applyLtmDecision(postStmVault, ltmDecision, [nextId]);
                        try { await saveVaultWithSnapshot(chatId, postStmVault); } catch (e) {
                            console.warn('[NE] LTM save failed, rolling back vault');
                            postStmVault = await read(chatId);
                        }
                        globalThis.__ne_debug_last_ltm_decision = {
                            action: ltmDecision.action,
                            stmId: nextId,
                            pass: ltmPass + 1,
                            time: new Date().toISOString()
                        };
                        console.log('[NE] LTM: decision applied — pass ' + (ltmPass+1) + ', action=' + ltmDecision.action + ', stm=' + nextId);
                        notifyVaultChanged();
                    }
                } catch (e) {
                    console.warn('[NE] LTM pass ' + (ltmPass+1) + ' failed:', e);
                    postStmVault = await read(chatId);
                } finally {
                    releasePipeline();
                    console.log('[NE-GUARD] release pipeline (ltm → idle) — pass ' + (ltmPass+1));
                }

                var checkVault = await read(chatId);
                if (getNextEligibleStmId(checkVault) === null) break;
            }

            try {
                var rebatchVault = await read(chatId);
                var orphans = (rebatchVault.content.unconsolidated_stm || []).filter(function(s) { return s.parent_ltm === null; });
                if (orphans.length > 0 && ranLtm && tryAcquire('ltm')) {
                    console.log('[NE] LTM rebatch: ' + orphans.length + ' orphan STMs');
                    var rebatchResult = await runLtmRebatch(rebatchVault, callMemoryPipeline);
                    if (rebatchResult.consumed > 0) {
                        await saveVaultWithSnapshot(chatId, rebatchVault);
                        notifyVaultChanged();
                        console.log('[NE] LTM rebatch completed — consumed ' + rebatchResult.consumed + ' STMs');
                    }
                    releasePipeline();
                }
            } catch (e) {
                console.warn('[NE] LTM rebatch failed:', e);
                releasePipeline();
            }
        })().catch(function(e) { console.warn('[NE] LTM BG pipeline failed:', e); });

        if (pendingMessages.length > 0) {
            (async function() {
                var pendingTokenCount = pendingMessages.reduce(function(s, m) { return s + countTokens(m.content || ''); }, 0);
                var pressureVal = computeContextPressure(pendingTokenCount);
                var totalWords = pendingMessages.reduce(function(s, m) { return s + (m.content || '').split(/\s+/).length; }, 0);
                if ((pendingMessages.length >= await getStmBatchSize()
                    || totalWords >= getStmWordsThreshold()
                    || (pressureVal >= 0.50 && pressureVal > 0))
                    && _drainContinuationCount < MAX_DRAIN_CONTINUATIONS) {
                    _drainContinuationCount++;
                    console.log('[NE] Continuation drain #' + _drainContinuationCount + ' — pending=' + pendingMessages.length);
                    flushPendingMessages().catch(function(e) {
                        console.warn('[NE] Continuation drain failed:', e);
                    });
                }
                _drainContinuationCount = 0;
            })().catch(function(e) { console.warn('[NE] Drain check failed:', e); });
        }
    }
}

function triggerPerRoundExtraction(assistantMsg) {
    if (!isStateSchemaEnabled()) return;
    if (!tryAcquire('state')) return;
    var userMsg = pendingMessages.length >= 2 ? pendingMessages[pendingMessages.length - 2] : null;
    var chatId = getChatIdFn ? getChatIdFn() : 'default';
    extractStateChangesOnly(chatId, userMsg, assistantMsg).then(function(stateResult) {
        if (stateResult && stateResult.vault) notifyVaultChanged();
    }).catch(function(e) {
        console.warn('[NE] Per-round state pipeline failed:', e);
    }).finally(function() {
        releasePipeline();
    });
}

function _ensureBannerCSS() {
    var old = document.getElementById('ne-state-banner-css');
    if (old) old.remove();
    var style = document.createElement('style');
    style.id = 'ne-state-banner-css';
    style.textContent =
        'pre:has(> code[class*="language-banner"]){background:none!important;border:none!important;padding:0!important;margin:0!important;}' +
        'code[class*="language-banner"]{display:block;position:relative;margin:6px 0 10px 0;padding:10px 14px;border-radius:8px;background:linear-gradient(135deg,rgba(155,109,94,.07) 0%,rgba(125,73,64,.02) 50%,rgba(155,109,94,.04) 100%);border:1px solid rgba(155,109,94,.12);box-shadow:0 1px 3px rgba(0,0,0,.03);font-size:12px;line-height:1.55;overflow:hidden;font-family:inherit;color:inherit;text-decoration:none;white-space:pre-wrap;}' +
        'code[class*="language-banner"]::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,rgba(155,109,94,.3),rgba(155,109,94,.06));border-radius:3px 0 0 3px;}' +
        '.ne-state-banner-icon{display:inline-block;width:20px;text-align:center;opacity:.85;}' +
        '.ne-state-banner-label{opacity:.7;}' +
        '.ne-state-banner-value{}';
    document.head.appendChild(style);
    console.log('[NE-BANNER] CSS injected, rules=' + style.sheet.cssRules.length);
}

var _globalBannerRegexRegistered = false;
function registerGlobalBannerRegex() {
    if (_globalBannerRegexRegistered) return true;
    try {
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        if (!ctx) {
            console.warn('[NE-BANNER] SillyTavern.getContext() returned null');
            return false;
        }
        if (!ctx.extensionSettings) {
            console.warn('[NE-BANNER] ctx.extensionSettings not available yet');
            return false;
        }
        var es = ctx.extensionSettings;
        es.regex = Array.isArray(es.regex) ? es.regex : [];

        var DISPLAY_ID = 'ne-state-banner';
        var PROMPT_ID = 'ne-state-banner-prompt';
        var _BANNER_VERSION = '1.1';
        var DISPLAY_NAME = 'NE State Banner v' + _BANNER_VERSION;
        var PROMPT_NAME = 'NE State Banner (prompt strip) v' + _BANNER_VERSION;
        var FIND_PIPE = '<!--NE-BANNER-->([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)<!--\\/NE-BANNER-->';
        var REPLACE_HTML = '\n```banner\n' +
            '\uD83D\uDCCD \u5730\u70B9\uFF1A$1\n' +
            '\u2600\uFE0F \u65F6\u95F4\uFF1A$2\n' +
            '\uD83D\uDCC5 \u5929\u6570\uFF1ADay $3\n' +
            '\u26A1 \u573A\u666F\u63CF\u8FF0\uFF1A$4\n' +
            '\uD83D\uDC64 \u5728\u573A\u89D2\u8272\uFF1A$5\n' +
            '```\n';
        var FIND_PROMPT = '<!--NE-BANNER-->[^|]*\\|[^|]*\\|[^|]*\\|[^|]*\\|[^|]*<!--\\/NE-BANNER-->\\s*';

        // ── 迁移：扫描所有历史版本（id 以 ne-state-banner / ne-state-banner-prompt 开头，
        //     可以是精确匹配也可以是带 -vN 后缀），归一化为永久 id，删掉多余的 ──
        var BANNER_PATTERN = /^ne-state-banner(?:-v\d+)?$/;
        var PROMPT_PATTERN = /^ne-state-banner-prompt(?:-v\d+)?$/;

        var displayCandidates = [];
        var promptCandidates = [];
        for (var i = 0; i < es.regex.length; i++) {
            var rid = es.regex[i].id || '';
            if (BANNER_PATTERN.test(rid)) displayCandidates.push(i);
            if (PROMPT_PATTERN.test(rid)) promptCandidates.push(i);
        }

        // 只保留最后一个 display 候选，删除其余（从高索引删起避免 shift）
        for (var d = displayCandidates.length - 2; d >= 0; d--) {
            es.regex.splice(displayCandidates[d], 1);
        }
        // 只保留最后一个 prompt 候选，删除其余
        for (var p = promptCandidates.length - 2; p >= 0; p--) {
            es.regex.splice(promptCandidates[p], 1);
        }

        // 重新扫描唯一条目
        var displayEntry = null;
        var promptEntry = null;
        for (var j = 0; j < es.regex.length; j++) {
            var jid = es.regex[j].id || '';
            if (BANNER_PATTERN.test(jid)) displayEntry = es.regex[j];
            if (PROMPT_PATTERN.test(jid)) promptEntry = es.regex[j];
        }

        var updatedCount = 0;
        if (!displayEntry || displayEntry.id !== DISPLAY_ID || displayEntry._neVersion !== _BANNER_VERSION) {
            if (!displayEntry) {
                displayEntry = { id: DISPLAY_ID };
                es.regex.push(displayEntry);
            }
            displayEntry.id = DISPLAY_ID;
            displayEntry.scriptName = DISPLAY_NAME;
            displayEntry.findRegex = FIND_PIPE;
            displayEntry.replaceString = REPLACE_HTML;
            displayEntry.enabled = true;
            displayEntry.runOnEdit = false;
            displayEntry.markdownOnly = true;
            displayEntry.promptOnly = false;
            displayEntry.placement = [2];
            displayEntry.substituteRegex = 0;
            displayEntry.minDepth = null;
            displayEntry.maxDepth = null;
            displayEntry.onlyLongerThan = null;
            displayEntry.onlyShorterThan = null;
            displayEntry.trimStrings = [];
            displayEntry._neVersion = _BANNER_VERSION;
            updatedCount++;
        }
        if (!promptEntry || promptEntry.id !== PROMPT_ID || promptEntry._neVersion !== _BANNER_VERSION) {
            if (!promptEntry) {
                promptEntry = { id: PROMPT_ID };
                es.regex.push(promptEntry);
            }
            promptEntry.id = PROMPT_ID;
            promptEntry.scriptName = PROMPT_NAME;
            promptEntry.findRegex = FIND_PROMPT;
            promptEntry.replaceString = '';
            promptEntry.enabled = true;
            promptEntry.runOnEdit = false;
            promptEntry.markdownOnly = false;
            promptEntry.promptOnly = true;
            promptEntry.placement = [2];
            promptEntry.substituteRegex = 0;
            promptEntry.minDepth = null;
            promptEntry.maxDepth = null;
            promptEntry.onlyLongerThan = null;
            promptEntry.onlyShorterThan = null;
            promptEntry.trimStrings = [];
            promptEntry._neVersion = _BANNER_VERSION;
            updatedCount++;
        }

        var CHAR_FIND = '<!--NE-CHAR:[^-]+-->\\{[\\s\\S]*?\\}<!--\\/NE-CHAR-->';
        var CHAR_ID = 'ne-char-block-strip';
        var CHAR_NAME = 'NE Character Block Strip';
        var CHAR_VERSION = '1.1';
        var charStripPattern = /^ne-char-block-strip$/;
        var charEntry = null;
        for (var cj = 0; cj < es.regex.length; cj++) {
            if (charStripPattern.test(es.regex[cj].id || '')) {
                charEntry = es.regex[cj];
                break;
            }
        }
        if (!charEntry || charEntry._neVersion !== CHAR_VERSION) {
            if (!charEntry) {
                charEntry = { id: CHAR_ID };
                es.regex.push(charEntry);
            }
            charEntry.id = CHAR_ID;
            charEntry.scriptName = CHAR_NAME;
            charEntry.findRegex = CHAR_FIND;
            charEntry.replaceString = '';
            charEntry.enabled = true;
            charEntry.runOnEdit = false;
            charEntry.markdownOnly = false;
            charEntry.promptOnly = false;
            charEntry.placement = [2];
            charEntry.substituteRegex = 0;
            charEntry.minDepth = null;
            charEntry.maxDepth = null;
            charEntry.onlyLongerThan = null;
            charEntry.onlyShorterThan = null;
            charEntry.trimStrings = [];
            charEntry._neVersion = CHAR_VERSION;
            updatedCount++;
        }

        if (updatedCount > 0) {
            ctx.saveSettingsDebounced();
            if (ctx.eventSource && ctx.eventTypes && ctx.eventTypes.SETTINGS_LOADED) {
                ctx.eventSource.once(ctx.eventTypes.SETTINGS_LOADED, function() {
                    ctx.saveSettingsDebounced();
                });
            }
        }
        _ensureBannerCSS();
        _globalBannerRegexRegistered = true;
        if (updatedCount > 0) {
            var msg = 'NE State Banner \u5df2\u66f4\u65b0\u5230 v' + _BANNER_VERSION;
            if (typeof toastr !== 'undefined' && toastr.success) {
                toastr.success(msg, '', { timeOut: 3000 });
            }
            console.log('[NE-BANNER] ' + msg + ' (' + updatedCount + ' entries)');
        }
        return true;
    } catch (e) {
        console.error('[NE-BANNER] Failed to register global regex:', e);
        return false;
    }
}

export { registerGlobalBannerRegex };

export async function onBeforeGenerate(type, _options, dryRun) {
    // ST 的 PromptManager 在页面加载/config变更时调用 Generate(type, {}, true)
    // 做 dry run 以获取 token 计数。dry run 走完整 prompt 组装但不调 API，
    // 但会触发 GENERATION_AFTER_COMMANDS 事件。各扩展应检测并跳过，避免副作用。
    if (dryRun) {
        console.log('[NE] onBeforeGenerate: dry run, skipping entirely');
        return;
    }
    // 重入守卫：generateRaw/generateQuietPrompt 内部会调用 ST 的 Generate()，
    // 从而触发新的 GENERATION_AFTER_COMMANDS → onBeforeGenerate，形成级联。
    // 此守卫拦截所有重入调用，斩断级联链。
    if (_isInjecting) {
        console.log('[NE] onBeforeGenerate: re-entrant call blocked (already running)');
        return;
    }
    _isInjecting = true;
    try {
        // Skip non-content generations: impersonate (AI帮答), quiet, continue
        if (type && (type === 'impersonate' || type === 'quiet' || type === 'continue')) {
            console.log('[NE] onBeforeGenerate skipped: generation type=' + type);
            return;
        }
        if (!lastKnownChatId) { console.log('[NE] onBeforeGenerate skipped: no lastKnownChatId'); return; }
        var now = Date.now();
        if (now - lastGenerationTime < MIN_GENERATION_INTERVAL_MS) return;
        lastGenerationTime = now;

        const chatId = getChatIdFn ? getChatIdFn() : 'default';
        if (chatId !== lastKnownChatId) {
            lastKnownChatId = chatId;
            pendingMessages = [];
        }
        const vault = await read(chatId);
        if (!vault || !vault.content) { console.log('[NE] onBeforeGenerate skipped: no vault content'); return; }
        console.log('[NE] onBeforeGenerate running ts=' + now + ' stm=' + ((vault.content.stm_entries || []).length + (vault.content.unconsolidated_stm || []).length) + ', ltm=' + (vault.content.ltm_entries || []).length);
        var chatMessages = runtime.getChat ? runtime.getChat() : [];
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        var protagonistName = (ctx && ctx.name1) || null;
        if (vault.content.state) {
            var currentName = vault.content.state.protagonist_name || '';
            if (protagonistName && protagonistName !== currentName) {
                vault.content.state.protagonist_name = protagonistName;
            } else if (!currentName && !protagonistName) {
                console.warn('[NE] protagonist_name not set: ctx.name1 is null');
            }
        }
        var neSettings = {};
        try { var raw = localStorage.getItem('ne_settings'); if (raw) neSettings = JSON.parse(raw); } catch (e) {}
        var contextWindowRounds = neSettings.contextWindowRounds || 30;
        var contextMemory = formatContextMemory(vault, chatMessages, contextWindowRounds);
        if (contextMemory) {
            globalThis.__ne_debug_last_context_memory = contextMemory;
            runtime.injectPrompt('ne_context_memory', contextMemory, 'in_chat', 1, 'system');
            var cmCharEstimate = countTokens(contextMemory);
            if (chatId && cmCharEstimate > 0) {
                recordChatToken(chatId, 'tok_chat', cmCharEstimate);
            }
        }
        try {
            var formatted;
            try {
                formatted = await formatSmartContext(vault, chatMessages);
            } catch (e) {
                console.warn('[NE] formatSmartContext failed, falling back to state-only:', e);
                formatted = buildStateOnlyInjection(vault);
            }
            if (formatted) {
                var fbMarker = formatted.indexOf('[KB:');
                var fsMarker = formatted.indexOf('## ');
                if (fbMarker !== -1 || fsMarker !== -1) {
                    formatted = MEMORY_INJECTION_WRAPPER + '\n\n' + formatted;
                }
                globalThis.__ne_debug_last_injection = formatted;
                runtime.injectPrompt('ne_memory_vault', formatted, 'in_chat', 2, 'system');
            }
            // State block instruction — Main LLM outputs pre-built banner HTML at reply start
            if (isStateSchemaEnabled()) {
                var dayInfo = vault.content.story_date || '第1天';
                var timeInfo = vault.content.story_time || '';
                var sceneInfo = vault.content.story_scene || '';
                var timePreview = timeInfo.match(/^\d{4}-\d{2}-\d{2}/) ? '' : timeInfo;

                var currentState = '当前状态：' + dayInfo +
                    (timePreview ? '，' + timePreview : '') +
                    (sceneInfo ? '，' + sceneInfo : '') + '\n';

                var stateBlockInstr = currentState +
                    '在回复最开头输出以下格式的状态栏（紧贴开头，独占一行，正文从下一行开始）。\n' +
                    '格式：<!--NE-BANNER-->场景|时间|天数|事件摘要|角色1、角色2<!--/NE-BANNER-->\n' +
                    '各部分用 | 分隔，天数只写数字（如 1），角色用中文顿号(、)分隔。不要用 || 连接。\n' +
                    '要求：\n' +
                    '- 场景仅在切换时更新，否则沿用。时间按自然节奏递进。\n' +
                    '- 时间从深夜递进到清晨时天数+1；否则保持当前天数。\n' +
                    '- 事件摘要用一句话概括本段发生的主要事件。\n' +
                    '- 仅包含本轮消息中明确有台词或动作的角色。提及≠出场（"听说张三来过"不算）。';
                runtime.injectPrompt('ne_state_block', stateBlockInstr, 'in_chat', 0, 'system');
                globalThis.__ne_debug_last_state_block_instruction = stateBlockInstr;
                console.log('[NE-BANNER] state block instruction injected, currentState=', dayInfo, sceneInfo || '(none)', timePreview || '');

                var protagonistName = (vault.content.state && vault.content.state.protagonist_name) || '';
                var npcSchemes = (vault.content.state && vault.content.state.npc_schemes) || {};
                var schemeNames = Object.keys(npcSchemes).filter(function(k) { return k !== 'default'; });
                var npcFieldsList = 'gender_age, occupation, personality, clothing_build, affection, relationship, current_mood, inner_thoughts, status, injuries, status_effects, past_experience';
                var pcFieldsList = 'gender_age, occupation, personality, clothing_build, status, injuries, status_effects';

                var charBlockInstr = '本轮对话中如果出现了状态卡中尚未记录的新角色（上方 Current State 中未出现的角色名），在回复末尾为其输出角色信息块。\n' +
                    '状态卡中已有的角色无需输出，跳过即可。\n' +
                    '\n- PC（主角，你扮演的角色）' + (protagonistName ? ': ' + protagonistName : '') + ' — 可用字段: ' + pcFieldsList + '\n' +
                    '- NPC（其他角色）— 可用字段: ' + npcFieldsList + '\n' +
                    (schemeNames.length > 0 ? '- NPC 可用方案: ' + schemeNames.join(', ') + '（未指定时用 "default"）\n' : '') +
                    '\n格式：\n' +
                    '  主角范例: <!--NE-CHAR:' + (protagonistName || '你的角色名') + '-->{"_role":"protagonist","gender_age":"...","occupation":"...","personality":"...","clothing_build":"...","status":"活跃"}<!--/NE-CHAR-->\n' +
                    '  NPC范例: <!--NE-CHAR:角色名-->{"_role":"npc","_scheme":"方案名","gender_age":"...","occupation":"...","personality":"...","clothing_build":"...","affection":50,"relationship":"...","current_mood":"...","inner_thoughts":"...","status":"活跃"}<!--/NE-CHAR-->\n' +
                    '\n规则：\n' +
                    '- 只看状态卡中尚不存在的角色。已有角色不输出。\n' +
                    '- 如果没有新角色，则不需要输出任何 NE-CHAR 块。\n' +
                    '- 不要在 NE-CHAR 块之外额外写 "PC:" 或 "NPC:" 标签。\n' +
                    '- _role: "protagonist" 或 "npc"（必填）。\n' +
                    '- _scheme: NPC 才需要，从上方可用方案中选择（必填）。\n' +
                    '- 尽可能多地填写你能从对话和角色认知中确定的字段。有把握就填，不确定的字段省略。\n' +
                    '- 角色信息块放在回复末尾，正文之后。';
                runtime.injectPrompt('ne_char_block', charBlockInstr, 'in_chat', 0, 'system');
            }
            // Log SmartPush injection to LLM log
            var charEstimate = formatted ? countTokens(formatted) : 0;
            trackMemoryInjection(charEstimate);
            // Record per-chat token injection
            if (chatId && charEstimate > 0) {
                recordChatToken(chatId, 'tok_chat', charEstimate);
            }
        } catch (e) {
            console.warn('[NE] Prompt injection failed:', e);
        }
    } catch (e) {
        console.error('[NE] onBeforeGenerate crashed:', e);
    } finally {
        _isInjecting = false;
    }
}

export async function onMessageDeleted(messageId) {
    if (!getChatIdFn) return;
    const chatId = getChatIdFn();
    try {
        const vault = await read(chatId);
        rollbackByMsgIds(vault, [messageId]);
        await write(chatId, vault);
    } catch (e) {
        console.warn('[NE] Rollback on message delete failed:', e);
    }
}

export async function onMessageSwiped(messageId) {
    const chatId = runtime.getChatId();
    try {
        const vault = await read(chatId);
        rollbackByMsgIds(vault, [messageId]);
        await write(chatId, vault);
    } catch (e) {
        console.warn('[NE] Rollback on message swipe failed:', e);
    }
}

export async function onMessageUpdated(messageId) {
    if (!getChatIdFn) return;
    const chatId = getChatIdFn();
    try {
        const vault = await read(chatId);
        rollbackByMsgIds(vault, [messageId]);
        await write(chatId, vault);
    } catch (e) {
        console.warn('[NE] Rollback on message update failed:', e);
    }
}

/* ──────── 矛盾检测（容器C）──────── */

var contradictionContinuation = null;
var contradictionRetryCount = 0;
var MAX_CONTRADICTION_RETRIES = 1;

/**
 * 设置主 LLM 生成函数引用（用于触发重新生成）
 */
export function setGenerateFn(fn) {
    contradictionContinuation = fn;
}

/**
 * 生成后矛盾检测钩子
 * 在 MESSAGE_RECEIVED 事件中触发，仅当用户开启矛盾检测设置时运行。
 * 非流式：chat[chatId].mes 已设置，addOneMessage 未调用 → 可拦截
 * 流式：CHARACTER_MESSAGE_RENDERED 已触发 → 需更新 DOM
 */
export async function onMessageGenerated(chatId) {
    if (!getChatIdFn || !contradictionContinuation) return
    if (contradictionRetryCount > MAX_CONTRADICTION_RETRIES) {
        contradictionRetryCount = 0
        return
    }

    // 检查设置是否启用
    var neSettings = {}
    try {
        var raw = localStorage.getItem('ne_settings')
        if (raw) neSettings = JSON.parse(raw)
    } catch (e) {}
    if (!neSettings.contradictionDetectionEnabled) return

    // 获取 AI 回复文本
    var chat
    try {
        var chatMessages = runtime.getChat()
        chat = chatMessages
    } catch (e) { return }

    if (!chat || !Array.isArray(chat)) return
    var lastMsg = chat[chat.length - 1]
    if (!lastMsg || lastMsg.is_user || lastMsg.role === 'user') return
    var aiMessage = (typeof lastMsg.mes === 'string') ? lastMsg.mes : (lastMsg.content || '')

    if (!aiMessage || aiMessage.trim().length < 20) return

    try {
        var result = await detectContradictions(runtime.getChatId(), aiMessage)
        if (result && result.hasContradiction) {
            console.log('[NE] Contradiction detected, triggering regeneration...')
            // 注入证据系统消息
            if (result.systemMessage) {
                runtime.injectPrompt('ne_contradiction_fix', result.systemMessage, 'in_chat', 0, 'system');
            }
            contradictionRetryCount++
            // 触发重新生成
            try {
                await contradictionContinuation()
            } catch (e) {
                console.warn('[NE] Contradiction regeneration failed:', e)
            }
            return
        }
    } catch (e) {
        // 矛盾检测失败时不阻止消息发送
    }
    contradictionRetryCount = 0
}

export function waitForPipelineIdle(timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    return new Promise(function(resolve) {
        if (isIdle()) { resolve(); return; }
        var start = Date.now();
        var check = setInterval(function() {
            if (isIdle() || Date.now() - start >= timeoutMs) {
                clearInterval(check);
                setTimeout(resolve, 500);
            }
        }, 150);
    });
}
