// ===== 共通処理（全ページで読み込む） =====
const C = window.KAKUZUKE_CONFIG || {};
firebase.initializeApp(C.firebaseConfig);
const db = firebase.database();
const TS = firebase.database.ServerValue.TIMESTAMP;   // Firebaseサーバー側の時刻
const APP_VERSION = 6;

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
const BEST_N = 4;   // 最終結果で発表する順位数

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

// ===== 回答・確定 =====
const voteOf = (g, q, id) => g.votes?.[q]?.[id] || "";
const confirmOf = (g, q, id) => g.confirms?.[q]?.[id] || null;     // { c: 選択肢, at: 確定時刻 }
function countVotes(g) { return SETUP.teams.filter(t => voteOf(g, g.current, t.id)).length; }
function countConfirmed(g) { return SETUP.teams.filter(t => confirmOf(g, g.current, t.id)).length; }

// 回答時間（ミリ秒）：回答開始 → 確定ボタン。確定しなかったチームは締切までの時間
// ※ 画面に出すのは最終結果発表のときだけ
function timeMs(g, q, id) {
  const opened = g.opened?.[q];
  if (!opened) return null;
  const c = confirmOf(g, q, id);
  const end = c ? c.at : g.closed?.[q];
  if (!end) return null;
  return Math.max(0, end - opened);
}
// 正解発表済みの問題の回答時間の合計
function totalMs(g, id) {
  return Object.keys(g.answers || {}).reduce((s, q) => s + (timeMs(g, q, id) || 0), 0);
}
// 時間が記録されていない問題があるか（古い app.js で進行した場合など）
function missingTimes(g) {
  return Object.keys(g.answers || {}).filter(q => !g.opened?.[q] || !g.closed?.[q]);
}
const fmtSec = ms => ms == null ? "-" : (ms / 1000).toFixed(2) + "秒";

// ===== 格付け計算 =====
// 正解発表済みの問題で「不正解」または「未投票」なら、その問題の降格数だけランクダウン
function penaltyAt(g, q) { return clampInt(g.penalties?.[q], 0, MAX_PENALTY, 1); }
function missOf(g, id) {
  let m = 0;
  Object.keys(g.answers || {}).forEach(q => {
    const a = g.answers[q];
    if (a && voteOf(g, q, id) !== a) m += penaltyAt(g, q);
  });
  return m;
}
function rankIndex(g, id) { return Math.min(missOf(g, id), SETUP.ranks.length - 1); }
function rankOf(g, id) { return SETUP.ranks[rankIndex(g, id)]; }
function dropOf(g, id) {
  const a = g.answers?.[g.current];
  if (!a) return 0;
  return voteOf(g, g.current, id) === a ? 0 : penaltyAt(g, g.current);
}
function rankGroups(g) {
  const gs = SETUP.ranks.map(r => ({ rank: r, teams: [] }));
  SETUP.teams.forEach(t => gs[rankIndex(g, t.id)].teams.push(t));
  return gs;
}
// 順位：ランクが上ほど上位、同じランクなら回答時間の合計が短いほど上位
function standings(g) {
  const list = SETUP.teams.map(t => ({ team: t, ri: rankIndex(g, t.id), ms: totalMs(g, t.id) }))
    .sort((a, b) => a.ri - b.ri || a.ms - b.ms);
  list.forEach((x, i) => {
    const p = list[i - 1];
    x.place = p && p.ri === x.ri && p.ms === x.ms ? p.place : i + 1;   // 完全に同じなら同順位
  });
  return list;
}

// ランク色に合わせて文字色を白/黒で自動切替
function textColor(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#111" : "#fff";
}
// 選択肢ごとの色（締切後のチームカード背景）
const CHOICE_COLORS = { A: "#d93636", B: "#2e9e5b", C: "#e6c229", D: "#2f6fd6" };
const NOVOTE_COLOR = "#4a4a4a";
const choiceStyle = v => { const c = CHOICE_COLORS[v] || NOVOTE_COLOR; return "background:" + c + ";color:" + textColor(c); };
const rankStyle = r => "background:" + r.color + ";color:" + textColor(r.color);
const rankBadge = (r, cls) => '<span class="badge ' + (cls || "") + '" style="' + rankStyle(r) + '">' + esc(r.name) + "</span>";

// ===== 監視 =====
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
// 時間切れになったら DB の phase も closed にそろえ、締切時刻を記録する
function autoClose(g) {
  if (g.phase === "open" && g.deadline && serverNow() >= g.deadline) {
    const q = g.current, dl = g.deadline;
    db.ref("game/phase").transaction(p => (p === "open" ? "closed" : undefined)).then(r => {
      if (r && r.committed) db.ref("game/closed/" + q).set(dl);
    });
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
  start(g, sec) {
    sec = sec ?? SETUP.timerSec;
    return db.ref("game").update({
      phase: "open", deadline: sec > 0 ? Math.round(serverNow() + sec * 1000) : null,
      ["opened/" + g.current]: TS, ["closed/" + g.current]: null      // 回答時間の計測開始
    });
  },
  close(g) {
    return db.ref("game").update({ phase: "closed", deadline: null, ["closed/" + g.current]: g.closed?.[g.current] || TS });
  },
  reveal(g, ans) {
    const q = SETUP.questions[g.current - 1];
    ans = ans || q?.answer;
    if (!ans) { alert("この問題の正解が登録されていません（管理ページで登録してください）"); return; }
    const closedAt = g.closed?.[g.current] || (g.deadline && serverNow() >= g.deadline ? g.deadline : TS);
    return db.ref("game").update({
      phase: "answer", answer: ans, deadline: null,
      ["answers/" + g.current]: ans,
      ["penalties/" + g.current]: q ? q.penalty : 1,   // 発表時点の降格数を記録
      ["closed/" + g.current]: closedAt
    });
  },
  final() { return db.ref("game").update({ phase: "final", deadline: null }); },
  lobby() { return db.ref("game").update({ phase: "lobby", deadline: null }); },
  redo(g) {
    const c = g.current;
    return db.ref("game").update({
      ["votes/" + c]: null, ["confirms/" + c]: null, ["answers/" + c]: null, ["penalties/" + c]: null,
      ["opened/" + c]: null, ["closed/" + c]: null,
      phase: "ready", answer: null, deadline: null
    });
  },
  resetAll(g) {
    return db.ref("game").set({ title: g.title || defaults.title, phase: "lobby", current: 0, total: SETUP.questions.length });
  }
};
