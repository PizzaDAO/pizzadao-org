/** Environment configuration. `loadConfig` throws one error listing everything missing. */

export const DEFAULT_CALL_VOICE_CHANNEL_ID = '823956905739026442'
export const REC_NICKNAME = 'PizzaDAO Bot 🔴 REC'

export interface Config {
  discordToken: string
  guildId: string
  callChannelId: string
  appBaseUrl: string
  recorderApiKey: string
  dataDir: string
  maxCallMinutes: number
  /** The channel must have had no humans this long before the recording stops. */
  emptyGraceMinutes: number
  optOutRefreshSeconds: number
  port: number
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

  const cfg: Config = {
    discordToken: req('DISCORD_BOT_TOKEN'),
    guildId: req('DISCORD_GUILD_ID'),
    callChannelId: env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID,
    appBaseUrl: (env.APP_BASE_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, ''),
    recorderApiKey: req('RECORDER_API_KEY'),
    dataDir: env.DATA_DIR?.trim() || '/data',
    maxCallMinutes: positiveNumber(env.MAX_CALL_MINUTES, 120, 'MAX_CALL_MINUTES', errors),
    emptyGraceMinutes: positiveNumber(env.EMPTY_GRACE_MINUTES, 5, 'EMPTY_GRACE_MINUTES', errors),
    optOutRefreshSeconds: positiveNumber(env.OPTOUT_REFRESH_SECONDS, 60, 'OPTOUT_REFRESH_SECONDS', errors),
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
