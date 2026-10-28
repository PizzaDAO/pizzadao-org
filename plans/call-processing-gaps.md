# Call processing gaps: missing summaries, thin transcripts, wrong language

Read-only investigation (counts and timings only). No code or data was changed.

## Goal

Every recorded call ends up with a full transcript, a correct language label and an AI
title, summary, action items and chapters. When a step fails, the error is saved on the row and
the step is retried. The affected recordings from the last 14 days get processed again without
overwriting any reviewer edits.

## What happened (summary of findings)

- Every transcription run logged a model-access error from the summary step, and the row still
  ended up in review with no summary and no visible error.
- Some tracks that are mostly silence came back with few or no words, and one speaker's text
  stopped early in a long call. The language label could come out wrong for English speech.
- The largest track of one long call hit the per-track timeout twice, which added hours of backoff.
- No reviewer edits or redactions existed on the affected rows.

## Root causes

### 1. Summaries: the gateway refuses the model, the error is swallowed, and nothing retries

1. `summarize.ts:11`: the default model `anthropic/claude-sonnet-5.5` was refused by the AI
   Gateway for the account's plan. `generateText` (`summarize.ts:96`) throws within seconds.
2. `recordings.ts:289-292`: the catch only calls `console.error` and `toReview()`. No error column
   exists, so the row shows nothing.
3. `transcribe.ts:376-377`: the boolean result of the summary is ignored and the outcome is still
   `transcribed`. The cron log therefore looks healthy.
4. `transcribe.ts:419`: the sweep (`listNeedingSummary`) only covers `RECORDED`/`PROCESSING`.
   Every failure path moves the row to `IN_REVIEW` first (`recordings.ts:257`), so a failed
   summary is **never** retried. The sweep only catches runs that were killed mid-call.
5. The admin Regenerate route (`app/api/admin/calls/[id]/regenerate/route.ts`) would fail the same
   way until the model access is fixed.

### 2. Thin transcripts and the wrong language: Whisper gets long, mostly silent tracks with no language hint

- The recorder pads each per-speaker track with Opus silence frames so it runs at wall-clock length
  (`recorder/src/gap-filler.ts`). A speaker who talks for 1 minute in a 36-minute call still sends
  36 minutes of mostly digital silence.
- `transcribe.ts:146-150` sends no `language` and no `prompt`. Whisper detects the language from
  the first 30 s of a track. Those 30 s are often silence, and Whisper is known to label silence as
  Welsh, Nynorsk and similar languages. Decoding in the wrong language, or long silent stretches,
  sends Whisper into low-confidence or looping output. `cleanSegments` then removes it correctly
  (`isDubious`, `transcribe.ts:53-58`; `dropRepeatRuns`, `transcribe.ts:69-87`), together with any
  real speech inside those segments. That fits: tracks that are mostly silence came back empty, and
  one speaker was lost after minute 5.
- The same silence makes Whisper slow. The 32-minute dominant track hit `TRACK_TIMEOUT_MS = 120 s`
  (`transcribe.ts:127`) twice, which added hours of backoff.
- The local run that worked used the same per-track audio with `-l en`. So the per-track design is
  sound, and the missing language hint is the main difference.
- I could not confirm this per track. `transcribeTracks` (which held each track's language and
  utterances) is set to `DbNull` on success (`transcribe.ts:369`) by design, and no dropped-segment
  counts are logged. **`transcribeTracks` being NULL is expected, not a bug**, but it leaves no
  diagnostics behind.
- Minor: a track skipped as too large is counted as done. `failedTracks` (`transcribe.ts:361,368`)
  ignores it, so `transcribeError` stays null even though that speaker is missing. That did not
  happen here (the largest track was 5.5 MB).
- The segment counts themselves (42 and 94) are **merged turns** (`mergeSpeakerTurns`, 1.5 s gap),
  not Whisper lines, so they are not directly comparable with a local line count. Words compared
  with talk time is the real signal.

### 3. Few recordings (brief)

- The recorder only watches one voice channel (`recorder/src/config.ts:46`). Calls held in other
  voice channels are never recorded by design.
- A recording can end early (`superseded` when the next event starts in the same channel, or
  `shutdown` when the container restarts). Check the recorder host's restart metrics.
- The recorder logs almost nothing about slots or sessions. A follow-up could add one log line per
  slot decision (start, skip, supersede).

## Proposed fix

### Step 0: ops, no code (the owner decides)

Pick one:

- (a) Add AI Gateway credits for the team (simplest; the code is unchanged); or
- (b) set `CALL_SUMMARY_MODEL` to a model the plan allows (check in the gateway dashboard first); or
- (c) apply code fix 1e.

Optionally enable the recorder's Deepgram path. It primary path already concatenates
speech only, with an offset map (`recorder/src/transcribe.ts:1-10`), and uses `language=multi`,
which avoids problem 2 entirely.

### Step 1: summary reliability

- a. Migration: add `summaryError String?` and `summaryAttempts Int @default(0)` to `CallRecording`.
- b. `recordings.ts:289-292`: in the catch, save `summaryError` (the message without URLs, at most
  300 characters) and increment `summaryAttempts`. Clear `summaryError` on success (the `data` at
  `recordings.ts:265`).
- c. `transcribe.ts:413-427` `listNeedingSummary`: change the status filter to
  `['RECORDED','PROCESSING','IN_REVIEW']` and add `summaryGeneratedAt: null`,
  `summaryAttempts: { lt: 3 }`, and a backoff (`updatedAt < now - 1h` once `summaryError` is set).
  Keep `summary: null` and `summaryEditedAt: null`, so a reviewer's text is never touched. The
  cron already calls it with `onlyIfEmpty` and `unlessEdited`.
- d. `transcribe.ts:376-377`: return a new outcome `transcribed-no-summary` when the summary
  returns false. Add it to `USED_OPENAI` (`transcribe.ts:195`) so the cron logs it.
- e. Optional (`summarize.ts:89-103`): if the gateway call fails with an access or auth error and
  `OPENAI_API_KEY` is set, retry once through `@ai-sdk/openai` (already a dependency) with a
  `CALL_SUMMARY_FALLBACK_MODEL`.
- f. Show `summaryError` on the `/admin/calls/[id]` review page next to Regenerate.

### Step 2: transcription quality

- a. `transcribe.ts:146-150`: add `form.append('language', lang)`. `lang` comes from
  `CALL_TRANSCRIBE_LANGUAGE` (default `en`; the value `auto` sends no language hint). The DB
  settings work in `plans/app-settings.md` can take this over later. Add an optional `prompt`
  (short PizzaDAO vocabulary) from `CALL_TRANSCRIBE_PROMPT`.
- b. `transcribe.ts:317`: compute per-track stats: raw segments, kept, dropped as dubious, dropped
  as repeats, words, language, and the last kept `endMs` compared with `talkTimeSec`. Log one line
  per track (no text). Save them in a new column `transcribeStats Json?`, written at finalize.
  Do not reuse `transcribeTracks`: the resume logic relies on it being keyed by track.
- c. `transcribe.ts:361,368`: include tracks skipped as too large in the `partial:` error.
- d. `transcribe.ts:127`: raise `TRACK_TIMEOUT_MS` to 170 s. It stays within `HARD_DEADLINE_MS`,
  because the per-call timeout is already `min(TRACK_TIMEOUT_MS, remaining)`.
- e. Follow-up (larger, recommended): build speech-only tracks plus an offset map on the recorder,
  the same as the Deepgram path. Then upload those with the ingest payload and map Whisper
  timestamps back to call time. This removes the silence that causes the mislabelled language,
  the hallucinations and the timeouts, and it cuts cost. Alternatives considered:
  - Transcribing the mix loses speaker attribution.
  - `gpt-4o-transcribe` gives no segment timestamps.
  - Dropping the filters lets hallucinations into public text.

### Step 3: re-run the affected rows safely

The existing tools cannot re-transcribe them:

- `retry-transcription` needs `transcribedAt = null` and attempts of 3 or more.
- The backfill script lists only rows with `transcribedAt = null`.
- `transcribeRecording` returns `already-had-speech` while spoken segments exist
  (`transcribe.ts:259`).

Add `--retranscribe <id>` to `scripts/calls/backfill-transcripts.mjs`, dry run by default. In
one guarded `updateMany`, it should:

- match only when the status is in `RECORDED/PROCESSING/IN_REVIEW`, `summaryEditedAt IS NULL`,
  `redactedSegmentIds` is empty, and `updatedAt` equals the value just read;
- keep only `kind: 'chat'` segments in `transcript`;
- set `transcribedAt`, `transcribeError` and `transcribeTracks` to null and
  `transcribeAttempts` to 0;
- print counts before and after. It refuses a row with reviewer edits or line redactions,
  because speech segment keys (`s:<speaker>:<startMs>`) change on re-transcription.

Then `--apply` runs `transcribeRecording`, which also regenerates the summary with
`unlessEdited`. The cron also picks reset rows up within 15 minutes.

Order:

1. Step 0, and deploy steps 1 and 2a to 2d.
2. Re-check that `summaryEditedAt` is still null and there are no redactions on each affected row.
3. Run `--retranscribe` on each affected row (cost: about 70 min of whisper-1 audio, a few cents).
4. Verify (below).

If the owner wants summaries before the transcription fix ships, run Regenerate on the current
transcripts once Step 0 is done. That is safe today because none of the affected rows has edits.
But the Regenerate route does not pass `unlessEdited`, so check `summaryEditedAt` first.

## Files to change

- `prisma/schema.prisma` and a new migration: `summaryError`, `summaryAttempts`, `transcribeStats`.
- `app/lib/calls/recordings.ts`: summary error and attempts.
- `app/lib/calls/transcribe.ts`: language and prompt, stats, the sweep filter, the new outcome, the
  timeout, partial counting.
- `app/lib/calls/summarize.ts`: optional OpenAI fallback.
- `app/api/cron/call-transcripts/route.ts`: no logic change; the new outcome gets logged.
- `scripts/calls/backfill-transcripts.mjs`: `--retranscribe`.
- The admin call review page: show `summaryError`.
- Tests: `transcribe.test.ts`, `cron-retry.test.ts`, `phase2.test.ts`.

## Risks

- Forcing `en` hurts non-English calls. Keep `auto` available; per-crew language is a follow-up.
- Re-transcribing replaces the spoken transcript; it is not kept. That is acceptable here: no
  edits or redactions, and the audio is kept in R2.
- The sweep now covers IN_REVIEW rows. It must never touch rows with `summaryEditedAt`, rows with
  a summary, or PUBLISHED or REJECTED rows. Cover this with tests.
- The gateway fallback (1e) adds a second provider and its cost.

## Verification

- Unit tests:
  - the sweep includes IN_REVIEW rows with `summaryError` and excludes edited, summarized,
    published and rejected rows;
  - the catch saves `summaryError`;
  - the form includes `language`;
  - stats are computed;
  - too-large tracks count as partial;
  - `--retranscribe` refuses edited or redacted rows.
- `npm run lint`, `npx vitest run app/lib/calls`, `npm run build`.
- Vercel preview: run the cron route by hand against a preview DB, or watch the next prod run
  after merging. The Vercel logs should show per-track stats lines and no
  `generation failed` lines.
- After the re-run, with the same counts-only query:
  - `summaryGeneratedAt` is set and `summaryError` is null;
  - `transcriptLanguage` is `english` for A;
  - each track's words compared with `talkTimeSec` is roughly 100 to 160 wpm, the earlier empty
    tracks in A have text, and B's second speaker runs past minute 5.
