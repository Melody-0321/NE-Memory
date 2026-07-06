/**
 * @param {import('../types.js').STMEvent} entry
 * @param {Object} [aliasesMap]
 * @returns {string}
 */
export function buildSearchableText(entry, aliasesMap) {
    var parts = [];
    if (entry.period) parts.push(entry.period);
    if (entry.time_range) parts.push(entry.time_range);
    if (entry.time_label) parts.push(entry.time_label);
    if (entry.scene) parts.push(entry.scene);
    if (entry.event) parts.push(entry.event);
    if (entry.translation) parts.push(entry.translation);
    if (entry.entities && Array.isArray(entry.entities)) {
        entry.entities.forEach(function(en) {
            var n = typeof en === 'string' ? en : en.name;
            if (n) {
                parts.push(n);
                var aliases = aliasesMap ? aliasesMap[n] : null;
                if (aliases && Array.isArray(aliases)) {
                    aliases.forEach(function(a) { if (a) parts.push(a); });
                }
            }
        });
    }
    return parts.join(' ');
}
