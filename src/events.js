/**
 * events.js — ST 事件绑定（通过 TH API）
 */
import { executeIncrementalUpdate } from './engine/update.js';
import { executeConsolidation } from './engine/consolidate.js';
import { read } from './vault/store.js';

let getChatIdFn = null;
let getChatMessagesFn = null;
let onVaultUpdateCallback = null;
let pendingMessages = [];
const MEMORY_BATCH_SIZE = 10;
const MEMORY_FORCE_WORDS = 500;

export function setContextFns(getChatId, getChatMessages) {
    getChatIdFn = getChatId;
    getChatMessagesFn = getChatMessages;
}
export function onVaultUpdate(cb) { onVaultUpdateCallback = cb; }

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
    }
}

export async function onBeforeGenerate() {
    await flushPendingMessages();
    const chatId = getChatIdFn ? getChatIdFn() : 'default';
    const vault = await read(chatId);
    if (!vault || !vault.content) return;
    try {
        const { formatVaultForPrompt } = await import('./ui/vault-panel.js');
        const formatted = formatVaultForPrompt(vault);
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
}
