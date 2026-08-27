// P2-G1: swipeDecision 纯函数边界测试
import { swipeDecision } from '../src/ui/gesture-math.js';

var passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  FAIL: ' + msg); } }

console.log('\n=== gesture-math: swipeDecision ===');

// 位移阈值边界
assert(swipeDecision(60, 0) === false, 'movedY=60 恰好在阈值，不关闭（>60 才关）');
assert(swipeDecision(60.1, 0) === true, 'movedY=60.1 超过位移阈值，关闭');
assert(swipeDecision(100, 0) === true, '大幅下拉关闭');

// 速度阈值边界
assert(swipeDecision(0, 0.5) === false, 'velocity=0.5 恰好在阈值，不关闭（>0.5 才关）');
assert(swipeDecision(10, 0.51) === true, '轻位移+快速 fling 关闭');

// 负值（上滑/上抛）永不关闭
assert(swipeDecision(-100, 0) === false, '负位移不关闭');
assert(swipeDecision(0, -2) === false, '负速度不关闭');
assert(swipeDecision(-10, -2) === false, '负位移+负速度不关闭');

// 组合：位移不够但速度够
assert(swipeDecision(30, 1.2) === true, '位移不够速度够，关闭');
// 组合：都不够
assert(swipeDecision(30, 0.2) === false, '位移速度都不够，回弹');

// 非法输入
assert(swipeDecision(NaN, 1) === false, 'NaN 位移返回 false');
assert(swipeDecision(100, undefined) === false, 'undefined 速度返回 false');
assert(swipeDecision('x', 1) === false, '非数字位移返回 false');

console.log('\n--- gesture-math: ' + passed + ' passed, ' + failed + ' failed ---');
if (failed > 0) process.exit(1);
