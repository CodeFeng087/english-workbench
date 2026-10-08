// module-quiz.js — 背单词测验模块（界面层）
// 引擎在 quiz.js。本文件只负责渲染与交互，所有写入都通过 recordAnswer。
// 自注册为 "quiz"。

/* ===================== 模块内状态 ===================== */
let quizTab = "quiz";      // "quiz" | "mistakes"
let quizView = "setup";    // "setup" | "question" | "result"
let session = null;
let answered = false;      // 当前题是否已作答
let questionShownAt = 0;

/* ===================== 渲染入口 ===================== */
function renderQuiz() {
  const tabs = `
    <div class="quiz-tabs">
      <button class="task-tab ${quizTab === "quiz" ? "active" : ""}" data-quiz-tab="quiz">开始测验</button>
      <button class="task-tab ${quizTab === "mistakes" ? "active" : ""}" data-quiz-tab="mistakes">
        错题本 ${Mistakes.activeCount() ? `<span class="tab-badge">${Mistakes.activeCount()}</span>` : ""}
      </button>
    </div>`;

  let body;
  if (quizTab === "mistakes") body = renderMistakesView();
  else if (quizView === "question" && session && session.queue[session.idx]) body = renderQuestionView();
  else if (quizView === "result" && session) body = renderResultView();
  else body = renderSetupView();

  $("#content").innerHTML = `
    <div class="section-header">
      <h2>背单词测验</h2>
      <p>看词库不如自己考一遍。答错的词会自动进错题本，并按记忆曲线安排下次复习。</p>
    </div>
    ${tabs}
    ${body}
  `;

  bindQuizEvents();
}

/* ===================== 设置页 ===================== */
function renderSetupView() {
  const pool = Quiz.pool();
  const dueWords = pool.filter(w => !SRS.isNew(w.id) && SRS.isDue(w.id));
  const newWords = pool.filter(w => SRS.isNew(w.id));
  const mistakeWords = Mistakes.words();
  const tts = Quiz.ttsOK();

  const cfg = state.quizConfig || {};
  const savedTypes = cfg.types || ["en2cn", "cn2en", "spell"];
  const savedSize = cfg.size || 20;
  const avail = Quiz.availableTypes();

  const typeBoxes = avail.map(t => `
    <label class="quiz-type-opt">
      <input type="checkbox" class="quiz-type-check" value="${t}" ${savedTypes.includes(t) ? "checked" : ""} />
      <span>${esc(Quiz.TYPE_LABELS[t])}</span>
    </label>`).join("");

  const voiceNote = tts
    ? (Speak.englishVoice()
        ? `<span class="ok">已就绪</span>（发音：${esc(Speak.englishVoice().name)}）`
        : `<span class="ok">可用</span>（使用浏览器默认英文语音）`)
    : `<span class="warn">当前浏览器不支持语音合成，已自动去掉「听发音选单词」，拼写题改为看释义拼写</span>`;

  const sizeOpts = [10, 20, 30, 50, 0].map(n =>
    `<option value="${n}" ${n === savedSize ? "selected" : ""}>${n === 0 ? "全部" : n + " 题"}</option>`).join("");

  return `
    <div class="quiz-stats">
      <div class="vocab-stat">
        <div class="vocab-stat-num orange">${dueWords.length}</div>
        <div class="vocab-stat-label">今天该复习</div>
      </div>
      <div class="vocab-stat">
        <div class="vocab-stat-num">${newWords.length}</div>
        <div class="vocab-stat-label">还没练过</div>
      </div>
      <div class="vocab-stat">
        <div class="vocab-stat-num">${mistakeWords.length}</div>
        <div class="vocab-stat-label">错题待攻克</div>
      </div>
      <div class="vocab-stat">
        <div class="vocab-stat-num gray">${pool.length}</div>
        <div class="vocab-stat-label">词库总量</div>
      </div>
    </div>

    <div class="quiz-setup">
      <div class="quiz-setup-row">
        <label>练什么</label>
        <div class="quiz-modes">
          ${Object.keys(QUIZ_MODES).map(m => `
            <button class="quiz-mode ${m === "due" ? "active" : ""}" data-quiz-mode="${m}">
              <strong>${esc(QUIZ_MODES[m].label)}</strong>
              <span>${esc(QUIZ_MODES[m].desc)}</span>
            </button>`).join("")}
        </div>
      </div>

      <div class="quiz-setup-row">
        <label>题型</label>
        <div class="quiz-types">${typeBoxes}</div>
      </div>

      <div class="quiz-setup-row inline">
        <label>题量</label>
        <select class="vocab-select" id="quizSize">${sizeOpts}</select>
        <span class="quiz-voice-note">语音合成：${voiceNote}</span>
      </div>

      <div class="quiz-actions">
        <button class="btn btn-primary btn-lg" id="quizStart">开始测验</button>
        <button class="btn" id="quizQuickMistakes" ${Mistakes.activeCount() ? "" : "disabled"}>
          ⚡ 只练错题（${Mistakes.activeCount()}）
        </button>
      </div>
    </div>

    <div class="card" style="margin-top:var(--s-6);">
      <div class="week-progress-head"><strong>复习进度分布</strong><span>按记忆曲线分盒，答对进下一盒</span></div>
      ${renderBoxDistribution(pool)}
    </div>
  `;
}

function renderBoxDistribution(pool) {
  const boxes = [0, 0, 0, 0, 0];
  let none = 0;
  pool.forEach(w => {
    const r = state.srs[w.id];
    if (!r) none++;
    else boxes[Math.min(r.box || 0, 4)]++;
  });
  const max = Math.max(1, ...boxes, none);
  const rows = [
    { label: "未练习", n: none, cls: "box-none" },
    ...boxes.map((n, i) => ({ label: `第 ${i + 1} 盒 · ${SRS.BOX_LABELS[i]}`, n, cls: "box-" + i })),
  ];
  return `<div class="box-dist">
    ${rows.map(r => `
      <div class="box-dist-row">
        <span class="box-dist-label">${esc(r.label)}</span>
        <div class="box-dist-bar"><div class="${r.cls}" style="width:${Math.round((r.n / max) * 100)}%"></div></div>
        <span class="box-dist-num">${r.n}</span>
      </div>`).join("")}
  </div>`;
}

/* ===================== 答题页 ===================== */
function renderQuestionView() {
  const q = session.queue[session.idx];
  const total = session.queue.length;
  const pct = Math.round((session.idx / total) * 100);
  const r = state.srs[q.wordId];

  const srsChip = r
    ? `<span class="badge badge-gray">第 ${(r.box || 0) + 1} 盒 · 答对 ${r.right || 0}/${r.seen || 0}</span>`
    : `<span class="badge badge-orange">新词</span>`;

  let interact;
  if (q.mode === "choice") {
    interact = `<div class="quiz-options" id="quizOptions">
      ${q.options.map((o, i) => `
        <button class="quiz-option" data-opt-idx="${i}">
          <span class="quiz-option-key">${i + 1}</span>
          <span class="quiz-option-label">${esc(o.label)}</span>
        </button>`).join("")}
    </div>`;
  } else {
    // 听写题：听不出来时总得有个台阶下，所以给一个可展开的释义提示。
    // （没有语音时题干本身就是释义，不需要这个按钮）
    const hint = q.speak && q.hint
      ? `<div class="quiz-hint">
           <button class="btn" id="quizHint">看提示（中文释义）</button>
           <div class="quiz-hint-text hidden" id="quizHintText">${esc(q.hint)}</div>
         </div>`
      : "";
    interact = `<div class="quiz-spell">
      <input type="text" id="quizSpellInput" class="quiz-spell-input"
             placeholder="输入英文单词后按回车" autocomplete="off" autocapitalize="off" spellcheck="false" />
      <button class="btn btn-primary" id="quizSpellSubmit">提交</button>
    </div>${hint}`;
  }

  return `
    <div class="quiz-progress">
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      <div class="quiz-progress-text">
        <span>第 ${session.idx + 1} / ${total} 题</span>
        <span>${esc(Quiz.TYPE_LABELS[q.type] || q.type)} · ${srsChip}</span>
      </div>
    </div>

    ${session.fallbackNote && session.idx === 0 ? `<div class="inline-note">${esc(session.fallbackNote)}</div>` : ""}

    <div class="quiz-card">
      <div class="quiz-prompt">${esc(q.prompt)}</div>
      ${q.sub ? `<div class="quiz-sub">${esc(q.sub)}</div>` : ""}
      ${q.speak ? `<button class="btn btn-accent" id="quizSpeak">🔊 播放发音</button>` : ""}
      ${interact}
      <div class="quiz-feedback" id="quizFeedback"></div>
    </div>
  `;
}

/* ===================== 结果页 ===================== */
function renderResultView() {
  const st = sessionStats(session);
  const wrongs = session.answers.filter(a => !a.correct);
  const mins = Math.max(1, Math.round(st.ms / 60000));

  const wrongList = wrongs.length
    ? `<div class="quiz-wrong-list">
        ${wrongs.map(a => `
          <div class="quiz-wrong-row">
            <div>
              <span class="vocab-word">${esc(a.word)}</span>
              <span class="vocab-meaning">${esc(a.meaning || "")}</span>
            </div>
            <div class="quiz-wrong-pick">
              你选了：${esc(a.picked || "（空）")}<br>
              <span class="ok">正确：${esc(a.correctText || "")}</span>
            </div>
          </div>`).join("")}
      </div>`
    : `<div class="empty-state">全部答对，这一轮没有错题 🎉</div>`;

  return `
    <div class="quiz-result">
      <div class="quiz-result-score">
        <div class="quiz-result-pct ${st.pct >= 80 ? "good" : st.pct >= 60 ? "mid" : "bad"}">${st.pct}%</div>
        <div class="quiz-result-sub">答对 ${st.right} / ${st.n} 题 · 用时约 ${mins} 分钟</div>
      </div>

      <div class="quiz-result-actions">
        <button class="btn btn-primary" id="quizAgain">再来一轮</button>
        ${wrongs.length ? `<button class="btn btn-accent" id="quizRedoWrong">只重练这 ${wrongs.length} 个错词</button>` : ""}
        <button class="btn" id="quizBackSetup">返回设置</button>
      </div>

      <div class="card" style="margin-top:var(--s-6);">
        <div class="week-progress-head"><strong>本轮错题</strong><span>已自动加入错题本</span></div>
        ${wrongList}
      </div>
    </div>
  `;
}

/* ===================== 错题本 ===================== */
function renderMistakesView() {
  const list = Mistakes.list();
  const byId = {};
  getVocabList().forEach(w => { byId[w.id] = w; });

  if (!list.length) {
    const resolved = Mistakes.resolvedCount();
    return `<div class="card"><div class="empty-state">
      错题本是空的${resolved ? `（已经攻克了 ${resolved} 个，不错）` : "，去测一轮吧"}。
    </div></div>`;
  }

  const rows = list.map(m => {
    const w = byId[m.wordId];
    const lastPick = m.picks && m.picks[0];
    const srs = state.srs[m.wordId];
    return `
      <div class="mistake-row">
        <div class="mistake-main">
          <div>
            <span class="vocab-word">${esc(m.word)}</span>
            <span class="vocab-phonetic">${esc(w ? w.phonetic : "")}</span>
            <button class="speak-btn" data-speak="${esc(m.word)}" title="朗读">🔊</button>
          </div>
          <div class="vocab-meaning">${esc(w ? w.meaning : "（词条已删除）")}</div>
          ${lastPick ? `<div class="mistake-pick">上次选了：<span class="bad">${esc(lastPick.picked)}</span>（${esc(lastPick.at)}）</div>` : ""}
          <div class="mistake-meta">
            错 ${m.wrong} 次 ·
            ${m.rightSince ? `已连续答对 ${m.rightSince} 次，再对 ${2 - m.rightSince} 次即可攻克` : "尚未重新答对"}
            ${srs ? ` · 下次复习 ${esc(srs.due)}` : ""}
          </div>
        </div>
        <div class="mistake-actions">
          <button class="btn" data-mistake-remove="${m.wordId}" title="从错题本移除">移除</button>
        </div>
      </div>`;
  }).join("");

  const resolved = Mistakes.resolvedCount();
  return `
    <div class="quiz-actions" style="margin-bottom:var(--s-5);">
      <button class="btn btn-primary" id="quizPracticeMistakes">开始重练（${list.length} 个）</button>
      ${resolved ? `<button class="btn" id="quizClearResolved">清理已攻克的 ${resolved} 个</button>` : ""}
    </div>
    <div class="card">
      <div class="week-progress-head"><strong>未攻克的错题</strong><span>同一词连续答对 2 次即自动攻克</span></div>
      ${rows}
    </div>`;
}

/* ===================== 交互 ===================== */
function startSession(mode, sizeOverride) {
  const avail = Quiz.availableTypes();

  // 题型：优先读设置页上的勾选
  let types = [...$$(".quiz-type-check")].filter(c => c.checked).map(c => c.value).filter(t => avail.includes(t));
  if (!types.length) {
    // 从错题本直接开练时设置页根本不在 DOM 里（没有复选框可读），
    // 这里必须退回上次保存的题型，否则会误报“至少选一种题型”而开不了局
    types = ((state.quizConfig && state.quizConfig.types) || []).filter(t => avail.includes(t));
  }
  if (!types.length) types = avail;

  // 题量：同理，设置页不在时用上次保存的值
  let size;
  if (sizeOverride) {
    size = sizeOverride;
  } else {
    const sel = $("#quizSize");
    size = sel ? parseInt(sel.value, 10) : (state.quizConfig.size || 20);
  }
  if (!isFinite(size) || size < 0) size = 20;
  const finalSize = size === 0 ? 9999 : size;

  // 记住这次的选择，下次打开还是这套设置（0 = 全部，不覆盖保存的题量）
  state.quizConfig = { types, size: size === 0 ? (state.quizConfig.size || 20) : size };
  saveJSON(STORAGE_KEYS.quizConfig, state.quizConfig);

  session = createQuizSession({ mode, types, size: finalSize });
  if (!session.queue.length) {
    toast("这个范围内没有可练的单词", "error");
    session = null;
    return;
  }
  quizView = "question";
  answered = false;
  questionShownAt = Date.now();
  renderQuiz();

  // 听力题一进来就自动播一次
  const q = session.queue[0];
  if (q && q.speak) Speak.speak(q.speak);
}

function submitChoice(optIdx) {
  const q = session.queue[session.idx];
  if (answered) return;
  const opt = q.options[optIdx];
  if (!opt) return;
  answered = true;
  finishQuestion(q, opt.correct, opt.label, optIdx);
}

function submitSpell() {
  const q = session.queue[session.idx];
  if (answered) return;
  const input = $("#quizSpellInput");
  const val = input ? input.value.trim() : "";
  if (!val) return;
  answered = true;
  const correct = Quiz.checkSpell(val, q.answer);
  finishQuestion(q, correct, val, null);
}

function finishQuestion(q, correct, pickedText, pickedIdx) {
  const ms = Date.now() - questionShownAt;
  recordAnswer(q, pickedText, correct, ms);

  const word = getVocabList().find(w => w.id === q.wordId) || { meaning: "" };
  const correctText = q.mode === "choice"
    ? (q.options.find(o => o.correct) || {}).label
    : q.answer;

  session.answers.push({
    wordId: q.wordId,
    word: q.word,
    meaning: word.meaning,
    type: q.type,
    correct,
    picked: pickedText,
    correctText,
  });

  // 界面反馈
  if (q.mode === "choice") {
    $$(".quiz-option").forEach((btn, i) => {
      btn.disabled = true;
      if (q.options[i].correct) btn.classList.add("correct");
      else if (i === pickedIdx) btn.classList.add("wrong");
    });
  } else {
    const input = $("#quizSpellInput");
    if (input) {
      input.disabled = true;
      input.classList.add(correct ? "correct" : "wrong");
    }
    const sub = $("#quizSpellSubmit");
    if (sub) sub.disabled = true;
  }

  const fb = $("#quizFeedback");
  if (fb) {
    const srs = state.srs[q.wordId] || {};
    fb.innerHTML = `
      <div class="quiz-fb ${correct ? "correct" : "wrong"}">
        <strong>${correct ? "✓ 答对了" : "✗ 答错了"}</strong>
        ${correct ? "" : ` 正确答案：<code>${esc(correctText)}</code>`}
        <div class="quiz-fb-next">
          <span>下次复习：${esc(srs.due || "明天")}（第 ${(srs.box || 0) + 1} 盒）</span>
          <button class="btn btn-primary" id="quizNext">
            ${session.idx + 1 >= session.queue.length ? "看结果" : "下一题 →"}
          </button>
        </div>
      </div>`;
    const next = $("#quizNext");
    if (next) {
      next.focus();
      next.addEventListener("click", nextQuestion);
    }
  }

  if (!correct && q.speak) Speak.speak(q.speak);
  renderStreak();
}

function nextQuestion() {
  if (!session) return;
  session.idx++;
  answered = false;
  if (session.idx >= session.queue.length) {
    session.done = true;
    quizView = "result";
  } else {
    questionShownAt = Date.now();
  }
  renderQuiz();

  const q = session.queue[session.idx];
  if (q && q.speak) Speak.speak(q.speak);
}

function bindQuizEvents() {
  $$("[data-quiz-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      quizTab = btn.dataset.quizTab;
      Speak.stop();
      renderQuiz();
    });
  });

  // 设置页：模式选择
  $$("[data-quiz-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".quiz-mode").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  const start = $("#quizStart");
  if (start) start.addEventListener("click", () => {
    const active = $(".quiz-mode.active");
    startSession(active ? active.dataset.quizMode : "due");
  });

  const qm = $("#quizQuickMistakes");
  if (qm) qm.addEventListener("click", () => startSession("mistakes"));

  // 答题页
  const speakBtn = $("#quizSpeak");
  if (speakBtn) speakBtn.addEventListener("click", () => {
    const q = session && session.queue[session.idx];
    if (q && q.speak) Speak.speak(q.speak);
  });

  $$(".quiz-option").forEach(btn => {
    btn.addEventListener("click", () => submitChoice(parseInt(btn.dataset.optIdx, 10)));
  });

  const spellInput = $("#quizSpellInput");
  if (spellInput) {
    spellInput.focus();
    spellInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); submitSpell(); }
    });
  }
  const spellSub = $("#quizSpellSubmit");
  if (spellSub) spellSub.addEventListener("click", submitSpell);

  const hintBtn = $("#quizHint");
  if (hintBtn) hintBtn.addEventListener("click", () => {
    const t = $("#quizHintText");
    if (t) t.classList.toggle("hidden");
  });

  // 结果页
  const again = $("#quizAgain");
  if (again) again.addEventListener("click", () => {
    const mode = session ? session.mode : "due";
    quizView = "setup";
    renderQuiz();
    startSession(mode);
  });
  const back = $("#quizBackSetup");
  if (back) back.addEventListener("click", () => { quizView = "setup"; session = null; renderQuiz(); });

  const redoWrong = $("#quizRedoWrong");
  if (redoWrong) redoWrong.addEventListener("click", () => {
    const ids = session.answers.filter(a => !a.correct).map(a => a.wordId);
    const pool = Quiz.pool();
    const types = [...new Set(session.answers.filter(a => !a.correct).map(a => a.type))];
    const queue = [];
    ids.forEach(id => {
      const q = Quiz.generate(types[0] || "en2cn", pool, { wordId: id }) ||
                Quiz.generate("en2cn", pool, { wordId: id });
      // 标记为来自错题本，答对才能累计“连续答对 2 次”从而自动攻克
      if (q) { q.fromMistakes = true; queue.push(q); }
    });
    if (!queue.length) { toast("重练队列为空", "error"); return; }
    session = { id: Date.now(), mode: "mistakes", types, size: queue.length, queue, idx: 0, answers: [], startedAt: Date.now(), fallbackNote: "", done: false };
    quizView = "question";
    answered = false;
    questionShownAt = Date.now();
    renderQuiz();
    const q = session.queue[0];
    if (q && q.speak) Speak.speak(q.speak);
  });

  // 错题本
  const pm = $("#quizPracticeMistakes");
  if (pm) pm.addEventListener("click", () => { quizTab = "quiz"; startSession("mistakes"); });

  const clr = $("#quizClearResolved");
  if (clr) clr.addEventListener("click", async () => {
    const n = Mistakes.resolvedCount();
    const c = await chooseDialog({
      title: "清理已攻克的错题",
      message: `<p>把已经连续答对 2 次的 <strong>${n}</strong> 个词从错题本移除？</p>
        <p style="color:var(--text-sub);font-size:var(--fs-sm);">它们的复习记录不受影响。</p>`,
      buttons: [{ label: "清理", value: "yes", cls: "btn-primary" }, { label: "取消", value: null }],
    });
    if (c !== "yes") return;
    Object.keys(state.mistakes).forEach(k => { if (state.mistakes[k].resolved) delete state.mistakes[k]; });
    saveMistakes();
    renderQuiz();
    toast(`已清理 ${n} 个`, "success");
  });

  $$("[data-mistake-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      Mistakes.remove(parseInt(btn.dataset.mistakeRemove, 10));
      renderQuiz();
    });
  });

  $$(".speak-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); Speak.speak(btn.dataset.speak); });
  });
}

/* ===================== 键盘快捷键 ===================== */
// 只在测验模块、答题状态下生效
function quizKeyHandler(e) {
  if (state.module !== "quiz" || quizTab !== "quiz") return;
  if ($$(".modal-overlay.show").length) return;
  const ae = document.activeElement;
  if (ae && ae.tagName && ["INPUT", "TEXTAREA", "SELECT"].includes(ae.tagName)) return;

  if (quizView === "question") {
    const q = session && session.queue[session.idx];
    if (!q) return;
    if (!answered && q.mode === "choice") {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= q.options.length) {
        e.preventDefault();
        submitChoice(n - 1);
      } else if (e.key.toLowerCase() === "r" && q.speak) {
        e.preventDefault();
        Speak.speak(q.speak);
      }
    } else if (answered && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      nextQuestion();
    }
  } else if (quizView === "setup" && e.key === "Enter") {
    const start = $("#quizStart");
    if (start) start.click();
  }
}

/* ===================== 初始化 ===================== */
function initQuizModule() {
  document.addEventListener("keydown", quizKeyHandler);
}

Modules.register("quiz", {
  title: "背单词测验",
  render: renderQuiz,
  init: initQuizModule,
  order: 4,
});
