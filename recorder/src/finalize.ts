/**
 * After a recording stops: build one aligned Opus track per speaker and one m4a
 * mix with ffmpeg, upload everything to R2, report to the app, clean up.
 *
 * Idempotent and resumable: everything needed lives in the session directory
 * (session.json + manifest.jsonl + seg/), so `recoverPending` can finish a
 * session after a crash or an app outage. `uploaded` marks success;
 * `ingest-rejected` marks a payload the app refused for good.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { readManifest, summarize, appendRecord, MANIFEST_FILE, type SpeakerSummary } from './manifest.js'
import { buildMixArgs, buildSpeakerTrackPlan, type PlanSegment } from './mix-plan.js'
import { postIngestWithRetry, type IngestResult } from './ingest.js'
import { sessionKeys, type Uploader } from './storage.js'
import { transcribeSession, TranscriptionFailedError, type TranscribeDeps } from './transcribe.js'
import type { IngestPayload, IngestSpeaker, SessionMeta } from './types.js'

const run = promisify(execFile)

export const SESSION_FILE = 'session.json'
const UPLOADED = 'uploaded'
const REJECTED = 'ingest-rejected'
const KEEP_DONE_DAYS = 7
export const MAX_TRANSCRIBE_ATTEMPTS = 3
const ATTEMPTS_FILE = 'transcribe-attempts'

function bumpTranscribeAttempts(dir: string): number {
  const file = path.join(dir, ATTEMPTS_FILE)
  let n = 0
  try {
    n = Number(readFileSync(file, 'utf8')) || 0
  } catch {
    // first failure
  }
  writeFileSync(file, String(n + 1))
  return n + 1
}

export interface FinalizeDeps {
  appBaseUrl: string
  apiKey: string
  uploader: Uploader
  log: (msg: string) => void
  ffmpeg?: (args: string[]) => Promise<void>
  postIngest?: (payload: IngestPayload) => Promise<IngestResult>
  /** Deepgram key; without it the call is ingested with no transcript. */
  deepgramApiKey?: string
  transcribe?: (sessionDir: string, outDir: string, speakers: SpeakerSummary[], deps: TranscribeDeps) => ReturnType<typeof transcribeSession>
}

export function writeSessionMeta(dir: string, meta: SessionMeta): void {
  writeFileSync(path.join(dir, SESSION_FILE), JSON.stringify(meta, null, 2))
}

export function readSessionMeta(dir: string): SessionMeta | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, SESSION_FILE), 'utf8')) as SessionMeta
  } catch {
    return null
  }
}

/** Add manifest records for segment files a crash left unrecorded (open at the time). */
export function reconcileOrphans(dir: string): number {
  const known = new Set(
    readManifest(dir)
      .filter((r) => r.t === 'segment')
      .map((r) => (r.t === 'segment' ? r.file : '')),
  )
  const segRoot = path.join(dir, 'seg')
  if (!existsSync(segRoot)) return 0
  let added = 0
  for (const userId of readdirSync(segRoot)) {
    for (const name of readdirSync(path.join(segRoot, userId))) {
      const file = path.join('seg', userId, name)
      if (known.has(file) || !name.endsWith('.ogg')) continue
      const st = statSync(path.join(dir, file))
      const startMs = Number(name.replace('.ogg', ''))
      if (!Number.isFinite(startMs) || st.size === 0) continue
      const meta = readSessionMeta(dir)
      appendRecord(dir, {
        t: 'segment',
        userId,
        startMs,
        endMs: meta ? Math.max(startMs, st.mtimeMs - meta.startedAtMs) : startMs,
        file,
        bytes: st.size,
      })
      added++
    }
  }
  return added
}

async function defaultFfmpeg(args: string[]): Promise<void> {
  await run('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 })
}

/** One speaker's aligned track, built in chunks of at most 200 inputs per ffmpeg pass. */
export async function buildSpeakerTrack(
  ffmpeg: (args: string[]) => Promise<void>,
  segments: PlanSegment[],
  outFile: string,
): Promise<void> {
  for (const pass of buildSpeakerTrackPlan(segments, outFile, outFile.replace(/\.ogg$/, ''))) await ffmpeg(pass)
}

/** Marker: a session is being started/recorded right now, so recovery must not touch it. */
export const STARTING = 'starting'
export const markStarting = (dir: string) => writeFileSync(path.join(dir, STARTING), String(Date.now()))
export const clearStarting = (dir: string) => rmSync(path.join(dir, STARTING), { force: true })
/** On boot nothing is live: drop markers a crash left behind so those sessions get finalized. */
export function clearAllStarting(dataDir: string): void {
  if (!existsSync(dataDir)) return
  for (const e of readdirSync(dataDir, { withFileTypes: true })) if (e.isDirectory()) clearStarting(path.join(dataDir, e.name))
}

export async function finalizeSession(dir: string, deps: FinalizeDeps): Promise<'uploaded' | 'rejected' | 'pending' | 'empty'> {
  const meta = readSessionMeta(dir)
  if (!meta) throw new Error(`no session.json in ${dir}`)
  const ffmpeg = deps.ffmpeg ?? defaultFfmpeg
  let partial = meta.partial

  reconcileOrphans(dir)
  const speakers = summarize(readManifest(dir))
  const keys = sessionKeys(meta.sessionId)
  const outDir = path.join(dir, 'out')
  mkdirSync(outDir, { recursive: true })

  const trackFiles: { userId: string; file: string }[] = []
  for (const sp of speakers) {
    const file = path.join(outDir, `${sp.userId}.ogg`)
    try {
      await buildSpeakerTrack(ffmpeg, sp.segments.map((s) => ({ file: path.join(dir, s.file), startMs: s.startMs })), file)
      trackFiles.push({ userId: sp.userId, file })
    } catch (err) {
      partial = true
      deps.log(`track for ${sp.userId} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  let mix: IngestPayload['mix'] = null
  const mixFile = path.join(outDir, 'mix.m4a')
  if (trackFiles.length > 0) {
    try {
      await ffmpeg(buildMixArgs(trackFiles.map((t) => t.file), mixFile))
    } catch (err) {
      partial = true
      deps.log(`mixdown failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Upload. A failure leaves the directory for the next recovery pass.
  try {
    if (existsSync(mixFile)) {
      const bytes = await deps.uploader.put(keys.mix, mixFile, 'audio/mp4')
      mix = { key: keys.mix, bytes }
    }
    const uploadedTracks = new Map<string, { key: string; bytes: number }>()
    for (const t of trackFiles) {
      const key = keys.track(t.userId)
      uploadedTracks.set(t.userId, { key, bytes: await deps.uploader.put(key, t.file, 'audio/ogg') })
    }

    // Only speakers whose track was built are transcribed.
    let transcript: IngestPayload['transcript']
    try {
      const transcribe = deps.transcribe ?? transcribeSession
      const t = await transcribe(dir, outDir, speakers.filter((sp) => uploadedTracks.has(sp.userId)), { apiKey: deps.deepgramApiKey, log: deps.log, ffmpeg })
      if (t) transcript = t
    } catch (err) {
      deps.log(`transcription failed for ${meta.sessionId}: ${err instanceof Error ? err.message : String(err)}`)
      if (err instanceof TranscriptionFailedError && deps.deepgramApiKey) {
        // Total failure: keep the session pending (bounded), then give up and ingest without words.
        const attempts = bumpTranscribeAttempts(dir)
        if (attempts < MAX_TRANSCRIBE_ATTEMPTS) {
          deps.log(`will retry transcription of ${meta.sessionId} (attempt ${attempts}/${MAX_TRANSCRIBE_ATTEMPTS})`)
          return 'pending'
        }
        deps.log(`giving up on transcribing ${meta.sessionId}; ingesting without a transcript`)
      }
    }

    const endedAtMs = meta.endedAtMs ?? statSync(path.join(dir, MANIFEST_FILE)).mtimeMs
    const payload: IngestPayload = {
      sessionId: meta.sessionId,
      eventId: meta.eventId,
      eventName: meta.eventName,
      channelId: meta.channelId,
      startedAt: new Date(meta.startedAtMs).toISOString(),
      endedAt: new Date(Math.max(endedAtMs, meta.startedAtMs)).toISOString(),
      endReason: meta.endReason ?? 'recovered',
      partial,
      mix,
      speakers: speakers
        .filter((sp) => uploadedTracks.has(sp.userId))
        .map<IngestSpeaker>((sp) => ({
          discordId: sp.userId,
          displayName: sp.displayName,
          talkTimeSec: sp.talkTimeSec,
          trackKey: uploadedTracks.get(sp.userId)!.key,
          trackBytes: uploadedTracks.get(sp.userId)!.bytes,
        })),
      ...(transcript ? { transcript } : {}),
    }

    if (payload.speakers.length === 0 && !payload.mix) {
      deps.log(`session ${meta.sessionId} captured no audio; nothing to ingest`)
      writeFileSync(path.join(dir, UPLOADED), 'empty')
      cleanAudio(dir)
      return 'empty'
    }

    const post = deps.postIngest ?? ((p: IngestPayload) => postIngestWithRetry(deps.appBaseUrl, deps.apiKey, p))
    const res = await post(payload)
    if (res.ok) {
      // Upload first, prune after: remove only objects the stored row does NOT reference
      // (leftovers of earlier attempts, e.g. a speaker since purged for opting out).
      const ours = [payload.mix?.key, ...payload.speakers.map((sp) => sp.trackKey)].filter((k): k is string => !!k)
      const keep = new Set(res.keys.length ? res.keys : ours)
      try {
        const pruned = await deps.uploader.pruneExcept(keys.prefix, keep)
        if (pruned) deps.log(`removed ${pruned} leftover R2 object(s) of ${meta.sessionId}`)
      } catch (err) {
        deps.log(`could not prune leftovers of ${meta.sessionId}: ${err instanceof Error ? err.message : String(err)}`)
      }
      writeFileSync(path.join(dir, UPLOADED), res.id)
      cleanAudio(dir)
      deps.log(`session ${meta.sessionId} ingested as ${res.id}${res.duplicate ? ' (already existed)' : ''}`)
      return 'uploaded'
    }
    if (!res.retryable) {
      // Nothing is deleted from R2 here: a row for this session might already reference
      // those objects. Leftovers stay under calls/<sessionId>/ for a human to look at.
      deps.log(`NOT deleting R2 objects under ${keys.prefix}; check them by hand`)
      writeFileSync(path.join(dir, REJECTED), res.error)
      deps.log(`app rejected session ${meta.sessionId}: ${res.error}`)
      return 'rejected'
    }
    deps.log(`ingest failed for ${meta.sessionId}, will retry: ${res.error}`)
    return 'pending'
  } catch (err) {
    deps.log(`upload failed for ${meta.sessionId}, will retry: ${err instanceof Error ? err.message : String(err)}`)
    return 'pending'
  }
}

/** Audio is on R2 now: drop the local copies, keep the small session record. */
function cleanAudio(dir: string): void {
  rmSync(path.join(dir, 'seg'), { recursive: true, force: true })
  rmSync(path.join(dir, 'out'), { recursive: true, force: true })
}

/** Session dirs that still need finalizing (not uploaded, not refused), oldest first. */
export function pendingSessions(dataDir: string, exclude: string[] = []): string[] {
  if (!existsSync(dataDir)) return []
  return readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !exclude.includes(e.name))
    .map((e) => path.join(dataDir, e.name))
    .filter((d) => existsSync(path.join(d, SESSION_FILE)) && !existsSync(path.join(d, UPLOADED)) && !existsSync(path.join(d, REJECTED)) && !existsSync(path.join(d, STARTING)))
    .sort()
}

/** Remove finished session records older than a week. */
export function sweepOldSessions(dataDir: string, nowMs = Date.now()): number {
  if (!existsSync(dataDir)) return 0
  let removed = 0
  for (const e of readdirSync(dataDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const d = path.join(dataDir, e.name)
    const marker = [UPLOADED, REJECTED].map((m) => path.join(d, m)).find((m) => existsSync(m))
    if (marker && nowMs - statSync(marker).mtimeMs > KEEP_DONE_DAYS * 86_400_000) {
      rmSync(d, { recursive: true, force: true })
      removed++
    }
  }
  return removed
}
