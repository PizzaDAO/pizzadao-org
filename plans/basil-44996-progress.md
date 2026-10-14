# basil-44996 progress (handoff)

## Done
- Created worktree C:/dev/wt/basil-44996 on branch `basil-44996-call-recaps` from origin/main (added15).
- Copied the plan into `plans/basil-44996-call-recording-ai.md` and committed it. The "Decisions & approved MVP scope" section is authoritative.
- Research:
  - Installed `@vercel/blob` is 2.3.3. It supports `access: 'private'` on put/upload/handleUpload, plus `get(pathname, { access: 'private' })` to stream private blobs server-side, and `del`. So a private client upload works with `upload()` from `@vercel/blob/client` plus `handleUpload`.
  - `app/lib/cron-auth.ts::isCronAuthorized(authHeader)` and `app/lib/auth-guards.ts` (`requireSession`, `requireAdmin`, `isAdminDiscordId`, `checkSecret`) are available to reuse.
  - The latest migration folder is `prisma/migrations/20261012000000_shop_admin/`, so the new one should be `20261013000000_call_recordings/`.
  - vercel.json currently has 6 crons; two still need to be added.

## In progress
- Nothing is half-written. No source code has been changed yet.

## Left (ordered)
1. node_modules: the worktree has none yet. Junction it (`cmd //c mklink /J node_modules C:\code\onboarding\node_modules`), or, if adding deps, run `npm install @ffmpeg/ffmpeg @ffmpeg/util` in the worktree. `openai` is optional and plain fetch is fine.
2. Verify the OpenAI model names in the docs (WebFetch/WebSearch): the diarizing transcribe model (`gpt-4o-transcribe-diarize`?) with its request params (chunking_strategy, response_format `diarized_json`?), the fallback `gpt-4o-transcribe`, and a cost-efficient analysis model with JSON-schema structured output.
3. Prisma schema: models CallRecording, CallRecordingTrack, CallTranscriptSegment, CallSummary (default PUBLISHED) and CallActionItem, plus enums. Put them in migration `20261013000000_call_recordings/migration.sql`. Do not apply it to prod. Check DEPLOYMENT.md for how migrations are run.
4. Libs in `app/lib/recordings/`: types, access, storage, transcribe (OpenAI), merge (chunk offsets), analyze (structured output + owner resolution via CallAttendance and AttendanceSummary), and pipeline (status machine + lease).
5. API routes:
   - `api/recordings/upload` (handleUpload, private, admin only)
   - `api/recordings` POST, which creates the recording and tracks and calls after() to run the pipeline, with maxDuration 300
   - `api/recordings/[id]`: PATCH edit/unpublish, DELETE, and POST re-run
   - `api/cron/recordings` (the stuck-job sweeper) and `api/cron/recordings-retention` (30 days). Add both to vercel.json.
6. Upload UI: admin only, using ffmpeg.wasm with the single-thread core from the CDN (no COOP/COEP needed). Transcode to 16 kHz mono ~24-32 kbps, and chunk by time if over ~24 MB. See C:\code\clipper-ffmpeg-wasm for prior art.
7. `/calls/community_call/[date]` detail page:
   - summary public
   - transcript for logged-in members only
   - admin controls
   - on `/calls`: a 🎙 badge plus the TL;DR
8. i18n keys in messages/en, es and fr.
9. Add an announce message line in `app/lib/announce/message.ts` and update its tests/snapshots.
10. Update .env.example (OPENAI_API_KEY, OPENAI_TRANSCRIBE_MODEL, OPENAI_ANALYSIS_MODEL), DEPLOYMENT.md and architecture.md.
11. Vitest tests, then lint, test:run and build. Push, open a draft PR, and verify the Vercel preview.

## Decisions
- None made beyond the plan's approved scope yet. The model names are still unverified.
- Planned ffmpeg.wasm approach: the single-threaded `@ffmpeg/core` loaded from a CDN via toBlobURL, so no site-wide COOP/COEP headers.

## Gotchas
- Windows: the main checkout has many untracked files. Never edit C:\code\onboarding directly.
- A missing OPENAI_API_KEY must not break the build. Fail at runtime with a clear error.

## PR
- None yet.
