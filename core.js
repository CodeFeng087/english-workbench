// core.js — 通用基础层
// 必须最先加载（mock.js / words-extra.js / practice-data.js 之后，其余脚本之前）
// 提供：DOM 与转义工具、日期工具、存储层、全局 state、模块注册表、迁移、语音合成
// 约束：本文件不能依赖任何其他脚本的全局量在“加载时”存在（那些只在函数体内引用）
//       否则会抛 ReferenceError: Cannot access 'X' before initialization

/* ===================== DOM 与文本工具 ===================== */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// 转义：任何要拼进 innerHTML 的数据字符串都必须先过这里
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 防抖
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 归一化：用于比较“释义/单词是否实质相同”，挡住重复释义造成的双正确答案
function norm(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。；、,.;:：!！?？'"“”‘’()（）\[\]【】]/g, "");
}

// 轻提示（替代部分 alert，不阻塞）
function toast(msg, type = "info", ms = 3200) {
  // 无 DOM 环境（如 Node 自检脚本）直接跳过，不能因为提示失败而拖垮调用方
  if (typeof document === "undefined" || !document.body) return;
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg; // textContent 而非 innerHTML，天然免疫注入
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 250);
  }, ms);
}

// 通用多选一对话框，返回被选项的 value（点遮罩关闭则返回 null）。
// 注意：message 是调用方拼好的 HTML —— 里面的动态内容必须自己先 esc()。
function chooseDialog({ title, message, buttons }) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay show";

    const panel = document.createElement("div");
    panel.className = "modal-panel";
    panel.style.maxWidth = "540px";

    const header = document.createElement("div");
    header.className = "modal-header";
    const h3 = document.createElement("h3");
    h3.textContent = title;                 // textContent：标题不会被注入
    header.appendChild(h3);

    const body = document.createElement("div");
    body.className = "dialog-body";
    body.innerHTML = message;               // 调用方负责转义

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    let settled = false;
    const done = val => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };

    (buttons || []).forEach(b => {
      const btn = document.createElement("button");
      btn.className = "btn" + (b.cls ? " " + b.cls : "");
      btn.textContent = b.label;
      btn.addEventListener("click", () => done(b.value));
      actions.appendChild(btn);
    });

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(actions);
    overlay.appendChild(panel);

    overlay.addEventListener("click", e => { if (e.target === overlay) done(null); });
    const onKey = e => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", onKey);

    document.body.appendChild(overlay);
  });
}

/* ===================== 日期工具 ===================== */
// 一律用本地时间构造/格式化。绝不用 toISOString().slice(0,10)：
// UTC+8 下早上 8 点前的操作会被算到前一天，会同时污染连击、每日统计和周报。
const pad2 = n => String(n).padStart(2, "0");

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "YYYY-MM-DD" -> 本地零点的 Date
function parseDate(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function dateAdd(s, days) {
  const d = parseDate(s);
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

// b - a，单位天。用本地零点相减并按天取整，跨夏令时也不会差一天
function dateDiff(a, b) {
  const A = parseDate(a), B = parseDate(b);
  A.setHours(0, 0, 0, 0);
  B.setHours(0, 0, 0, 0);
  return Math.round((B - A) / 86400000);
}

// 0 = 周一 … 6 = 周日（JS 原生是 0 = 周日，这里转过来）
function weekdayIdx(s) {
  return (parseDate(s).getDay() + 6) % 7;
}

// 所在周的周一
function weekStart(s) {
  return dateAdd(s, -weekdayIdx(s));
}

function fmtDate(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 计划起始日与总周数改由 plan.js 依据用户画像推导（见 Plan），
// 不再写死。这两个函数保留名字与签名 —— 多个模块在调用它们 ——
// 只把函数体改为委派给 Plan。函数体是延迟求值的，所以加载顺序安全。
function currentWeek() {
  return Math.max(1, Math.min(Plan.totalWeeks(), Plan.weekOf(todayStr()) || 1));
}

// "before" 未开始 / "active" 进行中 / "after" 已结束
function planStatus() { return Plan.status(); }

/* ===================== 存储层 ===================== */
const STORAGE_KEYS = {
  version: "ewb_state_version",
  profile: "ewb_profile",          // 用户填的目标画像（分数/考试日期/每日时长/弱项/兴趣）
  taskChecks: "ewb_task_checks",   // { "YYYY-MM-DD": { "0-1": true } }
  activity: "ewb_activity",        // { "YYYY-MM-DD": { tasks, quiz, words } }
  quizLog: "ewb_quiz_log",         // 最近答题明细（上限 500）
  quizTotals: "ewb_quiz_totals",   // 累计计数（不设上限，报告数字来源）
  quizConfig: "ewb_quiz_config",   // 上次选的题型与题量
  srs: "ewb_srs",                  // { 词id: { box, due, lapses, last } }
  mistakes: "ewb_mistakes",        // 错题本
  practice: "ewb_practice",        // 写作/翻译/对话 作答记录
  masteredWords: "ewb_mastered_words",
  reviews: "ewb_reviews",
  customWords: "ewb_custom_words",
  deletedIds: "ewb_deleted_ids",
  doneMilestones: "ewb_done_milestones",
  speechRate: "ewb_speech_rate",
  speechVoice: "ewb_speech_voice",   // 用户手动指定的语音名（留空 = 自动挑）
  // —— 旧版遗留键（仅迁移用，不参与导出）——
  legacyCheckedTasks: "ewb_checked_tasks",
  legacyStreakDate: "ewb_streak_date",
  legacyStreakCount: "ewb_streak_count",
};

// 参与导出的键（顺序即导出文件里的顺序；不含 legacy）
const EXPORT_KEYS = [
  STORAGE_KEYS.version,
  STORAGE_KEYS.profile,
  STORAGE_KEYS.taskChecks,
  STORAGE_KEYS.activity,
  STORAGE_KEYS.quizLog,
  STORAGE_KEYS.quizTotals,
  STORAGE_KEYS.quizConfig,
  STORAGE_KEYS.srs,
  STORAGE_KEYS.mistakes,
  STORAGE_KEYS.practice,
  STORAGE_KEYS.masteredWords,
  STORAGE_KEYS.reviews,
  STORAGE_KEYS.customWords,
  STORAGE_KEYS.deletedIds,
  STORAGE_KEYS.doneMilestones,
  STORAGE_KEYS.speechRate,
  STORAGE_KEYS.speechVoice,
];

// 版本号：用来判断浏览器是不是还在跑缓存的旧脚本。
// Chrome 对 file:// 的脚本缓存很顽固，普通 F5 可能不会重新加载。
const APP_VERSION = "1.2";
const ASSET_HINT = "若这里显示的不是 " + APP_VERSION + "，说明浏览器用的是缓存里的旧代码 —— 按 Ctrl+Shift+R 强制刷新。";

// 把存储键分成「学习记录」和「设置」两类。
// 分开是「只清学习记录、保留设置」能实现的前提 ——
// 否则要么全清、要么清不掉。EXPORT_KEYS 里的每一个键都必须落进这两类之一，
// verify.js 会强制检查，漏掉一个就会报错。
const DATA_KEYS = [
  STORAGE_KEYS.taskChecks,
  STORAGE_KEYS.activity,
  STORAGE_KEYS.quizLog,
  STORAGE_KEYS.quizTotals,
  STORAGE_KEYS.srs,
  STORAGE_KEYS.mistakes,
  STORAGE_KEYS.practice,
  STORAGE_KEYS.masteredWords,
  STORAGE_KEYS.reviews,
  STORAGE_KEYS.customWords,
  STORAGE_KEYS.deletedIds,
  STORAGE_KEYS.doneMilestones,
];

const SETTING_KEYS = [
  STORAGE_KEYS.version,
  STORAGE_KEYS.profile,
  STORAGE_KEYS.quizConfig,
  STORAGE_KEYS.speechRate,
  STORAGE_KEYS.speechVoice,
];

const LEGACY_KEYS = [
  STORAGE_KEYS.legacyCheckedTasks,
  STORAGE_KEYS.legacyStreakDate,
  STORAGE_KEYS.legacyStreakCount,
];

// scope: "data" 只清学习记录（保留设置） | "all" 恢复出厂设置（全清，含设置）
// 返回被删掉的键数。调用方负责重新载入页面 —— 内存里的 state 会失效。
function resetStorage(scope) {
  const keys = scope === "all" ? EXPORT_KEYS.concat(LEGACY_KEYS) : DATA_KEYS;
  let removed = 0;
  keys.forEach(k => {
    try {
      localStorage.removeItem(k);
      removed++;
    } catch (e) {
      console.warn("[resetStorage] 删除失败：", k, e);
    }
  });
  return removed;
}

// 清空前告诉用户会丢掉什么。只列出真正有内容的项，不堆一堆 0。
// 直接读 state，不调用模块文件里的函数 —— core.js 不该依赖模块层。
function recordSummary() {
  const taskDays = Object.keys(state.taskChecks)
    .filter(d => Object.values(state.taskChecks[d] || {}).some(Boolean)).length;
  const reviews = Object.keys(state.reviews).filter(w => state.reviews[w] && state.reviews[w].done).length;
  const pr = state.practice || {};
  const practice =
    (pr.writing || []).length +
    (pr.translation || []).length +
    Object.values(pr.conversation || {}).reduce((n, s) => n + ((s.done || []).length), 0);
  return [
    { n: taskDays, label: "打卡天数" },
    { n: state.quizTotals.n || 0, label: "答题记录" },
    { n: Object.keys(state.srs).length, label: "词的复习计划" },
    { n: Object.keys(state.mistakes).length, label: "错题" },
    { n: reviews, label: "周复盘" },
    { n: state.customWords.length, label: "你导入／添加的单词" },
    { n: practice, label: "练习作答" },
    { n: state.doneMilestones.length, label: "里程碑进度" },
  ].filter(x => x.n > 0);
}

function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

let _storageWarned = false;

// 原实现没有 try/catch：配额满时 QuotaExceededError 会从点击处理里抛出去，
// 用户看到的是“点了没反应”，数据静默丢失。这里兜住并告知。
function saveJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch (err) {
    console.error("[saveJSON] 写入失败：", key, err);
    if (!_storageWarned) {
      _storageWarned = true;
      // 提示失败绝不能把原始错误再抛出去 —— 那会让“保存失败”变成“整页崩”
      try {
        toast("存储空间不足，本次修改未能保存。请到「学习统计 → 数据备份」导出后清理旧数据。", "error", 8000);
      } catch (e) {
        console.error("[saveJSON] 连提示都失败了：", e);
      }
    }
    return false;
  }
}

/* ===================== 全局状态 ===================== */
const state = {
  module: "goal",
  taskDayIdx: weekdayIdx(todayStr()), // 0 = 周一 … 6 = 周日
  taskWeekOffset: 0,                  // 0 = 本周，-1 = 上周（用于回看与补打卡）
  vocabListId: "all",
  vocabSearch: "",
  materialFilter: "all",
  profile: loadJSON(STORAGE_KEYS.profile, {}),
  // 不能在这里调 currentWeek()：它要读 plan.js 的 Plan，
  // 而 plan.js 在本文件之后才加载，加载时求值会抛 ReferenceError。
  // 改为懒初始化，在 renderReview 里钳制到 [1, N]。
  currentReviewWeek: null,
  taskChecks: loadJSON(STORAGE_KEYS.taskChecks, {}),
  activity: loadJSON(STORAGE_KEYS.activity, {}),
  srs: loadJSON(STORAGE_KEYS.srs, {}),
  mistakes: loadJSON(STORAGE_KEYS.mistakes, {}),
  practice: loadJSON(STORAGE_KEYS.practice, {}),
  quizTotals: loadJSON(STORAGE_KEYS.quizTotals, { n: 0, right: 0, byType: {} }),
  quizLog: loadJSON(STORAGE_KEYS.quizLog, []),
  quizConfig: loadJSON(STORAGE_KEYS.quizConfig, { types: ["en2cn", "cn2en", "spell"], size: 20 }),
  masteredWords: loadJSON(STORAGE_KEYS.masteredWords, []),
  reviews: loadJSON(STORAGE_KEYS.reviews, {}),
  customWords: loadJSON(STORAGE_KEYS.customWords, []),
  deletedIds: loadJSON(STORAGE_KEYS.deletedIds, []),
  doneMilestones: loadJSON(STORAGE_KEYS.doneMilestones, []),
  speechRate: loadJSON(STORAGE_KEYS.speechRate, 0.9),
  speechVoice: loadJSON(STORAGE_KEYS.speechVoice, ""),
};

// 各模块的专属保存函数（集中在此，避免散落）
function saveCustomWords() { saveJSON(STORAGE_KEYS.customWords, state.customWords); }
function saveDeletedIds() { saveJSON(STORAGE_KEYS.deletedIds, state.deletedIds); }
function saveDoneMilestones() { saveJSON(STORAGE_KEYS.doneMilestones, state.doneMilestones); }
function saveTaskChecks() { saveJSON(STORAGE_KEYS.taskChecks, state.taskChecks); }
function saveActivity() { saveJSON(STORAGE_KEYS.activity, state.activity); }
function saveSrs() { saveJSON(STORAGE_KEYS.srs, state.srs); }
function saveMistakes() { saveJSON(STORAGE_KEYS.mistakes, state.mistakes); }
function savePractice() { saveJSON(STORAGE_KEYS.practice, state.practice); }

/* ===================== 词库 ===================== */
// mock.js 的 vocabulary + words-extra.js 的 vocabularyExtra + 用户自定义
function builtinWords() {
  const base = typeof vocabulary !== "undefined" ? vocabulary : [];
  const extra = typeof vocabularyExtra !== "undefined" ? vocabularyExtra : [];
  return base.concat(extra);
}

function getVocabList() {
  return builtinWords()
    .filter(w => !state.deletedIds.includes(w.id))
    .concat(state.customWords);
}

// 唯一的 id 分配入口。两个原有调用点都只扫了 vocabulary + customWords，
// 新增 vocabularyExtra 后若继续用会直接撞 id，所以必须走这里。
function nextWordId() {
  let max = 0;
  for (const w of builtinWords()) if (w.id > max) max = w.id;
  for (const w of state.customWords) if (w.id > max) max = w.id;
  return max + 1;
}

// 词库里的重复检测（同一单词归一化后相同即视为重复）
function findWordByText(text, exceptId) {
  const key = norm(text);
  if (!key) return null;
  return getVocabList().find(w => w.id !== exceptId && norm(w.word) === key) || null;
}

/* ===================== 每日活动 / 连击 ===================== */
function ensureActivityDay(dateStr) {
  if (!state.activity[dateStr]) state.activity[dateStr] = { tasks: 0, quiz: 0, words: 0, practice: 0, taskMin: 0 };
  return state.activity[dateStr];
}

// n 可为负数（取消打卡时回退）
function bumpActivity(field, n = 1, dateStr = todayStr()) {
  const day = ensureActivityDay(dateStr);
  day[field] = Math.max(0, (day[field] || 0) + n);
  saveActivity();
}

// 打卡状态按“日期 + 稳定槽位键”定位。
// 旧实现用位置索引 "0-1"，任务数量或顺序一变，历史勾就会挂到别的任务上 ——
// 而任务现在会随「每天学习时间」变化，这个隐患会变成常态。
// 新键是语义化的："mon-听力-main"、"sat-模考-main"、"mon-ext-听力"。
function legacyTaskKey(dayIdx, taskIdx) { return `${dayIdx}-${taskIdx}`; }

function slotKeyOf(slot, dayIdx, taskIdx) {
  if (slot && slot.key) return slot.key;
  return legacyTaskKey(dayIdx, taskIdx);
}

// 先查稳定键，再回退旧位置键 —— 零数据丢失
function isTaskChecked(dateStr, dayIdx, slot, taskIdx) {
  const d = state.taskChecks[dateStr];
  if (!d) return false;
  if (slot && slot.key && d[slot.key]) return true;
  if (taskIdx != null && d[legacyTaskKey(dayIdx, taskIdx)]) return true;
  return false;
}

function setTaskChecked(dateStr, dayIdx, slot, taskIdx, on) {
  if (!state.taskChecks[dateStr]) state.taskChecks[dateStr] = {};
  const d = state.taskChecks[dateStr];
  const key = slotKeyOf(slot, dayIdx, taskIdx);
  const legacy = legacyTaskKey(dayIdx, taskIdx);
  if (on) {
    d[key] = true;
    if (key !== legacy) delete d[legacy];   // 两套键并存会重复计数
  } else {
    delete d[key];
    delete d[legacy];
  }
  saveTaskChecks();
  recountTasks(dateStr, dayIdx);
}

// 按当天计划里的槽位逐个测，而不是数 Object.keys
// （两套键共存时 Object.keys 会重复计数）
function recountTasks(dateStr, dayIdx) {
  const d = state.taskChecks[dateStr] || {};
  const keys = Object.keys(d).filter(k => d[k]);
  const day = ensureActivityDay(dateStr);
  day.tasks = keys.length;
  // taskMin：按真实时长累加，供统计按时间加权。
  // 历史数据没有时长记录，回退为「每任务 10 分钟」并在周报里注明是估算。
  let mins = 0, exact = false;
  if (dayIdx != null && typeof Plan !== "undefined" && Plan.get().ok) {
    const slots = (Plan.get().weekTasks[dayIdx] || {}).slots || [];
    if (slots.length) {
      exact = true;
      slots.forEach((s, i) => { if (isTaskChecked(dateStr, dayIdx, s, i)) mins += s.minutes || 0; });
      // 旧键命中的槽位可能已不在计划里，剩余部分按 10 分钟补
      const covered = slots.filter((s, i) => isTaskChecked(dateStr, dayIdx, s, i)).length;
      if (keys.length > covered) mins += (keys.length - covered) * 10;
    }
  }
  day.taskMin = exact ? mins : keys.length * 10;
  saveActivity();
}

function dayActive(dateStr) {
  const a = state.activity[dateStr];
  return !!a && ((a.tasks || 0) > 0 || (a.quiz || 0) > 0 || (a.words || 0) > 0 || (a.practice || 0) > 0);
}

// 连续天数：从今天往回数（今天还没学习则从昨天起算，不让连击提前断掉）
function currentStreak() {
  let cur = todayStr();
  let n = 0;
  if (!dayActive(cur)) cur = dateAdd(cur, -1);
  while (dayActive(cur)) {
    n++;
    cur = dateAdd(cur, -1);
    if (n > 3650) break; // 防御性上限
  }
  return n;
}

function totalStudyDays() {
  return Object.keys(state.activity).filter(dayActive).length;
}

// 补打卡：只允许今天和最近 7 天，不允许未来
function canBackfill(dateStr) {
  const d = dateDiff(dateStr, todayStr());
  return d >= 0 && d <= 7;
}

/* ===================== 模块注册表 ===================== */
// 原来 switchModule 是硬编码 if/else + 静态 moduleTitles，
// 每加一个模块都要改 app.js。改成注册制后新模块可自注册。
const Modules = {
  _registry: {},
  register(key, def) {
    if (!key || !def || typeof def.render !== "function") {
      console.warn("[Modules] 注册失败（缺少 key 或 render）：", key);
      return;
    }
    this._registry[key] = {
      title: def.title || key,
      render: def.render,
      init: typeof def.init === "function" ? def.init : null,
      order: typeof def.order === "number" ? def.order : 100,
    };
  },
  has(key) { return Object.prototype.hasOwnProperty.call(this._registry, key); },
  title(key) { return this.has(key) ? this._registry[key].title : ""; },
  keys() { return Object.keys(this._registry); },
  render(key) {
    if (!this.has(key)) return false;
    this._registry[key].render();
    return true;
  },
  // app.js 的 init() 调用一次，让各模块绑定自己的弹窗（弹窗归模块自己管）
  initAll() {
    this.keys().forEach(k => {
      const m = this._registry[k];
      if (m.init) {
        try { m.init(); } catch (e) { console.error(`[Modules] ${k} 初始化失败：`, e); }
      }
    });
  },
};

/* ===================== 迁移 ===================== */
const CURRENT_VERSION = 2;

function migrate() {
  const raw = localStorage.getItem(STORAGE_KEYS.version);
  const v = raw === null ? 0 : (parseInt(raw, 10) || 0);
  if (v >= CURRENT_VERSION) return;

  // v1 -> v2（一）：里程碑进度从「周号」改为「源里程碑 id」。
  // 周号会随考试日期漂移 —— 12 周计划里 W7 是「阅读主旨题」，
  // 换成 20 周计划后 W7 变成「强化巩固」，旧勾会静默挂到完全不同的内容上。
  try {
    const dm = loadJSON(STORAGE_KEYS.doneMilestones, null);
    if (Array.isArray(dm) && dm.length && dm.some(x => typeof x === "number")) {
      const converted = dm.map(x => (typeof x === "number" ? "m" + x : x));
      saveJSON(STORAGE_KEYS.doneMilestones, converted);
      state.doneMilestones = converted;
    }
  } catch (e) {
    console.warn("[migrate] 里程碑进度迁移失败，已跳过：", e);
  }

  // v1 -> v2（二）：画像缺失时落一份默认画像，让计划一开始就有据可依。
  // 默认考试日 2026-12-12 是周六，从 9/21 起算正好 12 周。
  try {
    if (typeof Plan !== "undefined" && !localStorage.getItem(STORAGE_KEYS.profile)) {
      const d = defaultProfile();
      saveJSON(STORAGE_KEYS.profile, d);
      state.profile = d;
    }
  } catch (e) {
    console.warn("[migrate] 默认画像写入失败，已跳过：", e);
  }

  // v0 -> v1：旧的按星期几索引的打卡记录，整体挪到“今天”名下。
  // 旧数据无法还原出真实日期，放今天是最不坏的近似。
  try {
    const old = JSON.parse(localStorage.getItem(STORAGE_KEYS.legacyCheckedTasks) || "null");
    if (old && typeof old === "object") {
      const t = todayStr();
      if (!state.taskChecks[t]) state.taskChecks[t] = {};
      Object.keys(old).forEach(k => { if (old[k]) state.taskChecks[t][k] = true; });
      saveTaskChecks();
      recountTasks(t);
    }
  } catch (e) {
    console.warn("[migrate] 旧打卡数据迁移失败，已跳过：", e);
  }

  ["legacyCheckedTasks", "legacyStreakDate", "legacyStreakCount"].forEach(k => {
    try { localStorage.removeItem(STORAGE_KEYS[k]); } catch {}
  });

  localStorage.setItem(STORAGE_KEYS.version, String(CURRENT_VERSION));
}

/* ===================== 语音合成（完全离线，不走网络） ===================== */
// 用浏览器内置的语音合成朗读。系统里只要有英文语音就能用；
// 若是「在线语音」（Chrome 的部分语音需要联网），断网时会静默失败 ——
// 这正是为什么这里要记录 _last 并由自检面板把真实状态显示出来。
const Speak = {
  _voices: [],
  _loaded: false,
  _keepAlive: null,
  _warned: false,
  _last: null,   // 最近一次朗读的真实结果，供自检面板显示

  apiOK() {
    return typeof window !== "undefined" &&
      !!window.speechSynthesis &&
      typeof window.SpeechSynthesisUtterance === "function";
  },

  voicesReady() { return this._loaded && this._voices.length > 0; },

  // Chrome 首次 getVoices() 返回空数组，需等 voiceschanged。
  // 超时也要 resolve，否则整个模块会卡住。
  loadVoices(timeout = 1500) {
    if (!this.apiOK()) return Promise.resolve([]);
    if (this.voicesReady()) return Promise.resolve(this._voices);
    return new Promise(resolve => {
      const synth = window.speechSynthesis;
      const first = synth.getVoices();
      if (first && first.length) {
        this._voices = first;
        this._loaded = true;
        return resolve(first);
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { synth.onvoiceschanged = null; } catch {}
        this._voices = synth.getVoices() || [];
        this._loaded = true;
        resolve(this._voices);
      };
      try { synth.onvoiceschanged = finish; } catch {}
      setTimeout(finish, timeout);
    });
  },

  // 当前是否联网。在线语音（如 Chrome 的 Google US English）必须联网才能出声，
  // 而这个工作台是离线使用的，所以默认要把它们排除掉。
  online() {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
        return navigator.onLine;
      }
    } catch {}
    return true; // 判断不了就当在线，由 voiceUsable 决定
  },

  isLocal(v) { return v && v.localService !== false; },

  // 这个语音现在能不能真的用：明确标了在线的，只有联网时才可用
  voiceUsable(v) {
    if (!v) return false;
    if (v.localService === false) return this.online();
    return true;
  },

  // 挑一个英文语音。
  // 关键：本地语音优先；只有在联网时才允许退回到在线语音 ——
  // 否则离线环境下会选中 Google 的网络语音，然后一声不出。
  englishVoice() {
    const vs = this._voices || [];
    const en = v => /^en/i.test(v.lang || "");

    // 用户手动指定过就用它（仍要检查是否可用）
    const chosen = this.voiceName();
    if (chosen) {
      const v = vs.find(x => x.name === chosen);
      if (v && this.voiceUsable(v)) return v;
    }

    // 本地优先，无条件。在线语音只在「完全没有本地英文语音 且 当前联网」时才用。
    const enVs = vs.filter(en);
    const pick = arr => arr.find(v => /^en[-_]US/i.test(v.lang)) ||
                        arr.find(v => /^en[-_]GB/i.test(v.lang)) ||
                        arr[0] || null;

    const localPick = pick(enVs.filter(v => this.isLocal(v)));
    if (localPick) return localPick;

    if (this.online()) return pick(enVs.filter(v => !this.isLocal(v)));
    return null;
  },

  // 当前生效的语音名（avoids repeatedly calling englishVoice）
  voiceName() {
    const n = state.speechVoice;
    return n && typeof n === "string" ? n : "";
  },

  setVoice(name) {
    state.speechVoice = name || "";
    saveJSON(STORAGE_KEYS.speechVoice, state.speechVoice);
  },

  // 供选择器使用：把浏览器报告的语音整理成可显示的列表
  voiceOptions() {
    const vs = this._voices || [];
    const en = v => /^en/i.test(v.lang || "");
    return vs.filter(en).map(v => ({
      name: v.name,
      lang: v.lang,
      local: this.isLocal(v),
      usable: this.voiceUsable(v),
    }));
  },

  rate() {
    const r = parseFloat(state.speechRate);
    return isFinite(r) && r >= 0.5 && r <= 1.5 ? r : 0.9;
  },

  setRate(r) {
    state.speechRate = Math.max(0.5, Math.min(1.5, Number(r) || 0.9));
    saveJSON(STORAGE_KEYS.speechRate, state.speechRate);
  },

  speak(text, opts = {}) {
    if (!text) return false;
    if (!this.apiOK()) {
      this._fail("浏览器不支持语音合成（speechSynthesis 不存在）");
      return false;
    }
    // 首次点击时语音列表可能还没就绪，先确保加载完再念
    if (this.voicesReady()) this._doSpeak(String(text), opts);
    else this.loadVoices(2000).then(() => this._doSpeak(String(text), opts));
    return true;
  },

  _doSpeak(text, opts) {
    if (!this.apiOK()) return;
    const synth = window.speechSynthesis;
    const v = this.englishVoice();

    // 明确知道有语音、但没有一个能用的英文语音时，不要硬念 ——
    // 那会让浏览器拿中文语音去读英文，或者干脆一声不出（用户看到的就是「点了没反应」）。
    // 例外：浏览器一个语音都没报（可能只是列表没加载出来），那就照常试一次，
    // 用 onstart/onerror 的结果说话。
    if (!v && (this._voices || []).length > 0) {
      this._fail(this.explainNoVoice());
      return;
    }

    const u = new window.SpeechSynthesisUtterance(text);
    if (v) u.voice = v;
    u.lang = v ? v.lang : "en-US";
    u.rate = opts.rate != null ? opts.rate : this.rate();
    u.pitch = 1;
    u.volume = 1;

    this._last = {
      at: new Date().toISOString(),
      text: text.slice(0, 40),
      voiceCount: (this._voices || []).length,
      voiceName: v ? v.name : null,
      voiceLang: v ? v.lang : null,
      online: v ? v.localService === false : null,
      started: false, ended: false, error: null,
    };

    u.onstart = () => { this._last.started = true; };
    u.onend = () => { this._last.ended = true; this._stopKeepAlive(); };
    u.onerror = ev => {
      this._last.error = (ev && (ev.error || ev.type)) || "unknown";
      this._stopKeepAlive();
    };

    const go = () => { try { synth.speak(u); } catch (e) { this._fail("调用语音接口出错：" + e.message); } };

    // Chrome：在同一个任务里先 cancel() 再 speak()，新语音会被丢掉。
    // 所以要等一拍再念。
    if (synth.speaking || synth.pending) {
      try { synth.cancel(); } catch {}
      setTimeout(go, 90);
    } else {
      go();
    }
    this._startKeepAlive();

    if (!v) this._fail(this.explainNoVoice());
  },

  // 说清楚「为什么没有可用的英文语音」，而不是笼统地说找不到
  explainNoVoice() {
    const vs = this._voices || [];
    const enVs = vs.filter(v => /^en/i.test(v.lang || ""));
    if (!vs.length) return "浏览器没有报告任何语音。";
    if (!enVs.length) return `浏览器报告的 ${vs.length} 个语音里没有英文的。`;

    const online = enVs.filter(v => v.localService === false);
    const local = enVs.filter(v => v.localService !== false);
    if (!local.length && online.length && !this.online()) {
      return `浏览器只给了在线英文语音（${online.map(x => x.name).join("、")}），` +
             `而当前没有联网，所以发不出声音。需要在系统里装一个本地英文语音包。`;
    }
    return "现有的英文语音都不可用。";
  },

  // 连续朗读多句：不能每句都 cancel，否则只会念出最后一句。
  // Chrome 自身会把多个 utterance 排队依次念完。
  speakSequence(texts, opts = {}) {
    const list = (texts || []).filter(Boolean).map(String);
    if (!list.length) return false;
    if (!this.apiOK()) {
      this._fail("浏览器不支持语音合成（speechSynthesis 不存在）");
      return false;
    }

    const build = () => {
      const synth = window.speechSynthesis;
      try { synth.cancel(); } catch {}
      const v = this.englishVoice();
      this._last = {
        at: new Date().toISOString(),
        text: `（连播 ${list.length} 句）`,
        voiceCount: (this._voices || []).length,
        voiceName: v ? v.name : null,
        voiceLang: v ? v.lang : null,
        online: v ? v.localService === false : null,
        started: false, ended: false, error: null,
      };
      list.forEach((t, i) => {
        const u = new window.SpeechSynthesisUtterance(t);
        if (v) u.voice = v;
        u.lang = v ? v.lang : "en-US";
        u.rate = opts.rate != null ? opts.rate : this.rate();
        u.pitch = 1;
        if (i === 0) {
          u.onstart = () => { this._last.started = true; };
          u.onerror = ev => { this._last.error = (ev && (ev.error || ev.type)) || "unknown"; };
        }
        if (i === list.length - 1) {
          u.onend = () => { this._last.ended = true; this._stopKeepAlive(); };
        }
        try { synth.speak(u); } catch (e) { this._fail("连播出错：" + e.message); }
      });
    };

    if (this.voicesReady()) setTimeout(build, 90);
    else this.loadVoices(2000).then(() => setTimeout(build, 90));
    this._startKeepAlive();
    return true;
  },

  _fail(msg) {
    console.warn("[Speak]", msg);
    // 即使这次连朗读都没发起，也要留下记录，否则自检面板看不到失败原因
    if (!this._last) {
      this._last = {
        at: new Date().toISOString(),
        text: null,
        voiceCount: (this._voices || []).length,
        voiceName: null, voiceLang: null, online: null,
        started: false, ended: false, error: null,
      };
    }
    this._last.error = this._last.error || msg;
    // 只提示一次，避免每次点击都弹
    if (!this._warned) {
      this._warned = true;
      toast("朗读没出声：" + msg + "　可到「学习统计 → 语音自检」看详细原因。", "error", 7000);
    }
  },

  // Chrome 会在约 15 秒后掐断长句，需要周期性 pause/resume 续命
  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAlive = setInterval(() => {
      const synth = window.speechSynthesis;
      if (!synth.speaking) return this._stopKeepAlive();
      try { synth.pause(); synth.resume(); } catch {}
    }, 10000);
  },

  _stopKeepAlive() {
    if (this._keepAlive) {
      clearInterval(this._keepAlive);
      this._keepAlive = null;
    }
  },

  stop() {
    if (this.apiOK()) { try { window.speechSynthesis.cancel(); } catch {} }
    this._stopKeepAlive();
  },

  // 自检：把真实状态摊开给用户看
  async diagnose() {
    const api = this.apiOK();
    let voices = [];
    if (api) {
      voices = await this.loadVoices(2500);
      // 有些浏览器要等下才会填充列表，再补一次
      if (!voices.length && window.speechSynthesis.getVoices) {
        voices = window.speechSynthesis.getVoices() || [];
        if (voices.length) { this._voices = voices; this._loaded = true; }
      }
    }
    const en = this.englishVoice();
    const enAll = voices.filter(v => /^en/i.test(v.lang || ""));
    return {
      version: APP_VERSION,
      apiOK: api,
      online: this.online(),
      count: voices.length,
      list: voices.map(v => ({
        name: v.name,
        lang: v.lang,
        local: this.isLocal(v),
        usable: this.voiceUsable(v),
        chosen: v.name === this.voiceName(),
        def: !!v.default,
      })),
      englishCount: enAll.length,
      // 只有在线英文语音、且没联网 —— 这就是朗读不出声的典型原因
      onlyOnline: enAll.length > 0 && enAll.every(v => v.localService === false) && !this.online(),
      english: en ? { name: en.name, lang: en.lang, local: this.isLocal(en) } : null,
      chosen: this.voiceName() || null,
      reason: en ? null : this.explainNoVoice(),
      last: this._last,
    };
  },
};
