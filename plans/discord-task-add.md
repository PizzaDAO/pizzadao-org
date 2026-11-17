# discord-task-add: `/task add` for crew leads and admins

## Goal

Add a fifth subcommand to the live Discord `/task` command:

```
/task add crew:<autocomplete> task:<text> [priority:Top|High|Mid|Low] [due:<date>]
```

Only that crew's leads and guild admins can add (the same `canManageCrew` rule as the crew page
tasks editor). The task is written through `createCrewTask` (app/lib/crew-tasks-write.ts), so the
`CrewTaskEvent create` row, the update digest (app/lib/crews/task-update-posts.ts) and the crew
mappings cache invalidation work exactly as for call proposals and the editor. Crews whose tasks
still read from a Google Sheet are refused politely. The reply is deferred and ephemeral, like the
other subcommands. It stays behind the existing `discord.taskCommandEnabled` toggle.

## Findings (what exists)

- `handle.ts` `case 'task'` parses the subcommand with `TASK_SUBCOMMANDS`, checks the toggle, applies
  the rate limit (`deps.task.rateLimit`, keyed `task-command`, 10/min) and defers a `TaskJob`.
  Autocomplete (`handle.ts` around line 724) maps `list.crew` to `'crew'` and `claim|drop.task` to
  the task pickers. In the route, `taskChoices('crew')` reuses `progressCrewChoices`, which lists ALL
  crews (including sheet-backed ones).
- `task-command.ts` `buildTaskReply(job, deps)` is pure apart from the injected `TaskDeps`. Tests in
  `__tests__/task-command.test.ts` cover registration shape, the renderers, the handler and the deps.
- Editor guard (`app/api/crew/[crewId]/content/[kind]/route.ts`): `normalizeCrewId`, then
  `canManageCrew(discordId, crewId)` (403 "Only crew leads can edit this"), then
  `usesDb('crewTasks', crewId)` (409 "This is still edited in the crew's Google Sheet"). Permission
  is checked first, then the source. `/task add` uses the same order and the same two functions.
- The editor itself saves through `saveCrewRows` (crew-content.ts), not `createCrewTask`, but both
  write the same `CrewTaskEvent { action: 'create', actor, data: { label, ... } }`. The digest only
  reads `action` and `data.label`/`changes`, so extra `eventData` keys (`via`) are harmless. The
  call-proposal path already passes `{ via: 'call-proposal', ... }`.
- `createCrewTask` (non-transaction call) already runs `invalidateCrewMappingsCache()`. Crew pages
  are `force-dynamic`, and crew tasks are read from the DB uncached (`fetchCrewTasksFromDb`). The
  profile summary cache (`invalidateProfileSummary`) does not show crew tasks, and a new task has no
  lead. So **no extra invalidation is needed**. Add a comment saying so, and a test asserting
  `createCrewTask` is called without a `tx` (so its built-in invalidation runs).
- `@@unique([crewId, naturalKey])` on CrewTask, and `freshKey` picks the key from the normalized
  label. Two concurrent creates with the same label compute the same key, so the second fails with
  Prisma `P2002`. That gives a race-safe dedupe for free.
- Priority values: the editor help says "Top, High, Mid or Low", and `getPriorityRank` and
  `priorityLabel` in task-command.ts accept exactly these.
- Due is stored as ISO `YYYY-MM-DD` (`CrewTask.due`), with `dueRaw` null for web-created rows. The
  house day zone is `DEFAULT_CALL_TIME_ZONE` (app/lib/calls/zoned-time.ts, America/New_York).
- Autocomplete payloads include `member.roles`, so a non-authoritative "is admin" hint needs no
  Discord API call. With `sheets.source.crewRoles = db`, a member's lead crews take one `crewRole`
  query.

## Approach

### Step 1. Registration (`app/lib/discord-interactions/commands.ts`)

Append to the `task` options (keep list, claim, mine, drop first and in order):

```ts
{ type: SUB_COMMAND, name: 'add', description: 'Crew leads and admins: add a task to a crew', options: [
  { type: STRING, name: 'crew', description: 'Which crew', required: true, autocomplete: true, max_length: 80 },
  { type: STRING, name: 'task', description: 'What needs doing', required: true, min_length: 3, max_length: 300 },
  { type: STRING, name: 'priority', description: 'Priority (default: none)', required: false,
    choices: ['Top', 'High', 'Mid', 'Low'].map((v) => ({ name: v, value: v })) },
  { type: STRING, name: 'due', description: 'Due date, e.g. 2026-12-05 or Dec 5', required: false, max_length: 20 },
] }
```

`max_length: 300` matches the editor's Task column. Required options must come before optional
ones (a Discord rule). Update the command description to "Crew tasks: list, sign up, see yours,
drop or add one (only you see the reply)". It must stay 100 characters or fewer, and the existing
test enforces that. Update the header comment in `scripts/discord/register-commands.mjs` (adds
"/task add").

### Step 2. Pure validation (`app/lib/discord-interactions/task-add.ts`, new)

Keep it small and pure so it is easy to test:

- `cleanTaskText(raw): { ok: true; label } | { ok: false; error }`: collapse whitespace and newlines,
  strip control characters and zero-width characters, and trim. Require 3 to 300 characters,
  counted in code points (use the `cutChars` semantics from text.ts for the count). Require at least
  one letter or digit. The text is stored raw (the renderers already `esc()` it, and posts use
  `allowed_mentions: { parse: [] }`).
- `parsePriority(raw)`: one of Top, High, Mid, Low, or undefined. Anything else (a forged payload)
  is an error.
- `parseDue(raw, now, zone = DEFAULT_CALL_TIME_ZONE): { ok: true; due: string | null } | { ok: false; error }`.
  Accepted forms:
  - `YYYY-MM-DD`.
  - `M/D` or `M/D/YYYY` (US order, the community default).
  - `Mon D` or `Month D`, with an optional year.
  - `today` and `tomorrow`.

  When the year is missing, use this year, or next year if the date has already passed. The date
  must be a real calendar date (no Feb 30). "Today" means today in `zone`. The rules:
  - Past dates are refused: "That date has passed. Pick today or later."
  - Dates more than 2 years ahead are refused, to catch typos.
  - An empty value gives `null`.

  Output is ISO only, the same format the editor validates (`ISO` regex).
- Also `normalizeForDedupe = normalizeLabel` (re-export from sheets-import/plan.ts) so dedupe uses
  the same key as `freshKey`.

### Step 3. Handler (`app/lib/discord-interactions/handle.ts`)

- `TASK_SUBCOMMANDS` gains `'add'`, and the error text becomes "Pick one of: list, claim, mine,
  drop, add."
- For `sub === 'add'`:
  1. Read the `crew` option and normalize it (`normalizeCrewId` + `CREW_ID_PATTERN`, else "Pick a
     crew from the list.").
  2. Run `cleanTaskText` and `parsePriority` synchronously, and reply with an immediate ephemeral
     error on failure (no defer).
  3. Pass the raw `due` string into the job. `parseDue` runs in the handler too, so typos are
     answered at once.
- Rate limit: the existing `deps.task.rateLimit` (10/min, shared by all subcommands), plus a new
  `deps.task.addRateLimit` keyed `task-add` (see Risks). Both are checked before `defer`.
- `TaskJob` gains `label`, `priority`, `due` and `interactionId` (add `id?: string` to the
  `Interaction` type).
- Autocomplete: add a branch `f?.name === 'crew' && sub?.name === 'add'` for the kind `'addCrew'`,
  and pass `i.member?.roles ?? []` through. The `choices` signature becomes
  `(kind, discordId, query, roles?: string[])`.

### Step 4. Deferred work (`task-command.ts`)

Add to `TaskDeps`:

```ts
canManageCrew: (discordId: string, crewId: string) => Promise<boolean>
crewSource: (crewId: string) => Promise<'db' | 'sheet' | 'unknown'>  // unknown = not a real crew
findOpenDuplicate: (crewId: string, label: string) => Promise<TaskRow | null>
create: (crewId: string, input: { label: string; priority: string | null; due: string | null }, actor: string, eventData: Record<string, unknown>) => Promise<string>
```

`buildTaskReply` `case 'add'` runs these steps in order:

1. `isMember` (the existing check).
2. `crewSource === 'unknown'` gives "Pick a crew from the list."
3. `canManageCrew` false gives "Only this crew's leads and admins can add tasks." with "Suggest it
   in the crew's channel, or open the crew page" and a link.
4. `crewSource === 'sheet'` gives "This crew's tasks are still kept in its Google Sheet. Add it
   there for now." with the crew page link. This mirrors the editor's 409 wording.
5. `findOpenDuplicate` (same crew, not archived, not closed, `normalizeLabel` equal) gives
   "That's already on the list:" plus the `taskLine`. Nothing is written.
6. `create(crewId, ..., actor = discordId, { via: 'discord', interactionId })`. If it throws Prisma
   `P2002`, re-run `findOpenDuplicate` and reply as a duplicate (the double-submit race). Other
   errors throw, which gives the generic "Something went wrong".
7. `renderAdded` gives "Added to <Crew>: <label> · High · due Dec 5", with "Anyone can sign up with
   `/task claim`." and a link to the crew page.

Permission (step 3) comes before the source check (step 4), matching the editor. That way
non-leads never learn a crew's storage details, and the refusal always reads the same.

### Step 5. Route wiring (`app/api/discord/interactions/route.ts`)

In `deferTask`:

- `canManageCrew`: from `app/lib/crew-leads.ts` (unchanged; it already includes `isAdminDiscordId`
  and fails closed).
- `crewSource`: `getCrewMappings` + `realCrews`, then `usesDb('crewTasks', id)`.
- `findOpenDuplicate`: a new helper in `task-choices.ts` using the `notClosed` filter that is already
  there. It queries `{ crewId, archived: false, ...notClosed }` with `select: SELECT`, then compares
  `normalizeLabel` in JS.
- `create`: `createCrewTask(crewId, { label, priority, due }, actor, eventData)` with no `db`
  argument, so it invalidates the crew mappings cache itself.

Add `addRateLimit` (`checkKeyedRateLimit('task-add', discordId)`). In `app/lib/rate-limit.ts`, add
`"task-add": { limit: 5, windowSec: 10 * 60 }` next to `task-command`, with a comment. Named limits
live in that table today. Moving it to DB settings would be a new pattern, so it is left as an open
decision below.

In `taskChoices`, `'addCrew'` calls a new `addCrewChoices(discordId, query, roles)` in
`task-choices.ts`:

- Only real crews with `usesDb('crewTasks')`. Sheet crews are left out of `add`'s list, though the
  deferred step still refuses them politely if a stale value is submitted.
- If the roles include any `ADMIN_ROLE_IDS`, every DB crew is manageable.
- Otherwise, call `leadCrewIds(memberId)`, a new function in `crew-leads.ts`:
  - With `crewRolesFromDb()`: one query, `prisma.crewRole.findMany({ where: { memberId, archived:
    false } })`, filtered with `isLeadStatus`.
  - Otherwise: return an empty set (no preference; the per-crew sheet roster reads are too slow for
    the 3 s window).
  - Any error gives an empty set.
- Order: manageable crews first (alphabetical), then the rest. Cap at 25 and filter by label or id
  `includes(query)`, as `progressCrewChoices` does.
- This is only a hint. Authorization is always `canManageCrew` in the deferred step.

### Step 6. Toggle and settings

No new toggle. `/task add` is gated by `discord.taskCommandEnabled`, which is already on in
production. This means `add` goes live the moment the commands are re-registered. That is
acceptable because only leads and admins can write, and every write is audited. If the owner wants
a separate switch, add `discord.taskAddEnabled` in `settings/registry.ts` and `toggles.ts`
(default off, env `TASK_ADD_ENABLED`). The handler would then answer "/task add isn't enabled yet."
This is an open decision.

## Files to change

- `app/lib/discord-interactions/commands.ts`: the `add` subcommand and the description.
- `app/lib/discord-interactions/task-add.ts` (new): `cleanTaskText`, `parsePriority`, `parseDue`.
- `app/lib/discord-interactions/task-command.ts`: `TASK_SUBCOMMANDS`, `TaskJob` fields, `TaskDeps`
  additions, `case 'add'`, `renderAdded`, duplicate and refusal wording.
- `app/lib/discord-interactions/handle.ts`: parsing and validation, `addRateLimit`, autocomplete
  branch, `Interaction.id`, `choices` signature (roles).
- `app/lib/discord-interactions/task-choices.ts`: `findOpenDuplicate`, `addCrewChoices`.
- `app/lib/crew-leads.ts`: `leadCrewIds(memberId)` (fails closed to an empty set).
- `app/lib/rate-limit.ts`: `task-add` named limit.
- `app/api/discord/interactions/route.ts`: deps wiring, header comment.
- `scripts/discord/register-commands.mjs`: header comment only.
- Tests (below).

## Alternatives considered

- **Use the editor's `saveCrewRows` path.** No: it diffs a whole crew list and archives missing
  rows, which is wrong for a single append. `createCrewTask` is the shared single-row writer, and the
  audit event shape is the same.
- **A modal (text input) instead of slash options.** It allows longer text and a notes field, but
  adds a component round-trip and a new modal handler. Slash options are enough for a 300-character
  label. This could come later if notes or links are wanted.
- **Dedupe by interaction id only.** Discord does not resend an interaction, so double-submits are
  two different interactions. The label dedupe plus the `P2002` catch covers the real case. The
  interaction id is still kept in `eventData` for the audit trail.
- **Autocomplete showing only manageable crews.** It is cleaner, but lead lookup is impossible
  within 3 s while rosters are sheet-backed. Sorting manageable crews first degrades gracefully.

## Risks

- **Re-registering replaces the whole guild command list** (PUT). Before `--apply`, run the
  dry run, then GET the live list (`GET /applications/{app}/guilds/{guild}/commands` with the bot
  token) and diff the names and options against the dry-run JSON. The only difference should be
  `task.options` gaining `add` and the new description. If anything else differs (a command added
  by hand, or `/bounty` reappearing), stop.
- **The toggle is already on**, so `add` is live once registered. Every write is permission-checked
  and audited. See open decision 1.
- **Spam or mistakes by a lead.** Mitigated by the 5 per 10 min `task-add` limit, dedupe, and the
  editor, where a lead can remove a task (archive, never delete). The digest batches posts (no
  pings).
- **Admin check latency.** `isAdminDiscordId` calls the Discord guild member API (60 s fetch cache).
  It runs in `after()`, so it is outside the 3 s window.
- **Date ambiguity** (`5/12`). Document "US order (month/day); YYYY-MM-DD always works" in the
  option description, and echo the parsed date in the reply ("due Dec 5") so mistakes are visible.
- **Sheet-backed crews.** They are refused in the deferred step, and the source is re-checked at
  submit (the autocomplete list can be stale).

## Tests (vitest, injected deps; extend `__tests__/task-command.test.ts`, new `__tests__/task-add.test.ts`)

- Registration: options are `['list','claim','mine','drop','add']`; `add` has required `crew` and
  `task` first, the priority choices are exactly Top/High/Mid/Low, and the Discord limits walk
  passes.
- `cleanTaskText`: whitespace and newline collapse, control and zero-width characters stripped, under
  3 or over 300 code points refused (emoji counted once), punctuation-only refused.
- `parseDue` with a fixed `now` and zone:
  - all accepted forms; year rollover (Dec typing "Jan 3" gives next year);
  - today accepted, yesterday refused, Feb 30 refused, more than 2 years ahead refused;
  - midnight edge in America/New_York vs UTC;
  - garbage refused.
- Handler (`handleInteraction`):
  - bad crew, bad text and bad date are answered at once (no defer);
  - the `task-command` and `task-add` limits each block;
  - toggle off gives "isn't enabled";
  - a valid add defers with an EPHEMERAL type 5 and a job carrying label, priority, due and
    interactionId;
  - autocomplete `add.crew` calls `choices('addCrew', …, roles)`.
- `buildTaskReply` `add`:
  - not a member;
  - unknown crew;
  - not a lead, with `create` never called;
  - a lead of a sheet crew gets the sheet refusal, with `create` never called;
  - a lead of a DB crew creates with `actor = discordId` and `eventData.via === 'discord'`;
  - an admin (canManageCrew true, not a lead) creates;
  - an open duplicate gives "already on the list", with `create` never called;
  - `create` throwing `P2002` gives the duplicate reply; other errors give the generic error via
    `runTaskCommand`.
- `addCrewChoices` / `leadCrewIds` (mock prisma as in `task-choices.test.ts`):
  - sheet crews excluded;
  - admin roles mean all crews are treated as manageable;
  - lead crews sort first;
  - a crewRoles DB error gives no preference (not a crash);
  - the sheet roster source gives no preference.
- `createCrewTask` wiring: called without the `db` argument, so its built-in cache invalidation runs.

## Verify

1. `npx vitest run app/lib/discord-interactions app/lib/crew-tasks-write app/lib/crews app/lib/settings`.
2. `npm run lint` and `npx tsc --noEmit`.
3. Vercel preview (`/ship`): the build is Ready. Discord interactions go only to production's
   endpoint, so the preview is a build and regression check. Check that the crew page editor still
   saves.
4. After merging and deploying to production:
   - Run `node scripts/discord/register-commands.mjs` (dry run), GET the live commands, and diff
     them. Only then run `--apply`.
   - As a crew lead on a DB crew: `/task add` with every option. The reply is ephemeral, the task
     shows at the end of the crew page list, a `CrewTaskEvent` create row exists with
     `via: 'discord'`, and `/task list crew:<that crew>` shows it.
   - Repeat the same add: "already on the list".
   - As a non-lead: refused, nothing written.
   - Pick a sheet crew (by typing its id): polite refusal.
   - A past date and `Feb 30`: refused at once.
   - If `crews.taskUpdatePostsEnabled` is on, the next digest lists the new task like an editor
     create.

## Rollout

Merge, deploy, then dry-run, compare and apply the command registration. No migration and no new
setting (unless decision 1 says otherwise). Kill switch: `TASK_COMMAND_ENABLED=off` (turns off all
of `/task`).

## Open decisions (with recommendations)

1. **Separate toggle for `add`?** Recommend **no**: the existing toggle covers it and writes are
   lead/admin-only. Add `discord.taskAddEnabled` (default off) if the owner wants to stage it
   independently of list/claim.
2. **`task-add` limit in code (5 per 10 min) or a DB setting?** Recommend **code** for now, to match
   every other named limit in rate-limit.ts. A DB-settings-backed limit would be a separate
   cross-cutting change.
3. **Autocomplete: show non-manageable crews after manageable ones, or hide them?** Recommend
   **show them after** (the lead hint is best-effort while rosters can be sheet-backed). Hide them
   once `crewRoles` is DB everywhere.
4. **Optional fields beyond priority and due** (link, goal, lead = me)? Recommend **not in v1**.
   A `lead:me` boolean would be a cheap follow-up (it would also need `invalidateProfileSummary` if
   the profile ever shows led tasks).

## Future follow-up (not in this task)

- **Member suggestions:** non-leads run `/task suggest crew task`, which creates a
  `CrewTaskProposal` (kind CREATE, `via: 'discord-suggest'`) in the existing call-proposal queue.
  Leads approve it there, and the existing `apply.ts` transaction creates the task. This reuses the
  proposal review UI and audit, and needs no new table. It would replace the "suggest it in the
  crew's channel" wording in the refusal.
