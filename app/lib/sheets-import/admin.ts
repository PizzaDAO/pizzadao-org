/**
 * Data for /admin/sheets: each data set, where it reads from, and its last import runs.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { SHEET_SOURCES, SHEET_SOURCE_KEYS, type SheetSourceKey } from '@/app/lib/settings/sheets-settings'
import { SHEET_IDS, type SheetKey } from '@/app/lib/sheets/config'
import { DATASETS } from './datasets'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { resolveSource } from './source'

export interface RunView {
  id: number
  mode: string
  ok: boolean
  counts: Record<string, number>
  error: string | null
  actor: string
  startedAt: string
}

export interface DatasetView {
  key: string
  label: string
  description: string
  source: SheetSourceKey | null
  hasParity: boolean
  lastDryRun: RunView | null
  lastApply: RunView | null
}

export interface SourceView {
  key: SheetSourceKey
  label: string
  env: string
  effective: string
  reason: string
}

export interface SheetsOverview {
  datasets: DatasetView[]
  sources: SourceView[]
  membersMirror: boolean
  /** The archive: every sheet the app has used, by config key. */
  archive: Array<{ key: string; url: string }>
  lastSnapshot: { batchId: string; takenAt: string; tabs: number } | null
}

const ARCHIVE_EXCLUDED: ReadonlySet<SheetKey> = new Set<SheetKey>(['discordWebhooks'])

function toRunView(r: { id: number; mode: string; ok: boolean; counts: unknown; error: string | null; actor: string; startedAt: Date }): RunView {
  return {
    id: r.id,
    mode: r.mode,
    ok: r.ok,
    counts: (r.counts && typeof r.counts === 'object' ? r.counts : {}) as Record<string, number>,
    error: r.error,
    actor: r.actor,
    startedAt: r.startedAt.toISOString(),
  }
}

export async function sheetsOverview(): Promise<SheetsOverview> {
  const settings = await loadSettings()
  const datasets: DatasetView[] = []
  for (const d of DATASETS) {
    const [lastDryRun, lastApply] = await Promise.all(
      (['dry-run', 'apply'] as const).map((mode) =>
        prisma.sheetImportRun.findFirst({ where: { dataset: d.key, mode }, orderBy: { startedAt: 'desc' } }),
      ),
    )
    datasets.push({
      key: d.key,
      label: d.label,
      description: d.description,
      source: d.source ?? null,
      hasParity: !!d.parity,
      lastDryRun: lastDryRun ? toRunView(lastDryRun) : null,
      lastApply: lastApply ? toRunView(lastApply) : null,
    })
  }
  const sources = SHEET_SOURCE_KEYS.map((key) => {
    const r = resolveSource(key, settings)
    return { key, label: SHEET_SOURCES[key].label, env: SHEET_SOURCES[key].env, effective: r.raw, reason: r.reason }
  })
  const snap = await prisma.sheetSnapshot.findFirst({ orderBy: { takenAt: 'desc' }, select: { batchId: true, takenAt: true } })
  const tabs = snap ? await prisma.sheetSnapshot.count({ where: { batchId: snap.batchId } }) : 0
  return {
    datasets,
    sources,
    membersMirror: resolveToggle('sheets.mirror.members', settings),
    archive: (Object.entries(SHEET_IDS) as Array<[SheetKey, string]>)
      .filter(([k]) => !ARCHIVE_EXCLUDED.has(k))
      .map(([key, id]) => ({ key, url: `https://docs.google.com/spreadsheets/d/${id}/edit` })),
    lastSnapshot: snap ? { batchId: snap.batchId, takenAt: snap.takenAt.toISOString(), tabs } : null,
  }
}
