// Hosts we may fetch PFP images from (SSRF guard for the compose API) and accept as asset art.
import { isOwnBlobUrl } from '@/app/lib/blob-url'

/** Discord's avatar CDN. */
export function isDiscordCdnUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'cdn.discordapp.com' && !u.username && !u.password
  } catch {
    return false
  }
}

/** Remote hosts the server will fetch images from: our own Blob store and Discord's CDN. */
export function isAllowedFetchUrl(url: string): boolean {
  return isOwnBlobUrl(url) || isDiscordCdnUrl(url)
}
