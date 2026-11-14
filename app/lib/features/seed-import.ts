/**
 * Idempotent import of data/features-seed.json (plans/features-catalog.md, 4.3). Rules:
 *  - a new slug is created UNPUBLISHED, so nothing is public until an admin reviews and publishes it;
 *  - an existing row that was imported and never had its content edited (editedAt is empty) is refreshed
 *    from the seed, keeping its published / showWhenOff / reviewedAt choices. Publishing, marking reviewed and
 *    link checks do not set editedAt;
 *  - an existing row whose content an admin edited, or one created by hand, is never overwritten.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import type { Seed, SeedApp, SeedEntry } from './types'

export type SeedDb = Pick<PrismaClient, 'featureApp' | 'featureEntry'>

export interface ImportSummary {
  apps: { created: number; refreshed: number; unchanged: number; keptEdited: number }
  entries: { created: number; refreshed: number; unchanged: number; keptEdited: number }
  /** Slugs left alone because an admin edited them. */
  keptEditedSlugs: string[]
}

type Counts = ImportSummary['apps']
const zero = (): Counts => ({ created: 0, refreshed: 0, unchanged: 0, keptEdited: 0 })

/** JSON with object keys sorted, so equal data compares equal whatever its key order (Postgres JSONB reorders keys). */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b)

function appData(a: SeedApp) {
  return {
    name: a.name,
    tagline: a.tagline,
    url: a.url,
    repo: a.repo,
    repoPrivate: a.repoPrivate,
    defaultBranch: a.defaultBranch,
    license: a.license,
    licenseNote: a.licenseNote,
    kind: a.kind,
    position: a.position,
  }
}

function entryData(e: SeedEntry) {
  return {
    appSlug: e.appSlug,
    title: e.title,
    summary: e.summary,
    body: e.body,
    audiences: e.audiences,
    tags: e.tags,
    status: e.status,
    access: e.access,
    toggleKey: e.toggleKey,
    liveUrl: e.liveUrl,
    docsUrl: e.docsUrl,
    code: e.code as unknown as Prisma.InputJsonValue,
    position: e.position,
  }
}

const unedited = (row: { importedAt: Date | null; editedAt: Date | null }) => !!row.importedAt && !row.editedAt

export async function importSeed(db: SeedDb, seed: Seed, opts: { now?: Date } = {}): Promise<ImportSummary> {
  const now = opts.now ?? new Date()
  const summary: ImportSummary = { apps: zero(), entries: zero(), keptEditedSlugs: [] }

  const existingApps = new Map((await db.featureApp.findMany()).map((r) => [r.slug, r]))
  for (const a of seed.apps) {
    const row = existingApps.get(a.slug)
    const data = appData(a)
    if (!row) {
      await db.featureApp.create({ data: { slug: a.slug, ...data, published: false, importedAt: now, updatedBy: null } })
      summary.apps.created++
    } else if (!unedited(row)) {
      summary.apps.keptEdited++
      summary.keptEditedSlugs.push(a.slug)
    } else if (same(pick(row, data), data)) {
      summary.apps.unchanged++
    } else {
      await db.featureApp.update({ where: { slug: a.slug }, data: { ...data, importedAt: now } })
      summary.apps.refreshed++
    }
  }

  const existing = new Map((await db.featureEntry.findMany()).map((r) => [r.slug, r]))
  for (const e of seed.entries) {
    const row = existing.get(e.slug)
    const data = entryData(e)
    if (!row) {
      await db.featureEntry.create({ data: { slug: e.slug, ...data, published: false, showWhenOff: false, importedAt: now } })
      summary.entries.created++
    } else if (!unedited(row)) {
      summary.entries.keptEdited++
      summary.keptEditedSlugs.push(e.slug)
    } else if (same(pick(row, data), data)) {
      summary.entries.unchanged++
    } else {
      await db.featureEntry.update({ where: { slug: e.slug }, data: { ...data, importedAt: now } })
      summary.entries.refreshed++
    }
  }
  return summary
}

function pick(row: object, like: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(like)) out[k] = (row as Record<string, unknown>)[k]
  return out
}
