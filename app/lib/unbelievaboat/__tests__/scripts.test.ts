// @vitest-environment node
/**
 * End-to-end: run the real export.mjs against a local mock of the
 * UnbelievaBoat API, then import.mjs (dry run) on the snapshot it wrote.
 * No network beyond 127.0.0.1, no database.
 */
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOT_ID, createMockUb, FIXTURE_GUILD, FIXTURE_TOKEN } from './mock-ub'

const run = promisify(execFile)
const ROOT = path.resolve(__dirname, '../../../..')
const EXPORT = path.join(ROOT, 'scripts/unbelievaboat/export.mjs')
const IMPORT = path.join(ROOT, 'scripts/unbelievaboat/import.mjs')
const CREW = path.join(ROOT, 'app/lib/unbelievaboat/__fixtures__/crew.csv')

let server: Server
let base = ''
let origin = ''
let out = ''
const mock = createMockUb({ pageSize: 3, rateLimitOn: [3], changedUsers: { '100000000000000008': { cash: 999, bank: 500, total: 1499 } } })
const ZERO = path.join(ROOT, 'scripts/unbelievaboat/zero-balances.mjs')

// Clean env: no DB, no real tokens leak into the children.
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PATH: process.env.PATH ?? '',
    HOME: out,
    DISCORD_GUILD_ID: FIXTURE_GUILD,
    UNBELIEVABOAT_API_TOKEN: FIXTURE_TOKEN,
    UNBELIEVABOAT_API_BASE: base,
    UNBELIEVABOAT_PUBLIC_BASE: `${origin}/api`,
    ...extra,
  }
}

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'ub-migration-'))
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const r = mock.handle(origin + (req.url ?? ''), (req.headers.authorization as string) ?? null, req.method, body)
      res.writeHead(r.status, r.headers)
      res.end(r.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as { port: number }
  origin = `http://127.0.0.1:${addr.port}`
  base = `${origin}/api/v1`
})

afterAll(() => {
  server?.close()
  if (out) rmSync(out, { recursive: true, force: true })
})

describe('export.mjs + import.mjs', () => {
  let snapshotPath = ''

  it('exports a checksummed snapshot through pagination and a 429', async () => {
    const { stdout } = await run(process.execPath, [EXPORT, '--out', out, '--page-size', '3', '--store'], { cwd: out, env: env() })
    expect(stdout).toContain('users 8')
    const files = readdirSync(out)
    const json = files.find((f) => f.endsWith('.json') && !f.endsWith('.manifest.json'))!
    expect(files).toContain(json.replace('.json', '.csv'))
    expect(files).toContain(json.replace('.json', '.manifest.json'))
    snapshotPath = path.join(out, json)
    const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    expect(snap.users).toHaveLength(8)
    expect(snap.storeItems.map((s: { name: string }) => s.name)).toContain('Rare Pizza Box')
    // permissions + 3 leaderboard pages + one retried 429 + store
    expect(mock.calls.filter((c) => c.url.includes('/users?')).length).toBe(4)
  }, 60_000)

  it('dry-runs the import with member matching and writes the plan CSV', async () => {
    const { stdout } = await run(
      process.execPath,
      [IMPORT, '--snapshot', snapshotPath, '--members', CREW, '--no-db', '--exclude', '100000000000000005'],
      { cwd: out, env: env() },
    )
    expect(stdout).toContain('manifest: OK (unsigned)')
    expect(stdout).toMatch(/matched \(credit now\):\s+2 users\s+1504 PEP/)
    expect(stdout).toMatch(/unmatched \(pending claim\):\s+2 users\s+510 PEP/)
    expect(stdout).toContain('PEP total to mint:        2014')
    expect(stdout).toContain('DRY RUN - nothing was written')
    expect(readdirSync(out).some((f) => f.includes('.plan-'))).toBe(true)
  }, 60_000)

  it('refuses --apply without a database, and on a tampered snapshot', async () => {
    await expect(
      run(process.execPath, [IMPORT, '--snapshot', snapshotPath, '--no-db', '--apply', '--confirm-total', '2014'], { cwd: out, env: env() }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('need DATABASE_URL') })

    const tampered = snapshotPath.replace('.json', '-tampered.json')
    writeFileSync(tampered, readFileSync(snapshotPath, 'utf8').replace('"cash": "54"', '"cash": "55"'))
    writeFileSync(tampered.replace('.json', '.manifest.json'), readFileSync(snapshotPath.replace('.json', '.manifest.json')))
    await expect(
      run(process.execPath, [IMPORT, '--snapshot', tampered, '--apply', '--confirm-total', '1'], {
        cwd: out,
        env: env({ DATABASE_URL: 'postgresql://never-used.invalid/db' }),
      }),
    ).rejects.toMatchObject({ stderr: expect.stringMatching(/totals do not match|manifest/) })
  }, 60_000)

  it('signs the manifest when UB_SNAPSHOT_SIGNING_KEY is set and rejects the wrong key', async () => {
    const dir = path.join(out, 'signed')
    await run(process.execPath, [EXPORT, '--out', dir], { cwd: out, env: env({ UB_SNAPSHOT_SIGNING_KEY: 'k1' }) })
    const json = readdirSync(dir).find((f) => f.endsWith('.json') && !f.endsWith('.manifest.json'))!
    const ok = await run(process.execPath, [IMPORT, '--snapshot', path.join(dir, json), '--no-db'], { cwd: out, env: env({ UB_SNAPSHOT_SIGNING_KEY: 'k1' }) })
    expect(ok.stdout).toContain('manifest: OK (signed)')
    const bad = await run(process.execPath, [IMPORT, '--snapshot', path.join(dir, json), '--no-db'], { cwd: out, env: env({ UB_SNAPSHOT_SIGNING_KEY: 'k2' }) })
    expect(bad.stdout).toContain('manifest: MISMATCH')
  }, 60_000)

  it('fails clearly on a bad token', async () => {
    await expect(
      run(process.execPath, [EXPORT, '--out', path.join(out, 'x')], { cwd: out, env: env({ UNBELIEVABOAT_API_TOKEN: 'nope' }) }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('UB rejected the token') })
  }, 60_000)

  it('exports without a token from the public leaderboard, with bot flags', async () => {
    const dir = path.join(out, 'public')
    const { stdout } = await run(process.execPath, [EXPORT, '--public', '--out', dir], { cwd: out, env: env({ UNBELIEVABOAT_API_TOKEN: '' }) })
    expect(stdout).toContain('users 8')
    const json = readdirSync(dir).find((f) => f.endsWith('.json') && !f.endsWith('.manifest.json'))!
    const snap = JSON.parse(readFileSync(path.join(dir, json), 'utf8'))
    expect(snap.users.find((u: { discordId: string }) => u.discordId === BOT_ID).bot).toBe(true)
    // ...so the import excludes the bot without an --exclude list
    const dry = await run(process.execPath, [IMPORT, '--snapshot', path.join(dir, json), '--members', CREW, '--no-db'], { cwd: out, env: env() })
    expect(dry.stdout).toMatch(/excluded \(bots\/list\):\s+1 users/)
    expect(dry.stdout).toContain('Discord bot account')
  }, 60_000)

  it('zero-balances is a dry run by default and skips users whose UB balance moved', async () => {
    const dry = await run(process.execPath, [ZERO, '--snapshot', snapshotPath], { cwd: out, env: env() })
    expect(dry.stdout).toContain('to zero: 6 users')
    expect(dry.stdout).toContain('DRY RUN - UnbelievaBoat was not changed')
    expect(mock.puts).toHaveLength(0)

    const applied = await run(process.execPath, [ZERO, '--snapshot', snapshotPath, '--apply', '--confirm-count', '6'], { cwd: out, env: env() }).catch(
      (e) => e,
    )
    expect(applied.code).toBe(2) // one user changed since the snapshot
    expect(applied.stdout).toContain('Zeroed 5/6')
    expect(mock.puts).toHaveLength(5)
    expect(mock.puts.every((p) => p.body.cash === 0 && p.body.bank === 0 && /Migrated to \$PEP/.test(p.body.reason ?? ''))).toBe(true)
    expect(mock.puts.some((p) => p.userId === '100000000000000008')).toBe(false)
  }, 60_000)
})
