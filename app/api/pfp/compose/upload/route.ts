// POST /api/pfp/compose/upload (multipart, field "file"): a member's own base picture, stored in
// Blob under pfp-base/<memberId>/ (5 MB, PNG / JPEG / WebP / GIF by magic bytes). Members only.
import { memberPfpRoute } from '@/app/lib/pfp-assets/member-route'
import { fileFromForm, uploadImageToBlob } from '@/app/lib/blob-image-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = memberPfpRoute(
  async (req, { memberId }) => {
    const file = fileFromForm(await req.formData())
    const { url } = await uploadImageToBlob(file, `pfp-base/${memberId}`)
    return { url }
  },
  { multipart: true },
)
