import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  REACTION_GLYPH,
  emptyReactionCounts,
  isReactionEmoji,
  toggleReaction,
  validateReactionEmoji,
  checkReactionRateLimit,
  clearReaction,
} from './article-reactions'
import { prisma } from './db'

vi.mock('./db')

const ARTICLE_ID = 7
const MEMBER_ID = 'discord:123'

function mockGroupBy(counts: Partial<Record<string, number>>) {
  const rows = Object.entries(counts).map(([emoji, n]) => ({
    emoji,
    _count: { emoji: n },
  }))
  ;(prisma.articleReaction.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue(rows)
}

describe('article-reactions: validation', () => {
  it('isReactionEmoji recognises the three short codes', () => {
    expect(isReactionEmoji('thumbs')).toBe(true)
    expect(isReactionEmoji('heart')).toBe(true)
    expect(isReactionEmoji('pizza')).toBe(true)
    expect(isReactionEmoji('fire')).toBe(false)
    expect(isReactionEmoji(null)).toBe(false)
  })

  it('validateReactionEmoji throws on bad input', () => {
    expect(() => validateReactionEmoji('fire')).toThrow(/Reaction must be/)
    expect(() => validateReactionEmoji(null)).toThrow()
    expect(validateReactionEmoji('pizza')).toBe('pizza')
  })

  it('REACTION_GLYPH maps codes to the three task-spec glyphs', () => {
    expect(REACTION_GLYPH.thumbs).toBe('👍')
    expect(REACTION_GLYPH.heart).toBe('❤️')
    expect(REACTION_GLYPH.pizza).toBe('🍕')
  })
})

describe('toggleReaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts when the member has no existing reaction', async () => {
    ;(prisma.articleReaction.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ select }: { select?: Record<string, true> }) => {
        // First call (toggle path): no row exists
        if (!select) return null
        // Second call (getMyReaction): post-create row
        if (select?.emoji) return { emoji: 'thumbs' }
        return null
      }
    )
    ;(prisma.articleReaction.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1,
      articleId: ARTICLE_ID,
      memberId: MEMBER_ID,
      emoji: 'thumbs',
    })
    mockGroupBy({ thumbs: 1 })

    const res = await toggleReaction(ARTICLE_ID, MEMBER_ID, 'thumbs')

    expect(prisma.articleReaction.create).toHaveBeenCalledWith({
      data: { articleId: ARTICLE_ID, memberId: MEMBER_ID, emoji: 'thumbs' },
    })
    expect(prisma.articleReaction.delete).not.toHaveBeenCalled()
    expect(prisma.articleReaction.update).not.toHaveBeenCalled()
    expect(res.myReaction).toBe('thumbs')
    expect(res.counts).toEqual({ thumbs: 1, heart: 0, pizza: 0 })
  })

  it('clears the row when the member clicks the same emoji again (toggle off)', async () => {
    ;(prisma.articleReaction.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ select }: { select?: Record<string, true> }) => {
        if (!select) return { id: 1, articleId: ARTICLE_ID, memberId: MEMBER_ID, emoji: 'heart' }
        if (select?.emoji) return null // post-delete
        return null
      }
    )
    ;(prisma.articleReaction.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})
    mockGroupBy({})

    const res = await toggleReaction(ARTICLE_ID, MEMBER_ID, 'heart')

    expect(prisma.articleReaction.delete).toHaveBeenCalledWith({
      where: { articleId_memberId: { articleId: ARTICLE_ID, memberId: MEMBER_ID } },
    })
    expect(prisma.articleReaction.create).not.toHaveBeenCalled()
    expect(prisma.articleReaction.update).not.toHaveBeenCalled()
    expect(res.myReaction).toBeNull()
    expect(res.counts).toEqual(emptyReactionCounts())
  })

  it('updates in place when the member clicks a different emoji (switch)', async () => {
    ;(prisma.articleReaction.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ select }: { select?: Record<string, true> }) => {
        if (!select) return { id: 1, articleId: ARTICLE_ID, memberId: MEMBER_ID, emoji: 'thumbs' }
        if (select?.emoji) return { emoji: 'pizza' }
        return null
      }
    )
    ;(prisma.articleReaction.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    mockGroupBy({ pizza: 1 })

    const res = await toggleReaction(ARTICLE_ID, MEMBER_ID, 'pizza')

    expect(prisma.articleReaction.update).toHaveBeenCalledWith({
      where: { articleId_memberId: { articleId: ARTICLE_ID, memberId: MEMBER_ID } },
      data: expect.objectContaining({ emoji: 'pizza' }),
    })
    expect(prisma.articleReaction.create).not.toHaveBeenCalled()
    expect(prisma.articleReaction.delete).not.toHaveBeenCalled()
    expect(res.myReaction).toBe('pizza')
    expect(res.counts).toEqual({ thumbs: 0, heart: 0, pizza: 1 })
  })
})

describe('clearReaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the row and returns null + zero counts', async () => {
    ;(prisma.articleReaction.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})
    mockGroupBy({})

    const res = await clearReaction(ARTICLE_ID, MEMBER_ID)
    expect(prisma.articleReaction.delete).toHaveBeenCalledWith({
      where: { articleId_memberId: { articleId: ARTICLE_ID, memberId: MEMBER_ID } },
    })
    expect(res).toEqual({ myReaction: null, counts: emptyReactionCounts() })
  })

  it('is idempotent: swallows "row not found" from Prisma', async () => {
    ;(prisma.articleReaction.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Record to delete does not exist')
    )
    mockGroupBy({})
    await expect(clearReaction(ARTICLE_ID, MEMBER_ID)).resolves.toEqual({
      myReaction: null,
      counts: emptyReactionCounts(),
    })
  })
})

describe('checkReactionRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows a request when no prior reaction exists', async () => {
    ;(prisma.articleReaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(checkReactionRateLimit(ARTICLE_ID, MEMBER_ID)).resolves.toBeUndefined()
  })

  it('allows a request when the cooldown has elapsed', async () => {
    ;(prisma.articleReaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      createdAt: new Date(Date.now() - 60_000),
    })
    await expect(checkReactionRateLimit(ARTICLE_ID, MEMBER_ID)).resolves.toBeUndefined()
  })

  it('rejects within the cooldown window', async () => {
    ;(prisma.articleReaction.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      createdAt: new Date(Date.now() - 5_000),
    })
    await expect(checkReactionRateLimit(ARTICLE_ID, MEMBER_ID)).rejects.toThrow(
      /reacting too fast/
    )
  })
})
