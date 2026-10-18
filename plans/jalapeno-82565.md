# jalapeno-82565: Custom Crew Bounties 🏴‍☠️ (v2: crew-run bounties)

Status: plan, approved task, branch `task/jalapeno-82565`.

## Open questions for Snax

1. **Who counts as a crew lead?** Proposal: anyone whose row in the crew's own sheet roster has a
   Status matching `lead` or `capo` (the same rule `CrewGettingStarted` already uses to show "your
   crew lead"), plus guild admins (Leonardo). Alternatives: the global Discord "Crew Leader" role
   (not tied to any one crew), or a new "Lead" column in the crew-mappings sheet.
2. **Who pays?** Proposal for v2: the poster's own wallet escrows the reward, as it does today. A
   lead approving someone else's crew bounty only releases that poster's escrow. A **crew treasury**
   (a shared wallet per crew that admins top up and leads spend from) would be a v3. Do you want
   the treasury now?
3. **Who can post a crew bounty?** Today any onboarded member can tag a bounty for any crew.
   Proposal: keep that, and show the "Post a bounty" form on the crew page to everyone signed in.
   Alternative: only leads and admins can tag a crew.
4. **Crew-only claiming?** Should only members of the crew (the `Crews` column in the members
   sheet) be able to claim its bounties? Proposal: no. Anyone can claim, which also works as a
   recruiting hook. It could be a per-bounty `crewOnly` toggle later.
5. **Can leads cancel?** Proposal: yes. A lead or admin can cancel a bounty in their crew, and the
   escrow is refunded to the **poster**, never to the lead.

The plan below assumes the proposed answer for each question. Each one is a single function or
flag, so changing an answer is cheap.

## Goal

v1 of this task already shipped in PR #125 (commit `a1e4f66`). It added a nullable `Bounty.crewId`
tag, a crew picker on the /pep bounty form, and a read-only "Crew Bounties" list on
`/crew/[crewId]` that links back to /pep.

v2 makes crew bounties something a crew **runs from its own page**:

- Post a bounty from the crew page, with the crew pre-filled. The PEP reward is escrowed.
- Members claim it, then **submit** their work (a note plus an optional link).
- The **poster or a crew lead** approves the submission, which pays the escrowed $PEP to the
  claimer, or **rejects** it with a note, which sends it back to the claimer.
- Everyone involved gets notified. The crew page shows Open, In progress and Awaiting review.

## Assumptions

- Payouts reuse the hardened ledger helpers in `app/lib/economy.ts` (`creditInTx`, `debitInTx`,
  `getOrCreateEconomy`). No new money path and no new `TransactionType` are needed:
  `BOUNTY_ESCROW`, `BOUNTY_REWARD` and `BOUNTY_REFUND` already cover the flow. Who approved goes in
  the ledger row's `metadata.approvedBy`.
- Bounties stay in Postgres (`Bounty` table), not the crew Google Sheets. Crew sheet *tasks*
  (claim-task / CrewGettingStarted) are a separate, unpaid system and are not touched.
- The existing /pep flow keeps working. The poster can still approve straight from CLAIMED, so the
  new submit step is encouraged but not required. Old rows need no backfill.
- Jobs (`app/lib/jobs.ts`) and missions are not changed. Missions only supply the
  submit → review → pay pattern and the "fail closed on role lookup" style.

## Data model and migration

`prisma/schema.prisma`:

```prisma
enum BountyStatus {
  OPEN
  CLAIMED
  SUBMITTED  // NEW: claimer submitted work, awaiting poster/lead review
  COMPLETED
  CANCELLED
}

model Bounty {
  // ...existing fields...
  submissionNote String?    // NEW: claimer's "what I did"
  submissionLink String?    // NEW: optional proof URL (https only)
  submittedAt    DateTime?  // NEW
  reviewedBy     String?    // NEW: Discord id of whoever approved/rejected/cancelled last
  reviewNote     String?    // NEW: rejection feedback (cleared on resubmit)
  completedAt    DateTime?  // NEW
}

enum NotificationType {
  // ...existing...
  BOUNTY_SUBMITTED   // NEW: work submitted on a bounty you posted / lead
  BOUNTY_REJECTED    // NEW: your submission was sent back
}
```

New migration `prisma/migrations/20261017000000_crew_bounty_review/migration.sql`. It is
hand-written, additive only, and safe to re-run, in the same style as `20261005000000_admin_grant_types`
and `20261012000000_shop_admin`:

```sql
ALTER TYPE "BountyStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOUNTY_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOUNTY_REJECTED';
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "submissionNote" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "submissionLink" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
```

Nothing in this migration uses the new enum values, so the "can't use a new enum value in the
transaction that added it" rule doesn't apply. The existing `@@index([crewId, status])` already
covers the crew listing. Validate the migration as earlier migrations were: build a throwaway
local Postgres 17 with `prisma db push` from origin/main, apply twice, then check
`prisma migrate diff` is empty.

Alternative considered: a `BountyEvent` audit table like `MissionReviewEvent`. Deferred. The ledger
row (with `approvedBy`), the `reviewedBy`/`reviewNote` columns and the comment thread are enough
for v2.

## Permissions

New file `app/lib/crew-leads.ts`:

- `getCrewLeadMemberIds(crewId): Promise<Set<string>>` reads the crew's sheet roster and returns
  the member ids whose Status matches `/lead|capo/i` but not `/iced|inactive/i`. That is the same
  rule as `CrewGettingStarted.tsx` line 26. Move that regex into a shared `isLeadStatus()` so the
  UI and the server can't drift.
  - The roster parsing (`detectSection`, `parseRoster`, `cellVal`) currently lives inside
    `app/api/crew/[crewId]/route.ts`. Move it into `app/lib/crew-sheet.ts` and import it from both
    places. The route's behaviour must not change; the existing crew route tests cover it. The new
    module fetches with the same `fetchGviz(..., { revalidate: CREW_SHEET_REVALIDATE_SECONDS })`
    cache the route uses.
- `isCrewLead(discordId, crewId)` looks up the caller's member id with
  `findMemberIdByDiscordId(discordId)` (`app/lib/member-utils.ts`) and checks it against
  `getCrewLeadMemberIds`. It **fails closed**: any sheet or lookup error returns false.
- `canManageBounty(discordId, bounty)` returns true if `bounty.createdBy === discordId`, or if
  `bounty.crewId` is set and `isCrewLead(discordId, bounty.crewId)`, or if
  `isAdminDiscordId(discordId)` (`app/lib/auth-guards.ts`).

The permission matrix:

| Action | Who |
|---|---|
| Post (crew-tagged) | any onboarded member (Q3); the reward comes from their own wallet |
| Claim | any onboarded member except the poster (Q4) |
| Submit / resubmit | the claimer only |
| Give up | the claimer (from CLAIMED or SUBMITTED) |
| Approve (pay) | `canManageBounty`, and **never the claimer** (no self-approval, even for a lead or admin) |
| Reject | `canManageBounty` |
| Cancel (refund the poster) | `canManageBounty` (Q5); not allowed once COMPLETED |
| Comment | poster, claimer, and now crew leads or admins of that crew |

## Payout mechanics (reusing economy code)

All changes go in `app/lib/bounties.ts`.

- `createBounty` is unchanged: a conditional `debitInTx(..., 'BOUNTY_ESCROW')` and the row insert
  in one transaction.
- **New `submitBounty(userId, bountyId, note, link?)`.** A conditional
  `updateMany({ where: { id, claimedBy: userId, status: 'CLAIMED' } })` moves the bounty to
  SUBMITTED and sets the note, link and `submittedAt`, and clears `reviewNote`. The note is
  required and capped at 2000 characters. The link must be https. Then it calls
  `notifyBountySubmitted` (fire and forget).
- **New `rejectBounty(reviewerId, bountyId, note)`.** It checks `canManageBounty`, then a
  conditional update moves SUBMITTED back to CLAIMED and sets `reviewNote` and `reviewedBy`. No
  money moves. Then it calls `notifyBountyRejected`.
- **`completeBounty(approverId, bountyId)` is generalized.** The `createdBy === creatorId` check
  becomes `canManageBounty`, and it also rejects `approverId === claimedBy`. The conditional update
  becomes `where: { id, status: { in: ['CLAIMED','SUBMITTED'] }, claimedBy }`. It sets
  `status: 'COMPLETED', reviewedBy, completedAt`, all in the **same `$transaction`** as
  `creditInTx(tx, claimerId, reward, 'BOUNTY_REWARD', memo, { bountyId, approvedBy })`. This keeps
  the existing exactly-once guarantee when a poster and a lead click Approve at the same time, or
  when an approve races a cancel.
- **`cancelBounty(actorId, bountyId)` is generalized** the same way. The refund always credits
  `bounty.createdBy` (the poster), never the actor:
  `creditInTx(tx, bounty.createdBy, ..., 'BOUNTY_REFUND', ..., { bountyId, cancelledBy })`. It is
  allowed from OPEN, CLAIMED or SUBMITTED.
- `giveUpBounty` now also accepts SUBMITTED. It clears `claimedBy`, the submission fields and
  `reviewNote`, and returns the bounty to OPEN.
- `getAllBounties` / `getClaimedBounties` now include `SUBMITTED` in their status filters.
- `addBountyComment` widens its permission to `canManageBounty || claimer`.

There is no crew treasury in v2 (Q2). If Snax wants one, the cleanest v3 is a synthetic
`User`/`Economy` row per crew (for example `crew:ops`), funded with the existing `ADMIN_GRANT`
path, and `createBounty` debiting that wallet when a lead posts "from crew funds". The same
`debitInTx`/`creditInTx` helpers would apply unchanged.

## Notifications (`app/lib/notifications.ts`)

- `notifyBountySubmitted(posterId, claimerId, bountyId, description, crewId)` goes to the poster
  and, best effort, to that crew's leads. Lead member ids are mapped to Discord ids with
  `fetchMemberById(...)`; any failure here is swallowed. `linkUrl` is `/crew/<crewId>#bounties`
  for crew bounties, otherwise `/pep`.
- `notifyBountyRejected(claimerId, reviewerId, bountyId, description, note)`.
- Point `linkUrl` for the existing claimed and completed notifications at the crew page when
  `crewId` is set.
- `app/ui/notifications/NotificationItem.tsx` needs icons and labels for the two new types.

## Routes

These follow the existing `app/api/bounties/*` pattern. Use `withErrorHandling` so `ForbiddenError`
returns 403 and `ConflictError` returns 409. Today `complete`, `cancel` and `claim` turn every
error into a 400; fix that in the routes this plan touches.

- `POST /api/bounties/submit` takes `{ bountyId, note, link? }`. **New.**
- `POST /api/bounties/reject` takes `{ bountyId, note }`. **New.**
- `POST /api/bounties/complete` and `POST /api/bounties/cancel`: same body, wider permission
  through the lib.
- `POST /api/bounties/giveup`: no API change.
- `GET /api/bounties?crewId=x`: return the new fields (`submissionNote`, `submissionLink`,
  `submittedAt`, `reviewNote`) and, when there is a session and `crewId` is given, add
  `viewer: { discordId, canManageCrew: boolean }`. `canManageCrew` is `isCrewLead || isAdmin`, so
  the crew page knows whether to show Approve/Reject on bounties posted by other people. Keep
  `NO_STORE_HEADERS`.
- `POST /api/bounties` is unchanged. The crew page sends `crewId` exactly as the /pep form does.

## Components

- `app/crew/[crewId]/CrewBounties.tsx` becomes a full crew bounty board:
  - Sections: **Open**, **In progress** (CLAIMED), **Awaiting review** (SUBMITTED; shown first to
    managers). `openCrewBounties()` is kept for the old test and joined by `groupCrewBounties()`.
  - An inline "Post a bounty" form (description, reward, optional link, crew fixed to this crew)
    that shows the viewer's wallet balance from `/api/economy/balance` or the existing balance
    endpoint. It replaces the "+ Post a bounty for X" link to /pep.
  - Per-row actions, from the viewer's id and `viewer.canManageCrew`: Claim / Submit work (opens a
    note and link form) / Give up / Approve / Reject (opens a note form) / Cancel. The rejection
    note is shown to the claimer.
  - It keeps its plain `fetch` (no react-query) so the crew page tests don't need a provider.
  - Add `id="bounties"` so notification links and the hash work.
- `app/crew/[crewId]/CrewPageClient.tsx`: pass `viewerDiscordId={user?.discordId}` to both
  `<CrewBounties>` renders (lines ~708 and ~1600). Nothing else changes.
- `app/ui/bounties/BountyCard.tsx` (/pep): add the Submit work button (claimer, CLAIMED), a
  "Awaiting review" badge with Approve/Reject for the poster (SUBMITTED), and show the
  `submissionNote`/link. Leads approve from the crew page, so /pep only needs poster logic.
- Optional, cheap: `app/dashboard/[id]/lib/next-action.ts` can surface "You have N crew bounty
  submissions to review" for leads. **Skip unless trivial**; note it as a follow-up.

## i18n

`CrewGettingStarted` already uses next-intl (`crewGettingStarted` namespace); `CrewBounties` and
the /pep bounty UI are hard-coded English.

- Add a `crewBounties` namespace to `messages/en.json`, `es.json` and `fr.json`. It holds the
  title with count, the section headings, the empty states, the form labels and placeholders,
  every action button, the confirm prompts, the status badges, the "Awaiting review" and "Sent
  back: {note}" labels, and the error fallbacks. Use ICU plurals for counts and `{reward}` for the
  PEP amount (formatted with `useLocale()` the way CrewGettingStarted does).
- The new BountyCard strings (Submit work, Awaiting review, Reject, the note placeholder) go in a
  small `bounties` namespace. Translating the rest of /pep is **out of scope** (it is all English
  today).
- `app/lib/i18n/__tests__/catalog-parity.test.ts` must pass (same keys in all three locales).
- Server error messages stay in English, as everywhere else in the API.

## Files to change

- `prisma/schema.prisma`, plus the new `prisma/migrations/20261017000000_crew_bounty_review/migration.sql`
- `app/lib/bounties.ts`, plus the new `app/lib/crew-leads.ts` and `app/lib/crew-sheet.ts` (moved out of
  `app/api/crew/[crewId]/route.ts`)
- `app/api/crew/[crewId]/route.ts` (import the moved parser)
- `app/api/bounties/route.ts`, `complete/route.ts`, `cancel/route.ts`, `giveup/route.ts`,
  `claim/route.ts` (error handling), plus the new `submit/route.ts` and `reject/route.ts`
- `app/lib/notifications.ts`, `app/ui/notifications/NotificationItem.tsx`
- `app/crew/[crewId]/CrewBounties.tsx`, `CrewPageClient.tsx`, `CrewGettingStarted.tsx` (use the
  shared `isLeadStatus`)
- `app/ui/bounties/BountyCard.tsx` (and `BountyBoard.tsx` only for the type change)
- `app/lib/__mocks__/db.ts` (if new prisma methods need mocking)
- `messages/en.json`, `es.json`, `fr.json`

## Alternatives considered

- **Store crew bounties in the crew Google Sheets** (next to crew tasks). Rejected: money needs
  transactional escrow, and the sheets have no locking. That is the reason bounties already live
  in Postgres.
- **A separate `CrewBounty` model.** Rejected: v1 already put `crewId` on `Bounty`, and splitting
  the model would duplicate the escrow and concurrency code that the concurrency suite has already
  hardened.
- **Leads defined by the Discord "Crew Leader" role.** Rejected as the main rule because that role
  is global, not per crew. A Crew Leader of Ops could then approve Design's payouts. It is still
  available as an extra source if Snax prefers it (Q1).
- **A lead's approval pays out of the lead's own wallet.** Rejected: the escrow already exists and
  is tied to the bounty. Paying from the lead's wallet would double-charge or need a second escrow.

## Risks

- **The roster-based lead check depends on sheet hygiene.** A wrong Status cell grants or removes
  approval rights. Mitigations: fail closed; never allow self-approval; admins can always act; the
  ledger row records `approvedBy`. Rewards are escrowed by the poster, so the most a bad lead can
  do is pay the escrowed amount to the claimer of that one bounty.
- **Lead and claimer collusion.** A lead can approve a friend's claim on someone else's crew
  bounty. This is accepted in the design: the poster tagged that crew, and the lead was chosen by
  the crew. The poster still gets a notification on approval (add the poster as a recipient in
  `notifyBountyCompleted` when the approver isn't the poster).
- **Sheet latency in permission checks.** Roster reads are cached (revalidate). Every write route
  calls `isCrewLead` only when the caller isn't the poster, so the common path costs nothing extra.
- **Moving the roster parser** could change `/api/crew/[crewId]` output. Keep the move pure, run the
  existing crew route and page tests, and diff the JSON for one crew on the preview against
  production.
- **Migration ordering.** The code reads the new columns, so the migration must be on Neon
  **before** the deploy. `npm run build` does not run migrations: it is `prisma generate && next build`.
- **Preview DB.** Confirm which database Vercel previews use. If it is production, apply the
  migration to production first; the change is additive, so old code is unaffected.

## Tests (vitest, mocked prisma like `bounties.crew.test.ts`)

- `app/lib/bounties.review.test.ts` (new):
  - submit: only the claimer can submit, only from CLAIMED; note required; https-only link;
    clears `reviewNote`; a race (updateMany count 0) gives a ConflictError.
  - reject: poster, lead or admin can reject; a non-manager is forbidden; it returns the bounty to
    CLAIMED with the note; no economy calls.
  - complete: the poster can complete from CLAIMED (legacy) and SUBMITTED; a lead of the
    bounty's crew can complete; a lead of a *different* crew can't; the claimer can't
    self-approve even when they are a lead or admin; `creditInTx` is called with
    `{ bountyId, approvedBy }`.
  - cancel by a lead refunds `createdBy`, not the lead.
  - give up from SUBMITTED clears the submission fields.
- `app/lib/crew-leads.test.ts` (new): status regex cases (`Lead`, `Crew Lead`, `Capo`,
  `Iced lead` gives false); sheet or lookup failure gives false; `canManageBounty` combinations.
- `app/lib/crew-sheet.test.ts`: parser fixtures moved and kept from the current route behaviour.
- `app/lib/pep-economy.concurrency.test.ts` (real Postgres, `npm run test:pep-concurrency`): add
  "N parallel approvals by poster and lead pay once", "approve racing reject: one wins, at most one
  payout", "approve racing cancel releases the escrow once (from SUBMITTED)".
- `app/crew/[crewId]/CrewBounties.test.tsx`: extend it to cover grouping; the form posts `crewId`;
  the action buttons per role (anon, member, claimer, poster, lead); the rejection note is shown.
  Render with `app/lib/i18n/test-utils.tsx`.
- API route tests for `submit`/`reject` (401 with no session, 403, 409 statuses).
- `catalog-parity.test.ts` and `npm run lint`, `npx tsc --noEmit`, `npm run test:run`.

## Rollout

1. Implement on `task/jalapeno-82565` in a worktree (implementer agent).
2. Validate the migration locally (throwaway PG17: apply twice, `migrate diff` empty), then
   `npx prisma migrate deploy` against a **Neon branch**, then production (`DATABASE_URL_UNPOOLED`).
   Do this **before** the preview or production deploy that reads the new columns. It is additive,
   so the code currently live is unaffected.
3. `/ship` to open the PR and a Vercel preview (`vercel-deploy`). Checks on the preview:
   - `/crew/<crew>` signed out: the bounty list renders, with no form or action buttons.
   - Signed in as a regular member: post a crew bounty (wallet is debited, an escrow row appears in
     history), then claim one from a second account.
   - As the claimer: submit work. The poster and leads get a `BOUNTY_SUBMITTED` notification
     linking to `/crew/<crew>#bounties`.
   - As a crew lead (roster Status "Lead") who is not the poster: Reject with a note (the claimer
     sees it), resubmit, then Approve. The claimer is credited once, and the ledger has
     `BOUNTY_REWARD` with `approvedBy`.
   - A lead of another crew sees no Approve button, and a direct POST returns 403.
   - Cancel as a lead refunds the poster.
   - The /pep board still works for general bounties (claim, approve from CLAIMED).
   - Switch the locale to es/fr: every crew bounty string is translated.
   - `/mobile-check` on `/crew/<crew>` (the form and action rows at 375px).
   - Diff `/api/crew/<crew>` JSON between the preview and production (the parser move must not
     change anything).
4. Reviewer agent pass, then Snax reviews the preview. Merge only after approval, then
   `/task done jalapeno-82565 <pr#>`.
5. Post-launch: tell crew leads in Discord that they can now run bounties from their crew page.
   Follow-ups: the dashboard "submissions to review" nudge, a crew treasury (Q2), and a per-bounty
   `crewOnly` toggle (Q4).

## Decisions (Snax, 2026-10-18)

All open questions resolved with the plan's defaults:
1. A crew lead is anyone with lead or capo status in the crew sheet roster.
2. The poster's own PEP pays (escrowed). No crew treasury yet.
3. Anyone can post a crew bounty.
4. Anyone can claim one, not just crew members.
5. Leads (and admins) can cancel. The refund goes to the poster.
