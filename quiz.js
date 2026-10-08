// quiz.js — 测验引擎（纯逻辑，完全不碰 DOM）
// 含：间隔重复（SRS）、错题本、题目生成、会话构建、唯一的答题写入收口 recordAnswer
// 所有写入都从 recordAnswer 走，统计才不会和明细对不上。

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ===================== 间隔重复 ===================== */
// 5 盒 Leitner：box 0..4，间隔 [1,2,4,7,15] 天
const SRS = {
  INTERVALS: [1, 2, 4, 7, 15],
  MAX_BOX: 4,
  BOX_LABELS: ["刚接触", "1 天", "2 天", "4 天", "7 天"],

  get(id) { return state.srs[id] || null; },
  isNew(id) { return !state.srs[id]; },
  box(id) { const r = state.srs[id]; return r ? (r.box || 0) : 0; },

  // 没有记录 = 今天就该学
  dueDate(id) { const r = state.srs[id]; return r ? r.due : todayStr(); },

  isDue(id, date = todayStr()) {
    const r = state.srs[id];
    if (!r) return true;
    return dateDiff(r.due, date) >= 0;
  },

  // 唯一的 SRS 状态转移
  review(id, correct, date = todayStr()) {
    const prev = state.srs[id] || null;
    const box0 = prev ? (prev.box || 0) : 0;
    let box, lapses = prev ? (prev.lapses || 0) : 0;

    if (correct) {
      box = Math.min(box0 + 1, this.MAX_BOX);
    } else {
      // 只有“本来进了盒子又答错”才算一次遗忘；新词第一次就错不算
      if (box0 > 0) lapses += 1;
      box = 0;
    }

    state.srs[id] = {
      box,
      due: dateAdd(date, this.INTERVALS[box]),
      lapses,
      last: date,
      seen: (prev ? (prev.seen || 0) : 0) + 1,
      right: (prev ? (prev.right || 0) : 0) + (correct ? 1 : 0),
    };
    saveSrs();
    return state.srs[id];
  },

  reset(id) { delete state.srs[id]; saveSrs(); },
};

/* ===================== 错题本 ===================== */
const Mistakes = {
  get(id) { return state.mistakes[id] || null; },

  // 答错：记下当时选错的答案，方便回顾“我为什么会选它”
  add(word, picked, correctAnswer) {
    const cur = state.mistakes[word.id] || {
      wordId: word.id,
      word: word.word,
      wrong: 0,
      picks: [],
      addedAt: todayStr(),
      rightSince: 0,
      resolved: false,
    };
    cur.word = word.word;
    cur.wrong = (cur.wrong || 0) + 1;
    cur.lastAt = todayStr();
    cur.resolved = false;
    cur.rightSince = 0; // 又错了，重新计数
    cur.answer = correctAnswer || word.meaning;
    cur.picks = [{ picked: String(picked == null ? "" : picked).slice(0, 80), at: todayStr() }]
      .concat(cur.picks || []).slice(0, 5);
    state.mistakes[word.id] = cur;
    saveMistakes();
    return cur;
  },

  // 在错题本里连续答对 2 次就算攻克
  markRight(id) {
    const m = state.mistakes[id];
    if (!m) return null;
    m.rightSince = (m.rightSince || 0) + 1;
    if (m.rightSince >= 2) {
      m.resolved = true;
      m.resolvedAt = todayStr();
    }
    saveMistakes();
    return m;
  },

  remove(id) { delete state.mistakes[id]; saveMistakes(); },

  list(includeResolved = false) {
    return Object.values(state.mistakes)
      .filter(m => includeResolved || !m.resolved)
      .sort((a, b) => (b.wrong || 0) - (a.wrong || 0) || String(a.word).localeCompare(String(b.word)));
  },

  activeCount() { return Object.values(state.mistakes).filter(m => !m.resolved).length; },
  resolvedCount() { return Object.values(state.mistakes).filter(m => m.resolved).length; },

  // 错题对应的词条还在不在词库里（可能已被删除）
  words() {
    const byId = {};
    getVocabList().forEach(w => { byId[w.id] = w; });
    return this.list().map(m => byId[m.wordId]).filter(Boolean);
  },
};

/* ===================== 题目生成 ===================== */
const Quiz = {
  TYPES: ["en2cn", "cn2en", "listen", "spell"],

  TYPE_LABELS: {
    en2cn: "看英文选中文",
    cn2en: "看中文选英文",
    listen: "听发音选单词",
    spell: "听写拼单词",
  },

  TYPE_SHORT: {
    en2cn: "英→中",
    cn2en: "中→英",
    listen: "听音",
    spell: "拼写",
  },

  // 语音合成可用与否，决定 listen 能不能出、spell 用哪种提示
  ttsOK() { return Speak.apiOK(); },

  availableTypes() {
    return this.ttsOK() ? this.TYPES.slice() : this.TYPES.filter(t => t !== "listen");
  },

  // 可出题的词池：必须有单词和释义
  pool() {
    return getVocabList().filter(w =>
      w && w.word && w.meaning && /[a-zA-Z]/.test(String(w.word))
    );
  },

  // 挑干扰项。硬性排除与正确答案“归一化后相同”的候选，
  // 否则遇到 adapt(id 11) / adapt(id 22) 这类重复释义会出现两个正确答案。
  pickDistractors(pool, target, field, n, preferSameGroup = true) {
    const correctKey = norm(target[field]);
    const usedKeys = new Set([correctKey]);
    const usedIds = new Set([target.id]);
    const out = [];

    const has = w => {
      const k = norm(w[field]);
      return k && !usedKeys.has(k) && !usedIds.has(w.id);
    };
    const takeFrom = arr => {
      for (const w of shuffle(arr)) {
        if (out.length >= n) return;
        if (!has(w)) continue;
        usedKeys.add(norm(w[field]));
        usedIds.add(w.id);
        out.push(w);
      }
    };

    if (preferSameGroup) {
      takeFrom(pool.filter(w => w.list === target.list || w.category === target.category));
    }
    takeFrom(pool);
    return out;
  },

  // 生成一道题。生成不出来（词池太小）返回 null，调用方负责跳过或换题型。
  generate(type, pool, opts = {}) {
    if (!pool || !pool.length) return null;

    let target;
    if (opts.wordId != null) {
      target = pool.find(w => w.id === opts.wordId);
      if (!target) return null;
    } else {
      target = pool[Math.floor(Math.random() * pool.length)];
      if (!target) return null;
    }

    const base = { type, wordId: target.id, word: target.word, tip: target.tip || "" };

    if (type === "en2cn") {
      const others = this.pickDistractors(pool, target, "meaning", 3);
      if (others.length < 1) return null; // 至少要有 1 个干扰项才成题
      const opts2 = shuffle(
        [{ label: target.meaning, correct: true }]
          .concat(others.map(w => ({ label: w.meaning, correct: false })))
      );
      return { ...base, prompt: target.word, sub: target.phonetic || "", options: opts2, mode: "choice" };
    }

    if (type === "cn2en") {
      const others = this.pickDistractors(pool, target, "word", 3);
      if (others.length < 1) return null;
      const opts2 = shuffle(
        [{ label: target.word, correct: true }]
          .concat(others.map(w => ({ label: w.word, correct: false })))
      );
      return { ...base, prompt: target.meaning, sub: "", options: opts2, mode: "choice" };
    }

    if (type === "listen") {
      if (!this.ttsOK()) return null;
      const others = this.pickDistractors(pool, target, "word", 3);
      if (others.length < 1) return null;
      const opts2 = shuffle(
        [{ label: target.word, correct: true }]
          .concat(others.map(w => ({ label: w.word, correct: false })))
      );
      return {
        ...base,
        mode: "choice",
        prompt: "点下面的按钮听发音，选出你听到的单词",
        sub: "",
        speak: target.word,
        options: opts2,
      };
    }

    if (type === "spell") {
      // 有语音：听发音拼写（听写）。没有语音：看着中文释义拼写。
      // 两种情况下 hint 都是释义，拼不出来可以点开看。
      const tts = this.ttsOK();
      return {
        ...base,
        mode: "spell",
        prompt: tts ? "点下面的按钮听发音，把单词拼出来" : "根据中文释义，拼出对应的英文单词",
        sub: tts ? "" : target.meaning,
        speak: tts ? target.word : null,
        hint: target.meaning,
        answer: target.word,
        options: null,
      };
    }

    return null;
  },

  // 判定拼写：忽略大小写与首尾空格
  checkSpell(input, answer) {
    return norm(input) === norm(answer) && norm(answer).length > 0;
  },
};

/* ===================== 答题写入收口 ===================== */
const QUIZ_LOG_CAP = 500;

// 所有答题产生的写入都集中在这里，避免统计与明细、SRS、错题本各写各的而对不上
function recordAnswer(q, picked, correct, ms) {
  const t = todayStr();

  // 1) 累计计数（不设上限，周报数字来源）
  const T = state.quizTotals;
  T.n = (T.n || 0) + 1;
  if (correct) T.right = (T.right || 0) + 1;
  T.byType = T.byType || {};
  const bt = T.byType[q.type] || (T.byType[q.type] = { n: 0, right: 0 });
  bt.n++;
  if (correct) bt.right++;
  saveJSON(STORAGE_KEYS.quizTotals, T);

  // 2) 明细（有上限，只用于最近记录）
  state.quizLog.push({
    t, at: Date.now(), w: q.wordId, word: q.word, type: q.type,
    ok: !!correct, ms: ms || null,
  });
  if (state.quizLog.length > QUIZ_LOG_CAP) {
    state.quizLog = state.quizLog.slice(-QUIZ_LOG_CAP);
  }
  saveJSON(STORAGE_KEYS.quizLog, state.quizLog);

  // 3) SRS
  SRS.review(q.wordId, correct, t);

  // 4) 错题本
  const word = getVocabList().find(w => w.id === q.wordId);
  if (word) {
    if (!correct) {
      Mistakes.add(word, picked, q.mode === "choice" ? (word.meaning || "") : (q.answer || ""));
    } else if (q.fromMistakes) {
      Mistakes.markRight(q.wordId);
    }
  }

  // 5) 每日活动（连击与统计的来源）
  bumpActivity("quiz", 1, t);

  return { correct, srs: state.srs[q.wordId] || null };
}

/* ===================== 会话 ===================== */
const QUIZ_MODES = {
  due: { label: "复习到期", desc: "只练今天该复习的词（按记忆曲线排的）" },
  mistakes: { label: "错题重练", desc: "只练错题本里还没攻克的词" },
  new: { label: "新词学习", desc: "只练完全没练过的词" },
  all: { label: "全部随机", desc: "从整个词库里随便抽" },
};

function quizCandidates(mode, pool) {
  if (mode === "due") return pool.filter(w => !SRS.isNew(w.id) && SRS.isDue(w.id));
  if (mode === "new") return pool.filter(w => SRS.isNew(w.id));
  if (mode === "mistakes") {
    const ids = new Set(Mistakes.list().map(m => m.wordId));
    return pool.filter(w => ids.has(w.id));
  }
  return pool.slice();
}

// 构建一个会话：题目在这里一次性定好，长度固定，中途不会因为刷新而变
function createQuizSession({ mode = "due", types, size = 20 } = {}) {
  const pool = Quiz.pool();
  const avail = Quiz.availableTypes();
  let useTypes = (types && types.length ? types : avail).filter(t => avail.includes(t));
  if (!useTypes.length) useTypes = avail.length ? avail : ["en2cn"];

  let cands = quizCandidates(mode, pool);
  let fallbackNote = "";
  if (!cands.length) {
    // 该模式下没有可练的词，退回全池并说明原因，而不是给一个空会话
    fallbackNote = mode === "due"
      ? "目前没有到期的复习词，已改为从全部单词里抽题。"
      : mode === "mistakes"
        ? "错题本是空的，已改为从全部单词里抽题。"
        : mode === "new"
          ? "所有单词都练过了，已改为从全部单词里抽题。"
          : "";
    cands = pool.slice();
  }

  const shuffled = shuffle(cands);
  const queue = [];
  let ti = 0;

  for (let i = 0; i < shuffled.length && queue.length < size; i++) {
    const w = shuffled[i];
    // 轮流用不同题型，让一场里题型是混着的
    for (let attempt = 0; attempt < useTypes.length; attempt++) {
      const type = useTypes[(ti + attempt) % useTypes.length];
      const q = Quiz.generate(type, pool, { wordId: w.id });
      if (q) {
        if (mode === "mistakes") q.fromMistakes = true;
        queue.push(q);
        ti = (ti + attempt + 1) % useTypes.length;
        break;
      }
    }
  }

  return {
    id: Date.now(),
    mode,
    types: useTypes,
    size,
    queue,
    idx: 0,
    answers: [],
    startedAt: Date.now(),
    fallbackNote,
    done: false,
  };
}

function sessionStats(session) {
  const n = session.answers.length;
  const right = session.answers.filter(a => a.correct).length;
  return {
    n,
    right,
    wrong: n - right,
    pct: n ? Math.round((right / n) * 100) : 0,
    ms: Date.now() - session.startedAt,
  };
}
