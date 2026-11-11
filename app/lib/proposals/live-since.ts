/**
 * The go-live moment (proposals.liveSince), written automatically the first time proposals are ON with an empty pilot
 * list, in production. Polls posted before it may use the Sesh grace window; polls posted after it never can
 * (legacy-sesh.ts). Called after the admin settings route saves proposals.enabled or proposals.pilotDiscordIds.
 * It never overwrites a value that is already there ('' counts as unset), and it never throws: a failure is logged and
 * returned as 'error' so the settings route can warn the admin.
 *
 * Not recorded: proposals switched on only through the PROPOSALS_ENABLED env var (no settings save happens, so nothing
 * calls this). Recording it on first observation in production was considered and left out: a read path that writes a
 * go-live moment could stamp it on a pilot or a misconfigured deploy. Save the switch in Settings, or set it by hand.
 */
import { loadSettings } from '@/app/lib/settings'
import { isLiveSet, pilotStateFrom } from './pilot-state'
import { saveSetting } from '@/app/lib/settings/store'
import { resolveToggle } from '@/app/lib/settings/toggles'

export const LIVE_SINCE_TRIGGER_KEYS: readonly string[] = ['proposals.enabled', 'proposals.pilotDiscordIds']

export type LiveSinceResult = 'recorded' | 'skipped' | 'error'

export async function maybeRecordLiveSince(actor: string, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<LiveSinceResult> {
  try {
    if (env.VERCEL_ENV !== 'production') return 'skipped'
    const s = await loadSettings()
    if (s.readFailed) return 'error'
    if (!resolveToggle('proposals.enabled', s, env)) return 'skipped'
    if (pilotStateFrom(s).running) return 'skipped'
    if (isLiveSet(s.get('proposals.liveSince'))) return 'skipped'
    // A row holding '' is "unset": overwrite it; with no row at all, insert-only so a concurrent save is a conflict.
    await saveSetting('proposals.liveSince', now.toISOString(), actor, {
      note: 'Recorded automatically at go-live',
      ...(s.isSet('proposals.liveSince') ? {} : { expectedUpdatedAt: null }),
    })
    return 'recorded'
  } catch (e) {
    console.error('[proposals] could not record the go-live moment:', (e as Error)?.name)
    return 'error'
  }
}
