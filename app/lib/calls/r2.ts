/**
 * Private Cloudflare R2 bucket for call audio (S3 API). Audio is never public:
 * reviewers get short-lived signed GET URLs, and the retention sweep deletes
 * objects. Env: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_BUCKET_NAME (same names as PizzaDAO/pizza-radio).
 */
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
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

/** Every object of one recording lives under this prefix (also catches orphans from failed attempts). */
export function recordingPrefix(sessionId: string): string {
  return `calls/${sessionId}/`
}

/**
 * Delete everything under `calls/<sessionId>/` (list + delete), not just the keys
 * the DB knows about: a worker retry can leave tracks the ingest never reported.
 * Returns how many objects were deleted.
 */
export async function deleteRecordingPrefix(sessionId: string): Promise<number> {
  const { client, bucket } = r2()
  const prefix = recordingPrefix(sessionId)
  let deleted = 0
  let token: string | undefined
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k && k.startsWith(prefix))
    if (keys.length) {
      const res = await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
      )
      if (res.Errors?.length) throw new Error(`R2 delete failed for ${res.Errors.length} object(s): ${res.Errors[0].Message}`)
      deleted += keys.length
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return deleted
}
