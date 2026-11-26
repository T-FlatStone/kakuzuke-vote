# kakuzuke-vote v11

## v11 セキュリティ
- admin.html: Email/Password + Admin UID
- host.html: Email/Password + Host/Admin UID
- vote.html: Anonymous Authentication + チーム別128bitキー
- Realtime Database Rulesで、チームは自チームにだけ、回答受付中だけ書き込み可能
- setup/teamKeys は非公開。screen/vote は publicSetup のみ読み込み

## v10からの移行手順（順番重要）
1. Firebase Authentication > Sign-in method で Anonymous（匿名）を有効化。
2. GitHubへv11の全ファイルを上書き。
3. Realtime Database Rulesへ同梱の database.rules.json を反映。
4. admin.htmlへ管理者ログイン。既存設定が読み込まれたら「保存」を1回押す。これで publicSetup と teamKeys が作成される。
5. 管理画面のキー付きURLでAチームを1台テスト。

JSONにはteam keyも含まれるため、JSONファイルはGitHubへコミットしないこと。
