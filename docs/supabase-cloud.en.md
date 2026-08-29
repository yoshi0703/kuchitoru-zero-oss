# Install on Supabase Cloud

Use a new Supabase Cloud project dedicated to the Community production environment. Never apply this procedure to the Hosted project or a project that already contains data.

## 1. Create a project

Create a project in the Supabase Dashboard and record its project ref, Project URL, publishable key, and database password. Select a region and plan appropriate for stored data, user location, and backup requirements.

## 2. Link the CLI and create the database

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec supabase login
pnpm exec supabase link --project-ref YOUR_PROJECT_REF
pnpm exec supabase db push --linked
```

Immediately before `db push`, confirm that the target is an empty, Community-only project. Version 1.0.0 applies one Community baseline migration. Normal migrations never insert fictional data.

Only for an evaluation project, explicitly load the fictional account and store with the database connection details shown in the Dashboard. Never run this on a production project. Enter the password interactively so it stays out of shell history and the repository.

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

## 3. Set Edge Function secrets

Generate three separate 32-byte standard Base64 values:

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

Create the Git-ignored file `supabase/.env.community.local` with these values:

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

The OpenAI trio above is an example. For every provider you enable, set its `*_INTERVIEW_MODEL`, `*_REVIEW_MODEL`, and `*_REWRITE_MODEL` values together. Valid prefixes are `OPENAI`, `GEMINI`, `DEEPSEEK`, `XAI`, and `ANTHROPIC`. A partial trio is rejected as misconfiguration. All providers may remain unset; non-AI APIs still work. Choose model IDs from each provider's current documentation. Community provides neither fixed models nor Kuchitoru-operated AI credentials.

```bash
pnpm exec supabase secrets set \
  --env-file supabase/.env.community.local \
  --project-ref YOUR_PROJECT_REF
```

Use the project's Function-provided values for `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_JWKS`; confirm that they are available in the Dashboard. Store-scoped AI and DataForSEO credentials are saved through the application, not as project secrets.

Only when Google Business Profile is enabled, add `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`, and `GOOGLE_BUSINESS_REDIRECT_URI`. For Instagram, add `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, and `INSTAGRAM_REDIRECT_URI`, plus `INSTAGRAM_API_VERSION` when needed. Do not configure only part of either required three-value set.

Only when background jobs are used, add `MEO_JOBS_ENABLED=true` and a `MEO_JOBS_TOKEN` of at least 32 characters.

## 4. Deploy the five Functions

Deploy an explicit list. `meo-api` validates OAuth callbacks, `meo-jobs` validates its dedicated bearer token, and `public-interview` validates short-lived session tokens in application code, so only those three disable gateway JWT verification.

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

## 5. Build and publish the web app

Pass Vite values in the same command environment. This makes the same public configuration and Git SHA available to both the npm lifecycle `prebuild` and the following Vite build.

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

Publish `dist/` to a static host, configure SPA fallback to `/index.html`, and enable TLS. Never place a service-role-equivalent key, AI master key, or provider credential in the web host environment.

## 6. Verify

In addition to [self-hosting.en.md](self-hosting.en.md), confirm that:

- only the `api` schema is exposed through the Data API;
- anon and authenticated roles cannot read the `private` schema;
- exactly the five listed Functions are deployed with the documented JWT settings;
- Function logs contain no API keys, Authorization headers, or response bodies;
- authenticated `owner-api/system-capabilities` reports Community/BYOK;
- authenticated `owner-api/version` matches the release version, Git SHA, and database schema version;
- external writes are disabled by default, run only with owner/admin enablement plus per-action `confirmed: true` from an owner, admin, or editor, and reject analysts.

See [operations.en.md](operations.en.md) for backup, updates, and incident response.
