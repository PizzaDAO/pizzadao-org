# Host fast track + payment-approval fraud checks (pizzadao-org)

Status: plan, not started. One plan for two related ops items:

1. **Fast track for trusted event hosts.** Hosts with a good track record get quicker budget approvals, and
   everyone gets clearer budget guidelines.
2. **Fraud checks and records for payment approvals.** Help reviewers spot suspicious budget, receipt and
   payment requests (AI may flag, never decide), and keep a record of every approval.

Hard rules (from the brief and the settings plan, `plans/app-settings.md`):
- Nothing pays out automatically. The app records "approved for payment"; a person still sends the money.
- AI only adds flags with reasons. It never approves, rejects or clears a flag, and "no AI flags" is never
  shown as "verified".
- Tunables live in the settings registry (`app/lib/settings/`). Only Dread Pizza Roberts (DPR) can edit them.
  Approval and spend settings can only be made stricter in the UI. If a setting can't be read, it fails
  safe, which means everything waits for a human (no fast lane, higher risk score).
- The repo is public, so all text stays generic: no real people, crews, cities or incidents.

---

## 1. Where budgets, receipts and payments are handled today

### 1.1 Not in this app
Searching this repo for budget, receipt, reimburse, payout, invoice and approval finds nothing about event
money. The only hits are the PEP game economy, bounty escrow (PEP, not dollars) and time budgets in the
call pipeline. The only event-related code is:
- `data/gpp-contracts.json`, which holds unlock-ticket contracts for GPP events (`app/api/unlock-tickets/verify`).
- The L6.1 `gpp_host` mission verifier, which calls rsv.pizza `POST /api/service/gpp-host-lookup` using
  `x-service-key` (`app/lib/mission-verify/semi.ts:337`, `sources.ts:132-134`).
- `Poll` / anonymous voting (`/vote`), which is a blind-signature poll tool and is not wired to budgets.

### 1.2 rsv.pizza already handles GPP party money end to end (separate repo `../rsv-pizza`)
- `/payments` admin with payouts, receipts with LLM OCR, reimbursement caps by city tier (underbosses can
  override up to a ceiling), prepayments, bulk send, a "no receipt" approval block (overridable and
  audited), and an append-only `payout_audit` table.
- Fake-event detection (RSVP heuristics, a Risk pill on `/payments`) and an admin-triggered AI
  image-authenticity check for receipt images (`lib/imageAuthenticity.ts`, advisory only).
- **Host Fast Pass, merged as rsv-pizza #1150 (2026-10-27).** It adds:
  - a track record built only from admin-reviewed, paid-with-proof parties (`lib/hostTrackRecord.ts`);
  - review-assist red flags: new_account, first_party, no_prior_photos, prior_issues, shared_payee,
    reused_receipts, no_rsvps / low_rsvps, no_receipts, over_cap;
  - `decideApproval`, which blocks self-approval and hard-blocks scam history, reused receipts and shared
    payees, and requires a written note for manual review;
  - a `host_fast_pass_approvals` table, a host-facing progress card, and `plans/host-fraud-postmortem.md`.
  - Its thresholds are **code constants** (`FAST_PASS_THRESHOLDS`: 2 verified parties, 10 RSVPs, 45-day
    account, 14-day receipt deadline). They are not DB settings.

### 1.3 Fully external (no system of record)
- **Event Budget Template** (Google Sheet). Contribution is up to $625 "on approval". This is used for
  non-GPP events.
- **PizzaDAO Work Payment** Google Form. Its responses go to a linked sheet.
- **Payments mailbox**, where approved receipts are emailed.
- **Proposal Process** with Discord Sesh polls: 15 ayes for ≤ $625, 25 for $625–2,500, 35 above that.

**Conclusion:** GPP host reimbursements already have fast track and fraud checks in rsv.pizza, so this
app must **not** rebuild them. The gap is everything else (non-GPP event budgets, work payments,
proposal-funded spends). Those have no record, no checks and no documentation. This plan brings exactly
that gap into the app. It reuses rsv.pizza's host track record through a service call instead of copying it.

| Piece | After this plan |
|---|---|
| GPP party reimbursements, payouts, OCR, caps, Fast Pass | **rsv.pizza** (unchanged). This app only reads the host's tier. |
| Non-GPP event budget requests and receipts | **In-app** (Phase 4 form; reviewers can attach mailbox receipts from Phase 2) |
| Work Payment form | **External form stays.** Responses are **ingested** read-only into the app (Phase 2). |
| Payments mailbox | External; becomes optional once Phase 4 ships |
| Sesh proposal polls | **External.** The app requires the poll link above the cap and shows the aye threshold. It does not count votes. |
| Sending money | **External** (treasury). The app records "paid" plus proof (tx hash or reference). |
| Budget guidelines | **In-app public page** (Phase 1), with numbers read from settings |

---

## 2. Proposed flow

```
 Work Payment form ──(cron, read-only)──┐
 In-app budget/receipt form (Phase 4) ──┼──> PaymentRequest ──> checks ──> lane ──> reviewer decision(s) ──> APPROVED ──> treasury pays ──> MARK_PAID (+proof)
 Reviewer "add from mailbox" upload ────┘          │              │                │
                                                   │   rules + rsv.pizza tier       └─ PaymentDecision (append-only record)
                                                   │   + AI flags (Phase 5)
                                                   └─ PaymentCheck snapshots (what the reviewer saw)
```

Every request lands in exactly one lane. The lane only decides how many approvals are needed, who may
give them, the queue order and the target review time. It never approves anything.

| Lane | When | Approvals needed |
|---|---|---|
| **FAST** | Requester is fast-track eligible (section 4), amount ≤ `payments.fastTrackMaxUsd`, risk score ≤ `payments.fastTrackRiskMax`, no high flag | 1 reviewer; top of queue; SLA `payments.fastTrackSlaHours` |
| **STANDARD** | Everything else ≤ `payments.onApprovalCapUsd` with risk below `payments.highRiskScore` | 1 reviewer, who must tick off each open flag |
| **HIGH_RISK** | Risk ≥ `payments.highRiskScore`, or any hard-block flag | `payments.highRiskApprovals` (≥ 2) distinct reviewers, one of them DPR, each writing a note |
| **VOTE_REQUIRED** | Amount > `payments.onApprovalCapUsd` | A Sesh poll link is required, and the reviewer confirms it passed with the aye count from the tier table. Risk rules still apply on top. |

Shared rules for every lane:
- A reviewer can never approve their own request (also checked by requester Discord id and shared signals).
- Any setting that can't be read sends the request to STANDARD or HIGH_RISK, never FAST.

---

## 3. Data model (Prisma, one migration per phase that needs it)

```prisma
enum PaymentSource   { FORM APP REVIEWER }
enum PaymentKind     { EVENT_BUDGET REIMBURSEMENT WORK OTHER }
enum PaymentStatus   { RECEIVED NEEDS_INFO APPROVED REJECTED PAID WITHDRAWN }
enum PaymentLane     { FAST STANDARD HIGH_RISK VOTE_REQUIRED }

model PaymentRequest {
  id                 String        @id @default(cuid())
  source             PaymentSource
  sourceRef          String?       @unique   // form: sheet id + response timestamp + row hash (idempotent ingest)
  kind               PaymentKind
  status             PaymentStatus @default(RECEIVED)
  lane               PaymentLane   @default(STANDARD)
  requesterDiscordId String?
  requesterMemberId  String?
  requesterLabel     String                  // display name as submitted (no email in list views)
  title              String
  description        String
  eventDate          DateTime?
  eventCity          String?
  rsvEventSlug       String?                 // GPP events: link out to rsv.pizza instead of handling here
  amountUsdCents     Int
  currency           String  @default("USD")
  amountOriginal     Decimal?
  payeeHash          String?                 // sha256(normalized wallet/bank ref): reuse detection only
  payeeHint          String?                 // masked, e.g. 0x12…ab
  proposalUrl        String?                 // Sesh poll link (required in VOTE_REQUIRED)
  riskScore          Int     @default(0)
  flags              Json    @default("[]") // latest computed flags [{id, severity, detail, source}]
  checkedAt          DateTime?
  approvalsNeeded    Int     @default(1)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  attachments        PaymentAttachment[]
  checks             PaymentCheck[]
  decisions          PaymentDecision[]
  @@index([status, lane, createdAt])
  @@index([requesterDiscordId])
  @@index([payeeHash])
}

model PaymentAttachment {      // receipts, photos, budget sheets; private Blob only
  id          String  @id @default(cuid())
  requestId   String
  kind        String          // RECEIPT | PHOTO | BUDGET | OTHER
  blobPath    String          // private blob pathname, served only via an authenticated route
  sha256      String          // exact-reuse detection across requests
  sizeBytes   Int
  mime        String
  uploadedBy  String          // Discord id or "form"
  createdAt   DateTime @default(now())
  request     PaymentRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  @@index([sha256])
}

model PaymentCheck {           // snapshot of each automated check (rules, rsv tier, AI)
  id         Int      @id @default(autoincrement())
  requestId  String
  kind       String           // RULES | RSV_TRACK | AI_RECEIPT | AI_TEXT
  version    String           // rule-set or prompt version
  model      String?          // AI model id when kind is AI_*
  result     Json             // flags + extracted fields; never raw payee details
  createdAt  DateTime @default(now())
  request    PaymentRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  @@index([requestId, createdAt])
}

model PaymentDecision {        // append-only record of every human action
  id                Int      @id @default(autoincrement())
  requestId         String
  action            String   // APPROVE | REJECT | REQUEST_INFO | ACK_FLAG | MARK_PAID | REOPEN | NOTE | WITHDRAW
  actorDiscordId    String
  lane              PaymentLane
  riskScoreAtAction Int
  flagsAtAction     Json     // flags the actor saw
  checklist         Json?    // ticked items (amount matches receipt, event happened, proposal passed, ...)
  note              String?
  proofRef          String?  // MARK_PAID: tx hash / transfer reference (no bank numbers)
  createdAt         DateTime @default(now())
  request           PaymentRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  @@index([requestId, createdAt])
  @@index([actorDiscordId])
}
```

Notes on the model:
- `PaymentDecision` has no update or delete path in code. Corrections are new rows (REOPEN, NOTE).
- Raw payout details (wallets, bank numbers) are **not** copied from the form. The treasury still pays from
  the form sheet. The app stores only a hash and a masked hint, which is enough to spot one payee used by
  several requesters (see decision D4).

---

## 4. Fast track: who qualifies

Logic lives in `app/lib/payments/trust.ts`. These are pure functions; the inputs are loaded separately.
A requester is **eligible** when all of the following hold:
- **History**, met by either of these:
  - rsv.pizza tier is `fast_pass` (from a new service endpoint, section 6); or
  - at least `payments.fastTrackMinPaidRequests` in-app requests are PAID with a proof ref, with none
    REJECTED for fraud reasons in the last 12 months.
- Discord account age ≥ `payments.fastTrackMinAccountDays`, and member level ≥ `payments.fastTrackMinLevel`
  (from `getCurrentLevel`).
- None of these: an open high flag on any of their requests; a `flagged` rsv.pizza tier; a disavow-list
  match; an `AccountSignal` linking them to someone with a rejected request.
- Fast track only ever applies up to `payments.fastTrackMaxUsd`, which can never be above
  `payments.onApprovalCapUsd`.

**Host-facing view** follows rsv.pizza's `toHostView` approach. A dashboard card shows "Fast track:
building (1 of 2 paid events)" and what is still missing. A flagged host sees the same "building" card.
Flag details are never shown to the requester.

**Fail-safe.** If the rsv.pizza call fails, that source counts as "not fast_pass". If a setting can't be
read, it resolves to the value that disables FAST.

---

## 5. Fraud checks

### 5.1 Rule flags (Phase 3, no AI, `app/lib/payments/rules.ts`)

Each flag has an id, a severity and a detail line. The score is the sum of severity weights (high 50,
medium 20, low 5), capped at 100.

| Flag | Severity | Signal |
|---|---|---|
| `reused_attachment` | high (hard block) | Attachment sha256 already used on another request |
| `shared_payee` | high (hard block) | Same `payeeHash` used by a different requester |
| `prior_fraud` | high (hard block) | Requester or a linked `AccountSignal` account has a request REJECTED as fraud |
| `restricted_list` | high (hard block) | Disavow-list match. Detail shown to DPR only; other reviewers see "restricted, ask DPR". |
| `rsv_flagged` | high | rsv.pizza tier `flagged` (no detail crosses the service boundary) |
| `over_cap_no_vote` | high | Amount > cap and no proposal link |
| `split_request` | medium | Same requester has requests in the last 30 days that sum over the cap while each is under it |
| `unmatched_requester` | medium | Form response could not be matched to a member or Discord id |
| `new_account` | medium | Discord account younger than `missions.newAccountDays` (reuses that setting) |
| `reimburse_before_event` | medium | REIMBURSEMENT dated before `eventDate` |
| `no_receipts` | medium | REIMBURSEMENT or WORK with no RECEIPT attachment |
| `late_receipts` | low | Receipts uploaded later than `payments.receiptDeadlineDays` after the event |
| `gpp_event` | info | `rsvEventSlug` set, or the title looks like GPP. Shows "handle in rsv.pizza /payments" plus a link, to avoid paying twice. |
| `duplicate_request` | medium | Same requester, amount within 5%, within 14 days |

### 5.2 AI flags (Phase 5, `app/lib/payments/ai-check.ts`)

The model is `ai` SDK `generateText` with `Output.object`, via the AI Gateway, falling back to OpenAI.
This is the same pattern as `app/lib/calls/summarize.ts`.

**Input:** request fields (no payee data) plus receipt images (fetched server-side from private Blob)
and the description.

**Output schema:**
- `extracted`: `{ total, currency, date, vendor }`
- `amountMatches`: yes / no / unclear
- `dateFitsEvent`: yes / no / unclear
- `editSigns` and `generatedSigns`: lists of concrete reasons
- `textConcerns`: urgency, pressure, a one-off payment channel, a mismatch between the description and
  the receipts
- `confidence`

The output maps to flags `ai_amount_mismatch`, `ai_possible_edit`, `ai_date_mismatch` and
`ai_text_pressure`. Their severity is **medium at most**. AI alone can never push a request into
HIGH_RISK; only rule flags can. It can push a request out of FAST.

Safety and cost controls:
- The prompt treats receipt text as untrusted data. The schema has no "approve" field.
- Results are stored as `PaymentCheck` with model id and prompt version.
- Runs only when `payments.aiChecksEnabled` = 1, at most `payments.aiDailyCap` per day, and only on
  production, or when a reviewer clicks "Run AI check" (previews share the prod DB).

---

## 6. Settings (all in a new `payments` area of `app/lib/settings/registry.ts`)

The registry is int-only today. Toggles are stored as ints 0/1 (`input.min 0, max 1`) unless app-settings
Phase 3 (`boolSetting`) has landed by then. Phase 1 adds `'payments'` to `SettingArea` and `AREA_LABELS`.

| Key | Default | Bounds | Stricter-only (looser when) | On read failure |
|---|---|---|---|---|
| `payments.onApprovalCapUsd` | 625 | 0–625 | yes (higher) | `{value: 0}`: everything above $0 needs a vote link, so it waits |
| `payments.fastTrackMaxUsd` | 625 | 0–625; also ≤ cap at read | yes (higher) | `{value: 0}`: no FAST |
| `payments.fastTrackMinPaidRequests` | 2 | 2–20 | yes (lower) | `{value: 20}` |
| `payments.fastTrackMinAccountDays` | 45 | 45–730 | yes (lower) | `{value: 730}` |
| `payments.fastTrackMinLevel` | 4 | 4–9 | yes (lower) | `{value: 9}` |
| `payments.fastTrackRiskMax` | 10 | 0–10 | yes (higher) | `{value: 0}` |
| `payments.highRiskScore` | 50 | 10–50 | yes (higher) | `{value: 10}` |
| `payments.highRiskApprovals` | 2 | 2–3 | yes (lower) | `{value: 3}` |
| `payments.fastTrackSlaHours` / `payments.slaHours` | 24 / 72 | 1–336 | no | lastKnownGood |
| `payments.receiptDeadlineDays` | 14 | 1–60 | no (only affects a low flag) | lastKnownGood |
| `payments.voteAyesTier1/2/3` | 15 / 25 / 35 | default–200 | yes (lower) | lastKnownGood. Display and checklist only; the poll itself is external. |
| `payments.voteTier2MaxUsd` | 2500 | 625–2500 | yes (higher) | lastKnownGood |
| `payments.formIngestEnabled` | 0 | 0–1 | no | `{value: 0}` (off) |
| `payments.requestFormEnabled` | 0 | 0–1 | no | `{value: 0}` |
| `payments.aiChecksEnabled` | 0 | 0–1 | no | `{value: 0}` |
| `payments.aiDailyCap` | 50 | 0–200 | no | `{value: 0}` |

Notes:
- `registry.test.ts` locks every default.
- A cross-key check runs at read time (`fastTrackMaxUsd = min(fastTrackMaxUsd, onApprovalCapUsd)`), so a
  bad pair can never loosen anything.
- **Not settings** (pinned in code, like `admin-guard.ts`): who may review payments and who may mark them
  paid. See D2.

---

## 7. Phases (small PRs)

Each PR is behind a toggle that is off by default, or adds read-only UI, so merging changes nothing until
DPR flips a switch.

### Phase 1: settings and public budget guidelines
- `app/lib/settings/registry.ts` and `registry.test.ts`: `payments` area plus all keys above.
- `app/budget/page.tsx` (public, i18n via `messages/{en,es,fr}.json`):
  - what PizzaDAO funds;
  - the on-approval cap, read live from settings;
  - the proposal tiers and aye counts;
  - "GPP parties: use rsv.pizza";
  - what receipts and photos are needed and the receipt deadline;
  - how fast track is earned (thresholds shown; how fraud is detected is not shown);
  - links to the Work Payment form and the proposal process.
- Link it from `/manuals` and the dashboard.
- Template copy is generic.

### Phase 2: ingest, queue and approval record (the core)
- Migration: `PaymentRequest`, `PaymentAttachment`, `PaymentCheck`, `PaymentDecision`.
- `app/lib/sheets/config.ts`: `workPaymentResponses: envOr('WORK_PAYMENT_RESPONSES_SHEET_ID', '')`. An empty
  value means ingest is off. No committed default, because the sheet holds PII.
- `app/lib/payments/ingest.ts`:
  - reads the responses tab with `sheetsClient` (service account must be shared on the sheet);
  - maps columns by header regex and **fails closed** if a required header is missing (logs, ingests nothing);
  - matches the requester to a member through the existing people/member lookup;
  - hashes the payee field and drops the raw value;
  - is idempotent on `sourceRef`;
  - only reads, never writes back to the sheet (D5).
- `app/api/cron/payments-ingest/route.ts` plus a `vercel.json` cron `*/15 * * * *`. It runs only when
  `payments.formIngestEnabled` = 1 and `VERCEL_ENV=production`.
- `app/lib/payments/access.ts`:
  - `canReviewPayments` covers the admin roles and DPR (pinned ids);
  - `canMarkPaid` is DPR plus an optional pinned treasury role id (D2);
  - both fail closed and run the self-approval check.
- `app/lib/payments/decide.ts`:
  - a pure state machine that counts distinct approvers against `approvalsNeeded`;
  - requires a note for HIGH_RISK, VOTE_REQUIRED and any un-ticked flag;
  - requires a `proposalUrl` for VOTE_REQUIRED;
  - writes the `PaymentDecision` row and the status change in one transaction with an
    `updatedAt` optimistic check.
- `app/admin/payments/page.tsx` (queue: lane, amount, age vs SLA, flag chips) and
  `app/admin/payments/[id]/page.tsx`:
  - request detail, attachments, checks and the decision timeline;
  - approve / reject / request-info / mark-paid with a checklist;
  - "add attachment from mailbox", which uploads to private Blob.
- `app/api/admin/payments/**` routes use `rejectUnsafeWrite` and `NO_STORE_HEADERS`.
- `app/api/admin/payments/[id]/attachments/[aid]/route.ts` streams a private blob to reviewers only.
- `app/api/admin/payments/export/route.ts` exports approved and paid requests plus decisions as CSV for
  the treasury and the books.
- Lanes in this phase are only STANDARD and VOTE_REQUIRED; nothing is FAST yet.

### Phase 3: rule flags and lanes
- `app/lib/payments/rules.ts`, `app/lib/payments/lane.ts`. Checks run on ingest, on every new attachment
  and on a "Re-check" button, and each run writes a `PaymentCheck`.
- HIGH_RISK lane goes live, with DPR plus the second-approver rule.

### Phase 4: in-app request form (non-GPP budgets and receipts)
- `app/payments/new/page.tsx` plus `app/api/payments/route.ts`:
  - logged-in members only; behind `payments.requestFormEnabled`;
  - kind, amount, event date and city, description, optional proposal link, payee (hashed), and receipts
    and photos uploaded to private Blob with magic-byte sniffing (images plus PDF);
  - if an rsv.pizza event link is pasted, the form points to rsv.pizza instead.
- `app/payments/page.tsx`: "my requests", showing status and the host-safe fast-track card.
  - Comments go through a REQUEST_INFO reply box.
- A small `app/lib/private-blob-upload.ts` wraps `@vercel/blob` `put(..., { access: 'private' })`.
- The budget-template sheet becomes optional. The guidelines page links to the in-app form.

### Phase 5: fast track
- **rsv-pizza PR:** `POST /api/service/host-track-record`, using the same `requireServiceKey` and rate
  limit as `gpp-host-lookup`.
  - Body: `{ emails?, wallets?, telegrams? }`.
  - Response: `{ tier, eligibleForFastPass, verifiedParties }`. `flagged` is allowed because this is
    server to server and is shown to reviewers only. No `issueDetails`.
- This repo:
  - `app/lib/payments/rsv-track.ts` makes the call with a 4 s timeout; on failure it returns null.
  - `app/lib/payments/trust.ts` decides eligibility.
  - FAST lane goes live.
  - A dashboard card shows fast-track progress.
  - The queue sorts FAST first.

### Phase 6: AI flags
- `app/lib/payments/ai-check.ts` plus a "Run AI check" button.
  - Auto-run on new receipts is gated by the toggle, the daily cap and production only.
  - A prompt version constant is stored on each `PaymentCheck`.
- Optional: post a review card to a private Discord channel. The channel id goes in DB, and this is off
  by default.

GPP-related follow-ups belong in the **rsv-pizza** repo and are listed so they don't get lost:
- Move `FAST_PASS_THRESHOLDS` into its `app_config` table (D7).
- Fill in `plans/host-fraud-postmortem.md`.

---

## 8. Alternatives considered
- **Rebuild GPP payouts here.** Rejected: rsv.pizza already has payouts, OCR, caps, audit and Fast Pass.
  Doing it twice means two sources of truth and double-payment risk.
- **Put non-GPP requests into rsv.pizza `/payments`.** That is possible, but rsv.pizza's model is built
  around parties, venues and RSVPs. Work payments and proposal spends are member and Discord based, which
  is this app's domain (levels, vouches, disavow, account signals). This is a reasonable alternative if
  Snax prefers one payments console; see D1.
- **Replace the Google Form outright.** Rejected for v1. Ingesting the form keeps today's habits
  unchanged while giving the queue real data.
- **Let AI score drive the lane.** Rejected. AI flags are capped at medium so they can't create a
  HIGH_RISK lane by themselves, and they can only remove FAST.
- **Store payout details in the app.** Rejected: that adds PII and attack surface. A hash is enough to
  spot reuse.

---

## 9. Risks
- **PII.** Form responses and receipts hold names, emails and payee data. Mitigations:
  - admin-only routes with no-store;
  - private Blob;
  - payee stored hashed only;
  - CSV export restricted to DPR;
  - no PII in logs, PR text or Discord posts.
- **Previews share the prod DB.** A preview can read real requests (admin-gated) and could act on them.
  Mitigations:
  - mark-paid and approve are allowed on previews, but every decision row records `VERCEL_ENV`;
  - cron and AI auto-run are production only;
  - preview testing uses a test request created by hand and deleted afterwards (section 10).
- **Form header drift.** Someone edits the form and the ingest maps the wrong column. Mitigations:
  required-header check fails closed, and an admin banner shows "ingest paused: header X missing".
- **Private Blob store.** The current Blob token may be for a public store. Phase 2 must confirm that
  `access: 'private'` works with the project's store, or add a second private store and token.
- **Gaming the public rules.** The flag list is visible in the repo. Mitigations: weights are coarse,
  hard blocks don't depend on secrecy, and per-flag weights can later move to a private setting.
- **AI false positives or prompt injection.** Mitigations: flags capped at medium, reasons shown, never
  auto-reject, and receipt text treated as data.
- **Double pay** across rsv.pizza and this app for the same event. Mitigations: the `gpp_event` flag and
  the link-out.
- **Self-dealing.** Mitigations: self-approval block by Discord id and shared `AccountSignal`, distinct
  approvers in HIGH_RISK, and DPR-only mark-paid by default.
- **rsv.pizza endpoint down or slow.** It fails to "not fast_pass" with a 4 s timeout, so the request is
  simply not fast-tracked.

---

## 10. Verification

Unit tests (vitest), per phase:
- `registry.test.ts`: defaults, bounds, stricter-only, failure values.
- `payments/rules.test.ts`: each flag, plus score caps.
- `payments/lane.test.ts`:
  - fail-safe: settings unreadable gives no FAST;
  - fastTrackMax above the cap gets clamped.
- `payments/decide.test.ts`:
  - self-approval blocked;
  - distinct approvers counted;
  - note and proposal required;
  - decisions are append-only;
  - concurrent approve hits the `updatedAt` conflict.
- `payments/ingest.test.ts`:
  - header mapping with a missing header ingests nothing;
  - idempotent re-run;
  - payee hashed and raw value never stored.
- `payments/trust.test.ts`: rsv null or flagged gives no FAST; host view hides flags.
- `payments/ai-check.test.ts`:
  - mocked model; severity capped at medium;
  - schema-fail produces no flags plus a check row with the error;
  - daily cap respected.
- A route test for `access.ts`: a non-reviewer gets 403, a cross-origin write is rejected.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`.

Migration: `prisma migrate status` against prod, then apply before merge (the same process as app-settings).

Vercel preview checks (`vercel-deploy`, logged in as DPR):
1. `/budget` renders the cap ($625) and the 15/25/35 tiers from settings. Change a value on
   `/admin/settings`: the page updates within ~30 s, and trying to loosen it is refused.
2. `/admin/settings` shows the Payments group, all at defaults and all toggles off.
3. Phase 2: point `WORK_PAYMENT_RESPONSES_SHEET_ID` (preview env only) at a **copy** of the responses sheet
   with two fake rows, then trigger the ingest route by hand.
   - The rows appear once; re-running adds nothing.
   - The payee shows only a masked hint.
   - Approve as one reviewer, then mark paid with a fake ref: the timeline shows both rows, and the CSV
     export includes them.
   - Delete the test rows afterwards.
4. A non-reviewer account gets 403 on `/admin/payments`, and on the attachment URL even with the blob
   path copied.
5. Phase 3: upload the same receipt to two test requests. The second shows `reused_attachment` and lands
   in HIGH_RISK. One approval doesn't change its status; a second reviewer plus DPR does.
6. Phase 5: a test member with two paid requests and level ≥ 4 shows FAST and the "1 approval" label. With
   the rsv.pizza URL pointed at a dead host, the same request falls back to STANDARD.
7. Phase 6: "Run AI check" on a receipt whose total differs from the request shows `ai_amount_mismatch`
   with a reason and does not change the lane to HIGH_RISK.
8. `/mobile-check` on `/budget`, `/payments/new` and `/admin/payments/[id]`.

---

## 11. Decisions for Snax (recommended default first)

- **D1. Where non-GPP requests live.** Recommended: in this app (`/admin/payments`). GPP stays in rsv.pizza.
  - Alternative: extend rsv.pizza `/payments` with a non-party request type.
- **D2. Who approves, and who marks paid.** Recommended:
  - approve: the existing admin roles plus DPR;
  - mark paid: DPR only, plus an optional pinned treasury role id you name;
  - both pinned in code, not settings.
- **D3. Approvals per lane.** Recommended: FAST 1, STANDARD 1 (with each flag ticked off), HIGH_RISK 2
  including DPR.
- **D4. Payout details.** Recommended: never copy them into the app; store a hash and a masked hint only.
  The treasury keeps paying from the form sheet.
- **D5. Write status back to the form sheet.** Recommended: no in v1 (read-only). Revisit if the treasury
  wants a status column.
- **D6. Fast-track basis.** Recommended: rsv.pizza `fast_pass` **or** 2 paid in-app requests, plus level ≥ 4
  and a 45-day-old account, capped at $625.
- **D7. rsv.pizza Fast Pass thresholds.** Recommended: leave them as constants for now. Open a separate
  rsv-pizza task to move them to its `app_config`, so both apps can be tuned without a deploy.
- **D8. AI checks.** Recommended:
  - on-demand button first, auto-run off;
  - daily cap 50;
  - AI flags capped at medium;
  - provider via AI Gateway with OpenAI fallback (the same keys as calls).
- **D9. Disavow match.** Recommended: a hard block. Other reviewers see only "restricted, ask DPR"; the
  details are shown to DPR only.
- **D10. Form ingest scope.** Recommended: the Work Payment form only; budget-template sheets are not
  parsed. Non-GPP budgets come in via the Phase 4 form.

## Decisions (Snax, 2026-10-29)
- Build all 6 phases. Take the recommended default on D1-D10.

---

## 12. Endpoint contract needed from the party platform (phase 5, implemented here)

This repo calls the endpoint below. The party-platform repo is NOT changed by this work; it needs this
endpoint before the fast lane can use its track record. Until it exists (or if it is unset, down, slow or
returns anything unexpected) the call returns nothing and the member falls back to the paid-requests rule.

**Config (this repo, env only):** `RSV_PIZZA_API_URL` (must be `https://`) and `RSV_PIZZA_SERVICE_KEY`.
If either is missing the call is never made.

```
POST {RSV_PIZZA_API_URL}/api/service/host-track-record
Headers:  content-type: application/json
          x-service-key: <shared secret>     (same guard and rate limit as gpp-host-lookup)
Body:     { "wallets"?: string[<=10], "telegrams"?: string[<=5], "emails"?: string[<=5] }
          at least one list non-empty; the host is the union of everything that matches
200 OK:   { "tier": "fast_pass" | "building" | "new" | "flagged",
            "eligibleForFastPass": boolean,      // must be true only when tier === "fast_pass"
            "verifiedParties": integer >= 0 }
Other status codes, a timeout (4 s on our side) or a body that does not match: treated as "no Fast Pass".
```

Rules for the other side:
- Response carries no issue details, names, amounts or ids ("flagged" is a bare tier, shown only to reviewers).
- `tier: "flagged"` blocks the fast lane here and adds a high `rsv_flagged` flag; it never creates a payment.
- Identifiers are looked up, not stored; our side keeps only `{tier, eligibleForFastPass, verifiedParties}` in
  a `PaymentCheck` snapshot.

## 13. Implementation notes (2026-11)

- Phases 1-6 are built behind settings that default OFF: `payments.fastTrackEnabled`, `formIngestEnabled`,
  `requestFormEnabled`, `receiptUploadEnabled`, `aiChecksEnabled`.
- The Work Payment responses sheet id is the private registry text setting `payments.formSheetId` (top
  review role only, on `/admin/settings`). The "ingest from" moment and the ingest status are raw
  `AppSetting` rows (`payments.ingestFrom`, `payments.ingestStatus`).
- Form rows carry `claimedDiscordId` only: the id typed into a public form is a claim, so those rows are
  flagged `unverified_requester`, never fast-tracked, and invisible to the claimed member.
- Approve and mark-paid need checks that ran after the latest file (and, to pay, after the approval).
  Mark-paid asks for the wallet/account paid, hashes it and compares it with the request; it is not stored.
- Non-USD amounts are stored with a USD amount of 0 (approval blocked) until a reviewer enters the value.
- Payee details are HMAC-hashed with `PAYMENTS_HASH_SECRET`; with no secret, nothing derived from the payee is
  stored and the shared-payee check is off.
- Receipts need a Blob store that supports private files. If the project's store is public-only,
  `payments.receiptUploadEnabled` stays 0 and uploads answer "private storage unavailable".
