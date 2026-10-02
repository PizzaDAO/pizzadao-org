# calzone-93434: Log in with Telegram

Status: design. Step 1 (linking) shipped in the `telegram-and-support` PR; this doc covers step 2 (login).

## Where we are after step 1

- Sessions are Discord-only: `app/lib/session.ts` signs `{ discordId, username?, nick?, createdAt }` into the
  `pizzadao_session` cookie. Every authz check (`requireSession`, `requireAdmin`, ownership checks against the
  Sheets roster) keys off `discordId`.
- Members can now **link** Telegram on `/profile/[id]/edit` using the official Telegram Login Widget.
  `POST /api/telegram/account` verifies the widget payload server-side (`app/lib/telegram-auth.ts`:
  HMAC-SHA256 of the data-check-string keyed with SHA256(bot token), `auth_date` no older than 24h) and upserts
  a `TelegramAccount` row (`discordId` unique, `telegramId` unique).
- Because `telegramId` is unique, every linked Telegram account maps to exactly one Discord identity. That gives
  login a safe lookup: **Telegram id → TelegramAccount → discordId → normal session**.

## Proposed login flow (members who already linked Telegram)

1. `/login` shows a "Log in with Telegram" widget next to the Discord button, only when
   `telegramConfig()` is set (same env vars as linking).
2. The widget uses **redirect mode** (`data-auth-url="https://app.pizzadao.org/api/auth/telegram/callback"`)
   rather than `data-onauth`, so the login works without client JS state and mirrors the magic-login route.
3. `GET /api/auth/telegram/callback?id=..&first_name=..&auth_date=..&hash=..`:
   1. `verifyTelegramAuth(Object.fromEntries(searchParams), botToken, { maxAgeSeconds: 300 })`. Login gets a much
      shorter window than linking (5 minutes, not 24h), because a leaked callback URL is a bearer credential.
   2. **Replay protection.** Store `sha256(hash)` in a new `TelegramLoginNonce { hashSha256 @id, consumedAt }`
      table and reject on reuse. Prune rows older than 10 minutes. The existing `ConsumedToken` table is
      poll-specific (`pollId` is required), so it doesn't fit. Telegram does not issue nonces, so this is our only
      one-time-use guarantee inside the 5-minute window.
   3. `prisma.telegramAccount.findUnique({ where: { telegramId } })`. No row → redirect to
      `/login?loginError=telegram_not_linked` with copy explaining "log in with Discord once and link Telegram on
      your profile". We do **not** create accounts from Telegram alone (see Decisions).
   4. Refresh `username/firstName/photoUrl/authDate` on the row.
   5. Build the session exactly like `app/api/auth/magic-login/route.ts`: `createSessionToken({ discordId,
      username, nick, createdAt })`, `syncRolesOnLogin(...)`, and redirect to `/dashboard/{memberId}` or
      onboarding. Add `authMethod: "telegram"` to the session payload for auditing (optional field, so older
      cookies stay valid).
4. Audit: log `{ discordId, telegramId, ip, ua }` on each Telegram login (an `ActivityEvent`-style row or just
   structured logs).

### Guardrails

- **Re-check Discord guild membership** on Telegram login (`hasAnyRole`/guild member lookup). If the Discord
  account has left or been banned from the guild, refuse. Otherwise Telegram becomes a back door around Discord
  moderation.
- **Unlinking** (`DELETE /api/telegram/account`) immediately disables Telegram login for that member. That's
  already true, because login looks the row up on every attempt.
- **Changing the link** while logged in via Telegram: require the member to have logged in with Discord in the
  current session (`authMethod === "discord"`) before linking a *different* Telegram account. This stops a
  stolen Telegram account from re-pointing itself.
- Rate-limit the callback per IP and per telegramId (the auth/rate-limiting work in flight elsewhere should
  supply the helper).
- Admin routes: consider requiring `authMethod === "discord"` for `requireAdmin` so admin power always needs
  Discord. This is a cheap hardening step.

## Alternative: Telegram Mini App / bot deep-link login

Members could also log in from inside Telegram: a bot command `/login` replies with a one-time magic link
(reusing `MagicLoginToken` and `/api/auth/magic-login`), and the bot verifies the sender's `from.id` against
`TelegramAccount`. Telegram itself vouches for `from.id`, so this needs no widget and works on mobile where the
widget's popup is clunky. It requires a bot webhook endpoint (`/api/telegram/webhook`, secret-token header) and
a long-lived bot process or webhook registration. This is worth a second phase if widget login sees low mobile
use.

## Decisions needed

1. **Telegram-only signups?** Recommendation: no. Discord remains the identity of record (roles, crews, guild
   membership). Telegram login is a convenience for already-linked members. Allowing Telegram-only accounts
   means a `Session` without `discordId`, which touches every guard in the app.
2. **Login replay window**: 5 minutes plus one-time nonce (recommended), or the 24h window used for linking.
3. **Admin access via Telegram login**: allow, or require Discord (recommended: require Discord).
4. **Bot ownership**: which PizzaDAO-controlled Telegram account owns the bot behind `TELEGRAM_BOT_TOKEN`, and
   who can rotate the token. Rotating the token invalidates nothing stored (we keep no Telegram tokens), but
   in-flight widget payloads will fail verification.
5. **Bot messaging**: should the widget request `data-request-access="write"` so the bot can DM members (event
   invites, support-ticket replies)? This is off today. Turning it on later needs members to re-auth.

## Ops checklist (already needed for step 1)

- BotFather: `/newbot` (or reuse the PizzaDAO bot), then `/setdomain` → pick the bot → `app.pizzadao.org`.
  The widget only works on the domain set here, so preview deployments (`*.vercel.app`) cannot complete the
  widget flow. To test, use a second bot with its own domain or run locally behind a tunnel set as that bot's
  domain.
- Vercel env: `TELEGRAM_BOT_TOKEN` (server-only secret) and `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (bot username
  without `@`). If either is unset, the UI hides the Telegram button and the API returns 503.

## Implementation size

About one day: callback route, nonce table + migration, `/login` widget, session `authMethod`, tests (reuse the
`telegram-auth.test.ts` signing helper), and copy for the not-linked error.
