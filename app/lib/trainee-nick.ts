import { sanitizeDisplayName } from './display-name'

// Same rule as normalizeRoleName in pep-earn/income.ts, copied so this module
// stays free of prisma imports (it is used by tiny shared helpers like embeds).
const normalizeRoleName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * anchovy-52918: every Discord member who joined after go-live and hasn't
 * signed up on app.pizzadao.org is named "Pizza Trainee" and holds the
 * "Pizza Noob" role. This file is the pure part: constants, helpers and the
 * planner. The runner (trainee-nick-run.ts) does the I/O.
 */
export const TRAINEE_NICK = 'Pizza Trainee'
export const PIZZA_NOOB_ROLE_NAME = 'Pizza Noob'
/** Pizza Noob is removed once the member completes this missions level. */
export const PIZZA_NOOB_GRADUATE_LEVEL = 2
export const DISCORD_NICK_MAX = 32

export const isTraineeNick = (n?: string | null) => (n ?? '').trim().toLowerCase() === TRAINEE_NICK.toLowerCase()
/** The member's own nickname, or null when it is the placeholder (or empty). */
export const realNick = (n?: string | null) => (isTraineeNick(n) ? null : n?.trim() || null)

/**
 * The Pizza Noob role id: a valid PIZZA_NOOB_ROLE_ID override wins; otherwise
 * the single guild role whose normalized name is "pizzanoob". Zero or several
 * matches give null (the role step is then skipped).
 */
export function resolvePizzaNoobRoleId(
  roles: ReadonlyArray<{ id: string; name: string }>,
  envOverride?: string | null,
): string | null {
  const override = (envOverride ?? '').trim()
  if (/^\d{5,25}$/.test(override)) return override
  const want = normalizeRoleName(PIZZA_NOOB_ROLE_NAME)
  const matches = roles.filter((r) => normalizeRoleName(r.name) === want)
  return matches.length === 1 ? matches[0].id : null
}

export interface PlanMember {
  id: string
  nick?: string | null
  roles: string[]
  /** ISO timestamp; null/unparseable members are never in scope. */
  joinedAt?: string | null
  bot?: boolean
}

export interface PlanInput {
  members: ReadonlyArray<PlanMember>
  /** discordId -> roster Name for everyone who has signed up. */
  signedUp: ReadonlyMap<string, string>
  ownerId: string | null
  /** Position of the bot's highest role. */
  botTopPosition: number
  /** roleId -> position (for the outranked check). */
  rolePositions: ReadonlyMap<string, number>
  /** TRAINEE_NICK_SINCE as epoch ms. */
  since: number
  max: number
  /** Resolved Pizza Noob role, and whether the bot may assign it. Null/false: role steps are skipped. */
  pizzaNoobRoleId: string | null
  roleAssignable: boolean
  /** Ids (among the candidates) that completed missions L2; null when the lookup failed. */
  completedL2: ReadonlySet<string> | null
}

export interface EnforceItem { id: string; setNick: boolean; addRole: boolean }
export interface HealItem { id: string; nick: string | null }
export interface SweepItem { id: string }

export interface TraineePlan {
  heal: HealItem[]
  sweep: SweepItem[]
  enforce: EnforceItem[]
  skipped: { bot: number; owner: number; outranked: number; signedUp: number }
  /** Items beyond `max`, left for the next run. */
  overflow: number
  /** In-scope members that are already compliant. */
  alreadyTrainee: number
  inScope: number
}

const joinedMs = (m: PlanMember) => {
  const t = m.joinedAt ? Date.parse(m.joinedAt) : NaN
  return Number.isFinite(t) ? t : null
}

type Skip = 'bot' | 'owner' | 'outranked'

function classify(input: Pick<PlanInput, 'ownerId' | 'botTopPosition' | 'rolePositions'>, m: PlanMember): Skip | null {
  if (m.bot) return 'bot'
  if (input.ownerId && m.id === input.ownerId) return 'owner'
  const top = Math.max(0, ...m.roles.map((r) => input.rolePositions.get(r) ?? 0))
  if (top >= input.botTopPosition) return 'outranked'
  return null
}

const roleOk = (input: Pick<PlanInput, 'pizzaNoobRoleId' | 'roleAssignable'>) =>
  !!input.pizzaNoobRoleId && input.roleAssignable

/**
 * Members whose "completed L2" status the planner needs: in scope and
 * renameable, who either hold Pizza Noob (sweep) or lack it while not signed up
 * (add). Everyone else can't get the role added or removed.
 */
export function pizzaNoobCandidates(input: Omit<PlanInput, 'completedL2' | 'max'>): string[] {
  if (!roleOk(input)) return []
  const ids: string[] = []
  for (const m of input.members) {
    const j = joinedMs(m)
    if (j === null || j < input.since) continue
    if (classify(input, m)) continue
    const holds = m.roles.includes(input.pizzaNoobRoleId!)
    if (holds || !input.signedUp.has(m.id)) ids.push(m.id)
  }
  return ids
}

export function planTraineeNicks(input: PlanInput): TraineePlan {
  const sorted = [...input.members].sort(
    (a, b) => (joinedMs(a) ?? 0) - (joinedMs(b) ?? 0) || a.id.localeCompare(b.id),
  )
  const skipped = { bot: 0, owner: 0, outranked: 0, signedUp: 0 }
  const heal: HealItem[] = []
  const sweep: SweepItem[] = []
  const enforce: EnforceItem[] = []
  let inScope = 0
  let alreadyTrainee = 0
  const useRole = roleOk(input)
  const roleId = input.pizzaNoobRoleId

  for (const m of sorted) {
    const j = joinedMs(m)
    const inWindow = j !== null && j >= input.since
    if (inWindow) inScope++
    const skip = classify(input, m)
    if (skip) {
      if (inWindow) skipped[skip]++
      continue
    }
    const signedName = input.signedUp.get(m.id)
    const isSignedUp = signedName !== undefined

    if (isSignedUp) {
      if (inWindow) skipped.signedUp++
      if (isTraineeNick(m.nick)) {
        const clean = sanitizeDisplayName(signedName).slice(0, DISCORD_NICK_MAX).trim()
        heal.push({ id: m.id, nick: clean && !isTraineeNick(clean) ? clean : null })
      }
    }
    if (!inWindow) continue

    const holds = !!roleId && m.roles.includes(roleId)
    const l2 = input.completedL2 !== null && input.completedL2.has(m.id)

    if (useRole && holds && l2) sweep.push({ id: m.id })
    if (isSignedUp) continue

    const setNick = m.nick !== TRAINEE_NICK
    const addRole = useRole && !holds && input.completedL2 !== null && !l2
    if (setNick || addRole) enforce.push({ id: m.id, setNick, addRole })
    else alreadyTrainee++
  }

  // Heal first, then the Level 2 sweep, then enforcement; capped together.
  let budget = Math.max(0, input.max)
  const take = <T>(items: T[]): T[] => {
    const kept = items.slice(0, budget)
    budget -= kept.length
    return kept
  }
  const total = heal.length + sweep.length + enforce.length
  const out = { heal: take(heal), sweep: take(sweep), enforce: take(enforce) }
  const kept = out.heal.length + out.sweep.length + out.enforce.length
  return { ...out, skipped, overflow: total - kept, alreadyTrainee, inScope }
}
