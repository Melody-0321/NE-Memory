# 测试框架升级计划

## 概要

基于当前讨论结论，升级测试框架：
1. **test-case.md 模板更新**：新增 `minRounds` / `maxRounds` / `expectedRounds` 字段
2. **Driver 的 `[DONE]` 处理**：minRounds 前忽略、maxRounds 强制截断、自然结束 vs 截断结束区分写入 trace
3. **当前用例全部适配新字段**
4. **新测试用例编写**：08-11（SmartPush 检索优化）、55（检索 System Prompt）、58（短链 inline）

---

## 改动清单

### 1. test-cases/_template.md — 模板更新

**当前签名区（运行参数）：**
```yaml
## 运行参数
- maxRounds: 7
- timeoutPerRound: 120000
```

**改为：**
```yaml
## 运行参数
- minRounds: 3
- maxRounds: 10
- expectedRounds: 5-7
- timeoutPerRound: 120000
```

**对话设计部分新增说明：**
```diff
 Driver 跟随 AI 已有故事自然互动。**不编造特定故事背景。**
 
+轮次参考：预期 5-7 轮内自然完成。低于 3 轮时 [DONE] 无效。达到 maxRounds 时强制结束。
+
 引导策略：
```

**模板新增"运行参数说明"节段底部：**
```
- `minRounds`: 软下限，此轮数前 [DONE] 被忽略，driver 强制继续
- `maxRounds`: 硬上限，此轮数后强制截断
- `expectedRounds`: 给 LLM 的参考区间，指导 [DONE] 节奏
```

---

### 2. src/test-runner/driver.js — [DONE] 处理升级

**文件：** src/test-runner/driver.js

**改动点：**

#### 2a. 从 testCase 中读取新字段

在 `runTestLoop` 中：
```javascript
var minRounds = testCase.minRounds || 0;
var maxRounds = testCase.maxRounds || 10;
var expectedRounds = testCase.expectedRounds || '5-8';
```

#### 2b. Driver System Prompt 新增轮次指导

在 `buildPlayerPrompt()` 或动态测试状态块 `buildTestStateBlock()` 中新增：
```diff
+轮次信息：
+- 你可以在达到预期轮次后（当前状态：{round}/{expectedRounds}）自然结束。
+- 如果测试目标尚未达成，你可以继续推进。
+- 结束时在输出末尾加上 [DONE] 原因。
```

#### 2c. [DONE] 检测逻辑升级

```javascript
// 当前 (line 391-394):
var doneIdx = trimmed.indexOf('[DONE]');
if (doneIdx !== -1) {
    if (doneIdx === 0) return '__TEST_DONE__';
    return trimmed.substring(0, doneIdx).trim() || '__TEST_DONE__';
}

// 改为:
var doneIdx = trimmed.indexOf('[DONE]');
if (doneIdx !== -1) {
    if (currentRound < minRounds) {
        // 软下限内 [DONE] 无效，仍提交消息，但标记到 trace
        logger.log('[DONE] ignored before minRounds');
    } else {
        if (doneIdx === 0) return '__TEST_DONE__';
        return trimmed.substring(0, doneIdx).trim() || '__TEST_DONE__';
    }
}
```

#### 2d. 主循环截断逻辑

```javascript
// 当前循环 (大概 line 150-180):
for (var round = 1; round <= maxRounds; round++) {

// 改为:
for (var round = 1; round <= maxRounds; round++) {
    // ... 正常流程 ...
    // 在循环末尾检测是否达到 maxRounds 且未 done
    if (round >= maxRounds) {
        logger.log('[FORCE_STOP] maxRounds reached');
        break;
    }
}
```

#### 2e. 结束类型写入 trace

在 trace 头部或末尾新增字段：
```javascript
var endType = '';
if (doneDetected) {
    endType = 'natural_done';
} else if (round >= maxRounds) {
    endType = 'forced_max_rounds';
} else {
    endType = 'completed';
}
```

---

### 3. src/test-runner/files.js — testCase 解析更新

**文件：** src/test-runner/files.js

**改动点：** `parseTestCase()` 函数添加新字段的默认值处理

```javascript
// 当前
return {
    maxRounds: raw.maxRounds || 8,
    timeoutPerRound: raw.timeoutPerRound || 120000,
    ...
};

// 改为
return {
    minRounds: raw.minRounds || 0,
    maxRounds: raw.maxRounds || 10,
    expectedRounds: raw.expectedRounds || '5-8',
    timeoutPerRound: raw.timeoutPerRound || 120000,
    ...
};
```

---

### 4. 现有测试用例适配

#### 4a. test-cases/_template.md
- 更新签名区为新的三字段格式
- 更新对话设计说明

#### 4b. test-cases/smartpush-01-not-empty/test-case.md
```diff
- maxRounds: 7
+ minRounds: 4     # STM 需要至少 4 轮 batch 管线触发
+ maxRounds: 10
+ expectedRounds: 5-7
```

#### 4c. test-cases/smartpush-02-no-markers/test-case.md（基于 01 的报告已通过，但结构仍需要更新）
```diff
- maxRounds: 6
+ minRounds: 4
+ maxRounds: 10
+ expectedRounds: 5-7
```

---

### 5. 新测试用例编写

#### 5a. smartpush-08-visible-window-skip

**文件：** test-cases/smartpush-08-visible-window-skip/test-case.md

| 字段 | 值 |
|------|-----|
| minRounds | 6 |
| maxRounds | 12 |
| expectedRounds | 7-10 |
| 前置条件 | SmartPush 启用、stmBatch >= 4 |
| 对话设计 | 同一场景持续推进 10+ 轮，积累充足的 STM，产生"窗口内事件"和"窗口外事件"的区分 |
| 结构性断言 | `exists`: smartpush_injection (injection 非空) |
| 语义性断言 | 注入内容是否聚焦于窗口外的事件而非窗口内重复内容；注入中是否可见 `[msg_xx]` 标注 |

#### 5b. smartpush-09-visible-window-precision

| 字段 | 值 |
|------|-----|
| minRounds | 8 |
| maxRounds | 30 |
| expectedRounds | 15-20 |
| 对话设计 | **长对话测试**，driver 持续推进对话到 20+ 轮，让早期轮次超出 maxContext |
| 结构性断言 | 无（运行时通过 monitor 验证可见窗口计算） |
| 语义性断言 | 无 |
| **运行时验证** | 通过 trace 中的 visibleWindow 数据手工确认截断正确 |

#### 5c. smartpush-10-prefetch-completeness

| 字段 | 值 |
|------|-----|
| minRounds | 4 |
| maxRounds | 10 |
| expectedRounds | 5-8 |
| 结构性断言 | `exists`: smartpush_injection |
| **trace 验证** | 通过 trace 手工确认：prefetch 包含所有 msg_id 的原文、每行带 `[msg_xx]` 前缀、总字符 ≤ 2000 |

#### 5d. smartpush-11-query-includes-ai

| 字段 | 值 |
|------|-----|
| minRounds | 4 |
| maxRounds | 10 |
| expectedRounds | 5-7 |
| **trace 验证** | 通过 trace 手工确认 system prompt 中的 query 包含最近的 AI 回复和 user 输入 |

#### 5e. retrieval-55-system-prompt-structure

| 字段 | 值 |
|------|-----|
| minRounds | 4 |
| maxRounds | 10 |
| expectedRounds | 5-7 |
| **trace 验证** | 确认 system prompt 包含 `##当前对话可见窗口`、`##最近一轮对话上下文`、精简后的工具 guidance |
| 语义性断言 | 可见窗口节段是否包含 msg_id 标注和"主 LLM 已知/未知"说明 |

#### 5f. retrieval-58-short-chain-inline

| 字段 | 值 |
|------|-----|
| minRounds | 6 |
| maxRounds | 12 |
| expectedRounds | 7-10 |
| 对话设计 | 引入 3+ 角色，让某些角色仅有 2-3 次出场 |
| **trace 验证** | 确认 availableChains 中 count ≤ 5 的链已被 inline；chain > 5 的仍保留在 availableChains |

---

### 6. src/index.js — _testPresets 更新

为新增的 test cases 添加对应的 preset 配置（参考现有的 smartpush01/smartpush02 格式），包含新字段 `minRounds` 和 `expectedRounds`：

```javascript
var testPresets = {
    smartpush01: {
        name: 'smartpush-01',
        folder: 'smartpush-01-not-empty',
        title: 'SmartPush 注入非空',
        minRounds: 4,
        maxRounds: 10,
        expectedRounds: '5-7',
        ...
    },
    smartpush02: { ... },
    smartpush08: { ... },
    ...
};
```

---

### 7. 关于 `mergePipelines` 改为 async 的兼容性检查

`mergePipelines` 的调用方（`formatSmartContext` 在 `vault-panel.js` 中）已经是 `await mergePipelines(...)`。但需要排查是否有其他调用路径：

**搜索范围：**
- `mergePipelines` 除了在 `formatSmartContext` 中被调用外，是否还被其他代码直接调用？
- `buildRetrievalPrompt` 的新参数 `extraOptions` 除了 `buildRetrievalMessages` 外是否还有其他调用？

如果发现有其他同步调用路径，需要一并更新为 await。

---

## 分组建议

| 组 | 用例 | 可合并？ | 说明 |
|----|------|---------|------|
| A | 01、02、05 | ✅ 可合并 | 同一故事运行，断言互补，总量 ≤ 7 轮 |
| B | 08、10、11、55、58 | ✅ 可合并 | 都是检索优化相关的 trace 验证，断言不冲突 |
| C | 03、04、06、07 | ❌ 各自独立 | 需要不同的前提条件 |
| D | 09 | ❌ 单独运行 | 需要 30 轮长对话 |

**第一阶段（当前）建议：** 每个用例单次运行，建立稳定的 baseline
**第二阶段（稳定后）建议：** A 组合并为一个 driver run，B 组合并为一个 driver run

---

## 验证

1. 构建通过（`npx rollup -c`）
2. smartpush-01 在新框架下通过（minRounds=4 时前 3 轮 done 被忽略，第 5-6 轮正常 done）
3. trace 中包含 `endType` 字段
4. 新字段在 `parseTestCase` 中有默认值，旧 preset 兼容
