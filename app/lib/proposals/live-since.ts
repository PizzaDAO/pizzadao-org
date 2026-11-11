/**
 * The go-live moment (proposals.liveSince), written automatically the first time proposals are ON with an empty pilot
 * list, in production. Polls posted before it may use the Sesh grace window; polls posted after it never can
 * (legacy-sesh.ts). Called after the admin settings route saves proposals.enabled or proposals.pilotDiscordIds.
 * It never overwrites a value that is already there (an insert-only save), and it never throws.
 */
import { loadSettings } from '@/app/lib/settings'
import { saveSetting } from '@/app/lib/settings/store'
import { resolveToggle } from '@/app/lib/settings/toggles'

export const LIVE_SINCE_TRIGGER_KEYS: readonly string[] = ['proposals.enabled', 'proposals.pilotDiscordIds']

export async function maybeRecordLiveSince(actor: string, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    if (env.VERCEL_ENV !== 'production') return false
    const s = await loadSettings()
    if (s.readFailed) return false
    if (!resolveToggle('proposals.enabled', s, env)) return false
    if (s.get('proposals.pilotDiscordIds').length > 0) return false
    if (s.isSet('proposals.liveSince')) return false
    await saveSetting('proposals.liveSince', now.toISOString(), actor, { note: 'Recorded automatically at go-live', expectedUpdatedAt: null })
    return true
  } catch (e) {
    console.error('[proposals] could not record the go-live moment:', (e as Error)?.name)
    return false
  }
}
