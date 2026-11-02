# sheets-cutover: move every live data set off Google Sheets onto app.pizzadao.org

**Status:** Plan v1 (2026-11-02). Investigation only; no code or data changed.
**Ask (Ops call):** stop using Google Sheets for new data. Do one full cutover to the website and
keep the old sheets as a read-only archive. Specific asks:
(a) where do crew agendas come from today, and
(b) copy all relevant sheet data into the website before the cutover, then stop updating the sheets.

---

## 1. Answer: where crew agendas come from today

Agendas come from **Google Sheets, read straight from each crew's own spreadsheet**. No Apps Script
is involved, and the DB holds no agenda content. There are two different "agendas":

1. **The "Meeting Agenda" section on the crew page (`/crew/[crewId]`).**
   `app/api/crew/[crewId]/route.ts` reads the crew sheet over GViz. The sheet URL comes from the
   `Sheet` column of the Crew Mappings sheet. `app/lib/crew-sheet.ts` detects the agenda section by
   its `Step` + `Action`/`Lead` headers. Step hyperlinks are pulled through the Sheets API
   (`getAgendaStepLinks` in `app/api/lib/google-sheets.ts`). People edit this by hand during calls.
   **Source of truth: the crew sheet. DB: none.**
2. **The pre-call agenda that Metalhead posts in Discord** (`/api/cron/call-agenda`, every 10 min,
   in `app/lib/call-agenda/run.ts`). It is a hybrid:
   - the call schedule comes from Discord scheduled events;
   - the crew, its channel and its event match come from the **Crew Mappings sheet**;
   - the ranked bullets (overdue / Top / High / in progress) come from the **crew sheet's Tasks
     section** (`fetchOpenCrewTasksResult`, GViz);
   - "From last call" items come from the **DB** (`CallRecording.actionItems`);
   - dedup is in the **DB** (`CallAgendaPost`, 4 rows in prod, for 4 crews).

   It does not use the hand-written Meeting Agenda section at all.

So to move agendas off Sheets, two data sets have to move first: **Crew Mappings** (the crew
registry) and the **crew sheet contents** (tasks, plus the agenda steps, goals and roster on the
same tab).

---

## 2. Inventory

Prod row counts are from `pizzadao-db`, taken 2026-11-02. Sheet sizes come from the public GViz
response and are approximate, because section detection on crew sheets is heuristic.

| # | Data | Sheet (config key in `app/lib/sheets/config.ts`) | Read by | Written by today | Source of truth | DB table | Gap |
|---|---|---|---|---|---|---|---|
| 1 | **Members** (ID, Status, Name, City, Orgs, Crews, Skills, Telegram, ENS, Turtles, Region, Notes, DiscordID, Wallet, X); ~604 rows, 25 cols | `members`, tab `Crew` | `app/lib/sheets/member-repository.ts` (single read path; about 94 files use it), `members-list.ts`, `member-id`, `unbelievaboat/members-source.ts` | Apps Script web app (`backend_script.gs`, `GOOGLE_SHEETS_WEBAPP_URL`), called from `profile`, `claim-member`, `auto-claim`, `join-crew`, `update-skills`, `update-orgs`, `x/callback`, `x/disconnect`. Also the Sheets API directly in `roster-writeback.ts` (Crews cell). Admins also edit Status, Notes, Region and similar fields **by hand** | Sheet | Partial side tables only: `MemberProfileExtras` (47), `MemberWallet` (110, 78 with `source=sheet`), `TelegramAccount`, `XAccount`, `AttendanceSummary.memberId` | **No `Member` table.** Member ID allocation reads the live sheet (`member-registration.ts`, under an advisory lock). There is no admin UI for the hand-edited columns |
| 1b | Onboarding log (append-only) | Apps Script's bound spreadsheet, tab `Onboarding` | nothing | Apps Script `doPost` | Sheet | none | Archive only; nothing to migrate for runtime |
| 2 | **Crew registry** (Crew, Turtles, Role, Channel, Event, Emoji, Sheet, Call Time + link, Call Length, Script, Type); 11 crews | `crewMappings`, tab `Crew Mappings` | `app/lib/crew-mappings.ts` `getCrewMappings` (crew pages, crews list, agenda cron, recap channel, `claim-task` allow-list, discord-webhook labels, calls/crew-map) | humans | Sheet | none (`CrewDraft.crewId` and `CallRecording.crewId` hold the slug only) | **No `Crew` table** and no editor |
| 3 | **Crew tasks** (Task, Stage, Priority, Due, Lead ID, links); ~450 rows over 11 sheets | each crew's sheet (URL in #2) | `crew-mappings.ts` `fetchCrewTasks` (crews list top 3, agenda cron), `api/crew/[crewId]`, `my-tasks.ts` + `api/my-tasks/[memberId]` | humans; the website writes only the **Lead ID cell** (`api/claim-task`, Sheets API) | Sheet | `TaskClaimEvent` (0 rows; a claim log, not the task) | **No task table.** No task create/edit UI |
| 4 | **Crew agenda steps** (Step, Action, Lead, links); ~90 rows | crew sheets | `api/crew/[crewId]` | humans | Sheet | none | No table, no editor |
| 5 | **Crew goals**; ~75 rows | crew sheets | `api/crew/[crewId]` | humans | Sheet | none | No table, no editor |
| 6 | **Crew roster** (Name, Status incl. lead/capo, City...); ~230 rows | crew sheets | `api/crew/[crewId]`, **`app/lib/crew-leads.ts` (permission checks, fail closed)**, `api/crew/roster-audit` | humans | Sheet | none | No table. This duplicates the members sheet `Crews` cell (roster-audit exists because the two drift) |
| 7 | **Crew call info** block | crew sheets | `api/crew/[crewId]` | humans | Sheet | none | Fold into the `Crew` row (#2) |
| 8 | **Call attendance** (per call: who attended) | `communityCall` sheet + each crew sheet's `Attendance` tab, each linking to **daily attendance sheets** | `app/lib/attendance.ts` sync (cron `/api/cron/attendance`, daily) | daily sheets are made by a process **outside this repo** (to confirm: likely a bound Apps Script; the Crew Mappings `Script` column hints at this) | Sheets → DB copy | `CallAttendance` (7,655, latest call 2026-11-01), `AttendanceSyncLog` (546), `AttendanceSummary` (722) | **History is already in the DB.** Gap: a website-native way to *record* attendance (nothing in-app takes attendance; `CallSpeaker` covers only people who spoke) |
| 9 | POAP event whitelist; ~268 rows | `poapWhitelist` | `app/lib/poap.ts` | humans | Sheet | none | Move to a DB setting (id list) with an admin UI |
| 10 | NFT collections (chain, contract, name, order); ~13 rows | `nftContracts` | `app/lib/nft-config.ts` | humans | Sheet | none | Small table or settings JSON, with an admin UI |
| 11 | Manuals index (title, crew, status, author, link); ~11 rows | `manuals` | `api/manuals`, `api/manuals/[id]` | humans | Sheet (content lives in linked Docs) | none | `Manual` table (index only; Docs stay as links) |
| 12 | Discord webhook URLs by channel name (secret) | `discordWebhooks` (private, service account) | `app/lib/discord-webhook.ts` (General, support, spotlight) | humans | Sheet | none | Replace with bot posts to a saved channel id (`postDiscordMessage` + `savedChannelId`), so no webhook secrets are needed |
| 13 | Community Call announcement block (Announce?, Last Sent, Last Error, specials table) | `announce`, tab `Crews` | `app/lib/announce/*`, `/api/announce` | humans + the website (status cells through the Sheets API) | Sheet | none | `Announcement` rows + run status in the DB, with an admin UI |
| 14 | Jobs (type, description) | `JOBS_SHEET_ID` env (CSV export) | `app/lib/jobs.ts`, `/api/jobs/sync` | humans | Sheet → DB copy | `Job` (40) | DB copy already exists. Gap: an admin editor, then turn the sync off |
| 15 | Work Payment form responses | sheet id held in a DB setting (no id in repo) | `app/lib/payments/ingest*.ts`, cron `payments-ingest` | Google Form | Form → DB copy | `PaymentRequest` (0) and related | The website form (`app/payments/new`) exists. Gap: a final ingest, then clear the setting and close the Form |
| 16 | Hard-coded crew sheet list in `scripts/sync-attendance.mjs`, `scripts/audit-crew-rosters.mjs`, `scripts/backfill-wallets.mjs` | various | one-off scripts | none | n/a | n/a | Retire with the cleanup PR |
| — | Task tracking (`TASKS.md`) | (former project sheet) | n/a | n/a | already moved to `TASKS.md` on 2026-10-04 | n/a | none |

**Writes to Sheets that must stop at cutover:** the Apps Script web app (8 routes), `claim-task`
(Lead ID cell), `roster-writeback` (Crews cell), and `announce/sheet.ts` (status cells). Everything
else only reads.

---

## 3. Approach

### 3.1 Pattern used for every data set (reversible, off by default)

For each data set `X`:

1. **Schema PR.** Add the Prisma model(s) plus a migration. This is additive only: no drops and no
   renames.
2. **Importer.** Pure parsers in `app/lib/sheets-import/<x>.ts`, unit-tested on recorded GViz /
   Sheets API fixtures. Reuse the existing parsers (`crew-sheet.ts`, `crew-mappings.ts`,
   `member-repository.ts`, `google-sheets.ts` link extraction) rather than writing new ones. They
   are exposed through an admin-only route, `POST /api/admin/sheets-import/<x>`, with
   `mode=dry-run` (the default) or `mode=apply`. It is the same safety model as
   `roster-writeback.ts`:
   - **Dry-run** reads the sheet and the DB and returns counts only: would-create, would-update,
     unchanged, would-orphan, and parse errors with row numbers. It returns no cell contents, so
     the report is safe to paste in a PR.
   - **Apply** upserts by a stable natural key (below). Running it twice changes nothing. It never
     deletes; rows missing from the sheet are reported as orphans.
   - Every apply writes an `SheetImportRun` row (dataset, mode, counts, actor, timestamp, sheet
     revision if available).
   - Running this in Vercel means the existing `GOOGLE_SERVICE_ACCOUNT_JSON` and Prisma setup are
     reused, with no local credentials.
3. **Source switch.** A DB setting `sheets.source.<x>` with values `sheet` | `db`, and `sheet` as
   the default. It has an env kill-switch (`SHEETS_SOURCE_<X>=sheet` always wins), using the same
   `toggleEnabled` / settings-registry pattern as the other toggles. The read path branches in one
   place, the existing repository module, so callers do not change. Flipping back to `sheet` is the
   rollback.
4. **Website writes go to the DB.** When the source is `db`, the existing write routes write the
   DB. For members only, an optional **mirror to the sheet** (`sheets.mirror.members`, default on
   during the overlap) keeps the archive current until the freeze, so rollback loses nothing.
5. **Editor UI.** Whatever humans used to edit in the sheet gets an admin or crew-lead editor
   **before** that sheet is frozen. Otherwise the cutover removes a capability.

### 3.2 Natural keys (idempotency)

| Data | Key |
|---|---|
| Member | member ID (sheet column A), unique `discordId` when present |
| Crew | slug from `slugify(Crew)` (the same id used today in URLs, `CallRecording.crewId`, `CrewDraft.crewId`) |
| Crew task / goal / agenda step / roster row | `(crewId, kind, sourceRow)` on first import, plus a generated id from then on. Re-import matches by `(crewId, normalized label)` first and falls back to `sourceRow`, so re-ordering rows in the sheet does not duplicate them |
| Attendance | existing `@@unique([discordId, dailySheetId])` |
| POAP id / NFT contract / manual | event id / `(chain, address)` / normalized title |

### 3.3 Proposed models (sketch; final shape in each PR)

- `Member`: id (string, the sheet ID), discordId (unique, nullable), name, city, region, status,
  orgs[], skills[], turtles[], telegram, ens, x, wallet, notes, createdAt, updatedAt, plus
  `MemberCrew(memberId, crewId)`.
  - Mark `notes` and other admin-only fields **private** in the read adapter.
  - Keep the `members-list.ts` allow-list exactly as it is.
- `Crew`: id (slug), label, emoji, turtles[], discordRoleId, channel, eventMatch, callTime,
  callTimeUrl, callLength, type, sortOrder, archived, legacySheetUrl, plus call-info fields.
- `CrewTask`: crewId, label, url, stage, priority, due (date), leadMemberId, notes, tags, position,
  doneAt, createdBy, updatedBy, plus `CrewTaskEvent` for audit.
- `CrewGoal`, `CrewAgendaStep` (crewId, position, step, action, leadMemberId, url).
- `CrewRole` (crewId, memberId, status: lead | capo | member...). This replaces the crew-sheet
  roster section, and `crew-leads.ts` reads it.
- `Manual`, `NftCollection`, and the POAP whitelist as a setting.
- `Announcement` + `AnnouncementRun`.
- `SheetImportRun` (audit), `SheetSnapshot` (dataset, sheetKey, tab, takenAt, json). This is a raw
  frozen copy of every tab at final import: the in-DB archive. It is not publicly readable.

### 3.4 Read adapters (keep the blast radius small)

- **Members.** About 94 files use `getMembersTable` / `getSheetData` / `fetchMemberBy*`, and all of
  them consume a GViz-shaped `MembersTable`.
  - **Phase A:** a DB-backed `getMembersTable` builds the same `MembersTable` shape (headers in the
    same order, `c[].v` cells) from `Member` rows when the source is `db`. Callers are unchanged,
    and parity is testable by comparing the two outputs.
  - **Phase B (later, optional):** migrate callers to typed Prisma reads one by one.
- **Crews.** `getCrewMappings()` keeps its signature (`CrewOption[]`) and builds from `Crew` +
  `CrewTask` when the source is `db`.
  - `fetchOpenCrewTasksResult(crew)` takes the crew (not the sheet URL) and returns the same
    `CrewTaskDetail[]`.
  - The agenda cron and crew page then need almost no changes.
- **Crew page.** `api/crew/[crewId]` returns the same JSON (`roster, goals, tasks, agenda,
  callInfo`) from the DB, so `CrewPageClient.tsx` only gains edit controls.

### 3.5 Alternatives considered

- **Keep Sheets and add a two-way sync.** Rejected. It keeps the sheet as a co-writer, which is the
  thing Ops wants to end. It also doubles the conflict surface, and GViz lags writes (already
  documented in `member-registration.ts`).
- **Big-bang cutover of everything in one PR.** Rejected. About 94 member consumers, crew
  permissions and the agenda cron would all change at once with no per-data-set rollback.
- **A local node script instead of an admin route for imports.** Possible (the `scripts/*.mjs`
  precedent), but it needs prod DB and service-account credentials on a laptop. The admin route is
  auditable, gives an "Import" button the team can rerun, and still supports dry-run. Keep an
  `.mjs` wrapper that calls the route for CLI use.
- **Keep the Discord webhooks sheet.** Rejected. The bot can already post to saved channel ids, and
  a secret URL in a spreadsheet is a liability once the sheet is "archived".
- **Typed rewrite of all member callers up front.** Deferred to Phase B. The shape-compatible
  adapter gets the data off Sheets first.

---

## 4. Migration order (one PR per data set)

Every PR ships with the source set to `sheet`. It is flipped to `db` only after a clean dry-run, an
apply, and a parity check on the preview and then prod. Flipping back is the rollback for that
data set. Do not freeze any sheet until §6.

| PR | Data set | Contents | Flip criteria |
|---|---|---|---|
| **0** | Foundation | `SheetImportRun`, `SheetSnapshot` models; `app/lib/sheets-import/` framework (dry-run/apply, counts-only report, audit row); `sheets.source.*` / `sheets.mirror.*` settings + env kill-switches; admin page `/admin/sheets` listing each data set, its source, last import and an Import (dry-run) button; snapshot-all-tabs action | n/a (no behavior change) |
| **1** | Small configs: POAP whitelist (#9), NFT collections (#10), manuals index (#11) | models/settings, importers, admin editors, read-path switch | dry-run 0 parse errors; profile POAPs / NFT list / manuals pages identical on preview |
| **2** | Discord webhooks (#12) | swap `getWebhookUrl(name)` callers (General, support, spotlight, suggestions) to `postDiscordMessage` on a saved channel id setting; keep the webhook path behind `sheets.source.webhooks=sheet` | a test post lands in each target channel from the preview |
| **3** | Crew registry (#2, #7) | `Crew` model, importer, admin crew editor (label, emoji, role, channel, event, call time/link/length, type), `getCrewMappings` DB branch | `/crews`, every `/crew/[id]` header, recap channel resolution and `/admin/calls` agenda preview match sheet mode |
| **4** | Crew tasks (#3) + agenda steps (#4) + goals (#5) | models, importer (incl. hyperlink extraction via existing `getTaskLinks` / `getAgendaStepLinks`), crew-lead editor on the crew page (add/edit/reorder/stage/priority/due/lead), `claim-task` writes `CrewTask.leadMemberId`, `my-tasks` reads DB, agenda cron reads DB. **This answers ask (a): agendas become website-native.** | per crew: open-task count, top 3, and agenda bullets identical between modes in `/admin/calls` preview; flip **per crew** is allowed (`sheets.source.crewTasks` can hold a crew allow-list) so one crew can pilot |
| **5** | Crew roster / roles (#6) | `CrewRole`, importer (match roster names → member ids; unresolved names reported), `crew-leads.ts` reads DB (still fail-closed), roster editor; reconcile against members `Crews` via existing roster-audit | every current lead/capo resolves; zero unresolved for statuses that grant permissions |
| **6** | Attendance (#8) | final sheet sync stays as is (history already in DB). Add a website-native recorder: log Discord voice participants during the crew's scheduled event (the recorder bot / gateway already in the channel) into `CallAttendance` with `dailySheetId = "discord:<eventId>:<yyyy-mm-dd>"` (keeps the unique key, no migration needed); then an admin "add/remove attendee" fix-up screen. Disable `/api/cron/attendance` sheet sync after the freeze | two weeks of Discord-native attendance matching the sheet attendance for the same calls within tolerance |
| **7** | **Members** (#1) | `Member` + `MemberCrew`, importer (all ~604 rows, normalizes lists, keeps blank-header ID column), DB-backed `getMembersTable` adapter, member-ID allocation from DB (`max(id)+1` under the existing advisory lock), every Apps Script caller and `roster-writeback` write DB first then mirror to the sheet while `sheets.mirror.members` is on, admin member editor for hand-edited columns (Status, Region, Notes, ENS, Turtles, Crews). Backfill `MemberWallet` from `Member.wallet` is already done (`source=sheet`), so only reconcile | adapter output deep-equals sheet output for all rows (excluding cache timestamps); onboarding new member, claim, join crew, skills/orgs, X connect all work on preview against the DB |
| **8** | Announce (#13), Jobs (#14), Payments ingest (#15) | `Announcement` model + admin editor, `/api/announce` reads/writes DB; Jobs admin editor and sync disabled; payments: last ingest, clear the sheet setting, point the Form's confirmation to the website form | announce dry-run renders identical text; jobs board unchanged |
| **9** | Freeze (§6) | final dry-run → apply for every set, snapshot, flip all to `db`, turn off member mirror, disable writes | §6 checklist |
| **10** | Cleanup (a few weeks later) | remove sheet read branches, Apps Script callers, `GOOGLE_SHEETS_WEBAPP_URL`, `backend_script.gs`, hard-coded sheet scripts, `SHEET_IDS` entries no longer used (keep the archive links in the admin page) | nothing reads Sheets at runtime (grep check) |

PRs 1 and 2 are independent warm-ups and can run in parallel with PR 3. PR 4 depends on PR 3. PR 5
depends on PRs 3 and 7's `Member` ids, or it can use the sheet member lookup until PR 7 lands. PR 6
is independent. PR 7 is the largest and riskiest, so it goes last among the data moves.

---

## 5. Import scripts needed

All go through the PR 0 framework: dry-run by default, counts-only output, idempotent upsert,
never deletes, and an audit row on apply.

| Importer | Reads | Notes |
|---|---|---|
| `poap-whitelist` | GViz (column-detection logic from `poap.ts`) | ids deduped |
| `nft-collections` | GViz | `(chain,address)` lowercase |
| `manuals` | GViz + `getManualLinks` | links preserved |
| `crews` | GViz `Crew Mappings` + `getColumnHyperlinks` (Call Time link) | merges duplicate rows the way `getCrewMappings` does today |
| `crew-content` (tasks, agenda, goals, roster, call info) | per crew sheet: GViz + Sheets API hyperlink maps | one run per crew or all; reports unparsed sections, unresolved Lead IDs and roster names; preserves Done/Skip tasks too (marked done) so history survives |
| `attendance` | existing `syncAllCrewAttendance` | already idempotent; run once more right before freeze |
| `members` | Sheets API `UNFORMATTED_VALUE` (not GViz, which lags) | key = ID; reports duplicate IDs, duplicate Discord IDs, rows with no ID (skipped, listed by row number only) |
| `announce` | `announce/sheet.ts` reader | |
| `jobs` | existing `syncJobsFromSheet` | already in DB; final run |
| `snapshot` | every tab of every sheet in `SHEET_IDS` + crew sheets | raw JSON into `SheetSnapshot` (admin-only, includes private columns, never exposed publicly) |

---

## 6. Freezing the sheets (end state)

Run on an agreed cutover day, announced on the Ops call and in Discord the day before.

1. Tell crews: "after <time> edit on the website; the sheet is an archive".
2. Run the final **dry-run** for every data set. Then run **apply**, then dry-run again, which must
   show 0 changes. Take a snapshot.
3. Flip every `sheets.source.*` to `db`. Set `sheets.mirror.members` to off.
4. Disable the sheet writers:
   - Undeploy the Apps Script web app (or make `doPost` return an "archived" error).
   - Remove `GOOGLE_SHEETS_WEBAPP_URL` from Vercel.
   - The service account is downgraded to **Viewer** on every sheet, so `claim-task`,
     `roster-writeback` and `announce` writes fail closed if any branch is missed.
   - Turn off the attendance sheet sync cron and the jobs and payments ingest.
   - Stop the external attendance-sheet generator, or leave it running read-only for comparison
     until PR 6 is trusted.
5. Make the sheets view-only:
   - Sheet owners set every editor to **Viewer** (Share → change role). This is done by a human
     owner, not by the app.
   - Add Data → Protect sheets and ranges on each tab as a second guard.
   - Rename each file with an `[ARCHIVE yyyy-mm-dd]` prefix.
   - Add a frozen banner row: "Archived. Edit at app.pizzadao.org/...".
   - Keep link sharing ("anyone with the link can view") only where it exists today, for the
     archive.
6. List every archived sheet (by config key, with its link) on `/admin/sheets` so the archive is
   findable.

---

## 7. Risks

- **Hidden writers.** Daily attendance sheets, the `Script` column and human edits are produced
  outside this repo. **Mitigations:**
  - Inventory them with the team before PR 9.
  - The service-account Viewer downgrade makes any write the app missed fail loudly instead of
    silently.
- **Members privacy.** The members sheet is publicly readable today, and the app protects
  privacy with column allow-lists. **Mitigations:**
  - The DB adapter must keep the `members-list.ts` allow-list. Notes, Telegram and wallet must not
    leak into public JSON.
  - `SheetSnapshot` is admin-only.
  - Plans and PRs must not contain member data. Reports are counts only.
- **Permission regressions.** `crew-leads.ts` gates crew-lead actions. A roster import that misses
  a lead locks them out, and a bad match grants access. **Mitigations:**
  - Fail closed.
  - Permission-granting statuses need an exact member-id match.
  - Unresolved rows block the flip.
- **Member ID collisions** during the overlap, while both the sheet (by hand) and the DB can add
  members. **Mitigations:**
  - Once source = `db`, IDs come from the DB only.
  - The mirror writes to the sheet.
  - Hand-adding rows to the members sheet stops at the members flip.
- **Edits landing in the sheet after import.** **Mitigations:**
  - The overlap window is short.
  - Re-running the dry-run before each flip shows drift.
  - Per-crew flips for tasks.
  - Announce each crew's flip in its channel.
- **Data parsing quirks.** Tables-mode GViz headers, blank-header ID column, hyperlinks only
  available through the Sheets API, gviz `Date(y,m,d)` with 0-based months, free-text priority /
  stage values. **Mitigations:**
  - Reuse the existing parsers.
  - Store the raw value next to the normalized one (`stageRaw`, `priorityRaw`) on first import.
- **Sheet-shaped adapter hides typing problems.** This is acceptable for the cutover. Phase B
  removes it.
- **Caching.** The current paths use the Next data cache (`members` tag, 120s/300s revalidate).
  DB-mode writes must call the same `invalidateMembersCache()` / crew cache deletes, or the UI
  shows stale data after an edit.
- **Rollback after the freeze.** Once the sheets are view-only, flipping back to `sheet` serves the
  frozen data. That is safe (read-only) but stale. Before the freeze, the members mirror keeps
  rollback lossless. Crew-content edits made in the DB are not mirrored, so a rollback of PR 4
  after crews have edited loses those edits. Hence the per-crew pilot.
- **Prod migrations.** All schema changes are additive. Follow the repo's normal Prisma migration
  flow and confirm prod DB writes (imports with `mode=apply`) with the maintainer before running them.

---

## 8. Verification

- **Unit tests (vitest)** for each importer parser against recorded fixtures (synthetic data, no
  real member rows). They cover:
  - idempotency: apply twice gives 0 changes the second time;
  - a re-ordered sheet does not duplicate rows;
  - Done/Skip handling;
  - date and hyperlink parsing;
  - the members adapter producing a `MembersTable` identical to the sheet path for a fixture;
  - `crew-leads` decisions identical in both modes;
  - agenda `planAgendas` producing identical bullets from DB tasks.
- **Parity endpoint** (admin-only) `GET /api/admin/sheets-import/<x>/parity`. It computes the
  sheet-mode and DB-mode outputs of the real read functions and returns counts of mismatches,
  never contents. It must be 0 (or explained) before each flip.
- **Vercel preview checks** (via `vercel-deploy` / `/ship`) for each PR, with the source flipped on
  the preview only (env override `SHEETS_SOURCE_<X>=db` set for Preview):
  - PR 3/4: `/crews`, three crew pages (`/crew/<id>`), the crew-page task editor as a lead and as a
    non-lead (denied), `/admin/calls` agenda preview for an upcoming event, claim a task, and
    "my tasks" on a profile.
  - PR 5: crew-lead-only actions as a lead and as a non-lead.
  - PR 6: start a test scheduled event and confirm attendance rows appear.
  - PR 7: onboarding a new test member (new ID allocated), claim flow, join/leave crew,
    skills/orgs edit, X connect/disconnect, the public members list (check that no private
    columns appear in the JSON), and leaderboard/profile pages.
  - PR 8: announce dry-run, jobs board, payments queue.
- **Prod, after each flip:**
  - Watch the Vercel logs for an hour.
  - Run the dry-run again (0 drift).
  - Spot-check the same pages.
  - Keep the env kill-switch ready.
- **Final:** `grep -rn "gviz\|spreadsheets\|GOOGLE_SHEETS_WEBAPP_URL" app` returns only the archive
  links (cleanup PR), and `/admin/sheets` shows every data set on `db`.

---

## 9. Open questions for the team

1. Who or what creates the daily attendance sheets, and does the `Script` column in Crew Mappings
   refer to it? This decides whether PR 6 replaces it or just stops it.
2. Who edits the members sheet by hand today, and which columns? This sets the admin member editor
   scope for PR 7.
3. Should crew members (not only leads) be able to add or edit tasks on the website?
4. Is the Jobs sheet (`JOBS_SHEET_ID`) still in use, or can the jobs sync just be turned off?
5. Cutover day, and whether a per-crew pilot (for example one crew first) is wanted for tasks and
   agendas.
