# kakuzuke-vote v11.7-storage

- Admin/Host認証、チームキー、非公開回答、回答時間、順位・ベスト4を維持
- Adminからタイトル画像と問題画像をFirebase Storageへアップロード
- PNG/JPEG/WebP、5MB未満
- タイトル画像/問題画像が未登録なら従来のテキスト表示
- タイトル画像 → 問題画像 → 回答開始 → 締切 → 正解 → 次問題画像 → 最終結果
- JSONへ titleImagePath / questions[].imagePath を保存・復元
- 全リセット時にsessionIdを更新し、Voteの前回選択を持ち越さない
- A=赤 / B=緑 / C=黄 / D=青

## 反映
1. ZIP内のWebファイルをGitHubへ上書き
2. Storage Rulesは `storage.rules` をFirebase Storageのルールへ反映（既に同内容なら不要）
3. Adminでログインし、画像を選択してから設定を保存
4. 既存JSONは画像なし設定としてそのまま読み込み可能
