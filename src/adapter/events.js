/**
 * events.js — ST 事件绑定（通过 TH API）
 */
import { executeIncrementalUpdate, extractStateChangesOnly, runLtmDecision, saveVaultWithSnapshot } from '../core/engine/update.js';
import { findOpenLtm, MAX_OPEN_STM_REFS } from '../core/engine/consolidate.js';
import { read, write, rollbackByMsgIds } from '../core/vault/store.js';
import { incrementChatTurn, recordChatStat, recordChatToken, getChatTurnNumber } from '../core/engine/chat-telemetry.js';
import { recordDailyToken } from '../core/engine/token-stats.js';
import { runtime } from '../core/runtime.js';
import { showToast, PD } from './panel-shared.js';
import { detectContradictions } from '../core/engine/contradiction.js';
import { closeVaultOverlay } from './panel.js';
import { computeWindowStartMsgId } from '../core/engine/context-window.js';
import { formatSmartContext, buildStateOnlyInjection } from '../core/engine/injection.js';
import { buildStateInjectionTable } from '../core/vault/schema.js';
import { countTokens } from '../core/engine/text-utils.js';
import { isAuto, computeStmBatch, getTelemetryStats, recordTelemetry } from '../core/params.js';
import { isStateSchemaEnabled, ensureCharacterTemplate } from '../core/vault/schema.js';
import { getNextEligibleStmId, runLtmRebatch, applyLtmDecision, createMinimalLtm } from '../core/engine/consolidate.js';
import { callMemoryPipeline } from '../core/api/llm.js';
import { tryAcquire, transitionTo, releasePipeline, isIdle, getPipelinePhase, getState, reset, waitForPipelineTrackIdle } from '../core/engine/pipeline-guard.js';
import { t_narrative } from '../core/i18n.js';

var MEMORY_INJECTION_WRAPPER = [
    '[以下是你在故事中积累的记忆，按实体分链组织。]',
    '',
    '每条实体链顶部的 [KB: 角色=等级] 标明了各角色对该链事件的知晓程度。',
    '当你扮演某个角色或从这个角色的视角写作时，只能写出该角色知情的内容：',
    '  直接知晓 — 该角色亲身经历了该事件，可以自由谈论或回忆',
    '  间接知晓 — 该角色通过转述或推断得知，可提及但保持细节不确定性',
    '  线索     — 该角色只有碎片信息，只能模糊或不确指地提及',
    '  链中未列出的角色 — 该角色对此事完全不知情：不要从其口中说出，也不要从其内心视角呈现',
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
const PIPELINE_TIMEOUT_MS = 30000;
let lastGenerationTime = 0;

function persistPending() {
    try { localStorage.setItem('ne_pending', JSON.stringify(pendingMessages)); } catch (e) { console.warn('[NE] persistPending failed:', e.message); }
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
function computeContextPressure(pendingTokenCount, pendingMessages, chatMessages) {
    if (!runtime.maxContext) return -1;
    var maxCtx = runtime.maxContext;
    if (!maxCtx || maxCtx <= 0) return -1;

    var tokenPressure = 0;
    var usable = maxCtx - 1500 - lastMemoryInjectionTokens;
    if (usable > 0) {
        tokenPressure = pendingTokenCount / usable;
    } else {
        tokenPressure = 1;
    }

    var turnPressure = 0;
    if (chatMessages && pendingMessages && pendingMessages.length > 0) {
        var cwRounds = 10;
        try { var rawC = localStorage.getItem('ne_settings'); if (rawC) { var sC = JSON.parse(rawC); cwRounds = Number(sC.dialogWindowRounds) || 10; } } catch (eC) {}
        var windowStartId = computeWindowStartMsgId(chatMessages, cwRounds);
        var outOfWindowCount = 0;
        for (var i = 0; i < pendingMessages.length; i++) {
            var msgId = pendingMessages[i].mes_id || pendingMessages[i].id || 0;
            if (msgId > 0 && msgId < windowStartId) outOfWindowCount++;
        }
        if (cwRounds > 0 && outOfWindowCount > 0) {
            turnPressure = Math.min(1, outOfWindowCount / Math.max(1, cwRounds));
        }
    }

    return Math.max(tokenPressure, turnPressure);
}
function adjustDialogWindow() {
    var cwRounds = 10;
    try { var raw = localStorage.getItem('ne_settings'); if (raw) { var s = JSON.parse(raw); cwRounds = Number(s.dialogWindowRounds) || 10; } } catch (e) {}
    var minRounds = 6;
    if (cwRounds < minRounds) cwRounds = minRounds;

    var chat = runtime.getChat ? runtime.getChat() : [];
    if (!chat || chat.length === 0) return;

    var overrideEnabled = false;
    try { var raw2 = localStorage.getItem('ne_settings'); if (raw2) { var s2 = JSON.parse(raw2); overrideEnabled = !!s2.dialogOverrideEnabled; } } catch (e) {}
    if (overrideEnabled) {
        runtime.maxContext = Number.MAX_SAFE_INTEGER;
    }

    var windowStartId = computeWindowStartMsgId(chat, cwRounds);
    if (windowStartId <= 0) return;

    for (var i = 0; i < chat.length; i++) {
        var m = chat[i];
        if ((m.mes_id || 0) > windowStartId) {
            if (i > 0) chat.splice(0, i);
            return;
        }
    }
}
export function notifyVaultChanged() {
    try {
        PD.dispatchEvent(new CustomEvent('ne:vault-changed'));
    } catch (e) { console.warn('[NE] notifyVaultChanged failed:', e.message); }
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

async function consumeNeCharBlocks(messageIndex) {
    var pending = globalThis.__ne_pending_char_blocks;
    if (!pending || pending.length === 0) return;
    globalThis.__ne_pending_char_blocks = null;
    try {
        var chatId = getChatIdFn ? getChatIdFn() : 'default';
        var vault = await read(chatId);
        if (!vault || !vault.content) {
            console.log('[NE-DEBUG] consumeNeCharBlocks: vault empty, skip');
            return;
        }
        var charState = vault.content.state || {};
        var charBefore = charState.characters || {};
        var affectedKeys = Object.keys(charBefore);
        var summaryBefore = {};
        pending.forEach(function(cb) {
            if (!cb.name || !cb.fields) return;
            var c = charBefore[cb.name];
            summaryBefore[cb.name] = c ? JSON.stringify({ affection: c.affection, relationship: c.relationship, current_mood: c.current_mood, inner_thoughts: c.inner_thoughts }) : 'NEW';
        });
        console.log('[NE-DEBUG] consumeNeCharBlocks START: pending=' + pending.length +
            ' | charState keys=' + affectedKeys.join(',') +
            ' | before=' + JSON.stringify(summaryBefore));

        pending.forEach(function(cb) {
            if (!cb.name || !cb.fields) return;
            var chars = charState.characters || {};
            if (!chars[cb.name]) {
                var schemeLookup = charState._character_schemes && charState._character_schemes[cb.name];
                var schemeKey = schemeLookup ? schemeLookup._scheme : null;
                ensureCharacterTemplate(charState, cb.name, schemeKey);
                chars = charState.characters;
                chars[cb.name]._role = (cb.name === charState.protagonist_name || (schemeLookup && schemeLookup._role === 'protagonist')) ? 'protagonist' : ((schemeLookup && schemeLookup._role) || 'npc');
                if (schemeLookup && schemeLookup._scheme) chars[cb.name]._scheme = schemeLookup._scheme;
            }
            if (!chars[cb.name]) chars[cb.name] = {};

            if (cb.fields.affection_delta !== undefined) {
                var current = chars[cb.name].affection;
                if (typeof current !== 'number') current = 0;
                chars[cb.name].affection = Math.max(0, Math.min(100, current + Number(cb.fields.affection_delta)));
            }

            ['relationship', 'current_mood', 'inner_thoughts'].forEach(function(fk) {
                if (cb.fields[fk] !== undefined && cb.fields[fk] !== '') {
                    chars[cb.name][fk] = cb.fields[fk];
                }
            });

            chars[cb.name].status = chars[cb.name].status || '活跃';
            console.log('[NE-DEBUG] consumeNeCharBlocks MERGED: ' + cb.name + ' -> ' + JSON.stringify(cb.fields));
        });

        if (messageIndex !== undefined) {
            var cache = globalThis.__ne_inner_thoughts_cache || {};
            pending.forEach(function(cb) {
                if (!cb.name || !cb.fields || !cb.fields.inner_thoughts) return;
                var thoughts = cache[cb.name] || [];
                thoughts.push({ msgIdx: messageIndex, content: cb.fields.inner_thoughts });
                cache[cb.name] = thoughts;
            });
            globalThis.__ne_inner_thoughts_cache = cache;
        }
        charState.characters = charState.characters;
        vault.content.state = charState;
        await saveVaultWithSnapshot(chatId, vault);
        var summaryAfter = {};
        Object.keys(charState.characters || {}).forEach(function(n) {
            var c = charState.characters[n];
            summaryAfter[n] = JSON.stringify({ affection: c.affection, relationship: c.relationship, current_mood: c.current_mood, inner_thoughts: c.inner_thoughts });
        });
        console.log('[NE-DEBUG] consumeNeCharBlocks DONE, after=' + JSON.stringify(summaryAfter));
    } catch (e) {
        console.warn('[NE-CHAR] consumeNeCharBlocks failed:', e && e.message);
    }
}

export async function onMessageReceived(messageIndex) {
    try {
        if (!getChatMessagesFn) return;
        var chatId = getChatIdFn ? getChatIdFn() : 'default';
        const chat = getChatMessagesFn();
        var message = chat[messageIndex];
        if (!message) { message = chat.find(function (m) { return m.mes_id === messageIndex; }); }
        if (message) {

            var rawMes = message.mes || '';
            var hasNeChar = rawMes.indexOf('<!--NE-CHAR') !== -1;
            var hasNeBanner = rawMes.indexOf('<!--NE-BANNER') !== -1;
            console.log('[NE-DEBUG] onMessageReceived msgId=' + (message.mes_id || messageIndex) +
                ' | len=' + rawMes.length +
                ' | hasNE-CHAR=' + hasNeChar +
                ' | hasNE-BANNER=' + hasNeBanner +
                ' | raw_preview=' + JSON.stringify(rawMes.substring(0, 200)));

            var assistantMsg = { role: 'assistant', content: rawMes, id: messageIndex, timestamp: Date.now() };

            // 提取 Main LLM 开头的状态栏（管道分隔：场景|时间|天数|事件|角色）
            var stateBlockMatch = rawMes.match(
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
                console.log('[NE-DEBUG] stateBlock EXTRACTED: scene=' + stateBlockMatch[1] +
                    ' time=' + stateBlockMatch[2] + ' day=' + stateBlockMatch[3] +
                    ' event=' + stateBlockMatch[4] + ' present=' + stateBlockMatch[5]);
            } else {
                console.log('[NE-DEBUG] stateBlock NOT matched (hasNE-BANNER=' + hasNeBanner + ')');
            }

            var charBlockRegex = /<!--NE-CHAR:([^-]+?)-{2,3}>(\{[\s\S]*?\})<!--\/NE-CHAR-->/g;
            var charBlockMatch;
            var newCharBlocks = [];
            while ((charBlockMatch = charBlockRegex.exec(rawMes)) !== null) {
                var charName = (charBlockMatch[1] || '').trim();
                var charJson = (charBlockMatch[2] || '').trim();
                try {
                    var charData = JSON.parse(charJson);
                    newCharBlocks.push({ name: charName, fields: charData });
                    console.log('[NE-DEBUG] charBlock EXTRACTED: name=' + charName + ' fields=' + JSON.stringify(charData));
                } catch (e) {
                    console.warn('[NE-DEBUG] charBlock regex matched but JSON parse FAILED: name=' + charName + ' json=' + charJson.substring(0, 200) + ' error=' + e.message);
                }
            }
            console.log('[NE-DEBUG] charBlock extraction summary: hasNE-CHAR=' + hasNeChar +
                ' | extracted=' + newCharBlocks.length +
                ' | regex_matches=' + ((rawMes.match(/<!--NE-CHAR/g) || []).length) +
                ' | raw block preview=' + JSON.stringify(rawMes.substring(
                    Math.max(0, rawMes.indexOf('<!--NE-CHAR') - 10),
                    Math.min(rawMes.length, rawMes.indexOf('<!--NE-CHAR') + 120))));
            if (newCharBlocks.length > 0) {
                globalThis.__ne_pending_char_blocks = (globalThis.__ne_pending_char_blocks || []).concat(newCharBlocks);
                globalThis.__ne_char_fallback_needed = false;
            } else {
                var hasNECharTag = /<!--NE-CHAR/.test(rawMes);
                if (hasNECharTag) {
                    console.warn('[NE-CHAR] Main LLM output NE-CHAR tag but 0 blocks extracted (JSON parse failed?) — rawMes NE-CHAR tags=' + (rawMes.match(/<!--NE-CHAR/g) || []).length);
                } else {
                    var state = (globalThis.__ne_vault_cache && globalThis.__ne_vault_cache.content && globalThis.__ne_vault_cache.content.state) || {};
                    var activeNPCs = [];
                    if (state.characters) {
                        Object.keys(state.characters).forEach(function(n) {
                            var c = state.characters[n];
                            if (c && c._role !== 'protagonist' && c.status === '活跃') activeNPCs.push(n);
                        });
                    }
                    console.warn('[NE-CHAR] Main LLM did NOT output any NE-CHAR block. ' +
                        'Active NPCs (' + activeNPCs.length + '): ' + activeNPCs.join(', ') + '. ' +
                        'Falling back to State LLM for affection/mood/thoughts inference.');
                }
                globalThis.__ne_char_fallback_needed = true;
            }

            // ── NE-CHAR 剥离监测：在 ST 全局正则之前自行剥离并记录 ──
            var stripRegex = /<!--NE-CHAR:([^-]+?)-{2,3}>\{[\s\S]*?\}<!--\/NE-CHAR-->/g;
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
                console.log('[NE-DEBUG] stripped ' + stripCount + ' NE-CHAR block(s): ' + strippedNames.join(', ') +
                    ' | original rawMes NE-CHAR tags=' + (rawMes.match(/<!--NE-CHAR/g) || []).length);
            }

            await consumeNeCharBlocks(messageIndex);

            pendingMessages.push(assistantMsg);
            persistPending();
            console.log('[NE] onMessageReceived: pending=' + pendingMessages.length);

            var pendingTokenCount = pendingMessages.reduce(function(s, m) { return s + countTokens(m.content || ''); }, 0);
            var chatMessages = runtime.getChat ? runtime.getChat() : [];
            var pressureVal = computeContextPressure(pendingTokenCount, pendingMessages, chatMessages);
            var shouldRunPipeline = pendingMessages.length >= await getStmBatchSize()
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

export async function runLtmConsolidation(chatId) {
    var MAX_LTM_PASSES = 20;
    var ranLtm = false;
    for (var ltmPass = 0; ltmPass < MAX_LTM_PASSES; ltmPass++) {
        var postStmVault = await read(chatId);
        if (!postStmVault || !postStmVault.content) return;

        var nextId = getNextEligibleStmId(postStmVault);
        if (nextId === null) {
            if (ltmPass === 0) {
                var uncCount = ((postStmVault.content || {}).unconsolidated_stm || []).filter(function(s) { return s.parent_ltm === undefined; }).length;
                var threshold2 = (function() { try { var r = localStorage.getItem('ne_settings'); if (r) { var s2 = JSON.parse(r); return Number(s2.stmMaxUnconsolidated) || 5; } } catch(e) {} return 5; })();
                console.log('[NE] LTM: no eligible STM — unconsolidated=' + uncCount + ' threshold=' + threshold2);
            }
            break;
        }

        if (!tryAcquire('ltm')) {
            console.log('[NE] LTM pass ' + (ltmPass+1) + ': waiting for pipeline track — state=' + getState());
            await waitForPipelineTrackIdle(PIPELINE_TIMEOUT_MS);
            if (!tryAcquire('ltm')) {
                console.log('[NE] LTM: guard still blocked, deferring remaining passes');
                break;
            }
        }
        console.log('[NE-GUARD] acquire ltm (idle → ltm) — pass ' + (ltmPass+1) + ', stm=' + nextId);

        ranLtm = true;
        var openLtm = findOpenLtm(postStmVault);
        var forceClose = openLtm && (openLtm.stm_refs || []).length >= MAX_OPEN_STM_REFS - 1;
        if (forceClose) console.log('[NE] LTM: open arc approaching ref limit (' + (openLtm.stm_refs.length + 1) + '/' + MAX_OPEN_STM_REFS + '), will prompt LLM for title/event this round');
        var ltmDecision = null;
        var maxRetries = 3;

        for (var retry = 0; retry < maxRetries; retry++) {
            try {
                ltmDecision = await runLtmDecision(postStmVault, [nextId], callMemoryPipeline, forceClose);
                if (ltmDecision) break;
            } catch (e) {
                console.warn('[NE] LTM pass ' + (ltmPass+1) + ' attempt ' + (retry+1) + ' failed:', e);
            }

            if (ltmDecision === null && retry < maxRetries - 1) {
                var delay = Math.min(Math.pow(2, retry) * 1000, 8000);
                console.log('[NE] LTM retry #' + (retry+1) + ' for ' + nextId + ' in ' + delay + 'ms');
                await new Promise(function(r) { setTimeout(r, delay); });
                postStmVault = await read(chatId);
            }
        }

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
        } else {
            console.warn('[NE] LTM: all retries failed for ' + nextId + ', applying fallback');
            var fallbackDecision = createMinimalLtm(postStmVault, nextId);
            if (fallbackDecision) {
                applyLtmDecision(postStmVault, fallbackDecision, [nextId]);
                try { await saveVaultWithSnapshot(chatId, postStmVault); } catch (e) {
                    console.warn('[NE] LTM fallback save failed, rolling back vault');
                    postStmVault = await read(chatId);
                }
                globalThis.__ne_debug_last_ltm_decision = {
                    action: fallbackDecision.action,
                    stmId: nextId,
                    pass: ltmPass + 1,
                    fallback: true,
                    time: new Date().toISOString()
                };
                console.log('[NE] LTM: fallback decision applied — stm=' + nextId);
                notifyVaultChanged();
            } else {
                console.warn('[NE] LTM: fallback also failed for ' + nextId + ', skipping');
            }
        }
        releasePipeline();
        console.log('[NE-GUARD] release pipeline (ltm → idle) — pass ' + (ltmPass+1));

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
}

async function flushPendingMessages() {
    if (!tryAcquire('stm')) {
        console.log('[NE] flushPendingMessages: waiting for state pipeline — state=' + getState());
        await waitForPipelineTrackIdle(PIPELINE_TIMEOUT_MS);
        if (!tryAcquire('stm')) {
            console.log('[NE] flushPendingMessages: guard still blocked after wait, deferring');
            return;
        }
        console.log('[NE] flushPendingMessages: state pipeline done, proceeding');
    }
    try {
    if (pendingMessages.length === 0) return;
    var pendingTokenCount = pendingMessages.reduce(function(s, m) { return s + countTokens(m.content || ''); }, 0);
    var chatMessages = runtime.getChat ? runtime.getChat() : [];
    var pressureVal = computeContextPressure(pendingTokenCount, pendingMessages, chatMessages);
    if (pendingMessages.length < await getStmBatchSize() && pressureVal < 0.50) {
        console.log('[NE] flushPendingMessages: pending=' + pendingMessages.length + ' batch=' + await getStmBatchSize() + ' pressure=' + (pressureVal >= 0 ? (pressureVal * 100).toFixed(0) + '%' : 'N/A') + ' — not enough');
        return;
    }
    const batch = pendingMessages.splice(0);
    persistPending();
    try { localStorage.setItem('ne_inflight', JSON.stringify(batch)); } catch (e) { console.warn('[NE] ne_inflight write failed:', e.message); }
    console.log('[NE] Pipeline starting: batch=' + batch.length);
    var chatId = runtime.getChatId() || 'default';
    var pipelineStart = Date.now();
    if (getChatTurnNumber(chatId) === 0) incrementChatTurn(chatId);
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
    }
    } finally {
        console.log('[NE] Pipeline: releasing guard pipeline (stm)');
        releasePipeline();
        persistPending();

        runLtmConsolidation(chatId).catch(function(e) { console.warn('[NE] LTM BG pipeline failed:', e); });

        if (pendingMessages.length > 0) {
            (async function() {
                var pendingTokenCount = pendingMessages.reduce(function(s, m) { return s + countTokens(m.content || ''); }, 0);
                var chatMessagesDr = runtime.getChat ? runtime.getChat() : [];
                var pressureVal = computeContextPressure(pendingTokenCount, pendingMessages, chatMessagesDr);
                if ((pendingMessages.length >= await getStmBatchSize()
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
        var PROMPT_ID = 'ne-state-prompt';
        var _BANNER_VERSION = '1.3';
        var DISPLAY_NAME = 'NE State Banner v' + _BANNER_VERSION;
        var PROMPT_NAME = 'NE State Prompt Strip v' + _BANNER_VERSION;
        var FIND_PIPE = '<!--NE-BANNER-->([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)<!--\\/NE-BANNER-->';
        var REPLACE_HTML = '\n```banner\n' +
            '\uD83D\uDCCD \u5730\u70B9\uFF1A$1\n' +
            '\u2600\uFE0F \u65F6\u95F4\uFF1A$2\n' +
            '\uD83D\uDCC5 \u5929\u6570\uFF1ADay $3\n' +
            '\u26A1 \u573A\u666F\u63CF\u8FF0\uFF1A$4\n' +
            '\uD83D\uDC64 \u5728\u573A\u89D2\u8272\uFF1A$5\n' +
            '```\n';
        var FIND_PROMPT = '/(?:<!--NE-BANNER-->[^|]*\\\\|[^|]*\\\\|[^|]*\\\\|[^|]*\\\\|[^|]*<!--\\\\/NE-BANNER-->\\\\s*|<!--NE-CHAR:[^-]+-{2,3}>\\\\{[\\\\s\\\\S]*?\\\\}<!--\\\\/NE-CHAR-->)/g';

        var BANNER_DISPLAY_PATTERN = /^ne-state-banner(?:-v\d+)?$/;
        var PROMPT_PATTERN = /^(?:ne-state-banner-prompt(?:-v\d+)?|ne-state-prompt(?:-v\d+)?|ne-char-block-prompt(?:-v\d+)?)$/;

        var displayCandidates = [];
        var promptCandidates = [];
        for (var i = 0; i < es.regex.length; i++) {
            var rid = es.regex[i].id || '';
            if (BANNER_DISPLAY_PATTERN.test(rid)) displayCandidates.push(i);
            if (PROMPT_PATTERN.test(rid)) promptCandidates.push(i);
        }

        for (var d = displayCandidates.length - 2; d >= 0; d--) {
            es.regex.splice(displayCandidates[d], 1);
        }
        for (var p = promptCandidates.length - 2; p >= 0; p--) {
            es.regex.splice(promptCandidates[p], 1);
        }

        var displayEntry = null;
        var promptEntry = null;
        for (var j = 0; j < es.regex.length; j++) {
            var jid = es.regex[j].id || '';
            if (BANNER_DISPLAY_PATTERN.test(jid)) displayEntry = es.regex[j];
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

        var CHAR_FIND = '/<!--NE-CHAR:[^-]+-{2,3}>\\{[\\s\\S]*?\\}<!--\\/NE-CHAR-->/g';
        var CHAR_DISPLAY_ID = 'ne-char-block-display';
        var CHAR_DISPLAY_NAME = 'NE Character Block Strip (Display)';
        var CHAR_VERSION = '1.3';

        // Cleanup legacy entries that could strip raw message before onMessageReceived sees it
        for (var ck = es.regex.length - 1; ck >= 0; ck--) {
            var cid = es.regex[ck].id || '';
            if (cid === 'ne-char-block-strip' || cid === 'ne-char-block-prompt') {
                es.regex.splice(ck, 1);
                updatedCount++;
                console.log('[NE-BANNER] removed legacy regex entry: ' + cid);
            }
        }

        // Display-only strip: removes CHAR blocks from UI rendering (our onMessageReceived extraction runs first on rawMes)
        var charDisplayEntry = null;
        for (var cd = 0; cd < es.regex.length; cd++) {
            if (es.regex[cd].id === CHAR_DISPLAY_ID) { charDisplayEntry = es.regex[cd]; break; }
        }
        if (!charDisplayEntry || charDisplayEntry._neVersion !== CHAR_VERSION) {
            if (!charDisplayEntry) {
                charDisplayEntry = { id: CHAR_DISPLAY_ID };
                es.regex.push(charDisplayEntry);
            }
            charDisplayEntry.id = CHAR_DISPLAY_ID;
            charDisplayEntry.scriptName = CHAR_DISPLAY_NAME;
            charDisplayEntry.findRegex = CHAR_FIND;
            charDisplayEntry.replaceString = '';
            charDisplayEntry.enabled = true;
            charDisplayEntry.runOnEdit = false;
            charDisplayEntry.markdownOnly = true;
            charDisplayEntry.promptOnly = false;
            charDisplayEntry.placement = [2];
            charDisplayEntry.substituteRegex = 0;
            charDisplayEntry.minDepth = null;
            charDisplayEntry.maxDepth = null;
            charDisplayEntry.onlyLongerThan = null;
            charDisplayEntry.onlyShorterThan = null;
            charDisplayEntry.trimStrings = [];
            charDisplayEntry._neVersion = CHAR_VERSION;
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
            showToast('NE State Banner updated to v' + _BANNER_VERSION + ' (' + updatedCount + ' entries)', 'success');
            console.log('[NE-BANNER] Updated to v' + _BANNER_VERSION + ' (' + updatedCount + ' entries)');
        }
        return true;
    } catch (e) {
        console.error('[NE-BANNER] Failed to register global regex:', e);
        return false;
    }
}

export { registerGlobalBannerRegex };

export async function onBeforeGenerate(type, _options, dryRun) {
    var entryNow = Date.now();
    console.log('[NE-DEBUG] onBeforeGenerate ENTRY type=' + type + ' dryRun=' + dryRun + ' _isInjecting=' + _isInjecting +
        ' lastKnownChatId=' + lastKnownChatId + ' lastGenerationTime=' + lastGenerationTime +
        ' elapsed=' + (entryNow - lastGenerationTime) + 'ms');
    // ST 的 PromptManager 在页面加载/config变更时调用 Generate(type, {}, true)
    // 做 dry run 以获取 token 计数。dry run 走完整 prompt 组装但不调 API，
    // 但会触发 GENERATION_AFTER_COMMANDS 事件。各扩展应检测并跳过，避免副作用。
    if (dryRun) {
        console.log('[NE-DEBUG] onBeforeGenerate EXIT: dry run');
        return;
    }
    // 重入守卫：generateRaw/generateQuietPrompt 内部会调用 ST 的 Generate()，
    // 从而触发新的 GENERATION_AFTER_COMMANDS → onBeforeGenerate，形成级联。
    // 此守卫拦截所有重入调用，斩断级联链。
    if (_isInjecting) {
        console.log('[NE-DEBUG] onBeforeGenerate EXIT: re-entrant blocked (_isInjecting=true)');
        return;
    }
    _isInjecting = true;
    try {
        // Skip non-content generations: impersonate (AI帮答), quiet, continue
        if (type && (type === 'impersonate' || type === 'quiet' || type === 'continue')) {
            console.log('[NE-DEBUG] onBeforeGenerate EXIT: type=' + type);
            return;
        }
        if (!lastKnownChatId) { console.log('[NE-DEBUG] onBeforeGenerate EXIT: no lastKnownChatId'); return; }
        var now = Date.now();
        if (now - lastGenerationTime < MIN_GENERATION_INTERVAL_MS) {
            console.log('[NE-DEBUG] onBeforeGenerate EXIT: debounce — elapsed=' + (now - lastGenerationTime) + 'ms < ' + MIN_GENERATION_INTERVAL_MS + 'ms');
            return;
        }
        lastGenerationTime = now;

        const chatId = getChatIdFn ? getChatIdFn() : 'default';
        if (chatId !== lastKnownChatId) {
            lastKnownChatId = chatId;
            pendingMessages = [];
        }
        const vault = await read(chatId);
        if (!vault || !vault.content) { console.log('[NE] onBeforeGenerate skipped: no vault content'); return; }
        incrementChatTurn(chatId);
        console.log('[NE-DEBUG] onBeforeGenerate PASSED guards, proceeding to injection — ts=' + now + ' stm=' + ((vault.content.stm_entries || []).length + (vault.content.unconsolidated_stm || []).length) + ', ltm=' + (vault.content.ltm_entries || []).length);
        var chatMessages = runtime.getChat ? runtime.getChat() : [];
        adjustDialogWindow();
        var ctx = typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext() : null;
        var stateProtoName = (vault.content.state && vault.content.state.protagonist_name) || '';
        var ctxName1 = (ctx && ctx.name1) || null;
        if (vault.content.state) {
            if (!stateProtoName && ctxName1) {
                vault.content.state.protagonist_name = ctxName1;
                stateProtoName = ctxName1;
            }
        }
        var protagonistName = stateProtoName || ctxName1;
        var neSettings = {};
        try { var raw = localStorage.getItem('ne_settings'); if (raw) neSettings = JSON.parse(raw); } catch (e) {}

        // State table injection — independent from SmartPush
        if (isStateSchemaEnabled()) {
            var content = vault.content || {};
            var state = content.state || {};
            var stateTable = buildStateInjectionTable(state, chatMessages, undefined, content);
            if (stateTable) {
                globalThis.__ne_debug_last_state_table = stateTable;
                runtime.injectPrompt('ne_state_table', stateTable, 'in_chat', 2, 'system');
            }
        }

        // Write faction state for test monitor
        if (vault.content.state && vault.content.state.factions) {
            var f2 = vault.content.state.factions;
            var fnames = Object.keys(f2);
            var fhidden = fnames.filter(function(n) { return f2[n]._hidden; });
            var fvisible = fnames.filter(function(n) { return !f2[n]._hidden; });
            globalThis.__ne_debug_last_faction_state = { total: fnames.length, hidden: fhidden, visible: fvisible, names: fnames };
        }

        try {
            var formatted;
            try {
                formatted = await formatSmartContext(vault, chatMessages, null, chatId);
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
                runtime.injectPrompt('ne_memory_vault', formatted, 'in_chat', 3, 'system');
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
                console.log('[NE-DEBUG] onBeforeGenerate: ne_state_block injected, dayInfo=' + dayInfo + ' scene=' + (sceneInfo || '(none)') + ' time=' + (timePreview || '') + ' isSchemaEnabled=true');

                var protagonistName = (vault.content.state && vault.content.state.protagonist_name) || '';

                var charBlockInstr = '\u5728\u672c\u8f6e\u56de\u590d\u672b\u5c3e\u8f93\u51fa\u6d3b\u8dc3\u89d2\u8272\uff08\u672c\u8f6e\u6709\u53f0\u8bcd\u6216\u4e92\u52a8\u7684\u89d2\u8272\uff09\u7684\u597d\u611f\u5ea6\u53d8\u5316\u548c\u5185\u5fc3\u72b6\u6001\uff1a\n' +
                    '\n- PC\uff08\u4f60\u626e\u6f14\u7684\u4e3b\u89d2\uff09' + (protagonistName ? ': ' + protagonistName : '') + ' \u2014 \u53ef\u7528\u5b57\u6bb5: current_mood, inner_thoughts\n' +
                    '- NPC\uff08\u5176\u4ed6\u89d2\u8272\uff09\u2014 \u53ef\u7528\u5b57\u6bb5: affection_delta, relationship, current_mood, inner_thoughts\n' +
                    '\n\u683c\u5f0f\uff1a\n' +
                    '  <!--NE-CHAR:\u89d2\u8272\u540d-->{"affection_delta":5,"relationship":"\u2026","current_mood":"\u2026","inner_thoughts":"\u2026"}<!--/NE-CHAR-->\n' +
                    '\n\u89c4\u5219\uff1a\n' +
                    '- \u53ea\u6709\u672c\u8f6e\u5b9e\u9645\u53d1\u751f\u4e86\u53d8\u5316\u7684\u89d2\u8272\u624d\u8f93\u51fa NE-CHAR \u5757\u3002\u65e0\u53d8\u5316\u7684\u89d2\u8272\u8df3\u8fc7\u3002\n' +
                    '- affection_delta: \u597d\u611f\u5ea6\u6570\u503c\u53d8\u5316\u91cf\uff08+5 \u8868\u793a\u4e0a\u5347 5\uff0c-10 \u8868\u793a\u4e0b\u964d 10\uff09\u3002\u53ef\u4e3a\u7a7a\uff08\u4ec5\u5f53\u524d\u5fc3\u60c5\u53d8\u5316\u65f6\uff09\u3002\n' +
                    '- relationship: \u5173\u7cfb\u63cf\u8ff0\u3002\u6709\u53d8\u5316\u65f6\u8f93\u51fa\u6700\u65b0\u63cf\u8ff0\u3002\n' +
                    '- current_mood: \u89d2\u8272\u5f53\u524d\u5fc3\u60c5/\u60c5\u7eea\u3002\n' +
                    '- inner_thoughts: \u89d2\u8272\u5185\u5fc3\u60f3\u6cd5\u3002\n' +
                    '- PC \u4e0d\u8f93\u51fa affection_delta \u548c relationship\u3002\n' +
                    '- \u6bcf\u4e2a\u89d2\u8272\u4e00\u4e2a\u72ec\u7acb NE-CHAR \u5757\u3002\n' +
                    '- \u653e\u5728\u56de\u590d\u672b\u5c3e\u3002';
                runtime.injectPrompt('ne_char_block', charBlockInstr, 'in_chat', 0, 'system');
                console.log('[NE-DEBUG] onBeforeGenerate: ne_char_block injected ok, protagonist=' + protagonistName + ' isSchemaEnabled=true');
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
