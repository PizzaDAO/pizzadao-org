// Seed missions data into the database
// Run: node scripts/seed-missions.mjs

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
  { level: 1, index: 0, title: 'Tell us your favorite topping and mafia movie in #general', description: 'Introduce yourself in the #general channel with your favorite pizza topping and favorite mafia movie.', reward: 69, levelTitle: 'Pizza Trainee', autoVerify: true },
  { level: 1, index: 1, title: 'Follow @RarePizzas and @Pizza_DAO on X', description: 'Follow both @RarePizzas and @Pizza_DAO on X (Twitter).', reward: 69, levelTitle: 'Pizza Trainee', autoVerify: true },

  // Level 2 - Pizza Noob (420 PEP)
  { level: 2, index: 0, title: 'Say hi on a community or crew call', description: 'Attend a community or crew call and introduce yourself.', reward: 420, levelTitle: 'Pizza Noob', autoVerify: false },
  { level: 2, index: 1, title: 'Post about PizzaDAO (3+ comments, 10+ likes)', description: 'Create a social media post about PizzaDAO that gets at least 3 comments and 10 likes.', reward: 420, levelTitle: 'Pizza Noob', autoVerify: false },

  // Level 3 (1,337 PEP)
  { level: 3, index: 0, title: 'Share your community in #show-and-tell', description: 'Share something you are building or involved with in the #show-and-tell channel.', reward: 1337, levelTitle: null, autoVerify: true },
  { level: 3, index: 1, title: 'Invite a friend to Discord', description: 'Invite a friend to join the PizzaDAO Discord server.', reward: 1337, levelTitle: null, autoVerify: false },

  // Level 4 (3,141 PEP)
  { level: 4, index: 0, title: 'Claim your crew number and create a profile', description: 'Claim your crew number and set up your PizzaDAO profile.', reward: 3141, levelTitle: null, autoVerify: false },
  { level: 4, index: 1, title: 'Make a POAP for a community call', description: 'Create a POAP (Proof of Attendance Protocol) for one of the community calls.', reward: 3141, levelTitle: null, autoVerify: false },

  // Level 5 (4,269 PEP)
  { level: 5, index: 0, title: 'Join three crew calls', description: 'Attend at least three different crew calls.', reward: 4269, levelTitle: null, autoVerify: false },
  { level: 5, index: 1, title: 'Do a selfie interview', description: 'Record and share a selfie interview about your PizzaDAO experience.', reward: 4269, levelTitle: null, autoVerify: false },

  // Level 6 - Street Muscle (6,942 PEP)
  { level: 6, index: 0, title: 'Join Pepperoni Mafia', description: 'Become a member of the Pepperoni Mafia.', reward: 6942, levelTitle: 'Street Muscle', autoVerify: false },
  { level: 6, index: 1, title: 'Onboard a Bitcoin Pizza Day city', description: 'Help onboard a new city for Bitcoin Pizza Day celebrations.', reward: 6942, levelTitle: 'Street Muscle', autoVerify: false },

  // Level 7 - Made Mafia (31,415 PEP)
  { level: 7, index: 0, title: 'Become a Crew Leader', description: 'Step up and become a leader of one of the PizzaDAO crews.', reward: 31415, levelTitle: 'Made Mafia', autoVerify: false },

  // Level 8 - Don of Dons (69,420 PEP)
  { level: 8, index: 0, title: 'Called upon by Dread Pizza Roberts', description: 'Receive a special mission from Dread Pizza Roberts.', reward: 69420, levelTitle: 'Don of Dons', autoVerify: false },
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
      INSERT INTO "Mission" ("level", "index", "title", "description", "reward", "levelTitle", "autoVerify", "isActive")
      VALUES (${m.level}, ${m.index}, ${m.title}, ${m.description}, ${m.reward}, ${m.levelTitle}, ${m.autoVerify}, true)
    `
    console.log(`  Level ${m.level}.${m.index}: ${m.title}`)
  }

  console.log(`\nSeeded ${missions.length} missions across 8 levels.`)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
