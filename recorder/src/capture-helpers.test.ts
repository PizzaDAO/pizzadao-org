import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GapFiller } from './gap-filler.js'
import { appendRecord, purgeUsersInDir, readManifest, summarize } from './manifest.js'
import { buildMixArgs, buildSpeakerTrackArgs } from './mix-plan.js'
import { OptOutCache } from './optouts.js'
import { loadConfig } from './config.js'
import { finalizeSession, pendingSessions, reconcileOrphans, writeSessionMeta } from './finalize.js'
import { postIngestWithRetry } from './ingest.js'
import type { IngestPayload, SessionMeta } from './types.js'

describe('GapFiller', () => {
  it('inserts nothing for back-to-back 20ms packets', () => {
    const g = new GapFiller(1000)
    expect([0, 20, 40, 60].map((t) => g.onPacket(1000 + t))).toEqual([0, 0, 0, 0])
  })

  it('fills a pause with silence frames so the file stays on the clock', () => {
    const g = new GapFiller(0)
    g.onPacket(0)
    // next packet arrives 500ms later: 25 frames elapsed, 24 are missing
    expect(g.onPacket(500)).toBe(24)
    // and the clock stays aligned afterwards
    expect(g.onPacket(520)).toBe(0)
  })

  it('does not accumulate drift from jitter, and tolerates bursts', () => {
    const g = new GapFiller(0)
    g.onPacket(0)
    g.onPacket(35) // late by 15ms: below the threshold
    expect(g.onPacket(40)).toBe(0) // burst catch-up
    expect(g.onPacket(60)).toBe(0)
  })

  it('caps one fill at maxFillFrames', () => {
    const g = new GapFiller(0, 10)
    g.onPacket(0)
    expect(g.onPacket(60_000)).toBe(10)
  })
})

describe('mix-plan', () => {
  it('delays each segment to its offset and sums them (sorted)', () => {
    const args = buildSpeakerTrackArgs(
      [
        { file: '/s/2.ogg', startMs: 5000 },
        { file: '/s/1.ogg', startMs: 1200.4 },
      ],
      '/o/u.ogg',
    )
    expect(args.filter((a) => a === '-i').length).toBe(2)
    expect(args.indexOf('/s/1.ogg')).toBeLessThan(args.indexOf('/s/2.ogg'))
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('[0:a]adelay=1200:all=1[a0]')
    expect(graph).toContain('[1:a]adelay=5000:all=1[a1]')
    expect(graph).toContain('amix=inputs=2:normalize=0')
    expect(args.at(-1)).toBe('/o/u.ogg')
    expect(args).toContain('libopus')
  })

  it('handles a single segment without amix', () => {
    const graph = buildSpeakerTrackArgs([{ file: '/a.ogg', startMs: 0 }], '/o.ogg')
    expect(graph[graph.indexOf('-filter_complex') + 1]).toBe('[0:a]adelay=0:all=1[out]')
  })

  it('refuses empty and oversized plans', () => {
    expect(() => buildSpeakerTrackArgs([], '/o.ogg')).toThrow()
    expect(() => buildSpeakerTrackArgs(Array.from({ length: 20001 }, (_, i) => ({ file: `/${i}.ogg`, startMs: i })), '/o.ogg')).toThrow()
    expect(() => buildMixArgs([], '/m.m4a')).toThrow()
  })

  it('mixes tracks to a mono AAC m4a with faststart', () => {
    const args = buildMixArgs(['/a.ogg', '/b.ogg', '/c.ogg'], '/m.m4a')
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('amix=inputs=3:normalize=0')
    expect(args).toEqual(expect.arrayContaining(['aac', '+faststart', '-ac', '1']))
    expect(args.at(-1)).toBe('/m.m4a')
  })
})

describe('manifest', () => {
  const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'rec-'))

  it('summarizes speakers: talk time, ordering, names, empty segments dropped', () => {
    const d = tmp()
    appendRecord(d, { t: 'member', userId: 'a', displayName: 'Ann' })
    appendRecord(d, { t: 'segment', userId: 'a', startMs: 5000, endMs: 15000, file: 'seg/a/5000.ogg', bytes: 10 })
    appendRecord(d, { t: 'segment', userId: 'a', startMs: 1000, endMs: 3000, file: 'seg/a/1000.ogg', bytes: 10 })
    appendRecord(d, { t: 'segment', userId: 'b', startMs: 0, endMs: 60000, file: 'seg/b/0.ogg', bytes: 0 })
    appendRecord(d, { t: 'segment', userId: 'c', startMs: 0, endMs: 1000, file: 'seg/c/0.ogg', bytes: 5 })
    const out = summarize(readManifest(d))
    expect(out.map((s) => s.userId)).toEqual(['a', 'c'])
    expect(out[0]).toMatchObject({ displayName: 'Ann', talkTimeSec: 12 })
    expect(out[0].segments.map((s) => s.startMs)).toEqual([1000, 5000])
    expect(out[1].displayName).toBeNull()
  })

  it('drops purged (opted-out) users and deletes their files', () => {
    const d = tmp()
    mkdirSync(path.join(d, 'seg', 'a'), { recursive: true })
    writeFileSync(path.join(d, 'seg', 'a', '0.ogg'), 'x')
    appendRecord(d, { t: 'segment', userId: 'a', startMs: 0, endMs: 1000, file: 'seg/a/0.ogg', bytes: 1 })
    appendRecord(d, { t: 'segment', userId: 'b', startMs: 0, endMs: 1000, file: 'seg/b/0.ogg', bytes: 1 })
    expect(purgeUsersInDir(d, (u) => u === 'a')).toEqual(['a'])
    expect(existsSync(path.join(d, 'seg', 'a'))).toBe(false)
    expect(summarize(readManifest(d)).map((s) => s.userId)).toEqual(['b'])
  })

  it('ignores a torn last line', () => {
    const d = tmp()
    appendRecord(d, { t: 'member', userId: 'a', displayName: 'Ann' })
    writeFileSync(path.join(d, 'manifest.jsonl'), readFileSync(path.join(d, 'manifest.jsonl'), 'utf8') + '{"t":"segm')
    expect(readManifest(d)).toHaveLength(1)
  })
})

describe('OptOutCache', () => {
  it('filters opted-out users and reports newly added ids', async () => {
    let ids = ['1']
    const onNew = vi.fn()
    const c = new OptOutCache(async () => ids, onNew)
    expect(c.isLoaded).toBe(false)
    await c.refresh()
    expect(c.has('1')).toBe(true)
    expect(c.has('2')).toBe(false)
    expect(onNew).toHaveBeenLastCalledWith(['1'])
    ids = ['1', '2']
    await c.refresh()
    expect(onNew).toHaveBeenLastCalledWith(['2'])
    ids = ['2']
    await c.refresh() // opt-in: '1' removed, nothing new
    expect(c.has('1')).toBe(false)
    expect(onNew).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good list when the app is unreachable', async () => {
    let fail = false
    const c = new OptOutCache(async () => {
      if (fail) throw new Error('down')
      return ['9']
    })
    await c.refresh()
    fail = true
    expect(await c.refresh()).toBe(false)
    expect(c.has('9')).toBe(true)
  })
})

describe('loadConfig', () => {
  const base = {
    DISCORD_BOT_TOKEN: 't',
    DISCORD_GUILD_ID: 'g',
    RECORDER_API_KEY: 'k',
    R2_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'a',
    R2_SECRET_ACCESS_KEY: 's',
    R2_BUCKET_NAME: 'b',
  }
  it('applies defaults', () => {
    const c = loadConfig(base)
    expect(c.callChannelId).toBe('823956905739026442')
    expect(c.maxCallMinutes).toBe(120)
    expect(c.emptyGraceMinutes).toBe(5)
    expect(c.dataDir).toBe('/data')
    expect(c.appBaseUrl).toBe('https://app.pizzadao.org')
  })
  it('lists everything that is missing or invalid', () => {
    expect(() => loadConfig({ MAX_CALL_MINUTES: '-1' })).toThrow(/DISCORD_BOT_TOKEN[\s\S]*MAX_CALL_MINUTES/)
  })
})

describe('finalizeSession', () => {
  const setup = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'rec-'))
    const meta: SessionMeta = {
      sessionId: 'ev1-1000',
      eventId: '1',
      eventName: 'Community Call',
      channelId: 'c',
      startedAtMs: 1_000_000,
      endedAtMs: 1_600_000,
      endReason: 'empty',
      partial: false,
    }
    writeSessionMeta(dir, meta)
    mkdirSync(path.join(dir, 'seg', '111'), { recursive: true })
    writeFileSync(path.join(dir, 'seg', '111', '5000.ogg'), 'ogg')
    appendRecord(dir, { t: 'member', userId: '111', displayName: 'Ann' })
    appendRecord(dir, { t: 'segment', userId: '111', startMs: 5000, endMs: 65000, file: 'seg/111/5000.ogg', bytes: 3 })
    return dir
  }
  const deps = (over: Record<string, unknown> = {}) => {
    const puts: string[] = []
    const deleted: string[] = []
    const posted: IngestPayload[] = []
    return {
      puts,
      deleted,
      posted,
      deps: {
        appBaseUrl: 'https://app',
        apiKey: 'k',
        log: () => {},
        // fake ffmpeg: create the output file (last arg)
        ffmpeg: async (args: string[]) => writeFileSync(args.at(-1)!, 'audio'),
        uploader: {
          put: async (key: string) => {
            puts.push(key)
            return 5
          },
          pruneExcept: async (prefix: string, keep: ReadonlySet<string>) => {
            deleted.push(`${prefix} keep=${[...keep].sort().join(',')}`)
            return 0
          },
        },
        postIngest: async (p: IngestPayload) => {
          posted.push(p)
          return { ok: true as const, id: 'rec1', duplicate: false, keys: [] as string[] }
        },
        ...over,
      },
    }
  }

  it('uploads tracks + mix under calls/<sessionId>/ and reports the metadata', async () => {
    const dir = setup()
    const { deps: d, puts, posted } = deps()
    expect(await finalizeSession(dir, d)).toBe('uploaded')
    expect(puts).toEqual(['calls/ev1-1000/mix.m4a', 'calls/ev1-1000/tracks/111.ogg'])
    expect(posted[0]).toMatchObject({
      sessionId: 'ev1-1000',
      eventId: '1',
      eventName: 'Community Call',
      endReason: 'empty',
      partial: false,
      mix: { key: 'calls/ev1-1000/mix.m4a', bytes: 5 },
      speakers: [{ discordId: '111', displayName: 'Ann', talkTimeSec: 60, trackKey: 'calls/ev1-1000/tracks/111.ogg' }],
    })
    expect(existsSync(path.join(dir, 'seg'))).toBe(false) // local audio removed
    expect(pendingSessions(path.dirname(dir))).not.toContain(dir)
  })

  it('stays pending (retried later) when the upload or the app fails', async () => {
    const dir = setup()
    const failing = deps({ postIngest: async () => ({ ok: false as const, retryable: true, error: '503' }) })
    expect(await finalizeSession(dir, failing.deps)).toBe('pending')
    expect(existsSync(path.join(dir, 'seg'))).toBe(true)
    expect(pendingSessions(path.dirname(dir))).toContain(dir)

    const noR2 = deps({ uploader: { put: async () => { throw new Error('r2 down') } } })
    expect(await finalizeSession(dir, noR2.deps)).toBe('pending')
  })

  it('does not retry a payload the app refused for good', async () => {
    const dir = setup()
    const { deps: d } = deps({ postIngest: async () => ({ ok: false as const, retryable: false, error: '400' }) })
    expect(await finalizeSession(dir, d)).toBe('rejected')
    expect(pendingSessions(path.dirname(dir))).not.toContain(dir)
  })

  it('ingests nothing (and does not retry forever) when no speaker track could be built', async () => {
    const dir = setup()
    const { deps: d, posted } = deps({ ffmpeg: async (args: string[]) => { if (args.at(-1)!.endsWith('111.ogg')) throw new Error('boom'); writeFileSync(args.at(-1)!, 'a') } })
    // only speaker fails -> nothing to ingest
    expect(await finalizeSession(dir, d)).toBe('empty')
    expect(posted).toHaveLength(0)
  })

  it('picks up segment files a crash left out of the manifest', () => {
    const dir = setup()
    mkdirSync(path.join(dir, 'seg', '222'), { recursive: true })
    writeFileSync(path.join(dir, 'seg', '222', '9000.ogg'), 'zz')
    expect(reconcileOrphans(dir)).toBe(1)
    expect(summarize(readManifest(dir)).map((s) => s.userId).sort()).toEqual(['111', '222'])
    expect(reconcileOrphans(dir)).toBe(0)
  })
})

describe('postIngestWithRetry', () => {
  const payload = {} as IngestPayload
  it('retries 5xx then succeeds, and gives up on 4xx', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    f.mockResolvedValueOnce(new Response('x', { status: 503 })).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'r', duplicate: false }), { status: 201 }),
    )
    const ok = await postIngestWithRetry('https://app', 'k', payload, 3, async () => {})
    expect(ok).toMatchObject({ ok: true, id: 'r' })
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer k')

    f.mockReset().mockResolvedValue(new Response('bad', { status: 400 }))
    const bad = await postIngestWithRetry('https://app', 'k', payload, 3, async () => {})
    expect(bad).toMatchObject({ ok: false, retryable: false })
    expect(f).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
