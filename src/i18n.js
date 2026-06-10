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
        'Cancel': 'Cancel', 'History': 'History', 'Extract State': 'Extract State', 'Consolidate': 'Consolidate', 'Process History': 'Process History', 'Processing...': 'Processing...', 'Process all past messages into memories': 'Process all past messages into memories', 'No messages found in chat.': 'No messages found in chat.', 'No messages with content to process.': 'No messages with content to process.', 'Export JSON': 'Export JSON', 'Import JSON': 'Import JSON', 'Embed into Chat': 'Embed into Chat', 'Embed vault into chat_metadata so it travels with chat export/backup': 'Embed vault into chat_metadata so it travels with chat export/backup', 'Done': 'Done', 'Vault is now embedded in chat_metadata. Export or backup will carry it.': 'Vault is now embedded in chat_metadata. Export or backup will carry it.',
        'Clear': 'Clear', 'Version:': 'Version:', 'Long-term Memory (LTM)': 'Long-term Memory (LTM)',
        'Short-term Memory (STM)': 'Short-term Memory (STM)', 'LLM Operation Log': 'LLM Operation Log',
        'Opening Scene': 'Opening Scene', 'Current State': 'Current State', 'Discovered State Fields': 'Discovered State Fields', 'Current State (JSON)': 'Current State (JSON)',
        'Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.':
            'Confirm clear all state?\n\nLLM will regenerate from character card and world book on next turn.',
        'Restore to version v{VER}?': 'Restore to version v{VER}?', 'Confirm delete v{VER}?': 'Confirm delete v{VER}?',
        'Restore': 'Restore', 'Delete': 'Delete', 'Confirm': 'Confirm', 'Restore failed': 'Restore failed',
        'Delete failed': 'Delete failed', 'No history yet': 'No history yet', 'Failed to load vault:': 'Failed to load vault:',
        'Failed to load history': 'Failed to load history', 'Tool Calling Log': 'Tool Calling Log', 'Export Logs': 'Export Logs',
        'No tool calls recorded': 'No tool calls recorded', 'No operations logged': 'No operations logged',
        'Loading...': 'Loading...', 'Loading history...': 'Loading history...', 'updating...': 'updating...',
        'State extraction failed': 'State extraction failed',
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
        'Settings saved.': 'Settings saved.',
        'Restore embedded vault?': 'Restore embedded vault?',
        'Click Confirm to restore, Cancel to skip.': 'Click Confirm to restore, Cancel to skip.',
        'Memory': 'Memory', 'Tools': 'Tools', 'Settings': 'Settings',
        'Memory List': 'Memory List', 'State Board': 'State Board',
        'Global Data': 'Global Data', 'Quests & Events': 'Quests & Events',
        'Operations': 'Operations', 'Data': 'Data', 'Diagnostics': 'Diagnostics',
        'Injection Preview': 'Injection Preview',
        'Common Settings': 'Common Settings', 'Advanced Settings': 'Advanced Settings',
        'Engine': 'Engine', 'Secondary API': 'Secondary API', 'Schema Editors': 'Schema Editors',
        'Memory Parameters': 'Memory Parameters', 'Save Settings': 'Save Settings',
        'entries': 'entries',
        'No state data': 'No state data', 'No character data': 'No character data',
        'No faction data': 'No faction data', 'No quest data': 'No quest data',
        'No injection recorded yet. Send a message to trigger SmartPush.': 'No injection recorded yet. Send a message to trigger SmartPush.',
        'Last injection': 'Last injection', 'truncated': 'truncated',
        'Content truncated at 800 characters.': 'Content truncated at 800 characters.',
        'Consolidate will convert STM entries into LTM. Continue?': 'Consolidate will convert STM entries into LTM. Continue?',
        'This will re-process ALL past messages. It may take a long time. Continue?': 'This will re-process ALL past messages. It may take a long time. Continue?',
        'Collapse memory panel': 'Collapse memory panel', 'Edit State': 'Edit State',
        'Invalid JSON': 'Invalid JSON',
        'Enable State Schema': 'Enable State Schema',
        'Use Dynamic Field Discovery': 'Use Dynamic Field Discovery',
        'Enable Smart Retrieval': 'Enable Smart Retrieval',
        'Memory Budget': 'Memory Budget', 'STM Extraction Batch': 'STM Extraction Batch',
        'Max Unconsolidated STM': 'Max Unconsolidated STM', 'Temperature': 'Temperature',
        'Extraction Temperature': 'Extraction Temperature', 'Retrieval Temperature': 'Retrieval Temperature',
        'API URL': 'API URL', 'API Key': 'API Key', 'Model': 'Model',
        'STM Max Tokens': 'STM Max Tokens', 'LTM Max Tokens': 'LTM Max Tokens',
        'STM Per-Event Char Limit': 'STM Per-Event Char Limit',
        'LTM Per-Event Char Limit': 'LTM Per-Event Char Limit',
        'State Schema': 'State Schema', 'Character Schema': 'Character Schema',
        'Enable Quests Block': 'Enable Quests Block',
        'Controls max context tokens for memory injection. Higher = more memories visible, higher API cost.': 'Controls max context tokens for memory injection. Higher = more memories visible, higher API cost.',
        'Maximum tokens per single LLM call for STM extraction.': 'Maximum tokens per single LLM call for STM extraction.',
        'Maximum tokens per single LLM call for LTM consolidation.': 'Maximum tokens per single LLM call for LTM consolidation.',
        'Max characters per event entry before truncation.': 'Max characters per event entry before truncation.',
        'Collect this many messages before extracting STM entries. Lower = faster updates, higher = fewer LLM calls.': 'Collect this many messages before extracting STM entries. Lower = faster updates, higher = fewer LLM calls.',
        'Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.': 'Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.',
        'STM/State/LTM memory extraction. Lower = more consistent summaries.': 'STM/State/LTM memory extraction. Lower = more consistent summaries.',
        'Smart retrieval and tool queries. Higher = more creative answers.': 'Smart retrieval and tool queries. Higher = more creative answers.',
    },
    'zh-cn': {
        'Memory Vault': '记忆区', 'Refresh': '刷新', 'Edit': '编辑', 'Save': '保存', 'Cancel': '取消',
        'History': '历史', 'Extract State': '提取状态', 'Consolidate': '整合', 'Process History': '处理历史', 'Processing...': '处理中...', 'Process all past messages into memories': '将全部历史消息处理为记忆', 'No messages found in chat.': '未在聊天记录中找到消息。', 'No messages with content to process.': '没有可处理的有效消息。', 'Export JSON': '导出 JSON', 'Import JSON': '导入 JSON', 'Embed into Chat': '嵌入到聊天', 'Embed vault into chat_metadata so it travels with chat export/backup': '将记忆嵌入 chat_metadata，随聊天导出/备份一起迁移', 'Done': '完成', 'Vault is now embedded in chat_metadata. Export or backup will carry it.': '记忆已嵌入 chat_metadata。导出或备份聊天文件时将包含记忆。', 'Clear': '清除',
        'Version:': '版本：', 'Long-term Memory (LTM)': '长期记忆 (LTM)', 'Short-term Memory (STM)': '短期记忆 (未整合 STM)',
        'LLM Operation Log': 'LLM 操作日志', 'Opening Scene': '开场设定', 'Current State': '当前状态', 'Discovered State Fields': '已发现的动态字段',
        'Current State (JSON)': '当前状态 (JSON)', 'No operations logged': '暂无操作记录',
        'Tool Calling Log': 'Tool 调用日志', 'Export Logs': '导出日志', 'No tool calls recorded': '暂无 Tool 调用记录',
        'Loading...': '加载中...', 'Loading history...': '加载历史中...', 'updating...': '更新中...',
        'State extraction failed': '状态提取失败', 'Consolidation failed': '整合失败',
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
        'Settings saved.': '设置已保存。',
        'Restore embedded vault?': '检测到嵌入的记忆数据，要恢复吗？',
        'Click Confirm to restore, Cancel to skip.': '点击确定恢复，取消则跳过。',
        'Memory': '记忆', 'Tools': '工具', 'Settings': '设置',
        'Memory List': '记忆列表', 'State Board': '状态栏',
        'Global Data': '全局数据', 'Quests & Events': '任务与事件',
        'Operations': '操作', 'Data': '数据管理', 'Diagnostics': '诊断',
        'Injection Preview': '注入预览',
        'Common Settings': '常用设置', 'Advanced Settings': '高级设置',
        'Engine': '引擎', 'Secondary API': '副API', 'Schema Editors': 'Schema编辑器',
        'Memory Parameters': '记忆参数', 'Save Settings': '保存设置',
        'entries': '条',
        'No state data': '无状态数据', 'No character data': '无角色数据',
        'No faction data': '无势力数据', 'No quest data': '无任务数据',
        'No injection recorded yet. Send a message to trigger SmartPush.': '暂无注入记录。发送消息以触发SmartPush。',
        'Last injection': '最近注入', 'truncated': '已截断',
        'Content truncated at 800 characters.': '内容已截断至800字符。',
        'Consolidate will convert STM entries into LTM. Continue?': '整合会将短期记忆条目转为长期记忆。继续？',
        'This will re-process ALL past messages. It may take a long time. Continue?': '这将重新处理全部历史消息，可能耗时较长。继续？',
        'Collapse memory panel': '收起记忆面板', 'Edit State': '编辑状态',
        'Invalid JSON': '无效JSON',
        'Enable State Schema': '启用状态Schema系统',
        'Use Dynamic Field Discovery': '使用动态字段发现',
        'Enable Smart Retrieval': '启用智能检索',
        'Memory Budget': '记忆预算', 'STM Extraction Batch': '消息触发阈值',
        'Max Unconsolidated STM': 'LTM整合阈值', 'Temperature': 'Temperature',
        'Extraction Temperature': '记忆提取温度', 'Retrieval Temperature': '检索温度',
        'API URL': 'API URL', 'API Key': 'API Key', 'Model': '模型',
        'STM Max Tokens': 'STM单次输出上限', 'LTM Max Tokens': 'LTM单次输出上限',
        'STM Per-Event Char Limit': 'STM单条事件上限',
        'LTM Per-Event Char Limit': 'LTM单条事件上限',
        'State Schema': '状态Schema', 'Character Schema': '角色卡Schema',
        'Enable Quests Block': '启用任务/目标/事件追踪',
        'Controls max context tokens for memory injection. Higher = more memories visible, higher API cost.': '控制记忆注入的最大上下文 token 数。值越高展示记忆越多，API 费用也越高。',
        'Maximum tokens per single LLM call for STM extraction.': '单次 LLM 调用提取 STM 时的最大输出 token 数。',
        'Maximum tokens per single LLM call for LTM consolidation.': '单次 LLM 调用整合 LTM 时的最大输出 token 数。',
        'Max characters per event entry before truncation.': '每条事件条目的最大字符数，超出截断。',
        'Collect this many messages before extracting STM entries. Lower = faster updates, higher = fewer LLM calls.': '累积多少条消息后启动一次记忆提取流水线。越小响应越快，越大 API 调用越少。',
        'Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.': '未整合 STM 达到此数量时触发长期记忆合并。较小值使 LTM 更及时更新。',
        'STM/State/LTM memory extraction. Lower = more consistent summaries.': '记忆提取（STM/状态/LTM）。值越低摘要越一致。',
        'Smart retrieval and tool queries. Higher = more creative answers.': '智能检索与工具查询。值越高回答越有创造性。',
    },
    'zh-tw': {
        'Memory Vault': '記憶區', 'Refresh': '重新整理', 'Edit': '編輯', 'Save': '儲存', 'Cancel': '取消',
        'History': '歷史', 'Extract State': '提取狀態', 'Consolidate': '整合', 'Process History': '處理歷史', 'Processing...': '處理中...', 'Process all past messages into memories': '將全部歷史訊息處理為記憶', 'No messages found in chat.': '未在聊天記錄中找到訊息。', 'No messages with content to process.': '沒有可處理的有效訊息。', 'Export JSON': '匯出 JSON', 'Import JSON': '匯入 JSON', 'Embed into Chat': '嵌入到聊天', 'Embed vault into chat_metadata so it travels with chat export/backup': '將記憶嵌入 chat_metadata，隨聊天匯出/備份一起遷移', 'Done': '完成', 'Vault is now embedded in chat_metadata. Export or backup will carry it.': '記憶已嵌入 chat_metadata。匯出或備份聊天檔案時將包含記憶。', 'Clear': '清除',
        'Version:': '版本：', 'Long-term Memory (LTM)': '長期記憶 (LTM)', 'Short-term Memory (STM)': '短期記憶 (未整合 STM)',
        'LLM Operation Log': 'LLM 操作日誌', 'Opening Scene': '開場設定', 'Current State': '當前狀態', 'Discovered State Fields': '已發現的動態欄位',
        'Current State (JSON)': '當前狀態 (JSON)', 'No operations logged': '暫無操作記錄',
        'Tool Calling Log': 'Tool 調用日誌', 'Export Logs': '匯出日誌', 'No tool calls recorded': '暫無 Tool 調用記錄',
        'Loading...': '載入中...', 'Loading history...': '載入歷史中...', 'updating...': '更新中...',
        'State extraction failed': '狀態提取失敗', 'Consolidation failed': '整合失敗',
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
        'Characters': '角色卡', 'Active': '活躍', 'Inactive': '非活躍', 'Departed': '已退場',
        'Factions': '勢力', 'Relations': '勢力關係',
        'Tasks': '任務', 'Goals': '目標', 'World Events': '世界事件', 'Quests': '任務/目標/事件',
        'Settings saved.': '設定已儲存。',
        'Restore embedded vault?': '檢測到嵌入的記憶資料，要恢復嗎？',
        'Click Confirm to restore, Cancel to skip.': '點擊確定恢復，取消則跳過。',
        'Memory': '記憶', 'Tools': '工具', 'Settings': '設定',
        'Memory List': '記憶列表', 'State Board': '狀態欄',
        'Global Data': '全域資料', 'Quests & Events': '任務與事件',
        'Operations': '操作', 'Data': '資料管理', 'Diagnostics': '診斷',
        'Injection Preview': '注入預覽',
        'Common Settings': '常用設定', 'Advanced Settings': '進階設定',
        'Engine': '引擎', 'Secondary API': '副API', 'Schema Editors': 'Schema編輯器',
        'Memory Parameters': '記憶參數', 'Save Settings': '儲存設定',
        'entries': '條',
        'No state data': '無狀態資料', 'No character data': '無角色資料',
        'No faction data': '無勢力資料', 'No quest data': '無任務資料',
        'No injection recorded yet. Send a message to trigger SmartPush.': '暫無注入紀錄。發送訊息以觸發SmartPush。',
        'Last injection': '最近注入', 'truncated': '已截斷',
        'Content truncated at 800 characters.': '內容已截斷至800字元。',
        'Consolidate will convert STM entries into LTM. Continue?': '整合會將短期記憶條目轉為長期記憶。繼續？',
        'This will re-process ALL past messages. It may take a long time. Continue?': '這將重新處理全部歷史訊息，可能耗時較長。繼續？',
        'Collapse memory panel': '收起記憶面板', 'Edit State': '編輯狀態',
        'Invalid JSON': '無效JSON',
        'Enable State Schema': '啟用狀態Schema系統',
        'Use Dynamic Field Discovery': '使用動態欄位發現',
        'Enable Smart Retrieval': '啟用智能檢索',
        'Memory Budget': '記憶預算', 'STM Extraction Batch': '訊息觸發閾值',
        'Max Unconsolidated STM': 'LTM整合閾值', 'Temperature': 'Temperature',
        'Extraction Temperature': '記憶提取溫度', 'Retrieval Temperature': '檢索溫度',
        'API URL': 'API URL', 'API Key': 'API Key', 'Model': '模型',
        'STM Max Tokens': 'STM單次輸出上限', 'LTM Max Tokens': 'LTM單次輸出上限',
        'STM Per-Event Char Limit': 'STM單條事件上限',
        'LTM Per-Event Char Limit': 'LTM單條事件上限',
        'State Schema': '狀態Schema', 'Character Schema': '角色卡Schema',
        'Enable Quests Block': '啟用任務/目標/事件追蹤',
        'Controls max context tokens for memory injection. Higher = more memories visible, higher API cost.': '控制記憶注入的最大上下文 token 數。值越高展示記憶越多，API 費用也越高。',
        'Maximum tokens per single LLM call for STM extraction.': '單次 LLM 調用提取 STM 時的最大輸出 token 數。',
        'Maximum tokens per single LLM call for LTM consolidation.': '單次 LLM 調用整合 LTM 時的最大輸出 token 數。',
        'Max characters per event entry before truncation.': '每條事件條目的最大字元數，超出截斷。',
        'Collect this many messages before extracting STM entries. Lower = faster updates, higher = fewer LLM calls.': '累積多少條訊息後啟動一次記憶提取管線。越小響應越快，越大 API 調用越少。',
        'Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.': '未整合 STM 達到此數量時觸發長期記憶合併。較小值使 LTM 更及時更新。',
        'STM/State/LTM memory extraction. Lower = more consistent summaries.': '記憶提取（STM/狀態/LTM）。值越低摘要越一致。',
        'Smart retrieval and tool queries. Higher = more creative answers.': '智能檢索與工具查詢。值越高回答越有創造性。',
    }
};

export const CONFIG_I18N = {
    'en': {
        '基本设置': 'Basic Settings', '副 API': 'Secondary API', '记忆处理': 'Memory Config', '记忆处理参数': 'Memory Config',
        'narrative_label_enable_telemetry': 'Enable Telemetry (logging & export)',
        'Temperature': 'Temperature',
        'Extraction Temperature': 'Extraction Temperature', 'Retrieval Temperature': 'Retrieval Temperature',
        'STM/State/LTM memory extraction. Lower = more consistent summaries.': 'STM/State/LTM memory extraction. Lower = more consistent summaries.',
        'Smart retrieval and tool queries. Higher = more creative answers.': 'Smart retrieval and tool queries. Higher = more creative answers.',
        '低温度确保记忆摘要的一致性和准确性。0.1=极度保守，0.3=略有变化。':
            'Lower temperature ensures consistency and accuracy of memory summaries. 0.1=very conservative, 0.3=slightly varied.',
        'STM 单次输出上限': 'STM Max Tokens', 'STM 单条事件上限': 'STM Event Char Limit',
        'LTM 单次输出上限': 'LTM Max Tokens', 'LTM 单条事件上限': 'LTM Event Char Limit',
        '开场摘要输出上限': 'Opening Max Tokens', '开场摘要截断上限': 'Opening Char Limit',
        '状态初始化输出上限': 'Init State Max Tokens',
        '以上参数将应用于记忆区 LLM 调用。修改后对下次对话生效。': 'Parameters above apply to memory LLM calls on next turn.',
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
        'Use Dynamic Field Discovery': 'Use Dynamic Field Discovery',
        'Automatically discover state fields from character cards and world books. Disable to use preset schema fields.':
            'Automatically discover state fields from character cards and world books. Disable to use preset schema fields.',
        'Enable Smart Retrieval': 'Enable Smart Retrieval',
        'Memory Budget': 'Memory Budget',
        'STM Extraction Batch': 'Pipeline Trigger Size',
        'Collect this many messages before extracting STM entries. Lower = faster updates, higher = fewer LLM calls.': 'Minimum messages to buffer before running the memory pipeline. Lower = more responsive, higher = fewer API calls.',
        'Max Unconsolidated STM': 'LTM Consolidation Threshold',
        'Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.': 'Unconsolidated STM entries needed to trigger long-term memory merge. Lower keeps LTM more current.',
        'Storage blocked: Memories cannot be saved. Disable tracking prevention for this site in your browser settings.':
            'Storage blocked: Memories cannot be saved. Disable tracking prevention for this site in your browser settings.',
        'When enabled, the State Schema system tracks characters, factions, quests/power_slots with structured validation. Disable to use pure memory optimization without state management. State Schema depends on Memory System being enabled.':
            'When enabled, the State Schema system tracks characters, factions, quests/power_slots with structured validation. Disable to use pure memory optimization without state management. State Schema depends on Memory System being enabled.',
        'Power Slots Templates': 'Power Slots Templates',
        'Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.':
            'Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.',
        'Add Slot': 'Add Slot',
        'Reset to Defaults': 'Reset to Defaults',
        'Delete': 'Delete',
        'API Key (leave empty for local proxy)': 'API Key (leave empty for local proxy)',
        'Local proxy uses ST server credentials. Fill URL only (no key) for local proxy, or full URL+Key for direct API access.':
            'Local proxy uses ST server credentials. Fill URL only (no key) for local proxy, or full URL+Key for direct API access.',
        '以上参数将应用于记忆区 LLM 调用，数值越大消耗越多 token。': '以上参数将应用于记忆区 LLM 调用, 数值越大消耗越多 token。',
    },
    'zh-cn': {
        'Enable State Schema': '启用状态Schema系统', 'Secondary API (for memory processing)': '副 API（用于记忆处理）',
        'API URL': 'API URL', 'API Key': 'API Key', 'Model': '模型',
        'Leave empty to use the same API as the main chat. Recommended: use a cheaper/faster model for memory extraction.':
            '留空则使用主聊天 API。建议使用更便宜/更快的模型进行记忆提取。',
        'Temperature': '温度', 'narrative_label_enable_telemetry': '启用测试模式（记录日志）',
        'Extraction Temperature': '记忆提取温度', 'Retrieval Temperature': '检索温度',
        'STM/State/LTM memory extraction. Lower = more consistent summaries.': '记忆提取（STM/状态/LTM）。值越低摘要越一致。',
        'Smart retrieval and tool queries. Higher = more creative answers.': '智能检索与工具查询。值越高回答越有创造性。',
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
        'Use Dynamic Field Discovery': '使用动态字段发现',
        'Automatically discover state fields from character cards and world books. Disable to use preset schema fields.':
            '从角色卡和世界书自动发现状态字段。关闭则使用预设 Schema 字段。',
        'Enable Smart Retrieval': '启用智能检索',
        'Memory Budget': '记忆预算',
        'STM Extraction Batch': '消息触发阈值',
        'Collect this many messages before extracting STM entries. Lower = faster updates, higher = fewer LLM calls.': '累积多少条消息后启动一次记忆提取流水线。越小响应越快，越大 API 调用越少。',
        'Max Unconsolidated STM': 'LTM 整合阈值',
        'Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.': '未整合 STM 达到此数量时触发长期记忆合并。较小值使 LTM 更新更频繁。',
        'Storage blocked: Memories cannot be saved. Disable tracking prevention for this site in your browser settings.':
            '存储被阻止：记忆无法保存。请在浏览器设置中为此站点禁用追踪防护。',
        'When enabled, the State Schema system tracks characters, factions, quests/power_slots with structured validation. Disable to use pure memory optimization without state management. State Schema depends on Memory System being enabled.':
            '启用后，状态Schema系统将追踪角色卡、势力、任务/战力槽，并进行结构化校验。禁用则仅使用纯记忆优化，无状态管理开销。状态Schema依赖记忆系统启用。',
        'Power Slots Templates': '战力槽模板',
        'Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.':
            '用于自动检测角色战力/能量系统的参考模板。可编辑标签以匹配您世界的命名方式。',
        'Add Slot': '添加模板',
        'Reset to Defaults': '恢复默认',
        'Delete': '删除',
        'API Key (leave empty for local proxy)': 'API Key（留空则使用本地代理）',
        'Local proxy uses ST server credentials. Fill URL only (no key) for local proxy, or full URL+Key for direct API access.':
            '本地代理使用 ST 服务器凭据。只填 URL（不填 Key）用于本地代理，或填完整 URL+Key 用于直连 API。',
        '以上参数将应用于记忆区 LLM 调用，数值越大消耗越多 token。': '以上参数将应用于记忆区 LLM 调用，数值越大消耗越多 token。',
    },
    'zh-tw': {
        'Enable State Schema': '啟用狀態Schema系統', 'Secondary API (for memory processing)': '副 API（用於記憶處理）',
        'API URL': 'API URL', 'API Key': 'API Key', 'Model': '模型',
        'Leave empty to use the same API as the main chat. Recommended: use a cheaper/faster model for memory extraction.':
            '留空則使用主聊天 API。建議使用更便宜/更快的模型進行記憶提取。',
        'Temperature': '溫度', 'narrative_label_enable_telemetry': '啟用測試模式（記錄日誌）',
        'Extraction Temperature': '記憶提取溫度', 'Retrieval Temperature': '檢索溫度',
        'STM/State/LTM memory extraction. Lower = more consistent summaries.': '記憶提取（STM/狀態/LTM）。值越低摘要越一致。',
        'Smart retrieval and tool queries. Higher = more creative answers.': '智能檢索與工具查詢。值越高回答越有創造性。',
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
        'Use Dynamic Field Discovery': '使用動態欄位發現',
        'Automatically discover state fields from character cards and world books. Disable to use preset schema fields.':
            '從角色卡和世界書自動發現狀態欄位。關閉則使用預設 Schema 欄位。',
        'Enable Smart Retrieval': '啟用智能檢索',
        'Memory Budget': '記憶預算',
        'STM Extraction Batch': '消息觸發閾值',
        'Collect this many messages before extracting STM entries. Lower = faster updates, higher = fewer LLM calls.': '累積多少條訊息後啟動一次記憶提取管線。越小響應越快，越大 API 調用越少。',
        'Max Unconsolidated STM': 'LTM 整合閾值',
        'Consolidate when unconsolidated STM exceeds this limit. Keeps memory manageable.': '未整合 STM 達到此數量時觸發長期記憶合併。較小值使 LTM 更新更頻繁。',
        'Storage blocked: Memories cannot be saved. Disable tracking prevention for this site in your browser settings.':
            '存儲被阻止：記憶無法儲存。請在瀏覽器設定中為此網站停用追蹤防護。',
        'When enabled, the State Schema system tracks characters, factions, quests/power_slots with structured validation. Disable to use pure memory optimization without state management. State Schema depends on Memory System being enabled.':
            '啟用後，狀態Schema系統將追蹤角色卡、勢力、任務/戰力槽，並進行結構化校驗。停用則僅使用純記憶最佳化，無狀態管理開銷。狀態Schema依賴記憶系統啟用。',
        'Power Slots Templates': '戰力槽模板',
        'Reference templates for auto-detecting character power/energy systems. Edit labels to match your world\'s naming.':
            '用於自動檢測角色戰力/能量系統的參考模板。可編輯標籤以匹配您世界的命名方式。',
        'Add Slot': '新增模板',
        'Reset to Defaults': '恢復預設',
        'Delete': '刪除',
        'API Key (leave empty for local proxy)': 'API Key（留空則使用本地代理）',
        'Local proxy uses ST server credentials. Fill URL only (no key) for local proxy, or full URL+Key for direct API access.':
            '本地代理使用 ST 伺服器憑據。只填 URL（不填 Key）用於本地代理，或填完整 URL+Key 用於直連 API。',
        '以上参数将应用于记忆区 LLM 调用，数值越大消耗越多 token。': '以上參數將應用於記憶區 LLM 調用，數值越大消耗越多 token。',
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

/**
 * STATE_FIELD_I18N — State 字段名三语翻译
 * 用于 vault 面板中角色卡、势力卡、任务卡中字段名的自然语言显示。
 * 未收录的字段名（如 LLM 动态发现的字段）将 fallback 到原始 key。
 */
export const STATE_FIELD_I18N = {
    'en': {
        // Character
        'name': 'Name', 'gender_age': 'Gender & Age', 'occupation': 'Occupation',
        'clothing_build': 'Appearance', 'personality': 'Personality', 'status': 'Status',
        'clothing_mode': 'Clothing Mode', 'inventory_mode': 'Inventory Mode',
        'inventory': 'Inventory', 'injuries': 'Injuries', 'status_effects': 'Status Effects',
        'power_slot_defs': 'Power Slots', 'power_slots': 'Power Values',
        'inner_thoughts': 'Inner Thoughts', 'affection': 'Affection',
        'relationship': 'Relationship', 'current_mood': 'Mood', 'past_experience': 'Background',
        // Faction
        'attitude_toward_player': 'Attitude', 'description': 'Description',
        'leader': 'Leader', 'notes': 'Notes',
        // Quest / Task / Goal / Event
        'type': 'Type', 'issuer': 'Issuer', 'desc': 'Description',
        'progress': 'Progress', 'posted_time': 'Posted', 'reward': 'Reward',
        'penalty': 'Penalty', 'started_time': 'Started', 'ended_time': 'Ended',
        'completed_time': 'Completed',
        // Core state
        'time': 'Time', 'scene': 'Scene', 'story_date': 'Story Date',
        'opening_summary': 'Opening Summary', 'dynamic_state': 'Dynamic Fields',
        'main_event': 'Main Event', 'present_characters': 'Present Characters',
        // Equipment (virtual)
        'equipment': 'Equipment',
    },
    'zh-cn': {
        'name': '名称', 'gender_age': '性别与年龄', 'occupation': '职业',
        'clothing_build': '外貌着装', 'personality': '性格', 'status': '状态',
        'clothing_mode': '服装模式', 'inventory_mode': '物品栏模式',
        'inventory': '物品栏', 'injuries': '伤势', 'status_effects': '状态效果',
        'power_slot_defs': '战力槽', 'power_slots': '战力值',
        'inner_thoughts': '内心想法', 'affection': '好感度',
        'relationship': '关系', 'current_mood': '当前情绪', 'past_experience': '过往经历',
        'attitude_toward_player': '态度', 'description': '描述',
        'leader': '首领', 'notes': '备注',
        'type': '类型', 'issuer': '发布者', 'desc': '描述',
        'progress': '进度', 'posted_time': '发布时间', 'reward': '奖励',
        'penalty': '惩罚', 'started_time': '开始时间', 'ended_time': '结束时间',
        'completed_time': '完成时间',
        'time': '时间', 'scene': '场景', 'story_date': '故事日期',
        'opening_summary': '开场设定', 'dynamic_state': '动态字段',
        'main_event': '主要事件', 'present_characters': '出场角色',
        'equipment': '装备',
    },
    'zh-tw': {
        'name': '名稱', 'gender_age': '性別與年齡', 'occupation': '職業',
        'clothing_build': '外貌著裝', 'personality': '性格', 'status': '狀態',
        'clothing_mode': '服裝模式', 'inventory_mode': '物品欄模式',
        'inventory': '物品欄', 'injuries': '傷勢', 'status_effects': '狀態效果',
        'power_slot_defs': '戰力槽', 'power_slots': '戰力值',
        'inner_thoughts': '內心想法', 'affection': '好感度',
        'relationship': '關係', 'current_mood': '當前情緒', 'past_experience': '過往經歷',
        'attitude_toward_player': '態度', 'description': '描述',
        'leader': '首領', 'notes': '備註',
        'type': '類型', 'issuer': '發佈者', 'desc': '描述',
        'progress': '進度', 'posted_time': '發佈時間', 'reward': '獎勵',
        'penalty': '懲罰', 'started_time': '開始時間', 'ended_time': '結束時間',
        'completed_time': '完成時間',
        'time': '時間', 'scene': '場景', 'story_date': '故事日期',
        'opening_summary': '開場設定', 'dynamic_state': '動態欄位',
        'main_event': '主要事件', 'present_characters': '出場角色',
        'equipment': '裝備',
    }
};

/**
 * t_field(key) — 翻译 state 字段名为当前语言的自然语言显示名。
 * 未收录的字段名 fallback 到原始 key（处理 LLM 动态发现的字段）。
 */
let _fieldLocale = 'en';
export function setFieldLocale(locale) { if (locale) _fieldLocale = locale; }
export function t_field(key) {
    const map = STATE_FIELD_I18N[_fieldLocale] || STATE_FIELD_I18N['en'] || {};
    return map[key] || key;
}
