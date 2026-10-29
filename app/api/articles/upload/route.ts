import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { articleAuthorRoleIds } from '@/app/lib/settings/roles'
import { fileFromForm, uploadImageToBlob } from '@/app/lib/blob-image-upload'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ForbiddenError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/articles/upload - Upload an image for an article (role-gated)
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const canAuthor = await hasAnyRole(session.discordId, await articleAuthorRoleIds())
  if (!canAuthor) {
    throw new ForbiddenError('You do not have permission to upload article images')
  }

  const file = fileFromForm(await request.formData())
  // Size and real image type (magic bytes; PNG/JPEG/GIF/WebP, no SVG) are
  // checked in uploadImageToBlob.
  const uploaded = await uploadImageToBlob(file, `articles/${session.discordId}`)
  return NextResponse.json(uploaded)
}

export const POST = withErrorHandling(POST_HANDLER)
