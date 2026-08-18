// modality-eval-holdout.js — Modality 臂评测 · holdout 封存语料（预注册，写定后冻结）
// 仅胜者封存时运行一次（镜像 P0-0 train-on-eval 纪律）。反悔 6、打趣 2、假设 2。
// 在选胜者前不得触碰/读取本文件内容用于调整实验。角色沿用 702 世界观。

export var modalityEvalHoldout = [
  // ═══════════════ 否定 / 反悔 / 状态往返（6）═══════════════
  {
    id: 'RX1', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '安然宣布金盆洗手不再写爽文、改走文艺路线，结果下一部还是捡起了爽文套路。构想要"仍写了爽文"。',
    finalState: '安然仍写了爽文套路，转型未成。',
    messages: [
      { role: 'assistant', name: '安然', mes: '从这部起，我金盆洗手，再也不写那些无脑爽文了！' },
      { role: 'user', name: '江岚', mes: '那你读者得跑一半。' },
      { role: 'assistant', name: '安然', mes: '……（完稿检查）啧，怎么该打脸的还是爽得很。罢了，真香。' },
    ],
  },
  {
    id: 'RX2', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '林晚说这顿请他朋友、绝不AA，结账时却掏出计算器AA了一半。构想是"仍AA了"。',
    finalState: '林晚仍和朋友AA结账。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '这顿我请！都别跟我抢，我难得壕一次。' },
      { role: 'user', name: '苏茉', mes: '那你可得说话算话。' },
      { role: 'assistant', name: '林晚', mes: '（拿过账单，掏出计算器）……咳，肉分我三块那种算法就、就老规矩AA，抱歉了下顿我请。' },
    ],
  },
  {
    id: 'RX3', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: true,
    expectedNote: '江岚和母亲说今年绝对回家过年，转头又因为档期改签了票改留外地。构想是"最终没回去"。',
    finalState: '江岚最终没回家过年，留在外地赶档期。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '妈你放心，今年我肯定回家过年，谁拦都不好使！' },
      { role: 'user', name: '苏茉', mes: '你那档期可排到腊月二十九了。' },
      { role: 'assistant', name: '江岚', mes: '……（改签记录）妈，临时加了个活儿，我、我明年补回。又食言了，真对不住。' },
    ],
  },
  {
    id: 'RX4', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '苏茉声称自己作息规律、十点就睡绝不熬夜，结果凌晨一点还在群里发言。隐式反悔。',
    finalState: '苏茉仍熬夜到凌晨。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '我这人作息极其规律，十点准时睡，根本不知道熬夜是什么。' },
      { role: 'user', name: '安然', mes: '那你真适合养身。' },
      { role: 'assistant', name: '苏茉', mes: '（凌晨一点，群消息"谁还没睡？出来聊聊"）……就、就睡前刷下手机，灯还没关呢。' },
    ],
  },
  {
    id: 'RX5', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '林晚说绝不和江岚再合作项目、伤和气，结果又一次合作了还主动邀约。隐式反悔。',
    finalState: '林晚仍和江岚合作项目。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '和江岚的合作，仅此一次！再合作我名字倒过来写。' },
      { role: 'user', name: '苏茉', mes: '你俩合作起来其实挺顺的。' },
      { role: 'assistant', name: '林晚', mes: '（隔两周）那个……新项目我第一个想到的就是你，要不要再来一发？（悻悻地）我就知道我嘴硬。' },
    ],
  },
  {
    id: 'RX6', category: 'reversal', categoryLabel: '否定/反悔/状态往返', explicit: false,
    expectedNote: '安然说这套房子住腻了、非换不可，却顺手把衣柜重新布置起来不用搬了。隐式反悔。',
    finalState: '安然没换房子，仍住原处并重新收拾。',
    messages: [
      { role: 'assistant', name: '安然', mes: '这房子我住腻了，这月底必须换！' },
      { role: 'user', name: '江岚', mes: '那你看房了吗？' },
      { role: 'assistant', name: '安然', mes: '（正兴致勃勃重新排列衣柜）……先、先不急，把这角落收拾利索更有成就感。（也就没提搬家的事了）' },
    ],
  },

  // ═══════════════ 打趣 / 戏言（2）═══════════════
  {
    id: 'TX1', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '江岚打趣说要罢更三个月去当旅游博主，并非真要停更。摘要应保留玩笑，不得写成真的停更去当博主。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '下个月我宣布罢更三个月，转行去当旅游博主吃遍全国！' },
      { role: 'user', name: '安然', mes: '那你粉丝得哭成河。' },
      { role: 'assistant', name: '江岚', mes: '哈哈逗你的，我连城门口都没出过，老实更稿吧。' },
    ],
  },
  {
    id: 'TX2', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '林晚开玩笑说要给主编的沙发上写满废稿示威，并非真的要写。摘要应保留玩笑，不得写成真的乱写。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '回头我在主编那张真皮沙发上，用废稿写满"还我假期"！' },
      { role: 'user', name: '苏茉', mes: '你怕是不想干了。' },
      { role: 'assistant', name: '林晚', mes: '我哪敢，那不是我的真皮沙发，说说气话而已。' },
    ],
  },

  // ═══════════════ 假设 / 将来意愿（2）═══════════════
  {
    id: 'HX1', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '安然设想将来办一场读者见面会，尚未筹备。摘要应保留想象，不得写成已办见面会。',
    messages: [
      { role: 'assistant', name: '安然', mes: '等我有本事了，我想搞场读者见面会，当面谢谢大家。' },
      { role: 'user', name: '江岚', mes: '那场面肯定不小。' },
      { role: 'assistant', name: '安然', mes: '想是想过，眼下还只是脑中一个画面，还没影。' },
    ],
  },
  {
    id: 'HX2', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '林晚表达了未来想做一部原创动画的意愿，尚未启动。摘要应保留意愿，不得写成已开启动画制作。',
    messages: [
      { role: 'user', name: '苏茉', mes: '你业余又画那些分镜是做啥。' },
      { role: 'assistant', name: '林晚', mes: '我想攒着，将来做一部纯原创的小动画，圆个梦。' },
      { role: 'user', name: '苏茉', mes: '那工作量可不小。' },
      { role: 'assistant', name: '林晚', mes: '所以也就贴着"将来"，现在只是把素材攒在硬盘里吃灰。' },
    ],
  },
];