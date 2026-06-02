/**
 * events.js — ST 事件绑定（通过 TH API）
 */
import { executeIncrementalUpdate } from './engine/update.js';
import { executeConsolidation } from './engine/consolidate.js';
import { read, rollbackByMsgIds } from './vault/store.js';
import { isRetrievalEnabled } from './index.js';

let getChatIdFn = null;
let getChatMessagesFn = null;
let onVaultUpdateCallback = null;
let lastKnownChatId = null;
let chatReady = true;
let pendingMessages = [];
var pipelineRunning = false;
const MIN_GENERATION_INTERVAL_MS = 3000;
let lastGenerationTime = 0;

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
    pendingMessages = [];
    lastKnownChatId = chatId;
}

export function onMessageSent(messageId) {
    if (!getChatMessagesFn) return;
    const chat = getChatMessagesFn();
    const message = chat.find(m => (m.id || m.mes_id) === messageId);
    if (message) {
        pendingMessages.push({ role: 'user', content: message.mes || '', id: messageId, timestamp: Date.now() });
    }
}

export async function onMessageReceived(messageId) {
    if (!getChatMessagesFn) return;
    const chat = getChatMessagesFn();
    const message = chat.find(m => (m.id || m.mes_id) === messageId);
    if (message) {
        pendingMessages.push({ role: 'assistant', content: message.mes || '', id: messageId, timestamp: Date.now() });
        await checkAndFlush();
    }
}

async function checkAndFlush() {
    await flushPendingMessages();
}

async function flushPendingMessages() {
    if (pendingMessages.length === 0) return;
    const totalWords = pendingMessages.reduce((sum, m) => sum + (m.content || '').split(/\s+/).length, 0);
    if (pendingMessages.length < getStmBatchSize() && totalWords < getStmWordsThreshold()) return;
    const batch = pendingMessages.splice(0);
    const chatId = getChatIdFn ? getChatIdFn() : 'default';
    pipelineRunning = true;
    try {
        const consResult = await executeConsolidation(chatId);
        var latestVault = consResult.vault;
        const result = await executeIncrementalUpdate(chatId, batch);
        latestVault = result.vault;
        if (onVaultUpdateCallback) onVaultUpdateCallback(latestVault);
    } catch (e) {
        console.warn('[NE] Incremental update failed:', e);
        pendingMessages.unshift.apply(pendingMessages, batch);
    } finally {
        pipelineRunning = false;
    }
}

export async function onBeforeGenerate() {
    if (!lastKnownChatId) { console.log('[NE] onBeforeGenerate skipped: no lastKnownChatId'); return; }
    var now = Date.now();
    if (now - lastGenerationTime < MIN_GENERATION_INTERVAL_MS) return;
    lastGenerationTime = now;
    chatReady = false;
    await flushPendingMessages();
    const chatId = getChatIdFn ? getChatIdFn() : 'default';
    if (chatId !== lastKnownChatId) {
        lastKnownChatId = chatId;
        pendingMessages = [];
        chatReady = true;
    }
    const vault = await read(chatId);
    if (!vault || !vault.content) { console.log('[NE] onBeforeGenerate skipped: no vault content'); return; }
    console.log('[NE] onBeforeGenerate running, retrieval=' + isRetrievalEnabled() + ', stm=' + ((vault.content.stm_entries || []).length + (vault.content.unconsolidated_stm || []).length) + ', ltm=' + (vault.content.ltm_entries || []).length);
    var chatMessages = getChatMessagesFn ? getChatMessagesFn() : [];
    try {
        var formatted;
        if (isRetrievalEnabled()) {
            try {
                const { formatSmartContext, estimateComplexityBudget } = await import('./ui/vault-panel.js');
                var raw = localStorage.getItem('ne_settings');
                var userBudget = 800;
                if (raw) {
                    var s = JSON.parse(raw);
                    userBudget = Number(s.memoryBudget) || 800;
                }
                var budget = estimateComplexityBudget(chatMessages, userBudget);
                formatted = formatSmartContext(vault, chatMessages, budget);
            } catch (e) {
                console.warn('[NE] Smart Push failed, falling back to full injection:', e);
                const { formatVaultForPrompt } = await import('./ui/vault-panel.js');
                formatted = formatVaultForPrompt(vault, chatMessages);
            }
        } else {
            const { formatVaultForPrompt } = await import('./ui/vault-panel.js');
            formatted = formatVaultForPrompt(vault, chatMessages);
        }
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
    chatReady = true;
}

export async function onMessageDeleted(messageId) {
    if (!getChatIdFn) return;
    const chatId = getChatIdFn();
    try {
        await rollbackByMsgIds(chatId, [messageId]);
    } catch (e) {
        console.warn('[NE] Rollback on message delete failed:', e);
    }
}

export async function onMessageSwiped(messageId) {
    if (!getChatIdFn) return;
    const chatId = getChatIdFn();
    try {
        await rollbackByMsgIds(chatId, [messageId]);
    } catch (e) {
        console.warn('[NE] Rollback on message swipe failed:', e);
    }
}

export async function onMessageUpdated(messageId) {
    if (!getChatIdFn) return;
    const chatId = getChatIdFn();
    try {
        await rollbackByMsgIds(chatId, [messageId]);
    } catch (e) {
        console.warn('[NE] Rollback on message update failed:', e);
    }
}
