export function calRelativeTime(timestamp, storyTime) {
    if (!timestamp || !storyTime) return '';
    var diffMs = storyTime - timestamp;
    if (diffMs <= 0) return '';
    var diffSec = Math.round(diffMs / 1000);
    if (diffSec < 60) return '刚刚';
    var diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return '约 ' + diffMin + ' 分钟前';
    var diffHour = Math.round(diffMin / 60);
    if (diffHour < 24) return '约 ' + diffHour + ' 小时前';
    var diffDay = Math.round(diffHour / 24);
    if (diffDay < 7) return diffDay + ' 天前';
    if (diffDay < 30) return Math.round(diffDay / 7) + ' 周前';
    return Math.round(diffDay / 30) + ' 个月前';
}
