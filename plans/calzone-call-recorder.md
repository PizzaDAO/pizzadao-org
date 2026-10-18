# calzone: Call recorder bot (join, record, transcribe, summarize, publish calls)

**Status:** Plan v1 (2026-10-18). Waiting on Snax's decisions at the bottom.
**Ask (Snax):** "We also want the bot to join community calls and listen to them, record them,
process them, and post them on the website."

## Goal

When a recorded call's Discord scheduled event goes ACTIVE, a recorder bot joins the voice
channel and announces that it is recording. It captures one audio track per speaker and leaves
when the call ends. It then uploads the audio, transcribes it with speaker names, and has Claude
write a summary, action items and chapters. The call appears on pizzadao.org under `/calls/<id>`
with an audio player, summary and transcript, linked from the crew page. The recorder's
join/leave log can also become the attendance source that parmesan-10386 (the attendance NFT)
mints from.

## Research findings

### How calls run today (PizzaDAO/google-apps-scripts, public repo)

- **One voice channel for everything.** `Comms/config.js` and `CommunityCallHosting/attendance.js`
  hard-code `VOICE_CHANNEL_ID = "823956905739026442"`. Both the Community Call and the crew calls
  happen in this Discord voice channel. Nothing uses Google Meet.
- **Scheduling.** `SecretService/SchedulerService.gs` runs `dailyScheduleSetup()` at 5am ET. It
  reads the Crew Mappings sheet (`19itGq86…`, `callTime`, `callLength`, `type`, `event` columns)
  and creates a time trigger for each crew meeting that day. `fireScheduledAnnouncement` then
  runs one of two flows:
  - `handleCommunityAnnounce_` (`CommunityCallService.gs`, for `type == community`):
    1. Ends any active Discord event, then starts the mapping's scheduled event via the bot
       (`/end-active-events` and `/start-event-by-id`).
    2. Tweets cell B5 of the Community Call sheet `1S7WGjHp…` (the call hosting guide).
    3. Sends Telegram cell B7.
    4. Posts the GENERAL webhook cell B10.
    5. Posts cell B11 to the voice channel's text chat via the bot's `/send-message`.
    6. Takes attendance.
  - Crew calls follow the same pattern in `handleAnnounce_`.
  - After `callLength`, `fireEndOfCallSong` asks pizza-radio's `/play-crew` to play the crew's
    theme song in the voice channel.
  - In this repo, `app/lib/announce/run.ts` now posts the Community Call Discord message itself
    and calls SecretService for the event, tweet and attendance.
- **Discord scheduled events.** Each crew's event ID comes from the Crew Mappings `event` column
  (`CrewOption.event` in `app/lib/crew-mappings.ts`). The bot's `DEFAULT_EVENT_ID`
  `1394003497153724497` is probably the Community Call event.
  - Events are started by the bot but never explicitly completed. The only "end" is
    `endActiveEventsIfNeeded_`, which runs when the *next* call starts. **So an event going
    COMPLETED is not a reliable stop signal on its own.**
- **Attendance today.** The flow is a poll:
  1. `recordAttendanceToMaster()` / `takeAttendanceTodayMerge_` + `startAttendanceBurst_` call
     the bot's `GET /voice-attendance?channelId=…` once, then every 10 minutes for about an hour
     (`ATTENDANCE_BURST_RUNS = 6`).
  2. Each poll's members are appended to a per-day public Google Sheet (Timestamp, Name, Discord
     ID, Joined, Left, Notes). The Joined/Left columns are always empty.
  3. That sheet is linked from the crew sheet's "Attendance" tab.
  4. `app/lib/attendance.ts` `syncAllCrewAttendance()` (nightly `/api/cron/attendance`) loads
     the sheets into `CallAttendance` (unique `(discordId, dailySheetId)`,
     `crewId = "community_call"` for the Community Call) and `AttendanceSyncLog`.
  5. `/calls` (`app/calls/page.tsx`, `app/api/calls/route.ts`, `app/api/calls/[crewId]/[date]`)
     lists calls grouped by crew and date, with attendees.
- **What gets posted after a call.** Nothing beyond the end-of-call song. The X, Telegram and
  Discord posts all happen *before* the call. There are no notes, recording or recap anywhere.
- **Security note (fix independently).** `CREW_TRACKING.md` in the **public** google-apps-scripts
  repo contains a plaintext "API Key (same for all crews)". Rotate it and remove it from git
  history.

### Existing bots (Railway)

- **PizzaDAO/pizzadao-discord-bot** (`index.js`, about 300 lines, Express and discord.js 14).
  - Intents: Guilds, GuildVoiceStates, GuildMembers. It has no voice connection.
  - Endpoints (all `Bearer API_KEY`): `/health`, `/voice-attendance`, `/get-active-event`,
    `/end-active-events`, `/start-event-by-id`, `/send-message`.
  - It also renames new joiners to "Pizza Trainee".
  - Announcements depend on it.
- **PizzaDAO/pizza-radio** (discord.js 14, `@discordjs/voice` **0.18**, `@discordjs/opus`,
  `ffmpeg-static`, `@aws-sdk/client-s3` to sync songs from **Cloudflare R2**).
  - Its `Dockerfile` is `node:18-bookworm-slim` plus the python3/make/g++ build tools for native
    opus.
  - It joins `VOICE_CHANNEL_ID` when it becomes ready (`src/bot.js`). `/play-crew` joins, plays
    and leaves (`src/api.js`).
  - Reusable for us: the `joinVoiceChannel` + `entersState(Ready)` pattern, the R2 S3 client, the
    Dockerfile and the Bearer API style.
  - Caveat: 0.18 predates DAVE (below), so check that radio still connects at all since Discord
    enforced DAVE.

### This app

- There is no gateway connection on Vercel. Discord is handled through REST
  (`app/lib/discord-rest.ts`), interactions (`app/api/discord/interactions`) and Vercel crons.
- Reusable: `prisma` (Neon), `requireAdmin` (`app/lib/auth-guards.ts`), `isCronAuthorized`
  (`app/lib/cron-auth.ts`), `@vercel/blob`, `getCrewMappings()`, `createNotification`, the
  next-intl `callsPage` namespace, and the crew page `app/crew/[crewId]/CrewPageClient.tsx`.
- There is no AI SDK yet (`ai` / `@ai-sdk/*` are not in `package.json`).
- **Overlap with parmesan-10386.** That plan mints a per-call NFT to `CallAttendance` rows for
  `community_call` after the nightly sync, using `affectedDiscordIds`. The recorder sees exact
  join and leave times from `voiceStateUpdate`, which is better than 10-minute polls: it records
  minutes present and resists drive-by joins. Phase 4 below makes the recorder write
  `CallAttendance` directly and call the same downstream hooks (mission/summary rebuild, NFT
  enqueue). Parmesan needs no changes beyond reading the same table.

### Discord voice receive and DAVE (verified Oct 2026)

- Discord **requires DAVE end-to-end encryption on voice channels**. Enforcement started
  March 1, 2026, and the rollout finished in about May 2026. Stage channels are excluded. Bots
  must speak DAVE to join, and must decrypt with MLS keys to receive.
- **discord.js `@discordjs/voice` ≥ 0.19** supports DAVE through `@snazzah/davey`, the only
  supported DAVE library.
  - Receive was broken in 0.19.0 (issue #11419: decrypt failures and reconnect loops). It was
    fixed by PR #11449 in March 2026, and current is 0.19.2 with davey 0.1.12.
  - **Open bug #11653 (Oct 8, 2026):** if the bot joins while someone is *already speaking*
    (an MLS welcome at transition 0), that user's packets can fail to decrypt and never recover.
    It is a one-line truthiness bug in `DAVESession.decrypt` (`lastTransitionId` 0 is falsy).
  - Mitigations:
    - Join at event start, before people talk.
    - Pin the version and apply a `patch-package` fix for #11653.
    - Watch per-user decrypt failures. If they persist, drop and rejoin the voice connection
      (a rejoin forms a fresh group).
- **py-cord** (Python) has recording sinks, but its own docs warn that "recording may not work as
  expected" under DAVE. It is no better, and everything else we have is JS.
- **Choice: TypeScript, discord.js 14 + `@discordjs/voice` 0.19.2 (pinned) +
  `@snazzah/davey` + `@discordjs/opus` + `prism-media` + ffmpeg.**
  - Per-user Opus streams (`receiver.subscribe(userId)`) give perfect speaker attribution without
    diarization.
- Fallback if receive proves unreliable in the spike: host calls in a **Stage channel**, which is
  not DAVE-encrypted (it changes the call format). As a last resort, use Craig (a third-party
  recording bot), but that path is manual and not automatable.

## Architecture

```
Discord voice channel 823956905739026442
   │  (gateway + voice, DAVE)
   ▼
Railway service "call-recorder"  (new repo PizzaDAO/pizzadao-call-recorder, same Railway project)
   - own Discord application "PizzaDAO Recorder" (visible name = consent signal)
   - listens guildScheduledEventUpdate → ACTIVE: join; COMPLETED/CANCELED: stop
   - per-speaker Opus → Ogg segments on a Railway volume (crash-safe), join/leave log
   - on stop: ffmpeg mixdown (m4a) + per-speaker speech-only tracks → R2
   - transcribe per speaker (Deepgram Nova-3) → merge by timestamp
   - POST /api/calls/recorder/ingest  (Bearer CALL_RECORDER_SECRET)
   ▼
pizzadao.org (Vercel)
   - GET  /api/calls/recorder/config   → which events/crews to record, channel, opt-outs
   - POST /api/calls/recorder/ingest   → upsert CallRecording + participants + transcript
   - summarize with Claude via AI Gateway (after() / admin "regenerate")
   - admin review → publish → /calls/[id] public page; audio via 302 to presigned R2 URL
```

**New repo, not an extension of pizzadao-discord-bot.**
- Voice receive pulls in native dependencies (opus, davey) and ffmpeg, and uses more memory
  during a call. A DAVE bug or an out-of-memory crash must not take down event starting,
  `/send-message` and the attendance polls that announcements rely on today.
- It also needs a separate Discord application, so the member list shows "PizzaDAO Recorder"
  (honest and visible). One bot user can hold only one voice connection per guild, and radio
  already uses its own.
- Rejected: a `services/recorder/` folder inside pizzadao-org. It would mean shared types, but it
  mixes native Node service dependencies, tsconfig, eslint and vitest scope into the Next app.
  Every other bot here is its own repo.
- The ingest contract is defined by a zod schema on the app side (`app/lib/calls/ingest-schema.ts`)
  and copied into the recorder repo.

**Hosting: Railway** (Snax's call), as a separate service in the same project as the existing bot.
- 1 replica, a 5 GB volume mounted at `/data`, and a Dockerfile based on radio's, upgraded to
  `node:22-bookworm-slim` with `apt install ffmpeg`.
- The health endpoint is `/health`. The restart policy is ON_FAILURE.

**Storage: Cloudflare R2, not Vercel Blob.**
- A one-hour mixed m4a (AAC 48 kbps mono) is about 21 MB, and the speech-only tracks add about
  20 MB. Weekly calls come to about 2 GB a year; every crew call would be about 15 GB a year.
- R2 costs $0.015/GB-month with **free egress**. Audio playback is egress-heavy, which makes Blob
  ($0.023/GB storage plus transfer) the worse fit.
- Radio already has an R2 account and the S3 client pattern.
- Bucket `pizzadao-calls` is private. Keys:
  - `calls/<recordingId>/mix.m4a`
  - `calls/<recordingId>/tracks/<discordId>.ogg`
  - `calls/<recordingId>/manifest.json`
- The app serves `GET /api/calls/[id]/audio` as a 302 to a 1-hour presigned GET URL. R2 handles
  Range requests for seeking. That needs no custom domain, since R2 custom domains require the
  zone to be on Cloudflare, and keeps unpublished audio private.
- Postgres stores the transcript, summary and metadata.

**Processing split.**
- The worker does everything that needs long runtime or ffmpeg: mixdown, speech-only track
  building and transcription. These have no Vercel timeout risk.
- The app does summarization, which is one Claude call in about 30–90 s. It runs from
  `after()` on ingest with `maxDuration = 300`, and can be re-run from admin.

## Recorder behavior (worker)

1. **Config.** On boot and every 10 minutes, the worker fetches `GET /api/calls/recorder/config`:
   - `{ targets: [{ eventId, crewId, crewLabel, channelId, maxMinutes }], optOutDiscordIds: [] }`
   - `targets` is built in the app from `getCrewMappings()` for crews with an `event` ID whose
     crew ID is in `CALL_RECORDING_CREWS` (default `community_call`).
   - `maxMinutes` is `callLength` × 1.5, capped at 180.
2. **Start.**
   - The worker listens for `guildScheduledEventUpdate` (adds intent `GuildScheduledEvents`). A
     move to Active with an ID in `targets` starts a recording.
   - On boot it also checks for an already-Active target event, which covers restarts mid-call.
   - Manual fallback: guild slash commands `/record start` and `/record stop`, limited to a host
     role ID from env, for unscheduled calls.
3. **Join.**
   - Joins with `selfDeaf: false, selfMute: true` and waits for `entersState(Ready, 20s)`.
   - Sets its nickname to `PizzaDAO Recorder (REC)`.
4. **Consent notice** (see the Consent section).
5. **Capture.**
   - On `receiver.speaking` start for a non-bot, non-opted-out user, it calls
     `subscribe(userId, { end: AfterSilence 1000ms })`.
   - Opus packets are piped through `prism.opus.OggLogicalBitstream` into
     `/data/<sessionId>/<userId>/<offsetMs>.ogg`.
   - `manifest.jsonl` gets `{userId, startMs, endMs, file}` per utterance and `{join|leave,
     userId, displayName, atMs}` from `voiceStateUpdate`.
   - Bots (radio's end-of-call song) are ignored.
6. **Stop**, on whichever comes first:
   - The event moves to Completed or Canceled.
   - No non-bot humans have been in the channel for 5 minutes.
   - `maxMinutes` is reached.
   - `/record stop`.
   - Another target event goes Active (the next call): stop the current one, then start the new
     one.
7. **Crash safety.**
   - The session directory lives on the volume. On boot, an unfinished session with no
     `uploaded` marker is finalized and uploaded with whatever audio was captured.
   - Ingest is idempotent on `sessionId`.
8. **Post-process** (in a queue, one job at a time):
   1. Mixdown: `ffmpeg` with `adelay` per utterance, `amix`, `loudnorm`, then AAC 48k mono m4a
      with `+faststart`.
   2. Speech-only per-user track: concatenate that user's utterances plus an offset map.
   3. Transcribe each speaker's speech-only track with Deepgram Nova-3: `smart_format`,
      `utterances`, `language=multi` (some calls are es/fr).
   4. Remap word timestamps to call time, then merge all speakers into turns sorted by start
      time (a new turn when the speaker changes or after a gap of 1.5 s or more).
   5. Upload to R2, then POST ingest with recording metadata, participants (join/leave, present
      seconds, spoke seconds) and transcript segments `{discordId, startMs, endMs, text}`.
   6. Retry ingest with backoff. Delete local files after a 200 plus 7 days.
9. **DAVE guardrails.**
   - Pin `@discordjs/voice@0.19.2` and `@snazzah/davey`, and `patch-package` the #11653 fix.
   - Log `generateDependencyReport()` at boot.
   - Count decrypt errors per user. If one user exceeds 50 in a row, rejoin the connection once.
   - If audio for a user stays empty, mark the recording `partial` instead of failing.

## Consent (concrete)

- **Visible identity.** A separate bot named "PizzaDAO Recorder" with the nickname
  `PizzaDAO Recorder (REC)`, sitting in the channel for the whole recording.
- **Announcement in the channel.** On start, the bot posts to the voice channel's text chat
  (`channel.send`):
  > "This call is being recorded and transcribed. The recording, transcript and an AI summary
  > may be posted on pizzadao.org/calls. Don't want your voice recorded? Run `/record optout`
  > (your audio is never captured) or just stay muted. Questions: ask the host."
  It re-posts a one-line reminder whenever someone joins after the first 5 minutes, at most once
  per user per call.
- **Event text.** Snax adds "This call is recorded" to the description of each recorded Discord
  event (a one-time manual edit). The B11 voice template in the Community Call sheet can mention
  it too.
- **Opt-out.**
  - `/record optout` and `/record optin` (ephemeral replies) store the choice in
    `CallRecordingOptOut` through the app API.
  - The worker never subscribes to an opted-out user's audio, so nothing is captured. That
    user's lines simply don't appear in the transcript.
  - They still appear in attendance, which is join/leave only.
  - Opting out takes effect immediately for live sessions, because the worker gets
    `POST /optout-changed` from the app, or polls.
- **Takedown.** An admin can unpublish a call or delete a speaker's audio and lines from it. That
  re-runs the mixdown and transcript from the stored tracks, minus that person.

## Publish flow (recommendation: admin review, then publish)

- Ingest creates the recording as `review`. A Discord notification and an admin notification go
  to a "calls review" role or channel.
- `/admin/calls` lists recordings with a player, transcript, editable title, summary and action
  items, plus Publish, Unpublish, Regenerate summary and Remove speaker.
- **Recommended: admin review for v1.** AI summaries of open community calls can misattribute
  statements, include personal information said out loud, or surface something sensitive.
- Optional switch `CALL_AUTO_PUBLISH_HOURS=48`: auto-publish if nobody acted within 48 hours.
  Default is off.

## Data model (additive migration `20261018000000_call_recordings`)

```prisma
model CallRecording {
  id             String   @id @default(cuid())
  sessionId      String   @unique            // worker idempotency key
  crewId         String                      // "community_call", "ops", …
  crewLabel      String
  discordEventId String?
  channelId      String
  startedAt      DateTime
  endedAt        DateTime?
  durationSec    Int?
  status         String   @default("recording") // recording|processing|review|published|failed|removed
  partial        Boolean  @default(false)
  title          String?
  summary        String?                     // markdown
  actionItems    Json?                       // [{text, ownerDiscordId?}]
  chapters       Json?                       // [{startMs, title}]
  audioKey       String?                     // R2 key of mix.m4a
  audioBytes     Int?
  tracksPrefix   String?                     // private R2 prefix
  summaryModel   String?
  transcriptProvider String?
  error          String?
  publishedAt    DateTime?
  publishedBy    String?                     // admin memberId
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  participants   CallRecordingParticipant[]
  transcript     CallTranscript?
  @@index([status, startedAt])
  @@index([crewId, startedAt])
}

model CallRecordingParticipant {
  id            Int      @id @default(autoincrement())
  recordingId   String
  discordId     String
  displayName   String?
  firstJoinedAt DateTime
  lastLeftAt    DateTime?
  presentSec    Int
  spokeSec      Int      @default(0)
  optedOut      Boolean  @default(false)
  recording     CallRecording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
  @@unique([recordingId, discordId])
  @@index([discordId])
}

model CallTranscript {               // kept separate so list queries stay light
  recordingId String   @id
  segments    Json                   // [{discordId, displayName, startMs, endMs, text}]
  language    String?
  recording   CallRecording @relation(fields: [recordingId], references: [id], onDelete: Cascade)
}

model CallRecordingOptOut {
  discordId String   @id
  createdAt DateTime @default(now())
}
```

- The migration is additive only: four new tables and no changes to existing ones.
- **Apply it to production before merging**, because previews share the prod DB:
  1. Run `npx prisma migrate deploy` against a Neon branch.
  2. Run it against prod with `DATABASE_URL_UNPOOLED`.
  3. Merge.
- Phase 4 attendance needs no schema change. It writes `CallAttendance` rows with
  `dailySheetId = "rec:<recordingId>"`, which satisfies the existing unique constraint.

## Phased implementation

### Phase 0: DAVE receive spike (1–2 days, gate for everything else)

- In the new repo: a minimal bot that joins channel 823956905739026442 on `/record start`,
  writes per-user Ogg files, and leaves on `/record stop`.
- Run it on Railway during a real Community Call **and** in a test where people are already
  talking when it joins (#11653).
- Exit criteria:
  - Every speaker audible.
  - Fewer than 1% decrypt failures.
  - No reconnect loop.
- If it fails, decide between the Stage-channel option and waiting for an upstream fix. Stop
  there.

### Phase 1: auto-record to R2 and an admin-only list (first shippable slice)

- **Recorder repo:**
  - Event ACTIVE/COMPLETED triggers, empty-channel and max-duration stops, consent message and
    nickname, opt-out list from config.
  - Volume-backed sessions, mixdown, R2 upload, ingest POST.
  - No transcription yet.
- **App:**
  - Migration.
  - `app/lib/calls/recordings.ts` (queries, state transitions).
  - `app/lib/calls/ingest-schema.ts` (zod).
  - `app/lib/calls/r2.ts` (S3 client and presign; adds `@aws-sdk/client-s3` and
    `@aws-sdk/s3-request-presigner`).
  - Routes:
    - `app/api/calls/recorder/config/route.ts`
    - `app/api/calls/recorder/ingest/route.ts`
    - `app/api/calls/recorder/optout/route.ts` (Bearer `CALL_RECORDER_SECRET`, timing-safe
      compare like `cron-auth`)
    - `app/api/calls/[id]/audio/route.ts` (published, or admin only)
  - `app/admin/calls/page.tsx`: a list with the player, plus Publish and Remove.
- Ships value right away: recordings exist and admins can share them.

### Phase 2: transcript, summary and public pages

- **Worker:** speech-only tracks, Deepgram transcription and merge; send `transcript` in ingest.
- **App:**
  - `app/lib/calls/summarize.ts` uses the AI SDK (`ai`) through the **Vercel AI Gateway**:
    - Model `anthropic/claude-sonnet-5-5`. `CALL_SUMMARY_MODEL` can override it with
      `anthropic/claude-opus-5-5`.
    - It calls `generateObject` with a zod schema `{title, summary, actionItems[], chapters[]}`.
    - Input is the speaker-labelled transcript as `[mm:ss] Name: text`.
    - The prompt says: no claims not in the transcript; attribute only to the named speaker;
      write in the call's language and give an English title.
  - It runs in `after()` from ingest, plus an admin "Regenerate" button. Status goes
    `processing` → `review`.
  - Public `app/calls/[id]/page.tsx` (a server component, so it has metadata and OG tags):
    - Title, date, crew and duration.
    - An `<audio>` player with chapter jump links.
    - Summary and action items.
    - The transcript, with speaker names linked to `/profile/<memberId>` when they map, and
      timestamps that seek the player.
  - Admin editing of title, summary and action items. Review notification through
    `createNotification` and a Discord post.
  - i18n keys in `messages/{en,es,fr}.json` under `callsPage.recording.*`. AI content stays in
    the call's language.

### Phase 3: website integration

- `/calls`: add a "Recordings" filter chip, and a "Listen" badge on calls with a published
  recording (join on crewId plus date). `app/api/calls/route.ts` adds `recordingId` to each row.
- Crew page (`CrewPageClient.tsx`): a "Recent recordings" section (the last 3 published for the
  crew). Community Call recordings show on `/calls` and the dashboard.
- `sitemap.ts`: add published recordings.
- Optional: after publish, post "Recording + summary: <link>" to the voice channel chat and
  GENERAL.

### Phase 4: recorder becomes the attendance source (overlap with parmesan-10386)

- On ingest, upsert `CallAttendance` for participants with `presentSec ≥ CALL_ATTENDANCE_MIN_SEC`
  (default 600), using `dailySheetId = "rec:<recordingId>"` and `callDate = startedAt`.
- Run the same post-sync hooks as `syncAllCrewAttendance` (summary rebuild, mission hooks and
  parmesan's NFT enqueue), so NFT delivery happens minutes after the call instead of the next
  morning.
- **Avoid double counting:**
  - For recorded crews, turn off the Apps Script attendance burst (a small SecretService change:
    skip `takeAttendanceTodayMerge_` / `startAttendanceBurst_` when the crew is recorder-tracked).
  - Or have `/api/calls` count `DISTINCT discordId` per crew and date. Do both.

## Env vars and secrets

| Where | Name | Notes |
|---|---|---|
| Railway recorder | `DISCORD_RECORDER_TOKEN`, `DISCORD_GUILD_ID`, `RECORD_HOST_ROLE_ID` | new Discord app "PizzaDAO Recorder"; perms: View Channel, Connect, Send Messages, Change Nickname, Use Application Commands |
| Railway recorder | `APP_BASE_URL` (`https://pizzadao.org`), `CALL_RECORDER_SECRET` | ingest/config auth |
| Railway recorder | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | token scoped to `pizzadao-calls` only (read/write) |
| Railway recorder | `DEEPGRAM_API_KEY` | phase 2 |
| Vercel (prod) | `CALL_RECORDER_SECRET`, `R2_*` (read-only token is enough), `CALL_RECORDING_CREWS` (`community_call`), `CALL_SUMMARY_MODEL`, `CALL_AUTO_PUBLISH_HOURS` (unset) | AI Gateway uses Vercel OIDC on Vercel, no key needed |

- Previews should point at a separate `pizzadao-calls-preview` bucket. The recorder only ingests
  to prod.

## Costs (per one-hour call, and monthly)

- **Transcription:**
  - Deepgram Nova-3 batch is about $0.0043/min. Speech-only tracks total about the call length,
    which is **about $0.26 a call**. Transcribing full-length per-user tracks instead would be
    N× that.
  - Alternatives: gpt-4o-transcribe (about $0.006/min, possibly more accurate, $0.36) or
    gpt-4o-mini-transcribe ($0.003/min).
- **Summary:**
  - A one-hour transcript is about 12–15k input tokens plus about 1.5k output. Sonnet 5.5 is
    **about $0.05–0.10**; Opus 5.5 is about $0.15–0.25.
  - Verify current AI Gateway prices.
- **R2:** about 40 MB a call. Weekly calls cost cents a year and egress is free. All crew calls
  would be under $5 a year.
- **Railway:** an idle gateway bot (about 150–250 MB RAM) plus short ffmpeg bursts plus a 5 GB
  volume is **about $3–8 a month** on usage pricing (verify against the current plan).
- **Total:** about $0.35 a call, plus about $5 a month fixed. Recording every crew call (about
  10 a week) adds about $15 a month.

## Risks

- **DAVE receive fragility.** This is the biggest risk. Mitigations: Phase 0 gate, pinned and
  patched versions, join before talk, auto-rejoin, `partial` flag, and the Stage-channel
  fallback. Watch #11653 and upstream releases. Treat a `@discordjs/voice` bump as a tested
  change.
- **Unclear end signals.** Events are never explicitly completed today, so empty-channel and
  max-duration stops are the real stops. Another risk is a long-running ACTIVE event: if the
  bot restarts it would rejoin. Fix: ignore events that have been ACTIVE for more than
  `maxMinutes`.
- **Privacy and legal.** Recording consent laws vary (some US states and the EU require
  all-party consent). Mitigated by the visible bot, the announcement, the event text, opt-out
  with no capture, admin review and takedown. Snax should be comfortable with the wording.
- **AI misattribution or hallucination.** Admin review, a "summary generated by AI" label, and
  the transcript shown next to the summary.
- **Pizza-radio in the channel.** Its bot audio is ignored. Also check radio still works at all
  on voice 0.18 now that DAVE is enforced.
- **Railway restarts mid-call.** The volume and resume-on-boot lose only the restart window.
- **Shared prod DB.** The migration must be applied before merge. Ingest is idempotent.
- **Native build** (opus, davey prebuilt binaries) on Debian slim: use radio's build-tools layer.

## Testing

- **App (vitest):**
  - Ingest schema validation and idempotency (same `sessionId` twice).
  - Auth: no or wrong Bearer gives 401, with a timing-safe compare.
  - State transitions (review → published → removed).
  - Config builder from mocked crew mappings, honoring `CALL_RECORDING_CREWS`.
  - Audio route: published gives 302; unpublished from a non-admin gives 404.
  - The summarize prompt builder and output schema, with the AI SDK mocked.
  - Phase 4: CallAttendance upsert, the `presentSec` threshold, and `/api/calls` distinct counts.
  - Use the existing `app/lib/__mocks__/db.ts`.
- **Worker (vitest in its repo):**
  - Manifest to mixdown/ffmpeg arg builder.
  - Speech-only offset remapping.
  - Turn merging across speakers.
  - Stop-condition state machine (fake timers).
  - Opt-out filtering.
  - Bot filtering.
- **Manual / staging:**
  - A private test voice channel plus a test scheduled event mapped through env, run with three
    people (one opted out, one joining mid-call, one already talking at join).
  - Check the R2 objects, the ingest row, and that the opted-out user has no audio.
- **Vercel preview:**
  - `/admin/calls` shows the seeded recording; the player seeks via Range (check the 206 in the
    network tab).
  - `/calls/[id]` renders in en/es/fr, has OG metadata, and the transcript timestamps seek the
    player.
  - `/calls` shows the Listen badge; the crew page shows recent recordings.
  - Mobile check through `/mobile-check`.
  - Run `npm run build`, `npm run lint` and `npx vitest run`.

## Decisions for Snax

1. **Which calls to record:** Community Call only (recommended for v1), or all crew calls? This
   changes cost, review load and consent scope.
2. **Publish flow:** admin review before posting (recommended), or auto-publish? If review, who
   reviews: the admin role, or a specific "calls" role?
3. **Public audio, or transcript and summary only?** Publishing the raw voice is the most
   sensitive part. A middle option is summary and transcript public, audio for logged-in members
   only.
4. **Attendance source:** should the recorder replace the Apps Script 10-minute polls for
   recorded calls (Phase 4, feeds parmesan NFTs the same day)? What is the minimum minutes
   present to count (10 suggested)?
5. **Setup only Snax can do:**
   - Create the "PizzaDAO Recorder" Discord app and invite it.
   - Create the R2 bucket and scoped tokens (on radio's Cloudflare account?).
   - Get a Deepgram account and key.
   - Add the Railway service to the existing project.
   - Approve the consent wording.

## Decisions (Snax, 2026-10-18) — these override anything above

1. **Bot identity:** reuse the existing PizzaDAO bot (the pizzadao-discord-bot token on Railway), not a new "PizzaDAO Recorder" app. The recorder is still its own Railway service/process, logging in with the same token. While recording it sets its own server nickname to "PizzaDAO Bot 🔴 REC" and restores it afterwards, and posts the recording notice in the voice channel's text chat.
2. **Scope:** record **all crew calls** (every call in the shared voice channel), not just the Community Call. Map each recording to its crew via the Discord scheduled event that is ACTIVE when recording starts (event name/ID → crew, using the same mapping the Apps Script scheduler uses).
3. **Review:** recordings are reviewed on app.pizzadao.org by members with the **Dread Pizza Roberts** Discord role (reuse the role check used for L8 mission review in app/api/missions/review/route.ts). Only they can see `/admin/calls`, edit the summary, remove a speaker, and publish/unpublish.
4. **Public output:** publish **only the summary and transcript** (plus title, chapters, action items). **Audio is never public**; keep it private in R2 for reviewers only (signed URLs on the review page) and delete it after a retention window (default 90 days, env-configurable).
5. **Attendance:** the recorder does **not** do attendance. Drop Phase 4; the Apps Script `/voice-attendance` polling stays the attendance source for parmesan-10386.
6. **Repo:** put the worker in this repo under `recorder/` (its own package.json + Dockerfile; Railway root directory = `recorder/`), so the ingest API, schema, and worker change together. Migration timestamp must sort after 20261018100000_trainee_welcome.
