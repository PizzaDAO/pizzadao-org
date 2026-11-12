/**
 * Private Cloudflare R2 bucket for call audio (S3 API). Audio is never public and
 * is kept indefinitely: reviewers get short-lived signed GET URLs. The app only
 * ever READS from R2 (its token needs read only); the recorder worker owns every
 * write and delete. Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME (same names as PizzaDAO/pizza-radio).
 */
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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

/** Whether an object exists (read only). */
export async function objectExists(key: string): Promise<boolean> {
  const { client, bucket } = r2()
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false
    throw err
  }
}

let writeCached: { client: S3Client; bucket: string } | null = null

/**
 * Write one object under the call-updates/ prefix (the spoken call updates cache). Every other prefix
 * is owned by the recorder, so this refuses it. Uses R2_WRITE_ACCESS_KEY_ID / R2_WRITE_SECRET_ACCESS_KEY
 * (the app's normal R2 token is read only), falling back to the normal keys.
 */
export async function putCallUpdatesObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  if (!key.startsWith('call-updates/') || key.includes('..')) throw new Error('R2 writes are limited to call-updates/')
  if (!writeCached) {
    const endpoint = process.env.R2_ENDPOINT
    const bucket = process.env.R2_BUCKET_NAME
    const id = process.env.R2_WRITE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID
    const secret = process.env.R2_WRITE_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY
    if (!endpoint || !bucket || !id || !secret) throw new Error('R2 write credentials are not configured')
    writeCached = {
      client: new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId: id, secretAccessKey: secret } }),
      bucket,
    }
  }
  await writeCached.client.send(new PutObjectCommand({ Bucket: writeCached.bucket, Key: key, Body: body, ContentType: contentType }))
}
