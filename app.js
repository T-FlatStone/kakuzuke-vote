const C = window.KAKUZUKE_CONFIG;
firebase.initializeApp(C.firebaseConfig);
const db = firebase.database();
const team = (new URLSearchParams(location.search).get("team") || "").toUpperCase();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const defaults = { current: 1, phase: "ready", question: "高級品はどっち？", choices: ["A","B"], answer: null };
// 不正解1回ごとに1ランク降格（未投票は変動なし）
function calcRank(votes, answers, t) {
  let miss = 0;
  Object.keys(answers || {}).forEach(q => { const v = votes?.[q]?.[t]; if (v && v !== answers[q]) miss++; });
  return Math.min(miss, C.ranks.length - 1);
}
