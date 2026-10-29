/**
 * Where Discord posts go. A saved channel setting wins; otherwise the old behaviour: the env var,
 * else the channel found by name (resolveChannelId), else the built-in id. Saved ids were checked
 * against the server when they were saved; an unreadable setting falls back to the old chain.
 */
import { resolveChannelId, type DiscordOpts } from '../discord-channels'
import { getSetting } from './index'
import type { SettingKey } from './registry'

export type ChannelSettingKey = Extract<SettingKey, `discord.${string}ChannelId`>

/** The saved channel id for a setting, or '' when none is saved (or it cannot be read). */
export async function savedChannelId(key: ChannelSettingKey): Promise<string> {
  try {
    return await getSetting(key)
  } catch {
    return ''
  }
}

/** Saved setting, else env var, else the guild channel named `name`. */
export async function resolveConfiguredChannel(
  key: ChannelSettingKey,
  name: string,
  envName?: string,
  opts: DiscordOpts = {},
): Promise<string | null> {
  return (await savedChannelId(key)) || resolveChannelId(name, envName, opts)
}
