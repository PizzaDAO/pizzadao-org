// AI "dress up": redraw the member's base picture wearing an unlocked outfit (OpenAI image edit,
// the outfit art and the base as references). The result is stored as a new base under
// pfp-base/<memberId>/restyle-<hash>.png; the composer then layers frames, accessories and badge on
// top. Cost controls come from the settings registry (pfp.restyle*). Refused or failed output is
// never stored.
import { createHash } from 'crypto'
import sharp from 'sharp'
import { put } from '@vercel/blob'
import { prisma } from '@/app/lib/db'
import { ApiError, ForbiddenError, ValidationError } from '@/app/lib/errors/api-errors'
import { getSetting } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { sniffImageType } from '@/app/lib/image-sniff'
import { listAssets } from './catalog'
import { loadUnlockContext } from './context'
import { unlockedAssetIds } from './unlocks'
import { fetchImageBytes, loadBase, MAX_PIXELS, type BaseChoice } from './compose'
import { pruneBaseUploads } from './upload-base'
import { CANVAS_SIZE } from './types'

export const IMAGE_MODELS = ['gpt-image-1', 'gpt-image-1.5']
export const FRIENDLY_REFUSAL = 'The image service could not dress this picture up. Try a different base picture or outfit.'

export interface RestyleSettings {
  enabled: boolean
  perUnlock: number
  dailyLimit: number
  monthlyBudgetUsd: number
  costCents: number
}

export async function loadRestyleSettings(): Promise<RestyleSettings> {
  const [enabled, perUnlock, dailyLimit, monthlyBudgetUsd, costCents] = await Promise.all([
    toggleEnabled('pfp.restyleEnabled'),
    getSetting('pfp.restylePerUnlock'),
    getSetting('pfp.restyleDailyLimit'),
    getSetting('pfp.restyleMonthlyBudgetUsd'),
    getSetting('pfp.restyleCostCents'),
  ])
  return { enabled, perUnlock, dailyLimit, monthlyBudgetUsd, costCents }
}

export interface UsageCounts {
  /** Generations (not refused) for this member and outfit, ever. */
  forOutfit: number
  /** Generations (not refused) for this member in the last 24 hours. */
  today: number
  /** Estimated spend this calendar month across all members, in cents. */
  monthSpentCents: number
}

export type Allowance =
  | { ok: true; outfitRemaining: number; dailyRemaining: number }
  | { ok: false; status: number; code: 'disabled' | 'per_outfit' | 'daily' | 'budget'; message: string }

/** Pure limit check. Refusals are free for the member (callers leave them out of the counts). */
export function evaluateAllowance(s: RestyleSettings, u: UsageCounts): Allowance {
  if (!s.enabled) return { ok: false, status: 403, code: 'disabled', message: 'Dress up is not available yet.' }
  if (u.forOutfit >= s.perUnlock) {
    return { ok: false, status: 429, code: 'per_outfit', message: 'You have used all your tries for this outfit.' }
  }
  if (u.today >= s.dailyLimit) {
    return { ok: false, status: 429, code: 'daily', message: 'Daily dress-up limit reached. Try again tomorrow.' }
  }
  if (u.monthSpentCents + s.costCents > s.monthlyBudgetUsd * 100) {
    return { ok: false, status: 429, code: 'budget', message: 'Dress up is paused for this month. Try again next month.' }
  }
  return { ok: true, outfitRemaining: s.perUnlock - u.forOutfit, dailyRemaining: s.dailyLimit - u.today }
}

const startOfUtcMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

export async function loadUsage(memberId: string, outfitId: number | null, now = new Date()): Promise<UsageCounts> {
  const notRefused = { status: { in: ['pending', 'ok', 'error'] } }
  const [forOutfit, today, month] = await Promise.all([
    outfitId === null ? 0 : prisma.pfpRestyle.count({ where: { memberId, outfitId, ...notRefused } }),
    prisma.pfpRestyle.count({ where: { memberId, ...notRefused, createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) } } }),
    prisma.pfpRestyle.aggregate({ _sum: { costCents: true }, where: { createdAt: { gte: startOfUtcMonth(now) } } }),
  ])
  return { forOutfit, today, monthSpentCents: month._sum.costCents ?? 0 }
}

/** Per-outfit counts for the composer ("2 tries left"). */
export async function usageByOutfit(memberId: string): Promise<Record<number, number>> {
  const rows = await prisma.pfpRestyle.groupBy({
    by: ['outfitId'],
    _count: { _all: true },
    where: { memberId, status: { in: ['pending', 'ok', 'error'] } },
  })
  return Object.fromEntries(rows.map((r) => [r.outfitId, r._count._all]))
}

export function buildPrompt(outfitName: string): string {
  return (
    `Redraw this exact character, same face, hair, pose, art style, colors and background, but wearing ${outfitName.toLowerCase()} ` +
    `(see the second image for the outfit). Keep it a square avatar. Do not add text.`
  )
}

/** Did the image service refuse on safety grounds (as opposed to failing)? */
export function isRefusal(status: number, body: { error?: { code?: string | null; message?: string } } | null): boolean {
  if (status !== 400 && status !== 422) return false
  const code = body?.error?.code ?? ''
  const msg = body?.error?.message ?? ''
  return /moderation|content_policy|safety/i.test(code) || /safety system|moderation|content policy/i.test(msg)
}

export class RestyleRefused extends Error {}

async function toSquarePng(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'cover' })
    .png()
    .toBuffer()
}

/** One OpenAI image edit, trying each model in turn when an account does not have the first. */
export async function openAiEdit(
  base: Buffer,
  outfit: Buffer,
  prompt: string,
  opts: { fetchImpl?: typeof fetch; apiKey?: string; models?: string[] } = {},
): Promise<Buffer> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new ApiError('Dress up is not configured', 503, 'UNAVAILABLE')
  const f = opts.fetchImpl ?? fetch
  const models = opts.models ?? IMAGE_MODELS
  const [baseP, outfitP] = await Promise.all([toSquarePng(base), toSquarePng(outfit)])
  for (let i = 0; i < models.length; i++) {
    const form = new FormData()
    form.set('model', models[i])
    form.set('prompt', prompt)
    form.set('size', '1024x1024')
    form.set('output_format', 'png')
    form.set('quality', 'medium')
    form.set('input_fidelity', 'high')
    form.append('image[]', new File([new Uint8Array(baseP)], 'base.png', { type: 'image/png' }))
    form.append('image[]', new File([new Uint8Array(outfitP)], 'outfit.png', { type: 'image/png' }))
    const res = await f('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(150_000),
    })
    const body = (await res.json().catch(() => null)) as {
      data?: Array<{ b64_json?: string }>
      error?: { code?: string | null; message?: string }
    } | null
    if (!res.ok) {
      if (isRefusal(res.status, body)) throw new RestyleRefused(body?.error?.message ?? 'refused')
      if (/does not exist/i.test(body?.error?.message ?? '') && i + 1 < models.length) continue
      throw new ApiError('Dress up failed. Try again in a moment.', 502, 'UPSTREAM')
    }
    const b64 = body?.data?.[0]?.b64_json
    if (!b64) throw new ApiError('Dress up failed. Try again in a moment.', 502, 'UPSTREAM')
    return Buffer.from(b64, 'base64')
  }
  throw new ApiError('Dress up failed. Try again in a moment.', 502, 'UPSTREAM')
}

export interface RestyleResult {
  url: string
  outfitRemaining: number
  dailyRemaining: number
}

export async function restyleForMember(args: {
  memberId: string
  discordId: string
  outfitId: number
  base: BaseChoice
  fetchImpl?: typeof fetch
  generate?: typeof openAiEdit
}): Promise<RestyleResult> {
  const { memberId, discordId, outfitId } = args
  if (args.base.kind === 'restyle') throw new ValidationError('Dress up starts from your original picture', 'base')

  const settings = await loadRestyleSettings()
  if (!settings.enabled) throw new ForbiddenError('Dress up is not available yet.')

  // Server-side unlock re-check: the outfit must be an active outfit this member has unlocked.
  const [assets, ctx] = await Promise.all([listAssets({ activeOnly: true }), loadUnlockContext(discordId)])
  const outfit = assets.find((a) => a.id === outfitId && a.kind === 'outfit')
  if (!outfit || !unlockedAssetIds(assets, ctx).has(outfitId)) throw new ForbiddenError('That outfit is not unlocked for you')

  const allowance = evaluateAllowance(settings, await loadUsage(memberId, outfitId))
  if (!allowance.ok) throw new ApiError(allowance.message, allowance.status, allowance.code.toUpperCase())

  const baseImg = await loadBase(memberId, discordId, args.base, args.fetchImpl)
  const outfitBytes = await fetchImageBytes(outfit.imageUrl, args.fetchImpl)

  // Reserve the spend first, so concurrent requests cannot all slip under a limit.
  const row = await prisma.pfpRestyle.create({
    data: { memberId, discordId, outfitId, outfitName: outfit.name, costCents: settings.costCents, status: 'pending' },
  })
  const finish = (status: string, extra: { costCents?: number; resultUrl?: string } = {}) =>
    prisma.pfpRestyle.update({ where: { id: row.id }, data: { status, ...extra } })

  let png: Buffer
  try {
    png = await (args.generate ?? openAiEdit)(baseImg.bytes, outfitBytes, buildPrompt(outfit.name), { fetchImpl: args.fetchImpl })
  } catch (e) {
    if (e instanceof RestyleRefused) {
      await finish('refused', { costCents: 0 })
      throw new ApiError(FRIENDLY_REFUSAL, 422, 'REFUSED')
    }
    await finish('error', { costCents: 0 })
    throw e
  }

  let out: Buffer
  try {
    if (!sniffImageType(new Uint8Array(png.subarray(0, 12)))) throw new Error('not an image')
    out = await sharp(png, { limitInputPixels: MAX_PIXELS }).resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'cover' }).png().toBuffer()
  } catch {
    await finish('error', { costCents: 0 })
    throw new ApiError('Dress up failed. Try again in a moment.', 502, 'UPSTREAM')
  }

  const hash = createHash('sha256').update(out).digest('hex').slice(0, 16)
  const blob = await put(`pfp-base/${memberId}/restyle-${hash}.png`, out, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'image/png',
  })
  await finish('ok', { resultUrl: blob.url })
  await pruneBaseUploads(memberId).catch(() => undefined)
  return { url: blob.url, outfitRemaining: allowance.outfitRemaining - 1, dailyRemaining: allowance.dailyRemaining - 1 }
}
