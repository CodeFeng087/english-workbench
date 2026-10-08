// module-practice.js — 写作练习 / 翻译练习 / 对话练习 三个模块
// 数据在 practice-data.js。作答记录存在 state.practice，并入导出备份。
// 分别自注册为 "writing" / "translation" / "conversation"。

const PRACTICE_CAP = 300;

/* ===================== 存档工具 ===================== */
function practiceGet(key, fallback) {
  if (!state.practice[key]) state.practice[key] = fallback;
  return state.practice[key];
}

function practicePush(key, record) {
  const arr = practiceGet(key, []);
  // 同一目标的作答只保留最新一条（写作/翻译都是“改到满意”的场景）
  const filtered = record.refKey
    ? arr.filter(r => r.refKey !== record.refKey)
    : arr;
  filtered.unshift(record);
  state.practice[key] = filtered.slice(0, PRACTICE_CAP);
  savePractice();
  bumpActivity("practice", 1);
}

function practiceRemove(key, id) {
  state.practice[key] = practiceGet(key, []).filter(r => r.id !== id);
  savePractice();
}

function countWords(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

function practiceTotal() {
  const w = practiceGet("writing", []).length;
  const t = practiceGet("translation", []).length;
  const c = Object.values(practiceGet("conversation", {})).reduce((n, s) => n + (s.done || []).length, 0);
  return { writing: w, translation: t, conversation: c };
}

/* ===================== 写作练习 ===================== */
let writingTemplateId = null;

function renderWriting() {
  const tpl = writingTemplates.find(t => t.id === writingTemplateId);
  $("#content").innerHTML = `
    <div class="section-header">
      <h2>写作练习</h2>
      <p>四级作文按题型背模板句子，再自己仿写一遍 —— 只要模板熟，开头结尾的分数是稳的。</p>
    </div>
    ${tpl ? renderWritingDetail(tpl) : renderWritingList()}
  `;
  bindWritingEvents();
}

function renderWritingList() {
  const attempts = practiceGet("writing", []);
  const cards = writingTemplates.map(t => {
    const mine = attempts.filter(a => a.refKey === t.id);
    return `
      <div class="material-card practice-card" data-tpl="${t.id}">
        <div class="material-top">
          <span class="material-week">${t.sections.length} 段结构</span>
          <span class="material-type">${esc(t.wordTarget)}</span>
        </div>
        <div class="material-title">${esc(t.name)}</div>
        <div class="material-reason">${esc(t.desc)}</div>
        <div class="practice-card-foot">
          ${mine.length ? `<span class="badge badge-green">已仿写 ${mine.length} 次</span>` : `<span class="badge badge-gray">还没练过</span>`}
          <span class="practice-enter">查看模板 →</span>
        </div>
      </div>`;
  }).join("");

  const myList = attempts.length
    ? `<div class="card" style="margin-top:var(--s-6);">
        <div class="week-progress-head"><strong>我的仿写</strong><span>共 ${attempts.length} 篇</span></div>
        ${attempts.map(a => {
          const t = writingTemplates.find(x => x.id === a.refKey);
          return `<div class="attempt-row">
            <div>
              <strong>${esc(t ? t.name : a.refKey)}</strong>
              <span class="attempt-meta">${esc(a.at)} · ${countWords(a.text)} 词</span>
            </div>
            <div class="attempt-actions">
              <button class="btn" data-load-writing="${a.id}">载入</button>
              <button class="btn" data-del-writing="${a.id}">删除</button>
            </div>
          </div>`;
        }).join("")}
      </div>`
    : "";

  return `
    <div class="material-grid">${cards}</div>
    <div class="card" style="margin-top:var(--s-6);">
      <div class="week-progress-head"><strong>衔接词小抄</strong><span>背熟这几组，作文立刻显得有条理</span></div>
      <div class="linker-groups">
        ${writingLinkers.map(g => `
          <div class="linker-group">
            <div class="linker-group-name">${esc(g.group)}</div>
            ${g.items.map(i => `<span class="linker-chip">${esc(i)}</span>`).join("")}
          </div>`).join("")}
      </div>
    </div>
    ${myList}`;
}

function renderWritingDetail(tpl) {
  const attempts = practiceGet("writing", []);
  const mine = attempts.find(a => a.refKey === tpl.id);

  const sections = tpl.sections.map(s => `
    <div class="writing-section">
      <div class="writing-section-label">${esc(s.label)}</div>
      ${s.patterns.map(p => `
        <div class="pattern-card">
          <div class="pattern-en">
            ${esc(p.en)}
            <button class="speak-btn" data-speak="${esc(p.en.replace(/______/g, "something"))}" title="朗读">🔊</button>
          </div>
          <div class="pattern-cn">${esc(p.cn)}</div>
          <div class="pattern-note">💡 ${esc(p.note)}</div>
        </div>`).join("")}
    </div>`).join("");

  return `
    <button class="btn" id="writingBack">← 返回题型列表</button>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="section-header" style="margin-bottom:var(--s-4);">
        <h2 style="font-size:var(--fs-xl);">${esc(tpl.name)}</h2>
        <p>${esc(tpl.desc)}</p>
      </div>
      ${sections}
    </div>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head"><strong>参考范文</strong><span>${esc(tpl.model.title)}</span></div>
      <div class="model-essay">${esc(tpl.model.text)}</div>
      <div class="inline-note">${esc(tpl.model.note)}</div>
      <div style="margin-top:var(--s-4);">
        <button class="btn" id="writingSpeakModel">🔊 朗读范文</button>
      </div>
    </div>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="week-progress-head">
        <strong>我的仿写</strong>
        <span id="writingWordCount">${mine ? countWords(mine.text) : 0} 词</span>
      </div>
      <textarea class="review-textarea writing-textarea" id="writingInput"
        placeholder="用上面的句式写你自己的版本。先按模板把骨架搭出来，再换掉里面的具体内容。">${esc(mine ? mine.text : "")}</textarea>
      <div class="review-actions" style="margin-top:var(--s-4);">
        <button class="btn" id="writingClear">清空</button>
        <button class="btn btn-primary" id="writingSave">保存仿写</button>
      </div>
    </div>`;
}

function bindWritingEvents() {
  $$("[data-tpl]").forEach(el => {
    el.addEventListener("click", () => {
      writingTemplateId = el.dataset.tpl;
      renderWriting();
    });
  });

  const back = $("#writingBack");
  if (back) back.addEventListener("click", () => { writingTemplateId = null; renderWriting(); });

  const input = $("#writingInput");
  if (input) {
    input.addEventListener("input", () => {
      const el = $("#writingWordCount");
      if (el) el.textContent = countWords(input.value) + " 词";
    });
  }

  const save = $("#writingSave");
  if (save) save.addEventListener("click", () => {
    const text = $("#writingInput").value.trim();
    if (countWords(text) < 20) {
      toast("至少写 20 个词再保存吧", "error");
      return;
    }
    practicePush("writing", {
      id: Date.now(),
      at: todayStr(),
      refKey: writingTemplateId,
      text,
    });
    renderStreak();
    renderWriting();
    toast(`已保存（${countWords(text)} 词）`, "success");
  });

  const clr = $("#writingClear");
  if (clr) clr.addEventListener("click", () => {
    const input2 = $("#writingInput");
    if (input2 && input2.value.trim() && !confirm("确定清空当前输入吗？已保存的仿写不受影响。")) return;
    if (input2) input2.value = "";
    const el = $("#writingWordCount");
    if (el) el.textContent = "0 词";
  });

  const sm = $("#writingSpeakModel");
  if (sm) sm.addEventListener("click", () => {
    Speak.stop();
    const tpl = writingTemplates.find(t => t.id === writingTemplateId);
    if (tpl) Speak.speak(tpl.model.text);
  });

  $$("[data-load-writing]").forEach(btn => {
    btn.addEventListener("click", () => {
      const a = practiceGet("writing", []).find(x => x.id === parseInt(btn.dataset.loadWriting, 10));
      if (!a) return;
      writingTemplateId = a.refKey;
      renderWriting();
      const input3 = $("#writingInput");
      if (input3) { input3.value = a.text; input3.focus(); }
    });
  });

  $$("[data-del-writing]").forEach(btn => {
    btn.addEventListener("click", () => {
      practiceRemove("writing", parseInt(btn.dataset.delWriting, 10));
      renderWriting();
    });
  });

  $$(".speak-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); Speak.speak(btn.dataset.speak); });
  });
}

Modules.register("writing", {
  title: "写作练习",
  render: renderWriting,
  order: 6,
});

/* ===================== 翻译练习 ===================== */
let translationThemeId = "culture";

function renderTranslation() {
  const theme = translationThemes.find(t => t.id === translationThemeId) || translationThemes[0];
  const saved = practiceGet("translation", []);
  const savedMap = {};
  saved.forEach(s => { savedMap[s.refKey] = s; });

  const tabs = translationThemes.map(t =>
    `<button class="task-tab ${t.id === theme.id ? "active" : ""}" data-theme="${t.id}">${esc(t.name)}</button>`).join("");

  const doneCount = theme.items.filter((_, i) => savedMap[theme.id + ":" + i]).length;

  const items = theme.items.map((it, i) => {
    const rec = savedMap[theme.id + ":" + i];
    return `
      <div class="trans-item ${rec ? "done" : ""}">
        <div class="trans-head">
          <span class="trans-num">${i + 1}</span>
          <span class="trans-cn">${esc(it.cn)}</span>
          ${rec ? `<span class="badge badge-green">已练 · 自评 ${rec.score || "-"}</span>` : ""}
        </div>
        <textarea class="review-textarea trans-input" data-trans-idx="${i}"
          placeholder="先自己翻一遍，再点开参考译文对照。">${esc(rec ? rec.text : "")}</textarea>
        <div class="trans-actions">
          <button class="btn" data-trans-reveal="${i}">看参考译文</button>
          <div class="trans-score" data-score-for="${i}">
            自评：
            ${[1, 2, 3, 4, 5].map(n =>
              `<button class="score-dot ${rec && rec.score >= n ? "on" : ""}" data-score="${n}" data-score-idx="${i}">${n}</button>`).join("")}
          </div>
          <button class="btn btn-primary" data-trans-save="${i}">保存</button>
        </div>
        <div class="trans-answer hidden" id="transAnswer${i}">
          <div class="trans-answer-label">参考译文</div>
          <div class="trans-answer-en">
            ${esc(it.en)}
            <button class="speak-btn" data-speak="${esc(it.en)}" title="朗读">🔊</button>
          </div>
          <div class="pattern-note">💡 ${esc(it.note)}</div>
        </div>
      </div>`;
  }).join("");

  $("#content").innerHTML = `
    <div class="section-header">
      <h2>翻译练习</h2>
      <p>四级翻译是段落汉译英，但先把单句练顺。每句自己翻一遍，再对照参考译文找差距 —— 差距就是你的提分点。</p>
    </div>

    <div class="task-tabs">${tabs}</div>

    <div class="inline-note" style="margin-bottom:var(--s-5);">${esc(theme.desc)}　进度：${doneCount}/${theme.items.length}</div>

    <div class="card">${items}</div>
  `;

  bindTranslationEvents();
}

function bindTranslationEvents() {
  $$("[data-theme]").forEach(btn => {
    btn.addEventListener("click", () => {
      translationThemeId = btn.dataset.theme;
      renderTranslation();
    });
  });

  $$("[data-trans-reveal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const el = $("#transAnswer" + btn.dataset.transReveal);
      if (el) el.classList.toggle("hidden");
    });
  });

  $$(".score-dot").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.scoreIdx;
      const n = parseInt(btn.dataset.score, 10);
      $$(`[data-score-idx="${idx}"]`).forEach(b => {
        b.classList.toggle("on", parseInt(b.dataset.score, 10) <= n);
      });
    });
  });

  $$("[data-trans-save]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.transSave, 10);
      const theme = translationThemes.find(t => t.id === translationThemeId);
      const item = theme.items[i];
      const input = $(`.trans-input[data-trans-idx="${i}"]`);
      const text = input ? input.value.trim() : "";
      if (!text) { toast("先写下你的译文再保存", "error"); return; }

      const onDots = $$(`[data-score-idx="${i}"]`).filter(b => b.classList.contains("on"));
      const score = onDots.length ? parseInt(onDots[onDots.length - 1].dataset.score, 10) : 0;

      practicePush("translation", {
        id: Date.now(),
        at: todayStr(),
        refKey: translationThemeId + ":" + i,
        themeId: translationThemeId,
        itemIdx: i,
        cn: item.cn,
        text,
        score,
      });
      renderStreak();
      renderTranslation();
      toast("已保存" + (score ? `（自评 ${score}/5）` : ""), "success");
    });
  });

  $$(".speak-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); Speak.speak(btn.dataset.speak); });
  });
}

Modules.register("translation", {
  title: "翻译练习",
  render: renderTranslation,
  order: 7,
});

/* ===================== 对话练习 ===================== */
let conversationScenarioId = null;

function renderConversation() {
  const sc = conversationScenarios.find(s => s.id === conversationScenarioId);
  $("#content").innerHTML = `
    <div class="section-header">
      <h2>对话练习</h2>
      <p>按场景背常用句，点 🔊 听发音，然后跟着念。四级听力的短对话就来自这些场景。</p>
    </div>
    ${sc ? renderConversationDetail(sc) : renderConversationList()}
  `;
  bindConversationEvents();
}

function renderConversationList() {
  const done = practiceGet("conversation", {});
  const cards = conversationScenarios.map(s => {
    const rec = done[s.id] || { done: [] };
    const n = (rec.done || []).length;
    const pct = Math.round((n / s.lines.length) * 100);
    return `
      <div class="material-card practice-card" data-scenario="${s.id}">
        <div class="material-top">
          <span class="material-week">${s.icon} ${s.lines.length} 句</span>
          <span class="material-type">${pct}%</span>
        </div>
        <div class="material-title">${esc(s.name)}</div>
        <div class="material-reason">${esc(s.desc)}</div>
        <div class="progress" style="margin-top:var(--s-3);"><div class="progress-bar" style="width:${pct}%"></div></div>
        <div class="practice-card-foot">
          <span class="practice-enter">进入场景 →</span>
        </div>
      </div>`;
  }).join("");
  return `<div class="material-grid">${cards}</div>`;
}

function renderConversationDetail(sc) {
  const done = practiceGet("conversation", {});
  const rec = done[sc.id] || { done: [] };
  const doneSet = new Set(rec.done || []);
  const pct = Math.round((doneSet.size / sc.lines.length) * 100);

  const lines = sc.lines.map((l, i) => `
    <div class="conv-line ${doneSet.has(i) ? "done" : ""}">
      <button class="conv-check ${doneSet.has(i) ? "on" : ""}" data-conv-idx="${i}" title="标记为已跟读">${doneSet.has(i) ? "✓" : ""}</button>
      <div class="conv-body">
        <div class="conv-en">
          ${esc(l.en)}
          <button class="speak-btn" data-speak="${esc(l.en)}" title="朗读">🔊</button>
        </div>
        <div class="conv-cn">${esc(l.cn)}</div>
        <div class="conv-tip">💡 ${esc(l.tip)}</div>
      </div>
    </div>`).join("");

  return `
    <button class="btn" id="convBack">← 返回场景列表</button>

    <div class="card" style="margin-top:var(--s-5);">
      <div class="task-day-header">
        <div>
          <div class="task-day-name">${sc.icon} ${esc(sc.name)}</div>
          <div class="task-day-focus">${esc(sc.desc)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:var(--fs-sm);color:var(--text-sub);">已跟读</div>
          <div style="font-family:var(--font-display);font-size:var(--fs-xl);font-weight:700;color:var(--primary);">${doneSet.size}/${sc.lines.length}</div>
        </div>
      </div>
      <div class="progress" style="margin-bottom:var(--s-5);"><div class="progress-bar" style="width:${pct}%"></div></div>

      <div style="display:flex;gap:var(--s-3);flex-wrap:wrap;margin-bottom:var(--s-5);">
        <button class="btn btn-accent" id="convSpeakAll">🔊 连播全部（跟读用）</button>
        <button class="btn" id="convSpeakSlow">🐢 慢速连播</button>
      </div>

      ${lines}
    </div>`;
}

function bindConversationEvents() {
  $$("[data-scenario]").forEach(el => {
    el.addEventListener("click", () => {
      conversationScenarioId = el.dataset.scenario;
      renderConversation();
    });
  });

  const back = $("#convBack");
  if (back) back.addEventListener("click", () => { conversationScenarioId = null; renderConversation(); });

  const sc = conversationScenarios.find(s => s.id === conversationScenarioId);

  $$("[data-conv-idx]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.convIdx, 10);
      const all = practiceGet("conversation", {});
      if (!all[sc.id]) all[sc.id] = { done: [], last: todayStr() };
      const set = new Set(all[sc.id].done || []);
      if (set.has(i)) set.delete(i); else set.add(i);
      all[sc.id].done = [...set];
      all[sc.id].last = todayStr();
      savePractice();
      renderConversation();
    });
  });

  // 连播必须用 speakSequence：早先写成 forEach(Speak.speak)，
  // 而 speak 内部会 cancel，结果每句都掐掉上一句，只念得出最后一句。
  const all = $("#convSpeakAll");
  if (all) all.addEventListener("click", () => {
    Speak.speakSequence(sc.lines.map(l => l.en));
  });

  const slow = $("#convSpeakSlow");
  if (slow) slow.addEventListener("click", () => {
    Speak.speakSequence(sc.lines.map(l => l.en), { rate: Math.max(0.5, Speak.rate() - 0.25) });
  });

  $$(".speak-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); Speak.speak(btn.dataset.speak); });
  });
}

Modules.register("conversation", {
  title: "对话练习",
  render: renderConversation,
  order: 9,
});
