# Lane cards → profile with a chosen mission → step-by-step guide

Status: plan, awaiting review (decisions at the end). Public repo: code, seed text and PR text stay
generic (no personal names, ids or private links).

## 1. Goal

The six "find your lane" cards on `/community` (§ C.01: Host, Build, Create, Gather, Experiment,
Grow) become entry points. Clicking one:

- **Visitor without a profile**: goes through the normal signup (/join), with the chosen lane
  carried through the Discord / DM login. When the profile is saved, the lane's mission is pinned as
  the member's chosen first mission and they land on that lane's guide (a checklist that walks them
  through the SOP and ends at the mission's submit step).
- **Logged-in member**: skips signup, the lane is pinned, they land on the guide.
- The guide is resumable from the dashboard ("Your lane: Host, 3 of 7 steps").

Everything sits behind one off-by-default toggle. Lanes, their mission mapping and guide steps are
DB rows edited in an admin page (repo rule: config in the DB, not hard-coded). Migrations are additive.

## 2. What exists today (survey)

| Piece | Where | Notes |
|---|---|---|
| Lane cards | `app/(marketing)/_site/pages/CommunityPage.tsx` (`WAYS_IN` const at the top, rendered at the `#ways-in` section) | `"use client"`. Each card is a plain `<article>`; the `ArrowUpRight` icon is decorative. **The cards link nowhere.** Copy is hard-coded like the rest of the marketing page. Route: `app/(marketing)/community/page.tsx` (static, no DB reads). |
| Wizard | `app/page.tsx`, `/start` (re-export), `/join` (`initialFlow` step 1) → `app/ui/onboarding/OnboardingWizard.tsx` | WizardData persisted in localStorage (`LS_KEY`). `/join` skips the session check, so a logged-in member opening /join sees step 1, not their dashboard. |
| Invite-link carry-through (the pattern to copy) | `?ref=` → `POST /api/referrals/ref` sets httpOnly `pd_ref` cookie (`app/lib/referral-cookie.ts`), also mirrored in WizardData `invitedBy`; read + cleared by `POST /api/profile` on first onboarding (`app/api/profile/route.ts` ~L383-410) | Survives the OAuth round trip (same origin; on previews the login hops to production and returns via session transfer to the preview origin, where the cookie was set). |
| Return-to plumbing | `?returnTo=` on the wizard page → `MagicLoginFlow` passes it as `next` to `/api/discord/login` and as `returnTo` to the DM magic login; both validated by `loginReturnPath` (`app/lib/login-return.ts`) | Honoured **only for existing members** (Discord callback L174, magic-login callback L67). New users always land on `/` with `discordId`. |
| Cross-device signup | `app/lib/signup-draft.ts` `sanitizeSignupDraft` (allowlisted fields) stored on the magic-login token, restored with `?resumeSignup=1` | The lane must be added to this allowlist or it is lost when the DM link opens on a phone. |
| Success redirect | `OnboardingWizard.tsx` ~L552: `redirectTo = /dashboard/<memberId>`; `FinaleScene` CTA | |
| Missions | `prisma/schema.prisma` `Mission` (level 0 = Anytime bonus), `MissionCompletion` keyed `(missionId, discordId)`, verifiers in `app/lib/mission-verify/`, `/missions` (anchors `#mission-<id>`), `MissionCard`, `GuideLink`, `Mission.guideHref` (handbook paths only, `app/lib/guide-href.ts`) | Submit does not gate by level. `/api/admin/missions` is DPR-only, stricter-only, and **cannot create missions**. Seed script `scripts/missions/set-verifiers.mjs` only inserts missing `(level,index)` rows. |
| Next mission / dashboard | `app/lib/next-mission.ts` `pickNextMission`; dashboard `StartHere` (step 2 = next mission), `NextActionPanel`, `MissionsProgress`, `BuddyCard` | No notion of a member-chosen mission. |
| SOP content | Handbook (`content/handbook/*`, prose in code, en/es/fr, facts from `guide.*` settings via `renderPlaceholders`): `getting-started`, `levels`, `host-a-party` (before, budget, pizza math, POAP, announce, day-of, after, GPP, deadlines), `make-a-poap`. `Manual` table (= manual.pizzadao.xyz, which 301s to the manuals sheet): only Events-crew docs are active (host playbook, ordering pizza, flyer, announcement, "Throwing a PizzaDAO Event"). Education sessions (`CrewSession`, `/learn`). Brand system page (`/brand-system`). Tech projects (`/tech/projects`). | **No SOP exists** for building, art, recurring meetups, hackathons or opening a chapter. Those steps must be written (seeded as drafts, refined by an admin). |
| Settings / toggles | `app/lib/settings/registry.ts`, `toggles.ts` (env kill switch; on previews only the env var counts; read failure = off) | |

Prod lookups (read-only, 2026-11-14): 28 missions. Relevant: #22 "Host a Global Pizza Party"
(L0 bonus, `gpp_host`), #29 "Bounty hunter" (L0, `bounty_or_job`), #27 "Get featured in the
Spotlight" (L0), #5 "Share something in #show-and-tell" (L3, `discord_message`), #12 "Onboard a
Bitcoin Pizza Day city" (L6, `gpp_host`), #28 "Writer" (L0). All `guideHref` are null. Crews:
events, tech, creative, community, education, africa, latam, among others. The rsv.pizza host
lookup (`backend/src/lib/gppHostLookup.ts`) only returns `event_type = 'gpp'` events, so a
non-GPP party cannot be auto-verified today.

## 3. Per-track mission mapping (seeded as data; the admin can remap any lane)

| Track | Lane mission | New or reused | Proof | Stretch mission shown on the guide |
|---|---|---|---|---|
| 01 Host | **"Throw a pizza party"** | NEW, Anytime bonus | URL (rsv.pizza event page or photo album), manual review (`verifierKey: 'manual'`) | #22 Host a Global Pizza Party |
| 02 Build | #29 Bounty hunter | REUSED (auto-verified) | none | #28 Writer (write up what you shipped) |
| 03 Create | #5 Share something in #show-and-tell | REUSED (auto, Discord message link) | Discord message | #27 Spotlight |
| 04 Gather | **"Hold the room"** (run a recurring meetup: slice club, long table, coworking night) | NEW, Anytime bonus | URL (event listing / photos), manual | #3 Say hi on a call (bring the room to a call) |
| 05 Experiment | **"Run a hackathon"** | NEW, Anytime bonus | URL (event page / demo list), manual | #29 Bounty hunter |
| 06 Grow | **"Open a city"** (start a chapter) | NEW, Anytime bonus | URL (chapter channel / first event), manual | #12 Onboard a Bitcoin Pizza Day city |

New missions are **created by an admin in `/admin/missions`** (new "Add Anytime mission" form,
Phase 1), not by a migration or seed constant: level 0, `bonus: true`, `bonusReward: 0`,
`isActive: false` on create (activation is allowed in the editor; level 0 never affects level
completion). The seed script only references missions by id/title lookup and leaves `missionId`
null when a mission is missing.

## 4. Data model (one additive migration)

```prisma
// A "find your lane" track (plans/lane-cards-mission-onboarding.md). Edited in /admin/lanes.
model Lane {
  slug        String     @id @db.VarChar(32)   // host | build | create | gather | experiment | grow
  tag         String     @db.VarChar(24)       // card overline, e.g. "Host"
  title       String     @db.VarChar(80)
  summary     String     @db.VarChar(280)      // guide header dek
  missionId   Int?                             // the mission this lane pins (null = guide only)
  stretchMissionIds Int[] @default([])
  crewId      String?                          // suggested crew (join prompt on the guide)
  position    Int        @default(0)
  published   Boolean    @default(false)       // unpublished lanes: card stays unlinked, /lanes/<slug> 404s
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  updatedBy   String?
  steps       LaneStep[]
}

model LaneStep {
  id        String   @id @default(cuid())
  laneSlug  String
  position  Int
  title     String   @db.VarChar(120)
  body      String                              // Markdown (no raw HTML), max 4000, {{guide placeholders}} allowed
  linkHref  String?  @db.VarChar(300)           // internal path, or https on an allowlisted host
  linkLabel String?  @db.VarChar(60)
  kind      String   @default("do")             // read | do | submit (submit = the mission's submit button)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  lane      Lane     @relation(fields: [laneSlug], references: [slug], onDelete: Cascade)
  @@index([laneSlug, position])
}

// A member's lane(s). The row with the latest pinnedAt is the pinned one.
model MemberLane {
  discordId     String
  laneSlug      String
  memberId      String?
  source        String              // signup | card | dashboard | guide
  doneStepIds   String[]  @default([])
  pinnedAt      DateTime?
  firstSeenAt   DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  @@id([discordId, laneSlug])
  @@index([discordId, pinnedAt])
}
```

No FK from `Lane.missionId` to `Mission` (keeps the migration purely additive and lets a missing
mission degrade to "guide only"); the admin save validates the id. Admin edits are audited in
`AppSettingChange` with keys `lane:<slug>` / `laneStep:<id>`, like missions.

Toggle: `onboarding.laneCardsEnabled` in `TOGGLES` (env `LANE_CARDS_ENABLED`, legacy `ON_WORDS`,
so off by default; read failure = off; on previews only the env var counts). Registered with a
`boolSetting` in the existing area used by the other `onboarding.*` keys. Off means: cards render
exactly as today, `/lanes/*` returns not-found, `/join?lane=` is ignored, `/api/lanes/*` answer
404, `POST /api/profile` ignores lane input. The admin editor works regardless so content can be
prepared before launch.

## 5. Flow

```
/community card (toggle on + lane published) ── <a href="/lanes/host?pick=1">
   │
/lanes/[slug] (server page)
   ├─ toggle off / unpublished ───────────────▶ not found
   ├─ no session, or session without a member ─▶ redirect /join?lane=host&returnTo=/lanes/host%3Fpick%3D1
   └─ member ─▶ render guide; <PinOnArrive> POSTs /api/lanes/pin {slug, source:"card"} when ?pick=1,
                then strips ?pick from the URL
/join?lane=host
   ├─ POST /api/lanes/intent {slug} → httpOnly pd_lane cookie (30 d, same options as pd_ref)
   ├─ WizardData.lane = slug (localStorage) → banner on step 1: "Your lane: Host · Throw a pizza party"
   ├─ signupDraft gains `lane` (allowlisted ^[a-z0-9-]{1,32}$) so the DM link works on another device
   ├─ existing member logs in → returnTo already lands them on /lanes/host?pick=1 (existing plumbing)
   └─ new member → … → POST /api/profile {…, lane}
          first onboarding: lane = body.lane ?? pd_lane cookie, must be a published lane
          → upsert MemberLane(source "signup", pinnedAt now), clear pd_lane,
            respond { lane: { slug, href: "/lanes/host" } }
          wizard success redirectTo = /lanes/host (FinaleScene CTA "Start your <tag> guide")
```

Also in `handleDiscordCallback`, the two `router.push('/dashboard/…')` paths for already-linked
members go to `/lanes/<slug>?pick=1` when `data.lane` is set (covers the auto-claim path, which
does not go through `next`).

### Guide page `/lanes/[slug]`

- Header: tag, title, summary; "Pinned" chip (or "Pin this lane" button if another lane is pinned).
- Mission block: the lane mission via the existing `MissionCard` (status, proof form, submit), so
  submission, verifiers and review are untouched. Stretch missions listed below as small links to
  `/missions#mission-<id>`.
- Checklist: `LaneStep`s in order. Body rendered with `HandbookMarkdown` after `renderPlaceholders`
  with `getHandbookFacts` (so caps/dates stay in `guide.*` settings). Each step has a checkbox
  (`POST /api/lanes/progress {slug, stepId, done}`) and optional link. `kind: "submit"` renders the
  mission submit button instead of a checkbox and is "done" when the completion is PENDING/APPROVED.
- Suggested crew card if `crewId` is set (link to `/crews/<id>`).
- Progress "3 of 7" computed server-side from `doneStepIds` intersected with current step ids
  (deleted steps drop out).
- English only for step content (like mission titles); page chrome strings go in `messages/*.json`
  (en/es/fr, parity test).

### Dashboard and missions

- New `LaneCard` on `/dashboard/[id]` above `StartHere`: pinned lane, progress, "Continue" →
  `/lanes/<slug>`; "Pick a lane" link to `/community#ways-in` when none (only when the toggle is on).
  Data from `/api/dashboard-summary` (new `lane` field).
- `StartHere` step 2 and `NextActionPanel` mission prompt prefer the pinned lane mission when it is
  not done (`pickNextMission` gets an optional `pinnedMissionId`; falls back to today's rule).
- `/missions`: a "Your lane" chip on the pinned mission's card.

### Admin `/admin/lanes` (DPR-only, `requireDpr` + `rejectUnsafeWrite`, audited)

Edit lane fields, pick the mission from a dropdown of active missions, add/edit/reorder/delete
steps, publish/unpublish, preview link. Link validation in a pure `app/lib/lanes/links.ts`:
internal path (`loginReturnPath`-style rules, no `/api`) or `https://` on an allowlist
(`rsv.pizza`, `discord.com`, `discord.gg`, `docs.google.com`, `github.com`, `poap.xyz`), kept as a
code constant (security boundary, not a tunable).

### Admin `/admin/missions`: "Add Anytime mission"

`POST /api/admin/missions` `{title, description, proofKind: NONE|URL, verifierKey: 'manual'}`:
level 0, `index = max(level 0 index) + 1` inside a transaction (retry on the unique conflict),
`bonus: true`, `bonusReward: 0`, `isActive: false`, audited. Reward and activation then use the
existing PATCH (which already confirms reward changes). No verifier choice beyond `manual` in v1.

## 6. Seed content (one script, dry run by default)

`scripts/lanes/seed.mjs [--apply]`: inserts the six lanes **unpublished** with draft steps if the
slug is missing; never overwrites an existing row (DB is the source of truth after the first run).
Resolves `missionId` by title lookup and prints what it could not find. Running `--apply` against
production needs Snax's OK. Draft steps (generic, short, linking to existing material):

- **Host**: read the host guide (`/handbook/host-a-party#before`); budget and the cap
  (`#budget`, `{{hostCapUsd}}`); pizza math; create the rsv.pizza event; announce
  (`#announce`); make a POAP (`/handbook/make-a-poap`); day-of checklist; after the party
  (photos, receipts per `#after`); submit.
- **Build**: join a Tech crew call; browse `/tech/projects` and open bounties; claim one or pitch your
  own in the crew channel; ship it; post it in #show-and-tell; (bounty completes the mission).
- **Create**: join a Creative crew call; read `/brand-system`; make a piece; post it in
  #show-and-tell and submit the message link; optional Spotlight submission.
- **Gather**: pick a format and a recurring slot; find a venue (reuse host guide "before");
  list it on rsv.pizza; tell the Community crew; run it twice; submit the listing/photos.
- **Experiment**: draft the prompt and date; bring it to an Events + Tech crew call; budget via
  the proposals process; line up judges and prizes; run it; post demos; submit.
- **Grow**: check the chapter list/map for your city; post in the regional channel; host a first
  party (Host steps); recruit a co-organizer; hand them the keys; submit the chapter link.

Experiment, Gather and Grow have no existing SOP: these drafts need a review by whoever runs those
programs before a lane is published (decision 4).

## 7. Files

New
- `prisma/migrations/2026111xxxxxxx_lanes/migration.sql`, models in `prisma/schema.prisma`
- `app/lib/lanes/{index,links,progress,cookie}.ts` (+ tests): read published lanes, validate slugs
  and links, pin/progress writes, `pd_lane` cookie helpers (copy `referral-cookie.ts`)
- `app/api/lanes/intent/route.ts` (POST/DELETE cookie), `pin/route.ts`, `progress/route.ts`
- `app/api/admin/lanes/route.ts`; `app/admin/lanes/{page,LanesEditor}.tsx`
- `app/lanes/[slug]/page.tsx`, `app/ui/lanes/{LaneGuide,LaneStepItem,PinOnArrive}.tsx`
- `app/dashboard/[id]/components/LaneCard.tsx` (+ test)
- `scripts/lanes/seed.mjs`

Changed
- `app/(marketing)/community/page.tsx`: server reads `getPublicLaneLinks()` (toggle + published
  slugs → href map), `export const revalidate = 300`, try/catch → empty map; passes it to
  `CommunityPage`.
- `CommunityPage.tsx`: `WAYS_IN` gains `slug`; a card with a href renders as an `<a>` wrapping the
  article (keyboard focus ring, `aria-label`), fires a PostHog `EVT.laneCardClick`; without a href
  it is unchanged.
- `app/ui/onboarding/OnboardingWizard.tsx` (+ `types.ts`): `lane` param effect, WizardData.lane,
  banner, body.lane on submit, lane-aware redirects.
- `app/lib/signup-draft.ts`: allowlist `lane`.
- `app/api/profile/route.ts`: pin on first onboarding, clear cookie, return `lane`.
- `app/lib/next-mission.ts`, `app/api/dashboard-summary/route.ts`, `StartHere.tsx`,
  `app/dashboard/[id]/page.tsx`, `MissionCard.tsx` (chip).
- `app/api/admin/missions/route.ts` + `app/lib/admin-missions.ts` + `MissionsEditor.tsx`: create.
- `app/lib/settings/toggles.ts`, `registry.ts` (+ registry test default list).
- `messages/{en,es,fr}.json`; features catalog entry (toggleKey = the new toggle) via the
  features admin, not code.

## 8. Phases (one PR each)

1. **Data + admin (no public change)**: migration, toggle, `/admin/lanes`, "Add Anytime mission",
   seed script. After merge: apply the migration, create the four new missions in the admin
   (inactive), run the seed dry run, then `--apply` with Snax's OK.
2. **Guide + logged-in flow**: `/lanes/[slug]`, pin/progress APIs, card links on `/community`,
   dashboard `LaneCard`, StartHere/next-mission preference, missions chip.
3. **Signup carry-through**: `/join?lane`, `pd_lane` cookie, signup-draft allowlist, profile pin,
   success redirect, banner, lane-aware callback redirects, activation event `lane_picked`
   (extends `/admin/activation` funnel by lane, optional).

Launch: publish lanes one by one (Host first: it has the most SOP), then turn the toggle on.

## 9. Risks

- **OAuth / DM round trip loses the lane**: covered three ways (localStorage WizardData, httpOnly
  cookie, signup draft). Tests cover each path. The cookie is only a hint: the server re-validates
  against published lanes and only acts on first onboarding.
- **`/join` vs logged-in members**: `/join` skips the session check, so logged-in clicks must go
  to `/lanes/<slug>` (which decides), never straight to `/join`.
- **Static marketing page now reads the DB**: ISR with a 5-minute revalidate and a fail-closed
  try/catch (no links). Alternative considered: a client fetch after mount (keeps the page fully
  static but causes a layout change and no crawlable links). Toggle flips take up to 5 minutes to
  show; acceptable.
- **notFound() after streaming answers 200** (see `proxy.ts` comment). Acceptable for an off
  feature; if a real 404 matters, add `/lanes` to the proxy check like `/disavow`.
- **Previews share the production DB**: preview testing writes `MemberLane` rows for the test
  account and needs published lanes. Publishing is harmless while the production toggle is off
  (cards only link when the toggle is on). Delete test rows after.
- **Admin-created level 0 missions vs future code seeds**: `set-verifiers.mjs` inserts by
  `(level,index)`; a future code seed at level 0 must use an index above the admin-created ones.
  Add a comment in `mission-config.ts` and make the seed script skip occupied indexes.
- **Manual review load**: four new manual missions add reviews to the existing queue/SLA; with
  `bonusReward: 0` there is no payout risk until an admin sets one (existing confirm).
- **Untranslated step content**: English only in v1 (same as missions).
- **Pinning on GET-ish arrival**: the pin is a same-origin POST from the page, guarded by
  `rejectUnsafeWrite` and the session; a forced navigation can at worst pin a lane, which is
  harmless and reversible.

## 10. Verification

Unit / route tests (vitest)
- `lanes/links`: allowlist, rejects `javascript:`, `//`, `/api`, other hosts.
- `api/lanes/*`: 404 when off; 401 without session; slug must be published; progress ignores
  unknown step ids; idempotent pin; latest pin wins.
- `api/profile`: first onboarding pins from body, then from cookie; ignores unpublished/invalid
  slugs; ignores when off; never pins on a profile edit; clears the cookie (extend the
  `referral-flow.test.ts` style).
- `signup-draft`: lane allowlisted, junk dropped.
- Wizard: `?lane=` sets data + calls intent; banner renders; success redirect goes to the guide;
  linked-member callback goes to `/lanes/<slug>?pick=1`.
- `CommunityPage`: with an href map the six cards are links with the right hrefs; with an empty map
  the markup is unchanged (snapshot of the section).
- `next-mission`: pinned mission preferred, falls back when done.
- Admin: create mission validation, index allocation, audit row; lanes editor save/validation.
- `registry.test.ts` default `false` for the toggle; messages parity test.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:run`.

Vercel preview (`vercel-deploy`; set `LANE_CARDS_ENABLED=1` on the preview env only)
1. `/community`: six cards are links; hover/focus states intact on desktop and mobile
   (`/mobile-check`).
2. Logged out, click Host → `/join?lane=host…`, banner shows; complete signup with a test Discord
   account → lands on `/lanes/host`, lane pinned, mission card shows.
3. Same with the DM magic-login link opened in a second browser (draft path).
4. Logged-in member clicks Build → guide, pinned; tick two steps, reload, still ticked; dashboard
   shows "Your lane: Build, 2 of N" and Continue works.
5. Logged-out existing member clicks Create, logs in → lands on the Create guide, not the dashboard.
6. Toggle env removed → cards unlinked, `/lanes/host` not found, `/join?lane=host` behaves as plain
   `/join`.
7. Clean up test `MemberLane` rows.

## 11. Decisions for Snax (recommendation in bold)

1. Visitors without a profile: straight into signup, or a lane preview page first?
   **Straight into signup with a lane banner** (what was asked; fewer clicks).
2. Build and Create: reuse existing missions (Bounty hunter, #show-and-tell) or create new
   "Ship a project" / "Make art" missions? **Reuse** (auto-verified, no new review load); revisit
   after launch.
3. Rewards for the four new missions (Host, Gather, Experiment, Grow)? **Start at 0 $PEP**, set
   bonus rewards in the admin once the review flow is proven.
4. Who reviews the drafted SOPs for Gather, Experiment and Grow before publishing?
   **Publish Host first; the others once the relevant crew lead signs off on the steps.**
5. One pinned lane or several? **One pinned, others kept with their progress** (switching is a
   click on any guide).
6. Guide step content: DB-editable English only, or Markdown in code with translations like the
   handbook? **DB-editable English** (fits "config in DB"); link to translated handbook pages where
   they exist.
7. Should Host later auto-verify non-GPP rsv.pizza parties? **Yes, as a follow-up** (needs
   rsv.pizza's host lookup to accept other event types).

## Decisions (2026-11-14)
All seven recommendations approved: straight into signup with a lane banner; reuse existing missions for Build and Create; 0 reward for the new missions at first; Host goes live first, the others once a crew lead approves their steps; one pinned lane with progress kept on others; steps in the DB, English only; Host auto-verify for non-GPP parties later (needs an rsv.pizza change).
