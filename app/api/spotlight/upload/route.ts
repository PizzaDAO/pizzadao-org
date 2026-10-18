// app/api/spotlight/upload/route.ts
//
// Photo upload for a Mafia Spotlight submission (blackolive-55617). Members only.

import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { fileFromForm, uploadImageToBlob } from '@/app/lib/blob-image-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const POST_HANDLER = async (request: NextRequest) => {
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const limited = await enforceRateLimit(request, 'spotlight-upload')
  if (limited) return limited

  const formData = await request.formData()
  const result = await uploadImageToBlob(fileFromForm(formData), `spotlight/${auth.session.discordId}`)
  return NextResponse.json(result)
}

export const POST = withErrorHandling(POST_HANDLER)
