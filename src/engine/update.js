/**
 * engine/update.js — 增量更新引擎
 *
 * 核心循环：收集已处理 msg_id → 过滤新消息 → 构建 prompt → 调用 LLM → 解析 STM → 追加
 */
import { read, appendSTMEntries } from '../vault/store.js';
import { saveSnapshot } from '../vault/versions.js';
import { callMemoryLLM } from '../api/llm.js';

export async function saveVaultWithSnapshot(chatId, vault) {
    const { write } = await import('../vault/store.js');
    vault.version = (vault.version || 0) + 1;
    vault.updated_at = new Date().toISOString();
    await write(chatId, vault);
    await saveSnapshot(chatId, vault);
}

export function collectProcessedMsgIds(vault) {
    const ids = new Set();
    const content = vault.content || {};
    const allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || []);
    allSTM.forEach(stm => (stm.msg_ids || []).forEach(id => ids.add(id)));
    return ids;
}

export function filterNewMessages(messages, processedIds) {
    return messages.filter(m => {
        const id = m.id || m.mes_id;
        return id !== undefined && !processedIds.has(id);
    });
}

export function buildSTMUpdatePrompt(newMessages, vault) {
    const content = vault.content || {};
    const lang = content.language === 'en' ? 'en' : 'zh';
    const msgTexts = newMessages.map(m => {
        const role = m.role === 'user' ? 'User' : 'Character';
        const name = m.name ? m.name + ': ' : '';
        return `[${role}] ${name}${m.content || ''}`;
    }).join('\n\n');

    if (lang === 'en') {
        return {
            system: `You are a story memory extractor. Your task is to extract key events from the conversation into short-term memory entries.

Output ONLY a JSON array of STM entries. Each entry must have:
- "period": narrative phase label (max 15 chars)
- "scene": location/scene name (max 20 chars)
- "event": what happened (max 120 chars)
- "time_label": time tag (max 8 chars)

Be extremely concise. Telegraph-style. Do not include filler words.
If nothing of narrative significance happened, output [].`,
            user: `New conversation messages:\n\n${msgTexts}\n\nExtract key events. Output ONLY JSON array.`
        };
    }
    return {
        system: `你是故事记忆提取器。从对话中提取关键事件到短期记忆中。

仅输出 JSON 数组。每个条目包含：
- "period": 叙事阶段标签（最长15字）
- "scene": 场景名称（最长20字）
- "event": 事件描述（最长120字）
- "time_label": 时间标签（最长8字）

极度简洁，电报式。无填充词。
如果没有叙事意义的事件，输出 []。`,
        user: `新对话消息：\n\n${msgTexts}\n\n提取关键事件。仅输出 JSON 数组。`
    };
}

export function parseSTMResponse(llmResponse) {
    try {
        const text = String(llmResponse || '').trim();
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) return parsed;
        }
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {}
        return text.length > 5 ? [{ event: text.substring(0, 120), scene: '', period: '', time_label: '' }] : [];
    } catch (e) {
        return [];
    }
}

export async function executeIncrementalUpdate(chatId, newMessages) {
    const vault = await read(chatId);
    const processedIds = collectProcessedMsgIds(vault);
    const filteredMessages = filterNewMessages(newMessages, processedIds);
    if (filteredMessages.length === 0) return { vault, added: 0 };
    const prompt = buildSTMUpdatePrompt(filteredMessages, vault);
    const response = await callMemoryLLM([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
    const stmEntries = parseSTMResponse(response);
    if (stmEntries.length === 0) return { vault, added: 0 };
    const perEntry = Math.max(1, Math.floor(filteredMessages.length / stmEntries.length));
    stmEntries.forEach((entry, i) => {
        const startIdx = i * perEntry;
        const endIdx = (i === stmEntries.length - 1) ? filteredMessages.length : (i + 1) * perEntry;
        entry.msg_ids = filteredMessages.slice(startIdx, endIdx).map(m => m.id || m.mes_id).filter(Boolean);
        entry.timestamp = new Date().toISOString();
        entry.parent_ltm = null;
    });
    const added = appendSTMEntries(vault, stmEntries);
    await saveVaultWithSnapshot(chatId, vault);
    return { vault, added };
}
