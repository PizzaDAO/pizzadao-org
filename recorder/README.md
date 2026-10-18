# PizzaDAO call recorder

A small Node service (discord.js 14 + `@discordjs/voice` 0.19.2 with DAVE) that records the crew calls held in the shared voice channel. Plan: `plans/calzone-call-recorder.md` (see "Decisions (Snax, 2026-10-18)": same bot token, all crew calls, Dread Pizza Roberts review, audio never public, no attendance).

## What it does

1. Logs in with the PizzaDAO bot token (`DISCORD_BOT_TOKEN`) and watches guild scheduled events. Intents: Guilds, GuildVoiceStates, GuildScheduledEvents (nothing else).
2. When an event in the call channel (`CALL_VOICE_CHANNEL_ID`, default `823956905739026442`) goes **ACTIVE** it:
   - joins the channel (not deafened, self-muted);
   - sets its server nickname to `PizzaDAO Bot 🔴 REC` (the old nickname is saved to disk and restored afterwards, even after a crash);
   - posts the recording notice in the voice channel's text chat. If neither the nickname nor the notice can be shown, it leaves without recording.
3. Records one Ogg/Opus stream per speaker, written to `DATA_DIR/<sessionId>/seg/<userId>/` as it goes. Bots are skipped. Members who ran `/record optout` are never subscribed to (list fetched from the app, refreshed every `OPTOUT_REFRESH_SECONDS`; an opt-out mid-call deletes what was captured of that member).
4. Stops on the first of: no humans in the channel for 5 minutes, `MAX_CALL_MINUTES` (default 120), the event goes COMPLETED/CANCELED, or a *different* event becomes ACTIVE (closes this one, starts the next).
5. On stop: ffmpeg builds one aligned Opus track per speaker and one mono m4a mix; everything is uploaded to the private R2 bucket under `calls/<sessionId>/`; the app's ingest API is called with the metadata (event, channel, times, speakers with Discord ids, display names, talk time, R2 keys). The nickname is restored.
6. `GET /health` (200 once Discord is ready) for Railway.

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
| `R2_ACCESS_KEY_ID` | yes | | Token scoped to the calls bucket, read/write. |
| `R2_SECRET_ACCESS_KEY` | yes | | |
| `R2_BUCKET_NAME` | yes | | Private bucket for call audio. |
| `CALL_VOICE_CHANNEL_ID` | no | `823956905739026442` | |
| `APP_BASE_URL` | no | `https://app.pizzadao.org` | Ingest and opt-out API host. |
| `DATA_DIR` | no | `/data` | Mount the Railway volume here. |
| `MAX_CALL_MINUTES` | no | `120` | |
| `EMPTY_GRACE_MINUTES` | no | `5` | Humans-absent time before stopping. |
| `OPTOUT_REFRESH_SECONDS` | no | `60` | |
| `PORT` | no | `3000` (Railway sets it) | `/health` |

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
