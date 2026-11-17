# discord-bounty-command: /bounty in Discord

## Goal

Members can see open bounties from Discord and claim one, earning $PEP when the work is approved.
Discord is only a front door: listing and claiming call the same `app/lib/bounties.ts` functions as
the website, so the rules, the escrow and the notifications stay the same. Submitting work and the
payout stay on the website, and every reply links there.

Subcommands (all replies ephemeral):

| Subcommand | Does |
|---|---|
| `/bounty list [crew]` | Open bounties, newest first, up to 10, each with its id, reward, crew and a short description. Links to the full board. |
| `/bounty claim <bounty>` | Autocomplete over open bounties, then `claimBounty(discordId, id)`. Replies with the next steps and a link to submit. |
| `/bounty mine` | Your CLAIMED / SUBMITTED bounties (`getClaimedBounties`), with status and a link. |
| `/bounty giveup <bounty>` | Autocomplete over *your* claimed bounties, then `giveUpBounty`. |

Behind a new DB toggle, `discord.bountyCommandEnabled`, which is **off** by default.

## Facts the plan relies on

- Bounty `createdBy` / `claimedBy` hold Discord ids (`prisma/schema.prisma` model `Bounty`), so the
  interaction's user id goes straight into `claimBounty` / `giveUpBounty` with no lookup.
- `claimBounty` already covers not found, not OPEN, claiming your own bounty and the race with another
  claimer (a conditional `updateMany`). It fires `notifyBountyClaimed`. `giveUpBounty` checks that the
  bounty is yours and clears any submission notifications.
- The web claim route (`app/api/bounties/claim/route.ts`) needs only a session, then runs
  `requireOnboarded` (it upserts a `User` row). **Bounties have no level gate today**, on the site or
  anywhere else.
- Board URLs: a crew bounty is at `/crew/<crewId>#bounties` and a general one at `/pep`
  (`bountyLink` in `app/lib/notifications.ts`).
- Command pattern to copy: `/level`, `/profile` and `/vouch`. `handle.ts` checks the toggle, then the
  rate limit, then defers with an ephemeral reply (`DEFERRED_CHANNEL_MESSAGE` with `flags: 64`). The
  route's `after()` runs a module in `app/lib/discord-interactions/` that builds an embed and PATCHes
  `@original`. Autocomplete goes through `autocomplete()` in `handle.ts`, the way `/progress` crew
  and `/metalhead` call do.

## Files to change

1. `app/lib/settings/toggles.ts`: add
   `'discord.bountyCommandEnabled': { env: 'BOUNTY_COMMAND_ENABLED', legacy: ON_WORDS }`.
2. `app/lib/settings/registry.ts`: add a `boolSetting` next to `discord.levelCommandEnabled` (area
   `discord`, label `/bounty command`). Its help text should say the command must be registered with
   Discord, that the env var set to off always wins, and that preview deploys go by the env var.
   `confirmOn: 'Members will be able to list and claim bounties from Discord.'`
3. `app/lib/rate-limit.ts`: add `"bounty-command": { limit: 10, windowSec: 60 }` (per member).
4. `app/lib/discord-interactions/commands.ts`: add the `bounty` command with four `SUB_COMMAND`s:
   - `list`: `crew` (STRING, optional, autocomplete, max_length 80)
   - `claim`: `bounty` (INTEGER, required, autocomplete, min_value 1)
   - `mine`: no options
   - `giveup`: `bounty` (INTEGER, required, autocomplete, min_value 1)
   - and `dm_permission: false`

   Also update the header comment of `scripts/discord/register-commands.mjs` (command list and the
   toggle note). The script needs no code change because it reads `PEP_COMMANDS`.
5. **New** `app/lib/discord-interactions/bounty-command.ts`, in the same shape as
   `member-commands.ts`:
   - `BountyJob`: `{ sub, discordId, crewId?, bountyId?, applicationId, token, author? }`.
   - `BountyDeps`, injected so tests stay pure. It has `openBounties(crewId?)`, `claimedBy(discordId)`,
     `claim`, `giveUp`, `isMember(discordId)`, `crewLabels()` and `appUrl`, plus an optional
     `fetchImpl`.
   - Pure renderers: `renderList`, `renderClaimed`, `renderMine`, `renderGaveUp`, `renderEmpty`.
     - Escape descriptions the way `member-commands.ts` does (`esc`), flatten newlines and truncate
       each to about 90 characters.
     - Every line is `#id · 1,234 $PEP · Crew · description`.
     - The embed body stays under 4,000 characters.
     - The list ends with "Claim one with `/bounty claim`" and a link to the board.
   - `buildBountyReply(job, deps)`:
     1. Check the member first. If `isMember` is false, reply "Finish onboarding first" with the
        join link (reuse the wording of `renderVouchFailure('no-profile')`).
     2. `claim` and `giveup` catch `ApiError` with status under 500 and show its message, mapped to
        friendlier text:
        - "Bounty is not available" becomes "Someone else claimed it, or it was closed."
        - "Cannot claim your own bounty" is shown as is.
        - "You have not claimed this bounty" is shown as is.
     3. On success, `claim` says: "You claimed #id (N $PEP). When it's done, submit your work on the
        website; the poster or a crew lead approves it and the $PEP is paid to you." It links the
        bounty's board (`/crew/<crewId>#bounties` or `/pep`).
   - `runBountyCommand(job, deps)`: never throws. On an unexpected error it PATCHes a generic error
     reply, the same as `runMemberCommand`.
6. `app/lib/discord-interactions/handle.ts`:
   - Add `bounty?: { enabled, rateLimit, defer, choices(kind, discordId, query) }` to `HandlerDeps`.
   - Add `case 'bounty'`:
     1. Check `enabled` first, so a disabled command uses up no rate limit.
     2. Read the subcommand and its options from `i.data.options[0]` (as `/metalhead` does).
     3. Validate that `crew` is a crew id and `bounty` a positive integer.
     4. Run the rate limit, then defer with an ephemeral reply.
   - Autocomplete for `name === 'bounty'` while enabled:
     - `list.crew` lists crews (reuse `progressCrewChoices`).
     - `claim.bounty` lists open bounties whose id or description contains the query, as
       `#id · N $PEP · description` (100 characters max), up to 25, excluding the user's own.
     - `giveup.bounty` lists the user's claimed bounties.
7. `app/api/discord/interactions/route.ts`: wire up `bounty` deps.
   - `enabled: () => toggleEnabled('discord.bountyCommandEnabled')`.
   - The rate limit uses `checkKeyedRateLimit('bounty-command', id)`.
   - `defer` runs `runBountyCommand` in `after()`, wired to:
     - `getOpenBounties({ crewId })` and `getClaimedBounties`
     - `claim` calls `requireOnboarded` and then `claimBounty`, which matches the web route
     - `giveUpBounty`
     - `isMember: id => !!(await fetchMemberIdByDiscordId(id))`
     - `getCrewLabelMap` and `appUrl()`
   - `choices` uses one `prisma.bounty.findMany` (status OPEN, `take: 25`, select only id, reward,
     description and createdBy). It is a single indexed query, cheap enough for the 3-second
     autocomplete window.
   - Update the route's header comment.
8. Tests, listed under Verify.

## Approach and alternatives

- **Deferred, not inline.** A claim is a fast DB write, but the member check reads the member
  repository, and deferral is the house pattern. Deferral also keeps the 3-second deadline safe on a
  cold start.
- **Capped list, not paged.** The list shows 10 entries, with "N more on the website" when there are
  more. The alternatives were Prev/Next buttons (a new `bn:` component prefix and stateless offset
  ids) or a `page` option. Buttons can come later if the board grows. The `crew` filter already
  narrows the list.
- **Autocomplete for the claim, plus the raw id.** The option is an INTEGER, so a member can also type
  the `#id` shown by `/bounty list`. Autocomplete is cheap, so it's included. Another option was a
  "Claim" select menu on the list reply, but that adds component handling for little gain.
- **Crew tasks: later (recommended).** Crew tasks (`app/api/claim-task/route.ts`,
  `crew-tasks-write.ts`) carry **no $PEP reward**. Half of them still live in Google Sheets, so
  claiming means a Sheets write or a DB write depending on `sheets.source.crewTasks`, and the claim
  logic sits inside the route rather than in a lib function. Adding them would double the scope and
  break "earn $PEP". A follow-up task can extract `claimCrewTask()` into a lib and add
  `/task list|claim` or a `/bounty list` section. For now `/bounty list` can end with one line, "Crew
  tasks (no $PEP): see your crew page".
- **No new claim rules on Discord.** Any rule added only on Discord would let the two surfaces
  disagree. A level gate, if wanted, belongs in `claimBounty` itself (see Owner decisions).

## Risks

- **Zero open bounties** (overall or for a crew): reply with an empty state. "No open bounties right
  now" (or "for <Crew>"), followed by "Have work that needs doing? Post a bounty with an escrowed $PEP
  reward:" and a link to `/pep` (or the crew page). Autocomplete returns no choices, and the claim
  path still handles a stale id ("not available").
- **Rate limits.** The member limit is `bounty-command`, 10 per minute. Autocomplete fires on every
  keystroke and isn't rate-limited, the same as `/buy` and `/progress`. It is one capped,
  select-limited query and Discord throttles the client side, which is acceptable. Discord's own
  limits only matter for the single PATCH per command.
- **Claiming without enough level.** There is no level rule today, so anyone with a member profile
  can claim, the same as on the site. Discord does add a reach risk: members who are not onboarded can
  find the command. Requiring a member profile (`isMember`) closes that gap, which is stricter than
  the site's session-only check. If owners want a minimum level, add it to `claimBounty` so both
  surfaces enforce it.
- **Claim hoarding.** Discord makes claiming easy, so one member could claim many bounties. There is
  no cap today. A cap of N active claims, set in DB settings, can be added to `claimBounty` later if
  needed. Watch this after launch.
- **Descriptions with mentions or markdown.** Bounty descriptions can hold `<#channel>` / `<@&role>`.
  Channel mentions render natively in Discord. Send `allowed_mentions: { parse: [] }` so nothing pings,
  and escape markdown.
- **Notifications.** `notifyBountyClaimed` is fire-and-forget and runs unchanged, so the poster is
  told the same way as for a web claim.
- **Registration.** The PUT in `register-commands.mjs` replaces the whole guild command list. After
  deploy, run the dry run first and then `--apply` from a checkout of main, so no other command is
  dropped. Until it is registered, `/bounty` does not appear. Until the toggle is on, it answers
  "/bounty isn't enabled yet."

## Verify

Unit tests (vitest, no network):
- `app/lib/discord-interactions/__tests__/bounty-command.test.ts`:
  - The renderers: line format, truncation and escaping, the 10 cap with an "N more" line, and the
    crew label.
  - The empty state for all bounties and for one crew, with the post-a-bounty link.
  - `claim` success text with the right board link (crew vs `/pep`).
  - Each `ApiError` mapped: not available, own bounty, not found.
  - A non-member gets the onboarding message, and `claim` is never called.
  - `mine` with nothing claimed, and with CLAIMED and SUBMITTED bounties.
  - `giveup` success, and a bounty that isn't yours.
  - `runBountyCommand` PATCHes `@original` once and falls back to the error reply when `deps` throw.
- `app/lib/discord-interactions/__tests__/interactions.test.ts`:
  - With the toggle off, the reply is "isn't enabled yet" and no rate limit is used.
  - A bad `bounty` or `crew` option is rejected.
  - When rate-limited, the reply is a wait message.
  - The deferred reply is ephemeral, and `defer` gets the right `sub`, `bountyId` and `crewId`.
  - Autocomplete for each focused option, and empty choices while disabled.
- A `commands.ts` snapshot or assertion that `bounty` has the four subcommands and no option over
  Discord's limits (names of 32 characters or fewer, descriptions of 100 or fewer).
- A settings registry test, if one lists toggles: the new key resolves to off by default.
- `npm run lint`, `npx tsc --noEmit` and `npm test`.

Preview (Vercel, via `/ship`):
- The build is Ready, and the toggle shows in the admin settings UI, off.
- Interactions only reach production's endpoint, so Discord end-to-end checks happen after merge:
  1. Run the `register-commands.mjs` dry run, check the `bounty` JSON, then `--apply`.
  2. With the toggle off, `/bounty list` answers "not enabled".
  3. Turn the toggle on. Then:
     - `/bounty list` shows the open bounties, or the empty state.
     - `/bounty claim` autocompletes.
     - Claim a test bounty posted by another account. It shows as CLAIMED on `/pep`, and the poster
       gets the notification.
     - `/bounty mine` lists the bounty, and `/bounty giveup` returns it to OPEN.
     - Claiming your own bounty is refused.
     - Rapid repeats hit the rate-limit message.

## Owner decisions (with recommendations)

1. **Crew tasks in `/bounty`?** Recommend **later**, as a separate task: crew tasks have no $PEP
   reward, and their claim logic needs pulling out of the route first.
2. **Include `/bounty mine` and `/bounty giveup`?** Recommend **yes**. Each is a few lines on top of
   existing lib functions, and give-up keeps abandoned claims from blocking a bounty.
3. **Who may claim from Discord?** Recommend **any member with a profile**. That is the site's rule
   plus a profile check, with no level gate. If a level gate is wanted, add it to `claimBounty` as a
   DB setting (for example `bounties.minClaimLevel`, default 0) so the site and Discord both enforce it.
4. **List size and paging.** Recommend a **cap of 10 plus a crew filter and a website link**, with no
   buttons for now.
5. **Cap on active claims per member?** Recommend **not now**. Watch for hoarding after launch, and if
   needed add a DB setting enforced in `claimBounty`.
6. **Public announcement of claims** (for example "X claimed #12" in a channel)? Recommend **no** for
   v1: replies stay ephemeral and the poster's notification is enough.
7. **Rollout.** Recommend: merge with the toggle off, register the command, test with the toggle on
   briefly, then leave it on and announce it.
