// app.js — 应用外壳 + 目标看板 / 每日任务卡 / 素材库 / 复盘日志
// 通用层（工具、存储、state、注册表、语音）在 core.js
// 计划推导（周数、里程碑、每日任务、素材、SMART）在 plan.js
// 各模块通过 Modules.register 自注册；本文件必须最后加载，因为底部调用 init()

/* ===================== 计划未就绪时的统一提示 ===================== */
function planNotReadyHTML() {
  const r = Plan.get();
  if (r.ok) return "";
  if (r.reason === "tooShort") {
    return `<div class="card">
      <div class="section-header" style="margin-bottom:var(--s-4);">
        <h2 style="font-size:var(--fs-xl);">距考试不足 4 周，不再生成周计划</h2>
      </div>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-bottom:var(--s-5);">
        你的考试日期距今只剩 <strong>${esc(String(r.rawWeeks))} 周</strong>。
        这个时间跨度再排"周里程碑"只是自我安慰 —— 与其摊一张假计划，不如直接做这几件事：
      </p>
      <ol class="cram-list">
        <li>计时做完整真题，一次一套，做完立刻对答案</li>
        <li>把「背单词测验 → 复习到期」清空，只背真题里出现过的词</li>
        <li>错题本里仍未攻克的词，考前过两遍</li>
        <li>写作背 3 个开头句 + 3 个结尾句，翻译只练简单句</li>
      </ol>
      <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-top:var(--s-4);">
        如果考试日期填错了，去「我的目标」改一下。
      </p>
      <div class="quiz-actions"><button class="btn btn-primary" data-goto-profile>去「我的目标」修改</button></div>
    </div>`;
  }
  const errs = Object.values(r.errors || {});
  return `<div class="card">
    <div class="section-header" style="margin-bottom:var(--s-4);">
      <h2 style="font-size:var(--fs-xl);">计划参数有问题，暂时算不出计划</h2>
    </div>
    <ul class="cram-list">${errs.map(e => `<li>${esc(e)}</li>`).join("")}</ul>
    <div class="quiz-actions"><button class="btn btn-primary" data-goto-profile>去「我的目标」修改</button></div>
  </div>`;
}

/* ===================== 顶部周次徽章 ===================== */
function updateWeekBadge() {
  const el = $("#weekBadge");
  if (!el) return;
  const r = Plan.get();
  const n = r.ok ? r.weeks : null;
  const status = planStatus();

  // 页脚那句「今日投入 ≤ 30 分钟」原本是写死的，现在跟着设置走
  const fn = $("#footerNote");
  if (fn) {
    fn.textContent = r.ok
      ? `今日投入 ≤ ${r.profile.dailyMinutes} 分钟 · Keep going!`
      : "去「我的目标」填参数 · Keep going!";
  }

  if (!n) {
    el.textContent = "计划待设置";
    el.classList.remove("badge-orange");
    el.classList.add("badge-gray");
    return;
  }
  if (status === "before") {
    el.textContent = `未开始 / 共 ${n} 周`;
    el.classList.remove("badge-orange");
    el.classList.add("badge-gray");
  } else if (status === "after") {
    el.textContent = `已结束 / 共 ${n} 周`;
    el.classList.remove("badge-orange");
    el.classList.add("badge-gray");
  } else {
    el.textContent = `第 ${currentWeek()} 周 / 共 ${n} 周`;
    el.classList.add("badge-orange");
    el.classList.remove("badge-gray");
  }
}

/* ===================== 里程碑完成状态 ===================== */
// 按「源里程碑 id」记，不按周号 —— 周号会随考试日期漂移，
// 换个考试日期旧勾就会静默挂到完全不同的内容上。
function milestoneSourceIds(m) {
  if (m.kind === "review") return [m.id];
  return m.sources.map(i => "m" + (i + 1));
}
function isMilestoneDone(m) {
  const ids = milestoneSourceIds(m);
  return ids.length > 0 && ids.every(id => state.doneMilestones.includes(id));
}
function toggleMilestone(m) {
  const ids = milestoneSourceIds(m);
  if (isMilestoneDone(m)) {
    state.doneMilestones = state.doneMilestones.filter(x => !ids.includes(x));
  } else {
    ids.forEach(id => { if (!state.doneMilestones.includes(id)) state.doneMilestones.push(id); });
  }
  saveDoneMilestones();
}

/* ===================== 模块 1：目标看板 ===================== */
function renderGoal() {
  const r = Plan.get();
  if (!r.ok) {
    $("#content").innerHTML = `
      <div class="section-header"><h2>目标看板</h2></div>
      ${planNotReadyHTML()}`;
    bindGoalEvents();
    return;
  }

  const p = r.profile;
  const cw = currentWeek();
  const status = planStatus();
  const doneCount = r.milestones.filter(isMilestoneDone).length;
  const totalWeeks = r.milestones.length;
  const progressPct = totalWeeks ? Math.round((doneCount / totalWeeks) * 100) : 0;

  const smartLabels = [
    { k: "S", label: "具体 Specific", desc: r.smart.S, accent: false },
    { k: "M", label: "可衡量 Measurable", desc: r.smart.M, accent: false },
    { k: "A", label: "可实现 Achievable", desc: r.smart.A, accent: true },
    { k: "R", label: "相关性 Relevant", desc: r.smart.R, accent: false },
    { k: "T", label: "有时限 Time-bound", desc: r.smart.T, accent: true },
  ];

  const smartHTML = smartLabels.map(s => `
    <div class="smart-card ${s.accent ? "accent" : ""}">
      <div class="smart-letter">${s.k}</div>
      <div class="smart-label">${s.label}</div>
      <div class="smart-desc">${esc(s.desc)}</div>
    </div>`).join("");

  const milestoneHTML = r.milestones.map(m => {
    const isCurrent = status === "active" && m.week === cw;
    const isDone = isMilestoneDone(m);
    const isPast = status === "active" && m.week < cw;
    const cls = isDone ? "done" : isCurrent ? "current" : isPast ? "past" : "";
    const kindTag = m.kind === "compressed" ? `<span class="badge badge-orange">压缩覆盖 ${m.sources.length} 个主题</span>`
      : m.kind === "review" ? `<span class="badge badge-gray">复习加练</span>` : "";
    return `
      <div class="milestone ${cls}" data-milestone-week="${m.week}" title="点击标记完成/取消">
        <div class="milestone-week">${isDone ? "✓" : "W" + m.week}</div>
        <div class="milestone-body">
          <div class="milestone-title">${esc(m.title)}</div>
          <div class="milestone-target">${esc(m.target)}</div>
          <div class="milestone-meta">
            ${kindTag}
            <span class="milestone-phase">${esc(m.phaseName)}</span>
          </div>
        </div>
      </div>`;
  }).join("");

  const statusNote = status === "active"
    ? `本周是第 ${cw} 周，重点：${esc((Plan.milestoneAt(cw) || {}).title || "—")}`
    : status === "before"
      ? `计划将于 ${esc(r.startDate)} 开始，共 ${r.weeks} 周`
      : `计划已于 ${esc(r.endDate)} 结束，共 ${r.weeks} 周`;

  const studyDays = totalStudyDays();
  const streak = currentStreak();

  // 分数三格并列：目标低于过线线时把过线线也摆出来，用事实陈述而非说教
  const passCell = r.belowPass ? `
      <div class="goal-stat">
        <div class="goal-stat-label">公认过线线</div>
        <div class="goal-stat-value gray">${r.passScore}</div>
        <div class="goal-stat-sub">满分 ${r.fullScore} · 也是报考六级的门槛</div>
        <button class="btn" data-set-goal="${r.passScore}" style="margin-top:var(--s-3);">把目标改成 ${r.passScore}</button>
      </div>` : `
      <div class="goal-stat">
        <div class="goal-stat-label">超出过线线</div>
        <div class="goal-stat-value gray">+${r.goalScore - r.passScore}</div>
        <div class="goal-stat-sub">过线线 ${r.passScore} · 满分 ${r.fullScore}</div>
      </div>`;

  const warnHTML = r.warnings.length
    ? `<div class="card" style="margin-bottom:var(--s-6);">
        <div class="week-progress-head"><strong>计划说明</strong><span>都是按你填的参数算出来的</span></div>
        <ul class="cram-list">${r.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      </div>` : "";

  $("#content").innerHTML = `
    <div class="section-header">
      <h2>目标看板</h2>
      <p>整份计划都根据你在「我的目标」里填的参数推导：${r.weeks} 周、每天 ${p.dailyMinutes} 分钟、重点 ${esc(p.weakSkills.join("、") || "未指定")}。</p>
    </div>

    ${planNotReadyHTML()}
    ${warnHTML}

    <div class="goal-overview">
      <div class="goal-stat">
        <div class="goal-stat-label">当前分数</div>
        <div class="goal-stat-value">${esc(String(p.startScore))}</div>
        <div class="goal-stat-sub">四级模考 / 预估</div>
      </div>
      <div class="goal-stat">
        <div class="goal-stat-label">目标分数</div>
        <div class="goal-stat-value orange">${esc(String(p.goalScore))}</div>
        <div class="goal-stat-sub">${esc(p.examDate)} 考试 · 缺口 ${r.gap} 分</div>
        <div class="progress"><div class="progress-bar orange" style="width:${progressPct}%"></div></div>
      </div>
      ${passCell}
    </div>

    <div class="goal-overview" style="margin-top:calc(var(--s-5) * -1);">
      <div class="goal-stat">
        <div class="goal-stat-label">已完成里程碑</div>
        <div class="goal-stat-value">${doneCount}<span style="font-size:var(--fs-lg);color:var(--text-sub)">/${totalWeeks}</span></div>
        <div class="goal-stat-sub">整体进度 ${progressPct}%</div>
        <div class="progress"><div class="progress-bar" style="width:${progressPct}%"></div></div>
      </div>
      <div class="goal-stat">
        <div class="goal-stat-label">累计学习天数</div>
        <div class="goal-stat-value">${studyDays}</div>
        <div class="goal-stat-sub">有实际学习记录的天数</div>
      </div>
      <div class="goal-stat">
        <div class="goal-stat-label">连续打卡</div>
        <div class="goal-stat-value orange">${streak}</div>
        <div class="goal-stat-sub">天 · 今天打卡即可延续</div>
      </div>
    </div>

    <div class="section-header" style="margin-top:var(--s-8);">
      <h2>SMART 目标拆解</h2>
      <p>这五段是根据你填的分数、考试日期、每日时长和薄弱项自动重写的，改参数就会跟着变。</p>
    </div>
    <div class="smart-grid">${smartHTML}</div>

    <div class="section-header" style="margin-top:var(--s-8);">
      <h2>${r.weeks} 周里程碑</h2>
      <p>${statusNote}</p>
    </div>
    <div class="card">
      <div class="timeline">${milestoneHTML}</div>
    </div>

    <div class="plan-summary">
      <div class="plan-summary-item"><span>每周词量</span><strong>约 ${r.weeklyWords} 词</strong>
        <em>来自每天 ${r.profile.dailyMinutes} 分钟里分给词汇的部分 ÷ ${WORD_COST[r.profile.intensity]} 分钟/词</em></div>
      <div class="plan-summary-item"><span>预计覆盖</span><strong>${r.vocab.capacity} 词</strong>
        <em>${r.vocab.feasible ? "够达到你设的目标词量" : `距离目标词量 ${r.vocab.gapWords} 词还差 ${r.vocab.gapWords - r.vocab.capacity} 词`}</em></div>
      <div class="plan-summary-item"><span>词库支撑</span><strong>${r.vocab.coverageWeeks} 周</strong>
        <em>词库现有 ${r.vocab.poolSize} 词，第 ${r.vocab.coverageWeeks + 1} 周起需要自己导入真题生词</em></div>
    </div>

    <div class="quiz-actions" style="margin-top:var(--s-6);">
      <button class="btn btn-primary" data-goto-profile>修改我的目标</button>
      <button class="btn" data-goto="quiz">去背单词测验</button>
    </div>
  `;

  bindGoalEvents();
}

function bindGoalEvents() {
  $$("[data-milestone-week]").forEach(el => {
    el.addEventListener("click", () => {
      const w = parseInt(el.dataset.milestoneWeek, 10);
      const m = Plan.milestoneAt(w);
      if (!m) return;
      toggleMilestone(m);
      renderGoal();
    });
  });
  $$("[data-goto-profile]").forEach(b => b.addEventListener("click", () => switchModule("profile")));
  $$("[data-goto]").forEach(b => b.addEventListener("click", () => switchModule(b.dataset.goto)));
  $$("[data-set-goal]").forEach(b => b.addEventListener("click", () => {
    setProfile({ goalScore: parseInt(b.dataset.setGoal, 10) });
    toast(`目标分数已改为 ${b.dataset.setGoal}`, "success");
    updateWeekBadge();
    renderGoal();
  }));
}

/* ===================== 模块 2：每日任务卡 ===================== */
function renderTasks() {
  const r = Plan.get();
  if (!r.ok) {
    $("#content").innerHTML = `<div class="section-header"><h2>每日任务卡</h2></div>${planNotReadyHTML()}`;
    bindGoalEvents();
    return;
  }

  const p = r.profile;
  const today = todayStr();
  const thisMonday = weekStart(today);
  const offset = state.taskWeekOffset || 0;
  const monday = dateAdd(thisMonday, offset * 7);
  const dayIdx = Math.max(0, Math.min(6, state.taskDayIdx));

  const dates = r.weekTasks.map((_, i) => dateAdd(monday, i));
  const viewDate = dates[dayIdx];
  const day = r.weekTasks[dayIdx];
  const isFuture = dateDiff(today, viewDate) > 0;
  const weekLabel = offset === 0 ? "本周" : offset === -1 ? "上周" : `${-offset} 周前`;

  const tabsHTML = r.weekTasks.map((d, i) => {
    const isToday = dates[i] === today;
    const doneN = d.slots.filter((s, si) => isTaskChecked(dates[i], i, s, si)).length;
    const allDone = d.slots.length > 0 && doneN === d.slots.length;
    return `<button class="task-tab ${i === dayIdx ? "active" : ""} ${isToday ? "today" : ""} ${allDone ? "all-done" : ""}" data-day="${i}">
      ${esc(d.day)}${isToday ? " ·今天" : ""}
    </button>`;
  }).join("");

  const slotsHTML = day.slots.map((s, i) => {
    const checked = isTaskChecked(viewDate, dayIdx, s, i);
    return `
      <div class="task-row ${checked ? "done" : ""}">
        <div class="task-time">${esc(s.time)}</div>
        <div class="task-content">${esc(s.content)}</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span class="task-type ${esc(s.type)}">${esc(s.type)}${s.ext ? " ·加" : ""}</span>
          <button class="check-btn ${checked ? "checked" : ""}" data-task-idx="${i}"
                  ${isFuture ? "disabled" : ""} aria-label="打卡"
                  title="${isFuture ? "未来日期不能打卡" : "点击打卡"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
      </div>`;
  }).join("");

  const doneCount = day.slots.filter((s, i) => isTaskChecked(viewDate, dayIdx, s, i)).length;
  const dayPct = day.slots.length ? Math.round((doneCount / day.slots.length) * 100) : 0;

  const weekTotal = r.weekTasks.reduce((a, d) => a + d.slots.length, 0);
  const weekDone = dates.reduce((sum, d, di) =>
    sum + r.weekTasks[di].slots.filter((s, si) => isTaskChecked(d, di, s, si)).length, 0);
  const weekPct = weekTotal ? Math.round((weekDone / weekTotal) * 100) : 0;

  const noteHTML = day.reason
    ? `<div class="inline-note">本日合计 ${day.minutes} 分钟（你设的是 ${p.dailyMinutes} 分钟）：${esc(day.reason)}</div>`
    : "";

  $("#content").innerHTML = `
    <div class="section-header">
      <h2>每日任务卡</h2>
      <p>按你设的「每天 ${p.dailyMinutes} 分钟」和薄弱项（${esc(p.weakSkills.join("、") || "未指定")}）自动排的。
         打卡按真实日期记录，可以回补最近 7 天。</p>
    </div>

    <div class="week-nav">
      <button class="btn" id="taskPrevWeek" ${offset <= -8 ? "disabled" : ""}>← 上一周</button>
      <div class="week-nav-label">
        <strong>${weekLabel}</strong>
        <span>${esc(monday)} ~ ${esc(dateAdd(monday, 6))}</span>
      </div>
      <button class="btn" id="taskNextWeek" ${offset >= 0 ? "disabled" : ""}>下一周 →</button>
      ${offset !== 0 ? `<button class="btn btn-accent" id="taskThisWeek">回到本周</button>` : ""}
    </div>

    <div class="task-tabs">${tabsHTML}</div>

    <div class="task-day-card">
      <div class="task-day-header">
        <div>
          <div class="task-day-name">${esc(day.day)} <span class="task-day-date">${esc(viewDate)}${viewDate === today ? " · 今天" : ""}</span></div>
          <div class="task-day-focus">今日重点：${esc(day.focus)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:var(--fs-sm);color:var(--text-sub);">当日完成</div>
          <div style="font-family:var(--font-display);font-size:var(--fs-xl);font-weight:700;color:var(--primary);">${doneCount}/${day.slots.length}</div>
        </div>
      </div>
      <div style="margin-bottom:var(--s-5);">
        <div class="progress"><div class="progress-bar" style="width:${dayPct}%"></div></div>
      </div>
      ${isFuture ? `<div class="inline-note">这是未来的日期，还不能打卡。回到今天或更早的日期吧。</div>` : ""}
      ${noteHTML}
      ${slotsHTML || '<div class="empty-state">这一天没有排任务</div>'}
    </div>

    <div class="card" style="margin-top:var(--s-6);">
      <div class="week-progress-head">
        <strong>${weekLabel}整体完成</strong>
        <span>${weekDone}/${weekTotal}（${weekPct}%）</span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${weekPct}%"></div></div>
      <div class="week-strip">
        ${dates.map((d, i) => {
          const t = r.weekTasks[i].slots.length;
          const dn = r.weekTasks[i].slots.filter((s, si) => isTaskChecked(d, i, s, si)).length;
          const pct = t ? Math.round((dn / t) * 100) : 0;
          return `<div class="week-strip-day ${d === today ? "today" : ""}" title="${esc(d)} ${dn}/${t}">
            <div class="week-strip-bar"><div style="height:${pct}%"></div></div>
            <span>${esc(r.weekTasks[i].day.slice(1))}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;

  $$(".check-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (isFuture) return;
      const i = parseInt(btn.dataset.taskIdx, 10);
      const s = day.slots[i];
      setTaskChecked(viewDate, dayIdx, s, i, !isTaskChecked(viewDate, dayIdx, s, i));
      renderStreak();
      renderTasks();
    });
  });
  $$(".task-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      state.taskDayIdx = parseInt(tab.dataset.day, 10);
      renderTasks();
    });
  });
  const prev = $("#taskPrevWeek");
  if (prev) prev.addEventListener("click", () => { state.taskWeekOffset = offset - 1; renderTasks(); });
  const next = $("#taskNextWeek");
  if (next) next.addEventListener("click", () => { state.taskWeekOffset = Math.min(0, offset + 1); renderTasks(); });
  const back = $("#taskThisWeek");
  if (back) back.addEventListener("click", () => {
    state.taskWeekOffset = 0;
    state.taskDayIdx = weekdayIdx(todayStr());
    renderTasks();
  });
}

/* ===================== 模块 3：素材库 ===================== */
function renderMaterials() {
  const r = Plan.get();
  if (!r.ok) {
    $("#content").innerHTML = `<div class="section-header"><h2>素材库</h2></div>${planNotReadyHTML()}`;
    bindGoalEvents();
    return;
  }

  const p = r.profile;
  const n = r.weeks;
  const filter = state.materialFilter === "all" ? "all" : String(Math.max(1, Math.min(n, parseInt(state.materialFilter, 10) || 1)));
  state.materialFilter = filter;

  const filterBtns = `<button class="task-tab ${filter === "all" ? "active" : ""}" data-mat-filter="all">全部</button>` +
    Array.from({ length: n }, (_, i) => i + 1).map(w =>
      `<button class="task-tab ${filter === String(w) ? "active" : ""}" data-mat-filter="${w}">第 ${w} 周</button>`).join("");

  const weeks = filter === "all" ? r.materials : r.materials.filter(w => w.week === parseInt(filter, 10));
  const cw = currentWeek();

  const cardsHTML = weeks.map(w => w.items.map(m => `
    <div class="material-card ${w.week === cw && planStatus() === "active" ? "current" : ""} ${m.fallback ? "is-fallback" : ""}">
      <div class="material-top">
        <span class="material-week">第 ${w.week} 周${w.week === cw && planStatus() === "active" ? " · 本周" : ""}</span>
        <span class="material-type">${esc(m.type)} · ${esc(m.format)}${m.pass > 1 ? ` · 第 ${m.pass} 遍` : ""}</span>
      </div>
      <div class="material-title">${esc(m.title)}</div>
      ${m.level ? `<div class="material-level">难度：${esc(m.level)}</div>` : ""}
      <div class="material-reason">${esc(m.reason)}</div>
      <div class="material-how"><strong>怎么用：</strong>${esc(m.howToUse)}</div>
      <div class="material-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        ${esc(m.link)}
      </div>
    </div>`).join("")).join("");

  const interestNote = p.interests.length
    ? `已按你选的兴趣（${esc(p.interests.join("、"))}）排序 —— 匹配的排前面。不会硬性过滤掉其他素材，否则某一类会出现空档。`
    : `你还没选兴趣，全部素材按难度和循环顺序排。去「我的目标」勾选兴趣可以调整顺序。`;

  $("#content").innerHTML = `
    <div class="section-header">
      <h2>素材库</h2>
      <p>${interestNote}</p>
    </div>
    <div class="material-filters">${filterBtns}</div>
    <div class="material-grid">${cardsHTML || '<div class="empty-state">该周暂无素材</div>'}</div>
  `;

  $$("[data-mat-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.materialFilter = btn.dataset.matFilter;
      renderMaterials();
    });
  });
}

/* ===================== 模块 4：复盘日志 ===================== */
function renderReview() {
  const r = Plan.get();
  if (!r.ok) {
    $("#content").innerHTML = `<div class="section-header"><h2>复盘日志</h2></div>${planNotReadyHTML()}`;
    bindGoalEvents();
    return;
  }

  const n = r.weeks;
  const cw = currentWeek();

  // 原来这里是 `if (!state.reviews[state.currentReviewWeek]) state.currentReviewWeek = cw;`
  // —— 点任何一个还没写过的周都会被立刻弹回本周，于是永远写不了过去某周的复盘。
  if (state.currentReviewWeek == null) state.currentReviewWeek = cw;
  state.currentReviewWeek = Math.max(1, Math.min(n, state.currentReviewWeek));

  const w = state.currentReviewWeek;
  const cur = Plan.milestoneAt(w);

  const weekItems = r.milestones.map(m => {
    const isCur = m.week === w;
    const isDone = state.reviews[m.week] && state.reviews[m.week].done;
    return `<div class="review-week ${isCur ? "current" : isDone ? "done" : ""}" data-week="${m.week}">
      <div class="review-week-num">W${m.week}</div>
      <div class="review-week-status">${isDone ? "已复盘" : m.week === cw && planStatus() === "active" ? "本周" : "未开始"}</div>
    </div>`;
  }).join("");

  const review = state.reviews[w] || { done: "", stuck: "", next: "" };
  const mStart = dateAdd(r.startDate, (w - 1) * 7);
  const mEnd = dateAdd(mStart, 6);

  const questionsHTML = reviewTemplate.questions.map((q, i) => `
    <div class="review-question">
      <div class="review-q-label"><span class="review-q-num">${i + 1}</span>${esc(q.label)}</div>
      <textarea class="review-textarea" data-q="${esc(q.key)}" placeholder="${esc(q.placeholder)}">${esc(review[q.key] || "")}</textarea>
    </div>`).join("");

  // 计划变短后，超出范围的旧复盘不能就此消失
  const archived = Object.keys(state.reviews)
    .map(Number)
    .filter(x => x > n && state.reviews[x] && state.reviews[x].done)
    .sort((a, b) => a - b);
  const archivedHTML = archived.length ? `
    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>已归档的复盘</strong>
        <span>这些周已不在当前计划范围内（计划缩短了），内容仍然保留</span></div>
      ${archived.map(x => {
        const a = state.reviews[x];
        return `<div class="attempt-row">
          <div><strong>第 ${x} 周</strong>
            <span class="attempt-meta">${esc(a.topic || "（当时未记录主题）")} · 保存于 ${esc(a.savedAt || "未知日期")}</span></div>
          <div class="attempt-actions"><button class="btn" data-archived="${x}">查看</button></div>
        </div>`;
      }).join("")}
    </div>` : "";

  $("#content").innerHTML = `
    <div class="section-header">
      <h2>复盘日志</h2>
      <p>每周花 15 分钟填三个问题。内容存在本地，导出备份可一并带走。</p>
    </div>

    <div class="review-calendar">${weekItems}</div>

    <div class="review-form">
      <div class="review-form-title">第 ${w} 周复盘</div>
      <div class="review-form-sub">${esc(mStart)} ~ ${esc(mEnd)} · 本周重点：${esc(cur ? cur.title : "—")}</div>
      ${questionsHTML}
      <div class="review-actions">
        <button class="btn" id="btnClearReview">清空</button>
        <button class="btn btn-primary" id="btnSaveReview">保存复盘</button>
      </div>
      <div class="review-saved-note" id="savedNote">✓ 已保存到本地，刷新不丢失</div>
    </div>
    ${archivedHTML}
  `;

  $$(".review-week").forEach(el => {
    el.addEventListener("click", () => {
      state.currentReviewWeek = parseInt(el.dataset.week, 10);
      renderReview();
    });
  });

  $("#btnSaveReview").addEventListener("click", () => {
    const data = {};
    reviewTemplate.questions.forEach(q => {
      const el = $(`[data-q="${q.key}"]`);
      data[q.key] = el ? el.value.trim() : "";
    });
    data.done = data.done || "";
    data.saved = true;
    data.savedAt = todayStr();
    // 存入当时的主题快照 —— 否则改了考试日期后，旧复盘会「挂到」完全不同的主题上
    data.topic = cur ? cur.title : "";
    state.reviews[w] = data;
    saveJSON(STORAGE_KEYS.reviews, state.reviews);
    const note = $("#savedNote");
    note.classList.add("show");
    setTimeout(() => note.classList.remove("show"), 2500);
    toast("复盘已保存", "success");
  });

  $("#btnClearReview").addEventListener("click", () => {
    if (confirm(`确定清空第 ${w} 周的复盘内容吗？`)) {
      delete state.reviews[w];
      saveJSON(STORAGE_KEYS.reviews, state.reviews);
      renderReview();
    }
  });

  $$("[data-archived]").forEach(b => b.addEventListener("click", () => {
    const x = parseInt(b.dataset.archived, 10);
    const a = state.reviews[x];
    if (!a) return;
    chooseDialog({
      title: `第 ${x} 周复盘（已归档）`,
      message: `<p class="dialog-quote">${esc(a.topic || "（当时未记录主题）")}</p>
        ${reviewTemplate.questions.map(q => `<p><strong>${esc(q.label)}</strong><br>${esc(a[q.key] || "（空）")}</p>`).join("")}`,
      buttons: [{ label: "关闭", value: null, cls: "btn-primary" }],
    });
  }));
}

/* ===================== 模块切换 ===================== */
function switchModule(mod) {
  state.module = mod;
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.module === mod));

  const titleEl = $("#pageTitle");
  let ok = false;
  try {
    ok = Modules.render(mod);
  } catch (err) {
    console.error(`[switchModule] 模块「${mod}」渲染出错：`, err);
    ok = false;
  }

  if (!ok) {
    titleEl.textContent = mod || "未知模块";
    $("#content").innerHTML = `
      <div class="section-header"><h2>模块未加载</h2></div>
      <div class="card"><div class="empty-state">
        「${esc(mod)}」这个模块没有注册成功。<br>
        通常是脚本加载顺序不对或某个 .js 文件报错了 —— 按 F12 看 Console 里的第一条红色错误。
      </div></div>`;
  } else {
    titleEl.textContent = Modules.title(mod);
  }

  Speak.stop();
  $("#sidebar").classList.remove("open");
  $("#sidebarBackdrop").classList.remove("show");
}

/* ===================== 各模块注册 ===================== */
Modules.register("goal", { title: "目标看板", render: renderGoal, order: 1 });
Modules.register("tasks", { title: "每日任务卡", render: renderTasks, order: 2 });
Modules.register("materials", { title: "素材库", render: renderMaterials, order: 5 });
Modules.register("review", { title: "复盘日志", render: renderReview, order: 8 });

/* ===================== 初始化 ===================== */
function init() {
  migrate();

  $("#dateBadge").textContent = fmtDate(new Date());
  updateWeekBadge();

  $$(".nav-item").forEach(n => {
    n.addEventListener("click", () => switchModule(n.dataset.module));
  });

  $("#menuToggle").addEventListener("click", () => {
    $("#sidebar").classList.add("open");
    $("#sidebarBackdrop").classList.add("show");
  });
  $("#sidebarBackdrop").addEventListener("click", () => {
    $("#sidebar").classList.remove("open");
    $("#sidebarBackdrop").classList.remove("show");
  });

  Modules.initAll();

  renderStreak();
  switchModule("goal");

  Speak.loadVoices(2000).then(v => {
    document.body.dataset.tts = (v && v.length) ? "ok" : "none";
  }).catch(() => { document.body.dataset.tts = "none"; });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      $$(".modal-overlay.show").forEach(m => m.classList.remove("show"));
      Speak.stop();
    }
  });

  window.addEventListener("beforeunload", () => Speak.stop());
}

function renderStreak() {
  const el = $("#streakNum");
  if (el) el.textContent = currentStreak();
}

// 画像变了以后，所有与计划相关的显示都要刷新
function refreshPlanViews() {
  updateWeekBadge();
  renderStreak();
  switchModule(state.module || "goal");
}

init();
