export function calRelativeTime(timestamp, storyTime) {
    // P1-13: 入口 Number() 归一化，字符串时间戳（如 "2026-08-08T..."）转 NaN 时早退，
    // 避免 NaN 一路参与比较输出 "NaN 个月前"。
    var ts = Number(timestamp);
    var st = Number(storyTime);
    if (!ts || !st) return '';
    var diffMs = st - ts;
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
