# anchovy-52918: name new Discord joiners "Pizza Trainee" unless they've signed up

> Snax: "the bot should name all new joiners to the discord as pizza trainee unless they've signed up on app.pizzadao.org."

## Status: Ready to implement

No open questions remain. Snax decided everything below on 2026-10-17 and 2026-10-18. Production checks are done: the GUILD_MEMBERS intent is on, the bot has Administrator, and its top role is at position 120 of 128.

**napoletana-52080 ("pizza noob role logic") is being closed as covered by this task.** This plan assigns Pizza Noob to non-signed-up joiners and removes it at missions Level 2.

### Resolved (Snax, 2026-10-17)
- **Custom nicknames are overwritten.** Every in-scope member who isn't signed up gets "Pizza Trainee", whatever their nickname is now.
- **No grace period.** The first cron run after someone joins renames them.
- **Continuous enforcement.** If someone changes their nickname away from "Pizza Trainee", the next run sets it back. This replaces the rename-once ledger.
- **Name format.** Plain `Pizza Trainee` for everyone, with no numbers or suffixes.
- **No backfill (2026-10-18).** Only people who join on or after go-live are covered, with `TRAINEE_NICK_SINCE` set to the go-live time. Existing members are never touched. The runner refuses to run without `TRAINEE_NICK_SINCE` and must not offer any backfill mode.
- **The "Pizza Noob" role (2026-10-18).** Members who get "Pizza Trainee" also get the Discord **Pizza Noob** role, in the same enforcement pass. The add is idempotent and skips anyone who already has the role.
- **Keep Pizza Noob at signup; remove it after Level 2 (2026-10-18).** Signing up doesn't remove the role. It is removed automatically once the member completes missions **Level 2**, through a hook where L2 completion is recorded plus a sweep in the 10-minute pass. The removal uses the remove-one-role call.

---

## Goal

Every Discord member who joined on or after go-live and has **not** signed up on app.pizzadao.org has the server nickname **"Pizza Trainee"** and the **"Pizza Noob"** role, and the bot keeps it that way. Once they sign up, enforcement stops and their nickname becomes their mafia name. This matches mission Level 1 ("Pizza Trainee", `app/missions/MissionsClient.tsx:88`).

## Findings

### Detecting joiners without a gateway
- The app has no gateway process, only the HTTP interactions endpoint (`app/api/discord/interactions`) plus REST (see `plans/unbelievaboat-replacement.md:91`). REST can't receive `GUILD_MEMBER_ADD`.
- The Vercel team `pizza-dao` is on the **Pro** plan (checked with the Vercel API on 2026-10-17), so per-minute crons are allowed. The crons in `vercel.json` today are all daily.
- `GET /guilds/{id}/members?limit=1000&after=` is already used in `app/lib/discord.ts:132` (`getMembersWithRoles`, capped at 10 pages, and any error is treated as "done"). That endpoint needs the **GUILD_MEMBERS privileged intent**. **Confirmed on production (2026-10-18):** the intent is on, and the bot has Manage Nicknames through **Administrator**. Its top role is at **position 120 of 128**. The roles above it are Dread Pizza Roberts, Discord, Pizza Bots, sesh, Beemo, Hashbot, Dyno and Wick. Members holding any of these can't be renamed, so the planner skips them as `outranked` instead of retrying 403s (most of them are bots, which are skipped anyway). The list is ordered by user ID, not `joined_at`, so every run scans the whole guild. Continuous enforcement needs a full scan anyway.
- "SecretService" is an Apps Script web app for events, tweets and attendance (`app/lib/announce/secret-service.ts`). It has no join hook.

| Option | Verdict |
|---|---|
| **A. Vercel cron every 10 min: scan members and enforce** | **Recommended.** No new infra. A periodic scan is also the only thing that can do continuous enforcement without a gateway. |
| B. Gateway bot (`GUILD_MEMBER_ADD` + `GUILD_MEMBER_UPDATE`) | Instant renames and instant revert on change. But it is a second always-on host plus Google creds off Vercel. Revisit if 10 minutes of drift is too slow. |
| C. Apps Script trigger / D. off-the-shelf bot / E. undocumented `members-search` | Rejected: polling outside the repo, can't apply the "signed up" rule, and unsupported, respectively. |

### The "Pizza Noob" role
- **There is no role ID in the code.** "Pizza Noob" shows up only as the Level 2 missions title (`MissionsClient.tsx:89`, tests). There's no constant in `app/ui/constants.ts` or `mission-config.ts`, and there's no env var.
- **Resolve it the way woodfired-65373 resolves Box Mafia:**
  - If `PIZZA_NOOB_ROLE_ID` is set and valid (`/^\d{5,25}$/`), use it.
  - Otherwise use the **single** guild role whose `normalizeRoleName` (`app/lib/pep-earn/income.ts`) equals `"pizzanoob"`.
  - If zero or several roles match, the result is `null`. The role step is then **skipped for the whole run** and logged as `role_unresolved`. Nicknames still get enforced.
  - Read the role list from the same `GET /guilds/{id}` response the runner already uses for positions. It also gives `managed` and `position`. Don't use the `getGuildRoles` cache: it doesn't include positions and has a 1.5 s timeout.
- **Position compared to the bot (position 120):** "Pizza Noob" is **not** one of the 8 roles confirmed above the bot (Dread Pizza Roberts, Discord, Pizza Bots, sesh, Beemo, Hashbot, Dyno, Wick). So it is below position 120, and the bot (Administrator) can assign it. The runner still **checks this every run**: if the resolved role's `position >= botTopPosition` or the role is `managed`, it skips the role step for the run and logs `role_not_assignable`. It never generates a 403 for every member.
- When `PIZZA_NOOB_ROLE_ID` is set, I recommend copying the ID from Server Settings → Roles → Pizza Noob → Copy Role ID. That makes it immune to someone renaming the role.

### Where Level 2 completion is recorded
- **Missions are keyed by Discord ID natively.** `MissionCompletion.discordId` and the `Transaction.userId` ledger are both Discord user IDs. No sheet or memberId lookup is needed, so a missing sheet row doesn't affect this.
- **The single place a level completes is `checkAndAwardLevelReward(discordId, level)`** in `app/lib/missions.ts:635`. Under a wallet row lock it checks that every active mission in the level is approved, then writes the `MISSION_REWARD` ledger row (`metadata.level`), which is the exactly-once "level done" marker. It returns `true` only for the call that paid. Every path goes through `settleLevels` (`missions.ts:591`), which pays levels in order and stops at the first incomplete one:
  - a human approve (`approveMission`, `missions.ts:509`)
  - Discord review cards and bulk review (`mission-verify/review-decision.ts`, `bulk-review.ts`, via `approveMission`)
  - the auto-verify engine (`mission-verify/engine.ts:294`, used by events, the nightly cron and `/missions` checks)
- `LevelUpModal` and `MissionsClient.tsx` (`2: "Pizza Noob"`) are display only; they record nothing.
- **"Completed L2"** means the same as the UI: `computeCurrentLevel(missions, approvedIds, paidLevels) >= 3` (`missions.ts:81`). In other words, L1 and L2 are each fully approved or already paid, in order. This counts legacy ledger rows (`paidLevelOf` reads the description format too) and isn't thrown off by missions added to L2 later.
- Edge: `checkAndAwardLevelReward` returns `false` without a ledger row when a level's reward is 0. L2's reward is 420 today. The sweep uses `computeCurrentLevel` (approvals count as well), so a zero-reward L2 would still be caught by the sweep, just not by the hook.

### What counts as "signed up"
- "Signed up" means **a row in the Crew roster Google Sheet whose Discord ID column is this user**. `registerWithMemberId` (`app/lib/member-registration.ts`) writes it. Signup is serialized with `pg_advisory_xact_lock(742019331)` and the live roster is read with the Sheets API `values.get`.
- The Prisma `User` table is the wrong source (anyone who logged in is in it), and so are signup drafts.
- **Freshness:** `getSheetData({ fresh: true })` (`app/lib/sheets/member-repository.ts:187`) skips the Next data cache, but it still reads **GViz**, which the repo itself notes "can lag writes". For enforcement we need the live **Sheets API** read that `registerWithMemberId` uses. See step 2.

### Does signing up overwrite the nickname?
- **New signups and profile edits:** `POST /api/profile` always calls `syncDiscordMember` with `nickname: payload.mafiaName` (`app/api/profile/route.ts:312`), and `mafiaName` is required (line 213). The Discord PATCH runs **after** `registerWithMemberId` releases its lock (line 260). If the PATCH fails, the error is swallowed.
- **Gap: claim flows.** `/api/claim-member:191` and `/api/auto-claim:169` call it without `nickname`, so a trainee who claims an existing roster row stays "Pizza Trainee" (the heal pass and step 7 fix this).
- **Gap: the trainee nick leaks into the app.** `app/api/discord/callback/route.ts:169` and `app/lib/magic-login.ts:37` put the guild `nick` first in `session.nick`, and from there into `discordNick`:
  - The onboarding pre-fill (`OnboardingWizard.tsx:596`) and NameStep's "keep your Discord name" (`NameStep.tsx:203`) would offer "Pizza Trainee" as a mafia name.
  - The `/api/member-lookup?searchName=` name-match auto-claim would search for "Pizza Trainee".
  - It also reaches `syncRolesOnLogin`'s fallback name and article, comment and support-ticket author names.
  - `people.ts:112` and `discord-interactions/embeds.ts:76` fall back to `nick` as well.

  With continuous enforcement, **every** non-signed-up member arrives at onboarding as "Pizza Trainee", so the `realNick` fixes are **required in the same PR and must ship before enforcement is enabled**.

## Approach (option A, continuous enforcement)

### 1. `app/lib/trainee-nick.ts` (new): constant, helpers, pure planner
```ts
export const TRAINEE_NICK = 'Pizza Trainee'
export const isTraineeNick = (n?: string | null) => (n ?? '').trim().toLowerCase() === TRAINEE_NICK.toLowerCase()
export const realNick = (n?: string | null) => (isTraineeNick(n) ? null : n?.trim() || null)
```
`planTraineeNicks({ members, signedUp: Map<discordId, sheetName>, ownerId, botTopPosition, rolePositions, since, max })` returns `{ enforce, heal, skipped, overflow }`.

**Enforce:** members who match all of the following:
- `joined_at >= since`
- not `user.bot`, and not the guild owner
- not **outranked**, meaning the member's highest role position is below the bot's highest role. A member at or above the bot's position can't be renamed: today that is anyone holding one of the 8 roles above position 120. Skip them before calling instead of getting a 403 every run. Never retry them.
- not in `signedUp`
- **and needs work:** `nick !== TRAINEE_NICK` (exact match) **or** (the role resolved and is assignable, and `!member.roles.includes(pizzaNoobRoleId)`, **and `completedL2` is known to be false for this member**). Members who are already correct cost nothing.
- **Never re-add the role after L2.** `addRole` requires `completedL2.has(id) === false`, and it is computed from the missions DB, not the sheet. This covers the case where someone isn't signed up, or their sheet row disappears, after they complete L2: their nickname is still enforced (they look not-signed-up), but the role is never added back. If the L2 lookup fails, `addRole` is false for **everyone** that run (fail closed), and removals are skipped.

Each enforce item records `{ setNick: boolean, addRole: boolean }`. It counts as **one** unit toward the cap, even when it needs two API calls.

**Heal:** members who **are** in `signedUp` and whose `nick` is the trainee nick. (Healing never touches the Pizza Noob role: it stays at signup and is removed only at L2, by the sweep below.) Set their nick to the sheet `Name` (`sanitizeDisplayName`, trimmed to 32 chars). If Name is empty, set `nick: null`. This is not limited by `since`: anyone signed up who still carries the placeholder gets fixed. Healing covers three cases: the signup race below, a failed `/api/profile` PATCH, and claim flows.

**Noob sweep:** members who **hold** Pizza Noob, have `joined_at >= since`, and have **completed L2** (signed up or not) get `removeRole`. Bots, the owner and outranked members are still skipped. The sweep is limited to members who joined after go-live, matching "no backfill": members from before go-live who already hold Pizza Noob for other reasons are never touched. The sweep catches hooks that were missed: crashes, a disabled flag at the time, Discord errors, or the race in the next paragraph.

`completedL2` is computed in bulk, once per run, for the candidate IDs only. A candidate is an in-scope member who either holds the role or would get `addRole`. It takes three queries: active missions `{id, level}`; `missionCompletion.findMany({ where: { discordId: { in: ids }, status: 'APPROVED' } })`; and `transaction.findMany({ where: { userId: { in: ids }, type: 'MISSION_REWARD' } })` mapped through `paidLevelOf`. Then `computeCurrentLevel` runs per member. Batch the `in` lists in chunks of 1000. This read happens **last**, together with the sheet read, just before the API calls.

Heal runs before enforce. The combined total is capped at `max` (default 50), and the rest is reported as `overflow` and picked up by the next run. The planner keeps the sort order stable (by `joined_at` ascending) so the oldest joiners are never starved.

### 2. Live "signed up" read
Pull the roster parsing out of `member-registration.ts` (`nextMemberId`'s header detection) into a shared function, `readSignedUpMembers(): Promise<Map<discordId, name>>`. It uses the Sheets API `values.get` with `UNFORMATTED_VALUE`, the same as `registerWithMemberId`. This means a signup counts on the very next run, with no GViz lag.

Safety guards, because continuous enforcement makes a bad read dangerous:
- If the read errors, or the header/Discord-ID column can't be found, abort the run.
- Also abort if it returns fewer than `TRAINEE_NICK_MIN_SIGNED_UP` IDs (default 100). Otherwise one bad read would rename every in-scope member and heal nobody.

### 3. Guild reads: `app/lib/discord.ts`
- Add `listAllGuildMembers({ maxPages = 200 })`. It pages until it gets a short page and **throws** on a non-OK response. On 429 it waits per `parseRateLimit` (`app/lib/discord-rest.ts:84`) and retries once. It uses `cache: 'no-store'`.
- Add `getGuildInfo()`, which returns `owner_id` plus a `roles` id→position map (`GET /guilds/{id}` includes roles).
- Add the bot's own highest role: `GET /users/@me`, then that member's `roles` from the member list.

### 4. Runner: `app/lib/trainee-nick-run.ts` (new)
`runTraineeNicks({ dryRun, deps })`:
1. **Config.** If `TRAINEE_NICK_SINCE` is unset, return `{ status: 'not_configured' }`, so it can never backfill by accident. Other settings: `TRAINEE_NICK_MAX_PER_RUN` (50) and `TRAINEE_NICK_MIN_SIGNED_UP` (100).
2. **Single-flight.** Take `pg_try_advisory_lock(<new key>)` on the Prisma connection. If it isn't free, return `{ status: 'busy' }`. This prevents two overlapping runs from double-PATCHing (a slow run or a manual curl). It is the only cross-run state and needs **no table or migration**.
3. **Read members and guild info first**, then **read the live sheet last**, just before the PATCH loop. This keeps the race window as small as possible.
4. Plan. In **dry run**, return the stats plus up to 20 sample IDs per bucket, with no PATCHes.
5. **PATCH, one at a time.** Each call is `PATCH /guilds/{g}/members/{id}` with `{ nick }` **only** (never `roles`) and the header `X-Audit-Log-Reason: anchovy-52918 trainee nickname`.
   - **Rate limits:** read `X-RateLimit-Remaining` / `X-RateLimit-Reset-After`. When remaining is 0, wait out the reset if it is 5 s or less; otherwise stop the run, and the next run continues. On a 429, wait `retry_after` once, then stop. A global 429 or a Cloudflare 1015 stops at once.
   - **403 handling (no stored state):** a 403/50013 skips that member and the run continues. **Three 403s in a row abort the run** as `permission_error`, which usually means Manage Nicknames was removed or the bot role moved down. The hierarchy pre-check means per-member 403s should be rare. An unexplained one costs one call per run and is logged with the ID.
   - A 404 (member left) is skipped.
5a. **Role removal** (sweep items): `DELETE /guilds/{g}/members/{id}/roles/{pizzaNoobRoleId}`, which removes one role and is idempotent. It uses the same audit header (reason `anchovy-52918 completed missions Level 2`) and the same rate-limit and 403 handling. Removals count toward the cap of 50.
5b. **Role add** (for items with `addRole`): `PUT /guilds/{g}/members/{id}/roles/{pizzaNoobRoleId}` with the same audit header. This endpoint is idempotent: a 204 means the role was added or was already there. It doesn't touch the member's other roles, so it can't race with other role edits the way a full `roles` PATCH could. Use the same rate-limit and 403 handling; the role route has a separate bucket, but count its 403s toward the three-in-a-row abort. Send the nick PATCH first, then the PUT. If the PATCH gets a 403 or 404, skip the PUT for that member.
6. Return `{ status, dryRun, scanned, inScope, alreadyTrainee, enforced, nickSet, roleAdded, roleRemoved, roleStatus: 'ok' | 'role_unresolved' | 'role_not_assignable', pizzaNoobRoleId, healed, skipped: { bot, owner, outranked, signedUp }, forbidden, overflow, stoppedReason }`.

### 4b. Level 2 completion hook: `app/lib/missions.ts`
In `checkAndAwardLevelReward`, after `awarded` is true, next to the `LEVEL_COMPLETED` notification: if `level === PIZZA_NOOB_GRADUATE_LEVEL` (2), call `removePizzaNoobOnGraduate(discordId).catch(() => {})`. It's fire-and-forget, so it never blocks or fails the payout. Wrap it in `after()` where a request context exists, falling back to `void` the same way `recordActivationLater` does. When `settleLevels` pays L2 and L3 together, the L2 iteration still fires it.

`removePizzaNoobOnGraduate(discordId)` lives in `app/lib/trainee-nick-run.ts`:
1. If `TRAINEE_NICK_ENABLED !== 'true'`, log `would remove` and return. This uses the same dry-run switch as the cron.
2. Resolve the role (env override, else `getGuildRoles` name match). Return if it's unresolved.
3. `GET /guilds/{g}/members/{id}`. Return on a 404. Return if the member doesn't hold the role, or if `joined_at < TRAINEE_NICK_SINCE` (the same no-backfill scope as the sweep).
4. `DELETE .../roles/{roleId}` with the L2 audit reason. On 429 or 403, log and return; the sweep retries it within 10 minutes.

**Race with an in-flight cron run:** a run that read `completedL2` just before the member finished L2 might add the role back after the hook removed it. The next run's sweep sees L2 complete and removes it again, so it is wrong for at most one interval. It can't keep flipping, because from then on `addRole` is blocked by `completedL2`.

### 5. Cron route and schedule
`app/api/cron/trainee-nicks/route.ts` follows the `mission-sla` pattern: `isCronAuthorized`, `runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=120`.
- `dryRun = process.env.TRAINEE_NICK_ENABLED !== 'true' || ?dryRun=1`
- It logs `[cron/trainee-nicks]` with the JSON stats.

`vercel.json`:
```json
{ "path": "/api/cron/trainee-nicks", "schedule": "*/10 * * * *" }
```
`*/5` would also fit the budget and would cut the drift and the race windows in half. Start with 10 and tighten if Snax wants a faster revert.

### 6. `syncDiscordMember`: replace the placeholder on claim
Add an optional `replaceTraineeNickWith?: string` to `app/lib/services/discord-api.ts`. The function already GETs the member. If no `nickname` is given and the current nick `isTraineeNick`, set `body.nick` to that name. Pass the sheet Name from `/api/claim-member` and `/api/auto-claim`. Without this, the heal pass fixes it within one run anyway; this makes it immediate.

### 7. Nickname precedence (`realNick`): required before enabling
- `app/api/discord/callback/route.ts:169` and `app/lib/magic-login.ts:37`: change to `realNick(member.nick) || global_name || username`. This one change fixes the onboarding pre-fill, NameStep, the member-lookup name match, the `syncRolesOnLogin` fallback, and article, comment and support author names, which all read `session.nick` or `discordNick`.
- Also apply `realNick` in `app/lib/people.ts:112` and `app/lib/discord-interactions/embeds.ts:76`.
- Sessions already issued keep their stored `nick` until re-login. That only affects members who logged in **after** being renamed and before this deploy, which is none, because both changes ship together.
- **The cron does not read `session.nick`.** It only reads the guild member list, so `realNick` never changes enforcement decisions.

## How the decisions play out

- **Scope.** Each run looks at everyone with `joined_at >= SINCE`. That set only grows, but PATCHes happen only where `nick !== TRAINEE_NICK` or a heal is due. In steady state that is new joiners plus anyone who changed their nick in the last 10 minutes, usually 0 to a few calls per run. The scan itself is about guild size / 1000 GETs per run. At 10-minute intervals that is 144 scans a day, a few thousand GETs, which is fine for that endpoint.
- **The per-run cap (50)** protects against raids and mass joins. Overflow is drained in later runs, about 300 an hour.
- **Audit log volume.** Every enforcement is an audit-log entry, so a member who keeps reverting their nick produces one entry every 10 minutes. That is acceptable, and the reason string makes it easy to filter.
- **The fight is visible.** A member who changes their nick keeps it for up to 10 minutes. The only way to make it stick instantly would be removing **Change Nickname** from @everyone. That is server-wide, would also block signed-up members, and isn't part of this plan; mention it to Snax only if he wants it.
- **The signup race.** The new signup writes the sheet, then `/api/profile` PATCHes the nick to the mafia name. If the cron read the sheet before that write and PATCHes after it, the member ends up "Pizza Trainee".
  - Mitigations: (a) read the sheet last, just before the PATCH loop, so the window is only the loop's few seconds; (b) the heal pass fixes it on the next run (at most about 10 minutes) because they are now signed up and carry the placeholder.
  - Rejected: a per-candidate sheet re-read (heavy); sharing signup's advisory lock (the profile PATCH happens after the lock is released, so it doesn't close the race).
- **How fast enforcement stops after signup.** On the next run, because of the live Sheets API read rather than GViz or the 120 s data cache. Until then the nick is already their mafia name from `/api/profile`, so nothing flips back.
- **Skips.**
  - Bots: yes. Renaming bots is pointless, and some can't be renamed.
  - The owner: yes. Discord refuses it.
  - **Outranked members:** yes. Pre-computed from role positions, so there are no 403s every run. Their count shows in the stats.
  - Members who are signed up: yes. They only get healed when they carry the placeholder.
  - `pending` (membership screening) members are enforced, since the PATCH works for them.

## Files to change

| File | Change |
|---|---|
| `app/lib/trainee-nick.ts` (new) | constants (`TRAINEE_NICK`, `PIZZA_NOOB_ROLE_NAME = "Pizza Noob"`, `PIZZA_NOOB_GRADUATE_LEVEL = 2`), `isTraineeNick`, `realNick`, `resolvePizzaNoobRoleId(roles, env)` (pure; reuses `normalizeRoleName`), `planTraineeNicks` (pure) |
| `app/lib/trainee-nick-run.ts` (new) | runner: advisory lock, ordering, PATCH loop, rate-limit and 403 handling |
| `app/lib/member-registration.ts` (+ maybe `app/lib/sheets/`) | pull out the live roster parse and add `readSignedUpMembers()` |
| `app/lib/discord.ts` | `listAllGuildMembers`, `getGuildInfo` (owner + roles with `position`/`managed`), bot top role, `addGuildMemberRole` (PUT), `removeGuildMemberRole` (DELETE) |
| `app/lib/missions.ts` | the L2 hook in `checkAndAwardLevelReward`; export a bulk `completedLevelBy(ids, level)` helper built on `computeCurrentLevel` and `paidLevelOf` (or put it in `trainee-nick-run.ts`) |
| `app/api/cron/trainee-nicks/route.ts` (new), `vercel.json` | cron entry point, `*/10` schedule |
| `app/lib/services/discord-api.ts`, `app/api/claim-member/route.ts`, `app/api/auto-claim/route.ts` | `replaceTraineeNickWith` |
| `app/api/discord/callback/route.ts`, `app/lib/magic-login.ts`, `app/lib/people.ts`, `app/lib/discord-interactions/embeds.ts` | `realNick` |
| `.env.example` | `TRAINEE_NICK_ENABLED`, `TRAINEE_NICK_SINCE`, `TRAINEE_NICK_MAX_PER_RUN`, `TRAINEE_NICK_MIN_SIGNED_UP`, `PIZZA_NOOB_ROLE_ID` (optional override) |

No Prisma model or migration: the rename-once ledger has been dropped.

## Risks
- **GUILD_MEMBERS intent and Manage Nicknames:** **confirmed** on production (2026-10-18; Administrator; bot top role at position 120 of 128). If either is ever removed, the member list call fails or three 403s in a row abort the run. The failure is loud and does no harm.
- **Bad sheet read means a mass rename.** Mitigated by aborting on any error, a missing column, or a count below `MIN_SIGNED_UP`, plus the cap of 50 per run.
- **Bot role placement.** Confirmed: only 8 roles sit above the bot (Dread Pizza Roberts, Discord, Pizza Bots, sesh, Beemo, Hashbot, Dyno, Wick). Their holders are skipped as `outranked`, computed from role positions each run, so a later reshuffle is picked up automatically. Watch that count in the dry-run stats.
- **Members get annoyed** by forced renames. That is a product choice (Snax decided). The welcome flow should tell people that signing up at app.pizzadao.org sets their real name. Wording is a possible follow-up.
- **Legacy roster members** whose row has no Discord ID yet look not-signed-up. If they joined after SINCE they are enforced until they claim their row, and heal plus claim fix it then. Pre-SINCE members are out of scope.
- **Run duration.** The scan plus up to 50 PATCHes with waits fits easily in 120 s. If not, the run stops early and the next run continues.

## Tests (vitest)
- `app/lib/trainee-nick.test.ts` (planner):
  - Enforces members with a null nick, a custom nick, and a near-miss nick (`pizza trainee ` gets normalized: only an exact `TRAINEE_NICK` counts as compliant).
  - Skips `joined_at < since`, bots, the owner, outranked members (equal and higher positions), and signed-up members.
  - Heals signed-up members with the placeholder (an empty Name gives `null`).
  - Applies the cap and overflow, heal before enforce, and a stable order.
  - Covers the `isTraineeNick` and `realNick` cases.
  - Role:
    - A member with the trainee nick but without the role gets `addRole` only.
    - A member with the role but a custom nick gets `setNick` only.
    - A member with both is skipped.
    - When the role is unresolved or not assignable, nobody gets `addRole`, but nicks are still enforced.
    - Signed-up members never get `addRole`.
  - Sweep and no re-add:
    - A role holder in scope with L2 completed gets `removeRole`, whether signed up or not.
    - An out-of-scope (pre-go-live) holder with L2 is untouched.
    - A non-signed-up member with L2 completed who **lacks** the role gets `setNick` only and **never** `addRole`. This also covers the case where the sheet row went missing after L2.
    - If the L2 lookup is unknown, nobody gets `addRole` or `removeRole`.
    - The same member never gets both `addRole` and `removeRole` in one plan.
  - `computeCurrentLevel`-based L2 detection: L2 approved but L1 not complete counts as not completed; a paid L2 ledger row (including the legacy description format) counts as completed.
  - `resolvePizzaNoobRoleId`: a valid env override wins, an invalid override falls through to the name match, one name match works, and zero or several matches give `null` (e.g. "Pizza Noob" and "pizza-noob" both exist).
- `app/lib/trainee-nick-run.test.ts` (mocked deps):
  - `not_configured`, `busy` (lock held).
  - A dry run makes no PATCH calls.
  - The sheet is read after the members; a sheet error, a missing column, or a count below the minimum aborts before any PATCH.
  - PATCH bodies contain only `nick` and the audit header.
  - The role is added with the `PUT .../roles/{id}` call, never a `roles` PATCH. The PUT is skipped when the nick PATCH got a 403 or 404. When the role sits at or above the bot's position, or is `managed`, there are no PUT calls and the result is `roleStatus: 'role_not_assignable'`.
  - Rate-limit handling: a short wait, stop on a long reset, one 429 retry then stop.
  - A single 403 skips; three in a row abort.
  - A 404 is skipped.
- `app/lib/missions.settle.test.ts`: when the L2 reward is paid, `removePizzaNoobOnGraduate` is called once with the Discord ID. It isn't called for other levels or when the level was already paid. If the hook throws, the payout still succeeds. A separate unit test for the hook covers: dry run means no DELETE; not holding the role means no DELETE; a pre-SINCE `joined_at` means no DELETE; otherwise exactly one `DELETE .../roles/{id}`.
- `app/api/cron/cron-routes.test.ts`: the new route returns 401 without the secret, and the dry-run flag and query work.
- `app/lib/discord.test.ts`: pagination, and a throw on a non-OK response.
- `app/api/discord/oauth-flow.test.ts`, `app/lib/magic-login.test.ts`, the people and embeds tests: the session nick falls back to global_name or username when the nick is "Pizza Trainee".
- The claim-member and auto-claim tests: the placeholder is replaced by the sheet Name, and a custom nick is untouched.
- `npm run lint`, `npx tsc --noEmit`, `npm test`.

## Rollout
1. ~~Check the GUILD_MEMBERS intent, Manage Nicknames, and the bot's role position.~~ **Confirmed on production on 2026-10-18** (intent on; Administrator; bot top role at position 120 of 128). Nothing to do.
2. Merge with `TRAINEE_NICK_ENABLED` **unset**, so it dry-runs, and set `TRAINEE_NICK_SINCE` to the merge time in ISO format. The `realNick` and claim fixes go live right away and are harmless on their own.
3. Watch dry runs for about a day. Look at `roleRemoved` (should be 0 at first: nobody new has finished L2 yet), `scanned` (roughly the guild size), `inScope`, `enforced` (should be only real new joiners), `roleStatus` (must be `ok`, along with the resolved `pizzaNoobRoleId`), `outranked`, and the size of the signed-up map. You can check by hand with `curl -H "Authorization: Bearer $CRON_SECRET" "https://app.pizzadao.org/api/cron/trainee-nicks?dryRun=1"`.
4. Set `TRAINEE_NICK_ENABLED=true` and redeploy. In Discord, check the Audit Log for the reason string. Then test:
   - a new test alt gets "Pizza Trainee" and the Pizza Noob role;
   - change a test alt's nick, and it reverts within 10 minutes;
   - remove the alt's role, and it comes back within 10 minutes;
   - sign the alt up, and the nick becomes its mafia name and stays that way, and the alt **keeps** Pizza Noob;
   - complete L1 and L2 on the alt (approve with a reviewer account), and Pizza Noob is removed right away by the hook, and stays removed across later runs. To test the sweep, temporarily unset the flag while approving, re-enable it, and the next run removes the role.
5. **Rollback:** unset `TRAINEE_NICK_ENABLED` to go back to dry run, or remove the cron. With no ledger to undo from, renames are reverted by setting `nick: null` for in-scope members whose nick is "Pizza Trainee". Roles are reverted by removing Pizza Noob from in-scope members. This is safe even without a ledger, because every in-scope member joined after go-live and so couldn't have held the role before it. A one-off script using the same planner can do this.

## Vercel preview checks
- `GET /api/cron/trainee-nicks` without a secret returns 401. With the secret and `?dryRun=1` it returns `not_configured`, or dry-run stats if the Discord, Sheets and SINCE env vars are set on the preview.
- Onboarding on the preview with a Discord account whose server nickname is "Pizza Trainee": the Name step must not suggest "Pizza Trainee" (it falls back to the global name or username), and the name-match auto-claim must not search for it.
