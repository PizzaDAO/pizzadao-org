// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/discord-channels', () => ({ getGuildChannels: vi.fn(), getGuildRoles: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { clearSettingsCache } from '@/app/lib/settings'
import { getGuildChannels, getGuildRoles } from '@/app/lib/discord-channels'
import { DELETE, GET, PUT } from './route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ME = '400000000000000001'
const CHAN = '900000000000000001'
const ROLE = '900000000000000003'
const CAPO = '839206162837798945'

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
  m(getGuildChannels).mockResolvedValue([{ id: CHAN, name: 'general', type: 0 }])
  m(getGuildRoles).mockResolvedValue([{ id: ROLE, name: 'Helper' }])
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

describe('Phase 3 settings', () => {
  it('a switch is saved as a boolean; a string is a 400', async () => {
    expect((await PUT(req('PUT', { key: 'disavow.enabled', value: 'true' }))).status).toBe(400)
    const r = await PUT(req('PUT', { key: 'reengage.enabled', value: false }))
    expect(r.status).toBe(200)
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { key: 'reengage.enabled', value: false, updatedBy: ME } }))
  })

  it('turning a posting switch ON asks for confirmation first', async () => {
    const first = await PUT(req('PUT', { key: 'calls.recapPostEnabled', value: true }))
    expect(first.status).toBe(409)
    expect((await first.json()).needsConfirm).toMatch(/recap/i)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
    expect((await PUT(req('PUT', { key: 'calls.recapPostEnabled', value: true, confirm: true }))).status).toBe(200)
  })

  it('a channel that is not in our server is rejected and nothing is stored', async () => {
    const bad = await PUT(req('PUT', { key: 'discord.announceChannelId', value: '999999999999999999', confirm: true }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/not a channel in this server/)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
    const ok = await PUT(req('PUT', { key: 'discord.announceChannelId', value: CHAN, confirm: true }))
    expect(ok.status).toBe(200)
  })

  it('a role that is not in our server is rejected; when Discord cannot be asked the save is refused', async () => {
    expect((await PUT(req('PUT', { key: 'announce.roleIds', value: ['999999999999999999'], confirm: true }))).status).toBe(400)
    m(getGuildRoles).mockResolvedValue(null)
    expect((await PUT(req('PUT', { key: 'announce.roleIds', value: [ROLE], confirm: true }))).status).toBe(400)
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it('reviewer roles can be narrowed, never widened with a new role', async () => {
    m(getGuildRoles).mockResolvedValue([{ id: ROLE, name: 'Helper' }, { id: CAPO, name: 'Capo' }])
    expect((await PUT(req('PUT', { key: 'missions.reviewerRoleIds', value: [ROLE] }))).status).toBe(400)
    expect((await PUT(req('PUT', { key: 'missions.reviewerRoleIds', value: [CAPO], confirm: true }))).status).toBe(200)
  })

  it('GET shows what is in force for a switch, including an env kill', async () => {
    const saved = process.env.DISAVOW_ENABLED
    process.env.DISAVOW_ENABLED = 'false'
    try {
      const j = await (await GET(req('GET'))).json()
      const s = j.settings.find((x: { key: string }) => x.key === 'disavow.enabled')
      expect(s.toggle).toMatchObject({ env: 'DISAVOW_ENABLED', envKill: true, effective: false })
    } finally {
      if (saved === undefined) delete process.env.DISAVOW_ENABLED
      else process.env.DISAVOW_ENABLED = saved
    }
  })

  it('the voting window cannot be set shorter than the decision time (checked together)', async () => {
    const short = await PUT(req('PUT', { key: 'disavow.windowDays', value: 5 }))
    expect(short.status).toBe(400)
    expect((await short.json()).error).toMatch(/cannot be shorter/)
    const long = await PUT(req('PUT', { key: 'disavow.decisionDays', value: 20 }))
    expect(long.status).toBe(400) // 20 days is longer than the default window of 14
    // raising the window first makes a longer decision time valid
    m(prisma.appSetting.findMany).mockResolvedValue([{ key: 'disavow.windowDays', value: 40, updatedAt: new Date(), updatedBy: ME }])
    expect((await PUT(req('PUT', { key: 'disavow.decisionDays', value: 20 }))).status).toBe(200)
  })

  it('a threshold of 1 is refused', async () => {
    expect((await PUT(req('PUT', { key: 'disavow.yesThreshold', value: 1 }))).status).toBe(400)
  })

  it('announcement roles: every change needs confirmation', async () => {
    const first = await PUT(req('PUT', { key: 'announce.roleIds', value: [ROLE] }))
    expect(first.status).toBe(409)
    expect((await first.json()).needsConfirm).toMatch(/announcements/)
    expect((await PUT(req('PUT', { key: 'announce.roleIds', value: [ROLE], confirm: true }))).status).toBe(200)
  })

  it('resetting a rule re-checks the rules that depend on it', async () => {
    // decision 20 days is saved; resetting the window back to 14 would make it shorter than the decision time
    m(prisma.appSetting.findMany).mockResolvedValue([
      { key: 'disavow.decisionDays', value: 20, updatedAt: new Date(), updatedBy: ME },
      { key: 'disavow.windowDays', value: 40, updatedAt: new Date(), updatedBy: ME },
    ])
    m(prisma.appSetting.findUnique).mockResolvedValue({ key: 'disavow.windowDays', value: 40, updatedAt: new Date() })
    const r = await DELETE(req('DELETE', { key: 'disavow.windowDays' }))
    expect(r.status).toBe(400)
    expect(prisma.appSetting.delete).not.toHaveBeenCalled()
  })

  it('a switch shows what is in force as its value (env on, no row: on)', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('DISAVOW_ENABLED', 'true')
    try {
      const j = await (await GET(req('GET'))).json()
      const s = j.settings.find((x: { key: string }) => x.key === 'disavow.enabled')
      expect(s).toMatchObject({ value: true, default: false, modified: false })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
