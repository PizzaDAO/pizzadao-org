# Importing old calls from X live broadcasts (operator runbook)

Plan and background: `plans/x-call-import.md`. This runs on the operator's machine only. Nothing here goes to Vercel, and the work directory, the env file and the audio never touch git. Replace every `<placeholder>`.

## Before you start

1. The `20261104000000_call_import` migration is **applied first**, then the guards are deployed (imported calls must not be able to post recaps, draft follow-ups, feed agendas or be auto-summarized). Check `/admin/settings` (area calls): the four `... imported calls` switches are all off.
2. The main PizzaDAO X account's **data archive** is downloaded and unzipped (X: Settings, Your account, Download an archive of your data; ready in about 24-48 h). The tool reads `data/tweets*.js`.

## Prerequisites (one time)

| Need | Install / get | Used by |
|---|---|---|
| Node 22.18+ | `nvm use` in the repo | the CLI |
| `yt-dlp` | `brew install yt-dlp` (`brew upgrade yt-dlp` before each run, X changes often) | probe, fetch |
| `ffmpeg` and `ffprobe` | `brew install ffmpeg` | fetch |
| whisper.cpp (`whisper-cli`) and two models | `brew install whisper-cpp`, then download `ggml-large-v3-turbo.bin` and the Silero VAD model `ggml-silero-v5.1.2.bin` into `<workdir>/models/` | transcribe |
| Python 3.12 venv with pyannote | `uv venv -p 3.12 <workdir>/.venv`, then `uv pip install -p <workdir>/.venv -r scripts/calls/x-import/requirements.txt` | diarize |
| Hugging Face token | on a Hugging Face account, accept the terms of `pyannote/speaker-diarization-3.1` and `pyannote/segmentation-3.0`, create a read token | diarize (`HF_TOKEN`) |
| R2 **write** token | Cloudflare: an API token limited to the call-audio bucket with object read and write. Separate from the app's read-only token. Revoke it when the import is done. | upload |
| Database URL | the production `DATABASE_URL` (from a `vercel env pull` kept outside the repo) | import, summarize |
| AI keys | `AI_GATEWAY_API_KEY` (and `OPENAI_API_KEY` as the fallback the summary code uses) | summarize |

The Python 3.14 that macOS may ship does not work with torch and pyannote yet: use the 3.12 venv.

## Env file (outside the repo, mode 600)

```bash
mkdir -p ~/.config/pizzadao && $EDITOR ~/.config/pizzadao/x-import.env && chmod 600 ~/.config/pizzadao/x-import.env
```

Variable names (put the values in the file only; the tool never prints them):

```
DATABASE_URL
AI_GATEWAY_API_KEY
OPENAI_API_KEY
HF_TOKEN
X_IMPORT_R2_ENDPOINT
X_IMPORT_R2_BUCKET
X_IMPORT_R2_ACCESS_KEY_ID
X_IMPORT_R2_SECRET_ACCESS_KEY
IMPORT_OPERATOR_DISCORD_ID
```

The tool refuses an env file that others can read.

## Run

Every step is a **dry run until you add `--apply`**, resumable (state per call in `<workdir>/state/<key>.json`), sequential and rate limited.

```bash
cd <repo>
S="node scripts/calls/x-import.mjs --env ~/.config/pizzadao/x-import.env --workdir ~/pizzadao-x-import"

$S discover --archive <unzipped-archive-dir> [--csv <manual.csv>]            # prints counts
$S discover --archive <unzipped-archive-dir> [--csv <manual.csv>] --apply    # writes manifest.csv
# Edit ~/pizzadao-x-import/manifest.csv: include=y for the calls to import (short = import even if under 10 min),
# fix titles / crew_id. include=n or empty rows are ignored.

$S probe --apply                      # yt-dlp metadata: replay still there? duration, start time
$S fetch --apply [--only <key>] [--cookies-from-browser <browser>]   # audio only: HLS replay -> 16 kHz mono wav + m4a mix
$S transcribe --apply                 # whisper.cpp, resumable
$S diarize --apply [--max-speakers <n>]
$S merge --apply                      # prints per-call counts (lines, speakers, words), never text
$S upload --apply                     # R2, skips unchanged sha256
$S import --apply                     # rows land IN_REVIEW with source X_BROADCAST
$S summarize --apply --limit 10       # repeat until none are left; failures are retried on the next run
$S status                             # key, step, error, row id

# chain steps; redo one call from scratch (refuses published / rejected calls, and edited ones without --force):
$S run --from fetch --to import --only <key> --apply --force
```

Notes:

- `--cookies-from-browser` uses your own logged-in browser profile and only if X refuses anonymous replay downloads. Cookies are not stored or passed anywhere else.
- Only audio is kept. The downloaded stream is deleted after extraction unless `--keep-raw`.
- Calls shorter than 10 minutes (`--min-minutes`) are skipped as `too-short` unless the manifest row says `include=short`.
- The R2 objects are `calls/x-broadcast-<id>/mix.m4a` plus `import/transcript.raw.json` and `import/diarization.rttm`. The recorder only prunes the prefix of its own sessions, so the `x-` prefix never collides.
- A broadcast whose replay has expired is marked `gone` by `probe` and skipped. Add it by hand later if you obtain the audio elsewhere (put the wav in `work/` and mark the steps by re-running them).

## Review and publish

On `/admin/calls`, filter Source: Imported. Label PizzaDAO members on each call's speaker panel (guests stay "Speaker N"), redact anything that should not be public, click Regenerate where labels changed, then publish (bulk publish is capped by the `calls.bulkActionMax` setting). Publishing an imported call posts nothing to Discord unless `Post recaps for imported calls` is switched on (and bulk publish never posts a recap).

## Preview deployments

Previews share the production database. Import exactly one short test call with `--only <key>` and check it. Then remove the test row from the database (dry run first, then `--apply`):

```bash
$S delete --only <key>
$S delete --only <key> --apply
```

`delete` refuses Discord-recorded and published calls (unpublish first) and leaves the R2 objects alone. The four `... imported calls` switches ignore their saved value on non-production deployments (only the `CALL_IMPORT_*_ENABLED` env var counts there; each env var set to off also wins in production).
