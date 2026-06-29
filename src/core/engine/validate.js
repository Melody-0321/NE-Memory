export function validateSTMOutput(parsed, vault, messageCount) {
    var errors = [];
    var stmEntries = parsed.stmEntries || [];

    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        if (!e.event || !String(e.event).trim()) {
            errors.push('stm_entries[' + i + '].event is REQUIRED');
        }
        if (!Array.isArray(e.entities)) e.entities = [];
    }

    // 新增：msgRange 验证
    if (stmEntries.length > 0 && messageCount !== undefined && messageCount > 0) {
        var rangeErrors = validateMsgRanges(stmEntries, messageCount);
        errors = errors.concat(rangeErrors);
    }

    return errors;
}

export function postFillSTM(parsed, vault) {
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

    // entities 后处理：NE-BANNER seed + 文本匹配兜底
    var state = content.state || {};
    var characters = state.characters || {};
    var factions = state.factions || {};
    var activeChars = content._active_characters || [];
    var allKnownNames = Object.keys(characters).concat(Object.keys(factions));
    if (allKnownNames.length > 0 || activeChars.length > 0) {
        stmEntries.forEach(function(e) {
            var entities = [];

            // NE-BANNER 在场角色 seed
            activeChars.forEach(function(name) {
                if (entities.indexOf(name) === -1) entities.push(name);
            });

            // 文本匹配兜底
            var eventText = (e.event || '') + (e.scene || '') + (e.summary || '');
            allKnownNames.forEach(function(name) {
                if (entities.indexOf(name) === -1 && eventText.indexOf(name) !== -1) {
                    entities.push(name);
                }
            });

            e.entities = entities;
        });
    } else {
        stmEntries.forEach(function(e) { e.entities = []; });
    }

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

// ─── msgRange 验证 ───

export function validateMsgRanges(stmEntries, messageCount) {
    var errors = [];
    if (stmEntries.length === 0) return errors;

    // 收集所有 range 并排序
    var ranges = [];
    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        var range = e.msgRange;
        if (!range || range.length !== 2) {
            errors.push('stm_entries[' + i + '].msgRange 缺失或格式错误');
            continue;
        }
        if (range[0] < 0 || range[1] >= messageCount) {
            errors.push('stm_entries[' + i + '].msgRange 越界: ' + range[0] + '-' + range[1] + ' (共' + messageCount + '条)');
        }
        if (range[0] > range[1]) {
            errors.push('stm_entries[' + i + '].msgRange 起始 > 结束');
        }
        ranges.push({ i: i, start: range[0], end: range[1] });
    }

    if (ranges.length === 0) return errors;

    // Check coverage: every message index 0..messageCount-1 must be covered
    ranges.sort(function(a, b) { return a.start - b.start; });
    var covered = new Array(messageCount);
    for (var k = 0; k < messageCount; k++) covered[k] = false;
    for (var i = 0; i < ranges.length; i++) {
        for (var j = ranges[i].start; j <= ranges[i].end && j < messageCount; j++) {
            covered[j] = true;
        }
    }
    var uncovered = [];
    for (var i = 0; i < messageCount; i++) {
        if (!covered[i]) uncovered.push(i);
    }
    if (uncovered.length > 0) {
        errors.push('未覆盖的消息索引: ' + uncovered.join(','));
    }

    // Check no overlap
    for (var i = 1; i < ranges.length; i++) {
        if (ranges[i].start <= ranges[i - 1].end) {
            errors.push('stm_entries[' + ranges[i].i + '] 的 msgRange 与上一条重叠');
        }
    }

    return errors;
}

