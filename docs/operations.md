# 運用

自己ホスト環境では、導入者が更新、バックアップ、監視、外部API契約を管理します。以下は最小限の運用基準です。

## バックアップ

- PostgreSQL: 毎日 `pg_dump --format=custom` を取得し、DBホストとは別の暗号化ストレージへ保存する。
- 設定: Secretの値ではなく、必要なSecret名、DNS、callback URL、Release tag、Supabase bundle tagを記録する。
- 保持期間と復旧時点は、店舗の運用要件に合わせて決める。
- 少なくともReleaseごとに、別DBへの復元テストを行う。

v1.0.0はSupabase Storageをアプリデータに使いません。将来有効にした場合は、PostgreSQLとは別にobject backupを追加してください。バックアップ、DB URL、secret keyをリポジトリへ入れないでください。

## 更新

1. Release notesとMigrationを読む。
2. DBと設定をバックアップする。
3. stagingへ新しいtagを配備する。
4. アカウント作成、複数店舗、QR回答、BYOK保存・生成、MEO画面、権限分離、キー削除を確認する。
5. 外部書き込みが初期無効であり、owner／adminの有効化とowner／admin／editorによる操作ごとの `confirmed: true` がある場合だけ動き、analystは拒否されることを確認する。
6. 本番を更新し、認証後の `owner-api/version` からCommunity version、Git SHA、DB schema versionを読み戻す。

Docker版のSupabase bundleは自動更新しません。Community Releaseが指定するbundle tagだけを使い、Supabaseの[更新手順](https://supabase.com/docs/guides/self-hosting/updating)を確認してから更新します。

## 監視

- Web `/healthz`
- Supabase gateway、Auth、Functions、PostgreSQLのhealth
- 5xx率とFunction timeout
- Migration失敗、ジョブ失敗、確認済み外部操作の結果
- ディスク容量、DB接続数、バックアップの最終成功日時

リクエスト本文、Authorization header、APIキーはログへ記録しません。店舗IDや相関IDにも保存期間を設定します。Communityはクチトル側の月次AI使用量やprovider原価を記録しません。providerの請求・上限は導入者自身の管理画面で監視してください。

`supabase/seed.sql` は架空データを使う評価専用です。本番、staging、復旧先では実行しません。通常の起動、更新、Migration、DB resetにも組み込まないでください。

## 障害対応

1. 外部書き込みに影響する場合は、店舗の外部書き込み設定を無効にする。
2. version、発生時刻、対象店舗、相関ID、外部provider状態を記録する。
3. WebとFunctionsは直前のReleaseへ戻す。
4. DBは破壊的に戻さず、前方修正Migrationを追加する。
5. 店舗間参照や秘密漏えいの疑いがある場合は、影響範囲を確定して該当資格情報をローテーションする。
6. 復旧後に同じ経路を再確認し、原因と再発防止を記録する。

## Secretの変更

`AI_CREDENTIALS_MASTER_KEY_V1` を失うと、そのkey versionで暗号化した資格情報を復号できません。ローテーションは次の順で行います。

1. 32 byte standard Base64の `AI_CREDENTIALS_MASTER_KEY_V2` を追加する。
2. V1を残したまま `AI_CREDENTIALS_ACTIVE_KEY_VERSION=2` に変更する。
3. 新規保存と既存資格情報の読取をstagingで確認する。
4. 既存資格情報をV2へ再暗号化する手順を別途用意して検証する。
5. V1で暗号化された行がなくなったことを確認してからV1を削除する。

値の上書きだけでローテーションしないでください。`SESSION_TOKEN_DERIVATION_KEY` の変更は既存の公開session tokenを失効させます。Turnstileはsite keyとsecret keyを同じWidgetの組み合わせで更新します。
