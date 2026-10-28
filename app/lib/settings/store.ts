/**
 * Writes for the admin settings page: validate, store and audit in one transaction, then clear
 * the local cache (other instances catch up within ~30s). The audit row records who/when/old/new.
 */
import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from './index'
import { jsonOrDbNull } from './json'
import { AREA_LABELS, SETTINGS, SETTING_KEYS, parseSetting, type SettingKey } from './registry'

export class SettingError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

export interface SettingChangeRow {
  id: number
  key: string
  oldValue: unknown
  newValue: unknown
  changedBy: string
  changedAt: Date
  note: string | null
}

const MAX_NOTE = 300
const cleanNote = (note: unknown): string | null =>
  typeof note === 'string' && note.trim() ? note.trim().slice(0, MAX_NOTE) : null

/** Set an override. `expectedUpdatedAt` (ISO) guards against editing a value changed since it was loaded. */
export async function saveSetting(
  key: SettingKey,
  value: unknown,
  actor: string,
  opts: { note?: unknown; expectedUpdatedAt?: string | null } = {},
): Promise<{ updatedAt: Date }> {
  const parsed = parseSetting(key, value)
  if (!parsed.ok) throw new SettingError(400, `${key}: ${parsed.error}`)
  const note = cleanNote(opts.note)

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.appSetting.findUnique({ where: { key } })
    if (opts.expectedUpdatedAt !== undefined) {
      const have = existing ? existing.updatedAt.toISOString() : null
      if (have !== (opts.expectedUpdatedAt ?? null)) throw new SettingError(409, `${key} changed since you loaded it; reload and retry`)
    }
    const saved = await tx.appSetting.upsert({
      where: { key },
      create: { key, value: parsed.value as never, updatedBy: actor },
      update: { value: parsed.value as never, updatedBy: actor },
    })
    await tx.appSettingChange.create({
      data: { key, oldValue: jsonOrDbNull(existing ? existing.value : null), newValue: jsonOrDbNull(parsed.value), changedBy: actor, note },
    })
    return saved
  })
  clearSettingsCache()
  return { updatedAt: row.updatedAt }
}

/** Remove the override (back to the code default). No-op, and no audit row, when there is none. */
export async function resetSetting(key: SettingKey, actor: string, opts: { note?: unknown } = {}): Promise<boolean> {
  const note = cleanNote(opts.note)
  const removed = await prisma.$transaction(async (tx) => {
    const existing = await tx.appSetting.findUnique({ where: { key } })
    if (!existing) return false
    await tx.appSetting.delete({ where: { key } })
    await tx.appSettingChange.create({ data: { key, oldValue: jsonOrDbNull(existing.value), newValue: jsonOrDbNull(null), changedBy: actor, note } })
    return true
  })
  clearSettingsCache()
  return removed
}

/** Recent audit rows, newest first (all keys, or one). */
export async function listChanges(opts: { key?: string; limit?: number } = {}): Promise<SettingChangeRow[]> {
  const rows = await prisma.appSettingChange.findMany({
    where: opts.key ? { key: opts.key } : undefined,
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  })
  return rows as SettingChangeRow[]
}

export interface SettingView {
  key: SettingKey
  area: string
  areaLabel: string
  label: string
  help: string
  input: (typeof SETTINGS)[SettingKey]['input']
  stricterOnly: boolean
  default: unknown
  /** The effective value (override if valid, else the failure mode / default). */
  value: unknown
  /** The stored override, if any. */
  override: unknown
  modified: boolean
  /** Stored value fails its schema: flagged red. */
  invalid: boolean
  updatedAt: string | null
  updatedBy: string | null
}

/** The admin page's data. Reads rows directly (not the cache) so the page is never stale. */
export async function listSettingViews(): Promise<SettingView[]> {
  const rows = await prisma.appSetting.findMany()
  const byKey = new Map<string, { value: unknown; updatedAt: Date; updatedBy: string }>(
    (rows as Array<{ key: string; value: unknown; updatedAt: Date; updatedBy: string }>).map((r) => [r.key, r]),
  )
  return SETTING_KEYS.map((key) => {
    const def = SETTINGS[key]
    const row = byKey.get(key)
    const parsed = row ? parseSetting(key, row.value) : null
    const valid = !!parsed?.ok
    return {
      key,
      area: def.area,
      areaLabel: AREA_LABELS[def.area],
      label: def.label,
      help: def.help,
      input: def.input,
      stricterOnly: !!def.stricterOnly,
      default: def.default,
      value: valid ? parsed.value : row ? (def.onReadFailure === 'lastKnownGood' || def.onReadFailure === 'throw' ? def.default : def.onReadFailure.value) : def.default,
      override: row ? row.value : null,
      modified: !!row,
      invalid: !!row && !valid,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedBy: row ? row.updatedBy : null,
    }
  })
}

/** The confirmation text for a change (null = save without asking). */
export function confirmationFor(key: SettingKey, from: unknown, to: unknown): string | null {
  const c = SETTINGS[key].confirm as ((a: unknown, b: unknown) => string | null) | undefined
  return c ? c(from, to) : null
}
