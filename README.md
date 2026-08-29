# クチトルZero Community

[English](README.en.md)

クチトルZero Communityは、店舗ごとのQRアンケートから来店者の声を集め、導入者自身のAI APIキーで口コミ文案を作るセルフホスト向けWebアプリです。Googleビジネスプロフィール、Instagram、DataForSEOの接続口と、日々のMEO運用をまとめる画面も含みます。

Community版はHosted版とは別の製品です。課金、クレジット、試用枠、クチトル側のAI中継、クチトル側の利用量・原価記録は含みません。外部APIの契約、利用料、運用、バックアップ、監視は導入者が管理します。

## 主な機能

- 複数店舗と店舗単位の権限管理
- QRインタビュー、アンケート設定、回答履歴、CSV／JSONエクスポート
- OpenAI、Gemini、DeepSeek、xAI、Anthropicを使った口コミ文案生成（BYOK）
- Googleビジネスプロフィール、Instagram、DataForSEOの店舗単位接続
- 投稿案、口コミ返信案、順位観測、作業履歴、承認ログ
- PWA対応

AIキーとproviderのモデル設定がなくても、店舗管理、QR受付、回答管理、手動編集は利用できます。利用するproviderだけ、interview、review、rewriteの3モデルIDをまとめて設定します。外部投稿・更新は初期状態では無効です。owner／adminが店舗設定を有効にし、owner／admin／editorのいずれかが操作ごとに `confirmed: true` を送った場合だけ実行します。analystは閲覧専用です。v1.0.0に自動投稿は含みません。

## 必要環境

- Node.js 24
- pnpm 10
- Deno 2
- Supabase CLI 2.109.1
- PostgreSQL 17互換
- Docker Compose v2（Docker版のみ）

バージョンは [`.node-version`](.node-version)、[`package.json`](package.json)、[`supabase/config.toml`](supabase/config.toml) で固定しています。

## 開発環境

Supabase CLIのローカル環境は開発とテスト専用です。本番運用にはDocker版またはSupabase Cloud版を使ってください。

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm supabase:start
pnpm supabase:reset
pnpm dev
```

`pnpm supabase:start` の出力にあるProject URLとpublishable keyを `.env.local` に設定します。APIキー、service role key、`AI_CREDENTIALS_MASTER_KEY_V1` は `VITE_` から始まる変数へ入れないでください。

## 本番導入

- Docker Compose: [`docs/self-hosting.md`](docs/self-hosting.md)
- Supabase Cloud: [`docs/supabase-cloud.md`](docs/supabase-cloud.md)
- バックアップ、更新、障害対応: [`docs/operations.md`](docs/operations.md)
- 構成とセキュリティ境界: [`docs/architecture.md`](docs/architecture.md)

公開コンテナは `ghcr.io/yoshi0703/kuchitoru-zero-oss` です。各ReleaseにはイメージDigest、SBOM、チェックサムを添付し、イメージはGitHub ActionsのOIDCで署名します。

## 設定

必須値と外部サービスごとの任意設定は [`.env.example`](.env.example) にまとめています。架空アカウントと店舗のseedは通常の起動やDB resetでは実行されません。Docker版の評価環境で必要な場合だけ `./scripts/self-host.sh seed` を明示的に実行します。

店舗のAIキーとDataForSEO認証情報は店舗単位で暗号化保存されます。取得APIは秘密値を返さず、`provider`、`model`、`status`、`keyLast4` だけを返します。Google Business ProfileとInstagramのOAuth認証情報は自己ホスト環境のサーバー側Secretとして設定します。

## 検証

```bash
pnpm check
pnpm test:edge
pnpm supabase:start
pnpm supabase:reset
pnpm test:db
pnpm test:e2e
```

テストは外部AI、Google、Meta、DataForSEOの実APIを呼びません。公開前の手動確認には、検証専用の店舗とAPIキーを使ってください。

## ライセンスと商標

ソースコードは [GNU AGPL v3以降](LICENSE) で提供します。Copyright © 2026 Ranchu Japan合同会社。

名称とロゴはソフトウェアライセンスの対象外です。再配布時の条件は [`TRADEMARKS.md`](TRADEMARKS.md) を確認してください。公式版と誤認させる表示はできません。

コントリビューションはDCO 1.1のSigned-off-by方式です。詳しくは [`CONTRIBUTING.md`](CONTRIBUTING.md) を参照してください。

## サポートと脆弱性報告

自己ホスト環境の構築・更新・監視はコミュニティサポートです。問い合わせ範囲は [`SUPPORT.md`](SUPPORT.md)、脆弱性の連絡方法は [`SECURITY.md`](SECURITY.md) を確認してください。

Hosted版は [クチトルZero](https://app.kuchitoru.com/) から利用できます。Hosted版の課金機能、運用基盤、すべての独自機能がこのリポジトリに含まれるわけではありません。
