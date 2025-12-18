/**
 * @fileoverview 英単語クイズアプリケーションのメインロジック
 * 画面遷移、CSVデータの取得、音声合成、苦手単語の永続化、クイズロジックを管理します。
 */

"use strict";

/** @type {Object<string, HTMLElement>} 画面要素のコレクション */
const views = {
    password: document.getElementById("passwordView"),
    modeSelection: document.getElementById("modeSelectionView"),
    menu: document.getElementById("menuView"),
    quiz: document.getElementById("quizView"),
    result: document.getElementById("resultView")
};

const topScore = document.getElementById("topScore"), 
      timerBar = document.getElementById("timerBar"), 
      dotContainer = document.getElementById("dotProgress"),
      choiceButtons = Array.from(document.querySelectorAll(".choice")), 
      nextBtn = document.getElementById("nextBtn"), 
      PASSWORD = "tkg";

/** @type {Array<Object>} CSVからロードされた全エントリ */
let allEntries = [];
/** @type {Array<Object>} 現在のクイズセッションで出題されるエントリ */
let quizEntries = [];
let currentIndex = 0;
let correctCount = 0;
let wrongAnswers = [];
let currentChoicesData = [];
let answered = false;
let timerInterval = null;
let timeLimit = 0;
/** @type {Object<string, Array>} CSVデータのメモリキャッシュ */
let csvCache = {};

/**
 * ダークモードの切り替えと設定の保存
 */
const themeToggle = document.getElementById("themeToggle");
themeToggle.onclick = () => {
    document.body.classList.toggle("dark-mode");
    themeToggle.textContent = document.body.classList.contains("dark-mode") ? "☀️" : "🌙";
    localStorage.setItem("theme", document.body.classList.contains("dark-mode") ? "dark" : "light");
};
if(localStorage.getItem("theme") === "dark") { document.body.classList.add("dark-mode"); themeToggle.textContent = "☀️"; }

/**
 * 指定したビューを表示し、他を隠す
 * @param {string} name - 表示するビューの名前
 */
function showView(name) {
    Object.keys(views).forEach(v => views[v].classList.add("hidden"));
    views[name].classList.remove("hidden");
    document.getElementById("progressBarContainer").classList.toggle("hidden", name !== "quiz");
    document.body.classList.toggle("scroll-lock", name === "quiz");
    if (name === "menu") updateWeakCountDisplay();
}

/**
 * 英語の読み上げを行う
 * @param {string} text - 読み上げる文字列
 */
function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setTimeout(() => {
        const uttr = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const usVoice = voices.find(v => v.lang.startsWith('en-US') && v.name.includes('Samantha')) || 
                        voices.find(v => v.lang.startsWith('en-US'));
        if (usVoice) uttr.voice = usVoice;
        uttr.lang = 'en-US'; uttr.rate = 1.0;
        window.speechSynthesis.speak(uttr);
    }, 50);
}

/**
 * CSVファイルを読み込み、オブジェクトの配列として返す
 * @param {string} fileName - 読み込むCSVのファイルパス
 * @param {boolean} forceRefresh - キャッシュを無視してサーバーから再取得するか
 * @returns {Promise<Array>} パース済みのデータ配列
 */
async function loadCsv(fileName, forceRefresh = false) {
    if (csvCache[fileName] && !forceRefresh) return csvCache[fileName];
    const url = forceRefresh ? `${fileName}?v=${Date.now()}` : fileName;
    try {
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text();
        const list = [];
        text.split(/\r?\n/).forEach(line => {
            const parts = line.split(",").map(p => p.trim());
            const num = parseInt(parts[0]);
            if (!isNaN(num)) {
                const meanings = parts.slice(2).filter(m => m);
                if (meanings.length) list.push({ number: num, english: parts[1], meanings });
            }
        });
        csvCache[fileName] = list;
        return list;
    } catch (e) { throw e; }
}

/**
 * 回答を判定し、UIを更新する
 * @param {number} idx - クリックされたボタンのインデックス (-1は時間切れ)
 */
function handleAnswer(idx) {
    if (answered) return;
    answered = true; clearInterval(timerInterval);
    choiceButtons.forEach(b => b.disabled = true);
    const entry = quizEntries[currentIndex], dot = document.getElementById(`dot-${currentIndex}`);
    const correctIdx = currentChoicesData.findIndex(c => c.entry === entry);

    if (idx !== -1 && currentChoicesData[idx].entry === entry) {
        choiceButtons[idx].classList.add("correct"); correctCount++; if (dot) dot.classList.add("correct");
    } else {
        if (idx !== -1) choiceButtons[idx].classList.add("wrong");
        choiceButtons[correctIdx].classList.add("correct");
        wrongAnswers.push({ english: entry.english, meaning: currentChoicesData[correctIdx].display });
        
        // 苦手単語を保存
        let weakIds = JSON.parse(localStorage.getItem("weakWords") || "[]");
        if (!weakIds.includes(entry.number)) { weakIds.push(entry.number); localStorage.setItem("weakWords", JSON.stringify(weakIds)); }
        if (dot) dot.classList.add("wrong");
    }
    topScore.textContent = `正解: ${correctCount}`; nextBtn.disabled = false;
}

/**
 * 制限時間タイマーの開始
 */
function startTimer() {
    clearInterval(timerInterval);
    if (timeLimit <= 0) return document.getElementById("timerBarContainer").classList.add("hidden");
    document.getElementById("timerBarContainer").classList.remove("hidden");
    let startTime = Date.now(), duration = timeLimit * 1000;
    timerInterval = setInterval(() => {
        let elapsed = Date.now() - startTime;
        timerBar.style.width = Math.max(0, 100 - (elapsed / duration) * 100) + "%";
        if (elapsed >= duration) { clearInterval(timerInterval); handleAnswer(-1); }
    }, 50);
}

/**
 * 現在の問題に対する4つの選択肢を構築する
 * @param {Object} correctEntry - 正解の単語オブジェクト
 * @returns {Array} 選択肢オブジェクトの配列
 */
function buildChoices(correctEntry) {
    const picks = [correctEntry];
    const usedIds = new Set([correctEntry.number]);
    let candidates = allEntries.filter(e => e.number !== correctEntry.number).sort(() => 0.5 - Math.random());
    for (const c of candidates) {
        if (picks.length >= 4) break;
        if (!usedIds.has(c.number)) { picks.push(c); usedIds.add(c.number); }
    }
    return picks.map(entry => {
        let parts = entry.meanings.join('、').split('、').filter(s => s.trim());
        return { entry, display: parts.length > 1 ? `${parts[0]} / ${parts[1]}` : parts[0] };
    }).sort(() => 0.5 - Math.random());
}

/**
 * 問題を表示し、音声合成とタイマーを開始する
 */
function loadQuestion() {
    answered = false; nextBtn.disabled = true;
    const entry = quizEntries[currentIndex];
    document.querySelectorAll(".dot").forEach(d => d.classList.remove("current"));
    const dot = document.getElementById(`dot-${currentIndex}`); if (dot) dot.classList.add("current");
    document.getElementById("questionWord").textContent = entry.english;
    document.getElementById("progressText").textContent = `Q ${currentIndex + 1} / ${quizEntries.length}`;
    currentChoicesData = buildChoices(entry);
    choiceButtons.forEach((btn, i) => { btn.textContent = currentChoicesData[i].display; btn.className = "choice"; btn.disabled = false; btn.onclick = () => handleAnswer(i); });
    speak(entry.english); startTimer();
}

/**
 * イベントリスナー登録: パスワードログイン
 */
document.getElementById("passwordBtn").onclick = () => {
    if (document.getElementById("passwordInput").value === PASSWORD) showView("modeSelection");
    else document.getElementById("passwordError").textContent = "パスワードが違います";
};

/**
 * モード選択遷移
 */
document.getElementById("selectVocabBtn").onclick = () => showView("menu");
document.getElementById("selectGrammarBtn").onclick = () => alert("文法は現在準備中です。");
document.getElementById("backToModeBtn").onclick = () => showView("modeSelection");

/**
 * クイズ開始ボタン
 */
document.getElementById("startBtn").onclick = async function() {
    const btn = this; if (btn.disabled) return;
    try {
        btn.disabled = true; const originalText = btn.textContent; btn.textContent = "読み込み中...";
        window.speechSynthesis.cancel(); clearInterval(timerInterval);
        timeLimit = parseInt(document.getElementById("timerSelect").value);

        const file = document.getElementById("difficultySelect").value;
        allEntries = await loadCsv(file);
        let data = allEntries;

        // 苦手モードフィルタ
        if (document.getElementById("weakModeCheck").checked) {
            const weakIds = JSON.parse(localStorage.getItem("weakWords") || "[]");
            data = data.filter(item => weakIds.includes(item.number));
            if (!data.length) throw new Error("苦手単語がありません。");
        } else {
            // 範囲フィルタ
            const s = parseInt(document.getElementById("rangeStart").value), e = parseInt(document.getElementById("rangeEnd").value);
            if (!isNaN(s)) data = data.filter(item => item.number >= s);
            if (!isNaN(e)) data = data.filter(item => item.number <= e);
        }

        const countInput = parseInt(document.getElementById("countInput").value);
        const count = isNaN(countInput) ? 20 : countInput;
        quizEntries = data.sort(() => 0.5 - Math.random()).slice(0, count);
        if (quizEntries.length === 0) throw new Error("単語が見つかりませんでした。範囲設定を確認してください。");

        // 進捗ドットの生成
        dotContainer.innerHTML = "";
        quizEntries.forEach((_, i) => { const d = document.createElement("div"); d.className = "dot"; d.id = `dot-${i}`; dotContainer.appendChild(d); });
        currentIndex = 0; correctCount = 0; wrongAnswers = [];
        showView("quiz");
        document.getElementById("questionWord").textContent = ""; document.getElementById("progressText").textContent = "";
        choiceButtons.forEach(b => { b.textContent = ""; b.className = "choice"; });
        setTimeout(() => { loadQuestion(); btn.disabled = false; btn.textContent = originalText; }, 150);
    } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = "開始"; }
};

/**
 * CSVデータの強制再取得
 */
document.getElementById("forceUpdateBtn").onclick = async function() {
    const btn = this; const file = document.getElementById("difficultySelect").value;
    if (btn.disabled) return;
    btn.disabled = true; const originalText = "単語データを最新に更新する"; btn.textContent = "更新中...";
    try {
        const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000);
        await loadCsv(file, true); clearTimeout(timeoutId);
        btn.textContent = "✅ 更新完了！";
        setTimeout(() => { btn.disabled = false; btn.textContent = originalText; }, 1500);
    } catch (e) { btn.textContent = "❌ 更新失敗"; setTimeout(() => { btn.disabled = false; btn.textContent = originalText; }, 1500); }
};

/**
 * 次の問題への遷移、または結果表示
 */
nextBtn.onclick = () => {
    currentIndex++;
    if (currentIndex >= quizEntries.length) {
        window.speechSynthesis.cancel(); showView("result");
        document.getElementById("finalScore").textContent = `結果: ${correctCount} / ${quizEntries.length}`;
        if (correctCount === quizEntries.length && quizEntries.length > 0) {
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
            document.getElementById("resultTitle").textContent = "✨全問正解✨";
        } else { document.getElementById("resultTitle").textContent = "結果"; }
        const list = document.getElementById("wrongList"); list.innerHTML = "";
        if (wrongAnswers.length) {
            document.getElementById("reviewSection").classList.remove("hidden");
            wrongAnswers.forEach(w => { const li = document.createElement("li"); li.innerHTML = `<strong>${w.english}</strong> 正解: ${w.meaning}`; list.appendChild(li); });
        } else { document.getElementById("reviewSection").classList.add("hidden"); }
    } else loadQuestion();
};

/** 苦手単語数のバッジ表示更新 */
function updateWeakCountDisplay() { document.getElementById("weakCount").textContent = JSON.parse(localStorage.getItem("weakWords") || "[]").length; }

/**
 * 苦手リストから特定のIDを削除
 * @param {number} id - 単語の番号
 */
window.removeWeak = (id) => {
    let weakIds = JSON.parse(localStorage.getItem("weakWords") || "[]").filter(wid => wid !== id);
    localStorage.setItem("weakWords", JSON.stringify(weakIds));
    updateWeakCountDisplay();
    if (!document.getElementById("weakListModal").classList.contains("hidden")) document.getElementById("openWeakListBtn").onclick();
};

/**
 * 苦手リストモーダルの表示（背景スクロール一時解除）
 */
document.getElementById("openWeakListBtn").onclick = () => {
    const weakIds = JSON.parse(localStorage.getItem("weakWords") || "[]"), listEl = document.getElementById("fullWeakList");
    listEl.innerHTML = "";
    weakIds.forEach(id => {
        const entry = allEntries.find(e => e.number === id);
        if (entry) {
            const li = document.createElement("li"); li.style = "padding:10px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; font-size:0.85rem;";
            li.innerHTML = `<div><strong>${entry.english}</strong><br><small>${entry.meanings.slice(0, 2).join('/')}</small></div>
                            <div><button onclick="speak('${entry.english}')">🔊</button><button onclick="removeWeak(${entry.number})">🗑️</button></div>`;
            listEl.appendChild(li);
        }
    });
    document.getElementById("weakListModal").classList.remove("hidden");
    document.body.classList.remove("scroll-lock");
};

/**
 * モーダルを閉じる（クイズ中なら背景固定を再適用）
 */
document.getElementById("closeWeakListBtn").onclick = () => { 
    window.speechSynthesis.cancel(); document.getElementById("weakListModal").classList.add("hidden"); 
    if (!views.quiz.classList.contains("hidden")) document.body.classList.add("scroll-lock");
};

/** 履歴の全削除 */
document.getElementById("clearHistoryBtn").onclick = () => { if(confirm("履歴を削除？")) { localStorage.removeItem("weakWords"); updateWeakCountDisplay(); } };

/** 問題文タップで再読み上げ */
document.getElementById("questionWord").onclick = () => { if(quizEntries[currentIndex]) speak(quizEntries[currentIndex].english); };

/** 戻る/リスタート処理 */
document.getElementById("backBtn").onclick = () => { window.speechSynthesis.cancel(); clearInterval(timerInterval); showView("menu"); };
document.getElementById("restartBtn").onclick = () => { window.speechSynthesis.cancel(); showView("menu"); };

// 初期化表示
showView("password");