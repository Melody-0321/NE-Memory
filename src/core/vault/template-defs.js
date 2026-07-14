// vault/template-defs.js - Default template constants (pure data, no runtime deps)

export var DEFAULT_PC_TEMPLATE = {
    id: '_default_pc',
    name: 'Default PC',
    role: 'pc',
    description: 'Default protagonist scheme (9 preset fields)',
    source: 'system',
    system: true,
    presetFields: ['gender_age','physique','occupation','personality','clothing_build','injuries','status_effects','past_experience','inventory'],
    customFieldRefs: [],
    perRoundFields: ['current_mood', 'inner_thoughts'],
    _locked: false
};

export var DEFAULT_NPC_TEMPLATE = {
    id: '_default_npc',
    name: 'Default NPC',
    role: 'npc',
    description: 'Default NPC scheme (14 preset fields)',
    source: 'system',
    system: true,
    presetFields: ['gender_age','physique','occupation','personality','clothing_build','inner_thoughts','relationship','current_mood','past_experience','injuries','status_effects','inventory'],
    customFieldRefs: [],
    perRoundFields: ['current_mood', 'inner_thoughts'],
    _locked: false
};

export var DEFAULT_FACTION_TEMPLATE = {
    id: '_default_faction',
    name: 'Default Faction',
    role: 'faction',
    description: 'Default faction scheme (dynamic state only; static info from World Book)',
    source: 'system',
    system: true,
    presetFields: ['name','attitude_toward_player','reputation_with_pc','current_goal','relations','notes'],
    customFieldRefs: [],
    _locked: false
};

export var DEFAULT_TASK_TEMPLATE = {
    id: '_default_task',
    name: 'Default Task',
    role: 'quest',
    description: 'Default task scheme (external quests, commissions)',
    source: 'system',
    system: true,
    presetFields: ['name','type','status','issuer','objective','desc','progress','posted_time','deadline','reward','penalty'],
    customFieldRefs: [],
    _locked: false
};

export var DEFAULT_GOAL_TEMPLATE = {
    id: '_default_goal',
    name: 'Default Goal',
    role: 'quest',
    description: 'Default goal scheme (internal character aspirations)',
    source: 'system',
    system: true,
    presetFields: ['name','status','motivation','desc','progress','posted_time','notes'],
    customFieldRefs: [],
    _locked: false
};
