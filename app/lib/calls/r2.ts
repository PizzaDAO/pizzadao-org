/**
 * Private Cloudflare R2 bucket for call audio (S3 API). Audio is never public and
 * is kept indefinitely: reviewers get short-lived signed GET URLs. The app only
 * ever READS from R2 (its token needs read only); the recorder worker owns every
 * write and delete. Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME (same names as PizzaDAO/pizza-radio).
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
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

/** A signed, expiring GET URL for one object. */
export async function signedAudioUrl(key: string, ttlSec = SIGNED_URL_TTL_SEC): Promise<string> {
  const { client, bucket } = r2()
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttlSec })
}

/** Download one object (read only). Throws when it is missing or larger than maxBytes. */
export async function getObjectBytes(key: string, maxBytes = 200 * 1024 * 1024): Promise<Uint8Array> {
  const { client, bucket } = r2()
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (typeof res.ContentLength === 'number' && res.ContentLength > maxBytes) throw new Error(`Object is ${res.ContentLength} bytes (limit ${maxBytes})`)
  if (!res.Body) throw new Error('Empty R2 object')
  return res.Body.transformToByteArray()
}
