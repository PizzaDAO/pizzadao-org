// POST /api/pfp/compose/upload (multipart, field "file"): a member's own base picture, stored in
// Blob under pfp-base/<memberId>/ (5 MB, PNG / JPEG / WebP / GIF by magic bytes, up to 4096 px a
// side). Members only, rate limited; only the latest few uploads are kept.
import { memberPfpRoute } from '@/app/lib/pfp-assets/member-route'
import { uploadMemberBase } from '@/app/lib/pfp-assets/upload-base'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = memberPfpRoute(async (req, { memberId }) => uploadMemberBase(await req.formData(), memberId), {
  multipart: true,
  rateLimit: 'pfp-upload',
})
