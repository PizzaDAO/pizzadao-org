/**
 * Names for everything a reviewer sees on the web review panel: the people
 * (submitters, duplicate-account matches, invitees, flagged members) via
 * resolvePeople (sheet → Discord → raw ID), and the roles / channels in the
 * verifiers' checkResult snapshots via the cached guild role and channel lists
 * (the same helpers /collect-income and the verifiers use). Everything is
 * looked up in one parallel batch; any failure just leaves raw IDs.
 */
import { getGuildChannels } from '../discord-channels'
import { getGuildRoles } from '../discord-interactions/guild-roles'
import { resolvePeople, type PersonLabel, type PersonRef } from '../people'
import { checkIds, describeCheck, type CheckItem } from './check-labels'

export interface ReviewLabelDeps {
  resolvePeople: (refs: PersonRef[]) => Promise<Map<string, PersonLabel>>
  roles: () => Promise<ReadonlyArray<{ id: string; name: string }> | null>
  channels: () => Promise<ReadonlyArray<{ id: string; name: string }> | null>
  guildId: () => string | null
}

const guildIdEnv = () => process.env.DISCORD_GUILD_ID?.trim() || null

export const defaultReviewLabelDeps: ReviewLabelDeps = {
  resolvePeople: (refs) => resolvePeople(refs),
  roles: async () => {
    const g = guildIdEnv()
    return g ? getGuildRoles(g) : null
  },
  channels: () => getGuildChannels(),
  guildId: guildIdEnv,
}

export interface ReviewLabels {
  person: (discordId: string, memberId?: string | null) => PersonLabel
  describe: (check: unknown) => CheckItem[]
}

export async function loadReviewLabels(
  input: { people: PersonRef[]; checks: unknown[] },
  deps: ReviewLabelDeps = defaultReviewLabelDeps,
): Promise<ReviewLabels> {
  const ids = input.checks.map(checkIds)
  const needRoles = ids.some((i) => i.roles.length > 0)
  const needChannels = ids.some((i) => i.channels.length > 0)
  const refs = [...input.people, ...ids.flatMap((i) => i.users.map((discordId) => ({ discordId })))]

  const safe = <T,>(p: () => Promise<T>, fallback: T) => p().catch(() => fallback)
  const [people, roles, channels] = await Promise.all([
    safe(() => deps.resolvePeople(refs), new Map<string, PersonLabel>()),
    needRoles ? safe(deps.roles, null) : Promise.resolve(null),
    needChannels ? safe(deps.channels, null) : Promise.resolve(null),
  ])
  const roleName = new Map((roles ?? []).map((r) => [r.id, r.name]))
  const channelName = new Map((channels ?? []).map((c) => [c.id, c.name]))
  const guildId = deps.guildId()

  const person = (discordId: string, memberId?: string | null): PersonLabel =>
    people.get(discordId) ?? { discordId, name: discordId, ...(memberId ? { memberId } : {}), source: 'id' }

  return {
    person,
    describe: (check) =>
      describeCheck(
        check,
        {
          role: (id) => roleName.get(id),
          channel: (id) => channelName.get(id),
          user: (id) => {
            const p = people.get(id)
            return p && p.source !== 'id' ? p.name : undefined
          },
        },
        { guildId },
      ),
  }
}
