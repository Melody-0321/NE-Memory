/**
 * engine/ambiguity.js — 模糊引用解析
 *
 * 解析用户消息中的模糊引用（"那个铁匠"、"上次的事"、"那把剑"），
 * 将其映射为具体实体名，以提升 BM25 检索精度和实体链预取质量。
 *
 * 策略：
 *   1. 规则层（始终运行，零成本）：多模式正则匹配 + 已知实体名映射
 *   2. 可选 LM 层（开关控制）：规则无法确定时，轻量 LLM 消歧
 */

import { callMemoryLLM } from '../api/llm.js'

/**
 * 收集所有已知实体名及其属性（用于消歧）
 * @param {object} state - vault state
 * @param {object} content - vault content
 * @returns {Array} [{name, type, occupations, description}]
 */
function collectKnownEntities(state, content) {
    var entities = []
    var characters = state.characters || {}
    Object.keys(characters).forEach(function(name) {
        var card = characters[name]
        if (!card) return
        var entity = { name: name, type: 'character', occupations: [] }
        if (card.occupation) entity.occupations.push(card.occupation)
        if (card.personality) entity.description = card.personality
        entities.push(entity)
    })

    var factions = state.factions || {}
    Object.keys(factions).forEach(function(name) {
        var faction = factions[name]
        if (!faction) return
        entities.push({
            name: name,
            type: 'faction',
            occupations: [],
            description: faction.description || ''
        })
    })

    // 也从 STM entities 标注中收集（非角色/势力的实体，如物品、地点）
    var allSTM = (content.unconsolidated_stm || []).concat(content.stm_entries || [])
    var allLTM = content.ltm_entries || []
    var seenNames = {}
    entities.forEach(function(e) { seenNames[e.name] = true })

    allSTM.concat(allLTM).forEach(function(e) {
        if (e.entities) {
            e.entities.forEach(function(en) {
                if (en.name && !seenNames[en.name]) {
                    seenNames[en.name] = true
                    entities.push({
                        name: en.name,
                        type: en.type || 'character',
                        occupations: [],
                        description: ''
                    })
                }
            })
        }
    })

    return entities
}

/**
 * 规则层：解析用户消息中的模糊引用
 * @param {string} userMessage - 用户消息文本
 * @param {object} state - vault state
 * @param {object} content - vault content
 * @returns {object} {resolved: {[模糊匹配文本]: 实体名}, enhancedQuery: string, lowConfidence: Array}
 */
export function resolveAmbiguousReferences(userMessage, state, content) {
    var resolved = {}
    var enhancedQuery = userMessage
    var lowConfidence = []

    var knownEntities = collectKnownEntities(state, content)
    if (knownEntities.length === 0) {
        return { resolved: resolved, enhancedQuery: enhancedQuery, lowConfidence: lowConfidence }
    }

    // ── 模式1: "那个X" / "那位X" / "这个X" / "那X" ──
    var pattern1 = /(?:([那这][位个名]?)|(?:那个|那位|这个|这位))([^\s，,。.!！?？\n]{1,12})/g
    var match
    while ((match = pattern1.exec(userMessage)) !== null) {
        var demonstrative = match[0]
        var descriptor = match[2]
        if (!descriptor) continue
        var result = resolveEntityByDescriptor(descriptor, knownEntities)
        if (result.exact) {
            resolved[demonstrative] = result.exact
            enhancedQuery = enhancedQuery.replace(demonstrative, result.exact)
        } else if (result.candidates && result.candidates.length > 0) {
            if (result.candidates.length === 1) {
                resolved[demonstrative] = result.candidates[0].name
                enhancedQuery = enhancedQuery.replace(demonstrative, result.candidates[0].name)
            } else {
                lowConfidence.push({
                    pattern: demonstrative,
                    descriptor: descriptor,
                    candidates: result.candidates.map(function(c) { return c.name })
                })
            }
        }
    }

    // ── 模式2: "上次/之前/刚才/刚刚的X" ──
    var pattern2 = /(上次|之前|刚才|刚刚)(?:的)?([^\s，,。.!！?？\n]{1,15})/g
    while ((match = pattern2.exec(userMessage)) !== null) {
        var fullMatch = match[0]
        var descriptor = match[2]
        if (!descriptor) continue
        var result = resolveEntityByDescriptor(descriptor, knownEntities)
        if (result.exact) {
            resolved[fullMatch] = result.exact
            enhancedQuery = enhancedQuery.replace(fullMatch, result.exact)
        } else if (result.candidates && result.candidates.length > 0) {
            if (result.candidates.length === 1) {
                resolved[fullMatch] = result.candidates[0].name
                enhancedQuery = enhancedQuery.replace(fullMatch, result.candidates[0].name)
            } else {
                lowConfidence.push({
                    pattern: fullMatch,
                    descriptor: descriptor,
                    candidates: result.candidates.map(function(c) { return c.name })
                })
            }
        }
    }

    // ── 模式3: "X怎么样了" / "X后来呢" / "X现在..." ──
    var pattern3 = /([^\s，,。.!！?？\n]{1,10})(怎么样|后来|之后|现在|去哪|在哪|是谁|干嘛)(?:了|呢|的)?/g
    while ((match = pattern3.exec(userMessage)) !== null) {
        var entityName = match[1]
        var suffix = match[2]
        var fullMatch = match[0]
        // 跳过已被前两个模式处理的
        if (resolved[fullMatch]) continue
        // 检查是否是已知实体名的模糊子串匹配
        var exactResult = resolveEntityByDescriptor(entityName, knownEntities)
        if (exactResult.exact) {
            resolved[fullMatch] = exactResult.exact + suffix
        }
    }

    return { resolved: resolved, enhancedQuery: enhancedQuery, lowConfidence: lowConfidence }
}

/**
 * 根据描述词查找匹配的实体
 * @param {string} descriptor - 描述词（如"铁匠"、"剑"、"House"）
 * @param {Array} knownEntities - 已知实体列表
 * @returns {object} {exact: string|null, candidates: Array}
 */
function resolveEntityByDescriptor(descriptor, knownEntities) {
    var descriptorLower = descriptor.toLowerCase()
    var exact = null
    var candidates = []

    // 策略1：精确全名匹配
    for (var i = 0; i < knownEntities.length; i++) {
        if (knownEntities[i].name.toLowerCase() === descriptorLower) {
            exact = knownEntities[i].name
            break
        }
    }
    if (exact) return { exact: exact, candidates: [] }

    // 策略2：子串匹配（descriptor 是实体名的子串，或反过来）
    for (var i = 0; i < knownEntities.length; i++) {
        var nameLower = knownEntities[i].name.toLowerCase()
        if (nameLower.indexOf(descriptorLower) !== -1 || descriptorLower.indexOf(nameLower) !== -1) {
            candidates.push(knownEntities[i])
        }
    }

    // 策略3：occupation 匹配
    if (candidates.length === 0) {
        for (var i = 0; i < knownEntities.length; i++) {
            var occupations = knownEntities[i].occupations || []
            for (var j = 0; j < occupations.length; j++) {
                if (occupations[j].toLowerCase().indexOf(descriptorLower) !== -1 ||
                    descriptorLower.indexOf(occupations[j].toLowerCase()) !== -1) {
                    candidates.push(knownEntities[i])
                    break
                }
            }
        }
    }

    // 策略4：description 子串匹配
    if (candidates.length === 0) {
        for (var i = 0; i < knownEntities.length; i++) {
            var desc = (knownEntities[i].description || '').toLowerCase()
            if (desc && desc.indexOf(descriptorLower) !== -1) {
                candidates.push(knownEntities[i])
            }
        }
    }

    if (candidates.length === 1 && candidates[0].name) {
        return { exact: candidates[0].name, candidates: [] }
    }

    // 多候选时，按实体 name 长度排序（越短越可能是精确匹配）+ 优先角色
    candidates.sort(function(a, b) {
        var typeScoreA = a.type === 'character' ? 0 : 1
        var typeScoreB = b.type === 'character' ? 0 : 1
        if (typeScoreA !== typeScoreB) return typeScoreA - typeScoreB
        return a.name.length - b.name.length
    })

    return { exact: null, candidates: candidates }
}

/**
 * 可选的 LM 辅助消歧
 * 当规则层返回多个候选且置信度低时调用
 * @param {Array} lowConfidenceItems - 规则层无法确定的项目
 * @param {string} userMessage - 用户消息
 * @returns {object} {resolved: {[pattern]: entityName}}
 */
export async function resolveWithLM(lowConfidenceItems, userMessage) {
    if (!lowConfidenceItems || lowConfidenceItems.length === 0) return { resolved: {} }

    var itemsText = lowConfidenceItems.map(function(item) {
        return '"' + item.pattern + '" → 候选: ' + item.candidates.join(', ')
    }).join('\n')

    var prompt = [
        { role: 'system', content: '你是命名实体消歧器。根据用户消息上下文，将模糊引用映射为具体实体名。仅输出 JSON，格式：{"mappings":{"模糊引用":"具体实体名"}}。不确定则选择最可能的一个，不要返回空。' },
        { role: 'user', content: '用户消息：' + userMessage + '\n\n需要消歧的引用：\n' + itemsText }
    ]

    try {
        var result = await callMemoryLLM(prompt, { timeout: 3, temperature: 0.0 })
        if (result) {
            var jsonMatch = result.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                var parsed = JSON.parse(jsonMatch[0])
                return { resolved: parsed.mappings || {} }
            }
        }
    } catch (e) {
        // LM 消歧失败，返回空
    }
    return { resolved: {} }
}
