/**
 * @fileoverview 英単語クイズアプリケーションのメインロジック
 * 画面遷移、CSVデータの取得、音声合成、苦手単語の永続化、クイズロジックを管理します。
 */

"use strict";

// ==================== 定数定義 ====================
const PASSWORD = "tkg";
const DEFAULT_QUESTION_COUNT = 20;
const TIMER_UPDATE_INTERVAL = 50;
const SPEECH_DELAY = 50;
const TIMER_UPDATE_TIMEOUT = 5000;
const DIFFICULTY_MAP = { basic: "1", standard: "2", advanced: "3" };
const GRAMMAR_VIEWS = ["grammarModeSelection", "grammarTypeSelection", "grammarFillCategory", "grammarMenu"];
const WEAK_WORD_STATS_KEY = "weakWordStats";
const VOICE_ENABLED_KEY = "voiceEnabled";
const VOCAB_DIRECTION_KEY = "vocabDirection";
const ANSWER_MODE_KEY = "answerMode";

// ==================== DOM要素の取得 ====================
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

const topScore = document.getElementById("topScore");
const timerBar = document.getElementById("timerBar");
const dotContainer = document.getElementById("dotProgress");
const choiceButtons = Array.from(document.querySelectorAll(".choice"));
const nextBtn = document.getElementById("nextBtn");
const topTitle = document.getElementById("topTitle");
const questionWord = document.getElementById("questionWord");
const questionSource = document.getElementById("questionSource");
const questionContainer = document.getElementById("questionContainer");
const choicesGrid = document.getElementById("choicesGrid");
const progressText = document.getElementById("progressText");
const timerBarContainer = document.getElementById("timerBarContainer");
const progressBarContainer = document.getElementById("progressBarContainer");
const typingAnswerArea = document.getElementById("typingAnswerArea");
const typingSlots = document.getElementById("typingSlots");
const typingCorrectAnswer = document.getElementById("typingCorrectAnswer");
const typingAnswerInput = document.getElementById("typingAnswerInput");
const pronounceHintBtn = document.getElementById("pronounceHintBtn");

// ==================== 状態変数 ====================
let allEntries = [];
let quizEntries = [];
let currentIndex = 0;
let correctCount = 0;
let wrongAnswers = [];
let answerHistory = [];
let currentChoicesData = [];
let answered = false;
let timerInterval = null;
let timeLimit = 0;
let csvCache = {};
let announcements = [];
let isGrammarMode = false;
let currentGrammarCategory = "";
let currentGrammarDifficulty = "standard";
let vocabDirection = localStorage.getItem(VOCAB_DIRECTION_KEY) || "enToJa";
let answerMode = localStorage.getItem(ANSWER_MODE_KEY) || "choice";

// ==================== ユーティリティ関数 ====================

/**
 * CSV行をパースする（引用符内のカンマを考慮）
 * @param {string} line - CSV行
 * @returns {Array<string>} パースされたフィールドの配列
 */
function parseCsvLine(line) {
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
    return parts;
}

/**
 * 苦手単語リストを取得
 * @returns {Array<number>} 苦手単語のID配列
 */
function getWeakWords() {
    try {
        const weakWords = JSON.parse(localStorage.getItem("weakWords") || "[]");
        return Array.isArray(weakWords) ? weakWords : [];
    } catch (e) {
        return [];
    }
}

/**
 * 苦手単語を保存
 * @param {number} id - 単語の番号
 */
function saveWeakWord(id) {
    const weakIds = getWeakWords();
    if (!weakIds.includes(id)) {
        weakIds.push(id);
        localStorage.setItem("weakWords", JSON.stringify(weakIds));
    }
}

/**
 * 苦手単語の学習統計を取得
 * @returns {Object} 単語IDごとの統計オブジェクト
 */
function getWeakWordStats() {
    try {
        const stats = JSON.parse(localStorage.getItem(WEAK_WORD_STATS_KEY) || "{}");
        return stats && typeof stats === "object" && !Array.isArray(stats) ? stats : {};
    } catch (e) {
        return {};
    }
}

/**
 * 苦手単語の学習統計を保存
 * @param {Object} stats - 単語IDごとの統計オブジェクト
 */
function saveWeakWordStats(stats) {
    localStorage.setItem(WEAK_WORD_STATS_KEY, JSON.stringify(stats));
}

/**
 * 単語の回答結果を学習統計に反映
 * @param {number} id - 単語の番号
 * @param {boolean} isCorrect - 正解したかどうか
 */
function recordWordAttempt(id, isCorrect) {
    const stats = getWeakWordStats();
    const key = String(id);
    const current = stats[key] || {
        attempts: 0,
        correct: 0,
        wrong: 0,
        streak: 0,
        lastStudiedAt: ""
    };
    
    current.attempts += 1;
    current.lastStudiedAt = new Date().toISOString();
    
    if (isCorrect) {
        current.correct += 1;
        current.streak += 1;
    } else {
        current.wrong += 1;
        current.streak = 0;
    }
    
    stats[key] = current;
    saveWeakWordStats(stats);
}

/**
 * 正答率をパーセント表記で返す
 * @param {Object} stat - 単語の統計
 * @returns {string} 正答率
 */
function getAccuracyText(stat) {
    if (!stat || !stat.attempts) return "-";
    return `${Math.round((stat.correct / stat.attempts) * 100)}%`;
}

/**
 * 最終学習日を表示用に整形
 * @param {string} isoText - ISO形式の日時
 * @returns {string} 表示用の日付
 */
function formatLastStudiedAt(isoText) {
    if (!isoText) return "-";
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
}

/**
 * ボイス設定がオンかどうか
 * @returns {boolean} ボイスが有効かどうか
 */
function isVoiceEnabled() {
    return localStorage.getItem(VOICE_ENABLED_KEY) !== "false";
}

/**
 * ボイス設定の初期化
 */
function initVoiceToggle() {
    const voiceToggle = document.getElementById("voiceToggleCheck");
    if (!voiceToggle) return;
    const voiceLabel = document.querySelector(".voice-label");
    const updateVoiceLabel = () => {
        if (voiceLabel) voiceLabel.textContent = voiceToggle.checked ? "ボイスON" : "ボイスOFF";
    };
    
    voiceToggle.checked = isVoiceEnabled();
    updateVoiceLabel();
    voiceToggle.onchange = () => {
        localStorage.setItem(VOICE_ENABLED_KEY, voiceToggle.checked ? "true" : "false");
        updateVoiceLabel();
        if (!voiceToggle.checked && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    };
}

/**
 * 単語クイズの出題方向・回答形式UIを初期化
 */
function initVocabModeControls() {
    const directionButtons = Array.from(document.querySelectorAll("[data-vocab-direction]"));
    const answerButtons = Array.from(document.querySelectorAll("[data-answer-mode]"));
    const answerModeArea = document.getElementById("answerModeArea");
    
    const render = () => {
        directionButtons.forEach(btn => {
            btn.classList.toggle("active", btn.dataset.vocabDirection === vocabDirection);
        });
        answerButtons.forEach(btn => {
            btn.classList.toggle("active", btn.dataset.answerMode === answerMode);
        });
        if (answerModeArea) {
            answerModeArea.classList.toggle("hidden", vocabDirection !== "jaToEn");
        }
    };
    
    directionButtons.forEach(btn => {
        btn.onclick = () => {
            vocabDirection = btn.dataset.vocabDirection;
            localStorage.setItem(VOCAB_DIRECTION_KEY, vocabDirection);
            if (vocabDirection === "enToJa") {
                answerMode = "choice";
                localStorage.setItem(ANSWER_MODE_KEY, answerMode);
            }
            render();
        };
    });
    
    answerButtons.forEach(btn => {
        btn.onclick = () => {
            answerMode = btn.dataset.answerMode;
            localStorage.setItem(ANSWER_MODE_KEY, answerMode);
            render();
        };
    });
    
    if (vocabDirection === "enToJa") {
        answerMode = "choice";
        localStorage.setItem(ANSWER_MODE_KEY, answerMode);
    }
    render();
}

/**
 * CSVなどのテキストファイルを読み込む
 * file://で開いている場合は、csv-data.jsに同梱したデータを使う
 * @param {string} fileName - 読み込むファイル名
 * @param {boolean} forceRefresh - キャッシュを無視して読み込むか
 * @returns {Promise<string>} ファイル本文
 */
async function loadTextFile(fileName, forceRefresh = false) {
    if (window.location.protocol === "file:" && window.CSV_TEXTS && window.CSV_TEXTS[fileName]) {
        return window.CSV_TEXTS[fileName];
    }
    
    const url = forceRefresh ? `${fileName}?v=${Date.now()}` : fileName;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
        throw new Error(`${fileName} を読み込めませんでした。`);
    }
    return res.text();
}

/**
 * 開始ボタンの状態をリセット
 * @param {HTMLElement} btn - リセットするボタン要素
 */
function resetStartButton(btn) {
    if (btn) {
        btn.disabled = false;
        btn.textContent = "開始";
    }
}

/**
 * スクロールロックの状態を更新
 * @param {boolean} shouldLock - ロックするかどうか
 */
function updateScrollLock(shouldLock) {
    if (shouldLock && !isGrammarMode) {
        document.body.classList.add("scroll-lock");
    } else {
        document.body.classList.remove("scroll-lock");
    }
}

// ==================== テーマ管理 ====================

/**
 * ダークモードの初期化と切り替え
 */
function initTheme() {
    const themeToggle = document.getElementById("themeToggle");
    const isDark = localStorage.getItem("theme") === "dark";
    
    if (isDark) {
        document.body.classList.add("dark-mode");
        themeToggle.textContent = "☀️";
    }
    
    themeToggle.onclick = () => {
        document.body.classList.toggle("dark-mode");
        const isDarkMode = document.body.classList.contains("dark-mode");
        themeToggle.textContent = isDarkMode ? "☀️" : "🌙";
        localStorage.setItem("theme", isDarkMode ? "dark" : "light");
    };
}

// ==================== お知らせ管理 ====================

/**
 * お知らせCSVファイルを読み込む
 * @returns {Promise<Array>} お知らせデータの配列
 */
async function loadAnnouncements() {
    try {
        const text = await loadTextFile("announcements.csv");
        const lines = text.split(/\r?\n/);
        const list = [];
        
        // ヘッダー行をスキップ（1行目）
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const parts = parseCsvLine(line);
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
        return null;
    }
}

/**
 * お知らせリストを表示する
 */
async function renderAnnouncements() {
    const announcementList = document.getElementById("announcementList");
    if (!announcementList) return;
    
    announcements = await loadAnnouncements();
    
    if (announcements === null) {
        announcementList.innerHTML = '<li style="padding: 10px; color: var(--red); font-size: 0.85rem; text-align: center;">お知らせを読み込めませんでした</li>';
        return;
    }
    
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
    
    announcementList.innerHTML = announcements.map(announcement => `
        <li>
            <span class="announcement-date">${announcement.date}</span>
            <span class="announcement-content">${announcement.content}</span>
        </li>
    `).join("");
}

// ==================== ビュー管理 ====================

/**
 * タイトルを更新
 * @param {string} viewName - 現在のビュー名
 */
function updateTitle(viewName) {
    const isGrammarView = GRAMMAR_VIEWS.includes(viewName) || (viewName === "quiz" && isGrammarMode);
    topTitle.textContent = isGrammarView ? "英文法クイズ" : "英単語クイズ";
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
    
    progressBarContainer.classList.toggle("hidden", name !== "quiz");
    updateScrollLock(name === "quiz");
    
    if (name === "menu") updateWeakCountDisplay();
    if (name === "modeSelection") renderAnnouncements();
    
    updateTitle(name);
}

// ==================== 音声合成 ====================

/**
 * 英語の読み上げを行う
 * @param {string} text - 読み上げる文字列
 */
function speak(text) {
    if (!isVoiceEnabled()) return;
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setTimeout(() => {
        const uttr = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const usVoice = voices.find(v => v.lang.startsWith('en-US') && v.name.includes('Samantha')) || 
                        voices.find(v => v.lang.startsWith('en-US'));
        if (usVoice) uttr.voice = usVoice;
        uttr.lang = 'en-US';
        uttr.rate = 1.0;
        window.speechSynthesis.speak(uttr);
    }, SPEECH_DELAY);
}

// ==================== CSV読み込み ====================

/**
 * CSVファイルを読み込み、オブジェクトの配列として返す
 * @param {string} fileName - 読み込むCSVのファイルパス
 * @param {boolean} forceRefresh - キャッシュを無視してサーバーから再取得するか
 * @param {boolean} isGrammar - 文法問題用のCSVかどうか
 * @returns {Promise<Array>} パース済みのデータ配列
 */
async function loadCsv(fileName, forceRefresh = false, isGrammar = false) {
    if (csvCache[fileName] && !forceRefresh) return csvCache[fileName];
    
    try {
        const text = await loadTextFile(fileName, forceRefresh);
        const list = [];
        
        text.split(/\r?\n/).forEach(line => {
            if (!line.trim()) return;
            
            const parts = parseCsvLine(line);
            const num = parseInt(parts[0]);
            if (isNaN(num)) return;
            
            if (isGrammar) {
                // 文法問題フォーマット: 問題番号、問題、回答選択肢、不正解選択肢１、不正解選択肢２、不正解選択肢３、出典大学、難易度、解説
                if (parts.length >= 6) {
                    const correct = parts[2];
                    const wrongChoices = parts.slice(3, 6).filter(c => c);
                    list.push({
                        number: num,
                        question: parts[1],
                        correct: correct,
                        choices: [correct, ...wrongChoices],
                        source: parts[6] || "",
                        difficulty: parts[7] || "",
                        explanation: parts[8] || ""
                    });
                }
            } else {
                // 単語問題フォーマット: 番号, 英語, 意味1, 意味2, ...
                const meanings = parts.slice(2).filter(m => m);
                if (meanings.length) {
                    list.push({
                        number: num,
                        english: parts[1],
                        meanings
                    });
                }
            }
        });
        
        csvCache[fileName] = list;
        return list;
    } catch (e) {
        console.error(`${fileName} の読み込みに失敗しました:`, e);
        throw new Error(e.message || `${fileName} の読み込みに失敗しました。`);
    }
}

// ==================== クイズロジック ====================

/**
 * 回答を判定し、UIを更新する
 * @param {number} idx - クリックされたボタンのインデックス (-1は時間切れ)
 */
function handleAnswer(idx) {
    if (answered) return;
    if (shouldUseTypingMode()) {
        handleTypingAnswer(false);
        return;
    }
    answered = true;
    clearInterval(timerInterval);
    choiceButtons.forEach(b => b.disabled = true);
    
    const entry = quizEntries[currentIndex];
    const dot = document.getElementById(`dot-${currentIndex}`);
    
    if (isGrammarMode) {
        handleGrammarAnswer(idx, entry, dot);
    } else {
        handleVocabAnswer(idx, entry, dot);
    }
    
    topScore.textContent = `正解: ${correctCount}`;
    nextBtn.disabled = false;
}

function handleTypingAnswer(isCorrect) {
    if (answered) return;
    answered = true;
    clearInterval(timerInterval);
    
    const entry = quizEntries[currentIndex];
    const dot = document.getElementById(`dot-${currentIndex}`);
    const correctMeaning = formatMeaning(entry);
    
    recordWordAttempt(entry.number, isCorrect);
    answerHistory.push({
        english: entry.english,
        meaning: correctMeaning,
        isCorrect
    });
    
    if (isCorrect) {
        correctCount++;
        typingAnswerArea.classList.add("correct");
        if (dot) dot.classList.add("correct");
    } else {
        typingAnswerArea.classList.add("wrong");
        wrongAnswers.push({
            english: entry.english,
            meaning: correctMeaning
        });
        saveWeakWord(entry.number);
        if (dot) dot.classList.add("wrong");
    }
    
    typingCorrectAnswer.textContent = entry.english;
    typingCorrectAnswer.classList.remove("hidden");
    typingAnswerInput.disabled = true;
    topScore.textContent = `正解: ${correctCount}`;
    nextBtn.disabled = false;
}

/**
 * 文法問題の回答処理
 * @param {number} idx - 選択されたインデックス
 * @param {Object} entry - 問題エントリ
 * @param {HTMLElement} dot - 進捗ドット要素
 */
function handleGrammarAnswer(idx, entry, dot) {
    const correctAnswer = entry.correct;
    const selectedAnswer = idx !== -1 ? currentChoicesData[idx] : null;
    
    if (idx !== -1 && selectedAnswer === correctAnswer) {
        choiceButtons[idx].classList.add("correct");
        correctCount++;
        if (dot) dot.classList.add("correct");
    } else {
        if (idx !== -1) choiceButtons[idx].classList.add("wrong");
        const correctIdx = currentChoicesData.findIndex(c => c === correctAnswer);
        if (correctIdx !== -1) choiceButtons[correctIdx].classList.add("correct");
        wrongAnswers.push({ question: entry.question, correct: correctAnswer });
        if (dot) dot.classList.add("wrong");
    }
    
    showExplanation(entry.explanation);
}

/**
 * 単語問題の回答処理
 * @param {number} idx - 選択されたインデックス
 * @param {Object} entry - 問題エントリ
 * @param {HTMLElement} dot - 進捗ドット要素
 */
function handleVocabAnswer(idx, entry, dot) {
    const correctIdx = currentChoicesData.findIndex(c => c.entry === entry);
    const isCorrect = idx !== -1 && currentChoicesData[idx].entry === entry;
    const correctMeaning = currentChoicesData[correctIdx].display;
    recordWordAttempt(entry.number, isCorrect);
    answerHistory.push({
        english: entry.english,
        meaning: correctMeaning,
        isCorrect
    });
    
    if (isCorrect) {
        choiceButtons[idx].classList.add("correct");
        correctCount++;
        if (dot) dot.classList.add("correct");
    } else {
        if (idx !== -1) choiceButtons[idx].classList.add("wrong");
        choiceButtons[correctIdx].classList.add("correct");
        wrongAnswers.push({
            english: entry.english,
            meaning: correctMeaning
        });
        saveWeakWord(entry.number);
        if (dot) dot.classList.add("wrong");
    }
}

/**
 * 制限時間タイマーの開始
 */
function startTimer() {
    clearInterval(timerInterval);
    if (timeLimit <= 0) {
        timerBarContainer.classList.add("hidden");
        return;
    }
    
    timerBarContainer.classList.remove("hidden");
    const startTime = Date.now();
    const duration = timeLimit * 1000;
    
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        timerBar.style.width = Math.max(0, 100 - (elapsed / duration) * 100) + "%";
        if (elapsed >= duration) {
            clearInterval(timerInterval);
            handleAnswer(-1);
        }
    }, TIMER_UPDATE_INTERVAL);
}

/**
 * 単語の日本語訳を問題文・レビュー用に整形
 * @param {Object} entry - 単語エントリ
 * @returns {string} 表示用の日本語訳
 */
function formatMeaning(entry) {
    const parts = entry.meanings.join('、').split('、').filter(s => s.trim());
    return parts.length > 1 ? `${parts[0]} / ${parts[1]}` : parts[0];
}

function shouldUseTypingMode() {
    return !isGrammarMode && vocabDirection === "jaToEn" && answerMode === "typing";
}

function normalizeTypingAnswer(text) {
    return text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function getTypingTarget(entry) {
    return normalizeTypingAnswer(entry.english);
}

function focusTypingInput() {
    if (!typingAnswerInput || typingAnswerInput.disabled) return;
    typingAnswerInput.focus({ preventScroll: true });
    typingAnswerInput.click();
}

function renderTypingSlots(entry, inputText = "") {
    const typed = normalizeTypingAnswer(inputText);
    let typedIndex = 0;
    typingSlots.innerHTML = "";
    
    Array.from(entry.english).forEach(char => {
        if (/[a-z0-9]/i.test(char.normalize("NFKC"))) {
            const slot = document.createElement("span");
            slot.className = "typing-slot";
            const value = typed[typedIndex] || "";
            if (value) {
                slot.textContent = value;
                slot.classList.add("filled");
            }
            typingSlots.appendChild(slot);
            typedIndex++;
        } else if (char.trim()) {
            const separator = document.createElement("span");
            separator.className = "typing-separator";
            separator.textContent = char;
            typingSlots.appendChild(separator);
        } else {
            const separator = document.createElement("span");
            separator.className = "typing-separator";
            separator.textContent = "";
            typingSlots.appendChild(separator);
        }
    });
}

/**
 * 現在の問題に対する4つの選択肢を構築する
 * @param {Object} correctEntry - 正解の単語オブジェクト
 * @returns {Array} 選択肢オブジェクトの配列
 */
function buildChoices(correctEntry) {
    if (isGrammarMode) {
        const choices = [...correctEntry.choices];
        return choices.sort(() => 0.5 - Math.random());
    } else {
        const picks = [correctEntry];
        const usedIds = new Set([correctEntry.number]);
        const correctIndex = allEntries.findIndex(e => e.number === correctEntry.number);
        const rangeStart = correctIndex === -1 ? 0 : Math.max(0, correctIndex - 20);
        const rangeEnd = correctIndex === -1 ? allEntries.length : Math.min(allEntries.length, correctIndex + 21);
        let candidates = allEntries
            .slice(rangeStart, rangeEnd)
            .filter(e => e.number !== correctEntry.number);
        
        // 先頭・末尾付近やデータ不足で3択分が足りない場合だけ、全体から補充する
        if (candidates.length < 3) {
            const extraCandidates = allEntries.filter(e =>
                e.number !== correctEntry.number &&
                !candidates.some(c => c.number === e.number)
            );
            candidates = candidates.concat(extraCandidates);
        }
        
        candidates.sort(() => 0.5 - Math.random());
        
        for (const c of candidates) {
            if (picks.length >= 4) break;
            if (!usedIds.has(c.number)) {
                picks.push(c);
                usedIds.add(c.number);
            }
        }
        
        return picks.map(entry => ({
            entry,
            display: formatMeaning(entry)
        })).sort(() => 0.5 - Math.random());
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
 * 選択肢ボタンをリセット
 */
function resetChoiceButtons() {
    choiceButtons.forEach(btn => {
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
}

/**
 * 選択肢を完全にリセットする関数
 */
function resetChoicesCompletely() {
    choicesGrid.classList.remove("hidden");
    choicesGrid.style.visibility = "hidden";
    choicesGrid.style.opacity = "0";
    resetChoiceButtons();
    questionContainer.classList.remove("ja-to-en-mode");
    typingAnswerArea.classList.add("hidden");
    typingAnswerArea.classList.remove("correct", "wrong");
    typingSlots.innerHTML = "";
    typingCorrectAnswer.textContent = "";
    typingCorrectAnswer.classList.add("hidden");
    typingAnswerInput.value = "";
    typingAnswerInput.disabled = false;
    
    questionWord.textContent = "";
    questionSource.textContent = "";
    questionSource.style.display = "none";
    hideExplanation();
}

/**
 * 進捗表示を更新
 */
function updateProgress() {
    document.querySelectorAll(".dot").forEach(d => d.classList.remove("current"));
    const dot = document.getElementById(`dot-${currentIndex}`);
    if (dot) dot.classList.add("current");
    progressText.textContent = `Q ${currentIndex + 1} / ${quizEntries.length}`;
}

/**
 * 問題を表示し、音声合成とタイマーを開始する
 */
function loadQuestion() {
    answered = false;
    nextBtn.disabled = true;
    const entry = quizEntries[currentIndex];
    
    hideExplanation();
    choicesGrid.style.visibility = "hidden";
    choicesGrid.style.opacity = "0";
    resetChoiceButtons();
    
    questionWord.textContent = "";
    questionSource.textContent = "";
    questionSource.style.display = "none";
    updateProgress();
    
    if (isGrammarMode) {
        loadGrammarQuestion(entry);
    } else {
        loadVocabQuestion(entry);
    }
    
    if (!shouldUseTypingMode()) {
        choicesGrid.classList.remove("hidden");
        choicesGrid.style.visibility = "visible";
        choicesGrid.style.opacity = "1";
    }
}

/**
 * 文法問題を表示
 * @param {Object} entry - 問題エントリ
 */
function loadGrammarQuestion(entry) {
    questionContainer.classList.add("grammar-mode");
    questionContainer.classList.remove("ja-to-en-mode");
    questionWord.textContent = entry.question;
    
    if (entry.source && entry.source.trim()) {
        questionSource.textContent = `(${entry.source})`;
        questionSource.style.display = "block";
    } else {
        questionSource.style.display = "none";
    }
    
    currentChoicesData = buildChoices(entry);
    choiceButtons.forEach((btn, i) => {
        btn.textContent = currentChoicesData[i];
        btn.className = "choice";
        btn.disabled = false;
        btn.onclick = () => handleAnswer(i);
    });
    
    timerBarContainer.classList.add("hidden");
}

/**
 * 単語問題を表示
 * @param {Object} entry - 問題エントリ
 */
function loadVocabQuestion(entry) {
    questionContainer.classList.remove("grammar-mode");
    questionContainer.classList.toggle("ja-to-en-mode", vocabDirection === "jaToEn");
    questionWord.textContent = vocabDirection === "jaToEn" ? formatMeaning(entry) : entry.english;
    questionSource.style.display = "none";
    
    if (shouldUseTypingMode()) {
        loadTypingQuestion(entry);
        startTimer();
        return;
    }
    
    currentChoicesData = buildChoices(entry);
    choiceButtons.forEach((btn, i) => {
        btn.textContent = vocabDirection === "jaToEn" ? currentChoicesData[i].entry.english : currentChoicesData[i].display;
        btn.className = "choice";
        btn.disabled = false;
        btn.onclick = () => handleAnswer(i);
    });
    
    if (vocabDirection === "enToJa") {
        speak(entry.english);
    }
    startTimer();
}

function loadTypingQuestion(entry) {
    choicesGrid.classList.add("hidden");
    choicesGrid.style.visibility = "hidden";
    choicesGrid.style.opacity = "0";
    typingAnswerArea.classList.remove("hidden", "correct", "wrong");
    typingCorrectAnswer.textContent = "";
    typingCorrectAnswer.classList.add("hidden");
    typingAnswerInput.value = "";
    typingAnswerInput.disabled = false;
    typingAnswerInput.maxLength = getTypingTarget(entry).length + 20;
    renderTypingSlots(entry);
    
    typingAnswerArea.onclick = focusTypingInput;
    pronounceHintBtn.onclick = event => {
        event.stopPropagation();
        speak(entry.english);
        focusTypingInput();
    };
    typingAnswerInput.oninput = () => {
        const target = getTypingTarget(entry);
        const typed = normalizeTypingAnswer(typingAnswerInput.value);
        renderTypingSlots(entry, typed);
        
        if (typed.length >= target.length) {
            handleTypingAnswer(typed === target);
        }
    };
    
    focusTypingInput();
    requestAnimationFrame(focusTypingInput);
    setTimeout(focusTypingInput, 150);
}

/**
 * 進捗ドットを生成
 */
function createProgressDots() {
    dotContainer.innerHTML = "";
    quizEntries.forEach((_, i) => {
        const d = document.createElement("div");
        d.className = "dot";
        d.id = `dot-${i}`;
        dotContainer.appendChild(d);
    });
}

/**
 * クイズを初期化
 */
function initQuiz() {
    currentIndex = 0;
    correctCount = 0;
    wrongAnswers = [];
    answerHistory = [];
    createProgressDots();
    showView("quiz");
    resetChoicesCompletely();
    questionWord.textContent = "";
    progressText.textContent = "";
    loadQuestion();
}

// ==================== クイズ開始処理 ====================

/**
 * 単語問題の開始処理
 */
async function startVocabQuiz() {
    const btn = document.getElementById("startBtn");
    if (btn.disabled) return;
    
    const originalText = btn.textContent;
    try {
        const file = document.getElementById("difficultySelect").value;
        if (!file) {
            throw new Error("教材を選択してください。");
        }
        
        resetChoicesCompletely();
        btn.disabled = true;
        btn.textContent = "読み込み中...";
        window.speechSynthesis.cancel();
        clearInterval(timerInterval);
        
        timeLimit = parseInt(document.getElementById("timerSelect").value);
        allEntries = await loadCsv(file, false, false);
        let data = allEntries;
        
        // 苦手モードフィルタ
        if (document.getElementById("weakModeCheck").checked) {
            const weakIds = getWeakWords();
            data = data.filter(item => weakIds.includes(item.number));
            if (!data.length) throw new Error("苦手単語がありません。");
        } else {
            // 範囲フィルタ
            const start = parseInt(document.getElementById("rangeStart").value);
            const end = parseInt(document.getElementById("rangeEnd").value);
            if (!isNaN(start)) data = data.filter(item => item.number >= start);
            if (!isNaN(end)) data = data.filter(item => item.number <= end);
        }
        
        const countInput = parseInt(document.getElementById("countInput").value);
        const count = isNaN(countInput) ? DEFAULT_QUESTION_COUNT : countInput;
        quizEntries = data.sort(() => 0.5 - Math.random()).slice(0, count);
        
        if (quizEntries.length === 0) {
            throw new Error("単語が見つかりませんでした。範囲設定を確認してください。");
        }
        
        initQuiz();
        btn.disabled = false;
        btn.textContent = originalText;
    } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

/**
 * 文法問題の開始処理
 */
async function startGrammarQuiz() {
    const btn = document.getElementById("grammarStartBtn");
    if (btn.disabled) return;
    
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
        
        // 難易度フィルタ
        const targetDifficulty = DIFFICULTY_MAP[currentGrammarDifficulty];
        if (targetDifficulty) {
            data = data.filter(item => item.difficulty === targetDifficulty);
        }
        
        if (data.length === 0) {
            throw new Error("選択した難易度の問題が見つかりませんでした。");
        }
        
        const countInput = parseInt(document.getElementById("grammarCountInput").value);
        const count = isNaN(countInput) ? DEFAULT_QUESTION_COUNT : countInput;
        quizEntries = data.sort(() => 0.5 - Math.random()).slice(0, count);
        
        if (quizEntries.length === 0) {
            throw new Error("問題が見つかりませんでした。");
        }
        
        initQuiz();
        btn.disabled = false;
        btn.textContent = originalText;
    } catch (e) {
        alert(e.message || "問題の読み込みに失敗しました。");
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// ==================== 結果表示 ====================

/**
 * 結果画面を表示
 */
function showResult() {
    window.speechSynthesis.cancel();
    showView("result");
    
    document.getElementById("finalScore").textContent = `結果: ${correctCount} / ${quizEntries.length}`;
    
    if (correctCount === quizEntries.length && quizEntries.length > 0) {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        document.getElementById("resultTitle").textContent = "✨全問正解✨";
    } else {
        document.getElementById("resultTitle").textContent = "結果";
    }
    
    document.getElementById("restartBtn").textContent = isGrammarMode ? "文法設定へ" : "単語設定へ";
    
    const list = document.getElementById("wrongList");
    list.innerHTML = "";
    
    if (!isGrammarMode && answerHistory.length) {
        document.getElementById("reviewSection").classList.remove("hidden");
        answerHistory.forEach(answer => {
            const li = document.createElement("li");
            li.className = answer.isCorrect ? "review-correct" : "review-wrong";
            li.innerHTML = `<strong>${answer.english}</strong> 正解: ${answer.meaning}`;
            list.appendChild(li);
        });
    } else if (wrongAnswers.length) {
        document.getElementById("reviewSection").classList.remove("hidden");
        wrongAnswers.forEach(w => {
            const li = document.createElement("li");
            li.className = "review-wrong";
            if (isGrammarMode) {
                li.innerHTML = `<strong>${w.question}</strong><br>正解: ${w.correct}`;
            } else {
                li.innerHTML = `<strong>${w.english}</strong> 正解: ${w.meaning}`;
            }
            list.appendChild(li);
        });
    } else {
        document.getElementById("reviewSection").classList.add("hidden");
    }
}

// ==================== 苦手単語管理 ====================

/**
 * 苦手単語数のバッジ表示更新
 */
function updateWeakCountDisplay() {
    document.getElementById("weakCount").textContent = getWeakWords().length;
}

/**
 * 苦手リストから特定のIDを削除
 * @param {number} id - 単語の番号
 */
window.removeWeak = (id) => {
    const weakIds = getWeakWords().filter(wid => wid !== id);
    const stats = getWeakWordStats();
    delete stats[String(id)];
    localStorage.setItem("weakWords", JSON.stringify(weakIds));
    saveWeakWordStats(stats);
    updateWeakCountDisplay();
    if (!document.getElementById("weakListModal").classList.contains("hidden")) {
        document.getElementById("openWeakListBtn").onclick();
    }
};

/**
 * 苦手リストモーダルの表示
 */
function showWeakListModal() {
    const weakIds = getWeakWords();
    const stats = getWeakWordStats();
    const listEl = document.getElementById("fullWeakList");
    listEl.innerHTML = "";
    
    weakIds.forEach(id => {
        const entry = allEntries.find(e => e.number === id);
        if (entry) {
            const stat = stats[String(id)];
            const li = document.createElement("li");
            li.style = "padding:10px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; font-size:0.85rem;";
            
            const detail = document.createElement("div");
            detail.innerHTML = `
                <strong>${entry.english}</strong><br>
                <small>${entry.meanings.slice(0, 2).join('/')}</small><br>
                <small>正答率: ${getAccuracyText(stat)} / 連続正解: ${stat ? stat.streak : 0} / 最終学習: ${formatLastStudiedAt(stat ? stat.lastStudiedAt : "")}</small>
            `;
            
            const actions = document.createElement("div");
            const speakBtn = document.createElement("button");
            speakBtn.textContent = "🔊";
            speakBtn.onclick = () => speak(entry.english);
            
            const removeBtn = document.createElement("button");
            removeBtn.textContent = "🗑️";
            removeBtn.onclick = () => removeWeak(entry.number);
            
            actions.appendChild(speakBtn);
            actions.appendChild(removeBtn);
            li.appendChild(detail);
            li.appendChild(actions);
            listEl.appendChild(li);
        }
    });
    
    document.getElementById("weakListModal").classList.remove("hidden");
    document.body.classList.remove("scroll-lock");
}

/**
 * 苦手リストモーダルを閉じる
 */
function closeWeakListModal() {
    window.speechSynthesis.cancel();
    document.getElementById("weakListModal").classList.add("hidden");
    if (!views.quiz.classList.contains("hidden")) {
        updateScrollLock(true);
    }
}

/**
 * 戻る/リスタート処理（共通）
 */
function handleBackToMenu() {
    window.speechSynthesis.cancel();
    clearInterval(timerInterval);
    
    if (isGrammarMode) {
        resetStartButton(document.getElementById("grammarStartBtn"));
        showView("grammarMenu");
    } else {
        resetStartButton(document.getElementById("startBtn"));
        showView("menu");
    }
}

// ==================== イベントリスナー登録 ====================

// パスワードログイン
document.getElementById("passwordBtn").onclick = () => {
    const passwordInput = document.getElementById("passwordInput");
    const passwordError = document.getElementById("passwordError");
    if (passwordInput.value === PASSWORD) {
        showView("modeSelection");
    } else {
        passwordError.textContent = "パスワードが違います";
    }
};

// モード選択遷移
document.getElementById("selectVocabBtn").onclick = () => {
    isGrammarMode = false;
    showView("menu");
};
document.getElementById("selectGrammarBtn").onclick = () => {
    isGrammarMode = true;
    showView("grammarModeSelection");
};
document.getElementById("backToModeBtn").onclick = () => showView("modeSelection");

// 文法モード選択
document.getElementById("selectGrammarProblemBtn").onclick = () => showView("grammarTypeSelection");
document.getElementById("backToMainModeBtn").onclick = () => {
    isGrammarMode = false;
    showView("modeSelection");
};

// 文法問題タイプ選択
document.getElementById("selectFillBlankBtn").onclick = () => showView("grammarFillCategory");
document.getElementById("backToGrammarModeBtn").onclick = () => showView("grammarModeSelection");

// 空所補充カテゴリ選択
document.querySelectorAll(".grammar-category-btn").forEach(btn => {
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

// クイズ開始ボタン
document.getElementById("startBtn").onclick = startVocabQuiz;
document.getElementById("grammarStartBtn").onclick = startGrammarQuiz;

// CSVデータの強制再取得
document.getElementById("forceUpdateBtn").onclick = async function() {
    const btn = this;
    const file = document.getElementById("difficultySelect").value;
    if (btn.disabled) return;
    
    const originalText = "単語データを最新に更新する";
    btn.disabled = true;
    btn.textContent = "更新中...";
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMER_UPDATE_TIMEOUT);
        await loadCsv(file, true);
        clearTimeout(timeoutId);
        btn.textContent = "✅ 更新完了！";
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalText;
        }, 1500);
    } catch (e) {
        btn.textContent = "❌ 更新失敗";
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalText;
        }, 1500);
    }
};

// 次の問題への遷移、または結果表示
nextBtn.onclick = () => {
    currentIndex++;
    if (currentIndex >= quizEntries.length) {
        showResult();
    } else {
        loadQuestion();
    }
};

// 苦手単語管理
document.getElementById("openWeakListBtn").onclick = showWeakListModal;
document.getElementById("closeWeakListBtn").onclick = closeWeakListModal;
document.getElementById("weakListModal").onclick = event => {
    if (event.target === event.currentTarget) {
        closeWeakListModal();
    }
};
document.getElementById("clearHistoryBtn").onclick = () => {
    if (confirm("履歴を削除？")) {
        localStorage.removeItem("weakWords");
        localStorage.removeItem(WEAK_WORD_STATS_KEY);
        updateWeakCountDisplay();
    }
};

// 問題文タップで再読み上げ（単語問題のみ）
questionWord.onclick = () => {
    if (quizEntries[currentIndex] && !isGrammarMode && vocabDirection === "enToJa") {
        speak(quizEntries[currentIndex].english);
    }
};

// 戻る/リスタート処理
document.getElementById("backBtn").onclick = handleBackToMenu;
document.getElementById("restartBtn").onclick = handleBackToMenu;

// ==================== 初期化 ====================
initTheme();
initVoiceToggle();
initVocabModeControls();
showView("password");
