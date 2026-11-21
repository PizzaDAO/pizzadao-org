// app/api/memes/upload/route.ts
//
// POST multipart: file, category (benny | pizzadao), optional caption and tags, and the rights checkbox.
// Gates, in order: session, feature on, same origin, IP rate limit, rights confirmed, upload eligibility
// (completed level, not disavowed), then the per-member caps in the service (counted in the database).
import { NextRequest } from 'next/server'
import { json, rejectCrossOrigin } from '@/app/lib/admin-guard'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import { requireMemeMember, uploadEligibility } from '@/app/lib/memes/access'
import { parseCategory } from '@/app/lib/memes/rules'
import { createMeme } from '@/app/lib/memes/service'
import { PRIVATE_UPLOAD_MAX_BYTES } from '@/app/lib/private-blob-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const POST_HANDLER = async (request: NextRequest) => {
  const auth = await requireMemeMember()
  if (!auth.ok) return auth.response
  const unsafe = rejectCrossOrigin(request)
  if (unsafe) return unsafe
  const limited = await enforceRateLimit(request, 'memes-upload')
  if (limited) return limited

  // Refuse an oversized body before reading it into memory.
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > PRIVATE_UPLOAD_MAX_BYTES + 64 * 1024) return json({ error: 'File too large' }, 413)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'Invalid upload' }, 400)
  }
  const file = form.get('file')
  if (!(file instanceof File)) return json({ error: 'Missing file' }, 400)
  const category = parseCategory(form.get('category'))
  if (!category) return json({ error: 'Pick Benny or PizzaDAO' }, 400)
  if (form.get('rights') !== 'true') return json({ error: 'Confirm the meme is PizzaDAO-related and yours to share' }, 400)

  const eligibility = await uploadEligibility(auth.session.discordId)
  if (!eligibility.ok) {
    return json({ error: eligibility.reason === 'level' ? `Uploading unlocks at level ${eligibility.minLevel}` : 'Uploading is not available for your account', reason: eligibility.reason, minLevel: eligibility.minLevel }, 403)
  }

  const result = await createMeme({
    uploaderId: auth.session.discordId,
    bytes: new Uint8Array(await file.arrayBuffer()),
    category,
    caption: form.get('caption'),
    tags: form.get('tags'),
  })
  if (!result.ok) return json({ error: result.error }, result.status)
  return json(result.value, 201)
}

export const POST = withErrorHandling(POST_HANDLER)
