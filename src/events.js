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
const MIN_GENERATION_INTERVAL_MS = 500;
let lastGenerationTime = 0;

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
        consecutiveFailures = 0;
    }
    lastKnownChatId = chatId;
}

export function onMessageSent(messageIndex) {
    try {
        if (!getChatMessagesFn) return;
        const chat = getChatMessagesFn();
        var message = chat[messageIndex];
        if (!message) { message = chat.find(function (m) { return m.mes_id === messageIndex; }); }
        if (message) {
            pendingMessages.push({ role: 'user', content: message.mes || '', id: messageIndex, timestamp: Date.now() });
            persistPending();
            console.log('[NE] onMessageSent: pending=' + pendingMessages.length);
            checkAndFlush();
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
                    await extractStateChangesOnly(chatId, userMsg, assistantMsg);
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

async function checkAndFlush() {
    await flushPendingMessages();
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

export async function onBeforeGenerate() {
    try {
        if (!lastKnownChatId) { console.log('[NE] onBeforeGenerate skipped: no lastKnownChatId'); return; }
        var now = Date.now();
        if (now - lastGenerationTime < MIN_GENERATION_INTERVAL_MS) return;
        lastGenerationTime = now;
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
            const { formatVaultForPrompt } = await import('./ui/vault-panel.js');
            var formatted = formatVaultForPrompt(vault, chatMessages);
            if (typeof TavernHelper !== 'undefined' && TavernHelper.injectPrompts) {
                TavernHelper.injectPrompts([{
                    id: 'ne_memory_vault',
                    position: 'in_chat',
                    depth: 2,
                    role: 'system',
                    content: formatted,
                    should_scan: false
                }], { once: false });
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
