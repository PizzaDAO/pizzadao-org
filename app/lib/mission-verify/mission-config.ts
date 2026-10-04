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
 *
 * Missions added after the seed (L5.2 "Vouch for another member") carry an
 * `insert` block: the migration INSERTs the row when (level, index) is
 * missing, so it is idempotent. MISSION_LEVEL_TITLES sets Mission.levelTitle
 * on every row of those levels (the level's display name and the reward
 * ledger description).
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
  /**
   * A mission that is not in the seed: INSERT the row when (level, index) is
   * missing. `reward` must equal the level's shared reward (checked against
   * the level's existing rows). Needs `description`; the title is `seedTitle`.
   */
  insert?: { reward: number }
}

/**
 * Level titles (Mission.levelTitle), set on EVERY mission row of the level.
 * Levels not listed keep whatever their rows have (L1 Pizza Trainee, L2 Pizza
 * Noob, L7 Made Mafia, L8 Don of Dons). To rename a level: change it here (or
 * pass --level-titles to the script), then run
 * scripts/missions/set-verifiers.mjs (dry run, then --apply).
 */
export const MISSION_LEVEL_TITLES: Readonly<Record<number, string>> = {
  3: "Make us an offer we can't refuse",
  4: 'Do some dirty work',
  5: 'Do a favor for the mafia',
  6: 'Street Muscle', // unchanged from prod; pinned so every L6 row carries it
}

/** L5's shared per-level reward (the new L5.2 row must match it). */
export const LEVEL_5_REWARD = 4269

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
    level: 5,
    index: 2, // new: not in the seed, INSERTed by the migration
    seedTitle: 'Vouch for another member',
    description:
      'Vouch for another PizzaDAO member: open their profile and tap Vouch. Checked automatically. Vouching for yourself and follows imported from Farcaster or X do not count.',
    // Only PizzaDAO-native vouches: FARCASTER / TWITTER rows are imported follows, not a vouch made here.
    verifierKey: 'vouch_given',
    verifierParams: { min: 1, sources: ['PIZZADAO'] },
    proofKind: 'NONE',
    insert: { reward: LEVEL_5_REWARD },
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
  /** Optional so fixtures without these columns still plan (levelTitle then reads as null). */
  levelTitle?: string | null
  reward?: number
}

export interface MissionUpdate {
  id: number
  level: number
  index: number
  /** Only the fields that change (verifierParams null = SQL NULL). */
  data: {
    title?: string
    description?: string
    levelTitle?: string
    verifierKey?: string | null
    verifierParams?: Record<string, unknown> | null
    proofKind?: ProofKindName
  }
  changes: string[]
}

export interface MissionInsert {
  level: number
  index: number
  data: {
    level: number
    index: number
    title: string
    description: string
    reward: number
    levelTitle: string | null
    isActive: true
    verifierKey: string | null
    verifierParams: Record<string, unknown> | null
    proofKind: ProofKindName
  }
}

export interface VerifierMigrationPlan {
  updates: MissionUpdate[]
  /** New mission rows: config entries with `insert` and no row yet. */
  inserts: MissionInsert[]
  unchanged: string[]
  /** Config entries with no row (reported, not an error). */
  missing: string[]
  /** Title / reward mismatches: the migration must abort. */
  errors: string[]
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
    : val,
)

const labelOf = (r: { level: number; index: number }) => `L${r.level}.${r.index}`

/**
 * Pure: what the data migration would change. Idempotent (a second run finds
 * nothing to do):
 *
 *   - configured rows: verifier, title, description (title-guarded)
 *   - `insert` entries with no row: a new mission row
 *   - level titles: levelTitle on every row of the listed levels
 */
export function planVerifierMigration(
  rows: readonly MissionDbRow[],
  config: readonly MissionVerifierConfig[] = MISSION_VERIFIER_CONFIG,
  levelTitles: Readonly<Record<number, string>> = MISSION_LEVEL_TITLES,
): VerifierMigrationPlan {
  const plan: VerifierMigrationPlan = { updates: [], inserts: [], unchanged: [], missing: [], errors: [] }
  const updates = new Map<number, MissionUpdate>()
  const updateFor = (row: MissionDbRow): MissionUpdate => {
    let u = updates.get(row.id)
    if (!u) {
      u = { id: row.id, level: row.level, index: row.index, data: {}, changes: [] }
      updates.set(row.id, u)
    }
    return u
  }
  const okRows: Array<{ label: string; id: number }> = []

  for (const c of config) {
    const label = labelOf(c)
    const row = rows.find((r) => r.level === c.level && r.index === c.index)
    if (!row) {
      if (!c.insert) {
        plan.missing.push(`${label} "${c.seedTitle}"`)
        continue
      }
      if (!c.description) {
        plan.errors.push(`${label}: an inserted mission needs a description`)
        continue
      }
      const levelRewards = [...new Set(rows.filter((r) => r.level === c.level && typeof r.reward === 'number').map((r) => r.reward))]
      const reward = c.insert.reward
      if (levelRewards.some((r) => r !== reward)) {
        plan.errors.push(`${label}: reward ${c.insert.reward} differs from level ${c.level}'s shared reward ${levelRewards.join(' / ')}`)
        continue
      }
      plan.inserts.push({
        level: c.level,
        index: c.index,
        data: {
          level: c.level,
          index: c.index,
          title: c.title ?? c.seedTitle,
          description: c.description,
          reward: c.insert.reward,
          levelTitle: levelTitles[c.level] ?? rows.find((r) => r.level === c.level && r.levelTitle)?.levelTitle ?? null,
          isActive: true,
          verifierKey: c.verifierKey,
          verifierParams: c.verifierParams,
          proofKind: c.proofKind,
        },
      })
      continue
    }
    const accepted = [c.seedTitle, c.title].filter(Boolean)
    if (!accepted.includes(row.title)) {
      plan.errors.push(`${label}: title is "${row.title}", expected "${c.seedTitle}"${c.title ? ` or "${c.title}"` : ''}`)
      continue
    }
    okRows.push({ label, id: row.id })
    const data: MissionUpdate['data'] = {}
    const changes: string[] = []
    if (c.title && row.title !== c.title) {
      data.title = c.title
      changes.push(`title -> "${c.title}"`)
    }
    if (c.description && row.description !== c.description) {
      data.description = c.description
      changes.push('description')
    }
    if (row.verifierKey !== c.verifierKey) {
      data.verifierKey = c.verifierKey
      changes.push(`verifierKey ${row.verifierKey ?? 'null'} -> ${c.verifierKey ?? 'null'}`)
    }
    if (stable(row.verifierParams ?? null) !== stable(c.verifierParams)) {
      data.verifierParams = c.verifierParams
      changes.push(`verifierParams -> ${stable(c.verifierParams)}`)
    }
    if (row.proofKind !== c.proofKind) {
      data.proofKind = c.proofKind
      changes.push(`proofKind ${row.proofKind} -> ${c.proofKind}`)
    }
    if (changes.length) {
      const u = updateFor(row)
      Object.assign(u.data, data)
      u.changes.push(...changes)
    }
  }

  // Level titles go on every row of the level, configured or not: the UI and
  // the reward ledger description read the level's first row.
  for (const row of rows) {
    const want = levelTitles[row.level]
    if (want === undefined || (row.levelTitle ?? null) === want) continue
    const u = updateFor(row)
    u.data.levelTitle = want
    u.changes.push(`levelTitle ${row.levelTitle == null ? 'null' : `"${row.levelTitle}"`} -> "${want}"`)
  }

  plan.updates = [...updates.values()].sort((a, b) => a.level - b.level || a.index - b.index)
  plan.unchanged = okRows.filter((r) => !updates.has(r.id)).map((r) => r.label)
  return plan
}

/**
 * `--level-titles 3="Title",4="Other"` (CLI) -> { 3: 'Title', 4: 'Other' }.
 * The script merges it over MISSION_LEVEL_TITLES, for a rename without a code
 * change. Titles may be quoted ("..." or '...'); unquoted ones end at a comma.
 */
export function parseLevelTitlesArg(arg: string): Record<number, string> {
  const out: Record<number, string> = {}
  const re = /\s*(\d+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,]*?))\s*(?:,|$)/y
  while (re.lastIndex < arg.length) {
    const m = re.exec(arg)
    if (!m || m[0] === '') throw new Error(`--level-titles: can't parse "${arg}" (expected 3="Title",4="Title")`)
    const title = (m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (!title) throw new Error(`--level-titles: level ${m[1]} has an empty title`)
    out[Number(m[1])] = title
  }
  if (!Object.keys(out).length) throw new Error('--level-titles: no titles given (expected 3="Title",4="Title")')
  return out
}
