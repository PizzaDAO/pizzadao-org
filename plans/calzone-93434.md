# calzone-93434: Sign in with Telegram

Status: plan v2 (2026-11-21). Replaces the login half of `plans/calzone-93434-telegram-login.md` (2026-10-02),
which predates the login bot and its webhook.

## Decisions

1. **Flow: bot confirm (recommended) or Login Widget?** Recommended: the bot flow below. It needs no phone
   number popup, works on mobile, and reuses the login bot and webhook that already link accounts. The
   widget is cheaper to build but has the oauth.telegram.org phone prompt, and that prompt is why linking moved to the bot.
   Default: bot flow only. The widget stays on the profile page for linking.
2. **Admin power after a Telegram sign-in?** Recommended: no. Admin and DPR checks require a Discord or magic-link
   session (`authMethod !== "telegram"`). Default: require Discord for admin.
3. **Session length for Telegram sign-ins.** Recommended: the same 30 days as other sessions. Default: same.
4. **Unlinked Telegram users** who press "Sign in with Telegram". Recommended: refuse, with copy telling them to
   log in with Discord once and connect Telegram on their profile. No Telegram-only accounts. Default: refuse.

## Goal

A member who has linked Telegram (a `TelegramAccount` row) can sign in from `/login` without Discord, in the
browser they started from, and land on `returnTo` or their dashboard, exactly like the magic link.

## Options compared

| | Bot confirm (device-style) | Bot DMs a magic link | Login Widget (redirect) |
|---|---|---|---|
| Where the session lands | The browser that asked (polls) | Wherever the link opens (often Telegram's in-app browser, so it's lost) | The browser that asked |
| Phone number prompt | None | None | Yes, on web |
| Reaches widget-linked members who never started the bot | Yes (they press Start) | No (we can't DM before /start) | Yes |
| Phishing ("press this link for me") | Mitigated by number matching (below) | Not applicable | Not applicable |
| New code | Medium | Small | Small |

Recommendation: **bot confirm with number matching.** It mirrors the existing link flow
(`/start <code>` -> "Yes" button -> atomic spend) and the magic-link "check your DMs" polling tab.

## Flow

1. `/login` (MagicLoginFlow) shows **Sign in with Telegram** when `auth.telegramSignInEnabled` is on and
   `telegramConfig()` is set.
2. `POST /api/auth/telegram/start` (IP rate limit `telegram-signin-start`, 5 per 10 minutes):
   - Creates a `TelegramSignInRequest` with a 43-character code (only its sha256 is stored), a random 2-digit
     `matchNumber`, a 5-minute expiry, and the `returnTo` cleaned by `loginReturnPath()`.
   - Sets an httpOnly, signed cookie `tg_signin` holding a per-browser secret (its hash is stored on the row).
   - Returns `{ url: "https://t.me/<bot>?start=si_<code>", matchNumber, expiresInSeconds }`.
     `si_` + 43 characters fits Telegram's 64-character start parameter limit.
3. Browser: shows "Open Telegram" and the number ("Telegram will ask for this number: **47**"), then polls
   `GET /api/auth/telegram/status` every 3 seconds. Reuse the MagicLoginFlow watch loop and its
   `magic-login-status` style rate-limit bucket.
4. Webhook (`app/api/telegram/login-bot/webhook/route.ts`, new `si_` branch in `onStart`; existing link codes
   have no prefix, so they're unaffected):
   - Same guards as linking: private chat only, never forwarded, `chat.id === from.id`, not a bot.
   - `from.id` -> `TelegramAccount` by `telegramId`. If there's no row, send the "not connected" message and
     **don't** claim the code, so a random presser can't burn someone's request.
   - Claim the code atomically: a conditional `updateMany` sets `tgId`, `discordId` and an opaque `ref`. The
     first claimant wins, and a repeat Start from the same user returns the same ref.
   - Bot asks: "Sign in to PizzaDAO as <public name>? Tap the number your browser shows." It shows 3 buttons
     (the real number plus 2 decoys, in random order), each with callback_data `si:<ref>:<n>`.
     A wrong tap cancels the request ("Cancelled. Start again from the website.").
5. Correct tap: an atomic conditional update sets `approvedAt` (only the claimant, unexpired, not yet
   approved). The bot edits its message to "Signed in. Go back to your browser." It never sends a link.
6. Status poll: when `approvedAt` is set, `consumedAt` is null, and the cookie secret hash matches, consume
   atomically. Then:
   - Re-check guild membership (`lookupGuildMembership`). Someone who left or was banned is refused.
   - Build the session as `app/api/auth/magic-login/route.ts` does: `createSessionToken` with the new optional
     `authMethod: "telegram"`, `setSessionCookies`, and `syncRolesOnLogin`.
   - Return the landing path from `loggedInLanding()`. Unlinked member rows go to the wizard.
7. Cancel: the "Stop waiting" button calls `DELETE /api/auth/telegram/start` (deletes the browser's pending
   request).

Extract the shared session-building block from the magic-login route into
`app/lib/auth/issue-login-session.ts`, so both routes use the same code.

## Data / migration (additive)

New table `TelegramSignInRequest`:

| Field | Type |
|---|---|
| `codeHash` | `@id` |
| `browserHash` | String |
| `matchNumber` | Int |
| `returnTo` | String? |
| `tgId` | String? |
| `discordId` | String? |
| `ref` | `@unique` |
| `claimedAt`, `approvedAt`, `consumedAt`, `cancelledAt` | DateTime? |
| `expiresAt` | DateTime |
| `createdAt` | DateTime |

Indexes: `@@index([expiresAt])` and `@@index([tgId, createdAt])`.

Rows are pruned lazily (older than 1 day), like `createLinkCode`. `Session` gets an optional `authMethod`
field. Old cookies stay valid.

## UI

- MagicLoginFlow: a secondary button below the Discord DM form, then a waiting state that shows the number,
  an "Open Telegram" button, a countdown and "Stop waiting". Error copy goes in the i18n
  `onboarding.magicLogin.telegram.*` keys.
- Login error codes: `telegram_not_linked`, `telegram_expired`, `telegram_left_server`.

## Security / abuse

- Never creates or changes a `TelegramAccount`. Sign-in only reads it, so it can't overwrite links.
- Codes: single use, 5 minutes, hash only, opaque `ref` in callback_data, atomic claim / approve / consume.
  The session is only issued to the browser holding the cookie secret, so a leaked t.me link alone is useless.
- Phishing (an attacker sends their own start link to a victim): the victim can't see the attacker's number,
  so 2 of 3 taps cancel. The message also says "Only continue if you just pressed Sign in with Telegram".
  Cap: 3 sign-in requests per tgId per hour. Beyond that, reply "Too many attempts".
- Rate limits: start per IP; status per IP (generous); webhook claims per tgId.
- Production only acts (the webhook already no-ops on previews). The start route answers 503 on previews, so
  sign-in can't be tested against the prod DB from a preview. Test it on prod with the switch on for an
  allowlist (below).
- Audit: an `ActivityEvent` (or structured log) `telegram_signin` with `discordId` and outcome. No message text,
  no Telegram id in logs.
- Admin: `requireAdmin` / `requireDpr` refuse `authMethod === "telegram"` (open question 2).

## Settings (`app/lib/settings`, area `telegram`, all off or default)

- `auth.telegramSignInEnabled` (bool, off; env kill switch `TELEGRAM_SIGNIN_ENABLED` in `toggles.ts`).
- `auth.telegramSignInAllowlist` (stringList of Discord ids, empty = everyone once enabled). Lets us test on
  prod first.
- `auth.telegramSignInTtlMinutes` (int, 2-10, default 5).
- `auth.telegramSignInAdminAllowed` (bool, off).

## Tests

- `app/lib/telegram/signin-code.test.ts`: create, claim race, same-user re-claim, wrong-number cancel, approve
  once, consume once, expiry, cookie mismatch.
- `login-bot/webhook/route.test.ts`:
  - `si_` start with an unlinked Telegram user (code untouched)
  - forwarded messages
  - group chat
  - a tap by a user other than the claimant
  - double taps
- `api/auth/telegram/status` route test: the session cookie is set only once, `authMethod` is set, and a member
  who left the guild is refused.
- `auth-guards.test.ts`: admin is refused on a Telegram session when the setting is off.
- MagicLoginFlow test: the button is hidden when disabled, the waiting state, navigation once approved.

## Rough size

Medium: about 2 days. One migration, about 4 routes or branches, 1 lib, the UI state in MagicLoginFlow,
settings, and tests. There's no rsv.pizza change.
