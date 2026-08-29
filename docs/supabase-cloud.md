# Supabase Cloudへ導入する

新規のSupabase Cloud ProjectをCommunity専用の本番環境として使う手順です。Hosted版のProjectや既存データがあるProjectには適用しないでください。

## 1. Projectを作る

Supabase DashboardでProjectを作成し、Project ref、Project URL、publishable key、database passwordを控えます。Regionと料金プランは、保存データ、利用地域、バックアップ要件に合わせて選びます。

## 2. CLIを接続してDBを作る

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec supabase login
pnpm exec supabase link --project-ref YOUR_PROJECT_REF
pnpm exec supabase db push --linked
```

`db push` の直前に、接続先が空のCommunity専用Projectであることを確認してください。v1.0.0は1本のCommunity baseline Migrationを適用します。通常のMigrationは架空データを投入しません。

評価専用Projectで架空アカウントと店舗が必要な場合だけ、Dashboardに表示されるDB接続情報を使ってseedを明示的に実行します。本番Projectでは実行しないでください。passwordは対話入力し、shell履歴やリポジトリへ残さないでください。

```bash
psql \
  --host=YOUR_DATABASE_HOST \
  --port=5432 \
  --dbname=postgres \
  --username=YOUR_DATABASE_USER \
  --password \
  --set=ON_ERROR_STOP=1 \
  --file supabase/seed.sql
```

## 3. Edge FunctionのSecretを設定する

次の3値には、それぞれ別の32 byte standard Base64値を使います。

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

Git管理されない `supabase/.env.community.local` を作り、次の値を設定します。

```dotenv
ALLOWED_ORIGINS=https://community.example.com
MEO_APP_ORIGIN=https://community.example.com
AI_CREDENTIALS_MASTER_KEY_V1=GENERATED_BASE64_KEY_1
AI_CREDENTIALS_ACTIVE_KEY_VERSION=1
SESSION_TOKEN_DERIVATION_KEY=GENERATED_BASE64_KEY_2
RATE_LIMIT_HMAC_KEY=GENERATED_BASE64_KEY_3
TURNSTILE_SECRET_KEY=YOUR_TURNSTILE_SECRET
COMMUNITY_GIT_SHA=FULL_40_CHARACTER_GIT_SHA

OPENAI_INTERVIEW_MODEL=YOUR_MODEL_ID
OPENAI_REVIEW_MODEL=YOUR_MODEL_ID
OPENAI_REWRITE_MODEL=YOUR_MODEL_ID
```

上のOpenAI 3値は設定例です。利用するproviderごとに `*_INTERVIEW_MODEL`、`*_REVIEW_MODEL`、`*_REWRITE_MODEL` を3つまとめて設定します。prefixは `OPENAI`、`GEMINI`、`DEEPSEEK`、`XAI`、`ANTHROPIC` です。一部だけを設定すると、そのproviderは設定不備として扱われます。全providerを未設定にしても非AI APIは動作します。モデルIDは導入者が各providerの現行仕様を確認して選びます。Communityは固定モデルやクチトル側のAIキーを提供しません。

```bash
pnpm exec supabase secrets set \
  --env-file supabase/.env.community.local \
  --project-ref YOUR_PROJECT_REF
```

`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`、`SUPABASE_JWKS` はProjectがFunctionsへ供給する値を使います。Dashboardでこれらが利用できることを確認してください。店舗ごとのAIキーとDataForSEO認証情報はアプリから保存し、Project Secretへ置きません。

Google Business Profileを使う場合だけ、`GOOGLE_BUSINESS_CLIENT_ID`、`GOOGLE_BUSINESS_CLIENT_SECRET`、`GOOGLE_BUSINESS_REDIRECT_URI` を追加します。Instagramを使う場合は `INSTAGRAM_APP_ID`、`INSTAGRAM_APP_SECRET`、`INSTAGRAM_REDIRECT_URI` を追加し、必要に応じて `INSTAGRAM_API_VERSION` も設定します。各接続の必須3値は一部だけ設定しないでください。

バックグラウンドジョブを使う場合だけ、`MEO_JOBS_ENABLED=true` と32文字以上の `MEO_JOBS_TOKEN` を追加します。

## 4. 5 Functionsを配備する

Functionsを列挙して配備します。`meo-api` はOAuth callback、`meo-jobs` は専用Bearer token、`public-interview` は短命session tokenをFunction内で検証するため、該当3つだけgatewayのJWT検証を無効にします。

```bash
pnpm exec supabase functions deploy owner-api \
  --project-ref YOUR_PROJECT_REF
pnpm exec supabase functions deploy meo-workspace \
  --project-ref YOUR_PROJECT_REF
pnpm exec supabase functions deploy meo-api \
  --no-verify-jwt --project-ref YOUR_PROJECT_REF
pnpm exec supabase functions deploy meo-jobs \
  --no-verify-jwt --project-ref YOUR_PROJECT_REF
pnpm exec supabase functions deploy public-interview \
  --no-verify-jwt --project-ref YOUR_PROJECT_REF
```

## 5. Webをビルドして配信する

Vite値をコマンドと同じ環境へ渡してビルドします。これにより、npm lifecycleの `prebuild` と続くVite buildの両方へ同じ公開設定とGit SHAが渡ります。

```bash
GITHUB_SHA="$(git rev-parse HEAD)" \
DEPLOY_ENV=production \
VITE_APP_ORIGIN=https://community.example.com \
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME \
VITE_TURNSTILE_SITE_KEY=YOUR_TURNSTILE_SITE_KEY \
VITE_GOOGLE_AUTH_ENABLED=false \
pnpm build
```

`dist/` を静的ホスティングへ配信し、SPA fallbackを `/index.html` に設定してTLSを有効にします。service role相当のkey、AIマスターキー、provider credentialをWebホストへ設定しないでください。

## 6. 確認

[self-hosting.md](self-hosting.md) の確認項目に加え、次を確認します。

- Data APIの公開schemaが `api` だけである
- `private` schemaをanon／authenticatedから参照できない
- 配備済みFunctionsが上記5つだけで、JWT設定が手順どおりである
- FunctionログにAPIキー、Authorization header、回答本文が出ていない
- 認証後の `owner-api/system-capabilities` がCommunity/BYOKを返す
- 認証後の `owner-api/version` がReleaseのversion、Git SHA、DB schema versionと一致する
- 外部書き込みが初期無効で、owner／adminの有効化とowner／admin／editorによる操作ごとの `confirmed: true` がそろった場合だけ実行され、analystは拒否される

バックアップ、更新、障害対応は [operations.md](operations.md) を参照してください。
