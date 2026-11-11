// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireSession = vi.fn()
vi.mock('@/app/lib/auth-guards', () => ({ requireSession: () => requireSession() }))
const loadPrefsView = vi.fn(async () => ({ calls: 'NONE', dmClosed: false }))
const savePrefs = vi.fn(async (_id: string, b: { calls?: string }) => ({ calls: b.calls ?? 'NONE', dmClosed: false }))
vi.mock('@/app/lib/reminders/prefs', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/reminders/prefs')>()),
  loadPrefsView: (...a: []) => loadPrefsView(...a),
  savePrefs: (id: string, b: { calls?: string }) => savePrefs(id, b),
}))

import { GET, POST } from './route'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('https://app.pizzadao.org/api/reminder-prefs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.pizzadao.org', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  requireSession.mockResolvedValue({ ok: true, session: { discordId: 'u1' } })
})

describe('/api/reminder-prefs', () => {
  it('401 without a session', async () => {
    requireSession.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'no' }, { status: 401 }) })
    expect((await GET()).status).toBe(401)
    expect((await POST(post({ calls: 'COMMUNITY' }))).status).toBe(401)
    expect(savePrefs).not.toHaveBeenCalled()
  })
  it('GET returns the session member state', async () => {
    expect(await (await GET()).json()).toEqual({ calls: 'NONE', dmClosed: false })
  })
  it('POST saves for the session member only', async () => {
    const res = await POST(post({ calls: 'MY_CREWS' }))
    expect(res.status).toBe(200)
    expect(savePrefs).toHaveBeenCalledWith('u1', { calls: 'MY_CREWS' })
  })
  it('rejects values B1 does not offer, unknown fields and empty bodies', async () => {
    for (const body of [{ calls: 'SELECTED' }, { calls: 'COMMUNITY', discordId: 'u2' }, {}, { channel: 'TELEGRAM' }, 'not json']) {
      expect((await POST(post(body))).status).toBe(400)
    }
    expect(savePrefs).not.toHaveBeenCalled()
  })
  it('rejects non-JSON and cross-origin writes', async () => {
    expect((await POST(post({ calls: 'COMMUNITY' }, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(post({ calls: 'COMMUNITY' }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect(savePrefs).not.toHaveBeenCalled()
  })
})
