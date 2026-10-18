/** Private R2 bucket (S3 API), same client shape as PizzaDAO/pizza-radio src/services/r2-sync.js. */
import { readFile } from 'node:fs/promises'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { Config } from './config.js'

export interface Uploader {
  put(key: string, file: string, contentType: string): Promise<number>
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
  }
}

export function sessionKeys(sessionId: string) {
  return {
    mix: `calls/${sessionId}/mix.m4a`,
    track: (userId: string) => `calls/${sessionId}/tracks/${userId}.ogg`,
  }
}
