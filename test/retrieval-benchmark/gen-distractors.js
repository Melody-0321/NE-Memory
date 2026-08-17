// Distractor generator for scale benchmark
// Generates ~860 same-world sideplot events (Day 61-120) via DeepSeek
// Topics are orthogonal to the 28 queries' main arcs to avoid GT contamination
// Run: node test/retrieval-benchmark/gen-distractors.js

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf-8'));

var TARGET = 860;
var BATCH = 20;
var CONCURRENCY = 3;
var OUT_PATH = join(__dirname, 'distractors.json');

// Topics orthogonal to query main arcs (月票榜/合作小说/感情线/林晚论文求职/苏茉转行/程浩/出版签售/第二本书/做饭水平/阳台谈程浩...)
var LIFE_TOPICS = [
    '超市采购与网购快递', '楼下流浪猫与宠物', '感冒生病与看医生', '跑步健身与晨练',
    '父母来电与家人寄特产', '旧物整理与断舍离', '电子游戏与手游', '摄影与拍照',
    '下雨天与台风天', '停电与跳闸', '空调与家电维修', '阳台花草种植',
    '骑自行车出行', '地铁与公交出行', '咖啡店日常', '理发与换发型',
    '买衣服与逛街', '手机故障与换机贴膜', '中秋节与节日装饰', '生日与蛋糕',
    '帮朋友搬家', '图书馆与自习', '志愿服务与社区活动', '二手市场与闲置交易',
    '失眠与作息紊乱', '恐高与爬楼梯', '拼图与桌游', '囤货与收纳',
];
var ADJACENT_TOPICS = [
    '林晚写同人小说的业余爱好', '苏茉公司的营销活动与提案', '新配角作者的行业动态',
    '写作软件与效率工具的使用体验', '行业沙龙与线下活动', '文具与键盘装备',
    '有声书与播客收听', '读书会与分享会', '线下书展闲逛(非签售)', '写作素材取材外出',
];

// Hard blacklist: any hit -> discard event (main-arc vocabulary)
var BLACKLIST = [
    '月票', '赌约', '袜子', '合作小说', '双主角', '实体书', '出版', '签约', '合同', '版税',
    '签售', '颁奖', '提名', '程浩', '深渊回响', '论文', '导师', '答辩', '面试', 'offer',
    '出版社', '王姐', '大纲', '白板', '悬疑线', '感情线', '双视角', '互审', '告白', '牵手',
    '献词', '情侣', '读者群', '收藏', '追读', '差评', '爆更', '日更', '码字', '榜单',
    '读研', '转行', '市场策划', '编辑', '颁奖典礼',
];

var CHAR_POOL = ['江岚', '安然', '林晚', '苏茉'];

var SYSTEM_PROMPT = [
    '你是 AI 角色扮演记忆库的测试数据生成器。',
    '世界观：两位网文作者江岚和安然同住702公寓（她们的主线故事已结束，你生成的是之后日常阶段的支线事件）；',
    '邻居林晚住在601，闺蜜苏茉常来串门。',
    '你生成的每条事件都是"发生过但与主线无关"的日常支线，将被混入记忆库作为检索干扰项。',
].join('\n');

function buildUserPrompt(topics, count, startDay) {
    return [
        '生成 ' + count + ' 条支线事件，主题只允许来自：' + topics.join('、') + '。',
        '',
        '硬性要求：',
        '1. 禁止出现主线剧情：月票榜、合作写书、出版、感情告白、林晚的论文/求职、苏茉转行、任何竞争对手作者',
        '2. 时间一律用 "Day N 时段" 格式，N 在 ' + startDay + ' 到 ' + (startDay + 59) + ' 之间，时段从[凌晨/上午/中午/下午/傍晚/晚上/深夜]选',
        '3. scene 风格参照："702公寓 · 客厅"、"601公寓"、"街道"、"超市"、"楼下咖啡厅"',
        '4. event 为 25-60 字的叙事摘要，口语化，必须含具体细节（数字/物品/地点），entities 里的每个名字都必须在 event 文本中出现',
        '5. 出场角色从这些人里选：' + CHAR_POOL.join('、') + '，单条 1-2 人为主',
        '',
        '示例（格式参照，内容不可复用）：',
        '{"event":"江岚在超市采购时发现常用的挂耳咖啡半价，一口气买了六盒，结账时排了二十分钟队","period":"Day 63 下午","scene":"超市","entities":["江岚"]}',
        '{"event":"林晚在楼下花园发现一只三花流浪猫，连着三天带猫粮去喂，还给猫起了名字","period":"Day 65 傍晚","scene":"公寓花园","entities":["林晚"]}',
        '',
        '只输出 JSON，格式：{"events":[{"event":"...","period":"...","scene":"...","entities":["..."]}]}',
    ].join('\n');
}

async function callDeepSeek(topics, count, startDay, attempt) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 120000);
    try {
        var resp = await fetch(config.judge_v4.url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.judge_v4.key,
            },
            body: JSON.stringify({
                model: config.judge_v4.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: buildUserPrompt(topics, count, startDay) },
                ],
                temperature: 1.3,
                max_tokens: 6000,
            }),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        var text = data.choices[0].message.content;
        // Tolerant JSON extraction
        var s = text.indexOf('{');
        var e = text.lastIndexOf('}');
        if (s === -1 || e === -1) throw new Error('no JSON in response');
        var parsed = JSON.parse(text.slice(s, e + 1));
        if (!parsed.events || !Array.isArray(parsed.events)) throw new Error('no events array');
        return parsed.events;
    } finally {
        clearTimeout(timer);
    }
}

function validateEvent(ev, seenPrefix) {
    if (!ev || typeof ev.event !== 'string') return null;
    var event = ev.event.trim();
    if (event.length < 15 || event.length > 90) return null;
    if (typeof ev.period !== 'string' || !/^Day \d+/.test(ev.period)) return null;
    if (typeof ev.scene !== 'string' || !ev.scene) return null;
    var entities = Array.isArray(ev.entities) ? ev.entities.filter(function (n) { return typeof n === 'string' && n.length <= 4; }) : [];
    if (entities.length === 0) return null;
    var entitiesOk = entities.every(function (n) { return event.indexOf(n) !== -1; });
    if (!entitiesOk) return null;
    for (var i = 0; i < BLACKLIST.length; i++) {
        if (event.indexOf(BLACKLIST[i]) !== -1) return null;
    }
    var prefix = event.slice(0, 12);
    if (seenPrefix[prefix]) return null;
    seenPrefix[prefix] = true;
    return { event: event, period: ev.period.trim(), scene: ev.scene.trim(), entities: entities };
}

async function main() {
    console.log('=== Distractor Generation for Scale Benchmark ===');
    console.log('Target: ' + TARGET + ' events | model: ' + config.judge_v4.model + '\n');

    var allEvents = [];
    var seenPrefix = {};
    var discarded = 0;

    // Build batch plan: alternate life/adjacent topics, ~65%/35%
    var batches = [];
    var li = 0, ai = 0;
    var totalBatches = Math.ceil(TARGET * 1.25 / BATCH);
    for (var b = 0; b < totalBatches; b++) {
        var useLife = (b % 3 !== 2); // 2 of 3 batches are life topics
        var topics = [];
        if (useLife) {
            topics.push(LIFE_TOPICS[li % LIFE_TOPICS.length]); li++;
            topics.push(LIFE_TOPICS[(li + 7) % LIFE_TOPICS.length]);
        } else {
            topics.push(ADJACENT_TOPICS[ai % ADJACENT_TOPICS.length]); ai++;
        }
        batches.push({ topics: topics, startDay: 61 + (b * 2) % 55 });
    }

    var nextBatch = 0;
    async function worker(wid) {
        while (allEvents.length < TARGET && nextBatch < batches.length) {
            var bi = nextBatch++;
            var plan = batches[bi];
            var events = null;
            for (var attempt = 1; attempt <= 3 && !events; attempt++) {
                try {
                    events = await callDeepSeek(plan.topics, BATCH, plan.startDay, attempt);
                } catch (e) {
                    if (attempt === 3) console.log('  [w' + wid + '] batch ' + bi + ' failed: ' + e.message);
                    else await new Promise(function (r) { setTimeout(r, 2000); });
                }
            }
            if (!events) continue;
            var kept = 0;
            for (var k = 0; k < events.length && allEvents.length < TARGET + 60; k++) {
                var v = validateEvent(events[k], seenPrefix);
                if (v) { allEvents.push(v); kept++; }
                else discarded++;
            }
            console.log('  [w' + wid + '] batch ' + bi + ' (' + plan.topics[0].slice(0, 8) + '...): kept ' + kept + ', total ' + allEvents.length);
        }
    }
    var workers = [];
    for (var w = 0; w < CONCURRENCY; w++) workers.push(worker(w));
    await Promise.all(workers);

    // Trim to target, assign ids
    var final = allEvents.slice(0, TARGET).map(function (ev, idx) {
        return {
            id: 'dst_' + String(idx + 1).padStart(4, '0'),
            event: ev.event,
            period: ev.period,
            scene: ev.scene,
            entities: ev.entities.map(function (n) { return { name: n, type: 'character' }; }),
            status: 'closed',
            msg_ids: [],
            noise: false,
            distractor: true,
        };
    });

    var out = {
        generated: new Date().toISOString(),
        count: final.length,
        model: config.judge_v4.model,
        discarded: discarded,
        events: final,
    };
    writeFileSync(OUT_PATH, JSON.stringify(out, null, 1), 'utf-8');

    // Stats
    var byChar = {};
    final.forEach(function (e) {
        e.entities.forEach(function (en) { byChar[en.name] = (byChar[en.name] || 0) + 1; });
    });
    var avgLen = Math.round(final.reduce(function (s, e) { return s + e.event.length; }, 0) / final.length);
    console.log('\n=== Done ===');
    console.log('Kept: ' + final.length + ' | discarded: ' + discarded);
    console.log('Avg event length: ' + avgLen + ' chars');
    console.log('By character: ' + Object.keys(byChar).map(function (k) { return k + ':' + byChar[k]; }).join(', '));
    console.log('Output: ' + OUT_PATH);
}

main().catch(function (e) {
    console.error('Generator crashed:', e);
    process.exit(2);
});
