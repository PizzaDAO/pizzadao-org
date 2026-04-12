import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { randomBytes } from 'crypto'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { ARTICLE_AUTHOR_ROLE_IDS } from '@/app/ui/constants'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import {
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

// Allow-list of MIME types. Deliberately excludes SVG to avoid script injection.
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function sanitizeBase(name: string): string {
  // Strip extension, replace disallowed chars, truncate, fallback to 'image'
  const withoutExt = name.replace(/\.[^.]+$/, '')
  const cleaned = withoutExt.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  const truncated = cleaned.slice(0, 60)
  return truncated || 'image'
}

// POST /api/articles/upload - Upload an image for an article (role-gated)
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const canAuthor = await hasAnyRole(session.discordId, ARTICLE_AUTHOR_ROLE_IDS)
  if (!canAuthor) {
    throw new ForbiddenError('You do not have permission to upload article images')
  }

  const formData = await request.formData()
  const fileField = formData.get('file')

  if (!(fileField instanceof File)) {
    throw new ValidationError('Missing file field in upload', 'file')
  }

  const file = fileField

  // Server-side MIME allow-list (rechecks client)
  const ext = ALLOWED_MIME_TO_EXT[file.type]
  if (!ext) {
    throw new ValidationError(
      'Unsupported file type. Use PNG, JPEG, WebP, or GIF.',
      'file'
    )
  }

  // Size limits
  if (file.size === 0) {
    throw new ValidationError('File is empty', 'file')
  }
  if (file.size > MAX_BYTES) {
    throw new ValidationError('File too large. Max 5 MB.', 'file')
  }

  const safeBase = sanitizeBase(file.name || 'image')
  const timestamp = Date.now()
  const rand = randomBytes(3).toString('hex')
  const key = `articles/${session.discordId}/${timestamp}-${rand}-${safeBase}.${ext}`

  const blob = await put(key, file, {
    access: 'public',
    addRandomSuffix: false,
    contentType: file.type,
  })

  return NextResponse.json({
    url: blob.url,
    pathname: blob.pathname,
    filename: `${safeBase}.${ext}`,
  })
}

export const POST = withErrorHandling(POST_HANDLER)
