/**
 * Whether the switch behind a catalog row is on. The catalog's `toggleKey` is a TOGGLES key (resolved
 * with the usual env kill switch and preview rules) or, failing that, a registered boolean or 0/1
 * setting such as `passport.enabled`. Unknown keys answer null (the row then stays hidden).
 */
import type { Settings } from '@/app/lib/settings'
import { isSettingKey } from '@/app/lib/settings/registry'
import { isToggleKey, resolveToggle } from '@/app/lib/settings/toggles'

export function settingIsOn(key: string, settings: Settings, env: Record<string, string | undefined> = process.env): boolean | null {
  if (isToggleKey(key)) return resolveToggle(key, settings, env)
  if (!isSettingKey(key)) return null
  // Previews share the production database: a saved ON must never reach them.
  if (env.VERCEL_ENV !== 'production') return false
  if (settings.readFailed || settings.invalidKeys.includes(key)) return false
  const v = settings.get(key) as unknown
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v > 0
  return null
}
