# zucchini-21674: Don't ask existing Discord members for "join servers for you"

## Open questions for Snax

1. **Is the core feature already done?** Commit `32eb452` (Oct 2, on `main`) already requests only
   `identify` at login and asks for `guilds.join` only if the bot says the person is NOT in the
   guild. If production behaves that way when you try it (see Verify, step 0), should we **close the
   task as done** and treat the gaps below as optional follow-ups?
2. **Should declining the join screen still log the person in?** Today, a non-member who clicks
   Cancel on the second Discord screen gets nothing: no session, sent to `/` (Gap 1). Recommended: yes,
   log them in with `discordJoined=0`.
3. **Should we add a one-line explainer before the second Discord screen?** Non-members currently see
   two Discord authorize screens back to back with no explanation (Gap 2). Options: (a) leave as is,
   (b) add an interstitial page ("You're not in the PizzaDAO Discord yet. Next, Discord will ask to add
   you." with **Join & continue** and **Skip for now** buttons). Recommendation: (b), but it is optional.
4. **Should we try `prompt=none` so returning members see no Discord screen at all?** (Gap 3.) Discord
   doesn't document what `prompt=none` does for a user who never authorized the app, so this needs a
   fallback and a manual test on preview. Recommendation: defer to a separate task.

---

## Goal

Members already in the PizzaDAO Discord should never see Discord's "Join servers for you"
(`guilds.join`) permission. Non-members still get added to the guild during onboarding. The magic-login
(Discord DM) flow and the preview OAuth proxy must keep working.

## Current state (research)

Commit `32eb452` implemented the core of this task, and it is on `main`:

- `app/api/discord/login/route.ts`: the default scope is `identify`. `?join=1` requests
  `identify guilds.join` with `prompt=consent` and sets `join: true` in the OAuth state. The preview
  proxy and canonical-host hops both carry `join=1` through.
- `app/api/discord/callback/route.ts`: after the token exchange and `/users/@me`, it calls
  `lookupGuildMembership(me.id)` (`app/lib/discord.ts`; uncached bot `GET /guilds/{id}/members/{user}`
  that returns `member | not_member | unknown`).
  - `member`: log in normally. No PUT and no join scope.
  - `not_member` on the first pass: clear `oauth_state` and redirect to `/api/discord/login?join=1`
    (keeping `state`/sessionId and `return_to`). No session is set yet.
  - Join step with `guilds.join` granted: bot `PUT /guilds/{id}/members/{user}` with the user's access
    token (`addUserToGuild`), look up membership again, then redirect with `discordJoined=1`.
  - Join step without `guilds.join`: log in with `discordJoined=0`. This avoids a loop.
  - `unknown` (Discord error, rate limit, or missing config): log in with no join step.
- `app/lib/oauth-proxy.ts`: `OAuthState.join` is added to the encode/decode.
- Magic-login (`app/lib/magic-login.ts`, `app/api/auth/magic-login/route.ts`) never uses OAuth. It finds
  the user with `searchGuildMembers`, so only guild members can use it, and it always sets
  `discordJoined=1`. The change doesn't affect it.
- Tests: `app/api/discord/oauth-flow.test.ts` covers every branch above. Running
  `npx vitest run app/api/discord app/lib/magic-login.test.ts app/lib/oauth-proxy.test.ts` gives
  35/35 passing (checked 2026-10-17).

### Options considered for the core problem (for the record; option A is shipped)

| Option | How it works | Verdict |
|---|---|---|
| **A. `identify` first, bot checks membership, second authorize only for non-members** | No extra user scope. The bot already has guild access. | **Chosen and shipped.** Members see 1 screen; non-members see 2. |
| B. `identify guilds.members.read` first, check `/users/@me/guilds/{id}/member` | Adds a user-visible permission ("read your member info") to every login, with no gain over the bot check. | Rejected |
| C. `identify guilds` first | Shows "know what servers you're in", which is a worse privacy prompt than the one we're removing. | Rejected |
| D. Hint cookie ("this browser was a member last time") to pick the scope up front | Can't help first-time visitors, the case that matters. Wrong when stale. Option A is already correct without it. | Rejected |
| E. Use the DM flow's known Discord ID | The DM flow is already members-only and never asks for `guilds.join`. Nothing to change. | N/A, already fine |
| F. Ask the user "Are you in our Discord?" before OAuth | Self-reported. Adds a click for everyone. | Rejected |

## Remaining gaps (proposed work)

### Gap 1 (recommended): declining the join screen loses the login
If the user cancels on the join step, Discord returns `?error=access_denied`. The callback's
`oauthError` branch sends them to `/` (or to `return_to`) **with no session**, even though the first
step already verified who they are. The commit message intended "log in, but not joined" for this case,
but that only happens when the user approves with fewer scopes, not when they cancel.

**Fix:** keep a short-lived, signed record of the identified user across the join hop.
- In `app/lib/oauth-proxy.ts`, add `OAUTH_PENDING_COOKIE = "oauth_pending"` and
  `createPendingLogin` / `verifyPendingLogin`. Reuse the HMAC pattern from `createTransferToken`, with
  a different prefix (`"pending:"`) and a 10-minute TTL (`OAUTH_STATE_TTL_SECONDS`). The payload is
  `{ discordId, username, nick, exp }`. Cookie options are the same as `oauthStateCookieOptions`
  (httpOnly, lax, `path=/api/discord`).
- In `callback/route.ts`, when redirecting a `not_member` to `?join=1`, also set `oauth_pending`.
- In the `oauthError` branch, when `isJoinStep` is true and `verifyPendingLogin(readCookie(...))` is
  valid, finish the login as a non-joined user (`discordJoined=0`). Use the same code path as a
  successful login: proxy transfer token if `return_to` is set, otherwise session cookie, member lookup,
  fire-and-forget role sync, PEP/item claims, and redirect. Clear both cookies.
- To avoid duplicating the large tail of `GET`, extract it into
  `finishLogin(req, url, { me: {id, username}, nick, joined, state, return_to })` inside the route file.
  This is a mechanical move.
- Also clear `oauth_pending` on every other terminal path. It is harmless if left set because it
  expires and is only read on a join-step error, but clearing it is tidier.

Security: the pending cookie is HMAC-signed with `SESSION_SECRET`, httpOnly, scoped to `/api/discord`,
and only honored on a join-step callback whose `state` nonce has already passed `verifyOAuthNonce`. Do
the nonce check **before** honoring the pending cookie on the error path. Today the error branch runs
before the nonce check, so move the nonce verification above it for the join-step-error case.

### Gap 2 (optional, see Q3): explain the second Discord screen
Non-members bounce straight from screen 1 (identify) to screen 2 (identify + join servers) with no
context. Proposal:
- New page `app/join-discord/page.tsx`: a short explainer with **Join & continue** (links to
  `/api/discord/login?join=1&state=…&return_to=…`) and **Skip for now**. Skip goes to a new
  `/api/discord/skip-join` route that finishes login from `oauth_pending` with `discordJoined=0`,
  reusing Gap 1's `finishLogin`.
- The callback redirects `not_member` to `/join-discord?...` instead of directly to
  `/api/discord/login?join=1`.
- Add strings to the i18n message files (follow how existing onboarding pages use `t()`).
- Cost: one extra click for non-members. Benefit: the scary permission is explained and can be skipped.
  This depends on Gap 1's pending cookie.

### Gap 3 (defer, see Q4): `prompt=none` for returning members
Members still see one Discord "Authorize" screen (identify only) on every login. Adding `prompt=none`
to the identify step could skip it for people who already authorized. Discord's docs only say it
"skip[s] the authorization screen" for users who have already authorized the scopes, and don't say what
happens otherwise. It would need fallback handling (`error=interaction_required` / `consent_required`:
retry once without `prompt`) and a manual test. Recommend a separate task.

### Not changing
- `unknown` membership: logs in without a join step. This is the right fail-open behavior. Optionally
  add a `console.warn` so rate-limit or 5xx cases show up in Vercel logs (one line).
- The magic-login / DM signup flow: no change needed. The regression tests below lock it in.

## Files to change (if Gaps 1 and 2 are approved)

- `app/lib/oauth-proxy.ts`: pending-login cookie name, sign/verify helpers, cookie options.
- `app/lib/oauth-proxy.test.ts`: sign/verify round-trip, tamper, and expiry tests.
- `app/api/discord/callback/route.ts`: extract `finishLogin`; set `oauth_pending` on the join redirect;
  handle a join-step `access_denied` from the pending cookie; nonce check before honoring it.
- `app/api/discord/oauth-flow.test.ts`: new cases (below).
- Gap 2 only: `app/join-discord/page.tsx` (new), `app/api/discord/skip-join/route.ts` (new),
  i18n message files, and the redirect target in the callback.
- No changes to `app/api/discord/login/route.ts`, `app/lib/magic-login.ts`, or
  `app/api/auth/magic-login/route.ts`.

## Implementation steps

0. Verify production first (see Verify, step 0). If Snax is happy and declines Gaps 1 and 2, stop
   and run `/task done zucchini-21674` referencing commit `32eb452`. No PR needed.
1. Add the pending-login helpers and tests to `oauth-proxy.ts`.
2. Refactor the callback tail into `finishLogin` with no behavior change. Run the existing tests (they
   must stay 35/35 green).
3. Gap 1: set the pending cookie on the join redirect, add the join-step error path, and add tests.
4. (Gap 2) Add the interstitial page and skip route, point the callback at the interstitial, and add
   tests.
5. `npm run lint`, `npx tsc --noEmit`, and `npx vitest run app/api/discord app/lib`.
6. `/ship` to open a PR and preview.

## Tests to add (`app/api/discord/oauth-flow.test.ts`)

- Non-member first pass sets `oauth_pending` (signed, httpOnly, `path=/api/discord`) and still redirects
  to the join step without a session cookie.
- Join step `?error=access_denied` with a valid pending cookie and nonce: session cookie set, redirect
  `/?discordId=…&discordJoined=0`, no PUT, both cookies cleared.
- Same as above with `return_to`: redirects to `{return_to}/api/auth/session-transfer?token=…`.
- Join step `access_denied` with a missing, tampered, or expired pending cookie: old behavior (redirect
  `/`, no session).
- Join step `access_denied` with a bad nonce: no session, even if the pending cookie is valid.
- First-pass (non-join) `access_denied`: unchanged (redirect `/`).
- Regression: an existing member is never redirected to `join=1` or sent the PUT (already covered;
  keep it).
- Magic-login regression: `app/lib/magic-login.test.ts` passes unchanged. Optionally assert that
  `/api/auth/magic-login` still redirects new users with `discordJoined=1`.
- (Gap 2) The callback redirects `not_member` to `/join-discord`. `skip-join` with a valid pending
  cookie logs in with `discordJoined=0`; with an invalid one it redirects to `/`.

## Verify

0. **Production, today, before any code.** In a private window on https://app.pizzadao.org, click
   "Log in with Discord":
   - With an account that IS in the PizzaDAO Discord: Discord's screen should list only "Access your
     username, avatar, and banner" (no "Join servers for you"), then land on the dashboard.
   - With a throwaway account that is NOT in the Discord: the first screen shows identify only, then a
     second screen shows "Join servers for you". After approving, the account is in the guild and
     onboarding shows "joined".
   - Discord DM sign-in (`/login` → enter username → DM link) still works for a member.
1. **Vercel preview** (after `/ship`; preview OAuth bounces through production, so the callback code
   under test is production's until merged). Because of this, verify Gaps 1 and 2 with the unit tests
   plus a local `npm run dev` run against a dev Discord app or the localhost redirect URI, if one is
   configured. On the preview itself, check that the member login and DM login still round-trip through
   the proxy and land logged in.
2. **After merge to production:** repeat step 0. Then, with the non-member account, click **Cancel** on
   the "Join servers" screen and confirm you land logged in on onboarding with "linked" (not "joined").
   For Gap 2, confirm the interstitial appears and **Skip for now** works.
3. Watch Vercel logs for `discord/callback` errors for a day.

## Risks

- **The callback refactor touches every login.** Mitigate by doing the behavior-preserving extract as its
  own commit, with the existing tests green before adding behavior.
- **Moving the nonce check earlier on the error path** must not break the plain-cancel case. A first-pass
  cancel with a stale or missing cookie should still redirect home, not show the JSON 400. Only require
  the nonce when we are about to honor the pending cookie.
- **Previews can't fully test callback changes** because the proxy runs the production callback. The
  unit tests carry most of the verification weight. Do the final check in production right after merge.
- **Cookie size and path:** `oauth_pending` is small and scoped to `/api/discord`, so the onboarding
  pages never receive it. `skip-join` must live under `/api/discord/` for this reason.
- **Two Discord screens for non-members** remain inherent to option A. Gap 2 only explains them.

## Rollout

- If only step 0 is wanted: mark the task done with `32eb452`. Nothing to deploy.
- Otherwise: a single PR on `task/zucchini-21674`. Gap 1 and Gap 2 can be separate commits, so Gap 2
  can be dropped in review. No env vars, migrations, or Discord app settings change. The redirect URI is
  unchanged because `/join-discord` and `skip-join` are reached by our own redirects, not by Discord.
- Rollback: revert the PR. The pending cookie expires on its own in 10 minutes.

## Decisions (Snax, 2026-10-18)

1. The core feature already shipped (32eb452). Snax will verify it on production with a member account and a non-member account.
2. Implement Gap 1: cancelling the guilds.join screen still logs the person in (an oauth_pending cookie, with discordJoined=0).
3. Gap 2 (the explainer page) is skipped.
4. Gap 3 (prompt=none) is skipped.
