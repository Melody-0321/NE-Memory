/**
 * engine/contradiction.js — 生成后矛盾检测
 *
 * 在 AI 回复生成后，检测回复中是否存在与记忆库矛盾的事实主张。
 * 若检测到矛盾且设置启用：将原文证据注入上下文并触发 LLM 重新生成。
 *
 * 设计原则：
 *   - 默认关闭（UI 开关控制）
 *   - 阻塞式：矛盾时阻止发送 → 注入证据 → LLM 重新生成
 *   - 最多重试 1 次（防无限循环）
 *   - 非流式路径优先（MESSAGE_RECEIVED 在 addOneMessage 之前触发）
 */

import { read } from '../vault/store.js'
import { filterCandidates } from '../vault/retrieval-filter.js'
import { callMemoryLLM } from '../api/llm.js'

/**
 * 检测 AI 回复中是否存在与记忆库矛盾的事实主张
 * @param {string} chatId - 聊天 ID
 * @param {string} aiMessage - AI 回复文本
 * @returns {object} {hasContradiction, contradictions: [{claim, evidence, correction}], systemMessage}
 */
export async function detectContradictions(chatId, aiMessage) {
    if (!aiMessage || typeof aiMessage !== 'string' || aiMessage.trim().length === 0) {
        return { hasContradiction: false, contradictions: [], systemMessage: '' }
    }

    var vault
    try {
        vault = await read(chatId)
    } catch (e) {
        return { hasContradiction: false, contradictions: [], systemMessage: '' }
    }

    if (!vault || !vault.content) {
        return { hasContradiction: false, contradictions: [], systemMessage: '' }
    }

    var content = vault.content
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || [])
    var allLTM = content.ltm_entries || []

    if (allSTM.length === 0 && allLTM.length === 0) {
        return { hasContradiction: false, contradictions: [], systemMessage: '' }
    }

    // ── 阶段 1: 从 AI 回复中提取事实主张 ──
    var claims
    try {
        claims = await extractClaims(aiMessage)
    } catch (e) {
        return { hasContradiction: false, contradictions: [], systemMessage: '' }
    }

    if (!claims || claims.length === 0) {
        return { hasContradiction: false, contradictions: [], systemMessage: '' }
    }

    // ── 阶段 2: 对每个主张做 BM25 记忆检索 ──
    var contradictions = []
    for (var i = 0; i < claims.length; i++) {
        var claim = claims[i]
        if (!claim.entity || !claim.assertion) continue

        // 构建检索查询：实体名 + 断言关键信息
        var searchQuery = claim.entity + ' ' + (claim.assertion || '')
        var candidates
        try {
            candidates = await filterCandidates(searchQuery, allSTM, allLTM, 10)
        } catch (e) {
            continue
        }
        if (!candidates || candidates.length === 0) continue

        // ── 阶段 3: LLM 矛盾判定 ──
        var verdict
        try {
            verdict = await verifyClaim(claim, candidates)
        } catch (e) {
            continue
        }

        if (verdict && verdict.contradicts) {
            contradictions.push({
                claim: claim,
                evidence: verdict.evidence || '',
                correction: verdict.correction || ''
            })
        }
    }

    if (contradictions.length === 0) {
        return { hasContradiction: false, contradictions: [], systemMessage: '' }
    }

    // ── 构建矛盾证据系统消息 ──
    var systemMessage = buildContradictionSystemMessage(contradictions)
    return { hasContradiction: true, contradictions: contradictions, systemMessage: systemMessage }
}

/**
 * 从 AI 回复中提取事实主张
 */
async function extractClaims(aiMessage) {
    var prompt = [
        {
            role: 'system',
            content: 'Extract factual claims from the text. Each claim is an entity-assertion pair. Output ONLY JSON: {"claims":[{"entity":"EntityName","assertion":"what is claimed about this entity","confidence":0.0-1.0}]}. Ignore emotional expressions, greetings, questions, and purely dialogic content. Only extract claims about entities (people, places, items, events) that have concrete factual content. If no factual claims exist, return {"claims":[]}.'
        },
        {
            role: 'user',
            content: aiMessage.substring(0, 2000)
        }
    ]

    var result = await callMemoryLLM(prompt, { timeout: 5, temperature: 0.0 })
    if (!result) return []

    var jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return []

    try {
        var parsed = JSON.parse(jsonMatch[0])
        var claims = parsed.claims || []
        // 过滤低置信度主张
        return claims.filter(function(c) {
            return c.entity && c.assertion && (c.confidence === undefined || c.confidence >= 0.6)
        })
    } catch (e) {
        return []
    }
}

/**
 * 验证单个主张是否与候选记忆矛盾
 */
async function verifyClaim(claim, candidates) {
    var candidatesText = candidates.map(function(c, i) {
        var timePart = (c.time_range || c.period || '')
        if (c.time_label) timePart = timePart + '·' + c.time_label
        return (i + 1) + '. [' + timePart + '] ' + (c.scene || '') + ': ' + (c.title || c.event || c.summary || '')
    }).join('\n')

    var prompt = [
        {
            role: 'system',
            content: 'Verify if an AI claim contradicts stored memories. Output ONLY JSON: {"contradicts":true/false,"evidence":"relevant memory text","correction":"corrected statement if contradicted, empty if consistent","reason":"brief explanation"}. A contradiction exists only when the claim directly conflicts with a stored memory (e.g., claim says "first met at tavern" but memory shows prior meeting). Different phrasing of same facts, minor omissions, or differences in narrative style are NOT contradictions.'
        },
        {
            role: 'user',
            content: 'Claim about "' + claim.entity + '": ' + claim.assertion + '\n\nStored memories:\n' + candidatesText.substring(0, 3000)
        }
    ]

    var result = await callMemoryLLM(prompt, { timeout: 5, temperature: 0.0 })
    if (!result) return { contradicts: false }

    var jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { contradicts: false }

    try {
        return JSON.parse(jsonMatch[0])
    } catch (e) {
        return { contradicts: false }
    }
}

/**
 * 构建矛盾证据系统消息
 */
function buildContradictionSystemMessage(contradictions) {
    var lines = [
        '[NE-Memory Contradiction Alert]',
        'The response above contains factual claims that contradict stored memory evidence. You MUST regenerate your response, correcting the following:',
        ''
    ]

    contradictions.forEach(function(c, i) {
        lines.push((i + 1) + '. Claim: "' + c.claim.entity + '": ' + c.claim.assertion)
        if (c.evidence) lines.push('   Stored evidence: ' + c.evidence)
        if (c.correction) lines.push('   Correction: ' + c.correction)
        lines.push('')
    })

    lines.push('Regenerate your full response with the corrected facts. Maintain the same tone and style, but use accurate information.')
    return lines.join('\n')
}
