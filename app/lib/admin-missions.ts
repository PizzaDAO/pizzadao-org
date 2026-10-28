/**
 * Admin mission editor (plans/app-settings.md 4.7): requirement thresholds, per-level rewards,
 * titles and re-activating a mission. NOT editable here: verifierKey, proofKind, level, index,
 * creating or deleting missions (code / script changes).
 *
 * Stricter-only from the UI (Snax's decision 1: loosening needs a PR), enforced here, server side.
 * The bound is the CODE value (mission-config.ts), not the current value, so a typo can be undone:
 *   - numeric minimums (min, minReplies, minLikes) may be anywhere at or above the code value;
 *   - every other verifier param (roles, sources, kinds, crews, minLevel...) is read-only;
 *   - a level reward may be anywhere at or below the code reward (LEVEL_REWARD_CEILING);
 *   - every params or reward change needs a confirmation that shows old -> new;
 *   - a mission can be re-activated but not deactivated (an inactive mission makes the level count
 *     as complete, which would pay everyone and skip the holds).
 *
 * Every write is validated (verifier params by the verifier's own parse(), plus numeric bounds),
 * audited in AppSettingChange (key `mission:<id>:<field>` / `missionLevel:<level>:<field>`) in the
 * same transaction, and clears the mission caches in this instance. Reward edits apply to levels
 * completed from now on: already-paid levels are never topped up or clawed back (settleLevels pays
 * each level once).
 */
import { prisma } from '@/app/lib/db'
import { clearMissionCaches } from '@/app/lib/mission-cache'
import { LEVEL_REWARD_CEILING, MISSION_VERIFIER_CONFIG } from '@/app/lib/mission-verify/mission-config'
import { getVerifier } from '@/app/lib/mission-verify/verifiers'
import { jsonOrDbNull } from '@/app/lib/settings/json'

export class MissionEditError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    /** Set when the change needs an explicit confirmation (409) the client has not sent yet. */
    readonly needsConfirm?: string,
  ) {
    super(message)
  }
}

export const REWARD_MIN = 1
export const REWARD_MAX = 1_000_000
export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 1000
export const LEVEL_TITLE_MAX = 60
export const PARAM_COUNT_MIN = 1
export const PARAM_COUNT_MAX = 100
const MAX_PARAMS_JSON = 4000
/** The highest mission level (a bound for rare_pizza_box.minLevel). */
const TOP_LEVEL = 8

/** Count-like params must stay in a sane range even where the verifier's parse() would accept more. */
const COUNT_KEYS = ['min', 'minReplies', 'minLikes']

type Plain = Record<string, unknown>

const isPlainObject = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Validate verifier params for a mission using this verifier. Returns the params to store (the
 * admin's plain JSON object) or throws MissionEditError(400).
 */
export function validateVerifierParams(verifierKey: string | null, params: unknown): Plain {
  if (!verifierKey) throw new MissionEditError(400, 'This mission has no verifier, so it has no params')
  const v = getVerifier(verifierKey)
  if (!v) throw new MissionEditError(400, `Unknown verifier ${verifierKey}`)
  if (!isPlainObject(params)) throw new MissionEditError(400, 'params must be a JSON object')
  if (JSON.stringify(params).length > MAX_PARAMS_JSON) throw new MissionEditError(400, 'params is too large')
  try {
    v.parse(params)
  } catch (e) {
    throw new MissionEditError(400, `${verifierKey}: ${e instanceof Error ? e.message : 'invalid params'}`)
  }
  for (const k of COUNT_KEYS) {
    const val = params[k]
    if (val !== undefined && !(Number.isInteger(val) && (val as number) >= PARAM_COUNT_MIN && (val as number) <= PARAM_COUNT_MAX)) {
      throw new MissionEditError(400, `${k} must be a whole number from ${PARAM_COUNT_MIN} to ${PARAM_COUNT_MAX}`)
    }
  }
  if (params.minLevel !== undefined && !(Number.isInteger(params.minLevel) && (params.minLevel as number) >= 1 && (params.minLevel as number) <= TOP_LEVEL)) {
    throw new MissionEditError(400, `minLevel must be a whole number from 1 to ${TOP_LEVEL}`)
  }
  return JSON.parse(JSON.stringify(params)) as Plain
}

export interface AdminMission {
  id: number
  level: number
  index: number
  title: string
  description: string | null
  isActive: boolean
  verifierKey: string | null
  verifierParams: unknown
  /** The code (seed) params: numeric minimums can't go below these. */
  codeParams: Plain | null
  proofKind: string
}

export interface AdminLevel {
  level: number
  levelTitle: string | null
  /** The shared reward; null when the level's rows disagree (flagged in the UI). */
  reward: number | null
  rewardsDisagree: boolean
  /** The code reward: the reward can't go above this. */
  rewardCeiling: number | null
  missions: AdminMission[]
}

export async function listAdminLevels(): Promise<AdminLevel[]> {
  const rows = await prisma.mission.findMany({
    orderBy: [{ level: 'asc' }, { index: 'asc' }],
    select: {
      id: true, level: true, index: true, title: true, description: true, isActive: true, reward: true,
      levelTitle: true, verifierKey: true, verifierParams: true, proofKind: true,
    },
  })
  const byLevel = new Map<number, typeof rows>()
  for (const r of rows) byLevel.set(r.level, [...(byLevel.get(r.level) ?? []), r])
  return [...byLevel.entries()].map(([level, list]) => {
    const rewards = [...new Set(list.map((r) => r.reward))]
    return {
      level,
      levelTitle: list.find((r) => r.levelTitle)?.levelTitle ?? null,
      reward: rewards.length === 1 ? (rewards[0] as number) : null,
      rewardsDisagree: rewards.length > 1,
      rewardCeiling: LEVEL_REWARD_CEILING[level] ?? null,
      missions: list.map((r) => ({
        id: r.id, level: r.level, index: r.index, title: r.title, description: r.description, isActive: r.isActive,
        verifierKey: r.verifierKey, verifierParams: r.verifierParams, codeParams: codeParamsOf(r.level, r.index), proofKind: String(r.proofKind),
      })),
    }
  })
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export interface MissionPatch {
  title?: unknown
  description?: unknown
  isActive?: unknown
  verifierParams?: unknown
}

const stable = (v: unknown): string =>
  JSON.stringify(v ?? null, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val,
  )

/** Numeric thresholds an admin may change. `minLevel` is NOT one: raising it above the mission's own level makes it impossible. */
export const isMinimumKey = (key: string) => /^min(?!Level$)([A-Z]\w*)?$/.test(key)

/** The code (seed) params of a mission, from mission-config.ts. */
export function codeParamsOf(level: number, index: number): Plain | null {
  const c = MISSION_VERIFIER_CONFIG.find((x) => x.level === level && x.index === index)
  return c && isPlainObject(c.verifierParams) ? c.verifierParams : null
}

/**
 * Throws unless `next` differs from `current` only in numeric minimums that stay at or above the
 * code value (`code`; a key the code doesn't set can't go below its current value).
 */
export function assertStricterParams(current: unknown, next: Plain, code: Plain | null = null): void {
  const cur = isPlainObject(current) ? current : {}
  for (const k of new Set([...Object.keys(cur), ...Object.keys(next)])) {
    const a = cur[k]
    const b = next[k]
    if (stable(a) === stable(b)) continue
    if (isMinimumKey(k) && typeof a === 'number' && typeof b === 'number') {
      const floor = typeof code?.[k] === 'number' ? Math.min(code[k] as number, a) : a
      if (b >= floor) continue
      throw new MissionEditError(400, `${k} can't go below ${floor}, the code value; lowering it further needs a PR`)
    }
    throw new MissionEditError(400, `${k} can't be changed here; only numeric minimums (at or above the code value) are editable (other changes need a PR)`)
  }
}

/** "min 5 -> 6, minLikes 10 -> 12" */
function describeParamChange(current: unknown, next: Plain): string {
  const cur = isPlainObject(current) ? current : {}
  return Object.keys(next).filter((k) => stable(cur[k]) !== stable(next[k])).map((k) => `${k} ${String(cur[k])} -> ${String(next[k])}`).join(', ')
}

/** Edit one mission. Only the given fields change; unchanged values write nothing and no audit row. */
export async function updateMission(
  id: number,
  patch: MissionPatch,
  actor: string,
  opts: { confirm?: boolean; note?: unknown } = {},
): Promise<{ changed: string[] }> {
  if (!Number.isInteger(id)) throw new MissionEditError(400, 'Invalid mission id')
  const current = await prisma.mission.findUnique({ where: { id } })
  if (!current) throw new MissionEditError(404, 'Mission not found')

  const data: Record<string, unknown> = {}
  const audit: Array<{ field: string; oldValue: unknown; newValue: unknown }> = []
  const set = (field: string, oldValue: unknown, newValue: unknown) => {
    if (sameJson(oldValue, newValue)) return
    data[field] = newValue
    audit.push({ field, oldValue, newValue })
  }

  if (patch.title !== undefined) {
    if (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.trim().length > TITLE_MAX) {
      throw new MissionEditError(400, `title must be 1 to ${TITLE_MAX} characters`)
    }
    set('title', current.title, patch.title.trim())
  }
  if (patch.description !== undefined) {
    if (patch.description !== null && (typeof patch.description !== 'string' || patch.description.length > DESCRIPTION_MAX)) {
      throw new MissionEditError(400, `description must be at most ${DESCRIPTION_MAX} characters`)
    }
    const d = typeof patch.description === 'string' ? patch.description.trim() || null : null
    set('description', current.description, d)
  }
  if (patch.isActive !== undefined) {
    if (typeof patch.isActive !== 'boolean') throw new MissionEditError(400, 'isActive must be true or false')
    if (patch.isActive === false && current.isActive) {
      throw new MissionEditError(400, 'Deactivating a mission needs a PR: an inactive mission makes the level count as complete and pays out without the holds')
    }
    set('isActive', current.isActive, patch.isActive)
  }
  let confirmText: string | null = null
  if (patch.verifierParams !== undefined) {
    const params = validateVerifierParams(current.verifierKey ?? null, patch.verifierParams)
    assertStricterParams(current.verifierParams, params, codeParamsOf(current.level, current.index))
    if (!sameJson(current.verifierParams, params)) {
      confirmText = `Level ${current.level} requirement changes (${describeParamChange(current.verifierParams, params)}). Members who now meet it pass on their next check; members who no longer meet it are not clawed back.`
    }
    set('verifierParams', current.verifierParams, params)
  }

  if (audit.length === 0) return { changed: [] }
  if (confirmText && opts.confirm !== true) throw new MissionEditError(409, 'Confirmation required', confirmText)

  const note = typeof opts.note === 'string' && opts.note.trim() ? opts.note.trim().slice(0, 300) : null
  await prisma.$transaction(async (tx) => {
    // Concurrency guard: the fields being changed must still hold the values we read (another admin may have saved).
    const fresh = await tx.mission.findUnique({ where: { id } })
    const stale = !fresh || audit.some((a) => stable((fresh as Record<string, unknown>)[a.field]) !== stable(a.oldValue))
    if (stale) throw new MissionEditError(409, 'Mission changed while saving; reload and retry')
    const n = await tx.mission.updateMany({
      where: { id, level: current.level, index: current.index, ...Object.fromEntries(audit.filter((a) => a.field !== 'verifierParams').map((a) => [a.field, a.oldValue])),
        ...(audit.some((a) => a.field === 'verifierParams') && current.verifierParams != null ? { verifierParams: { equals: current.verifierParams } } : {}),
      },
      data: data as never,
    })
    if (n.count !== 1) throw new MissionEditError(409, 'Mission changed while saving; reload and retry')
    for (const a of audit) {
      await tx.appSettingChange.create({
        data: { key: `mission:${id}:${a.field}`, oldValue: jsonOrDbNull(a.oldValue), newValue: jsonOrDbNull(a.newValue), changedBy: actor, note },
      })
    }
  })
  clearMissionCaches()
  return { changed: audit.map((a) => a.field) }
}

export interface LevelPatch {
  reward?: unknown
  levelTitle?: unknown
}

/** Edit a level: the reward and title go on EVERY row of the level (the shared-reward invariant). */
export async function updateLevel(
  level: number,
  patch: LevelPatch,
  actor: string,
  opts: { confirm?: boolean; note?: unknown } = {},
): Promise<{ changed: string[] }> {
  if (!Number.isInteger(level) || level < 1) throw new MissionEditError(400, 'Invalid level')
  const rows = await prisma.mission.findMany({ where: { level }, orderBy: { id: 'asc' }, select: { id: true, reward: true, levelTitle: true } })
  if (rows.length === 0) throw new MissionEditError(404, 'Level not found')

  const data: Record<string, unknown> = {}
  const audit: Array<{ field: string; oldValue: unknown; newValue: unknown }> = []

  if (patch.reward !== undefined) {
    const r = patch.reward
    if (typeof r !== 'number' || !Number.isInteger(r) || r < REWARD_MIN || r > REWARD_MAX) {
      throw new MissionEditError(400, `reward must be a whole number from ${REWARD_MIN} to ${REWARD_MAX}`)
    }
    const rewards = [...new Set(rows.map((x) => x.reward))]
    const ceiling = LEVEL_REWARD_CEILING[level] ?? Math.max(...rewards)
    if (r > ceiling) throw new MissionEditError(400, `A reward can't go above ${ceiling}, the code value; raising it further needs a PR`)
    if (rewards.length !== 1 || rewards[0] !== r) {
      data.reward = r
      audit.push({ field: 'reward', oldValue: rewards.length === 1 ? rewards[0] : rewards, newValue: r })
    }
  }
  if (patch.levelTitle !== undefined) {
    if (patch.levelTitle !== null && (typeof patch.levelTitle !== 'string' || patch.levelTitle.trim().length > LEVEL_TITLE_MAX)) {
      throw new MissionEditError(400, `levelTitle must be at most ${LEVEL_TITLE_MAX} characters`)
    }
    const t = typeof patch.levelTitle === 'string' ? patch.levelTitle.trim() || null : null
    const titles = [...new Set(rows.map((x) => x.levelTitle ?? null))]
    if (titles.length !== 1 || titles[0] !== t) {
      data.levelTitle = t
      audit.push({ field: 'levelTitle', oldValue: titles.length === 1 ? titles[0] : titles, newValue: t })
    }
  }
  if (audit.length === 0) return { changed: [] }
  if (data.reward !== undefined && opts.confirm !== true) {
    const old = audit.find((a) => a.field === 'reward')!.oldValue
    throw new MissionEditError(409, 'Confirmation required', `Level ${level} reward ${Array.isArray(old) ? old.join(' / ') : String(old)} -> ${String(data.reward)}. Applies to levels completed from now on; already-paid levels are not topped up or clawed back.`)
  }

  const note = typeof opts.note === 'string' && opts.note.trim() ? opts.note.trim().slice(0, 300) : null
  await prisma.$transaction(async (tx) => {
    // Concurrency guard: the level's rows must be exactly as read (same ids, rewards and titles).
    const fresh = await tx.mission.findMany({ where: { level }, orderBy: { id: 'asc' }, select: { id: true, reward: true, levelTitle: true } })
    if (stable(fresh.map((x) => [x.id, x.reward, x.levelTitle])) !== stable(rows.map((x) => [x.id, x.reward, x.levelTitle]))) {
      throw new MissionEditError(409, 'Level changed while saving; reload and retry')
    }
    await tx.mission.updateMany({ where: { level, id: { in: rows.map((x) => x.id) } }, data: data as never })
    for (const a of audit) {
      await tx.appSettingChange.create({
        data: { key: `missionLevel:${level}:${a.field}`, oldValue: jsonOrDbNull(a.oldValue), newValue: jsonOrDbNull(a.newValue), changedBy: actor, note },
      })
    }
  })
  clearMissionCaches()
  return { changed: audit.map((a) => a.field) }
}
