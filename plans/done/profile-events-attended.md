# profile-events-attended: "Events attended" on member profiles

Task: `profile-events-attended` (TASKS.md, P2). Owner request: "member profiles should also show what
events they've attended". Planned against `origin/main` @ 3c69abe4 and rsv-pizza @ 5631d650.
Revised 2026-11-17 to follow the owner's decisions:

- v1 = **rsv.pizza check-ins** + **Unlock party tickets** + **Bitcoin Pizza Day host missions**
  (Organizer badge).
- **POAPs are out.** They already show in Collections.
- Matching to rsv.pizza is by **verified email** next to **linked wallets**.

## Goal

A lazy-loaded **Events attended** section on `/profile/[id]`. Each row shows event name, date, city
and a link, with an Attended / Ticket / Organizer badge. It has a clear empty state and an in-section
prompt to verify an email. It follows the member's visibility choice, sits behind a DB setting that is
off by default, and makes no external calls on profile view.

This needs one new rsv.pizza service endpoint that returns no PII. That is a small companion PR in the
rsv-pizza repo, shipped first.

## Data sources (prod aggregates, 2026-11-17)

About 450 members. About 110 have a wallet (`MemberWallet`). 1 has an email stored in
`MemberProfileExtras`, and **0 are verified**.

| Source | Coverage today | Proves | v1 |
|---|---|---|---|
| **rsv.pizza check-ins** (`Guest.checkedInAt` in the rsv.pizza DB) | Unknown on our side (no access to that DB). Reachable only through matched members, see below | Real attendance | **Yes**, `Attended` |
| **Unlock party tickets** (`UnlockKey` + `UnlockLock`, `getTicketSummary`) | 49 members, 98 live keys, 73 locks, 3 years; 44 keys link to an event page | Ticket (an RSVP) | **Yes**, `Ticket` badge |
| **Bitcoin Pizza Day host mission** (`MissionCompletion` on `gpp_host`, verified by rsv.pizza) | 3 approved | Organized / onboarded a city | **Yes**, `Organizer` badge |
| POAPs | 49 members | n/a | No (already in Collections) |
| Call Slices, `PoapMintLink`, Discord scheduled events, Passport | n/a | n/a | No (calls are already in "Showing up"; Discord stores no attendance; Passport has its own block) |

### How rsv.pizza identifies guests (from the rsv-pizza codebase)

- **Sign-in is email only:** a magic link or a 6-digit code (`backend/src/routes/auth.routes.ts`).
  There is no Discord or other OAuth. The code says outright that "Discord ids are not stored anywhere
  in this app" (`gppHostLookup.ts`).
- **Guest row:** `name`, `email`, `ethereumAddress`, `privyUserId`, `approved`, `status`,
  `checkedInAt` and `partyId`. It has no user id; a guest joins to an rsv.pizza `User` only through
  the same email (`User.email` is unique). `Party` holds `name`, `date`, `timezone`, `city`,
  `customUrl` / slug, `eventType`, `hideGuests` and cancellation state.
- **The wallet on a guest row is often a Privy embedded wallet** that rsv.pizza created from the email
  (`services/privy.service.ts`). Members have not linked those wallets here, so wallet matching only
  works when the guest typed in their own wallet. Low yield.
- **Telegram** lives only on hosts (`User.telegram`, co-hosts, `party_telegram_hosts`), never on
  guests.
- **Precedent:** `POST /api/service/telegram/host-match` already takes `emailHashes` (sha256 of the
  lower-cased, trimmed email), and our `app/lib/telegram/host-match.ts` exports the matching
  `emailHash()`.
- **Our Discord OAuth** asks only for `identify` (`app/api/discord/login/route.ts`), so we never
  receive the member's Discord email.

**Conclusion:** email is the only identifier that covers most guests. Wallet is a secondary match.
Today's verified-email coverage is about 0, so v1 needs a prompt that drives members to verify.

## Matching approach

1. **Verified email (primary).** Use only `MemberProfileExtras.email` where `emailVerifiedAt` is set.
   The flow already exists: `POST /api/email-prefs` sends the signed link and `/api/email/confirm`
   sets `emailVerifiedAt`, refusing an address another member has already verified.
   - Unverified emails never match, so nobody can claim someone else's attendance by typing their
     address.
   - **Send a sha256 hash, not the raw email** (recommended). It reuses the existing `emailHash()`
     and the `host-match` contract, and keeps raw emails out of request logs on both sides. The hash
     is not a real privacy barrier (emails are guessable), but service-key auth is what actually
     protects the endpoint.
2. **Linked EVM wallets (secondary).** Use the member's `MemberWallet` addresses (at most 10) and
   match them against `Guest.ethereumAddress`, case-insensitively.
3. **Fallback considered, not in v1: "Link rsv.pizza account".** rsv.pizza already mints short-lived
   ES256 JWTs and publishes JWKS (`lib/pizzaMcpToken.ts`, `/.well-known/jwks.json`). A link
   handshake (we send a nonce; the member signs in to rsv.pizza by email; rsv.pizza returns a JWT with
   `sub=rsvpizza:<User.id>`; we store that id) would match by rsv.pizza's own email login without
   storing an email here. It is still email underneath, and it costs a cross-site flow. Defer it
   unless the verify-email prompt converts poorly (Owner decision 4).

**Expected coverage:** at launch about 0 by email and a handful by wallet. It grows one-for-one with
verified emails among members who have gone to an rsv.pizza party. Tickets and organizer rows cover
about 50 members regardless. Measure it with the dry-run counts in step 3 before turning the setting
on.

## Approach

### 1. rsv-pizza companion PR: `POST /api/service/guest-attendance`
- In `backend/src/routes/service.routes.ts`, behind the existing `requireServiceKey` and
  `serviceLimiter`, plus an env switch `PIZZADAO_GUEST_LOOKUP_ENABLED` like `host-match` has.
- Request: `{ emailHashes?: string[≤10], wallets?: string[≤10] }`. Validate with the same regexes as
  `parseIdentifiers`.
- Logic (`backend/src/lib/guestAttendance.ts`): find guests whose sha256(lower(trim(email))) is in
  the hashes, or whose `ethereumAddress` matches a wallet.
  - Hashing at query time: `encode(digest(lower(trim(email)),'sha256'),'hex')` with pgcrypto, or an
    indexed generated `email_sha256` column if row counts make that slow. Implementer checks with
    EXPLAIN.
  - Keep only rows with `checkedInAt` set, a non-cancelled party, and an event type of gpp or
    standard (not private).
- Response, **with no PII**: `{ ok, events: [{ eventId, name, date, city, url, checkedIn: true,
  matchedBy: ['email'|'wallet'] }] }`.
  - Never return other guests, counts, names, emails or wallets.
  - Parties with `hideGuests` are still returned to the matched guest themself (it is their own
    attendance), but never anything about other guests.
  - `url` is the public `rsv.pizza/<slug or customUrl>`, or null for invite-only parties.
- Optional `{ dryRun: true, emailHashes }` returning only `{ matchedMembers: n }`, for the aggregate
  check before go-live.
- Tests sit next to it (`service.routes.test.ts` pattern): auth required, the PII-free shape,
  unchecked-in RSVPs excluded, cancelled parties excluded, limits enforced.

### 2. Settings
- In `app/lib/settings/registry.ts` (with defaults in `registry.test.ts`):
  - `profile.eventsAttended.enabled` (0/1, default 0), with an env kill switch
    `EVENTS_ATTENDED_ENABLED=off` the same way `app/lib/passport/config.ts` does it.
  - `profile.eventsAttended.countTickets` (0/1, default 1).
  - `profile.eventsAttended.rsvRecheckDays` (default 7).

### 3. Store rsv.pizza matches (never call on view)
- Migration:
  - New `MemberRsvEvent` (`memberId`, `rsvEventId`, `name` VarChar(200), `date`?, `city`?, `url`?,
    `matchedBy` VarChar(16), `fetchedAt`), with `@@unique([memberId, rsvEventId])` and
    `@@index([memberId])`.
  - New `MemberRsvCheck` (`memberId` PK, `checkedAt`, `emailHash`? — the hash used, so a change can be
    detected).
  - Add `eventsVisibility` (VarChar(8), default `public`) to `MemberProfileExtras`.
- `app/lib/events-attended/rsv.ts` (client modelled on `app/lib/payments/rsv-track.ts`: 4 s timeout,
  zod-validated body, null on any failure, key never logged):
  - `refreshRsvEvents(memberId)` gathers the verified-email hash plus the EVM wallets, calls the
    endpoint, and replaces that member's `MemberRsvEvent` rows in one transaction. A failed call
    leaves the old rows alone.
- **Triggers (re-check when the data can go stale):**
  - **On verify:** `app/api/email/confirm/route.ts`, after setting `emailVerifiedAt`, runs
    `after(() => refreshRsvEvents(memberId))`.
  - **On email change or removal:** `app/api/email-prefs/route.ts` already clears verification when
    the address changes. In the same update, delete that member's `matchedBy='email'` rows and
    `MemberRsvCheck`. Rows found through the old email must not linger.
  - **On wallet link/unlink:** the wallet routes call the same refresh with `after()`.
  - **Nightly:** a new cron `app/api/cron/rsv-events` (registered in `vercel.json` and the
    `cron-routes.test.ts` list) re-checks members with a verified email or a wallet whose last check
    is older than `rsvRecheckDays`. It runs in batches under a time budget, and the 60/min service
    limit means batches of 10 with a gap.
- **Admin dry run:** a "Check coverage" button on the settings area calls `dryRun` and shows only the
  matched count.

### 4. Read API: `GET /api/events-attended/[memberId]`
- `app/lib/events-attended/index.ts`, **DB reads only**, run in parallel:
  `MemberRsvEvent` (Attended), Unlock keys and locks (Ticket, when `countTickets`), and approved
  `gpp_host` completions (Organizer; slug and city come from the stored `checkResult` / `evidence`).
- Pure `merge.ts`:
  - Organizer and Attended for the same rsv.pizza slug collapse into one row with the Organizer badge.
  - A Ticket in the same year with a matching normalized city or name collapses into the Attended row.
  - Sort newest first, unknown dates last; cap at 50 rows plus a `total`.
- The route follows `app/api/passport/[memberId]/route.ts`:
  - It always answers 200, and answers `{enabled:false}` when the feature is off.
  - It resolves the viewer as owner, member or anonymous, and applies `canView`.
  - A missing, merged or disavowed member gets an empty list, with no reason given.
  - The owner also gets `{ emailState: 'none'|'unverified'|'verified' }` to drive the prompt. Other
    viewers never get it.
- Cache: when public and not the owner, `public, s-maxage=300, stale-while-revalidate=3600`;
  otherwise `private, no-store`.

### 5. Privacy
- Move `parseVisibility` / `canView` from `app/lib/passport/visibility.ts` to
  `app/lib/profile/visibility.ts`, and re-export them so passport keeps working.
- `eventsVisibility` defaults to `public`, with `members` / `private` chosen on the profile edit page
  through `PATCH /api/events-attended/visibility` (modelled on `app/api/passport/visibility`).
- Only checked-in rsv.pizza events are shown, never plain RSVPs. No other guests' data ever reaches
  the app.

### 6. UI: `app/ui/profile/EventsAttendedLazy.tsx`
- Same lazy pattern as `CollectionsLazy` (IntersectionObserver, 200px margin). It renders nothing
  when `enabled:false`.
- Card overline: `§ 06 · Out in the world`; Collections becomes `§ 07`. Mount it in
  `app/profile/[id]/ProfileClient.tsx` between the attendance section and `<CollectionsLazy/>`.
- Rows show the name, the month and year (year only for tickets), the city, a badge and an external
  link. Show the first 6, then "Show all (N)" expands in place. A fixed-height skeleton prevents
  layout shift.
- **Owner prompt, shown even when the list is not empty:**
  - `emailState` none: "Add your email to see the parties you've been to", linking to
    `/profile/[id]/edit#email`, which opens `EmailPrefsEditor`.
  - `emailState` unverified: "Check your inbox to confirm your email", with a resend action through
    the existing `resend` flag.
  - Copy says the email is only used to find their rsv.pizza check-ins.
- **Empty state:** visitors see nothing (the section is hidden); the owner sees the prompt above.
- **Nudge elsewhere (optional, Owner decision 5):** one line in `EmailPrefsEditor` ("Verifying also
  shows your rsv.pizza parties on your profile").
- Strings go in the `eventsAttended` next-intl namespace in all catalogs.

## Files

- **rsv-pizza (companion PR):** `backend/src/routes/service.routes.ts`, new
  `backend/src/lib/guestAttendance.ts` and tests, and a migration only if a generated hash column is
  needed.
- **pizzadao-org:**
  - `prisma/schema.prisma` and a migration (`MemberRsvEvent`, `MemberRsvCheck`,
    `MemberProfileExtras.eventsVisibility`).
  - `app/lib/settings/registry.ts`, `registry.test.ts`.
  - New `app/lib/events-attended/{config,rsv,index,merge}.ts`.
  - New `app/api/events-attended/[memberId]/route.ts`, `app/api/events-attended/visibility/route.ts`,
    `app/api/cron/rsv-events/route.ts`, plus `vercel.json`.
  - `app/api/email/confirm/route.ts`, `app/api/email-prefs/route.ts` and the wallet link/unlink
    routes (the triggers).
  - `app/lib/passport/visibility.ts` moves to `app/lib/profile/visibility.ts`.
  - New `app/ui/profile/EventsAttendedLazy.tsx`, `app/profile/[id]/ProfileClient.tsx`, the profile
    edit page and `EmailPrefsEditor.tsx`, and the message catalogs.
  - Env: no new secret. It reuses `RSV_PIZZA_SERVICE_KEY` and `RSV_PIZZA_API_URL`.

## Alternatives considered

- **Call rsv.pizza on every profile view.** Rejected: it is slow, it is rate-limited at 60/min, and a
  profile would break whenever rsv.pizza is down.
- **Send raw emails.** Works, but the hash matches the existing `host-match` contract and keeps
  addresses out of logs.
- **Request the Discord `email` scope at login.** Rejected for v1. It changes the consent screen for
  everyone, and Discord's verified email may not be the one used on rsv.pizza.
- **rsv.pizza account link (JWT handshake).** A viable fallback (above), deferred.
- **Wallets only.** Rejected: Privy-generated guest wallets are unknown to us.

## Risks

- **Coverage starts near 0.** The feature depends on members verifying emails. Mitigation: the prompt
  and the nudge, and turn it on only after the dry-run count looks worthwhile.
- **Different email on rsv.pizza.** That member gets no match, which is a silent miss and is safe. A
  later version could allow a second "rsv.pizza email" field, again verified.
- **Stale rows after an email change:** handled by deleting the email-matched rows when the address
  changes. A test covers it.
- **Hashing in Postgres per lookup** may be slow on a large guest table. Use a generated indexed
  column if EXPLAIN shows a sequential scan.
- **The cross-repo deploy order:** ship rsv-pizza first. Our client treats any failure as "no data",
  so deploying in the wrong order is harmless.
- **Privacy of `hideGuests` parties:** only the member's own attendance is returned. Owner decision 3
  confirms whether those should show at all.

## Tests

- **rsv-pizza:** route auth; the PII-free response shape (assert the exact key set); only checked-in
  guests; cancelled and private parties excluded; wallet case-insensitivity; the 10-identifier limit;
  `dryRun` returns only a count.
- **`rsv.test.ts`:**
  - Unverified email → no hash sent; verified → hash equals `emailHash()`.
  - A failure keeps the old rows; a success replaces them atomically.
  - The key never appears in errors.
- **`email-prefs` / `email/confirm` route tests:**
  - Verify triggers a refresh.
  - Changing or removing the email deletes the `matchedBy='email'` rows and keeps the wallet rows.
- **`merge.test.ts`:** Organizer plus Attended collapse; a Ticket collapses into Attended; the
  `countTickets=0` filter; the sort order; the cap.
- **`[memberId]/route.test.ts`:**
  - Off → `{enabled:false}`; private + anonymous → empty.
  - `emailState` is owner-only.
  - Cache headers differ by visibility; a missing member → 200 and empty.
- **Cron test:** batching, staleness and budget; registered in `cron-routes.test.ts`.
- **Visibility helpers:** the passport re-export still works.
- **`EventsAttendedLazy` component tests:**
  - No fetch until it scrolls into view.
  - The owner prompt per `emailState`.
  - Hidden for visitors when empty; nothing rendered when disabled.

## Verify

1. `npm run lint && npx tsc --noEmit && npx vitest run` in both repos;
   `npx prisma migrate diff` shows only additive changes.
2. rsv-pizza preview: call the endpoint with a test guest's hash (checked in vs. only RSVP'd) and
   check the response keys.
3. pizzadao-org Vercel preview (`vercel-deploy`), with the setting at 0: the profile is unchanged.
4. With the setting at 1 on the preview:
   - Verify a test email; the section fills after confirming.
   - Change the email; the rows from the old email disappear.
   - Owner and logged-out views follow `eventsVisibility`.
   - LCP on a heavy profile is unchanged against main.
   - The section only fetches after scrolling.
5. `/mobile-check` on the profile.
6. Run the admin dry run in prod and report the aggregate match count to Snax. The setting stays off
   until he turns it on.

## Owner decisions (decided)

- **v1 sources:** rsv.pizza check-ins, Unlock tickets, Bitcoin Pizza Day host missions (Organizer
  badge).
- **POAPs:** dropped.
- **Matching:** verified email plus linked wallet. Unverified emails never match.

## Owner decisions (open, with recommendations)

1. **Email or hash on the wire?** Recommend the sha256 hash, the same as the existing `host-match`
   contract.
2. **Do tickets count?** Recommend showing them with a "Ticket" badge (`countTickets=1`), collapsed
   into the Attended row when both exist.
3. **`hideGuests` parties:** show them on the guest's own profile? Recommend yes for the owner view
   only, and hidden from other viewers. Simpler alternative: exclude them entirely.
4. **rsv.pizza account-link fallback** (for members who used a different email there): build it now
   or later? Recommend later, once the prompt's conversion is known.
5. **Nudge outside the section:** add the line in `EmailPrefsEditor`, and possibly a one-time
   dashboard card? Recommend the editor line only for v1.
6. **Empty section for visitors:** recommend hiding it; only the owner sees the prompt.
7. **Visibility default:** recommend `public`, with `members` / `private` per member.
8. **Go-live bar:** turn it on once the dry run shows some number of matched members? Recommend
   turning it on regardless (tickets and organizer rows already cover about 50 members) and watching
   the email-match count.
