// app/api/memes/[id]/file/route.ts
//
// Streams a meme that is not public (waiting or hidden) to its uploader or to a capo/DPR. Everyone
// else, and any meme with no private file, gets a 404. The content type is whatever was sniffed at
// upload (an image type, never SVG or HTML) and the response is never cached or sniffed.
import { NextRequest, NextResponse } from 'next/server'
import { json } from '@/app/lib/admin-guard'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { isMemeReviewer, requireMemeMember } from '@/app/lib/memes/access'
import { privateFileFor } from '@/app/lib/memes/service'
import { readPrivate } from '@/app/lib/private-blob-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GET_HANDLER = async (_request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const auth = await requireMemeMember()
  if (!auth.ok) return auth.response
  const { id } = await ctx.params
  const meme = await privateFileFor(id)
  const notFound = () => json({ error: 'Not found' }, 404)
  if (!meme || !meme.privatePath || (meme.status !== 'PENDING' && meme.status !== 'HIDDEN')) return notFound()
  if (meme.uploaderId !== auth.session.discordId && !(await isMemeReviewer(auth.session.discordId))) return notFound()

  const file = await readPrivate(meme.privatePath)
  if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.contentType)) return notFound()
  return new NextResponse(file.stream, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}

export const GET = withErrorHandling(GET_HANDLER)
