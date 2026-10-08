// verify.js — 自检脚本（Node 运行，浏览器不会加载它）
//
//   node verify.js
//
// 这个项目没有构建步骤、没有测试框架，改完代码后跑一遍这个就能确认
// 词库数据、间隔重复状态机、题目生成、存储迁移都还正常。
// 它只测试纯逻辑；界面部分仍需在浏览器里手点。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DIR = __dirname;
let fails = 0;
let checks = 0;

function ok(cond, msg) {
  checks++;
  if (!cond) {
    fails++;
    console.log("  \x1b[31m✗\x1b[0m " + msg);
  }
}

function section(name) {
  console.log("\n\x1b[1m" + name + "\x1b[0m");
}

// 建一个沙箱，重新加载所有逻辑脚本。
// 传入 initialStore 可以预置 localStorage 内容 —— 因为 state 是在脚本加载时
// 从存储里读出来的，光用 saveJSON 写存储不会影响已经初始化的 state。
function sandbox(initialStore) {
  const store = initialStore ? Object.assign({}, initialStore) : {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const ctx = { console, localStorage, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON };
  vm.createContext(ctx);
  const load = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), "utf8"), ctx, { filename: f });
  ["mock.js", "words-extra.js", "practice-data.js", "core.js", "plan.js", "quiz.js"].forEach(f => {
    if (fs.existsSync(path.join(DIR, f))) load(f);
  });
  ctx.__store = store;
  ctx.__load = load;
  ctx.__ev = expr => vm.runInContext(expr, ctx);
  return ctx;
}

/* ===================== 1. 语法检查 ===================== */
section("1. 语法检查（全部 .js）");
const jsFiles = fs.readdirSync(DIR).filter(f => f.endsWith(".js") && f !== "verify.js");
for (const f of jsFiles) {
  try {
    new vm.Script(fs.readFileSync(path.join(DIR, f), "utf8"), { filename: f });
    console.log("  ✓ " + f);
  } catch (e) {
    fails++;
    console.log("  \x1b[31m✗ " + f + " — " + e.message + "\x1b[0m");
  }
}

/* ===================== 2. 词库数据 ===================== */
section("2. 词库数据");
const ctx = sandbox();
const ev = ctx.__ev;

const V = ev("vocabulary"), E = ev("vocabularyExtra");
const all = V.concat(E);
console.log("  mock.js " + V.length + " 条 + words-extra.js " + E.length + " 条 = " + all.length + " 条");

const ids = {};
const dupIds = [];
all.forEach(w => { if (ids[w.id]) dupIds.push(w.id); ids[w.id] = 1; });
ok(dupIds.length === 0, "id 重复：" + dupIds.join(", "));

const missing = all.filter(w => !w.word || !w.meaning || !w.phonetic);
ok(missing.length === 0, "缺 word/meaning/phonetic：" + missing.map(w => w.id).join(", "));

const noExample = all.filter(w => !w.example);
ok(noExample.length === 0, "缺例句：" + noExample.map(w => w.word).join(", "));

const badPhonetic = all.filter(w => !/^\/.+\/$/.test(String(w.phonetic).trim()));
ok(badPhonetic.length === 0, "音标格式可疑：" + badPhonetic.map(w => w.word + " " + w.phonetic).join(", "));

const noCJK = all.filter(w => !/[一-龥]/.test(w.meaning));
ok(noCJK.length === 0, "释义里没有中文：" + noCJK.map(w => w.word).join(", "));

// 完全相同的释义会让选择题出现两个正确答案
const seenM = {};
const dupM = [];
all.forEach(w => {
  const k = ev("norm")(w.meaning);
  if (seenM[k]) dupM.push(w.meaning + " (id " + seenM[k] + " / id " + w.id + ")");
  else seenM[k] = w.id;
});
ok(dupM.length === 0, "完全相同的释义：" + dupM.join(" ｜ "));

// 同名单词只允许出现在「易混词」对比里（如 adapt 同时在高频词表和易混词表）。
// 只要其中一方是易混词就是有意的对比项；出题时 pickDistractors 会按归一化
// 结果排除掉与正确答案相同的候选，所以不会出现两个正确答案。
const seenW = {};
const dupW = [];
all.forEach(w => {
  const k = ev("norm")(w.word);
  if (seenW[k]) {
    const a = all.find(x => x.id === seenW[k]);
    if (a.category !== "confused" && w.category !== "confused") {
      dupW.push(w.word + " (id " + seenW[k] + " / id " + w.id + ")");
    }
  } else seenW[k] = w.id;
});
ok(dupW.length === 0, "非易混词的同名重复：" + dupW.join(", "));

ok(ev("getVocabList().length") === V.length + E.length + ev("state.customWords.length"),
  "getVocabList 数量不对");
ok(ev("nextWordId()") > Math.max(...all.map(w => w.id)), "nextWordId 没有大于现有最大 id");

/* ===================== 3. 日期工具 ===================== */
section("3. 日期工具");
ok(ev('dateAdd("2026-09-27",4)') === "2026-10-01", "dateAdd 跨月");
ok(ev('dateAdd("2026-09-30",1)') === "2026-10-01", "dateAdd 跨月（月末）");
ok(ev('dateAdd("2026-12-31",1)') === "2027-01-01", "dateAdd 跨年");
ok(ev('dateAdd("2026-03-01",-1)') === "2026-02-28", "dateAdd 负数（平年）");
ok(ev('dateDiff("2026-09-24","2026-09-27")') === 3, "dateDiff");
ok(ev('dateDiff("2026-09-27","2026-09-24")') === -3, "dateDiff 反向");
ok(ev('dateDiff("2026-12-31","2027-01-01")') === 1, "dateDiff 跨年");
ok(ev('weekdayIdx("2026-09-28")') === 0, "weekdayIdx：2026-09-28 是周一");
ok(ev('weekStart("2026-10-01")') === "2026-09-28", "weekStart 应回到周一");
ok(ev("currentWeek()") === 1, "2026-09-27 应在第 1 周");
ok(ev("planStatus()") === "active", "2026-09-27 计划应为进行中");
// 本地日期绝不能受 UTC 影响
const d = new Date(2026, 8, 27, 0, 30); // 本地 00:30
ok(ev("todayStr")(d) === "2026-09-27", "todayStr 在凌晨应返回当天（不能退到前一天）");

/* ===================== 4. 转义 ===================== */
section("4. 转义");
const esc = ev("esc");
ok(esc('a"b<c>&d') === "a&quot;b&lt;c&gt;&amp;d", "esc 基本字符");
ok(esc("<script>alert(1)</script>") === "&lt;script&gt;alert(1)&lt;/script&gt;", "esc 挡 script 标签");
ok(esc("it's") === "it&#39;s", "esc 单引号");
ok(esc(null) === "" && esc(undefined) === "", "esc 处理 null/undefined");

/* ===================== 5. SRS 状态机 ===================== */
section("5. 间隔重复状态机");
const SRS = ev("SRS");
const r1 = SRS.review(1, true);
const r2 = SRS.review(1, true);
const r3 = SRS.review(1, false);
console.log("  答对→box" + r1.box + "  答对→box" + r2.box + "  答错→box" + r3.box + "  lapses=" + r3.lapses);
ok(r1.box === 1 && r2.box === 2 && r3.box === 0, "box 转移应为 1→2→0");
ok(r3.lapses === 1, "lapses 应为 1");
ok(r3.due === ev("dateAdd(todayStr(),1)"), "答错后 due 应为明天");
ok(ev("SRS.review(999,false).lapses") === 0, "新词首错不该计入 lapses");
ok(SRS.isDue(1) === false, "刚答错的词今天不该到期");
ok(SRS.isDue(123456) === true, "无记录的词应到期");
ok(SRS.dueDate(123456) === ev("todayStr()"), "无记录的词 dueDate 应为今天");
// 连续答对应逐级拉长间隔
["1","2","4","7","15"].forEach((days, i) => {
  const s = sandbox();
  let rec;
  for (let k = 0; k <= i; k++) rec = s.__ev("SRS").review(7, true);
  ok(rec.box === Math.min(i + 1, 4), "连续答对 " + (i + 1) + " 次的 box 应为 " + Math.min(i + 1, 4));
});

/* ===================== 6. 题目生成（属性测试） ===================== */
section("6. 题目生成 · 500 题属性测试");
const Quiz = ev("Quiz");
const pool = ev("Quiz.pool()");
const norm = ev("norm");
const types = Quiz.availableTypes();
console.log("  可出题 " + pool.length + " 词，题型：" + types.join(", "));

let gen = 0, choices = 0, spells = 0;
for (let i = 0; i < 500; i++) {
  const type = types[i % types.length];
  const q = Quiz.generate(type, pool);
  if (!q) { fails++; checks++; console.log("  ✗ 生成不出题目，题型 " + type); continue; }
  gen++;
  ok(!!(q.word && q.prompt), "题干为空");
  ok(typeof q.wordId === "number", "wordId 不是数字");
  if (q.mode === "choice") {
    choices++;
    ok(q.options.length >= 2, "选项少于 2 个：" + q.word);
    const nCorrect = q.options.filter(o => o.correct).length;
    ok(nCorrect === 1, "正确答案有 " + nCorrect + " 个 — " + q.word + " [" + q.type + "]");
    const keys = q.options.map(o => norm(o.label));
    ok(new Set(keys).size === keys.length, "选项归一化后重复 — " + q.word + " [" + q.type + "]");
    // 正确选项的文字必须真的出现在选项里。注意 en2cn 的选项是释义、其余题型是单词，
    // 所以要按题型取对应字段，不能一律拿单词去比。
    const target = pool.find(w => w.id === q.wordId);
    const expected = q.type === "en2cn" ? target.meaning : target.word;
    ok(keys.includes(norm(expected)), "正确选项不在选项里 — " + q.word + " [" + q.type + "]");
  } else if (q.mode === "spell") {
    spells++;
    ok(!!(q.answer && q.hint), "拼写题缺 answer 或 hint");
    ok(Quiz.checkSpell(q.answer, q.answer), "checkSpell 自反失败");
    ok(!Quiz.checkSpell(q.answer + "zzz", q.answer), "checkSpell 未拒绝错误拼写");
    ok(Quiz.checkSpell("  " + q.answer.toUpperCase() + " ", q.answer), "checkSpell 应忽略大小写和空格");
  }
}
console.log("  生成 " + gen + " 题（选择 " + choices + " / 拼写 " + spells + "）");

// 词池极小的时候不能崩
section("7. 边界情况");
const tiny = [{ id: 9001, word: "solo", meaning: "adj. 单独的", phonetic: "/ˈsəʊləʊ/", example: "x", list: "x", category: "high" }];
let tinyFails = 0;
["en2cn", "cn2en", "listen", "spell"].forEach(t => {
  try { Quiz.generate(t, tiny); } catch (e) { tinyFails++; console.log("  ✗ 单词池下 " + t + " 抛异常：" + e.message); }
});
ok(tinyFails === 0, "单词池时生成题目抛异常");
ok(Quiz.generate("en2cn", tiny) === null, "单词池时应返回 null 而不是造出无效选择题");
ok(Quiz.generate("en2cn", []) === null, "空池应返回 null");

const emptySession = ev('createQuizSession({mode:"all",size:10})');
ok(emptySession.queue.length > 0, "空沙箱下会话不该为空");

/* ===================== 8. 写入收口 ===================== */
section("8. 答题写入收口");
const s2 = sandbox();
const e2 = s2.__ev;
const sess = e2('createQuizSession({mode:"all",size:10})');
ok(sess.queue.length > 0 && sess.queue.length <= 10, "会话题数异常：" + sess.queue.length);
const q0 = sess.queue[0];
vm.runInContext("recordAnswer(" + JSON.stringify(q0) + ', "我选的错误答案", false, 1200)', s2);
ok(e2("state.quizTotals.n") === 1 && e2("state.quizTotals.right") === 0, "累计计数不对");
ok(e2("Object.keys(state.mistakes).length") === 1, "答错后错题本应有 1 条");
ok(e2("state.quizLog.length") === 1, "明细应有 1 条");
ok(e2("state.activity[todayStr()].quiz") === 1, "每日活动未记录");
ok(e2("state.srs[" + q0.wordId + "].box") === 0, "答错后 SRS box 应为 0");
const wid = q0.wordId;
e2("Mistakes.markRight(" + wid + ")");
ok(e2("Mistakes.get(" + wid + ").resolved") === false, "错题答对 1 次不该立刻攻克");
e2("Mistakes.markRight(" + wid + ")");
ok(e2("Mistakes.get(" + wid + ").resolved") === true, "错题答对 2 次应攻克");
ok(e2("Mistakes.activeCount()") === 0 && e2("Mistakes.resolvedCount()") === 1, "错题本计数不对");
// 答错要把选错的答案记下来
const s3 = sandbox();
const q3 = s3.__ev('createQuizSession({mode:"all",size:1})').queue[0];
vm.runInContext("recordAnswer(" + JSON.stringify(q3) + ', "错误选择XYZ", false, 10)', s3);
ok(s3.__ev("Object.values(state.mistakes)[0].picks[0].picked") === "错误选择XYZ", "错题本没有记下当时选错的答案");
// 明细上限
const s4 = sandbox();
s4.__ev("");
for (let i = 0; i < 520; i++) {
  vm.runInContext("recordAnswer(" + JSON.stringify(q3) + ", 'x', true, 1)", s4);
}
ok(s4.__ev("state.quizLog.length") === 500, "明细应有 500 条上限，实际 " + s4.__ev("state.quizLog.length"));
ok(s4.__ev("state.quizTotals.n") === 520, "累计计数不该被上限截断");

/* ===================== 9. 迁移 ===================== */
section("9. 存储迁移");
const s5 = sandbox();
s5.__store["ewb_checked_tasks"] = JSON.stringify({ "0-1": true, "2-3": true, "1-0": false });
s5.__store["ewb_streak_date"] = "2026-09-20";
s5.__store["ewb_streak_count"] = "5";
s5.__ev("migrate()");
const today = s5.__ev("todayStr()");
const migrated = s5.__ev("state.taskChecks[" + JSON.stringify(today) + "] || {}");
ok(migrated["0-1"] === true && migrated["2-3"] === true, "旧打卡记录未迁移到按日期结构");
ok(!("1-0" in migrated), "值为 false 的旧记录不该被迁移");
ok(s5.__store["ewb_checked_tasks"] === undefined, "旧键应被删除");
ok(s5.__store["ewb_streak_date"] === undefined, "旧连击键应被删除");
ok(s5.__store["ewb_state_version"] === "2", "版本号应写为 2");
ok(s5.__ev("state.activity[" + JSON.stringify(today) + "].tasks") === 2, "迁移后当日任务数应为 2");
// 重复迁移应无害
s5.__ev("migrate()");
ok(s5.__ev("state.activity[" + JSON.stringify(today) + "].tasks") === 2, "重复迁移不该重复计数");

/* ===================== 10. 存储配额保护 ===================== */
section("10. 存储保护");
const s6 = sandbox();
const realSet = s6.localStorage.setItem;
s6.localStorage.setItem = () => { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; };
let threw = false;
try { s6.__ev('saveJSON("k", {a:1})'); } catch (e) { threw = true; }
ok(!threw, "saveJSON 在配额溢出时应返回 false 而不是抛异常");
ok(s6.__ev('saveJSON("k", {a:1})') === false, "配额溢出时 saveJSON 应返回 false");
s6.localStorage.setItem = realSet;

/* ===================== 11. 连击计算 ===================== */
section("11. 连击计算");
const s7 = sandbox();
s7.__ev('state.activity["2026-09-25"] = {tasks:2,quiz:0,words:0}');
s7.__ev('state.activity["2026-09-26"] = {tasks:0,quiz:5,words:0}');
s7.__ev('state.activity["2026-09-27"] = {tasks:1,quiz:0,words:0}');
ok(s7.__ev('currentStreak()') === 3, "连续三天有活动时应为 3，实际 " + s7.__ev("currentStreak()"));
ok(s7.__ev("totalStudyDays()") === 3, "累计学习天数应为 3");
// 今天还没学时，连击不该提前断
const s8 = sandbox();
s8.__ev('state.activity["2026-09-25"] = {tasks:1,quiz:0,words:0}');
s8.__ev('state.activity["2026-09-26"] = {tasks:1,quiz:0,words:0}');
ok(s8.__ev("currentStreak()") === 2, "今天还没学时连击应从昨天起算，实际 " + s8.__ev("currentStreak()"));
// 中间断了
const s9 = sandbox();
s9.__ev('state.activity["2026-09-24"] = {tasks:1,quiz:0,words:0}');
s9.__ev('state.activity["2026-09-27"] = {tasks:1,quiz:0,words:0}');
ok(s9.__ev("currentStreak()") === 1, "中间断开后连击应重新算，实际 " + s9.__ev("currentStreak()"));

/* ===================== 12. 导出键完整性 ===================== */
section("12. 导出键");
const s10 = sandbox();
const exportKeys = s10.__ev("EXPORT_KEYS");
const storageKeys = s10.__ev("STORAGE_KEYS");
const legacy = ["legacyCheckedTasks", "legacyStreakDate", "legacyStreakCount"];
ok(exportKeys.length >= 12, "导出键太少：" + exportKeys.length);
legacy.forEach(k => {
  ok(!exportKeys.includes(storageKeys[k]), "旧键 " + k + " 不该参与导出");
});
Object.keys(storageKeys).filter(k => !legacy.includes(k)).forEach(k => {
  ok(exportKeys.includes(storageKeys[k]), "键 " + k + " 没有参与导出，备份会丢数据");
});
ok(new Set(exportKeys).size === exportKeys.length, "导出键有重复");

/* ===================== 13. 界面一致性 ===================== */
// 这一节专门拦住「导航项没有对应模块」这类错误 ——
// 最初那三个坏按钮（对话/写作/翻译点了变 undefined）就是这个问题，
// 而且它在浏览器里不会报错，只会静默什么都不发生。
section("13. 界面一致性");
const htmlSrc = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
const uiFiles = ["core.js", "plan.js", "app.js", "module-vocab.js", "module-quiz.js",
                 "module-practice.js", "module-stats.js", "module-profile.js"]
  .filter(f => fs.existsSync(path.join(DIR, f)));
const jsSrc = uiFiles.map(f => fs.readFileSync(path.join(DIR, f), "utf8")).join("\n");
const both = htmlSrc + "\n" + jsSrc;

// 13a. 导航项 与 已注册模块 必须一一对应
const navMods = [...htmlSrc.matchAll(/data-module="([a-z]+)"/g)].map(m => m[1]);
const regMods = [...jsSrc.matchAll(/Modules\.register\("([a-z]+)"/g)].map(m => m[1]);
console.log("  导航项 " + navMods.length + " 个：" + navMods.join(", "));
console.log("  已注册 " + regMods.length + " 个：" + regMods.join(", "));
navMods.forEach(m => ok(regMods.includes(m), "导航项「" + m + "」没有对应模块，点了会变成 undefined"));
regMods.forEach(m => ok(navMods.includes(m), "模块「" + m + "」没有导航入口，用户点不到"));
ok(new Set(navMods).size === navMods.length, "导航项有重复的 data-module");

// 13b. JS 里引用的元素 id 必须存在（静态 HTML 或由模板动态生成）
const knownIds = new Set();
for (const m of htmlSrc.matchAll(/\bid="([^"]+)"/g)) knownIds.add(m[1]);
for (const m of jsSrc.matchAll(/\bid="([^"$]+)"/g)) knownIds.add(m[1]);
// toast() 用 createElement 建的元素不在模板里，单独放行
knownIds.add("toastHost");

const refIds = new Map();
for (const m of jsSrc.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)) refIds.set(m[1], true);
for (const m of jsSrc.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)) refIds.set(m[1], true);
const danglingIds = [...refIds.keys()].filter(k => !knownIds.has(k)).sort();
ok(danglingIds.length === 0, "引用了不存在的元素 id：" + danglingIds.join(", "));
console.log("  引用 " + refIds.size + " 个 id，定义 " + knownIds.size + " 个");

// 13c. JS 动态增删的 class 必须在 CSS 里有定义
const cssSrc = fs.readFileSync(path.join(DIR, "styles.css"), "utf8");
const dynCls = new Set();
for (const m of jsSrc.matchAll(/classList\.(?:add|remove|toggle)\(\s*"([a-zA-Z0-9_-]+)"/g)) dynCls.add(m[1]);
const noStyle = [...dynCls].filter(c => !cssSrc.includes("." + c)).sort();
ok(noStyle.length === 0, "动态操作但没有样式定义的 class：" + noStyle.join(", "));

// 13d. CSS 变量：用到的必须在 :root 里定义过
//     （原本 --bg-soft 被引用 4 次却从未定义，背景静默失效）
const definedVars = new Set();
const rootBlock = cssSrc.slice(cssSrc.indexOf(":root"), cssSrc.indexOf("}", cssSrc.indexOf(":root")));
for (const m of rootBlock.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) definedVars.add(m[1]);
const usedVars = new Set([...cssSrc.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map(m => m[1]));
const undefVars = [...usedVars].filter(v => !definedVars.has(v)).sort();
ok(undefVars.length === 0, "使用了但未定义的 CSS 变量：" + undefVars.join(", "));
console.log("  CSS 变量：定义 " + definedVars.size + " 个，使用 " + usedVars.size + " 个");

// 13e. 脚本加载顺序：core.js 必须在模块文件之前，app.js 必须在最后
const scripts = [...htmlSrc.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
console.log("  脚本顺序：" + scripts.join(" → "));
ok(scripts[0] && scripts[0].startsWith("mock"), "mock.js 应最先加载");
ok(scripts.indexOf("core.js") > scripts.indexOf("mock.js"), "core.js 应在数据文件之后");
scripts.filter(s => s.startsWith("module-")).forEach(s => {
  ok(scripts.indexOf(s) > scripts.indexOf("core.js"), s + " 应在 core.js 之后（否则 Modules 未定义）");
});
ok(scripts[scripts.length - 1] === "app.js", "app.js 必须最后加载（它调用 init()）");
ok(scripts.includes("quiz.js"), "缺少 quiz.js");

/* ===================== 14. 学习计划推导 ===================== */
// 这一节把「算出莫名其妙的结果」挡在门外。plan.js 全是纯函数，
// 界面还没动就能在这里验证全部算法 —— 这是这个项目唯一可行的验证路径。
section("14. 学习计划推导（plan.js）");
const ps = sandbox();
const pev = ps.__ev;

ok(typeof pev("Plan") === "object", "plan.js 没有导出 Plan");

// 默认画像必须复现手写的 12 周计划
pev("resetProfile()");
const dflt = pev("Plan.get()");
ok(dflt.ok, "默认画像应能生成计划");
ok(dflt.startDate === "2026-09-21", "默认起始日应对齐到周一，实际 " + dflt.startDate);
ok(dflt.weeks === 12, "默认画像应得出正好 12 周（复现手写计划），实际 " + dflt.weeks);
ok(pev('dateAdd("' + dflt.startDate + '",' + (dflt.weeks * 7 - 1) + ')') >= dflt.examDate,
  "计划结束日不能早于考试日（用 floor 算周数就会这样）");
ok(dflt.phases.base === 3 && dflt.phases.build === 5 && dflt.phases.paper === 2 && dflt.phases.sprint === 2,
  "默认阶段配额应为 3:5:2:2，实际 " + JSON.stringify(dflt.phases));
console.log("  默认：" + dflt.weeks + " 周 · 配额 " + JSON.stringify(dflt.phases)
  + " · 每周 " + dflt.weeklyWords + " 词 · 缺口 " + dflt.gap + " 分");

// 词量与手写数据的一致性 —— 原先「里程碑说 40、任务卡只教 28」就是因为两处各算各的
ok(dflt.weeklyWords === 40,
  "默认画像每周词量应为 40（与 smartGoal.M 声称的一致），实际 " + dflt.weeklyWords);
ok(pev('smartGoal.M').includes(String(dflt.weeklyWords)),
  "SMART 文案里的词量与派生词量必须一致（不能一个说 40 一个算 28）");

// 里程碑重排：N = 4…24 逐一代入
let msBad = 0;
for (let N = 4; N <= 24; N++) {
  pev('setProfile({planStart:"2026-09-21", examDate:dateAdd("2026-09-21",' + (N * 7 - 1) + ')})');
  const r = pev("Plan.get()");
  const ms = r.milestones;
  const bad = [];
  if (!r.ok) bad.push("未生成");
  else {
    if (ms.length !== N) bad.push("周数 " + ms.length + "≠" + N);
    let prev = -1, ordered = true;
    ms.forEach(m => m.sources.forEach(s => { if (s < prev) ordered = false; prev = s; }));
    if (!ordered) bad.push("源下标倒挂（内容会乱序）");
    const cnt = {};
    ms.forEach(m => m.sources.forEach(s => { cnt[s] = (cnt[s] || 0) + 1; }));
    const dup = Object.keys(cnt).filter(k => cnt[k] > 1);
    if (dup.length) bad.push("源重复出现 m" + dup.map(x => +x + 1).join(",m"));
    const miss = [];
    for (let i = 0; i < 12; i++) if (!cnt[i]) miss.push(i + 1);
    if (miss.length) bad.push("静默丢内容 m" + miss.join(",m"));
    if (ms[0].sources[0] !== 0) bad.push("首周不是 m1（丢了地基）");
    if (!ms[ms.length - 1].sources.includes(11)) bad.push("末周不是 m12（丢了冲刺）");
    if (N >= 5 && !ms.some(m => m.sources.includes(10))) bad.push("保不住模考周 m11");
  }
  if (bad.length) { msBad++; console.log("  \x1b[31m✗ N=" + N + " — " + bad.join(" / ") + "\x1b[0m"); }
}
ok(msBad === 0, msBad + " 个周数下里程碑重排不合法（见上）");
console.log("  N=4…24：源不重不漏、顺序不倒挂、首尾与模考都保住");

// 任务按时长缩放：合计必须等于 M，或给出可读的原因
let fitBad = 0;
[5, 8, 10, 15, 20, 25, 30, 45, 60, 90, 120].forEach(M => {
  pev("setProfile({dailyMinutes:" + M + "})");
  const r = pev("Plan.get()");
  if (!r.ok) return;
  r.weekTasks.forEach(d => {
    if (d.minutes !== M && !d.reason) {
      fitBad++;
      console.log("  \x1b[31m✗ M=" + M + " " + d.day + " 合计 " + d.minutes + " 却没说原因\x1b[0m");
    }
  });
});
ok(fitBad === 0, fitBad + " 天的分钟数对不上设置又没有说明原因");
console.log("  M=5…120 分钟：每天合计 == 设置值，或标注了排不下的原因");

// 弱项覆盖：每个弱项每周至少练一次
let covBad = 0;
[["听力"], ["阅读"], ["翻译"], ["写作", "口语", "翻译"], ["听力", "阅读", "写作", "翻译", "口语"]].forEach(ws => {
  pev("setProfile({weakSkills:" + JSON.stringify(ws) + ", dailyMinutes:30})");
  const r = pev("Plan.get()");
  if (!r.ok) return;
  const seen = new Set();
  r.weekTasks.forEach(d => d.slots.forEach(s => seen.add(s.type)));
  const missing = ws.filter(t => !seen.has(t));
  if (missing.length) { covBad++; console.log("  \x1b[31m✗ 弱项 " + ws.join("/") + " 整周没有 " + missing.join(",") + "\x1b[0m"); }
});
ok(covBad === 0, covBad + " 组弱项设置下有弱项整周没被安排（「针对弱项」会落空）");
console.log("  每个弱项每周至少出现一次（含基线里没有的「翻译」）");

// 打卡稳定键：改每日时长后，同一个槽位的勾必须还在
pev("setProfile({dailyMinutes:30})");
const keyAt30 = pev('Plan.get().weekTasks[0].slots.map(s => s.key)');
pev("setProfile({dailyMinutes:60})");
const keyAt60 = pev('Plan.get().weekTasks[0].slots.map(s => s.key)');
pev("setProfile({dailyMinutes:30})");
ok(keyAt30.length > 0, "槽位键不该为空");
ok(keyAt30.every(k => keyAt60.includes(k)),
  "把每天时长从 30 改到 60 后，原有槽位键必须保持。" + keyAt30.filter(k => !keyAt60.includes(k)).join(",") + " 消失了");

// 词库覆盖：词库只有 301 词，得算得出第几周开始要自己导入
ok(dflt.vocab.poolSize > 0, "应能取到词库总量");
ok(dflt.vocab.coverageWeeks > 0 && dflt.vocab.coverageWeeks <= dflt.weeks,
  "词库覆盖周数应在计划范围内，实际 " + dflt.vocab.coverageWeeks);
console.log("  词库 " + dflt.vocab.poolSize + " 词 → 够支撑 " + dflt.vocab.coverageWeeks
  + " 周（第 " + (dflt.vocab.coverageWeeks + 1) + " 周起需自己导入）");

// 素材：每个（格式 × 类型）格子 ≥2 条，否则只选某个兴趣时那一类会永远空
const cells = {};
pev("materialPool()").forEach(m => {
  const k = m.format + "×" + m.type;
  cells[k] = (cells[k] || 0) + 1;
});
const emptyCells = [];
pev("interestOptions()").forEach(f => {
  ["听力", "阅读"].forEach(t => { if ((cells[f + "×" + t] || 0) < 2) emptyCells.push(f + "×" + t + "=" + (cells[f + "×" + t] || 0)); });
});
ok(emptyCells.length === 0, "这些素材格子少于 2 条（只选该兴趣时会出现空槽）：" + emptyCells.join(", "));
ok(pev("materialPool().length") >= 24, "素材总数应 ≥24 条以覆盖 12 周，实际 " + pev("materialPool().length"));
console.log("  素材 " + pev("materialPool().length") + " 条，格子分布 " + JSON.stringify(cells));

// 素材排期：兴趣只排序不硬排除 —— 只选「游戏」时听力也不能空
pev('setProfile({interests:["游戏"], dailyMinutes:30})');
const gm = pev("Plan.get().materials");
const gmEmpty = gm.filter(w => w.items.some(it => !it.title));
ok(gmEmpty.length === 0, "只选「游戏」时素材排期出现了空条目");
const gmFallback = gm.filter(w => w.items.some(it => it.fallback)).length;
console.log("  只选「游戏」：12 周素材无空条目（其中 " + gmFallback + " 周用了真题兜底）");
pev("resetProfile()");

// 输入非法时必须返回错误而不是 NaN
[['{dailyMinutes:0}', "每天 0 分钟"], ['{vocabTarget:100}', "目标词量低于当前"],
 ['{startScore:500, goalScore:300}', "目标分数低于当前"], ['{examDate:"2020-01-01"}', "考试日期早于起始日"]
].forEach(([patch, label]) => {
  pev("resetProfile()");
  pev("setProfile(" + patch + ")");
  const r = pev("Plan.get()");
  ok(!r.ok || Object.keys(r.errors || {}).length > 0, "非法输入「" + label + "」应当被拒绝，而不是算出 NaN");
});
pev("resetProfile()");

// 距考试不足 4 周：拒绝生成计划并说明理由
pev('setProfile({planStart:"2026-09-21", examDate:"2026-10-05"})');
const shortR = pev("Plan.get()");
ok(!shortR.ok && shortR.reason === "tooShort", "不足 4 周时应拒绝生成计划，而不是硬排一个假的");
console.log("  不足 4 周：正确拒绝生成（改给考前冲刺清单）");
pev("resetProfile()");

/* ===================== 15. 语音合成 ===================== */
// 用假的 speechSynthesis 桩测逻辑。真实浏览器里「有没有声音」测不了，
// 但「选了哪个语音」「cancel 与 speak 的时序」这两件最易出错的事可以测。
section("15. 语音合成（假 speechSynthesis 桩）");

function speechSandbox(voices, online = true) {
  const log = { cancel: 0, spoken: [], utterances: [] };
  const synth = {
    speaking: false,
    pending: false,
    onvoiceschanged: null,
    getVoices: () => voices,
    speak(u) {
      log.spoken.push(u.text);
      log.utterances.push(u);
      synth.speaking = true;
      if (u.onstart) u.onstart();
    },
    cancel() { log.cancel++; synth.speaking = false; },
    pause() {},
    resume() {},
  };
  const store = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    Date, Math, JSON,
    navigator: { onLine: online },
    window: {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: function (text) { this.text = text; },
    },
  };
  vm.createContext(ctx);
  const load = f => vm.runInContext(fs.readFileSync(path.join(DIR, f), "utf8"), ctx, { filename: f });
  ["mock.js", "words-extra.js", "core.js", "quiz.js"].forEach(load);
  ctx.__ev = e => vm.runInContext(e, ctx);
  ctx.__log = log;
  return ctx;
}

// 直接给定语音列表并标记为已加载
function withVoices(voices, online = true) {
  const s = speechSandbox(voices, online);
  s.__ev("Speak")._voices = voices;
  s.__ev("Speak")._loaded = true;
  return s;
}

const vLocalUS = { name: "Microsoft Zira Desktop", lang: "en-US", localService: true, default: false };
const vOnlineUS = { name: "Google US English", lang: "en-US", localService: false, default: true };
const vLocalCN = { name: "Microsoft Huihui Desktop", lang: "zh-CN", localService: true, default: false };
const vLocalGB = { name: "Microsoft Hazel Desktop", lang: "en-GB", localService: true, default: false };

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 语音挑选：本地优先于在线（在线语音断网就会静默失败）
  const s1 = speechSandbox([vOnlineUS, vLocalUS, vLocalCN]);
  s1.__ev("Speak")._voices = [vOnlineUS, vLocalUS, vLocalCN];
  s1.__ev("Speak")._loaded = true;
  ok(s1.__ev("Speak.englishVoice().name") === "Microsoft Zira Desktop",
    "应优先选本地英文语音，而不是在线语音");

  const s2 = speechSandbox([vLocalCN]);
  s2.__ev("Speak")._voices = [vLocalCN];
  s2.__ev("Speak")._loaded = true;
  ok(s2.__ev("Speak.englishVoice()") === null, "只有中文语音时 englishVoice 应返回 null");

  const s3 = speechSandbox([vLocalGB, vLocalCN]);
  s3.__ev("Speak")._voices = [vLocalGB, vLocalCN];
  s3.__ev("Speak")._loaded = true;
  ok(s3.__ev("Speak.englishVoice().lang") === "en-GB", "没有 en-US 时应退到其他英文语音");

  // 朗读：正常路径
  const s4 = speechSandbox([vLocalUS]);
  s4.__ev("Speak")._voices = [vLocalUS];
  s4.__ev("Speak")._loaded = true;
  s4.__ev('Speak.speak("hello")');
  await sleep(140);
  ok(s4.__log.spoken.length === 1, "应恰好朗读 1 次，实际 " + s4.__log.spoken.length);
  ok(s4.__ev("Speak._last.started") === true, "应记录到朗读已开始");
  ok(s4.__ev("Speak._last.voiceName") === "Microsoft Zira Desktop", "应记录实际使用的语音名");
  ok(s4.__ev("Speak._last.online") === false, "本地语音不该被标为在线");

  // 正在朗读时再点：必须先 cancel，并且新语音仍然要念出来
  const s5 = speechSandbox([vLocalUS]);
  s5.__ev("Speak")._voices = [vLocalUS];
  s5.__ev("Speak")._loaded = true;
  s5.__ev('Speak.speak("first")');
  s5.__ev('Speak.speak("second")');
  await sleep(200);
  ok(s5.__log.cancel >= 1, "第二次朗读前应调用 cancel 清掉队列");
  ok(s5.__log.spoken.includes("second"),
    "cancel 之后的新语音仍必须被念出来（这正是容易静默丢语音的地方）");

  // 连播：N 句不能互相 cancel，否则只会念出最后一句
  const s6 = speechSandbox([vLocalUS]);
  s6.__ev("Speak")._voices = [vLocalUS];
  s6.__ev("Speak")._loaded = true;
  s6.__ev('Speak.speakSequence(["one","two","three"])');
  await sleep(160);
  ok(s6.__log.spoken.length === 3,
    "连播 3 句应全部入队，实际 " + s6.__log.spoken.length + "（只念最后一句说明每句都 cancel 了）");
  ok(s6.__log.cancel === 1, "连播只应在开始时 cancel 一次，实际 " + s6.__log.cancel);

  // 没有英文语音：不能崩，且要把原因记下来
  const s7 = speechSandbox([vLocalCN]);
  s7.__ev("Speak")._voices = [vLocalCN];
  s7.__ev("Speak")._loaded = true;
  let threw7 = false;
  try { s7.__ev('Speak.speak("hello")'); await sleep(140); } catch { threw7 = true; }
  ok(!threw7, "没有英文语音时不该抛异常");
  ok(!!s7.__ev("Speak._last.error"), "没有英文语音时应记录原因，而不是静默失败");

  // 语音列表还没加载完就点击：也要能念出来
  const s8 = speechSandbox([vLocalUS]);
  s8.__ev('Speak.speak("early click")');
  await sleep(1700);
  ok(s8.__log.spoken.length === 1, "语音列表未就绪时点击，也应等加载完后念出来");

  // 自检报告的结构
  const s9 = speechSandbox([vLocalUS, vLocalCN]);
  const rep = await s9.__ev("Speak.diagnose()");
  ok(rep.apiOK === true, "diagnose 应报告接口可用");
  ok(rep.count === 2, "diagnose 应报告语音数，实际 " + rep.count);
  ok(rep.english && rep.english.name === "Microsoft Zira Desktop", "diagnose 应指出将使用的英文语音");
  ok(rep.list.length === 2 && rep.list.every(v => "local" in v), "diagnose 应逐条列出语音及其是否本地");
  ok(!!rep.version, "diagnose 应带版本号（用来判断是否在跑缓存的旧代码）");

  // 完全没有语音服务（比如老旧浏览器）
  const s10 = speechSandbox([]);
  const rep10 = await s10.__ev("Speak.diagnose()");
  ok(rep10.apiOK === true && rep10.count === 0, "空语音列表应如实报告 0");
  ok(rep10.english === null, "无英文语音时 english 应为 null");
  let threw10 = false;
  try { s10.__ev('Speak.speak("x")'); await sleep(140); } catch { threw10 = true; }
  ok(!threw10, "零语音时朗读不该抛异常");

  /* ---- 在线语音：这就是「调用谷歌英语包但没联网」的场景 ---- */
  section("16. 在线语音陷阱（离线时必须排除）");

  // 离线 + 只有在线英文语音 → 绝不能选中它
  const o1 = withVoices([vOnlineUS, vLocalCN], false);
  ok(o1.__ev("Speak.englishVoice()") === null,
    "离线时绝不能选中在线英文语音（选中了就会一声不出）");
  const r1 = await o1.__ev("Speak.diagnose()");
  ok(r1.onlyOnline === true, "diagnose 应识别出「只有在线英文语音且未联网」");
  ok(/未联网|联网/.test(r1.reason || ""), "应说明是没联网导致的，实际：" + r1.reason);
  o1.__ev('Speak.speak("hello")');
  await sleep(140);
  ok(o1.__log.spoken.length === 0, "离线时不该真的去调用在线语音");
  ok(!!o1.__ev("Speak._last.error"), "离线时失败必须记录原因，不能静默");

  // 联网 + 只有在线英文语音 → 可以用
  const o2 = withVoices([vOnlineUS, vLocalCN], true);
  ok(o2.__ev("Speak.englishVoice().name") === "Google US English",
    "联网时允许退回使用在线英文语音");

  // 离线 + 本地英文 + 在线英文 → 必须选本地
  const o3 = withVoices([vOnlineUS, vLocalUS, vLocalCN], false);
  ok(o3.__ev("Speak.englishVoice().name") === "Microsoft Zira Desktop",
    "离线且有本地英文语音时，必须选本地而不是在线");

  // 在线语音在离线时应标记为不可用，离线时标为可用
  const o4 = withVoices([vOnlineUS, vLocalUS], false);
  const optsOff = o4.__ev("Speak.voiceOptions()");
  ok(optsOff.find(v => v.name === "Google US English").usable === false,
    "离线时在线语音应被标为不可用（供界面置灰）");
  ok(optsOff.find(v => v.name === "Microsoft Zira Desktop").usable === true,
    "本地语音任何时候都应可用");
  const o5 = withVoices([vOnlineUS], true);
  ok(o5.__ev("Speak.voiceOptions()")[0].usable === true, "联网时在线语音应标为可用");

  /* ---- 手动指定语音 ---- */
  section("17. 手动指定语音");

  const m1 = withVoices([vLocalUS, vLocalGB], false);
  m1.__ev('Speak.setVoice("Microsoft Hazel Desktop")');
  ok(m1.__ev("Speak.englishVoice().name") === "Microsoft Hazel Desktop",
    "指定了可用语音后应该用它");

  // 指定的语音是不可用的在线语音（且离线）→ 应自动退回，而不是硬用它
  const m2 = withVoices([vOnlineUS, vLocalUS], false);
  m2.__ev('Speak.setVoice("Google US English")');
  ok(m2.__ev("Speak.englishVoice().name") === "Microsoft Zira Desktop",
    "指定的语音当前不可用时应退回可用的那个，而不是硬用");

  // 指定的语音已经不存在了（换了电脑/卸了语音包）→ 应自动退回
  const m3 = withVoices([vLocalUS], false);
  m3.__ev('Speak.setVoice("早就没了的语音")');
  ok(m3.__ev("Speak.englishVoice().name") === "Microsoft Zira Desktop",
    "指定的语音不存在时应自动退回");

  // 恢复自动
  m3.__ev('Speak.setVoice("")');
  ok(m3.__ev("Speak.voiceName()") === "", "清空指定后应回到自动选择");

  /* ---- 重置 / 恢复出厂设置 ---- */
  section("18. 重置与恢复出厂设置");

  // 预置一份「有内容」的存储，让 state 一加载就读到它。
  // recordSummary() 读的是内存里的 state，只写存储是测不到的。
  const seeded = {
    "ewb_task_checks": JSON.stringify({ "2026-09-28": { "mon-听力-main": true }, "2026-09-29": {} }),
    "ewb_quiz_totals": JSON.stringify({ n: 12, right: 9, byType: { en2cn: { n: 12, right: 9 } } }),
    "ewb_quiz_log": JSON.stringify([{ t: "2026-09-28", w: 5, ok: true, type: "en2cn" }]),
    "ewb_srs": JSON.stringify({ 5: { box: 2, due: "2026-10-01" } }),
    "ewb_mistakes": JSON.stringify({ 5: { wordId: 5, word: "adapt", wrong: 2 } }),
    "ewb_custom_words": JSON.stringify([{ id: 900, word: "zzz", meaning: "测试" }]),
    "ewb_done_milestones": JSON.stringify(["m1", "m2"]),
    "ewb_reviews": JSON.stringify({ 1: { done: "写了点东西", saved: true } }),
    "ewb_activity": JSON.stringify({ "2026-09-28": { tasks: 1, quiz: 1, words: 0, practice: 0, taskMin: 10 } }),
    "ewb_mastered_words": JSON.stringify([5]),
    "ewb_practice": JSON.stringify({ writing: [{ id: 1, refKey: "argument", text: "a b c" }] }),
    "ewb_profile": JSON.stringify({ goalScore: 500, examDate: "2027-01-09" }),
    "ewb_speech_rate": "1.2",
  };

  const rs = sandbox(seeded);
  const rev = rs.__ev;

  // 键分类必须不重不漏：漏一个就会出现「清不干净」，重一个就会「误删设置」
  const dk = rev("DATA_KEYS");
  const sk = rev("SETTING_KEYS");
  const ek = rev("EXPORT_KEYS");
  ok(dk.every(k => ek.includes(k)), "DATA_KEYS 有不在 EXPORT_KEYS 里的键：" + dk.filter(k => !ek.includes(k)).join(","));
  ok(sk.every(k => ek.includes(k)), "SETTING_KEYS 有不在 EXPORT_KEYS 里的键：" + sk.filter(k => !ek.includes(k)).join(","));
  ok(dk.every(k => !sk.includes(k)), "两类键有重叠：" + dk.filter(k => sk.includes(k)).join(","));
  const uncovered = ek.filter(k => !dk.includes(k) && !sk.includes(k));
  ok(uncovered.length === 0, "这些键既不算记录也不算设置，清空时会漏掉：" + uncovered.join(", "));
  ok(dk.length + sk.length === ek.length,
    "分类数量对不上：" + dk.length + "+" + sk.length + " ≠ " + ek.length);
  console.log("  键分类：" + dk.length + " 个学习记录 + " + sk.length + " 个设置 = " + ek.length + " 个导出键，不重不漏");

  const has = k => rs.__store[k] !== undefined;
  // 重新预置：state 也要跟着回滚，否则内存与存储会不一致
  const reseed = () => {
    Object.keys(seeded).forEach(k => { rs.__store[k] = seeded[k]; });
    rev("state.taskChecks = loadJSON(STORAGE_KEYS.taskChecks, {})");
    rev("state.quizTotals = loadJSON(STORAGE_KEYS.quizTotals, {n:0,right:0,byType:{}})");
    rev("state.srs = loadJSON(STORAGE_KEYS.srs, {})");
    rev("state.mistakes = loadJSON(STORAGE_KEYS.mistakes, {})");
    rev("state.customWords = loadJSON(STORAGE_KEYS.customWords, [])");
    rev("state.doneMilestones = loadJSON(STORAGE_KEYS.doneMilestones, [])");
    rev("state.reviews = loadJSON(STORAGE_KEYS.reviews, {})");
    rev("state.practice = loadJSON(STORAGE_KEYS.practice, {})");
    rev("state.profile = loadJSON(STORAGE_KEYS.profile, {})");
    rev("state.speechRate = loadJSON(STORAGE_KEYS.speechRate, 0.9)");
    rev("Plan.clear()");
  };

  reseed();
  ok(has("ewb_quiz_totals") && has("ewb_profile"), "测试数据没写进去");
  const sum = rev("recordSummary()");
  ok(sum.length > 0, "有数据时清空清单不该为空");
  console.log("  清空清单：" + sum.map(x => x.label + " " + x.n).join(" · "));

  // 只清学习记录：记录没了，设置必须原样保留
  rev('resetStorage("data")');
  ok(!has("ewb_quiz_totals"), "「清空学习记录」应删掉答题记录");
  ok(!has("ewb_srs") && !has("ewb_mistakes"), "应删掉复习计划与错题");
  ok(!has("ewb_task_checks") && !has("ewb_done_milestones"), "应删掉打卡与里程碑进度");
  ok(!has("ewb_custom_words") && !has("ewb_reviews"), "应删掉自定义词与复盘");
  ok(has("ewb_profile"), "「清空学习记录」必须保留计划设置，否则要重填一遍");
  ok(has("ewb_speech_rate"), "「清空学习记录」应保留语音语速这种偏好");
  ok(JSON.parse(rs.__store["ewb_profile"]).goalScore === 500, "保留的设置内容不该被动过");

  // 恢复出厂设置：连设置一起清
  reseed();
  rev('resetStorage("all")');
  ok(ek.every(k => rs.__store[k] === undefined), "「恢复出厂设置」后不该残留任何导出键");
  ok(!has("ewb_checked_tasks") && !has("ewb_streak_date") && !has("ewb_streak_count"),
    "「恢复出厂设置」应连旧版遗留键一起清掉");
  ok(!has("ewb_profile"), "「恢复出厂设置」应清掉计划设置");

  // 清空后重新载入，migrate 应把默认画像重建出来，而不是留下一个坏状态
  rev("migrate()");
  ok(has("ewb_profile"), "重新载入后 migrate 应重建默认画像");
  ok(rev("getProfile().goalScore") === 380, "重建的画像应是默认值，实际 " + rev("getProfile().goalScore"));
  ok(rev("Plan.get().weeks") === 12, "重建后计划应回到默认的 12 周，实际 " + rev("Plan.get().weeks"));
  console.log("  恢复出厂设置后 migrate 重建：目标 "
    + rev("getProfile().goalScore") + " 分 · " + rev("Plan.get().weeks") + " 周");

  // 空数据上执行清空不该崩
  const rs2 = sandbox();
  let clearThrew = false;
  try { rs2.__ev('resetStorage("data")'); rs2.__ev('resetStorage("all")'); } catch { clearThrew = true; }
  ok(!clearThrew, "对空数据执行清空不该抛异常");
  ok(rs2.__ev("recordSummary()").length === 0, "空数据时清单应为空，不列一堆 0");

  finish();
})();

/* ===================== 结果 ===================== */
function finish() {
  console.log("\n" + "─".repeat(52));
  if (fails === 0) {
    console.log("\x1b[32m✅ 全部通过（" + checks + " 项检查）\x1b[0m");
    console.log("\n语音部分只验证了逻辑（选了哪个语音、时序对不对）。");
    console.log("「到底有没有出声」必须在浏览器里点「学习统计 → 语音自检」实测。");
  } else {
    console.log("\x1b[31m❌ " + fails + " / " + checks + " 项失败\x1b[0m");
    process.exitCode = 1;
  }
}
