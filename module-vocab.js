// module-vocab.js — 词汇库模块（词表、搜索、详情弹窗、添加、导入）
// 依赖 core.js。自注册为 "vocab"。

/* ===================== 数据筛选 ===================== */
// 原实现里 renderVocab 和 updateVocabColumns 各写了一份筛选 + 各写了一份 renderCol，
// 后者漏了 exampleCN —— 于是一搜索例句中文就消失。现在两处共用这一份。
function filteredVocab() {
  let list = getVocabList().slice();

  // 已掌握的词归入 mastered 分类
  list = list.map(w =>
    state.masteredWords.includes(w.id) && w.category !== "mastered"
      ? { ...w, category: "mastered" }
      : w
  );

  if (state.vocabListId === "mastered") {
    list = list.filter(w => w.category === "mastered");
  } else if (state.vocabListId !== "all") {
    list = list.filter(w => w.list === state.vocabListId);
  }

  const q = state.vocabSearch.trim().toLowerCase();
  if (q) {
    list = list.filter(w =>
      String(w.word).toLowerCase().includes(q) ||
      String(w.meaning).toLowerCase().includes(q) ||
      String(w.example || "").toLowerCase().includes(q)
    );
  }
  return list;
}

/* ===================== 渲染 ===================== */
// 唯一的列渲染函数
function renderVocabCol(words, header, headerCls) {
  if (!words.length) {
    return `<div class="vocab-col">
      <div class="vocab-col-header ${headerCls}"><span>${esc(header)}</span><span class="vocab-col-count">0</span></div>
      <div class="empty-state" style="padding:var(--s-8);">暂无单词</div>
    </div>`;
  }
  const items = words.map(w => `
    <div class="vocab-item" data-word-id="${w.id}">
      <div class="vocab-item-head">
        <span class="vocab-word">${esc(w.word)}</span>
        <span class="vocab-phonetic">${esc(w.phonetic)}</span>
        <button class="speak-btn" data-speak="${esc(w.word)}" title="朗读单词" aria-label="朗读">🔊</button>
      </div>
      <div class="vocab-meaning">${esc(w.meaning)}</div>
      ${w.example ? `<div class="vocab-example">${esc(w.example)}</div>` : ""}
      ${w.exampleCN ? `<div class="vocab-example-cn">${esc(w.exampleCN)}</div>` : ""}
      ${w.tip ? `<div class="vocab-tip">🧠 ${esc(w.tip)}</div>` : ""}
      ${w.pairTip ? `<div class="vocab-pair-tip">💡 ${esc(w.pairTip)}</div>` : ""}
    </div>
  `).join("");
  return `<div class="vocab-col">
    <div class="vocab-col-header ${headerCls}"><span>${esc(header)}</span><span class="vocab-col-count">${words.length}</span></div>
    <div class="vocab-list">${items}</div>
  </div>`;
}

function bindVocabItems() {
  $$(".vocab-item").forEach(item => {
    item.addEventListener("click", () => openVocabModal(parseInt(item.dataset.wordId, 10)));
  });
  // 朗读按钮在卡片内部，必须阻止冒泡，否则会顺带打开详情弹窗
  $$(".speak-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      Speak.speak(btn.dataset.speak);
    });
  });
}

// 搜索 / 切词表时只更新列与统计，不重建搜索框（避免输入焦点丢失）
function updateVocabColumns() {
  const list = filteredVocab();
  const high = list.filter(w => w.category === "high");
  const confused = list.filter(w => w.category === "confused");
  const mastered = list.filter(w => w.category === "mastered");

  const cols = $("#vocabColumns");
  if (cols) {
    cols.innerHTML =
      renderVocabCol(high, "高频词", "high") +
      renderVocabCol(confused, "易混词", "confused") +
      renderVocabCol(mastered, "已掌握", "mastered");
    bindVocabItems();
  }

  const statsEl = $("#vocabStats");
  if (statsEl) statsEl.innerHTML = vocabStatsHTML(high, confused, mastered);
}

function vocabStatsHTML(high, confused, mastered) {
  const total = getVocabList().length;
  const masteredAll = getVocabList().filter(w => w.category === "mastered" || state.masteredWords.includes(w.id)).length;
  const pct = total ? Math.round((masteredAll / total) * 100) : 0;
  return `
    <div class="vocab-stat">
      <div class="vocab-stat-num">${high.length}</div>
      <div class="vocab-stat-label">待学高频词</div>
    </div>
    <div class="vocab-stat">
      <div class="vocab-stat-num orange">${confused.length}</div>
      <div class="vocab-stat-label">易混词</div>
    </div>
    <div class="vocab-stat">
      <div class="vocab-stat-num gray">${mastered.length}</div>
      <div class="vocab-stat-label">已掌握</div>
    </div>
    <div class="vocab-stat">
      <div class="vocab-stat-num">${total}</div>
      <div class="vocab-stat-label">词库总量 · 掌握 ${pct}%</div>
    </div>`;
}

function renderVocab() {
  const list = filteredVocab();
  const high = list.filter(w => w.category === "high");
  const confused = list.filter(w => w.category === "confused");
  const mastered = list.filter(w => w.category === "mastered");

  const listOptions = `<option value="all">全部词表</option>` +
    vocabLists.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");

  const rateOpts = [0.6, 0.75, 0.9, 1.0, 1.2].map(r =>
    `<option value="${r}" ${Math.abs(Speak.rate() - r) < 0.01 ? "selected" : ""}>${r}×</option>`).join("");

  $("#content").innerHTML = `
    <div class="section-header">
      <h2>词汇库</h2>
      <p>三栏分类，点单词看详情并标记掌握，点 🔊 听发音（离线合成，不联网）。例句都是你当前水平能读懂的简单句。</p>
    </div>

    <div class="vocab-toolbar">
      <select class="vocab-select" id="vocabListSelect">${listOptions}</select>
      <input type="text" class="vocab-search" id="vocabSearch" placeholder="搜索单词、释义或例句…" value="${esc(state.vocabSearch)}" />
      <select class="vocab-select" id="vocabRateSelect" title="朗读语速" style="min-width:80px;">${rateOpts}</select>
      <button class="btn btn-accent" id="btnAddWord" style="white-space:nowrap;">+ 添加单词</button>
      <button class="btn" id="btnImportWords" style="white-space:nowrap;">📥 导入单词书</button>
    </div>

    <div class="vocab-stats" id="vocabStats">${vocabStatsHTML(high, confused, mastered)}</div>

    <div class="vocab-columns" id="vocabColumns">
      ${renderVocabCol(high, "高频词", "high")}
      ${renderVocabCol(confused, "易混词", "confused")}
      ${renderVocabCol(mastered, "已掌握", "mastered")}
    </div>
  `;

  $("#vocabListSelect").value = state.vocabListId;
  $("#vocabListSelect").addEventListener("change", e => {
    state.vocabListId = e.target.value;
    updateVocabColumns();
  });
  $("#vocabSearch").addEventListener("input", debounce(e => {
    state.vocabSearch = e.target.value;
    updateVocabColumns();
  }, 200));
  $("#vocabRateSelect").addEventListener("change", e => {
    Speak.setRate(e.target.value);
    Speak.speak("This is the reading speed.");
  });

  bindVocabItems();
  $("#btnImportWords").addEventListener("click", openImportModal);
  $("#btnAddWord").addEventListener("click", () => openAddWordModal());
}

/* ===================== 单词详情弹窗 ===================== */
let currentModalWord = null;

function openVocabModal(wordId) {
  let word = getVocabList().find(w => w.id === wordId);
  if (!word) return;
  if (state.masteredWords.includes(word.id)) word = { ...word, category: "mastered" };
  currentModalWord = word;

  $("#modalWord").textContent = word.word;
  $("#modalPhonetic").textContent = word.phonetic || "";
  $("#modalMeaning").textContent = word.meaning || "";
  $("#modalExample").textContent = word.example || "";
  $("#modalExampleCn").textContent = word.exampleCN || "";

  const isMastered = word.category === "mastered" || state.masteredWords.includes(word.id);

  let tipHtml = "";
  if (word.tip) tipHtml += `<div class="vocab-tip" style="margin-top:var(--s-4);">🧠 ${esc(word.tip)}</div>`;
  if (word.pairTip) tipHtml += `<div class="vocab-pair-tip" style="margin-top:var(--s-3);">💡 ${esc(word.pairTip)}</div>`;

  // 顺手把这个词的复习状态显示出来，和测验模块打通
  const srs = state.srs[word.id];
  if (srs) {
    const boxText = ["刚接触", "1 天", "2 天", "4 天", "7 天"][Math.min(srs.box || 0, 4)];
    tipHtml += `<div class="inline-note" style="margin-top:var(--s-3);">
      复习进度：第 ${(srs.box || 0) + 1}/5 盒 · 下次复习 ${esc(srs.due || "—")}${srs.lapses ? ` · 忘记过 ${srs.lapses} 次` : ""}
    </div>`;
  }
  $("#modalPairTip").innerHTML = tipHtml;

  const btnKnow = $("#btnAlreadyKnow");
  btnKnow.textContent = isMastered ? "取消已掌握" : "标记为已掌握";
  btnKnow.classList.toggle("btn-accent", !isMastered);

  const exBtn = $("#btnSpeakExample");
  if (exBtn) exBtn.disabled = !word.example;

  $("#vocabModal").classList.add("show");
}

function closeVocabModal() {
  $("#vocabModal").classList.remove("show");
  currentModalWord = null;
  Speak.stop();
}

/* ===================== 导入单词书 ===================== */
let importParsed = [];
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function openImportModal() {
  $("#importModal").classList.add("show");
  $("#importPreview").style.display = "none";
  importParsed = [];
  const note = $("#pdfOfflineNote");
  if (note) note.style.display = "none";
}

function closeImportModal() {
  $("#importModal").classList.remove("show");
}

// 解析文本为词条数组
function parseWordText(text) {
  text = String(text || "").trim();
  if (!text) return [];

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : [data];
      const out = arr
        .filter(o => o && (o.word || o.Word))
        .map(o => ({
          word: String(o.word || o.Word || "").trim(),
          phonetic: String(o.phonetic || o.phonetics || ""),
          meaning: String(o.meaning || o.translation || o.cn || o.释义 || ""),
          example: String(o.example || o.sentence || ""),
          exampleCN: String(o.exampleCN || o.translation_cn || ""),
          tip: String(o.tip || o.memory || ""),
          category: o.category || "high",
        }))
        .filter(w => w.word);
      if (out.length) return out;
    } catch {
      // 不是合法 JSON，继续走文本解析
    }
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // PDF 提取常把一个单词拆成单行单字符（t/h/i/n/k），需要智能合并：
  // 连续纯字母行直接拼接（不加空格），非纯字母行用空格分隔
  const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
  const merged = [];
  let buf = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasChinese = CJK.test(line);
    if (hasChinese) {
      // 碰到中文行 → 把累积的英文碎片和这行拼成一条
      if (buf) { merged.push(buf + " " + line); buf = ""; }
      else merged.push(line);
    } else {
      const isPureLetters = /^[a-zA-Z]+$/.test(line);
      if (isPureLetters) {
        // 纯字母：检查 buf 最后一部分是否也是纯字母 → 直接拼接
        const parts = buf.split(" ");
        const last = parts[parts.length - 1];
        if (last && /^[a-zA-Z]+$/.test(last)) {
          parts[parts.length - 1] = last + line;
          buf = parts.join(" ");
        } else {
          buf = buf ? buf + " " + line : line;
        }
      } else {
        // 非纯字母（音标、标点等）→ 用空格追加
        buf = buf ? buf + " " + line : line;
      }
    }
  }
  if (buf) merged.push(buf);

  const words = [];
  for (const line of merged) {
    let parts = null;
    if (line.includes("\t")) parts = line.split("\t");
    else if (line.includes(" - ")) parts = line.split(" - ");
    else if (line.includes("——")) parts = line.split("——");
    else if (line.includes(",")) parts = line.split(",");
    else if (line.includes("，")) parts = line.split("，");
    else {
      const m = line.match(/^([a-zA-Z'-]+)\s+(.+)$/);
      if (m) parts = [m[1], m[2]];
    }
    if (parts && parts.length >= 2) {
      const word = parts[0].trim();
      const meaning = parts.slice(1).join(" ").trim();
      if (word && /^[a-zA-Z'-]+$/.test(word) && meaning) {
        words.push({ word, meaning, category: "high" });
      }
    }
  }
  return words;
}

// 按需加载 pdf.js：原来放在 index.html 里，等于每次打开页面都往 CDN 发一次请求。
// 改成只有真的选了 PDF 才加载，平时完全离线。
function ensurePdfJs() {
  if (typeof pdfjsLib !== "undefined") return Promise.resolve(true);
  if (window.__pdfjsLoading) return window.__pdfjsLoading;

  window.__pdfjsLoading = new Promise(resolve => {
    const s = document.createElement("script");
    s.src = PDFJS_URL;
    s.onload = () => {
      if (typeof pdfjsLib !== "undefined") {
        try { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch {}
        resolve(true);
      } else resolve(false);
    };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return window.__pdfjsLoading;
}

async function parsePdfFile(file) {
  const note = $("#pdfOfflineNote");
  const ok = await ensurePdfJs();
  if (!ok) {
    if (note) {
      note.style.display = "block";
      note.innerHTML = `无法加载 PDF 解析库（需要联网一次）。<br>
        最简单的替代：用任意 PDF 阅读器打开，全选复制文字，粘到「📋 粘贴文本」里导入 —— 完全不用联网。`;
    }
    return;
  }
  if (note) note.style.display = "none";

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(it => it.str).join("\n") + "\n";
    }
    const raw = parseWordText(fullText);
    // 过滤掉释义里没有中文的条目（PDF 中文释义是图片时会只剩音标）
    const withChinese = raw.filter(w => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(w.meaning));
    const noChinese = raw.length - withChinese.length;

    if (noChinese > 0 && withChinese.length === 0) {
      // 全部条目都没有中文释义 → PDF 的中文是图片
      importParsed = [];
      if (note) {
        note.style.display = "block";
        note.innerHTML = `<strong>这份 PDF 的中文释义无法提取。</strong><br>
          从 ${pdf.numPages} 页中提取出了 ${raw.length} 个英文单词，但它们的中文释义全部缺失——<br>
          这说明 PDF 的中文是图片或使用了没有文字映射的字体，任何工具都提取不出来。<br><br>
          <strong>替代方案：</strong>用 PDF 阅读器打开，手动复制需要的词条，粘到「📋 粘贴文本」里导入。`;
      }
      renderImportPreview();
      return;
    }

    if (noChinese > 0 && withChinese.length > 0) {
      // 部分有中文、部分没有 → 只导入有中文的，提示跳过了多少
      importParsed = withChinese;
      if (note) {
        note.style.display = "block";
        note.innerHTML = `提取了 ${raw.length} 条，其中 ${withChinese.length} 条有中文释义（已显示），${noChinese} 条缺失中文释义已跳过。`;
      }
    } else {
      importParsed = withChinese;
    }

    renderImportPreview();
    if (importParsed.length === 0) {
      if (note) {
        note.style.display = "block";
        note.innerHTML = `<strong>这份 PDF 里没有可提取的文字。</strong><br>
          常见原因：它是扫描件，或中文释义是图片、字体没有文字映射。<br>
          这种 PDF 无法用任何工具直接解析出释义，请改用「📋 粘贴文本」手动录入。
          <br><span style="color:var(--text-muted);">（共 ${pdf.numPages} 页）</span>`;
      }
    }
  } catch (err) {
    console.error(err);
    if (note) {
      note.style.display = "block";
      note.textContent = "PDF 解析失败：" + err.message;
    }
  }
}

function renderImportPreview() {
  if (!importParsed.length) {
    $("#importPreview").style.display = "none";
    return;
  }
  $("#importPreview").style.display = "block";
  $("#importCount").textContent = importParsed.length;

  // 只转义了双引号是不够的：这里必须用 esc()，否则含 < 或 & 的释义会破坏结构
  const rows = importParsed.map((w, i) => `
    <div class="import-row">
      <label class="import-check">
        <input type="checkbox" class="import-item-check" data-idx="${i}" checked />
      </label>
      <input class="import-cell word" value="${esc(w.word)}" data-idx="${i}" data-field="word" />
      <input class="import-cell meaning" value="${esc(w.meaning)}" data-idx="${i}" data-field="meaning" placeholder="释义" />
    </div>
  `).join("");
  $("#importPreviewTable").innerHTML = rows;

  $$(".import-cell").forEach(cell => {
    cell.addEventListener("input", () => {
      const idx = parseInt(cell.dataset.idx, 10);
      importParsed[idx][cell.dataset.field] = cell.value;
    });
  });
}

// 写出一个词条。policy 处理“已存在同名单词”的情况。
function pushWord(entry, policy) {
  const existing = findWordByText(entry.word);
  if (existing) {
    if (policy === "skip") return "skipped";
    if (policy === "overwrite") {
      const isCustom = state.customWords.some(w => w.id === existing.id);
      if (isCustom) {
        Object.assign(existing, {
          phonetic: entry.phonetic || existing.phonetic,
          meaning: entry.meaning || existing.meaning,
          example: entry.example || existing.example,
          exampleCN: entry.exampleCN || existing.exampleCN,
          tip: entry.tip || existing.tip,
        });
      } else {
        // 内置词不能直接改（不会被持久化）：改为新增一条自定义词，
        // 并把内置那条放进 deletedIds —— 复用了已有的删除机制。
        state.customWords.push(makeWord(entry));
        if (!state.deletedIds.includes(existing.id)) state.deletedIds.push(existing.id);
        saveDeletedIds();
      }
      return "updated";
    }
    return "ask";
  }
  state.customWords.push(makeWord(entry));
  return "added";
}

function makeWord(entry) {
  return {
    id: nextWordId(),
    word: entry.word.trim(),
    phonetic: entry.phonetic || "",
    meaning: entry.meaning.trim(),
    example: entry.example || "",
    exampleCN: entry.exampleCN || "",
    tip: entry.tip || "",
    list: "cet4-core",
    category: entry.category || "high",
  };
}

async function confirmImport() {
  const checked = [...$$(".import-item-check")].filter(c => c.checked);
  if (!checked.length) {
    toast("请至少选择一个单词", "error");
    return;
  }

  const selected = checked
    .map(c => parseInt(c.dataset.idx, 10))
    .map(idx => importParsed[idx])
    .filter(w => w && w.word && w.meaning)
    .map(w => ({
      word: String(w.word).trim(),
      meaning: String(w.meaning).trim(),
      phonetic: w.phonetic || "",
      example: w.example || "",
      exampleCN: w.exampleCN || "",
      tip: w.tip || "",
      category: w.category || "high",
    }));

  if (!selected.length) {
    toast("没有有效的单词（需要同时有单词和释义）", "error");
    return;
  }

  // 先分类：批内重复（同一份文本里出现两次）与已存在重复
  const batchSeen = new Set();
  const fresh = [];
  const dupExisting = [];
  let batchDupCount = 0;

  for (const e of selected) {
    const key = norm(e.word);
    if (!key) continue;
    if (batchSeen.has(key)) { batchDupCount++; continue; }
    batchSeen.add(key);
    const ex = findWordByText(e.word);
    if (ex) dupExisting.push({ entry: e, existing: ex });
    else fresh.push(e);
  }

  // 先写入不冲突的
  fresh.forEach(e => pushWord(e, "skip"));

  let added = fresh.length;
  let updated = 0;
  let skipped = batchDupCount;

  if (dupExisting.length) {
    const sample = dupExisting.slice(0, 5).map(d =>
      `<li><code>${esc(d.entry.word)}</code> 已存在：${esc(d.existing.meaning)}</li>`).join("");
    const more = dupExisting.length > 5 ? `<li>…还有 ${dupExisting.length - 5} 个</li>` : "";

    const choice = await chooseDialog({
      title: "有单词已存在",
      message: `
        <p>这次导入里有 <strong>${dupExisting.length}</strong> 个单词词库里已经有了：</p>
        <ul class="dialog-list">${sample}${more}</ul>
        <p style="color:var(--text-sub);font-size:var(--fs-sm);margin-top:var(--s-3);">
          「覆盖」会用新导入的释义替换旧词条（内置词会被替换为你的自定义副本）。
        </p>`,
      buttons: [
        { label: "全部跳过", value: "skip", cls: "btn-primary" },
        { label: "覆盖已有", value: "overwrite" },
        { label: "取消导入", value: null },
      ],
    });

    if (choice === null) return; // 用户取消：上面 fresh 已经写进去了，这里不再继续
    if (choice === "skip") {
      skipped += dupExisting.length;
    } else {
      dupExisting.forEach(d => { if (pushWord(d.entry, "overwrite") === "updated") updated++; });
    }
  }

  saveCustomWords();
  if (updated || added) bumpActivity("words", added);
  closeImportModal();
  renderVocab();
  renderStreak();

  const bits = [`新增 ${added}`];
  if (updated) bits.push(`覆盖 ${updated}`);
  if (skipped) bits.push(`跳过重复 ${skipped}`);
  toast(`导入完成：${bits.join(" · ")}`, "success", 4200);
}

/* ===================== 添加单词 ===================== */
function openAddWordModal() {
  ["awWord", "awPhonetic", "awMeaning", "awExample", "awExampleCn", "awTip"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const cat = $("#awCategory");
  if (cat) cat.value = "high";
  $("#addWordModal").classList.add("show");
  const w = $("#awWord");
  if (w) w.focus();
}

function closeAddWordModal() {
  $("#addWordModal").classList.remove("show");
}

async function saveAddWord() {
  const word = $("#awWord").value.trim();
  const meaning = $("#awMeaning").value.trim();
  if (!word || !meaning) {
    toast("请填写单词和释义", "error");
    return;
  }
  if (!/^[a-zA-Z][a-zA-Z'’\- ]*$/.test(word)) {
    toast("单词只能包含英文字母、连字符和撇号", "error");
    return;
  }

  const entry = {
    word,
    phonetic: $("#awPhonetic").value.trim(),
    meaning,
    example: $("#awExample").value.trim(),
    exampleCN: $("#awExampleCn").value.trim(),
    tip: $("#awTip").value.trim(),
    category: $("#awCategory").value,
  };

  const existing = findWordByText(word);
  if (existing) {
    const choice = await chooseDialog({
      title: "这个词已经有了",
      message: `<p><code>${esc(word)}</code> 已经在词库里：</p>
        <p class="dialog-quote">${esc(existing.meaning)}</p>
        <p>要用你现在填的释义替换它吗？</p>`,
      buttons: [
        { label: "覆盖", value: "overwrite", cls: "btn-primary" },
        { label: "取消", value: null },
      ],
    });
    if (choice !== "overwrite") return;
    pushWord(entry, "overwrite");
  } else {
    pushWord(entry, "skip");
    bumpActivity("words", 1);
  }

  saveCustomWords();
  closeAddWordModal();
  renderVocab();
  renderStreak();
  toast(`已保存「${word}」`, "success");
}

/* ===================== 初始化 ===================== */
function initVocabModals() {
  // 详情弹窗
  $("#modalClose").addEventListener("click", closeVocabModal);
  $("#vocabModal").addEventListener("click", e => {
    if (e.target.id === "vocabModal") closeVocabModal();
  });

  const sw = $("#btnSpeakWord");
  if (sw) sw.addEventListener("click", () => { if (currentModalWord) Speak.speak(currentModalWord.word); });
  const se = $("#btnSpeakExample");
  if (se) se.addEventListener("click", () => { if (currentModalWord) Speak.speak(currentModalWord.example); });

  $("#btnAlreadyKnow").addEventListener("click", () => {
    if (!currentModalWord) return;
    const id = currentModalWord.id;
    const idx = state.masteredWords.indexOf(id);
    if (idx >= 0) state.masteredWords.splice(idx, 1);
    else state.masteredWords.push(id);
    saveJSON(STORAGE_KEYS.masteredWords, state.masteredWords);
    closeVocabModal();
    renderVocab();
  });

  $("#btnDeleteWord").addEventListener("click", async () => {
    if (!currentModalWord) return;
    const id = currentModalWord.id;
    const w = currentModalWord.word;
    const choice = await chooseDialog({
      title: "删除单词",
      message: `<p>确定删除 <code>${esc(w)}</code> 吗？</p>
        <p style="color:var(--text-sub);font-size:var(--fs-sm);">它的测验记录也会一起清掉，此操作不可撤销。</p>`,
      buttons: [
        { label: "删除", value: "yes", cls: "btn-danger" },
        { label: "取消", value: null, cls: "btn-primary" },
      ],
    });
    if (choice !== "yes") return;

    const isCustom = state.customWords.some(x => x.id === id);
    if (isCustom) {
      state.customWords = state.customWords.filter(x => x.id !== id);
      saveCustomWords();
    } else {
      if (!state.deletedIds.includes(id)) state.deletedIds.push(id);
      saveDeletedIds();
    }
    state.masteredWords = state.masteredWords.filter(mid => mid !== id);
    saveJSON(STORAGE_KEYS.masteredWords, state.masteredWords);
    delete state.srs[id];
    saveSrs();
    delete state.mistakes[id];
    saveMistakes();
    closeVocabModal();
    renderVocab();
    toast(`已删除「${w}」`, "success");
  });

  // 导入弹窗
  $("#importClose").addEventListener("click", closeImportModal);
  $("#importModal").addEventListener("click", e => {
    if (e.target.id === "importModal") closeImportModal();
  });

  $$(".import-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".import-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const pane = tab.dataset.importTab;
      $$(".import-pane").forEach(p => p.classList.toggle("hidden", p.dataset.pane !== pane));
    });
  });

  $("#importParse").addEventListener("click", () => {
    const active = $(".import-tab.active");
    const which = active ? active.dataset.importTab : "file";
    const note = $("#pdfOfflineNote");

    if (which === "file") {
      const file = $("#importFile").files[0];
      if (!file) { toast("请先选择文件", "error"); return; }
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext === "pdf") {
        parsePdfFile(file);
      } else {
        if (note) note.style.display = "none";
        // 用 FileReader 读 ArrayBuffer，同时尝试多种编码，选中文最多的
        const reader2 = new FileReader();
        reader2.onload = ev => {
          const bytes = new Uint8Array(ev.target.result);
          const cjkCount = s => (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
          // 同时尝试 UTF-8 和 GBK，选中文多的
          const candidates = [];
          try { candidates.push(["utf-8", new TextDecoder("utf-8", { fatal: false }).decode(bytes)]); } catch {}
          try { candidates.push(["gbk", new TextDecoder("gbk").decode(bytes)]); } catch {}
          try { candidates.push(["gb18030", new TextDecoder("gb18030").decode(bytes)]); } catch {}
          // 选中文字符最多的那个
          let best = candidates[0] ? candidates[0][1] : "";
          let bestCJK = cjkCount(best);
          for (const [, txt] of candidates) {
            const n = cjkCount(txt);
            if (n > bestCJK) { best = txt; bestCJK = n; }
          }
          importParsed = parseWordText(best);
          renderImportPreview();
          if (!importParsed.length) toast("未能解析出有效单词，请检查格式", "error");
        };
        reader2.onerror = () => toast("文件读取失败", "error");
        reader2.readAsArrayBuffer(file);
      }
    } else {
      if (note) note.style.display = "none";
      importParsed = parseWordText($("#importPaste").value);
      renderImportPreview();
      if (!importParsed.length) toast("未能解析出有效单词，请检查格式", "error");
    }
  });

  $("#importSelectAll").addEventListener("change", e => {
    $$(".import-item-check").forEach(c => { c.checked = e.target.checked; });
  });

  $("#importConfirm").addEventListener("click", confirmImport);

  // 添加单词弹窗
  $("#addWordClose").addEventListener("click", closeAddWordModal);
  $("#addWordCancel").addEventListener("click", closeAddWordModal);
  $("#addWordModal").addEventListener("click", e => {
    if (e.target.id === "addWordModal") closeAddWordModal();
  });
  $("#addWordSave").addEventListener("click", saveAddWord);
}

Modules.register("vocab", {
  title: "词汇库",
  render: renderVocab,
  init: initVocabModals,
  order: 3,
});
