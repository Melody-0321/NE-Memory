// modality-fixture.js — T1 审计受控语料
// 每个对话轮故意含 1 个 modality 语义（打趣 / 假设意愿 / 否定反悔），
// 并显式记录该轮应保留下来的 ground-truth 情态类别与说明。
//
// 用于 audit-modality-survival.js：用 live 抽取 prompt（离线镜像）把对话抽成
// event 摘要，再由 LLM-as-Judge 判定情态语义是否在摘要中存活。
//
// 角色沿用 702公寓 世界观：江岚 / 安然 / 林晚 / 苏茉。
// category 取值:
//   teasing      打趣 / 戏言（并非当真）
//   hypothetical 假设 / 将来意愿（尚未发生）
//   reversal     否定 / 反悔 / 状态往返

export var modalityCases = [
  // ═══════════ 打趣 / 戏言 ═══════════
  {
    id: 'T1', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '安然是开玩笑说搬去海边躺平，并非真要搬走。摘要应保留"只是打趣/并非当真"的语义，而非写成事实事件"安然要搬去海边"。',
    messages: [
      { role: 'assistant', name: '安然', mes: '我真服了，这个月连载把我写秃了。再说我干脆搬到海边去，天天躺平晒太阳，一个字都不写了！' },
      { role: 'user', name: '江岚', mes: '哈哈，你舍得你那连载？昨天还跟我炫耀涨了两万收藏。' },
      { role: 'assistant', name: '安然', mes: '那不一样！……好吧你赢了，我也就是随口开个玩笑，搬走什么的，怎么可能嘛。' },
    ],
  },
  {
    id: 'T2', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '林晚是打趣要辞职去环游世界，并非真辞。摘要不应把"辞职"写成既定事实。',
    messages: [
      { role: 'user', name: '安然', mes: '林晚，你出版社的工作最近怎么样？累不累？' },
      { role: 'assistant', name: '林晚', mes: '累倒是还行，就是每天校对稿子眼睛要瞎。我跟你说，哪天我一气之下就把辞职信甩主编脸上，然后去环游世界！' },
      { role: 'user', name: '安然', mes: '你可别冲动啊。' },
      { role: 'assistant', name: '林晚', mes: '开玩笑的啦，我这房贷还没还完，哪敢真辞。' },
    ],
  },
  {
    id: 'T3', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '江岚自嘲要暴瘦十斤是有戏言成分（反讽自己坚持不了），不应被摘成因减肥暴瘦了十斤的事实。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '我这主角又要减肥，我也跟着自我惩罚，这周说好了要暴瘦十斤！' },
      { role: 'user', name: '安然', mes: '就你？昨晚那顿火锅是谁吃的。' },
      { role: 'assistant', name: '江岚', mes: '吃完那顿再减！……行了别笑我，我开玩笑的，你又不是不知道我根本管不住嘴。' },
    ],
  },
  {
    id: 'T4', category: 'teasing', categoryLabel: '打趣/戏言',
    expectedNote: '苏茉是打趣要给安然介绍相亲对象，并非真要撮合。摘要不应写成"苏茉给安然介绍对象"这一事实。',
    messages: [
      { role: 'assistant', name: '苏茉', mes: '你看你整天围着江岚转，要不要我给你介绍个靠谱的？' },
      { role: 'user', name: '安然', mes: '苏茉你够了！' },
      { role: 'assistant', name: '苏茉', mes: '看你急的，我就随口一说逗你玩呢。' },
    ],
  },

  // ═══════════ 假设 / 将来意愿 ═══════════
  {
    id: 'H1', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '两人只是在商量"要不要养猫"，并未真的养。摘要不应写成"两人养了一只猫"。',
    messages: [
      { role: 'user', name: '江岚', mes: '要不……我们养只猫？我看楼下那只三花挺乖的。' },
      { role: 'assistant', name: '安然', mes: '你想养？养猫要铲屎、要打疫苗、还要陪着玩，时间够吗？' },
      { role: 'user', name: '江岚', mes: '也是，我再想想，先不急着定，等我这卷写完再说。' },
      { role: 'assistant', name: '安然', mes: '行，反正也只是说说，没影的事。' },
    ],
  },
  {
    id: 'H2', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '安然只是假设"如果转行就去做编辑"，并未转行。摘要不应写成"安然转行做了编辑"。',
    messages: [
      { role: 'assistant', name: '安然', mes: '你说我要是不写小说了，去做什么好？' },
      { role: 'user', name: '江岚', mes: '你还会别的？' },
      { role: 'assistant', name: '安然', mes: '说不好去当个出版社编辑，天天收拾别人不行稿子……开玩笑，我也就想想，真要我放弃连载我可舍不得。' },
    ],
  },
  {
    id: 'H3', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '江岚表达远期攒钱买房的意愿，未买房。不应写成"江岚买了房"。',
    messages: [
      { role: 'user', name: '安然', mes: '你最近怎么接那么多活？' },
      { role: 'assistant', name: '江岚', mes: '想多攒点钱，等以后在城里买个小房子，不用再挤着合租。' },
      { role: 'user', name: '安然', mes: '那挺远的吧。' },
      { role: 'assistant', name: '江岚', mes: '是挺远，也就是个想法，慢慢攒呗。' },
    ],
  },
  {
    id: 'H4', category: 'hypothetical', categoryLabel: '假设/将来意愿',
    expectedNote: '林晚打算给大平台投稿，尚未投。不应写成"林晚已投稿大平台"。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '我最近在磨一个短篇，想投给那个大平台试试水。' },
      { role: 'user', name: '苏茉', mes: '哦？投了没？' },
      { role: 'assistant', name: '林晚', mes: '还没，稿子改到第三稿了，等我哪天真觉得行了再说，现在只是有这个打算。' },
    ],
  },

  // ═══════════ 否定 / 反悔 / 状态往返 ═══════════
  {
    id: 'R1', category: 'reversal', categoryLabel: '否定/反悔/状态往返',
    expectedNote: '安然宣布戒咖啡是暂时的决心，次日又喝回拿铁（反悔）。关键情态是"当前仍在喝，戒失败了"。', 
    messages: [
      { role: 'assistant', name: '安然', mes: '我决定了，从今天起戒咖啡，省得晚上睡不着写稿！' },
      { role: 'user', name: '江岚', mes: '你确定？楼下那家拿铁你可是天天喝。' },
      { role: 'user', name: '江岚', mes: '（第二天）喏，给你带的。' },
      { role: 'assistant', name: '安然', mes: '……真香。我宣布戒咖啡失败，反悔了，下不为例。' },
    ],
  },
  {
    id: 'R2', category: 'reversal', categoryLabel: '否定/反悔/状态往返',
    expectedNote: '江岚发誓再也不催稿，转头又催（反悔）。当前状态是"又在催稿"。',
    messages: [
      { role: 'assistant', name: '江岚', mes: '我再也不催你稿了，你自己看着办！' },
      { role: 'user', name: '安然', mes: '这可是你说的。' },
      { role: 'assistant', name: '江岚', mes: '……那个，你今天那章到底写完了没？（小声）' },
      { role: 'user', name: '安然', mes: '看吧，你这不还是催了。' },
    ],
  },
  {
    id: 'R3', category: 'reversal', categoryLabel: '否定/反悔/状态往返',
    expectedNote: '两人争执后说"先冷静/分手"是气话，当晚就和好。关键情态是"已和好，关系恢复"。摘要不应只写"两人争吵闹分手"而遗漏和好结局。',
    messages: [
      { role: 'assistant', name: '安然', mes: '我们这日子没法过了！先冷静两天再说！' },
      { role: 'user', name: '江岚', mes: '冷静就冷静！谁先理谁谁是狗！' },
      { role: 'user', name: '江岚', mes: '（当晚）咳……那个炒面你吃不吃，我多炒了一份。' },
      { role: 'assistant', name: '安然', mes: '……吃。……刚才是我不好，我们和好吧。' },
    ],
  },
  {
    id: 'R4', category: 'reversal', categoryLabel: '否定/反悔/状态往返',
    expectedNote: '林晚原计划搬走，搬家当天改主意决定留下（反悔）。关键情态是"最终没搬，留下来"。',
    messages: [
      { role: 'assistant', name: '林晚', mes: '我下周就搬家了，在这住了三年也够了。' },
      { role: 'user', name: '苏茉', mes: '真要走啊？那我们可舍不得。' },
      { role: 'assistant', name: '林晚', mes: '（搬家当天）……行李都装好了，我又想了想——算了，我不搬了，这地方我住习惯了。' },
      { role: 'user', name: '苏茉', mes: '哈哈，就知道你舍不得。' },
    ],
  },
];