/**
 * Save-time checks for Discord targets (plans/app-settings.md section 3, guard 4): a channel or
 * role id must exist in OUR server, or the save is rejected. When Discord cannot be asked, the
 * save is rejected too (a typo must never be stored because the check was skipped).
 */
import { getGuildChannels, getGuildRoles, type DiscordOpts } from '../discord-channels'
import { SETTINGS, type SettingKey } from './registry'

export class TargetError extends Error {}

// Discord channel types: 0 text, 2 voice, 5 announcement, 13 stage.
const TEXT_TYPES = new Set([0, 5])
const VOICE_TYPES = new Set([2, 13])

/** Throws TargetError when the value names something that is not in the server. No-op for other inputs. */
export async function checkTargets(key: SettingKey, value: unknown, opts: DiscordOpts = {}): Promise<void> {
  const input = SETTINGS[key].input
  if (input.type === 'channel') {
    const id = value as string
    if (!id) return // empty = use the default chain
    const channels = await getGuildChannels(opts)
    if (!channels) throw new TargetError('Could not check the channel against the server right now; try again')
    const found = channels.find((c) => c.id === id)
    if (!found) throw new TargetError(`${id} is not a channel in this server`)
    const ok = (input.kind === 'voice' ? VOICE_TYPES : TEXT_TYPES).has(found.type)
    if (!ok) throw new TargetError(`#${found.name} is not a ${input.kind === 'voice' ? 'voice' : 'text'} channel`)
    return
  }
  if (input.type === 'role' || input.type === 'roleList') {
    const ids = input.type === 'role' ? (value ? [value as string] : []) : (value as string[])
    if (input.type === 'roleList' && ids.length === 0) {
      throw new TargetError('Pick at least one role (use reset to go back to the built-in list)')
    }
    if (ids.length === 0) return
    if (new Set(ids).size !== ids.length) throw new TargetError('The same role is listed twice')
    const roles = await getGuildRoles(opts)
    if (!roles) throw new TargetError('Could not check the roles against the server right now; try again')
    const known = new Set(roles.map((r) => r.id))
    const missing = ids.filter((id) => !known.has(id))
    if (missing.length) throw new TargetError(`Not a role in this server: ${missing.join(', ')}`)
  }
}

/** Names for display in the admin page (best effort; missing names are simply left out). */
export async function targetNames(ids: string[], opts: DiscordOpts = {}): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (ids.length === 0) return out
  const [channels, roles] = await Promise.all([getGuildChannels(opts).catch(() => null), getGuildRoles(opts).catch(() => null)])
  for (const id of ids) {
    const c = channels?.find((x) => x.id === id)
    if (c) out[id] = `#${c.name}`
    const r = roles?.find((x) => x.id === id)
    if (r) out[id] = `@${r.name}`
  }
  return out
}
