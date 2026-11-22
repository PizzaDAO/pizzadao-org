/**
 * Signed one-tap opt-out link for nearby-event invites, needing no login (used by the Telegram button, where
 * Discord's custom-id buttons do not exist). HMAC-SHA256 over the Discord id, domain-separated from the other
 * signed links (see reengage/unsub-sig.ts). The link never expires: an old message must still work. It can
 * only turn the invites OFF for the one member it was made for.
 */
import { SITE_URL } from '@/app/lib/site-url'
import { sameSig, signParts } from '@/app/lib/reengage/unsub-sig'

const DOMAIN = 'nearby-optout'

export function nearbyOptOutSig(discordId: string): string | null {
  return signParts(DOMAIN, discordId)
}

export function verifyNearbyOptOut(discordId: string | null | undefined, sig: string | null | undefined): boolean {
  if (!discordId || !sig || !/^\d{5,25}$/.test(discordId)) return false
  const want = nearbyOptOutSig(discordId)
  return !!want && sameSig(want, sig)
}

/** The page link (it shows a button; the POST behind it does the opt-out), or null without a signing secret. */
export function nearbyOptOutUrl(discordId: string, siteUrl: string = SITE_URL): string | null {
  const sig = nearbyOptOutSig(discordId)
  return sig ? `${siteUrl}/nearby-optout?d=${encodeURIComponent(discordId)}&sig=${encodeURIComponent(sig)}` : null
}
