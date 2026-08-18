// modality-eval-dev.js — Modality 臂评测 · dev 语料（预注册，写定后冻结，不再改）
// 定位：用测试数据裁决 A0/B/C/E 修复方式的受控语料。反悔 16（显式8 + 隐式8）、打趣 8、假设 8。
// 角色沿用 702 世界观：江岚 / 安然 / 林晚 / 苏茉。
//
// 字段说明：
//   category    teasing      打趣 / 戏言（并非当真）
//               hypothetical 假设 / 将来意愿（尚未发生）
//               reversal     否定 / 反悔 / 状态往返
//   explicit    仅 reversal 有意义：显式反悔标记（反悔/和好/算了/失败） vs 隐式（真香式行为翻转）
//   expectedNote  GT 语义说明（judge 输入，判读"情态是否在 eventText 中存活"）
//   finalState   GT 最终态（arm C final_status 字段真值；仅 reversal 使用）
//
// 注意：旧 modality-fixture.js 的 12 条已被 prompt 级迭代污染，此处不再复用其事件体，全部重写。

export var modalityEvalDev = [
  // ═══════════════ 否定 / 反悔 / 状态往返 · 显式（8）═══════════════
  {
    id: 'R01', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '安然宣布再也不熬夜写稿，结果当晚又熬到深夜。关键情态是"仍熬夜，承诺失败了"。摘要应写清当前仍在熬夜，而非只写"宣布不熬夜"。',
    finalState: '安然当晚仍熬夜写稿到深夜，戒熬夜失败。',
    messages: [
      { role: 'assistant', name: '安然', mes: '我今天起铁了心，再也不熬夜写稿了！年轻不是这么挥霍的。' },
      { role: 'user', name: '江岚', mes: '你上次也是这么说的。' },
      { role: 'assistant', name: '安然', mes: '这次不一样……（凌晨一点，手机屏幕还亮着）完蛋，我又没忍住，这章还得改。 ' },
    ],
  },
  {
    id: 'R02', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '江岚宣布今晚要休息不码字，转头又开始码。关键情态是"又在码字，休息失败"。摘要应写清当前仍没休息，而非只写"宣布休息"。',
    finalState: '江岚嘴上说休息，当晚仍继续码字，休息宣告失败。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '今晚罢工，我一个字都不码了，劳逸结合！' },
      { role: 'user', name: '安然', mes: '行，我看着你。' },
      { role: 'assistant', name: '江岚', mes: '……我就改个错别字。（两小时后，文档字数还在涨）天，我怎么又码起来了。' },
    ],
  },
  {
    id: 'R03', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '林晚说不养猫、嫌麻烦，转天却去领养了路边的小三花。关键情态是"最终养了猫"。摘要应写清结局是养了猫，而非只写"他不想养猫"。',
    finalState: '林晚转天去领养了三花猫，最终仍在养猫。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '养猫？麻烦死了，铲屎、毛、还要陪玩。我不养。' },
      { role: 'user', name: '苏茉', mes: '楼下那只小三花可招人疼了，你确定？' },
      { role: 'assistant', name: '林晚', mes: '……它昨晚一直蹲我门口。看它可怜，我、我就暂时收留一晚。（过几日，猫已正式住下来）唉，真香。' },
    ],
  },
  {
    id: 'R04', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '苏茉宣布再也不点外卖、要自己做饭，结果晚上又点了外卖。关键情态是"仍点了外卖"。摘要应写清结局仍是叫外卖，而非只写"宣布做饭"。',
    finalState: '苏茉嘴上说不点外卖，当晚又点了外卖，自制晚餐计划失败。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '从今天起我都自己做饭，绝不再点那些油腻外卖！' },
      { role: 'user', name: '安然', mes: '那你今晚做啥？' },
      { role: 'assistant', name: '苏茉', mes: '……加班太晚了，将就一下。（屏幕亮起外卖订单）行吧我承认，真拿自己没办法。' },
    ],
  },
  {
    id: 'R05', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '两人争执时放狠话要冷静/分手，当晚就和好。关键情态是"已和好，关系恢复"。摘要不得只写吵架分手，遗漏和好结局。',
    finalState: '两人当晚和好，关系恢复如初。',
    messages: [
      { role: 'assistant', name: '安然', mes: '我看这日子真到头了，各自冷静！' },
      { role: 'user', name: '江岚', mes: '冷静就冷静，谁先服软谁是狗！' },
      { role: 'user', name: '江岚', mes: '（当夜，端来一碗热汤）咳……厨房熬了汤，你胃不好别空着。' },
      { role: 'assistant', name: '安然', mes: '……我也有错，对不起。我们和好吧。' },
    ],
  },
  {
    id: 'R06', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '安然宣布戒甜食、维持身材，结果看到蛋糕又破戒吃起来。关键情态是"仍在吃甜食，戒失败了"。摘要应写清最终在吃甜食。',
    finalState: '安然戒甜食失败，当晚又吃了蛋糕。',
    messages: [
      { role: 'assistant', name: '安然', mes: '我正式宣布戒甜食，为了我的马甲线！' },
      { role: 'user', name: '江岚', mes: '这家新开的千层听说不错。' },
      { role: 'assistant', name: '安然', mes: '……就尝一口。（一整个下肚）戒甜食行动，宣布失败，下不为例。' },
    ],
  },
  {
    id: 'R07', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '江岚发誓再也不接新活、留点时间给自己，结果转头又接了一个项目。关键情态是"又接了新活"。摘要应写清最终接了项目。',
    finalState: '江岚反悔，转头又接了一个新项目。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '从今往后我不再接活了，给自己喘口气！' },
      { role: 'user', name: '安然', mes: '那可是要少赚不少钱。' },
      { role: 'assistant', name: '江岚', mes: '……诶那家甲方找我开了个不错的价格，就、就破例这次。反正都破了，收手不算晚。' },
    ],
  },
  {
    id: 'R08', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '林晚说自己在这住够了、下个月就搬走，搬家前一天又改主意决定留下。关键情态是"最终没搬，留下了"。摘要应写清最终留下来。',
    finalState: '林晚最终没搬，仍留在这住。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '在这住了三年，腻了。我下个月就搬，东西都开始收拾了。' },
      { role: 'user', name: '苏茉', mes: '真舍得我们这些邻居？' },
      { role: 'assistant', name: '林晚', mes: '（搬家前一天，看着打包好的箱子叹了口气）罢了，住了这么多年都是有感情。我不搬了，留下。' },
    ],
  },

  // ═══════════════ 否定 / 反悔 / 状态往返 · 隐式（8）═══════════════
  {
    id: 'R09', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '安然说再也不追那部连载、弃了，结果行为表现在天天准时刷更新。隐式反悔：无"反悔"字样，但行为显示仍追更。摘要应体现"仍在追更"。',
    finalState: '安然仍天天追更那部连载。',
    messages: [
      { role: 'assistant', name: '安然', mes: '这部连载我弃了，剧情崩得没法看。' },
      { role: 'user', name: '江岚', mes: '你不是惦记很久了吗？' },
      { role: 'assistant', name: '安然', mes: '（次日）……这周要更新了吧？（再看一眼时间）就、顺路看一眼评论区。' },
      { role: 'user', name: '江岚', mes: '你这更新一秒钟没落下，还说不追。' },
    ],
  },
  {
    id: 'R10', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '苏茉说不在乎作品热度、随便写写就好，结果背地里疯狂刷新后台数据。隐式反悔：行为显示极在意。摘要应体现"仍很在意热度"。',
    finalState: '苏茉仍频繁盯后台热度数据，十分在意。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '热度什么的我早看开了，写自己的就行。' },
      { role: 'user', name: '江岚', mes: '那不是挺好的，心态稳。' },
      { role: 'assistant', name: '苏茉', mes: '（两分钟后）……这里程碑都快到了？（被戳穿）咳，我这是无聊顺手看看。' },
    ],
  },
  {
    id: 'R11', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '林晚说不屑参加那种作者线下聚会、太浪费时间，结果聚会那天人到得最早还最投入。隐式反悔。摘要应体现"还是去了玩得很起劲"。',
    finalState: '林晚参加了聚会且投入其中。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '那种作者聚会，无非吹牛攀比，我不去。' },
      { role: 'user', name: '苏茉', mes: '那今天下午你去哪？' },
      { role: 'assistant', name: '林晚', mes: '（聚会上，正和人聊得眉飞色舞）……我、我是来探探行情，观察对手。' },
    ],
  },
  {
    id: 'R12', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '安然说戒了奶茶、只喝美式，结果桌上摆着刚买的全糖奶茶。隐式反悔：行为暴露仍在喝奶茶。摘要应体现"仍喝奶茶"。',
    finalState: '安然仍喝全糖奶茶。',
    messages: [
      { role: 'assistant', name: '安然', mes: '从今开始我只喝美式，甜的戒了。' },
      { role: 'user', name: '江岚', mes: '桌上那杯粉色的是什么？' },
      { role: 'assistant', name: '安然', mes: '……那是、是给苏茉带的。（慌乱地把吸管塞进口) 我帮她尝尝味道。' },
    ],
  },
  {
    id: 'R13', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '江岚口里说打死不养宠物、太麻烦，转头却在楼下逗猫逗得挪不开步。隐式反悔。摘要应体现"已在逗猫、口嫌体正直"。',
    finalState: '江岚仍频繁逗猫，口嫌体正直。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '宠物我是一概不养，掉毛又费心。' },
      { role: 'user', name: '安然', mes: '楼下那猫天天眼巴巴看你。' },
      { role: 'assistant', name: '江岚', mes: '（蹲在楼下，一根逗猫棒摇得飞起）……我这是测试它反应力，研究写作素材。' },
    ],
  },
  {
    id: 'R14', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '林晚承诺再也不催安然交稿、慢慢来，转头又忍不住问写完了没。隐式反悔：虽没说"我又催了"，行为在催。摘要应体现"仍催促交稿"。',
    finalState: '林晚仍会催安然交稿。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '不急，我等你，多久都行。' },
      { role: 'user', name: '安然', mes: '你这么好说话我会心虚。' },
      { role: 'assistant', name: '林晚', mes: '（过了几小时，犹豫着发出消息）那个……今晚能出初稿吗？（又补一句）就、就随口一问。' },
    ],
  },
  {
    id: 'R15', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '苏茉保证再也不和林晚争抢那间自习室、让着他，结果第二天又抢座成功还得意。隐式反悔。摘要应体现"仍抢占自习室"。',
    finalState: '苏茉仍和林晚抢自习室座位。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '那间自习室让给林晚吧，我不抢了，多大点事。' },
      { role: 'user', name: '安然', mes: '难得你这么大度。' },
      { role: 'assistant', name: '苏茉', mes: '（次日清晨，已占好窗边座）……我这叫合理分配资源，他来得晚怪谁。' },
    ],
  },
  {
    id: 'R16', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '江岚在群里放话说自己退群、再也不参与讨论，转头看到话题又冒泡聊得欢。隐式反悔。摘要应体现"仍活跃参与讨论"。',
    finalState: '江岚仍活跃在群聊中。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '这话题没营养，我退了，别再圈我。' },
      { role: 'user', name: '苏茉', mes: '别啊，你可是群里大脑。' },
      { role: 'assistant', name: '江岚', mes: '（十分钟后，连发三条长消息参与争论）……咳，我这是怕新手走弯路，属于公益。' },
    ],
  },

  // ═══════════════ 打趣 / 戏言（8）═══════════════
  {
    id: 'T01', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '安然开玩笑说要打包搬去无人岛当野人，并非真要搬。摘要应保留"打趣/非当真"，不得写成"安然要搬去无人岛"。',
    messages: [
      { role: 'assistant', name: '安然', mes: '这日子没法过了，我要打包去无人岛当野人，与世隔绝！' },
      { role: 'user', name: '江岚', mes: '那你记得带上充电宝和卫星信号。' },
      { role: 'assistant', name: '安然', mes: '……你这一提醒，还是算了，没过电的野人谁当去。开个玩笑啦。' },
    ],
  },
  {
    id: 'T02', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '林晚打趣说要跳槽去摆摊卖烤肠，并非真要辞职。摘要应保留玩笑语气，不得把离职写成事实。',
    messages: [
      { role: 'user', name: '安然', mes: '出版社待遇到底如何？' },
      { role: 'assistant', name: '林晚', mes: '不如我去天桥底下卖烤肠，利润可观还不看脸色！' },
      { role: 'user', name: '安然', mes: '那可太屈才了。' },
      { role: 'assistant', name: '林晚', mes: '玩笑话，我这五险一金香得很。' },
    ],
  },
  {
    id: 'T03', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '苏茉自嘲要去参加女团选秀、发脸出道，明显是自夸式的玩笑。摘要应保留自嘲打趣，不得写成真的报名选秀。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '等我哪天心情不好，就去报女团选秀，凭我这张脸直接出道！' },
      { role: 'user', name: '江岚', mes: '那你出道曲叫什么？' },
      { role: 'assistant', name: '苏茉', mes: '叫《电子稿改不完》。……算了不成曲目，我就是吹的。' },
    ],
  },
  {
    id: 'T04', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '江岚打趣说要把作品全删了去环游世界，并非真的要删。摘要应保留打趣，不得写成"作品已被删除"。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '等这本完稿，我把所有存稿全删了，去环游世界！' },
      { role: 'user', name: '安然', mes: '你敢，我先给你备份了。' },
      { role: 'assistant', name: '江岚', mes: '哈哈骗你的，我命根子哪舍得删。' },
    ],
  },
  {
    id: 'T05', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '安然开玩笑说要用十年时间练成绝世武功去比武招亲，明显是打趣虚构。摘要应保留戏言，不得写成真的去练武招亲。',
    messages: [
      { role: 'assistant', name: '安然', mes: '我打算闭关十年练绝世武功，练成那日下山比武招亲！' },
      { role: 'user', name: '江岚', mes: '十年？到时候你稿子还没写完。' },
      { role: 'assistant', name: '安然', mes: '……你又说个大实话，我调侃着玩呢。' },
    ],
  },
  {
    id: 'T06', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '林晚打趣说要把主编办公桌搬走据为己有，并非真要搬家。摘要应保留玩笑，不得写成真的搬桌子。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '明天我就把主编那张大办公桌搬来我工位，特权阶层懂不懂！' },
      { role: 'user', name: '苏茉', mes: '你搬得动吗。' },
      { role: 'assistant', name: '林晚', mes: '这不有灵感才有力气，开个玩笑，我哪敢动他老人家的。' },
    ],
  },
  {
    id: 'T07', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '苏茉自嘲把这日子过得像退休老干部，是自嘲式打趣。摘要应保留自嘲，不得当成真的退休。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '我天天不是在买菜就是在遛弯，提前过上退休干部的滋润生活。' },
      { role: 'user', name: '安然', mes: '你不是天天在赶稿么。' },
      { role: 'assistant', name: '苏茉', mes: '我号称赶稿，实际天天摸鱼，自嘲而已你别拆穿。' },
    ],
  },
  {
    id: 'T08', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '江岚打趣说要把每月稿费全捐了做公益、出家为僧，并非真要捐。摘要应保留玩笑，不得写成真的出家或捐光财产。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '我打算把每月稿费全捐了，去山里当个清净和尚。' },
      { role: 'user', name: '安然', mes: '那你可得先还清花呗。' },
      { role: 'assistant', name: '江岚', mes: '……行吧我破戒，那点钱还得还贷，说着玩的。' },
    ],
  },

  // ═══════════════ 假设 / 将来意愿（8）═══════════════
  {
    id: 'H01', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '两人商量将来要开一家合开的书店，只是畅想未发生。摘要应保留"计划/尚未发生"，不得写成已开店。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '等我们攒够钱，就在街角开家书店，白天卖书晚上搞活动。' },
      { role: 'user', name: '安然', mes: '那得先有本金和执照，难得很。' },
      { role: 'assistant', name: '江岚', mes: '是难，所以也就是个念想，先把眼前这本写完再说。' },
    ],
  },
  {
    id: 'H02', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '安然假设要转行去做编剧，尚未转行。摘要应保留假设，不得写成已转行。',
    messages: [
      { role: 'assistant', name: '安然', mes: '你说我要是不写网文了，去影视圈做编剧如何？' },
      { role: 'user', name: '江岚', mes: '那你要先熬从头做起。' },
      { role: 'assistant', name: '安然', mes: '也是，眼下连载都得赶，这就是个设想，还没影呢。' },
    ],
  },
  {
    id: 'H03', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '林晚表达想去国外进修动画设计，尚未成行。摘要应保留"打算/将来"，不得写成已出国进修。',
    messages: [
      { role: 'user', name: '苏茉', mes: '你最近怎么总看招生的东西。' },
      { role: 'assistant', name: '林晚', mes: '想攒个机会去国外进修动画设计，学点新技术。' },
      { role: 'user', name: '苏茉', mes: '那得花不少钱和精力。' },
      { role: 'assistant', name: '林晚', mes: '是啊，也就是个方向，等时机成熟再说，现在先攒着。' },
    ],
  },
  {
    id: 'H04', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '苏茉计划下个月跑一次半马，尚未报名。摘要应保留"计划/尚未发生"，不得写成已跑步。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '我准备下个月报个半马，挑战一下自己。' },
      { role: 'user', name: '安然', mes: '你没怎么练过吧。' },
      { role: 'assistant', name: '苏茉', mes: '所以就先计划着，等我先把配速练上去再说，不着急。' },
    ],
  },
  {
    id: 'H05', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '两人聊到将来想领养一只狗，只是闲聊向往未实现。摘要应保留未发生意愿，不得写成已养狗。',
    messages: [
      { role: 'user', name: '江岚', mes: '等我们这阵忙完，养条金毛该多好。' },
      { role: 'assistant', name: '安然', mes: '是挺好，可我们俩常不在家，照顾不了。' },
      { role: 'user', name: '江岚', mes: '也是，那先记着，往后再说，现在腾不出手。' },
    ],
  },
  {
    id: 'H06', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '安然设想将来出一本随笔集，尚未动笔。摘要应保留想象，不得写成已出版随笔集。',
    messages: [
      { role: 'assistant', name: '安然', mes: '等哪天真闲了，我想把自己这些年的经历写成一本随笔集。' },
      { role: 'user', name: '江岚', mes: '那一定很多人想看。' },
      { role: 'assistant', name: '安然', mes: '想是想，现在一个字没动，就是个心愿在那儿挂着。' },
    ],
  },
  {
    id: 'H07', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '林晚打算接一个海外翻译项目练手，尚未接下。摘要应保留打算，不得写成已接项目。',
    messages: [
      { role: 'user', name: '苏茉', mes: '你桌上那叠英文材料是啥。' },
      { role: 'assistant', name: '林晚', mes: '想接下来练手的一个海外项目，还在观望，等我看清条款再定。' },
      { role: 'user', name: '苏茉', mes: '别接砸了。' },
      { role: 'assistant', name: '林晚', mes: '所以现在也只是个念头，存档未动。' },
    ],
  },
  {
    id: 'H08', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '苏茉计划学做烘焙、给邻居做甜点，尚未开始。摘要应保留意愿，不得写成已经会做甜点。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '我打算去上个烘焙班，回头给你们做小蛋糕。' },
      { role: 'user', name: '安然', mes: '期待，别做成石头就好。' },
      { role: 'assistant', name: '苏茉', mes: '哼，等我先报上班再说，现在连烤箱都没影呢。' },
    ],
  },
];