# 权威数字表（canonical numbers）

> 用途：博客引用的每个数字必须能溯源到本表一行。本表是"版本/口径"的唯一事实源。
> 版本四元组：`fixture / queries(含 split 文件) / split / config / judge prompt`（sha256 前 12 位，config 剥离 API key）。
> 生成规则：新报告头部由 `report-provenance.js` 写入四元组；与下表登记值不符时脚本打印醒目警告，禁止在旧口径上写新结论。
> 维护：P0-1 封存运行后登记权威四元组；新报告数字先入表、后进博客。

---

## 0. 口径约定

| 口径 | 定义 | 用途 |
|---|---|---|
| `dev`（18 条） | P0-0 分层（6 narr + 12 tgt，含 hard-bone q25/q27） | 一切调参 / 探索 / 变形测试 |
| `holdout`（10 条） | P0-0 分层（4 narr + 6 tgt，含 hard-bone q4/q23/q28） | 封存；仅配置冻结后跑一次 |
| `全集 28`（历史） | P0-0 之前所有报告 | 历史口径；train-on-test 时代，结论降格为"dev 选择参考" |
| `modality 语料`（12 条） | T1 受控轮（3 类 modality × 4） | modality 存活率 |

---

## 1. 裁决：7/1 vs 7/2 口径冲突（本表以此为定案）

| 批次 | 报告 | 冠军 | 配置 |
|---|---|---|---|
| 7/1 | `output/report.md`（2026-07-01） | Lin α=0.20, k=60 → **WS 0.551** | 头部仅 model=bge-m3，无 k1/b/topK 记录 |
| 7/2 | `output/per-query-analysis.md`（2026-07-02） | **BM25 → WS 0.551** | k1=1.5, b=0.75, TOP_K=40，头部自带完整 config |

**裁决**：两批数字不可混用。**7/2 为权威口径**（config 可追溯）；7/1 标注"配置不同，不混用"，博客不得引用其"Lin 冠军"结论。7/1 的问题正是版本钉死缺失所致——本表即修复。

---

## 1.5 配置冻结声明（P0-1 封存前，2026-08-18）

以下配置在 holdout 封存运行**之前**冻结；解封后无论结果如何，**不调参、不重跑**：

| 组件 | 冻结值 |
|---|---|
| BM25 | k1=1.5, b=0.75, TOP_K=40 |
| Vector | bge-m3, TOP_K=144 |
| **主方法** | **Lin 融合 α=0.20, k=60** |
| RRF | k=60 |
| Rerank | bge-reranker-v2-m3 |
| Judge | deepseek-v4-flash（modality 审计；P0-3 以第二 judge 复核） |

冻结依据（dev 探索）：α 扫描 α=0.20 最优（与纯向量等效）；Lin 与纯向量不可区分，保留 BM25 兜底价值；RRF 显著劣于 Lin 与 Vector；rerank 仅方向性观察。

---

## 2. 检索融合主表（权威口径：7/2 per-query-analysis，全集 28）

| 方法 | WS | P@5 | P@10 | NDCG@10 | MRR | Hit@3 | R@20 | 口径 |
|---|---|---|---|---|---|---|---|---|
| BM25 (k1=1.5,b=0.75,TOP_K=40) | **0.551** | 0.414 | 0.346 | 0.425 | 0.452 | 0.750 | 0.608 | 全集 28（历史） |
| Vector (bge-m3,TOP_K=144) | 0.544 | 0.414 | 0.357 | 0.444 | 0.484 | 0.714 | 0.586 | 全集 28（历史） |
| RRF (k=60) | 0.545 | 0.407 | 0.361 | 0.442 | 0.449 | 0.714 | 0.613 | 全集 28（历史） |
| Lin (α=0.20,k=60) | 0.542 | 0.414 | 0.357 | 0.444 | 0.483 | 0.714 | 0.576 | 全集 28（历史） |
| Lin+Rerank (α=0.20,pool=60) | 0.522 | 0.429 | 0.350 | 0.437 | 0.474 | 0.643 | 0.595 | 全集 28（历史） |

> ⚠️ 方法间 Δ 仅 0.007–0.009（0.551 vs 0.544 vs 0.542），无显著性支撑——P0-1 bootstrap 前，不得写"融合略优"类结论。
> 硬骨头（全方法 WS<0.3）：q4 / q23 / q25 / q27 / q28。

## 2.5 权威主表（holdout 封存运行，2026-08-18）— 博客主表以此为准

| 方法 | WS | P@5 | P@10 | NDCG@10 | MRR | Hit@3 | R@20 | 口径 |
|---|---|---|---|---|---|---|---|---|
| BM25 (k1=1.5,b=0.75,TOP_K=40) | 0.539 | 0.420 | 0.370 | 0.423 | 0.433 | 0.700 | 0.586 | holdout（n=10） |
| Vector (bge-m3,TOP_K=144) | 0.479 | 0.400 | 0.360 | 0.378 | 0.331 | 0.600 | 0.561 | holdout（n=10） |
| Lin α=0.20,k=60 | 0.488 | 0.400 | 0.350 | 0.377 | 0.326 | 0.600 | 0.653 | holdout（n=10） |
| RRF k=60 | 0.501 | 0.420 | 0.380 | 0.410 | 0.348 | 0.600 | 0.628 | holdout（n=10） |
| **Lin+Rerank (α=0.20,pool=60)** | **0.571** | 0.440 | 0.430 | 0.470 | 0.320 | 0.700 | 0.712 | holdout（n=10） |

**显著性（holdout，n=10，配对 bootstrap B=10000）**：

| 对比 | ΔWS | 95% CI | 符号检验 p | 措辞 |
|---|---|---|---|---|
| Lin(0.20) vs Vector | +0.009 | [−0.018, 0.038] | 0.508 | 无可测差异 |
| RRF vs BM25 | −0.037 | [−0.192, 0.115] | 0.508 | 方向性观察 |
| RRF vs Vector | +0.022 | [−0.018, 0.065] | 1.000 | 方向性观察 |
| Lin+Rerank vs Vector | +0.092 | [0.008, 0.203] | 0.109 | 显著优于\* |
| Lin+Rerank vs Lin | +0.082 | [−0.003, 0.206] | 0.109 | 方向性观察 |
| RRF vs Lin | +0.013 | [−0.012, 0.042] | 1.000 | 无可测差异 |

> \* Lin+Rerank vs Vector 按预注册规则标"显著优于"（CI 不含 0 且 \|Δ\|≥5pp），但**与 dev 方向相反**（dev 为 −8.8pp 方向性观察）且符号检验 p=0.109 不显著 → 结论不稳定，博客应按"方向性观察"表述，勿当硬结论。
> 稳健结论（dev+holdout 双侧一致）：**Lin(0.20) ≡ Vector（无可测差异）**；"融合略优"（wRRF）与"rerank 分裂"均未获支持。

---

## 3. 7/1 report.md（不混用，仅留档）

| 方法 | WS | 备注 |
|---|---|---|
| Lin α=0.20, k=60 | 0.551 | ⚠️ 与 7/2 的 BM25 0.551 同名不同配置，**不引用** |
| Vector (pure) | 0.541 | 同上 |
| RRF k=60 / k=110 | 0.523 / 0.521 | 同上 |
| Lin+Rerank (pool=60/80) | 0.519 / 0.519 | 同上 |
| Vector+Rerank (pool=60/80) | 0.543 / 0.530 | 同上 |

---

## 4. Modality 存活率（T1，modality 语料）

| 指标 | 值 | 口径 |
|---|---|---|
| 总体存活率 | **58.3%**（7/12，uncertain 计丢失） | modality 语料 |
| 打趣/戏言 | 75%（3/4） | 同上 |
| 假设/将来意愿 | 100%（4/4） | 同上 |
| 否定/反悔/状态往返 | **0%**（0/4） | 同上 |

> 来源：`output/modality-survival.md`（2026-08-17）。judge=deepseek-v4-flash（**单 judge、未人工校准**）→ P0-2/P0-3 待办；LLM 非确定性标注见 §7 待办。

---

## 5. 历史调参/消融结论（已降格为"dev 集上的选择参考"）

以下报告均在 train-on-test 时代（全集 28）跑出，**不得作为最终结论**，P0-1 用 dev split + 权威配置重跑：

| 报告 | 原始结论 | 新状态 |
|---|---|---|
| `bm25-tune.md` | k1/b 网格 | 待 dev 重跑 |
| `topk-sweep.md` | TOP_K_vec 扫描 | 待 dev 重跑 |
| `packaging-comparison.md` | 打包策略 | 待 dev 重跑 |
| `model-benchmark.md` / `model-benchmark-zhipu.md` | embedding 模型对比 | 待 dev 重跑 |
| `scale-benchmark.md` | 语料规模×模型 | 待 dev 重跑 |
| `rawtext-benchmark.md` | raw vs summary | 待 dev 重跑 |
| `detail-level-report.md` / `key-highlights-ablation.md` / `llm-judge-score-ablation.md` / `flat-ns-d4f.md` | LLM-judge 消融 | 待 dev 重跑（judge 相关） |

---

## 6. 版本四元组登记（P0-1 封存运行后填写）

| report | fixture | queries | split | config | judge |
|---|---|---|---|---|---|
| per-query | 172a018f14cd | bf8454b07393 | holdout | 609c8cd76336 | n/a |
| significance | 172a018f14cd | bf8454b07393 | holdout | 609c8cd76336 | n/a |

> 登记格式示例：`| per-query | a1b2... | c3d4... | dev | e5f6... | n/a |`。脚本 `report-provenance.js` 自动比对，不符即告警。

---

## 7. 待办

- [x] P0-1：dev CI 主表 + per-query dump + α 扫描（α=0.20 最优）完成
- [x] P0-1：配置冻结（2026-08-18）→ holdout 封存运行一次（output/holdout/）→ 权威主表见 §2.5，版本四元组已登记 §6
- [x] P0-1：审计 §01 粗算复核 —— holdout RRF vs BM25 p=0.508，与 p≈0.56 一致，**未推翻**（无需改 benchmark-hardness-audit.html）
- [ ] P0-2/P0-3：modality 数字人工校准 + 第二 judge 复核
- [ ] scale 模型对比（bge-m3 vs 8B / summary vs raw）可选补跑 → 登记
- [ ] 博客引用本表 §2.5/§4 数字时，注明来源报告与版本四元组
