// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { clearSettingsCache } from '@/app/lib/settings'
import { DELETE, GET, PUT } from './route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ME = '400000000000000001'

function req(method: string, body?: unknown, headers: Record<string, string> = {}, url = 'https://app.test/api/admin/settings') {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearSettingsCache({ all: true })
  m(getSession).mockResolvedValue({ discordId: ME })
  m(isDreadPizzaRoberts).mockResolvedValue(true)
  m(prisma.appSetting.findMany).mockResolvedValue([])
  m(prisma.appSetting.findUnique).mockResolvedValue(null)
  m(prisma.appSetting.upsert).mockResolvedValue({ updatedAt: new Date('2026-10-30T00:00:00Z') })
  m(prisma.appSettingChange.findMany).mockResolvedValue([])
})

describe('/api/admin/settings auth', () => {
  it('401 without a session on every method', async () => {
    m(getSession).mockResolvedValue(null)
    for (const r of [await GET(req('GET')), await PUT(req('PUT', {})), await DELETE(req('DELETE', {}))]) {
      expect(r.status).toBe(401)
      expect(r.headers.get('cache-control')).toContain('no-store')
    }
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it('403 for anyone who is not Dread Pizza Roberts, and never writes', async () => {
    m(isDreadPizzaRoberts).mockResolvedValue(false)
    for (const r of [
      await GET(req('GET')),
      await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: 7 })),
      await DELETE(req('DELETE', { key: 'calls.transcriptMinLevel' })),
    ]) expect(r.status).toBe(403)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
    expect(prisma.appSetting.delete).not.toHaveBeenCalled()
    expect(isDreadPizzaRoberts).toHaveBeenCalledWith(ME)
  })

  it('writes are rejected unless JSON and same-origin', async () => {
    const form = await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: 7 }, { 'content-type': 'text/plain' }))
    expect(form.status).toBe(415)
    const cross = await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: 7 }, { origin: 'https://evil.test' }))
    expect(cross.status).toBe(403)
    const same = await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: 7 }, { origin: 'https://app.test' }))
    expect(same.status).toBe(200)
  })
})

describe('GET', () => {
  it('lists the settings with defaults, no-store, and flags non-production deploys', async () => {
    const r = await GET(req('GET'))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    const j = await r.json()
    const s = j.settings.find((x: { key: string }) => x.key === 'calls.transcriptMinLevel')
    expect(s).toMatchObject({ default: 6, value: 6, modified: false, invalid: false })
    expect(typeof j.nonProduction).toBe('boolean')
  })

  it('flags an invalid stored value and shows the fallback', async () => {
    m(prisma.appSetting.findMany).mockResolvedValue([{ key: 'missions.dprOnlyMinLevel', value: 9, updatedAt: new Date(), updatedBy: ME }])
    const j = await (await GET(req('GET'))).json()
    expect(j.settings.find((x: { key: string }) => x.key === 'missions.dprOnlyMinLevel')).toMatchObject({ invalid: true, modified: true, value: 1 })
  })

  it('history for an unknown key is a 400', async () => {
    const r = await GET(req('GET', undefined, {}, 'https://app.test/api/admin/settings?history=nope'))
    expect(r.status).toBe(400)
  })
})

describe('PUT', () => {
  it('saves a valid value and writes the setting and the audit row in one transaction', async () => {
    const r = await PUT(req('PUT', { key: 'missions.maxAttempts', value: 4, note: 'why' }))
    expect(r.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { key: 'missions.maxAttempts', value: 4, updatedBy: ME } }))
    expect(prisma.appSettingChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'missions.maxAttempts', newValue: 4, changedBy: ME, note: 'why' }),
    })
  })

  it('400 for unknown keys and out-of-range or wrong-typed values', async () => {
    expect((await PUT(req('PUT', { key: 'nope', value: 1 }))).status).toBe(400)
    expect((await PUT(req('PUT', { key: 'constructor', value: 1 }))).status).toBe(400)
    expect((await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: 0 }))).status).toBe(400)
    expect((await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: 10 }))).status).toBe(400)
    expect((await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: '7' }))).status).toBe(400)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it('refuses to loosen approval authority: that needs a code change', async () => {
    for (const body of [
      { key: 'missions.dprOnlyMinLevel', value: 9 },
      { key: 'missions.humanReleaseMinLevel', value: 7 },
      { key: 'missions.newAccountDays', value: 7 },
    ]) expect((await PUT(req('PUT', body))).status).toBe(400)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
    // Tightening is allowed.
    expect((await PUT(req('PUT', { key: 'missions.dprOnlyMinLevel', value: 6, confirm: true }))).status).toBe(200)
  })

  it('409 until confirmed when the change exposes content to more people', async () => {
    const first = await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: 3 }))
    expect(first.status).toBe(409)
    expect((await first.json()).needsConfirm).toMatch(/transcripts/i)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
    const second = await PUT(req('PUT', { key: 'calls.transcriptMinLevel', value: 3, confirm: true }))
    expect(second.status).toBe(200)
  })

  it('409 when the value changed since the page was loaded', async () => {
    m(prisma.appSetting.findUnique).mockResolvedValue({ key: 'missions.maxAttempts', value: 5, updatedAt: new Date('2026-10-30T01:00:00Z') })
    const r = await PUT(req('PUT', { key: 'missions.maxAttempts', value: 4, expectedUpdatedAt: '2026-10-30T00:00:00.000Z' }))
    expect(r.status).toBe(409)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })
})

describe('DELETE', () => {
  it('removes the override and audits it as a reset to default', async () => {
    m(prisma.appSetting.findUnique).mockResolvedValue({ key: 'missions.maxAttempts', value: 5, updatedAt: new Date() })
    const r = await DELETE(req('DELETE', { key: 'missions.maxAttempts' }))
    expect(r.status).toBe(200)
    expect(prisma.appSetting.delete).toHaveBeenCalledWith({ where: { key: 'missions.maxAttempts' } })
    expect(prisma.appSettingChange.create).toHaveBeenCalledWith({ data: expect.objectContaining({ key: 'missions.maxAttempts', changedBy: ME }) })
  })

  it('resetting a stricter-only setting back toward its looser default needs confirmation', async () => {
    m(prisma.appSetting.findMany).mockResolvedValue([{ key: 'missions.dprOnlyMinLevel', value: 6, updatedAt: new Date(), updatedBy: ME }])
    m(prisma.appSetting.findUnique).mockResolvedValue({ key: 'missions.dprOnlyMinLevel', value: 6, updatedAt: new Date() })
    const ask = await DELETE(req('DELETE', { key: 'missions.dprOnlyMinLevel' }))
    expect(ask.status).toBe(409)
    expect((await ask.json()).needsConfirm).toMatch(/loosens/)
    expect(prisma.appSetting.delete).not.toHaveBeenCalled()
    expect((await DELETE(req('DELETE', { key: 'missions.dprOnlyMinLevel', confirm: true }))).status).toBe(200)
  })

  it('moving a stricter-only setting back toward the default needs confirmation on PUT too', async () => {
    m(prisma.appSetting.findMany).mockResolvedValue([{ key: 'missions.newAccountDays', value: 90, updatedAt: new Date(), updatedBy: ME }])
    expect((await PUT(req('PUT', { key: 'missions.newAccountDays', value: 45 }))).status).toBe(409)
    expect((await PUT(req('PUT', { key: 'missions.newAccountDays', value: 120 }))).status).toBe(200)
  })

  it('an unknown key is a 400; resetting a setting with no override writes nothing', async () => {
    expect((await DELETE(req('DELETE', { key: 'nope' }))).status).toBe(400)
    const r = await DELETE(req('DELETE', { key: 'missions.maxAttempts' }))
    expect((await r.json()).removed).toBe(false)
    expect(prisma.appSettingChange.create).not.toHaveBeenCalled()
  })
})
