// Import crew drafts from markdown files.
//
//   node scripts/seed-crew-drafts.mjs [--crew comms] [--created-by <discordId>] [--apply] file.md [file2.md ...]
//
// DRY RUN by default: parses the files and prints what it would insert,
// touching no database. With --apply it inserts into the database named by
// DATABASE_URL in .env (check which database that is first). Drafts whose
// crew + platform + text already exist are skipped, so re-running is safe.
// Imported drafts start as status DRAFT. Needs the CrewDraft migration applied.
//
// File format: see scripts/lib/parse-drafts.mjs (drafts separated by `---`).

import { readFileSync, existsSync } from 'fs'
import { basename, resolve } from 'path'
import { parseDraftsMarkdown } from './lib/parse-drafts.mjs'

const args = process.argv.slice(2)
let apply = false
let crew = 'comms'
let createdBy = 'seed-script'
const files = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--apply') apply = true
  else if (a === '--crew') crew = args[++i]
  else if (a === '--created-by') createdBy = args[++i]
  else if (a.startsWith('--')) {
    console.error(`Unknown option ${a}`)
    process.exit(1)
  } else files.push(a)
}
if (files.length === 0) {
  console.error('Usage: node scripts/seed-crew-drafts.mjs [--crew comms] [--created-by <discordId>] [--apply] file.md ...')
  process.exit(1)
}

const drafts = []
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`File not found: ${f}`)
    process.exit(1)
  }
  for (const d of parseDraftsMarkdown(readFileSync(f, 'utf-8'), basename(f))) drafts.push({ ...d, file: f })
}

console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${drafts.length} draft(s) for crew "${crew}" from ${files.length} file(s)`)
drafts.forEach((d, n) => {
  const preview = d.text.replace(/\s+/g, ' ').slice(0, 90)
  console.log(`  ${n + 1}. [${d.platform}] ${preview}${d.text.length > 90 ? '…' : ''}  (${basename(d.file)})`)
})

if (!apply) {
  console.log('\nNothing written. Re-run with --apply to insert.')
  process.exit(0)
}

// Load .env manually (same approach as the other seed scripts)
const envPath = resolve(import.meta.dirname, '..', '.env')
const envVars = {}
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      let val = match[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      envVars[match[1].trim()] = val
    }
  }
}
const DATABASE_URL = process.env.DATABASE_URL || envVars.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL not found in env or .env')
  process.exit(1)
}

const { neon } = await import('@neondatabase/serverless')
const sql = neon(DATABASE_URL)

let inserted = 0
let skipped = 0
for (const d of drafts) {
  const existing = await sql`
    SELECT 1 FROM "CrewDraft"
    WHERE "crewId" = ${crew} AND "platform" = ${d.platform.toUpperCase()}::"CrewDraftPlatform" AND "text" = ${d.text}
    LIMIT 1`
  if (existing.length) {
    skipped++
    continue
  }
  await sql`
    INSERT INTO "CrewDraft" ("crewId", "platform", "text", "mediaUrl", "notes", "status", "createdBy", "updatedBy", "updatedAt")
    VALUES (${crew}, ${d.platform.toUpperCase()}::"CrewDraftPlatform", ${d.text}, ${d.mediaUrl}, ${d.notes},
            'DRAFT'::"CrewDraftStatus", ${createdBy}, ${createdBy}, NOW())`
  inserted++
}
console.log(`Done: ${inserted} inserted, ${skipped} skipped (already present).`)
