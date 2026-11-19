// ===== 共通処理（全ページで読み込む） =====
const C = window.KAKUZUKE_CONFIG;
firebase.initializeApp(C.firebaseConfig);
const db = firebase.database();

const team = (new URLSearchParams(location.search).get("team") || "").toUpperCase();
const LETTERS = ["A", "B", "C", "D"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clampN = n => Math.min(4, Math.max(2, parseInt(n, 10) || 2));
const toArr = x => (Array.isArray(x) ? x : Object.values(x || {})).filter(Boolean);

const defaults = { title: "格付けチェック", current: 0, total: 0, phase: "lobby", question: "", choices: ["A", "B"], answer: null, deadline: null };
const PHASE_LABEL = { lobby: "開始前", ready: "問題表示中", open: "回答受付中", closed: "締切", answer: "正解発表", final: "最終結果" };

// サーバー時刻とのずれを補正（端末ごとの時計ずれ対策）
let serverOffset = 0;
db.ref(".info/serverTimeOffset").on("value", s => { serverOffset = s.val() || 0; });
const serverNow = () => Date.now() + serverOffset;

// 制限時間を過ぎていれば、DB上はまだ open でも「締切」として扱う
function phaseOf(g) {
  return g.phase === "open" && g.deadline && serverNow() >= g.deadline ? "closed" : g.phase;
}
function remainingSec(g) {
  if (g.phase !== "open" || !g.deadline) return null;
  return Math.max(0, Math.ceil((g.deadline - serverNow()) / 1000));
}

// 不正解1回ごとに1ランク降格（未投票は変動なし）
function calcRank(votes, answers, t) {
  let miss = 0;
  Object.keys(answers || {}).forEach(q => {
    const a = answers[q], v = votes?.[q]?.[t];
    if (a && v && v !== a) miss++;
  });
  return Math.min(miss, C.ranks.length - 1);
}
function rankGroups(g) {
  const groups = C.ranks.map(r => ({ rank: r, teams: [] }));
  C.teams.forEach(t => groups[calcRank(g.votes, g.answers, t)].teams.push(t));
  return groups;
}

// game を監視。データ変更時と「時間切れで締切に変わった瞬間」に onChange を呼ぶ
function watchGame(onChange, onTick) {
  let g = { ...defaults }, lastPhase = null;
  db.ref("game").on("value", s => {
    g = { ...defaults, ...(s.val() || {}) };
    lastPhase = phaseOf(g);
    onChange(g);
    if (onTick) onTick(g);
  });
  setInterval(() => {
    const p = phaseOf(g);
    if (p !== lastPhase) { lastPhase = p; onChange(g); }
    if (onTick) onTick(g);
  }, 250);
}

// ===== 以下は司会・管理画面用 =====
let SETUP = { questions: [], timerSec: 0 };
function watchSetup(cb) {
  db.ref("setup").on("value", s => {
    const v = s.val() || {};
    SETUP = { questions: toArr(v.questions), timerSec: Math.max(0, parseInt(v.timerSec, 10) || 0) };
    if (cb) cb(SETUP);
  });
}

// 時間切れになったら DB の phase も closed にそろえる
function autoClose(g) {
  if (g.phase === "open" && g.deadline && serverNow() >= g.deadline) {
    db.ref("game/phase").transaction(p => (p === "open" ? "closed" : undefined));
  }
}

const Ops = {
  goto(i) {
    const q = SETUP.questions[i - 1];
    if (!q) { alert("第" + i + "問は登録されていません"); return; }
    return db.ref("game").update({
      current: i, total: SETUP.questions.length, question: q.text || "",
      choices: LETTERS.slice(0, clampN(q.n)), phase: "ready", answer: null, deadline: null
    });
  },
  start(sec) {
    sec = sec ?? SETUP.timerSec;
    return db.ref("game").update({ phase: "open", deadline: sec > 0 ? Math.round(serverNow() + sec * 1000) : null });
  },
  close() { return db.ref("game").update({ phase: "closed", deadline: null }); },
  reveal(g, ans) {
    ans = ans || SETUP.questions[g.current - 1]?.answer;
    if (!ans) { alert("この問題の正解が登録されていません（管理ページで登録してください）"); return; }
    return db.ref("game").update({ phase: "answer", answer: ans, deadline: null, ["answers/" + g.current]: ans });
  },
  final() { return db.ref("game").update({ phase: "final", deadline: null }); },
  lobby() { return db.ref("game").update({ phase: "lobby", deadline: null }); },
  redo(g) {
    return db.ref("game").update({ ["votes/" + g.current]: null, ["answers/" + g.current]: null, phase: "ready", answer: null, deadline: null });
  },
  resetAll(g) {
    return db.ref("game").set({ title: g.title || defaults.title, phase: "lobby", current: 0, total: SETUP.questions.length });
  }
};
