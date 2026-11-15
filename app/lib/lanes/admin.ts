/**
 * Admin lane editor (plans/lane-cards-mission-onboarding.md): lane fields, the mission mapping,
 * publishing, and the guide steps. Every write is validated and audited in AppSettingChange
 * (`lane:<slug>:<field>`, `laneStep:<id>:<field>`) in the same transaction as the change.
 * Works regardless of the public toggle so content can be prepared before launch.
 */
import { prisma } from '@/app/lib/db'
import { jsonOrDbNull } from '@/app/lib/settings/json'
import { isFactKey, placeholdersIn } from '@/app/lib/handbook'
import { isLaneSlug, isStepKind, parseStepLink, STEP_BODY_MAX, STEP_LABEL_MAX, STEP_TITLE_MAX } from './links'

export class LaneEditError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

export const TAG_MAX = 24
export const TITLE_MAX = 80
export const SUMMARY_MAX = 280
export const MAX_STRETCH = 5
const CREW_ID = /^[a-z0-9_-]{1,40}$/

const SUBMIT_NEEDS_MISSION = 'Pick a mission before publishing: this lane has a submit step'

type Audit = Array<{ field: string; oldValue: unknown; newValue: unknown }>

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const noteOf = (note: unknown) => (typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : null)

function text(v: unknown, field: string, max: number, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof v !== 'string') throw new LaneEditError(400, `${field} must be text`)
  const t = v.trim()
  if (!t && !opts.allowEmpty) throw new LaneEditError(400, `${field} is required`)
  if (t.length > max) throw new LaneEditError(400, `${field} must be at most ${max} characters`)
  return t
}

async function assertMissionExists(id: unknown, field: string): Promise<number> {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) throw new LaneEditError(400, `${field} must be a mission id`)
  const m = await prisma.mission.findUnique({ where: { id }, select: { id: true } })
  if (!m) throw new LaneEditError(400, `${field}: mission ${id} does not exist`)
  return id
}

export interface AdminLaneStep {
  id: string
  position: number
  title: string
  body: string
  linkHref: string | null
  linkLabel: string | null
  kind: string
}
export interface AdminLane {
  slug: string
  tag: string
  title: string
  summary: string
  missionId: number | null
  stretchMissionIds: number[]
  crewId: string | null
  position: number
  published: boolean
  updatedBy: string | null
  steps: AdminLaneStep[]
}
export interface MissionOption {
  id: number
  title: string
  level: number
  isActive: boolean
}

export async function listAdminLanes(): Promise<{ lanes: AdminLane[]; missions: MissionOption[] }> {
  const [lanes, missions] = await Promise.all([
    prisma.lane.findMany({ orderBy: [{ position: 'asc' }, { slug: 'asc' }], include: { steps: { orderBy: { position: 'asc' } } } }),
    prisma.mission.findMany({ orderBy: [{ level: 'asc' }, { index: 'asc' }], select: { id: true, title: true, level: true, isActive: true } }),
  ])
  return {
    lanes: lanes.map((l) => ({
      slug: l.slug, tag: l.tag, title: l.title, summary: l.summary, missionId: l.missionId ?? null,
      stretchMissionIds: l.stretchMissionIds ?? [], crewId: l.crewId ?? null, position: l.position, published: l.published,
      updatedBy: l.updatedBy ?? null,
      steps: l.steps.map((s) => ({ id: s.id, position: s.position, title: s.title, body: s.body, linkHref: s.linkHref ?? null, linkLabel: s.linkLabel ?? null, kind: s.kind })),
    })),
    missions,
  }
}

export interface LanePatch {
  tag?: unknown
  title?: unknown
  summary?: unknown
  missionId?: unknown
  stretchMissionIds?: unknown
  crewId?: unknown
  published?: unknown
}

export async function updateLane(slug: string, patch: LanePatch, actor: string, note?: unknown): Promise<{ changed: string[] }> {
  if (!isLaneSlug(slug)) throw new LaneEditError(400, 'Invalid lane')
  const current = await prisma.lane.findUnique({ where: { slug } })
  if (!current) throw new LaneEditError(404, 'Lane not found')

  const data: Record<string, unknown> = {}
  const audit: Audit = []
  const set = (field: string, oldValue: unknown, newValue: unknown) => {
    if (same(oldValue, newValue)) return
    data[field] = newValue
    audit.push({ field, oldValue, newValue })
  }

  if (patch.tag !== undefined) set('tag', current.tag, text(patch.tag, 'tag', TAG_MAX))
  if (patch.title !== undefined) set('title', current.title, text(patch.title, 'title', TITLE_MAX))
  if (patch.summary !== undefined) set('summary', current.summary, text(patch.summary, 'summary', SUMMARY_MAX))
  if (patch.missionId !== undefined) {
    set('missionId', current.missionId ?? null, patch.missionId === null ? null : await assertMissionExists(patch.missionId, 'missionId'))
  }
  if (patch.stretchMissionIds !== undefined) {
    const ids = patch.stretchMissionIds
    if (!Array.isArray(ids) || ids.length > MAX_STRETCH) throw new LaneEditError(400, `stretchMissionIds must be a list of at most ${MAX_STRETCH} mission ids`)
    const checked: number[] = []
    for (const id of ids) {
      const n = await assertMissionExists(id, 'stretchMissionIds')
      if (!checked.includes(n)) checked.push(n)
    }
    set('stretchMissionIds', current.stretchMissionIds ?? [], checked)
  }
  if (patch.crewId !== undefined) {
    const c = patch.crewId === null || patch.crewId === '' ? null : typeof patch.crewId === 'string' && CREW_ID.test(patch.crewId.trim()) ? patch.crewId.trim() : undefined
    if (c === undefined) throw new LaneEditError(400, 'crewId must be a crew id like "events" (letters, digits, - or _)')
    set('crewId', current.crewId ?? null, c)
  }
  if (patch.published !== undefined) {
    if (typeof patch.published !== 'boolean') throw new LaneEditError(400, 'published must be true or false')
    if (patch.published) {
      const n = await prisma.laneStep.count({ where: { laneSlug: slug } })
      if (n === 0) throw new LaneEditError(400, 'Add at least one step before publishing')
    }
    set('published', current.published, patch.published)
  }
  if (audit.length === 0) return { changed: [] }

  // A published lane with a submit step must have a mission for that step to point at.
  const willPublish = 'published' in data ? (data.published as boolean) : current.published
  const missionAfter = 'missionId' in data ? (data.missionId as number | null) : (current.missionId ?? null)
  if (willPublish && missionAfter === null && ('published' in data || 'missionId' in data)) {
    const submitSteps = await prisma.laneStep.count({ where: { laneSlug: slug, kind: 'submit' } })
    if (submitSteps > 0) throw new LaneEditError(400, SUBMIT_NEEDS_MISSION)
  }

  const n = noteOf(note)
  await prisma.$transaction(async (tx) => {
    await tx.lane.update({ where: { slug }, data: { ...data, updatedBy: actor } as never })
    for (const a of audit) {
      await tx.appSettingChange.create({
        data: { key: `lane:${slug}:${a.field}`, oldValue: jsonOrDbNull(a.oldValue), newValue: jsonOrDbNull(a.newValue), changedBy: actor, note: n },
      })
    }
  })
  return { changed: audit.map((a) => a.field) }
}

export interface StepInput {
  title?: unknown
  body?: unknown
  linkHref?: unknown
  linkLabel?: unknown
  kind?: unknown
}

function checkBody(v: unknown): string {
  const body = text(v, 'body', STEP_BODY_MAX, { allowEmpty: true })
  const unknown = placeholdersIn(body).filter((p) => !isFactKey(p))
  if (unknown.length) throw new LaneEditError(400, `Unknown placeholder: ${unknown.join(', ')}`)
  return body
}

function checkLabel(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = text(v, 'linkLabel', STEP_LABEL_MAX, { allowEmpty: true })
  return t || null
}

function checkLink(v: unknown): string | null {
  const r = parseStepLink(v)
  if (!r.ok) throw new LaneEditError(400, r.error)
  return r.value
}

/** A submit step on a published lane with no mission would point at nothing: refuse it. */
async function assertSubmitStepAllowed(slug: string): Promise<void> {
  const lane = await prisma.lane.findUnique({ where: { slug }, select: { published: true, missionId: true } })
  if (lane?.published && (lane.missionId ?? null) === null) throw new LaneEditError(400, SUBMIT_NEEDS_MISSION)
}

export async function createStep(slug: string, input: StepInput, actor: string, note?: unknown): Promise<{ id: string }> {
  if (!isLaneSlug(slug)) throw new LaneEditError(400, 'Invalid lane')
  const lane = await prisma.lane.findUnique({ where: { slug }, select: { slug: true } })
  if (!lane) throw new LaneEditError(404, 'Lane not found')
  const title = text(input.title, 'title', STEP_TITLE_MAX)
  const body = checkBody(input.body ?? '')
  const linkHref = checkLink(input.linkHref)
  const linkLabel = checkLabel(input.linkLabel)
  if (input.kind !== undefined && !isStepKind(input.kind)) throw new LaneEditError(400, 'kind must be read, do or submit')
  const kind = (input.kind as string | undefined) ?? 'do'
  if (kind === 'submit') await assertSubmitStepAllowed(slug)

  return prisma.$transaction(async (tx) => {
    const last = await tx.laneStep.findFirst({ where: { laneSlug: slug }, orderBy: { position: 'desc' }, select: { position: true } })
    const step = await tx.laneStep.create({ data: { laneSlug: slug, position: (last?.position ?? 0) + 1, title, body, linkHref, linkLabel, kind } })
    await tx.appSettingChange.create({
      data: { key: `laneStep:${step.id}:created`, oldValue: jsonOrDbNull(null), newValue: jsonOrDbNull({ lane: slug, title, kind }), changedBy: actor, note: noteOf(note) },
    })
    return { id: step.id }
  })
}

export async function updateStep(id: string, patch: StepInput, actor: string, note?: unknown): Promise<{ changed: string[] }> {
  if (typeof id !== 'string' || !id) throw new LaneEditError(400, 'Invalid step id')
  const current = await prisma.laneStep.findUnique({ where: { id } })
  if (!current) throw new LaneEditError(404, 'Step not found')
  const data: Record<string, unknown> = {}
  const audit: Audit = []
  const set = (field: string, oldValue: unknown, newValue: unknown) => {
    if (same(oldValue, newValue)) return
    data[field] = newValue
    audit.push({ field, oldValue, newValue })
  }
  if (patch.title !== undefined) set('title', current.title, text(patch.title, 'title', STEP_TITLE_MAX))
  if (patch.body !== undefined) set('body', current.body, checkBody(patch.body))
  if (patch.linkHref !== undefined) set('linkHref', current.linkHref ?? null, checkLink(patch.linkHref))
  if (patch.linkLabel !== undefined) set('linkLabel', current.linkLabel ?? null, checkLabel(patch.linkLabel))
  if (patch.kind !== undefined) {
    if (!isStepKind(patch.kind)) throw new LaneEditError(400, 'kind must be read, do or submit')
    set('kind', current.kind, patch.kind)
  }
  if (audit.length === 0) return { changed: [] }
  if (data.kind === 'submit') await assertSubmitStepAllowed(current.laneSlug)
  const n = noteOf(note)
  await prisma.$transaction(async (tx) => {
    await tx.laneStep.update({ where: { id }, data: data as never })
    for (const a of audit) {
      await tx.appSettingChange.create({
        data: { key: `laneStep:${id}:${a.field}`, oldValue: jsonOrDbNull(a.oldValue), newValue: jsonOrDbNull(a.newValue), changedBy: actor, note: n },
      })
    }
  })
  return { changed: audit.map((a) => a.field) }
}

/** Swap a step with its neighbour. Positions are renumbered 1..n so they never collide. */
export async function moveStep(id: string, direction: 'up' | 'down', actor: string): Promise<void> {
  if (direction !== 'up' && direction !== 'down') throw new LaneEditError(400, 'move must be up or down')
  const step = await prisma.laneStep.findUnique({ where: { id } })
  if (!step) throw new LaneEditError(404, 'Step not found')
  await prisma.$transaction(async (tx) => {
    const all = await tx.laneStep.findMany({ where: { laneSlug: step.laneSlug }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true } })
    const ids = all.map((s) => s.id)
    const i = ids.indexOf(id)
    const j = direction === 'up' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    for (let k = 0; k < ids.length; k++) await tx.laneStep.update({ where: { id: ids[k] }, data: { position: k + 1 } })
    await tx.appSettingChange.create({
      data: { key: `laneStep:${id}:position`, oldValue: jsonOrDbNull(i + 1), newValue: jsonOrDbNull(j + 1), changedBy: actor, note: null },
    })
  })
}

export async function deleteStep(id: string, actor: string, note?: unknown): Promise<void> {
  const step = await prisma.laneStep.findUnique({ where: { id } })
  if (!step) throw new LaneEditError(404, 'Step not found')
  await prisma.$transaction(async (tx) => {
    // Lock the lane row so two concurrent deletes (or an unpublish) serialize on the check below.
    await tx.$queryRaw`SELECT slug FROM "Lane" WHERE slug = ${step.laneSlug} FOR UPDATE`
    const lane = await tx.lane.findUnique({ where: { slug: step.laneSlug }, select: { published: true } })
    if (lane?.published) {
      const n = await tx.laneStep.count({ where: { laneSlug: step.laneSlug } })
      if (n <= 1) throw new LaneEditError(409, 'Unpublish the lane before deleting its last step')
    }
    await tx.laneStep.delete({ where: { id } })
    await tx.appSettingChange.create({
      data: { key: `laneStep:${id}:deleted`, oldValue: jsonOrDbNull({ lane: step.laneSlug, title: step.title, kind: step.kind }), newValue: jsonOrDbNull(null), changedBy: actor, note: noteOf(note) },
    })
  })
}
