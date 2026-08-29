# Kuchitoru Zero Community

[日本語](README.md)

Kuchitoru Zero Community is a self-hosted web application for collecting customer feedback through store-specific QR interviews and drafting review text with API keys supplied by the operator. It also includes connection points for Google Business Profile, Instagram, and DataForSEO, plus a workspace for day-to-day local search operations.

Community is a separate product from the Hosted edition. It does not include billing, credits, trial allowances, an AI gateway, or usage/cost records operated by Kuchitoru. Operators are responsible for third-party API contracts and fees, operations, backups, and monitoring.

## Features

- Multiple stores with store-scoped permissions
- QR interviews, survey settings, response history, and CSV/JSON exports
- Review drafting with OpenAI, Gemini, DeepSeek, xAI, or Anthropic using BYOK
- Store-scoped Google Business Profile, Instagram, and DataForSEO connections
- Post drafts, review reply drafts, rank tracking, work history, and approval logs
- Progressive Web App support

Without an AI key or provider model configuration, store management, QR intake, response management, and manual editing remain available. For each provider used, configure its interview, review, and rewrite model IDs together. External publishing and updates are disabled by default. They run only after an owner/admin enables the store setting and an owner, admin, or editor sends `confirmed: true` for that action. Analysts remain read-only. Version 1.0.0 includes no automatic posting.

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

The published image is `ghcr.io/yoshi0703/kuchitoru-zero-oss`. Each release includes the image digest, an SBOM, and checksums. Images are signed through GitHub Actions OIDC.

## Configuration

Required values and optional provider configuration are documented in [`.env.example`](.env.example). The fictional account/store seed never runs during normal startup or database reset. Run `./scripts/self-host.sh seed` explicitly only in a Docker evaluation environment.

Store AI keys and DataForSEO credentials are encrypted per store. Read APIs never return a secret; they return only `provider`, `model`, `status`, and `keyLast4`. Google Business Profile and Instagram OAuth credentials are configured as server-side secrets in the self-hosted environment.

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

## License and trademarks

The source code is licensed under the [GNU AGPL version 3 or later](LICENSE). Copyright © 2026 Ranchu Japan LLC.

Names and logos are not licensed under the software license. See [`TRADEMARKS.md`](TRADEMARKS.md) before redistribution. Modified versions must not imply that they are official.

Contributions use DCO 1.1 with Signed-off-by lines. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Support and security reports

Self-hosted installation, updates, and monitoring receive community support. See [`SUPPORT.md`](SUPPORT.md) for scope and [`SECURITY.md`](SECURITY.md) for vulnerability reporting.

The Hosted edition is available at [Kuchitoru Zero](https://app.kuchitoru.com/). Its billing, managed operations, and all proprietary features are not necessarily included in this repository.
