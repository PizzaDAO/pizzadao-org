# Plan: mission verification + rewards

Status: **plan only, no feature code.** Branch `plan-mission-verification`.

## 0. TL;DR

- There are **12 missions over 8 levels**. They exist only in the `Mission` table, seeded once by `scripts/seed-missions.mjs`. There is no admin UI and no sheet.
- Proposed verification methods (details in §2):

  | Method | Count | Missions |
  |---|---|---|
  | **Automatic** | 6 | L1.0, L2.0, L3.0, L3.1, L5.0, L6.0 |
  | **Semi-automatic** (proof link with format and API checks, then a one-click admin approve) | 4 | L2.1, L4.0, L5.1, L6.1 |
  | **Manual only** | 2 | L7.0, L8.0 |

  - L3.1 needs a small piece of new referral capture.
  - L1.0 needs its wording changed: a real "follows" check requires a paid X API tier.
- Both current "auto-verify" missions (L1.0 follow on X, L3.0 #show-and-tell) approve with **no check at all** today. Both can be replaced with real checks.
- Add a **verifier registry**: `Mission.verifierKey` + `verifierParams`.
  - One engine, `runVerifiers()`, writes `APPROVED` / `reviewedBy "auto:<key>"` idempotently and then settles level rewards.
  - Settling uses the existing race-safe `checkAndAwardLevelReward` (PR #133), wrapped in an ordered `settleLevels()`.
  - Triggers: a "Check my progress" button, a `/missions` Discord command, event hooks, and a nightly cron.
- **Keep per-level rewards** and do not add per-mission PEP.
- **Never claw back.** Stateful verifiers only *flag* a completion when the underlying state is lost.
- Pre-existing bugs found while reading the code (fix them in Phase 0):
  1. **Reviewer role mismatch.** Reviewers are *notified* by `MISSION_REVIEWER_ROLE_IDS` (DPR, Pizza Capo, Pepperoni Mafia). But `/api/missions/review` and `/api/missions/pending` only allow `ADMIN_ROLE_IDS` (Leonardo). So most people who are pinged to review cannot do it.
  2. **A rejected submission can never be retried.** `submitMissionCompletion` throws `ConflictError` whenever any row exists, because of `@@unique([missionId, discordId])`, even when that row is `REJECTED`.
  3. **The two no-proof auto-verify missions** are described in §5.
  4. **Adding or reactivating a mission in an already-completed level drops members back a level.** `getCurrentLevel()` recomputes from the active missions on every call. The ledger marker means nobody is paid twice, but the UI level regresses. `getCurrentLevel()` also hard-codes `level <= 8`.

---

## 1. Where missions live

| Source | What it holds |
|---|---|
| `prisma/migrations/20260414000000_add_missions` | Schema only (`Mission`, `MissionCompletion`, `MissionStatus`) |
| `scripts/seed-missions.mjs` | **The 12 missions** (inserts only when the table is empty) |
| `e2e/local/seed.mjs` | The first 4 missions, for local e2e |
| Admin UI or sheet | **None** |

The production rows may have been edited by hand since seeding. Before running any data migration, the owner should export them. This plan's migrations key on `(level, index)`, never on `id`.

```bash
psql "$DATABASE_URL" -c "\copy (select id, level, \"index\", title, description, reward, \"levelTitle\", \"autoVerify\", \"isActive\" from \"Mission\" order by level, \"index\") to 'missions.csv' csv header"
```

The data migration in §8 must assert that each `(level, index)` title matches the seed text, and abort when it does not.

Rewards are per level and duplicated on every mission in the level (`Mission.reward`). `checkAndAwardLevelReward` reads `levelMissions[0].reward`.

| Level | Title | Reward (PEP) |
|---|---|---|
| L1 | Pizza Trainee | 69 |
| L2 | Pizza Noob | 420 |
| L3 | (none) | 1,337 |
| L4 | (none) | 3,141 |
| L5 | (none) | 4,269 |
| L6 | Street Muscle | 6,942 |
| L7 | Made Mafia | 31,415 |
| L8 | Don of Dons | 69,420 |

The total for a member who completes everything is **117,013 PEP**.

---

## 2. Mission table

Legend: **A** = automatic, **B** = semi-automatic (proof plus checks plus quick approve), **C** = manual. Effort: S ≤ ½ day, M ≈ 1–2 days, L ≥ 3 days, each including tests.

| # | Mission | Current method | Proposed verifier (`verifierKey` + params) | Data source | Class | Feasibility / effort |
|---|---|---|---|---|---|---|
| L1.0 | Follow @RarePizzas and @Pizza_DAO on X | `autoVerify`, **no proof** | `x_linked` {} — reword the mission to "Link your X account and follow @RarePizzas + @Pizza_DAO". The follow part stays on the honor system. | `XAccount` (by discordId; OAuth-verified) | **A** | **S.** A real follow check needs `GET /2/users/:id/following` or app-bearer reads. Those need the paid X API tier plus the `follows.read` + `offline.access` scopes; today the scope is `tweet.read users.read` and no token is reused. Optional upgrade in Phase 5. |
| L2.0 | Say hi on a community or crew call | manual | `attendance_count` {min:1, crews:"any"} | `CallAttendance` (discordId; community calls use `crewId='community_call'`), `getAttendanceForMember()` | **A** | **S.** Only *presence* is recorded, not "said hi". Attendance sync (`POST /api/attendance/sync`) is **not scheduled anywhere**, so add a cron (§3.4). |
| L2.1 | Post about PizzaDAO (3+ comments, 10+ likes) | manual | `social_post` {minReplies:3, minLikes:10} — proof is a URL | **X:** check the URL format and match the author handle to `XAccount.xUsername`. Engagement metrics need the paid X API tier. **Farcaster:** the Neynar cast lookup (`NEYNAR_API_KEY` already present) returns reactions and replies, so it can be fully automatic. **Anything else:** format check only. | **B** | **M.** X posts without API metrics get a pre-checked card ("handle matches ✔, metrics unchecked") for a one-click approve. |
| L3.0 | Share your community in #show-and-tell | `autoVerify`, **no proof** | `discord_message` {channelId: SHOW_AND_TELL} — the proof is a Discord message link, or the channel is scanned | Bot REST `GET /channels/{c}/messages/{m}` or a paginated `GET /channels/{c}/messages` | **A** | **M.** **This does not need the gateway:** checking the author of one message, or scanning one channel's history, works over REST. `author.id` is returned without the MESSAGE_CONTENT intent. The bot needs View Channel + Read Message History there. Counting messages *across* channels, or live message events, would need the gateway, so that is out of scope. |
| L3.1 | Invite a friend to Discord | manual | `referral` {min:1, qualifyDays:7} | **New** `Referral` table. Filled by (a) a "Who invited you?" step in onboarding, and/or (b) per-member bot-created invite codes. | **A** (needs new capture) | **M.** There is no invite tracking today and no gateway, so REST cannot attribute a join to an invite. A referral qualifies when the invitee is onboarded, still in the guild after N days, has attended at least 1 call, and shares no wallet or X account with the inviter. Past invites cannot be backfilled, so offer a manual fallback for the past. |
| L4.0 | Make a POAP for a community call | manual | `poap_drop` — proof is a POAP drop URL or id | POAP Compass GraphQL (`app/lib/poap.ts`): the drop exists, its name or date matches a community call, and it has ≥ N mints | **B** | **M.** The creator of a drop is not exposed; drop ownership is tied to a private email. The reviewer confirms the creator. This becomes **A** if the POAP whitelist sheet gains a "creator discordId" column. |
| L5.0 | Join three crew calls | manual | `attendance_count` {min:3, crews:"crew", distinct:"call"} | `CallAttendance`, excluding `community_call` | **A** | **S.** Open decision: count 3 calls, or 3 *different crews*? |
| L5.1 | Do a selfie interview | manual | `media_proof` {kinds:["youtube","x","loom","drive","blob-video"]} | URL allowlist plus an oEmbed reachability check. Optional Vercel Blob **client** upload for video; the current upload routes are images-only and limited to 5 MB. | **B** | **S** for the link plus quick approve. **M** to add video upload. |
| L6.0 | Join Pepperoni Mafia | manual | `discord_role` {roleIds:["823266914834841610"]} | `hasAnyRole()` / `lookupGuildMembership()`, the bulk `getMembersWithRoles()`, and the interaction payload's `member.roles` | **A** | **S.** The role is granted by a human, so that grant is the real gate. Stateful: losing the role later leads to a flag (§3.6). |
| L6.1 | Onboard a Bitcoin Pizza Day city | manual | `gpp_host` {eventType:"gpp", statuses:["approved","listed"]} — proof is an rsv.pizza event URL | rsv-pizza public `GET /api/gpp/events` (`underbossStatus` plus host `user.telegram`). Match the host's Telegram to the member's `TelegramAccount.username`. | **B** now, **A** later | **M.** rsv-pizza has **no Discord ids** and no cross-user lookup. Its API keys are tenant-scoped. Full automation needs a new service-to-service endpoint in rsv-pizza (§9, Phase 5), keyed by email or wallet. |
| L7.0 | Become a Crew Leader | manual | `discord_role` {roleIds:[CREW_LEADER]}, *if* such a role or sheet column is created; otherwise `manual` | No crew-leader role id or roster "leader" column exists today. Task-row "Lead ID" is a task owner, not a crew lead. | **C** (→ A) | **S** once the owner picks the source of truth. Until then it stays manual and admin-only. |
| L8.0 | Called upon by Dread Pizza Roberts | manual | `manual` {reviewerRoleIds:["812131585327235113"]} | Human; DPR only | **C** | **S.** Restrict who can approve it to the DPR role. |

### Data sources that no current mission uses

These are cheap verifiers to have in the registry for future missions, so new missions can be added by data rather than code:

| Data | Verifier | Source |
|---|---|---|
| Wallet connected | `wallet_connected` | `MemberWallet` / `getAllWalletsForMember` (not signature-verified) |
| NFT held | `nft_held {contractName, min}` | `fetchPizzaDAONFTs` (Alchemy, 2h KV cache), contracts from the nft-config sheet |
| POAPs held | `poaps_held {min, eventIds?}` | `fetchFilteredPOAPs` (KV cached, may be stale) |
| Profile complete | `profile_complete` | `getProfileCompletion` (crew + wallet + X) |
| Crew joined | `crew_joined {crewId?}` | Members sheet "Crews" column |
| Telegram linked | `telegram_linked` | `TelegramAccount` |
| Vouches | `vouches {given?, received?}` | `getVouchCounts(memberId)` |
| Article published | `article_published` | `Article` status PUBLISHED, by authorId |
| Bounties | `bounties_completed {min}` | `Bounty` claimedBy plus COMPLETED |
| Tasks | `tasks {claimed?, done?}` | `TaskClaimEvent`; `doneCount` comes from the sheet's "Closed" column and is sheet-maintained |
| PEP activity | `pep_activity {type, min}` | `Transaction` |
| GPP ticket held | `gpp_ticket` | `UnlockTicketClaim` / `findTicketsForWallet` |

**Not feasible without the gateway:** "N messages in channel X" or live message tracking. The `DiscordActivity` model exists but nothing writes to it.

---

## 3. Verification framework

### 3.1 Schema additions (see §8 for the migration)

```prisma
model Mission {
  // ...existing
  verifierKey     String?   // registry key, e.g. "discord_role"; null = manual
  verifierParams  Json?     // validated by the verifier's zod schema
  proofKind       ProofKind @default(NONE) // what the submit form asks for
  reviewerRoleIds String[]  @default([])   // override who may approve (L8 = DPR)
  // autoVerify: kept for one release, then dropped (replaced by verifierKey)
}

enum ProofKind { NONE URL DISCORD_MESSAGE UPLOAD }

model MissionCompletion {
  // ...existing
  source        CompletionSource @default(MANUAL) // MANUAL | AUTO | SEMI
  checkResult   Json?     // snapshot of what the verifier saw (handle, roleIds, counts, url meta)
  attempts      Int       @default(1)
  flaggedAt     DateTime? // state lost later (role removed, NFT sold) - never auto-revoked
  flagReason    String?
  reviewMsgId   String?   // Discord review-channel message, edited on decision
  updatedAt     DateTime  @updatedAt
  events        MissionReviewEvent[]
}

model MissionReviewEvent {   // audit trail (append-only)
  id           Int      @id @default(autoincrement())
  completionId Int
  actorId      String   // discordId, or "auto:<verifierKey>", or "system:backfill"
  action       ReviewAction // SUBMITTED RESUBMITTED AUTO_APPROVED APPROVED REJECTED FLAGGED UNFLAGGED NOTE
  via          String   // web | discord | cron | event | backfill | on_demand
  note         String?
  metadata     Json?
  createdAt    DateTime @default(now())
  completion   MissionCompletion @relation(fields: [completionId], references: [id])
  @@index([completionId])
  @@index([actorId, createdAt])
}

model Referral {
  id               Int       @id @default(autoincrement())
  inviteeDiscordId String    @unique   // one inviter per invitee
  inviterDiscordId String
  via              String    // onboarding | invite_code
  inviteCode       String?
  createdAt        DateTime  @default(now())
  qualifiedAt      DateTime? // set by the referral verifier once rules pass
  @@index([inviterDiscordId])
}

model VerifierRun {         // cron / backfill bookkeeping and dry-run reports
  id         Int      @id @default(autoincrement())
  kind       String   // nightly | backfill | event
  dryRun     Boolean
  startedAt  DateTime @default(now())
  finishedAt DateTime?
  cursor     String?  // resume point (last discordId processed)
  stats      Json?    // { checked, approved, levelsPaid, pepPaid, flagged, errors }
}
```

Also add the `NotificationType` value `MISSION_FLAGGED` (admin-facing). Optionally add a `VerifierCursor` key/value row for the `#show-and-tell` scan position.

### 3.2 Verifier contract

```ts
// app/lib/missions/verifiers/types.ts
export type Trigger = 'on_demand' | 'event' | 'cron' | 'backfill' | 'submit'

export interface VerifyCtx {
  discordId: string
  memberId: string | null         // resolved once via fetchMemberIdByDiscordId
  trigger: Trigger
  dryRun: boolean
  now: Date
  memo: Map<string, unknown>      // per-run cache (guild member, attendance summary...)
  interactionRoles?: string[]     // free, fresh roles when called from a Discord interaction
}

export type VerifyResult =
  | { status: 'pass'; evidence: Record<string, unknown> }          // -> APPROVED
  | { status: 'fail'; reason: string; progress?: { have: number; need: number }; hint?: string }
  | { status: 'needs_review'; evidence: Record<string, unknown>; checks: Check[] } // semi: PENDING with pre-checks
  | { status: 'unknown'; reason: string }                           // upstream down: NO write

export interface Verifier<P = unknown> {
  key: string
  mode: 'auto' | 'semi' | 'manual'
  params: z.ZodType<P>
  proof?: z.ZodType<string>                 // for semi verifiers / message link
  stateful: boolean                         // can a pass later become false? (roles, NFTs)
  events: MissionEvent[]                    // which hooks re-run it
  check(ctx: VerifyCtx, params: P, proof?: string): Promise<VerifyResult>
  // optional bulk path for cron/backfill: one upstream call for everyone
  checkMany?(ctxs: VerifyCtx[], params: P): Promise<Map<string, VerifyResult>>
}

export type MissionEvent =
  | 'x_linked' | 'telegram_linked' | 'wallet_connected' | 'crew_joined'
  | 'attendance_synced' | 'roles_synced' | 'onboarded' | 'referral_created'

// app/lib/missions/verifiers/index.ts
export const VERIFIERS: Record<string, Verifier<any>> = {
  x_linked, attendance_count, discord_role, discord_message, referral,
  social_post, poap_drop, media_proof, gpp_host, manual,
  // catalog: wallet_connected, nft_held, poaps_held, profile_complete, crew_joined, ...
}
```

Each verifier gets unit tests with injected data sources, following the same style as `discord-interactions/handle.ts` (`HandlerDeps`).

### 3.3 Engine (idempotent)

```ts
// app/lib/missions/engine.ts
export async function runVerifiers(discordId: string, opts: {
  trigger: Trigger; dryRun?: boolean; missionIds?: number[]; event?: MissionEvent
}): Promise<RunReport> {
  const missions = await activeMissionsWithVerifier(opts)           // filter by event if given
  const existing = byMissionId(await prisma.missionCompletion.findMany({ where: { discordId } }))
  const ctx = await makeCtx(discordId, opts)
  const report: RunReport = { results: [], approved: [], levelsPaid: [] }

  for (const m of missions) {
    const v = VERIFIERS[m.verifierKey!]; if (!v || v.mode === 'manual') continue
    const prev = existing.get(m.id)
    if (prev?.status === 'APPROVED') {                                  // idempotent no-op...
      if (v.stateful && opts.trigger === 'cron') await recheckForFlag(prev, v, m, ctx) // ...except flagging
      continue
    }
    if (prev?.status === 'REJECTED' && isHumanReviewer(prev.reviewedBy)) {
      continue  // a human said no: an auto pass never overrides it; it goes back to the queue (see 4.4)
    }
    const r = await v.check(ctx, v.params.parse(m.verifierParams ?? {}))
    report.results.push({ missionId: m.id, ...r })
    if (r.status !== 'pass' || opts.dryRun) continue

    await approveAuto(m, discordId, ctx.memberId, v.key, r.evidence, opts.trigger)
    report.approved.push(m.id)
  }
  if (!opts.dryRun && report.approved.length) {
    report.levelsPaid = await settleLevels(discordId)
    invalidateProgressCache(discordId)
  }
  return report
}

async function approveAuto(m, discordId, memberId, key, evidence, via) {
  const data = { status: 'APPROVED', source: 'AUTO', reviewedBy: `auto:${key}`, reviewedAt: new Date(), checkResult: evidence }
  try {
    // no row -> create APPROVED (unique [missionId, discordId] makes the race safe)
    const c = await prisma.missionCompletion.create({ data: { missionId: m.id, discordId, memberId, ...data } })
    await audit(c.id, `auto:${key}`, 'AUTO_APPROVED', via, evidence)
  } catch (e) {
    if (code(e) !== 'P2002') throw e
    // row exists: only PENDING -> APPROVED, conditional (same pattern as approveMission)
    const n = await prisma.missionCompletion.updateMany({ where: { missionId: m.id, discordId, status: 'PENDING' }, data })
    if (n.count === 1) await audit(/*id*/, `auto:${key}`, 'AUTO_APPROVED', via, evidence)
    // count 0 => someone else approved/rejected concurrently: no-op
  }
}
```

**Ordered settlement.** A wrapper around the existing race-safe function:

```ts
// Pays every fully-complete level in order, stopping at the first incomplete one.
// Each payment is checkAndAwardLevelReward(discordId, level): wallet row lock +
// MISSION_REWARD ledger marker => exactly-once per level (PR #133).
export async function settleLevels(discordId: string): Promise<number[]> {
  const paid: number[] = []
  for (const level of await activeLevels()) {              // not hard-coded 1..8
    if (!(await isLevelComplete(discordId, level))) break
    if (await checkAndAwardLevelReward(discordId, level)) paid.push(level)
  }
  return paid
}
```

- `approveMission` (human) and the submit path call `settleLevels` instead of `checkAndAwardLevelReward(level)`. This lets a human approval of L2 cascade into a level that was already banked.
- **Banking:** verifiers may approve missions *above* the member's current level. For example, a Pepperoni Mafia member gets L6.0 approved immediately. The reward for a level is only paid when all lower levels are complete (owner decision D5).
- The manual submit path keeps the existing "finish level N first" gate. Auto-approvals ignore that gate because they do not need member effort.

### 3.4 Triggers

| Trigger | Where | Notes |
|---|---|---|
| **"Check my progress"** button on /missions | `POST /api/missions/check` (session plus `requireOnboarded`) | Rate limited (§5.3). Returns per-mission results with `progress` (e.g. "2/3 crew calls") and `hint` (e.g. "Link X in your profile"). The response feeds straight into the celebration logic. |
| **`/missions`** Discord command | `discord-interactions/commands.ts` + `handle.ts` | Ephemeral. Uses a **deferred** reply (type 5), then edits `@original` via the webhook from `after()`, because checks can exceed Discord's 3-second limit. Passes `interaction.member.roles` as `interactionRoles`, which is a free and fresh role check. It replies with level, PEP earned, and per-mission ✔/✖ plus hints. Add an optional `member:` argument for admins. |
| **Submit** | `submitMissionCompletion` | Missions with a `verifierKey` run the verifier on submit. `pass` gives APPROVED. `needs_review` gives PENDING with `checkResult`. `fail` gives a 422 with the hint and **writes no row**, so the member can try again. A missing verifier means plain PENDING. The client never chooses the status. |
| **Events** | `emitMissionEvent(discordId, event)` → `runVerifiers({ trigger:'event', event })` via `after()` | `x_linked`: `/api/x/callback`. `telegram_linked`: telegram account route. `wallet_connected`: `/api/wallet` POST. `crew_joined`: `/api/join-crew`. `roles_synced`: `syncDiscordRolesToSheet` (login). `onboarded` and `referral_created`: onboarding completion. `attendance_synced`: at the end of `syncAllCrewAttendance()`, for each discordId that gained rows. |
| **Nightly cron** | `GET /api/cron/missions` (Bearer `CRON_SECRET`) | No crons exist yet (there is no `vercel.json`). Add `vercel.json` `crons`: attendance sync at 05:00 UTC, then missions at 05:30 UTC. Uses each verifier's `checkMany` bulk paths: one `getMembersWithRoles` call, one `CallAttendance` groupBy, one `XAccount` findMany, and so on. Time-boxed with a `VerifierRun.cursor` so it can resume across invocations. |

### 3.5 Where the identity comes from

The engine keys on **discordId** because `MissionCompletion`, `Economy` and `Transaction` are discordId-keyed. Verifiers that need a memberId (wallets, vouches, tasks, profile) use `ctx.memberId`. It is resolved once per run; the cron uses `getSheetData()` once for the whole batch. When `memberId` is null, those verifiers return `fail`, and the hint says "finish onboarding".

### 3.6 Data that changes later (never claw back)

- Stateful verifiers are `discord_role` and the catalog's `nft_held` / `poaps_held` / `wallet_connected` / `crew_joined`. The cron re-checks their APPROVED rows. If a check now fails, it sets `flaggedAt` / `flagReason`, writes a `FLAGGED` audit event, and posts once to the admin review channel.
- **No status change and no PEP debit.**
- An admin can then:
  - *unflag* the completion;
  - *note* it;
  - in a clear-fraud case, use `/remove-money` by hand, which is already audited to `PEP_ADMIN_LOG_CHANNEL_ID`.
- If a later check passes again, the engine auto-unflags.
- `unknown` results (Discord, Alchemy or Sheets down) never flag anything.
- **Already-paid levels are permanent.** The level shown in the UI should come from **paid levels** (the ledger) when it is higher than the computed level. This also fixes bug 4 in §0, the regression when a mission is added to an old level.

---

## 4. Reward flow, notifications, celebration

### 4.1 Per-level vs per-mission: keep per-level (recommended)

- The current curve (69 → 69,420) is already tuned as a ladder. Per-mission PEP would either have to split each level's reward, which makes the 2-mission levels feel cheaper, or add new emission.
- Per-mission PEP would also reward farming the cheap auto missions out of order.
- The level is already the unit of celebration (LevelUpModal, `LEVEL_COMPLETED`) and of the exactly-once ledger marker (`metadata.level`). No ledger change is needed.
- Optional low-risk extra: show per-mission *progress* in the UI (✔ chips, "2/3 calls") with no PEP attached.
- Optional cleanup (not required): move `reward` and `levelTitle` into a `MissionLevel` table, so they stop being duplicated on every mission and mismatches like `levelMissions[0].reward` disappear.

### 4.2 Notifications

| Event | In-app (`createNotification`) | Discord |
|---|---|---|
| Mission auto-approved | `MISSION_APPROVED`, actor `auto:<key>`, "Verified automatically" | none (too noisy) |
| Level paid | `LEVEL_COMPLETED` (exists) | A **DM** via `sendDM()` ("🍕 Level 3 complete, +1,337 $PEP"). If the result is `dms_disabled`, fall back to a public post. **Public post** in `MISSIONS_ANNOUNCE_CHANNEL_ID` for L3+ only, via `postDiscordMessage`, with a Pepperoni Bot embed. Use `allowed_mentions` for the member only. |
| Submission needs review | `MISSION_SUBMITTED` (exists; fix recipients, §5.1) | A review-channel card (§5.2) |
| Flagged | `MISSION_FLAGGED` to reviewers | One review-channel post |
| Backfill | In-app only | **No DM blast.** One summary post in the admin log channel. |

All Discord sends run in `after()` and are best-effort. A failure is logged and never blocks the approval.

### 4.3 Celebration hooks

- `MissionsClient.maybeTriggerCelebration` only fires a level-up when `justGainedAnApproval` happens *within the session*. Background approvals (cron, event, Discord) therefore produce **no modal** today.
- Fix: on the initial load, fire `levelUp` when `currentLevel > celebrationState.lastCelebratedLevel`. The server-persisted `lastCelebratedLevel` already prevents replays.
- For multi-level jumps (backfill, banking), show **one** LevelUpModal with the levels gained and the total PEP. Pass `levels: number[]` and `reward: sum`, not one modal per level.
- The "Check my progress" response returns `{ approved, levelsPaid }`. The client then refetches `/api/missions`, and the existing confetti → `LevelUpModal` → `VouchPromptCard` flow runs.
- In Discord, the `/missions` reply for a newly paid level uses a celebratory embed: the green success tone that `embeds.ts` already provides.

### 4.4 Rejected, then auto-pass later

If a human REJECTED a mission and its verifier later passes, the engine does **not** override the rejection. It moves the row back to PENDING with a note ("verifier now passes: …"), so a human decides again.

---

## 5. Manual review improvements

### 5.1 Fix permissions first (Phase 0)

- Add one helper, `canReviewMission(discordId, mission)`:
  - **Default:** holders of `ADMIN_ROLE_IDS ∪ MISSION_REVIEWER_ROLE_IDS`.
  - **Override:** when `mission.reviewerRoleIds` is set, only those roles may approve (L8 = DPR; L7 = Leonardo + DPR).
  - **Never** your own submission.
- Use it in `/api/missions/review`, `/api/missions/pending`, `session.isAdmin → canReview`, and the Discord buttons.
- **Resubmission:** a `REJECTED` row can move back to `PENDING`, keeping the same row and unique key.
  - It replaces the evidence and increments `attempts`, with a cap of 3.
  - It writes a `RESUBMITTED` audit event.
  - Use a conditional `updateMany where status = 'REJECTED'`.

### 5.2 Discord review queue (Pepperoni Bot)

- On every new PENDING row (submit, resubmit, or auto-to-review), post an embed to `MISSION_REVIEW_CHANNEL_ID`. It shows:
  - the member, the mission, the evidence link, and `checkResult` as ✔/✖ lines (for example "handle matches @x ✔", "drop 12345 exists ✔, 41 mints");
  - the submission age.
- Buttons: `mr:approve:<completionId>`, `mr:reject:<completionId>` and an "Open in app" link.
- Store `reviewMsgId` on the completion.
- `postDiscordMessage`'s `DiscordMessageBody` must gain `embeds` and `components`; today it only has `content`.
- **Approve click:**
  - Gate with `canReviewMission` using `interaction.member.roles`.
  - Respond with `DEFERRED_UPDATE_MESSAGE` (type 6), then call `approveMission` (race-safe; returns 409 if already reviewed).
  - Edit the card to "✅ Approved by @reviewer" and disable the buttons.
- **Reject click:** open a **modal** (response type 9) asking for a reason, with a 3-character minimum. The modal submit (interaction type 5, `MODAL_SUBMIT`, which needs adding to `InteractionType`) calls `rejectMission`.
- **Web decisions** also edit the Discord card (via `reviewMsgId`), so both queues stay in sync.
- The route already uses `after()` for admin log posts; reuse that.

### 5.3 SLA and hygiene

- **Targets** (owner to confirm, D13):
  - L1–L3: first decision within 24 hours.
  - L4–L6: within 48 hours.
  - L7–L8: within 7 days.
- **Daily digest** (cron, 15:00 UTC) in the review channel: the count pending, the oldest item, and anything past its SLA. Ping `@Pizza Capo` for items more than 2× over the SLA.
- **Web panel (`MissionReviewPanel`):**
  - filters by level and by "checks all green";
  - embedded proof previews (tweet or cast embeds, image thumbnails, POAP drop cards);
  - **bulk approve** for semi items whose checks are all green;
  - each item's audit history.
- **Reviewer audit trail:** every decision writes a `MissionReviewEvent` (actor, via web or discord, note). Add a simple "reviews by person, last 30 days" table so the owner can spot rubber-stamping.

---

## 6. Abuse prevention

### 6.1 Missions that auto-verify without proof

- **L1.0:** replace with `x_linked`, which is OAuth-verified. `XAccount.xId` is globally unique, so one X account maps to one Discord account.
- **L3.0:** replace with `discord_message`. The member pastes a message link, or the cron finds their post. The bot confirms `author.id === discordId` and the channel id.
- Keep `autoVerify` working for one release, but the submit path ignores it for any mission that has a `verifierKey`. Drop the column in Phase 2.
- Existing `reviewedBy = 'auto'` approvals are grandfathered (D6). The backfill re-runs the new verifiers on them in dry-run mode and reports how many would fail, for information only.

### 6.2 Duplicate accounts

The economic unit is the discordId. Signals to compute in the cron, surfaced as flags rather than blocks:

- **Same wallet on more than one memberId:** `MemberWallet` groupBy `walletAddress` having `count(distinct memberId) > 1`.
- **Discord account age:** derived from the snowflake (`id >> 22`, plus the epoch). Accounts younger than 30 days do not get **L3+** rewards paid automatically; the completion goes to "auto-verified, awaiting release" (D9).
- **Referrals:** the invitee must not share a wallet, X or Telegram account with the inviter. The invitee's account must be at least 7 days old and still in the guild, and must have attended at least 1 call. Credit is capped at one qualifying referral per mission, since the mission needs only one.
- **Sheet duplicates:** `buildIndex` silently keeps only the last row per discordId. The cron logs discordIds that appear on more than one row.
- Optional, high level: **human release for L6+** (6,942 PEP and up), even when the verifiers pass (D9). L6.0 and L7.0 are human-granted roles anyway.

### 6.3 Rate limits (`app/lib/rate-limit.ts`, Upstash)

| Action | Limit |
|---|---|
| `POST /api/missions/check` | 1 per 30 s and 30 per day per discordId (also protects Discord, Alchemy and Compass quotas) |
| `/missions` Discord command | 1 per 60 s per user |
| Submit / resubmit | 10 per hour per discordId; at most 3 attempts per mission |
| Evidence | URL ≤ 500 characters, https only, a per-verifier domain allowlist. Uploads go through Blob with `sniffImageFile` and a per-user quota. |
| Kill switches | `MISSIONS_AUTOVERIFY_ENABLED=0` stops the engine and leaves manual review working. A cron run paying more than `MISSIONS_RUN_PEP_ALERT` (for example 50k) posts an alert to the admin log channel. |

---

## 7. Backfill

1. **Dry run.** Use `POST /api/admin/missions/backfill?dryRun=1`, gated on Leonardo or `CRON_SECRET`. It runs in production with production env, so nobody needs local secrets or a direct DB connection. It is time-boxed and cursor-resumable through `VerifierRun`. Output is a JSON or CSV report, stored on the `VerifierRun`:
   - per member: missions that would approve, levels that would pay, and PEP;
   - totals by level and grand total PEP;
   - grandfathered `'auto'` rows that the new verifiers would fail;
   - duplicate-account signals.
2. **Owner review.** The owner checks the totals and the list of the top 20 recipients.
3. **Apply** in batches of 200 discordIds. The run is idempotent and can be re-run safely, because existing APPROVED rows are skipped and the ledger marker guarantees each level is paid once.
   - **Past levels:** members who now qualify for past levels **are paid** through `settleLevels`, in order and exactly once.
   - Notifications are in-app only, plus one summary post. No DMs.
4. **Expected exposure is bounded:**
   - Level 2 needs L2.1 (a semi mission), and L3.1 referrals cannot be backfilled.
   - So the backfill realistically pays **L1 (69 PEP) to members with a linked X account**, plus any member whose remaining L2+ missions were already approved by hand.
   - Missions that are auto-approved above the first incomplete level are banked, not paid.
   - Ceiling ≈ `count(XAccount) × 69` + the existing near-complete levels. The dry run gives the exact number.
5. The owner can ask the dry run for a per-member cap (`maxLevel`), for example "backfill pays at most L2".

---

## 8. Rollout phases

| Phase | Scope | Effort |
|---|---|---|
| **0 — Quick fixes** | Unify reviewer roles (`canReviewMission`); allow resubmission after rejection; L1.0 submit requires a linked X account; L3.0 becomes PENDING with a message link until Phase 1. Settle levels in order and fix the `<= 8` hard-code. | **S–M** (~1 day) |
| **1 — Framework + core verifiers** | Migration A (below). Registry, engine, `settleLevels`, audit events. Verifiers `x_linked`, `attendance_count`, `discord_role`, `discord_message`, `manual`. `POST /api/missions/check` and the "Check my progress" button with progress hints. Event hooks (X callback, role sync, attendance sync, wallet, crew join). Celebration fix (§4.3). In-app plus DM notifications. Data migration to set `verifierKey`/`params` keyed by `(level, index)` with title assertions. Tests (unit plus `pep-economy.concurrency` style). | **L** (~4–5 days) |
| **2 — Cron + backfill + flags** | `vercel.json` crons (attendance sync, missions nightly, SLA digest). Bulk `checkMany` paths. `VerifierRun`. Backfill dry run, then apply. Stateful re-check plus flagging. Duplicate signals. Drop `autoVerify` (Migration B). | **M** (~2–3 days) |
| **3 — Discord** | `/missions` command (deferred reply). Review channel cards with Approve/Reject buttons plus the reject modal, two-way sync with the web. Level-up channel posts. Register commands via `scripts/discord/register-commands.mjs`. | **M** (~3 days) |
| **4 — Semi verifiers + referral** | `social_post` (X handle match, Farcaster via Neynar), `poap_drop`, `media_proof` (link, optional Blob client upload), `gpp_host` (rsv.pizza public GPP API plus Telegram match). `Referral` capture (onboarding step and/or bot invite codes) and the `referral` verifier. Review panel previews and bulk approve. | **M–L** (~4–5 days) |
| **5 — Optional upgrades** | rsv-pizza service endpoint (`GET /api/integrations/participation?email|wallet`, `x-api-key` shared secret, following the telegram-link-callback pattern) to make L6.1 automatic. Paid X API for a real follow check (L1.0) and post metrics (L2.1). A crew-leader role or sheet column to make L7.0 automatic. A POAP whitelist "creator" column to make L4.0 automatic. `MissionLevel` table. | **L** (cross-repo; and spend) |

**Migration A** (additive, safe to deploy before the code):

```sql
CREATE TYPE "ProofKind" AS ENUM ('NONE','URL','DISCORD_MESSAGE','UPLOAD');
CREATE TYPE "CompletionSource" AS ENUM ('MANUAL','AUTO','SEMI');
CREATE TYPE "ReviewAction" AS ENUM ('SUBMITTED','RESUBMITTED','AUTO_APPROVED','APPROVED','REJECTED','FLAGGED','UNFLAGGED','NOTE');
ALTER TYPE "NotificationType" ADD VALUE 'MISSION_FLAGGED';
ALTER TABLE "Mission" ADD COLUMN "verifierKey" TEXT, ADD COLUMN "verifierParams" JSONB,
  ADD COLUMN "proofKind" "ProofKind" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "reviewerRoleIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "MissionCompletion" ADD COLUMN "source" "CompletionSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "checkResult" JSONB, ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "flaggedAt" TIMESTAMP(3), ADD COLUMN "flagReason" TEXT, ADD COLUMN "reviewMsgId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "MissionCompletion" SET "source"='AUTO' WHERE "reviewedBy"='auto';
-- CREATE TABLE "MissionReviewEvent", "Referral", "VerifierRun" (per §3.1) + indexes
```

**Data migration** (separate, run after the owner checks the export):

```sql
-- assert titles first; abort if any (level,index) title differs from the seed
UPDATE "Mission" SET "verifierKey"='x_linked', "autoVerify"=false WHERE level=1 AND "index"=0;
UPDATE "Mission" SET "verifierKey"='attendance_count', "verifierParams"='{"min":1,"crews":"any"}' WHERE level=2 AND "index"=0;
UPDATE "Mission" SET "verifierKey"='social_post', "proofKind"='URL', "verifierParams"='{"minReplies":3,"minLikes":10}' WHERE level=2 AND "index"=1;
UPDATE "Mission" SET "verifierKey"='discord_message', "proofKind"='DISCORD_MESSAGE', "autoVerify"=false WHERE level=3 AND "index"=0; -- channelId param set from env/owner
UPDATE "Mission" SET "verifierKey"='referral', "verifierParams"='{"min":1,"qualifyDays":7}' WHERE level=3 AND "index"=1;
UPDATE "Mission" SET "verifierKey"='poap_drop', "proofKind"='URL' WHERE level=4 AND "index"=0;
UPDATE "Mission" SET "verifierKey"='attendance_count', "verifierParams"='{"min":3,"crews":"crew","distinct":"call"}' WHERE level=5 AND "index"=0;
UPDATE "Mission" SET "verifierKey"='media_proof', "proofKind"='URL' WHERE level=5 AND "index"=1;
UPDATE "Mission" SET "verifierKey"='discord_role', "verifierParams"='{"roleIds":["823266914834841610"]}' WHERE level=6 AND "index"=0;
UPDATE "Mission" SET "verifierKey"='gpp_host', "proofKind"='URL', "verifierParams"='{"eventType":"gpp","statuses":["approved","listed"]}' WHERE level=6 AND "index"=1;
UPDATE "Mission" SET "verifierKey"='manual', "reviewerRoleIds"='{815269418305191946,812131585327235113}' WHERE level=7 AND "index"=0;
UPDATE "Mission" SET "verifierKey"='manual', "reviewerRoleIds"='{812131585327235113}' WHERE level=8 AND "index"=0;
```

Update `scripts/seed-missions.mjs` and `e2e/local/seed.mjs` to match.

**Migration B** (Phase 2, after one release): `ALTER TABLE "Mission" DROP COLUMN "autoVerify"`. Remove the remaining `autoVerify` references in `MissionCard`, `missions-overview` and the API routes. The UI uses `proofKind` and `verifierKey` instead.

New env and config:

- `MISSION_REVIEW_CHANNEL_ID`
- `MISSIONS_ANNOUNCE_CHANNEL_ID`
- `SHOW_AND_TELL_CHANNEL_ID`
- `MISSIONS_AUTOVERIFY_ENABLED`
- `MISSIONS_RUN_PEP_ALERT`
- `CRON_SECRET` (exists)
- later, `RSV_PIZZA_API_URL` and `RSV_PIZZA_API_SECRET`

The bot needs Read Message History in #show-and-tell, Send Messages and Embed Links in the review and announce channels, and Create Invite if D4 chooses invite codes.

---

## 9. Decisions needed from the owner

1. **L1.0 follow on X:** reword to "Link your X account (and follow…)" with the follow on the honor system (recommended)? Or pay for the X API tier for a real follow check, adding the `follows.read` and `offline.access` scopes? Or require a screenshot (semi)?
2. **L2.0:** is attendance on any community or crew call an acceptable proxy for "say hi"?
3. **L5.0:** does it mean 3 crew calls in total, or 3 *different* crews? Do community calls count?
4. **L3.1 referral mechanism:** a "Who invited you?" onboarding step, bot-generated personal invite links, or both? Which qualification rules apply (account age, days in the guild, ≥ 1 call)? And should **past** invites get a manual path?
5. **Banking and ordering:** can auto-verifiers approve missions above a member's current level, with PEP paid in order once lower levels are complete (recommended)? Or should they only verify the current level?
6. **Grandfathering:** keep the existing no-proof `'auto'` approvals for L1.0 and L3.0 (recommended), or re-verify them and flag?
7. **Backfill:** pay newly qualifying past levels (recommended, after a dry run)? Should there be a per-run PEP cap or a maximum level?
8. **Rewards:** keep per-level only (recommended), or add per-mission PEP?
9. **High-value release:** require a human "release" for L6+ payouts, or for any auto-pay to Discord accounts younger than 30 days, even when the verifiers pass?
10. **Reviewers:** who may approve which levels? Proposed: the union of Leonardo, DPR, Pizza Capo and Pepperoni Mafia; L7 for Leonardo and DPR only; L8 for DPR only.
11. **Discord surfaces:** the review channel and announce channel ids. DMs on level-up: yes or no? Public posts from which level up?
12. **Crew leader source of truth (L7.0):** a new Discord role, a roster sheet column, or keep it manual?
13. **SLA targets:** 24 hours for L1–3, 48 hours for L4–6, 7 days for L7–8. Who gets escalation pings?
14. **L6.1 / rsv-pizza:**
    - Build the service endpoint in rsv-pizza (Phase 5), keyed by email or wallet? rsv-pizza has no Discord ids, and pizzadao-org has no verified member email in the DB.
    - Or settle for proof URL plus Telegram match?
    - What counts as "onboarded a city": an approved or listed GPP host for the current series?
15. **L2.1 platforms:** X only, or also Farcaster (auto via Neynar) and others such as Instagram or LinkedIn (manual)? Should reviewers enforce "3 comments / 10 likes" by eye when the API cannot?
16. **L5.1 video:** links only, or also direct uploads (Vercel Blob storage cost)?
17. **Flag handling:** confirm "flag, never claw back". Should a flag also freeze *future* level payouts for that member until it is reviewed?
