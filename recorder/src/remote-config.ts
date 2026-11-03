/**
 * Admin-editable settings the recorder honours, read from the app (GET /api/calls/recorder/config,
 * Bearer RECORDER_API_KEY). The recorder has no database. Shape: app/lib/calls/recorder-config.ts.
 *
 * Fetched at session start and every 5 minutes while live. On a failure the last good value is kept;
 * with none yet, everything is OFF (the recorder then behaves exactly as before these settings existed).
 */

export interface RemoteConfig {
  welcome: { enabled: boolean; template: string; batchSeconds: number; recordingLine: string }
  endSong: { enabled: boolean; minHumans: number }
  crews: { eventId: string; label: string }[]
}

export const REMOTE_CONFIG_OFF: RemoteConfig = {
  welcome: {
    enabled: false,
    template: 'Welcome {members} to the {call} 🍕',
    batchSeconds: 20,
    recordingLine: "🔴 This call is recorded and transcribed; audio stays private. Leave the call if you'd rather not be recorded.",
  },
  endSong: { enabled: false, minHumans: 1 },
  crews: [],
}

export const REMOTE_CONFIG_TIMEOUT_MS = 5_000
export const REMOTE_CONFIG_REFRESH_MS = 5 * 60_000

const str = (v: unknown, fallback: string, max: number): string => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback)
const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback

/** Validates an app response; anything malformed falls back to the OFF value for that part. */
export function parseRemoteConfig(raw: unknown): RemoteConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const w = (o.welcome && typeof o.welcome === 'object' ? o.welcome : {}) as Record<string, unknown>
  const e = (o.endSong && typeof o.endSong === 'object' ? o.endSong : {}) as Record<string, unknown>
  const d = REMOTE_CONFIG_OFF
  const crews = Array.isArray(o.crews)
    ? o.crews.flatMap((c: unknown) => {
        const r = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
        return typeof r.eventId === 'string' && typeof r.label === 'string' && r.label ? [{ eventId: r.eventId, label: r.label.slice(0, 80) }] : []
      })
    : []
  return {
    welcome: {
      enabled: w.enabled === true,
      template: str(w.template, d.welcome.template, 300),
      batchSeconds: int(w.batchSeconds, d.welcome.batchSeconds, 5, 120),
      recordingLine: str(w.recordingLine, d.welcome.recordingLine, 300),
    },
    endSong: { enabled: e.enabled === true, minHumans: int(e.minHumans, d.endSong.minHumans, 1, 50) },
    crews,
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
  async refresh(): Promise<RemoteConfig> {
    try {
      const res = await this.fetchImpl(`${this.appBaseUrl}/api/calls/recorder/config`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(REMOTE_CONFIG_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`app answered ${res.status}`)
      this.last = parseRemoteConfig(await res.json())
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
