/**
 * Phase 0 spike: does DAVE voice receive work on a real call?
 *
 *   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
 *     npm run spike -- --channel <voiceChannelId> --minutes 10 [--out ./spike-out]
 *
 * Joins the channel (muted, not deafened) for N minutes, writes one Ogg/Opus
 * file per speaker, then prints per-speaker packet counts and the DAVE decrypt
 * failure rate. It posts nothing, changes no nickname, uploads nothing and
 * never calls the app. Exit criteria (plan): every speaker audible, under 1%
 * decrypt failures, no reconnect loop.
 *
 * Test it twice: once with everyone joining after the bot, and once with people
 * already talking when it joins (upstream bug #11653, patched in patches/).
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client, GatewayIntentBits } from 'discord.js'
import { generateDependencyReport } from '@discordjs/voice'
import { VoiceCapture } from './capture.js'
import { loadSpikeConfig } from './config.js'
import { readManifest, summarize } from './manifest.js'
import { buildSpeakerTrack } from './finalize.js'

const run = promisify(execFile)

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : fallback
  if (!v) throw new Error(`Missing --${name}`)
  return v
}

const channelId = arg('channel')
const minutes = Number(arg('minutes', '10'))
const outRoot = path.resolve(arg('out', './spike-out'))
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('--minutes must be a positive number')
const { discordToken, guildId } = loadSpikeConfig()

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`)
console.log(generateDependencyReport())

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })
await client.login(discordToken)
await new Promise<void>((r) => client.once('ready', () => r()))

const guild = await client.guilds.fetch(guildId)
const t0 = Date.now()
const dir = path.join(outRoot, `spike-${t0}`)
mkdirSync(dir, { recursive: true })

const bots = new Map<string, boolean>()
let fatal: string | null = null
const capture = new VoiceCapture({
  guild,
  channelId,
  dir,
  t0,
  isBot: async (id) => {
    if (!bots.has(id)) bots.set(id, (await client.users.fetch(id)).bot)
    return bots.get(id)!
  },
  displayName: async (id) => (await guild.members.fetch(id)).displayName,
  log,
  onFatal: (reason) => {
    fatal = reason
  },
})

await capture.start()
capture.beginCapture()
log(`recording ${channelId} for ${minutes} minute(s) into ${dir}`)
const deadline = t0 + minutes * 60_000
while (Date.now() < deadline && !fatal) await new Promise((r) => setTimeout(r, 1000))
await capture.stop()

const speakers = summarize(readManifest(dir))
console.log('\n=== Spike report ===')
for (const sp of speakers) {
  const st = capture.stats.get(sp.userId)
  const track = path.join(dir, `${sp.userId}.ogg`)
  try {
    await buildSpeakerTrack(
      async (args) => void (await run('ffmpeg', args)),
      sp.segments.map((s) => ({ file: path.join(dir, s.file), startMs: s.startMs })),
      track,
    )
  } catch (err) {
    console.log(`  (ffmpeg failed for ${sp.userId}: ${err instanceof Error ? err.message : String(err)})`)
  }
  console.log(
    `${sp.displayName ?? sp.userId}: ${sp.segments.length} segments, ${st?.packets ?? 0} packets, ` +
      `${sp.talkTimeSec}s of speech -> ${track}`,
  )
}
const received = [...capture.stats.values()].reduce((n, s) => n + s.packets, 0)
const failRate = received + capture.decryptFailures === 0 ? 0 : capture.decryptFailures / (received + capture.decryptFailures)
console.log(`\nDecrypt failures: ${capture.decryptFailures} (${(failRate * 100).toFixed(2)}% of ${received + capture.decryptFailures} packets)`)
console.log(`Empty bursts (speaking, no audio): ${capture.emptyBursts}`)
console.log(`Stream errors: ${capture.streamErrors}`)
console.log(`Rejoins: ${capture.rejoins}${capture.rejoins > 2 ? '  <- reconnect loop?' : ''}`)
console.log(`Fatal: ${fatal ?? 'none'}`)
console.log(
  `Verdict: ${speakers.length > 0 && failRate < 0.01 && capture.rejoins <= 2 && !fatal ? 'PASS (now listen to the files)' : 'CHECK (see numbers above)'}`,
)
void client.destroy()
process.exit(0)
