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
