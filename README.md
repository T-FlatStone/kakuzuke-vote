# kakuzuke-vote v11.14
- 原因修正: Hostは `/game` 全体へのwrite権限がないのに、オープニング開始等で `/game.update()` を使っていたため、ローカルで一瞬表示後にFirebaseから拒否・ロールバックされていた。
- Hostの進行操作を、Rulesで許可済みの子パス（phase/current/introIndex等）への個別書込みへ統一。
- オープニング開始、次画像、第1問、回答開始、締切、正解、全チーム格付け、最終結果がHost権限で持続する。
- Rules変更なし。
