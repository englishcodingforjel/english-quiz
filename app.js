"use strict";

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

let allEntries = [], quizEntries = [], currentIndex = 0, correctCount = 0, 
    wrongAnswers = [], currentChoicesData = [], answered = false, 
    timerInterval = null, timeLimit = 0, csvCache = {};

// ダークモード制御
const themeToggle = document.getElementById("themeToggle");
themeToggle.onclick = () => {
    document.body.classList.toggle("dark-mode");
    themeToggle.textContent = document.body.classList.contains("dark-mode") ? "☀️" : "🌙";
    localStorage.setItem("theme", document.body.classList.contains("dark-mode") ? "dark" : "light");
};
if(localStorage.getItem("theme") === "dark") { document.body.classList.add("dark-mode"); themeToggle.textContent = "☀️"; }

function showView(name) {
    Object.keys(views).forEach(v => views[v].classList.add("hidden"));
    views[name].classList.remove("hidden");
    document.getElementById("progressBarContainer").classList.toggle("hidden", name !== "quiz");
    document.body.classList.toggle("scroll-lock", name === "quiz");
    if (name === "menu") updateWeakCountDisplay();
}

function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setTimeout(() => {
        const uttr = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const usVoice = voices.find(v => (v.lang === 'en-US' || v.lang === 'en_US') && v.name.includes('Samantha')) || 
                        voices.find(v => v.lang === 'en-US' || v.lang === 'en_US');
        if (usVoice) uttr.voice = usVoice;
        uttr.lang = 'en-US'; uttr.rate = 1.0;
        window.speechSynthesis.speak(uttr);
    }, 50);
}
if (window.speechSynthesis.onvoiceschanged !== undefined) window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

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
        let weakIds = JSON.parse(localStorage.getItem("weakWords") || "[]");
        if (!weakIds.includes(entry.number)) { weakIds.push(entry.number); localStorage.setItem("weakWords", JSON.stringify(weakIds)); }
        if (dot) dot.classList.add("wrong");
    }
    topScore.textContent = `正解: ${correctCount}`; nextBtn.disabled = false;
}

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

// 画面遷移イベント
document.getElementById("passwordBtn").onclick = () => {
    if (document.getElementById("passwordInput").value === PASSWORD) showView("modeSelection");
    else document.getElementById("passwordError").textContent = "パスワードが違います";
};
document.getElementById("selectVocabBtn").onclick = () => showView("menu");
document.getElementById("selectGrammarBtn").onclick = () => alert("文法学習モードは現在準備中です。");
document.getElementById("backToModeBtn").onclick = () => showView("modeSelection");

document.getElementById("startBtn").onclick = async function() {
    const btn = this; if (btn.disabled) return;
    try {
        btn.disabled = true; const originalText = btn.textContent; btn.textContent = "読み込み中...";
        window.speechSynthesis.cancel(); clearInterval(timerInterval);

        const file = document.getElementById("difficultySelect").value;
        allEntries = await loadCsv(file);
        let data = allEntries;

        if (document.getElementById("weakModeCheck").checked) {
            const weakIds = JSON.parse(localStorage.getItem("weakWords") || "[]");
            data = data.filter(item => weakIds.includes(item.number));
            if (!data.length) throw new Error("苦手単語がありません。");
        } else {
            const s = parseInt(document.getElementById("rangeStart").value), e = parseInt(document.getElementById("rangeEnd").value);
            if (!isNaN(s)) data = data.filter(item => item.number >= s);
            if (!isNaN(e)) data = data.filter(item => item.number <= e);
        }

        const countInput = parseInt(document.getElementById("countInput").value);
        const count = isNaN(countInput) ? 20 : countInput;
        quizEntries = data.sort(() => 0.5 - Math.random()).slice(0, count);
        if (quizEntries.length === 0) throw new Error("単語が見つかりませんでした。範囲設定を確認してください。");

        dotContainer.innerHTML = "";
        quizEntries.forEach((_, i) => { const d = document.createElement("div"); d.className = "dot"; d.id = `dot-${i}`; dotContainer.appendChild(d); });
        currentIndex = 0; correctCount = 0; wrongAnswers = [];
        showView("quiz");
        document.getElementById("questionWord").textContent = ""; document.getElementById("progressText").textContent = "";
        choiceButtons.forEach(b => { b.textContent = ""; b.className = "choice"; });
        setTimeout(() => { loadQuestion(); btn.disabled = false; btn.textContent = originalText; }, 150);
    } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = "開始"; }
};

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

nextBtn.onclick = () => {
    currentIndex++;
    if (currentIndex >= quizEntries.length) {
        window.speechSynthesis.cancel(); showView("result");
        document.getElementById("finalScore").textContent = `Score: ${correctCount} / ${quizEntries.length}`;
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

function updateWeakCountDisplay() { document.getElementById("weakCount").textContent = JSON.parse(localStorage.getItem("weakWords") || "[]").length; }
window.removeWeak = (id) => {
    let weakIds = JSON.parse(localStorage.getItem("weakWords") || "[]").filter(wid => wid !== id);
    localStorage.setItem("weakWords", JSON.stringify(weakIds));
    updateWeakCountDisplay();
    if (!document.getElementById("weakListModal").classList.contains("hidden")) document.getElementById("openWeakListBtn").onclick();
};
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
};
document.getElementById("closeWeakListBtn").onclick = () => { window.speechSynthesis.cancel(); document.getElementById("weakListModal").classList.add("hidden"); };
document.getElementById("clearHistoryBtn").onclick = () => { if(confirm("履歴を削除？")) { localStorage.removeItem("weakWords"); updateWeakCountDisplay(); } };
document.getElementById("questionWord").onclick = () => { if(quizEntries[currentIndex]) speak(quizEntries[currentIndex].english); };

// 戻るボタン遷移
document.getElementById("backBtn").onclick = () => { window.speechSynthesis.cancel(); clearInterval(timerInterval); showView("menu"); };
document.getElementById("restartBtn").onclick = () => { window.speechSynthesis.cancel(); showView("menu"); };

showView("password");