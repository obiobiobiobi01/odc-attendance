# ODC 共有シフト版（接続前）

現在の公開 index.html は変更していません。cloud.html がログイン・共有保存の準備版です。
まだ本番運用可能という意味ではありません。Supabase接続と実機試験が必要です。

## 初期設定

1. 管理者自身のSupabaseアカウントで専用プロジェクトを作成する。契約・料金・リージョンを管理者が確認する。
2. SQL Editorで schema.sql を一度実行する。既存プロジェクトには無確認で実行しない。
3. Authの公開サインアップを無効にする。管理者がAuth管理画面でユーザーを作成する。
4. IDは admin / staff01〜staff06 等。Auth上のメールを admin@odc.invalid 等にし、確認済みとして管理者が作成する。メールによる復旧は使えないため、パスワード再設定は管理者が管理画面で行う。実メールアドレスをIDにする方法も対応。
5. 各AuthユーザーのUUIDを、SQL Editorから odc_members に登録する。管理者は role='admin'、スタッフは role='staff'。このテーブルはブラウザから書き換えられない。
6. cloud-config.js に Project URL と publishable key (sb_publishable_...) を設定する。秘密鍵・service_roleキー・パスワードは絶対にコード/GitHubへ保存しない。
7. cloud.html を開き、管理者・スタッフの別端末で下記の受入確認を行う。
8. 受入確認後に、cloud.html を正式入口に切り替える。既存試作データの自動移行は行わない。必要なら移行対象を別途確認する。

登録SQL例（UUIDはAuth管理画面で確認した値に置換）：

```sql
insert into public.odc_members (user_id, role)
values ('AUTH_USER_UUID', 'admin');
```

## 暫定権限

- 管理者：共有シフトとスタッフ名・勤務時間を編集。
- スタッフ：共有シフト閲覧と出力。
- 未ログイン/未登録アカウント：共有データにアクセス不可。
- 管理者以外の編集不可はDB側でも強制。院長のみ編集という権限設計は本番化前に確認する。

## 受入確認（接続後に必須・未実施）

- 未ログインでREST APIを呼んでも共有データを取得できない。
- Authユーザーだけ作成し、メンバー未登録の場合は閲覧できない。
- スタッフで保存RPCを直接呼んでも拒否される。自分をadminへ変更できない。
- 管理者が保存し、別端末の「最新を読み込む」で反映される。
- 管理者2端末で同時編集し、後から保存した古い版が拒否される。
- 通信切断時に「保存済み」と表示されず、再読込で結果を確認できる。
- ログアウト後にシフト内容が画面から消える。
- iPhone SafariとWindowsのブラウザで操作・CSVを確認する。

## 動作と制限

認証はSupabase Auth、共有保存はPostgreSQL + RLS。1クリニック専用構成。
パスワードや認証トークンをlocalStorageへ保存しない。ページ再読込・トークン期限切れは再ログイン。
共有内容はログイン時・保存時・「最新を読み込む」で反映。リアルタイム自動更新ではない。
シフト全体を版番号付きで保存し、競合時は拒否する。競合した編集は再読込後やり直す。
出退勤打刻、勤怠集計、院内Wi-Fi制限は未実装。

公式資料：
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/database/postgres/row-level-security
