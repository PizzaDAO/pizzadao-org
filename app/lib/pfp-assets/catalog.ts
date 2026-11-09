// PFP asset catalog: CRUD, validation and audit. Admin-managed; there is no seed catalog in code.
import { prisma } from '@/app/lib/db'
import { getGuildRoles } from '@/app/lib/discord-channels'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { isBlobUrl } from './hosts'
import {
  isAssetKind,
  parseRule,
  cleanTransform,
  type AssetKind,
  type AssetRule,
  type Transform,
} from './types'

export const NAME_MAX = 60
export const HINT_MAX = 120
export const MAX_RULES = 12

export interface AssetRecord {
  id: number
  slug: string
  name: string
  kind: AssetKind
  imageUrl: string
  thumbUrl: string | null
  defaultTransform: Transform | null
  lockedHint: string | null
  isActive: boolean
  sortOrder: number
  rules: AssetRule[]
}

export interface AssetInput {
  name?: unknown
  kind?: unknown
  imageUrl?: unknown
  thumbUrl?: unknown
  defaultTransform?: unknown
  lockedHint?: unknown
  isActive?: unknown
  sortOrder?: unknown
  rules?: unknown
}

type Row = {
  id: number
  slug: string
  name: string
  kind: string
  imageUrl: string
  thumbUrl: string | null
  defaultTransform: unknown
  lockedHint: string | null
  isActive: boolean
  sortOrder: number
  rules: Array<{ kind: string; params: unknown }>
}

export function toRecord(r: Row): AssetRecord {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: r.kind as AssetKind,
    imageUrl: r.imageUrl,
    thumbUrl: r.thumbUrl,
    defaultTransform: r.defaultTransform ? cleanTransform(r.defaultTransform) : null,
    lockedHint: r.lockedHint,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    rules: r.rules.map((x) => ({ kind: x.kind as AssetRule['kind'], params: (x.params ?? {}) as Record<string, unknown> })),
  }
}

const INCLUDE = { rules: { orderBy: { id: 'asc' as const } } }

export async function listAssets(opts: { activeOnly?: boolean } = {}): Promise<AssetRecord[]> {
  const rows = await prisma.pfpAsset.findMany({
    where: opts.activeOnly ? { isActive: true } : undefined,
    include: INCLUDE,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  return (rows as unknown as Row[]).map(toRecord)
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'asset'
}

/**
 * Validate rules: structure first, then that role ids exist in the guild and mission / item ids
 * exist. Throws ValidationError (400). An unreachable Discord API rejects role rules rather than
 * storing an unverified id.
 */
export async function validateRules(input: unknown): Promise<AssetRule[]> {
  if (!Array.isArray(input)) throw new ValidationError('rules must be a list', 'rules')
  if (input.length > MAX_RULES) throw new ValidationError(`At most ${MAX_RULES} rules`, 'rules')
  const rules: AssetRule[] = []
  for (const raw of input) {
    const parsed = parseRule(raw)
    if (!parsed.ok) throw new ValidationError(parsed.error, 'rules')
    rules.push(parsed.rule)
  }

  const roleIds = rules.filter((r) => r.kind === 'role').map((r) => String(r.params.roleId))
  if (roleIds.length) {
    const roles = await getGuildRoles()
    if (!roles) throw new ValidationError('Could not verify Discord roles right now. Try again.', 'rules')
    const known = new Set(roles.map((r) => r.id))
    const bad = roleIds.find((id) => !known.has(id))
    if (bad) throw new ValidationError('Unknown Discord role', 'rules')
  }
  const missionIds = rules.filter((r) => r.kind === 'mission').map((r) => Number(r.params.missionId))
  if (missionIds.length) {
    const found = await prisma.mission.findMany({ where: { id: { in: missionIds } }, select: { id: true } })
    if (new Set(found.map((m) => m.id)).size !== new Set(missionIds).size) throw new ValidationError('Unknown mission', 'rules')
  }
  const itemIds = rules.filter((r) => r.kind === 'item').map((r) => Number(r.params.itemId))
  if (itemIds.length) {
    const found = await prisma.shopItem.findMany({ where: { id: { in: itemIds } }, select: { id: true } })
    if (new Set(found.map((m) => m.id)).size !== new Set(itemIds).size) throw new ValidationError('Unknown item', 'rules')
  }
  return rules
}

function text(v: unknown, max: number, field: string, required: boolean): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${field} is required`, field)
    return null
  }
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`, field)
  const t = v.trim()
  if (!t && required) throw new ValidationError(`${field} is required`, field)
  if (t.length > max) throw new ValidationError(`${field} is too long (max ${max})`, field)
  return t || null
}

function imageUrl(v: unknown, field: string, required: boolean): string | null {
  const t = text(v, 600, field, required)
  if (t === null) return null
  if (!isBlobUrl(t)) throw new ValidationError(`${field} must be an uploaded image`, field)
  return t
}

function audit(
  actorId: string,
  action: string,
  asset: { id: number | null; name: string },
  extra: { targetId?: string; before?: unknown; after?: unknown } = {},
) {
  return prisma.pfpAdminEvent.create({
    data: {
      actorId,
      action,
      assetId: asset.id,
      assetName: asset.name,
      targetId: extra.targetId ?? null,
      before: (extra.before ?? undefined) as never,
      after: (extra.after ?? undefined) as never,
    },
  })
}

export async function createAsset(input: AssetInput, actorId: string): Promise<AssetRecord> {
  const name = text(input.name, NAME_MAX, 'name', true)!
  if (!isAssetKind(input.kind)) throw new ValidationError('Unknown kind', 'kind')
  const img = imageUrl(input.imageUrl, 'imageUrl', true)!
  const thumb = imageUrl(input.thumbUrl, 'thumbUrl', false)
  const hint = text(input.lockedHint, HINT_MAX, 'lockedHint', false)
  const rules = input.rules === undefined ? [] : await validateRules(input.rules)
  const sortOrder = Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0
  const base = slugify(name)

  // New assets start inactive: an admin reviews the preview, then switches them on.
  let slug = base
  for (let i = 2; await prisma.pfpAsset.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`
    if (i > 50) throw new ValidationError('Could not pick a unique slug', 'name')
  }
  const row = await prisma.pfpAsset.create({
    data: {
      slug,
      name,
      kind: input.kind,
      imageUrl: img,
      thumbUrl: thumb,
      defaultTransform: input.defaultTransform ? (cleanTransform(input.defaultTransform) as never) : undefined,
      lockedHint: hint,
      isActive: input.isActive === true,
      sortOrder,
      rules: { create: rules.map((r) => ({ kind: r.kind, params: r.params as never })) },
    },
    include: INCLUDE,
  })
  const rec = toRecord(row as unknown as Row)
  await audit(actorId, 'CREATE', rec, { after: rec })
  return rec
}

export async function updateAsset(id: number, input: AssetInput, actorId: string): Promise<AssetRecord> {
  const existing = await prisma.pfpAsset.findUnique({ where: { id }, include: INCLUDE })
  if (!existing) throw new ValidationError('Asset not found', 'id')
  const before = toRecord(existing as unknown as Row)

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = text(input.name, NAME_MAX, 'name', true)
  if (input.kind !== undefined) {
    if (!isAssetKind(input.kind)) throw new ValidationError('Unknown kind', 'kind')
    data.kind = input.kind
  }
  if (input.imageUrl !== undefined) data.imageUrl = imageUrl(input.imageUrl, 'imageUrl', true)
  if (input.thumbUrl !== undefined) data.thumbUrl = imageUrl(input.thumbUrl, 'thumbUrl', false)
  if (input.defaultTransform !== undefined) {
    data.defaultTransform = input.defaultTransform ? cleanTransform(input.defaultTransform) : null
  }
  if (input.lockedHint !== undefined) data.lockedHint = text(input.lockedHint, HINT_MAX, 'lockedHint', false)
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') throw new ValidationError('isActive must be true or false', 'isActive')
    data.isActive = input.isActive
  }
  if (input.sortOrder !== undefined) {
    if (!Number.isInteger(input.sortOrder)) throw new ValidationError('sortOrder must be a whole number', 'sortOrder')
    data.sortOrder = input.sortOrder
  }
  const rules = input.rules === undefined ? null : await validateRules(input.rules)

  const row = await prisma.$transaction(async (tx) => {
    if (rules) {
      await tx.pfpAssetRule.deleteMany({ where: { assetId: id } })
      await tx.pfpAssetRule.createMany({ data: rules.map((r) => ({ assetId: id, kind: r.kind, params: r.params as never })) })
    }
    return tx.pfpAsset.update({ where: { id }, data: data as never, include: INCLUDE })
  })
  const rec = toRecord(row as unknown as Row)
  await audit(actorId, 'UPDATE', rec, { before, after: rec })
  return rec
}

export async function deleteAsset(id: number, actorId: string): Promise<void> {
  const existing = await prisma.pfpAsset.findUnique({ where: { id }, include: INCLUDE })
  if (!existing) throw new ValidationError('Asset not found', 'id')
  const before = toRecord(existing as unknown as Row)
  await prisma.pfpAsset.delete({ where: { id } })
  await audit(actorId, 'DELETE', { id: null, name: before.name }, { before })
}

const DISCORD_ID = /^\d{5,25}$/

export async function grantAsset(assetId: number, discordId: unknown, actorId: string): Promise<void> {
  const target = String(discordId ?? '').trim()
  if (!DISCORD_ID.test(target)) throw new ValidationError('Member must be a Discord id', 'discordId')
  const asset = await prisma.pfpAsset.findUnique({ where: { id: assetId }, select: { id: true, name: true } })
  if (!asset) throw new ValidationError('Asset not found', 'assetId')
  await prisma.pfpAssetGrant.upsert({
    where: { assetId_discordId: { assetId, discordId: target } },
    create: { assetId, discordId: target, grantedBy: actorId },
    update: {},
  })
  await audit(actorId, 'GRANT', asset, { targetId: target })
}

export async function revokeAsset(assetId: number, discordId: unknown, actorId: string): Promise<void> {
  const target = String(discordId ?? '').trim()
  if (!DISCORD_ID.test(target)) throw new ValidationError('Member must be a Discord id', 'discordId')
  const asset = await prisma.pfpAsset.findUnique({ where: { id: assetId }, select: { id: true, name: true } })
  if (!asset) throw new ValidationError('Asset not found', 'assetId')
  await prisma.pfpAssetGrant.deleteMany({ where: { assetId, discordId: target } })
  await audit(actorId, 'REVOKE', asset, { targetId: target })
}

export async function listGrants(assetId?: number) {
  return prisma.pfpAssetGrant.findMany({
    where: assetId ? { assetId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
}

/** Pickers for the rules editor: missions (with level titles), shop items and guild roles. */
export async function loadRuleOptions() {
  const [missions, items, roles] = await Promise.all([
    prisma.mission.findMany({
      select: { id: true, level: true, title: true, levelTitle: true },
      orderBy: [{ level: 'asc' }, { index: 'asc' }],
    }),
    prisma.shopItem.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getGuildRoles().catch(() => null),
  ])
  const levelTitles: Record<number, string> = {}
  for (const m of missions) if (m.levelTitle && m.level > 0 && !levelTitles[m.level]) levelTitles[m.level] = m.levelTitle
  const levels = [...new Set(missions.filter((m) => m.level > 0).map((m) => m.level))].sort((a, b) => a - b)
  return {
    levels: levels.map((level) => ({ level, title: levelTitles[level] ?? null })),
    missions: missions.map((m) => ({ id: m.id, level: m.level, title: m.title })),
    items,
    roles: roles ? [...roles].sort((a, b) => a.name.localeCompare(b.name)) : null,
  }
}

export async function recentEvents(limit = 30) {
  return prisma.pfpAdminEvent.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
}
