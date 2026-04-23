import { prisma } from './db'
import { ValidationError, NotFoundError } from './errors/api-errors'

export type ArticleStatusType = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

/**
 * Extract the URL of the first Markdown image from content.
 * Looks for ![alt](url) patterns and returns the URL, or null if none found.
 */
export function extractFirstImage(markdown: string): string | null {
  const match = markdown.match(/!\[[^\]]*\]\(([^)\s]+)/)
  return match ? match[1] : null
}

export interface ArticleInput {
  title: string
  content: string
  excerpt?: string | null
  coverImage?: string | null
  tags?: string[]
}

/**
 * Generate a URL-safe slug from a title.
 * Handles collisions by appending a numeric suffix (-2, -3, ...).
 */
export async function generateSlug(title: string, excludeId?: number): Promise<string> {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // remove special chars
    .replace(/\s+/g, '-')          // spaces to hyphens
    .replace(/-+/g, '-')           // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')       // trim leading/trailing hyphens
    .slice(0, 80) || 'article'

  let slug = base
  let suffix = 1

  // Loop until we find an unused slug
  // (bounded to avoid infinite loops on pathological inputs)
  for (let i = 0; i < 1000; i++) {
    const existing = await prisma.article.findUnique({ where: { slug } })
    if (!existing || existing.id === excludeId) return slug
    suffix += 1
    slug = `${base}-${suffix}`
  }

  // Extremely unlikely fallback
  return `${base}-${Date.now()}`
}

/**
 * Normalize tag array: trim, lowercase, dedupe, drop empties, cap length.
 */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const t = raw.trim().toLowerCase().slice(0, 32)
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= 10) break
  }
  return out
}

function validateInput(data: Partial<ArticleInput>) {
  if (data.title !== undefined) {
    if (typeof data.title !== 'string' || !data.title.trim()) {
      throw new ValidationError('Title is required')
    }
    if (data.title.length > 200) {
      throw new ValidationError('Title must be 200 characters or fewer')
    }
  }
  if (data.content !== undefined) {
    if (typeof data.content !== 'string' || !data.content.trim()) {
      throw new ValidationError('Content is required')
    }
    if (data.content.length > 100_000) {
      throw new ValidationError('Content is too long (max 100,000 characters)')
    }
  }
  if (data.excerpt != null) {
    if (typeof data.excerpt !== 'string') {
      throw new ValidationError('Excerpt must be a string')
    }
    if (data.excerpt.length > 500) {
      throw new ValidationError('Excerpt must be 500 characters or fewer')
    }
  }
  if (data.coverImage != null) {
    if (typeof data.coverImage !== 'string') {
      throw new ValidationError('Cover image must be a URL string')
    }
    if (data.coverImage.length > 0) {
      try {
        const u = new URL(data.coverImage)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          throw new Error('bad protocol')
        }
      } catch {
        throw new ValidationError('Cover image must be a valid http(s) URL')
      }
    }
  }
}

export async function createArticle(
  authorId: string,
  authorName: string | null,
  data: ArticleInput
) {
  validateInput(data)

  const slug = await generateSlug(data.title)
  const tags = normalizeTags(data.tags)

  return prisma.article.create({
    data: {
      slug,
      title: data.title.trim(),
      excerpt: data.excerpt?.trim() || null,
      content: data.content,
      coverImage: data.coverImage?.trim() || null,
      authorId,
      authorName,
      status: 'DRAFT',
      tags,
    },
  })
}

export async function getArticleBySlug(slug: string) {
  return prisma.article.findUnique({ where: { slug } })
}

export async function getArticleById(id: number) {
  return prisma.article.findUnique({ where: { id } })
}

export interface UpdateArticleData extends Partial<ArticleInput> {
  status?: ArticleStatusType
}

/**
 * Update an article. If the title changes the slug is regenerated.
 * If the status transitions to PUBLISHED for the first time, publishedAt is set.
 */
export async function updateArticle(slug: string, data: UpdateArticleData) {
  const existing = await prisma.article.findUnique({ where: { slug } })
  if (!existing) throw new NotFoundError('Article')

  validateInput(data)

  const updates: Record<string, unknown> = {}

  if (data.title !== undefined && data.title.trim() !== existing.title) {
    updates.title = data.title.trim()
    // Only regenerate slug if the article has never been published
    // to avoid breaking existing links. For published articles we keep the slug.
    if (existing.status === 'DRAFT') {
      updates.slug = await generateSlug(data.title, existing.id)
    }
  }

  if (data.content !== undefined) updates.content = data.content
  if (data.excerpt !== undefined) updates.excerpt = data.excerpt?.trim() || null
  if (data.coverImage !== undefined) updates.coverImage = data.coverImage?.trim() || null
  if (data.tags !== undefined) updates.tags = normalizeTags(data.tags)

  if (data.status !== undefined) {
    updates.status = data.status
    if (data.status === 'PUBLISHED' && !existing.publishedAt) {
      updates.publishedAt = new Date()
    }
  }

  return prisma.article.update({
    where: { id: existing.id },
    data: updates,
  })
}

/**
 * Soft-delete: mark article as ARCHIVED. Keeps row for audit trail.
 */
export async function archiveArticle(slug: string) {
  const existing = await prisma.article.findUnique({ where: { slug } })
  if (!existing) throw new NotFoundError('Article')
  return prisma.article.update({
    where: { id: existing.id },
    data: { status: 'ARCHIVED' },
  })
}

export interface GetArticlesOptions {
  page?: number
  limit?: number
  tag?: string
  search?: string
}

/**
 * Public paginated list of published articles.
 */
export async function getPublishedArticles(opts: GetArticlesOptions = {}) {
  const page = Math.max(1, opts.page ?? 1)
  const limit = Math.min(50, Math.max(1, opts.limit ?? 12))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = { status: 'PUBLISHED' }

  if (opts.tag) {
    where.tags = { has: opts.tag.toLowerCase() }
  }

  if (opts.search && opts.search.trim()) {
    const term = opts.search.trim()
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { excerpt: { contains: term, mode: 'insensitive' } },
      { content: { contains: term, mode: 'insensitive' } },
    ]
  }

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.article.count({ where }),
  ])

  return {
    articles,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  }
}

/**
 * Get all drafts for a specific author.
 */
export async function getUserDrafts(authorId: string) {
  return prisma.article.findMany({
    where: { authorId, status: 'DRAFT' },
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Get all articles by author (any status) - used by the edit UI.
 */
export async function getArticlesByAuthor(authorId: string) {
  return prisma.article.findMany({
    where: { authorId },
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Get draft articles where the given memberId is a collaborator
 * (but not the author, to avoid duplicates).
 */
export async function getCollaboratorDrafts(memberId: string, excludeAuthorId?: string) {
  return prisma.article.findMany({
    where: {
      collaboratorMemberIds: { has: memberId },
      status: 'DRAFT',
      ...(excludeAuthorId ? { authorId: { not: excludeAuthorId } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  })
}
