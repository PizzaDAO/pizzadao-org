# basil-44996 — Call Recording + AI Processing (transcripts, summaries, decisions, action items)

**Task ID:** basil-44996
**Priority:** P2
**Status:** Approved, MVP scope below (Snax, 2026-10-14)
**Date:** 2026-10-11

---

## ⭐ Decisions & approved MVP scope (overrides the sections below where they conflict)

Snax's answers:
1. **Community Call only.** It's ~4 calls/month, ~1h each. No per-crew opt-in yet (`CrewRecordingSetting` is deferred).
2. **Consent = we announce it.** Add a notice line to the `/announce` Community Call message. Opt-out (`RecordingOptOut` + `/me` toggle) is deferred.
3. **Visibility:** summaries are PUBLIC; transcripts are for logged-in members only; raw audio is admin-only.
4. **Cost has to match ~4 call-hours a month.** Expect a few dollars a month. **The X stream is an acceptable source**, since the Community Call is also streamed on X.
5. **Use OpenAI (ChatGPT), not Claude**, for both transcription and analysis. `OPENAI_API_KEY` already exists in `.env.example`. Do not add `@anthropic-ai/sdk`.
6. **Auto-publish.** There's no DRAFT review gate. Admins can still edit, unpublish, re-run and delete afterwards.

### MVP (single PR)
- **Capture is source-agnostic.** An admin uploads the replay from wherever it is: an X stream/Space download, a Craig file, or OBS. That can be audio or video, as one mixed file. There's no recorder bot and no X API scraping in the MVP.
- **Audio extraction happens in the browser.** Use ffmpeg.wasm to turn the upload into mono low-bitrate audio (e.g. 16 kHz mono Opus/MP3 at ~24–32 kbps, ≈ 11–14 MB/h) before uploading. Prior art: `C:\code\clipper-ffmpeg-wasm`. This keeps us under OpenAI's 25 MB transcription file limit with no server-side ffmpeg. If a file is still over the limit, split it into time chunks in the browser, upload each one, and transcribe them sequentially with time offsets.
- **Storage:** private Vercel Blob through client upload (`handleUpload`). A retention cron deletes the audio after 30 days.
- **Transcription:** OpenAI. Prefer a diarizing model (e.g. `gpt-4o-transcribe-diarize`, so check the current model list in OpenAI's docs). Fall back to `gpt-4o-transcribe` / `whisper-1` with no speaker labels. Make the model configurable with `OPENAI_TRANSCRIBE_MODEL`.
- **Analysis:** an OpenAI chat/responses model with JSON-schema structured output. It's configurable with `OPENAI_ANALYSIS_MODEL`; default to a current, cost-efficient GPT model and verify the name against OpenAI's docs. Same output schema as §4: tldr, summary, topics, decisions, action items, open questions, quotes, speaker mapping. Map speakers using the Community Call attendee list from `CallAttendance` for that date.
- **Pipeline:** upload → `POST /api/recordings` → transcribe → analyze → **PUBLISHED**. Use `after()` plus `maxDuration = 300`, with a lightweight sweeper cron for stuck jobs. A 1h call fits in one request.
- **DB:** `CallRecording`, `CallRecordingTrack` (a single track is fine), `CallTranscriptSegment`, `CallSummary` (default status PUBLISHED) and `CallActionItem`. Skip `RecordingOptOut`, `CrewRecordingSetting` and full-text search for now.
- **UI:**
  - an admin upload page/dialog
  - a call detail page `/calls/community_call/[date]`, with the summary public and the transcript visible to logged-in members
  - a 🎙 badge plus TL;DR on `/calls`
  - admin controls to edit, re-run, unpublish and delete
- **Defer to later PRs:** Discord recap post, action-item notifications, profile sections, search, digest, the recorder bot, attendance from recordings, and crew calls.

---

## 0. What the repo already has (research findings)

### Where calls happen: Discord voice channels
- **Crew calls** run in Discord voice channels. The crew `channel` field from the Crew Mappings sheet is a Discord channel mention (`app/lib/crew-mappings.ts:269-317`, `CrewOption.channel` / `event` / `callTime` / `callTimeUrl` / `callLength`). Schedules are free text ("Mondays 3pm ET"), parsed by `app/lib/crew-schedule.ts::parseCallTime`.
- **Community Call** is fired from `/announce` (`app/lib/announce/run.ts`), which calls the Apps Script "SecretService" (`app/lib/announce/secret-service.ts`) to start the Discord scheduled event, tweet, and take voice attendance.
- **Attendance** comes from Apps Script polling the voice channel every 10 min for an hour; one daily Google Sheet per call.
- No Google Meet or Zoom usage anywhere. Recording targets **Discord voice**.

### Attendance pipeline
- `prisma/schema.prisma:574-614`: `CallAttendance` (`discordId`, `displayName`, `crewId`, `crewLabel`, `callDate`, `dailySheetId`; unique `[discordId, dailySheetId]`), `AttendanceSummary` (PK `discordId`, unique `memberId`, `crewBreakdown`, `recentCalls`), `AttendanceSyncLog`.
- Ingest: `app/lib/attendance.ts::syncAllCrewAttendance()`, nightly via `app/api/cron/attendance/route.ts` and admin-triggered `app/api/attendance/sync/route.ts`. Feeds missions via `emitMissionEventMany(..., 'attendance_synced')`, so attendance affects PEP rewards.
- **A "call" has no table.** It's the group `(crewId, callDate::date)` over `CallAttendance` (`app/api/calls/route.ts`, `app/api/calls/[crewId]/[date]/route.ts`, UI `app/calls/page.tsx`).
- `discordId -> memberId` via `AttendanceSummary.memberId` or `app/lib/member-utils.ts`.
- "Present but AFK" attendance farmers are a known problem (`scripts/flag-attendance-farmers.mjs`, `plans/attendance-data-quality.md`).

### Existing call notes
- Historical notes are Google Docs from `#call-notes`, handled only by one-off scripts writing to `debug/` (`scripts/fetch-meeting-docs.mjs`, `parse-gdoc-text-attendance.mjs`, `analyze-unparsed-docs.mjs`, `analyze-call-notes.mjs`).
- **No notes, transcripts or summaries in the DB today.**
- Crew **agendas** are read live from crew sheets (`app/api/crew/[crewId]/route.ts::parseAgenda`, `callInfo`) and are useful LLM context.

### Discord bot
- HTTP-only: `app/lib/discord-rest.ts`, `app/lib/discord.ts`, interactions endpoint `app/api/discord/interactions/route.ts` → `app/lib/discord-interactions/{commands,handle}.ts`, registered by `scripts/discord/register-commands.mjs`.
- **No gateway, discord.js, or voice code.**

### LLM usage
- **None in production.** `@anthropic-ai/sdk` not installed. `.env.example` has a stale `OPENAI_API_KEY` note. This is the first LLM integration.

### Infrastructure
- **DB is Neon Postgres, not Supabase** (`app/lib/db.ts` uses `PrismaNeon`). CLAUDE.md is stale on this.
- **Blob:** `@vercel/blob` 2.3.3 already used (`app/lib/blob-image-upload.ts`, `app/api/suggestions/upload/route.ts`); supports `access: 'private'` and client uploads (needed — function bodies cap ~4.5 MB).
- **Crons** (`vercel.json`): reuse `isCronAuthorized` (`app/lib/cron-auth.ts`), `maxDuration = 300` + `after()`, `VerifierRun`-style leases, `MissionSlaDigest`-style at-most-once guards.
- **Auth:** `app/lib/auth-guards.ts` (`requireSession`, `requireAdmin`, `requireAnyRole`, `safeEqual`).
- **Notifications:** `Notification` model + `NotificationType` enum, `app/lib/notifications.ts`.
- **i18n:** `messages/{en,es,fr}.json`.
- **Weekly digest** (`plans/arugula-50138-weekly-digest.md`, deferred) is a natural consumer of call summaries.

---

## 1. Feature description

PizzaDAO runs ~a dozen weekly crew calls plus the Sunday Community Call, all in Discord voice. Today only **who was present** is captured. What was said, decided, or assigned is lost.

The feature:
1. Records calls, with consent.
2. Transcribes them, attributing speech to members.
3. Uses Claude to produce a summary, decisions, action items (owners mapped to members), topics, and notable quotes.
4. Stores it all in Postgres.
5. Shows it on crew pages, `/calls`, member profiles, and later the weekly digest and Discord recaps.

Near-free attendance upgrades: exact join/leave times, and a "spoke on the call" signal for farmer detection.

---

## 2. Recording capture options

| Option | How | Per-speaker audio | Automation | Ops cost | Verdict |
|---|---|---|---|---|---|
| **A. Craig bot (craig.chat)** | Host `/join`s Craig; downloads zip; uploads to app | **Yes** (one file per user, by username) | Manual; no official API; links expire ~7 days | Free (Patreon tiers) | **MVP choice** |
| **B. Self-hosted recorder bot** (discord.js + `@discordjs/voice` w/ DAVE E2EE support) on Fly.io/Railway/VPS | Joins at schedule or `/record start`; per-user OGG/Opus → Vercel Blob → webhook | **Yes, keyed by discordId** | Fully automatic; logs exact join/leave | ~$5–10/mo + maintenance; voice-receive is unofficial | **Phase 3 target** |
| C. Host records locally (OBS/Audacity) | One mixed track | No (needs diarization) | Manual | Free | Fallback |
| D. Meet / Zoom | Native cloud recording | Zoom paid only | API | Paid | Not applicable |

**Recommendation:** Phase 1 = Craig + manual upload (mixed-file fallback). Phase 3 = self-hosted recorder bot reusing the existing Discord application.

- Vercel can't hold a voice connection → separate long-running process.
- `/record start|stop` handled by the existing HTTP interactions endpoint, which writes a `CallRecording` (`REQUESTED`) and pings the recorder (`RECORDER_URL` + `RECORDER_SHARED_SECRET`).
- Auto-join: recorder polls `GET /api/recordings/schedule`.

**Per-speaker tracks are the key quality lever:** exact attribution without diarization, easy opt-out, and silence trimming cuts billable minutes.

---

## 3. Consent and privacy

1. **Which calls:** per-crew opt-in (`recordingEnabled`, default off). Community Call on once approved; public crew calls if the lead opts in; private/leadership/HR-type calls never. No silent auto-record until the announcement period has passed.
2. **Notice:** pinned notice in recorded crews' channels + #announcements; a line in the `/announce` Community Call message (`app/lib/announce/message.ts`); recorder posts "🔴 Recording started" and sets nickname "🔴 Recording" (Craig does this already).
3. **Opt-out:** `/record optout` + `/me` toggle (`RecordingOptOut` by discordId). Opted-out tracks dropped before transcription; in mixed mode, segments redacted and excluded from quotes. Host can mark "off the record" ranges; LLM also treats the phrase as a redaction cue (best effort — document that).
4. **Retention:** raw audio in private Blob, deleted 30 days after processing by a daily cron; admin-only. Transcripts kept, members-only. Summaries kept; visibility PUBLIC for Community Call, MEMBERS default for crews.
5. **Access:** PUBLIC summaries → anyone. Transcripts + MEMBERS summaries → logged-in. Edit/publish/re-run/delete → admins + crew leads. Raw audio → admins only, via a proxy route (blob URL never exposed). Members can request deletion of their segments.
6. **Review gate:** AI output is DRAFT until a lead/admin publishes it.

---

## 4. Pipeline

```
[Craig tracks / mixed file / recorder bot per-user OGG]
   │  browser → @vercel/blob/client private upload (/api/recordings/upload)
   │  recorder → put() then POST /api/recordings/ingest (HMAC)
   ▼
CallRecording (UPLOADED) + CallRecordingTrack[]
   │  POST /api/recordings/[id]/process, or automatic on ingest
   ▼
Transcription (async, webhook-driven, per track)
   │  → /api/recordings/webhooks/transcription
   ▼
CallTranscriptSegment[]  → status TRANSCRIBED → after(() => runAnalysis(id))
   ▼
Claude analysis (claude-sonnet-5-5, structured outputs)
   │  input: merged transcript + crew + agenda + attendees
   ▼
CallSummary + CallActionItem[] (DRAFT)
   ▼
Lead/admin review → PUBLISHED → Discord recap + owner notifications
```

**Orchestration:** idempotent steps keyed on `CallRecording.status`; sweeper cron `/api/cron/recordings` (every 15 min or hourly) with `VerifierRun`-style leases picks up stuck jobs; analysis route `maxDuration = 300`.

### Transcription providers (re-verify prices at implementation)

| Provider | ~$/audio hour | Diarization | URL + webhook | Notes |
|---|---|---|---|---|
| **Deepgram Nova-3** | ~$0.26–0.46 | Yes | Yes | Fast; keyterm prompting |
| **AssemblyAI Universal** | ~$0.15–0.40 | Yes, strong | Yes | Good for mixed audio; custom vocab |
| OpenAI gpt-4o-transcribe / Whisper | ~$0.18–0.36 | Limited | No; 25 MB limit | Chunking awkward on serverless |
| Groq Whisper large-v3-turbo | ~$0.04 | No | Sync | Cheapest; fine with per-speaker tracks |

**Recommendation:** Deepgram or AssemblyAI behind an adapter (`app/lib/recordings/transcribe.ts`). Diarization off for per-speaker tracks. Provider fetches private blobs via short-lived signed URL or HMAC-signed proxy route (confirm what `@vercel/blob` 2.x supports).

### Claude processing
- **Model:** `claude-sonnet-5-5` default; `claude-opus-5-5` as on-demand "re-run with higher quality". Set `output_config.effort` (start `medium`); enable server-side refusal fallback; check `stop_reason` before parsing.
- **SDK:** add `@anthropic-ai/sdk`; stream + `.finalMessage()`.
- **No chunking needed:** 1h ≈ 18–22k tokens with labels; 3h ≈ 70k. Guard: >400k tokens → split by hour + merge pass.
- **Prompt:** (1) cached system prompt — role, output rules, redaction rules, PizzaDAO glossary; (2) crew, date, agenda (factor `parseAgenda` into `app/lib/crew-agenda.ts`), attendee list; (3) transcript as `[mm:ss] Name: text`.
- **Structured output:** `tldr`, `summary`, `topics[]`, `decisions[]`, `actionItems[]` (owner discordId or name, dueHint, startSec), `openQuestions[]`, `notableQuotes[]`, `speakerMapping[]` (mixed mode), `agendaCoverage[]`.
- **Speaker mapping:** deterministic for per-track; LLM-proposed + lead-confirmed for mixed.
- **Post-processing:** resolve owners → memberId; fuzzy-match names against attendees.

---

## 5. Database changes

Migration `prisma/migrations/20261013000000_call_recordings/`, models in a `// ===== CALL RECORDINGS =====` section next to `CallAttendance`.

```prisma
enum CallRecordingStatus { REQUESTED RECORDING UPLOADED TRANSCRIBING TRANSCRIBED ANALYZING READY FAILED DELETED }
enum CallVisibility { PUBLIC MEMBERS ADMINS }
enum CallSummaryStatus { DRAFT PUBLISHED }
enum ActionItemStatus { OPEN DONE DROPPED }

model CallRecording {
  id            String   @id @default(cuid())
  crewId        String                 // same slug as CallAttendance.crewId
  crewLabel     String
  callDate      DateTime               // UTC midnight; joins CallAttendance on (crewId, callDate::date)
  startedAt     DateTime?
  endedAt       DateTime?
  durationSec   Int?
  source        String                 // craig | recorder_bot | upload_mixed
  voiceChannelId String?
  status        CallRecordingStatus @default(UPLOADED)
  visibility    CallVisibility @default(MEMBERS)
  error         String?
  transcriptionProvider String?
  costCents     Int?
  leaseUntil    DateTime?
  createdById   String                 // discordId
  audioDeletedAt DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  tracks        CallRecordingTrack[]
  segments      CallTranscriptSegment[]
  summary       CallSummary?
  actionItems   CallActionItem[]
  @@unique([crewId, callDate, source])
  @@index([crewId, callDate])
  @@index([status])
}

model CallRecordingTrack {
  id           String @id @default(cuid())
  recordingId  String
  recording    CallRecording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  discordId    String?          // null for mixed track
  displayName  String?
  blobPathname String           // private blob pathname, never a public URL
  bytes        Int
  durationSec  Int?
  offsetMs     Int  @default(0)
  speakingSec  Int?
  providerJobId String?
  status       String  @default("pending") // pending|submitted|done|failed|skipped_optout
  @@index([recordingId])
}

model CallTranscriptSegment {
  id          Int    @id @default(autoincrement())
  recordingId String
  recording   CallRecording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  startMs     Int
  endMs       Int
  speakerLabel String
  discordId   String?
  text        String
  redacted    Boolean @default(false)
  @@index([recordingId, startMs])
  @@index([discordId])
}
// FTS: raw SQL in migration — generated tsvector column "tsv" + GIN index; query via $queryRaw.

model CallSummary {
  recordingId String @id
  recording   CallRecording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  status      CallSummaryStatus @default(DRAFT)
  model       String
  tldr        String
  summaryMd   String
  topics      Json
  decisions   Json
  openQuestions Json
  quotes      Json
  agendaCoverage Json?
  speakerMapping Json?
  inputTokens Int?
  outputTokens Int?
  publishedById String?
  publishedAt DateTime?
  discordMessageId String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model CallActionItem {
  id            String @id @default(cuid())
  recordingId   String
  recording     CallRecording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  crewId        String
  text          String
  ownerDiscordId String?
  ownerMemberId  String?
  ownerName      String?
  dueHint       String?
  startSec      Int?
  status        ActionItemStatus @default(OPEN)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([ownerDiscordId, status])
  @@index([crewId, status])
}

model RecordingOptOut {
  discordId String @id
  createdAt DateTime @default(now())
}

model CrewRecordingSetting {
  crewId          String @id
  enabled         Boolean @default(false)
  autoRecord      Boolean @default(false)
  defaultVisibility CallVisibility @default(MEMBERS)
  voiceChannelId  String?
  updatedById     String
  updatedAt       DateTime @updatedAt
}
```

- Add `CALL_ACTION_ITEM`, `CALL_RECAP_PUBLISHED` to `NotificationType`.
- No FK to `CallAttendance`; join on `(crewId, callDate::date)`.

**Recordings feeding attendance (Phase 3 only):** recorder logs exact voice join/leave. **Risk:** double-counting with Apps Script rows inflates mission/PEP eligibility. Mitigation: `CallAttendance.source` column, write recorder rows only when no sheet rows exist (or `COUNT(DISTINCT discordId)` everywhere); long-term retire the poll for recorded calls. `speakingSec` is informational until Snax decides otherwise.

---

## 6. App surfaces

1. **`/calls`** — 🎙 badge, TL;DR, "Has recap" filter; expanded row shows summary/decisions/action items.
2. **New `/calls/[crewId]/[date]`** — summary, decisions, action items (owner avatars → `/profile/[memberId]`), topic chapters, searchable transcript; admin audio player; lead/admin controls (publish, edit, re-run Sonnet/Opus, fix speakers, redact, delete).
3. **Crew page** (`app/crew/[crewId]/CrewPageClient.tsx`) — "Last call" card near Agenda; lead-only "Upload recording".
4. **Profile** — open action items, "Calls you spoke on"; `/me` opt-out toggle.
5. **Notifications** to action-item owners on publish.
6. **Discord recap** on publish via `postDiscordMessage` (split for 2000-char limit), store `discordMessageId`.
7. **Weekly digest** — "Calls this week" + "Your open action items".
8. **Search** — `GET /api/calls/search?q=` (Postgres FTS, logged-in); Phase 4 "Ask the archive".
9. **Permissions**

| Content | Who | Mechanism |
|---|---|---|
| PUBLIC summary | Anyone | — |
| MEMBERS summary + transcripts | Logged-in | `requireSession` |
| Edit / publish / re-run / upload / delete | Admin or crew lead | `canManageCrewCalls()` in `app/lib/recordings/access.ts` (roster "0. Lead"/"1. Capo"), modelled on `app/lib/mission-review-access.ts` |
| Raw audio | Admin | `requireAdmin` |

---

## 7. Rough cost per call-hour (re-check prices)

| Item | Cost/hour |
|---|---|
| Blob storage (30 days) | < $0.01 |
| Transcription (Deepgram/AssemblyAI; per-speaker bills only speech) | **$0.15–0.50** |
| Claude Sonnet 5.5 analysis (~25k in, ~6k out) | **≈ $0.11** |
| Optional Opus 5.5 re-run | ≈ $0.22 |
| Search Q&A (Phase 4) | ≈ $0.03/query |
| Recorder bot host (Phase 3) | $5–10/mo flat |

**≈ $0.30–0.65 per call-hour → ~$20–40/month** at ~15 one-hour calls/week, plus bot host. Batch API and prompt caching not worth it for MVP.

---

## 8. Phasing

### Phase 1 — MVP: manual upload → transcript + summary (~1–1.5 weeks)
- Lead/admin uploads Craig tracks (multi-file upload of the extracted zip, filenames mapped to members by matching attendees, confirmed in UI) or a single mixed file.
- Private Blob → transcription → Sonnet analysis → DRAFT → publish → call detail page, crew "Last call" card, `/calls` badge.
- Per-crew opt-in, opt-out table + `/me` toggle, 30-day audio retention cron.

### Phase 2 — Distribution (~1 week)
- Discord recap on publish, owner notifications, action items on profiles, FTS search, digest section, action-item status updates.

### Phase 3 — Automation (~2 weeks + ops)
- Recorder bot (`services/recorder/`, Fly.io), `/record start|stop|optout`, auto-join via `/api/recordings/schedule`, precise attendance with dedup + `speakingSec`, `/announce` triggers recorder.

### Phase 4 — Nice to have
- "Ask the archive" Q&A; backfill old Google Docs notes into `CallSummary` (`source: "gdoc"`); per-crew decision log; agenda coverage; es/fr summaries.

---

## 9. Files to create / modify

**Create**
- `app/lib/recordings/{types,access,storage,transcribe,merge,analyze,pipeline,recap}.ts`
- `app/lib/crew-agenda.ts` (factored out of `app/api/crew/[crewId]/route.ts`)
- `app/api/recordings/upload/route.ts` (`handleUpload`, private, audio types, size cap)
- `app/api/recordings/route.ts`, `[id]/route.ts`, `[id]/process/route.ts`, `[id]/audio/[trackId]/route.ts`
- `app/api/recordings/webhooks/transcription/route.ts`
- `app/api/recordings/ingest/route.ts`, `schedule/route.ts` (Phase 3)
- `app/api/cron/recordings/route.ts`, `app/api/cron/recordings-retention/route.ts`
- `app/api/calls/search/route.ts`, `app/api/action-items/[id]/route.ts` (Phase 2)
- `app/calls/[crewId]/[date]/page.tsx` + `CallDetailClient.tsx`
- `app/ui/calls/{CallRecapCard,TranscriptView,UploadRecordingDialog,ActionItemList}.tsx`
- `prisma/migrations/20261013000000_call_recordings/migration.sql`
- Vitest tests next to each lib + route tests modelled on `app/api/cron/cron-routes.test.ts`
- Phase 3: `services/recorder/` (discord.js, `@discordjs/voice` w/ DAVE, `prism-media`, Dockerfile, `fly.toml`)

**Modify**
- `prisma/schema.prisma`; `package.json` (`@anthropic-ai/sdk`; provider via `fetch`)
- `.env.example`, `DEPLOYMENT.md`, `architecture.md`, `CLAUDE.md` (env vars: `ANTHROPIC_API_KEY`, `CALL_AI_MODEL`, `DEEPGRAM_API_KEY`/`ASSEMBLYAI_API_KEY`, `TRANSCRIPTION_WEBHOOK_SECRET`, `RECORDER_SHARED_SECRET`, `RECORDER_URL`; fix stale OpenAI + Supabase notes)
- `vercel.json` (two new crons)
- `app/api/calls/route.ts`, `app/api/calls/[crewId]/[date]/route.ts`, `app/calls/page.tsx`
- `app/crew/[crewId]/CrewPageClient.tsx`, `app/api/crew/[crewId]/route.ts`
- `app/profile/[id]/ProfileClient.tsx`, `app/ui/attendance-card.tsx`, `app/me/...`
- `app/lib/notifications.ts`
- `app/lib/discord-interactions/{commands,handle}.ts`, `scripts/discord/register-commands.mjs`
- `app/lib/announce/message.ts`, `app/lib/announce/run.ts` (Phase 3)
- `messages/{en,es,fr}.json`
- `plans/arugula-50138-weekly-digest.md` (dependency note)

---

## 10. Step-by-step (Phases 1–2)

1. **Schema** — models/enums + migration with raw tsvector/GIN; migrate against a Neon branch using `DATABASE_URL_UNPOOLED`.
2. **Access helpers** — `canManageCrewCalls`, `canViewCall`; unit tests.
3. **Storage + upload** — `handleUpload` with `onBeforeGenerateToken` access check, content types, size cap, pathname `recordings/<crewId>/<date>/`, `access: 'private'`; `UploadRecordingDialog` with filename → member mapping.
4. **Create recording** — `POST /api/recordings` → `CallRecording` + tracks → `startTranscription` in `after()`.
5. **Transcription adapter** — submit signed URL + webhook; webhook verifies secret, writes segments; when all tracks done, `merge.ts` orders segments, applies opt-outs, computes `speakingSec`, sets `TRANSCRIBED`.
6. **Analysis** — prompt build, Sonnet structured output, Zod validation, owner resolution, write DRAFT summary + action items, record tokens/cost, `READY`; refusal/parse failure → `FAILED` shown in UI.
7. **Sweeper cron** — leases, re-poll stuck jobs, max 3 retries.
8. **Retention cron** — delete track blobs > 30 days, set `audioDeletedAt`.
9. **Read APIs + UI** — detail page, `/calls` updates, crew card, i18n.
10. **Review + publish** — PATCH edits, speaker remap, redaction, visibility, publish; Phase 2: recap + notifications.
11. **Phase 2 extras** — search, action-item status, profile sections, digest hook.
12. **Docs + env.**

---

## 11. Verification

- **Unit:** merge interleaving with offsets + opt-out; access matrix; analyze with mocked SDK (schema, owners, refusal); pipeline transitions + leases; webhook secret 401; upload denial for non-leads.
- **Route tests:** new crons return 401 without `CRON_SECRET`.
- **E2E on preview + Neon branch:**
  1. 10–15 min Craig test call (2–3 people) → segments have correct discordIds.
  2. Summary has real decisions/action items; owners link to profiles.
  3. Opted-out tester's track skipped, absent from quotes.
  4. Mixed file → diarization + speaker-mapping UI works.
  5. Logged out: MEMBERS hidden, PUBLIC summary only; non-admin 403 on audio.
  6. Retention cron with short TTL deletes blobs.
  7. `costCents`/tokens match estimates (~$0.1 LLM/hour).
  8. Phase 2: recap posts to a test channel; notifications appear.
- **Regression:** `/calls` counts unchanged for unrecorded calls; `npm run build`, `npm run lint`, `npm run test:run` pass.
- **Phase 3:** `/record start` works, ingest HMAC enforced, attendance dedup keeps counts unchanged.

---

## 12. Open questions for Snax

1. **Which calls get recorded?** Community Call only to start, or opted-in crews too? Any off-limits?
2. **Consent model.** Announce + opt-out, or explicit per-member opt-in (GDPR)? Who writes/approves the notice?
3. **Visibility.** Community Call summaries public on the open web? Transcripts ever public?
4. **Retention.** 30 days of raw audio OK? Permanent Community Call audio (podcast feed)? Transcripts forever?
5. **Review gate.** Human review before every publish, or auto-publish the Community Call?
6. **Capture path.** Is Craig OK as a third party? Budget + owner for a self-hosted recorder bot (~$5–10/mo)?
7. **Transcription vendor + budget.** Deepgram vs AssemblyAI; ~$20–40/mo OK; spending cap?
8. **Anthropic account.** Which org/API key; Sonnet 5.5 default with Opus 5.5 on demand OK?
9. **Attendance.** Should recorder attendance replace the 10-min poll? Should speaking time ever affect missions/PEP/farmer flags?
10. **Action items.** Write back to crew Google Sheet tasks, or app-only? Discord DMs or in-app notifications only?
11. **Discord recaps.** Auto-post on publish? Which channel for Community Call recaps?
12. **Historical backfill** of old Google Docs notes — worth it?
13. **Crew-lead definition.** Roster "0. Lead"/"1. Capo", or a Discord role?
