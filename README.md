# kakuzuke-vote v11.8

## v11.8
- 問題前スライドを複数枚登録可能。Adminで複数画像を一括追加し、Hostの「次のスライド」で順送り。
- Voteの表示言語をチームごとに「日本語 / English」指定。
- ランク名を日本語名・英語名で登録。Screenでは両方を表示し、Voteではチーム言語側のみ表示。
- 最終結果の前に「全チーム格付け / All Team Ranks」を表示する進行フェーズを追加。
- 正解カードの白枠をカード内側に固定し、画面端での見切れを防止。
- v11.7のFirebase Storage、タイトル画像、認証、チームKey、回答時間、順位、sessionIdを維持。

## 本番進行
タイトル → 問題前スライド（1〜複数）→ 回答開始 → 締切 → 正解 → 次問題 → … → 全チーム格付け → 最終結果

## 更新
- GitHubへWebファイル一式を上書き。
- Realtime Database Rulesは `database.rules.json` を再公開（Hostによる `slideIndex` 更新許可を追加）。
- Storage Rulesはv11.7から変更なし。
- Adminで既存設定を読み込み、各ランクの英語名と各チームの言語を設定して保存。
