# discord-task-command: sign up for crew tasks from Discord

## Goal

Members can browse open **crew tasks** (not bounties) across crews and sign up for one from Discord with
`/task list [crew]`, `/task claim <task>`, `/task mine` and `/task drop <task>`. Discord is only a front
door: claiming and dropping go through the same lib function as the crew page's Claim / Give up buttons,
so the rules, the audit trail and the update digest stay the same. Off by default behind
`discord.taskCommandEnabled`.

## What exists today (findings)

- **Storage.** Production reads crew tasks from the database: `sheets.source.crewTasks` is saved as `db`
  (all crews). `CrewTask` rows (`leadMemberId`, `leadName`, `stage`, `priority`, `due`, `archived`).
  Previews default to the sheet unless `SHEETS_SOURCE_CREW_TASKS` is set (app/lib/sheets-import/source.ts),
  and `SHEETS_SOURCE_CREW_TASKS=sheet` is the kill switch back to Google Sheets.
- **Claim = becoming the task's lead.** `app/api/claim-task/route.ts` (`POST {crewId?, sheetUrl, taskName, action: 'claim'|'giveup'}`):
  - DB path (`findDbTaskCrew` + `claimInDb`):
    - Finds the first non-archived task in the crew whose trimmed label equals `taskName`.
    - Claiming sets `leadMemberId` and `leadName` with a conditional `updateMany`, so it is race-safe. A task
      someone else leads gets 409.
    - Giving up clears both, and only the lead may do it (403).
    - It writes a `CrewTaskEvent` (`claim`/`giveup`, non-blocking).
    - On a claim it also writes a `TaskClaimEvent` upsert (key `${sheetId}::${label}`, or
      `crew:${crewId}::${label}`) and `recordActivation('first_contribution', code 'task_claim')`.
    - It does not check the stage: a closed task can still be claimed.
  - The sheet path writes the sheet's Lead ID cell through the Sheets API, with the same ownership rules,
    plus `TaskClaimEvent` and the activation.
- **Who may claim:** any signed-in user with a linked member id. Crew membership is not checked, and claiming
  does not add the member to the crew.
- **Notifications:** none fire right away. `app/lib/crews/task-update-posts.ts` (cron, off by default via
  `crews.taskUpdatePostsEnabled`) folds `CrewTaskEvent` rows, including `claim`, into one batched no-ping digest
  in the crew channel ("given a lead"). A Discord claim that writes the same event shows up there for free.
- **No tests cover `claim-task/route.ts` today.**
- The `/bounty` pattern is in place:
  - `bounty-command.ts` (pure, with deps injected, deferred ephemeral reply via PATCH @original,
    `allowed_mentions: {parse: []}`, `esc`, code-point `short()`).
  - `bounty-choices.ts`.
  - `handle.ts` `case 'bounty'` and autocomplete.
  - `commands.ts`.
  - `route.ts` deps.
  - `rate-limit.ts` `"bounty-command": 10/60s`.
  - The toggle in `toggles.ts`, `registry.ts` and `registry.test.ts`.
  - `register-commands.mjs`.

## Approach

### Step 1. Characterization tests first (before touching the route)

New `app/api/claim-task/__tests__/route.test.ts` (vitest). It mocks `requireSession`, `prisma`, `getCrewMappings`,
`usesDb`, the member repository, `googleapis` and `recordActivationLater`. Each test asserts the exact status, JSON
body and DB/Sheets calls:

- Invalid action: 400.
- DB path:
  - Claim succeeds:
    - `updateMany` where has the OR on null / '' / self.
    - `leadName` comes from the member name.
    - The `CrewTaskEvent` is created.
    - The `TaskClaimEvent` key uses the sheet id, or the `crew:` prefix when there is no sheet.
    - The activation is recorded.
  - Already led by someone else: 409.
  - The race, where `updateMany` count is 0: 409.
  - Giving up a task you don't lead: 403.
  - Give-up succeeds, writes no `TaskClaimEvent` and records no activation.
  - No member: 403.
  - Unknown label: 404.
  - The crew is found by `sheetUrl` when there is no `crewId`.
  - A failed event write still returns 200.
- Sheet path:
  - Missing fields: 400.
  - Bad URL: 400.
  - Not a configured crew sheet: 403.
  - Task not found: 404.
  - No Lead / Lead ID column: 500.
  - Claim writes the member id.
  - Give-up writes ''.
  - Claimed by another: 409.

Commit these against the current route. They must pass before the extraction and, unchanged, after it.

### Step 2. Extract `app/lib/crews/claim-task.ts`

- `claimCrewTask(input): Promise<ClaimResult>`:
  - `input = { discordId, action: 'claim'|'giveup', crewId?, sheetUrl?, taskName?, taskId?, requireOpen? }`
  - `ClaimResult = { ok: true; action; task?: { id, label, crewId } } | { ok: false; status: 400|403|404|409|500; error: string }`
  - It holds `findDbTaskCrew`, `claimInDb` and the sheet path, moved as they are (`extractSheetId`, `columnToLetter`, the
    allowed-sheet check).
  - New and opt-in only, so the web route is unaffected:
    - `taskId` looks up `{ id, crewId, archived: false }` instead of the label.
    - `requireOpen` returns 409 "That task is closed" for `isClosedStage`.
  - The Discord caller passes both. The web route passes neither.
  - The sheet path runs only for the existing `sheetUrl + taskName` input.
- The route becomes: `requireSession`, parse the body, `claimCrewTask(...)`, then map the result to
  `NextResponse.json({ success: true, action })` or `{ error }` with the status. The `internalError` catch stays.
- Activation: keep `recordActivationLater`, which already falls back to fire-and-forget when `after()` is
  unavailable. Discord code runs inside `after()`. If nested `after` turns out to throw there, the
  fallback still records it. Have the Discord deps await `recordActivation` directly through an optional
  `onClaimed` hook only if testing shows it is dropped.
- Unit tests `app/lib/crews/__tests__/claim-task.test.ts` cover the new `taskId` and `requireOpen` branches,
  and check that a `taskId` from another crew or an archived task gives 404.

### Step 3. Command module `app/lib/discord-interactions/task-command.ts`

A copy of the bounty-command shape:

- `TASK_SUBCOMMANDS = ['list','claim','mine','drop']`.
- `TaskJob { sub, discordId, crewId?, taskId?, applicationId, token, author? }`.
- `TaskDeps { openTasks(crewId?), myTasks(memberId), claim(discordId, taskId), drop(discordId, taskId), memberId(discordId), crewLabels(), appUrl, fetchImpl? }`.
- Line: `Crew · task label · Top · due Nov 30`. Leave out the priority and due parts when they are empty.
  The label is flattened, cut to about 90 code points, then `esc()`ed. The crew label is escaped too.
  Share `esc`/`short`/`link` by moving them from bounty-command.ts into a small `text.ts`, and have
  bounty-command import them (no behavior change, existing tests cover it).
- `list`:
  - Shows up to `LIST_CAP = 10`, then "N more on the website".
  - The link goes to `/crew/<id>#tasks` when filtered, `/crews` otherwise.
  - Footer: "Sign up with `/task claim`. Paid work: `/bounty list`."
  - Empty state links the crew page.
- `claim` reply: "You're on it: <task> (<crew>)." plus "Update its stage or give it up on the crew page"
  with a link.
- `mine`: the member's open led tasks across crews, with the stage. Capped, with a link.
- `drop`: "You dropped <task>. It's open for anyone again."
- Errors: a `ClaimResult` with status < 500 shows its `error`, with friendlier wording for 409
  ("Someone else signed up for it, or it was closed.") and 403 on drop ("You can only drop tasks you lead.").
  Anything that throws gives "Something went wrong."
- No linked member: "Finish onboarding first" plus the join link, same as /bounty.
- `editOriginal` sends `allowed_mentions: { parse: [] }`. `runTaskCommand` never throws.

### Step 4. Data queries `app/lib/discord-interactions/task-choices.ts` (and list/mine readers)

- `openCrewTasks(crewId?)`:
  - `CrewTask` where `archived: false`, `leadMemberId` null or '', and the crew is in `getCrewMappings()`
    (not archived) and `usesDb('crewTasks', crew)`. Filter out `isClosedStage`.
  - Order by priority rank (reuse `getPriorityRank`, which is exported from crew-mappings if not already),
    then due ascending (nulls last), then crew label and position.
  - `select` only the needed columns.
  - Crews still on the sheet are left out. The list footer mentions their crew page when any are left out.
- `myCrewTasks(memberId)`: `leadMemberId = memberId`, not archived, not closed, DB crews only.
- `taskPickChoices(kind: 'claim'|'drop', memberId, query)`: one capped query (`take: 25`, label `contains`
  insensitive). Choice name `Crew · label`, cut to 100 code points. Value = task id (a STRING, under 100).
  claim lists open, unclaimed tasks; drop lists the member's own.
- Crew autocomplete for `list`: reuse `progressCrewChoices` in route.ts.

### Step 5. Wiring

- `commands.ts`: add `task` with the subcommands:
  - `list` (`crew` STRING, optional, autocomplete, max 80)
  - `claim` (`task` STRING, required, autocomplete, max 100)
  - `mine`
  - `drop` (`task` STRING, required, autocomplete)
- Description: "Crew tasks: list, sign up, see yours, drop one".
- Update `interactions.test.ts` if it counts commands.
- `handle.ts`:
  - `deps.task?: { enabled, rateLimit, defer, choices }`.
  - `case 'task'` mirrors `case 'bounty'`:
    - Checks `enabled` first.
    - Validates the crew with `normalizeCrewId`/`CREW_ID_PATTERN`.
    - Validates `task` with `/^[a-z0-9]{20,40}$/`. Otherwise answer "Pick a task from the list."
    - Then the rate limit, then defer with a type-5 ephemeral reply.
  - Add an autocomplete branch for `list.crew`, `claim.task` and `drop.task`.
- `route.ts`: `taskRateLimit` (`checkKeyedRateLimit("task-command")`), `deferTask` (`after(runTaskCommand(...))`
  with `claim`, which calls `claimCrewTask({ discordId, taskId, crewId: (looked up), action: 'claim', requireOpen: true })`.
  `drop` is the same call with `'giveup'`), `taskChoices`, and `task: { enabled: () => toggleEnabled("discord.taskCommandEnabled"), ... }`.
- `rate-limit.ts`: `"task-command": { limit: 10, windowSec: 60 }`.
- Toggle:
  - `toggles.ts`: `'discord.taskCommandEnabled': { env: 'TASK_COMMAND_ENABLED', legacy: ON_WORDS }`.
  - `registry.ts`: `boolSetting`, area discord, label "/task command", help in the same style as /bounty,
    and `confirmOn` "Members will be able to sign up for crew tasks from Discord."
  - `registry.test.ts`: add `['discord.taskCommandEnabled', false]`.
- `register-commands.mjs`: add `/task` to the header comment. The command list comes from commands.ts.

## Files to change

- New:
  - `app/lib/crews/claim-task.ts`
  - `app/lib/crews/__tests__/claim-task.test.ts`
  - `app/api/claim-task/__tests__/route.test.ts`
  - `app/lib/discord-interactions/task-command.ts`
  - `app/lib/discord-interactions/task-choices.ts`
  - `app/lib/discord-interactions/text.ts`
  - `app/lib/discord-interactions/__tests__/task-command.test.ts`
  - `app/lib/discord-interactions/__tests__/task-choices.test.ts`
- Edit:
  - `app/api/claim-task/route.ts`
  - `app/lib/discord-interactions/{bounty-command,commands,handle}.ts`
  - `app/lib/discord-interactions/__tests__/interactions.test.ts`
  - `app/api/discord/interactions/route.ts`
  - `app/lib/rate-limit.ts`
  - `app/lib/settings/{toggles,registry,registry.test}.ts`
  - `scripts/discord/register-commands.mjs`
  - `TASKS.md` (stage)

## Alternatives considered

- **Discord calls `/api/claim-task` over HTTP.** Rejected: it needs a session cookie, and Vercel deployment
  protection blocks self-fetches.
- **Write `CrewTask` directly from the Discord code.** Rejected: a second copy of the rules would drift from the web.
- **Use `updateCrewTask` from crew-tasks-write.ts.** Rejected: it logs `update`, not `claim`, has no ownership
  rule, and leaves out `TaskClaimEvent` and the activation.
- **Sheet-backed crews in Discord.** Left out: production is all DB, and the sheet path needs a label
  lookup through the Sheets API on every call. Those crews answer "manage on the crew page".
- **Let `claim` match free text.** Left out: labels aren't unique within a crew, so it uses the task id from
  autocomplete.

## Risks

- **Extraction regressions on the web.** Mitigated by the step 1 tests, which are written before the move and
  not edited afterwards.
- **Closed tasks.** The web can still claim a closed task, but Discord refuses it (`requireOpen`). That's
  intended, and the web stays unchanged. Note it in the PR.
- **Label-keyed history.** `TaskClaimEvent` keys on the label. A Discord claim uses the same label-based key, so
  the activity feed matches the web.
- **The crew page cache.** `claimInDb` does not call `invalidateCrewMappingsCache` (same as today). The crew
  "top tasks" preview can show the old lead for up to the cache TTL. Leave it as is (no behavior change);
  mention it as a follow-up.
- **Registration replaces the whole list.** `register-commands.mjs --apply` PUTs the full list. Dry-run first,
  apply only after the deploy is live, and check that /bounty and the others are still there.
- **The 3 s autocomplete window.** Keep it to one `select`-limited query plus the cached crew mappings.
- **Previews.** They read crew tasks from the sheet, so `/task list` on a preview is empty unless
  `SHEETS_SOURCE_CREW_TASKS=db` is set on that preview. Discord only points at production anyway.
- **Private data.** Replies are ephemeral and show only what the public crew pages show. No member names,
  except "you".

## Verify

1. `npx vitest run app/api/claim-task app/lib/crews app/lib/discord-interactions app/lib/settings`. Step 1 tests
   are green at the commit before the extraction and at HEAD, and their file is unchanged in between
   (`git diff <step1>..HEAD -- app/api/claim-task/__tests__` is empty).
2. `npm run lint` and `npx tsc --noEmit` (or `npm run build`).
3. Vercel preview: on a DB crew page (with `SHEETS_SOURCE_CREW_TASKS=db` on the preview), check that Claim and
   Give up behave as before (toast, lead shown, 409 on a task someone else leads).
4. Production after merge, with the toggle still off:
   - Run `register-commands.mjs` as a dry run, then `--apply`.
   - `/task list` answers "/task isn't enabled yet."
   - Turn on `discord.taskCommandEnabled`.
   - list, list with a crew, claim (check the crew page shows you as lead, and that a `CrewTaskEvent claim`
     row exists), mine, drop. A second account claiming the same task gets "Someone else signed up".
   - The replies are ephemeral with no pings, and a long or emoji label is cut cleanly.

## Rollout

Merge with the toggle off, then deploy and re-register the commands. The owner turns the toggle on in
/admin settings, with the env `TASK_COMMAND_ENABLED=off` as a kill switch. If they want public visibility,
turn on `crews.taskUpdatePostsEnabled` too.

## Owner decisions (with recommendations)

1. **Can non-crew members claim?** Recommend **yes**, to match the web (any onboarded member), because
   that is how people join crews. Restricting it would need a web change too.
2. **Does claiming add them to the crew?** Recommend **no** for v1. Crew rosters are curated (crewRoles), and an
   automatic add is hard to undo. Instead, the claim reply links the crew page, where they can join.
3. **A public post in the crew channel on sign-up?** Recommend **no new immediate post**. The existing
   task-update digest (`crews.taskUpdatePostsEnabled`) already reports new leads in batches, without pings.
   Turn that on instead.
4. **A $PEP reward for crew tasks?** Recommend **later, not v1**. Crew tasks have no escrow, no submit/approve step
   and no "done" verification, and stage changes are self-reported. Paying on them would be easy to farm.
   Paid work already exists as bounties. A later "turn this task into a bounty" action for crew leads keeps a
   single payout path.
5. **Closed tasks:** Discord refuses to claim closed tasks. Should the web refuse them too (a small, separate
   behavior change)? Recommend yes, as a follow-up.
6. **The `/task drop` name** (the web says "Give up", /bounty says `giveup`). Recommend `drop` as asked. It's
   shorter, and the replies explain it.
