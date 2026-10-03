/**
 * Which verifier each seeded mission uses, keyed by (level, index), never by
 * id (plans/mission-verification.md §1, §8). Used by the data migration
 * scripts/missions/set-verifiers.mjs and by the seed scripts.
 *
 * `seedTitle` is the title scripts/seed-missions.mjs inserted. The migration
 * refuses to touch a row whose title is neither the seed title nor the new
 * title set here (the production rows may have been edited by hand).
 *
 * Phase 1 verifiers: x_linked, attendance_count, discord_message, referral
 * (stub), discord_role, manual. The semi-automatic missions (L2.1, L4.0, L5.1,
 * L6.1) get their verifiers in Phase 4 and stay manual for now (proofKind URL
 * only changes the submit form's hint).
 */

export type ProofKindName = 'NONE' | 'URL' | 'DISCORD_MESSAGE' | 'UPLOAD'

export interface MissionVerifierConfig {
  level: number
  index: number
  seedTitle: string
  /** New title/description (the L1.0 reword, D1). */
  title?: string
  description?: string
  verifierKey: string | null
  verifierParams: Record<string, unknown> | null
  proofKind: ProofKindName
}

export const PEPPERONI_MAFIA_ROLE_ID = '823266914834841610'
export const DREAD_PIZZA_ROBERTS_ROLE_ID = '812131585327235113'

export const MISSION_VERIFIER_CONFIG: readonly MissionVerifierConfig[] = [
  {
    level: 1,
    index: 0,
    seedTitle: 'Follow @RarePizzas and @Pizza_DAO on X',
    title: 'Link your X account and follow @RarePizzas + @Pizza_DAO',
    description:
      'Link your X account on your PizzaDAO profile (Connect X), and follow @RarePizzas and @Pizza_DAO on X. Linking is checked automatically.',
    verifierKey: 'x_linked',
    verifierParams: {},
    proofKind: 'NONE',
  },
  {
    level: 2,
    index: 0,
    seedTitle: 'Say hi on a community or crew call',
    verifierKey: 'attendance_count',
    verifierParams: { min: 1, crews: 'any' },
    proofKind: 'NONE',
  },
  {
    level: 2,
    index: 1,
    seedTitle: 'Post about PizzaDAO (3+ comments, 10+ likes)',
    verifierKey: null, // social_post, Phase 4
    verifierParams: null,
    proofKind: 'URL',
  },
  {
    level: 3,
    index: 0,
    seedTitle: 'Share your community in #show-and-tell',
    verifierKey: 'discord_message',
    verifierParams: { channelName: 'show-and-tell', channelEnv: 'SHOW_AND_TELL_CHANNEL_ID' },
    proofKind: 'DISCORD_MESSAGE',
  },
  {
    level: 3,
    index: 1,
    seedTitle: 'Invite a friend to Discord',
    verifierKey: 'referral', // stub until the Phase 4 referral capture; never passes yet
    verifierParams: { min: 1, qualify: 'onboarded' },
    proofKind: 'NONE',
  },
  {
    level: 4,
    index: 0,
    seedTitle: 'Make a POAP for a community call',
    verifierKey: null, // poap_drop, Phase 4
    verifierParams: null,
    proofKind: 'URL',
  },
  {
    level: 5,
    index: 0,
    seedTitle: 'Join three crew calls',
    description: 'Attend three crew calls in total: any crews, and community calls count too.',
    verifierKey: 'attendance_count',
    verifierParams: { min: 3, crews: 'any', distinct: 'call' },
    proofKind: 'NONE',
  },
  {
    level: 5,
    index: 1,
    seedTitle: 'Do a selfie interview',
    verifierKey: null, // media_proof, Phase 4
    verifierParams: null,
    proofKind: 'URL',
  },
  {
    level: 6,
    index: 0,
    seedTitle: 'Join Pepperoni Mafia',
    verifierKey: 'discord_role',
    verifierParams: { roleIds: [PEPPERONI_MAFIA_ROLE_ID] },
    proofKind: 'NONE',
  },
  {
    level: 6,
    index: 1,
    seedTitle: 'Onboard a Bitcoin Pizza Day city',
    verifierKey: null, // gpp_host, Phase 4
    verifierParams: null,
    proofKind: 'URL',
  },
  {
    level: 7,
    index: 0,
    seedTitle: 'Become a Crew Leader',
    verifierKey: 'discord_role',
    verifierParams: { roleNames: ['Crew Leader'], roleEnv: 'MISSION_CREW_LEADER_ROLE' },
    proofKind: 'NONE',
  },
  {
    level: 8,
    index: 0,
    seedTitle: 'Called upon by Dread Pizza Roberts',
    verifierKey: 'manual',
    verifierParams: null,
    proofKind: 'NONE',
  },
]

export interface MissionDbRow {
  id: number
  level: number
  index: number
  title: string
  description: string | null
  verifierKey: string | null
  verifierParams: unknown
  proofKind: string
  autoVerify: boolean
}

export interface MissionUpdate {
  id: number
  level: number
  index: number
  data: {
    title?: string
    description?: string
    verifierKey: string | null
    verifierParams: Record<string, unknown> | null
    proofKind: ProofKindName
    autoVerify: false
  }
  changes: string[]
}

export interface VerifierMigrationPlan {
  updates: MissionUpdate[]
  unchanged: string[]
  /** Config entries with no row (reported, not an error). */
  missing: string[]
  /** Title mismatches: the migration must abort. */
  errors: string[]
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
    : val,
)

/** Pure: what the data migration would change. Idempotent (a second run finds nothing to do). */
export function planVerifierMigration(
  rows: readonly MissionDbRow[],
  config: readonly MissionVerifierConfig[] = MISSION_VERIFIER_CONFIG,
): VerifierMigrationPlan {
  const plan: VerifierMigrationPlan = { updates: [], unchanged: [], missing: [], errors: [] }
  for (const c of config) {
    const label = `L${c.level}.${c.index}`
    const row = rows.find((r) => r.level === c.level && r.index === c.index)
    if (!row) {
      plan.missing.push(`${label} "${c.seedTitle}"`)
      continue
    }
    const accepted = [c.seedTitle, c.title].filter(Boolean)
    if (!accepted.includes(row.title)) {
      plan.errors.push(`${label}: title is "${row.title}", expected "${c.seedTitle}"${c.title ? ` or "${c.title}"` : ''}`)
      continue
    }
    const data: MissionUpdate['data'] = {
      verifierKey: c.verifierKey,
      verifierParams: c.verifierParams,
      proofKind: c.proofKind,
      autoVerify: false,
    }
    const changes: string[] = []
    if (c.title && row.title !== c.title) {
      data.title = c.title
      changes.push(`title -> "${c.title}"`)
    }
    if (c.description && row.description !== c.description) {
      data.description = c.description
      changes.push('description')
    }
    if (row.verifierKey !== c.verifierKey) changes.push(`verifierKey ${row.verifierKey ?? 'null'} -> ${c.verifierKey ?? 'null'}`)
    if (stable(row.verifierParams ?? null) !== stable(c.verifierParams)) changes.push(`verifierParams -> ${stable(c.verifierParams)}`)
    if (row.proofKind !== c.proofKind) changes.push(`proofKind ${row.proofKind} -> ${c.proofKind}`)
    if (row.autoVerify) changes.push('autoVerify -> false')
    if (changes.length) plan.updates.push({ id: row.id, level: c.level, index: c.index, data, changes })
    else plan.unchanged.push(label)
  }
  return plan
}
