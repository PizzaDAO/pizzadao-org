# post-call-agenda-updates: action-item confirmations and proposed crew task updates after a call

> **Decision (2026-11-03):** action items are confirmed DURING the call. Built first: Option A
> (near-live chunked transcription, app-side) plus Option C (typed `action: ...` lines), both behind
> off-by-default settings and a crew allowlist. Option B and Ask 2 (proposed task updates) are later.

Two asks from a crew call:

1. When an action item is said on a call, Metalhead confirms it in text ("Action item recorded: ...")
   and says what it proposes to do about it.
2. After a call, Metalhead applies what was said about agenda items to the crew's tasks (mark done,
   change stage / priority / lead / due, add new tasks, retire items), as **proposed changes** that a
   crew lead or admin approves in one click. Never silent edits.

Both ship dark: every switch defaults to off, and nothing changes on deploy.

Investigated against `origin/main` at the end of the sheets cutover (#237-#244). The local `main` is
behind; branch implementation work from `origin/main` (or from the recorder phase-0 config branch
if Phase 3 below is picked up, see "Dependencies").

---

## What exists today

- **Recorder** (`recorder/`, Railway, the Metalhead bot user). Records one Ogg/Opus track per
  speaker plus the voice channel's text chat (`onMessage`, bots and system messages skipped, so
  Metalhead's own posts never enter the transcript). It posts the recording notice into the voice
  channel's text chat. At the end of the call it uploads to R2 and calls
  `POST /api/calls/recorder/ingest`. It has no OpenAI key and reads no DB settings (the phase-0
  config route on the `metalhead/phase-0-config` branch adds a read-only settings fetch).
- **All crews share one voice channel.** Back-to-back calls follow each other in the same channel,
  so a message posted "after the call" into the voice channel's chat can land in the middle of the
  next crew's call.
- **Transcription is app-side, after the call** (`app/lib/calls/transcribe.ts`, `whisper-1`, speech
  regions only, per speaker). The ingest route runs the summary in `after()`, then
  `draftFollowUpsForRecording`. Crons: `call-transcripts` every 15 min, `followups` every 10 min.
  Realistic delay from the last person leaving to a summary: empty grace (5 min) + finalize/upload +
  transcription + summary, so roughly 10-25 minutes.
- **Summary** (`app/lib/calls/summarize.ts`): `summarySchema` with `actionItems: [{text, owner}]`,
  stored on `CallRecording.actionItems`. Machine text until a reviewer publishes it.
- **Review gate:** only the call reviewer role (`app/lib/calls/access.ts`) publishes a call; the
  Discord recap (`app/lib/calls/recap.ts`) posts only for PUBLISHED calls, applies the private post
  filter (`app/lib/calls/post-filters.ts`: excluded crews, blocked terms, values in DB rows only),
  and refuses when redactions are newer than the summary. Full transcripts are limited by
  `canViewCallTranscript` (member level setting or the reviewer role).
- **Follow-ups** (`app/lib/followups/*`): a separate extraction pass
  (`extract.ts`: speakers anonymised as S1..Sn, redaction-filtered segments, `sourceKey`
  idempotency), owner resolution (`resolve.ts`), DRAFT rows needing an approval click, events in
  `FollowUpEvent`, bookkeeping columns on `CallRecording` (`followupsDraftedAt/Attempts/Error`).
  This is the pattern to copy.
- **Crew tasks in the DB** (`CrewTask`, `CrewTaskEvent`, `CrewAgendaStep`, `CrewGoal`), read through
  `app/lib/crew-content.ts`, edited by leads at `app/api/crew/[crewId]/content/[kind]/route.ts`
  (guard: `canManageCrew`, `usesDb('crewTasks', crewId)`, `rejectUnsafeWrite`). The save logic,
  including `doneAt` handling, `freshKey` natural keys and `CrewTaskEvent` writes, lives inside
  `crewTasksEditor().save` / `saveCrewRows` in `app/lib/sheets-import/crew-content.ts`. Crews still
  on the sheet path (`sheets.source.crewTasks` not covering them) cannot be edited in the app.
- **Pre-call agenda** (`app/lib/call-agenda/run.ts`, `rank.ts`): 30 min before a call, ranks the
  crew's open tasks plus the previous published call's action items into 3-7 bullets and posts to
  the crew's channel. `CallAgendaPost` keeps `eventId, startsAt, crewId, channelId, messageId`
  but **not** which tasks were on the agenda.
- **Settings** (`app/lib/settings/registry.ts`, `toggles.ts`): int/bool/text settings with audit
  (`AppSettingChange`); posting toggles have an env kill switch and saved rows are ignored on
  previews (previews share the prod DB).

---

## Ask 1: action-item confirmation. Options

The recorder records audio only; there is no transcript until after the call. A confirmation
"when it is said" therefore needs either live transcription or a different trigger.

### Option A: near-live chunked transcription during the call

Every 2-3 minutes the recorder cuts each speaker's new speech since the last cut, sends it to be
transcribed, and a small model scans a rolling window (last ~10 minutes plus already-recorded items)
for new action items. Metalhead posts "Action item recorded: ... (proposed: new task, lead X)" in
the voice channel's text chat 1-4 minutes after it was said.

- Where it runs: the recorder has no OpenAI key (by design). Either (a) Deepgram streaming from the
  recorder (an optional `DEEPGRAM_API_KEY` exists but is not the production path), or (b) the
  recorder uploads chunk audio to R2 and calls a new app route
  `POST /api/calls/recorder/live-chunk` (Bearer `RECORDER_API_KEY`), which transcribes with the same
  speech pipeline and runs the detector. (b) keeps keys in one place.
- Work: chunk cutting from the live Ogg segments with ffmpeg on Railway, a live state table
  (detected items per session for dedupe), a detector prompt, a post path back into the voice chat
  (the app can post with the bot token over REST; the recorder already can too), and reconciling
  live items with the post-call extraction.
- Cost (approximate list prices, verify at build time). Assume ~20 crew calls a week, ~45 minutes
  of speech each, ~3,900 speech-minutes a month:
  - extra transcription: `gpt-4o-mini-transcribe` ~$0.003/min -> ~$12/month; `whisper-1` ~$0.006/min
    -> ~$23/month; Deepgram Nova-3 streaming ~$0.008/min -> ~$30/month. This is on top of the
    post-call pass (the final transcript is still made from the full tracks; reusing live chunks
    would save it but makes the final transcript worse at chunk edges).
  - detector: ~15-20 windows per call x ~4k input tokens -> ~5-6M tokens/month: ~$1-3 with a small
    model, ~$15-20 with a frontier model.
  - total: roughly **$15-50 a month**, plus Vercel function time and Railway CPU for ffmpeg.
- Risks: false positives posted live in a shared channel with no review; unreviewed machine text
  shown publicly before the reviewer gate; speaker-redaction cannot be applied live (redactions are
  set after the call); DAVE decrypt gaps make live chunks patchy; a lot of new moving parts in the
  most fragile service.

### Option B: confirmations right after the call (recommended first)

When the post-call summary and the task-proposal pass (Ask 2) finish, Metalhead posts one message:
"Action items recorded from today's <crew> call: ... For each: what it proposes (new task / mark
done / change lead) and that a lead can approve it", with a link to the review panel.

- Where: **the crew's own channel, as a reply to that call's pre-call agenda message**
  (`CallAgendaPost.messageId`; fall back to a plain post in the crew channel via
  `resolveRecapChannel`). Not the voice channel's text chat: that chat belongs to the next crew's
  call by then.
- Latency: ~10-25 minutes after the call ends.
- Cost: no extra transcription. The extraction pass in Ask 2 is the only new model call: ~10-30k
  tokens per call -> ~1-3M tokens/month, **~$1-10 a month** depending on model. Discord posts are
  free.
- Reuses the existing pipeline, redaction filter, post filter and retry crons.

### Option C: live confirmation of typed action items (cheap add-on)

The recorder already sees every text-chat message during the call. A message starting with
`action:` / `ai:` / `todo:` (configurable prefixes) gets an instant reply from Metalhead:
"Action item recorded: <text>. I'll propose it as a task after the call." The line is already in
the transcript (chat segments), so the post-call pass picks it up with high confidence. Zero model
or transcription cost; needs the phase-0 remote config to read the on/off setting and prefixes.

### Recommendation

Ship **B** (with Ask 2, same pass) first, then **C** as a small recorder change. Revisit **A** only if
crews still want spoken items confirmed during the call after using B for a few weeks; it roughly
multiplies the per-call AI cost by 3-10x and adds live, unreviewed public posts. A is written up below
as Phase 4 so it can be picked up without re-research.

Policy decision needed (flag for the owner before turning B on): B posts machine-extracted text
**before** the reviewer publishes the call, which the recap deliberately does not do. Mitigations
built in: post filter (excluded crews get no post; items with blocked terms dropped), redacted
speakers' lines never reach the model, action-item text only (no quotes), and a separate setting
`calls.actionItemPostMode` = `off | after-publish | after-call` (default `off`). `after-publish`
folds the items into the existing recap timing for anyone who prefers the review gate.

---

## Ask 2: proposed crew task updates. Design

### Data model (one migration)

```prisma
enum TaskProposalKind { CREATE UPDATE DONE RETIRE }
enum TaskProposalStatus { PENDING APPLIED DISMISSED STALE FAILED }

model CrewTaskProposal {
  id            String             @id @default(cuid())
  recordingId   String
  crewId        String
  sourceKey     String             @unique // `${recordingId}:${kind}:${taskId ?? normalizedLabel}`
  kind          TaskProposalKind
  taskId        String?            // null for CREATE
  baseUpdatedAt DateTime?          // the task's updatedAt when proposed (stale check)
  changes       Json               // UPDATE/DONE/RETIRE: {field: {from, to}}; CREATE: the new task fields
  edited        Json?              // the approver's edits, applied instead of `changes`
  leadName      String?            // as said on the call
  leadMemberId  String?            // resolved (followups/resolve.ts); null when ambiguous
  candidates    Json?              // ambiguous lead matches to pick from
  reason        String             // one sentence: why (model paraphrase, shown to leads)
  quote         String?            // transcript sentence; shown only to viewers who may read transcripts
  startMs       Int?
  confidence    String             // high | medium
  actionItemIdx Int?               // index into CallRecording.actionItems it came from, if any
  followUpId    String?            // an overlapping follow-up draft, for cross-linking
  status        TaskProposalStatus @default(PENDING)
  decidedBy     String?            // Discord id
  decidedAt     DateTime?
  error         String?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  @@index([crewId, status, createdAt])
  @@index([recordingId])
}
```

- `CallRecording`: add `taskProposalsAt DateTime?`, `taskProposalsAttempts Int @default(0)`,
  `taskProposalsError String?`, `actionItemsPostedAt DateTime?`, `actionItemsMessageId String?`
  (claim-before-post, as the recap does).
- `CallAgendaPost`: add `items Json?` = the bullets with their task ids, written when the agenda is
  posted, so the extraction knows exactly what was on that call's agenda.
- Audit: applying writes `CrewTaskEvent` rows (`action` = `create|update|archive`, `actor` = the
  approver, `data` = `{via: 'call-proposal', proposalId, recordingId, changes}`); the proposal row
  itself holds `decidedBy/decidedAt/status`. Dismissals and edits are recorded on the proposal; no
  second event table is needed (alternative: a `CrewTaskProposalEvent` table like `FollowUpEvent`,
  only if multi-step history turns out to matter).

### Extraction pass (`app/lib/call-tasks/extract.ts`)

- Inputs: `visibleSegments` of the recording (redactions applied), speakers as S1..Sn
  (`buildSpeakerLabels` from followups), the stored `actionItems`, the crew's open and recently
  closed tasks from `loadCrewTasks` sent as `T1..Tn` with label/stage/priority/lead/due (ids mapped
  back in code, like speakers), the agenda bullets of the matching `CallAgendaPost.items`
  (matched by `crewId` and `startsAt` within `RESCHEDULE_WINDOW_MS` of `startedAt`), and the crew's
  allowed stage and priority vocabularies (from the existing tasks plus `isClosedStage` /
  `isActiveStage` in `app/lib/crew-mappings`).
- Output schema (zod, like `extractionSchema`): up to N items of
  `{kind, task: 'T3' | null, newLabel?, stage?, priority?, lead?, leadSpeaker?, due?, reason, quote,
  startMs, confidence}`. Rules in the prompt: only changes that were clearly said or agreed; never
  invent; prefer UPDATE of an existing task over CREATE when it matches; RETIRE only when the call
  explicitly dropped an item; DONE only when someone said it is finished. Drop `low` confidence in
  code.
- Validation in code (`parseProposals`): unknown task refs dropped; no-op changes dropped (to equals
  from); stage/priority normalised to the crew's vocabulary or dropped; due via
  `parseDueDate`; leads resolved with `resolveOwner` (members list), ambiguous kept as
  `candidates`; blocked-term filter applied to labels; dedupe on `sourceKey`; max per call
  (setting).
- Model: the summary model and fallback (`summaryModel`, `summaryFallbackModel`), same gateway.
- Runner `proposeTasksForRecording(id, {force, actorId, budgetMs})`, modelled on
  `draftFollowUpsForRecording`: returns `ok | already | disabled | crew-excluded | not-db-crew |
  not-ready | failed`. Skips crews where `usesDb('crewTasks', crewId)` is false, imported calls
  unless `importedAllowed(...)`, and calls with no `crewId`. Idempotent on `sourceKey`; a re-run
  never touches a decided row. Marks still-PENDING proposals of older calls for the same task as
  STALE when a newer call proposes a change to that task.
- Triggers: the ingest `after()` hook right after follow-ups drafting, the `followups` cron sweep
  (or a new `call-tasks` cron every 10 min; reuse the followups cron to avoid another entry), and a
  "Re-propose" button on `/admin/calls/[id]` (force) after a reviewer edits the summary.

### Applying (`app/lib/call-tasks/apply.ts`)

- First extract the per-row write from `crewTasksEditor().save` into
  `app/lib/crew-tasks-write.ts` (`createCrewTask`, `updateCrewTask`, `archiveCrewTask`, sharing
  `doneAt` handling, `freshKey`, position = end of list, `CrewTaskEvent` write). The editor keeps
  calling it, so both paths behave the same. Covered by the existing editor tests plus new ones.
- `applyProposal(id, actor, edits?)` in one transaction: re-check `canManageCrew`, status PENDING,
  and `task.updatedAt === baseUpdatedAt` (else mark STALE and return a conflict showing current vs
  proposed; the lead can "Apply anyway", which re-bases). Then write the task, the event, and
  `status=APPLIED`. `applyAll(crewId, recordingId, actor)` applies the PENDING ones with a resolved
  lead and no conflict, and reports the rest.
- Never deletes: RETIRE sets `archived=true` (or stage to the crew's closed "skipped" stage,
  setting-controlled), consistent with the editor.

### Review UI

- **Crew page** (`app/crew/[crewId]/CrewPageClient.tsx`): for viewers where `canManageCrew`, an
  "Updates from the last call" panel above the task list when PENDING proposals exist. One row per
  proposal: a before/after diff ("Stage: Doing -> Done", "New task: ... lead X, due Fri"), the reason,
  the quote with a timestamp only if `canViewCallTranscript`, buttons **Apply**, **Edit** (inline
  fields, then apply), **Dismiss**; an **Apply all** button. A lead picker for ambiguous leads
  (from `candidates`). Applied rows fade out; the task list refreshes.
- **Admin call page** (`app/admin/calls/[id]/page.tsx`): the same list read-only plus "Re-propose",
  next to the existing `DraftFollowUps`.
- API: `GET /api/crew/[crewId]/proposals`, `POST /api/crew/[crewId]/proposals/[id]`
  (`{action: 'apply' | 'dismiss', edits?, force?}`), `POST /api/crew/[crewId]/proposals/apply-all`.
  Guard copied from the content route: session, `canManageCrew`, `usesDb`, `rejectUnsafeWrite`.
  Fails closed.
- Notification: the post-call message (Option B) links to `/crew/<id>#call-updates`. Optional
  setting to DM the crew's leads instead of / as well as the channel post (reuse
  `followups/discord-dm.ts`), off by default.
- Proposals older than `calls.taskProposalMaxDays` (default 14) auto-expire to STALE in the sweep.

### Interaction with the pre-call agenda

- `CallAgendaPost.items` (new) records which tasks were discussed, which the extraction uses to
  focus on agenda items.
- Next agenda: `previousActionItems` currently re-lists the last call's action items. When that call
  has APPLIED proposals, drop action items whose `actionItemIdx` became a task (the task is already
  in the ranked list), so items are not listed twice.
- If PENDING proposals from the last call remain when the next agenda posts, add one line:
  "N updates from last call are waiting for a lead: <link>". Counted against the bullet limits.

### Interaction with follow-ups

- Separate passes, separate purposes: follow-ups are messages to people; proposals are task-list
  edits. Overlap is common ("X will do Y by Friday" is both a CREATE and maybe a reminder).
- Link, do not merge: after both passes, match on `startMs` within 30 s and the same resolved
  person; store `followUpId` on the proposal and show "Follow-up drafted" on the row (and a
  "Task proposed" chip in the follow-up queue). Applying a DONE proposal does not auto-close a
  follow-up; it shows a hint to close it.
- Run order in the ingest hook: summary -> follow-ups -> proposals -> post-call message, so the
  message can mention both.

### Settings (all in `registry.ts`, audited, default off)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `calls.taskProposalsEnabled` | int 0/1 | 0 | Run the proposal pass after each summarized call |
| `calls.taskProposalsCrews` | text list | empty | Crew ids it runs for; empty = none while piloting (the switch alone does nothing) |
| `calls.taskProposalsMaxPerCall` | int | 15 | Cap per call |
| `calls.taskProposalMaxDays` | int | 14 | PENDING proposals expire after this |
| `calls.actionItemPostMode` | text enum | `off` | `off`, `after-publish`, `after-call` |
| `calls.actionItemPostEnabled` | toggle | off | Posting switch; env `CALL_ACTION_ITEM_POST_ENABLED=off` kill switch; saved rows ignored on previews |
| `calls.taskProposalLeadDm` | int 0/1 | 0 | Also DM the crew's leads |
| `calls.chatActionPrefixes` (Phase 3) | text | `action:,ai:,todo:` | Typed action-item prefixes |
| `calls.chatActionConfirm` (Phase 3) | toggle | off | Recorder replies to typed items |

Any setting read failure = off. No crew names or filter terms in code or plan text; they live in
DB settings.

---

## Phases (each one PR)

1. **Shared task writes**: extract `app/lib/crew-tasks-write.ts` from the editor save, no behaviour
   change. Tests: existing `app/lib/sheets-import/crew-content.test.ts` plus unit tests of the new
   module.
2. **Proposals**: migration, extraction, runner, apply, API, crew page panel, admin view, settings,
   agenda `items` column and dedupe, follow-up cross-link. No posting.
3. **Post-call message (Option B)** and **typed live confirmations (Option C)** (C needs the
   phase-0 recorder config route merged; it adds `chatActions: {enabled, prefixes}` to its response
   and a reply in `recorder.onMessage`, rate-limited to 1 reply per 10 s per session).
4. **(Optional, later) Near-live (Option A)**: `recorder/src/live-chunks.ts`, app route
   `app/api/calls/recorder/live-chunk/route.ts`, `CallLiveItem` table for dedupe, settings
   `calls.liveActionItemsEnabled` + crews allowlist + window minutes. Only after a cost check on
   real usage.

## Files to change

- `prisma/schema.prisma` + `prisma/migrations/<ts>_call_task_proposals/migration.sql`
- new: `app/lib/crew-tasks-write.ts`, `app/lib/call-tasks/{extract,run,apply,post,config}.ts` + tests
- `app/lib/sheets-import/crew-content.ts` (use the shared writer)
- `app/api/calls/recorder/ingest/route.ts` (hook after follow-ups), `app/api/cron/followups/route.ts`
  (sweep)
- new routes: `app/api/crew/[crewId]/proposals/route.ts`, `.../[id]/route.ts`, `.../apply-all/route.ts`,
  `app/api/admin/calls/[id]/task-proposals/route.ts` (re-propose)
- UI: `app/crew/[crewId]/CrewPageClient.tsx` + new `CrewCallUpdates.tsx`; `app/admin/calls/[id]/page.tsx`
  + new `TaskProposals.tsx`; small chip in `app/admin/followups/FollowUpQueue.tsx`
- `app/lib/call-agenda/run.ts`, `rank.ts` (store `items`, dedupe action items, pending line)
- `app/lib/settings/registry.ts`, `toggles.ts`
- Phase 3: `recorder/src/recorder.ts`, `recorder/src/consent.ts` (reply text),
  `app/lib/calls/recorder-config.ts`

## Alternatives considered

- **Silent auto-apply with undo**: rejected by the ask (approval required) and risky on a shared
  task list.
- **Extend `summarySchema` instead of a separate pass**: rejected; the public summary schema stays
  untouched (same reason follow-ups use their own pass), and the task context (T1..Tn) would bloat
  every summary.
- **Make proposals FollowUp rows with a new kind**: rejected; different approvers (crew leads vs
  follow-up approvers), different apply semantics, and the queue is person-centred.
- **Post confirmations into the voice channel's text chat after the call**: rejected; the channel is
  shared and the next crew's call is usually running.
- **Proposals for sheet-backed crews (write to the sheet)**: out of scope; only crews on the DB path.

## Risks

- Wrong proposals (misheard names, a task "done" that was only discussed). Mitigated by approval,
  confidence filter, before/after diff, Dismiss, stale checks.
- Lead resolution errors: ambiguous names never auto-resolve; the approver picks.
- Privacy: quotes are transcript text; shown only to viewers allowed to read transcripts; redacted
  speakers never reach the model; public post contains item text only and goes through the post
  filter. The pre-review public post is a policy call (see Ask 1).
- Concurrency with the crew editor: the editor saves whole lists; `baseUpdatedAt` stale checks on
  apply, and the editor's save must not resurrect a task archived by an applied proposal (the
  editor already matches by id; verify with a test).
- Cost drift if Phase 4 is enabled broadly: crews allowlist and per-call cap.
- Previews share the prod DB: posting toggles ignore saved rows on previews; the proposal pass only
  runs from the ingest hook and production cron, and the panel is safe to view on a preview (writes
  only on an explicit click, by a lead).

## Verification

- Unit (vitest): `parseProposals` (unknown refs, no-ops, vocab normalisation, due window, dedupe,
  blocked terms), runner gating (disabled, crew not in allowlist, sheet crew, imported, already),
  apply (transaction, CrewTaskEvent written, stale conflict, permissions fail closed, RETIRE never
  deletes), agenda dedupe and pending line, post-call message builder (filters, mode `after-publish`
  vs `after-call`, claim-before-post), recorder prefix reply (Phase 3) with remote-config fallback
  all-off.
- Fixture test: a recorded-call fixture transcript with known task statements -> expected proposal
  set (model mocked), as `phase2.test.ts` does for summaries.
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npx prisma validate`; migration dry-run with
  `supabase db push --dry-run` per the repo's DB workflow.
- Vercel preview: with the settings saved ON, confirm the preview still does nothing (toggles ignore
  saved rows on previews). Open a crew page as a lead and as a non-lead: panel visible only to the
  lead; Apply / Edit / Dismiss / Apply all against a seeded proposal on a test crew; check the task
  list and `CrewTaskEvent` rows; check the admin call page section and Re-propose. Check mobile
  layout of the panel.
- Production pilot: enable `calls.taskProposalsEnabled` for one test crew only, post mode `off`;
  review a week of proposals for precision before turning on the post mode or more crews.

## Dependencies

- Phase 3 (Option C) depends on the recorder phase-0 config route (`app/api/calls/recorder/config`,
  `recorder/src/remote-config.ts`) being merged.
- Phases 1-2 depend only on the sheets cutover PRs already on `origin/main`.
