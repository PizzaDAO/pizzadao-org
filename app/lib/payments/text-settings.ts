/**
 * Text-valued payment state.
 *
 * - The Work Payment responses sheet id is the registry setting `payments.formSheetId` (private,
 *   edited on the admin settings page by Dread Pizza Roberts only). It is never committed to the repo
 *   and never sent to any public page: empty means form ingest does nothing.
 * - The ingest status and the "ingest from" moment are raw AppSetting rows (not editable settings, so
 *   not in the registry). Every change to the moment is audited in AppSettingChange.
 */
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import { isValidSheetId } from '@/app/lib/settings/payments-settings'
import { saveSetting } from '@/app/lib/settings/store'
import { jsonOrDbNull } from '@/app/lib/settings/json'

export { isValidSheetId }

export const INGEST_STATUS_KEY = 'payments.ingestStatus'
export const INGEST_FROM_KEY = 'payments.ingestFrom'

/** The configured responses sheet id, or '' (ingest off). Never throws. */
export async function getFormSheetId(): Promise<string> {
  try {
    const v = (await getSetting('payments.formSheetId')).trim()
    return isValidSheetId(v) ? v : ''
  } catch {
    return ''
  }
}

/** Save (or clear, with '') the responses sheet id through the settings registry (validated and audited). */
export async function setFormSheetId(value: string, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = value.trim()
  if (v && !isValidSheetId(v)) return { ok: false, error: 'That does not look like a sheet id' }
  await saveSetting('payments.formSheetId', v, actor)
  return { ok: true }
}

export interface IngestStatus {
  at: string
  ok: boolean
  /** e.g. "missing header: amount". Never row contents. */
  error?: string
  /** Not a failure: for example, only the newest rows of the sheet were read. */
  warning?: string
  created: number
}

export async function getIngestStatus(): Promise<IngestStatus | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: INGEST_STATUS_KEY } })
    const v = row?.value as Partial<IngestStatus> | null | undefined
    if (v && typeof v.at === 'string' && typeof v.ok === 'boolean') return { at: v.at, ok: v.ok, error: v.error, warning: v.warning, created: Number(v.created) || 0 }
  } catch {
    /* fall through */
  }
  return null
}

export async function saveIngestStatus(s: IngestStatus): Promise<void> {
  try {
    await prisma.appSetting.upsert({
      where: { key: INGEST_STATUS_KEY },
      create: { key: INGEST_STATUS_KEY, value: s as never, updatedBy: 'cron' },
      update: { value: s as never, updatedBy: 'cron' },
    })
  } catch {
    /* status is informational */
  }
}

/** The "ingest from" moment: form responses submitted before it are never imported. Null = never set. */
export async function getIngestFrom(): Promise<Date | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: INGEST_FROM_KEY } })
    const d = typeof row?.value === 'string' ? new Date(row.value) : null
    return d && !Number.isNaN(d.getTime()) ? d : null
  } catch {
    // Unknown: the caller must not import history, so report "now".
    return new Date()
  }
}

/** Set the moment (audited). Used by the first ingest run and by the top review role. */
export async function setIngestFrom(d: Date, actor: string): Promise<void> {
  const iso = d.toISOString()
  await prisma.$transaction(async (tx) => {
    const existing = await tx.appSetting.findUnique({ where: { key: INGEST_FROM_KEY } })
    await tx.appSetting.upsert({
      where: { key: INGEST_FROM_KEY },
      create: { key: INGEST_FROM_KEY, value: iso, updatedBy: actor },
      update: { value: iso, updatedBy: actor },
    })
    await tx.appSettingChange.create({
      data: { key: INGEST_FROM_KEY, oldValue: jsonOrDbNull(typeof existing?.value === 'string' ? existing.value : null), newValue: iso, changedBy: actor },
    })
  })
}
