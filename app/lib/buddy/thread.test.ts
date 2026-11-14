// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createPrivateThread } from './thread'

const input = { channelId: '100000', name: 'Buddy: A', content: 'hi <@1> <@2>', userIds: ['1', '2'] }
const res = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status })

describe('createPrivateThread', () => {
  it('creates a private thread, adds both people and posts the intro pinging only them', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, { id: '555555' })).mockResolvedValue(res(204))
    const r = await createPrivateThread(input, { fetchImpl: f as unknown as typeof fetch, botToken: 't' })
    expect(r).toEqual({ ok: true, threadId: '555555' })
    const [createUrl, createInit] = f.mock.calls[0]
    expect(createUrl).toBe('https://discord.com/api/v10/channels/100000/threads')
    expect(JSON.parse(createInit.body)).toMatchObject({ type: 12, invitable: false })
    expect(f.mock.calls.map((c) => c[1].method)).toEqual(['POST', 'PUT', 'PUT', 'POST'])
    expect(JSON.parse(f.mock.calls[3][1].body).allowed_mentions).toEqual({ users: ['1', '2'] })
  })
  it('reports a failure without throwing', async () => {
    const f = vi.fn().mockResolvedValue(res(403))
    expect(await createPrivateThread(input, { fetchImpl: f as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'thread_create_http_403' })
    expect(await createPrivateThread(input, { botToken: '' })).toEqual({ ok: false, reason: 'discord_not_configured' })
  })
  it('keeps the thread id when a later step fails', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, { id: '555555' })).mockResolvedValue(res(404))
    expect(await createPrivateThread(input, { fetchImpl: f as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'add_member_http_404', threadId: '555555' })
  })
})
