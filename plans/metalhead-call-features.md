# metalhead-call-features: welcomes, progress reports, easier vouching/levels, end-of-call song trigger

Four asks from a crew call, planned as separate shippable phases. Each phase is one PR, ships
dark behind a DB setting that defaults to **off** (settings registry `app/lib/settings/registry.ts`,
env kill switch via `app/lib/settings/toggles.ts` where the phase posts to Discord), and changes
nothing on deploy.

Recommended order: **A -> D -> C -> B** (A and D are small recorder changes with a shared
prerequisite; C is mostly app UX plus two slash commands; B has the most privacy surface).

---

## What exists today (investigation)

- **Metalhead** is the PizzaDAO Discord application (`DISCORD_BOT_TOKEN`). The recorder
  (`recorder/`, Railway, discord.js 14 + `@discordjs/voice` 0.19.2) holds the only gateway
  connection. Intents: Guilds, GuildVoiceStates, GuildScheduledEvents, plus GuildMessages and
  MessageContent when `CAPTURE_VOICE_CHAT` is on (default).
- **Slash commands are NOT served by the recorder.** The same application has an Interactions
  Endpoint URL set, so all interactions arrive over HTTP at `app/api/discord/interactions`
  (handler `app/lib/discord-interactions/handle.ts`, definitions `commands.ts`, registered by
  `scripts/discord/register-commands.mjs`, which PUTs the full list and so replaces it). Existing
  commands: the $PEP set plus `/missions` (deferred reply, shows your level). Any new command
  (`/progress`, `/vouch`, `/level`) goes here, not in `recorder/`.
- **Recording notice** (`recorder/src/consent.ts`):
  - `consentNotice()`: a red "This call is being recorded and transcribed" warning posted once
    when the session starts (`recorder.ts` around line 234). This notice or the REC nickname is
    required, or the recorder aborts and does not record. Keep that rule.
  - `lateJoinWelcome(userId)`: "Welcome to the call, @X!", sent to anyone who joins more than 5
    minutes (`REMINDER_AFTER_MS`) after the start, once per member per session
    (`ActiveSession.reminded`), from `onVoiceState`. One message per joiner, no batching, no call
    name, no recording reminder.
- **All crews share one call voice channel** (`discord.callVoiceChannelId` setting /
  `CALL_VOICE_CHANNEL_ID`). The call's identity comes from the Discord scheduled event
  (`SessionMeta.eventName`, `eventId`). The app maps event to crew with `resolveCrewForEvent`
  (`app/lib/calls/crew-map.ts`) over `getCrewMappings()`.
- **The recorder reads no DB settings.** Today it only POSTs to `/api/calls/recorder/ingest`
  (Bearer `RECORDER_API_KEY`). All its config is env (`recorder/src/config.ts`).
- **Last call's action items** already exist for the pre-call agenda (`app/lib/call-agenda/run.ts`):
  `previousActionItems(crewId)` (latest PUBLISHED call that has items, imported calls gated by
  `calls.importedAgendaContext`), `fetchOpenCrewTasksForCrew`, `buildAgendaBullets`, and the
  private editorial post filter `loadPostFilter` / `isCrewExcluded` / `mentionsBlockedTerm`
  (`app/lib/calls/post-filters.ts`, values in DB rows only). `FollowUp` rows (`recordingId`,
  `ownerName`, `ask`, `status` DRAFT..DONE) and `CrewTask` (`stage`, `due`, `doneAt`) give status.
- **Vouching:** `Vouch` model (table `Friendship`, unique follower+followee, `source`);
  `app/lib/vouches.ts` (`addVouch`, `removeVouch`, `getVouchCounts`, `isVouched`,
  `notifyVouchAdded`); `POST /api/vouches/add` (session, no self-vouch, target must exist, 409 on
  duplicate, then emits the `vouch_created` / `vouch_received` mission events for L5.2 / L4.2).
  The route has **no rate limit and no daily cap** today. Profile has a Vouch button
  (`app/ui/profile/ProfileActions.tsx` -> `app/ui/vouches/AddVouchButton.tsx`, with the disavow
  warning for eligible viewers via `/api/disavow/check`). The dashboard already has a next-action
  panel (`app/dashboard/[id]/lib/next-action.ts`, includes `get_vouches` when under 3 vouches).
  Missions/levels: `app/lib/missions.ts` (`getCurrentLevel`, `getLevelTitle`,
  `getUserProgressSummary`), `app/lib/missions-overview.ts` (used by `/missions`).
- **End-of-call song:** an Apps Script timer fires `fireEndOfCallSong` `callLength` after the
  announce and calls the separate **pizza-radio** bot's `/play-crew` (Bearer API style, its own
  bot user, so no voice-connection conflict with Metalhead). Discord events are rarely set
  COMPLETED (only when the next call starts), so `event-ended` is not a reliable signal on its own.

---

## Phase 0 (prerequisite for A and D): recorder reads its settings from the app

**Goal:** the recorder can honour DB settings without a direct DB connection.

- New route `app/api/calls/recorder/config/route.ts` (GET, Bearer `RECORDER_API_KEY`, same check
  as ingest). Returns only recorder-facing values: `{ welcome: {enabled, template, batchSeconds,
  remindRecording}, endSong: {enabled, minHumans}, crews: [{eventId, label}] }`. Uses
  `loadSettings()` and `toggleEnabled()` so the env kill switch and the "previews ignore saved
  rows" rule apply. No secrets in the response.
- `recorder/src/remote-config.ts`: fetch with a 5 s timeout at session start and every 5 min while
  live; cache the last good value; on failure use the last good value, or all-off defaults when
  there is none. Unit-test the fallback.
- Alternative considered: env vars on Railway only. Rejected (Snax prefers admin-editable config,
  and Railway redeploys to flip a switch).

## Phase A: welcoming join message (keeps the recording notice)

**Goal:** joining members get "Welcome @X to the Ops Crew call 🍕" with a short recording line,
instead of a warning-style notice.

Settings (area `calls`):
- `calls.welcomeEnabled` (bool, default off; toggle with env `CALL_WELCOME_ENABLED`). Off = today's
  behaviour exactly.
- `calls.welcomeTemplate` (text, max 300). Placeholders `{members}` and `{call}`. Default
  `Welcome {members} to the {call} 🍕`. Validation: must contain both placeholders.
- `calls.welcomeBatchSeconds` (int 5-120, default 20).
- `calls.recordingLine` (text, max 300): the short notice line appended to every welcome, default
  `🔴 This call is recorded and transcribed; audio stays private. Leave the call if you'd rather not be recorded.`
  Bound: cannot be empty (legal notice always present).

Changes:
1. `recorder/src/consent.ts`: add `welcomeOpening(callName)` (session start: a friendly header plus
   the full existing notice text, so the legal content is unchanged) and
   `welcomeBatch(template, userIds, callName, recordingLine)`. Keep `consentNotice()` for the off
   path. The start notice must still be posted before capture (`noticeOk` rule unchanged).
2. `recorder/src/recorder.ts`: when enabled, drop the 5-minute delay; queue each new human joiner
   (not bots, not already in `reminded`) and flush after `batchSeconds` as one message mentioning
   up to 20 members (overflow: "and N others"). `allowedMentions.users` = exactly those ids.
   Members already present at the start are welcomed in the opening message. Rejoins in the same
   session are skipped (once per member per call). Flush is cancelled on stop.
3. Call name: crew label from Phase 0 `crews` by `eventId`, else the event name, else "call".
   Strip mentions/markdown from the name.
4. Tests in `recorder/src/recorder.test.ts`: batching, once per member, bots skipped, off path
   identical to today, notice still sent first.

Risk: Discord rate limits on busy joins (batching handles it); legal wording. Confirm the final
`recordingLine` with Snax before turning it on.

## Phase B: progress report on request

**Goal:** during a call, someone asks for last week's action items and their status.

Recommended: slash command `/progress [crew]` served by the app (interactions are HTTP-only).

Settings: `calls.progressReportEnabled` (bool, default off; env `CALL_PROGRESS_ENABLED`),
`calls.progressMaxItems` (int 3-15, default 8), `calls.progressShowFollowups` (bool, default off).

Changes:
1. `commands.ts`: add `progress` with optional `crew` STRING option (autocomplete from crew
   mappings). Re-run `register-commands.mjs` (dry run first; it replaces the full list).
2. `app/lib/calls/progress-report.ts` (pure builder + loader):
   - Crew: the option, else the crew of the ACTIVE (or in-window) scheduled event in the call voice
     channel (reuse `fetchUpcomingEvents`-style REST fetch + `resolveCrewForEvent`), else ask the
     user to pick one.
   - Items: `previousActionItems(crewId)` (PUBLISHED only), plus the date of that call; status per
     item from matching `FollowUp` rows of that recording (DONE / IN_PROGRESS / NEEDS_HELP -> icon;
     never the DM text or replies), and open `CrewTask` rows with stage/due (overdue first, reuse
     `buildAgendaBullets` ranking).
   - Apply `loadPostFilter` exactly like the agenda: excluded crews get "no report"; blocked terms
     are dropped. A filter read failure means no report.
3. Handler: deferred reply (type 5) like `/missions`, then edit in a public message in the channel
   where it was asked; rate limit per channel (1 per 2 min, `checkKeyedRateLimit`).
4. Tests: builder (status mapping, filter, empty states), handler gating.

Alternatives:
- **Text mention** ("@Metalhead progress") in the call chat: the recorder already receives
  messages there; it would call a new app endpoint returning the same report. Add later if people
  prefer it; reuse the same builder.
- **Voice (TTS):** feasible but not now. The recorder already holds the voice connection, so it
  could play an `AudioResource` from a TTS mp3 (OpenAI/ElevenLabs/Deepgram Aura, roughly
  $0.01-0.05 per report). Costs: playing audio while recording means excluding the bot's own
  audio (already, bots are not recorded), consent/UX of a bot talking, ffmpeg/opus encoding in the
  Docker image. A wake phrase needs live streaming transcription (Deepgram live, about
  $0.0077/min per speaker stream, plus false triggers). Recommend: slash command now, revisit
  TTS reading of the slash-command result only if asked again.

Risk: exposing follow-up status publicly. Default `progressShowFollowups` off; only owner names
and status words, never message text.

## Phase C: vouching and levels made easier

Settings (area `discord`): `discord.vouchCommandEnabled`, `discord.levelCommandEnabled` (bool,
default off; with env kill switches), `vouches.dailyLimit` (int 1-50, default 10; new, applies to
web and Discord alike).

1. **Shared vouch service** `app/lib/vouches/give.ts`: `giveVouch({voucherDiscordId,
   targetMemberId, via})` holding the rules now inline in `/api/vouches/add` (voucher has a
   member profile, no self-vouch, target exists, duplicate -> already vouched, daily limit, mission
   events, notification). Refactor the route to call it (behaviour unchanged except the new limit,
   which is off-equivalent at its default only if confirmed; otherwise ship the limit with the
   command). Keep the disavow rule: Discord replies never reveal disavow status; if a disavow
   warning would show on the web, the command answers ephemerally "Please vouch from their
   profile" with a link (so eligible viewers see the warning there).
2. **`/vouch member:@user`**: ephemeral confirmation to the voucher; resolve target by Discord id
   (`findMemberByDiscordId`); target not a member -> invite link. Optional public line
   "@A vouched for @B 🍕" behind `discord.vouchAnnounce` (default off).
3. **`/level [member]`**: ephemeral; own level, title, missions done this level, the next mission
   with its link (reuse `getUserProgressSummary` / missions overview). For another member, show
   only what their public profile already shows (level and title); respect existing level-gated
   visibility (e.g. top levels shown as "MAX", review-only data never) and confirm with Snax which
   level 5+ details are member-only before shipping.
4. **Site UX:**
   - Profile: make the Vouch button the primary CTA for signed-in visitors who have not vouched;
     show "Vouched ✓" (with undo) after; for signed-out visitors keep "Sign in to vouch" with login
     return to the profile.
   - Dashboard: a level card (current level, title, progress bar of this level's missions, the
     next 1-2 missions with CTA) above or merged into `NextActionPanel`; when the next mission is a
     vouch mission, link to `/crew` member lists with a "Vouch" hint.
   - Copy via next-intl message files (all locales).
5. Tests: give-vouch service (all rules, limit), handler commands, dashboard card render.

## Phase D: end-of-call song triggered by the recorder

**Metalhead does not play the song itself.** It only calls the separate pizza-radio bot's
`/play-crew` endpoint when the call actually ends; pizza-radio joins, plays the crew's song and
leaves exactly as today.

Settings/env:
- `calls.endSongTriggerEnabled` (bool, default off; served via Phase 0 config).
- Railway env on the recorder: `PIZZA_RADIO_URL`, `PIZZA_RADIO_API_KEY` (secret, never in DB).
  Missing env = feature off, logged once.

Trigger:
- Fire on stop reasons `event-ended` and `max-duration`, and when the scheduled end time
  (`scheduledEndMs`, else start + crew `callLength`) passes with humans still in the channel.
  Skip on `empty` (nobody to hear it), `superseded`, `shutdown`, `disconnected`. Once per event
  occurrence (persist a marker in the session dir so a restart does not replay).
- Payload: the same parameters the Apps Script sends today (crew identifier for `/play-crew`);
  copy them from `fireEndOfCallSong`. 5 s timeout, one retry, fire-and-forget (never blocks
  finalize).
- Cutover: turn on the setting, verify one call, then disable the Apps Script timer (in the
  google-apps-scripts repo) to avoid a double play. Document the order in `recorder/README.md`.

Risk: pizza-radio's `@discordjs/voice` 0.18 vs DAVE (noted in calzone-call-recorder); if it can't
connect, this phase can't fix that.

---

## Files to change (summary)

- Phase 0: `app/api/calls/recorder/config/route.ts` (new), `recorder/src/remote-config.ts` (new),
  `recorder/src/index.ts`.
- A: `recorder/src/consent.ts`, `recorder/src/recorder.ts`, tests; registry + toggles entries.
- B: `app/lib/discord-interactions/commands.ts`, `handle.ts`, `app/api/discord/interactions/route.ts`,
  `app/lib/calls/progress-report.ts` (new), registry + toggles.
- C: `app/lib/vouches/give.ts` (new), `app/api/vouches/add/route.ts`, interactions files,
  `app/ui/profile/ProfileActions.tsx`, `app/ui/vouches/AddVouchButton.tsx`,
  `app/dashboard/[id]/...` (level card), `messages/*.json`, registry + toggles.
- D: `recorder/src/recorder.ts`, `recorder/src/config.ts`, `recorder/README.md`, registry.
- Every new setting: `registry.test.ts` default lock, admin settings page picks it up.

## Verification

- `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (app); `cd recorder && npm run typecheck && npm test`.
- Vercel preview: admin settings page shows the new keys (off); `/api/calls/recorder/config`
  returns 401 without the key and all-off with it (previews ignore saved rows); profile and
  dashboard UX (C) on desktop and mobile (`/mobile-check`).
- Slash commands: register to a test guild or dry-run the registration script first; check
  `/progress`, `/vouch`, `/level` answer "not enabled" while off.
- Recorder (A, D): deploy to Railway with settings off (no change), then turn on for one crew call
  and watch logs; for D confirm one song plays and the Apps Script timer is disabled afterwards.
