/**
 * Embed builders for the slash-command replies, in UnbelievaBoat's style:
 *
 *   author       the invoking member (display name + avatar)
 *   color        green = success, red = error / refusal, amber = cooldown / waiting
 *   description  "✅ Headline" (or ❌ / ⏳), a blank line, then the body
 *   lists        numbered "1 - <@&role> 🍕 420"
 *
 * Mentions inside an embed render (role pills, user names) but never ping, so
 * only a plain `content` mention can notify someone, and only when the reply's
 * allowed_mentions lists that user.
 */

export const EMBED_COLOR = { success: 0x2ecc71, error: 0xe74c3c, cooldown: 0xf39c12 } as const
export type Tone = keyof typeof EMBED_COLOR
const ICON: Record<Tone, string> = { success: '✅', error: '❌', cooldown: '⏳' }

export const EMBED_DESCRIPTION_LIMIT = 4096

export interface EmbedAuthor {
  name: string
  icon_url: string
}

export interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface Embed {
  color: number
  description: string
  author?: EmbedAuthor
  fields?: EmbedField[]
  /** A large image (e.g. an evidence screenshot on a mission review card). */
  image?: { url: string }
  /** A small image top-right (e.g. a proof link preview). */
  thumbnail?: { url: string }
  footer?: { text: string }
}

/** The parts of an interaction's invoking member that the author line needs. */
export interface InvokerLike {
  guildId?: string
  user?: { id: string; username?: string; global_name?: string | null; avatar?: string | null }
  nick?: string | null
  /** Guild-specific avatar hash (member.avatar). */
  avatar?: string | null
}

const CDN = 'https://cdn.discordapp.com'
const HASH = /^(a_)?[0-9a-f]{16,64}$/i
const SNOWFLAKE = /^\d{5,25}$/

const ext = (hash: string) => (hash.startsWith('a_') ? 'gif' : 'png')

/**
 * CDN avatar: the guild avatar, else the user avatar, else Discord's default
 * avatar (index (id >> 22) % 6 for the new username system).
 */
export function avatarUrl(m: InvokerLike): string {
  const id = m.user?.id ?? ''
  if (SNOWFLAKE.test(id)) {
    if (m.avatar && HASH.test(m.avatar) && m.guildId && SNOWFLAKE.test(m.guildId)) {
      return `${CDN}/guilds/${m.guildId}/users/${id}/avatars/${m.avatar}.${ext(m.avatar)}`
    }
    const userAvatar = m.user?.avatar
    if (userAvatar && HASH.test(userAvatar)) return `${CDN}/avatars/${id}/${userAvatar}.${ext(userAvatar)}`
    return `${CDN}/embed/avatars/${Number((BigInt(id) >> BigInt(22)) % BigInt(6))}.png`
  }
  return `${CDN}/embed/avatars/0.png`
}

export function displayName(m: InvokerLike): string {
  return (m.nick || m.user?.global_name || m.user?.username || 'Member').slice(0, 256)
}

export function authorFor(m: InvokerLike | undefined): EmbedAuthor | undefined {
  if (!m?.user?.id) return undefined
  return { name: displayName(m), icon_url: avatarUrl(m) }
}

/** "✅ Headline\n\nbody", clipped to Discord's description limit. */
export function makeEmbed(tone: Tone, headline: string, body?: string, extra: Partial<Omit<Embed, 'color' | 'description'>> = {}): Embed {
  let description = `${ICON[tone]} ${headline}${body ? `\n\n${body}` : ''}`
  if (description.length > EMBED_DESCRIPTION_LIMIT) description = description.slice(0, EMBED_DESCRIPTION_LIMIT - 1) + '…'
  const embed: Embed = { color: EMBED_COLOR[tone], description }
  if (extra.author) embed.author = extra.author
  if (extra.fields?.length) embed.fields = extra.fields
  if (extra.image) embed.image = extra.image
  if (extra.thumbnail) embed.thumbnail = extra.thumbnail
  if (extra.footer) embed.footer = extra.footer
  return embed
}

/** UnbelievaBoat-style numbered list: "1 - first\n2 - second". */
export function numbered(lines: string[]): string {
  return lines.map((l, idx) => `${idx + 1} - ${l}`).join('\n')
}

/** A role pill when the id is a snowflake, else the bold role name. */
export function roleLabel(roleId: string | undefined, name: string): string {
  return roleId && SNOWFLAKE.test(roleId) ? `<@&${roleId}>` : `**${name}**`
}
