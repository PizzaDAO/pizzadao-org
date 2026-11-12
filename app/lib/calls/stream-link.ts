/** Pure helper (no DB): the X / Twitter stream link rules, shared by the live view and /live. */

/**
 * An X / Twitter broadcast or status link, normalized to https (x.com / twitter.com and their www and
 * mobile hosts), or null. Anything else (other hosts, http, other paths, credentials, a port) is rejected.
 */
export function normalizeStreamLink(raw: string | null | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return null
  const broadcast = /^\/i\/broadcasts\/[A-Za-z0-9]+\/?$/.test(u.pathname)
  const status = /^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(u.pathname)
  if (!broadcast && !status) return null
  return `https://${u.hostname.toLowerCase()}${u.pathname}`
}
