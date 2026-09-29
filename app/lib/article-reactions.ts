import { prisma } from './db'
import { ValidationError } from './errors/api-errors'

/**
 * The three emoji reactions supported on articles. Stored as short string
 * codes (not raw emoji) so the schema is portable across font/encoding edges
 * and we can swap glyphs without a data migration.
 */
export const REACTION_EMOJIS = ['thumbs', 'heart', 'pizza'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

/**
 * Map our short codes to the display glyphs the UI renders.
 */
export const REACTION_GLYPH: Record<ReactionEmoji, string> = {
  thumbs: '👍',
  heart: '❤️',
  pizza: '🍕',
}

/** 30s cooldown between reaction changes for the same (member, article). */
export const REACTION_COOLDOWN_MS = 30_000

export type ReactionCounts = Record<ReactionEmoji, number>

export function emptyReactionCounts(): ReactionCounts {
  return { thumbs: 0, heart: 0, pizza: 0 }
}

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === 'string' && (REACTION_EMOJIS as readonly string[]).includes(value)
}

/**
 * Validate and normalise the emoji from a request body. Throws ValidationError
 * if it's not one of the three known codes.
 */
export function validateReactionEmoji(raw: unknown): ReactionEmoji {
  if (!isReactionEmoji(raw)) {
    throw new ValidationError(
      `Reaction must be one of: ${REACTION_EMOJIS.join(', ')}`,
      'emoji'
    )
  }
  return raw
}

/**
 * Reject a reaction change if the same member touched the same article within
 * the cooldown window. Mirrors `checkCommentRateLimit` — same cheap single
 * Prisma query, no Redis. The cooldown applies to *any* change (add, swap,
 * toggle off) since that's what hits the DB.
 */
export async function checkReactionRateLimit(
  articleId: number,
  memberId: string,
  cooldownMs = REACTION_COOLDOWN_MS
): Promise<void> {
  const existing = await prisma.articleReaction.findUnique({
    where: { articleId_memberId: { articleId, memberId } },
    select: { createdAt: true },
  })
  if (!existing) return
  const elapsed = Date.now() - existing.createdAt.getTime()
  if (elapsed < cooldownMs) {
    const wait = Math.ceil((cooldownMs - elapsed) / 1000)
    throw new ValidationError(
      `You're reacting too fast — wait ${wait}s and try again.`,
      'cooldown'
    )
  }
}

/**
 * Count reactions per emoji for an article. Returns a fully-populated record
 * (zeros included) so the UI can render counts unconditionally.
 */
export async function getReactionCounts(articleId: number): Promise<ReactionCounts> {
  const rows = await prisma.articleReaction.groupBy({
    by: ['emoji'],
    where: { articleId },
    _count: { emoji: true },
  })
  const counts = emptyReactionCounts()
  for (const row of rows) {
    if (isReactionEmoji(row.emoji)) {
      counts[row.emoji] = row._count.emoji
    }
  }
  return counts
}

/**
 * Look up the requester's current reaction on an article (or null).
 */
export async function getMyReaction(
  articleId: number,
  memberId: string
): Promise<ReactionEmoji | null> {
  const row = await prisma.articleReaction.findUnique({
    where: { articleId_memberId: { articleId, memberId } },
    select: { emoji: true },
  })
  if (!row) return null
  return isReactionEmoji(row.emoji) ? row.emoji : null
}

export interface ReactionToggleResult {
  /** The reaction state after this call (null if cleared). */
  myReaction: ReactionEmoji | null
  /** Fresh counts after the toggle. */
  counts: ReactionCounts
}

/**
 * Apply a reaction click:
 *
 *  - no existing row + emoji X       → insert X
 *  - existing row with X + click X   → delete (toggle off)
 *  - existing row with X + click Y   → update to Y
 *
 * Returns the post-state plus refreshed counts so the caller doesn't need a
 * separate GET. The cooldown check is the caller's job (we want it to run
 * *before* the upsert so accidental spam is rejected cheaply).
 */
export async function toggleReaction(
  articleId: number,
  memberId: string,
  emoji: ReactionEmoji
): Promise<ReactionToggleResult> {
  const existing = await prisma.articleReaction.findUnique({
    where: { articleId_memberId: { articleId, memberId } },
  })

  if (!existing) {
    await prisma.articleReaction.create({
      data: { articleId, memberId, emoji },
    })
  } else if (existing.emoji === emoji) {
    await prisma.articleReaction.delete({
      where: { articleId_memberId: { articleId, memberId } },
    })
  } else {
    await prisma.articleReaction.update({
      where: { articleId_memberId: { articleId, memberId } },
      data: { emoji, createdAt: new Date() },
    })
  }

  const [counts, myReaction] = await Promise.all([
    getReactionCounts(articleId),
    getMyReaction(articleId, memberId),
  ])
  return { counts, myReaction }
}

/**
 * Explicit clear (used by DELETE endpoint). No-op if the row doesn't exist.
 */
export async function clearReaction(
  articleId: number,
  memberId: string
): Promise<ReactionToggleResult> {
  await prisma.articleReaction
    .delete({ where: { articleId_memberId: { articleId, memberId } } })
    .catch(() => {
      /* row didn't exist — DELETE is idempotent */
    })
  const counts = await getReactionCounts(articleId)
  return { counts, myReaction: null }
}
