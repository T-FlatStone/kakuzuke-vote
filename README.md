# kakuzuke-vote v11 final (build 11.5)

現在のGitHub 9ファイルを基準に整合性を取り直した版。

- Admin/Host: Email/Password認証
- Vote: Anonymous Auth + team/key。匿名認証はVoteページ内メモリのみ
- Screen/Vote: publicSetup/publicGameのみ
- 受付中の回答内容は非公開、締切後に公開
- 最終結果はpublicResults。空ランクでも描画停止しない。生成遅延は最大4秒再取得
- ベスト4は4位側から1位へ表示
- A=赤 / B=緑 / C=黄 / D=青
- 全HTMLが app.js/style.css ?v=11.5 を参照
