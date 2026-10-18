/**
 * Discord sends no packets while someone is silent, so a segment written from
 * raw packets would squeeze every pause shut. GapFiller says how many Opus
 * silence frames to insert before each packet so the file stays on the
 * wall clock. It tracks cumulative drift (not per-packet gaps), so network
 * jitter and bursts do not accumulate error.
 */

export const OPUS_FRAME_MS = 20
/** Opus "silence" frame (what Discord itself sends at the end of speech). */
export const OPUS_SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe])

export class GapFiller {
  private frames = 0
  private readonly startMs: number

  constructor(startMs: number, private readonly maxFillFrames = 100) {
    this.startMs = startMs
  }

  /** Silence frames to emit before the packet that arrived at `nowMs`. */
  onPacket(nowMs: number): number {
    const expectedMs = this.startMs + this.frames * OPUS_FRAME_MS
    const driftMs = nowMs - expectedMs
    let fill = driftMs >= 2 * OPUS_FRAME_MS ? Math.floor(driftMs / OPUS_FRAME_MS) : 0
    fill = Math.min(fill, this.maxFillFrames)
    this.frames += fill + 1
    return fill
  }
}
