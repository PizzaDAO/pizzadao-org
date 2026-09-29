import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'
import { getArticleBySlug } from '@/app/lib/articles'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import {
  REACTION_GLYPH,
  REACTION_EMOJIS,
  type ReactionCounts,
  type ReactionEmoji,
  checkReactionRateLimit,
  clearReaction,
  emptyReactionCounts,
  getMyReaction,
  getReactionCounts,
  isReactionEmoji,
  toggleReaction,
} from '@/app/lib/article-reactions'

export const runtime = 'nodejs'

type Params = { params: Promise<{ slug: string }> }

/**
 * Project the internal { thumbs, heart, pizza } counts onto the task-spec
 * shape: `{ '👍': N, '❤️': N, '🍕': N }`. The UI consumes glyphs directly so
 * we don't make the client know our short codes.
 */
function countsAsGlyphs(counts: ReactionCounts): Record<string, number> {
  return {
    [REACTION_GLYPH.thumbs]: counts.thumbs,
    [REACTION_GLYPH.heart]: counts.heart,
    [REACTION_GLYPH.pizza]: counts.pizza,
  }
}

function myReactionAsGlyph(my: ReactionEmoji | null): string | null {
  if (!my) return null
  return REACTION_GLYPH[my]
}

/**
 * Resolve a glyph (👍 / ❤️ / 🍕) back to our internal short code. Falls
 * through for clients that already speak short codes ("thumbs", etc.).
 */
function normalizeEmojiInput(raw: unknown): ReactionEmoji {
  if (isReactionEmoji(raw)) return raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    for (const code of REACTION_EMOJIS) {
      if (REACTION_GLYPH[code] === trimmed) return code
    }
  }
  throw new ValidationError(
    'Reaction must be one of 👍, ❤️, 🍕',
    'emoji'
  )
}

/**
 * Reactions are only allowed on PUBLISHED articles. For DRAFT/ARCHIVED, we
 * mirror the comments behavior: 404 for non-collaborators so we don't leak
 * the article's existence; authors/collaborators/admins also can't react
 * (per spec — "Allow reactions on PUBLISHED articles only").
 *
 * Returns the article when access is allowed; throws NotFoundError otherwise.
 */
async function loadAccessibleArticle(slug: string, requireSession: boolean) {
  const article = await getArticleBySlug(slug)
  if (!article) throw new NotFoundError('Article')

  if (article.status === 'PUBLISHED') return article

  // Non-published: hide from anyone who can't view it.
  const session = await getSession()
  if (!session?.discordId) throw new NotFoundError('Article')

  const isAuthor = session.discordId === article.authorId
  const myMemberId = await fetchMemberIdByDiscordId(session.discordId).catch(() => null)
  const isCollaborator = myMemberId
    ? (article.collaboratorMemberIds ?? []).includes(myMemberId)
    : false
  const isAdmin =
    isAuthor || isCollaborator
      ? true
      : await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  if (!isAuthor && !isCollaborator && !isAdmin) {
    throw new NotFoundError('Article')
  }

  // We allow them to *see* zero counts, but mutations on non-published
  // articles get a ValidationError so the UI can show a friendly message.
  if (requireSession) {
    throw new ValidationError(
      'Reactions are only available on published articles',
      'status'
    )
  }
  return article
}

/**
 * GET /api/articles/[slug]/reactions
 * Public for PUBLISHED articles. Drafts: 404 unless viewer is author /
 * collaborator / admin (mirrors comments visibility).
 *
 * Response: `{ counts: { '👍': N, '❤️': N, '🍕': N }, myReaction }`
 */
const GET_HANDLER = async (_req: NextRequest, { params }: Params) => {
  const { slug } = await params
  const article = await loadAccessibleArticle(slug, false)

  const counts = article.status === 'PUBLISHED'
    ? await getReactionCounts(article.id)
    : emptyReactionCounts()

  const session = await getSession()
  const myReaction =
    session?.discordId && article.status === 'PUBLISHED'
      ? await getMyReaction(article.id, session.discordId)
      : null

  return NextResponse.json(
    {
      counts: countsAsGlyphs(counts),
      myReaction: myReactionAsGlyph(myReaction),
    },
    {
      // Per-viewer (myReaction) — must not be shared across users.
      headers: { 'Cache-Control': 'private, no-cache' },
    }
  )
}

/**
 * POST /api/articles/[slug]/reactions
 * Body: `{ emoji: '👍' | '❤️' | '🍕' }` (also accepts short codes).
 *
 * Toggle semantics:
 *  - clicking the same emoji you already have → clears your reaction
 *  - clicking a different emoji → switches
 *  - first reaction → inserts
 */
const POST_HANDLER = async (request: NextRequest, { params }: Params) => {
  const { slug } = await params
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()

  const article = await loadAccessibleArticle(slug, true)

  const json = await request.json().catch(() => ({}))
  const emoji = normalizeEmojiInput((json as { emoji?: unknown })?.emoji)

  await checkReactionRateLimit(article.id, session.discordId)
  const result = await toggleReaction(article.id, session.discordId, emoji)

  return NextResponse.json({
    counts: countsAsGlyphs(result.counts),
    myReaction: myReactionAsGlyph(result.myReaction),
  })
}

/**
 * DELETE /api/articles/[slug]/reactions
 * Removes the requester's reaction (idempotent). Same auth + visibility rules.
 */
const DELETE_HANDLER = async (_req: NextRequest, { params }: Params) => {
  const { slug } = await params
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()

  const article = await loadAccessibleArticle(slug, true)
  const result = await clearReaction(article.id, session.discordId)

  return NextResponse.json({
    counts: countsAsGlyphs(result.counts),
    myReaction: myReactionAsGlyph(result.myReaction),
  })
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
export const DELETE = withErrorHandling(DELETE_HANDLER)
