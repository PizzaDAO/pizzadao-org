/**
 * Orchestrates one recording at a time:
 *   join -> nickname -> consent notice -> start capturing -> stop (any stop
 *   condition) -> restore nickname -> queue finalize (ffmpeg mix, R2 upload, ingest).
 *
 * Indicator rule: no audio is subscribed to until the nickname or the notice is
 * visible; if neither can be shown the session is deleted without capturing.
 * Event serialization is the caller's job (index.ts passes `serial`).
 */
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { Client, Guild, VoiceBasedChannel, VoiceState } from 'discord.js'
import { VoiceCapture } from './capture.js'
import type { Config } from './config.js'
import { consentNotice, lateJoinReminder } from './consent.js'
import {
  decideWindowAction,
  eventKey,
  EventStatus,
  eventsInWindow,
  isFailureStop,
  RECOVERY_MS,
  NO_SHOW_GRACE_MS,
  StartBackoff,
  type EventInfo,
} from './event-lifecycle.js'
import { clearStarting, finalizeSession, markStarting, pendingSessions, writeSessionMeta, type FinalizeDeps } from './finalize.js'
import { SlotMemory } from './slots.js'
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
  /** Scheduled start of the event being recorded (forward-only switching). */
  eventStartMs: number | null
  /** eventKey of the event being recorded (back-off bookkeeping). */
  key: string
}

export class CallRecorder {
  private current: ActiveSession | null = null
  private starting: Promise<void> | null = null
  private shuttingDown = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly queued = new Set<string>()
  private readonly botCache = new Map<string, boolean>()
  private readonly backoff = new StartBackoff()
  private readonly slots: SlotMemory
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
    /** Runs a job on the event chain (index.ts); default runs it right away. */
    private readonly serial: (fn: () => Promise<void>) => void = (fn) => void fn(),
  ) {
    this.slots = new SlotMemory(path.join(cfg.dataDir, 'slots.json'), cfg.callChannelId, log)
  }

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

  /**
   * Schedule-window trigger: humans are in the call channel and an event's window covers now,
   * whatever its status. Called from voice-state changes, a periodic check and boot.
   */
  async checkSchedule(liveEvents: EventInfo[]): Promise<void> {
    // Remember every occurrence we see: Discord auto-ends an empty ACTIVE event and a recurring one
    // then jumps to next week, so the live list alone forgets today's slot.
    this.slots.observe(liveEvents, Date.now())
    const events = this.slots.merge(liveEvents)
    if (this.shuttingDown || this.starting) return
    if (this.current?.stopping) return
    let humans: number
    try {
      const guild = await this.client.guilds.fetch(this.cfg.guildId)
      humans = await this.humanCount(guild)
    } catch (err) {
      this.log(`schedule check failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    const opts = { callChannelId: this.cfg.callChannelId, maxCallMs: this.cfg.maxCallMinutes * 60_000, nowMs: Date.now() }
    // Back-off bookkeeping: a session that ran long enough recovered; closed windows are forgotten.
    const cur = this.current
    if (cur && opts.nowMs - cur.meta.startedAtMs >= RECOVERY_MS) this.backoff.clear(cur.key)
    this.backoff.prune(new Set([...eventsInWindow(events, opts).map(eventKey), ...(cur ? [cur.key] : [])]))
    const action = decideWindowAction({
      ...opts,
      currentEventId: this.currentEventId,
      currentStartMs: this.current?.eventStartMs ?? null,
      humans,
      events,
    })
    if ((action.type === 'start' || action.type === 'switch') && !this.backoff.allows(eventKey(action.event), Date.now())) return
    if (action.type === 'start' || action.type === 'switch') {
      const k = eventKey(action.event)
      const live = liveEvents.some(
        (e) => eventKey(e) === k && (e.status === EventStatus.Scheduled || e.status === EventStatus.Active),
      )
      if (!live) this.log(`slot from memory: "${action.event.name}" (${k})`)
    }
    if (action.type === 'start') {
      this.log(`humans present in the window of "${action.event.name}" (${action.event.id}); starting`)
      await this.start(action.event)
    } else if (action.type === 'switch') {
      this.log(`next event "${action.event.name}" (${action.event.id}) is starting; switching`)
      await this.stop(action.reason)
      await this.start(action.event)
    }
  }

  // ---- start / stop ----------------------------------------------------

  private async start(event: EventInfo): Promise<void> {
    if (this.current || this.starting) return
    this.starting = this.doStart(event).finally(() => {
      this.starting = null
    })
    await this.starting
  }

  private async doStart(event: EventInfo): Promise<void> {
    const startedAtMs = Date.now()
    const sessionId = `${event.id}-${startedAtMs}`
    const dir = path.join(this.cfg.dataDir, sessionId)
    mkdirSync(dir, { recursive: true })
    // Marker first: recovery must not finalize a session that is starting or live.
    markStarting(dir)
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

    let capture: VoiceCapture | null = null
    let nickAcquired = false
    let guild: Guild | null = null
    const abort = async (why: string) => {
      this.log(`not recording ${sessionId}: ${why}`)
      if (why !== 'shutting down') this.noteFailure(eventKey(event))
      try {
        await capture?.stop()
      } catch {
        // leaving anyway
      }
      if (nickAcquired && guild) await this.nick.release(guild)
      rmSync(dir, { recursive: true, force: true }) // nothing was captured
    }

    try {
      guild = await this.client.guilds.fetch(this.cfg.guildId)
      const channel = (await guild.channels.fetch(this.cfg.callChannelId)) as VoiceBasedChannel | null
      if (!channel?.isVoiceBased()) return await abort(`channel ${this.cfg.callChannelId} is not a voice channel`)
      const g = guild

      capture = new VoiceCapture({
        guild: g,
        channelId: channel.id,
        dir,
        t0: startedAtMs,
        isBot: (id) => this.isBot(id),
        displayName: async (id) => (await g.members.fetch(id)).displayName,
        isOptedOut: (id) => this.optOuts.has(id),
        log: (m) => this.log(`[${sessionId}] ${m}`),
        onFatal: (reason) => this.serial(() => this.stop(reason as StopReason)),
      })

      // 1. join (subscribes to nothing yet)
      try {
        await capture.start()
      } catch (err) {
        return await abort(`could not join the call channel: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (this.shuttingDown) return await abort('shutting down')

      // 2. + 3. the recording indicators. Without at least one, do not record.
      nickAcquired = await this.nick.acquire(g)
      const noticeOk = await this.send(channel, consentNotice())
      if (!nickAcquired && !noticeOk) return await abort('could not show a recording indicator (nickname and notice both failed)')
      if (this.shuttingDown) return await abort('shutting down')

      // 4. only now start capturing audio
      // Max duration counts from the scheduled start when the session began early.
      const tracker = new StopTracker(
        Math.max(startedAtMs, event.scheduledStartMs ?? 0),
        {
          maxCallMs: this.cfg.maxCallMinutes * 60_000,
          emptyGraceMs: this.cfg.emptyGraceMinutes * 60_000,
        },
        event.scheduledStartMs === null ? null : event.scheduledStartMs + NO_SHOW_GRACE_MS,
      )
      tracker.observeHumans(await this.humanCount(g), Date.now())
      capture.beginCapture()

      this.current = {
        meta,
        dir,
        guild: g,
        capture,
        tracker,
        reminded: new Set(),
        stopping: false,
        eventStartMs: event.scheduledStartMs,
        key: eventKey(event),
        tick: setInterval(() => this.serial(() => this.onTick()), TICK_MS),
      }
      this.log(`recording "${event.name}" as ${sessionId}`)
    } catch (err) {
      await abort(`start failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async onTick(): Promise<void> {
    const s = this.current
    if (!s || s.stopping) return
    try {
      s.tracker.observeHumans(await this.humanCount(s.guild), Date.now())
    } catch (err) {
      this.log(`human count failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    const reason = s.tracker.check(Date.now())
    if (reason) await this.stop(reason)
  }

  private noteFailure(key: string): void {
    if (this.backoff.noteFailure(key, Date.now())) this.log(`giving up on event ${key} after repeated failures`)
  }

  /** Stop the current recording. Every step is isolated: a failure in one never skips the rest. */
  async stop(reason: StopReason): Promise<void> {
    const s = this.current
    if (!s || s.stopping) return
    s.stopping = true
    clearInterval(s.tick)
    this.log(`stopping ${s.meta.sessionId}: ${reason}`)
    if (isFailureStop(reason)) {
      if (Date.now() - s.meta.startedAtMs >= RECOVERY_MS) this.backoff.clear(s.key) // it had recovered
      this.noteFailure(s.key)
    }

    try {
      // Latest opt-outs apply to everything captured so far (finalize re-checks that they loaded).
      await this.step('refresh opt-outs', () => this.optOuts.refresh())
      if (!(await this.step('stop capture', () => s.capture.stop()))) s.capture.degraded = true
      await this.step('purge opted-out audio', async () => {
        for (const id of purgeUsersInDir(s.dir, (u) => this.optOuts.has(u))) this.log(`dropped audio of opted-out ${id}`)
      })
    } finally {
      this.current = null
      await this.step('write session record', async () => {
        s.meta.endedAtMs = Date.now()
        s.meta.endReason = reason
        s.meta.partial = s.capture.degraded
        writeSessionMeta(s.dir, s.meta)
      })
      // Its own step: a failed meta write must not leave the dir marked "starting" forever.
      await this.step('clear starting marker', async () => clearStarting(s.dir))
      await this.step('restore nickname', () => this.nick.release(s.guild))
      this.enqueueFinalize(s.dir)
    }
  }

  /** Process shutdown: close the capture and leave the files for the next boot to finish. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.starting) await this.starting.catch(() => undefined)
    const s = this.current
    if (!s) return
    s.stopping = true
    clearInterval(s.tick)
    try {
      await this.step('stop capture', () => s.capture.stop())
    } finally {
      this.current = null
      await this.step('write session record', async () => {
        s.meta.endedAtMs = Date.now()
        s.meta.endReason = 'shutdown'
        s.meta.partial = true
        writeSessionMeta(s.dir, s.meta)
      })
      await this.step('clear starting marker', async () => clearStarting(s.dir))
      await this.step('restore nickname', () => this.nick.release(s.guild))
    }
  }

  /** Run one cleanup step; returns whether it succeeded (never throws). */
  private async step(name: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn()
      return true
    } catch (err) {
      this.log(`${name} failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  // ---- finalize --------------------------------------------------------

  private enqueueFinalize(dir: string): void {
    if (this.queued.has(dir)) return
    this.queued.add(dir)
    this.pendingCount++
    this.queue = this.queue.then(async () => {
      try {
        // Nothing is uploaded unless the opt-out list loaded just now: otherwise an opted-out
        // member's audio could reach R2. The session stays pending and is retried.
        const fresh = await this.optOuts.refresh()
        if (!fresh || !this.optOuts.isLoaded) {
          this.log(`opt-out list unavailable; keeping ${path.basename(dir)} pending`)
          return
        }
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

  /** Finish sessions a crash, restart or outage left behind (live and starting ones are skipped). */
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

  private async humanCount(guild: Guild): Promise<number> {
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
