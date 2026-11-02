/**
 * The Community Call announcement block from the database (plans/sheets-cutover.md PR 8): the same
 * AnnounceSheetIO the runner already uses, backed by AnnounceState (the Announce? / Last Sent: /
 * Last Error: values) and Announcement (the specials table). Used once `sheets.source.announce`
 * is "db"; nothing is written to the sheet then.
 */
import { prisma } from '@/app/lib/db'
import type { AnnounceBlock, AnnounceSheetIO } from './sheet'

export const DB_SEND_CELL = 'db:AnnounceState/sendValue'
export const DB_LAST_SENT_CELL = 'db:AnnounceState/lastSentValue'
export const DB_LAST_ERROR_CELL = 'db:AnnounceState/lastError'

const FIELD_BY_CELL: Record<string, 'sendValue' | 'lastSentValue' | 'lastError'> = {
  [DB_SEND_CELL]: 'sendValue',
  [DB_LAST_SENT_CELL]: 'lastSentValue',
  [DB_LAST_ERROR_CELL]: 'lastError',
}

export function createAnnounceDbIO(): AnnounceSheetIO {
  return {
    async readBlock(): Promise<AnnounceBlock> {
      const [state, specials] = await Promise.all([
        prisma.announceState.findUnique({ where: { id: 1 } }),
        prisma.announcement.findMany({ where: { archived: false }, orderBy: { position: 'asc' } }),
      ])
      return {
        sendCell: DB_SEND_CELL,
        lastSentCell: DB_LAST_SENT_CELL,
        lastErrorCell: DB_LAST_ERROR_CELL,
        sendValue: (state?.sendValue ?? '').trim(),
        lastSentValue: (state?.lastSentValue ?? '').trim(),
        specials: specials.map((s) => ({ text: s.text, url: s.url, crew: s.crew, status: s.status })),
      }
    },
    async writeCells(updates) {
      const data: Partial<Record<'sendValue' | 'lastSentValue' | 'lastError', string>> = {}
      for (const u of updates) {
        const field = FIELD_BY_CELL[u.range]
        if (field) data[field] = u.value
      }
      if (!Object.keys(data).length) return
      await prisma.announceState.upsert({ where: { id: 1 }, create: { id: 1, ...data, updatedBy: 'announce' }, update: { ...data, updatedBy: 'announce' } })
    },
  }
}

export async function announceFromDb(): Promise<boolean> {
  const { usesDb } = await import('@/app/lib/sheets-import/source')
  return usesDb('announce')
}
