# Kuchitoru ZERO Community

[日本語](README.md)

## Run MEO for free. Yep, you can.

Kuchitoru ZERO Community is open-source software for store operators and agencies that want to manage Google Maps-based customer acquisition, often called MEO in Japan, on their own. It is a good fit for stores that want to run the software themselves before signing up for a monthly subscription. The Community software fee is zero. Collect customer feedback through QR surveys, draft review text and posts, and track search rankings and day-to-day work in one place.

We built it, so we figured we might as well publish a Community edition.

**[Install it yourself](#production-installation)** · **[Try it locally](#development)** · **[Want to use it without self-hosting? Try Hosted](https://app.kuchitoru.com/)**

> **What “free” means:** The Community software fee is zero. You are responsible for self-hosting and operations, server costs, and third-party contracts and usage fees for services such as Google, Meta, DataForSEO, and AI providers.

## What you can do

- Collect customer feedback through store-specific QR surveys
- Draft review text from collected responses
- Connect Google Business Profile, Instagram, and DataForSEO per store
- Prepare post and review reply drafts, then track search rankings, work history, and approval logs
- Manage multiple stores with separate member permissions
- Configure surveys, retain response history, and export CSV or JSON files
- Use the app from a phone or desktop browser

Review drafts are based on each visitor's own responses. Do not use them to collect reviews in exchange for incentives or to solicit only positive reviews.

Store management, QR intake, response management, and manual editing work without an AI connection. External publishing and profile updates are disabled by default. They run only after an administrator enables the store setting and an authorized member approves each action. Version 1.0.0 includes no automatic posting.

## Technical details

### AI connections

AI uses BYOK (Bring Your Own Key), which means you supply your own API keys. Supported providers are OpenAI, Gemini, DeepSeek, xAI, and Anthropic. For each provider you use, configure the interview, review, and rewrite model IDs together.

AI keys and DataForSEO credentials are encrypted per store. Read APIs never return a secret; they return only `provider`, `model`, `status`, and `keyLast4`.

### External services and approvals

Google Business Profile and Instagram OAuth credentials, used to authorize access to those external services, are configured as server-side secrets in the self-hosted environment.

External publishing and updates run only after an owner or admin enables the store setting and an owner, admin, or editor sends `confirmed: true` for that action. Analysts remain read-only.

### Web app and release artifacts

The app is a Progressive Web App (PWA), so you can add it to a device from the browser. The published container is hosted on GitHub Container Registry (GHCR) at `ghcr.io/yoshi0703/kuchitoru-zero-oss`. Each release includes an image digest, which identifies its exact contents, a Software Bill of Materials (SBOM), and checksums. Images are signed with OpenID Connect (OIDC) to verify that the signing process ran in GitHub Actions.

## Requirements

- Node.js 24
- pnpm 10
- Deno 2
- Supabase CLI 2.109.1
- PostgreSQL 17 compatible database
- Docker Compose v2 for the Docker installation

Exact versions are recorded in [`.node-version`](.node-version), [`package.json`](package.json), and [`supabase/config.toml`](supabase/config.toml).

## Development

The local Supabase CLI stack is for development and testing only. Use the Docker or Supabase Cloud installation for production.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm supabase:start
pnpm supabase:reset
pnpm dev
```

Copy the Project URL and publishable key reported by `pnpm supabase:start` into `.env.local`. Never place API keys, a service role key, or `AI_CREDENTIALS_MASTER_KEY_V1` in a variable prefixed with `VITE_`.

## Production installation

- Docker Compose: [`docs/self-hosting.en.md`](docs/self-hosting.en.md)
- Supabase Cloud: [`docs/supabase-cloud.en.md`](docs/supabase-cloud.en.md)
- Backup, updates, and incident response: [`docs/operations.en.md`](docs/operations.en.md)
- Architecture and security boundaries: [`docs/architecture.en.md`](docs/architecture.en.md)

## Configuration

Required values and optional provider configuration are documented in [`.env.example`](.env.example). The fictional account/store seed never runs during normal startup or database reset. Run `./scripts/self-host.sh seed` explicitly only in a Docker evaluation environment.

## Verification

```bash
pnpm check
pnpm test:edge
pnpm supabase:start
pnpm supabase:reset
pnpm test:db
pnpm test:e2e
```

Automated tests do not call real AI, Google, Meta, or DataForSEO APIs. Use dedicated stores and keys for pre-release manual verification.

## Community and Hosted editions

Community is designed for self-hosting. It does not include billing, credits, trial allowances, the Kuchitoru-operated AI gateway, or Kuchitoru-operated usage and cost records. You are responsible for installation, updates, backups, and monitoring.

The Hosted edition is available at [Kuchitoru ZERO](https://app.kuchitoru.com/). It provides managed infrastructure, billing, and proprietary features that are not included in this repository. The two editions do not use the same codebase or have identical feature sets.

## License and trademarks

The source code is licensed under the [GNU AGPL version 3 or later](LICENSE). Copyright © 2026 Ranchu Japan LLC.

Names and logos are not licensed under the software license. See [`TRADEMARKS.md`](TRADEMARKS.md) before redistribution. Modified versions must not imply that they are official.

Contributions use DCO 1.1 with Signed-off-by lines. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Support and security reports

Self-hosted installation, updates, and monitoring receive community support. See [`SUPPORT.md`](SUPPORT.md) for scope and [`SECURITY.md`](SECURITY.md) for vulnerability reporting.
