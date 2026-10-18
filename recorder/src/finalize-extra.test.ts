import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendRecord } from './manifest.js'
import { finalizeSession, writeSessionMeta } from './finalize.js'
import { isRetryableStatus, type IngestResult } from './ingest.js'
import { buildSpeakerTrackPlan, MAX_INPUTS_PER_PASS } from './mix-plan.js'
import { assertSessionPrefix, sessionKeys } from './storage.js'

function session() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fx-'))
  writeSessionMeta(dir, {
    sessionId: 'ev1-1000', eventId: '1', eventName: 'x', channelId: 'c',
    startedAtMs: 1000, endedAtMs: 9000, endReason: 'empty', partial: false,
  })
  mkdirSync(path.join(dir, 'seg', '111'), { recursive: true })
  writeFileSync(path.join(dir, 'seg', '111', '0.ogg'), 'ogg')
  appendRecord(dir, { t: 'segment', userId: '111', startMs: 0, endMs: 1000, file: 'seg/111/0.ogg', bytes: 3 })
  return dir
}

const mk = (post: () => Promise<IngestResult>) => {
  const order: string[] = []
  return {
    order,
    deps: {
      appBaseUrl: 'a', apiKey: 'k', log: () => {},
      ffmpeg: async (args: string[]) => writeFileSync(args.at(-1)!, 'a'),
      uploader: {
        put: async (k: string) => (order.push(`put:${k}`), 1),
        pruneExcept: async (p: string, keep: ReadonlySet<string>) => (order.push(`prune:${p}:${[...keep].sort().join(',')}`), 0),
      },
      postIngest: post,
    },
  }
}

describe('R2 cleanup after finalize', () => {
  it('uploads first, then prunes only objects outside the stored row (never a window with missing objects)', async () => {
    const { deps, order } = mk(async () => ({
      ok: true,
      id: 'r',
      duplicate: false,
      keys: ['calls/ev1-1000/mix.m4a', 'calls/ev1-1000/tracks/111.ogg'],
    }))
    expect(await finalizeSession(session(), deps)).toBe('uploaded')
    expect(order.filter((o) => o.startsWith('put:'))).toHaveLength(2)
    expect(order.at(-1)).toBe('prune:calls/ev1-1000/:calls/ev1-1000/mix.m4a,calls/ev1-1000/tracks/111.ogg')
    expect(order.findIndex((o) => o.startsWith('prune:'))).toBeGreaterThan(order.findLastIndex((o) => o.startsWith('put:')))
  })

  it('on a duplicate ingest keeps the EXISTING row\'s keys', async () => {
    const { deps, order } = mk(async () => ({ ok: true, id: 'r', duplicate: true, keys: ['calls/ev1-1000/tracks/222.ogg'] }))
    await finalizeSession(session(), deps)
    expect(order.at(-1)).toBe('prune:calls/ev1-1000/:calls/ev1-1000/tracks/222.ogg')
  })

  it('does not prune (and stays pending) when the ingest has not succeeded', async () => {
    const { deps, order } = mk(async () => ({ ok: false, retryable: true, error: '503' }))
    expect(await finalizeSession(session(), deps)).toBe('pending')
    expect(order.some((o) => o.startsWith('prune:'))).toBe(false)
  })

  it('never deletes anything from R2 when the app permanently refuses the payload', async () => {
    const { deps, order } = mk(async () => ({ ok: false, retryable: false, error: '400' }))
    expect(await finalizeSession(session(), deps)).toBe('rejected')
    expect(order.some((o) => o.startsWith('prune:'))).toBe(false)
  })

  it('keeps audio and stays pending on auth / route errors', async () => {
    for (const status of [401, 403, 404]) expect(isRetryableStatus(status)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(422)).toBe(false)
    const { deps, order } = mk(async () => ({ ok: false, retryable: isRetryableStatus(401), error: '401' }))
    expect(await finalizeSession(session(), deps)).toBe('pending')
    expect(order.some((o) => o.startsWith('prune:'))).toBe(false)
  })
})

describe('session prefix guard', () => {
  it('accepts a real session prefix', () => {
    expect(() => assertSessionPrefix('calls/1394003497153724497-1760000000000/')).not.toThrow()
    expect(sessionKeys('ev1-1000').prefix).toBe('calls/ev1-1000/')
  })

  it.each(['', 'calls/', 'calls//', 'calls/../', 'calls/a b/', 'calls/abc/', 'other/ev1-1000/', 'calls/ev1-1000', 'calls/ev1-1000/tracks/'])(
    'refuses %j',
    (prefix) => {
      expect(() => assertSessionPrefix(prefix)).toThrow()
    },
  )

  it.each(['', 'a', '../x', 'a/b/c/d/e/f', 'x'.repeat(81)])('sessionKeys refuses a malformed session id %j', (id) => {
    expect(() => sessionKeys(id)).toThrow()
  })
})

describe('buildSpeakerTrackPlan', () => {
  const segs = (n: number) => Array.from({ length: n }, (_, i) => ({ file: `/s/${i}.ogg`, startMs: i * 1000 }))

  it('is one pass up to the per-pass limit', () => {
    expect(buildSpeakerTrackPlan(segs(MAX_INPUTS_PER_PASS), '/o/u.ogg', '/o/u')).toHaveLength(1)
  })

  it('chunks a chatty speaker: no pass opens more than 200 files, the last sums the chunks', () => {
    const plan = buildSpeakerTrackPlan(segs(450), '/o/u.ogg', '/o/u')
    expect(plan).toHaveLength(4)
    for (const pass of plan) expect(pass.filter((a) => a === '-i').length).toBeLessThanOrEqual(MAX_INPUTS_PER_PASS)
    expect(plan[3].filter((a) => a === '-i')).toHaveLength(3)
    expect(plan[3].at(-1)).toBe('/o/u.ogg')
    expect(plan[0].at(-1)).toBe('/o/u.part0.ogg')
    expect(plan[0]).toContain('64k')
  })
})
