# 测试集加入原文消息计划（修订版）

## 一、真实数据基准

从真实 SillyTavern 聊天历史提取的压缩比：

| 指标 | 真实 |
|------|------|
| STM 平均 | 52 字符 |
| 原文正文平均/STM | **1,279 字符** |
| 压缩比 | **22.8x** |

**修订要点**：不再写 ~100 字的简短对话，而是写**完整的场景叙事**（动作描写、环境氛围、对话、内心活动），使每条 STM 对应的消息总长达到 800-1500 字符。

## 二、执行策略

**逐 Phase 写，逐条验证。**

8 个 Phase，按顺序：

1. Phase 1（stm_01 ~ stm_20，msg 0-33）→ 20 STM，34 消息
2. Phase 2（stm_21 ~ stm_43，msg 34-75）→ 23 STM，42 消息
3. Phase 3（stm_44 ~ stm_49，msg 76-84）→ 6 STM，9 消息
4. Phase 4（stm_50 ~ stm_78，msg 85-132）→ 29 STM，48 消息
5. Phase 5（stm_79 ~ stm_110，msg 133-190）→ 32 STM，48 消息
6. Phase 6（stm_111 ~ stm_133，msg 191-231）→ 23 STM，41 消息
7. Phase 7（stm_134 ~ stm_144，msg 232-251）→ 11 STM，20 消息

每写完一个 Phase：
- 跑 `npm run build` 确认 fixture 可解析
- 交叉验证 STM event 字段在消息中有支撑

## 三、消息结构

```js
{ id: 0, name: 'system', role: 'narrator', mes: '场景叙事...' },
{ id: 1, name: '江岚', role: 'character', mes: '对话' },
{ id: 2, name: 'system', role: 'narrator', mes: '动作+环境+过渡...' },
{ id: 3, name: '安然', role: 'character', mes: '对话' },
```

- `name: 'system'` + `role: 'narrator'` = 旁白（场景描写、动作、环境、过渡叙事）
- `name: '江岚'/'安然'/...` + `role: 'character'` = 角色对话
- 格式：纯文本，中文，无 markdown 无 XML 标签
- 每条消息 200-800 字，写真正的叙事性内容

## 四、后续步骤

写完所有消息后：
- 修改 benchmark-llm-judge.js 接入 prefetch + 4 路对比
- 修改 benchmark-packaging.js 接入 prefetch
- 跑 4 路 LLM-as-judge 验证 prefetch 效果
