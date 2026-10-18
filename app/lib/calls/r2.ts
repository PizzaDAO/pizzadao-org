/**
 * Private Cloudflare R2 bucket for call audio (S3 API). Audio is never public:
 * reviewers get short-lived signed GET URLs, and the retention sweep deletes
 * objects. Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME (same names as PizzaDAO/pizza-radio).
 */
import { DeleteObjectsCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/** Signed URLs live this long (seconds). */
export const SIGNED_URL_TTL_SEC = 15 * 60

let cached: { client: S3Client; bucket: string } | null = null

function r2(): { client: S3Client; bucket: string } {
  if (cached) return cached
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error('R2 is not configured (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)')
  }
  cached = {
    client: new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    }),
    bucket: R2_BUCKET_NAME,
  }
  return cached
}

export function r2Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME)
}

/** A signed, expiring GET URL for one object. */
export async function signedAudioUrl(key: string, ttlSec = SIGNED_URL_TTL_SEC): Promise<string> {
  const { client, bucket } = r2()
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttlSec })
}

/** Delete objects (up to 1000 per request). Missing keys are not an error. */
export async function deleteAudioObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const { client, bucket } = r2()
  for (let i = 0; i < keys.length; i += 1000) {
    const res = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      }),
    )
    if (res.Errors?.length) throw new Error(`R2 delete failed for ${res.Errors.length} object(s): ${res.Errors[0].Message}`)
  }
}
