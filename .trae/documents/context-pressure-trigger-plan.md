# Context Pressure Trigger — 实现计划

## 概要

在现有消息数/词数触发条件之外，增加**上下文压力**触发条件。当未录入消息（pendingMessages）的估算 token 量占"可用上下文"比例超过 50% 时，直接触发 STM 提取。

## 当前状态

`events.js` 中 `onMessageReceived` 的触发条件链（L154-156）：

```js
pendingMessages.length >= getStmBatchSize()    // 消息数模式（auto 动态）
|| totalWords >= getStmWordsThreshold()          // 词数模式（固定 500）
|| (pendingMessages.length >= 3 && totalWords >= 100)  // 最低保底
```

## 改动范围

涉及 3 个文件：

### 1. `src/events.js`

#### 1a. 新增全局变量

```js
let getContextBudgetFn = null;
let lastMemoryInjectionTokens = 0;
```

#### 1b. 新增 `setGetContextBudgetFn`

```js
export function setGetContextBudgetFn(fn) {
    getContextBudgetFn = fn;
}
```

#### 1c. 新增 `trackMemoryInjection`

```js
export function trackMemoryInjection(tokenCount) {
    lastMemoryInjectionTokens = tokenCount;
}
```

#### 1d. 新增 `computeContextPressure()`

```js
function computeContextPressure(pendingTokenCount) {
    if (!getContextBudgetFn) return -1;
    var maxCtx = getContextBudgetFn();
    if (!maxCtx || maxCtx <= 0) return -1;
    var usable = maxCtx - 1500 - lastMemoryInjectionTokens;
    if (usable <= 0) return 1;
    return pendingTokenCount / usable;
}
```

#### 1e. 修改 onMessageReceived() 触发条件

在已有词数统计后新增 token 估算和压力检查：

```js
const pendingTokenCount = pendingMessages.reduce((sum, m) => sum + Math.round((m.content || '').length / 3.5), 0);
var pressureVal = computeContextPressure(pendingTokenCount);
var shouldRunPipeline = pendingMessages.length >= await getStmBatchSize()
    || totalWords >= getStmWordsThreshold()
    || (pendingMessages.length >= 3 && totalWords >= 100)
    || (pressureVal >= 0.50 && pressureVal > 0);
```

#### 1f. 修改 flushPendingMessages() 二次检查

```js
const pendingTokenCount = pendingMessages.reduce((sum, m) => sum + Math.round((m.content || '').length / 3.5), 0);
var pressureVal = computeContextPressure(pendingTokenCount);
if (pendingMessages.length < await getStmBatchSize() && totalWords < getStmWordsThreshold() && pressureVal < 0.50) {
    // return early
}
```

#### 1g. 修改 onBeforeGenerate() — 追踪注入 token 量

在注入成功的位置（L310-323 附近）添加：
```js
trackMemoryInjection(charEstimate);
```

### 2. `src/index.js`

#### 2a. 新增 `getContextBudget()` 函数

```js
function getContextBudget() {
    try {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            return SillyTavern.getContext().maxContext || 4096;
        }
    } catch (e) {}
    return 4096;
}
```

#### 2b. 注入到 events.js

在 `init()` 中 `setContextFns` 之后添加：
```js
import { setGetContextBudgetFn } from './events.js';
setGetContextBudgetFn(getContextBudget);
```

### 3. `src/params.js`

无改动。

## 阈值推演（50%）

```
4K:  usable ≈ 4096 - 1500 - 800 ≈ 1796
     pending 50% ≈ 898 token ≈ 2-3 条长回复
     → auto stmBatch(≈6×200=1200) 装不下窗口，压力模式提前触发 ✓

8K:  usable ≈ 8192 - 1500 - 1000 ≈ 5692
     pending 50% ≈ 2846 token ≈ 5-7 条
     → 与 auto stmBatch(≈6-8 条) 接近重合，平滑过渡

32K: usable ≈ 32768 - 1500 - 1500 ≈ 29768
     pending 50% ≈ 14884 token → auto 先触发
     → 压力作保底安全网
```

## 验证

1. `npm run build` 通过
2. 推送后测试 4K 窗口 + 长回复场景确认压力触发
