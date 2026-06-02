export function validateSTMOutput(parsed, vault) {
    var errors = [];
    var checkpoints = parsed._checkpoints;
    var stmEntries = parsed.stmEntries || [];

    if (checkpoints !== undefined) {
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

    return errors;
}

export function postFillSTM(parsed, vault) {
    var checkpoints = (parsed._checkpoints) || {};
    var content = vault && vault.content || {};
    var state = content.state || {};
    var stmEntries = parsed.stmEntries || [];

    var defaultPeriod = mergeStoryPeriod(checkpoints.time || state.time || content.story_time, content.story_date);
    var defaultScene = checkpoints.scene || state.scene || content.story_scene || '';

    for (var i = 0; i < stmEntries.length; i++) {
        var e = stmEntries[i];
        e.period = defaultPeriod;
        e.scene = defaultScene;
    }

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
        if (!e.period || !String(e.period).trim()) {
            errors.push('ltm_entries[' + i + '].period is REQUIRED');
        }
        if (!e.scene || !String(e.scene).trim()) {
            errors.push('ltm_entries[' + i + '].scene is REQUIRED');
        }
        if (!e.stm_refs || e.stm_refs.length === 0) {
            errors.push('ltm_entries[' + i + '].stm_refs is REQUIRED');
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

        if (!e.scene || !String(e.scene).trim()) {
            var scenes = [];
            (e.stm_refs || []).forEach(function(refId) {
                var found = sourceSTMList.find(function(s) { return s.id === refId; });
                if (found && found.scene) scenes.push(found.scene);
            });
            if (scenes.length > 0) {
                var sceneCounts = {};
                scenes.forEach(function(s) { sceneCounts[s] = (sceneCounts[s] || 0) + 1; });
                var best = '';
                var bestCount = 0;
                Object.keys(sceneCounts).forEach(function(k) {
                    if (sceneCounts[k] > bestCount) { best = k; bestCount = sceneCounts[k]; }
                });
                e.scene = best;
            }
        }

        if (!e.id) {
            e.id = 'ltm_' + (Math.floor(Date.now() / 1000));
        }
    }

    return result;
}

var KNOWN_STATE_FIELDS = ['time', 'scene', 'story_date'];

export function whitelistStateChanges(changes) {
    var filtered = {};
    Object.keys(changes || {}).forEach(function(key) {
        if (KNOWN_STATE_FIELDS.indexOf(key) !== -1) {
            filtered[key] = changes[key];
        }
    });
    return filtered;
}
