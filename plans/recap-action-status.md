# Recap action status: done / in progress / needs help, finished-work links, kept current

## Goal

The Discord recap of a published call (and the public `/calls/<id>` page) shows, for every action
item: who suggested it (already done), its status (✅ done, 🔄 in progress, 🆘 needs help, nothing
for not started) and a link to the finished work when there is one. The posted Discord message is
edited in place as the work progresses (never a new post).

## What already exists (verified on origin/main @ 9a4a3104)

- `app/lib/calls/recap.ts`: `buildRecapParts` already renders `✅` for items with `done: true` and
  masked evidence links (`[PR #123](<url>)`, ≤200-char URLs) on done items; over 2000 chars it drops
  all evidence links first, then whole items (`+N more on the call page`), then trailing lines.
  `repostRecap(id, { edit: true })` re-renders and PATCHes the stored message; only called from the
  manual `POST /api/admin/calls/[id]/recap` button.
- `app/lib/calls/evidence.ts`: `safeEvidenceUrl` (http(s) only, ≤500 chars, no spaces/`<>()\`),
  `evidenceLabel`, `readEvidence` (≤3), `parseEvidenceStrict`, `parseEvidenceInput`.
- Admin side, no migration (#306, #318): `actionItems[i].done` + `evidence[{url}]` in the JSON,
  set from `app/admin/calls/ReviewActions.tsx` (checkbox + link input; textarea format
  `[x] text | owner | by: X | ev: url`). `carryDone` (recordings.ts) keeps done/evidence over a
  regeneration when the text is unchanged. `updateRecordingText` treats done/evidence as status (no
  `summaryEditedAt` freeze). Public page and Telegram mirror (`toPlainPost` turns masked links
  into `(PR #123)`) already handle it.
- Follow-ups: `FollowUp` rows are drafted by a separate model pass (`app/lib/followups/extract.ts`,
  `draft.ts`) from the transcript; the action items are passed only "for context" as `1. text (owner)`.
  `sourceKey = recordingId:startMs:owner` — there is NO link to an action item. Member status moves
  go through `applyMemberAction` (`app/lib/followups/actions.ts`), used by Discord DM buttons
  (`app/lib/discord-interactions/followups.ts`, ids `fu:<action>:<id>`) and the signed Telegram
  link page `app/fu/[token]` + `POST /api/fu/[token]` (`link-actions.ts`). Admin moves in
  `app/lib/followups/admin.ts` (approve / dismiss); `DONE` and `DISMISSED` are terminal.
- Only two writers of `CallRecording.actionItems`: `generateAndStoreSummary` (recordings.ts ~351,
  via `carryDone`) and `updateRecordingText`.

So the real gaps are: (1) linking items to follow-ups, (2) 🔄 / 🆘 from follow-ups, (3) a
member-provided finished link, (4) automatic, debounced edits of the posted message, (5) a length
strategy that keeps links when it can.

## Key design decisions

### 1. Link items <-> follow-ups with a stable per-item key

- Each stored action item gets `key: string` (8 chars `[a-z0-9]`, random) in the JSON. No migration
  for the JSON itself.
- New pure helper `assignActionKeys(prev, next)` in `app/lib/calls/action-keys.ts`:
  1. keep `next[i].key` if it exists in `prev` and is not used yet (never trust an unknown key from
     the client: replace it);
  2. else take the key of an unused `prev` item with the same normalized text (same norm as
     `carryDone`);
  3. else the key of the unused `prev` item at the same index when its owner is the same and the text
     similarity (token Jaccard) is >= 0.5 (light rewording by a reviewer keeps the link);
  4. else a new key.
  Called in both writers: in `generateAndStoreSummary` around `carryDone(...)`, and in
  `updateRecordingText` before writing `data.actionItems`. `carryDone` stays as is.
- `ReviewActions.tsx` keeps `key` on its parsed items (match by line index, then by text, against
  the items it loaded) and sends it; the server is the authority (step 1 above). The PATCH route
  (`app/api/admin/calls/[id]/summary/route.ts`) accepts optional `key` matching `/^[a-z0-9]{6,12}$/`.
  `stripDone` in `updateRecordingText` also strips `key` so key churn never counts as a text edit.
- `FollowUp.actionKey` (new nullable column) points at the item's key (same `recordingId`).
- Drafting: `buildExtractionPrompt` labels items `A1..An` (instead of `1..n`) and the schema gets
  `actionItem: z.string().nullable()` ("the A-label of the action item this follow-up is about, or
  null"). `parseExtraction` maps the label to the key (unknown label -> null); `FollowUpDraft` gets
  `actionKey`, `storeDrafts` writes it. Existing rows are never touched by a re-draft (unchanged rule).
- Calls without keys yet (everything before this ships): `ensureActionKeys(recordingId)` (same
  module) does a read-assign-write under `pg_advisory_xact_lock(hashtext('action-keys:'||id))` in a
  transaction; called by drafting before the model call and by the admin link endpoint. Optional
  operator script `scripts/link-followups-to-actions.ts` (dry run by default, `--apply`) assigns keys
  and proposes links for recent calls by owner-name match + text overlap; bulk prod writes only with
  Snax's explicit OK.
- Items with no follow-up: status comes only from the admin `done`/`evidence` (exactly today).
- Multiple follow-ups per item: aggregated (below). A follow-up with `actionKey` that no longer
  exists (item deleted) is simply ignored; the admin can relink it.
- Admin linking: on `/admin/calls/[id]` a new `CallFollowUpLinks` panel lists this call's follow-ups
  (owner, ask, status, finished link) with an "Action item" select (none / A1..An) and a "clear link"
  button. Endpoint `PATCH /api/admin/followups/[id]` gets `actionKey` and `doneUrl` fields handled by a
  new `linkFollowUp(id, actor, { actionKey?, doneUrl? })` in `admin.ts` that works in ANY status (the
  existing `editFollowUp` stays limited to `EDITABLE`), validates the key against the recording's
  items, logs a `linked` / `done-link` event, and requests a recap refresh. Unlinking is also the
  admin's override when a member's status is wrong.

### 2. Status per item

New module `app/lib/calls/action-status.ts`:

```ts
export type ActionState = 'done' | 'in_progress' | 'needs_help' | null
export interface ActionView { text; owner?; suggestedBy?; key?; state: ActionState; links: Array<{ url: string; label: string }> }
export function deriveActionViews(items: unknown, followUps: Array<{ actionKey: string | null; status: FollowUpStatus; doneUrl: string | null }>, opts: { memberLinks: boolean; needsHelp: boolean }): ActionView[]   // pure
export async function loadActionViews(rec: { id: string; actionItems: unknown }, settings?: Settings): Promise<ActionView[]>   // one findMany by recordingId, actionKey not null
```

Precedence per item: admin `done: true` -> ✅ (admin always wins) > any linked follow-up
`NEEDS_HELP` -> 🆘 (when shown) > any `IN_PROGRESS` -> 🔄 > any `DONE` -> ✅ > nothing.
So two owners, one done and one still working, reads 🔄 (the item is not finished).
`SENT` / `REPLIED` / `DRAFT` / `APPROVED` / `FAILED` / `UNREACHABLE` / `ESCALATED` / `DISMISSED`
contribute nothing. Links: admin `evidence` first, then `doneUrl` of linked `DONE` follow-ups
(deduped, max 3 via `readEvidence`), shown only when the item is done. Member links are left out
when `calls.recapMemberLinksEnabled` is off. Every link is also checked against the post filter
(`mentionsBlockedTerm`); a hit drops the link, not the item.

No new admin "in progress" field: an admin who wants to mark an item done uses the existing done
checkbox + link input (already "without a follow-up"). ReviewActions shows the derived follow-up
state next to each item read-only (e.g. "Follow-up: in progress") so the reviewer sees why the recap
shows 🔄.

### 3. Finished-work link (`FollowUp.doneUrl`)

- Stored on the follow-up (additive columns `doneUrl VARCHAR(500)`, `doneUrlAt`, `doneUrlBy`), not in
  the action-items JSON: member actions never write the JSON, so there is no lost-update race with
  a reviewer saving the editor.
- Validation: `safeEvidenceUrl` (http(s) only, real host, ≤500 chars, no whitespace/`<>()\`;
  `javascript:`/`data:` rejected) plus the post filter. Optional host allowlist
  `calls.recapLinkHosts` is listed as an open question (not in phase 1).
- Set by:
  - Telegram / web: `/fu/[token]` page for a `done` link shows an optional "Link to the finished work"
    input; `POST /api/fu/[token]` accepts `{ url? }`. A `done` link stays usable after `DONE` for
    adding/changing the link only (`lookupLink`: `open` also when `status === 'DONE' && a === 'done'`;
    the page then shows only the link field). Existing IP + token rate limits apply.
  - Discord: Done stays one tap. The ephemeral "Marked as done" answer gets an "Add a link" button
    (`fu:link:<id>`), which opens a modal (`fu:linkmodal:<id>`, one short text input, max 500) like the
    existing reply modal. New regexes next to `BUTTON_ID` / `MODAL_ID`; `labelsFor` gets `addLink` in
    en/es/fr.
  - Admin: `linkFollowUp(..., { doneUrl })` (set or clear) from the new panel.
- New `setDoneUrl({ followUpId, discordId, actorId, url })` in `actions.ts`: owner check, status must
  be `DONE` (or it is applied right after the done transition in the same request), validation, event
  `done-link`, one approver alert through `takeAlertSlot` ("<owner> added a link for "<ask>": <host>")
  so a human sees what will appear publicly. Returns `{ ok:false, reason:'bad-url' }` on invalid input.
- Public: yes, it appears in the public Discord post and on `/calls/<id>` (inside the existing
  action-items access gate). Help text on the input says so ("This link will be shown publicly with
  the call recap"). `rel="nofollow noopener noreferrer ugc"` on the page.

### 4. Keeping the recap current (debounced edit, never a new post)

- New columns on `CallRecording`: `recapRefreshAt` (when a refresh is due), `recapEditedAt` (last
  successful edit), `recapRenderedHash VARCHAR(64)` (sha256 of the last content + allowed mentions).
- `requestRecapRefresh(recordingId, reason)` in new `app/lib/calls/recap-refresh.ts`: no-op unless
  `calls.recapLiveStatusEnabled`; one `updateMany` where `{ id, status: 'PUBLISHED', recapMessageId:
  { not: null }, recapRefreshAt: null }` setting `recapRefreshAt = now + calls.recapRefreshDelayMinutes`
  (an earlier pending time is kept, so a burst of taps = one edit). Never throws (catch + log): a
  member's Done must never fail because of the recap. Safe when the recap is not posted yet (no
  message id -> nothing scheduled; the first post renders the current status anyway).
- Callers: `applyMemberAction` after a successful status move into/out of IN_PROGRESS / NEEDS_HELP /
  DONE when `row.recordingId && row.actionKey`; `setDoneUrl`; `linkFollowUp`; `dismissFollowUp` when
  the row had a status that counted; `updateRecordingText` when `actionItems` changed on a PUBLISHED
  call and only status fields (`done`/`evidence`) differ (text edits keep using the manual "Update
  recap" button, as today).
- `refreshDueRecaps({ limit = 5, now })` (same module), run at the start of the existing
  `/api/cron/followups` (every 10 min; no new cron entry): rows with `recapRefreshAt <= now` and
  `publishedAt` within `calls.recapRefreshMaxDays`; claim each with `updateMany where { id,
  recapRefreshAt: seen }` -> `null`; if `recapEditedAt` is within `calls.recapRefreshDelayMinutes`,
  push `recapRefreshAt` to `recapEditedAt + delay` instead (per-message rate limit). Then
  `repostRecap(id, { edit: true, ifChanged: true })`.
- `repostRecap` changes: optional `ifChanged` -> render, compare the hash with `recapRenderedHash`,
  skip the PATCH when equal (`'unchanged'`); on success store hash + `recapEditedAt`.
  `postCallRecap` stores the hash on first post. A Discord 404/403 (message deleted / no access)
  returns a new `'gone'` result: the sweep stops for that row. Any other failure reschedules
  +60 min once (only when `recapError` did not already start with `edit failed:`), so a broken
  message gets at most two automatic tries before a human looks at it. Every other non-`updated` result (`disabled`,
  `not-published`, `stale-redactions`, `excluded`, `imported`, `no-message`) just clears the marker.
- Telegram mirror: left as posted (no edits; the proxy has no edit path, and city groups get a
  one-time recap). Documented in the setting help.
- Manual "Update recap" button keeps working and now also includes status.

### 5. Length strategy (single editable message)

Recommended: keep ONE message and make the fitter in `buildRecapParts` degrade in a fixed,
config-driven order when status mode is on (status mode off = today's output byte for byte):

1. Everything: bullets, all items, the first link per item (the call page shows all links).
2. Drop summary bullets from the end, down to `calls.recapMinBullets` (default 3).
3. Drop links from the last item upward (the status emoji always stays).
4. Drop whole items from the end with `+N more on the call page`.
5. Existing safety nets.

Status markers replace the `- ` prefix, so they cost ~1 char per item; a link costs ~50-70. With 10
done items with links (+~600) dropping two 220-char bullets covers most of it.

Alternatives considered:
- Second message / thread for action items: two message ids to store and edit, ordering and noise
  in announcements, breaks the "one recap" Telegram mirror; rejected.
- Short redirect links (`pizzadao.org/go/<id>`, ~30 chars): saves ~30 chars per link but adds a
  redirect route (open-redirect review, click tracking questions); possible later.
- Shorter bullets when statuses exist (lower `recapBulletChars`): changes text the reviewer approved
  mid-life; dropping whole bullets is cleaner.
- Plain-URL links instead of masked: longer and uglier; rejected.

### 6. Settings (all DB, admin UI, registry tests)

| Key | Kind | Default | Notes |
|---|---|---|---|
| `calls.recapLiveStatusEnabled` | bool (registry.ts + toggles.ts, env kill `CALL_RECAP_LIVE_STATUS_ENABLED`) | **off** | Master: 🔄/🆘 from follow-ups, member links, auto edits, new fitter. Off = today's behaviour exactly. Turn on after the preview check. |
| `calls.recapMemberLinksEnabled` | bool | on | Show members' finished links (only when the master is on). |
| `calls.recapShowNeedsHelp` | bool | on | 🆘 publicly; off shows those items as 🔄. |
| `calls.recapRefreshDelayMinutes` | num (content-settings.ts) | 10 (1-120) | Debounce and min gap between edits of one message. |
| `calls.recapRefreshMaxDays` | num | 60 (1-365) | Older recaps are not auto-edited. |
| `calls.recapMinBullets` | num | 3 (0-10) | Bullets kept before links are dropped. |

## Migration (additive only)

`prisma/migrations/20261221090000_recap_action_status/migration.sql` (date after the newest,
20261220090000; confirm no newer one on main before naming):

```sql
-- Action-item status in call recaps. Additive: nullable columns and indexes only.
ALTER TABLE "FollowUp" ADD COLUMN "actionKey" VARCHAR(16), ADD COLUMN "doneUrl" VARCHAR(500), ADD COLUMN "doneUrlAt" TIMESTAMP(3), ADD COLUMN "doneUrlBy" TEXT;
CREATE INDEX "FollowUp_recordingId_actionKey_idx" ON "FollowUp"("recordingId", "actionKey");
ALTER TABLE "CallRecording" ADD COLUMN "recapRefreshAt" TIMESTAMP(3), ADD COLUMN "recapEditedAt" TIMESTAMP(3), ADD COLUMN "recapRenderedHash" VARCHAR(64);
CREATE INDEX "CallRecording_recapRefreshAt_idx" ON "CallRecording"("recapRefreshAt");
```

Matching fields in `prisma/schema.prisma` (FollowUp ~2031, CallRecording recap block ~1501, with
`@@index`es). The implementer must NOT run `prisma generate` into the shared node_modules from a
worktree; generate inside the worktree's own install, or rely on CI. Dry-run the migration
(`supabase`/prisma diff per repo practice) before merge.

## Files to change

New:
- `app/lib/calls/action-keys.ts` (+ `action-keys.test.ts`): `assignActionKeys`, `newActionKey`,
  `ensureActionKeys`.
- `app/lib/calls/action-status.ts` (+ test): `deriveActionViews`, `loadActionViews`.
- `app/lib/calls/recap-refresh.ts` (+ test): `requestRecapRefresh`, `refreshDueRecaps`.
- `app/admin/calls/CallFollowUpLinks.tsx` (+ test): link select, finished link, clear.
- migration folder above.

Changed:
- `prisma/schema.prisma`.
- `app/lib/calls/recap.ts`: `RecapInput.actionViews?`; `buildRecapParts` uses views when present
  (🔄/🆘/✅, first link, new fitter with `minBullets`); `RecapLimits.minBullets`; `renderRecap` loads
  views when the master toggle is on; `repostRecap` `ifChanged`, hash, `'unchanged'`/`'gone'`;
  `postCallRecap` stores hash; `RECAP_SELECT` += `recapRenderedHash`, `recapEditedAt`.
- `app/lib/calls/recordings.ts`: `assignActionKeys` in both writers; `stripDone` also strips `key`;
  refresh request on status-only changes of a published call.
- `app/api/admin/calls/[id]/summary/route.ts`: accept/validate `key`.
- `app/admin/calls/ReviewActions.tsx` (+ test): carry `key`; show derived follow-up state.
- `app/admin/calls/[id]/page.tsx`: load follow-ups for the panel; pass derived states.
- `app/calls/[id]/page.tsx`: render from `loadActionViews` (🔄/🆘 with aria labels, links).
- `app/lib/followups/extract.ts`: A-labels, `actionItem` field, `actionKey` on drafts.
- `app/lib/followups/draft.ts`: `ensureActionKeys` before extraction; pass key map; store `actionKey`.
- `app/lib/followups/actions.ts`: `setDoneUrl`; refresh request after status moves.
- `app/lib/followups/link-actions.ts`, `app/api/fu/[token]/route.ts`, `app/fu/[token]/page.tsx`,
  `app/fu/[token]/ActionForm.tsx`: optional URL on done; add-link after done.
- `app/lib/followups/buttons.ts`, `app/lib/discord-interactions/followups.ts`,
  `app/api/discord/interactions/route.ts` (deps): Add-link button + modal.
- `app/lib/followups/admin.ts`, `app/api/admin/followups/[id]/route.ts`: `linkFollowUp`; refresh on
  dismiss.
- `app/api/cron/followups/route.ts`: `refreshDueRecaps` first, own try/catch, in the JSON log.
- `app/lib/settings/registry.ts`, `toggles.ts`, `content-settings.ts` (+ their tests' default tables).
- `messages/en.json`, `fr.json`, `es.json`: `calls.actionInProgress`, `calls.actionNeedsHelp`,
  `followupAction.linkLabel/linkHelp/linkSaved/badUrl/addLinkTitle`, `adminCalls.followUpLinks*`.

## Phases (each its own PR, all behind the master toggle)

1. Keys + linking: schema/migration, `action-keys`, writers, PATCH key, extraction `actionItem`,
   `ensureActionKeys`, admin link panel. No visible change in posts.
2. Status + links render: `action-status`, recap fitter, public page, ReviewActions state,
   `doneUrl` (fu page, Discord add-link modal, admin), settings, i18n.
3. Live refresh: `recap-refresh`, hash/`ifChanged`/`gone` in repostRecap, hooks, cron step.

Phase 1+2 can ship together if small; 3 is the riskier one (automatic edits of public posts).

## Risks

- Auto-editing a public announcement: bounded by the master toggle (default off), post filter on
  every render (incl. links), no-op edits skipped by hash, per-message gap, age window, never
  posting new messages, `gone` stop.
- Public member links (spam / unsafe): http(s)-only validation, post filter, approver alert on each
  new link, admin clear, member-links toggle. Open question on a host allowlist.
- Status publicly reveals a member's DM button choice (🆘): `calls.recapShowNeedsHelp`.
- Key loss on heavy rewording or regeneration with new text: follow-up becomes unlinked (status
  disappears, nothing wrong is shown); admin relinks in the panel.
- Model mislinks a follow-up to the wrong item: wrong status could show; admin sees links in the
  panel; precedence makes admin `done` win.
- Race between member status and reviewer editor save: avoided by keeping member data in
  `FollowUp`, not the JSON.
- Length: real recaps are near 2000 chars; the fitter guarantees the limit (tests at the boundary,
  counting astral emoji as 2 code units, which is conservative).
- Extraction schema change: the `actionItem` field is nullable and parsed leniently, so an old or
  malformed model answer still drafts (null key).

## Verification

Unit tests (vitest, mocks per `app/lib/__mocks__/db.ts`, same style as `recap.test.ts`,
`phase2.test.ts`, `followups/*.test.ts`):
- `assignActionKeys`: keep valid key, reject forged key, text match, same-index fuzzy match,
  duplicate texts, reorder, new items; `stripDone` ignores keys.
- `deriveActionViews`: precedence table, multiple follow-ups, orphan keys, member links off,
  needs-help off, post-filtered link, link dedupe/max.
- `buildRecapParts`: toggle off = current snapshots unchanged; on: emoji per state; fitter order
  (bullets to floor, then links from the end, then items) at the 2000 boundary with a ~1977-char
  fixture; mentions still only for inserted ids; Telegram plain text unchanged in shape.
- `repostRecap`: `ifChanged` skip, hash stored, 404 -> `gone`.
- `requestRecapRefresh` / `refreshDueRecaps`: toggle off no-op, unposted no-op, debounce keeps the
  earliest time, claim race (count 0 skips), min gap reschedule, age window, never calls post.
- `parseExtraction` with `actionItem` labels (valid, unknown, missing); `storeDrafts` writes key.
- `applyMemberAction` triggers refresh; `setDoneUrl` owner/status/validation (`javascript:`,
  `data:`, spaces, >500, blocked term), alert slot.
- Discord interactions: add-link button and modal paths; `/api/fu` route with `url`.
- `linkFollowUp`: unknown key 400, any status allowed, events.
- Settings registry/toggles/content-settings default tables.
- `npm run lint`, `npx tsc --noEmit`, `npx vitest run`.

Vercel preview (no prod Discord; use a preview DB or a test channel):
1. Toggle off: publish a test call, recap identical to main.
2. Toggle on: a call with linked follow-ups; tap On it / Need help / Done (Discord DM) and the
   Telegram done page with a link; within ~10-20 min (or by calling the cron route with the cron
   secret) the same message shows 🔄/🆘/✅ and the link; no new message; Telegram group unchanged.
3. Tap twice quickly: one edit. Repost with no change: no PATCH (log `unchanged`).
4. Long recap fixture: message stays ≤2000, bullets trimmed to 3 before links drop.
5. `/calls/<id>` shows states and links (en/fr/es labels); `/admin/calls/<id>` panel links/unlinks
   and clears a link, and the recap follows.
6. `/mobile-check` on `/fu/<token>` with the new link field and on `/calls/<id>`.

## Open questions for Snax

1. Master toggle default off (recommended), then turn on after the preview check?
2. Show 🆘 publicly, or show needs-help items as 🔄 (setting exists either way; which default)?
3. Member links: shown immediately (with an approver alert) or only after an approver OK? Plan
   assumes immediately + alert + admin clear. Host allowlist wanted?
4. Should a reviewer's text edits on a published call also auto-edit the recap, or stay on the
   manual "Update recap" button (plan: manual)?
5. Should the call agenda (`call-agenda/rank.ts`, skips done items) also use the derived status?
   (Not in scope here.)
6. Run the backfill/link script for recent calls, and how far back?

## Decisions (owner, 2026-11-16)

1. Master switch `calls.recapLiveStatusEnabled` is OFF by default; it is verified on a preview, then the owner turns it on.
2. Needs-help items render publicly as the in-progress marker, never as a distinct help marker. There is no `calls.recapShowNeedsHelp` setting (dropped from the settings table above); `NEEDS_HELP` is treated like `IN_PROGRESS`.
3. Members' "finished" links show immediately (safe-URL check + post filter) with an approver alert. No host allowlist.
4. A reviewer's text edits on a published call keep using the manual "Update recap" button (no automatic edit for those). Only status changes (done / evidence links, follow-up answers, links) refresh the recap by themselves.
5. The call agenda is out of scope.
6. The backfill/link script (`scripts/calls/link-followups-to-actions.ts`) is dry-run by default, limited to calls since 2026-11-01 via `--since`, and `--apply` writes exactly the plan it prints. It is not run against production as part of this work.
7. Format change (all recaps, switch on or off): no em or en dashes in the recap text. Owner and suggester read `text (owner: O, suggested by B)`, `text (suggested and owned by O)`, `text (owner: O)`, `text (suggested by B)`; links follow as `text (...): [PR #12](<url>)`. The public call page uses the same wording.
