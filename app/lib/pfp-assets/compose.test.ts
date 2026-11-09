// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ fetchGuildMemberProfile: vi.fn(async () => null) }))
vi.mock('./catalog', () => ({ listAssets: vi.fn() }))
vi.mock('./context', () => ({ loadUnlockContext: vi.fn() }))

import { fetchImageBytes, loadBase, placeLayer, renderComposite, validateLayers, composeMemberPfp } from './compose'
import { listAssets, type AssetRecord } from './catalog'
import { loadUnlockContext } from './context'
import { prisma } from '@/app/lib/db'
import { put } from '@vercel/blob'

const A = (id: number, kind: AssetRecord['kind'], over: Partial<AssetRecord> = {}): AssetRecord => ({
  id, slug: `a${id}`, name: `A${id}`, kind, imageUrl: `https://x.public.blob.vercel-storage.com/a${id}.png`, thumbUrl: null,
  defaultTransform: null, lockedHint: null, isActive: true, sortOrder: id, rules: [], ...over,
})
const catalog = [A(1, 'background'), A(2, 'frame'), A(3, 'accessory'), A(4, 'accessory'), A(5, 'accessory'), A(6, 'accessory'), A(7, 'badge'), A(9, 'outfit'), A(10, 'outfit')]
const OVERLAY = { outfitOverlay: true }
const all = new Set(catalog.map((a) => a.id))

describe('validateLayers', () => {
  it('rejects a locked asset with 403, an unknown or inactive one the same way', () => {
    expect(() => validateLayers([{ assetId: 2 }], catalog, new Set([1]))).toThrow(/not unlocked/)
    expect(() => validateLayers([{ assetId: 99 }], catalog, all)).toThrow(/not unlocked/)
    expect(() => validateLayers([{ assetId: 2 }], [A(2, 'frame', { isActive: false })], new Set([2]))).toThrow(/not unlocked/)
    try {
      validateLayers([{ assetId: 2 }], catalog, new Set())
    } catch (e) {
      expect((e as { statusCode: number }).statusCode).toBe(403)
    }
  })

  it('enforces one background / frame / badge and up to 3 accessories', () => {
    const two = [A(1, 'background'), A(8, 'background')]
    expect(() => validateLayers([{ assetId: 1 }, { assetId: 8 }], two, new Set([1, 8]))).toThrow(/Too many background/)
    expect(() => validateLayers([3, 4, 5, 6].map((assetId) => ({ assetId })), catalog, all)).toThrow(/Too many accessory/)
    expect(validateLayers([3, 4, 5].map((assetId) => ({ assetId })), catalog, all)).toHaveLength(3)
    expect(() => validateLayers([{ assetId: 3 }, { assetId: 3 }], catalog, all)).toThrow(/only be used once/)
  })

  it('allows exactly one outfit, which is movable and sits under accessories', () => {
    expect(() => validateLayers([{ assetId: 9 }, { assetId: 10 }], catalog, all, OVERLAY)).toThrow(/Too many outfit/)
    expect(() => validateLayers([{ assetId: 9 }], catalog, all)).toThrow(/overlays are turned off/)
    const out = validateLayers([{ assetId: 3 }, { assetId: 9, x: 0.4, y: 0.9, scale: 0.8 }], catalog, all, OVERLAY)
    expect(out.map((l) => l.assetId)).toEqual([9, 3])
    expect(out[0]).toMatchObject({ x: 0.4, y: 0.9, scale: 0.8 })
    expect(() => validateLayers([{ assetId: 9 }, { assetId: 10 }], catalog, new Set([9]), OVERLAY)).toThrow(/not unlocked/)
  })

  it('rejects malformed input and returns z-order: background, outfit, accessories, frame, badge', () => {
    expect(() => validateLayers('x', catalog, all)).toThrow(/list/)
    expect(() => validateLayers([{}], catalog, all)).toThrow(/assetId/)
    const out = validateLayers([{ assetId: 7 }, { assetId: 2 }, { assetId: 3, x: 0.3 }, { assetId: 1 }], catalog, all)
    expect(out.map((l) => l.assetId)).toEqual([1, 3, 2, 7])
    expect(validateLayers([{ assetId: 7 }, { assetId: 2 }, { assetId: 3 }, { assetId: 9 }, { assetId: 1 }], catalog, all, OVERLAY).map((l) => l.assetId)).toEqual([1, 9, 3, 2, 7])
    expect(out[1].x).toBe(0.3)
    expect(out[0]).toMatchObject({ x: 0.5, y: 0.5, scale: 1, rotation: 0 }) // fixed layers ignore client transforms
  })
})

describe('fetch allowlist', () => {
  it('refuses non-allowlisted hosts before any request', async () => {
    const f = vi.fn()
    await expect(fetchImageBytes('https://evil.test/a.png', f as never)).rejects.toThrow(/not allowed/)
    await expect(fetchImageBytes('http://x.public.blob.vercel-storage.com/a.png', f as never)).rejects.toThrow(/not allowed/)
    await expect(fetchImageBytes('https://169.254.169.254/latest', f as never)).rejects.toThrow(/not allowed/)
    expect(f).not.toHaveBeenCalled()
  })

  it('upload bases must live under the member own pfp-base folder', async () => {
    const f = vi.fn()
    await expect(loadBase('42', '1', { kind: 'upload', url: 'https://x.public.blob.vercel-storage.com/pfp-base/43/a.png' }, f as never)).rejects.toThrow(/Upload not found/)
    await expect(loadBase('42', '1', { kind: 'upload', url: 'https://evil.test/pfp-base/42/a.png' }, f as never)).rejects.toThrow(/Upload not found/)
    expect(f).not.toHaveBeenCalled()
  })
})

const solid = (w: number, h: number, c: { r: number; g: number; b: number; alpha?: number }) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { alpha: 1, ...c } } }).png().toBuffer()

describe('own-store pinning', () => {
  it('refuses another Blob store once the token names ours', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_ourstore_secret')
    const f = vi.fn()
    await expect(fetchImageBytes('https://otherstore.public.blob.vercel-storage.com/a.png', f as never)).rejects.toThrow(/not allowed/)
    await expect(loadBase('42', '1', { kind: 'upload', url: 'https://otherstore.public.blob.vercel-storage.com/pfp-base/42/a.png' }, f as never)).rejects.toThrow(/Upload not found/)
    expect(f).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})

describe('fetchImageBytes streaming cap', () => {
  const png = () => solid(8, 8, { r: 1, g: 2, b: 3 })
  it('aborts a stream that exceeds the cap even without a content-length', async () => {
    let cancelled = false
    const big = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(3 * 1024 * 1024)) },
      cancel() { cancelled = true },
    })
    const f = vi.fn(async () => new Response(big, { status: 200 }))
    await expect(fetchImageBytes('https://s.public.blob.vercel-storage.com/a.png', f as never)).rejects.toThrow(/too large/)
    expect(cancelled).toBe(true)
  })
  it('reads a normal image', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array(await png()), { status: 200 }))
    expect((await fetchImageBytes('https://s.public.blob.vercel-storage.com/a.png', f as never)).length).toBeGreaterThan(8)
  })
  it('refuses images over the pixel limit', async () => {
    const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer()
    await expect(renderComposite(huge, [])).rejects.toThrow()
  })
})

describe('renderComposite', () => {
  it('produces a 1024x1024 webp with layers in z-order', async () => {
    const base = await solid(300, 200, { r: 255, g: 0, b: 0 })
    const frame = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
      .composite([{ input: await solid(900, 900, { r: 0, g: 0, b: 0 }), blend: 'dest-out', left: 62, top: 62 }]).png().toBuffer()
    const out = await renderComposite(base, [{ kind: 'frame', bytes: frame, layer: { assetId: 2, x: 0.5, y: 0.5, scale: 1, rotation: 0 } }])
    const meta = await sharp(out).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1024, 1024])
    const px = await sharp(out).ensureAlpha().raw().toBuffer()
    const at = (x: number, y: number) => [px[(y * 1024 + x) * 4], px[(y * 1024 + x) * 4 + 2]]
    expect(at(512, 512)[0]).toBeGreaterThan(200) // base red in the middle
    expect(at(5, 5)[1]).toBeGreaterThan(200) // frame blue at the border
  })

  it('places a rotated accessory that overflows the canvas without throwing', async () => {
    const acc = await solid(100, 100, { r: 0, g: 255, b: 0 })
    const p = await placeLayer(acc, { assetId: 3, x: 0.98, y: 0.02, scale: 0.4, rotation: 33 })
    expect(p).not.toBeNull()
    expect(p!.left).toBeGreaterThanOrEqual(0)
    expect(await placeLayer(acc, { assetId: 3, x: 0.5, y: 0.5, scale: 0.1, rotation: 0 })).not.toBeNull()
  })
})

describe('composeMemberPfp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('re-checks unlocks server-side and never renders or stores for a locked layer', async () => {
    vi.mocked(listAssets).mockResolvedValue([A(2, 'frame')])
    vi.mocked(loadUnlockContext).mockResolvedValue({ level: 1, roleIds: new Set(), approvedMissionIds: new Set(), itemIds: new Set(), grantIds: new Set() })
    const upsert = vi.fn()
    ;(prisma as unknown as Record<string, unknown>).memberPfp = { upsert, findUnique: vi.fn() }
    await expect(
      composeMemberPfp({ memberId: '42', discordId: '1', base: { kind: 'static' }, layers: [{ assetId: 2 }] }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(put).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('unlocked layers: composes, stores a hashed key, upserts MemberPfp', async () => {
    const frameArt = await solid(1024, 1024, { r: 0, g: 0, b: 255, alpha: 0.5 })
    const baseArt = await solid(64, 64, { r: 255, g: 0, b: 0 })
    vi.mocked(listAssets).mockResolvedValue([A(2, 'frame')])
    vi.mocked(loadUnlockContext).mockResolvedValue({ level: 5, roleIds: new Set(), approvedMissionIds: new Set(), itemIds: new Set(), grantIds: new Set([2]) })
    const upsert = vi.fn()
    ;(prisma as unknown as Record<string, unknown>).memberPfp = { upsert, findUnique: vi.fn(async () => null) }
    vi.mocked(put).mockImplementation((async (key: string) => ({ url: `https://s.public.blob.vercel-storage.com/${key}` })) as never)
    const fetchImpl = vi.fn(async (url: string) => {
      const body = url.includes('pfp-base') ? baseArt : frameArt
      return new Response(new Uint8Array(body), { status: 200 })
    })
    const res = await composeMemberPfp({
      memberId: '42', discordId: '1', fetchImpl: fetchImpl as never,
      base: { kind: 'upload', url: 'https://s.public.blob.vercel-storage.com/pfp-base/42/me.png' },
      layers: [{ assetId: 2 }],
    })
    expect(res.composedUrl).toMatch(/pfp-composed\/42-[0-9a-f]{16}\.webp$/)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0].where).toEqual({ memberId: '42' })
  })

  describe('dress-up bases and undo', () => {
    const setup = async () => {
      const art = await solid(64, 64, { r: 9, g: 9, b: 9 })
      vi.mocked(listAssets).mockResolvedValue([])
      vi.mocked(loadUnlockContext).mockResolvedValue({ level: 1, roleIds: new Set(), approvedMissionIds: new Set(), itemIds: new Set(), grantIds: new Set() })
      const upsert = vi.fn()
      ;(prisma as unknown as Record<string, unknown>).memberPfp = { upsert, findUnique: vi.fn(async () => null) }
      vi.mocked(put).mockImplementation((async (key: string) => ({ url: `https://s.public.blob.vercel-storage.com/${key}` })) as never)
      const fetchImpl = vi.fn(async () => new Response(new Uint8Array(art), { status: 200 }))
      return { upsert, fetchImpl }
    }
    const U = 'https://s.public.blob.vercel-storage.com/pfp-base/42'

    it('saving a restyle base keeps the original so it can be undone', async () => {
      const { upsert, fetchImpl } = await setup()
      await composeMemberPfp({
        memberId: '42', discordId: '1', fetchImpl: fetchImpl as never, layers: [],
        base: { kind: 'restyle', url: `${U}/restyle-abc.png` }, original: { kind: 'upload', url: `${U}/me.png` },
      })
      expect(upsert.mock.calls[0][0].create).toMatchObject({ baseKind: 'restyle', baseUrl: `${U}/restyle-abc.png`, originalBaseKind: 'upload', originalBaseUrl: `${U}/me.png` })
    })

    it('undo: composing the original base clears the stored original', async () => {
      const { upsert, fetchImpl } = await setup()
      await composeMemberPfp({ memberId: '42', discordId: '1', fetchImpl: fetchImpl as never, layers: [], base: { kind: 'upload', url: `${U}/me.png` } })
      expect(upsert.mock.calls[0][0].update).toMatchObject({ baseKind: 'upload', originalBaseKind: null, originalBaseUrl: null })
    })

    it('a restyle base needs an original, and must be a server-written restyle file of this member', async () => {
      const { upsert, fetchImpl } = await setup()
      const base = { memberId: '42', discordId: '1', fetchImpl: fetchImpl as never, layers: [] }
      await expect(composeMemberPfp({ ...base, base: { kind: 'restyle', url: `${U}/restyle-abc.png` } })).rejects.toThrow(/original/)
      await expect(composeMemberPfp({ ...base, original: { kind: 'static' }, base: { kind: 'restyle', url: `${U}/me.png` } })).rejects.toThrow(/Upload not found/)
      await expect(composeMemberPfp({ ...base, original: { kind: 'static' }, base: { kind: 'restyle', url: 'https://s.public.blob.vercel-storage.com/pfp-base/43/restyle-abc.png' } })).rejects.toThrow(/Upload not found/)
      expect(upsert).not.toHaveBeenCalled()
    })
  })
})
