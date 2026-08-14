export function validateSTMOutput(parsed, vault, messageCount, windowStart, windowEnd) {
    var errors = [];
    var stmEntries = parsed.stmEntries || [];

    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        if (!e.event || !String(e.event).trim()) {
            errors.push('stm_entries[' + i + '].event is REQUIRED');
        }
        // present_characters: optional but if present must be string array
        if (e.present_characters !== undefined && !Array.isArray(e.present_characters)) {
            errors.push('stm_entries[' + i + '].present_characters must be an array of strings');
        }
        // character_psyche: optional but if present must be an object
        if (e.character_psyche !== undefined && (typeof e.character_psyche !== 'object' || Array.isArray(e.character_psyche) || e.character_psyche === null)) {
            errors.push('stm_entries[' + i + '].character_psyche must be an object');
        }
    }

    // 新增：msgRange 验证
    if (stmEntries.length > 0 && messageCount !== undefined && messageCount > 0) {
        var rangeErrors = validateMsgRanges(stmEntries, messageCount, windowStart, windowEnd);
        errors = errors.concat(rangeErrors);
    }

    return errors;
}

export function postFillSTM(parsed, vault, stateVault) {
    var content = vault && vault.content || {};
    var stmEntries = parsed.stmEntries || [];

    if (!content.story_time) {
        if (stmEntries.length > 0) {
            var firstPeriod = stmEntries[0].period;
            if (firstPeriod && firstPeriod !== '-' && firstPeriod !== '未知') {
                var dtMatch = firstPeriod.match(/(\d{4}-\d{2}-\d{2})/);
                if (dtMatch) content.story_date = dtMatch[1];
                content.story_time = firstPeriod;
            } else {
                content.story_time = 'Day 1';
            }
        } else {
            content.story_time = 'Day 1';
        }
    }
    if (!content.story_date && content.story_time && content.story_time !== 'Day 1') {
        content.story_date = 'Day 1';
    }
    if (!content.story_scene) { content.story_scene = '未知'; }

    // present_characters / character_psyche 由 LLM 直接输出，不再后置填充。
    // 仅为缺失字段提供默认空值，保证下游一致性。
    stmEntries.forEach(function(e) {
        if (!Array.isArray(e.present_characters)) e.present_characters = [];
        if (!e.character_psyche || typeof e.character_psyche !== 'object' || Array.isArray(e.character_psyche)) {
            e.character_psyche = {};
        }
    });

    return parsed;
}

export function validateLtmDecision(result) {
    var action = result.action;
    if (action !== 'append' && action !== 'close_and_new') {
        console.warn('[NE] LTM decision invalid action:', action);
        return null;
    }
    if (result.updated_title && String(result.updated_title).length > 60) {
        result.updated_title = String(result.updated_title).substring(0, 60);
    }
    return result;
}

export function validateMetaLtmDecision(result) {
    var action = result.action;
    if (action !== 'append' && action !== 'close_and_new') {
        console.warn('[NE Meta-LTM] decision invalid action:', action);
        return null;
    }
    if (result.updated_title && String(result.updated_title).length > 60) {
        result.updated_title = String(result.updated_title).substring(0, 60);
    }
    return result;
}

// ─── 悬念簿决策验证 ───

var VALID_SUSPENSE_ACTIONS = ['raise', 'develop', 'resolve'];
var VALID_SUSPENSE_CATEGORIES = ['plan', 'suspense'];
var VALID_SUSPENSE_OUTCOMES = ['done', 'cancelled', 'failed'];

export function validateSuspenseDecisions(decisions) {
    if (!Array.isArray(decisions)) {
        console.warn('[NE Suspense] decisions is not an array:', typeof decisions);
        return null;
    }

    var valid = [];
    for (var i = 0; i < decisions.length; i++) {
        var d = decisions[i];
        if (!d || typeof d !== 'object') continue;

        var action = d.action;
        if (VALID_SUSPENSE_ACTIONS.indexOf(action) === -1) {
            console.warn('[NE Suspense] decision[' + i + '] invalid action:', action);
            continue;
        }

        if (action === 'raise') {
            if (!d.title || !String(d.title).trim()) {
                console.warn('[NE Suspense] raise decision[' + i + '] missing title');
                continue;
            }
            if (d.title && String(d.title).length > 40) {
                d.title = String(d.title).substring(0, 40);
            }
            if (d.event && String(d.event).length > 200) {
                d.event = String(d.event).substring(0, 200);
            }
            if (d.category && VALID_SUSPENSE_CATEGORIES.indexOf(d.category) === -1) {
                d.category = 'suspense';
            }
        } else {
            if (!d.hook_id || !String(d.hook_id).trim()) {
                console.warn('[NE Suspense] ' + action + ' decision[' + i + '] missing hook_id');
                continue;
            }
            if (action === 'resolve') {
                if (d.outcome && VALID_SUSPENSE_OUTCOMES.indexOf(d.outcome) === -1) {
                    d.outcome = 'done';
                }
                if (!d.outcome) d.outcome = 'done';
                if (d.resolution_note && String(d.resolution_note).length > 200) {
                    d.resolution_note = String(d.resolution_note).substring(0, 200);
                }
            }
        }

        valid.push(d);
    }

    return valid;
}

// ─── msgRange 验证 ───

export function validateMsgRanges(stmEntries, messageCount, windowStart, windowEnd) {
    var errors = [];
    if (stmEntries.length === 0) return errors;
    // P0-4: msgRange 是全局绝对消息索引，校验基准改为"本次输入窗口"的全局区间；
    // 默认 0..messageCount-1 保持旧签名（局部消息数场景）兼容。
    if (windowStart === undefined) windowStart = 0;
    if (windowEnd === undefined) windowEnd = messageCount - 1;

    // 收集所有 range 并排序
    var ranges = [];
    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        var range = e.msgRange;
        if (!range || range.length !== 2) {
            errors.push('stm_entries[' + i + '].msgRange 缺失或格式错误');
            continue;
        }
        if (range[0] < windowStart || range[1] > windowEnd) {
            errors.push('stm_entries[' + i + '].msgRange 越界: ' + range[0] + '-' + range[1] + ' (窗口 ' + windowStart + '-' + windowEnd + ')');
        }
        if (range[0] > range[1]) {
            errors.push('stm_entries[' + i + '].msgRange 起始 > 结束');
        }
        ranges.push({ i: i, start: range[0], end: range[1] });
    }

    if (ranges.length === 0) return errors;

    // 连续性检查：按窗口边界锚定，要求 LLM 输出无空洞覆盖本次输入窗口
    ranges.sort(function(a, b) { return a.start - b.start; });
    if (ranges[0].start !== windowStart) {
        errors.push('未覆盖的消息索引: ' + windowStart + '-' + (ranges[0].start - 1) + ' (窗口起点 ' + windowStart + ' 未被覆盖)');
    }
    for (var i = 1; i < ranges.length; i++) {
        if (ranges[i].start <= ranges[i - 1].end) {
            errors.push('stm_entries[' + ranges[i].i + '] 的 msgRange 与上一条重叠');
        } else if (ranges[i].start > ranges[i - 1].end + 1) {
            errors.push('未覆盖的消息索引: ' + (ranges[i - 1].end + 1) + '-' + (ranges[i].start - 1));
        }
    }
    if (ranges[ranges.length - 1].end !== windowEnd) {
        errors.push('未覆盖的消息索引: ' + (ranges[ranges.length - 1].end + 1) + '-' + windowEnd + ' (窗口终点 ' + windowEnd + ' 未被覆盖)');
    }

    return errors;
}

