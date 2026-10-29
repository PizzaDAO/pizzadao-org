# Import old community calls from X live broadcasts

Status: PR 1-3 implemented on `feat/x-call-import`. Repo text, fixtures and PR descriptions stay generic: no real names, broadcast ids or account handles.

## Goal

PizzaDAO's older community calls were held as **X live video broadcasts (streams)** from the main PizzaDAO X account (not Spaces). Bring the recorded ones into the app so they go through the same steps as Discord-recorded calls:

transcript -> AI title / summary / action items / chapters -> admin review on `/admin/calls` -> publish -> members-only `/calls/[id]` page, with the transcript gated by `calls.transcriptMinLevel` (default 6).

Imported calls differ from Discord calls:

- **No Discord recap, no follow-up drafting, no agenda context, no automatic summary** unless a `calls.imported*` setting is turned on (all off by default).
- **No crons run on them.** The transcript cron, the follow-up sweep and the agenda never pick an imported row.
- **One mixed track instead of per-speaker tracks.** Speakers come from diarization (`xs:N`). A reviewer can label "Speaker 2 = <member>"; guests stay "Speaker N".
- **Audio only.** The replay is a video stream; only the audio is kept (a 16 kHz mono WAV for processing, locally; an m4a mix for storage and review playback). No video is ever stored.
- **Transcribed locally** (whisper.cpp with Silero VAD, `-mc 0`, `-sns`) on the operator machine. The app only stores the result, summarizes it, and handles review and publishing.

## Decisions (Snax, 2026-10-29)

- Build the PRs. All defaults taken: local pipeline, archive-first discovery, recaps / follow-ups / agenda context / auto-summary off for imports, label members only, **no public source link**, community calls first, skip < 10 min, bulk publish <= 50, keep the audio mix.
- Correction: the old calls were X live broadcasts, not Spaces. Discovery: broadcast links (`x.com/i/broadcasts/<id>`, older `pscp.tv` / `periscope.tv` links) from the account's data archive tweets, plus yt-dlp on those links; download the HLS replay with yt-dlp / ffmpeg and keep audio only. Source enum value `X_BROADCAST` (`X_SPACE` kept in the enum, it is free). Idempotency key `x-broadcast-<id>`.

## Current pipeline (what this builds on)

- `CallRecording.sessionId` is unique and is the idempotency key. `channelId`, `startedAt`, `endedAt`, `durationSec` are required. `transcript` is JSON `[{discordId, startMs, endMs, text, kind?, id?, name?}]`.
- `CallSpeaker (recordingId, discordId)` is unique. The recorder writes `calls/<sessionId>/mix.m4a` to private R2. **The app's R2 token is read-only** (`app/lib/calls/r2.ts`); the import tool needs its own write-capable token.
- Server-side transcription (`transcribe.ts`) is per-speaker-track and only for Discord rows. The summary code (`recordings.ts generateAndStoreSummaryResult`) works on any row with a transcript.
- Redaction keys are `<speaker>` and `s:<speaker>:<startMs>`; the validation used Discord snowflakes only.

### Gaps fixed in PR 1

| Gap | Fix |
|---|---|
| `postCallRecap` had no notion of source | returns `'imported'` unless `calls.importedRecapPostEnabled` |
| follow-up sweep and manual draft had no source guard (the 14-day window excluded old rows only by accident) | sweep filters `source = DISCORD`; draft returns `'disabled'`, even when forced, unless `calls.importedFollowupsEnabled` |
| agenda `previousActionItems` read the latest published call of a crew | filters `source = DISCORD` unless `calls.importedAgendaContext` |
| `listNeedingSummary` had no age window and no source filter | `source = DISCORD` unless `calls.importedAutoSummarize`; imported rows only within 30 days of `importedAt` |
| pending transcription relied on `trackKey` to skip imports | explicit `source = DISCORD` in the shared eligibility fragment (also guards the claim) |
| `resetForRetranscribe` / retry-transcription would wipe an import | `'not-supported'` / conflict; re-run the import tool with `--force` |
| redact routes accepted Discord snowflakes only | `SPEAKER_ID = ^(\d{5,25}|xs:\d{1,3})$`, `SEGMENT_KEY` accepts `s:xs:N:ms` |
| `/admin/calls` capped at 100 rows, no filters | `listRecordingsPage` with source / status filters and an id cursor |

All guards are fail-safe: settings unreadable or invalid -> off; any non-production deploy -> off (previews share the production database).

## Discovery (broadcasts)

| Source | Verdict |
|---|---|
| **X account data archive** (owner requests it while logged in; ready in 24-48 h): `data/tweets.js` holds every post, including `x.com/i/broadcasts/<id>` and `pscp.tv/...` / `periscope.tv/...` links (often only in the expanded `entities.urls`) | **Primary.** First party, no API cost, no 3,200-post cap. |
| `yt-dlp --dump-json <broadcast url>` | **Probe** each candidate: title, start time, duration, whether the replay still exists. |
| Manual CSV filled in by the owner | **Fallback** for links the archive misses (other accounts, deleted posts). |
| X API v2 / scraping x.com | Not used. |

The tweet's `created_at` is when the link was posted, usually shortly after the stream ended; the probe's `timestamp` is authoritative when present. Replays may have expired: the manifest records `probe: ok|gone|error`.

**Manifest** (operator work dir, never in the repo) columns: `key, kind (broadcast), url, external_id, started_at_utc, ended_at_utc, title, event_name, crew_id, source (archive|manual), include (y/n), notes`. `key = x-broadcast-<external_id>`. De-duplicated on the broadcast id across all link shapes. `crew_id` defaults to `community_call`.

## Operator pipeline (never on Vercel)

`scripts/calls/x-import.mjs <subcommand>`, dry run by default, `--apply` to write, state per row in `<workdir>/state/<key>.json` (step, sha256 values, tool versions, errors; never transcript text), sequential and rate limited.

1. `discover --archive <dir> [--csv <file>]` writes `manifest.csv`.
2. `probe` runs `yt-dlp --dump-json` per included row.
3. `fetch` downloads the HLS replay with yt-dlp (audio only: `-x`/`bestaudio`, retries, sleeps, rate limit), then ffmpeg makes `work/<key>.wav` (16 kHz mono) and `out/<key>/mix.m4a` (mono AAC 64 kb/s). Rows shorter than `--min-minutes` (10) are flagged `skip: too-short`.
4. `transcribe` runs whisper.cpp (`-mc 0 -sns --vad`, full JSON).
5. `diarize` runs the pyannote helper (`scripts/calls/x-import/diarize.py`, HF token from env).
6. `merge` builds `out/<key>/import.json` with `app/lib/calls/import-merge.ts` (whisper segments + diarization by overlap -> segments with speaker ids `xs:N`). Prints counts only.
7. `upload` sends `calls/<sessionId>/mix.m4a` (+ raw whisper JSON and RTTM under `import/`) to R2 with the write-capable token, skipping objects whose sha256 is unchanged.
8. `import` calls `importExternalRecording` (`app/lib/calls/import.ts`): validates, upserts on `sessionId`, never overwrites a PUBLISHED / REJECTED / reviewer-touched row (not even with `--force` for published or rejected).
9. `summarize [--limit N]` calls `generateAndStoreSummaryResult` one call at a time (same model and code as Discord calls).

`sessionId = x-broadcast-<external_id>`; `channelId = 'x'` (nothing resolves it as a Discord channel); `status = IN_REVIEW`; `transcribedAt = followupsDraftedAt = importedAt` (belt and braces); `transcriptLanguage = 'english'`.

## Diarization and speakers

whisper.cpp for text, pyannote for "who spoke when", merged by overlap: each whisper segment gets the speaker with the most overlap (nearest turn within 1 s if none; otherwise `xs:0` = unknown); turns are merged with the 1.5 s rule. Speaker ids are `xs:1..xs:N`, numbered by first appearance. The transcript field stays named `discordId`, so every reader keeps working.

PR 3 adds a "Label" control on `/admin/calls/[id]`: a display name, or a member link (`CallSpeaker.linkedDiscordId` + `displayName`). Guests stay "Speaker N". Labels never rewrite transcript keys, so redactions stay valid. Relabeling sets `speakerLabelsUpdatedAt`; the page says the summary predates the labels until it is regenerated.

## Data model (additive, migration `20261104000000_call_import`)

`enum CallSource { DISCORD X_SPACE X_BROADCAST }`; `CallRecording.source` (default DISCORD), `sourceUrl` (reviewers only, never public), `importedAt`, `importedBy`, `importMeta` (never text), `speakerLabelsUpdatedAt`, index `(source, startedAt)`; `CallSpeaker.linkedDiscordId` + index.

## Settings (DPR on `/admin/settings`, area calls; all default off, fail-safe off, saved values ignored on previews)

`calls.importedRecapPostEnabled`, `calls.importedFollowupsEnabled`, `calls.importedAgendaContext`, `calls.importedAutoSummarize` (feature switches with kill-switch env vars `CALL_IMPORT_RECAP_ENABLED`, `CALL_IMPORT_FOLLOWUPS_ENABLED`, `CALL_IMPORT_AGENDA_ENABLED`, `CALL_IMPORT_AUTOSUMMARY_ENABLED`); PR 3 adds `calls.bulkActionMax` (default 50, max 50).

## Review and publish (PR 3)

- `/admin/calls`: Source filter (All / Discord / Imported), status filter, "load more" paging, a source badge, bulk publish / reject for imported rows (`POST /api/admin/calls/bulk`, each id through `publishRecording` or `rejectRecording`, at most `calls.bulkActionMax`).
- Detail page: source URL (reviewers only), speaker label panel, existing redact tools, Regenerate.
- Public pages: unlabelled speakers show as "Speaker N"; imported calls fall into history by `startedAt`. The source URL and the audio are never public.

## Privacy

Public broadcast guests spoke in public, but these pages are members-only and named. Label PizzaDAO members only; guests stay "Speaker N" or are hidden with the redact-speaker tool. Reject any broadcast whose host or guests would not expect a PizzaDAO transcript. No recaps, no follow-ups. Audio is never public.

## Cost (about 150 calls averaging 1 h)

Local whisper.cpp and pyannote: $0. Summaries about $10-20. R2 about 4 GB. X API not used. Total about $10-25 plus 10-20 h of unattended laptop time.

## Risks

- **Coverage:** older replays may have expired; the archive only holds posts of the archived account. The probe sizes this before any heavy step.
- **R2 write credentials:** a new token scoped to the bucket, kept only in the operator env file, revoked after the import.
- **Diarization quality:** compressed audio and overlapping speech. Labels are optional and reviewable, so a wrong attribution is a review problem.
- **yt-dlp / X changes:** archive-first, sequential, sleeps, keep yt-dlp current.
- **Preview vs production DB:** previews share the database; import exactly one short test call and clean it up.
- **Cross-feature leakage:** new code reading `CallRecording` must use `DISCORD_ONLY` (exported from `app/lib/calls/imported.ts`) unless it is review tooling.

## Phases

- **PR 1:** schema, guards, settings, tests.
- **PR 2:** operator CLI, merge library, whisper / pyannote / R2 steps, DB import, runbook (`docs/x-call-import.md`).
- **PR 3:** admin filter, paging, bulk actions, speaker labelling, public "Speaker N", en / es / fr.
- Order: apply the migration first, then deploy the guards, then import. The guards must be live before imported rows exist.
