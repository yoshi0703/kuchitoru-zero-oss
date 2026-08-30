# クチトルZERO Community

[English](README.en.md)

## 無料でMEO対策、できちゃいます！

クチトルZERO Communityは、Googleマップを使った店舗集客（MEO）を自分たちで進めたい店舗運営者や支援会社向けのオープンソースです。月額ツールを契約する前に、まず自分たちで動かしてみたい店舗に向いています。Community版のソフトウェア利用料は0円。QRアンケートで来店者の声を集め、口コミ文案や投稿案を作り、検索順位や日々の作業までひとつの画面で管理できます。

せっかく作ったので、Community版として公開しちゃいました。

**[自分で設置する](#本番導入)** · **[まず手元で試す](#開発環境)** · **[自分で設置せず使いたい方はHosted版へ](https://app.kuchitoru.com/)**

> **無料の範囲:** Community版のソフトウェア利用料は0円です。自己設置と運用、サーバー、Google、Meta、DataForSEO、AIなどの外部サービスの契約と利用料は導入者が負担します。

## できること

- 店舗ごとのQRアンケートで来店者の声を集める
- 集めた回答から口コミ文案を作る
- Googleビジネスプロフィール、Instagram、DataForSEOを店舗ごとに接続する
- 投稿案や口コミ返信案を作り、検索順位、作業履歴、承認ログを管理する
- 複数店舗とメンバーの権限を分けて管理する
- アンケート設定、回答履歴、CSV／JSONエクスポートを使う
- スマートフォンやPCのブラウザから利用する

口コミ文案は来店者自身の回答から作る下書きです。特典と引き換えに口コミを集めたり、高評価の投稿だけを促したりする用途には使わないでください。

AIを設定しなくても、店舗管理、QR受付、回答管理、手動編集は使えます。外部への投稿やプロフィール更新は初期状態で止めています。管理者が店舗設定を有効にし、権限のある担当者が操作ごとに承認した場合だけ実行します。v1.0.0に自動投稿はありません。

## 技術情報

### AI接続

AIはBYOK（Bring Your Own Key、利用者自身のAPIキーを使う方式）です。OpenAI、Gemini、DeepSeek、xAI、Anthropicに対応しています。利用するAI提供元（provider）ごとに、interview、review、rewriteの3モデルIDをまとめて設定します。

AIキーとDataForSEO認証情報は店舗単位で暗号化保存します。取得APIは秘密値を返さず、`provider`、`model`、`status`、`keyLast4`だけを返します。

### 外部連携と承認

GoogleビジネスプロフィールとInstagramのOAuth（外部サービスの認証・認可手続き）に使う認証情報は、自己ホスト環境のサーバー側Secretとして設定します。

外部への投稿や更新は、owner／adminが店舗設定を有効にし、owner／admin／editorのいずれかが操作ごとに`confirmed: true`を送った場合だけ実行します。analystは閲覧専用です。

### Webアプリと配布物

PWA（ブラウザから端末へ追加できるWebアプリ）に対応しています。公開コンテナはGitHub Container Registry（GHCR）の`ghcr.io/yoshi0703/kuchitoru-zero-oss`です。各ReleaseにはイメージDigest（内容を特定する識別値）、SBOM（ソフトウェア部品表）、チェックサムを添付します。イメージはOIDC（GitHub Actionsの実行元を確認する方式）で署名します。

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

## 設定

必須値と外部サービスごとの任意設定は [`.env.example`](.env.example) にまとめています。架空アカウントと店舗のseedは通常の起動やDB resetでは実行されません。Docker版の評価環境で必要な場合だけ `./scripts/self-host.sh seed` を明示的に実行します。

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

## Community版とHosted版

Community版は自己設置向けです。課金、クレジット、試用枠、クチトル側のAI中継、クチトル側の利用量・原価記録は含みません。導入者が構築、更新、バックアップ、監視を行います。

Hosted版は[クチトルZERO](https://app.kuchitoru.com/)から利用できます。運用基盤や課金機能、このリポジトリに含まれない独自機能を提供しています。両版は同じコード、同じ機能ではありません。

## ライセンスと商標

ソースコードは [GNU AGPL v3以降](LICENSE) で提供します。Copyright © 2026 Ranchu Japan合同会社。

名称とロゴはソフトウェアライセンスの対象外です。再配布時の条件は [`TRADEMARKS.md`](TRADEMARKS.md) を確認してください。公式版と誤認させる表示はできません。

コントリビューションはDCO 1.1のSigned-off-by方式です。詳しくは [`CONTRIBUTING.md`](CONTRIBUTING.md) を参照してください。

## サポートと脆弱性報告

自己ホスト環境の構築・更新・監視はコミュニティサポートです。問い合わせ範囲は [`SUPPORT.md`](SUPPORT.md)、脆弱性の連絡方法は [`SECURITY.md`](SECURITY.md) を確認してください。
