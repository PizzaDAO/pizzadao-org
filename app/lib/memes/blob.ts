/**
 * Blob store credentials for the meme folder (bellpepper-80127).
 *
 * A Vercel Blob store is either public or private, never both. The folder needs both kinds of file
 * (waiting memes private, approved memes public). Each defaults to BLOB_READ_WRITE_TOKEN, as the rest
 * of the app does; when the project's store is only one kind, point the other at a second store with
 *   MEMES_PUBLIC_BLOB_TOKEN   (the public store: approved memes under memes/)
 *   MEMES_PRIVATE_BLOB_TOKEN  (the private store: waiting memes and hidden copies)
 * Never log either value.
 */
export function memesPublicToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MEMES_PUBLIC_BLOB_TOKEN?.trim() || undefined
}

export function memesPrivateToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.MEMES_PRIVATE_BLOB_TOKEN?.trim() || undefined
}

/** The token whose store hosts public memes (for URL checks): the dedicated one, else the default. */
export function memesPublicUrlToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return memesPublicToken(env) ?? env.BLOB_READ_WRITE_TOKEN
}
