# Firebase共有シフト準備版

管理者: omotesandodc@gmail.com（Googleログイン・メール確認済みが必要）。
管理者が6人の名前とGoogleメールを登録し、スタッフはシフトを閲覧します。
編集権限はFirestoreルールでも管理者に限定しています。
元のブラウザ内シフトは自動移行しません。既存データは旧画面からバックアップしてください。

## 公開

Node.jsとFirebase CLIを導入後、このfirebaseフォルダで実行します。

```sh
firebase login
firebase deploy --only firestore:rules,hosting --project odc-attendance-60c43
```

firebase init は不要です。設定ファイルを用意しています。
公開先: https://odc-attendance-60c43.web.app

## 公開後の確認（未実施）

- 管理者ログイン・初回設定作成・スタッフ名/メール/勤務時間保存
- シフト1セルを保存し別端末に反映されること
- 登録スタッフは閲覧可能、書き込みは拒否されること
- 未登録ユーザー・未ログインはデータを読めないこと
- スタッフメールを削除すると閲覧が拒否されること
- iPhone SafariでGoogleポップアップログインと再読み込み

現時点でJavaScript構文、HTML要素参照、JSON構文のみ確認済み。
Firestoreエミュレータ・実プロジェクトでの結合テストは未実施。
打刻、集計、Wi-Fi制限は未実装。シフトは全期間を購読する準備版です。
