/** Private R2 bucket (S3 API), same client shape as PizzaDAO/pizza-radio src/services/r2-sync.js. */
import { readFile } from 'node:fs/promises'
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Config } from './config.js'

export interface Uploader {
  put(key: string, file: string, contentType: string): Promise<number>
  /**
   * Delete every object under `prefix` that is NOT in `keep` (leftovers of earlier
   * attempts). Runs only after the new objects exist, so nothing is ever missing.
   * `prefix` must be a `calls/<sessionId>/` prefix. Needs list + delete on the token.
   */
  pruneExcept(prefix: string, keep: ReadonlySet<string>): Promise<number>
}

export function createR2Uploader(r2: Config['r2']): Uploader {
  const client = new S3Client({
    region: 'auto',
    endpoint: r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  })
  return {
    async put(key, file, contentType) {
      const body = await readFile(file)
      await client.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: body, ContentType: contentType }))
      return body.length
    },
    async pruneExcept(prefix, keep) {
      assertSessionPrefix(prefix)
      let deleted = 0
      let token: string | undefined
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: r2.bucket, Prefix: prefix, ContinuationToken: token }))
        const stale = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k && k.startsWith(prefix) && !keep.has(k))
        if (stale.length) {
          const res = await client.send(
            new DeleteObjectsCommand({ Bucket: r2.bucket, Delete: { Objects: stale.map((Key) => ({ Key })), Quiet: true } }),
          )
          if (res.Errors?.length) throw new Error(`R2 delete failed: ${res.Errors[0].Message}`)
          deleted += stale.length
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)
      return deleted
    },
  }
}

/** Same shape the app accepts for a session id; guards every prefix we list or delete. */
const SESSION_ID = /^[A-Za-z0-9_-]{6,80}$/
const SESSION_PREFIX = /^calls\/[A-Za-z0-9_-]{6,80}\/$/

export function assertSessionPrefix(prefix: string): void {
  if (!SESSION_PREFIX.test(prefix)) throw new Error(`refusing to touch R2 prefix "${prefix}"`)
}

export function sessionKeys(sessionId: string) {
  if (!SESSION_ID.test(sessionId)) throw new Error(`invalid session id "${sessionId}"`)
  return {
    prefix: `calls/${sessionId}/`,
    mix: `calls/${sessionId}/mix.m4a`,
    track: (userId: string) => `calls/${sessionId}/tracks/${userId}.ogg`,
  }
}
