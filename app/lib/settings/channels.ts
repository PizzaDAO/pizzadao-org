/**
 * Where Discord posts go. A saved channel setting wins; otherwise the old behaviour: the env var,
 * else the channel found by name (resolveChannelId). Saved ids were checked against the server when
 * they were saved; an unreadable setting falls back to the old chain.
 *
 * Rename-proofing: whenever the chain has to find a channel by NAME (no saved id, no env id), the id
 * it found is saved into the channel setting (pinChannelId), so every later lookup goes by id and a
 * rename of the channel (#work -> something else) cannot silently stop the posts. The save is
 * insert-only (it never overwrites an admin's value), production-only (previews share the production
 * database, and a preview must not write production settings) and best effort (a failure to save
 * changes nothing: the lookup still returns the id it found). The audit log shows it as
 * `system:channel-pin`.
 */
import { resolveChannelId, type DiscordOpts } from '../discord-channels'
import { getSetting, loadSettings } from './index'
import type { SettingKey } from './registry'
import { saveSetting } from './store'

export type ChannelSettingKey = Extract<SettingKey, `discord.${string}ChannelId` | 'trivia.channelId'>

const SNOWFLAKE = /^\d{5,25}$/
export const CHANNEL_PIN_ACTOR = 'system:channel-pin'

/** The saved channel id for a setting, or '' when none is saved (or it cannot be read). */
export async function savedChannelId(key: ChannelSettingKey): Promise<string> {
  try {
    return await getSetting(key)
  } catch {
    return ''
  }
}

// One attempt per key per server instance and id: after a miss (a conflict, a Discord outage) the next
// cold instance tries again, and a warm one does not hammer the database on every post.
const pinAttempted = new Set<string>()

/** Test hook. */
export function resetChannelPins(): void {
  pinAttempted.clear()
}

/**
 * Save `id` as the channel setting `key` when it has no saved value. Never throws; returns whether a
 * row was written. No-op outside production, when the settings cannot be read, or when a value is
 * already saved (an admin's value always wins, even a stale one: it was checked when saved).
 */
export async function pinChannelId(key: ChannelSettingKey, id: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (env.VERCEL_ENV !== 'production' || !SNOWFLAKE.test(id)) return false
  const marker = `${key}:${id}`
  if (pinAttempted.has(marker)) return false
  pinAttempted.add(marker)
  try {
    const settings = await loadSettings()
    // A failed read must never be mistaken for "nothing saved": we would write over a value we could not see.
    if (settings.readFailed || settings.invalidKeys.includes(key) || settings.isSet(key)) return false
    await saveSetting(key, id, CHANNEL_PIN_ACTOR, {
      // Insert only: a concurrent save by an admin is a conflict (409), not an overwrite.
      expectedUpdatedAt: null,
      note: 'Saved by id after finding the channel by name, so renaming the channel cannot break it',
    })
    return true
  } catch (e) {
    // A conflict means someone saved a value first (fine). Anything else: try again from another instance.
    console.warn(`[settings] could not pin ${key} to ${id}: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

/** Saved setting, else env var, else the guild channel named `name` (whose id is then saved: pinChannelId). */
export async function resolveConfiguredChannel(
  key: ChannelSettingKey,
  name: string,
  envName?: string,
  opts: DiscordOpts = {},
): Promise<string | null> {
  const saved = await savedChannelId(key)
  if (saved) return saved
  const id = await resolveChannelId(name, envName, opts)
  if (id) {
    // An env id is already rename-proof, so only a lookup by name is pinned.
    const fromEnv = envName ? process.env[envName]?.trim() : ''
    if (!(fromEnv && SNOWFLAKE.test(fromEnv) && fromEnv === id)) await pinChannelId(key, id)
  }
  return id
}
