# agenda-action-status: the pre-call agenda opens with last call's action items and their status

## Goal

The pre-call agenda that Metalhead posts in a crew's channel (and its Telegram mirror and the admin
preview) opens with a "Since last call" block: the action items from that crew's last published call,
each with its status (✅ done, 🔄 in progress, a plain dash for not started) and the link to the
finished work when there is one. Then the call can start by going through them. The block is behind
a DB setting, off by default. While it is off the agenda is byte-for-byte what it is today.

## Dependency check: recap-action-status has shipped

- Merged as #386 (`a0284aeb`, "Recaps: live action-item status, finished-work links, in-place
  edits (off by default)"), with migration `20261221090000_recap_action_status` on origin/main.
- What it provides, and what this task builds on (no duplication):
  - `app/lib/calls/action-keys.ts`: a stable `key` on every stored action item.
  - `FollowUp.actionKey`: links a follow-up to an item. `FollowUp.doneUrl`: the finished-work link a
    member adds.
  - `app/lib/calls/action-status.ts`:
    - `deriveActionViews(items, followUps, { memberLinks, filter })` (pure). Returns one
      `ActionView { key?, state: 'done' | 'in_progress' | null, links[] }` per stored item, in the
      same order.
    - `loadActionViews(rec, filter)`: one query, fails soft.
    - Precedence: the reviewer's `done` always wins. Then any linked IN_PROGRESS / NEEDS_HELP gives
      in progress (needs-help is never shown publicly). Then any linked DONE gives done. Otherwise
      nothing.
    - Links: the reviewer's evidence first, then members' `doneUrl`, post-filtered, at most 3. They
      appear only on done items.
  - `app/lib/calls/recap.ts`: `recapLiveStatusEnabled()` and `recapActionViews()` (undefined while
    live status is off). The status fitter (`fitStatusRecap`) masks links as `[label](<url>)`.
  - Settings: `calls.recapLiveStatusEnabled` (off by default, env kill switch
    `CALL_RECAP_LIVE_STATUS_ENABLED`) and `calls.recapMemberLinksEnabled` (on).
- Prod state, checked with a read-only query on 2026-11-17:
  - No `AppSetting` rows exist for `calls.recapLiveStatusEnabled`, `calls.agendaPostEnabled`,
    `calls.progressShowFollowups` or `calls.agendaMax*`, so defaults and env vars apply. Live status
    is therefore effectively off unless the env var turns it on.
  - 7 of 52 follow-ups have an `actionKey`.
  - So today most items get their status from the reviewers' marks only. That decides how this
    feature behaves while live status is off (see decision 1).

## What exists today (origin/main @ 12bd1d08)

- **Agenda job**: `app/lib/call-agenda/run.ts`. Cron `/api/cron/call-agenda` runs every 10 minutes.
  `planAgendas()` builds one plan per upcoming Discord scheduled event in the call voice channel.
  `processPlan()` claims a `CallAgendaPost` row first, then posts once (never edited) with
  `allowed_mentions: { parse: [] }` and embeds suppressed. It then calls
  `enqueueMirror({ kind: 'agenda' })`, which feeds Telegram through `toPlainPost`; that function
  already turns `[label](<url>)` into `(label)`.
- **Last call**: `previousCallWithActionItems(crewId)` reads the latest 3 PUBLISHED recordings
  (imported ones only when `calls.importedAgendaContext` allows) and returns the first one whose
  `parseActionItems` is non-empty. **`parseActionItems` drops done items**, so a call where every
  item is done is skipped and an older call is used. The keys and the stored order are lost too. It
  is also used by `/progress` (`progress-command.ts`).
- **Ranking and format**: `app/lib/call-agenda/rank.ts`.
  - `buildAgendaBullets` adds up to `calls.agendaMaxFollowups` (default 2) not-done items as
    "From last call: text (owner)" after the urgent tasks.
  - `formatAgendaMessage` writes the heading, then `- bullet` lines, then the crew link. There is no
    length check (7 short bullets have always fit).
  - When there are no bullets nothing is posted (`no-items`).
- **Privacy rules for agendas**:
  - Crew exclusion and blocked terms come from `loadPostFilter`. An unreadable filter throws, so
    there is no agenda.
  - The spoken updates script (`app/lib/call-updates/sources.ts` `lastCallForUpdates`) also skips a
    last call whose redactions are newer than its summary (`redactionsNewerThanSummary`) and leaves
    out owners who are redacted speakers. The text agenda does not do this today.
- **Admin preview**: `app/admin/calls/AgendaPreview.tsx` renders `planAgendas({ horizonMs: 48h })`
  read-only, and shows `p.message`.
- **Other surfaces that show last-call items**:
  - `/progress` (`progress-report.ts`) uses fuzzy owner and text matching to follow-ups
    (`matchFollowUp`), not `actionKey`.
  - The spoken updates script has a "last-call" section.
  - The crew page's "Meeting Agenda" is the crew's static agenda steps (`CrewAgendaStep`), not
    generated.
  - None of these is in scope (see "Not in this task").
- **Crew task link**: `CrewTaskProposal.actionItemIdx` points a CREATE proposal at an action item
  by index. But an applied CREATE does not store the new task id on the proposal; only the task
  event carries `proposalId`. So there is no reliable item-to-task link to read a task stage from yet.

## Design

### Where it appears

1. The Discord pre-call agenda post. This is the main surface.
2. Its Telegram city mirror. This comes for free through the same text: masked links become
   `(label)` and the `<t:...>` timestamps are already handled for agendas.
3. The admin agenda preview on `/admin/calls`. It shows the same message, plus a one-line note
   when the block was left out and why ("last call's recap has newer redactions", "no published
   call within N days", "all items filtered").

Message shape (status marker in place of the bullet, like the recap):

```
**<Crew> call agenda** (starts <t:..:R>)
**Since last call** (<t:<lastStart>:d>)
✅ Draft the onboarding guide (owner: A): [PR #12](<https://...>)
🔄 Book the venue (owner: B)
- Write the newsletter (owner: C)
+2 more: <call page url>
**Up next**
- Overdue 3d: ...
- High priority: ...
Crew page: <url>
```

- The "**Up next**" sub-heading is added only when both parts are present. With the block off, or
  when the block is empty, the message is exactly today's.
- While the block is shown, the old "From last call: ..." bullets are turned off (`followups: 0`)
  so no item is listed twice. The `calls.agendaMaxFollowups` setting stays and is used when the
  block is off.

### Which "last call" per crew

- Use the crew's latest PUBLISHED recording with at least one action item, **counting done items**,
  among the latest 3 (same window as today). Imported calls follow `calls.importedAgendaContext`
  as today.
- Its `startedAt` must be before the event's start and within `calls.agendaReviewMaxDays` (default
  35). An older call leaves the block out, so a crew back from a long break does not review stale
  work.
- A newer recording that is still in review (not published) is never used: its items are not
  reviewed. The header date makes it clear which call is being reviewed.
- New loader `lastCallForReview(crewId, { now })` in a new `app/lib/call-agenda/review.ts`. It
  selects `id, startedAt, actionItems, redactionsUpdatedAt, summaryGeneratedAt, summaryEditedAt,
  redactedSpeakerIds`. It reuses the redacted-name lookup pattern of `lastCallForUpdates`; factor it
  into a small shared helper `redactedSpeakerNames(recordingId, ids)` in `app/lib/calls/` and use it
  from both.
- `previousCallWithActionItems` and `parseActionItems` stay unchanged, so `/progress` and the old
  bullets behave the same.

### How the status is derived

- Status comes only from the shipped `action-status.ts`. No new rules.
  - When `calls.recapLiveStatusEnabled` is **on**: `loadActionViews(rec, filter)`. This includes
    follow-up states and members' links, and still respects `calls.recapMemberLinksEnabled` and the
    post filter.
  - When it is **off**: `deriveActionViews(rec.actionItems, [], { memberLinks: false, filter })`.
    That is the reviewers' marks only: ✅ plus their evidence links, no 🔄. So the agenda never shows
    a state the public recap does not.
  - Recommended default; see decision 1.
- Per item, the line is built from the stored item (`text`, `owner`) with the view at the same
  index:
  - Marker: `✅` for done, `🔄` for in progress, `-` for not started.
  - Text and owner go through `clipTo(..., calls.agendaItemChars)`, which escapes markdown. The
    owner is clipped to 40 characters.
  - Plain names only, no mentions: the agenda posts with `parse: []`.
  - `suggestedBy` is left out (too long for an agenda).
  - Done items show the first link (URL of 200 characters or less) as a masked link. Factor the
    masking out of `recap.ts` into `maskedLink(l)` in `app/lib/calls/evidence.ts` and use it in both
    places. The recap output must stay identical; its existing tests guard this.
- Privacy, the same as the spoken updates script:
  - An excluded crew gets nothing (unchanged).
  - An item whose text or owner contains a blocked term is dropped and counted in `filteredOut`.
  - Last call's redactions newer than its summary: the whole block is left out (fail closed).
  - An owner who is a redacted speaker: the item is shown without an owner.
- Task stage is not used in this task: there is no reliable item-to-task link yet. See decision 5.

### Ordering

- Default: the stored order, the same order as the recap and the call page, so people recognise
  the list.
- Setting `calls.agendaReviewOpenFirst` (bool, default off): not-started first, then in progress,
  then done, with the stored order kept within each group. This is for crews that want the call
  time spent on open work.
- Truncation always cuts from the end of the resulting order.

### Size and fitting (one Discord message of 2000 characters or less)

- A new pure `formatAgendaMessage` path is used only when `review` is given. The old path is
  untouched.
- Up to `calls.agendaReviewMaxItems` (default 8) items are shown. The rest become
  `+N more: <call page url>` (`recapUrl(recordingId)`).
- When the message is over 2000 characters, it gives up in this order:
  1. links, from the last item upward (the marker stays);
  2. review items from the end (the "+N more" line grows);
  3. task bullets from the end.
- The heading and the crew link always stay.
- Worst case at the defaults: 8 × ~170 + 7 × ~130 + ~150 ≈ 2400, so the fitter is needed. Test it
  with maximum-length fixtures.

### Empty states

| Case | Result |
|---|---|
| Block off | Today's agenda, byte for byte |
| No published call with items within the max days | No block; preview note "no recent call" |
| Last call's items all filtered | No block; counted in `filteredOut` |
| Redactions newer than the summary | No block; preview note |
| All items done | Block shown; all ✅ (a good way to open the call) |
| No urgent tasks but a block | **Post now goes out** (today it would be `no-items`). `processPlan` checks `bullets.length === 0 && !review` |
| Neither | `no-items`, as today |
| Action-status query fails | `loadActionViews` already fails soft to reviewer marks |

If the call loader throws, log it and leave the block out. The agenda still posts.

### Settings (DB, admin UI; no hard-coded tunables)

| Key | Kind | Default | Where |
|---|---|---|---|
| `calls.agendaReviewEnabled` | bool, env kill switch `CALL_AGENDA_REVIEW_ENABLED` (`ON_WORDS`) | **off** | `registry.ts` boolSetting with `confirmOn`, `toggles.ts` |
| `calls.agendaReviewMaxItems` | num 1-15 | 8 | `content-settings.ts`, next to the other `calls.agenda*` settings |
| `calls.agendaReviewMaxDays` | num 1-120 | 35 (days) | `content-settings.ts` |
| `calls.agendaReviewOpenFirst` | bool | off | `registry.ts` (no env) |

- Help text for the master setting: "Open each pre-call agenda with last call's action items and
  their status (done, in progress), with the finished-work link on done items. In-progress status
  from members' follow-ups needs 'Live status in call recaps' on."
- The admin preview works whether or not posting is on. It shows the block whenever
  `calls.agendaReviewEnabled` is on, so the setting can be checked before `calls.agendaPostEnabled`
  is turned on.

### Caching

- No new cross-request cache. The status must be current at post time, and the cost is small:
  - one `callRecording.findMany` (take 3, indexed by crew);
  - one `followUp.findMany` by `recordingId` (indexed `[recordingId, actionKey]`), only when live
    status is on;
  - one `callSpeaker` lookup, only when there are redacted ids.
- This runs per upcoming event inside the lead window (usually 0-2 per run, every 10 minutes), plus
  the admin preview's 48-hour window.
- Per run, keep a `Map<crewId, Promise<Review>>` inside `planAgendas`, so a crew with two events in
  the window is loaded once.
- `loadSettings()` is already read once per run. Pass the snapshot down (`resolveToggle` /
  `settingInt`) instead of calling `toggleEnabled` per crew.
- Skip loading the review for plans that are `alreadyPosted`, but only in the cron path (a
  `forPost` flag). The preview still loads it.
- The posted agenda is a snapshot taken 20-30 minutes before the call and is never edited (see
  decision 3).

## Files to change

New:
- `app/lib/call-agenda/review.ts`:
  - `lastCallForReview(crewId, { now, maxDays })`;
  - `buildReviewItems(items, views, { filter, redactedNames, chars, openFirst })` (pure; returns
    `{ marker, line, link? }[]` and the filtered count);
  - `loadAgendaReview(crewId, { now, filter, settings })`, which returns
    `{ recordingId, startedAt, items, more, skipped?: 'stale-redactions' | 'none' | 'filtered' } | null`.
- `app/lib/call-agenda/review.test.ts`.

Changed:
- `app/lib/call-agenda/rank.ts`:
  - `formatAgendaMessage` gets an optional `review` and the fitter. The old path is unchanged when
    there is no review.
  - The `agendaReviewLimits(settings)` helper.
- `app/lib/call-agenda/run.ts`:
  - `PlannedAgenda.review?` and `reviewNote?`.
  - `planAgendas` loads the review when enabled (memoised per crew) and sets `followups: 0` when the
    review has items.
  - `filteredOut` includes review drops.
  - In `processPlan`, the `no-items` check accounts for the review.
- `app/lib/calls/evidence.ts`: `maskedLink`. `app/lib/calls/recap.ts`: use it (no output change).
- `app/lib/calls/` shared `redactedSpeakerNames` helper, used by `call-updates/sources.ts` and
  `review.ts`.
- `app/admin/calls/AgendaPreview.tsx`: the review note line.
- `app/lib/settings/registry.ts`, `toggles.ts`, `content-settings.ts`, and the default tables in
  `registry.test.ts`, `toggles.test.ts`, `content-settings.test.ts`.
- `messages/en.json`, `es.json`, `fr.json`: `adminCalls.agendaReviewStale`, `agendaReviewNone`,
  `agendaReviewFiltered`.
- No migration. No schema change.

## Implementation steps

1. Settings: add the four keys, the toggle entry and the registry and default tests.
2. `maskedLink` refactor in `evidence.ts` and `recap.ts`. Run the recap tests and confirm they still
   pass unchanged.
3. `redactedSpeakerNames` helper. Switch `lastCallForUpdates` to it and run the call-updates tests.
4. `review.ts`: the loader and the pure builder, with tests.
5. `rank.ts`: the review-aware formatter and fitter, with tests, including the byte-identical
   snapshot when there is no review.
6. `run.ts`: wiring, memo, the followups suppression and the `no-items` change, with tests in
   `call-agenda.test.ts`.
7. Admin preview note and i18n strings.
8. `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## Tests

- `review.test.ts`:
  - picks the latest published call even when all its items are done;
  - skips a call older than the max days;
  - ignores imported calls unless allowed;
  - stale redactions leave the block out;
  - a redacted owner is dropped from the line;
  - blocked-term items are dropped and counted;
  - stored order versus `openFirst` ordering;
  - live status off means reviewer marks only (no 🔄), with follow-ups ignored;
  - live status on means 🔄 from IN_PROGRESS and NEEDS_HELP, ✅ plus a member link from DONE, and
    member links hidden when `recapMemberLinksEnabled` is off;
  - markdown in item text is escaped;
  - a loader error gives `null`.
- `call-agenda.test.ts`:
  - block off gives exactly today's message (snapshot);
  - block on shows the block before the tasks, with no "From last call" bullets;
  - a review with no urgent tasks still posts;
  - the fitter keeps the message at 2000 characters or less with maximum fixtures, in the drop order
    links, then items, then tasks;
  - the "+N more" line carries the call page URL;
  - two events for one crew read the DB once;
  - the Telegram mirror text from `toPlainPost` shows `(label)` instead of masked links.
- `recap.test.ts` and `phase2.test.ts` unchanged and green (the `maskedLink` refactor).
- Settings: the default tables and the env kill switch for `calls.agendaReviewEnabled`.

## Verification on the Vercel preview

- Deploy with `vercel-deploy` (preview). On `/admin/calls`, the "Next call agendas" preview with
  `calls.agendaReviewEnabled` off must look exactly like production.
- Previews share the production database, and `toggles.ts` ignores saved rows on any deploy that
  is not production (only the env var counts). So do NOT save the setting from the preview: that
  would write the production row. Instead, set `CALL_AGENDA_REVIEW_ENABLED=on` (and optionally
  `CALL_RECAP_LIVE_STATUS_ENABLED=on`) as **Preview-scoped** env vars and redeploy. The numeric
  settings use their defaults or the saved production values.
- Check a crew with a recent published call:
  - the block lists the items in recap order with ✅ and links on reviewer-marked done items;
  - with live status on, 🔄 appears for linked follow-ups that are in progress;
  - the message stays under 2000 characters.
- Check a crew whose last call is older than the max days: there is no block, and the preview note
  explains why.
- Nothing is posted from the preview. Do not turn on `calls.agendaPostEnabled` on the preview
  against the production guild.

## Rollout

1. Merge dark (the setting is off). Nothing changes in production.
2. Snax turns on `calls.agendaReviewEnabled` in production and checks the admin preview for the
   next 48 hours of calls.
3. The agenda posts go out with the block on the next scheduled calls (if `calls.agendaPostEnabled`
   is on). Optionally, turn on `calls.recapLiveStatusEnabled` for 🔄 states once follow-up linking
   is in use.
4. Roll back by turning the setting off, or with the env kill switch `CALL_AGENDA_REVIEW_ENABLED=off`.

## Risks

- **The agenda now posts for crews that had nothing urgent.** This is intended, but it is a
  behaviour change when the block is turned on. It is called out in the setting's `confirmOn` text.
- **Statuses look weak while live status is off.** Only reviewer-marked ✅ shows, and most items
  show "-". That is accurate but may read as "nothing was done". Mitigation: decision 1, and the
  reviewers marking done items.
- **Stale snapshot.** Work finished in the last 30 minutes before the call is not reflected.
- **Length.** The fitter is new code on a path that never had a length check. It needs thorough
  tests.
- **Privacy.** The redaction checks are new for text agendas. They fail closed (the block is
  dropped), never open.
- **Shared code.** The `maskedLink` and `redactedSpeakerNames` refactors touch the recap and the
  spoken script. Both are covered by existing tests.

## Not in this task (possible follow-ups)

- Switching `/progress` from fuzzy `matchFollowUp` to `loadActionViews`, so it shows the same
  statuses as the agenda.
- Adding status to the spoken updates script's last-call section.
- A "Since last call" panel on the crew page or the live call page.
- Editing the posted agenda in place up to the call start (as `recap-refresh` does for recaps).
- Task-stage status through applied CREATE proposals.

## Open decisions for the owner

1. **Follow-up states when recap live status is off.** Recommended: follow
   `calls.recapLiveStatusEnabled`. While it is off, show the reviewers' ✅ only, so the agenda and
   the public recap never disagree. Alternative: always use follow-up states in the agenda.
2. **Ordering.** Recommended: recap order by default, with `calls.agendaReviewOpenFirst` available.
3. **Edit the agenda as statuses change before the call.** Recommended: no for now. It is a snapshot,
   and the recap is the live record.
4. **Post when only the review block has content.** Recommended: yes. That is the point of
   "calls open by reviewing them".
5. **Task stage as a status source.** Recommended: not now. First record the created task id on an
   applied CREATE proposal (a separate small task), then add it as a lower-precedence source in
   `deriveActionViews`.
6. **Max age and item cap.** Recommended: 35 days and 8 items, both editable in Settings.
