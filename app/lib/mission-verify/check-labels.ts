/**
 * Human-friendly rendering of a verifier's `checkResult` snapshot (what the
 * verifier saw), for reviewers. The automatic verifiers store Discord IDs
 * (`roleIds`, `channelId`, `messageId`, `invitees`); here roles become their
 * names, channels "#name" and people their names, on the web (resolved
 * server-side), and Discord mentions on the Discord review cards. Pure.
 */

type IdKind = 'role' | 'channel' | 'user' | 'message'

/** checkResult keys that hold Discord IDs, and what kind. */
export const CHECK_ID_KEYS: Record<string, IdKind> = {
  roleIds: 'role',
  roleId: 'role',
  channelId: 'channel',
  channelIds: 'channel',
  parentId: 'channel',
  invitees: 'user',
  invitee: 'user',
  inviteeDiscordId: 'user',
  discordIds: 'user',
  messageId: 'message',
}

const KEY_LABEL: Record<string, string> = {
  roleIds: 'Roles',
  roleId: 'Role',
  channelId: 'Channel',
  channelIds: 'Channels',
  parentId: 'Channel',
  messageId: 'Message',
  invitees: 'Invited',
  invitee: 'Invited',
  inviteeDiscordId: 'Invited',
  discordIds: 'Members',
  xUsername: 'X',
  calls: 'Calls',
  need: 'Needed',
  referrals: 'Referrals',
  flagged: 'Flagged',
  wallets: 'Wallets',
}

const SNOWFLAKE = /^\d{5,25}$/

function idList(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v]
  return list.map((x) => (typeof x === 'number' ? String(x) : x)).filter((x): x is string => typeof x === 'string' && SNOWFLAKE.test(x))
}

/** The Discord IDs in a checkResult, by kind (to resolve them in one batch). */
export function checkIds(r: unknown): { roles: string[]; channels: string[]; users: string[] } {
  const out = { roles: new Set<string>(), channels: new Set<string>(), users: new Set<string>() }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { roles: [], channels: [], users: [] }
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    const kind = CHECK_ID_KEYS[k]
    const bucket = kind === 'role' ? out.roles : kind === 'channel' ? out.channels : kind === 'user' ? out.users : null
    if (bucket) for (const id of idList(v)) bucket.add(id)
  }
  return { roles: [...out.roles], channels: [...out.channels], users: [...out.users] }
}

export interface IdNames {
  role?: (id: string) => string | undefined
  channel?: (id: string) => string | undefined
  user?: (id: string) => string | undefined
}

export interface CheckItem {
  label: string
  value: string
  /** A link for the value (a Discord message), https only. */
  href?: string
}

/**
 * "Roles: Pepperoni Mafia", "Channel: #show-and-tell", "Invited: Alice, Bob".
 * Unknown IDs fall back to "role 8232…" / "#channel 1234…" / the raw ID;
 * nested objects (e.g. byCrew) are left out, as before. A message ID becomes
 * a jump link when the channel and guild are known.
 */
export function describeCheck(r: unknown, names: IdNames = {}, opts: { guildId?: string | null } = {}): CheckItem[] {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return []
  const rec = r as Record<string, unknown>
  const items: CheckItem[] = []
  for (const [k, v] of Object.entries(rec)) {
    if (v === null || v === undefined) continue
    const label = KEY_LABEL[k] ?? k
    const kind = CHECK_ID_KEYS[k]
    if (kind === 'message') {
      const channelId = typeof rec.channelId === 'string' ? rec.channelId : null
      const id = idList(v)[0]
      if (!id) continue
      const href = opts.guildId && channelId ? `https://discord.com/channels/${opts.guildId}/${channelId}/${id}` : undefined
      items.push({ label, value: href ? 'open in Discord' : id, ...(href ? { href } : {}) })
      continue
    }
    if (kind) {
      const ids = idList(v)
      if (!ids.length) continue
      const name = (id: string) => {
        if (kind === 'role') return names.role?.(id) ?? `role ${id}`
        if (kind === 'channel') {
          const n = names.channel?.(id)
          return n ? `#${n.replace(/^#/, '')}` : `#${id}`
        }
        return names.user?.(id) ?? id
      }
      items.push({ label, value: ids.map(name).join(', ') })
      continue
    }
    if (Array.isArray(v)) {
      const flat = v.filter((x) => x !== null && typeof x !== 'object')
      if (flat.length) items.push({ label, value: flat.map(String).join(', ') })
      continue
    }
    if (typeof v === 'object') continue
    items.push({ label, value: String(v) })
  }
  return items
}

/** The same snapshot as Discord markdown: IDs become mentions, which Discord renders as names. */
export function mentionFor(kind: IdKind, id: string): string {
  if (kind === 'role') return `<@&${id}>`
  if (kind === 'channel') return `<#${id}>`
  if (kind === 'user') return `<@${id}>`
  return id
}
