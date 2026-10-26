/**
 * PizzaDAO call recorder. Logs in with the PizzaDAO bot token and watches
 * guild scheduled events: when an event in the call voice channel goes ACTIVE it
 * joins and records; see recorder.ts for the rest. Serves GET /health.
 */
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { Client, GatewayIntentBits, Options, Partials, GuildScheduledEventRecurrenceRuleFrequency, type GuildScheduledEvent } from 'discord.js'
import { generateDependencyReport } from '@discordjs/voice'
import { loadConfig } from './config.js'
import type { EventInfo } from './event-lifecycle.js'
import { clearAllStarting, sweepOldSessions } from './finalize.js'
import { NicknameManager } from './nickname.js'
import { CallRecorder } from './recorder.js'
import { createR2Uploader } from './storage.js'
import { postIngestWithRetry } from './ingest.js'

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`)

const cfg = loadConfig()
mkdirSync(cfg.dataDir, { recursive: true })
log(generateDependencyReport())

// Guilds (channels, events), voice states (who is in the channel) and scheduled events. With
// CAPTURE_VOICE_CHAT (default on) also guild messages with their content: the voice channel's text
// chat is added to the call transcript. MessageContent is a PRIVILEGED intent: it must be enabled for
// the bot in the Discord Developer Portal (Bot > Privileged Gateway Intents) or login fails with
// "Used disallowed intents" (set CAPTURE_VOICE_CHAT=false to run without it).
const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildScheduledEvents]
if (cfg.captureVoiceChat) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent)
const client = new Client({
  intents,
  // Deletes/edits of messages we did not cache still fire (as partials); cache few messages, and
  // drop them quickly: only the call channel's chat matters.
  partials: cfg.captureVoiceChat ? [Partials.Message] : [],
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 50 }),
  sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 300, lifetime: 1800 } },
})

// One job at a time: start/stop/switch must not interleave.
let chain: Promise<unknown> = Promise.resolve()
function serial(fn: () => Promise<void>) {
  chain = chain.then(fn).catch((err) => log(`event handling failed: ${err instanceof Error ? err.stack : String(err)}`))
}

let recorder: CallRecorder
const uploader = createR2Uploader(cfg.r2)
recorder = new CallRecorder(
  client,
  cfg,
  new NicknameManager(cfg.dataDir, log),
  {
    appBaseUrl: cfg.appBaseUrl,
    apiKey: cfg.recorderApiKey,
    uploader,
    log,
    deepgramApiKey: cfg.deepgramApiKey,
    postIngest: (payload) => postIngestWithRetry(cfg.appBaseUrl, cfg.recorderApiKey, payload),
  },
  log,
  serial,
)

const DAY_MS = 86_400_000

/** Interval of a plain daily / weekly rule; null for anything we cannot derive simply. */
function recurrenceIntervalMs(ev: GuildScheduledEvent): number | null {
  const r = ev.recurrenceRule
  if (!r) return null
  const interval = r.interval > 0 ? r.interval : 1
  if (r.frequency === GuildScheduledEventRecurrenceRuleFrequency.Daily) return interval * DAY_MS
  if (r.frequency === GuildScheduledEventRecurrenceRuleFrequency.Weekly && (r.byWeekday?.length ?? 0) <= 1) {
    return interval * 7 * DAY_MS
  }
  return null
}

function toInfo(ev: GuildScheduledEvent): EventInfo {
  return {
    recurrenceIntervalMs: recurrenceIntervalMs(ev),
    id: ev.id,
    name: ev.name,
    channelId: ev.channelId,
    status: ev.status,
    scheduledStartMs: ev.scheduledStartTimestamp,
    scheduledEndMs: ev.scheduledEndTimestamp,
  }
}

/** Start a recording for humans present in an event's schedule window (event status is not a trigger). */
async function scheduleCheck(refetch: boolean) {
  const guild = await client.guilds.fetch(cfg.guildId)
  const events = [...(refetch ? await guild.scheduledEvents.fetch() : guild.scheduledEvents.cache).values()].map(toInfo)
  await recorder.checkSchedule(events)
}

client.on('voiceStateUpdate', (o, n) => {
  recorder.onVoiceState(o, n)
  // Someone joined or left the call channel: maybe a call is starting without its event being set ACTIVE.
  if (n.guild.id !== cfg.guildId) return
  if (n.id === client.user?.id) return // the bot's own join/leave must not trigger a check
  if (n.channelId !== cfg.callChannelId && o.channelId !== cfg.callChannelId) return
  serial(() => scheduleCheck(false))
})
client.on('messageCreate', (m) => recorder.onMessage(m))
client.on('messageUpdate', (_o, n) => recorder.onMessageUpdate(n))
client.on('messageDelete', (m) => recorder.onMessageDelete(m))
client.on('messageDeleteBulk', (ms) => ms.forEach((m) => recorder.onMessageDelete(m)))
client.on('error', (err) => log(`discord client error: ${err.message}`))

client.once('ready', () => {
  log(`logged in as ${client.user?.tag}`)
  serial(async () => {
    const guild = await client.guilds.fetch(cfg.guildId)

    // Undo a nickname a crash left behind, finish sessions a crash left behind.
    await new NicknameManager(cfg.dataDir, log).recoverOnBoot(guild)
    sweepOldSessions(cfg.dataDir)
    clearAllStarting(cfg.dataDir) // nothing is live at boot: finish sessions a crash left "starting"
    recorder.recoverPending()
    recorder.startRetryLoop()

    // A call may already be running (restart mid-call): the schedule window picks it up.
    const events = [...(await guild.scheduledEvents.fetch()).values()].map(toInfo)
    await recorder.checkSchedule(events)

    // Pick up calls whose event never goes ACTIVE (and ones that began while nobody was listening).
    setInterval(() => serial(() => scheduleCheck(true)), 60_000).unref()
  })
})

const server = createServer((req, res) => {
  if (req.url === '/health') {
    const ready = client.isReady()
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: ready,
        discord: ready ? 'ready' : 'connecting',
        recording: recorder.status(),
        finalizing: recorder.pendingCount,
      }),
    )
    return
  }
  res.writeHead(404).end()
})
server.listen(cfg.port, () => log(`health on :${cfg.port}/health`))

async function shutdown(signal: string) {
  log(`${signal}: shutting down`)
  try {
    await recorder.shutdown()
  } catch (err) {
    log(`shutdown error: ${err instanceof Error ? err.message : String(err)}`)
  }
  server.close()
  void client.destroy()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (err) => log(`unhandled rejection: ${err instanceof Error ? err.stack : String(err)}`))

try {
  await client.login(cfg.discordToken)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  if (/disallowed intents/i.test(msg)) {
    console.error(
      `${new Date().toISOString()} FATAL: Discord refused the login (${msg}). Enable "Message Content Intent" for the bot ` +
        'in the Discord Developer Portal (Bot > Privileged Gateway Intents), or set CAPTURE_VOICE_CHAT=false to run without voice chat capture.',
    )
    process.exit(1)
  }
  throw err
}
