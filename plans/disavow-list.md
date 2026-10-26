# Disavow list (private, DPR-voted warning list)

Status: plan for review (2026-10-26). Not started.
Origin: 2026-10-25 Community Call. Members want to warn each other about people with a bad track
record ("we see them building relationships with someone where we should give the warning").
Names floated: disavow, excommunicado, whacked list, plank walkers. Enzo preferred "disavow".
Don Scrimmy John: "enough DPR votes gets them on the list".
Snax (2026-10-26): build it. The list is PRIVATE, visible only to members above a certain level.
A separate task (branch `feat/missions-any-level-pizza-box`, another agent) makes owning a Rare
Pizza Box NFT a prerequisite for reaching level 4+.

## 1. Goal

Senior members can nominate a person (a member or not) for the disavow list. Dread Pizza Roberts
(DPR) vote on it, and a listing goes live only when enough DPR vote yes. Eligible members can see
the list and get a private warning wherever the listed person appears: profile, vouch button.
Everything is private, factual, logged, and reversible. Nothing is public, indexed, or exportable.

Non-goals (v1): public pages, Discord channel posts about listings, automatic bans or role
removal, file or screenshot uploads, CSV/API export, any on-chain record.

## 2. Recommendations (Snax to confirm, see §13)

| Question | Recommendation | Why |
|---|---|---|
| Who can view | **Level 4+** (`getCurrentLevel(discordId) >= 4`, i.e. levels 1–3 done) **or** DPR. Listed people never see the list, whatever their level. | L1–L3 are cheap to reach, so a new or sock-puppet account could scrape the list. Once the pizza-box gate ships, L4 means the person holds a Rare Pizza Box: real money and weeks of missions on the line, so leaking costs them something. L5+ would leave too few viewers for the warning to reach the people it protects. |
| Who can nominate | Same people as viewers (L4+ or DPR) | Whoever can see the list should be able to warn about someone. The DPR vote is the quality gate. |
| Who votes | **DPR role holders only** (`canReviewMission(id, DPR_ONLY_MIN_LEVEL)`, the same rule as call review in `app/lib/calls/access.ts`) | Matches "enough DPR votes", and reuses the single DPR check so the rules can't drift apart. |
| Threshold | Listed when **≥ 3 YES** and **YES > NO**. At least **72 h** after nomination, so dissent has time to show up. | 3 votes keeps one or two DPR from listing someone alone. YES > NO means a split DPR doesn't list. Put the threshold in a constant (`DISAVOW_YES_THRESHOLD`) so it's easy to change. |
| Voting window | **14 days**. If it closes without passing, the nomination is `REJECTED` (no listing). Votes can be changed until the round closes. | Long enough for part-time DPR. Short enough that a nomination doesn't hang forever. |
| Conflicts | The nominator can't vote on their own nomination. The subject can't vote or nominate about themselves. A voter can mark themselves "recused". | Stops self-dealing. Recusal is cheap to build. |
| Due process | **Members:** an in-app notification when listed (not when nominated), with no voter or nominator names. They can file a **response** that shows next to the listing, and **appeal** once per 90 days. An appeal opens a REMOVE round. **Non-members:** not notified (we have no channel to reach them), but anyone can contact DPR to dispute. | Basic fairness and data-protection posture (the person knows data about them is held). Notifying at nomination would tip off bad actors and invite harassment of the nominator. |
| Expiry | A listing lasts **12 months**, then needs a REAFFIRM round (same threshold) or it lapses to `EXPIRED`. | Stale accusations are the biggest defamation and fairness risk. |
| Removal | Never deleted. Removal is a status change through a REMOVE round (≥ 3 YES, YES > NO). Any single DPR can **suspend** a listing immediately (hide it pending a vote). Admins can **redact** text in response to a legal or erasure request. Everything goes in an append-only audit log. | Fails toward less harm. Complete trail. |
| Vouch integration | Eligible viewers see a warning confirm dialog before vouching for a listed person. **No hard block.** | Blocking or showing a warning to ineligible users would leak the listing to anyone at L1. |
| Badge | A private "Disavowed" warning chip on `/profile/[id]`, rendered only when the server confirms the viewer is eligible | Same reason. |

## 3. Data model (additive Prisma migration)

Migration `prisma/migrations/20261027000000_disavow_list/migration.sql`. It only adds new enums,
new tables, and values on `NotificationType`. Nothing existing is altered or dropped.

```prisma
enum DisavowStatus     { NOMINATED LISTED SUSPENDED REJECTED WITHDRAWN REMOVED EXPIRED }
enum DisavowRoundKind  { LIST REMOVE REAFFIRM }
enum DisavowRoundState { OPEN PASSED FAILED CANCELLED }
enum DisavowVoteChoice { YES NO ABSTAIN RECUSE }
enum DisavowReason     { SCAM THEFT_OF_FUNDS NON_DELIVERY IMPERSONATION HARASSMENT OTHER }
enum DisavowIdKind     { MEMBER_ID DISCORD_ID X_HANDLE WALLET TELEGRAM NAME }
enum DisavowEventType  { NOMINATED VOTED ROUND_OPENED ROUND_CLOSED LISTED SUSPENDED UNSUSPENDED
                         WITHDRAWN REMOVED EXPIRED RESPONSE_ADDED APPEALED REDACTED EDITED VIEWED }

model Disavowal {
  id                 String        @id @default(cuid())
  status             DisavowStatus @default(NOMINATED)
  displayName        String        // how the person is known; required
  reason             DisavowReason
  statement          String        // factual account, <= 1500 chars
  evidenceUrls       String[]      // https only, <= 5
  nominatorDiscordId String
  subjectResponse    String?       // the listed member's reply, <= 1500 chars
  respondedAt        DateTime?
  listedAt           DateTime?
  reviewDueAt        DateTime?     // listedAt + 12 months
  lastAppealAt       DateTime?
  redactedAt         DateTime?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  identifiers        DisavowIdentifier[]
  rounds             DisavowRound[]
  events             DisavowEvent[]
  @@index([status])
  @@index([nominatorDiscordId, createdAt])
}

model DisavowIdentifier {          // how we match the person anywhere in the app
  id          Int           @id @default(autoincrement())
  disavowalId String
  kind        DisavowIdKind
  value       String        // normalized (see lib/disavow/identity.ts)
  disavowal   Disavowal     @relation(fields: [disavowalId], references: [id])
  @@unique([disavowalId, kind, value])
  @@index([kind, value])
}

model DisavowRound {
  id          String            @id @default(cuid())
  disavowalId String
  kind        DisavowRoundKind
  state       DisavowRoundState @default(OPEN)
  openedBy    String            // Discord id (nominator, DPR, or the subject for an appeal)
  opensAt     DateTime          @default(now())
  closesAt    DateTime          // opensAt + 14 d
  closedAt    DateTime?
  disavowal   Disavowal         @relation(fields: [disavowalId], references: [id])
  votes       DisavowVote[]
  @@index([disavowalId, state])
  @@index([state, closesAt])
}

model DisavowVote {
  id             Int               @id @default(autoincrement())
  roundId        String
  voterDiscordId String
  choice         DisavowVoteChoice
  comment        String?           // private to DPR, <= 500 chars
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt
  round          DisavowRound      @relation(fields: [roundId], references: [id])
  @@unique([roundId, voterDiscordId])
}

model DisavowEvent {               // append-only audit log; never updated or deleted
  id             Int              @id @default(autoincrement())
  disavowalId    String
  type           DisavowEventType
  actorDiscordId String?
  data           Json?            // e.g. {from, to} status, vote choice, redacted fields
  createdAt      DateTime         @default(now())
  disavowal      Disavowal        @relation(fields: [disavowalId], references: [id])
  @@index([disavowalId, createdAt])
}
```

`NotificationType` gains `DISAVOW_VOTE_NEEDED`, `DISAVOW_ROUND_CLOSED` (for the nominator), and
`DISAVOW_LISTED_SUBJECT`. Use `ALTER TYPE ... ADD VALUE`, which is fine on Neon PG16 as long as
nothing in the same migration uses the new values.

Why separate tables for identifiers and rounds instead of columns: one person can have several
handles or wallets, and the profile badge needs an indexed `(kind, value)` lookup. Rounds let
LIST, REMOVE, REAFFIRM, and appeals share one vote engine and one tally function.

The audit log has no FK cascade, and no code path deletes Disavowal rows. Redaction overwrites
`statement`, `evidenceUrls`, `subjectResponse`, and the NAME/X/wallet identifiers with
`[redacted]`, and logs a REDACTED event that names the fields but not their contents.

## 4. Library (`app/lib/disavow/`)

- `access.ts`
  - `isDisavowDPR(discordId)` calls `canReviewMission(discordId, DPR_ONLY_MIN_LEVEL)`. Fails closed.
  - `isDisavowSubject(discordId)` checks whether any LISTED/SUSPENDED/NOMINATED identifier matches
    the viewer's Discord id or memberId (via `findMemberByDiscordId`).
  - `canViewDisavowList(discordId)` = `!isSubject && (isDPR || getCurrentLevel(discordId) >= DISAVOW_MIN_VIEW_LEVEL)`.
    `DISAVOW_MIN_VIEW_LEVEL = 4` lives in a constant. Memoize per request with React `cache()`.
  - `requireDisavowViewer()` / `requireDisavowDPR()` are guards in the style of
    `requireCallReviewer`. They return **404** (not 403) to non-eligible callers so the feature's
    existence isn't revealed. Responses use `NO_STORE_HEADERS`.
- `identity.ts`: pure normalizers.
  - Discord id: digits only.
  - X handle: strip `@` and URL, lowercase.
  - EVM wallet: `0x` + 40 hex, lowercase.
  - Solana wallet: base58, case preserved.
  - Telegram: strip `@`, lowercase.
  - Name: trimmed, NFKC, lowercase.
  - memberId: as in the Crew sheet.
  - When a nominee is picked from member search, auto-fill MEMBER_ID, DISCORD_ID, X handle, and
    primary wallet (`getWalletForMember`).
- `tally.ts`: pure `tallyRound(votes, {nominatorId, subjectIds, now, opensAt, closesAt})` returns
  `{yes, no, abstain, recused, outcome: 'pending' | 'passed' | 'failed'}`.
  - Ignores votes by the nominator or subject (defense in depth; the API also rejects them).
  - `passed` when yes ≥ 3, yes > no, and now ≥ opensAt + 72 h.
  - `failed` at closesAt otherwise.
  - REMOVE and REAFFIRM use the same rule. REMOVE passing means removed. REAFFIRM failing means
    expired.
- `store.ts`: `nominate`, `castVote`, `withdraw` (nominator, while NOMINATED), `suspend` /
  `unsuspend` (single DPR), `openRemoveRound` (DPR or subject appeal), `addResponse` (subject),
  `redact` (admin), and `settleRound(roundId)`.
  - Every mutation runs in `prisma.$transaction` and writes a `DisavowEvent`.
  - `settleRound` is idempotent and guarded by `state = OPEN` in the update's `where`, so a
    concurrent cron run and a vote can't double-settle.
  - Settlement runs lazily after each vote and on reads of an open round, plus from the cron.
- `match.ts`: `findActiveListingFor({memberId, discordId, xHandle, wallets})` queries
  identifiers where status = LISTED. Used by the badge and the vouch warning.

## 5. Routes and pages

All pages are server components that call `requireDisavowViewer` and `notFound()` on failure.
They set `export const dynamic = "force-dynamic"` and
`metadata.robots = { index: false, follow: false }`. Add `/disavow` to `disallow` in
`app/robots.ts`, as defense in depth. Don't add it to the sitemap or any public nav. Show the nav
link only when `/api/session` returns `canViewDisavow: true` (computed server-side).

Pages:
- `app/disavow/page.tsx`: list of LISTED entries (name, reason, listed date, review date). DPR also
  get tabs for Open nominations, Suspended, and Closed. A banner states the policy: private, never
  share outside the app, factual claims only.
- `app/disavow/new/page.tsx`: nomination form.
  - Member search (reuse the referral/people search) or free-entry identifiers.
  - Reason category, factual statement with guidance text ("what happened, when, amounts, links;
    no opinions about character"), and up to 5 https evidence links.
  - Required checkbox: "This is accurate to my knowledge and I have first-hand knowledge or
    evidence."
- `app/disavow/[id]/page.tsx`: detail with statement, evidence links (`rel="noopener noreferrer
  nofollow"`, `target=_blank`), the subject's response, status history (from events), and the
  voting panel for DPR (tally, choice, private comment). Nominator identity is visible to DPR only.
  Every other viewer sees "nominated by a member". Log a VIEWED event (first view per viewer per
  day) to deter leaks.
- `app/disavow/response/page.tsx`: for a listed **member**. Shows their own listing's statement
  (not the nominator or votes) and lets them add a response or appeal. This is the only surface a
  subject can reach. It's gated on `isDisavowSubject`.

API (`app/api/disavow/...`, `runtime = "nodejs"`, all `NO_STORE_HEADERS`):
- `GET /api/disavow`: list (viewer).
- `POST /api/disavow`: nominate (viewer). Rate limit `disavow-nominate`. Also a per-user DB check:
  ≤ 3 nominations per 30 days, and only one NOMINATED/LISTED entry per matching identifier
  (return 409 with a link to the existing entry, so the nominator can add evidence instead).
- `GET /api/disavow/[id]`: detail (viewer). The DPR-only fields are stripped for non-DPR.
- `POST /api/disavow/[id]/vote`: DPR. Body `{roundId, choice, comment?}`. 403 for the nominator or
  subject.
- `POST /api/disavow/[id]/withdraw`: nominator, while NOMINATED.
- `POST /api/disavow/[id]/suspend` and `/unsuspend`: DPR.
- `POST /api/disavow/[id]/rounds`: DPR opens REMOVE.
- `POST /api/disavow/[id]/redact`: `requireAdmin()`.
- `POST /api/disavow/me/response` and `/me/appeal`: subject only. Appeal limited to one per 90
  days. Response ≤ 1500 chars, editable, logged.
- `GET /api/disavow/check?memberId=`: viewer only. Returns `{listed: boolean, id?}`. Used by the
  profile badge and the vouch dialog. Returns 404 to everyone else.
- `GET /api/cron/disavow`: `cron-auth` protected, daily. It settles rounds past `closesAt`, opens
  REAFFIRM rounds for listings past `reviewDueAt`, and expires listings whose REAFFIRM failed. Add
  it to `vercel.json` crons (`"15 6 * * *"`).

`RATE_LIMITS` additions in `app/lib/rate-limit.ts`: `disavow-nominate: {limit: 5, windowSec:
3600}`, `disavow-vote: {limit: 60, windowSec: 600}`, `disavow-check: {limit: 120, windowSec: 60}`.
The real cap on nominations is the DB check above, because the Upstash limiter is per-IP and fails
open.

Notifications use the existing `createNotification`, in-app only. Bodies contain no names or
content, e.g. "A disavow nomination needs your vote", linking to `/disavow/[id]`. Never post to
Discord channels or webhooks. A generic Discord DM to DPR is a possible later addition if votes
stall (open question).

## 6. Integration points

- **Profile** (`app/profile/[id]/page.tsx` / `ProfileClient.tsx`): the server component calls
  `canViewDisavowList(session)`. Only if that's true does it call `findActiveListingFor` and pass a
  `disavowWarning: {id} | null` prop to render a red "Disavowed (private)" chip linking to the
  entry. Don't put this in `/api/profile-summary`, which other clients and caches consume.
- **Vouch** (`app/ui/vouches/AddVouchButton.tsx`, `app/api/vouches/add/route.ts`):
  - Client: if the viewer is eligible, fetch `/api/disavow/check` and show a confirm dialog
    ("This person is on the disavow list. Vouch anyway?").
  - Server: no block. Optionally log a `VOUCH_ON_DISAVOWED` notification to DPR (open question).
- **Session** (`app/api/session/route.ts`): add `canViewDisavow` and `canVoteDisavow` next to
  `canReviewMissions`. The roles are already fetched there. The level adds one
  `getCurrentLevel` call, so wrap it in try/catch and fail closed.
- **Pizza box dependency**: the viewer rule is just `level >= 4`. It relies on the pizza-box task
  to make L4 imply a box. Existing L4+ members who reached L4 before that rule are grandfathered
  unless Snax wants a live `holdsPizzaBox` check as well (open question). If he does, add it to
  `canViewDisavowList` using the helper that the pizza-box branch exports, and don't duplicate
  the NFT lookup.

## 7. i18n

Add a new `disavow` namespace to `messages/en.json`, `es.json`, and `fr.json`, covering page
titles, form labels, guidance text, reason labels, statuses, the banner, the vouch dialog, and
notification titles. `app/lib/i18n/__tests__/catalog-parity.test.ts` will enforce key parity.
Notification titles and bodies are stored in English, as the existing notifications are. Have a
native speaker sanity-check the es/fr legal-ish policy text before rollout.

## 8. Privacy and legal risk

- **Defamation:**
  - Claims are limited to a reason category plus a factual statement and evidence. The form asks
    for first-hand knowledge.
  - DPR vote before anything is visible.
  - Subjects who are members can respond, and the response shows next to the claim.
  - Listings expire after 12 months.
  - The list is private, with narrow publication. Truth and qualified-privilege defenses are
    strongest when the audience has a legitimate shared interest.
  - Recommend Snax get a quick counsel read of the policy banner text before Phase 3.
- **Data protection** (EU/UK members; Discord ids, wallets, and handles are personal data):
  - Purpose limitation (fraud prevention inside the DAO) is stated in the banner.
  - Data is minimized: no addresses, no real names unless needed, no uploads.
  - Members get notice on listing.
  - The admin redaction flow handles erasure requests. The audit log keeps that a redaction
    happened, not the content.
  - No exports, no CSV, and no bulk API. The list endpoint is paginated (50 per page) so it
    can't be dumped in one request.
- **Leak surface:**
  - 404 to ineligible users.
  - No-store caching.
  - noindex and robots disallow.
  - Nothing appears in public APIs (`profile-summary`, `people`, sitemap) or in notification
    bodies.
  - Don't log statements to Vercel logs. `console.error` only ids.
  - VIEWED events create accountability.

## 9. Abuse prevention

- Nomination caps (3 per 30 days per person, one active entry per identifier) plus the IP rate
  limit.
- Conflict rules: no voting by the nominator or subject. The tally ignores those votes even if
  they get in. A DPR-flagged recusal counts as neither yes nor no.
- The 72 h minimum before a listing can pass prevents a midnight sprint by 3 DPR.
- A single DPR can suspend, which hides the listing instantly while a REMOVE vote runs.
- Retaliation: when the nominee is a member, the nominator's identity is visible only to DPR.
- Losing eligibility (level drop or being listed) immediately removes view access, because the
  check runs on every request with no cached grant.

## 10. Files to change

New:
- `prisma/migrations/20261027000000_disavow_list/migration.sql`
- `app/lib/disavow/{access,identity,tally,store,match}.ts` plus a `*.test.ts` for each
- `app/disavow/{page,new/page,[id]/page,response/page}.tsx` and small client components under
  `app/disavow/_components/`
- `app/api/disavow/route.ts`, `[id]/route.ts`, `[id]/{vote,withdraw,suspend,unsuspend,rounds,redact}/route.ts`,
  `me/{response,appeal}/route.ts`, `check/route.ts`
- `app/api/cron/disavow/route.ts`

Edited:
- `prisma/schema.prisma`: new models and enums, plus `NotificationType` values
- `app/robots.ts`: disallow `/disavow`
- `vercel.json`: cron entry
- `app/lib/rate-limit.ts`: three limits
- `app/api/session/route.ts`: `canViewDisavow` and `canVoteDisavow`
- `app/profile/[id]/page.tsx` and `ProfileClient.tsx`: private badge
- `app/ui/vouches/AddVouchButton.tsx`: confirm dialog
- the nav component that links Missions / Calls: conditional link
- `messages/{en,es,fr}.json`

## 11. Tests (vitest)

- `tally.test.ts`:
  - threshold edges: 2 yes = pending, 3 yes + 3 no = fail at close, 3 yes + 2 no = pass
  - the 72 h floor
  - nominator and subject votes ignored
  - recusals
  - REMOVE and REAFFIRM outcomes
  - pass at the close boundary
- `identity.test.ts`: normalizing X URLs and handles, EVM checksum to lowercase, Solana case kept,
  Discord mention `<@123>` to `123`.
- `access.test.ts` (mock `canReviewMission` and `getCurrentLevel` as `calls.test.ts` does):
  - L3 denied, L4 allowed, DPR at L1 allowed
  - a listed L6 member denied
  - Discord lookup error means denied for DPR-only actions
- Route tests (pattern: `app/api/vouches/add/route.test.ts`):
  - 404 for a non-viewer on every GET and POST
  - nominate validates https URLs, length limits, and the duplicate-identifier 409
  - vote 403 for the nominator
  - redact needs admin
  - `check` never answers ineligible users
  - all responses carry `Cache-Control: private, no-store`
- `store` concurrency: two settles of the same round leave one LISTED event (mock the transaction
  as `pep-economy.concurrency.test.ts` does).
- No-leak regression: `profile-summary` and `people` responses don't contain any disavow field.
- `catalog-parity` passes with the new namespace.
- Commands: `npx vitest run app/lib/disavow app/api/disavow`, then `npm test`, `npm run lint`,
  `npx tsc --noEmit`, and `npm run build`.

## 12. Phased rollout and verification

The whole feature sits behind `DISAVOW_ENABLED` (env). When it's off, pages and APIs return 404
and the nav link is hidden.

Note: per STAGING.md, previews share the **production database**. So:
- The migration must be applied (`npx prisma migrate deploy` with `DATABASE_URL_UNPOOLED`, via the
  deployer agent) before the preview can work. It's additive only, so applying it ahead of merge
  is safe.
- Any nomination made while testing a preview is real data. Use an obviously fake test subject
  ("TEST – delete") and withdraw it afterwards. The entry stays in the audit log, which is fine.

- **Phase 1: core (one PR).**
  - Migration, lib, nominate, vote, list, and detail pages; cron settle; DPR notifications; i18n;
    tests.
  - `DISAVOW_ENABLED` on in preview only.
  - Preview checks (via `vercel-deploy`):
    1. Logged out: `/disavow` gives 404.
    2. An L1–L3 account: 404, and no nav link.
    3. An L4+ account: list visible, nomination works.
    4. A DPR account: vote, see the tally, and confirm the 72 h floor shows "pending".
    5. `curl -I` shows `private, no-store` and the robots meta noindex.
    6. `/robots.txt` lists `/disavow`.
    7. Check on mobile (`/mobile-check`).
- **Phase 2: integration.** Profile badge, vouch confirm dialog, subject notification, the
  response/appeal page, suspend, and redact. Preview checks:
  1. As an eligible viewer, a test listing's profile shows the chip.
  2. As an L1 account, the same profile shows nothing, and `/api/disavow/check` gives 404.
  3. The vouch dialog appears only for eligible viewers.
- **Phase 3: launch and review loop.**
  - Turn on `DISAVOW_ENABLED` in prod after Snax approves the policy text (and counsel, if used).
  - REAFFIRM/expiry cron live.
  - Announce on a Community Call, not in a public channel post that names anyone.

## 13. Risks

- **Too few active DPR** means nominations stall and fail at 14 days. Mitigations: the threshold
  is a constant, and notifications go out. Check the DPR head-count before launch.
- **Level computation cost:** `getCurrentLevel` runs 3 queries per gated request. Memoize per
  request. Acceptable at current traffic.
- **Identifier collisions** with NAME matching could badge the wrong person. Mitigation: badges
  match only on MEMBER_ID, DISCORD_ID, wallet, and X handle, never on name alone.
- **Pizza-box task timing:** if this ships first, "L4" doesn't yet imply a box. Acceptable,
  because L4 still means levels 1–3 done.
- **Social risk:** the list gets used for feuds. Mitigations: the DPR vote, conflict rules,
  expiry, responses, and logged views.

## 14. Open questions for Snax

1. Minimum view level: **4** as recommended, or 5? Should existing L4+ members without a pizza box
   be grandfathered, or should viewing also require a live box check?
2. DPR threshold: **3 yes and yes > no**, a 72 h floor, and a 14-day window? How many active DPR
   are there today?
3. Should listed **members** be notified and allowed to respond and appeal (recommended), or should
   the list stay fully silent?
4. Nominator identity: visible to DPR only (recommended), or to all viewers?
5. Vouching for a listed person: warn only (recommended), hard-block for eligible viewers, or ping
   DPR?
6. Expiry: 12 months with a re-affirm vote, or permanent until removed?
7. Name: "Disavow list" in the UI? (Internally `disavow` everywhere.)
8. Should a counsel review of the policy and banner text happen before the prod flag goes on?
9. Should DPR also get a Discord DM (no content, just a link) for new nominations, or are in-app
   notifications enough?

## Decisions (Snax, 2026-10-26) — these override anything above
1. **Visibility:** level **5+** and DPR only (not 4+). Listed people never see it; everyone else gets a 404.
2. **Votes:** ≥3 DPR yes and yes > no; open ≥72h, closes at 14 days; nominator and subject can't vote.
3. **Due process:** notify on listing (in-app, no names), response shown beside the listing, appeal once per 90 days → DPR removal vote.
4. **Vouching:** warn eligible viewers and ask to confirm; allow the vouch. No block.
Defaults taken for the remaining open questions (Snax can change): nominator name visible to DPR only; 12-month expiry with re-affirm vote; UI name "Disavow list"; in-app notifications only (no Discord DMs); production flag stays off until Snax approves (legal review of the policy text recommended first). Nominating is also limited to level 5+ (same as viewing).
