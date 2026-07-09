/**
 * 集中类型定义 —— JSDoc @typedef，零运行时开销。
 *
 * 引用方式（在任意 JS 文件中）：
 *   @param {import('../types.js').State} state
 *   @returns {import('../types.js').STMEvent}
 */

export {};

// ============ 核心存储 ============

/**
 * @typedef {Object} Vault
 * @property {string} chat_id
 * @property {number} version
 * @property {number} tokens
 * @property {string} updated_at
 * @property {VaultMeta} _meta
 * @property {VaultContent} content
 * @property {Object<string, STMIndexEntry>} link_index
 * @property {Object<string, STMIndexEntry>} stm_index
 * @property {string} memory_system_prompt
 */

/**
 * @typedef {Object} VaultMeta
 * @property {string} created_at
 * @property {string|null} last_pipeline_task
 * @property {string|null} last_pipeline_time
 */

/**
 * @typedef {Object} VaultContent
 * @property {string} story_time
 * @property {string} story_scene
 * @property {string} story_date
 * @property {string} summary
 * @property {State} state
 * @property {string} state_css
 * @property {Object|null} state_schema
 * @property {LTMEntry[]} ltm_entries
 * @property {STMEvent[]} stm_entries
 * @property {STMEvent[]} unconsolidated_stm
 * @property {number} segment_counter
 * @property {string} current_scene
 * @property {CursorState} cursor_state
 * @property {Object} character_states
 * @property {Array} relationships
 * @property {number} consolidate_threshold
 * @property {Object} memory_config
 * @property {'zh'|'en'} language
 */

/**
 * @typedef {Object} STMIndexEntry
 * @property {string|null} ltm_id
 * @property {string} summary
 * @property {number[]} msg_ids
 */

// ============ State 结构 ============

/**
 * @typedef {Object} State
 * @property {string} [main_event]
 * @property {string} [present_characters]
 * @property {string} [protagonist_name]
 * @property {Object<string, CharacterCard>} [characters]
 * @property {Object<string, Faction>} [factions]
 * @property {QuestsState} [quests]
 * @property {Object<string, Object>} [npc_schemes]
 * @property {Object<string, {_role: string, _scheme: (string|null)}>} [_character_schemes]
 * @property {Object} [power_slots]
 * @property {number} [turn_index]
 */

/**
 * @typedef {Object} CharacterCard
 * @property {string} name
 * @property {string} gender_age
 * @property {string} physique
 * @property {string} occupation
 * @property {string} clothing_build
 * @property {string} personality
 * @property {'活跃'|'非活跃'|'已死亡'|'已归隐'|'已离去'} status
 * @property {string} [inner_thoughts]
 * @property {number} [affection]
 * @property {string} [relationship]
 * @property {string} [current_mood]
 * @property {string} [past_experience]
 * @property {Object<string, any>} [inventory]
 * @property {string} [injuries]
 * @property {string} [status_effects]
 * @property {string} [_scheme]
 * @property {'protagonist'|'npc'} [_role]
 */

/**
 * @typedef {Object} Faction
 * @property {string} name
 * @property {string} description
 * @property {string} leader
 * @property {'友好'|'中立'|'冷淡'|'敌对'} attitude_toward_player
 * @property {Object<string, string>} relations
 * @property {string} notes
 * @property {boolean} [_hidden]
 */

/**
 * @typedef {Object} QuestsState
 * @property {Object<string, QuestEntry>} [tasks]
 * @property {Object<string, GoalEntry>} [goals]
 * @property {Object<string, EventEntry>} [events]
 */

/**
 * @typedef {Object} QuestEntry
 * @property {string} name
 * @property {string} deadline
 * @property {'正在进行'|'已完成'|'已失败'|'已过期'} status
 * @property {'主线'|'支线'|'事件'} type
 * @property {string} issuer
 * @property {string} desc
 * @property {string} progress
 * @property {string} posted_time
 * @property {string} reward
 * @property {string} penalty
 */

/**
 * @typedef {Object} GoalEntry
 * @property {string} name
 * @property {'进行中'|'已达成'|'已放弃'} status
 * @property {string} desc
 * @property {string} progress
 * @property {string} posted_time
 * @property {string} completed_time
 */

/**
 * @typedef {Object} EventEntry
 * @property {string} name
 * @property {'持续中'|'已平息'|'已结束'} status
 * @property {string} desc
 * @property {string} started_time
 * @property {string} ended_time
 */

// ============ STM / LTM ============

/**
 * @typedef {Object} STMEvent
 * @property {string} id
 * @property {string} event
 * @property {number[]} msg_ids
 * @property {number} [absMsgStart]
 * @property {number} [absMsgEnd]
 * @property {number[]} [msgRange]
 * @property {'closed'|'partial'} status
 * @property {string} [parent_partial]
 * @property {Entity[]} [entities]
 * @property {string} [time_label]
 * @property {string} [translation]
 * @property {string} [period]
 * @property {string} [scene]
 * @property {string} [parent_ltm]
 * @property {number} [timestamp]
 */

/**
 * @typedef {Object} LTMEntry
 * @property {string} id
 * @property {'open'|'closed'} status
 * @property {string[]} stm_refs
 * @property {string} title
 * @property {string} event
 * @property {string} period
 * @property {string} [time_range]
 * @property {Entity[]} entities
 * @property {number} timestamp
 */

/**
 * @typedef {Object} Entity
 * @property {string} name
 * @property {'character'|'item'|'faction'|'concept'|'location'|'event'} type
 * @property {string} [scene]
 */

// ============ 检索类型 ============

/**
 * @typedef {Object} UnifiedEntry
 * @property {(STMEvent|LTMEntry)} entry
 * @property {'stm'|'ltm'} type
 * @property {number} relevance
 * @property {ThreadRef[]} threads
 * @property {string[]} sources
 * @property {boolean} _expanded
 * @property {number} _lastDescribedVersion
 * @property {string} [_originalText]
 */

/**
 * @typedef {Object} ThreadRef
 * @property {string} threadId
 * @property {number} position
 * @property {number} total
 */

/**
 * @typedef {Object} ThreadDef
 * @property {'entity_chain'} type
 * @property {string} label
 * @property {string[]} stmIds
 * @property {string} [timeRange]
 * @property {number} dagLayer
 * @property {string|null} parentThreadId
 * @property {string|null} [id]
 * @property {boolean} [persisted]
 */

// ============ Turn / Message ============

/**
 * @typedef {Object} Turn
 * @property {Message|null} user
 * @property {Message|null} assistant
 * @property {number} msgStart
 * @property {number} msgEnd
 */

/**
 * @typedef {Object} Message
 * @property {string} role
 * @property {string} [mes]
 * @property {string} [content]
 * @property {string} [name]
 * @property {(number|string)} [id]
 * @property {(number|string)} [mes_id]
 * @property {boolean} [is_user]
 * @property {string} [_msg_id]
 * @property {number} [_absIdx]
 * @property {number} [_idx]
 * @property {string} [__ne_msg_id]
 * @property {boolean} [is_system]
 */

// ============ Snapshot / Cursor ============

/**
 * @typedef {Object} Snapshot
 * @property {string} id
 * @property {string} chat_id
 * @property {number} version
 * @property {string} updated_at
 * @property {Vault} data
 */

/**
 * @typedef {Object} CursorState
 * @property {{completedTurns: number, position: number, pending_partials: Object[]}} stm
 * @property {{position: number, pending_partials: Object[]}} ltm
 */

// ============ Consolidate ============

/**
 * @typedef {Object} ClosureSignals
 * @property {string} timeGap
 * @property {boolean} sceneChange
 * @property {number} entityOverlap
 * @property {string} entityDetail
 * @property {string} signalSummary
 * @property {string} openScene
 * @property {string} newScene
 */

/**
 * @typedef {Object} LTMDecision
 * @property {'append'|'close_and_new'} action
 * @property {string} [updated_title]
 * @property {string} [updated_event]
 */

// ============ Pipeline ============

/**
 * @typedef {Object} PipelineGuard
 * @property {string|null} track
 * @property {string|null} taskId
 * @property {number|null} startedAt
 * @property {number|null} timeoutAt
 * @property {number} version
 */

// ============ State Changes ============

/**
 * 扁平化 dot-path → 值 映射
 * @typedef {Object<string, any>} StateChanges
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {*} value
 */

/**
 * @typedef {Object} SchemaFieldDef
 * @property {'string'|'number'|'boolean'|'enum'|'object'} type
 * @property {number} [max_length]
 * @property {number} [min]
 * @property {number} [max]
 * @property {string[]} [values]
 * @property {Object<string, SchemaFieldDef>} [fields]
 * @property {SchemaFieldDef} [schema]
 * @property {boolean} [required]
 * @property {'static'|'dynamic'} [layer]
 * @property {boolean} [_system]
 * @property {string} [category]
 * @property {'ai_generated'|'user_created'|'global'} [_source]
 * @property {'active'|'deprecated'} [_status]
 */

// ============ Open Character Schema 类型 ============

/**
 * @typedef {Object} Template
 * @property {string} id
 * @property {string} name
 * @property {'pc'|'npc'} role
 * @property {string} [description]
 * @property {string[]} [tags]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {'ai_generated'|'user_created'|'from_chat'} source
 * @property {string[]} presetFields
 * @property {string[]} customFieldRefs
 * @property {boolean} [system]
 * @property {boolean} [_locked]
 * @property {string} [_source]
 * @property {'synced'|'forked'|'orphaned'} [_state]
 */

/**
 * @typedef {Object} TemplateLibrary
 * @property {Object<string, Template>} templates
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} FieldLibraryEntry
 * @property {string} name
 * @property {'string'|'number'|'boolean'|'enum'|'object'} type
 * @property {string} [description]
 * @property {string[]} [values]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [max_length]
 * @property {'static'|'dynamic'} [layer]
 * @property {string} [category]
 * @property {string[]} usedByTemplates
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} FieldLibrary
 * @property {Object<string, FieldLibraryEntry>} fields
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} DialogueTemplate
 * @property {string} _templateId
 * @property {string} createdAt
 * @property {boolean} [_locked]
 * @property {string[]} presetFields
 * @property {string[]} customFieldRefs
 * @property {'synced'|'forked'|'orphaned'} [_state]
 * @property {string} [_source]
 */

/**
 * @typedef {Object} TemplateConfig
 * @property {string} pc
 * @property {string[]} npc
 * @property {'exact'|'adjust'} _npcTemplateMode
 */

/**
 * @typedef {Object} CardConfig
 * @property {Object<string, DialogueTemplate>} _dialogueTemplates
 * @property {TemplateConfig} _templateConfig
 * @property {{genre: string, tropes: string[], summary: string, source: 'wb'|'manual', _extractedAt: string}} [_worldContext]
 * @property {number} _version
 * @property {string} _createdAt
 * @property {string} _updatedAt
 */

/**
 * @typedef {Object} CharacterState
 * @property {string} _templateKey
 * @property {boolean} [_templateLocked]
 * @property {Object<string, any>} fields
 */
