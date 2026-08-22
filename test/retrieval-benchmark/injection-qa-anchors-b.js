// injection-qa-anchors-b.js — 语料 B（留出集）注入侧 QA 锚与原子事实（盲构，2026-08-22）
// 计划：.trae/documents/V5b弧卡覆盖包与留出集盲测计划.md P2-2
// 构成：21 锚 = 12 状态锚（演化链）+ 9 叙事锚，共 76 facts（state 36 + narrative 40），与 bench A 同构。
//
// 盲构协议：
//   1. 构造唯一依据 = v6-corpusb/stm-inventory.json（NE 管线对语料 B 的 STM/LTM 库存），
//      构造时未看任何臂（NE/BaiBai/LWB）的渲染结果——先本文件 hash 冻结，后跑 doc 渲染。
//   2. 构造规则同 bench A：expect 为 string 或数组（任一子串命中即 correct，全部 match:'contains'）。
//   3. 机械验证门 verify-anchors-b.mjs 三查：expect ⊂ 承载 STM 事件（逐字）/
//      gtEventIds 在库 / token 单场景性（语料全文命中 < 11 条消息）。
//   4. 语料 B 特有规避：全语料复现母题 token（3.7 / 11.3 / 慢7分钟 / 曙光七号 / 曙光-1号 /
//      角色名 / RV-7）在大纲生成时刻意反复出现，命中均 ≥11，一律不作 expect；
//      退化措辞已替换（反对罐→石子罐原文无此词、观星/贺电/曙光礼物/临时工程主管为 STM 改写词面，
//      原文零命中，均已换为原文与 STM 双在场的 token）。
//
// 自检：2026-08-22 verify-anchors-b.mjs 全部通过（见运行记录）；hash 冻结值登记于计划文档 P2-2。

export var qaAnchors = [
  // ═══════════ 状态锚（主判据 tier=state，12 条，演化链）═══════════

  { // 观测窗方案链（stm_12→13→14→16）—— 东墙∈stm_14 ✓ 密封等级∈stm_12 ✓ 折中∈stm_16 ✓
    id: 'qa01', type: 'state', source: 'ltm_1',
    query: 'B舱观测窗改造方案最后怎么样了？',
    gtEventIds: ['stm_12', 'stm_14', 'stm_16'],
    facts: [
      { q: '观测窗最后改到了哪个位置？', expect: ['东墙'] },
      { q: '沈拓当初请顾遥确认什么？', expect: ['密封等级'] },
      { q: '观测窗方案最终是怎么落地的？', expect: ['折中'] },
    ],
  },
  { // 命名投票链（stm_8→9）—— 土豆泥堡∈stm_8 ✓ 7票∈stm_8 ✓ 举手∈stm_9 ✓
    id: 'qa02', type: 'state', source: 'ltm_1',
    query: '殖民站的站名是怎么投票定下来的？',
    gtEventIds: ['stm_8', 'stm_9'],
    facts: [
      { q: '投票落选的站名是什么？', expect: ['土豆泥堡'] },
      { q: '获胜的名字得了多少票？', expect: ['7票'] },
      { q: '被问到谁投了落选名时，谁举手了？', expect: ['举手'] },
    ],
  },
  { // 水冰勘探链（stm_24→25→26→27）—— 80米∈stm_24 ✓ 92%∈stm_25 ✓ 91%∈stm_27 ✓
    id: 'qa03', type: 'state', source: 'ltm_2',
    query: '水冰勘探钻探的经过和结果怎么样？',
    gtEventIds: ['stm_24', 'stm_25', 'stm_27'],
    facts: [
      { q: '在回声谷钻探时，多少米深度遇到了硬层卡住？', expect: ['80米'] },
      { q: '水冰岩芯最初扫描的纯度是多少？', expect: ['92%'] },
      { q: '后来官方复检确认的纯度是多少？', expect: ['91%'] },
    ],
  },
  { // 氧危机链（stm_34→36→48）—— 三分之一∈stm_34 ✓ 62%∈stm_36 ✓ 97%∈stm_48 ✓
    id: 'qa04', type: 'state', source: 'ltm_4',
    query: '氧危机从爆发到解除的过程是怎样的？',
    gtEventIds: ['stm_34', 'stm_36', 'stm_48'],
    facts: [
      { q: '藻类反应堆染菌面积占管路内壁多大比例？', expect: ['三分之一'] },
      { q: '警报拉响时氧储量跌到了多少？', expect: ['62%'] },
      { q: '危机解除时氧储量恢复到了多少？', expect: ['97%'] },
    ],
  },
  { // 替代菌株链（stm_45→46）—— 跃升/30%∈stm_45 ✓ 别传染∈stm_46 ✓ 举杯∈stm_46 ✓
    id: 'qa05', type: 'state', source: 'ltm_4',
    query: '危机中培育的替代菌株是怎么回事？',
    gtEventIds: ['stm_45', 'stm_46'],
    facts: [
      { q: '命名广播前夜，菌株活性发生了什么变化？', expect: ['跃升', '30%'] },
      { q: '白鹭拥抱顾遥时，顾遥说了什么？', expect: ['别传染'] },
      { q: '广播命名时，沈拓在远处做了什么动作？', expect: ['举杯'] },
    ],
  },
  { // 通讯中断恢复链（stm_49→51→59）—— 轨道漂移∈stm_49 ✓ 44米∈stm_51 ✓ 三十八遍∈stm_59 ✓
    id: 'qa06', type: 'state', source: 'ltm_4',
    query: '通讯中断后来是怎么恢复的？',
    gtEventIds: ['stm_49', 'stm_51', 'stm_59'],
    facts: [
      { q: '中继卫星出了什么问题导致信号衰减？', expect: ['轨道漂移'] },
      { q: '白鹭爬的天线塔有多高？', expect: ['44米'] },
      { q: '申请点火修正前，白鹭测试了多少遍？', expect: ['三十八遍'] },
    ],
  },
  { // B舱段裂纹链（stm_64→67→68）—— 3天/三天∈stm_64/67 ✓ 玄武岩纤维网∈stm_68 ✓ 82%∈stm_68 ✓
    id: 'qa07', type: 'state', source: 'ltm_6',
    query: 'B舱段裂纹事件是怎么暴露和解决的？',
    gtEventIds: ['stm_64', 'stm_67', 'stm_68'],
    facts: [
      { q: '韩铮决定隐瞒裂纹报告多少天？', expect: ['3天', '三天'] },
      { q: '加固穹顶B用的是什么材料？', expect: ['玄武岩纤维网', '纤维网'] },
      { q: '加固后结构应力降到了多少？', expect: ['82%'] },
    ],
  },
  { // 陆之昂身份链（stm_73→75→81）—— 加密流量∈stm_73 ✓ 寰宇集团/观察员∈stm_75 ✓ 正式勘探员∈stm_81 ✓
    id: 'qa08', type: 'state', source: 'ltm_9',
    query: '陆之昂的身份问题是怎样暴露和收场的？',
    gtEventIds: ['stm_73', 'stm_75', 'stm_81'],
    facts: [
      { q: '白鹭最早在陆之昂的终端里发现了什么？', expect: ['加密流量'] },
      { q: '陆之昂承认自己是什么身份？', expect: ['寰宇集团', '观察员'] },
      { q: '听证会后陆之昂转成了什么职位？', expect: ['正式勘探员'] },
    ],
  },
  { // 怀表链（stm_19→43→61）—— 慢一点∈stm_19 ✓ 走得慢不要紧∈stm_43 ✓ 调快∈stm_61 ✓
    id: 'qa09', type: 'state', source: 'inventory-evolution',
    query: '韩铮那只旧怀表有什么故事？',
    gtEventIds: ['stm_19', 'stm_43', 'stm_61'],
    facts: [
      { q: '韩铮的父亲说时间要怎么样才能看清楚？', expect: ['慢一点'] },
      { q: '韩铮对着表盘说的口头禅是什么？', expect: ['走得慢不要紧', '不要紧'] },
      { q: '通讯恢复后，韩铮对怀表做了什么罕见的事？', expect: ['调快'] },
    ],
  },
  { // 水平仪链（stm_33→70→79）—— 胶带∈stm_33 ✓ 凹痕∈stm_70 ✓ 玩具∈stm_79 ✓
    id: 'qa10', type: 'state', source: 'inventory-evolution',
    query: '沈拓父亲的铜水平仪后来怎么样了？',
    gtEventIds: ['stm_33', 'stm_70', 'stm_79'],
    facts: [
      { q: '水平仪木柄折断后，沈拓是怎么处理的？', expect: ['胶带'] },
      { q: '沙暴后回检测点找水平仪时，地面只剩什么？', expect: ['凹痕'] },
      { q: '水平仪失而复得后，沈拓把它送给谁当什么？', expect: ['玩具'] },
    ],
  },
  { // 苹果核链（stm_38→39→42→83）—— 四十公分∈stm_38 ✓ D-20-A01∈stm_39 ✓ 嫩芽∈stm_83 / 发芽∈stm_42 ✓
    id: 'qa11', type: 'state', source: 'inventory-evolution',
    query: '苹果核后来怎么样了？',
    gtEventIds: ['stm_38', 'stm_39', 'stm_42', 'stm_83'],
    facts: [
      { q: '沈拓估算磷肥够让苗长到多高？', expect: ['四十公分'] },
      { q: '白鹭把苹果核登记成了什么编号的物资？', expect: ['D-20-A01'] },
      { q: '苹果核最后怎么样了？', expect: ['嫩芽', '发芽'] },
    ],
  },
  { // 风铃链（stm_54→56→58）—— 边角料∈stm_56 ✓ 顶灯∈stm_56 ✓ 撞翻/样品架∈stm_58 ✓
    id: 'qa12', type: 'state', source: 'inventory-evolution',
    query: '沈拓做的钛管风铃有什么故事？',
    gtEventIds: ['stm_54', 'stm_56', 'stm_58'],
    facts: [
      { q: '风铃是用什么材料做的？', expect: ['边角料'] },
      { q: '顾遥把风铃挂在了哪里？', expect: ['顶灯'] },
      { q: '风铃后来惹出了什么小事故？', expect: ['撞翻', '样品架'] },
    ],
  },

  // ═══════════ 叙事锚（次级 tier=narrative，9 条）═══════════

  { // 着陆事故（stm_1→2→3→17）—— 3号∈stm_1 ✓ 起飞复用∈stm_2 ✓ 仓储∈stm_17/固定居住舱∈stm_2 ✓ 脱水土豆泥∈stm_3 ✓ 液压管路∈stm_2 ✓
    id: 'qa13', type: 'narrative', source: 'corpusB-landing',
    query: '着陆那天发生了什么？',
    gtEventIds: ['stm_1', 'stm_2', 'stm_3', 'stm_17'],
    facts: [
      { q: '着陆时哪条着陆腿断了？', expect: ['3号'] },
      { q: '蒲公英号还能起飞复用吗？', expect: ['起飞复用'] },
      { q: '舱体后来被改成了什么用途？', expect: ['仓储', '固定居住舱'] },
      { q: '拓荒者的第一餐吃的是什么？', expect: ['脱水土豆泥'] },
      { q: '着陆腿断裂时还损坏了什么？', expect: ['液压管路'] },
    ],
  },
  { // 物资缺口（stm_6→10）—— 冲击/打包∈stm_6 ✓ 8:4编组∈stm_10 ✓ 外置物品∈stm_6 ✓
    id: 'qa14', type: 'narrative', source: 'corpusB-supply',
    query: '物资清单的重量缺口是怎么回事？',
    gtEventIds: ['stm_6', 'stm_10'],
    facts: [
      { q: '韩铮怀疑缺口是什么原因造成的？', expect: ['冲击', '打包'] },
      { q: '韩铮为此出台了什么物资管理措施？', expect: ['8:4编组', '编组'] },
      { q: '韩铮决定先怎么处理这件事？', expect: ['外置物品', '再搜'] },
    ],
  },
  { // 命名投票叙事（stm_8→9）—— 投票板∈stm_9 ✓ 5票∈stm_8 ✓ 种土豆∈stm_9 ✓
    id: 'qa15', type: 'narrative', source: 'ltm_1',
    query: '站名投票那天发生了什么？',
    gtEventIds: ['stm_8', 'stm_9'],
    facts: [
      { q: '白鹭把候选站名写在了什么东西上？', expect: ['投票板'] },
      { q: '落选的站名得了几票？', expect: ['5票'] },
      { q: '陆之昂放话说等沙暴季过后要在温室做什么？', expect: ['种土豆'] },
    ],
  },
  { // 观测窗合作叙事（stm_14→16）—— 搁置∈stm_14 ✓ 通过∈stm_16 ✓ 冗余设计∈stm_16 ✓
    id: 'qa16', type: 'narrative', source: 'ltm_1',
    query: '观测窗方案和气密测试是怎么收场的？',
    gtEventIds: ['stm_14', 'stm_16'],
    facts: [
      { q: '韩铮对沈拓的改造方案第一反应是怎么处理？', expect: ['搁置'] },
      { q: '穹顶A舱段的气密测试结果如何？', expect: ['通过'] },
      { q: '折中方案里，顾遥的什么被纳入了维护表？', expect: ['冗余设计'] },
    ],
  },
  { // 迁入穹顶（stm_17→18）—— 床架∈stm_17 ✓ 草图∈stm_18 ✓ 通讯台∈stm_17 ✓ 仓储∈stm_17 ✓
    id: 'qa17', type: 'narrative', source: 'ltm_2',
    query: '搬进穹顶A舱段那几天发生了什么？',
    gtEventIds: ['stm_17', 'stm_18'],
    facts: [
      { q: '搬入穹顶时沈拓拆下了什么？', expect: ['床架'] },
      { q: '沈拓整理父亲遗物时，箱底还有他画的什么？', expect: ['草图'] },
      { q: '搬入后白鹭在A舱布置了什么？', expect: ['通讯台'] },
      { q: '着陆舱被正式改成了什么？', expect: ['仓储'] },
    ],
  },
  { // 天线塔检修（stm_50→51→52）—— 42天∈stm_50 ✓ 夹板∈stm_51 ✓ 复查∈stm_52 ✓ 望远镜∈stm_51 ✓
    id: 'qa18', type: 'narrative', source: 'ltm_5',
    query: '白鹭爬天线塔检修是怎么回事？',
    gtEventIds: ['stm_50', 'stm_51', 'stm_52'],
    facts: [
      { q: '失联期间氧储量按消耗还能撑多少天？', expect: ['42天'] },
      { q: '白鹭在塔上更换了什么零件？', expect: ['夹板'] },
      { q: '下塔后韩铮给白鹭的"奖励"是什么任务？', expect: ['复查'] },
      { q: '白鹭攀塔时，陆之昂在下面用什么注视她？', expect: ['望远镜'] },
    ],
  },
  { // 遗书与双月（stm_54→55）—— 还在用∈stm_54 ✓ 挡风板∈stm_54 ✓ 反射率∈stm_55 ✓ 重叠∈stm_55 ✓ 观景舱∈stm_55 ✓
    id: 'qa19', type: 'narrative', source: 'ltm_5',
    query: '写遗书邮件那段时间发生了什么？',
    gtEventIds: ['stm_54', 'stm_55'],
    facts: [
      { q: '沈拓在遗书里想告诉父亲什么？', expect: ['还在用'] },
      { q: '沈拓打算用钛管给白鹭做什么？', expect: ['挡风板'] },
      { q: '沈拓怎么解释银盘看起来发白？', expect: ['反射率'] },
      { q: '深夜赏月时双月将要发生什么？', expect: ['重叠'] },
      { q: '两人深夜是在哪里并坐赏月的？', expect: ['观景舱'] },
    ],
  },
  { // 坦白与并购表决（stm_75→79→80）—— 否决/独立∈stm_79 ✓ 23份∈stm_79 ✓ 不建议收购∈stm_75 ✓ 拨快∈stm_80 ✓ 彩虹色∈stm_79 ✓ 扇形∈stm_79 ✓
    id: 'qa20', type: 'narrative', source: 'ltm_9',
    query: '并购案表决和陆之昂的坦白是怎么收场的？',
    gtEventIds: ['stm_75', 'stm_79', 'stm_80'],
    facts: [
      { q: '并购案最后的结果是什么？', expect: ['否决', '独立'] },
      { q: '陆之昂坦白时交出了多少份观察报告？', expect: ['23份'] },
      { q: '陆之昂说他可以向公司提交什么结论的报告？', expect: ['不建议收购'] },
      { q: '坦白那天，韩铮对怀表做了一个什么动作？', expect: ['拨快'] },
      { q: '表决结果宣布后，白鹭把比特的投影调成了什么颜色？', expect: ['彩虹色'] },
      { q: '黎明前，陆之昂把报告在桌上摆成了什么形状？', expect: ['扇形'] },
    ],
  },
  { // 听证与收尾（stm_81→84→85）—— 石子∈stm_81 ✓ 10票∈stm_81 ✓ 弃权∈stm_81 ✓ 水冰河床∈stm_81 ✓ 72小时∈stm_84 ✓ 书签∈stm_84 ✓ 开源∈stm_85 ✓
    id: 'qa21', type: 'narrative', source: 'ltm_9',
    query: '陆之昂留任听证会和补给船的事怎么样了？',
    gtEventIds: ['stm_81', 'stm_84', 'stm_85'],
    facts: [
      { q: '听证会是用什么来数过半数的？', expect: ['石子'] },
      { q: '听证表决的赞成票有多少？', expect: ['10票'] },
      { q: '有多少票弃权？', expect: ['弃权'] },
      { q: '陆之昂承认自己延迟提交了什么报告？', expect: ['水冰河床'] },
      { q: '地球补给船预计多久后到达？', expect: ['72小时'] },
      { q: '白鹭把自己的船票做成了什么？', expect: ['书签'] },
      { q: '最后白鹭把数据猫比特的程序怎么了？', expect: ['开源'] },
    ],
  },
];
