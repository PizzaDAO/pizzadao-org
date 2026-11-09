// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

const h = vi.hoisted(() => {
  const pfpRestyle = {
    create: vi.fn(async () => ({ id: 7 })),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
    count: vi.fn(async () => 0),
    aggregate: vi.fn(async () => ({ _sum: { costCents: 0 } })),
    groupBy: vi.fn(async () => []),
  }
  const order: string[] = []
  const executeRaw = vi.fn(async (...a: unknown[]) => {
    order.push('lock:' + ((a[0] as TemplateStringsArray).join('?') + a.slice(1).join(',')).match(/budget|member/)?.[0])
    return 1
  })
  return {
    pfpRestyle,
    order,
    executeRaw,
    put: vi.fn(async (key: string) => ({ url: `https://s.public.blob.vercel-storage.com/${key}` })),
    settingValues: {} as Record<string, unknown>,
    toggles: {} as Record<string, boolean>,
  }
})
const { pfpRestyle, put, settingValues, toggles, order, executeRaw } = h

vi.mock('@/app/lib/db', () => ({
  prisma: {
    pfpRestyle: h.pfpRestyle,
    // A transaction runs the callback against the same mocks; locks are recorded in order.
    $transaction: async (fn: (tx: unknown) => unknown) => {
      h.order.push('tx:begin')
      const r = await fn({ pfpRestyle: h.pfpRestyle, $executeRaw: h.executeRaw })
      h.order.push('tx:commit')
      return r
    },
  },
}))
vi.mock('@vercel/blob', () => ({ put: (...a: [string]) => h.put(...a), del: vi.fn(), list: vi.fn(async () => ({ blobs: [] })) }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => h.settingValues[k]) }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn(async (k: string) => h.toggles[k] ?? false) }))
vi.mock('./catalog', () => ({ listAssets: vi.fn() }))
vi.mock('./context', () => ({ loadUnlockContext: vi.fn() }))
vi.mock('./upload-base', () => ({ pruneBaseUploads: vi.fn(async () => undefined) }))

import { listAssets, type AssetRecord } from './catalog'
import { loadUnlockContext } from './context'
import {
  evaluateAllowance, isRefusal, openAiEdit, restyleForMember, FRIENDLY_REFUSAL, buildPrompt, loadUsage,
  RestyleCharged, RestyleRefused, type RestyleSettings,
} from './restyle'

const outfit = (id: number, minLevel: number, over: Partial<AssetRecord> = {}): AssetRecord => ({
  id, slug: `o${id}`, name: `Suit ${id}`, kind: 'outfit', imageUrl: 'https://s.public.blob.vercel-storage.com/o.png', thumbUrl: null,
  defaultTransform: null, lockedHint: null, isActive: true, sortOrder: id, rules: [{ kind: 'level', params: { minLevel } }], ...over,
})
const ctx = (level: number) => ({ level, roleIds: new Set<string>(), approvedMissionIds: new Set<number>(), itemIds: new Set<number>(), grantIds: new Set<number>() })

const S: RestyleSettings = { enabled: true, perUnlock: 2, dailyLimit: 3, monthlyBudgetUsd: 50, costCents: 20, refusalDailyLimit: 3 }
const U = { forOutfit: 0, today: 0, refusalsToday: 0, monthSpentCents: 0 }

let png: Buffer
beforeEach(async () => {
  vi.clearAllMocks()
  order.length = 0
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c00' } }).png().toBuffer()
  Object.assign(settingValues, {
    'pfp.restylePerUnlock': 2, 'pfp.restyleDailyLimit': 3, 'pfp.restyleMonthlyBudgetUsd': 50,
    'pfp.restyleCostCents': 20, 'pfp.restyleRefusalDailyLimit': 3,
  })
  toggles['pfp.restyleEnabled'] = true
  vi.mocked(listAssets).mockResolvedValue([outfit(1, 2), outfit(2, 5)])
  vi.mocked(loadUnlockContext).mockResolvedValue(ctx(3))
  pfpRestyle.count.mockResolvedValue(0)
  pfpRestyle.aggregate.mockResolvedValue({ _sum: { costCents: 0 } })
})

const fetchImpl = () => vi.fn(async () => new Response(new Uint8Array(png), { status: 200 }))
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
    expect(evaluateAllowance(S, { ...U, forOutfit: 1, today: 2 })).toEqual({ ok: true, outfitRemaining: 1, dailyRemaining: 1 })
  })
  it('refuses when disabled, per outfit, per day, over budget and after too many refusals', () => {
    expect(evaluateAllowance({ ...S, enabled: false }, U)).toMatchObject({ ok: false, code: 'disabled', status: 403 })
    expect(evaluateAllowance(S, { ...U, forOutfit: 2 })).toMatchObject({ ok: false, code: 'per_outfit', status: 429 })
    expect(evaluateAllowance(S, { ...U, today: 3 })).toMatchObject({ ok: false, code: 'daily' })
    expect(evaluateAllowance(S, { ...U, monthSpentCents: 4990 })).toMatchObject({ ok: false, code: 'budget' })
    expect(evaluateAllowance(S, { ...U, monthSpentCents: 4980 }).ok).toBe(true) // exactly at the budget is allowed
    expect(evaluateAllowance(S, { ...U, refusalsToday: 3 })).toMatchObject({ ok: false, code: 'refusals', status: 429 })
    expect(evaluateAllowance(S, { ...U, refusalsToday: 2 }).ok).toBe(true)
  })
})

describe('loadUsage: which rows count', () => {
  it('per-outfit counts only pending and ok; the daily count adds failed tries; refusals are separate', async () => {
    await loadUsage('42', 1)
    const wheres = pfpRestyle.count.mock.calls.map((c) => (c as unknown as [{ where: Record<string, unknown> }])[0].where)
    expect(wheres[0]).toMatchObject({ outfitId: 1, status: { in: ['pending', 'ok'] } })
    expect(wheres[1]).toMatchObject({ status: { in: ['pending', 'ok', 'error'] } })
    expect(wheres[2]).toMatchObject({ status: 'refused' })
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

  it('enforces per-outfit, daily, refusal and budget limits with 429 and no generation', async () => {
    const generate = vi.fn()
    const fetchSpy = fetchImpl()
    pfpRestyle.count.mockImplementation((async (a: { where: { outfitId?: number } }) => (a.where.outfitId ? 2 : 0)) as never)
    await expect(run({ generate, fetchImpl: fetchSpy })).rejects.toMatchObject({ statusCode: 429, code: 'PER_OUTFIT' })
    pfpRestyle.count.mockImplementation((async (a: { where: { status: unknown } }) => (a.where.status === 'refused' ? 3 : 0)) as never)
    await expect(run({ generate, fetchImpl: fetchSpy })).rejects.toMatchObject({ statusCode: 429, code: 'REFUSALS' })
    pfpRestyle.count.mockResolvedValue(3)
    await expect(run({ generate, fetchImpl: fetchSpy })).rejects.toMatchObject({ statusCode: 429 })
    pfpRestyle.count.mockResolvedValue(0)
    pfpRestyle.aggregate.mockResolvedValue({ _sum: { costCents: 5000 } })
    await expect(run({ generate, fetchImpl: fetchSpy })).rejects.toMatchObject({ statusCode: 429, code: 'BUDGET' })
    expect(generate).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled() // nothing fetched once a limit refuses
    expect(pfpRestyle.create).not.toHaveBeenCalled()
  })

  it('checks limits and inserts the pending row inside one transaction under advisory locks, before any fetch or generation', async () => {
    const fetchSpy = fetchImpl().mockImplementation((async () => {
      order.push('fetch')
      return new Response(new Uint8Array(png), { status: 200 })
    }) as never)
    const generate = vi.fn(async () => {
      order.push('generate')
      return png
    })
    pfpRestyle.create.mockImplementation((async () => {
      order.push('insert-pending')
      return { id: 7 }
    }) as never)
    await run({ fetchImpl: fetchSpy, generate })
    expect(order.slice(0, 5)).toEqual(['tx:begin', 'lock:budget', 'lock:member', 'insert-pending', 'tx:commit'])
    expect(order.indexOf('tx:commit')).toBeLessThan(order.indexOf('fetch'))
    expect(order.indexOf('tx:commit')).toBeLessThan(order.indexOf('generate'))
    expect(executeRaw).toHaveBeenCalledTimes(2)
    expect(pfpRestyle.updateMany).toHaveBeenCalled() // stale pending sweep
  })

  it('refuses to start from an existing dress-up', async () => {
    await expect(run({ base: { kind: 'restyle', url: 'x' } })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses an upload base that is a dress-up result (no chaining through upload)', async () => {
    await expect(run({ base: { kind: 'upload', url: 'https://s.public.blob.vercel-storage.com/pfp-base/42/restyle-abc.png' } })).rejects.toThrow(/Upload not found/)
    expect(pfpRestyle.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: 'error', costCents: 0 } })
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
    const generate = vi.fn(async () => { throw new RestyleRefused('safety system') })
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 422, message: FRIENDLY_REFUSAL })
    expect(put).not.toHaveBeenCalled()
    expect(pfpRestyle.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: 'refused', costCents: 0 } })
  })

  it('a plain failure is not stored and is refunded', async () => {
    const generate = vi.fn(async () => { throw new Error('boom') })
    await expect(run({ generate })).rejects.toThrow('boom')
    expect(put).not.toHaveBeenCalled()
    expect(pfpRestyle.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: 'error', costCents: 0 } })
  })

  it('a billed-but-unusable call (timeout, empty 200) keeps its cost', async () => {
    const generate = vi.fn(async () => { throw new RestyleCharged() })
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 502 })
    expect(pfpRestyle.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: 'error' } }) // no costCents: stays booked
    expect(put).not.toHaveBeenCalled()
  })

  it('garbage output from a 200 is not stored and keeps its cost', async () => {
    const generate = vi.fn(async () => Buffer.from('not an image at all'))
    await expect(run({ generate })).rejects.toMatchObject({ statusCode: 502 })
    expect(put).not.toHaveBeenCalled()
    expect(pfpRestyle.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: 'error' } })
  })
})

describe('OpenAI edit call', () => {
  it('detects refusals by status and error text', () => {
    expect(isRefusal(400, { error: { code: 'moderation_blocked', message: 'x' } })).toBe(true)
    expect(isRefusal(400, { error: { message: 'Your request was rejected by the safety system.' } })).toBe(true)
    expect(isRefusal(400, { error: { message: 'invalid size' } })).toBe(false)
    expect(isRefusal(500, { error: { code: 'moderation_blocked' } })).toBe(false)
  })

  it('the prompt removes captions and adds no text', () => {
    const p = buildPrompt('Dark suit')
    expect(p).toMatch(/Remove any text, names or captions/)
    expect(p).toMatch(/do not add any text/)
    expect(p).not.toMatch(/keep any existing text/i)
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

  it('a timeout and an empty 200 are billed failures; a 500 is not', async () => {
    const timeout = vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError') })
    await expect(openAiEdit(png, png, 'p', { fetchImpl: timeout as never, apiKey: 'k' })).rejects.toBeInstanceOf(RestyleCharged)
    const empty = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    await expect(openAiEdit(png, png, 'p', { fetchImpl: empty as never, apiKey: 'k' })).rejects.toBeInstanceOf(RestyleCharged)
    const five = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'oops' } }), { status: 500 }))
    const e = await openAiEdit(png, png, 'p', { fetchImpl: five as never, apiKey: 'k' }).catch((x) => x)
    expect(e).not.toBeInstanceOf(RestyleCharged)
    expect(e.statusCode).toBe(502)
  })
})
