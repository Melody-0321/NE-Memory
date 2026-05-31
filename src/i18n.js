/**
 * i18n.js — 三语翻译表 + 翻译函数
 *
 * 从现有 index.js 直接移植。
 * NARRATIVE_I18N = Vault 面板文本
 * CONFIG_I18N = 设置弹窗文本
 */
export const NARRATIVE_I18N = {
    'en': {
        'Memory Vault': 'Memory Vault', 'Refresh': 'Refresh', 'Edit': 'Edit', 'Save': 'Save',
        'Cancel': 'Cancel', 'History': 'History', 'Extract State': 'Extract State', 'Consolidate': 'Consolidate',
        'Clear': 'Clear', 'Version:': 'Version:', 'Long-term Memory (LTM)': 'Long-term Memory (LTM)',
        'Short-term Memory (STM)': 'Short-term Memory (STM)', 'LLM Operation Log': 'LLM Operation Log',
        'Opening Scene': 'Opening Scene', 'Current State': 'Current State', 'Current State (JSON)': 'Current State (JSON)',
        'Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.':
            'Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.',
        'Restore to version v{VER}?': 'Restore to version v{VER}?', 'Confirm delete v{VER}?': 'Confirm delete v{VER}?',
        'Restore': 'Restore', 'Delete': 'Delete', 'Confirm': 'Confirm', 'Restore failed': 'Restore failed',
        'Delete failed': 'Delete failed', 'No history yet': 'No history yet', 'Failed to load vault:': 'Failed to load vault:',
        'Failed to load history': 'Failed to load history', 'Tool Calling Log': 'Tool Calling Log', 'Export Logs': 'Export Logs',
        'No tool calls recorded': 'No tool calls recorded', 'No operations logged': 'No operations logged',
        'Loading...': 'Loading...', 'Loading history...': 'Loading history...', 'updating...': 'updating...',
        'State extraction failed': 'State extraction failed', 'State Template': 'State Template',
        'Consolidation failed': 'Consolidation failed', 'State JSON invalid:': 'State JSON invalid:',
        'STM Update': 'STM Update', 'Init State': 'Init State', 'Edit Save': 'Edit Save',
        'Locked = Memory Vault panel will stay open': 'Locked = Memory Vault panel will stay open',
        'Opening Summary (always visible)': 'Opening Summary (always visible)', 'Current Scene': 'Current Scene',
        'Long-term Memory (LTM) \u2014 Direct': 'Long-term Memory (LTM) \u2014 Direct',
        'Short-term Memory (Unconsolidated) \u2014 Direct': 'Short-term Memory (Unconsolidated) \u2014 Direct (recent, detailed)',
        'No.': 'No.', 'Period': 'Period', 'Scene': 'Scene', 'Event': 'Event', 'Event (Summary)': 'Event (Summary)',
        'The following content is not directly injected. If needed, use lookup_stm or lookup_memory_source tool.':
            'The following content is not directly injected. If needed, use lookup_stm or lookup_memory_source tool.',
        'Characters': 'Characters', '活跃': 'Active', '非活跃': 'Inactive', '已退场': 'Departed',
        'Factions': 'Factions', 'Relations': 'Relations',
        'Tasks': 'Tasks', 'Goals': 'Goals', 'World Events': 'World Events', 'Quests': 'Quests',
    },
    'zh-cn': {
        'Memory Vault': '记忆区', 'Refresh': '刷新', 'Edit': '编辑', 'Save': '保存', 'Cancel': '取消',
        'History': '历史', 'Extract State': '提取状态', 'Consolidate': '整合', 'Clear': '清除',
        'Version:': '版本：', 'Long-term Memory (LTM)': '长期记忆 (LTM)', 'Short-term Memory (STM)': '短期记忆 (未整合 STM)',
        'LLM Operation Log': 'LLM 操作日志', 'Opening Scene': '开场设定', 'Current State': '当前状态',
        'Current State (JSON)': '当前状态 (JSON)', 'No operations logged': '暂无操作记录',
        'Tool Calling Log': 'Tool 调用日志', 'Export Logs': '导出日志', 'No tool calls recorded': '暂无 Tool 调用记录',
        'Loading...': '加载中...', 'Loading history...': '加载历史中...', 'updating...': '更新中...',
        'State extraction failed': '状态提取失败', 'State Template': '状态模板', 'Consolidation failed': '整合失败',
        'State JSON invalid:': '状态 JSON 无效：', 'STM Update': 'STM 更新', 'Init State': '初始化状态', 'Edit Save': '编辑保存',
        'Locked = Memory Vault panel will stay open': '锁定 = 记忆区面板将保持打开状态',
        'Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.':
            '确定清除所有状态？\n\n下次对话时 LLM 将从角色卡和世界书重新生成。',
        'Restore to version v{VER}?': '确定恢复到版本 v{VER}？', 'Confirm delete v{VER}?': '确定删除 v{VER}？',
        'Restore': '恢复', 'Delete': '删除', 'Confirm': '确认', 'Restore failed': '恢复失败', 'Delete failed': '删除失败',
        'No history yet': '暂无历史', 'Failed to load vault:': '加载 Vault 失败：', 'Failed to load history': '加载历史失败',
        'Opening Summary (always visible)': '开场设定（始终可见）', 'Current Scene': '当前场景',
        'Long-term Memory (LTM) \u2014 Direct': '长期记忆 (LTM) \u2014 直接可见',
        'Short-term Memory (Unconsolidated) \u2014 Direct': '短期记忆·未整合 \u2014 直接可见（最近发生，最详细）',
        'No.': 'No.', 'Period': '时段', 'Scene': '场景', 'Event': '事件', 'Event (Summary)': '事件 (摘要)',
        'The following content is not directly injected. If needed, use lookup_stm or lookup_memory_source tool.':
            '以下内容不直接注入。如需查看，使用 lookup_stm 或 lookup_memory_source 工具。',
        'Characters': '角色卡', '活跃': '活跃', '非活跃': '非活跃', '已退场': '已退场',
        'Factions': '势力', 'Relations': '势力关系',
        'Tasks': '任务', 'Goals': '目标', 'World Events': '世界事件', 'Quests': '任务/目标/事件',
    },
    'zh-tw': {
        'Memory Vault': '記憶區', 'Refresh': '重新整理', 'Edit': '編輯', 'Save': '儲存', 'Cancel': '取消',
        'History': '歷史', 'Extract State': '提取狀態', 'Consolidate': '整合', 'Clear': '清除',
        'Version:': '版本：', 'Long-term Memory (LTM)': '長期記憶 (LTM)', 'Short-term Memory (STM)': '短期記憶 (未整合 STM)',
        'LLM Operation Log': 'LLM 操作日誌', 'Opening Scene': '開場設定', 'Current State': '當前狀態',
        'Current State (JSON)': '當前狀態 (JSON)', 'No operations logged': '暫無操作記錄',
        'Tool Calling Log': 'Tool 調用日誌', 'Export Logs': '匯出日誌', 'No tool calls recorded': '暫無 Tool 調用記錄',
        'Loading...': '載入中...', 'Loading history...': '載入歷史中...', 'updating...': '更新中...',
        'State extraction failed': '狀態提取失敗', 'State Template': '狀態模板', 'Consolidation failed': '整合失敗',
        'State JSON invalid:': '狀態 JSON 無效：', 'STM Update': 'STM 更新', 'Init State': '初始化狀態', 'Edit Save': '編輯儲存',
        'Locked = Memory Vault panel will stay open': '上鎖 = 記憶區面板將保持開啟',
        'Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.':
            '確定清除所有狀態？\n\n下次對話時 LLM 將從角色卡和世界書重新生成。',
        'Restore to version v{VER}?': '確定恢復到版本 v{VER}？', 'Confirm delete v{VER}?': '確定刪除 v{VER}？',
        'Restore': '恢復', 'Delete': '刪除', 'Confirm': '確認', 'Restore failed': '恢復失敗', 'Delete failed': '刪除失敗',
        'No history yet': '暫無歷史', 'Failed to load vault:': '載入 Vault 失敗：', 'Failed to load history': '載入歷史失敗',
        'Opening Summary (always visible)': '開場設定（始終可見）', 'Current Scene': '當前場景',
        'Long-term Memory (LTM) \u2014 Direct': '長期記憶 (LTM) \u2014 直接可見',
        'Short-term Memory (Unconsolidated) \u2014 Direct': '短期記憶·未整合 \u2014 直接可見（最近發生，最詳細）',
        'No.': 'No.', 'Period': '時段', 'Scene': '場景', 'Event': '事件', 'Event (Summary)': '事件 (摘要)',
        'The following content is not directly injected. If needed, use lookup_stm or lookup_memory_source tool.':
            '以下內容不直接注入。如需查看，使用 lookup_stm 或 lookup_memory_source 工具。',
        'Characters': '角色卡', '活跃': '活躍', '非活跃': '非活躍', '已退场': '已退場',
        'Factions': '勢力', 'Relations': '勢力關係',
        'Tasks': '任務', 'Goals': '目標', 'World Events': '世界事件', 'Quests': '任務/目標/事件',
    }
};

export const CONFIG_I18N = {
    'en': {
        '基本设置': 'Basic Settings', '副 API': 'Secondary API', '记忆处理': 'Memory Config', '记忆处理参数': 'Memory Config',
        'narrative_label_enable_telemetry': 'Enable Telemetry (logging & export)',
        'Temperature': 'Temperature',
        '低温度确保记忆摘要的一致性和准确性。0.1=极度保守，0.3=略有变化。':
            'Lower temperature ensures consistency and accuracy of memory summaries. 0.1=very conservative, 0.3=slightly varied.',
        'STM 单次输出上限': 'STM Max Tokens', 'STM 单条事件上限': 'STM Event Char Limit',
        'LTM 单次输出上限': 'LTM Max Tokens', 'LTM 单条事件上限': 'LTM Event Char Limit',
        '开场摘要输出上限': 'Opening Max Tokens', '开场摘要截断上限': 'Opening Char Limit',
        '状态初始化输出上限': 'Init State Max Tokens',
        '以上参数将应用于记忆区 LLM 调用。修改后对下次对话生效。': 'Parameters above apply to memory LLM calls on next turn.',
        'Enable Narrative Engine': 'Enable Narrative Engine',
        'Enable GM Agent': 'Enable GM Agent',
        'Enable Memory System': 'Enable Memory System',
        'Secondary API (for memory processing)': 'Secondary API (for memory processing)',
        'API URL': 'API URL', 'API Key': 'API Key', 'Model': 'Model',
        'Leave empty to use the same API as the main chat. Recommended: use a cheaper/faster model for memory extraction.':
            'Leave empty to use the same API as the main chat. Recommended: use a cheaper/faster model for memory extraction.',
        '状态 Schema': 'State Schema',
        'Schema JSON (editable)': 'Schema JSON (editable)',
        'Valid JSON defining state field types and constraints. Leave empty to disable schema validation.':
            'Valid JSON defining state field types and constraints. Leave empty to disable schema validation.',
        'Character Schema': 'Character Schema',
        'Valid JSON defining character card field definitions. Has protagonist and npc blocks. Leave empty to use default.':
            'Valid JSON defining character card field definitions. Has protagonist and npc blocks. Leave empty to use default.',
        'Enable Quests Block': 'Enable Quests Block',
        'When enabled, the memory engine will track tasks, goals, and world events in state.':
            'When enabled, the memory engine will track tasks, goals, and world events in state.',
        'Enable State Schema': 'Enable State Schema',
        'When enabled, the State Schema system tracks characters, factions, quests/power_slots with structured validation. Disable to use pure memory optimization without state management. State Schema depends on Memory System being enabled.':
            'When enabled, the State Schema system tracks characters, factions, quests/power_slots with structured validation. Disable to use pure memory optimization without state management. State Schema depends on Memory System being enabled.',
        'Power Slots Templates': 'Power Slots Templates',
        'Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.':
            'Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.',
        'Add Slot': 'Add Slot',
        'Reset to Defaults': 'Reset to Defaults',
        'Delete': 'Delete',
    },
    'zh-cn': {
        'Enable Narrative Engine': '启用 Narrative Engine', 'Enable GM Agent': '启用 GM 代理',
        'Enable Memory System': '启用记忆系统', 'Secondary API (for memory processing)': '副 API（用于记忆处理）',
        'API URL': 'API URL', 'API Key': 'API Key', 'Model': '模型',
        'Leave empty to use the same API as the main chat. Recommended: use a cheaper/faster model for memory extraction.':
            '留空则使用主聊天 API。建议使用更便宜/更快的模型进行记忆提取。',
        'Temperature': 'Temperature', 'narrative_label_enable_telemetry': '启用测试模式（记录日志）',
        '基本设置': '基本设置', '副 API': '副 API', '记忆处理': '记忆处理', '记忆处理参数': '记忆处理参数',
        '低温度确保记忆摘要的一致性和准确性。0.1=极度保守，0.3=略有变化。': '低温度确保记忆摘要的一致性和准确性。0.1=极度保守，0.3=略有变化。',
        'STM 单次输出上限': 'STM 单次输出上限', 'STM 单条事件上限': 'STM 单条事件上限',
        'LTM 单次输出上限': 'LTM 单次输出上限', 'LTM 单条事件上限': 'LTM 单条事件上限',
        '开场摘要输出上限': '开场摘要输出上限', '开场摘要截断上限': '开场摘要截断上限',
        '状态初始化输出上限': '状态初始化输出上限',
        '以上参数将应用于记忆区 LLM 调用。修改后对下次对话生效。': '以上参数将应用于记忆区 LLM 调用。修改后对下次对话生效。',
        '状态 Schema': '状态 Schema',
        'Schema JSON (editable)': 'Schema JSON（可编辑）',
        'Valid JSON defining state field types and constraints. Leave empty to disable schema validation.':
            '定义状态字段类型和约束的 JSON。留空则禁用 Schema 校验。',
        'Character Schema': '角色卡 Schema',
        'Valid JSON defining character card field definitions. Has protagonist and npc blocks. Leave empty to use default.':
            '定义角色卡字段结构的 JSON。包含 protagonist 和 npc 两个块。留空则使用默认值。',
        'Enable Quests Block': '启用任务/目标/事件追踪',
        'When enabled, the memory engine will track tasks, goals, and world events in state.':
            '启用后，记忆引擎将在状态中追踪任务、目标与世界事件。',
        'Enable State Schema': '启用状态Schema系统',
        'When enabled, the State Schema system tracks characters, factions, quests/power_slots with structured validation. Disable to use pure memory optimization without state management. State Schema depends on Memory System being enabled.':
            '启用后，状态Schema系统将追踪角色卡、势力、任务/战力槽，并进行结构化校验。禁用则仅使用纯记忆优化，无状态管理开销。状态Schema依赖记忆系统启用。',
        'Power Slots Templates': '战力槽模板',
        'Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.':
            '用于自动检测角色战力/能量系统的参考模板。可编辑标签以匹配您世界的命名方式。',
        'Add Slot': '添加模板',
        'Reset to Defaults': '恢复默认',
        'Delete': '删除',
    },
    'zh-tw': {
        'Enable Narrative Engine': '啟用 Narrative Engine', 'Enable GM Agent': '啟用 GM 代理',
        'Enable Memory System': '啟用記憶系統', 'Secondary API (for memory processing)': '副 API（用於記憶處理）',
        'API URL': 'API URL', 'API Key': 'API Key', 'Model': '模型',
        'Leave empty to use the same API as the main chat. Recommended: use a cheaper/faster model for memory extraction.':
            '留空則使用主聊天 API。建議使用更便宜/更快的模型進行記憶提取。',
        'Temperature': 'Temperature', 'narrative_label_enable_telemetry': '啟用測試模式（記錄日誌）',
        '基本设置': '基本設置', '副 API': '副 API', '记忆处理': '記憶處理', '记忆处理参数': '記憶處理參數',
        '低温度确保记忆摘要的一致性和准确性。0.1=极度保守，0.3=略有变化。': '低溫確保記憶摘要的一致性和準確性。0.1=極度保守，0.3=略有變化。',
        'STM 单次输出上限': 'STM 單次輸出上限', 'STM 单条事件上限': 'STM 單條事件上限',
        'LTM 单次输出上限': 'LTM 單次輸出上限', 'LTM 单条事件上限': 'LTM 單條事件上限',
        '开场摘要输出上限': '開場摘要輸出上限', '开场摘要截断上限': '開場摘要截斷上限',
        '状态初始化输出上限': '狀態初始化輸出上限',
        '以上参数将应用于记忆区 LLM 调用。修改后对下次对话生效。': '以上參數將應用於記憶區 LLM 調用。修改後對下次對話生效。',
        '状态 Schema': '狀態 Schema',
        'Schema JSON (editable)': 'Schema JSON（可編輯）',
        'Valid JSON defining state field types and constraints. Leave empty to disable schema validation.':
            '定義狀態欄位類型與約束的 JSON。留空則停用 Schema 校驗。',
        'Character Schema': '角色卡 Schema',
        'Valid JSON defining character card field definitions. Has protagonist and npc blocks. Leave empty to use default.':
            '定義角色卡欄位結構的 JSON。包含 protagonist 和 npc 兩個區塊。留空則使用預設值。',
        'Enable Quests Block': '啟用任務/目標/事件追蹤',
        'When enabled, the memory engine will track tasks, goals, and world events in state.':
            '啟用後，記憶引擎將在狀態中追蹤任務、目標與世界事件。',
        'Enable State Schema': '啟用狀態Schema系統',
        'When enabled, the State Schema system tracks characters, factions, quests/power_slots with structured validation. Disable to use pure memory optimization without state management. State Schema depends on Memory System being enabled.':
            '啟用後，狀態Schema系統將追蹤角色卡、勢力、任務/戰力槽，並進行結構化校驗。停用則僅使用純記憶最佳化，無狀態管理開銷。狀態Schema依賴記憶系統啟用。',
        'Power Slots Templates': '戰力槽模板',
        'Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.':
            '用於自動檢測角色戰力/能量系統的參考模板。可編輯標籤以匹配您世界的命名方式。',
        'Add Slot': '新增模板',
        'Reset to Defaults': '恢復預設',
        'Delete': '刪除',
    }
};

let _locale = 'en';
export function t(locale) { if (locale) _locale = locale; }
export function t_narrative(key, replacements) {
    const map = NARRATIVE_I18N[_locale] || NARRATIVE_I18N['en'] || {};
    let text = map[key] || key;
    if (replacements) {
        Object.keys(replacements).forEach(k => { text = text.replace('{' + k + '}', replacements[k]); });
    }
    return text;
}
export function t_config(key) {
    const map = CONFIG_I18N[_locale] || CONFIG_I18N['en'] || {};
    return map[key] || key;
}
