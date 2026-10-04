// Seed missions data into the database (empty table only)
// Run: node scripts/seed-missions.mjs
//
// Verifier settings match app/lib/mission-verify/mission-config.ts (Phase 1 of
// plans/mission-verification.md). An existing database is migrated with
// scripts/missions/set-verifiers.mjs instead.

import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env manually
const envPath = resolve(import.meta.dirname, '..', '.env')
const envContent = readFileSync(envPath, 'utf-8')
const envVars = {}
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    let val = match[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    envVars[match[1].trim()] = val
  }
}

const DATABASE_URL = envVars.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not found in .env')
  process.exit(1)
}

const sql = neon(DATABASE_URL)

const missions = [
  // Level 1 - Pizza Trainee (69 PEP)
  { level: 1, index: 0, title: 'Link your X account and follow @RarePizzas + @Pizza_DAO', description: 'Link your X account on your PizzaDAO profile (Connect X), and follow @RarePizzas and @Pizza_DAO on X. Linking is checked automatically.', reward: 69, levelTitle: 'Pizza Trainee', verifierKey: 'x_linked', verifierParams: {} },

  // Level 2 - Pizza Noob (420 PEP)
  { level: 2, index: 0, title: 'Say hi on a community or crew call', description: 'Attend a community or crew call and introduce yourself.', reward: 420, levelTitle: 'Pizza Noob', verifierKey: 'attendance_count', verifierParams: { min: 1, crews: 'any' } },
  { level: 2, index: 1, title: 'Post about PizzaDAO (3+ comments, 10+ likes)', description: 'Create a social media post about PizzaDAO that gets at least 3 comments and 10 likes.', reward: 420, levelTitle: 'Pizza Noob', verifierKey: 'social_post', verifierParams: { minReplies: 3, minLikes: 10, platforms: ['x', 'farcaster'] }, proofKind: 'URL' },

  // Level 3 - Make us an offer we can't refuse (1,337 PEP)
  { level: 3, index: 0, title: 'Share your community in #show-and-tell', description: 'Share something you are building or involved with in the #show-and-tell channel.', reward: 1337, levelTitle: "Make us an offer we can't refuse", verifierKey: 'discord_message', verifierParams: { channelName: 'show-and-tell', channelEnv: 'SHOW_AND_TELL_CHANNEL_ID' }, proofKind: 'DISCORD_MESSAGE' },
  { level: 3, index: 1, title: 'Invite a friend to Discord', description: 'Invite a friend to join the PizzaDAO Discord server.', reward: 1337, levelTitle: "Make us an offer we can't refuse", verifierKey: 'referral', verifierParams: { min: 1, qualify: 'onboarded' } },

  // Level 4 - Do some dirty work (3,141 PEP)
  { level: 4, index: 0, title: 'Make a POAP for a community call', description: 'Create a POAP (Proof of Attendance Protocol) for one of the community calls.', reward: 3141, levelTitle: 'Do some dirty work', verifierKey: 'poap_drop', verifierParams: {}, proofKind: 'URL' },

  // Level 5 - Do a favor for the mafia (4,269 PEP)
  { level: 5, index: 0, title: 'Join three crew calls', description: 'Attend three crew calls in total: any crews, and community calls count too.', reward: 4269, levelTitle: 'Do a favor for the mafia', verifierKey: 'attendance_count', verifierParams: { min: 3, crews: 'any', distinct: 'call' } },
  { level: 5, index: 1, title: 'Do a selfie interview', description: 'Record and share a selfie interview about your PizzaDAO experience.', reward: 4269, levelTitle: 'Do a favor for the mafia', verifierKey: 'media_proof', verifierParams: { kinds: ['youtube', 'x', 'drive', 'loom'] }, proofKind: 'URL' },
  { level: 5, index: 2, title: 'Vouch for another member', description: 'Vouch for another PizzaDAO member: open their profile and tap Vouch. Checked automatically. Vouching for yourself and follows imported from Farcaster or X do not count.', reward: 4269, levelTitle: 'Do a favor for the mafia', verifierKey: 'vouch_given', verifierParams: { min: 1, sources: ['PIZZADAO'] } },

  // Level 6 - Street Muscle (6,942 PEP)
  { level: 6, index: 0, title: 'Join Pepperoni Mafia', description: 'Become a member of the Pepperoni Mafia.', reward: 6942, levelTitle: 'Street Muscle', verifierKey: 'discord_role', verifierParams: { roleIds: ['823266914834841610'] } },
  { level: 6, index: 1, title: 'Onboard a Bitcoin Pizza Day city', description: 'Help onboard a new city for Bitcoin Pizza Day celebrations.', reward: 6942, levelTitle: 'Street Muscle', verifierKey: 'gpp_host', verifierParams: { eventType: 'gpp', statuses: ['approved', 'listed'] }, proofKind: 'URL' },

  // Level 7 - Made Mafia (31,415 PEP)
  { level: 7, index: 0, title: 'Become a Crew Leader', description: 'Step up and become a leader of one of the PizzaDAO crews.', reward: 31415, levelTitle: 'Made Mafia', verifierKey: 'discord_role', verifierParams: { roleNames: ['Crew Leader'], roleEnv: 'MISSION_CREW_LEADER_ROLE' } },

  // Level 8 - Don of Dons (69,420 PEP)
  { level: 8, index: 0, title: 'Called upon by Dread Pizza Roberts', description: 'Receive a special mission from Dread Pizza Roberts.', reward: 69420, levelTitle: 'Don of Dons', verifierKey: 'manual' },
]

async function seed() {
  console.log('Seeding missions...')

  // Check if missions already exist
  const existing = await sql`SELECT COUNT(*) as count FROM "Mission"`
  if (existing[0].count > 0) {
    console.log(`Missions table already has ${existing[0].count} rows. Skipping seed.`)
    console.log('To re-seed, first run: DELETE FROM "Mission" CASCADE;')
    return
  }

  for (const m of missions) {
    await sql`
      INSERT INTO "Mission" ("level", "index", "title", "description", "reward", "levelTitle", "isActive", "verifierKey", "verifierParams", "proofKind")
      VALUES (${m.level}, ${m.index}, ${m.title}, ${m.description}, ${m.reward}, ${m.levelTitle}, true,
              ${m.verifierKey ?? null}, ${m.verifierParams ? JSON.stringify(m.verifierParams) : null}::jsonb, ${m.proofKind ?? 'NONE'}::"ProofKind")
    `
    console.log(`  Level ${m.level}.${m.index}: ${m.title}`)
  }

  console.log(`\nSeeded ${missions.length} missions across 8 levels.`)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
