# kakuzuke-vote v11

- game/votes/confirms/setup/teamKeys は非公開。
- Screen/投票ページは publicSetup/publicGame のみ読み取り。
- 投票中 publicGame には確定済み情報だけを公開し、A/B/C/Dは公開しない。
- 締切後に revealedVotes、正解発表後に answer を公開。
- Team URLは匿名認証＋ランダムキーをRulesで強制。

## 移行手順
1. Authenticationで Email/Password と Anonymous を有効化。
2. 全ファイルをGitHubへ上書き。
3. database.rules.jsonをRealtime Database Rulesへ反映。
4. Adminでログインし「保存」を1回押して publicSetup/teamKeys を生成。
5. HostまたはAdmin画面を本番中開いておく（publicGame同期担当）。
