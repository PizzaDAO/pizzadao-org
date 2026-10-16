# Member activation

## Member experience

- A DM request stores an allowlisted signup draft on its one-time login token. The callback sets an HttpOnly draft cookie only after token verification. Recovery requires the same authenticated Discord identity, a consumed token, and a consumption time within 30 minutes. A fresh browser restores the draft and asks the member to review name/city before writing a profile. Existing members go to their dashboard instead of applying a supplied signup draft. Successful creation clears drafts for that account; old login tokens are removed by the existing lazy cleanup.
- Joining a crew completes required community setup. Wallet and X connections remain available as optional profile actions and do not delay missions.
- Crew summaries show the current published goal, the next weekly meeting in the visitor's timezone, a calendar download, a listed lead or Discord fallback, and up to three current unclaimed tasks. Tasks explicitly mentioning beginner/starter work rank first. Unknown schedules are shown as written, without inventing a date. Calculated weekly dates are labelled as schedule-based, not confirmed events.

## Measurement

`/admin/activation` is restricted to Discord administrators. It reports the last 30 days of signup journeys through signup started, DM delivered, Discord verified, profile created, and first task claim or mission submission. Stages are deduplicated per journey. The report counts later stages only for the observed started cohort. Failed login requests, failed profile sheet writes, and specific browser network/recovery errors are shown as affected journeys. Client-start events are best-effort product analytics, not security audit data.

Names, cities, tokens, raw Discord IDs and raw error messages are excluded. Discord IDs are HMAC-hashed with the existing session secret to attribute a later contribution back to a signup journey. Event cleanup runs when administrators read the report, removing events older than 90 days. The report flags truncation if over 20,000 recent events are loaded. It does not contact third-party analytics services.

## Verification

- Unit coverage: allowlisted drafts, authenticated/expiring recovery, one-time token claims, existing-profile protection, DST-aware meeting dates, open-task selection, optional-account priorities, and event privacy/deduplication.
- `npm run e2e:activation` runs a production build's UI on an isolated local server with external SSR fetches disabled and mocked browser APIs. It covers three locales, two themes and desktop/mobile; signup continues in a fresh browser context, requires review, and recovers from failed saving. Closed DMs and expired links have recovery checks.
- `bash scripts/test-activation-migration.sh` applies the migration to a temporary PostgreSQL container and verifies preservation of old tokens, draft storage and event deduplication.
- CI validates the migration, builds the app, installs Chromium, runs the suite and uploads traces/screenshots on failure. No real Discord messages or member writes occur in CI.
- A real DM handoff requires a designated test account to open the link on a second device.

## Release prerequisite

Apply `prisma/migrations/20261010000000_member_activation/migration.sql` to the deployment database before releasing this code. It adds nullable `MagicLoginToken.signupDraft` and the new `ActivationEvent` table/indexes. Check the existing migration state before using `prisma migrate deploy`; the repository's older migration history cannot build a fresh database from zero. A fresh test database should use `prisma db push` instead.

No new secrets are required. This workspace currently has no database connection or Vercel token; production migration must be performed through the existing authorized database/deployment environment before merging. Rolling back application code is compatible with the added nullable column and table.
