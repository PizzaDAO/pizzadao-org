/** Address -> lat/lng for admin-entered partner venues only (the partner supplies the address; Google ToS allows this). */
import type { LatLng } from './geo'

export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key || !address.trim()) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> }
    const loc = data.results?.[0]?.geometry?.location
    if (typeof loc?.lat === 'number' && typeof loc.lng === 'number') return { lat: loc.lat, lng: loc.lng }
    return null
  } catch {
    return null
  }
}
