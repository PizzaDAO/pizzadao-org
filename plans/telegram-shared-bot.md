# telegram-shared-bot: send through the rsv.pizza bot, log in with a small app bot

**Status:** Plan v1 (2026-10-30). Covers two repos: pizzadao-org (app.pizzadao.org) and rsv-pizza
(rsv.pizza backend). It replaces the "one app-owned bot with a webhook" design in
`plans/metalhead-followups.md` (#207).
**Decisions (the admin, 2026-10-30):** build all four parts below. Everything is off by default.

## Goal

1. Personal follow-up DMs go out through the **rsv.pizza bot**, send-only. If Telegram can't
   deliver, the follow-up goes to Discord instead.
2. Call recaps, agendas and announcements can be **mirrored into the matching city's Telegram
   group**, through the same bot.
3. A **small login-only bot** for app.pizzadao.org. It only verifies the Telegram Login Widget, so
   we learn the member's Telegram user id. It never sends and has no webhook.
4. Optionally, **hosts who already linked Telegram on rsv.pizza** are matched to app members. With
   their consent, they can get follow-up DMs without using the Login Widget.

Hard rule: our app never calls `setWebhook`, `deleteWebhook`, `getUpdates` or `setdomain` (or any
other method that changes or reads updates) on the rsv.pizza bot. The inbound service owns its
updates. This plan enforces the rule **by design**: the app never holds the rsv.pizza bot token.

## What exists today (investigation)

### pizzadao-org
- **Follow-ups (#207).**
  - `app/lib/followups/telegram.ts` calls the Bot API directly with `TELEGRAM_BOT_TOKEN`, using
    inline `callback_data` buttons (`buttons.ts`, `fu:<action>:<id>`).
  - `send.ts`:
    - `decideSend` only picks Telegram when `TelegramAccount.dmAllowed` is set.
    - `deliverOverChannels` tries Telegram, then Discord. On a 403 or "chat not found" it clears
      `dmAllowed`.
    - Any other error never falls through to the other channel, because the message may already
      have been delivered.
  - `notify.ts` sends approver escalations the same way.
- **Webhook.**
  - `app/api/telegram/webhook/route.ts` handles callback buttons, replies, `/start`, `/stop`,
    typed STOP words and `my_chat_member`. The handlers are in `app/lib/followups/telegram-updates.ts`.
  - It checks the secret with `webhook-auth.ts` against `TELEGRAM_WEBHOOK_SECRET`.
  - `scripts/telegram-set-webhook.mjs` registers the webhook.
  - `plans/calendar-tasks.md` planned to reuse this webhook for a team-chat branch.
- **STOP rules from #207.**
  - `MessagingOptOut` (keyed by Discord id, scope `followups`) applies to every channel.
  - The Telegram footer (`followups.footerTelegram`, default "Reply STOP to stop these messages.")
    relies on typed STOP.
  - The Discord footer points at the Stop button.
- **Login Widget.**
  - `app/lib/telegram-auth.ts` (`telegramConfig()` reads `TELEGRAM_BOT_TOKEN` +
    `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`), `app/api/telegram/account/route.ts`, and
    `app/ui/telegram/TelegramLinker.tsx`.
  - The widget sets `data-request-access="write"`, which only grants write access to the **login**
    bot.
  - `TelegramAccount` is keyed by Discord id and holds the `telegramId`.
- **Announce.**
  - `app/lib/announce/run.ts` `postToTelegram` uses `ANNOUNCE_TELEGRAM_BOT_TOKEN` +
    `ANNOUNCE_TELEGRAM_CHAT_IDS`, with Markdown.
  - Both env vars are unset in Vercel, so this cross-post is inactive today.
- **City chats directory.**
  - `app/lib/chats.ts` reads rsv.pizza's `city_telegram_groups` over Supabase PostgREST with the
    anon key (no chat ids). It serves `/chats` and `/api/chats`.
  - **Likely broken:** rsv.pizza's migration `20261002_lockdown_anon_exposed_tables` enabled RLS on
    that table and revoked anon access. To verify: `/api/chats` needs a session, so it could not be
    checked from here.
- **Settings registry.**
  - `app/lib/settings/registry.ts` holds the keys and `toggles.ts` the switches.
  - Toggle order: env "off" wins, then an unreadable setting means off, then on a non-production
    deploy the saved rows are ignored, then the saved row, then the env legacy value.
  - The private call post filter `calls.postFilter` is read by `app/lib/calls/post-filters.ts`
    (`loadPostFilter()` throws, so callers skip posting).
  - The recap path is `app/lib/calls/recap.ts` `postCallRecap` (claim, then post once).
  - The agenda path is `app/lib/call-agenda/run.ts` `processPlan` (a `CallAgendaPost` claim, then
    post).
- **Existing preview hole (fix in this work).**
  - `loadFollowUpConfig()` honours a saved `followups.sendEnabled = 1` on **any** deploy.
  - `POST /api/admin/followups/[id]` calls `sendFollowUp` in `after()`.
  - So approving a row on a preview deploy (which shares the prod DB) can send a real Discord DM.
- **Service-to-service with rsv.pizza.**
  - The app already calls `RSV_PIZZA_API_URL` (default `https://api.rsv.pizza`) with
    `x-service-key: RSV_PIZZA_SERVICE_KEY` (`app/lib/mission-verify/semi.ts`,
    `app/lib/payments/rsv-track.ts`).
- **People data in the app.**
  - `MemberProfileExtras.email` + `emailVerifiedAt` hold an address the member verified with a
    signed link.
  - `MemberWallet` comes mostly from the sheet (`source: "sheet"`) and is not ownership-verified.
  - The sheet's Telegram @handles are self-entered and public.

### rsv-pizza (backend: Express + Prisma 6, Vercel, deploys from `master` only, no backend previews)
- **The bot token is `TELEGRAM_BOT_TOKEN` in the rsv.pizza backend.**
  - Every message is signed with `withBennySignature`.
  - Senders: `services/telegramSend.ts` (DM, plain or parse mode, returns `{ok}|{ok:false,reason}`)
    and `services/cityTelegramGroup.ts` `sendToCityGroup(cityKey, text, parseMode?, replyMarkup?)`.
  - `sendToCityGroup` resolves `city_telegram_groups.chat_id` lazily from the inbound service. It
    retries and persists supergroup migrations, and re-pulls the id once on "chat not found".
- **Inbound.** Updates are consumed by the separate inbound service. It calls back:
  - `POST /api/telegram/link-host`: deep-link taps. It sets `parties.host_telegram_chat_id` only
    when the tapper's @handle matches the owner's `User.telegram`.
  - `POST /api/telegram/host-inbound`: replies to the bot. **Photos, PDFs and a bare number from a
    host are filed as receipts, photos or attendance.**
- **Service routes.**
  - `routes/service.routes.ts` gates on `x-service-key` = `PIZZADAO_SERVICE_KEY`, using
    `safeEqual` + `requireServiceKey`, 60/min.
  - It is mounted at `/api/service`.
  - Tests use supertest with a mocked prisma (`service.routes.test.ts`).
- **Identity.**
  - `User.email` is unique (the login identity, though underbosses can also create parties for a
    typed address).
  - `User.telegram` is a self-entered handle. `User.payoutWalletAddress` is self-entered.
  - `parties.host_telegram_chat_id` is the owner's private chat. It is handle-verified and is the
    "primary outbound DM target".
  - `party_telegram_hosts` lists bot-verified co-host chats (not tied to a specific co-host).
  - **No Discord ids are stored** (see the `gppHostLookup.ts` header).
- **Migrations.** These are SQL files. Per the rsv CLAUDE.md, apply them to prod **before** merging
  the schema change, and CI runs `check:schema-drift`.

## Design overview

```
app.pizzadao.org                                   api.rsv.pizza
  login-only bot (widget HMAC only)                  rsv.pizza bot token (only here)
  outbox + follow-up sender  ── x-pizzadao-telegram-key ──►  /api/service/telegram/*
     DM:     POST /dm      {telegramUserId,text,buttons}  ──►  sendMessage (private)
     probe:  POST /probe   {telegramUserId}               ──►  sendChatAction typing
     group:  POST /city-post {cityKey,text}               ──►  sendToCityGroup()
     dir:    GET  /city-groups                            ◄──  city_telegram_groups (no chat ids)
     match:  POST /host-match {emailHashes}               ◄──  owner email → host_telegram_chat_id
```

**Chosen: an rsv.pizza send proxy.** Alternative: copy the rsv.pizza bot token into the app.

| | Proxy (chosen) | Token in the app |
|---|---|---|
| "Never setWebhook/getUpdates" | Guaranteed: the app can't | Only by code review |
| Supergroup migration, stale chat id refresh | Reused (`sendToCityGroup`) | Re-implemented, and can't persist into rsv.pizza |
| Group chat ids | Stay in rsv.pizza | Must be synced into the app DB |
| Blast radius of an app leak | One revocable, scoped key | The whole bot |
| Cost | An extra hop and an rsv.pizza PR | None |

**City → group mapping: fetch live, don't sync.**
- The app addresses groups by `cityKey`. rsv.pizza resolves the chat id at send time.
- The app only caches the directory (city keys, titles, region and country, `hasChat`) for about
  30 minutes. The admin settings use it to validate city keys, and `/chats` uses it too.
- A synced copy of chat ids in the app DB was rejected. It would drift on supergroup migrations
  (the bug `tonda-58293` fixed on the rsv.pizza side) and would duplicate sensitive ids.

## Env vars (exact, per project)

| Project | Var | Scope | Value / purpose |
|---|---|---|---|
| **pizzadao-org** (Vercel) | `TELEGRAM_LOGIN_BOT_TOKEN` | Production + Preview + Development | The new login-only bot's token. Server-only, used **only** for the widget HMAC. |
| | `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME` | Production + Preview + Development | The login bot's username (no `@`). |
| | `RSV_PIZZA_TELEGRAM_KEY` | **Production only** | Shared secret for `/api/service/telegram/*`. Not in Preview or Development, so previews can't reach the proxy at all. |
| | `TELEGRAM_SENDS_ENABLED` | Production (optional) | Kill switch. `off` / `0` / `false` / `no` blocks every Telegram send (DMs and groups) before any network call. Unset means the settings decide. |
| | `TELEGRAM_DM_ENABLED`, `TELEGRAM_CITY_POSTS_ENABLED`, `TELEGRAM_RECAP_MIRROR_ENABLED`, `TELEGRAM_AGENDA_MIRROR_ENABLED`, `TELEGRAM_ANNOUNCE_MIRROR_ENABLED`, `TELEGRAM_HOST_MATCH_ENABLED` | optional | Toggle env vars (the registry's legacy value). Leave them **unset** (off), set `off` for a hard kill, and use the settings page to turn things on in prod. |
| | `FOLLOWUP_LINK_SECRET` | Production; Preview gets a **different** value | HMAC key for signed follow-up action links (32+ random bytes). A preview-signed link never validates in prod. |
| | `NEXT_PUBLIC_TELEGRAM_SENDER_BOT_USERNAME` | Production + Preview | The rsv.pizza bot's username, used only to render a "Start the bot" `t.me` link on the profile. Not secret, but kept out of the public repo. |
| | **Remove** `TELEGRAM_WEBHOOK_SECRET` | all | The webhook goes away (PR P1). |
| | **Do not set** `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | — | Old names. The code stops reading them, which avoids confusion with the rsv.pizza backend's `TELEGRAM_BOT_TOKEN` (a different bot). |
| | `ANNOUNCE_TELEGRAM_BOT_TOKEN`, `ANNOUNCE_TELEGRAM_CHAT_IDS` | leave unset | Legacy, independent bot. See open question 3. Not the rsv.pizza token, and never set to it. |
| **rsv-pizza backend** (Vercel) | `PIZZADAO_TELEGRAM_SERVICE_KEY` | Production | Same value as the app's `RSV_PIZZA_TELEGRAM_KEY`. Unset means every `/api/service/telegram/*` route returns 503. This is the rsv.pizza-side kill switch. |
| | `PIZZADAO_TELEGRAM_DM_ENABLED`, `PIZZADAO_TELEGRAM_GROUPS_ENABLED`, `PIZZADAO_HOST_MATCH_ENABLED` | Production | Each must be `1` for its route family to act. Unset means 503 with `{reason:'disabled'}`, so the rsv.pizza owner can veto any part independently. |
| | `PIZZADAO_TELEGRAM_BUTTON_HOSTS` | Production | Comma-separated hosts allowed in URL buttons and links (`app.pizzadao.org`). Anything else is a 400. |
| | `TELEGRAM_BOT_TOKEN` | existing | Unchanged. |

**How `ANNOUNCE_TELEGRAM_BOT_TOKEN` relates:**
- It is a third, legacy bot path, and nothing sets it today.
- The new announce mirror (part 2) goes through the proxy to city groups and does not use it.
- P3 marks `ANNOUNCE_TELEGRAM_*` deprecated in `.env.example`. It is removed later if open
  question 3 is answered "remove".

The admin applies secrets with scripts (generate the key, then `vercel env add` in both projects).
Values are never echoed or committed.

## Part 3: login-only bot (ship first, no rsv.pizza dependency)

### PR P1 (pizzadao-org): "Telegram: login-only bot, drop the webhook, close the preview send hole"
**Changed**
- `app/lib/telegram-auth.ts`:
  - `telegramConfig()` reads `TELEGRAM_LOGIN_BOT_TOKEN` + `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME`.
  - Update the comments: the bot never sends.
- `app/api/telegram/account/route.ts`:
  - Use the new names.
  - GET returns `telegramDm: { state, botUsername }` from `TelegramReach` (P2). Until then it
    returns `{ state: 'unknown' }`.
  - Stop returning `dmAllowed`.
- `app/ui/telegram/TelegramLinker.tsx`:
  - **Remove `data-request-access="write"`.** The login bot never DMs, so asking for write access
    is misleading.
  - Copy: "Linking lets PizzaDAO recognise your Telegram. To get messages, start the PizzaDAO
    Telegram bot" (the link is added in P2).
- `app/lib/followups/config.ts` (**bug fix**): `sendEnabled` additionally requires
  `env.VERCEL_ENV === 'production'`. Add a test: preview + saved 1 means held.
- `app/lib/followups/telegram.ts`: removed in P2. In P1 it is left untouched apart from the token
  name, so P1 stays small. Its `telegramBotToken()` now returns `null` always (no sender token in
  the app), which makes Telegram follow-ups a no-op until P2.
- `.env.example`:
  - New names.
  - Remove `TELEGRAM_WEBHOOK_SECRET` and the set-webhook instructions.
  - Mark `ANNOUNCE_TELEGRAM_*` as legacy.
- `plans/calendar-tasks.md`: add a note that the Telegram webhook branch is gone (see open
  question 6).

**Removed**
- `app/api/telegram/webhook/route.ts` and `route.test.ts`.
- `app/lib/followups/telegram-updates.ts` and its test.
- `app/lib/followups/webhook-auth.ts`.
- `scripts/telegram-set-webhook.mjs`.
- `answerCallback` in `telegram.ts`.

Repurposing the route for the login bot was rejected: that bot receives nothing worth handling,
and an open endpoint is just attack surface.

**Not changed:** the `TelegramAccount.dmAllowed` column stays (migrations are additive). It is
ignored from P2 on and dropped in a later cleanup PR.

**The admin (outside the repo):**
1. Create the login bot in BotFather.
2. Run `/setdomain app.pizzadao.org`.
3. Set no webhook, no commands and no description beyond "Login for app.pizzadao.org".
4. Set the env vars above.
5. Delete `TELEGRAM_WEBHOOK_SECRET`.

## Part 1: follow-up DMs through the rsv.pizza bot

### PR R1 (rsv-pizza): `/api/service/telegram` send proxy + directory
**New:** `backend/src/routes/service-telegram.routes.ts`, mounted in `index.ts` as
`app.use('/api/service/telegram', serviceTelegramRoutes)`. Mount it **before** `/api/service`.

**Auth**
- New `requireTelegramServiceKey`: header `x-pizzadao-telegram-key` against
  `PIZZADAO_TELEGRAM_SERVICE_KEY`, reusing `safeEqual`.
- Unset key: 503. Mismatch: 401.
- `Cache-Control: private, no-store`.
- Identifiers go in bodies, never in URLs.

**Limiter:** express-rate-limit with `keyGenerator: () => 'pizzadao'` (per key, not per Vercel
IP), 120 requests/min. That sits on top of the global limiter (500 per 15 min per IP; our volume is
far below it).

**`GET /city-groups`**
- Returns `{ ok, groups:[{ cityKey, title, country, region, chatUrl, hasChat }] }` and never
  `chat_id`. Cache it for 5 minutes in memory.
- Needs only the key (no `*_ENABLED` flag): it reads the same data that used to be anon-readable,
  minus the ids.

**`POST /dm`** (needs `PIZZADAO_TELEGRAM_DM_ENABLED=1`)
- Body: `{ telegramUserId: digits ≤20, text ≤3500, buttons?: [[{text≤40, url}]] (≤3 rows × 3), idempotencyKey: [A-Za-z0-9:_-]{8,80} }`.
- Rejects: a non-positive id (groups can't be DMed here), a URL whose host is not in
  `PIZZADAO_TELEGRAM_BUTTON_HOSTS`, and any non-https URL.
- Sends plain text (no `parse_mode`) with `disable_web_page_preview: true`.
- Uses a new `sendServiceDm()` in `services/telegramSend.ts`. It returns the Telegram
  `message_id`, `error_code`, `description` and `retry_after`. The existing `sendTelegramMessage`
  stays unchanged.
- Keeps `withBennySignature` (it is the bot's convention).
- Response: `{ ok:true, messageId }`, or `{ ok:false, code }` where `code` is one of:
  - `not_started`: 400 "chat not found" or 403 "can't initiate conversation".
  - `blocked`: 403 "bot was blocked by the user" or "user is deactivated".
  - `rate_limited` (+ `retryAfter`): 429.
  - `bad_request`: another 400.
  - `uncertain`: a 5xx, a timeout or a network error. The message may have been delivered.
- The HTTP status is 200 for every Telegram outcome. 4xx/5xx are only for our own validation,
  auth or config.

**`POST /probe`** (DM flag)
- Body: `{ telegramUserId }`. It calls `sendChatAction(action:'typing')`.
- Returns `{ ok, reachable, code }` with the same code mapping.
- It is the only "check" we have: the user sees "typing…" for about 5 s, and only if they started
  the bot.

**`POST /city-post`** (needs `PIZZADAO_TELEGRAM_GROUPS_ENABLED=1`)
- Body: `{ cityKey ≤80, text ≤3500, idempotencyKey }`. It calls the existing
  `sendToCityGroup(cityKey, text)`.
- Per-cityKey in-memory floor: at most 1 post per 5 s and 10 per minute per cityKey per instance.
  Above that it returns `rate_limited`.
- Returns `{ ok:true, messageId?, migratedTo? }`, or `{ ok:false, code: 'no_group'|'rate_limited'|'kicked'|'bad_request'|'uncertain', retryAfter? }`.
- `sendToCityGroup` returns `skipped` for "no group" and a description string otherwise. Map the
  description with a small classifier.
- Small change in `cityTelegramGroup.ts`: return `messageId`, `errorCode` and `retryAfter` (an
  additive result field).

**Idempotency migration** (rsv, additive SQL `backend/prisma/migrations/<date>_pizzadao_service_sends.sql`
+ `schema.prisma` model `PizzadaoServiceSend`). **Apply it to prod before merging.**

```sql
CREATE TABLE IF NOT EXISTS pizzadao_service_sends (
  idempotency_key text PRIMARY KEY,
  kind            text NOT NULL,          -- dm | city_post
  target          text NOT NULL,          -- telegram user id, or city key
  status          text NOT NULL,          -- pending | sent | failed | uncertain
  message_id      bigint,
  code            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pizzadao_service_sends_target_idx ON pizzadao_service_sends (kind, target, created_at);
ALTER TABLE pizzadao_service_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pizzadao_service_sends FROM anon, authenticated;
```

**Idempotency flow**
- Insert `pending` first. On a primary-key conflict, return the stored outcome (`sent` → `{ok:true,
  messageId, replay:true}`, `pending` or `uncertain` → `{ok:false, code:'uncertain'}`).
- Then send and update the row. A retried app request therefore never double-sends.
- The stored `message_id` also lets a later inbound change recognise replies to our DMs (open
  question 5).
- Rows are pruned after 60 days by the existing hourly survey cron, or by a one-line delete in the
  route.

**Tests:** `service-telegram.routes.test.ts` (supertest, with mocked prisma and fetch):
- 503 when unset or disabled, 401 on a bad key.
- Validation: a negative id, a foreign button host, http, oversize text.
- The code mapping for each Telegram error.
- Idempotent replay.
- `/city-groups` never contains `chatId`.
- The per-city floor.
- Also a test that **no route calls `setWebhook`/`getUpdates`/`deleteWebhook`/`setMyCommands`**: a
  grep test over the file.

### PR P2 (pizzadao-org): follow-ups over the proxy, link buttons, reachability
Depends on R1 being deployed, with `PIZZADAO_TELEGRAM_DM_ENABLED` set.

**Migration** `prisma/migrations/2026110x000000_telegram_reach/migration.sql`. Use the next free
timestamp after the latest folder on main. It is additive:

```prisma
enum TelegramReachState { UNKNOWN OK NOT_STARTED BLOCKED }

/// Whether the rsv.pizza bot can DM this Telegram user. Shared by login-linked and host-matched ids.
model TelegramReach {
  telegramId  String             @id
  state       TelegramReachState @default(UNKNOWN)
  failures    Int                @default(0)   // consecutive not_started results
  checkedAt   DateTime?
  recheckAt   DateTime?                        // don't try Telegram before this (NOT_STARTED backoff)
  lastCode    String?            @db.VarChar(32)
  updatedAt   DateTime           @updatedAt
}

// FollowUp gains:
//   snoozedUntil DateTime?
//   telegramFallback String? @db.VarChar(32)   // why Telegram was skipped/failed (audit + queue badge)
```

**New: `app/lib/telegram/rsv-client.ts`.** It is the **only** module that talks to the proxy:
- `telegramSendAllowed(env)`: true only if all of these hold:
  - `VERCEL_ENV === 'production'`,
  - `RSV_PIZZA_TELEGRAM_KEY` is set,
  - `TELEGRAM_SENDS_ENABLED` is not off.
- `sendDm`, `probe`, `cityPost`, `cityGroups` and `hostMatch`:
  - Each has a 10 s timeout. A timeout maps to `uncertain`.
  - Each takes a typed result union matching the rsv.pizza codes.
  - The key is never logged.
- A unit test asserts that the module source contains no `api.telegram.org`, which keeps the
  "no token in the app" rule.

**New: `app/lib/telegram/reach.ts`**
- `canTryTelegram(reach, now)`:
  - UNKNOWN or OK: yes.
  - BLOCKED: no (cleared only by the member's "check again").
  - NOT_STARTED: only after `recheckAt`.
- `recordResult(telegramId, code, now, cfg)`:
  - `ok`: OK, `failures=0`.
  - `not_started`: NOT_STARTED, `failures+1`,
    `recheckAt = now + min(dmRecheckDays × 2^(failures-1), dmRecheckMaxDays)`.
  - `blocked`: BLOCKED.
  - `uncertain` and `rate_limited`: unchanged.

**Changed: `app/lib/followups/send.ts`**
- `decideSend` takes `telegramEligible` instead of `telegramDmAllowed`. Eligible means all of:
  - the `telegram.dmEnabled` toggle is on,
  - `telegramSendAllowed()`,
  - the member has a Telegram id (a `TelegramAccount`, or a **confirmed** `TelegramHostMatch` from
    part 4),
  - `canTryTelegram`.
- When it's not eligible, the reason goes in `telegramFallback` (`no-link`, `not-started`,
  `blocked`, `off`).
- `deliverOverChannels` Telegram branch: `rsv.sendDm(...)` with
  `idempotencyKey = fu:<id>:<sendAttemptAt ms>` and URL buttons.
  - `not_started` or `blocked`: record the reach, write a `telegram-undeliverable` event, and fall
    through to Discord (today's behaviour for 403).
  - `rate_limited`: return `{ok:false, retryAt}`. The row goes back to APPROVED with `sendAfter`,
    and `sendAttemptAt` is cleared, because rsv.pizza guarantees nothing was sent.
  - `uncertain`: unchanged rule. No Discord fallback, FAILED "check before re-approving".
  - `bad_request`: fall through to Discord and log it.
- **Discord DMs** keep their component buttons (the interactions route is unchanged). They also get
  an "Open in app" link button (style 5) to the same `/fu/<token>` page.

**Changed: `app/lib/followups/buttons.ts`**
- Add `snooze` to the actions, plus `telegramUrlKeyboard(id, locale)`.
- The keyboard is `[[Done, On it],[Snooze, Need help],[Open / reply, Stop these messages]]`. Each
  button is a URL `${appUrl}/fu/<signed token>`.
- The `callback_data` keyboard is deleted.

**New: `app/lib/followups/links.ts`**
- Token = `base64url(JSON{f:id,a:action,e:expSec,v:1}).base64url(HMAC-SHA256(FOLLOWUP_LINK_SECRET))`.
- It is valid for `followups.linkTtlDays`, with constant-time verify.
- One token per action. The link bodies carry no names and no message text.

**New: the member page and API**
- `app/fu/[token]/page.tsx` (server component, i18n en/es/fr via `messages/*.json`).
- **GET never mutates.** It shows the ask and a confirm button. Link previews and prefetchers
  therefore can't mark things done or opt people out.
- "Open / reply" shows a text box. It posts the reply through `applyMemberAction('reply')`, so
  approvers still get reply alerts. **This replaces Telegram text replies.**
- The page is `noindex` and sends no referrer.
- `app/api/fu/[token]/route.ts` handles the POST: verify the token, then
  `applyMemberAction({ followUpId, discordId: row.ownerDiscordId, actorId: 'link:<action>', action, text? })`.
  - Possession of the link is the authority, as with an email unsubscribe link.
  - Rate limit: `app/lib/rate-limit.ts`, 10/min per token and 30/min per IP.
  - A row that is no longer open returns the existing "already closed" result.
- `snooze`: sets `snoozedUntil = now + followups.snoozeDays` and adds an event. The status is
  unchanged. It shows in the queue, and phase-4 reminders must respect it. It does not alert the
  approvers.
- `stop`: the same `optOut()` as before, so the per-channel STOP rules from #207 hold. One
  opt-out (Discord button, Telegram link, admin) stops follow-ups on **every** channel, and later
  items escalate as "opted out". The confirmation page offers "undo" (deletes the opt-out row) for
  10 minutes.

**Changed: `app/lib/followups/actions.ts`:** add a `snooze` branch (`SNOOZE` is not a status).

**Changed: `app/lib/followups/notify.ts`:** approver escalations go over `rsv.sendDm` with the same
reach rules. The fallback is a Discord DM (unchanged).

**Changed: `app/lib/followups/resolve.ts`, `admin.ts`, `FollowUpQueue.tsx`**
- The channel badge reads `TelegramReach`, not `dmAllowed`.
- The queue header shows "Telegram reachable: x / linked: y".
- A row shows the `telegramFallback` reason.

**Changed: the registry**
- `followups.footerTelegram` gets a new default: "Replies to this bot aren't read. Use the buttons
  above to answer, snooze or stop these messages."
- Add `check: v => !/\breply\s+stop\b/i.test(v)` with the message "Typed STOP can't be read on
  Telegram any more".
- If a saved row still says "Reply STOP", it is invalid, so the failure mode applies and the new
  default is used.

**Changed: the profile**
- `TelegramLinker` gets a card shown after linking: the state from `/api/telegram/account`.
  - Not started: "Start the bot" (`t.me/<NEXT_PUBLIC_TELEGRAM_SENDER_BOT_USERNAME>`), then a
    "Check again" button.
  - Blocked: "Unblock the bot in Telegram, then check again".
- New `POST /api/telegram/account/check` (session-gated, 3 per 10 min per member): it calls
  `rsv.probe` and records the reach. On a preview it returns `{state:'unknown', preview:true}`
  without calling.

**Removed:** the Bot API client in `app/lib/followups/telegram.ts` (`sendTelegramMessage`,
`telegramApi`, `cannotMessage`). Callers move to `rsv-client`.

**Settings (P2)**, area `followups` / new area `telegram` (add it to `SettingArea` and
`AREA_LABELS`):

| Key | Type | Default | Bounds | Notes |
|---|---|---|---|---|
| `telegram.dmEnabled` | toggle (env `TELEGRAM_DM_ENABLED`) | off | bool | Also needs `followups.sendEnabled`. Previews: env only. |
| `telegram.dmRecheckDays` | int | 7 | 1–90 | First NOT_STARTED backoff, doubled per consecutive failure. |
| `telegram.dmRecheckMaxDays` | int | 60 | 7–180 | Cap. |
| `followups.linkTtlDays` | int | 30 | 7–90 | Action link lifetime. |
| `followups.snoozeDays` | int | 3 | 1–14 | |
| `followups.footerTelegram` | text | new default above | ≤200, non-empty, no "reply stop" | |

## Part 2: city group posts

### Which posts are mirrored (recommendation)
| Source | Mirror? | Target groups | Gate |
|---|---|---|---|
| Call recap (`postCallRecap`, on publish) | yes | `telegram.crewCityGroups[crewId]` | `calls.recapPostEnabled` (+ the imported gate) + `telegram.cityPostsEnabled` + `telegram.recapMirrorEnabled` |
| Pre-call agenda (`processPlan`) | yes | same mapping | `calls.agendaPostEnabled` + `telegram.cityPostsEnabled` + `telegram.agendaMirrorEnabled` |
| Community Call announcement (`runAnnouncement`) | yes | `telegram.announceCityKeys` | `telegram.cityPostsEnabled` + `telegram.announceMirrorEnabled` |
| Follow-ups, notifications, mission cards, proposals, economy | **no** | — | Personal or Discord-only by nature. |

- **There is no "all cities" wildcard.** A crew row lists explicit city keys. Mapping a crew to
  every city group would spam hundreds of groups at once.
- **Crews map explicitly to cities.** Calls are per crew, not per city, so the admin decides which
  crew's recap a city group cares about (for example a regional crew → its cities).
- **A mirror only happens when the Discord post was claimed.** The publish approval and the
  once-only claim are shared, so Telegram never posts something Discord wasn't allowed to.

### PR P3 (pizzadao-org): the city mirror outbox
Depends on R1 being deployed, with `PIZZADAO_TELEGRAM_GROUPS_ENABLED` set.

**Migration** `2026110x000000_telegram_group_posts`, additive:

```prisma
enum TelegramPostStatus { PENDING SENT SKIPPED FAILED UNCERTAIN }

model TelegramGroupPost {
  id         String             @id @default(cuid())
  kind       String             @db.VarChar(16)   // recap | agenda | announce
  sourceId   String             @db.VarChar(120)  // CallRecording.id | `${eventId}:${startsAt}` | announce key
  crewId     String?            @db.VarChar(64)
  cityKey    String             @db.VarChar(80)
  text       String                               // plain text, already filtered when queued
  status     TelegramPostStatus @default(PENDING)
  attempts   Int                @default(0)
  sendAfter  DateTime?
  claimedAt  DateTime?
  expiresAt  DateTime                             // agenda: event start; others: now + postMaxAgeHours
  messageId  String?
  code       String?            @db.VarChar(32)
  createdAt  DateTime           @default(now())
  sentAt     DateTime?
  @@unique([kind, sourceId, cityKey])
  @@index([status, sendAfter])
  @@index([cityKey, sentAt])
}
```

**New**
- `app/lib/telegram/city-posts.ts`:
  - `enqueueMirror({kind, sourceId, crewId, text, expiresAt})`:
    - It checks `telegramSendAllowed()` and the toggles **at enqueue time**, so on previews and
      while off **nothing is even queued**.
    - It resolves the city keys from the settings.
    - It converts text with `discordTextToPlainText` (from `app/lib/discord-markup.ts`) and drops
      mentions.
    - It adds the app link and caps at 3500 chars.
    - It runs `createMany({ skipDuplicates: true })`.
  - `processOutbox(now)`:
    - It claims rows (`updateMany where status PENDING and claimedAt null`).
    - It **re-checks** `loadPostFilter()` per row:
      - The filter can't be read: release the row and retry next run.
      - The crew is now excluded, or the text contains a blocked term: SKIPPED.
    - Rows past `expiresAt`: SKIPPED.
    - Then `rsv.cityPost` with `idempotencyKey = tg:<row id>`.
    - Throttle: at most `telegram.maxSendsPerRun` per run, ≥150 ms between calls (≤7/s, well under
      30/s), and ≥ `telegram.groupGapSeconds` since that city's last `sentAt` (≤20/min per group).
    - Results:
      - `rate_limited`: `sendAfter = now + retryAfter`, attempts+1.
      - `no_group` or `kicked`: SKIPPED with the code.
      - `uncertain`: UNCERTAIN, never retried automatically.
      - After 5 attempts: FAILED.
- `app/api/cron/telegram-posts/route.ts`:
  - `isCronAuthorized`, every 5 min, with a 200 s budget.
  - No-op unless `telegramSendAllowed()`.
  - Add it to `vercel.json` and `app/api/cron/cron-routes.test.ts`.
- `app/admin/telegram/page.tsx` (DPR / admin guard):
  - The last 100 outbox rows (city, kind, status, code, time).
  - The `/city-groups` directory with `hasChat`.
  - A "skip" action for a PENDING row.
  - Text is shown to admins only. It is already-filtered public post text.
- `app/lib/chats.ts`: read from `rsv.cityGroups()` when the key is configured. Otherwise keep the
  Supabase anon read as the fallback (it may fail since the lockdown). That fixes `/chats` in prod.

**Changed (enqueue hooks, each wrapped so a Telegram failure never affects Discord)**
- `app/lib/calls/recap.ts` `postCallRecap`: right after a successful claim (all the existing
  checks have passed: filter, crew exclusion, imported gate, stale redactions), call
  `enqueueMirror({kind:'recap', sourceId: rec.id, crewId: rec.crewId, text: buildRecapText(rec, base, filter, limits)})`.
- `app/lib/call-agenda/run.ts` `processPlan`: after the `callAgendaPost.create` claim, call
  `enqueueMirror({kind:'agenda', sourceId: \`${eventId}:${startsAt.toISOString()}\`, crewId, text: p.message, expiresAt: p.startsAt})`.
- `app/lib/announce/run.ts`: after a successful Discord send, call
  `enqueueMirror({kind:'announce', sourceId: <announce date key>, text: normalizeForCrossPosting(msgs.telegram)})`.
  - Plain text: the proxy sends no `parse_mode`. Strip the Markdown markers in
    `normalizeForCrossPosting`, or add a plain variant.
  - Legacy `postToTelegram` is untouched.

**Settings (P3)**

| Key | Type | Default | Bounds | Notes |
|---|---|---|---|---|
| `telegram.cityPostsEnabled` | toggle (env `TELEGRAM_CITY_POSTS_ENABLED`) | off | bool | Master switch for all group mirrors. confirmOn text. |
| `telegram.recapMirrorEnabled` | toggle (env `TELEGRAM_RECAP_MIRROR_ENABLED`) | off | bool | |
| `telegram.agendaMirrorEnabled` | toggle (env `TELEGRAM_AGENDA_MIRROR_ENABLED`) | off | bool | |
| `telegram.announceMirrorEnabled` | toggle (env `TELEGRAM_ANNOUNCE_MIRROR_ENABLED`) | off | bool | |
| `telegram.crewCityGroups` | table `{crewId text≤64, cityKeys text≤500}` | `[]` | ≤50 rows, ≤20 city keys per row, keys `^[a-z0-9 .'-]{2,80}$` | On save, the API checks each key against `/city-groups` and warns on unknown keys or `hasChat:false`. |
| `telegram.announceCityKeys` | stringList | `[]` | ≤20 items, ≤80 chars | Same check. |
| `telegram.maxSendsPerRun` | int | 25 | 1–100 | |
| `telegram.groupGapSeconds` | int | 10 | 3–60 | 3 s is the 20/min Telegram per-group limit. |
| `telegram.postMaxAgeHours` | int | 12 | 1–72 | A queued recap or announce older than this is skipped. |

Each toggle is added to `TOGGLES` in `toggles.ts`. The env "off" always wins, and previews ignore
saved rows. `registry.test.ts` locks the defaults (all off or empty).

## Part 4: optional host matching

### Join key (both schemas checked)
| Candidate | rsv.pizza side | App side | Verdict |
|---|---|---|---|
| Telegram user id | `host_telegram_chat_id` (handle-verified) | only after the Login Widget | It is what we want to *learn*, so it can't be the key. |
| Discord id | not stored | yes | Impossible. |
| Wallet | `User.payoutWalletAddress` (self-entered) | `MemberWallet` (mostly from the sheet, unverified) | **Rejected.** Addresses are public, so anyone can claim one. |
| Telegram @handle | `User.telegram` / `party_telegram_hosts.username` | public crew sheet (self-entered) | **Rejected** as a key. Anyone can type someone else's handle in the sheet. |
| **Email** | `User.email` (login identity; underbosses can type it for a host) | `MemberProfileExtras.email` **with `emailVerifiedAt`** | **Chosen**, plus a two-sided confirmation (below). An rsv.pizza email could have been typed by an underboss, so a match alone is not proof. |

The rsv.pizza side only uses the **party owner's** `host_telegram_chat_id` (positive ids only). It
is set only when the tapper's handle matched the owner's `User.telegram`.
`party_telegram_hosts` is excluded because those chats aren't tied to a specific co-host.

### PR R2 (rsv-pizza): `POST /api/service/telegram/host-match`
- Needs `PIZZADAO_HOST_MATCH_ENABLED=1` and the same key.
- Its own limiter: 10 requests/min, ≤100 hashes per request.
- Body: `{ emailHashes: string[] }`, each `sha256(lower(trim(email)))` as hex. The app never sends
  plain addresses.
- Logic:
  1. Select `User.id, email` for users who own ≥1 party with `host_telegram_chat_id > 0` (a small
     set).
  2. Hash them in memory and intersect.
  3. For each match, take the chat id of the owner's most recently updated party.
  4. If one email maps to different chat ids across parties, return none for it (ambiguous).
- Response: `{ ok, matches: [{ emailHash, telegramUserId, handleHint }] }`.
  - `handleHint` is the first 2 characters of `User.telegram` + `…`, for the member's "is this
    you?" card. Or null.
  - No party, city, name or email is returned.
- Tests: hashing, ambiguity, the negative id filter, limits, 503 when disabled, and the minimal
  fields.

### PR P4 (pizzadao-org): matching and consent
**Migration** `2026110x000000_telegram_host_match`, additive:

```prisma
enum HostMatchConsent { PENDING INVITED CONFIRMED DECLINED }

model TelegramHostMatch {
  discordId   String           @id
  memberId    String
  telegramId  String           @unique
  handleHint  String?          @db.VarChar(8)
  matchedBy   String           @default("email") @db.VarChar(16)
  consent     HostMatchConsent @default(PENDING)
  invitedAt   DateTime?
  decidedAt   DateTime?
  matchedAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}
```

**New**
- `app/lib/telegram/host-match.ts` `runHostMatch()`:
  - It covers members with a verified email and a Discord id (from the member sheet). It skips
    anyone with a `TelegramAccount` or an existing match.
  - It sends hashes in batches of 100.
  - It upserts PENDING rows. It skips a `telegramId` that is already in `TelegramAccount` for
    another Discord id: **a login always wins**, and the conflict is logged without ids.
  - A later Login Widget link replaces the match (the link route deletes the match row).
  - It runs from the existing `/api/cron/followups` route once a day (a "daily slot" check),
    gated by the `telegram.hostMatchEnabled` toggle and `telegramSendAllowed()`.
- **Consent (recommended: member-confirmed, two-sided).**
  - A match is **never** used for follow-up content until it is `CONFIRMED`.
  - Confirmation needs **both** of these:
    - (a) the member, logged in with Discord, clicks "Yes, that's me" on the profile card ("We
      found a Telegram account (`ab…`) linked to your rsv.pizza hosting. Use it for PizzaDAO
      follow-ups?").
    - (b) a tap on a signed link that **the rsv.pizza bot DMs to that Telegram account**:
      "Confirm this Telegram for your PizzaDAO account". The link carries no follow-up content and
      opens `/telegram/confirm/<token>`, which requires the same Discord session.
  - That proves the Telegram holder and the app member are the same person, which protects against
    a mistyped or underboss-entered rsv.pizza email.
  - Discord follow-ups to a PENDING member carry one extra line: "Prefer Telegram? Confirm here:
    <profile link>".
  - "No" sets DECLINED, and the member is never asked again.
- `telegram.hostMatchMode`:
  - `1` (default once enabled): only member-initiated. (b) is sent only after the member clicks
    (a).
  - `2`: also invite proactively. When a follow-up is approved for a PENDING member, send **one**
    rsv.pizza DM, "PizzaDAO would like to send you call follow-ups here. Confirm: <link>", and set
    INVITED. The follow-up itself still goes to Discord, and there is no second invite.
- `app/api/telegram/host-match/route.ts`: session-gated GET (the card state) and POST (`confirm`,
  `decline`, `send-confirmation`), 3 per 10 min per member.
- `app/telegram/confirm/[token]/page.tsx` + POST: verify the token (`FOLLOWUP_LINK_SECRET`, a
  `tc:` prefix, 48 h TTL) and that the session Discord id matches. Then set CONFIRMED and record a
  `TelegramReach` OK.

**Changed**
- `send.ts` / `store.ts` `loadOwnerContext`: the Telegram id comes from `TelegramAccount`, else
  from a `TelegramHostMatch` with `consent = CONFIRMED`.
- `app/api/telegram/account/route.ts` POST: on a widget link, delete any match row for that Discord
  id.
- The profile UI: the match card.

**Settings (P4)**

| Key | Type | Default | Bounds |
|---|---|---|---|
| `telegram.hostMatchEnabled` | toggle (env `TELEGRAM_HOST_MATCH_ENABLED`) | off | bool |
| `telegram.hostMatchMode` | int | 1 | 1–2 |

**Privacy notes**
- The hosts consented to rsv.pizza event messages. App follow-ups are a different purpose, hence
  explicit opt-in and no content before confirmation.
- Only hashes cross the wire, and only a Telegram id and a 2-character hint come back.
- The confirmation DM is short and comes from the bot they already started.

## PR order

1. **P1** (pizzadao-org): login bot rename, remove the webhook and script, the preview send fix.
   Independent.
2. **R1** (rsv-pizza): the proxy and directory. Apply the SQL to prod first, then merge. Then the
   admin sets the rsv.pizza env vars.
3. **P2** (pizzadao-org): DMs over the proxy, link actions, reachability. Then the admin sets the
   app env vars in Production.
4. **P3** (pizzadao-org): the city mirror outbox and the `/chats` fix. It can go in parallel with
   P2 after R1. It touches different files except the registry and the rsv client (whoever lands
   second rebases).
5. **R2** (rsv-pizza): host-match. Can be built any time after R1.
6. **P4** (pizzadao-org): host matching and consent. Needs P2 and R2.
7. Later cleanup PR: drop `TelegramAccount.dmAllowed` and the legacy `ANNOUNCE_TELEGRAM_*` path
   (per open question 3).

## Failure modes

| Failure | Behaviour |
|---|---|
| A preview deploy | `telegramSendAllowed()` is false (`VERCEL_ENV`), and the key isn't in Preview. Toggles ignore saved rows, so nothing is queued or sent. The P1 fix stops preview Discord follow-ups too. |
| The rsv.pizza key is unset or wrong | 503/401. The client returns `not_configured`. DMs fall through to Discord, and outbox rows stay PENDING (alerted in the admin page). |
| rsv.pizza is down, or there's a timeout | DM: `uncertain`, then FAILED "check before re-approving" (no double send). Group: UNCERTAIN, not retried. Idempotency keys make a manual retry safe. |
| The user never started the bot / blocked it | NOT_STARTED with exponential recheck, or BLOCKED until "check again". The follow-up goes to Discord, and the reason shows in the queue. |
| Telegram 429 | `retryAfter` from rsv.pizza leads to `sendAfter`. Per-run and per-group throttles keep us far below 30/s and 20/min per group. |
| A group was migrated to a supergroup, or the id is stale | Handled inside `sendToCityGroup` (retry + persist + refresh). |
| No group for a city, or the bot was kicked | SKIPPED `no_group` / `kicked`, visible in `/admin/telegram`. |
| The post filter can't be read, or now excludes the item | Not queued (the recap/agenda already return early). At send time: release and retry, or SKIPPED. |
| A host replies to our DM with a number or photo | **The inbound service may file it as attendance, a receipt or a photo for their party.** Mitigation: the footer says replies aren't read, and every action is a button. Real fix: open question 5. |
| A member types STOP to the rsv.pizza bot | We never see it. The footer and the Stop button cover it. Open question 5 covers forwarding. |
| Leaked action link | It allows done/snooze/stop/reply on one follow-up for ≤30 days. GET never mutates, there's a rate limit, and stop can be undone. No PII in the URL. |
| A wrong host match | No content is ever sent before the two-sided confirmation. |
| A Login Widget token mismatch after the rename | The widget fails verification. The env vars are set before the P1 deploy (rollout step). |

## Test plan

**rsv-pizza (vitest + supertest, `npm --prefix backend test`)**
- Auth: 503 when the key is unset, 401 on a mismatch, 503 when the per-part flags are unset.
- `/dm`: validation (negative or non-numeric id, non-https or foreign button host, text > 3500,
  more than 3×3 buttons). The Telegram error mapping (400 chat not found → `not_started`, 403
  blocked → `blocked`, 429 → `rate_limited` + `retryAfter`, 500 or abort → `uncertain`). An
  idempotent replay returns the stored result and makes no second fetch.
- `/probe`: mapping.
- `/city-post`: calls `sendToCityGroup` with the key; the per-city floor; the `skipped` →
  `no_group` mapping.
- `/city-groups`: there is no `chatId` and no `chat_id` anywhere in the JSON.
- `/host-match` (R2): hashing, ambiguity, the positive-id filter, ≤100 hashes, minimal response
  fields.
- A static test: the route file contains none of
  `setWebhook|deleteWebhook|getUpdates|setMyCommands|setdomain`.
- `npm --prefix backend run check:schema-drift` after applying the SQL.

**pizzadao-org (vitest, `npx tsc --noEmit`, `npm run lint`, `npm run test:run`)**
- P1:
  - `telegram-auth` reads the new env names.
  - The linker has no `data-request-access`.
  - The webhook route and script files are gone (the cron/route listing tests are updated).
  - `loadFollowUpConfig` is held on a preview with a saved 1.
- P2:
  - `rsv-client`: an off result on a preview, with no key, or with the kill env; the timeout maps
    to `uncertain`; no `api.telegram.org` in the source.
  - `reach.ts`: the backoff math, and that BLOCKED is sticky.
  - `decideSend`: eligibility matrix.
  - `deliverOverChannels`: not_started → Discord; uncertain → no Discord; rate_limited → defer and
    clear the attempt.
  - `links.ts`: round trip, tamper, expiry, a wrong secret.
  - `/api/fu/[token]`: GET doesn't mutate; POST runs done/snooze/stop/reply; not-yours or closed
    rows; rate limit.
  - The footer check rejects "Reply STOP".
- P3:
  - `enqueueMirror`: no rows on a preview, when off, or for an excluded crew; dedup on
    `(kind, sourceId, cityKey)`; plain-text conversion.
  - `processOutbox`: re-filters; skips expired rows; per-group gap; per-run cap; code handling.
  - The recap and agenda hooks are called only after a claim.
  - A Telegram error never changes the Discord result.
  - Registry defaults are off or empty, and the table bounds hold.
  - The cron is in `cron-routes.test.ts`.
- P4:
  - The match upsert skips existing links and conflicts.
  - A send never uses PENDING/INVITED/DECLINED matches.
  - The confirm token needs the same Discord session.
  - Mode 2 sends at most one invite.

**Vercel preview checks (pizzadao-org)**
- The profile shows the Telegram link button with the login bot.
  - Note: the widget only works on the bot's set domain (`app.pizzadao.org`), so on a preview it
    shows an "invalid domain" message. That is expected.
  - Verify the widget in prod right after deploy, with one admin account.
- `/admin/settings` shows the new `telegram.*` keys, all off. Saving a toggle on a preview shows it
  as saved, but the effective value stays off ("previews: env only").
- `/fu/<token>` with a preview-signed token renders the confirm page, and POST works against a test
  follow-up row created on the preview. The preview has a different `FOLLOWUP_LINK_SECRET`, so a
  prod token gives "invalid link".
- `/admin/telegram` lists the directory (preview: "not configured" banner, because the key is
  Production-only) and an empty outbox.
- Confirm in the preview's function logs that no request goes to `api.rsv.pizza/api/service/telegram`.

## Rollout checklist

1. The admin creates the login bot and sets its domain. The admin sets
   `TELEGRAM_LOGIN_BOT_TOKEN` and `NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME` (all scopes), then
   deletes `TELEGRAM_WEBHOOK_SECRET`.
2. Merge and deploy **P1**. In prod, link one admin Telegram through the widget and check that
   `TelegramAccount` has the id.
3. In rsv-pizza, apply `pizzadao_service_sends.sql` to prod, using the dry-run first. Merge **R1**.
4. The admin generates the shared key with a script. The admin sets
   `PIZZADAO_TELEGRAM_SERVICE_KEY` and `PIZZADAO_TELEGRAM_BUTTON_HOSTS` on rsv.pizza and
   `RSV_PIZZA_TELEGRAM_KEY` (Production only) on the app. `*_ENABLED` stays unset for now.
5. `curl` `/api/service/telegram/city-groups` with the key from a script: 200 and no chat ids.
6. Set `PIZZADAO_TELEGRAM_DM_ENABLED=1` on rsv.pizza. Merge and deploy **P2**. Set
   `FOLLOWUP_LINK_SECRET` (Production and a separate Preview value) and
   `NEXT_PUBLIC_TELEGRAM_SENDER_BOT_USERNAME`.
7. Check the saved `followups.footerTelegram` row: if it mentions "Reply STOP", reset it.
8. In prod, an admin starts the rsv.pizza bot, then uses "Check again" on the profile. The state
   becomes OK.
9. Turn on `telegram.dmEnabled`. With `followups.escalationDiscordIds` set to that admin only,
   approve one follow-up addressed to the admin. Check:
   - the Telegram DM arrives with the URL buttons, and Done / Snooze / Stop work through `/fu/...`;
   - Stop is undone;
   - a Discord fallback happens for a non-started test account.
10. Set `PIZZADAO_TELEGRAM_GROUPS_ENABLED=1`. Merge and deploy **P3**.
11. Map one crew to **one** test city group the admin controls. Turn on `telegram.cityPostsEnabled`
    + `telegram.recapMirrorEnabled`. Publish one call and watch `/admin/telegram` until it is SENT.
    Then enable the agenda and announce mirrors in the same way.
12. After 1 to 2 weeks of clean runs: R2, then set `PIZZADAO_HOST_MATCH_ENABLED=1`, then P4, then
    `telegram.hostMatchEnabled` (mode 1). Watch the match counts in the admin page.
13. Rollback at any step:
    - `TELEGRAM_SENDS_ENABLED=off` on the app (instant, needs a redeploy for env), or turn the
      toggle off (30 s cache);
    - or unset `PIZZADAO_TELEGRAM_SERVICE_KEY` on rsv.pizza (closes everything from their side).

## Risks

- **Replies leaking into rsv.pizza's host submission flow** (see the failure modes). This is the
  biggest real risk. Until open question 5 is resolved, keep follow-up DMs limited to approved rows
  (the case today) and keep the footer explicit.
- **Brand confusion:** follow-ups arrive from the rsv.pizza bot with its signature. The message
  starts with the follow-up text from the app's drafts. Consider an optional prefix setting later.
- **Shared rate budget:** the rsv.pizza bot also does underboss broadcasts (up to 500 groups,
  sequentially). Our throttles leave headroom, but a big rsv.pizza broadcast plus our run could
  still hit 429s. These are handled by `retryAfter`.
- **The rsv.pizza owner's veto:** the rsv.pizza-side flags let the owner switch off any part
  without an app deploy.
- **Low Telegram reach:** DMs only reach people who started the rsv.pizza bot. Many hosts have;
  most members haven't. The reach counter in the queue makes this visible.

## Alternatives considered

- **Keep #207's app-owned bot for DMs.** Rejected by the admin's decision. People would have to
  start a second bot, while many hosts already started the rsv.pizza one.
- **Copy the rsv.pizza token into the app.** Rejected (see the table): the rule against
  setWebhook would then depend on code review alone, and supergroup migration handling would be
  duplicated.
- **A sync of chat ids into the app DB.** Rejected: drift, and duplicated sensitive ids. A live
  directory without ids is enough.
- **Auto-use host matches without confirmation.** Rejected: a mistyped email would send follow-up
  content to a stranger.
- **Telegram Login Widget for host matching instead.** Kept as the normal path. Part 4 is only a
  shortcut for people who already proved control of their Telegram to rsv.pizza.

## Open questions (each with a recommended answer)

1. **Does the rsv.pizza owner agree to the proxy and the extra traffic?** Recommend yes, with their
   per-part env flags as their control. Volumes: a handful of DMs a day, a few group posts per call.
2. **Snooze semantics.** Recommend: a note plus `snoozedUntil` only (no automatic re-send, because
   nothing auto-sends today). Phase-4 reminders must wait until `snoozedUntil`.
3. **What about `ANNOUNCE_TELEGRAM_BOT_TOKEN`?** Recommend leaving it unset and deprecated. Remove
   the legacy `postToTelegram` path in the cleanup PR once the announce mirror is live. If the main
   (non-city) PizzaDAO Telegram chat also needs the announcement, ask rsv.pizza to register it as a
   pseudo-city key (for example `pizzadao`) in `city_telegram_groups` rather than keeping a second
   bot.
4. **Should action links need a Discord login?** Recommend no for done/snooze/stop/reply, the same
   as email unsubscribe links: low harm, undo for stop, a 30-day TTL. Require login only for the
   host-match confirmation (P4), where identity is the whole point.
5. **Can the inbound service ignore or forward replies to our DMs?** Recommend asking its owner for
   a small change:
   - When an inbound message's `reply_to_message.message_id` matches a
     `pizzadao_service_sends.message_id` for that chat (or it is a bare STOP word from a chat we
     DMed in the last 7 days), skip host-inbound handling.
   - Answer "This bot doesn't read replies to PizzaDAO follow-ups. Use the buttons."
   - Optionally POST it to a future app endpoint.
   - Until then, the footer warning is the mitigation.
6. **`plans/calendar-tasks.md` planned to read the team Telegram chat through our webhook.** That
   path is gone. Recommend dropping the Telegram branch of calendar-tasks for now (calls and manual
   items only). If needed later, have the inbound service forward matching team-chat messages to an
   authenticated app endpoint. The app must not get its own bot in that chat.
7. **Which crews map to which cities at launch?** Recommend starting with one regional crew →
   1 to 3 city groups, chosen by the admin on the settings page (data lives in the DB, not in code).
8. **A per-member choice of Telegram vs Discord.** Recommend not yet. The queue's per-row channel
   override plus Stop covers it. Add a profile preference only if members ask.
9. **The `/chats` page is probably broken since the rsv.pizza RLS lockdown.** Recommend verifying in
   prod now, and shipping the `/chats` fix (the proxy `/city-groups` read) as an early, standalone
   slice of P3 if it is broken.
