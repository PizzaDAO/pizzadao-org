/**
 * Voice capture: joins a voice channel (DAVE), and writes one Ogg/Opus segment
 * per burst of speech per speaker under <dir>/seg/<userId>/<startMs>.ogg, with
 * a manifest line per finished segment. Used by the recorder and by the Phase 0
 * spike (`npm run spike`).
 *
 * - Bots are never recorded; everyone else in the channel is.
 * - Segments hit disk as they stream, so a crash loses only the last packets.
 * - DAVE: the patched @discordjs/voice (patches/) recovers a session whose
 *   decryption never starts (upstream #11653). On top of that a per-user
 *   watchdog counts bursts that deliver no audio; repeated empty bursts trigger
 *   one rejoin (a rejoin forms a fresh MLS group), rate limited.
 * - Disconnects rejoin automatically, with backoff, up to MAX_REJOINS in a row.
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { Transform, pipeline } from 'node:stream'
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from '@discordjs/voice'
import type { Guild } from 'discord.js'
import { GapFiller, OPUS_SILENCE_FRAME } from './gap-filler.js'
import { appendRecord } from './manifest.js'
import { OggOpusWriter } from './ogg-opus.js'

const SILENCE_AFTER_MS = 1000
const NO_AUDIO_TIMEOUT_MS = 4000
const EMPTY_BURSTS_BEFORE_REJOIN = 3
const MIN_TROUBLE_REJOIN_GAP_MS = 60_000
const MAX_REJOINS = 5

export interface CaptureDeps {
  guild: Guild
  channelId: string
  /** Session directory (must exist). */
  dir: string
  /** Epoch ms that segment offsets are relative to. */
  t0: number
  isBot: (userId: string) => Promise<boolean>
  displayName: (userId: string) => Promise<string>
  log: (msg: string) => void
  /** Called when the connection cannot be re-established; the session should stop. */
  onFatal: (reason: string) => void
}

export interface UserStats {
  segments: number
  packets: number
  bytes: number
}

interface OpenSegment {
  userId: string
  file: string
  abs: string
  startMs: number | null
  lastPacketWall: number
  packets: number
  opus: ReturnType<VoiceConnection['receiver']['subscribe']>
  out: WriteStream
  watchdog: NodeJS.Timeout
  discard: boolean
}

export class VoiceCapture {
  readonly stats = new Map<string, UserStats>()
  /** Packets that failed DAVE decryption (from the voice library's debug log). */
  decryptFailures = 0
  emptyBursts = 0
  streamErrors = 0
  rejoins = 0
  /** True once anything went wrong that could leave a speaker's audio incomplete. */
  degraded = false

  private connection: VoiceConnection | null = null
  private stopping = false
  private capturing = false
  private readonly open = new Map<string, OpenSegment>()
  private readonly pending = new Set<string>()
  private readonly bots = new Set<string>()
  private readonly named = new Set<string>()
  private readonly emptyStreak = new Map<string, number>()
  private lastTroubleRejoin = 0
  private consecutiveRejoinFailures = 0
  private rejoining = false

  constructor(private readonly d: CaptureDeps) {
    mkdirSync(path.join(d.dir, 'seg'), { recursive: true })
  }

  /** Join the channel. Nothing is subscribed to until `beginCapture()`. */
  async start(): Promise<void> {
    await this.join()
  }

  /**
   * Start recording audio. Call only after the recording indicator (nickname or
   * notice) is visible: join -> nickname -> notice -> beginCapture.
   */
  beginCapture(): void {
    this.capturing = true
  }

  /** Users whose audio is being written right now. */
  get speakingNow(): string[] {
    return [...this.open.keys()]
  }

  private async join(): Promise<void> {
    const conn = joinVoiceChannel({
      channelId: this.d.channelId,
      guildId: this.d.guild.id,
      adapterCreator: this.d.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
      debug: true,
    })
    this.connection = conn

    conn.on('debug', (msg: string) => {
      if (msg.includes('Failed to decrypt a packet')) this.decryptFailures++
    })
    conn.on('error', (err: Error) => this.d.log(`voice connection error: ${err.message}`))
    conn.on(VoiceConnectionStatus.Disconnected, () => void this.onDisconnected(conn))

    await entersState(conn, VoiceConnectionStatus.Ready, 20_000)

    conn.receiver.speaking.on('start', (userId: string) => void this.onSpeakingStart(userId))
    this.d.log(`joined voice channel ${this.d.channelId}`)
  }

  private async onDisconnected(conn: VoiceConnection): Promise<void> {
    if (this.stopping || conn !== this.connection) return
    try {
      // Discord is moving us (channel change) or reconnecting: give it a moment.
      await Promise.race([
        entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
        entersState(conn, VoiceConnectionStatus.Connecting, 5_000),
      ])
    } catch {
      await this.rejoin('disconnected')
    }
  }

  /** Drop the connection and join again (also forms a fresh DAVE group). */
  private async rejoin(reason: string): Promise<void> {
    if (this.stopping || this.rejoining) return
    this.rejoining = true
    this.degraded = true
    try {
      for (let attempt = 1; attempt <= MAX_REJOINS && !this.stopping; attempt++) {
        this.rejoins++
        this.d.log(`rejoining voice (${reason}), attempt ${attempt}`)
        this.closeAllSegments()
        try {
          this.connection?.destroy()
        } catch {
          // already destroyed
        }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 15_000)))
        if (this.stopping) return
        try {
          await this.join()
          this.consecutiveRejoinFailures = 0
          return
        } catch (err) {
          this.consecutiveRejoinFailures++
          this.d.log(`rejoin failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (!this.stopping) this.d.onFatal('disconnected')
    } finally {
      this.rejoining = false
    }
  }

  private async onSpeakingStart(userId: string): Promise<void> {
    if (!this.capturing || this.stopping || this.open.has(userId) || this.pending.has(userId)) return
    if (this.bots.has(userId)) return
    this.pending.add(userId)
    try {
      if (await this.d.isBot(userId)) {
        this.bots.add(userId)
        return
      }
      if (this.stopping) return
      await this.nameOnce(userId)
      this.openSegment(userId)
    } catch (err) {
      this.d.log(`could not start capturing ${userId}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.pending.delete(userId)
    }
  }

  private async nameOnce(userId: string): Promise<void> {
    if (this.named.has(userId)) return
    this.named.add(userId)
    let displayName = userId
    try {
      displayName = await this.d.displayName(userId)
    } catch {
      // keep the id
    }
    appendRecord(this.d.dir, { t: 'member', userId, displayName })
  }

  private openSegment(userId: string): void {
    const conn = this.connection
    if (!conn) return
    const openedAt = Date.now()
    const file = path.join('seg', userId, `${openedAt - this.d.t0}.ogg`)
    const abs = path.join(this.d.dir, file)
    mkdirSync(path.dirname(abs), { recursive: true })

    const opus = conn.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_AFTER_MS },
    })
    const ogg = new OggOpusWriter(2)
    const out = createWriteStream(abs)

    const seg: OpenSegment = {
      userId,
      file,
      abs,
      startMs: null,
      lastPacketWall: openedAt,
      packets: 0,
      opus,
      out,
      discard: false,
      watchdog: setTimeout(() => {
        // Speaking was signalled but no audio arrived: decryption is not working for this user.
        if (seg.packets === 0) opus.destroy()
      }, NO_AUDIO_TIMEOUT_MS),
    }
    let filler: GapFiller | null = null
    const t0 = this.d.t0

    const gate = new Transform({
      objectMode: true,
      transform(chunk: Buffer, _enc, cb) {
        const now = Date.now()
        if (!filler) {
          // The first packet is the true start of the audio in this file.
          filler = new GapFiller(now)
          seg.startMs = now - t0
        }
        const fill = filler.onPacket(now)
        for (let i = 0; i < fill; i++) this.push(OPUS_SILENCE_FRAME)
        this.push(chunk)
        seg.packets++
        seg.lastPacketWall = now
        cb()
      },
    })

    this.open.set(userId, seg)
    pipeline(opus, gate, ogg, out, (err) => this.onSegmentDone(seg, err))
  }

  private onSegmentDone(seg: OpenSegment, err: Error | null | undefined): void {
    clearTimeout(seg.watchdog)
    if (this.open.get(seg.userId) === seg) this.open.delete(seg.userId)

    if (seg.discard) {
      rmSync(seg.abs, { force: true })
      return
    }
    // A pipeline torn down on purpose (stop/rejoin) is not an error worth counting.
    if (err && !this.stopping && (err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      this.streamErrors++
      this.degraded = true
      this.d.log(`segment stream error for ${seg.userId}: ${err.message}`)
    }

    if (seg.packets === 0) {
      rmSync(seg.abs, { force: true })
      if (this.stopping) return
      this.emptyBursts++
      const streak = (this.emptyStreak.get(seg.userId) ?? 0) + 1
      this.emptyStreak.set(seg.userId, streak)
      this.d.log(`no audio decoded for ${seg.userId} (${streak} in a row)`)
      if (streak >= EMPTY_BURSTS_BEFORE_REJOIN && Date.now() - this.lastTroubleRejoin > MIN_TROUBLE_REJOIN_GAP_MS) {
        this.lastTroubleRejoin = Date.now()
        this.emptyStreak.clear()
        void this.rejoin('decrypt-trouble')
      }
      return
    }

    this.emptyStreak.delete(seg.userId)
    const bytes = existsSync(seg.abs) ? statSync(seg.abs).size : 0
    const startMs = seg.startMs ?? seg.lastPacketWall - this.d.t0
    appendRecord(this.d.dir, {
      t: 'segment',
      userId: seg.userId,
      startMs,
      endMs: seg.lastPacketWall - this.d.t0,
      file: seg.file,
      bytes,
    })
    const s = this.stats.get(seg.userId) ?? { segments: 0, packets: 0, bytes: 0 }
    s.segments++
    s.packets += seg.packets
    s.bytes += bytes
    this.stats.set(seg.userId, s)
  }

  private closeAllSegments(): void {
    for (const seg of [...this.open.values()]) seg.opus.destroy()
  }

  /** Leave the channel and finish writing open segments. */
  async stop(): Promise<void> {
    this.stopping = true
    const finished = [...this.open.values()].map(
      (seg) => new Promise<void>((resolve) => seg.out.once('close', () => resolve())),
    )
    // End (not destroy) the streams so the Ogg writer flushes its last page.
    for (const seg of this.open.values()) seg.opus.push(null)
    await Promise.race([Promise.all(finished), new Promise((r) => setTimeout(r, 5000))])
    this.closeAllSegments()
    try {
      this.connection?.destroy()
    } catch {
      // already gone
    }
    this.connection = null
  }
}
