// AI "dress up": redraw the member's base picture wearing an unlocked outfit (OpenAI image edit,
// the outfit art and the base as references). The result is stored as a new base under
// pfp-base/<memberId>/restyle-<hash>.png; the composer then layers frames, accessories and badge on
// top. Cost controls come from the settings registry (pfp.restyle*). Refused or failed output is
// never stored. The limit check and the "pending" spend reservation happen in one transaction
// under advisory locks, before any image is fetched or OpenAI is called.
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
/** Per-attempt timeout; two attempts plus the image fetches fit under the route's maxDuration (180s). */
export const ATTEMPT_TIMEOUT_MS = 70_000
/** No second attempt once this much time has gone. */
export const RETRY_CUTOFF_MS = 75_000
/** A "pending" row older than this is treated as a failed (but possibly billed) attempt. */
export const STALE_PENDING_MS = 10 * 60 * 1000

export interface RestyleSettings {
  enabled: boolean
  perUnlock: number
  dailyLimit: number
  monthlyBudgetUsd: number
  costCents: number
  refusalDailyLimit: number
}

export async function loadRestyleSettings(): Promise<RestyleSettings> {
  const [enabled, perUnlock, dailyLimit, monthlyBudgetUsd, costCents, refusalDailyLimit] = await Promise.all([
    toggleEnabled('pfp.restyleEnabled'),
    getSetting('pfp.restylePerUnlock'),
    getSetting('pfp.restyleDailyLimit'),
    getSetting('pfp.restyleMonthlyBudgetUsd'),
    getSetting('pfp.restyleCostCents'),
    getSetting('pfp.restyleRefusalDailyLimit'),
  ])
  return { enabled, perUnlock, dailyLimit, monthlyBudgetUsd, costCents, refusalDailyLimit }
}

export interface UsageCounts {
  /** Successful or in-flight generations for this member and outfit, ever (failed tries are free). */
  forOutfit: number
  /** Generations that were not refused (including failed ones) for this member in the last 24 hours. */
  today: number
  /** Refusals for this member in the last 24 hours. */
  refusalsToday: number
  /** Estimated spend this calendar month across all members, in cents. */
  monthSpentCents: number
}

export type Allowance =
  | { ok: true; outfitRemaining: number; dailyRemaining: number }
  | { ok: false; status: number; code: 'disabled' | 'refusals' | 'per_outfit' | 'daily' | 'budget'; message: string }

/** Pure limit check. */
export function evaluateAllowance(s: RestyleSettings, u: UsageCounts): Allowance {
  if (!s.enabled) return { ok: false, status: 403, code: 'disabled', message: 'Dress up is not available yet.' }
  if (u.refusalsToday >= s.refusalDailyLimit) {
    return { ok: false, status: 429, code: 'refusals', message: 'Too many pictures were declined today. Try again tomorrow.' }
  }
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

type Db = Pick<typeof prisma, 'pfpRestyle'>

/** Mark pending rows that never finished as failed. Their cost stays booked: the call may have been billed. */
export async function sweepStalePending(db: Db, now = new Date()): Promise<void> {
  await db.pfpRestyle.updateMany({
    where: { status: 'pending', createdAt: { lt: new Date(now.getTime() - STALE_PENDING_MS) } },
    data: { status: 'error' },
  })
}

export async function loadUsage(memberId: string, outfitId: number | null, now = new Date(), db: Db = prisma): Promise<UsageCounts> {
  const since = { gte: new Date(now.getTime() - 24 * 3600 * 1000) }
  const [forOutfit, today, refusalsToday, month] = await Promise.all([
    outfitId === null ? 0 : db.pfpRestyle.count({ where: { memberId, outfitId, status: { in: ['pending', 'ok'] } } }),
    db.pfpRestyle.count({ where: { memberId, status: { in: ['pending', 'ok', 'error'] }, createdAt: since } }),
    db.pfpRestyle.count({ where: { memberId, status: 'refused', createdAt: since } }),
    db.pfpRestyle.aggregate({ _sum: { costCents: true }, where: { createdAt: { gte: startOfUtcMonth(now) } } }),
  ])
  return { forOutfit, today, refusalsToday, monthSpentCents: month._sum.costCents ?? 0 }
}

/** Per-outfit counts for the composer ("2 tries left"). Failed tries are not counted. */
export async function usageByOutfit(memberId: string): Promise<Record<number, number>> {
  const rows = await prisma.pfpRestyle.groupBy({
    by: ['outfitId'],
    _count: { _all: true },
    where: { memberId, status: { in: ['pending', 'ok'] } },
  })
  return Object.fromEntries(rows.map((r) => [r.outfitId, r._count._all]))
}

export function buildPrompt(outfitName: string): string {
  return (
    `Redraw this exact character, same face, hair, pose, art style, colors and background, but wearing ${outfitName.toLowerCase()} ` +
    `(see the second image for the outfit). Keep it a square avatar. Remove any text, names or captions from the picture; do not add any text.`
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

/** The call may have been billed (timeout, or a 200 with no usable image): the cost stays booked. */
export class RestyleCharged extends ApiError {
  constructor(message = 'Dress up failed. Try again in a moment.') {
    super(message, 502, 'UPSTREAM')
  }
}

async function toSquarePng(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { limitInputPixels: MAX_PIXELS }).rotate().resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'cover' }).png().toBuffer()
}

/** One OpenAI image edit, trying each model in turn when an account does not have the first. */
export async function openAiEdit(
  base: Buffer,
  outfit: Buffer,
  prompt: string,
  opts: { fetchImpl?: typeof fetch; apiKey?: string; models?: string[]; timeoutMs?: number } = {},
): Promise<Buffer> {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new ApiError('Dress up is not configured', 503, 'UNAVAILABLE')
  const f = opts.fetchImpl ?? fetch
  const models = opts.models ?? IMAGE_MODELS
  const [baseP, outfitP] = await Promise.all([toSquarePng(base), toSquarePng(outfit)])
  const started = Date.now()
  for (let i = 0; i < models.length; i++) {
    if (i > 0 && Date.now() - started > RETRY_CUTOFF_MS) break
    const form = new FormData()
    form.set('model', models[i])
    form.set('prompt', prompt)
    form.set('size', '1024x1024')
    form.set('output_format', 'png')
    form.set('quality', 'medium')
    form.set('input_fidelity', 'high')
    form.append('image[]', new File([new Uint8Array(baseP)], 'base.png', { type: 'image/png' }))
    form.append('image[]', new File([new Uint8Array(outfitP)], 'outfit.png', { type: 'image/png' }))
    let res: Response
    try {
      res = await f('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(opts.timeoutMs ?? ATTEMPT_TIMEOUT_MS),
      })
    } catch {
      throw new RestyleCharged() // timed out mid-generation: it may still be billed
    }
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
    if (!b64) throw new RestyleCharged()
    return Buffer.from(b64, 'base64')
  }
  throw new ApiError('Dress up failed. Try again in a moment.', 502, 'UPSTREAM')
}

export interface RestyleResult {
  url: string
  outfitRemaining: number
  dailyRemaining: number
}

/**
 * Check every limit and insert the pending row in ONE transaction, serialised per member (and
 * globally for the monthly budget) with advisory locks, so concurrent requests cannot all pass.
 */
async function reserve(args: {
  memberId: string
  discordId: string
  outfitId: number
  outfitName: string
  settings: RestyleSettings
}): Promise<{ id: number; allowance: Extract<Allowance, { ok: true }> }> {
  const { memberId, discordId, outfitId, outfitName, settings } = args
  return prisma.$transaction(async (tx) => {
    // Fixed order (global, then member) so two requests can never deadlock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pfp-restyle:budget'))`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pfp-restyle:member:${memberId}`}))`
    const now = new Date()
    await sweepStalePending(tx, now)
    const allowance = evaluateAllowance(settings, await loadUsage(memberId, outfitId, now, tx))
    if (!allowance.ok) throw new ApiError(allowance.message, allowance.status, allowance.code.toUpperCase())
    const row = await tx.pfpRestyle.create({
      data: { memberId, discordId, outfitId, outfitName, costCents: settings.costCents, status: 'pending' },
    })
    return { id: row.id, allowance }
  })
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

  // Limits and the spend reservation first; only then fetch images and call OpenAI.
  const { id, allowance } = await reserve({ memberId, discordId, outfitId, outfitName: outfit.name, settings })
  const finish = (status: string, extra: { costCents?: number; resultUrl?: string } = {}) =>
    prisma.pfpRestyle.update({ where: { id }, data: { status, ...extra } })

  let png: Buffer
  try {
    const baseImg = await loadBase(memberId, discordId, args.base, args.fetchImpl)
    const outfitBytes = await fetchImageBytes(outfit.imageUrl, args.fetchImpl)
    png = await (args.generate ?? openAiEdit)(baseImg.bytes, outfitBytes, buildPrompt(outfit.name), { fetchImpl: args.fetchImpl })
  } catch (e) {
    if (e instanceof RestyleRefused) {
      await finish('refused', { costCents: 0 })
      throw new ApiError(FRIENDLY_REFUSAL, 422, 'REFUSED')
    }
    // Billed-but-unusable (timeout, empty 200) keeps its cost; anything else is refunded.
    await finish('error', e instanceof RestyleCharged ? {} : { costCents: 0 })
    throw e
  }

  let out: Buffer
  try {
    if (!sniffImageType(new Uint8Array(png.subarray(0, 12)))) throw new Error('not an image')
    out = await sharp(png, { limitInputPixels: MAX_PIXELS }).resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'cover' }).png().toBuffer()
  } catch {
    await finish('error') // OpenAI answered 200: it was billed, so the cost stays booked
    throw new RestyleCharged()
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
