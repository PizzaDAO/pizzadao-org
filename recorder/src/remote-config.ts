/**
 * Admin-editable settings the recorder honours, read from the app (GET /api/calls/recorder/config,
 * Bearer RECORDER_API_KEY). The recorder has no database. Shape: app/lib/calls/recorder-config.ts.
 *
 * Fetched at session start and every 5 minutes while live. On a failure the last good value is kept;
 * with none yet, everything is OFF (the recorder then behaves exactly as before these settings existed).
 */

import { normalizeKeyterms } from './keyterms.js'
import { parseVoiceChannels, VOICE_CHANNELS_OFF, type VoiceChannelSettings } from './channels.js'

export interface RemoteConfig {
  welcome: { enabled: boolean; template: string; batchSeconds: number; recordingLine: string }
  /** Text posted in the voice channel chat when a call starts; empty = nothing (calls.startNotice). */
  startNotice: string
  endSong: { enabled: boolean; minHumans: number; crewMap: { crew: string; radio: string }[] }
  /** House band at the start of the listed calls (pizza-radio /play-band). */
  startBand: { enabled: boolean; calls: string[]; maxSongs: number }
  crews: { eventId: string; label: string; callMinutes?: number }[]
  /**
   * Action items confirmed during the call (plans/post-call-agenda-updates.md, options A and C).
   * audio: speech is sent to the app in chunks every chunkSeconds; chat: messages starting with a
   * prefix are sent right away. Only events in eventIds (the crew allowlist) take part.
   */
  liveItems: { audio: boolean; chunkSeconds: number; chat: boolean; prefixes: string[]; eventIds: string[] }
  /** Longest a switch to the next crew's event waits while the current call still has people talking; 0 = never wait. */
  supersedeMaxDeferMinutes: number
  /** Spellings for Deepgram to prefer (keyterm prompting); empty = none. */
  transcriptionKeyterms: string[]
  /** Which voice channels may be recorded and which a crew's call uses (calls.recordableVoiceChannels, calls.crewVoiceChannels). */
  voiceChannels: VoiceChannelSettings
}

export const REMOTE_CONFIG_OFF: RemoteConfig = {
  welcome: {
    enabled: false,
    template: 'Welcome {members} to the {call} 🍕',
    batchSeconds: 20,
    recordingLine: "🔴 This call is recorded and transcribed; audio stays private. Leave the call if you'd rather not be recorded.",
  },
  startNotice: '',
  endSong: { enabled: false, minHumans: 1, crewMap: [] },
  startBand: { enabled: false, calls: [], maxSongs: 1 },
  crews: [],
  liveItems: { audio: false, chunkSeconds: 150, chat: false, prefixes: [], eventIds: [] },
  supersedeMaxDeferMinutes: 0,
  transcriptionKeyterms: [],
  voiceChannels: VOICE_CHANNELS_OFF,
}

export const REMOTE_CONFIG_TIMEOUT_MS = 5_000
/** Session start waits at most this long for a fresh config (then the last good one, or all-off, applies). */
export const REMOTE_CONFIG_START_WAIT_MS = 1_500
export const REMOTE_CONFIG_REFRESH_MS = 5 * 60_000

const str = (v: unknown, fallback: string, max: number): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback)
const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback

/** Validates an app response; anything malformed falls back to the OFF value for that part. */
export function parseRemoteConfig(raw: unknown, previous?: RemoteConfig | null): RemoteConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const w = (o.welcome && typeof o.welcome === 'object' ? o.welcome : {}) as Record<string, unknown>
  const e = (o.endSong && typeof o.endSong === 'object' ? o.endSong : {}) as Record<string, unknown>
  const b = (o.startBand && typeof o.startBand === 'object' ? o.startBand : {}) as Record<string, unknown>
  const d = REMOTE_CONFIG_OFF
  const l = (o.liveItems && typeof o.liveItems === 'object' ? o.liveItems : {}) as Record<string, unknown>
  const strings = (v: unknown, max: number, len: number): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, len)).slice(0, max) : []
  const eventIds = strings(l.eventIds, 100, 25).filter((x) => /^\d{15,25}$/.test(x))
  const prefixes = strings(l.prefixes, 10, 20).map((x) => x.toLowerCase())
  const crews = Array.isArray(o.crews)
    ? o.crews.flatMap((c: unknown) => {
        const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
        return typeof r.eventId === 'string' && typeof r.label === 'string' && r.label
          ? [{ eventId: r.eventId, label: r.label.slice(0, 80), ...(typeof r.callMinutes === 'number' && r.callMinutes > 0 && r.callMinutes <= 600 ? { callMinutes: r.callMinutes } : {}) }]
          : []
      })
    : []
  return {
    welcome: {
      enabled: w.enabled === true,
      template: str(w.template, d.welcome.template, 300),
      batchSeconds: int(w.batchSeconds, d.welcome.batchSeconds, 5, 120),
      recordingLine: str(w.recordingLine, d.welcome.recordingLine, 300),
    },
    startNotice: typeof o.startNotice === 'string' ? o.startNotice.trim().slice(0, 500) : '',
    endSong: {
      enabled: e.enabled === true,
      minHumans: int(e.minHumans, d.endSong.minHumans, 1, 50),
      crewMap: Array.isArray(e.crewMap)
        ? e.crewMap.flatMap((c: unknown) => {
            const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
            return typeof r.crew === 'string' && typeof r.radio === 'string' && r.crew.trim() && r.radio.trim()
              ? [{ crew: r.crew.trim().slice(0, 60), radio: r.radio.trim().slice(0, 60) }]
              : []
          })
        : [],
    },
    startBand: {
      enabled: b.enabled === true,
      calls: strings(b.calls, 50, 100),
      maxSongs: int(b.maxSongs, d.startBand.maxSongs, 1, 10),
    },
    crews,
    liveItems: {
      audio: l.audio === true && eventIds.length > 0,
      chunkSeconds: int(l.chunkSeconds, d.liveItems.chunkSeconds, 60, 600),
      chat: l.chat === true && eventIds.length > 0 && prefixes.length > 0,
      prefixes,
      eventIds,
    },
    supersedeMaxDeferMinutes: int(o.supersedeMaxDeferMinutes, d.supersedeMaxDeferMinutes, 0, 120),
    transcriptionKeyterms: normalizeKeyterms(o.transcriptionKeyterms),
    voiceChannels: parseVoiceChannels(o.voiceChannels, previous?.voiceChannels.byEvent),
  }
}

export class RemoteConfigClient {
  private last: RemoteConfig | null = null
  private timer: NodeJS.Timeout | null = null
  private warned = false

  constructor(
    private readonly appBaseUrl: string,
    private readonly apiKey: string,
    private readonly log: (msg: string) => void,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The last good config, or everything off. */
  get(): RemoteConfig {
    return this.last ?? REMOTE_CONFIG_OFF
  }

  /** Fetch now; never throws. Returns the config in force afterwards. */
  async refresh(timeoutMs: number = REMOTE_CONFIG_TIMEOUT_MS): Promise<RemoteConfig> {
    try {
      const res = await this.fetchImpl(`${this.appBaseUrl}/api/calls/recorder/config`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`app answered ${res.status}`)
      this.last = parseRemoteConfig(await res.json(), this.last)
      this.warned = false
    } catch (err) {
      // Log the first failure of a streak only.
      if (!this.warned) {
        this.warned = true
        this.log(`remote config unavailable (${err instanceof Error ? err.message : String(err)}); using ${this.last ? 'the last good value' : 'all-off defaults'}`)
      }
    }
    return this.get()
  }

  /** Re-read periodically while the process lives. */
  startRefreshLoop(everyMs = REMOTE_CONFIG_REFRESH_MS): void {
    this.timer = setInterval(() => void this.refresh(), everyMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
