# kakuzuke-vote v11 (rebuild 11.3)

全画面を同一ビルドとして再構成。HTMLは app.js/style.css の `?v=11.3` を参照し、キャッシュ混在を防止。

- Admin/Host: Email/Password認証後のみ private setup/game を購読
- Admin/Host: private game → publicGame/publicResults を同期
- Vote: Anonymous Auth + team/keyをRulesで照合後、publicSetup/publicGameを購読
- Screen: publicSetup/publicGame/publicResultsのみ
- 投票受付中は他チームのA/B/C/Dを公開しない。締切後にrevealedVotesを公開
- A=赤 / B=緑 / C=黄 / D=青

## 更新
1. GitHubをZIP内9ファイルで全上書き
2. Firebase Authentication: Email/Password と Anonymous を有効化
3. Realtime Database Rulesへ同梱database.rules.jsonを反映
4. Adminログイン → 保存を1回押す
5. Hostログイン → 第1問へ → 回答開始
6. Aチームの最新キー付きURLで確認
