// POST /api/admin/shop/upload (multipart, field "file"): upload a shop item
// image to Vercel Blob with the same helper as article images (5 MB, PNG /
// JPEG / WebP / GIF by magic bytes). Returns { url }. Shop admins only.
import { shopAdminRoute } from '@/app/lib/shop-admin-route'
import { fileFromForm, uploadImageToBlob } from '@/app/lib/blob-image-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = shopAdminRoute(async (req, session) => {
  const file = fileFromForm(await req.formData())
  return uploadImageToBlob(file, `shop/${session.discordId}`)
})
