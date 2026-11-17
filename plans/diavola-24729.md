# diavola-24729: Fix PEP jobs so they don't show ugly Discord names

TASKS.md row: "Fix pep jobs so they don't have ugly discord names etc" (P2). It was moved back from
Done on 2026-11-14 because nothing showed it had shipped. This plan says exactly what "ugly" means
today, so the next "done" can be checked.

## What "PEP jobs" are

There are two things members call PEP jobs:

1. **Daily jobs on `/pep`** (the main meaning). The `Job` table has 40 rows: 32 active real
   jobs, plus 8 inactive junk rows left over from the old Google Sheet sync, whose description is a
   header or type word. `getDailyJobs()` in `app/lib/jobs.ts` picks `economy.dailyJobsCount` of
   them each UTC day. `GET /api/jobs` serves them, and the page renders them with
   `app/ui/jobs/JobBoard.tsx` → `JobCard.tsx` → `app/ui/shared/DiscordText.tsx`. The Discover tile on
   the dashboard (`app/dashboard/[id]/components/Discover.tsx`, through `useDiscover` in
   `app/lib/hooks/use-api.ts`) shows them too. Completing a job (`POST /api/jobs/assign`) writes a
   `JOB_REWARD` ledger row, which `/api/economy/history` → `TransactionHistory.tsx` shows. Job text was
   pasted straight from Discord, so it is full of raw markup: `<#channel>`, `<@&role>`, `<@user>`,
   `<:emoji:id>`, `<a:emoji:id>`, markdown links. There is no admin UI for jobs; they are edited in
   the DB only.
2. **Discord `/work`** (`app/lib/pep-earn/work.ts`, handled in
   `app/lib/discord-interactions/handle.ts`). It replaces UnbelievaBoat's "work". Its replies are the
   built-in `DEFAULT_WORK_PROMPTS`: no `work.prompts` setting is saved in prod and there is no
   `WORK_PROMPTS_JSON` env var. Those replies contain no Discord names. The reply embed's **author
   line** is the invoker's *Discord* name (`displayName()` in `discord-interactions/embeds.ts`: nick,
   then global name, then username), not their PizzaDAO name.

## What the "ugly names" actually are (checked in prod, 2026-11-17)

The 2026-10 markup renderer (`7083ef20`, `#289`) already turns raw tags into UI on `/pep`, so the
original sheet-era problem is mostly gone. What is still ugly or wrong:

| # | Surface | What members see | Root cause |
|---|---|---|---|
| A | `/pep` job cards, Discover tile | **Every channel mention shows as `#channel`**, never the real channel name. Today's live `/api/jobs` response has `channels: {}`, while the role in the same response resolves. | `resolveDiscordMentions` gets channel names from `getGuildChannels()` (`GET /guilds/{id}/channels`, 2.5 s timeout). In prod that call **always times out**: Vercel logs over 7 days show only `[discord-activity] channel names { ms: ~2500, ok: false }` and no successes. The same failure blanks public channel names on profiles. It also adds about 2.5 s to the first `/api/jobs` call on each instance, until the 60 s negative cache kicks in. |
| B | Job "couldn't find your post" error | "Post it in the channel" instead of `#name` | Same as A (it reads `channels[result.channelId]`). |
| C | Job cards, user mentions | A job that tags a non-member shows that person's raw Discord nick, global name or username (emoji, decorations, `_123`-style handles). If the lookup fails it shows `@user`. 2 of the 3 user ids that jobs mention are not app members. | `resolveUsers` falls back to `getGuildMemberName`, which returns the raw nick, global name or username with no cleanup. |
| D | One job (role activation) | Stray backslashes, e.g. `\` + emoji and `\#channel` | The description has Discord-escaped tags (`\<:emoji:id>`, `\<#id>`). The parser doesn't know about the escape, so the `\` stays as text. |
| E | Ledger memos written since 2026-10-08 | `:pepperoni:`-style emoji names as literal text. They would also freeze `#channel` into the memo, because of A. | `assign` route / `completeJob` store `discordTextToPlainText(...)`, which turns a custom emoji into `:name:` and an unresolved channel into `#channel`, permanently. (No `JOB_REWARD` row has been written since 2026-10-07, so prod has no such rows yet. The bug fires on the next completion.) |
| F | Ledger history, junk memos | `Daily job: content_creation`, `Daily job: Type`, `Daily job: gameplay`, `Daily job: idea_submission` (18 rows, jobs 33–40) | The junk sheet rows were active for a while and paid out. Their "description" was a header or type cell. |
| G | Ledger history, transfers | `Transfer from 1234…` / `Transfer to 1234…` (a raw Discord snowflake or a member number) | `transfer()` in `app/lib/economy.ts` writes ids into the memo, and nothing resolves them when the memo is shown. |
| H | `/pep` leaderboard | Non-members show as a truncated Discord id like `12345678...`. 2 of the current top 10 are not app members. | `UserLink` falls back to `discordId.slice(0, 8) + "..."` when `/api/member-lookup` finds nothing. |
| I | Discover tile job label | `CONTENT_CREATION`-style raw type slug | `useDiscover` passes `crew: j.type` straight through; `JobCard` uses `prettyLabel()`, Discover doesn't. |
| J | Public `GET /api/jobs` | Nothing visible, but each job carries `assignees`: **every Discord id that ever completed it**, served to anonymous callers. No UI reads it. | Leftover field from `getJobs()`. |
| K | Discord `/work` (and every PEP command reply) | The embed author line is the Discord nick, global name or username, not the PizzaDAO name. | `authorFor(i.member)` only knows the interaction payload. |
| L | `ActiveJob.tsx` | Nothing (not mounted anywhere), but it renders `job.description` raw | Dead code from the old assign/quit flow. |

Not ugly, so leave alone: role mentions resolve fine. Member names in the DB keep their topping
emoji on purpose; that is the PizzaDAO name the profile shows, so **don't** strip emoji from
`Member.name`. `/work` reply texts are fine. The Discord `/leaderboard`, `/balance` and `/pay` use
silent `<@id>` mentions on purpose (there is a test for it), and Discord renders those as names.

## Name resolution to reuse

- **Members:** `Member.name` keyed by `Member.discordId`, with `mergedInto: null`. This is what
  `resolveUsers()` in `app/lib/discord-mention-resolve.ts` already does first, and what
  `resolveMemberNames()` in `app/lib/calls/live-members.ts` does. Both read the DB `Member` table,
  which the profile and crew pages use. Use the same query. Don't add a third copy: export a small
  `memberNamesByDiscordId(ids)` → `Map<discordId, {name, memberId}>` from a new
  `app/lib/member-names.ts`, and switch `resolveUsers` to call it. `live-members.ts` can adopt it
  later.
- **Non-members:** `getGuildMemberName()` (cached per id), with its result cleaned by
  `sanitizeDisplayName()` from `app/lib/display-name.ts` (the same normaliser the onboarding name
  step uses). Skip the Pizza Trainee placeholder with `realNick()` from `app/lib/trainee-nick.ts`.
- **Final fallback:** a neutral label, never an id. Use `@member` for a mention and `a member` in
  prose and the leaderboard.

## Approach

### Phase 1: daily jobs on `/pep` (fixes A–E, I, J, L)

1. **Resolve channel names one id at a time** (`app/lib/discord-channels.ts`,
   `app/lib/discord-mention-resolve.ts`).
   - Add `getChannelName(id, opts)` → `string | null`. It calls `GET /channels/{id}` (one small
     object, fast) and caches the result in memory per id, like `memberNameCache`: an hour for a
     hit or a 404, `FAIL_TTL_MS` for a failure. It also keeps a copy in the shared KV
     (`cacheGet`/`cacheSet` from `app/api/lib/cache`, key `discord:channel-name:<id>`, 24 h), so a
     cold instance doesn't call Discord for it. Add `name` to the `ChannelInfo` that `getChannel`
     returns, and build on it instead of writing a second fetch.
   - In `resolveDiscordMentions`, resolve `channelIds` with `getChannelName`, capped at
     `MAX_BOT_CHANNEL_LOOKUPS = 25` like the user cap, and **stop calling `getGuildChannels()`
     here**. That removes the 2.5 s wait. Job texts reference only a handful of distinct channels.
   - The bot already reads messages in these channels (`jobs-verify`), so it has View Channel on
     them.
2. **Clean names for display** (new pure helpers in `app/lib/discord-markup.ts`, or a sibling
   `discord-names.ts`, client-safe):
   - `cleanChannelName(raw)`: strip a leading or trailing run of emoji, symbols and decorative
     separators (`・ | ┃ │ ︱ ｜ • · ‣ -`, whitespace) that servers put around channel names, e.g.
     `🍕・general` → `general`. Keep the inner name as is. If nothing is left, return the raw name.
     Apply it where channel names enter the maps (in `resolveDiscordMentions`), so the job card, the
     error message, memos and the Discover tile all get it.
   - `cleanGuildName(nick, globalName, username)`: take the first candidate that is non-empty after
     `realNick()` and `sanitizeDisplayName()`. Use it in `getGuildMemberName` (or a wrapper used only
     by the mention resolver; the decision is under Open decisions).
3. **Backslash-escaped tags** (`parseDiscordMarkup`): when a recognised tag (emoji, channel, role,
   user, timestamp) is directly preceded by a single `\`, drop the backslash and render the tag
   normally. Discord shows such text literally, but a web page should show the resolved name. Do it
   in the text-segment emit step (trim the trailing `\` of the preceding text token when the next
   token is a tag), not with a regex pre-pass, so `\\` and a backslash before plain text are left
   alone. `extractMentionIds` must still find these ids (it should already, since it scans with the
   same regex).
4. **Plain text without emoji names** (`discordMarkupToPlainText`): a custom emoji becomes `""`
   instead of `:name:`, then double spaces are collapsed and the result trimmed. This applies to
   aria-labels, Discover, Telegram city posts and memos. The alt text in `DiscordEmoji` stays
   `:name:`. Check `app/lib/telegram/city-posts.ts` tests for an expectation of `:name:`.
5. **Ledger memos** (`app/api/jobs/assign/route.ts`, `completeJob` in `app/lib/jobs.ts`): keep
   writing plain text, which is now correct thanks to steps 1, 2 and 4. When a channel or user is
   still unresolved, write the **raw tag** for that token instead of `#channel` or `@user`. History
   already resolves markup when it displays a memo (`/api/economy/history` → `DiscordText`), so a
   later fix still improves old rows. Add the option to `PlainTextOptions` (`keepUnresolved: true`),
   next to the existing `keepTimestamps`.
6. **`GET /api/jobs`**: remove `assignees` from the response. Also drop it from the `Job` types in
   `JobBoard.tsx` and `JobCard.tsx` (and their test fixtures). `getJobs()` can stop including
   `assignments`.
7. **Discover tile**: `crew: prettyLabel(j.type)` in `useDiscover`, or `prettyLabel` at render time
   in `JobItem`, matching `JobCard`.
8. **Delete** `app/ui/jobs/ActiveJob.tsx` and its export in `app/ui/jobs/index.ts`. Leave the
   unused `/api/jobs/quit` and `/api/jobs/complete` routes alone; that is a separate cleanup.
9. **Fallback labels** in `DiscordText` and the plain-text helper: unresolved user → `@member`
   (was `@user`). Keep `#channel` for an unresolved channel (rare once step 1 lands; a deleted
   channel still links to Discord).

### Phase 2: the rest of the PEP pages (the "etc": G, H)

10. **Transfer memos** (`/api/economy/history`): for `TRANSFER_SENT`/`TRANSFER_RECEIVED` rows, take
    the counterparty from `metadata.toUserId`/`fromUserId`. Resolve it with
    `memberNamesByDiscordId`, then the cleaned guild name, then `a member`, and return a
    `counterpartName` (and `counterpartMemberId`) per row. `TransactionHistory` then shows
    "Transfer from {name}", linked to the profile when there is a member id. Leave the stored memo
    alone (ids are the stable record). For legacy rows whose memo has a short member number
    instead of a snowflake, show the memo unchanged.
11. **Leaderboard** (`/api/economy/leaderboard` + `Leaderboard.tsx` + `UserLink`): resolve names on
    the server for the 10 rows in one query (`memberNamesByDiscordId`), then cleaned guild names for
    the rest. Return `name` per row. Give `UserLink` an optional `name` prop that skips the
    `/api/member-lookup` fetch. Change `UserLink`'s own fallback from a truncated id to
    `a member`, which also helps every other `UserLink` user. Keep the sheet-based `memberId`
    lookup as it is.

### Phase 3: Discord `/work` and the other PEP replies (K)

12. Add an optional `memberName?: (discordId) => Promise<string | null>` to `HandlerDeps`. In
    `handleInteraction`, before building `Out`, look the invoker up with a hard budget (race against
    ~300 ms, `null` on timeout or error, so the 3 s interaction deadline is never at risk). Then
    `authorFor()` uses it: `name = pizzaName ?? displayName(member)`. The author name is plain text
    (Discord doesn't render markdown there), so just cap it at 256 with `sliceUnits`. Wire
    `memberName` in `app/api/discord/interactions/route.ts` to `memberNamesByDiscordId([id])`.
    The deferred commands (`/missions`, `/profile`, `/task`, `/bounty`, `/live`) build their author
    with `authorFor` too. Give them the same name by passing the resolved author into their `defer`
    jobs. That is the same object, and they already take `author`.
13. **Escaping:** any PizzaDAO or guild name put into an embed **description or field** (not the
    author line) must go through `esc()` from `app/lib/discord-interactions/text.ts`, which escapes
    markdown and breaks `@` pings, and keep `allowed_mentions: NO_PINGS`. Phase 3 only changes the
    author line, so no new description text is added. If the leaderboard decision below goes the
    "names" way, those lines need `esc()`.

## Data cleanup (DONE 2026-11-17)

Done 2026-11-17: the 18 junk-memo rows (jobs 33-40) were rewritten to "Daily job (retired)" in prod. Do not redo it. The steps below are kept as the record of what ran.

Only F needs data. A–E are fixed in code and old memos are resolved when shown.

1. Dry run, with no names or ids in the output:
   ```sql
   SELECT metadata->>'jobId' AS job, description, count(*) FROM "Transaction"
   WHERE type = 'JOB_REWARD' AND (metadata->>'jobId')::int BETWEEN 33 AND 40
     AND description ~ '^Daily job: [A-Za-z_'']+$' GROUP BY 1, 2 ORDER BY 1;
   ```
   Expect 18 rows across jobs 33–40.
2. Proposed write, after Snax OKs it. It is a memo-only change; amounts and balances are untouched:
   ```sql
   UPDATE "Transaction" SET description = 'Daily job (retired)'
   WHERE type = 'JOB_REWARD' AND (metadata->>'jobId')::int BETWEEN 33 AND 40
     AND description ~ '^Daily job: [A-Za-z_'']+$';
   ```
   Run it through `pizzadao-db` as a single statement and confirm the row count matches the dry run.
3. Leave the junk `Job` rows 33–40 (already inactive; ledger metadata points at them). Leave job 25's
   backslashes; step 3 handles them in code.
4. Content note for Snax, not a code change: one job's text ends "Add your idea to the list and share
   it in #channel:" and the link to the list is missing. Many job texts hard-code "50" instead of
   `{amount}`, so they go stale if `economy.jobRewardAmount` changes.

## Files to change

- `app/lib/discord-channels.ts`: `getChannelName` (+ KV cache), `name` on `ChannelInfo`, cleaned
  guild member names
- `app/lib/discord-mention-resolve.ts`: per-id channel lookup, cleaned names, `memberNamesByDiscordId`
- `app/lib/member-names.ts` (new): the shared member name lookup
- `app/lib/discord-markup.ts`: backslash escapes, emoji-free plain text, `keepUnresolved`,
  `cleanChannelName`/`cleanGuildName` (or a new `app/lib/discord-names.ts`)
- `app/ui/shared/DiscordText.tsx`: `@member` fallback
- `app/api/jobs/route.ts`, `app/lib/jobs.ts`: drop `assignees`; `completeJob` memo options
- `app/api/jobs/assign/route.ts`: memo options
- `app/ui/jobs/JobBoard.tsx`, `app/ui/jobs/JobCard.tsx`: types; delete `ActiveJob.tsx`, edit
  `index.ts`
- `app/lib/hooks/use-api.ts` or `app/dashboard/[id]/components/Discover.tsx`: `prettyLabel`
- `app/api/economy/history/route.ts`, `app/ui/economy/TransactionHistory.tsx`: transfer
  counterparty names
- `app/api/economy/leaderboard/route.ts`, `app/ui/economy/Leaderboard.tsx`, `app/ui/UserLink.tsx`:
  server names, `name` prop, no-id fallback
- `app/lib/discord-interactions/handle.ts`, `embeds.ts`, `app/api/discord/interactions/route.ts`:
  `memberName` dep and author name

## Alternatives considered

- **Fix `getGuildChannels` instead (longer timeout, KV-cached list).** That would also fix public
  channel names on profiles and call recaps, but it is cross-cutting and still slow when the cache
  is cold. The per-id lookup is the smaller, safer fix for jobs. Recommend a **separate task** for
  the guild channel list timeout, with the log evidence above.
- **Store memos as raw markup and only render them.** It is simpler, but other readers of the memo
  text (admin views, Telegram-style plain consumers, exports) would show tags. Plain text plus
  `keepUnresolved` keeps both working.
- **Rewrite job descriptions in the DB to plain text.** This would lose the channel links and the
  checks that read `<#id>` from the description (`parseJobRequirements` in `jobs-verify.ts`). Rejected.
- **Show PizzaDAO names in the Discord `/leaderboard` instead of `<@id>`.** See Open decisions.

## Risks

- `GET /channels/{id}` returns 403 for a channel the bot can't view, so the name stays `#channel`.
  That is the same as today, and it is cached so it isn't retried every request.
- Changing `discordMarkupToPlainText` emoji output touches aria-labels and Telegram city posts. Run
  their tests and update expectations deliberately.
- Phase 3 adds a DB read before every interaction reply. The ~300 ms cap and fail-soft fallback keep
  the 3 s deadline safe. The interactions tests build deps without `memberName`, so existing
  expectations don't change.
- Prisma `select` changes in `getJobs()` must not break `isTodaysDailyJob` or `getDailyJobs`
  callers, which only need `id`.
- Public repo: tests and fixtures use made-up names and ids only.

## Tests

- `discord-channels.test.ts`: `getChannelName` hit, 404, failure negative cache, KV hit skips
  fetch; `ChannelInfo.name`.
- `discord-mention-resolve.test.ts`: channels resolve with **no** guild-list call; cap of 25;
  channel names cleaned; non-member nick cleaned, trainee placeholder skipped; member name wins.
- `discord-markup.test.ts`: `\<:e:1>` and `\<#1>` render as tokens with no stray `\`; `\\` and
  `\text` unchanged; plain text drops emoji and collapses spaces; `keepUnresolved` keeps raw tags;
  `cleanChannelName` cases (leading emoji + `・`, `┃`, all-symbol name falls back to raw).
- `DiscordText.test.tsx`: `@member` fallback.
- `app/api/jobs/assign/route.test.ts`: memo has a resolved `#name`, no `:emoji:`, and raw tag when
  unresolved.
- `api/jobs` (new small route test or `economy-cache-headers.test.ts`): no `assignees` key.
- `JobCard.test.tsx`, `Discover.test.tsx`: fixtures without `assignees`; Discover shows
  "Content creation".
- `TransactionHistory.test.tsx` + history route: transfer shows the counterparty name, not an id.
- Leaderboard: server name used; `UserLink` with `name` makes no fetch; fallback `a member`.
- `interactions.test.ts` / `embeds-nick.test.ts`: author uses `memberName` when present, Discord
  name when it returns null, times out or throws.
- `npx tsc --noEmit`, `npm run lint`, `npx vitest run`.

## Verify on the Vercel preview

1. `/pep` (signed in): today's job cards show real channel names (e.g. `#general`, with no emoji
   prefix), role pills and emoji images, and no `#channel`, `@user` or stray `\`. Click a channel
   link and Discord opens the right channel.
2. DevTools → `/api/jobs`: `channels` is non-empty, there is no `assignees`, and the response is fast
   (well under 1 s) even on the first hit.
3. Tap a job you haven't posted for: the error names the channel ("…in #general today").
4. Dashboard → Discover → Jobs tab: pretty type label; the aria-label has no `:emoji:`.
5. `/pep` history: an old raw-markup job memo renders resolved; a transfer row shows a name.
6. `/pep` leaderboard: no truncated ids.
7. Discord `/work`: interactions go to the prod endpoint, so check after merge. The author line
   shows the PizzaDAO name for a member, and a non-member still gets their Discord name. Confirm
   with Snax's own account.
8. After merge: watch the Vercel logs for `/api/jobs` errors for a day.

## Open decisions (recommendations)

1. **Scope.** Recommended: ship Phase 1 + 2 in one PR (all web, low risk) and Phase 3 in a second,
   small PR, because it touches every Discord reply.
2. **Guild channel list timeout** (which also breaks public channel names on profiles and recaps):
   recommended as a new TASKS.md row, not this PR.
3. **Discord `/leaderboard` names:** keep the silent `<@id>` mentions (deliberate, tested, and
   Discord shows the server name). Recommended: no change. The alternative is escaped PizzaDAO names
   with a mention fallback.
4. **Clean non-member guild names globally or only in the mention resolver:** recommended only in
   the mention resolver and leaderboard. Other `getGuildMemberName` callers may want the raw name.
5. **Junk memo rewrite text:** recommended `Daily job (retired)`. Needs Snax's OK before running.

## Decisions (2026-11-17)

- Phases 1 and 2 ship in one PR; Phase 3 (Discord `/work` embed author) is a separate follow-up PR.
- Discord `/leaderboard` keeps its silent `<@id>` mentions.
- Non-member guild names are cleaned only in the mention resolver and the leaderboard/history lookups, not inside `getGuildMemberName`.
- The guild channel-list timeout is its own task: `discord-guild-channels-timeout` in TASKS.md. This PR only adds the per-channel lookup.
- `assignees` is removed from the public `/api/jobs` response.
