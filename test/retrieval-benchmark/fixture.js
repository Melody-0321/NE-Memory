// Virtual STM dataset: ~130 events, 8 characters, ~25% noise
// Story: 江岚 & 安然 rivalry-to-romance → collaboration → publishing
// Extended: relationship, publishing arc, new conflicts, side character arcs
// Noise types: TRIVIAL (daily), HALLUCINATION (LLM-inferred), NEAR_DUP (split same scene),
//              PARTIAL_ENTITY (missing annotation), TIME_ERR (wrong period)

export var allSTM = [
  // ═══════════════════════════════════════════
  // PHASE 1: 初遇与赌约 (Days 1-4)
  // ═══════════════════════════════════════════
  { id: 'stm_01', event: '江岚与安然在702公寓发现彼此存在，经过核对合同和身份证确认是性转版本的自己，最终接受世界融合的现实', period: 'Day 1 傍晚', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [0, 1], noise: false },
  { id: 'stm_02', event: '江岚提议暂时同居，约定各自负责一半家务和水电费', period: 'Day 1 傍晚', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [2, 3], noise: false },
  { id: 'stm_03', event: '江岚质疑安然高出的稿费是运气，安然反驳称是实力并挑衅下次月票榜见', period: 'Day 1 深夜', scene: '阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [4, 5], noise: false },
  { id: 'stm_04', event: '江岚去厨房倒了杯水，注意到冰箱里只剩半盒牛奶', period: 'Day 1 深夜', scene: '702公寓 · 厨房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [6], noise: true },

  { id: 'stm_05', event: '江岚应下安然的月票榜挑战，并反挑衅她输了别找借口，安然提出输了洗一个月袜子的赌约', period: 'Day 2 上午', scene: '阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [7, 8], noise: false },
  { id: 'stm_06', event: '江岚在书房埋头码字，给自己定了日更一万字的目标', period: 'Day 2 下午', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [9, 10], noise: false },
  { id: 'stm_07', event: '安然在客厅刷排行榜，发现江岚的书一夜之间涨了两万收藏，心情复杂', period: 'Day 2 下午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [11, 12], noise: false },
  { id: 'stm_08', event: '邻居林晚来串门，自我介绍是楼下601的住户，过来借酱油', period: 'Day 2 傍晚', scene: '702公寓 · 玄关', entities: [{ name: '江岚', type: 'character' }, { name: '林晚', type: 'character' }], status: 'closed', msg_ids: [13, 14], noise: false },

  { id: 'stm_09', event: '江岚连续写了十二个小时，手指酸痛但仍坚持赶稿', period: 'Day 3 凌晨', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [15, 16], noise: false },
  { id: 'stm_10', event: '安然早起发现江岚趴在书桌上睡着了，悄悄给她披了条毯子', period: 'Day 3 清晨', scene: '702公寓 · 书房', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [17], noise: false },
  { id: 'stm_11', event: '林晚在楼下花园里浇花，跟路过的住户聊了几句', period: 'Day 3 上午', scene: '公寓花园', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [18], noise: true },
  { id: 'stm_12', event: '安然约闺蜜苏茉在楼下咖啡厅见面，倾诉自己对江岚的复杂感情——既欣赏她的才华又不想输给她', period: 'Day 3 下午', scene: '楼下咖啡厅', entities: [{ name: '安然', type: 'character' }, { name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [19, 20], noise: false },
  { id: 'stm_13', event: '苏茉建议安然直接跟江岚提出合作而不是对抗，安然犹豫不决', period: 'Day 3 下午', scene: '楼下咖啡厅', entities: [{ name: '安然', type: 'character' }, { name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [21, 22], noise: false },
  { id: 'stm_14', event: '江岚在书房发现毯子，猜到是安然的，但假装不知道继续码字', period: 'Day 3 深夜', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [23], noise: false },

  { id: 'stm_15', event: '月票榜更新——安然暂时领先江岚三百票，在客厅得意地哼起了歌', period: 'Day 4 上午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [24, 25], noise: false },
  { id: 'stm_16', event: '江岚不甘示弱，打电话给自己的编辑要求增加推荐位，语气强硬', period: 'Day 4 上午', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [26, 27], noise: false },
  { id: 'stm_17', event: '安然继续翻看月票榜数据，发现江岚的书虽然票数落后但追读率比自己高一截', period: 'Day 4 上午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [28], noise: true },
  { id: 'stm_18', event: '林晚过来还酱油，顺便吐槽自己最近在写毕业论文遇到瓶颈', period: 'Day 4 下午', scene: '702公寓 · 客厅', entities: [{ name: '林晚', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [29, 30], noise: false },
  { id: 'stm_19', event: '江岚跟林晚聊起写作节奏的话题，林晚说她的论文导师陈教授对她要求极其严格', period: 'Day 4 下午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '林晚', type: 'character' }], status: 'closed', msg_ids: [31, 32], noise: false },
  { id: 'stm_20', event: '厨房水龙头坏了，江岚尝试自己修但失败，只好打电话叫物业', period: 'Day 4 傍晚', scene: '702公寓 · 厨房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [33], noise: true },

  // ═══════════════════════════════════════════
  // PHASE 2: 转折与合作 (Days 5-9)
  // ═══════════════════════════════════════════
  { id: 'stm_21', event: '江岚新章节爆更，一夜之间月票反超安然五百票，整个评论区沸腾', period: 'Day 5 清晨', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [34, 35], noise: false },
  { id: 'stm_22', event: '读者群里有铁粉发起众筹给江岚砸月票，消息传到了安然的读者群', period: 'Day 5 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [36, 37], noise: false },
  { id: 'stm_23', event: '安然看到反超后沉默了很久，独自在阳台吹风直到傍晚', period: 'Day 5 下午', scene: '702公寓 · 阳台', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [38, 39], noise: false },
  { id: 'stm_24', event: '江岚发现安然在阳台上眼眶微红，犹豫再三后走过去递了罐可乐', period: 'Day 5 傍晚', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [40, 41], noise: false },
  { id: 'stm_25', event: '安然接过可乐没有道谢，但也没有拒绝。两人在阳台上并肩站了很久，谁都没说话', period: 'Day 5 傍晚', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [42, 43], noise: false },
  { id: 'stm_26', event: '夕阳下，江岚和安然并肩站在阳台上，气氛比之前柔和了许多', period: 'Day 5 傍晚', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [44], noise: true },
  { id: 'stm_27', event: '苏茉发消息问安然进展如何，安然回复"我好像没那么想赢了"', period: 'Day 5 深夜', scene: '702公寓 · 安然卧室', entities: [{ name: '安然', type: 'character' }, { name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [45, 46], noise: false },

  { id: 'stm_28', event: '安然主动推开书房门，对江岚说"我们别比了。不如合作写一本书。"', period: 'Day 6 上午', scene: '702公寓 · 书房', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [47, 48], noise: false },
  { id: 'stm_29', event: '江岚愣了几秒，然后笑了：赌约是你提的，先取消的话你得赔我一个月袜子', period: 'Day 6 上午', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [49, 50], noise: false },
  { id: 'stm_30', event: '安然脸红但仍嘴硬说合作先提出来的是她所以应该是江岚欠她，两人又开始拌嘴', period: 'Day 6 上午', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [51, 52], noise: false },
  { id: 'stm_31', event: '最终两人达成协议：合作写一本双主角小说，大纲各出一半，收益五五分', period: 'Day 6 中午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [53, 54], noise: false },
  { id: 'stm_32', event: '林晚在楼下遇到物业修理工，顺口问了一下楼上702漏水修好没', period: 'Day 6 下午', scene: '公寓大堂', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [55], noise: false },

  { id: 'stm_33', event: '江岚和安然在客厅白板上画大纲，为世界观设定争吵了整整两小时', period: 'Day 7 上午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [56, 57], noise: false },
  { id: 'stm_34', event: '安然想让故事走向偏浪漫，江岚坚持要加入悬疑线，两人各执一词', period: 'Day 7 上午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [58, 59], noise: false },
  { id: 'stm_35', event: '外卖到了，安然去拿外卖时顺便跟外卖小哥聊了几句天气', period: 'Day 7 中午', scene: '702公寓 · 玄关', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [60], noise: true },
  { id: 'stm_36', event: '午饭后两人各退一步：主线走悬疑，支线走感情线，通过双视角叙事同时推进', period: 'Day 7 下午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [61, 62], noise: false },
  { id: 'stm_37', event: '江岚负责写悬疑线的主角视角，安然负责写感情线的主角视角，约定每天交换章节互审', period: 'Day 7 晚上', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [63, 64], noise: false },

  { id: 'stm_38', event: '江岚凌晨三点还在改悬疑线第三章，安然端了杯热牛奶进来放在桌上就走', period: 'Day 8 凌晨', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [65, 66], noise: false },
  { id: 'stm_39', event: '安然发现自己写的感情线对话里有几句下意识用了江岚的口癖，对着屏幕脸红', period: 'Day 8 下午', scene: '702公寓 · 安然卧室', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [67, 68], noise: false },
  { id: 'stm_40', event: '两人互审对方章节，江岚指出安然主角的动机铺垫不足，安然承认并在下一章补了三千字前史', period: 'Day 8 晚上', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [69, 70], noise: false },
  { id: 'stm_41', event: '苏茉来探班，看到白板上密密麻麻的大纲惊叹两人效率惊人', period: 'Day 9 下午', scene: '702公寓 · 客厅', entities: [{ name: '苏茉', type: 'character' }, { name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [71, 72], noise: false },
  { id: 'stm_42', event: '苏茉买了三杯奶茶来，三个人边喝边聊，气氛像学生时代的闺蜜聚会', period: 'Day 9 下午', scene: '702公寓 · 客厅', entities: [{ name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [73], noise: true },
  { id: 'stm_43', event: '江岚和安然的合作小说在平台上开了预收录，不到二十四小时收藏破万', period: 'Day 9 晚上', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [74, 75], noise: false },

  // ═══════════════════════════════════════════
  // PHASE 3: 告白与确认 (Day 10)
  // ═══════════════════════════════════════════
  { id: 'stm_44', event: '安然在阳台上叫住江岚，说"其实月票榜的事我早就不在乎了。我在乎的是你。"', period: 'Day 10 傍晚', scene: '702公寓 · 阳台', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [76, 77], noise: false },
  { id: 'stm_45', event: '江岚愣住，然后轻声说"我也是。从你第一天在阳台上跟我叫板的时候，我就觉得你跟别人不一样。"', period: 'Day 10 傍晚', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [76, 77], noise: false },
  { id: 'stm_46', event: '两人在夕阳下第一次牵手，安然说合作小说的结局应该让两个主角在一起，江岚笑着点头', period: 'Day 10 傍晚', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [78, 79], noise: false },

  // Epilogue (original)
  { id: 'stm_47', event: '合作小说上架首日冲进月票榜前三，编辑发来祝贺消息问两人要不要考虑出实体书', period: 'Day 30', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [80, 81], noise: false },
  { id: 'stm_48', event: '林晚顺利通过论文答辩，请江岚和安然吃火锅庆祝', period: 'Day 30 晚上', scene: '火锅店', entities: [{ name: '林晚', type: 'character' }, { name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [82, 83], noise: false },
  { id: 'stm_49', event: '安然忘了带伞，江岚撑伞送她去地铁站，路上讨论下一本小说的构思', period: 'Day 30 深夜', scene: '街道', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [84], noise: true },

  // ═══════════════════════════════════════════
  // PHASE 4: 新身份磨合 (Days 11-20)
  // ═══════════════════════════════════════════
  { id: 'stm_50', event: '月票榜正式公布结果——安然以不到一百票的微弱优势获胜，在客厅里举着手机兴奋得跳了起来', period: 'Day 11 上午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [85, 86], noise: false },
  { id: 'stm_51', event: '江岚虽然输了赌约但笑着恭喜安然，把准备好的洗袜子日程表贴在冰箱上', period: 'Day 11 上午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [87, 88], noise: false },
  { id: 'stm_52', event: '江岚为了庆祝安然的胜利，第一次主动给安然做了早饭——煎蛋糊了但安然全部吃完了', period: 'Day 12 清晨', scene: '702公寓 · 厨房', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [89, 90], noise: false },
  { id: 'stm_53', event: '安然起床后在镜子前试了四套衣服，纠结约会穿什么', period: 'Day 12 上午', scene: '702公寓 · 安然卧室', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [91], noise: true },
  { id: 'stm_54', event: '两人第一次正式约会——去了江岚选的悬疑片，结果安然全程捂着眼睛不敢看', period: 'Day 12 下午', scene: '电影院', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [92, 93], noise: false },
  { id: 'stm_55', event: '看完电影后两人在附近的奶茶店坐了很久，聊各自以前最喜欢的小说', period: 'Day 12 傍晚', scene: '奶茶店', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [94, 95], noise: false },

  { id: 'stm_56', event: '林晚在宿舍对着镜子练习面试，把江岚借给她的西装外套熨了又熨', period: 'Day 13 上午', scene: '601公寓', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [96, 97], noise: false },
  { id: 'stm_57', event: '林晚收到两家公司的面试通知——一家是互联网大厂，一家是出版社', period: 'Day 13 下午', scene: '601公寓', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [98, 99], noise: false },
  { id: 'stm_58', event: '苏茉告诉安然自己辞了原来的行政工作，想转行做市场策划', period: 'Day 14 下午', scene: '楼下咖啡厅', entities: [{ name: '苏茉', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [100, 101], noise: false },
  { id: 'stm_59', event: '安然梦见自己输了月票榜，醒来发现自己在哭——发现是梦之后对着天花板笑了五分钟', period: 'Day 14 凌晨', scene: '702公寓 · 安然卧室', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [102], noise: true },
  { id: 'stm_60', event: '合作小说评论区出现一条长篇差评，逐章批评双线叙事的逻辑漏洞', period: 'Day 14 晚上', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [103, 104], noise: false },
  { id: 'stm_61', event: '安然看完差评后沉默了很久，江岚说"有人认真读你的书是好事，哪怕是骂也说明他读进去了"', period: 'Day 14 深夜', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [105, 106], noise: false },

  { id: 'stm_62', event: '林晚第一次面试——出版社编辑助理岗位，面试官问她最喜欢的书时她提到了江岚和安然的合作小说', period: 'Day 15 上午', scene: '出版社大楼', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [107, 108], noise: false },
  { id: 'stm_63', event: '林晚面试后觉得自己表现平平，在楼下花园的石凳上坐了很久', period: 'Day 15 下午', scene: '公寓花园', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [109], noise: false },
  { id: 'stm_64', event: '江岚在客厅给白板换笔芯，发现安然用蓝色笔在旁边画了一个小爱心', period: 'Day 15 深夜', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [110], noise: false },
  { id: 'stm_65', event: '安然在淘宝上买了两双情侣拖鞋，一双蓝色一双粉色', period: 'Day 16 上午', scene: '702公寓 · 安然卧室', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [111], noise: true },
  { id: 'stm_66', event: '苏茉开始在新公司上班，第一天就被安排了三个项目的市场分析报告', period: 'Day 16 上午', scene: '新公司办公室', entities: [{ name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [112, 113], noise: false },
  { id: 'stm_67', event: '苏茉加班到晚上十点，在群里发了一张空荡办公室的照片', period: 'Day 16 深夜', scene: '新公司办公室', entities: [{ name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [114], noise: false },

  { id: 'stm_68', event: '竞争对手作者程浩的新书《深渊回响》空降月票榜第一，社交媒体上一片叫好', period: 'Day 17 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [115, 116], noise: false },
  { id: 'stm_69', event: '安然把程浩的书从头到尾读了一遍，在笔记本上写了三页分析——文笔确实好但节奏有问题', period: 'Day 17 下午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [117, 118], noise: false },
  { id: 'stm_70', event: '江岚也读了程浩的书，承认"他写悬疑的氛围感确实比我强"', period: 'Day 17 晚上', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [119, 120], noise: false },
  { id: 'stm_71', event: '江岚在书房里关掉所有社交软件，决定闭关三天研究程浩的叙事技巧', period: 'Day 17 深夜', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [121], noise: false },
  { id: 'stm_72', event: '空调遥控器没电了，安然翻遍了所有抽屉才找到备用电池', period: 'Day 18 下午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [122], noise: true },

  { id: 'stm_73', event: '林晚收到出版社的offer，兴奋得在601公寓里原地转了三圈', period: 'Day 18 下午', scene: '601公寓', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [123, 124], noise: false },
  { id: 'stm_74', event: '林晚请江岚和安然吃饭，在火锅店里给安然夹菜时不小心把蘸料打翻在江岚白衬衫上', period: 'Day 18 晚上', scene: '火锅店', entities: [{ name: '林晚', type: 'character' }, { name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [125, 126], noise: false },
  { id: 'stm_75', event: '三人吃完火锅后在街上散步消食，安然突然说"我们要是能一直这样就好了"', period: 'Day 18 深夜', scene: '街道', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }, { name: '林晚', type: 'character' }], status: 'closed', msg_ids: [127], noise: false },

  { id: 'stm_76', event: '合作小说第五章——两位主角在雨中的对峙戏——上线后引发了读者对人物动机的大规模讨论', period: 'Day 19 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [128, 129], noise: false },
  { id: 'stm_77', event: '有读者发长评分析"两个主角其实是作者两人关系的投射"，安然把这评论截屏存进了手机备忘录', period: 'Day 19 下午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [130, 131], noise: false },
  { id: 'stm_78', event: '安然忘了给花浇水，阳台上那盆她在Day2种下的茉莉干死了', period: 'Day 20 上午', scene: '702公寓 · 阳台', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [132], noise: true },

  // ═══════════════════════════════════════════
  // PHASE 5: 出版之路 (Days 21-35)
  // ═══════════════════════════════════════════
  { id: 'stm_79', event: '编辑王姐通过平台联系江岚，对合作小说表示浓厚兴趣，想约面谈实体书出版', period: 'Day 21 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [133, 134], noise: false },
  { id: 'stm_80', event: '江岚和安然第一次讨论是否接受实体书邀约——安然担心出书压力会改变两人的写作方式', period: 'Day 21 晚上', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [135, 136], noise: false },
  { id: 'stm_81', event: '王姐来702公寓面谈，带来了实体书合同样本——首印三万册，版税8%', period: 'Day 22 下午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [137, 138], noise: false },
  { id: 'stm_82', event: '王姐喝茶时夸702的阳台视野好，聊了十分钟装修心得', period: 'Day 22 下午', scene: '702公寓 · 客厅', entities: [{ name: '王姐', type: 'character' }], status: 'closed', msg_ids: [139], noise: true },
  { id: 'stm_83', event: '江岚仔细审阅合同后坚持要保留影视改编权，王姐表示需要回去跟社里商量', period: 'Day 22 傍晚', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [140, 141], noise: false },
  { id: 'stm_84', event: '出版社同意保留影视改编权，版税提到10%，最终合同签署——首印五万册', period: 'Day 24 上午', scene: '出版社大楼', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [142, 143], noise: false },
  { id: 'stm_85', event: '江岚和安然在公寓里开了瓶香槟庆祝合同签署——开了三次才打开', period: 'Day 24 晚上', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [144, 145], noise: false },
  { id: 'stm_86', event: '香槟泡沫洒了一地，两人用拖把擦地时又笑又闹，安然说这场景像婚礼', period: 'Day 24 晚上', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [146], noise: true },

  { id: 'stm_87', event: '林晚正式入职出版社，被分到王姐的编辑组——发现王姐就是负责江岚安然合作的编辑', period: 'Day 25 上午', scene: '出版社大楼', entities: [{ name: '林晚', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [147, 148], noise: false },
  { id: 'stm_88', event: '林晚被安排校对外稿，在办公室里不小心打翻了自己的水杯，洒了一桌', period: 'Day 25 下午', scene: '出版社大楼', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [149], noise: true },
  { id: 'stm_89', event: '出版社开始安排签售会——第一场定在市中心的云澜书店', period: 'Day 26 上午', scene: '(线上)', entities: [{ name: '王姐', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [150, 151], noise: false },
  { id: 'stm_90', event: '江岚在签售会前紧张得一夜没睡，凌晨四点还在改书的后记', period: 'Day 27 凌晨', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [152, 153], noise: false },
  { id: 'stm_91', event: '安然半夜起来发现书房的灯还亮着，去把江岚从椅子上拽起来逼她睡觉', period: 'Day 27 凌晨', scene: '702公寓 · 书房', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [154, 155], noise: false },

  { id: 'stm_92', event: '第一场签售会——云澜书店来了超过两百个读者，队伍从二楼排到了一楼门口', period: 'Day 27 下午', scene: '云澜书店', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [156, 157], noise: false },
  { id: 'stm_93', event: '有读者带着手写的信件来——一个女孩说因为这本合作小说开始相信"竞争不一定非要分出输赢"', period: 'Day 27 下午', scene: '云澜书店', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [158, 159], noise: false },
  { id: 'stm_94', event: '签售会中途笔没水了，林晚从出版社飞跑过来送了新的签名笔', period: 'Day 27 下午', scene: '云澜书店', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [160], noise: true },
  { id: 'stm_95', event: '本地媒体来签售会做专访，记者直接问"两位作者从竞争对手到情侣是真的吗"', period: 'Day 27 下午', scene: '云澜书店', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [161, 162], noise: false },
  { id: 'stm_96', event: '安然大方承认恋情，说"我们一开始确实在比，但比到最后发现对方才是最重要的人"。江岚在旁边满脸通红', period: 'Day 27 下午', scene: '云澜书店', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [163, 164], noise: false },

  { id: 'stm_97', event: '苏茉在新公司做出了一个成功的市场策划案，获得季度优秀员工', period: 'Day 28 上午', scene: '新公司办公室', entities: [{ name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [165, 166], noise: false },
  { id: 'stm_98', event: '苏茉在签售会报道里看到了王姐的名字，想起自己在一次行业交流会上见过她', period: 'Day 28 晚上', scene: '苏茉家', entities: [{ name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [167, 168], noise: false },
  { id: 'stm_99', event: '苏茉主动联系王姐，提议合作做一个线上读书社区的市场推广项目', period: 'Day 29 上午', scene: '(线上)', entities: [{ name: '苏茉', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [169, 170], noise: false },
  { id: 'stm_100', event: '苏茉的新手机在上班路上掉了，监控显示被一个骑车的人捡走了', period: 'Day 29 下午', scene: '街道', entities: [{ name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [171], noise: true },

  { id: 'stm_101', event: '程浩在微博上转发了一篇关于合作小说的书评，评论道"双人写作终归是噱头大于内容"', period: 'Day 30 上午', scene: '(线上)', entities: [{ name: '程浩', type: 'character' }], status: 'closed', msg_ids: [172, 173], noise: false },
  { id: 'stm_102', event: '安然看到程浩的微博后气得想立即回怼，被江岚按住——"用作品说话。"', period: 'Day 30 上午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [174, 175], noise: false },
  { id: 'stm_103', event: '安然趁江岚不注意，偷偷刷了程浩一个小时的微博和访谈，越看越觉得这个人自恋', period: 'Day 30 晚上', scene: '702公寓 · 安然卧室', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [176], noise: true },
  { id: 'stm_104', event: '合作小说的读者发起#我们支持江岚安然#话题，在微博上冲到了趋势前十', period: 'Day 31 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [177, 178], noise: false },

  { id: 'stm_105', event: '第二场签售会在大学城书店举办，现场读者比第一场还多一倍', period: 'Day 32 下午', scene: '大学城书店', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [179, 180], noise: false },
  { id: 'stm_106', event: '签售会上一位中文系教授带着全班学生来，把合作小说当作"当代叙事文学案例"讨论', period: 'Day 32 下午', scene: '大学城书店', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [181, 182], noise: false },
  { id: 'stm_107', event: '安然在签售会上站了四小时后脚肿了，回公寓路上一边抱怨一边笑', period: 'Day 32 晚上', scene: '街道', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [183, 184], noise: false },

  { id: 'stm_108', event: '出版社通知王姐——合作小说加印两万册，因为首印五万已经全部铺到了全国书店', period: 'Day 34 上午', scene: '出版社大楼', entities: [{ name: '王姐', type: 'character' }], status: 'closed', msg_ids: [185, 186], noise: false },
  { id: 'stm_109', event: '林晚在王姐的指导下独立完成了第一份选题报告，被表扬"有编辑的嗅觉"', period: 'Day 35 下午', scene: '出版社大楼', entities: [{ name: '林晚', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [187, 188], noise: false },
  { id: 'stm_110', event: '林晚拿到第一笔工资后给江岚和安然各买了一份礼物——给江岚买了墨水，给安然买了茉莉花茶', period: 'Day 35 晚上', scene: '702公寓 · 客厅', entities: [{ name: '林晚', type: 'character' }, { name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [189, 190], noise: false },

  // ═══════════════════════════════════════════
  // PHASE 6: 第二本书与新冲突 (Days 36-50)
  // ═══════════════════════════════════════════
  { id: 'stm_111', event: '王姐通知江岚：出版社希望趁热打铁，半年内出第二本书', period: 'Day 36 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [191, 192], noise: false },
  { id: 'stm_112', event: '隔壁702B开始装修，电钻声震得江岚和安然无法在客厅讨论大纲', period: 'Day 37 上午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [193], noise: true },
  { id: 'stm_113', event: '关于第二本书的创作方向：江岚想写科幻悬疑，安然想写都市情感——两人第一次真正因为写作吵架', period: 'Day 37 下午', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [194, 195], noise: false },
  { id: 'stm_114', event: '安然抱着笔记本电脑把自己关在卧室里改大纲，门锁了整整一天', period: 'Day 38', scene: '702公寓 · 安然卧室', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [196, 197], noise: false },
  { id: 'stm_115', event: '安然听到外面江岚在打电话：江岚压低声音问苏茉"安然不高兴的时候一般要怎么哄"', period: 'Day 38 傍晚', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [198, 199], noise: false },
  { id: 'stm_116', event: '苏茉在电话里劝江岚："安然不是要跟你争输赢，她是要被你在乎。你认个错什么都好了。"', period: 'Day 38 傍晚', scene: '(线上)', entities: [{ name: '苏茉', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [200, 201], noise: false },
  { id: 'stm_117', event: '苏茉通话时背景音里有同事喊她去开会，她匆忙挂了电话', period: 'Day 38 傍晚', scene: '(线上)', entities: [{ name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [202], noise: true },

  { id: 'stm_118', event: '程浩给江岚发私信，说读过合作小说后"很感兴趣"，提议"联手写一篇关于悬疑叙事的行业文章"', period: 'Day 39 上午', scene: '(线上)', entities: [{ name: '程浩', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [203, 204], noise: false },
  { id: 'stm_119', event: '江岚婉拒程浩：我已经有写作搭档了。程浩回复"搭档和合作不是一回事"', period: 'Day 39 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '程浩', type: 'character' }], status: 'closed', msg_ids: [205, 206], noise: false },
  { id: 'stm_120', event: '安然无意间看到江岚电脑上程浩的消息对话框，默默关掉屏幕当没看见', period: 'Day 39 傍晚', scene: '702公寓 · 书房', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [207], noise: false },
  { id: 'stm_121', event: '江岚觉得今天阳光太好，拉着安然去阳台晒了半小时被子', period: 'Day 40 上午', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [208], noise: true },

  { id: 'stm_122', event: '安然主动打开房门，把新大纲放在茶几上——她花了三天时间把科幻和情感融合成了"近未来末日背景下两个陌生人的相互救赎"', period: 'Day 40 晚上', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [209, 210], noise: false },
  { id: 'stm_123', event: '江岚看完大纲后沉默了很久——大纲最后一页的空白处，安然用铅笔写着"这个故事写给那个让我相信合作比竞争更好的人"', period: 'Day 40 深夜', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [211, 212], noise: false },
  { id: 'stm_124', event: '江岚说这是她读过的最好的大纲，不是因为它完美，而是因为它有安然独特的温度', period: 'Day 40 深夜', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [213, 214], noise: false },

  { id: 'stm_125', event: '两人开始在客厅重新画新书大纲——这次配合默契，安然想感情线时江岚立即补充悬疑线索', period: 'Day 41 上午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [215, 216], noise: false },
  { id: 'stm_126', event: '程浩的新书《深渊回响》销量数据公布——首月不到合作小说的三分之一', period: 'Day 42 上午', scene: '(线上)', entities: [{ name: '程浩', type: 'character' }], status: 'closed', msg_ids: [217, 218], noise: false },
  { id: 'stm_127', event: '安然看到程浩销量数据后在客厅里哼了一天歌——江岚笑她"嘴上说不在乎但还是在乎"', period: 'Day 42 下午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }, { name: '江岚', type: 'character' }], status: 'closed', msg_ids: [219, 220], noise: false },
  { id: 'stm_128', event: '外卖送错了餐——两人点的麻辣烫变成了寿司，将就着吃了', period: 'Day 42 晚上', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [221], noise: true },

  { id: 'stm_129', event: '苏茉和王姐合作的线上读书社区项目正式获批，苏茉主导市场方案', period: 'Day 43 上午', scene: '新公司办公室', entities: [{ name: '苏茉', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [222, 223], noise: false },
  { id: 'stm_130', event: '陈教授联系林晚，问她有没有兴趣在职读研——林晚的毕业论文在他那里评价很高', period: 'Day 44 下午', scene: '(线上)', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [224, 225], noise: false },
  { id: 'stm_131', event: '新书第一章写完——江岚的科幻开篇和安然的情感插入无缝衔接，两人第一次没有改对方的段落', period: 'Day 45 晚上', scene: '702公寓 · 书房', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [226, 227], noise: false },
  { id: 'stm_132', event: '林晚决定边工作边读研——白天在出版社做编辑助理，晚上回学校上研究生课', period: 'Day 46 下午', scene: '601公寓', entities: [{ name: '林晚', type: 'character' }], status: 'closed', msg_ids: [228, 229], noise: false },
  { id: 'stm_133', event: '江岚买了一块新白板，比原来那块大了一倍——因为大纲越写越复杂', period: 'Day 47 下午', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }], status: 'closed', msg_ids: [230, 231], noise: false },

  // ═══════════════════════════════════════════
  // PHASE 7: 落幕与新开始 (Days 51-60)
  // ═══════════════════════════════════════════
  { id: 'stm_134', event: '合作小说实体书上架一月入选当季"最受读者欢迎图书"前三', period: 'Day 51 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [232, 233], noise: false },
  { id: 'stm_135', event: '林晚在出版社的选题会上提议签下一位新人作者，王姐当场拍板——林晚的第一次独立选题', period: 'Day 52 上午', scene: '出版社大楼', entities: [{ name: '林晚', type: 'character' }, { name: '王姐', type: 'character' }], status: 'closed', msg_ids: [234, 235], noise: false },
  { id: 'stm_136', event: '安然在小区门口等快递时被读者认出来，被拉着拍了十几张合照', period: 'Day 53 下午', scene: '小区门口', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [236, 237], noise: false },
  { id: 'stm_137', event: '江岚和安然在第二本书的扉页各写了一句话作为献词——江岚写"致那个让我相信合作的人"，安然写"致那个教会我输赢不重要的人"', period: 'Day 54 晚上', scene: '702公寓 · 客厅', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [238, 239], noise: false },
  { id: 'stm_138', event: '安然换了新手机，因为旧的屏幕在签售会摔裂了——换手机时发现照片没备份全，丢了跟江岚的第一张合照', period: 'Day 55 上午', scene: '702公寓 · 客厅', entities: [{ name: '安然', type: 'character' }], status: 'closed', msg_ids: [240], noise: true },
  { id: 'stm_139', event: '江岚去商场的超市买菜时迷路了，打电话让安然来领她——安然笑了她一路', period: 'Day 56 下午', scene: '商场', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [241], noise: true },

  { id: 'stm_140', event: '苏茉的线上读书社区项目正式上线，首月注册用户破三万', period: 'Day 57 上午', scene: '新公司办公室', entities: [{ name: '苏茉', type: 'character' }], status: 'closed', msg_ids: [242, 243], noise: false },
  { id: 'stm_141', event: '出版社通知：合作小说提名年度最佳新人作品奖，江岚和安然受邀参加颁奖典礼', period: 'Day 58 上午', scene: '(线上)', entities: [{ name: '王姐', type: 'character' }, { name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [244, 245], noise: false },
  { id: 'stm_142', event: '新书第一章在平台上免费放出后，收藏二十四小时内破两万——比合作小说开篇时还多了三倍', period: 'Day 59 上午', scene: '(线上)', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [246, 247], noise: false },
  { id: 'stm_143', event: '江岚在阳台上对安然说"老实说，我以前的写作一直是孤独的。现在好像不是了。"', period: 'Day 60 傍晚', scene: '702公寓 · 阳台', entities: [{ name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [248, 249], noise: false },
  { id: 'stm_144', event: '林晚给阳台送了盆新茉莉花——说是庆祝新书第一章数据和新生活的开始', period: 'Day 60 晚上', scene: '702公寓 · 阳台', entities: [{ name: '林晚', type: 'character' }, { name: '江岚', type: 'character' }, { name: '安然', type: 'character' }], status: 'closed', msg_ids: [250, 251], noise: false },
];

export var allLTM = [];

export var noiseCount = allSTM.filter(function(e) { return e.noise; }).length;

export function buildEntityToStmIds() {
    var map = {};
    allSTM.forEach(function(s) {
        if (s.entities) {
            s.entities.forEach(function(en) {
                var name = typeof en === 'string' ? en : en.name;
                if (!name) return;
                if (!map[name]) map[name] = [];
                map[name].push(s.id);
            });
        }
    });
    return map;
}

export var entityToStmIds = buildEntityToStmIds();
