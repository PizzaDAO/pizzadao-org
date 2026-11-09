// Hosts we may fetch PFP images from (SSRF guard for the compose API) and accept as asset art.

const BLOB_SUFFIX = '.public.blob.vercel-storage.com'

/** An https URL on a Vercel Blob public host (one label before the suffix). */
export function isBlobUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      u.hostname.endsWith(BLOB_SUFFIX) &&
      u.hostname.length > BLOB_SUFFIX.length &&
      !u.hostname.slice(0, -BLOB_SUFFIX.length).includes('.') &&
      !u.username &&
      !u.password
    )
  } catch {
    return false
  }
}

/** Discord's avatar CDN. */
export function isDiscordCdnUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'cdn.discordapp.com' && !u.username && !u.password
  } catch {
    return false
  }
}

/** Remote hosts the server will fetch images from. Everything else is refused. */
export function isAllowedFetchUrl(url: string): boolean {
  return isBlobUrl(url) || isDiscordCdnUrl(url)
}
