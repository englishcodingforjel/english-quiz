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
    result: document.getElementById("resultView"),
    grammarModeSelection: document.getElementById("grammarModeSelectionView"),
    grammarTypeSelection: document.getElementById("grammarTypeSelectionView"),
    grammarFillCategory: document.getElementById("grammarFillCategoryView"),
    grammarMenu: document.getElementById("grammarMenuView")
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

// 文法問題用の状態変数
let isGrammarMode = false;
let currentGrammarCategory = "";
let currentGrammarDifficulty = "standard";

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
 * お知らせデータ（CSVから読み込まれる）
 */
let announcements = [];

/**
 * お知らせCSVファイルを読み込む
 * @returns {Promise<Array>} お知らせデータの配列
 */
async function loadAnnouncements() {
    try {
        const res = await fetch("announcements.csv", { cache: "no-store" });
        const text = await res.text();
        const list = [];
        const lines = text.split(/\r?\n/);
        
        // ヘッダー行をスキップ（1行目）
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // CSVのパース（カンマ区切りだが、内容内にカンマがある可能性を考慮）
            const parts = [];
            let current = "";
            let inQuotes = false;
            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    parts.push(current.trim());
                    current = "";
                } else {
                    current += char;
                }
            }
            if (current) parts.push(current.trim());
            
            // 日付と内容が存在する場合のみ追加
            if (parts.length >= 2 && parts[0] && parts[1]) {
                list.push({
                    date: parts[0],
                    content: parts[1]
                });
            }
        }
        
        return list;
    } catch (e) {
        console.error("お知らせの読み込みに失敗しました:", e);
        return [];
    }
}

/**
 * お知らせリストを表示する
 */
async function renderAnnouncements() {
    const announcementList = document.getElementById("announcementList");
    if (!announcementList) return;
    
    // お知らせを読み込む
    announcements = await loadAnnouncements();
    
    if (announcements.length === 0) {
        announcementList.innerHTML = '<li style="padding: 10px; color: var(--text-muted); font-size: 0.85rem; text-align: center;">現在お知らせはありません</li>';
        return;
    }
    
    // 日付の新しい順にソート（最新が上）
    announcements.sort((a, b) => {
        const dateA = new Date(a.date.replace(/\//g, '-'));
        const dateB = new Date(b.date.replace(/\//g, '-'));
        return dateB - dateA;
    });
    
    announcementList.innerHTML = announcements.map(announcement => {
        return `
            <li>
                <span class="announcement-date">${announcement.date}</span>
                <span class="announcement-content">${announcement.content}</span>
            </li>
        `;
    }).join("");
}

/**
 * 指定したビューを表示し、他を隠す
 * @param {string} name - 表示するビューの名前
 */
function showView(name) {
    Object.keys(views).forEach(v => {
        if (views[v]) views[v].classList.add("hidden");
    });
    if (views[name]) views[name].classList.remove("hidden");
    document.getElementById("progressBarContainer").classList.toggle("hidden", name !== "quiz");
    // 文法問題の場合はスクロールを許可（解説が見えるように）
    if (name === "quiz") {
        if (isGrammarMode) {
            document.body.classList.remove("scroll-lock");
        } else {
            document.body.classList.add("scroll-lock");
        }
    } else {
        document.body.classList.remove("scroll-lock");
    }
    if (name === "menu") updateWeakCountDisplay();
    if (name === "modeSelection") renderAnnouncements();
    // タイトル更新
    if (name === "grammarModeSelection" || name === "grammarTypeSelection" || 
        name === "grammarFillCategory" || name === "grammarMenu" || 
        (name === "quiz" && isGrammarMode)) {
        document.getElementById("topTitle").textContent = "英文法クイズ";
    } else if (name === "menu" || (name === "quiz" && !isGrammarMode)) {
        document.getElementById("topTitle").textContent = "英単語クイズ";
    }
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
 * @param {boolean} isGrammar - 文法問題用のCSVかどうか
 * @returns {Promise<Array>} パース済みのデータ配列
 */
async function loadCsv(fileName, forceRefresh = false, isGrammar = false) {
    if (csvCache[fileName] && !forceRefresh) return csvCache[fileName];
    const url = forceRefresh ? `${fileName}?v=${Date.now()}` : fileName;
    try {
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text();
        const list = [];
        text.split(/\r?\n/).forEach(line => {
            if (!line.trim()) return;
            // CSVのパース（カンマ区切りだが、問題文内にカンマがある可能性を考慮）
            const parts = [];
            let current = "";
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    parts.push(current.trim());
                    current = "";
                } else {
                    current += char;
                }
            }
            if (current) parts.push(current.trim());
            
            const num = parseInt(parts[0]);
            if (!isNaN(num)) {
                if (isGrammar) {
                    // 文法問題フォーマット: 問題番号、問題、回答選択肢、不正解選択肢１、不正解選択肢２、不正解選択肢３、出典大学、難易度、解説
                    if (parts.length >= 6) {
                        const correct = parts[2];
                        const wrongChoices = parts.slice(3, 6).filter(c => c);
                        const allChoices = [correct, ...wrongChoices];
                        const source = parts[6] || "";
                        const difficulty = parts[7] || "";
                        const explanation = parts[8] || "";
                        list.push({
                            number: num,
                            question: parts[1],
                            correct: correct,
                            choices: allChoices,
                            source: source,
                            difficulty: difficulty,
                            explanation: explanation
                        });
                    }
                } else {
                    // 単語問題フォーマット: 番号, 英語, 意味1, 意味2, ...
                    const meanings = parts.slice(2).filter(m => m);
                    if (meanings.length) list.push({ number: num, english: parts[1], meanings });
                }
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
    
    if (isGrammarMode) {
        // 文法問題の回答処理
        const correctAnswer = entry.correct;
        const selectedAnswer = idx !== -1 ? currentChoicesData[idx] : null;
        
        if (idx !== -1 && selectedAnswer === correctAnswer) {
            choiceButtons[idx].classList.add("correct"); correctCount++; 
            if (dot) dot.classList.add("correct");
        } else {
            if (idx !== -1) choiceButtons[idx].classList.add("wrong");
            const correctIdx = currentChoicesData.findIndex(c => c === correctAnswer);
            if (correctIdx !== -1) choiceButtons[correctIdx].classList.add("correct");
            wrongAnswers.push({ question: entry.question, correct: correctAnswer });
            if (dot) dot.classList.add("wrong");
        }
        
        // 解説を表示
        showExplanation(entry.explanation);
    } else {
        // 単語問題の回答処理
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
    if (isGrammarMode) {
        // 文法問題の選択肢構築（ランダムに並べ替え）
        const choices = [...correctEntry.choices];
        return choices.sort(() => 0.5 - Math.random());
    } else {
        // 単語問題の選択肢構築
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
}

/**
 * 解説を表示する
 * @param {string} explanation - 解説テキスト
 */
function showExplanation(explanation) {
    const explanationBox = document.getElementById("explanationBox");
    const explanationText = document.getElementById("explanationText");
    
    if (explanation && explanation.trim()) {
        explanationText.textContent = explanation;
        explanationBox.classList.remove("hidden");
    } else {
        hideExplanation();
    }
}

/**
 * 解説を非表示にする
 */
function hideExplanation() {
    const explanationBox = document.getElementById("explanationBox");
    explanationBox.classList.add("hidden");
}

/**
 * 問題を表示し、音声合成とタイマーを開始する
 */
function loadQuestion() {
    answered = false; nextBtn.disabled = true;
    const entry = quizEntries[currentIndex];
    const choicesGrid = document.getElementById("choicesGrid");
    
    // まず解説を非表示にする（レイアウト変更を防ぐため最初に）
    hideExplanation();
    
    // 選択肢を完全に非表示（visibilityでレイアウトを保ったまま非表示）
    choicesGrid.style.visibility = "hidden";
    choicesGrid.style.opacity = "0";
    
    // 選択肢を完全にリセット
    choiceButtons.forEach((btn) => { 
        // クラスを完全にリセット
        btn.className = "choice"; 
        btn.disabled = true;
        btn.textContent = "";
        btn.onclick = null;
        // インラインスタイルも完全にリセット
        btn.style.backgroundColor = "";
        btn.style.borderColor = "";
        btn.style.color = "";
        btn.style.transform = "";
        btn.style.boxShadow = "";
        // ハードウェアアクセラレーションをリセット
        btn.style.willChange = "";
    });
    
    document.getElementById("questionWord").textContent = "";
    document.getElementById("questionSource").textContent = "";
    document.getElementById("questionSource").style.display = "none";
    
    // 進捗表示を更新
    document.querySelectorAll(".dot").forEach(d => d.classList.remove("current"));
    const dot = document.getElementById(`dot-${currentIndex}`); if (dot) dot.classList.add("current");
    document.getElementById("progressText").textContent = `Q ${currentIndex + 1} / ${quizEntries.length}`;
    
    const questionContainer = document.getElementById("questionContainer");
    const questionSource = document.getElementById("questionSource");
    
    if (isGrammarMode) {
        // 文法問題の表示（即座に表示、遅延なし）
        questionContainer.classList.add("grammar-mode");
        document.getElementById("questionWord").textContent = entry.question;
        // 出典大学を表示
        if (entry.source && entry.source.trim()) {
            questionSource.textContent = `(${entry.source})`;
            questionSource.style.display = "block";
        } else {
            questionSource.textContent = "";
            questionSource.style.display = "none";
        }
        currentChoicesData = buildChoices(entry);
        choiceButtons.forEach((btn, i) => { 
            btn.textContent = currentChoicesData[i]; 
            btn.className = "choice"; 
            btn.disabled = false; 
            btn.onclick = () => handleAnswer(i); 
        });
        // 選択肢を即座に表示
        choicesGrid.style.visibility = "visible";
        choicesGrid.style.opacity = "1";
        document.getElementById("timerBarContainer").classList.add("hidden");
    } else {
        // 単語問題の表示（即座に表示、遅延なし）
        questionContainer.classList.remove("grammar-mode");
        document.getElementById("questionWord").textContent = entry.english;
        questionSource.textContent = "";
        questionSource.style.display = "none";
        currentChoicesData = buildChoices(entry);
        choiceButtons.forEach((btn, i) => { 
            btn.textContent = currentChoicesData[i].display; 
            btn.className = "choice"; 
            btn.disabled = false; 
            btn.onclick = () => handleAnswer(i); 
        });
        // 選択肢を即座に表示
        choicesGrid.style.visibility = "visible";
        choicesGrid.style.opacity = "1";
        speak(entry.english);
        startTimer();
    }
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
document.getElementById("selectVocabBtn").onclick = () => { isGrammarMode = false; showView("menu"); };
document.getElementById("selectGrammarBtn").onclick = () => { isGrammarMode = true; showView("grammarModeSelection"); };
document.getElementById("backToModeBtn").onclick = () => showView("modeSelection");

// 文法モード選択
document.getElementById("selectGrammarProblemBtn").onclick = () => showView("grammarTypeSelection");
document.getElementById("backToMainModeBtn").onclick = () => { isGrammarMode = false; showView("modeSelection"); };

// 文法問題タイプ選択
document.getElementById("selectFillBlankBtn").onclick = () => showView("grammarFillCategory");
document.getElementById("backToGrammarModeBtn").onclick = () => showView("grammarModeSelection");

// 空所補充カテゴリ選択
document.querySelectorAll(".grammar-category-btn").forEach(btn => {
    // 無効化されたボタン（disabled-modeクラスがある）はクリックできないようにする
    if (btn.classList.contains("disabled-mode")) {
        btn.onclick = null;
        return;
    }
    btn.onclick = () => {
        currentGrammarCategory = btn.dataset.category;
        showView("grammarMenu");
    };
});
document.getElementById("backToGrammarTypeBtn").onclick = () => showView("grammarTypeSelection");
document.getElementById("backToGrammarCategoryBtn").onclick = () => showView("grammarFillCategory");

/**
 * 選択肢を完全にリセットする関数
 */
function resetChoicesCompletely() {
    const choicesGrid = document.getElementById("choicesGrid");
    const questionContainer = document.getElementById("questionContainer");
    
    // 選択肢を完全に非表示
    choicesGrid.style.visibility = "hidden";
    choicesGrid.style.opacity = "0";
    
    // 選択肢を完全にリセット
    choiceButtons.forEach((btn) => { 
        btn.className = "choice"; 
        btn.disabled = true;
        btn.textContent = "";
        btn.onclick = null;
        btn.style.backgroundColor = "";
        btn.style.borderColor = "";
        btn.style.color = "";
        btn.style.transform = "";
        btn.style.boxShadow = "";
        btn.style.willChange = "";
    });
    
    // 問題文もリセット
    if (questionContainer) {
        document.getElementById("questionWord").textContent = "";
        const questionSource = document.getElementById("questionSource");
        if (questionSource) {
            questionSource.textContent = "";
            questionSource.style.display = "none";
        }
    }
    
    // 解説も非表示
    hideExplanation();
}

/**
 * クイズ開始ボタン（単語問題）
 */
document.getElementById("startBtn").onclick = async function() {
    const btn = this; if (btn.disabled) return;
    try {
        // まず選択肢を完全にリセット
        resetChoicesCompletely();
        
        btn.disabled = true; const originalText = btn.textContent; btn.textContent = "読み込み中...";
        window.speechSynthesis.cancel(); clearInterval(timerInterval);
        timeLimit = parseInt(document.getElementById("timerSelect").value);

        const file = document.getElementById("difficultySelect").value;
        allEntries = await loadCsv(file, false, false);
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
        // 選択肢を完全にリセット（showViewの後）
        resetChoicesCompletely();
        document.getElementById("questionWord").textContent = ""; document.getElementById("progressText").textContent = "";
        // 単語問題も即座に表示（遅延なし）
        loadQuestion(); 
        btn.disabled = false; 
        btn.textContent = originalText;
    } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = "開始"; }
};

/**
 * 文法問題開始ボタン
 */
document.getElementById("grammarStartBtn").onclick = async function() {
    const btn = this; if (btn.disabled) return;
    const originalText = btn.textContent;
    try {
        btn.disabled = true; 
        btn.textContent = "読み込み中...";
        window.speechSynthesis.cancel(); 
        clearInterval(timerInterval);
        
        currentGrammarDifficulty = document.getElementById("grammarDifficultySelect").value;
        const fileName = `grammar_${currentGrammarCategory}_fill.csv`;
        
        allEntries = await loadCsv(fileName, false, true);
        let data = allEntries;
        
        // 難易度フィルタ（基礎=1、標準=2、応用=3）
        const difficultyMap = { basic: "1", standard: "2", advanced: "3" };
        const targetDifficulty = difficultyMap[currentGrammarDifficulty];
        if (targetDifficulty) {
            data = data.filter(item => item.difficulty === targetDifficulty);
        }
        
        if (data.length === 0) {
            throw new Error("選択した難易度の問題が見つかりませんでした。");
        }
        
        const countInput = parseInt(document.getElementById("grammarCountInput").value);
        const count = isNaN(countInput) ? 20 : countInput;
        quizEntries = data.sort(() => 0.5 - Math.random()).slice(0, count);
        
        if (quizEntries.length === 0) {
            throw new Error("問題が見つかりませんでした。");
        }

        // 進捗ドットの生成
        dotContainer.innerHTML = "";
        quizEntries.forEach((_, i) => { const d = document.createElement("div"); d.className = "dot"; d.id = `dot-${i}`; dotContainer.appendChild(d); });
        currentIndex = 0; correctCount = 0; wrongAnswers = [];
        showView("quiz");
        // 選択肢を完全にリセット（showViewの後）
        resetChoicesCompletely();
        document.getElementById("questionWord").textContent = ""; document.getElementById("progressText").textContent = "";
        // 文法問題の場合は即座に表示（遅延なし）
        loadQuestion(); 
        btn.disabled = false; 
        btn.textContent = originalText;
    } catch (e) { 
        alert(e.message || "問題の読み込みに失敗しました。"); 
        btn.disabled = false; 
        btn.textContent = originalText; 
    }
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
        document.getElementById("restartBtn").textContent = isGrammarMode ? "文法設定へ" : "単語設定へ";
        const list = document.getElementById("wrongList"); list.innerHTML = "";
        if (wrongAnswers.length) {
            document.getElementById("reviewSection").classList.remove("hidden");
            wrongAnswers.forEach(w => { 
                const li = document.createElement("li"); 
                if (isGrammarMode) {
                    li.innerHTML = `<strong>${w.question}</strong><br>正解: ${w.correct}`; 
                } else {
                    li.innerHTML = `<strong>${w.english}</strong> 正解: ${w.meaning}`; 
                }
                list.appendChild(li); 
            });
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
 * モーダルを閉じる（クイズ中なら背景固定を再適用、ただし文法問題の場合はスクロール許可）
 */
document.getElementById("closeWeakListBtn").onclick = () => { 
    window.speechSynthesis.cancel(); document.getElementById("weakListModal").classList.add("hidden"); 
    if (!views.quiz.classList.contains("hidden")) {
        // 文法問題の場合はスクロールを許可
        if (isGrammarMode) {
            document.body.classList.remove("scroll-lock");
        } else {
            document.body.classList.add("scroll-lock");
        }
    }
};

/** 履歴の全削除 */
document.getElementById("clearHistoryBtn").onclick = () => { if(confirm("履歴を削除？")) { localStorage.removeItem("weakWords"); updateWeakCountDisplay(); } };

/** 問題文タップで再読み上げ（単語問題のみ） */
document.getElementById("questionWord").onclick = () => { 
    if(quizEntries[currentIndex] && !isGrammarMode) {
        speak(quizEntries[currentIndex].english); 
    }
};

/** 戻る/リスタート処理 */
document.getElementById("backBtn").onclick = () => { 
    window.speechSynthesis.cancel(); 
    clearInterval(timerInterval); 
    if (isGrammarMode) {
        // 文法メニューに戻る際に開始ボタンの状態をリセット
        const grammarStartBtn = document.getElementById("grammarStartBtn");
        if (grammarStartBtn) {
            grammarStartBtn.disabled = false;
            grammarStartBtn.textContent = "開始";
        }
        showView("grammarMenu");
    } else {
        // 単語メニューに戻る際に開始ボタンの状態をリセット
        const startBtn = document.getElementById("startBtn");
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.textContent = "開始";
        }
        showView("menu");
    }
};
document.getElementById("restartBtn").onclick = () => { 
    window.speechSynthesis.cancel(); 
    if (isGrammarMode) {
        // 文法メニューに戻る際に開始ボタンの状態をリセット
        const grammarStartBtn = document.getElementById("grammarStartBtn");
        if (grammarStartBtn) {
            grammarStartBtn.disabled = false;
            grammarStartBtn.textContent = "開始";
        }
        showView("grammarMenu");
    } else {
        // 単語メニューに戻る際に開始ボタンの状態をリセット
        const startBtn = document.getElementById("startBtn");
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.textContent = "開始";
        }
        showView("menu");
    }
};

// 初期化表示
showView("password");