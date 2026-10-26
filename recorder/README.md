# PizzaDAO call recorder

A small Node service (discord.js 14 + `@discordjs/voice` 0.19.2 with DAVE) that records the crew calls held in the shared voice channel. Plan: `plans/calzone-call-recorder.md` (see "Decisions (Snax, 2026-10-18)": same bot token, all crew calls, Dread Pizza Roberts review, audio never public, no attendance).

## What it does

1. Logs in with the PizzaDAO bot token (`DISCORD_BOT_TOKEN`) and watches guild scheduled events. Intents: Guilds, GuildVoiceStates, GuildScheduledEvents (nothing else).
2. A recording starts only through the **schedule window** (event status is not a trigger: the scheduler sets events ACTIVE ~15 minutes early, which would swallow the previous crew's call). Needed: a human (bots do not count) is in the call channel (`CALL_VOICE_CHANNEL_ID`, default `823956905739026442`) and an event in that channel (SCHEDULED or ACTIVE) has a start window covering now. The window opens 15 minutes before the scheduled start and closes at the scheduled end; with no scheduled end it closes at the earlier of the next event's scheduled start in the channel and start + 90 minutes (a running session is never cut by this). Checked on every voice-state change of a human in the channel (the bot's own is ignored), once a minute, and at boot (so a call in progress is picked up after a restart). Idle: the in-window event whose slot has already begun wins (latest scheduled start <= now, ties by id); if none has begun, the closest upcoming one. An ACTIVE event whose scheduled start has passed (less than `MAX_CALL_MINUTES` ago) also counts as in-window for starting, even after the normal close, so a late manual Start or a restart mid-call resumes recording; ACTIVE before the scheduled start is not enough by itself. People in the channel outside every window are never recorded. Known limitation: people arriving early (in the 15-minute lead window) are briefly filed under the previous slot's event, until the next slot starts. Within an open window, humans present and no running session always start a recording, even after an earlier empty/max-duration stop (a split recording beats a lost one).
   After a failed start (could not join, no indicator) or a fatal stop (e.g. disconnected), the same event occurrence (id + scheduled start) is not retried for 5 minutes, and is given up on after 3 failures (logged once). A session that ran 3+ minutes clears its failure count, and entries for events whose window has closed are dropped. Normal empty/max-duration stops are not affected.
   Starting a recording:
   - joins the channel (not deafened, self-muted);
   - keeps its own name and adds the red mark to its server nickname (e.g. `Metalhead 🔴 REC`; built from the current nickname, else the global name or username, truncated to Discord's 32 characters without ever cutting the mark). The old nickname is saved to disk and restored exactly afterwards, even after a crash;
   - posts the recording notice in the voice channel's text chat.
   - Only then does it start capturing audio (order: join, nickname, notice, capture). If neither the nickname nor the notice can be shown it leaves without recording and deletes the session folder.
3. Records one Ogg/Opus stream per speaker, written to `DATA_DIR/<sessionId>/seg/<userId>/` as it goes. Bots are skipped. There is no opt-out (Snax, 2026-10-25): everyone in the call channel is recorded and transcribed, and any old opt-outs are ignored. The channel notice says so and asks people who don't want to be recorded not to join (or to leave). Reviewers can still hide a speaker's lines from a public transcript on /admin/calls.
4. Stops on the first of: no humans in the channel for 5 minutes (not before any human has been present until the event's scheduled start + 15 minutes, so a session started early on an empty channel survives until people arrive), `MAX_CALL_MINUTES` (default 120, counted from the later of the session start and the event's scheduled start). COMPLETED/CANCELED never ends a session (a COMPLETED/CANCELED event only cannot start one); a session ends by empty grace, max duration, a forward switch or shutdown. Switching to another event happens only through the schedule window and is forward-only at that event's scheduled start: an event that starts later than the current one takes over once its slot has begun (back-to-back crew calls share the channel). An early ACTIVE flag never cuts a call. Provisional rule: a session started in the lead window, before its own slot began, may switch to an in-window event whose slot is actually running; once its slot has begun it never switches backward.
5. On stop: ffmpeg builds one aligned Opus track per speaker and one mono m4a mix; everything is uploaded to the private R2 bucket under `calls/<sessionId>/`; the app's ingest API is called with the metadata (event, channel, times, speakers with Discord ids, display names, talk time, R2 keys). The nickname is restored.
6. `GET /health` (200 once Discord is ready) for Railway.

If the app cannot be reached when a call ends, the session stays on the volume and is retried every 10 minutes. A 401/403/404 from the ingest API is treated as a misconfiguration (wrong `RECORDER_API_KEY`, route not deployed): logged loudly and retried, never discarded. Only a payload the app rejects as invalid (other 4xx) is dropped; its R2 objects are left in place (a row might reference them) and logged for a human to check. After a successful ingest the worker uploads first, then deletes only the objects under `calls/<sessionId>/` that the stored row does not reference (leftovers of earlier attempts). The app returns the row's keys in the ingest response for this.

Resilience: auto-rejoin on disconnect (backoff, 5 tries); sessions live on the volume, so on boot any session without an `uploaded` marker is finalized and ingested (ingest is idempotent on the session id); a restart mid-call rejoins the still-active event as a new session.

### DAVE note

Discord enforces end-to-end encryption (DAVE) on voice. Receive works in `@discordjs/voice` >= 0.19.2 but upstream bug #11653 (bot joins while someone is already talking, that user's audio never decrypts) is open. This package pins the version and applies `patches/@discordjs+voice+0.19.2.patch` (via `patch-package` on `npm install`), which makes a stuck session re-initialize instead of killing the stream. On top of that the capture counts "speaking but no audio" bursts per member and rejoins the channel once if three happen in a row (at most once a minute). A recording with any rejoin or stream error is flagged `partial`. Bumping `@discordjs/voice` is a tested change: re-run the spike.

Known limits: stereo 48 kHz Opus is stored as received; pauses inside a speaker's burst are re-inserted as Opus silence so timing stays on the wall clock; per speaker at most 2500 bursts (a 2 hour call has a few hundred).

## Environment variables

| Name | Required | Default | Notes |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | yes | | Same token as the PizzaDAO bot service. |
| `DISCORD_GUILD_ID` | yes | | PizzaDAO server id. |
| `RECORDER_API_KEY` | yes | | Shared secret; must equal `RECORDER_API_KEY` on Vercel. |
| `R2_ENDPOINT` | yes | | `https://<account>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | yes | | Token scoped to the calls bucket: read, write, list, delete. |
| `R2_SECRET_ACCESS_KEY` | yes | | |
| `R2_BUCKET_NAME` | yes | | Private bucket for call audio. |
| `DEEPGRAM_API_KEY` | no | | Deepgram Nova-3 transcription of each speaker's speech. Unset: calls are ingested without a transcript (logged once). |
| `CALL_VOICE_CHANNEL_ID` | no | `823956905739026442` | |
| `APP_BASE_URL` | no | `https://app.pizzadao.org` | Ingest API host. |
| `DATA_DIR` | no | `/data` | Mount the Railway volume here. |
| `MAX_CALL_MINUTES` | no | `120` | |
| `EMPTY_GRACE_MINUTES` | no | `5` | Humans-absent time before stopping. |
| `PORT` | no | `3000` (Railway sets it) | `/health` |

## R2 bucket and tokens

- Private bucket (no public access, no custom domain). Objects live under `calls/<sessionId>/` (`mix.m4a`, `tracks/<discordId>.ogg`).
- Call audio is **kept forever**: there is no retention sweep and no lifecycle rule. Do not add one.
- **Railway token (this worker): Object Read & Write, scoped to this bucket**: put, get, list and delete. List + delete are used to prune leftovers under `calls/<sessionId>/`.
- **Vercel token (the app): read only, scoped to this bucket.** The app only creates signed GET URLs for reviewers; it never writes or deletes. "Reject (hide)" on `/admin/calls` only marks the row REJECTED and never touches R2.

## Railway setup

1. In the existing Railway project add a service from this GitHub repo (`PizzaDAO/pizzadao-org`). **Settings > Source > Root Directory: `recorder`**. It builds `recorder/Dockerfile` (`railway.json` sets the health check on `/health`, restart on failure, 1 replica).
2. **Volume**: add one (5 GB is plenty) mounted at `/data`.
3. **Variables**: the table above. `DISCORD_BOT_TOKEN` is the same value the PizzaDAO bot service uses.
4. The PizzaDAO bot needs, in the call voice channel: **View Channel, Connect, Speak** (to join; it stays muted), **Send Messages** (the notice in the channel's text chat), and server-wide **Change Nickname**. No new Discord application is needed. The gateway intents *Server Members* and *Message Content* are not used.
5. Do not run two services logged in with this token that both join voice in this guild (one bot user can hold one voice connection per guild; pizza-radio uses its own bot).
6. Deploy, then open `https://<service>.up.railway.app/health`.

## Phase 0 spike (does DAVE receive work on a real call?)

```bash
cd recorder && npm install
DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
  npm run spike -- --channel <voiceChannelId> --minutes 10 --out ./spike-out
```

Needs `ffmpeg` on your PATH. Joins (muted), writes one Ogg file per speaker to `spike-out/spike-<ts>/`, then prints per-speaker packet counts, the DAVE decrypt-failure rate, rejoins and a PASS/CHECK verdict. Posts nothing, renames nothing, uploads nothing. Run it twice on a real call: once where everyone joins after the bot, once where people are already talking when it joins. Pass criteria: every speaker audible, under 1% decrypt failures, no reconnect loop. Use a test voice channel first, or the real one in a quiet moment (the bot's presence is visible, but the spike does not post the recording notice, so only use it with people who know).

## Development

```bash
npm install        # also applies patches/
npm test           # vitest (stop conditions, event lifecycle, ogg muxer, mix plan, finalize, ...)
npm run typecheck
npm run build && npm start
```

The root Next.js app ignores this directory (tsconfig, eslint, vitest, `.vercelignore`); CI runs the tests here as a separate step.
