import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ingestPresence, MANIFEST_FILE, presenceStats, readManifest } from './manifest.js'
import type { ManifestRecord } from './types.js'

const T0 = 1_000_000
const min = (n: number) => n * 60_000
const by = (stats: ReturnType<typeof presenceStats>, id: string) => stats.find((s) => s.userId === id)

describe('presenceStats', () => {
  it('sums the time between consecutive full-set records', () => {
    const records: ManifestRecord[] = [
      { t: 'presence', atMs: T0, userIds: ['a'] },
      { t: 'presence', atMs: T0 + min(10), userIds: ['a', 'b'] },
      { t: 'presence', atMs: T0 + min(30), userIds: ['a'] },
    ]
    const s = presenceStats(records, T0 + min(60))
    expect(by(s, 'a')?.presentSec).toBe(3600)
    expect(by(s, 'b')?.presentSec).toBe(1200)
    expect(by(s, 'b')?.firstSeenMs).toBe(T0 + min(10))
    expect(by(s, 'b')?.lastSeenMs).toBe(T0 + min(30))
  })

  it('adds up rejoins as separate stays', () => {
    const records: ManifestRecord[] = [
      { t: 'presence', atMs: T0, userIds: ['a', 'b'] },
      { t: 'presence', atMs: T0 + min(5), userIds: ['a'] },
      { t: 'presence', atMs: T0 + min(20), userIds: ['a', 'b'] },
    ]
    const s = presenceStats(records, T0 + min(30))
    expect(by(s, 'b')?.presentSec).toBe(5 * 60 + 10 * 60)
  })

  it('ignores records out of order and at or after the end', () => {
    const records: ManifestRecord[] = [
      { t: 'presence', atMs: T0 + min(10), userIds: ['b'] },
      { t: 'presence', atMs: T0, userIds: ['a'] },
      { t: 'presence', atMs: T0 + min(100), userIds: ['c'] },
    ]
    const s = presenceStats(records, T0 + min(20))
    expect(by(s, 'a')?.presentSec).toBe(600)
    expect(by(s, 'b')?.presentSec).toBe(600)
    expect(by(s, 'c')).toBeUndefined() // a record at or after the end adds nothing
  })

  it('drops purged users (bots are never recorded as present)', () => {
    const records: ManifestRecord[] = [
      { t: 'presence', atMs: T0, userIds: ['a', 'gone'] },
      { t: 'purge', userId: 'gone' },
    ]
    const s = presenceStats(records, T0 + min(10))
    expect(s.map((x) => x.userId)).toEqual(['a'])
  })

  it('a crash with a torn last line keeps everything before it', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'presence-'))
    const file = path.join(dir, MANIFEST_FILE)
    writeFileSync(file, `${JSON.stringify({ t: 'presence', atMs: T0, userIds: ['a'] })}\n`)
    appendFileSync(file, `${JSON.stringify({ t: 'presence', atMs: T0 + min(5), userIds: ['a', 'b'] })}\n{"t":"presence","atMs":`)
    const s = presenceStats(readManifest(dir), T0 + min(15))
    expect(by(s, 'a')?.presentSec).toBe(900)
    expect(by(s, 'b')?.presentSec).toBe(600)
  })

  it('a restart mid-call: the last set runs only until the finalized end time', () => {
    const records: ManifestRecord[] = [
      { t: 'presence', atMs: T0, userIds: ['a', 'b'] },
      { t: 'presence', atMs: T0 + min(10), userIds: ['a'] },
    ]
    const s = presenceStats(records, T0 + min(12))
    expect(by(s, 'a')?.presentSec).toBe(720)
    expect(by(s, 'b')?.presentSec).toBe(600)
  })

  it('falls back to first-seen records for old sessions (duration unknown)', () => {
    const s = presenceStats([{ t: 'present', userIds: ['b', 'a'] }], T0 + min(30))
    expect(s.map((x) => [x.userId, x.presentSec])).toEqual([['a', null], ['b', null]])
    expect(ingestPresence(s, T0)).toEqual([])
  })

  it('keeps someone only listed in an old-style record', () => {
    const s = presenceStats([{ t: 'presence', atMs: T0, userIds: ['a'] }, { t: 'present', userIds: ['z'] }], T0 + min(1))
    expect(by(s, 'z')?.presentSec).toBe(0)
  })
})

describe('ingestPresence', () => {
  it('uses times relative to the session start and caps the list at 300', () => {
    const stats = Array.from({ length: 305 }, (_, i) => ({ userId: String(i).padStart(18, '1'), presentSec: i, firstSeenMs: T0 + 5000, lastSeenMs: T0 + 9000 }))
    const out = ingestPresence(stats, T0)
    expect(out).toHaveLength(300)
    expect(out[0].presentSec).toBe(304)
    expect(out[0].firstSeenMs).toBe(5000)
  })
})
