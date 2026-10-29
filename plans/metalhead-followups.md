# metalhead-followups: Metalhead follows up on things said on calls

**Status:** Plan v1 (2026-10-27). Waiting on the admin's decisions at the bottom.
**Ask (the admin, Ops call):** Metalhead should follow up on things said on calls by messaging the
people involved on Telegram or Discord (e.g. "ask Member A how regional planning is
going", "ask Member B to do the press release"). If it can't reach someone, it messages the admin
and a second approver on Telegram (their preferred channel).

## Goal

After a recorded call is summarized, the app drafts one follow-up message per actionable item
(owner, ask, due date). Each draft sits in an approval queue on `/admin/followups`. the admin edits,
approves, or dismisses it. On approval Metalhead sends it as a Discord DM or a Telegram DM. If the
owner can't be reached, the admin and a second approver get a Telegram message instead. Replies and
button taps are tracked, members can opt out, and every step is written to an audit log. Nothing
is sent without a human approving it (phase 1 to 3).

## What exists today (investigation)

- **Metalhead is the PizzaDAO Discord bot** (`DISCORD_BOT_TOKEN`). The recorder (`recorder/`,
  Railway) logs in with it and holds the only gateway connection. Its intents are Guilds,
  GuildVoiceStates and GuildScheduledEvents, with **no DirectMessages**. The Vercel app talks to
  Discord over REST (`app/lib/discord-rest.ts`, `postDiscordMessage` with 429 handling; target
  `{kind:"bot", channelId}`) and through the interactions endpoint
  (`app/api/discord/interactions`, which already handles buttons for mission review).
- **Call action items.** `app/lib/calls/summarize.ts` produces
  `actionItems: [{ text, owner? }]`, where `owner` is a *speaker display name*, through the AI SDK
  and Gateway (`anthropic/claude-sonnet-5.5`). The data is stored on `CallRecording.actionItems`
  (Json). Reviewers can edit it via `PATCH /api/admin/calls/[id]/summary`. Calls go
  `IN_REVIEW` → `PUBLISHED`, and review is DPR-only (`requireCallReviewer` in
  `app/lib/calls/access.ts`). Speakers are known by Discord id (`CallSpeaker`), and redacted
  speakers and lines are filtered by `visibleSegments()`.
- **Telegram is partly wired.**
  - `TelegramAccount` (keyed by `discordId`, plus `memberId`, `telegramId`, `username`) comes from
    the Login Widget (`app/ui/telegram/TelegramLinker.tsx`, `app/lib/telegram-auth.ts`, env
    `TELEGRAM_BOT_TOKEN` and `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`).
  - The widget does **not** set `data-request-access="write"`, so linking does not let the bot
    DM the user.
  - A separate `ANNOUNCE_TELEGRAM_BOT_TOKEN` posts to group chats (`postToTelegram` in
    `app/lib/announce/run.ts`).
  - There is **no Telegram webhook / update receiver** anywhere.
- **People data.**
  - The member sheet (`app/lib/sheets/members-list.ts`, `InternalMember` has `discordId`) maps
    member id ↔ mafia name ↔ Discord id.
  - Crew sheets have a `telegram` column of **@handles** (`app/lib/crew-sheet.ts`), e.g.
    the second approver = `@handle_b`, the admin/Member C = `@handle_a`.
  - A bot **cannot DM by @handle**. It needs the numeric chat id, and the user must have started
    the bot or granted write access.
- **Infrastructure we can reuse.**
  - `isCronAuthorized` (`app/lib/cron-auth.ts`), the `vercel.json` crons, `createNotification`,
    and `MemberProfileExtras.timezone`, which gives quiet hours.

## Design

### 1. Extracting follow-ups

- Add a new function, `extractFollowUps(recordingId)`, in `app/lib/followups/extract.ts`. It runs
  a **separate** LLM pass and does not change the public `summarySchema`. Its input is:
  - the visible transcript,
  - the speaker map, labelled `S1..Sn` and mapped back to Discord ids in code (raw ids are never
    sent),
  - the current `actionItems`.
- Output (zod):
  `[{ ownerName, ownerSpeaker?: "S3", kind: "ask_status"|"request_task"|"reminder", ask, draftMessage, dueText?, dueDate?: ISO, quote, startMs }]`.
  - `quote` and `startMs` link back to the transcript line, so the admin can check the item came from
    the call.
- Owners are often **not on the call** (for example, "ask Member A"). In that case
  the name is resolved against the member sheet (step 2).
- **Trigger:** a button "Draft follow-ups" on `/admin/calls/[id]`. Optionally it can also run
  automatically after `generateAndStoreSummary` for crews listed in `FOLLOWUP_AUTO_CREWS` (for
  example `ops`). Runs are idempotent per `(recordingId, startMs, ownerName)`.

### 2. Resolving people (`app/lib/followups/resolve.ts`)

Order:

1. `ownerSpeaker` → `CallSpeaker.discordId`.
2. Otherwise, fuzzy-match `ownerName` against the sheet's mafia names. Use exact case-folded
   match, then a small edit distance. Ambiguous matches are left for the admin to pick in the UI with
   a member search box.
3. Discord id → `TelegramAccount` (`telegramId`, `dmAllowed`).

The result is `{ discordId?, memberId?, telegramChatId?, telegramHandle? (sheet, display only), channels: ["discord","telegram"] }`.

Default channel:

- Telegram if `dmAllowed`.
- Otherwise a Discord DM. Every guild member is DM-able unless they have DMs from server members
  turned off. That only shows up when the send fails (Discord error 50007).
- the admin can override the channel per message.

### 3. Approval queue: `/admin/followups`

- **Page:** `app/admin/followups/page.tsx` and a client list. It is grouped by call and shows:
  - the owner (resolved member or "unresolved"),
  - the channel picker,
  - an editable message,
  - an editable due date,
  - the source quote with a link to `/admin/calls/[id]` at the timestamp.
- **Actions:** Approve & send, Save, Dismiss, Re-resolve.
- **API:** `app/api/admin/followups/route.ts` (list) and
  `app/api/admin/followups/[id]/route.ts` (PATCH edit / POST approve / dismiss).
- **Guard:** `requireCallReviewer` (DPR), plus an allow-list `FOLLOWUP_APPROVER_DISCORD_IDS` if
  the second approver should approve too (see decision).

### 4. Delivery (`app/lib/followups/send.ts`)

**Discord DM.**
- Open the DM channel with `POST /users/@me/channels {recipient_id}`, then send with the existing
  `postDiscordMessage({kind:"bot", channelId})`.
- Message components: buttons **Done**, **On it**, **Need help**, **Reply** (Reply opens a
  modal), and **Stop these messages**.
- Button custom ids are `fu:<action>:<followUpId>`. They are handled in the existing
  interactions route, so **no gateway changes are needed**.

**Telegram DM.**
- Send with `sendMessage` to `telegramId`, using the inline keyboard (same actions) and
  `parse_mode` off (plain text, so escaping can't break).
- Use **one bot**: the Login-Widget bot (`TELEGRAM_BOT_TOKEN`). Users grant DM permission to that
  bot.
- Getting DM permission:
  - (a) add `data-request-access="write"` to `TelegramLinker`, so new links allow DMs;
  - (b) a deep link `t.me/<bot>?start=fu` that existing linked members tap once. The webhook sees
    `/start`, matches `from.id` to `TelegramAccount.telegramId`, and sets `dmAllowed=true`.
- A 403 "bot can't initiate conversation" sets `dmAllowed=false` and falls through to Discord.

**Unreachable / escalation.**
- A follow-up is unreachable if:
  - there is no resolved member,
  - both channels failed, or
  - the member has opted out.
- In those cases send one Telegram message to each escalation contact
  (`FOLLOWUP_ESCALATION_DISCORD_IDS`, default the admin and the second approver, resolved through
  `TelegramAccount`):
  `Couldn't reach <name> (<reason>): "<ask>". Call: <link>`.
- If an escalation contact's Telegram is not DM-able, fall back to their Discord DM.
- In the approval-queue phase, an unresolved row can be sent straight to the escalation path with
  "Send to the admin+the second approver instead".

**Rate limits and etiquette.**
- At most 3 follow-ups per recipient per 24h. Extra ones are queued, not dropped.
- Quiet hours are 21:00 to 09:00 in the member's `MemberProfileExtras.timezone`. Messages approved
  during quiet hours get `sendAfter` set.
- `/api/cron/followups` (every 10 min) sends due approved rows, with at most 20 per run and a
  1.1s gap per Telegram chat.
- Telegram limits are about 1 msg/s per chat and 30/s overall. Discord DM channel creation is
  rate-limited and handled by the existing 429 logic.

### 5. Reply tracking

- **Telegram.** A new `app/api/telegram/webhook/route.ts`:
  - It checks the `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`.
  - It handles `callback_query` (buttons), `message` with `reply_to_message` (which matches
    `FollowUp.telegramMessageId`), and `/start` and `/stop`.
  - A plain message that is not a reply attaches to that chat's latest open follow-up from the
    last 7 days.
- **Discord.** Buttons and the Reply modal go through the interactions route. Free-text DM
  replies are not captured, because Metalhead has no DirectMessages intent. The DM text says
  "tap Reply to answer". Adding the DirectMessages intent to the recorder (and forwarding to the
  app) is phase 4, and only if needed.
- **Status updates** go to `REPLIED`, `IN_PROGRESS`, `DONE` or `NEEDS_HELP`. **Need help** and
  any text reply notify the approver: a Telegram DM to the admin, or an in-app notification.

### 6. Opt-out

- `MessagingOptOut { discordId PK, scope: "followups", createdAt }`.
- It is set by the **Stop** button, by Telegram `/stop`, or by the admin in the queue.
- Opted-out people are never messaged. Their items go to escalation marked "opted out".
- Every message ends with: `Reply STOP / tap Stop to stop these.`

### 7. Audit log

`FollowUpEvent` is append-only. It records drafted, edited (with a diff), approved, sent, failed
(with the error), escalated, reply, button, opt-out, and dismissed. It is shown as a timeline on
each row.

## Data model (Prisma migration)

```prisma
enum FollowUpStatus { DRAFT APPROVED SENT FAILED UNREACHABLE ESCALATED REPLIED IN_PROGRESS NEEDS_HELP DONE DISMISSED }
enum FollowUpChannel { DISCORD TELEGRAM }

model FollowUp {
  id               String          @id @default(cuid())
  recordingId      String?         // CallRecording.id (null for manual)
  sourceKey        String          @unique // `${recordingId}:${startMs}:${ownerNameNorm}`
  ownerName        String
  ownerDiscordId   String?
  ownerMemberId    String?
  kind             String
  ask              String
  message          String          // editable draft / sent text
  quote            String?
  startMs          Int?
  dueAt            DateTime?
  status           FollowUpStatus  @default(DRAFT)
  channel          FollowUpChannel?
  sendAfter        DateTime?
  discordChannelId String?
  discordMessageId String?
  telegramChatId   String?
  telegramMessageId Int?
  lastReply        String?
  lastReplyAt      DateTime?
  approvedBy       String?
  approvedAt       DateTime?
  sentAt           DateTime?
  error            String?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
  events           FollowUpEvent[]
  @@index([status, sendAfter])
  @@index([ownerDiscordId, sentAt])
  @@index([recordingId])
}

model FollowUpEvent {
  id         Int      @id @default(autoincrement())
  followUpId String
  type       String
  actorId    String?  // Discord id, "telegram:<id>", or "system"
  data       Json?
  createdAt  DateTime @default(now())
  followUp   FollowUp @relation(fields: [followUpId], references: [id], onDelete: Cascade)
  @@index([followUpId, createdAt])
}

model MessagingOptOut { discordId String @id  scope String @default("followups")  createdAt DateTime @default(now()) }
```

`TelegramAccount` also gets `dmAllowed Boolean @default(false)`.

## Files

**New**
- `app/lib/followups/{extract,resolve,send,telegram,quiet-hours,store}.ts` and `*.test.ts`
- `app/api/admin/followups/route.ts`
- `app/api/admin/followups/[id]/route.ts`
- `app/api/admin/calls/[id]/followups/route.ts` (POST draft)
- `app/api/telegram/webhook/route.ts` (shared with plans/calendar-tasks.md)
- `app/api/cron/followups/route.ts`
- `app/admin/followups/page.tsx` and `FollowUpQueue.tsx`
- `scripts/telegram-set-webhook.ts` (run once against prod only)
- the migration

**Changed**
- `prisma/schema.prisma`
- `app/ui/telegram/TelegramLinker.tsx` (`data-request-access="write"`)
- `app/lib/discord-interactions/*` (the `fu:` buttons and the Reply modal)
- `app/admin/calls/[id]/page.tsx` ("Draft follow-ups" button and count)
- `vercel.json` (the cron)
- `.env.example`:
  - `TELEGRAM_WEBHOOK_SECRET`
  - `FOLLOWUP_ESCALATION_DISCORD_IDS`
  - `FOLLOWUP_APPROVER_DISCORD_IDS`
  - `FOLLOWUP_AUTO_CREWS`
  - `FOLLOWUPS_SEND_ENABLED` (kill switch, default off)
- `app/api/cron/cron-routes.test.ts`

## Phases

0. **Prereqs (the admin).**
   - Pick the bot (decision 1).
   - In BotFather, set the bot's description and /start text.
   - Set `TELEGRAM_WEBHOOK_SECRET`.
   - the admin and the second approver link Telegram on their profiles and tap the `?start` link.
1. **Draft and queue, no sending.**
   - Build extraction, resolution, the admin queue and the audit log.
   - Approve is a "Copy message" button, so the admin sends by hand.
   - This validates extraction quality on 2 or 3 Ops calls.
2. **Sending.**
   - Discord DM and Telegram DM on approval, the escalation path, the cron with quiet hours and
     the per-person cap, and the `FOLLOWUPS_SEND_ENABLED` kill switch.
3. **Replies.**
   - The Telegram webhook (buttons, replies, /start, /stop), Discord buttons and the modal, the
     opt-out, and "Need help" alerts.
4. **Later.**
   - Reminders near `dueAt` ("still on for Friday?"), the Discord DirectMessages intent for
     free-text replies, and per-kind auto-approve (for example status pings to people who have
     already replied once). This only happens after the admin opts in.

## Alternatives considered

- **Put owner ids into `summarySchema`.** Rejected: it would change the public summary flow and
  re-run on every regenerate, which would clobber edits. A separate pass keeps follow-ups private
  and idempotent.
- **Free-text DM replies on Discord via the recorder's gateway.** Deferred: it adds a privileged
  intent and an app ingest path to the recording service. Buttons and a modal cover the need.
- **Telegram DMs via a userbot (MTProto) as the admin.** Rejected: it breaks ToS and risks a ban.
- **Two Telegram bots (announce plus login).** Rejected for DMs: users grant permission per bot,
  so DMs must come from the bot people linked with.

## Risks

- **Wrong person or wrong ask.** Mafia names are similar, so fuzzy matches can be wrong. Mitigated
  by human approval, the source quote shown for every row, and no auto-send.
- **Telegram reach will be low at first.** Only members who linked *and* allowed DMs can be
  reached, so expect Discord DMs (or escalation) for most people. Track the reach rate in the
  queue header.
- **Webhook collisions.** A bot has one webhook. Preview deployments must never call
  `setWebhook`, so the script refuses to run unless the URL is the prod host. Previews test the
  handler with recorded update fixtures.
- **Privacy.**
  - Drafts come from IN_REVIEW calls, so they could quote unpublished content. Only redaction-
    filtered segments go to the model, and messages are sent 1:1 only.
  - Rejected calls produce no follow-ups.
- **Spam perception.** Mitigated by the per-person cap, quiet hours, opt-out, and the kill switch.
- **Discord 50007** (the member has DMs closed) is handled as a failed channel, then escalation.

## Verification

- **Vitest:**
  - the extraction schema and speaker-label mapping (mocked `generateText`),
  - resolution (exact, fuzzy, ambiguous, Telegram not DM-able),
  - quiet hours and the cap,
  - send fallbacks (Telegram 403 → Discord, 50007 → escalation, opt-out → escalation),
  - webhook secret rejection, callback_query, /start and /stop parsing,
  - `fu:` interaction routing,
  - the cron auth test entry.
- Run `npx tsc --noEmit`, `npm run lint` and `npm test`.
- **Vercel preview:**
  - `/admin/followups` loads for DPR and returns 403 for others.
  - "Draft follow-ups" on a real recorded Ops call produces sensible rows with quotes.
  - With `FOLLOWUPS_SEND_ENABLED` on in preview **and** escalation and approver ids set to the admin
    only, approve a row addressed to the admin himself. The Discord DM and Telegram DM arrive, and the
    buttons update status (the Discord interactions endpoint points at prod, so test buttons
    after the prod deploy, or temporarily on a dev app).
- **Prod:** run `scripts/telegram-set-webhook.ts` once, then `getWebhookInfo` should show no
  errors.

## Decisions for the admin

1. **Which Telegram bot sends DMs:** the Login-Widget bot (`TELEGRAM_BOT_TOKEN`, recommended), or
   a new "Metalhead" Telegram bot (then the linker must switch to it too)?
2. **Who can approve:** DPR only (the same as call review), or also the second approver?
3. **Which calls get follow-ups drafted:** Ops only (auto), or a manual button on any call?
4. **Escalation contacts:** the admin and the second approver via Telegram. Confirm, and confirm they both link
   Telegram and allow DMs.
5. **Defaults:** max 3 per person per day, quiet hours 21:00 to 09:00 local, and a "STOP" footer.
   OK?
6. **Should Discord free-text replies wait for phase 4** (buttons and modal only until then)?
7. **When can it auto-send (phase 4)?** It never will unless the admin says so per kind.

## Decisions (the admin, 2026-10-27)
- Approvers: Dread Pizza Roberts (includes a second approver, who holds the role).
- DMs go through the existing Telegram login bot; the link button gains `data-request-access="write"`.
- Other decisions in this plan still open.
- (2026-10-29) Bot: the existing Telegram login bot. Calls: every summarized call gets follow-up drafts automatically. Defaults: max 3 per person per day, quiet hours 21:00-09:00 local, STOP footer (all editable settings). Scope of first build: phases 1-3 (drafts, approval-gated sending with escalation, replies/webhook/opt-out). Discord free-text replies and any auto-send stay in phase 4; nothing sends without approval.
