# blackolive-55617: Mafia Spotlight Submission form

Stage: doing · Priority: P2 · Branch: `task/blackolive-55617`

## Open questions for Snax

1. **Who can submit, and for whom?** Assumed: logged-in members only (Discord session), and they can nominate **themselves or another member**. Should non-members (no login) be able to submit too, like `/api/suggestions`?
2. **Fields.** Assumed: nominee (self, or name + Discord handle), city, "what they did / why spotlight them", up to 3 links, one optional photo, and a consent checkbox. Is there an existing Google Form or call template whose fields we should copy exactly?
3. **Who reviews and where is the ping?** Assumed: app admins (`requireAdmin`) triage at `/admin/spotlight`, and new submissions post to a Discord channel named **"Mafia Spotlight"** in the webhooks sheet. Is there a different host role or channel?
4. **Scope of v1.** Assumed: no public "featured" gallery and no PEP reward for being featured (both v2). OK?

## Goal

"Pizza Mafia Spotlight" is a regular segment on the PizzaDAO community call (Pizza Hacking Radio) where a member and their work get featured. Right now there is no in-app way to put someone forward. This task adds:

- a member-facing form at `/spotlight` for nominating yourself or another member, plus a list of your own past submissions and their status;
- an admin queue at `/admin/spotlight` to shortlist submissions, mark them featured (with the call date), or decline them;
- a best-effort Discord ping when a new submission arrives.

## Assumptions

- Nothing in the codebase mentions "spotlight" except CSS gradient comments, so this is a new feature. "Mafia" is the community's name for its members (mafia names, Pizza Mafia rank).
- The closest existing feature is **support tickets** (buffalo-96244). It has a login-gated form, a "my items" list, an admin triage page, a status enum, a Discord webhook ping, and route tests. We copy its structure closely. Photo upload copies the suggestions/shop upload path (`app/lib/blob-image-upload.ts` + `isOwnBlobUrl`).
- The member-facing UI uses next-intl (en/es/fr), like `/calls`. Admin UI stays English-only, like `/admin/support`.
- Nominees are stored as free text, plus an optional resolved `nomineeMemberId` / `nomineeDiscordId`. We don't build a member picker in v1 (no reusable one exists).

## Data model and migration

Add to `prisma/schema.prisma` (near `SupportTicket`):

```prisma
enum SpotlightStatus {
  NEW
  SHORTLISTED
  FEATURED
  DECLINED
}

model SpotlightSubmission {
  id                 Int             @id @default(autoincrement())
  submitterDiscordId String          // session key of the person submitting
  submitterMemberId  String?         // sheet member id, best-effort
  submitterName      String?         // nick/username snapshot
  isSelf             Boolean         @default(false)
  nomineeName        String          // display name (= submitter name when isSelf)
  nomineeDiscord     String?         // free-text handle as typed (when not self)
  nomineeDiscordId   String?         // = submitterDiscordId when isSelf
  nomineeMemberId    String?
  city               String?
  pitch              String          // "what they did / why spotlight them"
  links              String[]        @default([])
  photoUrl           String?         // must be our Blob, /spotlight/ prefix
  consent            Boolean         // nominee agreed (or submitter confirms they will ask)
  status             SpotlightStatus @default(NEW)
  featuredOn         DateTime?       // call date it was featured
  adminNotes         String?
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  @@index([submitterDiscordId, createdAt])
  @@index([status, createdAt])
}
```

New migration `prisma/migrations/20261017000000_mafia_spotlight/migration.sql`: `CREATE TYPE "SpotlightStatus"`, `CREATE TABLE "SpotlightSubmission"`, and the two indexes. Write it by hand in the same style as `20261002000001_add_support_tickets` and check it against `npx prisma migrate diff`. The change is purely additive, with no backfill.

## Files to add

| File | Purpose |
|---|---|
| `app/lib/spotlight-shared.ts` | Client-safe constants: `PITCH_MAX_LEN=2000`, `NAME_MAX_LEN=100`, `CITY_MAX_LEN=100`, `MAX_LINKS=3`, `LINK_MAX_LEN=500`, `ADMIN_NOTES_MAX_LEN=5000`, `SPOTLIGHT_STATUSES`, `SpotlightStatus` type. |
| `app/lib/spotlight.ts` | Server helpers modeled on `app/lib/support-tickets.ts`: `parseSubmissionInput` (trim and cap fields, require `pitch` + `consent`, require `nomineeName` unless `isSelf`, links must be `http(s)` URLs, `photoUrl` must pass `isOwnBlobUrl(url, '/spotlight/')`), `parseAdminUpdate` (status / adminNotes / featuredOn ISO date), `toMemberSubmission` (omits adminNotes and the internal ids), `toAdminSubmission`, `isSpotlightStatus`, limits `MAX_SUBMISSIONS_PER_DAY=3` and `MAX_PENDING=5`, `spotlightWebhookChannel()` (env `SPOTLIGHT_DISCORD_CHANNEL`, default `"Mafia Spotlight"`), and `notifyNewSubmission()`. The notifier never throws and posts the nominee name, submitter mention, the first ~300 chars of the pitch, and a link to `/admin/spotlight`. Use `allowed_mentions: { parse: [] }` the same way `notifyNewTicket` does (check that and mirror it). |
| `app/api/spotlight/submissions/route.ts` | `GET` returns the caller's submissions (`requireSession`, no-store). `POST` validates, applies the per-day / pending limits (429), resolves `submitterMemberId` with `fetchMemberIdByDiscordId` (best-effort), and fills the nominee fields from the session when `isSelf`. It creates the row, awaits `notifyNewSubmission`, and returns 201. |
| `app/api/spotlight/upload/route.ts` | `requireSession` plus `enforceRateLimit(req, 'spotlight-upload')`, then `uploadImageToBlob(fileFromForm(fd), 'spotlight/<discordId>')`. Wrap it in `withErrorHandling`. |
| `app/api/admin/spotlight/submissions/route.ts` | `GET ?status=`, `requireAdmin`, take 200, newest first. |
| `app/api/admin/spotlight/submissions/[id]/route.ts` | `PATCH {status?, adminNotes?, featuredOn?}`, `requireAdmin`. Setting `FEATURED` with no `featuredOn` defaults it to today. 404 if the id is missing. |
| `app/spotlight/page.tsx` | Server page. Metadata comes from `getTranslations("spotlight")`. Logged out: login card (copy the `/support` card, link to `/login` with a return to `/spotlight`; check `app/lib/login-return.ts` for the return param). Logged in: `<SpotlightClient />`. |
| `app/spotlight/SpotlightClient.tsx` | Form, then a success state, then a "Your submissions" list with status pills. Toggle "Spotlight myself / Nominate someone else". The nominee fields show only for "someone else". Fields: pitch textarea with character counter, city, up to 3 link inputs, optional photo, and a consent checkbox whose label changes with self vs other. Photo upload goes to `/api/spotlight/upload` first, then the URL goes into the POST body. Field-level errors use the `field` key from 400 responses. Style it after `SupportClient.tsx` (paper-soft card, `overline`, `btn-pill`). |
| `app/admin/spotlight/page.tsx` | Server admin gate, copied from `app/admin/support/page.tsx`. |
| `app/admin/spotlight/AdminSpotlightClient.tsx` | Status filter tabs, plus a card per submission: nominee, submitter, city, pitch, links, photo thumbnail, and a "Copy for call notes" button that puts plain text on the clipboard. Also a status select, a featuredOn date input, and an admin-notes textarea. Saving calls PATCH. Modeled on `AdminSupportClient.tsx`. |
| Tests (see below) | `app/lib/spotlight.test.ts`, `app/api/spotlight/submissions/route.test.ts`, `app/spotlight/__tests__/SpotlightClient.test.tsx` |

## Files to change

- `prisma/schema.prisma`: enum and model above.
- `app/lib/rate-limit.ts`: add `"spotlight-upload": { limit: 10, windowSec: 10 * 60 }` to `RATE_LIMITS`.
- `app/ui/SiteHeader.tsx`: add `{ href: "/spotlight", label: "spotlight", membersOnly: true }` to the **community** group, and `{ href: "/admin/spotlight", label: "spotlightAdmin", adminOnly: true }` to resources, next to `shopAdmin`.
- `messages/en.json`, `messages/es.json`, `messages/fr.json`: add `nav.spotlight` ("Mafia Spotlight"), `nav.spotlightAdmin` ("Spotlight queue"), and a new top-level `spotlight` namespace. Keys include overline, title, intro (one line on what the call segment is), loginPrompt, loginCta, modeSelf, modeOther, nomineeName, nomineeDiscord, city, pitch, pitchHint, pitchCount (ICU `{count}/{max}`), links, addLink, photo, photoHint, consentSelf, consentOther, submit, submitting, success, submitAnother, mine, empty, and `status.{NEW,SHORTLISTED,FEATURED,DECLINED}`, plus the error strings (`tooMany`, `generic`, `uploadFailed`). Server validation messages stay English, as in support tickets; the client maps known `field` values to translated hints. Spanish and French must be real translations, because the parity test (`app/lib/i18n/__tests__/catalog-parity.test.ts`) enforces matching keys.
- Optional, only if Snax wants discoverability beyond the nav: a one-line link card on the dashboard Discover section (`app/dashboard/[id]/components/`). Not in v1 by default.

## Approach and alternatives considered

- **Chosen:** a dedicated table plus an admin queue that mirrors support tickets. This reuses proven patterns (guards, webhook, Blob upload, tests), gives hosts status tracking across calls, and lets members see the outcome.
- **Alt A:** reuse the `Suggestion` table with a `type` column. Rejected because suggestions are anonymous with no status or admin flow, and mixing the two would muddy both.
- **Alt B:** post straight to Discord with no DB, or link out to a Google Form. Rejected because hosts lose the queue and status, members can't track submissions, and it doesn't fit the "app is the hub" direction. It is the fallback if Snax wants zero schema change.
- **Alt C:** a member picker that resolves the nominee to a member id. Deferred because no reusable picker exists. We do store `nomineeMemberId` when `isSelf`, and admins can see the free text.

## Risks

- **Migration rollout:** this repo's migration history can't build a DB from zero (see `plans/member-activation.md`). Check `prisma migrate status` against prod/Neon first, then apply with `prisma migrate deploy`, or use `migrate resolve` if it was applied manually. The migration must land **before** the merge to main, or `/spotlight` POSTs will 500.
- **Webhook row missing:** if the "Mafia Spotlight" row is missing from the webhooks sheet, `getWebhookUrl` returns null and the notification is skipped silently. The submission is still saved. Add the row before launch.
- **Privacy:** the nominee may not want to be featured. Mitigations: the consent checkbox is required, the pitch goes to Discord only truncated, and admin notes never reach members.
- **Abuse/spam:** login is required, there are per-account daily and pending caps, a Blob prefix check on `photoUrl`, and length caps on every field.
- **Nav crowding:** the community group grows to 5 items. Check the mobile menu with `/mobile-check`.

## Tests

- `app/lib/spotlight.test.ts`: `parseSubmissionInput` covers the required pitch, required consent, nominee required only when not self, link scheme/count/length validation, foreign `photoUrl` rejected and own Blob URL accepted (mock `BLOB_READ_WRITE_TOKEN` like `blob-url.test.ts`), and trimming/caps. `parseAdminUpdate` covers bad status, notes too long, and a bad date. `toMemberSubmission` must omit `adminNotes`.
- `app/api/spotlight/submissions/route.test.ts`, modeled on `app/api/support/tickets/route.test.ts` (mock session, prisma, webhook): 401 when logged out; 400 with a `field`; 429 on the daily cap and on the pending cap; a 201 self-nomination fills `nomineeDiscordId` / `nomineeName` from the session; notifier called; GET returns only the caller's rows. Admin routes: 403 for non-admin, a status filter and an invalid status, PATCH `FEATURED` defaults `featuredOn`, PATCH 404.
- `app/spotlight/__tests__/SpotlightClient.test.tsx` with `renderWithIntl` from `app/lib/i18n/test-utils.tsx`: the toggle hides the nominee fields; submit stays disabled until pitch and consent are filled; a 201 shows the success state; es locale renders translated labels.
- Existing: the catalog parity test must pass. Run `npm run test:run`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Rollout / verification

1. The implementer works in a worktree on `task/blackolive-55617`, then runs the checks above.
2. DB: run `prisma migrate status` against a Neon branch of prod, apply `20261017000000_mafia_spotlight`, and verify `prisma migrate diff` is empty. Then do the same on prod before merge (needs Snax's OK).
3. Ops: add a `Mafia Spotlight` row to the Discord webhooks sheet, pointing at the hosts' channel. Optionally set `SPOTLIGHT_DISCORD_CHANNEL` in Vercel.
4. `/ship` to get a PR and a Vercel preview. On the preview, check:
   - logged-out `/spotlight` shows the login card;
   - self-nomination and an other-member nomination both work, including the photo;
   - the 4th submission in a day gets a friendly 429;
   - the es/fr locales render;
   - `/admin/spotlight` is denied for non-admins; for admins, filter, set FEATURED with a date, add notes, and confirm the member list shows the new status;
   - the Discord ping arrives (only if the preview's DB and webhook are wired; otherwise confirm it is skipped silently);
   - the nav item appears for members only, and `/mobile-check` passes on `/spotlight`.
5. Snax reviews the preview, then we merge and `/task done blackolive-55617 <pr#>`.

## Decisions (Snax, 2026-10-18)

All open questions resolved with the plan's defaults:
1. Logged-in members only; they can nominate themselves or another member.
2. Fields as assumed: nominee, city, pitch, up to 3 links, optional photo, consent.
3. App admins review at /admin/spotlight. Pings go to a "Mafia Spotlight" webhook channel.
4. A public gallery and a PEP reward are deferred to a later version.
