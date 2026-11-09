// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

const { pfpRestyle, put, settingValues, toggles } = vi.hoisted(() => ({
  settingValues: {} as Record<string, unknown>,
  toggles: {} as Record<string, boolean>,
  put: vi.fn(async (key: string) => ({ url: `https://s.public.blob.vercel-storage.com/${key}` })),
  pfpRestyle: {
  create: vi.fn(async () => ({ id: 7 })),
  update: vi.fn(async () => ({})),
  count: vi.fn(async () => 0),
  aggregate: vi.fn(async () => ({ _sum: { costCents: 0 } })),
  groupBy: vi.fn(async () => []),
  },
}))
vi.mock('@/app/lib/db', () => ({ prisma: { pfpRestyle } }))
vi.mock('@vercel/blob', () => ({ put: (...a: [string]) => put(...a), del: vi.fn(), list: vi.fn(async () => ({ blobs: [] })) }))

vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => settingValues[k]) }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn(async (k: string) => toggles[k] ?? false) }))
vi.mock('./catalog', () => ({ listAssets: vi.fn() }))
vi.mock('./context', () => ({ loadUnlockContext: vi.fn() }))
vi.mock('./upload-base', () => ({ pruneBaseUploads: vi.fn(async () => undefined) }))

import { listAssets, type AssetRecord } from './catalog'
import { loadUnlockContext } from './context'
import { evaluateAllowance, isRefusal, openAiEdit, restyleForMember, FRIENDLY_REFUSAL, buildPrompt, type RestyleSettings } from './restyle'

const outfit = (id: number, minLevel: number, over: Partial<AssetRecord> = {}): AssetRecord => ({
  id, slug: `o${id}`, name: `Suit ${id}`, kind: 'outfit', imageUrl: 'https://s.public.blob.vercel-storage.com/o.png', thumbUrl: null,
  defaultTransform: null, lockedHint: null, isActive: true, sortOrder: id, rules: [{ kind: 'level', params: { minLevel } }], ...over,
})
const ctx = (level: number) => ({ level, roleIds: new Set<string>(), approvedMissionIds: new Set<number>(), itemIds: new Set<number>(), grantIds: new Set<number>() })

const S: RestyleSettings = { enabled: true, perUnlock: 2, dailyLimit: 3, monthlyBudgetUsd: 50, costCents: 20 }

let png: Buffer
let upload: Buffer
beforeEach(async () => {
  vi.clearAllMocks()
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c00' } }).png().toBuffer()
  upload = png
  Object.assign(settingValues, { 'pfp.restylePerUnlock': 2, 'pfp.restyleDailyLimit': 3, 'pfp.restyleMonthlyBudgetUsd': 50, 'pfp.restyleCostCents': 20 })
  toggles['pfp.restyleEnabled'] = true
  vi.mocked(listAssets).mockResolvedValue([outfit(1, 2), outfit(2, 5)])
  vi.mocked(loadUnlockContext).mockResolvedValue(ctx(3))
  pfpRestyle.count.mockResolvedValue(0)
  pfpRestyle.aggregate.mockResolvedValue({ _sum: { costCents: 0 } })
})

const fetchImpl = () => vi.fn(async () => new Response(new Uint8Array(upload), { status: 200 }))
const run = (over: Record<string, unknown> = {}) =>
  restyleForMember({
    memberId: '42', discordId: '1', outfitId: 1,
    base: { kind: 'upload', url: 'https://s.public.blob.vercel-storage.com/pfp-base/42/me.png' },
    fetchImpl: fetchImpl() as never,
    generate: vi.fn(async () => png) as never,
    ...over,
  } as never)

describe('evaluateAllowance (limits and budget)', () => {
  it('allows within every limit and reports what is left', () => {
    expect(evaluateAllowance(S, { forOutfit: 1, today: 2, monthSpentCents: 0 })).toEqual({ ok: true, outfitRemaining: 1, dailyRemaining: 1 })
  })
  it('refuses when disabled, per outfit, per day and over budget', () => {
    expect(evaluateAllowance({ ...S, enabled: false }, { forOutfit: 0, today: 0, monthSpentCents: 0 })).toMatchObject({ ok: false, code: 'disabled', status: 403 })
    expect(evaluateAllowance(S, { forOutfit: 2, today: 0, monthSpentCents: 0 })).toMatchObject({ ok: false, code: 'per_outfit', status: 429 })
    expect(evaluateAllowance(S, { forOutfit: 0, today: 3, monthSpentCents: 0 })).toMatchObject({ ok: false, code: 'daily' })
    expect(evaluateAllowance(S, { forOutfit: 0, today: 0, monthSpentCents: 4990 })).toMatchObject({ ok: false, code: 'budget' })
    expect(evaluateAllowance(S, { forOutfit: 0, today: 0, monthSpentCents: 4980 }).ok).toBe(true) // exactly at the budget is allowed
  })
})

describe('restyleForMember', () => {
  it('refuses a locked outfit (403) before spending anything', async () => {
    const generate = vi.fn()
    await expect(run({ outfitId: 2, generate })).rejects.toMatchObject({ statusCode: 403 })
    expect(generate).not.toHaveBeenCalled()
    expect(pfpRestyle.create).not.toHaveBeenCalled()
  })

  it('refuses unknown, inactive and non-outfit assets the same way', async () => {
    vi.mocked(listAssets).mockResolvedValue([outfit(1, 2, { isActive: false }), outfit(3, 1, { kind: 'frame' })])
    await expect(run({ outfitId: 1 })).rejects.toMatchObject({ statusCode: 403 })
    await expect(run({ outfitId: 3 })).rejects.toMatchObject({ statusCode: 403 })
    await expect(run({ outfitId: 99 })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('is off by default (kill switch) and never calls the image service', async () => {
    toggles['pfp.restyleEnabled'] = false
    const generate = vi.fn()
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 403 })
    expect(generate).not.toHaveBeenCalled()
  })

  it('enforces per-outfit, daily and budget limits with 429 and no generation', async () => {
    const generate = vi.fn()
    pfpRestyle.count.mockImplementation((async (a: { where: { outfitId?: number } }) => (a.where.outfitId ? 2 : 0)) as never)
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 429, code: 'PER_OUTFIT' })
    pfpRestyle.count.mockResolvedValue(3)
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 429 })
    pfpRestyle.count.mockResolvedValue(0)
    pfpRestyle.aggregate.mockResolvedValue({ _sum: { costCents: 5000 } })
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 429, code: 'BUDGET' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('refuses to start from an existing dress-up', async () => {
    await expect(run({ base: { kind: 'restyle', url: 'x' } })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('success: logs the generation, stores the result under the member restyle path', async () => {
    const generate = vi.fn(async () => png)
    const res = await run({ generate })
    expect(res.url).toMatch(/pfp-base\/42\/restyle-[0-9a-f]{16}\.png$/)
    expect(res.outfitRemaining).toBe(1)
    expect(res.dailyRemaining).toBe(2)
    expect(pfpRestyle.create).toHaveBeenCalledWith({ data: expect.objectContaining({ memberId: '42', outfitId: 1, costCents: 20, status: 'pending' }) })
    expect(pfpRestyle.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: expect.objectContaining({ status: 'ok', resultUrl: res.url }) })
    expect(generate).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.stringContaining('Redraw this exact character'), expect.anything())
  })

  it('a refused result is never stored, costs nothing and shows a friendly message', async () => {
    const { RestyleRefused } = await import('./restyle')
    const generate = vi.fn(async () => { throw new RestyleRefused('safety system') })
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 422, message: FRIENDLY_REFUSAL })
    expect(put).not.toHaveBeenCalled()
    expect(pfpRestyle.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: 'refused', costCents: 0 } })
  })

  it('a failed generation is not stored and is refunded', async () => {
    const generate = vi.fn(async () => { throw new Error('boom') })
    await expect(run({ generate })).rejects.toThrow('boom')
    expect(put).not.toHaveBeenCalled()
    expect(pfpRestyle.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: 'error', costCents: 0 } })
  })

  it('garbage output is not stored', async () => {
    const generate = vi.fn(async () => Buffer.from('not an image at all'))
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 502 })
    expect(put).not.toHaveBeenCalled()
  })
})

describe('OpenAI edit call', () => {
  it('detects refusals by status and error text', () => {
    expect(isRefusal(400, { error: { code: 'moderation_blocked', message: 'x' } })).toBe(true)
    expect(isRefusal(400, { error: { message: 'Your request was rejected by the safety system.' } })).toBe(true)
    expect(isRefusal(400, { error: { message: 'invalid size' } })).toBe(false)
    expect(isRefusal(500, { error: { code: 'moderation_blocked' } })).toBe(false)
  })

  it('falls back from gpt-image-1 to gpt-image-1.5 and sends both references', async () => {
    const seen: string[] = []
    const f = vi.fn(async (_u: string, init: { body: FormData }) => {
      seen.push(String(init.body.get('model')))
      expect(init.body.getAll('image[]')).toHaveLength(2)
      if (seen.length === 1) return new Response(JSON.stringify({ error: { message: "The model 'gpt-image-1' does not exist." } }), { status: 400 })
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
    })
    const out = await openAiEdit(png, png, buildPrompt('Dark suit'), { fetchImpl: f as never, apiKey: 'k' })
    expect(seen).toEqual(['gpt-image-1', 'gpt-image-1.5'])
    expect(out.length).toBeGreaterThan(10)
  })
})
