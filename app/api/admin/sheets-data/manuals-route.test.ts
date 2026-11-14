// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdmin = vi.fn()
vi.mock('@/app/lib/auth-guards', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/app/lib/db', () => ({ prisma: { manual: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() }, $transaction: vi.fn() } }))
vi.mock('@/app/api/lib/google-sheets', () => ({ getManualLinks: vi.fn(async () => ({})) }))

import { prisma } from '@/app/lib/db'
import { PUT } from './[dataset]/route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const put = (rows: unknown) =>
  PUT(
    new Request('https://app.example/api/admin/sheets-data/manuals', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }) }),
    { params: Promise.resolve({ dataset: 'manuals' }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  m(prisma.manual.findMany).mockResolvedValue([])
  m(prisma.manual.upsert).mockImplementation((a: unknown) => a)
  m(prisma.$transaction).mockResolvedValue([])
})

describe('manuals editor route', () => {
  it('rejects a non-admin before touching the database', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: new Response('{}', { status: 403 }) })
    const res = await put([{ title: 'A' }])
    expect(res.status).toBe(403)
    expect(prisma.manual.upsert).not.toHaveBeenCalled()
  })
  it('rejects a bad reviewed date and an external replacement link with 400', async () => {
    requireAdmin.mockResolvedValue({ ok: true, session: { discordId: '1' } })
    expect((await put([{ title: 'A', reviewedAt: 'soon' }])).status).toBe(400)
    expect((await put([{ title: 'A', supersededBy: 'https://evil.example' }])).status).toBe(400)
    expect(prisma.manual.upsert).not.toHaveBeenCalled()
  })
  it('an admin saves the markers', async () => {
    requireAdmin.mockResolvedValue({ ok: true, session: { discordId: '1' } })
    const res = await put([{ title: 'A', reviewedAt: '2026-11-14', supersededBy: '/handbook/host-a-party' }])
    expect(res.status).toBe(200)
    const arg = m(prisma.manual.upsert).mock.calls[0][0]
    expect(arg.create.reviewedAt).toEqual(new Date('2026-11-14T00:00:00.000Z'))
    expect(arg.create.supersededBy).toBe('/handbook/host-a-party')
  })
})
