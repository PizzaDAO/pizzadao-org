// GET /api/pfp/<memberId>/download -> the member's saved (composed) PFP as a 1024x1024 PNG attachment.
// The image lives on another origin, so `<a download>` cannot save it; this streams it from our own.
// Public (PFPs are shown publicly on profiles), rate limited per IP. The source is only ever the URL
// we stored for the member, fetched from the allowed image hosts. A member with no saved PFP gets a
// 404 (never the default dough ball). HEAD answers the same 200/404 without fetching the image, so
// the UI can decide whether to show the button.
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { prisma } from '@/app/lib/db'
import { fetchImageBytes, MAX_PIXELS } from '@/app/lib/pfp-assets/compose'
import { isAllowedFetchUrl } from '@/app/lib/pfp-assets/hosts'
import { enforceRateLimit } from '@/app/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIZE = 1024
const SAFE_ID = /^[A-Za-z0-9_-]{1,32}$/
const HEADERS = { 'Cache-Control': 'private, no-store' }

async function savedUrl(memberId: string): Promise<string | null> {
  if (!SAFE_ID.test(memberId)) return null
  const row = await prisma.memberPfp.findUnique({ where: { memberId }, select: { composedUrl: true } })
  return row?.composedUrl || null
}

const notFound = () => NextResponse.json({ error: 'No saved PFP' }, { status: 404, headers: HEADERS })

export async function HEAD(req: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const limited = await enforceRateLimit(req, 'pfp-download-check')
  if (limited) return limited
  const url = await savedUrl((await params).memberId).catch(() => null)
  return new NextResponse(null, { status: url && isAllowedFetchUrl(url) ? 200 : 404, headers: HEADERS })
}

export async function GET(req: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const limited = await enforceRateLimit(req, 'pfp-download')
  if (limited) return limited
  try {
    const memberId = (await params).memberId
    const url = await savedUrl(memberId)
    if (!url || !isAllowedFetchUrl(url)) return notFound()
    const bytes = await fetchImageBytes(url)
    // The composed image is already square; this only re-encodes it as a PNG (Discord-friendly).
    const png = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer()
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        ...HEADERS,
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
        'Content-Disposition': 'attachment; filename="pizzadao-pfp.png"',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Could not load the picture' }, { status: 502, headers: HEADERS })
  }
}
