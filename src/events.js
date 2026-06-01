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
const MEMORY_BATCH_SIZE = 10;
const MEMORY_FORCE_WORDS = 500;
var pipelineRunning = false;

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
    if (pendingMessages.length === 0) return;
    const totalWords = pendingMessages.reduce((sum, m) => sum + (m.content || '').split(/\s+/).length, 0);
    const shouldFlush = pendingMessages.length >= MEMORY_BATCH_SIZE || totalWords >= MEMORY_FORCE_WORDS;
    if (shouldFlush) await flushPendingMessages();
}

async function flushPendingMessages() {
    if (pendingMessages.length === 0) return;
    const batch = pendingMessages.splice(0);
    const chatId = getChatIdFn ? getChatIdFn() : 'default';
    pipelineRunning = true;
    try {
        const result = await executeIncrementalUpdate(chatId, batch);
        var latestVault = result.vault;
        if (result.added > 0) {
            const consResult = await executeConsolidation(chatId);
            latestVault = consResult.vault;
        }
        if (onVaultUpdateCallback) onVaultUpdateCallback(latestVault);
    } catch (e) {
        console.warn('[NE] Incremental update failed:', e);
        pendingMessages.unshift.apply(pendingMessages, batch);
    } finally {
        pipelineRunning = false;
    }
}

export async function onBeforeGenerate() {
    if (!lastKnownChatId) return;
    chatReady = false;
    await flushPendingMessages();
    const chatId = getChatIdFn ? getChatIdFn() : 'default';
    if (chatId !== lastKnownChatId) {
        console.warn('[NE] Context changed, skipping injection. chatId=' + chatId + ', lastKnownChatId=' + lastKnownChatId);
        return;
    }
    const vault = await read(chatId);
    if (!vault || !vault.content) return;
    var chatMessages = getChatMessagesFn ? getChatMessagesFn() : [];
    try {
        var formatted;
        if (isRetrievalEnabled()) {
            try {
                const { formatSmartContext } = await import('./ui/vault-panel.js');
                var budget = 800;
                try {
                    var raw = localStorage.getItem('ne_settings');
                    if (raw) {
                        var s = JSON.parse(raw);
                        budget = Number(s.memoryBudget) || 800;
                    }
                } catch (e) {}
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
