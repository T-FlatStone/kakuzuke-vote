# kakuzuke-vote v9

## 認証
- admin.html: Firebase Email/Password。Admin UIDのみ。
- host.html: Firebase Email/Password。Host UIDまたはAdmin UID。
- screen.html / vote.html: 認証なし（チームキーは次段階）。

## 重要
Firebase Authenticationで Email/Password を有効化してください。database.rules.json を Realtime Database Rules に反映してください。
現在は投票URLのランダムキー未実装のため votes/confirms の書き込みは一時的に公開しています。

回答色: A=赤 / B=緑 / C=黄 / D=青。スクリーンは4:3固定ステージ。

## v10 Team URL Key
管理画面で各チームに128bit（32桁hex）のランダムキーを自動発行します。投票URLは `vote.html?team=A&key=...` 形式です。JSON書き出し・読込にもキーが含まれます。キー再発行後は旧QR/URLは無効です。
