// ===== 共通処理（全ページで読み込む） =====
const C = window.KAKUZUKE_CONFIG || {};
firebase.initializeApp(C.firebaseConfig);
const db = firebase.database();
const TS = firebase.database.ServerValue.TIMESTAMP;   // Firebaseサーバー側の時刻
const APP_VERSION = 11;
const APP_BUILD = "11.9";
const storage = firebase.storage ? firebase.storage() : null;

const teamParam = (new URLSearchParams(location.search).get("team") || "").trim().toUpperCase();
const LETTERS = ["A", "B", "C", "D"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clampInt = (v, min, max, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const clampN = n => clampInt(n, 2, 4, 2);
const toArr = x => (Array.isArray(x) ? x : Object.values(x || {})).filter(Boolean);

const defaults = { title: "格付けチェック", current: 0, total: 0, phase: "lobby", question: "", choices: ["A", "B"], answer: null, deadline: null, sessionId: "legacy" };
const PHASE_LABEL = { lobby: "開始前", ready: "問題表示中", open: "回答受付中", closed: "締切", answer: "正解発表", intro: "オープニング", rankboard: "全チーム格付け", final: "最終結果" };

// ===== 初期値（管理画面で未設定のときに使う） =====
const DEFAULT_RANK_NAMES = ["一流", "普通", "二流", "三流", "そっくりさん", "映す価値なし"];
const DEFAULT_RANK_COLORS = ["#c9a227", "#3f6fc4", "#2f8f63", "#8a6a3b", "#7a4a9a", "#3a3a3a"];
const MAX_TEAMS = 52, MAX_RANKS = 10, MAX_PENALTY = 10;
const BEST_N = 4;   // 最終結果で発表する順位数

// チームID：0→A, 25→Z, 26→AA …（投票URLの ?team= に使う）
function teamIdAt(i) { let s = ""; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function nextTeamId(teams) { const used = new Set(teams.map(t => t.id)); for (let i = 0; ; i++) { const id = teamIdAt(i); if (!used.has(id)) return id; } }
function randomTeamKey() {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
}
function defaultTeams() {
  const ids = Array.isArray(C.teams) && C.teams.length ? C.teams : "ABCDEFGHIJKLMNOP".split("");
  return ids.map(id => ({ id: String(id).toUpperCase(), name: String(id).toUpperCase() + "チーム", language: "ja", key: randomTeamKey() }));
}
function defaultRanks() { const en=["First Class","Regular","Second Class","Third Class","Look-alike","Not Worth Showing"]; return DEFAULT_RANK_NAMES.map((n, i) => ({ name:n, nameJa:n, nameEn:en[i]||n, color: DEFAULT_RANK_COLORS[i] })); }

// DB の setup を安全な形にそろえる
function normalizeSetup(v) {
  v = v || {};
  const teams = toArr(v.teams).map(t => ({ id: String(t.id || "").toUpperCase(), name: String(t.name || t.id || ""), language: t.language === "en" ? "en" : "ja", key: /^[0-9a-f]{32}$/i.test(t.key || "") ? t.key : randomTeamKey() }))
    .filter(t => /^[A-Z]{1,2}$/.test(t.id));
  const ranks = toArr(v.ranks).map(r => ({ name: String(r.nameJa || r.name || ""), nameJa: String(r.nameJa || r.name || ""), nameEn: String(r.nameEn || r.name || ""), color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#555555" }));
  return {
    questions: toArr(v.questions).map(q => ({
      text: String(q.text || ""), n: clampN(q.n),
      answer: LETTERS.includes(q.answer) ? q.answer : "",
      penalty: clampInt(q.penalty, 0, MAX_PENALTY, 1),
      imagePath: String(q.imagePath || (toArr(q.slides)[0] || ""))
    })),
    titleImagePath: String(v.titleImagePath || ""),
    introSlides: toArr(v.introSlides).map(String).filter(Boolean),
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


// 管理画面向け：現在問の計測時間
function currentTimeMs(g, id) {
  const q = g.current, opened = g.opened?.[q];
  if (!opened) return null;
  const c = confirmOf(g, q, id);
  if (c?.at) return Math.max(0, c.at - opened);
  const end = g.closed?.[q] || (phaseOf(g) === "open" ? serverNow() : null);
  return end ? Math.max(0, end - opened) : null;
}
function completedTimeCount(g, id) { return Object.keys(g.answers || {}).filter(q => timeMs(g, q, id) != null).length; }
function completedQuestionCount(g) { return Object.keys(g.answers || {}).length; }

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
const rankName = (r, lang="ja") => lang === "en" ? (r.nameEn || r.nameJa || r.name || "") : (r.nameJa || r.name || r.nameEn || "");
const rankBadge = (r, cls, lang) => lang ? '<span class="badge ' + (cls || "") + '" style="' + rankStyle(r) + '">' + esc(rankName(r,lang)) + "</span>" : '<span class="badge bilingual ' + (cls || "") + '" style="' + rankStyle(r) + '"><span>' + esc(rankName(r,"ja")) + '</span><small>' + esc(rankName(r,"en")) + '</small></span>';

// ===== Storage画像 =====
function safeImagePath(p){ return /^event-assets\/[A-Za-z0-9_./-]+$/.test(String(p||"")) ? String(p) : ""; }
async function storageUrl(path){
  path=safeImagePath(path);
  if(!path || !storage) return "";
  return storage.ref(path).getDownloadURL();
}
function imageExt(file){
  const m={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}; return m[file?.type]||"";
}
function validateImage(file){
  if(!file) throw new Error("画像が選択されていません");
  if(!imageExt(file)) throw new Error("PNG / JPEG / WebPのみ利用できます");
  if(file.size >= 5*1024*1024) throw new Error("画像は5MB未満にしてください");
}
async function uploadAsset(file, kind, id){
  validateImage(file);
  if(!storage) throw new Error("Firebase Storage SDKが読み込まれていません");
  const path="event-assets/"+kind+"/"+id+"_"+Date.now()+"."+imageExt(file);
  await storage.ref(path).put(file,{contentType:file.type,cacheControl:"public,max-age=3600"});
  return path;
}
async function deleteAsset(path){ path=safeImagePath(path); if(path&&storage) await storage.ref(path).delete(); }

// ===== 監視 =====
function watchAll(onChange, onTick, onError) {
  let g = { ...defaults }, lastPhase = null, haveGame = false, haveSetup = false;
  let stopped = false;
  const setupPath = window.KAKUZUKE_PRIVATE ? "setup" : "publicSetup";
  const gamePath = window.KAKUZUKE_PRIVATE ? "game" : "publicGame";
  const fail = (where, e) => { console.error(where, e); if (onError) onError(where, e); };
  const fire = () => {
    if (stopped || !haveGame || !haveSetup) return;
    lastPhase = phaseOf(g); onChange(g); if (onTick) onTick(g);
  };
  // 初回をonceで確実に取得してから描画。その後リアルタイム監視へ移行。
  Promise.all([db.ref(setupPath).once("value"), db.ref(gamePath).once("value")]).then(([ss, gs]) => {
    SETUP = normalizeSetup(ss.val()); haveSetup = true;
    g = { ...defaults, ...(gs.val() || {}) }; haveGame = true;
    fire();
    db.ref(setupPath).on("value", x => { SETUP = normalizeSetup(x.val()); haveSetup = true; fire(); }, e => fail(setupPath, e));
    db.ref(gamePath).on("value", x => { g = { ...defaults, ...(x.val() || {}) }; haveGame = true; fire(); }, e => fail(gamePath, e));
  }).catch(e => fail("initial-load", e));
  const timer = setInterval(() => {
    if (!haveGame || !haveSetup) return;
    const p = phaseOf(g); if (p !== lastPhase) { lastPhase = p; onChange(g); }
    if (onTick) onTick(g);
  }, 250);
  return () => { stopped = true; clearInterval(timer); };
}

// Admin/Hostだけが非公開gameから、表示に必要な安全なデータへ同期する。
function publicGameFrom(g) {
  const ph = phaseOf(g), q = String(g.current || 0), confirmed = {}, ranks = {};
  SETUP.teams.forEach(t => { if (confirmOf(g,g.current,t.id)) confirmed[t.id]=true; ranks[t.id]=rankIndex(g,t.id); });
  const out={title:g.title,current:g.current,total:g.total,phase:ph,question:g.question,choices:g.choices||[],deadline:g.deadline||null,confirmed,rankIndexes:ranks,sessionId:g.sessionId||"legacy",introIndex:g.introIndex||0};
  if(ph==="lobby" && SETUP.titleImagePath) out.imagePath=SETUP.titleImagePath;
  if(ph==="lobby" && SETUP.introSlides.length) out.nextImagePath=SETUP.introSlides[0];
  if(ph==="intro" && SETUP.introSlides.length){ const ii=Math.min(g.introIndex||0,SETUP.introSlides.length-1); out.imagePath=SETUP.introSlides[ii]; out.introCount=SETUP.introSlides.length; if(ii+1<SETUP.introSlides.length)out.nextImagePath=SETUP.introSlides[ii+1]; }
  if(ph==="ready"){ const cq=SETUP.questions[(g.current||1)-1]; if(cq?.imagePath) out.imagePath=cq.imagePath; }
  if(ph==="closed"||ph==="answer") out.revealedVotes=g.votes?.[q]||{};
  if(ph==="answer") out.answer=g.answer||null;
  return out;
}
function publicResultsFrom(g) {
  const best=standings(g).filter(x=>x.place<=BEST_N).map(x=>({place:x.place,name:x.team.name,rank:SETUP.ranks[x.ri],ms:x.ms}));
  const groups=rankGroups(g).map(gr=>({rank:gr.rank,names:gr.teams.map(t=>t.name)}));
  return {best,groups};
}
let lastPublic="";
function syncPublic(g){
  if(!window.KAKUZUKE_PRIVATE)return;
  const o=publicGameFrom(g), j=JSON.stringify(o); if(j!==lastPublic){lastPublic=j;db.ref("publicGame").set(o).catch(console.error);}
  if(phaseOf(g)==="final") db.ref("publicResults").set(publicResultsFrom(g)).catch(console.error);
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
  introStart() { return SETUP.introSlides.length ? db.ref("game").update({phase:"intro",introIndex:0,current:0,deadline:null}) : this.goto(1); },
  introNext(g) { const n=SETUP.introSlides.length, i=g.introIndex||0; return i<n-1 ? db.ref("game/introIndex").set(i+1) : this.goto(1); },
  rankboard() { return db.ref("game").update({ phase: "rankboard", deadline: null }); },
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
    return db.ref("game").set({ title: g.title || defaults.title, phase: "lobby", current: 0, total: SETUP.questions.length, sessionId: randomTeamKey() });
  }
};
