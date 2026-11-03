# followup-replies-inbox: read typed replies to Metalhead follow-ups (Telegram + Discord)

**Ask:** Snax wants to read what people type back to follow-up messages, on Telegram (shared bot
@MoltoBeneBot) and on Discord (DMs to the Metalhead bot). Today those replies are lost.

## What exists today (verified on origin/main of both repos, 2026-11-02)

- **Follow-ups (pizzadao-org).** `app/lib/followups/send.ts` builds each message with
  `composeText(message, footer)`; footers come from `followups.footerTelegram` /
  `followups.footerDiscord` (`app/lib/settings/registry.ts`). The Telegram default reads
  "Replies to this bot aren't read. Use the buttons below..."; the Discord default is "Tap Stop to
  stop these messages." The only reply paths are the Discord Reply button/modal
  (`app/lib/discord-interactions/followups.ts`) and the Telegram "Open / reply" signed link
  (`app/fu/[token]`, `app/api/fu/[token]`). Both go through `applyMemberAction()` in
  `app/lib/followups/actions.ts`, which trims to `MAX_REPLY_CHARS` (1000), merges replies within
  `REPLY_ALERT_GAP_MS`, sets `lastReply`/`lastReplyAt`, moves SENT to REPLIED, writes a `reply`
  `FollowUpEvent`, and returns `notify` text (capped by `takeAlertSlot`, `followups.maxAlertsPerDay`).
  The caller passes `notify` to `notifyApprovers()` (`notify.ts`: Telegram over the rsv.pizza proxy,
  Discord DM fallback, no-op while `followups.sendEnabled` is off). `/admin/followups`
  (`FollowUpQueue.tsx`) already shows `lastReply` and the event list.
- **Telegram inbound.** Correction to the brief: **neither the app nor rsv-pizza owns the
  @MoltoBeneBot webhook.** The separate **moltobene** service (not in our checkouts) owns the token's
  updates. It forwards private-chat DMs to rsv-pizza `POST /api/telegram/host-inbound`
  (`backend/src/routes/telegram-inbound.routes.ts`, auth `x-api-key` == `TELEGRAM_LINK_CALLBACK_SECRET`)
  with `{ chatId, kind: 'photo'|'text', fileId?, fileUniqueId?, imageBase64?, text?, mimeType? }`.
  **No `update_id` or `message_id` is forwarded.** A text DM from someone with no party gets "I'm
  not sure which event this is for yet!..."; a host's non-number, non-wallet text gets a pointer
  reply. So a follow-up reply today gets a confusing rsv.pizza answer and is dropped.
- **Service auth patterns.** App to rsv-pizza: `x-pizzadao-telegram-key` (app
  `RSV_PIZZA_TELEGRAM_KEY` == rsv `PIZZADAO_TELEGRAM_SERVICE_KEY`, `safeEqual`, env flags
  `PIZZADAO_TELEGRAM_*_ENABLED=1`). Recorder to app: `Authorization: Bearer $RECORDER_API_KEY`,
  `app/lib/calls/recorder-auth.ts` (`timingSafeEqual`, fail closed).
- **Discord.** Correction to the brief: the **recorder logs in with the same `DISCORD_BOT_TOKEN`
  as the app** (recorder/README.md, `plans/metalhead-followups.md`): it *is* Metalhead's gateway
  session. Intents: Guilds, GuildVoiceStates, GuildScheduledEvents, plus GuildMessages +
  MessageContent when `CAPTURE_VOICE_CHAT` is on. No DirectMessages, so DMs to Metalhead are never
  delivered to any of our code. `recorder.onMessage()` ignores anything outside the call session's
  channel, so a DM would not leak into transcripts. The README also mentions a separate "PizzaDAO
  bot service" on the same token (Railway project `pizzadao-discord-bot`, code not in this repo).

## Decisions (recommendations)

1. **One inbound endpoint in the app**, `POST /api/followups/inbound`, used by both channels. The
   app decides whether a message is a follow-up reply ("claims" it); callers never store text.
2. **Auth: one key per caller, the key decides the source** (body cannot pick it).
   - rsv-pizza: new secret, app `FOLLOWUP_INBOUND_TELEGRAM_KEY` == rsv `PIZZADAO_FOLLOWUP_INBOUND_KEY`,
     sent as `Authorization: Bearer ...`, source = `telegram`. Separate from the existing
     app-to-rsv key so a leak in one direction does not open the other.
   - recorder: reuse `RECORDER_API_KEY` (already shared with exactly this service), source = `discord`.
   - Compare with `timingSafeEqual`, fail closed when unset, Production only (previews answer 503).
3. **Claim rule (privacy: only replies tied to follow-ups are stored).** Resolve the sender to a
   Discord id (Telegram: `TelegramAccount.telegramId` -> `discordId`; Discord: author id). Claim only
   if that member has a follow-up with `sentAt` within `followups.inboundWindowDays` (default 14)
   and status in `OPEN_AFTER_SEND` or `DONE`; attach to the most recent one. Otherwise answer
   `{ claimed: false }` and store nothing. **No unthreaded inbox in v1** (it would collect
   messages unrelated to follow-ups); revisit if the logs show many unclaimed DMs from members.
   Opted-out members (`MessagingOptOut`) are still claimed (they wrote to us), but no ack is sent.
4. **Writing the reply** reuses `applyMemberAction({ action: 'reply' })` (same trim, merge, status
   change and alert cap as the Reply button), with one new optional `via` field recorded in the
   event data (`'telegram-dm' | 'discord-dm'`) and the alert text ("Reply from X on "ask" (Telegram DM): ...").
   `notify` goes to `notifyApprovers()` exactly like today. Text only in v1; a forwarded photo from a
   claimed sender is recorded as the placeholder "(sent a photo)" with no bytes stored, and only on
   the non-host path (hosts' photos keep going to rsv-pizza's photo/receipt flow).
5. **Idempotency.** Add `externalKey String? @unique @db.VarChar(120)` to `FollowUpEvent`. The
   inbound handler first inserts an `inbound` event with `externalKey`; a P2002 means a replay and
   returns the earlier answer (`claimed: true, duplicate: true`) without touching `lastReply`.
   Keys: Discord `discord:<messageId>`. Telegram `telegram:<chatId>:<messageId>` when moltobene
   forwards a `messageId` (ask its owner to add the optional field, no other moltobene change);
   until then rsv-pizza sends `telegram:<chatId>:sha256(text):<unix minute>`, which only collapses
   identical text resent in the same minute (acceptable: retries are the only double source).
6. **What the sender sees.** The app returns the ack text; it lives in DB settings so wording is
   editable: `followups.inboundAckTelegram` (default "Got it, thanks. I passed this on.") and
   `followups.inboundAckDiscord` (empty default = react with a check mark instead of replying).
   rsv-pizza sends the Telegram ack with its existing `sendTelegramMessage`; on `claimed: false`,
   timeout (5 s) or any error it falls through to today's behaviour unchanged.
7. **Precedence in rsv-pizza** (so hosts' structured inputs are never swallowed): forward only on
   the three "nothing matched" text branches of `host-inbound`: (a) `!ctx` (no party), (b) host
   text that is not attendance/wallet (before the pointer reply), (c) contributor text (before the
   host-only rejection). Private chats only (`chatId > 0`). Never forward commands (`/...`).
8. **Discord: add a DM listener to the recorder, behind `FOLLOWUP_DM_FORWARD=on` (default off).**
   It adds the non-privileged `DirectMessages` intent and `Partials.Channel` (DM channels are not
   cached); bots receive DM content without MessageContent. On `messageCreate` with
   `channel.type === DM`, not a bot, text present: POST to the app with up to 3 retries (5 s, 30 s,
   2 min, in memory; idempotent on message id), then react or reply with the ack. Wrapped in its own
   try/catch so it can never affect recording.
   - *Alternative A, new Railway service with its own gateway client:* better isolation, but
     another deploy, another always-on process and a second session on the same token. Not worth it
     for a ~60-line handler; revisit if the recorder gets crowded.
   - *Alternative B, keep only the Reply button:* zero infra, but typed DMs (the natural reaction)
     stay invisible and the sender gets no hint. Rejected.
   - Pre-check before enabling: confirm the "PizzaDAO bot service" does not already answer DMs
     (both sessions get every DM; two replies would be confusing).
9. **Where Snax reads them.** (a) The existing approver ping (`notifyApprovers`, Telegram first),
   now with the channel in the text. (b) `/admin/followups`: a "Has reply" filter sorted by
   `lastReplyAt`, a `via` badge on reply events, and the full reply history from events (not only
   `lastReply`, which merged replies overwrite after the gap). No new page.
10. **Footers.** After each channel is live and checked, Snax edits `followups.footerTelegram` /
    `followups.footerDiscord` in admin settings (e.g. "Reply here, or use the buttons below to
    answer, snooze or stop these messages."). The last PR changes the code defaults and help text
    (registry `FOOTER_TELEGRAM_DEFAULT`, the "Replies to the bot are not read" help strings, the
    `footerFor` comment in `send.ts`). Keep the "reply STOP" check: typed STOP is stored as a
    reply, not an opt-out.
11. **Retention.** `followups.replyRetentionDays` (default 180, 0 = keep). The existing
    `/api/cron/followups` run blanks `lastReply` and the `text` in `reply` event data for rows whose
    `lastReplyAt` is older (bounded batch per run). Applies to all replies, button or typed.

## Settings (all in `app/lib/settings/registry.ts`, area `followups`, default off)

| Key | Type | Default | Purpose |
|---|---|---|---|
| `followups.inboundTelegramEnabled` | int 0/1 | 0 | Endpoint claims Telegram messages |
| `followups.inboundDiscordEnabled` | int 0/1 | 0 | Endpoint claims Discord messages |
| `followups.inboundWindowDays` | int 1-60 | 14 | How far back a sent follow-up can be replied to |
| `followups.inboundAckTelegram` | text <=200 | "Got it, thanks. I passed this on." | Ack sent by rsv-pizza |
| `followups.inboundAckDiscord` | text <=200 | "" (react instead) | Ack sent by the recorder |
| `followups.replyRetentionDays` | int 0-3650 | 180 | Reply text retention |

Env switches (deploy-level kill switches, all default off): rsv-pizza
`PIZZADAO_FOLLOWUP_INBOUND_ENABLED=1`; recorder `FOLLOWUP_DM_FORWARD=on`. With a setting off the
endpoint answers `{ claimed: false }`, so callers fall back to today's behaviour.

## PR breakdown

**PR 1 (pizzadao-org): inbound endpoint + storage.**
- `prisma/schema.prisma` + `prisma/migrations/<ts>_followup_inbound/migration.sql`: `FollowUpEvent.externalKey` (nullable, unique).
- `app/lib/followups/inbound.ts` (new): `handleInbound({ source, senderId, text, kind, externalKey })`:
  enabled check, sender resolution, claim rule, dedupe insert, `applyMemberAction`, ack text.
  Returns `{ claimed, duplicate?, ack?, notify? }`.
- `app/lib/followups/inbound-auth.ts` (new): key -> source (`FOLLOWUP_INBOUND_TELEGRAM_KEY`, `RECORDER_API_KEY`).
- `app/api/followups/inbound/route.ts` (new): POST, Production only, auth, zod-style validation
  (`senderId` digits, `text` <= 4000 before trim, `kind` text|photo, `externalKey` <= 120),
  `after(() => notifyApprovers(notify))`, rate limit per source+sender (`checkKeyedRateLimit`).
- `app/lib/followups/actions.ts`: optional `via` on `applyMemberAction`, stored in event data and alert text.
- `app/lib/settings/registry.ts` + `config.ts`: the settings above (not the footer changes).
- Tests: `inbound.test.ts` (unlinked Telegram id -> unclaimed; no recent follow-up -> unclaimed;
  window edge; picks most recent; SENT->REPLIED; DONE stays DONE; duplicate key no double append;
  disabled -> unclaimed; opted-out -> claimed, no ack), `inbound-auth.test.ts`, route test (401/503,
  preview 503, body validation), `registry.test.ts` defaults.

**PR 2 (pizzadao-org): admin view + retention.** `FollowUpQueue.tsx` "Has reply" filter and `via`
badge; `app/lib/followups/admin.ts` query/sort by `lastReplyAt`; retention sweep in
`app/api/cron/followups/route.ts` (helper in `store.ts`). Tests: `admin.test.ts` filter, sweep test.

**PR 3 (rsv-pizza): forward unmatched DMs.** `backend/src/services/pizzadaoFollowupInbound.ts`
(new): `tryForwardFollowUpReply(chatId, text|photo)` -> ack string or null; 5 s timeout; flag
`PIZZADAO_FOLLOWUP_INBOUND_ENABLED`; `PIZZADAO_FOLLOWUP_INBOUND_URL` (default
`https://app.pizzadao.org/api/followups/inbound`); never logs text or key. Hook it into the three
branches in `telegram-inbound.routes.ts`. Must not reference setWebhook/deleteWebhook/getUpdates/
setdomain (extend the existing source-scan test in `service-telegram.routes.test.ts` to the new file).
Tests: claimed -> ack sent and existing reply skipped; unclaimed/timeout/500 -> existing reply;
attendance number and wallet never forwarded; group chat (negative id) never forwarded; flag off.

**PR 4 (pizzadao-org, recorder/ only): Discord DM listener.** `recorder/src/dm-forward.ts` (new,
pure handler + retry), `recorder/src/config.ts` (`FOLLOWUP_DM_FORWARD`), `recorder/src/index.ts`
(intent + partial + listener only when on), README env table. Tests: `dm-forward.test.ts` (guild
message ignored, bot ignored, empty ignored, retries then gives up, ack react vs reply, handler
throw does not propagate).

**PR 5 (pizzadao-org): footer defaults + help text** (after both channels are live).

## Rollout (each step reversible by its switch)

1. Merge PR 1 + PR 2 (settings default off: no behaviour change). Set
   `FOLLOWUP_INBOUND_TELEGRAM_KEY` on Vercel Production.
2. Merge PR 3 with the flag off; set `PIZZADAO_FOLLOWUP_INBOUND_KEY` on rsv-pizza (same value).
   Ask the moltobene owner for an optional `messageId` in the forward (not blocking).
3. Turn on `followups.inboundTelegramEnabled`, then `PIZZADAO_FOLLOWUP_INBOUND_ENABLED=1`. Snax
   tests with his own linked Telegram on a follow-up sent to himself. Edit the Telegram footer.
4. Merge PR 4, check the other bot service does not answer DMs, deploy recorder (no flag change:
   verify `/health` and a recording still work), then `FOLLOWUP_DM_FORWARD=on` and
   `followups.inboundDiscordEnabled`. Test with a DM to Metalhead; edit the Discord footer.
5. PR 5.

## Risks

- **Swallowing host input:** mitigated by forwarding only unmatched text branches (decision 7).
- **Wrong thread:** a member with several recent follow-ups gets the reply on the latest one; the
  alert names the ask so Snax can tell. Acceptable for v1.
- **Recorder stability:** DM code is flag-gated, isolated try/catch, no awaits on the voice path.
  Gateway sessions on the same token: adding an intent changes nothing for voice.
- **Duplicate replies on Discord** if another service on the token also answers DMs (pre-check).
- **Telegram dedupe is weak** without moltobene's message id (decision 5).
- **Privacy:** text of unclaimed messages is never stored or logged on either side; retention sweep.
- **Alerts while sending is off:** `notifyApprovers` is a no-op then; replies still show in admin.

## Verification

- Unit tests above (`npm test` in the app, recorder and rsv-pizza backend), `npm run lint`,
  `npx tsc --noEmit`; prisma migration reviewed, not run against production by the implementer.
- Vercel preview: `/admin/followups` renders the filter and badge; `POST /api/followups/inbound`
  on the preview answers 503 (Production only) and 401 without a key.
- Production smoke (Snax, after each switch): send himself a follow-up, type a reply on Telegram,
  then on Discord; confirm the ack, the approver ping, `REPLIED` status and the event with `via`;
  resend the same Discord message id via a replay to confirm no double append; turn switches off
  again if anything looks off.
