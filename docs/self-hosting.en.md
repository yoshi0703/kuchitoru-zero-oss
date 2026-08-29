# Install with Docker Compose

This is the production self-hosting path. It pins the official Supabase self-hosted bundle at `self-hosted/v0.8.0` (commit `241bb11c0627f2981746d37033f57dbfa81d29b0`) and adds the Community web app, migration, and Edge Functions through a thin Compose override.

## 1. Prepare

Install Docker Engine with Compose v2, Git, and OpenSSL. A public deployment also needs DNS and a TLS-terminating reverse proxy.

```bash
git clone https://github.com/yoshi0703/kuchitoru-zero-oss.git
cd kuchitoru-zero-oss
git checkout v1.0.0
./scripts/self-host.sh bootstrap
```

`bootstrap` expands the official bundle into `deploy/self-hosted/supabase/` and generates these Community secrets in addition to the Supabase keys. The directory is ignored by Git.

- `AI_CREDENTIALS_MASTER_KEY_V1`
- `SESSION_TOKEN_DERIVATION_KEY`
- `RATE_LIMIT_HMAC_KEY`
- `MEO_JOBS_TOKEN`

## 2. Required configuration

Open `deploy/self-hosted/supabase/.env` and first configure these official bundle values for production:

- `SUPABASE_PUBLIC_URL`: browser-accessible Supabase URL
- `API_EXTERNAL_URL`: normally `${SUPABASE_PUBLIC_URL}/auth/v1`
- `SITE_URL`: public Community web URL
- `ADDITIONAL_REDIRECT_URLS`: allowed authentication callback URLs
- `DASHBOARD_USERNAME` and the generated `DASHBOARD_PASSWORD`
- `SMTP_*`: production confirmation-email delivery

Then configure these Community values:

- `AI_CREDENTIALS_ACTIVE_KEY_VERSION=1`
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` from the same Cloudflare Turnstile widget

To use AI, set the `*_INTERVIEW_MODEL`, `*_REVIEW_MODEL`, and `*_REWRITE_MODEL` values together for each provider you enable. The provider prefixes are `OPENAI`, `GEMINI`, `DEEPSEEK`, `XAI`, and `ANTHROPIC`. Choose model IDs from each provider's current documentation. A partial three-value set is rejected as misconfiguration. All providers may remain blank; Functions still start and non-AI APIs remain available.

The Compose override maps `SITE_URL` to `ALLOWED_ORIGINS` and `MEO_APP_ORIGIN`. It also passes the official bundle's generated `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `JWT_JWKS` to Functions.

## 3. Optional external connections

Set all three values together when enabling Google Business Profile:

```dotenv
GOOGLE_BUSINESS_CLIENT_ID=
GOOGLE_BUSINESS_CLIENT_SECRET=
GOOGLE_BUSINESS_REDIRECT_URI=https://supabase.example.com/functions/v1/meo-api/oauth/google/callback
```

Set all three required values together when enabling Instagram:

```dotenv
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=https://supabase.example.com/functions/v1/meo-api/oauth/instagram/callback
INSTAGRAM_API_VERSION=v25.0
```

Background jobs default to `MEO_JOBS_ENABLED=false`. Enable them only when a scheduler calls `meo-jobs`, using the generated `MEO_JOBS_TOKEN` as its bearer token.

## 4. Start

Render the configuration before starting:

```bash
./scripts/self-host.sh config
./scripts/self-host.sh up
./scripts/self-host.sh status
```

The first start applies the Community baseline migration to an empty database. Defaults are `http://localhost:3000` for the web app and `http://localhost:8000` for the Supabase gateway. Normal `bootstrap`, `up`, and migration commands never insert fictional data. Create the first account and stores through the application.

For local evaluation only, explicitly load the fictional account and store. Never run this command in production.

```bash
./scripts/self-host.sh seed
```

Only this command starts the `community-seed` profile and applies `supabase/seed.sql`.

The dispatcher in the official Functions container routes these five Functions:

- `owner-api`
- `public-interview`
- `meo-api`
- `meo-jobs`
- `meo-workspace`

## 5. Verify

1. Create an account and sign in through the confirmation email.
2. Create multiple stores and verify store-scoped operator isolation.
3. Submit a QR response and verify response history.
4. Save a dedicated AI key for one store and confirm that only its final four characters appear.
5. Verify drafting, the local search workspace, and key deletion.
6. Confirm no secret appears in browser Network data, server logs, or the JavaScript bundle.
7. Confirm external writes are disabled by default, run only after an owner/admin enables the store setting and an owner, admin, or editor sends `confirmed: true`, and reject analysts.

## Stop and logs

```bash
./scripts/self-host.sh logs
./scripts/self-host.sh down
```

`down` preserves persistent volumes. The script intentionally provides no shortcut for destructive `docker compose down -v`.

Before public exposure, follow the official [Supabase Docker self-hosting guide](https://supabase.com/docs/guides/self-hosting/docker) for secrets, SMTP, TLS, CORS, network controls, and backups. See [operations.en.md](operations.en.md) for updates and recovery.
