/**
 * Database and file work for the meme folder (bellpepper-80127). Routes stay thin and call these.
 *
 * Files: a waiting meme lives only in PRIVATE storage (privatePath) and is reached through the
 * authenticated file route. Approving copies it (JPEG metadata stripped) to a public URL under
 * memes/ and deletes the private copy. Hiding does the reverse (private copy first, then the public
 * file is deleted) so a capo can restore it. Rejecting or deleting removes the files and keeps the row.
 *
 * Database egress: lists select only the columns the grid needs, are cursor-paged, and the uploader
 * names come from one query for the page.
 */
import { del, put } from '@vercel/blob'
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { memberNamesByDiscordId } from '@/app/lib/member-names'
import { PrivateUploadError, readPrivate, uploadPrivate } from '@/app/lib/private-blob-upload'
import { sha256Hex } from '@/app/lib/payments/hash'
import { isOwnBlobUrl } from '@/app/lib/blob-url'
import { memesPrivateToken, memesPublicToken, memesPublicUrlToken } from './blob'
import {
  MEME_MAX_NOTE,
  MEME_MAX_PAGE_SIZE,
  MEME_MAX_REPORTS_PER_DAY,
  MEME_MAX_REPORT_REASON,
  MEME_MAX_CAPTION,
  MEME_PAGE_SIZE,
  canTransition,
  cleanTags,
  cleanText,
  shouldAutoHide,
  stripJpegMetadata,
  validateUpload,
  type MemeCategory,
  type MemeStatus,
} from './rules'

/** Uploads go through a function whose request body is limited to 4.5 MB; the setting cannot exceed this. */
export const MEME_UPLOAD_HARD_MAX_BYTES = 4 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000
const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** The effective largest upload, for the client's pre-check. */
export async function uploadLimitBytes(): Promise<number> {
  return Math.min((await loadSettings()).get('memes.maxUploadBytes'), MEME_UPLOAD_HARD_MAX_BYTES)
}

export type MemeTab = 'all' | 'benny' | 'pizzadao' | 'mine'
export const MEME_TABS: readonly MemeTab[] = ['all', 'benny', 'pizzadao', 'mine']

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error })

// ── What the browser sees ──────────────────────────────────────────────────────────────────────

const ITEM_SELECT = {
  id: true,
  uploaderId: true,
  category: true,
  caption: true,
  tags: true,
  status: true,
  publicUrl: true,
  width: true,
  height: true,
  reviewNote: true,
  reportCount: true,
  createdAt: true,
} as const

type ItemRow = {
  id: string
  uploaderId: string
  category: string
  caption: string | null
  tags: string[]
  status: string
  publicUrl: string | null
  width: number | null
  height: number | null
  reviewNote: string | null
  reportCount: number
  createdAt: Date
}

export type MemeItem = {
  id: string
  category: string
  caption: string | null
  tags: string[]
  status: string
  url: string | null
  downloadUrl: string | null
  width: number | null
  height: number | null
  uploader: string
  mine: boolean
  /** Only for the uploader (reject note) */
  note?: string | null
  /** Only for reviewers */
  reportCount?: number
  createdAt: string
}

/** The file URL a viewer's browser may use: the public one when live, else the authenticated file route. Never the storage path. */
function viewUrl(r: ItemRow): string | null {
  if (r.status === 'APPROVED' && r.publicUrl && isOwnBlobUrl(r.publicUrl, '/memes/', memesPublicUrlToken())) return r.publicUrl
  if (r.status === 'PENDING' || r.status === 'HIDDEN') return `/api/memes/${r.id}/file`
  return null
}

function toItem(r: ItemRow, viewerId: string, names: Map<string, { name: string }>, asReviewer: boolean): MemeItem {
  const url = viewUrl(r)
  const live = r.status === 'APPROVED' && !!r.publicUrl && url === r.publicUrl
  const mine = r.uploaderId === viewerId
  return {
    id: r.id,
    category: r.category,
    caption: r.caption,
    tags: r.tags,
    status: r.status,
    url,
    downloadUrl: live && url ? `${url}${url.includes('?') ? '&' : '?'}download=1` : null,
    width: r.width,
    height: r.height,
    uploader: names.get(r.uploaderId)?.name ?? 'A member',
    mine,
    ...(mine ? { note: r.reviewNote } : {}),
    ...(asReviewer ? { reportCount: r.reportCount } : {}),
    createdAt: r.createdAt.toISOString(),
  }
}

export async function listMemes(opts: {
  tab: MemeTab
  viewerId: string
  cursor?: string | null
  limit?: number
}): Promise<{ items: MemeItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? MEME_PAGE_SIZE)), MEME_MAX_PAGE_SIZE)
  const where =
    opts.tab === 'mine'
      ? { uploaderId: opts.viewerId, status: { not: 'DELETED' } }
      : { status: 'APPROVED', ...(opts.tab === 'all' ? {} : { category: opts.tab }) }
  const rows = (await prisma.meme.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: ITEM_SELECT,
  })) as ItemRow[]
  const page = rows.slice(0, limit)
  const names = await memberNamesByDiscordId(page.map((r) => r.uploaderId))
  return {
    items: page.map((r) => toItem(r, opts.viewerId, names, false)),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  }
}

/** The capo queue: waiting memes oldest first, then approved ones with reports, then hidden ones. */
export async function reviewQueue(viewerId: string): Promise<{ items: MemeItem[] }> {
  const [pending, reported, hidden] = await Promise.all([
    prisma.meme.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 50, select: ITEM_SELECT }),
    prisma.meme.findMany({ where: { status: 'APPROVED', reportCount: { gt: 0 } }, orderBy: { reportCount: 'desc' }, take: 25, select: ITEM_SELECT }),
    prisma.meme.findMany({ where: { status: 'HIDDEN' }, orderBy: { updatedAt: 'desc' }, take: 25, select: ITEM_SELECT }),
  ])
  const rows = [...pending, ...reported, ...hidden] as ItemRow[]
  const names = await memberNamesByDiscordId(rows.map((r) => r.uploaderId))
  return { items: rows.map((r) => toItem(r, viewerId, names, true)) }
}

/** Waiting count for the capo badge (one cheap count). */
export function pendingCount(): Promise<number> {
  return prisma.meme.count({ where: { status: 'PENDING' } }).catch(() => 0)
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function deleteQuietly(pathOrUrl: string | null | undefined, kind: 'public' | 'private'): Promise<void> {
  if (!pathOrUrl) return
  const token = kind === 'public' ? memesPublicToken() : memesPrivateToken()
  try {
    await del(pathOrUrl, token ? { token } : undefined)
  } catch {
    // The row no longer points at it; an orphaned file is harmless and can be swept later.
  }
}

/** Copy the private file to a public URL (JPEG metadata stripped). Returns the URL, or null when the file cannot be read or stored. */
async function publishFile(m: { id: string; privatePath: string | null; mime: string }): Promise<string | null> {
  if (!m.privatePath) return null
  const file = await readPrivate(m.privatePath, memesPrivateToken())
  if (!file) return null
  try {
    let bytes = await bytesOf(file.stream)
    if (m.mime === 'image/jpeg') {
      // If the metadata cannot be stripped cleanly, do not publish the original (it may carry GPS).
      const stripped = stripJpegMetadata(bytes)
      if (!stripped) return null
      bytes = stripped
    }
    const publicToken = memesPublicToken()
    const ext = EXT_BY_MIME[m.mime] ?? 'bin'
    const blob = await put(`memes/${m.id}.${ext}`, Buffer.from(bytes), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: m.mime, ...(publicToken ? { token: publicToken } : {}) })
    return isOwnBlobUrl(blob.url, '/memes/', memesPublicUrlToken()) ? blob.url : null
  } catch {
    return null
  }
}

/** Put a private copy of a live meme's file in place (so it can be restored). Null when it cannot be made. */
async function copyToPrivate(m: { uploaderId: string; publicUrl: string | null }): Promise<string | null> {
  if (!m.publicUrl || !isOwnBlobUrl(m.publicUrl, '/memes/', memesPublicUrlToken())) return null
  try {
    const res = await fetch(m.publicUrl, { cache: 'no-store' })
    if (!res.ok) return null
    return (await uploadPrivate(new Uint8Array(await res.arrayBuffer()), `memes/pending/${m.uploaderId}`, memesPrivateToken())).pathname
  } catch {
    return null
  }
}

// ── Upload ─────────────────────────────────────────────────────────────────────────────────────

export async function createMeme(input: {
  uploaderId: string
  bytes: Uint8Array
  category: MemeCategory
  caption?: unknown
  tags?: unknown
}): Promise<ServiceResult<{ id: string; status: MemeStatus }>> {
  const s = await loadSettings()
  const check = validateUpload(input.bytes, Math.min(s.get('memes.maxUploadBytes'), MEME_UPLOAD_HARD_MAX_BYTES), s.get('memes.maxGifFrames'))
  if (!check.ok) return fail(check.code === 'too_large' ? 413 : 400, check.error)

  const since = new Date(Date.now() - DAY_MS)
  const [today, waiting] = await Promise.all([
    prisma.meme.count({ where: { uploaderId: input.uploaderId, createdAt: { gte: since } } }),
    prisma.meme.count({ where: { uploaderId: input.uploaderId, status: 'PENDING' } }),
  ])
  if (today >= s.get('memes.maxUploadsPerDay')) return fail(429, 'Daily upload limit reached. Try again tomorrow.')
  if (waiting >= s.get('memes.maxPending')) return fail(429, 'You have too many memes waiting for review. Wait for a capo to review some.')

  const sha256 = sha256Hex(input.bytes)
  const dupe = await prisma.meme.findFirst({ where: { sha256, status: { in: ['PENDING', 'APPROVED', 'HIDDEN'] } }, select: { id: true } })
  if (dupe) return fail(409, 'Already in the folder.')

  let stored: { pathname: string }
  try {
    stored = await uploadPrivate(input.bytes, `memes/pending/${input.uploaderId}`, memesPrivateToken())
  } catch (err) {
    if (err instanceof PrivateUploadError) return fail(err.code === 'unavailable' ? 503 : 400, err.message)
    throw err
  }

  const row = await prisma.meme.create({
    data: {
      uploaderId: input.uploaderId,
      category: input.category,
      caption: cleanText(input.caption, MEME_MAX_CAPTION),
      tags: cleanTags(input.tags),
      status: 'PENDING',
      privatePath: stored.pathname,
      mime: check.mime,
      sizeBytes: input.bytes.byteLength,
      width: check.width,
      height: check.height,
      sha256,
    },
    select: { id: true },
  })

  // Post-moderation mode: show it now. If the copy fails it simply stays waiting for a capo.
  if (!s.get('memes.requireApproval')) {
    const r = await reviewMeme({ id: row.id, action: 'approve', reviewerId: 'auto' })
    if (r.ok) return { ok: true, value: { id: row.id, status: 'APPROVED' } }
  }
  return { ok: true, value: { id: row.id, status: 'PENDING' } }
}

// ── Review ─────────────────────────────────────────────────────────────────────────────────────

export type ReviewAction = 'approve' | 'reject' | 'hide' | 'restore' | 'clear'

export async function reviewMeme(opts: { id: string; action: ReviewAction; reviewerId: string; note?: unknown }): Promise<ServiceResult<{ status: MemeStatus }>> {
  const m = await prisma.meme.findUnique({
    where: { id: opts.id },
    select: { id: true, uploaderId: true, status: true, privatePath: true, publicUrl: true, mime: true },
  })
  if (!m) return fail(404, 'Not found')
  const note = cleanText(opts.note, MEME_MAX_NOTE)
  const stamp = { reviewedBy: opts.reviewerId, reviewedAt: new Date() }

  if (opts.action === 'clear') {
    if (m.status !== 'APPROVED') return fail(409, 'Only a live meme has reports to clear')
    await prisma.memeReport.deleteMany({ where: { memeId: m.id } })
    await prisma.meme.updateMany({ where: { id: m.id, status: 'APPROVED' }, data: { reportCount: 0, ...stamp } })
    return { ok: true, value: { status: 'APPROVED' } }
  }

  const target: MemeStatus = opts.action === 'approve' || opts.action === 'restore' ? 'APPROVED' : opts.action === 'reject' ? 'REJECTED' : 'HIDDEN'
  if (opts.action === 'approve' && m.status !== 'PENDING') return fail(409, 'Only a waiting meme can be approved')
  if (opts.action === 'restore' && m.status !== 'HIDDEN') return fail(409, 'Only a hidden meme can be restored')
  if (!canTransition(m.status, target)) return fail(409, `Cannot change a ${m.status.toLowerCase()} meme that way`)

  if (target === 'APPROVED') {
    const publicUrl = await publishFile(m)
    if (!publicUrl) return fail(502, 'The file could not be published. Try again.')
    const res = await prisma.meme.updateMany({
      where: { id: m.id, status: m.status },
      data: { status: 'APPROVED', publicUrl, privatePath: null, reportCount: 0, reviewNote: null, ...stamp },
    })
    if (res.count === 0) {
      await deleteQuietly(publicUrl, 'public')
      return fail(409, 'Someone else just changed this meme')
    }
    await deleteQuietly(m.privatePath, 'private')
    if (opts.action === 'restore') await prisma.memeReport.deleteMany({ where: { memeId: m.id } })
    return { ok: true, value: { status: 'APPROVED' } }
  }

  if (target === 'REJECTED') {
    const res = await prisma.meme.updateMany({
      where: { id: m.id, status: m.status },
      data: { status: 'REJECTED', privatePath: null, publicUrl: null, reviewNote: note, ...stamp },
    })
    if (res.count === 0) return fail(409, 'Someone else just changed this meme')
    await deleteQuietly(m.privatePath, 'private')
    await deleteQuietly(m.publicUrl, 'public')
    return { ok: true, value: { status: 'REJECTED' } }
  }

  // HIDDEN: make the private copy first. Without one the meme stays live (a meme must never end up
  // hidden with no file to restore), and the public file is deleted only after the row says HIDDEN.
  const privatePath = await copyToPrivate(m)
  if (!privatePath) return fail(502, 'The file could not be moved aside. Try again.')
  const res = await prisma.meme.updateMany({
    where: { id: m.id, status: 'APPROVED' },
    data: { status: 'HIDDEN', publicUrl: null, privatePath, reviewNote: note, ...stamp },
  })
  if (res.count === 0) {
    await deleteQuietly(privatePath, 'private')
    return fail(409, 'Someone else just changed this meme')
  }
  await deleteQuietly(m.publicUrl, 'public')
  return { ok: true, value: { status: 'HIDDEN' } }
}

// ── Reports ────────────────────────────────────────────────────────────────────────────────────

export async function reportMeme(opts: { id: string; reporterId: string; reason?: unknown }): Promise<ServiceResult<{ hidden: boolean }>> {
  const m = await prisma.meme.findUnique({ where: { id: opts.id }, select: { id: true, uploaderId: true, status: true } })
  if (!m || m.status !== 'APPROVED') return fail(404, 'Not found')
  if (m.uploaderId === opts.reporterId) return fail(400, 'You cannot report your own meme')

  const today = await prisma.memeReport.count({ where: { reporterId: opts.reporterId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } })
  if (today >= MEME_MAX_REPORTS_PER_DAY) return fail(429, 'Too many reports today')

  try {
    await prisma.memeReport.create({
      data: { memeId: m.id, reporterId: opts.reporterId, reason: cleanText(opts.reason, MEME_MAX_REPORT_REASON) ?? 'No reason given' },
    })
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return fail(409, 'You already reported this meme')
    throw err
  }

  const distinct = await prisma.memeReport.count({ where: { memeId: m.id } })
  await prisma.meme.updateMany({ where: { id: m.id }, data: { reportCount: distinct } })
  const threshold = (await loadSettings()).get('memes.autoHideReports')
  if (shouldAutoHide(m.status, distinct, threshold)) {
    const r = await reviewMeme({ id: m.id, action: 'hide', reviewerId: 'auto-reports', note: 'Hidden after reports' })
    return { ok: true, value: { hidden: r.ok } }
  }
  return { ok: true, value: { hidden: false } }
}

// ── The uploader's own memes ───────────────────────────────────────────────────────────────────

export async function deleteOwnMeme(id: string, uploaderId: string): Promise<ServiceResult<null>> {
  const m = await prisma.meme.findUnique({ where: { id }, select: { id: true, uploaderId: true, status: true, privatePath: true, publicUrl: true } })
  if (!m || m.uploaderId !== uploaderId) return fail(404, 'Not found')
  if (!canTransition(m.status, 'DELETED')) return fail(409, 'Already removed')
  const res = await prisma.meme.updateMany({ where: { id, status: m.status }, data: { status: 'DELETED', privatePath: null, publicUrl: null } })
  if (res.count === 0) return fail(409, 'Someone else just changed this meme')
  await deleteQuietly(m.privatePath, 'private')
  await deleteQuietly(m.publicUrl, 'public')
  return { ok: true, value: null }
}

/** Caption and tags, by the uploader, while the meme is still waiting. */
export async function updateOwnMeme(id: string, uploaderId: string, patch: { caption?: unknown; tags?: unknown }): Promise<ServiceResult<null>> {
  const data: { caption?: string | null; tags?: string[] } = {}
  if ('caption' in patch) data.caption = cleanText(patch.caption, MEME_MAX_CAPTION)
  if ('tags' in patch) data.tags = cleanTags(patch.tags)
  const res = await prisma.meme.updateMany({ where: { id, uploaderId, status: 'PENDING' }, data })
  return res.count === 0 ? fail(404, 'Not found, or no longer waiting') : { ok: true, value: null }
}

/** Who may stream a private file: its uploader, or a reviewer. Null path when there is none to serve. */
export async function privateFileFor(id: string): Promise<{ uploaderId: string; privatePath: string | null; status: string } | null> {
  return prisma.meme.findUnique({ where: { id }, select: { uploaderId: true, privatePath: true, status: true } })
}
