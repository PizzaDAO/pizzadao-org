/**
 * Orchestrates one recording at a time:
 *   join -> nickname -> consent notice -> start capturing -> stop (any stop
 *   condition) -> restore nickname -> queue finalize (ffmpeg mix, R2 upload, ingest).
 *
 * Indicator rule: no audio is subscribed to until the nickname or the notice is
 * visible; if neither can be shown the session is deleted without capturing.
 * Event serialization is the caller's job (index.ts passes `serial`).
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { Client, Guild, Message, PartialMessage, VoiceBasedChannel, VoiceState } from 'discord.js'
import { VoiceCapture } from './capture.js'
import { CallLimits } from './call-limits.js'
import { eventCapMinutes, maxMinutesFor, type Config } from './config.js'
import { callDisplayName, consentNotice, lateJoinWelcome, mentionedIds, MAX_WELCOME_MENTIONS, welcomeBatch, welcomeOpening } from './consent.js'
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
import { appendRecord, MAX_CHAT_TEXT } from './manifest.js'
import { EndSongMarker, isEndSongStop, postPlayCrew } from './end-song.js'
import { SlotMemory } from './slots.js'
import { NicknameManager } from './nickname.js'
import { StopTracker, type StopReason } from './stop-conditions.js'
import { REMOTE_CONFIG_OFF, REMOTE_CONFIG_START_WAIT_MS, type RemoteConfig, type RemoteConfigClient } from './remote-config.js'
import type { SessionMeta } from './types.js'
import { LiveItems, postLive, type LiveRequest } from './live-items.js'

const TICK_MS = 10_000
const REMINDER_AFTER_MS = 5 * 60_000

interface WelcomeState {
  cfg: RemoteConfig['welcome']
  callName: string
  channel: VoiceBasedChannel | null
  queue: string[]
  timer: NodeJS.Timeout | null
}

interface EndSongState {
  minHumans: number
  /** The crew name pizza-radio's /play-crew expects. */
  crew: string
  /** When the call is scheduled to end (event end, else start + the crew's call length); null: only stop reasons fire. */
  endMs: number | null
  fired: boolean
}

interface ActiveSession {
  meta: SessionMeta
  dir: string
  guild: Guild
  capture: VoiceCapture
  tracker: StopTracker
  tick: NodeJS.Timeout
  reminded: Set<string>
  /** Batched welcomes (settings snapshot at session start); null: the old late-joiner welcome applies. */
  welcome: WelcomeState | null
  /** End-of-call song (settings snapshot at session start); null: off. */
  endSong: EndSongState | null
  stopping: boolean
  /** Scheduled start of the event being recorded (forward-only switching). */
  eventStartMs: number | null
  /** eventKey of the event being recorded (back-off bookkeeping). */
  key: string
  /** Voice-channel members already written to the manifest as present. */
  present: Set<string>
  /** Live action items (settings snapshot at session start); null: off for this call. */
  live: LiveItems | null
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
  private readonly limits: CallLimits
  private readonly endSongMarker: EndSongMarker
  private warnedNoRadio = false
  private retryTimer: NodeJS.Timeout | null = null
  /** Sessions finalized but not yet uploaded (shown on /health). */
  pendingCount = 0

  constructor(
    private readonly client: Client,
    private readonly cfg: Config,
    private readonly nick: NicknameManager,
    private readonly finalizeDeps: FinalizeDeps,
    private readonly log: (msg: string) => void,
    /** Runs a job on the event chain (index.ts); default runs it right away. */
    private readonly serial: (fn: () => Promise<void>) => void = (fn) => void fn(),
    /** Admin settings from the app (all-off until fetched); optional so tests and the spike run without it. */
    private readonly remote: RemoteConfigClient | null = null,
    /** Live action items request (tests inject it); default POSTs to the app. */
    private readonly livePost: ((body: LiveRequest) => Promise<string[]>) | null = null,
  ) {
    this.slots = new SlotMemory(path.join(cfg.dataDir, 'slots.json'), cfg.callChannelId, log)
    this.limits = new CallLimits(path.join(cfg.dataDir, 'call-limits.json'), log)
    this.endSongMarker = new EndSongMarker(path.join(cfg.dataDir, 'end-song.json'), log)
  }

  private eventLimitMs(eventName: string): number {
    return maxMinutesFor(this.cfg, eventName) * 60_000
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
    // The call being recorded keeps its slot even if its event was rescheduled mid-call.
    const keep = new Set(this.current ? [this.current.key] : [])
    this.slots.observe(liveEvents, Date.now(), keep)
    const events = this.slots.merge(liveEvents, keep)
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
    const nowMs = Date.now()
    if (humans === 0) this.limits.noteChannelEmpty(nowMs)
    const opts = {
      callChannelId: this.cfg.callChannelId,
      maxCallMs: this.cfg.maxCallMinutes * 60_000,
      nowMs,
      blocked: (e: EventInfo) => this.limits.blocks(e, nowMs),
    }
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
    // Fresh settings for this session (5 s cap, never throws; failure keeps the last good value or all-off).
    await this.remote?.refresh(REMOTE_CONFIG_START_WAIT_MS)
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
    let live: LiveItems | null = null
    const names = new Map<string, string>()
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
        displayName: async (id) => {
          const name = (await g.members.fetch(id)).displayName
          names.set(id, name)
          return name
        },
        log: (m) => this.log(`[${sessionId}] ${m}`),
        onFatal: (reason) => this.serial(() => this.stop(reason as StopReason)),
        onSegment: (rec) => live?.onSegment(rec),
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
      // With welcomes on, the opening message greets everyone already here and still carries the full notice.
      const rc = this.remote?.get() ?? REMOTE_CONFIG_OFF
      const callName = callDisplayName(rc.crews.find((c) => c.eventId === event.id)?.label, event.name)
      const endSong = this.endSongFor(event, rc)
      let present: string[] = []
      if (rc.welcome.enabled) {
        try {
          present = await this.humanIds(g)
        } catch {
          present = []
        }
      }
      const noticeOk = rc.welcome.enabled
        ? await this.send(channel, welcomeOpening(rc.welcome.template, present, callName), mentionedIds(present))
        : await this.send(channel, consentNotice())
      if (!nickAcquired && !noticeOk) return await abort('could not show a recording indicator (nickname and notice both failed)')
      if (this.shuttingDown) return await abort('shutting down')

      // 4. only now start capturing audio
      // Max duration counts from the scheduled start when the session began early. A capped event
      // keeps counting from its first session, so a redeploy or rejoin cannot reset the limit.
      const limitBaseMs = Math.max(startedAtMs, event.scheduledStartMs ?? 0)
      const limitMs = this.eventLimitMs(event.name)
      const capped = eventCapMinutes(this.cfg, event.name) !== undefined
      const tracker = new StopTracker(
        capped ? this.limits.noteStart(event.id, { baseMs: limitBaseMs, limitMs, startMs: event.scheduledStartMs ?? limitBaseMs }) : limitBaseMs,
        {
          maxCallMs: limitMs,
          emptyGraceMs: this.cfg.emptyGraceMinutes * 60_000,
        },
        event.scheduledStartMs === null ? null : event.scheduledStartMs + NO_SHOW_GRACE_MS,
      )
      tracker.observeHumans(await this.humanCount(g), Date.now())
      live = this.liveFor(event, rc, { sessionId, dir, startedAtMs, channel, names })
      capture.beginCapture()
      live?.start()

      this.current = {
        meta,
        dir,
        guild: g,
        capture,
        tracker,
        reminded: new Set(present),
        endSong,
        welcome: rc.welcome.enabled ? { cfg: rc.welcome, callName, channel: null, queue: [], timer: null } : null,
        stopping: false,
        eventStartMs: event.scheduledStartMs,
        key: eventKey(event),
        present: new Set(),
        live,
        tick: setInterval(() => this.serial(() => this.onTick()), TICK_MS),
      }
      await this.notePresent(this.current)
      this.log(`recording "${event.name}" as ${sessionId}`)
    } catch (err) {
      live?.stop()
      await abort(`start failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Live action items for this call, or null (off, or the crew is not on the allowlist). */
  private liveFor(
    event: EventInfo,
    rc: RemoteConfig,
    o: { sessionId: string; dir: string; startedAtMs: number; channel: VoiceBasedChannel; names: Map<string, string> },
  ): LiveItems | null {
    const l = rc.liveItems
    if (!(l.audio || l.chat) || !l.eventIds.includes(event.id)) return null
    // Chat items need the chat capture (MessageContent intent).
    const cfg = { ...l, chat: l.chat && this.cfg.captureVoiceChat }
    if (!cfg.audio && !cfg.chat) return null
    this.log(`live action items on for "${event.name}" (speech: ${cfg.audio ? `every ${cfg.chunkSeconds}s` : 'off'}, chat: ${cfg.chat ? 'on' : 'off'})`)
    return new LiveItems({
      sessionId: o.sessionId,
      eventId: event.id,
      eventName: event.name,
      startedAtMs: o.startedAtMs,
      dir: o.dir,
      cfg,
      uploader: this.finalizeDeps.uploader,
      post: this.livePost ?? ((body) => postLive(this.cfg.appBaseUrl, this.cfg.recorderApiKey, body, this.log)),
      send: (text) => this.send(o.channel, text),
      nameOf: (id) => o.names.get(id) ?? null,
      log: (m) => this.log(`[${o.sessionId}] ${m}`),
    })
  }

  private async onTick(): Promise<void> {
    const s = this.current
    if (!s || s.stopping) return
    let humans = 0
    try {
      humans = await this.humanCount(s.guild)
      s.tracker.observeHumans(humans, Date.now())
    } catch (err) {
      this.log(`human count failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    await this.notePresent(s)
    const reason = s.tracker.check(Date.now())
    if (reason) await this.stop(reason)
    else if (s.endSong && !s.endSong.fired && s.endSong.endMs !== null && Date.now() >= s.endSong.endMs) {
      // The scheduled end passed and the call is still going: that is the end of the call for the song.
      this.fireEndSong(s, humans, 'scheduled end')
    }
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
    this.cancelWelcome(s)
    s.live?.stop()
    this.log(`stopping ${s.meta.sessionId}: ${reason}`)
    if (s.endSong && isEndSongStop(reason)) {
      // The call really ended with people possibly still here. empty / superseded / shutdown / disconnected never play.
      let humans = 0
      try {
        humans = await this.humanCount(s.guild)
      } catch {
        // cannot tell who is here: stay quiet
      }
      this.fireEndSong(s, humans, reason)
    }
    if (s.meta.eventId) {
      if (reason === 'max-duration') this.limits.noteHit(s.meta.eventId, Date.now())
      else this.limits.noteEndedBeforeBase(s.meta.eventId, Date.now())
    }
    if (isFailureStop(reason)) {
      if (Date.now() - s.meta.startedAtMs >= RECOVERY_MS) this.backoff.clear(s.key) // it had recovered
      this.noteFailure(s.key)
    }

    try {
      if (!(await this.step('stop capture', () => s.capture.stop()))) s.capture.degraded = true
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

  /** Settings snapshot for the end-of-call song, or null when it is off / cannot work here. */
  private endSongFor(event: EventInfo, rc: RemoteConfig): EndSongState | null {
    if (!rc.endSong.enabled) return null
    if (!this.cfg.pizzaRadio) {
      if (!this.warnedNoRadio) {
        this.warnedNoRadio = true
        this.log('end song is on in the settings but PIZZA_RADIO_URL / PIZZA_RADIO_API_KEY are not set: not playing')
      }
      return null
    }
    const crew = rc.crews.find((c) => c.eventId === event.id)
    if (!crew) {
      this.log(`end song: no crew mapped to event ${event.id}; not playing for "${event.name}"`)
      return null
    }
    // Only crews pizza-radio knows (calls.endSongCrewMap); the radio's own name is what is sent.
    const key = (s: string) => s.trim().toLowerCase()
    const radio = rc.endSong.crewMap.find((m) => key(m.crew) === key(crew.label))?.radio
    if (!radio) {
      this.log(`end song: crew "${crew.label}" is not in the end-song crew map; not playing`)
      return null
    }
    const endMs =
      event.scheduledEndMs ??
      (event.scheduledStartMs !== null && crew.callMinutes ? event.scheduledStartMs + crew.callMinutes * 60_000 : null)
    return { minHumans: rc.endSong.minHumans, crew: radio, endMs, fired: false }
  }

  /** Ask pizza-radio to play the crew song, at most once per call occurrence. Never throws, never blocks. */
  private fireEndSong(s: ActiveSession, humans: number, why: string): void {
    const e = s.endSong
    const radio = this.cfg.pizzaRadio
    if (!e || e.fired || !radio) return
    if (humans < e.minHumans) {
      if (isEndSongStop(why)) this.log(`end song skipped (${why}): ${humans} in the channel, needs ${e.minHumans}`)
      return
    }
    e.fired = true
    if (this.endSongMarker.has(s.key)) return // already played for this occurrence (restart or switch)
    this.log(`end song (${why}): asking pizza-radio to play "${e.crew}"`)
    // The "already played" marker is written only once pizza-radio answered: a 2xx, or a 4xx that retrying will
    // not fix (logged once, marked so it does not loop). A network error or 5xx after the retry leaves it unmarked.
    void postPlayCrew(radio.url, radio.apiKey, e.crew, this.cfg.callChannelId, this.log)
      .then((outcome) => {
        if (outcome === 'failed') this.log('end song: pizza-radio unreachable; not marked as played')
        else this.endSongMarker.mark(s.key, Date.now())
      })
      .catch((err) => this.log(`end song failed: ${err instanceof Error ? err.message : String(err)}`))
  }

  /** Process shutdown: close the capture and leave the files for the next boot to finish. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.starting) await this.starting.catch(() => undefined)
    const s = this.current
    if (!s) return
    s.stopping = true
    clearInterval(s.tick)
    this.cancelWelcome(s)
    s.live?.stop()
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
        const status = await finalizeSession(dir, this.finalizeDeps)
        if (status !== 'pending') for (const [id, d] of this.capturedChat) if (d === dir) this.capturedChat.delete(id)
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

  /** Late joiners get a one-line welcome (once per person per call). */
  onVoiceState(oldState: VoiceState, newState: VoiceState): void {
    const s = this.current
    if (!s || s.stopping) return
    if (newState.channelId !== this.cfg.callChannelId || oldState.channelId === newState.channelId) return
    if (s.welcome) {
      this.queueWelcome(s, s.welcome, newState)
      return
    }
    if (Date.now() - s.meta.startedAtMs < REMINDER_AFTER_MS || s.reminded.has(newState.id)) return
    s.reminded.add(newState.id)
    void (async () => {
      if (await this.isBot(newState.id)) return
      const channel = newState.channel
      if (channel) await this.send(channel, lateJoinWelcome(newState.id), [newState.id])
    })()
  }

  /** Welcomes on: a new human joiner waits for the batch window, once per member per call (rejoins are skipped). */
  private queueWelcome(s: ActiveSession, w: WelcomeState, state: VoiceState): void {
    if (s.reminded.has(state.id)) return
    s.reminded.add(state.id)
    void (async () => {
      try {
        if (await this.isBot(state.id)) return
      } catch {
        return
      }
      if (s.stopping || this.current !== s) return
      w.queue.push(state.id)
      if (state.channel) w.channel = state.channel
      if (!w.timer) {
        w.timer = setTimeout(() => void this.flushWelcome(s, w), w.cfg.batchSeconds * 1000)
        w.timer.unref?.()
      }
    })()
  }

  private async flushWelcome(s: ActiveSession, w: WelcomeState): Promise<void> {
    w.timer = null
    const ids = w.queue.splice(0)
    if (!ids.length || s.stopping || this.current !== s || !w.channel) return
    for (let i = 0; i < ids.length; i += MAX_WELCOME_MENTIONS) {
      const chunk = ids.slice(i, i + MAX_WELCOME_MENTIONS)
      // Overflow beyond one message: the last chunk of a very large batch still mentions its own ids.
      await this.send(w.channel, welcomeBatch(w.cfg.template, chunk, w.callName, w.cfg.recordingLine), mentionedIds(chunk))
    }
  }

  private cancelWelcome(s: ActiveSession): void {
    if (s.welcome?.timer) clearTimeout(s.welcome.timer)
    if (s.welcome) {
      s.welcome.timer = null
      s.welcome.queue = []
    }
  }

  // ---- voice channel text chat -----------------------------------------

  private warnedEmptyContent = false
  /**
   * Captured chat message id -> its session dir. Kept until that session is finalized, so a delete
   * that arrives after the call ended (but before ingest) is still applied. After ingest a delete
   * can no longer be reflected here; the reviewer hides the line instead.
   */
  private readonly capturedChat = new Map<string, string>()

  /** Text of a message for the transcript: its content (mentions resolved) plus attachment URLs. */
  private chatText(msg: Message | PartialMessage): string {
    const body = (msg.cleanContent ?? msg.content ?? '').trim()
    const urls = [...(msg.attachments?.values() ?? [])].map((a) => a.url).filter(Boolean)
    return [body, ...urls].filter(Boolean).join('\n').slice(0, MAX_CHAT_TEXT)
  }

  private inSession(msg: Message | PartialMessage): ActiveSession | null {
    const s = this.current
    if (!s || s.stopping || msg.channelId !== this.cfg.callChannelId) return null
    const at = msg.createdTimestamp
    if (typeof at !== 'number' || at < s.meta.startedAtMs || at > Date.now() + 5000) return null
    return s
  }

  /** A message posted in the call channel's chat while recording. Never throws. */
  onMessage(msg: Message): void {
    try {
      const s = this.inSession(msg)
      if (!s || msg.author?.bot || msg.system) return
      const text = this.chatText(msg)
      if (!text) {
        // Without the MessageContent privileged intent Discord sends empty content.
        if (!msg.attachments?.size && !this.warnedEmptyContent) {
          this.warnedEmptyContent = true
          this.log('chat message arrived with empty content: is the MessageContent intent enabled in the Discord Developer Portal? Skipping empty messages.')
        }
        return
      }
      const displayName = msg.member?.displayName ?? msg.author?.globalName ?? msg.author?.username ?? ''
      this.capturedChat.set(msg.id, s.dir)
      const atMs = Math.max(0, msg.createdTimestamp - s.meta.startedAtMs)
      appendRecord(s.dir, { t: 'chat', messageId: msg.id, userId: msg.author.id, displayName, text, atMs })
      s.live?.onChat({ discordId: msg.author.id, displayName: displayName || null, messageId: msg.id, text, atMs })
    } catch (err) {
      this.log(`chat capture failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** An edit of a chat message we captured: store the latest text. */
  onMessageUpdate(msg: PartialMessage | Message): void {
    try {
      const s = this.inSession(msg)
      if (!s || msg.author?.bot) return
      if (this.capturedChat.get(msg.id) !== s.dir) return
      if (msg.content == null) return // partial update without content
      const text = this.chatText(msg)
      if (text) appendRecord(s.dir, { t: 'chat-edit', messageId: msg.id, text })
    } catch (err) {
      this.log(`chat edit capture failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** A deleted chat message is dropped from the transcript (also after the call ended, until ingest). */
  onMessageDelete(msg: PartialMessage | Message): void {
    try {
      const dir = this.capturedChat.get(msg.id)
      if (!dir) return
      this.capturedChat.delete(msg.id)
      if (existsSync(dir)) appendRecord(dir, { t: 'chat-delete', messageId: msg.id })
    } catch (err) {
      this.log(`chat delete capture failed: ${err instanceof Error ? err.message : String(err)}`)
    }
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
    return (await this.humanIds(guild)).length
  }

  private async humanIds(guild: Guild): Promise<string[]> {
    const ids = guild.voiceStates.cache.filter((vs) => vs.channelId === this.cfg.callChannelId).map((vs) => vs.id)
    const humans: string[] = []
    for (const id of ids) if (!(await this.isBot(id))) humans.push(id)
    return humans
  }

  /** Record who is in the channel right now (new ids only) so silent attendees reach the app's attendance. Never throws. */
  private async notePresent(s: ActiveSession): Promise<void> {
    try {
      const fresh = (await this.humanIds(s.guild)).filter((id) => !s.present.has(id))
      if (fresh.length === 0) return
      appendRecord(s.dir, { t: 'present', userIds: fresh })
      for (const id of fresh) s.present.add(id)
    } catch (err) {
      this.log(`could not note who is in the channel: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
