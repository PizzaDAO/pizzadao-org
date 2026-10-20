/**
 * PizzaDAO call recorder. Logs in with the PizzaDAO bot token and watches
 * guild scheduled events: when an event in the call voice channel goes ACTIVE it
 * joins and records; see recorder.ts for the rest. Serves GET /health.
 */
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { Client, GatewayIntentBits, type GuildScheduledEvent, type PartialGuildScheduledEvent } from 'discord.js'
import { generateDependencyReport } from '@discordjs/voice'
import { loadConfig } from './config.js'
import { EventStatus, pickBootEvent, type EventInfo } from './event-lifecycle.js'
import { clearAllStarting, sweepOldSessions } from './finalize.js'
import { NicknameManager } from './nickname.js'
import { appOptOutFetcher, OptOutCache } from './optouts.js'
import { CallRecorder } from './recorder.js'
import { createR2Uploader } from './storage.js'
import { postIngestWithRetry } from './ingest.js'

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`)

const cfg = loadConfig()
mkdirSync(cfg.dataDir, { recursive: true })
log(generateDependencyReport())

// Only what is needed: guilds (channels, events), voice states (who is in the
// channel), scheduled events. No message content, no members.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildScheduledEvents],
})

// One job at a time: start/stop/switch must not interleave.
let chain: Promise<unknown> = Promise.resolve()
function serial(fn: () => Promise<void>) {
  chain = chain.then(fn).catch((err) => log(`event handling failed: ${err instanceof Error ? err.stack : String(err)}`))
}

let recorder: CallRecorder
const optOuts = new OptOutCache(
  appOptOutFetcher(cfg.appBaseUrl, cfg.recorderApiKey),
  (ids) => recorder?.purgeLive(ids),
  log,
)
const uploader = createR2Uploader(cfg.r2)
recorder = new CallRecorder(
  client,
  cfg,
  optOuts,
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

function toInfo(ev: GuildScheduledEvent): EventInfo {
  return {
    id: ev.id,
    name: ev.name,
    channelId: ev.channelId,
    status: ev.status,
    scheduledStartMs: ev.scheduledStartTimestamp,
  }
}

// One event at a time: start/stop/switch must not interleave.
// (the chain lives next to the recorder above; stops from ticks and fatal errors use it too)
async function onEvent(ev: GuildScheduledEvent | PartialGuildScheduledEvent, statusChanged: boolean) {
  const full = ev.partial ? await ev.fetch() : ev
  if (full.guildId !== cfg.guildId) return
  await recorder.handleEvent(toInfo(full), true, statusChanged)
}

// Edits of an event that stays ACTIVE must not restart a recording that already finished.
client.on('guildScheduledEventUpdate', (old, ev) => serial(() => onEvent(ev, old?.status !== ev.status)))
client.on('guildScheduledEventCreate', (ev) => serial(() => onEvent(ev, true)))
client.on('voiceStateUpdate', (o, n) => recorder.onVoiceState(o, n))
client.on('error', (err) => log(`discord client error: ${err.message}`))

client.once('ready', () => {
  log(`logged in as ${client.user?.tag}`)
  serial(async () => {
    const guild = await client.guilds.fetch(cfg.guildId)
    await optOuts.refresh()
    optOuts.start(cfg.optOutRefreshSeconds * 1000)

    // Undo a nickname a crash left behind, finish sessions a crash left behind.
    await new NicknameManager(cfg.dataDir, log).recoverOnBoot(guild)
    sweepOldSessions(cfg.dataDir)
    clearAllStarting(cfg.dataDir) // nothing is live at boot: finish sessions a crash left "starting"
    recorder.recoverPending()
    recorder.startRetryLoop()

    // A call may already be running (restart mid-call).
    const events = [...(await guild.scheduledEvents.fetch()).values()].map(toInfo)
    const active = pickBootEvent(events, {
      callChannelId: cfg.callChannelId,
      maxCallMs: cfg.maxCallMinutes * 60_000,
      nowMs: Date.now(),
    })
    if (active) {
      log(`event "${active.name}" is already active; joining`)
      await recorder.handleEvent({ ...active, status: EventStatus.Active }, false)
    }
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
        optOutsLoaded: optOuts.isLoaded,
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

await client.login(cfg.discordToken)
