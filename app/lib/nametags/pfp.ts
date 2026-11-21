/** PFP urls as absolute https urls (rsv.pizza prints them from another origin). Never throws. */
import { resolvePfpUrlsAsync } from '@/app/lib/pfp'
import { DEFAULT_PFP_URL } from '@/app/lib/pfp-default'
import { SITE_URL } from '@/app/lib/site-url'

export function absoluteUrl(u: string, base: string = SITE_URL): string {
  if (/^https?:\/\//i.test(u)) return u
  return `${base.replace(/\/$/, '')}${u.startsWith('/') ? '' : '/'}${u}`
}

export async function resolvePfpsAbsolute(memberIds: string[]): Promise<Record<string, string>> {
  let resolved: Record<string, string> = {}
  try {
    resolved = await resolvePfpUrlsAsync(memberIds)
  } catch {
    // the dough ball stands
  }
  const out: Record<string, string> = {}
  for (const id of memberIds) out[id] = absoluteUrl(resolved[id] || DEFAULT_PFP_URL)
  return out
}
