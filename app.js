// ===== 共通処理（全ページで読み込む） =====
const C = window.KAKUZUKE_CONFIG || {};
firebase.initializeApp(C.firebaseConfig);
const db = firebase.database();

const teamParam = (new URLSearchParams(location.search).get("team") || "").trim().toUpperCase();
const LETTERS = ["A", "B", "C", "D"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clampInt = (v, min, max, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const clampN = n => clampInt(n, 2, 4, 2);
const toArr = x => (Array.isArray(x) ? x : Object.values(x || {})).filter(Boolean);

const defaults = { title: "格付けチェック", current: 0, total: 0, phase: "lobby", question: "", choices: ["A", "B"], answer: null, deadline: null };
const PHASE_LABEL = { lobby: "開始前", ready: "問題表示中", open: "回答受付中", closed: "締切", answer: "正解発表", final: "最終結果" };

// ===== 初期値（管理画面で未設定のときに使う） =====
const DEFAULT_RANK_NAMES = ["一流", "普通", "二流", "三流", "そっくりさん", "映す価値なし"];
const DEFAULT_RANK_COLORS = ["#c9a227", "#3f6fc4", "#2f8f63", "#8a6a3b", "#7a4a9a", "#3a3a3a"];
const MAX_TEAMS = 52, MAX_RANKS = 10, MAX_PENALTY = 10;

// チームID：0→A, 25→Z, 26→AA …（投票URLの ?team= に使う）
function teamIdAt(i) { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function nextTeamId(teams) { const used = new Set(teams.map(t => t.id)); for (let i = 0; ; i++) { const id = teamIdAt(i); if (!used.has(id)) return id; } }
function defaultTeams() {
  const ids = Array.isArray(C.teams) && C.teams.length ? C.teams : "ABCDEFGHIJKLMNOP".split("");
  return ids.map(id => ({ id: String(id).toUpperCase(), name: String(id).toUpperCase() + "チーム" }));
}
function defaultRanks() { return DEFAULT_RANK_NAMES.map((n, i) => ({ name: n, color: DEFAULT_RANK_COLORS[i] })); }

// DB の setup を安全な形にそろえる
function normalizeSetup(v) {
  v = v || {};
  const teams = toArr(v.teams).map(t => ({ id: String(t.id || "").toUpperCase(), name: String(t.name || t.id || "") }))
    .filter(t => /^[A-Z]{1,2}$/.test(t.id));
  const ranks = toArr(v.ranks).map(r => ({ name: String(r.name || ""), color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#555555" }));
  return {
    questions: toArr(v.questions).map(q => ({
      text: String(q.text || ""), n: clampN(q.n),
      answer: LETTERS.includes(q.answer) ? q.answer : "",
      penalty: clampInt(q.penalty, 0, MAX_PENALTY, 1)
    })),
    timerSec: clampInt(v.timerSec, 0, 600, 0),
    teams: teams.length ? teams : defaultTeams(),
    ranks: ranks.length >= 2 ? ranks : defaultRanks()
  };
}
let SETUP = normalizeSetup(null);
const findTeam = id => SETUP.teams.find(t => t.id === id);

// サーバー時刻とのずれを補正（端末ごとの時計ずれ対策）
let serverOffset = 0;
db.ref(".info/serverTimeOffset").on("value", s => { serverOffset = s.val() || 0; });
const serverNow = () => Date.now() + serverOffset;

// 制限時間を過ぎていれば、DB上はまだ open でも「締切」として扱う
function phaseOf(g) { return g.phase === "open" && g.deadline && serverNow() >= g.deadline ? "closed" : g.phase; }
function remainingSec(g) {
  if (g.phase !== "open" || !g.deadline) return null;
  return Math.max(0, Math.ceil((g.deadline - serverNow()) / 1000));
}

// ===== 格付け計算 =====
// 正解発表済みの問題で「不正解」または「未投票」なら、その問題の降格数だけランクダウン
function penaltyAt(g, q) { return clampInt(g.penalties?.[q], 0, MAX_PENALTY, 1); }
function missOf(g, id) {
  let m = 0;
  Object.keys(g.answers || {}).forEach(q => {
    const a = g.answers[q];
    if (!a) return;
    if (g.votes?.[q]?.[id] !== a) m += penaltyAt(g, q);
  });
  return m;
}
function rankIndex(g, id) { return Math.min(missOf(g, id), SETUP.ranks.length - 1); }
function rankOf(g, id) { return SETUP.ranks[rankIndex(g, id)]; }
// 現在の問題での降格数（正解発表後のみ）
function dropOf(g, id) {
  const a = g.answers?.[g.current];
  if (!a) return 0;
  return g.votes?.[g.current]?.[id] === a ? 0 : penaltyAt(g, g.current);
}
function rankGroups(g) {
  const gs = SETUP.ranks.map(r => ({ rank: r, teams: [] }));
  SETUP.teams.forEach(t => gs[rankIndex(g, t.id)].teams.push(t));
  return gs;
}
function countVotes(g) { const vs = g.votes?.[g.current] || {}; return SETUP.teams.filter(t => vs[t.id]).length; }

// ランク色に合わせて文字色を白/黒で自動切替
function textColor(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#111" : "#fff";
}
// 選択肢ごとの色（締切後のチームカード背景）
const CHOICE_COLORS = { A: "#d93636", B: "#2f6fd6", C: "#e6c229", D: "#2e9e5b" };
const NOVOTE_COLOR = "#4a4a4a";
const choiceStyle = v => { const c = CHOICE_COLORS[v] || NOVOTE_COLOR; return "background:" + c + ";color:" + textColor(c); };
const rankStyle = r => "background:" + r.color + ";color:" + textColor(r.color);
const rankBadge = (r, cls) => '<span class="badge ' + (cls || "") + '" style="' + rankStyle(r) + '">' + esc(r.name) + "</span>";

// ===== 監視 =====
// setup と game の両方が読み込めたら描画。時間切れで締切に変わった瞬間も再描画する
function watchAll(onChange, onTick) {
  let g = { ...defaults }, lastPhase = null, haveGame = false, haveSetup = false;
  const fire = () => {
    if (!haveGame || !haveSetup) return;
    lastPhase = phaseOf(g);
    onChange(g);
    if (onTick) onTick(g);
  };
  db.ref("setup").on("value", s => { SETUP = normalizeSetup(s.val()); haveSetup = true; fire(); });
  db.ref("game").on("value", s => { g = { ...defaults, ...(s.val() || {}) }; haveGame = true; fire(); });
  setInterval(() => {
    if (!haveGame || !haveSetup) return;
    const p = phaseOf(g);
    if (p !== lastPhase) { lastPhase = p; onChange(g); }
    if (onTick) onTick(g);
  }, 250);
}

// ===== 以下は司会・管理画面用 =====
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
    const q = SETUP.questions[g.current - 1];
    ans = ans || q?.answer;
    if (!ans) { alert("この問題の正解が登録されていません（管理ページで登録してください）"); return; }
    return db.ref("game").update({
      phase: "answer", answer: ans, deadline: null,
      ["answers/" + g.current]: ans,
      ["penalties/" + g.current]: q ? q.penalty : 1   // 発表時点の降格数を記録
    });
  },
  final() { return db.ref("game").update({ phase: "final", deadline: null }); },
  lobby() { return db.ref("game").update({ phase: "lobby", deadline: null }); },
  redo(g) {
    return db.ref("game").update({
      ["votes/" + g.current]: null, ["answers/" + g.current]: null, ["penalties/" + g.current]: null,
      phase: "ready", answer: null, deadline: null
    });
  },
  resetAll(g) {
    return db.ref("game").set({ title: g.title || defaults.title, phase: "lobby", current: 0, total: SETUP.questions.length });
  }
};
