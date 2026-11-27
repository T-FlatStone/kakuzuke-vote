# kakuzuke-vote v11.17
- 最後のオープニング画像では司会ボタンを必ず「第1問へ」と表示。introCountは公開ゲーム状態も参照。
- 画面状態に stateRev を追加し、古いRealtimeイベント・画像読込結果をScreenが無視。
- 画像失敗時に古い状態を再renderしない。これにより第1問切替時のタイトル画像復活を防止。
- Rules変更なし。
