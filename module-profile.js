// module-profile.js — 「我的目标」模块
// 用户在这里填分数、考试日期、每天能投入多久、哪几项弱、兴趣是什么。
// 目标看板 / 每日任务卡 / 素材库 / 复盘日志 全部由这些参数推导（见 plan.js）。
// 自注册为 "profile"。

let profileDraft = null;
let commitTimer = null;

function draft() {
  if (!profileDraft) profileDraft = getProfile();
  return profileDraft;
}

/* ===================== 渲染 ===================== */
function renderProfile() {
  const p = draft();
  const interests = interestOptions();
  const errs = profileErrors(p);

  const num = (f, label, hint, extra = "") => `
    <div class="form-row">
      <label>${esc(label)}</label>
      <input type="number" data-field="${f}" value="${esc(String(p[f]))}" ${extra} />
      ${hint ? `<div class="form-hint">${hint}</div>` : ""}
      ${errs[f] ? `<div class="form-error">${esc(errs[f])}</div>` : ""}
    </div>`;

  const dateRow = (f, label, hint) => `
    <div class="form-row">
      <label>${esc(label)}</label>
      <input type="date" data-field="${f}" value="${esc(p[f])}" />
      ${hint ? `<div class="form-hint">${hint}</div>` : ""}
      ${errs[f] ? `<div class="form-error">${esc(errs[f])}</div>` : ""}
    </div>`;

  const weakHTML = WEAK_OPTIONS.map(t => `
    <label class="pill ${p.weakSkills.includes(t) ? "on" : ""}">
      <input type="checkbox" data-weak="${esc(t)}" ${p.weakSkills.includes(t) ? "checked" : ""} />
      ${esc(t)}
    </label>`).join("");

  const interestHTML = interests.map(t => `
    <label class="pill ${p.interests.includes(t) ? "on" : ""}">
      <input type="checkbox" data-interest="${esc(t)}" ${p.interests.includes(t) ? "checked" : ""} />
      ${esc(t)}
    </label>`).join("");

  const intensityHTML = INTENSITY_OPTIONS.map(o => `
    <label class="quiz-mode ${p.intensity === o.key ? "active" : ""}" data-intensity="${o.key}">
      <strong>${esc(o.name)}</strong>
      <span>${esc(o.desc)}</span>
    </label>`).join("");

  $("#content").innerHTML = `
    <div class="section-header">
      <h2>我的目标</h2>
      <p>这里填的每一项都会真的改变计划：周数、里程碑、每天的任务、素材顺序，以及 SMART 那五段文案。
         右边（下面）的预览会立刻跟着变，每个数字都标注了它怎么算出来的。</p>
    </div>

    <div class="profile-layout">
      <div class="card profile-form">
        <div class="week-progress-head"><strong>基本信息</strong></div>
        <div class="form-row">
          <label>称呼</label>
          <input type="text" data-field="name" value="${esc(p.name)}" />
        </div>
        <div class="form-row">
          <label>年级</label>
          <input type="text" data-field="grade" value="${esc(p.grade)}" />
        </div>

        <div class="week-progress-head" style="margin-top:var(--s-6);"><strong>分数与考试</strong></div>
        ${num("startScore", "当前分数", `四级笔试满分 ${FULL_SCORE}，公认过线线 ${PASS_SCORE}`, 'min="0" max="710"')}
        ${num("goalScore", "目标分数", "", 'min="1" max="710"')}
        ${dateRow("examDate", "考试日期", "默认 2026-12-12（周六）。改这里，整个计划的时间线会重排。")}
        ${dateRow("planStart", "计划起始日", "会自动对齐到那一周的周一，避免「第 N 周」在不同界面之间对不上。")}

        <div class="week-progress-head" style="margin-top:var(--s-6);"><strong>时间与词汇</strong></div>
        ${num("dailyMinutes", "每天可投入（分钟）", "每日任务卡上的任务会按这个数字伸缩，文案里的数量也会跟着改。", 'min="5" max="240" step="5"')}
        ${num("vocabNow", "当前词汇量（估计）", "四级核心词约 4500 个。不用很准，估个量级就行。", 'min="0" max="10000" step="50"')}
        ${num("vocabTarget", "目标词汇量", "这个数字决定「时间够不够用」的判断。", 'min="0" max="10000" step="50"')}
        ${num("selfAccuracy", "当前听力/阅读正确率（自评 %）", "这个没有别的数据来源，只能靠你估。计划会按时长推算目标正确率。", 'min="0" max="100" step="5"')}

        <div class="week-progress-head" style="margin-top:var(--s-6);"><strong>词汇学习强度</strong></div>
        <div class="quiz-modes" id="intensityPicker">${intensityHTML}</div>

        <div class="week-progress-head" style="margin-top:var(--s-6);"><strong>薄弱项（可多选）</strong>
          <span>选中的项每周至少练一次，且不会被削减时间</span></div>
        <div class="pill-row">${weakHTML}</div>
        <div class="inline-note" style="font-size:var(--fs-xs);">
          口语不计入四级笔试总分（CET-SET 是单独选考），所以计划会自动给它较低的时间权重 ——
          否则它会挤掉真正影响过线的听力、阅读时间。想全力冲分可以取消勾选。
        </div>

        <div class="week-progress-head" style="margin-top:var(--s-6);"><strong>兴趣（可多选）</strong>
          <span>只影响素材排序，不会过滤掉其他素材</span></div>
        <div class="pill-row">${interestHTML || '<span class="form-hint">素材库里没有可识别的类型</span>'}</div>
        ${p.interests.length === 0 ? '<div class="form-hint">不选 = 不限，按难度循环排。</div>' : ""}

        <div class="week-progress-head" style="margin-top:var(--s-8);"><strong>重置</strong>
          <span>三个选项作用范围不同，都不会影响另一个范围</span></div>
        <div class="reset-list">
          <div class="reset-row">
            <div>
              <strong>恢复默认设置</strong>
              <em>只把上面的计划参数恢复成默认值。打卡、单词、测验记录一条不动。</em>
            </div>
            <button class="btn" id="profileReset">恢复默认</button>
          </div>
          <div class="reset-row">
            <div>
              <strong>清空学习记录</strong>
              <em>清掉打卡、单词卡、测验与错题、复盘、练习作答、里程碑进度 ——
                  但<strong>保留</strong>你填的目标分数、考试日期、每天时长、薄弱项和兴趣，不用重填。</em>
            </div>
            <button class="btn" id="resetDataOnly">清空记录</button>
          </div>
          <div class="reset-row danger">
            <div>
              <strong>恢复出厂设置</strong>
              <em>连计划参数一起清掉，回到刚打开这个页面的样子。做了这么久的记录会全部消失，
                  <strong>建议先到「学习统计 → 数据备份」导出一次</strong>。</em>
            </div>
            <button class="btn btn-danger" id="resetFactory">恢复出厂设置</button>
          </div>
        </div>
      </div>

      <div id="profilePreview">${previewHTML()}</div>
    </div>
  `;

  bindProfileEvents();
}

/* ===================== 预览：每个数字都带算式 ===================== */
function previewHTML() {
  const r = Plan.get();

  if (!r.ok) {
    if (r.reason === "tooShort") {
      return `<div class="card profile-preview">
        <div class="week-progress-head"><strong>算不出计划</strong></div>
        <div class="inline-note warn">
          距考试只剩 <strong>${esc(String(r.rawWeeks))} 周</strong>，不足 ${MIN_WEEKS} 周。
          这个跨度再排"周里程碑"只是自我安慰，所以本工具不生成计划 ——
          目标看板会改为给你一张考前冲刺清单。
        </div>
      </div>`;
    }
    const errs = Object.values(r.errors || {});
    return `<div class="card profile-preview">
      <div class="week-progress-head"><strong>参数还有问题</strong></div>
      <ul class="cram-list">${errs.map(e => `<li>${esc(e)}</li>`).join("")}</ul>
    </div>`;
  }

  const p = r.profile;
  const v = r.vocab;
  const cost = WORD_COST[p.intensity];
  const cur = Plan.milestoneAt(currentWeek());

  const rows = [
    { label: "计划周数", value: `${r.weeks} 周`,
      why: `从 ${r.startDate} 到考试前一天 ${r.endDate}，每 7 天一周、向上取整（不足一周也算一周）` },
    { label: "起止", value: `${r.startDate} ~ ${r.endDate}`,
      why: `起始日已对齐到周一；结束日 = 起始日 + ${r.weeks}×7 − 1 天` },
    { label: "分数缺口", value: `${r.gap} 分`,
      why: `目标 ${p.goalScore} − 当前 ${p.startScore}` },
    ...(r.belowPass ? [{ label: "过线线", value: `${r.passScore} 分`,
      why: `你设的目标低于公认过线线 ${r.passScore}（满分 ${r.fullScore}）。按过线算缺口是 ${r.passScore - p.startScore} 分` }] : []),
    { label: "每周词量", value: `约 ${r.weeklyWords} 词`,
      why: `每周分给词汇的时间 ${r.weeklyVocabMinutes} 分钟 ÷ ${cost} 分钟/词（${INTENSITY_OPTIONS.find(o => o.key === p.intensity).name}强度）` },
    { label: "每天词量", value: `约 ${Math.round(r.wordsPerDay)} 词`,
      why: `每周 ${r.weeklyWords} 词 ÷ 一周里真正学新词的天数` },
    { label: "计划可覆盖", value: `${v.capacity} 词`,
      why: `每周 ${r.weeklyWords} 词 × ${r.weeks} 周` },
    { label: "目标词量缺口", value: `${v.gapWords} 词`,
      why: `目标 ${p.vocabTarget} − 当前 ${p.vocabNow}` },
    { label: "本周重点", value: cur ? cur.title : "—",
      why: cur ? `第 ${currentWeek()} 周对应的里程碑（${cur.phaseName}）` : "" },
  ];

  const rowsHTML = rows.map(x => `
    <div class="preview-row">
      <div class="preview-row-top"><span>${esc(x.label)}</span><strong>${esc(x.value)}</strong></div>
      ${x.why ? `<div class="preview-why">${esc(x.why)}</div>` : ""}
    </div>`).join("");

  // 任务条数预览
  const dayPreview = r.weekTasks.map(d => `
    <div class="preview-day">
      <span>${esc(d.day)}</span>
      <div class="preview-day-slots">${d.slots.map(s =>
        `<span class="preview-slot ${p.weakSkills.includes(s.type) ? "weak" : ""}">${esc(s.type)} ${s.minutes}′</span>`).join("")}</div>
      <em>${d.minutes}′${d.leftover ? `（余 ${d.leftover}）` : ""}</em>
    </div>`).join("");

  const feasibleHTML = v.feasible
    ? `<div class="inline-note"><strong>词量够用：</strong>计划能覆盖约 ${v.capacity} 词，你设的缺口是 ${v.gapWords} 词。</div>`
    : `<div class="inline-note warn">
        <strong>词量不够：</strong>计划大约能覆盖 ${v.capacity} 词，而你的目标是 ${v.gapWords} 词，差 ${v.gapWords - v.capacity} 词。
        这不是算错了，是算术 —— 按现在的时间投入补不上。下面有几种改法。
      </div>
      <div class="quiz-actions" style="margin-top:var(--s-3);">
        <button class="btn btn-primary" id="fixTarget">把目标词量改成 ${p.vocabNow + v.capacity}</button>
        <button class="btn" id="fixMinutes">看看要多少时间</button>
      </div>`;

  const warnHTML = r.warnings.length
    ? `<ul class="cram-list" style="margin-top:var(--s-4);">${r.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>`
    : "";

  return `
    <div class="card profile-preview">
      <div class="week-progress-head"><strong>实时预览</strong><span>改左边的参数会立刻重算</span></div>
      ${rowsHTML}
      ${feasibleHTML}
      ${warnHTML}
    </div>
    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>每日任务会变成这样</strong>
        <span>标橙色的是你选的弱项，时间不会被削减</span></div>
      <div class="preview-days">${dayPreview}</div>
    </div>
    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>里程碑会这样重排</strong>
        <span>共 ${r.weeks} 周：完整 / 压缩 / 复习 加练</span></div>
      <div class="preview-milestones">
        ${r.milestones.map(m => `
          <div class="preview-ms ${m.kind}">
            <span class="preview-ms-w">W${m.week}</span>
            <span class="preview-ms-t">${esc(m.title)}</span>
            <span class="preview-ms-k">${m.kind === "full" ? "完整" : m.kind === "compressed" ? `压缩${m.sources.length}` : "复习"}</span>
          </div>`).join("")}
      </div>
    </div>
  `;
}

/* ===================== 事件 ===================== */
function bindProfileEvents() {
  const commit = () => {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      const errs = profileErrors(draft());
      if (Object.keys(errs).length === 0) setProfile(draft());
      const el = $("#profilePreview");
      if (el) el.innerHTML = previewHTML();
      bindPreviewEvents();
    }, 350);
  };

  $$("[data-field]").forEach(inp => {
    const f = inp.dataset.field;
    const ev = inp.type === "date" ? "change" : "input";
    inp.addEventListener(ev, () => {
      const raw = inp.value;
      profileDraft[f] = inp.type === "number" ? (raw === "" ? "" : Number(raw)) : raw;
      // 让当前的错误提示立刻更新，不用等防抖
      const errs = profileErrors(profileDraft);
      const row = inp.closest(".form-row");
      let e = row && row.querySelector(".form-error");
      if (errs[f]) {
        if (!e && row) { e = document.createElement("div"); e.className = "form-error"; row.appendChild(e); }
        if (e) e.textContent = errs[f];
      } else if (e) e.remove();
      commit();
    });
    // 失焦时立即提交，避免用户改完就走但还没生效
    inp.addEventListener("blur", () => { clearTimeout(commitTimer); commit(); });
  });

  $$("[data-weak]").forEach(cb => {
    cb.addEventListener("change", () => {
      const t = cb.dataset.weak;
      const arr = draft().weakSkills.slice();
      const i = arr.indexOf(t);
      if (cb.checked && i < 0) arr.push(t);
      if (!cb.checked && i >= 0) arr.splice(i, 1);
      profileDraft.weakSkills = arr;
      cb.closest(".pill").classList.toggle("on", cb.checked);
      commit();
    });
  });

  $$("[data-interest]").forEach(cb => {
    cb.addEventListener("change", () => {
      const t = cb.dataset.interest;
      const arr = draft().interests.slice();
      const i = arr.indexOf(t);
      if (cb.checked && i < 0) arr.push(t);
      if (!cb.checked && i >= 0) arr.splice(i, 1);
      profileDraft.interests = arr;
      cb.closest(".pill").classList.toggle("on", cb.checked);
      commit();
    });
  });

  $$("[data-intensity]").forEach(el => {
    el.addEventListener("click", () => {
      profileDraft.intensity = el.dataset.intensity;
      $$("[data-intensity]").forEach(x => x.classList.toggle("active", x === el));
      commit();
    });
  });

  const rs = $("#profileReset");
  if (rs) rs.addEventListener("click", async () => {
    const c = await chooseDialog({
      title: "恢复默认设置",
      message: "<p>把分数、考试日期、每日时长、薄弱项、兴趣全部恢复成默认值。</p>"
        + "<p style=\"color:var(--text-sub);font-size:var(--fs-sm);\">你的学习记录（打卡、单词、测验、复盘）不受影响。</p>",
      buttons: [{ label: "恢复默认", value: "yes", cls: "btn-primary" }, { label: "取消", value: null }],
    });
    if (c !== "yes") return;
    resetProfile();
    profileDraft = null;
    renderProfile();
    refreshPlanViews();
    toast("已恢复默认设置", "success");
  });

  const rd = $("#resetDataOnly");
  if (rd) rd.addEventListener("click", async () => {
    const items = recordSummary();
    const settingList = "目标分数 " + draft().goalScore + " 分、考试日期 " + draft().examDate
      + "、每天 " + draft().dailyMinutes + " 分钟、薄弱项 " + (draft().weakSkills.join("、") || "未选");
    const c = await chooseDialog({
      title: "清空学习记录",
      message: `
        <p>以下记录会被<strong>永久删除</strong>：</p>
        ${summaryHTML(items)}
        <p style="margin-top:var(--s-4);">这些设置会<strong>保留</strong>：</p>
        <p class="dialog-quote">${esc(settingList)}</p>
        <p style="color:var(--danger);font-size:var(--fs-sm);margin-top:var(--s-3);">
          ⚠️ 不可撤销。如果这些记录对你有价值，先去「学习统计 → 数据备份」导出一份。
        </p>`,
      buttons: [
        { label: "清空记录", value: "yes", cls: "btn-danger" },
        { label: "取消", value: null, cls: "btn-primary" },
      ],
    });
    if (c !== "yes") { return; }
    // 第二步确认：清记录不像恢复出厂那么彻底，但同样不可撤销
    const c2 = await chooseDialog({
      title: "再确认一次",
      message: `<p>真的要清空这 ${items.reduce((a, x) => a + x.n, 0)} 项记录吗？清完就找不回来了。</p>
        <p style="color:var(--text-sub);font-size:var(--fs-sm);">还没导出备份的话，现在点「取消」，去导出一次再回来。</p>`,
      buttons: [
        { label: "确定清空", value: "yes", cls: "btn-danger" },
        { label: "取消", value: null, cls: "btn-primary" },
      ],
    });
    if (c2 !== "yes") return;
    resetStorage("data");
    toast("学习记录已清空，正在重新载入…", "success", 2000);
    setTimeout(() => location.reload(), 800);
  });

  const rf = $("#resetFactory");
  if (rf) rf.addEventListener("click", async () => {
    const items = recordSummary();
    const c1 = await chooseDialog({
      title: "恢复出厂设置",
      message: `
        <p>会删掉<strong>全部内容</strong> —— 学习记录<strong>和</strong>你填的计划参数：</p>
        ${summaryHTML(items)}
        <p style="margin-top:var(--s-4);">计划参数（目标分数、考试日期、每日时长、薄弱项、兴趣）也会一并恢复成默认值。</p>
        <p style="color:var(--danger);font-size:var(--fs-sm);margin-top:var(--s-3);">
          ⚠️ 不可撤销。这是最彻底的一步，做之前请先导出备份。
        </p>`,
      buttons: [
        { label: "我确认，继续", value: "next", cls: "btn-danger" },
        { label: "取消", value: null, cls: "btn-primary" },
      ],
    });
    if (c1 !== "next") return;

    const c2 = await chooseDialog({
      title: "最后确认",
      message: `<p>真的确定吗？</p>
        <p>如果还没导出备份，现在点「取消」，到「学习统计 → 数据备份 → 导出备份文件」存一份再回来 ——
           导出只要几秒，记录没了就真没了。</p>`,
      buttons: [
        { label: "确定恢复出厂设置", value: "yes", cls: "btn-danger" },
        { label: "取消", value: null, cls: "btn-primary" },
      ],
    });
    if (c2 !== "yes") return;

    resetStorage("all");
    toast("已恢复出厂设置，正在重新载入…", "success", 2000);
    setTimeout(() => location.reload(), 800);
  });

  bindPreviewEvents();
}

// 清空前的清单。没有内容时如实说，不列一堆 0。
function summaryHTML(items) {
  if (!items.length) {
    return `<p style="color:var(--text-sub);">目前还没有任何学习记录 —— 清空也不会丢东西。</p>`;
  }
  return `<ul class="dialog-list">${items.map(x =>
    `<li>${esc(x.label)}：<strong>${x.n}</strong></li>`).join("")}</ul>`;
}

function bindPreviewEvents() {
  const ft = $("#fixTarget");
  if (ft) ft.addEventListener("click", () => {
    const r = Plan.get();
    if (!r.ok) return;
    const target = r.profile.vocabNow + r.vocab.capacity;
    profileDraft.vocabTarget = target;
    setProfile({ vocabTarget: target });
    renderProfile();
    refreshPlanViews();
    toast(`目标词汇量已改为 ${target}`, "success");
  });

  const fm = $("#fixMinutes");
  if (fm) fm.addEventListener("click", () => {
    const r = Plan.get();
    if (!r.ok) return;
    const p = r.profile;
    const cost = WORD_COST[p.intensity];
    // 需要的词汇分钟数 ÷ 现有词汇分钟数 → 按比例放大每日总时长。
    // 粗估：词汇时间大致与每日总时长同比例增长。
    const needVocabMinutes = r.vocab.gapWords * cost;
    const haveVocabMinutes = r.weeklyVocabMinutes || 1;
    const scale = needVocabMinutes / haveVocabMinutes;
    const suggested = Math.min(240, Math.max(5, Math.ceil((p.dailyMinutes * scale) / 5) * 5));

    chooseDialog({
      title: "需要多少时间",
      message: `
        <p>你现在的目标缺口是 <strong>${r.vocab.gapWords} 词</strong>，按 <strong>${esc(INTENSITY_OPTIONS.find(o => o.key === p.intensity).name)}</strong> 强度（${cost} 分钟/词），
        需要约 <strong>${needVocabMinutes} 分钟</strong>的纯词汇学习时间。</p>
        <p>现在每周分给词汇的是 ${haveVocabMinutes} 分钟，也就是 ${r.weeks} 周总共约 ${r.vocab.capacity} 词。</p>
        <p>按比例放大，每天大约需要 <strong>${suggested} 分钟</strong>（这是粗估：假设词汇时间随总时长同比例增长，实际不一定完全线性）。</p>
        <p style="color:var(--text-sub);font-size:var(--fs-sm);">另一条路：把强度改成「认识即可」（${WORD_COST.recognize} 分钟/词），
        同样的 ${p.dailyMinutes} 分钟能学约 ${Math.floor(r.weeklyVocabMinutes / WORD_COST.recognize)} 词/周 —— 代价是写作和翻译里可能拼不出来。</p>`,
      buttons: [
        { label: `把每天改成 ${suggested} 分钟`, value: "minutes", cls: "btn-primary" },
        { label: "改成「认识即可」强度", value: "intensity" },
        { label: "先不改", value: null },
      ],
    }).then(c => {
      if (c === "minutes") {
        profileDraft.dailyMinutes = suggested;
        setProfile({ dailyMinutes: suggested });
        renderProfile(); refreshPlanViews();
        toast(`每天已改为 ${suggested} 分钟`, "success");
      } else if (c === "intensity") {
        profileDraft.intensity = "recognize";
        setProfile({ intensity: "recognize" });
        renderProfile(); refreshPlanViews();
        toast("已改为「认识即可」强度", "success");
      }
    });
  });
}

Modules.register("profile", {
  title: "我的目标",
  render: () => { profileDraft = null; renderProfile(); },
  init: () => {},
  order: 0,
});
