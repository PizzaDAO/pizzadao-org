/** Parsing and validation of the partner form (pure). */
import { isValidLatLng } from './geo'

export interface PartnerInput {
  name: string
  address: string | null
  city: string | null
  countryCode: string | null
  lat: number | null
  lng: number | null
  website: string | null
  logoUrl: string | null
  logoConsent: boolean
  stampInk: string | null
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export function httpsUrlOrNull(v: unknown): string | null {
  const s = str(v, 500)
  if (!s) return null
  try {
    return new URL(s).protocol === 'https:' ? s : null
  } catch {
    return null
  }
}

/** Parse and validate a partner form. Returns an error string for the first problem. */
export function parsePartner(b: Record<string, unknown>, partial = false): { ok: true; value: Partial<PartnerInput> & { name?: string } } | { ok: false; error: string } {
  const out: Partial<PartnerInput> = {}
  if ('name' in b || !partial) {
    const name = str(b.name, 160)
    if (!name) return { ok: false, error: 'Name is required' }
    out.name = name
  }
  if ('address' in b) out.address = str(b.address, 300)
  if ('city' in b) out.city = str(b.city, 120)
  if ('countryCode' in b) {
    const cc = str(b.countryCode, 2)?.toUpperCase() ?? null
    if (cc && !/^[A-Z]{2}$/.test(cc)) return { ok: false, error: 'Country code must be 2 letters' }
    out.countryCode = cc
  }
  if ('lat' in b || 'lng' in b) {
    const lat = b.lat === '' || b.lat == null ? null : Number(b.lat)
    const lng = b.lng === '' || b.lng == null ? null : Number(b.lng)
    if (lat == null && lng == null) {
      out.lat = null
      out.lng = null
    } else if (lat == null || lng == null || !isValidLatLng({ lat, lng })) {
      return { ok: false, error: 'Latitude and longitude must both be valid numbers' }
    } else {
      out.lat = lat
      out.lng = lng
    }
  }
  if ('website' in b) out.website = httpsUrlOrNull(b.website)
  if ('logoUrl' in b) {
    out.logoUrl = httpsUrlOrNull(b.logoUrl)
    if (b.logoUrl && !out.logoUrl) return { ok: false, error: 'Logo URL must be https' }
  }
  if ('logoConsent' in b) out.logoConsent = b.logoConsent === true
  if ('stampInk' in b) {
    const ink = str(b.stampInk, 16)
    if (ink && !/^#[0-9a-fA-F]{6}$/.test(ink)) return { ok: false, error: 'Ink must be a #rrggbb colour' }
    out.stampInk = ink
  }
  // A logo is only kept with the partner's recorded consent.
  if (out.logoUrl && b.logoConsent !== true && !partial) return { ok: false, error: 'A logo needs the partner consent box ticked' }
  return { ok: true, value: out }
}
