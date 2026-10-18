/**
 * ffmpeg argument builders (pure). Two stages:
 *   1. one aligned Ogg/Opus track per speaker: every captured segment delayed to
 *      its start offset and summed (segments of one speaker do not overlap);
 *   2. one m4a mix of all speaker tracks.
 * Filters are passed inline; a speaker has at most a few hundred segments in a
 * two hour call, far below argv limits (see MAX_SEGMENTS_PER_TRACK).
 */

export interface PlanSegment {
  file: string
  startMs: number
}

/** Sanity cap; beyond this a track is skipped (the call would have ~40 bursts a minute from one person for 8 hours). */
export const MAX_SEGMENTS_PER_TRACK = 20000

const COMMON = ['-y', '-hide_banner', '-loglevel', 'error']

export function buildSpeakerTrackArgs(segments: PlanSegment[], outFile: string): string[] {
  if (segments.length === 0) throw new Error('No segments')
  if (segments.length > MAX_SEGMENTS_PER_TRACK) throw new Error(`Too many segments (${segments.length})`)
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  const inputs = sorted.flatMap((s) => ['-i', s.file])
  const delay = (s: PlanSegment) => `adelay=${Math.max(0, Math.round(s.startMs))}:all=1`
  const labels = sorted.map((_, i) => `[a${i}]`).join('')
  const graph =
    sorted.length === 1
      ? `[0:a]${delay(sorted[0])}[out]`
      : `${sorted.map((s, i) => `[${i}:a]${delay(s)}[a${i}]`).join(';')};${labels}amix=inputs=${sorted.length}:normalize=0:duration=longest[out]`
  return [
    ...COMMON,
    ...inputs,
    '-filter_complex', graph,
    '-map', '[out]',
    '-ac', '1',
    '-c:a', 'libopus',
    '-b:a', '32k',
    outFile,
  ]
}

/** At most this many input files are open in one ffmpeg pass (fd limit safety). */
export const MAX_INPUTS_PER_PASS = 200

/**
 * The ffmpeg passes that build one speaker's track, in order. Up to
 * MAX_INPUTS_PER_PASS segments is a single pass; more are built in chunks
 * (each chunk is aligned to the call timeline, written at 64k) and then summed
 * into the final track, so a chatty speaker never opens thousands of files.
 */
export function buildSpeakerTrackPlan(segments: PlanSegment[], outFile: string, chunkPrefix: string): string[][] {
  if (segments.length <= MAX_INPUTS_PER_PASS) return [buildSpeakerTrackArgs(segments, outFile)]
  if (segments.length > MAX_SEGMENTS_PER_TRACK) throw new Error(`Too many segments (${segments.length})`)
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  const passes: string[][] = []
  const chunkFiles: string[] = []
  for (let i = 0; i < sorted.length; i += MAX_INPUTS_PER_PASS) {
    const file = `${chunkPrefix}.part${chunkFiles.length}.ogg`
    chunkFiles.push(file)
    const args = buildSpeakerTrackArgs(sorted.slice(i, i + MAX_INPUTS_PER_PASS), file)
    args[args.indexOf('32k')] = '64k'
    passes.push(args)
  }
  passes.push(buildSpeakerTrackArgs(chunkFiles.map((file) => ({ file, startMs: 0 })), outFile))
  return passes
}

export function buildMixArgs(trackFiles: string[], outFile: string): string[] {
  if (trackFiles.length === 0) throw new Error('No tracks')
  const inputs = trackFiles.flatMap((f) => ['-i', f])
  const labels = trackFiles.map((_, i) => `[${i}:a]`).join('')
  const graph =
    trackFiles.length === 1
      ? '[0:a]alimiter=limit=0.95[out]'
      : `${labels}amix=inputs=${trackFiles.length}:normalize=0:duration=longest,alimiter=limit=0.95[out]`
  return [
    ...COMMON,
    ...inputs,
    '-filter_complex', graph,
    '-map', '[out]',
    '-ac', '1',
    '-ar', '48000',
    '-c:a', 'aac',
    '-b:a', '48k',
    '-movflags', '+faststart',
    outFile,
  ]
}
