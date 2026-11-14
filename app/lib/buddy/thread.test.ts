// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { clearBotIdCache, createPrivateThread } from './thread'

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
  it('reuses an existing thread: no create call, members added, bot messages checked, intro posted', async () => {
    clearBotIdCache()
    const f = vi.fn().mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(200, { id: '900000' })).mockResolvedValueOnce(res(200, [{ author: { id: '1' }, content: 'other' }])).mockResolvedValue(res(204))
    const r = await createPrivateThread({ ...input, existingThreadId: '555555' }, { fetchImpl: f as unknown as typeof fetch, botToken: 't' })
    expect(r).toEqual({ ok: true, threadId: '555555' })
    expect(f.mock.calls.map((c) => c[1].method)).toEqual(['PUT', 'PUT', 'GET', 'GET', 'POST'])
    expect(f.mock.calls[0][0]).toBe('https://discord.com/api/v10/channels/555555/thread-members/1')
  })
  it('does not repost when the bot intro is already in the thread', async () => {
    clearBotIdCache()
    const f = vi.fn().mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(200, { id: '900000' })).mockResolvedValueOnce(res(200, [{ author: { id: '900000' }, content: input.content }]))
    expect(await createPrivateThread({ ...input, existingThreadId: '555555' }, { fetchImpl: f as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: true, threadId: '555555' })
    expect(f.mock.calls.map((c) => c[1].method)).toEqual(['PUT', 'PUT', 'GET', 'GET'])
  })
  it('does not post when it cannot confirm the thread is empty', async () => {
    clearBotIdCache()
    const f = vi.fn().mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(204)).mockResolvedValue(res(500))
    expect(await createPrivateThread({ ...input, existingThreadId: '555555' }, { fetchImpl: f as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'verify_failed', threadId: '555555', uncertain: true })
    expect(f.mock.calls.every((c) => c[1].method !== 'POST')).toBe(true)
  })
  it('a timeout or 5xx on the final post is uncertain and keeps the thread id; a 4xx is definite', async () => {
    const f5 = vi.fn().mockResolvedValueOnce(res(200, { id: '555555' })).mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(502))
    expect(await createPrivateThread(input, { fetchImpl: f5 as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'post_http_502', threadId: '555555', uncertain: true })
    const err = Object.assign(new Error('t'), { name: 'TimeoutError' })
    const ft = vi.fn().mockResolvedValueOnce(res(200, { id: '555555' })).mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(204)).mockRejectedValueOnce(err)
    expect(await createPrivateThread(input, { fetchImpl: ft as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'timeout', threadId: '555555', uncertain: true })
    const f4 = vi.fn().mockResolvedValueOnce(res(200, { id: '555555' })).mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(403))
    expect(await createPrivateThread(input, { fetchImpl: f4 as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'post_http_403', threadId: '555555' })
  })
  it('returns the thread id from the catch when an earlier step times out', async () => {
    const err = Object.assign(new Error('t'), { name: 'TimeoutError' })
    const f = vi.fn().mockResolvedValueOnce(res(200, { id: '555555' })).mockRejectedValueOnce(err)
    expect(await createPrivateThread(input, { fetchImpl: f as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'timeout', threadId: '555555' })
  })

  it('a timeout or 5xx while creating the thread is uncertain (no thread id): no blind second thread', async () => {
    const err = Object.assign(new Error('t'), { name: 'TimeoutError' })
    const ft = vi.fn().mockRejectedValueOnce(err)
    expect(await createPrivateThread(input, { fetchImpl: ft as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'timeout', uncertain: true })
    const f5 = vi.fn().mockResolvedValueOnce(res(503))
    expect(await createPrivateThread(input, { fetchImpl: f5 as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'thread_create_http_503', uncertain: true })
    // a definite refusal stays retryable
    const f4 = vi.fn().mockResolvedValueOnce(res(403))
    expect(await createPrivateThread(input, { fetchImpl: f4 as unknown as typeof fetch, botToken: 't' })).toEqual({ ok: false, reason: 'thread_create_http_403' })
  })
})
