// module-stats.js — 学习统计 + 数据备份
// 两个 tab 放在同一个模块里：它们都是“关于数据本身”的界面。
// 自注册为 "stats"。

let statsTab = "overview"; // "overview" | "backup"

const APP_TAG = "english-workbench";

/* ===================== 渲染入口 ===================== */
function renderStats() {
  $("#content").innerHTML = `
    <div class="section-header">
      <h2>学习统计</h2>
      <p>所有数字都来自你本机的真实记录。数据只存在这台电脑的浏览器里，导出的备份文件也由你自己保管。</p>
    </div>

    <div class="quiz-tabs">
      <button class="task-tab ${statsTab === "overview" ? "active" : ""}" data-stats-tab="overview">学习统计</button>
      <button class="task-tab ${statsTab === "backup" ? "active" : ""}" data-stats-tab="backup">数据备份</button>
    </div>

    ${statsTab === "overview" ? renderOverview() : renderBackup()}
  `;
  bindStatsEvents();
}

/* ===================== 统计 ===================== */
// 按当天计划里的槽位统计完成情况。
// 任务数量与时长都会随「我的目标」变化，所以分母必须现算，不能读死数据。
function planDayOf(dateStr) {
  const r = Plan.get();
  if (!r.ok) return null;
  const di = weekdayIdx(dateStr);
  return r.weekTasks[di] || null;
}

function weekTaskStats(days) {
  const r = Plan.get();
  if (!r.ok) return { done: 0, total: 0, doneMin: 0, totalMin: 0, pct: 0 };
  let done = 0, total = 0, doneMin = 0, totalMin = 0;
  days.forEach(d => {
    const di = weekdayIdx(d);
    const day = r.weekTasks[di];
    if (!day) return;
    day.slots.forEach((s, i) => {
      total++;
      totalMin += s.minutes || 0;
      if (isTaskChecked(d, di, s, i)) {
        done++;
        doneMin += s.minutes || 0;
      }
    });
  });
  // 完成率按时间加权：一个 5 分钟的任务和一个 25 分钟的任务不该等权
  const pct = totalMin ? Math.round((doneMin / totalMin) * 100) : 0;
  return { done, total, doneMin, totalMin, pct };
}

function renderOverview() {
  const pool = Quiz.pool();
  const mastered = getVocabList().filter(w => w.category === "mastered" || state.masteredWords.includes(w.id)).length;
  const T = state.quizTotals;
  const acc = T.n ? Math.round(((T.right || 0) / T.n) * 100) : 0;
  const p = practiceTotal();

  const { days, label } = currentWeekDays();
  const wt = weekTaskStats(days);
  const activeDays = days.filter(dayActive).length;
  const weekPct = wt.pct;

  return `
    <div class="stat-tiles">
      ${statTile(totalStudyDays(), "累计学习天数", "有记录的天数")}
      ${statTile(currentStreak(), "连续打卡", "天", "orange")}
      ${statTile(mastered, "已掌握单词", "共 " + pool.length + " 词", "gray")}
      ${statTile(acc + "%", "测验正确率", (T.n || 0) + " 题累计", acc >= 80 ? "" : "orange")}
      ${statTile(Mistakes.activeCount(), "错题待攻克", "已攻克 " + Mistakes.resolvedCount() + " 个", "gray")}
      ${statTile(weekPct + "%", "本周任务完成", `按时间加权 ${wt.doneMin}/${wt.totalMin} 分钟`, "orange")}
    </div>

    <div class="card" style="margin-top:var(--s-6);">
      <div class="week-progress-head"><strong>最近 14 天</strong><span>条越高表示当天投入越多</span></div>
      ${renderActivityStrip(14)}
    </div>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>分题型正确率</strong><span>哪个题型弱一目了然</span></div>
      ${renderTypeBreakdown()}
    </div>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>语音自检</strong><span>朗读没声音时先看这里</span></div>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--s-4);">
        朗读用的是浏览器自带的语音合成，完全离线。点下面按钮会报告：找到了几个语音、用的是哪一个、
        以及朗读到底有没有真正开始。不出声的原因基本都能在这里看出来。
      </p>
      <button class="btn btn-primary" id="btnSpeakTest">🔊 试听并自检</button>
      <div id="speechReport"></div>
    </div>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head">
        <strong>本周学习报告</strong>
        <span>${esc(label)} · 已打卡 ${activeDays}/7 天</span>
      </div>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--s-4);">
        这段文字可以直接复制进你的《学习体验总结》。数字都是真实的，不用自己编。
      </p>
      <textarea class="review-textarea report-textarea" id="reportText" readonly>${esc(buildWeeklyReport())}</textarea>
      <div class="review-actions" style="margin-top:var(--s-4);">
        <button class="btn btn-primary" id="copyReport">复制报告</button>
      </div>
    </div>
  `;
}

function statTile(value, label, sub, cls) {
  return `<div class="stat-tile">
    <div class="stat-tile-value ${cls || ""}">${esc(String(value))}</div>
    <div class="stat-tile-label">${esc(label)}</div>
    <div class="stat-tile-sub">${esc(sub)}</div>
  </div>`;
}

// 本周（周一 ~ 周日）
function currentWeekDays() {
  const monday = weekStart(todayStr());
  const days = [];
  for (let i = 0; i < 7; i++) days.push(dateAdd(monday, i));
  const label = `${monday} ~ ${dateAdd(monday, 6)}`;
  return { monday, days, label };
}

function activityScore(dateStr) {
  const a = state.activity[dateStr];
  if (!a) return 0;
  // 任务部分用真实分钟数（taskMin）。任务时长会随「我的目标」变化，
  // 原来把每个任务一律算 5 分会让这个条形图随设置漂移。
  // 历史记录没有 taskMin，回退为「每任务 10 分钟」。
  const taskLoad = a.taskMin != null ? a.taskMin : (a.tasks || 0) * 10;
  // 加权：一道测验题算 1，任务按分钟 0.5，一个词算 2，一次练习算 8
  return (a.quiz || 0) * 1 + taskLoad * 0.5 + (a.words || 0) * 2 + (a.practice || 0) * 8;
}

function renderActivityStrip(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(dateAdd(todayStr(), -i));
  const scores = days.map(activityScore);
  const max = Math.max(1, ...scores);
  const today = todayStr();

  return `<div class="activity-strip">
    ${days.map((d, i) => {
      const s = scores[i];
      const h = Math.round((s / max) * 100);
      const dnum = parseInt(d.slice(8), 10);
      return `<div class="activity-day ${d === today ? "today" : ""} ${s === 0 ? "empty" : ""}"
                   title="${d}　投入指数 ${s}">
        <div class="activity-bar-wrap"><div class="activity-bar" style="height:${s === 0 ? 2 : Math.max(6, h)}%"></div></div>
        <span class="activity-day-label">${dnum}</span>
      </div>`;
    }).join("")}
  </div>
  <div class="activity-legend"><span>${esc(days[0])}</span><span>今天</span></div>`;
}

function renderTypeBreakdown() {
  const T = state.quizTotals;
  const byType = T.byType || {};
  const rows = Object.keys(Quiz.TYPE_LABELS).map(t => {
    const r = byType[t] || { n: 0, right: 0 };
    const pct = r.n ? Math.round((r.right / r.n) * 100) : 0;
    return `<div class="type-row">
      <span class="type-name">${esc(Quiz.TYPE_LABELS[t])}</span>
      <div class="type-bar"><div style="width:${pct}%"></div></div>
      <span class="type-num">${r.right}/${r.n}${r.n ? ` · ${pct}%` : ""}</span>
    </div>`;
  }).join("");
  return (T.n || 0) ? `<div class="type-breakdown">${rows}</div>`
                    : `<div class="empty-state">还没有测验记录，去「背单词测验」做一轮吧。</div>`;
}

function buildWeeklyReport() {
  const { days, label } = currentWeekDays();
  const T = state.quizTotals;
  const p = practiceTotal();
  const pool = Quiz.pool();
  const mastered = getVocabList().filter(w => w.category === "mastered" || state.masteredWords.includes(w.id)).length;

  const inWeek = d => days.includes(d);

  const wt = weekTaskStats(days);
  const taskDone = wt.done;
  const totalTasks = wt.total;
  const activeDays = days.filter(dayActive).length;

  // 明细有 500 条上限，但一周内的答题量不可能超过，所以本周数字是准的
  const weekLog = state.quizLog.filter(l => inWeek(l.t));
  const weekRight = weekLog.filter(l => l.ok).length;
  const weekAcc = weekLog.length ? ((weekRight / weekLog.length) * 100).toFixed(1) : "—";

  const weekWords = days.reduce((s, d) => s + ((state.activity[d] || {}).words || 0), 0);
  const weekQuiz = days.reduce((s, d) => s + ((state.activity[d] || {}).quiz || 0), 0);

  const weekWriting = practiceGet("writing", []).filter(a => inWeek(a.at));
  const weekTrans = practiceGet("translation", []).filter(a => inWeek(a.at));
  const weekConv = Object.values(practiceGet("conversation", {}))
    .filter(r => inWeek(r.last || "")).length;

  const newMistakes = Mistakes.list().filter(m => inWeek(m.addedAt || "")).length;

  const avgTransScore = weekTrans.length
    ? (weekTrans.reduce((s, a) => s + (a.score || 0), 0) / weekTrans.length).toFixed(1)
    : "—";
  const avgWriteWords = weekWriting.length
    ? Math.round(weekWriting.reduce((s, a) => s + countWords(a.text), 0) / weekWriting.length)
    : 0;

  // 任务部分用真实分钟数累加。历史记录没有 taskMin，回退每任务 10 分钟并注明是估算。
  const weekTaskMin = days.reduce((s, d) => {
    const a = state.activity[d] || {};
    return s + (a.taskMin != null ? a.taskMin : (a.tasks || 0) * 10);
  }, 0);
  const hasEstimated = days.some(d => {
    const a = state.activity[d];
    return a && a.tasks > 0 && a.taskMin == null;
  });
  const minutes = weekTaskMin + weekLog.length * 0.5 + (weekWriting.length + weekTrans.length + weekConv) * 15;

  const lines = [
    `【第 ${currentWeek()} 周学习报告】${label}`,
    `打卡 ${activeDays}/7 天 · 连续 ${currentStreak()} 天 · 任务完成 ${taskDone}/${totalTasks}`
      + `（按时间加权 ${wt.pct}%：${wt.doneMin}/${wt.totalMin} 分钟）`,
    ``,
    `单词：本周新增/导入 ${weekWords} 个 · 累计掌握 ${mastered}/${pool.length}`,
    `测验：本周 ${weekLog.length} 题 / 正确 ${weekRight}（${weekAcc}%） ｜ 累计 ${T.n || 0} 题`,
  ];

  const byType = T.byType || {};
  const typeLines = Object.keys(Quiz.TYPE_LABELS)
    .filter(t => (byType[t] || {}).n)
    .map(t => `${Quiz.TYPE_SHORT[t]} ${byType[t].right}/${byType[t].n}`);
  if (typeLines.length) lines.push(`　　分题型：${typeLines.join("　")}`);

  lines.push(
    ``,
    `错题本：待攻克 ${Mistakes.activeCount()} 个（本周新增 ${newMistakes}）· 已攻克 ${Mistakes.resolvedCount()} 个`,
    `写作 ${weekWriting.length} 篇${weekWriting.length ? ` · 平均 ${avgWriteWords} 词` : ""} ｜ 翻译 ${weekTrans.length} 句${weekTrans.length ? ` · 平均自评 ${avgTransScore}/5` : ""} ｜ 口语场景 ${weekConv} 个`,
    ``,
    `投入估算：约 ${Math.round(minutes)} 分钟（任务按实际时长 ${Math.round(weekTaskMin)} 分钟`
      + `${hasEstimated ? "，其中较早的记录按每任务 10 分钟估算" : ""}`
      + `；每题 0.5 分钟、每次练习 15 分钟折算）`,
  );

  return lines.join("\n");
}

/* ===================== 数据备份 ===================== */
function renderBackup() {
  const used = storageUsed();
  const counts = describeData();

  return `
    <div class="card">
      <div class="week-progress-head"><strong>当前数据概览</strong><span>占用约 ${(used / 1024).toFixed(0)} KB</span></div>
      <div class="data-summary">
        ${counts.map(c => `<div class="data-summary-item">
          <span class="data-summary-num">${esc(String(c.n))}</span>
          <span class="data-summary-label">${esc(c.label)}</span>
        </div>`).join("")}
      </div>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-top:var(--s-4);">
        这些数据存在这台电脑的浏览器里。<strong>清除浏览器数据会把它们一起清掉</strong>，也没法同步到别的设备 ——
        重要的时候导出一份备份。
      </p>
    </div>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>导出备份</strong><span>生成一个 JSON 文件，自己保存</span></div>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--s-4);">
        备份包含全部学习记录：打卡、单词卡、测验明细、错题本、复习进度、复盘日志、练习作答。
      </p>
      <button class="btn btn-primary" id="btnExport">📤 导出备份文件</button>
    </div>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>从备份恢复</strong><span>会用备份内容覆盖当前数据</span></div>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--s-4);">
        选择之前导出的 .json 文件。恢复前会先告诉你会覆盖哪些内容，确认后才写入。
      </p>
      <input type="file" id="importBackupFile" accept=".json,application/json"
             class="import-file-input" style="margin-bottom:var(--s-4);" />
      <div id="backupMsg"></div>
    </div>

    <div class="card danger-zone" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>清空数据</strong><span>不可撤销</span></div>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);">
        清空操作统一放在「我的目标」页面底部，那里同时能看到计划参数的样子，
        避免同一个破坏性操作有两个入口。<strong>导出备份还是在这里。</strong>
      </p>
      <div class="quiz-actions" style="margin-top:0;">
        <button class="btn" data-goto-profile>去「我的目标」清空数据</button>
      </div>
    </div>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>关于自检</strong><span>开发者用</span></div>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);">
        本项目没有构建步骤。改完代码后，在项目目录执行 <code>node verify.js</code>
        可以检查词库数据、复习算法、出题逻辑和存储迁移是否正常（界面部分仍需在浏览器里手点）。
      </p>
    </div>`;
}

function storageUsed() {
  let n = 0;
  EXPORT_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v) n += v.length + k.length;
  });
  return n;
}

function describeData() {
  const taskDays = Object.keys(state.taskChecks).filter(d =>
    Object.values(state.taskChecks[d] || {}).some(Boolean)).length;
  const cards = getVocabList().length;
  const quiz = state.quizTotals.n || 0;
  const mistakes = Object.keys(state.mistakes).length;
  const reviews = Object.keys(state.reviews).length;
  const p = practiceTotal();
  return [
    { n: taskDays, label: "打卡天数" },
    { n: cards, label: "单词卡" },
    { n: quiz, label: "答题记录" },
    { n: mistakes, label: "错题" },
    { n: Object.keys(state.srs).length, label: "复习计划" },
    { n: reviews, label: "周复盘" },
    { n: p.writing + p.translation + p.conversation, label: "练习作答" },
  ];
}

/* ===================== 导出 ===================== */
function exportBackup() {
  const data = {};
  let n = 0;
  EXPORT_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) { data[k] = v; n++; }
  });

  const payload = {
    app: APP_TAG,
    version: CURRENT_VERSION,
    exportedAt: new Date().toISOString(),
    note: "英语学习工作台备份文件。请在「学习统计 → 数据备份」里导入恢复。",
    keyCount: n,
    data,
  };

  const text = JSON.stringify(payload, null, 2);
  const filename = `english-workbench-backup-${todayStr()}.json`;

  try {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`已导出 ${n} 项数据（${filename}）`, "success", 4500);
  } catch (err) {
    console.error(err);
    // 下载被拦时，退回到“让你自己复制”
    const msg = $("#backupMsg");
    if (msg) {
      msg.innerHTML = `<div class="inline-note">
        浏览器拦住了自动下载。请手动复制下面全部内容，粘贴到记事本里存成 <code>${esc(filename)}</code>。
      </div>
      <textarea class="review-textarea report-textarea" readonly>${esc(text)}</textarea>`;
    }
  }
}

/* ===================== 导入 ===================== */
async function importBackup(file) {
  const msg = $("#backupMsg");

  let payload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (err) {
    if (msg) msg.innerHTML = `<div class="inline-note warn">这个文件不是有效的 JSON，无法解析。</div>`;
    return;
  }

  if (!payload || payload.app !== APP_TAG) {
    if (msg) msg.innerHTML = `<div class="inline-note warn">
      这不是本工作台的备份文件（缺少标识）。请确认选对了文件。</div>`;
    return;
  }

  const ver = parseInt(payload.version, 10) || 0;
  if (ver > CURRENT_VERSION) {
    if (msg) msg.innerHTML = `<div class="inline-note warn">
      这份备份来自更新的版本（v${ver}，当前支持到 v${CURRENT_VERSION}），为避免数据错乱已拒绝导入。</div>`;
    return;
  }

  const data = payload.data;
  if (!data || typeof data !== "object") {
    if (msg) msg.innerHTML = `<div class="inline-note warn">备份文件里没有数据内容。</div>`;
    return;
  }

  const keys = Object.keys(data).filter(k => EXPORT_KEYS.includes(k));
  if (!keys.length) {
    if (msg) msg.innerHTML = `<div class="inline-note warn">备份里没有可识别的数据项。</div>`;
    return;
  }

  // 用备份内容算一份摘要，让用户知道会覆盖掉什么
  const describe = d => {
    try {
      const taskChecks = JSON.parse(d[STORAGE_KEYS.taskChecks] || "{}");
      const days = Object.keys(taskChecks).filter(x => Object.values(taskChecks[x] || {}).some(Boolean)).length;
      const totals = JSON.parse(d[STORAGE_KEYS.quizTotals] || "{}");
      const mistakes = Object.keys(JSON.parse(d[STORAGE_KEYS.mistakes] || "{}")).length;
      const srs = Object.keys(JSON.parse(d[STORAGE_KEYS.srs] || "{}")).length;
      return `打卡 ${days} 天 · 答题 ${totals.n || 0} 题 · 复习计划 ${srs} 词 · 错题 ${mistakes} 个`;
    } catch { return "（内容无法解析）"; }
  };

  const before = describe(
    Object.fromEntries(EXPORT_KEYS.map(k => [k, localStorage.getItem(k)]).filter(([, v]) => v !== null))
  );
  const after = describe(data);

  const exportedAt = payload.exportedAt ? String(payload.exportedAt).slice(0, 19).replace("T", " ") : "未知时间";

  const choice = await chooseDialog({
    title: "确认恢复备份",
    message: `
      <p>备份导出时间：<strong>${esc(exportedAt)}</strong>，包含 ${keys.length} 项数据。</p>
      <div class="dialog-compare">
        <div><span class="dialog-compare-label">备份里的内容</span>${esc(after)}</div>
        <div><span class="dialog-compare-label">当前会被覆盖为</span>${esc(before)}</div>
      </div>
      <p style="color:var(--danger);font-size:var(--fs-sm);margin-top:var(--s-3);">
        ⚠️ 当前数据会被完全替换，且无法撤销。建议先导出一份当前备份。
      </p>`,
    buttons: [
      { label: "确认覆盖", value: "yes", cls: "btn-danger" },
      { label: "取消", value: null, cls: "btn-primary" },
    ],
  });

  if (choice !== "yes") return;

  let written = 0;
  for (const k of keys) {
    try {
      localStorage.setItem(k, data[k]);
      written++;
    } catch (err) {
      console.error("[import] 写入失败", k, err);
      if (msg) msg.innerHTML = `<div class="inline-note warn">写入中断：存储空间不足（已写入 ${written} 项）。</div>`;
      return;
    }
  }

  if (msg) msg.innerHTML = `<div class="inline-note">已恢复 ${written} 项数据，正在重新载入…</div>`;
  toast("恢复完成，正在重新载入", "success", 2000);
  setTimeout(() => location.reload(), 900);
}

/* ===================== 复制报告 ===================== */
// 清空数据的实现原本在这里（wipeAll），已移到 core.js 的 resetStorage()
// 与「我的目标」模块 —— 同一个破坏性操作不该有两个入口，改一处漏一处是最容易出事的。

async function copyReport() {
  const ta = $("#reportText");
  if (!ta) return;
  const text = ta.value;

  // 先试异步剪贴板（file:// 下不一定可用），失败就退回 execCommand
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast("报告已复制到剪贴板", "success");
      return;
    }
    throw new Error("no clipboard api");
  } catch {
    try {
      ta.removeAttribute("readonly");
      ta.select();
      ta.setSelectionRange(0, text.length);
      const okCopy = document.execCommand("copy");
      ta.setAttribute("readonly", "readonly");
      window.getSelection().removeAllRanges();
      toast(okCopy ? "报告已复制到剪贴板" : "复制失败，请手动选中文本复制", okCopy ? "success" : "error");
    } catch (e) {
      toast("复制失败，请手动选中文本框里的内容复制", "error");
    }
  }
}

/* ===================== 语音自检 ===================== */
async function runSpeechCheck() {
  const el = $("#speechReport");
  if (!el) return;
  el.innerHTML = `<div class="inline-note">正在检测…</div>`;

  const d = await Speak.diagnose();

  // 版本号：如果显示不出新版本号，说明浏览器还在跑缓存里的旧脚本
  const verCell = d.version
    ? esc(d.version)
    : `<span class="bad">读不到（很可能在用缓存里的旧代码）</span>`;

  let html = `<div class="speech-report">
    <div class="speech-row"><span>代码版本</span><strong>${verCell}</strong></div>
    <div class="speech-row"><span>语音合成接口</span><strong class="${d.apiOK ? "ok" : "bad"}">${d.apiOK ? "支持" : "不支持"}</strong></div>
    <div class="speech-row"><span>当前网络</span><strong>${d.online ? "已联网" : "未联网"}</strong></div>
    <div class="speech-row"><span>浏览器报告的语音数</span><strong>${d.count}</strong></div>
    <div class="speech-row"><span>其中英文语音</span><strong>${d.englishCount}</strong></div>
    <div class="speech-row"><span>将使用的语音</span><strong class="${d.english ? "ok" : "bad"}">
      ${d.english ? esc(d.english.name) + " (" + esc(d.english.lang) + ")" + (d.english.local ? " · 本地" : " · <span class=\"bad\">在线</span>") : "无可用"}
    </strong></div>
  </div>`;

  if (!d.version) {
    html += `<div class="inline-note warn">${esc(ASSET_HINT)}</div>`;
  }

  if (d.list.length) {
    html += `<div class="speech-voices">
      ${d.list.map(v => `
        <button class="speech-voice ${/^en/i.test(v.lang) ? "en" : ""} ${v.usable ? "" : "dead"} ${v.chosen ? "chosen" : ""}"
                data-pick-voice="${esc(v.name)}" ${v.usable ? "" : "disabled"}
                title="${v.usable ? "点一下改用这个语音" : "当前不可用（在线语音且未联网）"}">
          ${esc(v.name)} <em>${esc(v.lang)}</em>${v.local ? "<em>本地</em>" : "<em>在线</em>"}${v.chosen ? " ✓" : ""}
        </button>`).join("")}
    </div>
    <div class="voice-pick-note">
      点任意一个可用语音即可指定使用它（灰色的是当前用不了的）。
      <button class="btn" id="btnVoiceAuto">恢复自动选择</button>
    </div>`;
  }

  const { verdict, cls } = speechVerdict(d);
  html += `<div class="inline-note ${cls}">${verdict}</div>`;
  el.innerHTML = html;

  // 语音选择
  $$("[data-pick-voice]").forEach(btn => {
    btn.addEventListener("click", () => {
      Speak.setVoice(btn.dataset.pickVoice);
      Speak.stop();
      Speak.speak("Hello. This is the voice you picked.");
      renderStats();
      toast("已改用「" + btn.dataset.pickVoice + "」", "success");
    });
  });
  const auto = $("#btnVoiceAuto");
  if (auto) auto.addEventListener("click", () => {
    Speak.setVoice("");
    renderStats();
    toast("已恢复自动选择语音", "success");
  });

  // 真的念一句，约 1.6 秒后回来看结果
  Speak.speak("Hello. This is a reading test.");
  setTimeout(() => {
    const report = $("#speechReport");
    if (!report) return;
    const last = Speak._last;
    let line;
    let c = "warn";
    if (!last) {
      line = "没有记录到朗读调用。";
    } else if (last.error) {
      line = `朗读报错：<code>${esc(String(last.error))}</code>　${speechErrorHint(last.error)}`;
    } else if (last.started) {
      c = "";
      line = `✅ 朗读已开始${last.ended ? "并已结束" : ""}，用的是 <strong>${esc(last.voiceName || "默认语音")}</strong>。`
           + `如果你还是没听到声音，请检查系统音量、以及浏览器标签页是否被静音。`;
    } else {
      line = "调用了朗读，但从未真正开始（没触发 onstart）。常见原因：浏览器语音服务没启动 → "
           + "<strong>完全关闭浏览器再重新打开</strong>；或者这个浏览器用不了系统语音。";
    }
    report.insertAdjacentHTML("beforeend", `<div class="inline-note ${c}">${line}</div>`);
  }, 1600);
}

function speechVerdict(d) {
  if (!d.apiOK) {
    return { verdict: "这个浏览器没有提供语音合成功能。请换用 Chrome 或 Edge 打开。", cls: "warn" };
  }
  if (d.count === 0) {
    return { verdict: "浏览器报告「一个语音都没有」。通常是语音列表还没加载出来：把浏览器完全关掉重开一次再看。若仍是 0，说明系统确实缺少语音包。", cls: "warn" };
  }
  if (d.onlyOnline) {
    return { verdict: "<b>找到原因了：</b>浏览器只提供了<b>在线</b>英文语音（Chrome 的 Google 语音就是这类），"
      + "而你现在没有联网 —— 这类语音必须联网才能发声，所以你点了没声音。"
      + "这不是本工作台能修的：需要在系统里装一个<b>本地</b>英文语音包，装完完全关闭浏览器再重开。", cls: "warn" };
  }
  if (!d.english) {
    return { verdict: `当前没有可用的英文语音。${esc(d.reason || "")}`, cls: "warn" };
  }
  if (!d.english.local) {
    return { verdict: "将使用<b>在线</b>英文语音，需要联网才能出声。离线时它会静默失败。", cls: "warn" };
  }
  return { verdict: `环境正常：使用本地英文语音「${esc(d.english.name)}」。下面再实测一句。`, cls: "" };
}

function speechErrorHint(code) {
  const c = String(code).toLowerCase();
  if (c.includes("not-allowed")) return "浏览器要求先有用户操作才能发声。";
  if (c.includes("audio-busy")) return "音频设备被别的程序占用了，关掉其他播放器再试。";
  if (c.includes("synthesis-failed") || c.includes("synthesis-unavailable")) return "语音引擎启动失败，完全关闭浏览器重开一次通常能解决。";
  if (c.includes("voice-unavailable")) return "选中的语音无法使用，换一个语音试试。";
  if (c.includes("text-too-long")) return "文本太长，已超出限制。";
  if (c.includes("network")) return "该语音需要联网，而当前网络不可用。";
  return "";
}

/* ===================== 事件绑定 ===================== */
function bindStatsEvents() {
  $$("[data-stats-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      statsTab = btn.dataset.statsTab;
      renderStats();
    });
  });

  const cp = $("#copyReport");
  if (cp) cp.addEventListener("click", copyReport);

  const st = $("#btnSpeakTest");
  if (st) st.addEventListener("click", runSpeechCheck);

  const ex = $("#btnExport");
  if (ex) ex.addEventListener("click", exportBackup);

  const fi = $("#importBackupFile");
  if (fi) fi.addEventListener("change", () => {
    const f = fi.files && fi.files[0];
    if (f) importBackup(f);
    fi.value = "";
  });

  $$("[data-goto-profile]").forEach(b => b.addEventListener("click", () => switchModule("profile")));
}

Modules.register("stats", {
  title: "学习统计",
  render: renderStats,
  order: 10,
});
