# 院内回線からの打刻

通常打刻は asia-northeast1 の clinicPunch callable function のみ。本人確認、スタッフ登録、院内IPv4、同日再打刻をサーバーで検証し、最新状態と日別履歴を同一トランザクションで保存する。Firestore直接書込は許可しない。既存の管理者修正・承認は監査履歴付きで継続する。

CLINIC_IPV4 は functions/.env.odc-attendance-60c43 に設定し、公開リポジトリには保存しない。

関数は直接の cloudfunctions.net URL から呼ぶ。Hosting rewrite や別プロキシは使用しない。X-Forwarded-For が単一のIPv4で許可IPに一致した場合のみ許可する。欠落・IPv6・複数プロキシ経由は拒否する。実運用前に「院内回線を確認」を院内Wi-Fiと携帯回線の両方で試す。

IP制限は同じ出口IPを使う院内有線LANも許可する。固定IP契約でなければIP変更時に設定更新が必要。院内へのVPN接続を許可する運用では、院外からも同じ出口IPになることに注意する。

公開順序: npm ci --prefix functions → firebase deploy --only functions → firestore:rules,hosting → 回線確認。関数デプロイに失敗した場合は後半を実行しない。minInstances=0、maxInstances=1。これらは課金上限ではない。

院内回線の実機確認が完了するまでは導入完了としない。常時稼働なし、古いArtifact Registryイメージは1日で削除する。アプリの閲覧・修正申請・有給申請は院外でも利用可能。
