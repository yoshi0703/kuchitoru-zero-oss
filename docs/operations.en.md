# Operations

Self-hosted operators are responsible for updates, backups, monitoring, and third-party API contracts. The following is the minimum operating baseline.

## Backups

- PostgreSQL: run a daily `pg_dump --format=custom` and store it in encrypted storage separate from the database host.
- Configuration: record required secret names, DNS, callback URLs, the release tag, and the Supabase bundle tag, but not secret values.
- Choose retention and recovery points according to store requirements.
- Test restoration into a separate database at least once per release.

Version 1.0.0 does not use Supabase Storage for application data. If a later deployment enables it, add a separate object backup. Never commit backups, database URLs, or secret keys.

## Updates

1. Read release notes and migrations.
2. Back up the database and configuration.
3. Deploy the new tag to staging.
4. Verify account creation, multiple stores, QR intake, BYOK save and generation, local search screens, permission isolation, and key deletion.
5. Confirm that external writes are disabled by default, run only after owner/admin enablement plus per-action `confirmed: true` from an owner, admin, or editor, and reject analysts.
6. Update production and read back the Community version, Git SHA, and database schema version from authenticated `owner-api/version`.

The Docker installation does not automatically update the Supabase bundle. Use only the bundle tag specified by the Community release and review the official [update guide](https://supabase.com/docs/guides/self-hosting/updating).

## Monitoring

- availability of Web `/_deployment.json` and its `buildSha`, `releaseChannel`, and Supabase URL
- availability of the Web home page
- Supabase gateway, Auth, Functions, and PostgreSQL health
- 5xx rate and function timeouts
- migration failures, job failures, and confirmed external action results
- disk usage, database connections, and last successful backup

Do not log request bodies, Authorization headers, or API keys. Set retention periods for store and correlation IDs. Community does not record Kuchitoru-operated monthly AI usage or provider cost. Monitor provider billing and limits in the operator's own provider accounts.

`supabase/seed.sql` is for evaluation with fictional data. Never run it in production, staging, or recovery environments, and never add it to normal startup, updates, migrations, or database resets.

## Incident response

1. If external writes are affected, disable external writes for the affected store.
2. Record the version, time, affected stores, correlation IDs, and external provider status.
3. Roll the web app and Functions back to the previous release.
4. Do not destructively roll back the database; add a forward corrective migration.
5. If cross-store access or secret exposure is suspected, determine scope and rotate affected credentials.
6. Re-test the same path after recovery and record the cause and prevention.

## Secret changes

Losing `AI_CREDENTIALS_MASTER_KEY_V1` makes credentials encrypted with that key version unreadable. Rotate it in this order:

1. Add a new 32-byte standard Base64 `AI_CREDENTIALS_MASTER_KEY_V2`.
2. Keep V1 and set `AI_CREDENTIALS_ACTIVE_KEY_VERSION=2`.
3. Verify new saves and reads of existing credentials in staging.
4. Prepare and test a separate procedure to re-encrypt existing credentials with V2.
5. Remove V1 only after confirming that no row remains encrypted with it.

Never rotate by overwriting a key value. Changing `SESSION_TOKEN_DERIVATION_KEY` invalidates existing public session tokens. Rotate the Turnstile site and secret keys as a pair from the same widget.
