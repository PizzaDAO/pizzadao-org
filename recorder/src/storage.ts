/** Private R2 bucket (S3 API), same client shape as PizzaDAO/pizza-radio src/services/r2-sync.js. */
import { readFile } from 'node:fs/promises'
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Config } from './config.js'

export interface Uploader {
  put(key: string, file: string, contentType: string): Promise<number>
  /** Delete every object whose key starts with `prefix` (needs list + delete on the token). */
  deletePrefix(prefix: string): Promise<number>
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
    async deletePrefix(prefix) {
      let deleted = 0
      let token: string | undefined
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: r2.bucket, Prefix: prefix, ContinuationToken: token }))
        const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k && k.startsWith(prefix))
        if (keys.length) {
          const res = await client.send(
            new DeleteObjectsCommand({ Bucket: r2.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
          )
          if (res.Errors?.length) throw new Error(`R2 delete failed: ${res.Errors[0].Message}`)
          deleted += keys.length
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)
      return deleted
    },
  }
}

export function sessionKeys(sessionId: string) {
  return {
    prefix: `calls/${sessionId}/`,
    mix: `calls/${sessionId}/mix.m4a`,
    track: (userId: string) => `calls/${sessionId}/tracks/${userId}.ogg`,
  }
}
