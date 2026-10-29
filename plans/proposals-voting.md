# Proposals and voting in the app

Status: plan only (no code changed). Written 2026-10-29.

## Goal

Move PizzaDAO proposal voting from Sesh polls in the Discord #proposals channel into the app, so that
a proposal, its vote, its result and the payment it funds live in one place, while Discord keeps the
announcements (and can still be used to cast votes). Run both venues in parallel for a while, then
retire Sesh for new proposals.

How it works today (from the public proposal guide, PizzaDAO/proposalguide, https://propose.pizzadao.xyz):

- Only PizzaDAO NFT holders submit proposals. Anyone else needs a holder to sponsor them.
- The proposer creates a Sesh poll in #proposals. Options are Aye / Nay / Abstain, single vote, **Anonymous**,
  ends "In 7 Days". Role restriction: **Box Mafia** and **Pizza Mafia** (NFT holder roles). The
  Super Voter role is pinged.
- Template fields: Event, Member, Proposal Sponsor, Location, Date, Comp/Cost, Estimated Attendance,
  Other Confirmed Event Sponsors, Ordering Pizza From, Description & How This Benefits PizzaDAO,
  Budget Breakdown, "Ayes + Abstains Needed".
- Needed: **ayes + abstains** of 15 (<= $625), 25 ($625 to $2,500), 35 (> $2,500). There is no nay rule
  and no separate quorum.

---

## Part 1: what was already built

### F1. Blind-signature anonymous polls: on `main`, live code, unused and unlinked

| | |
|---|---|
| Where | `app/vote/[pollId]/page.tsx`, `components/AnonymousVote.tsx`, `app/admin/polls/page.tsx` (+ `layout.tsx`), `app/api/polls/route.ts`, `app/api/polls/[pollId]/{route,status/route,sign/route}.ts`, `app/api/vote/anonymous/route.ts`, `app/api/voting-pubkey/route.ts`, `utils/blindRsa.ts`, `utils/blindRsa.client.ts`, `utils/voteToken.ts` (+ test) |
| Schema | `Poll`, `PollStatus` (DRAFT/OPEN/CLOSED), `PendingSignature`, `PollResult`, `ConsumedToken` in `prisma/schema.prisma` (lines ~132-187), created by the very first migration `20260109105456_init` |
| Docs | `docs/VOTING_SETUP.md`, `docs/anon-voting-implementation.md` (moved from the repo root/app by the cleanup commit 7bcf77c, PR #117) |
| History | Built 2026-01-09 ("first push", "Fix blind RSA implementation to use Web Crypto API", branch `feature/anon-voting` merged). Hardened 2026-09-29 in PR #120 (C3: bind vote tokens to the signed prepared message; M6: don't clobber User.roles) and PR #129 (rate limit on `/api/vote/anonymous`). |
| Env | `RSA_PUBLIC_KEY_PEM` and `RSA_PRIVATE_KEY_PEM` are set on Vercel (Production + Preview, added ~293 days ago). |
| State | Merged and deployed, but nothing links to `/vote` or `/admin/polls` (robots.ts disallows `/vote/`). Whether any `Poll` rows exist in production was not checked (no DB access from this session). |

What it does: an admin (ADMIN_ROLE_IDS) creates a poll with a question, options and ONE required
Discord role id, then moves it DRAFT -> OPEN -> CLOSED by hand. A voter's browser blinds a token, the
server blind-signs it after a live role check, and the browser immediately submits the unblinded
token + choice to an unauthenticated endpoint that increments a counter. Results are shown only once
closed.

What is missing or broken:
- **No proposal concepts**: no description/body, amount, proposer, sponsor, template, end time
  (`closesAt`), thresholds, pass/fail outcome, abstain handling, or link to payments.
- **One role only** (`requiredRoleId`), while today's rule is Box Mafia OR Pizza Mafia.
- **Anonymity is mostly cosmetic**: the client asks for the signature and casts the vote in the same
  second from the same browser, so the operator can correlate them by timing. The original design
  (`docs/anon-voting-implementation.md`) called for batch issuance on AWS Lambda to avoid this; that
  was never built (`batchSignedAt` is never set).
- **Lost-vote bug**: the signature is marked claimed before the vote is sent. If the vote request fails
  (network, tab closed), the member can never vote on that poll. Votes can't be changed either.
- No Discord announcement, no result post, no cron, no tests beyond `voteToken.test.ts`, no nav entry.

### F2. Privy + Semaphore (zero-knowledge) governance: branch `origin/feature/governance`, abandoned

| | |
|---|---|
| Where | Remote branch `feature/governance` (head `eaaadde`, 2026-01-12). 5 commits, 2026-01-09 to 2026-01-12: "Phase 1: Add Privy SDK integration for governance", "Phase 2: Add Semaphore protocol for anonymous voting", "Add voting UI ...", "Add Privy + Semaphore anonymous voting system", "Fix Privy SDK v3 API compatibility and prepare for deployment". |
| Contents | 52 files, +18.6k lines (15k of them package-lock): `app/governance/*` (page, admin, PollCard, PollsList, hooks `useSemaphore`), `app/api/governance/{groups,identity,polls,vote,sync-me,verify-pending}`, `lib/semaphore/{group,identity,voting}.ts`, `app/lib/batch-sync.ts`, `app/lib/discord-bot.ts`, `app/lib/privy-server.ts`, test scripts in `scripts/`. Schema: `SemaphoreGroup`, `SemaphoreGroupMember`, `AnonPoll` (has `description`, `closesAt`, `category`), `AnonVoteNullifier` (PENDING/VERIFIED/REJECTED with background proof verification), `AnonPollResult`, `VotingCategory` (TREASURY/TECHNICAL/SOCIAL/GOVERNANCE/ALL), `UserIdentity`. Deps: `@privy-io/react-auth`, `@privy-io/node`, `@semaphore-protocol/*`. |
| State | **Never opened as a PR** (no PR or issue on GitHub mentions governance or Semaphore). **631 commits behind `main`**, pre-dates Prisma 7 / Neon / Next 16 upgrades, would conflict heavily. No migrations committed for its models. |

What is missing: thresholds, abstain rules, proposal template, payments link, Discord posting of
proposals; it also adds a second login system (Privy wallets) next to Discord OAuth.

### F3. Pieces in `main` that a new build can reuse (all merged)

- **Proposal tiers are already DB settings** (PR #209): `payments.voteAyesLow/Mid/High` (15/25/35,
  stricter-only: can only be raised) and `payments.voteMidMaxUsd` (2,500) plus `payments.onApprovalCapUsd`
  (625) in `app/lib/settings/payments-settings.ts`; `requiredAyes()` in `app/lib/payments/lane.ts`.
  Note: the settings and `decide.ts` say "ayes", the old process says "ayes + abstains".
- **Payments VOTE_REQUIRED lane** (PR #209): amount > cap lands in VOTE_REQUIRED; `PaymentRequest.proposalUrl`
  (a free-text Sesh link) is required; the reviewer ticks "proposal passed" and types the aye count
  (`app/lib/payments/decide.ts` ~line 185-194); rule `over_cap_no_vote` in `rules.ts`; ingest
  recognises proposal links (`ingest.ts` line 31). `plans/host-fast-track.md` explicitly left voting
  external ("The app ... does not count votes").
- **Disavow voting** (PR #184, rules in PR #208): `DisavowRound` (OPEN/PASSED/FAILED/CANCELLED,
  `opensAt/closesAt`, rules snapshotted per round: `yesThreshold`, `decisionDays`), `DisavowVote`
  (YES/NO/ABSTAIN/RECUSE, latest vote per voter wins), pure `tallyRound()` in
  `app/lib/disavow/tally.ts` with tests, partial unique index for one open round, cron at
  `app/api/cron/disavow`, event log `DisavowEvent`, access helpers (level 5+ / DPR, `isDisavowSubject`
  lockout).
- **Settings registry** with stricter-only keys, Discord channel/role targets validated against the
  guild (`app/lib/settings/{registry,targets,channels,roles,toggles}.ts`), admin UI at `/admin/settings`.
- **Discord**: `postDiscordMessage` (`app/lib/discord-rest.ts`), interactions endpoint with button
  handling (`app/lib/discord-interactions/handle.ts`, custom ids `mr:` and `bj:` already routed, from
  PR #207), role checks `hasRole`/`hasAnyRole`/`getMembersWithRoles` (`app/lib/discord.ts`),
  `resolveBoxMafiaRoleId` (`app/lib/box-mafia.ts`).
- Levels (`getCurrentLevel` in `app/lib/missions.ts`), DPR check (`isDreadPizzaRoberts`).

### F4. Elsewhere

- `PizzaDAO/proposalguide` (GitHub, last push 2026-04-01, live at propose.pizzadao.xyz): static
  page with the Sesh steps, the template builder and the 15/25/35 table. Not code to reuse, but its
  link must change at cut-over.
- `plans/onboarding-guide.md`: the handbook "Proposals" page (PR 5, setting `guide.proposalTiers`) is
  **blocked on decision D5** ("do proposals run on /vote or a Discord poll?"). This plan unblocks it.
- `rsv-pizza` has unrelated votes (photo votes, payout-document votes for the events team).
- No PizzaDAO Snapshot space exists (checked hub.snapshot.org for `pizzadao.eth`/`rarepizzas.eth`).
- Other PizzaDAO repos (`pizzadao-discord-bot`, `pizza-discord-bots`, etc.) and sibling local repos
  under `~/Code/pizzadao/` have no governance code (grep hits were unrelated uses of "proposal").
- `TASKS.md` has no voting task.

---

## Part 2: options

### (a) Finish the old work

- F1 (blind RSA): would need almost everything a proposal system needs added on top, plus a real fix
  for timing correlation (batch issuance) and the lost-vote bug. Its one distinctive property,
  operator-proof anonymity, is not something today's process has (Sesh's "Anonymous" hides votes
  from members, but the Sesh bot knows who voted), and it makes the payments link, vote changes,
  Discord-button voting and lockouts (disavowed members) much harder.
- F2 (Semaphore): 631 commits stale, adds Privy wallet login and heavy ZK dependencies, no migrations,
  never reviewed. Rebasing is close to rewriting.
- Verdict: **no**. Keep the docs as reference; retire the code.

### (b) Build fresh in the app, reusing what is merged (recommended)

A small `Proposal` + `ProposalVote` model shaped like disavow rounds, tiers from the existing payments
settings, eligibility from Discord roles, Discord embed with Aye/Nay/Abstain buttons through the
existing interactions endpoint, cron to close and settle, and a hard link to `PaymentRequest`.
- Pros: one login (Discord), votes from web or Discord land in one table, payments can verify a
  pass automatically, every rule is a DB setting, the pattern (snapshot rules at open, pure tally,
  cron settle, event log) is already reviewed and tested in disavow.
- Cons: ballots are private-to-the-server, not cryptographically anonymous; we own the code.

### (c) Off-the-shelf tool linked from the app (Snapshot or similar)

- Snapshot needs every voter to connect a wallet and sign; voting power would come from an ERC-721
  strategy on the Rare Pizzas / box contracts. That matches "NFT holders vote" well, but members are
  Discord-first, there is no space yet, levels/roles can't be used, and the app would still only
  store a link (exactly the current Sesh situation, with worse UX).
- Sesh is already an off-the-shelf tool; (c) is effectively the status quo.
- Verdict: only worth it if on-chain/wallet-verified legitimacy becomes a requirement. Not now.

---

## Part 3: recommended design (option b)

### Data model (new migration, additive only)

```
enum ProposalKind   { FUNDING GENERAL }
enum ProposalStatus { DRAFT OPEN PASSED FAILED WITHDRAWN CANCELLED }
enum ProposalChoice { AYE NAY ABSTAIN }

model Proposal {
  id, kind, status, title, body (markdown from the template), amountUsd Decimal?, eventDate?, city?,
  proposerDiscordId, sponsorDiscordId?, sponsorConfirmedAt?,
  opensAt?, closesAt?, closedAt?,
  // rules snapshotted when it opens (as DisavowRound does):
  ayesNeeded Int?, countAbstains Boolean?, requireAyesOverNays Boolean?, voterRoleIds String[],
  ayes Int @default(0), nays Int @default(0), abstains Int @default(0),   // denormalised at settle
  discordChannelId?, discordMessageId?, externalPollUrl? (Sesh link during the parallel period),
  createdAt, updatedAt
  votes ProposalVote[], events ProposalEvent[], payments PaymentRequest[]
}
model ProposalVote  { proposalId, voterDiscordId, choice, source (WEB|DISCORD), createdAt, updatedAt
                      @@unique([proposalId, voterDiscordId]) }   // one row, changeable until close
model ProposalEvent { proposalId, type, actorDiscordId?, detail Json?, createdAt }
PaymentRequest.proposalId String? (FK, optional)  // proposalUrl stays for Sesh links
```

### Rules (DB settings, `/admin/settings`, new "Proposals" group)

| Key | Default | Bounds / direction |
|---|---|---|
| `proposals.enabled` | off | toggle |
| `proposals.voterRoleIds` | Box Mafia + Pizza Mafia role ids | role targets; DPR only; every change logged |
| `proposals.proposerRoleIds` | same as voters | role targets; non-holders need a sponsor from this list |
| `proposals.minLevelToVote` | 0 (off) | 0-10, stricter-only (can only be raised) |
| `proposals.windowDays` | 7 | 5-14; fixed window, no early close |
| `proposals.countAbstains` | 1 (as today) | stricter-only (can be turned off, not back on, from the UI) |
| `proposals.requireAyesOverNays` | see D3 | stricter-only (can be turned on, not off) |
| `proposals.generalAyes` | 15 | threshold for non-funding proposals, stricter-only |
| `proposals.acceptSeshLinks` | 1 | payments still accept a Sesh `proposalUrl`; turned off at cut-over |
| `discord.proposalsChannelId` | #proposals | channel target |
| `discord.proposalsPingRoleId` | Super Voter | role target, optional |

Funding tiers reuse `payments.voteAyesLow/Mid/High` and `payments.voteMidMaxUsd` (one source of truth;
relabel the help text from "external poll" to "proposal"). If D10 says ayes + abstains, rename the labels.
Snapshot the effective rules onto the proposal at open, so later edits never change a running vote.

### Pass rule (pure function `tallyProposal`, modelled on `tallyRound`)

At `closesAt`: `counted = ayes + (countAbstains ? abstains : 0)`; PASSED when `counted >= ayesNeeded`
and (if `requireAyesOverNays`) `ayes > nays`; otherwise FAILED. Nothing is decided early. The tier
uses `amountUsd` at open; editing the amount is only possible in DRAFT.

### Eligibility

Checked live on every vote (web and Discord): has any of `voterRoleIds` (cached member roles, fail
closed), level >= `minLevelToVote`, and not LISTED/SUSPENDED on the disavow list (`isDisavowSubject`).
Proposer and sponsor may vote (as today). Role loss before close does not remove an already-cast vote
(record that choice in the plan review; see D1).

### Visibility

Default (D4): live counts visible to every eligible member; who voted what is visible only to DPR
(audit, fraud review), mirroring Sesh's "Anonymous" mode. A setting `proposals.publicBallots` can later
publish names after close.

### Discord

- On open: bot posts an embed in `discord.proposalsChannelId` (title, amount, tier, closes at, link to
  `/proposals/<id>`) with Aye / Nay / Abstain buttons (`pv:<choice>:<id>`) and pings the ping role.
  A button press runs the same eligibility check and replies ephemerally ("Recorded: Aye. You can change
  it until <time>.").
- Embed counts refresh at most every few minutes (cron or debounced edit).
- On close: the embed is edited to the result and a short result message is posted.
- Optional thread per proposal for discussion (Discord stays the discussion venue).

### Payments link

- `/payments/new` lets a requester pick one of their PASSED funding proposals; `proposalId` is stored.
- In `decide.ts` VOTE_REQUIRED: if `proposalId` is set, the proposal is PASSED and the request amount
  is <= the proposal amount, the "proposal passed / ayes" checklist is pre-filled from the tally (the
  reviewer still approves). A Sesh link still works the old way while `proposals.acceptSeshLinks` is on.
- New rule flag `amount_over_proposal` (high) when the request exceeds the passed amount.
- The proposal page shows its linked payment requests and their status.

### Parallel period and cut-over

1. Ship behind `proposals.enabled` (off); test on preview with a test Discord channel.
2. Pilot: turn on; new proposals may use the app or Sesh, **one venue per proposal** (never both; the
   app form asks for no Sesh link and the payments form accepts either).
3. After ~4 weeks with no blocking issues: update the proposal guide site and the handbook to point at
   `/proposals`, announce in Discord, turn `proposals.acceptSeshLinks` off for requests created after a
   date (older ones keep their Sesh link).

### Phased PRs (each small, flag off until PR 4)

1. **PR 1 - model + rules + tally** (no UI): migration, settings keys and registry tests, `tallyProposal`
   and eligibility helpers with unit tests, `ProposalEvent` log.
2. **PR 2 - web**: `/proposals` (open / recent results), `/proposals/new` (template form from the guide,
   sponsor confirm step), `/proposals/[id]` (body, tier, countdown, vote buttons, live counts), API
   routes with rate limits, nav entry behind the flag, en/es/fr strings.
3. **PR 3 - cron + Discord**: `app/api/cron/proposals` (open scheduled, settle due, post results),
   embed post/edit, `pv:` buttons in the interactions handler, `discord.proposals*` targets.
4. **PR 4 - payments link**: `PaymentRequest.proposalId`, form picker, `decide.ts` pre-fill, new rule
   flag, proposal page shows payments; `proposals.acceptSeshLinks`. Turn the flag on for the pilot.
5. **PR 5 - handbook**: `/handbook/proposals` (unblocks `plans/onboarding-guide.md` PR 5 / D5), admin
   actions for DPR (cancel with reason, view ballots), CSV export of results.
6. **PR 6 - retire old code** after cut-over: remove `/vote`, `/admin/polls`, `/api/polls/*`,
   `/api/vote/anonymous`, `/api/voting-pubkey`, `AnonymousVote.tsx`, `utils/blindRsa*`, `utils/voteToken*`,
   the RSA env vars; a later migration drops `Poll`, `PendingSignature`, `PollResult`, `ConsumedToken`
   (after confirming they are empty or exporting them). Tag and delete `feature/governance`.

## Decisions for the owner (recommended default in bold)

- **D1 Who votes**: **Box Mafia or Pizza Mafia role, checked live at vote time, no level gate**
  (level gate available as a setting).
- **D2 Who proposes**: **role holders; anyone else with a holder sponsor who confirms in the app.**
- **D3 Nay rule**: today only ayes + abstains count. **Add "ayes > nays" (on by default)** so a
  heavily opposed proposal can't pass on turnout alone; or keep today's rule exactly.
- **D4 Ballot visibility**: **counts live to members, named ballots to DPR only**; alternatives:
  fully public roll call, or cryptographic anonymity (F1, not recommended).
- **D5 Window**: **7 days fixed, no early close**, votes changeable until close.
- **D6 Quorum**: **no separate quorum**; the tier threshold is the quorum.
- **D7 Discord voting**: **yes, buttons on the #proposals embed**, same tally as the web.
- **D8 Parallel period**: **4 weeks, one venue per proposal**, then Sesh links stop being accepted for
  new payment requests.
- **D9 Old code**: **retire F1 after cut-over and delete the `feature/governance` branch** (tag first).
- **D10 Abstains**: **keep counting abstains toward the threshold** (as the guide says) and relabel the
  payments settings, which currently say "ayes" only.
- **D11 Non-funding proposals**: **allowed, kind GENERAL, threshold `proposals.generalAyes` (15).**

## Risks

- **Approval authority**: thresholds and voter roles decide who gets money. Thresholds stay
  stricter-only; voter-role changes are DPR-only and logged; rules are snapshotted per proposal.
- **Discord API limits / outages**: role lookups per vote; cache member roles briefly and fail closed
  (vote refused with a clear "try again"), never fail open.
- **Sybil / alt accounts**: eligibility comes from NFT-holder roles, as today; no worse than Sesh.
- **Double venue confusion** during the pilot: one venue per proposal; the payments form shows which.
- **Interaction endpoint**: buttons must verify the Discord signature (existing `verify.ts`) and must
  never trust ids from the payload for identity beyond `member.user.id`.
- **Legacy tables**: dropping `Poll*` tables needs a data check first.
- **Migration drift**: keep the disavow partial unique index in any baseline (see schema note).

## How to verify

- Unit: `tallyProposal` (tiers, abstains on/off, nay rule, boundaries 625/2,500, no early decision,
  snapshot vs current settings), eligibility (roles, level, disavow lockout, fail closed), settings
  bounds and stricter-only directions, `decide.ts` pre-fill and `amount_over_proposal`.
- Route tests: create/sponsor/open/vote/change vote/withdraw; ineligible 403; closed 409; rate limits.
- Interactions: `pv:` button with valid/invalid signature, ineligible member, closed proposal.
- `npm run lint`, `npm run build`, test suite.
- Vercel preview (via `/ship`): flag on in Preview only, `discord.proposalsChannelId` pointed at a test
  channel; create a proposal, vote from web and Discord with two accounts, run the cron route by hand
  with a short window, check the result post, then create a payment request linked to it and confirm
  the VOTE_REQUIRED checklist is pre-filled. Check mobile layout with `/mobile-check`.

## Decisions (owner, 2026-10-29)
- Voters: holders of a Rare Pizzas Box NFT (checked on the member's linked wallets). Eligibility is snapshotted when a proposal opens, so a box moved between wallets or members after opening can't add votes. One vote per member, however many boxes.
- Secrecy: fully secret, votes changeable until close (supersedes the counts-only idea). Design:
  1. Token issuance, decoupled from voting: when an eligible member loads the proposals list or a proposal page, the browser silently requests a blind-signed ballot token per open proposal (blind RSA, reusing utils/blindRsa* and the existing voting key pair). The server checks eligibility (box holder in the open-time snapshot), records only "token issued to member X for proposal P" (one per member per proposal, never re-issued), and never sees the token.
  2. Voting: unauthenticated request with token + choice. The server verifies the signature and proposal binding, and upserts the ballot keyed by a hash of the token. No member id, no IP, no per-ballot request log. Re-submitting with the same token replaces the choice until close.
  3. The token lives in the browser (per proposal). After voting, an optional "vote code" (the token, encoded) lets the member change the vote from another device; losing it only means the vote can't be changed.
  4. Tally at close from ballot rows. Nobody, admins included, can link a ballot to a member; issuance at page load (not vote time) removes the timing link. Residual: hosting-provider request logs (IP + time) are outside the app; the app logs neither.
  5. UX: one tap on the website (Aye / Nay / Abstain); if the token isn't ready yet the button shows a brief spinner and completes. No Discord button voting (Discord would see choices); Metalhead posts each proposal in #proposals with a Vote link.
  6. Fix the old flaw: never sign and vote in the same request flow; old poll code is retired in the last phase.
- Pass rule: (ayes + abstains) reach the amount-based threshold (15/25/35, DB settings) AND ayes > nays.
- Rollout: switch at once. All new proposals go through the website from launch; Sesh links stop being accepted by payments at launch.
