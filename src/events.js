/**
 * events.js — ST 事件绑定（通过 TH API）
 */
import { executeIncrementalUpdate, extractStateChangesOnly } from './engine/update.js';
import { executeConsolidation } from './engine/consolidate.js';
import { read, write, rollbackByMsgIds } from './vault/store.js';

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
let lastMessageSentTime = 0; // 追踪最后一次用户发送消息的时间，用于防止非用户触发的 GENERATION_AFTER_COMMANDS

function persistPending() {
    try { localStorage.setItem('ne_pending', JSON.stringify(pendingMessages)); } catch (e) {}
}
export function restorePending() {
    try {
        var raw = localStorage.getItem('ne_pending');
        if (raw) { pendingMessages = JSON.parse(raw); localStorage.removeItem('ne_pending'); }
        var inflight = localStorage.getItem('ne_inflight');
        if (inflight) {
            var inflightBatch = JSON.parse(inflight);
            pendingMessages = inflightBatch.concat(pendingMessages);
            localStorage.removeItem('ne_inflight');
            console.log('[NE] Restored ' + inflightBatch.length + ' inflight messages from crashed pipeline');
        }
    } catch (e) {}
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
            lastMessageSentTime = Date.now();
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
                await flushPendingMessages();
            } else {
                if (statePipelineRunning) return;
                statePipelineRunning = true;
                try {
                    var userMsg = pendingMessages.length >= 2 ? pendingMessages[pendingMessages.length - 2] : null;
                    var chatId = getChatIdFn ? getChatIdFn() : 'default';
                    var stateResult = await extractStateChangesOnly(chatId, userMsg, assistantMsg);
                    if (onVaultUpdateCallback && stateResult.vault) onVaultUpdateCallback(stateResult.vault);
                } catch (e) {
                    console.warn('[NE] Per-round state pipeline failed:', e);
                } finally {
                    statePipelineRunning = false;
                }
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
    console.log('[NE] Pipeline starting: batch=' + batch.length + ' messages');
    const chatId = getChatIdFn ? getChatIdFn() : 'default';
    pipelineRunning = true;
    try {
        try {
            const consResult = await executeConsolidation(chatId);
            var latestVault = consResult.vault;
        } catch (consErr) {
            console.warn('[NE] Consolidation failed, continuing with update:', consErr);
        }
        const result = await executeIncrementalUpdate(chatId, batch);
        latestVault = result.vault;
        if (onVaultUpdateCallback) onVaultUpdateCallback(latestVault);
        consecutiveFailures = 0;
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
        pipelineRunning = false;
        persistPending();
    }
}

export async function onBeforeGenerate(type) {
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

        // Guard: detect spurious GENERATION_AFTER_COMMANDS not triggered by user input.
        // These can fire on vault panel open, DOM mutations, or other ST internal events.
        // If no message was sent recently and no pending messages exist, this is not a real
        // generation — skip heavy processing and just inject a lightweight state-only context.
        var SPURIOUS_THRESHOLD_MS = 30000;
        var sinceLastSend = lastMessageSentTime ? (now - lastMessageSentTime) : Infinity;
        var isSpurious = pendingMessages.length === 0 && sinceLastSend > SPURIOUS_THRESHOLD_MS;
        if (isSpurious) {
            console.log('[NE] onBeforeGenerate: detected spurious trigger (no recent user message), injecting state-only');
            try {
                const { buildStateOnlyInjection } = await import('./ui/vault-panel.js');
                var minimalFormatted = buildStateOnlyInjection(await read(getChatIdFn ? getChatIdFn() : 'default'));
                if (minimalFormatted && typeof TavernHelper !== 'undefined' && TavernHelper.injectPrompts) {
                    TavernHelper.injectPrompts([{
                        id: 'ne_memory_vault',
                        position: 'in_chat',
                        depth: 2,
                        role: 'system',
                        content: minimalFormatted,
                        should_scan: false
                    }], { once: false });
                }
            } catch (e2) { /* silently ignore */ }
            return;
        }
        flushPendingMessages();  // fire-and-forget: Pipeline async, results in next round's vault
        const chatId = getChatIdFn ? getChatIdFn() : 'default';
        if (chatId !== lastKnownChatId) {
            lastKnownChatId = chatId;
            pendingMessages = [];
        }
        const vault = await read(chatId);
        if (!vault || !vault.content) { console.log('[NE] onBeforeGenerate skipped: no vault content'); return; }
        console.log('[NE] onBeforeGenerate running, stm=' + ((vault.content.stm_entries || []).length + (vault.content.unconsolidated_stm || []).length) + ', ltm=' + (vault.content.ltm_entries || []).length);
        var chatMessages = getChatMessagesFn ? getChatMessagesFn() : [];
        try {
            const { formatSmartContext, buildStateOnlyInjection } = await import('./ui/vault-panel.js');
            // Wrap formatSmartContext with a hard timeout to prevent blocking ST's generation pipeline.
            // SmartPush LLM (retrieval synthesis) has its own 3s timeout, but BM25 filtering or
            // other sync operations could also be slow. This outer timeout is the safety net.
            var SMART_CONTEXT_TIMEOUT_MS = 5000;
            var formatted;
            var timedOut = false;
            try {
                formatted = await Promise.race([
                    formatSmartContext(vault, chatMessages),
                    new Promise(function(resolve) {
                        setTimeout(function() {
                            timedOut = true;
                            console.warn('[NE] formatSmartContext timed out after ' + SMART_CONTEXT_TIMEOUT_MS + 'ms, falling back to state-only injection');
                            resolve(buildStateOnlyInjection(vault));
                        }, SMART_CONTEXT_TIMEOUT_MS);
                    })
                ]);
            } catch (e) {
                console.warn('[NE] formatSmartContext failed, falling back to state-only:', e);
                formatted = buildStateOnlyInjection(vault);
            }
            if (formatted && typeof TavernHelper !== 'undefined' && TavernHelper.injectPrompts) {
                TavernHelper.injectPrompts([{
                    id: 'ne_memory_vault',
                    position: 'in_chat',
                    depth: 2,
                    role: 'system',
                    content: formatted,
                    should_scan: false
                }], { once: false });
            }
            if (timedOut) {
                console.log('[NE] onBeforeGenerate completed with timeout fallback');
            }
        } catch (e) {
            console.warn('[NE] Prompt injection failed:', e);
        }
    } catch (e) {
        console.error('[NE] onBeforeGenerate crashed:', e);
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
