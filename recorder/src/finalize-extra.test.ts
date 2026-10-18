import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendRecord } from './manifest.js'
import { finalizeSession, writeSessionMeta } from './finalize.js'
import { isRetryableStatus } from './ingest.js'
import { buildSpeakerTrackPlan, MAX_INPUTS_PER_PASS } from './mix-plan.js'

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

const mk = (post: () => Promise<{ ok: false; retryable: boolean; error: string }>) => {
  const order: string[] = []
  return {
    order,
    deps: {
      appBaseUrl: 'a', apiKey: 'k', log: () => {},
      ffmpeg: async (args: string[]) => writeFileSync(args.at(-1)!, 'a'),
      uploader: {
        put: async (k: string) => (order.push(`put:${k}`), 1),
        deletePrefix: async (p: string) => (order.push(`del:${p}`), 0),
      },
      postIngest: post,
    },
  }
}

describe('finalize cleanup of R2', () => {
  it('clears stale objects of earlier attempts before uploading', async () => {
    const { deps, order } = mk(async () => ({ ok: false, retryable: true, error: '503' }))
    await finalizeSession(session(), deps)
    expect(order[0]).toBe('del:calls/ev1-1000/')
    expect(order.slice(1).every((o) => o.startsWith('put:'))).toBe(true)
  })

  it('deletes everything it uploaded when the app permanently refuses the payload', async () => {
    const { deps, order } = mk(async () => ({ ok: false, retryable: false, error: '400' }))
    expect(await finalizeSession(session(), deps)).toBe('rejected')
    expect(order.at(-1)).toBe('del:calls/ev1-1000/')
  })

  it('keeps audio (no delete, stays pending) on auth / route errors', async () => {
    for (const status of [401, 403, 404]) {
      expect(isRetryableStatus(status)).toBe(true)
    }
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(422)).toBe(false)
    const { deps, order } = mk(async () => ({ ok: false, retryable: isRetryableStatus(401), error: '401' }))
    expect(await finalizeSession(session(), deps)).toBe('pending')
    expect(order.filter((o) => o.startsWith('del:'))).toHaveLength(1) // only the pre-upload cleanup
  })
})

describe('buildSpeakerTrackPlan', () => {
  const segs = (n: number) => Array.from({ length: n }, (_, i) => ({ file: `/s/${i}.ogg`, startMs: i * 1000 }))

  it('is one pass up to the per-pass limit', () => {
    const plan = buildSpeakerTrackPlan(segs(MAX_INPUTS_PER_PASS), '/o/u.ogg', '/o/u')
    expect(plan).toHaveLength(1)
  })

  it('chunks a chatty speaker: no pass opens more than 200 files, the last sums the chunks', () => {
    const plan = buildSpeakerTrackPlan(segs(450), '/o/u.ogg', '/o/u')
    expect(plan).toHaveLength(4) // 200 + 200 + 50, then the final sum
    for (const pass of plan) expect(pass.filter((a) => a === '-i').length).toBeLessThanOrEqual(MAX_INPUTS_PER_PASS)
    expect(plan[3].filter((a) => a === '-i')).toHaveLength(3)
    expect(plan[3].at(-1)).toBe('/o/u.ogg')
    expect(plan[0].at(-1)).toBe('/o/u.part0.ogg')
    expect(plan[0]).toContain('64k')
  })
})
