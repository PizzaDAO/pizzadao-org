import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendRecord } from './manifest.js'
import { finalizeSession, writeSessionMeta } from './finalize.js'
import type { IngestPayload } from './types.js'

function session(withAudio: boolean) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fc-'))
  writeSessionMeta(dir, { sessionId: 'ev1-1000', eventId: '1', eventName: 'x', channelId: 'c', startedAtMs: 1000, endedAtMs: 9000, endReason: 'empty', partial: false })
  if (withAudio) {
    mkdirSync(path.join(dir, 'seg', '111'), { recursive: true })
    writeFileSync(path.join(dir, 'seg', '111', '0.ogg'), 'ogg')
    appendRecord(dir, { t: 'segment', userId: '111', startMs: 0, endMs: 1000, file: 'seg/111/0.ogg', bytes: 3 })
  }
  appendRecord(dir, { t: 'chat', messageId: '700000000000000001', userId: '222', displayName: 'Carol', text: 'hola', atMs: 500 })
  appendRecord(dir, { t: 'chat', messageId: '700000000000000002', userId: '222', displayName: 'Carol', text: 'oops', atMs: 600 })
  appendRecord(dir, { t: 'chat-delete', messageId: '700000000000000002' })
  return dir
}

const run = async (dir: string) => {
  const posted: IngestPayload[] = []
  const status = await finalizeSession(dir, {
    appBaseUrl: 'a',
    apiKey: 'k',
    log: () => {},
    ffmpeg: async (args: string[]) => writeFileSync(args.at(-1)!, 'a'),
    uploader: { put: async () => 1, pruneExcept: async () => 0 },
    postIngest: async (p) => (posted.push(p), { ok: true, id: 'r', duplicate: false, keys: [] }),
  })
  return { status, posted }
}

describe('chat in the ingest payload', () => {
  it('sends the surviving chat messages with the session', async () => {
    const { status, posted } = await run(session(true))
    expect(status).toBe('uploaded')
    expect(posted[0]!.chat).toEqual([{ discordId: '222', displayName: 'Carol', text: 'hola', atMs: 500, messageId: '700000000000000001' }])
  })

  it('a session with enough chat but no audio is still ingested', async () => {
    const dir = session(false)
    for (const n of [3, 4]) appendRecord(dir, { t: 'chat', messageId: `70000000000000000${n}`, userId: '222', displayName: 'Carol', text: 'more', atMs: 700 + n })
    const { status, posted } = await run(dir)
    expect(status).toBe('uploaded')
    expect(posted[0]!.speakers).toEqual([])
    expect(posted[0]!.chat).toHaveLength(3)
  })

  it('no audio and fewer than 3 chat messages is not ingested', async () => {
    const { status, posted } = await run(session(false))
    expect(status).toBe('empty')
    expect(posted).toEqual([])
  })

  it('a 413 retries once without the chat instead of rejecting the audio', async () => {
    const posted: IngestPayload[] = []
    const status = await finalizeSession(session(true), {
      appBaseUrl: 'a',
      apiKey: 'k',
      log: () => {},
      ffmpeg: async (args: string[]) => writeFileSync(args.at(-1)!, 'a'),
      uploader: { put: async () => 1, pruneExcept: async () => 0 },
      postIngest: async (p) => {
        posted.push(p)
        return p.chat ? { ok: false, retryable: false, error: 'app answered 413: too large' } : { ok: true, id: 'r', duplicate: false, keys: [] }
      },
    })
    expect(status).toBe('uploaded')
    expect(posted).toHaveLength(2)
    expect(posted[1]!.chat).toBeUndefined()
    expect(posted[1]!.speakers).toHaveLength(1)
  })
})
