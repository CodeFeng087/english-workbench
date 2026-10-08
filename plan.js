// plan.js — 学习计划推导引擎（纯逻辑，完全不碰 DOM）
//
// 设计原则：全部是透明可读的算术，没有任何"AI 帮你生成"。
// 用户能在界面上看到每个数字是怎么算出来的，也能推翻它。
//
// 输入：state.profile（用户在「我的目标」里填的）
// 输出：周数、重排后的里程碑、按时间缩放的每日任务、素材排期、SMART 文案
//
// mock.js 里的 milestones / weeklyTasks 不删：它们升级为
// 「12 周权威课程表」和「30 分钟基线模板」，是本文件伸缩的源头。

/* ===================== 常量 ===================== */

// 12 周课程表的阶段划分。这是「编者意图」，不是计算结果，所以写死在这里。
const PLAN_PHASES = [
  { key: "base", name: "基础期", from: 1, to: 3, ratio: 3 },
  { key: "build", name: "强化期", from: 4, to: 8, ratio: 5 },
  { key: "paper", name: "套题期", from: 9, to: 10, ratio: 0 },
  { key: "sprint", name: "冲刺期", from: 11, to: 12, ratio: 0 },
];

// 每词学习成本（分钟）。1.25 由手写数据标定：
// 「学习 8 个高频词，抄写例句并朗读」= 10 分钟 → 10/8 = 1.25
// 这样 30 分钟基线派生出 30 词/周，与任务卡文案由构造保证一致。
const WORD_COST = { recognize: 0.5, use: 1.25, write: 2.2 };
const INTENSITY_OPTIONS = [
  { key: "recognize", name: "认识即可", desc: "见词知义，不抄不拼。单位时间产出最高，但写作/翻译里可能拼不出来。" },
  { key: "use", name: "会用（推荐）", desc: "抄例句 + 朗读，能读能写句子。手写任务卡的强度。" },
  { key: "write", name: "会拼会造", desc: "能拼写、能自己造句。最扎实，单位时间产出最低。" },
];

const PASS_SCORE = 425;   // 四级笔试公认过线线（满分 710）
const FULL_SCORE = 710;

// 受保护骨架：弱项阻尼不作用于它们。丢了复盘，学习统计就没有输入。
const PROTECTED_TYPES = ["词汇", "复习", "复盘", "计划", "模考", "素材"];
// 可阻尼的只有真正的四级题型
const DAMPABLE_TYPES = ["听力", "阅读", "写作", "翻译", "口语"];
const DAMP = 0.6;
// 口语不计入四级笔试总分（CET-SET 是单独选考），所以额外降权，
// 否则它会挤掉真正影响过线的听力/阅读时间。
const SPEAKING_DAMP = 0.5;

const WEAK_OPTIONS = ["听力", "阅读", "写作", "翻译", "口语", "词汇"];

const SLOT_FLOOR = { 听力: 5, 阅读: 5, 写作: 5, 口语: 5, 翻译: 5, 词汇: 5, 复习: 5, 复盘: 5, 计划: 5, 模考: 15, 素材: 5 };
const SLOT_CAP = { 听力: 20, 阅读: 20, 写作: 20, 口语: 20, 翻译: 20, 词汇: 20, 复习: 20, 复盘: 20, 计划: 5, 模考: 40, 素材: 20 };

// 缩减顺序：先砍最能省的，绝不先砍题型
const SHRINK_ORDER = ["素材", "计划", "复盘", "模考", "复习", "词汇"];

const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const MAX_WEEKS = 24;
const MIN_WEEKS = 4;
const WORD_CAP_PER_WEEK = 150;

/* ===================== 画像 ===================== */
// 注意：mock.js 里的 examDate 是 "2026-12 中旬"、vocabEstimate 是 "约 1800"，
// 都是给人看的字符串，parseDate 会得到 Invalid Date。所以这里重新给出可解析的默认值。
// 默认考试日取 2026-12-12（周六）—— 从 weekStart("2026-09-24")=2026-09-21 起算
// 正好 12 周，能精确复现手写的 12 周计划。
function defaultProfile() {
  const up = (typeof userProfile !== "undefined") ? userProfile : {};
  return {
    name: up.name || "同学",
    grade: up.grade || "大二",
    startScore: 140,
    goalScore: 380,
    examDate: "2026-12-12",
    planStart: weekStart(todayStr()),
    dailyMinutes: 30,
    vocabNow: 1800,
    vocabTarget: 4500,
    selfAccuracy: 30,          // 听力/阅读 自评正确率起点（没有别的数据源）
    intensity: "use",
    weakSkills: ["听力", "阅读"],
    interests: [],             // 空数组 = 不限
  };
}

function getProfile() {
  const d = defaultProfile();
  const p = (state && state.profile) ? state.profile : {};
  const out = Object.assign({}, d);
  Object.keys(d).forEach(k => {
    if (p[k] !== undefined && p[k] !== null && p[k] !== "") out[k] = p[k];
  });
  // 数值字段强制转成数字，宁可回退默认值也不要让 NaN 漏进渲染
  ["startScore", "goalScore", "dailyMinutes", "vocabNow", "vocabTarget", "selfAccuracy"].forEach(k => {
    const n = Number(out[k]);
    out[k] = isFinite(n) ? n : d[k];
  });
  if (!Array.isArray(out.weakSkills)) out.weakSkills = d.weakSkills.slice();
  if (!Array.isArray(out.interests)) out.interests = [];
  if (!WORD_COST[out.intensity]) out.intensity = "use";
  // planStart 一律对齐到周一（修掉「周期从周四起算、任务卡从周一起算」的不一致）
  out.planStart = weekStart(out.planStart || d.planStart);
  return out;
}

function setProfile(patch) {
  state.profile = Object.assign({}, state.profile || {}, patch);
  saveJSON(STORAGE_KEYS.profile, state.profile);
  Plan.clear();
}

function resetProfile() {
  state.profile = {};
  saveJSON(STORAGE_KEYS.profile, {});
  Plan.clear();
}

// 逐字段校验。返回 { field: "错误说明" }，供表单就地显示。
function profileErrors(p) {
  const e = {};
  if (!(p.startScore >= 0 && p.startScore <= FULL_SCORE)) e.startScore = `当前分数要在 0 ~ ${FULL_SCORE} 之间`;
  if (!(p.goalScore > 0 && p.goalScore <= FULL_SCORE)) e.goalScore = `目标分数要在 1 ~ ${FULL_SCORE} 之间`;
  if (p.goalScore < p.startScore) e.goalScore = "目标分数不能低于当前分数";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.examDate)) e.examDate = "考试日期格式应为 2026-12-12";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.planStart)) e.planStart = "起始日期格式应为 2026-09-21";
  if (e.examDate === undefined && e.planStart === undefined && dateDiff(p.planStart, p.examDate) < 0) {
    e.examDate = "考试日期不能早于计划起始日";
  }
  if (!(p.dailyMinutes >= 5 && p.dailyMinutes <= 240)) e.dailyMinutes = "每天学习时间要在 5 ~ 240 分钟之间";
  if (!(p.vocabNow >= 0)) e.vocabNow = "词汇量不能为负数";
  if (p.vocabTarget <= p.vocabNow) e.vocabTarget = "目标词汇量要大于当前词汇量";
  if (!(p.selfAccuracy >= 0 && p.selfAccuracy <= 100)) e.selfAccuracy = "正确率要在 0 ~ 100 之间";
  return e;
}

/* ===================== 时间线 ===================== */

// 用 ceil：floor 会让计划在考试前一周就结束（82 天 ÷ 7 = 11.7 → 11 周，
// 计划 12-06 结束而考试在 12-12），白白浪费最后一周。
function rawWeeks(p) {
  return Math.ceil(dateDiff(p.planStart, p.examDate) / 7);
}

// 实际采用的周数。不足 4 周不生成计划（见 build() 的 tooShort 分支）。
function planWeeks(p) {
  const w = rawWeeks(p);
  if (w < MIN_WEEKS) return w;                 // 交给上层显示"时间不够"
  return Math.min(MAX_WEEKS, w);
}

function planEndDate(p, n) {
  return dateAdd(p.planStart, n * 7 - 1);
}

/* ===================== 配额分配 ===================== */

// 把 total 个名额按 a:b 分配，用最大余数法，并列时给靠前的。
function splitByRatio(total, a, b) {
  if (total <= 0) return [0, 0];
  const ra = (total * a) / (a + b);
  const rb = (total * b) / (a + b);
  let ia = Math.floor(ra), ib = Math.floor(rb);
  const rem = total - ia - ib;
  const order = (ra - ia) >= (rb - ib) ? [0, 1] : [1, 0];
  for (let k = 0; k < rem; k++) {
    if (order[k % 2] === 0) ia++; else ib++;
  }
  return [ia, ib];
}

// 三阶段配额（基础 / 强化 / 套题 / 冲刺）。规则见方案：
// 1) 保尾：冲刺期先占位  2) 保套题  3) 余量按 3:5 给基础与强化
function allocatePhases(n) {
  let sprint = n < 5 ? 1 : n >= 18 ? 4 : n >= 13 ? 3 : 2;
  let paper = Math.max(1, Math.min(3, Math.round(n / 6)));
  let rest = n - sprint - paper;

  // 保证基础与强化各至少 1 周，不足时从套题/冲刺借
  while (rest < 2 && paper > 1) { paper--; rest++; }
  while (rest < 2 && sprint > 1) { sprint--; rest++; }
  if (rest < 2) { rest = 2; }   // n 很小时的兜底，后面会被裁掉

  let [base, build] = splitByRatio(rest, 3, 5);
  if (base < 1) { base = 1; build = rest - 1; }
  if (build < 1) { build = 1; base = rest - 1; }

  return { base, build, paper, sprint };
}

// 把 count 个源均分成 groups 组（余数给靠前的组）
function evenSplit(count, groups) {
  const base = Math.floor(count / groups);
  const rem = count % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < rem ? 1 : 0));
}

// 把 count 个源等距放进 slots 个位置，保证首尾落位；空位为 null
function spreadIndices(count, slots) {
  const out = new Array(slots).fill(null);
  if (count <= 0 || slots <= 0) return out;
  if (count === 1) { out[0] = 0; return out; }
  const taken = new Set();
  for (let k = 0; k < count; k++) {
    let pos = Math.round((k * (slots - 1)) / (count - 1));
    while (taken.has(pos) && pos < slots - 1) pos++;   // 取整撞车时往后让
    while (taken.has(pos) && pos > 0) pos--;
    taken.add(pos);
    out[pos] = k;
  }
  return out;
}

// 阶段内扩展时的复习周内容（绝不编造新知识点）
function reviewWeekContent(phaseKey, seq) {
  if (phaseKey === "base") {
    return { title: "词汇巩固 + 辨音（间隔复习）", target: "把已学词过一遍，重点练听不出/写不出的那些" };
  }
  if (phaseKey === "build") {
    const rot = [
      { title: "错题重做 + 弱项加练", target: "把错题本里仍未攻克的词和题重做一遍" },
      { title: "弱项限时训练", target: "挑最弱的一项做限时训练，记录正确率" },
      { title: "错题二刷 + 长句听写", target: "仍做错的题单独抄出来，隔天再刷一次" },
    ];
    return rot[(seq - 1) % rot.length];
  }
  if (phaseKey === "paper") {
    return { title: "套题巩固：错题归类", target: "把上一套的错题按「没听懂/没读懂/词不认识」分类" };
  }
  return { title: `全真模考（第 ${Math.max(2, seq)} 次）+ 错题归类`, target: "计时完整做一套，对比上一次的正确率" };
}

/* ===================== 里程碑重排 ===================== */
// 12 个源里程碑 → N 周。
// 配额 < 源数：合并（绝不丢弃）；配额 > 源数：空位补复习周。
function buildMilestones(p, n) {
  const alloc = allocatePhases(n);
  const quotaOf = { base: alloc.base, build: alloc.build, paper: alloc.paper, sprint: alloc.sprint };

  const out = [];
  PLAN_PHASES.forEach(ph => {
    const srcIdx = [];
    for (let w = ph.from; w <= ph.to; w++) srcIdx.push(w - 1);   // 0-based
    const quota = quotaOf[ph.key] || 0;
    if (quota <= 0) return;

    if (quota === srcIdx.length) {
      srcIdx.forEach(i => out.push({ kind: "full", sources: [i], phase: ph.key }));
    } else if (quota < srcIdx.length) {
      const groups = evenSplit(srcIdx.length, quota);
      let pos = 0;
      groups.forEach(g => {
        const s = srcIdx.slice(pos, pos + g);
        pos += g;
        out.push({ kind: "compressed", sources: s, phase: ph.key });
      });
    } else {
      const slots = spreadIndices(srcIdx.length, quota);
      slots.forEach((srcI, seq) => {
        if (srcI != null) out.push({ kind: "full", sources: [srcIdx[srcI]], phase: ph.key });
        else out.push({ kind: "review", sources: [], phase: ph.key, seq });
      });
    }
  });

  // 裁到正好 n 周（allocatePhases 在极小 n 下可能多给）
  while (out.length > n) out.pop();

  const total = out.length;
  return out.map((w, k) => {
    const srcs = w.sources.map(i => milestones[i]).filter(Boolean);
    let title, target, id;

    if (w.kind === "full") {
      id = "m" + (w.sources[0] + 1);
      title = srcs[0] ? srcs[0].title : "（缺失）";
      target = srcs[0] ? srcs[0].target : "";
    } else if (w.kind === "compressed") {
      id = "m" + (w.sources[0] + 1);
      title = srcs.map(s => s.title).join(" ／ ");
      target = `压缩覆盖：${srcs.length} 个主题合并到一周，每个都碰一次、不求深入`;
    } else {
      id = `r:${w.phase}:${w.seq}`;
      const rv = reviewWeekContent(w.phase, w.seq);
      title = rv.title;
      target = rv.target;
    }

    return {
      week: k + 1,
      id,
      kind: w.kind,
      sources: w.sources.slice(),
      phase: w.phase,
      phaseName: (PLAN_PHASES.find(x => x.key === w.phase) || {}).name || "",
      title,
      target,
      focus: srcs.map(s => s.title).join("、"),
    };
  });
}

/* ===================== 词量 ===================== */

// 手写数据把「学新词」和「复习词」都标成了 type:"词汇"，
// 直接按 type 求和会把复习时长也算成新词 —— 实测会把 50 分钟算成 60 分钟，
// 词量从 40 虚高到 48。所以按原文案语义区分：
// 「学习 N 个高频词」「把生词加入词库」= 学新词；
// 只含「复习本周所有高频词」「回忆词义」而无学习动作 = 复习。
// 周三那条「学习 6 个 + 复习前两天的词」两者兼有，算学新词，
// 文案生成时会把「顺带复习到期的词」保留下来，不丢失复习意图。
const REVIEW_ONLY_HINT = /复习|回忆|仍不熟/;
const LEARN_HINT = /学习|加入词库/;
function slotIsNewWords(baseContent) {
  const c = String(baseContent || "");
  return LEARN_HINT.test(c) || !REVIEW_ONLY_HINT.test(c);
}

// 每天用于「学新词」的分钟数（由任务分配决定，是唯一的真相来源）
function vocabMinutesPerDay(slots) {
  return slots.filter(s => s.newWords).reduce((a, s) => a + s.minutes, 0);
}

function wordsForMinutes(minutes, intensity) {
  const cost = WORD_COST[intensity] || WORD_COST.use;
  return Math.max(1, Math.floor(minutes / cost));
}

// 全计划词量：把每周「学新词」的分钟数换成词数。
// 里程碑、任务卡、可行性判断全部用这一个数，杜绝「里程碑说 40、任务卡教 28」。
function weeklyWordsOf(weekTasks, intensity) {
  const mins = weekTasks.reduce((a, d) => a + vocabMinutesPerDay(d.slots), 0);
  const raw = Math.floor(mins / (WORD_COST[intensity] || WORD_COST.use));
  return { words: Math.min(WORD_CAP_PER_WEEK, raw), capped: raw > WORD_CAP_PER_WEEK, minutes: mins };
}

// 取整：<50 精确到 2，>=50 精确到 10，避免「掌握 43 词」这种假精度
function roundWords(n) {
  return n < 50 ? Math.round(n / 2) * 2 : Math.round(n / 10) * 10;
}
function roundPct(n) {
  return Math.round(n / 5) * 5;
}

/* ===================== 每日任务 ===================== */

function parseMinutes(s) {
  const m = String(s || "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 10;
}

function round5(n) { return Math.max(5, Math.round(n / 5) * 5); }

// 弱项阻尼：非弱项题型乘 0.6；受保护骨架不参与；口语额外降权
function dampOf(type, p) {
  if (PROTECTED_TYPES.includes(type)) return 1;
  if (!DAMPABLE_TYPES.includes(type)) return 1;
  let f = p.weakSkills.includes(type) ? 1 : DAMP;
  if (type === "口语") f *= SPEAKING_DAMP;
  return f;
}

// 稳定的槽位键：语义化的，不随任务数量变化而漂移
function slotKey(dayIdx, type, seq) {
  return `${DAY_CODES[dayIdx]}-${type}-${seq === 0 ? "main" : seq + 1}`;
}

const TASK_TEXT = {
  "听力": m => `精听 ${Math.max(1, Math.round(m / 10))} 段四级短对话（先盲听→看原文→跟读）`,
  "阅读": m => `精读 ${Math.max(1, Math.round(m / 12))} 篇四级阅读（标出不懂的词，先猜后查）`,
  "写作": m => `学 ${Math.max(1, Math.round(m / 10))} 个写作模板句并仿写`,
  "口语": m => `跟读影视片段 ${Math.max(1, Math.round(m / 10))} 遍（模仿语音语调）`,
  "翻译": m => `翻译 ${Math.max(1, Math.round(m / 10))} 句真题（对照参考译文标出差异）`,
  "复习": m => `复习到期的词，遮住中文回忆词义（约 ${m} 分钟）`,
  "复盘": () => "填写复盘日志三问（做到了什么／卡在哪里／下周怎么调）",
  "计划": () => "规划下周任务，更新里程碑状态",
  "模考": m => `做 1 套真题片段（听力 + 阅读），记录正确率（限时 ${m} 分钟）`,
  "素材": m => `精听／精看 1 个本周素材，对照字幕（约 ${m} 分钟）`,
};

// 扩展任务池：全部是真事，10 分钟一条
const EXTENSIONS = {
  "听力": { content: "精听 1 段真题长对话，逐句听写关键词并核对", minutes: 10 },
  "阅读": { content: "限时做 1 篇阅读（只练速度，对完答案不精读）", minutes: 10 },
  "写作": { content: "仿写 1 个主体段（约 80 词），对照范文改 1 遍", minutes: 10 },
  "口语": { content: "跟读 1 段并录音，回听找出 3 个发音问题", minutes: 10 },
  "翻译": { content: "翻译 1 句真题长句，对照参考译文标出差异", minutes: 10 },
  "词汇": { content: "打开「背单词测验 → 复习到期」，清空今天的到期词", minutes: 10 },
  "复习": { content: "把本周错题重做一遍，仍错的标星", minutes: 10 },
};

function makeContent(type, minutes, intensity, extra) {
  if (type === "词汇") {
    const n = wordsForMinutes(minutes, intensity);
    return minutes >= 10
      ? `学习 ${n} 个高频词，抄写例句并朗读；顺带复习到期的词`
      : `学习 ${n} 个高频词`;
  }
  const f = TASK_TEXT[type];
  return f ? f(minutes, extra) : `${type}练习（${minutes} 分钟）`;
}

// 生成某一天的任务：先按基线缩放，再拟合到用户设定的分钟数
function buildDay(p, n, dayIdx) {
  const M = p.dailyMinutes;
  const baseSrc = (typeof weeklyTasks !== "undefined" && weeklyTasks[dayIdx])
    ? weeklyTasks[dayIdx].tasks : [];
  const f = M / 30;

  const seqOf = {};
  const slots = baseSrc.map(t => {
    const seq = seqOf[t.type] || 0;
    seqOf[t.type] = seq + 1;
    const floor = t.type === "模考" ? Math.min(SLOT_FLOOR["模考"], M) : SLOT_FLOOR[t.type];
    const cap = SLOT_CAP[t.type] || 20;
    const raw = parseMinutes(t.time) * f * dampOf(t.type, p);
    const minutes = Math.max(floor, Math.min(cap, round5(raw)));
    return {
      type: t.type, minutes, seq,
      key: slotKey(dayIdx, t.type, seq),
      ext: false,
      newWords: t.type === "词汇" ? slotIsNewWords(t.content) : false,
    };
  });

  let total = slots.reduce((a, s) => a + s.minutes, 0);

  // 1) 超出 M：按缩减顺序砍，每个槽位只砍到下限
  if (total > M) {
    for (const type of SHRINK_ORDER) {
      if (total <= M) break;
      for (const s of slots) {
        if (total <= M) break;
        if (s.type !== type) continue;
        const floor = type === "模考" ? Math.min(15, M) : SLOT_FLOOR[type];
        const cut = Math.min(s.minutes - floor, total - M);
        if (cut > 0) { s.minutes -= cut; total -= cut; }
      }
    }
    // 仍超出（M 很小而骨架任务多）：从后往前整条删非骨架任务
    for (let i = slots.length - 1; i >= 0 && total > M; i--) {
      const s = slots[i];
      if (PROTECTED_TYPES.includes(s.type) && s.type !== "素材") continue;
      total -= s.minutes;
      slots.splice(i, 1);
    }
  }

  // 2) 不足 M：扩容已有槽位。
  //    每次给「优先级最高里最矮的那个」加 5 分钟 —— 逐类型涨到上限会让
  //    时间全被排在最前的弱项吃掉，其余槽位一直停在 5 分钟。
  const rank = t => {
    const wi = p.weakSkills.indexOf(t);
    if (wi >= 0) return wi;                                    // 弱项最优先
    if (t === "词汇" || t === "复习") return 20;                // 地基次之
    if (DAMPABLE_TYPES.includes(t)) return 40 + DAMPABLE_TYPES.indexOf(t);
    return 80;
  };
  let growGuard = 0;
  const growToFit = () => {
    while (total < M && growGuard++ < 300) {
      const cands = slots.filter(s => s.minutes < (SLOT_CAP[s.type] || 20));
      if (!cands.length) return;
      cands.sort((a, b) => (rank(a.type) - rank(b.type)) || (a.minutes - b.minutes));
      const s = cands[0];
      const cap = SLOT_CAP[s.type] || 20;
      const g = Math.min(5, M - total, cap - s.minutes);
      if (g <= 0) return;
      s.minutes += g;
      total += g;
    }
  };
  growToFit();

  // 3) 仍差 ≥10 分钟（扩展任务的最小粒度）才加扩展任务，
  //    这样文案和时长才对得上 —— 否则会排出「5 分钟的精听 1 段长对话」。
  if (M - total >= 10 && slots.length < 5) {
    const order = p.weakSkills.filter(t => EXTENSIONS[t]);
    const rest = Object.keys(EXTENSIONS).filter(t => !order.includes(t));
    let added = 0;
    for (const type of order.concat(rest)) {
      if (M - total < 10 || added >= 3 || slots.length >= 5) break;
      const ex = EXTENSIONS[type];
      const seq = seqOf[type] || 0;
      seqOf[type] = seq + 1;
      slots.push({
        type, minutes: ex.minutes, seq, ext: true,
        key: `${DAY_CODES[dayIdx]}-ext-${type}`,
        content: ex.content,
        newWords: false,
      });
      total += ex.minutes;
      added++;
    }
    growToFit();   // 新加的扩展槽位可能还能继续长
  }

  // 生成文案（扩展任务的 content 固定，不重新生成）
  slots.forEach(s => {
    if (!s.content) s.content = makeContent(s.type, s.minutes, p.intensity);
    s.time = s.minutes + " 分钟";
  });

  const types = [];
  slots.forEach(s => { if (!types.includes(s.type)) types.push(s.type); });

  // 合计对不上 M 时必须给出可读的原因 —— 否则自检无法区分
  // 「诚实的排不下」和「算错了」。
  let reason = "";
  if (total < M) {
    const canGrow = slots.some(s => s.minutes < (SLOT_CAP[s.type] || 20));
    if (!canGrow) reason = "所有任务都已到单任务时长上限，再凑就只能注水";
    else reason = `余下不足一条扩展任务的最小粒度（10 分钟）`;
  } else if (total > M) {
    reason = `受保护任务的下限之和已超过每天 ${M} 分钟（词汇、复盘、计划等是保底项，不能砍到 5 分钟以下）`;
  }

  return {
    day: DAY_NAMES[dayIdx],
    focus: types.length ? types.join(" + ") : "自由安排",
    slots,
    minutes: total,
    leftover: Math.max(0, M - total),
    over: Math.max(0, total - M),
    offBudget: total !== M,
    reason,
  };
}

// 弱项覆盖兜底：手写基线里根本没有「翻译」槽位（翻译只出现在里程碑第 7 周），
// 所以用户把翻译选成弱项时整周都不练翻译 —— "针对弱项"就成了空话。
// 这里在周层面检查，缺哪个弱项就补一条扩展任务到余量最多的一天。
function ensureWeakCoverage(days, p) {
  const missing = p.weakSkills.filter(t => t && !days.some(d => d.slots.some(s => s.type === t)));
  missing.forEach(type => {
    const ex = EXTENSIONS[type] || { content: `${type}练习（10 分钟）`, minutes: 10 };
    const cands = days
      .map((d, i) => ({ d, i }))
      .filter(x => x.d.slots.length < 6)
      .sort((a, b) => (b.d.leftover - a.d.leftover) || (a.d.slots.length - b.d.slots.length));
    const pick = cands[0];
    if (!pick) return;
    const d = pick.d;
    const seq = d.slots.filter(s => s.type === type).length;
    d.slots.push({
      type, minutes: ex.minutes, ext: true, seq,
      key: `${DAY_CODES[pick.i]}-ext-${type}`,
      content: ex.content,
      newWords: false,
      time: ex.minutes + " 分钟",
    });
    d.minutes += ex.minutes;
    d.leftover = Math.max(0, p.dailyMinutes - d.minutes);
    d.over = Math.max(0, d.minutes - p.dailyMinutes);
    d.offBudget = d.minutes !== p.dailyMinutes;
    d.reason = "为了让每个弱项每周至少练一次，这一天临时加了一条任务";
  });
}

function buildWeekTasks(p, n) {
  const days = DAY_NAMES.map((_, i) => buildDay(p, n, i));
  ensureWeakCoverage(days, p);
  return days;
}

/* ===================== 素材排期 ===================== */
// 兴趣只排序、不硬排除。硬排除正是制造空槽的原因
// （池子里 游戏×听力 和 英文歌曲×阅读 各 0 条，只选游戏时听力会永远空）。
const MATERIAL_PASSES = [
  { pass: 1, how: "先盲听 1 遍 → 对照字幕听 2 遍 → 跟读 1 遍。" },
  { pass: 2, how: "不看字幕听写关键词 → 再对照字幕核对 → 复述大意。" },
  { pass: 3, how: "限时听写全文／逐句跟读录音，和原音对比。" },
];

function materialPool() {
  return (typeof materials !== "undefined" ? materials : []).slice();
}

// 兴趣选项直接从池子里的 format 去重生成，永不会与素材漂移
function interestOptions() {
  const set = [];
  materialPool().forEach(m => { if (m.format && !set.includes(m.format)) set.push(m.format); });
  return set.sort();
}

function pickMaterials(p, n) {
  const pool = materialPool();
  const types = ["听力", "阅读"];
  const interestRank = m => (p.interests.length === 0 || p.interests.includes(m.format)) ? 0 : 1;

  // 按周 × 类型排期：同一素材两次出现间隔 ≥ 3 周
  const usedAt = new Map();   // material -> 最近使用周
  const out = [];

  for (let w = 1; w <= n; w++) {
    const weekItems = [];
    for (const type of types) {
      const cands = pool.filter(m => m.type === type);
      // 先按兴趣，再按「距上次使用最久」，最后按原始顺序（稳定）
      const sorted = cands.map((m, i) => ({ m, i }))
        .sort((a, b) => {
          const ri = interestRank(a.m) - interestRank(b.m);
          if (ri !== 0) return ri;
          const la = usedAt.has(a.m) ? usedAt.get(a.m) : -99;
          const lb = usedAt.has(b.m) ? usedAt.get(b.m) : -99;
          if (la !== lb) return la - lb;
          return a.i - b.i;
        });

      // 优先选 3 周内没用过的
      let chosen = sorted.find(x => !usedAt.has(x.m) || (w - usedAt.get(x.m)) >= 3);
      if (!chosen) chosen = sorted[0];   // 实在没有就破例，但会标注

      if (!chosen) {
        // 该类型没有任何素材：兜底填方法，绝不编造标题或链接
        weekItems.push({
          week: w, type, fallback: true,
          format: "真题",
          title: `自选 1 段${type === "听力" ? "真题短对话" : "真题阅读"}`,
          level: "自定",
          reason: `素材库里符合你兴趣的${type}材料暂时没有，这周先用真题。`,
          howToUse: type === "听力"
            ? "按「盲听 → 看原文 → 跟读」三步走。"
            : "先限时做一遍，再精读标出生词。",
          link: "用你的真题书／试卷即可",
          pass: 1,
        });
        continue;
      }

      const m = chosen.m;
      const prev = usedAt.get(m);
      const pass = prev === undefined ? 1 : ((w - prev) >= 7 ? 3 : 2);
      const repeat = prev !== undefined;
      usedAt.set(m, w);

      weekItems.push(Object.assign({}, m, {
        week: w,
        pass,
        repeat,
        offInterest: interestRank(m) === 1,
        howToUse: MATERIAL_PASSES[Math.min(pass, 3) - 1].how,
        reason: repeat
          ? `第 ${pass} 遍：同一素材换更难的工序（${MATERIAL_PASSES[Math.min(pass, 3) - 1].how.slice(0, 12)}…），和背单词的间隔复习是同一个道理。`
          : (interestRank(m) === 1
            ? `${m.reason}　（不在你选定的兴趣里，但本周需要它）`
            : m.reason),
      }));
    }
    out.push({ week: w, items: weekItems });
  }
  return out;
}

/* ===================== SMART 文案 ===================== */
// 全部用真实数字重新生成，不再写死「140→380」「30 分钟」「12 周」。
// 不预测总分——「背了 N 个词所以能考 X 分」是伪算术。
function buildSmart(p, n, ctx) {
  const gap = p.goalScore - p.startScore;
  const weak = p.weakSkills.length ? p.weakSkills.join("、") : "（未选）";
  const belowPass = p.goalScore < PASS_SCORE;

  return {
    // 不写「平均每周提升 X 分」——分数不会匀速上涨，
    // 把它写成周目标等于承诺一个不存在的线性关系。
    S: `把四级总分从 ${p.startScore} 提升到 ${p.goalScore}（缺口 ${gap} 分）` +
       `，其中把 ${weak} 作为重点突破方向。`,
    M: `每周学习约 ${ctx.weeklyWords} 个高频词，做 1 套真题片段并记录正确率；` +
       `每天完成「每日任务卡」上的任务并打卡。本工具不预测总分，只跟踪这些能核对的过程指标。`,
    A: `每天投入 ${p.dailyMinutes} 分钟，共 ${n} 周（${p.planStart} 至 ${planEndDate(p, n)}）。` +
       `${p.dailyMinutes < 30 ? "时间偏紧，建议优先保证词汇与听力，其余按可支配时间伸缩。" : ""}`,
    R: `直接对应 ${p.examDate} 的四级笔试。` + (belowPass
      ? `注意：${p.goalScore} 分低于四级公认的过线线 ${PASS_SCORE} 分（满分 ${FULL_SCORE}），按过线算缺口是 ${PASS_SCORE - p.startScore} 分。`
      : ""),
    T: `在 ${p.examDate} 考试前完成，计划跨度 ${n} 周。`,
  };
}

/* ===================== 汇总 ===================== */
function build() {
  const p = getProfile();
  const errors = profileErrors(p);
  const raw = rawWeeks(p);

  if (Object.keys(errors).length) {
    return { ok: false, reason: "invalid", errors, profile: p };
  }
  if (raw < MIN_WEEKS) {
    return { ok: false, reason: "tooShort", rawWeeks: raw, profile: p, errors: {} };
  }

  const n = Math.min(MAX_WEEKS, raw);
  const clamped = raw > MAX_WEEKS;
  const ms = buildMilestones(p, n);
  const weekTasks = buildWeekTasks(p, n);
  const ww = weeklyWordsOf(weekTasks, p.intensity);

  // 词量可行性
  const gapWords = Math.max(0, p.vocabTarget - p.vocabNow);
  const capacity = ww.words * n;
  const poolSize = (typeof Quiz !== "undefined" && Quiz.pool) ? Quiz.pool().length : 0;
  const coverageWeeks = ww.words > 0 ? Math.floor(poolSize / ww.words) : n;
  const intensityAlt = p.intensity === "recognize" ? "use" : "recognize";
  const capacityAlt = Math.floor(ww.minutes / (WORD_COST[intensityAlt] || 1)) * n;

  // 需要如实告诉用户的话，全部是算出来的，不是劝告
  const warnings = [];
  if (p.dailyMinutes < 30) {
    const sat = weekTasks[5];
    warnings.push(`每天 ${p.dailyMinutes} 分钟排不下一次完整模考（模考片段至少要 30 分钟）。`
      + `周六只排了 ${sat.minutes} 分钟的片段练习 —— 这只是保持手感，替代不了完整模考。`);
  }
  if (ww.capped) {
    warnings.push(`每周词量已按上限 ${WORD_CAP_PER_WEEK} 词截断。`
      + `按 Leitner 间隔估算，再多的话到期复习会占满全部时间，只剩复习没有新词。`);
  }
  if (n < 6) {
    warnings.push(`距考试只剩 ${n} 周，计划已压缩：每个主题都会碰一次，但不会深入。`);
  }
  if (clamped) {
    warnings.push(`距考试还有约 ${raw / 4} 个月（${raw} 周），超过本工具上限 ${MAX_WEEKS} 周，已按 ${MAX_WEEKS} 周排 —— 剩下的时间可以到时候重新生成。`);
  }
  const shortDays = weekTasks.filter(d => d.offBudget && d.minutes < p.dailyMinutes);
  if (shortDays.length) {
    warnings.push(`有 ${shortDays.length} 天凑不满 ${p.dailyMinutes} 分钟（${shortDays.map(d => d.day).join("、")}）：`
      + `所有任务都已到单任务时长上限。这不是漏排 —— 计划不会为了凑数注水，多出来的时间建议自由复习到期词。`);
  }
  const overDays = weekTasks.filter(d => d.offBudget && d.minutes > p.dailyMinutes);
  if (overDays.length) {
    warnings.push(`有 ${overDays.length} 天超过 ${p.dailyMinutes} 分钟（${overDays.map(d => d.day).join("、")}）：`
      + `保底任务（词汇／复盘／计划）的下限之和就这么多，再砍就伤到地基了。`);
  }

  return {
    ok: true,
    errors: {},
    profile: p,
    weeks: n,
    askedWeeks: raw,
    clampedLonger: clamped,
    phases: allocatePhases(n),
    milestones: ms,
    weekTasks,
    warnings,
    weeklyWords: ww.words,
    weeklyWordsCapped: ww.capped,
    weeklyVocabMinutes: ww.minutes,
    wordsPerDay: ww.words / 5,
    gap: p.goalScore - p.startScore,
    gapPerWeek: Math.ceil((p.goalScore - p.startScore) / n),
    belowPass: p.goalScore < PASS_SCORE,
    passScore: PASS_SCORE,
    fullScore: FULL_SCORE,
    startDate: p.planStart,
    endDate: planEndDate(p, n),
    examDate: p.examDate,
    materials: pickMaterials(p, n),
    smart: buildSmart(p, n, { weeklyWords: ww.words }),
    vocab: {
      gapWords, capacity, feasible: capacity >= gapWords,
      poolSize, coverageWeeks,
      intensityAlt, capacityAlt, altName: (INTENSITY_OPTIONS.find(x => x.key === intensityAlt) || {}).name,
      minutesPerWeek: ww.minutes,
    },
    // 正确率是自评起点 + 按时长推的增益，不是凭空编的
    accuracy: (() => {
      const perDay = {};
      DAMPABLE_TYPES.forEach(t => {
        const mins = weekTasks.reduce((a, d) => a + d.slots.filter(s => s.type === t).reduce((b, s) => b + s.minutes, 0), 0);
        perDay[t] = mins / 7;
      });
      const out = {};
      Object.keys(perDay).forEach(t => {
        const gainPer4w = perDay[t] >= 10 ? 5 : 3;
        const target = Math.min(75, p.selfAccuracy + Math.round((n / 4) * gainPer4w));
        out[t] = { start: p.selfAccuracy, target: roundPct(target), minutesPerDay: Math.round(perDay[t] * 10) / 10 };
      });
      return out;
    })(),
  };
}

const Plan = {
  _cache: null,
  _key: null,
  clear() { this._cache = null; this._key = null; },

  get() {
    const p = getProfile();
    const key = [p.planStart, p.examDate, p.dailyMinutes, p.intensity, p.weakSkills.join(","), p.interests.join(","),
                 p.vocabNow, p.vocabTarget, p.startScore, p.goalScore, p.selfAccuracy].join("|");
    if (this._cache && this._key === key) return this._cache;
    this._cache = build();
    this._key = key;
    return this._cache;
  },

  // 供 core.js 的 currentWeek / planStatus 使用
  totalWeeks() {
    const r = this.get();
    return r.ok ? r.weeks : Math.max(1, planWeeks(r.profile || getProfile()));
  },
  startDate() { return (this.get().profile || getProfile()).planStart; },
  weekOf(dateStr) {
    const s = this.startDate();
    const d = dateDiff(s, dateStr);
    if (d < 0) return 0;
    return Math.floor(d / 7) + 1;
  },
  status() {
    const r = this.get();
    const t = todayStr();
    const s = (r.profile || getProfile()).planStart;
    if (dateDiff(s, t) < 0) return "before";
    // 画像非法或周数不足时不判「已结束」——否则界面会闪一下「计划已结束」，
    // 而实际原因在表单里，用户看不到。
    if (r.ok && dateDiff(t, r.endDate) < 0) return "after";
    return "active";
  },
  milestoneAt(week) {
    const r = this.get();
    if (!r.ok) return null;
    return r.milestones[week - 1] || null;
  },
};
