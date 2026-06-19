import { CORE_STATE_FIELDS } from '../vault/schema.js';
import { getStmMinLtmMerge } from '../settings.js';

export function validateSTMOutput(parsed, vault, messageCount) {
    var errors = [];
    var checkpoints = parsed._checkpoints;
    var stmEntries = parsed.stmEntries || [];

    if (checkpoints !== undefined && checkpoints !== null) {
        if (!checkpoints || typeof checkpoints !== 'object') {
            errors.push('_checkpoints block is REQUIRED when using new format');
        } else {
            if (!checkpoints.time || !String(checkpoints.time).trim()) {
                errors.push('_checkpoints.time is REQUIRED (current story time, even if unchanged)');
            }
            if (!checkpoints.scene || !String(checkpoints.scene).trim()) {
                errors.push('_checkpoints.scene is REQUIRED (current scene, even if unchanged)');
            }
        }
    }

    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        if (!e.event || !String(e.event).trim()) {
            errors.push('stm_entries[' + i + '].event is REQUIRED');
        }
    }

    // 新增：msgRange 验证
    if (stmEntries.length > 0 && messageCount !== undefined && messageCount > 0) {
        var rangeErrors = validateMsgRanges(stmEntries, messageCount);
        errors = errors.concat(rangeErrors);
    }

    return errors;
}

export function postFillSTM(parsed, vault) {
    var checkpoints = (parsed._checkpoints) || {};
    var content = vault && vault.content || {};
    var state = content.state || {};
    var stmEntries = parsed.stmEntries || [];

    // 不再从 vault state 填充 entry 的 period/scene。
    // 这些值由 LLM sub-agent 输出（extractEntryFields 正则提取），
    // vault state 的值在批处理历史时会错（全贴同一个当前时间）。

    if (checkpoints.time && checkpoints.time !== 'same') {
        content.story_time = String(checkpoints.time);
        if (!state.time) { if (!content.state) content.state = {}; content.state.time = String(checkpoints.time); }
    } else if (stmEntries.length > 0 && stmEntries[0].period) {
        var inferredTime = String(stmEntries[0].period).split(' ─ ')[0];
        content.story_time = inferredTime;
    }
    if (!content.story_time) {
        content.story_time = 'Day 1';
    }
    if (checkpoints.scene) {
        content.story_scene = String(checkpoints.scene);
        if (!state.scene) { if (!content.state) content.state = {}; content.state.scene = String(checkpoints.scene); }
    } else if (stmEntries.length > 0 && stmEntries[0].scene) {
        content.story_scene = String(stmEntries[0].scene);
    }
    if (!content.story_scene) {
        content.story_scene = '未知';
    }

    return parsed;
}

export function mergeStoryPeriod(storyTime, storyDate) {
    var parts = [];
    if (storyTime) parts.push(storyTime);
    if (storyDate) parts.push(storyDate);
    return parts.join(' ─ ');
}

export function validateLTMOutput(result) {
    var errors = [];
    var entries = result.ltm_entries || [];

    if (entries.length === 0) {
        return errors;
    }

    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.event || !String(e.event).trim()) {
            errors.push('ltm_entries[' + i + '].event is REQUIRED');
        }
        if (e.title !== undefined && !String(e.title).trim()) {
            errors.push('ltm_entries[' + i + '].title is empty — omit the field if not set');
        }
        if (!e.stm_refs || e.stm_refs.length === 0) {
            errors.push('ltm_entries[' + i + '].stm_refs is REQUIRED');
        }
        if (e.stm_refs && e.stm_refs.length < getStmMinLtmMerge()) {
            errors.push('ltm_entries[' + i + '] must have at least ' + getStmMinLtmMerge() + ' stm_refs');
        }
    }

    return errors;
}

export function postFillLTM(result, sourceSTMList) {
    var entries = result.ltm_entries || [];

    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];

        if (!e.stm_refs || e.stm_refs.length === 0) {
            e.stm_refs = sourceSTMList.map(function(s) { return s.id; }).filter(Boolean);
        } else {
            var validCount = 0;
            var invalidCount = 0;
            for (var j = 0; j < e.stm_refs.length; j++) {
                if (sourceSTMList.find(function(s) { return s.id === e.stm_refs[j]; })) {
                    validCount++;
                } else {
                    invalidCount++;
                }
            }
            if (invalidCount > 0) {
                // 尝试逐个修复（可能缺少 stm_ 前缀，或 LLM 用了数字序号）
                var fixedRefs = [];
                for (var j = 0; j < e.stm_refs.length; j++) {
                    var ref = e.stm_refs[j];
                    if (sourceSTMList.find(function(s) { return s.id === ref; })) {
                        fixedRefs.push(ref);
                    } else if (sourceSTMList.find(function(s) { return s.id === 'stm_' + ref; })) {
                        fixedRefs.push('stm_' + ref);
                    } else {
                        // 尝试按序号匹配 (LLM 可能返回 "1" 对应 stmIds[0])
                        var idx = parseInt(ref, 10);
                        if (!isNaN(idx) && idx >= 1 && idx <= sourceSTMList.length) {
                            var matchId = sourceSTMList[idx - 1].id;
                            // 避免重复添加
                            if (fixedRefs.indexOf(matchId) === -1) {
                                fixedRefs.push(matchId);
                            }
                        }
                    }
                }
                if (fixedRefs.length > 0) {
                    console.log('[NE] postFillLTM: fixed ' + fixedRefs.length + ' stm_refs for LTM', e.id || '(new)', '(was ' + invalidCount + ' invalid)');
                    e.stm_refs = fixedRefs;
                } else {
                    console.warn('[NE] postFillLTM: all stm_refs invalid, assigning all source STMs for LTM', e.id || '(new)');
                    e.stm_refs = sourceSTMList.map(function(s) { return s.id; }).filter(Boolean);
                }
            }
        }

        if (!e.period || !String(e.period).trim()) {
            var periods = [];
            (e.stm_refs || []).forEach(function(refId) {
                var found = sourceSTMList.find(function(s) { return s.id === refId; });
                if (found && found.period) periods.push(found.period);
            });
            if (periods.length > 0) {
                var unique = [];
                periods.forEach(function(p) { if (unique.indexOf(p) === -1) unique.push(p); });
                e.period = unique.join('→');
            }
        }

        if (!e.id) {
            e.id = 'ltm_' + (Math.floor(Date.now() / 1000));
        }

        if (!e.title && e.event) {
            e.title = e.event.substring(0, 40);
        }

        if (!e.status) {
            e.status = 'closed';
        }
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

export function whitelistStateChanges(changes) {
    var filtered = {};
    Object.keys(changes || {}).forEach(function(key) {
        if (CORE_STATE_FIELDS.indexOf(key) !== -1) {
            filtered[key] = changes[key];
        }
    });
    return filtered;
}
