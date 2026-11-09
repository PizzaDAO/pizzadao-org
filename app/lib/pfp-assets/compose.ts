// Composing a member PFP: server-side layer validation (unlock re-check), base resolution from
// allowlisted hosts only, sharp compositing at 1024x1024, upload to Vercel Blob, MemberPfp upsert.
import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import sharp from 'sharp'
import { put, del } from '@vercel/blob'
import { prisma } from '@/app/lib/db'
import { ForbiddenError, ValidationError } from '@/app/lib/errors/api-errors'
import { fetchGuildMemberProfile } from '@/app/lib/discord'
import { resolvePfpUrl } from '@/app/lib/pfp'
import { sniffImageType } from '@/app/lib/image-sniff'
import { isOwnBlobUrl } from '@/app/lib/blob-url'
import { isAllowedFetchUrl, isDiscordCdnUrl } from './hosts'
import { listAssets, type AssetRecord } from './catalog'
import { loadUnlockContext } from './context'
import { unlockedAssetIds, type UnlockContext } from './unlocks'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import {
  CANVAS_SIZE,
  KIND_LIMITS,
  KIND_ORDER,
  isTransformable,
  cleanTransform,
  type AssetKind,
  type Layer,
} from './types'

export const BASE_KINDS = ['static', 'discord', 'upload', 'mafia', 'restyle'] as const
export type BaseKind = (typeof BASE_KINDS)[number]
export const MAX_LAYERS = 7
const MAX_FETCH_BYTES = 8 * 1024 * 1024
/** Decoded-pixel ceiling for every sharp() call on this path (4096 x 4096). */
export const MAX_PIXELS = 4096 * 4096
const S = (input: Buffer) => sharp(input, { limitInputPixels: MAX_PIXELS })

/** Dress-up results are written by the server as restyle-<hash>.png; members cannot upload under that name. */
export function isRestyleFile(url: string): boolean {
  try {
    return (new URL(url).pathname.split('/').pop() ?? '').startsWith('restyle-')
  } catch {
    return true
  }
}

export function isBaseKind(v: unknown): v is BaseKind {
  return typeof v === 'string' && (BASE_KINDS as readonly string[]).includes(v)
}

/**
 * Clean and authorise the requested layers. Throws 400 for malformed input and 403 when any
 * layer is not unlocked for this member (the client list is display-only; this is the check that
 * counts). Returns layers in z-order (background, outfit, accessories, frame, badge).
 */
export function validateLayers(
  raw: unknown,
  assets: ReadonlyArray<AssetRecord>,
  unlocked: ReadonlySet<number>,
  opts: { outfitOverlay?: boolean } = {},
): Layer[] {
  if (!Array.isArray(raw)) throw new ValidationError('layers must be a list', 'layers')
  if (raw.length > MAX_LAYERS) throw new ValidationError(`At most ${MAX_LAYERS} layers`, 'layers')
  const byId = new Map(assets.map((a) => [a.id, a]))
  const seen = new Set<number>()
  const counts: Record<AssetKind, number> = { background: 0, outfit: 0, frame: 0, accessory: 0, badge: 0 }
  const out: Array<Layer & { kind: AssetKind; i: number }> = []

  raw.forEach((item, i) => {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const id = Number(o.assetId)
    if (!Number.isInteger(id)) throw new ValidationError('Each layer needs an assetId', 'layers')
    if (seen.has(id)) throw new ValidationError('An asset can only be used once', 'layers')
    seen.add(id)
    const asset = byId.get(id)
    // Unknown, inactive and locked all look the same to the caller.
    if (!asset || !asset.isActive || !unlocked.has(id)) throw new ForbiddenError('One of the items is not unlocked for you')
    // Outfits are AI dress-up references; flat overlays only work behind pfp.outfitOverlayEnabled.
    if (asset.kind === 'outfit' && !opts.outfitOverlay) throw new ValidationError('Outfit overlays are turned off', 'layers')
    counts[asset.kind]++
    if (counts[asset.kind] > KIND_LIMITS[asset.kind]) {
      throw new ValidationError(`Too many ${asset.kind} layers (max ${KIND_LIMITS[asset.kind]})`, 'layers')
    }
    const t = isTransformable(asset.kind) ? cleanTransform(o, asset.defaultTransform) : cleanTransform({}, { x: 0.5, y: 0.5, scale: 1, rotation: 0 })
    out.push({ assetId: id, ...t, kind: asset.kind, i })
  })

  out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.i - b.i)
  return out.map(({ kind: _k, i: _i, ...l }) => l)
}

export class ImageFetchError extends ValidationError {}

/** Fetch an image from an allowlisted host, size-capped and type-sniffed. */
export async function fetchImageBytes(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  if (!isAllowedFetchUrl(url)) throw new ImageFetchError('Image host not allowed', 'base')
  const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new ImageFetchError('Could not load an image', 'base')
  if (Number(res.headers.get('content-length') ?? 0) > MAX_FETCH_BYTES) throw new ImageFetchError('Image too large', 'base')
  // Stream with a hard cap: a missing or lying content-length cannot make us buffer more.
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = res.body?.getReader()
  if (!reader) throw new ImageFetchError('Could not load an image', 'base')
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new ImageFetchError('Image too large', 'base')
    }
    chunks.push(value)
  }
  const buf = Buffer.concat(chunks)
  if (buf.length === 0) throw new ImageFetchError('Could not load an image', 'base')
  if (!sniffImageType(new Uint8Array(buf.subarray(0, 12)))) throw new ImageFetchError('Unsupported image type', 'base')
  return buf
}

/** The URL of each base a member can pick (display data for the composer). */
export async function availableBases(memberId: string, discordId: string) {
  const staticUrl = resolvePfpUrl(memberId)
  const [profile, portrait] = await Promise.all([
    fetchGuildMemberProfile(discordId).catch(() => null),
    prisma.mafiaPortrait
      .findFirst({ where: { discordId }, orderBy: { createdAt: 'desc' }, select: { url: true } })
      .catch(() => null),
  ])
  return {
    static: staticUrl,
    discord: profile?.avatarUrl ? discordAvatar1024(profile.avatarUrl) : null,
    mafia: portrait?.url && isOwnBlobUrl(portrait.url) ? portrait.url : null,
  }
}

export function discordAvatar1024(url: string): string {
  return url.replace(/size=\d+/, 'size=1024')
}

export interface BaseChoice {
  kind: BaseKind
  /** Only for kinds "upload" and "restyle": a Blob URL under pfp-base/<memberId>/. */
  url?: string
}

/** Resolve the chosen base to bytes + the URL we record. The client never names an arbitrary URL. */
export async function loadBase(
  memberId: string,
  discordId: string,
  choice: BaseChoice,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; url: string }> {
  if (choice.kind === 'upload' || choice.kind === 'restyle') {
    const url = String(choice.url ?? '')
    let ok = false
    try {
      // Dress-up results are written by the server as pfp-base/<memberId>/restyle-<hash>.png
      ok = isOwnBlobUrl(url, choice.kind === 'restyle' ? `/pfp-base/${memberId}/restyle-` : `/pfp-base/${memberId}/`)
      // No chaining: an "upload" can never be a dress-up result.
      if (ok && choice.kind === 'upload' && isRestyleFile(url)) ok = false
    } catch {
      ok = false
    }
    if (!ok) throw new ValidationError('Upload not found', 'base')
    return { bytes: await fetchImageBytes(url, fetchImpl), url }
  }
  const bases = await availableBases(memberId, discordId)
  if (choice.kind === 'static') {
    if (!bases.static || !bases.static.startsWith('/pfp/') || bases.static.includes('..')) {
      throw new ValidationError('No profile picture to start from', 'base')
    }
    const file = path.join(process.cwd(), 'public', bases.static)
    return { bytes: await fs.readFile(file), url: bases.static }
  }
  const url = choice.kind === 'discord' ? bases.discord : bases.mafia
  if (!url || (choice.kind === 'discord' ? !isDiscordCdnUrl(url) : !isOwnBlobUrl(url))) {
    throw new ValidationError(`No ${choice.kind} image available`, 'base')
  }
  return { bytes: await fetchImageBytes(url, fetchImpl), url }
}

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 }

/** One transformable layer (accessory or outfit): scaled, rotated about its centre, positioned, and cropped to the canvas. */
export async function placeLayer(buf: Buffer, t: Layer): Promise<sharp.OverlayOptions | null> {
  const size = Math.max(8, Math.round(CANVAS_SIZE * t.scale))
  let img = await S(buf).resize(size, size, { fit: 'fill' }).png().toBuffer()
  if (t.rotation % 360 !== 0) img = await S(img).rotate(t.rotation, { background: CLEAR }).png().toBuffer()
  const { width, height } = await S(img).metadata()
  if (!width || !height) return null
  const left = Math.round(t.x * CANVAS_SIZE - width / 2)
  const top = Math.round(t.y * CANVAS_SIZE - height / 2)
  const cropL = Math.max(0, -left)
  const cropT = Math.max(0, -top)
  const cropR = Math.max(0, left + width - CANVAS_SIZE)
  const cropB = Math.max(0, top + height - CANVAS_SIZE)
  const w = width - cropL - cropR
  const h = height - cropT - cropB
  if (w <= 0 || h <= 0) return null
  const input =
    cropL || cropT || cropR || cropB
      ? await S(img).extract({ left: cropL, top: cropT, width: w, height: h }).png().toBuffer()
      : img
  return { input, left: Math.max(0, left), top: Math.max(0, top) }
}

/** Draw the stack: background, base, outfit, accessories, frame, badge. */
export async function renderComposite(
  baseBytes: Buffer,
  layers: ReadonlyArray<{ kind: AssetKind; bytes: Buffer; layer: Layer }>,
): Promise<Buffer> {
  const full = (b: Buffer) => S(b).resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'cover' }).png().toBuffer()
  const stack: sharp.OverlayOptions[] = []
  const add = async (l: { kind: AssetKind; bytes: Buffer; layer: Layer }) => {
    if (isTransformable(l.kind)) {
      const p = await placeLayer(l.bytes, l.layer)
      if (p) stack.push(p)
    } else {
      stack.push({ input: await full(l.bytes), left: 0, top: 0 })
    }
  }
  for (const l of layers.filter((x) => x.kind === 'background')) await add(l)
  stack.push({ input: await S(baseBytes).rotate().resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'cover' }).png().toBuffer(), left: 0, top: 0 })
  for (const l of layers.filter((x) => x.kind !== 'background')) await add(l)

  return sharp({ create: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 4, background: CLEAR } })
    .composite(stack)
    .webp({ quality: 90 })
    .toBuffer()
}

export interface ComposeResult {
  composedUrl: string
  layers: Layer[]
}

export async function composeMemberPfp(args: {
  memberId: string
  discordId: string
  base: BaseChoice
  /** For kind "restyle": the base the dress-up was made from (kept so it can be undone). */
  original?: BaseChoice
  layers: unknown
  ctx?: UnlockContext
  fetchImpl?: typeof fetch
}): Promise<ComposeResult> {
  const { memberId, discordId, base } = args
  if (!isBaseKind(base.kind)) throw new ValidationError('Unknown base', 'base')

  // 1. Server-side unlock re-check (never trust the client's list).
  const [assets, ctx] = await Promise.all([listAssets({ activeOnly: true }), args.ctx ?? loadUnlockContext(discordId)])
  const outfitOverlay = await toggleEnabled('pfp.outfitOverlayEnabled')
  const layers = validateLayers(args.layers, assets, unlockedAssetIds(assets, ctx), { outfitOverlay })

  let original: { kind: BaseKind; url: string | null } | null = null
  if (base.kind === 'restyle') {
    const o = args.original
    if (!o || !isBaseKind(o.kind) || o.kind === 'restyle') throw new ValidationError('Missing the original picture', 'original')
    if (o.kind === 'upload' && (!isOwnBlobUrl(String(o.url ?? ''), `/pfp-base/${memberId}/`) || isRestyleFile(String(o.url)))) throw new ValidationError('Upload not found', 'original')
    original = { kind: o.kind, url: o.kind === 'upload' ? String(o.url) : null }
  }

  // 2. Fetch base + layer art, composite.
  const byId = new Map(assets.map((a) => [a.id, a]))
  const baseImg = await loadBase(memberId, discordId, base, args.fetchImpl)
  const art = await Promise.all(
    layers.map(async (layer) => {
      const asset = byId.get(layer.assetId)!
      return { kind: asset.kind, bytes: await fetchImageBytes(asset.imageUrl, args.fetchImpl), layer }
    }),
  )
  const out = await renderComposite(baseImg.bytes, art)

  // 3. Content-hashed key so a CDN never serves a stale image after an edit.
  const hash = createHash('sha256').update(out).digest('hex').slice(0, 16)
  const blob = await put(`pfp-composed/${memberId}-${hash}.webp`, out, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'image/webp',
  })

  const prev = await prisma.memberPfp.findUnique({ where: { memberId }, select: { composedUrl: true } })
  await prisma.memberPfp.upsert({
    where: { memberId },
    create: { memberId, baseKind: base.kind, baseUrl: baseImg.url, layers: layers as never, composedUrl: blob.url, originalBaseKind: original?.kind ?? null, originalBaseUrl: original?.url ?? null },
    update: { baseKind: base.kind, baseUrl: baseImg.url, layers: layers as never, composedUrl: blob.url, originalBaseKind: original?.kind ?? null, originalBaseUrl: original?.url ?? null },
  })
  if (prev?.composedUrl && prev.composedUrl !== blob.url && isOwnBlobUrl(prev.composedUrl)) {
    await del(prev.composedUrl).catch(() => undefined) // best effort
  }
  return { composedUrl: blob.url, layers }
}
