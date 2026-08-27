// P2-G1: 手势判定纯函数（供 setupMobileGestureClose 与单测使用）
// movedY: 下拉位移 px（正=向下）; velocity: 下滑速度 px/ms（正=向下）
export function swipeDecision(movedY, velocity) {
    if (typeof movedY !== 'number' || typeof velocity !== 'number' ||
        isNaN(movedY) || isNaN(velocity)) return false;
    return movedY > 60 || velocity > 0.5;
}
