/**
 * Orchestrates one recording at a time: join -> nickname + consent notice ->
 * capture -> stop (any stop condition) -> restore nickname -> queue finalize
 * (ffmpeg mix, R2 upload, ingest). Event serialization is the caller's job
 * (index.ts runs handleEvent calls one after another).
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Client, Guild, VoiceBasedChannel, VoiceState } from 'discord.js'
import { VoiceCapture } from './capture.js'
import type { Config } from './config.js'
import { consentNotice, lateJoinReminder } from './consent.js'
import { decideEventAction, type EventInfo } from './event-lifecycle.js'
import { finalizeSession, pendingSessions, writeSessionMeta, type FinalizeDeps } from './finalize.js'
import { purgeUsersInDir } from './manifest.js'
import { NicknameManager } from './nickname.js'
import type { OptOutCache } from './optouts.js'
import { StopTracker, type StopReason } from './stop-conditions.js'
import type { SessionMeta } from './types.js'

const TICK_MS = 10_000
const REMINDER_AFTER_MS = 5 * 60_000

interface ActiveSession {
  meta: SessionMeta
  dir: string
  guild: Guild
  capture: VoiceCapture
  tracker: StopTracker
  tick: NodeJS.Timeout
  reminded: Set<string>
  stopping: boolean
}

export class CallRecorder {
  private current: ActiveSession | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly queued = new Set<string>()
  private readonly botCache = new Map<string, boolean>()
  private retryTimer: NodeJS.Timeout | null = null
  /** Sessions finalized but not yet uploaded (shown on /health). */
  pendingCount = 0

  constructor(
    private readonly client: Client,
    private readonly cfg: Config,
    private readonly optOuts: OptOutCache,
    private readonly nick: NicknameManager,
    private readonly finalizeDeps: FinalizeDeps,
    private readonly log: (msg: string) => void,
  ) {}

  get currentEventId(): string | null {
    return this.current?.meta.eventId ?? null
  }

  status() {
    const c = this.current
    return c
      ? {
          sessionId: c.meta.sessionId,
          eventName: c.meta.eventName,
          startedAt: new Date(c.meta.startedAtMs).toISOString(),
          speakersWritten: c.capture.stats.size,
          speakingNow: c.capture.speakingNow.length,
          decryptFailures: c.capture.decryptFailures,
          rejoins: c.capture.rejoins,
        }
      : null
  }

  // ---- events ----------------------------------------------------------

  async handleEvent(info: EventInfo, fresh = true): Promise<void> {
    const action = decideEventAction(
      this.currentEventId,
      info,
      { callChannelId: this.cfg.callChannelId, maxCallMs: this.cfg.maxCallMinutes * 60_000, nowMs: Date.now() },
      fresh,
    )
    switch (action.type) {
      case 'ignore':
        return
      case 'stop':
        await this.stop(action.reason)
        return
      case 'switch':
        await this.stop(action.reason)
        await this.start(action.event)
        return
      case 'start':
        await this.start(action.event)
        return
    }
  }

  // ---- start / stop ----------------------------------------------------

  private async start(event: EventInfo): Promise<void> {
    if (this.current) return
    const startedAtMs = Date.now()
    const sessionId = `${event.id}-${startedAtMs}`
    const dir = path.join(this.cfg.dataDir, sessionId)
    mkdirSync(dir, { recursive: true })
    const meta: SessionMeta = {
      sessionId,
      eventId: event.id,
      eventName: event.name,
      channelId: this.cfg.callChannelId,
      startedAtMs,
      endedAtMs: null,
      endReason: null,
      partial: false,
    }
    writeSessionMeta(dir, meta)

    const guild = await this.client.guilds.fetch(this.cfg.guildId)
    const channel = (await guild.channels.fetch(this.cfg.callChannelId)) as VoiceBasedChannel | null
    if (!channel?.isVoiceBased()) {
      this.log(`channel ${this.cfg.callChannelId} is not a voice channel; not recording`)
      return
    }

    const capture = new VoiceCapture({
      guild,
      channelId: channel.id,
      dir,
      t0: startedAtMs,
      isBot: (id) => this.isBot(id),
      displayName: async (id) => {
        const member = await guild.members.fetch(id)
        return member.displayName
      },
      isOptedOut: (id) => this.optOuts.has(id),
      log: (m) => this.log(`[${sessionId}] ${m}`),
      onFatal: (reason) => void this.stop(reason as StopReason),
    })

    try {
      await capture.start()
    } catch (err) {
      this.log(`could not join the call channel: ${err instanceof Error ? err.message : String(err)}`)
      await capture.stop()
      return
    }

    // The nickname and the notice are how people learn they are being recorded.
    // If neither could be shown, do not record.
    const nickOk = await this.nick.acquire(guild)
    const noticeOk = await this.send(channel, consentNotice())
    if (!nickOk && !noticeOk) {
      this.log('could not show a recording indicator (nickname and notice both failed); leaving without recording')
      await capture.stop()
      return
    }

    const tracker = new StopTracker(startedAtMs, {
      maxCallMs: this.cfg.maxCallMinutes * 60_000,
      emptyGraceMs: this.cfg.emptyGraceMinutes * 60_000,
    })
    tracker.observeHumans(await this.humanCount(), Date.now())

    const session: ActiveSession = {
      meta,
      dir,
      guild,
      capture,
      tracker,
      reminded: new Set(),
      stopping: false,
      tick: setInterval(() => void this.onTick(), TICK_MS),
    }
    this.current = session
    this.log(`recording "${event.name}" as ${sessionId}`)
  }

  private async onTick(): Promise<void> {
    const s = this.current
    if (!s || s.stopping) return
    try {
      s.tracker.observeHumans(await this.humanCount(), Date.now())
    } catch (err) {
      this.log(`human count failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    const reason = s.tracker.check(Date.now())
    if (reason) await this.stop(reason)
  }

  async stop(reason: StopReason): Promise<void> {
    const s = this.current
    if (!s || s.stopping) return
    s.stopping = true
    clearInterval(s.tick)
    this.log(`stopping ${s.meta.sessionId}: ${reason}`)

    // Latest opt-outs apply to everything captured so far.
    await this.optOuts.refresh()
    await s.capture.stop()
    for (const id of purgeUsersInDir(s.dir, (u) => this.optOuts.has(u))) this.log(`dropped audio of opted-out ${id}`)

    s.meta.endedAtMs = Date.now()
    s.meta.endReason = reason
    s.meta.partial = s.capture.degraded
    writeSessionMeta(s.dir, s.meta)
    this.current = null

    await this.nick.release(s.guild)
    this.enqueueFinalize(s.dir)
  }

  /** Process shutdown: close the capture and leave the files for the next boot to finish. */
  async shutdown(): Promise<void> {
    const s = this.current
    if (!s) return
    s.stopping = true
    clearInterval(s.tick)
    await s.capture.stop()
    s.meta.endedAtMs = Date.now()
    s.meta.endReason = 'shutdown'
    s.meta.partial = true
    writeSessionMeta(s.dir, s.meta)
    this.current = null
    await this.nick.release(s.guild)
  }

  // ---- finalize --------------------------------------------------------

  private enqueueFinalize(dir: string): void {
    if (this.queued.has(dir)) return
    this.queued.add(dir)
    this.pendingCount++
    this.queue = this.queue.then(async () => {
      try {
        await this.optOuts.refresh()
        purgeUsersInDir(dir, (u) => this.optOuts.has(u))
        await finalizeSession(dir, this.finalizeDeps)
      } catch (err) {
        this.log(`finalize crashed for ${dir}: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        this.queued.delete(dir)
        this.pendingCount--
      }
    })
  }

  /** Finish sessions a crash, restart or outage left behind. */
  recoverPending(): void {
    const active = this.current ? [path.basename(this.current.dir)] : []
    for (const dir of pendingSessions(this.cfg.dataDir, active)) this.enqueueFinalize(dir)
  }

  startRetryLoop(everyMs = 10 * 60_000): void {
    this.retryTimer = setInterval(() => this.recoverPending(), everyMs)
    this.retryTimer.unref()
  }

  async drain(): Promise<void> {
    await this.queue
  }

  // ---- helpers ---------------------------------------------------------

  /** Late joiners get a one-line reminder (once per person per call). */
  onVoiceState(oldState: VoiceState, newState: VoiceState): void {
    const s = this.current
    if (!s || s.stopping) return
    if (newState.channelId !== this.cfg.callChannelId || oldState.channelId === newState.channelId) return
    if (Date.now() - s.meta.startedAtMs < REMINDER_AFTER_MS || s.reminded.has(newState.id)) return
    s.reminded.add(newState.id)
    void (async () => {
      if (await this.isBot(newState.id)) return
      const channel = newState.channel
      if (channel) await this.send(channel, lateJoinReminder(newState.id), [newState.id])
    })()
  }

  private async send(channel: VoiceBasedChannel, content: string, users: string[] = []): Promise<boolean> {
    try {
      await channel.send({ content, allowedMentions: { parse: [], users } })
      return true
    } catch (err) {
      this.log(`could not post in the voice channel chat: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  private async isBot(userId: string): Promise<boolean> {
    const hit = this.botCache.get(userId)
    if (hit !== undefined) return hit
    const user = await this.client.users.fetch(userId)
    this.botCache.set(userId, user.bot)
    return user.bot
  }

  private async humanCount(): Promise<number> {
    const guild = this.current?.guild ?? (await this.client.guilds.fetch(this.cfg.guildId))
    const ids = guild.voiceStates.cache.filter((vs) => vs.channelId === this.cfg.callChannelId).map((vs) => vs.id)
    let humans = 0
    for (const id of ids) if (!(await this.isBot(id))) humans++
    return humans
  }

  /** Opt-outs that arrive mid-call: stop recording those members and delete what exists. */
  purgeLive(ids: string[]): void {
    const s = this.current
    if (!s) return
    for (const id of ids) s.capture.purgeUser(id)
  }
}
