/**
 * The sheet import framework (plans/sheets-cutover.md 3.1, 5).
 *
 * - Dry run (the default) reads the sheet and the database and returns counts only: would-create,
 *   would-update, unchanged, would-orphan, and parse issues as row numbers plus a code. It never
 *   returns cell contents, so a report is safe to paste anywhere.
 * - Apply upserts by a stable natural key. Running it twice changes nothing. It never deletes.
 * - Every run (dry run or apply) is logged as a SheetImportRun row.
 */
import { prisma } from '@/app/lib/db'
import type { SheetSourceKey } from '@/app/lib/settings/sheets-settings'
import { planUpserts, stableEqual, type UpsertPlan } from './plan'

export type ImportMode = 'dry-run' | 'apply'

/** A row the importer could not use. `code` is a fixed word (never cell text). */
export interface ParseIssue {
  /** 1-based sheet row when known, else 0. */
  row: number
  code: string
  /** Optional scope, e.g. a crew id (an id, never cell text). */
  scope?: string
}

export interface ImportCounts {
  create: number
  update: number
  unchanged: number
  orphan: number
  parseErrors: number
}

export interface ImportReport {
  dataset: string
  mode: ImportMode
  ok: boolean
  /** True only when an apply actually wrote. */
  applied: boolean
  /** True when an apply was refused because the data set already reads from the database. */
  refused?: boolean
  counts: ImportCounts
  /** Extra counts the importer reports (e.g. unresolved lead ids). Numbers only. */
  extra: Record<string, number>
  issues: ParseIssue[]
  /** Issues beyond the first MAX_ISSUES are counted, not listed. */
  issuesTruncated: number
  error?: string
  runId?: number
  startedAt: string
  finishedAt: string
}

export interface LoadResult<T> {
  records: Array<{ key: string; value: T }>
  issues: ParseIssue[]
  extra?: Record<string, number>
  revision?: string | null
}

export interface Importer<T> {
  key: string
  /** Read the sheet(s) and turn rows into keyed records. */
  load(): Promise<LoadResult<T>>
  /** The database side, projected to the same shape as `load` records. */
  existing(): Promise<Map<string, T>>
  /**
   * Write creates and updates. Must be idempotent (upserts). An apply that writes in several
   * chunks reports each chunk with `progress(rowsWritten)`, so a failure part-way is logged with
   * how far it got.
   */
  apply(plan: UpsertPlan<T>, progress: (rowsWritten: number) => void): Promise<void>
  equal?: (a: T, b: T) => boolean
}

export interface DatasetInfo {
  key: string
  label: string
  /** The `sheets.source.*` switch this import feeds, if any. */
  source?: SheetSourceKey
  description: string
  /** Lazily loaded so the admin listing does not pull in every importer. */
  importer: () => Promise<Importer<unknown>>
  /** Optional parity check: compare the sheet-mode and database-mode outputs of the real read path. */
  parity?: () => Promise<ParityReport>
}

/** Counts of differences between the sheet path and the database path. Never contents. */
export interface ParityReport {
  dataset: string
  compared: number
  mismatches: number
  onlyInSheet: number
  onlyInDb: number
  /** Per-scope mismatch counts (e.g. by crew id). */
  byScope?: Record<string, number>
  error?: string
}

export const MAX_ISSUES = 200

export function countsOf<T>(plan: UpsertPlan<T>, parseErrors: number): ImportCounts {
  return { create: plan.create.length, update: plan.update.length, unchanged: plan.unchanged, orphan: plan.orphans.length, parseErrors }
}

export interface RunDeps {
  log?: (row: {
    dataset: string
    mode: ImportMode
    ok: boolean
    counts: ImportCounts
    extra: Record<string, number>
    issues: ParseIssue[]
    error: string | null
    sheetRevision: string | null
    actor: string
    startedAt: Date
    finishedAt: Date
  }) => Promise<number | undefined>
  now?: () => Date
  /**
   * The `sheets.source.*` switch this import feeds. While it reads from the database (fully), an
   * apply is refused: the website is where the data is edited then, and the sheet is stale.
   * (A per-crew pilot is allowed; those importers skip the pilot crews themselves.)
   */
  source?: SheetSourceKey
  /** Test hook for the source lookup. */
  getSource?: (key: SheetSourceKey) => Promise<{ kind: 'sheet' | 'db'; crews: ReadonlySet<string> | null }>
}

export const REFUSED_SOURCE_IS_DB = 'This data set reads from the database now; switch its source back to "sheet" before applying an import'

async function defaultLog(row: Parameters<NonNullable<RunDeps['log']>>[0]): Promise<number | undefined> {
  const saved = await prisma.sheetImportRun.create({
    data: {
      dataset: row.dataset,
      mode: row.mode,
      ok: row.ok,
      counts: { ...row.counts, ...row.extra } as never,
      issues: row.issues.slice(0, MAX_ISSUES) as never,
      error: row.error,
      sheetRevision: row.sheetRevision,
      actor: row.actor,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    },
    select: { id: true },
  })
  return saved.id
}

/** A generic error message: never echo sheet contents. */
function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.slice(0, 300)
}

export async function runImport<T>(importer: Importer<T>, mode: ImportMode, actor: string, deps: RunDeps = {}): Promise<ImportReport> {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? defaultLog
  const startedAt = now()
  let report: Omit<ImportReport, 'runId' | 'finishedAt'>
  let revision: string | null = null
  let written = 0
  const refused = async () => {
    if (mode !== 'apply' || !deps.source) return false
    const lookup = deps.getSource ?? (async (key: SheetSourceKey) => (await import('./source')).getSource(key))
    const src = await lookup(deps.source)
    return src.kind === 'db' && !src.crews
  }
  try {
    if (await refused()) {
      report = {
        dataset: importer.key, mode, ok: false, applied: false, refused: true,
        counts: { create: 0, update: 0, unchanged: 0, orphan: 0, parseErrors: 0 },
        extra: {}, issues: [], issuesTruncated: 0, error: REFUSED_SOURCE_IS_DB, startedAt: startedAt.toISOString(),
      }
      return finish(report)
    }
    const [loaded, existing] = await Promise.all([importer.load(), importer.existing()])
    revision = loaded.revision ?? null
    const plan = planUpserts(loaded.records, existing, importer.equal ?? stableEqual)
    if (mode === 'apply' && (plan.create.length || plan.update.length)) {
      await importer.apply(plan, (n) => {
        written = n
      })
    }
    report = {
      dataset: importer.key,
      mode,
      ok: true,
      applied: mode === 'apply' && (plan.create.length > 0 || plan.update.length > 0),
      counts: countsOf(plan, loaded.issues.length),
      extra: loaded.extra ?? {},
      issues: loaded.issues.slice(0, MAX_ISSUES),
      issuesTruncated: Math.max(0, loaded.issues.length - MAX_ISSUES),
      startedAt: startedAt.toISOString(),
    }
  } catch (e) {
    report = {
      dataset: importer.key,
      mode,
      ok: false,
      applied: false,
      counts: { create: 0, update: 0, unchanged: 0, orphan: 0, parseErrors: 0 },
      // A chunked apply that failed part-way: how many rows it had already written.
      extra: mode === 'apply' ? { rowsWrittenBeforeFailure: written } : {},
      issues: [],
      issuesTruncated: 0,
      error: safeError(e),
      startedAt: startedAt.toISOString(),
    }
  }
  return finish(report)

  async function finish(report: Omit<ImportReport, 'runId' | 'finishedAt'>): Promise<ImportReport> {
  const finishedAt = now()
  let runId: number | undefined
  try {
    runId = await log({
      dataset: report.dataset,
      mode,
      ok: report.ok,
      counts: report.counts,
      extra: report.extra,
      issues: report.issues,
      error: report.error ?? null,
      sheetRevision: revision,
      actor,
      startedAt,
      finishedAt,
    })
  } catch (e) {
    console.error('[sheets-import] could not log the run', safeError(e))
  }
  return { ...report, runId, finishedAt: finishedAt.toISOString() }
  }
}
