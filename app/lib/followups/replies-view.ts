/**
 * Read-only replies list for members cleared by followups.replyMinLevel (or Dread Pizza Roberts).
 * Returns only what the replies view shows: reply text and time, owner name, crew, channel. No ids,
 * drafts or admin data. Callers must check canReadFollowUpReplies first.
 */
import { prisma } from '@/app/lib/db'

export interface ReplyRow {
  id: string
  ownerName: string
  crew: string | null
  callTitle: string | null
  channel: 'DISCORD' | 'TELEGRAM' | null
  reply: string
  repliedAt: string
}

export async function listReplies(limit = 200): Promise<ReplyRow[]> {
  const rows = await prisma.followUp.findMany({
    where: { lastReplyAt: { not: null }, lastReply: { not: null } },
    orderBy: { lastReplyAt: 'desc' },
    take: Math.min(limit, 500),
    select: { id: true, ownerName: true, channel: true, lastReply: true, lastReplyAt: true, recordingId: true },
  })
  const ids = [...new Set(rows.flatMap((r) => (r.recordingId ? [r.recordingId] : [])))]
  const calls = ids.length ? await prisma.callRecording.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, eventName: true, crewLabel: true } }) : []
  const byId = new Map(calls.map((c) => [c.id, c]))
  return rows.map((r) => {
    const c = r.recordingId ? byId.get(r.recordingId) : undefined
    return {
      id: r.id,
      ownerName: r.ownerName,
      crew: c?.crewLabel ?? null,
      callTitle: c?.title ?? c?.eventName ?? null,
      channel: r.channel,
      reply: r.lastReply ?? '',
      repliedAt: (r.lastReplyAt as Date).toISOString(),
    }
  })
}
