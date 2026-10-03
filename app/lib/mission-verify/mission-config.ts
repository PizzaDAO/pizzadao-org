/**
 * Which verifier each seeded mission uses, keyed by (level, index), never by
 * id (plans/mission-verification.md §1, §8). Used by the data migration
 * scripts/missions/set-verifiers.mjs and by the seed scripts.
 *
 * `seedTitle` is the title scripts/seed-missions.mjs inserted. The migration
 * refuses to touch a row whose title is neither the seed title nor the new
 * title set here (the production rows may have been edited by hand).
 *
 * Automatic verifiers: x_linked, attendance_count, discord_message,
 * referral (Phase 4: real referral capture), discord_role; manual for L8.
 * Phase 4 adds the semi-automatic ones (L2.1 social_post, L4.1 poap_drop,
 * L5.1 media_proof, L6.1 gpp_host): the member submits a proof link, the
 * verifier pre-checks it on submit (MissionCompletion.checkResult) and a
 * reviewer approves with one click. They never approve on their own.
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
    index: 1, // prod: the original index-0 row was deleted; this mission sits at index 1
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
    description:
      'Post about PizzaDAO on X or Farcaster and get at least 3 comments and 10 likes, then submit the link to your post. A reviewer checks the numbers.',
    verifierKey: 'social_post', // D15: X (handle match) + Farcaster (Neynar); a reviewer judges the engagement
    verifierParams: { minReplies: 3, minLikes: 10, platforms: ['x', 'farcaster'] },
    proofKind: 'URL',
  },
  {
    level: 3,
    index: 0,
    seedTitle: 'Share something in #show-and-tell', // prod title (edited from the seed's 'Share your community in #show-and-tell')
    verifierKey: 'discord_message',
    verifierParams: { channelName: 'show-and-tell', channelEnv: 'SHOW_AND_TELL_CHANNEL_ID' },
    proofKind: 'DISCORD_MESSAGE',
  },
  {
    level: 3,
    index: 1,
    seedTitle: 'Invite a friend to Discord',
    description:
      'Invite a friend with your personal invite link (shown on this mission), or have them pick you in the "Who invited you?" step when they join. It counts once they finish onboarding. Invited someone before this existed? Submit it for review and say who.',
    verifierKey: 'referral', // D4: the Referral table (onboarding step + /join?ref= links), qualifies on onboarding
    verifierParams: { min: 1, qualify: 'onboarded' },
    proofKind: 'NONE',
  },
  {
    level: 4,
    index: 1, // prod: the original index-0 row was deleted; this mission sits at index 1
    seedTitle: 'Make a POAP for a community call',
    description:
      'Create a POAP for one of the community calls, then submit the POAP drop link (poap.gallery or collectors.poap.xyz) or the drop ID. A reviewer confirms you made it.',
    verifierKey: 'poap_drop', // drop info from POAP Compass; a reviewer confirms authorship
    verifierParams: {},
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
    description:
      'Record a selfie interview about your PizzaDAO experience and submit a link to it (YouTube, X, Google Drive or Loom).',
    verifierKey: 'media_proof', // D16: links only
    verifierParams: { kinds: ['youtube', 'x', 'drive', 'loom'] },
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
    description:
      'Help a new city host a Bitcoin Pizza Day party, then submit its rsv.pizza event link. A reviewer confirms you hosted or onboarded it (linking Telegram on your profile helps).',
    verifierKey: 'gpp_host', // D14: rsv.pizza event link + Telegram; Phase 5 adds a service endpoint
    verifierParams: { eventType: 'gpp', statuses: ['approved', 'listed'] },
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
    if (changes.length) plan.updates.push({ id: row.id, level: c.level, index: c.index, data, changes })
    else plan.unchanged.push(label)
  }
  return plan
}
