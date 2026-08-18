// injection-qa-anchors.js — 注入侧三层仪器的 QA 锚与原子事实（预注册，2026-08-19 用户核对后冻结）
// 计划：.trae/documents/injection-ablation-rerun-plan.md §3.1
// 构成：12 状态锚（7 来自 t0-state-arcs + 5 新构造演化链）+ 6 叙述锚（来自 dev 18 查询）
// 构造规则：期望短语必须是承载事件文本的子串（保证 oracle 臂可答）；构造时未看任何臂的渲染结果。
// 判定：全部 match:'contains'（expect 为 string 或数组，任一子串命中即 correct）。
//   —— 执行偏差记录：原计划 §3.3 允许 semantic tier 用二值 judge；实际构造发现全部事实
//      可确定性匹配，统一 contains（零 LLM 判定，噪声更低）。tier 字段保留用于分桶。
// 自检（2026-08-19，构造时逐条验证 expect ⊂ 承载事件文本）：见各锚注释。
//
// 【预注册偏差修正 2026-08-19】（injection-structure-comparison-plan.md §3.1）：
//   判定期望表补转述变体（仅加宽接受面，不收紧、不改题）：
//   - qa01-f1 补 '洗一个月袜子'（读者答"洗一个月袜子"不含连续子串'洗袜子'，被子串匹配误杀）
//   - qa05-f0 补 '签成'（读者答"签成了"被 ['签署','签了','签约'] 误杀）
//   影响登记：判定重算幂等（dump answer 保留），已跑 4 臂绝对值小幅上修，配对差值方向不变。

export var qaAnchors = [
  // ═══════════ 状态锚（主判据 tier=state，12 条）═══════════

  { // arc01 月票榜 —— expect 自检: 安然∈stm_50 ✓ 洗袜子∈stm_51 ✓ 结果/获胜∈stm_50 ✓
    id: 'qa01', type: 'state', source: 'arc01',
    query: '月票榜大战最后的结果是什么？现在谁赢了？',
    gtEventIds: ['stm_50', 'stm_51'],
    facts: [
      { q: '月票榜赌约的最终赢家是谁？', expect: ['安然'] },
      { q: '输掉赌约的一方最后要做什么？', expect: ['洗袜子', '洗一个月袜子'] },
      { q: '月票榜之争最后分出结果了吗？', expect: ['赢了', '获胜', '结果', '公布'] },
    ],
  },
  { // arc02 情感关系 —— expect 自检: 恋情∈stm_96 ✓ 承认∈stm_96 ✓ 牵手∈stm_46 ✓
    id: 'qa02', type: 'state', source: 'arc02',
    query: '江岚和安然现在是什么关系？他们在一起了吗？',
    gtEventIds: ['stm_46', 'stm_96'],
    facts: [
      { q: '江岚和安然现在是什么关系？', expect: ['恋情', '恋人', '情侣', '恋爱', '在一起'] },
      { q: '他们的恋情公开承认了吗？', expect: ['公开', '承认'] },
      { q: '两人有过肢体上的重要进展吗？是什么？', expect: ['牵手'] },
    ],
  },
  { // arc03 林晚职业 —— expect 自检: 出版社∈stm_87 ✓ 编辑助理∈stm_87 ✓ 读研∈stm_132 ✓ 新人∈stm_135 ✓
    id: 'qa03', type: 'state', source: 'arc03',
    query: '林晚现在的工作怎么样了？她在哪里上班？',
    gtEventIds: ['stm_87', 'stm_109', 'stm_132', 'stm_135'],
    facts: [
      { q: '林晚现在在什么类型的单位工作？', expect: ['出版社'] },
      { q: '林晚的职位是什么？', expect: ['编辑助理', '编辑'] },
      { q: '林晚现在还在继续学业吗？在做什么？', expect: ['读研', '研究生'] },
    ],
  },
  { // arc04 苏茉职业 —— expect 自检: 优秀员工∈stm_97 ✓ 读书社区∈stm_140 ✓ 三万∈stm_140 ✓
    id: 'qa04', type: 'state', source: 'arc04',
    query: '苏茉现在的工作进展如何？',
    gtEventIds: ['stm_97', 'stm_129', 'stm_140'],
    facts: [
      { q: '苏茉在新公司获得过什么荣誉？', expect: ['优秀员工'] },
      { q: '苏茉主导上线的项目是什么？', expect: ['读书社区'] },
      { q: '那个项目上线后的数据怎么样？', expect: ['三万'] },
    ],
  },
  { // arc05 实体书 —— expect 自检: 签署∈stm_84 ✓ 两万∈stm_108 ✓ 年度最佳∈stm_141 ✓
    id: 'qa05', type: 'state', source: 'arc05',
    query: '合作小说现在出版了吗？出到什么阶段了？',
    gtEventIds: ['stm_84', 'stm_108', 'stm_134', 'stm_141'],
    facts: [
      { q: '合作小说的实体书合同最终签成了吗？', expect: ['签署', '签了', '签约', '签成'] },
      { q: '实体书加印了多少册？', expect: ['两万'] },
      { q: '合作小说获得过什么奖项提名？', expect: ['年度最佳'] },
    ],
  },
  { // arc06 程浩 —— expect 自检: 婉拒∈stm_119 ✓ 三分之一∈stm_126 ✓ 江岚∈stm_119 ✓
    id: 'qa06', type: 'state', source: 'arc06',
    query: '程浩现在和江岚安然的关系怎么样了？',
    gtEventIds: ['stm_119', 'stm_126', 'stm_127'],
    facts: [
      { q: '对于程浩的合作提议，江岚是怎么回应的？', expect: ['婉拒', '拒绝', '已有'] },
      { q: '程浩新书《深渊回响》的销量怎么样？', expect: ['三分之一', '不到'] },
      { q: '程浩向谁提出了合作提议？', expect: ['江岚'] },
    ],
  },
  { // arc07 第二本书 —— expect 自检: 写完∈stm_131 ✓ 两万∈stm_142 ✓ 献词∈stm_137 ✓
    id: 'qa07', type: 'state', source: 'arc07',
    query: '第二本书现在写到什么阶段了？',
    gtEventIds: ['stm_131', 'stm_142', 'stm_137'],
    facts: [
      { q: '新书的第一章写完了吗？', expect: ['写完', '完成'] },
      { q: '新书第一章免费放出后数据怎么样？', expect: ['两万'] },
      { q: '两人在新书的什么地方写了献词？', expect: ['献词', '扉页'] },
    ],
  },
  { // 新构造 qa08 茉莉花（物品演化链 stm_78→stm_144）—— 林晚∈stm_144 ✓ 死∈stm_78 ✓ 新∈stm_144 ✓
    id: 'qa08', type: 'state', source: 'fixture-evolution',
    query: '阳台上的茉莉花现在怎么样了？',
    gtEventIds: ['stm_144', 'stm_78'],
    facts: [
      { q: '现在阳台上的茉莉花是谁送的？', expect: ['林晚'] },
      { q: '安然自己种的那盆茉莉最后怎么样了？', expect: ['死', '枯'] },
      { q: '现在的茉莉花和安然原来种的是同一盆吗？', expect: ['不是', '新', '另一'] },
    ],
  },
  { // 新构造 qa09 白板（物品演化链 stm_33→64→133）—— 新∈stm_133 ✓ 复杂∈stm_133 ✓ 一倍∈stm_133 ✓
    id: 'qa09', type: 'state', source: 'fixture-evolution',
    query: '客厅里的大白板现在是什么情况？',
    gtEventIds: ['stm_133', 'stm_64'],
    facts: [
      { q: '现在用的白板还是原来那块吗？', expect: ['不是', '换了', '新'] },
      { q: '为什么要换新白板？', expect: ['复杂'] },
      { q: '新白板和旧白板相比怎么样？', expect: ['一倍', '大'] },
    ],
  },
  { // 新构造 qa10 合同条款（条款演化 stm_81→83→84；与 arc05 主题不同：条款 vs 阶段）
    // 自检: 10%∈stm_84 ✓ 五万∈stm_84 ✓ 保留/同意∈stm_84 ✓
    id: 'qa10', type: 'state', source: 'fixture-evolution',
    query: '合作小说实体书合同的最终条款是什么？',
    gtEventIds: ['stm_84', 'stm_81'],
    facts: [
      { q: '最终的版税率是多少？', expect: ['10%', '百分之十', '10'] },
      { q: '最终的首印册数是多少？', expect: ['五万'] },
      { q: '影视改编权最终保留下来了吗？', expect: ['保留', '同意'] },
    ],
  },
  { // 新构造 qa11 江岚写作观（感受演化链 stm_06/71→124→143）—— 孤独∈stm_143 ✓ 安然∈stm_143 ✓ 温度/最好∈stm_124 ✓
    id: 'qa11', type: 'state', source: 'fixture-evolution',
    query: '江岚现在对写作的感受是什么样的？',
    gtEventIds: ['stm_143', 'stm_124'],
    facts: [
      { q: '江岚以前觉得写作是什么样的？', expect: ['孤独'] },
      { q: '江岚说这句话的时候是在和谁交流？', expect: ['安然'] },
      { q: '江岚怎么评价安然写的新书大纲？', expect: ['温度', '最好'] },
    ],
  },
  { // 新构造 qa12 签售会规模（规模演化链 stm_89/92→105）—— 两百∈stm_92 ✓ 一倍∈stm_105 ✓ 云澜∈stm_89 ✓
    id: 'qa12', type: 'state', source: 'fixture-evolution',
    query: '两场签售会的规模都怎么样？',
    gtEventIds: ['stm_105', 'stm_92', 'stm_89'],
    facts: [
      { q: '第一场签售会来了大约多少读者？', expect: ['两百', '200'] },
      { q: '第二场签售会的人数和第一场相比怎么样？', expect: ['一倍'] },
      { q: '第一场签售会是在哪家书店办的？', expect: ['云澜'] },
    ],
  },

  // ═══════════ 叙述锚（次级 tier=narrative，6 条，来自 dev 查询）═══════════

  { // q3 林晚人物 —— 601/楼下∈stm_08 ✓ 酱油∈stm_08 ✓ 通过∈stm_48 ✓
    id: 'qa13', type: 'narrative', source: 'q3',
    query: '林晚是一个什么样的角色？',
    gtEventIds: ['stm_08', 'stm_48'],
    facts: [
      { q: '林晚住在哪？', expect: ['601', '楼下'] },
      { q: '林晚和江岚是怎么认识的？', expect: ['酱油'] },
      { q: '林晚的毕业论文最后结果如何？', expect: ['通过'] },
    ],
  },
  { // q18 苏茉作用 —— 行政∈stm_58 ✓ 合作∈stm_13 ✓ 王姐∈stm_99 ✓
    id: 'qa14', type: 'narrative', source: 'q18',
    query: '苏茉在整个故事中起了什么作用？',
    gtEventIds: ['stm_13', 'stm_58', 'stm_99'],
    facts: [
      { q: '苏茉辞职前是做什么工作的？', expect: ['行政'] },
      { q: '苏茉建议安然对江岚采取什么态度？', expect: ['合作'] },
      { q: '苏茉的读书社区项目是和谁一起合作的？', expect: ['王姐'] },
    ],
  },
  { // q12 感情转折 —— 可乐∈stm_24 ✓ 安然∈stm_44 ✓ 夕阳∈stm_46 ✓
    id: 'qa15', type: 'narrative', source: 'q12',
    query: '两个人感情中的关键转折在哪里？',
    gtEventIds: ['stm_24', 'stm_44', 'stm_46'],
    facts: [
      { q: '安然情绪低落时江岚给她递了什么？', expect: ['可乐'] },
      { q: '是谁先说出"我在乎的是你"的？', expect: ['安然'] },
      { q: '两人第一次牵手是在什么场景下？', expect: ['夕阳'] },
    ],
  },
  { // q6 写作分工 —— 悬疑∈stm_37 ✓ 感情∈stm_37 ✓ 交换/互审∈stm_37 ✓
    id: 'qa16', type: 'narrative', source: 'q6',
    query: '协议达成后，他们的写作实践和分工是怎样的？',
    gtEventIds: ['stm_36', 'stm_37', 'stm_40'],
    facts: [
      { q: '江岚负责写小说的哪条线？', expect: ['悬疑'] },
      { q: '安然负责写小说的哪条线？', expect: ['感情', '情感'] },
      { q: '两人约定怎么互相把关对方的章节？', expect: ['互审', '交换'] },
    ],
  },
  { // q14 安然心态 —— 回怼∈stm_102 ✓ 江岚∈stm_102 ✓ 用作品∈stm_102 ✓
    id: 'qa17', type: 'narrative', source: 'q14',
    query: '面对程浩的挑衅，安然的心态是怎么变化的？',
    gtEventIds: ['stm_102', 'stm_103'],
    facts: [
      { q: '安然看到程浩的微博后第一反应想做什么？', expect: ['回怼'] },
      { q: '是谁拦住了安然？', expect: ['江岚'] },
      { q: '拦住她时说了什么核心的话？', expect: ['用作品', '作品说话'] },
    ],
  },
  { // q24 江岚做饭 —— 煎蛋∈stm_52 ✓ 糊∈stm_52 ✓ 吃完∈stm_52 ✓
    id: 'qa18', type: 'narrative', source: 'q24',
    query: '江岚自己做的饭水平怎么样？',
    gtEventIds: ['stm_52'],
    facts: [
      { q: '江岚给安然做的第一顿早饭是什么？', expect: ['煎蛋'] },
      { q: '那顿早饭做得成功吗？', expect: ['糊'] },
      { q: '安然把那顿饭吃完了吗？', expect: ['吃完', '全部'] },
    ],
  },
];
