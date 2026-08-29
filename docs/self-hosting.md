# Docker Composeで導入する

この手順は本番向けの自己ホスト構成です。Supabase公式self-hosted bundle `self-hosted/v0.8.0`（commit `241bb11c0627f2981746d37033f57dbfa81d29b0`）を固定して取得し、薄いCompose overrideでCommunityのWeb、Migration、Edge Functionsを追加します。

## 1. 準備

Docker EngineとCompose v2、Git、OpenSSLを用意します。外部公開にはDNSとTLS終端用のリバースプロキシも必要です。

```bash
git clone https://github.com/yoshi0703/kuchitoru-zero-oss.git
cd kuchitoru-zero-oss
git checkout v1.0.0
./scripts/self-host.sh bootstrap
```

`bootstrap` は `deploy/self-hosted/supabase/` へ公式bundleを展開し、Supabaseの鍵に加えて次のCommunity用Secretを生成します。このディレクトリはGit管理されません。

- `AI_CREDENTIALS_MASTER_KEY_V1`
- `SESSION_TOKEN_DERIVATION_KEY`
- `RATE_LIMIT_HMAC_KEY`
- `MEO_JOBS_TOKEN`

## 2. 必須設定

`deploy/self-hosted/supabase/.env` を開き、まず公式bundleの次の値を本番用に設定します。

- `SUPABASE_PUBLIC_URL`: ブラウザから到達できるSupabase URL
- `API_EXTERNAL_URL`: 通常は `${SUPABASE_PUBLIC_URL}/auth/v1`
- `SITE_URL`: Community Webの公開URL
- `ADDITIONAL_REDIRECT_URLS`: 認証callbackの許可URL
- `DASHBOARD_USERNAME` と生成済み `DASHBOARD_PASSWORD`
- `SMTP_*`: 確認メールを送る本番SMTP

続いて、Community用の次の値を設定します。

- `AI_CREDENTIALS_ACTIVE_KEY_VERSION=1`
- `TURNSTILE_SITE_KEY` と `TURNSTILE_SECRET_KEY`: 同じCloudflare Turnstile Widgetの組み合わせ

AIを使う場合は、利用するproviderの `*_INTERVIEW_MODEL`、`*_REVIEW_MODEL`、`*_REWRITE_MODEL` を3つまとめて設定します。対象providerは `OPENAI`、`GEMINI`、`DEEPSEEK`、`XAI`、`ANTHROPIC` です。モデルIDは導入者が各providerの現行仕様を確認して選びます。一部の値だけを設定すると、そのproviderは設定不備として扱われます。全providerを空欄にした構成でもFunctionsは起動し、AI生成以外のAPIを利用できます。

Compose overrideは `SITE_URL` を `ALLOWED_ORIGINS` と `MEO_APP_ORIGIN` に渡し、公式bundleが生成した `SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`、`JWT_JWKS` をFunctionsへ渡します。

## 3. 任意の外部接続

Google Business Profileを使う場合は、次の3値をまとめて設定します。

```dotenv
GOOGLE_BUSINESS_CLIENT_ID=
GOOGLE_BUSINESS_CLIENT_SECRET=
GOOGLE_BUSINESS_REDIRECT_URI=https://supabase.example.com/functions/v1/meo-api/oauth/google/callback
```

Instagramを使う場合も、次の3値をまとめて設定します。

```dotenv
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=https://supabase.example.com/functions/v1/meo-api/oauth/instagram/callback
INSTAGRAM_API_VERSION=v25.0
```

バックグラウンドジョブは既定で `MEO_JOBS_ENABLED=false` です。スケジューラーから `meo-jobs` を呼ぶ場合だけ有効にし、生成済み `MEO_JOBS_TOKEN` をBearer tokenとして使います。

## 4. 起動

設定を展開してから起動します。

```bash
./scripts/self-host.sh config
./scripts/self-host.sh up
./scripts/self-host.sh status
```

初回起動時は空DBへCommunity baseline Migrationを適用します。Webは既定で `http://localhost:3000`、Supabase gatewayは `http://localhost:8000` です。通常の `bootstrap`、`up`、Migrationでは架空データを投入しません。初期アカウントと店舗は画面から作成してください。

ローカル評価用の架空アカウントと店舗が必要な場合だけ、明示的にseedを実行できます。本番環境では実行しないでください。

```bash
./scripts/self-host.sh seed
```

このコマンドだけが `community-seed` profileを起動し、`supabase/seed.sql` を適用します。

公式Functionsコンテナ内のdispatcherが、次の5 Functionsへルーティングします。

- `owner-api`
- `public-interview`
- `meo-api`
- `meo-jobs`
- `meo-workspace`

## 5. 確認

1. 新規アカウントを作成し、確認メールからログインする。
2. 複数店舗を作成し、担当者の権限が店舗ごとに分離されることを確認する。
3. QRから回答し、回答履歴へ反映されることを確認する。
4. 検証用AIキーを1店舗へ保存し、末尾4文字だけが表示されることを確認する。
5. 文案生成、MEO画面、キー削除を確認する。
6. ブラウザNetwork、サーバーログ、JavaScript bundleに秘密値がないことを確認する。
7. 外部書き込みが初期無効であり、owner／adminが店舗設定を有効にしたうえで、owner／admin／editorが対象操作に `confirmed: true` を付けた場合だけ実行され、analystは拒否されることを確認する。

## 停止とログ

```bash
./scripts/self-host.sh logs
./scripts/self-host.sh down
```

`down` は永続volumeを削除しません。データを消す `docker compose down -v` は、このスクリプトでは提供していません。

外部公開前に、Supabase公式の[Docker self-hosting guide](https://supabase.com/docs/guides/self-hosting/docker)に沿ってSecret、SMTP、TLS、CORS、ネットワーク制限、バックアップを設定してください。更新と復旧は [operations.md](operations.md) を参照してください。
