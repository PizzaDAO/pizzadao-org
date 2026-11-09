// POST /api/admin/pfp-assets/upload (multipart: file, kind?): validated art upload to Blob.
import { pfpAdminRoute } from '@/app/lib/pfp-assets/admin-route'
import { uploadAssetArt } from '@/app/lib/pfp-assets/upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = pfpAdminRoute(async (req, session) => uploadAssetArt(await req.formData(), session.discordId), {
  multipart: true,
})
