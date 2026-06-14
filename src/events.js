/**
 * events.js — ST 事件绑定（通过 TH API）
 */
import { executeIncrementalUpdate, extractStateChangesOnly } from './engine/update.js';
import { executeConsolidation } from './engine/consolidate.js';
import { read, write, rollbackByMsgIds } from './vault/store.js';
import { addLLMLog } from './engine/telemetry.js';
import { incrementChatTurn, recordChatStat } from './engine/chat-telemetry.js';
import { detectContradictions } from './engine/contradiction.js';
import { closeVaultOverlay } from './ui/vault-panel.js';

let getChatIdFn = null;
let getChatMessagesFn = null;
let onVaultUpdateCallback = null;
let lastKnownChatId = null;
let pendingMessages = [];
var pipelineRunning = false;
var statePipelineRunning = false;
var consecutiveFailures = 0;
var retroCapturedChatId = null; // 追捕开场白只执行一次
const MIN_GENERATION_INTERVAL_MS = 500;
let lastGenerationTime = 0;
var onBeforeGenerateRunning = false; // 重入守卫：斩断 generateRaw → Generate() → onBeforeGenerate 级联

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

function getStmBatchSize() {
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
export function onVaultUpdate(cb) { onVaultUpdateCallback = cb; }

export function neSyncChatId(chatId) {
    if (chatId !== lastKnownChatId) {
        pendingMessages = [];
        persistPending();
        pipelineRunning = false;
        statePipelineRunning = false;
        consecutiveFailures = 0;
        retroCapturedChatId = null;
    }
    lastKnownChatId = chatId;
}

export function onMessageSent(messageIndex) {
    try {
        closeVaultOverlay();
        if (!getChatMessagesFn) return;
        const chat = getChatMessagesFn();

        // 首个消息：追捕所有前序消息（开场白等），仅执行一次
        if (pendingMessages.length === 0 && typeof messageIndex === 'number') {
            var currentChatId = getChatIdFn ? getChatIdFn() : null;
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
            pendingMessages.push(assistantMsg);
            persistPending();
            console.log('[NE] onMessageReceived: pending=' + pendingMessages.length);

            if (pipelineRunning) return;

            const totalWords = pendingMessages.reduce((sum, m) => sum + (m.content || '').split(/\s+/).length, 0);
            var shouldRunPipeline = pendingMessages.length >= getStmBatchSize()
                || totalWords >= getStmWordsThreshold()
                || (pendingMessages.length >= 3 && totalWords >= 100);

            if (shouldRunPipeline) {
                flushPendingMessages().catch(function(e) { console.warn('[NE] BG pipeline failed:', e); });
            } else {
                triggerPerRoundExtraction(assistantMsg);
            }
        } else {
            console.log('[NE] onMessageReceived: message not found at index=' + messageIndex);
        }
    } catch (e) {
        console.error('[NE] onMessageReceived crashed:', e);
    }
}

async function flushPendingMessages() {
    if (pipelineRunning) return;
    if (pendingMessages.length === 0) return;
    const totalWords = pendingMessages.reduce((sum, m) => sum + (m.content || '').split(/\s+/).length, 0);
    if (pendingMessages.length < getStmBatchSize() && totalWords < getStmWordsThreshold()) {
        if (pendingMessages.length < 3 || totalWords < 100) {
            console.log('[NE] flushPendingMessages: pending=' + pendingMessages.length + ' words=' + totalWords + ' batch=' + getStmBatchSize() + ' threshold=' + getStmWordsThreshold() + ' — not enough');
            return;
        }
    }
    const batch = pendingMessages.splice(0);
    persistPending();
    try { localStorage.setItem('ne_inflight', JSON.stringify(batch)); } catch (e) {}
    console.log('[NE] Pipeline starting: batch=' + batch.length);
    const chatId = getChatIdFn ? getChatIdFn() : 'default';
    var pipelineStart = Date.now();
    incrementChatTurn(chatId);
    pipelineRunning = true;
    try {
        try {
            const consResult = await executeConsolidation(chatId);
            var latestVault = consResult.vault;
            console.log('[NE] Consolidation done, merged=' + consResult.merged);
        } catch (consErr) {
            console.warn('[NE] Consolidation failed, continuing with update:', consErr);
        }
        const result = await executeIncrementalUpdate(chatId, batch);
        latestVault = result.vault;
        console.log('[NE] Incremental update done, added=' + result.added);

        // Record vault size snapshot
        var content = latestVault && latestVault.content ? latestVault.content : {};
        var stmCount = ((content.unconsolidated_stm || []).concat(content.stm_entries || [])).length;
        var ltmCount = (content.ltm_entries || []).length;
        recordChatStat(chatId, 'stm', stmCount);
        recordChatStat(chatId, 'ltm', ltmCount);

        if (onVaultUpdateCallback) onVaultUpdateCallback(latestVault);
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
        console.log('[NE] Pipeline: setting pipelineRunning=false');
        pipelineRunning = false;
        persistPending();
    }
}

function triggerPerRoundExtraction(assistantMsg) {
    if (statePipelineRunning || pipelineRunning) return;
    statePipelineRunning = true;
    var userMsg = pendingMessages.length >= 2 ? pendingMessages[pendingMessages.length - 2] : null;
    var chatId = getChatIdFn ? getChatIdFn() : 'default';
    extractStateChangesOnly(chatId, userMsg, assistantMsg).then(function(stateResult) {
        if (onVaultUpdateCallback && stateResult && stateResult.vault) onVaultUpdateCallback(stateResult.vault);
    }).catch(function(e) {
        console.warn('[NE] Per-round state pipeline failed:', e);
    }).finally(function() {
        statePipelineRunning = false;
    });
}

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
    if (onBeforeGenerateRunning) {
        console.log('[NE] onBeforeGenerate: re-entrant call blocked (already running)');
        return;
    }
    onBeforeGenerateRunning = true;
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

        await flushPendingMessages();  // await ensures vault is fresh for injection + guard stays up during pipeline
        const chatId = getChatIdFn ? getChatIdFn() : 'default';
        if (chatId !== lastKnownChatId) {
            lastKnownChatId = chatId;
            pendingMessages = [];
        }
        const vault = await read(chatId);
        if (!vault || !vault.content) { console.log('[NE] onBeforeGenerate skipped: no vault content'); return; }
        console.log('[NE] onBeforeGenerate running ts=' + now + ' stm=' + ((vault.content.stm_entries || []).length + (vault.content.unconsolidated_stm || []).length) + ', ltm=' + (vault.content.ltm_entries || []).length);
        var chatMessages = getChatMessagesFn ? getChatMessagesFn() : [];
        var injectStart = Date.now();
        var injectType = 'smartpush_injection';
        try {
            const { formatSmartContext, buildStateOnlyInjection } = await import('./ui/vault-panel.js');
            var formatted;
            try {
                formatted = await formatSmartContext(vault, chatMessages);
            } catch (e) {
                console.warn('[NE] formatSmartContext failed, falling back to state-only:', e);
                formatted = buildStateOnlyInjection(vault);
                injectType = 'smartpush_error';
            }
            if (formatted && typeof TavernHelper !== 'undefined' && TavernHelper.injectPrompts) {
                globalThis.__ne_debug_last_injection = formatted;
                TavernHelper.injectPrompts([{
                    id: 'ne_memory_vault',
                    position: 'in_chat',
                    depth: 2,
                    role: 'system',
                    content: formatted,
                    should_scan: false
                }], { once: false });
            }
            // Log SmartPush injection to LLM log
            var charEstimate = formatted ? Math.round(formatted.length / 3.5) : 0;
            addLLMLog(injectType,
                'Injected ~' + charEstimate + 't to chat ' + chatId,
                formatted || '',
                Date.now() - injectStart,
                'narrative',
                chatId
            );
            // Record per-chat token injection
            if (chatId && charEstimate > 0) {
                recordChatStat(chatId, 'tok', charEstimate);
            }
        } catch (e) {
            console.warn('[NE] Prompt injection failed:', e);
            addLLMLog('smartpush_error', '', e.message, Date.now() - injectStart, 'narrative', chatId);
        }
    } catch (e) {
        console.error('[NE] onBeforeGenerate crashed:', e);
    } finally {
        onBeforeGenerateRunning = false;
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
    if (!getChatIdFn) return;
    const chatId = getChatIdFn();
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
        var chatMessages = getChatMessagesFn()
        chat = chatMessages
    } catch (e) { return }

    if (!chat || !Array.isArray(chat)) return
    var lastMsg = chat[chat.length - 1]
    if (!lastMsg || lastMsg.is_user || lastMsg.role === 'user') return
    var aiMessage = (typeof lastMsg.mes === 'string') ? lastMsg.mes : (lastMsg.content || '')

    if (!aiMessage || aiMessage.trim().length < 20) return

    try {
        var result = await detectContradictions(getChatIdFn(), aiMessage)
        if (result && result.hasContradiction) {
            console.log('[NE] Contradiction detected, triggering regeneration...')
            // 注入证据系统消息
            if (result.systemMessage && typeof TavernHelper !== 'undefined' && TavernHelper.injectPrompts) {
                TavernHelper.injectPrompts([{
                    id: 'ne_contradiction_fix',
                    position: 'in_chat',
                    depth: 0,
                    role: 'system',
                    content: result.systemMessage
                }], { once: true })
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
