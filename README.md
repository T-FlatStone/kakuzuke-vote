# kakuzuke-vote v8

- `vote.html?team=A` ～ : チーム投票画面
- `screen.html` : プロジェクター用
- `host.html` : 司会用（v8表示・旧版警告）
- `admin.html` : 管理用（各チームの今回時間・現在合計を確認可能）
- `app.js` : 共通処理（APP_VERSION=8）
- `style.css` : 固定レイアウトの大型カウントダウン
- 選択肢色：A=赤 / B=緑 / C=黄 / D=青

`database.rules.json` は動作確認用です。誰でも読み書きできるため本番前に認証付きルールへ変更してください。
