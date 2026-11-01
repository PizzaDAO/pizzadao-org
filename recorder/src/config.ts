/** Environment configuration. `loadConfig` throws one error listing everything missing. */

export const DEFAULT_CALL_VOICE_CHANNEL_ID = '823956905739026442'
export const REC_MARK = '🔴 REC'
export const MAX_NICKNAME = 32
/** `name part=minutes` pairs, comma-separated: events whose name contains the part stop sooner. */
export const DEFAULT_MAX_CALL_MINUTES_BY_EVENT = 'community call=30'

export interface EventCap {
  namePart: string
  minutes: number
}

/** Parses MAX_CALL_MINUTES_BY_EVENT; null when any pair is malformed. */
export function parseEventCaps(raw: string): EventCap[] | null {
  const caps: EventCap[] = []
  for (const pair of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*=\s*(\d+(?:\.\d+)?)$/.exec(pair)
    if (!m || Number(m[2]) <= 0) return null
    caps.push({ namePart: m[1].toLowerCase(), minutes: Number(m[2]) })
  }
  return caps
}

/** The event's shorter limit in minutes, if it has one. */
export function eventCapMinutes(cfg: Pick<Config, 'eventCaps'>, eventName: string): number | undefined {
  const name = eventName.toLowerCase()
  return cfg.eventCaps.find((c) => name.includes(c.namePart))?.minutes
}

/** The recording limit for an event: the first matching cap, else MAX_CALL_MINUTES. */
export function maxMinutesFor(cfg: Pick<Config, 'maxCallMinutes' | 'eventCaps'>, eventName: string): number {
  return eventCapMinutes(cfg, eventName) ?? cfg.maxCallMinutes
}

export interface Config {
  discordToken: string
  guildId: string
  callChannelId: string
  appBaseUrl: string
  recorderApiKey: string
  /** Deepgram key; transcription is skipped (logged once) when unset. */
  deepgramApiKey: string | undefined
  dataDir: string
  maxCallMinutes: number
  /** Shorter limits for some events (MAX_CALL_MINUTES_BY_EVENT). */
  eventCaps: EventCap[]
  /** The channel must have had no humans this long before the recording stops. */
  emptyGraceMinutes: number
  port: number
  /** Capture the voice channel's text chat (needs the MessageContent intent). CAPTURE_VOICE_CHAT=false turns it off. */
  captureVoiceChat: boolean
  r2: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string }
}

function positiveNumber(raw: string | undefined, fallback: number, name: string, errors: string[]): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    errors.push(`${name} must be a positive number`)
    return fallback
  }
  return n
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const errors: string[] = []
  const req = (name: string) => {
    const v = env[name]?.trim()
    if (!v) errors.push(`${name} is required`)
    return v ?? ''
  }

  const eventCaps = parseEventCaps(env.MAX_CALL_MINUTES_BY_EVENT ?? DEFAULT_MAX_CALL_MINUTES_BY_EVENT)
  if (!eventCaps) errors.push('MAX_CALL_MINUTES_BY_EVENT must be comma-separated name=minutes pairs')

  const cfg: Config = {
    discordToken: req('DISCORD_BOT_TOKEN'),
    guildId: req('DISCORD_GUILD_ID'),
    callChannelId: env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID,
    appBaseUrl: (env.APP_BASE_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, ''),
    recorderApiKey: req('RECORDER_API_KEY'),
    deepgramApiKey: env.DEEPGRAM_API_KEY?.trim() || undefined,
    dataDir: env.DATA_DIR?.trim() || '/data',
    maxCallMinutes: positiveNumber(env.MAX_CALL_MINUTES, 120, 'MAX_CALL_MINUTES', errors),
    eventCaps: eventCaps ?? [],
    emptyGraceMinutes: positiveNumber(env.EMPTY_GRACE_MINUTES, 5, 'EMPTY_GRACE_MINUTES', errors),
    captureVoiceChat: !/^(0|false|off|no)$/i.test(env.CAPTURE_VOICE_CHAT?.trim() ?? ''),
    port: positiveNumber(env.PORT, 3000, 'PORT', errors),
    r2: {
      endpoint: req('R2_ENDPOINT'),
      accessKeyId: req('R2_ACCESS_KEY_ID'),
      secretAccessKey: req('R2_SECRET_ACCESS_KEY'),
      bucket: req('R2_BUCKET_NAME'),
    },
  }
  if (errors.length) throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`)
  return cfg
}

/** Spike only needs Discord access. */
export function loadSpikeConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.DISCORD_BOT_TOKEN?.trim()
  const guildId = env.DISCORD_GUILD_ID?.trim()
  if (!token || !guildId) throw new Error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required')
  return { discordToken: token, guildId }
}
