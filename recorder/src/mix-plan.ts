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

/** Above this the inline filter graph risks the OS argv limit; the track is skipped. */
export const MAX_SEGMENTS_PER_TRACK = 2500

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
