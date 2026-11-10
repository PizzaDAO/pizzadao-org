// Copies the pizzadao.org map's chapter cities into the app (app/lib/map-levels/map-cities.json).
//
//   node scripts/map-levels/sync-cities.mjs <path to pizzadao-site/src/data/pizzadao-cities.json>
//
// The site file is the source of truth. It carries `key` and `country` (ISO numeric) per city,
// added by the site's scripts/assign-city-countries.mjs. Descriptions (addresses, links) are
// dropped: they are site content and must not reach this repo.
// Re-run after the site's city list changes; a city added on the site only gets a level after the sync.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = process.argv[2]
if (!src) {
  console.error('usage: node scripts/map-levels/sync-cities.mjs <path to pizzadao-cities.json>')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const countriesTs = fs.readFileSync(path.join(root, 'app/lib/map-levels/countries.ts'), 'utf8')
const numericToIso2 = new Map()
for (const m of countriesTs.matchAll(/'([A-Z]{2})': '(\d{3})',/g)) numericToIso2.set(m[2], m[1])

const cities = JSON.parse(fs.readFileSync(src, 'utf8'))
const out = []
const problems = []
for (const c of cities) {
  const iso2 = numericToIso2.get(String(c.country ?? ''))
  if (!c.key || !iso2 || !Array.isArray(c.coords)) {
    problems.push(c.name)
    continue
  }
  out.push({ key: c.key, name: c.name, country: iso2, isoNumeric: String(c.country), coords: c.coords })
}
const keys = new Set(out.map((c) => c.key))
if (keys.size !== out.length) {
  console.error('Duplicate keys in the site file; re-run its assign-city-countries script.')
  process.exit(1)
}
fs.writeFileSync(
  path.join(root, 'app/lib/map-levels/map-cities.json'),
  JSON.stringify({ syncedAt: new Date().toISOString().slice(0, 10), cities: out }, null, 1) + '\n',
)
console.log(`${out.length} cities written` + (problems.length ? `; skipped (no key or country): ${problems.join(', ')}` : ''))
